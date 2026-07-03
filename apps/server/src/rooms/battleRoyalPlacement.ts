import {
  isBattleRoyalContestant,
  type Team,
} from '@voxel-strike/shared';
import type { MatchParticipantSnapshot } from '../persistence/matchPersistence';

interface BattleRoyalPlacementPlayer {
  team?: string | null;
  state?: string | null;
}

interface TeamPlacement {
  placement: number;
  eliminatedAt: Date | null;
}

export class BattleRoyalPlacementTracker {
  private readonly activeTeamIds = new Set<Team>();
  private readonly placements = new Map<Team, TeamPlacement>();

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

  update(players: Iterable<BattleRoyalPlacementPlayer>, now = Date.now()): void {
    if (this.activeTeamIds.size === 0) return;
    const contestingTeams = getBattleRoyalContestingTeamSet(players);
    const unplacedCount = this.getUnplacedTeamCount();
    const eliminatedAt = new Date(now);

    for (const team of this.activeTeamIds) {
      if (this.placements.has(team) || contestingTeams.has(team)) continue;
      this.placements.set(team, {
        placement: Math.max(1, unplacedCount - this.getNewlyPlacedTeamCount(eliminatedAt)),
        eliminatedAt,
      });
    }
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

  private getUnplacedTeamCount(): number {
    return Math.max(0, this.activeTeamIds.size - this.placements.size);
  }

  private getNewlyPlacedTeamCount(eliminatedAt: Date): number {
    let count = 0;
    for (const placement of this.placements.values()) {
      if (placement.eliminatedAt?.getTime() === eliminatedAt.getTime()) count++;
    }
    return count;
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
