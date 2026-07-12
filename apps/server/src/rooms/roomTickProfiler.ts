export const ROOM_TICK_SPAN_NAMES = [
  'spatial_index_rebuild',
  'bot_frame_context',
  'bot_updates',
  'phase_gameplay_update',
  'movement_frame_build',
  'movement_entries_process',
  'movement_human_full_steps',
  'movement_bot_full_steps',
  'movement_bot_proxy_steps',
  'movement_gameplay_input',
  'powerups_objectives_effects',
  'ping_probe_broadcast',
  'replication_frame_context',
  'player_state_stream_fanout',
  'match_snapshot_broadcast',
] as const;

export type RoomTickSpanName = typeof ROOM_TICK_SPAN_NAMES[number];

export const ROOM_TICK_COUNTER_NAMES = [
  'bot_urgent_scheduled',
  'bot_urgent_processed',
  'bot_urgent_skipped',
  'bot_deferred_scheduled',
  'bot_deferred_processed',
  'bot_deferred_skipped',
  'bot_input_reuse',
  'bot_initial_planning_stagger_skipped',
  'bot_tactics_deployment_prewarm',
  'bot_sim_tier_critical',
  'bot_sim_tier_near',
  'bot_sim_tier_background',
  'bot_planning_tier_cadence_skipped',
  'bot_noncritical_primary_fire_suppressed',
  'bot_noncritical_secondary_fire_suppressed',
  'bot_noncritical_jump_suppressed',
  'bot_perception_candidates',
  'bot_visible_enemies',
  'bot_los_checks',
  'bot_los_frame_budget_exhausted',
  'bot_los_visibility_rule_skips',
  'bot_los_lazy_target_checks',
  'bot_los_budget_candidates_selected',
  'bot_los_budget_candidates_skipped',
  'bot_steering_probe_checks',
  'bot_steering_probe_frame_budget_exhausted',
  'movement_frame_entries',
  'movement_human_entries',
  'movement_bot_entries',
  'movement_npc_entries',
  'movement_underflow_entries',
  'movement_catchup_entries',
  'movement_steps_processed',
  'movement_human_commands_processed',
  'movement_bot_steps_processed',
  'movement_gameplay_input_skipped',
  'movement_bot_lod_steps_skipped',
  'movement_bot_lod_proxy_steps',
  'movement_bot_lod_kinematic_proxy_steps',
  'movement_bot_lod_background_proxy_steps',
  'movement_bot_lod_proxy_stationary',
  'movement_bot_lod_proxy_collision_rejected',
  'movement_bot_lod_proxy_rejected',
  'movement_bot_lod_proxy_gameplay_suppressed',
  'movement_bot_lod_proxy_gameplay_skipped',
  'movement_bot_lod_eligible',
  'movement_bot_lod_budget_steps',
  'movement_bot_lod_fresh_critical_budget_reserved',
  'movement_bot_lod_budget_exhausted',
  'movement_bot_lod_budget_steps_critical',
  'movement_bot_lod_budget_steps_near',
  'movement_bot_lod_budget_steps_background',
  'movement_bot_lod_budget_exhausted_critical',
  'movement_bot_lod_budget_exhausted_near',
  'movement_bot_lod_budget_exhausted_background',
  'movement_bot_lod_full_flag',
  'movement_bot_lod_full_input',
  'movement_bot_lod_full_ability_suppressed',
  'movement_bot_lod_full_grapple',
  'movement_bot_lod_full_active_ability',
  'movement_bot_lod_full_airborne',
  'movement_bot_lod_full_enemy_human',
  'movement_bot_lod_full_enemy_battle_royal',
  'movement_bot_lod_reused_critical_bypass_suppressed',
  'movement_npc_commands_processed',
] as const;

export type RoomTickCounterName = typeof ROOM_TICK_COUNTER_NAMES[number];

const ROOM_TICK_SPAN_INDEX_BY_NAME = new Map<RoomTickSpanName, number>(
  ROOM_TICK_SPAN_NAMES.map((name, index) => [name, index])
);
const ROOM_TICK_COUNTER_INDEX_BY_NAME = new Map<RoomTickCounterName, number>(
  ROOM_TICK_COUNTER_NAMES.map((name, index) => [name, index])
);

