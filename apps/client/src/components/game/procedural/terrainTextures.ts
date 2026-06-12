import * as THREE from 'three';
import type { VoxelBlockId, VoxelMapTheme } from '@voxel-strike/shared';

export const TERRAIN_TEXTURE_COLUMNS = 6;
export const TERRAIN_TEXTURE_ROWS = 5;
export const TERRAIN_TEXTURE_LAYER_COUNT = TERRAIN_TEXTURE_COLUMNS * TERRAIN_TEXTURE_ROWS;
export const DEFAULT_TILE_SIZE = 128;
export const MEDIUM_DETAIL_TILE_SIZE = 80;
export const LOW_DETAIL_TILE_SIZE = 64;
export let TILE_SIZE = DEFAULT_TILE_SIZE;

export type VoxelFaceDirection = 'top' | 'bottom' | 'side';

export interface TerrainTextureTile {
  x: number;
  y: number;
  layer: number;
}

export interface VoxelTerrainTextures {
  color: THREE.DataArrayTexture;
  emissive: THREE.DataArrayTexture;
  tileSize: number;
  layerCount: number;
  anisotropy: number;
}

interface TerrainTexturePaintContexts {
  color: CanvasRenderingContext2D;
  emissive: CanvasRenderingContext2D;
}

export type VoxelTerrainTextureDetail = 'low' | 'medium' | 'high';

interface VoxelTerrainTextureOptions {
  detail?: VoxelTerrainTextureDetail;
}

const terrainTextureCache = new Map<string, VoxelTerrainTextures>();

function textureTile(x: number, y: number): TerrainTextureTile {
  return {
    x,
    y,
    layer: y * TERRAIN_TEXTURE_COLUMNS + x,
  };
}

