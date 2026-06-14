import * as THREE from 'three';
import type { VoxelBlockId, VoxelMapTheme } from '@voxel-strike/shared';
import type { GraphicsFeatureQuality } from '../../../store/settingsStore';

export const TERRAIN_TEXTURE_COLUMNS = 6;
export const TERRAIN_TEXTURE_ROWS = 5;
export const TERRAIN_TEXTURE_LAYER_COUNT = TERRAIN_TEXTURE_COLUMNS * TERRAIN_TEXTURE_ROWS;
export const TERRAIN_TEXTURE_TILE_SIZE = 64;
export let TILE_SIZE = TERRAIN_TEXTURE_TILE_SIZE;

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

const TERRAIN_DETAIL_GRID_SIZE = 8;
const TERRAIN_TEXTURE_CACHE_MAX_ENTRIES = 10;

interface CachedTerrainTextures {
  textures: VoxelTerrainTextures;
  lastUsedAt: number;
  retainCount: number;
}

const terrainTextureCache = new Map<string, CachedTerrainTextures>();
let terrainTextureCacheClock = 0;

export const TERRAIN_TEXTURE_ANISOTROPY_BY_QUALITY: Record<GraphicsFeatureQuality, number> = {
  off: 4,
  minimum: 4,
  low: 8,
  medium: 8,
  high: 8,
  ultra: 16,
};

interface MaterialQualityPaintProfile {
  baseSpeckleAlpha: number;
  detailAlpha: number;
  detailDensity: number;
  emissiveDetailAlpha: number;
}

const MATERIAL_QUALITY_PAINT_PROFILES: Record<GraphicsFeatureQuality, MaterialQualityPaintProfile> = {
  off: {
    baseSpeckleAlpha: 0,
    detailAlpha: 0,
    detailDensity: 0,
    emissiveDetailAlpha: 0,
  },
  minimum: {
    baseSpeckleAlpha: 0.04,
    detailAlpha: 0,
    detailDensity: 0,
    emissiveDetailAlpha: 0,
  },
  low: {
    baseSpeckleAlpha: 0.06,
    detailAlpha: 0.24,
    detailDensity: 0.46,
    emissiveDetailAlpha: 0.22,
  },
  medium: {
    baseSpeckleAlpha: 0.08,
    detailAlpha: 0.32,
    detailDensity: 0.56,
    emissiveDetailAlpha: 0.3,
  },
  high: {
    baseSpeckleAlpha: 0.1,
    detailAlpha: 0.42,
    detailDensity: 0.68,
    emissiveDetailAlpha: 0.4,
  },
  ultra: {
    baseSpeckleAlpha: 0.12,
    detailAlpha: 0.5,
    detailDensity: 0.78,
    emissiveDetailAlpha: 0.48,
  },
};

export function getTerrainTextureAnisotropy(materialQuality: GraphicsFeatureQuality): number {
  return TERRAIN_TEXTURE_ANISOTROPY_BY_QUALITY[materialQuality] ?? TERRAIN_TEXTURE_ANISOTROPY_BY_QUALITY.high;
}

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
  gold: textureTile(1, 4),
  gold_ore: textureTile(2, 4),
  gold_panel: textureTile(3, 4),
  gold_glass: textureTile(4, 4),
  crystal_growth: textureTile(5, 4),
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

function fillTile(context: CanvasRenderingContext2D, tile: TerrainTextureTile, color: string): void {
  const { x, y } = tileOrigin(tile);
  context.fillStyle = color;
  context.fillRect(x, y, TILE_SIZE, TILE_SIZE);
}

