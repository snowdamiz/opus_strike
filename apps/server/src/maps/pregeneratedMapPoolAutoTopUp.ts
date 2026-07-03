import type { ColyseusRuntimeConfig } from '../config/colyseus';
import {
  collectLocalAdminMachineSnapshot,
  listAdminMachineSnapshots,
  type AdminMachineRedisClient,
  type AdminMachineSnapshot,
  type AdminMatchMaker,
} from '../admin/machineRegistry';
import {
  runWithRedisOwnerLock,
  type RedisOwnerLockClient,
} from '../wagers/workerLock';
import { loggers } from '../utils/logger';
import {
  pregeneratedMapCatalogService,
  type MapPoolAdminOverview,
  type MapPoolTopUpOptions,
  type MapPoolTopUpResult,
  writeMapPoolConsoleStatus,
} from './pregeneratedMapCatalog';

export type MapPoolAutoTopUpRedisClient = AdminMachineRedisClient & RedisOwnerLockClient;

export interface PregeneratedMapPoolAutoTopUpConfig {
  enabled: boolean;
  initialDelayMs: number;
  intervalMs: number;
  maxGeneratedPerRun: number;
  machineFreshnessMs: number;
  lockKey: string;
  lockTtlMs: number;
  lockHeartbeatMs: number;
  maxLocalGameRooms: number;
  maxLocalLobbyRooms: number;
  maxLocalCcu: number;
  maxProcessCpuUtilization: number;
  maxEventLoopDelayP95Ms: number;
  maxCapacityPressure: number;
  allowLocalWithoutRedis: boolean;
}

export interface PregeneratedMapPoolAutoTopUpCatalog {
  getAdminOverview(): Promise<MapPoolAdminOverview>;
  topUpPool(options?: MapPoolTopUpOptions): Promise<MapPoolTopUpResult>;
}

export interface PregeneratedMapPoolAutoTopUpRuntime {
  config: ColyseusRuntimeConfig;
  matchMaker: AdminMatchMaker;
  flyReplayRegistered: () => boolean;
}

export interface PregeneratedMapPoolAutoTopUpRunDeps {
  config: PregeneratedMapPoolAutoTopUpConfig;
  runtime: PregeneratedMapPoolAutoTopUpRuntime;
  catalog?: PregeneratedMapPoolAutoTopUpCatalog;
  redis?: MapPoolAutoTopUpRedisClient | null;
  now?: () => number;
  getMachineSnapshots?: () => Promise<AdminMachineSnapshot[]>;
  getLocalMachineSnapshot?: () => Promise<AdminMachineSnapshot>;
  runWithLock?: <T>(fn: () => Promise<T>) => Promise<{ acquired: true; result: T } | { acquired: false }>;
}

export interface PregeneratedMapPoolAutoTopUpRunResult {
  status:
    | 'disabled'
    | 'no-deficit'
    | 'no-redis'
  | 'no-eligible-machine'
    | 'selected-another-machine'
    | 'lock-busy'
    | 'top-up-skipped'
    | 'top-up-complete';
  selectedProcessId?: string | null;
  localProcessId?: string | null;
  eligibility?: MapPoolTopUpEligibilitySummary;
  overview?: MapPoolAdminOverview;
  topUp?: MapPoolTopUpResult;
}

export interface PregeneratedMapPoolAutoTopUpHandle {
  trigger(): Promise<PregeneratedMapPoolAutoTopUpRunResult | null>;
  close(): void;
}

const DEFAULT_LOCK_KEY = 'voxel-strike:pregenerated-map-pool:auto-top-up';
const DEFAULT_INITIAL_DELAY_MS = 15_000;
const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_MAX_GENERATED_PER_RUN = 4;
const DEFAULT_DEV_INITIAL_DELAY_MS = 1_000;
const DEFAULT_DEV_INTERVAL_MS = 5_000;
const DEFAULT_DEV_MAX_GENERATED_PER_RUN = 16;
const DEFAULT_MACHINE_FRESHNESS_MS = 60_000;
const DEFAULT_LOCK_TTL_MS = 10 * 60_000;
const DEFAULT_LOCK_HEARTBEAT_MS = 15_000;
const DEFAULT_MAX_LOCAL_CCU = 4;
const DEFAULT_MAX_EVENT_LOOP_DELAY_P95_MS = 8;
const DEFAULT_MAX_CAPACITY_PRESSURE = 0.35;
const DEFAULT_DEV_MAX_CAPACITY_PRESSURE = 0.75;
const DEFAULT_CONSOLE_STATUS_SAMPLE_MS = 60_000;

