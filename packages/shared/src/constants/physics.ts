// World settings
export const GRAVITY = -25; // Slightly heavier fall than the previous floaty tuning
export const AIR_RESISTANCE = 0.01;
export const GROUND_FRICTION = 0.9;

// Movement multipliers (base speed/jump defined per-hero in heroes.ts)
export const SPRINT_MULTIPLIER = 1.2;
export const CROUCH_MULTIPLIER = 0.5;
export const MOVEMENT_STRAFE_SPEED_MULTIPLIER = 0.92;
export const MOVEMENT_BACKWARD_SPEED_MULTIPLIER = 0.85;
export const AIR_CONTROL = 0.3;

// ============================================
// CS-STYLE BUNNY HOP / STRAFE JUMP PHYSICS
// Based on Quake/Source engine movement
// Tuned for balanced gameplay (not pure bhop servers)
// ============================================

// Ground acceleration - how quickly you reach max speed on ground
export const BHOP_GROUND_ACCEL = 10;
// Air acceleration - controls how responsive air strafing feels
export const BHOP_AIR_ACCEL = 15;
// Air speed cap - the "wish speed" when airborne
// This MUST be low to create the strafe acceleration effect
// When this is low, you can only accelerate by strafing perpendicular to velocity
export const BHOP_AIR_SPEED_CAP = 2;
// Maximum velocity the player can achieve through bunny hopping
// About 1.5x sprint speed - rewarding skilled movement
export const BHOP_MAX_VELOCITY = 14;
// Ground friction - how quickly you slow down on ground
export const BHOP_GROUND_FRICTION = 6;
// Extra grounded friction when no movement key is held. This keeps Quake-style
// acceleration while moving, but makes key release feel crisp instead of floaty.
export const BHOP_NO_INPUT_FRICTION_MULTIPLIER = 4;
// Snap tiny leftover ground velocity to zero after releasing movement input.
export const BHOP_GROUND_STOP_THRESHOLD = 0.75;
// Stop speed - below this speed, friction applies more strongly
export const BHOP_STOP_SPEED = 1.5;
// Speed boost when landing a bhop with good timing
export const BHOP_TIMING_WINDOW = 0.1; // seconds
// How much horizontal velocity is preserved on landing
export const BHOP_LANDING_SPEED_RETENTION = 0.94;
// Minimum speed to maintain bunny hop chain
export const BHOP_MIN_CHAIN_SPEED = 5;

// Look sensitivity
export const MOUSE_SENSITIVITY = 0.002;
export const PITCH_LIMIT = Math.PI / 2 - 0.1;

// Ground detection
export const GROUND_CHECK_DISTANCE = 0.1;
export const GROUND_NORMAL_THRESHOLD = 0.7;
export const STEP_HEIGHT = 0.9;

// Slide
export const SLIDE_SPEED_BOOST = 1.75; // Speed multiplier during slide
export const SLIDE_DURATION = 0.6; // Duration of slide in seconds
export const SLIDE_COOLDOWN = 0.8; // Cooldown before next slide
export const SLIDE_FRICTION = 0.982; // Friction applied during slide (higher = less slowdown)
export const SLIDE_INITIAL_BOOST = 1.75; // Initial speed boost when entering slide (ensures faster than sprint)
export const SLIDE_ENTRY_SPEED_CAP_MULTIPLIER = 1.1; // Caps carried speed before applying slide boost
export const SLIDE_MAX_SPEED_MULTIPLIER = 2.45; // Absolute slide speed cap relative to sprint speed
export const SLIDE_JUMP_SPEED_RETENTION = 0.82; // Horizontal speed retained when jumping out of a slide
export const SLIDE_JUMP_MAX_SPEED_MULTIPLIER = 1.9; // Max horizontal carry when slide-jumping

// Crouch
export const CROUCH_TRANSITION_SPEED = 12; // How fast to transition camera height
export const CROUCH_HEIGHT_OFFSET = -0.4; // How much to lower the camera when crouching
export const SLIDE_CAMERA_HEIGHT_OFFSET = -0.8; // Match the lower slide capsule used for slide-only cover.
export const SLIDE_CAMERA_PITCH_OFFSET = 0.12; // Slight upward camera tilt during slide (radians, ~7 degrees)
export const SLIDE_FOV_BOOST = 15; // Extra FOV degrees during slide
export const SLIDE_CAMERA_ROLL = 0.08; // Camera roll during slide (radians, ~4.5 degrees)

// Wall running
export const WALL_RUN_MIN_SPEED = 8;
export const WALL_RUN_MAX_DURATION = 2;
export const WALL_RUN_GRAVITY_MULTIPLIER = 0.3;
export const WALL_RUN_SPEED_BOOST = 1.2;
export const WALL_RUN_JUMP_FORCE = 10;
export const WALL_RUN_JUMP_AWAY_FORCE = 8;
export const WALL_DETECT_DISTANCE = 0.6;
export const WALL_RUN_ANGLE_MIN = 60; // degrees from forward
export const WALL_RUN_ANGLE_MAX = 120;
export const WALL_RUN_COOLDOWN = 0.5;

