/**
 * SHARED EFFECT RESOURCES
 * ======================
 * Centralized module for all shared Three.js resources used by ability effects.
 * This eliminates duplicate geometry/material creation and reduces memory usage.
 * 
 * PERFORMANCE BENEFITS:
 * - Single geometry instance shared across all effects
 * - Pre-compiled shader materials with pooling for uniforms
 * - Reduces GC pressure by avoiding per-frame allocations
 * - Materials compiled on first access, not during gameplay
 */

import * as THREE from 'three';

// ============================================================================
// SHARED GEOMETRIES - Created once, reused everywhere
// All geometries use normalized size (1) and are scaled via mesh.scale
// ============================================================================

export const SHARED_GEOMETRIES = {
  // Spheres (varying LOD levels)
  sphere4: new THREE.SphereGeometry(1, 4, 4),   // Very low poly for distant/small
  sphere6: new THREE.SphereGeometry(1, 6, 6),   // Low poly
  sphere8: new THREE.SphereGeometry(1, 8, 8),   // Medium poly (default)
  sphere12: new THREE.SphereGeometry(1, 12, 12), // Higher poly
  sphere16: new THREE.SphereGeometry(1, 16, 16), // High poly for close-up
  
  // Cones
  cone4: new THREE.ConeGeometry(1, 1, 4),
  cone6: new THREE.ConeGeometry(1, 1, 6),
  cone8: new THREE.ConeGeometry(1, 1, 8),
  
  // Rings (for ground indicators, shockwaves)
  ring8: new THREE.RingGeometry(0.8, 1, 8),
  ring16: new THREE.RingGeometry(0.8, 1, 16),
  ring24: new THREE.RingGeometry(0.8, 1, 24),
  ring32: new THREE.RingGeometry(0.8, 1, 32),
  
  // Circles (for AOE fills, ground effects)
  circle8: new THREE.CircleGeometry(1, 8),
  circle16: new THREE.CircleGeometry(1, 16),
  circle32: new THREE.CircleGeometry(1, 32),
  
  // Planes
  plane: new THREE.PlaneGeometry(1, 1),
  
  // Boxes
  box: new THREE.BoxGeometry(1, 1, 1),
  
  // Cylinders (for beams, ropes)
  cylinder6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cylinder8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cylinder12: new THREE.CylinderGeometry(1, 1, 1, 12),
  cylinder16: new THREE.CylinderGeometry(1, 1, 1, 16),
  
  // Open cylinders (for glow tubes)
  cylinderOpen8: new THREE.CylinderGeometry(1, 1, 1, 8, 1, true),
  cylinderOpen12: new THREE.CylinderGeometry(1, 1, 1, 12, 1, true),
  cylinderOpen16: new THREE.CylinderGeometry(1, 1, 1, 16, 1, true),
} as const;

// ============================================================================
// PRE-ALLOCATED VECTORS - Avoid GC pressure in useFrame loops
// Use these for temporary calculations, never store references
// ============================================================================

export const TEMP_VECTORS = {
  v1: new THREE.Vector3(),
  v2: new THREE.Vector3(),
  v3: new THREE.Vector3(),
  v4: new THREE.Vector3(),
  quat1: new THREE.Quaternion(),
  quat2: new THREE.Quaternion(),
  euler1: new THREE.Euler(),
  color1: new THREE.Color(),
  forward: new THREE.Vector3(0, 0, -1),
  up: new THREE.Vector3(0, 1, 0),
  right: new THREE.Vector3(1, 0, 0),
} as const;

// ============================================================================
// SHARED BASIC MATERIALS - Pre-created, reusable basic materials
// For additive blending effects, use these instead of creating new materials
// ============================================================================

const materialCache = new Map<string, THREE.Material>();

function getCachedMaterial<T extends THREE.Material>(
  key: string, 
  factory: () => T
): T {
  if (!materialCache.has(key)) {
    materialCache.set(key, factory());
  }
  return materialCache.get(key) as T;
}

