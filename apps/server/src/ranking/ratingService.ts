import {
  DEFAULT_COMPETITIVE_RATING,
  getRankDivisionIndex,
  getRankFromRating,
  type MatchOutcome,
  type Team,
} from '@voxel-strike/shared';

export const PROVISIONAL_K_FACTOR = 48;
export const NORMAL_K_FACTOR = 32;
export const VETERAN_K_FACTOR = 24;
export const TOP_TIER_K_FACTOR = 16;
export const PROVISIONAL_MATCHES = 10;
export const VETERAN_MATCHES = 50;
export const PERFORMANCE_MODIFIER_CAP = 8;
export const LEAVER_PENALTY = 10;
export const MATCH_DELTA_MIN = -50;
export const MATCH_DELTA_MAX = 50;
export const UNEMPLOYED_DIVISION_START_INDEX = 20;

export interface RankedUserState {
  id: string;
  competitiveRating: number;
  rankedGames: number;
  rankedWins: number;
  rankedLosses: number;
  rankedDraws: number;
  rankedPlacementsRemaining: number;
  rankedPeakRating: number;
}

export interface RankedMatchParticipant {
  userId: string;
  team: Team;
  outcome: MatchOutcome;
  score: number;
  kills: number;
  deaths: number;
  assists: number;
  flagCaptures: number;
  flagReturns: number;
  leftAt: Date | null;
}

export interface RankedRatingUpdate {
  userId: string;
  ratingBefore: number;
  ratingAfter: number;
  ratingDelta: number;
  visibleRankBefore: string;
  visibleRankAfter: string;
  leaverPenaltyApplied: boolean;
  rankedGamesAfter: number;
  rankedPlacementsRemainingAfter: number;
  rankedPeakRatingAfter: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getActualScore(outcome: MatchOutcome): number {
  if (outcome === 'win') return 1;
  if (outcome === 'loss') return 0;
  return 0.5;
}

function getExpectedScore(rating: number, opponentAverageRating: number): number {
  return 1 / (1 + 10 ** ((opponentAverageRating - rating) / 400));
}

function getAverageRating(participants: RankedMatchParticipant[], usersById: Map<string, RankedUserState>): number {
  if (participants.length === 0) return DEFAULT_COMPETITIVE_RATING;

  const total = participants.reduce((sum, participant) => {
    return sum + (usersById.get(participant.userId)?.competitiveRating ?? DEFAULT_COMPETITIVE_RATING);
  }, 0);

  return total / participants.length;
}

function getKFactor(user: RankedUserState): number {
  if (getRankDivisionIndex(user.competitiveRating) >= UNEMPLOYED_DIVISION_START_INDEX) {
    return TOP_TIER_K_FACTOR;
  }

  if (user.rankedGames < PROVISIONAL_MATCHES) {
    return PROVISIONAL_K_FACTOR;
  }

  if (user.rankedGames >= VETERAN_MATCHES) {
    return VETERAN_K_FACTOR;
  }

  return NORMAL_K_FACTOR;
}

function getPerformanceScore(participant: RankedMatchParticipant): number {
  return participant.score
    + participant.flagCaptures * 220
    + participant.flagReturns * 90
    + participant.kills * 35
    + participant.assists * 20
    - participant.deaths * 20;
}

function getPerformanceModifier(participant: RankedMatchParticipant, matchAveragePerformance: number): number {
  if (matchAveragePerformance <= 0) return 0;

  const relativeContribution = (getPerformanceScore(participant) - matchAveragePerformance) / matchAveragePerformance;
  return clamp(Math.round(relativeContribution * 6), -PERFORMANCE_MODIFIER_CAP, PERFORMANCE_MODIFIER_CAP);
}

function constrainOutcomeDelta(delta: number, outcome: MatchOutcome): number {
  if (outcome === 'win') return Math.max(0, delta);
  if (outcome === 'loss') return Math.min(0, delta);
  return delta;
}

export function calculateRankedRatingUpdates(input: {
  participants: RankedMatchParticipant[];
  users: RankedUserState[];
  winningTeam: Team | null;
  endedAt: Date;
}): RankedRatingUpdate[] {
  const usersById = new Map(input.users.map((user) => [user.id, user]));
  const participants = input.participants.filter((participant) => usersById.has(participant.userId));
  const redParticipants = participants.filter((participant) => participant.team === 'red');
  const blueParticipants = participants.filter((participant) => participant.team === 'blue');
  const redAverageRating = getAverageRating(redParticipants, usersById);
  const blueAverageRating = getAverageRating(blueParticipants, usersById);
  const averagePerformance = participants.reduce((sum, participant) => sum + getPerformanceScore(participant), 0)
    / Math.max(1, participants.length);

  return participants.map((participant) => {
    const user = usersById.get(participant.userId);
    if (!user) {
      throw new Error(`Missing ranked user state for ${participant.userId}`);
    }

    const ratingBefore = user.competitiveRating;
    const expectedScore = getExpectedScore(
      ratingBefore,
      participant.team === 'red' ? blueAverageRating : redAverageRating
    );
    const actualScore = getActualScore(participant.outcome);
    const baseDelta = getKFactor(user) * (actualScore - expectedScore);
    const performanceDelta = getPerformanceModifier(participant, averagePerformance);
    const leftBeforeEnd = participant.leftAt !== null && participant.leftAt.getTime() < input.endedAt.getTime();
    let ratingDelta = constrainOutcomeDelta(Math.round(baseDelta + performanceDelta), participant.outcome);

    if (leftBeforeEnd) {
      ratingDelta = participant.outcome === 'win'
        ? Math.min(0, ratingDelta - LEAVER_PENALTY)
        : ratingDelta - LEAVER_PENALTY;
    }

    ratingDelta = clamp(ratingDelta, MATCH_DELTA_MIN, MATCH_DELTA_MAX);
    const ratingAfter = Math.max(0, ratingBefore + ratingDelta);
    const rankedGamesAfter = user.rankedGames + 1;
    const visibleRankBefore = getRankFromRating(ratingBefore, user.rankedGames).label;
    const visibleRankAfter = getRankFromRating(ratingAfter, rankedGamesAfter).label;
    const rankedPlacementsRemainingAfter = Math.max(0, user.rankedPlacementsRemaining - 1);

    return {
      userId: participant.userId,
      ratingBefore,
      ratingAfter,
      ratingDelta,
      visibleRankBefore,
      visibleRankAfter,
      leaverPenaltyApplied: leftBeforeEnd,
      rankedGamesAfter,
      rankedPlacementsRemainingAfter,
      rankedPeakRatingAfter: Math.max(user.rankedPeakRating, ratingAfter),
    };
  });
}
