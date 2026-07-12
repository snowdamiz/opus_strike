import { estimateCustomMessageBytes } from './customMessageMetrics';

export const DEFAULT_ROOM_LOAD_SAMPLE_COUNT = 240;

export interface RoomCustomMessageMetric {
  messages: number;
  recipients: number;
  bytes: number;
}

export interface RoomCustomMessageTotals {
  bytes: number;
  messages: number;
}

export class RoomMetrics {
  private readonly customMessageMetrics = new Map<string, RoomCustomMessageMetric>();
  private readonly tickDurationSamplesMs: Float64Array;
  private readonly sortedTickDurationSamplesMs: Float64Array;
  private tickDurationSampleIndex = 0;
  private tickDurationSampleCount = 0;
  private tickDurationSamplesSorted = true;

  constructor(sampleCount = DEFAULT_ROOM_LOAD_SAMPLE_COUNT) {
    this.tickDurationSamplesMs = new Float64Array(Math.max(1, Math.floor(sampleCount)));
    this.sortedTickDurationSamplesMs = new Float64Array(this.tickDurationSamplesMs.length);
  }

  recordTickDuration(durationMs: number): void {
    this.tickDurationSamplesMs[this.tickDurationSampleIndex] = Math.max(0, durationMs);
    this.tickDurationSampleIndex = (this.tickDurationSampleIndex + 1) % this.tickDurationSamplesMs.length;
    this.tickDurationSampleCount = Math.min(this.tickDurationSamplesMs.length, this.tickDurationSampleCount + 1);
    this.tickDurationSamplesSorted = false;
  }

  getTickDurationPercentile(percentile: number): number {
    if (this.tickDurationSampleCount === 0) return 0;

    const samples = this.sortedTickDurationSamplesMs.subarray(0, this.tickDurationSampleCount);
    if (!this.tickDurationSamplesSorted) {
      samples.set(this.tickDurationSamplesMs.subarray(0, this.tickDurationSampleCount));
      samples.sort();
      this.tickDurationSamplesSorted = true;
    }

    const normalizedPercentile = Number.isFinite(percentile)
      ? Math.max(0, Math.min(1, percentile))
      : 0;
    return samples[Math.min(samples.length - 1, Math.floor((samples.length - 1) * normalizedPercentile))] ?? 0;
  }

  recordCustomMessage(type: string, payload: unknown, recipients: number): void {
    if (recipients <= 0) return;

    let metric = this.customMessageMetrics.get(type);
    if (!metric) {
      metric = { messages: 0, recipients: 0, bytes: 0 };
      this.customMessageMetrics.set(type, metric);
    }
    const bytes = estimateCustomMessageBytes(type, payload);
    metric.messages++;
    metric.recipients += recipients;
    metric.bytes += bytes * recipients;
  }

  getCustomMessageMetricsSnapshot(): Record<string, RoomCustomMessageMetric> {
    const snapshot: Record<string, RoomCustomMessageMetric> = {};
    for (const [type, metric] of this.customMessageMetrics) {
      snapshot[type] = { ...metric };
    }
    return snapshot;
  }

  getCustomMessageMetric(type: string): RoomCustomMessageMetric | undefined {
    const metric = this.customMessageMetrics.get(type);
    return metric ? { ...metric } : undefined;
  }

  getCustomMessageTotals(): RoomCustomMessageTotals {
    let bytes = 0;
    let messages = 0;
    for (const metric of this.customMessageMetrics.values()) {
      bytes += metric.bytes;
      messages += metric.messages;
    }
    return { bytes, messages };
  }
}
