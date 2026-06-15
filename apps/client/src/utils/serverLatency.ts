export type ServerLatencyQuality = 'checking' | 'good' | 'fair' | 'high' | 'offline';

export interface ServerLatencyMeasurement {
  averagePingMs: number | null;
  latestPingMs: number | null;
  sampleCount: number;
  checkedAt: number;
}

export interface ServerLatencyProbeSnapshot extends ServerLatencyMeasurement {
  quality: ServerLatencyQuality;
  error: string | null;
}

export const SERVER_LATENCY_THRESHOLDS = {
  fairPingMs: 140,
  highPingMs: 180,
} as const;

export function classifyServerLatency(averagePingMs: number | null): ServerLatencyQuality {
  if (averagePingMs === null) return 'checking';
  if (averagePingMs >= SERVER_LATENCY_THRESHOLDS.highPingMs) return 'high';
  if (averagePingMs >= SERVER_LATENCY_THRESHOLDS.fairPingMs) return 'fair';
  return 'good';
}

export function averageLatencySamples(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  const total = samples.reduce((sum, sample) => sum + sample, 0);
  return Math.round(total / samples.length);
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function abortError(): DOMException {
  return new DOMException('Latency probe aborted', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

export function latencyProbeUrl(baseUrl: string, nonce: number): string {
  const url = new URL(baseUrl);
  url.searchParams.set('_latency', String(nonce));
  return url.toString();
}

export function delayLatencyProbe(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(abortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function measureServerLatencySample(input: {
  endpointUrl: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<number> {
  throwIfAborted(input.signal);

  const timeoutController = new AbortController();
  const timeout = window.setTimeout(() => timeoutController.abort(), input.timeoutMs);
  const onAbort = () => timeoutController.abort();
  input.signal?.addEventListener('abort', onAbort, { once: true });

  const startedAt = nowMs();
  try {
    const response = await fetch(latencyProbeUrl(input.endpointUrl, Date.now()), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'include',
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      throw new Error(`Latency probe failed (${response.status})`);
    }

    return Math.max(0, Math.round(nowMs() - startedAt));
  } finally {
    window.clearTimeout(timeout);
    input.signal?.removeEventListener('abort', onAbort);
  }
}

export async function measureServerLatencyWindow(input: {
  endpointUrl: string;
  sampleCount: number;
  sampleSpacingMs: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ServerLatencyMeasurement> {
  const samples: number[] = [];

  for (let index = 0; index < input.sampleCount; index++) {
    samples.push(await measureServerLatencySample(input));
    if (index < input.sampleCount - 1) {
      await delayLatencyProbe(input.sampleSpacingMs, input.signal);
    }
  }

  return {
    averagePingMs: averageLatencySamples(samples),
    latestPingMs: samples.at(-1) ?? null,
    sampleCount: samples.length,
    checkedAt: Date.now(),
  };
}
