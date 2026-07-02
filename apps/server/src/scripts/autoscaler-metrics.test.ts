import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AUTOSCALER_CREATED_MACHINE_COUNT_EXPRESSION,
  calculateDesiredCreatedMachines,
} from '../autoscaling/policy';
import {
  SERVER_LOAD_BOOTSTRAP_PLAYERS_PER_MACHINE,
  SERVER_LOAD_ESTIMATED_ROOM_P99_MS,
  SERVER_LOAD_FULL_MATCH_PLAYERS,
  SERVER_LOAD_TARGET_TICK_BUDGET_MS,
} from '../capacity/serverLoadCapacity';
import {
  IN_GAME_MAX_MACHINES,
  IN_GAME_PLAYERS_PER_MACHINE,
  MAX_IN_GAME_PLAYERS,
  canAdmitInGameCapacity,
  createInGameCapacitySnapshot,
  runWithInGameCapacity,
} from '../matchmaking/playerCapacity';
import {
  collectAutoscalerMetricSnapshot,
  renderPrometheusMetrics,
  type AutoscalerMatchMaker,
  type AutoscalerRoomListing,
} from '../metrics/autoscalerMetrics';
import { ProcessLoadSampler } from '../runtime/processLoad';

class FakeMatchMaker implements AutoscalerMatchMaker {
  processId = 'process-1';

  stats = {
    local: {
      roomCount: 3,
      ccu: 7,
    },
  };

  constructor(
    private readonly lobbyRooms: AutoscalerRoomListing[],
    private readonly queryError: Error | null = null,
    private readonly gameRooms: AutoscalerRoomListing[] = []
  ) {}

  async query(criteria: { name: string }): Promise<AutoscalerRoomListing[]> {
    if (this.queryError) throw this.queryError;
    if (criteria.name === 'lobby_room') return this.lobbyRooms;
    if (criteria.name === 'game_room') return this.gameRooms;
    throw new Error(`Unexpected room query: ${criteria.name}`);
  }
}

interface MachineFleetSnapshot {
  runningMachines: number;
  stoppedMachines: number;
  demandPlayers: number;
}

function calculateDestroyPlan(snapshot: MachineFleetSnapshot): {
  desiredCreatedMachines: number;
  destroyCount: number;
  wouldDestroyStartedMachine: boolean;
} {
  const desiredCreatedMachines = calculateDesiredCreatedMachines({
    demandPlayers: snapshot.demandPlayers,
    runningMachines: snapshot.runningMachines,
  });
  const createdMachines = snapshot.runningMachines + snapshot.stoppedMachines;
  const destroyCount = Math.max(0, createdMachines - desiredCreatedMachines);

  return {
    desiredCreatedMachines,
    destroyCount,
    wouldDestroyStartedMachine: destroyCount > snapshot.stoppedMachines,
  };
}

const STABLE_PROCESS_LOAD = {
  sampledAtMs: 1_000,
  cpuCount: 1,
  processCpuUtilization: 0.2,
  loadAvg1: 0.2,
  loadPct1: 0.2,
  eventLoopDelayP95Ms: 4,
  eventLoopDelayP99Ms: 8,
  heapUsedRatio: 0.2,
  processRssUsedRatio: 0.1,
  systemMemoryUsedRatio: 0.35,
  capacityPressure: 0.35,
};