type MapPoolTopUpEligibilityRejectionReason =
  | 'stale-snapshot'
  | 'matchmaker-query-down'
  | 'game-room-active'
  | 'lobby-room-active'
  | 'game-participants-active'
  | 'lobby-participants-active'
  | 'ccu-active'
  | 'process-cpu-high'
  | 'event-loop-delay-high'
  | 'capacity-pressure-high';

export interface MapPoolTopUpEligibilitySummary {
  totalMachineCount: number;
  eligibleMachineCount: number;
  rejectionCounts: Partial<Record<MapPoolTopUpEligibilityRejectionReason, number>>;
  rejectedMachines: Array<{
    processId: string;
    machineId: string;
    region: string | null;
    reasons: MapPoolTopUpEligibilityRejectionReason[];
    localGameRoomCount: number;
    localLobbyRoomCount: number;
    localGameParticipants: number;
    localLobbyParticipants: number;
    localCcu: number;
    processCpuUtilization: number;
    eventLoopDelayP95Ms: number;
    capacityPressure: number;
    snapshotAgeMs: number;
  }>;
}

function readBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return fallback;
}

function readBoundedIntegerEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = value == null || value.trim() === '' ? NaN : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function readBoundedNumberEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = value == null || value.trim() === '' ? NaN : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function hasConfiguredRedis(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.COLYSEUS_REDIS_URL?.trim() || env.REDIS_URL?.trim());
}

function getNodeEnv(env: NodeJS.ProcessEnv): string {
  return env.NODE_ENV?.trim() || 'development';
}

function shouldEnableAutoTopUpByDefault(env: NodeJS.ProcessEnv): boolean {
  const nodeEnv = getNodeEnv(env);
  if (nodeEnv === 'production') return true;
  if (nodeEnv !== 'development') return false;

  return hasConfiguredRedis(env) && readBooleanEnv(env.COLYSEUS_DISTRIBUTED, true);
}

