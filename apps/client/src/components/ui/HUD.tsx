import { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useShallow } from 'zustand/shallow';
import {
  ABILITY_DEFINITIONS,
  PHANTOM_PRIMARY_MAGAZINE_SIZE,
  PHANTOM_PRIMARY_RELOAD_MS,
  VOID_RAY_CHARGE_TIME,
} from '@voxel-strike/shared';
import { getHeroSkillItems, HeroSkillIcon, type HeroSkillItem } from './HeroSkillKit';
import { useCombatFeedbackStore, type DamageNumberEvent, type KillFeedEvent } from '../../store/combatFeedbackStore';
import { useSettingsStore, type CrosshairStyle } from '../../store/settingsStore';
import { FACTIONS, HUD_HERO_COLORS as HERO_COLORS } from '../../styles/colorTokens';

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

// Simple Void Ray charge indicator

function VoidRayChargeIndicator({ chargeStart }: { chargeStart: number }) {
  const [progress, setProgress] = useState(0);

  // Fast update loop for smooth animation
  useEffect(() => {
    // Immediately calculate initial progress
    const calcProgress = () => Math.min(1, (Date.now() - chargeStart) / VOID_RAY_CHARGE_TIME);
    setProgress(calcProgress());

    // Update at 60fps for smooth animation
    const interval = setInterval(() => {
      setProgress(calcProgress());
    }, 16);

    return () => clearInterval(interval);
  }, [chargeStart]);

  const isReady = progress >= 1;
  const circumference = 2 * Math.PI * 28;
  const strokeDashoffset = circumference * (1 - progress);

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
          cx="36"
          cy="36"
          r="28"
          fill="none"
          stroke={isReady ? '#00ffff' : '#9333ea'}
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{
            filter: isReady ? 'drop-shadow(0 0 6px #00ffff)' : 'drop-shadow(0 0 4px #9333ea)',
            transition: 'stroke 0.1s',
          }}
        />
      </svg>
      {/* Center text */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className={`font-mono text-sm font-bold ${isReady ? 'text-cyan-300' : 'text-white/80'}`}
          style={{ textShadow: isReady ? '0 0 8px #00ffff' : '0 2px 4px rgba(0,0,0,0.8)' }}
        >
          {isReady ? 'FIRE' : `${Math.floor(progress * 100)}%`}
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

function DamageNumberStack({ events }: { events: DamageNumberEvent[] }) {
  if (events.length === 0) return null;

  return (
    <div className="absolute left-1/2 top-[43%] -translate-x-1/2 flex flex-col-reverse items-center gap-1 z-[120]">
      {events.map((event, index) => (
        <div
          key={event.id}
          className="font-display text-xl text-orange-300 drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)] animate-fade-in"
          style={{
            transform: `translateY(${-index * 6}px) scale(${1 - index * 0.08})`,
            opacity: Math.max(0.35, 1 - index * 0.18),
          }}
        >
          -{Math.round(event.damage)}
        </div>
      ))}
    </div>
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
  const now = Date.now();
  const maxAmmo = PHANTOM_PRIMARY_MAGAZINE_SIZE;
  const shownAmmo = Math.max(0, Math.min(maxAmmo, Math.round(ammo)));
  const reloadDuration = Math.max(1, reloadEnd - reloadStart || PHANTOM_PRIMARY_RELOAD_MS);
  const reloadProgress = reloading
    ? Math.max(0, Math.min(1, (now - reloadStart) / reloadDuration))
    : 1;
  const reloadRemainingSeconds = Math.max(0, (reloadEnd - now) / 1000);
  const status = reloading ? `${reloadRemainingSeconds.toFixed(1)}s` : 'ready';

  return (
    <div
      className="relative w-[clamp(9rem,12vw,11.75rem)] rounded-md overflow-hidden backdrop-blur-sm animate-fade-in"
      style={{
        background: reloading
          ? 'linear-gradient(135deg, rgba(54, 36, 83, 0.7), rgba(10, 8, 18, 0.72))'
          : 'linear-gradient(135deg, rgba(38, 24, 60, 0.64), rgba(8, 7, 13, 0.62))',
        border: reloading
          ? '1px solid rgba(168, 85, 247, 0.72)'
          : '1px solid rgba(168, 85, 247, 0.38)',
        boxShadow: reloading
          ? '0 0 24px rgba(168, 85, 247, 0.28), inset 0 0 18px rgba(168, 85, 247, 0.1)'
          : '0 8px 22px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      <div
        className="absolute inset-y-0 left-0 transition-[width] duration-100"
        style={{
          width: `${reloadProgress * 100}%`,
          background: reloading
            ? 'linear-gradient(90deg, rgba(168, 85, 247, 0.22), rgba(34, 211, 238, 0.12))'
            : 'linear-gradient(90deg, rgba(168, 85, 247, 0.14), transparent)',
        }}
      />

      <div className="relative px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[9px] uppercase text-violet-200/80">dire</span>
          <span className={`font-mono text-[9px] uppercase ${reloading ? 'text-cyan-200' : 'text-white/45'}`}>
            {status}
          </span>
        </div>

        <div className="mt-0.5 flex items-end justify-between gap-3">
          <div className="flex items-baseline gap-1">
            <span
              className={`font-mono text-[clamp(2rem,3vw,2.7rem)] font-bold leading-none tabular-nums ${reloading ? 'text-violet-100' : 'text-white'}`}
              style={{ textShadow: reloading ? '0 0 14px rgba(168, 85, 247, 0.75)' : '0 2px 10px rgba(0,0,0,0.9)' }}
            >
              {shownAmmo.toString().padStart(2, '0')}
            </span>
            <span className="font-mono text-[11px] text-white/42 tabular-nums">/{maxAmmo}</span>
          </div>

          <div
            className="h-9 w-9 rounded-md border flex items-center justify-center"
            style={{
              borderColor: reloading ? 'rgba(34, 211, 238, 0.62)' : 'rgba(255, 255, 255, 0.14)',
              background: 'rgba(0, 0, 0, 0.28)',
            }}
          >
            <svg width="28" height="28" viewBox="0 0 28 28" className="-rotate-90">
              <circle cx="14" cy="14" r="10.5" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
              <circle
                cx="14"
                cy="14"
                r="10.5"
                fill="none"
                stroke={reloading ? '#22d3ee' : '#a855f7'}
                strokeWidth="3"
                strokeDasharray={`${reloadProgress * 66} 66`}
                strokeLinecap="round"
                style={{ filter: reloading ? 'drop-shadow(0 0 5px rgba(34, 211, 238, 0.9))' : 'none' }}
              />
            </svg>
          </div>
        </div>

        <div
          className="mt-2 grid gap-[3px]"
          style={{ gridTemplateColumns: `repeat(${maxAmmo}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: maxAmmo }, (_, index) => {
            const filled = index < shownAmmo;
            return (
              <div
                key={index}
                className="h-1.5 rounded-[2px] transition-colors duration-100"
                style={{
                  background: filled
                    ? 'linear-gradient(180deg, #d8b4fe, #7c3aed)'
                    : 'rgba(255, 255, 255, 0.12)',
                  boxShadow: filled ? '0 0 8px rgba(168, 85, 247, 0.62)' : 'none',
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function HUD() {
  const {
    localPlayer,
    redScore,
    blueScore,
    roundTimeRemaining,
    redFlag,
    blueFlag,
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
  } = useGameStore(
    useShallow(state => ({
      localPlayer: state.localPlayer,
      redScore: state.redScore,
      blueScore: state.blueScore,
      roundTimeRemaining: state.roundTimeRemaining,
      redFlag: state.redFlag,
      blueFlag: state.blueFlag,
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
    }))
  );
  const {
    crosshairStyle,
    crosshairColor,
    showDamageNumbers,
    showKillFeed,
  } = useSettingsStore(
    useShallow(state => ({
      crosshairStyle: state.settings.crosshairStyle,
      crosshairColor: state.settings.crosshairColor,
      showDamageNumbers: state.settings.showDamageNumbers,
      showKillFeed: state.settings.showKillFeed,
    }))
  );
  const { damageNumbers, killFeed } = useCombatFeedbackStore(
    useShallow(state => ({
      damageNumbers: state.damageNumbers,
      killFeed: state.killFeed,
    }))
  );

  // Force re-render every 100ms for smooth cooldown updates
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 100);
    return () => clearInterval(interval);
  }, []);

  if (!localPlayer) return null;

  const healthPercent = (localPlayer.health / localPlayer.maxHealth) * 100;
  const isLowHealth = healthPercent < 30;
  const isCriticalHealth = healthPercent < 15;
  const ultimatePercent = localPlayer.ultimateCharge ?? 0;
  const heroColors = localPlayer.heroId ? HERO_COLORS[localPlayer.heroId] : HERO_COLORS.phantom;
  const heroSkillItems = localPlayer.heroId ? getHeroSkillItems(localPlayer.heroId) : [];
  const healthColor = healthPercent <= 15
    ? '#ef4444'
    : healthPercent <= 30
      ? '#f97316'
      : healthPercent <= 55
        ? '#fbbf24'
        : '#22c55e';

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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

      {/* Crosshair - changes for bomb targeting mode */}
      <div className="crosshair">
        {bombTargeting ? (
          // Bomb targeting crosshair - larger, orange, with explosion radius indicator
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

      {showDamageNumbers && <DamageNumberStack events={damageNumbers} />}
      {showKillFeed && <KillFeed events={killFeed} />}

      {/* Bomb Targeting Instructions */}
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
              {bombTargetValid ? 'CLICK TO DROP BOMB' : 'TARGET OUT OF RANGE'}
            </p>
            <p className="text-white/70 text-xs">Right-click or ESC to cancel</p>
          </div>
        </div>
      )}

      {/* Void Ray Charge Indicator */}
      {voidRayCharging && localPlayer?.heroId === 'phantom' && (
        <VoidRayChargeIndicator chargeStart={voidRayChargeStart} />
      )}

      {/* ===== TOP CENTER - Score Panel (Redesigned) ===== */}
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

                {/* Flag carrier indicator */}
                {redFlag?.carrierId && (
                  <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 bg-black/40 rounded-full">
                    <span className="text-[9px]">🏴</span>
                    <span className="text-[8px] text-amber-300 font-display tracking-wider">FLAG</span>
                  </div>
                )}
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
                <span className={`font-mono text-base sm:text-lg lg:text-xl tracking-[0.12em] tabular-nums font-bold transition-colors ${roundTimeRemaining < 30 ? 'text-red-400 animate-pulse' :
                    roundTimeRemaining < 60 ? 'text-amber-300' : 'text-white'
                  }`}>
                  {formatTime(roundTimeRemaining)}
                </span>
                <span className="text-[6px] sm:text-[7px] font-display text-white/30 tracking-[0.24em] -mt-0.5">BATTLE</span>
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

                {/* Flag carrier indicator */}
                {blueFlag?.carrierId && (
                  <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 bg-black/40 rounded-full">
                    <span className="text-[9px]">🏴</span>
                    <span className="text-[8px] text-amber-300 font-display tracking-wider">FLAG</span>
                  </div>
                )}
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

      {/* ===== BOTTOM LEFT - Health ===== */}
      <div
        className="absolute hud-scale"
        style={{
          left: 'clamp(0.75rem, 1.25vw, 1.125rem)',
          bottom: 'clamp(0.75rem, 1.25vw, 1.125rem)',
        }}
      >
        <div className="relative w-[clamp(8.75rem,14vw,13rem)]">
          {localPlayer.hasFlag && (
            <div
              className="absolute -top-2 -right-2 w-5 h-5 rounded flex items-center justify-center animate-bounce border"
              style={{
                background: '#f59e0b',
                borderColor: '#fde047',
                boxShadow: '0 0 12px rgba(251, 191, 36, 0.55)',
              }}
            >
              <span className="text-[10px]">🏴</span>
            </div>
          )}

          <div
            className="h-2 sm:h-2.5 rounded-full overflow-hidden"
            style={{
              background: 'rgba(0, 0, 0, 0.42)',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              boxShadow: '0 1px 8px rgba(0, 0, 0, 0.35)',
            }}
          >
            <div
              className={`h-full rounded-full transition-all duration-150 ${isCriticalHealth ? 'health-bar-critical' :
                  isLowHealth ? 'health-bar-low' : ''
                }`}
              style={{
                width: `${healthPercent}%`,
                background: healthColor,
                boxShadow: `0 0 10px ${healthColor}66`,
              }}
            />
          </div>

        </div>
      </div>

      {/* ===== BOTTOM CENTER - Skill Bar ===== */}
      {heroSkillItems.length > 0 && (
        <div className="absolute bottom-[clamp(0.45rem,1vw,0.875rem)] left-1/2 -translate-x-1/2 max-w-[94vw]">
          <div className="flex items-end justify-center gap-1.5 sm:gap-2 lg:gap-2.5">
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
      <div className="absolute bottom-4 right-4 xl:bottom-6 xl:right-6 flex flex-col items-end gap-2">
        {localPlayer.heroId === 'phantom' && (
          <PhantomAmmoCounter
            ammo={phantomPrimaryAmmo}
            reloading={phantomPrimaryReloading}
            reloadStart={phantomPrimaryReloadStart}
            reloadEnd={phantomPrimaryReloadEnd}
          />
        )}

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
          <div
            className="flex items-center gap-3 px-3 py-2 rounded-lg backdrop-blur-sm mt-1"
            style={{
              background: flamethrowerActive ? 'rgba(249, 115, 22, 0.25)' : 'rgba(249, 115, 22, 0.1)',
              border: flamethrowerActive ? '1px solid rgba(249, 115, 22, 0.6)' : '1px solid rgba(249, 115, 22, 0.3)',
            }}
          >
            <span className="text-[9px] font-display text-orange-400 tracking-wider">FLAME</span>
            <div className="w-20 h-2 bg-black/60 rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-100"
                style={{
                  width: `${flamethrowerFuel}%`,
                  background: flamethrowerActive
                    ? 'linear-gradient(90deg, #ff6b00, #ffaa00)'
                    : 'linear-gradient(90deg, #f97316, #fbbf24)',
                  boxShadow: flamethrowerActive ? '0 0 15px rgba(255, 170, 0, 0.7)' : '0 0 10px rgba(249, 115, 22, 0.5)',
                }}
              />
            </div>
            <span className="text-[10px] font-mono text-orange-300/70">
              {Math.round(flamethrowerFuel)}%
            </span>
          </div>
        )}

      </div>

      {/* ===== FLAG CARRIER ALERT (Improved) ===== */}
      {localPlayer.hasFlag && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 animate-bounce-slow">
          <div
            className="relative px-6 py-3 rounded-xl overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.2) 0%, rgba(245, 158, 11, 0.3) 100%)',
              border: '2px solid rgba(251, 191, 36, 0.5)',
              boxShadow: '0 0 40px rgba(251, 191, 36, 0.3), inset 0 0 20px rgba(251, 191, 36, 0.1)',
            }}
          >
            {/* Animated border glow */}
            <div
              className="absolute inset-0 animate-pulse opacity-50"
              style={{
                background: 'radial-gradient(ellipse at center, rgba(251, 191, 36, 0.3) 0%, transparent 70%)',
              }}
            />

            <div className="relative flex items-center gap-4">
              <span className="text-2xl animate-bounce">🏴</span>
              <div className="flex flex-col">
                <span className="font-display text-amber-200 tracking-[0.2em] text-sm">
                  RETURN THE FLAG
                </span>
                <span className="text-[10px] text-amber-300/60 font-body">
                  to your base to score
                </span>
              </div>
              <div className="flex items-center gap-1 text-amber-400">
                <span className="font-display text-lg">→</span>
                <span className="font-display text-lg">→</span>
                <span className="font-display text-lg animate-pulse">→</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface AbilityState {
  abilityId: string;
  cooldownRemaining: number;
  charges: number;
  isActive: boolean;
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

  const now = Date.now();
  const clientCooldownRemaining = clientCooldownEnd && clientCooldownEnd > now
    ? Math.ceil((clientCooldownEnd - now) / 1000)
    : 0;

  const serverCooldown = abilityState?.cooldownRemaining ?? 0;
  // Ultimates use the charge system, not cooldowns - ignore any cooldown values
  const cooldown = isUltimate || !canTrackAbility ? 0 : (clientCooldownRemaining > 0 ? clientCooldownRemaining : serverCooldown);

  const serverCharges = abilityState?.charges ?? maxCharges;
  let charges = clientCharges !== undefined ? clientCharges : serverCharges;

  if (maxCharges > 1 && clientCooldownEnd && now >= clientCooldownEnd && charges === 0) {
    charges = maxCharges;
  }

  // For ultimates, use client-side effect state to avoid server sync flickering
  const isActive = canTrackAbility
    ? isUltimate ? (ultimateEffectActive ?? false) : (abilityState?.isActive ?? false)
    : false;
  const onCooldown = cooldown > 0;
  const isUltReady = isUltimate && ultimateCharge >= 100;
  const isUltCharging = isUltimate && ultimateCharge < 100;
  const hasCharges = maxCharges > 1;
  const noChargesLeft = hasCharges && charges === 0;
  const isUsable = !onCooldown && !noChargesLeft && (!isUltimate || isUltReady);
  const inputLabel = skill.input === 'PASSIVE' ? 'P' : skill.input;
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
          muted={!isUsable}
          active={isActive || isUltReady}
        />

        {(onCooldown || noChargesLeft || isUltCharging) && (
          <div className="absolute inset-0 bg-black/50 rounded-md z-10" />
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
          className={`absolute top-0.5 left-0.5 z-30 h-4 rounded flex items-center justify-center font-mono font-bold leading-none ${isWideInput ? 'min-w-[1.45rem] px-1 text-[7px]' : 'w-4 text-[9px]'} ${isUsable
              ? isUltimate
                ? 'bg-amber-500/70 text-amber-100'
                : 'bg-white/30 text-white'
              : 'bg-black/60 text-white/45'
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

        {isActive && (
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
