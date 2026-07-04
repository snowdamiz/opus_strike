import type {
  PlayerRewardKind,
  PlayerRewardPayoutStatus,
  PlayerRewardSettings,
  PlayerRewardStatus,
  Prisma,
} from '@prisma/client';
import type { MatchMode, RankedSeasonMode, Team } from '@voxel-strike/shared';
import type { AntiCheatIntegrityGate } from '../anticheat';
import prisma from '../db';
import {
  normalizeMatchParticipants,
  type MatchParticipantSnapshot,
} from '../persistence/matchPersistence';
import { loggers } from '../utils/logger';
import { readSingletonAfterUniqueRace } from '../utils/prismaSingleton';
import { assertPublicKey, getSettlementKeypair } from '../wagers/config';
import { wagerService } from '../wagers/service';
import {
  getPlayerRewardRuntimeConfig,
  type PlayerRewardRuntimeConfig,
} from './config';
import { getRankedSeason } from '../ranking/seasonService';
import {
  RankedBrRewardAccumulator,
  computeRankedBrDynamicMatchPoolLamports,
  type RankedBrCombatGrant,
} from './rankedBrCombatRewards';
import {
  computeMinimumPayoutLamports,
  solUsdPriceService,
  type SolUsdPriceQuoteSnapshot,
  type SolUsdPriceQuote,
} from './solPrice';

export interface CreateMatchPlayerRewardsInput {
  matchId: string;
  roomId: string;
  lobbyId: string | null;
  matchMode: MatchMode;
  gameplayMode?: string;
  startedAt: Date;
  endedAt: Date;
  winningTeam: Team | null;
  participants: MatchParticipantSnapshot[];
  rankedEligible: boolean;
  integrityGate: AntiCheatIntegrityGate;
  rankedBrCombatGrants?: RankedBrCombatGrant[];
}

export interface PlayerRewardGrant {
  userId: string;
  matchId: string | null;
  playerSessionId: string | null;
  kind: 'daily_ranked_drip' | 'objective_bounty' | 'season_top_10' | 'ranked_br_combat_bounty';
  amountLamports: bigint;
  idempotencyKey: string;
  reason: string;
  priority: number;
  metadata: Record<string, unknown>;
}

export interface MatchRewardBuildInput extends CreateMatchPlayerRewardsInput {
  config: PlayerRewardRuntimeConfig;
  dailyRewardCountsByUserId: Map<string, number>;
}

export interface SeasonTopTenEntry {
  userId: string;
  userName: string;
  competitiveRating: number;
  rankedGames: number;
  rankedWins: number;
  rankedLosses: number;
  rankedDraws: number;
  rankedPeakRating: number;
  rank: number;
}

export interface PlayerRewardCreationResult {
  createdCount: number;
  totalLamports: string;
  requestedLamports: string;
  skippedReason: string | null;
}

export interface PlayerRewardPayoutResult {
  payoutId: string;
  amountLamports: string;
  signature: string | null;
  status: 'confirmed';
  rewardCount: number;
}

export interface PlayerRewardAutoPayoutResult {
  payoutCount: number;
  rewardCount: number;
  totalLamports: string;
}

export interface AdminRankedBrCombatRewardPayoutRow {
  id: string;
  userId: string;
  userName: string;
  userWalletAddress: string | null;
  matchId: string | null;
  roomId: string | null;
  lobbyId: string | null;
  matchMode: string | null;
  gameplayMode: string | null;
  playerSessionId: string | null;
  rewardStatus: PlayerRewardStatus;
  amountLamports: string;
  damageRewardLamports: string;
  eliminationRewardLamports: string;
  cappedLamports: string;
  rewardableDamageHp: number;
  humanRewardableDamageHp: number;
  botRewardableDamageHp: number;
  eliminations: number;
  humanEliminations: number;
  botEliminations: number;
  formulaVersion: string | null;
  settingsVersion: number | null;
  payout: {
    id: string;
    amountLamports: string;
    status: PlayerRewardPayoutStatus;
    signature: string | null;
    walletAddress: string;
    priceSource: string | null;
    solUsdPriceMicroUsd: string | null;
    priceObservedAt: string | null;
    submittedAt: string | null;
    confirmedAt: string | null;
    failedAt: string | null;
    lastError: string | null;
  } | null;
  createdAt: string;
  paidAt: string | null;
}

export interface AdminRankedBrCombatRewardPayoutsResponse {
  rewards: AdminRankedBrCombatRewardPayoutRow[];
  totals: {
    count: number;
    amountLamports: string;
    byRewardStatus: Partial<Record<PlayerRewardStatus, {
      count: number;
      amountLamports: string;
    }>>;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
}

export interface PendingPlayerRewardPayoutGroup {
  userId: string;
  walletAddress: string;
  rewardIds: string[];
  amountLamports: bigint;
  firstCreatedAt: Date;
}

export interface PendingPlayerRewardForPayout {
  id: string;
  userId: string;
  amountLamports: bigint;
  createdAt: Date;
  user: {
    walletAddress: string | null;
  };
}

export interface RankedBrRewardAccumulatorInit {
  accumulator: RankedBrRewardAccumulator;
  config: PlayerRewardRuntimeConfig;
}

export interface PlayerRewardSettingsSnapshot {
  enabled: boolean;
  settingsVersion: number;
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
  rankedBrCombatRewardsEnabled: boolean;
  rankedBrCombatRewardsShadowMode: boolean;
  rankedBrDamageLamportsPerHp: string;
  rankedBrKillLamports: string;
  rankedBrBotTargetRewardBps: number;
  rankedBrSourceVictimDamageCapHp: number;
  rankedBrMaxPlayerMatchLamports: string;
  rankedBrMaxPlayerDailyLamports: string;
  rankedBrMaxMatchLamports: string;
  rankedBrTreasuryExposureBps: number;
  rankedBrClientRewardTextMinLamports: string;
  minPayoutUsdCents: number;
  payoutPriceQuoteTtlMs: number;
  payoutPriceQuote: SolUsdPriceQuoteSnapshot | null;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

export type PlayerRewardSettingsUpdate = Partial<Record<keyof Omit<
  PlayerRewardSettingsSnapshot,
  'settingsVersion' | 'payoutPriceQuote' | 'updatedByUserId' | 'updatedAt'
>, unknown>>;

const PLAYER_REWARD_SETTINGS_ID = 'default';
const UNSIGNED_INTEGER_PATTERN = /^[0-9]+$/;
const PLAYER_REWARD_SETTINGS_CACHE_TTL_MS = 5_000;
const TOKEN_DRIP_PAYOUT_REWARD_KINDS = [
  'daily_ranked_drip',
  'objective_bounty',
  'season_top_10',
  'daily_mission',
] as const satisfies readonly PlayerRewardKind[];
const RANKED_BR_COMBAT_PAYOUT_REWARD_KIND = 'ranked_br_combat_bounty' as const satisfies PlayerRewardKind;
const ADMIN_REWARD_PAYOUT_LIMIT_MAX = 100;

function sumLamports(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}

function minBigint(...values: bigint[]): bigint {
  let min = values[0] ?? 0n;
  for (const value of values) {
    if (value < min) min = value;
  }
  return min;
}

function toUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getUtcDayRange(date: Date): { start: Date; end: Date; key: string } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, key: toUtcDateKey(start) };
}

function readSeasonPayoutMode(value: unknown, fallback: RankedSeasonMode): RankedSeasonMode {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === 'preseason' || value === 'season') return value;
  throw new Error('Season payout mode must be preseason or season');
}

function readSeasonPayoutNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Season payout number must be a positive integer');
  }
  return Math.floor(parsed);
}

function isCleanRankedRewardMatch(input: CreateMatchPlayerRewardsInput): boolean {
  return input.matchMode === 'ranked'
    && input.rankedEligible
    && input.integrityGate.status === 'clean'
    && !input.integrityGate.rankedHoldRequired
    && !input.integrityGate.reviewRequired;
}

