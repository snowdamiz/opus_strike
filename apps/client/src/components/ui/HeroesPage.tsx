import { useState, type ReactNode } from 'react';
import { HERO_DEFINITIONS, ALL_HERO_IDS } from '@voxel-strike/shared';
import type { HeroId } from '@voxel-strike/shared';
import { HeroPreviewCanvas } from './HeroPreviewCanvas';
import { HeroIcon } from './HeroIcons';
import { getHeroSkillItems, HeroSkillIcon, type HeroSkillItem } from './HeroSkillKit';
import { ABILITY_COLORS, HERO_COLORS } from '../../styles/colorTokens';

const SIDE_STACK_CLASS = 'flex flex-col gap-1.5 xl:gap-2';

export function HeroesPage() {
  const [selectedHero, setSelectedHero] = useState<HeroId>('phantom');
  const heroInfo = HERO_DEFINITIONS[selectedHero];
  const heroColor = HERO_COLORS[selectedHero];
  const kitItems = getHeroSkillItems(selectedHero);

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
                    ? `linear-gradient(135deg, ${color}24, rgb(var(--color-strike-surface) / 0.88) 58%)`
                    : 'rgb(var(--color-strike-surface) / 0.76)',
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
          <HeroPreviewCanvas
            heroId={selectedHero}
            accentColor={heroColor}
            size="detail"
            initialYaw={Math.PI - 0.2}
            className="relative h-[clamp(17rem,42vh,29rem)] w-[clamp(15rem,28vw,28rem)]"
          />

          <div className="text-center w-[clamp(18rem,24vw,34rem)] mt-3 xl:mt-4">
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
              key={`${item.input}-${item.name}`}
              item={item}
              color={heroColor}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function QuickStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-strike-surface/75 px-3 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <span className="block font-display text-2xl text-white leading-none">{value}</span>
      <span className="mt-0.5 block text-[9px] text-white/45 font-mono uppercase tracking-[0.22em]">{label}</span>
    </div>
  );
}

function AbilityCard({ item, color }: { item: HeroSkillItem; color: string }) {
  const isClick = item.tone === 'click';
  const isUltimate = item.tone === 'ultimate';
  const cooldown = item.cooldown;
  const duration = item.duration;
  const charges = item.charges;

  return (
    <div
      className="relative overflow-hidden rounded-lg"
      style={{
        background: isUltimate
          ? `linear-gradient(135deg, ${ABILITY_COLORS.ultimatePanelStart}, rgb(var(--color-strike-surface) / 0.86) 62%)`
          : isClick
            ? `linear-gradient(135deg, ${color}18, rgb(var(--color-strike-surface) / 0.86) 54%)`
            : 'rgb(var(--color-strike-surface) / 0.84)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: isUltimate ? `0 0 22px ${ABILITY_COLORS.ultimateGlow}` : 'inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-px bg-white/10"
      />
      <div className="relative p-2.5">
        <div className="flex items-start gap-2.5">
          <HeroSkillIcon item={item} color={color} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <InputTag color={isUltimate ? ABILITY_COLORS.ultimate : color}>{item.input}</InputTag>
              <h4 className="font-display text-white text-[15px] leading-none truncate">{item.name}</h4>
            </div>
            <p className="mt-1 text-white/70 text-[11px] font-body leading-snug">{item.description}</p>

            {(cooldown !== undefined || duration || charges) && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {cooldown !== undefined && cooldown > 0 && (
                  <MetaPill color={isUltimate ? ABILITY_COLORS.ultimate : color}>{formatSeconds(cooldown)}</MetaPill>
                )}
                {duration && <MetaPill color={isUltimate ? ABILITY_COLORS.ultimate : color}>{duration}s active</MetaPill>}
                {charges && <MetaPill color={isUltimate ? ABILITY_COLORS.ultimate : color}>x{charges}</MetaPill>}
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
