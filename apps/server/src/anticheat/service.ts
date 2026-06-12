import type { Prisma, PrismaClient } from '@prisma/client';
import type { MatchMode, Team } from '@voxel-strike/shared';
import { calculateRankedRatingUpdates, type RankedUserState } from '../ranking/ratingService';
import { loggers } from '../utils/logger';
import { getAntiCheatConfig } from './config';
import { getMovementShadowDriftReport, type MovementShadowDriftReport } from './movementShadow';
import type {
  AntiCheatAccountActionType,
  AntiCheatActionType,
  AntiCheatCasePriority,
  AntiCheatCaseStatus,
  AntiCheatIntegrityGate,
  AntiCheatScoreChange,
  AntiCheatSignal,
} from './types';

function prismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function scoreBand(score: number): string {
  if (score >= 90) return 'deterministic_exploit';
  if (score >= 75) return 'severe_repeated_abuse';
  if (score >= 50) return 'match_integrity_risk';
  if (score >= 25) return 'suspicious';
  return 'normal_noise';
}

export interface AntiCheatSignalQueueJob {
  signal: AntiCheatSignal;
  change: AntiCheatScoreChange;
  queuedAt: number;
  resolve: (result: { caseId: string | null }) => void;
}

export interface AntiCheatQueueHealth {
  depth: number;
  highPriorityDepth: number;
  lowPriorityDepth: number;
  activeWrites: number;
  droppedLowMediumSignals: number;
  highCriticalLatencyMaxMs: number;
  lastFlushDurationMs: number;
  dbErrorCount: number;
}

export class AntiCheatSignalPriorityQueue {
  private readonly highPriority: AntiCheatSignalQueueJob[] = [];
  private readonly lowPriority: AntiCheatSignalQueueJob[] = [];
  private highHead = 0;
  private lowHead = 0;

  get length(): number {
    return this.highPriority.length - this.highHead + this.lowPriority.length - this.lowHead;
  }

  get highPriorityLength(): number {
    return this.highPriority.length - this.highHead;
  }

  get lowPriorityLength(): number {
    return this.lowPriority.length - this.lowHead;
  }

  push(job: AntiCheatSignalQueueJob, highPriority: boolean): void {
    if (highPriority) {
      this.highPriority.push(job);
    } else {
      this.lowPriority.push(job);
    }
  }

  shift(): AntiCheatSignalQueueJob | undefined {
    if (this.highHead < this.highPriority.length) {
      const job = this.highPriority[this.highHead++];
      this.compactIfNeeded(this.highPriority, 'high');
      return job;
    }
    if (this.lowHead < this.lowPriority.length) {
      const job = this.lowPriority[this.lowHead++];
      this.compactIfNeeded(this.lowPriority, 'low');
      return job;
    }
    return undefined;
  }

  private compactIfNeeded(queue: AntiCheatSignalQueueJob[], lane: 'high' | 'low'): void {
    const head = lane === 'high' ? this.highHead : this.lowHead;
    if (head < 64 || head * 2 < queue.length) return;

    queue.copyWithin(0, head);
    queue.length -= head;
    if (lane === 'high') {
      this.highHead = 0;
    } else {
      this.lowHead = 0;
    }
  }
}

export class AntiCheatEvidenceStore {
  private lastRetentionPruneAt = 0;
  private readonly signalQueue = new AntiCheatSignalPriorityQueue();
  private readonly flushWaiters: Array<() => void> = [];
  private activeSignalWrites = 0;
  private readonly maxQueuedSignals = 1000;
  private readonly signalWriteConcurrency = 2;
  private droppedLowMediumSignals = 0;
  private highCriticalLatencyMaxMs = 0;
  private lastFlushDurationMs = 0;
  private dbErrorCount = 0;

  constructor(private readonly prisma: PrismaClient) {}

  async recordSignal(signal: AntiCheatSignal, change: AntiCheatScoreChange): Promise<{ caseId: string | null }> {
    if (!getAntiCheatConfig().enabled) return { caseId: null };
    if (
      this.signalQueue.length >= this.maxQueuedSignals &&
      (signal.severity === 'low' || signal.severity === 'medium')
    ) {
      loggers.room.warn('Dropping anti-cheat signal due to persistence backlog', {
        eventType: signal.eventType,
        roomId: signal.roomId,
        queued: this.signalQueue.length,
      });
      this.droppedLowMediumSignals++;
      return { caseId: null };
    }

    return new Promise((resolve) => {
      const job = { signal, change, queuedAt: Date.now(), resolve };
      this.signalQueue.push(job, signal.severity === 'high' || signal.severity === 'critical');
      this.drainSignalQueue();
    });
  }