export function getPregeneratedMapPoolAutoTopUpConfig(
  env: NodeJS.ProcessEnv = process.env
): PregeneratedMapPoolAutoTopUpConfig {
  const enabledDefault = shouldEnableAutoTopUpByDefault(env);
  const nodeEnv = getNodeEnv(env);
  const isDevelopment = nodeEnv === 'development';
  const lockTtlMs = readBoundedIntegerEnv(
    env.PREGENERATED_MAP_AUTO_TOP_UP_LOCK_TTL_MS,
    DEFAULT_LOCK_TTL_MS,
    30_000,
    60 * 60_000
  );

  return {
    enabled: readBooleanEnv(env.PREGENERATED_MAP_AUTO_TOP_UP_ENABLED, enabledDefault),
    initialDelayMs: readBoundedIntegerEnv(
      env.PREGENERATED_MAP_AUTO_TOP_UP_INITIAL_DELAY_MS,
      isDevelopment ? DEFAULT_DEV_INITIAL_DELAY_MS : DEFAULT_INITIAL_DELAY_MS,
      0,
      10 * 60_000
    ),
    intervalMs: readBoundedIntegerEnv(
      env.PREGENERATED_MAP_AUTO_TOP_UP_INTERVAL_MS,
      isDevelopment ? DEFAULT_DEV_INTERVAL_MS : DEFAULT_INTERVAL_MS,
      5_000,
      60 * 60_000
    ),
    maxGeneratedPerRun: readBoundedIntegerEnv(
      env.PREGENERATED_MAP_AUTO_TOP_UP_MAX_GENERATED_PER_RUN,
      isDevelopment ? DEFAULT_DEV_MAX_GENERATED_PER_RUN : DEFAULT_MAX_GENERATED_PER_RUN,
      1,
      100
    ),
    machineFreshnessMs: readBoundedIntegerEnv(
      env.PREGENERATED_MAP_AUTO_TOP_UP_MACHINE_FRESHNESS_MS,
      DEFAULT_MACHINE_FRESHNESS_MS,
      5_000,
      10 * 60_000
    ),
    lockKey: env.PREGENERATED_MAP_AUTO_TOP_UP_LOCK_KEY?.trim() || DEFAULT_LOCK_KEY,
    lockTtlMs,
    lockHeartbeatMs: readBoundedIntegerEnv(
      env.PREGENERATED_MAP_AUTO_TOP_UP_LOCK_HEARTBEAT_MS,
      Math.min(DEFAULT_LOCK_HEARTBEAT_MS, Math.max(1_000, Math.floor(lockTtlMs / 3))),
      1_000,
      Math.max(1_000, lockTtlMs - 1)
    ),
    maxLocalGameRooms: readBoundedIntegerEnv(
      env.PREGENERATED_MAP_AUTO_TOP_UP_MAX_LOCAL_GAME_ROOMS,
      0,
      0,
      100
    ),
    maxLocalLobbyRooms: readBoundedIntegerEnv(
      env.PREGENERATED_MAP_AUTO_TOP_UP_MAX_LOCAL_LOBBY_ROOMS,
      0,
      0,
      100
    ),
    maxLocalCcu: readBoundedIntegerEnv(
      env.PREGENERATED_MAP_AUTO_TOP_UP_MAX_LOCAL_CCU,
      DEFAULT_MAX_LOCAL_CCU,
      0,
      10_000
    ),
    maxProcessCpuUtilization: readBoundedNumberEnv(
      env.PREGENERATED_MAP_AUTO_TOP_UP_MAX_PROCESS_CPU,
      0.35,
      0,
      1
    ),
    maxEventLoopDelayP95Ms: readBoundedNumberEnv(
      env.PREGENERATED_MAP_AUTO_TOP_UP_MAX_EVENT_LOOP_DELAY_P95_MS,
      DEFAULT_MAX_EVENT_LOOP_DELAY_P95_MS,
      0,
      500
    ),
    maxCapacityPressure: readBoundedNumberEnv(
      env.PREGENERATED_MAP_AUTO_TOP_UP_MAX_CAPACITY_PRESSURE,
      isDevelopment ? DEFAULT_DEV_MAX_CAPACITY_PRESSURE : DEFAULT_MAX_CAPACITY_PRESSURE,
      0,
      10
    ),
    allowLocalWithoutRedis: readBooleanEnv(
      env.PREGENERATED_MAP_AUTO_TOP_UP_ALLOW_LOCAL_WITHOUT_REDIS,
      false
    ),
  };
}

export function isMachineEligibleForMapPoolTopUp(
  machine: AdminMachineSnapshot,
  config: PregeneratedMapPoolAutoTopUpConfig,
  nowMs = Date.now()
): boolean {
  return getMapPoolTopUpMachineRejectionReasons(machine, config, nowMs).length === 0;
}

export function getMapPoolTopUpMachineRejectionReasons(
  machine: AdminMachineSnapshot,
  config: PregeneratedMapPoolAutoTopUpConfig,
  nowMs = Date.now()
): MapPoolTopUpEligibilityRejectionReason[] {
  const reasons: MapPoolTopUpEligibilityRejectionReason[] = [];
  if (nowMs - machine.updatedAtMs > config.machineFreshnessMs) reasons.push('stale-snapshot');
  if (!machine.matchmakerQueryUp) reasons.push('matchmaker-query-down');
  if (machine.localGameRoomCount > config.maxLocalGameRooms) reasons.push('game-room-active');
  if (machine.localLobbyRoomCount > config.maxLocalLobbyRooms) reasons.push('lobby-room-active');
  if (machine.localGameParticipants > 0) reasons.push('game-participants-active');
  if (machine.localLobbyParticipants > 0) reasons.push('lobby-participants-active');
  if (machine.localCcu > config.maxLocalCcu) reasons.push('ccu-active');
  if (machine.processCpuUtilization > config.maxProcessCpuUtilization) reasons.push('process-cpu-high');
  if (machine.eventLoopDelayP95Ms > config.maxEventLoopDelayP95Ms) reasons.push('event-loop-delay-high');
  if (machine.capacityPressure > config.maxCapacityPressure) reasons.push('capacity-pressure-high');
  return reasons;
}

