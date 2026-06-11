export const AUTOSCALER_PLAYERS_PER_MACHINE = 48;
export const AUTOSCALER_SPARE_STOPPED_MACHINES = 1;
export const AUTOSCALER_MIN_CREATED_MACHINES = 2;
export const AUTOSCALER_MAX_DEMAND_CREATED_MACHINES = 3;

export const AUTOSCALER_CREATED_MACHINE_COUNT_EXPRESSION =
  'max(running_machines, min(max(ceil(demand_players / 48) + 1, 2), 3))';

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
    options.playersPerMachine ?? AUTOSCALER_PLAYERS_PER_MACHINE
  ) || AUTOSCALER_PLAYERS_PER_MACHINE;
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
