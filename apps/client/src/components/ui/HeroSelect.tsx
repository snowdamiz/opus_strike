import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { HERO_DEFINITIONS, ALL_HERO_IDS, ABILITY_DEFINITIONS } from '@voxel-strike/shared';
import type { HeroId } from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';
import { useUISounds } from '../../hooks/useAudio';
import { HeroSVG } from './HeroSVG';
import { HeroIcon, AbilityIcon, getAbilityIconType } from './HeroIcons';

// Hero colors
const HERO_COLORS: Record<HeroId, string> = {
  phantom: '#a855f7',
  hookshot: '#06b6d4',
  blaze: '#f97316',
  glacier: '#3b82f6',
  pulse: '#22c55e',
  sentinel: '#eab308',
};

export function HeroSelect() {
  const localHeroId = useGameStore((state) => state.localPlayer?.heroId);
  const phaseEndTime = useGameStore((state) => state.phaseEndTime);
  const { selectHero, setReady, leaveGame } = useNetwork();
  const { playButtonClick } = useUISounds();
  const [selectedHero, setSelectedHero] = useState<HeroId>('phantom');
  const [isLockedIn, setIsLockedIn] = useState(false);
  const didPreselectRef = useRef(false);

  // Preselect Phantom on mount
  useEffect(() => {
    if (localHeroId) {
      didPreselectRef.current = true;
      setSelectedHero(localHeroId);
      return;
    }

    if (!didPreselectRef.current) {
      didPreselectRef.current = true;
      selectHero('phantom');
    }
  }, [localHeroId, selectHero]);

  const displayHero = selectedHero;
  const heroInfo = displayHero ? HERO_DEFINITIONS[displayHero] : null;
  const accentColor = displayHero ? HERO_COLORS[displayHero] : '#f97316';

  const handleSelectHero = useCallback((heroId: HeroId) => {
    if (isLockedIn || heroId === selectedHero) return;
    setSelectedHero(heroId);
    selectHero(heroId);
  }, [isLockedIn, selectedHero, selectHero]);

  const handleLockIn = useCallback(() => {
    if (!selectedHero || isLockedIn) return;
    setIsLockedIn(true);
    setReady(true);
  }, [isLockedIn, selectedHero, setReady]);

  const handleTimerExpired = useCallback(() => {
    if (isLockedIn || !selectedHero) return;
    setIsLockedIn(true);
    setReady(true);
  }, [isLockedIn, selectedHero, setReady]);

  const handleHeroCardClick = useCallback((heroId: HeroId) => {
    handleSelectHero(heroId);
    playButtonClick();
  }, [handleSelectHero, playButtonClick]);

  return (
    <div className="absolute inset-0 bg-[#06060a] flex flex-col overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            background: displayHero
              ? `radial-gradient(ellipse at 70% 50%, ${accentColor}15, transparent 50%)`
              : 'none',
          }}
        />
        <div className="absolute inset-0 pattern-grid opacity-10" />
      </div>

      {/* Top Bar */}
      <div className="relative z-10 flex items-center justify-between px-3 md:px-4 xl:px-6 2xl:px-8 py-2 md:py-3 xl:py-4 2xl:py-5 border-b border-white/5 bg-[#08080c]/80">
        <div className="flex items-center gap-4 xl:gap-6">
 <button
 onClick={() => { playButtonClick(); leaveGame(); }}
 className="flex items-center gap-2 px-3 xl:px-4 py-2 xl:py-2.5 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 hover:text-white hover:border-white/20"
 >
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
 </svg>
 <span className="font-display text-xs xl:text-sm">LEAVE</span>
 </button>

          <div className="w-px h-6 xl:h-8 bg-white/10" />

          <div>
            <h1 className="font-display text-lg md:text-xl xl:text-2xl 2xl:text-3xl text-white tracking-wide">
              CHOOSE YOUR <span style={{ color: accentColor }}>HERO</span>
            </h1>
            <p className="text-white/30 text-[9px] md:text-[10px] xl:text-xs font-body mt-0.5">Select a hero and lock in to begin</p>
          </div>
        </div>

        {/* Timer and Lock In */}
        <div className="flex items-center gap-3 xl:gap-4">
          <HeroSelectTimer
            phaseEndTime={phaseEndTime}
            isLockedIn={isLockedIn}
            onExpired={handleTimerExpired}
          />

          {/* Lock In Button */}
 <button
 onClick={() => { playButtonClick(); handleLockIn(); }}
 disabled={!selectedHero || isLockedIn}
 className={`relative px-4 md:px-5 xl:px-6 py-2 md:py-2.5 xl:py-3 rounded-lg md:rounded-xl font-display text-xs md:text-sm xl:text-base overflow-hidden ${isLockedIn
 ? 'bg-green-500/20 border-2 border-green-500/50 text-green-400'
 : selectedHero
 ? 'text-white border border-white/10 hover:border-white/30'
 : 'bg-white/5 border border-white/10 text-white/30 cursor-not-allowed'
 }`}
 style={!isLockedIn && selectedHero ? {
 background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`,
 boxShadow: `0 10px 40px ${accentColor}40`,
 } : {}}
 >
 <span className="relative flex items-center gap-2">
 {isLockedIn ? (
 <>
 <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
 </svg>
 LOCKED IN
 </>
 ) : (
 'LOCK IN'
 )}
 </span>
 </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="relative z-10 flex-1 flex overflow-hidden min-h-0">
        {/* Hero Grid - Left Side */}
        <div className="w-[52%] lg:w-[55%] xl:w-[58%] p-1.5 md:p-2 lg:p-3 xl:p-4 2xl:p-6 overflow-y-auto flex items-center justify-center">
          <div className="grid grid-cols-3 gap-2 lg:gap-3 xl:gap-4 2xl:gap-5 w-full max-w-[420px] lg:max-w-[480px] xl:max-w-[600px] 2xl:max-w-[720px]">
            {ALL_HERO_IDS.map((heroId) => {
              const hero = HERO_DEFINITIONS[heroId];
              const color = HERO_COLORS[heroId];
              const isSelected = selectedHero === heroId;

              return (
                <HeroCard
                  key={heroId}
                  heroId={heroId}
                  hero={hero}
                  color={color}
                  isSelected={isSelected}
                  isLockedIn={isLockedIn}
                  onSelect={handleHeroCardClick}
                />
              );
            })}
          </div>
        </div>

        {/* Hero Details - Right Side */}
        <div className="w-[48%] lg:w-[45%] xl:w-[42%] border-l border-white/5 flex flex-col bg-[#08080c]/50 min-h-0">
          {heroInfo ? (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Hero Header with large display */}
              <div
                className="relative p-2.5 md:p-3 lg:p-4 xl:p-6 2xl:p-8 border-b border-white/5 overflow-hidden flex-shrink-0"
                style={{ background: `linear-gradient(135deg, ${accentColor}12, transparent 60%)` }}
              >
                {/* Background hero silhouette */}
                <div className="absolute -right-10 -top-10 opacity-10 hidden xl:block">
                  <HeroSVG heroId={displayHero!} size={200} animated={false} />
                </div>

                <div className="relative z-10">
                  <div className="flex items-center gap-2 md:gap-3 xl:gap-4 2xl:gap-5">
                    <div
                      className="w-10 md:w-12 xl:w-14 2xl:w-16 h-10 md:h-12 xl:h-14 2xl:h-16 rounded-lg md:rounded-xl flex items-center justify-center"
                      style={{
                        background: `linear-gradient(135deg, ${accentColor}, ${accentColor}bb)`,
                        boxShadow: `0 8px 25px ${accentColor}40`,
                      }}
                    >
                      <HeroIcon heroId={displayHero!} size={24} color="#ffffff" />
                    </div>
                    <div className="flex-1">
                      <h2
                        className="font-display text-xl md:text-2xl xl:text-3xl 2xl:text-4xl text-white tracking-wide"
                        style={{ textShadow: `0 0 30px ${accentColor}50` }}
                      >
                        {heroInfo.name.toUpperCase()}
                      </h2>
                      <div className="flex items-center gap-1.5 md:gap-2 xl:gap-3 mt-0.5 md:mt-1 xl:mt-2">
                        <span
                          className="px-1.5 md:px-2 xl:px-3 py-0.5 xl:py-1 rounded-lg text-[9px] md:text-[10px] xl:text-xs font-display uppercase"
                          style={{
                            background: `${accentColor}25`,
                            color: accentColor,
                            border: `1px solid ${accentColor}30`,
                          }}
                        >
                          {heroInfo.role}
                        </span>
                        <span className="text-white/30 text-xs">•</span>
                        <span className="text-white/50 font-body text-[10px] md:text-xs xl:text-sm capitalize">{heroInfo.movementFocus}</span>
                      </div>
                    </div>
                  </div>
                  <p className="mt-1.5 md:mt-2 xl:mt-3 2xl:mt-5 text-white/60 font-body text-[10px] md:text-xs xl:text-sm leading-relaxed max-w-md">
                    {heroInfo.description}
                  </p>
                </div>
              </div>

              {/* Stats */}
              <div className="p-2 md:p-2.5 lg:p-3 xl:p-4 2xl:p-6 border-b border-white/5 flex-shrink-0">
                <h3 className="text-[9px] md:text-[10px] text-white/40 font-display uppercase tracking-widest mb-1.5 md:mb-2 xl:mb-3 2xl:mb-4">Combat Stats</h3>
                <div className="grid grid-cols-3 gap-1.5 md:gap-2 xl:gap-3 2xl:gap-5">
                  <StatCard label="Health" value={heroInfo.stats.maxHealth} icon="❤️" color={accentColor} />
                  <StatCard label="Speed" value={heroInfo.stats.moveSpeed} icon="⚡" color={accentColor} />
                  <StatCard label="Jump" value={heroInfo.stats.jumpForce} icon="🦘" color={accentColor} />
                </div>
              </div>

              {/* Abilities */}
              <div className="flex-1 p-2 md:p-2.5 lg:p-3 xl:p-4 2xl:p-6 overflow-y-auto min-h-0">
                <h3 className="text-[9px] md:text-[10px] text-white/40 font-display uppercase tracking-widest mb-1.5 md:mb-2 xl:mb-3 2xl:mb-4 flex-shrink-0">Abilities</h3>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5 md:gap-2 pb-2">
                  {/* Passive */}
                  <AbilityCard
                    name={heroInfo.passive.name}
                    description={heroInfo.passive.description}
                    color={accentColor}
                    isPassive
                  />

                  <AbilityCard
                    ability={ABILITY_DEFINITIONS[heroInfo.ability1.abilityId]}
                    abilityId={heroInfo.ability1.abilityId}
                    color={accentColor}
                    keybind="E"
                  />
                  <AbilityCard
                    ability={ABILITY_DEFINITIONS[heroInfo.ability2.abilityId]}
                    abilityId={heroInfo.ability2.abilityId}
                    color={accentColor}
                    keybind="Q"
                  />
                  <AbilityCard
                    ability={ABILITY_DEFINITIONS[heroInfo.ultimate.abilityId]}
                    abilityId={heroInfo.ultimate.abilityId}
                    color={accentColor}
                    keybind="F"
                    isUltimate
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                  <svg className="w-10 h-10 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
                  </svg>
                </div>
                <p className="font-display text-white/40 text-2xl">SELECT A HERO</p>
                <p className="text-white/20 text-sm font-body mt-2">Click on a hero to view details</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type HeroDefinition = (typeof HERO_DEFINITIONS)[HeroId];

const getRemainingSeconds = (phaseEndTime: number | null) => {
  if (!phaseEndTime) return 60;
  return Math.max(0, Math.ceil((phaseEndTime - Date.now()) / 1000));
};

const HeroSelectTimer = memo(function HeroSelectTimer({
  phaseEndTime,
  isLockedIn,
  onExpired,
}: {
  phaseEndTime: number | null;
  isLockedIn: boolean;
  onExpired: () => void;
}) {
  const [timeRemaining, setTimeRemaining] = useState(() => getRemainingSeconds(phaseEndTime));
  const didExpireRef = useRef(false);

  useEffect(() => {
    didExpireRef.current = false;
  }, [phaseEndTime]);

  useEffect(() => {
    const updateTimer = () => {
      const remaining = getRemainingSeconds(phaseEndTime);
      setTimeRemaining((current) => (current === remaining ? current : remaining));

      if (remaining <= 0 && !isLockedIn && !didExpireRef.current) {
        didExpireRef.current = true;
        onExpired();
      }
    };

    updateTimer();
    const interval = window.setInterval(updateTimer, 250);
    return () => window.clearInterval(interval);
  }, [phaseEndTime, isLockedIn, onExpired]);

  return (
    <div
      className={`flex items-center gap-2 xl:gap-3 px-3 xl:px-4 py-2 xl:py-2.5 rounded-lg xl:rounded-xl border ${timeRemaining < 10
        ? 'bg-red-500/20 border-red-500/30'
        : 'bg-white/5 border-white/10'
        }`}
    >
      <span className="text-[9px] xl:text-[10px] text-white/40 font-body uppercase tracking-wider">Time</span>
      <span className={`font-mono text-lg xl:text-xl font-bold tracking-tight ${timeRemaining < 10 ? 'text-red-400' : 'text-white'}`}>
        {timeRemaining.toString().padStart(2, '0')}
      </span>
      {timeRemaining < 10 && (
        <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
      )}
    </div>
  );
});

const HeroCard = memo(function HeroCard({
  heroId,
  hero,
  color,
  isSelected,
  isLockedIn,
  onSelect,
}: {
  heroId: HeroId;
  hero: HeroDefinition;
  color: string;
  isSelected: boolean;
  isLockedIn: boolean;
  onSelect: (heroId: HeroId) => void;
}) {
  return (
 <button
 onClick={() => onSelect(heroId)}
 disabled={isLockedIn}
 className={`
 group relative w-full aspect-[3/4] rounded-2xl overflow-hidden
 ${isLockedIn && !isSelected ? 'opacity-30' : ''}
 `}
 style={{
 background: isSelected
 ? `linear-gradient(160deg, ${color}25, ${color}08 50%, #0a0a10)`
 : 'linear-gradient(160deg, #14141c, #0a0a10)',
 boxShadow: isSelected
 ? `0 0 36px ${color}28, 0 16px 32px rgba(0,0,0,0.46), inset 0 1px 0 ${color}30`
 : '0 10px 24px rgba(0,0,0,0.28)',
 }}
 >
 <div
 className="absolute inset-0 rounded-2xl"
 style={{
 border: isSelected ? `2px solid ${color}` : '1px solid rgba(255,255,255,0.06)',
 boxShadow: isSelected ? `inset 0 0 24px ${color}18` : 'none',
 }}
 />
 {!isSelected && (
 <div
 className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100"
 style={{ border: `1px solid ${color}50` }}
 />
 )}
 <div
 className={`absolute inset-0 ${isSelected ? 'opacity-60' : 'opacity-0 group-hover:opacity-30'}`}
 style={{ background: `radial-gradient(ellipse at center 30%, ${color}30, transparent 60%)` }}
 />

 <div
 className="absolute inset-0 flex items-center justify-center"
 style={{ filter: isSelected ? `drop-shadow(0 0 24px ${color}55)` : undefined }}
 >
 <HeroSVG heroId={heroId} size={220} animated={isSelected} />
 </div>

 <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#08080c] via-[#08080c]/80 to-transparent" />

 <div className="absolute inset-0 flex flex-col justify-between p-4">
 <div className="flex items-start justify-between">
 <div
 className="px-3 py-1.5 rounded-lg text-[10px] font-display uppercase tracking-wider"
 style={{
 background: `${color}25`,
 color,
 border: `1px solid ${color}30`,
 }}
 >
 {hero.role}
 </div>

 {isSelected && (
 <div
 className="w-8 h-8 rounded-lg flex items-center justify-center"
 style={{
 background: `linear-gradient(135deg, ${color}, ${color}cc)`,
 boxShadow: `0 4px 15px ${color}50`,
 }}
 >
 <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
 </svg>
 </div>
 )}
 </div>

 <div>
 <h3
 className="font-display text-2xl"
 style={{
 color: isSelected ? 'white' : color,
 textShadow: isSelected ? `0 0 20px ${color}80` : 'none',
 }}
 >
 {hero.name.toUpperCase()}
 </h3>
 <p className="text-white/40 text-xs font-body mt-1 capitalize">
 {hero.movementFocus} specialist
 </p>
 </div>
 </div>
 </button>
  );
});