export function summarizeMapPoolTopUpEligibility(
  machines: AdminMachineSnapshot[],
  config: PregeneratedMapPoolAutoTopUpConfig,
  nowMs = Date.now()
): MapPoolTopUpEligibilitySummary {
  const rejectionCounts: MapPoolTopUpEligibilitySummary['rejectionCounts'] = {};
  const rejectedMachines: MapPoolTopUpEligibilitySummary['rejectedMachines'] = [];
  let eligibleMachineCount = 0;

  for (const machine of machines) {
    const reasons = getMapPoolTopUpMachineRejectionReasons(machine, config, nowMs);
    if (reasons.length === 0) {
      eligibleMachineCount += 1;
      continue;
    }

    for (const reason of reasons) {
      rejectionCounts[reason] = (rejectionCounts[reason] ?? 0) + 1;
    }

    rejectedMachines.push({
      processId: machine.processId,
      machineId: machine.machineId,
      region: machine.region,
      reasons,
      localGameRoomCount: machine.localGameRoomCount,
      localLobbyRoomCount: machine.localLobbyRoomCount,
      localGameParticipants: machine.localGameParticipants,
      localLobbyParticipants: machine.localLobbyParticipants,
      localCcu: machine.localCcu,
      processCpuUtilization: machine.processCpuUtilization,
      eventLoopDelayP95Ms: machine.eventLoopDelayP95Ms,
      capacityPressure: machine.capacityPressure,
      snapshotAgeMs: Math.max(0, nowMs - machine.updatedAtMs),
    });
  }

  return {
    totalMachineCount: machines.length,
    eligibleMachineCount,
    rejectionCounts,
    rejectedMachines: rejectedMachines.slice(0, 8),
  };
}

export function selectMapPoolTopUpMachine(
  machines: AdminMachineSnapshot[],
  config: PregeneratedMapPoolAutoTopUpConfig,
  nowMs = Date.now()
): AdminMachineSnapshot | null {
  const eligible = machines
    .filter((machine) => isMachineEligibleForMapPoolTopUp(machine, config, nowMs))
    .sort((a, b) => (
      a.localCcu - b.localCcu
      || a.capacityPressure - b.capacityPressure
      || a.processCpuUtilization - b.processCpuUtilization
      || a.eventLoopDelayP95Ms - b.eventLoopDelayP95Ms
      || a.localRoomCount - b.localRoomCount
      || (a.region ?? '').localeCompare(b.region ?? '')
      || a.processId.localeCompare(b.processId)
    ));

  return eligible[0] ?? null;
}

function mergeMachineSnapshots(
  snapshots: AdminMachineSnapshot[],
  localSnapshot: AdminMachineSnapshot
): AdminMachineSnapshot[] {
  const byProcess = new Map<string, AdminMachineSnapshot>();
  for (const snapshot of snapshots) byProcess.set(snapshot.processId, snapshot);
  byProcess.set(localSnapshot.processId, localSnapshot);
  return Array.from(byProcess.values());
}

async function defaultLocalMachineSnapshot(
  runtime: PregeneratedMapPoolAutoTopUpRuntime
): Promise<AdminMachineSnapshot> {
  return collectLocalAdminMachineSnapshot({
    matchMaker: runtime.matchMaker,
    config: runtime.config,
    flyReplayRegistered: runtime.flyReplayRegistered(),
  });
}

async function loadMachineSnapshots(input: {
  deps: PregeneratedMapPoolAutoTopUpRunDeps;
  localSnapshot: AdminMachineSnapshot;
}): Promise<AdminMachineSnapshot[] | null> {
  if (input.deps.getMachineSnapshots) {
    return mergeMachineSnapshots(await input.deps.getMachineSnapshots(), input.localSnapshot);
  }
  if (!input.deps.redis) {
    return input.deps.config.allowLocalWithoutRedis ? [input.localSnapshot] : null;
  }
  return mergeMachineSnapshots(
    await listAdminMachineSnapshots(input.deps.redis),
    input.localSnapshot
  );
}

function hasPoolDeficit(overview: MapPoolAdminOverview): boolean {
  return overview.lowSlices.length > 0;
}

function getOverviewConsoleFields(overview: MapPoolAdminOverview | undefined): {
  readyTotal: number | null;
  requiredReadyTotal: number | null;
  reservedTotal: number | null;
  activeTotal: number | null;
  failedTotal: number | null;
  lowSliceCount: number | null;
  lowSlices: MapPoolAdminOverview['lowSlices'];
} {
  return {
    readyTotal: overview?.readyTotal ?? null,
    requiredReadyTotal: overview?.requiredReadyTotal ?? null,
    reservedTotal: overview?.reservedTotal ?? null,
    activeTotal: overview?.activeTotal ?? null,
    failedTotal: overview?.failedTotal ?? null,
    lowSliceCount: overview?.lowSlices.length ?? null,
    lowSlices: overview?.lowSlices.slice(0, 8) ?? [],
  };
}

