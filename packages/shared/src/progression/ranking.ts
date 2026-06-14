export const RANK_PLACEMENT_MATCHES = 0;
export const DEFAULT_COMPETITIVE_RATING = 800;
export const DEFAULT_RANKED_SEASON_NUMBER = 1;
export const RANKED_SEASON_MAX_NUMBER = 999;

export type RankedSeasonMode = 'preseason' | 'season';

export interface RankedSeasonSnapshot {
  mode: RankedSeasonMode;
  seasonNumber: number;
  label: string;
  endsAt: string | null;
}

export const RANK_TIERS = [
  'plastic',
  'bronze',
  'silver',
  'gold',
  'diamond',
  'unemployed',
] as const;

export type RankTierId = (typeof RANK_TIERS)[number];
export type PublicRankTierId = RankTierId | 'unranked';

export interface RankTheme {
  primary: string;
  secondary: string;
  accent: string;
  foreground: string;
  glow: string;
}

export interface RankDefinition {
  id: RankTierId;
  label: string;
  iconKey: string;
  divisionThresholds: readonly [number, number, number, number];
  theme: RankTheme;
}

export interface RankProgress {
  currentDivisionFloor: number;
  nextDivisionFloor: number | null;
  progress: number;
  excessRating: number;
}

export interface RankSummary {
  tier: PublicRankTierId;
  tierLabel: string;
  division: number | null;
  divisionIndex: number | null;
  label: string;
  iconKey: string;
  isRanked: boolean;
  placementRemaining: number;
  rating: number;
  progress: RankProgress;
  theme: RankTheme;
}

export interface PublicRankSnapshot {
  tier: PublicRankTierId;
  tierLabel: string;
  division: number | null;
  divisionIndex: number | null;
  label: string;
  iconKey: string;
  isRanked: boolean;
  placementRemaining: number;
}

export const RANK_DEFINITIONS: readonly RankDefinition[] = [
  {
    id: 'plastic',
    label: 'Plastic',
    iconKey: 'plastic-plate',
    divisionThresholds: [600, 650, 700, 750],
    theme: {
      primary: '#d9e2ec',
      secondary: '#7d8896',
      accent: '#f5f7fa',
      foreground: '#111827',
      glow: 'rgba(217,226,236,0.28)',
    },
  },
  {
    id: 'bronze',
    label: 'Bronze',
    iconKey: 'bronze-shield',
    divisionThresholds: [800, 850, 900, 950],
    theme: {
      primary: '#c9793d',
      secondary: '#7a3f21',
      accent: '#ffd0a3',
      foreground: '#fff7ed',
      glow: 'rgba(201,121,61,0.34)',
    },
  },
  {
    id: 'silver',
    label: 'Silver',
    iconKey: 'silver-crest',
    divisionThresholds: [1000, 1050, 1100, 1150],
    theme: {
      primary: '#d6e4f0',
      secondary: '#6b8aa6',
      accent: '#ffffff',
      foreground: '#eff6ff',
      glow: 'rgba(148,196,230,0.34)',
    },
  },
  {
    id: 'gold',
    label: 'Gold',
    iconKey: 'gold-crown',
    divisionThresholds: [1200, 1250, 1300, 1350],
    theme: {
      primary: '#f5c542',
      secondary: '#9a6b16',
      accent: '#fff1a6',
      foreground: '#fffbeb',
      glow: 'rgba(245,197,66,0.38)',
    },
  },
  {
    id: 'diamond',
    label: 'Diamond',
    iconKey: 'diamond-crystal',
    divisionThresholds: [1400, 1450, 1500, 1550],
    theme: {
      primary: '#67e8f9',
      secondary: '#0e7490',
      accent: '#ecfeff',
      foreground: '#ecfeff',
      glow: 'rgba(103,232,249,0.38)',
    },
  },
  {
    id: 'unemployed',
    label: 'Unemployed',
    iconKey: 'unemployed-briefcase',
    divisionThresholds: [1600, 1650, 1700, 1750],
    theme: {
      primary: '#c084fc',
      secondary: '#4c1d95',
      accent: '#facc15',
      foreground: '#faf5ff',
      glow: 'rgba(192,132,252,0.44)',
    },
  },
] as const;

const UNRANKED_THEME: RankTheme = {
  primary: '#94a3b8',
  secondary: '#334155',
  accent: '#cbd5e1',
  foreground: '#f8fafc',
  glow: 'rgba(148,163,184,0.24)',
};

const DIVISIONS_PER_TIER = 4;
const RANK_DIVISIONS = RANK_DEFINITIONS.flatMap((tier, tierIndex) => (
  tier.divisionThresholds.map((threshold, divisionIndex) => ({
    tier,
    threshold,
    division: divisionIndex + 1,
    divisionIndex: tierIndex * DIVISIONS_PER_TIER + divisionIndex,
  }))
));

const FIRST_DIVISION = RANK_DIVISIONS[0];
const LAST_DIVISION = RANK_DIVISIONS[RANK_DIVISIONS.length - 1];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeRating(rating: number): number {
  return Math.round(Number.isFinite(rating) ? rating : DEFAULT_COMPETITIVE_RATING);
}