  async flush(timeoutMs = 5000): Promise<void> {
    if (this.signalQueue.length === 0 && this.activeSignalWrites === 0) return;
    const startedAt = Date.now();

    await new Promise<void>((resolve) => {
      const waiter = () => {
        clearTimeout(timeout);
        this.lastFlushDurationMs = Date.now() - startedAt;
        resolve();
      };
      const timeout = setTimeout(() => {
        const index = this.flushWaiters.indexOf(waiter);
        if (index >= 0) this.flushWaiters.splice(index, 1);
        this.lastFlushDurationMs = Date.now() - startedAt;
        resolve();
      }, timeoutMs);
      this.flushWaiters.push(waiter);
      this.drainSignalQueue();
    });
  }

  private drainSignalQueue(): void {
    while (this.activeSignalWrites < this.signalWriteConcurrency && this.signalQueue.length > 0) {
      const job = this.signalQueue.shift()!;
      if (job.signal.severity === 'high' || job.signal.severity === 'critical') {
        this.highCriticalLatencyMaxMs = Math.max(this.highCriticalLatencyMaxMs, Date.now() - job.queuedAt);
      }
      this.activeSignalWrites++;
      void this.persistSignal(job.signal, job.change)
        .then(job.resolve)
        .finally(() => {
          this.activeSignalWrites--;
          this.resolveFlushWaitersIfIdle();
          this.drainSignalQueue();
        });
    }
  }

  private resolveFlushWaitersIfIdle(): void {
    if (this.signalQueue.length > 0 || this.activeSignalWrites > 0) return;
    while (this.flushWaiters.length > 0) {
      this.flushWaiters.shift()?.();
    }
  }

  getQueueHealth(): AntiCheatQueueHealth {
    return {
      depth: this.signalQueue.length,
      highPriorityDepth: this.signalQueue.highPriorityLength,
      lowPriorityDepth: this.signalQueue.lowPriorityLength,
      activeWrites: this.activeSignalWrites,
      droppedLowMediumSignals: this.droppedLowMediumSignals,
      highCriticalLatencyMaxMs: this.highCriticalLatencyMaxMs,
      lastFlushDurationMs: this.lastFlushDurationMs,
      dbErrorCount: this.dbErrorCount,
    };
  }

