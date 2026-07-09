import type { Prisma, PrismaClient } from '@prisma/client';
import { calculateMatchExperience } from '@voxel-strike/shared';
import type { GameplayMode, HeroId, MapProfileId, MapTopologyId, MatchOutcome, PregeneratedMapId, RankedSeasonMode, Team, VoxelMapSizeId } from '@voxel-strike/shared';
import { DEFAULT_GAMEPLAY_MODE, type MatchMode } from '@voxel-strike/shared';
import {
  calculateRankedRatingUpdates,
  type RankedRatingUpdate,
  type RankedUserState,
} from '../ranking/ratingService';
import { ensureRankedSeasonSettingsTx } from '../ranking/seasonService';
import {
  isRankedBattleRoyalFounderRewardEligible,
  tryGrantRankedFounderSkins,
} from '../cosmetics/rankedFounderRewards';
import { mapSeedToDatabaseValue } from '../utils/mapSeedPersistence';

export interface MatchParticipantStats {
  kills: number;
  deaths: number;
  assists: number;
  flagCaptures: number;
  flagReturns: number;
  humanKills?: number;
  botKills?: number;
  humanAssists?: number;
  botAssists?: number;
}

export interface MatchParticipantSnapshot extends MatchParticipantStats {
  userId: string;
  playerSessionId: string;
  displayName: string;
  team: Team;
  heroId: string | null;
  joinedAt: Date;
  leftAt: Date | null;
  placement?: number | null;
  activeTeamCount?: number | null;
  teamEliminatedAt?: Date | null;
  rankedRewardEligible?: boolean;
}

export interface MatchKillEventSnapshot {
  killerUserId: string | null;
  killerPlayerSessionId: string | null;
  victimUserId: string | null;
  victimPlayerSessionId: string;
  killerHeroId: HeroId | null;
  victimHeroId: HeroId | null;
  abilityId: string | null;
  damageType: string | null;
  victimHadFlag: boolean;
  occurredAt: Date;
}

export interface CompletedMatchPersistenceInput {
  matchId: string;
  roomId: string;
  lobbyId: string | null;
  matchMode: MatchMode;
  gameplayMode?: GameplayMode;
  mapSeed: number;
  mapThemeId?: string | null;
  mapSize?: VoxelMapSizeId | null;
  mapProfileId?: MapProfileId | null;
  mapTopologyId?: MapTopologyId | null;
  mapGeneratorVersion?: number | null;
  pregeneratedMapId?: PregeneratedMapId | null;
  rankedEligible?: boolean;
  startedAt: Date;
  endedAt: Date;
  redScore: number;
  blueScore: number;
  winningTeam: Team | null;
  participants: MatchParticipantSnapshot[];
  killEvents?: MatchKillEventSnapshot[];
  totalParticipants?: number;
  humanParticipants?: number;
  botParticipants?: number;
  activeTeamCount?: number;
  antiCheatIntegrityStatus?: string;
  antiCheatReviewRequired?: boolean;
  antiCheatIntegrityReason?: string | null;
  rankedOutcomeStatus?: 'not_applicable' | 'applied' | 'held' | 'canceled';
}

export interface PersistCompletedMatchResult {
  matchId: string;
  alreadyPersisted: boolean;
  participantCount: number;
  skippedUserIds: string[];
}

export const PLAYER_SCORE_VALUES = {
  kill: 100,
  assist: 50,
  flagCapture: 500,
  flagReturn: 150,
} as const;

interface PersistableParticipant extends MatchParticipantSnapshot {
  outcome: MatchOutcome;
  score: number;
  experienceGained: number;
}

export interface RankedSeasonIdentity {
  mode: RankedSeasonMode;
  seasonNumber: number;
}

export interface RankedSeasonParticipantAggregate {
  outcome: MatchOutcome;
  kills: number;
  deaths: number;
  assists: number;
  flagCaptures: number;
  flagReturns: number;
  score: number;
  experienceGained: number;
}

export interface RankedSeasonUserAggregate {
  name: string;
}

export function calculateParticipantScore(stats: MatchParticipantStats): number {
  return stats.kills * PLAYER_SCORE_VALUES.kill
    + stats.assists * PLAYER_SCORE_VALUES.assist
    + stats.flagCaptures * PLAYER_SCORE_VALUES.flagCapture
    + stats.flagReturns * PLAYER_SCORE_VALUES.flagReturn;
}

