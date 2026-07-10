import {
  CHRONOS_ASCENDANT_PARADOX_DURATION_MS,
  BLAZE_AFTERBURNER_DASH_DURATION_MS,
  BLAZE_AFTERBURNER_TRAIL_DURATION_MS,
  BLAZE_AFTERBURNER_TRAIL_RADIUS,
  CHRONOS_LIFELINE_ALLY_HEAL,
  CHRONOS_LIFELINE_RELEASE_DELAY_MS,
  CHRONOS_LIFELINE_SELF_HEAL,
  CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
  CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE,
  HOOKSHOT_GROUND_HOOKS_RADIUS,
  HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS,
  type AbilityDefinition,
  type Team,
} from '@voxel-strike/shared';
import type { PlainVec3 } from './bot-ai';
import { getForwardVector } from './roomMath';

export type RoomAbilitySlot = 'ability1' | 'ability2' | 'ultimate';
export type ChronosLifelineMode = 'allies' | 'self';

export const HOOKSHOT_ANCHOR_WALL_DURATION = 6.25;
export const HOOKSHOT_ANCHOR_WALL_MAX_DISTANCE = 24.35;

export interface AbilityCasterSnapshot {
  id: string;
  team: Team;
  heroId: string;
  position: PlainVec3;
  velocity: PlainVec3;
  lookYaw: number;
  lookPitch: number;
}

export interface AbilityUsePreflightInput {
  playerState: string;
  heroId: string;
  isHeroId: boolean;
  slot: RoomAbilitySlot;
  abilityId: string | undefined;
  chronosLifelineMode: ChronosLifelineMode | undefined;
  chronosLifelineTargetCount: number;
  hasHookshotGrappleTarget: boolean;
  phantomPrimaryReloading: boolean;
  rootedAndBlocked: boolean;
}

export interface AbilityUsePreflightRejection {
  reason: string;
  logEvent: boolean;
}

export interface ChronosLifelineCastPlan {
  releaseAt: number;
  healAmount: number;
  targetIds: string[];
  payload: Record<string, unknown>;
}

export interface HookshotAnchorWallPlan {
  wall: {
    id: string;
    startPosition: PlainVec3;
    direction: PlainVec3;
    startTime: number;
    duration: number;
    maxDistance: number;
    ownerId: string;
    ownerTeam: Team;
  };
  payload: Record<string, unknown>;
}

export interface HookshotGroundHooksTarget {
  targetId: string;
}

export interface StandardAbilityCastPlan {
  payload: Record<string, unknown>;
  timebreakShockwave: {
    casterId: string;
    direction: PlainVec3;
    releaseAt: number;
  } | null;
  blazeGearstorm: {
    startedAt: PlainVec3;
    usedAt: number;
    duration: number;
  } | null;
}

export function getAbilityUsePreflightRejection(
  input: AbilityUsePreflightInput
): AbilityUsePreflightRejection | null {
  if (input.playerState !== 'alive' || !input.isHeroId) {
    return { reason: `invalid_state:${input.slot}`, logEvent: true };
  }

  if (input.heroId === 'chronos' && input.slot === 'ability1' && !input.chronosLifelineMode) {
    return { reason: 'chronos_lifeline_mode_required', logEvent: false };
  }

  if (
    input.heroId === 'chronos' &&
    input.slot === 'ability1' &&
    input.chronosLifelineTargetCount === 0
  ) {
    return { reason: 'chronos_lifeline_no_targets', logEvent: false };
  }

  if (input.heroId === 'hookshot' && input.slot === 'ability1' && !input.hasHookshotGrappleTarget) {
    return { reason: 'hookshot_grapple_no_target', logEvent: false };
  }

  if (input.abilityId && input.abilityId !== 'phantom_blink' && input.phantomPrimaryReloading) {
    return { reason: `phantom_reload_blocks:${input.abilityId}`, logEvent: false };
  }

  if (input.rootedAndBlocked) {
    return { reason: 'rooted_movement_ability_blocked', logEvent: true };
  }

  return null;
}

export function buildChronosLifelineCastPlan(input: {
  caster: AbilityCasterSnapshot;
  abilityId: string;
  castId: string;
  startPosition: PlainVec3;
  targetIds: string[];
  mode: ChronosLifelineMode;
  usedAt: number;
}): ChronosLifelineCastPlan {
  const releaseAt = input.usedAt + CHRONOS_LIFELINE_RELEASE_DELAY_MS;
  const healAmount = input.mode === 'self'
    ? CHRONOS_LIFELINE_SELF_HEAL
    : CHRONOS_LIFELINE_ALLY_HEAL;

  return {
    releaseAt,
    healAmount,
    targetIds: input.targetIds,
    payload: {
      playerId: input.caster.id,
      abilityId: input.abilityId,
      castId: input.castId,
      position: input.caster.position,
      startPosition: input.startPosition,
      targetIds: input.targetIds,
      mode: input.mode,
      ownerTeam: input.caster.team,
      serverTime: input.usedAt,
      releaseAt,
    },
  };
}

export function buildHookshotGrappleCastPayload(input: {
  caster: AbilityCasterSnapshot;
  abilityId: string;
  castId: string;
  startPosition: PlainVec3;
  targetPosition: PlainVec3;
  aimDirection: PlainVec3;
  usedAt: number;
}): Record<string, unknown> {
  const launchSide = 1;
  return {
    playerId: input.caster.id,
    abilityId: input.abilityId,
    castId: input.castId,
    position: input.caster.position,
    startPosition: input.startPosition,
    targetPosition: input.targetPosition,
    direction: {
      yaw: input.caster.lookYaw,
      pitch: input.caster.lookPitch,
    },
    aimDirection: input.aimDirection,
    ownerTeam: input.caster.team,
    launchSide,
    launchYaw: input.caster.lookYaw,
    serverTime: input.usedAt,
  };
}

