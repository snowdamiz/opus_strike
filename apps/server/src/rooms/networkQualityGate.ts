export interface NetworkQualityGateConfig {
  sampleWindowMs: number;
  minObservationMs: number;
  minSuccessfulSamples: number;
  maxAveragePingMs: number;
  maxPeakPingMs: number;
  maxJitterMs: number;
  maxTimeoutRatio: number;
  maxTimeouts: number;
  maxConsecutiveTimeouts: number;
}

export interface NetworkQualitySample {
  at: number;
  pingMs: number | null;
  timedOut?: boolean;
}

export interface NetworkQualityState {
  firstProbeAt: number;
  samples: NetworkQualitySample[];
}

export interface PlayerNetworkQualityMetrics {
  sampleCount: number;
  successfulSamples: number;
  timeoutCount: number;
  consecutiveTimeouts: number;
  timeoutRatio: number;
  averagePingMs: number | null;
  peakPingMs: number | null;
  jitterMs: number | null;
  observationMs: number;
  windowMs: number;
}

export interface PlayerNetworkQualityEvaluation {
  playerId: string;
  playerName: string;
  status: 'ready' | 'pending' | 'blocked';
  reason: string | null;
  metrics: PlayerNetworkQualityMetrics;
}

export const DEFAULT_COMPETITIVE_NETWORK_QUALITY_GATE: NetworkQualityGateConfig = {
  sampleWindowMs: 30_000,
  minObservationMs: 6_000,
  minSuccessfulSamples: 3,
  maxAveragePingMs: 180,
  maxPeakPingMs: 325,
  maxJitterMs: 140,
  maxTimeoutRatio: 0.25,
  maxTimeouts: 1,
  maxConsecutiveTimeouts: 1,
};

export function createNetworkQualityState(now: number): NetworkQualityState {
  return {
    firstProbeAt: now,
    samples: [],
  };
}

export function recordNetworkQualitySample(
  state: NetworkQualityState,
  sample: NetworkQualitySample,
  config: NetworkQualityGateConfig = DEFAULT_COMPETITIVE_NETWORK_QUALITY_GATE
): void {
  state.samples.push(sample);
  pruneNetworkQualitySamples(state, sample.at, config);
}

export function pruneNetworkQualitySamples(
  state: NetworkQualityState,
  now: number,
  config: NetworkQualityGateConfig = DEFAULT_COMPETITIVE_NETWORK_QUALITY_GATE
): void {
  const cutoff = now - config.sampleWindowMs;
  while (state.samples.length > 0 && (state.samples[0]?.at ?? now) < cutoff) {
    state.samples.shift();
  }
}

export function evaluatePlayerNetworkQuality(input: {
  playerId: string;
  playerName: string;
  state: NetworkQualityState;
  now: number;
  config?: NetworkQualityGateConfig;
}): PlayerNetworkQualityEvaluation {
  const config = input.config ?? DEFAULT_COMPETITIVE_NETWORK_QUALITY_GATE;
  pruneNetworkQualitySamples(input.state, input.now, config);

  const samples = input.state.samples;
  const successfulSamples = samples.filter((sample) => (
    typeof sample.pingMs === 'number' && Number.isFinite(sample.pingMs)
  ));
  const timeoutCount = samples.length - successfulSamples.length;
  const timeoutRatio = samples.length > 0 ? timeoutCount / samples.length : 0;
  const consecutiveTimeouts = getMaxConsecutiveTimeouts(samples);
  const pingValues = successfulSamples.map((sample) => sample.pingMs as number);
  const averagePingMs = pingValues.length > 0
    ? Math.round(pingValues.reduce((sum, ping) => sum + ping, 0) / pingValues.length)
    : null;
  const peakPingMs = pingValues.length > 0 ? Math.max(...pingValues) : null;
  const jitterMs = pingValues.length >= 2 ? getMaxConsecutivePingDelta(pingValues) : null;
  const observationMs = Math.max(0, input.now - input.state.firstProbeAt);

  const metrics: PlayerNetworkQualityMetrics = {
    sampleCount: samples.length,
    successfulSamples: successfulSamples.length,
    timeoutCount,
    consecutiveTimeouts,
    timeoutRatio,
    averagePingMs,
    peakPingMs,
    jitterMs,
    observationMs,
    windowMs: config.sampleWindowMs,
  };

  const blockReason = getNetworkQualityBlockReason(metrics, config);
  if (blockReason) {
    return {
      playerId: input.playerId,
      playerName: input.playerName,
      status: 'blocked',
      reason: blockReason,
      metrics,
    };
  }

  const pendingReason = getNetworkQualityPendingReason(metrics, config);
  if (pendingReason) {
    return {
      playerId: input.playerId,
      playerName: input.playerName,
      status: 'pending',
      reason: pendingReason,
      metrics,
    };
  }

  return {
    playerId: input.playerId,
    playerName: input.playerName,
    status: 'ready',
    reason: null,
    metrics,
  };
}

function getNetworkQualityBlockReason(
  metrics: PlayerNetworkQualityMetrics,
  config: NetworkQualityGateConfig
): string | null {
  if (metrics.consecutiveTimeouts > config.maxConsecutiveTimeouts) return 'network_timeouts';
  if (metrics.timeoutCount > config.maxTimeouts) return 'network_timeouts';
  if (metrics.successfulSamples < config.minSuccessfulSamples) return null;
  if (metrics.timeoutRatio > config.maxTimeoutRatio) return 'packet_loss';
  if (metrics.averagePingMs !== null && metrics.averagePingMs > config.maxAveragePingMs) return 'average_ping_high';
  if (metrics.peakPingMs !== null && metrics.peakPingMs > config.maxPeakPingMs) return 'ping_spike_high';
  if (metrics.jitterMs !== null && metrics.jitterMs > config.maxJitterMs) return 'jitter_high';
  return null;
}

function getNetworkQualityPendingReason(
  metrics: PlayerNetworkQualityMetrics,
  config: NetworkQualityGateConfig
): string | null {
  if (metrics.observationMs < config.minObservationMs) return 'collecting_network_samples';
  if (metrics.successfulSamples < config.minSuccessfulSamples) return 'network_not_verified';
  return null;
}

function getMaxConsecutiveTimeouts(samples: NetworkQualitySample[]): number {
  let current = 0;
  let max = 0;

  for (const sample of samples) {
    const timedOut = sample.timedOut === true || sample.pingMs === null;
    if (!timedOut) {
      current = 0;
      continue;
    }
    current++;
    max = Math.max(max, current);
  }

  return max;
}

function getMaxConsecutivePingDelta(pingValues: number[]): number {
  let maxDelta = 0;

  for (let index = 1; index < pingValues.length; index++) {
    maxDelta = Math.max(maxDelta, Math.abs(pingValues[index] - pingValues[index - 1]));
  }

  return maxDelta;
}
