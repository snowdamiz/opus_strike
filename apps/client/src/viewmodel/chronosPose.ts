import type * as THREE from 'three';

export const CHRONOS_PRIMARY_ORB_SOCKET_NAME = 'chronos.primary.orb';
export const CHRONOS_PRIMARY_READY_TRANSITION_SECONDS = 0.18;
export const CHRONOS_PRIMARY_FIRE_READY_BLEND = 0.86;
export const CHRONOS_LIFELINE_RELEASE_DELAY_MS = 210;
const CHRONOS_PRIMARY_SHOT_GLOW_ATTACK_SECONDS = 0.035;
const CHRONOS_PRIMARY_SHOT_GLOW_FADE_START_SECONDS = 0.055;
const CHRONOS_PRIMARY_SHOT_GLOW_FADE_END_SECONDS = 0.21;
const CHRONOS_LIFELINE_POSE_ATTACK_SECONDS = 0.18;
const CHRONOS_LIFELINE_POSE_RELEASE_SECONDS = CHRONOS_LIFELINE_RELEASE_DELAY_MS / 1000;
const CHRONOS_LIFELINE_POSE_FADE_START_SECONDS = 0.34;
const CHRONOS_LIFELINE_POSE_FADE_END_SECONDS = 0.78;

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

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
