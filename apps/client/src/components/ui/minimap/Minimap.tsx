import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useShallow } from 'zustand/shallow';
import type { Player, VoxelMapManifest } from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { visualStore } from '../../../store/visualStore';
import { MINIMAP_COLORS } from '../../../styles/colorTokens';
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
  const { localPlayer, mapSeed, mapThemeId, isPracticeMode } = useGameStore(
    useShallow((state) => ({
      localPlayer: state.localPlayer,
      mapSeed: state.mapSeed,
      mapThemeId: state.mapThemeId,
      isPracticeMode: state.isPracticeMode,
    }))
  );

  const preparedMap = useMemo(() => (
    getPreparedVoxelMap({ seed: mapSeed, themeId: mapThemeId }) ?? prepareVoxelMapCpu({ seed: mapSeed, themeId: mapThemeId, source: 'match' })
  ), [mapSeed, mapThemeId]);
  const manifest = preparedMap.manifest;
  const localPlayerId = localPlayer?.id ?? null;
  const localPlayerTeam = localPlayer?.team ?? null;
  const projection = useMemo(() => (
    createMinimapProjection(getMinimapBounds(manifest), size, MINIMAP_PADDING)
  ), [manifest, size]);

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

    let rafId = 0;
    let lastDrawAt = 0;
    const draw = (now: number) => {
      if (now - lastDrawAt >= LIVE_OVERLAY_FRAME_MS) {
        lastDrawAt = now;
        drawLiveOverlay(ctx, manifest, projection, size, devicePixelRatio);
      }
      rafId = window.requestAnimationFrame(draw);
    };

    draw(performance.now());

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [devicePixelRatio, isPracticeMode, localPlayerId, localPlayerTeam, manifest, projection, size]);

  if (!localPlayer) return null;

  return (
    <div
      ref={containerRef}
      className="absolute left-3 top-3 sm:left-4 sm:top-4 pointer-events-none z-[125] aspect-square w-[clamp(7.75rem,13vw,10.75rem)] select-none"
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
  clipToBoundary(ctx, manifest, projection);

  const visualState = visualStore.getState();
  const teammates = selectVisibleTeammates(localPlayer, store.players.values(), liveOverlayTeammatesScratch);
  const teamColor = store.isPracticeMode ? MINIMAP_COLORS.live.practiceTeam : getTeamColor(localPlayer.team);

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
  manifest: VoxelMapManifest,
  projection: MinimapProjection
): void {
  if (manifest.boundary.length < 3) {
    ctx.beginPath();
    ctx.rect(0, 0, projection.size, projection.size);
    ctx.clip();
    return;
  }

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
  ctx.clip();
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

function directionFromYaw(yaw: number): { x: number; y: number } {
  return {
    x: -Math.sin(yaw),
    y: -Math.cos(yaw),
  };
}

function getTeamColor(team: Player['team']): string {
  return team === 'red' ? MINIMAP_COLORS.team.red : MINIMAP_COLORS.team.blue;
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