export function getMatchOutcome(team: Team, winningTeam: Team | null): MatchOutcome {
  if (!winningTeam) return 'draw';
  return team === winningTeam ? 'win' : 'loss';
}

export function calculateParticipantExperience(
  stats: MatchParticipantStats,
  outcome: MatchOutcome
): number {
  return calculateMatchExperience(stats, outcome);
}

export function normalizeMatchParticipants(
  participants: MatchParticipantSnapshot[],
  winningTeam: Team | null
): PersistableParticipant[] {
  const byUserId = new Map<string, PersistableParticipant>();

  for (const participant of participants) {
    const existing = byUserId.get(participant.userId);
    const score = calculateParticipantScore(participant);
    const outcome = getMatchOutcome(participant.team, winningTeam);
    const experienceGained = calculateParticipantExperience(participant, outcome);

    if (!existing) {
      byUserId.set(participant.userId, {
        ...participant,
        outcome,
        score,
        experienceGained,
      });
      continue;
    }

    existing.playerSessionId = participant.playerSessionId;
    existing.displayName = participant.displayName;
    existing.team = participant.team;
    existing.heroId = participant.heroId;
    existing.kills += participant.kills;
    existing.deaths += participant.deaths;
    existing.assists += participant.assists;
    existing.flagCaptures += participant.flagCaptures;
    existing.flagReturns += participant.flagReturns;
    existing.humanKills = (existing.humanKills ?? 0) + (participant.humanKills ?? 0);
    existing.botKills = (existing.botKills ?? 0) + (participant.botKills ?? 0);
    existing.humanAssists = (existing.humanAssists ?? 0) + (participant.humanAssists ?? 0);
    existing.botAssists = (existing.botAssists ?? 0) + (participant.botAssists ?? 0);
    existing.score += score;
    existing.experienceGained += experienceGained;
    existing.outcome = outcome;
    existing.placement = participant.placement ?? existing.placement;
    existing.activeTeamCount = participant.activeTeamCount ?? existing.activeTeamCount;
    existing.teamEliminatedAt = participant.teamEliminatedAt ?? existing.teamEliminatedAt;
    if (existing.rankedRewardEligible === true || participant.rankedRewardEligible === true) {
      existing.rankedRewardEligible = true;
    } else if (existing.rankedRewardEligible === false || participant.rankedRewardEligible === false) {
      existing.rankedRewardEligible = false;
    }
    if (participant.joinedAt < existing.joinedAt) {
      existing.joinedAt = participant.joinedAt;
    }
    existing.leftAt = participant.leftAt;
  }

  return Array.from(byUserId.values());
}

function getUserAggregateIncrement(participant: PersistableParticipant): Prisma.UserUpdateInput {
  return {
    totalGames: { increment: 1 },
    totalWins: { increment: participant.outcome === 'win' ? 1 : 0 },
    totalLosses: { increment: participant.outcome === 'loss' ? 1 : 0 },
    totalDraws: { increment: participant.outcome === 'draw' ? 1 : 0 },
    totalKills: { increment: participant.kills },
    totalDeaths: { increment: participant.deaths },
    totalAssists: { increment: participant.assists },
    totalCaptures: { increment: participant.flagCaptures },
    totalFlagReturns: { increment: participant.flagReturns },
    totalScore: { increment: participant.score },
    totalExperience: { increment: participant.experienceGained },
  };
}

function getRankedAggregateIncrement(
  participant: PersistableParticipant,
  ratingUpdate: RankedRatingUpdate | undefined,
  endedAt: Date
): Prisma.UserUpdateInput {
  if (!ratingUpdate) return {};

  return {
    competitiveRating: ratingUpdate.ratingAfter,
    rankedGames: { increment: 1 },
    rankedWins: { increment: participant.outcome === 'win' ? 1 : 0 },
    rankedLosses: { increment: participant.outcome === 'loss' ? 1 : 0 },
    rankedDraws: { increment: participant.outcome === 'draw' ? 1 : 0 },
    rankedPlacementsRemaining: ratingUpdate.rankedPlacementsRemainingAfter,
    rankedPeakRating: ratingUpdate.rankedPeakRatingAfter,
    rankedLastMatchAt: endedAt,
  };
}

