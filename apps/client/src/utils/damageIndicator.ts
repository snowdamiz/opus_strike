export interface DamageIndicatorPosition {
  x: number;
  z: number;
}

export function getDamageIndicatorAngleDeg(input: {
  sourcePosition: DamageIndicatorPosition | null;
  sourceDirection?: DamageIndicatorPosition | null;
  targetPosition: DamageIndicatorPosition | null;
  lookYaw: number;
}): number | null {
  const { sourcePosition, targetPosition } = input;
  const positionDirection = sourcePosition && targetPosition
    ? {
        x: sourcePosition.x - targetPosition.x,
        z: sourcePosition.z - targetPosition.z,
      }
    : null;
  const impactDirection = input.sourceDirection
    ? {
        x: -input.sourceDirection.x,
        z: -input.sourceDirection.z,
      }
    : null;
  const sourceVector = getUsableDirection(positionDirection) ?? getUsableDirection(impactDirection);
  if (!sourceVector) return null;

  const lookYaw = Number.isFinite(input.lookYaw) ? input.lookYaw : 0;
  const forwardX = -Math.sin(lookYaw);
  const forwardZ = -Math.cos(lookYaw);
  const rightX = Math.cos(lookYaw);
  const rightZ = -Math.sin(lookYaw);
  const forwardDot = sourceVector.x * forwardX + sourceVector.z * forwardZ;
  const rightDot = sourceVector.x * rightX + sourceVector.z * rightZ;

  return Math.atan2(rightDot, forwardDot) * 180 / Math.PI;
}

function getUsableDirection(direction: DamageIndicatorPosition | null): DamageIndicatorPosition | null {
  if (!direction) return null;
  const lengthSq = direction.x * direction.x + direction.z * direction.z;
  if (!Number.isFinite(lengthSq) || lengthSq <= 0.0001) return null;
  return direction;
}
