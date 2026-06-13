import * as THREE from 'three';
import type { VoxelBlockId, VoxelMapTheme } from '@voxel-strike/shared';

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

const TERRAIN_TEXTURE_ANISOTROPY = 1;
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
  colorSpace: THREE.ColorSpace
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
  texture.anisotropy = TERRAIN_TEXTURE_ANISOTROPY;
  texture.needsUpdate = true;

  return texture;
}

function paintTerrainTileSet(contexts: TerrainTexturePaintContexts, theme: VoxelMapTheme): void {
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
    paintSpeckles(contexts.color, tile, [shadeHex(color, 24), shadeHex(color, -28), mixHex(color, '#ffffff', 0.08)], 18, tile.x * 97 + tile.y * 193, 1, 2);
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

export function createVoxelTerrainTextures(theme: VoxelMapTheme): VoxelTerrainTextures {
  const cached = terrainTextureCache.get(theme.id);
  if (cached) {
    return cached;
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

  paintTerrainTileSet(contexts, theme);

  const textures: VoxelTerrainTextures = {
    color: createTerrainTexture(createTextureArrayData(color.context), THREE.SRGBColorSpace),
    emissive: createTerrainTexture(createTextureArrayData(emissive.context), THREE.SRGBColorSpace),
    tileSize: TERRAIN_TEXTURE_TILE_SIZE,
    layerCount: TERRAIN_TEXTURE_LAYER_COUNT,
    anisotropy: TERRAIN_TEXTURE_ANISOTROPY,
  };

  terrainTextureCache.set(theme.id, textures);
  return textures;
}

export function getTextureLayerForBlock(blockId: VoxelBlockId, face: VoxelFaceDirection): TerrainTextureTile {
  if (blockId === 'grass') {
    return face === 'top' ? TILE_MAP.grass_top : face === 'bottom' ? TILE_MAP.dirt : TILE_MAP.grass_side;
  }

  return TILE_MAP[blockId] ?? TILE_MAP.stone;
}
