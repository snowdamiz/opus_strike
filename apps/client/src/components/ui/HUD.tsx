import { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useShallow } from 'zustand/shallow';
import { HERO_DEFINITIONS, ABILITY_DEFINITIONS, VOID_RAY_CHARGE_TIME } from '@voxel-strike/shared';
import { HeroIcon, AbilityIcon, getAbilityIconType } from './HeroIcons';
import type { HeroId } from '@voxel-strike/shared';

// Hero color schemes for theming
const HERO_COLORS: Record<string, { primary: string; glow: string; bg: string }> = {
  phantom: { primary: '#a855f7', glow: 'rgba(168, 85, 247, 0.4)', bg: 'rgba(168, 85, 247, 0.15)' },
  hookshot: { primary: '#06b6d4', glow: 'rgba(6, 182, 212, 0.4)', bg: 'rgba(6, 182, 212, 0.15)' },
  blaze: { primary: '#f97316', glow: 'rgba(249, 115, 22, 0.5)', bg: 'rgba(249, 115, 22, 0.15)' },
  glacier: { primary: '#3b82f6', glow: 'rgba(59, 130, 246, 0.4)', bg: 'rgba(59, 130, 246, 0.15)' },
  pulse: { primary: '#22c55e', glow: 'rgba(34, 197, 94, 0.4)', bg: 'rgba(34, 197, 94, 0.15)' },
  sentinel: { primary: '#eab308', glow: 'rgba(234, 179, 8, 0.4)', bg: 'rgba(234, 179, 8, 0.15)' },
};

