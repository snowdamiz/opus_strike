import type { Vec3, InputState, PlayerMovementState, HeroStats } from '@voxel-strike/shared';
import { 
  SPRINT_MULTIPLIER,
  CROUCH_MULTIPLIER,
  AIR_CONTROL,
  GRAVITY,
  GROUND_FRICTION,
  DEFAULT_HERO_STATS,
} from '@voxel-strike/shared';
import { vec3Length, createVec3 } from '@voxel-strike/shared';
import type { PhysicsWorld } from '../PhysicsWorld.js';
import { checkGround } from '../CollisionDetection.js';

export interface BaseMovementInput {
  position: Vec3;
  velocity: Vec3;
  input: InputState;
  forward: Vec3;
  right: Vec3;
  deltaTime: number;
  movementState: PlayerMovementState;
}

export interface BaseMovementResult {
  position: Vec3;
  velocity: Vec3;
  isGrounded: boolean;
}

export class BaseMovement {
  private world: PhysicsWorld;
  private playerId: string;
  
  private moveSpeed: number = DEFAULT_HERO_STATS.moveSpeed;
  private jumpForce: number = DEFAULT_HERO_STATS.jumpForce;
  
  private coyoteTime: number = 0;
  private jumpBuffer: number = 0;
  
  private readonly COYOTE_TIME_MAX = 0.15;
  private readonly JUMP_BUFFER_MAX = 0.1;

  constructor(world: PhysicsWorld, playerId: string) {
    this.world = world;
    this.playerId = playerId;
  }

  setStats(stats: HeroStats): void {
    this.moveSpeed = stats.moveSpeed;
    this.jumpForce = stats.jumpForce;
  }

  update(input: BaseMovementInput): BaseMovementResult {
    const { position, velocity, input: playerInput, forward, right, deltaTime, movementState } = input;
    
    const newPosition = { ...position };
    const newVelocity = { ...velocity };

    // Check ground
    const groundInfo = checkGround(this.world, position, this.playerId);
    let isGrounded = groundInfo.isGrounded;

    // Coyote time - allow jumping briefly after leaving ground
    if (isGrounded) {
      this.coyoteTime = this.COYOTE_TIME_MAX;
    } else {
      this.coyoteTime = Math.max(0, this.coyoteTime - deltaTime);
    }

    // Jump buffer - remember jump input briefly
    if (playerInput.jump) {
      this.jumpBuffer = this.JUMP_BUFFER_MAX;
    } else {
      this.jumpBuffer = Math.max(0, this.jumpBuffer - deltaTime);
    }

    // Calculate movement direction
    const moveDir = createVec3();
    
    if (playerInput.moveForward) {
      moveDir.x += forward.x;
      moveDir.z += forward.z;
    }
    if (playerInput.moveBackward) {
      moveDir.x -= forward.x;
      moveDir.z -= forward.z;
    }
    if (playerInput.moveLeft) {
      moveDir.x -= right.x;
      moveDir.z -= right.z;
    }
    if (playerInput.moveRight) {
      moveDir.x += right.x;
      moveDir.z += right.z;
    }

    // Normalize movement direction
    const moveDirLen = vec3Length(moveDir);
    if (moveDirLen > 0) {
      moveDir.x /= moveDirLen;
      moveDir.z /= moveDirLen;
    }

    // Calculate target speed
    let targetSpeed = this.moveSpeed;
    if (playerInput.sprint && !playerInput.crouch) {
      targetSpeed *= SPRINT_MULTIPLIER;
    }
    if (playerInput.crouch) {
      targetSpeed *= CROUCH_MULTIPLIER;
    }

    // Apply movement based on grounded state
    const control = isGrounded || this.coyoteTime > 0 ? 1.0 : AIR_CONTROL;
    const accel = isGrounded ? 15 : 8;

    // Target velocity
    const targetVelX = moveDir.x * targetSpeed;
    const targetVelZ = moveDir.z * targetSpeed;

    // Accelerate toward target
    newVelocity.x += (targetVelX - newVelocity.x) * accel * control * deltaTime;
    newVelocity.z += (targetVelZ - newVelocity.z) * accel * control * deltaTime;

    // Apply friction when grounded and not moving
    if (isGrounded && moveDirLen === 0) {
      const friction = Math.pow(GROUND_FRICTION, deltaTime * 60);
      newVelocity.x *= friction;
      newVelocity.z *= friction;
    }

    // Apply gravity
    if (!isGrounded && !movementState.isWallRunning && !movementState.isGrappling) {
      newVelocity.y += GRAVITY * deltaTime;
    }

    // Jump
    const canJump = (isGrounded || this.coyoteTime > 0) && !movementState.isSliding;
    if (this.jumpBuffer > 0 && canJump) {
      newVelocity.y = this.jumpForce;
      this.coyoteTime = 0;
      this.jumpBuffer = 0;
      isGrounded = false;
    }

    // Ground snap
    if (isGrounded && newVelocity.y < 0) {
      newVelocity.y = 0;
      newPosition.y = groundInfo.distance < 0.5 
        ? position.y - groundInfo.distance + 0.01
        : position.y;
    }

    // Update position
    newPosition.x += newVelocity.x * deltaTime;
    newPosition.y += newVelocity.y * deltaTime;
    newPosition.z += newVelocity.z * deltaTime;

    // Clamp vertical position
    if (newPosition.y < 0.9) {
      newPosition.y = 0.9;
      newVelocity.y = 0;
      isGrounded = true;
    }

    return {
      position: newPosition,
      velocity: newVelocity,
      isGrounded,
    };
  }
}

