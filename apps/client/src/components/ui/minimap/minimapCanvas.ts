import type { ModuleInstance, VoxelMapManifest } from '@voxel-strike/shared';
import {
  buildTopBlockIndex,
  classifyMinimapBlock,
  createMinimapProjection,
  getGridIndexForWorld,
  getHeightRange,
  getMinimapBounds,
  isWorldPointInsideBoundary,
  minimapToWorld,
  worldToMinimap,
  type MinimapProjection,
  type MinimapSurfaceKind,
} from './minimapData';

const STATIC_RENDER_VERSION = 1;
const MAX_STATIC_CANVAS_CACHE_SIZE = 8;
const topBlockCache = new Map<string, Uint8Array>();
const staticCanvasCache = new Map<string, HTMLCanvasElement>();

export interface StaticMinimapCanvasOptions {
  size: number;
  padding: number;
  devicePixelRatio: number;
}

export interface StaticMinimapLayer {
  canvas: HTMLCanvasElement;
  projection: MinimapProjection;
}

export function getStaticMinimapLayer(
  manifest: VoxelMapManifest,
  options: StaticMinimapCanvasOptions
): StaticMinimapLayer {
  const dpr = clamp(Math.round(options.devicePixelRatio * 100) / 100, 1, 3);
  const cacheKey = [
    STATIC_RENDER_VERSION,
    manifest.id,
    options.size,
    options.padding,
    dpr,
  ].join(':');

  const bounds = getMinimapBounds(manifest);
  const projection = createMinimapProjection(bounds, options.size, options.padding);
  const cachedCanvas = staticCanvasCache.get(cacheKey);
  if (cachedCanvas) {
    return { canvas: cachedCanvas, projection };
  }

  const canvas = document.createElement('canvas');
  resizeCanvas(canvas, options.size, dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, projection };

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderStaticLayer(ctx, manifest, projection);

  staticCanvasCache.set(cacheKey, canvas);
  evictOldest(staticCanvasCache, MAX_STATIC_CANVAS_CACHE_SIZE);
  return { canvas, projection };
}

export function resizeCanvas(canvas: HTMLCanvasElement, cssSize: number, devicePixelRatio: number): boolean {
  const dpr = clamp(Math.round(devicePixelRatio * 100) / 100, 1, 3);
  const physicalSize = Math.max(1, Math.round(cssSize * dpr));
  const changed = canvas.width !== physicalSize || canvas.height !== physicalSize;

  if (changed) {
    canvas.width = physicalSize;
    canvas.height = physicalSize;
  }

  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  return changed;
}

function renderStaticLayer(
  ctx: CanvasRenderingContext2D,
  manifest: VoxelMapManifest,
  projection: MinimapProjection
): void {
  const { size } = projection;
  const topBlocks = getCachedTopBlockIndex(manifest);
  const heightRange = getHeightRange(manifest.heightfield.topSolidRows);

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(2, 6, 12, 0.92)';
  ctx.fillRect(0, 0, size, size);

  const minX = Math.floor(projection.offsetX);
  const maxX = Math.ceil(projection.offsetX + projection.contentWidth);
  const minY = Math.floor(projection.offsetY);
  const maxY = Math.ceil(projection.offsetY + projection.contentHeight);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const world = minimapToWorld(projection, { x: x + 0.5, y: y + 0.5 });
      if (!isWorldPointInsideBoundary(world, manifest.boundary)) continue;

      const gridIndex = getGridIndexForWorld(manifest, world.x, world.z);
      if (gridIndex < 0) continue;

      const topRow = manifest.heightfield.topSolidRows[gridIndex] ?? 0;
      if (topRow <= 0) continue;

      const kind = classifyMinimapBlock(topBlocks[gridIndex] ?? 0);
      const heightRatio = (topRow - heightRange.min) / (heightRange.max - heightRange.min);
      ctx.fillStyle = getSurfaceColor(kind, clamp(heightRatio, 0, 1));
      ctx.fillRect(x, y, 1, 1);
    }
  }

  drawModuleFootprints(ctx, manifest, projection);
  drawRoutes(ctx, manifest, projection);
  drawObjectiveDiamond(ctx, projection, manifest.flagZones.red, '#fb7185');
  drawObjectiveDiamond(ctx, projection, manifest.flagZones.blue, '#67e8f9');
  drawSpawnPoints(ctx, projection, manifest.spawnPoints.red, '#f43f5e');
  drawSpawnPoints(ctx, projection, manifest.spawnPoints.blue, '#06b6d4');
  drawBoundary(ctx, manifest, projection);
  drawScanGrid(ctx, projection);
}

