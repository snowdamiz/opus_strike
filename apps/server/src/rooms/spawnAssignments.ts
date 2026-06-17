import type { Team } from '@voxel-strike/shared';

export interface CombatTeamMember {
  team?: string | null;
  isObserver?: boolean | null;
}

export interface TeamSpawnPosition {
  x: number;
  y: number;
  z: number;
}

export interface TeamSpawnFacing {
  x: number;
  z: number;
}

export interface TeamSpawnManifest {
  gameplay?: {
    spawns?: Partial<Record<Team, {
      points?: readonly TeamSpawnPosition[];
      facing?: TeamSpawnFacing | null;
    }>>;
  } | null;
  spawnPoints: Record<Team, readonly TeamSpawnPosition[]>;
}

export interface TeamSpawnParticipant {
  playerId: string;
  team: Team;
}

export interface TeamSpawnParticipantSource {
  team?: string | null;
}

export interface TeamSpawnAssignment {
  playerId: string;
  team: Team;
  spawnIndex: number;
}

export interface TeamSpawnPlan {
  spawnPointsByTeam: Record<Team, readonly TeamSpawnPosition[]>;
  assignments: TeamSpawnAssignment[];
}

export interface TeamSpawnPlacement {
  position: TeamSpawnPosition;
  lookYaw: number;
  lookPitch: number;
}

const DEFAULT_TEAM_SPAWN_POSITION: TeamSpawnPosition = { x: 0, y: 1, z: 0 };

function normalizeAngle(angle: number): number {
  let normalized = angle;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}

function normalizeSpawnOffset(offset: number, spawnPointCount: number): number {
  if (spawnPointCount <= 0) return 0;
  return ((Math.floor(offset) % spawnPointCount) + spawnPointCount) % spawnPointCount;
}

function isSpawnTeam(team: unknown): team is Team {
  return team === 'red' || team === 'blue';
}

export function countCombatTeamMembers(
  players: Iterable<CombatTeamMember>,
  team: Team
): number {
  let count = 0;
  for (const player of players) {
    if (!player.isObserver && player.team === team) count++;
  }
  return count;
}

export function countCombatTeamMembersExcluding(
  players: Iterable<readonly [string, CombatTeamMember]>,
  team: Team,
  excludedPlayerId: string
): number {
  let count = 0;
  for (const [playerId, player] of players) {
    if (playerId !== excludedPlayerId && !player.isObserver && player.team === team) {
      count++;
    }
  }
  return count;
}

export function assignBalancedTeam(input: {
  redCount: number;
  blueCount: number;
  preferredTeam?: Team | null;
}): Team {
  if (input.preferredTeam) {
    const preferredCount = input.preferredTeam === 'red' ? input.redCount : input.blueCount;
    const otherCount = input.preferredTeam === 'red' ? input.blueCount : input.redCount;
    if (preferredCount <= otherCount) {
      return input.preferredTeam;
    }
  }

  return input.redCount <= input.blueCount ? 'red' : 'blue';
}

export function collectTeamSpawnParticipants(
  players: Iterable<readonly [string, TeamSpawnParticipantSource]>
): TeamSpawnParticipant[] {
  const participants: TeamSpawnParticipant[] = [];
  for (const [playerId, player] of players) {
    if (isSpawnTeam(player.team)) {
      participants.push({ playerId, team: player.team });
    }
  }
  return participants;
}

export function getTeamSpawnPoints(
  manifest: TeamSpawnManifest,
  team: Team
): readonly TeamSpawnPosition[] {
  const gameplayPoints = manifest.gameplay?.spawns?.[team]?.points;
  if (gameplayPoints && gameplayPoints.length > 0) {
    return gameplayPoints;
  }

  const fallbackPoints = manifest.spawnPoints[team];
  return fallbackPoints.length > 0 ? fallbackPoints : [DEFAULT_TEAM_SPAWN_POSITION];
}

export function getTeamSpawnLookYaw(
  manifest: TeamSpawnManifest,
  team: Team
): number {
  const facing = manifest.gameplay?.spawns?.[team]?.facing;
  if (
    !facing ||
    !Number.isFinite(facing.x) ||
    !Number.isFinite(facing.z) ||
    Math.hypot(facing.x, facing.z) <= 0.001
  ) {
    return team === 'red' ? Math.PI : 0;
  }

  return normalizeAngle(Math.atan2(-facing.x, -facing.z));
}

export function pickTeamSpawnPoint(
  spawnPoints: readonly TeamSpawnPosition[],
  random = Math.random
): TeamSpawnPosition {
  const rawIndex = Math.floor(random() * spawnPoints.length);
  const index = Math.max(0, Math.min(spawnPoints.length - 1, rawIndex));
  const spawn = spawnPoints[index] ?? DEFAULT_TEAM_SPAWN_POSITION;
  return {
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
  };
}

export function resolveTeamSpawnPlacement(input: {
  manifest: TeamSpawnManifest;
  team?: string | null;
  spawn?: TeamSpawnPosition;
  random?: () => number;
}): TeamSpawnPlacement {
  const team = isSpawnTeam(input.team) ? input.team : 'red';
  const position = input.spawn
    ? {
      x: input.spawn.x,
      y: input.spawn.y,
      z: input.spawn.z,
    }
    : pickTeamSpawnPoint(getTeamSpawnPoints(input.manifest, team), input.random);

  return {
    position,
    lookYaw: getTeamSpawnLookYaw(input.manifest, team),
    lookPitch: 0,
  };
}

export function createRandomTeamSpawnOffsets(
  spawnPointCounts: Record<Team, number>,
  random = Math.random
): Record<Team, number> {
  return {
    red: Math.floor(random() * spawnPointCounts.red),
    blue: Math.floor(random() * spawnPointCounts.blue),
  };
}

export function createTeamSpawnPlan(input: {
  manifest: TeamSpawnManifest;
  players: Iterable<readonly [string, TeamSpawnParticipantSource]>;
  random?: () => number;
}): TeamSpawnPlan {
  const spawnPointsByTeam: Record<Team, readonly TeamSpawnPosition[]> = {
    red: getTeamSpawnPoints(input.manifest, 'red'),
    blue: getTeamSpawnPoints(input.manifest, 'blue'),
  };
  const spawnPointCounts: Record<Team, number> = {
    red: spawnPointsByTeam.red.length,
    blue: spawnPointsByTeam.blue.length,
  };

  return {
    spawnPointsByTeam,
    assignments: createTeamSpawnAssignments(
      collectTeamSpawnParticipants(input.players),
      spawnPointCounts,
      createRandomTeamSpawnOffsets(spawnPointCounts, input.random)
    ),
  };
}

export function resolveTeamSpawnAssignmentPosition(input: {
  spawnPointsByTeam: Record<Team, readonly TeamSpawnPosition[]>;
  assignment: TeamSpawnAssignment;
  random?: () => number;
}): TeamSpawnPosition {
  const spawn = input.spawnPointsByTeam[input.assignment.team][input.assignment.spawnIndex];
  if (spawn) {
    return {
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
    };
  }

  return pickTeamSpawnPoint(input.spawnPointsByTeam[input.assignment.team], input.random);
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
