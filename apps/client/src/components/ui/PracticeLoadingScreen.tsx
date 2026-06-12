import { useEffect, useState } from 'react';
import { LobbyBackdrop } from './LobbyBackdrop';

export function PracticeLoadingScreen() {
  const [progress, setProgress] = useState(18);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setProgress((current) => Math.min(94, current + (current < 60 ? 4.5 : 1.2)));
    }, 140);

    return () => window.clearInterval(interval);
  }, []);

  const percent = Math.round(progress);

  return (
    <div className="menu-screen overflow-hidden bg-strike-bg">
      <LobbyBackdrop />

      <main className="absolute inset-0 z-10 flex items-center justify-center px-6">
        <div className="w-full max-w-2xl">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="font-body text-[11px] uppercase tracking-[0.34em] text-cyan-200/55">
                Practice
              </p>
              <h1 className="mt-2 font-display text-5xl leading-none text-white sm:text-6xl">
                GENERATING MAP
              </h1>
            </div>
            <div className="shrink-0 font-mono text-2xl font-semibold tabular-nums text-cyan-200 sm:text-3xl">
              {percent.toString().padStart(2, '0')}%
            </div>
          </div>

          <div
            className="relative h-4 overflow-hidden rounded-lg border border-cyan-200/15 bg-black/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
            role="progressbar"
            aria-label="Preparing practice map"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-md bg-gradient-to-r from-cyan-400 via-amber-200 to-orange-400 transition-[width] duration-200 ease-out"
              style={{
                width: `${percent}%`,
                boxShadow: '0 0 28px rgb(var(--color-accent-secondary) / 0.45)',
              }}
            />
            <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          </div>

          <div className="mt-4 flex items-center justify-between gap-4 font-body text-[11px] uppercase tracking-[0.26em] text-white/35">
            <span>Seed</span>
            <span>Terrain</span>
            <span>Spawn</span>
          </div>
        </div>
      </main>
    </div>
  );
}
