import type * as THREE from 'three';
import {
  CHRONOS_ASCENDANT_PARADOX_DURATION_MS,
  CHRONOS_LIFELINE_RELEASE_DELAY_MS,
  CHRONOS_PRIMARY_ORB_SOCKET_NAME,
  CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
} from '@voxel-strike/shared';
import {
  defaultViewmodelPoseRuntime,
  type ChronosViewmodelPoseRuntime,
  type ViewmodelPoseRuntime,
} from './viewmodelPoseRuntime';

export { CHRONOS_PRIMARY_ORB_SOCKET_NAME };
export const CHRONOS_PRIMARY_READY_TRANSITION_SECONDS = 0.18;
export const CHRONOS_PRIMARY_RETURN_TO_IDLE_MS = CHRONOS_PRIMARY_READY_TRANSITION_SECONDS * 1000;
export const CHRONOS_PRIMARY_FIRE_READY_BLEND = 0.86;
const CHRONOS_LIFELINE_QUEUE_TRANSITION_SECONDS = 0.16;
const CHRONOS_LIFELINE_QUEUE_HEARTBEAT_SECONDS = 0.82;
const CHRONOS_PRIMARY_SHOT_GLOW_ATTACK_SECONDS = 0.035;
const CHRONOS_PRIMARY_SHOT_GLOW_FADE_START_SECONDS = 0.055;
const CHRONOS_PRIMARY_SHOT_GLOW_FADE_END_SECONDS = 0.21;
export const CHRONOS_PRIMARY_SHOT_GLOW_DURATION_MS = CHRONOS_PRIMARY_SHOT_GLOW_FADE_END_SECONDS * 1000;
const CHRONOS_LIFELINE_POSE_ATTACK_SECONDS = 0.18;
const CHRONOS_LIFELINE_POSE_RELEASE_SECONDS = CHRONOS_LIFELINE_RELEASE_DELAY_MS / 1000;
const CHRONOS_LIFELINE_POSE_FADE_START_SECONDS = 0.34;
const CHRONOS_LIFELINE_POSE_FADE_END_SECONDS = 0.78;
export const CHRONOS_LIFELINE_POSE_DURATION_MS = CHRONOS_LIFELINE_POSE_FADE_END_SECONDS * 1000;
const CHRONOS_TIMEBREAK_POSE_ATTACK_SECONDS = CHRONOS_LIFELINE_POSE_ATTACK_SECONDS;
const CHRONOS_TIMEBREAK_POSE_RELEASE_SECONDS = CHRONOS_TIMEBREAK_RELEASE_DELAY_MS / 1000;
const CHRONOS_TIMEBREAK_POSE_FADE_START_SECONDS = CHRONOS_TIMEBREAK_POSE_RELEASE_SECONDS + 0.08;
const CHRONOS_TIMEBREAK_POSE_FADE_END_SECONDS = CHRONOS_TIMEBREAK_POSE_RELEASE_SECONDS + 0.56;
export const CHRONOS_TIMEBREAK_POSE_DURATION_MS = CHRONOS_TIMEBREAK_POSE_FADE_END_SECONDS * 1000;
const CHRONOS_TIMEBREAK_RECOIL_ATTACK_SECONDS = 0.035;
const CHRONOS_TIMEBREAK_RECOIL_FADE_END_SECONDS = 0.26;
const CHRONOS_ASCENDANT_POSE_ATTACK_SECONDS = 0.26;
const CHRONOS_ASCENDANT_POSE_RELEASE_SECONDS = 0.42;
const CHRONOS_ASCENDANT_POSE_FADE_SECONDS = 0.55;
export const CHRONOS_ASCENDANT_CAST_LOCK_MS = (CHRONOS_ASCENDANT_POSE_RELEASE_SECONDS + 0.28) * 1000;

export interface ChronosPrimaryOrbPoseSampleContext {
  camera: THREE.Camera;
  elapsedSeconds: number;
  timestampMs?: number;
}

function chronosRuntime(runtime: ViewmodelPoseRuntime): ChronosViewmodelPoseRuntime {
  return runtime.chronos;
}

export function setChronosPrimaryHeld(
  held: boolean,
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): void {
  const state = chronosRuntime(runtime).primary;
  if (state.held === held) return;

  state.blendAtChange = getChronosPrimaryHeldBlend(timestampMs, runtime);
  state.held = held;
  state.changedAtMs = timestampMs;
  runtime.revision += 1;
}

