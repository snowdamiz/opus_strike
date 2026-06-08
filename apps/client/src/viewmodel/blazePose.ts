import type * as THREE from 'three';

export const BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME = 'blaze.rocket.staffTip';

export const BLAZE_ROCKET_READY_TRANSITION_SECONDS = 0.22;

export interface BlazeRocketStaffPoseSampleContext {
  camera: THREE.Camera;
  elapsedSeconds: number;
  holdBlend?: number;
  timestampMs?: number;
}

let blazeRocketHeld = false;
let rocketHoldChangedAtMs = 0;
let rocketHoldBlendAtChange = 0;
let blazeBombTargetHeld = false;
let bombTargetHoldChangedAtMs = 0;
let bombTargetHoldBlendAtChange = 0;
let staffShockwaveRevision = 0;
let staffShockwaveStartedAtMs = 0;

export function setBlazeRocketHeld(held: boolean, timestampMs = Date.now()): void {
  if (blazeRocketHeld === held) return;

  rocketHoldBlendAtChange = getBlazeRocketHeldBlend(timestampMs);
  blazeRocketHeld = held;
  rocketHoldChangedAtMs = timestampMs;
}

export function getBlazeRocketHeldBlend(timestampMs = Date.now()): number {
  return getHeldBlend({
    held: blazeRocketHeld,
    changedAtMs: rocketHoldChangedAtMs,
    blendAtChange: rocketHoldBlendAtChange,
    timestampMs,
  });
}

export function setBlazeBombTargetHeld(held: boolean, timestampMs = Date.now()): void {
  if (blazeBombTargetHeld === held) return;

  bombTargetHoldBlendAtChange = getBlazeBombTargetHeldBlend(timestampMs);
  blazeBombTargetHeld = held;
  bombTargetHoldChangedAtMs = timestampMs;
}

export function getBlazeBombTargetHeldBlend(timestampMs = Date.now()): number {
  return getHeldBlend({
    held: blazeBombTargetHeld,
    changedAtMs: bombTargetHoldChangedAtMs,
    blendAtChange: bombTargetHoldBlendAtChange,
    timestampMs,
  });
}

export function getBlazeStaffHeldBlend(timestampMs = Date.now()): number {
  return Math.max(
    getBlazeRocketHeldBlend(timestampMs),
    getBlazeBombTargetHeldBlend(timestampMs)
  );
}

export interface BlazeStaffShockwaveEvent {
  revision: number;
  startedAtMs: number;
}

export function triggerBlazeStaffShockwave(timestampMs = Date.now()): void {
  staffShockwaveRevision += 1;
  staffShockwaveStartedAtMs = timestampMs;
}

export function getBlazeStaffShockwaveEvent(): BlazeStaffShockwaveEvent {
  return {
    revision: staffShockwaveRevision,
    startedAtMs: staffShockwaveStartedAtMs,
  };
}

function getHeldBlend({
  held,
  changedAtMs,
  blendAtChange,
  timestampMs,
}: {
  held: boolean;
  changedAtMs: number;
  blendAtChange: number;
  timestampMs: number;
}): number {
  const targetBlend = held ? 1 : 0;
  const elapsedSeconds = Math.max(0, timestampMs - changedAtMs) / 1000;
  const progress = smoothstep(0, BLAZE_ROCKET_READY_TRANSITION_SECONDS, elapsedSeconds);
  return blendAtChange + (targetBlend - blendAtChange) * progress;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
