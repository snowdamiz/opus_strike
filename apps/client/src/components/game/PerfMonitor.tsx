import { useEffect, useState } from 'react';
import { config } from '../../config/environment';
import { useSettingsStore } from '../../store/settingsStore';

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
  return showFPS === 'fps' ? <FpsCounter /> : null;
}

export function PerfMonitorOverlay() {
  return config.clientDiagnosticsEnabled ? <EnabledPerfMonitorOverlay /> : null;
}

export default PerfMonitor;
