import { DEFAULT_GAME_CONFIG } from '@voxel-strike/shared';
import { useEffect } from 'react';
import { useNetwork } from '../../contexts/NetworkContext';
import { useAudio, useUISounds } from '../../hooks/useAudio';
import { useGameStore } from '../../store/gameStore';
import { LobbyBackdrop } from './LobbyBackdrop';

export function MatchmakingScreen() {
  const { playerName, lobbyPlayers } = useGameStore();
  const { leaveLobby } = useNetwork();
  const { playButtonClick } = useUISounds();
  const { preloadSoundGroup } = useAudio();
  const humanCount = Array.from(lobbyPlayers.values()).filter((player) => !player.isBot).length;
  const requiredPlayers = DEFAULT_GAME_CONFIG.maxPlayers;
  const filledSlots = Math.min(humanCount, requiredPlayers);

  useEffect(() => {
    preloadSoundGroup('lobby');
  }, [preloadSoundGroup]);

  const handleCancel = () => {
    playButtonClick();
    leaveLobby();
  };

  return (
    <div className="menu-screen bg-strike-bg">
      <LobbyBackdrop />

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(249,115,22,0.18),transparent_34%),linear-gradient(to_bottom,rgba(6,10,20,0.22),rgba(4,6,14,0.82))]" />
      <div className="absolute inset-0 pattern-grid opacity-20" />

      <main className="relative z-10 flex h-full items-center justify-center px-5">
        <section className="w-full max-w-xl text-center">
          <p className="mb-3 font-body text-xs uppercase tracking-[0.32em] text-orange-200/70">
            Quick Play
          </p>
          <h1 className="font-display text-4xl leading-none text-white sm:text-5xl lg:text-6xl">
            MATCHMAKING
          </h1>
          <p className="mx-auto mt-4 max-w-md font-body text-sm leading-relaxed text-white/50 sm:text-base">
            {playerName ? `${playerName}, hold tight.` : 'Hold tight.'} Building a full match squad.
          </p>

          <div className="mt-10">
            <div className="mb-4 flex items-center justify-between font-display text-sm text-white/60">
              <span>PLAYERS FOUND</span>
              <span className="text-white">{filledSlots}/{requiredPlayers}</span>
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
    </div>
  );
}
