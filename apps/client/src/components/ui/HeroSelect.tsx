import { useState, useEffect } from 'react';
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
  const { localPlayer, phaseEndTime } = useGameStore();
  const { selectHero, setReady, leaveGame } = useNetwork();
  const { playButtonHover, playButtonClick } = useUISounds();
  const [selectedHero, setSelectedHero] = useState<HeroId>('phantom');
  const [hoveredHero, setHoveredHero] = useState<HeroId | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(60);
  const [isLockedIn, setIsLockedIn] = useState(false);

  // Preselect Phantom on mount
  useEffect(() => {
    if (!localPlayer?.heroId) {
      selectHero('phantom');
    } else {
      setSelectedHero(localPlayer.heroId);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (phaseEndTime) {
        const remaining = Math.ceil((phaseEndTime - Date.now()) / 1000);
        setTimeRemaining(Math.max(0, remaining));
        
        // Auto lock-in when timer reaches 0
        if (remaining <= 0 && !isLockedIn && selectedHero) {
          setIsLockedIn(true);
          setReady(true);
        }
      }
    }, 100);
    return () => clearInterval(interval);
  }, [phaseEndTime, isLockedIn, selectedHero, setReady]);

  const displayHero = hoveredHero ?? selectedHero;
  const heroInfo = displayHero ? HERO_DEFINITIONS[displayHero] : null;
  const accentColor = displayHero ? HERO_COLORS[displayHero] : '#f97316';

  const handleSelectHero = (heroId: HeroId) => {
    if (isLockedIn) return;
    setSelectedHero(heroId);
    selectHero(heroId);
  };

  const handleLockIn = () => {
    if (!selectedHero || isLockedIn) return;
    setIsLockedIn(true);
    setReady(true);
  };

  return (
    <div className="absolute inset-0 bg-[#06060a] flex flex-col overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 pointer-events-none">
        <div 
          className="absolute inset-0 transition-all duration-700"
          style={{
            background: displayHero 
              ? `radial-gradient(ellipse at 70% 50%, ${accentColor}15, transparent 50%)`
              : 'none',
          }}
        />
        <div className="absolute inset-0 pattern-grid opacity-10" />
      </div>

      {/* Top Bar */}
      <div className="relative z-10 flex items-center justify-between px-8 py-5 border-b border-white/5 bg-[#08080c]/80 backdrop-blur-sm">
        <div className="flex items-center gap-6">
          <button
            onClick={() => { playButtonClick(); leaveGame(); }}
            onMouseEnter={playButtonHover}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 hover:text-white hover:border-white/20 transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span className="font-display text-sm">LEAVE</span>
          </button>
          
          <div className="w-px h-8 bg-white/10" />
          
          <div>
            <h1 className="font-display text-3xl text-white tracking-wide">
              CHOOSE YOUR <span style={{ color: accentColor }} className="transition-colors duration-300">HERO</span>
            </h1>
            <p className="text-white/30 text-xs font-body mt-0.5">Select a hero and lock in to begin</p>
          </div>
        </div>
        
        {/* Timer */}
        <div 
          className={`flex items-center gap-4 px-5 py-3 rounded-xl border transition-all ${
            timeRemaining < 10 
              ? 'bg-red-500/20 border-red-500/30' 
              : 'bg-white/5 border-white/10'
          }`}
        >
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-white/40 font-body uppercase tracking-wider">Time Remaining</span>
            <span className={`font-mono text-3xl font-bold tracking-tight ${timeRemaining < 10 ? 'text-red-400' : 'text-white'}`}>
              {timeRemaining.toString().padStart(2, '0')}
            </span>
          </div>
          {timeRemaining < 10 && (
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="relative z-10 flex-1 flex overflow-hidden">
        {/* Hero Grid - Left Side */}
        <div className="w-[58%] p-6 overflow-y-auto flex items-center justify-center">
          <div className="grid grid-cols-3 gap-5" style={{ width: '720px' }}>
            {ALL_HERO_IDS.map((heroId) => {
              const hero = HERO_DEFINITIONS[heroId];
              const color = HERO_COLORS[heroId];
              const isSelected = selectedHero === heroId;
              const isHovered = hoveredHero === heroId;
              
              return (
                <button
                  key={heroId}
                  onClick={() => { playButtonClick(); handleSelectHero(heroId); }}
                  onMouseEnter={() => { playButtonHover(); setHoveredHero(heroId); }}
                  onMouseLeave={() => setHoveredHero(null)}
                  disabled={isLockedIn}
                  className={`
                    relative w-full aspect-[3/4] rounded-2xl overflow-hidden transition-all duration-200
                    ${isLockedIn && !isSelected ? 'opacity-30 scale-95' : ''}
                    ${isSelected ? 'scale-[1.02]' : 'hover:scale-[1.01]'}
                    group
                  `}
                  style={{
                    background: isSelected 
                      ? `linear-gradient(160deg, ${color}25, ${color}08 50%, #0a0a10)` 
                      : 'linear-gradient(160deg, #14141c, #0a0a10)',
                    boxShadow: isSelected 
                      ? `0 0 50px ${color}30, 0 20px 40px rgba(0,0,0,0.5), inset 0 1px 0 ${color}30` 
                      : '0 10px 30px rgba(0,0,0,0.3)',
                  }}
                >
                  {/* Border glow */}
                  <div 
                    className="absolute inset-0 rounded-2xl transition-all duration-200"
                    style={{ 
                      border: isSelected 
                        ? `2px solid ${color}` 
                        : isHovered 
                          ? `1px solid ${color}50` 
                          : '1px solid rgba(255,255,255,0.06)',
                      boxShadow: isSelected ? `inset 0 0 30px ${color}20` : 'none',
                    }}
                  />

                  {/* Background glow for selected/hovered */}
                  <div 
                    className="absolute inset-0 transition-opacity duration-300"
                    style={{ 
                      background: `radial-gradient(ellipse at center 30%, ${color}30, transparent 60%)`,
                      opacity: isSelected ? 0.6 : isHovered ? 0.3 : 0,
                    }}
                  />

                  {/* Hero SVG - Large and centered */}
                  <div 
                    className="absolute inset-0 flex items-center justify-center transition-all duration-300"
                    style={{ 
                      filter: isSelected ? `drop-shadow(0 0 30px ${color}60)` : isHovered ? `drop-shadow(0 0 15px ${color}40)` : 'none',
                      transform: isSelected ? 'scale(1.05)' : isHovered ? 'scale(1.02)' : 'scale(1)',
                    }}
                  >
                    <HeroSVG heroId={heroId} size={220} />
                  </div>

                  {/* Bottom gradient overlay */}
                  <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#08080c] via-[#08080c]/80 to-transparent" />

                  {/* Content overlay */}
                  <div className="absolute inset-0 flex flex-col justify-between p-4">
                    {/* Top row */}
                    <div className="flex items-start justify-between">
                      {/* Role Badge */}
                      <div 
                        className="px-3 py-1.5 rounded-lg text-[10px] font-display uppercase tracking-wider backdrop-blur-sm"
                        style={{ 
                          background: `${color}25`,
                          color: color,
                          border: `1px solid ${color}30`,
                        }}
                      >
                        {hero.role}
                      </div>

                      {/* Selected Check */}
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

                    {/* Bottom row - Hero info */}
                    <div>
                      <h3 
                        className="font-display text-2xl transition-colors duration-200"
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
            })}
          </div>
        </div>

        {/* Hero Details - Right Side */}
        <div className="w-[42%] border-l border-white/5 flex flex-col bg-[#08080c]/50 backdrop-blur-sm">
          {heroInfo ? (
            <div className="flex-1 flex flex-col">
              {/* Hero Header with large display */}
              <div 
                className="relative p-8 border-b border-white/5 overflow-hidden"
                style={{ background: `linear-gradient(135deg, ${accentColor}12, transparent 60%)` }}
              >
                {/* Background hero silhouette */}
                <div className="absolute -right-10 -top-10 opacity-10">
                  <HeroSVG heroId={displayHero!} size={250} />
                </div>
                
                <div className="relative z-10">
                  <div className="flex items-center gap-5">
                    <div 
                      className="w-16 h-16 rounded-xl flex items-center justify-center"
                      style={{ 
                        background: `linear-gradient(135deg, ${accentColor}, ${accentColor}bb)`,
                        boxShadow: `0 8px 25px ${accentColor}40`,
                      }}
                    >
                      <HeroIcon heroId={displayHero!} size={36} color="#ffffff" />
                    </div>
                    <div className="flex-1">
                      <h2 
                        className="font-display text-4xl text-white tracking-wide"
                        style={{ textShadow: `0 0 30px ${accentColor}50` }}
                      >
                        {heroInfo.name.toUpperCase()}
                      </h2>
                      <div className="flex items-center gap-3 mt-2">
                        <span 
                          className="px-3 py-1 rounded-lg text-xs font-display uppercase"
                          style={{ 
                            background: `${accentColor}25`,
                            color: accentColor,
                            border: `1px solid ${accentColor}30`,
                          }}
                        >
                          {heroInfo.role}
                        </span>
                        <span className="text-white/30">•</span>
                        <span className="text-white/50 font-body text-sm capitalize">{heroInfo.movementFocus}</span>
                      </div>
                    </div>
                  </div>
                  <p className="mt-5 text-white/60 font-body text-sm leading-relaxed max-w-md">
                    {heroInfo.description}
                  </p>
                </div>
              </div>

              {/* Stats */}
              <div className="p-6 border-b border-white/5">
                <h3 className="text-[10px] text-white/40 font-display uppercase tracking-widest mb-4">Combat Stats</h3>
                <div className="grid grid-cols-3 gap-5">
                  <StatCard label="Health" value={heroInfo.stats.maxHealth} icon="❤️" color={accentColor} />
                  <StatCard label="Speed" value={heroInfo.stats.moveSpeed} icon="⚡" color={accentColor} />
                  <StatCard label="Jump" value={heroInfo.stats.jumpForce} icon="🦘" color={accentColor} />
                </div>
              </div>

              {/* Abilities */}
              <div className="flex-1 p-6 overflow-y-auto">
                <h3 className="text-[10px] text-white/40 font-display uppercase tracking-widest mb-4">Abilities</h3>
                
                <div className="space-y-3">
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

      {/* Bottom Bar */}
      <div className="relative z-10 flex items-center justify-end px-8 py-5 border-t border-white/5 bg-[#08080c]/90 backdrop-blur-sm">
        {/* Lock In Button */}
        <button
          onClick={() => { playButtonClick(); handleLockIn(); }}
          onMouseEnter={playButtonHover}
          disabled={!selectedHero || isLockedIn}
          className={`relative px-10 py-4 rounded-xl font-display text-xl transition-all overflow-hidden ${
            isLockedIn 
              ? 'bg-green-500/20 border-2 border-green-500/50 text-green-400' 
              : selectedHero 
                ? 'text-white hover:scale-105 hover:shadow-2xl'
                : 'bg-white/5 border border-white/10 text-white/30 cursor-not-allowed'
          }`}
          style={!isLockedIn && selectedHero ? { 
            background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`,
            boxShadow: `0 10px 40px ${accentColor}40`,
          } : {}}
        >
          {/* Button shimmer */}
          {!isLockedIn && selectedHero && (
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-shimmer" />
          )}
          <span className="relative flex items-center gap-3">
            {isLockedIn ? (
              <>
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
  );
}

// Stat Card Component
function StatCard({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  return (
    <div 
      className="p-4 rounded-xl border border-white/5 bg-white/[0.02]"
      style={{ background: `linear-gradient(135deg, ${color}08, transparent)` }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <span className="text-[10px] text-white/40 font-body uppercase">{label}</span>
      </div>
      <span 
        className="font-display text-3xl text-white"
        style={{ textShadow: `0 0 20px ${color}40` }}
      >
        {value}
      </span>
    </div>
  );
}

// Ability Card Component
function AbilityCard({ 
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
      className={`p-4 rounded-xl border transition-all hover:scale-[1.01] ${
        isUltimate 
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
      <div className="flex items-start gap-4">
        <div 
          className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
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
          <AbilityIcon type={iconType} size={24} color="#ffffff" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-display text-white text-base">{abilityName}</span>
            {keybind && !isPassive && (
              <span 
                className="text-[10px] px-2 py-0.5 rounded font-mono font-bold"
                style={{ 
                  background: isUltimate ? 'rgba(245, 158, 11, 0.3)' : `${color}30`,
                  color: isUltimate ? '#fbbf24' : color,
                }}
              >
                {keybind}
              </span>
            )}
            {isPassive && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-white/10 text-white/50 font-body">
                PASSIVE
              </span>
            )}
            {isUltimate && (
              <span className="text-amber-400 text-xs">★ ULTIMATE</span>
            )}
          </div>
          <p className="text-white/50 text-xs font-body leading-relaxed">{abilityDesc}</p>
          {ability && ability.cooldown > 0 && (
            <div className="mt-2">
              <span 
                className="text-[10px] font-mono px-2 py-1 rounded"
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
}
