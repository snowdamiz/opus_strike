import type { Vec3, InputState, PlayerMovementState } from '@voxel-strike/shared';
import { 
  SLIDE_SPEED_BOOST,
  SLIDE_DURATION,
  SLIDE_COOLDOWN,
  SLIDE_ENTRY_SPEED_CAP_MULTIPLIER,
  SLIDE_FRICTION,
  SLIDE_JUMP_MAX_SPEED_MULTIPLIER,
  SLIDE_JUMP_SPEED_RETENTION,
  SLIDE_MAX_SPEED_MULTIPLIER,
  MIN_SLIDE_SPEED,
  SPRINT_MULTIPLIER,
  WALL_RUN_MIN_SPEED,
  WALL_RUN_MAX_DURATION,
  WALL_RUN_GRAVITY_MULTIPLIER,
  WALL_RUN_SPEED_BOOST,
  WALL_RUN_JUMP_FORCE,
  WALL_RUN_JUMP_AWAY_FORCE,
  WALL_RUN_COOLDOWN,
  MANTLE_DURATION,
  GRAVITY,
} from '@voxel-strike/shared';
import { vec3Scale, vec3Normalize, vec3Cross, createVec3, DEFAULT_HERO_STATS } from '@voxel-strike/shared';
import type { PhysicsWorld } from '../PhysicsWorld.js';
import { checkWalls, checkLedge } from '../CollisionDetection.js';

export interface ParkourMovementInput {
  position: Vec3;
  velocity: Vec3;
  input: InputState;
  forward: Vec3;
  right: Vec3;
  lookPitch: number;
  deltaTime: number;
  movementState: PlayerMovementState;
  wasGrounded: boolean;
}

export interface ParkourMovementResult {
  position: Vec3;
  velocity: Vec3;
  isSliding: boolean;
  isWallRunning: boolean;
  wallRunSide: 'left' | 'right' | null;
}

export class ParkourMovement {
  private world: PhysicsWorld;
  private playerId: string;
  
  // Slide state
  private slideTimer: number = 0;
  private slideCooldown: number = 0;
  private slideDirection: Vec3 = createVec3();
  
  // Wall run state
  private wallRunTimer: number = 0;
  private wallRunCooldown: number = 0;
  private wallRunNormal: Vec3 = createVec3();
  
  // Mantle state
  private isMantling: boolean = false;
  private mantleTimer: number = 0;
  private mantleTarget: Vec3 = createVec3();
  private mantleStart: Vec3 = createVec3();
  private slideMaxSpeed: number = DEFAULT_HERO_STATS.moveSpeed * SPRINT_MULTIPLIER * SLIDE_MAX_SPEED_MULTIPLIER;
  private slideJumpMaxSpeed: number = DEFAULT_HERO_STATS.moveSpeed * SPRINT_MULTIPLIER * SLIDE_JUMP_MAX_SPEED_MULTIPLIER;

  constructor(world: PhysicsWorld, playerId: string) {
    this.world = world;
    this.playerId = playerId;
  }

