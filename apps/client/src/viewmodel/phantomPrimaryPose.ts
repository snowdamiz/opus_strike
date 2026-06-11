import type * as THREE from 'three';
export {
  PHANTOM_PRIMARY_PALM_SOCKET_NAMES,
  PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
} from '@voxel-strike/shared';

export const PHANTOM_PRIMARY_READY_TRANSITION_SECONDS = 0.24;
export const PHANTOM_PRIMARY_SHOT_PULSE_DURATION_SECONDS = 0.24;
export const PHANTOM_PRIMARY_SHOT_PULSE_PEAK_TIME_SECONDS = 0.085;
export const PHANTOM_PRIMARY_SHOT_PULSE_HOLD_END_SECONDS = 0.13;
export const PHANTOM_PRIMARY_VISUAL_FIRE_LEAD_SECONDS = 0.02;
export const PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS = PHANTOM_PRIMARY_SHOT_PULSE_PEAK_TIME_SECONDS;

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

let phantomPrimaryHeld = false;
let holdChangedAtMs = 0;
let holdBlendAtChange = 0;

export function setPhantomPrimaryHeld(held: boolean, timestampMs = Date.now()): void {
  if (phantomPrimaryHeld === held) return;

  holdBlendAtChange = getPhantomPrimaryHeldBlend(timestampMs);
  phantomPrimaryHeld = held;
  holdChangedAtMs = timestampMs;
}

export function getPhantomPrimaryHeldBlend(timestampMs = Date.now()): number {
  const targetBlend = phantomPrimaryHeld ? 1 : 0;
  const elapsedSeconds = Math.max(0, timestampMs - holdChangedAtMs) / 1000;
  const progress = smoothstep(0, PHANTOM_PRIMARY_READY_TRANSITION_SECONDS, elapsedSeconds);
  return holdBlendAtChange + (targetBlend - holdBlendAtChange) * progress;
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