export function getChronosPrimaryHeldBlend(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): number {
  const state = chronosRuntime(runtime).primary;
  const targetBlend = state.held ? 1 : 0;
  const elapsedSeconds = Math.max(0, timestampMs - state.changedAtMs) / 1000;
  const progress = smoothstep(0, CHRONOS_PRIMARY_READY_TRANSITION_SECONDS, elapsedSeconds);
  return state.blendAtChange + (targetBlend - state.blendAtChange) * progress;
}

export function setChronosLifelineQueued(
  queued: boolean,
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): void {
  const state = chronosRuntime(runtime).lifelineQueued;
  if (state.held === queued) return;

  state.blendAtChange = getChronosLifelineQueuedBlend(timestampMs, runtime);
  state.held = queued;
  state.changedAtMs = timestampMs;
  runtime.revision += 1;
}

export function getChronosLifelineQueuedBlend(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): number {
  const state = chronosRuntime(runtime).lifelineQueued;
  const targetBlend = state.held ? 1 : 0;
  const elapsedSeconds = Math.max(0, timestampMs - state.changedAtMs) / 1000;
  const progress = smoothstep(0, CHRONOS_LIFELINE_QUEUE_TRANSITION_SECONDS, elapsedSeconds);
  return state.blendAtChange + (targetBlend - state.blendAtChange) * progress;
}

export function getChronosLifelineQueuedPose(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): { glow: number; heartbeat: number } {
  const blend = getChronosLifelineQueuedBlend(timestampMs, runtime);
  if (blend <= 0.001) return { glow: 0, heartbeat: 0 };

  const elapsedSeconds = Math.max(0, timestampMs - chronosRuntime(runtime).lifelineQueued.changedAtMs) / 1000;
  const phase = elapsedSeconds % CHRONOS_LIFELINE_QUEUE_HEARTBEAT_SECONDS;
  const firstBeat = pulseWindow(phase, 0.03, 0.18);
  const secondBeat = pulseWindow(phase, 0.24, 0.14) * 0.68;
  const heartbeat = Math.max(firstBeat, secondBeat) * blend;

  return {
    glow: blend * (0.64 + heartbeat * 0.36),
    heartbeat,
  };
}

export function triggerChronosPrimaryShotGlow(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): void {
  chronosRuntime(runtime).primaryShotGlowStartedAtMs = timestampMs;
  runtime.revision += 1;
}

export function getChronosPrimaryShotGlowBlend(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): number {
  const elapsedSeconds = (timestampMs - chronosRuntime(runtime).primaryShotGlowStartedAtMs) / 1000;
  if (elapsedSeconds < 0 || elapsedSeconds > CHRONOS_PRIMARY_SHOT_GLOW_FADE_END_SECONDS) return 0;

  const attack = smoothstep(0, CHRONOS_PRIMARY_SHOT_GLOW_ATTACK_SECONDS, elapsedSeconds);
  const fade =
    1 -
    smoothstep(
      CHRONOS_PRIMARY_SHOT_GLOW_FADE_START_SECONDS,
      CHRONOS_PRIMARY_SHOT_GLOW_FADE_END_SECONDS,
      elapsedSeconds
    );
  return Math.max(0, Math.min(1, attack * fade));
}

export function triggerChronosLifelineConduitPose(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): void {
  chronosRuntime(runtime).lifelineConduitStartedAtMs = timestampMs;
  runtime.revision += 1;
}

export function triggerChronosTimebreakPose(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): void {
  chronosRuntime(runtime).timebreakStartedAtMs = timestampMs;
  runtime.revision += 1;
}

export function triggerChronosAscendantParadoxPose(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): void {
  chronosRuntime(runtime).ascendantParadoxStartedAtMs = timestampMs;
  runtime.revision += 1;
}

