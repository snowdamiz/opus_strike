import { PLAYER_HEIGHT, PLAYER_RADIUS } from '../../constants/physics.js';
import type { Vec3 } from '../../types/vector.js';
import type { VoxelMapManifest } from './types.js';

export const UNSTUCK_TERRAIN_SCAN_RADIUS = 2.75;
export const UNSTUCK_TERRAIN_MIN_HEIGHT_ABOVE_FEET = 0.15;
export const UNSTUCK_TELEPORT_SEARCH_RADIUS = 4.25;
export const UNSTUCK_TELEPORT_STEP = 0.5;
export const UNSTUCK_TELEPORT_GROUND_CLEARANCE = 0.05;

interface UnstuckTerrainSourceCandidate {
  score: number;
  distance: number;
  topY: number;
  x: number;
  z: number;
}

interface UnstuckTeleportCandidate {
  score: number;
  distance: number;
  position: Vec3;
}

export interface UnstuckTerrainTeleport {
  position: Vec3;
  direction: { x: number; z: number };
  source: { x: number; y: number; z: number };
  distance: number;
}

export interface UnstuckTerrainTeleportOptions {
  playerHeight?: number;
  playerRadius?: number;
  scanRadius?: number;
  minHeightAboveFeet?: number;
  teleportRadius?: number;
  teleportStep?: number;
  groundClearance?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getHeightfieldTopY(manifest: VoxelMapManifest, x: number, z: number): number | null {
  const heightfield = manifest.heightfield;
  const gx = Math.floor((x - heightfield.origin.x) / heightfield.voxelSize.x);
  const gz = Math.floor((z - heightfield.origin.z) / heightfield.voxelSize.z);
  if (gx < 0 || gx >= heightfield.size.x || gz < 0 || gz >= heightfield.size.z) {
    return null;
  }

  const topRow = heightfield.topSolidRows[gx + gz * heightfield.size.x];
  if (topRow === 0) return null;

  return heightfield.origin.y + topRow * heightfield.voxelSize.y;
}

function hasPlayerColliderClearance(
  manifest: VoxelMapManifest,
  position: Vec3,
  playerRadius: number,
  playerHeight: number
): boolean {
  const radius = playerRadius + 0.02;
  const radiusSq = radius * radius;
  const bodyMinY = position.y - playerHeight / 2 + 0.05;
  const bodyMaxY = position.y + playerHeight / 2 - 0.05;

  for (const collider of manifest.colliders) {
    const minY = collider.center.y - collider.halfExtents.y;
    const maxY = collider.center.y + collider.halfExtents.y;
    if (bodyMinY >= maxY || bodyMaxY <= minY) continue;

    const minX = collider.center.x - collider.halfExtents.x;
    const maxX = collider.center.x + collider.halfExtents.x;
    const minZ = collider.center.z - collider.halfExtents.z;
    const maxZ = collider.center.z + collider.halfExtents.z;
    const closestX = clamp(position.x, minX, maxX);
    const closestZ = clamp(position.z, minZ, maxZ);
    const dx = position.x - closestX;
    const dz = position.z - closestZ;

    if (dx * dx + dz * dz < radiusSq) {
      return false;
    }
  }

  return true;
}

export function findUnstuckTerrainTeleport(
  manifest: VoxelMapManifest,
  position: Vec3,
  options: UnstuckTerrainTeleportOptions = {}
): UnstuckTerrainTeleport | null {
  const heightfield = manifest.heightfield;
  const playerHeight = options.playerHeight ?? PLAYER_HEIGHT;
  const playerRadius = options.playerRadius ?? PLAYER_RADIUS;
  const scanRadius = options.scanRadius ?? UNSTUCK_TERRAIN_SCAN_RADIUS;
  const minHeightAboveFeet = options.minHeightAboveFeet ?? UNSTUCK_TERRAIN_MIN_HEIGHT_ABOVE_FEET;
  const teleportRadius = options.teleportRadius ?? UNSTUCK_TELEPORT_SEARCH_RADIUS;
  const teleportStep = options.teleportStep ?? UNSTUCK_TELEPORT_STEP;
  const groundClearance = options.groundClearance ?? UNSTUCK_TELEPORT_GROUND_CLEARANCE;
  const feetY = position.y - playerHeight / 2;
  const minObstacleTopY = feetY + minHeightAboveFeet;
  const centerGx = Math.floor((position.x - heightfield.origin.x) / heightfield.voxelSize.x);
  const centerGz = Math.floor((position.z - heightfield.origin.z) / heightfield.voxelSize.z);
  const radiusCellsX = Math.ceil(scanRadius / heightfield.voxelSize.x);
  const radiusCellsZ = Math.ceil(scanRadius / heightfield.voxelSize.z);
  const scanRadiusSq = scanRadius * scanRadius;

  let best: UnstuckTerrainSourceCandidate | null = null;
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

  const direction = {
    x: directionX / directionLength,
    z: directionZ / directionLength,
  };
  const source = {
    x: best.x,
    y: best.topY,
    z: best.z,
  };
  const perpendicular = { x: -direction.z, z: direction.x };
  const minTeleportDistance = Math.max(playerRadius + 0.2, teleportStep);
  const visited = new Set<string>();
  const destinationState: { best: UnstuckTeleportCandidate | null } = { best: null };

  const evaluateCandidate = (targetX: number, targetZ: number, bias: number): void => {
    const gx = Math.floor((targetX - heightfield.origin.x) / heightfield.voxelSize.x);
    const gz = Math.floor((targetZ - heightfield.origin.z) / heightfield.voxelSize.z);
    const key = `${gx}:${gz}:${Math.round(targetX / 0.1)}:${Math.round(targetZ / 0.1)}`;
    if (visited.has(key)) return;
    visited.add(key);

    const dx = targetX - position.x;
    const dz = targetZ - position.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance < minTeleportDistance || distance > teleportRadius) return;

    const alignment = (dx * direction.x + dz * direction.z) / distance;
    if (alignment < -0.1) return;

    const groundY = getHeightfieldTopY(manifest, targetX, targetZ);
    if (groundY === null) return;

    const candidatePosition = {
      x: targetX,
      y: groundY + playerHeight / 2 + groundClearance,
      z: targetZ,
    };
    if (!hasPlayerColliderClearance(manifest, candidatePosition, playerRadius, playerHeight)) {
      return;
    }

    const sourceDistance = Math.sqrt(
      (targetX - source.x) * (targetX - source.x) + (targetZ - source.z) * (targetZ - source.z)
    );
    const verticalPenalty = Math.abs(candidatePosition.y - position.y) * 0.35;
    const score = bias + alignment * 5 + (teleportRadius - distance) * 1.5 + sourceDistance * 0.2 - verticalPenalty;

    if (!destinationState.best || score > destinationState.best.score) {
      destinationState.best = {
        score,
        distance,
        position: candidatePosition,
      };
    }
  };

  for (let forward = minTeleportDistance; forward <= teleportRadius + 0.0001; forward += teleportStep) {
    const maxLateral = Math.min(forward * 0.75, playerRadius + heightfield.voxelSize.x + heightfield.voxelSize.z);
    for (let lateral = 0; lateral <= maxLateral + 0.0001; lateral += teleportStep) {
      const offsets = lateral === 0 ? [0] : [lateral, -lateral];
      for (const offset of offsets) {
        evaluateCandidate(
          position.x + direction.x * forward + perpendicular.x * offset,
          position.z + direction.z * forward + perpendicular.z * offset,
          2
        );
      }
    }
  }

  if (!destinationState.best) {
    for (let offsetX = -teleportRadius; offsetX <= teleportRadius + 0.0001; offsetX += teleportStep) {
      for (let offsetZ = -teleportRadius; offsetZ <= teleportRadius + 0.0001; offsetZ += teleportStep) {
        evaluateCandidate(position.x + offsetX, position.z + offsetZ, 0);
      }
    }
  }

  const bestDestination = destinationState.best;
  if (!bestDestination) return null;

  return {
    position: bestDestination.position,
    direction,
    source,
    distance: bestDestination.distance,
  };
}
