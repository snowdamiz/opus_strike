import {
  MOVEMENT_BIT_CHRONOS_AEGIS,
  MOVEMENT_BIT_CROUCHING,
  MOVEMENT_BIT_GLIDING,
  MOVEMENT_BIT_GRAPPLING,
  MOVEMENT_BIT_GROUNDED,
  MOVEMENT_BIT_JETPACKING,
  MOVEMENT_BIT_SLIDING,
  MOVEMENT_BIT_SPRINTING,
  MOVEMENT_BIT_WALL_RUNNING,
  TRANSFORM_ANGLE_SCALE,
  TRANSFORM_POSITION_SCALE,
  TRANSFORM_VELOCITY_SCALE,
  type PackedPlayerTransform,
} from '@voxel-strike/shared';
import type { Player } from './schema/Player';

interface BuildPackedPlayerTransformInput {
  netId: number;
  player: Player;
  movementEpoch: number;
  chronosAegisActive: boolean;
  chronosAegisShieldByte: number;
}

export const TRANSFORM_HEARTBEAT_INTERVAL_MS = 250;
export const DISTANT_TRANSFORM_HEARTBEAT_INTERVAL_MS = 750;

function quantize(value: number, scale: number): number {
  return Math.round(value * scale);
}

function getMovementBits(player: Player, chronosAegisActive: boolean): number {
  let bits = 0;
  if (player.movement.isGrounded) bits |= MOVEMENT_BIT_GROUNDED;
  if (player.movement.isSprinting) bits |= MOVEMENT_BIT_SPRINTING;
  if (player.movement.isCrouching) bits |= MOVEMENT_BIT_CROUCHING;
  if (player.movement.isSliding) bits |= MOVEMENT_BIT_SLIDING;
  if (player.movement.isWallRunning) bits |= MOVEMENT_BIT_WALL_RUNNING;
  if (player.movement.isGrappling) bits |= MOVEMENT_BIT_GRAPPLING;
  if (player.movement.isJetpacking) bits |= MOVEMENT_BIT_JETPACKING;
  if (player.movement.isGliding) bits |= MOVEMENT_BIT_GLIDING;
  if (chronosAegisActive) bits |= MOVEMENT_BIT_CHRONOS_AEGIS;
  return bits;
}

export function buildPackedPlayerTransform({
  netId,
  player,
  movementEpoch,
  chronosAegisActive,
  chronosAegisShieldByte,
}: BuildPackedPlayerTransformInput): PackedPlayerTransform {
  return [
    netId,
    quantize(player.position.x, TRANSFORM_POSITION_SCALE),
    quantize(player.position.y, TRANSFORM_POSITION_SCALE),
    quantize(player.position.z, TRANSFORM_POSITION_SCALE),
    quantize(player.velocity.x, TRANSFORM_VELOCITY_SCALE),
    quantize(player.velocity.y, TRANSFORM_VELOCITY_SCALE),
    quantize(player.velocity.z, TRANSFORM_VELOCITY_SCALE),
    quantize(player.lookYaw, TRANSFORM_ANGLE_SCALE),
    quantize(player.lookPitch, TRANSFORM_ANGLE_SCALE),
    getMovementBits(player, chronosAegisActive),
    player.movement.wallRunSide === 'left' ? -1 : player.movement.wallRunSide === 'right' ? 1 : 0,
    movementEpoch,
    chronosAegisShieldByte,
  ];
}

export function getPackedTransformSignature(transform: PackedPlayerTransform): PackedPlayerTransform {
  return transform;
}

export function havePackedTransformsChanged(
  previous: PackedPlayerTransform | undefined,
  next: PackedPlayerTransform
): boolean {
  if (!previous) return true;
  for (let index = 0; index < next.length; index++) {
    if (previous[index] !== next[index]) return true;
  }
  return false;
}

export function getPackedTransformHeartbeatInterval(highRelevance: boolean): number {
  return highRelevance
    ? TRANSFORM_HEARTBEAT_INTERVAL_MS
    : DISTANT_TRANSFORM_HEARTBEAT_INTERVAL_MS;
}

export function shouldSendPackedTransformUpdate(input: {
  force: boolean;
  highRelevance: boolean;
  previousSignature: PackedPlayerTransform | undefined;
  signature: PackedPlayerTransform;
  lastHeartbeatAt: number;
  now: number;
}): boolean {
  if (input.force) return true;

  const changed = havePackedTransformsChanged(input.previousSignature, input.signature);
  if (input.highRelevance && changed) return true;

  return input.now - input.lastHeartbeatAt >= getPackedTransformHeartbeatInterval(input.highRelevance);
}

export interface PackedTransformReplicationState {
  signatures: Map<string, PackedPlayerTransform>;
  heartbeatAt: Map<string, number>;
}

export type PackedTransformDelta =
  | { kind: 'visible'; transform: PackedPlayerTransform }
  | { kind: 'hidden'; playerId: string }
  | null;

export interface PackedTransformSnapshot {
  transform: PackedPlayerTransform;
  signature: PackedPlayerTransform;
}

export function selectPackedTransformDelta(input: {
  state: PackedTransformReplicationState;
  playerId: string;
  transform?: PackedPlayerTransform;
  signature?: PackedPlayerTransform;
  getSnapshot?: () => PackedTransformSnapshot;
  exactStateVisible: boolean;
  force: boolean;
  highRelevance?: boolean;
  getHighRelevance?: () => boolean;
  now: number;
}): PackedTransformDelta {
  if (!input.exactStateVisible) {
    const hadTransform = input.state.signatures.delete(input.playerId);
    input.state.heartbeatAt.delete(input.playerId);
    return hadTransform || input.force
      ? { kind: 'hidden', playerId: input.playerId }
      : null;
  }

  let transform = input.transform;
  let signature = input.signature;
  if (!transform || !signature) {
    const snapshot = input.getSnapshot?.();
    if (!snapshot) {
      throw new Error(`Missing packed transform snapshot for visible player ${input.playerId}`);
    }
    transform = snapshot.transform;
    signature = snapshot.signature;
  }
  const previousSignature = input.state.signatures.get(input.playerId);
  const lastHeartbeatAt = input.state.heartbeatAt.get(input.playerId) ?? 0;
  if (!shouldSendPackedTransformUpdate({
    force: input.force,
    highRelevance: input.highRelevance ?? input.getHighRelevance?.() ?? false,
    previousSignature,
    signature,
    lastHeartbeatAt,
    now: input.now,
  })) {
    return null;
  }

  input.state.signatures.set(input.playerId, signature);
  input.state.heartbeatAt.set(input.playerId, input.now);
  return { kind: 'visible', transform };
}