// Faction definitions matching lobby
const FACTIONS = {
  red: {
    name: 'SOLAR',
    fullName: 'SOLAR VANGUARD',
    primaryColor: '#f97316',
    secondaryColor: '#fbbf24',
    glowColor: 'rgba(249, 115, 22, 0.5)',
    gradient: 'linear-gradient(180deg, rgba(249, 115, 22, 0.5) 0%, rgba(234, 88, 12, 0.6) 100%)',
  },
  blue: {
    name: 'VOID',
    fullName: 'VOID LEGION',
    primaryColor: '#06b6d4',
    secondaryColor: '#8b5cf6',
    glowColor: 'rgba(6, 182, 212, 0.5)',
    gradient: 'linear-gradient(180deg, rgba(6, 182, 212, 0.5) 0%, rgba(139, 92, 246, 0.5) 100%)',
  },
} as const;

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
    jetpackFuel,
    jetpackActive,
    iceWallRushFuel,
    iceWallRushActive,
    frostStormActive,
    frostStormShield,
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
      jetpackFuel: state.jetpackFuel,
      jetpackActive: state.jetpackActive,
      iceWallRushFuel: state.iceWallRushFuel,
      iceWallRushActive: state.iceWallRushActive,
      frostStormActive: state.frostStormActive,
      frostStormShield: state.frostStormShield,
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
  const isUltReady = ultimatePercent >= 100;
  const heroInfo = localPlayer.heroId ? HERO_DEFINITIONS[localPlayer.heroId] : null;
  const heroColors = localPlayer.heroId ? HERO_COLORS[localPlayer.heroId] : HERO_COLORS.phantom;
  const playerFaction = localPlayer.team === 'red' ? FACTIONS.red : FACTIONS.blue;

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
          // Normal crosshair
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="2" fill="white" fillOpacity="0.95" />
            <line x1="12" y1="4" x2="12" y2="8" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
            <line x1="12" y1="16" x2="12" y2="20" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
            <line x1="4" y1="12" x2="8" y2="12" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
            <line x1="16" y1="12" x2="20" y2="12" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
          </svg>
        )}
      </div>

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
      <div className="absolute top-0 left-1/2 -translate-x-1/2">
        <div className="relative">
          {/* Main score container */}
          <div
            className="flex items-stretch rounded-b-2xl overflow-hidden backdrop-blur-md"
            style={{
              background: 'linear-gradient(180deg, rgba(10, 10, 15, 0.95) 0%, rgba(15, 15, 25, 0.9) 100%)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), inset 0 -1px 0 rgba(255,255,255,0.05)',
            }}
          >
            {/* Solar Vanguard Side */}
            <div className="relative group">
              <div
                className="w-14 sm:w-16 lg:w-24 xl:w-28 h-10 sm:h-12 lg:h-16 flex items-center justify-center gap-1 sm:gap-1.5 lg:gap-2 relative overflow-hidden"
                style={{
                  background: FACTIONS.red.gradient,
                }}
              >
                {/* Animated glow effect */}
                <div
                  className="absolute inset-0 opacity-50"
                  style={{
                    background: `radial-gradient(ellipse at 50% 100%, ${FACTIONS.red.glowColor} 0%, transparent 70%)`,
                  }}
                />

                <SolarIconSmall className="w-3.5 h-3.5 sm:w-4 sm:h-4 lg:w-5 lg:h-5 text-white/80 relative z-10" />
                <span
                  className="font-display text-2xl sm:text-3xl lg:text-4xl text-white tabular-nums drop-shadow-lg relative z-10"
                  style={{ textShadow: `0 0 20px ${FACTIONS.red.glowColor}` }}
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
                className="absolute -bottom-4 sm:-bottom-5 left-0 right-0 h-4 sm:h-5 flex items-center justify-center"
                style={{ background: `linear-gradient(180deg, ${FACTIONS.red.primaryColor}30, transparent)` }}
              >
                <span className="text-[6px] sm:text-[7px] lg:text-[8px] font-display tracking-[0.25em] text-orange-300/70">SOLAR</span>
              </div>
            </div>

            {/* Center Divider + Timer */}
            <div className="relative flex items-center">
              {/* Diagonal dividers */}
              <div
                className="absolute -left-3 top-0 bottom-0 w-6 z-10"
                style={{
                  background: 'linear-gradient(135deg, transparent 45%, rgba(10,10,15,0.95) 45%, rgba(10,10,15,0.95) 55%, transparent 55%)',
                }}
              />
              <div
                className="absolute -right-3 top-0 bottom-0 w-6 z-10"
                style={{
                  background: 'linear-gradient(-135deg, transparent 45%, rgba(10,10,15,0.95) 45%, rgba(10,10,15,0.95) 55%, transparent 55%)',
                }}
              />

              {/* Timer */}
              <div className="relative px-4 sm:px-6 lg:px-8 h-10 sm:h-12 lg:h-16 flex flex-col items-center justify-center z-20 min-w-[60px] sm:min-w-[80px] lg:min-w-[100px]">
                <span className={`font-mono text-lg sm:text-xl lg:text-2xl tracking-[0.15em] tabular-nums font-bold transition-colors ${roundTimeRemaining < 30 ? 'text-red-400 animate-pulse' :
                    roundTimeRemaining < 60 ? 'text-amber-300' : 'text-white'
                  }`}>
                  {formatTime(roundTimeRemaining)}
                </span>
                <span className="text-[6px] sm:text-[7px] lg:text-[8px] font-display text-white/30 tracking-[0.3em] -mt-0.5">BATTLE</span>
              </div>
            </div>

            {/* Void Legion Side */}
            <div className="relative group">
              <div
                className="w-14 sm:w-16 lg:w-24 xl:w-28 h-10 sm:h-12 lg:h-16 flex items-center justify-center gap-1 sm:gap-1.5 lg:gap-2 relative overflow-hidden"
                style={{
                  background: FACTIONS.blue.gradient,
                }}
              >
                {/* Animated glow effect */}
                <div
                  className="absolute inset-0 opacity-50"
                  style={{
                    background: `radial-gradient(ellipse at 50% 100%, ${FACTIONS.blue.glowColor} 0%, transparent 70%)`,
                  }}
                />

                <span
                  className="font-display text-2xl sm:text-3xl lg:text-4xl text-white tabular-nums drop-shadow-lg relative z-10"
                  style={{ textShadow: `0 0 20px ${FACTIONS.blue.glowColor}` }}
                >
                  {blueScore}
                </span>
                <VoidIconSmall className="w-3.5 h-3.5 sm:w-4 sm:h-4 lg:w-5 lg:h-5 text-white/80 relative z-10" />

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
                className="absolute -bottom-4 sm:-bottom-5 left-0 right-0 h-4 sm:h-5 flex items-center justify-center"
                style={{ background: `linear-gradient(180deg, ${FACTIONS.blue.primaryColor}30, transparent)` }}
              >
                <span className="text-[6px] sm:text-[7px] lg:text-[8px] font-display tracking-[0.25em] text-cyan-300/70">VOID</span>
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

      {/* ===== BOTTOM LEFT - Hero Portrait & Health (Redesigned) ===== */}
      <div className="absolute bottom-4 left-4 xl:bottom-6 xl:left-6 hud-scale">
        <div className="flex items-end gap-4">
          {/* Hero Portrait Frame */}
          <div className="relative">
            {/* Outer glow based on faction */}
            <div
              className="absolute -inset-1 rounded-xl opacity-60"
              style={{
                background: `radial-gradient(circle, ${playerFaction.glowColor} 0%, transparent 70%)`,
              }}
            />

            {/* Flag carrier badge */}
            {localPlayer.hasFlag && (
              <div
                className="absolute -top-3 -right-3 w-7 h-7 rounded-lg flex items-center justify-center animate-bounce border-2"
                style={{
                  background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
                  borderColor: '#fde047',
                  boxShadow: '0 0 15px rgba(251, 191, 36, 0.6)',
                }}
              >
                <span className="text-sm">🏴</span>
              </div>
            )}
          </div>

          {/* Health & Stats Stack */}
          <div className="flex flex-col gap-2">
            {/* Health Bar */}
            <div className="relative w-32 lg:w-36 xl:w-44 2xl:w-52">
              <div
                className="h-8 rounded-lg overflow-hidden backdrop-blur-sm"
                style={{
                  background: 'rgba(0, 0, 0, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.5)',
                }}
              >
                {/* Health fill */}
                <div
                  className={`h-full transition-all duration-150 relative ${isCriticalHealth ? 'health-bar-critical' :
                      isLowHealth ? 'health-bar-low' : ''
                    }`}
                  style={{
                    width: `${healthPercent}%`,
                    background: isCriticalHealth
                      ? 'linear-gradient(180deg, #ef4444 0%, #b91c1c 100%)'
                      : isLowHealth
                        ? 'linear-gradient(180deg, #f97316 0%, #c2410c 100%)'
                        : 'linear-gradient(180deg, #22c55e 0%, #15803d 100%)',
                    boxShadow: isCriticalHealth
                      ? 'inset 0 0 20px rgba(239, 68, 68, 0.5)'
                      : isLowHealth
                        ? 'inset 0 0 20px rgba(249, 115, 22, 0.5)'
                        : 'inset 0 0 20px rgba(34, 197, 94, 0.3)',
                  }}
                >
                  {/* Shine effect */}
                  <div className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent h-1/2" />
                </div>

                {/* Health text */}
                <div className="absolute inset-0 flex items-center justify-between px-3">
                  <span className="font-mono text-lg text-white font-bold drop-shadow-lg">
                    {Math.ceil(localPlayer.health)}
                  </span>
                  <span className="text-[10px] text-white/50 font-mono">
                    / {localPlayer.maxHealth}
                  </span>
                </div>
              </div>

              {/* Frost Storm Shield Bar - shown when active */}
              {frostStormActive && frostStormShield > 0 && (
                <div
                  className="h-3 mt-1 rounded-md overflow-hidden backdrop-blur-sm"
                  style={{
                    background: 'rgba(0, 0, 0, 0.6)',
                    border: '1px solid rgba(96, 165, 250, 0.4)',
                    boxShadow: '0 0 10px rgba(59, 130, 246, 0.3)',
                  }}
                >
                  {/* Shield fill */}
                  <div
                    className="h-full transition-all duration-150 relative"
                    style={{
                      width: `${(frostStormShield / 75) * 100}%`,
                      background: 'linear-gradient(180deg, #60a5fa 0%, #3b82f6 100%)',
                      boxShadow: 'inset 0 0 15px rgba(147, 197, 253, 0.5)',
                    }}
                  >
                    {/* Shine effect */}
                    <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent h-1/2" />
                  </div>

                  {/* Shield text */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[9px] font-mono text-cyan-200 font-bold drop-shadow-lg">
                      ❄ {Math.ceil(frostStormShield)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Faction indicator */}
            <div className="flex items-center gap-2">
              {localPlayer.team === 'red' ? (
                <SolarIconSmall className="w-3.5 h-3.5" style={{ color: playerFaction.primaryColor }} />
              ) : (
                <VoidIconSmall className="w-3.5 h-3.5" style={{ color: playerFaction.primaryColor }} />
              )}
              <span
                className="text-[9px] font-display tracking-[0.2em]"
                style={{ color: playerFaction.primaryColor }}
              >
                {playerFaction.fullName}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ===== BOTTOM CENTER - Ability Bar (Improved) ===== */}
      {heroInfo && (
        <div className="absolute bottom-2 sm:bottom-3 lg:bottom-4 xl:bottom-6 left-1/2 -translate-x-1/2">
          <div
            className="flex items-end gap-1.5 sm:gap-2 lg:gap-4 px-2 sm:px-3 lg:px-4 xl:px-5 py-1.5 sm:py-2 lg:py-3 rounded-lg sm:rounded-xl backdrop-blur-md"
            style={{
              background: 'rgba(10, 10, 15, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
            }}
          >
            {/* Ability 1 (E) */}
            <AbilitySlotApex
              abilityId={heroInfo.ability1.abilityId}
              keybind="E"
              abilityState={localPlayer.abilities?.[heroInfo.ability1.abilityId]}
              clientCooldownEnd={clientCooldowns[heroInfo.ability1.abilityId]}
              clientCharges={clientCharges[heroInfo.ability1.abilityId]}
              isUltimate={false}
              heroColor={heroColors.primary}
              ultimateCharge={ultimatePercent}
            />

            {/* Ability 2 (Q) */}
            <AbilitySlotApex
              abilityId={heroInfo.ability2.abilityId}
              keybind="Q"
              abilityState={localPlayer.abilities?.[heroInfo.ability2.abilityId]}
              clientCooldownEnd={clientCooldowns[heroInfo.ability2.abilityId]}
              isUltimate={false}
              heroColor={heroColors.primary}
              ultimateCharge={ultimatePercent}
            />

            {/* Divider */}
            <div className="w-px h-8 sm:h-10 lg:h-12 bg-gradient-to-b from-transparent via-white/20 to-transparent" />

            {/* Ultimate (F) */}
            <AbilitySlotApex
              abilityId={heroInfo.ultimate.abilityId}
              keybind="F"
              abilityState={localPlayer.abilities?.[heroInfo.ultimate.abilityId]}
              clientCooldownEnd={clientCooldowns[heroInfo.ultimate.abilityId]}
              isUltimate={true}
              heroColor={heroColors.primary}
              ultimateCharge={ultimatePercent}
              ultimateEffectActive={ultimateEffectActive}
            />
          </div>
        </div>
      )}

      {/* ===== BOTTOM RIGHT - Movement Status (Improved) ===== */}
      <div className="absolute bottom-4 right-4 xl:bottom-6 xl:right-6 flex flex-col items-end gap-2">

        {/* Movement indicators container */}
        <div className="flex flex-col items-end gap-1.5">
          {localPlayer.movement?.isWallRunning && <MovementIndicator label="WALL RUN" color="#06b6d4" icon="wall" />}
          {localPlayer.movement?.isSliding && <MovementIndicator label="SLIDE" color="#22c55e" icon="slide" />}
          {localPlayer.movement?.isGrappling && <MovementIndicator label="GRAPPLE" color="#06b6d4" icon="grapple" />}
          {localPlayer.movement?.isJetpacking && <MovementIndicator label="JETPACK" color="#f97316" icon="jetpack" />}
          {localPlayer.movement?.isGliding && <MovementIndicator label="GLIDE" color="#a855f7" icon="glide" />}
        </div>

        {/* Jetpack Fuel */}
        {localPlayer.heroId === 'blaze' && (
          <div
            className="flex items-center gap-3 px-3 py-2 rounded-lg backdrop-blur-sm mt-1"
            style={{
              background: jetpackActive ? 'rgba(249, 115, 22, 0.25)' : 'rgba(249, 115, 22, 0.1)',
              border: jetpackActive ? '1px solid rgba(249, 115, 22, 0.6)' : '1px solid rgba(249, 115, 22, 0.3)',
            }}
          >
            <span className="text-[9px] font-display text-orange-400 tracking-wider">FUEL</span>
            <div className="w-20 h-2 bg-black/60 rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-100"
                style={{
                  width: `${jetpackFuel}%`,
                  background: jetpackActive
                    ? 'linear-gradient(90deg, #ff6b00, #ffaa00)'
                    : 'linear-gradient(90deg, #f97316, #fbbf24)',
                  boxShadow: jetpackActive ? '0 0 15px rgba(255, 170, 0, 0.7)' : '0 0 10px rgba(249, 115, 22, 0.5)',
                }}
              />
            </div>
            <span className="text-[10px] font-mono text-orange-300/70">
              {Math.round(jetpackFuel)}%
            </span>
          </div>
        )}

        {/* Ice Wall Rush Charge (Glacier E ability) */}
        {localPlayer.heroId === 'glacier' && (
          <div
            className="flex items-center gap-3 px-3 py-2 rounded-lg backdrop-blur-sm mt-1"
            style={{
              background: iceWallRushActive ? 'rgba(59, 130, 246, 0.25)' : 'rgba(59, 130, 246, 0.1)',
              border: iceWallRushActive ? '1px solid rgba(59, 130, 246, 0.6)' : '1px solid rgba(59, 130, 246, 0.3)',
            }}
          >
            <span className="text-[9px] font-display text-blue-400 tracking-wider">ICE</span>
            <div className="w-20 h-2 bg-black/60 rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-100"
                style={{
                  width: `${iceWallRushFuel}%`,
                  background: iceWallRushActive
                    ? 'linear-gradient(90deg, #3b82f6, #60a5fa)'
                    : 'linear-gradient(90deg, #60a5fa, #93c5fd)',
                  boxShadow: iceWallRushActive ? '0 0 15px rgba(96, 165, 250, 0.7)' : '0 0 10px rgba(59, 130, 246, 0.5)',
                }}
              />
            </div>
            <span className="text-[10px] font-mono text-blue-300/70">
              {Math.round(iceWallRushFuel)}%
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

// ===== APEX LEGENDS STYLE ABILITY SLOT =====
interface AbilityState {
  abilityId: string;
  cooldownRemaining: number;
  charges: number;
  isActive: boolean;
}

function AbilitySlotApex({
  abilityId,
  keybind,
  abilityState,
  clientCooldownEnd,
  clientCharges,
  isUltimate,
  heroColor,
  ultimateCharge,
  ultimateEffectActive,
}: {
  abilityId: string;
  keybind: string;
  abilityState?: AbilityState;
  clientCooldownEnd?: number;
  clientCharges?: number;
  isUltimate: boolean;
  heroColor: string;
  ultimateCharge: number;
  ultimateEffectActive?: boolean;
}) {
  const abilityDef = ABILITY_DEFINITIONS[abilityId];
  if (!abilityDef) return null;

  const iconType = getAbilityIconType(abilityId);
  const maxCharges = abilityDef.charges || 1;
  const maxCooldown = abilityId === 'phantom_blink' ? 10 : (abilityDef.cooldown || 10);

  const now = Date.now();
  const clientCooldownRemaining = clientCooldownEnd && clientCooldownEnd > now
    ? Math.ceil((clientCooldownEnd - now) / 1000)
    : 0;

  const serverCooldown = abilityState?.cooldownRemaining ?? 0;
  // Ultimates use the charge system, not cooldowns - ignore any cooldown values
  const cooldown = isUltimate ? 0 : (clientCooldownRemaining > 0 ? clientCooldownRemaining : serverCooldown);

  const serverCharges = abilityState?.charges ?? maxCharges;
  let charges = clientCharges !== undefined ? clientCharges : serverCharges;

  if (maxCharges > 1 && clientCooldownEnd && now >= clientCooldownEnd && charges === 0) {
    charges = maxCharges;
  }

  // For ultimates, use client-side effect state to avoid server sync flickering
  const isActive = isUltimate ? (ultimateEffectActive ?? false) : (abilityState?.isActive ?? false);
  const onCooldown = cooldown > 0;
  const isUltReady = isUltimate && ultimateCharge >= 100;
  const isUltCharging = isUltimate && ultimateCharge < 100;
  const hasCharges = maxCharges > 1;
  const noChargesLeft = hasCharges && charges === 0;
  const isUsable = !onCooldown && !noChargesLeft && (!isUltimate || isUltReady);
  const iconSize = isUltimate ? 28 : 24;

  return (
    <div className="flex flex-col items-center gap-0.5 sm:gap-1 lg:gap-1.5">
      {/* Ability name label */}
      <span className={`text-[7px] sm:text-[8px] lg:text-[9px] font-body tracking-wide uppercase ${isUsable ? 'text-white/70' : 'text-white/30'
        }`}>
        {abilityDef.name}
      </span>

      {/* Main ability container */}
      <div className="relative">
        {/* Outer glow for ready ultimate */}
        {isUltReady && (
          <div
            className="absolute -inset-1 sm:-inset-2 rounded-lg sm:rounded-xl animate-pulse"
            style={{
              background: 'radial-gradient(circle, rgba(251, 191, 36, 0.4) 0%, transparent 70%)',
            }}
          />
        )}

        {/* Ability box */}
        <div
          className={`
            relative w-10 h-10 sm:w-11 sm:h-11 lg:w-14 lg:h-14 rounded-lg sm:rounded-xl overflow-hidden transition-all duration-150
            ${isActive ? 'ring-2 ring-white' : ''}
          `}
          style={{
            background: isUsable
              ? isUltimate
                ? 'linear-gradient(180deg, rgba(251, 191, 36, 0.35) 0%, rgba(180, 83, 9, 0.45) 100%)'
                : `linear-gradient(180deg, ${heroColor}40 0%, ${heroColor}25 100%)`
              : 'linear-gradient(180deg, rgba(30, 30, 40, 0.95) 0%, rgba(20, 20, 30, 0.98) 100%)',
            border: isUsable
              ? `2px solid ${isUltimate ? 'rgba(251, 191, 36, 0.8)' : heroColor}`
              : '2px solid rgba(60, 60, 70, 0.5)',
            boxShadow: isUsable
              ? isUltimate
                ? '0 0 20px rgba(251, 191, 36, 0.3), inset 0 0 15px rgba(251, 191, 36, 0.1)'
                : `0 0 15px ${heroColor}30, inset 0 0 10px ${heroColor}10`
              : 'inset 0 2px 8px rgba(0,0,0,0.4)',
          }}
        >
          {/* Cooldown overlay */}
          {(onCooldown || noChargesLeft || isUltCharging) && (
            <div className="absolute inset-0 bg-black/50 z-10" />
          )}

          {/* Radial cooldown sweep */}
          {onCooldown && maxCooldown > 0 && (
            <svg className="absolute inset-0 w-full h-full z-20 -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="rgba(0,0,0,0.7)"
                strokeWidth="90"
                strokeDasharray={`${(cooldown / maxCooldown) * 283} 283`}
                className="transition-all duration-100"
              />
            </svg>
          )}

          {/* Keybind badge */}
          <div
            className={`absolute top-0.5 left-0.5 sm:top-1 sm:left-1 z-30 min-w-[16px] h-[16px] sm:min-w-[18px] sm:h-[18px] lg:min-w-[22px] lg:h-[22px] rounded sm:rounded-md flex items-center justify-center text-[9px] sm:text-[10px] lg:text-[11px] font-mono font-bold ${isUsable
                ? isUltimate
                  ? 'bg-amber-500/60 text-amber-100'
                  : 'bg-white/30 text-white'
                : 'bg-black/60 text-white/40'
              }`}
          >
            {keybind}
          </div>

          {/* Ability Icon */}
          <div className={`absolute inset-0 flex items-center justify-center z-20 scale-75 sm:scale-90 lg:scale-100 ${!isUsable ? 'opacity-30' : ''
            }`}>
            <AbilityIcon
              type={iconType}
              size={iconSize}
              color={isUsable
                ? (isUltimate ? '#fbbf24' : 'white')
                : 'rgba(255,255,255,0.4)'
              }
            />
          </div>

          {/* Cooldown timer */}
          {onCooldown && (
            <div className="absolute inset-0 flex items-center justify-center z-30">
              <span className="font-mono text-lg sm:text-xl lg:text-2xl font-bold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,1)]">
                {Math.ceil(cooldown)}
              </span>
            </div>
          )}

          {/* Ultimate charging percentage */}
          {isUltCharging && !onCooldown && (
            <div className="absolute inset-0 flex items-center justify-center z-30">
              <span className="font-mono text-sm sm:text-base lg:text-lg font-bold text-violet-300 drop-shadow-lg">
                {Math.floor(ultimateCharge)}%
              </span>
            </div>
          )}

          {/* Charges indicator */}
          {hasCharges && (
            <div className="absolute bottom-1 sm:bottom-1.5 left-1/2 -translate-x-1/2 flex gap-0.5 sm:gap-1 z-30">
              {[...Array(maxCharges)].map((_, i) => (
                <div
                  key={i}
                  className={`w-2 h-1 sm:w-2.5 sm:h-1 lg:w-3 lg:h-1.5 rounded-sm transition-all duration-150 ${i < charges
                      ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)]'
                      : 'bg-white/20'
                    }`}
                />
              ))}
            </div>
          )}

          {/* Active glow pulse */}
          {isActive && (
            <div
              className="absolute inset-0 z-10 animate-pulse"
              style={{
                background: `radial-gradient(circle at center, ${heroColor}70 0%, transparent 60%)`
              }}
            />
          )}
        </div>
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