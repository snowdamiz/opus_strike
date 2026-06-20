import { MOVEMENT_SUBSTEP_SECONDS } from '@voxel-strike/shared';

const TERRAIN_STEP_VISUAL_SNAP_THRESHOLD = 1.35;
const TERRAIN_STEP_VISUAL_UP_RATE = 16;
const TERRAIN_STEP_VISUAL_DOWN_RATE = 28;
const TERRAIN_STEP_VISUAL_MAX_RISE_SPEED = 3.2;
const TERRAIN_STEP_VISUAL_MAX_DROP_SPEED = 6.5;
const LOCAL_VISUAL_INTERPOLATION_RESET_DISTANCE_SQ = 1.8 * 1.8;

export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

export interface LocalVisualInterpolationState {
  previous: MutableVec3;
  current: MutableVec3;
  initialized: boolean;
}

export function createLocalVisualInterpolationState(): LocalVisualInterpolationState {
  return {
    previous: { x: 0, y: 0, z: 0 },
    current: { x: 0, y: 0, z: 0 },
    initialized: false,
  };
}

function copyMutableVec3(target: MutableVec3, source: MutableVec3): void {
  target.x = source.x;
  target.y = source.y;
  target.z = source.z;
}

function distanceSq(a: MutableVec3, b: MutableVec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function resetLocalVisualInterpolation(
  interpolation: LocalVisualInterpolationState,
  position: MutableVec3
): void {
  copyMutableVec3(interpolation.previous, position);
  copyMutableVec3(interpolation.current, position);
  interpolation.initialized = true;
}

export function recordLocalVisualFixedStep(
  interpolation: LocalVisualInterpolationState,
  previousPosition: MutableVec3,
  currentPosition: MutableVec3
): void {
  if (
    !interpolation.initialized ||
    distanceSq(interpolation.current, previousPosition) > LOCAL_VISUAL_INTERPOLATION_RESET_DISTANCE_SQ
  ) {
    resetLocalVisualInterpolation(interpolation, previousPosition);
  }

  copyMutableVec3(interpolation.previous, previousPosition);
  copyMutableVec3(interpolation.current, currentPosition);
  interpolation.initialized = true;
}

export function sampleLocalVisualInterpolatedPosition(
  interpolation: LocalVisualInterpolationState,
  fallbackPosition: MutableVec3,
  accumulatorSeconds: number,
  target: MutableVec3
): MutableVec3 {
  if (
    !interpolation.initialized ||
    distanceSq(interpolation.current, fallbackPosition) > LOCAL_VISUAL_INTERPOLATION_RESET_DISTANCE_SQ
  ) {
    resetLocalVisualInterpolation(interpolation, fallbackPosition);
  }

  const alpha = Math.max(0, Math.min(1, accumulatorSeconds / MOVEMENT_SUBSTEP_SECONDS));
  target.x = interpolation.previous.x + (interpolation.current.x - interpolation.previous.x) * alpha;
  target.y = interpolation.previous.y + (interpolation.current.y - interpolation.previous.y) * alpha;
  target.z = interpolation.previous.z + (interpolation.current.z - interpolation.previous.z) * alpha;
  return target;
}

export function smoothTerrainVisualY(
  previousY: number | null,
  targetY: number,
  dt: number,
  isGrounded: boolean
): number {
  if (previousY === null || !Number.isFinite(previousY) || !Number.isFinite(targetY)) {
    return targetY;
  }

  const delta = targetY - previousY;
  if (!isGrounded || Math.abs(delta) <= 0.001 || Math.abs(delta) > TERRAIN_STEP_VISUAL_SNAP_THRESHOLD) {
    return targetY;
  }

  if (delta > 0) {
    const rise = Math.min(
      delta * (1 - Math.exp(-TERRAIN_STEP_VISUAL_UP_RATE * dt)),
      TERRAIN_STEP_VISUAL_MAX_RISE_SPEED * dt
    );
    return previousY + Math.max(0.001, rise);
  }

  const drop = Math.max(
    delta * (1 - Math.exp(-TERRAIN_STEP_VISUAL_DOWN_RATE * dt)),
    -TERRAIN_STEP_VISUAL_MAX_DROP_SPEED * dt
  );
  return previousY + Math.min(-0.001, drop);
}
