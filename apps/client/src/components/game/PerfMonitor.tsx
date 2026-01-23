import { useEffect, useState, useRef } from 'react';
import { PerfHeadless, usePerf } from 'r3f-perf';
import { useGameStore } from '../../store/gameStore';

/**
 * Custom Performance Monitor - Premium Debug UI
 * 
 * Uses r3f-perf headless mode for data, with fully custom UI
 * matching the game's cyberpunk/neon aesthetic.
 * 
 * Toggle with /debug command in chat
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
}

function PerfDisplay() {
  const [data, setData] = useState<PerfData>({
    fps: 0, gpu: 0, cpu: 0,
    triangles: 0, geometries: 0, textures: 0, shaders: 0, calls: 0
  });

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
      });
    }
  }, [log, gl]);

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
        </div>
      </div>
    </div>
  );
}

export function PerfMonitor() {
  const debugMode = useGameStore((state) => state.debugMode);

  if (!debugMode) return null;

  return <PerfHeadless />;
}

// Separate component to render outside Canvas context
export function PerfMonitorOverlay() {
  const debugMode = useGameStore((state) => state.debugMode);

  if (!debugMode) return null;

  return <PerfDisplay />;
}

export default PerfMonitor;