async function runTopUpUnderLock(
  deps: PregeneratedMapPoolAutoTopUpRunDeps,
  localProcessId: string,
  fn: () => Promise<{ overview: MapPoolAdminOverview; topUp: MapPoolTopUpResult | null }>
): Promise<{ acquired: true; result: Awaited<ReturnType<typeof fn>> } | { acquired: false }> {
  if (deps.runWithLock) return deps.runWithLock(fn);
  if (!deps.redis) return { acquired: true, result: await fn() };

  return runWithRedisOwnerLock(
    deps.redis,
    {
      key: deps.config.lockKey,
      ttlMs: deps.config.lockTtlMs,
      heartbeatMs: deps.config.lockHeartbeatMs,
      ownerToken: `${localProcessId}:${process.pid}:map-pool-top-up`,
    },
    fn
  );
}

export async function runPregeneratedMapPoolAutoTopUpOnce(
  deps: PregeneratedMapPoolAutoTopUpRunDeps
): Promise<PregeneratedMapPoolAutoTopUpRunResult> {
  const config = deps.config;
  if (!config.enabled) return { status: 'disabled' };

  const catalog = deps.catalog ?? pregeneratedMapCatalogService;
  const overview = await catalog.getAdminOverview();
  if (!hasPoolDeficit(overview)) {
    return {
      status: 'no-deficit',
      overview,
    };
  }

  const nowMs = deps.now?.() ?? Date.now();
  const localSnapshot = deps.getLocalMachineSnapshot
    ? await deps.getLocalMachineSnapshot()
    : await defaultLocalMachineSnapshot(deps.runtime);
  const localProcessId = localSnapshot.processId;
  const machines = await loadMachineSnapshots({ deps, localSnapshot });
  if (!machines) {
    return {
      status: 'no-redis',
      localProcessId,
      overview,
    };
  }

  const eligibility = summarizeMapPoolTopUpEligibility(machines, config, nowMs);
  const selected = selectMapPoolTopUpMachine(machines, config, nowMs);
  if (!selected) {
    return {
      status: 'no-eligible-machine',
      localProcessId,
      eligibility,
      overview,
    };
  }
  if (selected.processId !== localProcessId) {
    return {
      status: 'selected-another-machine',
      selectedProcessId: selected.processId,
      localProcessId,
      eligibility,
      overview,
    };
  }

  const locked = await runTopUpUnderLock(deps, localProcessId, async () => {
    const lockedOverview = await catalog.getAdminOverview();
    if (!hasPoolDeficit(lockedOverview)) {
      return { overview: lockedOverview, topUp: null };
    }
    const topUp = await catalog.topUpPool({
      maxGenerated: config.maxGeneratedPerRun,
    });
    const updatedOverview = await catalog.getAdminOverview();
    return { overview: updatedOverview, topUp };
  });

  if (!locked.acquired) {
    return {
      status: 'lock-busy',
      selectedProcessId: selected.processId,
      localProcessId,
      eligibility,
      overview,
    };
  }

  if (!locked.result.topUp) {
    return {
      status: 'no-deficit',
      selectedProcessId: selected.processId,
      localProcessId,
      overview: locked.result.overview,
    };
  }

  return {
    status: 'top-up-complete',
    selectedProcessId: selected.processId,
    localProcessId,
    overview: locked.result.overview,
    topUp: locked.result.topUp,
  };
}

