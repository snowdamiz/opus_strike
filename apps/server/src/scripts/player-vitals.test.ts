import assert from 'node:assert/strict';
import type { PlayerVitalsSnapshot } from '@voxel-strike/shared';
import {
  buildFullPlayerVitalsSnapshot,
  buildPlayerVitalsAbilities,
  buildPlayerMovementVitals,
  buildPlayerVitalsStats,
  buildPublicEnemyVitalsSnapshot,
  buildVisibleEnemyVitalsSnapshot,
  getDefaultPublicMovementVitals,
  getPlayerVitalsCooldownUntil,
  getPublicEnemyVitalsState,
  haveVitalsChanged,
  removeMissingKnownPlayerVitals,
  selectChangedPlayerVitalsSnapshot,
  selectPlayerVitalsForRecipient,
} from '../rooms/playerVitals';

function vitals(overrides: Partial<PlayerVitalsSnapshot> = {}): PlayerVitalsSnapshot {
  return {
    id: 'player-a',
    netId: 1,
    name: 'Player A',
    team: 'red',
    heroId: 'phantom',
    skinId: undefined,
    state: 'alive',
    isReady: true,
    isBot: false,
    rank: undefined,
    health: 80,
    maxHealth: 100,
    shield: 20,
    maxShield: 50,
    downedHealth: null,
    downedMaxHealth: null,
    downedStartedAt: null,
    downedRemainingMs: null,
    downedExpiresAt: null,
    reviveStartedAt: null,
    reviveCompletesAt: null,
    reviveByPlayerId: null,
    knockdownShieldHealth: null,
    knockdownShieldMaxHealth: null,
    knockdownShieldActive: false,
    ultimateCharge: 65,
    onFireUntil: 12_000,
    powerupBoostUntil: 13_000,
    hasFlag: true,
    movement: getDefaultPublicMovementVitals(),
    abilities: {
      active: {
        abilityId: 'active',
        cooldownUntil: 2_000,
        charges: 2,
        isActive: true,
        activatedAt: 1_000,
      },
      inactive: {
        abilityId: 'inactive',
        cooldownUntil: 3_000,
        charges: 1,
        isActive: false,
      },
    },
    stats: {
      kills: 1,
      deaths: 2,
      assists: 3,
      flagCaptures: 4,
      flagReturns: 5,
    },
    respawnTime: 9_000,
    spawnProtectionUntil: 10_000,
    visibility: 'visible',
    ...overrides,
  };
}

{
  const full = vitals({ id: 'full', visibility: 'visible' });
  const visible = vitals({ id: 'visible', visibility: 'visible', health: 60 });
  const hidden = vitals({ id: 'hidden', visibility: 'hidden', health: 100 });
  const calls = {
    full: 0,
    visible: 0,
    public: 0,
  };
  const caches = {
    fullVitalsByPlayer: new Map<string, PlayerVitalsSnapshot>(),
    visibleEnemyVitalsByPlayer: new Map<string, PlayerVitalsSnapshot>(),
    publicEnemyVitalsByPlayer: new Map<string, PlayerVitalsSnapshot>(),
  };
  const builders = {
    buildFull: () => {
      calls.full++;
      return full;
    },
    buildVisible: (visibility: PlayerVitalsSnapshot['visibility']) => {
      calls.visible++;
      return { ...visible, visibility };
    },
    buildPublic: (visibility: PlayerVitalsSnapshot['visibility']) => {
      calls.public++;
      return { ...hidden, visibility };
    },
  };

  assert.equal(selectPlayerVitalsForRecipient({
    targetId: 'target',
    targetTeam: 'red',
    recipientId: null,
    recipientTeam: null,
    visibility: 'hidden',
    caches,
    ...builders,
  }), full);
  assert.deepEqual(calls, { full: 1, visible: 0, public: 0 });

  assert.equal(selectPlayerVitalsForRecipient({
    targetId: 'target',
    targetTeam: 'red',
    recipientId: 'ally',
    recipientTeam: 'red',
    visibility: 'hidden',
    caches,
    ...builders,
  }), full);
  assert.deepEqual(calls, { full: 1, visible: 0, public: 0 });

  assert.deepEqual(selectPlayerVitalsForRecipient({
    targetId: 'target',
    targetTeam: 'red',
    recipientId: 'enemy',
    recipientTeam: 'blue',
    visibility: 'visible',
    caches,
    ...builders,
  }), visible);
  assert.deepEqual(calls, { full: 1, visible: 1, public: 0 });

  assert.deepEqual(selectPlayerVitalsForRecipient({
    targetId: 'target',
    targetTeam: 'red',
    recipientId: 'enemy',
    recipientTeam: 'blue',
    visibility: 'hidden',
    caches,
    ...builders,
  }), hidden);
  assert.deepEqual(calls, { full: 1, visible: 1, public: 1 });

  assert.deepEqual(selectPlayerVitalsForRecipient({
    targetId: 'target',
    targetTeam: 'red',
    recipientId: 'enemy',
    recipientTeam: 'blue',
    visibility: 'hidden',
    caches,
    ...builders,
  }), hidden);
  assert.deepEqual(calls, { full: 1, visible: 1, public: 1 });

  assert.deepEqual(selectPlayerVitalsForRecipient({
    targetId: 'target',
    targetTeam: 'red',
    recipientId: 'enemy',
    recipientTeam: 'blue',
    visibility: 'audible',
    caches,
    ...builders,
  }), {
    ...hidden,
    visibility: 'audible',
  });
  assert.deepEqual(calls, { full: 1, visible: 1, public: 2 });
  assert.equal(caches.publicEnemyVitalsByPlayer.size, 2);
}

