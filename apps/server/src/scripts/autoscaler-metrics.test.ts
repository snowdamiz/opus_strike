import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AUTOSCALER_CREATED_MACHINE_COUNT_EXPRESSION,
  calculateDesiredCreatedMachines,
} from '../autoscaling/policy';
import {
  collectAutoscalerMetricSnapshot,
  renderPrometheusMetrics,
  type AutoscalerMatchMaker,
  type AutoscalerRoomListing,
} from '../metrics/autoscalerMetrics';

class FakeMatchMaker implements AutoscalerMatchMaker {
  stats = {
    local: {
      roomCount: 3,
      ccu: 7,
    },
  };

  constructor(
    private readonly lobbyRooms: AutoscalerRoomListing[],
    private readonly queryError: Error | null = null
  ) {}

  async query(criteria: { name: string }): Promise<AutoscalerRoomListing[]> {
    assert.equal(criteria.name, 'lobby_room');
    if (this.queryError) throw this.queryError;
    return this.lobbyRooms;
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
  });

  assert.equal(snapshot.localCcu, 7);
  assert.equal(snapshot.localRoomCount, 3);
  assert.equal(snapshot.lobbyParticipants, 16);
  assert.equal(snapshot.visibleLobbyCount, 2);
  assert.equal(snapshot.flyReplayRegistered, 1);
  assert.equal(snapshot.redisUp, 1);
  assert.equal(snapshot.matchmakerQueryUp, 1);

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
  assert.doesNotMatch(output, /Alice|wallet_should_not_render|room_visible|Private Lobby/);
}

async function runMetricFailureTests(): Promise<void> {
  const snapshot = await collectAutoscalerMetricSnapshot({
    matchMaker: new FakeMatchMaker([], new Error('matchmaker offline')),
    redisStatus: { ok: false, status: 'end', error: 'redis offline' },
    flyReplayRegistered: false,
    uptime: () => 1,
    memoryUsage: () => ({ heapUsed: 2 } as NodeJS.MemoryUsage),
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
  assert.equal(calculateDesiredCreatedMachines({ demandPlayers: 500, runningMachines: 2 }), 3);
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

async function runAutoscalerConfigTests(): Promise<void> {
  const configPath = path.resolve(process.cwd(), 'fly-autoscaler.yml');
  const config = await readFile(configPath, 'utf8');

  assert.match(config, new RegExp(`created-machine-count: "${AUTOSCALER_CREATED_MACHINE_COUNT_EXPRESSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(config, /initial-machine-state: "stopped"/);
  assert.match(config, /metric-name: "demand_players"/);
  assert.match(config, /query: "sum\(opus_strike_colyseus_local_ccu\{app='opus-strike-server'\}\) or vector\(0\)"/);
  assert.doesNotMatch(config, /sum\(opus_strike_lobby_participants/);
  assert.match(config, /metric-name: "running_machines"/);
  assert.doesNotMatch(config, /started-machine-count:/);
}

async function main(): Promise<void> {
  await runMetricFormattingTests();
  await runMetricFailureTests();
  await runAutoscalerPolicyTests();
  await runAutoscalerConfigTests();
  console.log('autoscaler metrics tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
