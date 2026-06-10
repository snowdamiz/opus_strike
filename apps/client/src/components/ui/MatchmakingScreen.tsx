import { DEFAULT_GAME_CONFIG } from '@voxel-strike/shared';
import { useEffect, useState } from 'react';
import { config } from '../../config/environment';
import { useNetwork } from '../../contexts/NetworkContext';
import { useWallet } from '../../contexts/WalletContext';
import { useAudio, useUISounds } from '../../hooks/useAudio';
import { useGameStore } from '../../store/gameStore';
import { deserializeWagerPaymentTransaction, lamportsToSolDisplay } from '../../utils/wagerPayments';
import { LobbyBackdrop } from './LobbyBackdrop';
import { RankBadge, getRankForStats } from './RankBadge';

function getHttpUrl(): string {
  return config.serverUrl.replace('ws://', 'http://').replace('wss://', 'https://');
}

export function MatchmakingScreen() {
  const { playerName, playerId, currentLobbyId, currentLobbyWager, lobbyPlayers, userStats, matchmakingStatus } = useGameStore();
  const {
    leaveLobby,
    createWagerPaymentIntent,
    createWagerPaymentTransaction,
    submitWagerSignedPaymentTransaction,
  } = useNetwork();
  const {
    walletAddress,
    isConnected: isWalletConnected,
    connect: connectWallet,
    signTransaction,
  } = useWallet();
  const { playButtonClick } = useUISounds();
  const { preloadSoundGroup } = useAudio();
  const currentPlayer = playerId ? lobbyPlayers.get(playerId) ?? null : null;
  const isRanked = matchmakingStatus.matchMode === 'ranked' || currentLobbyWager.matchMode === 'ranked';
  const humanCount = Array.from(lobbyPlayers.values()).filter((player) => !player.isBot).length;
  const paidHumanCount = Array.from(lobbyPlayers.values()).filter((player) => (
    !player.isBot && (player.paymentStatus === 'credited' || player.paymentStatus === 'settled')
  )).length;
  const provisionalHumanCount = isRanked
    ? Math.max(0, matchmakingStatus.provisionalHumanCount ?? humanCount - paidHumanCount)
    : 0;
  const requiredPlayers = matchmakingStatus.requiredPlayers ?? DEFAULT_GAME_CONFIG.maxPlayers;
  const filledSlots = Math.min(isRanked ? (matchmakingStatus.queuedHumanCount ?? paidHumanCount) : humanCount, requiredPlayers);
  const [totalPlayersInQueue, setTotalPlayersInQueue] = useState(filledSlots);
  const displayedQueueCount = Math.max(totalPlayersInQueue, filledSlots);
  const queuePlayerLabel = displayedQueueCount === 1 ? 'player' : 'players';
  const currentRank = getRankForStats(userStats);
  const searchLabel = matchmakingStatus.averageVisibleRank
    ?? matchmakingStatus.rankBandLabel
    ?? currentRank.label;
  const [isPaying, setIsPaying] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const localPaymentStatus = currentPlayer?.paymentStatus || '';
  const localPlayerPaid = localPaymentStatus === 'credited' || localPaymentStatus === 'settled';
  const localPlayerPending = localPaymentStatus === 'intent_created' || localPaymentStatus === 'submitted' || localPaymentStatus === 'confirmed';
  const localPlayerRefunding = localPaymentStatus === 'refunding';
  const localPlayerRefunded = localPaymentStatus === 'refunded';
  const rankedCoverChargeLamports = currentLobbyWager.coverChargeLamports ?? matchmakingStatus.rankedCoverChargeLamports ?? undefined;
  const rankedQuoteExpiration = currentLobbyWager.rankedEntryQuoteExpiresAt
    ? new Date(currentLobbyWager.rankedEntryQuoteExpiresAt)
    : null;
  const rankedQuoteExpirationLabel = rankedQuoteExpiration && Number.isFinite(rankedQuoteExpiration.getTime())
    ? rankedQuoteExpiration.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;
  const rankedStateLabel = localPlayerRefunded
    ? 'refunded'
    : localPlayerRefunding
      ? 'refunding'
      : localPlayerPaid
        ? 'queued'
        : isPaying || localPlayerPending
          ? 'confirming payment'
          : 'payment required';

  useEffect(() => {
    preloadSoundGroup('lobby');
  }, [preloadSoundGroup]);

  useEffect(() => {
    let cancelled = false;

    const fetchQueueStatus = async () => {
      try {
        const response = await fetch(`${getHttpUrl()}/matchmaking/queue-status${isRanked ? '?mode=ranked' : ''}`, {
          credentials: 'include',
        });
        if (!response.ok) return;

        const data = await response.json();
        if (!cancelled && typeof data.totalPlayersInQueue === 'number') {
          setTotalPlayersInQueue(Math.max(0, data.totalPlayersInQueue));
        }
      } catch {
        // Keep the last known count if the status request misses a beat.
      }
    };

    fetchQueueStatus();
    const intervalId = window.setInterval(fetchQueueStatus, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isRanked]);

  const handleCancel = () => {
    playButtonClick();
    leaveLobby();
  };

  const handlePayEntry = async () => {
    if (!currentLobbyId || !currentPlayer || !isRanked || isPaying || localPlayerPaid || localPlayerRefunding) return;
    setPaymentError(null);
    setIsPaying(true);

    try {
      let payerWallet = walletAddress;
      if (!isWalletConnected || !walletAddress) {
        payerWallet = await connectWallet();
      }
      if (!payerWallet) {
        throw new Error('Connect Phantom before paying');
      }

      const intent = await createWagerPaymentIntent(
        currentLobbyId,
        payerWallet,
        currentPlayer.id,
        currentLobbyWager.rankedEntryQuoteId ?? matchmakingStatus.rankedEntryQuoteId
      );
      const paymentTransaction = await createWagerPaymentTransaction(intent.intentId);
      const transaction = deserializeWagerPaymentTransaction(paymentTransaction.transactionBase64);
      const signedTransactionBase64 = await signTransaction(transaction);
      await submitWagerSignedPaymentTransaction(intent.intentId, signedTransactionBase64);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Payment failed');
    } finally {
      setIsPaying(false);
    }
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
            {isRanked
              ? localPlayerPaid
                ? `${playerName ? `${playerName}, ` : ''}entry confirmed.`
                : 'Confirm entry to take a ranked queue slot.'
              : `${playerName ? `${playerName}, hold tight.` : 'Hold tight.'} Building a full match squad.`}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <RankBadge rank={currentRank} />
            <span className="font-body text-xs uppercase tracking-wider text-white/40">
              Searching near {searchLabel}
              {matchmakingStatus.rankSearchDistance !== null ? ` +/-${matchmakingStatus.rankSearchDistance}` : ''}
            </span>
          </div>

          {isRanked && (
            <div className="mx-auto mt-7 max-w-md border border-amber-300/18 bg-black/35 p-4 text-left backdrop-blur-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-body text-xs uppercase tracking-[0.22em] text-amber-200/55">Entry</p>
                  <p className="mt-1 font-display text-2xl text-amber-100">
                    {rankedCoverChargeLamports ? `${lamportsToSolDisplay(rankedCoverChargeLamports)} SOL` : '$5 SOL'}
                  </p>
                  {rankedQuoteExpirationLabel && (
                    <p className="mt-1 font-body text-xs text-white/35">Quote expires {rankedQuoteExpirationLabel}</p>
                  )}
                </div>
                <span className="border border-white/10 bg-white/5 px-2.5 py-1 font-display text-xs uppercase text-white/70">
                  {rankedStateLabel}
                </span>
              </div>
              {!localPlayerPaid && !localPlayerRefunding && !localPlayerRefunded && (
                <button
                  type="button"
                  onClick={handlePayEntry}
                  disabled={isPaying || localPlayerPending}
                  className="mt-4 h-11 w-full border border-amber-300/35 bg-amber-400/15 font-display text-sm text-amber-50 transition hover:bg-amber-400/25 disabled:opacity-60"
                >
                  {isPaying ? 'AWAITING SIGNATURE' : localPlayerPending ? 'CONFIRMING PAYMENT' : 'PAY ENTRY'}
                </button>
              )}
              {paymentError && (
                <p className="mt-3 font-body text-xs text-red-300">{paymentError}</p>
              )}
            </div>
          )}

          <div className="mt-10">
            <div className="mb-4 flex items-center justify-between font-display text-sm text-white/60">
              <span>{isRanked ? 'PAID PLAYERS QUEUED' : 'PLAYERS FOUND'}</span>
              {isRanked && provisionalHumanCount > 0 && (
                <span>{provisionalHumanCount} confirming</span>
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
          {displayedQueueCount} {queuePlayerLabel} {isRanked ? 'paid in queue' : 'in queue'}
        </p>
      </div>
    </div>
  );
}
