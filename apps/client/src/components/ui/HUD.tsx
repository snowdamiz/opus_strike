import { useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useShallow } from 'zustand/shallow';
import {
  ABILITY_DEFINITIONS,
  PHANTOM_PRIMARY_MAGAZINE_SIZE,
  PHANTOM_PRIMARY_RELOAD_MS,
  VOID_RAY_CHARGE_TIME,
} from '@voxel-strike/shared';
import { getHeroSkillItems, HeroSkillIcon, type HeroSkillItem } from './HeroSkillKit';
import { useCombatFeedbackStore, type KillFeedEvent } from '../../store/combatFeedbackStore';
import { useSettingsStore, type CrosshairStyle } from '../../store/settingsStore';
import { useHudNow } from '../../store/hudSignals';
import { FACTIONS, HUD_HERO_COLORS as HERO_COLORS } from '../../styles/colorTokens';
import { Minimap } from './minimap/Minimap';
import { VoiceHud } from './VoiceHud';

// Solar Icon - Small version for HUD
function SolarIconSmall({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <path d="M12 3V6M12 18V21M3 12H6M18 12H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5.64 5.64L7.76 7.76M16.24 16.24L18.36 18.36M5.64 18.36L7.76 16.24M16.24 7.76L18.36 5.64" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// Void Icon - Small version for HUD
function VoidIconSmall({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <path d="M12 3C7.03 3 3 7.03 3 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 2" />
      <path d="M21 12C21 16.97 16.97 21 12 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 2" />
    </svg>
  );
}

function FloatingFlagIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <g opacity="0.3">
        <path
          d="M15 39V9.5"
          stroke="#fff"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M17 10.5c5.8-2.9 10.7 2.2 17-.7v18.6c-6.3 2.9-11.2-2.3-17 .7V10.5Z"
          fill="#fff"
          stroke="#fff"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M17 10.5c5.8-2.9 10.7 2.2 17-.7v5.6c-6.3 2.9-11.2-2.2-17 .7v-5.6Z"
          fill="#fff"
        />
        <path
          d="M15 39h7"
          stroke="#fff"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

function JetpackChargeIcon({ active }: { active: boolean }) {
  return (
    <div
      className="relative grid h-9 w-9 place-items-center rounded-full overflow-hidden"
      style={{
        background: active
          ? 'linear-gradient(145deg, rgba(255, 237, 213, 0.26), rgba(249, 115, 22, 0.22) 48%, rgba(15, 23, 42, 0.28))'
          : 'linear-gradient(145deg, rgba(255,255,255,0.14), rgba(249, 115, 22, 0.11) 52%, rgba(15, 23, 42, 0.2))',
        border: active
          ? '1px solid rgba(253, 186, 116, 0.58)'
          : '1px solid rgba(255, 237, 213, 0.22)',
        boxShadow: active
          ? '0 0 20px rgba(249, 115, 22, 0.42), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -10px 18px rgba(124,45,18,0.24)'
          : '0 0 14px rgba(249, 115, 22, 0.18), inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -10px 18px rgba(15,23,42,0.18)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(circle at 32% 22%, rgba(255,255,255,0.42), transparent 34%)',
          opacity: active ? 0.92 : 0.58,
        }}
      />
      <svg
        className="relative h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M8.2 7.2C8.2 4.9 9.7 3 12 3s3.8 1.9 3.8 4.2v7.4c0 .8-.6 1.4-1.4 1.4H9.6c-.8 0-1.4-.6-1.4-1.4V7.2Z"
          fill={active ? 'rgba(255, 247, 237, 0.9)' : 'rgba(255, 237, 213, 0.72)'}
        />
        <path
          d="M10.1 8.1h3.8M9.6 16l-1.7 2.8M14.4 16l1.7 2.8M7.9 10.1l-2.1 1.6v4.1M16.1 10.1l2.1 1.6v4.1"
          stroke={active ? '#fed7aa' : 'rgba(253, 186, 116, 0.82)'}
          strokeWidth="1.45"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M10.3 20.6 12 17.2l1.7 3.4"
          stroke={active ? '#fb923c' : 'rgba(251, 146, 60, 0.68)'}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function BlazeFuelIndicator({ fuel, active }: { fuel: number; active: boolean }) {
  const fuelPercent = Math.max(0, Math.min(100, fuel));

  return (
    <div className="mt-1 flex items-center gap-2.5">
      <JetpackChargeIcon active={active} />
      <div className="relative h-2 w-24 overflow-hidden rounded-full">
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04)), rgba(15,23,42,0.34)',
            border: '1px solid rgba(255, 237, 213, 0.16)',
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.46)',
            backdropFilter: 'blur(8px)',
          }}
        />
        <div
          className="relative h-full w-full origin-left rounded-full transition-transform duration-100"
          style={{
            transform: `scaleX(${fuelPercent / 100})`,
            background: active
              ? 'linear-gradient(90deg, #f97316 0%, #fb923c 42%, #fde68a 100%)'
              : 'linear-gradient(90deg, #ea580c 0%, #f97316 50%, #fbbf24 100%)',
            boxShadow: active
              ? '0 0 12px rgba(251, 146, 60, 0.74), inset 0 1px 0 rgba(255,255,255,0.42)'
              : '0 0 8px rgba(249, 115, 22, 0.42), inset 0 1px 0 rgba(255,255,255,0.28)',
          }}
        />
      </div>
    </div>
  );
}

const VOID_RAY_RING_CIRCUMFERENCE = 2 * Math.PI * 28;