export function getPlacementRemaining(rankedGames: number, placementMatches = RANK_PLACEMENT_MATCHES): number {
  const games = Math.max(0, Math.floor(Number.isFinite(rankedGames) ? rankedGames : 0));
  return Math.max(0, placementMatches - games);
}

export function isPlacementComplete(rankedGames: number, placementMatches = RANK_PLACEMENT_MATCHES): boolean {
  return getPlacementRemaining(rankedGames, placementMatches) === 0;
}

function getDivisionForRating(rating: number) {
  const normalizedRating = normalizeRating(rating);
  let current = FIRST_DIVISION;

  for (const division of RANK_DIVISIONS) {
    if (normalizedRating >= division.threshold) {
      current = division;
    } else {
      break;
    }
  }

  return current;
}

export function getRankDivisionIndex(rating: number): number {
  return getDivisionForRating(rating).divisionIndex;
}

export function getRankFromDivisionIndex(divisionIndex: number): RankSummary {
  const normalizedIndex = clamp(Math.floor(Number.isFinite(divisionIndex) ? divisionIndex : 0), 0, RANK_DIVISIONS.length - 1);
  const division = RANK_DIVISIONS[normalizedIndex];
  return getRankFromRating(division.threshold, RANK_PLACEMENT_MATCHES);
}

export function getRankProgress(rating: number): RankProgress {
  const normalizedRating = normalizeRating(rating);
  const division = getDivisionForRating(normalizedRating);
  const next = RANK_DIVISIONS[division.divisionIndex + 1] ?? null;

  if (!next) {
    return {
      currentDivisionFloor: LAST_DIVISION.threshold,
      nextDivisionFloor: null,
      progress: 1,
      excessRating: Math.max(0, normalizedRating - LAST_DIVISION.threshold),
    };
  }

  return {
    currentDivisionFloor: division.threshold,
    nextDivisionFloor: next.threshold,
    progress: clamp((normalizedRating - division.threshold) / (next.threshold - division.threshold), 0, 1),
    excessRating: 0,
  };
}

export function getRankTheme(rankTier: PublicRankTierId): RankTheme {
  if (rankTier === 'unranked') return UNRANKED_THEME;
  return RANK_DEFINITIONS.find((definition) => definition.id === rankTier)?.theme ?? UNRANKED_THEME;
}

export function getRankFromRating(
  rating: number,
  rankedGames: number,
  placementMatches = RANK_PLACEMENT_MATCHES
): RankSummary {
  const normalizedRating = normalizeRating(rating);
  const placementRemaining = getPlacementRemaining(rankedGames, placementMatches);
  const progress = getRankProgress(normalizedRating);

  if (placementRemaining > 0) {
    return {
      tier: 'unranked',
      tierLabel: 'Unranked',
      division: null,
      divisionIndex: null,
      label: 'Unranked',
      iconKey: 'unranked',
      isRanked: false,
      placementRemaining,
      rating: normalizedRating,
      progress,
      theme: UNRANKED_THEME,
    };
  }

  const division = getDivisionForRating(normalizedRating);
  return {
    tier: division.tier.id,
    tierLabel: division.tier.label,
    division: division.division,
    divisionIndex: division.divisionIndex,
    label: `${division.tier.label} ${division.division}`,
    iconKey: division.tier.iconKey,
    isRanked: true,
    placementRemaining: 0,
    rating: normalizedRating,
    progress,
    theme: division.tier.theme,
  };
}

export function formatRank(rank: Pick<RankSummary, 'label'> | null | undefined): string {
  return rank?.label ?? 'Unranked';
}

export function normalizeRankedSeasonNumber(seasonNumber: number): number {
  const normalized = Math.floor(Number.isFinite(seasonNumber) ? seasonNumber : DEFAULT_RANKED_SEASON_NUMBER);
  return clamp(normalized, DEFAULT_RANKED_SEASON_NUMBER, RANKED_SEASON_MAX_NUMBER);
}

export function getRankedSeasonIdentity(input: Pick<RankedSeasonSnapshot, 'mode' | 'seasonNumber'>): string {
  return input.mode === 'preseason'
    ? 'preseason'
    : `season:${normalizeRankedSeasonNumber(input.seasonNumber)}`;
}

export function getRankedSeasonLabel(input: Pick<RankedSeasonSnapshot, 'mode' | 'seasonNumber'>): string {
  return input.mode === 'preseason'
    ? 'Pre-Season'
    : `Season ${normalizeRankedSeasonNumber(input.seasonNumber)}`;
}

export function toPublicRankSnapshot(rank: RankSummary): PublicRankSnapshot {
  return {
    tier: rank.tier,
    tierLabel: rank.tierLabel,
    division: rank.division,
    divisionIndex: rank.divisionIndex,
    label: rank.label,
    iconKey: rank.iconKey,
    isRanked: rank.isRanked,
    placementRemaining: rank.placementRemaining,
  };
}
