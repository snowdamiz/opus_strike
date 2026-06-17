import type { RoomLoadSnapshot } from './roomLoadSnapshot';
import type { RoomPopulationCounts } from './roomPopulation';

export interface GameRoomMetadataInput {
  roomId: string;
  lobbyName: string | null;
  phase: string;
  lobbyId: string | null;
  matchMode: string;
  gameplayMode: string;
  mapSeed: number;
  mapThemeId: string;
  mapSize: string;
  counts: RoomPopulationCounts;
  maxPlayers: number;
  reservedHumanPlayers: number;
  rankedEligibilityCandidate: boolean;
  rankedRequiredHumanPlayers: number;
  reconnectIdentityKeys: string[];
  wagerEnabled: boolean;
  load: RoomLoadSnapshot;
}

export function buildGameRoomMetadata(input: GameRoomMetadataInput): Record<string, unknown> {
  const { counts, load } = input;
  return {
    name: input.lobbyName || `Game ${input.roomId.slice(0, 6)}`,
    status: input.phase,
    phase: input.phase,
    lobbyId: input.lobbyId || undefined,
    matchMode: input.matchMode,
    gameplayMode: input.gameplayMode,
    mapSeed: input.mapSeed,
    mapThemeId: input.mapThemeId,
    mapSize: input.mapSize,
    humanCount: counts.humanCount,
    botCount: counts.botCount,
    observerCount: counts.observerCount,
    npcCount: counts.npcCount,
    participantCount: counts.participantCount,
    entityCount: counts.entityCount,
    maxPlayers: input.maxPlayers,
    reservedHumanPlayers: input.reservedHumanPlayers,
    rankedEligibleCandidate: input.rankedEligibilityCandidate,
    rankedRequiredHumanPlayers: input.rankedRequiredHumanPlayers,
    reconnectIdentityKeys: input.reconnectIdentityKeys,
    wagerEnabled: input.wagerEnabled,
    tickDurationP95Ms: load.tickDurationP95Ms,
    tickDurationP99Ms: load.tickDurationP99Ms,
    eventLoopDelayP95Ms: load.eventLoopDelayP95Ms,
    eventLoopDelayP99Ms: load.eventLoopDelayP99Ms,
    customMessageBytes: load.customMessageBytes,
    customMessageCount: load.customMessageCount,
    interestRecomputeMs: load.interestRecomputeMs,
    interestLosChecks: load.interestLosChecks,
    interestVisibleTargets: load.interestVisibleTargets,
    interestHiddenTargets: load.interestHiddenTargets,
    interestLastKnownTargets: load.interestLastKnownTargets,
    streamTransformsBytes: load.streamTransformsBytes,
    streamVitalsBytes: load.streamVitalsBytes,
    streamFilteredTargets: load.streamFilteredTargets,
    streamHiddenTargetLeakCount: load.streamHiddenTargetLeakCount,
    tickOverrun16Count: load.tickOverrun16Count,
    tickOverrun33Count: load.tickOverrun33Count,
    tickOverrun50Count: load.tickOverrun50Count,
    tickLastP99SpikeSpanName: load.tickLastP99SpikeSpanName,
    tickLastP99SpikeSpanMs: load.tickLastP99SpikeSpanMs,
    tickLastP99SpikeDurationMs: load.tickLastP99SpikeDurationMs,
    tickSpanP99Ms: load.tickSpanP99Ms,
    tickSpanMaxMs: load.tickSpanMaxMs,
    tickOperationCounts: load.tickOperationCounts,
    tickOperationCountAvg: load.tickOperationCountAvg,
    tickOperationCountP95: load.tickOperationCountP95,
    tickOperationCountP99: load.tickOperationCountP99,
    tickOperationCountMax: load.tickOperationCountMax,
    tickOperationCountTotal: load.tickOperationCountTotal,
    antiCheatQueueDepth: load.antiCheatQueueDepth,
    antiCheatDroppedLowMediumSignals: load.antiCheatDroppedLowMediumSignals,
    antiCheatDbErrors: load.antiCheatDbErrors,
  };
}
