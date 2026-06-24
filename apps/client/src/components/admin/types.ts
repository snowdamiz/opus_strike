// Shared types for the admin console. These mirror the payloads returned by the
// existing admin endpoints (apps/server/src/admin/routes.ts) and are intentionally
// kept independent from the legacy AdminDashboard so the two can evolve separately.

export interface MachineProcess {
  processId: string;
  pid: number;
  updatedAtMs: number;
  loadAvg1: number;
  loadPct1: number;
  memoryRssBytes: number;
  heapUsedBytes: number;
  processCpuUtilization: number;
  eventLoopDelayP95Ms: number;
  capacityPressure: number;
  localCcu: number;
  localGamePlayers: number;
  localGameBots: number;
  localGameRoomCount: number;
  localLobbyRoomCount: number;
  matchmakerQueryUp: boolean;
  matchmakerError: string | null;
}

export interface MachineOverview {
  machineId: string;
  region: string | null;
  appName: string | null;
  processCount: number;
  latestUpdatedAtMs: number;
  loadAvg1: number;
  loadPct1: number;
  cpuCount: number;
  memoryRssBytes: number;
  systemFreeMemoryBytes: number;
  systemTotalMemoryBytes: number;
  capacityPressure: number;
  dynamicCapacityPlayers: number;
  dynamicCapacitySource: 'live' | 'room_metrics' | 'bootstrap' | null;
  eventLoopDelayP95Ms: number;
  processCpuUtilization: number;
  localCcu: number;
  gameRoomCount: number;
  lobbyRoomCount: number;
  playersInGame: number;
  botsInGame: number;
  participantsInGame: number;
  lobbyParticipants: number;
  processes: MachineProcess[];
}

export interface GameRoomOverview {
  roomId: string;
  processId: string | null;
  machineId: string;
  publicAddress: string | null;
  clients: number;
  maxClients: number;
  players: number;
  bots: number;
  participants: number;
  phase: string;
  matchMode: string;
  lobbyId: string | null;
}

export interface LobbyRoomOverview {
  roomId: string;
  processId: string | null;
  machineId: string;
  publicAddress: string | null;
  name: string;
  clients: number;
  maxClients: number;
  participants: number;
  humans: number;
  bots: number;
  status: string;
  matchMode: string;
  isPublic: boolean;
}