function VoidRayChargeIndicator({ chargeStart }: { chargeStart: number }) {
  const progressCircleRef = useRef<SVGCircleElement | null>(null);
  const labelRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    let frameId = 0;
    let wasReady = false;
    let lastLabel = '';

    const updateProgress = () => {
      const progress = Math.min(1, (Date.now() - chargeStart) / VOID_RAY_CHARGE_TIME);
      const isReady = progress >= 1;
      const circle = progressCircleRef.current;
      const label = labelRef.current;

      if (circle) {
        circle.style.strokeDashoffset = String(VOID_RAY_RING_CIRCUMFERENCE * (1 - progress));
        if (isReady !== wasReady) {
          circle.setAttribute('stroke', isReady ? '#00ffff' : '#9333ea');
          circle.style.filter = isReady ? 'drop-shadow(0 0 6px #00ffff)' : 'drop-shadow(0 0 4px #9333ea)';
        }
      }

      if (label) {
        const nextLabel = isReady ? 'FIRE' : `${Math.floor(progress * 100)}%`;
        if (nextLabel !== lastLabel) {
          label.textContent = nextLabel;
          lastLabel = nextLabel;
        }
        if (isReady !== wasReady) {
          label.className = `font-mono text-sm font-bold ${isReady ? 'text-cyan-300' : 'text-white/80'}`;
          label.style.textShadow = isReady ? '0 0 8px #00ffff' : '0 2px 4px rgba(0,0,0,0.8)';
        }
      }

      wasReady = isReady;
      if (!isReady) {
        frameId = requestAnimationFrame(updateProgress);
      }
    };

    updateProgress();
    return () => {
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [chargeStart]);

  const initialProgress = Math.min(1, (Date.now() - chargeStart) / VOID_RAY_CHARGE_TIME);
  const initialReady = initialProgress >= 1;

  return (
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50">
      <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
        {/* Background ring */}
        <circle
          cx="36"
          cy="36"
          r="28"
          fill="none"
          stroke="rgba(0, 0, 0, 0.4)"
          strokeWidth="4"
        />
        {/* Progress ring */}
        <circle
          ref={progressCircleRef}
          cx="36"
          cy="36"
          r="28"
          fill="none"
          stroke={initialReady ? '#00ffff' : '#9333ea'}
          strokeWidth="4"
          strokeDasharray={VOID_RAY_RING_CIRCUMFERENCE}
          strokeDashoffset={VOID_RAY_RING_CIRCUMFERENCE * (1 - initialProgress)}
          strokeLinecap="round"
          style={{
            filter: initialReady ? 'drop-shadow(0 0 6px #00ffff)' : 'drop-shadow(0 0 4px #9333ea)',
            transition: 'stroke 0.1s',
          }}
        />
      </svg>
      {/* Center text */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          ref={labelRef}
          className={`font-mono text-sm font-bold ${initialReady ? 'text-cyan-300' : 'text-white/80'}`}
          style={{ textShadow: initialReady ? '0 0 8px #00ffff' : '0 2px 4px rgba(0,0,0,0.8)' }}
        >
          {initialReady ? 'FIRE' : `${Math.floor(initialProgress * 100)}%`}
        </span>
      </div>
    </div>
  );
}

function NormalCrosshair({ crosshairStyle, color }: { crosshairStyle: CrosshairStyle; color: string }) {
  const lineOpacity = crosshairStyle === 'cross' ? 0.95 : 0.85;

  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      {(crosshairStyle === 'default' || crosshairStyle === 'dot') && (
        <circle cx="14" cy="14" r="2.2" fill={color} fillOpacity="0.95" />
      )}

      {crosshairStyle === 'circle' && (
        <>
          <circle cx="14" cy="14" r="5.5" stroke={color} strokeWidth="1.8" opacity="0.9" />
          <circle cx="14" cy="14" r="1.6" fill={color} fillOpacity="0.9" />
        </>
      )}

      {(crosshairStyle === 'default' || crosshairStyle === 'cross') && (
        <>
          <line x1="14" y1="3" x2="14" y2="8" stroke={color} strokeWidth="2" strokeLinecap="round" opacity={lineOpacity} />
          <line x1="14" y1="20" x2="14" y2="25" stroke={color} strokeWidth="2" strokeLinecap="round" opacity={lineOpacity} />
          <line x1="3" y1="14" x2="8" y2="14" stroke={color} strokeWidth="2" strokeLinecap="round" opacity={lineOpacity} />
          <line x1="20" y1="14" x2="25" y2="14" stroke={color} strokeWidth="2" strokeLinecap="round" opacity={lineOpacity} />
        </>
      )}
    </svg>
  );
}

function KillFeed({ events }: { events: KillFeedEvent[] }) {
  if (events.length === 0) return null;

  return (
    <div className="absolute top-24 right-5 z-[120] flex flex-col gap-2 items-end">
      {events.map((event) => (
        <div
          key={event.id}
          className="px-3 py-2 rounded-lg bg-black/55 border border-white/10 backdrop-blur-sm font-body text-xs text-white/75 shadow-lg animate-fade-in"
        >
          <span className="text-orange-300">{event.killerName}</span>
          <span className="mx-2 text-white/30">eliminated</span>
          <span className="text-cyan-200">{event.victimName}</span>
        </div>
      ))}
    </div>
  );
}

function formatHudTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function RoundTimer({
  gamePhase,
  phaseEndTime,
  roundTimeRemaining,
  gameClockFrozen,
}: {
  gamePhase: string;
  phaseEndTime: number | null;
  roundTimeRemaining: number;
  gameClockFrozen: boolean;
}) {
  const now = useHudNow();
  const displayedRoundTimeRemaining = gamePhase === 'playing' && !gameClockFrozen && phaseEndTime
    ? Math.max(0, Math.ceil((phaseEndTime - now) / 1000))
    : roundTimeRemaining;

  return (
    <span className={`font-mono text-base sm:text-lg lg:text-xl tracking-[0.12em] tabular-nums font-bold transition-colors ${displayedRoundTimeRemaining < 30 ? 'text-red-400 animate-pulse' :
        displayedRoundTimeRemaining < 60 ? 'text-amber-300' : 'text-white'
      }`}>
      {formatHudTime(displayedRoundTimeRemaining)}
    </span>
  );
}

interface ShotCounterTone {
  labelClass: string;
  readyClass: string;
  reloadClass: string;
  idleBackground: string;
  reloadBackground: string;
  idleBorder: string;
  reloadBorder: string;
  idleShadow: string;
  reloadShadow: string;
  idleFill: string;
  reloadFill: string;
  idleProgress: string;
  reloadProgress: string;
  idleStroke: string;
  reloadStroke: string;
  idleTextShadow: string;
  reloadTextShadow: string;
  reloadStrokeFilter: string;
  progressShadow: string;
}

