import type { HeroStats, PlayerInput, PlayerMovementState, Vec3 } from '@voxel-strike/shared';
import {
  createVoxelCollisionWorld,
  simulateCapsuleMotor,
  type MovementCollisionWorld,
  type VoxelMovementTerrainAdapter,
} from './CapsuleMotor.js';

export interface MovementTerrainAdapter extends VoxelMovementTerrainAdapter {
  getGroundY(position: Vec3): number | null;
  clampPosition(position: Vec3): Vec3;
  getBlockAtWorld?: (position: Vec3) => number;
}

export interface SharedMovementSimulationInput {
  position: Vec3;
  velocity: Vec3;
  movement: PlayerMovementState;
  heroStats: HeroStats;
  input: Pick<PlayerInput, 'moveForward' | 'moveBackward' | 'moveLeft' | 'moveRight' | 'jump' | 'crouch' | 'crouchPressed' | 'sprint'>;
  lookYaw: number;
  deltaTime: number;
  terrain: MovementTerrainAdapter;
  collisionWorld?: MovementCollisionWorld;
  collisionRevision?: number | string | null;
  flagCarrier?: boolean;
  activeSpeedMultiplier?: number;
  chronosAscendantActive?: boolean;
}

export interface SharedMovementSimulationResult {
  position: Vec3;
  velocity: Vec3;
  movement: PlayerMovementState;
}

interface CachedFallbackCollisionWorld {
  revision: number | string | null;
  world: MovementCollisionWorld;
}

const fallbackCollisionWorlds = new WeakMap<MovementTerrainAdapter, CachedFallbackCollisionWorld>();

function getSharedMovementCollisionWorld(input: SharedMovementSimulationInput): MovementCollisionWorld {
  if (input.collisionWorld) return input.collisionWorld;

  const revision = input.collisionRevision ?? input.terrain.collisionRevision ?? null;
  const cached = fallbackCollisionWorlds.get(input.terrain);
  if (cached && cached.revision === revision) {
    return cached.world;
  }

  const world = createVoxelCollisionWorld(input.terrain);
  fallbackCollisionWorlds.set(input.terrain, { revision, world });
  return world;
}

export function simulateSharedMovement(input: SharedMovementSimulationInput): SharedMovementSimulationResult {
  const result = simulateCapsuleMotor({
    state: {
      position: input.position,
      velocity: input.velocity,
      movement: input.movement,
    },
    command: {
      input: input.input,
      lookYaw: input.lookYaw,
    },
    terrain: getSharedMovementCollisionWorld(input),
    heroStats: input.heroStats,
    modifiers: {
      flagCarrier: input.flagCarrier,
      activeSpeedMultiplier: input.activeSpeedMultiplier,
      chronosAscendantActive: input.chronosAscendantActive,
    },
    dt: input.deltaTime,
    collectContacts: false,
  });

  return result.state;
}
