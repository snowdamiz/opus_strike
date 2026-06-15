import { SERVER_LOAD_BOOTSTRAP_PLAYERS_PER_MACHINE } from '../capacity/serverLoadCapacity';

export const AUTOSCALER_BOOTSTRAP_PLAYERS_PER_MACHINE = SERVER_LOAD_BOOTSTRAP_PLAYERS_PER_MACHINE;
export const AUTOSCALER_SPARE_STOPPED_MACHINES = 1;
export const AUTOSCALER_MIN_CREATED_MACHINES = 2;
export const AUTOSCALER_MAX_DEMAND_CREATED_MACHINES = 5;
export const AUTOSCALER_DYNAMIC_PLAYERS_PER_MACHINE_METRIC = 'dynamic_players_per_machine';
export const AUTOSCALER_OVERLOADED_MACHINES_METRIC = 'overloaded_machines';

export const AUTOSCALER_CREATED_MACHINE_COUNT_EXPRESSION =
  `max(running_machines, min(max(max(ceil(demand_players / ${AUTOSCALER_DYNAMIC_PLAYERS_PER_MACHINE_METRIC}) + ${AUTOSCALER_SPARE_STOPPED_MACHINES}, running_machines + ${AUTOSCALER_OVERLOADED_MACHINES_METRIC}), ${AUTOSCALER_MIN_CREATED_MACHINES}), ${AUTOSCALER_MAX_DEMAND_CREATED_MACHINES}))`;

export interface CalculateDesiredCreatedMachinesOptions {
  demandPlayers: number;
  runningMachines: number;
  playersPerMachine?: number;
  spareStoppedMachines?: number;
  minCreatedMachines?: number;
  maxDemandCreatedMachines?: number;
}

function normalizeNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value);
}

export function calculateDesiredCreatedMachines(options: CalculateDesiredCreatedMachinesOptions): number {
  const demandPlayers = normalizeNonNegativeInteger(options.demandPlayers);
  const runningMachines = normalizeNonNegativeInteger(options.runningMachines);
  const playersPerMachine = normalizeNonNegativeInteger(
    options.playersPerMachine ?? AUTOSCALER_BOOTSTRAP_PLAYERS_PER_MACHINE
  ) || AUTOSCALER_BOOTSTRAP_PLAYERS_PER_MACHINE;
  const spareStoppedMachines = normalizeNonNegativeInteger(
    options.spareStoppedMachines ?? AUTOSCALER_SPARE_STOPPED_MACHINES
  );
  const minCreatedMachines = normalizeNonNegativeInteger(
    options.minCreatedMachines ?? AUTOSCALER_MIN_CREATED_MACHINES
  );
  const maxDemandCreatedMachines = normalizeNonNegativeInteger(
    options.maxDemandCreatedMachines ?? AUTOSCALER_MAX_DEMAND_CREATED_MACHINES
  );

  const neededForPlayers = Math.ceil(demandPlayers / playersPerMachine);
  const demandCreatedMachines = Math.min(
    Math.max(neededForPlayers + spareStoppedMachines, minCreatedMachines),
    maxDemandCreatedMachines
  );

  return Math.max(runningMachines, demandCreatedMachines);
}
