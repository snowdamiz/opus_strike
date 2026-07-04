import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminApiError, adminGet, adminPost } from './api';
import type {
  AccountActionRequest,
  AdminOverview,
  EventBiomeUpdate,
  ForcePlayerRewardPayoutRequest,
  MapPoolTopUpRequest,
  MapPoolTopUpResponse,
  MissionDefinitionRequest,
  MissionReorderRequest,
  RankedBrCombatRewardPayoutsResponse,
  RankedEntryGateUpdate,
  RankedSeasonUpdate,
  RewardEconomyUpdate,
  SeasonTopTenPayoutRequest,
  SkinShopItemUpdate,
  SkinShopSettingsUpdate,
  UpdateRankRequest,
  UpdateReportStatusRequest,
  UsersListResponse,
} from './types';

const USERS_PAGE_SIZE = 25;
const RANKED_BR_PAYOUTS_PAGE_SIZE = 50;

export interface Notice {
  id: number;
  type: 'success' | 'error';
  message: string;
}

export type MutationResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface UseAdminConsole {
  overview: AdminOverview | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
  refresh: () => Promise<void>;
  notices: Notice[];
  dismissNotice: (id: number) => void;

  // Users
  users: UsersListResponse | null;
  usersLoading: boolean;
  usersError: string | null;
  loadUsers: (opts?: { page?: number; query?: string }) => Promise<void>;

  // Ranked BR SOL rewards
  rankedBrPayouts: RankedBrCombatRewardPayoutsResponse | null;
  rankedBrPayoutsLoading: boolean;
  rankedBrPayoutsError: string | null;
  loadRankedBrPayouts: (opts?: { page?: number; limit?: number }) => Promise<void>;

  // Mutations
  updateUserRank: (userId: string, body: UpdateRankRequest) => Promise<MutationResult>;
  updateReportStatus: (
    reportId: string,
    body: UpdateReportStatusRequest
  ) => Promise<MutationResult>;
  createAccountAction: (
    reportId: string,
    body: AccountActionRequest
  ) => Promise<MutationResult>;
  setGlobalNotification: (message: string) => Promise<MutationResult>;
  removeGlobalNotification: () => Promise<MutationResult>;
  saveRankedSeason: (body: RankedSeasonUpdate) => Promise<MutationResult>;
  saveRankedEntryGate: (body: RankedEntryGateUpdate) => Promise<MutationResult>;
  createMission: (body: MissionDefinitionRequest) => Promise<MutationResult>;
  saveMission: (missionId: string, body: MissionDefinitionRequest) => Promise<MutationResult>;
  archiveMission: (missionId: string) => Promise<MutationResult>;
  duplicateMission: (missionId: string) => Promise<MutationResult>;
  reorderMissions: (body: MissionReorderRequest) => Promise<MutationResult>;
  saveRewardEconomy: (body: RewardEconomyUpdate) => Promise<MutationResult>;
  settleSeasonTopTenPayout: (body: SeasonTopTenPayoutRequest) => Promise<MutationResult>;
  forcePlayerRewardPayout: (body: ForcePlayerRewardPayoutRequest) => Promise<MutationResult>;
  setGoldenDistributionMode: (mode: 'manual' | 'auto') => Promise<MutationResult>;
  distributeGoldenReward: (rewardId: string) => Promise<MutationResult>;
  saveSkinShopSettings: (body: SkinShopSettingsUpdate) => Promise<MutationResult>;
  saveSkinShopItem: (skinId: string, body: SkinShopItemUpdate) => Promise<MutationResult>;
  saveEventBiome: (body: EventBiomeUpdate) => Promise<MutationResult>;
  topUpMapPool: (body?: MapPoolTopUpRequest) => Promise<MutationResult<MapPoolTopUpResponse>>;
}

