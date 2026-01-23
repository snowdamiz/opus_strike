/**
 * Shared Materials for Sci-Fi CTF Map
 *
 * All materials are created as single THREE.MeshStandardMaterial instances
 * to ensure one GPU resource per material type. Import and reuse these
 * across all map geometry components.
 */

import * as THREE from 'three';

// =============================================================================
// BASE MATERIALS - Dark colors for main surfaces
// =============================================================================

/**
 * Floor material - dark metallic surface for main ground
 */
export const floorMaterial = new THREE.MeshStandardMaterial({
  color: 0x1a1a2e,
  metalness: 0.8,
  roughness: 0.3,
});

/**
 * Wall material - darker for vertical surfaces
 */
export const wallMaterial = new THREE.MeshStandardMaterial({
  color: 0x0d0d1a,
  metalness: 0.7,
  roughness: 0.4,
});

/**
 * Platform material - slightly lighter for elevated surfaces
 */
export const platformMaterial = new THREE.MeshStandardMaterial({
  color: 0x1f1f35,
  metalness: 0.85,
  roughness: 0.25,
});

// =============================================================================
// TEAM A MATERIALS - Red/orange warm accents
// =============================================================================

/**
 * Team A accent - warm red/orange emissive for team identity
 */
export const teamAAccent = new THREE.MeshStandardMaterial({
  color: 0x2a1a1a,
  emissive: 0xff4400,
  emissiveIntensity: 0.5,
});

/**
 * Team A glow - brighter emissive for prominent features
 */
export const teamAGlow = new THREE.MeshStandardMaterial({
  color: 0x1a0a0a,
  emissive: 0xff6600,
  emissiveIntensity: 1.2,
});

// =============================================================================
// TEAM B MATERIALS - Blue/cyan cool accents
// =============================================================================

/**
 * Team B accent - cool blue/cyan emissive for team identity
 */
export const teamBAccent = new THREE.MeshStandardMaterial({
  color: 0x1a1a2a,
  emissive: 0x00ffff,
  emissiveIntensity: 0.5,
});

/**
 * Team B glow - brighter emissive for prominent features
 */
export const teamBGlow = new THREE.MeshStandardMaterial({
  color: 0x0a0a1a,
  emissive: 0x00ccff,
  emissiveIntensity: 1.2,
});

// =============================================================================
// SPECIAL MATERIALS - Hazards, barriers, and environmental features
// =============================================================================

/**
 * Hazard material - magenta glow for dangerous areas
 */
export const hazardMaterial = new THREE.MeshStandardMaterial({
  color: 0x1a0a1a,
  emissive: 0xff00ff,
  emissiveIntensity: 0.8,
});

/**
 * Cave material - natural stone look for Team B side (natural/cave aesthetic)
 */
export const caveMaterial = new THREE.MeshStandardMaterial({
  color: 0x1a1512,
  metalness: 0.3,
  roughness: 0.8,
});

/**
 * Energy barrier material - transparent glowing barrier
 */
export const energyBarrierMaterial = new THREE.MeshStandardMaterial({
  color: 0x000000,
  emissive: 0x00ff88,
  emissiveIntensity: 1.5,
  transparent: true,
  opacity: 0.6,
});

// =============================================================================
// MATERIAL REGISTRY - For programmatic access
// =============================================================================

/**
 * All materials grouped by category for easy iteration
 */
export const materialRegistry = {
  base: {
    floor: floorMaterial,
    wall: wallMaterial,
    platform: platformMaterial,
  },
  teamA: {
    accent: teamAAccent,
    glow: teamAGlow,
  },
  teamB: {
    accent: teamBAccent,
    glow: teamBGlow,
  },
  special: {
    hazard: hazardMaterial,
    cave: caveMaterial,
    energyBarrier: energyBarrierMaterial,
  },
} as const;
