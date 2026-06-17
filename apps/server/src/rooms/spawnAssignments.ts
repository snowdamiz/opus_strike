import type { Team } from '@voxel-strike/shared';

export interface TeamSpawnParticipant {
  playerId: string;
  team: Team;
}

export interface TeamSpawnAssignment {
  playerId: string;
  team: Team;
  spawnIndex: number;
}

function normalizeSpawnOffset(offset: number, spawnPointCount: number): number {
  if (spawnPointCount <= 0) return 0;
  return ((Math.floor(offset) % spawnPointCount) + spawnPointCount) % spawnPointCount;
}

export function createTeamSpawnAssignments(
  participants: readonly TeamSpawnParticipant[],
  spawnPointCounts: Record<Team, number>,
  offsetByTeam: Partial<Record<Team, number>> = {}
): TeamSpawnAssignment[] {
  const nextTeamIndex: Record<Team, number> = { red: 0, blue: 0 };
  const assignments: TeamSpawnAssignment[] = [];

  for (const participant of participants) {
    const spawnPointCount = Math.max(0, Math.floor(spawnPointCounts[participant.team] ?? 0));
    if (spawnPointCount === 0) continue;

    const offset = normalizeSpawnOffset(offsetByTeam[participant.team] ?? 0, spawnPointCount);
    const teamIndex = nextTeamIndex[participant.team]++;
    assignments.push({
      playerId: participant.playerId,
      team: participant.team,
      spawnIndex: (offset + teamIndex) % spawnPointCount,
    });
  }

  return assignments;
}
