import type * as THREE from 'three';

export const CHRONOS_PRIMARY_ORB_SOCKET_NAME = 'chronos.primary.orb';
export const CHRONOS_PRIMARY_READY_TRANSITION_SECONDS = 0.18;
export const CHRONOS_PRIMARY_FIRE_READY_BLEND = 0.86;

export interface ChronosPrimaryOrbPoseSampleContext {
  camera: THREE.Camera;
  elapsedSeconds: number;
  timestampMs?: number;
}

let chronosPrimaryHeld = false;
let chronosPrimaryHoldChangedAtMs = 0;
let chronosPrimaryHoldBlendAtChange = 0;

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

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
