import type {
  SafeZoneSnapshot,
  Vec3,
  VoxelMapManifest,
} from '@voxel-strike/shared';
import { hashSeed } from '@voxel-strike/shared';

interface SafeZonePhaseDefinition {
  waitMs: number;
  shrinkMs: number;
  radiusRatio: number;
  damagePerSecond: number;
}

export interface BattleRoyalSafeZoneState extends SafeZoneSnapshot {
  seed: number;
  baseCenter: Vec3;
  baseRadius: number;
  phaseStartedAt: number;
  fromCenter: Vec3;
  fromRadius: number;
}

const WARNING_WINDOW_MS = 30_000;

const SAFE_ZONE_PHASES: readonly SafeZonePhaseDefinition[] = [
  { waitMs: 90_000, shrinkMs: 150_000, radiusRatio: 0.72, damagePerSecond: 3 },
  { waitMs: 70_000, shrinkMs: 140_000, radiusRatio: 0.50, damagePerSecond: 5 },
  { waitMs: 55_000, shrinkMs: 125_000, radiusRatio: 0.32, damagePerSecond: 8 },
  { waitMs: 45_000, shrinkMs: 110_000, radiusRatio: 0.18, damagePerSecond: 12 },
  { waitMs: 30_000, shrinkMs: 95_000, radiusRatio: 0.08, damagePerSecond: 18 },
  { waitMs: 15_000, shrinkMs: 90_000, radiusRatio: 0.025, damagePerSecond: 25 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
}

function unitRandom(seed: number): number {
  return (hashSeed(seed) >>> 0) / 0x1_0000_0000;
}

function getBoundaryCenter(manifest: VoxelMapManifest): Vec3 {
  if (manifest.boundary.length === 0) {
    return {
      x: manifest.origin.x + (manifest.size.x * manifest.voxelSize.x) / 2,
      y: manifest.origin.y,
      z: manifest.origin.z + (manifest.size.z * manifest.voxelSize.z) / 2,
    };
  }

  const sum = manifest.boundary.reduce(
    (total, point) => ({ x: total.x + point.x, z: total.z + point.z }),
    { x: 0, z: 0 }
  );
  return {
    x: sum.x / manifest.boundary.length,
    y: manifest.origin.y,
    z: sum.z / manifest.boundary.length,
  };
}

function getBoundaryRadius(manifest: VoxelMapManifest, center: Vec3): number {
  let radius = 1;
  for (const point of manifest.boundary) {
    radius = Math.max(radius, Math.hypot(point.x - center.x, point.z - center.z));
  }
  return radius + 4;
}

function getNextCenter(input: {
  seed: number;
  phaseIndex: number;
  baseRadius: number;
  baseCenter: Vec3;
  fromCenter: Vec3;
  fromRadius: number;
  nextRadius: number;
}): Vec3 {
  const shiftBudget = Math.max(0, input.fromRadius - input.nextRadius - 8) * 0.42;
  if (shiftBudget <= 0.01) return { ...input.fromCenter };

  const stream = input.seed ^ Math.imul(input.phaseIndex + 1, 0x9e3779b1);
  const angle = unitRandom(stream ^ 0x4a7c15) * Math.PI * 2;
  const distance = shiftBudget * lerp(0.25, 0.95, unitRandom(stream ^ 0x2f6e2b1));
  const drift = {
    x: input.fromCenter.x + Math.cos(angle) * distance,
    y: input.baseCenter.y,
    z: input.fromCenter.z + Math.sin(angle) * distance,
  };

  const maxDistanceFromBase = Math.max(0, input.baseRadius - input.nextRadius - 4);
  const dx = drift.x - input.baseCenter.x;
  const dz = drift.z - input.baseCenter.z;
  const distanceFromBase = Math.hypot(dx, dz);
  if (distanceFromBase <= maxDistanceFromBase || distanceFromBase <= 0.001) return drift;

  const scale = maxDistanceFromBase / distanceFromBase;
  return {
    x: input.baseCenter.x + dx * scale,
    y: input.baseCenter.y,
    z: input.baseCenter.z + dz * scale,
  };
}

function createPhaseState(input: {
  previous: BattleRoyalSafeZoneState | null;
  seed: number;
  baseCenter: Vec3;
  baseRadius: number;
  phaseIndex: number;
  now: number;
  nextZoneRevealsAt?: number;
}): BattleRoyalSafeZoneState {
  const phase = SAFE_ZONE_PHASES[Math.min(input.phaseIndex, SAFE_ZONE_PHASES.length - 1)];
  const fromCenter = input.previous?.nextCenter ?? input.baseCenter;
  const fromRadius = input.previous?.nextRadius ?? input.baseRadius;
  const nextRadius = Math.max(4, input.baseRadius * phase.radiusRatio);
  const nextCenter = getNextCenter({
    seed: input.seed,
    phaseIndex: input.phaseIndex,
    baseRadius: input.baseRadius,
    baseCenter: input.baseCenter,
    fromCenter,
    fromRadius,
    nextRadius,
  });
  const shrinkStartsAt = input.now + phase.waitMs;
  const phaseEndsAt = shrinkStartsAt + phase.shrinkMs;

  return {
    enabled: true,
    seed: input.seed,
    baseCenter: { ...input.baseCenter },
    baseRadius: input.baseRadius,
    phaseIndex: input.phaseIndex,
    phaseStartedAt: input.now,
    fromCenter,
    fromRadius,
    center: fromCenter,
    radius: fromRadius,
    nextCenter,
    nextRadius,
    nextZoneRevealsAt: input.nextZoneRevealsAt ?? input.now,
    shrinkStartsAt,
    phaseEndsAt,
    damagePerSecond: phase.damagePerSecond,
    warning: phase.waitMs > 0 && shrinkStartsAt - input.now <= WARNING_WINDOW_MS,
    shrinking: false,
  };
}

export function createBattleRoyalSafeZoneState(
  manifest: VoxelMapManifest,
  now: number,
  options: { firstNextZoneRevealsAt?: number } = {}
): BattleRoyalSafeZoneState {
  const baseCenter = getBoundaryCenter(manifest);
  const baseRadius = getBoundaryRadius(manifest, baseCenter);
  return createPhaseState({
    previous: null,
    seed: manifest.seed,
    baseCenter,
    baseRadius,
    phaseIndex: 0,
    now,
    nextZoneRevealsAt: options.firstNextZoneRevealsAt,
  });
}

export function updateBattleRoyalSafeZoneState(
  state: BattleRoyalSafeZoneState,
  now: number
): BattleRoyalSafeZoneState {
  let current = state;
  while (now >= current.phaseEndsAt && current.phaseIndex < SAFE_ZONE_PHASES.length - 1) {
    current = createPhaseState({
      previous: current,
      seed: current.seed,
      baseCenter: current.baseCenter,
      baseRadius: current.baseRadius,
      phaseIndex: current.phaseIndex + 1,
      now: current.phaseEndsAt,
    });
  }

  const shrinkDuration = Math.max(1, current.phaseEndsAt - current.shrinkStartsAt);
  const shrinking = now >= current.shrinkStartsAt;
  const progress = shrinking
    ? clamp((now - current.shrinkStartsAt) / shrinkDuration, 0, 1)
    : 0;

  return {
    ...current,
    center: lerpVec3(current.fromCenter, current.nextCenter, progress),
    radius: lerp(current.fromRadius, current.nextRadius, progress),
    warning: !shrinking && current.shrinkStartsAt - now <= WARNING_WINDOW_MS,
    shrinking,
  };
}

export function isOutsideBattleRoyalSafeZone(
  state: SafeZoneSnapshot,
  position: Pick<Vec3, 'x' | 'z'>
): boolean {
  return Math.hypot(position.x - state.center.x, position.z - state.center.z) > state.radius;
}
