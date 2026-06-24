import { useCallback, useEffect, useMemo, useState } from 'react';
import { config } from '../../config/environment';
import {
  fromDateTimeLocalValue,
  formatNumber,
  getRankedSeasonIdentity,
  getRankFromRating,
  isPositiveWholeNumberString,
  isPositiveWholeNumberInRange,
  lamportsToSolDisplay,
  parseDraftRating,
  rewardEconomyDraftFromOverview,
  rewardEconomyPayloadFromDraft,
  toDateTimeLocalValue,
} from './format';
import {
  ADMIN_MANUAL_RATING_MAX,
  ADMIN_RANK_PAGE_SIZE,
  ADMIN_SKIN_SUPPLY_CAP_MAX,
  EMPTY_ADMIN_USERS_PAGINATION,
  type AdminOverview,
  type AdminRankUser,
  type AdminSectionId,
  type AdminUsersPagination,
  type AdminUsersResponse,
  type GoldenBiomeDistributionMode,
  type GoldenBiomeRewardOverview,
  type PlayerReportOverview,
  type RankedEntryGateDraft,
  type RankedSeasonDraft,
  type RewardEconomyDraft,
  type SkinShopItemDraft,
  type SkinShopSettingsDraft,
} from './types';

const REFRESH_INTERVAL_MS = 3000;

/**
 * Owns every interaction with the admin endpoints. The contract here is
 * intentionally identical to the legacy AdminDashboard: one `GET /overview`
 * poll, paginated `GET /users`, and CSRF-guarded POST mutations that refetch
 * the overview on success. UI is a pure consumer of this hook.
 */
