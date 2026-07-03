import assert from 'node:assert/strict';
import type { AdminMachineSnapshot } from '../admin/machineRegistry';
import type { MapPoolAdminOverview, MapPoolTopUpOptions, MapPoolTopUpResult } from '../maps/pregeneratedMapCatalog';
import {
  getMapPoolTopUpMachineRejectionReasons,
  getPregeneratedMapPoolAutoTopUpConfig,
  isMachineEligibleForMapPoolTopUp,
  runPregeneratedMapPoolAutoTopUpOnce,
  selectMapPoolTopUpMachine,
  summarizeMapPoolTopUpEligibility,
  type PregeneratedMapPoolAutoTopUpConfig,
} from '../maps/pregeneratedMapPoolAutoTopUp';

const nowMs = Date.UTC(2026, 6, 3, 12);

const config: PregeneratedMapPoolAutoTopUpConfig = {
  enabled: true,
  initialDelayMs: 0,
  intervalMs: 30_000,
  maxGeneratedPerRun: 3,
  machineFreshnessMs: 60_000,
  lockKey: 'test-map-pool-lock',
  lockTtlMs: 60_000,
  lockHeartbeatMs: 10_000,
  maxLocalGameRooms: 0,
  maxLocalLobbyRooms: 0,
  maxLocalCcu: 0,
  maxProcessCpuUtilization: 0.35,
  maxEventLoopDelayP95Ms: 8,
  maxCapacityPressure: 0.25,
  allowLocalWithoutRedis: false,
};

function machine(input: Partial<AdminMachineSnapshot> & { processId: string }): AdminMachineSnapshot {
  return {
    processId: input.processId,
    machineId: input.machineId ?? input.processId,
    appName: input.appName ?? 'opus-strike',
    region: input.region ?? 'iad',
    publicAddress: input.publicAddress ?? null,
    pid: input.pid ?? 100,
    updatedAtMs: input.updatedAtMs ?? nowMs,
    startedAtMs: input.startedAtMs ?? nowMs - 60_000,
    nodeEnv: input.nodeEnv ?? 'production',
    flyReplayRegistered: input.flyReplayRegistered ?? true,
    loadAvg1: input.loadAvg1 ?? 0,
    loadAvg5: input.loadAvg5 ?? 0,
    loadAvg15: input.loadAvg15 ?? 0,
    cpuCount: input.cpuCount ?? 4,
    loadPct1: input.loadPct1 ?? 0,
    memoryRssBytes: input.memoryRssBytes ?? 0,
    heapUsedBytes: input.heapUsedBytes ?? 0,
    heapTotalBytes: input.heapTotalBytes ?? 0,
    processCpuUtilization: input.processCpuUtilization ?? 0.05,
    eventLoopDelayP95Ms: input.eventLoopDelayP95Ms ?? 1,
    eventLoopDelayP99Ms: input.eventLoopDelayP99Ms ?? 2,
    heapUsedRatio: input.heapUsedRatio ?? 0.1,
    systemMemoryUsedRatio: input.systemMemoryUsedRatio ?? 0.2,
    capacityPressure: input.capacityPressure ?? 0.05,
    systemFreeMemoryBytes: input.systemFreeMemoryBytes ?? 0,
    systemTotalMemoryBytes: input.systemTotalMemoryBytes ?? 0,
    processUptimeSeconds: input.processUptimeSeconds ?? 60,
    osUptimeSeconds: input.osUptimeSeconds ?? 120,
    localCcu: input.localCcu ?? 0,
    localRoomCount: input.localRoomCount ?? 0,
    localGameRoomCount: input.localGameRoomCount ?? 0,
    localLobbyRoomCount: input.localLobbyRoomCount ?? 0,
    localGamePlayers: input.localGamePlayers ?? 0,
    localGameBots: input.localGameBots ?? 0,
    localGameParticipants: input.localGameParticipants ?? 0,
    localLobbyParticipants: input.localLobbyParticipants ?? 0,
    matchmakerQueryUp: input.matchmakerQueryUp ?? true,
    matchmakerError: input.matchmakerError ?? null,
  };
}

