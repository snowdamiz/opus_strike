import { useEffect, useState, useRef } from 'react';
import { PerfHeadless, usePerf } from 'r3f-perf';
import { useGameStore } from '../../store/gameStore';
import { visualStore } from '../../store/visualStore';
import { useSettingsStore } from '../../store/settingsStore';
import { getClientPerfSnapshot, type ClientPerfSnapshot } from '../../utils/perfMarks';

/**
 * Custom Performance Monitor - Premium Debug UI
 * 
 * Uses r3f-perf headless mode for data, with fully custom UI
 * matching the game's cyberpunk/neon aesthetic.
 * 
 */

interface PerfData {
  fps: number;
  gpu: number;
  cpu: number;
  triangles: number;
  geometries: number;
  textures: number;
  shaders: number;
  calls: number;
  client: ClientPerfSnapshot;
}

const EMPTY_CLIENT_SNAPSHOT: ClientPerfSnapshot = {
  frame: {
    frameMsP50: 0,
    frameMsP95: 0,
    frameMsP99: 0,
    sampleCount: 0,
  },
  network: {
    messagesPerSecond: {},
    bytesPerSecond: {},
  },
  systems: [],
  recentSpawns: [],
  voxelWorld: {
    generationMs: 0,
    meshBuildMsP95: 0,
    meshBuildCount: 0,
    totalChunkSlots: 0,
    renderableChunks: 0,
    renderableRegions: 0,
    emptyChunkSlots: 0,
    colliders: 0,
  },
  physicsQueries: {
    countPerSecond: 0,
    msPerSecond: 0,
  },
  activeEffects: 0,
  projectileCounts: {},
  temporaryColliders: 0,
  activeFrameSystems: 0,
  activeLights: 0,
};

