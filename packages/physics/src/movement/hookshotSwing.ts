import type { PlayerInput, Vec3 } from '@voxel-strike/shared';
import { GRAVITY } from '@voxel-strike/shared';

export const HOOKSHOT_GRAPPLE_EXTENSION_SPEED = 80;
export const HOOKSHOT_SWING_DURATION_SECONDS = 2.75;
export const HOOKSHOT_SWING_ANCHOR_RELEASE_DISTANCE = 1.15;
export const HOOKSHOT_SWING_MIN_ROPE_LENGTH = HOOKSHOT_SWING_ANCHOR_RELEASE_DISTANCE + 0.35;
export const HOOKSHOT_SWING_TAUTNESS = 0.96;
export const HOOKSHOT_SWING_INITIAL_PULL = 8;
export const HOOKSHOT_SWING_REEL_SPEED = 20;
export const HOOKSHOT_SWING_LOOK_STEER = 34;
export const HOOKSHOT_SWING_INPUT_STEER = 22;
export const HOOKSHOT_SWING_STRAFE_PUMP = 7;
export const HOOKSHOT_SWING_STRAFE_PUMP_MAX_SPEED = 32;
export const HOOKSHOT_SWING_TENSION_FORCE = 76;
export const HOOKSHOT_SWING_REEL_PULL = 18;
export const HOOKSHOT_SWING_GRAVITY_SCALE = 0.9;
export const HOOKSHOT_SWING_MAX_SPEED = 56;
export const HOOKSHOT_SWING_RELEASE_BOOST = 7;
export const HOOKSHOT_SWING_RELEASE_UPWARD = 8;

export type HookshotSwingEndReason = 'anchor' | 'jump' | 'timeout' | 'ground';

export interface HookshotSwingState {
  target: Vec3;
  ropeLength: number;
  initialRopeLength: number;
  elapsedSeconds: number;
  wasAirborne: boolean;
  initialPullApplied: boolean;
}

export interface HookshotSwingStepInput {
  position: Vec3;
  velocity: Vec3;
  swing: HookshotSwingState;
  input: Pick<PlayerInput, 'moveForward' | 'moveBackward' | 'moveLeft' | 'moveRight' | 'jump'>;
  lookYaw: number;
  lookPitch: number;
  isGrounded: boolean;
  deltaTime: number;
}

export interface HookshotSwingStepResult {
  position: Vec3;
  velocity: Vec3;
  swing: HookshotSwingState | null;
  ended: boolean;
  endReason?: HookshotSwingEndReason;
}

function cloneVec3(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function calculateLookDirection(yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  };
}

function horizontalSpeed(velocity: Vec3): number {
  return Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
}

function clampTotalSpeed(velocity: Vec3, maxSpeed: number): Vec3 {
  const speed = Math.sqrt(
    velocity.x * velocity.x +
    velocity.y * velocity.y +
    velocity.z * velocity.z
  );
  if (speed <= maxSpeed || speed <= 0.0001) return velocity;

  const scale = maxSpeed / speed;
  return {
    x: velocity.x * scale,
    y: velocity.y * scale,
    z: velocity.z * scale,
  };
}

function applyReleaseBoost(velocity: Vec3, lookYaw: number, lookPitch: number): Vec3 {
  const next = cloneVec3(velocity);
  const speed = horizontalSpeed(next);
  if (speed > 0.1) {
    next.x += (next.x / speed) * HOOKSHOT_SWING_RELEASE_BOOST;
    next.z += (next.z / speed) * HOOKSHOT_SWING_RELEASE_BOOST;
  }

  const lookDir = calculateLookDirection(lookYaw, lookPitch);
  next.x += lookDir.x * 4;
  next.y += Math.max(0, lookDir.y) * 4;
  next.z += lookDir.z * 4;
  next.y = Math.max(next.y, HOOKSHOT_SWING_RELEASE_UPWARD);
  return next;
}

function ended(
  position: Vec3,
  velocity: Vec3,
  reason: HookshotSwingEndReason
): HookshotSwingStepResult {
  return {
    position,
    velocity,
    swing: null,
    ended: true,
    endReason: reason,
  };
}

