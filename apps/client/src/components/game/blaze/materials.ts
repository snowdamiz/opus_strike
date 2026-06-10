import * as THREE from 'three';

// ============================================================================
// BLAZE METEOR STRIKE MATERIALS - Pre-cached for instant use (right-click ability)
// ============================================================================

// --- Meteor body materials ---
let sharedBombBodyMaterial: THREE.MeshBasicMaterial | null = null;
let sharedBombBandMaterial: THREE.MeshBasicMaterial | null = null;
let sharedBombNoseMaterial: THREE.MeshBasicMaterial | null = null;
let sharedBombFinMaterial: THREE.MeshBasicMaterial | null = null;
let sharedBombStripeMaterial: THREE.MeshBasicMaterial | null = null;

// --- Trail/glow materials ---
let sharedBombTrailMaterial: THREE.MeshBasicMaterial | null = null;
let sharedBombGlowMaterial: THREE.MeshBasicMaterial | null = null;

// --- Warning zone materials ---
let sharedWarningOuterRingMaterial: THREE.MeshBasicMaterial | null = null;
let sharedWarningInnerRingMaterial: THREE.MeshBasicMaterial | null = null;
let sharedWarningCenterRingMaterial: THREE.MeshBasicMaterial | null = null;
let sharedWarningCrossMainMaterial: THREE.MeshBasicMaterial | null = null;
let sharedWarningCrossDiagMaterial: THREE.MeshBasicMaterial | null = null;
let sharedWarningPulseFillMaterial: THREE.MeshBasicMaterial | null = null;

// --- Explosion materials ---
let sharedExplosionFlashMaterial: THREE.MeshBasicMaterial | null = null;
let sharedExplosionWhiteMaterial: THREE.MeshBasicMaterial | null = null;
let sharedExplosionYellowMaterial: THREE.MeshBasicMaterial | null = null;
let sharedExplosionOrangeMaterial: THREE.MeshBasicMaterial | null = null;
let sharedExplosionRedMaterial: THREE.MeshBasicMaterial | null = null;
let sharedExplosionDarkRedMaterial: THREE.MeshBasicMaterial | null = null;
let sharedExplosionSmokeDarkMaterial: THREE.MeshBasicMaterial | null = null;
let sharedExplosionSmokeLightMaterial: THREE.MeshBasicMaterial | null = null;
let sharedExplosionDebrisOrangeMaterial: THREE.MeshBasicMaterial | null = null;
let sharedExplosionDebrisYellowMaterial: THREE.MeshBasicMaterial | null = null;
let sharedShockwaveOuterMaterial: THREE.MeshBasicMaterial | null = null;
let sharedShockwaveInnerMaterial: THREE.MeshBasicMaterial | null = null;

// --- Targeting indicator materials ---
let sharedTargetRing1Material: THREE.MeshBasicMaterial | null = null;
let sharedTargetRing2Material: THREE.MeshBasicMaterial | null = null;
let sharedTargetRing3Material: THREE.MeshBasicMaterial | null = null;
let sharedTargetCenterMaterial: THREE.MeshBasicMaterial | null = null;
let sharedTargetFillMaterial: THREE.MeshBasicMaterial | null = null;
let sharedTargetCrossMaterial: THREE.MeshBasicMaterial | null = null;
let sharedTargetBeamMaterial: THREE.MeshBasicMaterial | null = null;
let sharedTargetBeamTopMaterial: THREE.MeshBasicMaterial | null = null;

// ============================================================================
// METEOR BODY MATERIALS
// ============================================================================

export function getBombBodyMaterial(): THREE.MeshBasicMaterial {
  if (!sharedBombBodyMaterial) {
    sharedBombBodyMaterial = new THREE.MeshBasicMaterial({ color: 0x2a130d });
  }
  return sharedBombBodyMaterial;
}

export function getBombBandMaterial(): THREE.MeshBasicMaterial {
  if (!sharedBombBandMaterial) {
    sharedBombBandMaterial = new THREE.MeshBasicMaterial({ color: 0xff6a00 });
  }
  return sharedBombBandMaterial;
}

export function getBombNoseMaterial(): THREE.MeshBasicMaterial {
  if (!sharedBombNoseMaterial) {
    sharedBombNoseMaterial = new THREE.MeshBasicMaterial({ color: 0xffd15c });
  }
  return sharedBombNoseMaterial;
}

export function getBombFinMaterial(): THREE.MeshBasicMaterial {
  if (!sharedBombFinMaterial) {
    sharedBombFinMaterial = new THREE.MeshBasicMaterial({ color: 0x7a1e12, side: THREE.DoubleSide });
  }
  return sharedBombFinMaterial;
}

