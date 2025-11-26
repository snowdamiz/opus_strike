import { HeroBase, AbilityContext, AbilityResult } from './HeroBase.js';
import { JETPACK_MAX_FUEL, JETPACK_FUEL_REGEN } from '@voxel-strike/shared';
import { vec3Scale, vec3Normalize } from '@voxel-strike/shared';

export class BlazeHero extends HeroBase {
  private jetpackFuel: number = JETPACK_MAX_FUEL;
  private passiveFuelRegenBonus: number = 0;
  private lastKillTime: number = 0;
  private airstrikeTarget: { x: number; y: number; z: number } | null = null;
  private airstrikeEndTime: number = 0;

  constructor() {
    super('blaze');
  }

  executeAbility(abilityId: string, context: AbilityContext): AbilityResult {
    switch (abilityId) {
      case 'blaze_jetpack':
        return this.executeJetpack(context);
      case 'blaze_rocketjump':
        return this.executeRocketJump(context);
      case 'blaze_airstrike':
        return this.executeAirstrike(context);
      default:
        return { success: false, message: 'Unknown ability' };
    }
  }

  private executeJetpack(_context: AbilityContext): AbilityResult {
    // Jetpack is handled by movement system
    // This just validates that we can use it
    if (this.jetpackFuel <= 0) {
      return { success: false, message: 'No fuel' };
    }

    return {
      success: true,
      effect: {
        type: 'jetpack_activate',
        position: _context.position,
      },
    };
  }

  private executeRocketJump(context: AbilityContext): AbilityResult {
    // Explosive jump - launches upward with an explosion
    const launchForce = { x: 0, y: 20, z: 0 };
    
    // Add forward component based on look direction
    launchForce.x = context.direction.x * 5;
    launchForce.z = context.direction.z * 5;

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
    this.jetpackFuel = Math.max(0, this.jetpackFuel - amount);
  }

  regenerateFuel(deltaTime: number, isGrounded: boolean): void {
    if (isGrounded) {
      const regenRate = JETPACK_FUEL_REGEN * (1 + this.passiveFuelRegenBonus);
      this.jetpackFuel = Math.min(JETPACK_MAX_FUEL, this.jetpackFuel + regenRate * deltaTime);
    }
  }

  getFuel(): number {
    return this.jetpackFuel;
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