// Stat Card Component
const StatCard = memo(function StatCard({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  return (
    <div
      className="p-1.5 md:p-2 xl:p-3 2xl:p-4 rounded-lg md:rounded-xl border border-white/5 bg-white/[0.02]"
      style={{ background: `linear-gradient(135deg, ${color}08, transparent)` }}
    >
      <div className="flex items-center gap-1 md:gap-1.5 xl:gap-2 mb-0.5 md:mb-1 xl:mb-2">
        <span className="text-xs md:text-sm xl:text-base 2xl:text-lg">{icon}</span>
        <span className="text-[8px] md:text-[9px] xl:text-[10px] text-white/40 font-body uppercase">{label}</span>
      </div>
      <span
        className="font-display text-base md:text-xl xl:text-2xl 2xl:text-3xl text-white"
        style={{ textShadow: `0 0 20px ${color}40` }}
      >
        {value}
      </span>
    </div>
  );
});

// Ability Card Component
const AbilityCard = memo(function AbilityCard({
  ability,
  abilityId,
  name,
  description,
  color,
  keybind,
  isPassive,
  isUltimate
}: {
  ability?: { name: string; description: string; cooldown: number };
  abilityId?: string;
  name?: string;
  description?: string;
  color: string;
  keybind?: string;
  isPassive?: boolean;
  isUltimate?: boolean;
}) {
  const abilityName = ability?.name ?? name ?? '';
  const abilityDesc = ability?.description ?? description ?? '';
  const iconType = isPassive ? 'passive' : (abilityId ? getAbilityIconType(abilityId) : 'passive');

  return (
    <div
      className={`p-2 md:p-2.5 xl:p-3 2xl:p-4 rounded-lg md:rounded-xl border ${isUltimate
        ? 'border-amber-500/30 bg-gradient-to-r from-amber-500/15 to-amber-500/5'
        : isPassive
          ? 'border-white/10 bg-white/[0.03]'
          : 'border-white/5 bg-white/[0.02]'
        }`}
      style={!isUltimate && !isPassive ? {
        background: `linear-gradient(135deg, ${color}08, transparent)`,
        borderColor: `${color}20`,
      } : {}}
    >
      <div className="flex items-start gap-2 md:gap-2.5 xl:gap-3 2xl:gap-4">
        <div
          className="w-8 md:w-9 xl:w-10 2xl:w-12 h-8 md:h-9 xl:h-10 2xl:h-12 rounded-lg xl:rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: isUltimate
              ? 'linear-gradient(135deg, #f59e0b, #d97706)'
              : isPassive
                ? 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))'
                : `linear-gradient(135deg, ${color}, ${color}bb)`,
            boxShadow: isUltimate
              ? '0 4px 20px rgba(245, 158, 11, 0.4)'
              : isPassive
                ? 'none'
                : `0 4px 20px ${color}30`,
          }}
        >
          <AbilityIcon type={iconType} size={16} color="#ffffff" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 md:gap-1.5 xl:gap-2 mb-0.5 xl:mb-1">
            <span className="font-display text-white text-xs md:text-sm xl:text-base">{abilityName}</span>
            {keybind && !isPassive && (
              <span
                className="text-[8px] md:text-[9px] xl:text-[10px] px-1 md:px-1.5 xl:px-2 py-0.5 rounded font-mono font-bold"
                style={{
                  background: isUltimate ? 'rgba(245, 158, 11, 0.3)' : `${color}30`,
                  color: isUltimate ? '#fbbf24' : color,
                }}
              >
                {keybind}
              </span>
            )}
            {isPassive && (
              <span className="text-[8px] md:text-[9px] xl:text-[10px] px-1 md:px-1.5 xl:px-2 py-0.5 rounded bg-white/10 text-white/50 font-body">
                PASSIVE
              </span>
            )}
            {isUltimate && (
              <span className="text-amber-400 text-[9px] md:text-[10px] xl:text-xs">★ ULT</span>
            )}
          </div>
          <p className="text-white/50 text-[9px] md:text-[10px] xl:text-xs font-body leading-relaxed line-clamp-2">{abilityDesc}</p>
          {ability && ability.cooldown > 0 && (
            <div className="mt-0.5 md:mt-1 xl:mt-2">
              <span
                className="text-[8px] md:text-[9px] xl:text-[10px] font-mono px-1 md:px-1.5 xl:px-2 py-0.5 xl:py-1 rounded"
                style={{
                  background: isUltimate ? 'rgba(245, 158, 11, 0.2)' : `${color}15`,
                  color: isUltimate ? '#fbbf24' : `${color}cc`,
                }}
              >
                ⏱ {ability.cooldown}s
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
