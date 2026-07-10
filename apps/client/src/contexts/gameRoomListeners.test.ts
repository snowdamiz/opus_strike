import assert from 'node:assert/strict';
import type { GameEndEvent } from '@voxel-strike/shared';
import { shouldPreserveMatchSummaryAfterRoomLeave } from './gameRoomListeners';

const matchSummary = {} as GameEndEvent;

assert.equal(shouldPreserveMatchSummaryAfterRoomLeave({
  gamePhase: 'game_end',
  matchSummary,
}), true);

assert.equal(shouldPreserveMatchSummaryAfterRoomLeave({
  gamePhase: 'game_end',
  matchSummary: null,
}), false);

assert.equal(shouldPreserveMatchSummaryAfterRoomLeave({
  gamePhase: 'playing',
  matchSummary,
}), false);

console.log('game room listeners tests passed');
