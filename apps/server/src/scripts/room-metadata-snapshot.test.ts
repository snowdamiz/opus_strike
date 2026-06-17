import assert from 'node:assert/strict';
import { buildGameRoomMetadata } from '../rooms/roomMetadataSnapshot';
import type { RoomLoadSnapshot } from '../rooms/roomLoadSnapshot';

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
  antiCheatQueueDepth: 17,
  antiCheatDroppedLowMediumSignals: 18,
  antiCheatDbErrors: 19,
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
      antiCheatQueueDepth: 17,
      antiCheatDroppedLowMediumSignals: 18,
      antiCheatDbErrors: 19,
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
