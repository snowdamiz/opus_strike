import type { HeroStats, PlayerInput, PlayerMovementState, Vec3 } from '@voxel-strike/shared';
import {
  BHOP_AIR_ACCEL,
  BHOP_AIR_SPEED_CAP,
  BHOP_GROUND_ACCEL,
  BHOP_GROUND_FRICTION,
  BHOP_GROUND_STOP_THRESHOLD,
  BHOP_MAX_VELOCITY,
  BHOP_NO_INPUT_FRICTION_MULTIPLIER,
  BHOP_STOP_SPEED,
  CROUCH_MULTIPLIER,
  GRAVITY,
  SLIDE_COOLDOWN,
  SLIDE_DURATION,
  SLIDE_ENTRY_SPEED_CAP_MULTIPLIER,
  SLIDE_FRICTION,
  SLIDE_INITIAL_BOOST,
  SLIDE_JUMP_MAX_SPEED_MULTIPLIER,
  SLIDE_JUMP_SPEED_RETENTION,
  SLIDE_MAX_SPEED_MULTIPLIER,
  SPRINT_MULTIPLIER,
} from '@voxel-strike/shared';

export interface MovementTerrainAdapter {
  getGroundY(position: Vec3): number | null;
  clampPosition(position: Vec3): Vec3;
}

export interface SharedMovementSimulationInput {
  position: Vec3;
  velocity: Vec3;
  movement: PlayerMovementState;
  heroStats: HeroStats;
  input: Pick<PlayerInput, 'moveForward' | 'moveBackward' | 'moveLeft' | 'moveRight' | 'jump' | 'crouch' | 'sprint'>;
  lookYaw: number;
  deltaTime: number;
  terrain: MovementTerrainAdapter;
  flagCarrier?: boolean;
  activeSpeedMultiplier?: number;
}

export interface SharedMovementSimulationResult {
  position: Vec3;
  velocity: Vec3;
  movement: PlayerMovementState;
}

const PLAYER_HALF_HEIGHT = 0.9;
const GROUND_SNAP_DISTANCE = 0.18;

function accelerate(velocity: Vec3, wishDir: Vec3, wishSpeed: number, acceleration: number, dt: number): Vec3 {
  if (wishDir.x === 0 && wishDir.z === 0) {
    return velocity;
  }

  const currentSpeed = velocity.x * wishDir.x + velocity.z * wishDir.z;
  const addSpeed = wishSpeed - currentSpeed;
  if (addSpeed <= 0) {
    return velocity;
  }

  const accelSpeed = Math.min(acceleration * dt * wishSpeed, addSpeed);
  return {
    x: velocity.x + accelSpeed * wishDir.x,
    y: velocity.y,
    z: velocity.z + accelSpeed * wishDir.z,
  };
}

function horizontalSpeed(velocity: Vec3): number {
  return Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
}

function clampHorizontalSpeed(velocity: Vec3, maxSpeed: number): Vec3 {
  const speed = horizontalSpeed(velocity);
  if (speed <= maxSpeed || speed <= 0.0001) {
    return velocity;
  }

  const scale = maxSpeed / speed;
  return {
    x: velocity.x * scale,
    y: velocity.y,
    z: velocity.z * scale,
  };
}

function normalizeHorizontal(vector: Vec3): Vec3 {
  const length = Math.sqrt(vector.x * vector.x + vector.z * vector.z);
  if (length <= 0.0001) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: vector.x / length, y: 0, z: vector.z / length };
}

function getWishDirection(input: SharedMovementSimulationInput['input'], lookYaw: number): Vec3 {
  let dx = 0;
  let dz = 0;
  if (input.moveForward) dz -= 1;
  if (input.moveBackward) dz += 1;
  if (input.moveLeft) dx -= 1;
  if (input.moveRight) dx += 1;

  const local = normalizeHorizontal({ x: dx, y: 0, z: dz });
  const cos = Math.cos(lookYaw);
  const sin = Math.sin(lookYaw);

  return normalizeHorizontal({
    x: local.x * cos - local.z * sin,
    y: 0,
    z: local.x * sin + local.z * cos,
  });
}