function getPayoutEligibleRewardKinds(config: PlayerRewardRuntimeConfig): PlayerRewardKind[] {
  const rewardKinds: PlayerRewardKind[] = [];
  if (config.enabled) rewardKinds.push(...TOKEN_DRIP_PAYOUT_REWARD_KINDS);
  if (config.rankedBrCombatRewardsEnabled) rewardKinds.push(RANKED_BR_COMBAT_PAYOUT_REWARD_KIND);
  return rewardKinds;
}

export function buildPendingPlayerRewardPayoutGroups(
  rewards: Iterable<PendingPlayerRewardForPayout>,
  onInvalidWallet?: (input: {
    userId: string;
    rewardId: string;
    walletAddress: string | null;
    error: unknown;
  }) => void
): PendingPlayerRewardPayoutGroup[] {
  const groups = new Map<string, PendingPlayerRewardPayoutGroup>();

  for (const reward of rewards) {
    const walletAddress = reward.user.walletAddress;
    if (!walletAddress) continue;
    try {
      assertPublicKey(walletAddress, 'walletAddress');
    } catch (error) {
      onInvalidWallet?.({
        userId: reward.userId,
        rewardId: reward.id,
        walletAddress,
        error,
      });
      continue;
    }

    const key = `${reward.userId}:${walletAddress}`;
    const group = groups.get(key) ?? {
      userId: reward.userId,
      walletAddress,
      rewardIds: [],
      amountLamports: 0n,
      firstCreatedAt: reward.createdAt,
    };
    group.rewardIds.push(reward.id);
    group.amountLamports += reward.amountLamports;
    if (reward.createdAt < group.firstCreatedAt) group.firstCreatedAt = reward.createdAt;
    groups.set(key, group);
  }

  return Array.from(groups.values());
}

export function isPendingPlayerRewardPayoutEligible(input: {
  amountLamports: bigint;
  minimumPayoutLamports: bigint;
  force?: boolean;
}): boolean {
  if (input.amountLamports <= 0n) return false;
  return input.force === true || input.amountLamports >= input.minimumPayoutLamports;
}

export function limitPlayerRewardGrantsToBudget(
  grants: PlayerRewardGrant[],
  budgetLamports: bigint
): PlayerRewardGrant[] {
  if (budgetLamports <= 0n) return [];

  const limited: PlayerRewardGrant[] = [];
  let remaining = budgetLamports;
  const sorted = [...grants].sort((a, b) => a.priority - b.priority);

  for (const grant of sorted) {
    if (remaining <= 0n) break;
    const amountLamports = minBigint(grant.amountLamports, remaining);
    if (amountLamports <= 0n) continue;

    limited.push({
      ...grant,
      amountLamports,
      metadata: {
        ...grant.metadata,
        requestedAmountLamports: grant.amountLamports.toString(),
        budgetCapped: amountLamports !== grant.amountLamports,
      },
    });
    remaining -= amountLamports;
  }

  return limited;
}

export function buildMatchPlayerRewardGrants(input: MatchRewardBuildInput): PlayerRewardGrant[] {
  const config = input.config;
  if (!config.enabled || !isCleanRankedRewardMatch(input)) return [];

  const durationMs = Math.max(0, input.endedAt.getTime() - input.startedAt.getTime());
  if (durationMs < config.minMatchDurationMs) return [];

  const day = getUtcDayRange(input.endedAt);
  const participants = normalizeMatchParticipants(input.participants, input.winningTeam)
    .filter((participant) => participant.leftAt === null);
  const grants: PlayerRewardGrant[] = [];

  for (const participant of participants) {
    let remainingPlayerBudget = config.maxPlayerMatchLamports;
    if (remainingPlayerBudget <= 0n) continue;

    const dailyCount = input.dailyRewardCountsByUserId.get(participant.userId) ?? 0;
    if (
      config.dailyRankedDripLamports > 0n
      && config.dailyRankedDripMaxMatches > 0
      && dailyCount < config.dailyRankedDripMaxMatches
    ) {
      const amountLamports = minBigint(config.dailyRankedDripLamports, remainingPlayerBudget);
      if (amountLamports > 0n) {
        grants.push({
          userId: participant.userId,
          matchId: input.matchId,
          playerSessionId: participant.playerSessionId,
          kind: 'daily_ranked_drip',
          amountLamports,
          idempotencyKey: `match:${input.matchId}:daily_ranked_drip:${participant.userId}`,
          reason: 'ranked_daily_drip',
          priority: 10,
          metadata: {
            roomId: input.roomId,
            lobbyId: input.lobbyId,
            dayKey: day.key,
            dailyCountBeforeMatch: dailyCount,
            durationMs,
          },
        });
        remainingPlayerBudget -= amountLamports;
      }
    }

    let objectiveLamports = 0n;
    const won = input.winningTeam !== null && participant.team === input.winningTeam;
    if (won) objectiveLamports += config.objectiveWinLamports;
    objectiveLamports += BigInt(participant.flagCaptures) * config.objectiveFlagCaptureLamports;
    objectiveLamports += BigInt(participant.flagReturns) * config.objectiveFlagReturnLamports;
    objectiveLamports += BigInt(participant.assists) * config.objectiveAssistLamports;
    objectiveLamports = minBigint(objectiveLamports, remainingPlayerBudget);

    if (objectiveLamports > 0n) {
      grants.push({
        userId: participant.userId,
        matchId: input.matchId,
        playerSessionId: participant.playerSessionId,
        kind: 'objective_bounty',
        amountLamports: objectiveLamports,
        idempotencyKey: `match:${input.matchId}:objective_bounty:${participant.userId}`,
        reason: 'ranked_objective_bounty',
        priority: 20,
        metadata: {
          roomId: input.roomId,
          lobbyId: input.lobbyId,
          won,
          kills: participant.kills,
          deaths: participant.deaths,
          assists: participant.assists,
          flagCaptures: participant.flagCaptures,
          flagReturns: participant.flagReturns,
          durationMs,
        },
      });
    }
  }

  return limitPlayerRewardGrantsToBudget(grants, config.maxMatchPayoutLamports);
}

export function buildRankedBrCombatPlayerRewardGrants(input: {
  matchId: string;
  roomId: string;
  lobbyId: string | null;
  grants: RankedBrCombatGrant[];
}): PlayerRewardGrant[] {
  return input.grants.flatMap((grant) => {
    if (grant.amountLamports <= 0n) return [];
    return [{
      userId: grant.userId,
      matchId: input.matchId,
      playerSessionId: grant.playerSessionId,
      kind: 'ranked_br_combat_bounty' as const,
      amountLamports: grant.amountLamports,
      idempotencyKey: `match:${input.matchId}:ranked_br_combat_bounty:${grant.userId}`,
      reason: 'ranked_br_combat_bounty',
      priority: 15,
      metadata: {
        ...grant.metadata,
        roomId: input.roomId,
        lobbyId: input.lobbyId,
      },
    }];
  });
}

export function buildSeasonTopTenRewardGrants(input: {
  entries: SeasonTopTenEntry[];
  amountLamports: bigint;
  mode: RankedSeasonMode;
  seasonNumber: number;
  settledByUserId: string | null;
}): PlayerRewardGrant[] {
  if (input.entries.length === 0 || input.amountLamports <= 0n) return [];

  return input.entries.flatMap((entry) => {
    if (entry.rankedGames <= 0) return [];
    return [{
      userId: entry.userId,
      matchId: null,
      playerSessionId: null,
      kind: 'season_top_10' as const,
      amountLamports: input.amountLamports,
      idempotencyKey: `season_top_10:${input.mode}:${input.seasonNumber}:${entry.userId}`,
      reason: 'season_top_10_manual_payout',
      priority: 30,
      metadata: {
        mode: input.mode,
        seasonNumber: input.seasonNumber,
        rank: entry.rank,
        userName: entry.userName,
        competitiveRating: entry.competitiveRating,
        rankedGames: entry.rankedGames,
        rankedWins: entry.rankedWins,
        rankedLosses: entry.rankedLosses,
        rankedDraws: entry.rankedDraws,
        rankedPeakRating: entry.rankedPeakRating,
        amountLamports: input.amountLamports.toString(),
        settledByUserId: input.settledByUserId,
      },
    }];
  });
}

