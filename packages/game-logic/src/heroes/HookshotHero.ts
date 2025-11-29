import { HeroBase, AbilityContext, AbilityResult } from './HeroBase.js';
import { GRAPPLE_MAX_DISTANCE } from '@voxel-strike/shared';
import { vec3Scale, vec3Add, vec3Normalize } from '@voxel-strike/shared';

export class HookshotHero extends HeroBase {
  private momentumBoostUntil: number = 0;
  private lastSwingEnd: number = 0;
  private activeGrappleTrap: { 
    position: { x: number; y: number; z: number }; 
    radius: number;
    startTime: number;
    duration: number;
  } | null = null;

  constructor() {
    super('hookshot');
  }

  executeAbility(abilityId: string, context: AbilityContext): AbilityResult {
    switch (abilityId) {
      case 'hookshot_grapple':
        return this.executeGrapple(context);
      case 'hookshot_swing':
        return this.executeSwing(context);
      case 'hookshot_grapple_trap':
        return this.executeGrappleTrap(context);
      default:
        return { success: false, message: 'Unknown ability' };
    }
  }

  private executeGrapple(context: AbilityContext): AbilityResult {
    // Q ability - Quick grapple that pulls player toward geometry
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
    // E ability - Swing line for pendulum movement
    const direction = vec3Normalize(context.direction);
    // Look upward slightly for swing points
    const swingDir = {
      x: direction.x,
      y: Math.max(direction.y, 0.3),
      z: direction.z,
    };
    const normalizedSwingDir = vec3Normalize(swingDir);
    const swingPoint = vec3Add(
      context.position, 
      vec3Scale(normalizedSwingDir, GRAPPLE_MAX_DISTANCE * 0.85)
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

  private executeGrappleTrap(context: AbilityContext): AbilityResult {
    // F ability (Ultimate) - Throw grapple trap that hooks enemies in AOE
    // The trap position should be set by targeting on client
    const trapPosition = context.targetPosition || context.position;
    const trapRadius = 8;
    const trapDuration = 8;

    this.activeGrappleTrap = {
      position: { ...trapPosition },
      radius: trapRadius,
      startTime: context.timestamp,
      duration: trapDuration,
    };

    return {
      success: true,
      effect: {
        type: 'grapple_trap',
        position: trapPosition,
        radius: trapRadius,
        duration: trapDuration,
      },
    };
  }

  updatePassive(_deltaTime: number): void {
    const now = Date.now();

    // Momentum Master - 15% bonus speed for 2 seconds after swinging
    if (now - this.lastSwingEnd < 2000) {
      this.momentumBoostUntil = this.lastSwingEnd + 2000;
    }

    // Check grapple trap expiration
    if (this.activeGrappleTrap) {
      const elapsed = (now - this.activeGrappleTrap.startTime) / 1000;
      if (elapsed >= this.activeGrappleTrap.duration) {
        this.activeGrappleTrap = null;
      }
    }
  }

  onSwingEnd(): void {
    this.lastSwingEnd = Date.now();
  }

  getPassiveSpeedBoost(): number {
    return Date.now() < this.momentumBoostUntil ? 0.15 : 0;
  }

  getActiveGrappleTrap(): { 
    position: { x: number; y: number; z: number }; 
    radius: number;
    startTime: number;
    duration: number;
  } | null {
    return this.activeGrappleTrap;
  }

  isGrappleTrapActive(): boolean {
    if (!this.activeGrappleTrap) return false;
    const elapsed = (Date.now() - this.activeGrappleTrap.startTime) / 1000;
    return elapsed < this.activeGrappleTrap.duration;
  }
}