// Basic additive glow materials (different colors)
export function getGlowMaterial(color: number, opacity: number = 0.5): THREE.MeshBasicMaterial {
  const key = `glow_${color.toString(16)}_${opacity}`;
  return getCachedMaterial(key, () => new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
}

// Standard metal material (for hooks, mechanical parts)
export function getMetalMaterial(color: number, metalness: number = 0.9, roughness: number = 0.2): THREE.MeshStandardMaterial {
  const key = `metal_${color.toString(16)}_${metalness}_${roughness}`;
  return getCachedMaterial(key, () => new THREE.MeshStandardMaterial({
    color,
    metalness,
    roughness,
  }));
}

// Double-sided transparent material (for rings, indicators)
export function getRingMaterial(color: number, opacity: number = 0.8): THREE.MeshBasicMaterial {
  const key = `ring_${color.toString(16)}_${opacity}`;
  return getCachedMaterial(key, () => new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  }));
}

// Additive ring material (for energy effects)
export function getAdditiveRingMaterial(color: number, opacity: number = 0.8): THREE.MeshBasicMaterial {
  const key = `addring_${color.toString(16)}_${opacity}`;
  return getCachedMaterial(key, () => new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
}

// Point material (for particles)
export function getPointMaterial(color: number, size: number = 0.1, opacity: number = 0.8): THREE.PointsMaterial {
  const key = `point_${color.toString(16)}_${size}_${opacity}`;
  return getCachedMaterial(key, () => new THREE.PointsMaterial({
    color,
    size,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  }));
}

// ============================================================================
// HOOKSHOT COLOR PALETTE
// ============================================================================

export const HOOKSHOT_COLORS = {
  metal: 0x4a4a4a,
  metalLight: 0x6a6a6a,
  metalDark: 0x2a2a2a,
  rope: 0x8b7355,
  ropeHighlight: 0xa08060,
  hookTip: 0xcccccc,
  energy: 0x00ccff,
  energyGlow: 0x0099cc,
  trap: 0xff6600,
  trapGlow: 0xff9944,
  danger: 0xff3333,
} as const;

// ============================================================================
// BLAZE/FIRE COLOR PALETTE  
// ============================================================================

export const BLAZE_COLORS = {
  fireWhite: 0xffffff,
  fireYellow: 0xffffcc,
  fireOrange: 0xffaa00,
  fireRed: 0xff5500,
  fireDarkRed: 0xcc2200,
  smoke: 0x555555,
  smokeDark: 0x333333,
  metal: 0x333333,
  warning: 0xff0000,
} as const;

// ============================================================================
// PHANTOM/VOID COLOR PALETTE
// ============================================================================

export const PHANTOM_COLORS = {
  voidDeep: 0x0a0015,
  violet: 0x7c3aed,
  lightPurple: 0xc084fc,
  purple: 0x9333ea,
  cyan: 0x00ffff,
  white: 0xffffff,
  shadow: 0x1a0033,
} as const;

// ============================================================================
// EARTH COLOR PALETTE
// ============================================================================

export const EARTH_COLORS = {
  dirt: 0x8b4513,
  dirtDark: 0x654321,
  dirtLight: 0xa0522d,
  rock: 0x696969,
  grass: 0x556b2f,
  hookMetal: 0x3a3a3a,
  hookGlow: 0xff6600,
} as const;

// ============================================================================
// SHARED BLAZE MATERIALS (pre-created and pre-compiled for instant use)
// ALL materials used by Blaze effects are defined here to avoid first-use stutter
// ============================================================================

let _blazeMaterials: {
  // Targeting indicator materials
  bombOuterRing: THREE.MeshBasicMaterial;
  bombMidRing: THREE.MeshBasicMaterial;
  bombInnerRing: THREE.MeshBasicMaterial;
  bombCenterDot: THREE.MeshBasicMaterial;
  bombFill: THREE.MeshBasicMaterial;
  bombCrossValid: THREE.MeshBasicMaterial;
  bombBeam: THREE.MeshBasicMaterial;
  bombBeamTop: THREE.MeshBasicMaterial;
  airOuterRing: THREE.MeshBasicMaterial;
  airInnerRing: THREE.MeshBasicMaterial;
  airCenterDot: THREE.MeshBasicMaterial;
  airFill: THREE.MeshBasicMaterial;
  airCross: THREE.MeshBasicMaterial;
  airValidMidRing: THREE.MeshBasicMaterial;
  // Rocket materials
  rocketBody: THREE.MeshBasicMaterial;
  rocketNose: THREE.MeshBasicMaterial;
  rocketFireCore: THREE.MeshBasicMaterial;
  rocketFireInner: THREE.MeshBasicMaterial;
  rocketFireOuter: THREE.MeshBasicMaterial;
  rocketSmokeTrail: THREE.MeshBasicMaterial;
  // Explosion materials
  explosionFlash: THREE.MeshBasicMaterial;
  explosionCore: THREE.MeshBasicMaterial;
  explosionMid: THREE.MeshBasicMaterial;
  explosionOuter: THREE.MeshBasicMaterial;
  explosionDarkOuter: THREE.MeshBasicMaterial;
  shockwaveOrange: THREE.MeshBasicMaterial;
  shockwaveYellow: THREE.MeshBasicMaterial;
  smoke: THREE.MeshBasicMaterial;
  smokeDark: THREE.MeshBasicMaterial;
  sparkYellow: THREE.MeshBasicMaterial;
  sparkOrange: THREE.MeshBasicMaterial;
  groundScorch: THREE.MeshBasicMaterial;
  // Bomb effect materials
  bombBodyDark: THREE.MeshBasicMaterial;
  bombMetal: THREE.MeshBasicMaterial;
  bombNose: THREE.MeshBasicMaterial;
  bombFin: THREE.MeshBasicMaterial;
  bombStripe: THREE.MeshBasicMaterial;
  bombTrailFire: THREE.MeshBasicMaterial;
  bombGlow: THREE.MeshBasicMaterial;
  warningRingRed: THREE.MeshBasicMaterial;
  warningRingOrange: THREE.MeshBasicMaterial;
  warningRingYellow: THREE.MeshBasicMaterial;
  warningCross: THREE.MeshBasicMaterial;
  warningCrossDiag: THREE.MeshBasicMaterial;
  warningFillPulse: THREE.MeshBasicMaterial;
  // Airstrike bomb materials
  airBombBody: THREE.MeshBasicMaterial;
  airBombTrail: THREE.MeshBasicMaterial;
  airWarningRing: THREE.MeshBasicMaterial;
  airWarningFill: THREE.MeshBasicMaterial;
  // Jetpack materials
  jetpackNozzle: THREE.MeshBasicMaterial;
  jetpackFlameWhite: THREE.MeshBasicMaterial;
  jetpackFlameYellow: THREE.MeshBasicMaterial;
  jetpackFlameOrange: THREE.MeshBasicMaterial;
  jetpackFlameRed: THREE.MeshBasicMaterial;
  jetpackFlameDarkRed: THREE.MeshBasicMaterial;
  jetpackGlow: THREE.MeshBasicMaterial;
  jetpackSmoke: THREE.MeshBasicMaterial;
  jetpackSpark: THREE.MeshBasicMaterial;
  jetpackHeatRing: THREE.MeshBasicMaterial;
} | null = null;

export function getBlazeMaterials() {
  if (!_blazeMaterials) {
    _blazeMaterials = {
      // Targeting indicator materials
      bombOuterRing: new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
      bombMidRing: new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
      bombInnerRing: new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
      bombCenterDot: new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false }),
      bombFill: new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false }),
      bombCrossValid: new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
      bombBeam: new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.3, depthWrite: false }),
      bombBeamTop: new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.7, depthWrite: false }),
      airOuterRing: new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
      airInnerRing: new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
      airCenterDot: new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false }),
      airFill: new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
      airCross: new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
      airValidMidRing: new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
      // Rocket materials
      rocketBody: new THREE.MeshBasicMaterial({ color: 0x333333 }),
      rocketNose: new THREE.MeshBasicMaterial({ color: 0xff6600 }),
      rocketFireCore: new THREE.MeshBasicMaterial({ color: 0xffffcc, transparent: true, opacity: 0.95 }),
      rocketFireInner: new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.9 }),
      rocketFireOuter: new THREE.MeshBasicMaterial({ color: 0xff5500, transparent: true, opacity: 0.7 }),
      rocketSmokeTrail: new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.4 }),
      // Explosion materials (shared by rocket jump, bomb, airstrike explosions)
      explosionFlash: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 }),
      explosionCore: new THREE.MeshBasicMaterial({ color: 0xffffcc, transparent: true, opacity: 0.95 }),
      explosionMid: new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.8 }),
      explosionOuter: new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.5 }),
      explosionDarkOuter: new THREE.MeshBasicMaterial({ color: 0xcc2200, transparent: true, opacity: 0.4 }),
      shockwaveOrange: new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
      shockwaveYellow: new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
      smoke: new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.4 }),
      smokeDark: new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.5 }),
      sparkYellow: new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 1 }),
      sparkOrange: new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 1 }),
      groundScorch: new THREE.MeshBasicMaterial({ color: 0x331100, transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
      // Bomb effect materials
      bombBodyDark: new THREE.MeshBasicMaterial({ color: 0x1a1a1a }),
      bombMetal: new THREE.MeshBasicMaterial({ color: 0x444444 }),
      bombNose: new THREE.MeshBasicMaterial({ color: 0x111111 }),
      bombFin: new THREE.MeshBasicMaterial({ color: 0x222222, side: THREE.DoubleSide }),
      bombStripe: new THREE.MeshBasicMaterial({ color: 0xcc0000 }),
      bombTrailFire: new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.8 }),
      bombGlow: new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.25 }),
      warningRingRed: new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
      warningRingOrange: new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
      warningRingYellow: new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
      warningCross: new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
      warningCrossDiag: new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
      warningFillPulse: new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.2, side: THREE.DoubleSide }),
      // Airstrike bomb materials
      airBombBody: new THREE.MeshBasicMaterial({ color: 0x1a1a1a }),
      airBombTrail: new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.8 }),
      airWarningRing: new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
      airWarningFill: new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
      // Jetpack materials
      jetpackNozzle: new THREE.MeshBasicMaterial({ color: 0x333333 }),
      jetpackFlameWhite: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.98 }),
      jetpackFlameYellow: new THREE.MeshBasicMaterial({ color: 0xffffaa, transparent: true, opacity: 0.92 }),
      jetpackFlameOrange: new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.8 }),
      jetpackFlameRed: new THREE.MeshBasicMaterial({ color: 0xff5500, transparent: true, opacity: 0.55 }),
      jetpackFlameDarkRed: new THREE.MeshBasicMaterial({ color: 0xcc2200, transparent: true, opacity: 0.3 }),
      jetpackGlow: new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.35 }),
      jetpackSmoke: new THREE.MeshBasicMaterial({ color: 0x666666, transparent: true, opacity: 0.3 }),
      jetpackSpark: new THREE.MeshBasicMaterial({ color: 0xffdd00, transparent: true, opacity: 0.9 }),
      jetpackHeatRing: new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.15, side: THREE.DoubleSide }),
    };
  }
  return _blazeMaterials;
}

