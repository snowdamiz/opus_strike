import assert from 'node:assert/strict';
import {
  buildRoomInterestMetricsSnapshot,
  buildRoomLoadSnapshot,
} from '../rooms/roomLoadSnapshot';

const interest = {
  recomputeMs: 12.5,
  losChecks: 44,
  visibleTargets: 6,
  hiddenTargets: 3,
  lastKnownTargets: 2,
  filteredTargets: 7,
  hiddenTargetLeakCount: 1,
};

{
  assert.deepEqual(
    buildRoomInterestMetricsSnapshot({
      interest,
      transformMetric: { messages: 5, recipients: 9, bytes: 1_234 },
      vitalsMetric: { messages: 6, recipients: 10, bytes: 2_345 },
    }),
    {
      ...interest,
      transformBytes: 1_234,
      vitalsBytes: 2_345,
    }
  );

  assert.deepEqual(
    buildRoomInterestMetricsSnapshot({ interest }),
    {
      ...interest,
      transformBytes: 0,
      vitalsBytes: 0,
    }
  );
}

{
  assert.deepEqual(
    buildRoomLoadSnapshot({
      tickDurationP50Ms: 1.25,
      tickDurationP95Ms: 2.5,
      tickDurationP99Ms: 3.75,
      eventLoopDelayP95Ms: 4.5,
      eventLoopDelayP99Ms: 5.25,
      customMessageTotals: { bytes: 8_192, messages: 128 },
      interest,
      transformMetric: { messages: 5, recipients: 9, bytes: 1_234 },
      vitalsMetric: { messages: 6, recipients: 10, bytes: 2_345 },
      antiCheatQueue: {
        depth: 11,
        droppedLowMediumSignals: 12,
        dbErrorCount: 13,
      },
    }),
    {
      tickDurationP50Ms: 1.25,
      tickDurationP95Ms: 2.5,
      tickDurationP99Ms: 3.75,
      eventLoopDelayP95Ms: 4.5,
      eventLoopDelayP99Ms: 5.25,
      customMessageBytes: 8_192,
      customMessageCount: 128,
      interestRecomputeMs: 12.5,
      interestLosChecks: 44,
      interestVisibleTargets: 6,
      interestHiddenTargets: 3,
      interestLastKnownTargets: 2,
      streamTransformsBytes: 1_234,
      streamVitalsBytes: 2_345,
      streamFilteredTargets: 7,
      streamHiddenTargetLeakCount: 1,
      antiCheatQueueDepth: 11,
      antiCheatDroppedLowMediumSignals: 12,
      antiCheatDbErrors: 13,
    }
  );

  assert.deepEqual(
    buildRoomLoadSnapshot({
      tickDurationP50Ms: 0,
      tickDurationP95Ms: 0,
      tickDurationP99Ms: 0,
      eventLoopDelayP95Ms: 0,
      eventLoopDelayP99Ms: 0,
      customMessageTotals: { bytes: 0, messages: 0 },
      interest,
      antiCheatQueue: {
        depth: 0,
        droppedLowMediumSignals: 0,
        dbErrorCount: 0,
      },
    }).streamTransformsBytes,
    0
  );
}

console.log('room load snapshot tests passed');
