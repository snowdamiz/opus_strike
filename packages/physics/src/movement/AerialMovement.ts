import type { Vec3, InputState, PlayerMovementState, HeroId } from '@voxel-strike/shared';
import { 
  GRAPPLE_MAX_DISTANCE,
  GRAPPLE_PULL_FORCE,
  GRAPPLE_SWING_FORCE,
  GRAPPLE_DETACH_DISTANCE,
  GRAPPLE_MOMENTUM_TRANSFER,
  GLIDE_FALL_SPEED,
  GLIDE_FORWARD_BOOST,
} from '@voxel-strike/shared';
import { vec3Sub, vec3Length, vec3Normalize, vec3Scale, vec3Add } from '@voxel-strike/shared';
import type { PhysicsWorld } from '../PhysicsWorld.js';

export interface AerialMovementInput {
  position: Vec3;
  velocity: Vec3;
  input: InputState;
  forward: Vec3;
  right: Vec3;
  lookYaw: number;
  lookPitch: number;
  deltaTime: number;
  movementState: PlayerMovementState;
  heroId: HeroId | null;
}

export interface AerialMovementResult {
  position: Vec3;
  velocity: Vec3;
  isGrappling: boolean;
  grapplePoint: Vec3 | null;
  isJetpacking: boolean;
  jetpackFuel: number;
  isGliding: boolean;
}

export class AerialMovement {
  private world: PhysicsWorld;
  private playerId: string;
  
  // Grapple state
  private grapplePoint: Vec3 | null = null;
  private isGrappling: boolean = false;
  private grappleRopeLength: number = 0;
  
  // Legacy movement shape kept for network compatibility. Blaze E no longer flies.
  private jetpackFuel: number = 100;
  private isJetpacking: boolean = false;
  
  // Glide state
  private isGliding: boolean = false;

  constructor(world: PhysicsWorld, playerId: string) {
    this.world = world;
    this.playerId = playerId;
  }

  update(input: AerialMovementInput): AerialMovementResult {
    const { 
      position, velocity, input: playerInput, forward,
      lookYaw, lookPitch, deltaTime, movementState, heroId
    } = input;
    
    let newPosition = { ...position };
    let newVelocity = { ...velocity };

    // Update based on hero
    if (heroId === 'hookshot') {
      const grappleResult = this.updateGrapple(
        newPosition, newVelocity, playerInput, forward, lookYaw, lookPitch, deltaTime
      );
      newPosition = grappleResult.position;
      newVelocity = grappleResult.velocity;
    }

    if (heroId === 'blaze') {
      this.isJetpacking = false;

      // Glide check
      if (!movementState.isGrounded && playerInput.jump && newVelocity.y < 0) {
        this.isGliding = true;
      } else if (movementState.isGrounded) {
        this.isGliding = false;
      }

      if (this.isGliding) {
        const glideResult = this.updateGlide(newPosition, newVelocity, forward, deltaTime);
        newPosition = glideResult.position;
        newVelocity = glideResult.velocity;
      }
    }

    return {
      position: newPosition,
      velocity: newVelocity,
      isGrappling: this.isGrappling,
      grapplePoint: this.grapplePoint,
      isJetpacking: this.isJetpacking,
      jetpackFuel: this.jetpackFuel,
      isGliding: this.isGliding,
    };
  }

  private updateGrapple(
    position: Vec3,
    velocity: Vec3,
    input: InputState,
    forward: Vec3,
    lookYaw: number,
    lookPitch: number,
    deltaTime: number
  ): { position: Vec3; velocity: Vec3 } {
    let newPosition = { ...position };
    let newVelocity = { ...velocity };

    if (this.isGrappling && this.grapplePoint) {
      // Calculate direction to grapple point
      const toGrapple = vec3Sub(this.grapplePoint, position);
      const distance = vec3Length(toGrapple);
      
      // Check if close enough to detach
      if (distance < GRAPPLE_DETACH_DISTANCE) {
        this.endGrapple();
        // Transfer momentum
        newVelocity = vec3Scale(newVelocity, GRAPPLE_MOMENTUM_TRANSFER);
      } else {
        // Apply pull force toward grapple point
        const pullDir = vec3Normalize(toGrapple);
        const pullForce = vec3Scale(pullDir, GRAPPLE_PULL_FORCE * deltaTime);
        
        newVelocity = vec3Add(newVelocity, pullForce);

        // Add swing force perpendicular to rope
        if (input.moveLeft || input.moveRight) {
          const swingDir = input.moveRight 
            ? vec3Cross3D(pullDir, { x: 0, y: 1, z: 0 })
            : vec3Cross3D({ x: 0, y: 1, z: 0 }, pullDir);
          const swingForce = vec3Scale(swingDir, GRAPPLE_SWING_FORCE * deltaTime);
          newVelocity = vec3Add(newVelocity, swingForce);
        }

        // Constrain to rope length (basic pendulum)
        if (distance > this.grappleRopeLength) {
          const constrainDir = vec3Normalize(toGrapple);
          const excess = distance - this.grappleRopeLength;
          newPosition = vec3Add(newPosition, vec3Scale(constrainDir, excess));
          
          // Remove velocity component along rope
          const velAlongRope = vec3Dot3D(newVelocity, constrainDir);
          if (velAlongRope < 0) {
            newVelocity = vec3Sub(newVelocity, vec3Scale(constrainDir, velAlongRope));
          }
        }
      }

      // Cancel grapple on jump or secondary fire
      if (input.jump || input.secondaryFire) {
        this.endGrapple();
      }
    }

    return { position: newPosition, velocity: newVelocity };
  }

  private updateGlide(
    position: Vec3,
    velocity: Vec3,
    forward: Vec3,
    deltaTime: number
  ): { position: Vec3; velocity: Vec3 } {
    let newPosition = { ...position };
    let newVelocity = { ...velocity };

    // Slow fall
    if (newVelocity.y < GLIDE_FALL_SPEED) {
      newVelocity.y = Math.min(newVelocity.y + 20 * deltaTime, GLIDE_FALL_SPEED);
    }

    // Forward boost
    const horizontalSpeed = Math.sqrt(newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z);
    const targetSpeed = horizontalSpeed * GLIDE_FORWARD_BOOST;
    
    if (horizontalSpeed > 0) {
      const horizontalDir = { x: newVelocity.x / horizontalSpeed, y: 0, z: newVelocity.z / horizontalSpeed };
      newVelocity.x = horizontalDir.x * targetSpeed;
      newVelocity.z = horizontalDir.z * targetSpeed;
    }

    return { position: newPosition, velocity: newVelocity };
  }

  startGrapple(targetPoint: Vec3): void {
    this.isGrappling = true;
    this.grapplePoint = { ...targetPoint };
    this.grappleRopeLength = GRAPPLE_MAX_DISTANCE; // Will be set properly on first update
  }

  endGrapple(): void {
    this.isGrappling = false;
    this.grapplePoint = null;
  }

  setGrappleRopeLength(position: Vec3): void {
    if (this.grapplePoint) {
      this.grappleRopeLength = vec3Length(vec3Sub(this.grapplePoint, position));
    }
  }
}

// Helper functions
function vec3Cross3D(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function vec3Dot3D(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