  private async persistSignal(signal: AntiCheatSignal, change: AntiCheatScoreChange): Promise<{ caseId: string | null }> {

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.antiCheatSignal.upsert({
          where: { eventId: signal.eventId },
          create: {
            eventId: signal.eventId,
            eventType: signal.eventType,
            category: signal.category,
            source: signal.source,
            roomId: signal.roomId,
            matchId: signal.matchId,
            lobbyId: signal.lobbyId,
            matchMode: signal.matchMode,
            userId: signal.userId,
            playerSessionId: signal.playerSessionId,
            team: signal.team,
            heroId: signal.heroId,
            serverTick: signal.serverTick,
            serverTime: BigInt(signal.serverTime),
            movementEpoch: signal.movementEpoch,
            movementSequence: signal.movementSequence,
            severity: signal.severity,
            confidence: signal.confidence,
            reason: signal.reason,
            details: prismaJson(signal.details),
            detailBytes: signal.detailBytes,
            retentionClass: signal.retentionClass,
            scoreDelta: change.scoreDelta,
            observedAt: signal.observedAt,
          },
          update: {},
        });

        if (signal.userId) {
          const existingProfile = await tx.antiCheatPlayerProfile.findUnique({
            where: { userId: signal.userId },
            select: { maxScore: true, reviewFlags: true },
          });
          const reviewFlag = signal.reason ?? signal.eventType;
          await tx.antiCheatPlayerProfile.upsert({
            where: { userId: signal.userId },
            create: {
              userId: signal.userId,
              currentScore: change.scoreAfter,
              maxScore: change.scoreAfter,
              scoreBand: scoreBand(change.scoreAfter),
              lastSignalAt: signal.observedAt,
              lastScoredAt: signal.observedAt,
              reviewFlags: change.shouldCreateCase ? [signal.reason ?? signal.eventType] : [],
            },
            update: {
              currentScore: change.scoreAfter,
              maxScore: Math.max(existingProfile?.maxScore ?? 0, change.scoreAfter),
              scoreBand: scoreBand(change.scoreAfter),
              lastSignalAt: signal.observedAt,
              lastScoredAt: signal.observedAt,
              reviewFlags: change.shouldCreateCase
                ? Array.from(new Set([...(existingProfile?.reviewFlags ?? []), reviewFlag])).slice(-20)
                : undefined,
            },
          });
        }

        let caseId: string | null = null;
        if (change.shouldCreateCase) {
          const existingCase = await tx.antiCheatCase.findFirst({
            where: {
              status: { in: ['open', 'investigating', 'escalated'] },
              OR: [
                signal.matchId ? { matchId: signal.matchId } : undefined,
                signal.userId ? { userId: signal.userId } : undefined,
              ].filter(Boolean) as Prisma.AntiCheatCaseWhereInput[],
            },
            orderBy: { createdAt: 'desc' },
          });

          const priority = change.casePriority ?? 'medium';
          if (existingCase) {
            const updated = await tx.antiCheatCase.update({
              where: { id: existingCase.id },
              data: {
                priority: priorityRank(priority) > priorityRank(existingCase.priority) ? priority : existingCase.priority,
                signalCount: { increment: 1 },
                scoreAtOpen: Math.max(existingCase.scoreAtOpen, change.scoreAfter),
                updatedAt: signal.observedAt,
              },
            });
            caseId = updated.id;
          } else {
            const created = await tx.antiCheatCase.create({
              data: {
                userId: signal.userId,
                playerSessionId: signal.playerSessionId,
                matchId: signal.matchId,
                roomId: signal.roomId,
                lobbyId: signal.lobbyId,
                matchMode: signal.matchMode,
                status: 'open',
                priority,
                reason: signal.reason ?? signal.eventType,
                scoreAtOpen: change.scoreAfter,
                signalCount: 1,
                evidenceEventIds: [signal.eventId],
              },
            });
            caseId = created.id;
          }
        }

        return { caseId };
      });

      return result;
    } catch (error) {
      this.dbErrorCount++;
      loggers.room.error('Failed to persist anti-cheat signal', {
        eventType: signal.eventType,
        roomId: signal.roomId,
        matchId: signal.matchId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { caseId: null };
    } finally {
      void this.pruneExpiredSignalsIfDue();
    }
  }

  private async pruneExpiredSignalsIfDue(now = Date.now()): Promise<void> {
    if (now - this.lastRetentionPruneAt < 3_600_000) return;
    this.lastRetentionPruneAt = now;
    const config = getAntiCheatConfig();
    const lowCutoff = new Date(now - config.lowSignalRetentionDays * 86_400_000);
    const standardCutoff = new Date(now - config.signalRetentionDays * 86_400_000);

    await this.prisma.antiCheatSignal.deleteMany({
      where: {
        OR: [
          { retentionClass: 'short', observedAt: { lt: lowCutoff } },
          { retentionClass: { in: ['standard', 'extended'] }, severity: { in: ['low', 'medium'] }, observedAt: { lt: standardCutoff } },
        ],
      },
    }).catch((error) => {
      loggers.room.warn('Failed to prune expired anti-cheat signals', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async upsertMatchIntegrity(input: {
    matchId: string;
    roomId: string;
    lobbyId: string | null;
    matchMode: MatchMode;
    gate: AntiCheatIntegrityGate;
    rankedImpact: string;
    wagerImpact: string;
  }): Promise<void> {
    await this.prisma.antiCheatMatchIntegrity.upsert({
      where: { matchId: input.matchId },
      create: {
        matchId: input.matchId,
        roomId: input.roomId,
        lobbyId: input.lobbyId,
        matchMode: input.matchMode,
        status: input.gate.status,
        reason: input.gate.reason,
        score: input.gate.score,
        affectedUserIds: input.gate.affectedUserIds,
        affectedTeams: input.gate.affectedTeams,
        rankedImpact: input.rankedImpact,
        wagerImpact: input.wagerImpact,
        caseId: input.gate.caseId,
      },
      update: {
        status: input.gate.status,
        reason: input.gate.reason,
        score: input.gate.score,
        affectedUserIds: input.gate.affectedUserIds,
        affectedTeams: input.gate.affectedTeams,
        rankedImpact: input.rankedImpact,
        wagerImpact: input.wagerImpact,
        caseId: input.gate.caseId,
      },
    });
  }

  async recordAction(input: {
    type: AntiCheatActionType;
    roomId?: string | null;
    matchId?: string | null;
    caseId?: string | null;
    userId?: string | null;
    actorUserId?: string | null;
    reason: string;
    details?: Record<string, unknown>;
    observedOnly?: boolean;
    evidenceEventIds?: string[];
  }): Promise<void> {
    await this.prisma.antiCheatAction.create({
      data: {
        actionType: input.type,
        roomId: input.roomId ?? null,
        matchId: input.matchId ?? null,
        caseId: input.caseId ?? null,
        userId: input.userId ?? null,
        actorUserId: input.actorUserId ?? null,
        reason: input.reason,
        details: prismaJson(input.details ?? {}),
        observedOnly: input.observedOnly === true,
        evidenceEventIds: input.evidenceEventIds ?? [],
      },
    });
  }

  async createPayoutHold(input: {
    wageredLobbyId: string;
    matchId: string | null;
    winningTeam: Team | null;
    gate: AntiCheatIntegrityGate;
  }): Promise<string | null> {
    const payments = await this.prisma.wagerPayment.findMany({
      where: {
        wageredLobbyId: input.wageredLobbyId,
        status: { in: ['credited', 'settled'] },
      },
      select: { id: true, amountLamports: true, userId: true, teamAtLock: true },
    });
    const amountLamports = payments.reduce((sum, payment) => sum + payment.amountLamports, 0n);

    const hold = await this.prisma.antiCheatPayoutHold.upsert({
      where: { wageredLobbyId: input.wageredLobbyId },
      create: {
        wageredLobbyId: input.wageredLobbyId,
        matchId: input.matchId,
        winningTeam: input.winningTeam,
        paymentIds: payments.map((payment) => payment.id),
        affectedUserIds: payments.map((payment) => payment.userId),
        amountLamports,
        reason: input.gate.reason ?? 'match_integrity_review',
        status: 'open',
        caseId: input.gate.caseId,
      },
      update: {
        matchId: input.matchId,
        winningTeam: input.winningTeam,
        paymentIds: payments.map((payment) => payment.id),
        affectedUserIds: payments.map((payment) => payment.userId),
        amountLamports,
        reason: input.gate.reason ?? 'match_integrity_review',
        caseId: input.gate.caseId,
      },
    });

    await this.prisma.wageredLobby.updateMany({
      where: { id: input.wageredLobbyId },
      data: { status: 'review_required' },
    });

    await this.recordAction({
      type: 'payout_hold',
      matchId: input.matchId,
      caseId: input.gate.caseId,
      reason: input.gate.reason ?? 'match_integrity_review',
      details: {
        wageredLobbyId: input.wageredLobbyId,
        paymentIds: payments.map((payment) => payment.id),
        amountLamports: amountLamports.toString(),
        observedOnly: input.gate.observedOnly,
      },
      observedOnly: input.gate.observedOnly,
    });

    return hold.id;
  }

  async listReviewData(): Promise<{
    cases: unknown[];
    payoutHolds: unknown[];
    accountActions: unknown[];
    recentSignals: unknown[];
    movementShadow: MovementShadowDriftReport;
    config: Record<string, unknown>;
  }> {
    const [cases, payoutHolds, accountActions, recentSignals] = await Promise.all([
      this.prisma.antiCheatCase.findMany({
        orderBy: [{ status: 'asc' }, { priority: 'desc' }, { updatedAt: 'desc' }],
        take: 100,
      }),
      this.prisma.antiCheatPayoutHold.findMany({
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        take: 100,
      }),
      this.prisma.antiCheatAccountAction.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.antiCheatSignal.findMany({
        orderBy: { observedAt: 'desc' },
        take: 100,
      }),
    ]);
    const config = getAntiCheatConfig();
    return {
      cases: serializeBigInts(cases),
      payoutHolds: serializeBigInts(payoutHolds),
      accountActions: serializeBigInts(accountActions),
      recentSignals: serializeBigInts(recentSignals),
      movementShadow: getMovementShadowDriftReport({ limit: 100 }),
      config: {
        enabled: config.enabled,
        mode: config.mode,
        movementAuthorityMode: config.movementAuthorityMode,
        movementParityGateRequired: config.movementParityGateRequired,
        movementParityGate: config.movementParityGate,
        payoutHoldsEnabled: config.payoutHoldsEnabled,
        manualAccountActionsEnabled: config.manualAccountActionsEnabled,
        thresholds: {
          ranked: config.rankedScoreThreshold,
          wager: config.wagerScoreThreshold,
          adminReview: config.adminReviewScoreThreshold,
          payoutHold: config.payoutHoldScoreThreshold,
        },
      },
    };
  }

  async updateCase(input: {
    caseId: string;
    actorUserId: string;
    status?: AntiCheatCaseStatus;
    note?: string;
    resolution?: string;
    falsePositive?: boolean;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.antiCheatCase.update({
        where: { id: input.caseId },
        data: {
          status: input.status,
          resolution: input.resolution,
          falsePositive: input.falsePositive,
          resolvedAt: input.status === 'resolved' || input.status === 'false_positive' ? new Date() : undefined,
          resolvedByUserId: input.status === 'resolved' || input.status === 'false_positive' ? input.actorUserId : undefined,
          notes: input.note ? { push: `${new Date().toISOString()} ${input.actorUserId}: ${input.note}` } : undefined,
        },
      });
      await tx.antiCheatAction.create({
        data: {
          actionType: 'operator_note',
          caseId: input.caseId,
          actorUserId: input.actorUserId,
          reason: input.resolution ?? input.note ?? input.status ?? 'case_update',
          details: prismaJson({ status: input.status, falsePositive: input.falsePositive }),
          observedOnly: false,
          evidenceEventIds: [],
        },
      });
    });
  }

  async createAccountAction(input: {
    actorUserId: string;
    targetUserId: string;
    actionType: AntiCheatAccountActionType;
    reason: string;
    evidenceCaseId?: string | null;
    evidenceEventIds?: string[];
    expiresAt?: Date | null;
    elevated: boolean;
  }): Promise<void> {
    const config = getAntiCheatConfig();
    if (!config.manualAccountActionsEnabled) {
      throw new Error('Manual anti-cheat account actions are disabled');
    }
    if (!input.targetUserId.trim()) throw new Error('Target user id is required');
    if (!input.reason.trim()) throw new Error('Reason is required');
    if (!input.evidenceCaseId && (!input.evidenceEventIds || input.evidenceEventIds.length === 0)) {
      throw new Error('Evidence link is required');
    }
    if (input.actionType === 'suspension' && !input.expiresAt) {
      throw new Error('Suspension expiration is required');
    }
    if (input.actionType === 'ban' && config.banRequiresElevatedRole && !input.elevated) {
      throw new Error('Elevated admin role is required for bans');
    }

    await this.prisma.antiCheatAccountAction.create({
      data: {
        actionType: input.actionType,
        targetUserId: input.targetUserId,
        actorUserId: input.actorUserId,
        reason: input.reason,
        evidenceCaseId: input.evidenceCaseId ?? null,
        evidenceEventIds: input.evidenceEventIds ?? [],
        expiresAt: input.expiresAt ?? null,
        liftedAt: input.actionType === 'lift_suspension' || input.actionType === 'lift_ban' ? new Date() : null,
        immutableAudit: input.actionType === 'ban',
      },
    });
  }
}

function priorityRank(priority: string): number {
  if (priority === 'urgent') return 4;
  if (priority === 'high') return 3;
  if (priority === 'medium') return 2;
  return 1;
}

function serializeBigInts<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, child) => (
    typeof child === 'bigint' ? child.toString() : child
  ))) as T;
}

