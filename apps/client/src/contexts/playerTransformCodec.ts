import {
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
  type PlayerMovementState,
} from '@voxel-strike/shared';

export interface UnpackedPlayerTransform {
  netId: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  movementBits: number;
  wallRunSide: -1 | 0 | 1;
  movementEpoch: number;
  chronosAegisShieldRatio: number;
}

type MovementBitsTransform = Pick<UnpackedPlayerTransform, 'movementBits' | 'wallRunSide'>;

export interface DequantizedPlayerTransform {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  lookYaw: number;
  lookPitch: number;
}

export function dequantizeTransform(
  transform: Pick<UnpackedPlayerTransform, 'px' | 'py' | 'pz' | 'vx' | 'vy' | 'vz' | 'yaw' | 'pitch'>
): DequantizedPlayerTransform {
  return writeDequantizedTransform({
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    lookYaw: 0,
    lookPitch: 0,
  }, transform);
}

export function writeDequantizedTransform(
  out: DequantizedPlayerTransform,
  transform: Pick<UnpackedPlayerTransform, 'px' | 'py' | 'pz' | 'vx' | 'vy' | 'vz' | 'yaw' | 'pitch'>
): DequantizedPlayerTransform {
  out.position.x = transform.px / TRANSFORM_POSITION_SCALE;
  out.position.y = transform.py / TRANSFORM_POSITION_SCALE;
  out.position.z = transform.pz / TRANSFORM_POSITION_SCALE;
  out.velocity.x = transform.vx / TRANSFORM_VELOCITY_SCALE;
  out.velocity.y = transform.vy / TRANSFORM_VELOCITY_SCALE;
  out.velocity.z = transform.vz / TRANSFORM_VELOCITY_SCALE;
  out.lookYaw = transform.yaw / TRANSFORM_ANGLE_SCALE;
  out.lookPitch = transform.pitch / TRANSFORM_ANGLE_SCALE;
  return out;
}

export function movementFromBits(
  transform: MovementBitsTransform,
  fallback: PlayerMovementState
): PlayerMovementState {
  return writeMovementFromBits({
    ...fallback,
  }, transform, fallback);
}

export function writeMovementFromBits(
  out: PlayerMovementState,
  transform: MovementBitsTransform,
  fallback: PlayerMovementState
): PlayerMovementState {
  out.isGrounded = Boolean(transform.movementBits & MOVEMENT_BIT_GROUNDED);
  out.isSprinting = Boolean(transform.movementBits & MOVEMENT_BIT_SPRINTING);
  out.isCrouching = Boolean(transform.movementBits & MOVEMENT_BIT_CROUCHING);
  out.isSliding = Boolean(transform.movementBits & MOVEMENT_BIT_SLIDING);
  out.isWallRunning = Boolean(transform.movementBits & MOVEMENT_BIT_WALL_RUNNING);
  out.wallRunSide = transform.wallRunSide === -1 ? 'left' : transform.wallRunSide === 1 ? 'right' : null;
  out.isGrappling = Boolean(transform.movementBits & MOVEMENT_BIT_GRAPPLING);
  out.isJetpacking = Boolean(transform.movementBits & MOVEMENT_BIT_JETPACKING);
  out.isGliding = Boolean(transform.movementBits & MOVEMENT_BIT_GLIDING);
  out.grapplePoint = fallback.grapplePoint;
  return out;
}

export function unpackPackedTransform(transform: PackedPlayerTransform): UnpackedPlayerTransform {
  return unpackPackedTransformInto({
    netId: 0,
    px: 0,
    py: 0,
    pz: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    movementBits: 0,
    wallRunSide: 0,
    movementEpoch: 0,
    chronosAegisShieldRatio: 1,
  }, transform);
}

export function unpackPackedTransformInto(
  out: UnpackedPlayerTransform,
  transform: PackedPlayerTransform
): UnpackedPlayerTransform {
  out.netId = transform[0];
  out.px = transform[1];
  out.py = transform[2];
  out.pz = transform[3];
  out.vx = transform[4];
  out.vy = transform[5];
  out.vz = transform[6];
  out.yaw = transform[7];
  out.pitch = transform[8];
  out.movementBits = transform[9];
  out.wallRunSide = transform[10];
  out.movementEpoch = transform[11];
  out.chronosAegisShieldRatio = (transform[12] ?? 255) / 255;
  return out;
}
