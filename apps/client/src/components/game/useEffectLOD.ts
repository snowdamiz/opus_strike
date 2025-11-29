/**
 * useEffectLOD - Distance-based Level of Detail for game effects
 * =============================================================
 * 
 * This hook provides performance optimization by reducing visual detail
 * for effects that are far from the camera, where fine details aren't visible.
 * 
 * OPTIMIZATION STRATEGY:
 * - Far effects (>100 units): Minimal particles, lowest geometry detail
 * - Medium effects (50-100 units): Reduced particles, medium geometry
 * - Near effects (25-50 units): Standard particles, good geometry
 * - Close effects (<25 units): Full particles, highest detail
 * 
 * USAGE:
 * const { particleCount, sphereGeo, shouldRender } = useEffectLOD(effectPosition);
 * if (!shouldRender) return null;
 */

import { useMemo, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SHARED_GEOMETRIES } from './effectResources';

// Distance thresholds for LOD levels
const LOD_THRESHOLDS = {
  CLOSE: 25,
  NEAR: 50,
  MEDIUM: 100,
  FAR: 150,
  CULL: 200, // Don't render effects beyond this distance
} as const;

// LOD level enum for clear code
export type LODLevel = 'close' | 'near' | 'medium' | 'far' | 'culled';

// Pre-allocate vector for distance calculations
const _cameraDistVec = new THREE.Vector3();

export interface LODConfig {
  /** Base particle count at full detail */
  baseParticleCount: number;
  /** Minimum particle count at lowest detail */
  minParticleCount?: number;
  /** Whether to cull (not render) at max distance */
  enableCulling?: boolean;
  /** Custom cull distance (overrides default) */
  cullDistance?: number;
  /** Update frequency in ms (throttles LOD checks) */
  updateInterval?: number;
}

export interface LODResult {
  /** Adjusted particle count based on distance */
  particleCount: number;
  /** Current LOD level */
  level: LODLevel;
  /** Whether the effect should be rendered */
  shouldRender: boolean;
  /** Squared distance to camera (for further calculations) */
  distanceSquared: number;
  /** Appropriate sphere geometry for this LOD level */
  sphereGeo: THREE.SphereGeometry;
  /** Appropriate cylinder geometry for this LOD level */
  cylinderGeo: THREE.CylinderGeometry;
  /** Appropriate ring geometry for this LOD level */
  ringGeo: THREE.RingGeometry;
  /** Particle size multiplier (smaller particles at distance) */
  particleSizeMultiplier: number;
  /** Light intensity multiplier (dimmer at distance) */
  lightIntensityMultiplier: number;
}

/**
 * Calculate LOD level based on squared distance
 */
function getLODLevel(distanceSquared: number, cullDistance: number): LODLevel {
  if (distanceSquared > cullDistance * cullDistance) return 'culled';
  if (distanceSquared > LOD_THRESHOLDS.FAR * LOD_THRESHOLDS.FAR) return 'far';
  if (distanceSquared > LOD_THRESHOLDS.MEDIUM * LOD_THRESHOLDS.MEDIUM) return 'medium';
  if (distanceSquared > LOD_THRESHOLDS.NEAR * LOD_THRESHOLDS.NEAR) return 'near';
  return 'close';
}

/**
 * Get particle count multiplier for LOD level
 */
function getParticleMultiplier(level: LODLevel): number {
  switch (level) {
    case 'close': return 1.0;
    case 'near': return 0.75;
    case 'medium': return 0.5;
    case 'far': return 0.25;
    case 'culled': return 0;
  }
}

/**
 * useEffectLOD - Main hook for distance-based LOD
 * 
 * @param effectPosition - World position of the effect
 * @param config - LOD configuration options
 * @returns LOD result with adjusted values
 */
