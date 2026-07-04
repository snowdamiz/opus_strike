import type { MapSummoningCircle, ModuleInstance, VoxelMapManifest } from '@voxel-strike/shared';
import { MINIMAP_COLORS } from '../../../styles/colorTokens';
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

const STATIC_RENDER_VERSION = 4;
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
  ctx.fillStyle = MINIMAP_COLORS.static.background;
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
  drawSummoningCircles(ctx, projection, manifest.gameplay.summoningCircles ?? []);
  drawObjectiveDiamond(ctx, projection, manifest.flagZones.red, MINIMAP_COLORS.team.red);
  drawObjectiveDiamond(ctx, projection, manifest.flagZones.blue, MINIMAP_COLORS.team.blue);
  drawSpawnPoints(ctx, projection, manifest.spawnPoints.red, MINIMAP_COLORS.spawn.red);
  drawSpawnPoints(ctx, projection, manifest.spawnPoints.blue, MINIMAP_COLORS.spawn.blue);
  drawBoundary(ctx, manifest, projection);
  drawScanGrid(ctx, projection);
}

function drawSummoningCircles(
  ctx: CanvasRenderingContext2D,
  projection: MinimapProjection,
  circles: readonly MapSummoningCircle[]
): void {
  if (circles.length === 0) return;

  ctx.save();
  for (const circle of circles) {
    const projected = worldToMinimap(projection, circle.position);
    const radius = clamp(circle.radius * projection.scale + 2.6, 5.2, 9.4);
    ctx.save();
    ctx.translate(projected.x, projected.y);
    ctx.shadowColor = MINIMAP_COLORS.static.summoningCircleShadow;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = MINIMAP_COLORS.static.summoningCircleFill;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = MINIMAP_COLORS.static.summoningCircleStroke;
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = MINIMAP_COLORS.static.summoningCircleAccent;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-radius * 0.55, 0);
    ctx.lineTo(radius * 0.55, 0);
    ctx.moveTo(0, -radius * 0.55);
    ctx.lineTo(0, radius * 0.55);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1.4, radius * 0.22), 0, Math.PI * 2);
    ctx.fillStyle = MINIMAP_COLORS.static.summoningCircleStroke;
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
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
  switch (kind) {
    case 'barrier':
      return MINIMAP_COLORS.surface.barrier;
    case 'hazard':
      return MINIMAP_COLORS.surface.hazard;
    case 'flag':
      return MINIMAP_COLORS.surface.flag;
    case 'spawnRed':
      return MINIMAP_COLORS.surface.spawnRed;
    case 'spawnBlue':
      return MINIMAP_COLORS.surface.spawnBlue;
    case 'accentRed':
      return MINIMAP_COLORS.surface.accentRed;
    case 'accentBlue':
      return MINIMAP_COLORS.surface.accentBlue;
    case 'structure':
      return MINIMAP_COLORS.surface.structure(heightRatio);
    case 'terrain':
      return MINIMAP_COLORS.surface.terrain(heightRatio);
    default:
      return MINIMAP_COLORS.surface.void;
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
  ctx.strokeStyle = MINIMAP_COLORS.static.boundaryStroke;
  ctx.shadowColor = MINIMAP_COLORS.static.boundaryShadow;
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
      ? MINIMAP_COLORS.static.bridgeRoute
      : MINIMAP_COLORS.static.route;
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
  ctx.fillStyle = MINIMAP_COLORS.static.moduleFill;
  ctx.strokeStyle = MINIMAP_COLORS.static.moduleStroke;
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
  ctx.strokeStyle = MINIMAP_COLORS.static.objectiveOutline;
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
  ctx.strokeStyle = MINIMAP_COLORS.static.scanGrid;
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
