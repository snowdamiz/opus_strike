import type { AntiCheatQueueHealth } from '../anticheat/service';
import type { VisibilityInterestMetrics } from './visibilityInterest';
import type {
  RoomCustomMessageMetric,
  RoomCustomMessageTotals,
} from './roomMetrics';
import type {
  RoomTickCounterName,
  RoomTickProfilerSnapshot,
} from './roomTickProfiler';

export interface RoomLoadSnapshot {
  tickDurationP50Ms: number;
  tickDurationP95Ms: number;
  tickDurationP99Ms: number;
  eventLoopDelayP95Ms: number;
  eventLoopDelayP99Ms: number;
  customMessageBytes: number;
  customMessageCount: number;
  interestRecomputeMs: number;
  interestLosChecks: number;
  interestVisibleTargets: number;
  interestHiddenTargets: number;
  interestLastKnownTargets: number;
  streamTransformsBytes: number;
  streamVitalsBytes: number;
  streamFilteredTargets: number;
  streamHiddenTargetLeakCount: number;
  tickOverrun16Count: number;
  tickOverrun33Count: number;
  tickOverrun50Count: number;
  tickLastP99SpikeSpanName: string;
  tickLastP99SpikeSpanMs: number;
  tickLastP99SpikeDurationMs: number;
  tickSpanP99Ms: Record<string, number>;
  tickSpanMaxMs: Record<string, number>;
  tickOperationCounts: Record<RoomTickCounterName, number>;
  tickOperationCountAvg: Record<string, number>;
  tickOperationCountP95: Record<string, number>;
  tickOperationCountP99: Record<string, number>;
  tickOperationCountMax: Record<string, number>;
  tickOperationCountTotal: Record<string, number>;
  antiCheatQueueDepth: number;
  antiCheatDroppedLowMediumSignals: number;
  antiCheatDbErrors: number;
}

export interface RoomInterestMetricsSnapshot extends VisibilityInterestMetrics {
  transformBytes: number;
  vitalsBytes: number;
}

export function buildRoomInterestMetricsSnapshot(input: {
  interest: VisibilityInterestMetrics;
  transformMetric?: RoomCustomMessageMetric;
  vitalsMetric?: RoomCustomMessageMetric;
}): RoomInterestMetricsSnapshot {
  return {
    ...input.interest,
    transformBytes: input.transformMetric?.bytes ?? 0,
    vitalsBytes: input.vitalsMetric?.bytes ?? 0,
  };
}

export function buildRoomLoadSnapshot(input: {
  tickDurationP50Ms: number;
  tickDurationP95Ms: number;
  tickDurationP99Ms: number;
  eventLoopDelayP95Ms: number;
  eventLoopDelayP99Ms: number;
  customMessageTotals: RoomCustomMessageTotals;
  interest: VisibilityInterestMetrics;
  transformMetric?: RoomCustomMessageMetric;
  vitalsMetric?: RoomCustomMessageMetric;
  tickProfiler?: RoomTickProfilerSnapshot;
  antiCheatQueue: Pick<AntiCheatQueueHealth, 'depth' | 'droppedLowMediumSignals' | 'dbErrorCount'>;
}): RoomLoadSnapshot {
  const tickSpanP99Ms: Record<string, number> = {};
  const tickSpanMaxMs: Record<string, number> = {};
  const tickOperationCounts = { ...(input.tickProfiler?.counters ?? {}) } as Record<RoomTickCounterName, number>;
  const tickOperationCountAvg: Record<string, number> = {};
  const tickOperationCountP95: Record<string, number> = {};
  const tickOperationCountP99: Record<string, number> = {};
  const tickOperationCountMax: Record<string, number> = {};
  const tickOperationCountTotal: Record<string, number> = {};
  if (input.tickProfiler) {
    for (const [spanName, sample] of Object.entries(input.tickProfiler.spans)) {
      tickSpanP99Ms[spanName] = sample.p99Ms;
      tickSpanMaxMs[spanName] = sample.maxMs;
    }
    for (const [counterName, sample] of Object.entries(input.tickProfiler.counterSamples)) {
      tickOperationCountAvg[counterName] = sample.avgPerTick;
      tickOperationCountP95[counterName] = sample.p95;
      tickOperationCountP99[counterName] = sample.p99;
      tickOperationCountMax[counterName] = sample.max;
      tickOperationCountTotal[counterName] = sample.total;
    }
  }

  return {
    tickDurationP50Ms: input.tickDurationP50Ms,
    tickDurationP95Ms: input.tickDurationP95Ms,
    tickDurationP99Ms: input.tickDurationP99Ms,
    eventLoopDelayP95Ms: input.eventLoopDelayP95Ms,
    eventLoopDelayP99Ms: input.eventLoopDelayP99Ms,
    customMessageBytes: input.customMessageTotals.bytes,
    customMessageCount: input.customMessageTotals.messages,
    interestRecomputeMs: input.interest.recomputeMs,
    interestLosChecks: input.interest.losChecks,
    interestVisibleTargets: input.interest.visibleTargets,
    interestHiddenTargets: input.interest.hiddenTargets,
    interestLastKnownTargets: input.interest.lastKnownTargets,
    streamTransformsBytes: input.transformMetric?.bytes ?? 0,
    streamVitalsBytes: input.vitalsMetric?.bytes ?? 0,
    streamFilteredTargets: input.interest.filteredTargets,
    streamHiddenTargetLeakCount: input.interest.hiddenTargetLeakCount,
    tickOverrun16Count: input.tickProfiler?.ticksOver16Ms ?? 0,
    tickOverrun33Count: input.tickProfiler?.ticksOver33Ms ?? 0,
    tickOverrun50Count: input.tickProfiler?.ticksOver50Ms ?? 0,
    tickLastP99SpikeSpanName: input.tickProfiler?.lastP99SpikeSpanName ?? '',
    tickLastP99SpikeSpanMs: input.tickProfiler?.lastP99SpikeSpanMs ?? 0,
    tickLastP99SpikeDurationMs: input.tickProfiler?.lastP99SpikeDurationMs ?? 0,
    tickSpanP99Ms,
    tickSpanMaxMs,
    tickOperationCounts,
    tickOperationCountAvg,
    tickOperationCountP95,
    tickOperationCountP99,
    tickOperationCountMax,
    tickOperationCountTotal,
    antiCheatQueueDepth: input.antiCheatQueue.depth,
    antiCheatDroppedLowMediumSignals: input.antiCheatQueue.droppedLowMediumSignals,
    antiCheatDbErrors: input.antiCheatQueue.dbErrorCount,
  };
}