const TILE_MAP: Record<string, TerrainTextureTile> = {
  grass_top: textureTile(0, 0),
  grass_side: textureTile(1, 0),
  dirt: textureTile(2, 0),
  stone: textureTile(3, 0),
  sand: textureTile(4, 0),
  snow: textureTile(5, 0),
  metal: textureTile(0, 1),
  glass: textureTile(1, 1),
  neon_red: textureTile(2, 1),
  neon_blue: textureTile(3, 1),
  ice: textureTile(4, 1),
  obsidian: textureTile(5, 1),
  spawn_pad: textureTile(0, 2),
  flag_pad: textureTile(1, 2),
  barrier: textureTile(2, 2),
  wood: textureTile(3, 2),
  bamboo: textureTile(4, 2),
  ash: textureTile(5, 2),
  leaves: textureTile(0, 3),
  cactus: textureTile(1, 3),
  spawn_pad_red: textureTile(2, 3),
  spawn_pad_blue: textureTile(3, 3),
  blossom_leaves: textureTile(4, 3),
  moss: textureTile(5, 3),
  lava: textureTile(0, 4),
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

function rgbaHex(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

function tileOrigin(tile: TerrainTextureTile): { x: number; y: number } {
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

function lerp(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function smoothCellNoise(x: number, y: number, cellSize: number, seed: number): number {
  const gridX = x / cellSize;
  const gridY = y / cellSize;
  const cellX = Math.floor(gridX);
  const cellY = Math.floor(gridY);
  const localX = gridX - cellX;
  const localY = gridY - cellY;
  const blendX = localX * localX * (3 - 2 * localX);
  const blendY = localY * localY * (3 - 2 * localY);
  const a = hash2(cellX, cellY, seed);
  const b = hash2(cellX + 1, cellY, seed);
  const c = hash2(cellX, cellY + 1, seed);
  const d = hash2(cellX + 1, cellY + 1, seed);

  return lerp(lerp(a, b, blendX), lerp(c, d, blendX), blendY);
}

function layeredNoise(x: number, y: number, seed: number): number {
  const medium = smoothCellNoise(x, y, 5, seed ^ 0x5f356495);
  const broad = smoothCellNoise(x, y, 16, seed ^ 0x9e3779b9);
  const large = smoothCellNoise(x, y, 42, seed ^ 0x85ebca6b);
  return medium * 0.48 + broad * 0.34 + large * 0.18;
}

function fillTile(context: CanvasRenderingContext2D, tile: TerrainTextureTile, color: string): void {
  const { x, y } = tileOrigin(tile);
  context.fillStyle = color;
  context.fillRect(x, y, TILE_SIZE, TILE_SIZE);
}

function paintNoisyColor(
  context: CanvasRenderingContext2D,
  tile: TerrainTextureTile,
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
  const cellSize = Math.max(6, Math.round(TILE_SIZE / 18));

  context.fillStyle = richBase;
  context.fillRect(x, y, TILE_SIZE, TILE_SIZE);

  for (let py = 0; py < TILE_SIZE; py += cellSize) {
    for (let px = 0; px < TILE_SIZE; px += cellSize) {
      const sampleX = clamp(px + cellSize * 0.5, 0, TILE_SIZE - 1);
      const sampleY = clamp(py + cellSize * 0.5, 0, TILE_SIZE - 1);
      const noise = layeredNoise(sampleX, sampleY, seed);
      const edgeDistance = Math.min(sampleX, sampleY, TILE_SIZE - 1 - sampleX, TILE_SIZE - 1 - sampleY);
      const edgeShade = clamp((10 - edgeDistance) / 10, 0, 1);
      let color = noise > 0.56
        ? mixHex(richBase, richLight, (noise - 0.56) * contrast)
        : mixHex(richBase, richDark, (0.56 - noise) * contrast);

      if (edgeShade > 0) {
        color = mixHex(color, richDark, edgeShade * 0.28);
      }

      context.fillStyle = color;
      context.fillRect(x + px, y + py, Math.min(cellSize, TILE_SIZE - px), Math.min(cellSize, TILE_SIZE - py));
    }
  }
}

function withAlpha(context: CanvasRenderingContext2D, alpha: number, paint: () => void): void {
  context.save();
  context.globalAlpha = alpha;
  paint();
  context.restore();
}

function paintPackPixelClusters(
  contexts: TerrainTexturePaintContexts,
  tile: TerrainTextureTile,
  colors: string[],
  seed: number,
  count: number,
  minSize = 3,
  maxSize = 9,
  alpha = 0.34
): void {
  const { x, y } = tileOrigin(tile);
  const clusterCount = Math.max(1, Math.ceil(count * 0.58));
  const safeMinSize = Math.max(6, minSize);
  const safeMaxSize = Math.max(safeMinSize, maxSize + 3);

  withAlpha(contexts.color, alpha * 0.72, () => {
    for (let i = 0; i < clusterCount; i++) {
      const size = safeMinSize + Math.floor(hash2(i, 7, seed) * (safeMaxSize - safeMinSize + 1));
      const px = x + Math.floor(hash2(i, 11, seed) * Math.max(1, TILE_SIZE - size));
      const py = y + Math.floor(hash2(i, 13, seed) * Math.max(1, TILE_SIZE - size));
      const shade = colors[Math.floor(hash2(i, 17, seed) * colors.length)] ?? colors[0];
      contexts.color.fillStyle = shade;
      contexts.color.fillRect(px, py, size, Math.max(2, Math.floor(size * (0.55 + hash2(i, 19, seed) * 0.55))));
    }
  });

}

function paintTileEdgePixelFrame(
  contexts: TerrainTexturePaintContexts,
  tile: TerrainTextureTile,
  light: string,
  shadow: string,
  inset = 3
): void {
  const { x, y } = tileOrigin(tile);
  const start = Math.max(0, inset);
  const edgeWidth = Math.max(6, Math.round(TILE_SIZE * 0.07));
  const span = Math.max(1, TILE_SIZE - start * 2);
  const maxAlpha = 0.12;

  const top = contexts.color.createLinearGradient(0, y + start, 0, y + start + edgeWidth);
  top.addColorStop(0, rgbaHex(light, maxAlpha));
  top.addColorStop(1, rgbaHex(light, 0));
  contexts.color.fillStyle = top;
  contexts.color.fillRect(x + start, y + start, span, edgeWidth);

  const left = contexts.color.createLinearGradient(x + start, 0, x + start + edgeWidth, 0);
  left.addColorStop(0, rgbaHex(light, maxAlpha * 0.8));
  left.addColorStop(1, rgbaHex(light, 0));
  contexts.color.fillStyle = left;
  contexts.color.fillRect(x + start, y + start, edgeWidth, span);

  const bottom = contexts.color.createLinearGradient(0, y + TILE_SIZE - start, 0, y + TILE_SIZE - start - edgeWidth);
  bottom.addColorStop(0, rgbaHex(shadow, maxAlpha));
  bottom.addColorStop(1, rgbaHex(shadow, 0));
  contexts.color.fillStyle = bottom;
  contexts.color.fillRect(x + start, y + TILE_SIZE - start - edgeWidth, span, edgeWidth);

  const right = contexts.color.createLinearGradient(x + TILE_SIZE - start, 0, x + TILE_SIZE - start - edgeWidth, 0);
  right.addColorStop(0, rgbaHex(shadow, maxAlpha * 0.8));
  right.addColorStop(1, rgbaHex(shadow, 0));
  contexts.color.fillStyle = right;
  contexts.color.fillRect(x + TILE_SIZE - start - edgeWidth, y + start, edgeWidth, span);
}

function paintInsetBevel(
  contexts: TerrainTexturePaintContexts,
  tile: TerrainTextureTile,
  light: string,
  shadow: string,
  inset = 4,
  width = 2
): void {
  const { x, y } = tileOrigin(tile);
  const right = x + TILE_SIZE - inset;
  const bottom = y + TILE_SIZE - inset;

  withAlpha(contexts.color, 0.26, () => {
    contexts.color.lineWidth = Math.max(3, width + 1);
    contexts.color.lineCap = 'round';
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
  });
}

function paintTileGlow(
  context: CanvasRenderingContext2D,
  tile: TerrainTextureTile,
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
  tile: TerrainTextureTile,
  colors: string[],
  count: number,
  seed: number,
  minSize = 1,
  maxSize = 3
): void {
  const { x, y } = tileOrigin(tile);
  const safeCount = Math.max(4, Math.ceil(count * 0.28));
  const safeMinSize = Math.max(4, minSize);
  const safeMaxSize = Math.max(safeMinSize, maxSize + 3);

  withAlpha(context, 0.16, () => {
    for (let i = 0; i < safeCount; i++) {
      const size = safeMinSize + Math.floor(hash2(i, 7, seed) * (safeMaxSize - safeMinSize + 1));
      const px = x + Math.floor(hash2(i, 3, seed) * Math.max(1, TILE_SIZE - size));
      const py = y + Math.floor(hash2(i, 5, seed) * Math.max(1, TILE_SIZE - size));
      context.fillStyle = colors[i % colors.length];
      context.fillRect(px, py, size, size);
    }
  });
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
    const jitter = (hash2(i, segments, seed) - 0.5) * 5;
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
  contexts: TerrainTexturePaintContexts,
  tile: TerrainTextureTile,
  color: string,
  seed: number,
  count = 18,
  alpha = 0.28
): void {
  const { x, y } = tileOrigin(tile);

  const scratchCount = Math.max(2, Math.ceil(count * 0.45));

  withAlpha(contexts.color, alpha * 0.58, () => {
    contexts.color.strokeStyle = color;
    contexts.color.lineWidth = 2.4;
    contexts.color.lineCap = 'round';

    for (let i = 0; i < scratchCount; i++) {
      const sx = x + 8 + hash2(i, 11, seed) * (TILE_SIZE - 16);
      const sy = y + 8 + hash2(i, 13, seed) * (TILE_SIZE - 16);
      const length = 9 + hash2(i, 17, seed) * 20;
      const angle = -0.62 + (hash2(i, 19, seed) - 0.5) * 0.35;
      contexts.color.beginPath();
      contexts.color.moveTo(sx, sy);
      contexts.color.lineTo(sx + Math.cos(angle) * length, sy + Math.sin(angle) * length);
      contexts.color.stroke();
    }
  });

}

function paintCracks(
  contexts: TerrainTexturePaintContexts,
  tile: TerrainTextureTile,
  color: string,
  seed: number,
  count = 6
): void {
  const { x, y } = tileOrigin(tile);
  const crackCount = Math.max(1, Math.min(3, count));

  withAlpha(contexts.color, 0.32, () => {
    contexts.color.strokeStyle = color;
    contexts.color.lineWidth = 3.2;
    contexts.color.lineCap = 'round';

    for (let i = 0; i < crackCount; i++) {
      const sx = x + 10 + hash2(i, 41, seed) * (TILE_SIZE - 20);
      const sy = y + 10 + hash2(i, 43, seed) * (TILE_SIZE - 20);
      const ex = sx + (hash2(i, 47, seed) - 0.5) * 28;
      const ey = sy + (hash2(i, 53, seed) - 0.5) * 28;
      strokeJitterLine(contexts.color, sx, sy, ex, ey, seed ^ i, 3);
    }
  });
}

function paintCircuitTraces(
  contexts: TerrainTexturePaintContexts,
  tile: TerrainTextureTile,
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
  tile: TerrainTextureTile,
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

function paintGrassTop(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile, theme: VoxelMapTheme): void {
  const base = theme.ground.top;
  const light = shadeHex(base, 42);
  const dark = shadeHex(theme.ground.side, -22);
  const { x, y } = tileOrigin(tile);

  paintNoisyColor(contexts.color, tile, base, light, dark, 0x67726173, 0.7);
  fillTile(contexts.emissive, tile, '#000000');
  paintSpeckles(contexts.color, tile, [shadeHex(light, 18), mixHex(base, '#fff6b5', 0.14), shadeHex(dark, -8)], 28, 0x51ad0, 3, 5);
  paintPackPixelClusters(
    contexts,
    tile,
    [mixHex(base, light, 0.42), toneHex(light, 1.18, 1.04), mixHex(base, dark, 0.36), mixHex(base, '#d8f28d', 0.22)],
    0x67a55,
    22,
    7,
    14,
    0.22
  );

  withAlpha(contexts.color, 0.52, () => {
    for (let i = 0; i < 46; i++) {
      const px = Math.floor(hash2(i, 7, 0x17a55) * TILE_SIZE);
      const py = Math.floor(hash2(i, 11, 0x71eaf) * TILE_SIZE);
      const height = 5 + Math.floor(hash2(i, 13, 0xc0fefe) * 13);
      const sway = (hash2(i, 17, 0xba5e) - 0.5) * 7;
      contexts.color.strokeStyle = i % 3 === 0 ? light : mixHex(base, dark, 0.35);
      contexts.color.lineWidth = 2;
      contexts.color.beginPath();
      contexts.color.moveTo(x + px, y + py);
      contexts.color.quadraticCurveTo(x + px + sway, y + py - height * 0.55, x + px + sway * 0.4, y + py - height);
      contexts.color.stroke();
    }
  });

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
    paintSpeckles(contexts.color, tile, ['#e9fbff', '#bcecff'], 16, 0xf2057, 3, 5);
  }

  paintTileEdgePixelFrame(contexts, tile, mixHex(light, '#ffffff', 0.18), mixHex(dark, '#000000', 0.16), 3);
}

function paintGrassSide(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile, grass: string, dirt: string): void {
  const { x, y } = tileOrigin(tile);
  const darkDirt = shadeHex(dirt, -36);
  const rootColor = mixHex(grass, dirt, 0.42);

  paintNoisyColor(contexts.color, tile, dirt, shadeHex(dirt, 28), darkDirt, 0x51de, 0.7);
  fillTile(contexts.emissive, tile, '#000000');

  for (let px = 0; px < TILE_SIZE; px += 3) {
    const noise = layeredNoise(px, 0, 0x6a11);
    const grassDepth = Math.floor(TILE_SIZE * (0.18 + noise * 0.18));
    contexts.color.fillStyle = px % 5 === 0 ? shadeHex(grass, 34) : grass;
    contexts.color.fillRect(x + px, y, 3, grassDepth);

    if (px % 6 === 0) {
      contexts.color.fillStyle = rootColor;
      contexts.color.fillRect(x + px, y + grassDepth, 2, Math.floor(TILE_SIZE * (0.18 + noise * 0.12)));
    }
  }

  contexts.color.fillStyle = shadeHex(grass, 34);
  contexts.color.fillRect(x, y, TILE_SIZE, 4);
  paintPackPixelClusters(
    contexts,
    tile,
    [mixHex(dirt, grass, 0.18), shadeHex(dirt, 20), shadeHex(dirt, -28), mixHex(grass, '#d9f99d', 0.16)],
    0x651de,
    18,
    7,
    14,
    0.2
  );

  withAlpha(contexts.color, 0.18, () => {
    contexts.color.strokeStyle = mixHex(rootColor, '#ead7bd', 0.12);
    contexts.color.lineWidth = 2.6;
    for (let i = 0; i < 8; i++) {
      const sx = x + hash2(i, 131, 0x7007) * TILE_SIZE;
      const sy = y + TILE_SIZE * (0.28 + hash2(i, 137, 0x7007) * 0.24);
      const length = TILE_SIZE * (0.12 + hash2(i, 139, 0x7007) * 0.16);
      strokeJitterLine(contexts.color, sx, sy, sx + (hash2(i, 149, 0x7007) - 0.5) * 16, sy + length, 0x7007 ^ i, 3);
    }
  });

  paintSpeckles(contexts.color, tile, [shadeHex(dirt, -22), shadeHex(dirt, 18), mixHex(dirt, grass, 0.24)], 12, 0x501de, 4, 7);
  paintTileEdgePixelFrame(contexts, tile, mixHex(grass, '#ffffff', 0.14), shadeHex(dirt, -48), 3);
}

function paintDirtTile(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile, base: string): void {
  const { x, y } = tileOrigin(tile);

  paintNoisyColor(contexts.color, tile, base, shadeHex(base, 20), shadeHex(base, -34), 0xd127, 0.46);
  fillTile(contexts.emissive, tile, '#000000');
  paintSpeckles(contexts.color, tile, [shadeHex(base, 24), shadeHex(base, -24), mixHex(base, '#d9bd91', 0.18)], 12, 0xd1275, 4, 8);
  paintPackPixelClusters(
    contexts,
    tile,
    [shadeHex(base, 24), shadeHex(base, -26), mixHex(base, '#e0bd80', 0.16), mixHex(base, '#5a3019', 0.2)],
    0xd17c1,
    16,
    9,
    20,
    0.18
  );

  withAlpha(contexts.color, 0.28, () => {
    for (let i = 0; i < 5; i++) {
      const py = Math.floor(((i + 1) * TILE_SIZE) / 6 + (hash2(i, 3, 0x5011) - 0.5) * 4);
      contexts.color.strokeStyle = i % 2 === 0 ? shadeHex(base, -22) : shadeHex(base, 16);
      contexts.color.lineWidth = 3;
      contexts.color.beginPath();
      contexts.color.moveTo(x + 3, y + py);
      contexts.color.bezierCurveTo(x + TILE_SIZE * 0.3, y + py - 4, x + TILE_SIZE * 0.65, y + py + 5, x + TILE_SIZE - 3, y + py);
      contexts.color.stroke();
    }
  });

  withAlpha(contexts.color, 0.22, () => {
    for (let i = 0; i < 8; i++) {
      const px = x + 10 + hash2(i, 5, 0xd15011) * (TILE_SIZE - 20);
      const py = y + 10 + hash2(i, 7, 0xd15011) * (TILE_SIZE - 20);
      const radius = 4 + hash2(i, 11, 0xd15011) * 6;
      contexts.color.fillStyle = i % 2 === 0 ? shadeHex(base, -28) : shadeHex(base, 22);
      contexts.color.beginPath();
      contexts.color.ellipse(px, py, radius, radius * (0.62 + hash2(i, 13, 0xd15011) * 0.34), hash2(i, 17, 0xd15011) * Math.PI, 0, Math.PI * 2);
      contexts.color.fill();
    }
  });

  paintTileEdgePixelFrame(contexts, tile, shadeHex(base, 24), shadeHex(base, -52), 3);
}

function paintStoneTile(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile, base: string, accent: string): void {
  const { x, y } = tileOrigin(tile);

  paintNoisyColor(contexts.color, tile, base, shadeHex(base, 26), shadeHex(base, -36), 0x5705e, 0.5);
  fillTile(contexts.emissive, tile, '#000000');
  paintSpeckles(contexts.color, tile, [shadeHex(base, 30), shadeHex(base, -34), mixHex(base, accent, 0.22)], 10, 0x5700e, 4, 8);
  paintPackPixelClusters(
    contexts,
    tile,
    [shadeHex(base, 26), shadeHex(base, -32), mixHex(base, accent, 0.14), mixHex(base, '#cbd5e1', 0.1)],
    0x570c1,
    18,
    9,
    20,
    0.18
  );

  withAlpha(contexts.color, 0.24, () => {
    contexts.color.strokeStyle = shadeHex(base, -42);
    contexts.color.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const sx = x + 8 + hash2(i, 1, 0x5afe) * (TILE_SIZE - 16);
      const sy = y + 8 + hash2(i, 2, 0x5afe) * (TILE_SIZE - 16);
      contexts.color.beginPath();
      contexts.color.moveTo(sx, sy);
      contexts.color.lineTo(sx + (hash2(i, 3, 0x5afe) - 0.5) * 26, sy + 8 + hash2(i, 4, 0x5afe) * 16);
      contexts.color.lineTo(sx + 8 + hash2(i, 5, 0x5afe) * 24, sy + (hash2(i, 6, 0x5afe) - 0.5) * 18);
      contexts.color.stroke();
    }
  });
  paintCracks(contexts, tile, shadeHex(base, -48), 0x5705e, 2);

  contexts.color.fillStyle = mixHex(accent, '#ffffff', 0.2);
  withAlpha(contexts.color, 0.14, () => {
    contexts.color.fillRect(x + 14, y + 18, 18, 4);
    contexts.color.fillRect(x + TILE_SIZE - 44, y + TILE_SIZE - 36, 24, 4);
    contexts.color.fillRect(x + TILE_SIZE * 0.46, y + TILE_SIZE * 0.22, 12, 3);
  });

  withAlpha(contexts.color, 0.12, () => {
    contexts.color.strokeStyle = mixHex(accent, '#ffffff', 0.3);
    contexts.color.lineWidth = 3;
    for (let i = 0; i < 2; i++) {
      const sx = x + 18 + hash2(i, 91, 0x0ee1) * 84;
      const sy = y + 18 + hash2(i, 93, 0x0ee1) * 84;
      strokeJitterLine(contexts.color, sx, sy, sx + 18 + hash2(i, 97, 0x0ee1) * 28, sy + (hash2(i, 101, 0x0ee1) - 0.5) * 18, 0x0ee1 ^ i, 4);
    }
  });

  paintInsetBevel(contexts, tile, shadeHex(base, 22), shadeHex(base, -58), 5, 2);
  paintTileEdgePixelFrame(contexts, tile, mixHex(base, '#ffffff', 0.15), shadeHex(base, -64), 3);
}

function paintMetalTile(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile, base: string, accent: string): void {
  const { x, y } = tileOrigin(tile);
  const cold = mixHex(base, '#93b7cc', 0.18);
  const dark = shadeHex(base, -44);

  paintNoisyColor(contexts.color, tile, cold, shadeHex(cold, 38), dark, 0x4e7a1, 0.38);
  fillTile(contexts.emissive, tile, '#000000');

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

function paintGlassTile(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile, base: string, accent: string): void {
  const { x, y } = tileOrigin(tile);
  const bright = mixHex(base, '#ffffff', 0.54);
  const deep = mixHex(base, '#16263c', 0.5);

  paintNoisyColor(contexts.color, tile, base, bright, deep, 0x61a55, 0.58);
  fillTile(contexts.emissive, tile, mixHex(base, '#000000', 0.48));
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

  paintInsetBevel(contexts, tile, mixHex(bright, '#ffffff', 0.26), mixHex(deep, '#000000', 0.28), 5, 2);

  withAlpha(contexts.color, 0.48, () => {
    contexts.color.fillStyle = '#ffffff';
    contexts.color.fillRect(x + 18, y + 16, 22, 3);
    contexts.color.fillRect(x + 18, y + 16, 3, 22);
    contexts.color.fillStyle = mixHex(accent, '#ffffff', 0.45);
    contexts.color.fillRect(x + TILE_SIZE - 42, y + TILE_SIZE - 26, 24, 3);
  });
}

function paintNeonTile(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile, base: string, glow: string, seed: number): void {
  const { x, y } = tileOrigin(tile);

  paintNoisyColor(contexts.color, tile, base, shadeHex(base, 18), shadeHex(base, -36), seed, 0.34);
  fillTile(contexts.emissive, tile, '#000000');

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
  contexts: TerrainTexturePaintContexts,
  tile: TerrainTextureTile,
  base: string,
  accent: string,
  secondary: string,
  seed: number
): void {
  const { x, y } = tileOrigin(tile);

  paintMetalTile(contexts, tile, base, accent);
  fillTile(contexts.emissive, tile, '#000000');

  contexts.color.fillStyle = mixHex(base, '#000000', 0.32);
  contexts.color.fillRect(x + 12, y + 12, TILE_SIZE - 24, TILE_SIZE - 24);
  paintTileGlow(contexts.color, tile, mixHex(accent, '#ffffff', 0.16), 0.2, 14);
  paintTileGlow(contexts.emissive, tile, accent, 0.54, 18);
  paintInsetBevel(contexts, tile, mixHex(accent, '#ffffff', 0.18), shadeHex(base, -54), 8, 2);

  contexts.color.strokeStyle = accent;
  contexts.color.lineWidth = 3;
  contexts.color.strokeRect(x + 14, y + 14, TILE_SIZE - 28, TILE_SIZE - 28);
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

function paintBarrierTile(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile, base: string, accent: string): void {
  const { x, y } = tileOrigin(tile);

  paintNoisyColor(contexts.color, tile, base, shadeHex(base, 18), shadeHex(base, -38), 0xba881e, 0.48);
  fillTile(contexts.emissive, tile, '#000000');
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

function paintWoodTile(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile): void {
  const { x, y } = tileOrigin(tile);
  const base = '#7b4a27';

  paintNoisyColor(contexts.color, tile, base, '#bd7847', '#432412', 0x600d, 0.66);
  fillTile(contexts.emissive, tile, '#000000');
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

function paintLeavesTile(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile, theme: VoxelMapTheme): void {
  const palette = getLeafPalette(theme);
  const { x, y } = tileOrigin(tile);

  paintNoisyColor(contexts.color, tile, palette.base, palette.light, palette.dark, 0x1eafe5, 0.82);
  fillTile(contexts.emissive, tile, '#000000');
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

  }

  paintTileEdgePixelFrame(contexts, tile, mixHex(palette.light, '#ffffff', 0.16), mixHex(palette.dark, '#000000', 0.12), 3);
}

function paintCactusTile(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile): void {
  const { x, y } = tileOrigin(tile);
  const base = '#3f8f4a';
  const light = '#8bd06d';
  const dark = '#1f5631';

  paintNoisyColor(contexts.color, tile, base, light, dark, 0xcac705, 0.54);
  fillTile(contexts.emissive, tile, '#000000');
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

function paintSandTile(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile, base: string): void {
  const { x, y } = tileOrigin(tile);
  const light = mixHex(base, '#fff3b0', 0.34);
  const dark = shadeHex(base, -34);

  paintNoisyColor(contexts.color, tile, base, light, dark, 0x5a2d, 0.5);
  fillTile(contexts.emissive, tile, '#000000');
  paintSpeckles(contexts.color, tile, [light, dark, mixHex(base, '#ffffff', 0.14)], 130, 0x5a2de, 1, 2);

  withAlpha(contexts.color, 0.38, () => {
    contexts.color.strokeStyle = mixHex(light, '#ffffff', 0.2);
    contexts.color.lineWidth = 1;
    for (let i = 0; i < 18; i++) {
      const sy = y + 8 + hash2(i, 17, 0x5a7d) * (TILE_SIZE - 16);
      strokeJitterLine(contexts.color, x + 8, sy, x + TILE_SIZE - 8, sy + (hash2(i, 23, 0x5a7d) - 0.5) * 10, 0x5a7d ^ i, 5);
    }
  });

  paintTileEdgePixelFrame(contexts, tile, light, shadeHex(dark, -16), 3);
}

function paintSnowTile(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile, base: string): void {
  const light = mixHex(base, '#ffffff', 0.62);
  const blue = mixHex(base, '#9edcff', 0.36);

  paintNoisyColor(contexts.color, tile, base, light, blue, 0x5f10, 0.42);
  fillTile(contexts.emissive, tile, '#000000');
  paintSpeckles(contexts.color, tile, ['#ffffff', blue, mixHex(base, '#d8f3ff', 0.34)], 86, 0x5f10e, 1, 2);
  paintPackPixelClusters(contexts, tile, ['#ffffff', blue, mixHex(base, '#ffffff', 0.34)], 0x5f1cc, 28, 4, 12, 0.18);
  paintTileEdgePixelFrame(contexts, tile, '#ffffff', mixHex(blue, '#5c8ca8', 0.26), 3);
}

function paintIceTile(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile, base: string, accent: string): void {
  const { x, y } = tileOrigin(tile);
  const bright = mixHex(base, '#ffffff', 0.68);
  const deep = mixHex(base, '#356e95', 0.48);

  paintNoisyColor(contexts.color, tile, base, bright, deep, 0x1ce, 0.5);
  fillTile(contexts.emissive, tile, mixHex(base, '#000000', 0.7));
  paintTileGlow(contexts.emissive, tile, mixHex(accent, '#ffffff', 0.42), 0.18, 6);

  contexts.color.strokeStyle = mixHex(bright, '#ffffff', 0.28);
  contexts.color.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const sx = x + 10 + hash2(i, 31, 0x1ce) * (TILE_SIZE - 20);
    const sy = y + 10 + hash2(i, 37, 0x1ce) * (TILE_SIZE - 20);
    const ex = sx + (hash2(i, 41, 0x1ce) - 0.5) * 54;
    const ey = sy + (hash2(i, 43, 0x1ce) - 0.5) * 54;
    strokeJitterLine(contexts.color, sx, sy, ex, ey, 0x1ce ^ i, 4);
  }

  paintInsetBevel(contexts, tile, '#ffffff', mixHex(deep, '#000000', 0.24), 5, 2);
}

function paintAshTile(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile, base: string): void {
  const light = shadeHex(base, 32);
  const dark = shadeHex(base, -46);

  paintNoisyColor(contexts.color, tile, base, shadeHex(base, 24), shadeHex(base, -34), 0xa511, 0.42);
  fillTile(contexts.emissive, tile, '#000000');
  paintSpeckles(contexts.color, tile, [light, dark, mixHex(base, '#f1d0b0', 0.14)], 10, 0xa511e, 4, 8);
  paintPackPixelClusters(contexts, tile, [light, dark, shadeHex(base, -18)], 0xa511c, 16, 9, 20, 0.18);
  paintCracks(contexts, tile, shadeHex(dark, -10), 0xa5115, 2);
  paintTileEdgePixelFrame(contexts, tile, light, shadeHex(dark, -18), 3);
}

function paintObsidianTile(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile, accent: string): void {
  const base = '#16131a';
  const purple = '#3b314c';
  const deep = '#050407';

  paintNoisyColor(contexts.color, tile, base, purple, deep, 0x0b51d1a, 0.46);
  fillTile(contexts.emissive, tile, '#000000');
  paintCracks(contexts, tile, mixHex(accent, '#ff4a1f', 0.28), 0x0b51d1a, 2);
  paintPackPixelClusters(contexts, tile, [purple, '#231d2d', mixHex(accent, '#000000', 0.72)], 0x0b51c, 14, 9, 20, 0.16);
  paintInsetBevel(contexts, tile, '#4b405b', '#050407', 5, 2);
  paintTileEdgePixelFrame(contexts, tile, '#4b405b', '#030205', 3);
}

function paintLavaTile(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile): void {
  const { x, y } = tileOrigin(tile);
  const base = '#2d0d08';
  const hot = '#ffb347';
  const glow = '#ff4b1f';

  paintNoisyColor(contexts.color, tile, base, glow, '#050201', 0x1a7a, 0.9);
  fillTile(contexts.emissive, tile, mixHex(glow, '#000000', 0.44));
  paintTileGlow(contexts.emissive, tile, glow, 0.7, 0);

  for (let i = 0; i < 13; i++) {
    const sx = x + hash2(i, 7, 0x1a7a) * TILE_SIZE;
    const sy = y + hash2(i, 11, 0x1a7a) * TILE_SIZE;
    const ex = x + hash2(i, 13, 0x1a7a) * TILE_SIZE;
    const ey = y + hash2(i, 17, 0x1a7a) * TILE_SIZE;
    contexts.color.strokeStyle = i % 3 === 0 ? hot : glow;
    contexts.color.lineWidth = i % 3 === 0 ? 5 : 3;
    contexts.emissive.strokeStyle = i % 3 === 0 ? hot : glow;
    contexts.emissive.lineWidth = contexts.color.lineWidth;
    strokeJitterLine(contexts.color, sx, sy, ex, ey, 0x1a7a ^ i, 5);
    strokeJitterLine(contexts.emissive, sx, sy, ex, ey, 0x1a7a ^ i, 5);
  }

  withAlpha(contexts.color, 0.7, () => {
    contexts.color.fillStyle = mixHex(hot, '#ffffff', 0.28);
    for (let i = 0; i < 18; i++) {
      const px = x + 8 + hash2(i, 23, 0x1a7a) * (TILE_SIZE - 16);
      const py = y + 8 + hash2(i, 29, 0x1a7a) * (TILE_SIZE - 16);
      contexts.color.fillRect(px, py, 4 + hash2(i, 31, 0x1a7a) * 9, 2 + hash2(i, 37, 0x1a7a) * 5);
    }
  });

  paintTileEdgePixelFrame(contexts, tile, glow, '#160503', 3);
}

function paintBambooTile(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile): void {
  const { x, y } = tileOrigin(tile);
  const base = '#5a9b43';
  const light = '#b6d56a';
  const dark = '#254c25';

  paintNoisyColor(contexts.color, tile, base, light, dark, 0xba4b00, 0.44);
  fillTile(contexts.emissive, tile, '#000000');

  for (let px = 6; px < TILE_SIZE; px += 18) {
    contexts.color.fillStyle = px % 36 === 6 ? light : mixHex(base, light, 0.28);
    contexts.color.fillRect(x + px, y, 7, TILE_SIZE);
    contexts.color.fillStyle = dark;
    contexts.color.fillRect(x + px + 6, y, 2, TILE_SIZE);

    for (let py = 12; py < TILE_SIZE; py += 26) {
      contexts.color.fillStyle = mixHex(dark, '#000000', 0.12);
      contexts.color.fillRect(x + px - 1, y + py, 10, 3);
    }
  }

  paintSpeckles(contexts.color, tile, [light, dark, '#e3f0a2'], 42, 0xba4b, 1, 2);
  paintTileEdgePixelFrame(contexts, tile, light, shadeHex(dark, -8), 3);
}

function paintBlossomLeavesTile(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile): void {
  const palette = { base: '#f19abd', light: '#ffd4e4', dark: '#a64d75' };
  const { x, y } = tileOrigin(tile);

  paintNoisyColor(contexts.color, tile, palette.base, palette.light, palette.dark, 0xb10550, 0.72);
  fillTile(contexts.emissive, tile, '#000000');
  paintPackPixelClusters(
    contexts,
    tile,
    [palette.light, palette.base, mixHex(palette.dark, '#ffffff', 0.12), '#fff0c6'],
    0xb105c,
    58,
    3,
    11,
    0.42
  );

  for (let i = 0; i < 92; i++) {
    const px = x + hash2(i, 7, 0xb10550) * TILE_SIZE;
    const py = y + hash2(i, 11, 0xb10550) * TILE_SIZE;
    const rotation = hash2(i, 13, 0xb10550) * Math.PI;
    contexts.color.fillStyle = i % 5 === 0 ? '#fff5f8' : i % 2 === 0 ? palette.light : palette.dark;
    contexts.color.beginPath();
    contexts.color.ellipse(px, py, 4 + hash2(i, 17, 0xb10550) * 5, 2 + hash2(i, 19, 0xb10550) * 3, rotation, 0, Math.PI * 2);
    contexts.color.fill();
  }

  paintTileEdgePixelFrame(contexts, tile, '#ffe3ee', '#823658', 3);
}

function paintMossTile(contexts: TerrainTexturePaintContexts, tile: TerrainTextureTile, base: string): void {
  const light = mixHex(base, '#d9f99d', 0.42);
  const dark = mixHex(base, '#183f20', 0.5);

  paintNoisyColor(contexts.color, tile, base, light, dark, 0x4055, 0.76);
  fillTile(contexts.emissive, tile, '#000000');
  paintPackPixelClusters(contexts, tile, [light, base, dark, '#b6de6a'], 0x4055c, 52, 3, 10, 0.38);
  paintSpeckles(contexts.color, tile, [light, dark, '#e8f7b4'], 80, 0x40551, 1, 2);
  paintTileEdgePixelFrame(contexts, tile, light, shadeHex(dark, -16), 3);
}

function createLayerContext(): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = TERRAIN_TEXTURE_COLUMNS * TILE_SIZE;
  canvas.height = TERRAIN_TEXTURE_ROWS * TILE_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    throw new Error('Unable to create voxel terrain texture source');
  }

  context.imageSmoothingEnabled = false;
  return { canvas, context };
}

function createTextureArrayData(context: CanvasRenderingContext2D): Uint8Array<ArrayBuffer> {
  const layerStride = TILE_SIZE * TILE_SIZE * 4;
  const data = new Uint8Array(new ArrayBuffer(layerStride * TERRAIN_TEXTURE_LAYER_COUNT));

  for (let layer = 0; layer < TERRAIN_TEXTURE_LAYER_COUNT; layer++) {
    const tileX = layer % TERRAIN_TEXTURE_COLUMNS;
    const tileY = Math.floor(layer / TERRAIN_TEXTURE_COLUMNS);
    const image = context.getImageData(tileX * TILE_SIZE, tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    data.set(image.data, layer * layerStride);
  }

  return data;
}

function createTerrainTexture(
  data: Uint8Array<ArrayBuffer>,
  colorSpace: THREE.ColorSpace,
  anisotropy: number
): THREE.DataArrayTexture {
  const texture = new THREE.DataArrayTexture(data, TILE_SIZE, TILE_SIZE, TERRAIN_TEXTURE_LAYER_COUNT);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.colorSpace = colorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;

  return texture;
}

function getTerrainTextureProfile(detail: VoxelTerrainTextureDetail): {
  tileSize: number;
  anisotropy: number;
  paintMode: 'simple' | 'detailed';
} {
  if (detail === 'low') {
    return {
      tileSize: LOW_DETAIL_TILE_SIZE,
      anisotropy: 1,
      paintMode: 'simple',
    };
  }

  if (detail === 'medium') {
    return {
      tileSize: MEDIUM_DETAIL_TILE_SIZE,
      anisotropy: 2,
      paintMode: 'detailed',
    };
  }

  return {
    tileSize: DEFAULT_TILE_SIZE,
    anisotropy: 8,
    paintMode: 'detailed',
  };
}

function paintLowDetailTileSet(contexts: Pick<TerrainTexturePaintContexts, 'color' | 'emissive'>, theme: VoxelMapTheme): void {
  const colorByTile = new Map<TerrainTextureTile, string>([
    [TILE_MAP.grass_top, theme.ground.top],
    [TILE_MAP.grass_side, theme.ground.side],
    [TILE_MAP.dirt, theme.ground.dirt],
    [TILE_MAP.stone, theme.ground.stone],
    [TILE_MAP.sand, theme.id === 'desert' ? theme.ground.top : '#d7b76b'],
    [TILE_MAP.snow, theme.id === 'frost' ? theme.ground.top : '#dceff5'],
    [TILE_MAP.metal, theme.structures.metal],
    [TILE_MAP.glass, theme.structures.glass],
    [TILE_MAP.neon_red, '#3d1212'],
    [TILE_MAP.neon_blue, '#11193f'],
    [TILE_MAP.ice, theme.id === 'frost' ? theme.ground.top : '#aee7f2'],
    [TILE_MAP.obsidian, mixHex(theme.structures.accent, '#050509', 0.72)],
    [TILE_MAP.spawn_pad, mixHex(theme.structures.metal, '#1b1820', 0.45)],
    [TILE_MAP.spawn_pad_red, mixHex(theme.structures.metal, '#3a1114', 0.58)],
    [TILE_MAP.spawn_pad_blue, mixHex(theme.structures.metal, '#101d3a', 0.58)],
    [TILE_MAP.flag_pad, mixHex(theme.structures.metal, '#f7f7ff', 0.2)],
    [TILE_MAP.barrier, theme.structures.barrier],
    [TILE_MAP.wood, '#8a5a32'],
    [TILE_MAP.bamboo, '#82a84a'],
    [TILE_MAP.ash, theme.id === 'volcanic' ? theme.ground.top : '#696967'],
    [TILE_MAP.leaves, theme.id === 'sakura' ? '#d98fb1' : '#5fa45b'],
    [TILE_MAP.cactus, '#4d8b52'],
    [TILE_MAP.blossom_leaves, '#f5a7ca'],
    [TILE_MAP.moss, theme.id === 'sakura' ? '#6fae5f' : '#5f9a68'],
    [TILE_MAP.lava, '#c2410c'],
  ]);

  for (const [tile, color] of colorByTile) {
    fillTile(contexts.color, tile, color);
    fillTile(contexts.emissive, tile, '#000000');
    paintSpeckles(contexts.color, tile, [shadeHex(color, 24), shadeHex(color, -28), mixHex(color, '#ffffff', 0.08)], 18, tile.x * 97 + tile.y * 193, 1, 2);
    paintTileEdgePixelFrame(
      contexts,
      tile,
      mixHex(color, '#ffffff', 0.16),
      mixHex(color, '#000000', 0.28),
      2
    );
  }

  for (const [tile, glow] of [
    [TILE_MAP.neon_red, '#ff4b24'],
    [TILE_MAP.neon_blue, '#3cf7ff'],
    [TILE_MAP.spawn_pad, '#ffd84d'],
    [TILE_MAP.spawn_pad_red, '#ff684f'],
    [TILE_MAP.spawn_pad_blue, '#47ddff'],
    [TILE_MAP.flag_pad, '#f7f7ff'],
    [TILE_MAP.lava, '#ff7b1f'],
  ] as const) {
    paintTileGlow(contexts.emissive, tile, glow, 0.86, 6);
    strokePanelLines(contexts.color, tile, mixHex(glow, '#ffffff', 0.18), 2);
  }
}

export function createVoxelTerrainTextures(theme: VoxelMapTheme, options: VoxelTerrainTextureOptions = {}): VoxelTerrainTextures {
  const detail = options.detail ?? 'high';
  const profile = getTerrainTextureProfile(detail);
  const cacheKey = `${theme.id}:${detail}`;
  const cached = terrainTextureCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  TILE_SIZE = profile.tileSize;
  const color = createLayerContext();
  const emissive = createLayerContext();

  const contexts: TerrainTexturePaintContexts = {
    color: color.context,
    emissive: emissive.context,
  };

  for (const context of new Set(Object.values(contexts))) {
    context.clearRect(0, 0, TERRAIN_TEXTURE_COLUMNS * TILE_SIZE, TERRAIN_TEXTURE_ROWS * TILE_SIZE);
  }

  if (profile.paintMode === 'detailed') {
    paintGrassTop(contexts, TILE_MAP.grass_top, theme);
    paintGrassSide(contexts, TILE_MAP.grass_side, theme.ground.top, theme.ground.dirt);
    paintDirtTile(contexts, TILE_MAP.dirt, theme.ground.dirt);
    paintStoneTile(contexts, TILE_MAP.stone, theme.ground.stone, theme.structures.accent);
    paintSandTile(contexts, TILE_MAP.sand, theme.id === 'desert' ? theme.ground.top : '#d7b76b');
    paintSnowTile(contexts, TILE_MAP.snow, theme.id === 'frost' ? theme.ground.top : '#dceff5');
    paintMetalTile(contexts, TILE_MAP.metal, theme.structures.metal, theme.structures.accent);
    paintGlassTile(contexts, TILE_MAP.glass, theme.structures.glass, theme.structures.accent);
    paintNeonTile(contexts, TILE_MAP.neon_red, shadeHex('#3d1212', theme.id === 'desert' ? 12 : 0), '#ff4b24', 0x1ed);
    paintNeonTile(contexts, TILE_MAP.neon_blue, shadeHex('#11193f', theme.id === 'frost' ? 12 : 0), '#3cf7ff', 0xb10e);
    paintIceTile(contexts, TILE_MAP.ice, theme.id === 'frost' ? theme.ground.top : '#aee7f2', theme.structures.accent);
    paintObsidianTile(contexts, TILE_MAP.obsidian, theme.structures.accent);
    paintPadTile(contexts, TILE_MAP.spawn_pad, mixHex(theme.structures.metal, '#1b1820', 0.45), '#ffd84d', theme.structures.accent, 0x5f0a);
    paintPadTile(contexts, TILE_MAP.spawn_pad_red, mixHex(theme.structures.metal, '#3a1114', 0.58), '#ff684f', '#ffd1a3', 0x5f0b);
    paintPadTile(contexts, TILE_MAP.spawn_pad_blue, mixHex(theme.structures.metal, '#101d3a', 0.58), '#47ddff', '#b8f2ff', 0x5f0c);
    paintPadTile(contexts, TILE_MAP.flag_pad, mixHex(theme.structures.metal, '#f7f7ff', 0.2), '#f7f7ff', theme.structures.accent, 0xf1a6);
    paintBarrierTile(contexts, TILE_MAP.barrier, theme.structures.barrier, theme.structures.accent);
    paintWoodTile(contexts, TILE_MAP.wood);
    paintBambooTile(contexts, TILE_MAP.bamboo);
    paintAshTile(contexts, TILE_MAP.ash, theme.id === 'volcanic' ? theme.ground.top : '#696967');
    paintLeavesTile(contexts, TILE_MAP.leaves, theme);
    paintCactusTile(contexts, TILE_MAP.cactus);
    paintBlossomLeavesTile(contexts, TILE_MAP.blossom_leaves);
    paintMossTile(contexts, TILE_MAP.moss, theme.id === 'sakura' ? '#6fae5f' : '#5f9a68');
    paintLavaTile(contexts, TILE_MAP.lava);
  } else {
    paintLowDetailTileSet({ color: color.context, emissive: emissive.context }, theme);
  }

  const textures: VoxelTerrainTextures = {
    color: createTerrainTexture(createTextureArrayData(color.context), THREE.SRGBColorSpace, profile.anisotropy),
    emissive: createTerrainTexture(createTextureArrayData(emissive.context), THREE.SRGBColorSpace, profile.anisotropy),
    tileSize: profile.tileSize,
    layerCount: TERRAIN_TEXTURE_LAYER_COUNT,
    anisotropy: profile.anisotropy,
  };

  terrainTextureCache.set(cacheKey, textures);
  return textures;
}

export function getTextureLayerForBlock(blockId: VoxelBlockId, face: VoxelFaceDirection): TerrainTextureTile {
  if (blockId === 'grass') {
    return face === 'top' ? TILE_MAP.grass_top : face === 'bottom' ? TILE_MAP.dirt : TILE_MAP.grass_side;
  }

  return TILE_MAP[blockId] ?? TILE_MAP.stone;
}
