import {
  DEFAULT_COMPETITIVE_RATING,
  getRankDivisionIndex,
  getRankFromDivisionIndex,
} from '@voxel-strike/shared';

export const DEFAULT_MATCHMAKING_RATING = DEFAULT_COMPETITIVE_RATING;
export const DEFAULT_RANK_DIVISION_INDEX = getRankDivisionIndex(DEFAULT_COMPETITIVE_RATING);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  if (elapsed < 60_000) return 2;
  if (elapsed < 90_000) return 4;

  return 6;
}
