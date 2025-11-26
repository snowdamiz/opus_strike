import { HeroBase, AbilityContext, AbilityResult } from './HeroBase.js';
import { vec3Scale, vec3Normalize, vec3Add } from '@voxel-strike/shared';

export class SentinelHero extends HeroBase {
  private isFortified: boolean = false;
  private fortifyEndTime: number = 0;
  private barrierActive: boolean = false;
  private barrierEndTime: number = 0;
  private barrierPosition: { x: number; y: number; z: number } | null = null;
  private barrierNormal: { x: number; y: number; z: number } | null = null;
  private domeActive: boolean = false;
  private domeEndTime: number = 0;
  private domePosition: { x: number; y: number; z: number } | null = null;
  private isStandingStill: boolean = false;
  private standStillStartTime: number = 0;

  constructor() {
    super('sentinel');
  }

  executeAbility(abilityId: string, context: AbilityContext): AbilityResult {
    switch (abilityId) {
      case 'sentinel_fortify':
        return this.executeFortify(context);
      case 'sentinel_barrier':
        return this.executeBarrier(context);
      case 'sentinel_dome':
        return this.executeDome(context);
      default:
        return { success: false, message: 'Unknown ability' };
    }
  }

  private executeFortify(context: AbilityContext): AbilityResult {
    this.isFortified = true;
    this.fortifyEndTime = context.timestamp + 4000; // 4 seconds

    return {
      success: true,
      effect: {
        type: 'fortify',
        position: context.position,
        duration: 4,
        value: 0.5, // 50% damage reduction
      },
    };
  }

  private executeBarrier(context: AbilityContext): AbilityResult {
    const direction = vec3Normalize(context.direction);
    const barrierPos = vec3Add(context.position, vec3Scale(direction, 3));
    
    this.barrierActive = true;
    this.barrierEndTime = context.timestamp + 5000; // 5 seconds
    this.barrierPosition = barrierPos;
    this.barrierNormal = direction;

    return {
      success: true,
      effect: {
        type: 'barrier',
        position: barrierPos,
        direction,
        duration: 5,
      },
    };
  }

  private executeDome(context: AbilityContext): AbilityResult {
    this.domeActive = true;
    this.domeEndTime = context.timestamp + 10000; // 10 seconds
    this.domePosition = { ...context.position };

    return {
      success: true,
      effect: {
        type: 'shield_dome',
        position: context.position,
        duration: 10,
        value: 10, // HP regen per second for allies inside
      },
    };
  }

  updatePassive(_deltaTime: number): void {
    const now = Date.now();

    // Check ability expirations
    if (this.isFortified && now >= this.fortifyEndTime) {
      this.isFortified = false;
    }

    if (this.barrierActive && now >= this.barrierEndTime) {
      this.barrierActive = false;
      this.barrierPosition = null;
      this.barrierNormal = null;
    }

    if (this.domeActive && now >= this.domeEndTime) {
      this.domeActive = false;
      this.domePosition = null;
    }
  }

  // Fortified passive - cannot be knocked back while standing still
  updateStandingStill(velocity: { x: number; y: number; z: number }): void {
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    
    if (speed < 0.5) {
      if (!this.isStandingStill) {
        this.isStandingStill = true;
        this.standStillStartTime = Date.now();
      }
    } else {
      this.isStandingStill = false;
      this.standStillStartTime = 0;
    }
  }

  isKnockbackImmune(): boolean {
    // Immune when standing still or fortified
    return this.isStandingStill || this.isFortified;
  }

  getDamageReduction(): number {
    let reduction = 0;
    
    if (this.isFortified) {
      reduction += 0.5; // 50% from fortify
    }

    return reduction;
  }

  isFortifyActive(): boolean {
    return this.isFortified;
  }

  isBarrierActive(): boolean {
    return this.barrierActive;
  }

  getBarrierPosition(): { x: number; y: number; z: number } | null {
    return this.barrierPosition;
  }

  getBarrierNormal(): { x: number; y: number; z: number } | null {
    return this.barrierNormal;
  }

  isDomeActive(): boolean {
    return this.domeActive;
  }

  getDomePosition(): { x: number; y: number; z: number } | null {
    return this.domePosition;
  }

  getDomeRadius(): number {
    return this.domeActive ? 8 : 0; // 8 unit radius
  }

  getDomeHealRate(): number {
    return this.domeActive ? 10 : 0; // 10 HP per second
  }
}

