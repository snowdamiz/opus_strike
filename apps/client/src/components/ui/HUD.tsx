import { memo, useEffect, useRef } from 'react';
import { useGameStore, type InteractionPrompt } from '../../store/gameStore';
import { useShallow } from 'zustand/shallow';
import {
  ABILITY_DEFINITIONS,
  BATTLE_ROYAL_REVIVE_DURATION_MS,
  BATTLE_ROYAL_REVIVE_RADIUS,
  BLAZE_PRIMARY_MAGAZINE_SIZE,
  BLAZE_PRIMARY_RELOAD_MS,
  CHRONOS_PRIMARY_MAGAZINE_SIZE,
  CHRONOS_PRIMARY_RELOAD_MS,
  PHANTOM_PRIMARY_MAGAZINE_SIZE,
  PHANTOM_PRIMARY_RELOAD_MS,
  VOID_RAY_CHARGE_TIME,
  type BattleRoyalDropPlayerStatus,
  type Player,
  type SafeZoneSnapshot,
} from '@voxel-strike/shared';
import { getHeroSkillItems, HeroSkillIcon, type HeroSkillItem } from './HeroSkillKit';
import { useCombatFeedbackStore, type KillFeedEvent } from '../../store/combatFeedbackStore';
import { useSettingsStore, type CrosshairStyle } from '../../store/settingsStore';
import { useHudNow } from '../../store/hudSignals';
import { FACTIONS, HUD_HERO_COLORS } from '../../styles/colorTokens';
import { Minimap } from './minimap/Minimap';
import { VoiceHud } from './VoiceHud';
import { formatKeybind } from '../../utils/keybindings';
import {
  getAbilityCooldownSeconds,
  getAbilityMaxCharges,
  getDisplayAbilityCharges,
  getHudAbilityCooldownSeconds,
} from '../../abilities/cooldowns';

export { getHudAbilityCooldownSeconds } from '../../abilities/cooldowns';

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
    <div className="hud-kill-feed absolute top-24 right-5 z-[120] flex flex-col gap-2 items-end">
      {events.map((event) => (
        <div
          key={event.id}
          className="hud-kill-feed-item px-3 py-2 rounded-lg bg-black/55 border border-white/10 backdrop-blur-sm font-body text-xs text-white/75 shadow-lg animate-fade-in"
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

function BattleRoyalEliminationsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1.8" opacity="0.78" />
      <path d="M12 4.5v4.1M12 15.4v4.1M4.5 12h4.1M15.4 12h4.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" />
    </svg>
  );
}

function BattleRoyalRemainingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.4 18.7 7.2v6.1c0 3.3-2.6 6.1-6.7 7.3-4.1-1.2-6.7-4-6.7-7.3V7.2L12 3.4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8.5 12.2h7M12 8.7v7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.82" />
    </svg>
  );
}

function isBattleRoyalRemainingPlayer(player: Player): boolean {
  return player.state === 'alive' || player.state === 'downed' || player.state === 'dropping' || player.state === 'spawning';
}

function BattleRoyalTopHud({
  eliminations,
  remainingPlayers,
  gamePhase,
  phaseEndTime,
  roundTimeRemaining,
  gameClockFrozen,
}: {
  eliminations: number;
  remainingPlayers: number;
  gamePhase: string;
  phaseEndTime: number | null;
  roundTimeRemaining: number;
  gameClockFrozen: boolean;
}) {
  return (
    <div
      className="hud-top-panel hud-battle-royal-top flex items-stretch overflow-hidden rounded-b-xl backdrop-blur-md"
      style={{
        background: 'linear-gradient(180deg, rgba(8, 11, 16, 0.95) 0%, rgba(20, 24, 31, 0.9) 100%)',
        boxShadow: '0 6px 24px rgba(0, 0, 0, 0.46), inset 0 -1px 0 rgba(255,255,255,0.06)',
      }}
      aria-label={`Battle Royal status: ${eliminations} eliminations, ${remainingPlayers} players remaining`}
    >
      <div className="relative">
        <div
          className="relative flex h-[clamp(2.25rem,3.4vw,3.25rem)] w-[clamp(4.35rem,6.3vw,6.4rem)] items-center justify-center gap-1.5 overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(180, 83, 9, 0.88), rgba(234, 88, 12, 0.72))',
          }}
        >
          <div
            className="absolute inset-0 opacity-70"
            style={{
              background: 'radial-gradient(ellipse at 50% 100%, rgba(251, 191, 36, 0.42) 0%, transparent 72%)',
            }}
          />
          <BattleRoyalEliminationsIcon className="relative z-10 h-3.5 w-3.5 text-orange-100/82 sm:h-4 sm:w-4 lg:h-[18px] lg:w-[18px]" />
          <span className="relative z-10 font-display text-xl leading-none text-white tabular-nums drop-shadow-lg sm:text-2xl lg:text-3xl">
            {eliminations}
          </span>
        </div>
        <div className="absolute -bottom-3 left-0 right-0 flex h-3 items-center justify-center bg-gradient-to-b from-orange-500/18 to-transparent">
          <span className="font-display text-[6px] tracking-[0.2em] text-orange-200/72 sm:text-[7px]">ELIMS</span>
        </div>
      </div>

      <div className="relative flex items-center">
        <div
          className="absolute -left-2 bottom-0 top-0 z-10 w-4"
          style={{
            background: 'linear-gradient(135deg, transparent 45%, rgba(8, 10, 14, 0.95) 45%, rgba(8, 10, 14, 0.95) 55%, transparent 55%)',
          }}
        />
        <div
          className="absolute -right-2 bottom-0 top-0 z-10 w-4"
          style={{
            background: 'linear-gradient(-135deg, transparent 45%, rgba(8, 10, 14, 0.95) 45%, rgba(8, 10, 14, 0.95) 55%, transparent 55%)',
          }}
        />
        <div className="relative z-20 flex h-[clamp(2.25rem,3.4vw,3.25rem)] min-w-[clamp(4.75rem,6.5vw,6.25rem)] flex-col items-center justify-center px-3 sm:px-4 lg:px-5">
          <RoundTimer
            gamePhase={gamePhase}
            phaseEndTime={phaseEndTime}
            roundTimeRemaining={roundTimeRemaining}
            gameClockFrozen={gameClockFrozen}
          />
          <span className="-mt-0.5 font-display text-[6px] tracking-[0.24em] text-white/30 sm:text-[7px]">SURVIVE</span>
        </div>
      </div>

      <div className="relative">
        <div
          className="relative flex h-[clamp(2.25rem,3.4vw,3.25rem)] w-[clamp(5rem,7vw,7rem)] items-center justify-center gap-1.5 overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(8, 145, 178, 0.76), rgba(20, 184, 166, 0.64))',
          }}
        >
          <div
            className="absolute inset-0 opacity-65"
            style={{
              background: 'radial-gradient(ellipse at 50% 100%, rgba(103, 232, 249, 0.38) 0%, transparent 72%)',
            }}
          />
          <span className="relative z-10 font-display text-xl leading-none text-white tabular-nums drop-shadow-lg sm:text-2xl lg:text-3xl">
            {remainingPlayers}
          </span>
          <BattleRoyalRemainingIcon className="relative z-10 h-3.5 w-3.5 text-cyan-50/82 sm:h-4 sm:w-4 lg:h-[18px] lg:w-[18px]" />
        </div>
        <div className="absolute -bottom-3 left-0 right-0 flex h-3 items-center justify-center bg-gradient-to-b from-cyan-400/16 to-transparent">
          <span className="font-display text-[6px] tracking-[0.18em] text-cyan-100/72 sm:text-[7px]">REMAINING</span>
        </div>
      </div>
    </div>
  );
}