function overview(lowSlices = 1): MapPoolAdminOverview {
  return {
    requiredReadyTotal: 10,
    readyTotal: 9,
    reservedTotal: 0,
    activeTotal: 0,
    failedTotal: 0,
    retiredTotal: 0,
    artifactBytesTotal: 0,
    oldestReadyCreatedAt: null,
    recentSelectionCount: 0,
    lowSlices: Array.from({ length: lowSlices }, (_, index) => ({
      profileId: 'ctf_arena',
      mapSize: 'small',
      themeId: 'verdant',
      readyCount: index,
      requiredReadyCount: index + 1,
    })),
    failures: [],
  };
}

{
  assert.equal(getPregeneratedMapPoolAutoTopUpConfig({ NODE_ENV: 'development' }).enabled, false);
  assert.equal(getPregeneratedMapPoolAutoTopUpConfig({
    NODE_ENV: 'development',
    COLYSEUS_REDIS_URL: 'redis://localhost:6379',
  }).enabled, true);
  assert.equal(getPregeneratedMapPoolAutoTopUpConfig({
    NODE_ENV: 'development',
    COLYSEUS_REDIS_URL: 'redis://localhost:6379',
  }).initialDelayMs, 1000);
  assert.equal(getPregeneratedMapPoolAutoTopUpConfig({
    NODE_ENV: 'development',
    COLYSEUS_REDIS_URL: 'redis://localhost:6379',
  }).intervalMs, 5000);
  assert.equal(getPregeneratedMapPoolAutoTopUpConfig({
    NODE_ENV: 'development',
    COLYSEUS_REDIS_URL: 'redis://localhost:6379',
  }).maxGeneratedPerRun, 16);
  assert.equal(getPregeneratedMapPoolAutoTopUpConfig({
    NODE_ENV: 'development',
    COLYSEUS_REDIS_URL: 'redis://localhost:6379',
  }).maxCapacityPressure, 0.75);
  assert.equal(getPregeneratedMapPoolAutoTopUpConfig({
    NODE_ENV: 'production',
  }).initialDelayMs, 15_000);
  assert.equal(getPregeneratedMapPoolAutoTopUpConfig({
    NODE_ENV: 'production',
  }).intervalMs, 30_000);
  assert.equal(getPregeneratedMapPoolAutoTopUpConfig({
    NODE_ENV: 'production',
  }).maxGeneratedPerRun, 4);
  assert.equal(getPregeneratedMapPoolAutoTopUpConfig({
    NODE_ENV: 'production',
  }).maxCapacityPressure, 0.35);
  assert.equal(getPregeneratedMapPoolAutoTopUpConfig({
    NODE_ENV: 'production',
  }).maxLocalCcu, 4);
  assert.equal(getPregeneratedMapPoolAutoTopUpConfig({
    NODE_ENV: 'development',
    COLYSEUS_DISTRIBUTED: '0',
    COLYSEUS_REDIS_URL: 'redis://localhost:6379',
  }).enabled, false);
  assert.equal(getPregeneratedMapPoolAutoTopUpConfig({
    NODE_ENV: 'test',
    COLYSEUS_REDIS_URL: 'redis://localhost:6379',
  }).enabled, false);
  assert.equal(getPregeneratedMapPoolAutoTopUpConfig({
    NODE_ENV: 'development',
    COLYSEUS_REDIS_URL: 'redis://localhost:6379',
    PREGENERATED_MAP_AUTO_TOP_UP_ENABLED: '0',
  }).enabled, false);
  assert.equal(getPregeneratedMapPoolAutoTopUpConfig({ NODE_ENV: 'production' }).enabled, true);
}

