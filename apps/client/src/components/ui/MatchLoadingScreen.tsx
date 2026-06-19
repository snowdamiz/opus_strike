import { useEffect, useState } from 'react';
import { LobbyBackdrop } from './LobbyBackdrop';

export const MATCH_LOADING_INITIAL_PROGRESS = 8;
const MATCH_LOADING_MAX_IN_PROGRESS = 99;
const MATCH_LOADING_FAKE_TARGET_PROGRESS = 92;

interface MatchLoadingScreenProps {
  isComplete?: boolean;
  progress?: number;
  label?: string;
  initialProgress?: number;
  onProgressChange?: (progress: number) => void;
}

function clampLoadingProgress(progress: number): number {
  if (!Number.isFinite(progress)) return MATCH_LOADING_INITIAL_PROGRESS;
  return Math.min(100, Math.max(MATCH_LOADING_INITIAL_PROGRESS, progress));
}

export function MatchLoadingScreen({
  isComplete = false,
  progress: coordinatorProgress,
  label = 'Systems',
  initialProgress = MATCH_LOADING_INITIAL_PROGRESS,
  onProgressChange,
}: MatchLoadingScreenProps) {
  const [progress, setProgress] = useState(() => clampLoadingProgress(initialProgress));
  const targetProgress = isComplete
    ? 100
    : typeof coordinatorProgress === 'number'
      ? Math.min(MATCH_LOADING_MAX_IN_PROGRESS, clampLoadingProgress(coordinatorProgress * 100))
      : MATCH_LOADING_FAKE_TARGET_PROGRESS;

  useEffect(() => {
    if (isComplete) {
      setProgress(100);
      return;
    }

    const interval = window.setInterval(() => {
      setProgress((current) => {
        if (current >= targetProgress) return current;
        const increment = current < 50 ? 5.5 : current < 76 ? 2.2 : 0.65;
        return Math.min(targetProgress, current + increment);
      });
    }, 140);

    return () => window.clearInterval(interval);
  }, [isComplete, targetProgress]);

  useEffect(() => {
    setProgress((current) => Math.max(current, Math.min(targetProgress, current + 0.01)));
  }, [targetProgress]);

  useEffect(() => {
    setProgress((current) => Math.max(current, clampLoadingProgress(initialProgress)));
  }, [initialProgress]);

  useEffect(() => {
    onProgressChange?.(progress);
  }, [onProgressChange, progress]);

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
            <span>{label}</span>
            <span>Spawn</span>
          </div>
        </div>
      </main>
    </div>
  );
}
