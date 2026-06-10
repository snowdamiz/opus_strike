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

export const DEFAULT_MATCHMAKING_RATING = 1000;

export const MATCHMAKING_SKILL_BUCKETS = [
  { id: 'rookie', label: 'Rookie', min: Number.NEGATIVE_INFINITY, max: 899 },
  { id: 'contender', label: 'Contender', min: 900, max: 1099 },
  { id: 'adept', label: 'Adept', min: 1100, max: 1299 },
  { id: 'veteran', label: 'Veteran', min: 1300, max: 1499 },
  { id: 'elite', label: 'Elite', min: 1500, max: Number.POSITIVE_INFINITY },
] as const;

export type MatchmakingSkillBucket = (typeof MATCHMAKING_SKILL_BUCKETS)[number]['id'];

export const DEFAULT_MATCHMAKING_SKILL_BUCKET: MatchmakingSkillBucket = 'contender';

const BUCKET_EXPANSION_MS = 30_000;
const MAX_BUCKET_DISTANCE = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function calculateMatchmakingRating(stats: MatchmakingStats | null | undefined): number {
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

export function getSkillBucket(rating: number): (typeof MATCHMAKING_SKILL_BUCKETS)[number] {
  return MATCHMAKING_SKILL_BUCKETS.find((bucket) => rating <= bucket.max) ?? MATCHMAKING_SKILL_BUCKETS[MATCHMAKING_SKILL_BUCKETS.length - 1];
}

export function normalizeSkillBucket(value: unknown): MatchmakingSkillBucket {
  return MATCHMAKING_SKILL_BUCKETS.some((bucket) => bucket.id === value)
    ? value as MatchmakingSkillBucket
    : DEFAULT_MATCHMAKING_SKILL_BUCKET;
}

export function getSkillBucketIndex(bucketId: MatchmakingSkillBucket): number {
  return MATCHMAKING_SKILL_BUCKETS.findIndex((bucket) => bucket.id === bucketId);
}

export function getSkillBucketLabel(bucketId: MatchmakingSkillBucket): string {
  return MATCHMAKING_SKILL_BUCKETS[getSkillBucketIndex(bucketId)]?.label ?? 'Contender';
}

export function getAllowedBucketDistance(waitMs: number): number {
  return clamp(Math.floor(Math.max(0, waitMs) / BUCKET_EXPANSION_MS), 0, MAX_BUCKET_DISTANCE);
}
