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
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SLIDE_COOLDOWN,
  SLIDE_DURATION,
  SLIDE_ENTRY_SPEED_CAP_MULTIPLIER,
  SLIDE_FRICTION,
  SLIDE_INITIAL_BOOST,
  SLIDE_JUMP_MAX_SPEED_MULTIPLIER,
  SLIDE_JUMP_SPEED_RETENTION,
  SLIDE_MAX_SPEED_MULTIPLIER,
  STEP_HEIGHT,
  SPRINT_MULTIPLIER,
  isCollisionBlock,
} from '@voxel-strike/shared';

export interface MovementTerrainAdapter {
  getGroundY(position: Vec3): number | null;
  clampPosition(position: Vec3): Vec3;
  getBlockAtWorld?: (position: Vec3) => number;
}

export interface SharedMovementSimulationInput {
  position: Vec3;
  velocity: Vec3;
  movement: PlayerMovementState;
  heroStats: HeroStats;
  input: Pick<PlayerInput, 'moveForward' | 'moveBackward' | 'moveLeft' | 'moveRight' | 'jump' | 'crouch' | 'crouchPressed' | 'sprint'>;
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

const PLAYER_HALF_HEIGHT = PLAYER_HEIGHT / 2;
const GROUND_SNAP_DISTANCE = 0.18;
const MAX_GROUND_HIT_ABOVE_FEET = STEP_HEIGHT + 0.12;
const MAX_STEP_DOWN_HEIGHT = STEP_HEIGHT + 0.1;
const BODY_CLEARANCE_FLOOR_EPSILON = 0.08;
const BODY_CLEARANCE_HEAD_EPSILON = 0.06;
const STEP_UP_MIN_HEIGHT = 0.08;
const GROUND_PROBE_RADIUS = PLAYER_RADIUS * 0.45;
const WALL_PROBE_STEP_CLEARANCE = 0.12;
const BODY_SAMPLE_DIAGONAL_RADIUS = PLAYER_RADIUS * 0.707;
const BODY_HORIZONTAL_SAMPLES = [
  { x: 0, z: 0 },
  { x: PLAYER_RADIUS, z: 0 },
  { x: -PLAYER_RADIUS, z: 0 },
  { x: 0, z: PLAYER_RADIUS },
  { x: 0, z: -PLAYER_RADIUS },
  { x: BODY_SAMPLE_DIAGONAL_RADIUS, z: BODY_SAMPLE_DIAGONAL_RADIUS },
  { x: BODY_SAMPLE_DIAGONAL_RADIUS, z: -BODY_SAMPLE_DIAGONAL_RADIUS },
  { x: -BODY_SAMPLE_DIAGONAL_RADIUS, z: BODY_SAMPLE_DIAGONAL_RADIUS },
  { x: -BODY_SAMPLE_DIAGONAL_RADIUS, z: -BODY_SAMPLE_DIAGONAL_RADIUS },
] as const;
const GROUND_PROBE_OFFSETS = [
  { x: 0, z: 0 },
  { x: GROUND_PROBE_RADIUS, z: 0 },
  { x: -GROUND_PROBE_RADIUS, z: 0 },
  { x: 0, z: GROUND_PROBE_RADIUS },
  { x: 0, z: -GROUND_PROBE_RADIUS },
] as const;
const STEP_UP_PROBE_SIDE_OFFSETS = [0, -PLAYER_RADIUS * 0.72, PLAYER_RADIUS * 0.72] as const;
const WALL_PROBE_SIDE_OFFSETS = [0, -PLAYER_RADIUS * 0.65, PLAYER_RADIUS * 0.65] as const;

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

function movementBodyHeight(movement: PlayerMovementState): number {
  return movement.isSliding || movement.isCrouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
}

function getFeetY(position: Vec3): number {
  return position.y - PLAYER_HALF_HEIGHT;
}

function getBodyTopY(position: Vec3, playerHeight: number): number {
  return getFeetY(position) + playerHeight;
}

function bodyVerticalSamples(playerHeight: number): number[] {
  const lower = Math.min(playerHeight - BODY_CLEARANCE_HEAD_EPSILON, BODY_CLEARANCE_FLOOR_EPSILON);
  const middle = Math.max(BODY_CLEARANCE_FLOOR_EPSILON, playerHeight * 0.5);
  const upper = Math.max(BODY_CLEARANCE_FLOOR_EPSILON, playerHeight - BODY_CLEARANCE_HEAD_EPSILON);
  return Array.from(new Set([lower, middle, upper].map((value) => Number(value.toFixed(4)))));
}

function hasVoxelBodyClearance(
  terrain: MovementTerrainAdapter,
  position: Vec3,
  playerHeight: number
): boolean {
  if (!terrain.getBlockAtWorld) return true;

  const feetY = getFeetY(position);
  for (const yOffset of bodyVerticalSamples(playerHeight)) {
    for (const offset of BODY_HORIZONTAL_SAMPLES) {
      const block = terrain.getBlockAtWorld({
        x: position.x + offset.x,
        y: feetY + yOffset,
        z: position.z + offset.z,
      });
      if (isCollisionBlock(block)) {
        return false;
      }
    }
  }

  return true;
}

function groundSnappedPosition(position: Vec3, groundY: number): Vec3 {
  return {
    ...position,
    y: groundY + PLAYER_HALF_HEIGHT,
  };
}

function getGroundYAt(terrain: MovementTerrainAdapter, x: number, y: number, z: number): number | null {
  return terrain.getGroundY({ x, y, z });
}

function getCurrentGroundY(terrain: MovementTerrainAdapter, position: Vec3): number | null {
  const probeY = position.y + 0.5;
  let bestGroundY = getGroundYAt(terrain, position.x, probeY, position.z);
  for (let index = 1; index < GROUND_PROBE_OFFSETS.length; index++) {
    const offset = GROUND_PROBE_OFFSETS[index];
    const groundY = getGroundYAt(terrain, position.x + offset.x, probeY, position.z + offset.z);
    if (groundY === null) continue;
    if (bestGroundY === null || groundY > bestGroundY) {
      bestGroundY = groundY;
    }
  }

  return bestGroundY;
}

function getSnapGroundY(
  terrain: MovementTerrainAdapter,
  position: Vec3,
  velocity: Vec3
): number | null {
  const groundY = getCurrentGroundY(terrain, position);
  if (groundY === null || velocity.y > 0) return null;

  const feetY = getFeetY(position);
  if (groundY - feetY > MAX_GROUND_HIT_ABOVE_FEET) return null;

  const distToGround = feetY - groundY;
  const snapDistance = distToGround >= 0 ? STEP_HEIGHT : GROUND_SNAP_DISTANCE;
  return distToGround <= snapDistance ? groundY : null;
}

function findGroundedTerrainMove(
  terrain: MovementTerrainAdapter,
  position: Vec3,
  moveX: number,
  moveZ: number
): { groundY: number; heightDiff: number } | null {
  const moveDist = Math.sqrt(moveX * moveX + moveZ * moveZ);
  if (moveDist <= 0.0001) return null;

  const dirX = moveX / moveDist;
  const dirZ = moveZ / moveDist;
  const sideX = -dirZ;
  const sideZ = dirX;
  const currentFeetY = getFeetY(position);
  const probeOriginY = position.y + STEP_HEIGHT + 1;
  let best: { groundY: number; heightDiff: number } | null = null;

  const targetSample = { x: position.x + moveX, z: position.z + moveZ };
  const targetGroundY = getGroundYAt(terrain, targetSample.x, probeOriginY, targetSample.z);
  if (targetGroundY !== null) {
    const heightDiff = targetGroundY - currentFeetY;
    if (heightDiff <= STEP_UP_MIN_HEIGHT && heightDiff >= -MAX_STEP_DOWN_HEIGHT) {
      best = { groundY: targetGroundY, heightDiff };
    }
  }

  for (const sideOffset of STEP_UP_PROBE_SIDE_OFFSETS) {
    const sample = {
      x: position.x + dirX * (PLAYER_RADIUS + Math.max(moveDist, 0.04)) + sideX * sideOffset,
      z: position.z + dirZ * (PLAYER_RADIUS + Math.max(moveDist, 0.04)) + sideZ * sideOffset,
    };
    const groundY = getGroundYAt(terrain, sample.x, probeOriginY, sample.z);
    if (groundY === null) continue;

    const heightDiff = groundY - currentFeetY;
    if (heightDiff > STEP_HEIGHT || heightDiff < -MAX_STEP_DOWN_HEIGHT) continue;

    if (!best || heightDiff > best.heightDiff) {
      best = { groundY, heightDiff };
    }
  }

  return best;
}

function hasVoxelTallWallInMovePath(
  terrain: MovementTerrainAdapter,
  position: Vec3,
  moveX: number,
  moveZ: number,
  playerHeight: number
): boolean {
  if (!terrain.getBlockAtWorld) return false;

  const moveDist = Math.sqrt(moveX * moveX + moveZ * moveZ);
  if (moveDist <= 0.0001) return false;

  const dirX = moveX / moveDist;
  const dirZ = moveZ / moveDist;
  const sideX = -dirZ;
  const sideZ = dirX;
  const feetY = getFeetY(position);
  const probeY = Math.min(
    feetY + STEP_HEIGHT + WALL_PROBE_STEP_CLEARANCE,
    getBodyTopY(position, playerHeight) - BODY_CLEARANCE_HEAD_EPSILON
  );
  const maxDistance = moveDist + PLAYER_RADIUS + 0.05;
  const steps = Math.max(1, Math.ceil(maxDistance / Math.max(PLAYER_RADIUS * 0.5, 0.1)));

  for (let step = 1; step <= steps; step++) {
    const distance = (maxDistance * step) / steps;
    for (const sideOffset of WALL_PROBE_SIDE_OFFSETS) {
      const block = terrain.getBlockAtWorld({
        x: position.x + dirX * distance + sideX * sideOffset,
        y: probeY,
        z: position.z + dirZ * distance + sideZ * sideOffset,
      });
      if (isCollisionBlock(block)) {
        return true;
      }
    }
  }

  return false;
}

function tryResolveGroundedHorizontalMove(
  terrain: MovementTerrainAdapter,
  position: Vec3,
  moveX: number,
  moveZ: number,
  playerHeight: number,
  isGrounded: boolean
): Vec3 | null {
  if (!isGrounded) return null;

  const terrainMove = findGroundedTerrainMove(terrain, position, moveX, moveZ);
  if (!terrainMove) {
    return null;
  }

  if (hasVoxelTallWallInMovePath(terrain, position, moveX, moveZ, playerHeight)) {
    return null;
  }

  const steppedTarget = groundSnappedPosition({
    x: position.x + moveX,
    y: position.y,
    z: position.z + moveZ,
  }, terrainMove.groundY);
  return hasVoxelBodyClearance(terrain, steppedTarget, playerHeight)
    ? steppedTarget
    : null;
}

function resolveHorizontalMovement(
  terrain: MovementTerrainAdapter,
  position: Vec3,
  velocity: Vec3,
  movement: PlayerMovementState,
  dt: number,
  playerHeight: number
): { position: Vec3; velocity: Vec3 } {
  const moveX = velocity.x * dt;
  const moveZ = velocity.z * dt;
  if (Math.abs(moveX) <= 0.0001 && Math.abs(moveZ) <= 0.0001) {
    return { position, velocity };
  }

  const attemptMove = (from: Vec3, x: number, z: number): Vec3 | null => {
    const rawTarget = {
      x: from.x + x,
      y: from.y,
      z: from.z + z,
    };
    const clampedTarget = terrain.clampPosition(rawTarget);

    if (hasVoxelBodyClearance(terrain, clampedTarget, playerHeight)) {
      return clampedTarget;
    }

    return tryResolveGroundedHorizontalMove(
      terrain,
      from,
      clampedTarget.x - from.x,
      clampedTarget.z - from.z,
      playerHeight,
      movement.isGrounded
    );
  };

  const direct = attemptMove(position, moveX, moveZ);
  if (direct) {
    return {
      position: direct,
      velocity: {
        ...velocity,
        x: direct.x === position.x && moveX !== 0 ? 0 : velocity.x,
        z: direct.z === position.z && moveZ !== 0 ? 0 : velocity.z,
      },
    };
  }

  let nextPosition = position;
  let nextVelocity = { ...velocity };
  const movedX = Math.abs(moveX) > 0.0001 ? attemptMove(nextPosition, moveX, 0) : null;
  if (movedX) {
    nextPosition = movedX;
  } else if (Math.abs(moveX) > 0.0001) {
    nextVelocity.x = 0;
  }

  const movedZ = Math.abs(moveZ) > 0.0001 ? attemptMove(nextPosition, 0, moveZ) : null;
  if (movedZ) {
    nextPosition = movedZ;
  } else if (Math.abs(moveZ) > 0.0001) {
    nextVelocity.z = 0;
  }

  return { position: nextPosition, velocity: nextVelocity };
}

function resolveVerticalMovement(
  terrain: MovementTerrainAdapter,
  position: Vec3,
  velocity: Vec3,
  dt: number,
  playerHeight: number
): { position: Vec3; velocity: Vec3 } {
  const moveY = velocity.y * dt;
  if (Math.abs(moveY) <= 0.0001) {
    return { position, velocity };
  }

  const target = {
    ...position,
    y: position.y + moveY,
  };
  if (hasVoxelBodyClearance(terrain, target, playerHeight)) {
    return { position: target, velocity };
  }

  return {
    position,
    velocity: {
      ...velocity,
      y: 0,
    },
  };
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
    x: local.x * cos + local.z * sin,
    y: 0,
    z: -local.x * sin + local.z * cos,
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

  const groundY = getSnapGroundY(input.terrain, position, velocity);
  movement.isGrounded = groundY !== null;

  if (groundY !== null) {
    position.y = groundY + PLAYER_HALF_HEIGHT;
    velocity.y = 0;
  }

  const wishDir = getWishDirection(input.input, input.lookYaw);
  const hasMovementInput = wishDir.x !== 0 || wishDir.z !== 0;

  const wantsCrouch = Boolean(input.input.crouch && !movement.isSliding);
  const canStand = wantsCrouch || hasVoxelBodyClearance(input.terrain, position, PLAYER_HEIGHT);
  movement.isCrouching = wantsCrouch || !canStand;
  movement.isSprinting = Boolean(input.input.sprint && hasMovementInput && !movement.isCrouching && !movement.isSliding);

  if (movement.slideTimeRemaining > 0) {
    movement.slideTimeRemaining = Math.max(0, movement.slideTimeRemaining - dt);
  }

  const slideStartRequested = input.input.crouchPressed ?? input.input.crouch;
  const canStartSlide = (
    movement.isGrounded &&
    slideStartRequested &&
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

  const playerHeight = movementBodyHeight(movement);
  const horizontal = resolveHorizontalMovement(input.terrain, position, velocity, movement, dt, playerHeight);
  position.x = horizontal.position.x;
  position.y = horizontal.position.y;
  position.z = horizontal.position.z;
  velocity = horizontal.velocity;

  const vertical = resolveVerticalMovement(input.terrain, position, velocity, dt, playerHeight);
  position.x = vertical.position.x;
  position.y = vertical.position.y;
  position.z = vertical.position.z;
  velocity = vertical.velocity;

  const clampedPosition = input.terrain.clampPosition(position);
  if (clampedPosition.x !== position.x) velocity.x = 0;
  if (clampedPosition.z !== position.z) velocity.z = 0;

  const nextGroundY = getSnapGroundY(input.terrain, clampedPosition, velocity);
  if (nextGroundY !== null) {
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
