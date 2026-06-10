import type { Prisma, PrismaClient } from '@prisma/client';
import type { Team } from '@voxel-strike/shared';

export type MatchOutcome = 'win' | 'loss' | 'draw';

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
  mapSeed: number;
  startedAt: Date;
  endedAt: Date;
  redScore: number;
  blueScore: number;
  winningTeam: Team | null;
  participants: MatchParticipantSnapshot[];
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

export function normalizeMatchParticipants(
  participants: MatchParticipantSnapshot[],
  winningTeam: Team | null
): PersistableParticipant[] {
  const byUserId = new Map<string, PersistableParticipant>();

  for (const participant of participants) {
    const existing = byUserId.get(participant.userId);
    const score = calculateParticipantScore(participant);
    const outcome = getMatchOutcome(participant.team, winningTeam);

    if (!existing) {
      byUserId.set(participant.userId, {
        ...participant,
        outcome,
        score,
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
        select: { id: true },
      });
      const existingUserIds = new Set(existingUsers.map((user) => user.id));
      const participants = normalizedParticipants.filter((participant) => existingUserIds.has(participant.userId));
      const skippedUserIds = userIds.filter((userId) => !existingUserIds.has(userId));

      await tx.gameMatch.create({
        data: {
          id: input.matchId,
          roomId: input.roomId,
          lobbyId: input.lobbyId,
          mapSeed: input.mapSeed,
          startedAt: input.startedAt,
          endedAt: input.endedAt,
          redScore: input.redScore,
          blueScore: input.blueScore,
          winningTeam: input.winningTeam,
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
            outcome: participant.outcome,
            joinedAt: participant.joinedAt,
            leftAt: participant.leftAt,
          })),
        });
      }

      for (const participant of participants) {
        await tx.user.update({
          where: { id: participant.userId },
          data: getUserAggregateIncrement(participant),
        });
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
