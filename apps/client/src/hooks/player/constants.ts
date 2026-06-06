/**
 * Player Controller Constants
 * 
 * Centralized constants for player movement, physics, and abilities.
 */

// ============================================================================
// PLAYER DIMENSIONS
// ============================================================================

export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.48;
export const EYE_HEIGHT = 0.6;

// ============================================================================
// GROUND & COLLISION
// ============================================================================

export const GROUND_SNAP_DISTANCE = 0.3;
export const STEP_HEIGHT = 0.8;

// Smoothing for camera over bumps
export const SMALL_BUMP_THRESHOLD = 0.15;
export const SMOOTH_SPEED_SMALL = 8;
export const SMOOTH_SPEED_LARGE = 20;
export const TERRAIN_RAMP_UP_SMOOTH_SPEED = 10;
export const TERRAIN_RAMP_DOWN_SMOOTH_SPEED = 14;

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
export const PHANTOM_PROJECTILE_SPEED = 70;

// Blaze
export const BLAZE_ROCKET_FIRE_RATE = PHANTOM_FIRE_RATE;
export const BLAZE_ROCKET_FIRE_INTERVAL = 1000 / BLAZE_ROCKET_FIRE_RATE;
export const BLAZE_ROCKET_SPEED = PHANTOM_PROJECTILE_SPEED;
export const BLAZE_BOMB_COOLDOWN = 8000;
export const BLAZE_BOMB_FALL_DURATION = 1500;

// Hookshot
export const HOOKSHOT_FIRE_RATE = 3;
export const HOOKSHOT_FIRE_INTERVAL = 1000 / HOOKSHOT_FIRE_RATE;
export const HOOKSHOT_SPEED = 38;
export const HOOKSHOT_MAX_DISTANCE = 14;
export const DRAG_HOOK_COOLDOWN = 4000;
export const DRAG_HOOK_SPEED = 50;
export const DRAG_HOOK_MAX_DISTANCE = 30;
export const GRAPPLE_MAX_RANGE = 40;
export const GRAPPLE_TRAP_MAX_RANGE = 30;
export const GRAPPLE_TRAP_THROW_SPEED = 30;
export const GRAPPLE_TRAP_GRAVITY = 25;

// Glacier
export const GLACIER_MALLET_SWING_RATE = 1.5;
export const GLACIER_MALLET_SWING_INTERVAL = 1000 / GLACIER_MALLET_SWING_RATE;

// ============================================================================
// FUEL UPDATE THROTTLING
// ============================================================================

export const FUEL_UPDATE_THRESHOLD = 2;

// ============================================================================
// SPAWN HELPERS
// ============================================================================

export interface SpawnOffset {
  eyeHeight: number;
  handDrop: number;
  forwardOffset: number;
}

export interface PlayerSocketOffset {
  handHeight: number;
  forwardOffset: number;
  sideOffset: number;
}

export const DEFAULT_SPAWN_OFFSET: SpawnOffset = {
  eyeHeight: 0.6,
  handDrop: 0.3,
  forwardOffset: 0.8,
};

export const HOOKSHOT_CHAIN_SOCKET: PlayerSocketOffset = {
  handHeight: 0.16,
  forwardOffset: 0.62,
  sideOffset: 0.24,
};

export const PHANTOM_DIRE_BALL_SOCKET: PlayerSocketOffset = {
  handHeight: 0.2,
  forwardOffset: 0.62,
  sideOffset: 0.22,
};

export const PHANTOM_VOID_RAY_SOCKET: PlayerSocketOffset = {
  handHeight: -0.08,
  forwardOffset: 0.52,
  sideOffset: 0,
};

/**
 * Calculate spawn position for projectile based on player position and look direction
 */
export function calculateProjectileSpawn(
  position: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  offset: SpawnOffset = DEFAULT_SPAWN_OFFSET
): { x: number; y: number; z: number } {
  return {
    x: position.x + direction.x * offset.forwardOffset,
    y: position.y + offset.eyeHeight - offset.handDrop + direction.y * offset.forwardOffset,
    z: position.z + direction.z * offset.forwardOffset,
  };
}

/**
 * Calculate a stable player-relative socket position.
 *
 * Unlike projectile spawn, this uses yaw-only forward/side axes so the socket
 * stays attached to the player's body while the projectile can still aim with
 * full pitch via its velocity.
 */
export function calculatePlayerSocketPosition(
  position: { x: number; y: number; z: number },
  yaw: number,
  offset: PlayerSocketOffset
): { x: number; y: number; z: number } {
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  return {
    x: position.x + forwardX * offset.forwardOffset + rightX * offset.sideOffset,
    y: position.y + offset.handHeight,
    z: position.z + forwardZ * offset.forwardOffset + rightZ * offset.sideOffset,
  };
}

/**
 * Calculate look direction from yaw and pitch angles
 */
export function calculateLookDirection(yaw: number, pitch: number): { x: number; y: number; z: number } {
  return {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  };
}

/**
 * Calculate horizontal look direction (ignoring pitch)
 */
export function calculateHorizontalLookDirection(yaw: number): { x: number; z: number } {
  return {
    x: -Math.sin(yaw),
    z: -Math.cos(yaw),
  };
}