export interface PlayerReportOverview {
  id: string;
  status: string;
  reason: string;
  details: string | null;
  reporterUserId: string;
  reporterPlayerSessionId: string;
  reporterName: string;
  reporterUser: { id: string; name: string; walletAddress: string | null } | null;
  targetUserId: string;
  targetPlayerSessionId: string;
  targetName: string;
  targetTeam: string | null;
  targetUser: { id: string; name: string; walletAddress: string | null } | null;
  roomId: string;
  matchId: string | null;
  lobbyId: string | null;
  matchMode: string | null;
  mapSeed: number | null;
  serverTick: number;
  evidenceEventId: string | null;
  resolvedByUserId: string | null;
  resolvedByUser: { id: string; name: string; walletAddress: string | null } | null;
  resolvedAt: string | null;
  resolution: string | null;
  actionType: string | null;
  accountActionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type GoldenBiomeDistributionMode = 'manual' | 'auto';

export interface GoldenBiomeRewardTransferOverview {
  id: string;
  userId: string;
  playerSessionId: string;
  displayName: string | null;
  recipientWallet: string;
  amountLamports: string;
  signature: string | null;
  status: string;
  lastError: string | null;
  confirmedAt: string | null;
  updatedAt: string;
}

export interface GoldenBiomeRewardOverview {
  id: string;
  matchId: string;
  roomId: string;
  lobbyId: string | null;
  mapSeed: number;
  mapThemeId: string;
  winningTeam: string;
  treasuryWallet: string;
  rewardUsdCents: number;
  solUsdPriceMicroUsd: string;
  rewardLamports: string;
  totalRewardLamports: string;
  paidPlayerCount: number;
  treasuryBalanceLamports: string;
  status: string;
  distributionMode: GoldenBiomeDistributionMode;
  distributedByUserId: string | null;
  distributedAt: string | null;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  transfers: GoldenBiomeRewardTransferOverview[];
}

export interface GoldenBiomeRewardsOverview {
  settings: {
    distributionMode: GoldenBiomeDistributionMode;
    enabled: boolean;
    chanceBps: number;
    winnerRewardLamports: string;
    treasuryMinLamports: string;
    treasuryWallet: string | null;
    updatedByUserId: string | null;
    updatedAt: string | null;
  };
  treasury: {
    eligible: boolean;
    enabled: boolean;
    treasuryWallet: string | null;
    treasuryBalanceLamports: string;
    requiredLamports: string;
    solUsdPriceMicroUsd: string;
    checkedAt: string;
    reason?: string;
  };
  rewards: GoldenBiomeRewardOverview[];
}

export interface PlayerRewardSettingsOverview {
  enabled: boolean;
  dailyRankedDripLamports: string;
  dailyRankedDripMaxMatches: number;
  minMatchDurationMs: number;
  objectiveWinLamports: string;
  objectiveFlagCaptureLamports: string;
  objectiveFlagReturnLamports: string;
  objectiveAssistLamports: string;
  maxPlayerMatchLamports: string;
  maxMatchPayoutLamports: string;
  treasuryReserveLamports: string;
  payoutBatchSize: number;
  weeklyEnabled: boolean;
  weeklyPoolLamports: string;
  weeklyTopPlayers: number;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

export interface WagerEconomySettingsOverview {
  platformFeeBps: number;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

export interface RewardEconomyOverview {
  rewardTokenSymbol: string | null;
  playerRewards: PlayerRewardSettingsOverview;
  wagers: WagerEconomySettingsOverview;
}

export interface RewardEconomyDraft {
  enabled: boolean;
  dailyRankedDripLamports: string;
  dailyRankedDripMaxMatches: string;
  minMatchDurationMs: string;
  objectiveWinLamports: string;
  objectiveFlagCaptureLamports: string;
  objectiveFlagReturnLamports: string;
  objectiveAssistLamports: string;
  maxPlayerMatchLamports: string;
  maxMatchPayoutLamports: string;
  treasuryReserveLamports: string;
  payoutBatchSize: string;
  weeklyEnabled: boolean;
  weeklyPoolLamports: string;
  weeklyTopPlayers: string;
  platformFeeBps: string;
  goldenBiomeEnabled: boolean;
  goldenBiomeChanceBps: string;
  goldenBiomeWinnerRewardSol: string;
  goldenBiomeTreasuryMinSol: string;
  goldenBiomeDistributionMode: GoldenBiomeDistributionMode;
}

export interface GlobalNotificationOverview {
  id: string;
  message: string;
  updatedByUserId: string | null;
  updatedAt: string;
}

export type RankedSeasonMode = 'preseason' | 'season';
export type RankedEntryGateMode = 'locked' | 'token_required';

export interface RankedSeasonOverview {
  mode: RankedSeasonMode;
  seasonNumber: number;
  label: string;
  endsAt: string | null;
  updatedAt: string;
  updatedByUserId: string | null;
  lastResetAt: string | null;
}

export interface RankedSeasonDraft {
  mode: RankedSeasonMode;
  seasonNumber: string;
  endsAtLocal: string;
}

export interface RankedEntryGateOverview {
  mode: RankedEntryGateMode;
  tokenMintAddress: string | null;
  tokenAddress: string;
  tokenSymbol: string;
  requiredTokenAmount: string;
  cluster: string;
  rpcConfigured: boolean;
  updatedAt: string;
  updatedByUserId: string | null;
}

export interface RankedEntryGateDraft {
  mode: RankedEntryGateMode;
  tokenMintAddress: string;
  tokenSymbol: string;
  requiredTokenAmount: string;
}

export interface SkinShopSettingsOverview {
  enabled: boolean;
  tokenMintAddress: string | null;
  tokenSymbol: string;
  treasuryWallet: string | null;
  cluster: string;
  rpcConfigured: boolean;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

export interface SkinShopItemSettingsOverview {
  skinId: string;
  saleEnabled: boolean;
  tokenAmountBaseUnits: string | null;
  maxSupply: number | null;
  soldCount: number;
  reservedCount: number;
  remainingSupply: number | null;
  priceVersion: number;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

export interface SkinShopAuditOverview {
  id: string;
  updatedByUserId: string | null;
  createdAt: string;
  oldTokenAmountBaseUnits: string | null;
  newTokenAmountBaseUnits: string | null;
  oldMaxSupply: number | null;
  newMaxSupply: number | null;
  oldSaleEnabled: boolean | null;
  newSaleEnabled: boolean | null;
}

export interface SkinShopOverview {
  shop: SkinShopSettingsOverview;
  items: Array<{
    skin: {
      id: string;
      displayName: string;
      subtitle: string;
      rarity: string;
      availability: string;
      releaseState: string;
    };
    settings: SkinShopItemSettingsOverview;
    lastAudit: SkinShopAuditOverview | null;
  }>;
}

export interface SkinShopSettingsDraft {
  enabled: boolean;
  tokenMintAddress: string;
  tokenSymbol: string;
  cluster: string;
}

export interface SkinShopItemDraft {
  saleEnabled: boolean;
  tokenAmountBaseUnits: string;
  maxSupply: string;
  expectedPriceVersion: number;
}

export interface AdminRankSummary {
  label: string;
  tier: string;
  division: number | null;
  rating: number;
  minRating: number;
  maxRating: number | null;
  rangeLabel: string;
}

export interface AdminRankUser {
  id: string;
  name: string;
  walletAddress: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  totalGames: number;
  totalWins: number;
  totalLosses: number;
  totalDraws: number;
  competitiveRating: number;
  rankedGames: number;
  rankedWins: number;
  rankedLosses: number;
  rankedDraws: number;
  rankedPlacementsRemaining: number;
  rankedPeakRating: number;
  rankedLastMatchAt: string | null;
  rank: AdminRankSummary;
  peakRank: AdminRankSummary;
}

export interface AdminRankGate {
  label: string;
  tier: string;
  division: number;
  rating: number;
  minRating: number;
  maxRating: number | null;
  rangeLabel: string;
}

export interface AdminUsersPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface AdminUsersResponse {
  query: string;
  rankOptions: AdminRankGate[];
  users: AdminRankUser[];
  pagination: AdminUsersPagination;
}

export interface AdminOverview {
  generatedAt: string;
  status: 'ok' | 'degraded' | string;
  admin: {
    userId: string;
    name: string;
    walletAddress: string;
    elevatedAntiCheatRole?: boolean;
    csrfToken?: string;
  };
  totals: {
    runningMachines: number;
    serverProcesses: number;
    totalConnectedClients: number;
    playersInGame: number;
    botsInGame: number;
    participantsInGame: number;
    gameRooms: number;
    lobbyRooms: number;
    lobbyParticipants: number;
  };
  capacity: {
    playersPerMachine: number;
    maxMachines: number;
    maxPlayers: number;
    activePlayers: number;
    reservedPlayers: number;
    availablePlayers: number;
    full: boolean;
    capacityPressure: number;
    machineCount: number;
    projectedMachineCount: number;
    source: 'live' | 'room_metrics' | 'bootstrap' | string;
  };
  machines: MachineOverview[];
  rooms: {
    game: GameRoomOverview[];
    lobbies: LobbyRoomOverview[];
  };
  playerReports?: {
    reports: PlayerReportOverview[];
    counts: Record<string, number>;
  };
  rewardEconomy?: RewardEconomyOverview;
  goldenBiomeRewards?: GoldenBiomeRewardsOverview;
  globalNotification: GlobalNotificationOverview | null;
  rankedSeason: RankedSeasonOverview;
  rankedEntryGate: RankedEntryGateOverview;
  skinShop: SkinShopOverview;
  diagnostics: {
    distributed: boolean;
    routingStrategy: string;
    roomCreateStrategy: string;
    redis: {
      ok: boolean;
      status: string;
      error?: string;
    };
    flyReplay: {
      enabled: boolean;
      registered: boolean;
      appName: string | null;
      machineId: string | null;
      region: string | null;
    };
    localProcessId: string | null;
    warnings: string[];
  };
}

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export type AdminSectionId = 'overview' | 'liveOps' | 'players' | 'economy' | 'infrastructure';

export interface AdminSectionDef {
  id: AdminSectionId;
  label: string;
  hint: string;
}

export const ADMIN_RANK_PAGE_SIZE = 25;
export const ADMIN_SKIN_SUPPLY_CAP_MAX = 2_147_483_647;
export const ADMIN_MANUAL_RATING_MAX = 5000;

export const EMPTY_ADMIN_USERS_PAGINATION: AdminUsersPagination = {
  page: 1,
  limit: ADMIN_RANK_PAGE_SIZE,
  total: 0,
  totalPages: 1,
  hasPrevious: false,
  hasNext: false,
};