export function useAdminConsole(activeSection: AdminSectionId) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [busyReportId, setBusyReportId] = useState<string | null>(null);
  const [busyGoldenRewardId, setBusyGoldenRewardId] = useState<string | null>(null);
  const [busyGoldenMode, setBusyGoldenMode] = useState(false);
  const [busyGlobalNotification, setBusyGlobalNotification] = useState(false);
  const [busyRankedSeason, setBusyRankedSeason] = useState(false);
  const [busyRankedEntryGate, setBusyRankedEntryGate] = useState(false);
  const [busySkinShopSettings, setBusySkinShopSettings] = useState(false);
  const [busySkinShopItemId, setBusySkinShopItemId] = useState<string | null>(null);
  const [busyRankUserId, setBusyRankUserId] = useState<string | null>(null);
  const [busyRewardEconomy, setBusyRewardEconomy] = useState(false);

  const [rankUsersLoading, setRankUsersLoading] = useState(false);
  const [rankUsersLoaded, setRankUsersLoaded] = useState(false);

  const [globalNotificationDraft, setGlobalNotificationDraft] = useState('');
  const [rankedSeasonDraft, setRankedSeasonDraft] = useState<RankedSeasonDraft>({
    mode: 'season',
    seasonNumber: '1',
    endsAtLocal: '',
  });
  const [rankedEntryGateDraft, setRankedEntryGateDraft] = useState<RankedEntryGateDraft>({
    mode: 'locked',
    tokenMintAddress: '',
    tokenSymbol: '',
    requiredTokenAmount: '0',
  });
  const [rewardEconomyDraft, setRewardEconomyDraft] = useState<RewardEconomyDraft>(() => rewardEconomyDraftFromOverview());
  const [skinShopDraft, setSkinShopDraft] = useState<SkinShopSettingsDraft>({
    enabled: false,
    tokenMintAddress: '',
    tokenSymbol: '',
    cluster: 'devnet',
  });
  const [skinShopItemDrafts, setSkinShopItemDrafts] = useState<Record<string, SkinShopItemDraft>>({});

  const [rankedSeasonDraftDirty, setRankedSeasonDraftDirty] = useState(false);
  const [rankedEntryGateDraftDirty, setRankedEntryGateDraftDirty] = useState(false);
  const [rewardEconomyDraftDirty, setRewardEconomyDraftDirty] = useState(false);
  const [skinShopDraftDirty, setSkinShopDraftDirty] = useState(false);
  const [skinShopItemDraftDirtyById, setSkinShopItemDraftDirtyById] = useState<Record<string, boolean>>({});

  const [rankSearch, setRankSearch] = useState('');
  const [rankReason, setRankReason] = useState('');
  const [rankUsers, setRankUsers] = useState<AdminRankUser[]>([]);
  const [rankUsersPagination, setRankUsersPagination] = useState<AdminUsersPagination>(EMPTY_ADMIN_USERS_PAGINATION);
  const [rankUserDrafts, setRankUserDrafts] = useState<Record<string, string>>({});

  const loadOverview = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`${config.serverHttpUrl}/admin/api/overview`, {
        credentials: 'include',
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(response.status === 404 ? 'Admin access denied' : `Admin request failed (${response.status})`);
      }

      setOverview(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const postAdminJson = useCallback(async (endpoint: string, payload: unknown) => {
    setError(null);
    const csrfToken = overview?.admin.csrfToken ?? '';
    const response = await fetch(`${config.serverHttpUrl}${endpoint}`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify(payload ?? {}),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: `Admin request failed (${response.status})` }));
      throw new Error(data.error || `Admin request failed (${response.status})`);
    }

    await loadOverview();
  }, [loadOverview, overview?.admin.csrfToken]);

  const loadRankUsers = useCallback(async (query: string, page = 1) => {
    setRankUsersLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: ADMIN_RANK_PAGE_SIZE.toString(),
        page: Math.max(1, page).toString(),
        query,
      });
      const response = await fetch(`${config.serverHttpUrl}/admin/api/users?${params.toString()}`, {
        credentials: 'include',
        cache: 'no-store',
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: `Admin request failed (${response.status})` }));
        throw new Error(data.error || `Admin request failed (${response.status})`);
      }

      const data = await response.json() as AdminUsersResponse;
      setRankUsers(data.users);
      setRankUsersPagination(data.pagination);
      setRankUserDrafts(Object.fromEntries(data.users.map((user) => [user.id, user.competitiveRating.toString()])));
      setRankUsersLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRankUsersLoaded(true);
    } finally {
      setRankUsersLoading(false);
    }
  }, []);

  const updateRankUserDraft = useCallback((userId: string, rating: string) => {
    setRankUserDrafts((drafts) => ({ ...drafts, [userId]: rating }));
  }, []);

  const searchRankUsers = useCallback(() => {
    void loadRankUsers(rankSearch.trim(), 1);
  }, [loadRankUsers, rankSearch]);

  const clearRankUserSearch = useCallback(() => {
    setRankSearch('');
    void loadRankUsers('', 1);
  }, [loadRankUsers]);

  const changeRankUserPage = useCallback((page: number) => {
    void loadRankUsers(rankSearch.trim(), page);
  }, [loadRankUsers, rankSearch]);

  const saveRankUser = useCallback((user: AdminRankUser) => {
    const rating = parseDraftRating(rankUserDrafts[user.id] ?? user.competitiveRating.toString());
    if (rating === null) {
      setError(`Rating must be between 0 and ${ADMIN_MANUAL_RATING_MAX}`);
      return;
    }

    const nextRank = getRankFromRating(rating, user.rankedGames).label;
    if (!window.confirm(`Set ${user.name} from ${user.rank.label} / ${user.competitiveRating} to ${nextRank} / ${rating}?`)) {
      return;
    }

    setBusyRankUserId(user.id);
    postAdminJson(`/admin/api/users/${encodeURIComponent(user.id)}/rank`, {
      competitiveRating: rating,
      reason: rankReason.trim(),
    })
      .then(() => loadRankUsers(rankSearch.trim(), rankUsersPagination.page))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyRankUserId(null));
  }, [loadRankUsers, postAdminJson, rankReason, rankSearch, rankUserDrafts, rankUsersPagination.page]);

  const updateReportStatus = useCallback((report: PlayerReportOverview, status: string) => {
    const note = window.prompt(status === 'cleared' ? 'Clear note' : 'Review note', '') ?? '';
    if ((status === 'cleared' || status === 'dismissed') && !window.confirm(`${status} report ${report.id}?`)) return;

    setBusyReportId(report.id);
    postAdminJson(`/admin/api/player-reports/${encodeURIComponent(report.id)}/status`, { status, note })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyReportId(null));
  }, [postAdminJson]);

  const applyReportAccountAction = useCallback((report: PlayerReportOverview, actionType: 'suspension' | 'ban') => {
    const reason = window.prompt(`${actionType} reason`, report.reason);
    if (!reason) return;
    const expiresAt = actionType === 'suspension'
      ? window.prompt('Suspension expiration, ISO or local datetime', '')
      : '';
    if (actionType === 'suspension' && !expiresAt) return;
    if (!window.confirm(`${actionType} ${report.targetUser?.name || report.targetName}?`)) return;

    setBusyReportId(report.id);
    postAdminJson(`/admin/api/player-reports/${encodeURIComponent(report.id)}/account-actions`, {
      actionType,
      reason,
      expiresAt: expiresAt || null,
    })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyReportId(null));
  }, [postAdminJson]);

  const setGoldenDistributionMode = useCallback((mode: GoldenBiomeDistributionMode) => {
    const currentMode = overview?.goldenBiomeRewards?.settings.distributionMode;
    if (currentMode === mode) return;
    if (!window.confirm(`Switch golden reward distribution to ${mode}?`)) return;

    setBusyGoldenMode(true);
    postAdminJson('/admin/api/golden-biome/distribution-mode', { mode })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyGoldenMode(false));
  }, [overview?.goldenBiomeRewards?.settings.distributionMode, postAdminJson]);

  const distributeGoldenReward = useCallback((reward: GoldenBiomeRewardOverview) => {
    if (!window.confirm(`Distribute ${lamportsToSolDisplay(reward.rewardLamports)} SOL to ${reward.paidPlayerCount} ${reward.winningTeam} winner${reward.paidPlayerCount === 1 ? '' : 's'}?`)) {
      return;
    }

    setBusyGoldenRewardId(reward.id);
    postAdminJson(`/admin/api/golden-biome/rewards/${encodeURIComponent(reward.id)}/distribute`, {})
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyGoldenRewardId(null));
  }, [postAdminJson]);

  const saveGlobalNotification = useCallback(() => {
    const message = globalNotificationDraft.trim();
    if (!message) {
      setError('Notification message is required');
      return;
    }

    setBusyGlobalNotification(true);
    postAdminJson('/admin/api/global-notification', { message })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyGlobalNotification(false));
  }, [globalNotificationDraft, postAdminJson]);

  const removeGlobalNotification = useCallback(() => {
    if (!overview?.globalNotification) return;
    if (!window.confirm('Remove the global notification?')) return;

    setBusyGlobalNotification(true);
    postAdminJson('/admin/api/global-notification/remove', {})
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyGlobalNotification(false));
  }, [overview?.globalNotification, postAdminJson]);

  const updateRankedSeasonDraft = useCallback((draft: RankedSeasonDraft) => {
    setRankedSeasonDraft(draft);
    setRankedSeasonDraftDirty(true);
  }, []);

  const updateRankedEntryGateDraft = useCallback((draft: RankedEntryGateDraft) => {
    setRankedEntryGateDraft(draft);
    setRankedEntryGateDraftDirty(true);
  }, []);

  const updateRewardEconomyDraft = useCallback((patch: Partial<RewardEconomyDraft>) => {
    setRewardEconomyDraft((draft) => ({ ...draft, ...patch }));
    setRewardEconomyDraftDirty(true);
  }, []);

  const updateSkinShopDraft = useCallback((draft: SkinShopSettingsDraft) => {
    setSkinShopDraft(draft);
    setSkinShopDraftDirty(true);
  }, []);

  const updateSkinShopItemDraft = useCallback((skinId: string, draft: SkinShopItemDraft) => {
    setSkinShopItemDrafts((drafts) => ({ ...drafts, [skinId]: draft }));
    setSkinShopItemDraftDirtyById((dirty) => ({ ...dirty, [skinId]: true }));
  }, []);

  const saveRankedSeason = useCallback(() => {
    if (!overview?.rankedSeason) return;

    const seasonNumber = Math.floor(Number(rankedSeasonDraft.seasonNumber));
    if (rankedSeasonDraft.mode === 'season' && (!Number.isFinite(seasonNumber) || seasonNumber < 1 || seasonNumber > 999)) {
      setError('Season number must be between 1 and 999');
      return;
    }

    const currentIdentity = getRankedSeasonIdentity(overview.rankedSeason.mode, overview.rankedSeason.seasonNumber);
    const nextIdentity = getRankedSeasonIdentity(rankedSeasonDraft.mode, seasonNumber);
    if (
      currentIdentity !== nextIdentity &&
      !window.confirm('Changing the ranked season archives the current season and resets player ratings. Ranked records are preserved. Continue?')
    ) {
      return;
    }

    setBusyRankedSeason(true);
    postAdminJson('/admin/api/ranked-season', {
      mode: rankedSeasonDraft.mode,
      seasonNumber,
      endsAt: fromDateTimeLocalValue(rankedSeasonDraft.endsAtLocal),
    })
      .then(() => setRankedSeasonDraftDirty(false))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyRankedSeason(false));
  }, [overview?.rankedSeason, postAdminJson, rankedSeasonDraft]);

  const saveRankedEntryGate = useCallback(() => {
    if (!overview?.rankedEntryGate) return;

    const tokenSymbol = rankedEntryGateDraft.tokenSymbol.trim().replace(/^\$/, '').toUpperCase();
    const tokenMintAddress = rankedEntryGateDraft.tokenMintAddress.trim();
    const requiredTokenAmount = rankedEntryGateDraft.requiredTokenAmount.trim();

    if (rankedEntryGateDraft.mode === 'token_required') {
      if (!tokenMintAddress) {
        setError('Ranked token mint is required before enabling token-gated ranked');
        return;
      }
      if (!/^[A-Z0-9]{1,12}$/.test(tokenSymbol)) {
        setError('Ranked token symbol must be 1-12 letters or numbers');
        return;
      }
      if (!isPositiveWholeNumberString(requiredTokenAmount)) {
        setError('Required token amount must be greater than zero');
        return;
      }
      if (overview.rankedEntryGate.mode !== 'token_required' && !window.confirm('Enable ranked token gate with the configured SPL token?')) {
        return;
      }
    } else if (overview.rankedEntryGate.mode !== 'locked' && !window.confirm('Lock ranked entry?')) {
      return;
    }

    setBusyRankedEntryGate(true);
    postAdminJson('/admin/api/ranked-entry-gate', {
      mode: rankedEntryGateDraft.mode,
      tokenMintAddress,
      tokenSymbol,
      requiredTokenAmount,
    })
      .then(() => setRankedEntryGateDraftDirty(false))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyRankedEntryGate(false));
  }, [overview?.rankedEntryGate, postAdminJson, rankedEntryGateDraft]);

  const saveRewardEconomy = useCallback(() => {
    let payload: ReturnType<typeof rewardEconomyPayloadFromDraft>;
    try {
      payload = rewardEconomyPayloadFromDraft(rewardEconomyDraft);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    setBusyRewardEconomy(true);
    postAdminJson('/admin/api/reward-economy', payload)
      .then(() => setRewardEconomyDraftDirty(false))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyRewardEconomy(false));
  }, [postAdminJson, rewardEconomyDraft]);

  const saveSkinShopSettings = useCallback(() => {
    const tokenSymbol = skinShopDraft.tokenSymbol.trim().replace(/^\$/, '').toUpperCase();
    const tokenMintAddress = skinShopDraft.tokenMintAddress.trim();
    const treasuryWallet = overview?.skinShop.shop.treasuryWallet?.trim() ?? '';
    const rpcConfigured = overview?.skinShop.shop.rpcConfigured ?? false;
    const cluster = skinShopDraft.cluster.trim() || 'devnet';

    if (skinShopDraft.enabled && !tokenMintAddress) {
      setError('Token mint is required before enabling the skin shop');
      return;
    }
    if (skinShopDraft.enabled && !treasuryWallet) {
      setError('WAGER_TREASURY_WALLET is required before enabling the skin shop');
      return;
    }
    if (skinShopDraft.enabled && !rpcConfigured) {
      setError('SOLANA_RPC_URL is required before enabling the skin shop');
      return;
    }
    if (!/^[A-Z0-9]{1,16}$/.test(tokenSymbol)) {
      setError('Skin shop token symbol must be 1-16 letters or numbers');
      return;
    }
    if (skinShopDraft.enabled && !window.confirm('Enable the skin shop with the configured SPL token settings?')) {
      return;
    }

    setBusySkinShopSettings(true);
    postAdminJson('/admin/api/skin-shop/settings', {
      enabled: skinShopDraft.enabled,
      tokenMintAddress,
      tokenSymbol,
      cluster,
    })
      .then(() => setSkinShopDraftDirty(false))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusySkinShopSettings(false));
  }, [overview?.skinShop.shop.rpcConfigured, overview?.skinShop.shop.treasuryWallet, postAdminJson, skinShopDraft]);

  const saveSkinShopItem = useCallback((skinId: string) => {
    const draft = skinShopItemDrafts[skinId];
    if (!draft) return;
    const tokenAmountBaseUnits = draft.tokenAmountBaseUnits.trim();
    const maxSupply = draft.maxSupply.trim();
    if (draft.saleEnabled && !isPositiveWholeNumberString(tokenAmountBaseUnits)) {
      setError('Sale-enabled skins need a positive integer base-unit amount');
      return;
    }
    if (maxSupply && !isPositiveWholeNumberInRange(maxSupply, ADMIN_SKIN_SUPPLY_CAP_MAX)) {
      setError(`Supply cap must be between 1 and ${formatNumber(ADMIN_SKIN_SUPPLY_CAP_MAX)}`);
      return;
    }

    setBusySkinShopItemId(skinId);
    postAdminJson(`/admin/api/skin-shop/items/${encodeURIComponent(skinId)}`, {
      saleEnabled: draft.saleEnabled,
      tokenAmountBaseUnits,
      maxSupply,
      expectedPriceVersion: draft.expectedPriceVersion,
    })
      .then(() => {
        setSkinShopItemDraftDirtyById((dirty) => ({ ...dirty, [skinId]: false }));
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusySkinShopItemId(null));
  }, [postAdminJson, skinShopItemDrafts]);

  // --- Effects: polling, lazy rank load, and draft sync ---------------------

  useEffect(() => {
    void loadOverview();
    const interval = window.setInterval(() => void loadOverview(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [loadOverview]);

  useEffect(() => {
    if (activeSection !== 'players' || rankUsersLoaded || rankUsersLoading) return;
    void loadRankUsers('', 1);
  }, [activeSection, loadRankUsers, rankUsersLoaded, rankUsersLoading]);

  useEffect(() => {
    setGlobalNotificationDraft(overview?.globalNotification?.message ?? '');
  }, [overview?.globalNotification?.message]);

  useEffect(() => {
    if (!overview?.rankedSeason || rankedSeasonDraftDirty) return;
    setRankedSeasonDraft({
      mode: overview.rankedSeason.mode,
      seasonNumber: overview.rankedSeason.seasonNumber.toString(),
      endsAtLocal: toDateTimeLocalValue(overview.rankedSeason.endsAt),
    });
  }, [
    overview?.rankedSeason?.endsAt,
    overview?.rankedSeason?.mode,
    overview?.rankedSeason?.seasonNumber,
    rankedSeasonDraftDirty,
  ]);

  useEffect(() => {
    if (!overview?.rankedEntryGate || rankedEntryGateDraftDirty) return;
    setRankedEntryGateDraft({
      mode: overview.rankedEntryGate.mode,
      tokenMintAddress: overview.rankedEntryGate.tokenMintAddress ?? '',
      tokenSymbol: overview.rankedEntryGate.tokenSymbol || '',
      requiredTokenAmount: overview.rankedEntryGate.requiredTokenAmount || '0',
    });
  }, [
    overview?.rankedEntryGate?.mode,
    overview?.rankedEntryGate?.requiredTokenAmount,
    overview?.rankedEntryGate?.tokenMintAddress,
    overview?.rankedEntryGate?.tokenSymbol,
    rankedEntryGateDraftDirty,
  ]);

  useEffect(() => {
    if ((!overview?.rewardEconomy && !overview?.goldenBiomeRewards) || rewardEconomyDraftDirty) return;
    setRewardEconomyDraft(rewardEconomyDraftFromOverview(
      overview.rewardEconomy,
      overview.goldenBiomeRewards,
    ));
  }, [
    overview?.goldenBiomeRewards?.settings.chanceBps,
    overview?.goldenBiomeRewards?.settings.distributionMode,
    overview?.goldenBiomeRewards?.settings.enabled,
    overview?.goldenBiomeRewards?.settings.treasuryMinLamports,
    overview?.goldenBiomeRewards?.settings.winnerRewardLamports,
    overview?.rewardEconomy,
    rewardEconomyDraftDirty,
  ]);

  useEffect(() => {
    if (!overview?.skinShop?.shop || skinShopDraftDirty) return;
    setSkinShopDraft({
      enabled: overview.skinShop.shop.enabled,
      tokenMintAddress: overview.skinShop.shop.tokenMintAddress ?? '',
      tokenSymbol: overview.skinShop.shop.tokenSymbol || '',
      cluster: overview.skinShop.shop.cluster || 'devnet',
    });
  }, [
    overview?.skinShop?.shop?.cluster,
    overview?.skinShop?.shop?.enabled,
    overview?.skinShop?.shop?.tokenMintAddress,
    overview?.skinShop?.shop?.tokenSymbol,
    skinShopDraftDirty,
  ]);

  useEffect(() => {
    if (!overview?.skinShop?.items) return;
    setSkinShopItemDrafts((current) => {
      const next = { ...current };
      for (const item of overview.skinShop.items) {
        if (skinShopItemDraftDirtyById[item.settings.skinId]) continue;
        next[item.settings.skinId] = {
          saleEnabled: item.settings.saleEnabled,
          tokenAmountBaseUnits: item.settings.tokenAmountBaseUnits ?? '',
          maxSupply: item.settings.maxSupply?.toString() ?? '',
          expectedPriceVersion: item.settings.priceVersion,
        };
      }
      return next;
    });
  }, [overview?.skinShop?.items, skinShopItemDraftDirtyById]);

  return useMemo(() => ({
    overview,
    error,
    loading,
    loadOverview,
    // reports
    busyReportId,
    updateReportStatus,
    applyReportAccountAction,
    // golden
    busyGoldenRewardId,
    busyGoldenMode,
    setGoldenDistributionMode,
    distributeGoldenReward,
    // global notification
    globalNotificationDraft,
    setGlobalNotificationDraft,
    busyGlobalNotification,
    saveGlobalNotification,
    removeGlobalNotification,
    // ranked season
    rankedSeasonDraft,
    updateRankedSeasonDraft,
    busyRankedSeason,
    saveRankedSeason,
    // ranked entry gate
    rankedEntryGateDraft,
    updateRankedEntryGateDraft,
    busyRankedEntryGate,
    saveRankedEntryGate,
    // reward economy
    rewardEconomyDraft,
    rewardEconomyDraftDirty,
    updateRewardEconomyDraft,
    busyRewardEconomy,
    saveRewardEconomy,
    // skin shop
    skinShopDraft,
    updateSkinShopDraft,
    busySkinShopSettings,
    saveSkinShopSettings,
    skinShopItemDrafts,
    skinShopItemDraftDirtyById,
    updateSkinShopItemDraft,
    busySkinShopItemId,
    saveSkinShopItem,
    // ranks
    rankSearch,
    setRankSearch,
    rankReason,
    setRankReason,
    rankUsers,
    rankUsersPagination,
    rankUserDrafts,
    rankUsersLoading,
    busyRankUserId,
    searchRankUsers,
    clearRankUserSearch,
    changeRankUserPage,
    updateRankUserDraft,
    saveRankUser,
  }), [
    overview, error, loading, loadOverview,
    busyReportId, updateReportStatus, applyReportAccountAction,
    busyGoldenRewardId, busyGoldenMode, setGoldenDistributionMode, distributeGoldenReward,
    globalNotificationDraft, busyGlobalNotification, saveGlobalNotification, removeGlobalNotification,
    rankedSeasonDraft, updateRankedSeasonDraft, busyRankedSeason, saveRankedSeason,
    rankedEntryGateDraft, updateRankedEntryGateDraft, busyRankedEntryGate, saveRankedEntryGate,
    rewardEconomyDraft, rewardEconomyDraftDirty, updateRewardEconomyDraft, busyRewardEconomy, saveRewardEconomy,
    skinShopDraft, updateSkinShopDraft, busySkinShopSettings, saveSkinShopSettings,
    skinShopItemDrafts, skinShopItemDraftDirtyById, updateSkinShopItemDraft, busySkinShopItemId, saveSkinShopItem,
    rankSearch, rankReason, rankUsers, rankUsersPagination, rankUserDrafts, rankUsersLoading, busyRankUserId,
    searchRankUsers, clearRankUserSearch, changeRankUserPage, updateRankUserDraft, saveRankUser,
  ]);
}

export type AdminConsoleController = ReturnType<typeof useAdminConsole>;
