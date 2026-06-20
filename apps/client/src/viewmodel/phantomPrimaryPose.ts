import type * as THREE from 'three';
import {
  defaultViewmodelPoseRuntime,
  getViewmodelEventChannel,
  getViewmodelHeldBlend,
  setViewmodelHeldChannel,
  triggerViewmodelEventChannel,
  type ViewmodelPoseRuntime,
} from './viewmodelPoseRuntime';
export {
  PHANTOM_PRIMARY_PALM_SOCKET_NAMES,
  PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
} from '@voxel-strike/shared';

export const PHANTOM_PRIMARY_READY_TRANSITION_SECONDS = 0.24;
export const PHANTOM_PRIMARY_RETURN_TO_IDLE_MS = PHANTOM_PRIMARY_READY_TRANSITION_SECONDS * 1000;
export const PHANTOM_PRIMARY_SHOT_PULSE_DURATION_SECONDS = 0.24;
export const PHANTOM_PRIMARY_SHOT_PULSE_DURATION_MS = PHANTOM_PRIMARY_SHOT_PULSE_DURATION_SECONDS * 1000;
export const PHANTOM_PRIMARY_SHOT_PULSE_PEAK_TIME_SECONDS = 0.085;
export const PHANTOM_PRIMARY_SHOT_PULSE_HOLD_END_SECONDS = 0.13;
export const PHANTOM_PRIMARY_VISUAL_FIRE_LEAD_SECONDS = 0.02;
export const PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS = PHANTOM_PRIMARY_SHOT_PULSE_PEAK_TIME_SECONDS;
export const PHANTOM_VOID_RAY_RELEASE_EXTENSION_SECONDS = 0.5;
export const PHANTOM_VOID_RAY_RELEASE_LOCK_MS =
  (PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS + PHANTOM_VOID_RAY_RELEASE_EXTENSION_SECONDS) * 1000;
const PHANTOM_SHIELD_CAST_POSE_ATTACK_SECONDS = 0.12;
const PHANTOM_SHIELD_CAST_POSE_HOLD_SECONDS = 0.34;
const PHANTOM_SHIELD_CAST_POSE_FADE_SECONDS = 0.74;
export const PHANTOM_SHIELD_CAST_POSE_DURATION_MS = PHANTOM_SHIELD_CAST_POSE_FADE_SECONDS * 1000;
const PHANTOM_VEIL_CAST_OPEN_SECONDS = 0.14;
const PHANTOM_VEIL_CAST_CLAP_SECONDS = 0.36;
const PHANTOM_VEIL_CAST_HOLD_SECONDS = 0.64;
const PHANTOM_VEIL_CAST_FADE_SECONDS = 0.96;
export const PHANTOM_VEIL_CAST_POSE_DURATION_MS = PHANTOM_VEIL_CAST_FADE_SECONDS * 1000;
const PHANTOM_PRIMARY_HELD_CHANNEL = 'phantom.primaryHeld';
const PHANTOM_SHIELD_CAST_CHANNEL = 'phantom.personalShieldCast';
const PHANTOM_VEIL_CAST_CHANNEL = 'phantom.veilCast';

export interface PhantomPrimaryPoseSampleContext {
  camera: THREE.Camera;
  elapsedSeconds: number;
  side: -1 | 1;
  actionTimeSeconds?: number;
  holdBlend?: number;
  shotPulse?: number;
  timestampMs?: number;
}

export interface PhantomVoidRayOrbPoseSampleContext {
  camera: THREE.Camera;
  elapsedSeconds: number;
  timestampMs?: number;
}

export interface PhantomShieldCastPose {
  active: boolean;
  blend: number;
  push: number;
  pulse: number;
}

export interface PhantomVeilCastPose {
  active: boolean;
  blend: number;
  open: number;
  clap: number;
  contact: number;
  pulse: number;
}

const PHANTOM_SHIELD_CAST_IDLE_POSE: PhantomShieldCastPose = {
  active: false,
  blend: 0,
  push: 0,
  pulse: 0,
};
const PHANTOM_VEIL_CAST_IDLE_POSE: PhantomVeilCastPose = {
  active: false,
  blend: 0,
  open: 0,
  clap: 0,
  contact: 0,
  pulse: 0,
};

export function setPhantomPrimaryHeld(
  held: boolean,
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): void {
  setViewmodelHeldChannel({
    runtime,
    channelId: PHANTOM_PRIMARY_HELD_CHANNEL,
    held,
    transitionSeconds: PHANTOM_PRIMARY_READY_TRANSITION_SECONDS,
    timestampMs,
  });
}

export function getPhantomPrimaryHeldBlend(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): number {
  return getViewmodelHeldBlend({
    runtime,
    channelId: PHANTOM_PRIMARY_HELD_CHANNEL,
    transitionSeconds: PHANTOM_PRIMARY_READY_TRANSITION_SECONDS,
    timestampMs,
  });
}

