import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { HERO_DEFINITIONS, ALL_HERO_IDS, getPickedTeamHeroIds } from '@voxel-strike/shared';
import type { HeroId } from '@voxel-strike/shared';
import { useShallow } from 'zustand/shallow';
import { useGameStore } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';
import { useUISounds } from '../../hooks/useAudio';
import { HeroPreviewCanvas } from './HeroPreviewCanvas';
import { HERO_COLORS } from '../../styles/colorTokens';
import { PhaseCountdownTimer } from './PhaseCountdownTimer';

export function HeroSelect() {
  const {
    localHeroId,
    localIsReady,
    localPlayerId,
    localTeam,
    players,
    phaseEndTime,
    isPracticeMode,
  } = useGameStore(
    useShallow((state) => ({
      localHeroId: state.localPlayer?.heroId ?? null,
      localIsReady: state.localPlayer?.isReady ?? false,
      localPlayerId: state.localPlayer?.id ?? null,
      localTeam: state.localPlayer?.team ?? null,
      players: state.players,
      phaseEndTime: state.phaseEndTime,
      isPracticeMode: state.isPracticeMode,
    }))
  );
  const { selectHero, setReady, leaveGame } = useNetwork();
  const { playButtonClick } = useUISounds();
  const [selectedHero, setSelectedHero] = useState<HeroId>('phantom');
  const [isLockedIn, setIsLockedIn] = useState(false);

  useEffect(() => {
    if (!localHeroId) return;
    setSelectedHero((current) => (current === localHeroId ? current : localHeroId));
  }, [localHeroId]);

  useEffect(() => {
    setIsLockedIn(localIsReady);
  }, [localIsReady]);

  const lockedHeroIds = useMemo(() => {
    if (isPracticeMode || !localPlayerId || (localTeam !== 'red' && localTeam !== 'blue')) {
      return EMPTY_HERO_LOCKS;
    }

    return getPickedTeamHeroIds(players.values(), localTeam, localPlayerId);
  }, [isPracticeMode, localPlayerId, localTeam, players]);

  const firstAvailableHero = useMemo(
    () => ALL_HERO_IDS.find((heroId) => !lockedHeroIds.has(heroId)) ?? null,
    [lockedHeroIds]
  );
  const isSelectedHeroLocked = lockedHeroIds.has(selectedHero);

  useEffect(() => {
    if (isLockedIn || !isSelectedHeroLocked || !firstAvailableHero || firstAvailableHero === selectedHero) return;
    setSelectedHero(firstAvailableHero);
  }, [firstAvailableHero, isLockedIn, isSelectedHeroLocked, selectedHero]);

  const accentColor = HERO_COLORS[selectedHero];

  const isHeroUnavailable = useCallback((heroId: HeroId) => {
    return lockedHeroIds.has(heroId);
  }, [lockedHeroIds]);

  const handleSelectHero = useCallback((heroId: HeroId) => {
    if (isLockedIn || heroId === selectedHero || isHeroUnavailable(heroId)) return;
    setSelectedHero(heroId);
    selectHero(heroId);
  }, [isHeroUnavailable, isLockedIn, selectedHero, selectHero]);

  const commitSelectedHero = useCallback(() => {
    if (!selectedHero || isLockedIn) return;
    const heroToLock = isSelectedHeroLocked ? firstAvailableHero : selectedHero;
    if (!heroToLock || isHeroUnavailable(heroToLock)) return;

    setSelectedHero(heroToLock);
    selectHero(heroToLock);
    setIsLockedIn(true);
    setReady(true);
  }, [firstAvailableHero, isHeroUnavailable, isLockedIn, isSelectedHeroLocked, selectHero, selectedHero, setReady]);

  const handleLockIn = useCallback(() => {
    commitSelectedHero();
  }, [commitSelectedHero]);

  const handleTimerExpired = useCallback(() => {
    commitSelectedHero();
  }, [commitSelectedHero]);

  const handleHeroCardClick = useCallback((heroId: HeroId) => {
    if (isHeroUnavailable(heroId)) return;
    handleSelectHero(heroId);
    playButtonClick();
  }, [handleSelectHero, isHeroUnavailable, playButtonClick]);

  return (
    <div className="menu-screen bg-strike-bg">
      {/* Cinematic Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: 'url(/bg.jpg)' }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to bottom, rgb(var(--color-strike-page-top) / 0.86), rgb(var(--color-strike-page-mid) / 0.82), rgb(var(--color-strike-page-bottom) / 0.95))',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse 58% 48% at 50% 54%, ${accentColor}24 0%, transparent 72%)`,
          }}
        />
        <div className="absolute inset-0 pattern-grid opacity-10" />
        <div
          className="absolute bottom-0 left-0 right-0 h-2/5"
          style={{
            background: 'linear-gradient(to top, rgb(var(--color-strike-page-top)), transparent)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{ boxShadow: 'inset 0 0 200px 80px rgba(0,0,0,0.7)' }}
        />
      </div>

      {/* Top Navigation Bar */}
      <nav className="absolute top-0 left-0 right-0 z-20">
        <div className="menu-nav relative flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3 xl:gap-4">
            <button
              type="button"
              aria-label="Leave hero select"
              title="Leave"
              onClick={() => { playButtonClick(); leaveGame(); }}
              className="menu-back-button"
            >
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div className="min-w-0">
              <h1 className="font-display text-xl leading-none text-white tracking-wide xl:text-2xl">
                CHOOSE YOUR <span style={{ color: accentColor }}>HERO</span>
              </h1>
            </div>
          </div>

          {!isPracticeMode && (
            <PhaseCountdownTimer
              phaseEndTime={phaseEndTime}
              disabled={isLockedIn}
              onExpired={handleTimerExpired}
            />
          )}

          <div className="flex shrink-0 items-center gap-3 xl:gap-4">
            <button
              type="button"
              onClick={() => { playButtonClick(); handleLockIn(); }}
              disabled={isLockedIn}
              className={`relative h-10 min-w-[7.5rem] overflow-hidden rounded-xl px-5 font-display text-sm uppercase tracking-wide transition-all ${
                isLockedIn
                  ? 'border border-green-500/30 bg-green-500/20 text-green-400'
                  : 'border border-white/10 text-white hover:border-white/30'
              }`}
              style={!isLockedIn ? {
                background: `linear-gradient(135deg, ${accentColor}, ${accentColor}dd)`,
                boxShadow: `0 0 32px ${accentColor}34`,
              } : undefined}
            >
              <span className="relative flex items-center justify-center gap-2">
                {isLockedIn ? (
                  <>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    Locked
                  </>
                ) : (
                  'Lock In'
                )}
              </span>
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="menu-main">
        <div className="menu-content-wide menu-scroll-y flex h-full items-center justify-center py-4">
          <div className="hero-select-stage menu-compact-scale">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:gap-4 xl:gap-5">
              {ALL_HERO_IDS.map((heroId) => {
                const hero = HERO_DEFINITIONS[heroId];
                const color = HERO_COLORS[heroId];
                const isSelected = selectedHero === heroId;
                const isUnavailable = isHeroUnavailable(heroId);

                return (
                  <HeroCard
                    key={heroId}
                    heroId={heroId}
                    hero={hero}
                    color={color}
                    isSelected={isSelected}
                    isLockedIn={isLockedIn}
                    isUnavailable={isUnavailable}
                    onSelect={handleHeroCardClick}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

type HeroDefinition = (typeof HERO_DEFINITIONS)[HeroId];
const EMPTY_HERO_LOCKS = new Set<HeroId>();

const HeroCard = memo(function HeroCard({
  heroId,
  hero,
  color,
  isSelected,
  isLockedIn,
  isUnavailable,
  onSelect,
}: {
  heroId: HeroId;
  hero: HeroDefinition;
  color: string;
  isSelected: boolean;
  isLockedIn: boolean;
  isUnavailable: boolean;
  onSelect: (heroId: HeroId) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={() => onSelect(heroId)}
      disabled={isLockedIn || isUnavailable}
      title={isUnavailable ? 'Picked by teammate' : hero.name}
      className={`group relative aspect-[3/4] w-full overflow-hidden rounded-xl border text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-default ${
        (isLockedIn && !isSelected) || isUnavailable ? 'opacity-30' : ''
      }`}
      style={{
        background: isSelected
          ? `linear-gradient(160deg, ${color}22, ${color}08 48%, rgb(var(--color-strike-canvas) / 0.96))`
          : 'linear-gradient(160deg, rgb(var(--color-strike-panel-raised) / 0.78), rgb(var(--color-strike-canvas) / 0.9))',
        borderColor: isSelected ? color : 'rgba(255,255,255,0.075)',
        boxShadow: isSelected
          ? `0 0 34px ${color}2f, 0 16px 36px rgba(0,0,0,0.42), inset 0 1px 0 ${color}32`
          : '0 12px 30px rgba(0,0,0,0.32)',
      }}
    >
      <div
        className={`absolute inset-0 ${isSelected ? 'opacity-70' : 'opacity-0 group-hover:opacity-30'}`}
        style={{ background: `radial-gradient(ellipse at 50% 30%, ${color}34, transparent 62%)` }}
      />

      <div className="absolute inset-0 flex items-center justify-center">
          <HeroPreviewCanvas
            heroId={heroId}
            accentColor={color}
            size="card"
            interactive={false}
            idleRotation={false}
            idleAnimation={isSelected}
            showShadow={isSelected}
          className="h-full w-full"
        />
      </div>

      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-strike-chrome via-strike-chrome/80 to-transparent" />

      <div className="absolute inset-0 flex flex-col justify-between p-3.5 xl:p-4">
        <div className="flex items-start justify-between gap-3">
          <div
            className="rounded-lg border px-2.5 py-1 font-display text-[10px] uppercase tracking-wider"
            style={{
              background: `${color}22`,
              borderColor: `${color}35`,
              color,
            }}
          >
            {hero.role}
          </div>

          {isSelected && (
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: `linear-gradient(135deg, ${color}, ${color}cc)`,
                boxShadow: `0 4px 15px ${color}50`,
              }}
            >
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
          {isUnavailable && (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/45 text-white/65">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M16.5 10V7.5a4.5 4.5 0 00-9 0V10" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M6.5 10h11v10h-11V10z" />
              </svg>
            </div>
          )}
        </div>

        <div>
          <h3
            className="font-display text-xl leading-none text-white xl:text-2xl"
            style={{ textShadow: isSelected ? `0 0 20px ${color}80` : 'none' }}
          >
            {hero.name.toUpperCase()}
          </h3>
          <p className="mt-1 text-xs font-body capitalize text-white/40">
            {hero.movementFocus} specialist
          </p>
        </div>
      </div>
    </button>
  );
});
