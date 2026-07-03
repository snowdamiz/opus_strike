import assert from 'node:assert/strict';
import {
  areHumansSceneReadyForCountdown,
  arePlayersReadyForCountdown,
  buildMatchStartGatePayload,
  canMarkMatchSceneReady,
  countConnectedHumanPlayers,
  hasRequiredHumanPlayersConnected,
  MatchStartGateTracker,
  readMatchSceneReadyGateKey,
  shouldOpenCountdownStartGate,
  shouldStartCountdownAfterSceneReady,
  type MatchStartReadinessPlayer,
} from '../rooms/matchStartReadiness';

const readyPlayers = new Map<string, MatchStartReadinessPlayer>([
  ['human-red', { isBot: false, heroId: 'phantom', isReady: true }],
  ['human-blue', { isBot: false, heroId: 'hookshot', isReady: true }],
  ['bot-red', { isBot: true, heroId: 'blaze', isReady: true }],
]);

assert.equal(countConnectedHumanPlayers(readyPlayers.values()), 2);
assert.equal(hasRequiredHumanPlayersConnected(readyPlayers.values(), 2), true);
assert.equal(hasRequiredHumanPlayersConnected(readyPlayers.values(), 3), false);

assert.equal(readMatchSceneReadyGateKey({ key: 7 }), 7);
assert.equal(readMatchSceneReadyGateKey({ key: -1 }), -1);
assert.equal(readMatchSceneReadyGateKey({ key: 7.5 }), null);
assert.equal(readMatchSceneReadyGateKey({ key: Number.NaN }), null);
assert.equal(readMatchSceneReadyGateKey({ key: '7' }), null);
assert.equal(readMatchSceneReadyGateKey([]), null);
assert.equal(readMatchSceneReadyGateKey(null), null);

assert.equal(canMarkMatchSceneReady(null), false);
assert.equal(canMarkMatchSceneReady({ isBot: true, heroId: 'blaze', isReady: true }), false);
assert.equal(canMarkMatchSceneReady({ isBot: false, heroId: '', isReady: true }), false);
assert.equal(canMarkMatchSceneReady({ isBot: false, heroId: 'phantom', isReady: false }), false);
assert.equal(canMarkMatchSceneReady({ isBot: false, heroId: 'phantom', isReady: true }), true);

assert.equal(arePlayersReadyForCountdown({
  players: readyPlayers.values(),
  requiredHumanPlayers: 2,
}), true);

assert.equal(arePlayersReadyForCountdown({
  players: readyPlayers.values(),
  requiredHumanPlayers: 3,
}), false);

assert.equal(arePlayersReadyForCountdown({
  players: [],
  requiredHumanPlayers: 0,
}), false);

assert.equal(arePlayersReadyForCountdown({
  players: [
    { isBot: false, heroId: 'phantom', isReady: true },
    { isBot: false, heroId: '', isReady: true },
  ],
  requiredHumanPlayers: 2,
}), false);

assert.equal(arePlayersReadyForCountdown({
  players: [
    { isBot: false, heroId: 'phantom', isReady: true },
    { isBot: true, heroId: 'blaze', isReady: false },
  ],
  requiredHumanPlayers: 1,
}), false);

assert.equal(shouldOpenCountdownStartGate({
  playersReadyForCountdown: false,
  countdownStartGateOpen: false,
}), false);
assert.equal(shouldOpenCountdownStartGate({
  playersReadyForCountdown: true,
  countdownStartGateOpen: true,
}), false);
assert.equal(shouldOpenCountdownStartGate({
  playersReadyForCountdown: true,
  countdownStartGateOpen: false,
}), true);

assert.equal(shouldStartCountdownAfterSceneReady({
  playersReadyForCountdown: false,
  humansSceneReadyForCountdown: true,
}), false);
assert.equal(shouldStartCountdownAfterSceneReady({
  playersReadyForCountdown: true,
  humansSceneReadyForCountdown: false,
}), false);
assert.equal(shouldStartCountdownAfterSceneReady({
  playersReadyForCountdown: true,
  humansSceneReadyForCountdown: true,
}), true);

assert.equal(areHumansSceneReadyForCountdown({
  players: readyPlayers,
  connectedClientIds: new Set(['human-red', 'human-blue']),
  sceneReadyPlayerIds: new Set(['human-red', 'human-blue']),
  countdownStartGateOpen: true,
  requiredHumanPlayers: 2,
}), true);

assert.equal(areHumansSceneReadyForCountdown({
  players: readyPlayers,
  connectedClientIds: new Set(['human-red', 'human-blue']),
  sceneReadyPlayerIds: new Set(['human-red', 'human-blue']),
  countdownStartGateOpen: false,
  requiredHumanPlayers: 2,
}), false);