function getCachedTopBlockIndex(manifest: VoxelMapManifest): Uint8Array {
  const cached = topBlockCache.get(manifest.id);
  if (cached) return cached;

  const topBlocks = buildTopBlockIndex(manifest);
  topBlockCache.set(manifest.id, topBlocks);
  evictOldest(topBlockCache, MAX_STATIC_CANVAS_CACHE_SIZE);
  return topBlocks;
}

function getSurfaceColor(kind: MinimapSurfaceKind, heightRatio: number): string {
  const terrainBase = Math.round(26 + heightRatio * 48);
  const terrainGreen = Math.round(60 + heightRatio * 42);
  const terrainBlue = Math.round(54 + heightRatio * 38);

  switch (kind) {
    case 'barrier':
      return 'rgba(184, 197, 213, 0.66)';
    case 'hazard':
      return 'rgba(251, 113, 71, 0.78)';
    case 'flag':
      return 'rgba(250, 204, 21, 0.72)';
    case 'spawnRed':
      return 'rgba(244, 63, 94, 0.84)';
    case 'spawnBlue':
      return 'rgba(6, 182, 212, 0.84)';
    case 'accentRed':
      return 'rgba(248, 113, 113, 0.82)';
    case 'accentBlue':
      return 'rgba(103, 232, 249, 0.82)';
    case 'structure':
      return `rgba(${Math.round(104 + heightRatio * 54)}, ${Math.round(119 + heightRatio * 62)}, ${Math.round(137 + heightRatio * 70)}, 0.72)`;
    case 'terrain':
      return `rgba(${terrainBase}, ${terrainGreen}, ${terrainBlue}, 0.82)`;
    default:
      return 'rgba(5, 10, 16, 0.4)';
  }
}

function drawBoundary(
  ctx: CanvasRenderingContext2D,
  manifest: VoxelMapManifest,
  projection: MinimapProjection
): void {
  if (manifest.boundary.length < 2) return;

  ctx.save();
  ctx.beginPath();
  manifest.boundary.forEach((point, index) => {
    const projected = worldToMinimap(projection, point);
    if (index === 0) {
      ctx.moveTo(projected.x, projected.y);
    } else {
      ctx.lineTo(projected.x, projected.y);
    }
  });
  ctx.closePath();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = 'rgba(226, 242, 255, 0.62)';
  ctx.shadowColor = 'rgba(125, 211, 252, 0.34)';
  ctx.shadowBlur = 4;
  ctx.stroke();
  ctx.restore();
}

function drawRoutes(
  ctx: CanvasRenderingContext2D,
  manifest: VoxelMapManifest,
  projection: MinimapProjection
): void {
  const nodeById = new Map(manifest.gameplay.routeGraph.nodes.map((node) => [node.id, node]));

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const edge of manifest.gameplay.routeGraph.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;

    const a = worldToMinimap(projection, from.position);
    const b = worldToMinimap(projection, to.position);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = clamp(edge.width * projection.scale * 0.18, 0.8, 3.6);
    ctx.strokeStyle = edge.traversal === 'bridge'
      ? 'rgba(226, 242, 255, 0.22)'
      : 'rgba(148, 163, 184, 0.13)';
    ctx.stroke();
  }
  ctx.restore();
}