export function createHookshotSwingState(
  position: Vec3,
  target: Vec3,
  isGrounded: boolean
): HookshotSwingState {
  const currentLength = distance(position, target);
  const ropeLength = Math.max(
    HOOKSHOT_SWING_MIN_ROPE_LENGTH,
    currentLength * HOOKSHOT_SWING_TAUTNESS
  );

  return {
    target: cloneVec3(target),
    ropeLength,
    initialRopeLength: ropeLength,
    elapsedSeconds: 0,
    wasAirborne: !isGrounded,
    initialPullApplied: false,
  };
}

export function stepHookshotSwing(input: HookshotSwingStepInput): HookshotSwingStepResult {
  const dt = Math.max(0, Math.min(0.1, input.deltaTime));
  const position = cloneVec3(input.position);
  let velocity = cloneVec3(input.velocity);
  const swing: HookshotSwingState = {
    ...input.swing,
    target: cloneVec3(input.swing.target),
  };

  const toTargetX = swing.target.x - position.x;
  const toTargetY = swing.target.y - position.y;
  const toTargetZ = swing.target.z - position.z;
  const currentLength = Math.sqrt(
    toTargetX * toTargetX +
    toTargetY * toTargetY +
    toTargetZ * toTargetZ
  );

  if (currentLength <= HOOKSHOT_SWING_ANCHOR_RELEASE_DISTANCE) {
    return ended(
      position,
      applyReleaseBoost(velocity, input.lookYaw, input.lookPitch),
      'anchor'
    );
  }
  if (currentLength <= 0.001) {
    return ended(position, velocity, 'anchor');
  }

  const ropeDirX = toTargetX / currentLength;
  const ropeDirY = toTargetY / currentLength;
  const ropeDirZ = toTargetZ / currentLength;

  if (!swing.initialPullApplied) {
    velocity.x += ropeDirX * HOOKSHOT_SWING_INITIAL_PULL;
    velocity.y += ropeDirY * HOOKSHOT_SWING_INITIAL_PULL;
    velocity.z += ropeDirZ * HOOKSHOT_SWING_INITIAL_PULL;
    velocity.y = Math.max(velocity.y, 5);
    swing.initialPullApplied = true;
  }

  if (input.isGrounded && swing.wasAirborne) {
    return ended(position, velocity, 'ground');
  }
  if (!input.isGrounded) {
    swing.wasAirborne = true;
  }

  swing.elapsedSeconds += dt;
  if (swing.elapsedSeconds >= HOOKSHOT_SWING_DURATION_SECONDS) {
    return ended(position, velocity, 'timeout');
  }
  if (input.input.jump) {
    return ended(
      position,
      applyReleaseBoost(velocity, input.lookYaw, input.lookPitch),
      'jump'
    );
  }

  const lookDir = calculateLookDirection(input.lookYaw, input.lookPitch);
  const lookAlongRope = lookDir.x * ropeDirX + lookDir.y * ropeDirY + lookDir.z * ropeDirZ;
  const lookPerpX = lookDir.x - ropeDirX * lookAlongRope;
  const lookPerpY = lookDir.y - ropeDirY * lookAlongRope;
  const lookPerpZ = lookDir.z - ropeDirZ * lookAlongRope;
  const lookPerpLen = Math.sqrt(lookPerpX * lookPerpX + lookPerpY * lookPerpY + lookPerpZ * lookPerpZ);

  if (lookPerpLen > 0.05) {
    const lookInfluence = 0.35 + Math.min(lookPerpLen, 1) * 0.65;
    const lookForce = HOOKSHOT_SWING_LOOK_STEER * lookInfluence * dt;
    velocity.x += (lookPerpX / lookPerpLen) * lookForce;
    velocity.y += (lookPerpY / lookPerpLen) * lookForce;
    velocity.z += (lookPerpZ / lookPerpLen) * lookForce;
  }

  const isPureStrafing = input.input.moveLeft !== input.input.moveRight &&
    !input.input.moveForward &&
    !input.input.moveBackward;
  let wishDirX = 0;
  let wishDirZ = 0;
  if (isPureStrafing && input.input.moveLeft) {
    wishDirX -= Math.cos(input.lookYaw);
    wishDirZ += Math.sin(input.lookYaw);
  }
  if (isPureStrafing && input.input.moveRight) {
    wishDirX += Math.cos(input.lookYaw);
    wishDirZ -= Math.sin(input.lookYaw);
  }

  const wishLen = Math.sqrt(wishDirX * wishDirX + wishDirZ * wishDirZ);
  if (wishLen > 0.1) {
    wishDirX /= wishLen;
    wishDirZ /= wishLen;

    const wishAlongRope = wishDirX * ropeDirX + wishDirZ * ropeDirZ;
    const wishPerpX = wishDirX - ropeDirX * wishAlongRope;
    const wishPerpY = -ropeDirY * wishAlongRope;
    const wishPerpZ = wishDirZ - ropeDirZ * wishAlongRope;
    const wishPerpLen = Math.sqrt(wishPerpX * wishPerpX + wishPerpY * wishPerpY + wishPerpZ * wishPerpZ);

    if (wishPerpLen > 0.05) {
      const inputForce = HOOKSHOT_SWING_INPUT_STEER * dt;
      const tangentX = wishPerpX / wishPerpLen;
      const tangentY = wishPerpY / wishPerpLen;
      const tangentZ = wishPerpZ / wishPerpLen;
      velocity.x += tangentX * inputForce;
      velocity.y += tangentY * inputForce * 0.6;
      velocity.z += tangentZ * inputForce;

      const speed = horizontalSpeed(velocity);
      if (speed < HOOKSHOT_SWING_STRAFE_PUMP_MAX_SPEED) {
        const pumpScale = 1 - speed / HOOKSHOT_SWING_STRAFE_PUMP_MAX_SPEED;
        const pumpForce = HOOKSHOT_SWING_STRAFE_PUMP * pumpScale * dt;
        const pumpX = speed > 0.1 ? velocity.x / speed : tangentX;
        const pumpZ = speed > 0.1 ? velocity.z / speed : tangentZ;
        velocity.x += pumpX * pumpForce;
        velocity.z += pumpZ * pumpForce;
      }
    }
  }

  velocity.y += GRAVITY * HOOKSHOT_SWING_GRAVITY_SCALE * dt;

  swing.ropeLength = Math.max(
    HOOKSHOT_SWING_MIN_ROPE_LENGTH,
    (swing.ropeLength || currentLength) - HOOKSHOT_SWING_REEL_SPEED * dt
  );

  const ropeLength = swing.ropeLength || currentLength;
  if (currentLength > ropeLength) {
    const awaySpeed = velocity.x * -ropeDirX + velocity.y * -ropeDirY + velocity.z * -ropeDirZ;
    if (awaySpeed > 0) {
      velocity.x += ropeDirX * awaySpeed;
      velocity.y += ropeDirY * awaySpeed;
      velocity.z += ropeDirZ * awaySpeed;
    }

    const overExtend = currentLength - ropeLength;
    const tensionForce = overExtend * HOOKSHOT_SWING_TENSION_FORCE * dt;
    velocity.x += ropeDirX * tensionForce;
    velocity.y += ropeDirY * tensionForce;
    velocity.z += ropeDirZ * tensionForce;

    position.x = swing.target.x - ropeDirX * ropeLength;
    position.y = swing.target.y - ropeDirY * ropeLength;
    position.z = swing.target.z - ropeDirZ * ropeLength;
  }

  velocity.x += ropeDirX * HOOKSHOT_SWING_REEL_PULL * dt;
  velocity.y += ropeDirY * HOOKSHOT_SWING_REEL_PULL * dt * 0.75;
  velocity.z += ropeDirZ * HOOKSHOT_SWING_REEL_PULL * dt;

  if (position.y < swing.target.y) {
    const heightDiff = swing.target.y - position.y;
    const swingBoost = Math.min(heightDiff * 0.45, 4);
    const speed = horizontalSpeed(velocity);
    if (speed > 0.1) {
      velocity.x += (velocity.x / speed) * swingBoost * dt;
      velocity.z += (velocity.z / speed) * swingBoost * dt;
    }
  }

  velocity = clampTotalSpeed(velocity, HOOKSHOT_SWING_MAX_SPEED);

  return {
    position,
    velocity,
    swing,
    ended: false,
  };
}
