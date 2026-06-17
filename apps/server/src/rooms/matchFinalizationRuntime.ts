import type { PrismaClient } from '@prisma/client';
import {
  GOLDEN_VOXEL_MAP_THEME_ID,
  type MatchMode,
  type Team,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
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
import {
  wagerService,
  type GoldenBiomeRewardSnapshot,
  type GoldenBiomeRewardWinner,
  type LockedWagerContext,
  type WagerSettlementSnapshot,
} from '../wagers/service';
import { loggers } from '../utils/logger';
import type { MatchPersistenceLedger } from './matchLedgerRuntime';

type RankedOutcomeStatus = NonNullable<CompletedMatchPersistenceInput['rankedOutcomeStatus']>;
type MatchFinalizationImpact = 'held' | 'reported' | 'none';

export interface MatchFinalizationOutcomes {
  rankedOutcomeStatus: RankedOutcomeStatus;
  rankedImpact: MatchFinalizationImpact;
  wagerImpact: MatchFinalizationImpact;
}

export interface MatchFinalizationEvidenceStore {
  upsertMatchIntegrity(input: {
    matchId: string;
    roomId: string;
    lobbyId: string | null;
    matchMode: MatchMode;
    gate: AntiCheatIntegrityGate;
    rankedImpact: string;
    wagerImpact: string;
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
  createPayoutHold(input: {
    wageredLobbyId: string;
    matchId: string | null;
    winningTeam: Team | null;
    gate: AntiCheatIntegrityGate;
  }): Promise<string | null>;
}

export interface MatchFinalizationWagerService {
  attachMatchId(wageredLobbyId: string, matchId: string): Promise<void>;
  settleWageredLobby(input: {
    wageredLobbyId: string;
    matchId: string | null;
    winningTeam: Team | null;
  }): Promise<WagerSettlementSnapshot | null>;
  settleGoldenBiomeReward(input: {
    matchId: string;
    roomId: string;
    lobbyId: string | null;
    mapSeed: number;
    winningTeam: Team;
    winners: GoldenBiomeRewardWinner[];
  }): Promise<GoldenBiomeRewardSnapshot | null>;
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
  wagerService: MatchFinalizationWagerService;
  log: MatchFinalizationLogger;
  serializeError(error: unknown): Record<string, unknown>;
}

export interface MatchFinalizationRoomContext {
  roomId: string;
  lobbyId: string | null;
}

export interface AttachWagerMatchIdInput extends MatchFinalizationRoomContext {
  wagerContext: LockedWagerContext | null;
  matchId: string;
}

export interface PersistMatchLedgerInput {
  ledger: MatchPersistenceLedger | null;
  finalScore: { red: number; blue: number };
  winningTeam: Team | null;
  participants: MatchParticipantSnapshot[];
  rankedEligible: boolean;
  integrityGate: AntiCheatIntegrityGate;
  wagered: boolean;
  endedAt?: Date;
}

export interface SettleWagerAfterGameInput extends MatchFinalizationRoomContext {
  wagerContext: LockedWagerContext | null;
  matchId: string | null;
  winningTeam: Team | null;
  integrityGate: AntiCheatIntegrityGate;
}

export interface SettleWagerNoContestInput extends MatchFinalizationRoomContext {
  wagerContext: LockedWagerContext | null;
  settlementAlreadyRequested: boolean;
  matchId: string | null;
  reason: string;
}

export interface SettleGoldenBiomeRewardInput extends MatchFinalizationRoomContext {
  ledger: MatchPersistenceLedger | null;
  mapThemeId: VoxelMapTheme['id'] | string | null;
  mapSeed: number;
  matchMode: MatchMode;
  winningTeam: Team | null;
  forcedByPlayerId?: string;
  participants: MatchParticipantSnapshot[];
  rankedEligible: boolean;
  integrityGate: AntiCheatIntegrityGate;
}

export function buildMatchFinalizationOutcomes(input: {
  matchMode: MatchMode;
  rankedEligible: boolean;
  wagered: boolean;
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
  const wagerImpact = input.wagered
    ? input.integrityGate.payoutHoldRequired
      ? 'held'
      : input.integrityGate.reviewRequired
        ? 'reported'
        : 'none'
    : 'none';

  return {
    rankedOutcomeStatus,
    rankedImpact,
    wagerImpact,
  };
}

export class MatchFinalizationRuntime {
  constructor(private readonly deps: MatchFinalizationRuntimeDeps) {}

  attachWagerMatchId(input: AttachWagerMatchIdInput): boolean {
    const wageredLobbyId = input.wagerContext?.wageredLobbyId;
    if (!wageredLobbyId) return false;

    void this.deps.wagerService.attachMatchId(wageredLobbyId, input.matchId).catch((error) => {
      this.deps.log.error('Failed to attach wager to match ledger', {
        wageredLobbyId,
        matchId: input.matchId,
        error: this.deps.serializeError(error),
      });
    });
    return true;
  }

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
      wagered: input.wagered,
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
        antiCheatReviewRequired: input.integrityGate.rankedHoldRequired || input.integrityGate.payoutHoldRequired,
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

  settleWagerAfterGame(input: SettleWagerAfterGameInput): boolean {
    const wageredLobbyId = input.wagerContext?.wageredLobbyId;
    if (!wageredLobbyId) return false;

    if (input.integrityGate.payoutHoldRequired) {
      void this.deps.evidenceStore.createPayoutHold({
        wageredLobbyId,
        matchId: input.matchId,
        winningTeam: input.winningTeam,
        gate: input.integrityGate,
      })
        .then((holdId) => {
          this.deps.log.info('Wager settlement paused for anti-cheat review', {
            roomId: input.roomId,
            lobbyId: input.lobbyId,
            matchId: input.matchId,
            wageredLobbyId,
            holdId,
            reason: input.integrityGate.reason,
          });
        })
        .catch((error) => {
          this.deps.log.error('Failed to create anti-cheat payout hold', {
            roomId: input.roomId,
            lobbyId: input.lobbyId,
            matchId: input.matchId,
            wageredLobbyId,
            error: this.deps.serializeError(error),
          });
        });
      return true;
    }

    if (input.integrityGate.reviewRequired && input.integrityGate.observedOnly) {
      void this.deps.evidenceStore.recordAction({
        type: 'payout_hold',
        roomId: input.roomId,
        matchId: input.matchId,
        caseId: input.integrityGate.caseId,
        reason: input.integrityGate.reason ?? 'match_integrity_review',
        observedOnly: true,
        details: {
          wageredLobbyId,
          winningTeam: input.winningTeam,
          score: input.integrityGate.score,
          status: input.integrityGate.status,
        },
      }).catch((error) => {
        this.deps.log.error('Failed to record observed anti-cheat payout hold', {
          roomId: input.roomId,
          lobbyId: input.lobbyId,
          matchId: input.matchId,
          error: this.deps.serializeError(error),
        });
      });
    }

    void this.deps.wagerService.settleWageredLobby({
      wageredLobbyId,
      matchId: input.matchId,
      winningTeam: input.winningTeam,
    })
      .then((settlement) => {
        this.deps.log.info('Wager settlement requested', {
          roomId: input.roomId,
          lobbyId: input.lobbyId,
          matchId: input.matchId,
          wageredLobbyId,
          settlement,
        });
      })
      .catch((error) => {
        this.deps.log.error('Wager settlement failed', {
          roomId: input.roomId,
          lobbyId: input.lobbyId,
          matchId: input.matchId,
          wageredLobbyId,
          error: this.deps.serializeError(error),
        });
      });
    return true;
  }

  settleWagerNoContest(input: SettleWagerNoContestInput): boolean {
    const wageredLobbyId = input.wagerContext?.wageredLobbyId;
    if (!wageredLobbyId || input.settlementAlreadyRequested) return false;

    void this.deps.wagerService.settleWageredLobby({
      wageredLobbyId,
      matchId: input.matchId,
      winningTeam: null,
    })
      .then((settlement) => {
        this.deps.log.info('Wager no-contest refund requested', {
          roomId: input.roomId,
          lobbyId: input.lobbyId,
          matchId: input.matchId,
          reason: input.reason,
          wageredLobbyId,
          settlement,
        });
      })
      .catch((error) => {
        this.deps.log.error('Failed to request wager no-contest refund', {
          roomId: input.roomId,
          lobbyId: input.lobbyId,
          matchId: input.matchId,
          reason: input.reason,
          wageredLobbyId,
          error: this.deps.serializeError(error),
        });
      });
    return true;
  }

  settleGoldenBiomeReward(input: SettleGoldenBiomeRewardInput): boolean {
    const ledger = input.ledger;
    if (input.mapThemeId !== GOLDEN_VOXEL_MAP_THEME_ID || !ledger || ledger.state !== 'active') return false;
    if (input.matchMode !== 'ranked' || !input.winningTeam || input.forcedByPlayerId) return false;
    if (!input.rankedEligible) return false;

    if (input.integrityGate.payoutHoldRequired || input.integrityGate.rankedHoldRequired) {
      this.deps.log.warn('Golden biome reward held for match integrity review', {
        roomId: input.roomId,
        lobbyId: input.lobbyId,
        matchId: ledger.matchId,
        reason: input.integrityGate.reason,
        status: input.integrityGate.status,
      });
      return false;
    }

    const winners: GoldenBiomeRewardWinner[] = input.participants
      .filter((participant) => participant.team === input.winningTeam && participant.userId)
      .map((participant) => ({
        userId: participant.userId,
        playerSessionId: participant.playerSessionId,
      }));

    if (winners.length === 0) return false;

    void this.deps.wagerService.settleGoldenBiomeReward({
      matchId: ledger.matchId,
      roomId: input.roomId,
      lobbyId: input.lobbyId,
      mapSeed: input.mapSeed,
      winningTeam: input.winningTeam,
      winners,
    })
      .then((reward) => {
        this.deps.log.info('Golden biome reward settlement requested', {
          roomId: input.roomId,
          lobbyId: input.lobbyId,
          matchId: ledger.matchId,
          reward,
        });
      })
      .catch((error) => {
        this.deps.log.error('Golden biome reward settlement failed', {
          roomId: input.roomId,
          lobbyId: input.lobbyId,
          matchId: ledger.matchId,
          error: this.deps.serializeError(error),
        });
      });
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
      wagerImpact: outcomes.wagerImpact,
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
    wagerService,
    log: loggers.room,
    serializeError: input.serializeError,
  });
}
