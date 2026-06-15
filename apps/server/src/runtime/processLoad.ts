import * as os from 'node:os';
import { performance, monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import * as v8 from 'node:v8';

const SAMPLE_INTERVAL_MS = 1_000;
const EVENT_LOOP_RESOLUTION_MS = 20;
const TARGET_CPU_UTILIZATION = 0.75;
const TARGET_EVENT_LOOP_DELAY_P95_MS = 20;
const TARGET_HEAP_USED_RATIO = 0.75;
const TARGET_PROCESS_RSS_USED_RATIO = 0.85;
const TARGET_LOAD_RATIO = 0.85;

export interface ProcessLoadSnapshot {
  sampledAtMs: number;
  cpuCount: number;
  processCpuUtilization: number;
  loadAvg1: number;
  loadPct1: number;
  eventLoopDelayP95Ms: number;
  eventLoopDelayP99Ms: number;
  heapUsedRatio: number;
  processRssUsedRatio: number;
  systemMemoryUsedRatio: number;
  capacityPressure: number;
}

export interface ProcessLoadSamplerOptions {
  now?: () => number;
  performanceNow?: () => number;
  cpuUsage?: () => NodeJS.CpuUsage;
  memoryUsage?: () => NodeJS.MemoryUsage;
  loadavg?: () => number[];
  totalmem?: () => number;
  freemem?: () => number;
  cpuCount?: () => number;
  heapSizeLimit?: () => number;
  eventLoopDelay?: IntervalHistogram;
  autoStart?: boolean;
}

function readCpuCount(readCpuCount?: () => number): number {
  if (readCpuCount) return Math.max(1, Math.floor(readCpuCount()) || 1);
  if (typeof os.availableParallelism === 'function') return Math.max(1, os.availableParallelism());
  return Math.max(1, os.cpus().length);
}

function ratio(value: number, target: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, value / target);
}

function normalizedEventLoopDelayMs(rawDelayMs: number): number {
  if (!Number.isFinite(rawDelayMs)) return 0;
  return Math.max(0, rawDelayMs - EVENT_LOOP_RESOLUTION_MS);
}

export class ProcessLoadSampler {
  private readonly now: () => number;
  private readonly performanceNow: () => number;
  private readonly cpuUsage: () => NodeJS.CpuUsage;
  private readonly memoryUsage: () => NodeJS.MemoryUsage;
  private readonly loadavg: () => number[];
  private readonly totalmem: () => number;
  private readonly freemem: () => number;
  private readonly cpuCount: () => number;
  private readonly heapSizeLimit: () => number;
  private readonly eventLoopDelay: IntervalHistogram;
  private readonly ownsEventLoopDelay: boolean;
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastCpuUsage: NodeJS.CpuUsage;
  private lastPerformanceNow: number;
  private snapshot: ProcessLoadSnapshot;

  constructor(options: ProcessLoadSamplerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.performanceNow = options.performanceNow ?? (() => performance.now());
    this.cpuUsage = options.cpuUsage ?? (() => process.cpuUsage());
    this.memoryUsage = options.memoryUsage ?? (() => process.memoryUsage());
    this.loadavg = options.loadavg ?? (() => os.loadavg());
    this.totalmem = options.totalmem ?? (() => os.totalmem());
    this.freemem = options.freemem ?? (() => os.freemem());
    this.cpuCount = () => readCpuCount(options.cpuCount);
    this.heapSizeLimit = options.heapSizeLimit ?? (() => v8.getHeapStatistics().heap_size_limit);
    this.eventLoopDelay = options.eventLoopDelay ?? monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS });
    this.ownsEventLoopDelay = !options.eventLoopDelay;
    if (this.ownsEventLoopDelay) this.eventLoopDelay.enable();

    this.lastCpuUsage = this.cpuUsage();
    this.lastPerformanceNow = this.performanceNow();
    this.snapshot = this.createSnapshot(0, this.lastPerformanceNow);

    if (options.autoStart !== false) this.start();
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
    this.interval.unref?.();
  }

  close(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.ownsEventLoopDelay) this.eventLoopDelay.disable();
  }

  sample(): ProcessLoadSnapshot {
    const currentPerformanceNow = this.performanceNow();
    const elapsedMs = Math.max(1, currentPerformanceNow - this.lastPerformanceNow);
    const currentCpuUsage = this.cpuUsage();
    const elapsedCpuMs = Math.max(
      0,
      (currentCpuUsage.user + currentCpuUsage.system - this.lastCpuUsage.user - this.lastCpuUsage.system) / 1000
    );
    const cpuUtilization = elapsedCpuMs / elapsedMs / this.cpuCount();

    this.lastPerformanceNow = currentPerformanceNow;
    this.lastCpuUsage = currentCpuUsage;
    this.snapshot = this.createSnapshot(cpuUtilization, currentPerformanceNow);
    this.eventLoopDelay.reset();

    return this.snapshot;
  }

  getSnapshot(): ProcessLoadSnapshot {
    if (this.now() - this.snapshot.sampledAtMs > SAMPLE_INTERVAL_MS * 2) {
      return this.sample();
    }
    return this.snapshot;
  }

  private createSnapshot(processCpuUtilization: number, _performanceNow: number): ProcessLoadSnapshot {
    const cpuCount = this.cpuCount();
    const [loadAvg1 = 0] = this.loadavg();
    const memory = this.memoryUsage();
    const heapLimit = Math.max(1, this.heapSizeLimit());
    const totalMemory = Math.max(1, this.totalmem());
    const systemMemoryUsedRatio = Math.max(0, Math.min(1, (totalMemory - this.freemem()) / totalMemory));
    const eventLoopDelayP95Ms = normalizedEventLoopDelayMs(this.eventLoopDelay.percentile(95) / 1_000_000);
    const eventLoopDelayP99Ms = normalizedEventLoopDelayMs(this.eventLoopDelay.percentile(99) / 1_000_000);
    const heapUsedRatio = Math.max(0, Math.min(1, memory.heapUsed / heapLimit));
    const processRssUsedRatio = Math.max(0, Math.min(1, (memory.rss ?? 0) / totalMemory));
    const loadPct1 = Math.max(0, loadAvg1 / cpuCount);
    const capacityPressure = Math.max(
      ratio(processCpuUtilization, TARGET_CPU_UTILIZATION),
      ratio(eventLoopDelayP95Ms, TARGET_EVENT_LOOP_DELAY_P95_MS),
      ratio(heapUsedRatio, TARGET_HEAP_USED_RATIO),
      ratio(processRssUsedRatio, TARGET_PROCESS_RSS_USED_RATIO),
      ratio(loadPct1, TARGET_LOAD_RATIO)
    );

    return {
      sampledAtMs: this.now(),
      cpuCount,
      processCpuUtilization: Math.max(0, processCpuUtilization),
      loadAvg1: Math.max(0, loadAvg1),
      loadPct1,
      eventLoopDelayP95Ms: Math.max(0, eventLoopDelayP95Ms),
      eventLoopDelayP99Ms: Math.max(0, eventLoopDelayP99Ms),
      heapUsedRatio,
      processRssUsedRatio,
      systemMemoryUsedRatio,
      capacityPressure,
    };
  }
}

export const processLoadSampler = new ProcessLoadSampler();
