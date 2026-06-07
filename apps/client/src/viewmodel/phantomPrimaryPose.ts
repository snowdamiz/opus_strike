import type * as THREE from 'three';

export const PHANTOM_PRIMARY_PALM_SOCKET_NAMES = {
  [-1]: 'phantom.primary.leftPalm',
  [1]: 'phantom.primary.rightPalm',
} as const satisfies Record<-1 | 1, string>;

export const PHANTOM_PRIMARY_ATTACK_DURATION_SECONDS = 0.24;
export const PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS = 0.085;

export interface PhantomPrimaryPoseSampleContext {
  camera: THREE.Camera;
  elapsedSeconds: number;
  side: -1 | 1;
  actionTimeSeconds?: number;
  timestampMs?: number;
}

export function getPhantomPrimaryAttackBlend(timeSeconds: number): number {
  if (timeSeconds < 0) return 0;
  if (timeSeconds < 0.07) return smoothstep(0, 0.07, timeSeconds);
  if (timeSeconds < 0.13) return 1;
  if (timeSeconds < PHANTOM_PRIMARY_ATTACK_DURATION_SECONDS) {
    return 1 - smoothstep(0.13, PHANTOM_PRIMARY_ATTACK_DURATION_SECONDS, timeSeconds);
  }
  return 0;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

