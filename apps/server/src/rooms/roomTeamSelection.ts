import type { Team } from '@voxel-strike/shared';
import {
  assignBalancedTeam,
  countCombatTeamMembers,
  countCombatTeamMembersExcluding,
  type CombatTeamMember,
} from './spawnAssignments';

export type RoomTeamSelectionBlockedReason = 'team_full' | 'team_imbalanced';

export interface RoomTeamSelectionDecision {
  canSelect: boolean;
  requestedTeamCount: number;
  opposingTeamCount: number;
  blockedReason: RoomTeamSelectionBlockedReason | null;
}

export function getOpposingTeam(team: Team): Team {
  return team === 'red' ? 'blue' : 'red';
}

function isTeam(value: unknown): value is Team {
  return value === 'red' || value === 'blue';
}

export function getRoomAutoAssignedTeam(input: {
  players: Iterable<CombatTeamMember>;
  preferredTeam?: Team | null;
}): Team {
  return assignBalancedTeam({
    redCount: countCombatTeamMembers(input.players, 'red'),
    blueCount: countCombatTeamMembers(input.players, 'blue'),
    preferredTeam: input.preferredTeam,
  });
}

export function resolveRoomJoinTeam(input: {
  players: Iterable<CombatTeamMember>;
  assignedTeam?: Team | null;
  preferredTeam?: unknown;
}): Team {
  if (input.assignedTeam) return input.assignedTeam;
  return getRoomAutoAssignedTeam({
    players: input.players,
    preferredTeam: isTeam(input.preferredTeam) ? input.preferredTeam : undefined,
  });
}

export function getRoomTeamSelectionDecision(input: {
  players: Iterable<readonly [string, CombatTeamMember]>;
  playerId: string;
  requestedTeam: Team;
  teamSize: number;
}): RoomTeamSelectionDecision {
  const players = Array.from(input.players);
  const requestedTeamCount = countCombatTeamMembersExcluding(
    players,
    input.requestedTeam,
    input.playerId
  );
  const opposingTeamCount = countCombatTeamMembersExcluding(
    players,
    getOpposingTeam(input.requestedTeam),
    input.playerId
  );

  if (requestedTeamCount >= input.teamSize) {
    return {
      canSelect: false,
      requestedTeamCount,
      opposingTeamCount,
      blockedReason: 'team_full',
    };
  }

  if (requestedTeamCount > opposingTeamCount) {
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
