import { loggers } from '../utils/logger';

export type TickSection =
  | 'updateBots'
  | 'updatePlaying'
  | 'updatePhysics'
  | 'updateVoidZones'
  | 'updateBlazeFlamethrowers'
  | 'updateCTFObjectives'
  | 'broadcastPlayerStates'
  | 'broadcastPlayerTransforms'
  | 'broadcastPlayerVitals'
  | 'broadcastMatchSnapshot'
  | 'input';

interface SectionStats {
  totalMs: number;
  maxMs: number;
  samples: number;
}

interface NetworkStats {
  messages: number;
  bytes: number;
}

const SUMMARY_INTERVAL_MS = 10000;

function createSectionStats(): SectionStats {
  return { totalMs: 0, maxMs: 0, samples: 0 };
}

function approxBytes(payload: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(payload));
  } catch {
    return 0;
  }
}

export class TickMetrics {
  private readonly sections = new Map<TickSection, SectionStats>();
  private readonly network = new Map<string, NetworkStats>();
  private totalTicks = 0;
  private tickTotalMs = 0;
  private tickMaxMs = 0;
  private lastSummaryAt = Date.now();

  constructor(private readonly roomId: string, private readonly enabled = process.env.NODE_ENV !== 'production' || process.env.DEBUG_PERF === '1') {}

  time<T>(section: TickSection, fn: () => T): T {
    if (!this.enabled) return fn();

    const start = performance.now();
    try {
      return fn();
    } finally {
      this.recordSection(section, performance.now() - start);
    }
  }

  startTick(): number {
    return this.enabled ? performance.now() : 0;
  }

  endTick(start: number): void {
    if (!this.enabled) return;

    const elapsed = performance.now() - start;
    this.totalTicks++;
    this.tickTotalMs += elapsed;
    this.tickMaxMs = Math.max(this.tickMaxMs, elapsed);
    this.emitSummaryIfDue();
  }

  recordNetworkMessage(type: string, payload: unknown): void {
    if (!this.enabled) return;

    const stats = this.network.get(type) ?? { messages: 0, bytes: 0 };
    stats.messages++;
    stats.bytes += approxBytes(payload);
    this.network.set(type, stats);
  }

  getDebugSnapshot() {
    return {
      roomId: this.roomId,
      tickAvgMs: this.totalTicks > 0 ? this.tickTotalMs / this.totalTicks : 0,
      tickMaxMs: this.tickMaxMs,
      sections: Object.fromEntries(
        [...this.sections].map(([key, value]) => [
          key,
          {
            avgMs: value.samples > 0 ? value.totalMs / value.samples : 0,
            maxMs: value.maxMs,
            samples: value.samples,
          },
        ])
      ),
      network: Object.fromEntries(this.network),
    };
  }

  private recordSection(section: TickSection, elapsedMs: number): void {
    const stats = this.sections.get(section) ?? createSectionStats();
    stats.samples++;
    stats.totalMs += elapsedMs;
    stats.maxMs = Math.max(stats.maxMs, elapsedMs);
    this.sections.set(section, stats);
  }

  private emitSummaryIfDue(): void {
    const now = Date.now();
    if (now - this.lastSummaryAt < SUMMARY_INTERVAL_MS) return;

    const snapshot = this.getDebugSnapshot();
    loggers.perf.debug('tick summary', snapshot);
    this.sections.clear();
    this.network.clear();
    this.totalTicks = 0;
    this.tickTotalMs = 0;
    this.tickMaxMs = 0;
    this.lastSummaryAt = now;
  }
}
