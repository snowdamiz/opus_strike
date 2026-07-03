import type { GameplayMode } from './gameplayMode.js';

export type Team = string;

export interface TeamCatalogEntry {
  id: Team;
  label: string;
  compactLabel: string;
  color: string;
  accentColor: string;
  modeIds: readonly GameplayMode[];
}

export const ARENA_TEAM_IDS = ['red', 'blue'] as const;

export const BATTLE_ROYAL_TEAM_IDS = [
  'br_01',
  'br_02',
  'br_03',
  'br_04',
  'br_05',
  'br_06',
  'br_07',
  'br_08',
  'br_09',
] as const;

export const TEAM_CATALOG = [
  {
    id: 'red',
    label: 'Red Team',
    compactLabel: 'RED',
    color: '#ef4444',
    accentColor: '#fecaca',
    modeIds: ['capture_the_flag', 'team_deathmatch'],
  },
  {
    id: 'blue',
    label: 'Blue Team',
    compactLabel: 'BLU',
    color: '#3b82f6',
    accentColor: '#bfdbfe',
    modeIds: ['capture_the_flag', 'team_deathmatch'],
  },
  {
    id: 'br_01',
    label: 'Alpha Team',
    compactLabel: 'A1',
    color: '#f97316',
    accentColor: '#fed7aa',
    modeIds: ['battle_royal'],
  },
  {
    id: 'br_02',
    label: 'Bravo Team',
    compactLabel: 'B2',
    color: '#22c55e',
    accentColor: '#bbf7d0',
    modeIds: ['battle_royal'],
  },
  {
    id: 'br_03',
    label: 'Charlie Team',
    compactLabel: 'C3',
    color: '#06b6d4',
    accentColor: '#a5f3fc',
    modeIds: ['battle_royal'],
  },
  {
    id: 'br_04',
    label: 'Delta Team',
    compactLabel: 'D4',
    color: '#a855f7',
    accentColor: '#e9d5ff',
    modeIds: ['battle_royal'],
  },
  {
    id: 'br_05',
    label: 'Echo Team',
    compactLabel: 'E5',
    color: '#eab308',
    accentColor: '#fef08a',
    modeIds: ['battle_royal'],
  },
  {
    id: 'br_06',
    label: 'Foxtrot Team',
    compactLabel: 'F6',
    color: '#14b8a6',
    accentColor: '#99f6e4',
    modeIds: ['battle_royal'],
  },
  {
    id: 'br_07',
    label: 'Ghost Team',
    compactLabel: 'G7',
    color: '#f43f5e',
    accentColor: '#fecdd3',
    modeIds: ['battle_royal'],
  },
  {
    id: 'br_08',
    label: 'Havoc Team',
    compactLabel: 'H8',
    color: '#84cc16',
    accentColor: '#d9f99d',
    modeIds: ['battle_royal'],
  },
  {
    id: 'br_09',
    label: 'Ion Team',
    compactLabel: 'I9',
    color: '#0ea5e9',
    accentColor: '#bae6fd',
    modeIds: ['battle_royal'],
  },
] as const satisfies readonly TeamCatalogEntry[];

const TEAM_CATALOG_BY_ID = new Map<Team, TeamCatalogEntry>(
  TEAM_CATALOG.map((team) => [team.id, team])
);

export interface TeamMemberLike {
  id?: string;
  team?: string | null;
}

export function getTeamCatalogEntry(team: string | null | undefined): TeamCatalogEntry | null {
  return team ? TEAM_CATALOG_BY_ID.get(team) ?? null : null;
}

export function isTeamId(value: unknown): value is Team {
  return typeof value === 'string' && TEAM_CATALOG_BY_ID.has(value);
}

export function getTeamCatalogForGameplayMode(mode: GameplayMode): readonly TeamCatalogEntry[] {
  return TEAM_CATALOG.filter((team) => (team.modeIds as readonly GameplayMode[]).includes(mode));
}

export function getTeamIdsForGameplayMode(mode: GameplayMode): readonly Team[] {
  return getTeamCatalogForGameplayMode(mode).map((team) => team.id);
}

export function isTeamIdForGameplayMode(value: unknown, mode: GameplayMode): value is Team {
  return isTeamId(value) && (getTeamCatalogEntry(value)?.modeIds as readonly GameplayMode[] | undefined)?.includes(mode) === true;
}

export function createTeamCountMap(teamIds: readonly Team[] = TEAM_CATALOG.map((team) => team.id)): Record<Team, number> {
  const counts: Record<Team, number> = {};
  for (const teamId of teamIds) {
    counts[teamId] = 0;
  }
  return counts;
}

export function countTeamMembers(
  players: Iterable<TeamMemberLike>,
  team: Team
): number {
  let count = 0;
  for (const player of players) {
    if (player.team === team) count++;
  }
  return count;
}

export function countTeamMembersExcluding(
  players: Iterable<readonly [string, TeamMemberLike]>,
  team: Team,
  excludedPlayerId: string
): number {
  let count = 0;
  for (const [playerId, player] of players) {
    if (playerId !== excludedPlayerId && player.team === team) {
      count++;
    }
  }
  return count;
}

export function countTeamMembersByTeam(
  players: Iterable<TeamMemberLike>,
  teamIds: readonly Team[]
): Record<Team, number> {
  const counts = createTeamCountMap(teamIds);
  const allowedTeamIds = new Set(teamIds);
  for (const player of players) {
    if (!player.team || !allowedTeamIds.has(player.team)) continue;
    counts[player.team] = (counts[player.team] ?? 0) + 1;
  }
  return counts;
}

export function assignTeamByCapacity(input: {
  players: Iterable<TeamMemberLike>;
  teamIds: readonly Team[];
  maxTeamSize: number;
  preferredTeam?: Team | null;
}): Team {
  const counts = countTeamMembersByTeam(input.players, input.teamIds);
  const preferredTeam = input.preferredTeam && input.teamIds.includes(input.preferredTeam)
    ? input.preferredTeam
    : null;

  if (preferredTeam && (counts[preferredTeam] ?? 0) < input.maxTeamSize) {
    return preferredTeam;
  }

  const availableTeams = input.teamIds.filter((teamId) => (counts[teamId] ?? 0) < input.maxTeamSize);
  const candidates = availableTeams.length > 0 ? availableTeams : input.teamIds;
  if (candidates.length === 0) {
    return 'red';
  }
  let selected = candidates[0];
  let selectedCount = counts[selected] ?? 0;

  for (const teamId of candidates.slice(1)) {
    const count = counts[teamId] ?? 0;
    if (count < selectedCount) {
      selected = teamId;
      selectedCount = count;
    }
  }

  return selected;
}
