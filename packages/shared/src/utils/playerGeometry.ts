import {
  DEFAULT_SPAWN_OFFSET,
  PLAYER_COMBAT_HITBOX_PADDING,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  type PlayerSocketOffset,
  type SpawnOffset,
} from '../constants/physics.js';
import { HERO_DEFINITIONS } from '../constants/heroes.js';
import type { HeroId } from '../types/hero.js';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface PlayerGeometryTarget {
  position: Vec3Like;
  heroId?: HeroId | string | null;
}

export interface PlayerCombatHitbox {
  center: Vec3Like;
  radius: number;
  halfHeight: number;
}

export interface PlayerCombatHitResult {
  targetPoint: Vec3Like;
  rayPoint: Vec3Like;
  distance: number;
  radius: number;
}

const LINE_OF_SIGHT_VERTICAL_FACTORS = [0.72, 0.32, 0, -0.32, -0.72] as const;
const LINE_OF_SIGHT_RING_VERTICAL_FACTORS = [0.32, 0, -0.32] as const;
const LINE_OF_SIGHT_RING_DIRECTIONS = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
  { x: 1, z: 1 },
  { x: 1, z: -1 },
  { x: -1, z: 1 },
  { x: -1, z: -1 },
] as const;

const DEFAULT_PLAYER_SIZE = {
  width: PLAYER_RADIUS * 2,
  height: PLAYER_HEIGHT,
  depth: PLAYER_RADIUS * 2,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dot(a: Vec3Like, b: Vec3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function getHeroSize(heroId: PlayerGeometryTarget['heroId']) {
  const definition = typeof heroId === 'string'
    ? HERO_DEFINITIONS[heroId as HeroId]
    : null;
  return definition?.stats.size ?? DEFAULT_PLAYER_SIZE;
}

/**
 * Player positions are capsule/model centers. Feet are `position.y - height / 2`.
 */
export function getPlayerCombatHitbox(target: PlayerGeometryTarget): PlayerCombatHitbox {
  const size = getHeroSize(target.heroId);

  return {
    center: target.position,
    radius: Math.max(size.width, size.depth) / 2 + PLAYER_COMBAT_HITBOX_PADDING,
    halfHeight: size.height / 2 + PLAYER_COMBAT_HITBOX_PADDING,
  };
}

export function getPlayerEyePosition(position: Vec3Like): Vec3Like {
  return {
    x: position.x,
    y: position.y + PLAYER_EYE_HEIGHT,
    z: position.z,
  };
}

export function getPlayerBodyAimPosition(target: PlayerGeometryTarget): Vec3Like {
  return {
    x: target.position.x,
    y: target.position.y,
    z: target.position.z,
  };
}

function pushUniquePoint(points: Vec3Like[], point: Vec3Like): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return;
  const exists = points.some((existing) => (
    Math.abs(existing.x - point.x) < 0.0001 &&
    Math.abs(existing.y - point.y) < 0.0001 &&
    Math.abs(existing.z - point.z) < 0.0001
  ));
  if (!exists) {
    points.push(point);
  }
}

export function getPlayerLineOfSightSamplePoints(target: PlayerGeometryTarget): Vec3Like[] {
  const size = getHeroSize(target.heroId);
  const halfWidth = size.width / 2;
  const halfDepth = size.depth / 2;
  const halfHeight = size.height / 2;
  const points: Vec3Like[] = [];

  pushUniquePoint(points, getPlayerEyePosition(target.position));
  for (const verticalFactor of LINE_OF_SIGHT_VERTICAL_FACTORS) {
    pushUniquePoint(points, {
      x: target.position.x,
      y: target.position.y + halfHeight * verticalFactor,
      z: target.position.z,
    });
  }

  for (const verticalFactor of LINE_OF_SIGHT_RING_VERTICAL_FACTORS) {
    const y = target.position.y + halfHeight * verticalFactor;
    for (const direction of LINE_OF_SIGHT_RING_DIRECTIONS) {
      pushUniquePoint(points, {
        x: target.position.x + halfWidth * direction.x,
        y,
        z: target.position.z + halfDepth * direction.z,
      });
    }
  }

  return points;
}

export function calculateProjectileSpawn(
  position: Vec3Like,
  direction: Vec3Like,
  offset: SpawnOffset = DEFAULT_SPAWN_OFFSET
): Vec3Like {
  return {
    x: position.x + direction.x * offset.forwardOffset,
    y: position.y + offset.eyeHeight - offset.handDrop + direction.y * offset.forwardOffset,
    z: position.z + direction.z * offset.forwardOffset,
  };
}

export function calculatePlayerSocketPosition(
  position: Vec3Like,
  yaw: number,
  offset: PlayerSocketOffset
): Vec3Like {
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  return {
    x: position.x + forwardX * offset.forwardOffset + rightX * offset.sideOffset,
    y: position.y + offset.handHeight,
    z: position.z + forwardZ * offset.forwardOffset + rightZ * offset.sideOffset,
  };
}

export function calculateLookDirection(yaw: number, pitch: number): Vec3Like {
  return {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  };
}

export function calculateHorizontalLookDirection(yaw: number): { x: number; z: number } {
  return {
    x: -Math.sin(yaw),
    z: -Math.cos(yaw),
  };
}

export function isPointInsidePlayerCombatHitbox(
  point: Vec3Like,
  target: PlayerGeometryTarget,
  extraRadius = 0
): boolean {
  const hitbox = getPlayerCombatHitbox(target);
  const radius = hitbox.radius + extraRadius;
  const segmentHalfHeight = Math.max(0, hitbox.halfHeight - hitbox.radius);
  const closestY = clamp(
    point.y,
    hitbox.center.y - segmentHalfHeight,
    hitbox.center.y + segmentHalfHeight
  );
  const dx = point.x - hitbox.center.x;
  const dy = point.y - closestY;
  const dz = point.z - hitbox.center.z;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

export function getClosestSegmentPoints(
  firstStart: Vec3Like,
  firstEnd: Vec3Like,
  secondStart: Vec3Like,
  secondEnd: Vec3Like
): {
  first: Vec3Like;
  second: Vec3Like;
  firstT: number;
  secondT: number;
  distanceSq: number;
} {
  const d1 = {
    x: firstEnd.x - firstStart.x,
    y: firstEnd.y - firstStart.y,
    z: firstEnd.z - firstStart.z,
  };
  const d2 = {
    x: secondEnd.x - secondStart.x,
    y: secondEnd.y - secondStart.y,
    z: secondEnd.z - secondStart.z,
  };
  const r = {
    x: firstStart.x - secondStart.x,
    y: firstStart.y - secondStart.y,
    z: firstStart.z - secondStart.z,
  };
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);

  let firstT = 0;
  let secondT = 0;
  if (a <= 0.000001 && e <= 0.000001) {
    firstT = 0;
    secondT = 0;
  } else if (a <= 0.000001) {
    firstT = 0;
    secondT = clamp(f / e, 0, 1);
  } else {
    const c = dot(d1, r);
    if (e <= 0.000001) {
      secondT = 0;
      firstT = clamp(-c / a, 0, 1);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      firstT = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;

      const secondNumerator = b * firstT + f;
      if (secondNumerator < 0) {
        secondT = 0;
        firstT = clamp(-c / a, 0, 1);
      } else if (secondNumerator > e) {
        secondT = 1;
        firstT = clamp((b - c) / a, 0, 1);
      } else {
        secondT = secondNumerator / e;
      }
    }
  }

  const first = {
    x: firstStart.x + d1.x * firstT,
    y: firstStart.y + d1.y * firstT,
    z: firstStart.z + d1.z * firstT,
  };
  const second = {
    x: secondStart.x + d2.x * secondT,
    y: secondStart.y + d2.y * secondT,
    z: secondStart.z + d2.z * secondT,
  };
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  const dz = first.z - second.z;

  return {
    first,
    second,
    firstT,
    secondT,
    distanceSq: dx * dx + dy * dy + dz * dz,
  };
}

export function getSegmentHitAgainstPlayerCombatHitbox(
  start: Vec3Like,
  direction: Vec3Like,
  distance: number,
  target: PlayerGeometryTarget,
  extraRadius = 0
): PlayerCombatHitResult | null {
  const hitbox = getPlayerCombatHitbox(target);
  const radius = hitbox.radius + extraRadius;

  if (distance <= 0.0001) {
    return isPointInsidePlayerCombatHitbox(start, target, extraRadius)
      ? { targetPoint: getPlayerBodyAimPosition(target), rayPoint: start, distance: 0, radius }
      : null;
  }

  const segmentHalfHeight = Math.max(0, hitbox.halfHeight - hitbox.radius);
  const bodyStart = {
    x: hitbox.center.x,
    y: hitbox.center.y - segmentHalfHeight,
    z: hitbox.center.z,
  };
  const bodyEnd = {
    x: hitbox.center.x,
    y: hitbox.center.y + segmentHalfHeight,
    z: hitbox.center.z,
  };
  const rayEnd = {
    x: start.x + direction.x * distance,
    y: start.y + direction.y * distance,
    z: start.z + direction.z * distance,
  };
  const closest = getClosestSegmentPoints(start, rayEnd, bodyStart, bodyEnd);
  if (closest.distanceSq > radius * radius) return null;

  const rayDx = rayEnd.x - start.x;
  const rayDy = rayEnd.y - start.y;
  const rayDz = rayEnd.z - start.z;
  const rayLength = Math.sqrt(rayDx * rayDx + rayDy * rayDy + rayDz * rayDz);
  return {
    targetPoint: closest.second,
    rayPoint: closest.first,
    distance: rayLength * closest.firstT,
    radius,
  };
}

export function doesSegmentHitPlayerCombatHitbox(
  start: Vec3Like,
  direction: Vec3Like,
  distance: number,
  target: PlayerGeometryTarget,
  extraRadius = 0
): boolean {
  const size = getHeroSize(target.heroId);
  const baseRadius = Math.max(size.width, size.depth) / 2 + PLAYER_COMBAT_HITBOX_PADDING;
  const radius = baseRadius + extraRadius;
  const segmentHalfHeight = Math.max(0, size.height / 2 + PLAYER_COMBAT_HITBOX_PADDING - baseRadius);
  const center = target.position;

  if (distance <= 0.0001) {
    const closestY = clamp(
      start.y,
      center.y - segmentHalfHeight,
      center.y + segmentHalfHeight
    );
    const dx = start.x - center.x;
    const dy = start.y - closestY;
    const dz = start.z - center.z;
    return dx * dx + dy * dy + dz * dz <= radius * radius;
  }

  const firstDx = direction.x * distance;
  const firstDy = direction.y * distance;
  const firstDz = direction.z * distance;
  const secondDy = segmentHalfHeight * 2;
  const rx = start.x - center.x;
  const ry = start.y - (center.y - segmentHalfHeight);
  const rz = start.z - center.z;

  const a = firstDx * firstDx + firstDy * firstDy + firstDz * firstDz;
  const e = secondDy * secondDy;
  const radiusSq = radius * radius;

  if (a <= 0.000001 && e <= 0.000001) {
    return rx * rx + ry * ry + rz * rz <= radiusSq;
  }

  let firstT = 0;
  let secondT = 0;
  if (a <= 0.000001) {
    secondT = clamp(ry / e, 0, 1);
  } else {
    const c = firstDx * rx + firstDy * ry + firstDz * rz;
    if (e <= 0.000001) {
      firstT = clamp(-c / a, 0, 1);
    } else {
      const b = firstDy * secondDy;
      const f = secondDy * ry;
      const denom = a * e - b * b;

      firstT = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      const secondNumerator = b * firstT + f;

      if (secondNumerator < 0) {
        secondT = 0;
        firstT = clamp(-c / a, 0, 1);
      } else if (secondNumerator > e) {
        secondT = 1;
        firstT = clamp((b - c) / a, 0, 1);
      } else {
        secondT = secondNumerator / e;
      }
    }
  }

  const closestDx = rx + firstDx * firstT;
  const closestDy = ry + firstDy * firstT - secondDy * secondT;
  const closestDz = rz + firstDz * firstT;
  return closestDx * closestDx + closestDy * closestDy + closestDz * closestDz <= radiusSq;
}
