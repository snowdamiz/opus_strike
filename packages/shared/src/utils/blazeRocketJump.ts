import {
  BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE,
  BLAZE_ROCKET_JUMP_VERTICAL_FORCE,
} from '../constants/physics.js';
import type { Vec3 } from '../types/vector.js';

export function calculateBlazeRocketJumpVelocity(currentVelocity: Vec3, lookYaw: number): Vec3 {
  const forwardX = -Math.sin(lookYaw);
  const forwardZ = -Math.cos(lookYaw);
  const verticalVelocity = Math.max(
    BLAZE_ROCKET_JUMP_VERTICAL_FORCE,
    currentVelocity.y + BLAZE_ROCKET_JUMP_VERTICAL_FORCE
  );

  return {
    x: currentVelocity.x + forwardX * BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE,
    y: verticalVelocity,
    z: currentVelocity.z + forwardZ * BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE,
  };
}
