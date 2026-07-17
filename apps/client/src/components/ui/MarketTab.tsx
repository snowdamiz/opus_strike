import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getHeroSkinDefinition,
  isHeroSkinId,
  isMarketplaceTradeableSkin,
  type HeroSkinCatalogResponse,
  type HeroSkinId,
  type MarketplaceListingSnapshot,
  type MarketplaceStateResponse,
} from '@voxel-strike/shared';
import { useWallet } from '../../contexts/WalletContext';
import {
  buildMarketplacePurchaseTransaction,
  cancelMarketplaceListing,
  createMarketplaceListing,
  createMarketplacePurchaseIntent,
  getMarketplacePurchaseIntent,
  requestMarketplaceListings,
  requestMarketplaceState,
  requestMyMarketplaceListings,
  submitSignedMarketplacePurchaseTransaction,
} from '../../contexts/networkApi';
import { transactionFromBase64 } from '../../utils/solanaTransactions';
import { formatTokenBaseUnits } from '../../utils/tokenAmountFormat';
import {
  clearPendingMarketplacePurchase,
  loadPendingMarketplacePurchase,
  resolvePendingMarketplacePurchase,
  savePendingMarketplacePurchase,
} from '../../utils/pendingMarketplacePurchase';
import { GameSelect } from './GameSelect';
import { SkinRarityChrome } from './SkinRarityChrome';

const HeroPreviewCanvas = lazy(() => import('./HeroPreviewCanvas').then((module) => ({
  default: module.HeroPreviewCanvas,
})));

const LAMPORTS_PER_SOL = 1_000_000_000n;

function solToLamportsString(value: string): string {
  const match = /^(\d+)(?:\.(\d{0,9}))?$/.exec(value.trim());
  if (!match) {
    throw new Error('Price must be a SOL amount like 0.25');
  }
  const whole = BigInt(match[1]);
  const fractional = BigInt((match[2] ?? '').padEnd(9, '0'));
  const lamports = whole * LAMPORTS_PER_SOL + fractional;
  if (lamports <= 0n) {
    throw new Error('Price must be greater than zero');
  }
  return lamports.toString();
}

