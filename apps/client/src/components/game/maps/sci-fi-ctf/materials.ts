/**
 * Shared Materials for Sci-Fi CTF Map
 *
 * All materials are created as single THREE.MeshStandardMaterial instances
 * to ensure one GPU resource per material type. Import and reuse these
 * across all map geometry components.
 */

import * as THREE from 'three';

type SurfaceKind = 'floor' | 'wall' | 'platform' | 'team' | 'glow' | 'hazard' | 'cave' | 'barrier';

interface SurfaceTextureOptions {
  base: string;
  light: string;
  dark: string;
  accent: string;
  glow?: string;
  kind: SurfaceKind;
  repeat: number;
  roughness: number;
  seed: number;
}

interface SurfaceTextureSet {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
}

const TEXTURE_SIZE = 256;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mixHex(hexA: string, hexB: string, amount: number): string {
  const a = Number.parseInt(hexA.replace('#', ''), 16);
  const b = Number.parseInt(hexB.replace('#', ''), 16);
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * amount);
  const g = Math.round(ag + (bg - ag) * amount);
  const bl = Math.round(ab + (bb - ab) * amount);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x ^ Math.imul(y, 374761393) ^ seed, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

function layeredNoise(x: number, y: number, seed: number): number {
  const fine = hash2(x, y, seed);
  const medium = hash2(Math.floor(x / 5), Math.floor(y / 5), seed ^ 0x6a09e667);
  const broad = hash2(Math.floor(x / 21), Math.floor(y / 21), seed ^ 0xbb67ae85);
  return fine * 0.34 + medium * 0.38 + broad * 0.28;
}

function withAlpha(context: CanvasRenderingContext2D, alpha: number, paint: () => void): void {
  context.save();
  context.globalAlpha = alpha;
  paint();
  context.restore();
}

function createTexture(
  colorSpace: THREE.ColorSpace,
  repeat: number,
  paint: (context: CanvasRenderingContext2D) => void
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Unable to create sci-fi map material texture');
  }

  paint(context);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function paintNoisyBase(
  context: CanvasRenderingContext2D,
  base: string,
  light: string,
  dark: string,
  seed: number,
  contrast = 0.5
): void {
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const noise = layeredNoise(x, y, seed);
      const color = noise > 0.54
        ? mixHex(base, light, (noise - 0.54) * contrast)
        : mixHex(base, dark, (0.54 - noise) * contrast);
      context.fillStyle = color;
      context.fillRect(x, y, 1, 1);
    }
  }
}

function fillGrayNoise(context: CanvasRenderingContext2D, base: number, amount: number, seed: number): void {
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const noise = layeredNoise(x, y, seed) - 0.5;
      const gray = clamp(Math.round((base + noise * amount) * 255), 0, 255);
      context.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
      context.fillRect(x, y, 1, 1);
    }
  }
}

function strokePanelGrid(context: CanvasRenderingContext2D, color: string, lineWidth: number, inset = 10): void {
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.strokeRect(inset, inset, TEXTURE_SIZE - inset * 2, TEXTURE_SIZE - inset * 2);

  for (let p = 64; p < TEXTURE_SIZE; p += 64) {
    context.beginPath();
    context.moveTo(inset, p);
    context.lineTo(TEXTURE_SIZE - inset, p + (p % 128 === 0 ? 6 : -6));
    context.moveTo(p, inset);
    context.lineTo(p + (p % 128 === 0 ? -6 : 6), TEXTURE_SIZE - inset);
    context.stroke();
  }
}

function paintBolts(context: CanvasRenderingContext2D, color: string, seed: number): void {
  context.fillStyle = color;

  for (let i = 0; i < 16; i++) {
    const x = 20 + (i % 4) * 72 + (hash2(i, 3, seed) - 0.5) * 7;
    const y = 20 + Math.floor(i / 4) * 72 + (hash2(i, 5, seed) - 0.5) * 7;
    context.beginPath();
    context.arc(x, y, 3.4, 0, Math.PI * 2);
    context.fill();
  }
}

