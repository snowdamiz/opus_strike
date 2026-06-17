import type { GameplayMode, Team } from '@voxel-strike/shared';

export function isCaptureTheFlagMode(gameplayMode: GameplayMode): boolean {
  return gameplayMode === 'capture_the_flag';
}

export function isTeamDeathmatchMode(gameplayMode: GameplayMode): boolean {
  return gameplayMode === 'team_deathmatch';
}

export function hasTeamReachedScoreLimit(
  redScore: number,
  blueScore: number,
  scoreToWin: number
): boolean {
  return redScore >= scoreToWin || blueScore >= scoreToWin;
}

export function shouldEndGameAfterRound(
  gameplayMode: GameplayMode,
  redScore: number,
  blueScore: number,
  scoreToWin: number
): boolean {
  return hasTeamReachedScoreLimit(redScore, blueScore, scoreToWin)
    || isTeamDeathmatchMode(gameplayMode);
}

export function getWinningTeam(redScore: number, blueScore: number): Team | null {
  if (redScore > blueScore) return 'red';
  if (blueScore > redScore) return 'blue';
  return null;
}
