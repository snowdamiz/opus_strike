import {
  quantizeAbilityCastOriginHint,
  type AbilityCastOriginHint,
  type InputState,
} from '@voxel-strike/shared';
import {
  BLAZE_ROCKET_JUMP_IMPACT_DELAY_MS,
  getBlazeBombTargetHeldBlend,
  getBlazeFlamethrowerHeldBlend,
  type BlazeRocketStaffPoseSampleContext,
} from '../../viewmodel/blazePose';
import type { ChronosPrimaryOrbPoseSampleContext } from '../../viewmodel/chronosPose';
import {
  PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS,
  type PhantomPrimaryPoseSampleContext,
  type PhantomVoidRayOrbPoseSampleContext,
} from '../../viewmodel/phantomPrimaryPose';
import {
  resolveAbilitySocketOrigin,
  type ResolvedAbilitySocketOrigin,
} from '../../model-system/abilitySocketResolver';
import { offsetResolvedChronosOrbVisualOrigin } from '../../model-system/chronosOrbVisualOrigin';
import { calculateLookDirection } from './constants';
import type { AbilityContext } from './types';

interface BuildAbilityCastOriginHintOptions {
  bombTargeting?: boolean;
}

function plainOrigin(origin: ResolvedAbilitySocketOrigin): { x: number; y: number; z: number } {
  return {
    x: origin.position.x,
    y: origin.position.y,
    z: origin.position.z,
  };
}

function hintFromOrigin(
  abilityId: string,
  origin: ResolvedAbilitySocketOrigin | null
): AbilityCastOriginHint | null {
  if (!origin) return null;

  return quantizeAbilityCastOriginHint({
    abilityId,
    socketName: origin.socketName,
    origin: plainOrigin(origin),
    sampledAtMs: origin.timestampMs,
  });
}

function pushHint(
  hints: AbilityCastOriginHint[],
  seen: Set<string>,
  hint: AbilityCastOriginHint | null
): void {
  if (!hint) return;

  const key = `${hint.abilityId}:${hint.socketName}`;
  if (seen.has(key)) return;

  seen.add(key);
  hints.push(hint);
}

function resolveBlazeStaffOrigin(
  ctx: AbilityContext,
  abilityId: string,
  now: number,
  holdBlend: number
): ResolvedAbilitySocketOrigin | null {
  if (!ctx.camera) return null;

  return resolveAbilitySocketOrigin({
    ownerScope: 'localViewmodel',
    abilityId,
    sampledContext: {
      camera: ctx.camera,
      elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
      holdBlend,
      timestampMs: ctx.viewmodelNowMs ?? now,
    } satisfies BlazeRocketStaffPoseSampleContext,
    preferSampled: true,
    warnOnSampleDrift: true,
  });
}

function resolvePhantomPrimaryOrigin(
  ctx: AbilityContext,
  abilityId: string,
  side: -1 | 1,
  now: number
): ResolvedAbilitySocketOrigin | null {
  if (!ctx.camera) return null;

  return resolveAbilitySocketOrigin({
    ownerScope: 'localViewmodel',
    abilityId,
    side,
    sampledContext: {
      camera: ctx.camera,
      elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
      side,
      actionTimeSeconds: PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS,
      timestampMs: ctx.viewmodelNowMs ?? now,
    } satisfies PhantomPrimaryPoseSampleContext,
    preferSampled: true,
    warnOnSampleDrift: true,
  });
}

function resolvePhantomVoidRayOrigin(
  ctx: AbilityContext,
  abilityId: string,
  now: number
): ResolvedAbilitySocketOrigin | null {
  if (!ctx.camera) return null;

  return resolveAbilitySocketOrigin({
    ownerScope: 'localViewmodel',
    abilityId,
    sampledContext: {
      camera: ctx.camera,
      elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
      timestampMs: ctx.viewmodelNowMs ?? now,
    } satisfies PhantomVoidRayOrbPoseSampleContext,
    preferSampled: true,
    warnOnSampleDrift: true,
  });
}

function resolveChronosPrimaryOrigin(
  ctx: AbilityContext,
  abilityId: string,
  now: number
): ResolvedAbilitySocketOrigin | null {
  if (!ctx.camera) return null;

  const origin = resolveAbilitySocketOrigin({
    ownerScope: 'localViewmodel',
    abilityId,
    sampledContext: {
      camera: ctx.camera,
      elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
      timestampMs: ctx.viewmodelNowMs ?? now,
    } satisfies ChronosPrimaryOrbPoseSampleContext,
    preferSampled: true,
    warnOnSampleDrift: true,
  });
  return offsetResolvedChronosOrbVisualOrigin(
    origin,
    calculateLookDirection(ctx.yaw, ctx.pitch),
    abilityId
  );
}

function resolveLiveLocalOrigin(
  abilityId: string,
  side?: -1 | 1
): ResolvedAbilitySocketOrigin | null {
  return resolveAbilitySocketOrigin({
    ownerScope: 'localViewmodel',
    abilityId,
    side,
  });
}

