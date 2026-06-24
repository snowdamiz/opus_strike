import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  RANK_DEFINITIONS,
  getRankFromRating,
} from '@voxel-strike/shared';
import { config } from '../../config/environment';
import { lamportsToSolDisplay } from '../../utils/sol';
import { RankBadge } from './RankBadge';

interface MachineProcess {
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

interface MachineOverview {
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

interface GameRoomOverview {
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

interface LobbyRoomOverview {
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

interface PlayerReportOverview {
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

type GoldenBiomeDistributionMode = 'manual' | 'auto';

interface GoldenBiomeRewardTransferOverview {
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

interface GoldenBiomeRewardOverview {
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

interface GoldenBiomeRewardsOverview {
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

interface PlayerRewardSettingsOverview {
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

interface WagerEconomySettingsOverview {
  platformFeeBps: number;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

interface RewardEconomyOverview {
  rewardTokenSymbol: string | null;
  playerRewards: PlayerRewardSettingsOverview;
  wagers: WagerEconomySettingsOverview;
}

interface RewardEconomyDraft {
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

interface GlobalNotificationOverview {
  id: string;
  message: string;
  updatedByUserId: string | null;
  updatedAt: string;
}

type RankedSeasonMode = 'preseason' | 'season';
type RankedEntryGateMode = 'locked' | 'token_required';
const ADMIN_RANK_PAGE_SIZE = 25;
const ADMIN_SKIN_SUPPLY_CAP_MAX = 2_147_483_647;

interface RankedSeasonOverview {
  mode: RankedSeasonMode;
  seasonNumber: number;
  label: string;
  endsAt: string | null;
  updatedAt: string;
  updatedByUserId: string | null;
  lastResetAt: string | null;
}

interface RankedSeasonDraft {
  mode: RankedSeasonMode;
  seasonNumber: string;
  endsAtLocal: string;
}

interface RankedEntryGateOverview {
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

interface RankedEntryGateDraft {
  mode: RankedEntryGateMode;
  tokenMintAddress: string;
  tokenSymbol: string;
  requiredTokenAmount: string;
}

interface SkinShopSettingsOverview {
  enabled: boolean;
  tokenMintAddress: string | null;
  tokenSymbol: string;
  treasuryWallet: string | null;
  cluster: string;
  rpcConfigured: boolean;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

interface SkinShopItemSettingsOverview {
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

interface SkinShopAuditOverview {
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

interface SkinShopOverview {
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

interface SkinShopSettingsDraft {
  enabled: boolean;
  tokenMintAddress: string;
  tokenSymbol: string;
  cluster: string;
}

interface SkinShopItemDraft {
  saleEnabled: boolean;
  tokenAmountBaseUnits: string;
  maxSupply: string;
  expectedPriceVersion: number;
}

interface AdminRankSummary {
  label: string;
  tier: string;
  division: number | null;
  rating: number;
  minRating: number;
  maxRating: number | null;
  rangeLabel: string;
}

interface AdminRankUser {
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

interface AdminRankGate {
  label: string;
  tier: string;
  division: number;
  rating: number;
  minRating: number;
  maxRating: number | null;
  rangeLabel: string;
}

interface AdminUsersPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

interface AdminUsersResponse {
  query: string;
  rankOptions: AdminRankGate[];
  users: AdminRankUser[];
  pagination: AdminUsersPagination;
}

const EMPTY_ADMIN_USERS_PAGINATION: AdminUsersPagination = {
  page: 1,
  limit: ADMIN_RANK_PAGE_SIZE,
  total: 0,
  totalPages: 1,
  hasPrevious: false,
  hasNext: false,
};

interface AdminOverview {
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

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value || 0);
}

function formatBytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let current = Math.max(0, value || 0);
  let index = 0;

  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index++;
  }

  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(current)} ${units[index]}`;
}

function formatAge(ms: number): string {
  if (!ms) return 'unknown';
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString();
}

function formatCompactIdentifier(value: string, head = 4, tail = 4): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function formatSeasonBoundary(mode: RankedSeasonMode, value: string | null): string {
  const fallback = mode === 'preseason' ? 'Next season TBA' : 'End date TBA';
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  const formattedDate = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return mode === 'preseason' ? `Next season begins ${formattedDate}` : `Ends ${formattedDate}`;
}

function toDateTimeLocalValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getRankedSeasonIdentity(mode: RankedSeasonMode, seasonNumber: number): string {
  return mode === 'preseason' ? 'preseason' : `season:${Math.max(1, Math.floor(seasonNumber || 1))}`;
}

function formatRankedEntryGateMode(mode: RankedEntryGateMode): string {
  return mode === 'token_required' ? 'Token Required' : 'Locked';
}

function isPositiveWholeNumberString(value: string): boolean {
  return /^[0-9]+$/.test(value.trim()) && BigInt(value.trim()) > 0n;
}

function isPositiveWholeNumberInRange(value: string, max: number): boolean {
  const trimmed = value.trim();
  return /^[0-9]+$/.test(trimmed) && BigInt(trimmed) > 0n && BigInt(trimmed) <= BigInt(max);
}

const ADMIN_MANUAL_RATING_MAX = 5000;

const RANK_OPTIONS = RANK_DEFINITIONS.flatMap((tier) => (
  tier.divisionThresholds.map((rating, index) => ({
    label: `${tier.label} ${index + 1}`,
    tier: tier.id,
    division: index + 1,
    rating,
  }))
)).map((option, index, options) => {
  const nextRating = options[index + 1]?.rating ?? null;
  const maxRating = nextRating === null ? null : nextRating - 1;
  return {
    ...option,
    minRating: option.rating,
    maxRating,
    rangeLabel: maxRating === null ? `${formatNumber(option.rating)}+` : `${formatNumber(option.rating)}-${formatNumber(maxRating)}`,
  };
});

function parseDraftRating(value: string): number | null {
  if (!value.trim()) return null;
  const rating = Math.round(Number(value));
  return Number.isFinite(rating) && rating >= 0 && rating <= ADMIN_MANUAL_RATING_MAX ? rating : null;
}

function getRankGateForRating(rating: number) {
  let current = RANK_OPTIONS[0];
  for (const option of RANK_OPTIONS) {
    if (rating >= option.minRating) current = option;
    else break;
  }
  return current;
}

function getRankPreview(value: string, rankedGames: number) {
  const rating = parseDraftRating(value);
  if (rating === null) {
    return {
      rating: null,
      label: 'Invalid rating',
      rangeLabel: '',
      gateLabel: '',
    };
  }

  const rank = getRankFromRating(rating, rankedGames);
  const gate = getRankGateForRating(rating);
  return {
    rating,
    label: rank.label,
    rangeLabel: gate.rangeLabel,
    gateLabel: gate.label,
  };
}

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.00$/, '')}%`;
}

function formatDraftBps(value: string): string {
  const bps = Number(value);
  return Number.isFinite(bps) ? formatBps(bps) : 'Invalid';
}

function parseDraftNumber(value: string): number | null {
  const number = Number(value.trim());
  return Number.isFinite(number) ? number : null;
}

function formatDraftWhole(value: string): string {
  const number = parseDraftNumber(value);
  return number === null ? 'Invalid' : formatNumber(Math.round(number));
}

function formatDraftTokenAmount(value: string, suffix: string): string {
  const number = parseDraftNumber(value);
  return number === null ? 'Invalid' : `${formatNumber(Math.round(number))} ${suffix}`;
}

function formatDraftTokenProduct(left: string, right: string, suffix: string): string {
  const leftNumber = parseDraftNumber(left);
  const rightNumber = parseDraftNumber(right);
  if (leftNumber === null || rightNumber === null) return 'Invalid';
  return `${formatNumber(Math.round(leftNumber * rightNumber))} ${suffix}`;
}

function formatDraftDuration(value: string): string {
  const milliseconds = parseDraftNumber(value);
  if (milliseconds === null) return 'Invalid duration';
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${formatNumber(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0 ? `${formatNumber(minutes)}m` : `${formatNumber(minutes)}m ${remainingSeconds}s`;
}

function solInputToLamports(value: string, fieldName: string): string {
  const trimmed = value.trim();
  const match = /^([0-9]+)(?:\.([0-9]{0,9}))?$/.exec(trimmed);
  if (!match) throw new Error(`${fieldName} must be a SOL amount with up to 9 decimals`);

  const whole = BigInt(match[1]);
  const fractional = BigInt((match[2] ?? '').padEnd(9, '0') || '0');
  return (whole * 1_000_000_000n + fractional).toString();
}

function rewardEconomyDraftFromOverview(
  rewardEconomy?: RewardEconomyOverview,
  goldenBiomeRewards?: GoldenBiomeRewardsOverview
): RewardEconomyDraft {
  const playerRewards = rewardEconomy?.playerRewards;
  const wagers = rewardEconomy?.wagers;
  const golden = goldenBiomeRewards?.settings;

  return {
    enabled: playerRewards?.enabled ?? true,
    dailyRankedDripLamports: playerRewards?.dailyRankedDripLamports ?? '20000',
    dailyRankedDripMaxMatches: String(playerRewards?.dailyRankedDripMaxMatches ?? 5),
    minMatchDurationMs: String(playerRewards?.minMatchDurationMs ?? 180000),
    objectiveWinLamports: playerRewards?.objectiveWinLamports ?? '10000',
    objectiveFlagCaptureLamports: playerRewards?.objectiveFlagCaptureLamports ?? '15000',
    objectiveFlagReturnLamports: playerRewards?.objectiveFlagReturnLamports ?? '5000',
    objectiveAssistLamports: playerRewards?.objectiveAssistLamports ?? '2000',
    maxPlayerMatchLamports: playerRewards?.maxPlayerMatchLamports ?? '50000',
    maxMatchPayoutLamports: playerRewards?.maxMatchPayoutLamports ?? '250000',
    treasuryReserveLamports: playerRewards?.treasuryReserveLamports ?? '1000000000',
    payoutBatchSize: String(playerRewards?.payoutBatchSize ?? 100),
    weeklyEnabled: playerRewards?.weeklyEnabled ?? true,
    weeklyPoolLamports: playerRewards?.weeklyPoolLamports ?? '1000000',
    weeklyTopPlayers: String(playerRewards?.weeklyTopPlayers ?? 10),
    platformFeeBps: String(wagers?.platformFeeBps ?? 500),
    goldenBiomeEnabled: golden?.enabled ?? true,
    goldenBiomeChanceBps: String(golden?.chanceBps ?? 200),
    goldenBiomeWinnerRewardSol: lamportsToSolDisplay(golden?.winnerRewardLamports ?? '200000000'),
    goldenBiomeTreasuryMinSol: lamportsToSolDisplay(golden?.treasuryMinLamports ?? '1000000000'),
    goldenBiomeDistributionMode: golden?.distributionMode ?? 'manual',
  };
}

function rewardEconomyPayloadFromDraft(draft: RewardEconomyDraft) {
  return {
    playerRewards: {
      enabled: draft.enabled,
      dailyRankedDripLamports: draft.dailyRankedDripLamports,
      dailyRankedDripMaxMatches: draft.dailyRankedDripMaxMatches,
      minMatchDurationMs: draft.minMatchDurationMs,
      objectiveWinLamports: draft.objectiveWinLamports,
      objectiveFlagCaptureLamports: draft.objectiveFlagCaptureLamports,
      objectiveFlagReturnLamports: draft.objectiveFlagReturnLamports,
      objectiveAssistLamports: draft.objectiveAssistLamports,
      maxPlayerMatchLamports: draft.maxPlayerMatchLamports,
      maxMatchPayoutLamports: draft.maxMatchPayoutLamports,
      treasuryReserveLamports: draft.treasuryReserveLamports,
      payoutBatchSize: draft.payoutBatchSize,
      weeklyEnabled: draft.weeklyEnabled,
      weeklyPoolLamports: draft.weeklyPoolLamports,
      weeklyTopPlayers: draft.weeklyTopPlayers,
    },
    wagers: {
      platformFeeBps: draft.platformFeeBps,
    },
    goldenBiome: {
      distributionMode: draft.goldenBiomeDistributionMode,
      enabled: draft.goldenBiomeEnabled,
      chanceBps: draft.goldenBiomeChanceBps,
      winnerRewardLamports: solInputToLamports(draft.goldenBiomeWinnerRewardSol, 'Golden winner payout'),
      treasuryMinLamports: solInputToLamports(draft.goldenBiomeTreasuryMinSol, 'Golden reserve'),
    },
  };
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'amber';
type AdminPageId = 'command' | 'liveOps' | 'players' | 'economy' | 'infrastructure';

interface MetricTileProps {
  label: string;
  value: string | number;
  sublabel?: string;
  tone?: Tone;
  meter?: number;
}

interface AdminPage {
  id: AdminPageId;
  label: string;
  eyebrow: string;
  meta: string;
  tone: Tone;
}

interface AdminSelectOption {
  value: string;
  label: string;
  detail?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value * 100));
}

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(value)} ${value === 1 ? singular : plural}`;
}

function formatDateAge(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 'unknown' : formatAge(timestamp);
}

function getActiveReportCount(overview: AdminOverview): number {
  return (overview.playerReports?.counts.open ?? 0) + (overview.playerReports?.counts.reviewing ?? 0);
}

function getPendingGoldenRewardCount(overview: AdminOverview): number {
  return overview.goldenBiomeRewards?.rewards.filter((reward) => reward.status !== 'complete').length ?? 0;
}

function getPurchasableSkinCount(overview: AdminOverview): number {
  return overview.skinShop.items.filter((item) => (
    item.settings.saleEnabled && item.settings.remainingSupply !== 0
  )).length;
}

function getTotalRoomCount(overview: AdminOverview): number {
  return overview.rooms.game.length + overview.rooms.lobbies.length;
}

function toneForSystemStatus(status: string): Tone {
  if (status === 'ok' || status === 'complete' || status === 'cleared') return 'success';
  if (status === 'degraded' || status === 'pending' || status === 'reviewing') return 'warning';
  if (status === 'failed' || status === 'ban') return 'danger';
  return 'neutral';
}

function toneForPressure(value: number): Tone {
  if (value >= 0.9) return 'danger';
  if (value >= 0.7) return 'warning';
  return 'info';
}

const pillToneClasses: Record<Tone, string> = {
  neutral: 'admin-pill--neutral',
  success: 'admin-pill--success',
  warning: 'admin-pill--warning',
  danger: 'admin-pill--danger',
  info: 'admin-pill--info',
  amber: 'admin-pill--amber',
};

const dotToneClasses: Record<Tone, string> = {
  neutral: 'admin-dot--neutral',
  success: 'admin-dot--success',
  warning: 'admin-dot--warning',
  danger: 'admin-dot--danger',
  info: 'admin-dot--info',
  amber: 'admin-dot--amber',
};

const meterToneClasses: Record<Tone, string> = {
  neutral: 'admin-meter--neutral',
  success: 'admin-meter--success',
  warning: 'admin-meter--warning',
  danger: 'admin-meter--danger',
  info: 'admin-meter--info',
  amber: 'admin-meter--amber',
};

function Pill({
  children,
  tone = 'neutral',
  withDot = false,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  withDot?: boolean;
  className?: string;
}) {
  return (
    <span className={cx(
      'admin-pill inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-body text-[11px] font-semibold uppercase leading-5',
      pillToneClasses[tone],
      className,
    )}>
      {withDot && <span className={cx('h-1.5 w-1.5 rounded-full', dotToneClasses[tone])} />}
      {children}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  return <Pill tone={toneForSystemStatus(status)} withDot>{status}</Pill>;
}

function MiniMeter({ value, tone = 'info' }: { value: number; tone?: Tone }) {
  const width = `${clampPercent(value)}%`;
  return (
    <div className="admin-meter-track mt-2 h-1.5 overflow-hidden rounded-full">
      <div className={cx('h-full rounded-full', meterToneClasses[tone])} style={{ width }} />
    </div>
  );
}

function MetricTile({ label, value, sublabel, tone = 'neutral', meter }: MetricTileProps) {
  return (
    <div className={cx('admin-metric min-h-[92px] rounded-md p-4', `admin-metric--${tone}`)}>
      <div className="font-body text-[10px] font-semibold uppercase leading-none text-white/45">{label}</div>
      <div className="mt-2 break-words font-body text-[1.55rem] font-semibold leading-none text-white">{value}</div>
      {sublabel && <div className="mt-2 truncate font-body text-[11px] leading-4 text-white/42">{sublabel}</div>}
      {typeof meter === 'number' && <MiniMeter value={meter} tone={tone} />}
    </div>
  );
}

function EmptyTable({ label }: { label: string }) {
  return <div className="admin-empty px-4 py-6 font-body text-xs text-white/45">{label}</div>;
}

function Section({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <section className="admin-section overflow-hidden rounded-md">
      <div className="admin-section__header flex min-h-[48px] items-center justify-between gap-3 px-4">
        <h2 className="font-body text-sm font-semibold uppercase text-white/90">{title}</h2>
        {meta && <span className="font-mono text-[11px] font-semibold uppercase text-white/38">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

function HeaderCell({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`admin-table-head px-3 py-2.5 font-body text-[10px] font-bold uppercase ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}

function Cell({ children, align = 'left', mono = false }: { children: ReactNode; align?: 'left' | 'right'; mono?: boolean }) {
  return (
    <td className={`admin-table-cell px-3 py-3 align-middle text-xs ${align === 'right' ? 'text-right tabular-nums' : 'text-left'} ${mono ? 'font-mono text-[11px]' : 'font-body'}`}>
      {children}
    </td>
  );
}

function MachinesTable({ machines }: { machines: MachineOverview[] }) {
  if (machines.length === 0) return <EmptyTable label="No running machines reported." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1040px] table-fixed border-collapse">
        <thead>
          <tr>
            <HeaderCell>Machine</HeaderCell>
            <HeaderCell>Region</HeaderCell>
            <HeaderCell align="right">Players</HeaderCell>
            <HeaderCell align="right">Capacity</HeaderCell>
            <HeaderCell align="right">Bots</HeaderCell>
            <HeaderCell align="right">Rooms</HeaderCell>
            <HeaderCell align="right">Load</HeaderCell>
            <HeaderCell align="right">Memory</HeaderCell>
            <HeaderCell align="right">CCU</HeaderCell>
            <HeaderCell>Updated</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {machines.map((machine) => {
            const loadRatio = machine.loadPct1 / 100;
            const loadTone = toneForPressure(loadRatio);
            const hasMeasuredCapacity = machine.dynamicCapacitySource === 'live' && machine.gameRoomCount > 0;
            const projectedCapacity = machine.dynamicCapacityPlayers > 0
              ? `projected ${formatNumber(machine.dynamicCapacityPlayers)}`
              : 'no samples';
            return (
              <tr key={machine.machineId} className="hover:bg-white/[0.025]">
                <Cell mono>
                  <div className="break-all text-white">{machine.machineId}</div>
                  <div className="mt-1 font-body text-[11px] text-white/40">{formatCount(machine.processCount, 'process', 'processes')}</div>
                </Cell>
                <Cell>{machine.region || 'unknown'}</Cell>
                <Cell align="right">{formatNumber(machine.playersInGame)}</Cell>
                <Cell align="right">
                  {hasMeasuredCapacity ? formatNumber(machine.dynamicCapacityPlayers) : 'Learning'}
                  <div className="text-[11px] text-white/40">
                    {hasMeasuredCapacity
                      ? `${formatNumber(Math.max(0, machine.dynamicCapacityPlayers - machine.playersInGame))} open`
                      : projectedCapacity}
                  </div>
                </Cell>
                <Cell align="right">{formatNumber(machine.botsInGame)}</Cell>
                <Cell align="right">
                  {formatCount(machine.gameRoomCount, 'game')}
                  <div className="text-[11px] text-white/40">{formatCount(machine.lobbyRoomCount, 'lobby', 'lobbies')}</div>
                </Cell>
                <Cell align="right">
                  <Pill tone={loadTone}>{machine.loadPct1.toFixed(0)}%</Pill>
                  <div className="text-[11px] text-white/40">1m {machine.loadAvg1.toFixed(2)} / {formatNumber(machine.cpuCount)} CPUs</div>
                  <div className="text-[11px] text-white/40">CPU {(machine.processCpuUtilization * 100).toFixed(0)}% / loop {machine.eventLoopDelayP95Ms.toFixed(1)}ms</div>
                  <MiniMeter value={loadRatio} tone={loadTone} />
                </Cell>
                <Cell align="right">
                  {formatBytes(machine.memoryRssBytes)}
                  <div className="text-[11px] text-white/40">{formatBytes(machine.systemFreeMemoryBytes)} free</div>
                </Cell>
                <Cell align="right">{formatNumber(machine.localCcu)}</Cell>
                <Cell>{formatAge(machine.latestUpdatedAtMs)}</Cell>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GameRoomsTable({ rooms }: { rooms: GameRoomOverview[] }) {
  if (rooms.length === 0) return <EmptyTable label="No active game rooms." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] table-fixed border-collapse">
        <thead>
          <tr>
            <HeaderCell>Room</HeaderCell>
            <HeaderCell>Machine</HeaderCell>
            <HeaderCell>Phase</HeaderCell>
            <HeaderCell>Mode</HeaderCell>
            <HeaderCell align="right">Players</HeaderCell>
            <HeaderCell align="right">Bots</HeaderCell>
            <HeaderCell align="right">Clients</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <tr key={room.roomId} className="hover:bg-white/[0.025]">
              <Cell mono>{room.roomId}</Cell>
              <Cell mono>{room.machineId}</Cell>
              <Cell>
                <Pill tone={room.phase === 'playing' ? 'success' : 'neutral'}>{room.phase}</Pill>
              </Cell>
              <Cell>{room.matchMode}</Cell>
              <Cell align="right">{formatNumber(room.players)}</Cell>
              <Cell align="right">{formatNumber(room.bots)}</Cell>
              <Cell align="right">{formatNumber(room.clients)} / {formatNumber(room.maxClients)}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LobbiesTable({ lobbies }: { lobbies: LobbyRoomOverview[] }) {
  if (lobbies.length === 0) return <EmptyTable label="No active lobbies." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] table-fixed border-collapse">
        <thead>
          <tr>
            <HeaderCell>Lobby</HeaderCell>
            <HeaderCell>Machine</HeaderCell>
            <HeaderCell>Status</HeaderCell>
            <HeaderCell>Mode</HeaderCell>
            <HeaderCell align="right">Humans</HeaderCell>
            <HeaderCell align="right">Bots</HeaderCell>
            <HeaderCell align="right">Participants</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {lobbies.map((lobby) => (
            <tr key={lobby.roomId} className="hover:bg-white/[0.025]">
              <Cell>
                <div className="text-white">{lobby.name}</div>
                <div className="mt-1 break-all font-mono text-xs text-white/40">{lobby.roomId}</div>
              </Cell>
              <Cell mono>{lobby.machineId}</Cell>
              <Cell>
                <Pill tone={lobby.status === 'open' ? 'success' : 'neutral'}>{lobby.status}</Pill>
              </Cell>
              <Cell>{lobby.matchMode}</Cell>
              <Cell align="right">{formatNumber(lobby.humans)}</Cell>
              <Cell align="right">{formatNumber(lobby.bots)}</Cell>
              <Cell align="right">{formatNumber(lobby.participants)}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EconomyField({
  label,
  description,
  value,
  disabled,
  suffix,
  detail,
  inputMode = 'decimal',
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  disabled?: boolean;
  suffix?: string;
  detail?: string;
  inputMode?: 'decimal' | 'numeric' | 'text';
  onChange: (value: string) => void;
}) {
  return (
    <label className="admin-economy-field grid min-w-0 gap-3 px-4 py-4">
      <span className="min-w-0">
        <span className="block font-body text-[11px] font-semibold uppercase leading-none text-white/74">{label}</span>
        <span className="mt-1.5 block font-body text-[11px] leading-snug text-white/38">{description}</span>
      </span>
      <span className="admin-input-shell flex h-10 min-w-0 overflow-hidden rounded-md">
        <input
          type="text"
          inputMode={inputMode}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent px-2.5 font-mono text-sm text-white outline-none disabled:cursor-not-allowed disabled:opacity-45"
        />
        {suffix && (
          <span className="admin-input-suffix flex shrink-0 items-center px-2 font-body text-[10px] font-semibold uppercase text-white/38">
            {suffix}
          </span>
        )}
      </span>
      <span className="min-h-4 font-mono text-[11px] uppercase leading-snug text-white/42">
        {detail ?? ''}
      </span>
    </label>
  );
}

function EconomyToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'admin-toggle flex h-10 w-full items-center justify-between gap-3 rounded-md px-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45',
        checked ? 'is-on text-white' : 'text-white/58 hover:text-white',
      )}
    >
      <span className="font-body text-[11px] font-semibold uppercase">{label}</span>
      <span className="flex items-center gap-2">
        <span className={cx('h-2 w-2 rounded-full', checked ? 'bg-accent-primary' : 'bg-white/28')} />
        <span className="font-mono text-[10px] font-semibold uppercase text-white/48">{checked ? 'On' : 'Off'}</span>
      </span>
    </button>
  );
}

function EconomyModeSwitch({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: GoldenBiomeDistributionMode;
  disabled?: boolean;
  onChange: (mode: GoldenBiomeDistributionMode) => void;
}) {
  return (
    <div>
      <div className="font-body text-[11px] font-semibold uppercase text-white/58">{label}</div>
      <div className="admin-segmented mt-2 grid grid-cols-2 rounded-md">
        {(['manual', 'auto'] as GoldenBiomeDistributionMode[]).map((mode) => {
          const active = value === mode;
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange(mode)}
              className={cx(
                'h-10 px-3 font-body text-[11px] font-semibold uppercase transition disabled:cursor-not-allowed disabled:opacity-45',
                active ? 'is-active text-amber-100' : 'text-white/50 hover:text-white',
              )}
            >
              {mode}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EconomyGroup({
  title,
  summary,
  action,
  children,
}: {
  title: string;
  summary: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="admin-economy-group grid last:border-b-0 xl:grid-cols-[20rem_minmax(0,1fr)]">
      <div className="admin-economy-group__summary px-4 py-4">
        <h3 className="font-body text-xs font-semibold uppercase text-white/76">{title}</h3>
        <p className="mt-2 font-body text-[12px] leading-relaxed text-white/48">{summary}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
      <div className="admin-economy-group__fields">
        {children}
      </div>
    </section>
  );
}

function EconomyPair({ children }: { children: ReactNode }) {
  return (
    <div className="admin-economy-pair grid lg:grid-cols-2">
      {children}
    </div>
  );
}

function RewardEconomyPanel({
  draft,
  dirty,
  busy,
  updatedAt,
  tokenSymbol,
  onDraftChange,
  onSave,
}: {
  draft: RewardEconomyDraft;
  dirty: boolean;
  busy: boolean;
  updatedAt: string | null;
  tokenSymbol: string | null;
  onDraftChange: (patch: Partial<RewardEconomyDraft>) => void;
  onSave: () => void;
}) {
  const disabled = busy;
  const tokenSuffix = tokenSymbol?.trim().replace(/^\$/, '').toUpperCase() || 'UNITS';
  const rankedDailyCeiling = formatDraftTokenProduct(draft.dailyRankedDripLamports, draft.dailyRankedDripMaxMatches, tokenSuffix);
  const rankedMatchDrip = formatDraftTokenAmount(draft.dailyRankedDripLamports, tokenSuffix);
  const playerMatchCap = formatDraftTokenAmount(draft.maxPlayerMatchLamports, tokenSuffix);
  const matchPayoutCap = formatDraftTokenAmount(draft.maxMatchPayoutLamports, tokenSuffix);
  const weeklyPool = formatDraftTokenAmount(draft.weeklyPoolLamports, tokenSuffix);
  const weeklyPlaces = formatDraftWhole(draft.weeklyTopPlayers);
  const goldenChance = formatDraftBps(draft.goldenBiomeChanceBps);
  const wagerFee = formatDraftBps(draft.platformFeeBps);
  const rankedSummary = draft.enabled
    ? `${rankedMatchDrip} per eligible ranked match, up to ${rankedDailyCeiling} per player each day before bonuses.`
    : 'Ranked token payouts are disabled.';
  const weeklySummary = draft.weeklyEnabled
    ? `${weeklyPool} is reserved for the top ${weeklyPlaces} weekly ranked players.`
    : 'Weekly leaderboard payouts are disabled.';
  const limitsSummary = `A player can receive at most ${playerMatchCap} from one match, and the whole match stops paying at ${matchPayoutCap}.`;
  const goldenSummary = draft.goldenBiomeEnabled
    ? `${goldenChance} golden map roll. Winners receive ${draft.goldenBiomeWinnerRewardSol || '0'} SOL each, paid in ${draft.goldenBiomeDistributionMode} mode.`
    : 'Golden map rewards are disabled.';
  const policySummary = `${rankedSummary} ${weeklySummary} ${limitsSummary} ${goldenSummary} Wager fee is ${wagerFee}.`;

  return (
    <div>
      <div className="admin-economy-summary px-4 py-4">
        <div className="font-body text-[10px] font-semibold uppercase text-accent-primary/70">Current Player Economy</div>
        <p className="mt-2 max-w-[92rem] font-body text-sm leading-relaxed text-white/72">
          {policySummary}
        </p>
      </div>

      <div className="admin-economy-snapshot grid lg:grid-cols-4">
        <div className="px-4 py-4">
          <div className="font-body text-[10px] font-semibold uppercase text-white/42">Ranked Match</div>
          <div className="mt-1 font-body text-lg font-semibold leading-none text-white">{draft.enabled ? rankedMatchDrip : 'Off'}</div>
          <div className="mt-2 font-body text-[11px] leading-snug text-white/42">{draft.enabled ? `First ${formatDraftWhole(draft.dailyRankedDripMaxMatches)} matches/day can pay.` : 'No base ranked payout.'}</div>
        </div>
        <div className="px-4 py-4">
          <div className="font-body text-[10px] font-semibold uppercase text-white/42">Daily Ceiling</div>
          <div className="mt-1 font-body text-lg font-semibold leading-none text-white">{rankedDailyCeiling}</div>
          <div className="mt-2 font-body text-[11px] leading-snug text-white/42">Before win, flag, return, and assist bonuses.</div>
        </div>
        <div className="px-4 py-4">
          <div className="font-body text-[10px] font-semibold uppercase text-white/42">Per Match Guardrails</div>
          <div className="mt-1 font-body text-lg font-semibold leading-none text-white">{playerMatchCap}</div>
          <div className="mt-2 font-body text-[11px] leading-snug text-white/42">Player max; match max is {matchPayoutCap}.</div>
        </div>
        <div className="px-4 py-4">
          <div className="font-body text-[10px] font-semibold uppercase text-white/42">Golden Maps</div>
          <div className="mt-1 font-body text-lg font-semibold leading-none text-white">{draft.goldenBiomeEnabled ? goldenChance : 'Off'}</div>
          <div className="mt-2 font-body text-[11px] leading-snug text-white/42">{draft.goldenBiomeDistributionMode} distribution / {draft.goldenBiomeWinnerRewardSol || '0'} SOL per winner.</div>
        </div>
      </div>

      <EconomyGroup
        title="Ranked Rewards"
        summary={rankedSummary}
        action={<EconomyToggle label="Ranked payouts" checked={draft.enabled} disabled={disabled} onChange={(enabled) => onDraftChange({ enabled })} />}
      >
        <EconomyPair>
          <EconomyField
            label="Base match payout"
            description="Paid once when a ranked match qualifies for rewards."
            value={draft.dailyRankedDripLamports}
            suffix={tokenSuffix}
            detail={rankedMatchDrip}
            disabled={disabled}
            onChange={(dailyRankedDripLamports) => onDraftChange({ dailyRankedDripLamports })}
          />
          <EconomyField
            label="Daily paid matches"
            description="Caps how many ranked matches per player can earn the base payout each day."
            value={draft.dailyRankedDripMaxMatches}
            suffix="matches"
            detail={`${rankedDailyCeiling} max/day`}
            inputMode="numeric"
            disabled={disabled}
            onChange={(dailyRankedDripMaxMatches) => onDraftChange({ dailyRankedDripMaxMatches })}
          />
        </EconomyPair>
        <EconomyPair>
          <EconomyField
            label="Win bonus"
            description="Extra payout for the winning objective outcome."
            value={draft.objectiveWinLamports}
            suffix={tokenSuffix}
            detail={formatDraftTokenAmount(draft.objectiveWinLamports, tokenSuffix)}
            disabled={disabled}
            onChange={(objectiveWinLamports) => onDraftChange({ objectiveWinLamports })}
          />
          <EconomyField
            label="Assist bonus"
            description="Small reward for objective support actions."
            value={draft.objectiveAssistLamports}
            suffix={tokenSuffix}
            detail={formatDraftTokenAmount(draft.objectiveAssistLamports, tokenSuffix)}
            disabled={disabled}
            onChange={(objectiveAssistLamports) => onDraftChange({ objectiveAssistLamports })}
          />
        </EconomyPair>
        <EconomyPair>
          <EconomyField
            label="Flag capture"
            description="Primary objective action payout."
            value={draft.objectiveFlagCaptureLamports}
            suffix={tokenSuffix}
            detail={formatDraftTokenAmount(draft.objectiveFlagCaptureLamports, tokenSuffix)}
            disabled={disabled}
            onChange={(objectiveFlagCaptureLamports) => onDraftChange({ objectiveFlagCaptureLamports })}
          />
          <EconomyField
            label="Flag return"
            description="Defensive objective action payout."
            value={draft.objectiveFlagReturnLamports}
            suffix={tokenSuffix}
            detail={formatDraftTokenAmount(draft.objectiveFlagReturnLamports, tokenSuffix)}
            disabled={disabled}
            onChange={(objectiveFlagReturnLamports) => onDraftChange({ objectiveFlagReturnLamports })}
          />
        </EconomyPair>
      </EconomyGroup>

      <EconomyGroup
        title="Weekly And Limits"
        summary={`${weeklySummary} ${limitsSummary}`}
        action={<EconomyToggle label="Weekly pool" checked={draft.weeklyEnabled} disabled={disabled} onChange={(weeklyEnabled) => onDraftChange({ weeklyEnabled })} />}
      >
        <EconomyPair>
          <EconomyField
            label="Weekly prize pool"
            description="Total pool available for the weekly ranked leaderboard."
            value={draft.weeklyPoolLamports}
            suffix={tokenSuffix}
            detail={weeklyPool}
            disabled={disabled}
            onChange={(weeklyPoolLamports) => onDraftChange({ weeklyPoolLamports })}
          />
          <EconomyField
            label="Paid placements"
            description="How many leaderboard positions share the weekly pool."
            value={draft.weeklyTopPlayers}
            suffix="top"
            detail={`Top ${weeklyPlaces}`}
            inputMode="numeric"
            disabled={disabled}
            onChange={(weeklyTopPlayers) => onDraftChange({ weeklyTopPlayers })}
          />
        </EconomyPair>
        <EconomyPair>
          <EconomyField
            label="Player match cap"
            description="Hard ceiling for one player’s payout from a single match."
            value={draft.maxPlayerMatchLamports}
            suffix={tokenSuffix}
            detail={playerMatchCap}
            disabled={disabled}
            onChange={(maxPlayerMatchLamports) => onDraftChange({ maxPlayerMatchLamports })}
          />
          <EconomyField
            label="Whole match cap"
            description="Hard ceiling for all reward payouts generated by one match."
            value={draft.maxMatchPayoutLamports}
            suffix={tokenSuffix}
            detail={matchPayoutCap}
            disabled={disabled}
            onChange={(maxMatchPayoutLamports) => onDraftChange({ maxMatchPayoutLamports })}
          />
        </EconomyPair>
        <EconomyPair>
          <EconomyField
            label="Minimum match time"
            description="Matches shorter than this do not qualify for reward payouts."
            value={draft.minMatchDurationMs}
            suffix="ms"
            detail={formatDraftDuration(draft.minMatchDurationMs)}
            inputMode="numeric"
            disabled={disabled}
            onChange={(minMatchDurationMs) => onDraftChange({ minMatchDurationMs })}
          />
          <EconomyField
            label="Payout batch size"
            description="Maximum reward rows sent through the payout worker at once."
            value={draft.payoutBatchSize}
            suffix="rows"
            detail={`${formatDraftWhole(draft.payoutBatchSize)} rows`}
            inputMode="numeric"
            disabled={disabled}
            onChange={(payoutBatchSize) => onDraftChange({ payoutBatchSize })}
          />
        </EconomyPair>
        <EconomyField
          label="Treasury reserve"
          description="Token balance to keep untouched before reward payouts proceed."
          value={draft.treasuryReserveLamports}
          suffix="lamports"
          detail={formatDraftTokenAmount(draft.treasuryReserveLamports, 'LAMPORTS')}
          inputMode="numeric"
          disabled={disabled}
          onChange={(treasuryReserveLamports) => onDraftChange({ treasuryReserveLamports })}
        />
      </EconomyGroup>

      <EconomyGroup
        title="Golden Maps And Wagers"
        summary={`${goldenSummary} Wager fee is ${wagerFee}.`}
        action={(
          <div className="space-y-3">
            <EconomyToggle label="Golden maps" checked={draft.goldenBiomeEnabled} disabled={disabled} onChange={(goldenBiomeEnabled) => onDraftChange({ goldenBiomeEnabled })} />
            <EconomyModeSwitch
              label="Distribution"
              value={draft.goldenBiomeDistributionMode}
              disabled={disabled}
              onChange={(goldenBiomeDistributionMode) => onDraftChange({ goldenBiomeDistributionMode })}
            />
          </div>
        )}
      >
        <EconomyPair>
          <EconomyField
            label="Golden map chance"
            description="Roll chance for a match to become a golden reward match."
            value={draft.goldenBiomeChanceBps}
            suffix="bps"
            detail={goldenChance}
            inputMode="numeric"
            disabled={disabled}
            onChange={(goldenBiomeChanceBps) => onDraftChange({ goldenBiomeChanceBps })}
          />
          <EconomyField
            label="Winner SOL payout"
            description="SOL amount each paid winner receives after a golden match."
            value={draft.goldenBiomeWinnerRewardSol}
            suffix="SOL"
            detail={`${draft.goldenBiomeWinnerRewardSol || '0'} SOL each`}
            disabled={disabled}
            onChange={(goldenBiomeWinnerRewardSol) => onDraftChange({ goldenBiomeWinnerRewardSol })}
          />
        </EconomyPair>
        <EconomyPair>
          <EconomyField
            label="SOL treasury reserve"
            description="Minimum SOL balance required before golden payouts can run."
            value={draft.goldenBiomeTreasuryMinSol}
            suffix="SOL"
            detail={`${draft.goldenBiomeTreasuryMinSol || '0'} SOL reserve`}
            disabled={disabled}
            onChange={(goldenBiomeTreasuryMinSol) => onDraftChange({ goldenBiomeTreasuryMinSol })}
          />
          <EconomyField
            label="Platform wager fee"
            description="Percentage kept by the platform from wager settlements."
            value={draft.platformFeeBps}
            suffix="bps"
            detail={wagerFee}
            inputMode="numeric"
            disabled={disabled}
            onChange={(platformFeeBps) => onDraftChange({ platformFeeBps })}
          />
        </EconomyPair>
      </EconomyGroup>

      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
        <div className="font-body text-[11px] text-white/38">
          {updatedAt ? `Updated ${formatDate(updatedAt)}` : 'Using default economy settings'}
        </div>
        <ActionButton disabled={disabled || !dirty} onClick={onSave}>
          {busy ? 'Saving' : 'Save Economy'}
        </ActionButton>
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="admin-action-button h-8 rounded-md px-3 font-body text-[11px] font-semibold uppercase transition disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
}

function AdminSelect({
  label,
  value,
  options,
  disabled,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: AdminSelectOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  const updateMenuPosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportPadding = 12;
    const menuWidth = Math.min(Math.max(rect.width, 280), window.innerWidth - viewportPadding * 2);
    const left = Math.min(Math.max(rect.left, viewportPadding), window.innerWidth - menuWidth - viewportPadding);
    const availableBelow = Math.max(160, window.innerHeight - rect.bottom - 12);
    setMenuStyle({
      position: 'fixed',
      left: Math.round(left),
      top: Math.round(rect.bottom + 4),
      width: Math.round(menuWidth),
      maxHeight: Math.min(320, availableBelow),
    });
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    updateMenuPosition();

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const menu = open && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={menuRef}
        id={menuId}
        role="listbox"
        aria-label={label}
        style={menuStyle}
        className="admin-select-menu z-50 overflow-auto rounded-md py-1 shadow-[0_18px_44px_rgb(15_23_42_/_0.18)]"
      >
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <button
              key={option.value || 'exact'}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cx(
                'admin-select-option flex w-full items-start justify-between gap-3 px-3 py-2 text-left font-body text-xs transition',
                isSelected
                  ? 'is-selected text-white'
                  : 'text-white/74 hover:text-white',
              )}
            >
              <span className="min-w-0">
                <span className="block whitespace-nowrap">{option.label}</span>
                {option.detail && <span className="mt-0.5 block whitespace-nowrap font-mono text-[11px] text-white/38">{option.detail}</span>}
              </span>
              <span className={cx('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', isSelected ? 'bg-accent-primary' : 'bg-transparent')} />
            </button>
          );
        })}
      </div>,
      document.body,
    )
    : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          updateMenuPosition();
          setOpen(true);
        }}
        className={cx(
          'admin-select-button flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md px-2.5 font-body text-xs text-white outline-none transition disabled:cursor-not-allowed disabled:opacity-45',
          open && 'is-open',
          className,
        )}
      >
        <span className="truncate">{selected?.label ?? 'Select'}</span>
        <span aria-hidden="true" className="shrink-0 font-mono text-[10px] text-white/40">v</span>
      </button>
      {menu}
    </>
  );
}

function AdminNavigation({
  pages,
  activePage,
  compact = false,
  onChange,
}: {
  pages: AdminPage[];
  activePage: AdminPageId;
  compact?: boolean;
  onChange: (page: AdminPageId) => void;
}) {
  if (pages.length === 0) return null;

  return (
    <nav aria-label="Admin pages" className={compact ? 'admin-mobile-nav -mx-1 overflow-x-auto px-1' : 'space-y-1'}>
      <div className={compact ? 'flex min-w-max gap-2' : 'space-y-1'}>
        {pages.map((page) => {
          const isActive = page.id === activePage;
          return (
            <button
              key={page.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onChange(page.id)}
              className={cx(
                'admin-nav-item group min-w-0 rounded-md font-body transition',
                compact
                  ? 'flex h-11 min-w-[11rem] items-center justify-between gap-3 px-3 text-left'
                  : 'flex w-full items-center justify-between gap-3 px-3 py-3 text-left',
                isActive && 'is-active text-white',
              )}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className={cx('h-2 w-2 shrink-0 rounded-full', dotToneClasses[page.tone])} />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold uppercase leading-none">{page.label}</span>
                  {!compact && <span className="mt-1 block truncate text-[11px] leading-none text-white/38">{page.eyebrow}</span>}
                </span>
              </span>
              <span className={cx(
                'shrink-0 font-mono text-[10px] font-semibold uppercase leading-none',
                isActive ? 'text-accent-primary/90' : 'text-white/32',
              )}>
                {page.meta}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function FactRow({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: Tone;
}) {
  return (
    <div className="flex min-h-[58px] items-center justify-between gap-3 border-b border-white/[0.07] px-3 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="font-body text-[10px] font-semibold uppercase leading-none text-white/42">{label}</div>
        {detail && <div className="mt-1.5 truncate font-body text-[11px] text-white/35">{detail}</div>}
      </div>
      <Pill tone={tone} className="shrink-0">
        {value}
      </Pill>
    </div>
  );
}

function AttentionQueue({
  overview,
  onNavigate,
}: {
  overview: AdminOverview;
  onNavigate: (page: AdminPageId) => void;
}) {
  const activeReports = getActiveReportCount(overview);
  const pendingGoldenRewards = getPendingGoldenRewardCount(overview);
  const purchasableSkins = getPurchasableSkinCount(overview);
  const capacityTone = overview.capacity.full ? 'danger' : toneForPressure(overview.capacity.capacityPressure);
  const items: Array<{
    label: string;
    value: string;
    detail: string;
    tone: Tone;
    page: AdminPageId;
  }> = [
    {
      label: 'Capacity',
      value: `${formatNumber(overview.capacity.reservedPlayers)} / ${formatNumber(overview.capacity.maxPlayers)}`,
      detail: `${formatNumber(overview.capacity.availablePlayers)} open across ${formatCount(overview.capacity.machineCount, 'machine')}`,
      tone: capacityTone,
      page: 'infrastructure',
    },
    {
      label: 'Player Reports',
      value: `${formatNumber(activeReports)} active`,
      detail: `${formatNumber(overview.playerReports?.reports.length ?? 0)} reports in the queue`,
      tone: activeReports > 0 ? 'warning' : 'success',
      page: 'players',
    },
    {
      label: 'Golden Rewards',
      value: `${formatNumber(pendingGoldenRewards)} pending`,
      detail: `${overview.goldenBiomeRewards?.settings.distributionMode ?? 'manual'} distribution mode`,
      tone: pendingGoldenRewards > 0 ? 'warning' : 'success',
      page: 'economy',
    },
    {
      label: 'Global Message',
      value: overview.globalNotification ? 'Active' : 'Off',
      detail: overview.globalNotification ? `Updated ${formatDateAge(overview.globalNotification.updatedAt)}` : 'No broadcast message',
      tone: overview.globalNotification ? 'warning' : 'neutral',
      page: 'liveOps',
    },
    {
      label: 'Ranked Gate',
      value: formatRankedEntryGateMode(overview.rankedEntryGate.mode),
      detail: `${overview.rankedSeason.label} / ${formatSeasonBoundary(overview.rankedSeason.mode, overview.rankedSeason.endsAt)}`,
      tone: overview.rankedEntryGate.mode === 'token_required' ? 'success' : 'amber',
      page: 'liveOps',
    },
    {
      label: 'Skin Shop',
      value: overview.skinShop.shop.enabled ? 'Online' : 'Locked',
      detail: `${formatNumber(purchasableSkins)} purchasable skins`,
      tone: overview.skinShop.shop.enabled ? 'success' : 'amber',
      page: 'economy',
    },
  ];

  return (
    <div className="divide-y divide-white/[0.07]">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => onNavigate(item.page)}
          className="group flex w-full min-w-0 items-center justify-between gap-3 px-3 py-3 text-left transition hover:bg-white/[0.035]"
        >
          <span className="min-w-0">
            <span className="block font-body text-xs font-semibold uppercase leading-none text-white/82">{item.label}</span>
            <span className="mt-1.5 block truncate font-body text-[11px] leading-none text-white/38">{item.detail}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <Pill tone={item.tone}>{item.value}</Pill>
            <span aria-hidden="true" className="font-mono text-xs text-white/32 transition group-hover:text-white/60">open</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function RuntimeShapePanel({ overview }: { overview: AdminOverview }) {
  const capacityTone = overview.capacity.full ? 'danger' : toneForPressure(overview.capacity.capacityPressure);
  return (
    <div>
      <FactRow
        label="World Activity"
        value={`${formatNumber(overview.totals.participantsInGame)} live`}
        detail={`${formatCount(overview.totals.gameRooms, 'game')} / ${formatCount(overview.totals.lobbyRooms, 'lobby', 'lobbies')}`}
        tone={overview.totals.participantsInGame > 0 ? 'success' : 'neutral'}
      />
      <FactRow
        label="Capacity"
        value={`${formatNumber(overview.capacity.availablePlayers)} open`}
        detail={`${overview.capacity.source} source / ${formatNumber(overview.capacity.projectedMachineCount)} projected machines`}
        tone={capacityTone}
      />
      <FactRow
        label="Clients"
        value={formatNumber(overview.totals.totalConnectedClients)}
        detail={`${formatNumber(overview.totals.playersInGame)} players / ${formatNumber(overview.totals.botsInGame)} bots`}
        tone="info"
      />
      <FactRow
        label="Last Sample"
        value={formatDateAge(overview.generatedAt)}
        detail={formatDate(overview.generatedAt)}
        tone={overview.status === 'ok' ? 'success' : 'warning'}
      />
    </div>
  );
}

function MachinePressurePanel({ overview }: { overview: AdminOverview }) {
  const machines = [...overview.machines]
    .sort((left, right) => (
      right.capacityPressure - left.capacityPressure ||
      right.playersInGame - left.playersInGame ||
      right.loadPct1 - left.loadPct1
    ))
    .slice(0, 5);

  if (machines.length === 0) return <EmptyTable label="No machines reporting yet." />;

  return (
    <div className="divide-y divide-white/[0.07]">
      {machines.map((machine) => {
        const pressureTone = toneForPressure(machine.capacityPressure);
        return (
          <div key={machine.machineId} className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.4fr)] md:items-center">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate font-mono text-xs text-white">{machine.machineId}</span>
                <Pill tone={pressureTone}>{Math.round(machine.capacityPressure * 100)}%</Pill>
              </div>
              <div className="mt-1 font-body text-[11px] text-white/38">
                {machine.region || 'unknown region'} / {formatCount(machine.processCount, 'process', 'processes')} / updated {formatAge(machine.latestUpdatedAtMs)}
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3 font-body text-[11px] text-white/50">
                <span>{formatNumber(machine.playersInGame)} players</span>
                <span>{formatNumber(machine.gameRoomCount)} games</span>
                <span>{machine.loadPct1.toFixed(0)}% load</span>
              </div>
              <MiniMeter value={machine.capacityPressure} tone={pressureTone} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DiagnosticsPanel({ overview }: { overview: AdminOverview }) {
  return (
    <div>
      <FactRow
        label="Redis"
        value={overview.diagnostics.redis.status}
        detail={overview.diagnostics.redis.error || 'Shared runtime state'}
        tone={overview.diagnostics.redis.ok ? 'success' : 'danger'}
      />
      <FactRow
        label="Runtime"
        value={overview.diagnostics.distributed ? 'Distributed' : 'Single'}
        detail={`${overview.diagnostics.routingStrategy} routing`}
        tone={overview.diagnostics.distributed ? 'info' : 'neutral'}
      />
      <FactRow
        label="Room Creation"
        value={overview.diagnostics.roomCreateStrategy}
        detail={`local process ${overview.diagnostics.localProcessId ?? 'unknown'}`}
        tone="neutral"
      />
      <FactRow
        label="Fly Replay"
        value={overview.diagnostics.flyReplay.enabled ? 'Enabled' : 'Off'}
        detail={overview.diagnostics.flyReplay.registered
          ? `${overview.diagnostics.flyReplay.appName ?? 'app'} / ${overview.diagnostics.flyReplay.region ?? 'region unknown'}`
          : 'Not registered'}
        tone={overview.diagnostics.flyReplay.enabled ? 'success' : 'neutral'}
      />
    </div>
  );
}

function CommandCenterPage({
  overview,
  metrics,
  onNavigate,
}: {
  overview: AdminOverview;
  metrics: MetricTileProps[];
  onNavigate: (page: AdminPageId) => void;
}) {
  const activeReports = getActiveReportCount(overview);
  const pendingGoldenRewards = getPendingGoldenRewardCount(overview);
  const actionCount = activeReports + pendingGoldenRewards + (overview.capacity.full ? 1 : 0) + (overview.globalNotification ? 1 : 0);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {metrics.map((metric) => (
          <MetricTile key={metric.label} {...metric} />
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.48fr)]">
        <Section title="Attention Queue" meta={`${formatNumber(actionCount)} signals`}>
          <AttentionQueue overview={overview} onNavigate={onNavigate} />
        </Section>

        <Section title="Runtime Shape" meta={overview.diagnostics.distributed ? 'distributed' : 'single'}>
          <RuntimeShapePanel overview={overview} />
        </Section>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.48fr)]">
        <Section title="Machine Pressure" meta={`${formatNumber(overview.machines.length)} machines`}>
          <MachinePressurePanel overview={overview} />
        </Section>

        <Section title="Diagnostics" meta={overview.diagnostics.redis.ok ? 'healthy' : 'attention'}>
          <DiagnosticsPanel overview={overview} />
        </Section>
      </div>
    </div>
  );
}

function GlobalNotificationPanel({
  notification,
  draft,
  busy,
  onDraftChange,
  onSave,
  onRemove,
}: {
  notification: GlobalNotificationOverview | null;
  draft: string;
  busy: boolean;
  onDraftChange: (message: string) => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const trimmedDraft = draft.trim();
  const hasActiveNotification = Boolean(notification);

  return (
    <div className="grid gap-3 border-b border-white/10 bg-black/20 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.38fr)]">
      <div className="min-w-0">
        <label htmlFor="global-notification-message" className="font-body text-[10px] font-semibold uppercase text-white/45">
          Message
        </label>
        <textarea
          id="global-notification-message"
          value={draft}
          maxLength={240}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="Maintenance starts in 10 minutes."
          className="mt-2 min-h-[64px] w-full resize-y rounded-md border border-white/10 bg-black/30 px-3 py-2 font-body text-xs leading-relaxed text-white outline-none transition placeholder:text-white/25 focus:border-accent-primary/55 focus:bg-black/40"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="font-body text-[11px] text-white/40">{trimmedDraft.length} / 240</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!trimmedDraft || busy}
              onClick={onSave}
              className="h-7 rounded-md border border-accent-primary/45 bg-accent-primary/20 px-3 font-body text-[11px] font-semibold uppercase text-white transition hover:border-accent-primary/70 hover:bg-accent-primary/30 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-white/35"
            >
              Set Message
            </button>
            <ActionButton disabled={!hasActiveNotification || busy} onClick={onRemove}>
              Remove
            </ActionButton>
          </div>
        </div>
      </div>

      <div className="min-w-0 rounded-md border border-white/10 bg-white/[0.025] p-3">
        <div className="font-body text-[10px] font-semibold uppercase text-white/45">Current</div>
        {notification ? (
          <>
            <div className="mt-2"><Pill tone="warning">Active</Pill></div>
            <p className="mt-2 break-words font-body text-xs leading-relaxed text-white/80">{notification.message}</p>
            <div className="mt-2 font-body text-[11px] text-white/40">
              Updated {formatDate(notification.updatedAt)}
            </div>
          </>
        ) : (
          <>
            <div className="mt-2"><Pill>Off</Pill></div>
            <p className="mt-2 font-body text-xs text-white/45">No active message.</p>
          </>
        )}
      </div>
    </div>
  );
}

function SkinShopPanel({
  overview,
  settingsDraft,
  itemDrafts,
  dirtyById,
  busySettings,
  busyItemId,
  onSettingsDraftChange,
  onItemDraftChange,
  onSaveSettings,
  onSaveItem,
}: {
  overview: SkinShopOverview;
  settingsDraft: SkinShopSettingsDraft;
  itemDrafts: Record<string, SkinShopItemDraft>;
  dirtyById: Record<string, boolean>;
  busySettings: boolean;
  busyItemId: string | null;
  onSettingsDraftChange: (draft: SkinShopSettingsDraft) => void;
  onItemDraftChange: (skinId: string, draft: SkinShopItemDraft) => void;
  onSaveSettings: () => void;
  onSaveItem: (skinId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 rounded-md border border-accent-primary/25 bg-black/20 p-3 lg:grid-cols-[0.4fr_1fr_0.55fr_0.55fr_auto] lg:items-end">
        <div>
          <div className="font-body text-[10px] font-semibold uppercase text-white/45">Shop</div>
          <button
            type="button"
            disabled={busySettings}
            aria-pressed={settingsDraft.enabled}
            onClick={() => onSettingsDraftChange({ ...settingsDraft, enabled: !settingsDraft.enabled })}
            className={`mt-2 h-8 rounded-md border px-3 font-body text-[11px] font-semibold uppercase transition disabled:cursor-wait ${
              settingsDraft.enabled
                ? 'border-ui-success/45 bg-ui-success/15 text-emerald-100'
                : 'border-white/10 bg-white/[0.04] text-white/60 hover:border-ui-success/35'
            }`}
          >
            {settingsDraft.enabled ? 'Enabled' : 'Locked'}
          </button>
        </div>

        <label className="block min-w-0">
          <span className="font-body text-[10px] font-semibold uppercase text-white/45">Token Mint</span>
          <input
            value={settingsDraft.tokenMintAddress}
            disabled={busySettings}
            onChange={(event) => onSettingsDraftChange({ ...settingsDraft, tokenMintAddress: event.target.value })}
            className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-mono text-xs text-white outline-none transition placeholder:text-white/25 focus:border-accent-primary/55"
            placeholder="SPL mint address"
          />
        </label>

        <label className="block">
          <span className="font-body text-[10px] font-semibold uppercase text-white/45">Symbol</span>
          <input
            value={settingsDraft.tokenSymbol}
            disabled={busySettings}
            maxLength={16}
            onChange={(event) => onSettingsDraftChange({ ...settingsDraft, tokenSymbol: event.target.value.toUpperCase() })}
            className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-body text-xs text-white outline-none transition focus:border-accent-primary/55"
          />
        </label>

        <label className="block">
          <span className="font-body text-[10px] font-semibold uppercase text-white/45">Cluster</span>
          <input
            value={settingsDraft.cluster}
            disabled={busySettings}
            onChange={(event) => onSettingsDraftChange({ ...settingsDraft, cluster: event.target.value })}
            className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-body text-xs text-white outline-none transition focus:border-accent-primary/55"
          />
        </label>

        <button
          type="button"
          disabled={busySettings}
          onClick={onSaveSettings}
          className="h-8 rounded-md border border-accent-primary/45 bg-accent-primary/20 px-3 font-body text-[11px] font-semibold uppercase text-white transition hover:border-accent-primary/70 hover:bg-accent-primary/30 disabled:cursor-wait disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-white/35"
        >
          Save Shop
        </button>

        <div className="min-w-0 lg:col-span-2">
          <div className="font-body text-[10px] font-semibold uppercase text-white/45">Solana RPC</div>
          <div
            className={`mt-2 flex h-8 items-center rounded-md border px-2.5 font-body text-[11px] font-semibold uppercase ${
              overview.shop.rpcConfigured
                ? 'border-ui-success/25 bg-ui-success/10 text-emerald-100'
                : 'border-ui-warning/35 bg-ui-warning/10 text-yellow-100'
            }`}
          >
            SOLANA_RPC_URL {overview.shop.rpcConfigured ? 'ready' : 'missing'}
          </div>
        </div>
        <div className="min-w-0 lg:col-span-3">
          <div className="font-body text-[10px] font-semibold uppercase text-white/45">Wager Treasury</div>
          <div
            className={`mt-2 flex h-8 items-center rounded-md border px-2.5 font-mono text-xs ${
              overview.shop.treasuryWallet
                ? 'border-ui-success/25 bg-ui-success/10 text-emerald-100'
                : 'border-ui-warning/35 bg-ui-warning/10 text-yellow-100'
            }`}
            title={overview.shop.treasuryWallet ?? undefined}
          >
            {overview.shop.treasuryWallet ? formatCompactIdentifier(overview.shop.treasuryWallet, 8, 8) : 'WAGER_TREASURY_WALLET missing'}
          </div>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {overview.items.map((item) => {
          const draft = itemDrafts[item.settings.skinId] ?? {
            saleEnabled: item.settings.saleEnabled,
            tokenAmountBaseUnits: item.settings.tokenAmountBaseUnits ?? '',
            maxSupply: item.settings.maxSupply?.toString() ?? '',
            expectedPriceVersion: item.settings.priceVersion,
          };
          const busy = busyItemId === item.settings.skinId;
          const canSave = !busy && Boolean(dirtyById[item.settings.skinId]);
          const hasSupplyCap = item.settings.maxSupply !== null;
          const remainingSupply = item.settings.remainingSupply ?? 0;
          return (
            <article key={item.settings.skinId} className="rounded-md border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-display text-lg leading-none text-white">{item.skin.displayName}</h3>
                  <p className="mt-1 font-body text-[11px] uppercase text-white/45">
                    {item.settings.skinId} · v{item.settings.priceVersion}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={draft.saleEnabled}
                  onClick={() => onItemDraftChange(item.settings.skinId, { ...draft, saleEnabled: !draft.saleEnabled })}
                  className={`h-7 rounded-md border px-3 font-body text-[11px] font-semibold uppercase transition disabled:cursor-wait ${
                    draft.saleEnabled
                      ? 'border-ui-success/45 bg-ui-success/15 text-emerald-100'
                      : 'border-white/10 bg-white/[0.04] text-white/55 hover:border-ui-success/35'
                  }`}
                >
                  {draft.saleEnabled ? 'For Sale' : 'Locked'}
                </button>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,0.35fr)_auto] sm:items-end">
                <label className="block">
                  <span className="font-body text-[10px] font-semibold uppercase text-white/45">Base Units</span>
                  <input
                    value={draft.tokenAmountBaseUnits}
                    inputMode="numeric"
                    disabled={busy}
                    onChange={(event) => onItemDraftChange(item.settings.skinId, {
                      ...draft,
                      tokenAmountBaseUnits: event.target.value.replace(/\D/g, ''),
                    })}
                    className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-mono text-xs text-white outline-none transition focus:border-accent-primary/55"
                  />
                </label>
                <label className="block">
                  <span className="font-body text-[10px] font-semibold uppercase text-white/45">Supply Cap</span>
                  <input
                    value={draft.maxSupply}
                    inputMode="numeric"
                    disabled={busy}
                    onChange={(event) => onItemDraftChange(item.settings.skinId, {
                      ...draft,
                      maxSupply: event.target.value.replace(/\D/g, ''),
                    })}
                    className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-mono text-xs text-white outline-none transition placeholder:text-white/25 focus:border-accent-primary/55"
                    placeholder="Unlimited"
                  />
                </label>
                <button
                  type="button"
                  disabled={!canSave}
                  onClick={() => onSaveItem(item.settings.skinId)}
                  className="h-8 rounded-md border border-accent-primary/45 bg-accent-primary/20 px-3 font-body text-[11px] font-semibold uppercase text-white transition hover:border-accent-primary/70 hover:bg-accent-primary/30 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-white/35"
                >
                  Save
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 font-body text-[11px] text-white/42">
                <Pill>{item.settings.tokenAmountBaseUnits ?? 'no price'} {overview.shop.tokenSymbol}</Pill>
                <Pill tone={item.settings.saleEnabled ? 'success' : 'warning'}>{item.settings.saleEnabled ? 'sale enabled' : 'sale locked'}</Pill>
                <Pill tone={!hasSupplyCap ? 'neutral' : remainingSupply === 0 ? 'danger' : 'info'}>
                  {hasSupplyCap ? `${formatNumber(remainingSupply)} left` : `${formatNumber(item.settings.soldCount)} sold`}
                </Pill>
                {hasSupplyCap && (
                  <Pill>{formatNumber(item.settings.soldCount)} / {formatNumber(item.settings.maxSupply ?? 0)} sold</Pill>
                )}
                {item.settings.reservedCount > 0 && (
                  <Pill tone="warning">{formatNumber(item.settings.reservedCount)} reserved</Pill>
                )}
                {item.lastAudit && (
                  <span>
                    Last update {formatDate(item.lastAudit.createdAt)}
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function RankedEntryGatePanel({
  gate,
  draft,
  busy,
  onDraftChange,
  onSave,
}: {
  gate: RankedEntryGateOverview;
  draft: RankedEntryGateDraft;
  busy: boolean;
  onDraftChange: (draft: RankedEntryGateDraft) => void;
  onSave: () => void;
}) {
  const tokenMint = draft.tokenMintAddress.trim();
  const tokenSymbol = draft.tokenSymbol.trim().replace(/^\$/, '').toUpperCase();
  const requiredTokenAmount = draft.requiredTokenAmount.trim();
  const tokenRequired = draft.mode === 'token_required';
  const draftValid = (
    !tokenRequired ||
    (tokenMint.length > 0 && /^[A-Z0-9]{1,12}$/.test(tokenSymbol) && isPositiveWholeNumberString(requiredTokenAmount))
  );
  const canSave = !busy && draftValid;
  const currentTone: Tone = gate.mode === 'token_required' ? 'success' : 'warning';

  return (
    <div className="grid gap-3 border-b border-white/10 bg-black/20 p-3 lg:grid-cols-[minmax(15rem,0.32fr)_minmax(0,1fr)]">
      <div className="min-w-0 rounded-md border border-amber-300/25 bg-white/[0.025] p-3">
        <div className="font-body text-[10px] font-semibold uppercase text-amber-200/70">Ranked Entry</div>
        <div className="mt-2"><Pill tone={currentTone}>{formatRankedEntryGateMode(gate.mode)}</Pill></div>
        <div className="mt-3 break-all font-mono text-xs text-white/50">
          {gate.tokenMintAddress ? formatCompactIdentifier(gate.tokenMintAddress, 6, 6) : 'No token mint'}
        </div>
        <div className="mt-2 font-body text-[11px] text-white/40">
          {gate.requiredTokenAmount} {gate.tokenSymbol} required
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Pill tone={gate.rpcConfigured ? 'success' : 'warning'}>{gate.rpcConfigured ? 'RPC ready' : 'RPC missing'}</Pill>
          <Pill>{gate.cluster}</Pill>
        </div>
      </div>

      <div className="min-w-0">
        <div className="grid gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(6rem,0.25fr)_minmax(10rem,0.45fr)_auto] md:items-end">
          <div>
            <div className="font-body text-[10px] font-semibold uppercase text-white/45">Mode</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(['locked', 'token_required'] as RankedEntryGateMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={draft.mode === mode}
                  disabled={busy}
                  onClick={() => onDraftChange({ ...draft, mode })}
                  className={`h-7 rounded-md border px-3 font-body text-[11px] font-semibold uppercase transition disabled:cursor-wait ${
                    draft.mode === mode
                      ? 'border-amber-300/55 bg-amber-300/15 text-amber-100'
                      : 'border-white/10 bg-white/[0.04] text-white/65 hover:border-amber-300/35 hover:text-white'
                  }`}
                >
                  {mode === 'token_required' ? 'Token' : 'Locked'}
                </button>
              ))}
            </div>
          </div>

          <label className="block min-w-0">
            <span className="font-body text-[10px] font-semibold uppercase text-white/45">Mint Address</span>
            <input
              type="text"
              value={draft.tokenMintAddress}
              disabled={busy}
              onChange={(event) => onDraftChange({ ...draft, tokenMintAddress: event.target.value })}
              placeholder="SPL mint address"
              className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-mono text-xs text-white outline-none transition placeholder:text-white/25 focus:border-amber-300/55"
            />
          </label>

          <label className="block">
            <span className="font-body text-[10px] font-semibold uppercase text-white/45">Symbol</span>
            <input
              type="text"
              value={draft.tokenSymbol}
              disabled={busy}
              maxLength={12}
              onChange={(event) => onDraftChange({ ...draft, tokenSymbol: event.target.value.toUpperCase() })}
              className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-body text-xs text-white outline-none transition focus:border-amber-300/55"
            />
          </label>

          <label className="block">
            <span className="font-body text-[10px] font-semibold uppercase text-white/45">Tokens Required</span>
            <input
              type="text"
              inputMode="numeric"
              value={draft.requiredTokenAmount}
              disabled={busy}
              onChange={(event) => onDraftChange({ ...draft, requiredTokenAmount: event.target.value.replace(/\D/g, '') })}
              className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-mono text-xs text-white outline-none transition focus:border-amber-300/55"
            />
          </label>

          <button
            type="button"
            disabled={!canSave}
            onClick={onSave}
            className="h-8 rounded-md border border-amber-300/45 bg-amber-300/15 px-3 font-body text-[11px] font-semibold uppercase text-amber-100 transition hover:border-amber-300/70 hover:bg-amber-300/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-white/35"
          >
            Save Gate
          </button>
        </div>

        <div className={`mt-3 rounded-md border px-3 py-2 font-body text-[11px] ${
          tokenRequired
            ? draftValid
              ? 'border-ui-success/30 bg-ui-success/10 text-emerald-100'
              : 'border-ui-warning/35 bg-ui-warning/10 text-yellow-100'
            : 'border-white/10 bg-white/[0.025] text-white/42'
        }`}>
          {tokenRequired
            ? draftValid
              ? 'Ranked will require the configured whole-token amount.'
              : 'Token mode needs a mint address, symbol, and positive whole-token amount.'
            : 'Ranked entry is locked until token mode is enabled.'}
        </div>
      </div>
    </div>
  );
}

function RankedSeasonPanel({
  season,
  draft,
  busy,
  onDraftChange,
  onSave,
}: {
  season: RankedSeasonOverview;
  draft: RankedSeasonDraft;
  busy: boolean;
  onDraftChange: (draft: RankedSeasonDraft) => void;
  onSave: () => void;
}) {
  const currentIdentity = getRankedSeasonIdentity(season.mode, season.seasonNumber);
  const nextSeasonNumber = Number(draft.seasonNumber);
  const invalidSeasonNumber = !Number.isFinite(nextSeasonNumber) || nextSeasonNumber < 1 || nextSeasonNumber > 999;
  const nextIdentity = getRankedSeasonIdentity(draft.mode, nextSeasonNumber);
  const willReset = currentIdentity !== nextIdentity;
  const boundaryLabel = draft.mode === 'preseason' ? 'Next Season Begins At' : 'Ends At';

  return (
    <div className="grid gap-3 border-b border-white/10 bg-black/20 p-3 lg:grid-cols-[minmax(15rem,0.32fr)_minmax(0,1fr)]">
      <div className="ranked-season-admin-card min-w-0 rounded-md border border-accent-primary/25 p-3">
        <div className="font-body text-[10px] font-semibold uppercase text-accent-primary/75">Ranked Cycle</div>
        <div className="mt-2 font-body text-2xl font-semibold leading-none text-white">{season.label}</div>
        <div className="mt-2">
          <Pill>{formatSeasonBoundary(season.mode, season.endsAt)}</Pill>
        </div>
        <div className="mt-2 font-body text-[11px] text-white/40">
          Last reset {season.lastResetAt ? formatDate(season.lastResetAt) : 'not recorded'}
        </div>
      </div>

      <div className="min-w-0">
        <div className="grid gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(7rem,0.35fr)_minmax(12rem,0.55fr)_auto] md:items-end">
          <div>
            <div className="font-body text-[10px] font-semibold uppercase text-white/45">Mode</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(['season', 'preseason'] as RankedSeasonMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={draft.mode === mode}
                  disabled={busy}
                  onClick={() => onDraftChange({ ...draft, mode })}
                  className={`h-7 rounded-md border px-3 font-body text-[11px] font-semibold uppercase transition disabled:cursor-wait ${
                    draft.mode === mode
                      ? 'border-accent-primary/55 bg-accent-primary/20 text-white'
                      : 'border-white/10 bg-white/[0.04] text-white/65 hover:border-accent-primary/35 hover:text-white'
                  }`}
                >
                  {mode === 'season' ? 'Season' : 'Pre-Season'}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="font-body text-[10px] font-semibold uppercase text-white/45">Number</span>
            <input
              type="number"
              min={1}
              max={999}
              value={draft.seasonNumber}
              disabled={busy || draft.mode === 'preseason'}
              onChange={(event) => onDraftChange({ ...draft, seasonNumber: event.target.value })}
              className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-body text-xs text-white outline-none transition focus:border-accent-primary/55 disabled:opacity-45"
            />
          </label>

          <label className="block">
            <span className="font-body text-[10px] font-semibold uppercase text-white/45">{boundaryLabel}</span>
            <input
              type="datetime-local"
              value={draft.endsAtLocal}
              disabled={busy}
              onChange={(event) => onDraftChange({ ...draft, endsAtLocal: event.target.value })}
              title={boundaryLabel}
              className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-body text-xs text-white outline-none transition focus:border-accent-primary/55"
            />
          </label>

          <button
            type="button"
            disabled={busy || (draft.mode === 'season' && invalidSeasonNumber)}
            onClick={onSave}
            className="h-8 rounded-md border border-accent-primary/45 bg-accent-primary/20 px-3 font-body text-[11px] font-semibold uppercase text-white transition hover:border-accent-primary/70 hover:bg-accent-primary/30 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-white/35"
          >
            Save Season
          </button>
        </div>

        <div className={`mt-3 rounded-md border px-3 py-2 font-body text-[11px] ${
          willReset
            ? 'border-ui-warning/35 bg-ui-warning/10 text-yellow-100'
            : 'border-white/10 bg-white/[0.025] text-white/42'
        }`}>
          {willReset
            ? 'Changing this season will archive the current season and reset player ratings to ranked defaults.'
            : 'Schedule edits keep ranked stats intact.'}
        </div>
      </div>
    </div>
  );
}

function PlayerRankPanel({
  users,
  pagination,
  search,
  reason,
  drafts,
  loading,
  busyUserId,
  onSearchChange,
  onReasonChange,
  onSearch,
  onClearSearch,
  onPageChange,
  onDraftChange,
  onSave,
}: {
  users: AdminRankUser[];
  pagination: AdminUsersPagination;
  search: string;
  reason: string;
  drafts: Record<string, string>;
  loading: boolean;
  busyUserId: string | null;
  onSearchChange: (search: string) => void;
  onReasonChange: (reason: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
  onPageChange: (page: number) => void;
  onDraftChange: (userId: string, rating: string) => void;
  onSave: (user: AdminRankUser) => void;
}) {
  const firstVisible = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const lastVisible = Math.min(pagination.total, pagination.page * pagination.limit);
  const rankGateSelectOptions = useMemo<AdminSelectOption[]>(() => [
    {
      value: '',
      label: 'Exact override',
      detail: 'Use the rating field',
    },
    ...RANK_OPTIONS.map((option) => ({
      value: option.rating.toString(),
      label: option.label,
      detail: `${option.rangeLabel} range / ${formatNumber(option.rating)} floor`,
    })),
  ], []);

  return (
    <div>
      <form
        className="grid gap-3 border-b border-white/10 bg-black/20 p-3 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <label className="block min-w-0">
          <span className="font-body text-[10px] font-semibold uppercase text-white/45">Search</span>
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Name, wallet, or user id"
            className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-body text-xs text-white outline-none transition placeholder:text-white/25 focus:border-accent-primary/55"
          />
        </label>

        <label className="block min-w-0">
          <span className="font-body text-[10px] font-semibold uppercase text-white/45">Reason</span>
          <input
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="Manual correction"
            className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-body text-xs text-white outline-none transition placeholder:text-white/25 focus:border-accent-primary/55"
          />
        </label>

        <div className="flex items-end gap-2">
          <button
            type="submit"
            disabled={loading}
            className="h-8 rounded-md border border-accent-primary/45 bg-accent-primary/20 px-3 font-body text-[11px] font-semibold uppercase text-white transition hover:border-accent-primary/70 hover:bg-accent-primary/30 disabled:cursor-wait disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-white/35"
          >
            Search
          </button>
          <ActionButton disabled={loading} onClick={onClearSearch}>
            Clear
          </ActionButton>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-white/[0.018] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="amber">{formatNumber(pagination.total)} users</Pill>
          <span className="font-body text-[11px] text-white/42">
            Showing {formatNumber(firstVisible)}-{formatNumber(lastVisible)} / page {formatNumber(pagination.page)} of {formatNumber(pagination.totalPages)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ActionButton disabled={loading || !pagination.hasPrevious} onClick={() => onPageChange(pagination.page - 1)}>
            Prev
          </ActionButton>
          <span className="min-w-[5.5rem] text-center font-mono text-[11px] text-white/45">
            {formatNumber(pagination.page)} / {formatNumber(pagination.totalPages)}
          </span>
          <ActionButton disabled={loading || !pagination.hasNext} onClick={() => onPageChange(pagination.page + 1)}>
            Next
          </ActionButton>
        </div>
      </div>

      {users.length === 0 ? (
        <EmptyTable label={loading ? 'Loading players.' : 'No users found.'} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1480px] table-fixed border-collapse">
            <colgroup>
              <col className="w-[15%]" />
              <col className="w-[13%]" />
              <col className="w-[21%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
              <col className="w-[9%]" />
            </colgroup>
            <thead>
              <tr>
                <HeaderCell>Player</HeaderCell>
                <HeaderCell>Current</HeaderCell>
                <HeaderCell>Target</HeaderCell>
                <HeaderCell>Ranked Record</HeaderCell>
                <HeaderCell>Total Record</HeaderCell>
                <HeaderCell>Peak</HeaderCell>
                <HeaderCell>Actions</HeaderCell>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const draft = drafts[user.id] ?? user.competitiveRating.toString();
                const parsedRating = parseDraftRating(draft);
                const canSave = parsedRating !== null && parsedRating !== user.competitiveRating && busyUserId !== user.id;
                const optionValue = parsedRating === null
                  ? ''
                  : RANK_OPTIONS.some((option) => option.rating === parsedRating)
                    ? parsedRating.toString()
                    : '';
                const preview = getRankPreview(draft, user.rankedGames);
                const currentRank = getRankFromRating(user.competitiveRating, user.rankedGames);
                const peakRank = getRankFromRating(user.rankedPeakRating, user.rankedGames);

                return (
                  <tr key={user.id} className="hover:bg-white/[0.025]">
                    <Cell>
                      <div className="truncate text-white">{user.name}</div>
                      {user.walletAddress && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <span
                            title={user.walletAddress}
                            className="inline-flex max-w-full items-center rounded border border-white/10 bg-white/[0.025] px-1.5 py-0.5 font-mono text-[10px] leading-none text-white/35"
                          >
                            Wallet {formatCompactIdentifier(user.walletAddress)}
                          </span>
                        </div>
                      )}
                      <div className="mt-1.5 text-[11px] text-white/35">
                        Last login {user.lastLoginAt ? formatAge(Date.parse(user.lastLoginAt)) : 'never'}
                      </div>
                    </Cell>
                    <Cell>
                      <RankBadge rank={currentRank} compact className="max-w-full rounded-md" />
                      <div className="mt-2 text-[11px] text-white/45">{formatNumber(user.competitiveRating)} rating</div>
                      <div className="mt-1 font-mono text-[11px] text-white/35">{user.rank.rangeLabel}</div>
                    </Cell>
                    <Cell>
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(6.5rem,0.42fr)]">
                        <AdminSelect
                          label={`Target rank gate for ${user.name}`}
                          value={optionValue}
                          disabled={busyUserId === user.id}
                          options={rankGateSelectOptions}
                          onChange={(nextValue) => {
                            if (nextValue) onDraftChange(user.id, nextValue);
                          }}
                        />

                        <input
                          type="number"
                          min={0}
                          max={ADMIN_MANUAL_RATING_MAX}
                          value={draft}
                          disabled={busyUserId === user.id}
                          onChange={(event) => onDraftChange(user.id, event.target.value)}
                          className="h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-mono text-xs text-white outline-none transition focus:border-accent-primary/55"
                        />
                      </div>
                      <div className={`mt-2 font-body text-[11px] ${parsedRating === null ? 'text-red-200/70' : 'text-white/42'}`}>
                        {preview.rating === null
                          ? preview.label
                          : (
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <RankBadge rank={getRankFromRating(preview.rating, user.rankedGames)} compact className="max-w-full rounded-md py-1" />
                              <span className="text-white/42">
                                Gate {preview.gateLabel} / range <span className="font-mono text-white/45">{preview.rangeLabel}</span>
                              </span>
                            </div>
                          )}
                      </div>
                    </Cell>
                    <Cell>
                      <div className="text-white/80">{formatNumber(user.rankedWins)}W / {formatNumber(user.rankedLosses)}L / {formatNumber(user.rankedDraws)}D</div>
                      <div className="mt-1 text-[11px] text-white/40">{formatCount(user.rankedGames, 'ranked game')}</div>
                      <div className="mt-1 text-[11px] text-white/35">Last ranked {user.rankedLastMatchAt ? formatAge(Date.parse(user.rankedLastMatchAt)) : 'never'}</div>
                    </Cell>
                    <Cell>
                      <div className="text-white/80">{formatNumber(user.totalWins)}W / {formatNumber(user.totalLosses)}L / {formatNumber(user.totalDraws)}D</div>
                      <div className="mt-1 text-[11px] text-white/40">{formatCount(user.totalGames, 'game')}</div>
                      <div className="mt-1 text-[11px] text-white/35">Updated {formatAge(Date.parse(user.updatedAt))}</div>
                    </Cell>
                    <Cell>
                      <RankBadge rank={peakRank} compact className="max-w-full rounded-md" />
                      <div className="mt-2 text-[11px] text-white/45">{formatNumber(user.rankedPeakRating)} rating</div>
                      <div className="mt-1 font-mono text-[11px] text-white/35">{user.peakRank.rangeLabel}</div>
                    </Cell>
                    <Cell>
                      <div className="flex flex-wrap gap-2">
                        <ActionButton disabled={!canSave} onClick={() => onSave(user)}>
                          Save Rank
                        </ActionButton>
                      </div>
                    </Cell>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ModeButton({
  mode,
  active,
  busy,
  onClick,
}: {
  mode: GoldenBiomeDistributionMode;
  active: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={active || busy}
      onClick={onClick}
      className={`h-8 border-r border-white/10 px-4 font-body text-[11px] font-semibold uppercase transition last:border-r-0 disabled:cursor-default ${
        active
          ? 'bg-amber-300/12 text-amber-100'
          : 'text-white/55 hover:bg-white/[0.04] hover:text-white'
      }`}
    >
      {mode}
    </button>
  );
}

function GoldenBiomeRewardsPanel({
  overview,
  busyRewardId,
  busyMode,
  onSetMode,
  onDistribute,
}: {
  overview: GoldenBiomeRewardsOverview | undefined;
  busyRewardId: string | null;
  busyMode: boolean;
  onSetMode: (mode: GoldenBiomeDistributionMode) => void;
  onDistribute: (reward: GoldenBiomeRewardOverview) => void;
}) {
  if (!overview) return <EmptyTable label="Golden reward telemetry unavailable." />;

  const pendingRewards = overview.rewards.filter((reward) => reward.status !== 'complete').length;
  const treasury = overview.treasury;

  return (
    <div>
      <div className="grid border-b border-white/10 md:grid-cols-[15rem_minmax(0,1fr)_minmax(16rem,0.36fr)]">
        <div className="border-b border-white/10 px-3 py-3 md:border-b-0 md:border-r">
          <div className="font-body text-xs font-semibold uppercase text-white/76">Distribution</div>
          <div className="mt-3 grid grid-cols-2 border border-white/10 bg-black/20">
            <ModeButton
              mode="manual"
              active={overview.settings.distributionMode === 'manual'}
              busy={busyMode}
              onClick={() => onSetMode('manual')}
            />
            <ModeButton
              mode="auto"
              active={overview.settings.distributionMode === 'auto'}
              busy={busyMode}
              onClick={() => onSetMode('auto')}
            />
          </div>
        </div>

        <div className="min-w-0 border-b border-white/10 px-3 py-3 md:border-b-0 md:border-r">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="font-body text-xs font-semibold uppercase text-white/76">Treasury</div>
            <span className={cx(
              'font-mono text-[11px] font-semibold uppercase',
              treasury.eligible ? 'text-emerald-100/75' : 'text-yellow-100/75',
            )}>
              {treasury.eligible ? 'Eligible' : treasury.reason || 'Not eligible'}
            </span>
          </div>
          <div className="mt-3 break-all font-mono text-xs text-white/48">
            {treasury.treasuryWallet || overview.settings.treasuryWallet || 'No treasury wallet'}
          </div>
          <div className="mt-1 font-body text-[11px] text-white/40">
            {lamportsToSolDisplay(treasury.treasuryBalanceLamports)} SOL balance / {lamportsToSolDisplay(treasury.requiredLamports)} SOL minimum
          </div>
        </div>

        <div className="grid grid-cols-3 divide-x divide-white/[0.07] md:grid-cols-1 md:divide-x-0 md:divide-y">
          <div className="px-3 py-3">
            <div className="font-body text-[10px] font-semibold uppercase text-white/42">Reward</div>
            <div className="mt-1 font-body text-xl font-semibold leading-none text-white">{lamportsToSolDisplay(overview.settings.winnerRewardLamports)} SOL</div>
          </div>
          <div className="px-3 py-3">
            <div className="font-body text-[10px] font-semibold uppercase text-white/42">Chance</div>
            <div className="mt-1 font-body text-xl font-semibold leading-none text-white">{formatBps(overview.settings.chanceBps)}</div>
          </div>
          <div className="px-3 py-3">
            <div className="font-body text-[10px] font-semibold uppercase text-white/42">Pending</div>
            <div className="mt-1 font-body text-xl font-semibold leading-none text-white">{formatNumber(pendingRewards)}</div>
          </div>
        </div>
      </div>

      <GoldenBiomeRewardsTable
        rewards={overview.rewards}
        busyRewardId={busyRewardId}
        onDistribute={onDistribute}
      />
    </div>
  );
}

function GoldenBiomeRewardsTable({
  rewards,
  busyRewardId,
  onDistribute,
}: {
  rewards: GoldenBiomeRewardOverview[];
  busyRewardId: string | null;
  onDistribute: (reward: GoldenBiomeRewardOverview) => void;
}) {
  if (rewards.length === 0) return <EmptyTable label="No golden biome reward records yet." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1220px] table-fixed border-collapse">
        <thead>
          <tr>
            <HeaderCell>Match</HeaderCell>
            <HeaderCell>Status</HeaderCell>
            <HeaderCell>Team</HeaderCell>
            <HeaderCell align="right">Reward</HeaderCell>
            <HeaderCell>Transfers</HeaderCell>
            <HeaderCell>Actions</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {rewards.map((reward) => {
            const canDistribute = reward.status === 'pending' || reward.status === 'failed';
            return (
              <tr key={reward.id} className="hover:bg-white/[0.025]">
                <Cell mono>
                  <div className="break-all text-white">{reward.matchId}</div>
                  <div className="mt-1 font-body text-xs text-white/40">
                    seed {reward.mapSeed} / {formatAge(Date.parse(reward.createdAt))}
                  </div>
                  {reward.lastError && <div className="mt-2 font-body text-xs text-red-200/70">{reward.lastError}</div>}
                </Cell>
                <Cell>
                  <Pill tone={toneForSystemStatus(reward.status)}>{reward.status}</Pill>
                  <div className="mt-2 text-[11px] text-white/40">{reward.distributionMode}</div>
                  {reward.distributedAt && <div className="mt-1 text-[11px] text-white/35">sent {formatDate(reward.distributedAt)}</div>}
                </Cell>
                <Cell>
                  <div className="text-white">{reward.winningTeam}</div>
                  <div className="mt-1 text-[11px] text-white/40">{formatCount(reward.paidPlayerCount, 'winner')}</div>
                </Cell>
                <Cell align="right">
                  {lamportsToSolDisplay(reward.rewardLamports)} SOL each
                  <div className="text-[11px] text-white/35">{lamportsToSolDisplay(reward.totalRewardLamports)} SOL total</div>
                </Cell>
                <Cell>
                  <div className="space-y-2">
                    {reward.transfers.map((transfer) => (
                      <div key={transfer.id} className="min-w-0 border-l border-white/10 pl-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate text-white/80">{transfer.displayName || transfer.userId}</span>
                          <Pill tone={toneForSystemStatus(transfer.status)} className="px-1.5 py-0 text-[10px]">{transfer.status}</Pill>
                        </div>
                        <div className="mt-1 break-all font-mono text-[11px] text-white/35">{transfer.recipientWallet}</div>
                        {transfer.signature && <div className="mt-1 break-all font-mono text-[11px] text-emerald-100/55">{transfer.signature}</div>}
                        {transfer.lastError && <div className="mt-1 text-xs text-red-200/70">{transfer.lastError}</div>}
                      </div>
                    ))}
                  </div>
                </Cell>
                <Cell>
                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      disabled={!canDistribute || busyRewardId === reward.id}
                      onClick={() => onDistribute(reward)}
                    >
                      Distribute
                    </ActionButton>
                  </div>
                </Cell>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PlayerReportsTable({
  reports,
  busyId,
  onSetStatus,
  onAccountAction,
}: {
  reports: PlayerReportOverview[];
  busyId: string | null;
  onSetStatus: (report: PlayerReportOverview, status: string) => void;
  onAccountAction: (report: PlayerReportOverview, actionType: 'suspension' | 'ban') => void;
}) {
  if (reports.length === 0) return <EmptyTable label="No player reports." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1180px] table-fixed border-collapse">
        <thead>
          <tr>
            <HeaderCell>Report</HeaderCell>
            <HeaderCell>Status</HeaderCell>
            <HeaderCell>Target</HeaderCell>
            <HeaderCell>Reporter</HeaderCell>
            <HeaderCell>Match</HeaderCell>
            <HeaderCell>Reason</HeaderCell>
            <HeaderCell>Actions</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => (
            <tr key={report.id} className="hover:bg-white/[0.025]">
              <Cell mono>
                <div className="break-all text-white">{report.id}</div>
                <div className="mt-1 font-body text-xs text-white/40">{formatAge(Date.parse(report.createdAt))}</div>
              </Cell>
              <Cell>
                <Pill tone={toneForSystemStatus(report.status)}>{report.status}</Pill>
              </Cell>
              <Cell>
                <div className="truncate text-white">{report.targetUser?.name || report.targetName}</div>
                <div className="mt-1 break-all font-mono text-xs text-white/40">{report.targetUserId}</div>
                {report.targetTeam && <div className="mt-1 text-xs text-white/35">{report.targetTeam}</div>}
              </Cell>
              <Cell>
                <div className="truncate text-white/80">{report.reporterUser?.name || report.reporterName}</div>
                <div className="mt-1 break-all font-mono text-xs text-white/40">{report.reporterUserId}</div>
              </Cell>
              <Cell>
                <div className="break-all font-mono text-xs text-white/80">{report.matchId || report.roomId}</div>
                <div className="mt-1 text-xs text-white/40">{report.matchMode || 'unknown'} seed {report.mapSeed ?? '-'}</div>
              </Cell>
              <Cell>
                <div className="text-white/80">{report.reason}</div>
                {report.details && <div className="mt-1 line-clamp-2 text-[11px] text-white/40">{report.details}</div>}
                {report.resolution && <div className="mt-2 line-clamp-2 text-[11px] text-emerald-100/55">{report.resolution}</div>}
              </Cell>
              <Cell>
                <div className="flex flex-wrap gap-2">
                  <ActionButton disabled={busyId === report.id} onClick={() => onSetStatus(report, 'reviewing')}>Review</ActionButton>
                  <ActionButton disabled={busyId === report.id} onClick={() => onSetStatus(report, 'cleared')}>Clear</ActionButton>
                  <ActionButton disabled={busyId === report.id} onClick={() => onSetStatus(report, 'dismissed')}>Dismiss</ActionButton>
                  <ActionButton disabled={busyId === report.id} onClick={() => onAccountAction(report, 'suspension')}>Suspend</ActionButton>
                  <ActionButton disabled={busyId === report.id} onClick={() => onAccountAction(report, 'ban')}>Ban</ActionButton>
                </div>
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminDashboard() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [activePage, setActivePage] = useState<AdminPageId>('command');
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

  useEffect(() => {
    void loadOverview();
    const interval = window.setInterval(() => void loadOverview(), 3000);
    return () => window.clearInterval(interval);
  }, [loadOverview]);

  useEffect(() => {
    if (activePage !== 'players' || rankUsersLoaded || rankUsersLoading) return;
    void loadRankUsers('', 1);
  }, [activePage, loadRankUsers, rankUsersLoaded, rankUsersLoading]);

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

  const metrics = useMemo<MetricTileProps[]>(() => {
    if (!overview) return [];
    const activeReports = getActiveReportCount(overview);
    const pendingGoldenRewards = getPendingGoldenRewardCount(overview);
    const purchasableSkins = getPurchasableSkinCount(overview);
    const capacityTone = overview.capacity.full ? 'danger' : toneForPressure(overview.capacity.capacityPressure);
    return [
      { label: 'Machines', value: formatNumber(overview.totals.runningMachines), sublabel: formatCount(overview.totals.serverProcesses, 'process', 'processes'), tone: 'info' },
      { label: 'Capacity', value: `${formatNumber(overview.capacity.reservedPlayers)} / ${formatNumber(overview.capacity.maxPlayers)}`, sublabel: `${formatNumber(overview.capacity.availablePlayers)} open / ${overview.capacity.source}`, tone: capacityTone, meter: overview.capacity.capacityPressure },
      { label: 'Game Players', value: formatNumber(overview.totals.playersInGame), sublabel: `${formatNumber(overview.totals.botsInGame)} bots`, tone: 'success' },
      { label: 'Game Rooms', value: formatNumber(overview.totals.gameRooms), sublabel: `${formatNumber(overview.totals.participantsInGame)} participants`, tone: 'info' },
      { label: 'Lobby', value: formatNumber(overview.totals.lobbyParticipants), sublabel: formatCount(overview.totals.lobbyRooms, 'lobby', 'lobbies'), tone: 'neutral' },
      { label: 'Ranked', value: overview.rankedSeason.label, sublabel: formatRankedEntryGateMode(overview.rankedEntryGate.mode), tone: overview.rankedEntryGate.mode === 'token_required' ? 'success' : 'amber' },
      { label: 'Skin Shop', value: overview.skinShop.shop.enabled ? 'Online' : 'Locked', sublabel: `${formatNumber(purchasableSkins)} priced`, tone: overview.skinShop.shop.enabled ? 'success' : 'amber' },
      { label: 'Golden Rewards', value: formatNumber(pendingGoldenRewards), sublabel: overview.goldenBiomeRewards?.settings.distributionMode ?? 'manual', tone: pendingGoldenRewards > 0 ? 'warning' : 'success' },
      { label: 'Reports', value: formatNumber(activeReports), sublabel: `${formatNumber(overview.playerReports?.reports.length ?? 0)} listed`, tone: activeReports > 0 ? 'warning' : 'success' },
      { label: 'Clients', value: formatNumber(overview.totals.totalConnectedClients), sublabel: overview.diagnostics.redis.ok ? 'redis ok' : `redis ${overview.diagnostics.redis.status}`, tone: overview.diagnostics.redis.ok ? 'success' : 'danger' },
    ];
  }, [overview]);

  const pages = useMemo<AdminPage[]>(() => {
    if (!overview) return [];
    const activeReports = getActiveReportCount(overview);
    const pendingGoldenRewards = getPendingGoldenRewardCount(overview);
    const totalRooms = getTotalRoomCount(overview);
    const capacityTone = overview.capacity.full ? 'danger' : toneForPressure(overview.capacity.capacityPressure);

    return [
      {
        id: 'command',
        label: 'Command Center',
        eyebrow: 'At-a-glance operations',
        meta: overview.status,
        tone: toneForSystemStatus(overview.status),
      },
      {
        id: 'liveOps',
        label: 'Live Ops',
        eyebrow: 'Broadcasts and ranked access',
        meta: overview.globalNotification ? 'message on' : formatRankedEntryGateMode(overview.rankedEntryGate.mode),
        tone: overview.globalNotification
          ? 'warning'
          : overview.rankedEntryGate.mode === 'token_required'
            ? 'success'
            : 'amber',
      },
      {
        id: 'players',
        label: 'Players',
        eyebrow: 'Reports and ranked corrections',
        meta: `${formatNumber(activeReports)} active`,
        tone: activeReports > 0 ? 'warning' : 'success',
      },
      {
        id: 'economy',
        label: 'Economy',
        eyebrow: 'Rewards and skin shop',
        meta: `${formatNumber(pendingGoldenRewards)} pending`,
        tone: pendingGoldenRewards > 0 ? 'warning' : 'success',
      },
      {
        id: 'infrastructure',
        label: 'Infrastructure',
        eyebrow: 'Machines, rooms, diagnostics',
        meta: `${formatNumber(totalRooms)} rooms`,
        tone: capacityTone,
      },
    ];
  }, [overview]);

  const activePageMeta = pages.find((page) => page.id === activePage) ?? {
    id: 'command',
    label: 'Command Center',
    eyebrow: 'At-a-glance operations',
    meta: 'loading',
    tone: 'neutral' as Tone,
  };

  return (
    <main className="admin-dashboard h-dvh overflow-hidden text-white">
      <div className="grid h-full min-h-0 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="admin-sidebar hidden min-h-0 lg:flex lg:flex-col">
          <div className="admin-sidebar__brand p-5">
            <div className="font-body text-[10px] font-semibold uppercase leading-none text-accent-primary/75">SLOP HEROES</div>
            <h1 className="mt-3 font-display text-4xl leading-none text-white">Admin Console</h1>
            <div className="mt-3 flex flex-wrap gap-2">
              {overview ? <StatusPill status={overview.status} /> : <Pill>Loading</Pill>}
              {overview?.admin.elevatedAntiCheatRole && <Pill tone="info">Anti-cheat</Pill>}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
            <AdminNavigation pages={pages} activePage={activePage} onChange={setActivePage} />
          </div>

          <div className="admin-sidebar__footer space-y-3 p-3.5">
            {overview && (
              <div className="admin-user-card min-w-0 rounded-md p-3">
                <div className="truncate font-body text-xs font-semibold text-white">{overview.admin.name}</div>
                <div className="mt-1 truncate font-mono text-[11px] text-white/35" title={overview.admin.walletAddress}>
                  {formatCompactIdentifier(overview.admin.walletAddress, 6, 6)}
                </div>
                <div className="mt-2 font-body text-[11px] text-white/35">
                  Sampled {formatDateAge(overview.generatedAt)}
                </div>
              </div>
            )}
            <ActionButton onClick={() => void loadOverview()}>Refresh</ActionButton>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          <header className="admin-topbar z-20 px-3 py-3 md:px-5">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
              <div className="min-w-0">
                <div className="font-body text-[10px] font-semibold uppercase leading-none text-white/38 lg:hidden">SLOP HEROES Admin</div>
                <div className="mt-1 font-body text-[10px] font-semibold uppercase leading-none text-accent-primary/70">{activePageMeta.eyebrow}</div>
                <h2 className="mt-1 font-body text-3xl font-semibold leading-none text-white">{activePageMeta.label}</h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {overview && <StatusPill status={overview.status} />}
                {overview?.admin.elevatedAntiCheatRole && <Pill tone="info">Anti-cheat</Pill>}
                <ActionButton onClick={() => void loadOverview()}>Refresh</ActionButton>
              </div>
            </div>

            {overview && (
              <div className="mt-3 lg:hidden">
                <AdminNavigation pages={pages} activePage={activePage} compact onChange={setActivePage} />
              </div>
            )}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="admin-content mx-auto w-full max-w-[1580px] space-y-4 p-3 md:p-5">
              {error && (
                <div className="rounded-md border border-ui-danger/40 bg-ui-danger/10 px-3 py-2 font-body text-xs text-red-100">
                  {error}
                </div>
              )}

              {overview?.diagnostics.warnings && overview.diagnostics.warnings.length > 0 && (
                <div className="rounded-md border border-ui-warning/40 bg-ui-warning/10 px-3 py-2 font-body text-xs text-yellow-100">
                  {overview.diagnostics.warnings.map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              )}

              {overview ? (
                <>
                  {overview.capacity.full && (
                    <div className="rounded-md border border-ui-warning/45 bg-ui-warning/10 px-3 py-2 font-body text-xs text-yellow-100">
                      Max in-game players hit: {formatNumber(overview.capacity.reservedPlayers)} / {formatNumber(overview.capacity.maxPlayers)} reserved across {formatNumber(overview.capacity.maxMachines)} machines. Queued players will wait until a match frees space.
                    </div>
                  )}

                  {activePage === 'command' && (
                    <CommandCenterPage
                      overview={overview}
                      metrics={metrics}
                      onNavigate={setActivePage}
                    />
                  )}

                  {activePage === 'liveOps' && (
                    <div id="admin-page-live-ops" className="flex flex-col gap-3">
                      <Section
                        title="Global Notification"
                        meta={overview.globalNotification ? 'active' : 'off'}
                      >
                        <GlobalNotificationPanel
                          notification={overview.globalNotification}
                          draft={globalNotificationDraft}
                          busy={busyGlobalNotification}
                          onDraftChange={setGlobalNotificationDraft}
                          onSave={saveGlobalNotification}
                          onRemove={removeGlobalNotification}
                        />
                      </Section>

                      <Section title="Ranked Entry Gate" meta={formatRankedEntryGateMode(overview.rankedEntryGate.mode)}>
                        <RankedEntryGatePanel
                          gate={overview.rankedEntryGate}
                          draft={rankedEntryGateDraft}
                          busy={busyRankedEntryGate}
                          onDraftChange={updateRankedEntryGateDraft}
                          onSave={saveRankedEntryGate}
                        />
                      </Section>

                      <Section title="Ranked Season" meta={overview.rankedSeason.label}>
                        <RankedSeasonPanel
                          season={overview.rankedSeason}
                          draft={rankedSeasonDraft}
                          busy={busyRankedSeason}
                          onDraftChange={updateRankedSeasonDraft}
                          onSave={saveRankedSeason}
                        />
                      </Section>
                    </div>
                  )}

                  {activePage === 'players' && (
                    <div id="admin-page-players" className="flex flex-col gap-3">
                      <Section
                        title="Player Reports"
                        meta={`${formatNumber(getActiveReportCount(overview))} active`}
                      >
                        <PlayerReportsTable
                          reports={overview.playerReports?.reports ?? []}
                          busyId={busyReportId}
                          onSetStatus={updateReportStatus}
                          onAccountAction={applyReportAccountAction}
                        />
                      </Section>

                      <Section title="Player Ranks" meta={`${formatNumber(rankUsersPagination.total)} users`}>
                        <PlayerRankPanel
                          users={rankUsers}
                          pagination={rankUsersPagination}
                          search={rankSearch}
                          reason={rankReason}
                          drafts={rankUserDrafts}
                          loading={rankUsersLoading}
                          busyUserId={busyRankUserId}
                          onSearchChange={setRankSearch}
                          onReasonChange={setRankReason}
                          onSearch={searchRankUsers}
                          onClearSearch={clearRankUserSearch}
                          onPageChange={changeRankUserPage}
                          onDraftChange={updateRankUserDraft}
                          onSave={saveRankUser}
                        />
                      </Section>
                    </div>
                  )}

                  {activePage === 'economy' && (
                    <div id="admin-page-economy" className="flex flex-col gap-3">
                      <Section
                        title="Reward Economy"
                        meta={rewardEconomyDraftDirty ? 'unsaved' : 'live'}
                      >
                        <RewardEconomyPanel
                          draft={rewardEconomyDraft}
                          dirty={rewardEconomyDraftDirty}
                          busy={busyRewardEconomy}
                          updatedAt={overview.rewardEconomy?.playerRewards.updatedAt ?? overview.goldenBiomeRewards?.settings.updatedAt ?? null}
                          tokenSymbol={overview.rewardEconomy?.rewardTokenSymbol ?? null}
                          onDraftChange={updateRewardEconomyDraft}
                          onSave={saveRewardEconomy}
                        />
                      </Section>

                      <Section title="Skin Shop" meta={overview.skinShop.shop.enabled ? 'online' : 'locked'}>
                        <SkinShopPanel
                          overview={overview.skinShop}
                          settingsDraft={skinShopDraft}
                          itemDrafts={skinShopItemDrafts}
                          dirtyById={skinShopItemDraftDirtyById}
                          busySettings={busySkinShopSettings}
                          busyItemId={busySkinShopItemId}
                          onSettingsDraftChange={updateSkinShopDraft}
                          onItemDraftChange={updateSkinShopItemDraft}
                          onSaveSettings={saveSkinShopSettings}
                          onSaveItem={saveSkinShopItem}
                        />
                      </Section>

                      <Section
                        title="Golden Rewards"
                        meta={`${formatNumber(getPendingGoldenRewardCount(overview))} pending`}
                      >
                        <GoldenBiomeRewardsPanel
                          overview={overview.goldenBiomeRewards}
                          busyRewardId={busyGoldenRewardId}
                          busyMode={busyGoldenMode}
                          onSetMode={setGoldenDistributionMode}
                          onDistribute={distributeGoldenReward}
                        />
                      </Section>
                    </div>
                  )}

                  {activePage === 'infrastructure' && (
                    <div id="admin-page-infrastructure" className="flex flex-col gap-3">
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                        {metrics
                          .filter((metric) => ['Machines', 'Capacity', 'Game Rooms', 'Lobby', 'Clients'].includes(metric.label))
                          .map((metric) => (
                            <MetricTile key={metric.label} {...metric} />
                          ))}
                      </div>

                      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.48fr)]">
                        <Section title="Machine Pressure" meta={`${formatNumber(overview.machines.length)} machines`}>
                          <MachinePressurePanel overview={overview} />
                        </Section>

                        <Section title="Diagnostics" meta={overview.diagnostics.redis.ok ? 'healthy' : 'attention'}>
                          <DiagnosticsPanel overview={overview} />
                        </Section>
                      </div>

                      <Section title="Machines" meta={`${formatNumber(overview.machines.length)} running`}>
                        <MachinesTable machines={overview.machines} />
                      </Section>

                      <Section title="Game Rooms" meta={`${formatNumber(overview.rooms.game.length)} active`}>
                        <GameRoomsTable rooms={overview.rooms.game} />
                      </Section>

                      <Section title="Lobbies" meta={`${formatNumber(overview.rooms.lobbies.length)} active`}>
                        <LobbiesTable lobbies={overview.rooms.lobbies} />
                      </Section>
                    </div>
                  )}
                </>
              ) : loading ? (
                <EmptyTable label="Loading admin telemetry." />
              ) : (
                <EmptyTable label="Telemetry unavailable." />
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default AdminDashboard;
