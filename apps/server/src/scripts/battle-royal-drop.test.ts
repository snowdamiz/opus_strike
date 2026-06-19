import assert from 'node:assert/strict';
import type { PlayerInput, Vec3, VoxelMapManifest } from '@voxel-strike/shared';
import {
  BATTLE_ROYAL_DROP_POD_MAX_VERTICAL_SPEED,
  BATTLE_ROYAL_DROP_POD_MIN_VERTICAL_SPEED,
  PITCH_LIMIT,
  clampToBoundaryPolygon,
  isInsideBoundaryPolygon,
} from '@voxel-strike/shared';
import {
  BATTLE_ROYAL_DEPLOYMENT_PHASE_MS,
  advanceBattleRoyalDropState,
  areAllBattleRoyalDropPlayersLanded,
  buildBattleRoyalDropSnapshot,
  createBattleRoyalDropState,
  forceLandBattleRoyalDropState,
  isBattleRoyalDropShipDroppable,
  setBattleRoyalDropPlayerInput,
  shouldAutoDropBattleRoyalTeam,
  startBattleRoyalTeamDrop,
} from '../rooms/battleRoyalDrop';

const manifest = {
  seed: 0x51f15eed,
  origin: { x: -80, y: 0, z: -80 },
  voxelSize: { x: 1, y: 1, z: 1 },
  size: { x: 160, y: 1, z: 160 },
  boundary: [
    { x: 72, z: 0 },
    { x: 0, z: 72 },
    { x: -72, z: 0 },
    { x: 0, z: -72 },
  ],
} as unknown as VoxelMapManifest;

function playerInput(overrides: Partial<PlayerInput> = {}): PlayerInput {
  return {
    tick: 1,
    moveForward: false,
    moveBackward: false,
    moveLeft: false,
    moveRight: false,
    jump: false,
    crouch: false,
    sprint: false,
    primaryFire: false,
    secondaryFire: false,
    reload: false,
    ability1: false,
    ability2: false,
    ultimate: false,
    interact: false,
    lookYaw: 0,
    lookPitch: 0,
    timestamp: 0,
    ...overrides,
  };
}

function flatGroundY(_position: Vec3): number {
  return 0;
}

function unclamped(position: Vec3): Vec3 {
  return { ...position };
}

function clampToBoundary(position: Vec3): Vec3 {
  const clamped = clampToBoundaryPolygon(position.x, position.z, manifest.boundary);
  return { ...position, x: clamped.x, z: clamped.z };
}

const startedAt = 1_000;
const state = createBattleRoyalDropState(
  manifest,
  [
    { playerId: 'red-1', team: 'red' },
    { playerId: 'red-2', team: 'red' },
    { playerId: 'blue-1', team: 'blue' },
  ],
  startedAt
);

assert.equal(state.phaseEndsAt - state.phaseStartedAt, BATTLE_ROYAL_DEPLOYMENT_PHASE_MS);
assert.equal(state.players.get('red-1')?.status, 'aboard');
assert.equal(state.players.get('blue-1')?.status, 'aboard');
assert.equal(Math.hypot(state.ship.end.x - state.ship.start.x, state.ship.end.z - state.ship.start.z) > 100, true);
assert.equal(state.ship.start.y, state.ship.end.y);
assert.equal(state.ship.start.y >= 120, true);
assert.equal(isBattleRoyalDropShipDroppable(state, startedAt), false);
assert.equal(startBattleRoyalTeamDrop(state, 'red', startedAt + 1_000), false);

const initialSnapshot = buildBattleRoyalDropSnapshot(state, startedAt);
assert.equal(initialSnapshot.enabled, true);
assert.equal(initialSnapshot.serverTime, startedAt);
assert.equal(initialSnapshot.players.length, 3);
assert.equal(initialSnapshot.players.every((player) => player.status === 'aboard'), true);
assert.equal(initialSnapshot.ship.canDrop, false);

const redAutoDropAt = state.teamAutoDropAt.get('red') ?? state.autoDropAt;
assert.equal(shouldAutoDropBattleRoyalTeam(state, 'red', redAutoDropAt), false);
const legalDropAt = state.dropStartsAt + 100;
assert.equal(isBattleRoyalDropShipDroppable(state, legalDropAt), true);
assert.equal(buildBattleRoyalDropSnapshot(state, legalDropAt).ship.canDrop, true);
assert.equal(startBattleRoyalTeamDrop(state, 'red', legalDropAt), true);
assert.equal(startBattleRoyalTeamDrop(state, 'red', legalDropAt + 1), false);
assert.equal(state.players.get('red-1')?.status, 'dropping');
assert.equal(state.players.get('red-2')?.status, 'dropping');
assert.equal(state.players.get('blue-1')?.status, 'aboard');

const red = state.players.get('red-1');
assert.ok(red);
const redDropStart = { ...red.position };

setBattleRoyalDropPlayerInput(state, 'red-1', playerInput({
  moveForward: true,
  sprint: true,
  lookYaw: -Math.PI / 2,
}));
advanceBattleRoyalDropState({
  state,
  now: startedAt + 13_000,
  dt: 1,
  getGroundY: flatGroundY,
  clampToPlayableMap: unclamped,
});

assert.equal(red.status, 'dropping');
assert.equal(red.position.x > redDropStart.x + 1, true);
assert.equal(red.position.y < redDropStart.y, true);
assert.equal(state.players.get('blue-1')?.status, 'aboard');

