import { HeroBase, AbilityContext, AbilityResult } from './HeroBase.js';
import { GRAPPLE_MAX_DISTANCE } from '@voxel-strike/shared';
import { vec3Scale, vec3Add, vec3Normalize } from '@voxel-strike/shared';

export class HookshotHero extends HeroBase {
  private momentumBoostUntil: number = 0;
  private lastSwingEnd: number = 0;
  private activeZipline: { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } } | null = null;
  private ziplineExpiresAt: number = 0;

  constructor() {
    super('hookshot');
  }

  executeAbility(abilityId: string, context: AbilityContext): AbilityResult {
    switch (abilityId) {
      case 'hookshot_grapple':
        return this.executeGrapple(context);
      case 'hookshot_swing':
        return this.executeSwing(context);
      case 'hookshot_zipline':
        return this.executeZipline(context);
      default:
        return { success: false, message: 'Unknown ability' };
    }
  }

  private executeGrapple(context: AbilityContext): AbilityResult {
    // Calculate grapple target
    const direction = vec3Normalize(context.direction);
    const grappleTarget = vec3Add(
      context.position, 
      vec3Scale(direction, GRAPPLE_MAX_DISTANCE)
    );

    return {
      success: true,
      effect: {
        type: 'grapple',
        position: context.position,
        direction: grappleTarget,
      },
    };
  }

  private executeSwing(context: AbilityContext): AbilityResult {
    // Swing line - creates a pendulum point
    const direction = vec3Normalize(context.direction);
    const swingPoint = vec3Add(
      context.position, 
      vec3Scale(direction, GRAPPLE_MAX_DISTANCE * 0.8)
    );

    return {
      success: true,
      effect: {
        type: 'swing',
        position: context.position,
        direction: swingPoint,
        duration: 3,
      },
    };
  }

  private executeZipline(context: AbilityContext): AbilityResult {
    // Deploy a zipline from current position in look direction
    const direction = vec3Normalize(context.direction);
    const ziplineEnd = vec3Add(
      context.position, 
      vec3Scale(direction, 50) // 50 unit zipline
    );

    this.activeZipline = {
      start: { ...context.position },
      end: ziplineEnd,
    };
    this.ziplineExpiresAt = context.timestamp + 15000; // 15 seconds

    return {
      success: true,
      effect: {
        type: 'zipline',
        position: context.position,
        direction: ziplineEnd,
        duration: 15,
      },
    };
  }

  updatePassive(_deltaTime: number): void {
    const now = Date.now();

    // Momentum Master - 15% bonus speed for 2 seconds after swinging
    if (now - this.lastSwingEnd < 2000) {
      this.momentumBoostUntil = this.lastSwingEnd + 2000;
    }

    // Check zipline expiration
    if (this.activeZipline && now >= this.ziplineExpiresAt) {
      this.activeZipline = null;
    }
  }

  onSwingEnd(): void {
    this.lastSwingEnd = Date.now();
  }

  getPassiveSpeedBoost(): number {
    return Date.now() < this.momentumBoostUntil ? 0.15 : 0;
  }

  getActiveZipline(): { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } } | null {
    return this.activeZipline;
  }

  isZiplineActive(): boolean {
    return this.activeZipline !== null && Date.now() < this.ziplineExpiresAt;
  }
}