const PHANTOM_SHOT_COUNTER_TONE: ShotCounterTone = {
  labelClass: 'text-violet-100/46',
  readyClass: 'text-white/92',
  reloadClass: 'text-violet-100',
  idleBackground: 'linear-gradient(135deg, rgba(31, 21, 48, 0.28), rgba(5, 5, 8, 0.22))',
  reloadBackground: 'linear-gradient(135deg, rgba(48, 31, 73, 0.36), rgba(7, 6, 11, 0.28))',
  idleBorder: '1px solid rgba(255, 255, 255, 0.08)',
  reloadBorder: '1px solid rgba(168, 85, 247, 0.38)',
  idleShadow: '0 8px 20px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255,255,255,0.06)',
  reloadShadow: '0 0 18px rgba(168, 85, 247, 0.18), 0 8px 20px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255,255,255,0.07)',
  idleFill: 'linear-gradient(90deg, rgba(168, 85, 247, 0.055), transparent)',
  reloadFill: 'linear-gradient(90deg, rgba(168, 85, 247, 0.12), rgba(34, 211, 238, 0.07))',
  idleProgress: 'linear-gradient(90deg, rgba(168, 85, 247, 0.54), rgba(216, 180, 254, 0.5))',
  reloadProgress: 'linear-gradient(90deg, rgba(34, 211, 238, 0.68), rgba(168, 85, 247, 0.42))',
  idleStroke: '#a855f7',
  reloadStroke: '#22d3ee',
  idleTextShadow: '0 2px 8px rgba(0,0,0,0.7)',
  reloadTextShadow: '0 0 10px rgba(168, 85, 247, 0.55)',
  reloadStrokeFilter: 'drop-shadow(0 0 4px rgba(34, 211, 238, 0.72))',
  progressShadow: '0 0 8px rgba(34, 211, 238, 0.32)',
};

const HOOKSHOT_SHOT_COUNTER_TONE: ShotCounterTone = {
  labelClass: 'text-cyan-100/52',
  readyClass: 'text-cyan-50/95',
  reloadClass: 'text-cyan-50/95',
  idleBackground: 'linear-gradient(135deg, rgba(8, 80, 95, 0.3), rgba(4, 16, 20, 0.24))',
  reloadBackground: 'linear-gradient(135deg, rgba(8, 80, 95, 0.3), rgba(4, 16, 20, 0.24))',
  idleBorder: '1px solid rgba(34, 211, 238, 0.22)',
  reloadBorder: '1px solid rgba(34, 211, 238, 0.22)',
  idleShadow: '0 0 18px rgba(34, 211, 238, 0.12), 0 8px 20px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255,255,255,0.06)',
  reloadShadow: '0 0 18px rgba(34, 211, 238, 0.12), 0 8px 20px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255,255,255,0.06)',
  idleFill: 'linear-gradient(90deg, rgba(34, 211, 238, 0.08), transparent)',
  reloadFill: 'linear-gradient(90deg, rgba(34, 211, 238, 0.08), transparent)',
  idleProgress: 'linear-gradient(90deg, rgba(34, 211, 238, 0.64), rgba(103, 232, 249, 0.48))',
  reloadProgress: 'linear-gradient(90deg, rgba(34, 211, 238, 0.64), rgba(103, 232, 249, 0.48))',
  idleStroke: '#22d3ee',
  reloadStroke: '#22d3ee',
  idleTextShadow: '0 0 10px rgba(34, 211, 238, 0.5), 0 2px 8px rgba(0,0,0,0.7)',
  reloadTextShadow: '0 0 10px rgba(34, 211, 238, 0.5), 0 2px 8px rgba(0,0,0,0.7)',
  reloadStrokeFilter: 'drop-shadow(0 0 4px rgba(34, 211, 238, 0.72))',
  progressShadow: '0 0 8px rgba(34, 211, 238, 0.32)',
};

function PrimaryShotCounter({
  label,
  ammo,
  reloading,
  reloadStart,
  reloadEnd,
  now,
  infinite = false,
  tone,
}: {
  label: string;
  ammo: number;
  reloading: boolean;
  reloadStart: number;
  reloadEnd: number;
  now: number;
  infinite?: boolean;
  tone: ShotCounterTone;
}) {
  const maxAmmo = PHANTOM_PRIMARY_MAGAZINE_SIZE;
  const shownAmmo = Math.max(0, Math.min(maxAmmo, Math.round(ammo)));
  const reloadDuration = Math.max(1, reloadEnd - reloadStart || PHANTOM_PRIMARY_RELOAD_MS);
  const isReloading = !infinite && reloading;
  const reloadProgress = isReloading
    ? Math.max(0, Math.min(1, (now - reloadStart) / reloadDuration))
    : 1;
  const reloadRemainingSeconds = Math.max(0, (reloadEnd - now) / 1000);
  const ammoRatio = shownAmmo / maxAmmo;
  const readoutProgress = infinite ? 1 : isReloading ? reloadProgress : ammoRatio;
  const displayAmmo = infinite ? '∞' : shownAmmo.toString().padStart(2, '0');
  const displayMax = infinite ? '∞' : maxAmmo;

  return (
    <div
      className="relative w-[clamp(7.75rem,10vw,9.5rem)] rounded-md overflow-hidden backdrop-blur-md animate-fade-in"
      style={{
        background: isReloading ? tone.reloadBackground : tone.idleBackground,
        border: isReloading ? tone.reloadBorder : tone.idleBorder,
        boxShadow: isReloading ? tone.reloadShadow : tone.idleShadow,
      }}
    >
      <div
        className="absolute inset-y-0 left-0 w-full origin-left transition-transform duration-100"
        style={{
          transform: `scaleX(${isReloading ? reloadProgress : 1})`,
          background: isReloading ? tone.reloadFill : tone.idleFill,
        }}
      />

      <div className="relative px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className={`font-mono text-[8px] uppercase tracking-[0.18em] ${tone.labelClass}`}>{label}</span>
          {isReloading && (
            <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-cyan-100/72 tabular-nums">
              {reloadRemainingSeconds.toFixed(1)}s
            </span>
          )}
        </div>

        <div className="mt-0.5 flex items-center justify-between gap-2">
          <div className="flex items-end gap-1">
            <span
              className={`font-mono text-[clamp(1.75rem,2.35vw,2.25rem)] font-bold leading-none tabular-nums ${isReloading ? tone.reloadClass : tone.readyClass}`}
              style={{ textShadow: isReloading ? tone.reloadTextShadow : tone.idleTextShadow }}
            >
              {displayAmmo}
            </span>
            <span className="mb-0.5 font-mono text-[10px] text-white/36 tabular-nums">/{displayMax}</span>
          </div>

          <div
            className="h-7 w-7 rounded-[5px] flex items-center justify-center"
            style={{
              background: 'rgba(255, 255, 255, 0.055)',
              boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.08)',
            }}
          >
            <svg width="22" height="22" viewBox="0 0 28 28" className="-rotate-90 opacity-90">
              <circle cx="14" cy="14" r="10.5" fill="none" stroke="rgba(255,255,255,0.11)" strokeWidth="3" />
              <circle
                cx="14"
                cy="14"
                r="10.5"
                fill="none"
                stroke={isReloading ? tone.reloadStroke : tone.idleStroke}
                strokeWidth="3"
                strokeDasharray={`${reloadProgress * 66} 66`}
                strokeLinecap="round"
                style={{ filter: isReloading ? tone.reloadStrokeFilter : 'none' }}
              />
            </svg>
          </div>
        </div>

        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full w-full origin-left transition-transform duration-100"
            style={{
              transform: `scaleX(${readoutProgress})`,
              background: isReloading ? tone.reloadProgress : tone.idleProgress,
              boxShadow: isReloading || infinite ? tone.progressShadow : 'none',
            }}
          />
        </div>
      </div>
    </div>
  );
}