function withAlpha(context: CanvasRenderingContext2D, alpha: number, paint: () => void): void {
  context.save();
  context.globalAlpha = alpha;
  paint();
  context.restore();
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
  maxSize = 3,
  alpha = 0.16
): void {
  const { x, y } = tileOrigin(tile);
  const safeCount = Math.max(4, Math.ceil(count * 0.28));
  const safeMinSize = Math.max(TERRAIN_DETAIL_GRID_SIZE, minSize);
  const safeMaxSize = Math.max(safeMinSize, maxSize + TERRAIN_DETAIL_GRID_SIZE);

  withAlpha(context, alpha, () => {
    for (let i = 0; i < safeCount; i++) {
      const size = Math.max(
        TERRAIN_DETAIL_GRID_SIZE,
        textureGrid(safeMinSize + Math.floor(hash2(i, 7, seed) * (safeMaxSize - safeMinSize + 1)))
      );
      const px = x + Math.min(TILE_SIZE - size, textureGrid(hash2(i, 3, seed) * Math.max(1, TILE_SIZE - size)));
      const py = y + Math.min(TILE_SIZE - size, textureGrid(hash2(i, 5, seed) * Math.max(1, TILE_SIZE - size)));
      context.fillStyle = colors[i % colors.length];
      context.fillRect(px, py, size, size);
    }
  });
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

type TerrainDetailKind =
  | 'grass'
  | 'earth'
  | 'stone'
  | 'sand'
  | 'frost'
  | 'panel'
  | 'glass'
  | 'obsidian'
  | 'wood'
  | 'foliage'
  | 'succulent'
  | 'magma'
  | 'ore'
  | 'crystal';

const DETAIL_KIND_BY_TILE = new Map<TerrainTextureTile, TerrainDetailKind>([
  [TILE_MAP.grass_top, 'grass'],
  [TILE_MAP.grass_side, 'earth'],
  [TILE_MAP.dirt, 'earth'],
  [TILE_MAP.stone, 'stone'],
  [TILE_MAP.sand, 'sand'],
  [TILE_MAP.snow, 'frost'],
  [TILE_MAP.metal, 'panel'],
  [TILE_MAP.glass, 'glass'],
  [TILE_MAP.neon_red, 'panel'],
  [TILE_MAP.neon_blue, 'panel'],
  [TILE_MAP.ice, 'glass'],
  [TILE_MAP.obsidian, 'obsidian'],
  [TILE_MAP.spawn_pad, 'panel'],
  [TILE_MAP.spawn_pad_red, 'panel'],
  [TILE_MAP.spawn_pad_blue, 'panel'],
  [TILE_MAP.flag_pad, 'panel'],
  [TILE_MAP.barrier, 'panel'],
  [TILE_MAP.wood, 'wood'],
  [TILE_MAP.bamboo, 'wood'],
  [TILE_MAP.ash, 'stone'],
  [TILE_MAP.leaves, 'foliage'],
  [TILE_MAP.cactus, 'succulent'],
  [TILE_MAP.blossom_leaves, 'foliage'],
  [TILE_MAP.moss, 'grass'],
  [TILE_MAP.lava, 'magma'],
  [TILE_MAP.gold, 'sand'],
  [TILE_MAP.gold_ore, 'ore'],
  [TILE_MAP.gold_panel, 'panel'],
  [TILE_MAP.gold_glass, 'glass'],
  [TILE_MAP.crystal_growth, 'crystal'],
]);

function paintChunkyMottle(
  context: CanvasRenderingContext2D,
  tile: TerrainTextureTile,
  colors: string[],
  count: number,
  seed: number,
  minSize = 8,
  maxSize = 18,
  alpha = 0.12
): void {
  const { x, y } = tileOrigin(tile);
  const safeMinSize = Math.max(4, minSize);
  const safeMaxSize = Math.max(safeMinSize, maxSize);

  withAlpha(context, alpha, () => {
    for (let i = 0; i < count; i++) {
      const width = Math.max(TERRAIN_DETAIL_GRID_SIZE, textureGrid(safeMinSize + Math.floor(hash2(i, 11, seed) * (safeMaxSize - safeMinSize + 1))));
      const height = Math.max(TERRAIN_DETAIL_GRID_SIZE, textureGrid(safeMinSize + Math.floor(hash2(i, 13, seed) * (safeMaxSize - safeMinSize + 1))));
      const px = x + Math.min(TILE_SIZE - width, textureGrid(hash2(i, 17, seed) * Math.max(1, TILE_SIZE - width)));
      const py = y + Math.min(TILE_SIZE - height, textureGrid(hash2(i, 19, seed) * Math.max(1, TILE_SIZE - height)));
      context.fillStyle = colors[i % colors.length];
      context.fillRect(px, py, width, height);
    }
  });
}

function scaleDetailCount(count: number, profile: MaterialQualityPaintProfile): number {
  if (profile.detailDensity <= 0) return 0;
  return Math.max(1, Math.round(count * profile.detailDensity));
}

function textureGrid(value: number): number {
  return Math.max(0, Math.round(value / TERRAIN_DETAIL_GRID_SIZE) * TERRAIN_DETAIL_GRID_SIZE);
}

function paintSteppedBands(
  context: CanvasRenderingContext2D,
  tile: TerrainTextureTile,
  colors: string[],
  seed: number,
  orientation: 'horizontal' | 'vertical',
  count = 5,
  alpha = 0.14
): void {
  const { x, y } = tileOrigin(tile);
  const inset = 4;
  const span = TILE_SIZE - inset * 2;

  withAlpha(context, alpha, () => {
    for (let i = 0; i < count; i++) {
      const thickness = Math.max(TERRAIN_DETAIL_GRID_SIZE, textureGrid(8 + Math.floor(hash2(i, 23, seed) * 8)));
      const offset = textureGrid(Math.floor(hash2(i, 29, seed) * Math.max(1, span - thickness)));
      context.fillStyle = colors[i % colors.length];

      if (orientation === 'horizontal') {
        context.fillRect(x + inset, y + inset + offset, span, thickness);
      } else {
        context.fillRect(x + inset + offset, y + inset, thickness, span);
      }
    }
  });
}

function paintSteppedSegments(
  context: CanvasRenderingContext2D,
  tile: TerrainTextureTile,
  color: string,
  seed: number,
  count = 3,
  alpha = 0.18,
  thickness = 4
): void {
  const { x, y } = tileOrigin(tile);
  const inset = 8;
  const segmentThickness = Math.max(TERRAIN_DETAIL_GRID_SIZE, textureGrid(thickness));

  withAlpha(context, alpha, () => {
    context.fillStyle = color;

    for (let i = 0; i < count; i++) {
      const startX = x + inset + textureGrid(hash2(i, 31, seed) * (TILE_SIZE - inset * 2 - 16));
      const startY = y + inset + textureGrid(hash2(i, 37, seed) * (TILE_SIZE - inset * 2 - 16));
      const horizontalLength = 16 + textureGrid(hash2(i, 43, seed) * 16);
      const verticalLength = 16 + textureGrid(hash2(i, 47, seed) * 16);
      const direction = hash2(i, 41, seed) > 0.5 ? 1 : -1;
      const endX = clamp(startX + direction * horizontalLength, x + inset, x + TILE_SIZE - inset - segmentThickness);
      const verticalY = clamp(startY + verticalLength, y + inset, y + TILE_SIZE - inset - segmentThickness);
      const horizontalX = Math.min(startX, endX);
      const horizontalWidth = Math.abs(endX - startX) + segmentThickness;

      context.fillRect(horizontalX, startY, horizontalWidth, segmentThickness);
      context.fillRect(endX, Math.min(startY, verticalY), segmentThickness, Math.abs(verticalY - startY) + segmentThickness);
    }
  });
}

function paintPanelAccents(
  context: CanvasRenderingContext2D,
  tile: TerrainTextureTile,
  groove: string,
  rivet: string,
  alpha = 0.24
): void {
  const { x, y } = tileOrigin(tile);
  const middle = Math.floor(TILE_SIZE / 2);
  const inset = 8;

  withAlpha(context, alpha, () => {
    context.fillStyle = groove;
    context.fillRect(x + inset, y + middle - 3, TILE_SIZE - inset * 2, 6);
    context.fillRect(x + middle - 3, y + inset, 6, TILE_SIZE - inset * 2);

    context.fillStyle = rivet;
    const rivetSize = 8;
    const rivets = [
      [8, 8],
      [TILE_SIZE - 16, 8],
      [8, TILE_SIZE - 16],
      [TILE_SIZE - 16, TILE_SIZE - 16],
    ];

    for (const [rx, ry] of rivets) {
      context.fillRect(x + rx, y + ry, rivetSize, rivetSize);
    }
  });
}

function paintRectFacets(
  context: CanvasRenderingContext2D,
  tile: TerrainTextureTile,
  color: string,
  seed: number,
  count = 3,
  alpha = 0.16
): void {
  const { x, y } = tileOrigin(tile);
  const inset = 8;

  withAlpha(context, alpha, () => {
    context.fillStyle = color;

    for (let i = 0; i < count; i++) {
      const width = 16 + textureGrid(hash2(i, 61, seed) * 8);
      const height = TILE_SIZE - inset * 2;
      const px = x + inset + textureGrid(hash2(i, 67, seed) * Math.max(1, TILE_SIZE - inset * 2 - width));
      context.fillRect(px, y + inset, width, height);
    }
  });
}

function paintTerrainTileDetail(
  contexts: TerrainTexturePaintContexts,
  tile: TerrainTextureTile,
  color: string,
  detailKind: TerrainDetailKind,
  seed: number,
  profile: MaterialQualityPaintProfile
): void {
  if (profile.detailAlpha <= 0 || profile.detailDensity <= 0) return;

  const highlight = mixHex(color, '#ffffff', 0.24);
  const lowlight = mixHex(color, '#000000', 0.34);
  const alpha = profile.detailAlpha;
  const emissiveAlpha = profile.emissiveDetailAlpha;

  switch (detailKind) {
    case 'grass':
      paintChunkyMottle(contexts.color, tile, [shadeHex(color, 22), mixHex(color, '#112b18', 0.28)], scaleDetailCount(7, profile), seed, 8, 18, 0.12 * alpha);
      paintSteppedBands(contexts.color, tile, [mixHex(color, '#efffbb', 0.18)], seed + 17, 'vertical', scaleDetailCount(3, profile), 0.06 * alpha);
      break;
    case 'earth':
      paintSteppedBands(contexts.color, tile, [shadeHex(color, 18), shadeHex(color, -26)], seed, 'horizontal', scaleDetailCount(5, profile), 0.13 * alpha);
      paintChunkyMottle(contexts.color, tile, [mixHex(color, '#000000', 0.22)], scaleDetailCount(4, profile), seed + 23, 9, 20, 0.08 * alpha);
      break;
    case 'stone':
      paintChunkyMottle(contexts.color, tile, [highlight, lowlight], scaleDetailCount(6, profile), seed, 10, 22, 0.1 * alpha);
      paintSteppedSegments(contexts.color, tile, mixHex(color, '#000000', 0.42), seed + 31, scaleDetailCount(2, profile), 0.12 * alpha, 4);
      break;
    case 'sand':
      paintSteppedBands(contexts.color, tile, [shadeHex(color, 16), mixHex(color, '#8a6d35', 0.18)], seed, 'horizontal', scaleDetailCount(4, profile), 0.1 * alpha);
      paintChunkyMottle(contexts.color, tile, [mixHex(color, '#ffffff', 0.16)], scaleDetailCount(5, profile), seed + 41, 9, 18, 0.07 * alpha);
      break;
    case 'frost':
      paintChunkyMottle(contexts.color, tile, [mixHex(color, '#ffffff', 0.28), mixHex(color, '#6fc7df', 0.2)], scaleDetailCount(5, profile), seed, 10, 24, 0.08 * alpha);
      paintRectFacets(contexts.color, tile, mixHex(color, '#ffffff', 0.36), seed + 47, scaleDetailCount(2, profile), 0.09 * alpha);
      break;
    case 'panel':
      paintChunkyMottle(contexts.color, tile, [shadeHex(color, 18), shadeHex(color, -24)], scaleDetailCount(4, profile), seed, 10, 22, 0.07 * alpha);
      paintPanelAccents(contexts.color, tile, mixHex(color, '#000000', 0.36), mixHex(color, '#ffffff', 0.24), 0.16 * alpha);
      break;
    case 'glass':
      paintRectFacets(contexts.color, tile, mixHex(color, '#ffffff', 0.42), seed, scaleDetailCount(3, profile), 0.12 * alpha);
      paintPanelAccents(contexts.color, tile, mixHex(color, '#ffffff', 0.18), mixHex(color, '#ffffff', 0.36), 0.1 * alpha);
      break;
    case 'obsidian':
      paintChunkyMottle(contexts.color, tile, [mixHex(color, '#5d3a8a', 0.22), mixHex(color, '#000000', 0.42)], scaleDetailCount(5, profile), seed, 11, 24, 0.13 * alpha);
      paintSteppedSegments(contexts.color, tile, mixHex(color, '#9d7cff', 0.22), seed + 53, scaleDetailCount(2, profile), 0.12 * alpha, 4);
      break;
    case 'wood':
      paintSteppedBands(contexts.color, tile, [shadeHex(color, 24), shadeHex(color, -30)], seed, 'vertical', scaleDetailCount(5, profile), 0.14 * alpha);
      paintSteppedSegments(contexts.color, tile, mixHex(color, '#2a1407', 0.3), seed + 59, scaleDetailCount(2, profile), 0.08 * alpha, 4);
      break;
    case 'foliage':
      paintChunkyMottle(contexts.color, tile, [shadeHex(color, 24), mixHex(color, '#15351d', 0.28)], scaleDetailCount(8, profile), seed, 8, 18, 0.14 * alpha);
      paintSteppedBands(contexts.color, tile, [mixHex(color, '#ffffff', 0.18)], seed + 61, 'vertical', scaleDetailCount(3, profile), 0.06 * alpha);
      break;
    case 'succulent':
      paintSteppedBands(contexts.color, tile, [shadeHex(color, 24), mixHex(color, '#14351e', 0.22)], seed, 'vertical', scaleDetailCount(5, profile), 0.14 * alpha);
      paintChunkyMottle(contexts.color, tile, [mixHex(color, '#ffffff', 0.18)], scaleDetailCount(4, profile), seed + 67, 8, 16, 0.08 * alpha);
      break;
    case 'magma':
      paintChunkyMottle(contexts.color, tile, [mixHex(color, '#1a0700', 0.3), shadeHex(color, 34)], scaleDetailCount(6, profile), seed, 9, 22, 0.12 * alpha);
      paintSteppedSegments(contexts.color, tile, '#ffb347', seed + 71, scaleDetailCount(3, profile), 0.18 * alpha, 4);
      paintSteppedSegments(contexts.emissive, tile, '#ff7b1f', seed + 71, scaleDetailCount(3, profile), 0.42 * emissiveAlpha, 8);
      break;
    case 'ore':
      paintChunkyMottle(contexts.color, tile, [lowlight, highlight], scaleDetailCount(5, profile), seed, 10, 20, 0.1 * alpha);
      paintSteppedSegments(contexts.color, tile, '#f7d15b', seed + 73, scaleDetailCount(2, profile), 0.18 * alpha, 4);
      paintSteppedSegments(contexts.emissive, tile, '#ffe15a', seed + 73, scaleDetailCount(2, profile), 0.12 * emissiveAlpha, 8);
      break;
    case 'crystal':
      paintRectFacets(contexts.color, tile, mixHex(color, '#ffffff', 0.44), seed, scaleDetailCount(3, profile), 0.16 * alpha);
      paintSteppedSegments(contexts.color, tile, '#fff9b8', seed + 79, scaleDetailCount(2, profile), 0.14 * alpha, 4);
      paintSteppedSegments(contexts.emissive, tile, '#fff36b', seed + 79, scaleDetailCount(2, profile), 0.18 * emissiveAlpha, 8);
      break;
  }
}

function createLayerContext(): { context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = TERRAIN_TEXTURE_COLUMNS * TILE_SIZE;
  canvas.height = TERRAIN_TEXTURE_ROWS * TILE_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    throw new Error('Unable to create voxel terrain texture source');
  }

  context.imageSmoothingEnabled = false;
  return { context };
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
  texture.anisotropy = Math.max(1, Math.round(anisotropy));
  texture.needsUpdate = true;

  return texture;
}

