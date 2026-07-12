import { performance } from 'node:perf_hooks';
import { RoomMetrics } from '../rooms/roomMetrics';
import {
  ROOM_TICK_COUNTER_NAMES,
  ROOM_TICK_SPAN_NAMES,
  RoomTickProfiler,
} from '../rooms/roomTickProfiler';

const SAMPLE_COUNT = 240;
const WARMUP_ITERATIONS = 20;
const BENCHMARK_ITERATIONS = 200;

function recordProfilerTick(profiler: RoomTickProfiler, tick: number): void {
  profiler.beginTick();
  for (let index = 0; index < ROOM_TICK_SPAN_NAMES.length; index++) {
    profiler.recordSpan(ROOM_TICK_SPAN_NAMES[index], ((tick * 17 + index * 11) % 100) / 10);
  }
  for (let index = 0; index < ROOM_TICK_COUNTER_NAMES.length; index++) {
    profiler.recordCounter(ROOM_TICK_COUNTER_NAMES[index], (tick * 13 + index * 7) % 64);
  }
  profiler.endTick(((tick * 19) % 150) / 10);
}

function runBenchmark(iterations: number): { durationMs: number; checksum: number } {
  const metrics = new RoomMetrics(SAMPLE_COUNT);
  const profiler = new RoomTickProfiler(SAMPLE_COUNT);
  for (let tick = 0; tick < SAMPLE_COUNT; tick++) {
    metrics.recordTickDuration(((tick * 19) % 150) / 10);
    recordProfilerTick(profiler, tick);
  }

  let checksum = 0;
  const startedAt = performance.now();
  for (let iteration = 0; iteration < iterations; iteration++) {
    const tick = SAMPLE_COUNT + iteration;
    metrics.recordTickDuration(((tick * 19) % 150) / 10);
    checksum += metrics.getTickDurationPercentile(0.5);
    checksum += metrics.getTickDurationPercentile(0.95);
    checksum += metrics.getTickDurationPercentile(0.99);

    recordProfilerTick(profiler, tick);
    const snapshot = profiler.snapshot();
    checksum += snapshot.spans.phase_gameplay_update.p99Ms;
    checksum += snapshot.counterSamples.bot_los_checks.p99;
  }

  return {
    durationMs: performance.now() - startedAt,
    checksum,
  };
}

runBenchmark(WARMUP_ITERATIONS);
const result = runBenchmark(BENCHMARK_ITERATIONS);
console.log(JSON.stringify({
  benchmark: 'room_metadata_snapshot',
  iterations: BENCHMARK_ITERATIONS,
  totalMs: Number(result.durationMs.toFixed(3)),
  averageMs: Number((result.durationMs / BENCHMARK_ITERATIONS).toFixed(4)),
  checksum: Number(result.checksum.toFixed(3)),
}, null, 2));
