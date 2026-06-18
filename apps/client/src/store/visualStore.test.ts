import assert from 'node:assert/strict';
import {
  MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS,
  type Player,
  type Team,
} from '@voxel-strike/shared';
import {
  addDeathVisual,
  addRemoteTransformSnapshot,
  clearAllDeathVisuals,
  clearDeathVisualsForPlayer,
  clearExpiredDeathVisuals,
  clearVisualState,
  fillCombatVisualEnemyPlayers,
  findCombatVisualEnemyPlayerHit,
  findCombatVisualPlayerHit,
  getDeathVisualForPlayer,
  pruneRemoteTransformHistories,
  rebuildCombatVisualFrameCache,
  removeDeathVisual,
  sampleRemoteTransformInto,
  setLocalSlideIntensity,
  setPlayerVisualTransform,
  updateDeathVisualExpirationForPlayer,
  visualStore,
  type DeathVisualSnapshot,
  type SampledRemoteTransform,
} from './visualStore';

const TEST_REMOTE_TRANSFORM_RECEIVED_AT_MS = 10_000;

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

function addRemoteSnapshot(
  playerId: string,
  serverTime: number,
  x: number,
  receivedAtMs: number,
  movementEpoch = 1
): void {
  addRemoteTransformSnapshot(
    playerId,
    {
      serverTick: serverTime / 50,
      serverTime,
      position: { x, y: 1, z: 0 },
      velocity: { x: 1, y: 0, z: 0 },
      lookYaw: x,
      lookPitch: 0,
      movementBits: x,
      wallRunSide: 0,
      movementEpoch,
    },
    receivedAtMs
  );
}

