import { PLAYER_HEIGHT } from '../../constants/physics.js';
import type { HeroId } from '../../types/hero.js';
import type { Vec3 } from '../../types/vector.js';
import type { VoxelMapManifest } from './types.js';

export const DEV_TESTING_MAP_SEED = 0x44565431;
export const DEV_TESTING_MAP_PROFILE_ID = 'dev_testing' as const;
export const DEV_TESTING_MAP_SIZE_ID = 'small' as const;
export const DEV_TESTING_MAP_FOOTPRINT_SCALE = 0.9;
export const DEV_TESTING_HERO_LINEUP_SPACING = 2.05;
export const DEV_TESTING_TARGET_AREA_HALF_EXTENTS = { x: 5.4, z: 5.4 } as const;

const DEV_TESTING_LINEUP_HERO_IDS = ['phantom', 'hookshot', 'blaze', 'chronos'] as const satisfies readonly HeroId[];
const PLAYER_CENTER_Y_OFFSET = PLAYER_HEIGHT / 2 + 0.05;

export interface DevTestingHeroLineupEntry {
  heroId: HeroId;
  position: Vec3;
  yaw: number;
}

export interface DevTestingTargetBotArea {
  center: Vec3;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface DevTestingFeaturePlan {
  heroLineup: DevTestingHeroLineupEntry[];
  targetBotArea: DevTestingTargetBotArea;
}

interface DevTestingFeaturePlanInput {
  redSpawn: Vec3;
  redFlag: Vec3;
  blueFlag: Vec3;
  samplePlayerCenterY: (point: { x: number; z: number }) => number;
}

function normalize2D(vector: { x: number; z: number }, fallback: { x: number; z: number } = { x: 0, z: 1 }): {
  x: number;
  z: number;
} {
  const length = Math.hypot(vector.x, vector.z);
  if (length < 0.0001) return fallback;
  return { x: vector.x / length, z: vector.z / length };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function surfacePlayerCenterY(manifest: VoxelMapManifest, point: { x: number; z: number }): number {
  const gridX = clamp(
    Math.floor((point.x - manifest.heightfield.origin.x) / manifest.heightfield.voxelSize.x),
    0,
    manifest.heightfield.size.x - 1
  );
  const gridZ = clamp(
    Math.floor((point.z - manifest.heightfield.origin.z) / manifest.heightfield.voxelSize.z),
    0,
    manifest.heightfield.size.z - 1
  );
  const row = manifest.heightfield.topSolidRows[gridX + gridZ * manifest.heightfield.size.x] ?? 0;
  return manifest.heightfield.origin.y + row * manifest.heightfield.voxelSize.y + PLAYER_CENTER_Y_OFFSET;
}

export function isDevTestingMapSeed(seed: number): boolean {
  return (seed >>> 0) === DEV_TESTING_MAP_SEED;
}

export function createDevTestingFeaturePlan(input: DevTestingFeaturePlanInput): DevTestingFeaturePlan {
  const forward = normalize2D({
    x: input.blueFlag.x - input.redSpawn.x,
    z: input.blueFlag.z - input.redSpawn.z,
  });
  const right = { x: -forward.z, z: forward.x };
  const lineupCenter = {
    x: input.redSpawn.x + forward.x * 4.2,
    z: input.redSpawn.z + forward.z * 4.2,
  };
  const lineupYaw = Math.atan2(-forward.x, -forward.z);
  const centerOffset = (DEV_TESTING_LINEUP_HERO_IDS.length - 1) * DEV_TESTING_HERO_LINEUP_SPACING * 0.5;
  const heroLineup = DEV_TESTING_LINEUP_HERO_IDS.map((heroId, index) => {
    const offset = index * DEV_TESTING_HERO_LINEUP_SPACING - centerOffset;
    const point = {
      x: lineupCenter.x + right.x * offset,
      z: lineupCenter.z + right.z * offset,
    };

    return {
      heroId,
      position: {
        x: point.x,
        y: input.samplePlayerCenterY(point),
        z: point.z,
      },
      yaw: lineupYaw,
    };
  });

  const targetPoint = {
    x: input.redFlag.x + (input.blueFlag.x - input.redFlag.x) * 0.55,
    z: input.redFlag.z + (input.blueFlag.z - input.redFlag.z) * 0.55,
  };
  const targetCenter = {
    x: targetPoint.x,
    y: input.samplePlayerCenterY(targetPoint),
    z: targetPoint.z,
  };

  return {
    heroLineup,
    targetBotArea: {
      center: targetCenter,
      minX: targetPoint.x - DEV_TESTING_TARGET_AREA_HALF_EXTENTS.x,
      maxX: targetPoint.x + DEV_TESTING_TARGET_AREA_HALF_EXTENTS.x,
      minZ: targetPoint.z - DEV_TESTING_TARGET_AREA_HALF_EXTENTS.z,
      maxZ: targetPoint.z + DEV_TESTING_TARGET_AREA_HALF_EXTENTS.z,
    },
  };
}

export function getDevTestingFeaturePlan(manifest: VoxelMapManifest): DevTestingFeaturePlan {
  const redSpawn = manifest.spawnPoints.red[0] ?? manifest.flagZones.red;
  return createDevTestingFeaturePlan({
    redSpawn,
    redFlag: manifest.flagZones.red,
    blueFlag: manifest.flagZones.blue,
    samplePlayerCenterY: (point) => surfacePlayerCenterY(manifest, point),
  });
}

export function getDevTestingHeroLineup(manifest: VoxelMapManifest): readonly DevTestingHeroLineupEntry[] {
  return getDevTestingFeaturePlan(manifest).heroLineup;
}

export function getDevTestingTargetBotArea(manifest: VoxelMapManifest): DevTestingTargetBotArea {
  return getDevTestingFeaturePlan(manifest).targetBotArea;
}

export function getDevTestingTargetBotSpawn(manifest: VoxelMapManifest): Vec3 {
  return getDevTestingTargetBotArea(manifest).center;
}
