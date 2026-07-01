import type {
  DailyMissionAdminOverview,
  DailyMissionCriteria,
  DailyMissionDefinitionSnapshot,
  DailyMissionEligibility,
  DailyMissionRewardBundle,
  HeroSkinDefinition,
  HeroSkinId,
} from '@voxel-strike/shared';

/**
 * Types for the admin API surface (`/admin/api/*`), matched to the server's
 * actual serialized payloads.
 *
 * IMPORTANT: lamport / token-base-unit amounts are serialized BigInts and
 * therefore arrive as **strings**. Use the numeric helpers in `format.ts`
 * (which accept `string | number`) when displaying or computing with them.
 */

export type SectionId =
  | 'overview'
  | 'live-ops'
  | 'missions'
  | 'players'
  | 'economy'
  | 'infrastructure'
  | 'anti-cheat';

/** A stringified BigInt (lamports / token base units). */
export type LamportString = string;

/* ----------------------------- Overview ----------------------------- */

/**
 * The single SPL game token, configured server-side via deployment env. Every
 * feature (ranked gate, skin shop, …) references this one token — features no
 * longer carry their own token configuration. Read-only in the console.
 */
export interface GameTokenConfig {
  mintAddress: string | null;
  symbol: string;
  cluster: string;
  rpcConfigured: boolean;
}

export interface AdminIdentity {
  userId: string;
  name: string;
  walletAddress: string;
  elevatedAntiCheatRole: boolean;
  csrfToken: string;
}

export interface AdminTotals {
  runningMachines: number;
  serverProcesses: number;
  totalConnectedClients: number;
  playersInGame: number;
  botsInGame: number;
  participantsInGame: number;
  gameRooms: number;
  lobbyRooms: number;
  lobbyParticipants: number;
}

export interface AdminCapacity {
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
  source: 'live' | 'room_metrics' | 'bootstrap';
  machines: unknown[];
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
}

