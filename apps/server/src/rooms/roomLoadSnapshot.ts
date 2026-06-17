import type { AntiCheatQueueHealth } from '../anticheat/service';
import type { VisibilityInterestMetrics } from './visibilityInterest';
import type {
  RoomCustomMessageMetric,
  RoomCustomMessageTotals,
} from './roomMetrics';

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
  antiCheatQueue: Pick<AntiCheatQueueHealth, 'depth' | 'droppedLowMediumSignals' | 'dbErrorCount'>;
}): RoomLoadSnapshot {
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
    antiCheatQueueDepth: input.antiCheatQueue.depth,
    antiCheatDroppedLowMediumSignals: input.antiCheatQueue.droppedLowMediumSignals,
    antiCheatDbErrors: input.antiCheatQueue.dbErrorCount,
  };
}