const mouseGuidedState = createBattleRoyalDropState(
  manifest,
  [{ playerId: 'mouse-red', team: 'red' }],
  startedAt
);
startBattleRoyalTeamDrop(mouseGuidedState, 'red', mouseGuidedState.dropStartsAt + 100);
const mouseGuidedPlayer = mouseGuidedState.players.get('mouse-red');
assert.ok(mouseGuidedPlayer);
const mouseGuidedStart = { ...mouseGuidedPlayer.position };
setBattleRoyalDropPlayerInput(mouseGuidedState, 'mouse-red', playerInput({
  lookYaw: -Math.PI / 2,
}));
advanceBattleRoyalDropState({
  state: mouseGuidedState,
  now: startedAt + 2_000,
  dt: 1,
  getGroundY: flatGroundY,
  clampToPlayableMap: unclamped,
});
assert.equal(mouseGuidedPlayer.position.x > mouseGuidedStart.x + 1, true);
assert.equal(mouseGuidedPlayer.position.y < mouseGuidedStart.y, true);

const pitchGuidedState = createBattleRoyalDropState(
  manifest,
  [{ playerId: 'pitch-red', team: 'red' }],
  startedAt
);
startBattleRoyalTeamDrop(pitchGuidedState, 'red', pitchGuidedState.dropStartsAt + 100);
const pitchGuidedPlayer = pitchGuidedState.players.get('pitch-red');
assert.ok(pitchGuidedPlayer);
setBattleRoyalDropPlayerInput(pitchGuidedState, 'pitch-red', playerInput({
  lookPitch: PITCH_LIMIT,
}));
advanceBattleRoyalDropState({
  state: pitchGuidedState,
  now: startedAt + 2_000,
  dt: 1,
  getGroundY: flatGroundY,
  clampToPlayableMap: unclamped,
});
assert.equal(pitchGuidedPlayer.velocity.y, -BATTLE_ROYAL_DROP_POD_MIN_VERTICAL_SPEED);
setBattleRoyalDropPlayerInput(pitchGuidedState, 'pitch-red', playerInput({
  lookPitch: -PITCH_LIMIT,
}));
advanceBattleRoyalDropState({
  state: pitchGuidedState,
  now: startedAt + 3_000,
  dt: 1,
  getGroundY: flatGroundY,
  clampToPlayableMap: unclamped,
});
assert.equal(pitchGuidedPlayer.velocity.y, -BATTLE_ROYAL_DROP_POD_MAX_VERTICAL_SPEED);

const boundaryClampedState = createBattleRoyalDropState(
  manifest,
  [{ playerId: 'edge-red', team: 'red' }],
  startedAt
);
startBattleRoyalTeamDrop(boundaryClampedState, 'red', boundaryClampedState.dropStartsAt + 100);
const edgePlayer = boundaryClampedState.players.get('edge-red');
assert.ok(edgePlayer);
edgePlayer.position = { x: 71.8, y: 80, z: 0 };
setBattleRoyalDropPlayerInput(boundaryClampedState, 'edge-red', playerInput({
  moveForward: true,
  lookYaw: -Math.PI / 2,
}));
advanceBattleRoyalDropState({
  state: boundaryClampedState,
  now: boundaryClampedState.dropStartsAt + 200,
  dt: 1,
  getGroundY: flatGroundY,
  clampToPlayableMap: clampToBoundary,
});
assert.equal(isInsideBoundaryPolygon(edgePlayer.position.x, edgePlayer.position.z, manifest.boundary), true);

let now = startedAt + 13_000;
for (let step = 0; step < 120; step++) {
  if (state.players.get('red-1')?.status === 'landed') break;
  now += 100;
  advanceBattleRoyalDropState({
    state,
    now,
    dt: 0.1,
    getGroundY: flatGroundY,
    clampToPlayableMap: unclamped,
  });
}

const landedRed = state.players.get('red-1');
assert.equal(landedRed?.status, 'landed');
assert.equal(landedRed?.landedAt !== null, true);
assert.equal(landedRed?.velocity.y, 0);
assert.equal(areAllBattleRoyalDropPlayersLanded(state), false);

forceLandBattleRoyalDropState({
  state,
  now: now + 100,
  dt: 0.1,
  getGroundY: flatGroundY,
  clampToPlayableMap: unclamped,
});
assert.equal(areAllBattleRoyalDropPlayersLanded(state), true);
assert.equal(state.players.get('blue-1')?.status, 'landed');

const botOnlyState = createBattleRoyalDropState(
  manifest,
  [{ playerId: 'bot-blue', team: 'blue', isBot: true }],
  startedAt
);
const botAutoDropAt = botOnlyState.teamAutoDropAt.get('blue') ?? botOnlyState.autoDropAt;
assert.equal(shouldAutoDropBattleRoyalTeam(botOnlyState, 'blue', botAutoDropAt - 1), false);
assert.equal(shouldAutoDropBattleRoyalTeam(botOnlyState, 'blue', botAutoDropAt), true);

advanceBattleRoyalDropState({
  state: botOnlyState,
  now: botAutoDropAt,
  dt: 0.016,
  getGroundY: flatGroundY,
  clampToPlayableMap: unclamped,
});
assert.equal(botOnlyState.players.get('bot-blue')?.status, 'dropping');

console.log('battle royal drop tests passed');
