import {
  DEFAULT_COMPETITIVE_RATING,
  getRankDivisionIndex,
  getRankFromDivisionIndex,
} from '@voxel-strike/shared';

export interface MatchmakingStats {
  totalGames: number;
  totalWins: number;
  totalKills: number;
  totalDeaths: number;
  totalAssists: number;
  totalCaptures: number;
  totalFlagReturns: number;
  totalScore: number;
}

export const DEFAULT_MATCHMAKING_RATING = DEFAULT_COMPETITIVE_RATING;
export const DEFAULT_RANK_DIVISION_INDEX = getRankDivisionIndex(DEFAULT_COMPETITIVE_RATING);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function calculateLegacyMatchmakingRating(stats: MatchmakingStats | null | undefined): number {
  if (!stats || stats.totalGames <= 0) return DEFAULT_MATCHMAKING_RATING;

  const games = Math.max(1, stats.totalGames);
  const confidence = clamp(games / 20, 0.2, 1);
  const winRate = stats.totalWins / games;
  const scorePerGame = stats.totalScore / games;
  const objectiveActionsPerGame = (stats.totalCaptures + stats.totalFlagReturns) / games;
  const combatRatio = (stats.totalKills + stats.totalAssists * 0.5 + 1) / (stats.totalDeaths + 1);

  const scoreComponent = clamp((scorePerGame - 450) / 3, -180, 300);
  const winComponent = clamp((winRate - 0.5) * 500, -180, 260);
  const combatComponent = clamp(Math.log2(combatRatio) * 160, -160, 220);
  const objectiveComponent = clamp(objectiveActionsPerGame * 65, 0, 180);
  const experienceComponent = clamp(Math.log2(games + 1) * 16, 0, 80);

  return Math.round(clamp(
    DEFAULT_MATCHMAKING_RATING
      + confidence * (scoreComponent + winComponent + combatComponent + objectiveComponent)
      + experienceComponent,
    700,
    1800
  ));
}

export function normalizeRankDivisionIndex(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RANK_DIVISION_INDEX;
  return clamp(Math.floor(value), 0, 23);
}

export function getRankDivisionLabel(divisionIndex: number): string {
  return getRankFromDivisionIndex(normalizeRankDivisionIndex(divisionIndex)).label;
}

export function getAllowedRankDivisionDistance(waitMs: number): number {
  const elapsed = Math.max(0, waitMs);
  if (elapsed < 30_000) return 1;
  if (elapsed < 60_000) return 2;
  if (elapsed < 90_000) return 4;

  return 6;
}

export const calculateMatchmakingRating = calculateLegacyMatchmakingRating;
