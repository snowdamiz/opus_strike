import assert from 'node:assert/strict';
import { getGameplayModeRules } from '@voxel-strike/shared';
import {
  createStreamerBotAssignments,
  getStreamerRoomMetadata,
  isEligibleRealPlayerStreamerRoom,
  isUsableFallbackStreamerRoom,
  selectStreamerTargetRoom,
  type StreamerRoomListing,
} from '../streamer/service';

function room(roomId: string, metadata: Record<string, unknown>, locked = false): StreamerRoomListing {
  return { roomId, locked, metadata };
}

const liveRoom = room('live-a', {
  phase: 'playing',
  gameplayMode: 'capture_the_flag',
  matchPerspective: 'first_person',
  combatHumanCount: 2,
  regularObserverCount: 1,
  streamerObserverCount: 0,
  streamerManagedBotGame: false,
});

const observerOnlyRoom = room('observer-only', {
  phase: 'playing',
  humanCount: 2,
  combatHumanCount: 0,
  regularObserverCount: 2,
  streamerObserverCount: 0,
});

const fallbackRoom = room('fallback-a', {
  phase: 'playing',
  combatHumanCount: 0,
  streamerObserverCount: 0,
  streamerManagedBotGame: true,
});

assert.equal(isEligibleRealPlayerStreamerRoom(liveRoom), true);
assert.equal(isEligibleRealPlayerStreamerRoom(observerOnlyRoom), false);
assert.equal(isEligibleRealPlayerStreamerRoom(fallbackRoom), false);
assert.equal(isUsableFallbackStreamerRoom(fallbackRoom), true);

const selectedReal = selectStreamerTargetRoom({
  rooms: [fallbackRoom, liveRoom],
  random: () => 0,
});

assert.equal(selectedReal?.room.roomId, 'live-a');
assert.equal(selectedReal?.source, 'real_player');

const selectedFallback = selectStreamerTargetRoom({
  rooms: [fallbackRoom, observerOnlyRoom],
  random: () => 0,
});

assert.equal(selectedFallback?.room.roomId, 'fallback-a');
assert.equal(selectedFallback?.source, 'fallback_bot');

assert.equal(
  selectStreamerTargetRoom({
    rooms: [
      room('full-streamer-seats', {
        phase: 'playing',
        combatHumanCount: 2,
        streamerObserverCount: 2,
      }),
    ],
    random: () => 0,
  }),
  null
);

const metadata = getStreamerRoomMetadata(liveRoom);
assert.equal(metadata.combatHumanCount, 2);
assert.equal(metadata.regularObserverCount, 1);
assert.equal(metadata.streamerManagedBotGame, false);

const botAssignments = createStreamerBotAssignments({
  gameplayMode: 'capture_the_flag',
  seed: 123,
});
const rules = getGameplayModeRules('capture_the_flag');
assert.equal(botAssignments.length, rules.maxPlayers);
assert.equal(new Set(botAssignments.map((assignment) => assignment.playerId)).size, botAssignments.length);
assert.ok(botAssignments.every((assignment) => assignment.isBot));
assert.ok(botAssignments.every((assignment) => assignment.heroId && assignment.skinId));

console.log('streamer service tests passed');
