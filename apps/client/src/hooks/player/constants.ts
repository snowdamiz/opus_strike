import {
  BLAZE_ROCKET_FIRE_INTERVAL_MS,
  BLAZE_ROCKET_SPEED as SHARED_BLAZE_ROCKET_SPEED,
  PHANTOM_DIRE_BALL_SPEED as SHARED_PHANTOM_DIRE_BALL_SPEED,
} from '@voxel-strike/shared';

/**
 * Player Controller Constants
 * 
 * Centralized constants for player movement, physics, and abilities.
 */

export {
  BLAZE_ROCKET_STAFF_SOCKET,
  CHRONOS_PRIMARY_ORB_SOCKET,
  DEFAULT_SPAWN_OFFSET,
  HOOKSHOT_CHAIN_SOCKET,
  PHANTOM_DIRE_BALL_SOCKET,
  PHANTOM_VOID_RAY_SOCKET,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_EYE_HEIGHT as EYE_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  calculateHorizontalLookDirection,
  calculateLookDirection,
  calculatePlayerSocketPosition,
  calculateProjectileSpawn,
  type PlayerSocketOffset,
  type SpawnOffset,
} from '@voxel-strike/shared';

// ============================================================================
// GROUND & COLLISION
// ============================================================================

export const GROUND_SNAP_DISTANCE = 0.3;
export const STEP_HEIGHT = 0.9;

// Smoothing for camera over bumps
export const SMALL_BUMP_THRESHOLD = 0.15;
export const SMOOTH_SPEED_SMALL = 8;
export const SMOOTH_SPEED_LARGE = 20;
export const TERRAIN_RAMP_UP_SMOOTH_SPEED = 7;
export const TERRAIN_RAMP_DOWN_SMOOTH_SPEED = 9;

// Out of bounds - ground level is y=0, spawns at y=1
// Only consider out of bounds if significantly below map
export const OUT_OF_BOUNDS_Y = -20;
export const RESPAWN_Y = 2;

// ============================================================================
// FIRING RATES
// ============================================================================

// Phantom
export const PHANTOM_FIRE_RATE = 4; // Fires per second
export const PHANTOM_FIRE_INTERVAL = 1000 / PHANTOM_FIRE_RATE;
export const PHANTOM_PROJECTILE_SPEED = SHARED_PHANTOM_DIRE_BALL_SPEED;

// Blaze
export const BLAZE_ROCKET_FIRE_INTERVAL = BLAZE_ROCKET_FIRE_INTERVAL_MS;
export const BLAZE_ROCKET_SPEED = SHARED_BLAZE_ROCKET_SPEED;
export const BLAZE_BOMB_COOLDOWN = 8000;
export const BLAZE_BOMB_FALL_DURATION = 1500;

// Chronos
export const CHRONOS_PRIMARY_FIRE_RATE = 4;
export const CHRONOS_PRIMARY_FIRE_INTERVAL = 1000 / CHRONOS_PRIMARY_FIRE_RATE;
export const CHRONOS_PRIMARY_PULSE_SPEED = 68;

// Hookshot
export const HOOKSHOT_FIRE_INTERVAL = 600;
export const HOOKSHOT_SPEED = 38;
export const HOOKSHOT_MAX_DISTANCE = 14;
export const DRAG_HOOK_COOLDOWN = 3600;
export const DRAG_HOOK_SPEED = 50;
export const DRAG_HOOK_MAX_DISTANCE = 24;
export const GRAPPLE_MAX_RANGE = 28;
export const GRAPPLE_TRAP_MAX_RANGE = 30;
export const GRAPPLE_TRAP_THROW_SPEED = 30;
export const GRAPPLE_TRAP_GRAVITY = 25;

// ============================================================================
// FUEL UPDATE THROTTLING
// ============================================================================

export const FUEL_UPDATE_THRESHOLD = 2;