function PerfDisplay() {
  const [data, setData] = useState<PerfData>({
    fps: 0, gpu: 0, cpu: 0,
    triangles: 0, geometries: 0, textures: 0, shaders: 0, calls: 0,
    client: EMPTY_CLIENT_SNAPSHOT,
  });

  // Get local player position from visualStore (polled for live updates)
  const playerId = useGameStore((state) => state.playerId);
  const [position, setPosition] = useState({ x: 0, y: 0, z: 0 });

  // Use ref to track if component is mounted
  const isMounted = useRef(true);

  // Subscribe to perf log updates (FPS, GPU, CPU)
  const log = usePerf((state) => state.log);
  // Subscribe to gl info (triangles, geometries, textures, etc.)
  const gl = usePerf((state) => state.gl);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Update data when log or gl changes
  useEffect(() => {
    if (isMounted.current) {
      setData({
        fps: Math.round(log?.fps || 0),
        gpu: log?.gpu || 0,
        cpu: log?.cpu || 0,
        triangles: gl?.info?.render?.triangles || 0,
        geometries: gl?.info?.memory?.geometries || 0,
        textures: gl?.info?.memory?.textures || 0,
        shaders: gl?.info?.programs?.length || 0,
        calls: gl?.info?.render?.calls || 0,
        client: getClientPerfSnapshot(),
      });
    }
  }, [log, gl]);

  // Poll visualStore for live position updates (10fps is enough for debug display)
  useEffect(() => {
    if (!playerId) return;

    const interval = setInterval(() => {
      if (isMounted.current) {
        const pos = visualStore.getState().playerPositions.get(playerId);
        if (pos) {
          setPosition({ x: pos.x, y: pos.y, z: pos.z });
        }
      }
    }, 100); // 10fps polling

    return () => clearInterval(interval);
  }, [playerId]);

  // Color based on FPS
  const getFpsColor = (fps: number) => {
    if (fps >= 55) return 'text-green-400';
    if (fps >= 30) return 'text-yellow-400';
    return 'text-red-400';
  };

  // Color based on GPU time (lower is better)
  const getGpuColor = (gpu: number) => {
    if (gpu < 8) return 'text-green-400';
    if (gpu < 16) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="fixed top-2.5 left-2.5 z-[9000] font-mono text-xs select-none pointer-events-none">
      {/* Main panel */}
      <div className="bg-black/85 backdrop-blur-sm border border-white/10 rounded-lg p-3 shadow-lg min-w-[200px]">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/10">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-white/60 uppercase tracking-wider text-[10px]">Performance</span>
        </div>

        {/* Primary Stats Row */}
        <div className="grid grid-cols-3 gap-3 mb-3">
          {/* FPS */}
          <div className="text-center">
            <div className={`text-2xl font-bold ${getFpsColor(data.fps)}`}>
              {data.fps}
            </div>
            <div className="text-white/40 text-[9px] uppercase">FPS</div>
          </div>

          {/* GPU */}
          <div className="text-center">
            <div className={`text-lg font-semibold ${getGpuColor(data.gpu)}`}>
              {data.gpu.toFixed(1)}
              <span className="text-[10px] text-white/40 ml-0.5">ms</span>
            </div>
            <div className="text-white/40 text-[9px] uppercase">GPU</div>
          </div>

          {/* CPU */}
          <div className="text-center">
            <div className="text-lg font-semibold text-cyan-400">
              {data.cpu.toFixed(1)}
              <span className="text-[10px] text-white/40 ml-0.5">ms</span>
            </div>
            <div className="text-white/40 text-[9px] uppercase">CPU</div>
          </div>
        </div>

        {/* Secondary Stats Grid */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[10px]">
          <div className="flex justify-between gap-3">
            <span className="text-white/40 shrink-0">Triangles</span>
            <span className="text-white/70 tabular-nums text-right">{data.triangles.toLocaleString()}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-white/40 shrink-0">Draw Calls</span>
            <span className="text-white/70 tabular-nums text-right">{data.calls}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-white/40 shrink-0">Geometries</span>
            <span className="text-white/70 tabular-nums text-right">{data.geometries}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-white/40 shrink-0">Textures</span>
            <span className="text-white/70 tabular-nums text-right">{data.textures}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-white/40 shrink-0">Shaders</span>
            <span className="text-white/70 tabular-nums text-right">{data.shaders}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-white/40 shrink-0">Frame p95</span>
            <span className="text-white/70 tabular-nums text-right">{data.client.frame.frameMsP95.toFixed(1)}ms</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-white/40 shrink-0">Effects</span>
            <span className="text-white/70 tabular-nums text-right">{data.client.activeEffects}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-white/40 shrink-0">Lights</span>
            <span className="text-white/70 tabular-nums text-right">{data.client.activeLights}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-white/40 shrink-0">Chunks</span>
            <span className="text-white/70 tabular-nums text-right">
              {data.client.voxelWorld.renderableChunks}/{data.client.voxelWorld.totalChunkSlots}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-white/40 shrink-0">Regions</span>
            <span className="text-white/70 tabular-nums text-right">{data.client.voxelWorld.renderableRegions}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-white/40 shrink-0">Colliders</span>
            <span className="text-white/70 tabular-nums text-right">{data.client.voxelWorld.colliders}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-white/40 shrink-0">Physics Q/s</span>
            <span className="text-white/70 tabular-nums text-right">{data.client.physicsQueries.countPerSecond.toFixed(0)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-white/40 shrink-0">Mesh p95</span>
            <span className="text-white/70 tabular-nums text-right">{data.client.voxelWorld.meshBuildMsP95.toFixed(1)}ms</span>
          </div>
        </div>

        <div className="mt-3 pt-2 border-t border-white/10">
          <div className="text-white/40 text-[9px] uppercase mb-1.5">Effects</div>
          <div className="grid grid-cols-1 gap-y-1.5 text-[10px]">
            {data.client.systems.length === 0 && (
              <div className="text-white/40">idle</div>
            )}
            {data.client.systems.map((system) => (
              <div key={system.name} className="flex justify-between gap-3">
                <span className="text-white/40 shrink-0">{system.name}</span>
                <span className="text-white/70 tabular-nums text-right">
                  {system.p95Ms.toFixed(2)}ms p95
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 pt-2 border-t border-white/10">
          <div className="text-white/40 text-[9px] uppercase mb-1.5">Network</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[10px]">
            {Object.keys(data.client.network.messagesPerSecond).length === 0 && (
              <div className="text-white/40">idle</div>
            )}
            {Object.entries(data.client.network.messagesPerSecond).map(([type, count]) => (
              <div key={type} className="flex justify-between gap-3">
                <span className="text-white/40 shrink-0">{type}</span>
                <span className="text-white/70 tabular-nums text-right">
                  {count}/s {Math.round(data.client.network.bytesPerSecond[type] ?? 0)}B
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Position Section */}
        <div className="mt-3 pt-2 border-t border-white/10">
          <div className="text-white/40 text-[9px] uppercase mb-1.5">Position</div>
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <div className="text-center">
              <span className="text-white/40">X</span>
              <div className="text-cyan-400 tabular-nums">{position.x.toFixed(1)}</div>
            </div>
            <div className="text-center">
              <span className="text-white/40">Y</span>
              <div className="text-cyan-400 tabular-nums">{position.y.toFixed(1)}</div>
            </div>
            <div className="text-center">
              <span className="text-white/40">Z</span>
              <div className="text-cyan-400 tabular-nums">{position.z.toFixed(1)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FpsOnlyDisplay() {
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let frameCount = 0;
    let lastSampleAt = performance.now();
    let rafId = 0;

    const update = (now: number) => {
      frameCount++;
      const elapsed = now - lastSampleAt;

      if (elapsed >= 250) {
        setFps(Math.round((frameCount * 1000) / elapsed));
        frameCount = 0;
        lastSampleAt = now;
      }

      rafId = window.requestAnimationFrame(update);
    };

    rafId = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  return (
    <div
      aria-label={`FPS ${fps}`}
      className="fixed top-2.5 right-3 z-[9000] select-none pointer-events-none font-mono text-sm font-semibold leading-none text-white tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
    >
      {fps}
    </div>
  );
}

export function PerfMonitor() {
  const debugMode = useGameStore((state) => state.debugMode);
  const showFPS = useSettingsStore((state) => state.settings.showFPS);

  if (!debugMode && showFPS !== 'full') return null;

  return <PerfHeadless />;
}

// Separate component to render outside Canvas context
export function PerfMonitorOverlay() {
  const debugMode = useGameStore((state) => state.debugMode);
  const showFPS = useSettingsStore((state) => state.settings.showFPS);

  if (debugMode || showFPS === 'full') return <PerfDisplay />;
  if (showFPS === 'fps') return <FpsOnlyDisplay />;

  return null;
}

export default PerfMonitor;
