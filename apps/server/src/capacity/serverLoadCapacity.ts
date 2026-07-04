import { DEFAULT_GAME_CONFIG, TICK_INTERVAL_MS } from '@voxel-strike/shared';

export const SERVER_LOAD_FULL_MATCH_PLAYERS = DEFAULT_GAME_CONFIG.maxPlayers;
export const SERVER_LOAD_TARGET_TICK_BUDGET_RATIO = 0.7;
export const SERVER_LOAD_TARGET_TICK_BUDGET_MS = TICK_INTERVAL_MS * SERVER_LOAD_TARGET_TICK_BUDGET_RATIO;
export const SERVER_LOAD_ESTIMATED_ROOM_P99_MS = 5.5;
export const SERVER_LOAD_MIN_ROOM_P99_MS = 1.5;
export const SERVER_LOAD_MAX_PROJECTED_ROOMS_PER_MACHINE = 12;
export const SERVER_LOAD_BOOTSTRAP_PLAYERS_PER_MACHINE =
  Math.floor(SERVER_LOAD_TARGET_TICK_BUDGET_MS / SERVER_LOAD_ESTIMATED_ROOM_P99_MS) * SERVER_LOAD_FULL_MATCH_PLAYERS;

export interface LoadCapacityRoom {
  clients?: number;
  processId?: string;
  metadata?: Record<string, unknown> | null;
}

export interface LoadCapacityMachine {
  processId: string;
  updatedAtMs?: number;
  localGamePlayers?: number;
  localGameRoomCount?: number;
  processCpuUtilization?: number;
  eventLoopDelayP95Ms?: number;
  eventLoopDelayP99Ms?: number;
  heapUsedRatio?: number;
  processRssUsedRatio?: number;
  systemMemoryUsedRatio?: number;
  capacityPressure?: number;
}

export interface MachineLoadCapacityEstimate {
  processId: string;
  playersPerMachine: number;
  reservedPlayers: number;
  availablePlayers: number;
  gameRoomCount: number;
  averageRoomTickP99Ms: number;
  capacityPressure: number;
  source: 'live' | 'room_metrics' | 'bootstrap';
}

export interface ServerLoadCapacitySnapshot {
  playersPerMachine: number;
  maxMachines: number;
  maxPlayers: number;
  activePlayers: number;
  reservedPlayers: number;
  availablePlayers: number;
  full: boolean;
  capacityPressure: number;
  machineCount: number;
  projectedMachineCount: number;
  source: 'live' | 'room_metrics' | 'bootstrap';
  machines: MachineLoadCapacityEstimate[];
}

export interface CreateServerLoadCapacitySnapshotOptions {
  maxMachines: number;
  rooms: LoadCapacityRoom[];
  machines?: LoadCapacityMachine[];
  nowMs?: number;
  machineFreshnessMs?: number;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
  }
  return null;
}

function floorToFullMatches(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value / SERVER_LOAD_FULL_MATCH_PLAYERS) * SERVER_LOAD_FULL_MATCH_PLAYERS;
}

function roomClientCount(room: LoadCapacityRoom): number {
  return readFiniteNumber(room.clients) ?? 0;
}

export function getActiveHumanPlayers(room: LoadCapacityRoom): number {
  return readFiniteNumber(room.metadata?.humanCount) ?? roomClientCount(room);
}

export function getReservedHumanPlayers(room: LoadCapacityRoom): number {
  return Math.max(
    getActiveHumanPlayers(room),
    readFiniteNumber(room.metadata?.reservedHumanPlayers) ?? 0
  );
}

export function getReservedCapacityPlayers(room: LoadCapacityRoom): number {
  return Math.max(
    getReservedHumanPlayers(room),
    readFiniteNumber(room.metadata?.capacityPlayerCost) ?? 0
  );
}

