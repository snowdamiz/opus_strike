import assert from 'node:assert/strict';
import {
  getRoomAutoAssignedTeam,
  getRoomTeamSelectionDecision,
  resolveRoomJoinTeam,
} from '../rooms/roomTeamSelection';
import type { CombatTeamMember } from '../rooms/spawnAssignments';

const players = new Map<string, CombatTeamMember>([
  ['red-a', { team: 'red' }],
  ['red-b', { team: 'red' }],
  ['blue-a', { team: 'blue' }],
]);

assert.equal(getRoomAutoAssignedTeam({
  players: players.values(),
}), 'blue');
assert.equal(getRoomAutoAssignedTeam({
  players: players.values(),
  preferredTeam: 'blue',
}), 'blue');
assert.equal(getRoomAutoAssignedTeam({
  players: players.values(),
  preferredTeam: 'red',
}), 'blue');
assert.equal(getRoomAutoAssignedTeam({
  players: [
    { team: 'red' },
    { team: 'blue' },
  ],
  preferredTeam: 'red',
}), 'red');

{
  const battleRoyalPlayers: CombatTeamMember[] = [
    { team: 'br_01' },
    { team: 'br_01' },
    { team: 'br_01' },
    { team: 'br_02' },
    { team: 'br_02' },
  ];
  const teamIds = ['br_01', 'br_02', 'br_03'] as const;

  assert.equal(getRoomAutoAssignedTeam({
    players: battleRoyalPlayers,
    teamIds,
    maxTeamSize: 3,
  }), 'br_03');
  assert.equal(resolveRoomJoinTeam({
    players: battleRoyalPlayers,
    teamIds,
    maxTeamSize: 3,
    preferredTeam: 'br_02',
  }), 'br_02');
  assert.deepEqual(
    getRoomTeamSelectionDecision({
      players: new Map(battleRoyalPlayers.map((player, index) => [`br-player-${index}`, player])),
      playerId: 'new-player',
      requestedTeam: 'br_01',
      teamSize: 3,
      teamIds,
    }),
    {
      canSelect: false,
      requestedTeamCount: 3,
      opposingTeamCount: 0,
      blockedReason: 'team_full',
    }
  );
}

assert.equal(resolveRoomJoinTeam({
  players: players.values(),
  assignedTeam: 'red',
  preferredTeam: 'blue',
}), 'red');
assert.equal(resolveRoomJoinTeam({
  players: players.values(),
  preferredTeam: 'blue',
}), 'blue');
assert.equal(resolveRoomJoinTeam({
  players: players.values(),
  preferredTeam: 'green',
}), 'blue');

assert.deepEqual(
  getRoomTeamSelectionDecision({
    players,
    playerId: 'new-player',
    requestedTeam: 'blue',
    teamSize: 2,
  }),
  {
    canSelect: true,
    requestedTeamCount: 1,
    opposingTeamCount: 2,
    blockedReason: null,
  }
);

assert.deepEqual(
  getRoomTeamSelectionDecision({
    players,
    playerId: 'new-player',
    requestedTeam: 'red',
    teamSize: 2,
  }),
  {
    canSelect: false,
    requestedTeamCount: 2,
    opposingTeamCount: 1,
    blockedReason: 'team_full',
  }
);

assert.deepEqual(
  getRoomTeamSelectionDecision({
    players,
    playerId: 'new-player',
    requestedTeam: 'red',
    teamSize: 3,
  }),
  {
    canSelect: false,
    requestedTeamCount: 2,
    opposingTeamCount: 1,
    blockedReason: 'team_imbalanced',
  }
);

assert.deepEqual(
  getRoomTeamSelectionDecision({
    players,
    playerId: 'red-b',
    requestedTeam: 'red',
    teamSize: 2,
  }),
  {
    canSelect: true,
    requestedTeamCount: 1,
    opposingTeamCount: 1,
    blockedReason: null,
  }
);

console.log('room team selection tests passed');