function paintScratches(context: CanvasRenderingContext2D, color: string, seed: number, count = 34): void {
  withAlpha(context, 0.34, () => {
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.lineCap = 'round';

    for (let i = 0; i < count; i++) {
      const x = 16 + hash2(i, 11, seed) * (TEXTURE_SIZE - 32);
      const y = 16 + hash2(i, 13, seed) * (TEXTURE_SIZE - 32);
      const length = 9 + hash2(i, 17, seed) * 28;
      const angle = -0.58 + (hash2(i, 19, seed) - 0.5) * 0.42;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      context.stroke();
    }
  });
}

function paintEmissiveMotif(context: CanvasRenderingContext2D, options: SurfaceTextureOptions): void {
  const glow = options.glow ?? options.accent;
  context.fillStyle = '#000000';
  context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  if (options.kind === 'cave') return;

  if (options.kind === 'barrier') {
    const gradient = context.createLinearGradient(0, 0, TEXTURE_SIZE, 0);
    gradient.addColorStop(0, '#000000');
    gradient.addColorStop(0.5, glow);
    gradient.addColorStop(1, '#000000');
    withAlpha(context, 0.72, () => {
      context.fillStyle = gradient;
      for (let x = 19; x < TEXTURE_SIZE; x += 38) {
        context.fillRect(x, 0, 8, TEXTURE_SIZE);
      }
    });
    return;
  }

  context.strokeStyle = glow;
  context.lineCap = 'square';
  context.lineJoin = 'miter';

  const lineWidth = options.kind === 'glow' ? 5 : 3;
  context.lineWidth = lineWidth;
  context.strokeRect(18, 18, TEXTURE_SIZE - 36, TEXTURE_SIZE - 36);

  for (let i = 0; i < 5; i++) {
    const y = 42 + i * 35;
    context.beginPath();
    context.moveTo(34, y);
    context.lineTo(92, y);
    context.lineTo(110, y + 16);
    context.lineTo(178, y + 16);
    context.lineTo(197, y);
    context.lineTo(222, y);
    context.stroke();
  }

  if (options.kind === 'hazard') {
    context.lineWidth = 5;
    for (let i = -TEXTURE_SIZE; i < TEXTURE_SIZE * 2; i += 36) {
      context.beginPath();
      context.moveTo(i, TEXTURE_SIZE);
      context.lineTo(i + TEXTURE_SIZE, 0);
      context.stroke();
    }
  }
}

function paintSurfaceMotif(context: CanvasRenderingContext2D, options: SurfaceTextureOptions): void {
  const seam = mixHex(options.dark, '#000000', 0.35);
  const highlight = mixHex(options.light, '#ffffff', 0.16);

  if (options.kind === 'cave') {
    context.strokeStyle = seam;
    context.lineWidth = 2;
    for (let i = 0; i < 22; i++) {
      const startX = hash2(i, 23, options.seed) * TEXTURE_SIZE;
      const startY = hash2(i, 29, options.seed) * TEXTURE_SIZE;
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(startX + (hash2(i, 31, options.seed) - 0.5) * 52, startY + 18 + hash2(i, 37, options.seed) * 42);
      context.lineTo(startX + 12 + hash2(i, 41, options.seed) * 46, startY + (hash2(i, 43, options.seed) - 0.5) * 58);
      context.stroke();
    }
    return;
  }

  strokePanelGrid(context, seam, options.kind === 'wall' ? 4 : 3, options.kind === 'platform' ? 14 : 10);

  if (options.kind === 'floor' || options.kind === 'platform') {
    withAlpha(context, 0.34, () => {
      context.strokeStyle = options.accent;
      context.lineWidth = 2;
      for (let i = -TEXTURE_SIZE; i < TEXTURE_SIZE * 2; i += 32) {
        context.beginPath();
        context.moveTo(i, TEXTURE_SIZE);
        context.lineTo(i + TEXTURE_SIZE, 0);
        context.stroke();
      }
    });
  }

  if (options.kind === 'hazard') {
    context.strokeStyle = options.accent;
    context.lineWidth = 9;
    for (let i = -TEXTURE_SIZE; i < TEXTURE_SIZE * 2; i += 38) {
      context.beginPath();
      context.moveTo(i, TEXTURE_SIZE);
      context.lineTo(i + TEXTURE_SIZE, 0);
      context.stroke();
    }
  }

  if (options.kind === 'team' || options.kind === 'glow') {
    context.strokeStyle = options.accent;
    context.lineWidth = options.kind === 'glow' ? 5 : 3;
    context.beginPath();
    context.moveTo(TEXTURE_SIZE / 2, 42);
    context.lineTo(TEXTURE_SIZE - 44, TEXTURE_SIZE / 2);
    context.lineTo(TEXTURE_SIZE / 2, TEXTURE_SIZE - 42);
    context.lineTo(44, TEXTURE_SIZE / 2);
    context.closePath();
    context.stroke();
  }

  paintBolts(context, highlight, options.seed);
  paintScratches(context, highlight, options.seed ^ 0x51f15, options.kind === 'wall' ? 20 : 36);
}