function PhantomAmmoCounter({
  ammo,
  reloading,
  reloadStart,
  reloadEnd,
}: {
  ammo: number;
  reloading: boolean;
  reloadStart: number;
  reloadEnd: number;
}) {
  const now = useHudNow();

  return (
    <PrimaryShotCounter
      label="dire"
      ammo={ammo}
      reloading={reloading}
      reloadStart={reloadStart}
      reloadEnd={reloadEnd}
      now={now}
      tone={PHANTOM_SHOT_COUNTER_TONE}
    />
  );
}

function HookshotShotCounter() {
  return (
    <PrimaryShotCounter
      label="chain"
      ammo={PHANTOM_PRIMARY_MAGAZINE_SIZE}
      reloading={false}
      reloadStart={0}
      reloadEnd={0}
      now={0}
      infinite
      tone={HOOKSHOT_SHOT_COUNTER_TONE}
    />
  );
}

const CHRONOS_LIFELINE_HELPERS = [
  { input: 'mouse-left', icon: 'allies', ariaLabel: 'Left click heals allies' },
  { input: 'mouse-right', icon: 'self', ariaLabel: 'Right click heals self' },
  { input: 'key-e', icon: 'cancel', ariaLabel: 'E cancels Lifeline' },
] as const;

const CHRONOS_LIFELINE_ICON_COLOR = 'rgba(255, 255, 255, 0.64)';
const CHRONOS_LIFELINE_ICON_MUTED = 'rgba(255, 255, 255, 0.34)';
const CHRONOS_LIFELINE_ICON_SOFT = 'rgba(255, 255, 255, 0.12)';

type ChronosLifelineHelperIcon = (typeof CHRONOS_LIFELINE_HELPERS)[number]['icon'];
type ChronosLifelineInputIcon = (typeof CHRONOS_LIFELINE_HELPERS)[number]['input'];

function ChronosLifelineInputGlyph({
  input,
  color,
}: {
  input: ChronosLifelineInputIcon;
  color: string;
}) {
  if (input === 'key-e') {
    return (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M7.2 5.2h9.6c1 0 1.8.8 1.8 1.8v10c0 1-.8 1.8-1.8 1.8H7.2c-1 0-1.8-.8-1.8-1.8V7c0-1 .8-1.8 1.8-1.8Z"
          fill={CHRONOS_LIFELINE_ICON_SOFT}
          stroke={CHRONOS_LIFELINE_ICON_MUTED}
          strokeWidth="1.4"
        />
        <path d="M14.7 8.5H9.5v7h5.4M9.9 12h4.1" stroke={color} strokeWidth="1.55" strokeLinecap="round" />
      </svg>
    );
  }

  const leftActive = input === 'mouse-left';

  return (
    <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.5c-3.35 0-6.1 2.75-6.1 6.1v4.8c0 3.35 2.75 6.1 6.1 6.1s6.1-2.75 6.1-6.1V9.6c0-3.35-2.75-6.1-6.1-6.1Z"
        fill={CHRONOS_LIFELINE_ICON_SOFT}
        stroke={CHRONOS_LIFELINE_ICON_MUTED}
        strokeWidth="1.45"
      />
      <path d="M12 4.3v5.5" stroke="rgba(255,255,255,0.22)" strokeWidth="1.15" strokeLinecap="round" />
      <path
        d={leftActive ? 'M11.2 4.8c-2.3.35-4 2.35-4 4.8h4V4.8Z' : 'M12.8 4.8c2.3.35 4 2.35 4 4.8h-4V4.8Z'}
        fill={color}
      />
      <path d="M12 11.3v2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ChronosLifelineActionIcon({
  icon,
  color,
}: {
  icon: ChronosLifelineHelperIcon;
  color: string;
}) {
  if (icon === 'cancel') {
    return (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }

  if (icon === 'self') {
    return (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="10" cy="7.2" r="3" stroke={color} strokeWidth="1.8" />
        <path d="M4.7 18.6c.7-3.4 2.5-5.2 5.3-5.2s4.6 1.8 5.3 5.2" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M18.2 10.7v5M15.7 13.2h5" stroke={color} strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="8" cy="7.3" r="2.4" stroke={color} strokeWidth="1.7" />
      <circle cx="15.8" cy="7.3" r="2.4" stroke={color} strokeWidth="1.7" opacity="0.76" />
      <path d="M3.7 18.2c.6-3.1 2-4.7 4.3-4.7s3.7 1.6 4.3 4.7" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12.5 14c.7-.4 1.5-.6 2.5-.6 2.2 0 3.7 1.6 4.3 4.7" stroke={color} strokeWidth="1.7" strokeLinecap="round" opacity="0.76" />
      <path d="M18.7 11.1v4.2M16.6 13.2h4.2" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ChronosLifelineHelper() {
  return (
    <div
      className="relative flex max-w-[92vw] items-center justify-center gap-3 px-1 pb-0.5 animate-fade-in sm:gap-4"
      style={{
        filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.48))',
      }}
      aria-label="Chronos Lifeline helper actions"
    >
      <span className="absolute left-1/2 top-1/2 h-px w-[calc(100%-1.2rem)] -translate-x-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      {CHRONOS_LIFELINE_HELPERS.map((helper) => (
        <div
          key={helper.input}
          className="relative flex h-9 items-center gap-1.5"
          aria-label={helper.ariaLabel}
        >
          <ChronosLifelineInputGlyph input={helper.input} color={CHRONOS_LIFELINE_ICON_COLOR} />
          <span className="h-1 w-1 rounded-full bg-white/40" />
          <ChronosLifelineActionIcon icon={helper.icon} color={CHRONOS_LIFELINE_ICON_COLOR} />
        </div>
      ))}
    </div>
  );
}

