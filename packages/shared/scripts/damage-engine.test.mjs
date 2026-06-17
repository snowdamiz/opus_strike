import assert from 'node:assert/strict';
import {
  applyDamage,
  calculateFalloffDamage,
  shouldApplyDamageTick,
} from '../dist/index.js';

function player(id, team, overrides = {}) {
  return {
    id,
    team,
    state: 'alive',
    health: 100,
    maxHealth: 100,
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
    getSpawnProtectionUntil: (entry) => entry.spawnProtectionUntil,
    getUltimateCharge: (entry) => entry.ultimateCharge,
    setUltimateCharge: (entry, charge) => {
      entry.ultimateCharge = charge;
    },
    getPersonalShieldState: (entry) => entry.shieldActive ? { isActive: true } : null,
    deactivatePersonalShield: (entry) => {
      entry.shieldActive = false;
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
  assert.equal(calculateFalloffDamage(50, 0, 10, 0.5), 50);
  assert.equal(calculateFalloffDamage(50, 10, 10, 0.5), 25);

  const ticks = new Map();
  assert.equal(shouldApplyDamageTick(ticks, 'a', 100, 1000), true);
  assert.equal(shouldApplyDamageTick(ticks, 'a', 100, 1050), false);
  assert.equal(shouldApplyDamageTick(ticks, 'a', 100, 1100), true);
}

console.log('damage engine tests passed');
