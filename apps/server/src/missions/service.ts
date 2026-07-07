import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  DAILY_MISSION_GAMEPLAY_MODES,
  DAILY_MISSION_MATCH_MODES,
  DEFAULT_DAILY_MISSION_ELIGIBILITY,
  getDailyMissionPercentComplete,
  getHeroSkinDefinition,
  type DailyMissionAdminMissionRow,
  type DailyMissionAdminOverview,
  type DailyMissionCriteria,
  type DailyMissionDefinitionSnapshot,
  type DailyMissionEligibility,
  type DailyMissionGrantStatus,
  type DailyMissionProgressSnapshot,
  type DailyMissionReward,
  type DailyMissionRewardBundle,
  type DailyMissionRewardGrantSnapshot,
  type DailyMissionRewardType,
  type GameplayMode,
  type HeroId,
  type HeroSkinId,
  type MatchMode,
  type Team,
} from '@voxel-strike/shared';
import prisma from '../db';
import type { AntiCheatIntegrityGate } from '../anticheat';
import { getGameTokenConfig } from '../config/gameToken';
import {
  calculateParticipantExperience,
  calculateParticipantScore,
  getMatchOutcome,
  normalizeMatchParticipants,
  type MatchKillEventSnapshot,
  type MatchParticipantSnapshot,
} from '../persistence/matchPersistence';
import { getPlayerRewardRuntimeConfig } from '../rewards/config';
import { playerRewardService } from '../rewards/service';
import { computeUsdCentsToLamports, solUsdPriceService } from '../rewards/solPrice';
import { loggers } from '../utils/logger';
import { getSettlementKeypair, getWagerRuntimeConfig } from '../wagers/config';
import {
  buildBurnCheckedTransaction,
  buildJupiterSwapTransaction,
  extractTokenAccountMintDelta,
  fetchJupiterSwapBuild,
  getWagerGameTokenRuntime,
  WAGER_NATIVE_SOL_MINT,
  type JupiterSwapBuildResponse,
  type WagerGameTokenRuntime,
} from '../wagers/tokenConversion';
import {
  MissionValidationError,
  parseMissionDefinitionPayload,
  type MissionDefinitionPayload,
} from './validation';

const ACTIVE_MISSION_LIMIT = 50;
const ADMIN_LIBRARY_LIMIT = 200;
const ADMIN_AUDIT_LIMIT = 75;
const TOKEN_PAYOUT_BATCH_SIZE = 25;
const TOKEN_PAYOUT_MAX_ATTEMPTS = 6;
const MISSION_PROGRESS_SCOPE_KEY = 'lifetime';
const MISSION_REWARD_BPS_TOTAL = 10_000;

export interface SettleMatchDailyMissionsInput {
  matchId: string;
  roomId: string;
  lobbyId: string | null;
  matchMode: MatchMode;
  gameplayMode: GameplayMode;
  startedAt: Date;
  endedAt: Date;
  winningTeam: Team | null;
  participants: MatchParticipantSnapshot[];
  killEvents: MatchKillEventSnapshot[];
  rankedEligible: boolean;
  integrityGate: AntiCheatIntegrityGate;
}

type MissionDefinitionRecord = {
  id: string;
  displayName: string;
  description: string;
  enabled: boolean;
  sortOrder: number;
  activeStartsAt: Date | null;
  activeEndsAt: Date | null;
  resetPolicy: string;
  criteria: Prisma.JsonValue;
  rewards: Prisma.JsonValue;
  eligibility: Prisma.JsonValue;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type GrantRecord = {
  id: string;
  missionId: string;
  dayKey: string;
  rewardType: string;
  amountBaseUnits: bigint | null;
  skinId: string | null;
  status: string;
  idempotencyKey: string;
  playerRewardId: string | null;
  tokenPayoutId: string | null;
  lastError: string | null;
  grantedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  playerReward?: {
    status: string;
    paidAt: Date | null;
  } | null;
  tokenPayout?: {
    status: string;
    lastError: string | null;
    grantedAt: Date | null;
  } | null;
};

type ProgressRecord = {
  missionId: string;
  dayKey: string;
  progress: Prisma.JsonValue;
  completedAt: Date | null;
  grantedAt: Date | null;
  lastContributingMatchId: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  grants?: GrantRecord[];
};

interface MissionEvaluation {
  mission: MissionDefinitionRecord;
  criteria: DailyMissionCriteria;
  rewards: DailyMissionRewardBundle;
  eligibility: DailyMissionEligibility;
}

interface RewardGrantCreationResult {
  solIdempotencyKeys: string[];
  tokenPayoutIds: string[];
}

interface GameTokenRewardSplit {
  recipientAmountBaseUnits: bigint;
  burnAmountBaseUnits: bigint;
}

interface ResolvedGameTokenPayout extends GameTokenRewardSplit {
  totalAmountBaseUnits: bigint;
  tokenDecimals: number;
  tokenProgramId: PublicKey;
  treasuryTokenAccount: PublicKey;
  quotedSwapBuild: JupiterSwapBuildResponse | null;
}

type MissionTx = Prisma.TransactionClient;
type GameTokenPayoutForProcessing = Prisma.GameTokenPayoutGetPayload<{
  include: { missionRewardGrant: true };
}>;

function prismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getUtcDayRange(date: Date): { start: Date; end: Date; key: string } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return {
    start,
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
    key: toUtcDateKey(start),
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2002';
}

function normalizeProgressMap(value: Prisma.JsonValue | null | undefined): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const progress: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      progress[key] = Math.max(0, Math.floor(raw));
    }
  }
  return progress;
}

function missionCriteria(record: MissionDefinitionRecord): DailyMissionCriteria {
  return record.criteria as unknown as DailyMissionCriteria;
}

function missionRewards(record: MissionDefinitionRecord): DailyMissionRewardBundle {
  return record.rewards as unknown as DailyMissionRewardBundle;
}

function normalizeMissionMatchModes(value: unknown): DailyMissionEligibility['matchModes'] {
  if (!Array.isArray(value)) return [...DAILY_MISSION_MATCH_MODES];
  const modes = value.filter((mode): mode is MatchMode => (
    typeof mode === 'string' && (DAILY_MISSION_MATCH_MODES as readonly string[]).includes(mode)
  ));
  return modes.length > 0 ? Array.from(new Set(modes)) : [...DAILY_MISSION_MATCH_MODES];
}

function missionEligibility(record: MissionDefinitionRecord): DailyMissionEligibility {
  const source = record.eligibility && typeof record.eligibility === 'object' && !Array.isArray(record.eligibility)
    ? record.eligibility as unknown as Partial<DailyMissionEligibility>
    : {};
  return {
    ...DEFAULT_DAILY_MISSION_ELIGIBILITY,
    ...source,
    matchModes: normalizeMissionMatchModes(source.matchModes),
    gameplayModes: [...DAILY_MISSION_GAMEPLAY_MODES],
  };
}