export function getChronosLifelineConduitPose(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): { glow: number; spread: number } {
  const elapsedSeconds = (timestampMs - chronosRuntime(runtime).lifelineConduitStartedAtMs) / 1000;
  if (elapsedSeconds < 0 || elapsedSeconds > CHRONOS_LIFELINE_POSE_FADE_END_SECONDS) {
    return { glow: 0, spread: 0 };
  }

  const charge = smoothstep(0, CHRONOS_LIFELINE_POSE_ATTACK_SECONDS, elapsedSeconds);
  const fade =
    1 -
    smoothstep(
      CHRONOS_LIFELINE_POSE_FADE_START_SECONDS,
      CHRONOS_LIFELINE_POSE_FADE_END_SECONDS,
      elapsedSeconds
    );
  const releaseFlash =
    1 -
    smoothstep(
      CHRONOS_LIFELINE_POSE_RELEASE_SECONDS,
      CHRONOS_LIFELINE_POSE_RELEASE_SECONDS + 0.28,
      elapsedSeconds
    );

  return {
    glow: Math.max(charge * fade, releaseFlash * charge),
    spread: charge * fade,
  };
}

export function getChronosTimebreakPose(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): { glow: number; spread: number; recoil: number } {
  const elapsedSeconds = (timestampMs - chronosRuntime(runtime).timebreakStartedAtMs) / 1000;
  if (elapsedSeconds < 0 || elapsedSeconds > CHRONOS_TIMEBREAK_POSE_FADE_END_SECONDS) {
    return { glow: 0, spread: 0, recoil: 0 };
  }

  const charge = smoothstep(0, CHRONOS_TIMEBREAK_POSE_ATTACK_SECONDS, elapsedSeconds);
  const fade =
    1 -
    smoothstep(
      CHRONOS_TIMEBREAK_POSE_FADE_START_SECONDS,
      CHRONOS_TIMEBREAK_POSE_FADE_END_SECONDS,
      elapsedSeconds
    );
  const releaseFlash =
    1 -
    smoothstep(
      CHRONOS_TIMEBREAK_POSE_RELEASE_SECONDS,
      CHRONOS_TIMEBREAK_POSE_RELEASE_SECONDS + 0.24,
      elapsedSeconds
    );
  const releaseElapsed = elapsedSeconds - CHRONOS_TIMEBREAK_POSE_RELEASE_SECONDS;
  const recoil = releaseElapsed < 0 || releaseElapsed > CHRONOS_TIMEBREAK_RECOIL_FADE_END_SECONDS
    ? 0
    : smoothstep(0, CHRONOS_TIMEBREAK_RECOIL_ATTACK_SECONDS, releaseElapsed) *
      (1 - smoothstep(CHRONOS_TIMEBREAK_RECOIL_ATTACK_SECONDS, CHRONOS_TIMEBREAK_RECOIL_FADE_END_SECONDS, releaseElapsed));

  return {
    glow: Math.max(charge * fade, releaseFlash * charge),
    spread: charge * fade,
    recoil: recoil * charge,
  };
}

export function getChronosAscendantParadoxPose(
  timestampMs = Date.now(),
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime
): { spinBoost: number } {
  const elapsedSeconds = (timestampMs - chronosRuntime(runtime).ascendantParadoxStartedAtMs) / 1000;
  const durationSeconds = CHRONOS_ASCENDANT_PARADOX_DURATION_MS / 1000;
  if (elapsedSeconds < 0 || elapsedSeconds > durationSeconds + CHRONOS_ASCENDANT_POSE_FADE_SECONDS) {
    return { spinBoost: 0 };
  }

  const charge = smoothstep(0, CHRONOS_ASCENDANT_POSE_ATTACK_SECONDS, elapsedSeconds);
  const remainingSeconds = durationSeconds - elapsedSeconds;
  const fadeOut = remainingSeconds <= CHRONOS_ASCENDANT_POSE_FADE_SECONDS
    ? smoothstep(0, CHRONOS_ASCENDANT_POSE_FADE_SECONDS, remainingSeconds)
    : 1;
  const releaseFlash =
    1 -
    smoothstep(
      CHRONOS_ASCENDANT_POSE_RELEASE_SECONDS,
      CHRONOS_ASCENDANT_POSE_RELEASE_SECONDS + 0.28,
      elapsedSeconds
    );
  const intensity = charge * fadeOut;
  const flashBoost = releaseFlash * charge;

  return {
    spinBoost: Math.max(intensity, flashBoost),
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function pulseWindow(value: number, start: number, duration: number): number {
  if (duration <= 0) return 0;
  const t = (value - start) / duration;
  if (t < 0 || t > 1) return 0;
  return Math.sin(Math.PI * t) ** 2;
}
