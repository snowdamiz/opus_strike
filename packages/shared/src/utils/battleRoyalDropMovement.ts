import type { PlayerInput } from '../types/player.js';
import type { Vec3 } from '../types/vector.js';
import { PITCH_LIMIT } from '../constants/physics.js';

export const BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED = 20;
export const BATTLE_ROYAL_DROP_POD_MIN_VERTICAL_SPEED = 12;
export const BATTLE_ROYAL_DROP_POD_MAX_VERTICAL_SPEED = 27;
export const BATTLE_ROYAL_DROP_POD_STEER_SPEED = 32;
export const BATTLE_ROYAL_DROP_POD_MOUSE_GUIDANCE_SPEED = 22;
export const BATTLE_ROYAL_DROP_POD_SPRINT_STEER_MULTIPLIER = 1.2;
export const BATTLE_ROYAL_DROP_POD_LANDING_CLEARANCE = 0.08;
const BATTLE_ROYAL_DROP_POD_GLIDE_BOOST = 0.35;
const BATTLE_ROYAL_DROP_POD_MIN_DIVE_HORIZONTAL_SCALE = 0.08;

export type BattleRoyalDropMovementInput = Pick<
  PlayerInput,
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'sprint'
  | 'lookYaw'
  | 'lookPitch'
>;

export interface BattleRoyalDropSteer {
  x: number;
  z: number;
  speed: number;
  multiplier: number;
  verticalSpeed: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getBattleRoyalDropVerticalSpeed(input: BattleRoyalDropMovementInput | null): number {
  if (!input) return BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED;

  const pitchRatio = clamp(input.lookPitch / PITCH_LIMIT, -1, 1);
  if (pitchRatio >= 0) {
    return BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED
      - (BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED - BATTLE_ROYAL_DROP_POD_MIN_VERTICAL_SPEED) * pitchRatio;
  }

  return BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED
    - (BATTLE_ROYAL_DROP_POD_MAX_VERTICAL_SPEED - BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED) * pitchRatio;
}

function getBattleRoyalDropGlideMultiplier(input: BattleRoyalDropMovementInput | null): number {
  if (!input) return 1;
  const pitchRatio = clamp(input.lookPitch / PITCH_LIMIT, -1, 1);
  return 1 + Math.max(0, pitchRatio) * BATTLE_ROYAL_DROP_POD_GLIDE_BOOST;
}

function getBattleRoyalDropHorizontalPitchScale(input: BattleRoyalDropMovementInput | null): number {
  if (!input) return 1;
  const pitchRatio = clamp(input.lookPitch / PITCH_LIMIT, -1, 1);
  const diveAmount = Math.max(0, -pitchRatio);
  return 1 - diveAmount * (1 - BATTLE_ROYAL_DROP_POD_MIN_DIVE_HORIZONTAL_SCALE);
}

export interface BattleRoyalDropPodMotionResult {
  position: Vec3;
  velocity: Vec3;
  landed: boolean;
  steer: BattleRoyalDropSteer;
}

export function getBattleRoyalDropInputSteer(
  input: BattleRoyalDropMovementInput | null
): BattleRoyalDropSteer {
  if (!input) {
    return {
      x: 0,
      z: 0,
      speed: 0,
      multiplier: 1,
      verticalSpeed: BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED,
    };
  }

  const forwardX = -Math.sin(input.lookYaw);
  const forwardZ = -Math.cos(input.lookYaw);
  const rightX = Math.cos(input.lookYaw);
  const rightZ = -Math.sin(input.lookYaw);
  let x = 0;
  let z = 0;
  if (input.moveForward) {
    x += forwardX;
    z += forwardZ;
  }
  if (input.moveBackward) {
    x -= forwardX;
    z -= forwardZ;
  }
  if (input.moveRight) {
    x += rightX;
    z += rightZ;
  }
  if (input.moveLeft) {
    x -= rightX;
    z -= rightZ;
  }

  const multiplier = (input.sprint ? BATTLE_ROYAL_DROP_POD_SPRINT_STEER_MULTIPLIER : 1)
    * getBattleRoyalDropGlideMultiplier(input)
    * getBattleRoyalDropHorizontalPitchScale(input);
  const verticalSpeed = getBattleRoyalDropVerticalSpeed(input);
  const length = Math.hypot(x, z);
  if (length > 0.001) {
    return {
      x: x / length,
      z: z / length,
      speed: BATTLE_ROYAL_DROP_POD_STEER_SPEED,
      multiplier,
      verticalSpeed,
    };
  }

  return {
    x: forwardX,
    z: forwardZ,
    speed: BATTLE_ROYAL_DROP_POD_MOUSE_GUIDANCE_SPEED,
    multiplier,
    verticalSpeed,
  };
}

export function advanceBattleRoyalDropPodMotion(input: {
  position: Vec3;
  input: BattleRoyalDropMovementInput | null;
  dt: number;
  getGroundY: (position: Vec3) => number | null;
  clampToPlayableMap: (position: Vec3) => Vec3;
}): BattleRoyalDropPodMotionResult {
  const dt = Math.max(0, input.dt);
  const steer = getBattleRoyalDropInputSteer(input.input);
  const horizontalSpeed = steer.speed * steer.multiplier;
  const proposed = input.clampToPlayableMap({
    x: input.position.x + steer.x * horizontalSpeed * dt,
    y: input.position.y,
    z: input.position.z + steer.z * horizontalSpeed * dt,
  });
  const groundY = input.getGroundY(proposed) ?? 0;
  const landingY = groundY + BATTLE_ROYAL_DROP_POD_LANDING_CLEARANCE;
  const nextY = Math.max(landingY, input.position.y - steer.verticalSpeed * dt);
  const landed = nextY <= landingY + 0.001;
  const position = {
    x: proposed.x,
    y: landed ? landingY : nextY,
    z: proposed.z,
  };

  return {
    position,
    velocity: landed
      ? { x: 0, y: 0, z: 0 }
      : {
        x: steer.x * horizontalSpeed,
        y: -steer.verticalSpeed,
        z: steer.z * horizontalSpeed,
      },
    landed,
    steer,
  };
}
