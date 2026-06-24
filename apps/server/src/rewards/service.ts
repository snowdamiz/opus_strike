import type { PlayerRewardStatus, Prisma } from '@prisma/client';
import type { MatchMode, Team } from '@voxel-strike/shared';
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

export interface CreateMatchPlayerRewardsInput {
  matchId: string;
  roomId: string;
  lobbyId: string | null;
  matchMode: MatchMode;
  startedAt: Date;
  endedAt: Date;
  winningTeam: Team | null;
  participants: MatchParticipantSnapshot[];
  rankedEligible: boolean;
  integrityGate: AntiCheatIntegrityGate;
}

export interface PlayerRewardGrant {
  userId: string;
  matchId: string | null;
  playerSessionId: string | null;
  kind: 'daily_ranked_drip' | 'objective_bounty' | 'weekly_leaderboard';
  amountLamports: bigint;
  idempotencyKey: string;
  reason: string;
  priority: number;
  metadata: Record<string, string | number | boolean | null>;
}

export interface MatchRewardBuildInput extends CreateMatchPlayerRewardsInput {
  config: PlayerRewardRuntimeConfig;
  dailyRewardCountsByUserId: Map<string, number>;
}

export interface WeeklyLeaderboardEntry {
  userId: string;
  score: number;
  matchCount: number;
}