function formatSolPrice(lamports: string): string {
  return `${formatTokenBaseUnits(lamports, 9, lamports)} SOL`;
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

function listingStatusLabel(listing: MarketplaceListingSnapshot): string {
  switch (listing.status) {
    case 'active':
      return 'LISTED';
    case 'pending_sale':
      return 'SALE PENDING';
    case 'sold':
      return 'SOLD';
    case 'canceled':
      return 'CANCELED';
    default:
      return listing.status;
  }
}

function ListingSkinThumb({ skinId }: { skinId: HeroSkinId }) {
  const skin = getHeroSkinDefinition(skinId);
  return (
    <div className="h-24 w-20 shrink-0 overflow-hidden rounded-lg bg-black/30" aria-hidden="true">
      <Suspense fallback={null}>
        <HeroPreviewCanvas
          heroId={skin.heroId}
          skinId={skin.id}
          size="card"
          interactive={false}
          idleAnimation={false}
          showShadow={false}
          className="h-full w-full"
        />
      </Suspense>
    </div>
  );
}

export function MarketTab({
  isAuthenticated,
  catalog,
  onLogin,
  onInventoryChanged,
}: {
  isAuthenticated: boolean;
  catalog: HeroSkinCatalogResponse | null;
  onLogin: () => void;
  onInventoryChanged: () => Promise<void> | void;
}) {
  const { walletAddress, connectWallet, isConnected: isWalletConnected, signTransaction } = useWallet();
  const [marketState, setMarketState] = useState<MarketplaceStateResponse | null>(null);
  const [listings, setListings] = useState<MarketplaceListingSnapshot[]>([]);
  const [myListings, setMyListings] = useState<MarketplaceListingSnapshot[]>([]);
  const [view, setView] = useState<'browse' | 'sell'>('browse');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyListingId, setBusyListingId] = useState<string | null>(null);
  const [sellSkinId, setSellSkinId] = useState<string>('');
  const [sellPriceSol, setSellPriceSol] = useState<string>('');
  const [isCreatingListing, setIsCreatingListing] = useState(false);
  const [recoveryNonce, setRecoveryNonce] = useState(0);
  const pendingPurchaseRef = useRef(loadPendingMarketplacePurchase());
  const onInventoryChangedRef = useRef(onInventoryChanged);

  useEffect(() => {
    onInventoryChangedRef.current = onInventoryChanged;
  }, [onInventoryChanged]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [state, browse, mine] = await Promise.all([
        requestMarketplaceState(),
        requestMarketplaceListings(),
        isAuthenticated ? requestMyMarketplaceListings() : Promise.resolve({ listings: [] }),
      ]);
      setMarketState(state);
      setListings(browse.listings);
      setMyListings(mine.listings);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load marketplace');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, walletAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const pending = pendingPurchaseRef.current;
    if (!isAuthenticated || !pending) return;
    let cancelled = false;
    setNotice('Recovering your pending marketplace purchase…');

    void resolvePendingMarketplacePurchase({
      pending,
      loadIntent: getMarketplacePurchaseIntent,
      isCancelled: () => cancelled,
    }).then(async (resolved) => {
      if (cancelled || !resolved) return;
      if (resolved.status === 'intent_created' || resolved.status === 'transaction_built') {
        clearPendingMarketplacePurchase(resolved.intentId);
        pendingPurchaseRef.current = null;
        setNotice(null);
        setError('Marketplace transaction was not submitted; no SOL was charged');
        await refresh();
        return;
      }
      if (resolved.status === 'failed' || resolved.status === 'expired') {
        clearPendingMarketplacePurchase(resolved.intentId);
        pendingPurchaseRef.current = null;
        setNotice(null);
        setError(resolved.lastError || 'Marketplace purchase could not be completed');
        await refresh();
        return;
      }
      if (resolved.status === 'credited') {
        clearPendingMarketplacePurchase(resolved.intentId);
        pendingPurchaseRef.current = null;
        setError(null);
        setNotice('Your previous marketplace purchase is complete — check the armory.');
        await Promise.all([refresh(), onInventoryChangedRef.current()]);
      }
    }).catch((err) => {
      if (cancelled) return;
      const message = err instanceof Error ? err.message : 'Failed to recover marketplace purchase';
      if (/not found/i.test(message)) {
        clearPendingMarketplacePurchase(pending.intentId);
        pendingPurchaseRef.current = null;
      }
      setNotice(null);
      setError(message);
    });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, recoveryNonce, refresh]);

  const symbol = formatTokenSymbol(marketState?.tokenSymbol);
  const holdLabel = marketState
    ? `${formatWholeTokens(marketState.listingHoldTokens)}${symbol ? ` ${symbol}` : ''}`
    : '—';
  const holdBalanceLabel = marketState?.holdBalanceTokenBaseUnits != null
    ? `${formatTokenBaseUnits(
      marketState.holdBalanceTokenBaseUnits,
      marketState.tokenDecimals,
      marketState.holdBalanceTokenBaseUnits
    )}${symbol ? ` ${symbol}` : ''}`
    : null;

  const listableSkins = useMemo(() => {
    const listedSkinIds = new Set(
      myListings
        .filter((listing) => listing.status === 'active' || listing.status === 'pending_sale')
        .map((listing) => listing.skinId)
    );
    return (catalog?.skins ?? []).filter((skin) => (
      skin.owned &&
      isMarketplaceTradeableSkin(getHeroSkinDefinition(skin.id)) &&
      !listedSkinIds.has(skin.id)
    ));
  }, [catalog, myListings]);

  const handleBuy = async (listing: MarketplaceListingSnapshot) => {
    if (!isAuthenticated) {
      onLogin();
      return;
    }
    if (pendingPurchaseRef.current) {
      setError('Finish the pending marketplace purchase before starting another');
      setRecoveryNonce((value) => value + 1);
      return;
    }
    setBusyListingId(listing.listingId);
    setError(null);
    setNotice(null);
    try {
      const payerWalletAddress = isWalletConnected && walletAddress
        ? walletAddress
        : await connectWallet();
      if (!payerWalletAddress) {
        throw new Error('Connect a wallet before paying');
      }

      const intent = await createMarketplacePurchaseIntent({
        listingId: listing.listingId,
        walletAddress: payerWalletAddress,
      });
      const pending = savePendingMarketplacePurchase(intent.intentId);
      if (pending) pendingPurchaseRef.current = pending;
      const transactionPayload = await buildMarketplacePurchaseTransaction(intent.intentId);
      const signedTransactionBase64 = await signTransaction(
        await transactionFromBase64(transactionPayload.transactionBase64)
      );
      const submitted = await submitSignedMarketplacePurchaseTransaction({
        intentId: intent.intentId,
        signedTransactionBase64,
      });
      const finalIntent = await resolvePendingMarketplacePurchase({
        pending: pending ?? { intentId: intent.intentId, savedAt: Date.now() },
        initialIntent: submitted,
        loadIntent: getMarketplacePurchaseIntent,
      });
      if (!finalIntent) throw new Error('Purchase recovery was interrupted');
      if (finalIntent.status !== 'credited') {
        throw new Error(finalIntent.lastError || 'Purchase is still waiting for confirmation');
      }
      clearPendingMarketplacePurchase(finalIntent.intentId);
      pendingPurchaseRef.current = null;

      const skinName = isHeroSkinId(listing.skinId)
        ? getHeroSkinDefinition(listing.skinId).displayName
        : listing.skinId;
      setNotice(`${skinName} is yours — check the armory.`);
      await Promise.all([refresh(), onInventoryChangedRef.current()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to buy skin');
      if (pendingPurchaseRef.current) {
        setRecoveryNonce((value) => value + 1);
      }
      await refresh();
    } finally {
      setBusyListingId(null);
    }
  };

  const handleCancel = async (listing: MarketplaceListingSnapshot) => {
    setBusyListingId(listing.listingId);
    setError(null);
    setNotice(null);
    try {
      await cancelMarketplaceListing(listing.listingId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel listing');
    } finally {
      setBusyListingId(null);
    }
  };

  const handleCreateListing = async () => {
    if (!isAuthenticated) {
      onLogin();
      return;
    }
    if (!isHeroSkinId(sellSkinId)) {
      setError('Choose a skin to list');
      return;
    }
    setIsCreatingListing(true);
    setError(null);
    setNotice(null);
    try {
      const priceLamports = solToLamportsString(sellPriceSol);
      await createMarketplaceListing({ skinId: sellSkinId, priceLamports });
      setSellSkinId('');
      setSellPriceSol('');
      setNotice('Listing created.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create listing');
    } finally {
      setIsCreatingListing(false);
    }
  };

  const browseListings = listings.filter((listing) => listing.status === 'active');

  return (
    <div className="skins-screen menu-content-wide">
      {error && (
        <div className="skins-error" role="alert">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="mx-auto mb-3 w-full max-w-5xl rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300" role="status">
          {notice}
        </div>
      )}

      <div className="mx-auto w-full max-w-5xl px-4 pb-10">
        {/* View switch */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="skins-filter" role="group" aria-label="Marketplace view">
            <button
              type="button"
              className={`skins-filter-chip${view === 'browse' ? ' is-active' : ''}`}
              onClick={() => setView('browse')}
              aria-pressed={view === 'browse'}
            >
              <span className="skins-filter-label">Browse</span>
              <span className="skins-filter-count">{browseListings.length}</span>
            </button>
            <button
              type="button"
              className={`skins-filter-chip${view === 'sell' ? ' is-active' : ''}`}
              onClick={() => {
                if (!isAuthenticated) {
                  onLogin();
                  return;
                }
                setView('sell');
              }}
              aria-pressed={view === 'sell'}
            >
              <span className="skins-filter-label">My Listings</span>
              <span className="skins-filter-count">{myListings.length}</span>
            </button>
          </div>
          <p className="hidden text-[11px] uppercase tracking-wide text-white/35 sm:block">
            Sales settle wallet-to-wallet in SOL
          </p>
        </div>

        {view === 'browse' && (
          <div className="space-y-3">
            {isLoading && browseListings.length === 0 && (
              <div className="skins-empty-state">Loading listings…</div>
            )}
            {!isLoading && browseListings.length === 0 && (
              <div className="skins-empty-state flex flex-col items-center gap-3">
                <span>
                  {marketState?.canList === false
                    ? marketState.listDisabledReason
                    : `No skins listed right now. Be the first — hold ${holdLabel} and list yours.`}
                </span>
                {marketState?.enabled !== false && (
                  <button
                    type="button"
                    className="skins-action-button is-purchase"
                    onClick={() => {
                      if (!isAuthenticated) {
                        onLogin();
                        return;
                      }
                      setView('sell');
                    }}
                  >
                    {isAuthenticated ? 'LIST A SKIN' : 'SIGN IN TO LIST'}
                  </button>
                )}
              </div>
            )}
            {browseListings.map((listing) => {
              const skin = isHeroSkinId(listing.skinId) ? getHeroSkinDefinition(listing.skinId) : null;
              const busy = busyListingId === listing.listingId;
              if (!skin) return null;
              return (
                <article
                  key={listing.listingId}
                  className={`relative flex items-center gap-4 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] p-3 is-${skin.rarity}`}
                >
                  <SkinRarityChrome />
                  <ListingSkinThumb skinId={skin.id} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-lg text-white">{skin.displayName}</h3>
                      <span className={`skins-rarity-chip is-${skin.rarity}`}>{skin.rarity}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-white/50">{skin.subtitle}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-wide text-white/35">
                      Seller: {listing.sellerName || 'Unknown'}
                      {listing.isOwn ? ' (you)' : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="font-display text-lg text-white">{formatSolPrice(listing.priceLamports)}</span>
                    <button
                      type="button"
                      className="skins-action-button is-purchase"
                      disabled={busy || listing.isOwn}
                      onClick={() => void handleBuy(listing)}
                    >
                      {listing.isOwn ? 'YOUR LISTING' : busy ? 'BUYING…' : 'BUY'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {view === 'sell' && (
          <div className="space-y-5">
            {/* Hold requirement banner */}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm uppercase tracking-wide text-white/80">
                    Listing requirement
                  </h3>
                  <p className="mt-1 text-xs text-white/50">
                    Hold at least {holdLabel} in your linked wallet to list skins for sale.
                  </p>
                  {holdBalanceLabel && (
                    <p className="mt-1 text-xs text-white/50">
                      Detected balance: {holdBalanceLabel}
                    </p>
                  )}
                </div>
                {marketState && (
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      marketState.canList
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-amber-500/15 text-amber-300'
                    }`}
                  >
                    {marketState.canList ? 'Eligible to list' : marketState.listDisabledReason}
                  </span>
                )}
              </div>
            </div>

            {/* Sell form */}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <h3 className="font-display text-sm uppercase tracking-wide text-white/80">List a skin</h3>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs text-white/50">
                  Skin
                  <GameSelect
                    label="Skin to list"
                    value={isHeroSkinId(sellSkinId) ? sellSkinId : ''}
                    placeholder="Choose an owned skin…"
                    emptyLabel="No unlisted skins to sell"
                    options={listableSkins.map((skin) => ({
                      value: skin.id,
                      label: skin.displayName,
                      trailing: <span className={`skins-rarity-chip is-${skin.rarity}`}>{skin.rarity}</span>,
                    }))}
                    onChange={(skinId) => setSellSkinId(skinId)}
                  />
                </div>
                <label className="flex w-36 flex-col gap-1 text-xs text-white/50">
                  Price (SOL)
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.25"
                    className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                    value={sellPriceSol}
                    onChange={(event) => setSellPriceSol(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="skins-action-button is-purchase"
                  disabled={
                    isCreatingListing ||
                    !sellSkinId ||
                    !sellPriceSol.trim() ||
                    marketState?.canList !== true
                  }
                  onClick={() => void handleCreateListing()}
                >
                  {isCreatingListing ? 'LISTING…' : 'LIST FOR SALE'}
                </button>
              </div>
              {listableSkins.length === 0 && (
                <p className="mt-2 text-xs text-white/40">
                  You have no unlisted skins to sell. Open crates or buy skins first.
                </p>
              )}
            </div>

            {/* My listings */}
            <div className="space-y-3">
              {myListings.length === 0 && (
                <div className="skins-empty-state">You have no listings yet.</div>
              )}
              {myListings.map((listing) => {
                const skin = isHeroSkinId(listing.skinId) ? getHeroSkinDefinition(listing.skinId) : null;
                const busy = busyListingId === listing.listingId;
                if (!skin) return null;
                return (
                  <article
                    key={listing.listingId}
                    className={`relative flex items-center gap-4 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] p-3 is-${skin.rarity}`}
                  >
                    <SkinRarityChrome />
                    <ListingSkinThumb skinId={skin.id} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-lg text-white">{skin.displayName}</h3>
                        <span className={`skins-rarity-chip is-${skin.rarity}`}>{skin.rarity}</span>
                      </div>
                      <p className="mt-1 text-[11px] uppercase tracking-wide text-white/35">
                        {listingStatusLabel(listing)}
                        {listing.soldAt ? ` · ${new Date(listing.soldAt).toLocaleDateString()}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className="font-display text-lg text-white">{formatSolPrice(listing.priceLamports)}</span>
                      {listing.status === 'active' && (
                        <button
                          type="button"
                          className="skins-action-button is-locked"
                          disabled={busy}
                          onClick={() => void handleCancel(listing)}
                        >
                          {busy ? 'CANCELING…' : 'CANCEL'}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
