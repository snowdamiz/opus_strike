import {
  PHANTOM_RIFT_BOLT_MAX_DISTANCE,
  PHANTOM_RIFT_BOLT_SPEED,
} from '../constants/heroes.js';
import type { Vec3 } from '../types/vector.js';

export interface PhantomRiftBoltPath {
  startPosition: Vec3;
  direction: Vec3;
  launchedAt: number;
  impactPosition?: Vec3;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function getPhantomRiftBoltTravelDistance(
  launchedAt: number,
  now: number,
  speed = PHANTOM_RIFT_BOLT_SPEED,
  maxDistance = PHANTOM_RIFT_BOLT_MAX_DISTANCE,
): number {
  return clamp(Math.max(0, now - launchedAt) / 1000 * speed, 0, maxDistance);
}

export function writePhantomRiftBoltPosition<T extends Partial<Vec3>>(
  out: T,
  path: PhantomRiftBoltPath,
  now: number,
): T & Vec3 {
  if (path.impactPosition) {
    out.x = path.impactPosition.x;
    out.y = path.impactPosition.y;
    out.z = path.impactPosition.z;
    return out as T & Vec3;
  }

  const distance = getPhantomRiftBoltTravelDistance(path.launchedAt, now);
  out.x = path.startPosition.x + path.direction.x * distance;
  out.y = path.startPosition.y + path.direction.y * distance;
  out.z = path.startPosition.z + path.direction.z * distance;
  return out as T & Vec3;
}

export function getPhantomRiftBoltPosition(path: PhantomRiftBoltPath, now: number): Vec3 {
  return writePhantomRiftBoltPosition({}, path, now);
}