export function getBombStripeMaterial(): THREE.MeshBasicMaterial {
  if (!sharedBombStripeMaterial) {
    sharedBombStripeMaterial = new THREE.MeshBasicMaterial({ color: 0xfff0a3 });
  }
  return sharedBombStripeMaterial;
}

// ============================================================================
// TRAIL/GLOW MATERIALS
// ============================================================================

export function getBombTrailMaterial(): THREE.MeshBasicMaterial {
  if (!sharedBombTrailMaterial) {
    sharedBombTrailMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff6600, 
      transparent: true, 
      opacity: 0.85 
    });
  }
  return sharedBombTrailMaterial;
}

export function getBombGlowMaterial(): THREE.MeshBasicMaterial {
  if (!sharedBombGlowMaterial) {
    sharedBombGlowMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff7a00, 
      transparent: true, 
      opacity: 0.32 
    });
  }
  return sharedBombGlowMaterial;
}

// ============================================================================
// WARNING ZONE MATERIALS
// ============================================================================

export function getWarningOuterRingMaterial(): THREE.MeshBasicMaterial {
  if (!sharedWarningOuterRingMaterial) {
    sharedWarningOuterRingMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff0000, 
      transparent: true, 
      opacity: 0.8, 
      side: THREE.DoubleSide 
    });
  }
  return sharedWarningOuterRingMaterial;
}

export function getWarningInnerRingMaterial(): THREE.MeshBasicMaterial {
  if (!sharedWarningInnerRingMaterial) {
    sharedWarningInnerRingMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff4400, 
      transparent: true, 
      opacity: 0.7, 
      side: THREE.DoubleSide 
    });
  }
  return sharedWarningInnerRingMaterial;
}

export function getWarningCenterRingMaterial(): THREE.MeshBasicMaterial {
  if (!sharedWarningCenterRingMaterial) {
    sharedWarningCenterRingMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xffaa00, 
      transparent: true, 
      opacity: 0.6, 
      side: THREE.DoubleSide 
    });
  }
  return sharedWarningCenterRingMaterial;
}

export function getWarningCrossMainMaterial(): THREE.MeshBasicMaterial {
  if (!sharedWarningCrossMainMaterial) {
    sharedWarningCrossMainMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff0000, 
      transparent: true, 
      opacity: 0.6, 
      side: THREE.DoubleSide 
    });
  }
  return sharedWarningCrossMainMaterial;
}

export function getWarningCrossDiagMaterial(): THREE.MeshBasicMaterial {
  if (!sharedWarningCrossDiagMaterial) {
    sharedWarningCrossDiagMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff4400, 
      transparent: true, 
      opacity: 0.4, 
      side: THREE.DoubleSide 
    });
  }
  return sharedWarningCrossDiagMaterial;
}

export function getWarningPulseFillMaterial(): THREE.MeshBasicMaterial {
  if (!sharedWarningPulseFillMaterial) {
    sharedWarningPulseFillMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff2200, 
      transparent: true, 
      opacity: 0.2, 
      side: THREE.DoubleSide 
    });
  }
  return sharedWarningPulseFillMaterial;
}

// ============================================================================
// EXPLOSION MATERIALS
// ============================================================================

export function getExplosionFlashMaterial(): THREE.MeshBasicMaterial {
  if (!sharedExplosionFlashMaterial) {
    sharedExplosionFlashMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xffffff, 
      transparent: true, 
      opacity: 1 
    });
  }
  return sharedExplosionFlashMaterial;
}

export function getExplosionWhiteMaterial(): THREE.MeshBasicMaterial {
  if (!sharedExplosionWhiteMaterial) {
    sharedExplosionWhiteMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xffffee, 
      transparent: true, 
      opacity: 0.95 
    });
  }
  return sharedExplosionWhiteMaterial;
}

export function getExplosionYellowMaterial(): THREE.MeshBasicMaterial {
  if (!sharedExplosionYellowMaterial) {
    sharedExplosionYellowMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xffcc00, 
      transparent: true, 
      opacity: 0.9 
    });
  }
  return sharedExplosionYellowMaterial;
}

export function getExplosionOrangeMaterial(): THREE.MeshBasicMaterial {
  if (!sharedExplosionOrangeMaterial) {
    sharedExplosionOrangeMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff8800, 
      transparent: true, 
      opacity: 0.8 
    });
  }
  return sharedExplosionOrangeMaterial;
}

export function getExplosionRedMaterial(): THREE.MeshBasicMaterial {
  if (!sharedExplosionRedMaterial) {
    sharedExplosionRedMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff4400, 
      transparent: true, 
      opacity: 0.6 
    });
  }
  return sharedExplosionRedMaterial;
}

