import assert from 'node:assert/strict';
import { buildGameRoomMetadata } from '../rooms/roomMetadataSnapshot';
import type { RoomLoadSnapshot } from '../rooms/roomLoadSnapshot';

const tickOperationCounts = {
  bot_los_checks: 29,
  bot_steering_probe_checks: 11,
} as RoomLoadSnapshot['tickOperationCounts'];
const tickOperationCountAvg = {
  bot_los_checks: 2.9,
  bot_steering_probe_checks: 1.1,
} as RoomLoadSnapshot['tickOperationCountAvg'];
const tickOperationCountP95 = {
  bot_los_checks: 19,
  bot_steering_probe_checks: 8,
} as RoomLoadSnapshot['tickOperationCountP95'];
const tickOperationCountP99 = {
  bot_los_checks: 27,
  bot_steering_probe_checks: 10,
} as RoomLoadSnapshot['tickOperationCountP99'];
const tickOperationCountMax = {
  bot_los_checks: 29,
  bot_steering_probe_checks: 11,
} as RoomLoadSnapshot['tickOperationCountMax'];
const tickOperationCountTotal = {
  bot_los_checks: 290,
  bot_steering_probe_checks: 110,
} as RoomLoadSnapshot['tickOperationCountTotal'];

const load: RoomLoadSnapshot = {
  tickDurationP50Ms: 1,
  tickDurationP95Ms: 2,
  tickDurationP99Ms: 3,
  eventLoopDelayP95Ms: 4,
  eventLoopDelayP99Ms: 5,
  customMessageBytes: 6,
  customMessageCount: 7,
  interestRecomputeMs: 8,
  interestLosChecks: 9,
  interestVisibleTargets: 10,
  interestHiddenTargets: 11,
  interestLastKnownTargets: 12,
  streamTransformsBytes: 13,
  streamVitalsBytes: 14,
  streamFilteredTargets: 15,
  streamHiddenTargetLeakCount: 16,
  tickOverrun16Count: 17,
  tickOverrun33Count: 18,
  tickOverrun50Count: 19,
  tickLastP99SpikeSpanName: 'movement_entries_process',
  tickLastP99SpikeSpanMs: 20,
  tickLastP99SpikeDurationMs: 21,
  tickSpanP99Ms: {
    movement_entries_process: 22,
    player_state_stream_fanout: 23,
  },
  tickSpanMaxMs: {
    movement_entries_process: 24,
    player_state_stream_fanout: 25,
  },
  tickOperationCounts,
  tickOperationCountAvg,
  tickOperationCountP95,
  tickOperationCountP99,
  tickOperationCountMax,
  tickOperationCountTotal,
  antiCheatQueueDepth: 26,
  antiCheatDroppedLowMediumSignals: 27,
  antiCheatDbErrors: 28,
};

{
  assert.deepEqual(
    buildGameRoomMetadata({
      roomId: 'roomabcdef',
      lobbyName: 'Ranked Alpha',
      phase: 'playing',
      lobbyId: 'lobby-1',
      matchMode: 'ranked',
      gameplayMode: 'ctf',
      mapSeed: 12345,
      mapThemeId: 'verdant',
      mapSize: 'standard',
      counts: {
        humanCount: 2,
        botCount: 3,
        observerCount: 4,
        npcCount: 5,
        participantCount: 6,
        entityCount: 11,
      },
      maxPlayers: 8,
      reservedHumanPlayers: 2,
      rankedEligibilityCandidate: true,
      rankedRequiredHumanPlayers: 4,
      reconnectIdentityKeys: ['auth:a', 'auth:b'],
      wagerEnabled: true,
      load,
    }),
    {
      name: 'Ranked Alpha',
      status: 'playing',
      phase: 'playing',
      lobbyId: 'lobby-1',
      matchMode: 'ranked',
      gameplayMode: 'ctf',
      mapSeed: 12345,
      mapThemeId: 'verdant',
      mapSize: 'standard',
      humanCount: 2,
      botCount: 3,
      observerCount: 4,
      npcCount: 5,
      participantCount: 6,
      entityCount: 11,
      maxPlayers: 8,
      reservedHumanPlayers: 2,
      rankedEligibleCandidate: true,
      rankedRequiredHumanPlayers: 4,
      reconnectIdentityKeys: ['auth:a', 'auth:b'],
      wagerEnabled: true,
      tickDurationP95Ms: 2,
      tickDurationP99Ms: 3,
      eventLoopDelayP95Ms: 4,
      eventLoopDelayP99Ms: 5,
      customMessageBytes: 6,
      customMessageCount: 7,
      interestRecomputeMs: 8,
      interestLosChecks: 9,
      interestVisibleTargets: 10,
      interestHiddenTargets: 11,
      interestLastKnownTargets: 12,
      streamTransformsBytes: 13,
      streamVitalsBytes: 14,
      streamFilteredTargets: 15,
      streamHiddenTargetLeakCount: 16,
      tickOverrun16Count: 17,
      tickOverrun33Count: 18,
      tickOverrun50Count: 19,
      tickLastP99SpikeSpanName: 'movement_entries_process',
      tickLastP99SpikeSpanMs: 20,
      tickLastP99SpikeDurationMs: 21,
      tickSpanP99Ms: {
        movement_entries_process: 22,
        player_state_stream_fanout: 23,
      },
      tickSpanMaxMs: {
        movement_entries_process: 24,
        player_state_stream_fanout: 25,
      },
      tickOperationCounts,
      tickOperationCountAvg,
      tickOperationCountP95,
      tickOperationCountP99,
      tickOperationCountMax,
      tickOperationCountTotal,
      antiCheatQueueDepth: 26,
      antiCheatDroppedLowMediumSignals: 27,
      antiCheatDbErrors: 28,
    }
  );
}

{
  const metadata = buildGameRoomMetadata({
    roomId: 'roomabcdef',
    lobbyName: '',
    phase: 'waiting',
    lobbyId: null,
    matchMode: 'custom',
    gameplayMode: 'tdm',
    mapSeed: 67890,
    mapThemeId: 'desert',
    mapSize: 'small',
    counts: {
      humanCount: 0,
      botCount: 0,
      observerCount: 0,
      npcCount: 0,
      participantCount: 0,
      entityCount: 0,
    },
    maxPlayers: 6,
    reservedHumanPlayers: 0,
    rankedEligibilityCandidate: false,
    rankedRequiredHumanPlayers: 6,
    reconnectIdentityKeys: [],
    wagerEnabled: false,
    load,
  });

  assert.equal(metadata.name, 'Game roomab');
  assert.equal(metadata.lobbyId, undefined);
}

console.log('room metadata snapshot tests passed');
