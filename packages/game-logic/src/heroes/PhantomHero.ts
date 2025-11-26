import { HeroBase, AbilityContext, AbilityResult } from './HeroBase.js';
import { BLINK_MAX_DISTANCE } from '@voxel-strike/shared';
import { vec3Scale, vec3Add, vec3Normalize } from '@voxel-strike/shared';

export class PhantomHero extends HeroBase {
  private passiveSpeedBoost: number = 0;
  private lastDamageTime: number = 0;
  private isInvisible: boolean = false;
  private invisibleUntil: number = 0;
  private shadowStepTarget: { x: number; y: number; z: number } | null = null;
  private shadowStepTime: number = 0;

  constructor() {
    super('phantom');
  }

  executeAbility(abilityId: string, context: AbilityContext): AbilityResult {
    switch (abilityId) {
      case 'phantom_blink':
        return this.executeBlink(context);
      case 'phantom_shadowstep':
        return this.executeShadowStep(context);
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

  private executeShadowStep(context: AbilityContext): AbilityResult {
    if (context.targetPosition) {
      // Mark location for delayed teleport
      this.shadowStepTarget = context.targetPosition;
      this.shadowStepTime = context.timestamp + 800; // 0.8 second delay

      return {
        success: true,
        effect: {
          type: 'shadow_step_mark',
          position: context.targetPosition,
          duration: 0.8,
        },
      };
    }

    return { success: false, message: 'No target position' };
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

  updatePassive(deltaTime: number): void {
    const now = Date.now();

    // Shadow Step - check for passive speed boost
    // 10% faster when not taking damage for 3 seconds
    if (now - this.lastDamageTime >= 3000) {
      this.passiveSpeedBoost = 0.1;
    } else {
      this.passiveSpeedBoost = 0;
    }

    // Check shadow step completion
    if (this.shadowStepTarget && now >= this.shadowStepTime) {
      // Teleport would be handled by movement system
      this.shadowStepTarget = null;
    }

    // Check invisibility end
    if (this.isInvisible && now >= this.invisibleUntil) {
      this.isInvisible = false;
    }
  }

  onDamageTaken(): void {
    this.lastDamageTime = Date.now();
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

  getPassiveSpeedBoost(): number {
    return this.passiveSpeedBoost;
  }

  isCurrentlyInvisible(): boolean {
    return this.isInvisible;
  }

  getShadowStepTarget(): { x: number; y: number; z: number } | null {
    return this.shadowStepTarget;
  }
}

