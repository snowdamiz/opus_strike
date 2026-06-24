import type { Prisma, PrismaClient } from '@prisma/client';
import { calculateMatchExperience } from '@voxel-strike/shared';
import type { MatchOutcome, Team } from '@voxel-strike/shared';
import type { MatchMode } from '@voxel-strike/shared';
import {
  calculateRankedRatingUpdates,
  type RankedRatingUpdate,
  type RankedUserState,
} from '../ranking/ratingService';
import { ensureRankedSeasonSettingsTx } from '../ranking/seasonService';
import { mapSeedToDatabaseValue } from '../utils/mapSeedPersistence';

export interface MatchParticipantStats {
  kills: number;
  deaths: number;
  assists: number;
  flagCaptures: number;
  flagReturns: number;
}

export interface MatchParticipantSnapshot extends MatchParticipantStats {
  userId: string;
  playerSessionId: string;
  displayName: string;
  team: Team;
  heroId: string | null;
  joinedAt: Date;
  leftAt: Date | null;
}

export interface CompletedMatchPersistenceInput {
  matchId: string;
  roomId: string;
  lobbyId: string | null;
  matchMode: MatchMode;
  mapSeed: number;
  mapThemeId?: string | null;
  rankedEligible?: boolean;
  startedAt: Date;
  endedAt: Date;
  redScore: number;
  blueScore: number;
  winningTeam: Team | null;
  participants: MatchParticipantSnapshot[];
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
    existing.score += score;
    existing.experienceGained += experienceGained;
    existing.outcome = outcome;
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

function getSeasonAggregateCreateData(
  participant: PersistableParticipant,
  user: { name: string },
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

function getSeasonAggregateUpdateData(
  participant: PersistableParticipant,
  user: { name: string },
  ratingUpdate: RankedRatingUpdate,
  endedAt: Date
): Prisma.RankedSeasonUserStatsUpdateInput {
  const createData = getSeasonAggregateCreateData(participant, user, ratingUpdate, endedAt);

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
      const ratingUpdates = rankedEligible
        ? calculateRankedRatingUpdates({
          participants,
          users: existingUsers as RankedUserState[],
          winningTeam: input.winningTeam,
          endedAt: input.endedAt,
        })
        : [];
      const ratingUpdatesByUserId = new Map(ratingUpdates.map((update) => [update.userId, update]));
      const usersById = new Map(existingUsers.map((user) => [user.id, user]));
      const rankedSeason = rankedEligible ? await ensureRankedSeasonSettingsTx(tx) : null;

      await tx.gameMatch.create({
        data: {
          id: input.matchId,
          roomId: input.roomId,
          lobbyId: input.lobbyId,
          matchMode: input.matchMode,
          mapSeed: mapSeedToDatabaseValue(input.mapSeed),
          mapThemeId: input.mapThemeId || 'standard',
          rankedEligible,
          startedAt: input.startedAt,
          endedAt: input.endedAt,
          redScore: input.redScore,
          blueScore: input.blueScore,
          winningTeam: input.winningTeam,
          antiCheatIntegrityStatus: input.antiCheatIntegrityStatus ?? 'clean',
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
            rankedEligible: rankedEligible || rankedOutcomeHeld,
            ratingBefore: ratingUpdatesByUserId.get(participant.userId)?.ratingBefore,
            ratingAfter: ratingUpdatesByUserId.get(participant.userId)?.ratingAfter,
            ratingDelta: ratingUpdatesByUserId.get(participant.userId)?.ratingDelta,
            visibleRankBefore: ratingUpdatesByUserId.get(participant.userId)?.visibleRankBefore,
            visibleRankAfter: ratingUpdatesByUserId.get(participant.userId)?.visibleRankAfter,
            leaverPenaltyApplied: ratingUpdatesByUserId.get(participant.userId)?.leaverPenaltyApplied ?? false,
            joinedAt: participant.joinedAt,
            leftAt: participant.leftAt,
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
        if (rankedSeason && ratingUpdate && user) {
          const mode = rankedSeason.mode === 'preseason' ? 'preseason' : 'season';
          const createData = getSeasonAggregateCreateData(participant, user, ratingUpdate, input.endedAt);

          await tx.rankedSeasonUserStats.upsert({
            where: {
              mode_seasonNumber_userId: {
                mode,
                seasonNumber: rankedSeason.seasonNumber,
                userId: participant.userId,
              },
            },
            create: {
              mode,
              seasonNumber: rankedSeason.seasonNumber,
              userId: participant.userId,
              ...createData,
            },
            update: getSeasonAggregateUpdateData(participant, user, ratingUpdate, input.endedAt),
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