// Alias for backward compatibility
export const getBlazeTargetingMaterials = getBlazeMaterials;

// ============================================================================
// SHARED HOOKSHOT MATERIALS (pre-created for instant use)
// ============================================================================

let _hookshotMaterials: {
  ring: THREE.MeshStandardMaterial;
  shaft: THREE.MeshStandardMaterial;
  crown: THREE.MeshStandardMaterial;
  fluke: THREE.MeshStandardMaterial;
  tip: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
  ropeMain: THREE.MeshBasicMaterial;
  ropeGlow: THREE.MeshBasicMaterial;
  ropeCore: THREE.MeshBasicMaterial;
  heavyChainMain: THREE.MeshBasicMaterial;
  heavyChainOuter: THREE.MeshBasicMaterial;
  heavyChainCore: THREE.MeshBasicMaterial;
  heavyChainMegaGlow: THREE.MeshBasicMaterial;
  // Earth Wall materials
  earthDirt: THREE.MeshStandardMaterial;
  earthDirtDark: THREE.MeshStandardMaterial;
  earthDirtLight: THREE.MeshStandardMaterial;
  earthRock: THREE.MeshStandardMaterial;
  earthGrass: THREE.MeshStandardMaterial;
  earthHookMetal: THREE.MeshStandardMaterial;
  earthHookMetalLight: THREE.MeshStandardMaterial;
  earthHookGlow: THREE.MeshBasicMaterial;
  earthHookRing: THREE.MeshBasicMaterial;
  earthPlowBlade: THREE.MeshStandardMaterial;
  earthDebris: THREE.MeshStandardMaterial;
  // Grapple Trap materials
  trapBody: THREE.MeshStandardMaterial;
  trapCap: THREE.MeshStandardMaterial;
  trapRing: THREE.MeshStandardMaterial;
  trapArm: THREE.MeshStandardMaterial;
  trapHookTip: THREE.MeshStandardMaterial;
  trapBase: THREE.MeshStandardMaterial;
  trapCoreGlow: THREE.MeshBasicMaterial;
  trapOuterGlow: THREE.MeshBasicMaterial;
  trapCircleRing: THREE.MeshBasicMaterial;
  // Extra glow materials
  heavyGlowOuter: THREE.MeshBasicMaterial;
  // Targeting indicator materials
  targetRingValid: THREE.MeshBasicMaterial;
  targetRingInvalid: THREE.MeshBasicMaterial;
  targetCenter: THREE.MeshBasicMaterial;
  targetCross: THREE.MeshBasicMaterial;
  targetCrossInvalid: THREE.MeshBasicMaterial;
} | null = null;

