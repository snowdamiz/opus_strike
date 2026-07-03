import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useShallow } from 'zustand/shallow';
import {
  getTeamCatalogEntry,
  type BattleRoyalDropSnapshot,
  type Player,
  type VoxelMapManifest,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { visualStore } from '../../../store/visualStore';
import { measureFrameWork } from '../../../movement/networkDiagnostics';
import { MINIMAP_COLORS } from '../../../styles/colorTokens';
import { isSafeZoneTargetRevealed } from '../../../utils/battleRoyalSafeZoneReveal';
import { getPreparedVoxelMap, prepareVoxelMapCpu } from '../../../utils/mapWarmup/mapPrepCache';
import { getStaticMinimapLayer, resizeCanvas } from './minimapCanvas';
import {
  createMinimapProjection,
  getMinimapBounds,
  isWorldPointInsideBoundary,
  selectVisibleTeammates,
  worldToMinimap,
  type MinimapProjection,
  type MinimapPoint,
} from './minimapData';

const DEFAULT_MINIMAP_SIZE = 172;
const MINIMAP_PADDING = 8;
const LIVE_OVERLAY_FPS = 30;
const LIVE_OVERLAY_FRAME_MS = 1000 / LIVE_OVERLAY_FPS;
const liveOverlayTeammatesScratch: Player[] = [];

export function Minimap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const size = useMeasuredSquareSize(containerRef, DEFAULT_MINIMAP_SIZE);
  const devicePixelRatio = useDevicePixelRatio();
  const { localPlayerId, mapSeed, mapThemeId, mapSize, mapProfileId, pregeneratedMapId } = useGameStore(
    useShallow((state) => ({
      localPlayerId: state.localPlayer?.id ?? null,
      mapSeed: state.mapSeed,
      mapThemeId: state.mapThemeId,
      mapSize: state.mapSize,
      mapProfileId: state.mapProfileId,
      pregeneratedMapId: state.pregeneratedMapId,
    }))
  );

  const preparedMap = useMemo(() => (
    getPreparedVoxelMap({ seed: mapSeed, themeId: mapThemeId, mapSize, mapProfileId, pregeneratedMapId })
    ?? prepareVoxelMapCpu({ seed: mapSeed, themeId: mapThemeId, mapSize, mapProfileId, pregeneratedMapId, source: 'match' })
  ), [mapSeed, mapThemeId, mapSize, mapProfileId, pregeneratedMapId]);
  const manifest = preparedMap.manifest;
  const projection = useMemo(() => (
    createMinimapProjection(getMinimapBounds(manifest), size, MINIMAP_PADDING)
  ), [manifest, size]);
  const boundaryClipPath = useMemo(() => (
    createBoundaryClipPath(manifest, projection)
  ), [manifest, projection]);

  useEffect(() => {
    const canvas = staticCanvasRef.current;
    if (!canvas) return;

    const layer = getStaticMinimapLayer(manifest, {
      size,
      padding: MINIMAP_PADDING,
      devicePixelRatio,
    });

    resizeCanvas(canvas, size, devicePixelRatio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const liveContext = ctx;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(layer.canvas, 0, 0);
  }, [devicePixelRatio, manifest, size]);

  useEffect(() => {
    const canvas = liveCanvasRef.current;
    if (!canvas || !localPlayerId) return;

    resizeCanvas(canvas, size, devicePixelRatio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const liveContext = ctx;

    let rafId = 0;
    let timeoutId = 0;
    let cancelled = false;
    function scheduleDraw() {
      if (cancelled) return;
      timeoutId = window.setTimeout(() => {
        if (!cancelled) rafId = window.requestAnimationFrame(draw);
      }, LIVE_OVERLAY_FRAME_MS);
    }
    function draw() {
      measureFrameWork('ui.minimapOverlay', () => {
        drawLiveOverlay(liveContext, manifest, projection, boundaryClipPath, size, devicePixelRatio);
      });
      scheduleDraw();
    }

    draw();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      window.cancelAnimationFrame(rafId);
    };
  }, [boundaryClipPath, devicePixelRatio, localPlayerId, manifest, projection, size]);

  if (!localPlayerId) return null;

  return (
    <div
      ref={containerRef}
      className="hud-minimap absolute left-3 top-3 sm:left-4 sm:top-4 pointer-events-none z-[125] aspect-square w-[clamp(7.75rem,13vw,10.75rem)] select-none"
      aria-hidden="true"
    >
      <div
        className="relative h-full w-full overflow-hidden rounded-lg border border-cyan-100/10 bg-slate-950/72 backdrop-blur-md"
        style={{
          boxShadow: MINIMAP_COLORS.frame.shadow,
        }}
      >
        <canvas ref={staticCanvasRef} className="absolute inset-0 h-full w-full" />
        <canvas ref={liveCanvasRef} className="absolute inset-0 h-full w-full" />
        <div className="absolute inset-0" style={{ background: MINIMAP_COLORS.frame.overlay }} />
        <div className="absolute inset-x-2 top-2 h-px bg-gradient-to-r from-transparent via-cyan-100/30 to-transparent" />
        <div className="absolute inset-x-2 bottom-2 h-px bg-gradient-to-r from-transparent via-cyan-100/18 to-transparent" />
      </div>
    </div>
  );
}

function drawLiveOverlay(
  ctx: CanvasRenderingContext2D,
  manifest: VoxelMapManifest,
  projection: MinimapProjection,
  boundaryClipPath: Path2D | null,
  size: number,
  devicePixelRatio: number
): void {
  const dpr = Math.min(3, Math.max(1, devicePixelRatio));
  const store = useGameStore.getState();
  const localPlayer = store.localPlayer;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  if (!localPlayer) return;

  ctx.save();
  clipToBoundary(ctx, projection, boundaryClipPath);

  const visualState = visualStore.getState();
  const teammates = selectVisibleTeammates(localPlayer, store.players.values(), liveOverlayTeammatesScratch);
  const teamColor = store.isPracticeMode ? MINIMAP_COLORS.live.practiceTeam : getTeamColor(localPlayer.team);

  if (store.safeZone?.enabled) {
    drawSafeZone(ctx, projection, store.safeZone, isSafeZoneTargetRevealed(store.safeZone));
  }

  if (store.gameplayMode === 'battle_royal' && store.battleRoyalDrop?.enabled) {
    const dropPathTime = store.gamePhase === 'countdown' ? store.battleRoyalDrop.ship.startedAt : Date.now();
    drawBattleRoyalDropFlightPath(ctx, projection, store.battleRoyalDrop, dropPathTime);
  }

  for (const teammate of teammates) {
    const position = visualState.playerPositions.get(teammate.id) ?? teammate.position;
    if (!isWorldPointInsideBoundary(position, manifest.boundary)) continue;

    const rotation = visualState.playerRotations.get(teammate.id) ?? teammate.lookYaw;
    drawTeammateMarker(
      ctx,
      worldToMinimap(projection, position),
      rotation,
      getTeamColor(teammate.team),
      teammate.state === 'spawning' ? 0.55 : 0.92,
      Boolean(teammate.hasFlag)
    );
  }

  const localPosition = visualState.playerPositions.get(localPlayer.id) ?? localPlayer.position;
  const localRotation = visualState.playerRotations.get(localPlayer.id) ?? localPlayer.lookYaw;
  drawLocalMarker(ctx, worldToMinimap(projection, localPosition), localRotation, teamColor, Boolean(localPlayer.hasFlag));

  ctx.restore();
}

function clipToBoundary(
  ctx: CanvasRenderingContext2D,
  projection: MinimapProjection,
  boundaryClipPath: Path2D | null
): void {
  if (!boundaryClipPath) {
    ctx.beginPath();
    ctx.rect(0, 0, projection.size, projection.size);
    ctx.clip();
    return;
  }

  ctx.clip(boundaryClipPath);
}

function createBoundaryClipPath(
  manifest: VoxelMapManifest,
  projection: MinimapProjection
): Path2D | null {
  if (manifest.boundary.length < 3 || typeof Path2D === 'undefined') return null;

  const path = new Path2D();
  manifest.boundary.forEach((point, index) => {
    const projected = worldToMinimap(projection, point);
    if (index === 0) {
      path.moveTo(projected.x, projected.y);
    } else {
      path.lineTo(projected.x, projected.y);
    }
  });
  path.closePath();
  return path;
}

function drawBattleRoyalDropFlightPath(
  ctx: CanvasRenderingContext2D,
  projection: MinimapProjection,
  drop: BattleRoyalDropSnapshot,
  now: number
): void {
  const pathStart = worldToMinimap(projection, drop.ship.start);
  const pathEnd = worldToMinimap(projection, drop.ship.end);
  const dropStart = worldToMinimap(
    projection,
    getBattleRoyalDropPathPoint(drop, getBattleRoyalDropPathProgress(drop, drop.ship.dropStartsAt))
  );
  const dropEnd = worldToMinimap(
    projection,
    getBattleRoyalDropPathPoint(drop, getBattleRoyalDropPathProgress(drop, drop.ship.dropEndsAt))
  );
  const shipPoint = worldToMinimap(
    projection,
    getBattleRoyalDropPathPoint(drop, getBattleRoyalDropPathProgress(drop, now))
  );
  const yaw = Math.atan2(
    drop.ship.end.x - drop.ship.start.x,
    drop.ship.end.z - drop.ship.start.z
  );

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = MINIMAP_COLORS.live.dropPathShadow;
  ctx.shadowBlur = 4;
  ctx.strokeStyle = MINIMAP_COLORS.live.dropPath;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(pathStart.x, pathStart.y);
  ctx.lineTo(pathEnd.x, pathEnd.y);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.shadowColor = MINIMAP_COLORS.live.dropSegmentShadow;
  ctx.shadowBlur = 7;
  ctx.strokeStyle = MINIMAP_COLORS.live.dropSegment;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(dropStart.x, dropStart.y);
  ctx.lineTo(dropEnd.x, dropEnd.y);
  ctx.stroke();

  ctx.translate(shipPoint.x, shipPoint.y);
  ctx.rotate(-yaw);
  ctx.beginPath();
  ctx.moveTo(0, -6.2);
  ctx.lineTo(4.4, 4.4);
  ctx.lineTo(0, 2.2);
  ctx.lineTo(-4.4, 4.4);
  ctx.closePath();
  ctx.fillStyle = MINIMAP_COLORS.live.dropShipFill;
  ctx.strokeStyle = MINIMAP_COLORS.live.dropShipStroke;
  ctx.lineWidth = 1.3;
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function getBattleRoyalDropPathProgress(drop: BattleRoyalDropSnapshot, time: number): number {
  return Math.max(
    0,
    Math.min(1, (time - drop.ship.startedAt) / Math.max(1, drop.ship.endsAt - drop.ship.startedAt))
  );
}

function getBattleRoyalDropPathPoint(
  drop: BattleRoyalDropSnapshot,
  progress: number
): Pick<BattleRoyalDropSnapshot['ship']['start'], 'x' | 'z'> {
  return {
    x: drop.ship.start.x + (drop.ship.end.x - drop.ship.start.x) * progress,
    z: drop.ship.start.z + (drop.ship.end.z - drop.ship.start.z) * progress,
  };
}

function drawTeammateMarker(
  ctx: CanvasRenderingContext2D,
  point: MinimapPoint,
  yaw: number,
  color: string,
  alpha: number,
  hasFlag: boolean
): void {
  const dir = directionFromYaw(yaw);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = color;
  ctx.shadowBlur = 5;

  if (hasFlag) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5.8, 0, Math.PI * 2);
    ctx.strokeStyle = MINIMAP_COLORS.live.teammateFlagRing;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(point.x, point.y, 3.4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = MINIMAP_COLORS.live.teammateOutline;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.lineTo(point.x + dir.x * 7, point.y + dir.y * 7);
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

function drawLocalMarker(
  ctx: CanvasRenderingContext2D,
  point: MinimapPoint,
  yaw: number,
  color: string,
  hasFlag: boolean
): void {
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(-yaw);
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;

  if (hasFlag) {
    ctx.beginPath();
    ctx.arc(0, 0, 7.4, 0, Math.PI * 2);
    ctx.strokeStyle = MINIMAP_COLORS.live.localFlagRing;
    ctx.lineWidth = 1.7;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(0, -7.6);
  ctx.lineTo(5.4, 5.7);
  ctx.lineTo(0, 3.2);
  ctx.lineTo(-5.4, 5.7);
  ctx.closePath();
  ctx.fillStyle = MINIMAP_COLORS.live.localFill;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawSafeZone(
  ctx: CanvasRenderingContext2D,
  projection: MinimapProjection,
  safeZone: NonNullable<ReturnType<typeof useGameStore.getState>['safeZone']>,
  showNextZone: boolean
): void {
  const center = worldToMinimap(projection, safeZone.center);
  const radius = Math.max(1, safeZone.radius * projection.scale);

  ctx.save();
  ctx.globalAlpha = safeZone.warning ? 0.95 : 0.74;
  ctx.strokeStyle = safeZone.warning ? MINIMAP_COLORS.safeZone.warningStroke : MINIMAP_COLORS.safeZone.stableStroke;
  ctx.fillStyle = safeZone.warning ? MINIMAP_COLORS.safeZone.warningFill : MINIMAP_COLORS.safeZone.stableFill;
  ctx.lineWidth = safeZone.shrinking ? 2.1 : 1.6;
  ctx.shadowColor = safeZone.warning ? MINIMAP_COLORS.safeZone.warningShadow : MINIMAP_COLORS.safeZone.stableShadow;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (showNextZone) {
    const nextCenter = worldToMinimap(projection, safeZone.nextCenter);
    const nextRadius = Math.max(1, safeZone.nextRadius * projection.scale);
    ctx.setLineDash([4, 4]);
    ctx.globalAlpha = 0.64;
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.beginPath();
    ctx.arc(nextCenter.x, nextCenter.y, nextRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function directionFromYaw(yaw: number): { x: number; y: number } {
  return {
    x: -Math.sin(yaw),
    y: -Math.cos(yaw),
  };
}

function getTeamColor(team: Player['team']): string {
  return getTeamCatalogEntry(team)?.color
    ?? (team === 'red' ? MINIMAP_COLORS.team.red : MINIMAP_COLORS.team.blue);
}

function useDevicePixelRatio(): number {
  const [ratio, setRatio] = useState(() => (
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  ));

  useEffect(() => {
    const update = () => setRatio(window.devicePixelRatio || 1);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return ratio;
}

function useMeasuredSquareSize(
  ref: RefObject<HTMLElement>,
  fallbackSize: number
): number {
  const [size, setSize] = useState(fallbackSize);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      const next = Math.round(Math.max(96, Math.min(220, rect.width || fallbackSize)));
      setSize((current) => current === next ? current : next);
    };

    updateSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fallbackSize, ref]);

  return size;
}
