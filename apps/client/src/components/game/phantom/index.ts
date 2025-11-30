// Phantom hero visual effects - split for maintainability

// Core phantom effects
export { BlinkTeleportEffect } from './blinkTeleport';
export { ShadowStepArrivalEffect } from './shadowStepArrival';
export { PhantomVeil3DEffect } from './phantomVeil';
export { BLINK_EFFECT_DURATION, SHADOW_ARRIVAL_DURATION } from './materials';

// Phantom abilities
export { VoidRay, VoidRays } from './voidRay';
export { VoidZone, VoidZones } from './voidZone';
export { ShadowStepIndicator } from './shadowStepIndicator';
export { DireBall, DireBalls } from './direBall';

// ============================================================================
// EFFECT DATA TYPES
// ============================================================================

export interface BlinkEffectData {
  id: string;
  startPosition: { x: number; y: number; z: number };
  endPosition: { x: number; y: number; z: number };
  startTime: number;
}

export interface ShadowArrivalData {
  id: string;
  position: { x: number; y: number; z: number };
  startTime: number;
}

// ============================================================================
// GLOBAL EFFECT STATE - accessible from PlayerController
// ============================================================================

export const blinkEffects: BlinkEffectData[] = [];
export const shadowArrivals: ShadowArrivalData[] = [];
let effectIdCounter = 0;

export function triggerBlinkEffect(start: { x: number; y: number; z: number }, end: { x: number; y: number; z: number }) {
  blinkEffects.push({
    id: `blink_${effectIdCounter++}`,
    startPosition: { ...start },
    endPosition: { ...end },
    startTime: Date.now(),
  });
}

export function triggerShadowArrival(position: { x: number; y: number; z: number }) {
  shadowArrivals.push({
    id: `shadow_${effectIdCounter++}`,
    position: { ...position },
    startTime: Date.now(),
  });
}

