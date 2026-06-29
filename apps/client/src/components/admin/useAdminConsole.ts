import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminApiError, adminGet, adminPost } from './api';
import type {
  AccountActionRequest,
  AdminOverview,
  RankedEntryGateUpdate,
  RankedSeasonUpdate,
  RewardEconomyUpdate,
  SkinShopItemUpdate,
  SkinShopSettingsUpdate,
  UpdateRankRequest,
  UpdateReportStatusRequest,
  UsersListResponse,
} from './types';

const USERS_PAGE_SIZE = 25;

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
  saveRewardEconomy: (body: RewardEconomyUpdate) => Promise<MutationResult>;
  setGoldenDistributionMode: (mode: 'manual' | 'auto') => Promise<MutationResult>;
  distributeGoldenReward: (rewardId: string) => Promise<MutationResult>;
  saveSkinShopSettings: (body: SkinShopSettingsUpdate) => Promise<MutationResult>;
  saveSkinShopItem: (skinId: string, body: SkinShopItemUpdate) => Promise<MutationResult>;
  retrySkinNftMint: (intentId: string) => Promise<MutationResult>;
  syncSkinNftUser: (userId: string) => Promise<MutationResult>;
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

  const saveRewardEconomy = useCallback(
    (body: RewardEconomyUpdate) =>
      runMutation('Reward economy', (csrf) => adminPost('/reward-economy', body, csrf)),
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

  const retrySkinNftMint = useCallback(
    (intentId: string) =>
      runMutation('NFT mint retry', (csrf) =>
        adminPost(`/skin-shop/nft/retry/${encodeURIComponent(intentId)}`, {}, csrf)
      ),
    [runMutation]
  );

  const syncSkinNftUser = useCallback(
    (userId: string) =>
      runMutation('NFT wallet sync', (csrf) =>
        adminPost('/skin-shop/nft/sync-user', { userId }, csrf)
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
    updateUserRank,
    updateReportStatus,
    createAccountAction,
    setGlobalNotification,
    removeGlobalNotification,
    saveRankedSeason,
    saveRankedEntryGate,
    saveRewardEconomy,
    setGoldenDistributionMode,
    distributeGoldenReward,
    saveSkinShopSettings,
    saveSkinShopItem,
    retrySkinNftMint,
    syncSkinNftUser,
  };
}