function shouldBuildAbilityCastOriginHints(
  ctx: AbilityContext,
  input: InputState,
  options: BuildAbilityCastOriginHintOptions
): boolean {
  switch (ctx.heroId) {
    case 'phantom':
      return input.primaryFire || input.secondaryFire;
    case 'hookshot':
      return input.primaryFire || input.secondaryFire || input.ability1 || input.ultimate;
    case 'blaze':
      return (
        input.primaryFire ||
        input.ability1 ||
        input.secondaryFire ||
        input.ability2 ||
        options.bombTargeting === true
      );
    case 'chronos':
      return input.primaryFire || input.ability1 || input.ability2;
    default:
      return false;
  }
}

export function buildAbilityCastOriginHints(
  ctx: AbilityContext,
  input: InputState,
  options: BuildAbilityCastOriginHintOptions = {}
): AbilityCastOriginHint[] | undefined {
  if (!shouldBuildAbilityCastOriginHints(ctx, input, options)) return undefined;

  const hints: AbilityCastOriginHint[] = [];
  const seen = new Set<string>();
  const now = ctx.viewmodelNowMs ?? Date.now();

  ctx.camera?.updateMatrixWorld();

  if (ctx.heroId === 'phantom') {
    if (input.primaryFire) {
      for (const side of [-1, 1] as const) {
        pushHint(
          hints,
          seen,
          hintFromOrigin(
            'phantom_dire_ball',
            resolvePhantomPrimaryOrigin(ctx, 'phantom_dire_ball', side, now)
          )
        );
      }
    }

    if (input.secondaryFire) {
      pushHint(
        hints,
        seen,
        hintFromOrigin(
          'phantom_void_ray_charge',
          resolvePhantomVoidRayOrigin(ctx, 'phantom_void_ray_charge', now)
        )
      );
      pushHint(
        hints,
        seen,
        hintFromOrigin(
          'phantom_void_ray',
          resolvePhantomVoidRayOrigin(ctx, 'phantom_void_ray', now)
        )
      );
    }
  }

  if (ctx.heroId === 'hookshot') {
    if (input.primaryFire) {
      for (const side of [-1, 1] as const) {
        pushHint(
          hints,
          seen,
          hintFromOrigin(
            'hookshot_basic_attack',
            resolveLiveLocalOrigin('hookshot_basic_attack', side)
          )
        );
      }
    }

    if (input.secondaryFire) {
      pushHint(
        hints,
        seen,
        hintFromOrigin(
          'hookshot_heavy_attack',
          resolveLiveLocalOrigin('hookshot_heavy_attack')
        )
      );
    }

    if (input.ability1) {
      pushHint(
        hints,
        seen,
        hintFromOrigin(
          'hookshot_grapple',
          resolveLiveLocalOrigin('hookshot_grapple')
        )
      );
    }

  }

  if (ctx.heroId === 'blaze') {
    if (input.primaryFire) {
      pushHint(
        hints,
        seen,
        hintFromOrigin(
          'blaze_rocket',
          resolveBlazeStaffOrigin(ctx, 'blaze_rocket', now, 1)
        )
      );
    }

    if (input.ability1) {
      pushHint(
        hints,
        seen,
        hintFromOrigin(
          'blaze_flamethrower',
          resolveBlazeStaffOrigin(ctx, 'blaze_flamethrower', now, getBlazeFlamethrowerHeldBlend(now))
        )
      );
    }

    if (options.bombTargeting || input.secondaryFire) {
      pushHint(
        hints,
        seen,
        hintFromOrigin(
          'blaze_bomb',
          resolveBlazeStaffOrigin(ctx, 'blaze_bomb', now, getBlazeBombTargetHeldBlend(now))
        )
      );
    }

    if (input.ability2) {
      pushHint(
        hints,
        seen,
        hintFromOrigin(
          'blaze_rocketjump',
          resolveBlazeStaffOrigin(ctx, 'blaze_rocketjump', now + BLAZE_ROCKET_JUMP_IMPACT_DELAY_MS, 1)
        )
      );
    }
  }

  if (ctx.heroId === 'chronos') {
    if (input.primaryFire && !input.ability1) {
      pushHint(
        hints,
        seen,
        hintFromOrigin(
          'chronos_verdant_pulse',
          resolveChronosPrimaryOrigin(ctx, 'chronos_verdant_pulse', now)
        )
      );
    }

    if (input.ability1) {
      pushHint(
        hints,
        seen,
        hintFromOrigin(
          'chronos_lifeline_conduit',
          resolveChronosPrimaryOrigin(ctx, 'chronos_lifeline_conduit', now)
        )
      );
    }

    if (input.ability2) {
      pushHint(
        hints,
        seen,
        hintFromOrigin(
          'chronos_timebreak',
          resolveChronosPrimaryOrigin(ctx, 'chronos_timebreak', now)
        )
      );
    }
  }

  return hints.length > 0 ? hints : undefined;
}
