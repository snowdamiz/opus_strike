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
  const [activeAbilityTab, setActiveAbilityTab] = useState<'abilities' | 'tips'>('abilities');
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
    <div className="h-full flex px-8 py-4 gap-8">
      {/* Left Panel - Hero Selector */}
      <div className="w-[280px] flex flex-col justify-center">
        <div className="mb-4">
          <h2 className="font-display text-2xl text-white">SELECT HERO</h2>
          <p className="text-white/40 text-xs font-body">Learn abilities & playstyles</p>
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
                className="w-full group relative overflow-hidden rounded-xl transition-all duration-300"
                style={{
                  background: isSelected 
                    ? `linear-gradient(135deg, ${color}30 0%, ${color}10 50%, transparent 100%)` 
                    : 'rgba(255,255,255,0.02)',
                  border: isSelected 
                    ? `1px solid ${color}50` 
                    : '1px solid rgba(255,255,255,0.05)',
                  boxShadow: isSelected ? `0 8px 32px ${color}25, inset 0 1px 0 ${color}20` : 'none',
                }}
              >
                {/* Hover glow effect */}
                <div 
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{ background: `radial-gradient(circle at center, ${color}15, transparent 70%)` }}
                />
                
                {/* Content */}
                <div className="relative flex items-center gap-3 p-3">
                  {/* Hero Avatar */}
                  <div 
                    className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300"
                    style={{ 
                      background: isSelected 
                        ? `linear-gradient(135deg, ${color}, ${color}99)` 
                        : `linear-gradient(135deg, ${color}40, ${color}20)`,
                      boxShadow: isSelected ? `0 4px 16px ${color}40` : 'none',
                    }}
                  >
                    <HeroIcon heroId={heroId} size={28} color="#ffffff" />
                  </div>
                  
                  {/* Hero Info */}
                  <div className="flex-1 text-left min-w-0">
                    <h3 
                      className="font-display text-base transition-colors truncate"
                      style={{ color: isSelected ? 'white' : `${color}cc` }}
                    >
                      {hero.name.toUpperCase()}
                    </h3>
                    <span 
                      className="inline-block text-[10px] px-2 py-0.5 rounded-full uppercase font-body mt-1"
                      style={{ 
                        background: `${color}20`, 
                        color: color,
                        border: `1px solid ${color}30`
                      }}
                    >
                      {hero.role}
                    </span>
                  </div>

                  {/* Selection indicator */}
                  {isSelected && (
                    <div 
                      className="w-1 h-8 rounded-full flex-shrink-0" 
                      style={{ 
                        background: `linear-gradient(180deg, ${color}, ${color}60)`,
                        boxShadow: `0 0 8px ${color}`
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
          <div className="text-center w-[420px] mt-4">
            <h1 
              className="font-display text-4xl text-white mb-2 transition-colors duration-300"
              style={{ textShadow: `0 0 40px ${heroColor}60, 0 2px 4px rgba(0,0,0,0.5)` }}
            >
              {heroInfo.name.toUpperCase()}
            </h1>
            <div className="flex items-center justify-center gap-3 mb-3">
              <span 
                className="px-4 py-1.5 rounded-full text-sm font-body uppercase tracking-wider backdrop-blur-sm"
                style={{ 
                  background: `linear-gradient(135deg, ${heroColor}40, ${heroColor}20)`, 
                  color: heroColor,
                  border: `1px solid ${heroColor}40`,
                  boxShadow: `0 4px 16px ${heroColor}20`
                }}
              >
                {heroInfo.role}
              </span>
              <span className="text-white/30">•</span>
              <span className="text-white/50 font-body text-sm">{heroInfo.movementFocus}</span>
            </div>
            <p className="text-white/50 font-body text-sm leading-relaxed max-w-sm mx-auto">
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

      {/* Right Panel - Abilities & Tips */}
      <div className="w-[380px] flex flex-col justify-center">
        {/* Tab Switcher */}
        <div className="flex gap-1 mb-4 p-1 rounded-xl bg-white/5 backdrop-blur-sm border border-white/5">
          {(['abilities', 'tips'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveAbilityTab(tab)}
              className={`flex-1 py-2.5 rounded-lg font-display text-sm transition-all duration-200 ${
                activeAbilityTab === tab
                  ? 'bg-white/10 text-white shadow-lg'
                  : 'text-white/40 hover:text-white/60 hover:bg-white/5'
              }`}
            >
              {tab === 'abilities' ? '⚔️ ABILITIES' : '💡 TIPS'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="space-y-3">
          {activeAbilityTab === 'abilities' ? (
            <>
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
            </>
          ) : (
            <>
              <TipsSection title="Strengths" tips={getHeroStrengths(selectedHero)} color="green" />
              <TipsSection title="Weaknesses" tips={getHeroWeaknesses(selectedHero)} color="red" />
              <TipsSection title="Pro Tips" tips={getHeroTips(selectedHero)} color="blue" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Quick Stat Component
function QuickStat({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  return (
    <div 
      className="flex flex-col items-center px-5 py-3 rounded-xl backdrop-blur-sm"
      style={{ 
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)'
      }}
    >
      <span className="text-xl mb-1">{icon}</span>
      <span className="font-display text-2xl text-white" style={{ textShadow: `0 0 20px ${color}40` }}>{value}</span>
      <span className="text-[10px] text-white/40 font-body uppercase tracking-wider">{label}</span>
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
      className="group relative overflow-hidden rounded-xl transition-all duration-300 hover:scale-[1.02]"
      style={{
        background: isUltimate 
          ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(245, 158, 11, 0.05) 100%)' 
          : isPassive
            ? 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)'
            : `linear-gradient(135deg, ${color}12 0%, ${color}05 100%)`,
        border: isUltimate 
          ? '1px solid rgba(245, 158, 11, 0.3)' 
          : isPassive 
            ? '1px solid rgba(255,255,255,0.08)'
            : `1px solid ${color}25`,
        boxShadow: isUltimate 
          ? '0 4px 24px rgba(245, 158, 11, 0.15), inset 0 1px 0 rgba(245, 158, 11, 0.1)' 
          : `0 4px 24px ${color}10`,
      }}
    >
      {/* Shimmer effect on hover */}
      <div 
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          background: isUltimate 
            ? 'linear-gradient(135deg, transparent 40%, rgba(245, 158, 11, 0.1) 50%, transparent 60%)'
            : `linear-gradient(135deg, transparent 40%, ${color}15 50%, transparent 60%)`,
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
                  ? 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06))' 
                  : `linear-gradient(135deg, ${color}, ${color}bb)`,
              boxShadow: isUltimate 
                ? '0 4px 16px rgba(245, 158, 11, 0.4)' 
                : isPassive 
                  ? '0 4px 16px rgba(255,255,255,0.05)'
                  : `0 4px 16px ${color}40`,
            }}
          >
            {/* Inner glow */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent" />
            <AbilityIcon type={iconType} size={24} color="#ffffff" className="relative z-10" />
          </div>
          
          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-display text-white text-base">{abilityName}</h4>
              {isPassive && (
                <span 
                  className="text-[9px] px-2 py-0.5 rounded-full uppercase font-body"
                  style={{ 
                    background: 'rgba(255,255,255,0.1)', 
                    color: 'rgba(255,255,255,0.6)',
                    border: '1px solid rgba(255,255,255,0.1)'
                  }}
                >
                  Passive
                </span>
              )}
              {isUltimate && (
                <span className="text-amber-400 text-sm">★</span>
              )}
            </div>
            <p className="text-white/50 text-xs font-body leading-relaxed">{abilityDesc}</p>
            
            {/* Meta info */}
            {ability && (ability.cooldown > 0 || ability.duration || ability.charges) && (
              <div className="flex items-center gap-2 mt-2">
                {ability.cooldown > 0 && (
                  <span 
                    className="text-[10px] font-mono flex items-center gap-1 px-2 py-1 rounded-md"
                    style={{ 
                      background: `${color}15`, 
                      color: `${color}cc`,
                      border: `1px solid ${color}20`
                    }}
                  >
                    ⏱ {ability.cooldown}s
                  </span>
                )}
                {ability.duration && (
                  <span 
                    className="text-[10px] font-mono flex items-center gap-1 px-2 py-1 rounded-md"
                    style={{ 
                      background: `${color}15`, 
                      color: `${color}cc`,
                      border: `1px solid ${color}20`
                    }}
                  >
                    ⚡ {ability.duration}s
                  </span>
                )}
                {ability.charges && (
                  <span 
                    className="text-[10px] font-mono flex items-center gap-1 px-2 py-1 rounded-md"
                    style={{ 
                      background: `${color}15`, 
                      color: `${color}cc`,
                      border: `1px solid ${color}20`
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

// Tips Section Component
function TipsSection({ title, tips, color }: { title: string; tips: string[]; color: 'green' | 'red' | 'blue' }) {
  const colors = {
    green: { 
      bg: 'linear-gradient(135deg, rgba(34, 197, 94, 0.12), rgba(34, 197, 94, 0.04))', 
      border: 'rgba(34, 197, 94, 0.25)', 
      text: '#4ade80', 
      dot: '#22c55e' 
    },
    red: { 
      bg: 'linear-gradient(135deg, rgba(239, 68, 68, 0.12), rgba(239, 68, 68, 0.04))', 
      border: 'rgba(239, 68, 68, 0.25)', 
      text: '#f87171', 
      dot: '#ef4444' 
    },
    blue: { 
      bg: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(59, 130, 246, 0.04))', 
      border: 'rgba(59, 130, 246, 0.25)', 
      text: '#60a5fa', 
      dot: '#3b82f6' 
    },
  };
  const c = colors[color];

  return (
    <div 
      className="p-4 rounded-xl"
      style={{ 
        background: c.bg,
        border: `1px solid ${c.border}`,
        boxShadow: `0 4px 24px ${c.border}`
      }}
    >
      <h4 
        className="font-display text-sm mb-3"
        style={{ color: c.text }}
      >
        {title.toUpperCase()}
      </h4>
      <ul className="space-y-2">
        {tips.map((tip, i) => (
          <li key={i} className="flex items-start gap-2">
            <div 
              className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
              style={{ 
                background: c.dot,
                boxShadow: `0 0 8px ${c.dot}`
              }}
            />
            <span className="text-white/60 text-xs font-body leading-relaxed">{tip}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Helper functions
function getHeroStrengths(heroId: HeroId): string[] {
  const strengths: Record<HeroId, string[]> = {
    phantom: ['Excellent flanking potential', 'High burst mobility', 'Great escape tools'],
    hookshot: ['Unmatched vertical mobility', 'Team utility with zipline', 'Momentum-based plays'],
    blaze: ['Dominates aerial combat', 'Strong area denial', 'High damage potential'],
    glacier: ['Extremely durable', 'Strong zoning abilities', 'Great at holding positions'],
    pulse: ['Enhances team mobility', 'Fast flag captures', 'Strong team fight utility'],
    sentinel: ['Best flag defense', 'High survivability', 'Team healing with ultimate'],
  };
  return strengths[heroId];
}

function getHeroWeaknesses(heroId: HeroId): string[] {
  const weaknesses: Record<HeroId, string[]> = {
    phantom: ['Low health pool', 'Vulnerable on cooldown', 'Weak in prolonged fights'],
    hookshot: ['Grapple can be interrupted', 'Struggles indoors', 'Predictable while swinging'],
    blaze: ['Fuel management crucial', 'Loud and noticeable', 'Vulnerable when grounded'],
    glacier: ['Slowest movement', 'Large hitbox', 'Weak at chasing'],
    pulse: ['Low health', 'Relies on team coordination', 'Weak solo dueling'],
    sentinel: ['Very limited mobility', 'Fortify roots in place', 'Easily flanked'],
  };
  return weaknesses[heroId];
}

function getHeroTips(heroId: HeroId): string[] {
  const tips: Record<HeroId, string[]> = {
    phantom: ['Use blink to dodge abilities', 'Shadow step to escape after a pick', 'Save ultimate for flag runs'],
    hookshot: ['Swing for maximum momentum', 'Grapple to high ground first', 'Use zipline to enable team pushes'],
    blaze: ['Manage fuel carefully', 'Rocket jump for emergency escapes', 'Rain down fire from above'],
    glacier: ['Slide through choke points', 'Use ice walls to cut off enemies', 'Fortress is best used defensively'],
    pulse: ['Speed boost before team fights', 'Dash to dodge key abilities', 'Ultimate when pushing objectives'],
    sentinel: ['Position near your flag', 'Barrier blocks projectiles AND movement', 'Dome provides healing zone'],
  };
  return tips[heroId];
}
