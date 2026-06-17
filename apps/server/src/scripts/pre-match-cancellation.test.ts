import assert from 'node:assert/strict';
import {
  buildMatchCancelledPayload,
  buildPreMatchCancelNotice,
  canCancelPreMatch,
  createStartTimeoutCancelNotice,
} from '../rooms/preMatchCancellation';

{
  assert.deepEqual(createStartTimeoutCancelNotice(), {
    reason: 'start_timeout',
    message: 'Match canceled because all players did not connect and load in time.',
  });
}

{
  assert.equal(canCancelPreMatch({ matchCancelled: false, phase: 'waiting' }), true);
  assert.equal(canCancelPreMatch({ matchCancelled: false, phase: 'hero_select' }), true);
  assert.equal(canCancelPreMatch({ matchCancelled: false, phase: 'countdown' }), true);
  assert.equal(canCancelPreMatch({ matchCancelled: false, phase: 'playing' }), false);
  assert.equal(canCancelPreMatch({ matchCancelled: true, phase: 'waiting' }), false);
}

{
  assert.deepEqual(buildPreMatchCancelNotice('start_timeout'), {
    reason: 'start_timeout',
    message: 'Match canceled because all players did not connect and load in time.',
  });
  assert.deepEqual(buildPreMatchCancelNotice('network_quality', {
    message: 'Network quality failed',
    blockedPlayerId: 'player-a',
  }), {
    reason: 'network_quality',
    message: 'Network quality failed',
    blockedPlayerId: 'player-a',
  });
}

{
  assert.deepEqual(
    buildMatchCancelledPayload({
      notice: createStartTimeoutCancelNotice(),
      roomId: 'room-1',
      requiredHumanPlayers: 4,
      connectedHumanPlayers: 3,
      deadlineAt: 10_000,
      refundedWager: true,
      serverTime: 12_345,
    }),
    {
      reason: 'start_timeout',
      message: 'Match canceled because all players did not connect and load in time.',
      roomId: 'room-1',
      requiredHumanPlayers: 4,
      connectedHumanPlayers: 3,
      deadlineAt: 10_000,
      refundedWager: true,
      serverTime: 12_345,
      blockedPlayerId: undefined,
      blockedPlayerName: undefined,
      networkQuality: undefined,
    }
  );
}

{
  const networkQuality = {
    reason: 'average_ping_high',
    averagePingMs: 220,
    peakPingMs: 260,
  };

  assert.deepEqual(
    buildMatchCancelledPayload({
      notice: {
        reason: 'network_quality',
        message: "Match canceled because Red's connection is not stable enough for ranked or wager play.",
        blockedPlayerId: 'red-player',
        blockedPlayerName: 'Red',
        networkQuality,
      },
      roomId: 'room-2',
      requiredHumanPlayers: 2,
      connectedHumanPlayers: 2,
      deadlineAt: 20_000,
      refundedWager: false,
      serverTime: 22_222,
    }),
    {
      reason: 'network_quality',
      message: "Match canceled because Red's connection is not stable enough for ranked or wager play.",
      roomId: 'room-2',
      requiredHumanPlayers: 2,
      connectedHumanPlayers: 2,
      deadlineAt: 20_000,
      refundedWager: false,
      serverTime: 22_222,
      blockedPlayerId: 'red-player',
      blockedPlayerName: 'Red',
      networkQuality,
    }
  );
}

console.log('pre-match cancellation tests passed');
