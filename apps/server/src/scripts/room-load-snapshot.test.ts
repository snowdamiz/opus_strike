import assert from 'node:assert/strict';
import {
  buildRoomInterestMetricsSnapshot,
  buildRoomLoadSnapshot,
} from '../rooms/roomLoadSnapshot';
import {
  ROOM_TICK_COUNTER_NAMES,
  RoomTickProfiler,
  type RoomTickCounterSample,
  type RoomTickCounterName,
} from '../rooms/roomTickProfiler';

const interest = {
  recomputeMs: 12.5,
  losChecks: 44,
  visibleTargets: 6,
  hiddenTargets: 3,
  lastKnownTargets: 2,
  filteredTargets: 7,
  hiddenTargetLeakCount: 1,
};

function createTickOperationCounts(overrides: Partial<Record<RoomTickCounterName, number>> = {}): Record<RoomTickCounterName, number> {
  return Object.fromEntries(
    ROOM_TICK_COUNTER_NAMES.map((name) => [name, overrides[name] ?? 0])
  ) as Record<RoomTickCounterName, number>;
}

function createTickOperationSummaryValues(
  overrides: Partial<Record<RoomTickCounterName, number>> = {}
): Record<string, number> {
  return Object.fromEntries(
    ROOM_TICK_COUNTER_NAMES.map((name) => [name, overrides[name] ?? 0])
  );
}

function createTickOperationCounterSamples(
  overrides: Partial<Record<RoomTickCounterName, Partial<RoomTickCounterSample>>> = {}
): Record<RoomTickCounterName, RoomTickCounterSample> {
  return Object.fromEntries(
    ROOM_TICK_COUNTER_NAMES.map((name) => {
      const override = overrides[name] ?? {};
      return [name, {
        total: override.total ?? 0,
        avgPerTick: override.avgPerTick ?? 0,
        p50: override.p50 ?? 0,
        p95: override.p95 ?? 0,
        p99: override.p99 ?? 0,
        max: override.max ?? 0,
      }];
    })
  ) as Record<RoomTickCounterName, RoomTickCounterSample>;
}

