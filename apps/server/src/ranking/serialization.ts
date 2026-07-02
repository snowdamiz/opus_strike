import {
  DEFAULT_COMPETITIVE_RATING,
  RANK_PLACEMENT_MATCHES,
  getRankFromRating,
  type RankSummary,
} from '@voxel-strike/shared';

export interface RankedUserFields {
  competitiveRating: number;
  rankedGames: number;
  rankedWins: number;
  rankedLosses: number;
  rankedDraws: number;
  rankedPlacementsRemaining: number;
  rankedPeakRating: number;
  rankedLastMatchAt?: Date | null;
}

export interface PublicRankPayload {
  competitiveRating: number;
  rankedGames: number;
  rankedWins: number;
  rankedLosses: number;
  rankedDraws: number;
  rankedPlacementsRemaining: number;
  rankedLastMatchAt: string | null;
  current: RankSummary;
  peak: RankSummary;
  progress: RankSummary['progress'];
}

export function serializeRankPayload(user: RankedUserFields | null | undefined): PublicRankPayload {
  const competitiveRating = user?.competitiveRating ?? DEFAULT_COMPETITIVE_RATING;
  const rankedGames = user?.rankedGames ?? 0;
  const rankedWins = user?.rankedWins ?? 0;
  const rankedLosses = user?.rankedLosses ?? 0;
  const rankedDraws = user?.rankedDraws ?? 0;
  const rankedPlacementsRemaining = user?.rankedPlacementsRemaining ?? 0;
  const current = getRankFromRating(competitiveRating, rankedGames);
  const peak = getRankFromRating(
    user?.rankedPeakRating ?? competitiveRating,
    Math.max(rankedGames, RANK_PLACEMENT_MATCHES)
  );

  return {
    competitiveRating,
    rankedGames,
    rankedWins,
    rankedLosses,
    rankedDraws,
    rankedPlacementsRemaining,
    rankedLastMatchAt: user?.rankedLastMatchAt?.toISOString() ?? null,
    current,
    peak,
    progress: current.progress,
  };
}