export function startPregeneratedMapPoolAutoTopUp(options: {
  config?: PregeneratedMapPoolAutoTopUpConfig;
  runtime: PregeneratedMapPoolAutoTopUpRuntime;
  redis?: MapPoolAutoTopUpRedisClient | null;
  catalog?: PregeneratedMapPoolAutoTopUpCatalog;
  now?: () => number;
}): PregeneratedMapPoolAutoTopUpHandle {
  const config = options.config ?? getPregeneratedMapPoolAutoTopUpConfig();
  const consoleStatusSampleMs = readBoundedIntegerEnv(
    process.env.PREGENERATED_MAP_POOL_STATUS_SAMPLE_MS,
    DEFAULT_CONSOLE_STATUS_SAMPLE_MS,
    5_000,
    10 * 60_000
  );
  const lastConsoleStatusAtByKey = new Map<string, number>();
  let closed = false;
  let running = false;
  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;

  const writeSampledConsoleStatus = async (
    key: string,
    event: string,
    payload: Record<string, unknown>
  ): Promise<void> => {
    const nowMs = options.now?.() ?? Date.now();
    if (options.redis) {
      const lockKey = `${config.lockKey}:status:${key}`;
      const ownerToken = `${payload.localProcessId ?? 'unknown'}:${process.pid}:status`;
      const acquired = await options.redis.set(lockKey, ownerToken, 'PX', consoleStatusSampleMs, 'NX')
        .catch(() => null);
      if (acquired !== 'OK') return;
      writeMapPoolConsoleStatus(event, payload);
      return;
    }

    const lastWrittenAt = lastConsoleStatusAtByKey.get(key) ?? 0;
    if (lastWrittenAt > 0 && nowMs - lastWrittenAt < consoleStatusSampleMs) return;
    lastConsoleStatusAtByKey.set(key, nowMs);
    writeMapPoolConsoleStatus(event, payload);
  };

  const trigger = async (): Promise<PregeneratedMapPoolAutoTopUpRunResult | null> => {
    if (closed || !config.enabled) return null;
    if (running) return null;
    running = true;
    try {
      const result = await runPregeneratedMapPoolAutoTopUpOnce({
        config,
        runtime: options.runtime,
        redis: options.redis ?? null,
        catalog: options.catalog,
        now: options.now,
      });
      if (result.status === 'top-up-complete' && result.topUp) {
        loggers.room.info('Pregenerated map pool auto top-up completed', {
          generated: result.topUp.generated,
          failed: result.topUp.failed,
          skipped: result.topUp.skipped,
          selectedProcessId: result.selectedProcessId ?? null,
        });
        writeMapPoolConsoleStatus('auto-top-up-complete', {
          selectedProcessId: result.selectedProcessId ?? null,
          localProcessId: result.localProcessId ?? null,
          generated: result.topUp.generated,
          failed: result.topUp.failed,
          skipped: result.topUp.skipped,
          generatedMapCount: result.topUp.generatedMaps.length,
          ...getOverviewConsoleFields(result.overview),
        });
      } else if (result.status === 'no-eligible-machine') {
        loggers.room.sample('map-pool-auto-top-up-no-idle-machine', 60_000, 'No idle machine is eligible for pregenerated map pool auto top-up');
        await writeSampledConsoleStatus('no-eligible-machine', 'auto-top-up-skipped', {
          reason: 'no-eligible-machine',
          selectedProcessId: result.selectedProcessId ?? null,
          localProcessId: result.localProcessId ?? null,
          eligibility: result.eligibility ?? null,
          ...getOverviewConsoleFields(result.overview),
        });
      } else if (result.status === 'no-redis') {
        loggers.room.sample('map-pool-auto-top-up-no-redis', 60_000, 'Pregenerated map pool auto top-up needs Redis or explicit local fallback');
        await writeSampledConsoleStatus('no-redis', 'auto-top-up-skipped', {
          reason: 'no-redis',
          selectedProcessId: result.selectedProcessId ?? null,
          localProcessId: result.localProcessId ?? null,
          ...getOverviewConsoleFields(result.overview),
        });
      } else if (result.status === 'selected-another-machine' || result.status === 'lock-busy' || result.status === 'no-deficit') {
        await writeSampledConsoleStatus(result.status, 'auto-top-up-status', {
          reason: result.status,
          selectedProcessId: result.selectedProcessId ?? null,
          localProcessId: result.localProcessId ?? null,
          ...getOverviewConsoleFields(result.overview),
        });
      }
      return result;
    } catch (error) {
      loggers.room.warn('Pregenerated map pool auto top-up failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      running = false;
    }
  };

  if (config.enabled) {
    initialTimer = setTimeout(() => {
      void trigger();
      interval = setInterval(() => {
        void trigger();
      }, config.intervalMs);
      interval.unref?.();
    }, config.initialDelayMs);
    initialTimer.unref?.();
  }

  return {
    trigger,
    close: () => {
      closed = true;
      if (initialTimer) clearTimeout(initialTimer);
      if (interval) clearInterval(interval);
      initialTimer = null;
      interval = null;
    },
  };
}
