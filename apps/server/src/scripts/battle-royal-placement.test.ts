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

  tracker.update([
    { team: 'br_01', state: 'alive' },
    { team: 'br_02', state: 'downed' },
    { team: 'br_03', state: 'dead' },
  ], 2000);

  let snapshots = tracker.enrichParticipantSnapshots([
    participant('user-1', 'br_01'),
    participant('user-2', 'br_02'),
    participant('user-3', 'br_03'),
  ]);
  assert.equal(snapshots.find((snapshot) => snapshot.team === 'br_02')?.placement, null);
  assert.equal(snapshots.find((snapshot) => snapshot.team === 'br_03')?.placement, 3);

  tracker.update([
    { team: 'br_01', state: 'alive' },
    { team: 'br_02', state: 'dead' },
    { team: 'br_03', state: 'dead' },
  ], 3000);
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

console.log('battle royal placement tests passed');
