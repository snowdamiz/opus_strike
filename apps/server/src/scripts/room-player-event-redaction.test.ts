import assert from 'node:assert/strict';
import type {
  ChronosAegisDamagedEvent,
  PhantomShieldBrokenEvent,
  PlayerDamagedEvent,
  PlayerDeathEvent,
  PlayerHealedEvent,
  PowerupCollectedMessage,
} from '@voxel-strike/shared';
import {
  buildChronosAegisDamagedPayload,
  buildPhantomShieldBrokenPayload,
  buildPlayerDamagedPayload,
  buildPlayerHealedPayload,
  buildPlayerKilledPayload,
  buildPowerupCollectedPayload,
  shouldIncludePlayerJoinPosition,
} from '../rooms/roomPlayerEventRedaction';

const position = { x: 10, y: 2, z: -8 };
const sourcePosition = { x: 5, y: 2, z: -3 };
const coarsePosition = { x: 12, y: 2, z: -12 };

const damagePayload: PlayerDamagedEvent = {
  targetId: 'target',
  damage: 25,
  sourceId: 'source',
  damageType: 'primary',
  newHealth: 75,
  sourcePosition,
  targetPosition: position,
  sourceHeroId: 'phantom',
  targetHeroId: 'blaze',
};

{
  assert.equal(buildPlayerDamagedPayload(damagePayload, {
    isParticipant: false,
    canKnowTarget: false,
    canKnowSource: false,
  }), null);

  assert.deepEqual(buildPlayerDamagedPayload(damagePayload, {
    isParticipant: false,
    canKnowTarget: true,
    canKnowSource: false,
  }), {
    targetId: 'target',
    damage: 25,
    sourceId: 'source',
    damageType: 'primary',
    newHealth: 75,
    sourcePosition: undefined,
    targetPosition: position,
    sourceHeroId: null,
    targetHeroId: 'blaze',
  });

  assert.deepEqual(buildPlayerDamagedPayload(damagePayload, {
    isParticipant: true,
    canKnowTarget: false,
    canKnowSource: false,
  }), damagePayload);
}

const aegisPayload: ChronosAegisDamagedEvent = {
  playerId: 'blocker',
  sourceId: 'source',
  damage: 30,
  damageType: 'rocket',
  shieldHp: 120,
  shieldRatio: 0.5,
  position,
  direction: { x: 0, y: 0, z: -1 },
  serverTime: 1000,
};

{
  assert.equal(buildChronosAegisDamagedPayload(aegisPayload, {
    isParticipant: false,
    canKnowBlocker: false,
    canKnowSource: true,
  }), null);

  assert.deepEqual(buildChronosAegisDamagedPayload(aegisPayload, {
    isParticipant: false,
    canKnowBlocker: true,
    canKnowSource: false,
  }), {
    ...aegisPayload,
    sourceId: null,
  });
}

const shieldPayload: PhantomShieldBrokenEvent = {
  playerId: 'target',
  position,
  direction: { x: 1, y: 0, z: 0 },
  serverTime: 2000,
};

{
  assert.equal(buildPhantomShieldBrokenPayload(shieldPayload, {
    isParticipant: false,
    canKnowTarget: false,
  }), null);
  assert.equal(buildPhantomShieldBrokenPayload(shieldPayload, {
    isParticipant: false,
    canKnowTarget: true,
  }), shieldPayload);
}

const healPayload: PlayerHealedEvent = {
  sourceId: 'source',
  abilityId: 'chronos_lifeline',
  sourcePosition,
  targets: [
    { targetId: 'visible', amount: 20, newHealth: 90, position },
    { targetId: 'hidden', amount: 10, newHealth: 80, position: { x: 1, y: 2, z: 3 } },
  ],
  timestamp: 3000,
};

{
  assert.deepEqual(buildPlayerHealedPayload(healPayload, new Set(['visible'])), {
    ...healPayload,
    targets: [healPayload.targets[0]],
  });
  assert.equal(buildPlayerHealedPayload(healPayload, new Set()), null);
}

const powerupPayload: PowerupCollectedMessage = {
  pickupId: 'speed-a',
  kind: 'powerup',
  playerId: 'collector',
  position,
  availableAt: 9000,
  expiresAt: 6000,
  healthRestored: 25,
  serverTime: 4000,
};

{
  assert.deepEqual(buildPowerupCollectedPayload(powerupPayload, true), powerupPayload);
  assert.deepEqual(buildPowerupCollectedPayload(powerupPayload, false), {
    ...powerupPayload,
    playerId: null,
    expiresAt: null,
    healthRestored: undefined,
  });
}

const deathPayload: PlayerDeathEvent = {
  victimId: 'victim',
  killerId: 'killer',
  assistIds: ['assist'],
  abilityId: 'rocket',
  position,
  velocity: { x: 1, y: 0, z: 0 },
  sourcePosition,
  sourceDirection: { x: 0, y: 0, z: -1 },
  damageType: 'rocket',
  occurredAt: 5000,
  respawnTime: 8000,
};

{
  assert.equal(buildPlayerKilledPayload(deathPayload, {
    isParticipant: true,
    canKnowTarget: false,
    canKnowSource: false,
  }, coarsePosition), deathPayload);

  assert.deepEqual(buildPlayerKilledPayload(deathPayload, {
    isParticipant: false,
    canKnowTarget: false,
    canKnowSource: true,
  }, coarsePosition), {
    ...deathPayload,
    position: coarsePosition,
    velocity: undefined,
    sourcePosition,
    sourceDirection: { x: 0, y: 0, z: -1 },
    respawnTime: null,
  });

  assert.deepEqual(buildPlayerKilledPayload(deathPayload, {
    isParticipant: false,
    canKnowTarget: true,
    canKnowSource: false,
  }, coarsePosition), {
    ...deathPayload,
    sourcePosition: undefined,
    sourceDirection: undefined,
    respawnTime: null,
  });
}

{
  assert.equal(shouldIncludePlayerJoinPosition({
    recipientId: null,
    targetId: 'target',
    targetTeam: 'red',
    phase: 'playing',
  }), true);
  assert.equal(shouldIncludePlayerJoinPosition({
    recipientId: 'target',
    recipientTeam: 'blue',
    targetId: 'target',
    targetTeam: 'red',
    phase: 'countdown',
  }), true);
  assert.equal(shouldIncludePlayerJoinPosition({
    recipientId: 'ally',
    recipientTeam: 'red',
    targetId: 'target',
    targetTeam: 'red',
    phase: 'playing',
  }), true);
  assert.equal(shouldIncludePlayerJoinPosition({
    recipientId: 'enemy',
    recipientTeam: 'blue',
    targetId: 'target',
    targetTeam: 'red',
    phase: 'playing',
  }), false);
  assert.equal(shouldIncludePlayerJoinPosition({
    recipientId: 'enemy',
    recipientTeam: 'blue',
    targetId: 'target',
    targetTeam: 'red',
    phase: 'hero_select',
  }), true);
}

console.log('room player event redaction tests passed');
