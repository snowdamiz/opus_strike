import {
  AUTOSCALER_MAX_DEMAND_CREATED_MACHINES,
  AUTOSCALER_BOOTSTRAP_PLAYERS_PER_MACHINE,
} from '../autoscaling/policy';
import {
  createServerLoadCapacitySnapshot,
  type LoadCapacityMachine,
  type LoadCapacityRoom,
  type ServerLoadCapacitySnapshot,
} from '../capacity/serverLoadCapacity';
import { getSharedRedisClient } from '../config/redis';
import { runWithRedisOwnerLock, type RedisOwnerLockClient } from '../wagers/workerLock';
import { loggers } from '../utils/logger';
import { listAdminMachineSnapshots, type AdminMachineRedisClient } from '../admin/machineRegistry';

export const IN_GAME_PLAYERS_PER_MACHINE = AUTOSCALER_BOOTSTRAP_PLAYERS_PER_MACHINE;
export const IN_GAME_MAX_MACHINES = AUTOSCALER_MAX_DEMAND_CREATED_MACHINES;
export const MAX_IN_GAME_PLAYERS = IN_GAME_PLAYERS_PER_MACHINE * IN_GAME_MAX_MACHINES;
export const IN_GAME_CAPACITY_RETRY_MS = 5_000;
export const IN_GAME_CAPACITY_LOCK_KEY = 'voxel-strike:matchmaking:in-game-capacity';

const IN_GAME_CAPACITY_LOCK_TTL_MS = 15_000;
const IN_GAME_CAPACITY_LOCK_HEARTBEAT_MS = 5_000;

export interface CapacityRoomListing extends LoadCapacityRoom {
  clients?: number;
  processId?: string;
  metadata?: Record<string, unknown> | null;
}

export interface CapacityMatchMaker {
  query(criteria: { name: string }): Promise<CapacityRoomListing[]>;
}

export interface InGameCapacitySnapshot extends ServerLoadCapacitySnapshot {
  playersPerMachine: number;
  maxMachines: number;
  maxPlayers: number;
  activePlayers: number;
  reservedPlayers: number;
  availablePlayers: number;
  full: boolean;
}

export type InGameCapacityAdmissionFailureReason = 'busy' | 'full';

export class InGameCapacityAdmissionError extends Error {
  constructor(
    readonly reason: InGameCapacityAdmissionFailureReason,
    readonly snapshot: InGameCapacitySnapshot,
    readonly requestedPlayers: number
  ) {
    super(reason === 'full'
      ? `In-game player capacity is full (${snapshot.reservedPlayers}/${snapshot.maxPlayers})`
      : 'In-game capacity admission is busy');
    this.name = 'InGameCapacityAdmissionError';
  }
}

export function isInGameCapacityAdmissionError(error: unknown): error is InGameCapacityAdmissionError {
  return error instanceof InGameCapacityAdmissionError;
}

function machineSnapshotToCapacityMachine(snapshot: LoadCapacityMachine): LoadCapacityMachine {
  return {
    processId: snapshot.processId,
    updatedAtMs: snapshot.updatedAtMs,
    localGamePlayers: snapshot.localGamePlayers,
    localGameRoomCount: snapshot.localGameRoomCount,
    processCpuUtilization: snapshot.processCpuUtilization,
    eventLoopDelayP95Ms: snapshot.eventLoopDelayP95Ms,
    eventLoopDelayP99Ms: snapshot.eventLoopDelayP99Ms,
    heapUsedRatio: snapshot.heapUsedRatio,
    systemMemoryUsedRatio: snapshot.systemMemoryUsedRatio,
    capacityPressure: snapshot.capacityPressure,
  };
}

export function createInGameCapacitySnapshot(
  gameRooms: CapacityRoomListing[],
  machineSnapshots: LoadCapacityMachine[] = []
): InGameCapacitySnapshot {
  return createServerLoadCapacitySnapshot({
    maxMachines: IN_GAME_MAX_MACHINES,
    rooms: gameRooms,
    machines: machineSnapshots.map(machineSnapshotToCapacityMachine),
  });
}

async function collectMachineSnapshots(): Promise<LoadCapacityMachine[]> {
  const redis = getSharedRedisClient();
  if (!redis) return [];

  try {
    return (await listAdminMachineSnapshots(redis as AdminMachineRedisClient)).map(machineSnapshotToCapacityMachine);
  } catch (error) {
    loggers.room.warn('Capacity machine snapshots unavailable; using room metrics only', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function collectInGameCapacitySnapshot(
  matchMaker: CapacityMatchMaker
): Promise<InGameCapacitySnapshot> {
  const [gameRooms, machineSnapshots] = await Promise.all([
    matchMaker.query({ name: 'game_room' }),
    collectMachineSnapshots(),
  ]);
  return createInGameCapacitySnapshot(gameRooms, machineSnapshots);
}

export async function runWithInGameCapacity<T>(
  options: {
    matchMaker: CapacityMatchMaker;
    requestedPlayers: number;
    localProcessId?: string;
  },
  fn: () => Promise<T>
): Promise<{ admitted: true; result: T; snapshot: InGameCapacitySnapshot } | {
  admitted: false;
  reason: InGameCapacityAdmissionFailureReason;
  snapshot: InGameCapacitySnapshot;
}> {
  const requestedPlayers = Math.max(0, Math.ceil(options.requestedPlayers));

  const admit = async () => {
    const snapshot = await collectInGameCapacitySnapshot(options.matchMaker);
    const localMachine = options.localProcessId
      ? snapshot.machines.find((machine) => machine.processId === options.localProcessId)
      : null;
    if (localMachine && requestedPlayers > localMachine.availablePlayers) {
      return { admitted: false as const, reason: 'full' as const, snapshot };
    }
    if (requestedPlayers > snapshot.availablePlayers) {
      return { admitted: false as const, reason: 'full' as const, snapshot };
    }

    return {
      admitted: true as const,
      snapshot,
      result: await fn(),
    };
  };

  if (requestedPlayers <= 0) return admit();

  const redis = getSharedRedisClient();
  if (!redis) return admit();

  try {
    const locked = await runWithRedisOwnerLock(redis as RedisOwnerLockClient, {
      key: IN_GAME_CAPACITY_LOCK_KEY,
      ttlMs: IN_GAME_CAPACITY_LOCK_TTL_MS,
      heartbeatMs: IN_GAME_CAPACITY_LOCK_HEARTBEAT_MS,
    }, admit);

    if (locked.acquired) return locked.result;

    return {
      admitted: false,
      reason: 'busy',
      snapshot: await collectInGameCapacitySnapshot(options.matchMaker),
    };
  } catch (error) {
    loggers.room.warn('Capacity lock unavailable, falling back to unlocked admission check', {
      error: error instanceof Error ? error.message : String(error),
    });
    return admit();
  }
}