function drawModuleFootprints(
  ctx: CanvasRenderingContext2D,
  manifest: VoxelMapManifest,
  projection: MinimapProjection
): void {
  ctx.save();
  for (const instance of manifest.construction.moduleInstances) {
    if (instance.validation.status === 'rejected') continue;
    drawModuleFootprint(ctx, projection, instance);
  }
  ctx.restore();
}

function drawModuleFootprint(
  ctx: CanvasRenderingContext2D,
  projection: MinimapProjection,
  instance: ModuleInstance
): void {
  const center = worldToMinimap(projection, instance.position);
  const radius = (instance.footprint.radius ?? 3) * projection.scale;
  const halfX = (instance.footprint.halfExtents?.x ?? instance.footprint.radius ?? 3) * projection.scale;
  const halfZ = (instance.footprint.halfExtents?.z ?? instance.footprint.radius ?? 3) * projection.scale;
  const angle = Math.atan2(instance.facing.x, instance.facing.z);

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(203, 213, 225, 0.16)';
  ctx.strokeStyle = 'rgba(226, 242, 255, 0.22)';
  ctx.lineWidth = 1;

  if (instance.footprint.shape === 'rect') {
    ctx.fillRect(-halfX, -halfZ, halfX * 2, halfZ * 2);
    ctx.strokeRect(-halfX, -halfZ, halfX * 2, halfZ * 2);
  } else if (instance.footprint.shape === 'capsule') {
    ctx.beginPath();
    ctx.moveTo(-halfX + radius, -halfZ);
    ctx.lineTo(halfX - radius, -halfZ);
    ctx.arc(halfX - radius, 0, Math.min(radius, halfZ), -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(-halfX + radius, halfZ);
    ctx.arc(-halfX + radius, 0, Math.min(radius, halfZ), Math.PI / 2, Math.PI * 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function drawSpawnPoints(
  ctx: CanvasRenderingContext2D,
  projection: MinimapProjection,
  points: Array<{ x: number; z: number }>,
  color: string
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 4;

  for (const point of points) {
    const projected = worldToMinimap(projection, point);
    ctx.beginPath();
    ctx.arc(projected.x, projected.y, 2.4, 0, Math.PI * 2);
    ctx.globalAlpha = 0.22;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }

  ctx.restore();
}

function drawObjectiveDiamond(
  ctx: CanvasRenderingContext2D,
  projection: MinimapProjection,
  point: { x: number; z: number },
  color: string
): void {
  const projected = worldToMinimap(projection, point);
  ctx.save();
  ctx.translate(projected.x, projected.y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.shadowColor = color;
  ctx.shadowBlur = 5;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(-2.6, -2.6, 5.2, 5.2);
  ctx.lineWidth = 0.9;
  ctx.strokeRect(-2.6, -2.6, 5.2, 5.2);
  ctx.restore();
}

function drawScanGrid(ctx: CanvasRenderingContext2D, projection: MinimapProjection): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
  ctx.lineWidth = 1;

  const step = Math.max(18, Math.round(projection.contentWidth / 5));
  for (let x = projection.offsetX; x <= projection.offsetX + projection.contentWidth; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, projection.offsetY);
    ctx.lineTo(x, projection.offsetY + projection.contentHeight);
    ctx.stroke();
  }
  for (let y = projection.offsetY; y <= projection.offsetY + projection.contentHeight; y += step) {
    ctx.beginPath();
    ctx.moveTo(projection.offsetX, y);
    ctx.lineTo(projection.offsetX + projection.contentWidth, y);
    ctx.stroke();
  }

  ctx.restore();
}

function evictOldest<K, V>(cache: Map<K, V>, maxSize: number): void {
  while (cache.size > maxSize) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    cache.delete(oldest.value);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
