import {
  MOVEMENT_COMMAND_STALE_GRACE_STEPS,
  MOVEMENT_MAX_COMMANDS_PER_SECOND,
  MOVEMENT_MAX_PACKET_COMMANDS,
  MOVEMENT_MAX_SERVER_QUEUE,
  MOVEMENT_PROTOCOL_VERSION,
  isMovementSeqAfter,
  movementSeqDistance,
  parseMovementCommandPayload,
  type MovementCommand,
  type MovementCommandPacket,
} from '@voxel-strike/shared';
import type { ServerMovementAuthorityState } from './movementAuthorityRegistry';
import type { RoomSecurityEventInput } from './securityEventLogging';

export type MovementCommandRejectReason =
  | 'malformed_command'
  | 'epoch_mismatch'
  | 'collision_revision'
  | 'duplicate_command'
  | 'duplicate_queued_command';

export interface MovementCommandRejection {
  type: 'movement_command_reject';
  movementEpoch: number;
  movementSequence?: number;
  reason: MovementCommandRejectReason;
  detail: Record<string, unknown>;
}

export type IncomingMovementCommandSanitization =
  | {
      ok: true;
      command: MovementCommand;
      acceptedStaleCollisionRevision?: boolean;
    }
  | {
      ok: false;
      rejection: MovementCommandRejection;
    };

export type MovementCommandIngressSecurityEvent = Omit<RoomSecurityEventInput, 'playerId' | 'userId' | 'position'>;

export interface MovementCommandPacketIngressInput {
  authority: ServerMovementAuthorityState;
  packet: unknown;
  now: number;
  currentCollisionRevision: number;
  protocolVersion?: number;
  maxPacketCommands?: number;
  maxCommandsPerSecond?: number;
  maxServerQueue?: number;
}

export interface MovementCommandPacketIngressResult {
  acceptedCommandCount: number;
  acceptedStaleCollisionRevisionCount: number;
  overflow: number;
  discardedCommandCount: number;
  shouldMarkQueueOverflowBarrier: boolean;
  events: MovementCommandIngressSecurityEvent[];
}

export interface MovementQueueOverflowBarrierPolicyInput {
  queueLength: number;
  maxServerQueue: number;
}

export interface MovementQueueOverflowBarrierPolicy {
  overflow: number;
  discardedCommandCount: number;
  shouldMarkQueueOverflowBarrier: boolean;
  detail: Record<string, unknown> | null;
}

const MOVEMENT_COMMAND_SHAPE_KEYS = [
  'seq',
  'buttons',
  'lookYaw',
  'lookPitch',
  'clientTimeMs',
  'movementEpoch',
  'collisionRevision',
  'abilityCastHints',
  'clientState',
] as const;

export function promoteMovementCommandAcrossAuthorityBarrier(
  command: MovementCommand,
  movementEpoch: number
): MovementCommand {
  const promoted = {
    ...command,
    movementEpoch,
  };
  // The snapshot was predicted from the old epoch and must not overwrite post-barrier server movement.
  delete promoted.clientState;
  return promoted;
}

function buildMalformedCommandDetail(command: unknown): Record<string, unknown> {
  const isObject = command !== null && typeof command === 'object';
  const record = isObject ? command as Record<string, unknown> : null;

  return {
    commandType: Array.isArray(command) ? 'array' : typeof command,
    commandKeys: record ? Object.keys(record).slice(0, 12) : undefined,
    commandShape: record
      ? Object.fromEntries(
        MOVEMENT_COMMAND_SHAPE_KEYS.map((key) => [key, typeof record[key]])
      )
      : undefined,
  };
}

function rejectMovementCommand(
  authority: ServerMovementAuthorityState,
  reason: MovementCommandRejectReason,
  detail: Record<string, unknown>,
  movementSequence?: number
): IncomingMovementCommandSanitization {
  return {
    ok: false,
    rejection: {
      type: 'movement_command_reject',
      movementEpoch: authority.movementEpoch,
      movementSequence,
      reason,
      detail,
    },
  };
}

export function sanitizeIncomingMovementCommand(input: {
  authority: ServerMovementAuthorityState;
  command: unknown;
  currentCollisionRevision: number;
}): IncomingMovementCommandSanitization {
  const { authority, command, currentCollisionRevision } = input;
  const sanitized = parseMovementCommandPayload(command);

  if (!sanitized) {
    authority.metrics.malformedCommands++;
    return rejectMovementCommand(
      authority,
      'malformed_command',
      buildMalformedCommandDetail(command)
    );
  }

  if (sanitized.movementEpoch !== authority.movementEpoch) {
    const canPromotePreviousEpochCommand = (
      sanitized.movementEpoch + 1 === authority.movementEpoch &&
      isMovementSeqAfter(sanitized.seq, authority.lastProcessedSeq) &&
      movementSeqDistance(authority.lastProcessedSeq, sanitized.seq) <= MOVEMENT_COMMAND_STALE_GRACE_STEPS
    );

    if (canPromotePreviousEpochCommand) {
      return {
        ok: true,
        command: promoteMovementCommandAcrossAuthorityBarrier(sanitized, authority.movementEpoch),
      };
    }

    authority.metrics.lateCommands++;
    authority.correctionReason = 'epoch_mismatch';
    return rejectMovementCommand(
      authority,
      'epoch_mismatch',
      {
        commandEpoch: sanitized.movementEpoch,
        authorityEpoch: authority.movementEpoch,
        lastProcessedSeq: authority.lastProcessedSeq,
      },
      sanitized.seq
    );
  }

  const commandCollisionRevision = sanitized.collisionRevision ?? 0;
  if (commandCollisionRevision > currentCollisionRevision) {
    authority.metrics.staleCollisionRevisionDrops = (authority.metrics.staleCollisionRevisionDrops ?? 0) + 1;
    authority.correctionReason = 'collision_revision';
    return rejectMovementCommand(
      authority,
      'collision_revision',
      {
        commandRevision: commandCollisionRevision,
        currentRevision: currentCollisionRevision,
      },
      sanitized.seq
    );
  }

  if (!isMovementSeqAfter(sanitized.seq, authority.lastProcessedSeq)) {
    authority.metrics.duplicateCommands++;
    return rejectMovementCommand(
      authority,
      'duplicate_command',
      { lastProcessedSeq: authority.lastProcessedSeq },
      sanitized.seq
    );
  }

  if (authority.pendingCommands.hasSeq(sanitized.seq)) {
    authority.metrics.duplicateCommands++;
    return rejectMovementCommand(
      authority,
      'duplicate_queued_command',
      { queueLength: authority.pendingCommands.length },
      sanitized.seq
    );
  }

  return {
    ok: true,
    command: sanitized,
    acceptedStaleCollisionRevision: commandCollisionRevision < currentCollisionRevision,
  };
}