export function normalizeRankedSeasonMode(mode: RankedSeasonMode | string): RankedSeasonMode {
  return mode === 'preseason' ? 'preseason' : 'season';
}

export function getRankedSeasonAggregateCreateData(
  participant: RankedSeasonParticipantAggregate,
  user: RankedSeasonUserAggregate,
  ratingUpdate: RankedRatingUpdate,
  endedAt: Date
) {
  const rankedWinIncrement = participant.outcome === 'win' ? 1 : 0;
  const rankedLossIncrement = participant.outcome === 'loss' ? 1 : 0;
  const rankedDrawIncrement = participant.outcome === 'draw' ? 1 : 0;

  return {
    userName: user.name,
    totalGames: 1,
    totalWins: rankedWinIncrement,
    totalLosses: rankedLossIncrement,
    totalDraws: rankedDrawIncrement,
    totalKills: participant.kills,
    totalDeaths: participant.deaths,
    totalAssists: participant.assists,
    totalCaptures: participant.flagCaptures,
    totalFlagReturns: participant.flagReturns,
    totalScore: participant.score,
    totalExperience: participant.experienceGained,
    competitiveRating: ratingUpdate.ratingAfter,
    rankedGames: 1,
    rankedWins: rankedWinIncrement,
    rankedLosses: rankedLossIncrement,
    rankedDraws: rankedDrawIncrement,
    rankedPlacementsRemaining: ratingUpdate.rankedPlacementsRemainingAfter,
    rankedPeakRating: ratingUpdate.rankedPeakRatingAfter,
    rankedLastMatchAt: endedAt,
  };
}

export function getRankedSeasonAggregateUpdateData(
  participant: RankedSeasonParticipantAggregate,
  user: RankedSeasonUserAggregate,
  ratingUpdate: RankedRatingUpdate,
  endedAt: Date
): Prisma.RankedSeasonUserStatsUpdateInput {
  const createData = getRankedSeasonAggregateCreateData(participant, user, ratingUpdate, endedAt);

  return {
    userName: createData.userName,
    totalGames: { increment: 1 },
    totalWins: { increment: participant.outcome === 'win' ? 1 : 0 },
    totalLosses: { increment: participant.outcome === 'loss' ? 1 : 0 },
    totalDraws: { increment: participant.outcome === 'draw' ? 1 : 0 },
    totalKills: { increment: participant.kills },
    totalDeaths: { increment: participant.deaths },
    totalAssists: { increment: participant.assists },
    totalCaptures: { increment: participant.flagCaptures },
    totalFlagReturns: { increment: participant.flagReturns },
    totalScore: { increment: participant.score },
    totalExperience: { increment: participant.experienceGained },
    competitiveRating: ratingUpdate.ratingAfter,
    rankedGames: { increment: 1 },
    rankedWins: { increment: participant.outcome === 'win' ? 1 : 0 },
    rankedLosses: { increment: participant.outcome === 'loss' ? 1 : 0 },
    rankedDraws: { increment: participant.outcome === 'draw' ? 1 : 0 },
    rankedPlacementsRemaining: ratingUpdate.rankedPlacementsRemainingAfter,
    rankedPeakRating: ratingUpdate.rankedPeakRatingAfter,
    rankedLastMatchAt: endedAt,
  };
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2002';
}