function serializeMissionDefinition(record: MissionDefinitionRecord): DailyMissionDefinitionSnapshot {
  return {
    id: record.id,
    displayName: record.displayName,
    description: record.description,
    enabled: record.enabled,
    sortOrder: record.sortOrder,
    activeStartsAt: record.activeStartsAt?.toISOString() ?? null,
    activeEndsAt: record.activeEndsAt?.toISOString() ?? null,
    resetPolicy: record.resetPolicy === 'utc' ? 'utc' : 'utc',
    criteria: missionCriteria(record),
    rewards: missionRewards(record),
    eligibility: missionEligibility(record),
    createdByUserId: record.createdByUserId,
    updatedByUserId: record.updatedByUserId,
    archivedAt: record.archivedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function grantStatusForApi(grant: GrantRecord): DailyMissionGrantStatus {
  if (grant.rewardType === 'sol' && grant.playerReward) {
    if (grant.playerReward.status === 'paid') return 'granted';
    if (grant.playerReward.status === 'processing') return 'processing';
    if (grant.playerReward.status === 'failed') return 'failed';
    if (grant.playerReward.status === 'canceled') return 'canceled';
    return 'pending';
  }
  if (grant.rewardType === 'game_token' && grant.tokenPayout) {
    if (grant.tokenPayout.status === 'granted') return 'granted';
    if (grant.tokenPayout.status === 'processing' || grant.tokenPayout.status === 'submitted') return 'processing';
    if (grant.tokenPayout.status === 'failed') return 'failed';
    if (grant.tokenPayout.status === 'canceled') return 'canceled';
    return 'pending';
  }
  if (grant.status === 'granted' || grant.status === 'processing' || grant.status === 'failed' || grant.status === 'canceled') {
    return grant.status;
  }
  return 'pending';
}

function serializeGrant(grant: GrantRecord): DailyMissionRewardGrantSnapshot {
  const status = grantStatusForApi(grant);
  const lastError = grant.lastError ?? grant.tokenPayout?.lastError ?? null;
  const grantedAt = grant.grantedAt ?? grant.playerReward?.paidAt ?? grant.tokenPayout?.grantedAt ?? null;
  return {
    id: grant.id,
    missionId: grant.missionId,
    dayKey: grant.dayKey,
    rewardType: grant.rewardType as DailyMissionRewardType,
    amountBaseUnits: grant.amountBaseUnits?.toString() ?? null,
    skinId: grant.skinId as HeroSkinId | null,
    status,
    idempotencyKey: grant.idempotencyKey,
    playerRewardId: grant.playerRewardId,
    tokenPayoutId: grant.tokenPayoutId,
    lastError,
    grantedAt: grantedAt?.toISOString() ?? null,
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
  };
}

function serializeProgress(progress: ProgressRecord | null | undefined): DailyMissionProgressSnapshot | null {
  if (!progress) return null;
  return {
    missionId: progress.missionId,
    dayKey: progress.dayKey,
    progress: normalizeProgressMap(progress.progress),
    completedAt: progress.completedAt?.toISOString() ?? null,
    grantedAt: progress.grantedAt?.toISOString() ?? null,
    lastMatchId: progress.lastContributingMatchId,
    grants: (progress.grants ?? []).map(serializeGrant),
  };
}

function activeMissionWhere(now: Date): Prisma.DailyMissionDefinitionWhereInput {
  return {
    enabled: true,
    archivedAt: null,
    AND: [
      { OR: [{ activeStartsAt: null }, { activeStartsAt: { lte: now } }] },
      { OR: [{ activeEndsAt: null }, { activeEndsAt: { gt: now } }] },
    ],
  };
}

function failedGrantWhere(options: { missionIds?: string[] } = {}): Prisma.MissionRewardGrantWhereInput {
  return {
    ...(options.missionIds ? { missionId: { in: options.missionIds } } : {}),
    OR: [
      { status: 'failed' },
      { playerReward: { is: { status: 'failed' } } },
      { tokenPayout: { is: { status: 'failed' } } },
    ],
  };
}

function isMatchEligibleForMission(
  mission: MissionEvaluation,
  input: SettleMatchDailyMissionsInput,
  durationMs: number
): boolean {
  const eligibility = mission.eligibility;
  if (!eligibility.matchModes.includes(input.matchMode)) return false;
  if (!eligibility.gameplayModes.includes(input.gameplayMode)) return false;
  if (eligibility.rankedOnly && (input.matchMode !== 'ranked' || !input.rankedEligible)) return false;
  if (eligibility.cleanIntegrityOnly) {
    if (
      input.integrityGate.status !== 'clean'
      || input.integrityGate.rankedHoldRequired
      || input.integrityGate.reviewRequired
    ) {
      return false;
    }
  }
  return durationMs >= eligibility.minDurationMs;
}

function isPreferredProgressRecord(candidate: ProgressRecord, current: ProgressRecord | undefined): boolean {
  if (!current) return true;
  if (Boolean(candidate.completedAt) !== Boolean(current.completedAt)) return Boolean(candidate.completedAt);
  const candidateTime = candidate.updatedAt?.getTime() ?? candidate.createdAt?.getTime() ?? 0;
  const currentTime = current.updatedAt?.getTime() ?? current.createdAt?.getTime() ?? 0;
  return candidateTime > currentTime;
}

function getCriterionDelta(input: {
  criterion: DailyMissionCriteria['items'][number];
  participant: ReturnType<typeof normalizeMatchParticipants>[number];
  winningTeam: Team | null;
  killEvents: MatchKillEventSnapshot[];
}): number {
  const { criterion, participant, winningTeam, killEvents } = input;
  switch (criterion.type) {
    case 'matches_completed':
      return 1;
    case 'wins':
      return winningTeam !== null && participant.team === winningTeam ? 1 : 0;
    case 'eliminations':
      return participant.kills;
    case 'assists':
      return participant.assists;
    case 'score':
      return calculateParticipantScore(participant);
    case 'experience':
      return calculateParticipantExperience(participant, getMatchOutcome(participant.team, winningTeam));
    case 'play_hero':
      return participant.heroId === criterion.heroId ? 1 : 0;
    case 'eliminations_as_hero':
      return participant.heroId === criterion.heroId ? participant.kills : 0;
    case 'eliminations_against_hero':
      return killEvents.filter((event) => (
        event.killerUserId === participant.userId && event.victimHeroId === criterion.heroId
      )).length;
    case 'eliminations_with_ability':
      return killEvents.filter((event) => (
        event.killerUserId === participant.userId && event.abilityId === criterion.abilityId
      )).length;
    default:
      return 0;
  }
}

function buildMissionDeltas(input: {
  mission: MissionEvaluation;
  participant: ReturnType<typeof normalizeMatchParticipants>[number];
  winningTeam: Team | null;
  killEvents: MatchKillEventSnapshot[];
}): Record<string, number> {
  const deltas: Record<string, number> = {};
  for (const criterion of input.mission.criteria.items) {
    const delta = getCriterionDelta({
      criterion,
      participant: input.participant,
      winningTeam: input.winningTeam,
      killEvents: input.killEvents,
    });
    if (delta > 0) deltas[criterion.id] = delta;
  }
  return deltas;
}

function isProgressComplete(criteria: DailyMissionCriteria, progress: Record<string, number>): boolean {
  return criteria.items.every((criterion) => (progress[criterion.id] ?? 0) >= criterion.target);
}

function missionSnapshotMetadata(mission: MissionDefinitionRecord, dayKey: string, matchId: string) {
  return {
    dayKey,
    missionId: mission.id,
    missionName: mission.displayName,
    missionUpdatedAt: mission.updatedAt.toISOString(),
    matchId,
    criteria: mission.criteria,
    rewards: mission.rewards,
  };
}

function missionRewardIdempotencyKey(input: {
  reward: DailyMissionReward;
  dayKey: string;
  missionId: string;
  userId: string;
}): string {
  if (input.reward.type === 'skin') {
    return `mission:${input.dayKey}:${input.missionId}:${input.userId}:skin:${input.reward.skinId}`;
  }
  return `mission:${input.dayKey}:${input.missionId}:${input.userId}:${input.reward.type}`;
}

function getGameTokenRpcUrl(): string {
  return process.env.SOLANA_RPC_URL?.trim()
    || process.env.RANKED_TOKEN_HOLD_RPC_URL?.trim()
    || '';
}

function gameTokenRewardPlayerShareBps(reward: Extract<DailyMissionReward, { type: 'game_token' }>): number {
  return typeof reward.playerShareBps === 'number' && Number.isInteger(reward.playerShareBps)
    ? reward.playerShareBps
    : MISSION_REWARD_BPS_TOTAL;
}

function gameTokenRewardBurnShareBps(reward: Extract<DailyMissionReward, { type: 'game_token' }>): number {
  return typeof reward.burnShareBps === 'number' && Number.isInteger(reward.burnShareBps)
    ? reward.burnShareBps
    : 0;
}

function splitGameTokenRewardAmount(input: {
  totalAmountBaseUnits: bigint;
  playerShareBps: number;
  burnShareBps: number;
}): GameTokenRewardSplit {
  if (input.totalAmountBaseUnits < 0n) throw new Error('Game token reward amount cannot be negative');
  if (
    input.playerShareBps < 0
    || input.burnShareBps < 0
    || input.playerShareBps + input.burnShareBps !== MISSION_REWARD_BPS_TOTAL
  ) {
    throw new Error('Game token reward player and burn shares must total 10000 bps');
  }
  const recipientAmountBaseUnits = (
    input.totalAmountBaseUnits * BigInt(input.playerShareBps)
  ) / BigInt(MISSION_REWARD_BPS_TOTAL);
  return {
    recipientAmountBaseUnits,
    burnAmountBaseUnits: input.totalAmountBaseUnits - recipientAmountBaseUnits,
  };
}

function fixedGameTokenRewardAmount(reward: Extract<DailyMissionReward, { type: 'game_token' }>): bigint | null {
  if (reward.pricingMode === 'usd' || reward.usdCents !== undefined) return null;
  if (!reward.amountBaseUnits) throw new Error('Game token reward amount is required');
  return BigInt(reward.amountBaseUnits);
}

function readPositiveBigintString(value: string, fieldName: string): bigint {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${fieldName} must be an unsigned integer string`);
  const parsed = BigInt(value);
  if (parsed <= 0n) throw new Error(`${fieldName} must be greater than zero`);
  return parsed;
}

function readPositiveOrZeroBigintString(value: string, fieldName: string): bigint {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${fieldName} must be an unsigned integer string`);
  return BigInt(value);
}

export class DailyMissionService {
  private backgroundStarted = false;
  private backgroundTimers: ReturnType<typeof setInterval>[] = [];
  private tokenConnection: Connection | null = null;

  async listActiveMissionEvaluations(now = new Date()): Promise<MissionEvaluation[]> {
    const records = await prisma.dailyMissionDefinition.findMany({
      where: activeMissionWhere(now),
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: ACTIVE_MISSION_LIMIT,
    });
    return records.map((mission) => ({
      mission,
      criteria: missionCriteria(mission),
      rewards: missionRewards(mission),
      eligibility: missionEligibility(mission),
    }));
  }

  async getPlayerDailyMissions(userId: string, now = new Date()) {
    const day = getUtcDayRange(now);
    const missions = await prisma.dailyMissionDefinition.findMany({
      where: activeMissionWhere(now),
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: ACTIVE_MISSION_LIMIT,
    });
    const missionIds = missions.map((mission) => mission.id);
    const [progressRows, grantRows] = await Promise.all([
      prisma.userDailyMissionProgress.findMany({
        where: {
          userId,
          missionId: { in: missionIds },
        },
      }),
      prisma.missionRewardGrant.findMany({
        where: {
          userId,
          missionId: { in: missionIds },
        },
        orderBy: { createdAt: 'asc' },
        include: {
          playerReward: { select: { status: true, paidAt: true } },
          tokenPayout: { select: { status: true, lastError: true, grantedAt: true } },
        },
      }),
    ]);
    const grantsByMissionId = new Map<string, GrantRecord[]>();
    for (const grant of grantRows) {
      const grants = grantsByMissionId.get(grant.missionId) ?? [];
      grants.push(grant);
      grantsByMissionId.set(grant.missionId, grants);
    }
    const progressByMissionId = new Map<string, ProgressRecord>();
    for (const row of progressRows) {
      const candidate = { ...row, grants: grantsByMissionId.get(row.missionId) ?? [] };
      if (isPreferredProgressRecord(candidate, progressByMissionId.get(row.missionId))) {
        progressByMissionId.set(row.missionId, candidate);
      }
    }

    return {
      dayKey: day.key,
      generatedAt: now.toISOString(),
      missions: missions.map((mission) => {
        const progress = serializeProgress(progressByMissionId.get(mission.id) ?? null);
        return {
          mission: serializeMissionDefinition(mission),
          progress,
          percentComplete: getDailyMissionPercentComplete(missionCriteria(mission), progress?.progress),
        };
      }),
    };
  }

  async getAdminOverview(now = new Date()): Promise<DailyMissionAdminOverview> {
    const day = getUtcDayRange(now);
    const [library, active, audit, summaryCounts] = await Promise.all([
      prisma.dailyMissionDefinition.findMany({
        orderBy: [{ archivedAt: 'asc' }, { sortOrder: 'asc' }, { updatedAt: 'desc' }],
        take: ADMIN_LIBRARY_LIMIT,
      }),
      prisma.dailyMissionDefinition.findMany({
        where: activeMissionWhere(now),
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        take: ACTIVE_MISSION_LIMIT,
      }),
      prisma.missionRewardGrant.findMany({
        where: {
          OR: [
            ...(failedGrantWhere().OR ?? []),
            { rewardType: 'game_token', status: { in: ['pending', 'processing'] } },
            { rewardType: 'sol', playerReward: { is: { status: { in: ['pending', 'processing'] } } } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: ADMIN_AUDIT_LIMIT,
        include: {
          playerReward: { select: { status: true, paidAt: true } },
          tokenPayout: { select: { status: true, lastError: true, grantedAt: true } },
        },
      }),
      Promise.all([
        prisma.dailyMissionDefinition.count({ where: { enabled: true, archivedAt: null } }),
        prisma.dailyMissionDefinition.count({ where: { archivedAt: { not: null } } }),
        prisma.missionRewardGrant.count({ where: failedGrantWhere() }),
        prisma.gameTokenPayout.count({ where: { status: { in: ['pending', 'processing', 'submitted'] } } }),
      ]),
    ]);
    const activeMissionIds = active.map((mission) => mission.id);
    const [progressCounts, grantCounts, failedGrantCounts] = activeMissionIds.length > 0
      ? await Promise.all([
        prisma.userDailyMissionProgress.groupBy({
          by: ['missionId'],
          where: {
            missionId: { in: activeMissionIds },
            completedAt: { not: null },
          },
          _count: { _all: true },
        }),
        prisma.missionRewardGrant.groupBy({
          by: ['missionId'],
          where: { missionId: { in: activeMissionIds } },
          _count: { _all: true },
        }),
        prisma.missionRewardGrant.groupBy({
          by: ['missionId'],
          where: failedGrantWhere({ missionIds: activeMissionIds }),
          _count: { _all: true },
        }),
      ])
      : [[], [], []] as const;

    const completedByMission = new Map(progressCounts.map((row) => [row.missionId, row._count._all]));
    const grantsByMission = new Map<string, { total: number; failed: number }>();
    for (const row of grantCounts) {
      const current = grantsByMission.get(row.missionId) ?? { total: 0, failed: 0 };
      current.total += row._count._all;
      grantsByMission.set(row.missionId, current);
    }
    for (const row of failedGrantCounts) {
      const current = grantsByMission.get(row.missionId) ?? { total: 0, failed: 0 };
      current.failed += row._count._all;
      grantsByMission.set(row.missionId, current);
    }

    const today: DailyMissionAdminMissionRow[] = active.map((mission) => {
      const grants = grantsByMission.get(mission.id) ?? { total: 0, failed: 0 };
      return {
        mission: serializeMissionDefinition(mission),
        completedCount: completedByMission.get(mission.id) ?? 0,
        grantCount: grants.total,
        failedGrantCount: grants.failed,
      };
    });

    return {
      dayKey: day.key,
      summary: {
        activeToday: active.length,
        enabled: summaryCounts[0],
        archived: summaryCounts[1],
        completedToday: progressCounts.reduce((sum, row) => sum + row._count._all, 0),
        failedGrants: summaryCounts[2],
        pendingTokenPayouts: summaryCounts[3],
      },
      today,
      library: library.map(serializeMissionDefinition),
      audit: audit.map(serializeGrant),
    };
  }

  async createMission(input: unknown, adminUserId: string | null): Promise<DailyMissionDefinitionSnapshot> {
    const payload = parseMissionDefinitionPayload(input);
    const created = await prisma.dailyMissionDefinition.create({
      data: definitionCreateData(payload, adminUserId),
    });
    return serializeMissionDefinition(created);
  }

  async updateMission(missionId: string, input: unknown, adminUserId: string | null): Promise<DailyMissionDefinitionSnapshot> {
    const payload = parseMissionDefinitionPayload(input);
    const existing = await prisma.dailyMissionDefinition.findUnique({ where: { id: missionId } });
    if (!existing || existing.archivedAt) throw new MissionValidationError('Mission not found', 404);

    const updated = await prisma.dailyMissionDefinition.update({
      where: { id: missionId },
      data: definitionUpdateData(payload, adminUserId),
    });
    return serializeMissionDefinition(updated);
  }

  async duplicateMission(missionId: string, adminUserId: string | null): Promise<DailyMissionDefinitionSnapshot> {
    const existing = await prisma.dailyMissionDefinition.findUnique({ where: { id: missionId } });
    if (!existing) throw new MissionValidationError('Mission not found', 404);

    const created = await prisma.dailyMissionDefinition.create({
      data: {
        displayName: `${existing.displayName} Copy`.slice(0, 160),
        description: existing.description,
        enabled: false,
        sortOrder: existing.sortOrder + 1,
        activeStartsAt: null,
        activeEndsAt: null,
        resetPolicy: existing.resetPolicy,
        criteria: existing.criteria as Prisma.InputJsonValue,
        rewards: existing.rewards as Prisma.InputJsonValue,
        eligibility: existing.eligibility as Prisma.InputJsonValue,
        createdByUserId: adminUserId,
        updatedByUserId: adminUserId,
      },
    });
    return serializeMissionDefinition(created);
  }

  async archiveMission(missionId: string, adminUserId: string | null): Promise<DailyMissionDefinitionSnapshot> {
    const updated = await prisma.dailyMissionDefinition.update({
      where: { id: missionId },
      data: {
        enabled: false,
        archivedAt: new Date(),
        updatedByUserId: adminUserId,
      },
    });
    return serializeMissionDefinition(updated);
  }

  async reorderMissions(input: unknown, adminUserId: string | null): Promise<DailyMissionAdminOverview> {
    const items = Array.isArray(input) ? input : isRecordWithItems(input) ? input.items : null;
    if (!Array.isArray(items)) throw new MissionValidationError('Reorder items are required');
    const updates = items.slice(0, 100).map((item, index) => {
      if (!isRecordWithItems(item) && (item === null || typeof item !== 'object')) {
        throw new MissionValidationError(`Reorder item ${index + 1} is invalid`);
      }
      const record = item as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : '';
      const sortOrder = typeof record.sortOrder === 'number'
        ? Math.round(record.sortOrder)
        : typeof record.sortOrder === 'string'
          ? Math.round(Number(record.sortOrder))
          : index;
      if (!id || !Number.isFinite(sortOrder)) {
        throw new MissionValidationError(`Reorder item ${index + 1} is invalid`);
      }
      return { id, sortOrder };
    });

    await prisma.$transaction(updates.map((item) => (
      prisma.dailyMissionDefinition.update({
        where: { id: item.id },
        data: { sortOrder: item.sortOrder, updatedByUserId: adminUserId },
      })
    )));
    return this.getAdminOverview();
  }

  async settleMatchMissions(input: SettleMatchDailyMissionsInput): Promise<void> {
    const missions = await this.listActiveMissionEvaluations(input.endedAt);
    if (missions.length === 0) return;

    const durationMs = Math.max(0, input.endedAt.getTime() - input.startedAt.getTime());
    const eligibleMissions = missions.filter((mission) => isMatchEligibleForMission(mission, input, durationMs));
    if (eligibleMissions.length === 0) return;

    const participants = normalizeMatchParticipants(input.participants, input.winningTeam);
    const solIdempotencyKeys: string[] = [];
    const tokenPayoutIds: string[] = [];

    for (const mission of eligibleMissions) {
      for (const participant of participants) {
        if (mission.eligibility.leaverPolicy !== 'allow_partial' && participant.leftAt !== null) continue;
        const deltas = buildMissionDeltas({
          mission,
          participant,
          winningTeam: input.winningTeam,
          killEvents: input.killEvents,
        });
        if (Object.keys(deltas).length === 0) continue;

        const result = await this.applyMissionContribution({
          mission,
          participant,
          deltas,
          dayKey: MISSION_PROGRESS_SCOPE_KEY,
          matchId: input.matchId,
        });
        solIdempotencyKeys.push(...result.solIdempotencyKeys);
        tokenPayoutIds.push(...result.tokenPayoutIds);
      }
    }

    if (solIdempotencyKeys.length > 0) {
      await playerRewardService.payPendingRewards({
        idempotencyKeys: solIdempotencyKeys,
        limit: Math.max(solIdempotencyKeys.length, 1),
      }).catch((error) => {
        loggers.room.warn('Daily mission SOL payout attempt skipped', {
          matchId: input.matchId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    if (tokenPayoutIds.length > 0) {
      await this.payPendingGameTokenPayouts({ payoutIds: tokenPayoutIds }).catch((error) => {
        loggers.room.warn('Daily mission game-token payout attempt skipped', {
          matchId: input.matchId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  private async applyMissionContribution(input: {
    mission: MissionEvaluation;
    participant: ReturnType<typeof normalizeMatchParticipants>[number];
    deltas: Record<string, number>;
    dayKey: string;
    matchId: string;
  }): Promise<RewardGrantCreationResult> {
    try {
      return await prisma.$transaction(async (tx) => {
        const completedProgress = await tx.userDailyMissionProgress.findFirst({
          where: {
            userId: input.participant.userId,
            missionId: input.mission.mission.id,
            completedAt: { not: null },
          },
          orderBy: { completedAt: 'desc' },
        });
        if (completedProgress) {
          return { solIdempotencyKeys: [], tokenPayoutIds: [] };
        }

        const scopedProgress = await tx.userDailyMissionProgress.findUnique({
          where: {
            userId_missionId_dayKey: {
              userId: input.participant.userId,
              missionId: input.mission.mission.id,
              dayKey: input.dayKey,
            },
          },
        });
        const existingProgress = scopedProgress ?? await tx.userDailyMissionProgress.findFirst({
          where: {
            userId: input.participant.userId,
            missionId: input.mission.mission.id,
          },
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        });
        const contributionDayKey = existingProgress?.dayKey ?? input.dayKey;

        await tx.userDailyMissionContribution.create({
          data: {
            userId: input.participant.userId,
            missionId: input.mission.mission.id,
            dayKey: contributionDayKey,
            matchId: input.matchId,
          },
        });

        const current = existingProgress ?? await tx.userDailyMissionProgress.create({
          data: {
            userId: input.participant.userId,
            missionId: input.mission.mission.id,
            dayKey: contributionDayKey,
            progress: prismaJson({}),
          },
        });
        const nextProgress = normalizeProgressMap(current.progress);
        for (const criterion of input.mission.criteria.items) {
          const delta = input.deltas[criterion.id] ?? 0;
          if (delta <= 0) continue;
          nextProgress[criterion.id] = Math.min(
            criterion.target,
            (nextProgress[criterion.id] ?? 0) + delta
          );
        }

        const completed = isProgressComplete(input.mission.criteria, nextProgress);
        const now = new Date();
        await tx.userDailyMissionProgress.update({
          where: { id: current.id },
          data: {
            progress: prismaJson(nextProgress),
            lastContributingMatchId: input.matchId,
            completedAt: completed ? now : current.completedAt,
            grantedAt: completed ? now : current.grantedAt,
          },
        });

        if (!completed) return { solIdempotencyKeys: [], tokenPayoutIds: [] };

        return this.createRewardGrantsTx(tx, {
          mission: input.mission.mission,
          rewards: input.mission.rewards,
          userId: input.participant.userId,
          playerSessionId: input.participant.playerSessionId,
          dayKey: contributionDayKey,
          matchId: input.matchId,
        });
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { solIdempotencyKeys: [], tokenPayoutIds: [] };
      }
      throw error;
    }
  }

  private async createRewardGrantsTx(
    tx: MissionTx,
    input: {
      mission: MissionDefinitionRecord;
      rewards: DailyMissionRewardBundle;
      userId: string;
      playerSessionId: string;
      dayKey: string;
      matchId: string;
    }
  ): Promise<RewardGrantCreationResult> {
    const result: RewardGrantCreationResult = { solIdempotencyKeys: [], tokenPayoutIds: [] };
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { walletAddress: true },
    });
    const metadata = missionSnapshotMetadata(input.mission, input.dayKey, input.matchId);

    for (const reward of input.rewards.items) {
      const idempotencyKey = missionRewardIdempotencyKey({
        reward,
        dayKey: input.dayKey,
        missionId: input.mission.id,
        userId: input.userId,
      });
      const existingGrant = await tx.missionRewardGrant.findUnique({ where: { idempotencyKey } });
      if (existingGrant) continue;

      if (reward.type === 'sol') {
        const grant = await tx.missionRewardGrant.create({
          data: {
            userId: input.userId,
            missionId: input.mission.id,
            dayKey: input.dayKey,
            rewardType: 'sol',
            amountBaseUnits: BigInt(reward.amountLamports),
            idempotencyKey,
            metadata: prismaJson(metadata),
          },
        });
        const playerReward = await this.createMissionSolRewardTx(tx, {
          userId: input.userId,
          matchId: input.matchId,
          playerSessionId: input.playerSessionId,
          amountLamports: BigInt(reward.amountLamports),
          idempotencyKey,
          metadata,
        });
        await tx.missionRewardGrant.update({
          where: { id: grant.id },
          data: { playerRewardId: playerReward.id },
        });
        result.solIdempotencyKeys.push(idempotencyKey);
        continue;
      }

      if (reward.type === 'skin') {
        await this.createMissionSkinGrantTx(tx, {
          reward,
          userId: input.userId,
          missionId: input.mission.id,
          dayKey: input.dayKey,
          idempotencyKey,
          metadata,
        });
        continue;
      }

      const tokenPayoutId = await this.createMissionGameTokenGrantTx(tx, {
        reward,
        userId: input.userId,
        missionId: input.mission.id,
        dayKey: input.dayKey,
        idempotencyKey,
        walletAddress: user?.walletAddress ?? null,
        metadata,
      });
      if (tokenPayoutId) result.tokenPayoutIds.push(tokenPayoutId);
    }

    return result;
  }

  private async createMissionSolRewardTx(
    tx: MissionTx,
    input: {
      userId: string;
      matchId: string;
      playerSessionId: string;
      amountLamports: bigint;
      idempotencyKey: string;
      metadata: Record<string, unknown>;
    }
  ) {
    const existing = await tx.playerReward.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true },
    });
    if (existing) return existing;

    return tx.playerReward.create({
      data: {
        userId: input.userId,
        matchId: input.matchId,
        playerSessionId: input.playerSessionId,
        kind: 'daily_mission',
        amountLamports: input.amountLamports,
        idempotencyKey: input.idempotencyKey,
        reason: 'daily_mission_completion',
        metadata: prismaJson(input.metadata),
      },
      select: { id: true },
    });
  }

  private async createMissionSkinGrantTx(
    tx: MissionTx,
    input: {
      reward: Extract<DailyMissionReward, { type: 'skin' }>;
      userId: string;
      missionId: string;
      dayKey: string;
      idempotencyKey: string;
      metadata: Record<string, unknown>;
    }
  ): Promise<void> {
    getHeroSkinDefinition(input.reward.skinId);
    const grant = await tx.missionRewardGrant.create({
      data: {
        userId: input.userId,
        missionId: input.missionId,
        dayKey: input.dayKey,
        rewardType: 'skin',
        skinId: input.reward.skinId,
        status: 'processing',
        idempotencyKey: input.idempotencyKey,
        metadata: prismaJson(input.metadata),
      },
    });
    await tx.userSkinOwnership.upsert({
      where: { userId_skinId: { userId: input.userId, skinId: input.reward.skinId } },
      create: {
        userId: input.userId,
        skinId: input.reward.skinId,
        source: 'event',
      },
      update: {
        source: 'event',
        revokedAt: null,
      },
    });
    await tx.missionRewardGrant.update({
      where: { id: grant.id },
      data: {
        status: 'granted',
        grantedAt: new Date(),
      },
    });
  }

  private async createMissionGameTokenGrantTx(
    tx: MissionTx,
    input: {
      reward: Extract<DailyMissionReward, { type: 'game_token' }>;
      userId: string;
      missionId: string;
      dayKey: string;
      idempotencyKey: string;
      walletAddress: string | null;
      metadata: Record<string, unknown>;
    }
  ): Promise<string | null> {
    const token = getGameTokenConfig();
    const fixedAmountBaseUnits = fixedGameTokenRewardAmount(input.reward);
    const playerShareBps = gameTokenRewardPlayerShareBps(input.reward);
    const burnShareBps = gameTokenRewardBurnShareBps(input.reward);
    const fixedSplit = fixedAmountBaseUnits === null
      ? null
      : splitGameTokenRewardAmount({
        totalAmountBaseUnits: fixedAmountBaseUnits,
        playerShareBps,
        burnShareBps,
      });
    const rewardUsdCents = fixedAmountBaseUnits === null ? input.reward.usdCents ?? null : null;
    const baseGrantData = {
      userId: input.userId,
      missionId: input.missionId,
      dayKey: input.dayKey,
      rewardType: 'game_token' as const,
      amountBaseUnits: fixedAmountBaseUnits,
      idempotencyKey: input.idempotencyKey,
      metadata: prismaJson(input.metadata),
    };
    if (!token.mintAddress || !token.symbol || !token.rpcConfigured) {
      await tx.missionRewardGrant.create({
        data: {
          ...baseGrantData,
          status: 'failed',
          lastError: 'Game token payout configuration is incomplete',
        },
      });
      return null;
    }
    if (playerShareBps > 0 && !input.walletAddress) {
      await tx.missionRewardGrant.create({
        data: {
          ...baseGrantData,
          status: 'failed',
          lastError: 'Linked wallet required for game token payout',
        },
      });
      return null;
    }

    const payout = await tx.gameTokenPayout.create({
      data: {
        userId: input.userId,
        walletAddress: input.walletAddress,
        tokenMintAddress: token.mintAddress,
        tokenSymbol: token.symbol,
        tokenAmountBaseUnits: fixedAmountBaseUnits ?? 0n,
        recipientAmountBaseUnits: fixedSplit?.recipientAmountBaseUnits ?? null,
        burnAmountBaseUnits: fixedSplit?.burnAmountBaseUnits ?? null,
        playerShareBps,
        burnShareBps,
        rewardUsdCents,
        idempotencyKey: input.idempotencyKey,
      },
    });
    await tx.missionRewardGrant.create({
      data: {
        ...baseGrantData,
        status: 'pending',
        tokenPayoutId: payout.id,
      },
    });
    return payout.id;
  }

  async payPendingGameTokenPayouts(options: {
    payoutIds?: string[];
    limit?: number;
  } = {}): Promise<{ payoutCount: number; totalBaseUnits: string }> {
    const signer = getSettlementKeypair();
    const rpcUrl = getGameTokenRpcUrl();
    if (!signer || !rpcUrl) return { payoutCount: 0, totalBaseUnits: '0' };

    const payouts = await prisma.gameTokenPayout.findMany({
      where: {
        OR: [
          { status: 'pending' },
          { status: 'failed', attemptCount: { lt: TOKEN_PAYOUT_MAX_ATTEMPTS } },
        ],
        ...(options.payoutIds?.length ? { id: { in: options.payoutIds } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: options.limit ?? TOKEN_PAYOUT_BATCH_SIZE,
      include: {
        missionRewardGrant: true,
      },
    });

    let payoutCount = 0;
    let totalBaseUnits = 0n;
    for (const payout of payouts) {
      try {
        const paidAmount = await this.payGameTokenPayout(payout.id);
        if (paidAmount !== null) {
          payoutCount += 1;
          totalBaseUnits += paidAmount;
        }
      } catch (error) {
        loggers.room.error('Daily mission game-token payout failed', {
          payoutId: payout.id,
          userId: payout.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { payoutCount, totalBaseUnits: totalBaseUnits.toString() };
  }

  private async payGameTokenPayout(payoutId: string): Promise<bigint | null> {
    const claim = await prisma.gameTokenPayout.updateMany({
      where: {
        id: payoutId,
        status: { in: ['pending', 'failed'] },
        attemptCount: { lt: TOKEN_PAYOUT_MAX_ATTEMPTS },
      },
      data: {
        status: 'processing',
        attemptCount: { increment: 1 },
        lastError: null,
        failedAt: null,
      },
    });
    if (claim.count !== 1) return null;

    const payout = await prisma.gameTokenPayout.findUnique({
      where: { id: payoutId },
      include: { missionRewardGrant: true },
    });
    if (!payout) return null;

    try {
      const signer = getSettlementKeypair();
      if (!signer) throw new Error('WAGER_SETTLEMENT_SECRET_KEY is required for game token payouts');
      const connection = this.getTokenConnection();
      const runtime = await getWagerGameTokenRuntime(
        connection,
        payout.tokenMintAddress,
        signer.publicKey.toBase58()
      );
      const resolved = await this.resolveGameTokenPayout({
        payout,
        signer,
        runtime,
      });
      await this.ensureGameTokenTreasuryBalance({
        payoutId: payout.id,
        signer,
        runtime,
        requiredAmountBaseUnits: resolved.totalAmountBaseUnits,
        quotedSwapBuild: resolved.quotedSwapBuild,
      });

      const transfer = await this.sendGameTokenRewardTransaction({
        walletAddress: payout.walletAddress,
        tokenMintAddress: payout.tokenMintAddress,
        recipientAmountBaseUnits: resolved.recipientAmountBaseUnits,
        burnAmountBaseUnits: resolved.burnAmountBaseUnits,
        tokenDecimals: resolved.tokenDecimals,
        tokenProgramId: resolved.tokenProgramId,
        treasuryTokenAccount: resolved.treasuryTokenAccount,
        onSubmitted: async (payload) => {
          await prisma.gameTokenPayout.update({
            where: { id: payout.id },
            data: {
              status: 'submitted',
              signature: payload.signature,
              burnSignature: payload.burnSignature,
              tokenDecimals: payload.tokenDecimals,
              tokenProgramId: payload.tokenProgramId,
              treasuryTokenAccount: payload.treasuryTokenAccount,
              recipientTokenAccount: payload.recipientTokenAccount,
              submittedAt: new Date(),
              lastError: null,
            },
          });
          if (payout.missionRewardGrant) {
            await prisma.missionRewardGrant.update({
              where: { id: payout.missionRewardGrant.id },
              data: { status: 'processing', lastError: null },
            });
          }
        },
      });

      await prisma.$transaction([
        prisma.gameTokenPayout.update({
          where: { id: payout.id },
          data: {
            status: 'granted',
            signature: transfer.signature,
            burnSignature: transfer.burnSignature,
            tokenDecimals: transfer.tokenDecimals,
            tokenProgramId: transfer.tokenProgramId,
            treasuryTokenAccount: transfer.treasuryTokenAccount,
            recipientTokenAccount: transfer.recipientTokenAccount,
            grantedAt: transfer.confirmedAt,
            lastError: null,
          },
        }),
        ...(payout.missionRewardGrant ? [
          prisma.missionRewardGrant.update({
            where: { id: payout.missionRewardGrant.id },
            data: {
              status: 'granted',
              grantedAt: transfer.confirmedAt,
              lastError: null,
            },
          }),
        ] : []),
      ]);
      return resolved.totalAmountBaseUnits;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.$transaction([
        prisma.gameTokenPayout.update({
          where: { id: payout.id },
          data: {
            status: 'failed',
            failedAt: new Date(),
            lastError: message,
          },
        }),
        ...(payout.missionRewardGrant ? [
          prisma.missionRewardGrant.update({
            where: { id: payout.missionRewardGrant.id },
            data: {
              status: 'failed',
              lastError: message,
            },
          }),
        ] : []),
      ]);
      throw error;
    }
  }

  private async resolveGameTokenPayout(input: {
    payout: GameTokenPayoutForProcessing;
    signer: Keypair;
    runtime: WagerGameTokenRuntime;
  }): Promise<ResolvedGameTokenPayout> {
    const quotedSwapBuild = input.payout.tokenAmountBaseUnits > 0n
      ? null
      : await this.quoteUsdGameTokenPayout(input);
    const totalAmountBaseUnits = input.payout.tokenAmountBaseUnits > 0n
      ? input.payout.tokenAmountBaseUnits
      : readPositiveBigintString(quotedSwapBuild?.outAmount ?? '', 'Jupiter game-token quote output');
    const split = splitGameTokenRewardAmount({
      totalAmountBaseUnits,
      playerShareBps: input.payout.playerShareBps,
      burnShareBps: input.payout.burnShareBps,
    });
    const recipientAmountBaseUnits = input.payout.recipientAmountBaseUnits ?? split.recipientAmountBaseUnits;
    const burnAmountBaseUnits = input.payout.burnAmountBaseUnits ?? split.burnAmountBaseUnits;

    if (input.payout.tokenAmountBaseUnits <= 0n) {
      await prisma.$transaction([
        prisma.gameTokenPayout.update({
          where: { id: input.payout.id },
          data: {
            tokenAmountBaseUnits: totalAmountBaseUnits,
            recipientAmountBaseUnits,
            burnAmountBaseUnits,
            tokenDecimals: input.runtime.decimals,
            tokenProgramId: input.runtime.tokenProgramId.toBase58(),
            treasuryTokenAccount: input.runtime.treasuryTokenAccount.toBase58(),
          },
        }),
        ...(input.payout.missionRewardGrant ? [
          prisma.missionRewardGrant.update({
            where: { id: input.payout.missionRewardGrant.id },
            data: { amountBaseUnits: totalAmountBaseUnits },
          }),
        ] : []),
      ]);
    }

    if (recipientAmountBaseUnits <= 0n && burnAmountBaseUnits <= 0n) {
      throw new Error('Game token payout resolved to zero tokens');
    }
    if (recipientAmountBaseUnits > 0n && !input.payout.walletAddress) {
      throw new Error('Linked wallet required for game token payout');
    }

    return {
      totalAmountBaseUnits,
      recipientAmountBaseUnits,
      burnAmountBaseUnits,
      tokenDecimals: input.runtime.decimals,
      tokenProgramId: input.runtime.tokenProgramId,
      treasuryTokenAccount: input.runtime.treasuryTokenAccount,
      quotedSwapBuild,
    };
  }

  private async quoteUsdGameTokenPayout(input: {
    payout: GameTokenPayoutForProcessing;
    signer: Keypair;
    runtime: WagerGameTokenRuntime;
  }): Promise<JupiterSwapBuildResponse> {
    if (!input.payout.rewardUsdCents || input.payout.rewardUsdCents <= 0) {
      throw new Error('USD-priced game token payout is missing rewardUsdCents');
    }

    const rewardConfig = getPlayerRewardRuntimeConfig();
    const priceQuote = await solUsdPriceService.getFreshQuote(rewardConfig.payoutPriceQuoteTtlMs);
    if (!priceQuote) throw new Error('SOL/USD price quote unavailable for game token payout');

    const rewardSolLamports = computeUsdCentsToLamports(
      input.payout.rewardUsdCents,
      priceQuote.solUsdPriceMicroUsd
    );
    const config = getWagerRuntimeConfig();
    const build = await fetchJupiterSwapBuild({
      apiBaseUrl: config.jupiterSwapBaseUrl,
      apiKey: config.jupiterApiKey,
      inputMint: WAGER_NATIVE_SOL_MINT,
      outputMint: input.runtime.mint.toBase58(),
      swapMode: 'ExactIn',
      amountLamports: rewardSolLamports,
      taker: input.signer.publicKey.toBase58(),
      payer: input.signer.publicKey.toBase58(),
      destinationTokenAccount: input.runtime.treasuryTokenAccount.toBase58(),
      slippageBps: config.jupiterSwapSlippageBps,
    });

    await prisma.gameTokenPayout.update({
      where: { id: input.payout.id },
      data: {
        rewardSolLamports,
        solUsdPriceMicroUsd: priceQuote.solUsdPriceMicroUsd,
        priceSource: priceQuote.source,
        priceObservedAt: priceQuote.observedAt,
      },
    });
    return build;
  }

  private async ensureGameTokenTreasuryBalance(input: {
    payoutId: string;
    signer: Keypair;
    runtime: WagerGameTokenRuntime;
    requiredAmountBaseUnits: bigint;
    quotedSwapBuild: JupiterSwapBuildResponse | null;
  }): Promise<void> {
    const connection = this.getTokenConnection();
    const balance = await this.getTokenAccountBalance(
      connection,
      input.runtime.treasuryTokenAccount
    );
    if (balance >= input.requiredAmountBaseUnits) return;

    const missingBaseUnits = input.requiredAmountBaseUnits - balance;
    const swapBuild = input.quotedSwapBuild ?? await this.quoteGameTokenTopUp({
      signer: input.signer,
      runtime: input.runtime,
      amountBaseUnits: missingBaseUnits,
    });
    await this.sendGameTokenTopUpSwap({
      payoutId: input.payoutId,
      signer: input.signer,
      runtime: input.runtime,
      build: swapBuild,
    });

    const nextBalance = await this.getTokenAccountBalance(
      connection,
      input.runtime.treasuryTokenAccount
    );
    if (nextBalance < input.requiredAmountBaseUnits) {
      throw new Error('Game token top-up swap did not cover the payout amount');
    }
  }

  private async quoteGameTokenTopUp(input: {
    signer: Keypair;
    runtime: WagerGameTokenRuntime;
    amountBaseUnits: bigint;
  }): Promise<JupiterSwapBuildResponse> {
    const config = getWagerRuntimeConfig();
    return fetchJupiterSwapBuild({
      apiBaseUrl: config.jupiterSwapBaseUrl,
      apiKey: config.jupiterApiKey,
      inputMint: WAGER_NATIVE_SOL_MINT,
      outputMint: input.runtime.mint.toBase58(),
      swapMode: 'ExactOut',
      amountLamports: input.amountBaseUnits,
      taker: input.signer.publicKey.toBase58(),
      payer: input.signer.publicKey.toBase58(),
      destinationTokenAccount: input.runtime.treasuryTokenAccount.toBase58(),
      slippageBps: config.jupiterSwapSlippageBps,
    });
  }

  private async sendGameTokenTopUpSwap(input: {
    payoutId: string;
    signer: Keypair;
    runtime: WagerGameTokenRuntime;
    build: JupiterSwapBuildResponse;
  }): Promise<void> {
    const built = buildJupiterSwapTransaction({
      build: input.build,
      feePayer: input.signer.publicKey,
      outputTokenAccount: input.runtime.treasuryTokenAccount,
      outputMint: input.runtime.mint,
      outputOwner: input.signer.publicKey,
      outputTokenProgramId: input.runtime.tokenProgramId,
    });
    built.transaction.sign([input.signer]);

    const connection = this.getTokenConnection();
    const simulation = await connection.simulateTransaction(built.transaction, {
      commitment: 'confirmed',
      sigVerify: true,
    });
    if (simulation.value.err) {
      throw new Error(`Game token top-up swap simulation failed: ${JSON.stringify(simulation.value.err)}`);
    }

    const signature = await connection.sendRawTransaction(built.transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    await prisma.gameTokenPayout.update({
      where: { id: input.payoutId },
      data: {
        conversionSignature: signature,
        tokenProgramId: input.runtime.tokenProgramId.toBase58(),
        treasuryTokenAccount: input.runtime.treasuryTokenAccount.toBase58(),
        lastError: null,
      },
    });

    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash: built.blockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
    }, 'confirmed');
    if (confirmation.value.err) {
      throw new Error(`Game token top-up swap failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    const convertedTokenBaseUnits = await this.getConfirmedTokenDelta({
      connection,
      signature,
      tokenAccountAddress: input.runtime.treasuryTokenAccount.toBase58(),
      mintAddress: input.runtime.mint.toBase58(),
    });
    await prisma.gameTokenPayout.update({
      where: { id: input.payoutId },
      data: { convertedTokenBaseUnits },
    });
  }

  private async sendGameTokenRewardTransaction(input: {
    walletAddress: string | null;
    tokenMintAddress: string;
    recipientAmountBaseUnits: bigint;
    burnAmountBaseUnits: bigint;
    tokenDecimals: number;
    tokenProgramId: PublicKey;
    treasuryTokenAccount: PublicKey;
    onSubmitted(payload: {
      signature: string;
      burnSignature: string | null;
      tokenDecimals: number;
      tokenProgramId: string;
      treasuryTokenAccount: string;
      recipientTokenAccount: string | null;
    }): Promise<void>;
  }): Promise<{
    signature: string;
    burnSignature: string | null;
    confirmedAt: Date;
    tokenDecimals: number;
    tokenProgramId: string;
    treasuryTokenAccount: string;
    recipientTokenAccount: string | null;
  }> {
    const signer = getSettlementKeypair();
    if (!signer) throw new Error('WAGER_SETTLEMENT_SECRET_KEY is required for game token payouts');
    if (input.recipientAmountBaseUnits <= 0n && input.burnAmountBaseUnits <= 0n) {
      throw new Error('Game token payout resolved to zero tokens');
    }
    if (input.recipientAmountBaseUnits > 0n && !input.walletAddress) {
      throw new Error('Linked wallet required for game token payout');
    }

    const connection = this.getTokenConnection();
    const mint = new PublicKey(input.tokenMintAddress);
    const sourceOwner = signer.publicKey;
    const recipient = input.walletAddress ? new PublicKey(input.walletAddress) : null;
    const recipientTokenAccount = recipient
      ? await getAssociatedTokenAddress(mint, recipient, false, input.tokenProgramId)
      : null;
    const latest = await connection.getLatestBlockhash('confirmed');

    const transaction = new Transaction({
      feePayer: sourceOwner,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    });
    if (input.recipientAmountBaseUnits > 0n && recipient && recipientTokenAccount) {
      transaction.add(
        createAssociatedTokenAccountIdempotentInstruction(
          sourceOwner,
          recipientTokenAccount,
          recipient,
          mint,
          input.tokenProgramId
        ),
        createTransferCheckedInstruction(
          input.treasuryTokenAccount,
          mint,
          recipientTokenAccount,
          sourceOwner,
          input.recipientAmountBaseUnits,
          input.tokenDecimals,
          [],
          input.tokenProgramId
        )
      );
    }
    if (input.burnAmountBaseUnits > 0n) {
      transaction.add(...buildBurnCheckedTransaction({
        feePayer: sourceOwner,
        tokenAccount: input.treasuryTokenAccount,
        mint,
        authority: sourceOwner,
        amountBaseUnits: input.burnAmountBaseUnits,
        decimals: input.tokenDecimals,
        tokenProgramId: input.tokenProgramId,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      }).instructions);
    }

    transaction.sign(signer);
    const simulation = await connection.simulateTransaction(transaction, undefined, true);
    if (simulation.value.err) {
      throw new Error(`Game token payout simulation failed: ${JSON.stringify(simulation.value.err)}`);
    }

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    const burnSignature = input.burnAmountBaseUnits > 0n ? signature : null;
    await input.onSubmitted({
      signature,
      burnSignature,
      tokenDecimals: input.tokenDecimals,
      tokenProgramId: input.tokenProgramId.toBase58(),
      treasuryTokenAccount: input.treasuryTokenAccount.toBase58(),
      recipientTokenAccount: recipientTokenAccount?.toBase58() ?? null,
    });
    const confirmed = await connection.confirmTransaction({
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }, 'confirmed');
    if (confirmed.value.err) {
      throw new Error(`Game token payout failed: ${JSON.stringify(confirmed.value.err)}`);
    }

    return {
      signature,
      burnSignature,
      confirmedAt: new Date(),
      tokenDecimals: input.tokenDecimals,
      tokenProgramId: input.tokenProgramId.toBase58(),
      treasuryTokenAccount: input.treasuryTokenAccount.toBase58(),
      recipientTokenAccount: recipientTokenAccount?.toBase58() ?? null,
    };
  }

  private async getTokenAccountBalance(connection: Connection, tokenAccount: PublicKey): Promise<bigint> {
    try {
      const balance = await connection.getTokenAccountBalance(tokenAccount, 'confirmed');
      return readPositiveOrZeroBigintString(balance.value.amount, 'token account balance');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('could not find account') || message.includes('Invalid param')) return 0n;
      throw error;
    }
  }

  private async getConfirmedTokenDelta(input: {
    connection: Connection;
    signature: string;
    tokenAccountAddress: string;
    mintAddress: string;
  }): Promise<bigint> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const transaction = await input.connection.getParsedTransaction(input.signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      if (transaction) {
        if (transaction.meta?.err) {
          throw new Error(`Game token top-up transaction failed: ${JSON.stringify(transaction.meta.err)}`);
        }
        const delta = extractTokenAccountMintDelta(
          transaction,
          input.tokenAccountAddress,
          input.mintAddress
        );
        if (delta <= 0n) throw new Error('Game token top-up did not increase the treasury token account');
        return delta;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Confirmed game token top-up ${input.signature} was not available for token accounting`);
  }

  private getTokenConnection(): Connection {
    const rpcUrl = getGameTokenRpcUrl();
    if (!rpcUrl) throw new Error('SOLANA_RPC_URL is required for game token payouts');
    if (!this.tokenConnection) this.tokenConnection = new Connection(rpcUrl, 'confirmed');
    return this.tokenConnection;
  }

  startBackgroundJobs(): void {
    if (this.backgroundStarted) return;
    this.backgroundStarted = true;

    const runTokenPayouts = () => {
      this.payPendingGameTokenPayouts().then((result) => {
        if (result.payoutCount > 0) {
          loggers.room.info('Daily mission game-token payouts confirmed', result);
        }
      }).catch((error) => {
        loggers.room.error('Daily mission game-token payout retry failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };

    this.backgroundTimers.push(setInterval(runTokenPayouts, 60 * 1000));
    runTokenPayouts();
  }

  stopBackgroundJobs(): void {
    for (const timer of this.backgroundTimers) clearInterval(timer);
    this.backgroundTimers = [];
    this.backgroundStarted = false;
  }
}

function isRecordWithItems(value: unknown): value is { items: unknown[] } {
  return value !== null && typeof value === 'object' && 'items' in value;
}

function definitionCreateData(
  payload: MissionDefinitionPayload,
  adminUserId: string | null
): Prisma.DailyMissionDefinitionCreateInput {
  return {
    displayName: payload.displayName,
    description: payload.description,
    enabled: payload.enabled,
    sortOrder: payload.sortOrder,
    activeStartsAt: payload.activeStartsAt,
    activeEndsAt: payload.activeEndsAt,
    resetPolicy: payload.resetPolicy,
    criteria: prismaJson(payload.criteria),
    rewards: prismaJson(payload.rewards),
    eligibility: prismaJson(payload.eligibility),
    createdByUserId: adminUserId,
    updatedByUserId: adminUserId,
  };
}

function definitionUpdateData(
  payload: MissionDefinitionPayload,
  adminUserId: string | null
): Prisma.DailyMissionDefinitionUpdateInput {
  return {
    displayName: payload.displayName,
    description: payload.description,
    enabled: payload.enabled,
    sortOrder: payload.sortOrder,
    activeStartsAt: payload.activeStartsAt,
    activeEndsAt: payload.activeEndsAt,
    resetPolicy: payload.resetPolicy,
    criteria: prismaJson(payload.criteria),
    rewards: prismaJson(payload.rewards),
    eligibility: prismaJson(payload.eligibility),
    updatedByUserId: adminUserId,
  };
}

export const dailyMissionService = new DailyMissionService();
