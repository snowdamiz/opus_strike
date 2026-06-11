import {
  BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
  CHRONOS_PRIMARY_ORB_SOCKET_NAME,
  HOOKSHOT_HOOK_SOCKET_NAMES,
  PHANTOM_PRIMARY_PALM_SOCKET_NAMES,
  PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
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
import {
  CHRONOS_PRIMARY_ORB_SOCKET_NAME as CHRONOS_VIEWMODEL_PRIMARY_ORB_SOCKET_NAME,
  type ChronosPrimaryOrbPoseSampleContext,
} from '../../viewmodel/chronosPose';
import {
  PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS,
  PHANTOM_PRIMARY_PALM_SOCKET_NAMES as PHANTOM_VIEWMODEL_PRIMARY_PALM_SOCKET_NAMES,
  PHANTOM_VOID_RAY_ORB_SOCKET_NAME as PHANTOM_VIEWMODEL_VOID_RAY_ORB_SOCKET_NAME,
  type PhantomPrimaryPoseSampleContext,
  type PhantomVoidRayOrbPoseSampleContext,
} from '../../viewmodel/phantomPrimaryPose';
import { HOOKSHOT_HOOK_SOCKET_NAMES as HOOKSHOT_VIEWMODEL_HOOK_SOCKET_NAMES } from '../../viewmodel/hookshotPose';
import {
  readViewmodelSocket,
  sampleViewmodelPose,
  type ViewmodelSocketPose,
} from '../../viewmodel/viewmodelSocketRegistry';
import type { AbilityContext } from './types';

interface BuildAbilityCastOriginHintOptions {
  bombTargeting?: boolean;
}

function plainOrigin(pose: ViewmodelSocketPose): { x: number; y: number; z: number } {
  return {
    x: pose.position.x,
    y: pose.position.y,
    z: pose.position.z,
  };
}

function hintFromPose(
  abilityId: string,
  socketName: string,
  pose: ViewmodelSocketPose | null
): AbilityCastOriginHint | null {
  if (!pose) return null;

  return quantizeAbilityCastOriginHint({
    abilityId,
    socketName,
    origin: plainOrigin(pose),
    sampledAtMs: pose.timestampMs,
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

function sampleBlazeStaffPose(
  ctx: AbilityContext,
  now: number,
  holdBlend: number
): ViewmodelSocketPose | null {
  if (!ctx.camera) return null;

  return sampleViewmodelPose<BlazeRocketStaffPoseSampleContext>(
    BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
    {
      camera: ctx.camera,
      elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
      holdBlend,
      timestampMs: ctx.viewmodelNowMs ?? now,
    }
  );
}

function samplePhantomPrimaryPose(
  ctx: AbilityContext,
  side: -1 | 1,
  now: number
): ViewmodelSocketPose | null {
  if (!ctx.camera) return null;

  return sampleViewmodelPose<PhantomPrimaryPoseSampleContext>(
    PHANTOM_VIEWMODEL_PRIMARY_PALM_SOCKET_NAMES[side],
    {
      camera: ctx.camera,
      elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
      side,
      actionTimeSeconds: PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS,
      timestampMs: ctx.viewmodelNowMs ?? now,
    }
  );
}

function samplePhantomVoidRayPose(ctx: AbilityContext, now: number): ViewmodelSocketPose | null {
  if (!ctx.camera) return null;

  return sampleViewmodelPose<PhantomVoidRayOrbPoseSampleContext>(
    PHANTOM_VIEWMODEL_VOID_RAY_ORB_SOCKET_NAME,
    {
      camera: ctx.camera,
      elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
      timestampMs: ctx.viewmodelNowMs ?? now,
    }
  );
}

function sampleChronosPrimaryPose(ctx: AbilityContext, now: number): ViewmodelSocketPose | null {
  if (!ctx.camera) return null;

  return sampleViewmodelPose<ChronosPrimaryOrbPoseSampleContext>(
    CHRONOS_VIEWMODEL_PRIMARY_ORB_SOCKET_NAME,
    {
      camera: ctx.camera,
      elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
      timestampMs: ctx.viewmodelNowMs ?? now,
    }
  );
}

export function buildAbilityCastOriginHints(
  ctx: AbilityContext,
  input: InputState,
  options: BuildAbilityCastOriginHintOptions = {}
): AbilityCastOriginHint[] | undefined {
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
          hintFromPose(
            'phantom_dire_ball',
            PHANTOM_PRIMARY_PALM_SOCKET_NAMES[side],
            samplePhantomPrimaryPose(ctx, side, now)
          )
        );
      }
    }

    if (input.secondaryFire) {
      const voidRayPose = samplePhantomVoidRayPose(ctx, now);
      pushHint(
        hints,
        seen,
        hintFromPose('phantom_void_ray_charge', PHANTOM_VOID_RAY_ORB_SOCKET_NAME, voidRayPose)
      );
      pushHint(
        hints,
        seen,
        hintFromPose('phantom_void_ray', PHANTOM_VOID_RAY_ORB_SOCKET_NAME, voidRayPose)
      );
    }
  }

  if (ctx.heroId === 'hookshot') {
    if (input.primaryFire) {
      for (const side of [-1, 1] as const) {
        pushHint(
          hints,
          seen,
          hintFromPose(
            'hookshot_basic_attack',
            HOOKSHOT_HOOK_SOCKET_NAMES[side],
            readViewmodelSocket(HOOKSHOT_VIEWMODEL_HOOK_SOCKET_NAMES[side])
          )
        );
      }
    }

    if (input.secondaryFire) {
      pushHint(
        hints,
        seen,
        hintFromPose(
          'hookshot_heavy_attack',
          HOOKSHOT_HOOK_SOCKET_NAMES[1],
          readViewmodelSocket(HOOKSHOT_VIEWMODEL_HOOK_SOCKET_NAMES[1])
        )
      );
    }

    if (input.ability1) {
      pushHint(
        hints,
        seen,
        hintFromPose(
          'hookshot_grapple',
          HOOKSHOT_HOOK_SOCKET_NAMES[1],
          readViewmodelSocket(HOOKSHOT_VIEWMODEL_HOOK_SOCKET_NAMES[1])
        )
      );
    }

    if (input.ultimate) {
      pushHint(
        hints,
        seen,
        hintFromPose(
          'hookshot_grapple_trap',
          HOOKSHOT_HOOK_SOCKET_NAMES[1],
          readViewmodelSocket(HOOKSHOT_VIEWMODEL_HOOK_SOCKET_NAMES[1])
        )
      );
    }
  }

  if (ctx.heroId === 'blaze') {
    if (input.primaryFire) {
      pushHint(
        hints,
        seen,
        hintFromPose(
          'blaze_rocket',
          BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
          sampleBlazeStaffPose(ctx, now, 1)
        )
      );
    }

    if (input.ability1) {
      pushHint(
        hints,
        seen,
        hintFromPose(
          'blaze_flamethrower',
          BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
          sampleBlazeStaffPose(ctx, now, getBlazeFlamethrowerHeldBlend(now))
        )
      );
    }

    if (options.bombTargeting || input.secondaryFire) {
      pushHint(
        hints,
        seen,
        hintFromPose(
          'blaze_bomb',
          BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
          sampleBlazeStaffPose(ctx, now, getBlazeBombTargetHeldBlend(now))
        )
      );
    }

    if (input.ability2) {
      pushHint(
        hints,
        seen,
        hintFromPose(
          'blaze_rocketjump',
          BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
          sampleBlazeStaffPose(ctx, now + BLAZE_ROCKET_JUMP_IMPACT_DELAY_MS, 1)
        )
      );
    }
  }

  if (ctx.heroId === 'chronos') {
    if (input.primaryFire) {
      pushHint(
        hints,
        seen,
        hintFromPose(
          'chronos_verdant_pulse',
          CHRONOS_PRIMARY_ORB_SOCKET_NAME,
          sampleChronosPrimaryPose(ctx, now)
        )
      );
    }

    if (input.ability1) {
      pushHint(
        hints,
        seen,
        hintFromPose(
          'chronos_lifeline_conduit',
          CHRONOS_PRIMARY_ORB_SOCKET_NAME,
          sampleChronosPrimaryPose(ctx, now)
        )
      );
    }

    if (input.ability2) {
      pushHint(
        hints,
        seen,
        hintFromPose(
          'chronos_timebreak',
          CHRONOS_PRIMARY_ORB_SOCKET_NAME,
          sampleChronosPrimaryPose(ctx, now)
        )
      );
    }
  }

  return hints.length > 0 ? hints : undefined;
}