export async function persistCompletedMatch(
  prisma: PrismaClient,
  input: CompletedMatchPersistenceInput
): Promise<PersistCompletedMatchResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.gameMatch.findUnique({
        where: { id: input.matchId },
        select: { id: true },
      });

      if (existing) {
        return {
          matchId: input.matchId,
          alreadyPersisted: true,
          participantCount: 0,
          skippedUserIds: [],
        };
      }

      const normalizedParticipants = normalizeMatchParticipants(input.participants, input.winningTeam);
      const userIds = Array.from(new Set(normalizedParticipants.map((participant) => participant.userId)));
      const existingUsers = await tx.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          name: true,
          competitiveRating: true,
          rankedGames: true,
          rankedWins: true,
          rankedLosses: true,
          rankedDraws: true,
          rankedPlacementsRemaining: true,
          rankedPeakRating: true,
        },
      });
      const existingUserIds = new Set(existingUsers.map((user) => user.id));
      const participants = normalizedParticipants.filter((participant) => existingUserIds.has(participant.userId));
      const skippedUserIds = userIds.filter((userId) => !existingUserIds.has(userId));
      const rankedOutcomeHeld = input.rankedOutcomeStatus === 'held';
      const rankedEligible = input.rankedEligible === true
        && !rankedOutcomeHeld
        && skippedUserIds.length === 0
        && participants.length > 0;
      const canCalculateRankedUpdates = input.rankedEligible === true
        && skippedUserIds.length === 0
        && participants.length > 0;
      const calculatedRankedUpdates = canCalculateRankedUpdates
        ? calculateRankedRatingUpdates({
          gameplayMode: input.gameplayMode ?? DEFAULT_GAMEPLAY_MODE,
          participants,
          users: existingUsers as RankedUserState[],
          winningTeam: input.winningTeam,
          endedAt: input.endedAt,
          totalParticipants: input.totalParticipants,
          humanParticipants: input.humanParticipants,
          botParticipants: input.botParticipants,
          activeTeamCount: input.activeTeamCount,
        })
        : [];
      const ratingUpdates = rankedEligible ? calculatedRankedUpdates : [];
      const ratingUpdatesByUserId = new Map(ratingUpdates.map((update) => [update.userId, update]));
      const calculatedRankedUpdatesByUserId = new Map(calculatedRankedUpdates.map((update) => [update.userId, update]));
      const usersById = new Map(existingUsers.map((user) => [user.id, user]));
      const shouldRecordRankedSeason = input.matchMode === 'ranked' && (rankedEligible || rankedOutcomeHeld);
      const rankedSeason = shouldRecordRankedSeason ? await ensureRankedSeasonSettingsTx(tx) : null;
      const rankedSeasonIdentity: RankedSeasonIdentity | null = rankedSeason
        ? {
          mode: normalizeRankedSeasonMode(rankedSeason.mode),
          seasonNumber: rankedSeason.seasonNumber,
        }
        : null;

      await tx.gameMatch.create({
        data: {
          id: input.matchId,
          roomId: input.roomId,
          lobbyId: input.lobbyId,
          matchMode: input.matchMode,
          gameplayMode: input.gameplayMode ?? DEFAULT_GAMEPLAY_MODE,
          mapSeed: mapSeedToDatabaseValue(input.mapSeed),
          mapThemeId: input.mapThemeId || 'standard',
          mapSize: input.mapSize ?? null,
          mapProfileId: input.mapProfileId ?? null,
          mapTopologyId: input.mapTopologyId ?? null,
          mapGeneratorVersion: input.mapGeneratorVersion ?? null,
          pregeneratedMapId: input.pregeneratedMapId ?? null,
          rankedEligible,
          startedAt: input.startedAt,
          endedAt: input.endedAt,
          redScore: input.redScore,
          blueScore: input.blueScore,
          winningTeam: input.winningTeam,
          antiCheatIntegrityStatus: input.antiCheatIntegrityStatus ?? 'clean',
          rankedSeasonMode: rankedSeasonIdentity?.mode,
          rankedSeasonNumber: rankedSeasonIdentity?.seasonNumber,
          antiCheatReviewRequired: input.antiCheatReviewRequired === true,
          antiCheatIntegrityReason: input.antiCheatIntegrityReason ?? null,
          rankedOutcomeStatus: input.rankedOutcomeStatus
            ?? (rankedEligible ? 'applied' : input.matchMode === 'ranked' ? 'canceled' : 'not_applicable'),
        },
      });

      if (participants.length > 0) {
        await tx.gameMatchParticipant.createMany({
          data: participants.map((participant) => ({
            matchId: input.matchId,
            userId: participant.userId,
            playerSessionId: participant.playerSessionId,
            displayName: participant.displayName,
            team: participant.team,
            heroId: participant.heroId,
            kills: participant.kills,
            deaths: participant.deaths,
            assists: participant.assists,
            flagCaptures: participant.flagCaptures,
            flagReturns: participant.flagReturns,
            score: participant.score,
            experienceGained: participant.experienceGained,
            outcome: participant.outcome,
            placement: participant.placement ?? undefined,
            rankedEligible: rankedEligible || rankedOutcomeHeld,
            ratingBefore: ratingUpdatesByUserId.get(participant.userId)?.ratingBefore,
            ratingAfter: ratingUpdatesByUserId.get(participant.userId)?.ratingAfter,
            ratingDelta: ratingUpdatesByUserId.get(participant.userId)?.ratingDelta,
            visibleRankBefore: ratingUpdatesByUserId.get(participant.userId)?.visibleRankBefore,
            visibleRankAfter: ratingUpdatesByUserId.get(participant.userId)?.visibleRankAfter,
            rankedPlacementPoints: ratingUpdatesByUserId.get(participant.userId)?.rankedPlacementPoints,
            rankedCombatPoints: ratingUpdatesByUserId.get(participant.userId)?.rankedCombatPoints,
            rankedEntryCost: ratingUpdatesByUserId.get(participant.userId)?.rankedEntryCost,
            rankedQualityMultiplier: ratingUpdatesByUserId.get(participant.userId)?.rankedQualityMultiplier,
            rankedRulesVersion: ratingUpdatesByUserId.get(participant.userId)?.rankedRulesVersion,
            rankedBreakdown: calculatedRankedUpdatesByUserId.get(participant.userId)?.rankedBreakdown as Prisma.InputJsonValue | undefined,
            leaverPenaltyApplied: ratingUpdatesByUserId.get(participant.userId)?.leaverPenaltyApplied ?? false,
            joinedAt: participant.joinedAt,
            leftAt: participant.leftAt,
          })),
        });
      }

      const killEvents = input.killEvents ?? [];
      if (killEvents.length > 0) {
        await tx.gameMatchKillEvent.createMany({
          data: killEvents.map((event) => ({
            matchId: input.matchId,
            killerUserId: event.killerUserId,
            killerPlayerSessionId: event.killerPlayerSessionId,
            victimUserId: event.victimUserId,
            victimPlayerSessionId: event.victimPlayerSessionId,
            killerHeroId: event.killerHeroId,
            victimHeroId: event.victimHeroId,
            abilityId: event.abilityId,
            damageType: event.damageType,
            victimHadFlag: event.victimHadFlag,
            occurredAt: event.occurredAt,
          })),
        });
      }

      for (const participant of participants) {
        const ratingUpdate = ratingUpdatesByUserId.get(participant.userId);
        await tx.user.update({
          where: { id: participant.userId },
          data: {
            ...getUserAggregateIncrement(participant),
            ...getRankedAggregateIncrement(
              participant,
              ratingUpdate,
              input.endedAt
            ),
          },
        });

        const user = usersById.get(participant.userId);

        // Founder reward: grant the golden skin set to the first N humans who
        // finish a ranked Battle Royal match on the winning team. Runs in this
        // same transaction so the limited claim and match persistence are atomic.
        if (isRankedBattleRoyalFounderRewardEligible({
          rankedEligible,
          gameplayMode: input.gameplayMode ?? DEFAULT_GAMEPLAY_MODE,
          winningTeam: input.winningTeam,
          endedAt: input.endedAt,
          participant,
        })) {
          await tryGrantRankedFounderSkins(tx, participant.userId);
        }

        if (rankedSeasonIdentity && rankedEligible && ratingUpdate && user) {
          const createData = getRankedSeasonAggregateCreateData(participant, user, ratingUpdate, input.endedAt);

          await tx.rankedSeasonUserStats.upsert({
            where: {
              mode_seasonNumber_userId: {
                mode: rankedSeasonIdentity.mode,
                seasonNumber: rankedSeasonIdentity.seasonNumber,
                userId: participant.userId,
              },
            },
            create: {
              mode: rankedSeasonIdentity.mode,
              seasonNumber: rankedSeasonIdentity.seasonNumber,
              userId: participant.userId,
              ...createData,
            },
            update: getRankedSeasonAggregateUpdateData(participant, user, ratingUpdate, input.endedAt),
          });
        }
      }

      return {
        matchId: input.matchId,
        alreadyPersisted: false,
        participantCount: participants.length,
        skippedUserIds,
      };
    });
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) {
      throw error;
    }

    return {
      matchId: input.matchId,
      alreadyPersisted: true,
      participantCount: 0,
      skippedUserIds: [],
    };
  }
}
