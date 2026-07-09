import type {
  HeroStats,
  MovementCommand,
  PlayerInput,
  PlayerMovementState,
  SelfMovementAck,
  SelfMovementAuthority,
  Vec3,
} from '@voxel-strike/shared';
import {
  MOVEMENT_COMMAND_BUFFER_SIZE,
  MOVEMENT_HARD_CORRECTION_METERS,
  MOVEMENT_MAX_RECONCILE_REPLAY_COMMANDS,
  MOVEMENT_MEDIUM_CORRECTION_METERS,
  MOVEMENT_POSITION_EPSILON_METERS,
  MOVEMENT_SUBSTEP_SECONDS,
  compareMovementSeq,
  isMovementSeqAfter,
  writeMovementButtonsToInputState,
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
  replayBudgetExceeded: boolean;
  hardCorrection: boolean;
  mediumCorrection: boolean;
  corrected: boolean;
  visualCorrectionMagnitude: number;
  visualCorrectionDurationMs: number;
}

export interface VisualCorrectionOffset {
  x: number;
  y: number;
  z: number;
}

type PredictionInputScratch = Pick<
  PlayerInput,
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'jump'
  | 'crouch'
  | 'crouchPressed'
  | 'sprint'
  | 'primaryFire'
  | 'secondaryFire'
  | 'reload'
  | 'ability1'
  | 'ability2'
  | 'ultimate'
  | 'interact'
>;

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