export function triggerPhantomShieldCastPose(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): void {
  triggerViewmodelEventChannel(runtime, PHANTOM_SHIELD_CAST_CHANNEL, timestampMs);
}

export function triggerPhantomVeilCastPose(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): void {
  triggerViewmodelEventChannel(runtime, PHANTOM_VEIL_CAST_CHANNEL, timestampMs);
}

export function getPhantomShieldCastPose(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): PhantomShieldCastPose {
  const startedAtMs = getViewmodelEventChannel(runtime, PHANTOM_SHIELD_CAST_CHANNEL).startedAtMs;
  if (!Number.isFinite(startedAtMs)) return PHANTOM_SHIELD_CAST_IDLE_POSE;

  const elapsedSeconds = Math.max(0, timestampMs - startedAtMs) / 1000;
  if (elapsedSeconds > PHANTOM_SHIELD_CAST_POSE_FADE_SECONDS) return PHANTOM_SHIELD_CAST_IDLE_POSE;

  const attack = smoothstep(0, PHANTOM_SHIELD_CAST_POSE_ATTACK_SECONDS, elapsedSeconds);
  const fade = 1 - smoothstep(
    PHANTOM_SHIELD_CAST_POSE_HOLD_SECONDS,
    PHANTOM_SHIELD_CAST_POSE_FADE_SECONDS,
    elapsedSeconds
  );
  const blend = Math.max(0, Math.min(1, attack * fade));
  if (blend <= 0.001) return PHANTOM_SHIELD_CAST_IDLE_POSE;

  const pushWindow = Math.max(0, Math.min(1, elapsedSeconds / PHANTOM_SHIELD_CAST_POSE_HOLD_SECONDS));
  const pulseWindow = Math.max(0, Math.min(1, elapsedSeconds / PHANTOM_SHIELD_CAST_POSE_FADE_SECONDS));

  return {
    active: true,
    blend,
    push: Math.sin(pushWindow * Math.PI) * blend,
    pulse: Math.sin(pulseWindow * Math.PI) * blend,
  };
}

export function getPhantomVeilCastPose(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): PhantomVeilCastPose {
  const startedAtMs = getViewmodelEventChannel(runtime, PHANTOM_VEIL_CAST_CHANNEL).startedAtMs;
  if (!Number.isFinite(startedAtMs)) return PHANTOM_VEIL_CAST_IDLE_POSE;

  const elapsedSeconds = Math.max(0, timestampMs - startedAtMs) / 1000;
  if (elapsedSeconds > PHANTOM_VEIL_CAST_FADE_SECONDS) return PHANTOM_VEIL_CAST_IDLE_POSE;

  const fadeIn = smoothstep(0, PHANTOM_VEIL_CAST_OPEN_SECONDS, elapsedSeconds);
  const fadeOut = 1 - smoothstep(
    PHANTOM_VEIL_CAST_HOLD_SECONDS,
    PHANTOM_VEIL_CAST_FADE_SECONDS,
    elapsedSeconds
  );
  const blend = Math.max(0, Math.min(1, fadeIn * fadeOut));
  if (blend <= 0.001) return PHANTOM_VEIL_CAST_IDLE_POSE;

  const clap = smoothstep(PHANTOM_VEIL_CAST_OPEN_SECONDS * 0.72, PHANTOM_VEIL_CAST_CLAP_SECONDS, elapsedSeconds);
  const contact = smoothstep(PHANTOM_VEIL_CAST_CLAP_SECONDS * 0.86, PHANTOM_VEIL_CAST_CLAP_SECONDS, elapsedSeconds) * fadeOut;
  const pulseWindow = Math.max(0, Math.min(1, elapsedSeconds / PHANTOM_VEIL_CAST_FADE_SECONDS));

  return {
    active: true,
    blend,
    open: fadeIn * fadeOut,
    clap,
    contact,
    pulse: Math.sin(pulseWindow * Math.PI) * blend,
  };
}

export function getPhantomPrimaryShotPulse(timeSeconds: number): number {
  if (timeSeconds < 0) return 0;
  if (timeSeconds < PHANTOM_PRIMARY_SHOT_PULSE_PEAK_TIME_SECONDS) {
    return smoothstep(0, PHANTOM_PRIMARY_SHOT_PULSE_PEAK_TIME_SECONDS, timeSeconds);
  }
  if (timeSeconds < PHANTOM_PRIMARY_SHOT_PULSE_HOLD_END_SECONDS) return 1;
  if (timeSeconds < PHANTOM_PRIMARY_SHOT_PULSE_DURATION_SECONDS) {
    return 1 - smoothstep(
      PHANTOM_PRIMARY_SHOT_PULSE_HOLD_END_SECONDS,
      PHANTOM_PRIMARY_SHOT_PULSE_DURATION_SECONDS,
      timeSeconds
    );
  }
  return 0;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
