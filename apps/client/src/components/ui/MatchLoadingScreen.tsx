import { useEffect, useState } from 'react';
import { LobbyBackdrop } from './LobbyBackdrop';

interface MatchLoadingScreenProps {
  isComplete?: boolean;
}

export function MatchLoadingScreen({ isComplete = false }: MatchLoadingScreenProps) {
  const [progress, setProgress] = useState(8);

  useEffect(() => {
    if (isComplete) {
      setProgress(100);
      return;
    }

    const interval = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 92) return current;
        const increment = current < 50 ? 5.5 : current < 76 ? 2.2 : 0.65;
        return Math.min(92, current + increment);
      });
    }, 140);

    return () => window.clearInterval(interval);
  }, [isComplete]);

  const percent = Math.round(progress);

  return (
    <div className="absolute inset-0 z-overlay overflow-hidden bg-strike-bg">
      <LobbyBackdrop />

      <main className="absolute inset-0 z-10 flex items-center justify-center px-6">
        <div className="w-full max-w-2xl">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="font-body text-[11px] uppercase tracking-[0.34em] text-white/35">
                Match
              </p>
              <h1 className="mt-2 font-display text-5xl leading-none text-white sm:text-6xl">
                LOADING ARENA
              </h1>
            </div>
            <div className="shrink-0 font-mono text-2xl font-semibold tabular-nums text-orange-400 sm:text-3xl">
              {percent.toString().padStart(2, '0')}%
            </div>
          </div>

          <div
            className="relative h-4 overflow-hidden rounded-lg border border-white/10 bg-black/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
            role="progressbar"
            aria-label="Loading match"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-md bg-gradient-to-r from-orange-500 via-amber-300 to-cyan-300 transition-[width] duration-200 ease-out"
              style={{
                width: `${percent}%`,
                boxShadow: '0 0 28px rgb(var(--color-accent-primary) / 0.55)',
              }}
            />
            <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          </div>

          <div className="mt-4 flex items-center justify-between gap-4 font-body text-[11px] uppercase tracking-[0.26em] text-white/35">
            <span>World</span>
            <span>Systems</span>
            <span>Spawn</span>
          </div>
        </div>
      </main>
    </div>
  );
}
