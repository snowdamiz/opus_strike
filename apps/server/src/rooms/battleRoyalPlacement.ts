import {
  isBattleRoyalContestant,
  type Team,
} from '@voxel-strike/shared';
import type { MatchParticipantSnapshot } from '../persistence/matchPersistence';

interface BattleRoyalPlacementPlayer {
  team?: string | null;
  state?: string | null;
}

export interface BattleRoyalTeamPlacement {
  placement: number;
  eliminatedAt: Date | null;
}

export interface BattleRoyalPlacementUpdateResult {
  newlyPlacedTeams: Team[];
  reactivatedTeams: Team[];
}

export class BattleRoyalPlacementTracker {
  private readonly activeTeamIds = new Set<Team>();
  private readonly placements = new Map<Team, BattleRoyalTeamPlacement>();

  get activeTeamCount(): number {
    return this.activeTeamIds.size;
  }

  clear(): void {
    this.activeTeamIds.clear();
    this.placements.clear();
  }

  initialize(players: Iterable<BattleRoyalPlacementPlayer>, now = Date.now()): void {
    this.clear();
    for (const team of getBattleRoyalCombatTeams(players)) {
      this.activeTeamIds.add(team);
    }
    this.update(players, now);
  }

  update(players: Iterable<BattleRoyalPlacementPlayer>, now = Date.now()): BattleRoyalPlacementUpdateResult {
    const contestingTeams = getBattleRoyalContestingTeamSet(players);
    const reactivatedTeams: Team[] = [];
    for (const team of contestingTeams) {
      this.activeTeamIds.add(team);
      if (this.placements.delete(team)) {
        reactivatedTeams.push(team);
      }
    }

    if (this.activeTeamIds.size === 0) {
      return { newlyPlacedTeams: [], reactivatedTeams };
    }

    const newlyPlacedTeams: Team[] = [];

    for (const team of this.activeTeamIds) {
      if (this.placements.has(team) || contestingTeams.has(team)) continue;
      newlyPlacedTeams.push(team);
    }

    if (newlyPlacedTeams.length === 0) {
      return { newlyPlacedTeams, reactivatedTeams };
    }

    const eliminatedAt = new Date(now);
    const placement = Math.max(1, contestingTeams.size + 1);

    for (const team of newlyPlacedTeams) {
      this.placements.set(team, {
        placement,
        eliminatedAt,
      });
    }

    return { newlyPlacedTeams, reactivatedTeams };
  }

  finalize(players: Iterable<BattleRoyalPlacementPlayer>, winningTeam: Team | null, now = Date.now()): void {
    this.update(players, now);
    const remainingTeams = Array.from(this.activeTeamIds)
      .filter((team) => !this.placements.has(team))
      .sort((a, b) => {
        if (a === winningTeam) return -1;
        if (b === winningTeam) return 1;
        return a.localeCompare(b);
      });

    for (let index = 0; index < remainingTeams.length; index++) {
      this.placements.set(remainingTeams[index], {
        placement: index + 1,
        eliminatedAt: null,
      });
    }
  }

  enrichParticipantSnapshots(participants: MatchParticipantSnapshot[]): MatchParticipantSnapshot[] {
    if (this.activeTeamIds.size === 0) return participants;
    return participants.map((participant) => {
      const teamPlacement = this.placements.get(participant.team);
      return {
        ...participant,
        placement: teamPlacement?.placement ?? null,
        activeTeamCount: this.activeTeamIds.size,
        teamEliminatedAt: teamPlacement?.eliminatedAt ?? null,
      };
    });
  }

  getTeamPlacement(team: Team): BattleRoyalTeamPlacement | null {
    return this.placements.get(team) ?? null;
  }

  getPlacedTeams(): Team[] {
    return Array.from(this.placements.keys());
  }

  hasTeamPlacement(team: Team): boolean {
    return this.placements.has(team);
  }

}

function getBattleRoyalCombatTeams(players: Iterable<BattleRoyalPlacementPlayer>): Team[] {
  const teams = new Set<Team>();
  for (const player of players) {
    if (!player.team) continue;
    teams.add(player.team as Team);
  }
  return Array.from(teams);
}

function getBattleRoyalContestingTeamSet(players: Iterable<BattleRoyalPlacementPlayer>): Set<Team> {
  const teams = new Set<Team>();
  for (const player of players) {
    if (!player.team || !isBattleRoyalContestant(player)) continue;
    teams.add(player.team as Team);
  }
  return teams;
}
