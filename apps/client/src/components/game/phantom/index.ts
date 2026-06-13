// Phantom hero visual effects - split for maintainability
import { BLINK_EFFECT_DURATION } from './materials';
import { getFrameClock } from '../../../utils/frameClock';

// Core phantom effects
export { BlinkTeleportEffect } from './blinkTeleport';
export { PhantomVeil3DEffect } from './phantomVeil';
export { BLINK_EFFECT_DURATION } from './materials';

// Phantom abilities
export { VoidRay, VoidRays, VoidRaysManager } from './voidRay';
export { VoidZone, VoidZones, VoidZonesManager } from './voidZone';
export { DireBallsManager, prewarmDireBallResources } from './direBall';
export { PhantomPersonalShieldsManager, triggerPhantomShieldCastEffect } from './personalShield';

// ============================================================================
// EFFECT DATA TYPES
// ============================================================================

export interface BlinkEffectData {
  id: string;
  startPosition: { x: number; y: number; z: number };
  endPosition: { x: number; y: number; z: number };
  startTime: number;
  startFrameTime: number;
}

// ============================================================================
// FIXED EFFECT REGISTRY - accessible from PlayerController
// ============================================================================

interface EffectSlot<T> {
  active: boolean;
  endTime: number;
  endFrameTime: number;
  data: T;
}

const MAX_BLINK_EFFECTS = 16;

const blinkEffectSlots: EffectSlot<BlinkEffectData>[] = Array.from({ length: MAX_BLINK_EFFECTS }, (_, i) => ({
  active: false,
  endTime: 0,
  endFrameTime: 0,
  data: {
    id: `blink_slot_${i}`,
    startPosition: { x: 0, y: 0, z: 0 },
    endPosition: { x: 0, y: 0, z: 0 },
    startTime: 0,
    startFrameTime: 0,
  },
}));

let effectIdCounter = 0;
let nextBlinkSlot = 0;
let phantomEffectRevision = 0;

function claimSlot<T>(slots: EffectSlot<T>[], cursor: number): { slot: EffectSlot<T>; nextCursor: number } {
  for (let i = 0; i < slots.length; i++) {
    const index = (cursor + i) % slots.length;
    if (!slots[index].active) {
      return { slot: slots[index], nextCursor: (index + 1) % slots.length };
    }
  }

  return { slot: slots[cursor], nextCursor: (cursor + 1) % slots.length };
}

export function triggerBlinkEffect(start: { x: number; y: number; z: number }, end: { x: number; y: number; z: number }) {
  const now = Date.now();
  const frameNow = getFrameClock().nowMs;
  const claim = claimSlot(blinkEffectSlots, nextBlinkSlot);
  nextBlinkSlot = claim.nextCursor;
  claim.slot.active = true;
  claim.slot.endTime = now + BLINK_EFFECT_DURATION;
  claim.slot.endFrameTime = frameNow + BLINK_EFFECT_DURATION;
  claim.slot.data.id = `blink_${effectIdCounter++}`;
  claim.slot.data.startPosition.x = start.x;
  claim.slot.data.startPosition.y = start.y;
  claim.slot.data.startPosition.z = start.z;
  claim.slot.data.endPosition.x = end.x;
  claim.slot.data.endPosition.y = end.y;
  claim.slot.data.endPosition.z = end.z;
  claim.slot.data.startTime = now;
  claim.slot.data.startFrameTime = frameNow;
  phantomEffectRevision++;
}

export function collectActivePhantomEffects(
  frameNow: number,
  blinkOut: BlinkEffectData[]
): { blinkCount: number; revision: number } {
  blinkOut.length = 0;

  for (const slot of blinkEffectSlots) {
    if (!slot.active) continue;
    if (frameNow >= slot.endFrameTime) {
      slot.active = false;
      phantomEffectRevision++;
      continue;
    }
    blinkOut.push(slot.data);
  }

  return {
    blinkCount: blinkOut.length,
    revision: phantomEffectRevision,
  };
}