export function useAdminConsole(): UseAdminConsole {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);

  const [users, setUsers] = useState<UsersListResponse | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [rankedBrPayouts, setRankedBrPayouts] = useState<RankedBrCombatRewardPayoutsResponse | null>(null);
  const [rankedBrPayoutsLoading, setRankedBrPayoutsLoading] = useState(false);
  const [rankedBrPayoutsError, setRankedBrPayoutsError] = useState<string | null>(null);

  const csrfRef = useRef<string>('');
  const inFlightRef = useRef(false);
  const noticeIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const pushNotice = useCallback((type: Notice['type'], message: string) => {
    const id = (noticeIdRef.current += 1);
    setNotices((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setNotices((prev) => prev.filter((n) => n.id !== id));
    }, type === 'error' ? 7000 : 4000);
  }, []);

  const dismissNotice = useCallback((id: number) => {
    setNotices((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setRefreshing(true);
    try {
      const data = await adminGet<AdminOverview>('/overview');
      if (!mountedRef.current) return;
      csrfRef.current = data.admin?.csrfToken ?? csrfRef.current;
      setOverview(data);
      setLastUpdatedAt(Date.now());
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      const message = err instanceof AdminApiError ? err.message : 'Failed to load overview';
      setError(message);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
      inFlightRef.current = false;
    }
  }, []);

  // Initial load. Operators can manually refresh; mutations refresh after saving.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadUsers = useCallback(
    async (opts?: { page?: number; query?: string }) => {
      const page = Math.max(1, opts?.page ?? 1);
      const query = (opts?.query ?? '').trim().slice(0, 128);
      setUsersLoading(true);
      setUsersError(null);
      try {
        const params = new URLSearchParams({
          limit: String(USERS_PAGE_SIZE),
          page: String(page),
        });
        if (query) params.set('query', query);
        const data = await adminGet<UsersListResponse>(`/users?${params.toString()}`);
        if (!mountedRef.current) return;
        setUsers(data);
      } catch (err) {
        if (!mountedRef.current) return;
        const message = err instanceof AdminApiError ? err.message : 'Failed to load users';
        setUsersError(message);
      } finally {
        if (mountedRef.current) setUsersLoading(false);
      }
    },
    []
  );

  const loadRankedBrPayouts = useCallback(
    async (opts?: { page?: number; limit?: number }) => {
      const page = Math.max(1, opts?.page ?? 1);
      const limit = Math.max(1, opts?.limit ?? RANKED_BR_PAYOUTS_PAGE_SIZE);
      setRankedBrPayoutsLoading(true);
      setRankedBrPayoutsError(null);
      try {
        const params = new URLSearchParams({
          limit: String(limit),
          page: String(page),
        });
        const data = await adminGet<RankedBrCombatRewardPayoutsResponse>(
          `/reward-economy/ranked-br-payouts?${params.toString()}`
        );
        if (!mountedRef.current) return;
        setRankedBrPayouts(data);
      } catch (err) {
        if (!mountedRef.current) return;
        const message = err instanceof AdminApiError
          ? err.message
          : 'Failed to load ranked BR payouts';
        setRankedBrPayoutsError(message);
      } finally {
        if (mountedRef.current) setRankedBrPayoutsLoading(false);
      }
    },
    []
  );

  const runMutation = useCallback(
    async <T,>(label: string, fn: (csrf: string) => Promise<T>): Promise<MutationResult<T>> => {
      try {
        const data = await fn(csrfRef.current);
        pushNotice('success', `${label} saved.`);
        await refresh();
        return { ok: true, data };
      } catch (err) {
        const message = err instanceof AdminApiError ? err.message : 'Unexpected error';
        pushNotice('error', `${label} failed: ${message}`);
        return { ok: false, error: message };
      }
    },
    [pushNotice, refresh]
  );

  const updateUserRank = useCallback(
    (userId: string, body: UpdateRankRequest) =>
      runMutation('Rank update', (csrf) =>
        adminPost(`/users/${encodeURIComponent(userId)}/rank`, body, csrf)
      ),
    [runMutation]
  );

  const updateReportStatus = useCallback(
    (reportId: string, body: UpdateReportStatusRequest) =>
      runMutation('Report status', (csrf) =>
        adminPost(`/player-reports/${encodeURIComponent(reportId)}/status`, body, csrf)
      ),
    [runMutation]
  );

  const createAccountAction = useCallback(
    (reportId: string, body: AccountActionRequest) =>
      runMutation('Account action', (csrf) =>
        adminPost(`/player-reports/${encodeURIComponent(reportId)}/account-actions`, body, csrf)
      ),
    [runMutation]
  );

  const setGlobalNotification = useCallback(
    (message: string) =>
      runMutation('Global notification', (csrf) =>
        adminPost('/global-notification', { message }, csrf)
      ),
    [runMutation]
  );

  const removeGlobalNotification = useCallback(
    () =>
      runMutation('Notification removal', (csrf) =>
        adminPost('/global-notification/remove', {}, csrf)
      ),
    [runMutation]
  );

  const saveRankedSeason = useCallback(
    (body: RankedSeasonUpdate) =>
      runMutation('Ranked season', (csrf) => adminPost('/ranked-season', body, csrf)),
    [runMutation]
  );

  const saveRankedEntryGate = useCallback(
    (body: RankedEntryGateUpdate) =>
      runMutation('Ranked entry gate', (csrf) => adminPost('/ranked-entry-gate', body, csrf)),
    [runMutation]
  );

  const createMission = useCallback(
    (body: MissionDefinitionRequest) =>
      runMutation('Mission', (csrf) => adminPost('/missions', body, csrf)),
    [runMutation]
  );

  const saveMission = useCallback(
    (missionId: string, body: MissionDefinitionRequest) =>
      runMutation('Mission', (csrf) =>
        adminPost(`/missions/${encodeURIComponent(missionId)}`, body, csrf)
      ),
    [runMutation]
  );

  const archiveMission = useCallback(
    (missionId: string) =>
      runMutation('Mission archive', (csrf) =>
        adminPost(`/missions/${encodeURIComponent(missionId)}/archive`, {}, csrf)
      ),
    [runMutation]
  );

  const duplicateMission = useCallback(
    (missionId: string) =>
      runMutation('Mission duplicate', (csrf) =>
        adminPost(`/missions/${encodeURIComponent(missionId)}/duplicate`, {}, csrf)
      ),
    [runMutation]
  );

  const reorderMissions = useCallback(
    (body: MissionReorderRequest) =>
      runMutation('Mission order', (csrf) => adminPost('/missions/reorder', body, csrf)),
    [runMutation]
  );

  const saveRewardEconomy = useCallback(
    (body: RewardEconomyUpdate) =>
      runMutation('Reward economy', (csrf) => adminPost('/reward-economy', body, csrf)),
    [runMutation]
  );

  const settleSeasonTopTenPayout = useCallback(
    (body: SeasonTopTenPayoutRequest) =>
      runMutation('Season top 10 payout', (csrf) =>
        adminPost('/reward-economy/season-top-10', body, csrf)
      ),
    [runMutation]
  );

  const forcePlayerRewardPayout = useCallback(
    (body: ForcePlayerRewardPayoutRequest) =>
      runMutation('Force reward payout', (csrf) =>
        adminPost('/reward-economy/force-payout', body, csrf)
      ),
    [runMutation]
  );

  const setGoldenDistributionMode = useCallback(
    (mode: 'manual' | 'auto') =>
      runMutation('Distribution mode', (csrf) =>
        adminPost('/golden-biome/distribution-mode', { mode }, csrf)
      ),
    [runMutation]
  );

  const distributeGoldenReward = useCallback(
    (rewardId: string) =>
      runMutation('Golden reward distribution', (csrf) =>
        adminPost(`/golden-biome/rewards/${encodeURIComponent(rewardId)}/distribute`, {}, csrf)
      ),
    [runMutation]
  );

  const saveSkinShopSettings = useCallback(
    (body: SkinShopSettingsUpdate) =>
      runMutation('Skin shop settings', (csrf) => adminPost('/skin-shop/settings', body, csrf)),
    [runMutation]
  );

  const saveSkinShopItem = useCallback(
    (skinId: string, body: SkinShopItemUpdate) =>
      runMutation('Skin item', (csrf) =>
        adminPost(`/skin-shop/items/${encodeURIComponent(skinId)}`, body, csrf)
      ),
    [runMutation]
  );

  const saveEventBiome = useCallback(
    (body: EventBiomeUpdate) =>
      runMutation('Event biome', (csrf) => adminPost('/event-biome', body, csrf)),
    [runMutation]
  );

  const topUpMapPool = useCallback(
    (body?: MapPoolTopUpRequest) =>
      runMutation('Map pool top-up', (csrf) =>
        adminPost<MapPoolTopUpResponse>('/map-pool/top-up', body ?? {}, csrf)
      ),
    [runMutation]
  );

  return {
    overview,
    loading,
    refreshing,
    error,
    lastUpdatedAt,
    refresh,
    notices,
    dismissNotice,
    users,
    usersLoading,
    usersError,
    loadUsers,
    rankedBrPayouts,
    rankedBrPayoutsLoading,
    rankedBrPayoutsError,
    loadRankedBrPayouts,
    updateUserRank,
    updateReportStatus,
    createAccountAction,
    setGlobalNotification,
    removeGlobalNotification,
    saveRankedSeason,
    saveRankedEntryGate,
    createMission,
    saveMission,
    archiveMission,
    duplicateMission,
    reorderMissions,
    saveRewardEconomy,
    settleSeasonTopTenPayout,
    forcePlayerRewardPayout,
    setGoldenDistributionMode,
    distributeGoldenReward,
    saveSkinShopSettings,
    saveSkinShopItem,
    saveEventBiome,
    topUpMapPool,
  };
}