async function runMetricFormattingTests(): Promise<void> {
  const snapshot = await collectAutoscalerMetricSnapshot({
    matchMaker: new FakeMatchMaker([
      {
        clients: 2,
        metadata: {
          name: 'Alice Secret Lobby',
          roomId: 'room_visible',
          walletAddress: 'wallet_should_not_render',
          participantCount: 5,
          isPublic: true,
        },
      },
      {
        clients: 4,
        metadata: {
          name: 'Private Lobby',
          humanCount: 2,
          botCount: 3,
          isPublic: false,
        },
      },
      {
        clients: 6,
        metadata: null,
      },
    ]),
    redisStatus: { ok: true, status: 'PONG' },
    flyReplayRegistered: true,
    labels: {
      colyseusProcessId: 'process-1',
      flyMachineId: 'machine"quoted',
      flyRegion: 'iad',
    },
    uptime: () => 123.5,
    memoryUsage: () => ({ heapUsed: 456_789 } as NodeJS.MemoryUsage),
    processLoad: () => STABLE_PROCESS_LOAD,
  });

  assert.equal(snapshot.localCcu, 7);
  assert.equal(snapshot.localRoomCount, 3);
  assert.equal(snapshot.lobbyParticipants, 16);
  assert.equal(snapshot.visibleLobbyCount, 2);
  assert.equal(snapshot.flyReplayRegistered, 1);
  assert.equal(snapshot.redisUp, 1);
  assert.equal(snapshot.matchmakerQueryUp, 1);
  assert.equal(snapshot.processCpuUtilization, 0.2);
  assert.equal(snapshot.processEventLoopDelayP95Ms, 4);
  assert.equal(snapshot.processRssUsedRatio, 0.1);
  assert.equal(snapshot.dynamicCapacityPressure, 0.35);
  assert.equal(snapshot.dynamicCapacityPlayersPerMachine, SERVER_LOAD_BOOTSTRAP_PLAYERS_PER_MACHINE);

  const output = renderPrometheusMetrics(snapshot);
  assert.match(output, /# TYPE opus_strike_colyseus_local_ccu gauge/);
  assert.match(
    output,
    /opus_strike_colyseus_local_ccu\{colyseus_process_id="process-1",fly_machine_id="machine\\"quoted",fly_region="iad"\} 7/
  );
  assert.match(output, /opus_strike_colyseus_local_room_count\{[^}]+\} 3/);
  assert.match(output, /opus_strike_lobby_participants\{[^}]+\} 16/);
  assert.match(output, /opus_strike_visible_lobby_count\{[^}]+\} 2/);
  assert.match(output, /opus_strike_fly_replay_registered\{[^}]+\} 1/);
  assert.match(output, /opus_strike_redis_up\{[^}]+\} 1/);
  assert.match(output, /opus_strike_matchmaker_query_up\{[^}]+\} 1/);
  assert.match(output, /opus_strike_process_uptime_seconds\{[^}]+\} 123.5/);
  assert.match(output, /opus_strike_process_heap_used_bytes\{[^}]+\} 456789/);
  assert.match(output, /opus_strike_process_cpu_utilization\{[^}]+\} 0.2/);
  assert.match(output, /opus_strike_process_event_loop_delay_p95_ms\{[^}]+\} 4/);
  assert.match(output, /opus_strike_process_rss_used_ratio\{[^}]+\} 0.1/);
  assert.match(output, /opus_strike_dynamic_capacity_pressure\{[^}]+\} 0.35/);
  assert.match(output, new RegExp(`opus_strike_dynamic_capacity_players_per_machine\\{[^}]+\\} ${SERVER_LOAD_BOOTSTRAP_PLAYERS_PER_MACHINE}`));
  assert.doesNotMatch(output, /Alice|wallet_should_not_render|room_visible|Private Lobby/);
}

function runProcessLoadSamplerTests(): void {
  let nowMs = 1_000;
  let performanceNowMs = 0;
  let cpuUsage: NodeJS.CpuUsage = { user: 0, system: 0 };
  const gib = 1024 ** 3;
  const sampler = new ProcessLoadSampler({
    autoStart: false,
    now: () => nowMs,
    performanceNow: () => performanceNowMs,
    cpuUsage: () => cpuUsage,
    memoryUsage: () => ({
      rss: 160 * 1024 * 1024,
      heapTotal: 64 * 1024 * 1024,
      heapUsed: 32 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0,
    }),
    loadavg: () => [0, 0, 0],
    totalmem: () => 16 * gib,
    freemem: () => 128 * 1024 * 1024,
    cpuCount: () => 10,
    heapSizeLimit: () => 4 * gib,
    eventLoopDelay: {
      percentile: (percentile: number) => (percentile === 95 ? 21 : 22) * 1_000_000,
      reset: () => undefined,
    } as never,
  });

  nowMs += 1_000;
  performanceNowMs += 1_000;
  const snapshot = sampler.sample();

  assert.ok(snapshot.systemMemoryUsedRatio > 0.99);
  assert.equal(snapshot.eventLoopDelayP95Ms, 1);
  assert.ok(snapshot.processRssUsedRatio < 0.01);
  assert.ok(snapshot.capacityPressure < 0.1);
}

