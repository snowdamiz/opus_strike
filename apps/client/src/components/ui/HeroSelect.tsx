import { useState, useEffect } from 'react';
import { HERO_DEFINITIONS, ALL_HERO_IDS, ABILITY_DEFINITIONS } from '@voxel-strike/shared';
import type { HeroId, Team } from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';

// Back button component
function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition-all"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
      </svg>
      <span className="font-display text-sm">LEAVE</span>
    </button>
  );
}

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
  const { selectHero, selectTeam, setReady, leaveGame } = useNetwork();
  const [selectedHero, setSelectedHero] = useState<HeroId | null>(localPlayer?.heroId ?? null);
  const [hoveredHero, setHoveredHero] = useState<HeroId | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(30);
  const [isLockedIn, setIsLockedIn] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      if (phaseEndTime) {
        const remaining = Math.ceil((phaseEndTime - Date.now()) / 1000);
        setTimeRemaining(Math.max(0, remaining));
      }
    }, 100);
    return () => clearInterval(interval);
  }, [phaseEndTime]);

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

  const handleTeamSelect = (team: Team) => {
    if (isLockedIn) return;
    selectTeam(team);
  };

  return (
    <div className="absolute inset-0 bg-[#08080c] flex flex-col">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-4">
          <BackButton onClick={leaveGame} />
          <div className="w-px h-6 bg-white/10" />
          <h1 className="font-display text-2xl text-white">
            CHOOSE YOUR <span style={{ color: accentColor }}>HERO</span>
          </h1>
        </div>
        
        {/* Timer */}
        <div className={`flex items-center gap-3 px-4 py-2 rounded ${timeRemaining < 10 ? 'bg-red-500/20' : 'bg-white/5'}`}>
          <span className="text-xs text-white/50 font-body uppercase">Time</span>
          <span className={`font-mono text-xl font-bold ${timeRemaining < 10 ? 'text-red-400' : 'text-white'}`}>
            {timeRemaining}
          </span>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Hero Grid - Left Side */}
        <div className="w-1/2 p-6 overflow-y-auto">
          <div className="grid grid-cols-3 gap-3">
            {ALL_HERO_IDS.map((heroId) => {
              const hero = HERO_DEFINITIONS[heroId];
              const color = HERO_COLORS[heroId];
              const isSelected = selectedHero === heroId;
              const isHovered = hoveredHero === heroId;
              
              return (
                <button
                  key={heroId}
                  onClick={() => handleSelectHero(heroId)}
                  onMouseEnter={() => setHoveredHero(heroId)}
                  onMouseLeave={() => setHoveredHero(null)}
                  disabled={isLockedIn}
                  className={`
                    relative aspect-[4/5] rounded-lg overflow-hidden transition-all duration-150
                    ${isLockedIn && !isSelected ? 'opacity-30' : ''}
                    group
                  `}
                  style={{
                    background: isSelected 
                      ? `linear-gradient(135deg, ${color}30, ${color}10)` 
                      : 'linear-gradient(135deg, #151520, #0c0c12)',
                    boxShadow: isSelected ? `0 0 30px ${color}30, inset 0 0 60px ${color}10` : 'none',
                  }}
                >
                  {/* Border */}
                  <div 
                    className="absolute inset-0 rounded-lg transition-all duration-150"
                    style={{ 
                      border: isSelected ? `2px solid ${color}` : isHovered ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.05)',
                    }}
                  />

                  {/* Hero Initial - Large Background */}
                  <div 
                    className="absolute inset-0 flex items-center justify-center opacity-10 font-display text-[120px] select-none"
                    style={{ color }}
                  >
                    {hero.name.charAt(0)}
                  </div>

                  {/* Content */}
                  <div className="relative h-full flex flex-col justify-end p-4">
                    {/* Role Badge */}
                    <div 
                      className="absolute top-3 left-3 px-2 py-1 rounded text-[10px] font-body uppercase tracking-wider"
                      style={{ 
                        background: `${color}20`,
                        color: color,
                      }}
                    >
                      {hero.role}
                    </div>

                    {/* Selected Check */}
                    {isSelected && (
                      <div 
                        className="absolute top-3 right-3 w-6 h-6 rounded flex items-center justify-center"
                        style={{ background: color }}
                      >
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}

                    {/* Hero Name */}
                    <h3 
                      className="font-display text-xl"
                      style={{ color: isSelected ? 'white' : color }}
                    >
                      {hero.name.toUpperCase()}
                    </h3>
                    <p className="text-white/40 text-xs font-body mt-1">
                      {hero.movementFocus}
                    </p>
                  </div>

                  {/* Hover Glow */}
                  {isHovered && !isSelected && (
                    <div 
                      className="absolute inset-0 opacity-20 transition-opacity"
                      style={{ background: `radial-gradient(circle at center, ${color}, transparent 70%)` }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Hero Details - Right Side */}
        <div className="w-1/2 border-l border-white/5 flex flex-col">
          {heroInfo ? (
            <div className="flex-1 flex flex-col animate-fade-in">
              {/* Hero Header */}
              <div 
                className="p-6 border-b border-white/5"
                style={{ background: `linear-gradient(135deg, ${accentColor}15, transparent)` }}
              >
                <div className="flex items-start gap-4">
                  <div 
                    className="w-14 h-14 rounded-lg flex items-center justify-center font-display text-2xl text-white"
                    style={{ background: accentColor }}
                  >
                    {heroInfo.name.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <h2 className="font-display text-3xl text-white">
                      {heroInfo.name.toUpperCase()}
                    </h2>
                    <p className="text-white/50 font-body text-sm mt-1">
                      {heroInfo.role} • {heroInfo.movementFocus}
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-white/60 font-body text-sm leading-relaxed">
                  {heroInfo.description}
                </p>
              </div>

              {/* Stats */}
              <div className="p-6 border-b border-white/5">
                <div className="grid grid-cols-3 gap-4">
                  <StatBar label="Health" value={heroInfo.stats.maxHealth} max={400} color={accentColor} />
                  <StatBar label="Speed" value={heroInfo.stats.moveSpeed} max={15} color={accentColor} />
                  <StatBar label="Jump" value={heroInfo.stats.jumpForce} max={15} color={accentColor} />
                </div>
              </div>

              {/* Abilities */}
              <div className="flex-1 p-6 overflow-y-auto space-y-3">
                <h3 className="text-[10px] text-white/40 font-body uppercase tracking-wider mb-3">Abilities</h3>
                
                {/* Passive */}
                <div className="p-3 rounded-lg bg-white/5 border border-white/5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50 font-mono">PASSIVE</span>
                    <span className="font-display text-white text-sm">{heroInfo.passive.name}</span>
                  </div>
                  <p className="text-white/40 text-xs font-body">{heroInfo.passive.description}</p>
                </div>

                <AbilityCard 
                  ability={ABILITY_DEFINITIONS[heroInfo.ability1.abilityId]} 
                  keybind="E"
                  color={accentColor}
                />
                <AbilityCard 
                  ability={ABILITY_DEFINITIONS[heroInfo.ability2.abilityId]} 
                  keybind="Q"
                  color={accentColor}
                />
                <AbilityCard 
                  ability={ABILITY_DEFINITIONS[heroInfo.ultimate.abilityId]} 
                  keybind="F"
                  color={accentColor}
                  isUltimate
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-lg bg-white/5 flex items-center justify-center">
                  <svg className="w-8 h-8 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
                  </svg>
                </div>
                <p className="font-display text-white/30 text-lg">SELECT A HERO</p>
                <p className="text-white/20 text-sm font-body mt-1">Click to view details</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-white/5 bg-[#0a0a0e]">
        {/* Team Selection */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/40 font-body uppercase">Team:</span>
          <button
            onClick={() => handleTeamSelect('red')}
            disabled={isLockedIn}
            className={`px-5 py-2 rounded font-display transition-all ${
              localPlayer?.team === 'red' 
                ? 'bg-red-500 text-white' 
                : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
            } ${isLockedIn ? 'opacity-50' : ''}`}
          >
            RED
          </button>
          <button
            onClick={() => handleTeamSelect('blue')}
            disabled={isLockedIn}
            className={`px-5 py-2 rounded font-display transition-all ${
              localPlayer?.team === 'blue' 
                ? 'bg-blue-500 text-white' 
                : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
            } ${isLockedIn ? 'opacity-50' : ''}`}
          >
            BLUE
          </button>
        </div>

        {/* Lock In */}
        <button
          onClick={handleLockIn}
          disabled={!selectedHero || isLockedIn}
          className={`px-8 py-3 rounded-lg font-display text-lg transition-all ${
            isLockedIn 
              ? 'bg-green-500/20 border border-green-500/30 text-green-400' 
              : selectedHero 
                ? 'text-white hover:brightness-110'
                : 'bg-white/5 text-white/30 cursor-not-allowed'
          }`}
          style={!isLockedIn && selectedHero ? { background: accentColor } : {}}
        >
          {isLockedIn ? '✓ LOCKED IN' : 'LOCK IN'}
        </button>
      </div>
    </div>
  );
}

function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const percent = (value / max) * 100;
  
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-white/40 font-body uppercase">{label}</span>
        <span className="font-mono text-white text-sm">{value}</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div 
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${percent}%`, background: color }}
        />
      </div>
    </div>
  );
}

function AbilityCard({ ability, keybind, color, isUltimate }: { 
  ability: { name: string; description: string; cooldown: number } | undefined;
  keybind: string;
  color: string;
  isUltimate?: boolean;
}) {
  if (!ability) return null;

  return (
    <div 
      className={`p-3 rounded-lg border ${isUltimate ? 'border-amber-500/30 bg-amber-500/10' : 'border-white/5 bg-white/[0.02]'}`}
    >
      <div className="flex items-center gap-3">
        <div 
          className="w-9 h-9 rounded flex items-center justify-center font-mono text-sm font-bold text-white"
          style={{ background: isUltimate ? '#f59e0b' : color }}
        >
          {keybind}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display text-white text-sm">{ability.name}</span>
            {isUltimate && <span className="text-amber-400 text-[10px]">★ ULTIMATE</span>}
          </div>
          <span className="text-[10px] text-white/40 font-body">
            {ability.cooldown > 0 ? `${ability.cooldown}s cooldown` : 'No cooldown'}
          </span>
        </div>
      </div>
    </div>
  );
}
