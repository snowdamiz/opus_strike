import { HeroBase, AbilityContext, AbilityResult } from './HeroBase.js';
import { BLINK_MAX_DISTANCE } from '@voxel-strike/shared';
import { vec3Scale, vec3Add, vec3Normalize } from '@voxel-strike/shared';

export class PhantomHero extends HeroBase {
  private isInvisible: boolean = false;
  private invisibleUntil: number = 0;

  constructor() {
    super('phantom');
  }

  executeAbility(abilityId: string, context: AbilityContext): AbilityResult {
    switch (abilityId) {
      case 'phantom_blink':
        return this.executeBlink(context);
      case 'phantom_personal_shield':
        return this.executePersonalShield(context);
      case 'phantom_veil':
        return this.executeVeil(context);
      default:
        return { success: false, message: 'Unknown ability' };
    }
  }

  private executeBlink(context: AbilityContext): AbilityResult {
    // Calculate blink destination
    const direction = vec3Normalize(context.direction);
    const blinkDistance = BLINK_MAX_DISTANCE;
    const destination = vec3Add(context.position, vec3Scale(direction, blinkDistance));

    return {
      success: true,
      effect: {
        type: 'blink',
        position: context.position,
        direction: destination,
        duration: 0.1,
      },
    };
  }

  private executePersonalShield(context: AbilityContext): AbilityResult {
    return {
      success: true,
      effect: {
        type: 'personal_shield',
        position: context.position,
        direction: context.direction,
        duration: 10,
      },
    };
  }

  private executeVeil(context: AbilityContext): AbilityResult {
    this.isInvisible = true;
    this.invisibleUntil = context.timestamp + 6000; // 6 seconds

    return {
      success: true,
      effect: {
        type: 'invisibility',
        position: context.position,
        duration: 6,
      },
    };
  }

  updatePassive(_deltaTime: number): void {
    const now = Date.now();

    // Check invisibility end
    if (this.isInvisible && now >= this.invisibleUntil) {
      this.isInvisible = false;
    }
  }

  onDamageTaken(): void {
    // Break invisibility on damage
    if (this.isInvisible) {
      this.isInvisible = false;
    }
  }

  onAttack(): void {
    // Break invisibility when attacking
    if (this.isInvisible) {
      this.isInvisible = false;
    }
  }

  isCurrentlyInvisible(): boolean {
    return this.isInvisible;
  }
}
