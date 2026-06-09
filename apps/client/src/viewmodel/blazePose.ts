import type * as THREE from 'three';

export const BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME = 'blaze.rocket.staffTip';

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

let blazeRocketHeld = false;
let rocketHoldChangedAtMs = 0;
let rocketHoldBlendAtChange = 0;
let blazeBombTargetHeld = false;
let bombTargetHoldChangedAtMs = 0;
let bombTargetHoldBlendAtChange = 0;
let blazeFlamethrowerHeld = false;
let flamethrowerHoldChangedAtMs = 0;
let flamethrowerHoldBlendAtChange = 0;
let staffShockwaveRevision = 0;
let staffShockwaveStartedAtMs = 0;
let rocketJumpStaffSlamRevision = 0;
let rocketJumpStaffSlamStartedAtMs = 0;

export interface BlazeRocketJumpStaffSlamPose {
  revision: number;
  active: boolean;
  elapsedMs: number;
  readyBlend: number;
  strikeBlend: number;
  recoverBlend: number;
  impactPulse: number;
}

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

export function setBlazeFlamethrowerHeld(held: boolean, timestampMs = Date.now()): void {
  if (blazeFlamethrowerHeld === held) return;

  flamethrowerHoldBlendAtChange = getBlazeFlamethrowerHeldBlend(timestampMs);
  blazeFlamethrowerHeld = held;
  flamethrowerHoldChangedAtMs = timestampMs;
}

export function getBlazeFlamethrowerHeldBlend(timestampMs = Date.now()): number {
  return getHeldBlend({
    held: blazeFlamethrowerHeld,
    changedAtMs: flamethrowerHoldChangedAtMs,
    blendAtChange: flamethrowerHoldBlendAtChange,
    timestampMs,
  });
}

export function getBlazeStaffHeldBlend(timestampMs = Date.now()): number {
  return Math.max(
    getBlazeRocketHeldBlend(timestampMs),
    getBlazeBombTargetHeldBlend(timestampMs),
    getBlazeFlamethrowerHeldBlend(timestampMs)
  );
}

export function triggerBlazeRocketJumpStaffSlam(timestampMs = Date.now()): number {
  rocketJumpStaffSlamRevision += 1;
  rocketJumpStaffSlamStartedAtMs = timestampMs;
  return rocketJumpStaffSlamRevision;
}

export function clearBlazeRocketJumpStaffSlam(): void {
  rocketJumpStaffSlamStartedAtMs = 0;
}

export function getBlazeRocketJumpStaffSlamPose(
  timestampMs = Date.now()
): BlazeRocketJumpStaffSlamPose {
  if (rocketJumpStaffSlamRevision <= 0 || rocketJumpStaffSlamStartedAtMs <= 0) {
    return BLAZE_ROCKET_JUMP_IDLE_POSE;
  }

  const elapsedMs = timestampMs - rocketJumpStaffSlamStartedAtMs;
  if (elapsedMs < 0 || elapsedMs > BLAZE_ROCKET_JUMP_ANIMATION_DURATION_MS) {
    return {
      ...BLAZE_ROCKET_JUMP_IDLE_POSE,
      revision: rocketJumpStaffSlamRevision,
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
    revision: rocketJumpStaffSlamRevision,
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

const BLAZE_ROCKET_JUMP_IDLE_POSE: BlazeRocketJumpStaffSlamPose = {
  revision: 0,
  active: false,
  elapsedMs: 0,
  readyBlend: 0,
  strikeBlend: 0,
  recoverBlend: 0,
  impactPulse: 0,
};