export async function applyHeldRankedOutcome(prisma: PrismaClient, input: {
  matchId: string;
  actorUserId: string;
  reason: string;
}): Promise<void> {
  const match = await prisma.gameMatch.findUnique({
    where: { id: input.matchId },
    include: { participants: true },
  });
  if (!match) throw new Error('Match not found');
  if (match.rankedOutcomeStatus !== 'held') throw new Error('Ranked outcome is not held');
  if (match.matchMode !== 'ranked') throw new Error('Only ranked matches can apply ranked outcomes');

  const users = await prisma.user.findMany({
    where: { id: { in: match.participants.map((participant) => participant.userId) } },
    select: {
      id: true,
      competitiveRating: true,
      rankedGames: true,
      rankedWins: true,
      rankedLosses: true,
      rankedDraws: true,
      rankedPlacementsRemaining: true,
      rankedPeakRating: true,
    },
  });
  if (users.length !== match.participants.length) throw new Error('Ranked participants are incomplete');

  const updates = calculateRankedRatingUpdates({
    participants: match.participants.map((participant) => ({
      userId: participant.userId,
      team: participant.team as Team,
      outcome: participant.outcome as 'win' | 'loss' | 'draw',
      score: participant.score,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      flagCaptures: participant.flagCaptures,
      flagReturns: participant.flagReturns,
      leftAt: participant.leftAt,
    })),
    users: users as RankedUserState[],
    winningTeam: match.winningTeam as Team | null,
    endedAt: match.endedAt,
  });
  const updatesByUserId = new Map(updates.map((update) => [update.userId, update]));

  await prisma.$transaction(async (tx) => {
    for (const participant of match.participants) {
      const update = updatesByUserId.get(participant.userId);
      if (!update) continue;
      await tx.gameMatchParticipant.update({
        where: { id: participant.id },
        data: {
          rankedEligible: true,
          ratingBefore: update.ratingBefore,
          ratingAfter: update.ratingAfter,
          ratingDelta: update.ratingDelta,
          visibleRankBefore: update.visibleRankBefore,
          visibleRankAfter: update.visibleRankAfter,
          leaverPenaltyApplied: update.leaverPenaltyApplied,
        },
      });
      await tx.user.update({
        where: { id: participant.userId },
        data: {
          competitiveRating: update.ratingAfter,
          rankedGames: { increment: 1 },
          rankedWins: { increment: participant.outcome === 'win' ? 1 : 0 },
          rankedLosses: { increment: participant.outcome === 'loss' ? 1 : 0 },
          rankedDraws: { increment: participant.outcome === 'draw' ? 1 : 0 },
          rankedPlacementsRemaining: update.rankedPlacementsRemainingAfter,
          rankedPeakRating: update.rankedPeakRatingAfter,
          rankedLastMatchAt: match.endedAt,
        },
      });
    }
    await tx.gameMatch.update({
      where: { id: match.id },
      data: {
        rankedEligible: true,
        rankedOutcomeStatus: 'applied',
        antiCheatReviewRequired: false,
      },
    });
    await tx.antiCheatAction.create({
      data: {
        actionType: 'ranked_release',
        matchId: match.id,
        actorUserId: input.actorUserId,
        reason: input.reason,
        details: prismaJson({ participantCount: match.participants.length }),
        observedOnly: false,
        evidenceEventIds: [],
      },
    });
  });
}

