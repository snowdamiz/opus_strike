import type { PrismaClient } from '@prisma/client';
import type { MatchMode, Team } from '@voxel-strike/shared';
import prisma from '../db';
import {
  type AntiCheatActionType,
  type AntiCheatIntegrityGate,
} from '../anticheat';
import {
  persistCompletedMatch,
  type CompletedMatchPersistenceInput,
  type MatchParticipantSnapshot,
  type PersistCompletedMatchResult,
} from '../persistence/matchPersistence';
import { loggers } from '../utils/logger';
import type { MatchPersistenceLedger } from './matchLedgerRuntime';

type RankedOutcomeStatus = NonNullable<CompletedMatchPersistenceInput['rankedOutcomeStatus']>;
type MatchFinalizationImpact = 'held' | 'reported' | 'none';

export interface MatchFinalizationOutcomes {
  rankedOutcomeStatus: RankedOutcomeStatus;
  rankedImpact: MatchFinalizationImpact;
}

export interface MatchFinalizationEvidenceStore {
  upsertMatchIntegrity(input: {
    matchId: string;
    roomId: string;
    lobbyId: string | null;
    matchMode: MatchMode;
    gate: AntiCheatIntegrityGate;
    rankedImpact: string;
  }): Promise<void>;
  recordAction(input: {
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
  }): Promise<void>;
}

export interface MatchFinalizationLogger {
  info(message: string, detail?: Record<string, unknown>): void;
  warn(message: string, detail?: Record<string, unknown>): void;
  error(message: string, detail?: Record<string, unknown>): void;
}

export type PersistCompletedMatchFn = (
  prismaClient: PrismaClient,
  input: CompletedMatchPersistenceInput
) => Promise<PersistCompletedMatchResult>;

export interface MatchFinalizationRuntimeDeps {
  prisma: PrismaClient;
  persistCompletedMatch: PersistCompletedMatchFn;
  evidenceStore: MatchFinalizationEvidenceStore;
  log: MatchFinalizationLogger;
  serializeError(error: unknown): Record<string, unknown>;
}

export interface PersistMatchLedgerInput {
  ledger: MatchPersistenceLedger | null;
  finalScore: { red: number; blue: number };
  winningTeam: Team | null;
  participants: MatchParticipantSnapshot[];
  rankedEligible: boolean;
  integrityGate: AntiCheatIntegrityGate;
  endedAt?: Date;
}

export function buildMatchFinalizationOutcomes(input: {
  matchMode: MatchMode;
  rankedEligible: boolean;
  integrityGate: AntiCheatIntegrityGate;
}): MatchFinalizationOutcomes {
  const rankedOutcomeStatus = input.rankedEligible
    ? input.integrityGate.rankedHoldRequired ? 'held' : 'applied'
    : input.matchMode === 'ranked' ? 'canceled' : 'not_applicable';
  const rankedImpact = input.rankedEligible
    ? input.integrityGate.rankedHoldRequired
      ? 'held'
      : input.integrityGate.reviewRequired
        ? 'reported'
        : 'none'
    : 'none';

  return {
    rankedOutcomeStatus,
    rankedImpact,
  };
}

export class MatchFinalizationRuntime {
  constructor(private readonly deps: MatchFinalizationRuntimeDeps) {}

