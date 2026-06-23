import {
  getGameplayModeRules,
  isBattleRoyalContestant,
  isBattleRoyalMode,
  type GameplayMode,
  type Team,
} from '@voxel-strike/shared';

export function isCaptureTheFlagMode(gameplayMode: GameplayMode): boolean {
  return gameplayMode === 'capture_the_flag';
}

export function isTeamDeathmatchMode(gameplayMode: GameplayMode): boolean {
  return gameplayMode === 'team_deathmatch';
}

export { isBattleRoyalMode };

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
  const rules = getGameplayModeRules(gameplayMode);
  if (rules.matchEndPolicy === 'last_team_alive') return false;
  if (rules.matchEndPolicy === 'round_time_or_score') return true;
  return hasTeamReachedScoreLimit(redScore, blueScore, scoreToWin);
}

export function getWinningTeam(redScore: number, blueScore: number): Team | null {
  if (redScore > blueScore) return 'red';
  if (blueScore > redScore) return 'blue';
  return null;
}

export function getAliveTeams(players: Iterable<{ team?: string | null; state?: string | null }>): Team[] {
  const aliveTeams = new Set<Team>();
  for (const player of players) {
    if (player.state !== 'alive' || !player.team) continue;
    aliveTeams.add(player.team);
  }
  return Array.from(aliveTeams);
}

export function getBattleRoyalContestingTeams(players: Iterable<{ team?: string | null; state?: string | null }>): Team[] {
  const contestingTeams = new Set<Team>();
  for (const player of players) {
    if (!player.team || !isBattleRoyalContestant(player)) continue;
    contestingTeams.add(player.team);
  }
  return Array.from(contestingTeams);
}

export interface BattleRoyalMatchEndDecision {
  shouldEnd: boolean;
  winningTeam: Team | null;
  aliveTeams: Team[];
}

export function resolveBattleRoyalMatchEnd(
  players: Iterable<{ team?: string | null; state?: string | null }>
): BattleRoyalMatchEndDecision {
  const aliveTeams = getBattleRoyalContestingTeams(players);
  return {
    shouldEnd: aliveTeams.length <= 1,
    winningTeam: aliveTeams.length === 1 ? aliveTeams[0] : null,
    aliveTeams,
  };
}
