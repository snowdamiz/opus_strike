import type { PlayerMovementState } from '@voxel-strike/shared';
import {
  DEFAULT_HERO_STATS,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
} from '@voxel-strike/shared';
import {
  canCapsuleOccupy,
  createVoxelCollisionWorld,
  simulateCapsuleMotor,
  type MovementAabb,
  type MovementSimulationState,
} from './CapsuleMotor.js';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertOk(value: unknown, message: string): void {
  if (!value) {
    throw new Error(message);
  }
}

function movementState(overrides: Partial<PlayerMovementState> = {}): PlayerMovementState {
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
    jetpackFuel: 1,
    isGliding: false,
    ...overrides,
  };
}

const floor: MovementAabb = {
  id: 'floor',
  min: { x: -8, y: -0.5, z: -5 },
  max: { x: 8, y: 0, z: 5 },
};
const lowCover: MovementAabb = {
  id: 'low-cover',
  min: { x: -2, y: 0.95, z: 0 },
  max: { x: 2, y: 1.45, z: 2 },
};
const world = createVoxelCollisionWorld({
  cacheStaticAabbs: false,
  getCollisionAabbs: () => [floor, lowCover],
});

const state: MovementSimulationState = {
  position: { x: 0, y: PLAYER_HEIGHT / 2, z: 2.3 },
  velocity: { x: 0, y: 0, z: 4 },
  movement: movementState({
    isSliding: true,
    slideTimeRemaining: 0,
  }),
};

const result = simulateCapsuleMotor({
  state,
  command: {
    input: {
      moveForward: true,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      jump: false,
      crouch: false,
      crouchPressed: false,
      sprint: true,
    },
    lookYaw: 0,
  },
  terrain: world,
  heroStats: DEFAULT_HERO_STATS,
  dt: 1 / 60,
});

assertEqual(result.state.movement.isSliding, false, 'slide should resolve once the far lip can be cleared');
assertEqual(result.state.movement.isCrouching, false, 'player should stand when the full capsule fits past the lip');
assertOk(
  result.state.position.z > lowCover.max.z + PLAYER_RADIUS,
  `slide exit should nudge past the expanded capsule lip, got z=${result.state.position.z}`
);
assertEqual(
  canCapsuleOccupy(world, result.state.position, PLAYER_HEIGHT, PLAYER_RADIUS),
  true,
  'standing capsule should be clear after slide exit'
);

console.log('capsule motor slide tests passed');
