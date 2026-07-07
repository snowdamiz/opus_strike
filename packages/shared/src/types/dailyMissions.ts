import type { GameplayMode } from './gameplayMode.js';
import type { HeroId } from './hero.js';
import type { MatchMode } from './matchMode.js';
import type { HeroSkinId } from './skins.js';

export const DAILY_MISSION_RESET_POLICIES = ['utc'] as const;
export type DailyMissionResetPolicy = typeof DAILY_MISSION_RESET_POLICIES[number];

export const DAILY_MISSION_MATCH_MODES = ['quick_play', 'ranked'] as const satisfies readonly MatchMode[];
export const DAILY_MISSION_GAMEPLAY_MODES = ['battle_royal'] as const satisfies readonly GameplayMode[];

export const DAILY_MISSION_CRITERION_TYPES = [
  'matches_completed',
  'wins',
  'eliminations',
  'assists',
  'score',
  'experience',
  'play_hero',
  'eliminations_as_hero',
  'eliminations_against_hero',
  'eliminations_with_ability',
] as const;

export type DailyMissionCriterionType = typeof DAILY_MISSION_CRITERION_TYPES[number];

export const DAILY_MISSION_REWARD_TYPES = ['sol', 'game_token', 'skin'] as const;
export type DailyMissionRewardType = typeof DAILY_MISSION_REWARD_TYPES[number];

export const DAILY_MISSION_CRITERIA_MODES = ['all'] as const;
export type DailyMissionCriteriaMode = typeof DAILY_MISSION_CRITERIA_MODES[number];

export type DailyMissionLeaverPolicy = 'finish_required' | 'allow_partial';

export interface DailyMissionCriterionBase {
  id: string;
  target: number;
}

export interface DailyMissionBasicCriterion extends DailyMissionCriterionBase {
  type:
    | 'matches_completed'
    | 'wins'
    | 'eliminations'
    | 'assists'
    | 'score'
    | 'experience';
}

export interface DailyMissionHeroCriterion extends DailyMissionCriterionBase {
  type: 'play_hero' | 'eliminations_as_hero' | 'eliminations_against_hero';
  heroId: HeroId;
}

export interface DailyMissionAbilityCriterion extends DailyMissionCriterionBase {
  type: 'eliminations_with_ability';
  abilityId: string;
}

export type DailyMissionCriterion =
  | DailyMissionBasicCriterion
  | DailyMissionHeroCriterion
  | DailyMissionAbilityCriterion;

export interface DailyMissionCriteria {
  mode: DailyMissionCriteriaMode;
  items: DailyMissionCriterion[];
}

export interface DailyMissionSolReward {
  type: 'sol';
  amountLamports: string;
}

export interface DailyMissionGameTokenReward {
  type: 'game_token';
  amountBaseUnits: string;
  symbol?: string;
}

export interface DailyMissionSkinReward {
  type: 'skin';
  skinId: HeroSkinId;
}

export type DailyMissionReward =
  | DailyMissionSolReward
  | DailyMissionGameTokenReward
  | DailyMissionSkinReward;

export interface DailyMissionRewardBundle {
  items: DailyMissionReward[];
}

export interface DailyMissionEligibility {
  matchModes: MatchMode[];
  gameplayModes: GameplayMode[];
  rankedOnly: boolean;
  cleanIntegrityOnly: boolean;
  minDurationMs: number;
  leaverPolicy: DailyMissionLeaverPolicy;
}

export interface DailyMissionDefinitionSnapshot {
  id: string;
  displayName: string;
  description: string;
  enabled: boolean;
  sortOrder: number;
  activeStartsAt: string | null;
  activeEndsAt: string | null;
  resetPolicy: DailyMissionResetPolicy;
  criteria: DailyMissionCriteria;
  rewards: DailyMissionRewardBundle;
  eligibility: DailyMissionEligibility;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DailyMissionProgressSnapshot {
  missionId: string;
  dayKey: string;
  progress: Record<string, number>;
  completedAt: string | null;
  grantedAt: string | null;
  lastMatchId: string | null;
  grants: DailyMissionRewardGrantSnapshot[];
}

export type DailyMissionGrantStatus = 'pending' | 'processing' | 'granted' | 'failed' | 'canceled';

export interface DailyMissionRewardGrantSnapshot {
  id: string;
  missionId: string;
  dayKey: string;
  rewardType: DailyMissionRewardType;
  amountBaseUnits: string | null;
  skinId: HeroSkinId | null;
  status: DailyMissionGrantStatus;
  idempotencyKey: string;
  playerRewardId: string | null;
  tokenPayoutId: string | null;
  lastError: string | null;
  grantedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlayerDailyMissionSnapshot {
  mission: DailyMissionDefinitionSnapshot;
  progress: DailyMissionProgressSnapshot | null;
  percentComplete: number;
}

export interface PlayerDailyMissionsResponse {
  dayKey: string;
  generatedAt: string;
  missions: PlayerDailyMissionSnapshot[];
}

export interface DailyMissionAdminSummary {
  activeToday: number;
  enabled: number;
  archived: number;
  completedToday: number;
  failedGrants: number;
  pendingTokenPayouts: number;
}

export interface DailyMissionAdminOverview {
  dayKey: string;
  summary: DailyMissionAdminSummary;
  today: DailyMissionAdminMissionRow[];
  library: DailyMissionDefinitionSnapshot[];
  audit: DailyMissionRewardGrantSnapshot[];
}

export interface DailyMissionAdminMissionRow {
  mission: DailyMissionDefinitionSnapshot;
  completedCount: number;
  grantCount: number;
  failedGrantCount: number;
}

export const DEFAULT_DAILY_MISSION_ELIGIBILITY: DailyMissionEligibility = {
  matchModes: [...DAILY_MISSION_MATCH_MODES],
  gameplayModes: [...DAILY_MISSION_GAMEPLAY_MODES],
  rankedOnly: false,
  cleanIntegrityOnly: true,
  minDurationMs: 180000,
  leaverPolicy: 'finish_required',
};

export const DAILY_MISSION_CRITERION_LABELS: Record<DailyMissionCriterionType, string> = {
  matches_completed: 'Complete matches',
  wins: 'Win matches',
  eliminations: 'Get eliminations',
  assists: 'Get assists',
  score: 'Earn score',
  experience: 'Earn XP',
  play_hero: 'Play hero',
  eliminations_as_hero: 'Elims as hero',
  eliminations_against_hero: 'Elims against hero',
  eliminations_with_ability: 'Ability eliminations',
};

export function getDailyMissionCriterionLabel(type: DailyMissionCriterionType): string {
  return DAILY_MISSION_CRITERION_LABELS[type];
}

export function getDailyMissionProgressValue(
  progress: Record<string, number> | null | undefined,
  criterionId: string
): number {
  const value = progress?.[criterionId];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function getDailyMissionCriterionPercent(
  progress: Record<string, number> | null | undefined,
  criterion: DailyMissionCriterion
): number {
  if (criterion.target <= 0) return 100;
  return Math.min(100, Math.floor((getDailyMissionProgressValue(progress, criterion.id) / criterion.target) * 100));
}

export function getDailyMissionPercentComplete(
  criteria: DailyMissionCriteria,
  progress: Record<string, number> | null | undefined
): number {
  if (criteria.items.length === 0) return 0;
  const total = criteria.items.reduce((sum, criterion) => (
    sum + getDailyMissionCriterionPercent(progress, criterion)
  ), 0);
  return Math.min(100, Math.floor(total / criteria.items.length));
}
