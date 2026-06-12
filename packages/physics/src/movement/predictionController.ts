import type {
  HeroStats,
  MovementCommand,
  PlayerMovementState,
  SelfMovementAuthority,
  Vec3,
} from '@voxel-strike/shared';
import {
  MOVEMENT_COMMAND_BUFFER_SIZE,
  MOVEMENT_HARD_CORRECTION_METERS,
  MOVEMENT_MEDIUM_CORRECTION_METERS,
  MOVEMENT_POSITION_EPSILON_METERS,
  MOVEMENT_SUBSTEP_SECONDS,
  MOVEMENT_VELOCITY_EPSILON_METERS_PER_SECOND,
  compareMovementSeq,
  isMovementSeqAfter,
  movementButtonsToInputState,
} from '@voxel-strike/shared';
import { simulateSharedMovement, type MovementTerrainAdapter } from './sharedSimulator.js';
import type { MovementCollisionWorld } from './CapsuleMotor.js';

export interface MovementSimulationState {
  position: Vec3;
  velocity: Vec3;
  movement: PlayerMovementState;
}

export interface MovementPredictionContext {
  heroStats: HeroStats;
  terrain: MovementTerrainAdapter;
  collisionWorld?: MovementCollisionWorld;
  flagCarrier?: boolean;
  activeSpeedMultiplier?: number;
  chronosAscendantActive?: boolean;
}

export interface PredictionCommandRecord {
  command: MovementCommand;
  predictedState: MovementSimulationState;
}

export interface PredictionCorrectionMetrics {
  ackSeq: number;
  positionError: number;
  velocityError: number;
  replayedCommands: number;
  hardCorrection: boolean;
  mediumCorrection: boolean;
  corrected: boolean;
}

export interface VisualCorrectionOffset {
  x: number;
  y: number;
  z: number;
}

