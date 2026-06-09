import { PLAYER_HEIGHT } from '../../constants/physics.js';
import type { Vec3 } from '../../types/vector.js';
import type { VoxelMapManifest } from './types.js';

export const UNSTUCK_TERRAIN_SCAN_RADIUS = 2.75;
export const UNSTUCK_TERRAIN_MIN_HEIGHT_ABOVE_FEET = 0.15;
export const UNSTUCK_HORIZONTAL_VELOCITY = 8.5;

interface UnstuckTerrainCandidate {
  score: number;
  distance: number;
  topY: number;
  x: number;
  z: number;
}

export interface UnstuckTerrainShove {
  direction: { x: number; z: number };
  source: { x: number; y: number; z: number };
  distance: number;
}

export interface UnstuckTerrainShoveOptions {
  playerHeight?: number;
  scanRadius?: number;
  minHeightAboveFeet?: number;
}

export function findUnstuckTerrainShove(
  manifest: VoxelMapManifest,
  position: Vec3,
  options: UnstuckTerrainShoveOptions = {}
): UnstuckTerrainShove | null {
  const heightfield = manifest.heightfield;
  const playerHeight = options.playerHeight ?? PLAYER_HEIGHT;
  const scanRadius = options.scanRadius ?? UNSTUCK_TERRAIN_SCAN_RADIUS;
  const minHeightAboveFeet = options.minHeightAboveFeet ?? UNSTUCK_TERRAIN_MIN_HEIGHT_ABOVE_FEET;
  const feetY = position.y - playerHeight / 2;
  const minObstacleTopY = feetY + minHeightAboveFeet;
  const centerGx = Math.floor((position.x - heightfield.origin.x) / heightfield.voxelSize.x);
  const centerGz = Math.floor((position.z - heightfield.origin.z) / heightfield.voxelSize.z);
  const radiusCellsX = Math.ceil(scanRadius / heightfield.voxelSize.x);
  const radiusCellsZ = Math.ceil(scanRadius / heightfield.voxelSize.z);
  const scanRadiusSq = scanRadius * scanRadius;

  let best: UnstuckTerrainCandidate | null = null;
  let aggregateAwayX = 0;
  let aggregateAwayZ = 0;

  for (let gx = centerGx - radiusCellsX; gx <= centerGx + radiusCellsX; gx++) {
    if (gx < 0 || gx >= heightfield.size.x) continue;

    for (let gz = centerGz - radiusCellsZ; gz <= centerGz + radiusCellsZ; gz++) {
      if (gz < 0 || gz >= heightfield.size.z) continue;

      const topRow = heightfield.topSolidRows[gx + gz * heightfield.size.x];
      if (topRow === 0) continue;

      const topY = heightfield.origin.y + topRow * heightfield.voxelSize.y;
      if (topY < minObstacleTopY) continue;

      const terrainX = heightfield.origin.x + (gx + 0.5) * heightfield.voxelSize.x;
      const terrainZ = heightfield.origin.z + (gz + 0.5) * heightfield.voxelSize.z;
      const awayX = position.x - terrainX;
      const awayZ = position.z - terrainZ;
      const distanceSq = awayX * awayX + awayZ * awayZ;
      if (distanceSq > scanRadiusSq) continue;

      const distance = Math.sqrt(distanceSq);
      const heightAboveFeet = topY - feetY;
      const score = heightAboveFeet * 4 + (scanRadius - distance);

      if (!best || score > best.score || (score === best.score && distance < best.distance)) {
        best = {
          score,
          distance,
          topY,
          x: terrainX,
          z: terrainZ,
        };
      }

      if (distance > 0.0001) {
        const weight = heightAboveFeet / Math.max(distance, heightfield.voxelSize.x);
        aggregateAwayX += (awayX / distance) * weight;
        aggregateAwayZ += (awayZ / distance) * weight;
      }
    }
  }

  if (!best) return null;

  let directionX = position.x - best.x;
  let directionZ = position.z - best.z;
  let directionLength = Math.sqrt(directionX * directionX + directionZ * directionZ);

  if (directionLength <= 0.0001) {
    directionX = aggregateAwayX;
    directionZ = aggregateAwayZ;
    directionLength = Math.sqrt(directionX * directionX + directionZ * directionZ);
  }

  if (directionLength <= 0.0001) return null;

  return {
    direction: {
      x: directionX / directionLength,
      z: directionZ / directionLength,
    },
    source: {
      x: best.x,
      y: best.topY,
      z: best.z,
    },
    distance: best.distance,
  };
}

export function applyUnstuckHorizontalShove(
  velocity: Vec3,
  direction: { x: number; z: number },
  speed = UNSTUCK_HORIZONTAL_VELOCITY
): Vec3 {
  const currentAwaySpeed = velocity.x * direction.x + velocity.z * direction.z;
  const boost = Math.max(0, speed - currentAwaySpeed);

  return {
    x: velocity.x + direction.x * boost,
    y: velocity.y,
    z: velocity.z + direction.z * boost,
  };
}
