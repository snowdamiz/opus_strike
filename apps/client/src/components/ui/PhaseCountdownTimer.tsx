import { memo, useEffect, useRef, useState } from 'react';

function ClockGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="8" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 2" />
    </svg>
  );
}

function getSecondsRemaining(phaseEndTime: number | null): number | null {
  if (!phaseEndTime) return null;
  return Math.max(0, Math.ceil((phaseEndTime - Date.now()) / 1000));
}

interface PhaseCountdownTimerProps {
  phaseEndTime: number | null;
  disabled?: boolean;
  onExpired?: () => void;
  className?: string;
}

export const PhaseCountdownTimer = memo(function PhaseCountdownTimer({
  phaseEndTime,
  disabled = false,
  onExpired,
  className = '',
}: PhaseCountdownTimerProps) {
  const [timeRemaining, setTimeRemaining] = useState(() => getSecondsRemaining(phaseEndTime));
  const didExpireRef = useRef(false);

  useEffect(() => {
    didExpireRef.current = false;
  }, [phaseEndTime]);

  useEffect(() => {
    const updateTimer = () => {
      const remaining = getSecondsRemaining(phaseEndTime);
      setTimeRemaining((current) => (current === remaining ? current : remaining));

      if (remaining !== null && remaining <= 0 && !disabled && !didExpireRef.current) {
        didExpireRef.current = true;
        onExpired?.();
      }
    };

    updateTimer();
    const interval = window.setInterval(updateTimer, 250);
    return () => window.clearInterval(interval);
  }, [disabled, onExpired, phaseEndTime]);

  return (
    <div className={`pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 text-white drop-shadow-[0_4px_18px_rgba(0,0,0,0.55)] ${className}`}>
      <ClockGlyph className="h-5 w-5 text-accent-secondary" />
      <span className="font-display translate-y-[0.08em] text-3xl leading-none tabular-nums text-white">
        {timeRemaining === null ? '...' : timeRemaining}
      </span>
    </div>
  );
});
