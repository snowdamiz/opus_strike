import assert from 'node:assert/strict';
import { getGameplayModeRules } from '@voxel-strike/shared';
import {
  createStreamerBotAssignments,
  clearStreamerSessionsForTests,
  getNextStreamerTarget,
  getStreamerRoomMetadata,
  isEligibleRealPlayerStreamerRoom,
  isUsableBotDeathmatchStreamerRoom,
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
  createdOptions: StreamerGameRoomCreateOptions[] = [];

  constructor(private rooms: StreamerRoomListing[]) {}

  async query() {
    return this.rooms;
  }

  async createRoom(_name: 'game_room', options: StreamerGameRoomCreateOptions) {
    this.createdOptions.push(options);
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
      streamerFeedMode: options.streamerFeedMode,
      streamerCameraMode: options.streamerCameraMode,
      endlessMatch: options.endlessMatch,
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
  streamerFeedMode: 'random',
});

const botDeathmatchRoom = room('bot-deathmatch-a', {
  phase: 'playing',
  combatHumanCount: 0,
  streamerObserverCount: 0,
  streamerManagedBotGame: true,
  streamerFeedMode: 'bot_deathmatch',
  streamerCameraMode: 'fixed_aerial',
});

assert.equal(isEligibleRealPlayerStreamerRoom(liveRoom), true);
assert.equal(isEligibleRealPlayerStreamerRoom(observerOnlyRoom), false);
assert.equal(isEligibleRealPlayerStreamerRoom(fallbackRoom), false);
assert.equal(isUsableFallbackStreamerRoom(fallbackRoom), true);
assert.equal(isUsableFallbackStreamerRoom(botDeathmatchRoom), false);
assert.equal(isUsableBotDeathmatchStreamerRoom(botDeathmatchRoom), true);

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

const randomSelectionIgnoresBotDeathmatch = selectStreamerTargetRoom({
  rooms: [botDeathmatchRoom, observerOnlyRoom],
  random: () => 0,
});

assert.equal(randomSelectionIgnoresBotDeathmatch, null);

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
assert.equal(metadata.streamerFeedMode, 'random');
assert.equal(metadata.streamerCameraMode, 'directed');

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
  assert.equal(typeof target.streamerObserverTicket, 'string');

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

  clearStreamerSessionsForTests();
  const botDeathmatchMatchMaker = new FakeStreamerMatchMaker([]);
  const botDeathmatchTarget = await getNextStreamerTarget({
    adminUserId: 'admin-a',
    matchMaker: botDeathmatchMatchMaker,
    currentRoomId: null,
    feedMode: 'bot_deathmatch',
    random: () => 0,
  });

  assert.equal(botDeathmatchTarget.source, 'bot_deathmatch');
  assert.equal(botDeathmatchTarget.metadata.gameplayMode, 'team_deathmatch');
  assert.equal(botDeathmatchTarget.metadata.streamerFeedMode, 'bot_deathmatch');
  assert.equal(botDeathmatchTarget.metadata.streamerCameraMode, 'fixed_aerial');
  assert.equal(botDeathmatchMatchMaker.createdOptions.length, 1);
  const botDeathmatchOptions = botDeathmatchMatchMaker.createdOptions[0];
  assert.ok(botDeathmatchOptions);
  assert.equal(botDeathmatchOptions.gameplayMode, 'team_deathmatch');
  assert.equal(botDeathmatchOptions.endlessMatch, true);
  assert.equal(botDeathmatchOptions.streamerFeedMode, 'bot_deathmatch');
  assert.equal(botDeathmatchOptions.streamerCameraMode, 'fixed_aerial');
  assert.equal(botDeathmatchOptions.botAssignments.length, getGameplayModeRules('team_deathmatch').maxPlayers);
  assert.equal(botDeathmatchOptions.botAssignments.filter((assignment) => assignment.team === 'red').length, 4);
  assert.equal(botDeathmatchOptions.botAssignments.filter((assignment) => assignment.team === 'blue').length, 4);

  const reusedBotDeathmatchTarget = await getNextStreamerTarget({
    adminUserId: 'admin-a',
    matchMaker: botDeathmatchMatchMaker,
    currentRoomId: botDeathmatchTarget.roomId,
    feedMode: 'bot_deathmatch',
    random: () => 0,
  });

  assert.equal(reusedBotDeathmatchTarget.roomId, botDeathmatchTarget.roomId);
  assert.equal(reusedBotDeathmatchTarget.seatReservation, undefined);
  assert.equal(botDeathmatchMatchMaker.createdOptions.length, 1);
}

runAsyncTests().then(() => {
  console.log('streamer service tests passed');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
