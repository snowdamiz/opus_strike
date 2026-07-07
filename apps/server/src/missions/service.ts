import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
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
import { getSettlementKeypair } from '../wagers/config';
import { getSplTokenMintDecimals } from '../cosmetics/tokenPayments';
import { playerRewardService } from '../rewards/service';
import { loggers } from '../utils/logger';
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

type MissionTx = Prisma.TransactionClient;

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
    const baseGrantData = {
      userId: input.userId,
      missionId: input.missionId,
      dayKey: input.dayKey,
      rewardType: 'game_token' as const,
      amountBaseUnits: BigInt(input.reward.amountBaseUnits),
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
    if (!input.walletAddress) {
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
        tokenAmountBaseUnits: BigInt(input.reward.amountBaseUnits),
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
        const paid = await this.payGameTokenPayout(payout.id);
        if (paid) {
          payoutCount += 1;
          totalBaseUnits += payout.tokenAmountBaseUnits;
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

  private async payGameTokenPayout(payoutId: string): Promise<boolean> {
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
    if (claim.count !== 1) return false;

    const payout = await prisma.gameTokenPayout.findUnique({
      where: { id: payoutId },
      include: { missionRewardGrant: true },
    });
    if (!payout) return false;

    try {
      const transfer = await this.sendGameTokenTransfer({
        walletAddress: payout.walletAddress,
        tokenMintAddress: payout.tokenMintAddress,
        amountBaseUnits: payout.tokenAmountBaseUnits,
        tokenDecimals: payout.tokenDecimals,
        onSubmitted: async (payload) => {
          await prisma.gameTokenPayout.update({
            where: { id: payout.id },
            data: {
              status: 'submitted',
              signature: payload.signature,
              tokenDecimals: payload.tokenDecimals,
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
            tokenDecimals: transfer.tokenDecimals,
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
      return true;
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

  private async sendGameTokenTransfer(input: {
    walletAddress: string | null;
    tokenMintAddress: string;
    amountBaseUnits: bigint;
    tokenDecimals: number | null;
    onSubmitted(payload: {
      signature: string;
      tokenDecimals: number;
      treasuryTokenAccount: string;
      recipientTokenAccount: string;
    }): Promise<void>;
  }): Promise<{
    signature: string;
    confirmedAt: Date;
    tokenDecimals: number;
    treasuryTokenAccount: string;
    recipientTokenAccount: string;
  }> {
    if (!input.walletAddress) throw new Error('Linked wallet required for game token payout');
    const signer = getSettlementKeypair();
    if (!signer) throw new Error('WAGER_SETTLEMENT_SECRET_KEY is required for game token payouts');

    const connection = this.getTokenConnection();
    const mint = new PublicKey(input.tokenMintAddress);
    const recipient = new PublicKey(input.walletAddress);
    const sourceOwner = signer.publicKey;
    const decimals = input.tokenDecimals ?? await getSplTokenMintDecimals(connection, input.tokenMintAddress);
    const treasuryTokenAccount = await getAssociatedTokenAddress(mint, sourceOwner, false, TOKEN_PROGRAM_ID);
    const recipientTokenAccount = await getAssociatedTokenAddress(mint, recipient, false, TOKEN_PROGRAM_ID);
    const latest = await connection.getLatestBlockhash('confirmed');

    const transaction = new Transaction({
      feePayer: sourceOwner,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }).add(
      createAssociatedTokenAccountIdempotentInstruction(
        sourceOwner,
        recipientTokenAccount,
        recipient,
        mint,
        TOKEN_PROGRAM_ID
      ),
      createTransferCheckedInstruction(
        treasuryTokenAccount,
        mint,
        recipientTokenAccount,
        sourceOwner,
        input.amountBaseUnits,
        decimals,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    transaction.sign(signer);
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    await input.onSubmitted({
      signature,
      tokenDecimals: decimals,
      treasuryTokenAccount: treasuryTokenAccount.toBase58(),
      recipientTokenAccount: recipientTokenAccount.toBase58(),
    });
    const confirmed = await connection.confirmTransaction({
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }, 'confirmed');
    if (confirmed.value.err) {
      throw new Error(`Game token transfer failed: ${JSON.stringify(confirmed.value.err)}`);
    }

    return {
      signature,
      confirmedAt: new Date(),
      tokenDecimals: decimals,
      treasuryTokenAccount: treasuryTokenAccount.toBase58(),
      recipientTokenAccount: recipientTokenAccount.toBase58(),
    };
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
