import type { Vec3 } from '@voxel-strike/shared';
import type { MovementAabb, MovementCollisionBounds } from './CapsuleMotor.js';

export const ANCHOR_WALL_SPEED = 42;
export const ANCHOR_WALL_SEGMENT_SPACING = 2.35;
export const ANCHOR_WALL_FIRST_SEGMENT_DISTANCE = 6.25;
export const ANCHOR_WALL_MAX_HEIGHT = 4.15;
export const ANCHOR_WALL_WIDTH = 3.25;
export const ANCHOR_WALL_DEPTH = 1.05;
export const ANCHOR_WALL_RISE_SPEED = 14;
export const ANCHOR_WALL_SEGMENT_BACKSET = 0.85;
export const ANCHOR_WALL_COLLIDER_PREFIX = 'anchorwall_';
const ANCHOR_WALL_AABB_TIME_BUCKET_MS = 16;
const EMPTY_ANCHOR_WALL_AABBS: MovementAabb[] = [];

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

function scalarBoundsOverlap(
  bounds: MovementCollisionBounds,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number
): boolean {
  return (
    minX <= bounds.max.x &&
    maxX >= bounds.min.x &&
    minY <= bounds.max.y &&
    maxY >= bounds.min.y &&
    minZ <= bounds.max.z &&
    maxZ >= bounds.min.z
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
    const rightX = -direction.z;
    const rightZ = direction.x;
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
      const segmentAge = Math.max(0, elapsedSeconds - distance / ANCHOR_WALL_SPEED);
      const currentHeight = Math.max(0.05, Math.min(height, segmentAge * ANCHOR_WALL_RISE_SPEED));
      const centerX = wall.startPosition.x + direction.x * (distance - ANCHOR_WALL_SEGMENT_BACKSET);
      const centerY = wall.startPosition.y;
      const centerZ = wall.startPosition.z + direction.z * (distance - ANCHOR_WALL_SEGMENT_BACKSET);
      const halfX = Math.abs(rightX) * (width / 2) + Math.abs(direction.x) * (depth / 2);
      const halfZ = Math.abs(rightZ) * (width / 2) + Math.abs(direction.z) * (depth / 2);
      const minX = centerX - halfX;
      const minY = centerY;
      const minZ = centerZ - halfZ;
      const maxX = centerX + halfX;
      const maxY = centerY + currentHeight;
      const maxZ = centerZ + halfZ;

      if (bounds && !scalarBoundsOverlap(bounds, minX, minY, minZ, maxX, maxY, maxZ)) {
        continue;
      }

      const aabb: MovementAabb = {
        id: `${ANCHOR_WALL_COLLIDER_PREFIX}${wall.id}_${index}`,
        min: {
          x: minX,
          y: minY,
          z: minZ,
        },
        max: {
          x: maxX,
          y: maxY,
          z: maxZ,
        },
        pushCapsuleUpFromTop: currentHeight < height,
      };

      aabbs.push(aabb);
    }
  }

  return aabbs;
}

export class AnchorWallAabbCache {
  private cachedRevision = -1;
  private cachedTimeBucket = -1;
  private cachedAabbs: MovementAabb[] = EMPTY_ANCHOR_WALL_AABBS;
  private readonly filteredScratch: MovementAabb[] = [];

  clear(): void {
    this.cachedRevision = -1;
    this.cachedTimeBucket = -1;
    this.cachedAabbs = EMPTY_ANCHOR_WALL_AABBS;
    this.filteredScratch.length = 0;
  }

  get(
    walls: readonly AnchorWallCollisionSource[],
    nowMs: number,
    bounds?: MovementCollisionBounds
  ): readonly MovementAabb[] {
    if (walls.length === 0) {
      this.clear();
      return EMPTY_ANCHOR_WALL_AABBS;
    }

    const revision = computeAnchorWallCollisionRevision(walls, nowMs);
    const timeBucket = Math.floor(nowMs / ANCHOR_WALL_AABB_TIME_BUCKET_MS);
    if (this.cachedRevision !== revision || this.cachedTimeBucket !== timeBucket) {
      this.cachedRevision = revision;
      this.cachedTimeBucket = timeBucket;
      this.cachedAabbs = computeAnchorWallAabbs(walls, nowMs);
    }

    if (!bounds) return this.cachedAabbs;

    this.filteredScratch.length = 0;
    for (const aabb of this.cachedAabbs) {
      if (
        scalarBoundsOverlap(
          bounds,
          aabb.min.x,
          aabb.min.y,
          aabb.min.z,
          aabb.max.x,
          aabb.max.y,
          aabb.max.z
        )
      ) {
        this.filteredScratch.push(aabb);
      }
    }
    return this.filteredScratch;
  }
}
