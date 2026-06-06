import * as THREE from 'three';
import type { VoxelBlockId, VoxelMapTheme } from '@voxel-strike/shared';

export const ATLAS_COLUMNS = 4;
export const ATLAS_ROWS = 4;
export const TILE_SIZE = 96;

export type VoxelFaceDirection = 'top' | 'bottom' | 'side';

export interface AtlasTile {
  x: number;
  y: number;
}

export interface VoxelAtlasTextures {
  color: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
  metalness: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
  ao: THREE.CanvasTexture;
}

interface AtlasContexts {
  color: CanvasRenderingContext2D;
  bump: CanvasRenderingContext2D;
  roughness: CanvasRenderingContext2D;
  metalness: CanvasRenderingContext2D;
  emissive: CanvasRenderingContext2D;
  ao: CanvasRenderingContext2D;
}

const TILE_MAP: Record<string, AtlasTile> = {
  grass_top: { x: 0, y: 0 },
  grass_side: { x: 1, y: 0 },
  dirt: { x: 2, y: 0 },
  stone: { x: 3, y: 0 },
  metal: { x: 0, y: 1 },
  glass: { x: 1, y: 1 },
  neon_red: { x: 2, y: 1 },
  neon_blue: { x: 3, y: 1 },
  spawn_pad: { x: 0, y: 2 },
  flag_pad: { x: 1, y: 2 },
  barrier: { x: 2, y: 2 },
  wood: { x: 3, y: 2 },
  leaves: { x: 0, y: 3 },
  cactus: { x: 1, y: 3 },
  spawn_pad_red: { x: 2, y: 3 },
  spawn_pad_blue: { x: 3, y: 3 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shadeHex(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  const num = Number.parseInt(value, 16);
  const r = clamp(((num >> 16) & 255) + amount, 0, 255);
  const g = clamp(((num >> 8) & 255) + amount, 0, 255);
  const b = clamp((num & 255) + amount, 0, 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
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

function tileOrigin(tile: AtlasTile): { x: number; y: number } {
  return {
    x: tile.x * TILE_SIZE,
    y: tile.y * TILE_SIZE,
  };
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x ^ Math.imul(y, 374761393) ^ seed, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

function layeredNoise(x: number, y: number, seed: number): number {
  const fine = hash2(x, y, seed);
  const medium = hash2(Math.floor(x / 4), Math.floor(y / 4), seed ^ 0x5f356495);
  const broad = hash2(Math.floor(x / 12), Math.floor(y / 12), seed ^ 0x9e3779b9);
  return fine * 0.42 + medium * 0.34 + broad * 0.24;
}

function fillTile(context: CanvasRenderingContext2D, tile: AtlasTile, color: string): void {
  const { x, y } = tileOrigin(tile);
  context.fillStyle = color;
  context.fillRect(x, y, TILE_SIZE, TILE_SIZE);
}

function fillGrayTile(context: CanvasRenderingContext2D, tile: AtlasTile, value: number): void {
  const gray = clamp(Math.round(value * 255), 0, 255);
  fillTile(context, tile, `rgb(${gray}, ${gray}, ${gray})`);
}

function paintNoisyColor(
  context: CanvasRenderingContext2D,
  tile: AtlasTile,
  base: string,
  light: string,
  dark: string,
  seed: number,
  contrast = 0.5
): void {
  const { x, y } = tileOrigin(tile);

  for (let py = 0; py < TILE_SIZE; py++) {
    for (let px = 0; px < TILE_SIZE; px++) {
      const noise = layeredNoise(px, py, seed);
      const edgeDistance = Math.min(px, py, TILE_SIZE - 1 - px, TILE_SIZE - 1 - py);
      const edgeShade = clamp((10 - edgeDistance) / 10, 0, 1);
      let color = noise > 0.56 ? mixHex(base, light, (noise - 0.56) * contrast) : mixHex(base, dark, (0.56 - noise) * contrast);

      if (edgeShade > 0) {
        color = mixHex(color, dark, edgeShade * 0.28);
      }

      context.fillStyle = color;
      context.fillRect(x + px, y + py, 1, 1);
    }
  }
}

function paintNoisyGray(
  context: CanvasRenderingContext2D,
  tile: AtlasTile,
  base: number,
  amount: number,
  seed: number
): void {
  const { x, y } = tileOrigin(tile);

  for (let py = 0; py < TILE_SIZE; py++) {
    for (let px = 0; px < TILE_SIZE; px++) {
      const noise = layeredNoise(px, py, seed) - 0.5;
      const value = clamp(Math.round((base + noise * amount) * 255), 0, 255);
      context.fillStyle = `rgb(${value}, ${value}, ${value})`;
      context.fillRect(x + px, y + py, 1, 1);
    }
  }
}

function paintEdgeAo(context: CanvasRenderingContext2D, tile: AtlasTile, strength: number): void {
  const { x, y } = tileOrigin(tile);

  for (let py = 0; py < TILE_SIZE; py++) {
    for (let px = 0; px < TILE_SIZE; px++) {
      const edgeDistance = Math.min(px, py, TILE_SIZE - 1 - px, TILE_SIZE - 1 - py);
      const edge = clamp(1 - edgeDistance / 18, 0, 1);
      const corner = clamp(1 - Math.hypot(px - TILE_SIZE / 2, py - TILE_SIZE / 2) / (TILE_SIZE * 0.72), 0, 1);
      const value = clamp(Math.round((1 - edge * strength - (1 - corner) * strength * 0.18) * 255), 0, 255);
      context.fillStyle = `rgb(${value}, ${value}, ${value})`;
      context.fillRect(x + px, y + py, 1, 1);
    }
  }
}

function paintUtilityMaps(
  contexts: AtlasContexts,
  tile: AtlasTile,
  options: {
    bump: number;
    bumpNoise?: number;
    roughness: number;
    roughnessNoise?: number;
    metalness: number;
    emissive?: string;
    aoStrength?: number;
    seed: number;
  }
): void {
  paintNoisyGray(contexts.bump, tile, options.bump, options.bumpNoise ?? 0.18, options.seed ^ 0x31d1);
  paintNoisyGray(contexts.roughness, tile, options.roughness, options.roughnessNoise ?? 0.08, options.seed ^ 0x7ab7);
  fillGrayTile(contexts.metalness, tile, options.metalness);
  fillTile(contexts.emissive, tile, options.emissive ?? '#000000');
  paintEdgeAo(contexts.ao, tile, options.aoStrength ?? 0.18);
}

function strokePanelLines(
  context: CanvasRenderingContext2D,
  tile: AtlasTile,
  color: string,
  lineWidth = 2
): void {
  const { x, y } = tileOrigin(tile);
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.strokeRect(x + 4, y + 4, TILE_SIZE - 8, TILE_SIZE - 8);
  context.beginPath();
  context.moveTo(x + TILE_SIZE / 2, y + 6);
  context.lineTo(x + TILE_SIZE / 2, y + TILE_SIZE - 6);
  context.moveTo(x + 6, y + TILE_SIZE / 2);
  context.lineTo(x + TILE_SIZE - 6, y + TILE_SIZE / 2);
  context.stroke();
}

function paintGrassTop(contexts: AtlasContexts, tile: AtlasTile, theme: VoxelMapTheme): void {
  const base = theme.ground.top;
  const light = shadeHex(base, 42);
  const dark = shadeHex(theme.ground.side, -22);
  const { x, y } = tileOrigin(tile);

  paintNoisyColor(contexts.color, tile, base, light, dark, 0x67726173, 0.62);
  paintUtilityMaps(contexts, tile, {
    bump: 0.58,
    bumpNoise: 0.32,
    roughness: 0.94,
    roughnessNoise: 0.05,
    metalness: 0.02,
    aoStrength: 0.16,
    seed: 0x67726173,
  });

  for (let i = 0; i < 42; i++) {
    const px = Math.floor(hash2(i, 7, 0x17a55) * TILE_SIZE);
    const py = Math.floor(hash2(i, 11, 0x71eaf) * TILE_SIZE);
    const height = 4 + Math.floor(hash2(i, 13, 0xc0fefe) * 8);
    const sway = (hash2(i, 17, 0xba5e) - 0.5) * 5;
    contexts.color.strokeStyle = i % 3 === 0 ? light : mixHex(base, dark, 0.35);
    contexts.color.lineWidth = i % 4 === 0 ? 2 : 1;
    contexts.color.beginPath();
    contexts.color.moveTo(x + px, y + py);
    contexts.color.quadraticCurveTo(x + px + sway, y + py - height * 0.55, x + px + sway * 0.4, y + py - height);
    contexts.color.stroke();
  }
}

function paintGrassSide(contexts: AtlasContexts, tile: AtlasTile, grass: string, dirt: string): void {
  const { x, y } = tileOrigin(tile);
  const darkDirt = shadeHex(dirt, -36);
  const rootColor = mixHex(grass, dirt, 0.42);

  paintNoisyColor(contexts.color, tile, dirt, shadeHex(dirt, 28), darkDirt, 0x51de, 0.7);
  paintUtilityMaps(contexts, tile, {
    bump: 0.48,
    bumpNoise: 0.26,
    roughness: 0.9,
    metalness: 0.02,
    aoStrength: 0.2,
    seed: 0x51de,
  });

  for (let px = 0; px < TILE_SIZE; px++) {
    const noise = layeredNoise(px, 0, 0x6a11);
    const grassDepth = Math.floor(TILE_SIZE * (0.2 + noise * 0.16));
    contexts.color.fillStyle = px % 5 === 0 ? shadeHex(grass, 34) : grass;
    contexts.color.fillRect(x + px, y, 1, grassDepth);
    if (px % 4 === 0) {
      contexts.color.fillStyle = rootColor;
      contexts.color.fillRect(x + px, y + grassDepth, 1, Math.floor(TILE_SIZE * (0.18 + noise * 0.12)));
    }
  }

  contexts.color.fillStyle = shadeHex(grass, 34);
  contexts.color.fillRect(x, y, TILE_SIZE, 3);
}

function paintDirtTile(contexts: AtlasContexts, tile: AtlasTile, base: string): void {
  const { x, y } = tileOrigin(tile);

  paintNoisyColor(contexts.color, tile, base, shadeHex(base, 24), shadeHex(base, -42), 0xd127, 0.72);
  paintUtilityMaps(contexts, tile, {
    bump: 0.45,
    bumpNoise: 0.28,
    roughness: 0.96,
    roughnessNoise: 0.04,
    metalness: 0,
    aoStrength: 0.22,
    seed: 0xd127,
  });

  for (let i = 0; i < 9; i++) {
    const py = Math.floor((i + 1) * TILE_SIZE / 10 + (hash2(i, 3, 0x5011) - 0.5) * 5);
    contexts.color.strokeStyle = i % 2 === 0 ? shadeHex(base, -28) : shadeHex(base, 18);
    contexts.color.lineWidth = 1 + (i % 3 === 0 ? 1 : 0);
    contexts.color.beginPath();
    contexts.color.moveTo(x + 3, y + py);
    contexts.color.bezierCurveTo(x + TILE_SIZE * 0.3, y + py - 4, x + TILE_SIZE * 0.65, y + py + 5, x + TILE_SIZE - 3, y + py);
    contexts.color.stroke();
  }
}

function paintStoneTile(contexts: AtlasContexts, tile: AtlasTile, base: string, accent: string): void {
  const { x, y } = tileOrigin(tile);

  paintNoisyColor(contexts.color, tile, base, shadeHex(base, 34), shadeHex(base, -46), 0x5705e, 0.78);
  paintUtilityMaps(contexts, tile, {
    bump: 0.52,
    bumpNoise: 0.34,
    roughness: 0.88,
    roughnessNoise: 0.08,
    metalness: 0.03,
    aoStrength: 0.28,
    seed: 0x5705e,
  });

  contexts.color.strokeStyle = shadeHex(base, -54);
  contexts.color.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    const sx = x + 8 + hash2(i, 1, 0x5afe) * (TILE_SIZE - 16);
    const sy = y + 8 + hash2(i, 2, 0x5afe) * (TILE_SIZE - 16);
    contexts.color.beginPath();
    contexts.color.moveTo(sx, sy);
    contexts.color.lineTo(sx + (hash2(i, 3, 0x5afe) - 0.5) * 20, sy + 8 + hash2(i, 4, 0x5afe) * 12);
    contexts.color.lineTo(sx + 8 + hash2(i, 5, 0x5afe) * 18, sy + (hash2(i, 6, 0x5afe) - 0.5) * 14);
    contexts.color.stroke();
  }

  contexts.color.fillStyle = mixHex(accent, '#ffffff', 0.2);
  contexts.color.globalAlpha = 0.18;
  contexts.color.fillRect(x + 11, y + 15, 12, 3);
  contexts.color.fillRect(x + 62, y + 61, 15, 3);
  contexts.color.globalAlpha = 1;
}

function paintMetalTile(contexts: AtlasContexts, tile: AtlasTile, base: string, accent: string): void {
  const { x, y } = tileOrigin(tile);
  const cold = mixHex(base, '#93b7cc', 0.18);
  const dark = shadeHex(base, -44);

  paintNoisyColor(contexts.color, tile, cold, shadeHex(cold, 38), dark, 0x4e7a1, 0.38);
  paintUtilityMaps(contexts, tile, {
    bump: 0.52,
    bumpNoise: 0.1,
    roughness: 0.42,
    roughnessNoise: 0.1,
    metalness: 0.92,
    aoStrength: 0.32,
    seed: 0x4e7a1,
  });

  fillTile(contexts.emissive, tile, '#000000');
  strokePanelLines(contexts.color, tile, shadeHex(base, -62), 3);
  strokePanelLines(contexts.bump, tile, 'rgb(188, 188, 188)', 3);
  contexts.color.strokeStyle = mixHex(accent, '#ffffff', 0.18);
  contexts.color.lineWidth = 2;
  for (let i = -TILE_SIZE; i < TILE_SIZE * 2; i += 18) {
    contexts.color.beginPath();
    contexts.color.moveTo(x + i, y + TILE_SIZE);
    contexts.color.lineTo(x + i + TILE_SIZE, y);
    contexts.color.stroke();
  }

  contexts.color.fillStyle = mixHex(accent, '#ffffff', 0.32);
  contexts.color.fillRect(x + 11, y + 10, 11, 3);
  contexts.color.fillRect(x + TILE_SIZE - 22, y + TILE_SIZE - 13, 11, 3);
}

function paintGlassTile(contexts: AtlasContexts, tile: AtlasTile, base: string, accent: string): void {
  const { x, y } = tileOrigin(tile);
  const bright = mixHex(base, '#ffffff', 0.48);
  const deep = mixHex(base, '#16263c', 0.44);

  paintNoisyColor(contexts.color, tile, base, bright, deep, 0x61a55, 0.52);
  paintUtilityMaps(contexts, tile, {
    bump: 0.5,
    bumpNoise: 0.12,
    roughness: 0.22,
    roughnessNoise: 0.08,
    metalness: 0.02,
    emissive: mixHex(base, '#000000', 0.54),
    aoStrength: 0.1,
    seed: 0x61a55,
  });

  for (let i = -TILE_SIZE; i < TILE_SIZE * 2; i += 22) {
    contexts.color.strokeStyle = i % 44 === 0 ? bright : mixHex(accent, bright, 0.35);
    contexts.color.lineWidth = i % 44 === 0 ? 3 : 1;
    contexts.color.beginPath();
    contexts.color.moveTo(x + i, y + TILE_SIZE);
    contexts.color.lineTo(x + i + TILE_SIZE, y);
    contexts.color.stroke();
  }

  contexts.color.strokeStyle = mixHex(bright, '#ffffff', 0.25);
  contexts.color.lineWidth = 2;
  contexts.color.beginPath();
  contexts.color.moveTo(x + 18, y + 12);
  contexts.color.lineTo(x + 43, y + 36);
  contexts.color.lineTo(x + 24, y + 72);
  contexts.color.lineTo(x + 76, y + 85);
  contexts.color.stroke();
}

function paintNeonTile(contexts: AtlasContexts, tile: AtlasTile, base: string, glow: string, seed: number): void {
  const { x, y } = tileOrigin(tile);

  paintNoisyColor(contexts.color, tile, base, shadeHex(base, 18), shadeHex(base, -36), seed, 0.34);
  paintUtilityMaps(contexts, tile, {
    bump: 0.47,
    bumpNoise: 0.08,
    roughness: 0.28,
    roughnessNoise: 0.08,
    metalness: 0.55,
    emissive: '#000000',
    aoStrength: 0.2,
    seed,
  });

  const gradient = contexts.color.createRadialGradient(
    x + TILE_SIZE / 2,
    y + TILE_SIZE / 2,
    4,
    x + TILE_SIZE / 2,
    y + TILE_SIZE / 2,
    TILE_SIZE * 0.58
  );
  gradient.addColorStop(0, mixHex(glow, '#ffffff', 0.52));
  gradient.addColorStop(0.42, glow);
  gradient.addColorStop(1, base);
  contexts.color.fillStyle = gradient;
  contexts.color.fillRect(x + 10, y + 10, TILE_SIZE - 20, TILE_SIZE - 20);

  fillTile(contexts.emissive, tile, '#000000');
  contexts.emissive.fillStyle = glow;
  contexts.emissive.fillRect(x + 9, y + 9, TILE_SIZE - 18, TILE_SIZE - 18);
  contexts.emissive.fillStyle = mixHex(glow, '#ffffff', 0.45);
  contexts.emissive.fillRect(x + 22, y + 22, TILE_SIZE - 44, TILE_SIZE - 44);

  contexts.color.strokeStyle = mixHex(glow, '#ffffff', 0.58);
  contexts.color.lineWidth = 4;
  contexts.color.strokeRect(x + 10, y + 10, TILE_SIZE - 20, TILE_SIZE - 20);
  contexts.color.lineWidth = 2;
  contexts.color.strokeRect(x + 22, y + 22, TILE_SIZE - 44, TILE_SIZE - 44);
}

function paintPadTile(
  contexts: AtlasContexts,
  tile: AtlasTile,
  base: string,
  accent: string,
  secondary: string,
  seed: number
): void {
  const { x, y } = tileOrigin(tile);

  paintMetalTile(contexts, tile, base, accent);
  paintUtilityMaps(contexts, tile, {
    bump: 0.54,
    bumpNoise: 0.08,
    roughness: 0.36,
    roughnessNoise: 0.08,
    metalness: 0.88,
    emissive: '#000000',
    aoStrength: 0.28,
    seed,
  });

  contexts.color.fillStyle = mixHex(base, '#000000', 0.32);
  contexts.color.fillRect(x + 10, y + 10, TILE_SIZE - 20, TILE_SIZE - 20);
  contexts.color.strokeStyle = accent;
  contexts.color.lineWidth = 3;
  contexts.color.strokeRect(x + 12, y + 12, TILE_SIZE - 24, TILE_SIZE - 24);

  for (let i = 16; i < TILE_SIZE - 14; i += 13) {
    contexts.color.strokeStyle = i % 26 === 16 ? accent : secondary;
    contexts.color.lineWidth = 2;
    contexts.color.beginPath();
    contexts.color.moveTo(x + i, y + 16);
    contexts.color.lineTo(x + i + 10, y + TILE_SIZE - 16);
    contexts.color.stroke();

    contexts.emissive.strokeStyle = i % 26 === 16 ? accent : secondary;
    contexts.emissive.lineWidth = 2;
    contexts.emissive.beginPath();
    contexts.emissive.moveTo(x + i, y + 16);
    contexts.emissive.lineTo(x + i + 10, y + TILE_SIZE - 16);
    contexts.emissive.stroke();
  }

  contexts.emissive.strokeStyle = accent;
  contexts.emissive.lineWidth = 3;
  contexts.emissive.strokeRect(x + 12, y + 12, TILE_SIZE - 24, TILE_SIZE - 24);
}

function paintBarrierTile(contexts: AtlasContexts, tile: AtlasTile, base: string, accent: string): void {
  const { x, y } = tileOrigin(tile);

  paintNoisyColor(contexts.color, tile, base, shadeHex(base, 18), shadeHex(base, -38), 0xba881e, 0.48);
  paintUtilityMaps(contexts, tile, {
    bump: 0.43,
    bumpNoise: 0.14,
    roughness: 0.58,
    roughnessNoise: 0.1,
    metalness: 0.54,
    emissive: '#000000',
    aoStrength: 0.36,
    seed: 0xba881e,
  });

  for (let i = -TILE_SIZE; i < TILE_SIZE * 2; i += 20) {
    contexts.color.strokeStyle = mixHex(accent, '#000000', 0.28);
    contexts.color.lineWidth = 5;
    contexts.color.beginPath();
    contexts.color.moveTo(x + i, y + TILE_SIZE);
    contexts.color.lineTo(x + i + TILE_SIZE, y);
    contexts.color.stroke();
  }
}

function paintWoodTile(contexts: AtlasContexts, tile: AtlasTile): void {
  const { x, y } = tileOrigin(tile);
  const base = '#7b4a27';

  paintNoisyColor(contexts.color, tile, base, '#b27645', '#472715', 0x600d, 0.62);
  paintUtilityMaps(contexts, tile, {
    bump: 0.5,
    bumpNoise: 0.26,
    roughness: 0.92,
    roughnessNoise: 0.05,
    metalness: 0,
    aoStrength: 0.24,
    seed: 0x600d,
  });

  for (let px = 4; px < TILE_SIZE; px += 9) {
    contexts.color.strokeStyle = px % 18 === 4 ? '#4f2c17' : '#a8663d';
    contexts.color.lineWidth = 2;
    contexts.color.beginPath();
    contexts.color.moveTo(x + px, y);
    contexts.color.bezierCurveTo(x + px - 5, y + 26, x + px + 6, y + 58, x + px - 2, y + TILE_SIZE);
    contexts.color.stroke();
  }

  contexts.color.strokeStyle = '#3f2617';
  contexts.color.lineWidth = 2;
  for (let py = 16; py < TILE_SIZE; py += 24) {
    contexts.color.beginPath();
    contexts.color.moveTo(x + 9, y + py);
    contexts.color.bezierCurveTo(x + 26, y + py - 8, x + 54, y + py + 11, x + 84, y + py - 2);
    contexts.color.stroke();
  }
}

function getLeafPalette(theme: VoxelMapTheme): { base: string; light: string; dark: string } {
  if (theme.id === 'desert') {
    return { base: '#6f8738', light: '#afbd62', dark: '#33491f' };
  }

  if (theme.id === 'frost' || theme.id === 'basalt') {
    return { base: '#2f7655', light: '#66b77c', dark: '#183f34' };
  }

  if (theme.id === 'crystal') {
    return { base: '#3d8b64', light: '#8bcf87', dark: '#254f3d' };
  }

  return { base: '#2f8f45', light: '#79cf62', dark: '#1c5730' };
}

function paintLeavesTile(contexts: AtlasContexts, tile: AtlasTile, theme: VoxelMapTheme): void {
  const palette = getLeafPalette(theme);
  const { x, y } = tileOrigin(tile);

  paintNoisyColor(contexts.color, tile, palette.base, palette.light, palette.dark, 0x1eafe5, 0.74);
  paintUtilityMaps(contexts, tile, {
    bump: 0.57,
    bumpNoise: 0.32,
    roughness: 0.94,
    roughnessNoise: 0.04,
    metalness: 0,
    aoStrength: 0.2,
    seed: 0x1eafe5,
  });

  for (let i = 0; i < 26; i++) {
    const px = x + hash2(i, 19, 0x7ea) * TILE_SIZE;
    const py = y + hash2(i, 23, 0x7ea) * TILE_SIZE;
    contexts.color.fillStyle = i % 3 === 0 ? palette.light : palette.dark;
    contexts.color.beginPath();
    contexts.color.ellipse(px, py, 3 + hash2(i, 29, 0x7ea) * 5, 2 + hash2(i, 31, 0x7ea) * 4, hash2(i, 37, 0x7ea) * Math.PI, 0, Math.PI * 2);
    contexts.color.fill();
  }
}

function paintCactusTile(contexts: AtlasContexts, tile: AtlasTile): void {
  const { x, y } = tileOrigin(tile);
  const base = '#3f8f4a';
  const light = '#8bd06d';
  const dark = '#1f5631';

  paintNoisyColor(contexts.color, tile, base, light, dark, 0xcac705, 0.48);
  paintUtilityMaps(contexts, tile, {
    bump: 0.56,
    bumpNoise: 0.2,
    roughness: 0.82,
    roughnessNoise: 0.06,
    metalness: 0,
    aoStrength: 0.18,
    seed: 0xcac705,
  });

  for (let px = 8; px < TILE_SIZE; px += 16) {
    contexts.color.fillStyle = px % 32 === 8 ? dark : light;
    contexts.color.fillRect(x + px, y, 3, TILE_SIZE);
  }

  contexts.color.fillStyle = '#edf8c9';
  for (let py = 10; py < TILE_SIZE; py += 13) {
    contexts.color.fillRect(x + 18, y + py, 4, 1);
    contexts.color.fillRect(x + 62, y + py + 6, 4, 1);
  }
}

function createLayerContext(): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLUMNS * TILE_SIZE;
  canvas.height = ATLAS_ROWS * TILE_SIZE;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Unable to create voxel texture atlas');
  }

  context.imageSmoothingEnabled = false;
  return { canvas, context };
}

function createTexture(canvas: HTMLCanvasElement, colorSpace: THREE.ColorSpace): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  return texture;
}

export function createVoxelAtlasTextures(theme: VoxelMapTheme): VoxelAtlasTextures {
  const color = createLayerContext();
  const bump = createLayerContext();
  const roughness = createLayerContext();
  const metalness = createLayerContext();
  const emissive = createLayerContext();
  const ao = createLayerContext();
  const contexts: AtlasContexts = {
    color: color.context,
    bump: bump.context,
    roughness: roughness.context,
    metalness: metalness.context,
    emissive: emissive.context,
    ao: ao.context,
  };

  for (const context of Object.values(contexts)) {
    context.clearRect(0, 0, ATLAS_COLUMNS * TILE_SIZE, ATLAS_ROWS * TILE_SIZE);
  }

  paintGrassTop(contexts, TILE_MAP.grass_top, theme);
  paintGrassSide(contexts, TILE_MAP.grass_side, theme.ground.top, theme.ground.dirt);
  paintDirtTile(contexts, TILE_MAP.dirt, theme.ground.dirt);
  paintStoneTile(contexts, TILE_MAP.stone, theme.ground.stone, theme.structures.accent);
  paintMetalTile(contexts, TILE_MAP.metal, theme.structures.metal, theme.structures.accent);
  paintGlassTile(contexts, TILE_MAP.glass, theme.structures.glass, theme.structures.accent);
  paintNeonTile(contexts, TILE_MAP.neon_red, shadeHex('#3d1212', theme.id === 'desert' ? 12 : 0), '#ff4b24', 0x1ed);
  paintNeonTile(contexts, TILE_MAP.neon_blue, shadeHex('#11193f', theme.id === 'frost' ? 12 : 0), '#3cf7ff', 0xb10e);
  paintPadTile(contexts, TILE_MAP.spawn_pad, mixHex(theme.structures.metal, '#1b1820', 0.45), '#ffd84d', theme.structures.accent, 0x5f0a);
  paintPadTile(contexts, TILE_MAP.spawn_pad_red, mixHex(theme.structures.metal, '#3a1114', 0.58), '#ff684f', '#ffd1a3', 0x5f0b);
  paintPadTile(contexts, TILE_MAP.spawn_pad_blue, mixHex(theme.structures.metal, '#101d3a', 0.58), '#47ddff', '#b8f2ff', 0x5f0c);
  paintPadTile(contexts, TILE_MAP.flag_pad, mixHex(theme.structures.metal, '#f7f7ff', 0.2), '#f7f7ff', theme.structures.accent, 0xf1a6);
  paintBarrierTile(contexts, TILE_MAP.barrier, theme.structures.barrier, theme.structures.accent);
  paintWoodTile(contexts, TILE_MAP.wood);
  paintLeavesTile(contexts, TILE_MAP.leaves, theme);
  paintCactusTile(contexts, TILE_MAP.cactus);

  return {
    color: createTexture(color.canvas, THREE.SRGBColorSpace),
    bump: createTexture(bump.canvas, THREE.NoColorSpace),
    roughness: createTexture(roughness.canvas, THREE.NoColorSpace),
    metalness: createTexture(metalness.canvas, THREE.NoColorSpace),
    emissive: createTexture(emissive.canvas, THREE.SRGBColorSpace),
    ao: createTexture(ao.canvas, THREE.NoColorSpace),
  };
}

export function createVoxelAtlasTexture(theme: VoxelMapTheme): THREE.CanvasTexture {
  return createVoxelAtlasTextures(theme).color;
}

export function getTileForBlock(blockId: VoxelBlockId, face: VoxelFaceDirection): AtlasTile {
  if (blockId === 'grass') {
    return face === 'top' ? TILE_MAP.grass_top : face === 'bottom' ? TILE_MAP.dirt : TILE_MAP.grass_side;
  }

  return TILE_MAP[blockId] ?? TILE_MAP.stone;
}
