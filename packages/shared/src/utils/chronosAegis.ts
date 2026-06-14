import type { Vec3Like } from './playerGeometry.js';

export const CHRONOS_AEGIS_SHIELD_HALF_WIDTH = 3.36;
export const CHRONOS_AEGIS_SHIELD_HALF_HEIGHT = 1.785;
export const CHRONOS_AEGIS_SHIELD_FORWARD_OFFSET = 1.85;
export const CHRONOS_AEGIS_SHIELD_CENTER_Y_OFFSET = 1.02;
export const CHRONOS_AEGIS_SOURCE_FRONT_MIN = 0.12;
export const CHRONOS_AEGIS_TARGET_BACK_MAX = 0.35;

const EPSILON = 0.0001;

export interface ChronosAegisPose {
  playerId?: string;
  position: Vec3Like;
  lookYaw: number;
  lookPitch?: number;
}

export interface ChronosAegisSegmentHit {
  playerId?: string;
  point: Vec3Like;
  normal: Vec3Like;
  distance: number;
  t: number;
}

export interface ChronosAegisSegmentHitOptions {
  projectileRadius?: number;
  requireSourceInFront?: boolean;
  sourceFrontMin?: number;
}

function dot(a: Vec3Like, b: Vec3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function subtract(a: Vec3Like, b: Vec3Like): Vec3Like {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

export function getChronosAegisForward(lookYaw: number): Vec3Like;
export function getChronosAegisForward(lookYaw: number, lookPitch: number): Vec3Like;
export function getChronosAegisForward(lookYaw: number, lookPitch = 0): Vec3Like {
  const cosPitch = Math.cos(lookPitch);
  return {
    x: -Math.sin(lookYaw) * cosPitch,
    y: Math.sin(lookPitch),
    z: -Math.cos(lookYaw) * cosPitch,
  };
}

export function getChronosAegisRight(lookYaw: number): Vec3Like {
  return {
    x: Math.cos(lookYaw),
    y: 0,
    z: -Math.sin(lookYaw),
  };
}

export function getChronosAegisUp(lookYaw: number, lookPitch = 0): Vec3Like {
  const right = getChronosAegisRight(lookYaw);
  const forward = getChronosAegisForward(lookYaw, lookPitch);
  const up = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  };
  const length = Math.sqrt(up.x * up.x + up.y * up.y + up.z * up.z);
  if (length <= EPSILON) {
    return { x: 0, y: 1, z: 0 };
  }
  return {
    x: up.x / length,
    y: up.y / length,
    z: up.z / length,
  };
}

export function getChronosAegisCenter(pose: ChronosAegisPose): Vec3Like {
  const forward = getChronosAegisForward(pose.lookYaw, pose.lookPitch ?? 0);
  return {
    x: pose.position.x + forward.x * CHRONOS_AEGIS_SHIELD_FORWARD_OFFSET,
    y: pose.position.y + CHRONOS_AEGIS_SHIELD_CENTER_Y_OFFSET + forward.y * CHRONOS_AEGIS_SHIELD_FORWARD_OFFSET,
    z: pose.position.z + forward.z * CHRONOS_AEGIS_SHIELD_FORWARD_OFFSET,
  };
}

export function getChronosAegisForwardDot(point: Vec3Like, pose: ChronosAegisPose): number {
  const center = getChronosAegisCenter(pose);
  return dot(subtract(point, center), getChronosAegisForward(pose.lookYaw, pose.lookPitch ?? 0));
}

export function getSegmentHitAgainstChronosAegis(
  start: Vec3Like,
  direction: Vec3Like,
  distance: number,
  pose: ChronosAegisPose,
  options: ChronosAegisSegmentHitOptions = {}
): ChronosAegisSegmentHit | null {
  if (distance <= EPSILON) return null;

  const directionLength = Math.sqrt(
    direction.x * direction.x +
    direction.y * direction.y +
    direction.z * direction.z
  );
  if (directionLength <= EPSILON) return null;

  const normalizedDirection = {
    x: direction.x / directionLength,
    y: direction.y / directionLength,
    z: direction.z / directionLength,
  };
  const segment = {
    x: normalizedDirection.x * distance,
    y: normalizedDirection.y * distance,
    z: normalizedDirection.z * distance,
  };
  const forward = getChronosAegisForward(pose.lookYaw, pose.lookPitch ?? 0);
  const center = getChronosAegisCenter(pose);

  if (options.requireSourceInFront ?? true) {
    const sourceFrontMin = options.sourceFrontMin ?? CHRONOS_AEGIS_SOURCE_FRONT_MIN;
    if (dot(subtract(start, center), forward) < sourceFrontMin) return null;
  }

  const denom = dot(segment, forward);
  if (Math.abs(denom) <= EPSILON) return null;

  const t = dot(subtract(center, start), forward) / denom;
  if (t < 0 || t > 1) return null;

  const point = {
    x: start.x + segment.x * t,
    y: start.y + segment.y * t,
    z: start.z + segment.z * t,
  };
  const intersectionOffset = subtract(point, center);
  const right = getChronosAegisRight(pose.lookYaw);
  const up = getChronosAegisUp(pose.lookYaw, pose.lookPitch ?? 0);
  const projectileRadius = Math.max(0, options.projectileRadius ?? 0);
  const lateral = dot(intersectionOffset, right);
  const vertical = dot(intersectionOffset, up);

  if (
    Math.abs(lateral) > CHRONOS_AEGIS_SHIELD_HALF_WIDTH + projectileRadius ||
    Math.abs(vertical) > CHRONOS_AEGIS_SHIELD_HALF_HEIGHT + projectileRadius
  ) {
    return null;
  }

  return {
    playerId: pose.playerId,
    point,
    normal: forward,
    distance: distance * t,
    t,
  };
}
