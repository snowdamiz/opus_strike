import { DEFAULT_GAME_CONFIG } from '@voxel-strike/shared';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { config } from '../../config/environment';
import { useNetwork } from '../../contexts/NetworkContext';
import { useAudio } from '../../hooks/useAudio';
import { useUISounds } from '../../hooks/useUiAudio';
import { useGameStore } from '../../store/gameStore';
import { LobbyBackdrop } from './LobbyBackdrop';
import { RankIcon, getRankForStats } from './RankBadge';

function getHttpUrl(): string {
  return config.serverUrl.replace('ws://', 'http://').replace('wss://', 'https://');
}

const MIN_RANK_SEARCH_DISTANCE = 2;
const RANKED_TOKEN_HOLD_LABEL = '$20 SOL';

export function MatchmakingScreen() {
  const { playerName, currentLobbyWager, lobbyPlayers, userStats, matchmakingStatus } = useGameStore(
    useShallow((state) => ({
      playerName: state.playerName,
      currentLobbyWager: state.currentLobbyWager,
      lobbyPlayers: state.lobbyPlayers,
      userStats: state.userStats,
      matchmakingStatus: state.matchmakingStatus,
    }))
  );
  const { leaveLobby } = useNetwork();
  const { playButtonClick } = useUISounds();
  const { preloadSoundGroup } = useAudio();
  const isRanked = matchmakingStatus.matchMode === 'ranked' || currentLobbyWager.matchMode === 'ranked';
  const humanCount = Array.from(lobbyPlayers.values()).filter((player) => !player.isBot).length;
  const provisionalHumanCount = isRanked
    ? Math.max(0, matchmakingStatus.provisionalHumanCount ?? 0)
    : 0;
  const requiredPlayers = matchmakingStatus.requiredPlayers ?? DEFAULT_GAME_CONFIG.maxPlayers;
  const filledSlots = Math.min(isRanked ? (matchmakingStatus.queuedHumanCount ?? humanCount) : humanCount, requiredPlayers);
  const [totalPlayersInQueue, setTotalPlayersInQueue] = useState(filledSlots);
  const displayedQueueCount = Math.max(totalPlayersInQueue, filledSlots);
  const queuePlayerLabel = displayedQueueCount === 1 ? 'player' : 'players';
  const capacityBlocked = matchmakingStatus.capacityBlocked;
  const currentRank = getRankForStats(userStats);
  const searchLabel = matchmakingStatus.averageVisibleRank
    ?? matchmakingStatus.rankBandLabel
    ?? currentRank.label;
  const displayedRankSearchDistance = Math.max(
    MIN_RANK_SEARCH_DISTANCE,
    matchmakingStatus.rankSearchDistance ?? MIN_RANK_SEARCH_DISTANCE
  );

  useEffect(() => {
    preloadSoundGroup('lobby');
  }, [preloadSoundGroup]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let activeController: AbortController | null = null;

    const fetchQueueStatus = async () => {
      if (inFlight) return;
      inFlight = true;
      const controller = new AbortController();
      activeController = controller;
      const timeoutId = window.setTimeout(() => controller.abort(), 4000);

      try {
        const response = await fetch(`${getHttpUrl()}/matchmaking/queue-status${isRanked ? '?mode=ranked' : ''}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!response.ok) return;

        const data = await response.json();
        if (!cancelled && typeof data.totalPlayersInQueue === 'number') {
          setTotalPlayersInQueue(Math.max(0, data.totalPlayersInQueue));
        }
      } catch {
        // Keep the last known count if the status request misses a beat.
      } finally {
        window.clearTimeout(timeoutId);
        if (activeController === controller) {
          activeController = null;
        }
        inFlight = false;
      }
    };

    fetchQueueStatus();
    const intervalId = window.setInterval(fetchQueueStatus, 2000);

    return () => {
      cancelled = true;
      activeController?.abort();
      window.clearInterval(intervalId);
    };
  }, [isRanked]);

  const handleCancel = () => {
    playButtonClick();
    leaveLobby();
  };

  return (
    <div className="menu-screen bg-strike-bg">
      <LobbyBackdrop />

      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(circle at 50% 42%, rgb(var(--color-accent-primary) / 0.18), transparent 34%), linear-gradient(to bottom, rgb(var(--color-accent-secondary) / 0.22), rgb(var(--color-strike-page-bottom) / 0.82))',
        }}
      />
      <div className="absolute inset-0 pattern-grid opacity-20" />

      <main className="relative z-10 flex h-full items-center justify-center px-5">
        <section className="w-full max-w-xl text-center">
          <p className="mb-3 font-body text-xs uppercase tracking-[0.32em] text-orange-200/70">
            {isRanked ? 'Ranked' : 'Quick Play'}
          </p>
          <h1 className="font-display text-4xl leading-none text-white sm:text-5xl lg:text-6xl">
            MATCHMAKING
          </h1>
          <p className="mx-auto mt-4 max-w-md font-body text-sm leading-relaxed text-white/50 sm:text-base">
            {capacityBlocked
              ? 'Servers are full. Your squad will launch when a match frees space.'
              : isRanked
              ? `${playerName ? `${playerName}, ` : ''}SOL holding verified. Finding a ranked squad.`
              : `${playerName ? `${playerName}, hold tight.` : 'Hold tight.'} Building a full match squad.`}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <RankIcon rank={currentRank} size={30} labelled />
            <span className="font-body text-xs uppercase tracking-wider text-white/40">
              Searching near {searchLabel} +/-{displayedRankSearchDistance}
            </span>
          </div>

          {isRanked && (
            <div className="mx-auto mt-7 max-w-md border border-amber-300/18 bg-black/35 p-4 text-left backdrop-blur-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-body text-xs uppercase tracking-[0.22em] text-amber-200/55">Access</p>
                  <p className="mt-1 font-display text-2xl text-amber-100">
                    {RANKED_TOKEN_HOLD_LABEL}
                  </p>
                  <p className="mt-1 font-body text-xs text-white/35">Holding requirement verified</p>
                </div>
                <span className="border border-white/10 bg-white/5 px-2.5 py-1 font-display text-xs uppercase text-white/70">
                  queued
                </span>
              </div>
            </div>
          )}

          <div className="mt-10">
            <div className="mb-4 flex items-center justify-between font-display text-sm text-white/60">
              <span>{isRanked ? 'PLAYERS QUEUED' : 'PLAYERS FOUND'}</span>
              {isRanked && provisionalHumanCount > 0 && (
                <span>{provisionalHumanCount} joining</span>
              )}
            </div>

            <div className="grid grid-cols-8 gap-2">
              {Array.from({ length: requiredPlayers }, (_, index) => {
                const filled = index < filledSlots;
                const isSearchingSlot = index === filledSlots && filledSlots < requiredPlayers;
                return (
                  <div
                    key={index}
                    className={`relative h-3 overflow-hidden rounded-full border transition-colors ${
                      filled
                        ? 'border-orange-300/80 bg-orange-400 shadow-[0_0_18px_rgba(251,146,60,0.55)]'
                        : isSearchingSlot
                          ? 'animate-pulse-soft border-orange-300/40 bg-orange-500/10 shadow-[0_0_14px_rgba(251,146,60,0.22)]'
                        : 'border-white/10 bg-white/5'
                    }`}
                  >
                    {filled && (
                      <span className="absolute inset-y-0 left-0 w-full animate-shimmer bg-gradient-to-r from-transparent via-white/45 to-transparent" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-10 flex justify-center">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-xl border border-white/10 bg-white/5 px-8 py-3 font-display text-sm text-white/70 transition hover:border-white/25 hover:bg-white/10 hover:text-white"
            >
              CANCEL
            </button>
          </div>
        </section>
      </main>

      <div className="absolute inset-x-0 bottom-6 z-10 flex justify-center px-5">
        <p className="font-display text-sm uppercase tracking-[0.22em] text-white/65">
          {displayedQueueCount} {queuePlayerLabel} in queue
        </p>
      </div>
    </div>
  );
}
