import * as THREE from 'three';

// ============================================================================
// GLACIER COLOR PALETTE
// ============================================================================

export const GLACIER_COLORS = {
  iceLight: 0x87ceeb,      // Sky blue (lighter ice)
  iceMedium: 0x3b82f6,     // Glacier blue (main color)
  iceDark: 0x1d4ed8,       // Deep ice blue
  iceGlow: 0x60a5fa,       // Soft blue glow
  iceCrystal: 0xbfdbfe,    // Crystalline white-blue
  frost: 0xdbeafe,         // Frost white-blue
  malletMetal: 0x4a5568,   // Mallet handle (dark metal)
} as const;

// ============================================================================
// REUSABLE TEMP OBJECTS - Avoid allocations in render loop
// ============================================================================

export const tempVec3 = new THREE.Vector3();
export const tempVec3_2 = new THREE.Vector3();
export const tempMatrix = new THREE.Matrix4();
export const tempQuaternion = new THREE.Quaternion();
export const tempScale = new THREE.Vector3();
export const tempEuler = new THREE.Euler();

// ============================================================================
// MATERIAL CACHING
// ============================================================================

let materialsInitialized = false;

// Mallet materials
export let malletHeadMaterial: THREE.MeshStandardMaterial;
export let malletHandleMaterial: THREE.MeshStandardMaterial;
export let malletCapMaterial: THREE.MeshStandardMaterial;
export let malletBevelMaterial: THREE.MeshStandardMaterial;
export let malletFrostRingMaterial: THREE.MeshStandardMaterial;
export let malletVeinMaterial: THREE.MeshBasicMaterial;
export let malletCrystalMaterial: THREE.MeshStandardMaterial;
export let malletFrostCrystalMaterial: THREE.MeshStandardMaterial;
export let malletGripHandMaterial: THREE.MeshStandardMaterial;
export let malletGripSleeveMaterial: THREE.MeshStandardMaterial;
export let frostParticleMaterial: THREE.MeshBasicMaterial;
export let iceShardMaterial: THREE.MeshStandardMaterial;

// Shield materials
export let shieldCrystalMaterial: THREE.MeshStandardMaterial;
export let shieldGlowCoreMaterial: THREE.MeshBasicMaterial;
export let shieldShardMaterial: THREE.MeshStandardMaterial;
export let shieldPanelMaterial: THREE.MeshStandardMaterial;
export let shieldFrostParticleMaterial: THREE.MeshBasicMaterial;
export let shieldGroundFrostMaterial: THREE.MeshBasicMaterial;