{
  const state = {
    signatures: new Map<string, PlayerVitalsSnapshot>(),
    reconcileAt: new Map<string, number>(),
    knownPlayerIds: new Set<string>(),
  };
  const base = vitals({ id: 'delta' });

  assert.equal(selectChangedPlayerVitalsSnapshot({
    state,
    playerId: 'delta',
    vitals: base,
    now: 1_000,
    force: false,
    reconcileIntervalMs: 5_000,
  }), base);
  assert.equal(state.knownPlayerIds.has('delta'), true);
  assert.equal(state.signatures.get('delta'), base);
  assert.equal(state.reconcileAt.get('delta'), 1_000);

  assert.equal(selectChangedPlayerVitalsSnapshot({
    state,
    playerId: 'delta',
    vitals: base,
    now: 2_000,
    force: false,
    reconcileIntervalMs: 5_000,
  }), null);

  assert.equal(selectChangedPlayerVitalsSnapshot({
    state,
    playerId: 'delta',
    vitals: base,
    now: 6_000,
    force: false,
    reconcileIntervalMs: 5_000,
  }), base);
  assert.equal(state.reconcileAt.get('delta'), 6_000);

  const changed = vitals({ id: 'delta', health: 72 });
  assert.equal(selectChangedPlayerVitalsSnapshot({
    state,
    playerId: 'delta',
    vitals: changed,
    now: 6_100,
    force: false,
    reconcileIntervalMs: 5_000,
  }), changed);

  assert.equal(selectChangedPlayerVitalsSnapshot({
    state,
    playerId: 'delta',
    vitals: changed,
    now: 6_200,
    force: true,
    reconcileIntervalMs: 5_000,
  }), changed);
}

{
  const state = {
    signatures: new Map<string, PlayerVitalsSnapshot>([
      ['stale', vitals({ id: 'stale' })],
      ['current', vitals({ id: 'current' })],
    ]),
    reconcileAt: new Map<string, number>([
      ['stale', 1_000],
      ['current', 1_000],
    ]),
    knownPlayerIds: new Set(['stale', 'current']),
  };

  assert.deepEqual(removeMissingKnownPlayerVitals(state, new Set(['current'])), ['stale']);
  assert.deepEqual([...state.knownPlayerIds], ['current']);
  assert.equal(state.signatures.has('stale'), false);
  assert.equal(state.reconcileAt.has('stale'), false);
  assert.equal(state.signatures.has('current'), true);
}

{
  assert.equal(getPlayerVitalsCooldownUntil({ cooldownRemaining: 0 }, 1_000), 0);
  assert.equal(getPlayerVitalsCooldownUntil({ cooldownRemaining: -1 }, 1_000), 0);
  assert.equal(getPlayerVitalsCooldownUntil({ cooldownRemaining: 1.234 }, 1_000), 2_200);
}

{
  const abilities = new Map([
    ['primary', {
      abilityId: 'phantom_dire_ball',
      cooldownRemaining: 1.2,
      charges: 2,
      isActive: false,
      activatedAt: 0,
    }],
    ['shield', {
      abilityId: 'phantom_personal_shield',
      cooldownRemaining: 0,
      charges: 1,
      isActive: true,
      activatedAt: 500,
    }],
  ]);

  assert.deepEqual(buildPlayerVitalsAbilities(abilities, 1_000), {
    primary: {
      abilityId: 'phantom_dire_ball',
      cooldownUntil: 2_200,
      charges: 2,
      isActive: false,
      activatedAt: 0,
    },
    shield: {
      abilityId: 'phantom_personal_shield',
      cooldownUntil: 0,
      charges: 1,
      isActive: true,
      activatedAt: 500,
    },
  });
}