function magnitude(offset: VisualCorrectionOffset): number {
  return Math.sqrt(offset.x * offset.x + offset.y * offset.y + offset.z * offset.z);
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

function emptyCorrectionMetrics(ackSeq: number): PredictionCorrectionMetrics {
  return {
    ackSeq,
    positionError: 0,
    velocityError: 0,
    replayedCommands: 0,
    replayBudgetExceeded: false,
    hardCorrection: false,
    mediumCorrection: false,
    corrected: false,
    visualCorrectionMagnitude: 0,
    visualCorrectionDurationMs: 0,
  };
}

function stateFromAuthority(authority: SelfMovementAuthority): MovementSimulationState {
  return {
    position: cloneVec3(authority.position),
    velocity: cloneVec3(authority.velocity),
    movement: cloneMovementState(authority.movement),
  };
}

function isAuthorityBarrierReason(authority: SelfMovementAuthority): boolean {
  return Boolean(authority.correctionReason && authority.correctionReason !== 'normal');
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
  private readonly commandInputScratch: PredictionInputScratch = {
    moveForward: false,
    moveBackward: false,
    moveLeft: false,
    moveRight: false,
    jump: false,
    crouch: false,
    crouchPressed: false,
    sprint: false,
    primaryFire: false,
    secondaryFire: false,
    reload: false,
    ability1: false,
    ability2: false,
    ultimate: false,
    interact: false,
  };

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
    // simulateFromState returns a new state and the next step replaces (rather
    // than mutates) it. Returning that owned snapshot avoids another nested
    // clone on every 60 Hz prediction substep while preserving prior-step
    // snapshots held by the frame pipeline.
    return result;
  }

  reconcile(
    authority: SelfMovementAuthority,
    context: MovementPredictionContext,
    nowMs: number
  ): PredictionCorrectionMetrics {
    if (!this.state) {
      this.initialize(stateFromAuthority(authority), authority.movementEpoch, authority.ackSeq);
      return emptyCorrectionMetrics(authority.ackSeq);
    }

    if (authority.movementEpoch < this.movementEpoch) {
      return emptyCorrectionMetrics(authority.ackSeq);
    }

    if (
      authority.movementEpoch === this.movementEpoch &&
      compareMovementSeq(authority.ackSeq, this.lastAckSeq) <= 0 &&
      !isAuthorityBarrierReason(authority)
    ) {
      return emptyCorrectionMetrics(authority.ackSeq);
    }

    const previousVisualPosition = this.getVisualPosition(nowMs);

    if (authority.movementEpoch > this.movementEpoch) {
      const epochState = stateFromAuthority(authority);
      const epochPositionError = distance(previousVisualPosition, epochState.position);
      const epochVelocityError = this.state ? distance(this.state.velocity, epochState.velocity) : Infinity;
      this.initialize(epochState, authority.movementEpoch, authority.ackSeq);
      const epochBarrier = isAuthorityBarrierReason(authority);
      const duration = epochBarrier ? 0 : correctionDurationMs(epochPositionError);
      this.beginVisualCorrection(
        previousVisualPosition,
        this.state!.position,
        duration,
        nowMs
      );
      const visualCorrectionMagnitude = duration > 0
        ? distance(previousVisualPosition, this.state!.position)
        : 0;
      return {
        ackSeq: authority.ackSeq,
        positionError: epochPositionError,
        velocityError: epochVelocityError,
        replayedCommands: 0,
        replayBudgetExceeded: false,
        hardCorrection: epochBarrier || epochPositionError >= MOVEMENT_HARD_CORRECTION_METERS,
        mediumCorrection: epochPositionError >= MOVEMENT_MEDIUM_CORRECTION_METERS && epochPositionError < MOVEMENT_HARD_CORRECTION_METERS,
        corrected: true,
        visualCorrectionMagnitude,
        visualCorrectionDurationMs: duration,
      };
    }

    const authoritativeState = stateFromAuthority(authority);
    const predictedAtAck = this.commandRecords.get(authority.ackSeq)?.predictedState;
    const positionError = predictedAtAck ? distance(predictedAtAck.position, authoritativeState.position) : Infinity;
    const velocityError = predictedAtAck ? distance(predictedAtAck.velocity, authoritativeState.velocity) : Infinity;
    const authorityBarrier = isAuthorityBarrierReason(authority);

    this.trimAcknowledged(authority.ackSeq);
    this.lastAckSeq = authority.ackSeq;

    const hardCorrection =
      authorityBarrier ||
      !Number.isFinite(positionError) ||
      positionError >= MOVEMENT_HARD_CORRECTION_METERS;
    if (!hardCorrection) {
      if (this.state) {
        applyAuthorityOwnedMovementResources(this.state.movement, authoritativeState.movement);
      }

      return {
        ackSeq: authority.ackSeq,
        positionError,
        velocityError,
        replayedCommands: 0,
        replayBudgetExceeded: false,
        hardCorrection: false,
        mediumCorrection: false,
        corrected: false,
        visualCorrectionMagnitude: 0,
        visualCorrectionDurationMs: 0,
      };
    }

    const replayBudgetExceeded = this.commandOrder.length > MOVEMENT_MAX_RECONCILE_REPLAY_COMMANDS;
    let replayState = authoritativeState;
    let replayedCommands = 0;
    if (replayBudgetExceeded) {
      // A backlog this large is already outside the server's useful movement
      // window. Rebasing is cheaper and more stable than blocking a render frame
      // on hundreds of collision simulations that will immediately be corrected
      // again as newer acknowledgements arrive.
      this.commandRecords.clear();
      this.commandOrder.length = 0;
    } else {
      for (const seq of this.commandOrder) {
        const record = this.commandRecords.get(seq);
        if (!record) continue;
        // simulateFromState returns a fresh independent state which becomes the running
        // replay state; clone it into the stored record because that snapshot is read by a
        // later reconcile, while replayState keeps flowing into the next substep and is
        // finally adopted as this.state (which gets mutated in place afterwards).
        replayState = this.simulateFromState(replayState, record.command, context);
        record.predictedState = cloneMovementSimulationState(replayState);
        replayedCommands++;
      }
    }

    this.state = replayState;
    const duration = hardCorrection ? 0 : correctionDurationMs(positionError);
    this.beginVisualCorrection(previousVisualPosition, replayState.position, duration, nowMs);
    const visualCorrectionMagnitude = duration > 0
      ? distance(previousVisualPosition, replayState.position)
      : 0;

    return {
      ackSeq: authority.ackSeq,
      positionError,
      velocityError,
      replayedCommands,
      replayBudgetExceeded,
      hardCorrection,
      mediumCorrection: false,
      corrected: true,
      visualCorrectionMagnitude,
      visualCorrectionDurationMs: duration,
    };
  }

  acknowledgeAuthority(
    authority: SelfMovementAuthority,
    context: MovementPredictionContext,
    nowMs: number
  ): PredictionCorrectionMetrics {
    if (
      isAuthorityBarrierReason(authority) ||
      authority.movementEpoch > this.movementEpoch ||
      !this.state
    ) {
      return this.reconcile(authority, context, nowMs);
    }

    if (authority.movementEpoch < this.movementEpoch) {
      return emptyCorrectionMetrics(authority.ackSeq);
    }

    if (
      authority.movementEpoch === this.movementEpoch &&
      compareMovementSeq(authority.ackSeq, this.lastAckSeq) <= 0
    ) {
      return emptyCorrectionMetrics(authority.ackSeq);
    }

    const authoritativeState = stateFromAuthority(authority);
    const predictedAtAck = this.commandRecords.get(authority.ackSeq)?.predictedState;
    const positionError = predictedAtAck ? distance(predictedAtAck.position, authoritativeState.position) : Infinity;
    const velocityError = predictedAtAck ? distance(predictedAtAck.velocity, authoritativeState.velocity) : Infinity;
    if (!Number.isFinite(positionError) || positionError >= MOVEMENT_HARD_CORRECTION_METERS) {
      return this.reconcile(authority, context, nowMs);
    }

    this.trimAcknowledged(authority.ackSeq);
    this.lastAckSeq = authority.ackSeq;
    if (this.state) {
      applyAuthorityOwnedMovementResources(this.state.movement, authoritativeState.movement);
    }

    return {
      ackSeq: authority.ackSeq,
      positionError,
      velocityError,
      replayedCommands: 0,
      replayBudgetExceeded: false,
      hardCorrection: false,
      mediumCorrection: false,
      corrected: false,
      visualCorrectionMagnitude: 0,
      visualCorrectionDurationMs: 0,
    };
  }

  acknowledgeAck(ack: SelfMovementAck): PredictionCorrectionMetrics {
    if (!this.state) return emptyCorrectionMetrics(ack.ackSeq);
    if (ack.movementEpoch !== this.movementEpoch) return emptyCorrectionMetrics(ack.ackSeq);
    if (compareMovementSeq(ack.ackSeq, this.lastAckSeq) <= 0) return emptyCorrectionMetrics(ack.ackSeq);

    this.trimAcknowledged(ack.ackSeq);
    this.lastAckSeq = ack.ackSeq;
    return emptyCorrectionMetrics(ack.ackSeq);
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

  clearVisualCorrection(): void {
    this.visualCorrection = { x: 0, y: 0, z: 0 };
    this.correctionDurationMs = 0;
    this.correctionStartedAtMs = 0;
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
      input: writeMovementButtonsToInputState(command.buttons, this.commandInputScratch),
      lookYaw: command.lookYaw,
      deltaTime: MOVEMENT_SUBSTEP_SECONDS,
      terrain: context.terrain,
      collisionWorld: context.collisionWorld,
      flagCarrier: context.flagCarrier,
      activeSpeedMultiplier: context.activeSpeedMultiplier,
      chronosAscendantActive: context.chronosAscendantActive,
    });

    // simulateSharedMovement always returns a freshly-allocated, fully-independent
    // state (position/velocity/movement are cloned from the inputs inside the motor and
    // never alias any persistent buffer), so the caller can take ownership without an
    // extra defensive clone here. step() and reconcile() each clone independently for the
    // stored command record, and step() clones again for its returned value.
    return result;
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
      for (let index = 0; index < overflow; index++) {
        this.commandRecords.delete(this.commandOrder[index]);
      }
      const retainedCount = this.commandOrder.length - overflow;
      for (let index = 0; index < retainedCount; index++) {
        this.commandOrder[index] = this.commandOrder[index + overflow];
      }
      this.commandOrder.length = retainedCount;
    }
  }

  private trimAcknowledged(ackSeq: number): void {
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.commandOrder.length; readIndex++) {
      const seq = this.commandOrder[readIndex];
      if (isMovementSeqAfter(seq, ackSeq)) {
        this.commandOrder[writeIndex] = seq;
        writeIndex++;
      } else {
        this.commandRecords.delete(seq);
      }
    }
    this.commandOrder.length = writeIndex;
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

    const nextOffset = {
      x: previousVisualPosition.x - newPredictedPosition.x,
      y: previousVisualPosition.y - newPredictedPosition.y,
      z: previousVisualPosition.z - newPredictedPosition.z,
    };
    const remainingMs = this.getCorrectionRemainingMs(nowMs);
    if (remainingMs > 0) {
      const currentMagnitude = magnitude(this.getVisualCorrectionOffset(nowMs));
      const nextMagnitude = magnitude(nextOffset);
      this.visualCorrection = nextOffset;
      this.correctionStartedAtMs = nowMs;
      this.correctionDurationMs = nextMagnitude <= currentMagnitude
        ? remainingMs
        : Math.max(remainingMs, durationMs);
      return;
    }

    this.visualCorrection = nextOffset;
    this.correctionStartedAtMs = nowMs;
    this.correctionDurationMs = durationMs;
  }

  private getCorrectionRemainingMs(nowMs: number): number {
    if (this.correctionDurationMs <= 0) return 0;
    const elapsed = Math.max(0, nowMs - this.correctionStartedAtMs);
    return Math.max(0, this.correctionDurationMs - elapsed);
  }
}