function paintTerrainTileSet(
  contexts: TerrainTexturePaintContexts,
  theme: VoxelMapTheme,
  materialQuality: GraphicsFeatureQuality
): void {
  const qualityProfile = MATERIAL_QUALITY_PAINT_PROFILES[materialQuality];
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
    [TILE_MAP.gold, theme.id === 'golden' ? theme.ground.top : '#d8a928'],
    [TILE_MAP.gold_ore, theme.id === 'golden' ? theme.ground.side : '#9f7632'],
    [TILE_MAP.gold_panel, theme.id === 'golden' ? theme.structures.metal : '#6d5635'],
    [TILE_MAP.gold_glass, theme.id === 'golden' ? theme.structures.glass : '#ffeaa3'],
    [TILE_MAP.crystal_growth, theme.id === 'golden' ? theme.structures.accent : '#fff36b'],
  ]);

  for (const [tile, color] of colorByTile) {
    fillTile(contexts.color, tile, color);
    fillTile(contexts.emissive, tile, '#000000');
    const seed = tile.x * 97 + tile.y * 193;
    if (qualityProfile.baseSpeckleAlpha > 0) {
      paintSpeckles(
        contexts.color,
        tile,
        [shadeHex(color, 24), shadeHex(color, -28), mixHex(color, '#ffffff', 0.08)],
        18,
        seed,
        1,
        2,
        qualityProfile.baseSpeckleAlpha
      );
    }
    const detailKind = DETAIL_KIND_BY_TILE.get(tile);
    if (detailKind) {
      paintTerrainTileDetail(contexts, tile, color, detailKind, seed, qualityProfile);
    }
    paintTileEdgePixelFrame(
      contexts,
      tile,
      mixHex(color, '#ffffff', 0.16),
      mixHex(color, '#000000', 0.28),
      2
    );
  }

  const glowTiles: readonly (readonly [TerrainTextureTile, string])[] = [
    [TILE_MAP.neon_red, '#ff4b24'],
    [TILE_MAP.neon_blue, '#3cf7ff'],
    [TILE_MAP.spawn_pad, '#ffd84d'],
    [TILE_MAP.spawn_pad_red, '#ff684f'],
    [TILE_MAP.spawn_pad_blue, '#47ddff'],
    [TILE_MAP.flag_pad, '#f7f7ff'],
    [TILE_MAP.lava, '#ff7b1f'],
    [TILE_MAP.gold_panel, '#ffe15a'],
    [TILE_MAP.gold_glass, '#fff4a8'],
    [TILE_MAP.crystal_growth, '#fff36b'],
  ];

  for (const [tile, glow] of glowTiles) {
    paintTileGlow(contexts.emissive, tile, glow, 0.86, 6);
    strokePanelLines(contexts.color, tile, mixHex(glow, '#ffffff', 0.18), 2);
  }
}

