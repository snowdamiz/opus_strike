import assert from 'node:assert/strict';
import { getGameplayModeRules } from '@voxel-strike/shared';
import {
  createStreamerBotAssignments,
  clearStreamerSessionsForTests,
  getNextStreamerTarget,
  getStreamerRoomMetadata,
  isEligibleRealPlayerStreamerRoom,
  isUsableFallbackStreamerRoom,
  selectStreamerTargetRoom,
  type StreamerGameRoomCreateOptions,
  type StreamerMatchMaker,
  type StreamerObserverSeatOptions,
  type StreamerRoomListing,
} from '../streamer/service';

function room(roomId: string, metadata: Record<string, unknown>, locked = false): StreamerRoomListing {
  return {
    name: 'game_room',
    roomId,
    processId: `process-${roomId}`,
    publicAddress: `${roomId}.example.test`,
    locked,
    metadata,
  };
}

class FakeStreamerMatchMaker implements StreamerMatchMaker {
  reservations: Array<{ roomId: string; options: StreamerObserverSeatOptions }> = [];

  constructor(private rooms: StreamerRoomListing[]) {}

  async query() {
    return this.rooms;
  }

  async createRoom(_name: 'game_room', options: StreamerGameRoomCreateOptions) {
    const created = room(`created-${this.rooms.length + 1}`, {
      phase: 'waiting',
      gameplayMode: options.gameplayMode,
      matchPerspective: options.matchPerspective,
      mapSeed: options.mapSeed,
      mapThemeId: options.mapThemeId,
      mapSize: options.mapSize,
      mapProfileId: options.mapProfileId,
      combatHumanCount: 0,
      streamerObserverCount: 0,
      streamerManagedBotGame: true,
    });
    this.rooms.push(created);
    return created;
  }

  async reserveSeatFor(roomListing: StreamerRoomListing, options: StreamerObserverSeatOptions) {
    this.reservations.push({ roomId: roomListing.roomId, options });
    return {
      sessionId: `seat-${this.reservations.length}`,
      room: {
        name: roomListing.name,
        roomId: roomListing.roomId,
        processId: roomListing.processId,
        publicAddress: roomListing.publicAddress,
      },
    };
  }
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

const selectedCurrentFullRoom = selectStreamerTargetRoom({
  rooms: [
    room('current-full-streamer-seats', {
      phase: 'playing',
      combatHumanCount: 2,
      streamerObserverCount: 2,
    }),
  ],
  currentRoomId: 'current-full-streamer-seats',
  random: () => 0,
});

assert.equal(selectedCurrentFullRoom?.room.roomId, 'current-full-streamer-seats');
assert.equal(selectedCurrentFullRoom?.source, 'real_player');

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

async function runAsyncTests(): Promise<void> {
  clearStreamerSessionsForTests();
  const matchMaker = new FakeStreamerMatchMaker([liveRoom]);
  const target = await getNextStreamerTarget({
    adminUserId: 'admin-a',
    matchMaker,
    currentRoomId: null,
    clientBuildId: 'build-a',
    authToken: 'auth-a',
    random: () => 0,
  });

  assert.equal(target.roomId, 'live-a');
  assert.deepEqual(target.seatReservation, {
    sessionId: 'seat-1',
    room: {
      name: 'game_room',
      roomId: 'live-a',
      processId: 'process-live-a',
      publicAddress: 'live-a.example.test',
    },
  });
  assert.equal(matchMaker.reservations.length, 1);
  assert.equal(matchMaker.reservations[0]?.roomId, 'live-a');
  assert.equal(matchMaker.reservations[0]?.options.clientBuildId, 'build-a');
  assert.equal(matchMaker.reservations[0]?.options.authToken, 'auth-a');
  assert.equal(typeof matchMaker.reservations[0]?.options.streamerObserverTicket, 'string');
  assert.equal('streamerObserverTicket' in (target as unknown as Record<string, unknown>), false);

  clearStreamerSessionsForTests();
  const alreadyWatchingMatchMaker = new FakeStreamerMatchMaker([liveRoom]);
  const alreadyWatchingTarget = await getNextStreamerTarget({
    adminUserId: 'admin-a',
    matchMaker: alreadyWatchingMatchMaker,
    currentRoomId: 'live-a',
    random: () => 0,
  });

  assert.equal(alreadyWatchingTarget.roomId, 'live-a');
  assert.equal(alreadyWatchingTarget.seatReservation, undefined);
  assert.equal(alreadyWatchingMatchMaker.reservations.length, 0);
}

runAsyncTests().then(() => {
  console.log('streamer service tests passed');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