function SafeZoneStatus({ safeZone }: { safeZone: SafeZoneSnapshot | null }) {
  const now = useHudNow();
  if (!safeZone?.enabled) return null;

  const targetTime = safeZone.shrinking ? safeZone.phaseEndsAt : safeZone.shrinkStartsAt;
  const secondsRemaining = Math.max(0, Math.ceil((targetTime - now) / 1000));
  const label = safeZone.shrinking ? 'ZONE CLOSING' : safeZone.warning ? 'ZONE WARNING' : 'NEXT ZONE';
  const toneClass = safeZone.shrinking
    ? 'border-red-300/40 bg-red-950/36 text-red-100'
    : safeZone.warning
      ? 'border-amber-200/40 bg-amber-950/34 text-amber-100'
      : 'border-cyan-200/24 bg-slate-950/46 text-cyan-100';

  return (
    <div className={`hud-safe-zone absolute left-1/2 top-[clamp(2.8rem,4.2vw,4rem)] z-[124] -translate-x-1/2 rounded-md border px-3 py-1.5 text-center shadow-2xl backdrop-blur-md ${toneClass}`}>
      <div className="font-display text-[0.62rem] tracking-[0.22em]">{label}</div>
      <div className="font-mono text-sm font-bold tabular-nums">{formatHudTime(secondsRemaining)}</div>
    </div>
  );
}

function BattleRoyalDropPrompt({
  gamePhase,
  status,
  canDrop,
  interactKeyLabel,
  attachedToPlayerId,
}: {
  gamePhase: string;
  status: BattleRoyalDropPlayerStatus | null;
  canDrop: boolean;
  interactKeyLabel: string;
  attachedToPlayerId: string | null;
}) {
  if (gamePhase !== 'deployment' || status === null || status === 'landed') return null;

  const isAboard = status === 'aboard';
  const isDropMaster = attachedToPlayerId === null;
  const isSquadPassenger = !isDropMaster;
  const showInputLabel = isDropMaster && (!isAboard || canDrop);
  const inputLabel = isAboard ? interactKeyLabel : 'WASD';
  const statusLabel = isAboard
    ? (isDropMaster && canDrop ? 'DROP MASTER' : 'STANDBY')
    : isSquadPassenger ? 'SQUAD POD' : 'DROP MASTER';
  const primaryText = isAboard
    ? (isDropMaster ? (canDrop ? 'DROP' : 'DROP OPENS') : 'WAIT FOR DROP')
    : isSquadPassenger ? 'RIDING POD'
    : 'STEER POD';
  const secondaryText = isAboard
    ? (isDropMaster ? (canDrop ? 'deploy squad' : 'over island') : 'drop master controls launch')
    : isSquadPassenger ? 'drop master steering'
    : 'mouse to guide';

  return (
    <div className="hud-center-bottom hud-drop-prompt absolute bottom-[clamp(6.25rem,14vh,8.75rem)] left-1/2 z-[126] -translate-x-1/2 text-center uppercase text-white">
      <div className="relative grid justify-items-center">
        <div className="mb-1.5 flex items-center justify-center gap-3">
          <span className="h-px w-[clamp(2.75rem,8vw,6.5rem)] bg-gradient-to-r from-transparent via-white/40 to-white/10" />
          <span className="font-mono text-[clamp(0.66rem,1vw,0.82rem)] font-black tracking-[0.38em] text-cyan-100/[0.72] drop-shadow-[0_2px_5px_rgba(0,0,0,0.88)]">
            {statusLabel}
          </span>
          <span className="h-px w-[clamp(2.75rem,8vw,6.5rem)] bg-gradient-to-l from-transparent via-white/40 to-white/10" />
        </div>

        <div className="flex items-center justify-center gap-[clamp(0.85rem,1.8vw,1.35rem)]">
          {showInputLabel ? (
            <span className="font-mono text-[clamp(1rem,1.8vw,1.35rem)] font-black leading-none tracking-[0.18em] text-cyan-100 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
              {inputLabel}
            </span>
          ) : null}
          <span className="font-display text-[clamp(1.85rem,3.8vw,3.25rem)] font-black leading-none tracking-[0.12em] text-white drop-shadow-[0_3px_10px_rgba(0,0,0,0.95)]">
            {primaryText}
          </span>
        </div>

        <span className="mt-1.5 font-mono text-[clamp(0.72rem,1.16vw,0.92rem)] font-black tracking-[0.28em] text-white/[0.74] drop-shadow-[0_2px_5px_rgba(0,0,0,0.88)]">
          {secondaryText}
        </span>
      </div>
    </div>
  );
}

function getDownedRemainingSeconds(
  player: Pick<Player, 'state' | 'reviveByPlayerId' | 'downedRemainingMs' | 'downedExpiresAt'>,
  now: number
): number {
  if (player.state !== 'downed') return 0;
  if (player.reviveByPlayerId) {
    return Math.max(0, (player.downedRemainingMs ?? 0) / 1000);
  }
  if (player.downedExpiresAt) {
    return Math.max(0, (player.downedExpiresAt - now) / 1000);
  }
  return Math.max(0, (player.downedRemainingMs ?? 0) / 1000);
}

