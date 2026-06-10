import type { MatchOutcome } from '../types/game.js';

export interface MatchExperienceStats {
  kills: number;
  assists: number;
  flagCaptures: number;
  flagReturns: number;
}

export interface UserLevelProgress {
  level: number;
  totalExperience: number;
  experienceForCurrentLevel: number;
  experienceForNextLevel: number;
  experienceIntoLevel: number;
  experienceToNextLevel: number;
  progress: number;
}

export const LEVELING = {
  baseExperiencePerLevel: 1000,
  levelExperienceGrowth: 250,
} as const;

export const MATCH_EXPERIENCE_VALUES = {
  baseMatch: 100,
  win: 200,
  draw: 100,
  loss: 50,
  kill: 25,
  assist: 15,
  flagCapture: 150,
  flagReturn: 60,
} as const;

export function getExperienceForLevel(level: number): number {
  const normalizedLevel = Math.max(1, Math.floor(level));
  const completedLevels = normalizedLevel - 1;

  return completedLevels * LEVELING.baseExperiencePerLevel
    + ((completedLevels - 1) * completedLevels * LEVELING.levelExperienceGrowth) / 2;
}

export function getLevelFromExperience(totalExperience: number): number {
  const normalizedExperience = Math.max(0, Math.floor(totalExperience));
  let level = 1;

  while (normalizedExperience >= getExperienceForLevel(level + 1)) {
    level++;
  }

  return level;
}

export function getLevelProgress(totalExperience: number): UserLevelProgress {
  const normalizedExperience = Math.max(0, Math.floor(totalExperience));
  const level = getLevelFromExperience(normalizedExperience);
  const experienceForCurrentLevel = getExperienceForLevel(level);
  const experienceForNextLevel = getExperienceForLevel(level + 1);
  const experienceIntoLevel = normalizedExperience - experienceForCurrentLevel;
  const levelSpan = Math.max(1, experienceForNextLevel - experienceForCurrentLevel);
  const experienceToNextLevel = Math.max(0, experienceForNextLevel - normalizedExperience);

  return {
    level,
    totalExperience: normalizedExperience,
    experienceForCurrentLevel,
    experienceForNextLevel,
    experienceIntoLevel,
    experienceToNextLevel,
    progress: Math.max(0, Math.min(1, experienceIntoLevel / levelSpan)),
  };
}

export function calculateMatchExperience(
  stats: MatchExperienceStats,
  outcome: MatchOutcome
): number {
  const outcomeExperience = outcome === 'win'
    ? MATCH_EXPERIENCE_VALUES.win
    : outcome === 'draw'
      ? MATCH_EXPERIENCE_VALUES.draw
      : MATCH_EXPERIENCE_VALUES.loss;

  return MATCH_EXPERIENCE_VALUES.baseMatch
    + outcomeExperience
    + Math.max(0, stats.kills) * MATCH_EXPERIENCE_VALUES.kill
    + Math.max(0, stats.assists) * MATCH_EXPERIENCE_VALUES.assist
    + Math.max(0, stats.flagCaptures) * MATCH_EXPERIENCE_VALUES.flagCapture
    + Math.max(0, stats.flagReturns) * MATCH_EXPERIENCE_VALUES.flagReturn;
}
