import assert from 'node:assert/strict';
import { getHeroStats, type PlayerInput, type PlayerMovementState, type Vec3 } from '@voxel-strike/shared';
import {
  advanceMovementShadowSimulation,
  createMovementShadowSimulationState,
  getMovementShadowDriftReport,
  recordMovementShadowDriftSample,
  resetMovementShadowDriftForTests,
} from '../anticheat/movementShadow';

const flatTerrain = {
  getGroundY: () => 0,
  clampPosition: (position: Vec3) => ({ ...position }),
};

const movement: PlayerMovementState = {
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
  jetpackFuel: 100,
  isGliding: false,
};

const input: PlayerInput = {
  tick: 1,
  moveForward: true,
  moveBackward: false,
  moveLeft: false,
  moveRight: false,
  jump: false,
  crouch: false,
  sprint: true,
  primaryFire: false,
  secondaryFire: false,
  reload: false,
  ability1: false,
  ability2: false,
  ultimate: false,
  interact: false,
  lookYaw: 0,
  lookPitch: 0,
  timestamp: 1_000,
  clientFrameRateBand: '45-90fps',
};

const playerPosition = { x: 0, y: 0.9, z: 0 };
const playerVelocity = { x: 0, y: 0, z: 0 };
const proposedPosition = { x: 0, y: 0.9, z: -0.08 };
const proposedVelocity = { x: 0, y: 0, z: -4.8 };

const result = advanceMovementShadowSimulation({
  state: createMovementShadowSimulationState(),
  playerPosition,
  playerVelocity,
  playerMovement: movement,
  heroStats: getHeroStats('phantom'),
  input,
  terrain: flatTerrain,
  flagCarrier: false,
  activeSpeedMultiplier: 1,
  proposedPosition,
  proposedVelocity,
});

assert.equal(result.nextState.initialized, true);
assert.equal(result.nextState.lastSequence, 1);
assert.equal(playerPosition.z, 0, 'shadow simulation must not mutate live player position');
assert.equal(playerVelocity.z, 0, 'shadow simulation must not mutate live player velocity');
assert.ok(Number.isFinite(result.sample.positionDrift));
assert.ok(Number.isFinite(result.sample.velocityDrift));

resetMovementShadowDriftForTests();
recordMovementShadowDriftSample({
  roomId: 'room-a',
  matchMode: 'ranked',
  heroId: 'phantom',
  movementClass: 'sprint',
  mapSeed: 123,
  pingBandMs: '0-50',
  frameRateBand: '45-90fps',
  positionDrift: result.sample.positionDrift,
  velocityDrift: result.sample.velocityDrift,
  movementMismatch: result.sample.movementMismatch,
  objectiveSuppressed: false,
  sampledAt: 1_000,
});
recordMovementShadowDriftSample({
  roomId: 'room-a',
  matchMode: 'ranked',
  heroId: 'phantom',
  movementClass: 'sprint',
  mapSeed: 123,
  pingBandMs: '0-50',
  frameRateBand: '45-90fps',
  positionDrift: result.sample.positionDrift + 0.1,
  velocityDrift: result.sample.velocityDrift + 0.2,
  movementMismatch: false,
  objectiveSuppressed: true,
  sampledAt: 2_000,
});

const report = getMovementShadowDriftReport();
assert.equal(report.sampleCount, 2);
assert.equal(report.bucketCount, 1);
assert.equal(report.buckets[0].heroId, 'phantom');
assert.equal(report.buckets[0].movementClass, 'sprint');
assert.equal(report.buckets[0].sampleCount, 2);
assert.ok(report.buckets[0].positionDriftP95 >= result.sample.positionDrift);
assert.equal(report.buckets[0].objectiveSuppressionRate, 0.5);

console.log('anti-cheat shadow simulation tests passed');