{
  const movement = {
    isGrounded: false,
    isSprinting: true,
    isCrouching: false,
    isSliding: true,
    slideTimeRemaining: 120,
    isWallRunning: true,
    wallRunSide: 'left',
    isGrappling: true,
    isJetpacking: true,
    jetpackFuel: 0.5,
    isGliding: true,
    chronosAscendantStartY: 4,
  };
  const stats = {
    kills: 1,
    deaths: 2,
    assists: 3,
    flagCaptures: 4,
    flagReturns: 5,
  };
  const full = buildFullPlayerVitalsSnapshot({
    id: 'player-a',
    netId: 7,
    name: 'Player A',
    team: 'red',
    heroId: 'phantom',
    skinId: undefined,
    state: 'alive',
    isReady: true,
    isBot: true,
    botDifficulty: 'hard',
    botProfileId: 'bot-profile-a',
    rank: undefined,
    health: 80,
    maxHealth: 100,
    shield: 12,
    maxShield: 50,
    downedHealth: 21,
    downedMaxHealth: 30,
    downedStartedAt: 11_000,
    downedRemainingMs: 42_000,
    downedExpiresAt: 53_000,
    reviveStartedAt: 12_000,
    reviveCompletesAt: 17_000,
    reviveByPlayerId: 'ally-a',
    knockdownShieldHealth: 45,
    knockdownShieldMaxHealth: 150,
    knockdownShieldActive: true,
    ultimateCharge: 65,
    onFireUntil: 12_000,
    powerupBoostUntil: 13_000,
    hasFlag: true,
    movement,
    abilities: new Map([
      ['blink', {
        abilityId: 'phantom_blink',
        cooldownRemaining: 1,
        charges: 1,
        isActive: false,
      }],
    ]),
    stats,
    respawnTime: 9_000,
    spawnProtectionUntil: 10_000,
    visibility: 'visible',
    now: 1_000,
  });

  assert.deepEqual(full, {
    id: 'player-a',
    netId: 7,
    name: 'Player A',
    team: 'red',
    heroId: 'phantom',
    skinId: undefined,
    state: 'alive',
    isReady: true,
    isBot: true,
    botDifficulty: 'hard',
    botProfileId: 'bot-profile-a',
    rank: undefined,
    health: 80,
    maxHealth: 100,
    shield: 12,
    maxShield: 50,
    downedHealth: 21,
    downedMaxHealth: 30,
    downedStartedAt: 11_000,
    downedRemainingMs: 42_000,
    downedExpiresAt: 53_000,
    reviveStartedAt: 12_000,
    reviveCompletesAt: 17_000,
    reviveByPlayerId: 'ally-a',
    knockdownShieldHealth: 45,
    knockdownShieldMaxHealth: 150,
    knockdownShieldActive: true,
    ultimateCharge: 65,
    onFireUntil: 12_000,
    powerupBoostUntil: 13_000,
    hasFlag: true,
    movement: buildPlayerMovementVitals(movement),
    abilities: {
      blink: {
        abilityId: 'phantom_blink',
        cooldownUntil: 2_000,
        charges: 1,
        isActive: false,
        activatedAt: undefined,
      },
    },
    stats,
    respawnTime: 9_000,
    spawnProtectionUntil: 10_000,
    visibility: 'visible',
  });
}

{
  assert.deepEqual(buildPlayerMovementVitals({
    isGrounded: false,
    isSprinting: true,
    isCrouching: false,
    isSliding: true,
    slideTimeRemaining: 120,
    isWallRunning: true,
    wallRunSide: 'left',
    isGrappling: true,
    isJetpacking: true,
    jetpackFuel: 0.5,
    isGliding: true,
    chronosAscendantStartY: 4,
  }), {
    isGrounded: false,
    isSprinting: true,
    isCrouching: false,
    isSliding: true,
    slideTimeRemaining: 120,
    isWallRunning: true,
    wallRunSide: 'left',
    isGrappling: true,
    grapplePoint: null,
    isJetpacking: true,
    jetpackFuel: 0.5,
    isGliding: true,
    chronosAscendantStartY: 4,
  });

  assert.deepEqual(buildPlayerMovementVitals({
    ...getDefaultPublicMovementVitals(),
    wallRunSide: 'center',
    chronosAscendantStartY: 0,
  }), {
    ...getDefaultPublicMovementVitals(),
    chronosAscendantStartY: undefined,
  });
}

{
  assert.deepEqual(buildPlayerVitalsStats({
    kills: 1,
    deaths: 2,
    assists: 3,
    flagCaptures: 4,
    flagReturns: 5,
  }), {
    kills: 1,
    deaths: 2,
    assists: 3,
    flagCaptures: 4,
    flagReturns: 5,
  });
}

