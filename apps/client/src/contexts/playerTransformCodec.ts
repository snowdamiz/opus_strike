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

export function dequantizeTransform(
  transform: Pick<UnpackedPlayerTransform, 'px' | 'py' | 'pz' | 'vx' | 'vy' | 'vz' | 'yaw' | 'pitch'>
) {
  return {
    position: {
      x: transform.px / TRANSFORM_POSITION_SCALE,
      y: transform.py / TRANSFORM_POSITION_SCALE,
      z: transform.pz / TRANSFORM_POSITION_SCALE,
    },
    velocity: {
      x: transform.vx / TRANSFORM_VELOCITY_SCALE,
      y: transform.vy / TRANSFORM_VELOCITY_SCALE,
      z: transform.vz / TRANSFORM_VELOCITY_SCALE,
    },
    lookYaw: transform.yaw / TRANSFORM_ANGLE_SCALE,
    lookPitch: transform.pitch / TRANSFORM_ANGLE_SCALE,
  };
}

export function movementFromBits(
  transform: MovementBitsTransform,
  fallback: PlayerMovementState
): PlayerMovementState {
  return {
    ...fallback,
    isGrounded: Boolean(transform.movementBits & MOVEMENT_BIT_GROUNDED),
    isSprinting: Boolean(transform.movementBits & MOVEMENT_BIT_SPRINTING),
    isCrouching: Boolean(transform.movementBits & MOVEMENT_BIT_CROUCHING),
    isSliding: Boolean(transform.movementBits & MOVEMENT_BIT_SLIDING),
    isWallRunning: Boolean(transform.movementBits & MOVEMENT_BIT_WALL_RUNNING),
    wallRunSide: transform.wallRunSide === -1 ? 'left' : transform.wallRunSide === 1 ? 'right' : null,
    isGrappling: Boolean(transform.movementBits & MOVEMENT_BIT_GRAPPLING),
    isJetpacking: Boolean(transform.movementBits & MOVEMENT_BIT_JETPACKING),
    isGliding: Boolean(transform.movementBits & MOVEMENT_BIT_GLIDING),
  };
}

export function unpackPackedTransform(transform: PackedPlayerTransform): UnpackedPlayerTransform {
  return {
    netId: transform[0],
    px: transform[1],
    py: transform[2],
    pz: transform[3],
    vx: transform[4],
    vy: transform[5],
    vz: transform[6],
    yaw: transform[7],
    pitch: transform[8],
    movementBits: transform[9],
    wallRunSide: transform[10],
    movementEpoch: transform[11],
    chronosAegisShieldRatio: (transform[12] ?? 255) / 255,
  };
}