export async function cancelHeldRankedOutcome(prisma: PrismaClient, input: {
  matchId: string;
  actorUserId: string;
  reason: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.gameMatch.update({
      where: { id: input.matchId },
      data: {
        rankedEligible: false,
        rankedOutcomeStatus: 'canceled',
        antiCheatReviewRequired: false,
      },
    });
    await tx.antiCheatAction.create({
      data: {
        actionType: 'ranked_cancel',
        matchId: input.matchId,
        actorUserId: input.actorUserId,
        reason: input.reason,
        details: prismaJson({}),
        observedOnly: false,
        evidenceEventIds: [],
      },
    });
  });
}

export async function getActiveAccountRestriction(
  prisma: PrismaClient,
  userId: string,
  now = new Date()
): Promise<{ actionType: 'suspension' | 'ban'; reason: string; expiresAt: Date | null } | null> {
  const actions = await prisma.antiCheatAccountAction.findMany({
    where: { targetUserId: userId },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });

  const latestBan = actions.find((action) => action.actionType === 'ban' || action.actionType === 'lift_ban');
  if (latestBan?.actionType === 'ban') {
    return { actionType: 'ban', reason: latestBan.reason, expiresAt: null };
  }

  const latestSuspension = actions.find((action) => action.actionType === 'suspension' || action.actionType === 'lift_suspension');
  if (latestSuspension?.actionType === 'suspension') {
    if (!latestSuspension.expiresAt || latestSuspension.expiresAt.getTime() > now.getTime()) {
      return {
        actionType: 'suspension',
        reason: latestSuspension.reason,
        expiresAt: latestSuspension.expiresAt,
      };
    }
  }

  return null;
}