export function getHookshotMaterials() {
  if (!_hookshotMaterials) {
    _hookshotMaterials = {
      ring: new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9, roughness: 0.2, side: THREE.DoubleSide }),
      shaft: new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.85, roughness: 0.25 }),
      crown: new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.85, roughness: 0.25 }),
      fluke: new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.9, roughness: 0.15 }),
      tip: new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.95, roughness: 0.1 }),
      glow: new THREE.MeshBasicMaterial({ color: HOOKSHOT_COLORS.energy, transparent: true, opacity: 0.3 }),
      ropeMain: new THREE.MeshBasicMaterial({ color: HOOKSHOT_COLORS.energy, transparent: true, opacity: 0.9 }),
      ropeGlow: new THREE.MeshBasicMaterial({ color: HOOKSHOT_COLORS.energyGlow, transparent: true, opacity: 0.4 }),
      ropeCore: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }),
      heavyChainMain: new THREE.MeshBasicMaterial({ color: HOOKSHOT_COLORS.energy, transparent: true, opacity: 1.0 }),
      heavyChainOuter: new THREE.MeshBasicMaterial({ color: HOOKSHOT_COLORS.energyGlow, transparent: true, opacity: 0.6 }),
      heavyChainCore: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
      heavyChainMegaGlow: new THREE.MeshBasicMaterial({ color: HOOKSHOT_COLORS.energy, transparent: true, opacity: 0.25 }),
      // Earth Wall materials (pre-created to avoid first-use stutter)
      earthDirt: new THREE.MeshStandardMaterial({ color: EARTH_COLORS.dirt, roughness: 0.9, metalness: 0.1 }),
      earthDirtDark: new THREE.MeshStandardMaterial({ color: EARTH_COLORS.dirtDark, roughness: 0.9, metalness: 0.1 }),
      earthDirtLight: new THREE.MeshStandardMaterial({ color: EARTH_COLORS.dirtLight, roughness: 0.9, metalness: 0.1 }),
      earthRock: new THREE.MeshStandardMaterial({ color: EARTH_COLORS.rock, roughness: 0.95, metalness: 0.05 }),
      earthGrass: new THREE.MeshStandardMaterial({ color: EARTH_COLORS.grass, roughness: 1, metalness: 0 }),
      earthHookMetal: new THREE.MeshStandardMaterial({ color: EARTH_COLORS.hookMetal, metalness: 0.85, roughness: 0.3 }),
      earthHookMetalLight: new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.9, roughness: 0.2 }),
      earthHookGlow: new THREE.MeshBasicMaterial({ color: EARTH_COLORS.hookGlow, transparent: true, opacity: 0.5 }),
      earthHookRing: new THREE.MeshBasicMaterial({ color: EARTH_COLORS.dirt, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
      earthPlowBlade: new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.9, roughness: 0.2 }),
      earthDebris: new THREE.MeshStandardMaterial({ color: EARTH_COLORS.dirtDark, roughness: 1, metalness: 0 }),
      // Grapple Trap materials (pre-created to avoid first-use stutter)
      trapBody: new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.9, roughness: 0.2 }),
      trapCap: new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.85, roughness: 0.25 }),
      trapRing: new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9, roughness: 0.2, side: THREE.DoubleSide }),
      trapArm: new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.85, roughness: 0.25 }),
      trapHookTip: new THREE.MeshStandardMaterial({ color: HOOKSHOT_COLORS.energyGlow, metalness: 0.9, roughness: 0.15, emissive: HOOKSHOT_COLORS.energy, emissiveIntensity: 0.3 }),
      trapBase: new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.85, roughness: 0.25 }),
      trapCoreGlow: new THREE.MeshBasicMaterial({ color: HOOKSHOT_COLORS.energy, transparent: true, opacity: 0.8 }),
      trapOuterGlow: new THREE.MeshBasicMaterial({ color: HOOKSHOT_COLORS.energyGlow, transparent: true, opacity: 0.3 }),
      trapCircleRing: new THREE.MeshBasicMaterial({ color: HOOKSHOT_COLORS.energy, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
      // Extra glow materials for drag hook
      heavyGlowOuter: new THREE.MeshBasicMaterial({ color: HOOKSHOT_COLORS.energyGlow, transparent: true, opacity: 0.2 }),
      // Targeting indicator materials
      targetRingValid: new THREE.MeshBasicMaterial({ color: HOOKSHOT_COLORS.energy, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
      targetRingInvalid: new THREE.MeshBasicMaterial({ color: HOOKSHOT_COLORS.energyGlow, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
      targetCenter: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
      targetCross: new THREE.MeshBasicMaterial({ color: HOOKSHOT_COLORS.energy, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
      targetCrossInvalid: new THREE.MeshBasicMaterial({ color: HOOKSHOT_COLORS.energyGlow, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    };
  }
  return _hookshotMaterials;
}

// ============================================================================
// UTILITY: Distance-based LOD selection
// Returns appropriate geometry detail level based on distance to camera
// ============================================================================

export function getSphereGeometryForDistance(distance: number): THREE.SphereGeometry {
  if (distance > 100) return SHARED_GEOMETRIES.sphere4;
  if (distance > 50) return SHARED_GEOMETRIES.sphere6;
  if (distance > 25) return SHARED_GEOMETRIES.sphere8;
  if (distance > 10) return SHARED_GEOMETRIES.sphere12;
  return SHARED_GEOMETRIES.sphere16;
}

export function getCylinderGeometryForDistance(distance: number): THREE.CylinderGeometry {
  if (distance > 50) return SHARED_GEOMETRIES.cylinder6;
  if (distance > 25) return SHARED_GEOMETRIES.cylinder8;
  return SHARED_GEOMETRIES.cylinder12;
}

export function getRingGeometryForDistance(distance: number): THREE.RingGeometry {
  if (distance > 50) return SHARED_GEOMETRIES.ring8;
  if (distance > 25) return SHARED_GEOMETRIES.ring16;
  return SHARED_GEOMETRIES.ring24;
}

// ============================================================================
// UTILITY: Check if effect should render based on distance
// Returns false if effect is too far to be visible
// ============================================================================

export function shouldRenderEffect(
  effectPosition: { x: number; y: number; z: number },
  cameraPosition: { x: number; y: number; z: number },
  maxDistance: number = 150
): boolean {
  const dx = effectPosition.x - cameraPosition.x;
  const dy = effectPosition.y - cameraPosition.y;
  const dz = effectPosition.z - cameraPosition.z;
  return dx * dx + dy * dy + dz * dz < maxDistance * maxDistance;
}

// ============================================================================
// UTILITY: Get reduced particle count based on distance
// ============================================================================

export function getParticleCountForDistance(
  baseCount: number, 
  distance: number,
  minCount: number = 5
): number {
  if (distance > 100) return minCount;
  if (distance > 50) return Math.max(minCount, Math.floor(baseCount * 0.25));
  if (distance > 25) return Math.max(minCount, Math.floor(baseCount * 0.5));
  return baseCount;
}

// ============================================================================
// SHADER MATERIAL FACTORY - For effects that need unique uniforms
// Creates materials with shared shader programs but unique uniform objects
// ============================================================================

const shaderProgramCache = new Map<string, { vertex: string; fragment: string }>();

export function createShaderMaterial(
  key: string,
  vertexShader: string,
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
  options: Partial<THREE.ShaderMaterialParameters> = {}
): THREE.ShaderMaterial {
  // Cache shader source
  if (!shaderProgramCache.has(key)) {
    shaderProgramCache.set(key, { vertex: vertexShader, fragment: fragmentShader });
  }
  
  const cached = shaderProgramCache.get(key)!;
  
  return new THREE.ShaderMaterial({
    vertexShader: cached.vertex,
    fragmentShader: cached.fragment,
    uniforms: { ...uniforms }, // Clone uniforms for unique instance
    ...options,
  });
}

// ============================================================================
// Pre-warm materials on module load (compile shaders before gameplay)
// ============================================================================

let _initialized = false;

// Store reference to pre-compilation scene for cleanup
let _precompileScene: THREE.Scene | null = null;
let _precompileCamera: THREE.Camera | null = null;

export function initializeEffectResources() {
  if (_initialized) return;
  _initialized = true;
  
  // Force creation of all shared materials
  getHookshotMaterials();
  getBlazeMaterials(); // Pre-create all Blaze effect materials
  
  // Pre-create common glow materials
  [HOOKSHOT_COLORS.energy, HOOKSHOT_COLORS.energyGlow, BLAZE_COLORS.fireOrange, PHANTOM_COLORS.violet].forEach(color => {
    getGlowMaterial(color, 0.3);
    getGlowMaterial(color, 0.5);
    getGlowMaterial(color, 0.7);
  });
}

/**
 * Pre-compile all Blaze effect shaders by rendering them once.
 * Call this with the WebGL renderer after the scene is set up.
 * This forces WebGL to compile all shaders upfront, avoiding first-use stutter.
 */
export function precompileBlazeMaterials(renderer: THREE.WebGLRenderer) {
  const mats = getBlazeMaterials();
  
  // Create a temporary scene with all materials
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 10);
  camera.position.z = 5;
  
  // Use a single sphere geometry for all material tests
  const geo = SHARED_GEOMETRIES.sphere8;
  
  // Add a mesh for each material to force shader compilation
  const allMaterials = Object.values(mats);
  const meshes: THREE.Mesh[] = [];
  
  allMaterials.forEach((mat, i) => {
    const mesh = new THREE.Mesh(geo, mat);
    // Position meshes off-screen but still renderable
    mesh.position.set(i * 0.01, 0, 0);
    scene.add(mesh);
    meshes.push(mesh);
  });
  
  // Also compile the geometries
  const geoMesh = new THREE.Mesh(SHARED_GEOMETRIES.ring24, mats.bombOuterRing);
  scene.add(geoMesh);
  
  const geoMesh2 = new THREE.Mesh(SHARED_GEOMETRIES.cone8, mats.rocketBody);
  scene.add(geoMesh2);
  
  const geoMesh3 = new THREE.Mesh(SHARED_GEOMETRIES.cylinder8, mats.bombBeam);
  scene.add(geoMesh3);
  
  const geoMesh4 = new THREE.Mesh(SHARED_GEOMETRIES.circle16, mats.bombFill);
  scene.add(geoMesh4);
  
  const geoMesh5 = new THREE.Mesh(SHARED_GEOMETRIES.plane, mats.bombCrossValid);
  scene.add(geoMesh5);
  
  // Render once to compile all shaders
  // Save current render target
  const currentRenderTarget = renderer.getRenderTarget();
  
  // Create a small render target for compilation (1x1 pixel is enough)
  const renderTarget = new THREE.WebGLRenderTarget(1, 1);
  renderer.setRenderTarget(renderTarget);
  renderer.render(scene, camera);
  
  // Restore original render target
  renderer.setRenderTarget(currentRenderTarget);
  
  // Cleanup render target
  renderTarget.dispose();
  
  // Remove meshes from scene (materials and geometries are kept)
  meshes.forEach(mesh => scene.remove(mesh));
  scene.remove(geoMesh);
  scene.remove(geoMesh2);
  scene.remove(geoMesh3);
  scene.remove(geoMesh4);
  scene.remove(geoMesh5);
  
  // Store for potential cleanup
  _precompileScene = scene;
  _precompileCamera = camera;
}

/**
 * Pre-compile all Hookshot effect shaders by rendering them once.
 * This includes basic hook materials, Earth Wall, and Grapple Trap materials.
 * Call this with the WebGL renderer after the scene is set up.
 * This forces WebGL to compile all shaders upfront, avoiding first-use stutter.
 */
export function precompileHookshotMaterials(renderer: THREE.WebGLRenderer) {
  const mats = getHookshotMaterials();
  
  // Create a temporary scene with all materials
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 10);
  camera.position.z = 5;
  
  // Add ambient light for MeshStandardMaterial to render properly
  const ambientLight = new THREE.AmbientLight(0xffffff, 1);
  scene.add(ambientLight);
  
  const meshes: THREE.Mesh[] = [];
  
  // Add a mesh for each material to force shader compilation
  const allMaterials = Object.values(mats);
  allMaterials.forEach((mat, i) => {
    const mesh = new THREE.Mesh(SHARED_GEOMETRIES.sphere8, mat);
    mesh.position.set(i * 0.01, 0, 0);
    scene.add(mesh);
    meshes.push(mesh);
  });
  
  // Also compile with different geometries used by hookshot effects
  const geoMesh1 = new THREE.Mesh(SHARED_GEOMETRIES.ring16, mats.ring);
  scene.add(geoMesh1);
  meshes.push(geoMesh1);
  
  const geoMesh2 = new THREE.Mesh(SHARED_GEOMETRIES.cylinder8, mats.shaft);
  scene.add(geoMesh2);
  meshes.push(geoMesh2);
  
  const geoMesh3 = new THREE.Mesh(SHARED_GEOMETRIES.cone8, mats.fluke);
  scene.add(geoMesh3);
  meshes.push(geoMesh3);
  
  const geoMesh4 = new THREE.Mesh(SHARED_GEOMETRIES.box, mats.earthDirt);
  scene.add(geoMesh4);
  meshes.push(geoMesh4);
  
  const geoMesh5 = new THREE.Mesh(SHARED_GEOMETRIES.ring24, mats.trapCircleRing);
  scene.add(geoMesh5);
  meshes.push(geoMesh5);
  
  // Render once to compile all shaders
  const currentRenderTarget = renderer.getRenderTarget();
  const renderTarget = new THREE.WebGLRenderTarget(1, 1);
  renderer.setRenderTarget(renderTarget);
  renderer.render(scene, camera);
  
  // Restore original render target
  renderer.setRenderTarget(currentRenderTarget);
  
  // Cleanup
  renderTarget.dispose();
  meshes.forEach(mesh => scene.remove(mesh));
  scene.remove(ambientLight);
}

// Auto-initialize on first import (browser only)
// This pre-creates all materials before any components mount
if (typeof window !== 'undefined') {
  // Initialize immediately to create material objects
  initializeEffectResources();
  
  // Also schedule for next frame to ensure complete initialization
  requestAnimationFrame(() => {
    // Force creation of all Blaze materials
    getBlazeMaterials();
    getHookshotMaterials();
  });
}

// Re-export LOD utilities for convenient single-import access
export {
  useEffectLOD,
  useEffectDistance,
  getOptimizedParticleCount,
  shouldRenderAtDistance,
  LOD_THRESHOLDS,
  type LODConfig,
  type LODResult,
  type LODLevel,
} from './useEffectLOD';

