import type * as THREE from 'three';
import {
  clearViewmodelEventChannel,
  defaultViewmodelPoseRuntime,
  getViewmodelEventChannel,
  getViewmodelHeldBlend,
  setViewmodelHeldChannel,
  triggerViewmodelEventChannel,
  type ViewmodelPoseRuntime,
} from './viewmodelPoseRuntime';
export { BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME } from '@voxel-strike/shared';

export const BLAZE_ROCKET_READY_TRANSITION_SECONDS = 0.22;
export const BLAZE_STAFF_RETURN_TO_IDLE_MS = BLAZE_ROCKET_READY_TRANSITION_SECONDS * 1000;
export const BLAZE_STAFF_SHOCKWAVE_DURATION_MS = 900;
export const BLAZE_ROCKET_JUMP_READY_MS = 150;
export const BLAZE_ROCKET_JUMP_STRIKE_MS = 70;
export const BLAZE_ROCKET_JUMP_RECOVER_MS = 160;
export const BLAZE_ROCKET_JUMP_IMPACT_DELAY_MS =
  BLAZE_ROCKET_JUMP_READY_MS + BLAZE_ROCKET_JUMP_STRIKE_MS;
export const BLAZE_ROCKET_JUMP_ANIMATION_DURATION_MS =
  BLAZE_ROCKET_JUMP_IMPACT_DELAY_MS + BLAZE_ROCKET_JUMP_RECOVER_MS;
const BLAZE_ROCKET_HELD_CHANNEL = 'blaze.rocketHeld';
const BLAZE_BOMB_TARGET_CHANNEL = 'blaze.bombTarget';
const BLAZE_FLAMETHROWER_HELD_CHANNEL = 'blaze.flamethrowerHeld';
const BLAZE_STAFF_SHOCKWAVE_CHANNEL = 'blaze.staffShockwave';
const BLAZE_ROCKET_JUMP_STAFF_SLAM_CHANNEL = 'blaze.rocketJumpStaffSlam';

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
  runtime: ViewmodelPoseRuntime,
  channelId: string,
  held: boolean,
  timestampMs: number
): void {
  setViewmodelHeldChannel({
    runtime,
    channelId,
    held,
    transitionSeconds: BLAZE_ROCKET_READY_TRANSITION_SECONDS,
    timestampMs,
  });
}

export function setBlazeRocketHeld(
  held: boolean,
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): void {
  markHeldState(runtime, BLAZE_ROCKET_HELD_CHANNEL, held, timestampMs);
}

export function getBlazeRocketHeldBlend(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): number {
  return getViewmodelHeldBlend({
    runtime,
    channelId: BLAZE_ROCKET_HELD_CHANNEL,
    transitionSeconds: BLAZE_ROCKET_READY_TRANSITION_SECONDS,
    timestampMs,
  });
}

export function setBlazeBombTargetHeld(
  held: boolean,
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): void {
  markHeldState(runtime, BLAZE_BOMB_TARGET_CHANNEL, held, timestampMs);
}

export function getBlazeBombTargetHeldBlend(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): number {
  return getViewmodelHeldBlend({
    runtime,
    channelId: BLAZE_BOMB_TARGET_CHANNEL,
    transitionSeconds: BLAZE_ROCKET_READY_TRANSITION_SECONDS,
    timestampMs,
  });
}

export function setBlazeFlamethrowerHeld(
  held: boolean,
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): void {
  markHeldState(runtime, BLAZE_FLAMETHROWER_HELD_CHANNEL, held, timestampMs);
}

export function getBlazeFlamethrowerHeldBlend(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): number {
  return getViewmodelHeldBlend({
    runtime,
    channelId: BLAZE_FLAMETHROWER_HELD_CHANNEL,
    transitionSeconds: BLAZE_ROCKET_READY_TRANSITION_SECONDS,
    timestampMs,
  });
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
  return triggerViewmodelEventChannel(runtime, BLAZE_ROCKET_JUMP_STAFF_SLAM_CHANNEL, timestampMs);
}

export function clearBlazeRocketJumpStaffSlam(
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): void {
  clearViewmodelEventChannel(runtime, BLAZE_ROCKET_JUMP_STAFF_SLAM_CHANNEL, 0);
}

export function getBlazeRocketJumpStaffSlamPose(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): BlazeRocketJumpStaffSlamPose {
  const state = getViewmodelEventChannel(runtime, BLAZE_ROCKET_JUMP_STAFF_SLAM_CHANNEL);
  if (state.revision <= 0 || state.startedAtMs <= 0) {
    return BLAZE_ROCKET_JUMP_IDLE_POSE;
  }

  const elapsedMs = timestampMs - state.startedAtMs;
  if (elapsedMs < 0 || elapsedMs > BLAZE_ROCKET_JUMP_ANIMATION_DURATION_MS) {
    return {
      ...BLAZE_ROCKET_JUMP_IDLE_POSE,
      revision: state.revision,
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
    revision: state.revision,
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
  triggerViewmodelEventChannel(runtime, BLAZE_STAFF_SHOCKWAVE_CHANNEL, timestampMs);
}

export function getBlazeStaffShockwaveEvent(
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): BlazeStaffShockwaveEvent {
  const state = getViewmodelEventChannel(runtime, BLAZE_STAFF_SHOCKWAVE_CHANNEL);
  return {
    revision: state.revision,
    startedAtMs: state.startedAtMs,
  };
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
