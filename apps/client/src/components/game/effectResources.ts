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
// ============================================================================
//
// USAGE: Always .set() values, never store references
// BAD:  const myVec = new THREE.Vector3(x, y, z)
// GOOD: TEMP_VECTORS.v1.set(x, y, z); // use TEMP_VECTORS.v1; // then .set(0,0,0) if needed
//
// These vectors are reused across all effects. Always call .set() before use
// to avoid carrying over values from previous calculations.
// ============================================================================

export const TEMP_VECTORS = {
  // Original vectors (v1-v4 for general use)
  v1: new THREE.Vector3(),
  v2: new THREE.Vector3(),
  v3: new THREE.Vector3(),
  v4: new THREE.Vector3(),

  // Direction vectors
  quat1: new THREE.Quaternion(),
  quat2: new THREE.Quaternion(),
  euler1: new THREE.Euler(),
  color1: new THREE.Color(),
  forward: new THREE.Vector3(0, 0, -1),
  up: new THREE.Vector3(0, 1, 0),
  right: new THREE.Vector3(1, 0, 0),

  // Additional vectors for parallel effect use (v5-v10 for complex effects)
  // These allow multiple effects to run simultaneously without overwriting each other's temp values
  v5: new THREE.Vector3(),
  v6: new THREE.Vector3(),
  v7: new THREE.Vector3(),
  v8: new THREE.Vector3(),
  v9: new THREE.Vector3(),
  v10: new THREE.Vector3(),

  // Named temp vectors for specific use cases in effect calculations
  tempPos: new THREE.Vector3(),   // Temporary position calculations
  tempDir: new THREE.Vector3(),   // Temporary direction vectors
  tempScale: new THREE.Vector3(), // Temporary scale values
  tempRot: new THREE.Quaternion(), // Temporary rotation values
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

export function initializeEffectResources() {
  if (_initialized) return;
  _initialized = true;
  
  // Force creation of all shared materials
  getHookshotMaterials();
  
  // Pre-create common glow materials
  [HOOKSHOT_COLORS.energy, HOOKSHOT_COLORS.energyGlow, BLAZE_COLORS.fireOrange, PHANTOM_COLORS.violet].forEach(color => {
    getGlowMaterial(color, 0.3);
    getGlowMaterial(color, 0.5);
    getGlowMaterial(color, 0.7);
  });
  
  // Prewarm Blaze materials (airstrike, etc.)
  import('./blaze/materials').then(({ prewarmBlazeMaterials }) => {
    prewarmBlazeMaterials();
  });
  
  // Prewarm Phantom materials
  import('./phantom/materials').then(({ getRiftMaterial, getTrailMaterial, getShadowArrivalMaterial }) => {
    getRiftMaterial();
    getTrailMaterial();
    getShadowArrivalMaterial();
  });
}

// Auto-initialize on first import (browser only)
if (typeof window !== 'undefined') {
  requestAnimationFrame(initializeEffectResources);
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