export interface GameRoomSummary {
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

export interface LobbyRoomSummary {
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

export interface AdminDiagnostics {
  distributed: boolean;
  routingStrategy: string;
  roomCreateStrategy: string;
  redis: { ok: boolean; status: string; error?: string };
  flyReplay: {
    enabled: boolean;
    registered: boolean;
    appName: string | null;
    machineId: string | null;
    region: string | null;
  };
  localProcessId: string | null;
  warnings: string[];
}

/* ----------------------------- Live Ops ----------------------------- */

export interface GlobalNotification {
  id: string;
  message: string;
  updatedByUserId: string | null;
  updatedAt: string;
}

export type RankedSeasonMode = 'season' | 'preseason';

export interface RankedSeason {
  mode: RankedSeasonMode;
  seasonNumber: number;
  label: string;
  endsAt: string | null;
  updatedAt: string;
  updatedByUserId: string | null;
  lastResetAt: string | null;
}

export type RankedEntryGateMode = 'locked' | 'token_required';

export interface RankedEntryGate {
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

/* ----------------------------- Missions ----------------------------- */

export type MissionDefinition = DailyMissionDefinitionSnapshot;
export type MissionsAdminOverview = DailyMissionAdminOverview;

export interface MissionDefinitionUpdate {
  displayName: string;
  description: string;
  enabled: boolean;
  sortOrder: number;
  activeStartsAt: string | null;
  activeEndsAt: string | null;
  resetPolicy: 'utc';
  criteria: DailyMissionCriteria;
  rewards: DailyMissionRewardBundle;
  eligibility: DailyMissionEligibility;
}

/* ----------------------------- Players ------------------------------ */

export type PlayerReportStatus =
  | 'open'
  | 'reviewing'
  | 'cleared'
  | 'actioned'
  | 'dismissed';

export interface PlayerReportUser {
  id: string;
  name: string;
  walletAddress: string | null;
}

export interface PlayerReport {
  id: string;
  status: PlayerReportStatus;
  reason: string;
  details: string | null;
  reporterUserId: string;
  reporterName: string;
  reporterUser: PlayerReportUser | null;
  targetUserId: string;
  targetName: string;
  targetTeam: string | null;
  targetUser: PlayerReportUser | null;
  roomId: string;
  matchId: string | null;
  lobbyId: string | null;
  matchMode: string | null;
  resolvedByUserId: string | null;
  resolvedByUser: PlayerReportUser | null;
  resolvedAt: string | null;
  resolution: string | null;
  actionType: string | null;
  accountActionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlayerReportQueue {
  reports: PlayerReport[];
  counts: Record<string, number>;
}

export interface RankInfo {
  label: string;
  tier: string;
  division: number;
  rating: number;
  minRating: number;
  maxRating: number | null;
  rangeLabel: string;
}

export interface RankOption extends RankInfo {}

export interface AdminUserRecord {
  id: string;
  name: string;
  walletAddress: string;
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
  rank: RankInfo;
  peakRank: RankInfo;
}

export interface UsersListResponse {
  query: string;
  ratingBounds: { min: number; max: number; default: number };
  rankOptions: RankOption[];
  users: AdminUserRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
}

/* ----------------------------- Economy ------------------------------ */

export interface PlayerRewardSettings {
  enabled: boolean;
  dailyRankedDripLamports: LamportString;
  dailyRankedDripMaxMatches: number;
  minMatchDurationMs: number;
  objectiveWinLamports: LamportString;
  objectiveFlagCaptureLamports: LamportString;
  objectiveFlagReturnLamports: LamportString;
  objectiveAssistLamports: LamportString;
  maxPlayerMatchLamports: LamportString;
  maxMatchPayoutLamports: LamportString;
  treasuryReserveLamports: LamportString;
  payoutBatchSize: number;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

export interface WagerSettings {
  enabled: boolean;
  platformFeeBps: number;
  updatedByUserId: string | null;
  updatedAt: string;
}

export interface RewardEconomy {
  rewardTokenSymbol: string | null;
  playerRewards: PlayerRewardSettings;
  wagers: WagerSettings;
}

export type GoldenDistributionMode = 'manual' | 'auto';
export type GoldenRewardStatus = 'pending' | 'processing' | 'complete' | 'failed';

export interface GoldenBiomeSettings {
  distributionMode: GoldenDistributionMode;
  enabled: boolean;
  chanceBps: number;
  winnerRewardLamports: LamportString;
  treasuryMinLamports: LamportString;
  treasuryWallet: string | null;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

export interface GoldenBiomeTreasury {
  eligible: boolean;
  enabled: boolean;
  treasuryWallet: string | null;
  treasuryBalanceLamports: LamportString;
  requiredLamports: LamportString;
  solUsdPriceMicroUsd: LamportString;
  checkedAt: string;
  reason?: string;
}

export interface GoldenRewardTransfer {
  id: string;
  userId: string;
  playerSessionId: string;
  displayName: string | null;
  recipientWallet: string;
  amountLamports: LamportString;
  signature: string | null;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  lastError: string | null;
  confirmedAt: string | null;
  updatedAt: string;
}

export interface GoldenReward {
  id: string;
  matchId: string;
  roomId: string;
  lobbyId: string | null;
  mapSeed: number;
  mapThemeId: string;
  winningTeam: string;
  treasuryWallet: string;
  rewardUsdCents: number;
  solUsdPriceMicroUsd: LamportString;
  rewardLamports: LamportString;
  totalRewardLamports: LamportString;
  paidPlayerCount: number;
  treasuryBalanceLamports: LamportString;
  status: GoldenRewardStatus;
  distributionMode: GoldenDistributionMode;
  distributedByUserId: string | null;
  distributedAt: string | null;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  transfers: GoldenRewardTransfer[];
}

export interface GoldenBiomeAdminOverview {
  settings: GoldenBiomeSettings;
  treasury: GoldenBiomeTreasury;
  rewards: GoldenReward[];
}

/* Skin shop */
export interface SkinShopSettings {
  enabled: boolean;
  tokenMintAddress: string | null;
  tokenSymbol: string;
  treasuryWallet: string | null;
  cluster: string;
  rpcConfigured: boolean;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

export interface SkinShopItemSettings {
  skinId: HeroSkinId;
  saleEnabled: boolean;
  tokenAmountBaseUnits: LamportString | null;
  maxSupply: number | null;
  soldCount: number;
  reservedCount: number;
  remainingSupply: number | null;
  priceVersion: number;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

export type SkinDefinition = HeroSkinDefinition;

export interface SkinShopItem {
  skin: SkinDefinition;
  settings: SkinShopItemSettings;
  lastAudit: unknown | null;
}

export interface SkinShopOverview {
  shop: SkinShopSettings;
  items: SkinShopItem[];
}

/* ----------------------------- Anti-Cheat --------------------------- */

export interface AntiCheatReview {
  cases?: unknown[];
  rankedHolds?: unknown[];
  accountActions?: unknown[];
  [key: string]: unknown;
}

/* ----------------------------- Root --------------------------------- */

export interface AdminOverview {
  generatedAt: string;
  status: 'ok' | 'degraded';
  admin: AdminIdentity;
  gameToken: GameTokenConfig;
  totals: AdminTotals;
  capacity: AdminCapacity;
  machines: MachineOverview[];
  rooms: { game: GameRoomSummary[]; lobbies: LobbyRoomSummary[] };
  diagnostics: AdminDiagnostics;
  antiCheat: AntiCheatReview;
  playerReports: PlayerReportQueue;
  rewardEconomy: RewardEconomy;
  goldenBiomeRewards: GoldenBiomeAdminOverview;
  globalNotification: GlobalNotification | null;
  rankedSeason: RankedSeason;
  rankedEntryGate: RankedEntryGate;
  missions: MissionsAdminOverview;
  skinShop: SkinShopOverview;
}

/* ----------------------- Request payloads --------------------------- */

export interface UpdateRankRequest {
  competitiveRating: number;
  reason?: string;
}

export interface UpdateReportStatusRequest {
  status: 'reviewing' | 'cleared' | 'dismissed';
  note?: string;
}

export type AccountActionType = 'suspension' | 'ban' | 'lift_suspension' | 'lift_ban';

export interface AccountActionRequest {
  actionType: AccountActionType;
  reason: string;
  expiresAt?: string;
}

/** Reward economy update. Lamport fields are sent as strings or numbers. */
export interface RewardEconomyUpdate {
  playerRewards?: Record<string, unknown>;
  wagers?: Record<string, unknown>;
  goldenBiome?: Record<string, unknown>;
}

export interface SeasonTopTenPayoutRequest {
  mode: RankedSeasonMode;
  seasonNumber: number;
  amountLamports: string | number;
}

export interface RankedSeasonUpdate {
  mode: RankedSeasonMode;
  seasonNumber: number;
  endsAt?: string | null;
}

export interface RankedEntryGateUpdate {
  mode: RankedEntryGateMode;
  requiredTokenAmount?: number;
}

export type MissionDefinitionRequest = MissionDefinitionUpdate;

export interface MissionReorderRequest {
  items: Array<{ id: string; sortOrder: number }>;
}

export interface SkinShopSettingsUpdate {
  enabled: boolean;
}

export interface SkinShopItemUpdate {
  saleEnabled: boolean;
  tokenAmountBaseUnits: string | number;
  maxSupply?: number | null;
  expectedPriceVersion: number;
}