export function buildHookshotAnchorWallPlan(input: {
  caster: AbilityCasterSnapshot;
  abilityId: string;
  castId: string;
  startPosition: PlainVec3;
  direction: PlainVec3;
  usedAt: number;
}): HookshotAnchorWallPlan {
  return {
    wall: {
      id: input.castId,
      startPosition: input.startPosition,
      direction: input.direction,
      startTime: input.usedAt,
      duration: HOOKSHOT_ANCHOR_WALL_DURATION,
      maxDistance: HOOKSHOT_ANCHOR_WALL_MAX_DISTANCE,
      ownerId: input.caster.id,
      ownerTeam: input.caster.team,
    },
    payload: {
      playerId: input.caster.id,
      abilityId: input.abilityId,
      castId: input.castId,
      position: input.caster.position,
      startPosition: input.startPosition,
      targetPosition: input.startPosition,
      direction: input.direction,
      aimDirection: input.direction,
      ownerTeam: input.caster.team,
      launchYaw: input.caster.lookYaw,
      serverTime: input.usedAt,
      maxDistance: HOOKSHOT_ANCHOR_WALL_MAX_DISTANCE,
      duration: HOOKSHOT_ANCHOR_WALL_DURATION,
    },
  };
}

export function buildHookshotGroundHooksCastPayload(input: {
  caster: AbilityCasterSnapshot;
  abilityId: string;
  castId: string;
  rootTargets: HookshotGroundHooksTarget[];
  usedAt: number;
}): Record<string, unknown> {
  const rootUntil = input.usedAt + HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS * 1000;
  return {
    playerId: input.caster.id,
    abilityId: input.abilityId,
    castId: input.castId,
    position: input.caster.position,
    targetIds: input.rootTargets.map((target) => target.targetId),
    targets: input.rootTargets,
    direction: {
      yaw: input.caster.lookYaw,
      pitch: input.caster.lookPitch,
    },
    ownerTeam: input.caster.team,
    launchYaw: input.caster.lookYaw,
    serverTime: input.usedAt,
    radius: HOOKSHOT_GROUND_HOOKS_RADIUS,
    duration: HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS,
    rootUntil,
  };
}

export function buildStandardAbilityCastPlan(input: {
  caster: AbilityCasterSnapshot;
  abilityId: string;
  abilityDef: Pick<AbilityDefinition, 'duration'>;
  castId: string;
  startedAt: PlainVec3;
  abilityStartPosition: PlainVec3;
  abilityActivatedAt: number;
  usedAt: number;
}): StandardAbilityCastPlan {
  const shockwaveDirection = input.abilityId === 'chronos_timebreak'
    ? getForwardVector(input.caster.lookYaw, 0)
    : undefined;
  const velocity = input.abilityId === 'blaze_rocketjump' || input.abilityId === 'blaze_afterburner'
    ? input.caster.velocity
    : input.abilityId === 'chronos_ascendant_paradox'
      ? input.caster.velocity
      : undefined;

  return {
    payload: {
      playerId: input.caster.id,
      abilityId: input.abilityId,
      castId: input.castId,
      position: input.caster.position,
      startPosition: input.abilityStartPosition,
      direction: {
        yaw: input.caster.lookYaw,
        pitch: input.caster.lookPitch,
      },
      aimDirection: getForwardVector(input.caster.lookYaw, input.caster.lookPitch),
      velocity,
      ownerTeam: input.caster.team,
      serverTime: input.usedAt,
      releaseAt: input.abilityId === 'chronos_timebreak'
        ? input.abilityActivatedAt
        : undefined,
      duration: input.abilityId === 'chronos_timebreak'
        ? input.abilityDef.duration
        : input.abilityId === 'chronos_ascendant_paradox'
          ? input.abilityDef.duration
          : undefined,
      shockwaveDirection,
      trailStartPosition: input.abilityId === 'blaze_afterburner' ? input.startedAt : undefined,
      durationMs: input.abilityId === 'blaze_afterburner'
        ? BLAZE_AFTERBURNER_TRAIL_DURATION_MS
        : input.abilityId === 'chronos_ascendant_paradox'
          ? CHRONOS_ASCENDANT_PARADOX_DURATION_MS
          : undefined,
      dashDurationMs: input.abilityId === 'blaze_afterburner'
        ? BLAZE_AFTERBURNER_DASH_DURATION_MS
        : undefined,
      radius: input.abilityId === 'blaze_afterburner'
        ? BLAZE_AFTERBURNER_TRAIL_RADIUS
        : input.abilityId === 'chronos_timebreak'
          ? CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE
          : undefined,
    },
    timebreakShockwave: shockwaveDirection
      ? {
        casterId: input.caster.id,
        direction: shockwaveDirection,
        releaseAt: input.abilityActivatedAt || input.usedAt + CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
      }
      : null,
    blazeGearstorm: input.abilityId === 'blaze_airstrike'
      ? {
        startedAt: input.startedAt,
        usedAt: input.usedAt,
        duration: input.abilityDef.duration ?? 5,
      }
      : null,
  };
}
