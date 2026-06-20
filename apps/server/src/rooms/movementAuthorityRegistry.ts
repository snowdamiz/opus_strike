import type {
  MovementCommand,
  MovementCorrectionReason,
  MovementTelemetrySnapshot,
} from '@voxel-strike/shared';
import { MovementCommandQueue } from './MovementCommandQueue';
import {
  createMovementShadowSimulationState,
  type MovementShadowSimulationState,
} from '../anticheat/movementShadow';
import type { LastSafeMovementState } from './movementValidation';

export interface ServerMovementAuthorityState {
  pendingCommands: MovementCommandQueue;
  lastProcessedSeq: number;
  movementEpoch: number;
  correctionReason: MovementCorrectionReason | null;
  metrics: MovementTelemetrySnapshot;
  commandWindowStartedAt: number;
  commandsInWindow: number;
  lastAuthoritySentAt: number;
  lastSafe: LastSafeMovementState | null;
  objectiveSuppressedUntil: number;
  shadow: MovementShadowSimulationState;
}

export interface MovementAuthorityRegistryOptions {
  maxServerQueue: number;
  maxPacketCommands: number;
  now?: () => number;
}

export class MovementAuthorityRegistry {
  private readonly authorities = new Map<string, ServerMovementAuthorityState>();
  private readonly now: () => number;

  constructor(private readonly options: MovementAuthorityRegistryOptions) {
    this.now = options.now ?? Date.now;
  }

  get(playerId: string): ServerMovementAuthorityState {
    const existing = this.authorities.get(playerId);
    if (existing) return existing;

    const created = this.createState();
    this.authorities.set(playerId, created);
    return created;
  }

  delete(playerId: string): boolean {
    return this.authorities.delete(playerId);
  }

  replacePendingCommands(authority: ServerMovementAuthorityState, commands: readonly MovementCommand[]): void {
    authority.pendingCommands.replace(commands);
  }

  pushPendingCommand(authority: ServerMovementAuthorityState, command: MovementCommand): void {
    authority.pendingCommands.push(command);
  }

  removeOldestPendingCommands(authority: ServerMovementAuthorityState, count: number): void {
    if (count <= 0) return;
    authority.pendingCommands.dropOldest(count);
  }

  getNextMovementCommand(authority: ServerMovementAuthorityState): MovementCommand | null {
    const command = authority.pendingCommands.pop();
    if (command) {
      authority.lastProcessedSeq = command.seq;
    }
    return command;
  }

  private createState(): ServerMovementAuthorityState {
    return {
      pendingCommands: new MovementCommandQueue(this.options.maxServerQueue + this.options.maxPacketCommands),
      lastProcessedSeq: 0,
      movementEpoch: 0,
      correctionReason: null,
      metrics: {
        commandsReceived: 0,
        commandsProcessed: 0,
        commandsProcessedLastTick: 0,
        queueLength: 0,
        queueLengthBeforeTick: 0,
        queueLengthAfterTick: 0,
        underflowTicks: 0,
        catchupTicks: 0,
        catchupSubstepsSkipped: 0,
        catchupSubstepsSkippedLastTick: 0,
        roomCatchupBudgetExhaustedTicks: 0,
        duplicateCommands: 0,
        droppedCommands: 0,
        lateCommands: 0,
        malformedCommands: 0,
        hardCorrections: 0,
        mediumCorrections: 0,
        invalidTransforms: 0,
        speedViolations: 0,
        blockedPathCorrections: 0,
        boundsCorrections: 0,
        objectiveSuppressions: 0,
        abilityRejects: 0,
        rateLimitDrops: 0,
        staleCollisionRevisionDrops: 0,
        lastAckSeq: 0,
        authoritySends: 0,
        lastAckIntervalMs: 0,
      },
      commandWindowStartedAt: this.now(),
      commandsInWindow: 0,
      lastAuthoritySentAt: 0,
      lastSafe: null,
      objectiveSuppressedUntil: 0,
      shadow: createMovementShadowSimulationState(),
    };
  }
}