{
  assert.equal(isMachineEligibleForMapPoolTopUp(machine({ processId: 'idle' }), config, nowMs), true);
  assert.equal(isMachineEligibleForMapPoolTopUp(machine({ processId: 'game', localGameRoomCount: 1 }), config, nowMs), false);
  assert.equal(isMachineEligibleForMapPoolTopUp(machine({ processId: 'lobby', localLobbyRoomCount: 1 }), config, nowMs), false);
  assert.equal(isMachineEligibleForMapPoolTopUp(machine({ processId: 'players', localLobbyParticipants: 1 }), config, nowMs), false);
  assert.equal(isMachineEligibleForMapPoolTopUp(machine({ processId: 'stale', updatedAtMs: nowMs - 120_000 }), config, nowMs), false);
  assert.equal(isMachineEligibleForMapPoolTopUp(machine({ processId: 'cpu', processCpuUtilization: 0.8 }), config, nowMs), false);
  assert.deepEqual(
    getMapPoolTopUpMachineRejectionReasons(machine({ processId: 'pressure', capacityPressure: 0.3 }), config, nowMs),
    ['capacity-pressure-high']
  );
  assert.equal(isMachineEligibleForMapPoolTopUp(
    machine({ processId: 'dev-pressure', capacityPressure: 0.3 }),
    { ...config, maxCapacityPressure: 0.75 },
    nowMs
  ), true);
  const eligibility = summarizeMapPoolTopUpEligibility([
    machine({ processId: 'idle' }),
    machine({ processId: 'pressure', capacityPressure: 0.3 }),
    machine({ processId: 'lobby', localLobbyRoomCount: 1 }),
  ], config, nowMs);
  assert.equal(eligibility.totalMachineCount, 3);
  assert.equal(eligibility.eligibleMachineCount, 1);
  assert.equal(eligibility.rejectionCounts['capacity-pressure-high'], 1);
  assert.equal(eligibility.rejectionCounts['lobby-room-active'], 1);
}

{
  const selected = selectMapPoolTopUpMachine([
    machine({ processId: 'busy-game', localGameRoomCount: 1 }),
    machine({ processId: 'idle-b', capacityPressure: 0.12 }),
    machine({ processId: 'idle-a', capacityPressure: 0.02 }),
  ], config, nowMs);
  assert.equal(selected?.processId, 'idle-a');
}

