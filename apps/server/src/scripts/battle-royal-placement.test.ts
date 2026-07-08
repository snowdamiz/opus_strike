import assert from 'node:assert/strict';
import type { Team } from '@voxel-strike/shared';
import { BattleRoyalPlacementTracker } from '../rooms/battleRoyalPlacement';
import type { MatchParticipantSnapshot } from '../persistence/matchPersistence';

function participant(userId: string, team: Team): MatchParticipantSnapshot {
  return {
    userId,
    playerSessionId: `${userId}-session`,
    displayName: userId,
    team,
    heroId: null,
    joinedAt: new Date(0),
    leftAt: null,
    kills: 0,
    deaths: 0,
    assists: 0,
    flagCaptures: 0,
    flagReturns: 0,
  };
}

{
  const tracker = new BattleRoyalPlacementTracker();
  tracker.initialize([
    { team: 'br_01', state: 'alive' },
    { team: 'br_02', state: 'downed' },
    { team: 'br_03', state: 'alive' },
  ], 1000);

  const firstUpdate = tracker.update([
    { team: 'br_01', state: 'alive' },
    { team: 'br_02', state: 'downed' },
    { team: 'br_03', state: 'dead' },
  ], 2000);
  assert.deepEqual(firstUpdate.newlyPlacedTeams, ['br_03']);
  assert.deepEqual(firstUpdate.reactivatedTeams, []);
  assert.equal(tracker.hasTeamPlacement('br_03'), true);
  assert.equal(tracker.getTeamPlacement('br_03')?.placement, 3);

  let snapshots = tracker.enrichParticipantSnapshots([
    participant('user-1', 'br_01'),
    participant('user-2', 'br_02'),
    participant('user-3', 'br_03'),
  ]);
  assert.equal(snapshots.find((snapshot) => snapshot.team === 'br_02')?.placement, null);
  assert.equal(snapshots.find((snapshot) => snapshot.team === 'br_03')?.placement, 3);

  const secondUpdate = tracker.update([
    { team: 'br_01', state: 'alive' },
    { team: 'br_02', state: 'dead' },
    { team: 'br_03', state: 'dead' },
  ], 3000);
  assert.deepEqual(secondUpdate.newlyPlacedTeams, ['br_02']);
  assert.deepEqual(secondUpdate.reactivatedTeams, []);
  tracker.finalize([
    { team: 'br_01', state: 'alive' },
    { team: 'br_02', state: 'dead' },
    { team: 'br_03', state: 'dead' },
  ], 'br_01', 4000);

  snapshots = tracker.enrichParticipantSnapshots([
    participant('user-1', 'br_01'),
    participant('user-2', 'br_02'),
    participant('user-3', 'br_03'),
  ]);
  assert.equal(snapshots.find((snapshot) => snapshot.team === 'br_01')?.placement, 1);
  assert.equal(snapshots.find((snapshot) => snapshot.team === 'br_02')?.placement, 2);
  assert.equal(snapshots.find((snapshot) => snapshot.team === 'br_03')?.placement, 3);
  assert.equal(snapshots.every((snapshot) => snapshot.activeTeamCount === 3), true);
  assert.equal(snapshots.find((snapshot) => snapshot.team === 'br_01')?.teamEliminatedAt, null);
  assert.equal(snapshots.find((snapshot) => snapshot.team === 'br_02')?.teamEliminatedAt?.getTime(), 3000);
  assert.equal(snapshots.find((snapshot) => snapshot.team === 'br_03')?.teamEliminatedAt?.getTime(), 2000);
}

{
  const tracker = new BattleRoyalPlacementTracker();
  tracker.initialize([
    { team: 'br_01', state: 'alive' },
    { team: 'br_01', state: 'alive' },
    { team: 'br_02', state: 'alive' },
  ], 1000);

  const partialSquadElimination = tracker.update([
    { team: 'br_01', state: 'dead' },
    { team: 'br_01', state: 'alive' },
    { team: 'br_02', state: 'alive' },
  ], 2000);
  assert.deepEqual(partialSquadElimination.newlyPlacedTeams, []);
  assert.deepEqual(partialSquadElimination.reactivatedTeams, []);
  assert.equal(tracker.hasTeamPlacement('br_01'), false);

  const completedSquadElimination = tracker.update([
    { team: 'br_01', state: 'dead' },
    { team: 'br_01', state: 'dead' },
    { team: 'br_02', state: 'alive' },
  ], 3000);
  assert.deepEqual(completedSquadElimination.newlyPlacedTeams, ['br_01']);
  assert.deepEqual(completedSquadElimination.reactivatedTeams, []);
  assert.equal(tracker.getTeamPlacement('br_01')?.placement, 2);
}

{
  const tracker = new BattleRoyalPlacementTracker();
  tracker.initialize([
    { team: 'br_01', state: 'alive' },
    { team: 'br_02', state: 'alive' },
    { team: 'br_03', state: 'alive' },
  ], 1000);

  const simultaneousEliminations = tracker.update([
    { team: 'br_01', state: 'dead' },
    { team: 'br_02', state: 'dead' },
    { team: 'br_03', state: 'alive' },
  ], 2000);

  assert.deepEqual(simultaneousEliminations.newlyPlacedTeams, ['br_01', 'br_02']);
  assert.deepEqual(simultaneousEliminations.reactivatedTeams, []);
  assert.equal(tracker.getTeamPlacement('br_01')?.placement, 2);
  assert.equal(tracker.getTeamPlacement('br_02')?.placement, 2);
  assert.equal(tracker.getTeamPlacement('br_01')?.eliminatedAt?.getTime(), 2000);
  assert.equal(tracker.getTeamPlacement('br_02')?.eliminatedAt?.getTime(), 2000);
  assert.equal(tracker.getTeamPlacement('br_03'), null);
}

{
  const tracker = new BattleRoyalPlacementTracker();
  tracker.initialize([
    { team: 'br_01', state: 'alive' },
    { team: 'br_02', state: 'alive' },
    { team: 'br_03', state: 'alive' },
    { team: 'br_04', state: 'alive' },
  ], 1000);

  tracker.update([
    { team: 'br_01', state: 'alive' },
    { team: 'br_02', state: 'dead' },
    { team: 'br_03', state: 'dead' },
    { team: 'br_04', state: 'dead' },
  ], 2000);

  const reactivated = tracker.update([
    { team: 'br_01', state: 'alive' },
    { team: 'br_02', state: 'dead' },
    { team: 'br_03', state: 'alive' },
    { team: 'br_04', state: 'dead' },
  ], 3000);

  assert.deepEqual(reactivated.newlyPlacedTeams, []);
  assert.deepEqual(reactivated.reactivatedTeams, ['br_03']);
  assert.equal(tracker.getTeamPlacement('br_03'), null);

  const correctedElimination = tracker.update([
    { team: 'br_01', state: 'alive' },
    { team: 'br_02', state: 'dead' },
    { team: 'br_03', state: 'dead' },
    { team: 'br_04', state: 'dead' },
  ], 4000);

  assert.deepEqual(correctedElimination.newlyPlacedTeams, ['br_03']);
  assert.equal(tracker.getTeamPlacement('br_03')?.placement, 2);
}

console.log('battle royal placement tests passed');
