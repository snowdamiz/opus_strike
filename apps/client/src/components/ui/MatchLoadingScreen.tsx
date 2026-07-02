import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { LobbyBackdrop } from './LobbyBackdrop';

export const MATCH_LOADING_INITIAL_PROGRESS = 8;
const MATCH_LOADING_MAX_IN_PROGRESS = 99;
const MATCH_LOADING_FALLBACK_TARGET_PROGRESS = 92;

interface MatchLoadingStage {
  id: string;
  label: string;
  partialProgress?: number;
  done: boolean;
  detail?: string;
}

interface MatchLoadingScreenProps {
  isComplete?: boolean;
  progress?: number;
  label?: string;
  fallbackProgressCap?: number;
  eyebrow?: string;
  title?: string;
  initialProgress?: number;
  ariaLabel?: string;
  trackStartLabel?: string;
  trackEndLabel?: string;
  stages?: MatchLoadingStage[];
  actionLabel?: string;
  onAction?: () => void;
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
  fallbackProgressCap = MATCH_LOADING_FALLBACK_TARGET_PROGRESS,
  eyebrow = 'Match',
  title = 'LOADING ARENA',
  initialProgress = MATCH_LOADING_INITIAL_PROGRESS,
  ariaLabel = 'Loading match',
  trackStartLabel = 'World',
  trackEndLabel = 'Spawn',
  stages,
  actionLabel,
  onAction,
  onProgressChange,
}: MatchLoadingScreenProps) {
  const [progress, setProgress] = useState(() => clampLoadingProgress(initialProgress));
  const activeStage = stages?.find((stage) => !stage.done) ?? stages?.at(-1);
  const statusLabel = activeStage?.detail ?? label;
  const targetProgress = isComplete
    ? 100
    : typeof coordinatorProgress === 'number'
      ? Math.min(MATCH_LOADING_MAX_IN_PROGRESS, clampLoadingProgress(coordinatorProgress * 100))
      : fallbackProgressCap;

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
                {eyebrow}
              </p>
              <h1 className="mt-2 font-display text-5xl leading-none text-white sm:text-6xl">
                {title}
              </h1>
            </div>
            <div className="shrink-0 font-mono text-2xl font-semibold tabular-nums text-orange-400 sm:text-3xl">
              {percent.toString().padStart(2, '0')}%
            </div>
          </div>

          <div
            className="relative h-4 overflow-hidden rounded-lg border border-white/10 bg-black/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
            role="progressbar"
            aria-label={ariaLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={`${percent}% ${statusLabel}`}
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
            <span>{trackStartLabel}</span>
            <span className="min-w-0 truncate text-center">{statusLabel}</span>
            <span>{trackEndLabel}</span>
          </div>

          {stages?.length ? (
            <div className="mt-6 grid gap-2 sm:grid-cols-3">
              {stages.map((stage) => {
                const isActive = stage.id === activeStage?.id && !stage.done;
                const stageProgress = stage.done
                  ? 100
                  : Math.round(Math.min(1, Math.max(0, stage.partialProgress ?? 0)) * 100);
                return (
                  <div
                    key={stage.id}
                    className={`border border-white/10 bg-black/35 px-3 py-2 ${isActive ? 'text-white' : 'text-white/40'}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-body text-[10px] uppercase tracking-[0.22em]">
                        {stage.label}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] tabular-nums">
                        {stage.done ? 'OK' : `${stageProgress}%`}
                      </span>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden bg-white/10">
                      <div
                        className={`h-full ${stage.done ? 'bg-cyan-300' : isActive ? 'bg-orange-400' : 'bg-white/25'}`}
                        style={{ width: `${stage.done ? 100 : stageProgress}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {actionLabel && onAction ? (
            <div className="mt-7 flex justify-center">
              <button
                type="button"
                onClick={onAction}
                className="inline-flex h-10 items-center gap-2 border border-white/15 bg-black/45 px-4 font-display text-xs uppercase tracking-[0.18em] text-white/80 shadow-[0_12px_30px_rgba(0,0,0,0.3)] transition hover:border-orange-300/70 hover:bg-orange-500/15 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span>{actionLabel}</span>
              </button>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