assert.equal(areHumansSceneReadyForCountdown({
  players: readyPlayers,
  connectedClientIds: new Set(['human-red', 'human-blue']),
  sceneReadyPlayerIds: new Set(['human-red']),
  countdownStartGateOpen: true,
  requiredHumanPlayers: 2,
}), false);

assert.equal(areHumansSceneReadyForCountdown({
  players: readyPlayers,
  connectedClientIds: new Set(['human-red']),
  sceneReadyPlayerIds: new Set(['human-red', 'human-blue']),
  countdownStartGateOpen: true,
  requiredHumanPlayers: 2,
}), false);

assert.equal(areHumansSceneReadyForCountdown({
  players: new Map([['bot-red', { isBot: true, heroId: 'blaze', isReady: true }]]),
  connectedClientIds: new Set(),
  sceneReadyPlayerIds: new Set(),
  countdownStartGateOpen: true,
  requiredHumanPlayers: 0,
}), true);

assert.deepEqual(
  buildMatchStartGatePayload({
    key: 7,
    serverTime: 12_345,
    mapSeed: 99,
    mapThemeId: 'verdant',
    mapSize: 'medium',
    mapProfileId: 'battle_royal_large',
    pregeneratedMapId: null,
    mapArtifactId: null,
    position: { x: 1, y: 2, z: 3 },
    movementEpoch: 4,
    ackSeq: 5,
    collisionRevision: 6,
  }),
  {
    key: 7,
    serverTime: 12_345,
    mapSeed: 99,
    mapThemeId: 'verdant',
    mapSize: 'medium',
    mapProfileId: 'battle_royal_large',
    pregeneratedMapId: null,
    mapArtifactId: null,
    position: { x: 1, y: 2, z: 3 },
    movementEpoch: 4,
    ackSeq: 5,
    collisionRevision: 6,
  }
);

assert.equal(
  buildMatchStartGatePayload({
    key: 8,
    serverTime: 12_345,
    mapSeed: 99,
    mapThemeId: 'verdant',
    mapSize: 'medium',
    position: { x: 1, y: 2, z: 3 },
    movementEpoch: 4,
    ackSeq: 5,
    collisionRevision: 6,
  }).mapProfileId,
  'ctf_arena'
);

const pregeneratedGatePayload = buildMatchStartGatePayload({
  key: 9,
  serverTime: 12_345,
  mapSeed: 99,
  mapThemeId: 'verdant',
  mapSize: 'medium',
  pregeneratedMapId: 'pgmap_gate',
  mapArtifactId: 'pgartifact_gate',
  position: { x: 1, y: 2, z: 3 },
  movementEpoch: 4,
  ackSeq: 5,
  collisionRevision: 6,
});
assert.deepEqual({
  pregeneratedMapId: pregeneratedGatePayload.pregeneratedMapId,
  mapArtifactId: pregeneratedGatePayload.mapArtifactId,
}, {
  pregeneratedMapId: 'pgmap_gate',
  mapArtifactId: 'pgartifact_gate',
});

{
  const gate = new MatchStartGateTracker();

  assert.equal(gate.key, 0);
  assert.equal(gate.isOpen(), false);
  assert.equal(gate.openGate(), true);
  assert.equal(gate.key, 1);
  assert.equal(gate.openGate(), false);
  assert.equal(gate.key, 1);

  assert.equal(gate.canAcceptSceneReadyKey(0), false);
  assert.equal(gate.canAcceptSceneReadyKey(1), true);
  assert.equal(gate.canAcceptSceneReadyKey(null), false);

  assert.equal(gate.markSceneReady('human-red'), true);
  assert.equal(gate.markSceneReady('human-red'), false);
  assert.equal(gate.areHumansSceneReady({
    players: readyPlayers,
    connectedClientIds: new Set(['human-red', 'human-blue']),
    requiredHumanPlayers: 2,
  }), false);

  assert.equal(gate.markSceneReady('human-blue'), true);
  assert.equal(gate.areHumansSceneReady({
    players: readyPlayers,
    connectedClientIds: new Set(['human-red', 'human-blue']),
    requiredHumanPlayers: 2,
  }), true);

  gate.clearPlayer('human-blue');
  assert.equal(gate.areHumansSceneReady({
    players: readyPlayers,
    connectedClientIds: new Set(['human-red', 'human-blue']),
    requiredHumanPlayers: 2,
  }), false);

  gate.reset();
  assert.equal(gate.isOpen(), false);
  assert.equal(gate.key, 2);
  assert.equal(gate.canAcceptSceneReadyKey(1), false);
  assert.equal(gate.areHumansSceneReady({
    players: readyPlayers,
    connectedClientIds: new Set(['human-red', 'human-blue']),
    requiredHumanPlayers: 2,
  }), false);
}

console.log('match start readiness tests passed');
