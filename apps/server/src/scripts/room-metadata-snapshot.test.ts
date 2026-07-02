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
      matchPerspective: 'first_person',
      mapSeed: 12345,
      mapThemeId: 'verdant',
      mapSize: 'standard',
      mapProfileId: 'ctf_arena',
      counts: {
        humanCount: 2,
        combatHumanCount: 1,
        regularObserverCount: 1,
        botCount: 3,
        npcCount: 5,
        participantCount: 6,
        entityCount: 11,
      },
      maxPlayers: 8,
      mapRenderableChunkCount: 34,
      mapColliderCount: 56,
      mapSolidBlockCount: 78,
      reservedHumanPlayers: 2,
      capacityPlayerCost: 2,
      streamerObserverCount: 1,
      streamerManagedBotGame: true,
      streamerManagedByUserId: 'admin-user',
      streamerFeedMode: 'bot_deathmatch',
      streamerCameraMode: 'fixed_aerial',
      streamerMapRotationStartedAt: 1_000_000,
      endlessMatch: true,
      rankedEligibilityCandidate: true,
      rankedRequiredHumanPlayers: 4,
      reconnectIdentityKeys: ['auth:a', 'auth:b'],
      load,
    }),
    {
      name: 'Ranked Alpha',
      status: 'playing',
      phase: 'playing',
      lobbyId: 'lobby-1',
      matchMode: 'ranked',
      gameplayMode: 'ctf',
      matchPerspective: 'first_person',
      mapSeed: 12345,
      mapThemeId: 'verdant',
      mapSize: 'standard',
      mapProfileId: 'ctf_arena',
      humanCount: 2,
      combatHumanCount: 1,
      regularObserverCount: 1,
      streamerObserverCount: 1,
      streamerManagedBotGame: true,
      streamerManagedByUserId: 'admin-user',
      streamerFeedMode: 'bot_deathmatch',
      streamerCameraMode: 'fixed_aerial',
      streamerMapRotationStartedAt: 1_000_000,
      endlessMatch: true,
      botCount: 3,
      npcCount: 5,
      participantCount: 6,
      entityCount: 11,
      maxPlayers: 8,
      mapRenderableChunkCount: 34,
      mapColliderCount: 56,
      mapSolidBlockCount: 78,
      reservedHumanPlayers: 2,
      capacityPlayerCost: 2,
      playerCap: 8,
      rankedEligibleCandidate: true,
      rankedRequiredHumanPlayers: 4,
      reconnectIdentityKeys: ['auth:a', 'auth:b'],
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
    matchPerspective: 'first_person',
    mapSeed: 67890,
    mapThemeId: 'desert',
    mapSize: 'small',
    counts: {
      humanCount: 0,
      combatHumanCount: 0,
      regularObserverCount: 0,
      botCount: 0,
      npcCount: 0,
      participantCount: 0,
      entityCount: 0,
    },
    maxPlayers: 6,
    reservedHumanPlayers: 0,
    streamerObserverCount: 0,
    rankedEligibilityCandidate: false,
    rankedRequiredHumanPlayers: 6,
    reconnectIdentityKeys: [],
    load,
  });

  assert.equal(metadata.name, 'Game roomab');
  assert.equal(metadata.lobbyId, undefined);
  assert.equal(metadata.mapProfileId, 'ctf_arena');
  assert.equal(metadata.capacityPlayerCost, 0);
  assert.equal(metadata.endlessMatch, false);
}

{
  const metadata = buildGameRoomMetadata({
    roomId: 'battleabcdef',
    lobbyName: 'Battle Test',
    phase: 'playing',
    lobbyId: 'lobby-br',
    matchMode: 'custom',
    gameplayMode: 'battle_royal',
    matchPerspective: 'third_person',
    mapSeed: 0x51f15eed,
    mapThemeId: 'verdant',
    mapSize: 'large',
    mapProfileId: 'battle_royal_large',
    counts: {
      humanCount: 12,
      combatHumanCount: 12,
      regularObserverCount: 0,
      botCount: 0,
      npcCount: 0,
      participantCount: 12,
      entityCount: 12,
    },
    maxPlayers: 33,
    mapRenderableChunkCount: 3000,
    mapColliderCount: 80000,
    mapSolidBlockCount: 2200000,
    reservedHumanPlayers: 12,
    capacityPlayerCost: 50,
    streamerObserverCount: 0,
    rankedEligibilityCandidate: false,
    rankedRequiredHumanPlayers: 12,
    reconnectIdentityKeys: [],
    load,
  });

  assert.equal(metadata.gameplayMode, 'battle_royal');
  assert.equal(metadata.mapProfileId, 'battle_royal_large');
  assert.equal(metadata.playerCap, 33);
  assert.equal(metadata.capacityPlayerCost, 50);
  assert.equal(metadata.mapRenderableChunkCount, 3000);
  assert.equal(metadata.mapColliderCount, 80000);
  assert.equal(metadata.mapSolidBlockCount, 2200000);
}

console.log('room metadata snapshot tests passed');
