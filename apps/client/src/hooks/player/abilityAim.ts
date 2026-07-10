import {
  BLAZE_FLAMETHROWER_RANGE,
  BLAZE_SCRAPSHOT_RANGE,
  DEFAULT_BLAZE_PRIMARY_SKILL,
  HOOKSHOT_CHAIN_HOOKS_MAX_DISTANCE,
  HOOKSHOT_DRAG_HOOK_MAX_DISTANCE,
  type HeroId,
  type InputState,
  type Team,
  type Vec3,
  type BlazePrimarySkill,
} from '@voxel-strike/shared';
import { calculateLookDirection } from './constants';
import type { AbilityContext } from './types';

export const THIRD_PERSON_CROSSHAIR_AIM_DISTANCE = 120;
export const MOBILE_AIM_ASSIST_MAX_ANGLE_RADIANS = 0.11;

const MOBILE_AIM_ASSIST_MIN_DISTANCE = 1;
const MOBILE_AIM_ASSIST_DISTANCE_SCORE_WEIGHT = 0.025;
const PHANTOM_DIRE_BALL_AIM_ASSIST_DISTANCE = 30;
const PHANTOM_VOID_RAY_AIM_ASSIST_DISTANCE = 42;
const BLAZE_ROCKET_AIM_ASSIST_DISTANCE = 36;
const CHRONOS_VERDANT_PULSE_AIM_ASSIST_DISTANCE = 34;

export interface PlainVec3 {
  x: number;
  y: number;
  z: number;
}

export type MobileAimAssistTargetTeam = 'enemy' | 'any';

export interface MobileAimAssistActionConfig {
  maxDistance: number;
  targetTeam: MobileAimAssistTargetTeam;
}

export interface MobileAimAssistTargetCandidate {
  id: string;
  team?: Team | null;
  x: number;
  y: number;
  z: number;
  hitboxRadius: number;
  hitboxSegmentHalfHeight: number;
}

export interface ResolveMobileAimAssistPointOptions {
  ownerId: string;
  ownerTeam?: Team | null;
  origin: PlainVec3;
  direction: PlainVec3;
  candidates: Iterable<MobileAimAssistTargetCandidate>;
  maxDistance: number;
  maxAngleRadians?: number;
  targetTeam?: MobileAimAssistTargetTeam;
  hasLineOfSight?: (from: PlainVec3, to: PlainVec3) => boolean;
}

