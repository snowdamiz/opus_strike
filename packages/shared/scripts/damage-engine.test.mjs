import assert from 'node:assert/strict';
import {
  applyDamage,
  BATTLE_ROYAL_DOWNED_MAX_HP,
  calculateFalloffDamage,
  getAimConeHitAgainstPlayerCombatHitbox,
  shouldApplyDamageTick,
} from '../dist/index.js';

function player(id, team, overrides = {}) {
  return {
    id,
    team,
    state: 'alive',
    health: 100,
    maxHealth: 100,
    downedHealth: 0,
    downedMaxHealth: BATTLE_ROYAL_DOWNED_MAX_HP,
    ultimateCharge: 0,
    spawnProtectionUntil: null,
    shieldActive: false,
    stats: { kills: 0, deaths: 0, assists: 0 },
    ...overrides,
  };
}

function adapter(players) {
  return {
    getPlayerById: (id) => players.get(id) ?? null,
    getId: (entry) => entry.id,
    getTeam: (entry) => entry.team,
    getState: (entry) => entry.state,
    setState: (entry, state) => {
      entry.state = state;
    },
    getHealth: (entry) => entry.health,
    setHealth: (entry, health) => {
      entry.health = health;
    },
    getMaxHealth: (entry) => entry.maxHealth,
    getDownedHealth: (entry) => entry.downedHealth,
    setDownedHealth: (entry, health) => {
      entry.downedHealth = health;
    },
    getDownedMaxHealth: (entry) => entry.downedMaxHealth,
    getSpawnProtectionUntil: (entry) => entry.spawnProtectionUntil,
    getUltimateCharge: (entry) => entry.ultimateCharge,
    setUltimateCharge: (entry, charge) => {
      entry.ultimateCharge = charge;
    },
    getPersonalShieldState: (entry) => entry.shieldActive ? { isActive: true } : null,
    deactivatePersonalShield: (entry) => {
      entry.shieldActive = false;
    },
    // Mirrors the room adapter: body shield while alive, knockdown shield
    // (once raised) while downed.
    getShield: (entry) => (
      entry.state === 'downed'
        ? (entry.knockdownShieldActive ? entry.knockdownShieldHealth ?? 0 : 0)
        : entry.shield ?? 0
    ),
    setShield: (entry, shield) => {
      if (entry.state === 'downed') {
        entry.knockdownShieldHealth = shield;
        if (shield <= 0) entry.knockdownShieldActive = false;
      } else {
        entry.shield = shield;
      }
    },
    setRespawnTime: (entry, respawnTime) => {
      entry.respawnTime = respawnTime;
    },
    addKill: (entry) => {
      entry.stats.kills++;
    },
    addDeath: (entry) => {
      entry.stats.deaths++;
    },
    addAssist: (entry) => {
      entry.stats.assists++;
    },
  };
}

{
  const target = player('target', 'blue');
  const assister = player('assister', 'red');
  const killer = player('killer', 'red');
  const players = new Map([target, assister, killer].map((entry) => [entry.id, entry]));
  const damageHistory = new Map();
  const common = {
    adapter: adapter(players),
    damageHistory,
    assistWindowMs: 10_000,
    respawnDelayMs: 2000,
    ultimateChargePerKill: 20,
    ultimateChargePerAssist: 8,
  };

  applyDamage({ ...common, now: 1000 }, {
    target,
    source: assister,
    rawDamage: 25,
    damageType: 'test',
  });
  const result = applyDamage({ ...common, now: 2000 }, {
    target,
    source: killer,
    rawDamage: 80,
    damageType: 'test',
  });

  assert.equal(result.killed, true);
  assert.equal(result.downed, null);
  assert.equal(target.state, 'dead');
  assert.equal(target.health, 0);
  assert.equal(target.respawnTime, 4000);
  assert.equal(target.stats.deaths, 1);
  assert.equal(killer.stats.kills, 1);
  assert.equal(assister.stats.assists, 1);
  assert.equal(result.death.assistIds[0], 'assister');
  assert.equal(damageHistory.has('target'), false);
}

{
  const target = player('target', 'blue', { health: 12 });
  const source = player('source', 'red');
  const players = new Map([target, source].map((entry) => [entry.id, entry]));
  const result = applyDamage({
    adapter: adapter(players),
    damageHistory: new Map(),
    now: 1_000,
    assistWindowMs: 10_000,
    lethalAliveResolution: 'downed',
  }, {
    target,
    source,
    rawDamage: 20,
    damageType: 'battle_royal_test',
  });

  assert.equal(result.applied, true);
  assert.equal(result.killed, false);
  assert.equal(result.death, null);
  assert.equal(result.downed.targetId, 'target');
  assert.equal(result.downed.sourceId, 'source');
  assert.equal(target.state, 'downed');
  assert.equal(target.health, 0);
  assert.equal(target.downedHealth, BATTLE_ROYAL_DOWNED_MAX_HP);
  assert.equal(result.newDownedHealth, BATTLE_ROYAL_DOWNED_MAX_HP);
  assert.equal(target.stats.deaths, 0);
  assert.equal(source.stats.kills, 0);
}

