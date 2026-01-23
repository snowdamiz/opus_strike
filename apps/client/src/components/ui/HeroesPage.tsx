import { useState, useEffect } from 'react';
import { HERO_DEFINITIONS, ALL_HERO_IDS, ABILITY_DEFINITIONS } from '@voxel-strike/shared';
import type { HeroId } from '@voxel-strike/shared';
import { HeroSVG } from './HeroSVG';
import { HeroIcon, AbilityIcon, getAbilityIconType } from './HeroIcons';

// Hero colors for display
const HERO_COLORS: Record<HeroId, string> = {
  phantom: '#a855f7',
  hookshot: '#06b6d4',
  blaze: '#f97316',
  glacier: '#3b82f6',
  pulse: '#22c55e',
  sentinel: '#eab308',
};

export function HeroesPage() {
  const [selectedHero, setSelectedHero] = useState<HeroId>('phantom');
  const [prevHero, setPrevHero] = useState<HeroId>(selectedHero);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const heroInfo = HERO_DEFINITIONS[selectedHero];
  const heroColor = HERO_COLORS[selectedHero];

  // Handle hero transition animation
  useEffect(() => {
    if (selectedHero !== prevHero) {
      setIsTransitioning(true);
      const timer = setTimeout(() => {
        setPrevHero(selectedHero);
        setIsTransitioning(false);
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [selectedHero, prevHero]);

  return (
    <div className="h-full flex px-4 xl:px-6 2xl:px-8 py-4 gap-4 xl:gap-6 2xl:gap-8">
      {/* Left Panel - Hero Selector */}
      <div className="w-[160px] lg:w-[180px] xl:w-[220px] 2xl:w-[280px] flex flex-col justify-center">
        <div className="mb-5 px-1">
          <h2 className="font-display text-2xl text-white drop-shadow-lg">SELECT HERO</h2>
          <p className="text-white/50 text-xs font-body">Learn abilities & playstyles</p>
        </div>

        <div className="space-y-2">
          {ALL_HERO_IDS.map((heroId) => {
            const hero = HERO_DEFINITIONS[heroId];
            const color = HERO_COLORS[heroId];
            const isSelected = selectedHero === heroId;

            return (
              <button
                key={heroId}
                onClick={() => setSelectedHero(heroId)}
                className={`w-full group relative overflow-hidden rounded-xl transition-all duration-300 backdrop-blur-md ${isSelected ? 'scale-[1.02]' : 'hover:scale-[1.01]'
                  }`}
                style={{
                  background: isSelected
                    ? `linear-gradient(135deg, ${color}40 0%, rgba(15,15,26,0.9) 100%)`
                    : 'linear-gradient(135deg, rgba(15,15,26,0.85) 0%, rgba(15,15,26,0.7) 100%)',
                  border: isSelected
                    ? `2px solid ${color}70`
                    : '1px solid rgba(255,255,255,0.1)',
                  boxShadow: isSelected
                    ? `0 8px 32px ${color}40, 0 0 0 1px ${color}30, inset 0 1px 0 rgba(255,255,255,0.1)`
                    : '0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
                }}
              >
                {/* Hover glow effect */}
                <div
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{ background: `radial-gradient(circle at center, ${color}20, transparent 70%)` }}
                />

                {/* Content */}
                <div className="relative flex items-center gap-3 p-3">
                  {/* Hero Avatar */}
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300"
                    style={{
                      background: isSelected
                        ? `linear-gradient(135deg, ${color}, ${color}cc)`
                        : `linear-gradient(135deg, ${color}60, ${color}30)`,
                      boxShadow: isSelected
                        ? `0 4px 20px ${color}60, inset 0 1px 0 rgba(255,255,255,0.3)`
                        : `0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)`,
                    }}
                  >
                    <HeroIcon heroId={heroId} size={28} color="#ffffff" />
                  </div>

                  {/* Hero Info */}
                  <div className="flex-1 text-left min-w-0">
                    <h3
                      className="font-display text-base transition-colors truncate drop-shadow-md"
                      style={{ color: isSelected ? 'white' : 'rgba(255,255,255,0.85)' }}
                    >
                      {hero.name.toUpperCase()}
                    </h3>
                    <span
                      className="inline-block text-[10px] px-2 py-0.5 rounded-full uppercase font-body mt-1 font-medium"
                      style={{
                        background: isSelected ? `${color}50` : `${color}30`,
                        color: isSelected ? 'white' : color,
                        border: `1px solid ${color}50`,
                        textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                      }}
                    >
                      {hero.role}
                    </span>
                  </div>

                  {/* Selection indicator */}
                  {isSelected && (
                    <div
                      className="w-1.5 h-10 rounded-full flex-shrink-0"
                      style={{
                        background: `linear-gradient(180deg, ${color}, ${color}80)`,
                        boxShadow: `0 0 12px ${color}, 0 0 4px ${color}`
                      }}
                    />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Center Panel - Hero Showcase */}
      <div className="flex-1 flex flex-col items-center justify-center relative">
        {/* Background glow */}
        <div
          className="absolute inset-0 transition-all duration-500"
          style={{
            background: `radial-gradient(ellipse at center, ${heroColor}25, transparent 55%)`,
          }}
        />

        {/* Hero SVG Display */}
        <div className="relative flex flex-col items-center">
          {/* Animated Hero SVG */}
          <div
            className={`relative transition-all duration-250 ${isTransitioning ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}
            style={{
              filter: `drop-shadow(0 0 50px ${heroColor}40)`,
            }}
          >
            <HeroSVG
              heroId={isTransitioning ? prevHero : selectedHero}
              size={380}
              className="hero-svg-enter"
            />
          </div>

          {/* Hero Info Below */}
          <div className="text-center w-[260px] lg:w-[300px] xl:w-[360px] 2xl:w-[420px] mt-4">
            <h1
              className="font-display text-5xl text-white mb-3 transition-colors duration-300 drop-shadow-2xl"
              style={{ textShadow: `0 0 50px ${heroColor}70, 0 0 100px ${heroColor}40, 0 4px 8px rgba(0,0,0,0.8)` }}
            >
              {heroInfo.name.toUpperCase()}
            </h1>
            <div className="flex items-center justify-center gap-3 mb-4">
              <span
                className="px-5 py-2 rounded-full text-sm font-body uppercase tracking-wider backdrop-blur-md font-medium"
                style={{
                  background: `linear-gradient(135deg, ${heroColor}50, ${heroColor}30)`,
                  color: 'white',
                  border: `1px solid ${heroColor}60`,
                  boxShadow: `0 4px 20px ${heroColor}40, inset 0 1px 0 rgba(255,255,255,0.2)`,
                  textShadow: '0 1px 3px rgba(0,0,0,0.4)'
                }}
              >
                {heroInfo.role}
              </span>
              <span className="text-white/40">•</span>
              <span className="text-white/70 font-body text-sm drop-shadow-md">{heroInfo.movementFocus}</span>
            </div>
            <p
              className="text-white/70 font-body text-sm leading-relaxed max-w-sm mx-auto"
              style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}
            >
              {heroInfo.description}
            </p>
          </div>

          {/* Quick Stats Bar */}
          <div className="flex gap-4 mt-4">
            <QuickStat label="HP" value={heroInfo.stats.maxHealth} icon="❤️" color={heroColor} />
            <QuickStat label="SPD" value={heroInfo.stats.moveSpeed} icon="💨" color={heroColor} />
            <QuickStat label="JMP" value={heroInfo.stats.jumpForce} icon="⬆️" color={heroColor} />
          </div>
        </div>
      </div>

      {/* Right Panel - Abilities */}
      <div className="w-[220px] lg:w-[250px] xl:w-[300px] 2xl:w-[380px] h-full flex flex-col min-h-0">
        {/* Section Header */}
        <div className="mb-5 px-1 flex-shrink-0">
          <h2 className="font-display text-2xl text-white drop-shadow-lg">ABILITIES</h2>
          <p className="text-white/50 text-xs font-body">Master your hero's kit</p>
        </div>

        {/* Abilities List */}
        <div className="space-y-3 flex-1 overflow-y-auto min-h-0 pr-2 custom-scrollbar">
          {/* Passive */}
          <AbilityCard
            name={heroInfo.passive.name}
            description={heroInfo.passive.description}
            color={heroColor}
            isPassive
          />

          {/* Ability 1 */}
          <AbilityCard
            ability={ABILITY_DEFINITIONS[heroInfo.ability1.abilityId]}
            abilityId={heroInfo.ability1.abilityId}
            color={heroColor}
          />

          {/* Ability 2 */}
          <AbilityCard
            ability={ABILITY_DEFINITIONS[heroInfo.ability2.abilityId]}
            abilityId={heroInfo.ability2.abilityId}
            color={heroColor}
          />

          {/* Ultimate */}
          <AbilityCard
            ability={ABILITY_DEFINITIONS[heroInfo.ultimate.abilityId]}
            abilityId={heroInfo.ultimate.abilityId}
            color={heroColor}
            isUltimate
          />
        </div>
      </div>
    </div>
  );
}

// Quick Stat Component
function QuickStat({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  return (
    <div
      className="flex flex-col items-center px-6 py-4 rounded-xl backdrop-blur-md"
      style={{
        background: 'linear-gradient(135deg, rgba(15,15,26,0.9) 0%, rgba(15,15,26,0.7) 100%)',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)'
      }}
    >
      <span className="text-xl mb-1.5 drop-shadow-md">{icon}</span>
      <span
        className="font-display text-3xl text-white drop-shadow-lg"
        style={{ textShadow: `0 0 24px ${color}50, 0 2px 4px rgba(0,0,0,0.5)` }}
      >
        {value}
      </span>
      <span className="text-[10px] text-white/60 font-body uppercase tracking-widest mt-0.5">{label}</span>
    </div>
  );
}

// Ability Card Component
interface AbilityCardProps {
  ability?: { name: string; description: string; cooldown: number; type: string; duration?: number; charges?: number };
  abilityId?: string;
  name?: string;
  description?: string;
  color: string;
  isPassive?: boolean;
  isUltimate?: boolean;
}

function AbilityCard({ ability, abilityId, name, description, color, isPassive, isUltimate }: AbilityCardProps) {
  const abilityName = ability?.name ?? name ?? '';
  const abilityDesc = ability?.description ?? description ?? '';
  const iconType = isPassive ? 'passive' : isUltimate ? 'ultimate' : (abilityId ? getAbilityIconType(abilityId) : 'passive');

  return (
    <div
      className="group relative overflow-hidden rounded-xl transition-all duration-300 hover:scale-[1.01] backdrop-blur-md"
      style={{
        background: isUltimate
          ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.25) 0%, rgba(15,15,26,0.95) 100%)'
          : isPassive
            ? 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(15,15,26,0.9) 100%)'
            : `linear-gradient(135deg, ${color}20 0%, rgba(15,15,26,0.92) 100%)`,
        border: isUltimate
          ? '2px solid rgba(245, 158, 11, 0.5)'
          : isPassive
            ? '1px solid rgba(255,255,255,0.15)'
            : `1px solid ${color}40`,
        boxShadow: isUltimate
          ? '0 8px 32px rgba(245, 158, 11, 0.25), inset 0 1px 0 rgba(255,255,255,0.1)'
          : `0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      {/* Shimmer effect on hover */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          background: isUltimate
            ? 'linear-gradient(135deg, transparent 30%, rgba(245, 158, 11, 0.15) 50%, transparent 70%)'
            : `linear-gradient(135deg, transparent 30%, ${color}20 50%, transparent 70%)`,
        }}
      />

      <div className="relative p-4">
        <div className="flex items-start gap-4">
          {/* Ability Icon Badge */}
          <div
            className="relative w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden"
            style={{
              background: isUltimate
                ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                : isPassive
                  ? 'linear-gradient(135deg, rgba(255,255,255,0.2), rgba(255,255,255,0.08))'
                  : `linear-gradient(135deg, ${color}, ${color}cc)`,
              boxShadow: isUltimate
                ? '0 4px 20px rgba(245, 158, 11, 0.5), inset 0 1px 0 rgba(255,255,255,0.3)'
                : isPassive
                  ? '0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.15)'
                  : `0 4px 20px ${color}50, inset 0 1px 0 rgba(255,255,255,0.25)`,
            }}
          >
            {/* Inner glow */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/25 to-transparent" />
            <AbilityIcon type={iconType} size={24} color="#ffffff" className="relative z-10 drop-shadow-md" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <h4 className="font-display text-white text-base drop-shadow-md">{abilityName}</h4>
              {isPassive && (
                <span
                  className="text-[9px] px-2.5 py-0.5 rounded-full uppercase font-body font-medium"
                  style={{
                    background: 'rgba(255,255,255,0.15)',
                    color: 'rgba(255,255,255,0.8)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                  }}
                >
                  Passive
                </span>
              )}
              {isUltimate && (
                <span className="text-amber-400 text-sm drop-shadow-lg" style={{ textShadow: '0 0 8px rgba(245,158,11,0.6)' }}>★</span>
              )}
            </div>
            <p className="text-white/70 text-xs font-body leading-relaxed">{abilityDesc}</p>

            {/* Meta info */}
            {ability && (ability.cooldown > 0 || ability.duration || ability.charges) && (
              <div className="flex items-center gap-2 mt-3">
                {ability.cooldown > 0 && (
                  <span
                    className="text-[10px] font-mono flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium"
                    style={{
                      background: `${color}25`,
                      color: 'white',
                      border: `1px solid ${color}40`,
                      boxShadow: `0 2px 8px ${color}20`
                    }}
                  >
                    ⏱ {ability.cooldown}s
                  </span>
                )}
                {ability.duration && (
                  <span
                    className="text-[10px] font-mono flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium"
                    style={{
                      background: `${color}25`,
                      color: 'white',
                      border: `1px solid ${color}40`,
                      boxShadow: `0 2px 8px ${color}20`
                    }}
                  >
                    ⚡ {ability.duration}s
                  </span>
                )}
                {ability.charges && (
                  <span
                    className="text-[10px] font-mono flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium"
                    style={{
                      background: `${color}25`,
                      color: 'white',
                      border: `1px solid ${color}40`,
                      boxShadow: `0 2px 8px ${color}20`
                    }}
                  >
                    ×{ability.charges}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