async function runMetricFailureTests(): Promise<void> {
  const snapshot = await collectAutoscalerMetricSnapshot({
    matchMaker: new FakeMatchMaker([], new Error('matchmaker offline')),
    redisStatus: { ok: false, status: 'end', error: 'redis offline' },
    flyReplayRegistered: false,
    uptime: () => 1,
    memoryUsage: () => ({ heapUsed: 2 } as NodeJS.MemoryUsage),
    processLoad: () => STABLE_PROCESS_LOAD,
  });

  assert.equal(snapshot.lobbyParticipants, 0);
  assert.equal(snapshot.visibleLobbyCount, 0);
  assert.equal(snapshot.flyReplayRegistered, 0);
  assert.equal(snapshot.redisUp, 0);
  assert.equal(snapshot.matchmakerQueryUp, 0);
  assert.equal(snapshot.matchmakerError, 'matchmaker offline');

  const output = renderPrometheusMetrics(snapshot);
  assert.match(output, /opus_strike_matchmaker_query_up 0/);
  assert.match(output, /opus_strike_redis_up 0/);
  assert.doesNotMatch(output, /matchmaker offline|redis offline/);
}

async function runAutoscalerPolicyTests(): Promise<void> {
  assert.equal(calculateDesiredCreatedMachines({ demandPlayers: 0, runningMachines: 0 }), 2);
  assert.equal(calculateDesiredCreatedMachines({ demandPlayers: 48, runningMachines: 2 }), 2);
  assert.equal(calculateDesiredCreatedMachines({ demandPlayers: 49, runningMachines: 2 }), 3);
  assert.equal(calculateDesiredCreatedMachines({ demandPlayers: 500, runningMachines: 2 }), 5);
  assert.equal(calculateDesiredCreatedMachines({ demandPlayers: 0, runningMachines: 4 }), 4);
  assert.equal(calculateDesiredCreatedMachines({ demandPlayers: 0, runningMachines: 8 }), 8);

  const allRunningAfterDemandDrop = calculateDestroyPlan({
    demandPlayers: 0,
    runningMachines: 6,
    stoppedMachines: 0,
  });
  assert.equal(allRunningAfterDemandDrop.desiredCreatedMachines, 6);
  assert.equal(allRunningAfterDemandDrop.destroyCount, 0);
  assert.equal(allRunningAfterDemandDrop.wouldDestroyStartedMachine, false);

  const partiallyStoppedAfterDemandDrop = calculateDestroyPlan({
    demandPlayers: 0,
    runningMachines: 4,
    stoppedMachines: 2,
  });
  assert.equal(partiallyStoppedAfterDemandDrop.desiredCreatedMachines, 4);
  assert.equal(partiallyStoppedAfterDemandDrop.destroyCount, 2);
  assert.equal(partiallyStoppedAfterDemandDrop.wouldDestroyStartedMachine, false);

  const idleMachinesStoppedByFlyProxy = calculateDestroyPlan({
    demandPlayers: 0,
    runningMachines: 2,
    stoppedMachines: 4,
  });
  assert.equal(idleMachinesStoppedByFlyProxy.desiredCreatedMachines, 2);
  assert.equal(idleMachinesStoppedByFlyProxy.destroyCount, 4);
  assert.equal(idleMachinesStoppedByFlyProxy.wouldDestroyStartedMachine, false);
}

