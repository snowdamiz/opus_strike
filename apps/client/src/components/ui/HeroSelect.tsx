import { useState, useEffect } from 'react';
import { HERO_DEFINITIONS, ALL_HERO_IDS, ABILITY_DEFINITIONS } from '@voxel-strike/shared';
import type { HeroId, Team } from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';

export function HeroSelect() {
  const { localPlayer, phaseEndTime } = useGameStore();
  const { selectHero, selectTeam, setReady } = useNetwork();
  const [selectedHero, setSelectedHero] = useState<HeroId | null>(localPlayer?.heroId ?? null);
  const [hoveredHero, setHoveredHero] = useState<HeroId | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(30);
  const [isLockedIn, setIsLockedIn] = useState(false);

  // Timer countdown
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

  const getRoleColor = (role: string): string => {
    const colors: Record<string, string> = {
      flanker: 'text-purple-400',
      mobile: 'text-cyan-400',
      assault: 'text-orange-400',
      tank: 'text-blue-400',
      support: 'text-green-400',
      defense: 'text-yellow-400',
    };
    return colors[role] ?? 'text-gray-400';
  };

  return (
    <div className="absolute inset-0 bg-voxel-darker/95 backdrop-blur-sm flex">
      {/* Left side - Hero grid */}
      <div className="flex-1 p-8 flex flex-col">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-3xl text-voxel-primary">SELECT YOUR HERO</h2>
          <div className="flex items-center gap-2">
            <span className="font-body text-gray-400">Time remaining:</span>
            <span className={`font-mono text-2xl ${timeRemaining < 10 ? 'text-red-400' : 'text-white'}`}>
              {timeRemaining}s
            </span>
          </div>
        </div>

        {/* Hero grid */}
        <div className="grid grid-cols-3 gap-4 flex-1">
          {ALL_HERO_IDS.map((heroId) => {
            const hero = HERO_DEFINITIONS[heroId];
            const isSelected = selectedHero === heroId;
            
            return (
              <button
                key={heroId}
                onClick={() => handleSelectHero(heroId)}
                onMouseEnter={() => setHoveredHero(heroId)}
                onMouseLeave={() => setHoveredHero(null)}
                className={`
                  relative p-4 rounded-lg border-2 transition-all duration-200
                  ${isSelected 
                    ? 'border-voxel-primary bg-voxel-primary/10 shadow-lg shadow-voxel-primary/30' 
                    : 'border-voxel-border bg-voxel-surface/50 hover:border-voxel-primary/50'
                  }
                `}
              >
                {/* Hero portrait placeholder */}
                <div className="w-full aspect-square bg-gradient-to-br from-voxel-dark to-voxel-surface rounded-lg mb-3 flex items-center justify-center">
                  <span className="font-display text-6xl text-voxel-primary/30">
                    {hero.name.charAt(0)}
                  </span>
                </div>

                {/* Hero name and role */}
                <div className="text-left">
                  <h3 className="font-display text-xl text-white">{hero.name}</h3>
                  <p className={`font-body text-sm ${getRoleColor(hero.role)}`}>
                    {hero.role.toUpperCase()}
                  </p>
                </div>

                {/* Selected indicator */}
                {isSelected && (
                  <div className="absolute top-2 right-2 w-4 h-4 bg-voxel-primary rounded-full flex items-center justify-center">
                    <svg className="w-3 h-3 text-voxel-dark" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right side - Hero details */}
      <div className="w-96 bg-voxel-surface border-l border-voxel-border p-6 flex flex-col">
        {heroInfo ? (
          <>
            {/* Hero header */}
            <div className="mb-6">
              <h2 className="font-display text-4xl text-white mb-1">{heroInfo.name}</h2>
              <div className="flex items-center gap-3">
                <span className={`font-body ${getRoleColor(heroInfo.role)}`}>
                  {heroInfo.role.toUpperCase()}
                </span>
                <span className="text-gray-600">•</span>
                <span className="font-body text-gray-400">
                  {heroInfo.movementFocus.toUpperCase()}
                </span>
              </div>
            </div>

            {/* Description */}
            <p className="font-body text-gray-300 mb-6">{heroInfo.description}</p>

            {/* Stats */}
            <div className="mb-6">
              <h3 className="font-display text-sm text-voxel-primary mb-3 tracking-wider">STATS</h3>
              <div className="space-y-2">
                <StatBar label="Health" value={heroInfo.stats.maxHealth} max={400} />
                <StatBar label="Speed" value={heroInfo.stats.moveSpeed} max={15} />
                <StatBar label="Jump" value={heroInfo.stats.jumpForce} max={15} />
              </div>
            </div>

            {/* Passive */}
            <div className="mb-6">
              <h3 className="font-display text-sm text-voxel-primary mb-3 tracking-wider">PASSIVE</h3>
              <div className="p-3 bg-voxel-dark rounded">
                <h4 className="font-display text-white mb-1">{heroInfo.passive.name}</h4>
                <p className="font-body text-sm text-gray-400">{heroInfo.passive.description}</p>
              </div>
            </div>

            {/* Abilities */}
            <div className="flex-1">
              <h3 className="font-display text-sm text-voxel-primary mb-3 tracking-wider">ABILITIES</h3>
              <div className="space-y-2">
                <AbilityInfo 
                  ability={ABILITY_DEFINITIONS[heroInfo.ability1.abilityId]} 
                  keybind={heroInfo.ability1.defaultKey}
                />
                <AbilityInfo 
                  ability={ABILITY_DEFINITIONS[heroInfo.ability2.abilityId]} 
                  keybind={heroInfo.ability2.defaultKey}
                />
                <AbilityInfo 
                  ability={ABILITY_DEFINITIONS[heroInfo.ultimate.abilityId]} 
                  keybind={heroInfo.ultimate.defaultKey}
                  isUltimate
                />
              </div>
            </div>

            {/* Lock in button */}
            <button
              onClick={handleLockIn}
              disabled={!selectedHero || isLockedIn}
              className={`mt-4 w-full py-3 font-display text-lg font-bold rounded transition-all duration-200
                       ${isLockedIn 
                         ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
                         : selectedHero 
                           ? 'bg-voxel-primary text-voxel-dark hover:bg-voxel-primary/90 hover:shadow-lg hover:shadow-voxel-primary/30 active:scale-[0.98]'
                           : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                       }`}
            >
              {isLockedIn ? 'LOCKED IN' : 'LOCK IN'}
            </button>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="font-body text-gray-500">Select a hero to view details</p>
          </div>
        )}
      </div>

      {/* Team indicators at bottom */}
      <div className="absolute bottom-4 left-4 flex gap-2">
        <TeamIndicator team="red" selected={localPlayer?.team === 'red'} onClick={() => handleTeamSelect('red')} />
        <TeamIndicator team="blue" selected={localPlayer?.team === 'blue'} onClick={() => handleTeamSelect('blue')} />
      </div>
    </div>
  );
}

interface StatBarProps {
  label: string;
  value: number;
  max: number;
}

function StatBar({ label, value, max }: StatBarProps) {
  const percent = (value / max) * 100;
  
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 font-body text-sm text-gray-400">{label}</span>
      <div className="flex-1 h-2 bg-voxel-dark rounded overflow-hidden">
        <div 
          className="h-full bg-voxel-primary/60"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="w-8 font-mono text-xs text-gray-500 text-right">{value}</span>
    </div>
  );
}

interface AbilityInfoProps {
  ability: { name: string; description: string; cooldown: number } | undefined;
  keybind: string;
  isUltimate?: boolean;
}

function AbilityInfo({ ability, keybind, isUltimate }: AbilityInfoProps) {
  if (!ability) return null;

  return (
    <div className={`p-3 rounded ${isUltimate ? 'bg-voxel-accent/20 border border-voxel-accent/30' : 'bg-voxel-dark'}`}>
      <div className="flex items-center justify-between mb-1">
        <h4 className="font-display text-white text-sm">{ability.name}</h4>
        <span className="px-2 py-0.5 bg-voxel-surface rounded font-mono text-xs text-gray-400">
          {keybind.replace('Key', '')}
        </span>
      </div>
      <p className="font-body text-xs text-gray-400">{ability.description}</p>
      {ability.cooldown > 0 && (
        <p className="font-mono text-xs text-voxel-primary mt-1">{ability.cooldown}s cooldown</p>
      )}
    </div>
  );
}

interface TeamIndicatorProps {
  team: Team;
  selected: boolean;
  onClick: () => void;
}

function TeamIndicator({ team, selected, onClick }: TeamIndicatorProps) {
  const isRed = team === 'red';
  
  return (
    <button
      onClick={onClick}
      className={`
        px-4 py-2 rounded font-display text-sm tracking-wider transition-all duration-200
        ${isRed ? 'bg-team-red/20 border-team-red hover:bg-team-red/30' : 'bg-team-blue/20 border-team-blue hover:bg-team-blue/30'}
        ${selected ? 'border-2' : 'border border-opacity-50 opacity-50 hover:opacity-80'}
      `}
    >
      {team.toUpperCase()} TEAM
    </button>
  );
}

