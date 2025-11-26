import { HeroBase, AbilityContext, AbilityResult } from './HeroBase.js';
import { DASH_DISTANCE } from '@voxel-strike/shared';
import { vec3Scale, vec3Normalize, vec3Add } from '@voxel-strike/shared';

export class PulseHero extends HeroBase {
  private speedAuraActive: boolean = false;
  private speedAuraEndTime: number = 0;
  private hasteActive: boolean = false;
  private hasteEndTime: number = 0;
  private lastDamageTime: number = 0;
  private healthRegenStartTime: number = 0;

  constructor() {
    super('pulse');
  }

  executeAbility(abilityId: string, context: AbilityContext): AbilityResult {
    switch (abilityId) {
      case 'pulse_speedboost':
        return this.executeSpeedBoost(context);
      case 'pulse_dash':
        return this.executeDash(context);
      case 'pulse_haste':
        return this.executeHaste(context);
      default:
        return { success: false, message: 'Unknown ability' };
    }
  }

  private executeSpeedBoost(context: AbilityContext): AbilityResult {
    this.speedAuraActive = true;
    this.speedAuraEndTime = context.timestamp + 4000; // 4 seconds

    return {
      success: true,
      effect: {
        type: 'speed_aura',
        position: context.position,
        duration: 4,
        value: 0.3, // 30% speed boost
      },
    };
  }

  private executeDash(context: AbilityContext): AbilityResult {
    const direction = vec3Normalize(context.direction);
    const dashEnd = vec3Add(context.position, vec3Scale(direction, DASH_DISTANCE));

    return {
      success: true,
      effect: {
        type: 'dash',
        position: context.position,
        direction: dashEnd,
      },
    };
  }

  private executeHaste(context: AbilityContext): AbilityResult {
    this.hasteActive = true;
    this.hasteEndTime = context.timestamp + 8000; // 8 seconds

    return {
      success: true,
      effect: {
        type: 'team_haste',
        position: context.position,
        duration: 8,
        value: 0.5, // 50% speed boost for team
      },
    };
  }

  updatePassive(_deltaTime: number): void {
    const now = Date.now();

    // Quick Recovery - health regen starts after 2 seconds instead of 5
    if (now - this.lastDamageTime >= 2000 && this.healthRegenStartTime === 0) {
      this.healthRegenStartTime = now;
    }

    // Check ability expirations
    if (this.speedAuraActive && now >= this.speedAuraEndTime) {
      this.speedAuraActive = false;
    }

    if (this.hasteActive && now >= this.hasteEndTime) {
      this.hasteActive = false;
    }
  }

  onDamageTaken(): void {
    this.lastDamageTime = Date.now();
    this.healthRegenStartTime = 0;
  }

  // Quick Recovery passive - regen starts after 2s instead of 5s
  canRegenHealth(): boolean {
    return Date.now() - this.lastDamageTime >= 2000;
  }

  getHealthRegenRate(): number {
    return this.canRegenHealth() ? 5 : 0; // 5 HP per second
  }

  isSpeedAuraActive(): boolean {
    return this.speedAuraActive;
  }

  isHasteActive(): boolean {
    return this.hasteActive;
  }

  getSpeedBoost(): number {
    let boost = 0;
    if (this.speedAuraActive) boost += 0.3;
    if (this.hasteActive) boost += 0.5;
    return boost;
  }

  // Get allies in range for speed aura
  getAuraRadius(): number {
    return this.speedAuraActive ? 10 : 0; // 10 unit radius
  }

  getHasteRadius(): number {
    return this.hasteActive ? 50 : 0; // Map-wide for ultimate
  }
}

