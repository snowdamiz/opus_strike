import type { HeroId } from '@voxel-strike/shared';

export interface HeldBlendRuntime {
  held: boolean;
  changedAtMs: number;
  blendAtChange: number;
}

export interface PhantomViewmodelPoseRuntime {
  primary: HeldBlendRuntime;
  shieldCastStartedAtMs: number;
}

export interface BlazeViewmodelPoseRuntime {
  rocket: HeldBlendRuntime;
  bombTarget: HeldBlendRuntime;
  flamethrower: HeldBlendRuntime;
  staffShockwaveRevision: number;
  staffShockwaveStartedAtMs: number;
  rocketJumpStaffSlamRevision: number;
  rocketJumpStaffSlamStartedAtMs: number;
}

export interface ChronosViewmodelPoseRuntime {
  primary: HeldBlendRuntime;
  lifelineQueued: HeldBlendRuntime;
  primaryShotGlowStartedAtMs: number;
  lifelineConduitStartedAtMs: number;
  timebreakStartedAtMs: number;
  ascendantParadoxStartedAtMs: number;
}

export interface ViewmodelPoseRuntime {
  heroId: HeroId | null;
  revision: number;
  phantom: PhantomViewmodelPoseRuntime;
  blaze: BlazeViewmodelPoseRuntime;
  chronos: ChronosViewmodelPoseRuntime;
}

function createHeldBlendRuntime(): HeldBlendRuntime {
  return {
    held: false,
    changedAtMs: 0,
    blendAtChange: 0,
  };
}

export function createViewmodelPoseRuntime(heroId: HeroId | null = null): ViewmodelPoseRuntime {
  return {
    heroId,
    revision: 0,
    phantom: {
      primary: createHeldBlendRuntime(),
      shieldCastStartedAtMs: -Infinity,
    },
    blaze: {
      rocket: createHeldBlendRuntime(),
      bombTarget: createHeldBlendRuntime(),
      flamethrower: createHeldBlendRuntime(),
      staffShockwaveRevision: 0,
      staffShockwaveStartedAtMs: 0,
      rocketJumpStaffSlamRevision: 0,
      rocketJumpStaffSlamStartedAtMs: 0,
    },
    chronos: {
      primary: createHeldBlendRuntime(),
      lifelineQueued: createHeldBlendRuntime(),
      primaryShotGlowStartedAtMs: -Infinity,
      lifelineConduitStartedAtMs: -Infinity,
      timebreakStartedAtMs: -Infinity,
      ascendantParadoxStartedAtMs: -Infinity,
    },
  };
}

export const defaultViewmodelPoseRuntime = createViewmodelPoseRuntime();

export function resetViewmodelPoseRuntime(
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime,
  heroId: HeroId | null = runtime.heroId
): ViewmodelPoseRuntime {
  const next = createViewmodelPoseRuntime(heroId);
  runtime.heroId = next.heroId;
  runtime.revision += 1;
  runtime.phantom = next.phantom;
  runtime.blaze = next.blaze;
  runtime.chronos = next.chronos;
  return runtime;
}
