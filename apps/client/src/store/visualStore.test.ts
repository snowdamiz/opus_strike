import assert from 'node:assert/strict';
import {
  MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS,
  type Player,
  type Team,
} from '@voxel-strike/shared';
import {
  addRemoteTransformSnapshot,
  clearVisualState,
  fillCombatVisualEnemyPlayers,
  pruneRemoteTransformHistories,
  rebuildCombatVisualFrameCache,
  sampleRemoteTransformInto,
  setPlayerVisualTransform,
  visualStore,
  type SampledRemoteTransform,
} from './visualStore';

function makeTarget(): SampledRemoteTransform {
  return {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    lookYaw: 0,
    lookPitch: 0,
    movementBits: 0,
    wallRunSide: 0,
    movementEpoch: 0,
    extrapolatedMs: 0,
    stale: false,
  };
}

function addSnapshot(serverTime: number, x: number): void {
  addRemoteTransformSnapshot('remote-a', {
    serverTick: serverTime / 50,
    serverTime,
    position: { x, y: 1, z: 0 },
    velocity: { x: 1, y: 0, z: 0 },
    lookYaw: x,
    lookPitch: 0,
    movementBits: x,
    wallRunSide: 0,
    movementEpoch: 1,
  });
}

function makePlayer(id: string, team: Team, x: number, z: number, state: Player['state'] = 'alive'): Player {
  return {
    id,
    name: id,
    team,
    heroId: null,
    state,
    isReady: true,
    isBot: false,
    position: { x, y: 1, z },
    velocity: { x: 0, y: 0, z: 0 },
    lookYaw: 0,
    lookPitch: 0,
    health: 100,
    maxHealth: 100,
    ultimateCharge: 0,
    movement: {
      isGrounded: true,
      isSprinting: false,
      isCrouching: false,
      isSliding: false,
      slideTimeRemaining: 0,
      isWallRunning: false,
      wallRunSide: null,
      isGrappling: false,
      grapplePoint: null,
      isJetpacking: false,
      jetpackFuel: 0,
      isGliding: false,
    },
    abilities: {},
    hasFlag: false,
    respawnTime: null,
    spawnProtectionUntil: null,
    stats: {
      kills: 0,
      deaths: 0,
      assists: 0,
      flagCaptures: 0,
      flagReturns: 0,
    },
  };
}

clearVisualState();
addSnapshot(1200, 12);
addSnapshot(1000, 10);
addSnapshot(1100, 11);

const history = visualStore.getState().remoteTransformHistories.get('remote-a');
assert.ok(history);
assert.deepEqual(history.snapshots.map((snapshot) => snapshot.serverTime), [1000, 1100, 1200]);

const target = makeTarget();
const sampled = sampleRemoteTransformInto(
  'remote-a',
  target,
  history.latestReceivedAtMs + MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS - 50
);
assert.equal(sampled, true);
assert.equal(target.position.x, 11.5);
assert.equal(target.velocity.x, 1);
assert.equal(target.movementBits, 12);
assert.equal(target.movementEpoch, 1);
assert.equal(target.stale, false);

addRemoteTransformSnapshot('remote-b', {
  serverTick: 25,
  serverTime: 1250,
  position: { x: 20, y: 1, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  lookYaw: 0,
  lookPitch: 0,
  movementBits: 0,
  wallRunSide: 0,
  movementEpoch: 1,
});
assert.equal(visualStore.getState().remoteTransformHistories.has('remote-b'), true);

pruneRemoteTransformHistories(new Set(['remote-a']));
assert.equal(visualStore.getState().remoteTransformHistories.has('remote-a'), true);
assert.equal(visualStore.getState().remoteTransformHistories.has('remote-b'), false);

const missingTarget = makeTarget();
assert.equal(sampleRemoteTransformInto('missing', missingTarget), false);

setPlayerVisualTransform('remote-a', { x: 3, y: 4, z: 5 }, 1.25);
assert.deepEqual(visualStore.getState().playerPositions.get('remote-a'), { x: 3, y: 4, z: 5 });
assert.equal(visualStore.getState().playerRotations.get('remote-a'), 1.25);

const combatPlayers = [
  makePlayer('owner', 'red', 0, 0),
  makePlayer('near-blue', 'blue', 1, 1),
  makePlayer('far-blue', 'blue', 40, 0),
  makePlayer('near-red', 'red', 1, 0),
  makePlayer('dead-blue', 'blue', 1, 0, 'dead'),
];
const combatCache = rebuildCombatVisualFrameCache(combatPlayers, 2000, 2000, combatPlayers.length);
const firstCombatBucket = combatCache.buckets.get(0)?.get(0);
assert.ok(firstCombatBucket);
const nearbyEnemies: Player[] = [];
fillCombatVisualEnemyPlayers(combatCache, 'red', 'owner', nearbyEnemies, { x: 0, z: 0 }, 4);
assert.deepEqual(nearbyEnemies.map((player) => player.id), ['near-blue']);

const allEnemies: Player[] = [];
fillCombatVisualEnemyPlayers(combatCache, 'red', 'owner', allEnemies);
assert.deepEqual(allEnemies.map((player) => player.id), ['near-blue', 'far-blue']);

const rebuiltCombatCache = rebuildCombatVisualFrameCache(combatPlayers, 2001, 2001, combatPlayers.length);
assert.equal(rebuiltCombatCache.buckets.get(0)?.get(0), firstCombatBucket);

console.log('visualStore remote transform tests passed');
