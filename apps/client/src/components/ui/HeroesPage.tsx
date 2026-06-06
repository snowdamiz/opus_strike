import { useState } from 'react';
import { HERO_DEFINITIONS, ALL_HERO_IDS, ABILITY_DEFINITIONS } from '@voxel-strike/shared';
import type { HeroId } from '@voxel-strike/shared';
import { HeroSVG } from './HeroSVG';
import { HeroIcon, AbilityIcon, getAbilityIconType } from './HeroIcons';

const HERO_COLORS: Record<HeroId, string> = {
  phantom: '#a855f7',
  hookshot: '#06b6d4',
  blaze: '#f97316',
  glacier: '#3b82f6',
  pulse: '#22c55e',
  sentinel: '#eab308',
};

const SIDE_STACK_CLASS = 'flex flex-col gap-2 xl:gap-2.5';

export function HeroesPage() {
  const [selectedHero, setSelectedHero] = useState<HeroId>('phantom');
  const heroInfo = HERO_DEFINITIONS[selectedHero];
  const heroColor = HERO_COLORS[selectedHero];

  return (
    <div className="h-full flex px-4 xl:px-6 2xl:px-8 pt-2 pb-4 gap-4 xl:gap-6 2xl:gap-8">
      <div className="w-[160px] lg:w-[180px] xl:w-[220px] 2xl:w-[280px] flex flex-col justify-center">
        <div className="mb-3 px-1">
          <h2 className="font-display text-2xl text-white">SELECT HERO</h2>
          <p className="text-white/50 text-xs font-body">Learn abilities & playstyles</p>
        </div>

        <div className={SIDE_STACK_CLASS}>
          {ALL_HERO_IDS.map((heroId) => {
            const hero = HERO_DEFINITIONS[heroId];
            const color = HERO_COLORS[heroId];
            const isSelected = selectedHero === heroId;

            return (
              <button
                key={heroId}
                onClick={() => setSelectedHero(heroId)}
                className="w-full relative overflow-hidden rounded-xl"
                style={{
                  background: isSelected ? 'rgba(255,255,255,0.08)' : 'rgba(15,15,26,0.82)',
                  border: isSelected ? `2px solid ${color}` : '1px solid rgba(255,255,255,0.1)',
                }}
              >
                <div className="relative flex items-center gap-3 p-3">
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{
                      background: isSelected ? color : 'rgba(255,255,255,0.08)',
                    }}
                  >
                    <HeroIcon heroId={heroId} size={28} color="#ffffff" />
                  </div>

                  <div className="flex-1 text-left min-w-0">
                    <h3
                      className="font-display text-base truncate"
                      style={{ color: isSelected ? 'white' : 'rgba(255,255,255,0.85)' }}
                    >
                      {hero.name.toUpperCase()}
                    </h3>
                    <span
                      className="inline-block text-[10px] px-2 py-0.5 rounded-full uppercase font-body mt-1 font-medium"
                      style={{
                        background: isSelected ? `${color}30` : 'rgba(255,255,255,0.06)',
                        color: isSelected ? 'white' : color,
                        border: isSelected ? `1px solid ${color}70` : '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      {hero.role}
                    </span>
                  </div>

                  {isSelected && (
                    <div
                      className="w-1.5 h-10 rounded-full flex-shrink-0"
                      style={{ background: color }}
                    />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center relative">
        <div className="relative flex flex-col items-center">
          <div className="relative hero-svg-container">
            <HeroSVG heroId={selectedHero} size={380} />
          </div>

          <div className="text-center w-[260px] lg:w-[300px] xl:w-[360px] 2xl:w-[420px] mt-4">
            <h1 className="font-display text-5xl text-white mb-3">
              {heroInfo.name.toUpperCase()}
            </h1>
            <div className="flex items-center justify-center gap-3 mb-4">
              <span
                className="px-5 py-2 rounded-full text-sm font-body uppercase tracking-wider font-medium"
                style={{
                  background: `${heroColor}28`,
                  color: 'white',
                  border: `1px solid ${heroColor}70`,
                }}
              >
                {heroInfo.role}
              </span>
              <span className="text-white/40">•</span>
              <span className="text-white/70 font-body text-sm">{heroInfo.movementFocus}</span>
            </div>
            <p className="text-white/70 font-body text-sm leading-relaxed max-w-sm mx-auto">
              {heroInfo.description}
            </p>
          </div>

          <div className="flex gap-4 mt-4">
            <QuickStat label="HP" value={heroInfo.stats.maxHealth} icon="❤️" />
            <QuickStat label="SPD" value={heroInfo.stats.moveSpeed} icon="💨" />
            <QuickStat label="JMP" value={heroInfo.stats.jumpForce} icon="⬆️" />
          </div>
        </div>
      </div>

      <div className="w-[220px] lg:w-[250px] xl:w-[300px] 2xl:w-[380px] flex flex-col justify-center">
        <div className="mb-3 px-1 flex-shrink-0">
          <h2 className="font-display text-2xl text-white">ABILITIES</h2>
          <p className="text-white/50 text-xs font-body">Master your hero's kit</p>
        </div>

        <div className={SIDE_STACK_CLASS}>
          <AbilityCard
            name={heroInfo.passive.name}
            description={heroInfo.passive.description}
            color={heroColor}
            isPassive
          />

          <AbilityCard
            ability={ABILITY_DEFINITIONS[heroInfo.ability1.abilityId]}
            abilityId={heroInfo.ability1.abilityId}
            color={heroColor}
          />

          <AbilityCard
            ability={ABILITY_DEFINITIONS[heroInfo.ability2.abilityId]}
            abilityId={heroInfo.ability2.abilityId}
            color={heroColor}
          />

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

function QuickStat({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div
      className="flex flex-col items-center px-6 py-4 rounded-xl"
      style={{
        background: 'rgba(15,15,26,0.82)',
        border: '1px solid rgba(255,255,255,0.12)',
      }}
    >
      <span className="text-xl mb-1.5">{icon}</span>
      <span className="font-display text-3xl text-white">{value}</span>
      <span className="text-[10px] text-white/60 font-body uppercase tracking-widest mt-0.5">{label}</span>
    </div>
  );
}

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
      className="relative overflow-hidden rounded-xl"
      style={{
        background: isUltimate ? 'rgba(245, 158, 11, 0.14)' : 'rgba(15,15,26,0.86)',
        border: isUltimate
          ? '2px solid rgba(245, 158, 11, 0.5)'
          : isPassive
            ? '1px solid rgba(255,255,255,0.15)'
            : `1px solid ${color}55`,
      }}
    >
      <div className="relative p-3">
        <div className="flex items-start gap-3">
          <div
            className="relative w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden"
            style={{
              background: isUltimate
                ? '#d97706'
                : isPassive
                  ? 'rgba(255,255,255,0.14)'
                  : color,
            }}
          >
            <AbilityIcon type={iconType} size={22} color="#ffffff" className="relative z-10" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <h4 className="font-display text-white text-base">{abilityName}</h4>
              {isPassive && (
                <span
                  className="text-[9px] px-2.5 py-0.5 rounded-full uppercase font-body font-medium"
                  style={{
                    background: 'rgba(255,255,255,0.12)',
                    color: 'rgba(255,255,255,0.8)',
                    border: '1px solid rgba(255,255,255,0.2)',
                  }}
                >
                  Passive
                </span>
              )}
              {isUltimate && (
                <span className="text-amber-400 text-sm">★</span>
              )}
            </div>
            <p className="text-white/70 text-xs font-body leading-snug">{abilityDesc}</p>

            {ability && (ability.cooldown > 0 || ability.duration || ability.charges) && (
              <div className="flex items-center gap-2 mt-2">
                {ability.cooldown > 0 && (
                  <MetaPill color={color}>⏱ {ability.cooldown}s</MetaPill>
                )}
                {ability.duration && (
                  <MetaPill color={color}>⚡ {ability.duration}s</MetaPill>
                )}
                {ability.charges && (
                  <MetaPill color={color}>×{ability.charges}</MetaPill>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaPill({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      className="text-[10px] font-mono flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium"
      style={{
        background: `${color}22`,
        color: 'white',
        border: `1px solid ${color}55`,
      }}
    >
      {children}
    </span>
  );
}
