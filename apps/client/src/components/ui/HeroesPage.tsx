import { useState, type ReactNode } from 'react';
import { HERO_DEFINITIONS, ALL_HERO_IDS, ABILITY_DEFINITIONS } from '@voxel-strike/shared';
import type { AbilityDefinition, HeroId } from '@voxel-strike/shared';
import { HeroSVG } from './HeroSVG';
import { HeroIcon, AbilityIcon, getAbilityIconType, type AbilityIconType } from './HeroIcons';

const HERO_COLORS: Record<HeroId, string> = {
  phantom: '#a855f7',
  hookshot: '#06b6d4',
  blaze: '#f97316',
  glacier: '#3b82f6',
  pulse: '#22c55e',
  sentinel: '#eab308',
};

const HERO_CLICK_SKILLS: Record<HeroId, ClickSkill[]> = {
  phantom: [
    {
      input: 'LMB',
      name: 'Dire Ball',
      description: 'Fire alternating shadow projectiles down your aim line.',
      cooldown: 0.55,
      iconType: 'veil',
    },
    {
      input: 'RMB',
      name: 'Void Ray',
      description: 'Charge, then release a piercing beam at long range.',
      cooldown: 1.2,
      iconType: 'shadowstep',
    },
  ],
  hookshot: [
    {
      input: 'LMB',
      name: 'Chain Hooks',
      description: 'Launch short hooks that extend, snap back, and pressure close targets.',
      cooldown: 0.6,
      iconType: 'grapple',
    },
    {
      input: 'RMB',
      name: 'Drag Hook',
      description: 'Fire a heavier hook that catches enemy heroes and pulls them in.',
      cooldown: 3.6,
      iconType: 'zipline',
    },
  ],
  blaze: [
    {
      input: 'LMB',
      name: 'Rockets',
      description: 'Fire direct rockets with splash pressure at mid range.',
      cooldown: 0.85,
      iconType: 'rocketjump',
    },
    {
      input: 'RMB',
      name: 'Bomb',
      description: 'Pick a target zone, then drop an explosive payload.',
      cooldown: 2.6,
      iconType: 'airstrike',
    },
  ],
  glacier: [
    {
      input: 'LMB',
      name: 'Ice Mallet',
      description: 'Swing a heavy ice hammer through nearby enemies.',
      cooldown: 0.75,
      iconType: 'fortress',
    },
    {
      input: 'RMB',
      name: 'Ice Shield',
      description: 'Hold up a frost guard to block pressure while advancing.',
      cooldown: 1.2,
      iconType: 'frostshield',
    },
  ],
  pulse: [
    {
      input: 'LMB',
      name: 'Pulse Burst',
      description: 'Send quick energy bursts downrange with a rapid cadence.',
      cooldown: 0.36,
      iconType: 'speedboost',
    },
    {
      input: 'RMB',
      name: 'Dash Hit',
      description: 'Snap into close range and punish enemies caught in the lane.',
      cooldown: 0.9,
      iconType: 'dash',
    },
  ],
  sentinel: [
    {
      input: 'LMB',
      name: 'Sentinel Bolt',
      description: 'Fire steady defensive bolts from a guarded stance.',
      cooldown: 0.65,
      iconType: 'fortify',
    },
    {
      input: 'RMB',
      name: 'Barrier Bash',
      description: 'Shove nearby threats back with a short-range shield strike.',
      cooldown: 1.4,
      iconType: 'barrier',
    },
  ],
};

type KitItem =
  | {
      input: string;
      name: string;
      description: string;
      iconType: AbilityIconType;
      tone?: 'passive' | 'click' | 'ultimate';
      cooldown?: number;
      duration?: number;
      charges?: number;
    }
  | {
      input: string;
      ability: AbilityDefinition;
      abilityId: string;
      iconType: AbilityIconType;
      tone?: 'ultimate';
    };

interface ClickSkill {
  input: 'LMB' | 'RMB';
  name: string;
  description: string;
  cooldown: number;
  iconType: AbilityIconType;
}

const SIDE_STACK_CLASS = 'flex flex-col gap-1.5 xl:gap-2';