{
  const target = player('target', 'blue', {
    state: 'downed',
    health: 0,
    downedHealth: 18,
    downedMaxHealth: 30,
  });
  const assister = player('assister', 'red');
  const finisher = player('finisher', 'red');
  const players = new Map([target, assister, finisher].map((entry) => [entry.id, entry]));
  const common = {
    adapter: adapter(players),
    damageHistory: new Map(),
    assistWindowMs: 10_000,
    damageDownedPlayers: true,
    ultimateChargePerKill: 20,
    ultimateChargePerAssist: 8,
  };

  applyDamage({ ...common, now: 1_000 }, {
    target,
    source: assister,
    rawDamage: 8,
    damageType: 'downed_finish_test',
  });
  const result = applyDamage({ ...common, now: 2_000 }, {
    target,
    source: finisher,
    rawDamage: 12,
    damageType: 'downed_finish_test',
  });

  assert.equal(result.applied, true);
  assert.equal(result.killed, true);
  assert.equal(result.downed, null);
  assert.equal(result.newDownedHealth, 0);
  assert.equal(target.state, 'dead');
  assert.equal(target.downedHealth, 0);
  assert.equal(target.stats.deaths, 1);
  assert.equal(finisher.stats.kills, 1);
  assert.equal(assister.stats.assists, 1);
  assert.deepEqual(result.death.assistIds, ['assister']);
}

{
  const target = player('target', 'red');
  const source = player('source', 'red');
  const players = new Map([target, source].map((entry) => [entry.id, entry]));
  const result = applyDamage({
    adapter: adapter(players),
    damageHistory: new Map(),
    now: 1,
    assistWindowMs: 10_000,
  }, {
    target,
    source,
    rawDamage: 10,
    damageType: 'friendly',
  });

  assert.equal(result.applied, false);
  assert.equal(result.rejectedReason, 'friendly_fire');
  assert.equal(target.health, 100);
}

{
  const target = player('target', 'blue', { shieldActive: true });
  const source = player('source', 'red');
  const players = new Map([target, source].map((entry) => [entry.id, entry]));
  const result = applyDamage({
    adapter: adapter(players),
    damageHistory: new Map(),
    now: 1,
    assistWindowMs: 10_000,
  }, {
    target,
    source,
    rawDamage: 10,
    damageType: 'shielded',
  });

  assert.equal(result.personalShieldBroken, true);
  assert.equal(result.applied, false);
  assert.equal(target.shieldActive, false);
  assert.equal(target.health, 100);
}

{
  const target = player('target', 'blue', { spawnProtectionUntil: 10_000 });
  const players = new Map([[target.id, target]]);
  const protectedResult = applyDamage({
    adapter: adapter(players),
    damageHistory: new Map(),
    now: 1_000,
    assistWindowMs: 10_000,
  }, {
    target,
    source: null,
    rawDamage: 10,
    damageType: 'safe_zone',
  });

  assert.equal(protectedResult.applied, false);
  assert.equal(protectedResult.rejectedReason, 'spawn_protection');
  assert.equal(target.health, 100);

  const bypassResult = applyDamage({
    adapter: adapter(players),
    damageHistory: new Map(),
    now: 2_000,
    assistWindowMs: 10_000,
  }, {
    target,
    source: null,
    rawDamage: 10,
    damageType: 'safe_zone',
    bypassSpawnProtection: true,
    bypassPersonalShield: true,
  });

  assert.equal(bypassResult.applied, true);
  assert.equal(bypassResult.damage, 10);
  assert.equal(target.health, 90);
}

{
  // Body shield absorbs fully; health untouched, hit still counts as applied.
  const target = player('target', 'blue', { shield: 50, maxShield: 50 });
  const source = player('source', 'red');
  const players = new Map([target, source].map((entry) => [entry.id, entry]));
  const result = applyDamage({
    adapter: adapter(players),
    damageHistory: new Map(),
    now: 1_000,
    assistWindowMs: 10_000,
  }, {
    target,
    source,
    rawDamage: 30,
    damageType: 'shield_test',
  });

  assert.equal(result.applied, true);
  assert.equal(result.shieldDamage, 30);
  assert.equal(result.newShield, 20);
  assert.equal(result.shieldBroken, false);
  assert.equal(target.shield, 20);
  assert.equal(target.health, 100);
  assert.equal(result.newHealth, 100);
}