function createSurfaceTextures(options: SurfaceTextureOptions): SurfaceTextureSet {
  return {
    map: createTexture(THREE.SRGBColorSpace, options.repeat, (context) => {
      paintNoisyBase(context, options.base, options.light, options.dark, options.seed, options.kind === 'cave' ? 0.76 : 0.48);
      paintSurfaceMotif(context, options);
    }),
    bumpMap: createTexture(THREE.NoColorSpace, options.repeat, (context) => {
      fillGrayNoise(context, options.kind === 'cave' ? 0.46 : 0.52, options.kind === 'cave' ? 0.26 : 0.11, options.seed ^ 0x91e10);
      paintSurfaceMotif(context, { ...options, base: '#7f7f7f', light: '#e4e4e4', dark: '#3c3c3c' });
    }),
    roughnessMap: createTexture(THREE.NoColorSpace, options.repeat, (context) => {
      fillGrayNoise(context, options.roughness, options.kind === 'cave' ? 0.08 : 0.12, options.seed ^ 0x7729);
      paintScratches(context, '#ffffff', options.seed ^ 0xa277, options.kind === 'cave' ? 10 : 30);
    }),
    emissiveMap: createTexture(THREE.SRGBColorSpace, options.repeat, (context) => {
      paintEmissiveMotif(context, options);
    }),
  };
}

const floorTextures = createSurfaceTextures({
  base: '#171a2a',
  light: '#343d5f',
  dark: '#080a13',
  accent: '#2e8dff',
  glow: '#4ec8ff',
  kind: 'floor',
  repeat: 4,
  roughness: 0.34,
  seed: 0xf1002,
});

const wallTextures = createSurfaceTextures({
  base: '#0c0e18',
  light: '#232940',
  dark: '#04050a',
  accent: '#19ffbd',
  glow: '#27ffcc',
  kind: 'wall',
  repeat: 3,
  roughness: 0.46,
  seed: 0xa112,
});

const platformTextures = createSurfaceTextures({
  base: '#1b2034',
  light: '#414a72',
  dark: '#090b14',
  accent: '#ffd866',
  glow: '#ffe68a',
  kind: 'platform',
  repeat: 5,
  roughness: 0.28,
  seed: 0x9a750,
});

const teamATextures = createSurfaceTextures({
  base: '#210909',
  light: '#5c1515',
  dark: '#090302',
  accent: '#ef4444',
  glow: '#f87171',
  kind: 'team',
  repeat: 2,
  roughness: 0.32,
  seed: 0x7ea11,
});

const teamAGlowTextures = createSurfaceTextures({
  base: '#260707',
  light: '#7f1d1d',
  dark: '#070100',
  accent: '#ef4444',
  glow: '#fca5a5',
  kind: 'glow',
  repeat: 2,
  roughness: 0.26,
  seed: 0x7ea12,
});

const teamBTextures = createSurfaceTextures({
  base: '#101626',
  light: '#213d64',
  dark: '#030612',
  accent: '#00dfff',
  glow: '#38f8ff',
  kind: 'team',
  repeat: 2,
  roughness: 0.32,
  seed: 0xb100e,
});

const teamBGlowTextures = createSurfaceTextures({
  base: '#061729',
  light: '#1d527a',
  dark: '#010511',
  accent: '#44f4ff',
  glow: '#63fbff',
  kind: 'glow',
  repeat: 2,
  roughness: 0.26,
  seed: 0xb100f,
});