function roomTickP99Ms(room: LoadCapacityRoom): number | null {
  const tickP99 = readFiniteNumber(room.metadata?.tickDurationP99Ms);
  return tickP99 && tickP99 > 0 ? tickP99 : null;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function estimateCapacityFromTickCost(averageRoomTickP99Ms: number): number {
  const roomCost = Math.max(SERVER_LOAD_MIN_ROOM_P99_MS, averageRoomTickP99Ms || SERVER_LOAD_ESTIMATED_ROOM_P99_MS);
  const projectedRooms = Math.min(
    SERVER_LOAD_MAX_PROJECTED_ROOMS_PER_MACHINE,
    Math.floor(SERVER_LOAD_TARGET_TICK_BUDGET_MS / roomCost)
  );
  return Math.max(SERVER_LOAD_FULL_MATCH_PLAYERS, projectedRooms * SERVER_LOAD_FULL_MATCH_PLAYERS);
}

function estimateMachineCapacity(input: {
  processId: string;
  rooms: LoadCapacityRoom[];
  machine?: LoadCapacityMachine;
}): MachineLoadCapacityEstimate {
  const activePlayers = input.rooms.reduce((sum, room) => sum + getActiveHumanPlayers(room), 0);
  const reservedPlayers = Math.max(
    input.machine?.localGamePlayers ?? 0,
    input.rooms.reduce((sum, room) => sum + getReservedCapacityPlayers(room), 0)
  );
  const tickSamples = input.rooms.map(roomTickP99Ms).filter((value): value is number => value !== null);
  const averageRoomTickP99Ms = tickSamples.length > 0
    ? average(tickSamples)
    : SERVER_LOAD_ESTIMATED_ROOM_P99_MS;
  const tickCapacity = estimateCapacityFromTickCost(averageRoomTickP99Ms);
  const capacityPressure = readFiniteNumber(input.machine?.capacityPressure) ?? 0;
  const pressureCapacity = capacityPressure > 0.05 && Math.max(activePlayers, reservedPlayers) > 0
    ? floorToFullMatches(Math.max(activePlayers, reservedPlayers) / capacityPressure)
    : tickCapacity;
  const playersPerMachine = Math.max(
    SERVER_LOAD_FULL_MATCH_PLAYERS,
    Math.min(tickCapacity, pressureCapacity || SERVER_LOAD_FULL_MATCH_PLAYERS)
  );

  return {
    processId: input.processId,
    playersPerMachine,
    reservedPlayers,
    availablePlayers: Math.max(0, playersPerMachine - reservedPlayers),
    gameRoomCount: input.rooms.length || input.machine?.localGameRoomCount || 0,
    averageRoomTickP99Ms,
    capacityPressure,
    source: tickSamples.length > 0
      ? input.machine
        ? 'live'
        : 'room_metrics'
      : capacityPressure > 0.05 && Math.max(activePlayers, reservedPlayers) > 0
      ? 'live'
      : 'bootstrap',
  };
}

function groupRoomsByProcess(rooms: LoadCapacityRoom[]): Map<string, LoadCapacityRoom[]> {
  const grouped = new Map<string, LoadCapacityRoom[]>();
  for (const room of rooms) {
    const processId = room.processId || 'unknown';
    const list = grouped.get(processId) ?? [];
    list.push(room);
    grouped.set(processId, list);
  }
  return grouped;
}

function isFreshMachine(machine: LoadCapacityMachine, nowMs: number, freshnessMs: number): boolean {
  if (!machine.updatedAtMs) return true;
  return nowMs - machine.updatedAtMs <= freshnessMs;
}

export function createServerLoadCapacitySnapshot(
  options: CreateServerLoadCapacitySnapshotOptions
): ServerLoadCapacitySnapshot {
  const maxMachines = Math.max(1, Math.floor(options.maxMachines));
  const nowMs = options.nowMs ?? Date.now();
  const machineFreshnessMs = options.machineFreshnessMs ?? 60_000;
  const roomsByProcess = groupRoomsByProcess(options.rooms);
  const freshMachines = (options.machines ?? [])
    .filter((machine) => isFreshMachine(machine, nowMs, machineFreshnessMs))
    .slice(0, maxMachines);
  const usedProcessIds = new Set<string>();
  const estimates: MachineLoadCapacityEstimate[] = [];

  for (const machine of freshMachines) {
    usedProcessIds.add(machine.processId);
    estimates.push(estimateMachineCapacity({
      processId: machine.processId,
      machine,
      rooms: roomsByProcess.get(machine.processId) ?? [],
    }));
  }

  for (const [processId, rooms] of roomsByProcess) {
    if (usedProcessIds.has(processId) || estimates.length >= maxMachines) continue;
    estimates.push(estimateMachineCapacity({ processId, rooms }));
  }

  const observedAverageRoomTickP99Ms = average(
    estimates
      .filter((estimate) => estimate.gameRoomCount > 0)
      .map((estimate) => estimate.averageRoomTickP99Ms)
  ) || SERVER_LOAD_ESTIMATED_ROOM_P99_MS;
  const projectedPlayersPerMachine = estimateCapacityFromTickCost(observedAverageRoomTickP99Ms);
  while (estimates.length < maxMachines) {
    estimates.push({
      processId: `projected:${estimates.length + 1}`,
      playersPerMachine: projectedPlayersPerMachine,
      reservedPlayers: 0,
      availablePlayers: projectedPlayersPerMachine,
      gameRoomCount: 0,
      averageRoomTickP99Ms: observedAverageRoomTickP99Ms,
      capacityPressure: 0,
      source: estimates.length === 0 ? 'bootstrap' : 'room_metrics',
    });
  }

  const cappedEstimates = estimates.slice(0, maxMachines);
  const maxPlayers = cappedEstimates.reduce((sum, machine) => sum + machine.playersPerMachine, 0);
  const activePlayers = options.rooms.reduce((sum, room) => sum + getActiveHumanPlayers(room), 0);
  const reservedPlayers = options.rooms.reduce((sum, room) => sum + getReservedCapacityPlayers(room), 0);
  const liveEstimates = cappedEstimates.filter((estimate) => estimate.source === 'live');
  const capacityPressure = maxPlayers > 0 ? reservedPlayers / maxPlayers : 0;
  const source = liveEstimates.length > 0
    ? 'live'
    : cappedEstimates.some((estimate) => estimate.source === 'room_metrics')
    ? 'room_metrics'
    : 'bootstrap';

  return {
    playersPerMachine: Math.floor(maxPlayers / maxMachines),
    maxMachines,
    maxPlayers,
    activePlayers,
    reservedPlayers,
    availablePlayers: Math.max(0, maxPlayers - reservedPlayers),
    full: reservedPlayers >= maxPlayers,
    capacityPressure,
    machineCount: liveEstimates.length,
    projectedMachineCount: cappedEstimates.length,
    source,
    machines: cappedEstimates,
  };
}
