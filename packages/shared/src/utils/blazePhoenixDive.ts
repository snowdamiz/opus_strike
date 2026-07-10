import {
  BLAZE_PHOENIX_DIVE_FALL_SPEED,
  BLAZE_PHOENIX_DIVE_HOVER_FORWARD_DECAY,
  BLAZE_PHOENIX_DIVE_HOVER_MIN_FORWARD_SPEED,
  BLAZE_PHOENIX_DIVE_HOVER_SETTLE_SPEED,
  BLAZE_PHOENIX_DIVE_HOVER_VERTICAL_DECAY,
  BLAZE_PHOENIX_DIVE_LAUNCH_FORWARD_FORCE,
  BLAZE_PHOENIX_DIVE_LAUNCH_VERTICAL_FORCE,
  BLAZE_PHOENIX_DIVE_START_HEIGHT,
} from '../constants/physics.js';
import type { Vec3 } from '../types/vector.js';

function cleanDirectionComponent(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value;
}

export interface BlazePhoenixDiveHoverMotion {
  directionX: number;
  directionZ: number;
  initialForwardSpeed: number;
  initialVerticalSpeed: number;
  startedAtMs: number;
}

export function calculateBlazePhoenixDiveLaunchVelocity(currentVelocity: Vec3, lookYaw: number): Vec3 {
  const forwardX = cleanDirectionComponent(-Math.sin(lookYaw));
  const forwardZ = cleanDirectionComponent(-Math.cos(lookYaw));
  return {
    x: currentVelocity.x + forwardX * BLAZE_PHOENIX_DIVE_LAUNCH_FORWARD_FORCE,
    y: Math.max(BLAZE_PHOENIX_DIVE_LAUNCH_VERTICAL_FORCE, currentVelocity.y + BLAZE_PHOENIX_DIVE_LAUNCH_VERTICAL_FORCE),
    z: currentVelocity.z + forwardZ * BLAZE_PHOENIX_DIVE_LAUNCH_FORWARD_FORCE,
  };
}

export function createBlazePhoenixDiveHoverMotion(
  currentVelocity: Vec3,
  lookYaw: number,
  startedAtMs: number,
): BlazePhoenixDiveHoverMotion {
  const directionX = cleanDirectionComponent(-Math.sin(lookYaw));
  const directionZ = cleanDirectionComponent(-Math.cos(lookYaw));
  const forwardSpeed = currentVelocity.x * directionX + currentVelocity.z * directionZ;
  return {
    directionX,
    directionZ,
    initialForwardSpeed: Math.max(BLAZE_PHOENIX_DIVE_HOVER_MIN_FORWARD_SPEED, forwardSpeed),
    initialVerticalSpeed: Math.max(0, currentVelocity.y),
    startedAtMs,
  };
}

export function getBlazePhoenixDiveHoverVelocity(
  motion: BlazePhoenixDiveHoverMotion,
  nowMs: number,
): Vec3 {
  const elapsedSeconds = Math.max(0, nowMs - motion.startedAtMs) / 1000;
  const forwardBlend = Math.exp(-BLAZE_PHOENIX_DIVE_HOVER_FORWARD_DECAY * elapsedSeconds);
  const verticalBlend = Math.exp(-BLAZE_PHOENIX_DIVE_HOVER_VERTICAL_DECAY * elapsedSeconds);
  const forwardSpeed = BLAZE_PHOENIX_DIVE_HOVER_MIN_FORWARD_SPEED +
    (motion.initialForwardSpeed - BLAZE_PHOENIX_DIVE_HOVER_MIN_FORWARD_SPEED) * forwardBlend;
  const verticalSpeed = motion.initialVerticalSpeed * verticalBlend -
    BLAZE_PHOENIX_DIVE_HOVER_SETTLE_SPEED * (1 - verticalBlend);
  return {
    x: motion.directionX * forwardSpeed,
    y: verticalSpeed,
    z: motion.directionZ * forwardSpeed,
  };
}

export function getBlazePhoenixDiveStartPosition(currentPosition: Vec3, targetPosition: Vec3): Vec3 {
  return {
    x: targetPosition.x,
    y: Math.max(currentPosition.y, targetPosition.y + BLAZE_PHOENIX_DIVE_START_HEIGHT),
    z: targetPosition.z,
  };
}

export function getBlazePhoenixDiveVelocity(): Vec3 {
  return { x: 0, y: -BLAZE_PHOENIX_DIVE_FALL_SPEED, z: 0 };
}