function normalize(vector: PlainVec3): Vec3 | null {
  const length = Math.sqrt(
    vector.x * vector.x +
    vector.y * vector.y +
    vector.z * vector.z
  );
  if (length <= 0.0001) return null;

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isMobileAimAssistTarget(
  candidate: MobileAimAssistTargetCandidate,
  ownerId: string,
  ownerTeam: Team | null | undefined,
  targetTeam: MobileAimAssistTargetTeam
): boolean {
  if (candidate.id === ownerId) return false;
  return targetTeam === 'any' || !ownerTeam || candidate.team !== ownerTeam;
}

export function getMobileAimAssistActionConfig(
  heroId: HeroId,
  input: Pick<InputState, 'primaryFire' | 'secondaryFire' | 'ability1'>,
  blazePrimarySkill: BlazePrimarySkill = DEFAULT_BLAZE_PRIMARY_SKILL
): MobileAimAssistActionConfig | null {
  switch (heroId) {
    case 'phantom':
      if (input.primaryFire) {
        return { maxDistance: PHANTOM_DIRE_BALL_AIM_ASSIST_DISTANCE, targetTeam: 'enemy' };
      }
      if (input.secondaryFire) {
        return { maxDistance: PHANTOM_VOID_RAY_AIM_ASSIST_DISTANCE, targetTeam: 'enemy' };
      }
      return null;
    case 'blaze':
      if (input.primaryFire) {
        return {
          maxDistance: blazePrimarySkill === 'scrapshot'
            ? BLAZE_SCRAPSHOT_RANGE
            : BLAZE_ROCKET_AIM_ASSIST_DISTANCE,
          targetTeam: 'enemy',
        };
      }
      if (input.ability1) {
        return { maxDistance: BLAZE_FLAMETHROWER_RANGE, targetTeam: 'enemy' };
      }
      return null;
    case 'hookshot':
      if (input.primaryFire) {
        return { maxDistance: HOOKSHOT_CHAIN_HOOKS_MAX_DISTANCE, targetTeam: 'enemy' };
      }
      if (input.secondaryFire) {
        return { maxDistance: HOOKSHOT_DRAG_HOOK_MAX_DISTANCE, targetTeam: 'any' };
      }
      return null;
    case 'chronos':
      if (input.primaryFire && !input.ability1) {
        return { maxDistance: CHRONOS_VERDANT_PULSE_AIM_ASSIST_DISTANCE, targetTeam: 'enemy' };
      }
      return null;
    default:
      return null;
  }
}

export function resolveMobileAimAssistPoint({
  ownerId,
  ownerTeam,
  origin,
  direction,
  candidates,
  maxDistance,
  maxAngleRadians = MOBILE_AIM_ASSIST_MAX_ANGLE_RADIANS,
  targetTeam = 'enemy',
  hasLineOfSight,
}: ResolveMobileAimAssistPointOptions): PlainVec3 | null {
  const aimDirection = normalize(direction);
  if (!aimDirection || maxDistance <= MOBILE_AIM_ASSIST_MIN_DISTANCE) return null;

  let bestPoint: PlainVec3 | null = null;
  let bestScore = Infinity;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    if (!isMobileAimAssistTarget(candidate, ownerId, ownerTeam, targetTeam)) continue;

    const centerX = candidate.x - origin.x;
    const centerY = candidate.y - origin.y;
    const centerZ = candidate.z - origin.z;
    const projectedDistance = Math.max(
      0,
      centerX * aimDirection.x +
      centerY * aimDirection.y +
      centerZ * aimDirection.z
    );
    const segmentHalfHeight = Math.max(0, candidate.hitboxSegmentHalfHeight);
    const targetY = clamp(
      origin.y + aimDirection.y * projectedDistance,
      candidate.y - segmentHalfHeight,
      candidate.y + segmentHalfHeight
    );
    const targetX = candidate.x;
    const targetZ = candidate.z;
    const toTargetX = targetX - origin.x;
    const toTargetY = targetY - origin.y;
    const toTargetZ = targetZ - origin.z;
    const distance = Math.sqrt(
      toTargetX * toTargetX +
      toTargetY * toTargetY +
      toTargetZ * toTargetZ
    );
    if (distance <= MOBILE_AIM_ASSIST_MIN_DISTANCE || distance > maxDistance) continue;

    const dot = clamp(
      (
        toTargetX * aimDirection.x +
        toTargetY * aimDirection.y +
        toTargetZ * aimDirection.z
      ) / distance,
      -1,
      1
    );
    const angle = Math.acos(dot);
    const hitboxAngle = Math.atan2(Math.max(0, candidate.hitboxRadius), distance);
    const excessAngle = angle - hitboxAngle;
    if (excessAngle > maxAngleRadians) continue;

    const score = Math.max(0, excessAngle) +
      (distance / maxDistance) * MOBILE_AIM_ASSIST_DISTANCE_SCORE_WEIGHT;
    if (
      score > bestScore ||
      (score === bestScore && distance >= bestDistance)
    ) {
      continue;
    }

    const point = { x: targetX, y: targetY, z: targetZ };
    if (hasLineOfSight && !hasLineOfSight(origin, point)) continue;

    bestPoint = point;
    bestScore = score;
    bestDistance = distance;
  }

  return bestPoint;
}

export function getAbilityFallbackAimPoint(
  ctx: AbilityContext,
  distance = THIRD_PERSON_CROSSHAIR_AIM_DISTANCE
): Vec3 {
  const direction = calculateLookDirection(ctx.yaw, ctx.pitch);
  return {
    x: ctx.position.x + direction.x * distance,
    y: ctx.position.y + direction.y * distance,
    z: ctx.position.z + direction.z * distance,
  };
}

export function getAbilityAimPoint(
  ctx: AbilityContext,
  distance = THIRD_PERSON_CROSSHAIR_AIM_DISTANCE
): Vec3 {
  return ctx.aimPoint ?? getAbilityFallbackAimPoint(ctx, distance);
}

export function resolveAbilityAimDirection(
  ctx: AbilityContext,
  startPosition: PlainVec3,
  distance = THIRD_PERSON_CROSSHAIR_AIM_DISTANCE
): Vec3 {
  if (!ctx.aimPoint) {
    return calculateLookDirection(ctx.yaw, ctx.pitch);
  }

  const aimPoint = getAbilityAimPoint(ctx, distance);
  return normalize({
    x: aimPoint.x - startPosition.x,
    y: aimPoint.y - startPosition.y,
    z: aimPoint.z - startPosition.z,
  }) ?? calculateLookDirection(ctx.yaw, ctx.pitch);
}