function serializeReward(reward: {
  id: string;
  kind: string;
  status: PlayerRewardStatus;
  amountLamports: bigint;
  reason: string;
  matchId: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  paidAt: Date | null;
}) {
  return {
    id: reward.id,
    kind: reward.kind,
    status: reward.status,
    amountLamports: reward.amountLamports.toString(),
    reason: reward.reason,
    matchId: reward.matchId,
    metadata: reward.metadata,
    createdAt: reward.createdAt.toISOString(),
    paidAt: reward.paidAt?.toISOString() ?? null,
  };
}

function jsonRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, Prisma.JsonValue>;
}

function readJsonString(
  metadata: Record<string, Prisma.JsonValue>,
  key: string,
  fallback: string | null = null
): string | null {
  const value = metadata[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return fallback;
}

function readJsonNumber(
  metadata: Record<string, Prisma.JsonValue>,
  key: string,
  fallback: number | null = null
): number | null {
  const value = metadata[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function serializeAdminRankedBrCombatRewardPayout(reward: Prisma.PlayerRewardGetPayload<{
  include: {
    user: { select: { id: true; name: true; walletAddress: true } };
    match: {
      select: {
        id: true;
        roomId: true;
        lobbyId: true;
        matchMode: true;
        gameplayMode: true;
      };
    };
    payout: {
      select: {
        id: true;
        amountLamports: true;
        status: true;
        signature: true;
        walletAddress: true;
        priceSource: true;
        solUsdPriceMicroUsd: true;
        priceObservedAt: true;
        submittedAt: true;
        confirmedAt: true;
        failedAt: true;
        lastError: true;
      };
    };
  };
}>): AdminRankedBrCombatRewardPayoutRow {
  const metadata = jsonRecord(reward.metadata);
  const humanRewardableDamageHp = readJsonNumber(metadata, 'humanRewardableDamageHp', 0) ?? 0;
  const botRewardableDamageHp = readJsonNumber(metadata, 'botRewardableDamageHp', 0) ?? 0;
  const humanEliminations = readJsonNumber(metadata, 'humanKills', 0) ?? 0;
  const botEliminations = readJsonNumber(metadata, 'botKills', 0) ?? 0;

  return {
    id: reward.id,
    userId: reward.user.id,
    userName: reward.user.name,
    userWalletAddress: reward.user.walletAddress,
    matchId: reward.matchId,
    roomId: reward.match?.roomId ?? null,
    lobbyId: reward.match?.lobbyId ?? null,
    matchMode: reward.match?.matchMode ?? null,
    gameplayMode: reward.match?.gameplayMode ?? null,
    playerSessionId: reward.playerSessionId,
    rewardStatus: reward.status,
    amountLamports: reward.amountLamports.toString(),
    damageRewardLamports: readJsonString(metadata, 'damageRewardLamports', '0') ?? '0',
    eliminationRewardLamports: readJsonString(metadata, 'killRewardLamports', '0') ?? '0',
    cappedLamports: readJsonString(metadata, 'cappedLamports', '0') ?? '0',
    rewardableDamageHp: humanRewardableDamageHp + botRewardableDamageHp,
    humanRewardableDamageHp,
    botRewardableDamageHp,
    eliminations: humanEliminations + botEliminations,
    humanEliminations,
    botEliminations,
    formulaVersion: readJsonString(metadata, 'formulaVersion'),
    settingsVersion: readJsonNumber(metadata, 'settingsVersion'),
    payout: reward.payout ? {
      id: reward.payout.id,
      amountLamports: reward.payout.amountLamports.toString(),
      status: reward.payout.status,
      signature: reward.payout.signature,
      walletAddress: reward.payout.walletAddress,
      priceSource: reward.payout.priceSource,
      solUsdPriceMicroUsd: reward.payout.solUsdPriceMicroUsd?.toString() ?? null,
      priceObservedAt: reward.payout.priceObservedAt?.toISOString() ?? null,
      submittedAt: reward.payout.submittedAt?.toISOString() ?? null,
      confirmedAt: reward.payout.confirmedAt?.toISOString() ?? null,
      failedAt: reward.payout.failedAt?.toISOString() ?? null,
      lastError: reward.payout.lastError,
    } : null,
    createdAt: reward.createdAt.toISOString(),
    paidAt: reward.paidAt?.toISOString() ?? null,
  };
}

function serializeSolUsdPriceQuote(quote: SolUsdPriceQuote | null) {
  if (!quote) return null;
  return {
    source: quote.source,
    solUsdPriceMicroUsd: quote.solUsdPriceMicroUsd.toString(),
    observedAt: quote.observedAt.toISOString(),
  };
}

function playerRewardSettingsCreateData(updatedByUserId: string | null = null) {
  const config = getPlayerRewardRuntimeConfig();
  return {
    id: PLAYER_REWARD_SETTINGS_ID,
    enabled: config.enabled,
    settingsVersion: config.settingsVersion,
    dailyRankedDripLamports: config.dailyRankedDripLamports,
    dailyRankedDripMaxMatches: config.dailyRankedDripMaxMatches,
    minMatchDurationMs: config.minMatchDurationMs,
    objectiveWinLamports: config.objectiveWinLamports,
    objectiveFlagCaptureLamports: config.objectiveFlagCaptureLamports,
    objectiveFlagReturnLamports: config.objectiveFlagReturnLamports,
    objectiveAssistLamports: config.objectiveAssistLamports,
    maxPlayerMatchLamports: config.maxPlayerMatchLamports,
    maxMatchPayoutLamports: config.maxMatchPayoutLamports,
    treasuryReserveLamports: config.treasuryReserveLamports,
    payoutBatchSize: config.payoutBatchSize,
    rankedBrCombatRewardsEnabled: config.rankedBrCombatRewardsEnabled,
    rankedBrCombatRewardsShadowMode: config.rankedBrCombatRewardsShadowMode,
    rankedBrDamageLamportsPerHp: config.rankedBrDamageLamportsPerHp,
    rankedBrKillLamports: config.rankedBrKillLamports,
    rankedBrBotTargetRewardBps: config.rankedBrBotTargetRewardBps,
    rankedBrSourceVictimDamageCapHp: config.rankedBrSourceVictimDamageCapHp,
    rankedBrMaxPlayerMatchLamports: config.rankedBrMaxPlayerMatchLamports,
    rankedBrMaxPlayerDailyLamports: config.rankedBrMaxPlayerDailyLamports,
    rankedBrMaxMatchLamports: config.rankedBrMaxMatchLamports,
    rankedBrTreasuryExposureBps: config.rankedBrTreasuryExposureBps,
    rankedBrClientRewardTextMinLamports: config.rankedBrClientRewardTextMinLamports,
    minPayoutUsdCents: config.minPayoutUsdCents,
    payoutPriceQuoteTtlMs: config.payoutPriceQuoteTtlMs,
    updatedByUserId,
  };
}

function runtimeConfigFromSettings(settings: {
  enabled: boolean;
  settingsVersion: number;
  dailyRankedDripLamports: bigint;
  dailyRankedDripMaxMatches: number;
  minMatchDurationMs: number;
  objectiveWinLamports: bigint;
  objectiveFlagCaptureLamports: bigint;
  objectiveFlagReturnLamports: bigint;
  objectiveAssistLamports: bigint;
  maxPlayerMatchLamports: bigint;
  maxMatchPayoutLamports: bigint;
  treasuryReserveLamports: bigint;
  payoutBatchSize: number;
  rankedBrCombatRewardsEnabled: boolean;
  rankedBrCombatRewardsShadowMode: boolean;
  rankedBrDamageLamportsPerHp: bigint;
  rankedBrKillLamports: bigint;
  rankedBrBotTargetRewardBps: number;
  rankedBrSourceVictimDamageCapHp: number;
  rankedBrMaxPlayerMatchLamports: bigint;
  rankedBrMaxPlayerDailyLamports: bigint;
  rankedBrMaxMatchLamports: bigint;
  rankedBrTreasuryExposureBps: number;
  rankedBrClientRewardTextMinLamports: bigint;
  minPayoutUsdCents: number;
  payoutPriceQuoteTtlMs: number;
}): PlayerRewardRuntimeConfig {
  return {
    enabled: settings.enabled,
    settingsVersion: settings.settingsVersion,
    dailyRankedDripLamports: settings.dailyRankedDripLamports,
    dailyRankedDripMaxMatches: settings.dailyRankedDripMaxMatches,
    minMatchDurationMs: settings.minMatchDurationMs,
    objectiveWinLamports: settings.objectiveWinLamports,
    objectiveFlagCaptureLamports: settings.objectiveFlagCaptureLamports,
    objectiveFlagReturnLamports: settings.objectiveFlagReturnLamports,
    objectiveAssistLamports: settings.objectiveAssistLamports,
    maxPlayerMatchLamports: settings.maxPlayerMatchLamports,
    maxMatchPayoutLamports: settings.maxMatchPayoutLamports,
    treasuryReserveLamports: settings.treasuryReserveLamports,
    payoutBatchSize: settings.payoutBatchSize,
    rankedBrCombatRewardsEnabled: settings.rankedBrCombatRewardsEnabled,
    rankedBrCombatRewardsShadowMode: settings.rankedBrCombatRewardsShadowMode,
    rankedBrDamageLamportsPerHp: settings.rankedBrDamageLamportsPerHp,
    rankedBrKillLamports: settings.rankedBrKillLamports,
    rankedBrBotTargetRewardBps: settings.rankedBrBotTargetRewardBps,
    rankedBrSourceVictimDamageCapHp: settings.rankedBrSourceVictimDamageCapHp,
    rankedBrMaxPlayerMatchLamports: settings.rankedBrMaxPlayerMatchLamports,
    rankedBrMaxPlayerDailyLamports: settings.rankedBrMaxPlayerDailyLamports,
    rankedBrMaxMatchLamports: settings.rankedBrMaxMatchLamports,
    rankedBrTreasuryExposureBps: settings.rankedBrTreasuryExposureBps,
    rankedBrClientRewardTextMinLamports: settings.rankedBrClientRewardTextMinLamports,
    minPayoutUsdCents: settings.minPayoutUsdCents,
    payoutPriceQuoteTtlMs: settings.payoutPriceQuoteTtlMs,
  };
}

function serializePlayerRewardSettings(settings: {
  enabled: boolean;
  settingsVersion: number;
  dailyRankedDripLamports: bigint;
  dailyRankedDripMaxMatches: number;
  minMatchDurationMs: number;
  objectiveWinLamports: bigint;
  objectiveFlagCaptureLamports: bigint;
  objectiveFlagReturnLamports: bigint;
  objectiveAssistLamports: bigint;
  maxPlayerMatchLamports: bigint;
  maxMatchPayoutLamports: bigint;
  treasuryReserveLamports: bigint;
  payoutBatchSize: number;
  rankedBrCombatRewardsEnabled: boolean;
  rankedBrCombatRewardsShadowMode: boolean;
  rankedBrDamageLamportsPerHp: bigint;
  rankedBrKillLamports: bigint;
  rankedBrBotTargetRewardBps: number;
  rankedBrSourceVictimDamageCapHp: number;
  rankedBrMaxPlayerMatchLamports: bigint;
  rankedBrMaxPlayerDailyLamports: bigint;
  rankedBrMaxMatchLamports: bigint;
  rankedBrTreasuryExposureBps: number;
  rankedBrClientRewardTextMinLamports: bigint;
  minPayoutUsdCents: number;
  payoutPriceQuoteTtlMs: number;
  updatedByUserId: string | null;
  updatedAt: Date;
}): PlayerRewardSettingsSnapshot {
  return {
    enabled: settings.enabled,
    settingsVersion: settings.settingsVersion,
    dailyRankedDripLamports: settings.dailyRankedDripLamports.toString(),
    dailyRankedDripMaxMatches: settings.dailyRankedDripMaxMatches,
    minMatchDurationMs: settings.minMatchDurationMs,
    objectiveWinLamports: settings.objectiveWinLamports.toString(),
    objectiveFlagCaptureLamports: settings.objectiveFlagCaptureLamports.toString(),
    objectiveFlagReturnLamports: settings.objectiveFlagReturnLamports.toString(),
    objectiveAssistLamports: settings.objectiveAssistLamports.toString(),
    maxPlayerMatchLamports: settings.maxPlayerMatchLamports.toString(),
    maxMatchPayoutLamports: settings.maxMatchPayoutLamports.toString(),
    treasuryReserveLamports: settings.treasuryReserveLamports.toString(),
    payoutBatchSize: settings.payoutBatchSize,
    rankedBrCombatRewardsEnabled: settings.rankedBrCombatRewardsEnabled,
    rankedBrCombatRewardsShadowMode: settings.rankedBrCombatRewardsShadowMode,
    rankedBrDamageLamportsPerHp: settings.rankedBrDamageLamportsPerHp.toString(),
    rankedBrKillLamports: settings.rankedBrKillLamports.toString(),
    rankedBrBotTargetRewardBps: settings.rankedBrBotTargetRewardBps,
    rankedBrSourceVictimDamageCapHp: settings.rankedBrSourceVictimDamageCapHp,
    rankedBrMaxPlayerMatchLamports: settings.rankedBrMaxPlayerMatchLamports.toString(),
    rankedBrMaxPlayerDailyLamports: settings.rankedBrMaxPlayerDailyLamports.toString(),
    rankedBrMaxMatchLamports: settings.rankedBrMaxMatchLamports.toString(),
    rankedBrTreasuryExposureBps: settings.rankedBrTreasuryExposureBps,
    rankedBrClientRewardTextMinLamports: settings.rankedBrClientRewardTextMinLamports.toString(),
    minPayoutUsdCents: settings.minPayoutUsdCents,
    payoutPriceQuoteTtlMs: settings.payoutPriceQuoteTtlMs,
    payoutPriceQuote: solUsdPriceService.getCachedQuoteSnapshot(settings.payoutPriceQuoteTtlMs),
    updatedByUserId: settings.updatedByUserId,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

function hasOwnSetting(input: PlayerRewardSettingsUpdate, fieldName: keyof PlayerRewardSettingsUpdate): boolean {
  return Object.prototype.hasOwnProperty.call(input, fieldName);
}

function parseBooleanSetting(value: unknown, fieldName: string): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw new Error(`${fieldName} must be true or false`);
}

function parseIntegerSetting(
  value: unknown,
  fieldName: string,
  options: { min?: number; max?: number } = {}
): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;
  if (!Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  if (options.min !== undefined && parsed < options.min) {
    throw new Error(`${fieldName} must be >= ${options.min}`);
  }
  if (options.max !== undefined && parsed > options.max) {
    throw new Error(`${fieldName} must be <= ${options.max}`);
  }
  return parsed;
}

function parseLamportSetting(value: unknown, fieldName: string): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error(`${fieldName} must be >= 0`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${fieldName} must be a safe unsigned integer`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && UNSIGNED_INTEGER_PATTERN.test(value.trim())) {
    return BigInt(value.trim());
  }
  throw new Error(`${fieldName} must be an unsigned integer`);
}

function parsePositiveLamportSetting(value: unknown, fieldName: string): bigint {
  const amount = parseLamportSetting(value, fieldName);
  if (amount <= 0n) throw new Error(`${fieldName} must be greater than zero`);
  return amount;
}

function readLamportUpdate(
  input: PlayerRewardSettingsUpdate,
  current: bigint,
  fieldName: keyof PlayerRewardSettingsUpdate
): bigint {
  return hasOwnSetting(input, fieldName) ? parseLamportSetting(input[fieldName], String(fieldName)) : current;
}

function readIntegerUpdate(
  input: PlayerRewardSettingsUpdate,
  current: number,
  fieldName: keyof PlayerRewardSettingsUpdate,
  options: { min?: number; max?: number } = {}
): number {
  return hasOwnSetting(input, fieldName) ? parseIntegerSetting(input[fieldName], String(fieldName), options) : current;
}

function readBooleanUpdate(
  input: PlayerRewardSettingsUpdate,
  current: boolean,
  fieldName: keyof PlayerRewardSettingsUpdate
): boolean {
  return hasOwnSetting(input, fieldName) ? parseBooleanSetting(input[fieldName], String(fieldName)) : current;
}

export class PlayerRewardService {
  private backgroundStarted = false;
  private backgroundTimers: ReturnType<typeof setInterval>[] = [];
  private settingsRowCache: { value: PlayerRewardSettings; expiresAtMs: number } | null = null;

  invalidateSettingsCache(): void {
    this.settingsRowCache = null;
  }

  private async getSettingsRow() {
    const now = Date.now();
    if (this.settingsRowCache && this.settingsRowCache.expiresAtMs > now) {
      return this.settingsRowCache.value;
    }

    return readSingletonAfterUniqueRace(
      () => prisma.playerRewardSettings.upsert({
        where: { id: PLAYER_REWARD_SETTINGS_ID },
        create: playerRewardSettingsCreateData(),
        update: {},
      }),
      () => prisma.playerRewardSettings.findUnique({
        where: { id: PLAYER_REWARD_SETTINGS_ID },
      })
    ).then((settings) => {
      this.settingsRowCache = {
        value: settings,
        expiresAtMs: Date.now() + PLAYER_REWARD_SETTINGS_CACHE_TTL_MS,
      };
      return settings;
    });
  }

  async getConfig(): Promise<PlayerRewardRuntimeConfig> {
    return runtimeConfigFromSettings(await this.getSettingsRow());
  }

  async getSettingsOverview(): Promise<PlayerRewardSettingsSnapshot> {
    return serializePlayerRewardSettings(await this.getSettingsRow());
  }

  async updateSettings(
    input: PlayerRewardSettingsUpdate,
    updatedByUserId?: string | null
  ): Promise<PlayerRewardSettingsSnapshot> {
    const current = await this.getSettingsRow();
    const settings = input ?? {};
    const updated = await prisma.playerRewardSettings.update({
      where: { id: PLAYER_REWARD_SETTINGS_ID },
      data: {
        enabled: readBooleanUpdate(settings, current.enabled, 'enabled'),
        settingsVersion: { increment: 1 },
        dailyRankedDripLamports: readLamportUpdate(settings, current.dailyRankedDripLamports, 'dailyRankedDripLamports'),
        dailyRankedDripMaxMatches: readIntegerUpdate(settings, current.dailyRankedDripMaxMatches, 'dailyRankedDripMaxMatches', { min: 0, max: 100 }),
        minMatchDurationMs: readIntegerUpdate(settings, current.minMatchDurationMs, 'minMatchDurationMs', { min: 0 }),
        objectiveWinLamports: readLamportUpdate(settings, current.objectiveWinLamports, 'objectiveWinLamports'),
        objectiveFlagCaptureLamports: readLamportUpdate(settings, current.objectiveFlagCaptureLamports, 'objectiveFlagCaptureLamports'),
        objectiveFlagReturnLamports: readLamportUpdate(settings, current.objectiveFlagReturnLamports, 'objectiveFlagReturnLamports'),
        objectiveAssistLamports: readLamportUpdate(settings, current.objectiveAssistLamports, 'objectiveAssistLamports'),
        maxPlayerMatchLamports: readLamportUpdate(settings, current.maxPlayerMatchLamports, 'maxPlayerMatchLamports'),
        maxMatchPayoutLamports: readLamportUpdate(settings, current.maxMatchPayoutLamports, 'maxMatchPayoutLamports'),
        treasuryReserveLamports: readLamportUpdate(settings, current.treasuryReserveLamports, 'treasuryReserveLamports'),
        payoutBatchSize: readIntegerUpdate(settings, current.payoutBatchSize, 'payoutBatchSize', { min: 1, max: 500 }),
        rankedBrCombatRewardsEnabled: readBooleanUpdate(settings, current.rankedBrCombatRewardsEnabled, 'rankedBrCombatRewardsEnabled'),
        rankedBrCombatRewardsShadowMode: readBooleanUpdate(settings, current.rankedBrCombatRewardsShadowMode, 'rankedBrCombatRewardsShadowMode'),
        rankedBrDamageLamportsPerHp: readLamportUpdate(settings, current.rankedBrDamageLamportsPerHp, 'rankedBrDamageLamportsPerHp'),
        rankedBrKillLamports: readLamportUpdate(settings, current.rankedBrKillLamports, 'rankedBrKillLamports'),
        rankedBrBotTargetRewardBps: readIntegerUpdate(settings, current.rankedBrBotTargetRewardBps, 'rankedBrBotTargetRewardBps', { min: 0, max: 10_000 }),
        rankedBrSourceVictimDamageCapHp: readIntegerUpdate(settings, current.rankedBrSourceVictimDamageCapHp, 'rankedBrSourceVictimDamageCapHp', { min: 0, max: 100_000 }),
        rankedBrMaxPlayerMatchLamports: readLamportUpdate(settings, current.rankedBrMaxPlayerMatchLamports, 'rankedBrMaxPlayerMatchLamports'),
        rankedBrMaxPlayerDailyLamports: readLamportUpdate(settings, current.rankedBrMaxPlayerDailyLamports, 'rankedBrMaxPlayerDailyLamports'),
        rankedBrMaxMatchLamports: readLamportUpdate(settings, current.rankedBrMaxMatchLamports, 'rankedBrMaxMatchLamports'),
        rankedBrTreasuryExposureBps: readIntegerUpdate(settings, current.rankedBrTreasuryExposureBps, 'rankedBrTreasuryExposureBps', { min: 0, max: 10_000 }),
        rankedBrClientRewardTextMinLamports: readLamportUpdate(settings, current.rankedBrClientRewardTextMinLamports, 'rankedBrClientRewardTextMinLamports'),
        minPayoutUsdCents: readIntegerUpdate(settings, current.minPayoutUsdCents, 'minPayoutUsdCents', { min: 1, max: 1_000_000 }),
        payoutPriceQuoteTtlMs: readIntegerUpdate(settings, current.payoutPriceQuoteTtlMs, 'payoutPriceQuoteTtlMs', { min: 1_000, max: 3_600_000 }),
        updatedByUserId: updatedByUserId ?? null,
      },
    });

    this.invalidateSettingsCache();
    return serializePlayerRewardSettings(updated);
  }

  async createRankedBrRewardAccumulator(input: {
    matchId: string;
    roomId: string;
    lobbyId: string | null;
    userIds: string[];
    now?: Date;
  }): Promise<RankedBrRewardAccumulatorInit> {
    const config = await this.getConfig();
    const now = input.now ?? new Date();
    const day = getUtcDayRange(now);
    const [dailyTotalsByUserId, availableTreasuryLamports] = await Promise.all([
      this.getDailyRankedBrRewardTotalsByUserId(input.userIds, day.start, day.end),
      this.getTreasuryAvailableBudgetLamports(config),
    ]);
    const matchPoolLamports = computeRankedBrDynamicMatchPoolLamports({
      availableTreasuryLamports,
      maxMatchLamports: config.rankedBrMaxMatchLamports,
      treasuryExposureBps: config.rankedBrTreasuryExposureBps,
    });

    return {
      config,
      accumulator: new RankedBrRewardAccumulator({
        matchId: input.matchId,
        roomId: input.roomId,
        lobbyId: input.lobbyId,
        dailyTotalsByUserId,
        matchPoolLamports,
      }),
    };
  }

  async createMatchRewards(input: CreateMatchPlayerRewardsInput): Promise<PlayerRewardCreationResult> {
    const config = await this.getConfig();
    const rankedBrRequestedGrants = isCleanRankedRewardMatch(input) && input.gameplayMode === 'battle_royal'
      ? buildRankedBrCombatPlayerRewardGrants({
        matchId: input.matchId,
        roomId: input.roomId,
        lobbyId: input.lobbyId,
        grants: input.rankedBrCombatGrants ?? [],
      })
      : [];

    if (!config.enabled && rankedBrRequestedGrants.length === 0) {
      return { createdCount: 0, totalLamports: '0', requestedLamports: '0', skippedReason: 'disabled' };
    }

    const userIds = Array.from(new Set(input.participants.map((participant) => participant.userId)));
    const day = getUtcDayRange(input.endedAt);
    const dailyRewardCountsByUserId = await this.getDailyRewardCountsByUserId(userIds, day.start, day.end);
    const matchRequestedGrants = config.enabled
      ? buildMatchPlayerRewardGrants({
        ...input,
        config,
        dailyRewardCountsByUserId,
      })
      : [];
    const rankedBrCombatGrants = await this.limitRankedBrCombatGrantsToFinalCaps(
      rankedBrRequestedGrants,
      config,
      input.endedAt
    );
    const requestedGrants = [...matchRequestedGrants, ...rankedBrCombatGrants];
    const requestedLamports = sumLamports(requestedGrants.map((grant) => grant.amountLamports));
    if (requestedGrants.length === 0 || requestedLamports <= 0n) {
      return { createdCount: 0, totalLamports: '0', requestedLamports: requestedLamports.toString(), skippedReason: 'no_rewards' };
    }

    const availableLamports = await this.getTreasuryAvailableBudgetLamports(config);
    const grants = limitPlayerRewardGrantsToBudget(requestedGrants, availableLamports);
    const totalLamports = sumLamports(grants.map((grant) => grant.amountLamports));
    if (grants.length === 0 || totalLamports <= 0n) {
      return { createdCount: 0, totalLamports: '0', requestedLamports: requestedLamports.toString(), skippedReason: 'treasury_budget_unavailable' };
    }

    const result = await prisma.playerReward.createMany({
      data: grants.map((grant) => ({
        userId: grant.userId,
        matchId: grant.matchId,
        playerSessionId: grant.playerSessionId,
        kind: grant.kind,
        amountLamports: grant.amountLamports,
        idempotencyKey: grant.idempotencyKey,
        reason: grant.reason,
        metadata: grant.metadata as Prisma.InputJsonObject,
      })),
      skipDuplicates: true,
    });
    await this.payPendingRewardsByIdempotencyKeys(grants.map((grant) => grant.idempotencyKey));

    return {
      createdCount: result.count,
      totalLamports: totalLamports.toString(),
      requestedLamports: requestedLamports.toString(),
      skippedReason: result.count === 0 ? 'duplicates' : null,
    };
  }

  async settleSeasonTopTenRewards(input: {
    amountLamports: unknown;
    mode?: unknown;
    seasonNumber?: unknown;
    updatedByUserId?: string | null;
  }): Promise<PlayerRewardCreationResult & {
    mode: RankedSeasonMode;
    seasonNumber: number;
    selectedPlayerCount: number;
    amountPerPlayerLamports: string;
  }> {
    const config = await this.getConfig();
    const currentSeason = await getRankedSeason();
    const mode = readSeasonPayoutMode(input.mode, currentSeason.mode);
    const seasonNumber = readSeasonPayoutNumber(input.seasonNumber, currentSeason.seasonNumber);
    const amountLamports = parsePositiveLamportSetting(input.amountLamports, 'Season top 10 payout amount');
    const idempotencyPrefix = `season_top_10:${mode}:${seasonNumber}:`;
    const existing = await prisma.playerReward.findFirst({
      where: {
        kind: 'season_top_10',
        idempotencyKey: { startsWith: idempotencyPrefix },
      },
      select: { id: true },
    });
    if (existing) {
      return {
        createdCount: 0,
        totalLamports: '0',
        requestedLamports: '0',
        skippedReason: 'already_settled',
        mode,
        seasonNumber,
        selectedPlayerCount: 0,
        amountPerPlayerLamports: amountLamports.toString(),
      };
    }

    const rows = await prisma.rankedSeasonUserStats.findMany({
      where: {
        mode,
        seasonNumber,
        rankedGames: { gt: 0 },
      },
      orderBy: [
        { competitiveRating: 'desc' },
        { rankedWins: 'desc' },
        { rankedGames: 'asc' },
        { updatedAt: 'asc' },
      ],
      take: 10,
      select: {
        userId: true,
        userName: true,
        competitiveRating: true,
        rankedGames: true,
        rankedWins: true,
        rankedLosses: true,
        rankedDraws: true,
        rankedPeakRating: true,
      },
    });

    const entries: SeasonTopTenEntry[] = rows.map((row, index) => ({
      userId: row.userId,
      userName: row.userName,
      competitiveRating: row.competitiveRating,
      rankedGames: row.rankedGames,
      rankedWins: row.rankedWins,
      rankedLosses: row.rankedLosses,
      rankedDraws: row.rankedDraws,
      rankedPeakRating: row.rankedPeakRating,
      rank: index + 1,
    }));
    if (entries.length === 0) {
      return {
        createdCount: 0,
        totalLamports: '0',
        requestedLamports: '0',
        skippedReason: 'no_rewards',
        mode,
        seasonNumber,
        selectedPlayerCount: 0,
        amountPerPlayerLamports: amountLamports.toString(),
      };
    }

    const grants = buildSeasonTopTenRewardGrants({
      entries,
      amountLamports,
      mode,
      seasonNumber,
      settledByUserId: input.updatedByUserId ?? null,
    });
    const requestedLamports = amountLamports * BigInt(entries.length);
    const totalLamports = sumLamports(grants.map((grant) => grant.amountLamports));
    if (grants.length === 0 || totalLamports <= 0n) {
      return {
        createdCount: 0,
        totalLamports: '0',
        requestedLamports: requestedLamports.toString(),
        skippedReason: 'no_rewards',
        mode,
        seasonNumber,
        selectedPlayerCount: 0,
        amountPerPlayerLamports: amountLamports.toString(),
      };
    }

    const availableLamports = await this.getTreasuryAvailableBudgetLamports(config);
    if (availableLamports < totalLamports) {
      return {
        createdCount: 0,
        totalLamports: '0',
        requestedLamports: requestedLamports.toString(),
        skippedReason: 'treasury_budget_unavailable',
        mode,
        seasonNumber,
        selectedPlayerCount: entries.length,
        amountPerPlayerLamports: amountLamports.toString(),
      };
    }

    const result = await prisma.playerReward.createMany({
      data: grants.map((grant) => ({
        userId: grant.userId,
        matchId: grant.matchId,
        playerSessionId: grant.playerSessionId,
        kind: grant.kind,
        amountLamports: grant.amountLamports,
        idempotencyKey: grant.idempotencyKey,
        reason: grant.reason,
        metadata: grant.metadata as Prisma.InputJsonObject,
      })),
      skipDuplicates: true,
    });
    await this.payPendingRewardsByIdempotencyKeys(grants.map((grant) => grant.idempotencyKey));

    return {
      createdCount: result.count,
      totalLamports: totalLamports.toString(),
      requestedLamports: requestedLamports.toString(),
      skippedReason: result.count === 0 ? 'duplicates' : null,
      mode,
      seasonNumber,
      selectedPlayerCount: entries.length,
      amountPerPlayerLamports: amountLamports.toString(),
    };
  }

  async getUserRewardSummary(userId: string) {
    const [config, totals, rewards, payouts] = await Promise.all([
      this.getConfig(),
      prisma.playerReward.groupBy({
        by: ['status'],
        where: { userId },
        _sum: { amountLamports: true },
        _count: { _all: true },
      }),
      prisma.playerReward.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          kind: true,
          status: true,
          amountLamports: true,
          reason: true,
          matchId: true,
          metadata: true,
          createdAt: true,
          paidAt: true,
        },
      }),
      prisma.playerRewardPayout.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: {
          id: true,
          amountLamports: true,
          status: true,
          signature: true,
          walletAddress: true,
          priceSource: true,
          solUsdPriceMicroUsd: true,
          priceObservedAt: true,
          createdAt: true,
          submittedAt: true,
          confirmedAt: true,
          failedAt: true,
          lastError: true,
        },
      }),
    ]);
    const pendingLamports = totals.find((row) => row.status === 'pending')?._sum.amountLamports ?? 0n;
    const priceQuote = await solUsdPriceService.getFreshQuote(config.payoutPriceQuoteTtlMs);
    const minimumPayoutLamports = priceQuote
      ? computeMinimumPayoutLamports(config.minPayoutUsdCents, priceQuote.solUsdPriceMicroUsd)
      : null;
    const remainingLamports = minimumPayoutLamports === null
      ? null
      : pendingLamports >= minimumPayoutLamports
        ? 0n
        : minimumPayoutLamports - pendingLamports;
    const progressBps = minimumPayoutLamports === null || minimumPayoutLamports <= 0n
      ? null
      : Number(minBigint(10_000n, pendingLamports * 10_000n / minimumPayoutLamports));

    return {
      totals: Object.fromEntries(totals.map((row) => [
        row.status,
        {
          amountLamports: (row._sum.amountLamports ?? 0n).toString(),
          count: row._count._all,
        },
      ])),
      payoutProgress: {
        minPayoutUsdCents: config.minPayoutUsdCents,
        pendingLamports: pendingLamports.toString(),
        minimumPayoutLamports: minimumPayoutLamports?.toString() ?? null,
        remainingLamports: remainingLamports?.toString() ?? null,
        progressBps,
        priceQuote: serializeSolUsdPriceQuote(priceQuote),
      },
      rewards: rewards.map(serializeReward),
      payouts: payouts.map((payout) => ({
        id: payout.id,
        amountLamports: payout.amountLamports.toString(),
        status: payout.status,
        signature: payout.signature,
        walletAddress: payout.walletAddress,
        priceSource: payout.priceSource,
        solUsdPriceMicroUsd: payout.solUsdPriceMicroUsd?.toString() ?? null,
        priceObservedAt: payout.priceObservedAt?.toISOString() ?? null,
        createdAt: payout.createdAt.toISOString(),
        submittedAt: payout.submittedAt?.toISOString() ?? null,
        confirmedAt: payout.confirmedAt?.toISOString() ?? null,
        failedAt: payout.failedAt?.toISOString() ?? null,
        lastError: payout.lastError,
      })),
    };
  }

  async listAdminRankedBrCombatRewardPayouts(input: {
    page?: number;
    limit?: number;
  } = {}): Promise<AdminRankedBrCombatRewardPayoutsResponse> {
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const limit = Math.max(1, Math.min(
      ADMIN_REWARD_PAYOUT_LIMIT_MAX,
      Math.floor(input.limit ?? 50)
    ));
    const where = { kind: RANKED_BR_COMBAT_PAYOUT_REWARD_KIND };
    const [total, amountTotal, statusTotals, rewards] = await Promise.all([
      prisma.playerReward.count({ where }),
      prisma.playerReward.aggregate({
        where,
        _sum: { amountLamports: true },
      }),
      prisma.playerReward.groupBy({
        by: ['status'],
        where,
        _sum: { amountLamports: true },
        _count: { _all: true },
      }),
      prisma.playerReward.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              walletAddress: true,
            },
          },
          match: {
            select: {
              id: true,
              roomId: true,
              lobbyId: true,
              matchMode: true,
              gameplayMode: true,
            },
          },
          payout: {
            select: {
              id: true,
              amountLamports: true,
              status: true,
              signature: true,
              walletAddress: true,
              priceSource: true,
              solUsdPriceMicroUsd: true,
              priceObservedAt: true,
              submittedAt: true,
              confirmedAt: true,
              failedAt: true,
              lastError: true,
            },
          },
        },
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      rewards: rewards.map(serializeAdminRankedBrCombatRewardPayout),
      totals: {
        count: total,
        amountLamports: (amountTotal._sum.amountLamports ?? 0n).toString(),
        byRewardStatus: Object.fromEntries(statusTotals.map((row) => [
          row.status,
          {
            count: row._count._all,
            amountLamports: (row._sum.amountLamports ?? 0n).toString(),
          },
        ])),
      },
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasPrevious: page > 1,
        hasNext: page < totalPages,
      },
    };
  }

  async payPendingRewards(options: {
    idempotencyKeys?: string[];
    userIds?: string[];
    limit?: number;
    force?: boolean;
  } = {}): Promise<PlayerRewardAutoPayoutResult> {
    const config = await this.getConfig();
    const empty = { payoutCount: 0, rewardCount: 0, totalLamports: '0' };
    const payoutEligibleRewardKinds = getPayoutEligibleRewardKinds(config);
    if (payoutEligibleRewardKinds.length === 0 || !this.hasSettlementSigner()) return empty;

    let candidateUserIds: string[] | null = options.userIds?.length
      ? Array.from(new Set(options.userIds))
      : null;
    if (options.idempotencyKeys?.length) {
      const seedRewards = await prisma.playerReward.findMany({
        where: {
          status: 'pending',
          kind: { in: payoutEligibleRewardKinds },
          idempotencyKey: { in: options.idempotencyKeys },
        },
        select: { userId: true },
      });
      const seedUserIds = Array.from(new Set(seedRewards.map((reward) => reward.userId)));
      candidateUserIds = candidateUserIds
        ? candidateUserIds.filter((userId) => seedUserIds.includes(userId))
        : seedUserIds;
      if (candidateUserIds.length === 0) return empty;
    }

    const rewards = await prisma.playerReward.findMany({
      where: {
        status: 'pending',
        kind: { in: payoutEligibleRewardKinds },
        ...(candidateUserIds?.length ? { userId: { in: candidateUserIds } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        userId: true,
        amountLamports: true,
        createdAt: true,
        user: {
          select: {
            walletAddress: true,
          },
        },
      },
    });
    if (rewards.length === 0) return empty;

    const groups = buildPendingPlayerRewardPayoutGroups(rewards, (invalid) => {
      loggers.room.warn('Skipping player reward payout for invalid wallet', {
        userId: invalid.userId,
        rewardId: invalid.rewardId,
        error: invalid.error instanceof Error ? invalid.error.message : String(invalid.error),
      });
    });
    if (groups.length === 0) return empty;

    const priceQuote = await solUsdPriceService.getFreshQuote(config.payoutPriceQuoteTtlMs);
    if (!priceQuote) return empty;
    const minimumPayoutLamports = computeMinimumPayoutLamports(
      config.minPayoutUsdCents,
      priceQuote.solUsdPriceMicroUsd
    );

    let payoutCount = 0;
    let rewardCount = 0;
    let totalLamports = 0n;
    const maxGroups = Math.max(1, options.limit ?? config.payoutBatchSize);
    const sortedGroups = groups
      .sort((a, b) => a.firstCreatedAt.getTime() - b.firstCreatedAt.getTime())
      .slice(0, maxGroups);

    for (const group of sortedGroups) {
      if (group.amountLamports <= 0n || group.rewardIds.length === 0) continue;
      if (!isPendingPlayerRewardPayoutEligible({
        amountLamports: group.amountLamports,
        minimumPayoutLamports,
        force: options.force,
      })) {
        loggers.room.info('Player reward payout deferred below USD threshold', {
          userId: group.userId,
          rewardCount: group.rewardIds.length,
          amountLamports: group.amountLamports.toString(),
          minimumPayoutLamports: minimumPayoutLamports.toString(),
          priceSource: priceQuote.source,
          solUsdPriceMicroUsd: priceQuote.solUsdPriceMicroUsd.toString(),
        });
        continue;
      }

      const treasuryBudgetLamports = await this.getTreasuryAvailableBudgetLamports(config);
      if (group.amountLamports > treasuryBudgetLamports) {
        loggers.room.info('Player reward payout deferred by treasury reserve', {
          userId: group.userId,
          rewardCount: group.rewardIds.length,
          amountLamports: group.amountLamports.toString(),
          treasuryBudgetLamports: treasuryBudgetLamports.toString(),
        });
        continue;
      }

      try {
        const payout = await this.payRewardGroup(group, priceQuote);
        payoutCount += 1;
        rewardCount += payout.rewardCount;
        totalLamports += BigInt(payout.amountLamports);
      } catch (error) {
        loggers.room.error('Player reward payout failed', {
          userId: group.userId,
          rewardCount: group.rewardIds.length,
          amountLamports: group.amountLamports.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      payoutCount,
      rewardCount,
      totalLamports: totalLamports.toString(),
    };
  }

  private async payPendingRewardsByIdempotencyKeys(idempotencyKeys: string[]): Promise<PlayerRewardAutoPayoutResult> {
    if (idempotencyKeys.length === 0) return { payoutCount: 0, rewardCount: 0, totalLamports: '0' };
    const config = await this.getConfig();
    return this.payPendingRewards({
      idempotencyKeys,
      limit: Math.max(idempotencyKeys.length, config.payoutBatchSize),
    });
  }

  async forcePayPendingRewardsForUser(userId: string): Promise<PlayerRewardAutoPayoutResult> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      throw new Error('userId is required');
    }
    return this.payPendingRewards({
      userIds: [normalizedUserId],
      limit: 1,
      force: true,
    });
  }

  private async payRewardGroup(input: {
    userId: string;
    walletAddress: string;
    rewardIds: string[];
    amountLamports: bigint;
  }, priceQuote: SolUsdPriceQuote): Promise<PlayerRewardPayoutResult> {
    const payout = await prisma.$transaction(async (tx) => {
      const created = await tx.playerRewardPayout.create({
        data: {
          userId: input.userId,
          walletAddress: input.walletAddress,
          amountLamports: input.amountLamports,
          priceSource: priceQuote.source,
          solUsdPriceMicroUsd: priceQuote.solUsdPriceMicroUsd,
          priceObservedAt: priceQuote.observedAt,
        },
      });
      const update = await tx.playerReward.updateMany({
        where: {
          id: { in: input.rewardIds },
          userId: input.userId,
          status: 'pending',
        },
        data: {
          status: 'processing',
          payoutId: created.id,
        },
      });
      if (update.count !== input.rewardIds.length) {
        throw new Error('Pending rewards changed; retry the payout');
      }
      return created;
    });

    try {
      const transfer = await wagerService.sendTreasuryRewardTransfer({
        recipientWallet: input.walletAddress,
        amountLamports: input.amountLamports,
        onSubmitted: async (signature) => {
          await prisma.playerRewardPayout.update({
            where: { id: payout.id },
            data: {
              status: 'submitted',
              signature,
              submittedAt: new Date(),
              lastError: null,
            },
          });
        },
      });

      await prisma.$transaction([
        prisma.playerRewardPayout.update({
          where: { id: payout.id },
          data: {
            status: 'confirmed',
            signature: transfer.signature,
            confirmedAt: transfer.confirmedAt,
            lastError: null,
          },
        }),
        prisma.playerReward.updateMany({
          where: {
            id: { in: input.rewardIds },
            payoutId: payout.id,
            status: 'processing',
          },
          data: {
            status: 'paid',
            paidAt: transfer.confirmedAt,
          },
        }),
      ]);

      return {
        payoutId: payout.id,
        amountLamports: input.amountLamports.toString(),
        signature: transfer.signature,
        status: 'confirmed',
        rewardCount: input.rewardIds.length,
      };
    } catch (error) {
      const currentPayout = await prisma.playerRewardPayout.findUnique({
        where: { id: payout.id },
        select: { signature: true },
      });
      const submitted = Boolean(currentPayout?.signature);
      await prisma.$transaction([
        prisma.playerRewardPayout.update({
          where: { id: payout.id },
          data: {
            status: 'failed',
            lastError: error instanceof Error ? error.message : String(error),
            failedAt: new Date(),
          },
        }),
        prisma.playerReward.updateMany({
          where: {
            id: { in: input.rewardIds },
            payoutId: payout.id,
            status: 'processing',
          },
          data: submitted
            ? { status: 'failed' }
            : { status: 'pending', payoutId: null },
        }),
      ]);
      throw error;
    }
  }

  private hasSettlementSigner(): boolean {
    try {
      return Boolean(getSettlementKeypair());
    } catch (error) {
      loggers.room.error('Player reward payout signer is invalid', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  startBackgroundJobs(): void {
    if (this.backgroundStarted) return;
    this.backgroundStarted = true;

    const runPayouts = () => {
      this.payPendingRewards().then((result) => {
        if (result.payoutCount > 0) {
          loggers.room.info('Player reward payouts confirmed', result);
        }
      }).catch((error) => {
        loggers.room.error('Player reward payout retry failed', error);
      });
    };

    this.backgroundTimers.push(setInterval(runPayouts, 60 * 1000));
    runPayouts();
  }

  stopBackgroundJobs(): void {
    for (const timer of this.backgroundTimers) clearInterval(timer);
    this.backgroundTimers = [];
    this.backgroundStarted = false;
  }

  private async limitRankedBrCombatGrantsToFinalCaps(
    grants: PlayerRewardGrant[],
    config: PlayerRewardRuntimeConfig,
    endedAt: Date
  ): Promise<PlayerRewardGrant[]> {
    if (grants.length === 0) return [];

    const userIds = Array.from(new Set(grants.map((grant) => grant.userId)));
    const day = getUtcDayRange(endedAt);
    const [dailyTotalsByUserId, availableTreasuryLamports] = await Promise.all([
      this.getDailyRankedBrRewardTotalsByUserId(userIds, day.start, day.end),
      this.getTreasuryAvailableBudgetLamports(config),
    ]);
    let remainingMatchBudget = computeRankedBrDynamicMatchPoolLamports({
      availableTreasuryLamports,
      maxMatchLamports: config.rankedBrMaxMatchLamports,
      treasuryExposureBps: config.rankedBrTreasuryExposureBps,
    });
    if (remainingMatchBudget <= 0n) return [];

    const limited: PlayerRewardGrant[] = [];
    for (const grant of grants) {
      if (remainingMatchBudget <= 0n) break;
      const dailyTotal = dailyTotalsByUserId.get(grant.userId) ?? 0n;
      const remainingDailyBudget = config.rankedBrMaxPlayerDailyLamports - dailyTotal;
      const amountLamports = minBigint(grant.amountLamports, remainingDailyBudget, remainingMatchBudget);
      if (amountLamports <= 0n) continue;

      const finalCappedLamports = grant.amountLamports - amountLamports;
      limited.push({
        ...grant,
        amountLamports,
        metadata: {
          ...grant.metadata,
          requestedAmountLamports: grant.amountLamports.toString(),
          finalDailyTotalBeforeMatchLamports: dailyTotal.toString(),
          finalBudgetCapped: finalCappedLamports > 0n,
          finalCappedLamports: finalCappedLamports.toString(),
          cappedLamports: (
            BigInt(String(grant.metadata.cappedLamports ?? '0')) + finalCappedLamports
          ).toString(),
        },
      });
      remainingMatchBudget -= amountLamports;
    }

    return limited;
  }

  private async getDailyRewardCountsByUserId(
    userIds: string[],
    start: Date,
    end: Date
  ): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();

    const rows = await prisma.playerReward.groupBy({
      by: ['userId'],
      where: {
        userId: { in: userIds },
        kind: 'daily_ranked_drip',
        status: { not: 'canceled' },
        createdAt: {
          gte: start,
          lt: end,
        },
      },
      _count: { _all: true },
    });

    return new Map(rows.map((row) => [row.userId, row._count._all]));
  }

  private async getDailyRankedBrRewardTotalsByUserId(
    userIds: string[],
    start: Date,
    end: Date
  ): Promise<Map<string, bigint>> {
    if (userIds.length === 0) return new Map();

    const rows = await prisma.playerReward.groupBy({
      by: ['userId'],
      where: {
        userId: { in: userIds },
        kind: 'ranked_br_combat_bounty',
        status: { not: 'canceled' },
        createdAt: {
          gte: start,
          lt: end,
        },
      },
      _sum: { amountLamports: true },
    });

    return new Map(rows.map((row) => [row.userId, row._sum.amountLamports ?? 0n]));
  }

  private async getTreasuryAvailableBudgetLamports(config?: PlayerRewardRuntimeConfig): Promise<bigint> {
    const rewardConfig = config ?? await this.getConfig();
    const wagerConfig = wagerService.getConfig();
    if (!wagerConfig.enabled || !wagerConfig.rpcUrl || !wagerConfig.treasuryWallet) {
      return 0n;
    }

    const balanceLamports = await wagerService.getTreasuryBalanceLamports();
    if (balanceLamports <= rewardConfig.treasuryReserveLamports) return 0n;
    return balanceLamports - rewardConfig.treasuryReserveLamports;
  }
}

export const playerRewardService = new PlayerRewardService();
