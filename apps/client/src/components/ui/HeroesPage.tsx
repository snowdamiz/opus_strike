import { lazy, Suspense, type CSSProperties, type ReactNode } from 'react';
import { HERO_DEFINITIONS, ALL_HERO_IDS } from '@voxel-strike/shared';
import type { HeroId } from '@voxel-strike/shared';
import type { HeroPreviewAnimationMode } from './HeroPreviewCanvas';
import { HeroIcon } from './HeroIcons';
import { getHeroSkillItems, HeroSkillIcon, type HeroSkillItem } from './HeroSkillKit';
import { ABILITY_COLORS, HERO_COLORS } from '../../styles/colorTokens';

const FeaturedHeroPreview = lazy(() => import('./FeaturedHeroPreview').then((module) => ({
  default: module.FeaturedHeroPreview,
})));
const HERO_IDLE_ANIMATION_MODE: HeroPreviewAnimationMode = 'idle';

const SIDE_STACK_CLASS = 'flex flex-col gap-1.5 xl:gap-2';
const GLASS_CARD_STYLE = {
  backdropFilter: 'blur(12px) saturate(1.12)',
  WebkitBackdropFilter: 'blur(12px) saturate(1.12)',
} satisfies CSSProperties;

interface HeroesPageProps {
  selectedHero: HeroId;
  onSelectHero: (heroId: HeroId) => void;
}

export function HeroesPage({ selectedHero, onSelectHero }: HeroesPageProps) {
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
                onClick={() => onSelectHero(heroId)}
                className="group w-full relative overflow-hidden rounded-lg text-left"
                style={{
                  ...GLASS_CARD_STYLE,
                  background: isSelected
                    ? `linear-gradient(135deg, ${color}2b, rgb(var(--color-strike-surface) / 0.52) 62%)`
                    : 'linear-gradient(135deg, rgba(255,255,255,0.045), rgb(var(--color-strike-surface) / 0.42))',
                  border: isSelected ? `1px solid ${color}b5` : '1px solid rgba(255,255,255,0.13)',
                  boxShadow: isSelected
                    ? `0 12px 32px rgba(0,0,0,0.18), 0 0 22px ${color}28, inset 0 1px 0 rgba(255,255,255,0.1)`
                    : '0 10px 28px rgba(0,0,0,0.13), inset 0 1px 0 rgba(255,255,255,0.07)',
                }}
              >
                <div className="relative flex items-center gap-3 p-2.5">
                  <div
                    className="w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{
                      background: isSelected ? color : 'rgba(255,255,255,0.07)',
                    }}
                  >
                    <HeroIcon heroId={heroId} size={23} color="#ffffff" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3
                      className="font-display text-[15px] truncate leading-none"
                      style={{ color: isSelected ? 'white' : 'rgba(255,255,255,0.78)' }}
                    >
                      {hero.name.toUpperCase()}
                    </h3>
                    <div className="mt-1.5 flex items-center">
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
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-w-0 flex flex-col items-center justify-center relative">
        <div className="relative flex flex-col items-center menu-compact-scale">
          <Suspense fallback={null}>
            <FeaturedHeroPreview
              heroId={selectedHero}
              accentColor={heroColor}
              initialYaw={Math.PI - 0.18}
              animationMode={HERO_IDLE_ANIMATION_MODE}
            />
          </Suspense>

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
    <div className="rounded-lg border border-white/10 bg-strike-surface/45 px-3.5 py-2.5 text-center shadow-[0_10px_26px_rgba(0,0,0,0.16),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md">
      <span className="block font-display text-2xl text-white leading-none">{value}</span>
      <span className="mt-0.5 block text-[9px] text-white/45 font-mono uppercase tracking-[0.22em]">{label}</span>
    </div>
  );
}

function AbilityCard({ item, color }: { item: HeroSkillItem; color: string }) {
  const isClick = item.tone === 'click';
  const isUltimate = item.tone === 'ultimate';
  const metaPills = getMetaPills(item);

  return (
    <div
      className="relative overflow-hidden rounded-lg"
      style={{
        ...GLASS_CARD_STYLE,
        background: isUltimate
          ? `linear-gradient(135deg, ${ABILITY_COLORS.ultimatePanelStart}, rgb(var(--color-strike-surface) / 0.46) 66%)`
          : isClick
            ? `linear-gradient(135deg, ${color}18, rgb(var(--color-strike-surface) / 0.46) 58%)`
            : 'linear-gradient(135deg, rgba(255,255,255,0.038), rgb(var(--color-strike-surface) / 0.4))',
        border: '1px solid rgba(255,255,255,0.13)',
        boxShadow: isUltimate
          ? `0 12px 34px rgba(0,0,0,0.2), 0 0 22px ${ABILITY_COLORS.ultimateGlow}, inset 0 1px 0 rgba(255,255,255,0.1)`
          : '0 12px 30px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.08)',
      }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-white/15" />
      <div
        className="absolute inset-y-0 left-0 w-px opacity-70"
        style={{
          background: `linear-gradient(180deg, transparent, ${isUltimate ? ABILITY_COLORS.ultimate : color}66, transparent)`,
        }}
      />
      <div className="relative p-3">
        <div className="flex items-start gap-3">
          <HeroSkillIcon item={item} color={color} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <InputTag color={isUltimate ? ABILITY_COLORS.ultimate : color}>{item.input}</InputTag>
              <h4 className="font-display text-white text-[15px] leading-none truncate">{item.name}</h4>
            </div>
            <p className="mt-1 text-white/70 text-[11px] font-body leading-snug">{item.description}</p>

            {metaPills.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {metaPills.map((pill) => (
                  <MetaPill key={pill} color={isUltimate ? ABILITY_COLORS.ultimate : color}>{pill}</MetaPill>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function getMetaPills(item: HeroSkillItem): string[] {
  const pills: string[] = [];
  const suppressCooldown = item.input === 'LMB';
  const cooldown = item.cooldown ?? 0;
  const duration = item.duration ?? 0;
  const charges = item.charges ?? 0;
  const chargeRegenTime = item.chargeRegenTime ?? cooldown;

  if (charges > 1) {
    pills.push(`${charges} charges`);
    if (chargeRegenTime > 0) {
      pills.push(`${formatSecondsValue(chargeRegenTime)} cd`);
    }
  } else if (!suppressCooldown && cooldown > 0) {
    pills.push(`${formatSecondsValue(cooldown)} cd`);
  }

  if (duration > 0) {
    pills.push(`${formatSecondsValue(duration)} active`);
  }

  return [...pills, ...(item.meta ?? [])];
}

function InputTag({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span
      className="shrink-0 rounded-md px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-white"
      style={{
        background: `${color}22`,
        border: `1px solid ${color}70`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
      }}
    >
      {children}
    </span>
  );
}

function MetaPill({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span
      className="rounded-md px-2 py-0.5 text-[9px] font-mono font-medium text-white/80"
      style={{
        background: `${color}18`,
        border: `1px solid ${color}4f`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      {children}
    </span>
  );
}

function formatSecondsValue(seconds: number) {
  return `${seconds < 1 ? seconds.toFixed(2).replace(/0$/, '') : seconds.toFixed(seconds % 1 === 0 ? 0 : 1)}s`;
}