export function HUD() {
  const {
    localPlayer,
    isPracticeMode,
    isTutorialMode,
    gameplayMode,
    gamePhase,
    redScore,
    blueScore,
    roundTimeRemaining,
    phaseEndTime,
    gameClockFrozen,
    clientCooldowns,
    clientCharges,
    ultimateEffectActive,
    voidRayCharging,
    voidRayChargeStart,
    bombTargeting,
    bombTargetValid,
    flamethrowerFuel,
    flamethrowerActive,
    phantomPrimaryAmmo,
    phantomPrimaryReloading,
    phantomPrimaryReloadStart,
    phantomPrimaryReloadEnd,
    chronosLifelineQueued,
  } = useGameStore(
    useShallow(state => ({
      localPlayer: state.localPlayer,
      isPracticeMode: state.isPracticeMode,
      isTutorialMode: state.isTutorialMode,
      gameplayMode: state.gameplayMode,
      gamePhase: state.gamePhase,
      redScore: state.redScore,
      blueScore: state.blueScore,
      roundTimeRemaining: state.roundTimeRemaining,
      phaseEndTime: state.phaseEndTime,
      gameClockFrozen: state.gameClockFrozen,
      clientCooldowns: state.clientCooldowns,
      clientCharges: state.clientCharges,
      ultimateEffectActive: state.ultimateEffectActive,
      voidRayCharging: state.voidRayCharging,
      voidRayChargeStart: state.voidRayChargeStart,
      bombTargeting: state.bombTargeting,
      bombTargetValid: state.bombTargetValid,
      flamethrowerFuel: state.flamethrowerFuel,
      flamethrowerActive: state.flamethrowerActive,
      phantomPrimaryAmmo: state.phantomPrimaryAmmo,
      phantomPrimaryReloading: state.phantomPrimaryReloading,
      phantomPrimaryReloadStart: state.phantomPrimaryReloadStart,
      phantomPrimaryReloadEnd: state.phantomPrimaryReloadEnd,
      chronosLifelineQueued: state.chronosLifelineQueued,
    }))
  );
  const {
    crosshairStyle,
    crosshairColor,
    showKillFeed,
  } = useSettingsStore(
    useShallow(state => ({
      crosshairStyle: state.settings.crosshairStyle,
      crosshairColor: state.settings.crosshairColor,
      showKillFeed: state.settings.showKillFeed,
    }))
  );
  const killFeed = useCombatFeedbackStore((state) => state.killFeed);

  if (!localPlayer) return null;

  const healthPercent = (localPlayer.health / localPlayer.maxHealth) * 100;
  const isLowHealth = healthPercent < 30;
  const isCriticalHealth = healthPercent < 15;
  const ultimatePercent = localPlayer.ultimateCharge ?? 0;
  const heroColors = localPlayer.heroId ? HERO_COLORS[localPlayer.heroId] : HERO_COLORS.phantom;
  const heroSkillItems = localPlayer.heroId ? getHeroSkillItems(localPlayer.heroId) : [];
  const showChronosLifelineHelper = localPlayer.heroId === 'chronos' && chronosLifelineQueued;
  const isCaptureTheFlag = gameplayMode === 'capture_the_flag';
  const showFloatingFlag = localPlayer.hasFlag;
  const floatingFlagTop = isPracticeMode
    ? 'clamp(3.25rem, 8vh, 4.75rem)'
    : 'calc(clamp(2.25rem, 3.4vw, 3.25rem) + 0.5rem)';
  const scoreLabel = gameplayMode === 'team_deathmatch' ? 'KILLS' : 'BATTLE';
  const healthColor = healthPercent <= 15
    ? '#ef4444'
    : healthPercent <= 30
      ? '#f97316'
      : healthPercent <= 55
        ? '#fbbf24'
        : '#22c55e';

  return (
    <div className="absolute inset-0 pointer-events-none select-none z-hud">
      {/* Low health vignette effect */}
      {isLowHealth && (
        <div
          className={`absolute inset-0 pointer-events-none ${isCriticalHealth ? 'animate-pulse' : 'animate-pulse-soft'}`}
          style={{
            background: `radial-gradient(ellipse at center, transparent 30%, ${isCriticalHealth ? 'rgba(239, 68, 68, 0.35)' : 'rgba(239, 68, 68, 0.2)'} 100%)`,
          }}
        />
      )}

      {/* Crosshair - changes for Meteor Strike targeting mode */}
      <div className="crosshair">
        {bombTargeting ? (
          // Meteor Strike targeting crosshair - larger, orange, with explosion radius indicator
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            {/* Outer blast radius ring */}
            <circle
              cx="24" cy="24" r="20"
              stroke={bombTargetValid ? "#ff6600" : "#ff3333"}
              strokeWidth="2"
              strokeDasharray="6 3"
              opacity="0.6"
              style={{ animation: 'spin 4s linear infinite' }}
            />
            {/* Inner targeting ring */}
            <circle
              cx="24" cy="24" r="12"
              stroke={bombTargetValid ? "#ff8800" : "#ff4444"}
              strokeWidth="2"
              opacity="0.8"
            />
            {/* Center dot */}
            <circle
              cx="24" cy="24" r="3"
              fill={bombTargetValid ? "#ffaa00" : "#ff5555"}
              opacity="0.95"
            />
            {/* Crosshair lines */}
            <line x1="24" y1="6" x2="24" y2="14" stroke={bombTargetValid ? "#ff6600" : "#ff3333"} strokeWidth="2" strokeLinecap="round" opacity="0.85" />
            <line x1="24" y1="34" x2="24" y2="42" stroke={bombTargetValid ? "#ff6600" : "#ff3333"} strokeWidth="2" strokeLinecap="round" opacity="0.85" />
            <line x1="6" y1="24" x2="14" y2="24" stroke={bombTargetValid ? "#ff6600" : "#ff3333"} strokeWidth="2" strokeLinecap="round" opacity="0.85" />
            <line x1="34" y1="24" x2="42" y2="24" stroke={bombTargetValid ? "#ff6600" : "#ff3333"} strokeWidth="2" strokeLinecap="round" opacity="0.85" />
          </svg>
        ) : (
          <NormalCrosshair crosshairStyle={crosshairStyle} color={crosshairColor} />
        )}
      </div>

      {showKillFeed && <KillFeed events={killFeed} />}
      {!isTutorialMode && <Minimap />}
      {!isPracticeMode && <VoiceHud />}

      {/* Meteor Strike targeting instructions */}
      {bombTargeting && (
        <div className="fixed top-1/3 left-1/2 -translate-x-1/2 text-center z-50 pointer-events-none">
          <div
            className="px-4 py-2 rounded-lg backdrop-blur-sm"
            style={{
              background: bombTargetValid ? 'rgba(255, 102, 0, 0.3)' : 'rgba(255, 50, 50, 0.3)',
              border: `1px solid ${bombTargetValid ? '#ff6600' : '#ff3333'}`,
            }}
          >
            <p className="text-white text-sm font-bold drop-shadow-lg">
              {bombTargetValid ? 'RELEASE TO CALL METEOR STRIKE' : 'TARGET OUT OF RANGE'}
            </p>
            <p className="text-white/70 text-xs">Release secondary to confirm, ESC to cancel</p>
          </div>
        </div>
      )}

      {/* Void Ray Charge Indicator */}
      {voidRayCharging && localPlayer?.heroId === 'phantom' && (
        <VoidRayChargeIndicator chargeStart={voidRayChargeStart} />
      )}

      {/* ===== TOP CENTER - Score Panel (Redesigned) ===== */}
      {!isPracticeMode && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 max-w-[92vw]">
          <div className="relative">
            {/* Main score container */}
            <div
              className="flex items-stretch rounded-b-xl overflow-hidden backdrop-blur-md"
              style={{
                background: 'linear-gradient(180deg, rgb(var(--color-strike-bg) / 0.95) 0%, rgb(var(--color-strike-elevated) / 0.9) 100%)',
                boxShadow: '0 6px 24px rgba(0, 0, 0, 0.46), inset 0 -1px 0 rgba(255,255,255,0.05)',
              }}
            >
              {/* Solar Vanguard Side */}
              <div className="relative group">
                <div
                  className="w-[clamp(3rem,5.5vw,5.75rem)] h-[clamp(2.25rem,3.4vw,3.25rem)] flex items-center justify-center gap-1 sm:gap-1.5 relative overflow-hidden"
                  style={{
                    background: FACTIONS.red.gradient,
                  }}
                >
                  {/* Animated glow effect */}
                  <div
                    className="absolute inset-0 opacity-50"
                    style={{
                      background: `radial-gradient(ellipse at 50% 100%, ${FACTIONS.red.hudGlowColor} 0%, transparent 70%)`,
                    }}
                  />

                  <SolarIconSmall className="w-3.5 h-3.5 sm:w-4 sm:h-4 lg:w-[18px] lg:h-[18px] text-white/80 relative z-10" />
                  <span
                    className="font-display text-xl sm:text-2xl lg:text-3xl text-white tabular-nums drop-shadow-lg relative z-10"
                    style={{ textShadow: `0 0 20px ${FACTIONS.red.hudGlowColor}` }}
                  >
                    {redScore}
                  </span>
                </div>

                {/* Faction label */}
                <div
                  className="absolute -bottom-3 left-0 right-0 h-3 flex items-center justify-center"
                  style={{ background: `linear-gradient(180deg, ${FACTIONS.red.primaryColor}30, transparent)` }}
                >
                  <span
                    className="text-[6px] sm:text-[7px] font-display tracking-[0.2em]"
                    style={{ color: `${FACTIONS.red.primaryColor}b3` }}
                  >
                    SOLAR
                  </span>
                </div>
              </div>

              {/* Center Divider + Timer */}
              <div className="relative flex items-center">
                {/* Diagonal dividers */}
                <div
                  className="absolute -left-2 top-0 bottom-0 w-4 z-10"
                  style={{
                    background: 'linear-gradient(135deg, transparent 45%, rgba(10,10,15,0.95) 45%, rgba(10,10,15,0.95) 55%, transparent 55%)',
                  }}
                />
                <div
                  className="absolute -right-2 top-0 bottom-0 w-4 z-10"
                  style={{
                    background: 'linear-gradient(-135deg, transparent 45%, rgba(10,10,15,0.95) 45%, rgba(10,10,15,0.95) 55%, transparent 55%)',
                  }}
                />

                {/* Timer */}
                <div className="relative px-3 sm:px-4 lg:px-5 h-[clamp(2.25rem,3.4vw,3.25rem)] flex flex-col items-center justify-center z-20 min-w-[clamp(4.5rem,6vw,5.75rem)]">
                  <RoundTimer
                    gamePhase={gamePhase}
                    phaseEndTime={phaseEndTime}
                    roundTimeRemaining={roundTimeRemaining}
                    gameClockFrozen={gameClockFrozen}
                  />
                  <span className="text-[6px] sm:text-[7px] font-display text-white/30 tracking-[0.24em] -mt-0.5">{scoreLabel}</span>
                </div>
              </div>

              {/* Void Legion Side */}
              <div className="relative group">
                <div
                  className="w-[clamp(3rem,5.5vw,5.75rem)] h-[clamp(2.25rem,3.4vw,3.25rem)] flex items-center justify-center gap-1 sm:gap-1.5 relative overflow-hidden"
                  style={{
                    background: FACTIONS.blue.gradient,
                  }}
                >
                  {/* Animated glow effect */}
                  <div
                    className="absolute inset-0 opacity-50"
                    style={{
                      background: `radial-gradient(ellipse at 50% 100%, ${FACTIONS.blue.hudGlowColor} 0%, transparent 70%)`,
                    }}
                  />

                  <span
                    className="font-display text-xl sm:text-2xl lg:text-3xl text-white tabular-nums drop-shadow-lg relative z-10"
                    style={{ textShadow: `0 0 20px ${FACTIONS.blue.hudGlowColor}` }}
                  >
                    {blueScore}
                  </span>
                  <VoidIconSmall className="w-3.5 h-3.5 sm:w-4 sm:h-4 lg:w-[18px] lg:h-[18px] text-white/80 relative z-10" />
                </div>

                {/* Faction label */}
                <div
                  className="absolute -bottom-3 left-0 right-0 h-3 flex items-center justify-center"
                  style={{ background: `linear-gradient(180deg, ${FACTIONS.blue.primaryColor}30, transparent)` }}
                >
                  <span className="text-[6px] sm:text-[7px] font-display tracking-[0.2em] text-cyan-300/70">VOID</span>
                </div>
              </div>
            </div>

            {/* Bottom accent line */}
            <div
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3/4 h-px"
              style={{
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
              }}
            />
          </div>
        </div>
      )}

      {showFloatingFlag && (
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={{ top: floatingFlagTop }}
          role="img"
          aria-label="Carrying flag"
        >
          <FloatingFlagIcon className="hud-flag-float h-[clamp(3rem,4.8vw,4.25rem)] w-[clamp(3rem,4.8vw,4.25rem)] drop-shadow-[0_8px_16px_rgba(0,0,0,0.62)]" />
        </div>
      )}

      {/* ===== BOTTOM LEFT - Health ===== */}
      <div
        className="absolute hud-scale hud-health"
        style={{
          left: 'clamp(0.75rem, 1.25vw, 1.125rem)',
          bottom: 'clamp(0.75rem, 1.25vw, 1.125rem)',
        }}
      >
        <div className="relative w-[clamp(8.75rem,14vw,13rem)]">
          <div
            className="h-2 sm:h-2.5 rounded-full overflow-hidden"
            style={{
              background: 'rgba(0, 0, 0, 0.42)',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              boxShadow: '0 1px 8px rgba(0, 0, 0, 0.35)',
            }}
          >
            <div
              className={`h-full w-full origin-left rounded-full transition-transform duration-150 ${isCriticalHealth ? 'health-bar-critical' :
                  isLowHealth ? 'health-bar-low' : ''
                }`}
              style={{
                transform: `scaleX(${healthPercent / 100})`,
                background: healthColor,
                boxShadow: `0 0 10px ${healthColor}66`,
              }}
            />
          </div>

        </div>
      </div>

      {/* ===== BOTTOM CENTER - Skill Bar ===== */}
      {heroSkillItems.length > 0 && (
        <div className="absolute bottom-[clamp(0.45rem,1vw,0.875rem)] left-1/2 flex max-w-[94vw] -translate-x-1/2 flex-col items-center gap-2 hud-skill-bar">
          {showChronosLifelineHelper && (
            <ChronosLifelineHelper />
          )}
          <div className="flex items-end justify-center gap-2 sm:gap-2.5 lg:gap-3">
            {heroSkillItems.map((skill) => (
              <HUDSkillSlot
                key={`${skill.input}-${skill.name}`}
                skill={skill}
                abilityState={skill.abilityId ? localPlayer.abilities?.[skill.abilityId] : undefined}
                clientCooldownEnd={skill.abilityId ? clientCooldowns[skill.abilityId] : undefined}
                clientCharges={skill.abilityId ? clientCharges[skill.abilityId] : undefined}
                heroColor={heroColors.primary}
                ultimateCharge={ultimatePercent}
                ultimateEffectActive={ultimateEffectActive}
              />
            ))}
          </div>
        </div>
      )}

      {/* ===== BOTTOM RIGHT - Movement Status (Improved) ===== */}
      <div className="absolute bottom-4 right-4 xl:bottom-6 xl:right-6 flex flex-col items-end gap-2 hud-status">
        {localPlayer.heroId === 'phantom' && (
          <PhantomAmmoCounter
            ammo={phantomPrimaryAmmo}
            reloading={phantomPrimaryReloading}
            reloadStart={phantomPrimaryReloadStart}
            reloadEnd={phantomPrimaryReloadEnd}
          />
        )}
        {localPlayer.heroId === 'hookshot' && <HookshotShotCounter />}

        {/* Movement indicators container */}
        <div className="flex flex-col items-end gap-1.5">
          {localPlayer.movement?.isWallRunning && <MovementIndicator label="WALL RUN" color="#06b6d4" icon="wall" />}
          {localPlayer.movement?.isSliding && <MovementIndicator label="SLIDE" color="#22c55e" icon="slide" />}
          {localPlayer.movement?.isGrappling && <MovementIndicator label="GRAPPLE" color="#06b6d4" icon="grapple" />}
          {flamethrowerActive && <MovementIndicator label="FLAME" color="#f97316" icon="flame" />}
          {localPlayer.movement?.isGliding && <MovementIndicator label="GLIDE" color="#a855f7" icon="glide" />}
        </div>

        {/* Flamethrower Fuel */}
        {localPlayer.heroId === 'blaze' && (
          <BlazeFuelIndicator fuel={flamethrowerFuel} active={flamethrowerActive} />
        )}

      </div>
    </div>
  );
}