// Ledge grab / mantle
export const LEDGE_DETECT_HEIGHT = 2.5;
export const LEDGE_DETECT_DISTANCE = 0.8;
export const MANTLE_DURATION = 0.4;
export const MANTLE_HEIGHT_BOOST = 0.5;

// Grapple
export const GRAPPLE_MAX_DISTANCE = 22;
export const GRAPPLE_SPEED = 80;
export const GRAPPLE_PULL_FORCE = 35;
export const GRAPPLE_SWING_FORCE = 20;
export const GRAPPLE_DETACH_DISTANCE = 2;
export const GRAPPLE_MOMENTUM_TRANSFER = 0.8;

// Blaze Flamethrower
export const BLAZE_FLAMETHROWER_MAX_FUEL = 100;
export const BLAZE_FLAMETHROWER_FUEL_DRAIN = 40; // per second
export const BLAZE_FLAMETHROWER_FUEL_REGEN = 20; // per second when not firing
export const BLAZE_FLAMETHROWER_RANGE = 9;
export const BLAZE_FLAMETHROWER_CONE_HALF_ANGLE = Math.PI / 5;
export const BLAZE_FLAMETHROWER_DAMAGE = 6;
export const BLAZE_FLAMETHROWER_DAMAGE_INTERVAL = 250; // ms between damage ticks
export const BLAZE_FLAMETHROWER_BURN_DAMAGE = 1;
export const BLAZE_FLAMETHROWER_BURN_TICKS = 10;
export const BLAZE_FLAMETHROWER_BURN_INTERVAL_MS = 500;
export const BLAZE_FLAMETHROWER_SOCKET_HAND_HEIGHT = 0.42;
export const BLAZE_FLAMETHROWER_SOCKET_FORWARD_OFFSET = 0.18;
export const BLAZE_FLAMETHROWER_SOCKET_SIDE_OFFSET = 0.14;
export const BLAZE_FLAMETHROWER_SOCKET = {
  handHeight: BLAZE_FLAMETHROWER_SOCKET_HAND_HEIGHT,
  forwardOffset: BLAZE_FLAMETHROWER_SOCKET_FORWARD_OFFSET,
  sideOffset: BLAZE_FLAMETHROWER_SOCKET_SIDE_OFFSET,
} as const;

// Blaze Ultimate - Infernal Gearstorm
export const BLAZE_GEARSTORM_RADIUS = 16;

// Rocket Jump
export const BLAZE_ROCKET_JUMP_VERTICAL_FORCE = 13.5;
export const BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE = 1.5;

// Afterburner Dash
export const BLAZE_AFTERBURNER_DASH_SPEED = 24;
export const BLAZE_AFTERBURNER_DASH_DURATION_MS = 360;

// Glide
export const GLIDE_FALL_SPEED = -4;
export const GLIDE_FORWARD_BOOST = 1.3;
export const GLIDE_TURN_SPEED = 2;

// Player collision
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.48;
export const PLAYER_CROUCH_HEIGHT = 1.08;
export const PLAYER_SLIDE_HEIGHT = 0.78;
export const PLAYER_SLIDE_RADIUS = 0.36;
export const PLAYER_MASS = 80;
export const PLAYER_COMBAT_HITBOX_PADDING = 0.14;
export const PLAYER_EYE_HEIGHT = 0.6;

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

export const BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME = 'blaze.rocket.staffTip';
export const PHANTOM_PRIMARY_PALM_SOCKET_NAMES = {
  [-1]: 'phantom.primary.leftPalm',
  [1]: 'phantom.primary.rightPalm',
} as const satisfies Record<-1 | 1, string>;
export const PHANTOM_VOID_RAY_ORB_SOCKET_NAME = 'phantom.voidRay.orb';
export const HOOKSHOT_HOOK_SOCKET_NAMES = {
  [-1]: 'hookshot.hook.leftTip',
  [1]: 'hookshot.hook.rightTip',
} as const satisfies Record<-1 | 1, string>;
export const CHRONOS_PRIMARY_ORB_SOCKET_NAME = 'chronos.primary.orb';

export const DEFAULT_SPAWN_OFFSET: SpawnOffset = {
  eyeHeight: PLAYER_EYE_HEIGHT,
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

export const BLAZE_ROCKET_STAFF_SOCKET: PlayerSocketOffset = {
  handHeight: 0.24,
  forwardOffset: 0.64,
  sideOffset: 0.22,
};

export const CHRONOS_PRIMARY_ORB_SOCKET: PlayerSocketOffset = {
  handHeight: -0.06,
  forwardOffset: 0.56,
  sideOffset: 0,
};
