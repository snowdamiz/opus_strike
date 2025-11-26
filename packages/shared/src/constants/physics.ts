// World settings
export const GRAVITY = -30;
export const AIR_RESISTANCE = 0.01;
export const GROUND_FRICTION = 0.9;

// Base movement
export const BASE_MOVE_SPEED = 12;
export const SPRINT_MULTIPLIER = 1.4;
export const CROUCH_MULTIPLIER = 0.5;
export const AIR_CONTROL = 0.3;
export const BASE_JUMP_FORCE = 12;
export const MAX_JUMPS = 1;

// Look sensitivity
export const MOUSE_SENSITIVITY = 0.002;
export const PITCH_LIMIT = Math.PI / 2 - 0.1;

// Ground detection
export const GROUND_CHECK_DISTANCE = 0.1;
export const GROUND_NORMAL_THRESHOLD = 0.7;
export const STEP_HEIGHT = 0.5;

// Slide
export const SLIDE_SPEED_BOOST = 1.5;
export const SLIDE_DURATION = 0.8;
export const SLIDE_COOLDOWN = 1.5;
export const SLIDE_FRICTION = 0.98;
export const MIN_SLIDE_SPEED = 8;

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
export const PLAYER_RADIUS = 0.4;
export const PLAYER_CROUCH_HEIGHT = 1.0;
export const PLAYER_MASS = 80;

