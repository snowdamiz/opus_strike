import { useEffect, useState } from 'react';
import { config } from '../config/environment';
import {
  classifyServerLatency,
  delayLatencyProbe,
  measureServerLatencyWindow,
  type ServerLatencyProbeSnapshot,
} from '../utils/serverLatency';

const LOBBY_LATENCY_SAMPLE_COUNT = 3;
const LOBBY_LATENCY_SAMPLE_SPACING_MS = 260;
const LOBBY_LATENCY_TIMEOUT_MS = 2500;
const LOBBY_LATENCY_REFRESH_MS = 12_000;

const INITIAL_SERVER_LATENCY_SNAPSHOT: ServerLatencyProbeSnapshot = {
  quality: 'checking',
  averagePingMs: null,
  latestPingMs: null,
  sampleCount: 0,
  checkedAt: 0,
  error: null,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Server latency check failed';
}

export function useServerLatencyProbe(enabled: boolean): ServerLatencyProbeSnapshot {
  const [snapshot, setSnapshot] = useState<ServerLatencyProbeSnapshot>(INITIAL_SERVER_LATENCY_SNAPSHOT);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const controller = new AbortController();
    const endpointUrl = `${config.serverHttpUrl}/health`;

    setSnapshot((current) => (
      current.checkedAt === 0
        ? INITIAL_SERVER_LATENCY_SNAPSHOT
        : current
    ));

    const runProbeLoop = async () => {
      while (!cancelled) {
        try {
          const measurement = await measureServerLatencyWindow({
            endpointUrl,
            sampleCount: LOBBY_LATENCY_SAMPLE_COUNT,
            sampleSpacingMs: LOBBY_LATENCY_SAMPLE_SPACING_MS,
            timeoutMs: LOBBY_LATENCY_TIMEOUT_MS,
            signal: controller.signal,
          });

          if (cancelled) return;
          setSnapshot({
            ...measurement,
            quality: classifyServerLatency(measurement.averagePingMs),
            error: null,
          });
        } catch (error) {
          if (cancelled || controller.signal.aborted) return;
          setSnapshot({
            quality: 'offline',
            averagePingMs: null,
            latestPingMs: null,
            sampleCount: 0,
            checkedAt: Date.now(),
            error: errorMessage(error),
          });
        }

        try {
          await delayLatencyProbe(LOBBY_LATENCY_REFRESH_MS, controller.signal);
        } catch {
          return;
        }
      }
    };

    void runProbeLoop();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled]);

  return snapshot;
}
