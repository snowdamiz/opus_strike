import type * as THREE from 'three';
import {
  defaultViewmodelPoseRuntime,
  type BlazeViewmodelPoseRuntime,
  type HeldBlendRuntime,
  type ViewmodelPoseRuntime,
} from './viewmodelPoseRuntime';
export { BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME } from '@voxel-strike/shared';

export const BLAZE_ROCKET_READY_TRANSITION_SECONDS = 0.22;
export const BLAZE_ROCKET_JUMP_READY_MS = 150;
export const BLAZE_ROCKET_JUMP_STRIKE_MS = 70;
export const BLAZE_ROCKET_JUMP_RECOVER_MS = 160;
export const BLAZE_ROCKET_JUMP_IMPACT_DELAY_MS =
  BLAZE_ROCKET_JUMP_READY_MS + BLAZE_ROCKET_JUMP_STRIKE_MS;
export const BLAZE_ROCKET_JUMP_ANIMATION_DURATION_MS =
  BLAZE_ROCKET_JUMP_IMPACT_DELAY_MS + BLAZE_ROCKET_JUMP_RECOVER_MS;

export interface BlazeRocketStaffPoseSampleContext {
  camera: THREE.Camera;
  elapsedSeconds: number;
  holdBlend?: number;
  timestampMs?: number;
}

export interface BlazeRocketJumpStaffSlamPose {
  revision: number;
  active: boolean;
  elapsedMs: number;
  readyBlend: number;
  strikeBlend: number;
  recoverBlend: number;
  impactPulse: number;
}

function markHeldState(
  state: HeldBlendRuntime,
  held: boolean,
  timestampMs: number,
  runtime: ViewmodelPoseRuntime
): void {
  if (state.held === held) return;

  state.blendAtChange = getHeldBlend({ state, timestampMs });
  state.held = held;
  state.changedAtMs = timestampMs;
  runtime.revision += 1;
}

function blazeRuntime(runtime: ViewmodelPoseRuntime): BlazeViewmodelPoseRuntime {
  return runtime.blaze;
}

export function setBlazeRocketHeld(
  held: boolean,
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): void {
  markHeldState(blazeRuntime(runtime).rocket, held, timestampMs, runtime);
}

export function getBlazeRocketHeldBlend(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): number {
  return getHeldBlend({ state: blazeRuntime(runtime).rocket, timestampMs });
}

export function setBlazeBombTargetHeld(
  held: boolean,
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): void {
  markHeldState(blazeRuntime(runtime).bombTarget, held, timestampMs, runtime);
}

export function getBlazeBombTargetHeldBlend(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): number {
  return getHeldBlend({ state: blazeRuntime(runtime).bombTarget, timestampMs });
}

export function setBlazeFlamethrowerHeld(
  held: boolean,
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): void {
  markHeldState(blazeRuntime(runtime).flamethrower, held, timestampMs, runtime);
}

export function getBlazeFlamethrowerHeldBlend(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): number {
  return getHeldBlend({ state: blazeRuntime(runtime).flamethrower, timestampMs });
}

export function getBlazeStaffHeldBlend(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): number {
  return Math.max(
    getBlazeRocketHeldBlend(timestampMs, runtime),
    getBlazeBombTargetHeldBlend(timestampMs, runtime),
    getBlazeFlamethrowerHeldBlend(timestampMs, runtime)
  );
}

export function triggerBlazeRocketJumpStaffSlam(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): number {
  const state = blazeRuntime(runtime);
  state.rocketJumpStaffSlamRevision += 1;
  state.rocketJumpStaffSlamStartedAtMs = timestampMs;
  runtime.revision += 1;
  return state.rocketJumpStaffSlamRevision;
}

export function clearBlazeRocketJumpStaffSlam(
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): void {
  blazeRuntime(runtime).rocketJumpStaffSlamStartedAtMs = 0;
  runtime.revision += 1;
}

export function getBlazeRocketJumpStaffSlamPose(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): BlazeRocketJumpStaffSlamPose {
  const state = blazeRuntime(runtime);
  if (state.rocketJumpStaffSlamRevision <= 0 || state.rocketJumpStaffSlamStartedAtMs <= 0) {
    return BLAZE_ROCKET_JUMP_IDLE_POSE;
  }

  const elapsedMs = timestampMs - state.rocketJumpStaffSlamStartedAtMs;
  if (elapsedMs < 0 || elapsedMs > BLAZE_ROCKET_JUMP_ANIMATION_DURATION_MS) {
    return {
      ...BLAZE_ROCKET_JUMP_IDLE_POSE,
      revision: state.rocketJumpStaffSlamRevision,
      elapsedMs,
    };
  }

  const recoverBlend = smoothstep(
    BLAZE_ROCKET_JUMP_IMPACT_DELAY_MS,
    BLAZE_ROCKET_JUMP_ANIMATION_DURATION_MS,
    elapsedMs
  );
  const activeMultiplier = 1 - recoverBlend;
  const impactProgress = Math.max(0, Math.min(1, (elapsedMs - BLAZE_ROCKET_JUMP_IMPACT_DELAY_MS) / 120));

  return {
    revision: state.rocketJumpStaffSlamRevision,
    active: true,
    elapsedMs,
    readyBlend: smoothstep(0, BLAZE_ROCKET_JUMP_READY_MS, elapsedMs) * activeMultiplier,
    strikeBlend: smoothstep(
      BLAZE_ROCKET_JUMP_READY_MS,
      BLAZE_ROCKET_JUMP_IMPACT_DELAY_MS,
      elapsedMs
    ) * activeMultiplier,
    recoverBlend,
    impactPulse: Math.sin(impactProgress * Math.PI) * activeMultiplier,
  };
}

export interface BlazeStaffShockwaveEvent {
  revision: number;
  startedAtMs: number;
}

export function triggerBlazeStaffShockwave(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): void {
  const state = blazeRuntime(runtime);
  state.staffShockwaveRevision += 1;
  state.staffShockwaveStartedAtMs = timestampMs;
  runtime.revision += 1;
}

export function getBlazeStaffShockwaveEvent(
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): BlazeStaffShockwaveEvent {
  const state = blazeRuntime(runtime);
  return {
    revision: state.staffShockwaveRevision,
    startedAtMs: state.staffShockwaveStartedAtMs,
  };
}

function getHeldBlend({
  state,
  timestampMs,
}: {
  state: HeldBlendRuntime;
  timestampMs: number;
}): number {
  const targetBlend = state.held ? 1 : 0;
  const elapsedSeconds = Math.max(0, timestampMs - state.changedAtMs) / 1000;
  const progress = smoothstep(0, BLAZE_ROCKET_READY_TRANSITION_SECONDS, elapsedSeconds);
  return state.blendAtChange + (targetBlend - state.blendAtChange) * progress;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const BLAZE_ROCKET_JUMP_IDLE_POSE: BlazeRocketJumpStaffSlamPose = {
  revision: 0,
  active: false,
  elapsedMs: 0,
  readyBlend: 0,
  strikeBlend: 0,
  recoverBlend: 0,
  impactPulse: 0,
};
