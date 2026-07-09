import type { PrismaClient } from '@prisma/client';
import { GOLDEN_VOXEL_MAP_THEME_ID, type GameplayMode, type MatchMode, type Team } from '@voxel-strike/shared';
import prisma from '../db';
import {
  type AntiCheatActionType,
  type AntiCheatIntegrityGate,
} from '../anticheat';
import {
  persistCompletedMatch,
  type CompletedMatchPersistenceInput,
  type MatchKillEventSnapshot,
  type MatchParticipantSnapshot,
  type PersistCompletedMatchResult,
} from '../persistence/matchPersistence';
import { loggers } from '../utils/logger';
import { dailyMissionService, type SettleMatchDailyMissionsInput } from '../missions/service';
import { playerRewardService, type CreateMatchPlayerRewardsInput } from '../rewards/service';
import type { RankedBrCombatGrant } from '../rewards/rankedBrCombatRewards';
import { wagerService } from '../wagers/service';
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

export interface GoldenBiomeRewardWinnerInput {
  userId: string;
  playerSessionId: string;
}

export type SettleGoldenBiomeRewardFn = (input: {
  matchId: string;
  roomId: string;
  lobbyId: string | null;
  mapSeed: number;
  winningTeam: 'red' | 'blue';
  winners: GoldenBiomeRewardWinnerInput[];
}) => Promise<unknown>;

export type CreateMatchPlayerRewardsFn = (input: CreateMatchPlayerRewardsInput) => Promise<unknown>;
export type SettleMatchDailyMissionsFn = (input: SettleMatchDailyMissionsInput) => Promise<unknown>;

export type SettleWageredLobbyFn = (input: {
  lobbyId: string;
  matchId: string | null;
  winningTeam: 'red' | 'blue' | null;
}) => Promise<unknown>;

export type MarkWageredLobbyReviewRequiredFn = (input: {
  lobbyId: string;
  matchId: string | null;
  reason?: string | null;
}) => Promise<unknown>;

export interface MatchFinalizationRuntimeDeps {
  prisma: PrismaClient;
  persistCompletedMatch: PersistCompletedMatchFn;
  evidenceStore: MatchFinalizationEvidenceStore;
  log: MatchFinalizationLogger;
  serializeError(error: unknown): Record<string, unknown>;
  settleGoldenBiomeReward?: SettleGoldenBiomeRewardFn;
  createMatchPlayerRewards?: CreateMatchPlayerRewardsFn;
  settleMatchDailyMissions?: SettleMatchDailyMissionsFn;
  settleWageredLobby?: SettleWageredLobbyFn;
  markWageredLobbyReviewRequired?: MarkWageredLobbyReviewRequiredFn;
}

export interface PersistMatchLedgerInput {
  ledger: MatchPersistenceLedger | null;
  finalScore: { red: number; blue: number };
  winningTeam: Team | null;
  participants: MatchParticipantSnapshot[];
  gameplayMode: GameplayMode;
  killEvents: MatchKillEventSnapshot[];
  rankedBrCombatGrants?: RankedBrCombatGrant[];
  rankedEligible: boolean;
  integrityGate: AntiCheatIntegrityGate;
  totalParticipants?: number;
  humanParticipants?: number;
  botParticipants?: number;
  activeTeamCount?: number;
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
        mapSize: ledger.mapSize,
        mapProfileId: ledger.mapProfileId,
        mapTopologyId: ledger.mapTopologyId,
        mapGeneratorVersion: ledger.mapGeneratorVersion,
        pregeneratedMapId: ledger.pregeneratedMapId,
        matchMode: ledger.matchMode,
        gameplayMode: input.gameplayMode,
        rankedEligible: input.rankedEligible,
        startedAt: ledger.startedAt,
        endedAt,
        redScore: input.finalScore.red,
        blueScore: input.finalScore.blue,
        winningTeam: input.winningTeam,
        participants: input.participants,
        killEvents: input.killEvents,
        totalParticipants: input.totalParticipants,
        humanParticipants: input.humanParticipants,
        botParticipants: input.botParticipants,
        activeTeamCount: input.activeTeamCount,
        antiCheatIntegrityStatus: input.integrityGate.status,
        antiCheatReviewRequired: input.integrityGate.reviewRequired,
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
      await this.processPostPersistenceEarnings(ledger, input);
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