export function getExplosionDarkRedMaterial(): THREE.MeshBasicMaterial {
  if (!sharedExplosionDarkRedMaterial) {
    sharedExplosionDarkRedMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xcc2200, 
      transparent: true, 
      opacity: 0.4 
    });
  }
  return sharedExplosionDarkRedMaterial;
}

export function getExplosionSmokeDarkMaterial(): THREE.MeshBasicMaterial {
  if (!sharedExplosionSmokeDarkMaterial) {
    sharedExplosionSmokeDarkMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x333333, 
      transparent: true, 
      opacity: 0.5 
    });
  }
  return sharedExplosionSmokeDarkMaterial;
}

export function getExplosionSmokeLightMaterial(): THREE.MeshBasicMaterial {
  if (!sharedExplosionSmokeLightMaterial) {
    sharedExplosionSmokeLightMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x444444, 
      transparent: true, 
      opacity: 0.5 
    });
  }
  return sharedExplosionSmokeLightMaterial;
}

export function getExplosionDebrisOrangeMaterial(): THREE.MeshBasicMaterial {
  if (!sharedExplosionDebrisOrangeMaterial) {
    sharedExplosionDebrisOrangeMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff6600, 
      transparent: true, 
      opacity: 1 
    });
  }
  return sharedExplosionDebrisOrangeMaterial;
}

export function getExplosionDebrisYellowMaterial(): THREE.MeshBasicMaterial {
  if (!sharedExplosionDebrisYellowMaterial) {
    sharedExplosionDebrisYellowMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xffaa00, 
      transparent: true, 
      opacity: 1 
    });
  }
  return sharedExplosionDebrisYellowMaterial;
}

export function getShockwaveOuterMaterial(): THREE.MeshBasicMaterial {
  if (!sharedShockwaveOuterMaterial) {
    sharedShockwaveOuterMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff6600, 
      transparent: true, 
      opacity: 0.8, 
      side: THREE.DoubleSide 
    });
  }
  return sharedShockwaveOuterMaterial;
}

export function getShockwaveInnerMaterial(): THREE.MeshBasicMaterial {
  if (!sharedShockwaveInnerMaterial) {
    sharedShockwaveInnerMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xffaa00, 
      transparent: true, 
      opacity: 0.5, 
      side: THREE.DoubleSide 
    });
  }
  return sharedShockwaveInnerMaterial;
}

// ============================================================================
// TARGETING INDICATOR MATERIALS
// ============================================================================

export function getTargetRing1Material(): THREE.MeshBasicMaterial {
  if (!sharedTargetRing1Material) {
    sharedTargetRing1Material = new THREE.MeshBasicMaterial({ 
      color: 0xff4400, 
      transparent: true, 
      opacity: 0.7, 
      side: THREE.DoubleSide 
    });
  }
  return sharedTargetRing1Material;
}

export function getTargetRing2Material(): THREE.MeshBasicMaterial {
  if (!sharedTargetRing2Material) {
    sharedTargetRing2Material = new THREE.MeshBasicMaterial({ 
      color: 0xff6600, 
      transparent: true, 
      opacity: 0.8, 
      side: THREE.DoubleSide 
    });
  }
  return sharedTargetRing2Material;
}

export function getTargetRing3Material(): THREE.MeshBasicMaterial {
  if (!sharedTargetRing3Material) {
    sharedTargetRing3Material = new THREE.MeshBasicMaterial({ 
      color: 0xffaa00, 
      transparent: true, 
      opacity: 0.9, 
      side: THREE.DoubleSide 
    });
  }
  return sharedTargetRing3Material;
}

export function getTargetCenterMaterial(): THREE.MeshBasicMaterial {
  if (!sharedTargetCenterMaterial) {
    sharedTargetCenterMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xffff00, 
      transparent: true, 
      opacity: 1, 
      side: THREE.DoubleSide 
    });
  }
  return sharedTargetCenterMaterial;
}

export function getTargetFillMaterial(): THREE.MeshBasicMaterial {
  if (!sharedTargetFillMaterial) {
    sharedTargetFillMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff2200, 
      transparent: true, 
      opacity: 0.15, 
      side: THREE.DoubleSide 
    });
  }
  return sharedTargetFillMaterial;
}

export function getTargetCrossMaterial(): THREE.MeshBasicMaterial {
  if (!sharedTargetCrossMaterial) {
    sharedTargetCrossMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff4400, 
      transparent: true, 
      opacity: 0.7, 
      side: THREE.DoubleSide 
    });
  }
  return sharedTargetCrossMaterial;
}

export function getTargetBeamMaterial(): THREE.MeshBasicMaterial {
  if (!sharedTargetBeamMaterial) {
    sharedTargetBeamMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff6600, 
      transparent: true, 
      opacity: 0.3 
    });
  }
  return sharedTargetBeamMaterial;
}

