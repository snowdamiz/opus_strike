import type * as THREE from 'three';
import {
  CHRONOS_ASCENDANT_PARADOX_DURATION_MS,
  CHRONOS_LIFELINE_RELEASE_DELAY_MS,
  CHRONOS_PRIMARY_ORB_SOCKET_NAME,
  CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
} from '@voxel-strike/shared';

export { CHRONOS_PRIMARY_ORB_SOCKET_NAME };
export const CHRONOS_PRIMARY_READY_TRANSITION_SECONDS = 0.18;
export const CHRONOS_PRIMARY_FIRE_READY_BLEND = 0.86;
const CHRONOS_PRIMARY_SHOT_GLOW_ATTACK_SECONDS = 0.035;
const CHRONOS_PRIMARY_SHOT_GLOW_FADE_START_SECONDS = 0.055;
const CHRONOS_PRIMARY_SHOT_GLOW_FADE_END_SECONDS = 0.21;
const CHRONOS_LIFELINE_POSE_ATTACK_SECONDS = 0.18;
const CHRONOS_LIFELINE_POSE_RELEASE_SECONDS = CHRONOS_LIFELINE_RELEASE_DELAY_MS / 1000;
const CHRONOS_LIFELINE_POSE_FADE_START_SECONDS = 0.34;
const CHRONOS_LIFELINE_POSE_FADE_END_SECONDS = 0.78;
const CHRONOS_TIMEBREAK_POSE_ATTACK_SECONDS = CHRONOS_LIFELINE_POSE_ATTACK_SECONDS;
const CHRONOS_TIMEBREAK_POSE_RELEASE_SECONDS = CHRONOS_TIMEBREAK_RELEASE_DELAY_MS / 1000;
const CHRONOS_TIMEBREAK_POSE_FADE_START_SECONDS = CHRONOS_TIMEBREAK_POSE_RELEASE_SECONDS + 0.08;
const CHRONOS_TIMEBREAK_POSE_FADE_END_SECONDS = CHRONOS_TIMEBREAK_POSE_RELEASE_SECONDS + 0.56;
const CHRONOS_TIMEBREAK_RECOIL_ATTACK_SECONDS = 0.035;
const CHRONOS_TIMEBREAK_RECOIL_FADE_END_SECONDS = 0.26;
const CHRONOS_ASCENDANT_POSE_ATTACK_SECONDS = 0.26;
const CHRONOS_ASCENDANT_POSE_RELEASE_SECONDS = 0.42;
const CHRONOS_ASCENDANT_POSE_FADE_SECONDS = 0.55;

export interface ChronosPrimaryOrbPoseSampleContext {
  camera: THREE.Camera;
  elapsedSeconds: number;
  timestampMs?: number;
}

let chronosPrimaryHeld = false;
let chronosPrimaryHoldChangedAtMs = 0;
let chronosPrimaryHoldBlendAtChange = 0;
let chronosPrimaryShotGlowStartedAtMs = -Infinity;
let chronosLifelineConduitStartedAtMs = -Infinity;
let chronosTimebreakStartedAtMs = -Infinity;
let chronosAscendantParadoxStartedAtMs = -Infinity;

export function setChronosPrimaryHeld(held: boolean, timestampMs = Date.now()): void {
  if (chronosPrimaryHeld === held) return;

  chronosPrimaryHoldBlendAtChange = getChronosPrimaryHeldBlend(timestampMs);
  chronosPrimaryHeld = held;
  chronosPrimaryHoldChangedAtMs = timestampMs;
}

export function getChronosPrimaryHeldBlend(timestampMs = Date.now()): number {
  const targetBlend = chronosPrimaryHeld ? 1 : 0;
  const elapsedSeconds = Math.max(0, timestampMs - chronosPrimaryHoldChangedAtMs) / 1000;
  const progress = smoothstep(0, CHRONOS_PRIMARY_READY_TRANSITION_SECONDS, elapsedSeconds);
  return chronosPrimaryHoldBlendAtChange + (targetBlend - chronosPrimaryHoldBlendAtChange) * progress;
}

export function triggerChronosPrimaryShotGlow(timestampMs = Date.now()): void {
  chronosPrimaryShotGlowStartedAtMs = timestampMs;
}

export function getChronosPrimaryShotGlowBlend(timestampMs = Date.now()): number {
  const elapsedSeconds = (timestampMs - chronosPrimaryShotGlowStartedAtMs) / 1000;
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

export function triggerChronosLifelineConduitPose(timestampMs = Date.now()): void {
  chronosLifelineConduitStartedAtMs = timestampMs;
}

export function triggerChronosTimebreakPose(timestampMs = Date.now()): void {
  chronosTimebreakStartedAtMs = timestampMs;
}

export function triggerChronosAscendantParadoxPose(timestampMs = Date.now()): void {
  chronosAscendantParadoxStartedAtMs = timestampMs;
}

export function getChronosLifelineConduitPose(timestampMs = Date.now()): { glow: number; spread: number } {
  const elapsedSeconds = (timestampMs - chronosLifelineConduitStartedAtMs) / 1000;
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

export function getChronosTimebreakPose(timestampMs = Date.now()): { glow: number; spread: number; recoil: number } {
  const elapsedSeconds = (timestampMs - chronosTimebreakStartedAtMs) / 1000;
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

export function getChronosAscendantParadoxPose(timestampMs = Date.now()): { spinBoost: number } {
  const elapsedSeconds = (timestampMs - chronosAscendantParadoxStartedAtMs) / 1000;
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