  async persistLedger(input: PersistMatchLedgerInput): Promise<boolean> {
    const ledger = input.ledger;
    if (!ledger || ledger.state !== 'active') return false;

    const endedAt = input.endedAt ?? new Date();
    ledger.endedAt = endedAt;
    ledger.redScore = input.finalScore.red;
    ledger.blueScore = input.finalScore.blue;
    ledger.winningTeam = input.winningTeam;
    ledger.state = 'persisting';

    const outcomes = buildMatchFinalizationOutcomes({
      matchMode: ledger.matchMode,
      rankedEligible: input.rankedEligible,
      integrityGate: input.integrityGate,
    });

    this.recordMatchIntegrity(ledger, input.integrityGate, outcomes);
    this.recordRankedHoldIfNeeded(ledger, input.integrityGate, outcomes.rankedOutcomeStatus, input.rankedEligible);

    try {
      const result = await this.deps.persistCompletedMatch(this.deps.prisma, {
        matchId: ledger.matchId,
        roomId: ledger.roomId,
        lobbyId: ledger.lobbyId,
        mapSeed: ledger.mapSeed,
        mapThemeId: ledger.mapThemeId,
        matchMode: ledger.matchMode,
        rankedEligible: input.rankedEligible,
        startedAt: ledger.startedAt,
        endedAt,
        redScore: input.finalScore.red,
        blueScore: input.finalScore.blue,
        winningTeam: input.winningTeam,
        participants: input.participants,
        antiCheatIntegrityStatus: input.integrityGate.status,
        antiCheatReviewRequired: input.integrityGate.rankedHoldRequired,
        antiCheatIntegrityReason: input.integrityGate.reason,
        rankedOutcomeStatus: outcomes.rankedOutcomeStatus,
      });
      ledger.state = 'persisted';
      this.deps.log.info('Match persistence completed', {
        roomId: ledger.roomId,
        matchId: ledger.matchId,
        lobbyId: ledger.lobbyId,
        mapSeed: ledger.mapSeed,
        redScore: input.finalScore.red,
        blueScore: input.finalScore.blue,
        winningTeam: input.winningTeam,
        participantCount: result.participantCount,
        alreadyPersisted: result.alreadyPersisted,
        skippedUserIds: result.skippedUserIds,
        rankedEligible: input.rankedEligible,
      });
    } catch (error) {
      ledger.state = 'failed';
      this.deps.log.error('Match persistence failed', {
        roomId: ledger.roomId,
        matchId: ledger.matchId,
        lobbyId: ledger.lobbyId,
        mapSeed: ledger.mapSeed,
        redScore: input.finalScore.red,
        blueScore: input.finalScore.blue,
        winningTeam: input.winningTeam,
        participantCount: input.participants.length,
        error: this.deps.serializeError(error),
      });
    }

    return true;
  }

  private recordMatchIntegrity(
    ledger: MatchPersistenceLedger,
    gate: AntiCheatIntegrityGate,
    outcomes: MatchFinalizationOutcomes
  ): void {
    void this.deps.evidenceStore.upsertMatchIntegrity({
      matchId: ledger.matchId,
      roomId: ledger.roomId,
      lobbyId: ledger.lobbyId,
      matchMode: ledger.matchMode,
      gate,
      rankedImpact: outcomes.rankedImpact,
    }).catch((error) => {
      this.deps.log.error('Failed to persist anti-cheat match integrity', {
        roomId: ledger.roomId,
        matchId: ledger.matchId,
        error: this.deps.serializeError(error),
      });
    });
  }

  private recordRankedHoldIfNeeded(
    ledger: MatchPersistenceLedger,
    gate: AntiCheatIntegrityGate,
    rankedOutcomeStatus: RankedOutcomeStatus,
    rankedEligible: boolean
  ): void {
    if (!rankedEligible || (!gate.rankedHoldRequired && !(gate.reviewRequired && gate.observedOnly))) return;

    void this.deps.evidenceStore.recordAction({
      type: 'ranked_hold',
      roomId: ledger.roomId,
      matchId: ledger.matchId,
      caseId: gate.caseId,
      reason: gate.reason ?? 'match_integrity_review',
      observedOnly: !gate.rankedHoldRequired,
      details: {
        status: gate.status,
        score: gate.score,
        affectedUserIds: gate.affectedUserIds,
        rankedOutcomeStatus,
      },
    }).catch((error) => {
      this.deps.log.error('Failed to persist anti-cheat ranked action', {
        roomId: ledger.roomId,
        matchId: ledger.matchId,
        error: this.deps.serializeError(error),
      });
    });
  }
}

export function createRoomMatchFinalizationRuntime(input: {
  evidenceStore: MatchFinalizationEvidenceStore;
  serializeError(error: unknown): Record<string, unknown>;
}): MatchFinalizationRuntime {
  return new MatchFinalizationRuntime({
    prisma,
    persistCompletedMatch,
    evidenceStore: input.evidenceStore,
    log: loggers.room,
    serializeError: input.serializeError,
  });
}