const hazardTextures = createSurfaceTextures({
  base: '#170818',
  light: '#4e164f',
  dark: '#060106',
  accent: '#ff33ff',
  glow: '#ff2cff',
  kind: 'hazard',
  repeat: 3,
  roughness: 0.38,
  seed: 0xaa7a2d,
});

const caveTextures = createSurfaceTextures({
  base: '#19120f',
  light: '#433127',
  dark: '#070403',
  accent: '#b78a55',
  kind: 'cave',
  repeat: 4,
  roughness: 0.86,
  seed: 0xca7e,
});

const barrierTextures = createSurfaceTextures({
  base: '#04150f',
  light: '#0c3328',
  dark: '#000604',
  accent: '#00ff99',
  glow: '#25ffae',
  kind: 'barrier',
  repeat: 2,
  roughness: 0.18,
  seed: 0xba991e,
});

function applyTextureSet(
  materialOptions: THREE.MeshStandardMaterialParameters,
  textures: SurfaceTextureSet,
  bumpScale: number,
  emissiveIntensity: number
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    ...materialOptions,
    color: materialOptions.color ?? 0xffffff,
    map: textures.map,
    bumpMap: textures.bumpMap,
    bumpScale,
    roughnessMap: textures.roughnessMap,
    emissive: 0xffffff,
    emissiveMap: textures.emissiveMap,
    emissiveIntensity,
  });

  material.envMapIntensity = materialOptions.envMapIntensity ?? 0.9;
  return material;
}

// =============================================================================
// BASE MATERIALS - Dark colors for main surfaces
// =============================================================================

/**
 * Floor material - dark metallic surface for main ground
 */
export const floorMaterial = applyTextureSet({
  metalness: 0.8,
  roughness: 0.3,
}, floorTextures, 0.055, 0.34);

/**
 * Wall material - darker for vertical surfaces
 */
export const wallMaterial = applyTextureSet({
  metalness: 0.7,
  roughness: 0.4,
}, wallTextures, 0.048, 0.28);

/**
 * Platform material - slightly lighter for elevated surfaces
 */
export const platformMaterial = applyTextureSet({
  metalness: 0.85,
  roughness: 0.25,
}, platformTextures, 0.06, 0.42);

// =============================================================================
// TEAM A MATERIALS - Red faction accents
// =============================================================================

/**
 * Team A accent - red emissive for team identity
 */
export const teamAAccent = applyTextureSet({
  metalness: 0.62,
  roughness: 0.34,
}, teamATextures, 0.045, 0.72);

/**
 * Team A glow - brighter emissive for prominent features
 */
export const teamAGlow = applyTextureSet({
  metalness: 0.58,
  roughness: 0.28,
}, teamAGlowTextures, 0.035, 1.45);

// =============================================================================
// TEAM B MATERIALS - Blue/cyan cool accents
// =============================================================================

/**
 * Team B accent - cool blue/cyan emissive for team identity
 */
export const teamBAccent = applyTextureSet({
  metalness: 0.62,
  roughness: 0.34,
}, teamBTextures, 0.045, 0.72);

/**
 * Team B glow - brighter emissive for prominent features
 */
export const teamBGlow = applyTextureSet({
  metalness: 0.58,
  roughness: 0.28,
}, teamBGlowTextures, 0.035, 1.45);

// =============================================================================
// SPECIAL MATERIALS - Hazards, barriers, and environmental features
// =============================================================================

/**
 * Hazard material - magenta glow for dangerous areas
 */
export const hazardMaterial = applyTextureSet({
  metalness: 0.46,
  roughness: 0.38,
}, hazardTextures, 0.05, 1.05);

/**
 * Cave material - natural stone look for Team B side (natural/cave aesthetic)
 */
export const caveMaterial = applyTextureSet({
  metalness: 0.3,
  roughness: 0.8,
}, caveTextures, 0.095, 0);

/**
 * Energy barrier material - transparent glowing barrier
 */
export const energyBarrierMaterial = applyTextureSet({
  metalness: 0.05,
  roughness: 0.18,
  transparent: true,
  opacity: 0.64,
  depthWrite: false,
  side: THREE.DoubleSide,
}, barrierTextures, 0.02, 1.85);

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