export function createVoxelTerrainTextures(
  theme: VoxelMapTheme,
  materialQuality: GraphicsFeatureQuality = 'high'
): VoxelTerrainTextures {
  const cacheKey = getTerrainTextureCacheKey(theme, materialQuality);
  const cached = terrainTextureCache.get(cacheKey);
  if (cached) {
    cached.lastUsedAt = ++terrainTextureCacheClock;
    return cached.textures;
  }

  TILE_SIZE = TERRAIN_TEXTURE_TILE_SIZE;
  const color = createLayerContext();
  const emissive = createLayerContext();

  const contexts: TerrainTexturePaintContexts = {
    color: color.context,
    emissive: emissive.context,
  };

  for (const context of new Set(Object.values(contexts))) {
    context.clearRect(0, 0, TERRAIN_TEXTURE_COLUMNS * TILE_SIZE, TERRAIN_TEXTURE_ROWS * TILE_SIZE);
  }

  paintTerrainTileSet(contexts, theme, materialQuality);
  const anisotropy = getTerrainTextureAnisotropy(materialQuality);

  const textures: VoxelTerrainTextures = {
    color: createTerrainTexture(createTextureArrayData(color.context), THREE.SRGBColorSpace, anisotropy),
    emissive: createTerrainTexture(createTextureArrayData(emissive.context), THREE.SRGBColorSpace, anisotropy),
    tileSize: TERRAIN_TEXTURE_TILE_SIZE,
    layerCount: TERRAIN_TEXTURE_LAYER_COUNT,
    anisotropy,
  };

  terrainTextureCache.set(cacheKey, {
    textures,
    lastUsedAt: ++terrainTextureCacheClock,
    retainCount: 0,
  });
  enforceTerrainTextureCacheBudget();
  return textures;
}