function addSnapshot(serverTime: number, x: number): void {
  addRemoteSnapshot('remote-a', serverTime, x, TEST_REMOTE_TRANSFORM_RECEIVED_AT_MS);
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

function makeDeathVisual(id: string, playerId: string, startedAtMs: number): DeathVisualSnapshot {
  const player = makePlayer(playerId, 'blue', startedAtMs / 1000, 0);
  return {
    id,
    playerId,
    heroId: player.heroId,
    team: player.team,
    isBot: player.isBot,
    name: player.name,
    position: { ...player.position },
    velocity: { ...player.velocity },
    lookYaw: player.lookYaw,
    lookPitch: player.lookPitch,
    movement: {
      ...player.movement,
      grapplePoint: player.movement.grapplePoint ? { ...player.movement.grapplePoint } : null,
    },
    killerId: 'killer',
    sourceDirection: { x: 1, y: 0, z: 0 },
    startedAtMs,
    expiresAtMs: startedAtMs + 1000,
    local: false,
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

clearVisualState();
addRemoteSnapshot('jittery', 1000, 10, 10_000);
addRemoteSnapshot('jittery', 1050, 11, 10_050);
let jitteryHistory = visualStore.getState().remoteTransformHistories.get('jittery');
assert.ok(jitteryHistory);
assert.equal(jitteryHistory.interpolationDelayMs, MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS);
addRemoteSnapshot('jittery', 1100, 12, 10_210);
jitteryHistory = visualStore.getState().remoteTransformHistories.get('jittery');
assert.ok(jitteryHistory);
const raisedInterpolationDelayMs = jitteryHistory.interpolationDelayMs;
assert.ok(raisedInterpolationDelayMs > MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS);

for (let index = 1; index <= 12; index++) {
  addRemoteSnapshot('jittery', 1100 + index * 50, 12 + index, 10_210 + index * 50);
}
jitteryHistory = visualStore.getState().remoteTransformHistories.get('jittery');
assert.ok(jitteryHistory);
assert.ok(jitteryHistory.interpolationDelayMs < raisedInterpolationDelayMs);
assert.ok(jitteryHistory.interpolationDelayMs >= MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS);

addRemoteSnapshot('jittery', 2000, 20, 11_000, 2);
jitteryHistory = visualStore.getState().remoteTransformHistories.get('jittery');
assert.ok(jitteryHistory);
assert.equal(jitteryHistory.interpolationDelayMs, MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS);
assert.equal(jitteryHistory.arrivalJitterMs, 0);

setPlayerVisualTransform('remote-a', { x: 3, y: 4, z: 5 }, 1.25);
assert.deepEqual(visualStore.getState().playerPositions.get('remote-a'), { x: 3, y: 4, z: 5 });
assert.equal(visualStore.getState().playerRotations.get('remote-a'), 1.25);

setLocalSlideIntensity(1.5, { x: 3, y: 0, z: -4 }, 0.75);
assert.equal(visualStore.getState().slideIntensity, 1);
assert.deepEqual(visualStore.getState().localSlideVelocity, { x: 3, y: 0, z: -4 });
assert.equal(visualStore.getState().localViewYaw, 0.75);
setLocalSlideIntensity(0);
assert.equal(visualStore.getState().slideIntensity, 0);
assert.deepEqual(visualStore.getState().localSlideVelocity, { x: 0, y: 0, z: 0 });

const deathRevisionBeforeAdd = visualStore.getState().deathVisualRevision;
assert.equal(addDeathVisual(makeDeathVisual('death-a', 'remote-a', 2000)), true);
assert.equal(visualStore.getState().deathVisualRevision, deathRevisionBeforeAdd + 1);
assert.equal(visualStore.getState().deathVisuals.size, 1);
assert.equal(addDeathVisual(makeDeathVisual('death-a', 'remote-a', 2000)), false);
assert.equal(visualStore.getState().deathVisuals.size, 1);

assert.equal(addDeathVisual(makeDeathVisual('death-b', 'remote-a', 2600)), true);
assert.equal(visualStore.getState().deathVisuals.has('death-a'), false);
assert.equal(visualStore.getState().deathVisuals.has('death-b'), true);
assert.equal(getDeathVisualForPlayer('remote-a', 2700)?.id, 'death-b');
assert.equal(updateDeathVisualExpirationForPlayer('remote-a', 5200), true);
assert.equal(visualStore.getState().deathVisuals.get('death-b')?.expiresAtMs, 5200);
assert.equal(clearExpiredDeathVisuals(4000), 0);

assert.equal(clearExpiredDeathVisuals(5300), 1);
assert.equal(visualStore.getState().deathVisuals.size, 0);
assert.equal(getDeathVisualForPlayer('remote-a', 5300), null);

addDeathVisual(makeDeathVisual('death-c', 'remote-a', 5000));
assert.equal(removeDeathVisual('missing'), false);
assert.equal(removeDeathVisual('death-c'), true);
assert.equal(visualStore.getState().deathVisuals.size, 0);

addDeathVisual(makeDeathVisual('death-d', 'remote-a', 6000));
addDeathVisual(makeDeathVisual('death-e', 'remote-b', 6100));
assert.equal(clearDeathVisualsForPlayer('remote-a'), 1);
assert.equal(visualStore.getState().deathVisuals.has('death-d'), false);
assert.equal(visualStore.getState().deathVisuals.has('death-e'), true);
assert.equal(clearAllDeathVisuals(), 1);
assert.equal(visualStore.getState().deathVisuals.size, 0);
clearVisualState();

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

const hitEnemy = findCombatVisualEnemyPlayerHit(
  combatCache,
  'red',
  'owner',
  { x: 0, y: 1, z: 0 },
  { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 },
  3,
  0.21,
  { x: 0, z: 0 },
  4
);
assert.equal(hitEnemy?.id, 'near-blue');
const hitAnyPlayer = findCombatVisualPlayerHit(
  combatCache,
  'red',
  'owner',
  { x: 0, y: 1, z: 0 },
  { x: 1, y: 0, z: 0 },
  3,
  0.21,
  { x: 0, z: 0 },
  4,
  'any'
);
assert.equal(hitAnyPlayer?.id, 'near-red');
assert.equal(
  findCombatVisualEnemyPlayerHit(
    combatCache,
    'red',
    'owner',
    { x: 0, y: 1, z: 0 },
    { x: 1, y: 0, z: 0 },
    3,
    0.21,
    { x: 0, z: 0 },
    0.4
  ),
  null
);

const rebuiltCombatCache = rebuildCombatVisualFrameCache(combatPlayers, 2001, 2001, combatPlayers.length);
assert.equal(rebuiltCombatCache.buckets.get(0)?.get(0), firstCombatBucket);

const brCombatPlayers = [
  makePlayer('br-owner', 'br_01', 0, 0),
  makePlayer('br-near-enemy', 'br_02', 1, 1),
  makePlayer('br-squadmate', 'br_01', 1, 0),
  makePlayer('br-far-enemy', 'br_03', 48, 0),
  makePlayer('br-hidden-enemy', 'br_04', 2, 0),
];
brCombatPlayers[4].visibility = 'hidden';
const brCombatCache = rebuildCombatVisualFrameCache(brCombatPlayers, 3000, 3000, brCombatPlayers.length);
assert.equal(brCombatCache.byTeam.get('br_01')?.length, 2);
assert.equal(brCombatCache.byTeam.get('br_02')?.length, 1);
assert.equal(brCombatCache.byTeam.get('br_03')?.length, 1);
assert.equal(brCombatCache.byTeam.has('br_04'), false);

const brNearbyEnemies: Player[] = [];
fillCombatVisualEnemyPlayers(brCombatCache, 'br_01', 'br-owner', brNearbyEnemies, { x: 0, z: 0 }, 4);
assert.deepEqual(brNearbyEnemies.map((player) => player.id), ['br-near-enemy']);

const brAllEnemies: Player[] = [];
fillCombatVisualEnemyPlayers(brCombatCache, 'br_01', 'br-owner', brAllEnemies);
assert.deepEqual(brAllEnemies.map((player) => player.id), ['br-near-enemy', 'br-far-enemy']);

const brHitEnemy = findCombatVisualEnemyPlayerHit(
  brCombatCache,
  'br_01',
  'br-owner',
  { x: 0, y: 1, z: 0 },
  { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 },
  3,
  0.21,
  { x: 0, z: 0 },
  4
);
assert.equal(brHitEnemy?.id, 'br-near-enemy');

console.log('visualStore remote transform tests passed');