{
  const profiler = new RoomTickProfiler(4);
  const tickSamples = [
    { durationMs: 8, spanMs: 4, counter: 8 },
    { durationMs: 2, spanMs: 1, counter: 2 },
    { durationMs: 6, spanMs: 3, counter: 6 },
    { durationMs: 4, spanMs: 2, counter: 4 },
  ];
  for (const sample of tickSamples) {
    profiler.beginTick();
    profiler.recordSpan('phase_gameplay_update', sample.spanMs);
    profiler.recordCounter('bot_los_checks', sample.counter);
    profiler.endTick(sample.durationMs);
  }

  const firstSnapshot = profiler.snapshot();
  assert.deepEqual(firstSnapshot.spans.phase_gameplay_update, {
    p50Ms: 2,
    p95Ms: 3,
    p99Ms: 3,
    maxMs: 4,
  });
  assert.deepEqual(firstSnapshot.counterSamples.bot_los_checks, {
    total: 20,
    avgPerTick: 5,
    p50: 4,
    p95: 6,
    p99: 6,
    max: 8,
  });

  // Repeated snapshots reuse the sorted samples without sharing mutable output.
  firstSnapshot.spans.phase_gameplay_update.p99Ms = 999;
  assert.equal(profiler.snapshot().spans.phase_gameplay_update.p99Ms, 3);

  // Replacing the oldest ring entry must invalidate both the sort and running total.
  profiler.beginTick();
  profiler.recordSpan('phase_gameplay_update', 10);
  profiler.recordCounter('bot_los_checks', 10);
  profiler.endTick(10);
  assert.deepEqual(profiler.snapshot().counterSamples.bot_los_checks, {
    total: 22,
    avgPerTick: 5.5,
    p50: 4,
    p95: 6,
    p99: 6,
    max: 10,
  });
}

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
      tickProfiler: {
        ticksOver16Ms: 2,
        ticksOver33Ms: 1,
        ticksOver50Ms: 0,
        lastP99SpikeSpanName: 'player_state_stream_fanout',
        lastP99SpikeSpanMs: 3.2,
        lastP99SpikeDurationMs: 4.4,
        counters: createTickOperationCounts({
          bot_los_checks: 17,
          bot_steering_probe_checks: 8,
          movement_bot_steps_processed: 6,
          movement_human_commands_processed: 24,
        }),
        counterSamples: createTickOperationCounterSamples({
          bot_los_checks: { total: 170, avgPerTick: 1.7, p50: 1, p95: 8, p99: 12, max: 17 },
          bot_steering_probe_checks: { total: 80, avgPerTick: 0.8, p50: 0, p95: 4, p99: 6, max: 8 },
          movement_bot_steps_processed: { total: 60, avgPerTick: 0.6, p50: 0, p95: 3, p99: 5, max: 6 },
          movement_human_commands_processed: { total: 240, avgPerTick: 2.4, p50: 2, p95: 20, p99: 22, max: 24 },
        }),
        spans: {
          spatial_index_rebuild: { p50Ms: 0.1, p95Ms: 0.2, p99Ms: 0.3, maxMs: 0.4 },
          bot_frame_context: { p50Ms: 0.2, p95Ms: 0.3, p99Ms: 0.4, maxMs: 0.5 },
          bot_updates: { p50Ms: 0.3, p95Ms: 0.4, p99Ms: 0.5, maxMs: 0.6 },
          phase_gameplay_update: { p50Ms: 0.4, p95Ms: 0.5, p99Ms: 0.6, maxMs: 0.7 },
          movement_frame_build: { p50Ms: 0.5, p95Ms: 0.6, p99Ms: 0.7, maxMs: 0.8 },
          movement_entries_process: { p50Ms: 0.55, p95Ms: 0.65, p99Ms: 0.75, maxMs: 0.85 },
          movement_human_full_steps: { p50Ms: 0.56, p95Ms: 0.66, p99Ms: 0.76, maxMs: 0.86 },
          movement_bot_full_steps: { p50Ms: 0.57, p95Ms: 0.67, p99Ms: 0.77, maxMs: 0.87 },
          movement_bot_proxy_steps: { p50Ms: 0.58, p95Ms: 0.68, p99Ms: 0.78, maxMs: 0.88 },
          movement_gameplay_input: { p50Ms: 0.59, p95Ms: 0.69, p99Ms: 0.79, maxMs: 0.89 },
          powerups_objectives_effects: { p50Ms: 0.6, p95Ms: 0.7, p99Ms: 0.8, maxMs: 0.9 },
          ping_probe_broadcast: { p50Ms: 0.7, p95Ms: 0.8, p99Ms: 0.9, maxMs: 1 },
          replication_frame_context: { p50Ms: 0.8, p95Ms: 0.9, p99Ms: 1, maxMs: 1.1 },
          player_state_stream_fanout: { p50Ms: 0.9, p95Ms: 1, p99Ms: 1.1, maxMs: 1.2 },
          match_snapshot_broadcast: { p50Ms: 1, p95Ms: 1.1, p99Ms: 1.2, maxMs: 1.3 },
        },
      },
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
      tickOverrun16Count: 2,
      tickOverrun33Count: 1,
      tickOverrun50Count: 0,
      tickLastP99SpikeSpanName: 'player_state_stream_fanout',
      tickLastP99SpikeSpanMs: 3.2,
      tickLastP99SpikeDurationMs: 4.4,
      tickSpanP99Ms: {
        spatial_index_rebuild: 0.3,
        bot_frame_context: 0.4,
        bot_updates: 0.5,
        phase_gameplay_update: 0.6,
        movement_frame_build: 0.7,
        movement_entries_process: 0.75,
        movement_human_full_steps: 0.76,
        movement_bot_full_steps: 0.77,
        movement_bot_proxy_steps: 0.78,
        movement_gameplay_input: 0.79,
        powerups_objectives_effects: 0.8,
        ping_probe_broadcast: 0.9,
        replication_frame_context: 1,
        player_state_stream_fanout: 1.1,
        match_snapshot_broadcast: 1.2,
      },
      tickSpanMaxMs: {
        spatial_index_rebuild: 0.4,
        bot_frame_context: 0.5,
        bot_updates: 0.6,
        phase_gameplay_update: 0.7,
        movement_frame_build: 0.8,
        movement_entries_process: 0.85,
        movement_human_full_steps: 0.86,
        movement_bot_full_steps: 0.87,
        movement_bot_proxy_steps: 0.88,
        movement_gameplay_input: 0.89,
        powerups_objectives_effects: 0.9,
        ping_probe_broadcast: 1,
        replication_frame_context: 1.1,
        player_state_stream_fanout: 1.2,
        match_snapshot_broadcast: 1.3,
      },
      tickOperationCounts: createTickOperationCounts({
        bot_los_checks: 17,
        bot_steering_probe_checks: 8,
        movement_bot_steps_processed: 6,
        movement_human_commands_processed: 24,
      }),
      tickOperationCountAvg: createTickOperationSummaryValues({
        bot_los_checks: 1.7,
        bot_steering_probe_checks: 0.8,
        movement_bot_steps_processed: 0.6,
        movement_human_commands_processed: 2.4,
      }),
      tickOperationCountP95: createTickOperationSummaryValues({
        bot_los_checks: 8,
        bot_steering_probe_checks: 4,
        movement_bot_steps_processed: 3,
        movement_human_commands_processed: 20,
      }),
      tickOperationCountP99: createTickOperationSummaryValues({
        bot_los_checks: 12,
        bot_steering_probe_checks: 6,
        movement_bot_steps_processed: 5,
        movement_human_commands_processed: 22,
      }),
      tickOperationCountMax: createTickOperationSummaryValues({
        bot_los_checks: 17,
        bot_steering_probe_checks: 8,
        movement_bot_steps_processed: 6,
        movement_human_commands_processed: 24,
      }),
      tickOperationCountTotal: createTickOperationSummaryValues({
        bot_los_checks: 170,
        bot_steering_probe_checks: 80,
        movement_bot_steps_processed: 60,
        movement_human_commands_processed: 240,
      }),
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
