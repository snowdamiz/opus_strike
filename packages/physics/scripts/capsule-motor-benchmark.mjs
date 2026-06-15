import { performance } from 'node:perf_hooks';
import { simulateCapsuleMotor, createVoxelCollisionWorld } from '../dist/index.js';
import { HERO_DEFINITIONS, MOVEMENT_BUTTON_MOVE_FORWARD, MOVEMENT_BUTTON_SPRINT, movementButtonsToInputState } from '@voxel-strike/shared';

const terrain = {
  getGroundY: () => 0,
  clampPosition: (position) => ({
    x: Math.max(-80, Math.min(80, position.x)),
    y: Math.max(-20, Math.min(80, position.y)),
    z: Math.max(-80, Math.min(80, position.z)),
  }),
  getBlockAtWorld: (position) => {
    if (position.y < -0.5) return 1;
    if (Math.abs(position.x - 8) < 0.5 && position.y < 3 && Math.abs(position.z) < 12) return 1;
    return 0;
  },
  cacheStaticAabbs: true,
  collisionRevision: 1,
};

function createMovementState() {
  return {
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
}

const world = createVoxelCollisionWorld(terrain);
const heroStats = HERO_DEFINITIONS.phantom.stats;
const forwardSprint = movementButtonsToInputState(MOVEMENT_BUTTON_MOVE_FORWARD | MOVEMENT_BUTTON_SPRINT);
let state = {
  position: { x: 0, y: 0.9, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  movement: createMovementState(),
};

const samples = [];
const iterations = 2400;
for (let i = 0; i < iterations; i++) {
  const startedAt = performance.now();
  const result = simulateCapsuleMotor({
    state,
    command: {
      input: forwardSprint,
      lookYaw: Math.sin(i / 90) * 0.8,
    },
    terrain: world,
    heroStats,
    dt: 1 / 60,
  });
  samples.push(performance.now() - startedAt);
  state = result.state;
  if (state.position.z < -55 || state.position.x > 12) {
    state = {
      position: { x: 0, y: 0.9, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      movement: createMovementState(),
    };
  }
}

samples.sort((a, b) => a - b);
const sum = samples.reduce((total, value) => total + value, 0);
const percentile = (p) => samples[Math.min(samples.length - 1, Math.floor((samples.length - 1) * p))] ?? 0;

console.log(JSON.stringify({
  iterations,
  averageMs: sum / samples.length,
  p50Ms: percentile(0.5),
  p95Ms: percentile(0.95),
  p99Ms: percentile(0.99),
}, null, 2));