export function HeroesPage() {
  const [selectedHero, setSelectedHero] = useState<HeroId>('phantom');
  const heroInfo = HERO_DEFINITIONS[selectedHero];
  const heroColor = HERO_COLORS[selectedHero];
  const kitItems: KitItem[] = [
    {
      input: 'PASSIVE',
      name: heroInfo.passive.name,
      description: heroInfo.passive.description,
      iconType: 'passive',
      tone: 'passive',
    },
    ...HERO_CLICK_SKILLS[selectedHero].map((skill) => ({
      ...skill,
      tone: 'click' as const,
    })),
    toAbilityItem('E', heroInfo.ability1.abilityId),
    toAbilityItem('Q', heroInfo.ability2.abilityId),
    toAbilityItem('F', heroInfo.ultimate.abilityId, 'ultimate'),
  ];

  return (
    <div className="heroes-page-layout menu-content-wide">
      <div className="min-w-0 flex flex-col justify-center min-h-0">
        <div className="mb-2.5 px-0.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/35">Roster</p>
          <h2 className="font-display text-2xl text-white leading-none">SELECT HERO</h2>
        </div>

        <div className={`${SIDE_STACK_CLASS} min-h-0 menu-scroll-y custom-scrollbar pr-1`}>
          {ALL_HERO_IDS.map((heroId) => {
            const hero = HERO_DEFINITIONS[heroId];
            const color = HERO_COLORS[heroId];
            const isSelected = selectedHero === heroId;

            return (
              <button
                key={heroId}
                onClick={() => setSelectedHero(heroId)}
                className="group w-full relative overflow-hidden rounded-lg text-left transition-transform hover:-translate-y-0.5"
                style={{
                  background: isSelected
                    ? `linear-gradient(135deg, ${color}24, rgba(12,12,20,0.88) 58%)`
                    : 'rgba(12,12,20,0.76)',
                  border: isSelected ? `1px solid ${color}aa` : '1px solid rgba(255,255,255,0.1)',
                  boxShadow: isSelected ? `0 0 22px ${color}22, inset 0 1px 0 rgba(255,255,255,0.08)` : 'none',
                }}
              >
                <div
                  className="absolute inset-x-0 top-0 h-px opacity-70"
                  style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
                />
                <div className="relative flex items-center gap-2.5 p-2">
                  <div
                    className="w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{
                      background: isSelected ? color : 'rgba(255,255,255,0.07)',
                    }}
                  >
                    <HeroIcon heroId={heroId} size={23} color="#ffffff" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3
                        className="font-display text-[15px] truncate leading-none"
                        style={{ color: isSelected ? 'white' : 'rgba(255,255,255,0.78)' }}
                      >
                        {hero.name.toUpperCase()}
                      </h3>
                      <span className="font-mono text-[9px] text-white/30">{hero.stats.maxHealth}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded uppercase font-body font-semibold leading-none"
                        style={{
                          background: isSelected ? `${color}30` : 'rgba(255,255,255,0.06)',
                          color: isSelected ? 'white' : color,
                          border: isSelected ? `1px solid ${color}60` : '1px solid rgba(255,255,255,0.08)',
                        }}
                      >
                        {hero.role}
                      </span>
                      <span className="text-[9px] uppercase text-white/35 font-body">{hero.movementFocus}</span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-w-0 flex flex-col items-center justify-center relative">
        <div
          className="absolute left-1/2 top-[43%] h-[54%] w-[56%] -translate-x-1/2 -translate-y-1/2 opacity-30 blur-3xl pointer-events-none"
          style={{ background: `radial-gradient(ellipse at center, ${heroColor}, transparent 68%)` }}
        />

        <div className="relative flex flex-col items-center menu-compact-scale">
          <div className="relative hero-svg-container scale-[0.82] lg:scale-90 xl:scale-95 2xl:scale-100">
            <HeroSVG heroId={selectedHero} size={360} />
          </div>

          <div className="text-center w-[clamp(18rem,24vw,34rem)] mt-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 mb-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: heroColor, boxShadow: `0 0 12px ${heroColor}` }}
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/55">
                {heroInfo.role} / {heroInfo.movementFocus}
              </span>
            </div>
            <h1 className="font-display text-5xl xl:text-6xl text-white leading-none">
              {heroInfo.name.toUpperCase()}
            </h1>
            <p className="text-white/70 font-body text-sm leading-snug max-w-sm mx-auto mt-2">
              {heroInfo.description}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2.5 mt-3 w-[clamp(18rem,21vw,30rem)]">
            <QuickStat label="HP" value={heroInfo.stats.maxHealth} />
            <QuickStat label="SPD" value={heroInfo.stats.moveSpeed} />
            <QuickStat label="JMP" value={heroInfo.stats.jumpForce} />
          </div>
        </div>
      </div>

      <div className="min-w-0 flex flex-col justify-center min-h-0">
        <div className="mb-2.5 px-0.5 flex-shrink-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/35">Full kit</p>
          <h2 className="font-display text-2xl text-white leading-none">ABILITIES</h2>
        </div>

        <div className={`${SIDE_STACK_CLASS} max-h-full overflow-y-auto custom-scrollbar pr-1`}>
          {kitItems.map((item) => (
            <AbilityCard
              key={`${item.input}-${'abilityId' in item ? item.abilityId : item.name}`}
              item={item}
              color={heroColor}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function toAbilityItem(input: string, abilityId: string, tone?: 'ultimate'): KitItem {
  const ability = ABILITY_DEFINITIONS[abilityId];

  return {
    input,
    ability,
    abilityId,
    iconType: getAbilityIconType(abilityId),
    tone,
  };
}

function QuickStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#0d0d17]/75 px-3 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <span className="block font-display text-2xl text-white leading-none">{value}</span>
      <span className="mt-0.5 block text-[9px] text-white/45 font-mono uppercase tracking-[0.22em]">{label}</span>
    </div>
  );
}

function AbilityCard({ item, color }: { item: KitItem; color: string }) {
  const abilityName = 'ability' in item ? item.ability.name : item.name;
  const abilityDesc = 'ability' in item ? item.ability.description : item.description;
  const isPassive = item.tone === 'passive';
  const isClick = item.tone === 'click';
  const isUltimate = item.tone === 'ultimate';
  const cooldown = 'ability' in item ? item.ability.cooldown : item.cooldown;
  const duration = 'ability' in item ? item.ability.duration : item.duration;
  const charges = 'ability' in item ? item.ability.charges : item.charges;
  const borderColor = isUltimate ? 'rgba(245,158,11,0.62)' : isPassive ? 'rgba(255,255,255,0.15)' : `${color}66`;

  return (
    <div
      className="relative overflow-hidden rounded-lg"
      style={{
        background: isUltimate
          ? 'linear-gradient(135deg, rgba(180, 83, 9, 0.2), rgba(13,13,23,0.86) 62%)'
          : isClick
            ? `linear-gradient(135deg, ${color}18, rgba(13,13,23,0.86) 54%)`
            : 'rgba(13,13,23,0.84)',
        border: `1px solid ${borderColor}`,
        boxShadow: isUltimate ? '0 0 22px rgba(245,158,11,0.12)' : `0 0 18px ${color}12`,
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-px opacity-75"
        style={{
          background: isUltimate
            ? 'linear-gradient(90deg, transparent, #f59e0b, transparent)'
            : `linear-gradient(90deg, transparent, ${color}, transparent)`,
        }}
      />
      <div className="relative p-2.5">
        <div className="flex items-start gap-2.5">
          <div
            className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 overflow-hidden"
            style={{
              background: isUltimate
                ? 'linear-gradient(135deg, #f59e0b, #b45309)'
                : isPassive
                  ? 'rgba(255,255,255,0.12)'
                  : color,
            }}
          >
            <AbilityIcon type={item.iconType} size={20} color="#ffffff" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <InputTag color={isUltimate ? '#f59e0b' : color}>{item.input}</InputTag>
              <h4 className="font-display text-white text-[15px] leading-none truncate">{abilityName}</h4>
            </div>
            <p className="mt-1 text-white/70 text-[11px] font-body leading-snug">{abilityDesc}</p>

            {(cooldown !== undefined || duration || charges) && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {cooldown !== undefined && cooldown > 0 && (
                  <MetaPill color={isUltimate ? '#f59e0b' : color}>{formatSeconds(cooldown)}</MetaPill>
                )}
                {duration && <MetaPill color={isUltimate ? '#f59e0b' : color}>{duration}s active</MetaPill>}
                {charges && <MetaPill color={isUltimate ? '#f59e0b' : color}>x{charges}</MetaPill>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InputTag({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-white"
      style={{ background: `${color}26`, border: `1px solid ${color}66` }}
    >
      {children}
    </span>
  );
}

function MetaPill({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[9px] font-mono font-medium text-white/80"
      style={{
        background: `${color}1c`,
        border: `1px solid ${color}44`,
      }}
    >
      {children}
    </span>
  );
}

function formatSeconds(seconds: number) {
  return `${seconds < 1 ? seconds.toFixed(2).replace(/0$/, '') : seconds.toFixed(seconds % 1 === 0 ? 0 : 1)}s cd`;
}
