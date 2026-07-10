import {
  BLAZE_PRIMARY_MAGAZINE_SIZE,
  BLAZE_SCRAPSHOT_MAGAZINE_SIZE,
  BLAZE_SCRAPSHOT_FALLOFF_SCALE,
  BLAZE_SCRAPSHOT_FULL_DAMAGE_RANGE,
  BLAZE_SCRAPSHOT_PELLET_DAMAGE,
  BLAZE_SCRAPSHOT_RANGE,
  BLAZE_SCRAPSHOT_SPREAD_RADIANS,
} from '../constants/heroes.js';
import {
  DEFAULT_BLAZE_PRIMARY_SKILL,
  type BlazePrimarySkill,
} from '../types/loadout.js';
import type { Vec3 } from '../types/vector.js';

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };
const WORLD_RIGHT: Vec3 = { x: 1, y: 0, z: 0 };

// A fixed pattern keeps client prediction and server authority visually identical.
const SCRAPSHOT_PELLET_PATTERN = [
  { x: -0.72, y: -0.42 },
  { x: 0, y: -0.18 },
  { x: 0.72, y: -0.42 },
  { x: -0.72, y: 0.42 },
  { x: 0, y: 0.18 },
  { x: 0.72, y: 0.42 },
] as const;

function normalize(vector: Vec3): Vec3 | null {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= 0.0001) return null;
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function getBlazePrimaryMagazineSize(skill: BlazePrimarySkill): number {
  return skill === 'scrapshot'
    ? BLAZE_SCRAPSHOT_MAGAZINE_SIZE
    : BLAZE_PRIMARY_MAGAZINE_SIZE;
}

export function getBlazePrimaryAbilityId(skill: BlazePrimarySkill): 'blaze_rocket' | 'blaze_scrapshot' {
  return skill === 'scrapshot' ? 'blaze_scrapshot' : 'blaze_rocket';
}

export function normalizeBlazePrimarySkill(value: unknown): BlazePrimarySkill {
  return value === 'scrapshot' ? 'scrapshot' : DEFAULT_BLAZE_PRIMARY_SKILL;
}

export function getBlazeScrapshotPelletDirections(forwardInput: Vec3): Vec3[] {
  const forward = normalize(forwardInput) ?? { x: 0, y: 0, z: -1 };
  const preferredUp = Math.abs(forward.y) > 0.96 ? WORLD_RIGHT : WORLD_UP;
  const right = normalize(cross(forward, preferredUp)) ?? { x: 1, y: 0, z: 0 };
  const up = normalize(cross(right, forward)) ?? { x: 0, y: 1, z: 0 };
  const spread = Math.tan(BLAZE_SCRAPSHOT_SPREAD_RADIANS);

  return SCRAPSHOT_PELLET_PATTERN.map((offset) => normalize({
    x: forward.x + right.x * offset.x * spread + up.x * offset.y * spread,
    y: forward.y + right.y * offset.x * spread + up.y * offset.y * spread,
    z: forward.z + right.z * offset.x * spread + up.z * offset.y * spread,
  }) ?? forward);
}

export function calculateBlazeScrapshotPelletDamage(distance: number): number {
  if (distance <= BLAZE_SCRAPSHOT_FULL_DAMAGE_RANGE) return BLAZE_SCRAPSHOT_PELLET_DAMAGE;

  const falloffDistance = Math.max(0, BLAZE_SCRAPSHOT_RANGE - BLAZE_SCRAPSHOT_FULL_DAMAGE_RANGE);
  const falloffProgress = falloffDistance > 0
    ? Math.min(1, Math.max(0, distance - BLAZE_SCRAPSHOT_FULL_DAMAGE_RANGE) / falloffDistance)
    : 1;
  return Math.max(
    1,
    Math.round(BLAZE_SCRAPSHOT_PELLET_DAMAGE * (1 - falloffProgress * BLAZE_SCRAPSHOT_FALLOFF_SCALE))
  );
}
