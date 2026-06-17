import assert from 'node:assert/strict';
import {
  getOpposingTeam,
  getRoomAutoAssignedTeam,
  getRoomTeamSelectionDecision,
  resolveRoomJoinTeam,
} from '../rooms/roomTeamSelection';
import type { CombatTeamMember } from '../rooms/spawnAssignments';

assert.equal(getOpposingTeam('red'), 'blue');
assert.equal(getOpposingTeam('blue'), 'red');

const players = new Map<string, CombatTeamMember>([
  ['red-a', { team: 'red' }],
  ['red-b', { team: 'red' }],
  ['blue-a', { team: 'blue' }],
  ['red-observer', { team: 'red', isObserver: true }],
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