function getReviveProgress(
  player: Pick<Player, 'reviveStartedAt' | 'reviveCompletesAt'>,
  now: number
): number {
  if (!player.reviveStartedAt || !player.reviveCompletesAt) return 0;
  const duration = Math.max(1, player.reviveCompletesAt - player.reviveStartedAt);
  return Math.max(0, Math.min(1, (now - player.reviveStartedAt) / duration));
}

function getHudMeterScale(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max)) return 0;
  return Math.max(0, Math.min(1, value / Math.max(1, max)));
}

function getPlayerDistanceSq(a: Player, b: Player): number {
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  const dz = a.position.z - b.position.z;
  return dx * dx + dy * dy + dz * dz;
}

function DownedStateHud({
  playerState,
  downedHealth: downedHealthInput,
  downedMaxHealth: downedMaxHealthInput,
  reviveByPlayerId,
  downedRemainingMs,
  downedExpiresAt,
  reviveStartedAt,
  reviveCompletesAt,
}: {
  playerState: Player['state'] | undefined;
  downedHealth: number | null | undefined;
  downedMaxHealth: number | null | undefined;
  reviveByPlayerId: string | null | undefined;
  downedRemainingMs: number | null | undefined;
  downedExpiresAt: number | null | undefined;
  reviveStartedAt: number | null | undefined;
  reviveCompletesAt: number | null | undefined;
}) {
  const now = useHudNow();
  if (playerState !== 'downed') return null;

  const downedHealth = Math.max(0, downedHealthInput ?? 0);
  const downedMaxHealth = Math.max(1, downedMaxHealthInput ?? 1);
  const remainingSeconds = Math.ceil(getDownedRemainingSeconds(
    { state: playerState, reviveByPlayerId, downedRemainingMs, downedExpiresAt },
    now
  ));
  const reviveProgress = getReviveProgress({ reviveStartedAt, reviveCompletesAt }, now);
  const isBeingRevived = Boolean(reviveByPlayerId);
  const downedHealthScale = getHudMeterScale(downedHealth, downedMaxHealth);
  const statusLabel = isBeingRevived ? 'REVIVING' : 'DOWNED';
  const statusTextColor = isBeingRevived ? 'text-cyan-100' : 'text-red-100';
  const statusLineColor = isBeingRevived
    ? 'from-transparent via-cyan-100/54 to-cyan-300/16'
    : 'from-transparent via-red-100/54 to-red-400/16';

  return (
    <div
      className="hud-center-bottom hud-downed-state absolute bottom-[clamp(6.5rem,13vh,8.75rem)] left-1/2 z-[126] w-[min(25rem,88vw)] -translate-x-1/2 text-center uppercase text-white"
      aria-label={`${statusLabel}: ${remainingSeconds} seconds remaining`}
    >
      <div className="relative isolate grid gap-2 px-1 py-1 drop-shadow-[0_3px_10px_rgba(0,0,0,0.9)]">
        <div
          className="absolute left-1/2 top-1/2 -z-10 h-20 w-[118%] -translate-x-1/2 -translate-y-1/2"
          style={{
            background: isBeingRevived
              ? 'radial-gradient(ellipse at center, rgba(8, 145, 178, 0.22) 0%, rgba(0, 0, 0, 0.26) 38%, transparent 72%)'
              : 'radial-gradient(ellipse at center, rgba(185, 28, 28, 0.26) 0%, rgba(0, 0, 0, 0.28) 38%, transparent 72%)',
          }}
        />

        <div className="flex items-center justify-center gap-3">
          <span className={`h-px min-w-10 flex-1 bg-gradient-to-r ${statusLineColor}`} />
          <span
            className={`font-display text-2xl leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)] sm:text-3xl ${statusTextColor}`}
            style={{ textShadow: isBeingRevived ? '0 0 14px rgba(103, 232, 249, 0.42)' : '0 0 14px rgba(248, 113, 113, 0.46)' }}
          >
            {statusLabel}
          </span>
          <span className="font-mono text-lg font-black leading-none tabular-nums text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]">
            {remainingSeconds}s
          </span>
          <span className={`h-px min-w-10 flex-1 bg-gradient-to-l ${statusLineColor}`} />
        </div>

        <div
          className="relative h-2.5 overflow-hidden bg-black/48 shadow-[0_0_0_1px_rgba(255,255,255,0.14),0_0_18px_rgba(248,113,113,0.16)]"
          style={{ clipPath: 'polygon(0.55rem 0, 100% 0, calc(100% - 0.55rem) 100%, 0 100%)' }}
        >
          <div
            className="h-full w-full origin-left transition-transform duration-150"
            style={{
              transform: `scaleX(${downedHealthScale})`,
              background: 'linear-gradient(90deg, rgba(239, 68, 68, 0.95), rgba(248, 113, 113, 0.88), rgba(251, 146, 60, 0.72))',
              boxShadow: '0 0 14px rgba(248, 113, 113, 0.72)',
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-white/20 via-transparent to-white/10" />
        </div>

        {isBeingRevived && (
          <div className="grid gap-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[0.64rem] font-black text-cyan-100/78">REVIVE</span>
              <span className="h-px flex-1 bg-gradient-to-r from-cyan-100/38 to-transparent" />
            </div>
            <div
              className="relative h-1.5 overflow-hidden bg-cyan-950/42 shadow-[0_0_0_1px_rgba(103,232,249,0.18),0_0_14px_rgba(34,211,238,0.16)]"
              style={{ clipPath: 'polygon(0.4rem 0, 100% 0, calc(100% - 0.4rem) 100%, 0 100%)' }}
            >
              <div
                className="h-full w-full origin-left bg-cyan-300 transition-transform duration-100"
                style={{
                  transform: `scaleX(${reviveProgress})`,
                  boxShadow: '0 0 10px rgba(103, 232, 249, 0.72)',
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviveChannelHud({
  target,
  interactKeyLabel,
}: {
  target: Player | null;
  interactKeyLabel: string;
}) {
  const now = useHudNow();
  if (!target || target.state !== 'downed') return null;

  const progress = getReviveProgress(target, now);
  const remainingMs = target.reviveCompletesAt ? Math.max(0, target.reviveCompletesAt - now) : BATTLE_ROYAL_REVIVE_DURATION_MS;

  return (
    <div className="hud-center-bottom hud-revive-channel absolute bottom-[clamp(6.5rem,13vh,8.5rem)] left-1/2 z-[126] w-[min(20rem,82vw)] -translate-x-1/2">
      <div className="rounded-md border border-cyan-200/28 bg-black/52 px-4 py-3 text-center shadow-2xl backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <span className="font-display text-xs tracking-[0.24em] text-cyan-100">REVIVING</span>
          <span className="font-mono text-sm font-bold tabular-nums text-white">{(remainingMs / 1000).toFixed(1)}s</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full w-full origin-left rounded-full bg-cyan-300 transition-transform duration-100"
            style={{
              transform: `scaleX(${progress})`,
              boxShadow: '0 0 12px rgba(103, 232, 249, 0.68)',
            }}
          />
        </div>
        <div className="mt-2 font-mono text-[0.68rem] font-bold tracking-[0.2em] text-white/62">
          HOLD {interactKeyLabel}
        </div>
      </div>
    </div>
  );
}

function RevivePromptHud({
  target,
  interactKeyLabel,
}: {
  target: Player | null;
  interactKeyLabel: string;
}) {
  if (!target) return null;
  return (
    <div className="hud-center-bottom hud-revive-prompt absolute bottom-[clamp(6.5rem,13vh,8.5rem)] left-1/2 z-[125] -translate-x-1/2 rounded-md border border-white/16 bg-black/42 px-4 py-2 text-center shadow-xl backdrop-blur-md">
      <span className="font-mono text-sm font-black tracking-[0.18em] text-white">
        {interactKeyLabel}
      </span>
      <span className="ml-2 font-display text-sm tracking-[0.18em] text-cyan-100">
        REVIVE
      </span>
    </div>
  );
}

function InteractionPromptHud({
  prompt,
  interactKeyLabel,
}: {
  prompt: InteractionPrompt | null;
  interactKeyLabel: string;
}) {
  if (!prompt) return null;

  return (
    <div className="hud-interaction-prompt absolute left-1/2 top-1/2 z-[126] mt-9 -translate-x-1/2 rounded-md border border-white/16 bg-black/42 px-3.5 py-2 text-center shadow-xl backdrop-blur-md">
      <div>
        <span className="font-mono text-sm font-black tracking-[0.16em] text-white">
          {interactKeyLabel}
        </span>
        <span className="ml-2 font-display text-sm tracking-[0.14em] text-cyan-100">
          {prompt.actionLabel}
        </span>
      </div>
      {prompt.targetLabel && (
        <div className="mt-0.5 font-body text-[0.68rem] text-white/50">
          {prompt.targetLabel}
        </div>
      )}
    </div>
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

const BLAZE_SHOT_COUNTER_TONE: ShotCounterTone = {
  labelClass: 'text-orange-100/50',
  readyClass: 'text-orange-50/96',
  reloadClass: 'text-amber-100',
  idleBackground: 'linear-gradient(135deg, rgba(95, 39, 12, 0.3), rgba(13, 8, 5, 0.24))',
  reloadBackground: 'linear-gradient(135deg, rgba(127, 45, 10, 0.38), rgba(28, 11, 5, 0.28))',
  idleBorder: '1px solid rgba(251, 146, 60, 0.24)',
  reloadBorder: '1px solid rgba(251, 191, 36, 0.36)',
  idleShadow: '0 0 18px rgba(249, 115, 22, 0.13), 0 8px 20px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255,255,255,0.06)',
  reloadShadow: '0 0 20px rgba(251, 146, 60, 0.22), 0 8px 20px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255,255,255,0.07)',
  idleFill: 'linear-gradient(90deg, rgba(249, 115, 22, 0.09), transparent)',
  reloadFill: 'linear-gradient(90deg, rgba(251, 146, 60, 0.14), rgba(250, 204, 21, 0.08))',
  idleProgress: 'linear-gradient(90deg, rgba(249, 115, 22, 0.66), rgba(251, 191, 36, 0.5))',
  reloadProgress: 'linear-gradient(90deg, rgba(250, 204, 21, 0.7), rgba(248, 113, 113, 0.48))',
  idleStroke: '#f97316',
  reloadStroke: '#facc15',
  idleTextShadow: '0 0 10px rgba(249, 115, 22, 0.4), 0 2px 8px rgba(0,0,0,0.7)',
  reloadTextShadow: '0 0 12px rgba(251, 191, 36, 0.58)',
  reloadStrokeFilter: 'drop-shadow(0 0 4px rgba(250, 204, 21, 0.76))',
  progressShadow: '0 0 8px rgba(251, 146, 60, 0.34)',
};

const CHRONOS_SHOT_COUNTER_TONE: ShotCounterTone = {
  labelClass: 'text-emerald-100/52',
  readyClass: 'text-emerald-50/96',
  reloadClass: 'text-lime-100',
  idleBackground: 'linear-gradient(135deg, rgba(14, 80, 55, 0.3), rgba(5, 18, 12, 0.24))',
  reloadBackground: 'linear-gradient(135deg, rgba(16, 100, 65, 0.38), rgba(6, 28, 17, 0.28))',
  idleBorder: '1px solid rgba(34, 197, 94, 0.24)',
  reloadBorder: '1px solid rgba(132, 204, 22, 0.38)',
  idleShadow: '0 0 18px rgba(34, 197, 94, 0.12), 0 8px 20px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255,255,255,0.06)',
  reloadShadow: '0 0 20px rgba(74, 222, 128, 0.22), 0 8px 20px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255,255,255,0.07)',
  idleFill: 'linear-gradient(90deg, rgba(34, 197, 94, 0.09), transparent)',
  reloadFill: 'linear-gradient(90deg, rgba(34, 197, 94, 0.15), rgba(190, 242, 100, 0.08))',
  idleProgress: 'linear-gradient(90deg, rgba(34, 197, 94, 0.66), rgba(134, 239, 172, 0.5))',
  reloadProgress: 'linear-gradient(90deg, rgba(190, 242, 100, 0.72), rgba(34, 197, 94, 0.48))',
  idleStroke: '#22c55e',
  reloadStroke: '#bef264',
  idleTextShadow: '0 0 10px rgba(34, 197, 94, 0.42), 0 2px 8px rgba(0,0,0,0.7)',
  reloadTextShadow: '0 0 12px rgba(190, 242, 100, 0.58)',
  reloadStrokeFilter: 'drop-shadow(0 0 4px rgba(190, 242, 100, 0.76))',
  progressShadow: '0 0 8px rgba(74, 222, 128, 0.34)',
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
  maxAmmo,
  reloadMs,
  infinite = false,
  tone,
}: {
  label: string;
  ammo: number;
  reloading: boolean;
  reloadStart: number;
  reloadEnd: number;
  now: number;
  maxAmmo: number;
  reloadMs: number;
  infinite?: boolean;
  tone: ShotCounterTone;
}) {
  const shownAmmo = Math.max(0, Math.min(maxAmmo, Math.round(ammo)));
  const reloadDuration = Math.max(1, reloadEnd - reloadStart || reloadMs);
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
      className="hud-ammo-counter relative w-[clamp(7.75rem,10vw,9.5rem)] rounded-md overflow-hidden backdrop-blur-md animate-fade-in"
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
              className={`hud-ammo-value font-mono text-[clamp(1.75rem,2.35vw,2.25rem)] font-bold leading-none tabular-nums ${isReloading ? tone.reloadClass : tone.readyClass}`}
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

const PhantomAmmoCounter = memo(function PhantomAmmoCounter({
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
      maxAmmo={PHANTOM_PRIMARY_MAGAZINE_SIZE}
      reloadMs={PHANTOM_PRIMARY_RELOAD_MS}
      tone={PHANTOM_SHOT_COUNTER_TONE}
    />
  );
});

function BlazeAmmoCounter({
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
      label="rocket"
      ammo={ammo}
      reloading={reloading}
      reloadStart={reloadStart}
      reloadEnd={reloadEnd}
      now={now}
      maxAmmo={BLAZE_PRIMARY_MAGAZINE_SIZE}
      reloadMs={BLAZE_PRIMARY_RELOAD_MS}
      tone={BLAZE_SHOT_COUNTER_TONE}
    />
  );
}

function ChronosAmmoCounter({
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
      label="pulse"
      ammo={ammo}
      reloading={reloading}
      reloadStart={reloadStart}
      reloadEnd={reloadEnd}
      now={now}
      maxAmmo={CHRONOS_PRIMARY_MAGAZINE_SIZE}
      reloadMs={CHRONOS_PRIMARY_RELOAD_MS}
      tone={CHRONOS_SHOT_COUNTER_TONE}
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
      maxAmmo={1}
      reloadMs={1}
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

const CHRONOS_LIFELINE_ICON_COLOR = 'rgba(255, 255, 255, 0.94)';
const CHRONOS_LIFELINE_ICON_MUTED = 'rgba(197, 255, 234, 0.62)';
const CHRONOS_LIFELINE_ICON_SOFT = 'rgba(4, 28, 25, 0.78)';

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
      <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M7.2 5.2h9.6c1 0 1.8.8 1.8 1.8v10c0 1-.8 1.8-1.8 1.8H7.2c-1 0-1.8-.8-1.8-1.8V7c0-1 .8-1.8 1.8-1.8Z"
          fill={CHRONOS_LIFELINE_ICON_SOFT}
          stroke={CHRONOS_LIFELINE_ICON_MUTED}
          strokeWidth="1.6"
        />
        <path d="M14.7 8.5H9.5v7h5.4M9.9 12h4.1" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    );
  }

  const leftActive = input === 'mouse-left';

  return (
    <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.5c-3.35 0-6.1 2.75-6.1 6.1v4.8c0 3.35 2.75 6.1 6.1 6.1s6.1-2.75 6.1-6.1V9.6c0-3.35-2.75-6.1-6.1-6.1Z"
        fill={CHRONOS_LIFELINE_ICON_SOFT}
        stroke={CHRONOS_LIFELINE_ICON_MUTED}
        strokeWidth="1.6"
      />
      <path d="M12 4.3v5.5" stroke="rgba(197,255,234,0.4)" strokeWidth="1.25" strokeLinecap="round" />
      <path
        d={leftActive ? 'M11.2 4.8c-2.3.35-4 2.35-4 4.8h4V4.8Z' : 'M12.8 4.8c2.3.35 4 2.35 4 4.8h-4V4.8Z'}
        fill={color}
      />
      <path d="M12 11.3v2" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
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
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8" stroke={color} strokeWidth="2.7" strokeLinecap="round" />
      </svg>
    );
  }

  if (icon === 'self') {
    return (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="10" cy="7.2" r="3" stroke={color} strokeWidth="2" />
        <path d="M4.7 18.6c.7-3.4 2.5-5.2 5.3-5.2s4.6 1.8 5.3 5.2" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <path d="M18.2 10.7v5M15.7 13.2h5" stroke={color} strokeWidth="2.25" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="8" cy="7.3" r="2.4" stroke={color} strokeWidth="1.9" />
      <circle cx="15.8" cy="7.3" r="2.4" stroke={color} strokeWidth="1.9" opacity="0.84" />
      <path d="M3.7 18.2c.6-3.1 2-4.7 4.3-4.7s3.7 1.6 4.3 4.7" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
      <path d="M12.5 14c.7-.4 1.5-.6 2.5-.6 2.2 0 3.7 1.6 4.3 4.7" stroke={color} strokeWidth="1.9" strokeLinecap="round" opacity="0.84" />
      <path d="M18.7 11.1v4.2M16.6 13.2h4.2" stroke={color} strokeWidth="2.05" strokeLinecap="round" />
    </svg>
  );
}

function ChronosLifelineHelper() {
  return (
    <div
      className="relative flex max-w-[92vw] items-center justify-center gap-3.5 rounded-full px-3 py-1.5 animate-fade-in sm:gap-5 sm:px-4"
      style={{
        background: 'linear-gradient(180deg, rgba(5, 31, 28, 0.84), rgba(3, 17, 22, 0.76))',
        border: '1px solid rgba(202, 255, 236, 0.24)',
        boxShadow: '0 10px 24px rgba(0, 0, 0, 0.34), 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.18)',
        backdropFilter: 'blur(10px) saturate(1.15)',
        filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.58))',
      }}
      aria-label="Chronos Lifeline helper actions"
    >
      <span className="absolute left-1/2 top-1/2 h-px w-[calc(100%-2rem)] -translate-x-1/2 bg-gradient-to-r from-transparent via-cyan-100/40 to-transparent" />

      {CHRONOS_LIFELINE_HELPERS.map((helper) => (
        <div
          key={helper.input}
          className="relative flex h-11 items-center gap-2"
          aria-label={helper.ariaLabel}
        >
          <ChronosLifelineInputGlyph input={helper.input} color={CHRONOS_LIFELINE_ICON_COLOR} />
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-100/65 shadow-[0_0_8px_rgba(186,255,236,0.5)]" />
          <ChronosLifelineActionIcon icon={helper.icon} color={CHRONOS_LIFELINE_ICON_COLOR} />
        </div>
      ))}
    </div>
  );
}

export function HUD() {
  const {
    // Local player decomposed into the specific fields the HUD reads, so the HUD
    // only re-renders when one of these values changes — not on every local
    // transform reconciliation tick (which churns the whole localPlayer object).
    localPlayerId,
    localPlayerRole,
    localPlayerState,
    localHealth,
    localMaxHealth,
    localDownedHealth,
    localDownedMaxHealth,
    localDownedRemainingMs,
    localDownedExpiresAt,
    localReviveStartedAt,
    localReviveCompletesAt,
    localReviveByPlayerId,
    localUltimateCharge,
    localHeroId,
    localHasFlag,
    localKills,
    localAbilities,
    localIsWallRunning,
    localIsSliding,
    localIsGrappling,
    localIsGliding,
    isPracticeMode,
    isTutorialMode,
    gameplayMode,
    gamePhase,
    redScore,
    blueScore,
    roundTimeRemaining,
    phaseEndTime,
    gameClockFrozen,
    safeZone,
    battleRoyalDrop,
    interactionPrompt,
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
    blazePrimaryAmmo,
    blazePrimaryReloading,
    blazePrimaryReloadStart,
    blazePrimaryReloadEnd,
    chronosPrimaryAmmo,
    chronosPrimaryReloading,
    chronosPrimaryReloadStart,
    chronosPrimaryReloadEnd,
    chronosLifelineQueued,
  } = useGameStore(
    useShallow(state => ({
      localPlayerId: state.localPlayer?.id ?? null,
      localPlayerRole: state.localPlayer?.role,
      localPlayerState: state.localPlayer?.state,
      localHealth: state.localPlayer?.health,
      localMaxHealth: state.localPlayer?.maxHealth,
      localDownedHealth: state.localPlayer?.downedHealth,
      localDownedMaxHealth: state.localPlayer?.downedMaxHealth,
      localDownedRemainingMs: state.localPlayer?.downedRemainingMs,
      localDownedExpiresAt: state.localPlayer?.downedExpiresAt,
      localReviveStartedAt: state.localPlayer?.reviveStartedAt,
      localReviveCompletesAt: state.localPlayer?.reviveCompletesAt,
      localReviveByPlayerId: state.localPlayer?.reviveByPlayerId,
      localUltimateCharge: state.localPlayer?.ultimateCharge,
      localHeroId: state.localPlayer?.heroId ?? null,
      localHasFlag: state.localPlayer?.hasFlag ?? false,
      localKills: state.localPlayer?.stats.kills ?? 0,
      localAbilities: state.localPlayer?.abilities,
      localIsWallRunning: state.localPlayer?.movement?.isWallRunning ?? false,
      localIsSliding: state.localPlayer?.movement?.isSliding ?? false,
      localIsGrappling: state.localPlayer?.movement?.isGrappling ?? false,
      localIsGliding: state.localPlayer?.movement?.isGliding ?? false,
      isPracticeMode: state.isPracticeMode,
      isTutorialMode: state.isTutorialMode,
      gameplayMode: state.gameplayMode,
      gamePhase: state.gamePhase,
      redScore: state.redScore,
      blueScore: state.blueScore,
      roundTimeRemaining: state.roundTimeRemaining,
      phaseEndTime: state.phaseEndTime,
      gameClockFrozen: state.gameClockFrozen,
      safeZone: state.safeZone,
      battleRoyalDrop: state.battleRoyalDrop,
      interactionPrompt: state.interactionPrompt,
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
      blazePrimaryAmmo: state.blazePrimaryAmmo,
      blazePrimaryReloading: state.blazePrimaryReloading,
      blazePrimaryReloadStart: state.blazePrimaryReloadStart,
      blazePrimaryReloadEnd: state.blazePrimaryReloadEnd,
      chronosPrimaryAmmo: state.chronosPrimaryAmmo,
      chronosPrimaryReloading: state.chronosPrimaryReloading,
      chronosPrimaryReloadStart: state.chronosPrimaryReloadStart,
      chronosPrimaryReloadEnd: state.chronosPrimaryReloadEnd,
      chronosLifelineQueued: state.chronosLifelineQueued,
    }))
  );
  const {
    crosshairStyle,
    crosshairColor,
    showKillFeed,
    interactKeybind,
  } = useSettingsStore(
    useShallow(state => ({
      crosshairStyle: state.settings.crosshairStyle,
      crosshairColor: state.settings.crosshairColor,
      showKillFeed: state.settings.showKillFeed,
      interactKeybind: state.settings.keybindings.interact,
    }))
  );
  const killFeed = useCombatFeedbackStore((state) => state.killFeed);
  const {
    battleRoyalRemainingPlayers,
    reviveChannelTarget,
    nearbyDownedAlly,
  } = useGameStore(
    useShallow(state => {
      const player = state.localPlayer;
      if (!player) {
        return { battleRoyalRemainingPlayers: 0, reviveChannelTarget: null, nearbyDownedAlly: null };
      }
      if (state.gameplayMode !== 'battle_royal') {
        return { battleRoyalRemainingPlayers: 0, reviveChannelTarget: null, nearbyDownedAlly: null };
      }

      let remainingPlayers = 0;
      let sawLocalPlayer = false;
      let channelTarget: Player | null = null;
      let nearestAlly: Player | null = null;
      let nearestDistanceSq = (BATTLE_ROYAL_REVIVE_RADIUS + 0.35) * (BATTLE_ROYAL_REVIVE_RADIUS + 0.35);

      for (const candidate of state.players.values()) {
        if (candidate.id === player.id) {
          sawLocalPlayer = true;
        }
        if (isBattleRoyalRemainingPlayer(candidate)) {
          remainingPlayers++;
        }
        if (state.gamePhase !== 'playing') continue;
        if (candidate.id === player.id || candidate.team !== player.team || candidate.state !== 'downed') continue;
        if (candidate.reviveByPlayerId === player.id) {
          channelTarget = candidate;
        }
        const distanceSq = getPlayerDistanceSq(player, candidate);
        if (distanceSq <= nearestDistanceSq && !candidate.reviveByPlayerId) {
          nearestDistanceSq = distanceSq;
          nearestAlly = candidate;
        }
      }

      return {
        battleRoyalRemainingPlayers: remainingPlayers + (
          !sawLocalPlayer && isBattleRoyalRemainingPlayer(player) ? 1 : 0
        ),
        reviveChannelTarget: channelTarget,
        nearbyDownedAlly: nearestAlly,
      };
    })
  );

  if (localPlayerId === null || localPlayerRole === 'observer') return null;

  const isLocalDowned = localPlayerState === 'downed';
  const isLocalReviving = Boolean(reviveChannelTarget);
  const displayedHealth = isLocalDowned ? localDownedHealth ?? 0 : localHealth ?? 0;
  const displayedMaxHealth = isLocalDowned ? Math.max(1, localDownedMaxHealth ?? 1) : localMaxHealth ?? 0;
  const healthPercent = (displayedHealth / displayedMaxHealth) * 100;
  const isLowHealth = healthPercent < 30;
  const isCriticalHealth = healthPercent < 15;
  const ultimatePercent = localUltimateCharge ?? 0;
  const heroSkillItems = localHeroId ? getHeroSkillItems(localHeroId) : [];
  const skillAccent = localHeroId ? HUD_HERO_COLORS[localHeroId].primary : HUD_HERO_COLORS.blaze.primary;
  const showChronosLifelineHelper = localHeroId === 'chronos' && chronosLifelineQueued;
  const isCaptureTheFlag = gameplayMode === 'capture_the_flag';
  const showFloatingFlag = localHasFlag;
  const floatingFlagTop = isPracticeMode
    ? 'clamp(3.25rem, 8vh, 4.75rem)'
    : 'calc(clamp(2.25rem, 3.4vw, 3.25rem) + 0.5rem)';
  const scoreLabel = gameplayMode === 'team_deathmatch' ? 'KILLS' : 'BATTLE';
  const battleRoyalEliminations = localKills;
  const battleRoyalDropPlayer = battleRoyalDrop?.players.find((player) => (
    player.playerId === localPlayerId
  )) ?? null;
  const battleRoyalDropStatus = battleRoyalDropPlayer?.status ?? null;
  const battleRoyalDropAttachedToPlayerId = battleRoyalDropPlayer?.attachedToPlayerId ?? null;
  const battleRoyalDropCanDrop = battleRoyalDrop?.ship.canDrop === true &&
    battleRoyalDropAttachedToPlayerId === null;
  const isBattleRoyalPreLanding = gameplayMode === 'battle_royal' && (
    battleRoyalDropStatus === 'aboard' ||
    battleRoyalDropStatus === 'dropping'
  );
  const suppressCombatHud = isBattleRoyalPreLanding || isLocalDowned || isLocalReviving;
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
      {!suppressCombatHud && (
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
      )}

      {!suppressCombatHud && (
        <InteractionPromptHud
          prompt={interactionPrompt}
          interactKeyLabel={formatKeybind(interactKeybind)}
        />
      )}
      {showKillFeed && <KillFeed events={killFeed} />}
      {!isTutorialMode && <Minimap />}
      {gameplayMode === 'battle_royal' && <SafeZoneStatus safeZone={safeZone} />}
      {gameplayMode === 'battle_royal' && (
        <BattleRoyalDropPrompt
          gamePhase={gamePhase}
          status={battleRoyalDropStatus}
          canDrop={battleRoyalDropCanDrop}
          interactKeyLabel={formatKeybind(interactKeybind)}
          attachedToPlayerId={battleRoyalDropAttachedToPlayerId}
        />
      )}
      {gameplayMode === 'battle_royal' && (
        <DownedStateHud
          playerState={localPlayerState}
          downedHealth={localDownedHealth}
          downedMaxHealth={localDownedMaxHealth}
          reviveByPlayerId={localReviveByPlayerId}
          downedRemainingMs={localDownedRemainingMs}
          downedExpiresAt={localDownedExpiresAt}
          reviveStartedAt={localReviveStartedAt}
          reviveCompletesAt={localReviveCompletesAt}
        />
      )}
      {gameplayMode === 'battle_royal' && (
        <ReviveChannelHud
          target={reviveChannelTarget}
          interactKeyLabel={formatKeybind(interactKeybind)}
        />
      )}
      {gameplayMode === 'battle_royal' && !isLocalDowned && !isLocalReviving && (
        <RevivePromptHud
          target={nearbyDownedAlly}
          interactKeyLabel={formatKeybind(interactKeybind)}
        />
      )}
      {!isPracticeMode && <VoiceHud />}

      {/* Meteor Strike targeting instructions */}
      {bombTargeting && !suppressCombatHud && (
        <div className="hud-targeting-instruction fixed top-1/3 left-1/2 -translate-x-1/2 text-center z-50 pointer-events-none">
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
      {voidRayCharging && !suppressCombatHud && localHeroId === 'phantom' && (
        <VoidRayChargeIndicator chargeStart={voidRayChargeStart} />
      )}

      {/* ===== TOP CENTER - Score Panel (Redesigned) ===== */}
      {!isPracticeMode && (
        <div className="hud-top-score absolute top-0 left-1/2 -translate-x-1/2 max-w-[92vw]">
          <div className="relative">
            {gameplayMode === 'battle_royal' ? (
              <BattleRoyalTopHud
                eliminations={battleRoyalEliminations}
                remainingPlayers={battleRoyalRemainingPlayers}
                gamePhase={gamePhase}
                phaseEndTime={phaseEndTime}
                roundTimeRemaining={roundTimeRemaining}
                gameClockFrozen={gameClockFrozen}
              />
            ) : (
              <div
                className="hud-top-panel flex items-stretch rounded-b-xl overflow-hidden backdrop-blur-md"
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
            )}

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
          className="hud-floating-flag absolute left-1/2 -translate-x-1/2"
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
      {heroSkillItems.length > 0 && !suppressCombatHud && (
        <div className="absolute bottom-[clamp(0.45rem,1vw,0.875rem)] left-1/2 flex max-w-[94vw] -translate-x-1/2 flex-col items-center gap-2 hud-skill-bar">
          {showChronosLifelineHelper && (
            <ChronosLifelineHelper />
          )}
          <div className="hud-skill-row flex items-end justify-center gap-2 sm:gap-2.5 lg:gap-3">
            {heroSkillItems.map((skill) => (
              <HUDSkillSlot
                key={`${skill.input}-${skill.name}`}
                skill={skill}
                abilityState={skill.abilityId ? localAbilities?.[skill.abilityId] : undefined}
                clientCooldownEnd={skill.abilityId ? clientCooldowns[skill.abilityId] : undefined}
                clientCharges={skill.abilityId ? clientCharges[skill.abilityId] : undefined}
                accentColor={skillAccent}
                ultimateCharge={ultimatePercent}
                ultimateEffectActive={ultimateEffectActive}
              />
            ))}
          </div>
        </div>
      )}

      {/* ===== BOTTOM RIGHT - Movement Status (Improved) ===== */}
      {!suppressCombatHud && (
      <div className="absolute bottom-4 right-4 xl:bottom-6 xl:right-6 flex flex-col items-end gap-2 hud-status">
        {localHeroId === 'phantom' && (
          <PhantomAmmoCounter
            ammo={phantomPrimaryAmmo}
            reloading={phantomPrimaryReloading}
            reloadStart={phantomPrimaryReloadStart}
            reloadEnd={phantomPrimaryReloadEnd}
          />
        )}
        {localHeroId === 'hookshot' && <HookshotShotCounter />}
        {localHeroId === 'blaze' && (
          <BlazeAmmoCounter
            ammo={blazePrimaryAmmo}
            reloading={blazePrimaryReloading}
            reloadStart={blazePrimaryReloadStart}
            reloadEnd={blazePrimaryReloadEnd}
          />
        )}
        {localHeroId === 'chronos' && (
          <ChronosAmmoCounter
            ammo={chronosPrimaryAmmo}
            reloading={chronosPrimaryReloading}
            reloadStart={chronosPrimaryReloadStart}
            reloadEnd={chronosPrimaryReloadEnd}
          />
        )}

        {/* Movement indicators container */}
        <div className="hud-movement-indicators flex flex-col items-end gap-1.5">
          {localIsWallRunning && <MovementIndicator label="WALL RUN" color="#06b6d4" icon="wall" />}
          {localIsSliding && <MovementIndicator label="SLIDE" color="#22c55e" icon="slide" />}
          {localIsGrappling && <MovementIndicator label="GRAPPLE" color="#06b6d4" icon="grapple" />}
          {flamethrowerActive && <MovementIndicator label="FLAME" color="#f97316" icon="flame" />}
          {localIsGliding && <MovementIndicator label="GLIDE" color="#a855f7" icon="glide" />}
        </div>

        {/* Flamethrower Fuel */}
        {localHeroId === 'blaze' && (
          <BlazeFuelIndicator fuel={flamethrowerFuel} active={flamethrowerActive} />
        )}

      </div>
      )}
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

const HUDSkillSlot = memo(function HUDSkillSlot({
  skill,
  abilityState,
  clientCooldownEnd,
  clientCharges,
  accentColor,
  ultimateCharge,
  ultimateEffectActive,
}: {
  skill: HeroSkillItem;
  abilityState?: AbilityState;
  clientCooldownEnd?: number;
  clientCharges?: number;
  accentColor: string;
  ultimateCharge: number;
  ultimateEffectActive?: boolean;
}) {
  const abilityId = skill.abilityId;
  const abilityDef = abilityId ? ABILITY_DEFINITIONS[abilityId] : undefined;
  const isUltimate = skill.tone === 'ultimate';
  const canTrackAbility = Boolean(abilityId && abilityDef);
  const maxCharges = getAbilityMaxCharges(abilityDef);
  const maxCooldown = abilityId ? getAbilityCooldownSeconds(abilityId, abilityDef, skill.cooldown || 0) : skill.cooldown || 0;
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

  const charges = getDisplayAbilityCharges({
    maxCharges,
    serverCharges: abilityState?.charges ?? maxCharges,
    clientCharges,
    clientCooldownEnd,
    now,
  });

  const onCooldown = cooldown > 0;
  const isUltReady = isUltimate && ultimateCharge >= 100;
  const isUltCharging = isUltimate && ultimateCharge < 100;
  const hasCharges = maxCharges > 1;
  const noChargesLeft = hasCharges && charges === 0;
  const isUsable = !showActiveTimer && !onCooldown && !noChargesLeft && (!isUltimate || isUltReady);
  const inputLabel = skill.input;
  const isWideInput = inputLabel.length > 1;

  return (
    <div className="hud-skill-slot relative drop-shadow-[0_5px_14px_rgba(0,0,0,0.42)]">
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
          color={accentColor}
          size="hud"
          muted={!isUsable && !showActiveTimer}
          active={isActive || isUltReady}
          className="hud-skill-icon"
        />

        {(onCooldown || noChargesLeft || isUltCharging) && (
          <div className="absolute inset-0 bg-black/50 rounded-md z-10" />
        )}

        {showActiveTimer && (
          <div
            className="absolute inset-0 rounded-md z-10"
            style={{
              background: `radial-gradient(circle at center, ${accentColor}44 0%, rgba(22, 163, 74, 0.22) 46%, transparent 72%)`,
              boxShadow: `inset 0 0 0 1px ${accentColor}99, 0 0 16px ${accentColor}66`,
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
              stroke={accentColor}
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
              background: `radial-gradient(circle at center, ${accentColor}55 0%, transparent 62%)`,
            }}
          />
        )}
      </div>
    </div>
  );
});

// ===== MOVEMENT INDICATOR (Improved) =====
const MovementIndicator = memo(function MovementIndicator({ label, color, icon }: { label: string; color: string; icon: string }) {
  return (
    <div
      className="hud-movement-indicator flex items-center gap-2 px-3 py-1.5 rounded-lg backdrop-blur-sm animate-fade-in"
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
});
