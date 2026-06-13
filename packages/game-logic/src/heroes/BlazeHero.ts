import { HeroBase, AbilityContext, AbilityResult } from './HeroBase.js';
import {
  BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE,
  BLAZE_ROCKET_JUMP_VERTICAL_FORCE,
  BLAZE_FLAMETHROWER_MAX_FUEL,
  BLAZE_FLAMETHROWER_FUEL_REGEN,
  BLAZE_FLAMETHROWER_RANGE,
  BLAZE_FLAMETHROWER_DAMAGE,
  BLAZE_GEARSTORM_RADIUS,
} from '@voxel-strike/shared';
import { vec3Scale, vec3Normalize } from '@voxel-strike/shared';

export class BlazeHero extends HeroBase {
  private flamethrowerFuel: number = BLAZE_FLAMETHROWER_MAX_FUEL;
  private gearstormCenter: { x: number; y: number; z: number } | null = null;
  private gearstormEndTime: number = 0;

  constructor() {
    super('blaze');
  }

  executeAbility(abilityId: string, context: AbilityContext): AbilityResult {
    switch (abilityId) {
      case 'blaze_flamethrower':
        return this.executeFlamethrower(context);
      case 'blaze_rocketjump':
        return this.executeRocketJump(context);
      case 'blaze_airstrike':
        return this.executeAirstrike(context);
      default:
        return { success: false, message: 'Unknown ability' };
    }
  }

  private executeFlamethrower(context: AbilityContext): AbilityResult {
    if (this.flamethrowerFuel <= 0) {
      return { success: false, message: 'No fuel' };
    }

    return {
      success: true,
      effect: {
        type: 'flamethrower',
        position: context.position,
        direction: context.direction,
        value: BLAZE_FLAMETHROWER_DAMAGE,
        maxDistance: BLAZE_FLAMETHROWER_RANGE,
      },
    };
  }

  private executeRocketJump(context: AbilityContext): AbilityResult {
    // Explosive jump - launches upward with an explosion
    const launchForce = { x: 0, y: BLAZE_ROCKET_JUMP_VERTICAL_FORCE, z: 0 };

    // Add forward component based on look direction
    launchForce.x = context.direction.x * BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE;
    launchForce.z = context.direction.z * BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE;

    return {
      success: true,
      effect: {
        type: 'rocket_jump',
        position: context.position,
        direction: launchForce,
      },
    };
  }

  private executeAirstrike(context: AbilityContext): AbilityResult {
    this.gearstormCenter = context.position;
    this.gearstormEndTime = context.timestamp + 5000; // 5 second duration

    return {
      success: true,
      effect: {
        type: 'infernal_gearstorm',
        position: context.position,
        duration: 5,
        value: 100, // Total damage over duration
        radius: BLAZE_GEARSTORM_RADIUS,
      },
    };
  }

  updatePassive(_deltaTime: number): void {
    const now = Date.now();

    // Check ultimate end
    if (this.gearstormCenter && now >= this.gearstormEndTime) {
      this.gearstormCenter = null;
    }
  }

  consumeFuel(amount: number): void {
    this.flamethrowerFuel = Math.max(0, this.flamethrowerFuel - amount);
  }

  regenerateFuel(deltaTime: number, _isGrounded?: boolean): void {
    this.flamethrowerFuel = Math.min(
      BLAZE_FLAMETHROWER_MAX_FUEL,
      this.flamethrowerFuel + BLAZE_FLAMETHROWER_FUEL_REGEN * deltaTime
    );
  }

  getFuel(): number {
    return this.flamethrowerFuel;
  }

  getAirstrikeTarget(): { x: number; y: number; z: number } | null {
    return this.gearstormCenter;
  }

  isAirstrikeActive(): boolean {
    return this.gearstormCenter !== null && Date.now() < this.gearstormEndTime;
  }
}