  update(input: ParkourMovementInput): ParkourMovementResult {
    const { 
      position, velocity, input: playerInput, forward, right, 
      lookPitch, deltaTime, movementState, wasGrounded 
    } = input;
    
    let newPosition = { ...position };
    let newVelocity = { ...velocity };
    let isSliding = movementState.isSliding;
    let isWallRunning = movementState.isWallRunning;
    let wallRunSide = movementState.wallRunSide;

    // Update cooldowns
    this.slideCooldown = Math.max(0, this.slideCooldown - deltaTime);
    this.wallRunCooldown = Math.max(0, this.wallRunCooldown - deltaTime);

    // Handle mantling
    if (this.isMantling) {
      const result = this.updateMantle(position, deltaTime);
      if (result.finished) {
        this.isMantling = false;
        newPosition = result.position;
        newVelocity = createVec3();
      } else {
        return {
          position: result.position,
          velocity: createVec3(),
          isSliding: false,
          isWallRunning: false,
          wallRunSide: null,
        };
      }
    }

    // Check for mantle opportunity
    if (playerInput.jump && !movementState.isGrounded && !isWallRunning) {
      const ledgeCheck = checkLedge(this.world, position, forward, this.playerId);
      if (ledgeCheck.canMantle) {
        this.startMantle(position, ledgeCheck.ledgePoint);
        return {
          position,
          velocity: createVec3(),
          isSliding: false,
          isWallRunning: false,
          wallRunSide: null,
        };
      }
    }

    // Handle sliding
    if (movementState.isGrounded) {
      const horizontalSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
      
      // Start slide
      if (playerInput.crouch && horizontalSpeed >= MIN_SLIDE_SPEED && 
          this.slideCooldown <= 0 && !isSliding) {
        isSliding = true;
        this.slideTimer = SLIDE_DURATION;
        this.slideDirection = vec3Normalize({ x: velocity.x, y: 0, z: velocity.z });
        const sprintSpeed = DEFAULT_HERO_STATS.moveSpeed * SPRINT_MULTIPLIER;
        this.slideMaxSpeed = sprintSpeed * SLIDE_MAX_SPEED_MULTIPLIER;
        this.slideJumpMaxSpeed = sprintSpeed * SLIDE_JUMP_MAX_SPEED_MULTIPLIER;
        
        // Boost velocity
        const slideEntrySpeed = Math.min(
          Math.max(horizontalSpeed, sprintSpeed),
          sprintSpeed * SLIDE_ENTRY_SPEED_CAP_MULTIPLIER
        );
        const boostedSpeed = Math.min(slideEntrySpeed * SLIDE_SPEED_BOOST, this.slideMaxSpeed);
        newVelocity.x = this.slideDirection.x * boostedSpeed;
        newVelocity.z = this.slideDirection.z * boostedSpeed;
      }

      // Update slide
      if (isSliding) {
        this.slideTimer -= deltaTime;
        
        // Apply slide friction
        const friction = Math.pow(SLIDE_FRICTION, deltaTime * 60);
        newVelocity.x *= friction;
        newVelocity.z *= friction;
        this.clampHorizontalSpeed(newVelocity, this.slideMaxSpeed);

        // End slide
        const currentSpeed = Math.sqrt(newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z);
        if (this.slideTimer <= 0 || currentSpeed < MIN_SLIDE_SPEED * 0.5 || !playerInput.crouch || playerInput.jump) {
          if (playerInput.jump) {
            newVelocity.x *= SLIDE_JUMP_SPEED_RETENTION;
            newVelocity.z *= SLIDE_JUMP_SPEED_RETENTION;
            this.clampHorizontalSpeed(newVelocity, this.slideJumpMaxSpeed);
          }
          isSliding = false;
          this.slideCooldown = SLIDE_COOLDOWN;
        }
      }
    } else {
      isSliding = false;
    }

    // Handle wall running
    if (!movementState.isGrounded && !isSliding && this.wallRunCooldown <= 0) {
      const wallInfo = checkWalls(this.world, position, forward, right, this.playerId);
      const horizontalSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);

      // Start wall run
      if (wallInfo.isNearWall && horizontalSpeed >= WALL_RUN_MIN_SPEED && 
          wallInfo.side !== 'front' && !isWallRunning) {
        
        // Check if moving toward wall
        const toWall = wallInfo.side === 'left' ? vec3Scale(right, -1) : right;
        const moveDotWall = velocity.x * toWall.x + velocity.z * toWall.z;
        
        if (moveDotWall > 0.3) {
          isWallRunning = true;
          wallRunSide = wallInfo.side as 'left' | 'right';
          this.wallRunTimer = WALL_RUN_MAX_DURATION;
          this.wallRunNormal = wallInfo.wallNormal;
        }
      }

      // Update wall run
      if (isWallRunning) {
        this.wallRunTimer -= deltaTime;
        
        // Calculate wall-parallel direction
        const wallForward = vec3Cross(this.wallRunNormal, { x: 0, y: 1, z: 0 });
        const wallDot = velocity.x * wallForward.x + velocity.z * wallForward.z;
        if (wallDot < 0) {
          wallForward.x *= -1;
          wallForward.z *= -1;
        }

        // Apply wall run velocity
        const wallRunSpeed = horizontalSpeed * WALL_RUN_SPEED_BOOST;
        newVelocity.x = wallForward.x * wallRunSpeed;
        newVelocity.z = wallForward.z * wallRunSpeed;
        
        // Reduced gravity
        newVelocity.y += GRAVITY * WALL_RUN_GRAVITY_MULTIPLIER * deltaTime;
        newVelocity.y = Math.max(newVelocity.y, -3); // Limit fall speed on wall

        // Wall jump
        if (playerInput.jump) {
          newVelocity.y = WALL_RUN_JUMP_FORCE;
          newVelocity.x += this.wallRunNormal.x * WALL_RUN_JUMP_AWAY_FORCE;
          newVelocity.z += this.wallRunNormal.z * WALL_RUN_JUMP_AWAY_FORCE;
          isWallRunning = false;
          wallRunSide = null;
          this.wallRunCooldown = WALL_RUN_COOLDOWN;
        }

        // End wall run
        const wallCheck = checkWalls(this.world, position, forward, right, this.playerId);
        if (this.wallRunTimer <= 0 || !wallCheck.isNearWall || wallCheck.side === 'front') {
          isWallRunning = false;
          wallRunSide = null;
          this.wallRunCooldown = WALL_RUN_COOLDOWN;
        }
      }
    } else if (movementState.isGrounded) {
      isWallRunning = false;
      wallRunSide = null;
    }

    // Update position
    newPosition.x += newVelocity.x * deltaTime;
    newPosition.y += newVelocity.y * deltaTime;
    newPosition.z += newVelocity.z * deltaTime;

    return {
      position: newPosition,
      velocity: newVelocity,
      isSliding,
      isWallRunning,
      wallRunSide,
    };
  }

  private startMantle(startPos: Vec3, targetPos: Vec3): void {
    this.isMantling = true;
    this.mantleTimer = 0;
    this.mantleStart = { ...startPos };
    this.mantleTarget = { x: targetPos.x, y: targetPos.y + 1, z: targetPos.z };
  }

  private updateMantle(currentPos: Vec3, deltaTime: number): { position: Vec3; finished: boolean } {
    this.mantleTimer += deltaTime;
    const progress = Math.min(1, this.mantleTimer / MANTLE_DURATION);
    
    // Smooth interpolation
    const t = progress * progress * (3 - 2 * progress); // Smoothstep
    
    const position = {
      x: this.mantleStart.x + (this.mantleTarget.x - this.mantleStart.x) * t,
      y: this.mantleStart.y + (this.mantleTarget.y - this.mantleStart.y) * t,
      z: this.mantleStart.z + (this.mantleTarget.z - this.mantleStart.z) * t,
    };

    return {
      position,
      finished: progress >= 1,
    };
  }

  private clampHorizontalSpeed(velocity: Vec3, maxSpeed: number): void {
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    if (speed <= maxSpeed || speed <= 0.0001) {
      return;
    }

    const scale = maxSpeed / speed;
    velocity.x *= scale;
    velocity.z *= scale;
  }
}