export function getMovementQueueOverflowBarrierPolicy(
  input: MovementQueueOverflowBarrierPolicyInput
): MovementQueueOverflowBarrierPolicy {
  const overflow = Math.max(0, input.queueLength - input.maxServerQueue);
  if (overflow <= 0) {
    return {
      overflow: 0,
      discardedCommandCount: 0,
      shouldMarkQueueOverflowBarrier: false,
      detail: null,
    };
  }

  const discardedCommandCount = input.queueLength;
  return {
    overflow,
    discardedCommandCount,
    shouldMarkQueueOverflowBarrier: true,
    detail: {
      overflow,
      discardedCommands: discardedCommandCount,
      maxQueue: input.maxServerQueue,
      policy: 'clear_queue_on_barrier',
    },
  };
}

export function ingestMovementCommandPacket(
  input: MovementCommandPacketIngressInput
): MovementCommandPacketIngressResult {
  const {
    authority,
    packet,
    now,
    currentCollisionRevision,
    protocolVersion = MOVEMENT_PROTOCOL_VERSION,
    maxPacketCommands = MOVEMENT_MAX_PACKET_COMMANDS,
    maxCommandsPerSecond = MOVEMENT_MAX_COMMANDS_PER_SECOND,
    maxServerQueue = MOVEMENT_MAX_SERVER_QUEUE,
  } = input;
  const events: MovementCommandIngressSecurityEvent[] = [];

  if (now - authority.commandWindowStartedAt >= 1000) {
    authority.commandWindowStartedAt = now;
    authority.commandsInWindow = 0;
  }

  const movementPacket = packet as Partial<MovementCommandPacket> | null | undefined;
  const commands = movementPacket?.commands;
  if (
    !movementPacket ||
    movementPacket.protocolVersion !== protocolVersion ||
    !Array.isArray(commands) ||
    commands.length === 0 ||
    commands.length > maxPacketCommands
  ) {
    authority.metrics.malformedCommands++;
    events.push({
      type: 'malformed_message',
      movementEpoch: authority.movementEpoch,
      reason: 'movementCommands',
      detail: {
        protocolVersion: movementPacket?.protocolVersion,
        commandCount: Array.isArray(commands) ? commands.length : null,
      },
    });
    authority.metrics.queueLength = authority.pendingCommands.length;
    return {
      acceptedCommandCount: 0,
      acceptedStaleCollisionRevisionCount: 0,
      overflow: 0,
      discardedCommandCount: 0,
      shouldMarkQueueOverflowBarrier: false,
      events,
    };
  }

  let acceptedCommandCount = 0;
  let acceptedStaleCollisionRevisionCount = 0;
  for (const rawCommand of commands) {
    if (authority.commandsInWindow >= maxCommandsPerSecond) {
      authority.metrics.droppedCommands++;
      events.push({
        type: 'movement_command_drop',
        movementEpoch: authority.movementEpoch,
        reason: 'command_rate_limit',
        detail: {
          commandsInWindow: authority.commandsInWindow,
          limit: maxCommandsPerSecond,
        },
      });
      continue;
    }

    const sanitized = sanitizeIncomingMovementCommand({
      authority,
      command: rawCommand,
      currentCollisionRevision,
    });
    if (!sanitized.ok) {
      events.push(sanitized.rejection);
      continue;
    }

    authority.commandsInWindow++;
    authority.metrics.commandsReceived++;
    if (sanitized.acceptedStaleCollisionRevision) {
      acceptedStaleCollisionRevisionCount++;
      authority.metrics.staleCollisionRevisionCommands = (
        authority.metrics.staleCollisionRevisionCommands ?? 0
      ) + 1;
    }
    authority.pendingCommands.push(sanitized.command);
    acceptedCommandCount++;
  }

  const overflowPolicy = getMovementQueueOverflowBarrierPolicy({
    queueLength: authority.pendingCommands.length,
    maxServerQueue,
  });
  if (overflowPolicy.shouldMarkQueueOverflowBarrier) {
    authority.metrics.droppedCommands += overflowPolicy.discardedCommandCount;
    events.push({
      type: 'movement_command_drop',
      movementEpoch: authority.movementEpoch,
      reason: 'queue_overflow',
      detail: overflowPolicy.detail ?? {},
    });
  }

  authority.metrics.queueLength = authority.pendingCommands.length;
  return {
    acceptedCommandCount,
    acceptedStaleCollisionRevisionCount,
    overflow: overflowPolicy.overflow,
    discardedCommandCount: overflowPolicy.discardedCommandCount,
    shouldMarkQueueOverflowBarrier: overflowPolicy.shouldMarkQueueOverflowBarrier,
    events,
  };
}
