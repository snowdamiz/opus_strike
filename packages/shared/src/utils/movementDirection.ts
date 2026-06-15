import {
  MOVEMENT_BACKWARD_SPEED_MULTIPLIER,
  MOVEMENT_STRAFE_SPEED_MULTIPLIER,
} from '../constants/physics.js';

export interface DirectionalMovementInput {
  moveForward: boolean;
  moveBackward: boolean;
  moveLeft: boolean;
  moveRight: boolean;
}

export interface DirectionalMovementIntent {
  localX: number;
  localZ: number;
  hasMovementInput: boolean;
  hasBackwardIntent: boolean;
  allowsSprint: boolean;
  speedMultiplier: number;
}

const EPSILON = 0.00001;

export function resolveDirectionalMovementIntent(input: DirectionalMovementInput): DirectionalMovementIntent {
  let localX = 0;
  let localZ = 0;

  if (input.moveForward) localZ -= 1;
  if (input.moveBackward) localZ += 1;
  if (input.moveLeft) localX -= 1;
  if (input.moveRight) localX += 1;

  const length = Math.sqrt(localX * localX + localZ * localZ);
  if (length > EPSILON) {
    localX /= length;
    localZ /= length;
  } else {
    localX = 0;
    localZ = 0;
  }

  const hasMovementInput = length > EPSILON;
  const hasBackwardIntent = localZ > EPSILON;

  return {
    localX,
    localZ,
    hasMovementInput,
    hasBackwardIntent,
    allowsSprint: hasMovementInput && !hasBackwardIntent,
    speedMultiplier: getDirectionalMovementSpeedMultiplier(localX, localZ),
  };
}

export function getDirectionalMovementSpeedMultiplier(localX: number, localZ: number): number {
  const strafe = Math.abs(localX);
  const forward = Math.max(0, -localZ);
  const backward = Math.max(0, localZ);
  const total = strafe + forward + backward;

  if (total <= EPSILON) return 1;

  return (
    forward +
    strafe * MOVEMENT_STRAFE_SPEED_MULTIPLIER +
    backward * MOVEMENT_BACKWARD_SPEED_MULTIPLIER
  ) / total;
}
