import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Coins, Package } from 'lucide-react';
import {
  getHeroSkinDefinition,
  type HeroSkinDefinition,
  type HeroSkinId,
  type LootboxOpenIntentSnapshot,
  type LootboxStateResponse,
} from '@voxel-strike/shared';
import { useWallet } from '../../contexts/WalletContext';
import {
  buildLootboxOpenTransaction,
  createLootboxOpenIntent,
  getLootboxOpenIntent,
  openLootboxWithFreeCredit,
  requestLootboxState,
  submitSignedLootboxOpenTransaction,
  updateHeroSkinLoadout,
} from '../../contexts/networkApi';
import { transactionFromBase64 } from '../../utils/solanaTransactions';
import {
  clearPendingLootboxOpen,
  loadPendingLootboxOpen,
  resolvePendingLootboxOpen,
  savePendingLootboxOpen,
} from '../../utils/pendingLootboxOpen';
import { LOOTBOX_UI_COLORS } from '../../styles/colorTokens';
import { GameDialog } from './GameDialog';
import { SkinRarityChrome } from './SkinRarityChrome';

const HeroPreviewCanvas = lazy(() => import('./HeroPreviewCanvas').then((module) => ({
  default: module.HeroPreviewCanvas,
})));

// Reveal ceremony pacing: the crate charges up, then bursts apart before the
// result dialog appears. Burst is slightly shorter than its 0.9s flash so the
// dialog lands while the bloom is still fading.
const REVEAL_CHARGE_MS = 1500;
const REVEAL_BURST_MS = 850;

type RevealedReward =
  | { kind: 'skin'; skin: HeroSkinDefinition }
  | { kind: 'game_token'; source: 'duplicate'; skin: HeroSkinDefinition; amountTokens: string; tokenSymbol: string }
  | { kind: 'game_token'; source: 'direct'; amountTokens: string; tokenSymbol: string };

type RevealCeremony = {
  reward: RevealedReward;
  stage: 'charging' | 'burst';
};

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Mostly forge-orange with occasional rarity hints (violet/cyan/gold) drifting up.
const CRATE_EMBERS = Array.from({ length: 18 }, (_, index) => ({
  left: `${18 + ((index * 41) % 64)}%`,
  size: `${3 + ((index * 13) % 3)}px`,
  delay: `${((index * 47) % 90) / 10}s`,
  duration: `${4.6 + ((index * 29) % 45) / 10}s`,
  color: LOOTBOX_UI_COLORS.embers[index % LOOTBOX_UI_COLORS.embers.length],
  drift: `${(((index * 67) % 56) - 28) / 14}rem`,
}));

// Drives the staggered entrance of the reveal card's copy (see
// .crate-reveal-item in index.css).
function revealItemStyle(order: number): CSSProperties {
  return { '--reveal-i': order } as CSSProperties;
}

function formatTokenSymbol(symbol?: string | null): string {
  const cleaned = symbol?.trim();
  if (!cleaned) return '';
  return cleaned.startsWith('$') ? cleaned : `$${cleaned}`;
}

function formatWholeTokens(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString('en-US') : value;
}

function revealedRewardFromIntent(intent: LootboxOpenIntentSnapshot): RevealedReward {
  if (intent.resultKind === 'game_token') {
    if (!intent.resultTokenAmount) throw new Error('Crate token reward amount is missing');
    if (!intent.resultSkinId) {
      return {
        kind: 'game_token',
        source: 'direct',
        amountTokens: intent.resultTokenAmount,
        tokenSymbol: intent.tokenSymbol,
      };
    }
    return {
      kind: 'game_token',
      source: 'duplicate',
      skin: getHeroSkinDefinition(intent.resultSkinId),
      amountTokens: intent.resultTokenAmount,
      tokenSymbol: intent.tokenSymbol,
    };
  }
  if (!intent.resultSkinId) throw new Error('Crate reward is missing');
  return { kind: 'skin', skin: getHeroSkinDefinition(intent.resultSkinId) };
}