{
  // Body shield breaks and the remainder carries into health in one hit.
  const target = player('target', 'blue', { shield: 50, maxShield: 50 });
  const source = player('source', 'red');
  const players = new Map([target, source].map((entry) => [entry.id, entry]));
  const result = applyDamage({
    adapter: adapter(players),
    damageHistory: new Map(),
    now: 1_000,
    assistWindowMs: 10_000,
  }, {
    target,
    source,
    rawDamage: 70,
    damageType: 'shield_test',
  });

  assert.equal(result.shieldDamage, 50);
  assert.equal(result.newShield, 0);
  assert.equal(result.shieldBroken, true);
  assert.equal(result.appliedDamage, 70);
  assert.equal(target.shield, 0);
  assert.equal(target.health, 80);
}

{
  // bypassShield (safe-zone ring damage) hits health directly.
  const target = player('target', 'blue', { shield: 50, maxShield: 50 });
  const players = new Map([[target.id, target]]);
  const result = applyDamage({
    adapter: adapter(players),
    damageHistory: new Map(),
    now: 1_000,
    assistWindowMs: 10_000,
  }, {
    target,
    rawDamage: 25,
    damageType: 'safe_zone',
    bypassShield: true,
  });

  assert.equal(result.shieldDamage, 0);
  assert.equal(target.shield, 50);
  assert.equal(target.health, 75);
}

{
  // Raised knockdown shield absorbs downed damage and deactivates when broken.
  const target = player('target', 'blue', {
    state: 'downed',
    health: 0,
    downedHealth: BATTLE_ROYAL_DOWNED_MAX_HP,
    knockdownShieldHealth: 40,
    knockdownShieldMaxHealth: 150,
    knockdownShieldActive: true,
  });
  const source = player('source', 'red');
  const players = new Map([target, source].map((entry) => [entry.id, entry]));
  const result = applyDamage({
    adapter: adapter(players),
    damageHistory: new Map(),
    now: 1_000,
    assistWindowMs: 10_000,
    damageDownedPlayers: true,
  }, {
    target,
    source,
    rawDamage: 60,
    damageType: 'shield_test',
  });

  assert.equal(result.shieldDamage, 40);
  assert.equal(result.shieldBroken, true);
  assert.equal(target.knockdownShieldHealth, 0);
  assert.equal(target.knockdownShieldActive, false);
  assert.equal(target.downedHealth, BATTLE_ROYAL_DOWNED_MAX_HP - 20);
}

{
  // Unraised knockdown shield offers no protection.
  const target = player('target', 'blue', {
    state: 'downed',
    health: 0,
    downedHealth: BATTLE_ROYAL_DOWNED_MAX_HP,
    knockdownShieldHealth: 150,
    knockdownShieldMaxHealth: 150,
    knockdownShieldActive: false,
  });
  const source = player('source', 'red');
  const players = new Map([target, source].map((entry) => [entry.id, entry]));
  const result = applyDamage({
    adapter: adapter(players),
    damageHistory: new Map(),
    now: 1_000,
    assistWindowMs: 10_000,
    damageDownedPlayers: true,
  }, {
    target,
    source,
    rawDamage: 30,
    damageType: 'shield_test',
  });

  assert.equal(result.shieldDamage, 0);
  assert.equal(target.knockdownShieldHealth, 150);
  assert.equal(target.downedHealth, BATTLE_ROYAL_DOWNED_MAX_HP - 30);
}

{
  assert.equal(calculateFalloffDamage(50, 0, 10, 0.5), 50);
  assert.equal(calculateFalloffDamage(50, 10, 10, 0.5), 25);

  const ticks = new Map();
  assert.equal(shouldApplyDamageTick(ticks, 'a', 100, 1000), true);
  assert.equal(shouldApplyDamageTick(ticks, 'a', 100, 1050), false);
  assert.equal(shouldApplyDamageTick(ticks, 'a', 100, 1100), true);
}

{
  const hit = getAimConeHitAgainstPlayerCombatHitbox(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    10,
    Math.cos(0.2),
    { position: { x: 0, y: 0, z: 5 }, heroId: 'phantom' }
  );
  assert.ok(hit);

  const miss = getAimConeHitAgainstPlayerCombatHitbox(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    10,
    Math.cos(0.05),
    { position: { x: 5, y: 0, z: 5 }, heroId: 'phantom' }
  );
  assert.equal(miss, null);
}

console.log('damage engine tests passed');
