import type { Vec3, InputState, PlayerMovementState, HeroId } from '@voxel-strike/shared';
import { HERO_DEFINITIONS, createVec3 } from '@voxel-strike/shared';
import type { PhysicsWorld } from './PhysicsWorld.js';
import { BaseMovement } from './movement/BaseMovement.js';
import { ParkourMovement } from './movement/ParkourMovement.js';
import { AerialMovement } from './movement/AerialMovement.js';
import { AbilityMovement } from './movement/AbilityMovement.js';

export interface MovementInput {
  input: InputState;
  lookYaw: number;
  lookPitch: number;
  deltaTime: number;
}

export interface MovementState {
  position: Vec3;
  velocity: Vec3;
  movement: PlayerMovementState;
}

export class MovementController {
  private baseMovement: BaseMovement;
  private parkourMovement: ParkourMovement;
  private aerialMovement: AerialMovement;
  private abilityMovement: AbilityMovement;

  private playerId: string;
  private heroId: HeroId | null = null;
  
  // Current state
  private position: Vec3;
  private velocity: Vec3;
  private movementState: PlayerMovementState;

  constructor(
    world: PhysicsWorld,
    playerId: string,
    initialPosition: Vec3
  ) {
    this.playerId = playerId;
    this.position = { ...initialPosition };
    this.velocity = createVec3();
    
    this.movementState = {
      isGrounded: false,
      isSprinting: false,
      isCrouching: false,
      isSliding: false,
      slideTimeRemaining: 0,
      isWallRunning: false,
      wallRunSide: null,
      isGrappling: false,
      grapplePoint: null,
      isJetpacking: false,
      jetpackFuel: 100,
      isGliding: false,
    };

    this.baseMovement = new BaseMovement(world, playerId);
    this.parkourMovement = new ParkourMovement(world, playerId);
    this.aerialMovement = new AerialMovement(world, playerId);
    this.abilityMovement = new AbilityMovement(world, playerId);
  }

  setHero(heroId: HeroId): void {
    this.heroId = heroId;
    
    // Configure movement systems based on hero
    const hero = HERO_DEFINITIONS[heroId];
    this.baseMovement.setStats(hero.stats);
    
    // Reset fuel/resources
    if (heroId === 'blaze') {
      this.movementState.jetpackFuel = 100;
    }
  }

  update(movementInput: MovementInput): MovementState {
    const { input, lookYaw, lookPitch, deltaTime } = movementInput;
    
    // Get forward and right vectors from look direction
    const forward = {
      x: -Math.sin(lookYaw),
      y: 0,
      z: -Math.cos(lookYaw),
    };
    const right = {
      x: Math.cos(lookYaw),
      y: 0,
      z: -Math.sin(lookYaw),
    };

    // Store previous state for transitions
    const wasGrounded = this.movementState.isGrounded;

    // 1. Base movement (always active)
    const baseResult = this.baseMovement.update({
      position: this.position,
      velocity: this.velocity,
      input,
      forward,
      right,
      deltaTime,
      movementState: this.movementState,
    });

    this.position = baseResult.position;
    this.velocity = baseResult.velocity;
    this.movementState.isGrounded = baseResult.isGrounded;

    // 2. Parkour movement (wall running, sliding, mantling)
    if (this.canUseParkour()) {
      const parkourResult = this.parkourMovement.update({
        position: this.position,
        velocity: this.velocity,
        input,
        forward,
        right,
        lookPitch,
        deltaTime,
        movementState: this.movementState,
        wasGrounded,
      });

      this.position = parkourResult.position;
      this.velocity = parkourResult.velocity;
      this.movementState.isSliding = parkourResult.isSliding;
      this.movementState.isWallRunning = parkourResult.isWallRunning;
      this.movementState.wallRunSide = parkourResult.wallRunSide;
    }

    // 3. Aerial movement (grappling, gliding)
    if (this.canUseAerial()) {
      const aerialResult = this.aerialMovement.update({
        position: this.position,
        velocity: this.velocity,
        input,
        forward,
        right,
        lookYaw,
        lookPitch,
        deltaTime,
        movementState: this.movementState,
        heroId: this.heroId,
      });

      this.position = aerialResult.position;
      this.velocity = aerialResult.velocity;
      this.movementState.isGrappling = aerialResult.isGrappling;
      this.movementState.grapplePoint = aerialResult.grapplePoint;
      this.movementState.isJetpacking = aerialResult.isJetpacking;
      this.movementState.jetpackFuel = aerialResult.jetpackFuel;
      this.movementState.isGliding = aerialResult.isGliding;
    }

    // 4. Ability movement (dash, blink, teleport)
    if (this.canUseAbilityMovement()) {
      const abilityResult = this.abilityMovement.update({
        position: this.position,
        velocity: this.velocity,
        input,
        forward,
        right,
        deltaTime,
        movementState: this.movementState,
        heroId: this.heroId,
      });

      this.position = abilityResult.position;
      this.velocity = abilityResult.velocity;
    }

    return {
      position: this.position,
      velocity: this.velocity,
      movement: this.movementState,
    };
  }

  private canUseParkour(): boolean {
    return true;
  }

  private canUseAerial(): boolean {
    // Aerial movement based on hero
    if (!this.heroId) return false;
    return ['hookshot', 'blaze', 'phantom'].includes(this.heroId);
  }

  private canUseAbilityMovement(): boolean {
    // Ability-based movement for specific heroes
    if (!this.heroId) return false;
    return this.heroId === 'phantom';
  }

  setPosition(position: Vec3): void {
    this.position = { ...position };
  }

  setVelocity(velocity: Vec3): void {
    this.velocity = { ...velocity };
  }

  getPosition(): Vec3 {
    return { ...this.position };
  }

  getVelocity(): Vec3 {
    return { ...this.velocity };
  }

  getMovementState(): PlayerMovementState {
    return { ...this.movementState };
  }

  // For specific ability triggers
  startGrapple(targetPoint: Vec3): void {
    this.aerialMovement.startGrapple(targetPoint);
  }

  endGrapple(): void {
    this.aerialMovement.endGrapple();
  }

  executeBlink(targetPosition: Vec3): void {
    this.abilityMovement.executeBlink(targetPosition);
  }
}
