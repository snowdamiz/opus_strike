import { HeroBase, AbilityContext, AbilityResult } from './HeroBase.js';
import {
  BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE,
  BLAZE_ROCKET_JUMP_VERTICAL_FORCE,
  BLAZE_FLAMETHROWER_MAX_FUEL,
  BLAZE_FLAMETHROWER_FUEL_REGEN,
  BLAZE_FLAMETHROWER_RANGE,
  BLAZE_FLAMETHROWER_DAMAGE,
} from '@voxel-strike/shared';
import { vec3Scale, vec3Normalize } from '@voxel-strike/shared';

export class BlazeHero extends HeroBase {
  private flamethrowerFuel: number = BLAZE_FLAMETHROWER_MAX_FUEL;
  private passiveFuelRegenBonus: number = 0;
  private lastKillTime: number = 0;
  private airstrikeTarget: { x: number; y: number; z: number } | null = null;
  private airstrikeEndTime: number = 0;

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
        value: 30, // Damage to nearby enemies
      },
    };
  }

  private executeAirstrike(context: AbilityContext): AbilityResult {
    if (!context.targetPosition) {
      return { success: false, message: 'No target position' };
    }

    this.airstrikeTarget = context.targetPosition;
    this.airstrikeEndTime = context.timestamp + 3000; // 3 second duration

    return {
      success: true,
      effect: {
        type: 'airstrike',
        position: context.targetPosition,
        duration: 3,
        value: 100, // Total damage over duration
      },
    };
  }

  updatePassive(deltaTime: number): void {
    const now = Date.now();

    // Afterburner - 50% faster fuel regen after getting a kill
    if (now - this.lastKillTime < 5000) {
      this.passiveFuelRegenBonus = 0.5;
    } else {
      this.passiveFuelRegenBonus = 0;
    }

    // Check airstrike end
    if (this.airstrikeTarget && now >= this.airstrikeEndTime) {
      this.airstrikeTarget = null;
    }
  }

  onKill(): void {
    this.lastKillTime = Date.now();
  }

  consumeFuel(amount: number): void {
    this.flamethrowerFuel = Math.max(0, this.flamethrowerFuel - amount);
  }

  regenerateFuel(deltaTime: number, isGrounded: boolean): void {
    if (isGrounded) {
      const regenRate = BLAZE_FLAMETHROWER_FUEL_REGEN * (1 + this.passiveFuelRegenBonus);
      this.flamethrowerFuel = Math.min(
        BLAZE_FLAMETHROWER_MAX_FUEL,
        this.flamethrowerFuel + regenRate * deltaTime
      );
    }
  }

  getFuel(): number {
    return this.flamethrowerFuel;
  }

  getPassiveFuelRegenBonus(): number {
    return this.passiveFuelRegenBonus;
  }

  getAirstrikeTarget(): { x: number; y: number; z: number } | null {
    return this.airstrikeTarget;
  }

  isAirstrikeActive(): boolean {
    return this.airstrikeTarget !== null && Date.now() < this.airstrikeEndTime;
  }
}