export function simulateSharedMovement(input: SharedMovementSimulationInput): SharedMovementSimulationResult {
  const dt = Math.max(0, Math.min(0.1, input.deltaTime));
  const position = { ...input.position };
  let velocity = { ...input.velocity };
  const movement: PlayerMovementState = {
    ...input.movement,
    grapplePoint: input.movement.grapplePoint ? { ...input.movement.grapplePoint } : null,
  };

  const groundY = input.terrain.getGroundY(position);
  const feetY = position.y - PLAYER_HALF_HEIGHT;
  const isNearGround = groundY !== null && feetY <= groundY + GROUND_SNAP_DISTANCE && velocity.y <= 0;
  movement.isGrounded = isNearGround;

  if (movement.isGrounded && groundY !== null) {
    position.y = groundY + PLAYER_HALF_HEIGHT;
    velocity.y = 0;
  }

  const wishDir = getWishDirection(input.input, input.lookYaw);
  const hasMovementInput = wishDir.x !== 0 || wishDir.z !== 0;

  movement.isCrouching = Boolean(input.input.crouch && !movement.isSliding);
  movement.isSprinting = Boolean(input.input.sprint && hasMovementInput && !movement.isCrouching && !movement.isSliding);

  if (movement.slideTimeRemaining > 0) {
    movement.slideTimeRemaining = Math.max(0, movement.slideTimeRemaining - dt);
  }

  const canStartSlide = (
    movement.isGrounded &&
    input.input.crouch &&
    input.input.sprint &&
    hasMovementInput &&
    !movement.isSliding &&
    movement.slideTimeRemaining <= 0
  );

  if (canStartSlide) {
    movement.isSliding = true;
    movement.slideTimeRemaining = SLIDE_DURATION;
    const sprintSpeed = input.heroStats.moveSpeed * SPRINT_MULTIPLIER;
    const slideEntrySpeed = Math.min(
      Math.max(horizontalSpeed(velocity), sprintSpeed),
      sprintSpeed * SLIDE_ENTRY_SPEED_CAP_MULTIPLIER
    );
    const slideSpeed = Math.min(
      slideEntrySpeed * SLIDE_INITIAL_BOOST,
      sprintSpeed * SLIDE_MAX_SPEED_MULTIPLIER
    );
    velocity.x = wishDir.x * slideSpeed;
    velocity.z = wishDir.z * slideSpeed;
  }

  if (movement.isSliding) {
    const sprintSpeed = input.heroStats.moveSpeed * SPRINT_MULTIPLIER;
    const friction = Math.pow(SLIDE_FRICTION, dt * 60);
    velocity.x *= friction;
    velocity.z *= friction;

    if (hasMovementInput) {
      const steer = input.heroStats.moveSpeed * 2.5 * dt;
      velocity.x += wishDir.x * steer;
      velocity.z += wishDir.z * steer;
    }

    velocity = clampHorizontalSpeed(velocity, sprintSpeed * SLIDE_MAX_SPEED_MULTIPLIER);

    const slideJumpRequested = input.input.jump;
    if (movement.slideTimeRemaining <= 0 || slideJumpRequested || horizontalSpeed(velocity) < 2) {
      if (slideJumpRequested) {
        velocity.x *= SLIDE_JUMP_SPEED_RETENTION;
        velocity.z *= SLIDE_JUMP_SPEED_RETENTION;
        velocity = clampHorizontalSpeed(velocity, sprintSpeed * SLIDE_JUMP_MAX_SPEED_MULTIPLIER);
      }
      movement.isSliding = false;
      movement.slideTimeRemaining = SLIDE_COOLDOWN;
    }
  } else {
    let wishSpeed = input.heroStats.moveSpeed * (input.activeSpeedMultiplier ?? 1);
    if (movement.isSprinting) wishSpeed *= SPRINT_MULTIPLIER;
    if (movement.isCrouching) wishSpeed *= CROUCH_MULTIPLIER;
    if (input.flagCarrier) wishSpeed *= 0.85;

    if (movement.isGrounded) {
      const speed = horizontalSpeed(velocity);
      if (speed > 0) {
        const friction = hasMovementInput
          ? BHOP_GROUND_FRICTION
          : BHOP_GROUND_FRICTION * BHOP_NO_INPUT_FRICTION_MULTIPLIER;
        const control = speed < BHOP_STOP_SPEED ? BHOP_STOP_SPEED : speed;
        const drop = control * friction * dt;
        let nextSpeed = Math.max(0, speed - drop);
        if (!hasMovementInput && nextSpeed < BHOP_GROUND_STOP_THRESHOLD) {
          nextSpeed = 0;
        }
        if (nextSpeed !== speed) {
          const scale = nextSpeed / speed;
          velocity.x *= scale;
          velocity.z *= scale;
        }
      }

      velocity = accelerate(velocity, wishDir, wishSpeed, BHOP_GROUND_ACCEL, dt);
    } else {
      velocity = accelerate(velocity, wishDir, Math.min(wishSpeed, BHOP_AIR_SPEED_CAP), BHOP_AIR_ACCEL, dt);
    }
  }

  if (input.input.jump && movement.isGrounded && !movement.isSliding) {
    velocity.y = input.heroStats.jumpForce;
    movement.isGrounded = false;
  }

  if (!movement.isGrounded && !movement.isGrappling && !movement.isWallRunning) {
    velocity.y += GRAVITY * dt;
  }

  const maxHorizontalSpeed = BHOP_MAX_VELOCITY * Math.max(1, input.activeSpeedMultiplier ?? 1);
  const currentHorizontalSpeed = horizontalSpeed(velocity);
  if (currentHorizontalSpeed > maxHorizontalSpeed) {
    const scale = maxHorizontalSpeed / currentHorizontalSpeed;
    velocity.x *= scale;
    velocity.z *= scale;
  }

  position.x += velocity.x * dt;
  position.y += velocity.y * dt;
  position.z += velocity.z * dt;

  const clampedPosition = input.terrain.clampPosition(position);
  if (clampedPosition.x !== position.x) velocity.x = 0;
  if (clampedPosition.z !== position.z) velocity.z = 0;

  const nextGroundY = input.terrain.getGroundY(clampedPosition);
  if (nextGroundY !== null && clampedPosition.y - PLAYER_HALF_HEIGHT <= nextGroundY + GROUND_SNAP_DISTANCE && velocity.y <= 0) {
    clampedPosition.y = nextGroundY + PLAYER_HALF_HEIGHT;
    velocity.y = 0;
    movement.isGrounded = true;
  }

  return {
    position: clampedPosition,
    velocity,
    movement,
  };
}