export function useEffectLOD(
  effectPosition: { x: number; y: number; z: number },
  config: LODConfig
): LODResult {
  const { camera } = useThree();
  const lastUpdateRef = useRef(0);
  const cachedResultRef = useRef<LODResult | null>(null);
  
  const {
    baseParticleCount,
    minParticleCount = 5,
    enableCulling = true,
    cullDistance = LOD_THRESHOLDS.CULL,
    updateInterval = 100, // Check every 100ms by default
  } = config;
  
  // Calculate distance and LOD on every call (but can be throttled via updateInterval)
  const result = useMemo(() => {
    const now = Date.now();
    
    // Use cached result if within update interval
    if (cachedResultRef.current && now - lastUpdateRef.current < updateInterval) {
      return cachedResultRef.current;
    }
    
    lastUpdateRef.current = now;
    
    // Calculate squared distance (avoid sqrt for performance)
    _cameraDistVec.set(
      effectPosition.x - camera.position.x,
      effectPosition.y - camera.position.y,
      effectPosition.z - camera.position.z
    );
    const distanceSquared = _cameraDistVec.lengthSq();
    
    // Determine LOD level
    const level = getLODLevel(distanceSquared, enableCulling ? cullDistance : Infinity);
    
    // Check if should render
    const shouldRender = level !== 'culled';
    
    // Calculate particle count
    const multiplier = getParticleMultiplier(level);
    const particleCount = Math.max(
      minParticleCount,
      Math.floor(baseParticleCount * multiplier)
    );
    
    // Select appropriate geometries based on LOD
    let sphereGeo: THREE.SphereGeometry;
    let cylinderGeo: THREE.CylinderGeometry;
    let ringGeo: THREE.RingGeometry;
    
    switch (level) {
      case 'close':
        sphereGeo = SHARED_GEOMETRIES.sphere16;
        cylinderGeo = SHARED_GEOMETRIES.cylinder12;
        ringGeo = SHARED_GEOMETRIES.ring24;
        break;
      case 'near':
        sphereGeo = SHARED_GEOMETRIES.sphere12;
        cylinderGeo = SHARED_GEOMETRIES.cylinder8;
        ringGeo = SHARED_GEOMETRIES.ring16;
        break;
      case 'medium':
        sphereGeo = SHARED_GEOMETRIES.sphere8;
        cylinderGeo = SHARED_GEOMETRIES.cylinder8;
        ringGeo = SHARED_GEOMETRIES.ring16;
        break;
      case 'far':
      case 'culled':
      default:
        sphereGeo = SHARED_GEOMETRIES.sphere6;
        cylinderGeo = SHARED_GEOMETRIES.cylinder6;
        ringGeo = SHARED_GEOMETRIES.ring8;
        break;
    }
    
    // Calculate size and intensity multipliers
    const particleSizeMultiplier = level === 'close' ? 1.0 : 
                                   level === 'near' ? 1.2 : 
                                   level === 'medium' ? 1.5 : 2.0;
    
    const lightIntensityMultiplier = level === 'close' ? 1.0 :
                                     level === 'near' ? 0.8 :
                                     level === 'medium' ? 0.5 : 0.3;
    
    const newResult: LODResult = {
      particleCount,
      level,
      shouldRender,
      distanceSquared,
      sphereGeo,
      cylinderGeo,
      ringGeo,
      particleSizeMultiplier,
      lightIntensityMultiplier,
    };
    
    cachedResultRef.current = newResult;
    return newResult;
  }, [
    effectPosition.x, effectPosition.y, effectPosition.z,
    camera.position.x, camera.position.y, camera.position.z,
    baseParticleCount, minParticleCount, enableCulling, cullDistance, updateInterval
  ]);
  
  return result;
}

/**
 * useEffectDistance - Simpler hook that just returns distance info
 * Use when you just need distance checks without full LOD
 */
export function useEffectDistance(
  effectPosition: { x: number; y: number; z: number }
): { distanceSquared: number; shouldRender: boolean } {
  const { camera } = useThree();
  
  return useMemo(() => {
    _cameraDistVec.set(
      effectPosition.x - camera.position.x,
      effectPosition.y - camera.position.y,
      effectPosition.z - camera.position.z
    );
    const distanceSquared = _cameraDistVec.lengthSq();
    const shouldRender = distanceSquared < LOD_THRESHOLDS.CULL * LOD_THRESHOLDS.CULL;
    
    return { distanceSquared, shouldRender };
  }, [
    effectPosition.x, effectPosition.y, effectPosition.z,
    camera.position.x, camera.position.y, camera.position.z
  ]);
}

/**
 * Utility: Get optimized particle count based on distance
 * Can be called directly without the hook for simpler cases
 */
export function getOptimizedParticleCount(
  baseCount: number,
  distanceSquared: number,
  minCount: number = 5
): number {
  const level = getLODLevel(distanceSquared, LOD_THRESHOLDS.CULL);
  const multiplier = getParticleMultiplier(level);
  return Math.max(minCount, Math.floor(baseCount * multiplier));
}

/**
 * Utility: Check if effect should be rendered at given distance
 */
export function shouldRenderAtDistance(
  effectPosition: { x: number; y: number; z: number },
  cameraPosition: { x: number; y: number; z: number },
  maxDistance: number = LOD_THRESHOLDS.CULL
): boolean {
  const dx = effectPosition.x - cameraPosition.x;
  const dy = effectPosition.y - cameraPosition.y;
  const dz = effectPosition.z - cameraPosition.z;
  return dx * dx + dy * dy + dz * dz < maxDistance * maxDistance;
}

export { LOD_THRESHOLDS };