export interface RoomTickSpanSample {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface RoomTickCounterSample {
  total: number;
  avgPerTick: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface RoomTickProfilerSnapshot {
  ticksOver16Ms: number;
  ticksOver33Ms: number;
  ticksOver50Ms: number;
  lastP99SpikeSpanName: RoomTickSpanName | '';
  lastP99SpikeSpanMs: number;
  lastP99SpikeDurationMs: number;
  spans: Record<RoomTickSpanName, RoomTickSpanSample>;
  counters: Record<RoomTickCounterName, number>;
  counterSamples: Record<RoomTickCounterName, RoomTickCounterSample>;
}

const DEFAULT_ROOM_TICK_PROFILE_SAMPLE_COUNT = 240;
const ROOM_TICK_P99_SPIKE_MIN_SAMPLE_COUNT = 16;
const ROOM_TICK_SPIKE_FALLBACK_THRESHOLD_MS = 33;

function createEmptySpanSample(): RoomTickSpanSample {
  return {
    p50Ms: 0,
    p95Ms: 0,
    p99Ms: 0,
    maxMs: 0,
  };
}

function createEmptyCounterSample(): RoomTickCounterSample {
  return {
    total: 0,
    avgPerTick: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    max: 0,
  };
}

function percentile(sorted: ArrayLike<number>, percentileValue: number): number {
  if (sorted.length === 0) return 0;
  const normalized = Number.isFinite(percentileValue)
    ? Math.max(0, Math.min(1, percentileValue))
    : 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * normalized))] ?? 0;
}

class RingSamples {
  private readonly samples: Float64Array;
  private readonly sortedSamples: Float64Array;
  private index = 0;
  private count = 0;
  private total = 0;
  private samplesSorted = true;

  constructor(sampleCount: number) {
    this.samples = new Float64Array(Math.max(1, Math.floor(sampleCount)));
    this.sortedSamples = new Float64Array(this.samples.length);
  }

  get sampleCount(): number {
    return this.count;
  }

  record(valueMs: number): void {
    const value = Math.max(0, Number.isFinite(valueMs) ? valueMs : 0);
    const replacedValue = this.count === this.samples.length ? this.samples[this.index] ?? 0 : 0;
    this.samples[this.index] = value;
    this.total += value - replacedValue;
    this.index = (this.index + 1) % this.samples.length;
    this.count = Math.min(this.samples.length, this.count + 1);
    this.samplesSorted = false;
  }

  private getSortedSamples(): Float64Array {
    const sorted = this.sortedSamples.subarray(0, this.count);
    if (!this.samplesSorted) {
      sorted.set(this.samples.subarray(0, this.count));
      sorted.sort();
      this.samplesSorted = true;
    }
    return sorted;
  }

  snapshot(): RoomTickSpanSample {
    if (this.count === 0) return createEmptySpanSample();

    const sorted = this.getSortedSamples();

    return {
      p50Ms: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      p99Ms: percentile(sorted, 0.99),
      maxMs: sorted[sorted.length - 1] ?? 0,
    };
  }

  counterSnapshot(): RoomTickCounterSample {
    if (this.count === 0) return createEmptyCounterSample();

    const sorted = this.getSortedSamples();

    return {
      total: this.total,
      avgPerTick: this.total / this.count,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      max: sorted[sorted.length - 1] ?? 0,
    };
  }
}

export class RoomTickProfiler {
  private readonly tickSamples: RingSamples;
  private readonly spanSamples: Record<RoomTickSpanName, RingSamples>;
  private readonly counterSamples: Record<RoomTickCounterName, RingSamples>;
  private readonly currentSpanDurationsMs = new Float64Array(ROOM_TICK_SPAN_NAMES.length);
  private readonly currentCounters = new Float64Array(ROOM_TICK_COUNTER_NAMES.length);
  private readonly lastCounters = new Float64Array(ROOM_TICK_COUNTER_NAMES.length);
  private ticksOver16Ms = 0;
  private ticksOver33Ms = 0;
  private ticksOver50Ms = 0;
  private lastP99SpikeSpanName: RoomTickSpanName | '' = '';
  private lastP99SpikeSpanMs = 0;
  private lastP99SpikeDurationMs = 0;