function getTerrainTextureCacheKey(theme: VoxelMapTheme, materialQuality: GraphicsFeatureQuality): string {
  return `${theme.id}:${materialQuality}`;
}

function disposeVoxelTerrainTextures(textures: VoxelTerrainTextures): void {
  textures.color.dispose();
  textures.emissive.dispose();
}

function enforceTerrainTextureCacheBudget(): void {
  if (terrainTextureCache.size <= TERRAIN_TEXTURE_CACHE_MAX_ENTRIES) return;

  const candidates = Array.from(terrainTextureCache.entries())
    .filter(([, entry]) => entry.retainCount === 0)
    .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);

  for (const [cacheKey, entry] of candidates) {
    if (terrainTextureCache.size <= TERRAIN_TEXTURE_CACHE_MAX_ENTRIES) return;
    terrainTextureCache.delete(cacheKey);
    disposeVoxelTerrainTextures(entry.textures);
  }
}

export function retainVoxelTerrainTextures(
  theme: VoxelMapTheme,
  materialQuality: GraphicsFeatureQuality = 'high'
): { textures: VoxelTerrainTextures; release: () => void } {
  const cacheKey = getTerrainTextureCacheKey(theme, materialQuality);
  const textures = createVoxelTerrainTextures(theme, materialQuality);
  const entry = terrainTextureCache.get(cacheKey);
  if (entry) {
    entry.retainCount++;
    entry.lastUsedAt = ++terrainTextureCacheClock;
  }

  let released = false;
  return {
    textures,
    release: () => {
      if (released) return;
      released = true;

      const retainedEntry = terrainTextureCache.get(cacheKey);
      if (!retainedEntry || retainedEntry.textures !== textures) return;
      retainedEntry.retainCount = Math.max(0, retainedEntry.retainCount - 1);
      retainedEntry.lastUsedAt = ++terrainTextureCacheClock;
      enforceTerrainTextureCacheBudget();
    },
  };
}

export function getTextureLayerForBlock(blockId: VoxelBlockId, face: VoxelFaceDirection): TerrainTextureTile {
  if (blockId === 'grass') {
    return face === 'top' ? TILE_MAP.grass_top : face === 'bottom' ? TILE_MAP.dirt : TILE_MAP.grass_side;
  }

  return TILE_MAP[blockId] ?? TILE_MAP.stone;
}