export function CratesTab({
  isAuthenticated,
  onLogin,
  onInventoryChanged,
}: {
  isAuthenticated: boolean;
  onLogin: () => void;
  onInventoryChanged: () => Promise<void> | void;
}) {
  const { walletAddress, connectWallet, isConnected: isWalletConnected, signTransaction } = useWallet();
  const [state, setState] = useState<LootboxStateResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [ceremony, setCeremony] = useState<RevealCeremony | null>(null);
  const [revealedReward, setRevealedReward] = useState<RevealedReward | null>(null);
  const [isEquipping, setIsEquipping] = useState(false);
  const [equipDone, setEquipDone] = useState(false);
  const pendingRecoveryRef = useRef(loadPendingLootboxOpen());
  const [hasPendingRecovery, setHasPendingRecovery] = useState(
    () => Boolean(pendingRecoveryRef.current)
  );
  const [recoveryNonce, setRecoveryNonce] = useState(0);
  const onInventoryChangedRef = useRef(onInventoryChanged);

  useEffect(() => {
    onInventoryChangedRef.current = onInventoryChanged;
  }, [onInventoryChanged]);

  const loadState = useCallback(async () => {
    setIsLoading(true);
    try {
      setState(await requestLootboxState());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lootbox state');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState, isAuthenticated]);

  const completeResolvedOpen = useCallback(async (intent: LootboxOpenIntentSnapshot) => {
    clearPendingLootboxOpen(intent.intentId);
    pendingRecoveryRef.current = null;
    setHasPendingRecovery(false);
    if (intent.status !== 'credited') {
      if (intent.status === 'intent_created' || intent.status === 'transaction_built') {
        throw new Error('Crate transaction was not submitted; no tokens were charged');
      }
      throw new Error(intent.lastError || 'Crate payment could not be completed');
    }

    setEquipDone(false);
    const reward = revealedRewardFromIntent(intent);
    if (prefersReducedMotion()) {
      setRevealedReward(reward);
    } else {
      // Warm the lazy preview chunk while the ceremony plays so the hero model
      // is ready the moment the reveal dialog mounts.
      void import('./HeroPreviewCanvas');
      setCeremony({ reward, stage: 'charging' });
    }
    await Promise.all([
      loadState(),
      reward.kind === 'skin' ? onInventoryChangedRef.current() : Promise.resolve(),
    ]);
  }, [loadState]);

  useEffect(() => {
    if (!ceremony) return;
    const timer = window.setTimeout(() => {
      if (ceremony.stage === 'charging') {
        setCeremony({ reward: ceremony.reward, stage: 'burst' });
      } else {
        setRevealedReward(ceremony.reward);
        setCeremony(null);
      }
    }, ceremony.stage === 'charging' ? REVEAL_CHARGE_MS : REVEAL_BURST_MS);
    return () => window.clearTimeout(timer);
  }, [ceremony]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const pending = loadPendingLootboxOpen() ?? pendingRecoveryRef.current;
    pendingRecoveryRef.current = pending;
    setHasPendingRecovery(Boolean(pending));
    if (!pending) return;

    let cancelled = false;
    let retryTimer: number | null = null;
    setIsOpening(true);
    setError(null);

    void resolvePendingLootboxOpen({
      pending,
      loadIntent: getLootboxOpenIntent,
      isCancelled: () => cancelled,
    }).then(async (resolved) => {
      if (!cancelled && resolved) await completeResolvedOpen(resolved);
    }).catch((err) => {
      if (cancelled) return;
      const stillPending = Boolean(loadPendingLootboxOpen() ?? pendingRecoveryRef.current);
      setHasPendingRecovery(stillPending);
      setError(stillPending
        ? 'Crate payment status is temporarily unavailable. Recovery will retry automatically; do not submit another payment.'
        : err instanceof Error ? err.message : 'Failed to recover crate payment');
      if (stillPending) {
        retryTimer = window.setTimeout(() => {
          setRecoveryNonce((value) => value + 1);
        }, 5_000);
      }
    }).finally(() => {
      if (!cancelled) setIsOpening(false);
    });

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [completeResolvedOpen, isAuthenticated, recoveryNonce]);

  const symbol = formatTokenSymbol(state?.tokenSymbol);
  const priceLabel = state
    ? `${formatWholeTokens(state.priceTokens)}${symbol ? ` ${symbol}` : ''}`
    : '—';
  // Admin-granted free opens skip payment entirely, but any possible token
  // outcome still needs a connected recipient wallet.
  const freeOpens = state?.freeOpensAvailable ?? 0;
  const hasFreeOpens = freeOpens > 0 && !state?.freeOpenDisabledReason;
  const canOpen = Boolean(
    state && !isOpening && !ceremony && !hasPendingRecovery
    && (hasFreeOpens || !state.openDisabledReason)
  );
  const openLabel = hasPendingRecovery
    ? 'RECOVERING PAYMENT…'
    : hasFreeOpens
      ? `OPEN FREE CRATE — ${freeOpens} LEFT`
      : `OPEN CRATE — ${priceLabel}`;

  const handleOpenCrate = async () => {
    if (!isAuthenticated) {
      onLogin();
      return;
    }
    if (!state || (!hasFreeOpens && state.openDisabledReason)) {
      setError(state?.openDisabledReason ?? 'Lootboxes are unavailable');
      return;
    }

    setIsOpening(true);
    setError(null);
    try {
      let finalIntent: LootboxOpenIntentSnapshot;
      if (hasFreeOpens) {
        let recipientWalletAddress = isWalletConnected && walletAddress ? walletAddress : undefined;
        const tokenRewardCanDrop = state.directTokenReward.chanceBps > 0 || state.duplicateChanceBps > 0;
        if (tokenRewardCanDrop && !recipientWalletAddress) {
          recipientWalletAddress = await connectWallet() ?? undefined;
        }
        if (tokenRewardCanDrop && !recipientWalletAddress) {
          throw new Error('Connect a wallet to receive possible token rewards');
        }
        finalIntent = await openLootboxWithFreeCredit({ walletAddress: recipientWalletAddress });
      } else {
        const payerWalletAddress = isWalletConnected && walletAddress
          ? walletAddress
          : await connectWallet();
        if (!payerWalletAddress) {
          throw new Error('Connect a wallet before paying');
        }

        const intent = await createLootboxOpenIntent({ walletAddress: payerWalletAddress });
        const transactionPayload = await buildLootboxOpenTransaction(intent.intentId);
        const signedTransactionBase64 = await signTransaction(
          await transactionFromBase64(transactionPayload.transactionBase64)
        );
        const pending = savePendingLootboxOpen(intent.intentId);
        if (!pending) throw new Error('Lootbox intent could not be saved for payment recovery');
        pendingRecoveryRef.current = pending;
        setHasPendingRecovery(true);
        const submitted = await submitSignedLootboxOpenTransaction({
          intentId: intent.intentId,
          signedTransactionBase64,
        });
        const resolved = await resolvePendingLootboxOpen({
          pending,
          initialIntent: submitted,
          loadIntent: getLootboxOpenIntent,
        });
        if (!resolved) throw new Error('Crate payment recovery was interrupted');
        finalIntent = resolved;
      }

      await completeResolvedOpen(finalIntent);
    } catch (err) {
      const pending = loadPendingLootboxOpen() ?? pendingRecoveryRef.current;
      setHasPendingRecovery(Boolean(pending));
      if (pending) {
        setRecoveryNonce((value) => value + 1);
        setError('Crate payment status is pending. Recovery will continue automatically; do not submit another payment.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to open crate');
      }
    } finally {
      setIsOpening(false);
    }
  };

  const handleEquipRevealed = async (skin: HeroSkinDefinition) => {
    setIsEquipping(true);
    try {
      await updateHeroSkinLoadout({ heroId: skin.heroId, skinId: skin.id as HeroSkinId });
      setEquipDone(true);
      await onInventoryChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to equip skin');
    } finally {
      setIsEquipping(false);
    }
  };

  return (
    <div className="skins-screen menu-content-wide">
      {error && (
        <div className="skins-error" role="alert">
          {error}
        </div>
      )}

      <div className="mx-auto my-auto flex w-full max-w-3xl flex-col px-4 py-6">
        {/* Crate stage */}
        <section
          className="crate-stage relative flex min-h-[26rem] flex-1 flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-white/10 p-6 text-center sm:p-8"
          aria-label="Supply crate"
          data-opening={isOpening ? 'true' : undefined}
          data-reveal={ceremony?.stage}
          data-rarity={ceremony && 'skin' in ceremony.reward ? ceremony.reward.skin.rarity : undefined}
          data-reward={ceremony?.reward.kind}
        >
          <p className="crate-kicker font-display text-xs uppercase tracking-[0.3em] text-orange-400">Supply Drop</p>
          <h2 className="crate-title font-display text-4xl sm:text-5xl">SUPPLY CRATE</h2>
          <p className="max-w-md text-sm text-white/60">
            Pull raw {symbol || '$HERO'} or enter the epic, unique, and legendary skin pool.
            Owned skins convert into {symbol || '$HERO'}, with lower payouts more common.
          </p>

          <div className="crate-scene" aria-hidden="true">
            <div className="crate-rays" />
            <div className="crate-embers">
              {CRATE_EMBERS.map((ember, index) => (
                <span
                  key={index}
                  className="crate-ember"
                  style={{
                    left: ember.left,
                    width: ember.size,
                    height: ember.size,
                    animationDelay: ember.delay,
                    animationDuration: ember.duration,
                    '--ember-color': ember.color,
                    '--ember-drift': ember.drift,
                  } as CSSProperties}
                />
              ))}
            </div>
            <div className="crate-beam" />
            <div className="crate-shadow" />
            <div className="crate-float">
              <div className="crate-ring is-outer" />
              <div className="crate-ring" />
              <div className="crate-cube">
                <div className="crate-face is-front" />
                <div className="crate-face is-back" />
                <div className="crate-face is-right" />
                <div className="crate-face is-left" />
                <div className="crate-face is-top" />
                <div className="crate-face is-bottom" />
              </div>
            </div>
            <div className="crate-shockwave" />
            <div className="crate-flash" />
          </div>

          <button
            type="button"
            className="skins-action-button crate-open-button"
            disabled={!isAuthenticated ? false : !canOpen}
            onClick={() => void handleOpenCrate()}
          >
            {!isAuthenticated
              ? 'SIGN IN TO OPEN'
              : isOpening || ceremony
                ? hasPendingRecovery ? 'CONFIRMING PAYMENT…' : 'OPENING…'
                : openLabel}
          </button>

          {hasPendingRecovery && isAuthenticated && (
            <p className="text-xs text-amber-400/90">
              A previous payment is being recovered. Please don&apos;t submit another one.
            </p>
          )}

          {hasFreeOpens && isAuthenticated && (
            <p className="text-xs text-emerald-400/90">
              {freeOpens === 1 ? '1 free open' : `${freeOpens} free opens`} on the house — no payment needed.
            </p>
          )}
          {state?.openDisabledReason && isAuthenticated && !hasFreeOpens && (
            <p className="text-xs text-amber-400/90">{state.openDisabledReason}</p>
          )}
          {state?.freeOpenDisabledReason && freeOpens > 0 && isAuthenticated && (
            <p className="text-xs text-amber-400/90">{state.freeOpenDisabledReason}</p>
          )}
          {isLoading && !state && <p className="text-xs text-white/40">Loading crate…</p>}
        </section>
      </div>

      {revealedReward && (
        <GameDialog
          title="CRATE OPENED"
          icon={revealedReward.kind === 'skin' ? <Package /> : <Coins />}
          iconClassName="crate-reveal-dialog-icon"
          size="md"
          panelClassName={`crate-reveal-dialog ${
            revealedReward.kind === 'skin' ? `is-${revealedReward.skin.rarity}` : 'is-token'
          }`}
          onClose={() => setRevealedReward(null)}
          footer={(
            <>
              {revealedReward.kind === 'skin' ? (
                <button
                  type="button"
                  className={`skins-action-button is-equip crate-reveal-action${equipDone ? ' is-equipped' : ''}`}
                  disabled={isEquipping || equipDone}
                  onClick={() => void handleEquipRevealed(revealedReward.skin)}
                >
                  <span>{equipDone ? '✓ EQUIPPED' : isEquipping ? 'EQUIPPING…' : 'EQUIP NOW'}</span>
                  <span className="crate-reveal-action-sub font-mono uppercase">
                    {equipDone ? 'Ready in lobby' : `${revealedReward.skin.heroId} loadout`}
                  </span>
                </button>
              ) : null}
              <button
                type="button"
                className="skins-action-button is-purchase crate-reveal-action"
                disabled={isOpening || !canOpen}
                onClick={() => {
                  setRevealedReward(null);
                  void handleOpenCrate();
                }}
              >
                <span>OPEN ANOTHER</span>
                <span className="crate-reveal-action-sub font-mono uppercase">
                  {hasFreeOpens ? `Free — ${freeOpens} left` : priceLabel}
                </span>
              </button>
            </>
          )}
        >
          {revealedReward.kind === 'skin' ? (
            <div className={`crate-reveal-card relative overflow-hidden rounded-xl border p-4 pb-6 is-${revealedReward.skin.rarity}`}>
              <SkinRarityChrome />
              <div className="relative z-[2] flex flex-col items-center gap-2.5 text-center">
                <div className="crate-reveal-stage h-48 w-full">
                  <span className="crate-reveal-halo" aria-hidden="true" />
                  <span className="crate-reveal-floor" aria-hidden="true" />
                  <Suspense fallback={null}>
                    <HeroPreviewCanvas
                      heroId={revealedReward.skin.heroId}
                      skinId={revealedReward.skin.id}
                      size="card"
                      interactive={false}
                      idleAnimation
                      showShadow={false}
                      className="h-full w-full"
                    />
                  </Suspense>
                </div>
                <span
                  className="crate-reveal-item crate-reveal-kicker font-mono text-[10px] uppercase tracking-[0.35em]"
                  style={revealItemStyle(0)}
                >
                  New skin unlocked
                </span>
                <span
                  className={`skins-rarity-chip is-${revealedReward.skin.rarity} crate-reveal-item`}
                  style={revealItemStyle(1)}
                >
                  {revealedReward.skin.rarity}
                </span>
                <h3
                  className="crate-reveal-item crate-reveal-name font-display text-3xl text-white"
                  style={revealItemStyle(2)}
                >
                  {revealedReward.skin.displayName}
                </h3>
                <p className="crate-reveal-item max-w-sm text-sm text-white/60" style={revealItemStyle(3)}>
                  {revealedReward.skin.subtitle}
                </p>
              </div>
            </div>
          ) : revealedReward.source === 'duplicate' ? (
            <div className={`crate-reveal-card crate-token-reveal relative overflow-hidden rounded-xl border p-4 pb-6 is-${revealedReward.skin.rarity}`}>
              <SkinRarityChrome />
              <div className="relative z-[2] flex flex-col items-center gap-2.5 text-center">
                <div className="crate-reveal-stage h-40 w-full">
                  <span className="crate-reveal-halo" aria-hidden="true" />
                  <span className="crate-reveal-floor" aria-hidden="true" />
                  <Suspense fallback={null}>
                    <HeroPreviewCanvas
                      heroId={revealedReward.skin.heroId}
                      skinId={revealedReward.skin.id}
                      size="card"
                      interactive={false}
                      idleAnimation
                      showShadow={false}
                      className="h-full w-full"
                    />
                  </Suspense>
                </div>
                <span
                  className="crate-reveal-item crate-reveal-kicker font-mono text-[10px] uppercase tracking-[0.35em]"
                  style={revealItemStyle(0)}
                >
                  Duplicate converted
                </span>
                <span
                  className={`skins-rarity-chip is-${revealedReward.skin.rarity} crate-reveal-item`}
                  style={revealItemStyle(1)}
                >
                  {revealedReward.skin.rarity}
                </span>
                <h3 className="crate-reveal-item font-display text-xl text-white" style={revealItemStyle(2)}>
                  {revealedReward.skin.displayName}
                </h3>
                <p
                  className="crate-reveal-item crate-reveal-amount font-display text-4xl text-emerald-100"
                  style={revealItemStyle(3)}
                >
                  +{formatWholeTokens(revealedReward.amountTokens)} {formatTokenSymbol(revealedReward.tokenSymbol)}
                </p>
                <p className="crate-reveal-item max-w-sm text-sm text-white/55" style={revealItemStyle(4)}>
                  You already owned this skin, so its value is automatically sent to the wallet used
                  for this crate. Payouts usually confirm within one minute.
                </p>
              </div>
            </div>
          ) : (
            <div className="crate-reveal-card crate-token-reveal relative overflow-hidden rounded-xl border p-6 pb-7">
              <SkinRarityChrome />
              <div className="relative z-[2] flex flex-col items-center gap-2.5 text-center">
                <div className="crate-reveal-stage h-44 w-full">
                  <span className="crate-reveal-halo" aria-hidden="true" />
                  <span className="crate-reveal-floor" aria-hidden="true" />
                  <div className="rounded-full border border-emerald-200/25 bg-emerald-300/10 p-6 shadow-[0_0_80px_rgba(52,211,153,0.18)]">
                    <Coins className="h-16 w-16 text-emerald-200" strokeWidth={1.25} />
                  </div>
                </div>
                <span
                  className="crate-reveal-item crate-reveal-kicker font-mono text-[10px] uppercase tracking-[0.35em]"
                  style={revealItemStyle(0)}
                >
                  Raw token drop
                </span>
                <p
                  className="crate-reveal-item crate-reveal-amount font-display text-5xl text-emerald-100"
                  style={revealItemStyle(1)}
                >
                  +{formatWholeTokens(revealedReward.amountTokens)} {formatTokenSymbol(revealedReward.tokenSymbol)}
                </p>
                <p className="crate-reveal-item max-w-sm text-sm text-white/55" style={revealItemStyle(2)}>
                  This reward is automatically sent to the wallet used for this crate. Payouts usually
                  confirm within one minute.
                </p>
              </div>
            </div>
          )}
        </GameDialog>
      )}
    </div>
  );
}