  constructor(sampleCount = DEFAULT_ROOM_TICK_PROFILE_SAMPLE_COUNT) {
    this.tickSamples = new RingSamples(sampleCount);
    this.spanSamples = Object.fromEntries(
      ROOM_TICK_SPAN_NAMES.map((name) => [name, new RingSamples(sampleCount)])
    ) as Record<RoomTickSpanName, RingSamples>;
    this.counterSamples = Object.fromEntries(
      ROOM_TICK_COUNTER_NAMES.map((name) => [name, new RingSamples(sampleCount)])
    ) as Record<RoomTickCounterName, RingSamples>;
  }

  beginTick(): void {
    this.currentSpanDurationsMs.fill(0);
    this.currentCounters.fill(0);
  }

  recordSpan(name: RoomTickSpanName, durationMs: number): void {
    const spanIndex = ROOM_TICK_SPAN_INDEX_BY_NAME.get(name);
    if (spanIndex === undefined) return;
    this.currentSpanDurationsMs[spanIndex] += Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
  }

  recordCounter(name: RoomTickCounterName, count = 1): void {
    const counterIndex = ROOM_TICK_COUNTER_INDEX_BY_NAME.get(name);
    if (counterIndex === undefined) return;
    this.currentCounters[counterIndex] += Math.max(0, Number.isFinite(count) ? count : 0);
  }

  endTick(durationMs: number): void {
    const tickDurationMs = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
    const sampleCountBeforeRecord = this.tickSamples.sampleCount;

    this.tickSamples.record(tickDurationMs);
    if (tickDurationMs > 16) this.ticksOver16Ms++;
    if (tickDurationMs > 33) this.ticksOver33Ms++;
    if (tickDurationMs > 50) this.ticksOver50Ms++;

    let largestSpanName: RoomTickSpanName | '' = '';
    let largestSpanMs = 0;
    for (let index = 0; index < ROOM_TICK_SPAN_NAMES.length; index++) {
      const spanName = ROOM_TICK_SPAN_NAMES[index];
      const spanDurationMs = this.currentSpanDurationsMs[index] ?? 0;
      this.spanSamples[spanName].record(spanDurationMs);
      if (spanDurationMs > largestSpanMs) {
        largestSpanName = spanName;
        largestSpanMs = spanDurationMs;
      }
    }
    for (let index = 0; index < ROOM_TICK_COUNTER_NAMES.length; index++) {
      const counterName = ROOM_TICK_COUNTER_NAMES[index];
      this.counterSamples[counterName].record(this.currentCounters[index] ?? 0);
    }
    this.lastCounters.set(this.currentCounters);

    if (
      sampleCountBeforeRecord >= ROOM_TICK_P99_SPIKE_MIN_SAMPLE_COUNT
      && tickDurationMs >= ROOM_TICK_SPIKE_FALLBACK_THRESHOLD_MS
      && largestSpanName
    ) {
      this.lastP99SpikeSpanName = largestSpanName;
      this.lastP99SpikeSpanMs = largestSpanMs;
      this.lastP99SpikeDurationMs = tickDurationMs;
    }
  }

  snapshot(): RoomTickProfilerSnapshot {
    const spans = Object.fromEntries(
      ROOM_TICK_SPAN_NAMES.map((name) => [name, this.spanSamples[name].snapshot()])
    ) as Record<RoomTickSpanName, RoomTickSpanSample>;
    const counters = Object.fromEntries(
      ROOM_TICK_COUNTER_NAMES.map((name, index) => [name, this.lastCounters[index] ?? 0])
    ) as Record<RoomTickCounterName, number>;
    const counterSamples = Object.fromEntries(
      ROOM_TICK_COUNTER_NAMES.map((name) => [name, this.counterSamples[name].counterSnapshot()])
    ) as Record<RoomTickCounterName, RoomTickCounterSample>;

    return {
      ticksOver16Ms: this.ticksOver16Ms,
      ticksOver33Ms: this.ticksOver33Ms,
      ticksOver50Ms: this.ticksOver50Ms,
      lastP99SpikeSpanName: this.lastP99SpikeSpanName,
      lastP99SpikeSpanMs: this.lastP99SpikeSpanMs,
      lastP99SpikeDurationMs: this.lastP99SpikeDurationMs,
      spans,
      counters,
      counterSamples,
    };
  }
}