{
  const masked = buildVisibleEnemyVitalsSnapshot(vitals({
    state: 'downed',
    downedHealth: 16,
    downedMaxHealth: 30,
    downedStartedAt: 11_000,
    downedRemainingMs: 42_000,
    downedExpiresAt: 53_000,
    reviveStartedAt: 12_000,
    reviveCompletesAt: 17_000,
    reviveByPlayerId: 'ally-a',
    shield: 13,
    maxShield: 50,
    knockdownShieldHealth: 90,
    knockdownShieldMaxHealth: 150,
    knockdownShieldActive: true,
  }), 'last_known');

  assert.equal(masked.state, 'downed');
  assert.equal(masked.ultimateCharge, 0);
  assert.deepEqual(masked.abilities, {
    active: {
      abilityId: 'active',
      cooldownUntil: 0,
      charges: 0,
      isActive: true,
      activatedAt: 1_000,
    },
  });
  assert.equal(masked.respawnTime, null);
  assert.equal(masked.spawnProtectionUntil, null);
  assert.equal(masked.visibility, 'last_known');
  assert.equal(masked.health, 80);
  assert.equal(masked.shield, 13);
  assert.equal(masked.maxShield, 50);
  assert.equal(masked.downedHealth, 16);
  assert.equal(masked.downedMaxHealth, 30);
  assert.equal(masked.downedStartedAt, null);
  assert.equal(masked.downedRemainingMs, null);
  assert.equal(masked.downedExpiresAt, null);
  assert.equal(masked.reviveStartedAt, null);
  assert.equal(masked.reviveCompletesAt, null);
  assert.equal(masked.reviveByPlayerId, null);
  assert.equal(masked.knockdownShieldHealth, 90);
  assert.equal(masked.knockdownShieldMaxHealth, 150);
  assert.equal(masked.knockdownShieldActive, true);
  assert.equal(masked.hasFlag, true);
}

{
  assert.equal(getPublicEnemyVitalsState('dead'), 'dead');
  assert.equal(getPublicEnemyVitalsState('downed'), 'downed');
  assert.equal(getPublicEnemyVitalsState('alive'), 'alive');
  assert.equal(getPublicEnemyVitalsState('spawning'), 'alive');
  assert.equal(getPublicEnemyVitalsState('selecting'), 'alive');
}

{
  const stats = {
    kills: 7,
    deaths: 1,
    assists: 2,
    flagCaptures: 3,
    flagReturns: 4,
  };
  const publicVitals = buildPublicEnemyVitalsSnapshot({
    id: 'enemy-a',
    netId: 44,
    name: 'Enemy A',
    team: 'blue',
    heroId: 'blaze',
    state: 'spawning',
    isReady: true,
    isBot: true,
    botDifficulty: 'hard',
    botProfileId: 'profile-a',
    rank: undefined,
    maxHealth: 150,
    stats,
    visibility: 'hidden',
  });

  assert.deepEqual(publicVitals, {
    id: 'enemy-a',
    netId: 44,
    name: 'Enemy A',
    team: 'blue',
    heroId: 'blaze',
    skinId: undefined,
    state: 'alive',
    isReady: true,
    isBot: true,
    botDifficulty: 'hard',
    botProfileId: 'profile-a',
    rank: undefined,
    health: 150,
    maxHealth: 150,
    shield: 0,
    maxShield: 0,
    downedHealth: null,
    downedMaxHealth: null,
    downedStartedAt: null,
    downedRemainingMs: null,
    downedExpiresAt: null,
    reviveStartedAt: null,
    reviveCompletesAt: null,
    reviveByPlayerId: null,
    knockdownShieldHealth: null,
    knockdownShieldMaxHealth: null,
    knockdownShieldActive: false,
    ultimateCharge: 0,
    onFireUntil: null,
    powerupBoostUntil: null,
    hasFlag: false,
    movement: getDefaultPublicMovementVitals(),
    abilities: {},
    stats,
    respawnTime: null,
    spawnProtectionUntil: null,
    visibility: 'hidden',
  });
}

{
  const base = vitals();
  assert.equal(haveVitalsChanged(undefined, base), true);
  assert.equal(haveVitalsChanged(base, vitals()), false);
  assert.equal(haveVitalsChanged(base, vitals({ role: 'observer' })), true);
  assert.equal(haveVitalsChanged(base, vitals({ ultimateCharge: 65.4 })), false);
  assert.equal(haveVitalsChanged(base, vitals({ ultimateCharge: 66 })), true);
  assert.equal(haveVitalsChanged(base, vitals({ skinId: 'phantom.default' })), true);
  assert.equal(haveVitalsChanged(base, vitals({ shield: 19 })), true);
  assert.equal(haveVitalsChanged(base, vitals({ downedHealth: 29 })), true);
  assert.equal(haveVitalsChanged(base, vitals({
    movement: {
      ...base.movement,
      isSprinting: true,
    },
  })), false);
  assert.equal(haveVitalsChanged(base, vitals({
    state: 'dead',
    movement: {
      ...base.movement,
      isSprinting: true,
    },
  })), true);
}

console.log('player vitals tests passed');
