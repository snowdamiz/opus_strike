import { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { HERO_DEFINITIONS, ABILITY_DEFINITIONS } from '@voxel-strike/shared';
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

export function HUD() {
  const { localPlayer, redScore, blueScore, roundTimeRemaining, redFlag, blueFlag, clientCooldowns } = useGameStore();
  
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

      {/* Crosshair */}
      <div className="crosshair">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="2" fill="white" fillOpacity="0.95" />
          <line x1="12" y1="4" x2="12" y2="8" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
          <line x1="12" y1="16" x2="12" y2="20" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
          <line x1="4" y1="12" x2="8" y2="12" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
          <line x1="16" y1="12" x2="20" y2="12" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
        </svg>
      </div>

      {/* ===== TOP CENTER - Score Panel ===== */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2">
        <div className="flex items-center">
          {/* Red Team */}
          <div className="relative">
            <div 
              className="w-16 h-12 flex items-center justify-center"
              style={{
                background: 'linear-gradient(180deg, rgba(239, 68, 68, 0.4) 0%, rgba(185, 28, 28, 0.5) 100%)',
                clipPath: 'polygon(0 0, 100% 0, 85% 100%, 0 100%)',
              }}
            >
              <span className="font-display text-4xl text-white tabular-nums drop-shadow-lg pr-2">
                {redScore}
              </span>
            </div>
            {redFlag?.carrierId && (
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
            )}
          </div>

          {/* Center Timer */}
          <div className="relative mx-1">
            <div 
              className="h-10 px-6 flex items-center justify-center"
              style={{
                background: 'linear-gradient(180deg, rgba(20, 20, 30, 0.95) 0%, rgba(10, 10, 15, 0.98) 100%)',
                borderTop: '2px solid rgba(255, 255, 255, 0.1)',
                borderBottom: '2px solid rgba(255, 255, 255, 0.05)',
              }}
            >
              <span className={`font-mono text-xl tracking-widest tabular-nums font-medium ${
                roundTimeRemaining < 30 ? 'text-red-400' : 
                roundTimeRemaining < 60 ? 'text-amber-300' : 'text-white'
              }`}>
                {formatTime(roundTimeRemaining)}
              </span>
            </div>
            <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-6 bg-gradient-to-b from-transparent via-white/20 to-transparent" />
            <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-1 h-6 bg-gradient-to-b from-transparent via-white/20 to-transparent" />
          </div>

          {/* Blue Team */}
          <div className="relative">
            <div 
              className="w-16 h-12 flex items-center justify-center"
              style={{
                background: 'linear-gradient(180deg, rgba(59, 130, 246, 0.4) 0%, rgba(29, 78, 216, 0.5) 100%)',
                clipPath: 'polygon(15% 0, 100% 0, 100% 100%, 0 100%)',
              }}
            >
              <span className="font-display text-4xl text-white tabular-nums drop-shadow-lg pl-2">
                {blueScore}
              </span>
            </div>
            {blueFlag?.carrierId && (
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
            )}
          </div>
        </div>
      </div>

      {/* ===== BOTTOM LEFT - Hero Portrait & Health ===== */}
      <div className="absolute bottom-6 left-6">
        <div className="flex items-end gap-3">
          {/* Hero Portrait Frame */}
          <div className="relative">
            <div 
              className="relative w-14 h-14 rounded-lg overflow-hidden flex items-center justify-center"
              style={{ 
                border: `2px solid ${heroColors.primary}`,
                background: `linear-gradient(135deg, ${heroColors.bg}, rgba(0,0,0,0.7))`,
                boxShadow: `0 0 20px ${heroColors.glow}`,
              }}
            >
              {localPlayer.heroId && (
                <HeroIcon 
                  heroId={localPlayer.heroId as HeroId} 
                  size={32} 
                  color={heroColors.primary}
                />
              )}
              <div 
                className={`absolute bottom-0 left-0 right-0 h-1 ${
                  localPlayer.team === 'red' ? 'bg-red-500' : 'bg-blue-500'
                }`}
              />
            </div>
            {localPlayer.hasFlag && (
              <div className="absolute -top-2 -right-2 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center border-2 border-amber-300 animate-bounce">
                <span className="text-[10px]">🏴</span>
              </div>
            )}
          </div>

          {/* Health Bar Stack */}
          <div className="flex flex-col gap-1">
            {/* Health Bar */}
            <div className="relative w-44">
              <div className="h-7 bg-black/80 rounded overflow-hidden border border-white/10">
                <div 
                  className={`h-full transition-all duration-150 relative ${
                    isCriticalHealth ? 'health-bar-critical' : 
                    isLowHealth ? 'health-bar-low' : 'health-bar'
                  }`}
                  style={{ width: `${healthPercent}%` }}
                >
                  <div className="absolute inset-0 bg-gradient-to-b from-white/25 to-transparent h-1/2" />
                </div>
                <div className="absolute inset-0 flex items-center px-3">
                  <span className="font-mono text-base text-white font-bold drop-shadow-lg">
                    {Math.ceil(localPlayer.health)}
                  </span>
                </div>
              </div>
              <div className="absolute inset-0 flex pointer-events-none rounded overflow-hidden">
                {[...Array(10)].map((_, i) => (
                  <div key={i} className="flex-1 border-r border-black/40 last:border-r-0" />
                ))}
              </div>
            </div>

            {/* Ultimate Charge Bar */}
            <div className="relative w-44">
              <div className={`h-2.5 rounded overflow-hidden ${
                isUltReady ? 'bg-amber-900/50' : 'bg-black/60'
              }`}>
                <div 
                  className={`h-full transition-all duration-200 ${
                    isUltReady 
                      ? 'bg-gradient-to-r from-amber-500 to-yellow-400' 
                      : 'bg-gradient-to-r from-violet-700 to-violet-500'
                  }`}
                  style={{ width: `${Math.min(100, ultimatePercent)}%` }}
                >
                  {isUltReady && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                  )}
                </div>
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-[9px] font-mono tracking-wide ${
                  isUltReady ? 'text-amber-200 font-bold' : 'text-white/50'
                }`}>
                  {isUltReady ? 'READY' : `${Math.floor(ultimatePercent)}%`}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== BOTTOM CENTER - Ability Bar (Apex Style) ===== */}
      {heroInfo && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
          <div className="flex items-end gap-3">
            {/* Ability 1 (E) */}
            <AbilitySlotApex
              abilityId={heroInfo.ability1.abilityId}
              keybind="E"
              abilityState={localPlayer.abilities?.[heroInfo.ability1.abilityId]}
              clientCooldownEnd={clientCooldowns[heroInfo.ability1.abilityId]}
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
            
            {/* Ultimate (F) */}
            <AbilitySlotApex
              abilityId={heroInfo.ultimate.abilityId}
              keybind="F"
              abilityState={localPlayer.abilities?.[heroInfo.ultimate.abilityId]}
              clientCooldownEnd={clientCooldowns[heroInfo.ultimate.abilityId]}
              isUltimate={true}
              heroColor={heroColors.primary}
              ultimateCharge={ultimatePercent}
            />
          </div>
        </div>
      )}

      {/* ===== BOTTOM RIGHT - Movement Status ===== */}
      <div className="absolute bottom-6 right-6 flex flex-col items-end gap-1.5">
        {localPlayer.movement?.isWallRunning && <MovementIndicator label="WALL RUN" color="#06b6d4" />}
        {localPlayer.movement?.isSliding && <MovementIndicator label="SLIDING" color="#22c55e" />}
        {localPlayer.movement?.isGrappling && <MovementIndicator label="GRAPPLE" color="#06b6d4" />}
        {localPlayer.movement?.isJetpacking && <MovementIndicator label="JETPACK" color="#f97316" />}
        {localPlayer.movement?.isGliding && <MovementIndicator label="GLIDING" color="#a855f7" />}
        
        {localPlayer.heroId === 'blaze' && localPlayer.movement?.jetpackFuel !== undefined && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[9px] font-display text-orange-400/70 tracking-wider">FUEL</span>
            <div className="w-16 h-1.5 bg-black/60 rounded-full overflow-hidden border border-orange-500/30">
              <div 
                className="h-full bg-gradient-to-r from-orange-600 to-orange-400 transition-all duration-100"
                style={{ width: `${localPlayer.movement.jetpackFuel}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ===== FLAG CARRIER ALERT ===== */}
      {localPlayer.hasFlag && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 animate-bounce-slow">
          <div className="relative px-5 py-2.5 rounded-lg overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-amber-600/30 via-amber-500/40 to-amber-600/30 backdrop-blur-md" />
            <div className="absolute inset-0 border border-amber-400/50 rounded-lg" />
            <div className="relative flex items-center gap-3">
              <span className="text-xl">🏴</span>
              <span className="font-display text-amber-200 tracking-widest text-sm">
                RETURN TO BASE
              </span>
              <span className="font-display text-amber-400 text-lg">→</span>
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
  isUltimate,
  heroColor,
  ultimateCharge,
}: {
  abilityId: string;
  keybind: string;
  abilityState?: AbilityState;
  clientCooldownEnd?: number;
  isUltimate: boolean;
  heroColor: string;
  ultimateCharge: number;
}) {
  const abilityDef = ABILITY_DEFINITIONS[abilityId];
  if (!abilityDef) return null;

  const iconType = getAbilityIconType(abilityId);
  
  // Calculate client-side cooldown remaining (for immediate UI feedback)
  const now = Date.now();
  const clientCooldownRemaining = clientCooldownEnd && clientCooldownEnd > now 
    ? Math.ceil((clientCooldownEnd - now) / 1000) 
    : 0;
  
  // Use client cooldown if available (more responsive), fall back to server state
  const serverCooldown = abilityState?.cooldownRemaining ?? 0;
  const cooldown = clientCooldownRemaining > 0 ? clientCooldownRemaining : serverCooldown;
  const charges = abilityState?.charges ?? (abilityDef.charges || 1);
  const isActive = abilityState?.isActive ?? false;
  const maxCharges = abilityDef.charges || 1;
  const maxCooldown = abilityDef.cooldown || 10;
  
  const onCooldown = cooldown > 0;
  const isUltReady = isUltimate && ultimateCharge >= 100;
  const isUltCharging = isUltimate && ultimateCharge < 100;
  const hasCharges = maxCharges > 1;
  const noChargesLeft = hasCharges && charges === 0;
  
  // Determine if ability is usable
  const isUsable = !onCooldown && !noChargesLeft && (!isUltimate || isUltReady);
  
  // Size based on ultimate vs regular ability
  const size = isUltimate ? 'w-16 h-16' : 'w-14 h-14';
  const iconSize = isUltimate ? 28 : 24;

  return (
    <div className="flex flex-col items-center gap-1">
      {/* Ability name label */}
      <span className={`text-[9px] font-body tracking-wide uppercase ${
        isUsable ? 'text-white/70' : 'text-white/40'
      }`}>
        {abilityDef.name}
      </span>

      {/* Main ability container */}
      <div className="relative">
        {/* Outer glow for ready ultimate */}
        {isUltReady && (
          <div 
            className="absolute -inset-1 rounded-xl animate-pulse-soft"
            style={{ 
              background: `radial-gradient(circle, rgba(251, 191, 36, 0.5) 0%, transparent 70%)`,
            }}
          />
        )}

        {/* Ability box */}
        <div 
          className={`
            relative ${size} rounded-lg overflow-hidden transition-all duration-150
            ${isActive ? 'ring-2 ring-white' : ''}
          `}
          style={{
            background: isUsable
              ? isUltimate 
                ? 'linear-gradient(180deg, rgba(251, 191, 36, 0.3) 0%, rgba(180, 83, 9, 0.4) 100%)'
                : `linear-gradient(180deg, ${heroColor}35 0%, ${heroColor}20 100%)`
              : 'linear-gradient(180deg, rgba(40, 40, 50, 0.95) 0%, rgba(25, 25, 35, 0.98) 100%)',
            border: isUsable 
              ? `2px solid ${isUltimate ? 'rgba(251, 191, 36, 0.7)' : heroColor}`
              : '2px solid rgba(70, 70, 80, 0.6)',
          }}
        >
          {/* Cooldown overlay - darkens the ability */}
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
                stroke="rgba(0,0,0,0.6)"
                strokeWidth="90"
                strokeDasharray={`${(cooldown / maxCooldown) * 283} 283`}
                className="transition-all duration-100"
              />
            </svg>
          )}

          {/* Keybind badge */}
          <div 
            className={`absolute top-1 left-1 z-30 min-w-[20px] h-[20px] rounded flex items-center justify-center text-[11px] font-mono font-bold ${
              isUsable 
                ? isUltimate 
                  ? 'bg-amber-500/50 text-amber-100' 
                  : 'bg-white/25 text-white'
                : 'bg-black/50 text-white/50'
            }`}
          >
            {keybind}
          </div>

          {/* Ability Icon */}
          <div className={`absolute inset-0 flex items-center justify-center z-20 ${
            !isUsable ? 'opacity-40' : ''
          }`}>
            <AbilityIcon 
              type={iconType} 
              size={iconSize} 
              color={isUsable 
                ? (isUltimate ? '#fbbf24' : 'white') 
                : 'rgba(255,255,255,0.5)'
              }
            />
          </div>

          {/* Cooldown timer text (centered, like Apex) */}
          {onCooldown && (
            <div className="absolute inset-0 flex items-center justify-center z-30">
              <span className="font-mono text-2xl font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
                {Math.ceil(cooldown)}
              </span>
            </div>
          )}

          {/* Ultimate charging percentage */}
          {isUltCharging && !onCooldown && (
            <div className="absolute inset-0 flex items-center justify-center z-30">
              <span className="font-mono text-lg font-bold text-violet-300 drop-shadow-lg">
                {Math.floor(ultimateCharge)}%
              </span>
            </div>
          )}

          {/* Charges indicator */}
          {hasCharges && (
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-1 z-30">
              {[...Array(maxCharges)].map((_, i) => (
                <div 
                  key={i} 
                  className={`w-3 h-1.5 rounded-sm transition-all duration-150 ${
                    i < charges 
                      ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)]' 
                      : 'bg-white/25'
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
                background: `radial-gradient(circle at center, ${heroColor}60 0%, transparent 60%)` 
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ===== MOVEMENT INDICATOR =====
function MovementIndicator({ label, color }: { label: string; color: string }) {
  return (
    <div 
      className="flex items-center gap-2 px-3 py-1.5 rounded backdrop-blur-sm animate-fade-in"
      style={{ 
        background: `${color}20`,
        border: `1px solid ${color}50`,
      }}
    >
      <div 
        className="w-1.5 h-1.5 rounded-full animate-pulse"
        style={{ background: color }}
      />
      <span 
        className="text-[10px] font-display tracking-widest"
        style={{ color }}
      >
        {label}
      </span>
    </div>
  );
}