interface AbilityState {
  abilityId: string;
  cooldownRemaining: number;
  cooldownUntil?: number;
  charges: number;
  isActive: boolean;
  activatedAt?: number;
}

export function getHudAbilityCooldownSeconds({
  now,
  isUltimate,
  canTrackAbility,
  showActiveTimer,
  clientCooldownEnd,
  serverCooldownUntil,
  serverCooldownRemaining,
}: {
  now: number;
  isUltimate: boolean;
  canTrackAbility: boolean;
  showActiveTimer: boolean;
  clientCooldownEnd?: number;
  serverCooldownUntil?: number;
  serverCooldownRemaining?: number;
}): number {
  if (isUltimate || !canTrackAbility || showActiveTimer) return 0;

  if (clientCooldownEnd && clientCooldownEnd > now) {
    return Math.max(0, (clientCooldownEnd - now) / 1000);
  }

  if (serverCooldownUntil && serverCooldownUntil > now) {
    return Math.max(0, (serverCooldownUntil - now) / 1000);
  }
  if (serverCooldownUntil !== undefined) return 0;

  return Math.max(0, serverCooldownRemaining ?? 0);
}

function HUDSkillSlot({
  skill,
  abilityState,
  clientCooldownEnd,
  clientCharges,
  heroColor,
  ultimateCharge,
  ultimateEffectActive,
}: {
  skill: HeroSkillItem;
  abilityState?: AbilityState;
  clientCooldownEnd?: number;
  clientCharges?: number;
  heroColor: string;
  ultimateCharge: number;
  ultimateEffectActive?: boolean;
}) {
  const abilityId = skill.abilityId;
  const abilityDef = abilityId ? ABILITY_DEFINITIONS[abilityId] : undefined;
  const isUltimate = skill.tone === 'ultimate';
  const canTrackAbility = Boolean(abilityId && abilityDef);
  const maxCharges = abilityDef?.charges || 1;
  const maxCooldown = abilityId === 'phantom_blink' ? 10 : (abilityDef?.cooldown || skill.cooldown || 0);
  const cooldownStartsAfterActive = false;

  const now = useHudNow();
  const isActive = canTrackAbility
    ? isUltimate ? (ultimateEffectActive ?? false) : (abilityState?.isActive ?? false)
    : false;
  const activeDuration = abilityDef?.duration ?? 0;
  const activeElapsed = abilityState?.activatedAt
    ? Math.max(0, (now - abilityState.activatedAt) / 1000)
    : 0;
  const activeRemaining = isActive && !isUltimate && activeDuration > 0
    ? Math.max(0, activeDuration - activeElapsed)
    : 0;
  const showActiveTimer = cooldownStartsAfterActive && activeRemaining > 0;
  const activeProgress = activeDuration > 0
    ? Math.max(0, Math.min(1, activeRemaining / activeDuration))
    : 0;
  // Ultimates use the charge system, not cooldowns - ignore any cooldown values
  const cooldown = getHudAbilityCooldownSeconds({
    now,
    isUltimate,
    canTrackAbility,
    showActiveTimer,
    clientCooldownEnd,
    serverCooldownUntil: abilityState?.cooldownUntil,
    serverCooldownRemaining: abilityState?.cooldownRemaining,
  });

  const serverCharges = abilityState?.charges ?? maxCharges;
  let charges = clientCharges !== undefined ? clientCharges : serverCharges;

  if (maxCharges > 1 && clientCooldownEnd && now >= clientCooldownEnd && charges === 0) {
    charges = maxCharges;
  }

  const onCooldown = cooldown > 0;
  const isUltReady = isUltimate && ultimateCharge >= 100;
  const isUltCharging = isUltimate && ultimateCharge < 100;
  const hasCharges = maxCharges > 1;
  const noChargesLeft = hasCharges && charges === 0;
  const isUsable = !showActiveTimer && !onCooldown && !noChargesLeft && (!isUltimate || isUltReady);
  const inputLabel = skill.input;
  const isWideInput = inputLabel.length > 1;

  return (
    <div className="relative drop-shadow-[0_5px_14px_rgba(0,0,0,0.42)]">
      {isUltReady && (
        <div
          className="absolute -inset-1.5 rounded-lg animate-pulse"
          style={{
            background: 'radial-gradient(circle, rgba(251, 191, 36, 0.4) 0%, transparent 70%)',
          }}
        />
      )}

      <div className="relative">
        <HeroSkillIcon
          item={skill}
          color={heroColor}
          size="hud"
          muted={!isUsable && !showActiveTimer}
          active={isActive || isUltReady}
        />

        {(onCooldown || noChargesLeft || isUltCharging) && (
          <div className="absolute inset-0 bg-black/50 rounded-md z-10" />
        )}

        {showActiveTimer && (
          <div
            className="absolute inset-0 rounded-md z-10"
            style={{
              background: `radial-gradient(circle at center, ${heroColor}44 0%, rgba(22, 163, 74, 0.22) 46%, transparent 72%)`,
              boxShadow: `inset 0 0 0 1px ${heroColor}99, 0 0 16px ${heroColor}66`,
            }}
          />
        )}

        {showActiveTimer && (
          <svg className="absolute inset-0 w-full h-full z-20 -rotate-90" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="rgba(16,185,129,0.18)"
              strokeWidth="8"
            />
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke={heroColor}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${activeProgress * 276} 276`}
              className="transition-all duration-100"
            />
          </svg>
        )}

        {onCooldown && maxCooldown > 0 && (
          <svg className="absolute inset-0 w-full h-full z-20 -rotate-90" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="rgba(0,0,0,0.72)"
              strokeWidth="90"
              strokeDasharray={`${(cooldown / maxCooldown) * 283} 283`}
              className="transition-all duration-100"
            />
          </svg>
        )}

        <div
          className={`absolute top-1 left-1 z-30 flex h-5 items-center justify-center rounded-[0.25rem] font-mono font-bold leading-none shadow-[0_1px_4px_rgba(0,0,0,0.7)] ring-1 ring-inset tabular-nums ${isWideInput ? 'min-w-7 px-1.5 text-[8px] sm:text-[9px]' : 'w-5 text-[10px] sm:text-[11px]'} ${isUsable
              ? isUltimate
                ? 'bg-amber-500/85 text-amber-50 ring-amber-100/45'
                : 'bg-slate-950/75 text-white ring-white/35'
              : 'bg-black/75 text-white/55 ring-white/15'
            }`}
        >
          {inputLabel}
        </div>

        {onCooldown && (
          <div className="absolute inset-0 flex items-center justify-center z-30">
            <span className="font-mono text-base sm:text-lg font-bold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,1)]">
              {Math.ceil(cooldown)}
            </span>
          </div>
        )}

        {showActiveTimer && (
          <div className="absolute inset-0 flex items-center justify-center z-30">
            <span className="font-mono text-base sm:text-lg font-bold text-emerald-100 drop-shadow-[0_2px_7px_rgba(5,46,22,1)]">
              {Math.ceil(activeRemaining)}
            </span>
          </div>
        )}

        {isUltCharging && !onCooldown && (
          <div className="absolute inset-0 flex items-center justify-center z-30">
            <span className="font-mono text-xs sm:text-sm font-bold text-violet-200 drop-shadow-lg">
              {Math.floor(ultimateCharge)}%
            </span>
          </div>
        )}

        {hasCharges && (
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5 z-30">
            {[...Array(maxCharges)].map((_, i) => (
              <div
                key={i}
                className={`w-2 h-1 sm:w-2.5 rounded-sm transition-all duration-150 ${i < charges
                    ? 'bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.9)]'
                    : 'bg-white/20'
                  }`}
              />
            ))}
          </div>
        )}

        {isActive && !showActiveTimer && (
          <div
            className="absolute inset-0 rounded-md z-10 animate-pulse"
            style={{
              background: `radial-gradient(circle at center, ${heroColor}55 0%, transparent 62%)`,
            }}
          />
        )}
      </div>
    </div>
  );
}

// ===== MOVEMENT INDICATOR (Improved) =====
function MovementIndicator({ label, color, icon }: { label: string; color: string; icon: string }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg backdrop-blur-sm animate-fade-in"
      style={{
        background: `${color}15`,
        border: `1px solid ${color}40`,
        boxShadow: `0 0 15px ${color}20`,
      }}
    >
      <div
        className="w-2 h-2 rounded-full animate-pulse"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      <span
        className="text-[10px] font-display tracking-[0.15em]"
        style={{ color }}
      >
        {label}
      </span>
    </div>
  );
}