  private async processPostPersistenceEarnings(
    ledger: MatchPersistenceLedger,
    input: PersistMatchLedgerInput
  ): Promise<void> {
    await this.processPostPersistenceWager(ledger, input);
    await this.processPostPersistenceMissions(ledger, input);

    const rewardEligible = input.rankedEligible
      && input.integrityGate.status === 'clean'
      && !input.integrityGate.rankedHoldRequired
      && !input.integrityGate.reviewRequired;

    if (!rewardEligible) return;

    if (this.deps.createMatchPlayerRewards) {
      await this.deps.createMatchPlayerRewards({
        matchId: ledger.matchId,
        roomId: ledger.roomId,
        lobbyId: ledger.lobbyId,
        matchMode: ledger.matchMode,
        gameplayMode: input.gameplayMode,
        startedAt: ledger.startedAt,
        endedAt: ledger.endedAt ?? new Date(),
        winningTeam: input.winningTeam,
        participants: input.participants,
        rankedEligible: input.rankedEligible,
        integrityGate: input.integrityGate,
        rankedBrCombatGrants: input.rankedBrCombatGrants ?? [],
      }).catch((error) => {
        this.deps.log.warn('Player match rewards were skipped after persistence', {
          roomId: ledger.roomId,
          matchId: ledger.matchId,
          error: this.deps.serializeError(error),
        });
      });
    }

    if (
      this.deps.settleGoldenBiomeReward
      && ledger.matchMode === 'ranked'
      && ledger.mapThemeId === GOLDEN_VOXEL_MAP_THEME_ID
      && input.winningTeam
    ) {
      if (input.winningTeam !== 'red' && input.winningTeam !== 'blue') return;

      const winners = input.participants
        .filter((participant) => (
          participant.team === input.winningTeam
          && participant.leftAt === null
          && participant.rankedRewardEligible !== false
        ))
        .map((participant) => ({
          userId: participant.userId,
          playerSessionId: participant.playerSessionId,
        }));
      if (winners.length === 0) return;

      await this.deps.settleGoldenBiomeReward({
        matchId: ledger.matchId,
        roomId: ledger.roomId,
        lobbyId: ledger.lobbyId,
        mapSeed: ledger.mapSeed,
        winningTeam: input.winningTeam,
        winners,
      }).catch((error) => {
        this.deps.log.warn('Golden biome reward settlement skipped after persistence', {
          roomId: ledger.roomId,
          matchId: ledger.matchId,
          error: this.deps.serializeError(error),
        });
      });
    }
  }

  private async processPostPersistenceMissions(
    ledger: MatchPersistenceLedger,
    input: PersistMatchLedgerInput
  ): Promise<void> {
    if (!this.deps.settleMatchDailyMissions) return;
    await this.deps.settleMatchDailyMissions({
      matchId: ledger.matchId,
      roomId: ledger.roomId,
      lobbyId: ledger.lobbyId,
      matchMode: ledger.matchMode,
      gameplayMode: input.gameplayMode,
      startedAt: ledger.startedAt,
      endedAt: ledger.endedAt ?? new Date(),
      winningTeam: input.winningTeam,
      participants: input.participants,
      killEvents: input.killEvents,
      rankedEligible: input.rankedEligible,
      integrityGate: input.integrityGate,
    }).catch((error) => {
      this.deps.log.warn('Daily mission settlement skipped after persistence', {
        roomId: ledger.roomId,
        matchId: ledger.matchId,
        error: this.deps.serializeError(error),
      });
    });
  }

  private async processPostPersistenceWager(
    ledger: MatchPersistenceLedger,
    input: PersistMatchLedgerInput
  ): Promise<void> {
    if (!ledger.lobbyId) return;

    const needsReview = input.integrityGate.status !== 'clean'
      || input.integrityGate.rankedHoldRequired
      || input.integrityGate.reviewRequired;

    if (needsReview && this.deps.markWageredLobbyReviewRequired) {
      await this.deps.markWageredLobbyReviewRequired({
        lobbyId: ledger.lobbyId,
        matchId: ledger.matchId,
        reason: input.integrityGate.reason,
      }).catch((error) => {
        this.deps.log.warn('Wagered lobby review mark skipped after persistence', {
          roomId: ledger.roomId,
          matchId: ledger.matchId,
          lobbyId: ledger.lobbyId,
          error: this.deps.serializeError(error),
        });
      });
      return;
    }

    if (!this.deps.settleWageredLobby) return;
    const winningTeam = input.winningTeam === 'red' || input.winningTeam === 'blue'
      ? input.winningTeam
      : null;
    await this.deps.settleWageredLobby({
      lobbyId: ledger.lobbyId,
      matchId: ledger.matchId,
      winningTeam,
    }).catch((error) => {
      this.deps.log.warn('Wagered lobby settlement skipped after persistence', {
        roomId: ledger.roomId,
        matchId: ledger.matchId,
        lobbyId: ledger.lobbyId,
        error: this.deps.serializeError(error),
      });
    });
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
    settleGoldenBiomeReward: (rewardInput) => wagerService.settleGoldenBiomeReward(rewardInput),
    createMatchPlayerRewards: (rewardInput) => playerRewardService.createMatchRewards(rewardInput),
    settleMatchDailyMissions: (missionInput) => dailyMissionService.settleMatchMissions(missionInput),
    settleWageredLobby: (settlementInput) => wagerService.settleWageredLobbyForLobby(settlementInput),
    markWageredLobbyReviewRequired: (reviewInput) => wagerService.markLobbyReviewRequired(reviewInput),
  });
}
