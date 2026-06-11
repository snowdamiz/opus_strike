import type { Vec3 } from '@voxel-strike/shared';
import type { MovementAabb, MovementCollisionBounds } from './CapsuleMotor.js';

export const ANCHOR_WALL_SPEED = 42;
export const ANCHOR_WALL_SEGMENT_SPACING = 2.35;
export const ANCHOR_WALL_FIRST_SEGMENT_DISTANCE = 6.25;
export const ANCHOR_WALL_MAX_HEIGHT = 4.15;
export const ANCHOR_WALL_WIDTH = 3.25;
export const ANCHOR_WALL_DEPTH = 1.05;
export const ANCHOR_WALL_SEGMENT_BACKSET = 0.85;
export const ANCHOR_WALL_COLLIDER_PREFIX = 'anchorwall_';

export interface AnchorWallCollisionSource {
  id: string;
  startPosition: Vec3;
  direction: Vec3;
  startTime: number;
  duration: number;
  maxDistance: number;
}

function normalize2D(direction: Vec3): Vec3 {
  const length = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
  if (length <= 0.00001) return { x: 0, y: 0, z: -1 };
  return { x: direction.x / length, y: 0, z: direction.z / length };
}

function seededRange(index: number, salt: number, min: number, max: number): number {
  const raw = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  const unit = raw - Math.floor(raw);
  return min + unit * (max - min);
}

function boundsOverlap(a: MovementCollisionBounds, b: MovementCollisionBounds): boolean {
  return (
    a.min.x <= b.max.x &&
    a.max.x >= b.min.x &&
    a.min.y <= b.max.y &&
    a.max.y >= b.min.y &&
    a.min.z <= b.max.z &&
    a.max.z >= b.min.z
  );
}

export function computeAnchorWallCollisionRevision(
  walls: readonly AnchorWallCollisionSource[],
  nowMs: number
): number {
  let revision = 0;
  for (const wall of walls) {
    const ageMs = nowMs - wall.startTime;
    if (ageMs < 0 || ageMs > wall.duration * 1000) continue;

    const bucket = Math.floor(Math.min(wall.maxDistance, (ageMs / 1000) * ANCHOR_WALL_SPEED) / ANCHOR_WALL_SEGMENT_SPACING);
    for (let index = 0; index < wall.id.length; index++) {
      revision = ((revision * 31) + wall.id.charCodeAt(index)) >>> 0;
    }
    revision = (revision + bucket + Math.floor(wall.startTime)) >>> 0;
  }
  return revision;
}

export function computeAnchorWallAabbs(
  walls: readonly AnchorWallCollisionSource[],
  nowMs: number,
  bounds?: MovementCollisionBounds
): MovementAabb[] {
  const aabbs: MovementAabb[] = [];

  for (const wall of walls) {
    const elapsedSeconds = (nowMs - wall.startTime) / 1000;
    if (elapsedSeconds < 0 || elapsedSeconds > wall.duration) continue;

    const direction = normalize2D(wall.direction);
    const right = { x: -direction.z, z: direction.x };
    const currentDistance = Math.min(wall.maxDistance, elapsedSeconds * ANCHOR_WALL_SPEED);
    if (currentDistance < ANCHOR_WALL_FIRST_SEGMENT_DISTANCE) continue;

    const segmentCount = Math.floor(
      (currentDistance - ANCHOR_WALL_FIRST_SEGMENT_DISTANCE) / ANCHOR_WALL_SEGMENT_SPACING
    ) + 1;

    for (let index = 0; index < segmentCount; index++) {
      const distance = ANCHOR_WALL_FIRST_SEGMENT_DISTANCE + index * ANCHOR_WALL_SEGMENT_SPACING;
      if (distance > wall.maxDistance || distance > currentDistance) break;

      const width = ANCHOR_WALL_WIDTH * seededRange(index, 92, 0.9, 1.08);
      const depth = ANCHOR_WALL_DEPTH * seededRange(index, 93, 0.92, 1.16);
      const height = ANCHOR_WALL_MAX_HEIGHT * seededRange(index, 91, 0.86, 1.08);
      const center = {
        x: wall.startPosition.x + direction.x * (distance - ANCHOR_WALL_SEGMENT_BACKSET),
        y: wall.startPosition.y,
        z: wall.startPosition.z + direction.z * (distance - ANCHOR_WALL_SEGMENT_BACKSET),
      };

      const halfX = Math.abs(right.x) * (width / 2) + Math.abs(direction.x) * (depth / 2);
      const halfZ = Math.abs(right.z) * (width / 2) + Math.abs(direction.z) * (depth / 2);
      const aabb: MovementAabb = {
        id: `${ANCHOR_WALL_COLLIDER_PREFIX}${wall.id}_${index}`,
        min: {
          x: center.x - halfX,
          y: center.y,
          z: center.z - halfZ,
        },
        max: {
          x: center.x + halfX,
          y: center.y + height,
          z: center.z + halfZ,
        },
      };

      if (!bounds || boundsOverlap(bounds, aabb)) {
        aabbs.push(aabb);
      }
    }
  }

  return aabbs;
}
