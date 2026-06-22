import { useEffect, useState } from 'react';
import { config } from '../../config/environment';
import { useSettingsStore } from '../../store/settingsStore';
import { getMovementNetworkDiagnosticsSnapshot } from '../../movement/networkDiagnostics';

function FpsCounter() {
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
  return null;
}

function EnabledPerfMonitorOverlay() {
  const showFPS = useSettingsStore((state) => state.settings.showFPS);
  const [diagnostics, setDiagnostics] = useState(() => getMovementNetworkDiagnosticsSnapshot());

  useEffect(() => {
    if (showFPS !== 'fps') return undefined;

    const interval = window.setInterval(() => {
      setDiagnostics(getMovementNetworkDiagnosticsSnapshot());
    }, 500);
    return () => window.clearInterval(interval);
  }, [showFPS]);

  if (showFPS !== 'fps') return null;

  const { renderer, terrainRenderer } = diagnostics;
  return (
    <>
      <FpsCounter />
      <div className="fixed top-8 right-3 z-[9000] w-[252px] select-none rounded bg-black/70 px-3 py-2 font-mono text-[10px] leading-4 text-white shadow-lg backdrop-blur pointer-events-none">
        <div className="flex justify-between gap-3">
          <span>frame</span>
          <span>{renderer.frameP50Ms.toFixed(0)} / {renderer.frameP95Ms.toFixed(0)} / {renderer.frameMaxMs.toFixed(0)} ms</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>draws / tris</span>
          <span>{Math.round(renderer.drawCalls)} / {Math.round(renderer.triangles / 1000)}k</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>geo / tex</span>
          <span>{renderer.geometries} / {renderer.textures}</span>
        </div>
        <div className="mt-1 border-t border-white/15 pt-1">
          <div className="flex justify-between gap-3">
            <span>terrain</span>
            <span>{terrainRenderer.visibleRegionCount} visible</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>full / coarse / ultra</span>
            <span>{terrainRenderer.fullDetailRegionCount} / {terrainRenderer.coarseRegionCount} / {terrainRenderer.ultraCoarseRegionCount}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>macro</span>
            <span>{terrainRenderer.macroMeshCount} meshes / {terrainRenderer.macroRegionCount} regions</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>hidden d/f/h</span>
            <span>{terrainRenderer.hiddenByDistance} / {terrainRenderer.hiddenByFrustum} / {terrainRenderer.hiddenByHorizon}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>swaps / builds</span>
            <span>{terrainRenderer.detailSwapsPerSecond}/s / {terrainRenderer.geometryBuildsPerSecond}/s</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>finalize / pending</span>
            <span>{terrainRenderer.geometryFinalizationsPerSecond}/s / {terrainRenderer.pendingRegionBuilds}+{terrainRenderer.pendingRegionFinalizations}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>br scale</span>
            <span>{terrainRenderer.adaptiveVisibilityScale.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </>
  );
}

export function PerfMonitorOverlay() {
  return config.clientDiagnosticsEnabled ? <EnabledPerfMonitorOverlay /> : null;
}

export default PerfMonitor;