async function runInGameCapacityPolicyTests(): Promise<void> {
  assert.equal(SERVER_LOAD_FULL_MATCH_PLAYERS, 8);
  assert.equal(SERVER_LOAD_TARGET_TICK_BUDGET_MS, 35);
  assert.equal(SERVER_LOAD_ESTIMATED_ROOM_P99_MS, 5.5);
  assert.equal(SERVER_LOAD_BOOTSTRAP_PLAYERS_PER_MACHINE, 48);
  assert.equal(IN_GAME_PLAYERS_PER_MACHINE, SERVER_LOAD_BOOTSTRAP_PLAYERS_PER_MACHINE);
  assert.equal(IN_GAME_MAX_MACHINES, 5);
  assert.equal(MAX_IN_GAME_PLAYERS, 240);

  const snapshot = createInGameCapacitySnapshot([
    { processId: 'process-1', clients: 4, metadata: { humanCount: 4, reservedHumanPlayers: 8 } },
    { processId: 'process-1', clients: 7, metadata: { humanCount: 7 } },
  ], [
    {
      processId: 'process-1',
      updatedAtMs: Date.now(),
      localGamePlayers: 11,
      localGameRoomCount: 2,
      capacityPressure: 0.2,
    },
  ]);

  assert.equal(snapshot.activePlayers, 11);
  assert.equal(snapshot.reservedPlayers, 15);
  assert.equal(snapshot.availablePlayers, 225);
  assert.equal(snapshot.full, false);
  assert.equal(snapshot.source, 'live');
  assert.equal(snapshot.machines[0]?.playersPerMachine, 48);

  const pressuredSnapshot = createInGameCapacitySnapshot([
    { processId: 'process-1', clients: 8, metadata: { humanCount: 8, reservedHumanPlayers: 8, tickDurationP99Ms: 5.5 } },
  ], [
    {
      processId: 'process-1',
      updatedAtMs: Date.now(),
      localGamePlayers: 8,
      localGameRoomCount: 1,
      capacityPressure: 1.25,
    },
  ]);

  assert.equal(pressuredSnapshot.machines[0]?.playersPerMachine, 8);
  assert.equal(pressuredSnapshot.machines[0]?.availablePlayers, 0);

  const battleRoyalSnapshot = createInGameCapacitySnapshot([
    {
      processId: 'process-1',
      clients: 12,
      metadata: {
        gameplayMode: 'battle_royal',
        humanCount: 12,
        reservedHumanPlayers: 12,
        capacityPlayerCost: 50,
      },
    },
  ]);

  assert.equal(battleRoyalSnapshot.activePlayers, 12);
  assert.equal(battleRoyalSnapshot.reservedPlayers, 50);
  assert.equal(battleRoyalSnapshot.availablePlayers, 190);
  assert.equal(battleRoyalSnapshot.machines[0]?.reservedPlayers, 50);

  const oneLocalBattleRoyalSnapshot = createInGameCapacitySnapshot([
    {
      processId: 'process-1',
      clients: 1,
      metadata: {
        gameplayMode: 'battle_royal',
        humanCount: 1,
        reservedHumanPlayers: 1,
        capacityPlayerCost: 33,
      },
    },
  ]);
  assert.equal(oneLocalBattleRoyalSnapshot.machines[0]?.availablePlayers, 15);
  assert.equal(canAdmitInGameCapacity(oneLocalBattleRoyalSnapshot, 33), true);

  const nextBattleRoyalAdmission = await runWithInGameCapacity({
    matchMaker: new FakeMatchMaker([], null, [
      {
        processId: 'process-1',
        clients: 1,
        metadata: {
          gameplayMode: 'battle_royal',
          humanCount: 1,
          reservedHumanPlayers: 1,
          capacityPlayerCost: 33,
        },
      },
    ]),
    requestedPlayers: 33,
  }, async () => 'created');
  assert.equal(nextBattleRoyalAdmission.admitted, true);
  if (!nextBattleRoyalAdmission.admitted) {
    throw new Error('Expected autoscaled fleet capacity admission');
  }
  assert.equal(nextBattleRoyalAdmission.result, 'created');

  const fullSnapshot = createInGameCapacitySnapshot(
    Array.from({ length: 30 }, () => ({ clients: 8, metadata: { humanCount: 8, reservedHumanPlayers: 8 } }))
  );

  assert.equal(fullSnapshot.reservedPlayers, 240);
  assert.equal(fullSnapshot.availablePlayers, 0);
  assert.equal(fullSnapshot.full, true);
}

async function runAutoscalerConfigTests(): Promise<void> {
  const config = await readFile(path.resolve(process.cwd(), 'fly-autoscaler.yml'), 'utf8');

  assert.match(config, new RegExp(`created-machine-count: "${AUTOSCALER_CREATED_MACHINE_COUNT_EXPRESSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(config, /initial-machine-state: "stopped"/);
  assert.match(config, /metric-name: "demand_players"/);
  assert.match(config, /query: "sum\(opus_strike_colyseus_local_ccu\{app='opus-strike-server'\}\) or vector\(0\)"/);
  assert.doesNotMatch(config, /sum\(opus_strike_lobby_participants/);
  assert.match(config, /metric-name: "running_machines"/);
  assert.match(config, /metric-name: "dynamic_players_per_machine"/);
  assert.match(config, /opus_strike_dynamic_capacity_players_per_machine/);
  assert.match(config, /metric-name: "overloaded_machines"/);
  assert.match(config, /opus_strike_dynamic_capacity_pressure/);
  assert.doesNotMatch(config, /started-machine-count:/);
}

async function main(): Promise<void> {
  runProcessLoadSamplerTests();
  await runMetricFormattingTests();
  await runMetricFailureTests();
  await runAutoscalerPolicyTests();
  await runInGameCapacityPolicyTests();
  await runAutoscalerConfigTests();
  console.log('autoscaler metrics tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
