import {
  countCombatTeamMembers,
  countCombatTeamMembersExcluding,
  type CombatTeamMember,
} from './spawnAssignments';
import {
  ARENA_TEAM_IDS,
  DEFAULT_GAME_CONFIG,
  assignTeamByCapacity,
  isTeamId,
  type Team,
} from '@voxel-strike/shared';

export type RoomTeamSelectionBlockedReason = 'team_full' | 'team_imbalanced';

export interface RoomTeamSelectionDecision {
  canSelect: boolean;
  requestedTeamCount: number;
  opposingTeamCount: number;
  blockedReason: RoomTeamSelectionBlockedReason | null;
}

export function getRoomAutoAssignedTeam(input: {
  players: Iterable<CombatTeamMember>;
  teamIds?: readonly Team[];
  maxTeamSize?: number;
  preferredTeam?: Team | null;
}): Team {
  const teamIds = input.teamIds ?? ARENA_TEAM_IDS;
  const players = Array.from(input.players);
  let preferredTeam = input.preferredTeam;
  if (!input.teamIds && (preferredTeam === 'red' || preferredTeam === 'blue')) {
    const redCount = countCombatTeamMembers(players, 'red');
    const blueCount = countCombatTeamMembers(players, 'blue');
    const preferredCount = preferredTeam === 'red' ? redCount : blueCount;
    const otherCount = preferredTeam === 'red' ? blueCount : redCount;
    if (preferredCount > otherCount) preferredTeam = null;
  }

  return assignTeamByCapacity({
    players,
    teamIds,
    maxTeamSize: input.maxTeamSize ?? DEFAULT_GAME_CONFIG.teamSize,
    preferredTeam,
  });
}

export function resolveRoomJoinTeam(input: {
  players: Iterable<CombatTeamMember>;
  teamIds?: readonly Team[];
  maxTeamSize?: number;
  assignedTeam?: Team | null;
  preferredTeam?: unknown;
}): Team {
  if (input.assignedTeam) return input.assignedTeam;
  const teamIds = input.teamIds ?? ARENA_TEAM_IDS;
  return getRoomAutoAssignedTeam({
    players: input.players,
    teamIds,
    maxTeamSize: input.maxTeamSize ?? DEFAULT_GAME_CONFIG.teamSize,
    preferredTeam: isTeamId(input.preferredTeam) && teamIds.includes(input.preferredTeam)
      ? input.preferredTeam
      : undefined,
  });
}

export function getRoomTeamSelectionDecision(input: {
  players: Iterable<readonly [string, CombatTeamMember]>;
  playerId: string;
  requestedTeam: Team;
  teamSize: number;
  teamIds?: readonly Team[];
}): RoomTeamSelectionDecision {
  const players = Array.from(input.players);
  const teamIds = input.teamIds ?? ['red', 'blue'];
  const requestedTeamCount = countCombatTeamMembersExcluding(
    players,
    input.requestedTeam,
    input.playerId
  );
  const opposingTeam = teamIds.length === 2 && input.requestedTeam !== teamIds[0]
    ? teamIds[0]
    : teamIds.length === 2
      ? teamIds[1]
      : null;
  const opposingTeamCount = opposingTeam
    ? countCombatTeamMembersExcluding(players, opposingTeam, input.playerId)
    : 0;

  if (requestedTeamCount >= input.teamSize) {
    return {
      canSelect: false,
      requestedTeamCount,
      opposingTeamCount,
      blockedReason: 'team_full',
    };
  }

  if (teamIds.length === 2 && requestedTeamCount > opposingTeamCount) {
    return {
      canSelect: false,
      requestedTeamCount,
      opposingTeamCount,
      blockedReason: 'team_imbalanced',
    };
  }

  return {
    canSelect: true,
    requestedTeamCount,
    opposingTeamCount,
    blockedReason: null,
  };
}