async function run(): Promise<void> {
  {
    let localSnapshotRead = false;
    const result = await runPregeneratedMapPoolAutoTopUpOnce({
      config,
      runtime: {
        config: { flyReplay: {}, nodeEnv: 'production' } as never,
        matchMaker: { processId: 'local', stats: { local: { roomCount: 0, ccu: 0 } }, query: async () => [] },
        flyReplayRegistered: () => true,
      },
      now: () => nowMs,
      getLocalMachineSnapshot: async () => {
        localSnapshotRead = true;
        return machine({ processId: 'local' });
      },
      getMachineSnapshots: async () => [machine({ processId: 'local' })],
      catalog: {
        getAdminOverview: async () => overview(0),
        topUpPool: async () => {
          throw new Error('should not top up when the pool has no deficit');
        },
      },
    });
    assert.equal(result.status, 'no-deficit');
    assert.equal(result.overview?.lowSlices.length, 0);
    assert.equal(localSnapshotRead, false);
  }

  {
    let topUpCalled = false;
    const result = await runPregeneratedMapPoolAutoTopUpOnce({
      config,
      runtime: {
        config: { flyReplay: {}, nodeEnv: 'production' } as never,
        matchMaker: { processId: 'local', stats: { local: { roomCount: 0, ccu: 0 } }, query: async () => [] },
        flyReplayRegistered: () => true,
      },
      now: () => nowMs,
      getLocalMachineSnapshot: async () => machine({ processId: 'local', capacityPressure: 0.2 }),
      getMachineSnapshots: async () => [machine({ processId: 'remote-idle', capacityPressure: 0.01 })],
      catalog: {
        getAdminOverview: async () => overview(),
        topUpPool: async () => {
          topUpCalled = true;
          return { generated: 1, failed: 0, skipped: 0, generatedMaps: [], slices: [] };
        },
      },
    });
    assert.equal(result.status, 'selected-another-machine');
    assert.equal(result.selectedProcessId, 'remote-idle');
    assert.equal(topUpCalled, false);
  }

  {
    const result = await runPregeneratedMapPoolAutoTopUpOnce({
      config,
      runtime: {
        config: { flyReplay: {}, nodeEnv: 'production' } as never,
        matchMaker: { processId: 'local', stats: { local: { roomCount: 0, ccu: 0 } }, query: async () => [] },
        flyReplayRegistered: () => true,
      },
      now: () => nowMs,
      getLocalMachineSnapshot: async () => machine({ processId: 'local', capacityPressure: 0.3 }),
      getMachineSnapshots: async () => [
        machine({ processId: 'local', capacityPressure: 0.3 }),
        machine({ processId: 'remote', capacityPressure: 0.31 }),
      ],
      catalog: {
        getAdminOverview: async () => overview(),
        topUpPool: async () => {
          throw new Error('should not top up without an eligible machine');
        },
      },
    });
    assert.equal(result.status, 'no-eligible-machine');
    assert.equal(result.eligibility?.totalMachineCount, 2);
    assert.equal(result.eligibility?.eligibleMachineCount, 0);
    assert.equal(result.eligibility?.rejectionCounts['capacity-pressure-high'], 2);
  }

  {
    const topUpOptions: MapPoolTopUpOptions[] = [];
    let lockEntered = false;
    let overviewReads = 0;
    const topUpResult: MapPoolTopUpResult = { generated: 3, failed: 0, skipped: 2, generatedMaps: [], slices: [] };
    const result = await runPregeneratedMapPoolAutoTopUpOnce({
      config,
      runtime: {
        config: { flyReplay: {}, nodeEnv: 'production' } as never,
        matchMaker: { processId: 'local', stats: { local: { roomCount: 0, ccu: 0 } }, query: async () => [] },
        flyReplayRegistered: () => true,
      },
      now: () => nowMs,
      getLocalMachineSnapshot: async () => machine({ processId: 'local', capacityPressure: 0.01 }),
      getMachineSnapshots: async () => [
        machine({ processId: 'busy-us-1', localGameRoomCount: 1, region: 'iad' }),
        machine({ processId: 'busy-us-2', localLobbyRoomCount: 1, region: 'iad' }),
        machine({ processId: 'local', capacityPressure: 0.01, region: 'iad' }),
        machine({ processId: 'eu-busy', localGameRoomCount: 1, region: 'ams' }),
      ],
      runWithLock: async (fn) => {
        lockEntered = true;
        return { acquired: true, result: await fn() };
      },
      catalog: {
        getAdminOverview: async () => {
          overviewReads += 1;
          return overview(overviewReads <= 2 ? 1 : 0);
        },
        topUpPool: async (options?: MapPoolTopUpOptions) => {
          topUpOptions.push(options ?? {});
          return topUpResult;
        },
      },
    });
    assert.equal(result.status, 'top-up-complete');
    assert.equal(lockEntered, true);
    assert.deepEqual(topUpOptions, [{ maxGenerated: config.maxGeneratedPerRun }]);
    assert.equal(result.topUp, topUpResult);
    assert.equal(result.overview?.lowSlices.length, 0);
  }

  {
    const result = await runPregeneratedMapPoolAutoTopUpOnce({
      config,
      runtime: {
        config: { flyReplay: {}, nodeEnv: 'production' } as never,
        matchMaker: { processId: 'local', stats: { local: { roomCount: 0, ccu: 0 } }, query: async () => [] },
        flyReplayRegistered: () => true,
      },
      now: () => nowMs,
      getLocalMachineSnapshot: async () => machine({ processId: 'local' }),
      getMachineSnapshots: async () => [machine({ processId: 'local' })],
      runWithLock: async () => ({ acquired: false }),
      catalog: {
        getAdminOverview: async () => overview(),
        topUpPool: async () => {
          throw new Error('should not top up without lock');
        },
      },
    });
    assert.equal(result.status, 'lock-busy');
  }
}

run()
  .then(() => {
    console.log('pregenerated map pool auto top-up tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
