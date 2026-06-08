// World settings
export const GRAVITY = -25; // Slightly heavier fall than the previous floaty tuning
export const AIR_RESISTANCE = 0.01;
export const GROUND_FRICTION = 0.9;

// Movement multipliers (base speed/jump defined per-hero in heroes.ts)
export const SPRINT_MULTIPLIER = 1.2;
export const CROUCH_MULTIPLIER = 0.5;
export const AIR_CONTROL = 0.3;
export const MAX_JUMPS = 1;

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
export const STEP_HEIGHT = 0.5;

// Slide
export const SLIDE_SPEED_BOOST = 2.25; // Speed multiplier during slide
export const SLIDE_DURATION = 0.6; // Duration of slide in seconds
export const SLIDE_COOLDOWN = 0.8; // Cooldown before next slide
export const SLIDE_FRICTION = 0.982; // Friction applied during slide (higher = less slowdown)
export const MIN_SLIDE_SPEED = 5; // Minimum speed to initiate slide
export const SLIDE_INITIAL_BOOST = 2.25; // Initial speed boost when entering slide (ensures faster than sprint)

// Glacier Passive - Frozen Momentum (team slide boost when Glacier is on the team)
export const GLACIER_PASSIVE_SLIDE_SPEED_MULTIPLIER = 1.4; // 40% faster slides
export const GLACIER_PASSIVE_SLIDE_DURATION_MULTIPLIER = 1.5; // 50% longer slides (further distance)
export const GLACIER_PASSIVE_SLIDE_FRICTION = 0.99; // Less friction = slides further

// Crouch
export const CROUCH_TRANSITION_SPEED = 12; // How fast to transition camera height
export const CROUCH_HEIGHT_OFFSET = -0.4; // How much to lower the camera when crouching
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
export const GRAPPLE_MAX_DISTANCE = 40;
export const GRAPPLE_SPEED = 80;
export const GRAPPLE_PULL_FORCE = 35;
export const GRAPPLE_SWING_FORCE = 20;
export const GRAPPLE_DETACH_DISTANCE = 2;
export const GRAPPLE_MOMENTUM_TRANSFER = 0.8;

// Jetpack
export const JETPACK_MAX_FUEL = 100;
export const JETPACK_FUEL_CONSUMPTION = 30; // per second
export const JETPACK_FUEL_REGEN = 20; // per second when grounded
export const JETPACK_THRUST = 20;
export const JETPACK_HOVER_THRUST = 12;
export const JETPACK_MAX_VERTICAL_SPEED = 15;

// Blaze Flamethrower
export const BLAZE_FLAMETHROWER_MAX_FUEL = 100;
export const BLAZE_FLAMETHROWER_FUEL_DRAIN = 50; // per second
export const BLAZE_FLAMETHROWER_FUEL_REGEN = 18; // per second when grounded
export const BLAZE_FLAMETHROWER_RANGE = 9;
export const BLAZE_FLAMETHROWER_CONE_HALF_ANGLE = Math.PI / 5;
export const BLAZE_FLAMETHROWER_DAMAGE = 8;
export const BLAZE_FLAMETHROWER_DAMAGE_INTERVAL = 250; // ms between damage ticks
export const BLAZE_FLAMETHROWER_SOCKET_HAND_HEIGHT = 0.42;
export const BLAZE_FLAMETHROWER_SOCKET_FORWARD_OFFSET = 0.18;
export const BLAZE_FLAMETHROWER_SOCKET_SIDE_OFFSET = 0.14;

// Rocket Jump
export const BLAZE_ROCKET_JUMP_VERTICAL_FORCE = 11;
export const BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE = 1.5;

// Ice Wall Rush (Glacier E ability)
export const ICE_WALL_RUSH_MAX_FUEL = 100;
export const ICE_WALL_RUSH_FUEL_DRAIN = 60; // per second - depletes faster
export const ICE_WALL_RUSH_FUEL_REGEN = 15; // per second when grounded - slower regen
export const ICE_WALL_RUSH_REGEN_DELAY = 1000; // ms delay before regen starts after use
export const ICE_WALL_RUSH_SPEED = 14; // propulsion speed - slightly slower
export const ICE_WALL_SEGMENT_INTERVAL = 0.10; // Create wall segment every 150ms
export const ICE_WALL_SEGMENT_HEIGHT = 3.5; // Height of each wall segment
export const ICE_WALL_SEGMENT_WIDTH = 2.0; // Width of each wall segment  
export const ICE_WALL_SEGMENT_DEPTH = 0.8; // Thickness of wall
export const ICE_WALL_DURATION = 5; // How long wall segments last (seconds)

// Frost Storm Shield (Glacier Q ability)
export const FROST_STORM_SHIELD_AMOUNT = 75; // Shield HP
export const FROST_STORM_DURATION = 8; // Duration in seconds
export const FROST_STORM_COOLDOWN = 18; // Cooldown in seconds

// Glide
export const GLIDE_FALL_SPEED = -4;
export const GLIDE_FORWARD_BOOST = 1.3;
export const GLIDE_TURN_SPEED = 2;

// Dash / Blink
export const DASH_DISTANCE = 8;
export const DASH_DURATION = 0.15;
export const DASH_COOLDOWN = 4;
export const BLINK_MAX_DISTANCE = 12;
export const BLINK_COOLDOWN = 6;

// Player collision
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.48;
export const PLAYER_CROUCH_HEIGHT = 1.0;
export const PLAYER_MASS = 80;
