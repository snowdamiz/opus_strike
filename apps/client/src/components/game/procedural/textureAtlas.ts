import * as THREE from 'three';
import type { VoxelBlockId, VoxelMapTheme } from '@voxel-strike/shared';

export const ATLAS_COLUMNS = 4;
export const ATLAS_ROWS = 4;
export const TILE_SIZE = 128;

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

const atlasTextureCache = new Map<VoxelMapTheme['id'], VoxelAtlasTextures>();

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

function toneHex(hex: string, saturation = 1.12, brightness = 1.02): string {
  const value = hex.replace('#', '');
  const num = Number.parseInt(value, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const nextR = clamp(Math.round((luma + (r - luma) * saturation) * brightness), 0, 255);
  const nextG = clamp(Math.round((luma + (g - luma) * saturation) * brightness), 0, 255);
  const nextB = clamp(Math.round((luma + (b - luma) * saturation) * brightness), 0, 255);
  return `#${((1 << 24) | (nextR << 16) | (nextG << 8) | nextB).toString(16).slice(1)}`;
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
  const richBase = toneHex(base, 1.12, 1.02);
  const richLight = toneHex(light, 1.14, 1.035);
  const richDark = toneHex(dark, 1.08, 1.005);

  for (let py = 0; py < TILE_SIZE; py++) {
    for (let px = 0; px < TILE_SIZE; px++) {
      const noise = layeredNoise(px, py, seed);
      const edgeDistance = Math.min(px, py, TILE_SIZE - 1 - px, TILE_SIZE - 1 - py);
      const edgeShade = clamp((10 - edgeDistance) / 10, 0, 1);
      let color = noise > 0.56
        ? mixHex(richBase, richLight, (noise - 0.56) * contrast)
        : mixHex(richBase, richDark, (0.56 - noise) * contrast);

      if (edgeShade > 0) {
        color = mixHex(color, richDark, edgeShade * 0.28);
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

function withAlpha(context: CanvasRenderingContext2D, alpha: number, paint: () => void): void {
  context.save();
  context.globalAlpha = alpha;
  paint();
  context.restore();
}

function paintPackPixelClusters(
  contexts: AtlasContexts,
  tile: AtlasTile,
  colors: string[],
  seed: number,
  count: number,
  minSize = 3,
  maxSize = 9,
  alpha = 0.34
): void {
  const { x, y } = tileOrigin(tile);

  withAlpha(contexts.color, alpha, () => {
    for (let i = 0; i < count; i++) {
      const size = minSize + Math.floor(hash2(i, 7, seed) * (maxSize - minSize + 1));
      const px = x + Math.floor(hash2(i, 11, seed) * (TILE_SIZE - size));
      const py = y + Math.floor(hash2(i, 13, seed) * (TILE_SIZE - size));
      const shade = colors[Math.floor(hash2(i, 17, seed) * colors.length)] ?? colors[0];
      contexts.color.fillStyle = shade;
      contexts.color.fillRect(px, py, size, Math.max(2, Math.floor(size * (0.55 + hash2(i, 19, seed) * 0.55))));
    }
  });

  withAlpha(contexts.bump, 0.22, () => {
    contexts.bump.fillStyle = 'rgb(190, 190, 190)';
    for (let i = 0; i < Math.floor(count * 0.38); i++) {
      const size = minSize + Math.floor(hash2(i, 23, seed) * Math.max(1, maxSize - minSize));
      contexts.bump.fillRect(
        x + Math.floor(hash2(i, 29, seed) * (TILE_SIZE - size)),
        y + Math.floor(hash2(i, 31, seed) * (TILE_SIZE - size)),
        size,
        Math.max(2, Math.floor(size * 0.62))
      );
    }
  });
}

function paintTileEdgePixelFrame(
  contexts: AtlasContexts,
  tile: AtlasTile,
  light: string,
  shadow: string,
  inset = 3
): void {
  const { x, y } = tileOrigin(tile);
  const right = x + TILE_SIZE - inset;
  const bottom = y + TILE_SIZE - inset;

  contexts.color.fillStyle = light;
  contexts.color.fillRect(x + inset, y + inset, TILE_SIZE - inset * 2, 2);
  contexts.color.fillRect(x + inset, y + inset, 2, TILE_SIZE - inset * 2);

  contexts.color.fillStyle = shadow;
  contexts.color.fillRect(x + inset, bottom - 2, TILE_SIZE - inset * 2, 2);
  contexts.color.fillRect(right - 2, y + inset, 2, TILE_SIZE - inset * 2);

  contexts.ao.fillStyle = 'rgb(128, 128, 128)';
  contexts.ao.fillRect(x + inset, bottom - 1, TILE_SIZE - inset * 2, 2);
  contexts.ao.fillRect(right - 1, y + inset, 2, TILE_SIZE - inset * 2);
}

function paintInsetBevel(
  contexts: AtlasContexts,
  tile: AtlasTile,
  light: string,
  shadow: string,
  inset = 4,
  width = 2
): void {
  const { x, y } = tileOrigin(tile);
  const right = x + TILE_SIZE - inset;
  const bottom = y + TILE_SIZE - inset;

  contexts.color.lineWidth = width;
  contexts.color.lineCap = 'square';
  contexts.color.strokeStyle = light;
  contexts.color.beginPath();
  contexts.color.moveTo(x + inset, bottom);
  contexts.color.lineTo(x + inset, y + inset);
  contexts.color.lineTo(right, y + inset);
  contexts.color.stroke();

  contexts.color.strokeStyle = shadow;
  contexts.color.beginPath();
  contexts.color.moveTo(right, y + inset);
  contexts.color.lineTo(right, bottom);
  contexts.color.lineTo(x + inset, bottom);
  contexts.color.stroke();

  contexts.bump.lineWidth = width;
  contexts.bump.strokeStyle = 'rgb(218, 218, 218)';
  contexts.bump.strokeRect(x + inset, y + inset, TILE_SIZE - inset * 2, TILE_SIZE - inset * 2);

  contexts.ao.lineWidth = width + 1;
  contexts.ao.strokeStyle = 'rgb(120, 120, 120)';
  contexts.ao.strokeRect(x + inset + 1, y + inset + 1, TILE_SIZE - inset * 2 - 2, TILE_SIZE - inset * 2 - 2);
}

function paintTileGlow(
  context: CanvasRenderingContext2D,
  tile: AtlasTile,
  color: string,
  alpha: number,
  inset = 0
): void {
  const { x, y } = tileOrigin(tile);
  const centerX = x + TILE_SIZE / 2;
  const centerY = y + TILE_SIZE / 2;
  const gradient = context.createRadialGradient(centerX, centerY, TILE_SIZE * 0.08, centerX, centerY, TILE_SIZE * 0.68);

  gradient.addColorStop(0, color);
  gradient.addColorStop(0.48, mixHex(color, '#000000', 0.38));
  gradient.addColorStop(1, '#000000');

  withAlpha(context, alpha, () => {
    context.fillStyle = gradient;
    context.fillRect(x + inset, y + inset, TILE_SIZE - inset * 2, TILE_SIZE - inset * 2);
  });
}

function paintSpeckles(
  context: CanvasRenderingContext2D,
  tile: AtlasTile,
  colors: string[],
  count: number,
  seed: number,
  minSize = 1,
  maxSize = 3
): void {
  const { x, y } = tileOrigin(tile);

  for (let i = 0; i < count; i++) {
    const px = x + Math.floor(hash2(i, 3, seed) * TILE_SIZE);
    const py = y + Math.floor(hash2(i, 5, seed) * TILE_SIZE);
    const size = minSize + Math.floor(hash2(i, 7, seed) * (maxSize - minSize + 1));
    context.fillStyle = colors[i % colors.length];
    context.fillRect(px, py, size, size);
  }
}

function strokeJitterLine(
  context: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  seed: number,
  segments = 5
): void {
  context.beginPath();
  context.moveTo(startX, startY);

  for (let i = 1; i < segments; i++) {
    const amount = i / segments;
    const jitter = (hash2(i, segments, seed) - 0.5) * 8;
    const normalX = endY - startY;
    const normalY = startX - endX;
    const length = Math.hypot(normalX, normalY) || 1;
    context.lineTo(
      startX + (endX - startX) * amount + (normalX / length) * jitter,
      startY + (endY - startY) * amount + (normalY / length) * jitter
    );
  }

  context.lineTo(endX, endY);
  context.stroke();
}

function paintMicroScratches(
  contexts: AtlasContexts,
  tile: AtlasTile,
  color: string,
  seed: number,
  count = 18,
  alpha = 0.28
): void {
  const { x, y } = tileOrigin(tile);

  withAlpha(contexts.color, alpha, () => {
    contexts.color.strokeStyle = color;
    contexts.color.lineWidth = 1;
    contexts.color.lineCap = 'round';

    for (let i = 0; i < count; i++) {
      const sx = x + 8 + hash2(i, 11, seed) * (TILE_SIZE - 16);
      const sy = y + 8 + hash2(i, 13, seed) * (TILE_SIZE - 16);
      const length = 6 + hash2(i, 17, seed) * 18;
      const angle = -0.62 + (hash2(i, 19, seed) - 0.5) * 0.35;
      contexts.color.beginPath();
      contexts.color.moveTo(sx, sy);
      contexts.color.lineTo(sx + Math.cos(angle) * length, sy + Math.sin(angle) * length);
      contexts.color.stroke();
    }
  });

  withAlpha(contexts.roughness, 0.34, () => {
    contexts.roughness.strokeStyle = 'rgb(238, 238, 238)';
    contexts.roughness.lineWidth = 1;

    for (let i = 0; i < Math.floor(count * 0.65); i++) {
      const sx = x + 8 + hash2(i, 23, seed) * (TILE_SIZE - 16);
      const sy = y + 8 + hash2(i, 29, seed) * (TILE_SIZE - 16);
      contexts.roughness.beginPath();
      contexts.roughness.moveTo(sx, sy);
      contexts.roughness.lineTo(sx + 10 + hash2(i, 31, seed) * 16, sy - 3 + hash2(i, 37, seed) * 6);
      contexts.roughness.stroke();
    }
  });
}

function paintCracks(
  contexts: AtlasContexts,
  tile: AtlasTile,
  color: string,
  seed: number,
  count = 6
): void {
  const { x, y } = tileOrigin(tile);

  contexts.color.strokeStyle = color;
  contexts.color.lineWidth = 1.4;
  contexts.color.lineCap = 'round';
  contexts.bump.strokeStyle = 'rgb(54, 54, 54)';
  contexts.bump.lineWidth = 1;

  for (let i = 0; i < count; i++) {
    const sx = x + 10 + hash2(i, 41, seed) * (TILE_SIZE - 20);
    const sy = y + 10 + hash2(i, 43, seed) * (TILE_SIZE - 20);
    const ex = sx + (hash2(i, 47, seed) - 0.5) * 34;
    const ey = sy + (hash2(i, 53, seed) - 0.5) * 34;
    strokeJitterLine(contexts.color, sx, sy, ex, ey, seed ^ i, 4);
    strokeJitterLine(contexts.bump, sx, sy, ex, ey, seed ^ i ^ 0x777, 4);
  }
}

function paintCircuitTraces(
  contexts: AtlasContexts,
  tile: AtlasTile,
  color: string,
  seed: number,
  count = 7
): void {
  const { x, y } = tileOrigin(tile);

  contexts.color.strokeStyle = color;
  contexts.color.lineCap = 'square';
  contexts.color.lineJoin = 'miter';
  contexts.emissive.strokeStyle = color;
  contexts.emissive.lineCap = 'square';
  contexts.emissive.lineJoin = 'miter';

  for (let i = 0; i < count; i++) {
    const sx = x + 14 + Math.floor(hash2(i, 59, seed) * (TILE_SIZE - 28));
    const sy = y + 14 + Math.floor(hash2(i, 61, seed) * (TILE_SIZE - 28));
    const midX = sx + (hash2(i, 67, seed) > 0.5 ? 1 : -1) * (12 + Math.floor(hash2(i, 71, seed) * 22));
    const endY = sy + (hash2(i, 73, seed) > 0.5 ? 1 : -1) * (10 + Math.floor(hash2(i, 79, seed) * 24));

    contexts.color.lineWidth = i % 3 === 0 ? 3 : 2;
    contexts.color.beginPath();
    contexts.color.moveTo(sx, sy);
    contexts.color.lineTo(midX, sy);
    contexts.color.lineTo(midX, endY);
    contexts.color.stroke();

    contexts.emissive.lineWidth = contexts.color.lineWidth;
    contexts.emissive.beginPath();
    contexts.emissive.moveTo(sx, sy);
    contexts.emissive.lineTo(midX, sy);
    contexts.emissive.lineTo(midX, endY);
    contexts.emissive.stroke();

    contexts.color.fillStyle = mixHex(color, '#ffffff', 0.44);
    contexts.color.fillRect(midX - 2, endY - 2, 4, 4);
    contexts.emissive.fillStyle = color;
    contexts.emissive.fillRect(midX - 2, endY - 2, 4, 4);
  }
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

  paintNoisyColor(contexts.color, tile, base, light, dark, 0x67726173, 0.7);
  paintUtilityMaps(contexts, tile, {
    bump: 0.58,
    bumpNoise: 0.36,
    roughness: 0.94,
    roughnessNoise: 0.05,
    metalness: 0.02,
    aoStrength: 0.16,
    seed: 0x67726173,
  });
  paintSpeckles(contexts.color, tile, [shadeHex(light, 18), mixHex(base, '#fff6b5', 0.14), shadeHex(dark, -8)], 62, 0x51ad0, 1, 2);
  paintPackPixelClusters(
    contexts,
    tile,
    [mixHex(base, light, 0.42), toneHex(light, 1.18, 1.04), mixHex(base, dark, 0.36), mixHex(base, '#d8f28d', 0.22)],
    0x67a55,
    34,
    4,
    11,
    0.3
  );

  for (let i = 0; i < 92; i++) {
    const px = Math.floor(hash2(i, 7, 0x17a55) * TILE_SIZE);
    const py = Math.floor(hash2(i, 11, 0x71eaf) * TILE_SIZE);
    const height = 5 + Math.floor(hash2(i, 13, 0xc0fefe) * 13);
    const sway = (hash2(i, 17, 0xba5e) - 0.5) * 7;
    contexts.color.strokeStyle = i % 3 === 0 ? light : mixHex(base, dark, 0.35);
    contexts.color.lineWidth = i % 4 === 0 ? 2 : 1;
    contexts.color.beginPath();
    contexts.color.moveTo(x + px, y + py);
    contexts.color.quadraticCurveTo(x + px + sway, y + py - height * 0.55, x + px + sway * 0.4, y + py - height);
    contexts.color.stroke();

    if (i % 5 === 0) {
      contexts.bump.strokeStyle = 'rgb(178, 178, 178)';
      contexts.bump.lineWidth = 1;
      contexts.bump.beginPath();
      contexts.bump.moveTo(x + px, y + py);
      contexts.bump.quadraticCurveTo(x + px + sway, y + py - height * 0.5, x + px + sway * 0.35, y + py - height);
      contexts.bump.stroke();
    }
  }

  withAlpha(contexts.color, 0.42, () => {
    contexts.color.fillStyle = mixHex(light, '#ffffff', 0.24);
    for (let i = 0; i < 18; i++) {
      const px = x + 10 + hash2(i, 83, 0x61f07) * (TILE_SIZE - 20);
      const py = y + 10 + hash2(i, 89, 0x61f07) * (TILE_SIZE - 20);
      contexts.color.beginPath();
      contexts.color.ellipse(px, py, 3 + hash2(i, 97, 0x61f07) * 5, 1.2, hash2(i, 101, 0x61f07) * Math.PI, 0, Math.PI * 2);
      contexts.color.fill();
    }
  });

  withAlpha(contexts.color, 0.72, () => {
    const flowerPalette = theme.id === 'crystal'
      ? ['#f0b3ff', '#ffd5fa', '#fff0a8']
      : theme.id === 'frost'
        ? ['#f4fdff', '#bdf4ff', '#d7fff0']
        : ['#fff5a8', '#ff8fb3', '#d9f99d'];

    for (let i = 0; i < 9; i++) {
      const px = x + 12 + hash2(i, 107, 0xf10a7) * (TILE_SIZE - 24);
      const py = y + 12 + hash2(i, 109, 0xf10a7) * (TILE_SIZE - 24);
      contexts.color.fillStyle = flowerPalette[i % flowerPalette.length];
      contexts.color.fillRect(px, py, 3, 3);
      contexts.color.fillRect(px + 2, py - 2, 2, 2);
      contexts.color.fillStyle = mixHex(base, '#ffffff', 0.18);
      contexts.color.fillRect(px + 1, py + 3, 1, 4);
    }
  });

  if (theme.id === 'frost') {
    paintSpeckles(contexts.color, tile, ['#e9fbff', '#bcecff'], 38, 0xf2057, 1, 2);
  }

  paintTileEdgePixelFrame(contexts, tile, mixHex(light, '#ffffff', 0.18), mixHex(dark, '#000000', 0.16), 3);
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
    const grassDepth = Math.floor(TILE_SIZE * (0.18 + noise * 0.18));
    contexts.color.fillStyle = px % 5 === 0 ? shadeHex(grass, 34) : grass;
    contexts.color.fillRect(x + px, y, 1, grassDepth);
    contexts.bump.fillStyle = 'rgb(172, 172, 172)';
    contexts.bump.fillRect(x + px, y, 1, grassDepth);

    if (px % 4 === 0) {
      contexts.color.fillStyle = rootColor;
      contexts.color.fillRect(x + px, y + grassDepth, 1, Math.floor(TILE_SIZE * (0.18 + noise * 0.12)));
    }
  }

  contexts.color.fillStyle = shadeHex(grass, 34);
  contexts.color.fillRect(x, y, TILE_SIZE, 4);
  paintPackPixelClusters(
    contexts,
    tile,
    [mixHex(dirt, grass, 0.18), shadeHex(dirt, 20), shadeHex(dirt, -28), mixHex(grass, '#d9f99d', 0.16)],
    0x651de,
    32,
    3,
    9,
    0.3
  );

  withAlpha(contexts.color, 0.48, () => {
    contexts.color.strokeStyle = mixHex(rootColor, '#ead7bd', 0.12);
    contexts.color.lineWidth = 1;
    for (let i = 0; i < 34; i++) {
      const sx = x + hash2(i, 131, 0x7007) * TILE_SIZE;
      const sy = y + TILE_SIZE * (0.28 + hash2(i, 137, 0x7007) * 0.24);
      const length = TILE_SIZE * (0.12 + hash2(i, 139, 0x7007) * 0.16);
      strokeJitterLine(contexts.color, sx, sy, sx + (hash2(i, 149, 0x7007) - 0.5) * 16, sy + length, 0x7007 ^ i, 3);
    }
  });

  paintSpeckles(contexts.color, tile, [shadeHex(dirt, -22), shadeHex(dirt, 18), mixHex(dirt, grass, 0.24)], 74, 0x501de, 1, 3);
  paintTileEdgePixelFrame(contexts, tile, mixHex(grass, '#ffffff', 0.14), shadeHex(dirt, -48), 3);
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
  paintSpeckles(contexts.color, tile, [shadeHex(base, 30), shadeHex(base, -32), mixHex(base, '#d9bd91', 0.18)], 98, 0xd1275, 1, 3);
  paintPackPixelClusters(
    contexts,
    tile,
    [shadeHex(base, 34), shadeHex(base, -34), mixHex(base, '#e0bd80', 0.2), mixHex(base, '#5a3019', 0.28)],
    0xd17c1,
    42,
    3,
    10,
    0.34
  );

  for (let i = 0; i < 14; i++) {
    const py = Math.floor(((i + 1) * TILE_SIZE) / 15 + (hash2(i, 3, 0x5011) - 0.5) * 5);
    contexts.color.strokeStyle = i % 2 === 0 ? shadeHex(base, -28) : shadeHex(base, 18);
    contexts.color.lineWidth = 1 + (i % 3 === 0 ? 1 : 0);
    contexts.color.beginPath();
    contexts.color.moveTo(x + 3, y + py);
    contexts.color.bezierCurveTo(x + TILE_SIZE * 0.3, y + py - 4, x + TILE_SIZE * 0.65, y + py + 5, x + TILE_SIZE - 3, y + py);
    contexts.color.stroke();
  }

  for (let i = 0; i < 18; i++) {
    const px = x + 8 + hash2(i, 5, 0xd15011) * (TILE_SIZE - 16);
    const py = y + 8 + hash2(i, 7, 0xd15011) * (TILE_SIZE - 16);
    const radius = 1.4 + hash2(i, 11, 0xd15011) * 3.8;
    contexts.color.fillStyle = i % 2 === 0 ? shadeHex(base, -38) : shadeHex(base, 28);
    contexts.color.beginPath();
    contexts.color.ellipse(px, py, radius, radius * (0.62 + hash2(i, 13, 0xd15011) * 0.34), hash2(i, 17, 0xd15011) * Math.PI, 0, Math.PI * 2);
    contexts.color.fill();

    contexts.bump.fillStyle = i % 2 === 0 ? 'rgb(82, 82, 82)' : 'rgb(188, 188, 188)';
    contexts.bump.beginPath();
    contexts.bump.ellipse(px, py, radius, radius * 0.72, 0, 0, Math.PI * 2);
    contexts.bump.fill();
  }

  withAlpha(contexts.color, 0.38, () => {
    contexts.color.strokeStyle = mixHex(base, '#f4d4a1', 0.2);
    contexts.color.lineWidth = 1;
    for (let i = 0; i < 22; i++) {
      const sx = x + 10 + hash2(i, 61, 0x8007) * (TILE_SIZE - 20);
      const sy = y + 10 + hash2(i, 67, 0x8007) * (TILE_SIZE - 20);
      strokeJitterLine(contexts.color, sx, sy, sx + (hash2(i, 71, 0x8007) - 0.5) * 28, sy + 8 + hash2(i, 73, 0x8007) * 16, 0x8007 ^ i, 3);
    }
  });

  paintTileEdgePixelFrame(contexts, tile, shadeHex(base, 24), shadeHex(base, -52), 3);
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
  paintSpeckles(contexts.color, tile, [shadeHex(base, 42), shadeHex(base, -48), mixHex(base, accent, 0.28)], 70, 0x5700e, 1, 3);
  paintPackPixelClusters(
    contexts,
    tile,
    [shadeHex(base, 36), shadeHex(base, -44), mixHex(base, accent, 0.18), mixHex(base, '#cbd5e1', 0.12)],
    0x570c1,
    38,
    4,
    12,
    0.32
  );

  contexts.color.strokeStyle = shadeHex(base, -54);
  contexts.color.lineWidth = 2;
  for (let i = 0; i < 11; i++) {
    const sx = x + 8 + hash2(i, 1, 0x5afe) * (TILE_SIZE - 16);
    const sy = y + 8 + hash2(i, 2, 0x5afe) * (TILE_SIZE - 16);
    contexts.color.beginPath();
    contexts.color.moveTo(sx, sy);
    contexts.color.lineTo(sx + (hash2(i, 3, 0x5afe) - 0.5) * 26, sy + 8 + hash2(i, 4, 0x5afe) * 16);
    contexts.color.lineTo(sx + 8 + hash2(i, 5, 0x5afe) * 24, sy + (hash2(i, 6, 0x5afe) - 0.5) * 18);
    contexts.color.stroke();
  }
  paintCracks(contexts, tile, shadeHex(base, -62), 0x5705e, 8);

  contexts.color.fillStyle = mixHex(accent, '#ffffff', 0.2);
  withAlpha(contexts.color, 0.22, () => {
    contexts.color.fillRect(x + 14, y + 18, 18, 4);
    contexts.color.fillRect(x + TILE_SIZE - 44, y + TILE_SIZE - 36, 24, 4);
    contexts.color.fillRect(x + TILE_SIZE * 0.46, y + TILE_SIZE * 0.22, 12, 3);
  });

  withAlpha(contexts.color, 0.36, () => {
    contexts.color.strokeStyle = mixHex(accent, '#ffffff', 0.3);
    contexts.color.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const sx = x + 18 + hash2(i, 91, 0x0ee1) * 84;
      const sy = y + 18 + hash2(i, 93, 0x0ee1) * 84;
      strokeJitterLine(contexts.color, sx, sy, sx + 18 + hash2(i, 97, 0x0ee1) * 28, sy + (hash2(i, 101, 0x0ee1) - 0.5) * 18, 0x0ee1 ^ i, 4);
    }
  });

  paintInsetBevel(contexts, tile, shadeHex(base, 22), shadeHex(base, -58), 5, 2);
  paintTileEdgePixelFrame(contexts, tile, mixHex(base, '#ffffff', 0.15), shadeHex(base, -64), 3);
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
  paintPackPixelClusters(
    contexts,
    tile,
    [mixHex(cold, '#ffffff', 0.18), mixHex(cold, accent, 0.16), shadeHex(base, -44), shadeHex(cold, 26)],
    0x4e7ac,
    24,
    5,
    15,
    0.2
  );
  strokePanelLines(contexts.color, tile, shadeHex(base, -62), 4);
  strokePanelLines(contexts.bump, tile, 'rgb(188, 188, 188)', 4);
  paintInsetBevel(contexts, tile, shadeHex(cold, 34), shadeHex(base, -70), 6, 2);

  withAlpha(contexts.color, 0.34, () => {
    contexts.color.strokeStyle = mixHex(accent, '#ffffff', 0.18);
    contexts.color.lineWidth = 2;

    for (let i = -TILE_SIZE; i < TILE_SIZE * 2; i += 18) {
      contexts.color.beginPath();
      contexts.color.moveTo(x + i, y + TILE_SIZE);
      contexts.color.lineTo(x + i + TILE_SIZE, y);
      contexts.color.stroke();
    }
  });

  contexts.color.strokeStyle = shadeHex(base, -72);
  contexts.color.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    const yy = y + 18 + i * 22;
    contexts.color.beginPath();
    contexts.color.moveTo(x + 10, yy);
    contexts.color.lineTo(x + TILE_SIZE - 10, yy + (i % 2 === 0 ? 5 : -5));
    contexts.color.stroke();
  }

  const rivetColor = mixHex(cold, '#ffffff', 0.22);
  for (let i = 0; i < 8; i++) {
    const px = x + (i % 2 === 0 ? 15 : TILE_SIZE - 15);
    const py = y + 15 + Math.floor(i / 2) * 32;

    contexts.color.fillStyle = shadeHex(base, -50);
    contexts.color.beginPath();
    contexts.color.arc(px + 1, py + 1, 4.5, 0, Math.PI * 2);
    contexts.color.fill();
    contexts.color.fillStyle = rivetColor;
    contexts.color.beginPath();
    contexts.color.arc(px, py, 3.4, 0, Math.PI * 2);
    contexts.color.fill();

    contexts.bump.fillStyle = 'rgb(228, 228, 228)';
    contexts.bump.beginPath();
    contexts.bump.arc(px, py, 4, 0, Math.PI * 2);
    contexts.bump.fill();
  }

  paintMicroScratches(contexts, tile, mixHex(cold, '#ffffff', 0.55), 0x5c4a7, 28, 0.24);
  paintCircuitTraces(contexts, tile, mixHex(accent, '#ffffff', 0.28), 0xc15c, 5);
  contexts.color.fillStyle = mixHex(accent, '#ffffff', 0.32);
  contexts.color.fillRect(x + 14, y + 13, 16, 4);
  contexts.color.fillRect(x + TILE_SIZE - 30, y + TILE_SIZE - 17, 16, 4);

  contexts.emissive.fillStyle = mixHex(accent, '#ffffff', 0.18);
  contexts.emissive.fillRect(x + 14, y + 13, 16, 4);
  contexts.emissive.fillRect(x + TILE_SIZE - 30, y + TILE_SIZE - 17, 16, 4);
}

function paintGlassTile(contexts: AtlasContexts, tile: AtlasTile, base: string, accent: string): void {
  const { x, y } = tileOrigin(tile);
  const bright = mixHex(base, '#ffffff', 0.54);
  const deep = mixHex(base, '#16263c', 0.5);

  paintNoisyColor(contexts.color, tile, base, bright, deep, 0x61a55, 0.58);
  paintUtilityMaps(contexts, tile, {
    bump: 0.5,
    bumpNoise: 0.12,
    roughness: 0.18,
    roughnessNoise: 0.08,
    metalness: 0.02,
    emissive: mixHex(base, '#000000', 0.48),
    aoStrength: 0.1,
    seed: 0x61a55,
  });
  paintTileGlow(contexts.emissive, tile, mixHex(accent, bright, 0.32), 0.42, 4);
  paintPackPixelClusters(
    contexts,
    tile,
    [mixHex(base, '#ffffff', 0.38), mixHex(accent, '#ffffff', 0.34), mixHex(deep, '#000000', 0.2)],
    0x61a771,
    20,
    4,
    13,
    0.22
  );

  withAlpha(contexts.color, 0.2, () => {
    contexts.color.fillStyle = '#ffffff';
    contexts.color.beginPath();
    contexts.color.moveTo(x + 6, y + 14);
    contexts.color.lineTo(x + TILE_SIZE * 0.55, y + 2);
    contexts.color.lineTo(x + TILE_SIZE * 0.18, y + TILE_SIZE - 8);
    contexts.color.closePath();
    contexts.color.fill();

    contexts.color.fillStyle = mixHex(accent, '#ffffff', 0.32);
    contexts.color.beginPath();
    contexts.color.moveTo(x + TILE_SIZE - 8, y + 10);
    contexts.color.lineTo(x + TILE_SIZE * 0.5, y + TILE_SIZE * 0.62);
    contexts.color.lineTo(x + TILE_SIZE - 18, y + TILE_SIZE - 12);
    contexts.color.closePath();
    contexts.color.fill();
  });

  for (let i = -TILE_SIZE; i < TILE_SIZE * 2; i += 25) {
    contexts.color.strokeStyle = i % 50 === 0 ? bright : mixHex(accent, bright, 0.35);
    contexts.color.lineWidth = i % 50 === 0 ? 3 : 1;
    contexts.color.beginPath();
    contexts.color.moveTo(x + i, y + TILE_SIZE);
    contexts.color.lineTo(x + i + TILE_SIZE, y);
    contexts.color.stroke();
  }

  contexts.color.strokeStyle = mixHex(bright, '#ffffff', 0.32);
  contexts.color.lineWidth = 2;
  contexts.color.beginPath();
  contexts.color.moveTo(x + 18, y + 14);
  contexts.color.lineTo(x + 54, y + 44);
  contexts.color.lineTo(x + 31, y + 93);
  contexts.color.lineTo(x + 103, y + 114);
  contexts.color.stroke();

  contexts.bump.strokeStyle = 'rgb(218, 218, 218)';
  contexts.bump.lineWidth = 2;
  contexts.bump.beginPath();
  contexts.bump.moveTo(x + 18, y + 14);
  contexts.bump.lineTo(x + 54, y + 44);
  contexts.bump.lineTo(x + 31, y + 93);
  contexts.bump.lineTo(x + 103, y + 114);
  contexts.bump.stroke();
  paintInsetBevel(contexts, tile, mixHex(bright, '#ffffff', 0.26), mixHex(deep, '#000000', 0.28), 5, 2);

  withAlpha(contexts.color, 0.48, () => {
    contexts.color.fillStyle = '#ffffff';
    contexts.color.fillRect(x + 18, y + 16, 22, 3);
    contexts.color.fillRect(x + 18, y + 16, 3, 22);
    contexts.color.fillStyle = mixHex(accent, '#ffffff', 0.45);
    contexts.color.fillRect(x + TILE_SIZE - 42, y + TILE_SIZE - 26, 24, 3);
  });
}

function paintNeonTile(contexts: AtlasContexts, tile: AtlasTile, base: string, glow: string, seed: number): void {
  const { x, y } = tileOrigin(tile);

  paintNoisyColor(contexts.color, tile, base, shadeHex(base, 18), shadeHex(base, -36), seed, 0.34);
  paintUtilityMaps(contexts, tile, {
    bump: 0.47,
    bumpNoise: 0.08,
    roughness: 0.26,
    roughnessNoise: 0.08,
    metalness: 0.58,
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
    TILE_SIZE * 0.62
  );
  gradient.addColorStop(0, mixHex(glow, '#ffffff', 0.58));
  gradient.addColorStop(0.35, glow);
  gradient.addColorStop(0.72, mixHex(glow, base, 0.58));
  gradient.addColorStop(1, base);
  contexts.color.fillStyle = gradient;
  contexts.color.fillRect(x + 11, y + 11, TILE_SIZE - 22, TILE_SIZE - 22);

  fillTile(contexts.emissive, tile, '#000000');
  paintTileGlow(contexts.emissive, tile, glow, 0.82, 6);

  contexts.color.strokeStyle = mixHex(glow, '#ffffff', 0.62);
  contexts.color.lineWidth = 5;
  contexts.color.strokeRect(x + 11, y + 11, TILE_SIZE - 22, TILE_SIZE - 22);
  contexts.color.lineWidth = 2;
  contexts.color.strokeRect(x + 25, y + 25, TILE_SIZE - 50, TILE_SIZE - 50);

  contexts.emissive.strokeStyle = glow;
  contexts.emissive.lineWidth = 5;
  contexts.emissive.strokeRect(x + 11, y + 11, TILE_SIZE - 22, TILE_SIZE - 22);
  contexts.emissive.lineWidth = 2;
  contexts.emissive.strokeRect(x + 25, y + 25, TILE_SIZE - 50, TILE_SIZE - 50);

  paintCircuitTraces(contexts, tile, mixHex(glow, '#ffffff', 0.3), seed ^ 0x9e3, 8);

  contexts.color.strokeStyle = mixHex(glow, '#ffffff', 0.72);
  contexts.color.lineWidth = 3;
  contexts.color.beginPath();
  contexts.color.moveTo(x + TILE_SIZE * 0.3, y + TILE_SIZE * 0.36);
  contexts.color.lineTo(x + TILE_SIZE * 0.5, y + TILE_SIZE * 0.24);
  contexts.color.lineTo(x + TILE_SIZE * 0.7, y + TILE_SIZE * 0.36);
  contexts.color.lineTo(x + TILE_SIZE * 0.58, y + TILE_SIZE * 0.7);
  contexts.color.lineTo(x + TILE_SIZE * 0.42, y + TILE_SIZE * 0.7);
  contexts.color.closePath();
  contexts.color.stroke();

  contexts.emissive.strokeStyle = glow;
  contexts.emissive.lineWidth = 3;
  contexts.emissive.beginPath();
  contexts.emissive.moveTo(x + TILE_SIZE * 0.3, y + TILE_SIZE * 0.36);
  contexts.emissive.lineTo(x + TILE_SIZE * 0.5, y + TILE_SIZE * 0.24);
  contexts.emissive.lineTo(x + TILE_SIZE * 0.7, y + TILE_SIZE * 0.36);
  contexts.emissive.lineTo(x + TILE_SIZE * 0.58, y + TILE_SIZE * 0.7);
  contexts.emissive.lineTo(x + TILE_SIZE * 0.42, y + TILE_SIZE * 0.7);
  contexts.emissive.closePath();
  contexts.emissive.stroke();

  withAlpha(contexts.color, 0.5, () => {
    contexts.color.fillStyle = mixHex(glow, '#ffffff', 0.66);
    contexts.emissive.fillStyle = glow;
    for (let i = 0; i < 9; i++) {
      const px = x + 21 + hash2(i, 139, seed) * (TILE_SIZE - 42);
      const py = y + 21 + hash2(i, 149, seed) * (TILE_SIZE - 42);
      contexts.color.fillRect(px, py, 7, 2);
      contexts.color.fillRect(px + 2, py - 2, 2, 6);
      contexts.emissive.fillRect(px, py, 7, 2);
      contexts.emissive.fillRect(px + 2, py - 2, 2, 6);
    }
  });
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
  contexts.color.fillRect(x + 12, y + 12, TILE_SIZE - 24, TILE_SIZE - 24);
  paintTileGlow(contexts.color, tile, mixHex(accent, '#ffffff', 0.16), 0.2, 14);
  paintTileGlow(contexts.emissive, tile, accent, 0.54, 18);
  paintInsetBevel(contexts, tile, mixHex(accent, '#ffffff', 0.18), shadeHex(base, -54), 8, 2);

  contexts.color.strokeStyle = accent;
  contexts.color.lineWidth = 3;
  contexts.color.strokeRect(x + 14, y + 14, TILE_SIZE - 28, TILE_SIZE - 28);
  contexts.bump.strokeStyle = 'rgb(218, 218, 218)';
  contexts.bump.lineWidth = 3;
  contexts.bump.strokeRect(x + 14, y + 14, TILE_SIZE - 28, TILE_SIZE - 28);
  contexts.emissive.strokeStyle = accent;
  contexts.emissive.lineWidth = 3;
  contexts.emissive.strokeRect(x + 14, y + 14, TILE_SIZE - 28, TILE_SIZE - 28);

  for (let i = 18; i < TILE_SIZE - 16; i += 13) {
    contexts.color.strokeStyle = (i - 18) % 26 === 0 ? accent : secondary;
    contexts.color.lineWidth = 2;
    contexts.color.beginPath();
    contexts.color.moveTo(x + i, y + 18);
    contexts.color.lineTo(x + i + 10, y + TILE_SIZE - 18);
    contexts.color.stroke();

    contexts.emissive.strokeStyle = (i - 18) % 26 === 0 ? accent : secondary;
    contexts.emissive.lineWidth = 2;
    contexts.emissive.beginPath();
    contexts.emissive.moveTo(x + i, y + 18);
    contexts.emissive.lineTo(x + i + 10, y + TILE_SIZE - 18);
    contexts.emissive.stroke();
  }

  contexts.color.strokeStyle = mixHex(accent, '#ffffff', 0.55);
  contexts.color.lineWidth = 4;
  contexts.color.beginPath();
  contexts.color.moveTo(x + TILE_SIZE / 2, y + 27);
  contexts.color.lineTo(x + TILE_SIZE - 27, y + TILE_SIZE / 2);
  contexts.color.lineTo(x + TILE_SIZE / 2, y + TILE_SIZE - 27);
  contexts.color.lineTo(x + 27, y + TILE_SIZE / 2);
  contexts.color.closePath();
  contexts.color.stroke();

  contexts.emissive.strokeStyle = accent;
  contexts.emissive.lineWidth = 4;
  contexts.emissive.beginPath();
  contexts.emissive.moveTo(x + TILE_SIZE / 2, y + 27);
  contexts.emissive.lineTo(x + TILE_SIZE - 27, y + TILE_SIZE / 2);
  contexts.emissive.lineTo(x + TILE_SIZE / 2, y + TILE_SIZE - 27);
  contexts.emissive.lineTo(x + 27, y + TILE_SIZE / 2);
  contexts.emissive.closePath();
  contexts.emissive.stroke();

  contexts.color.strokeStyle = secondary;
  contexts.color.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI * 0.5 + Math.PI * 0.25;
    const sx = x + TILE_SIZE / 2 + Math.cos(angle) * 18;
    const sy = y + TILE_SIZE / 2 + Math.sin(angle) * 18;
    const ex = x + TILE_SIZE / 2 + Math.cos(angle) * 38;
    const ey = y + TILE_SIZE / 2 + Math.sin(angle) * 38;
    contexts.color.beginPath();
    contexts.color.moveTo(sx, sy);
    contexts.color.lineTo(ex, ey);
    contexts.color.stroke();
  }
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
  paintInsetBevel(contexts, tile, shadeHex(base, 24), shadeHex(base, -58), 5, 3);
  paintPackPixelClusters(
    contexts,
    tile,
    [shadeHex(base, 22), mixHex(base, accent, 0.22), shadeHex(base, -34)],
    0xba8c1,
    22,
    5,
    14,
    0.22
  );

  for (let i = -TILE_SIZE; i < TILE_SIZE * 2; i += 22) {
    const stripe = i % 44 === 0 ? mixHex(accent, '#ffffff', 0.1) : mixHex(accent, '#000000', 0.34);
    contexts.color.strokeStyle = stripe;
    contexts.color.lineWidth = 7;
    contexts.color.beginPath();
    contexts.color.moveTo(x + i, y + TILE_SIZE);
    contexts.color.lineTo(x + i + TILE_SIZE, y);
    contexts.color.stroke();

    contexts.bump.strokeStyle = i % 44 === 0 ? 'rgb(194, 194, 194)' : 'rgb(88, 88, 88)';
    contexts.bump.lineWidth = 5;
    contexts.bump.beginPath();
    contexts.bump.moveTo(x + i, y + TILE_SIZE);
    contexts.bump.lineTo(x + i + TILE_SIZE, y);
    contexts.bump.stroke();
  }

  withAlpha(contexts.color, 0.34, () => {
    contexts.color.fillStyle = '#000000';
    for (let i = 0; i < 5; i++) {
      contexts.color.fillRect(x + 16 + i * 23, y + 17, 10, 5);
      contexts.color.fillRect(x + 12 + i * 23, y + TILE_SIZE - 22, 10, 5);
    }
  });

  contexts.emissive.strokeStyle = mixHex(accent, '#ffffff', 0.22);
  contexts.emissive.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const yy = y + 31 + i * 31;
    contexts.emissive.beginPath();
    contexts.emissive.moveTo(x + 16, yy);
    contexts.emissive.lineTo(x + TILE_SIZE - 16, yy);
    contexts.emissive.stroke();
  }
  paintMicroScratches(contexts, tile, shadeHex(base, 36), 0xba881e, 18, 0.22);
  contexts.emissive.fillStyle = mixHex(accent, '#ffffff', 0.24);
  contexts.emissive.fillRect(x + 18, y + 18, 10, 4);
  contexts.emissive.fillRect(x + TILE_SIZE - 30, y + TILE_SIZE - 24, 12, 4);
}

function paintWoodTile(contexts: AtlasContexts, tile: AtlasTile): void {
  const { x, y } = tileOrigin(tile);
  const base = '#7b4a27';

  paintNoisyColor(contexts.color, tile, base, '#bd7847', '#432412', 0x600d, 0.66);
  paintUtilityMaps(contexts, tile, {
    bump: 0.5,
    bumpNoise: 0.26,
    roughness: 0.92,
    roughnessNoise: 0.05,
    metalness: 0,
    aoStrength: 0.24,
    seed: 0x600d,
  });
  paintSpeckles(contexts.color, tile, ['#c88b55', '#5a3019', '#8d5731'], 52, 0x600d3, 1, 2);
  paintPackPixelClusters(
    contexts,
    tile,
    ['#c88650', '#60321a', '#9f6336', '#e0a168'],
    0x600d9,
    26,
    4,
    13,
    0.24
  );

  for (let px = 4; px < TILE_SIZE; px += 9) {
    contexts.color.strokeStyle = px % 18 === 4 ? '#4f2c17' : '#a8663d';
    contexts.color.lineWidth = 2;
    contexts.color.beginPath();
    contexts.color.moveTo(x + px, y);
    contexts.color.bezierCurveTo(x + px - 6, y + TILE_SIZE * 0.28, x + px + 7, y + TILE_SIZE * 0.62, x + px - 2, y + TILE_SIZE);
    contexts.color.stroke();

    contexts.bump.strokeStyle = px % 18 === 4 ? 'rgb(74, 74, 74)' : 'rgb(178, 178, 178)';
    contexts.bump.lineWidth = 1;
    contexts.bump.beginPath();
    contexts.bump.moveTo(x + px, y);
    contexts.bump.bezierCurveTo(x + px - 6, y + TILE_SIZE * 0.28, x + px + 7, y + TILE_SIZE * 0.62, x + px - 2, y + TILE_SIZE);
    contexts.bump.stroke();
  }

  contexts.color.strokeStyle = '#3f2617';
  contexts.color.lineWidth = 2;
  for (let py = 16; py < TILE_SIZE; py += 28) {
    contexts.color.beginPath();
    contexts.color.moveTo(x + 9, y + py);
    contexts.color.bezierCurveTo(x + 32, y + py - 9, x + 76, y + py + 12, x + TILE_SIZE - 12, y + py - 2);
    contexts.color.stroke();
  }

  for (let i = 0; i < 3; i++) {
    const cx = x + 30 + hash2(i, 5, 0x60a7) * 68;
    const cy = y + 25 + hash2(i, 7, 0x60a7) * 78;
    const radius = 7 + hash2(i, 11, 0x60a7) * 6;
    contexts.color.strokeStyle = '#3f2415';
    contexts.color.lineWidth = 2;
    contexts.color.beginPath();
    contexts.color.ellipse(cx, cy, radius, radius * 0.58, hash2(i, 13, 0x60a7) * Math.PI, 0, Math.PI * 2);
    contexts.color.stroke();
    contexts.color.strokeStyle = '#bf7a45';
    contexts.color.lineWidth = 1;
    contexts.color.beginPath();
    contexts.color.ellipse(cx, cy, radius * 0.55, radius * 0.32, hash2(i, 13, 0x60a7) * Math.PI, 0, Math.PI * 2);
    contexts.color.stroke();
  }

  paintInsetBevel(contexts, tile, '#bb7847', '#3d2112', 4, 2);
  paintTileEdgePixelFrame(contexts, tile, '#d0915c', '#36200f', 3);
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

  paintNoisyColor(contexts.color, tile, palette.base, palette.light, palette.dark, 0x1eafe5, 0.82);
  paintUtilityMaps(contexts, tile, {
    bump: 0.57,
    bumpNoise: 0.32,
    roughness: 0.94,
    roughnessNoise: 0.04,
    metalness: 0,
    aoStrength: 0.2,
    seed: 0x1eafe5,
  });
  paintPackPixelClusters(
    contexts,
    tile,
    [palette.light, mixHex(palette.base, palette.light, 0.5), palette.dark, mixHex(palette.base, '#f4f1a3', 0.16)],
    0x1ea7c1,
    46,
    4,
    12,
    0.34
  );

  withAlpha(contexts.color, 0.42, () => {
    contexts.color.fillStyle = '#000000';
    for (let i = 0; i < 36; i++) {
      const px = x + hash2(i, 17, 0x1ea0) * TILE_SIZE;
      const py = y + hash2(i, 19, 0x1ea0) * TILE_SIZE;
      contexts.color.beginPath();
      contexts.color.ellipse(px, py, 6 + hash2(i, 23, 0x1ea0) * 7, 3 + hash2(i, 29, 0x1ea0) * 4, hash2(i, 31, 0x1ea0) * Math.PI, 0, Math.PI * 2);
      contexts.color.fill();
    }
  });

  for (let i = 0; i < 76; i++) {
    const px = x + hash2(i, 19, 0x7ea) * TILE_SIZE;
    const py = y + hash2(i, 23, 0x7ea) * TILE_SIZE;
    const rotation = hash2(i, 37, 0x7ea) * Math.PI;
    const width = 3 + hash2(i, 29, 0x7ea) * 7;
    const height = 2 + hash2(i, 31, 0x7ea) * 5;
    contexts.color.fillStyle = i % 4 === 0 ? palette.light : i % 3 === 0 ? mixHex(palette.base, palette.light, 0.42) : palette.dark;
    contexts.color.beginPath();
    contexts.color.ellipse(px, py, width, height, rotation, 0, Math.PI * 2);
    contexts.color.fill();

    if (i % 3 === 0) {
      contexts.color.strokeStyle = mixHex(palette.light, '#ffffff', 0.18);
      contexts.color.lineWidth = 1;
      contexts.color.beginPath();
      contexts.color.moveTo(px - Math.cos(rotation) * width * 0.6, py - Math.sin(rotation) * width * 0.6);
      contexts.color.lineTo(px + Math.cos(rotation) * width * 0.6, py + Math.sin(rotation) * width * 0.6);
      contexts.color.stroke();
    }

    contexts.bump.fillStyle = i % 4 === 0 ? 'rgb(198, 198, 198)' : 'rgb(146, 146, 146)';
    contexts.bump.beginPath();
    contexts.bump.ellipse(px, py, width, height, rotation, 0, Math.PI * 2);
    contexts.bump.fill();
  }

  paintTileEdgePixelFrame(contexts, tile, mixHex(palette.light, '#ffffff', 0.16), mixHex(palette.dark, '#000000', 0.12), 3);
}

function paintCactusTile(contexts: AtlasContexts, tile: AtlasTile): void {
  const { x, y } = tileOrigin(tile);
  const base = '#3f8f4a';
  const light = '#8bd06d';
  const dark = '#1f5631';

  paintNoisyColor(contexts.color, tile, base, light, dark, 0xcac705, 0.54);
  paintUtilityMaps(contexts, tile, {
    bump: 0.56,
    bumpNoise: 0.2,
    roughness: 0.82,
    roughnessNoise: 0.06,
    metalness: 0,
    aoStrength: 0.18,
    seed: 0xcac705,
  });
  paintPackPixelClusters(
    contexts,
    tile,
    [light, mixHex(base, light, 0.42), dark],
    0xcaca77,
    20,
    4,
    10,
    0.26
  );

  for (let px = 8; px < TILE_SIZE; px += 14) {
    contexts.color.fillStyle = px % 28 === 8 ? dark : light;
    contexts.color.fillRect(x + px, y, 3, TILE_SIZE);
    contexts.bump.fillStyle = px % 28 === 8 ? 'rgb(76, 76, 76)' : 'rgb(198, 198, 198)';
    contexts.bump.fillRect(x + px, y, 3, TILE_SIZE);
  }

  contexts.color.fillStyle = '#edf8c9';
  for (let py = 10; py < TILE_SIZE; py += 11) {
    contexts.color.fillRect(x + 18, y + py, 4, 1);
    contexts.color.fillRect(x + 62, y + py + 6, 4, 1);
    contexts.color.fillRect(x + 101, y + py + 3, 4, 1);
  }

  withAlpha(contexts.color, 0.64, () => {
    contexts.color.strokeStyle = '#f6ffe3';
    contexts.color.lineWidth = 1;
    for (let i = 0; i < 42; i++) {
      const sx = x + 10 + hash2(i, 43, 0xcac705) * (TILE_SIZE - 20);
      const sy = y + 8 + hash2(i, 47, 0xcac705) * (TILE_SIZE - 16);
      contexts.color.beginPath();
      contexts.color.moveTo(sx, sy);
      contexts.color.lineTo(sx + (hash2(i, 53, 0xcac705) - 0.5) * 8, sy - 1 - hash2(i, 59, 0xcac705) * 5);
      contexts.color.stroke();
    }
  });

  contexts.color.fillStyle = '#ff78a3';
  for (let i = 0; i < 4; i++) {
    const px = x + 24 + hash2(i, 67, 0xcac705) * 80;
    const py = y + 14 + hash2(i, 71, 0xcac705) * 34;
    contexts.color.beginPath();
    contexts.color.arc(px, py, 2.5, 0, Math.PI * 2);
    contexts.color.fill();
  }

  paintTileEdgePixelFrame(contexts, tile, mixHex(light, '#ffffff', 0.16), mixHex(dark, '#000000', 0.14), 3);
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
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;

  return texture;
}

export function createVoxelAtlasTextures(theme: VoxelMapTheme): VoxelAtlasTextures {
  const cached = atlasTextureCache.get(theme.id);
  if (cached) return cached;

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

  const textures = {
    color: createTexture(color.canvas, THREE.SRGBColorSpace),
    bump: createTexture(bump.canvas, THREE.NoColorSpace),
    roughness: createTexture(roughness.canvas, THREE.NoColorSpace),
    metalness: createTexture(metalness.canvas, THREE.NoColorSpace),
    emissive: createTexture(emissive.canvas, THREE.SRGBColorSpace),
    ao: createTexture(ao.canvas, THREE.NoColorSpace),
  };

  atlasTextureCache.set(theme.id, textures);
  return textures;
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
