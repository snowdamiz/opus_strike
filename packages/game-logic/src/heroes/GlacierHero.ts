import { HeroBase, AbilityContext, AbilityResult } from './HeroBase.js';

export class GlacierHero extends HeroBase {
  private isIceSliding: boolean = false;
  private iceSlideEndTime: number = 0;
  private isWallClimbing: boolean = false;
  private wallClimbEndTime: number = 0;
  private fortressActive: boolean = false;
  private fortressEndTime: number = 0;
  private fortressPosition: { x: number; y: number; z: number } | null = null;

  constructor() {
    super('glacier');
  }

  executeAbility(abilityId: string, context: AbilityContext): AbilityResult {
    switch (abilityId) {
      case 'glacier_iceslide':
        return this.executeIceSlide(context);
      case 'glacier_wallclimb':
        return this.executeWallClimb(context);
      case 'glacier_fortress':
        return this.executeFortress(context);
      default:
        return { success: false, message: 'Unknown ability' };
    }
  }

  private executeIceSlide(context: AbilityContext): AbilityResult {
    this.isIceSliding = true;
    this.iceSlideEndTime = context.timestamp + 2000; // 2 seconds

    return {
      success: true,
      effect: {
        type: 'ice_slide',
        position: context.position,
        direction: context.direction,
        duration: 2,
      },
    };
  }

  private executeWallClimb(context: AbilityContext): AbilityResult {
    this.isWallClimbing = true;
    this.wallClimbEndTime = context.timestamp + 3000; // 3 seconds

    return {
      success: true,
      effect: {
        type: 'wall_climb',
        position: context.position,
        duration: 3,
      },
    };
  }

  private executeFortress(context: AbilityContext): AbilityResult {
    this.fortressActive = true;
    this.fortressEndTime = context.timestamp + 8000; // 8 seconds
    this.fortressPosition = { ...context.position };

    return {
      success: true,
      effect: {
        type: 'frozen_fortress',
        position: context.position,
        duration: 8,
        value: 0.5, // 50% damage reduction
      },
    };
  }

  updatePassive(_deltaTime: number): void {
    const now = Date.now();

    // Check ability expirations
    if (this.isIceSliding && now >= this.iceSlideEndTime) {
      this.isIceSliding = false;
    }

    if (this.isWallClimbing && now >= this.wallClimbEndTime) {
      this.isWallClimbing = false;
    }

    if (this.fortressActive && now >= this.fortressEndTime) {
      this.fortressActive = false;
      this.fortressPosition = null;
    }
  }

  // Permafrost passive - 20% less damage when sliding or wall running
  getPassiveDamageReduction(isSliding: boolean, isWallRunning: boolean): number {
    if (isSliding || isWallRunning || this.isIceSliding || this.isWallClimbing) {
      return 0.2;
    }
    return 0;
  }

  getDamageReduction(isSliding: boolean, isWallRunning: boolean): number {
    let reduction = this.getPassiveDamageReduction(isSliding, isWallRunning);
    
    // Fortress provides additional 50% reduction
    if (this.fortressActive) {
      reduction += 0.5;
    }

    return Math.min(0.7, reduction); // Cap at 70%
  }

  isIceSlidingActive(): boolean {
    return this.isIceSliding;
  }

  isWallClimbingActive(): boolean {
    return this.isWallClimbing;
  }

  isFortressActive(): boolean {
    return this.fortressActive;
  }

  getFortressPosition(): { x: number; y: number; z: number } | null {
    return this.fortressPosition;
  }

  getIceSlideSpeedBoost(): number {
    return this.isIceSliding ? 0.5 : 0; // 50% speed boost during ice slide
  }
}