export function initMaterials() {
  if (materialsInitialized) return;
  
  // Mallet materials
  malletHeadMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.iceMedium,
    metalness: 0.3,
    roughness: 0.4,
    emissive: GLACIER_COLORS.iceGlow,
    emissiveIntensity: 0.3,
  });
  
  malletHandleMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.malletMetal,
    metalness: 0.8,
    roughness: 0.3,
  });
  
  malletCapMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.iceMedium,
    metalness: 0.3,
    roughness: 0.35,
    emissive: GLACIER_COLORS.iceGlow,
    emissiveIntensity: 0.15,
  });
  
  malletBevelMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.iceDark,
    metalness: 0.4,
    roughness: 0.3,
  });
  
  malletFrostRingMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.iceCrystal,
    metalness: 0.2,
    roughness: 0.3,
    transparent: true,
    opacity: 0.85,
  });
  
  malletVeinMaterial = new THREE.MeshBasicMaterial({
    color: GLACIER_COLORS.iceCrystal,
    transparent: true,
    opacity: 0.6,
  });
  
  malletCrystalMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.iceCrystal,
    transparent: true,
    opacity: 0.9,
  });
  
  malletFrostCrystalMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.frost,
    transparent: true,
    opacity: 0.85,
  });

  malletGripHandMaterial = new THREE.MeshStandardMaterial({
    color: 0x123a63,
    metalness: 0.18,
    roughness: 0.46,
    emissive: GLACIER_COLORS.iceDark,
    emissiveIntensity: 0.06,
  });

  malletGripSleeveMaterial = new THREE.MeshStandardMaterial({
    color: 0x70aee8,
    metalness: 0.18,
    roughness: 0.42,
    emissive: GLACIER_COLORS.iceGlow,
    emissiveIntensity: 0.08,
  });
  
  frostParticleMaterial = new THREE.MeshBasicMaterial({
    color: GLACIER_COLORS.frost,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  
  iceShardMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.iceCrystal,
    transparent: true,
    opacity: 0.8,
    emissive: GLACIER_COLORS.iceLight,
    emissiveIntensity: 0.3,
  });
  
  // Shield materials
  shieldCrystalMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.iceCrystal,
    metalness: 0.1,
    roughness: 0.15,
    transparent: true,
    opacity: 0.85,
    emissive: GLACIER_COLORS.iceGlow,
    emissiveIntensity: 0.15,
  });
  
  shieldGlowCoreMaterial = new THREE.MeshBasicMaterial({
    color: GLACIER_COLORS.iceLight,
    transparent: true,
    opacity: 0.25,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  
  shieldShardMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.frost,
    transparent: true,
    opacity: 0.8,
    emissive: GLACIER_COLORS.iceGlow,
    emissiveIntensity: 0.1,
  });
  
  shieldPanelMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.iceMedium,
    metalness: 0.1,
    roughness: 0.2,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    emissive: GLACIER_COLORS.iceGlow,
    emissiveIntensity: 0.1,
  });
  
  shieldFrostParticleMaterial = new THREE.MeshBasicMaterial({
    color: GLACIER_COLORS.frost,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  
  shieldGroundFrostMaterial = new THREE.MeshBasicMaterial({
    color: GLACIER_COLORS.frost,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  
  materialsInitialized = true;
}

// ============================================================================
// GEOMETRY CACHING
// ============================================================================

// Mallet geometry
let malletHeadMainGeometry: THREE.CylinderGeometry | null = null;
let malletHeadCapGeometry: THREE.CylinderGeometry | null = null;
let malletHeadBevelGeometry: THREE.CylinderGeometry | null = null;
let malletHandleGeometry: THREE.CylinderGeometry | null = null;

export function getMalletGeometry() {
  if (!malletHeadMainGeometry) {
    malletHeadMainGeometry = new THREE.CylinderGeometry(0.7, 0.7, 2.4, 8);
  }
  if (!malletHeadCapGeometry) {
    malletHeadCapGeometry = new THREE.CylinderGeometry(0.8, 0.7, 0.3, 8);
  }
  if (!malletHeadBevelGeometry) {
    malletHeadBevelGeometry = new THREE.CylinderGeometry(0.4, 0.5, 0.4, 8);
  }
  if (!malletHandleGeometry) {
    malletHandleGeometry = new THREE.CylinderGeometry(0.06, 0.09, 7, 6);
  }
  return { malletHeadMainGeometry, malletHeadCapGeometry, malletHeadBevelGeometry, malletHandleGeometry };
}

// Shield geometry
let shieldPanelGeometry: THREE.CircleGeometry | null = null;
let shieldGroundFrostGeometry: THREE.CircleGeometry | null = null;
let shieldCrystalGeometry: THREE.ConeGeometry | null = null;

export function getShieldGeometry() {
  if (!shieldPanelGeometry) {
    shieldPanelGeometry = new THREE.CircleGeometry(3, 16, 0, Math.PI);
  }
  if (!shieldGroundFrostGeometry) {
    shieldGroundFrostGeometry = new THREE.CircleGeometry(3.2, 12);
  }
  return { shieldPanelGeometry, shieldGroundFrostGeometry };
}

export function getShieldCrystalGeometry() {
  if (!shieldCrystalGeometry) {
    shieldCrystalGeometry = new THREE.ConeGeometry(1, 1, 6);
  }
  return shieldCrystalGeometry;
}

// Wall geometry
let wallCrystalGeometry: THREE.ConeGeometry | null = null;

export function getWallCrystalGeometry() {
  if (!wallCrystalGeometry) {
    wallCrystalGeometry = new THREE.ConeGeometry(1, 1, 6);
  }
  return wallCrystalGeometry;
}

// Wall materials
let wallMaterialsCreated = false;
export let wallCrystalMaterial: THREE.MeshStandardMaterial;
export let wallFrostMaterial: THREE.MeshBasicMaterial;

export function getWallMaterials() {
  if (!wallMaterialsCreated) {
    wallCrystalMaterial = new THREE.MeshStandardMaterial({
      color: GLACIER_COLORS.iceCrystal,
      metalness: 0.15,
      roughness: 0.2,
      transparent: true,
      opacity: 0.9,
      emissive: GLACIER_COLORS.iceGlow,
      emissiveIntensity: 0.2,
    });
    wallFrostMaterial = new THREE.MeshBasicMaterial({
      color: GLACIER_COLORS.frost,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    wallMaterialsCreated = true;
  }
  return { wallCrystalMaterial, wallFrostMaterial };
}

// Frost storm materials
let frostStormParticleMaterial: THREE.MeshBasicMaterial | null = null;
let frostStormSnowMaterial: THREE.MeshBasicMaterial | null = null;
let frostStormGlowMaterial: THREE.MeshBasicMaterial | null = null;

export function getFrostStormMaterials() {
  if (!frostStormParticleMaterial) {
    frostStormParticleMaterial = new THREE.MeshBasicMaterial({
      color: GLACIER_COLORS.frost,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  if (!frostStormSnowMaterial) {
    frostStormSnowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  if (!frostStormGlowMaterial) {
    frostStormGlowMaterial = new THREE.MeshBasicMaterial({
      color: GLACIER_COLORS.iceLight,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
  return { frostStormParticleMaterial, frostStormSnowMaterial, frostStormGlowMaterial };
}

// ============================================================================
// PRE-COMPUTED STATIC DATA
// ============================================================================

export const FROST_RING_POSITIONS = [1.5, 2.8, 4.2, 5.5];
export const VEIN_POSITIONS = [-0.8, -0.3, 0.3, 0.8];
export const FROST_CRYSTAL_CONFIGS = [
  { pos: [-1.4, 0.5, -7.5], rot: [0, 0, -0.4], scale: [0.12, 0.35, 0.12], type: 'crystal' },
  { pos: [1.4, 0.4, -7.6], rot: [0, 0, 0.5], scale: [0.1, 0.3, 0.1], type: 'crystal' },
  { pos: [0, 0.6, -7.5], rot: [0, 0, 0], scale: [0.08, 0.25, 0.08], type: 'frost' },
  { pos: [-1.3, -0.4, -7.4], rot: [0.3, 0, 0.2], scale: [0.09, 0.28, 0.09], type: 'crystal' },
] as const;

// Pre-computed shield crystal configurations
export const SHIELD_CRYSTALS = [
  // Main crystals
  { x: 0, z: 0, h: 2.8, w: 0.4, ry: 0, rz: 0.1, d: 0 },
  { x: 0.3, z: 0.15, h: 2.4, w: 0.35, ry: 0.2, rz: -0.15, d: 0.02 },
  { x: -0.35, z: 0.1, h: 2.5, w: 0.38, ry: -0.15, rz: 0.12, d: 0.01 },
  // Left side
  { x: -0.8, z: 0.05, h: 2.2, w: 0.32, ry: -0.3, rz: 0.2, d: 0.04 },
  { x: -1.2, z: 0.12, h: 1.9, w: 0.28, ry: -0.4, rz: 0.25, d: 0.06 },
  { x: -1.6, z: 0.08, h: 1.6, w: 0.26, ry: -0.5, rz: 0.3, d: 0.08 },
  { x: -2.0, z: 0.15, h: 1.3, w: 0.24, ry: -0.6, rz: 0.35, d: 0.1 },
  { x: -2.4, z: 0.1, h: 1.0, w: 0.22, ry: -0.7, rz: 0.4, d: 0.12 },
  // Right side
  { x: 0.75, z: 0.08, h: 2.1, w: 0.3, ry: 0.25, rz: -0.18, d: 0.03 },
  { x: 1.15, z: 0.1, h: 1.85, w: 0.27, ry: 0.35, rz: -0.22, d: 0.05 },
  { x: 1.55, z: 0.06, h: 1.55, w: 0.25, ry: 0.45, rz: -0.28, d: 0.07 },
  { x: 1.95, z: 0.12, h: 1.25, w: 0.23, ry: 0.55, rz: -0.32, d: 0.09 },
  { x: 2.35, z: 0.08, h: 0.95, w: 0.21, ry: 0.65, rz: -0.38, d: 0.11 },
  // Back layer
  { x: 0.15, z: -0.2, h: 2.0, w: 0.25, ry: 0.1, rz: 0.05, d: 0.02 },
  { x: -0.5, z: -0.18, h: 1.9, w: 0.24, ry: -0.2, rz: 0.08, d: 0.03 },
  { x: 0.6, z: -0.22, h: 1.7, w: 0.22, ry: 0.3, rz: -0.1, d: 0.04 },
  { x: -1.0, z: -0.15, h: 1.5, w: 0.2, ry: -0.35, rz: 0.15, d: 0.06 },
  { x: 1.0, z: -0.17, h: 1.4, w: 0.2, ry: 0.4, rz: -0.12, d: 0.05 },
  // Small accents
  { x: -0.2, z: 0.25, h: 1.2, w: 0.15, ry: -0.1, rz: 0.2, d: 0.03 },
  { x: 0.45, z: 0.28, h: 1.0, w: 0.14, ry: 0.15, rz: -0.25, d: 0.04 },
  { x: -0.65, z: 0.22, h: 0.9, w: 0.12, ry: -0.25, rz: 0.3, d: 0.05 },
  { x: 0.9, z: 0.2, h: 0.8, w: 0.12, ry: 0.3, rz: -0.28, d: 0.06 },
  { x: -1.4, z: 0.2, h: 0.7, w: 0.11, ry: -0.4, rz: 0.35, d: 0.08 },
  { x: 1.35, z: 0.18, h: 0.75, w: 0.11, ry: 0.38, rz: -0.32, d: 0.07 },
  { x: -1.7, z: -0.12, h: 1.2, w: 0.18, ry: -0.5, rz: 0.2, d: 0.08 },
  { x: 1.7, z: -0.14, h: 1.1, w: 0.18, ry: 0.5, rz: -0.18, d: 0.07 },
  { x: -2.75, z: 0.18, h: 0.7, w: 0.18, ry: -0.8, rz: 0.45, d: 0.14 },
];

// Crystal layout for ice walls
export const CRYSTALS_PER_SEGMENT = 5;
export const MAX_WALL_SEGMENTS = 25;
export const MAX_WALL_CRYSTALS = MAX_WALL_SEGMENTS * CRYSTALS_PER_SEGMENT;

export const CRYSTAL_LAYOUT = (() => {
  const configs: Array<{ tOffset: number; heightMult: number; widthBase: number; rotZ: number; delay: number }> = [];
  for (let i = 0; i < CRYSTALS_PER_SEGMENT; i++) {
    const t = i / (CRYSTALS_PER_SEGMENT - 1);
    const centerDist = Math.abs(t - 0.5) * 2;
    configs.push({
      tOffset: (t - 0.5) * 0.9,
      heightMult: (1 - centerDist * 0.4) * (0.85 + (i % 3) * 0.1),
      widthBase: 0.35 + (i % 2) * 0.1,
      rotZ: ((i % 3) - 1) * 0.15,
      delay: centerDist * 0.08,
    });
  }
  return configs;
})();