function cloneVec3(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function cloneMovementState(value: PlayerMovementState): PlayerMovementState {
  return {
    ...value,
    grapplePoint: value.grapplePoint ? cloneVec3(value.grapplePoint) : null,
  };
}

export function cloneMovementSimulationState(value: MovementSimulationState): MovementSimulationState {
  return {
    position: cloneVec3(value.position),
    velocity: cloneVec3(value.velocity),
    movement: cloneMovementState(value.movement),
  };
}

function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function movementModesDiffer(a: PlayerMovementState, b: PlayerMovementState): boolean {
  return (
    a.isGrounded !== b.isGrounded ||
    a.isSliding !== b.isSliding ||
    a.isCrouching !== b.isCrouching ||
    a.isSprinting !== b.isSprinting ||
    a.isWallRunning !== b.isWallRunning ||
    a.wallRunSide !== b.wallRunSide ||
    a.isGrappling !== b.isGrappling ||
    a.isGliding !== b.isGliding
  );
}

function applyAuthorityOwnedMovementResources(
  target: PlayerMovementState,
  authority: PlayerMovementState
): void {
  target.isJetpacking = authority.isJetpacking;
  target.jetpackFuel = authority.jetpackFuel;
}

function correctionDurationMs(positionError: number): number {
  if (positionError < MOVEMENT_POSITION_EPSILON_METERS) return 0;
  if (positionError < MOVEMENT_MEDIUM_CORRECTION_METERS) return 100;
  if (positionError < MOVEMENT_HARD_CORRECTION_METERS) return 160;
  return 0;
}

function stateFromAuthority(authority: SelfMovementAuthority): MovementSimulationState {
  return {
    position: cloneVec3(authority.position),
    velocity: cloneVec3(authority.velocity),
    movement: cloneMovementState(authority.movement),
  };
}

export class MovementPredictionController {
  private state: MovementSimulationState | null = null;
  private commandRecords = new Map<number, PredictionCommandRecord>();
  private commandOrder: number[] = [];
  private lastAckSeq = 0;
  private movementEpoch = 0;
  private visualCorrection: VisualCorrectionOffset = { x: 0, y: 0, z: 0 };
  private correctionStartedAtMs = 0;
  private correctionDurationMs = 0;

  initialize(state: MovementSimulationState, movementEpoch = 0, lastAckSeq = 0): void {
    this.state = cloneMovementSimulationState(state);
    this.commandRecords.clear();
    this.commandOrder = [];
    this.lastAckSeq = lastAckSeq;
    this.movementEpoch = Math.max(0, Math.trunc(movementEpoch));
    this.visualCorrection = { x: 0, y: 0, z: 0 };
    this.correctionStartedAtMs = 0;
    this.correctionDurationMs = 0;
  }

  reset(): void {
    this.state = null;
    this.commandRecords.clear();
    this.commandOrder = [];
    this.lastAckSeq = 0;
    this.movementEpoch = 0;
    this.visualCorrection = { x: 0, y: 0, z: 0 };
    this.correctionStartedAtMs = 0;
    this.correctionDurationMs = 0;
  }

  hasState(): boolean {
    return this.state !== null;
  }

  getMovementEpoch(): number {
    return this.movementEpoch;
  }

  getLastAckSeq(): number {
    return this.lastAckSeq;
  }

  getState(): MovementSimulationState | null {
    return this.state ? cloneMovementSimulationState(this.state) : null;
  }

  overwriteState(
    state: MovementSimulationState,
    options: { updateLatestCommandRecord?: boolean } = {}
  ): void {
    const nextState = cloneMovementSimulationState(state);
    this.state = nextState;

    if (options.updateLatestCommandRecord ?? false) {
      const latestSeq = this.commandOrder[this.commandOrder.length - 1];
      const latestRecord = latestSeq !== undefined ? this.commandRecords.get(latestSeq) : undefined;
      if (latestRecord) {
        latestRecord.predictedState = cloneMovementSimulationState(nextState);
      }
    }
  }

  addImpulse(impulse: Vec3): void {
    if (!this.state) return;
    this.state.velocity.x += impulse.x;
    this.state.velocity.y += impulse.y;
    this.state.velocity.z += impulse.z;
    if (impulse.y > 0) {
      this.state.movement.isGrounded = false;
    }
    if (impulse.x !== 0 || impulse.z !== 0) {
      this.state.movement.isSliding = false;
      this.state.movement.slideTimeRemaining = 0;
    }
  }

  step(command: MovementCommand, context: MovementPredictionContext): MovementSimulationState {
    if (!this.state) {
      throw new Error('MovementPredictionController.step called before initialize');
    }

    const result = this.simulateFromState(this.state, command, context);
    this.state = result;
    this.storeCommandRecord(command, result);
    return cloneMovementSimulationState(result);
  }

  reconcile(
    authority: SelfMovementAuthority,
    context: MovementPredictionContext,
    nowMs: number
  ): PredictionCorrectionMetrics {
    if (!this.state) {
      this.initialize(stateFromAuthority(authority), authority.movementEpoch, authority.ackSeq);
      return {
        ackSeq: authority.ackSeq,
        positionError: 0,
        velocityError: 0,
        replayedCommands: 0,
        hardCorrection: false,
        mediumCorrection: false,
        corrected: false,
      };
    }

    if (authority.movementEpoch < this.movementEpoch) {
      return {
        ackSeq: authority.ackSeq,
        positionError: 0,
        velocityError: 0,
        replayedCommands: 0,
        hardCorrection: false,
        mediumCorrection: false,
        corrected: false,
      };
    }

    if (
      authority.movementEpoch === this.movementEpoch &&
      compareMovementSeq(authority.ackSeq, this.lastAckSeq) <= 0 &&
      !authority.correctionReason
    ) {
      return {
        ackSeq: authority.ackSeq,
        positionError: 0,
        velocityError: 0,
        replayedCommands: 0,
        hardCorrection: false,
        mediumCorrection: false,
        corrected: false,
      };
    }

    const previousVisualPosition = this.getVisualPosition(nowMs);

    if (authority.movementEpoch > this.movementEpoch) {
      const epochState = stateFromAuthority(authority);
      const epochPositionError = distance(previousVisualPosition, epochState.position);
      const epochVelocityError = this.state ? distance(this.state.velocity, epochState.velocity) : Infinity;
      this.initialize(epochState, authority.movementEpoch, authority.ackSeq);
      this.beginVisualCorrection(
        previousVisualPosition,
        this.state!.position,
        correctionDurationMs(epochPositionError),
        nowMs
      );
      return {
        ackSeq: authority.ackSeq,
        positionError: epochPositionError,
        velocityError: epochVelocityError,
        replayedCommands: 0,
        hardCorrection: epochPositionError >= MOVEMENT_HARD_CORRECTION_METERS,
        mediumCorrection: epochPositionError >= MOVEMENT_MEDIUM_CORRECTION_METERS && epochPositionError < MOVEMENT_HARD_CORRECTION_METERS,
        corrected: true,
      };
    }

    const authoritativeState = stateFromAuthority(authority);
    const predictedAtAck = this.commandRecords.get(authority.ackSeq)?.predictedState;
    const positionError = predictedAtAck ? distance(predictedAtAck.position, authoritativeState.position) : Infinity;
    const velocityError = predictedAtAck ? distance(predictedAtAck.velocity, authoritativeState.velocity) : Infinity;
    const modesDiffer = predictedAtAck ? movementModesDiffer(predictedAtAck.movement, authoritativeState.movement) : true;

    this.trimAcknowledged(authority.ackSeq);
    this.lastAckSeq = authority.ackSeq;

    const shouldCorrect =
      !Number.isFinite(positionError) ||
      positionError >= MOVEMENT_POSITION_EPSILON_METERS ||
      velocityError >= MOVEMENT_VELOCITY_EPSILON_METERS_PER_SECOND ||
      modesDiffer;

    if (!shouldCorrect) {
      if (this.state) {
        applyAuthorityOwnedMovementResources(this.state.movement, authoritativeState.movement);
      }

      return {
        ackSeq: authority.ackSeq,
        positionError,
        velocityError,
        replayedCommands: 0,
        hardCorrection: false,
        mediumCorrection: false,
        corrected: false,
      };
    }

    const unacked = this.getUnacknowledgedCommands();
    let replayState = authoritativeState;
    for (const command of unacked) {
      replayState = this.simulateFromState(replayState, command, context);
      this.commandRecords.set(command.seq, {
        command,
        predictedState: cloneMovementSimulationState(replayState),
      });
    }

    this.state = replayState;
    const duration = correctionDurationMs(positionError);
    this.beginVisualCorrection(previousVisualPosition, replayState.position, duration, nowMs);

    return {
      ackSeq: authority.ackSeq,
      positionError,
      velocityError,
      replayedCommands: unacked.length,
      hardCorrection: positionError >= MOVEMENT_HARD_CORRECTION_METERS,
      mediumCorrection: positionError >= MOVEMENT_MEDIUM_CORRECTION_METERS && positionError < MOVEMENT_HARD_CORRECTION_METERS,
      corrected: true,
    };
  }

  getVisualCorrectionOffset(nowMs: number): VisualCorrectionOffset {
    if (this.correctionDurationMs <= 0) {
      return { x: 0, y: 0, z: 0 };
    }

    const elapsed = Math.max(0, nowMs - this.correctionStartedAtMs);
    if (elapsed >= this.correctionDurationMs) {
      this.visualCorrection = { x: 0, y: 0, z: 0 };
      this.correctionDurationMs = 0;
      return { x: 0, y: 0, z: 0 };
    }

    const remaining = 1 - elapsed / this.correctionDurationMs;
    return {
      x: this.visualCorrection.x * remaining,
      y: this.visualCorrection.y * remaining,
      z: this.visualCorrection.z * remaining,
    };
  }

  getVisualPosition(nowMs: number): Vec3 {
    const base = this.state?.position ?? { x: 0, y: 0, z: 0 };
    const offset = this.getVisualCorrectionOffset(nowMs);
    return {
      x: base.x + offset.x,
      y: base.y + offset.y,
      z: base.z + offset.z,
    };
  }

  getBufferedCommandCount(): number {
    return this.commandOrder.length;
  }

  clearCommands(): void {
    this.commandRecords.clear();
    this.commandOrder = [];
  }

  private simulateFromState(
    state: MovementSimulationState,
    command: MovementCommand,
    context: MovementPredictionContext
  ): MovementSimulationState {
    const result = simulateSharedMovement({
      position: state.position,
      velocity: state.velocity,
      movement: state.movement,
      heroStats: context.heroStats,
      input: movementButtonsToInputState(command.buttons),
      lookYaw: command.lookYaw,
      deltaTime: MOVEMENT_SUBSTEP_SECONDS,
      terrain: context.terrain,
      collisionWorld: context.collisionWorld,
      flagCarrier: context.flagCarrier,
      activeSpeedMultiplier: context.activeSpeedMultiplier,
      chronosAscendantActive: context.chronosAscendantActive,
    });

    return cloneMovementSimulationState(result);
  }

  private storeCommandRecord(command: MovementCommand, state: MovementSimulationState): void {
    if (!this.commandRecords.has(command.seq)) {
      this.commandOrder.push(command.seq);
    }
    this.commandRecords.set(command.seq, {
      command,
      predictedState: cloneMovementSimulationState(state),
    });

    if (this.commandOrder.length > MOVEMENT_COMMAND_BUFFER_SIZE) {
      const overflow = this.commandOrder.length - MOVEMENT_COMMAND_BUFFER_SIZE;
      const removed = this.commandOrder.splice(0, overflow);
      for (const seq of removed) {
        this.commandRecords.delete(seq);
      }
    }
  }

  private trimAcknowledged(ackSeq: number): void {
    const retained: number[] = [];
    for (const seq of this.commandOrder) {
      if (isMovementSeqAfter(seq, ackSeq)) {
        retained.push(seq);
      } else {
        this.commandRecords.delete(seq);
      }
    }
    this.commandOrder = retained;
  }

  private getUnacknowledgedCommands(): MovementCommand[] {
    return this.commandOrder
      .map((seq) => this.commandRecords.get(seq)?.command)
      .filter((command): command is MovementCommand => Boolean(command))
      .sort((a, b) => compareMovementSeq(a.seq, b.seq));
  }

  private beginVisualCorrection(
    previousVisualPosition: Vec3,
    newPredictedPosition: Vec3,
    durationMs: number,
    nowMs: number
  ): void {
    if (durationMs <= 0) {
      this.visualCorrection = { x: 0, y: 0, z: 0 };
      this.correctionDurationMs = 0;
      return;
    }

    this.visualCorrection = {
      x: previousVisualPosition.x - newPredictedPosition.x,
      y: previousVisualPosition.y - newPredictedPosition.y,
      z: previousVisualPosition.z - newPredictedPosition.z,
    };
    this.correctionStartedAtMs = nowMs;
    this.correctionDurationMs = durationMs;
  }
}