export interface WeeklyRewardRange {
  weekStartsAt: Date;
  weekEndsAt: Date;
  weekKey: string;
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

export interface PlayerRewardSettingsSnapshot {
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

export type PlayerRewardSettingsUpdate = Partial<Record<keyof Omit<
  PlayerRewardSettingsSnapshot,
  'updatedByUserId' | 'updatedAt'
>, unknown>>;

const PLAYER_REWARD_SETTINGS_ID = 'default';
const UNSIGNED_INTEGER_PATTERN = /^[0-9]+$/;

function sumLamports(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}

function minBigint(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function toUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getUtcDayRange(date: Date): { start: Date; end: Date; key: string } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, key: toUtcDateKey(start) };
}

export function getPreviousUtcWeekRange(now = new Date()): WeeklyRewardRange {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const today = new Date(todayUtc);
  const day = today.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const currentWeekStart = new Date(today.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
  const weekStartsAt = new Date(currentWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekEndsAt = currentWeekStart;
  return {
    weekStartsAt,
    weekEndsAt,
    weekKey: toUtcDateKey(weekStartsAt),
  };
}

function isCleanRankedRewardMatch(input: CreateMatchPlayerRewardsInput): boolean {
  return input.matchMode === 'ranked'
    && input.rankedEligible
    && input.integrityGate.status === 'clean'
    && !input.integrityGate.rankedHoldRequired
    && !input.integrityGate.reviewRequired;
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

export function buildWeeklyLeaderboardRewardGrants(input: {
  entries: WeeklyLeaderboardEntry[];
  poolLamports: bigint;
  range: WeeklyRewardRange;
}): PlayerRewardGrant[] {
  const entries = input.entries.filter((entry) => entry.score > 0);
  if (entries.length === 0 || input.poolLamports <= 0n) return [];

  const weights = entries.map((_, index) => BigInt(entries.length - index));
  const totalWeight = sumLamports(weights);
  const baseAmounts = weights.map((weight) => input.poolLamports * weight / totalWeight);
  const dustLamports = input.poolLamports - sumLamports(baseAmounts);

  return entries.flatMap((entry, index) => {
    const amountLamports = baseAmounts[index] + (index === 0 ? dustLamports : 0n);
    if (amountLamports <= 0n) return [];

    return [{
      userId: entry.userId,
      matchId: null,
      playerSessionId: null,
      kind: 'weekly_leaderboard' as const,
      amountLamports,
      idempotencyKey: `weekly:${input.range.weekKey}:${entry.userId}`,
      reason: 'weekly_ranked_leaderboard_pool',
      priority: 30,
      metadata: {
        weekStartsAt: input.range.weekStartsAt.toISOString(),
        weekEndsAt: input.range.weekEndsAt.toISOString(),
        weekKey: input.range.weekKey,
        rank: index + 1,
        score: entry.score,
        matchCount: entry.matchCount,
        amountLamports: amountLamports.toString(),
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

function playerRewardSettingsCreateData(updatedByUserId: string | null = null) {
  const config = getPlayerRewardRuntimeConfig();
  return {
    id: PLAYER_REWARD_SETTINGS_ID,
    enabled: config.enabled,
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
    weeklyEnabled: config.weeklyEnabled,
    weeklyPoolLamports: config.weeklyPoolLamports,
    weeklyTopPlayers: config.weeklyTopPlayers,
    updatedByUserId,
  };
}

function runtimeConfigFromSettings(settings: {
  enabled: boolean;
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
  weeklyEnabled: boolean;
  weeklyPoolLamports: bigint;
  weeklyTopPlayers: number;
}): PlayerRewardRuntimeConfig {
  return {
    enabled: settings.enabled,
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
    weeklyEnabled: settings.weeklyEnabled,
    weeklyPoolLamports: settings.weeklyPoolLamports,
    weeklyTopPlayers: settings.weeklyTopPlayers,
  };
}

function serializePlayerRewardSettings(settings: {
  enabled: boolean;
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
  weeklyEnabled: boolean;
  weeklyPoolLamports: bigint;
  weeklyTopPlayers: number;
  updatedByUserId: string | null;
  updatedAt: Date;
}): PlayerRewardSettingsSnapshot {
  return {
    enabled: settings.enabled,
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
    weeklyEnabled: settings.weeklyEnabled,
    weeklyPoolLamports: settings.weeklyPoolLamports.toString(),
    weeklyTopPlayers: settings.weeklyTopPlayers,
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

  private async getSettingsRow() {
    return readSingletonAfterUniqueRace(
      () => prisma.playerRewardSettings.upsert({
        where: { id: PLAYER_REWARD_SETTINGS_ID },
        create: playerRewardSettingsCreateData(),
        update: {},
      }),
      () => prisma.playerRewardSettings.findUnique({
        where: { id: PLAYER_REWARD_SETTINGS_ID },
      })
    );
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
        weeklyEnabled: readBooleanUpdate(settings, current.weeklyEnabled, 'weeklyEnabled'),
        weeklyPoolLamports: readLamportUpdate(settings, current.weeklyPoolLamports, 'weeklyPoolLamports'),
        weeklyTopPlayers: readIntegerUpdate(settings, current.weeklyTopPlayers, 'weeklyTopPlayers', { min: 1, max: 100 }),
        updatedByUserId: updatedByUserId ?? null,
      },
    });

    return serializePlayerRewardSettings(updated);
  }

  async createMatchRewards(input: CreateMatchPlayerRewardsInput): Promise<PlayerRewardCreationResult> {
    const config = await this.getConfig();
    if (!config.enabled) {
      return { createdCount: 0, totalLamports: '0', requestedLamports: '0', skippedReason: 'disabled' };
    }

    const userIds = Array.from(new Set(input.participants.map((participant) => participant.userId)));
    const day = getUtcDayRange(input.endedAt);
    const dailyRewardCountsByUserId = await this.getDailyRewardCountsByUserId(userIds, day.start, day.end);
    const requestedGrants = buildMatchPlayerRewardGrants({
      ...input,
      config,
      dailyRewardCountsByUserId,
    });
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

  async settlePreviousWeeklyLeaderboardRewards(now = new Date()): Promise<PlayerRewardCreationResult> {
    const config = await this.getConfig();
    if (!config.enabled || !config.weeklyEnabled) {
      return { createdCount: 0, totalLamports: '0', requestedLamports: '0', skippedReason: 'disabled' };
    }

    const range = getPreviousUtcWeekRange(now);
    const existing = await prisma.playerReward.findFirst({
      where: {
        kind: 'weekly_leaderboard',
        idempotencyKey: { startsWith: `weekly:${range.weekKey}:` },
      },
      select: { id: true },
    });
    if (existing) {
      return { createdCount: 0, totalLamports: '0', requestedLamports: '0', skippedReason: 'already_settled' };
    }

    const rows = await prisma.gameMatchParticipant.groupBy({
      by: ['userId'],
      where: {
        rankedEligible: true,
        leftAt: null,
        match: {
          matchMode: 'ranked',
          rankedEligible: true,
          rankedOutcomeStatus: 'applied',
          antiCheatIntegrityStatus: 'clean',
          antiCheatReviewRequired: false,
          endedAt: {
            gte: range.weekStartsAt,
            lt: range.weekEndsAt,
          },
        },
      },
      _sum: { score: true },
      _count: { userId: true },
      orderBy: [
        { _sum: { score: 'desc' } },
        { _count: { userId: 'desc' } },
      ],
      take: config.weeklyTopPlayers,
    });

    const entries: WeeklyLeaderboardEntry[] = rows.map((row) => ({
      userId: row.userId,
      score: row._sum.score ?? 0,
      matchCount: row._count.userId,
    }));
    if (entries.length === 0) {
      return { createdCount: 0, totalLamports: '0', requestedLamports: config.weeklyPoolLamports.toString(), skippedReason: 'no_rewards' };
    }

    const availableLamports = await this.getTreasuryAvailableBudgetLamports(config);
    const poolLamports = minBigint(config.weeklyPoolLamports, availableLamports);
    const grants = buildWeeklyLeaderboardRewardGrants({ entries, poolLamports, range });
    const requestedLamports = config.weeklyPoolLamports;
    const totalLamports = sumLamports(grants.map((grant) => grant.amountLamports));
    if (grants.length === 0 || totalLamports <= 0n) {
      return { createdCount: 0, totalLamports: '0', requestedLamports: requestedLamports.toString(), skippedReason: 'no_rewards' };
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

  async getUserRewardSummary(userId: string) {
    const [totals, rewards, payouts] = await Promise.all([
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
          createdAt: true,
          submittedAt: true,
          confirmedAt: true,
          failedAt: true,
          lastError: true,
        },
      }),
    ]);

    return {
      totals: Object.fromEntries(totals.map((row) => [
        row.status,
        {
          amountLamports: (row._sum.amountLamports ?? 0n).toString(),
          count: row._count._all,
        },
      ])),
      rewards: rewards.map(serializeReward),
      payouts: payouts.map((payout) => ({
        id: payout.id,
        amountLamports: payout.amountLamports.toString(),
        status: payout.status,
        signature: payout.signature,
        walletAddress: payout.walletAddress,
        createdAt: payout.createdAt.toISOString(),
        submittedAt: payout.submittedAt?.toISOString() ?? null,
        confirmedAt: payout.confirmedAt?.toISOString() ?? null,
        failedAt: payout.failedAt?.toISOString() ?? null,
        lastError: payout.lastError,
      })),
    };
  }

  async payPendingRewards(options: {
    idempotencyKeys?: string[];
    limit?: number;
  } = {}): Promise<PlayerRewardAutoPayoutResult> {
    const config = await this.getConfig();
    const empty = { payoutCount: 0, rewardCount: 0, totalLamports: '0' };
    if (!config.enabled || !this.hasSettlementSigner()) return empty;

    const rewards = await prisma.playerReward.findMany({
      where: {
        status: 'pending',
        ...(options.idempotencyKeys?.length
          ? { idempotencyKey: { in: options.idempotencyKeys } }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: options.limit ?? config.payoutBatchSize,
      select: {
        id: true,
        userId: true,
        amountLamports: true,
        user: {
          select: {
            walletAddress: true,
          },
        },
      },
    });
    if (rewards.length === 0) return empty;

    const groups = new Map<string, {
      userId: string;
      walletAddress: string;
      rewardIds: string[];
      amountLamports: bigint;
    }>();

    for (const reward of rewards) {
      const walletAddress = reward.user.walletAddress;
      if (!walletAddress) continue;
      try {
        assertPublicKey(walletAddress, 'walletAddress');
      } catch (error) {
        loggers.room.warn('Skipping player reward payout for invalid wallet', {
          userId: reward.userId,
          rewardId: reward.id,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const key = `${reward.userId}:${walletAddress}`;
      const group = groups.get(key) ?? {
        userId: reward.userId,
        walletAddress,
        rewardIds: [],
        amountLamports: 0n,
      };
      group.rewardIds.push(reward.id);
      group.amountLamports += reward.amountLamports;
      groups.set(key, group);
    }

    let payoutCount = 0;
    let rewardCount = 0;
    let totalLamports = 0n;

    for (const group of groups.values()) {
      if (group.amountLamports <= 0n || group.rewardIds.length === 0) continue;

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
        const payout = await this.payRewardGroup(group);
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

  private async payRewardGroup(input: {
    userId: string;
    walletAddress: string;
    rewardIds: string[];
    amountLamports: bigint;
  }): Promise<PlayerRewardPayoutResult> {
    const payout = await prisma.$transaction(async (tx) => {
      const created = await tx.playerRewardPayout.create({
        data: {
          userId: input.userId,
          walletAddress: input.walletAddress,
          amountLamports: input.amountLamports,
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

    const runWeekly = () => {
      this.settlePreviousWeeklyLeaderboardRewards().then((result) => {
        if (result.createdCount > 0) {
          loggers.room.info('Weekly player reward pool settled', result);
        }
      }).catch((error) => {
        loggers.room.error('Weekly player reward settlement failed', error);
      });
    };

    const runPayouts = () => {
      this.payPendingRewards().then((result) => {
        if (result.payoutCount > 0) {
          loggers.room.info('Player reward payouts confirmed', result);
        }
      }).catch((error) => {
        loggers.room.error('Player reward payout retry failed', error);
      });
    };

    this.backgroundTimers.push(setInterval(runWeekly, 60 * 60 * 1000));
    this.backgroundTimers.push(setInterval(runPayouts, 60 * 1000));
    runWeekly();
    runPayouts();
  }

  stopBackgroundJobs(): void {
    for (const timer of this.backgroundTimers) clearInterval(timer);
    this.backgroundTimers = [];
    this.backgroundStarted = false;
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

  private async getTreasuryAvailableBudgetLamports(config?: PlayerRewardRuntimeConfig): Promise<bigint> {
    const rewardConfig = config ?? await this.getConfig();
    const wagerConfig = wagerService.getConfig();
    if (!rewardConfig.enabled || !wagerConfig.enabled || !wagerConfig.rpcUrl || !wagerConfig.treasuryWallet) {
      return 0n;
    }

    const balanceLamports = await wagerService.getTreasuryBalanceLamports();
    if (balanceLamports <= rewardConfig.treasuryReserveLamports) return 0n;
    return balanceLamports - rewardConfig.treasuryReserveLamports;
  }
}

export const playerRewardService = new PlayerRewardService();