export function getTargetBeamTopMaterial(): THREE.MeshBasicMaterial {
  if (!sharedTargetBeamTopMaterial) {
    sharedTargetBeamTopMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff4400, 
      transparent: true, 
      opacity: 0.7 
    });
  }
  return sharedTargetBeamTopMaterial;
}

// ============================================================================
// SHARED FIREBALL MATERIALS
// ============================================================================

let sharedFireballCoreMaterial: THREE.MeshBasicMaterial | null = null;
let sharedFireballInnerMaterial: THREE.MeshBasicMaterial | null = null;
let sharedFireballOuterMaterial: THREE.MeshBasicMaterial | null = null;
let sharedFireballTrailCoreMaterial: THREE.MeshBasicMaterial | null = null;
let sharedFireballTrailInnerMaterial: THREE.MeshBasicMaterial | null = null;
let sharedFireballTrailOuterMaterial: THREE.MeshBasicMaterial | null = null;

function createFireballMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

export function getFireballCoreMaterial(): THREE.MeshBasicMaterial {
  if (!sharedFireballCoreMaterial) {
    sharedFireballCoreMaterial = createFireballMaterial(0xffffee, 0.98);
  }
  return sharedFireballCoreMaterial;
}

export function getFireballInnerMaterial(): THREE.MeshBasicMaterial {
  if (!sharedFireballInnerMaterial) {
    sharedFireballInnerMaterial = createFireballMaterial(0xffcc33, 0.86);
  }
  return sharedFireballInnerMaterial;
}

export function getFireballOuterMaterial(): THREE.MeshBasicMaterial {
  if (!sharedFireballOuterMaterial) {
    sharedFireballOuterMaterial = createFireballMaterial(0xff4a16, 0.58);
  }
  return sharedFireballOuterMaterial;
}

export function getFireballTrailCoreMaterial(): THREE.MeshBasicMaterial {
  if (!sharedFireballTrailCoreMaterial) {
    sharedFireballTrailCoreMaterial = createFireballMaterial(0xfff0a0, 0.76);
  }
  return sharedFireballTrailCoreMaterial;
}

export function getFireballTrailInnerMaterial(): THREE.MeshBasicMaterial {
  if (!sharedFireballTrailInnerMaterial) {
    sharedFireballTrailInnerMaterial = createFireballMaterial(0xff8a00, 0.62);
  }
  return sharedFireballTrailInnerMaterial;
}

export function getFireballTrailOuterMaterial(): THREE.MeshBasicMaterial {
  if (!sharedFireballTrailOuterMaterial) {
    sharedFireballTrailOuterMaterial = createFireballMaterial(0xff2200, 0.42);
  }
  return sharedFireballTrailOuterMaterial;
}

// ============================================================================
// MATERIAL PREWARMING
// Forces shader compilation before gameplay
// ============================================================================

let _materialsPrewarmed = false;

export function prewarmBlazeMaterials(): void {
  if (_materialsPrewarmed) return;
  _materialsPrewarmed = true;
  
  // Meteor body materials
  getBombBodyMaterial();
  getBombBandMaterial();
  getBombNoseMaterial();
  getBombFinMaterial();
  getBombStripeMaterial();
  
  // Trail/glow materials
  getBombTrailMaterial();
  getBombGlowMaterial();
  
  // Warning zone materials
  getWarningOuterRingMaterial();
  getWarningInnerRingMaterial();
  getWarningCenterRingMaterial();
  getWarningCrossMainMaterial();
  getWarningCrossDiagMaterial();
  getWarningPulseFillMaterial();
  
  // Explosion materials
  getExplosionFlashMaterial();
  getExplosionWhiteMaterial();
  getExplosionYellowMaterial();
  getExplosionOrangeMaterial();
  getExplosionRedMaterial();
  getExplosionDarkRedMaterial();
  getExplosionSmokeDarkMaterial();
  getExplosionSmokeLightMaterial();
  getExplosionDebrisOrangeMaterial();
  getExplosionDebrisYellowMaterial();
  getShockwaveOuterMaterial();
  getShockwaveInnerMaterial();
  
  // Targeting indicator materials
  getTargetRing1Material();
  getTargetRing2Material();
  getTargetRing3Material();
  getTargetCenterMaterial();
  getTargetFillMaterial();
  getTargetCrossMaterial();
  getTargetBeamMaterial();
  getTargetBeamTopMaterial();
  
  // Fireball materials
  getFireballCoreMaterial();
  getFireballInnerMaterial();
  getFireballOuterMaterial();
  getFireballTrailCoreMaterial();
  getFireballTrailInnerMaterial();
  getFireballTrailOuterMaterial();
}
