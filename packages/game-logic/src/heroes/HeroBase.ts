import type { 
  HeroId, 
  HeroDefinition, 
  AbilityState, 
  AbilityDefinition,
  Vec3 
} from '@voxel-strike/shared';
import { HERO_DEFINITIONS, ABILITY_DEFINITIONS } from '@voxel-strike/shared';

export interface AbilityContext {
  playerId: string;
  position: Vec3;
  direction: Vec3;
  targetPosition?: Vec3;
  timestamp: number;
}

export interface AbilityResult {
  success: boolean;
  effect?: AbilityEffectData;
  cooldownStarted?: boolean;
  message?: string;
}

export interface AbilityEffectData {
  type: string;
  position: Vec3;
  direction?: Vec3;
  targetIds?: string[];
  duration?: number;
  value?: number;
  radius?: number;
  maxDistance?: number;
}

export abstract class HeroBase {
  readonly heroId: HeroId;
  readonly definition: HeroDefinition;
  
  protected abilities: Map<string, AbilityState> = new Map();
  protected passiveActive: boolean = true;
  protected ultimateCharge: number = 0;

  constructor(heroId: HeroId) {
    this.heroId = heroId;
    this.definition = HERO_DEFINITIONS[heroId];
    this.initializeAbilities();
  }

  private initializeAbilities(): void {
    const slots = [
      this.definition.ability1,
      this.definition.ability2,
      this.definition.ultimate,
    ];

    for (const slot of slots) {
      const abilityDef = ABILITY_DEFINITIONS[slot.abilityId];
      if (abilityDef) {
        this.abilities.set(slot.abilityId, {
          abilityId: slot.abilityId,
          cooldownRemaining: 0,
          charges: abilityDef.charges ?? 1,
          isActive: false,
        });
      }
    }
  }

  update(deltaTime: number): void {
    // Update cooldowns
    this.abilities.forEach((state, id) => {
      const def = ABILITY_DEFINITIONS[id];
      if (!def) return;

      // Reduce cooldown
      if (state.cooldownRemaining > 0) {
        state.cooldownRemaining = Math.max(0, state.cooldownRemaining - deltaTime);
      }

      // Regenerate charges
      if (def.charges && def.chargeRegenTime && state.charges < def.charges) {
        if (state.cooldownRemaining <= 0) {
          state.cooldownRemaining = def.chargeRegenTime;
          state.charges = Math.min(def.charges, state.charges + 1);
        }
      }
    });

    // Update passive
    this.updatePassive(deltaTime);
  }

  canUseAbility(abilityId: string): boolean {
    const state = this.abilities.get(abilityId);
    if (!state) return false;

    const def = ABILITY_DEFINITIONS[abilityId];
    if (!def) return false;

    // Check ultimate charge
    if (def.type === 'ultimate' && this.ultimateCharge < (def.resourceCost ?? 100)) {
      return false;
    }

    // Check charges or cooldown
    if (def.charges) {
      return state.charges > 0;
    }

    return state.cooldownRemaining <= 0;
  }

  useAbility(abilityId: string, context: AbilityContext): AbilityResult {
    if (!this.canUseAbility(abilityId)) {
      return { success: false, message: 'Ability not ready' };
    }

    const state = this.abilities.get(abilityId);
    const def = ABILITY_DEFINITIONS[abilityId];
    if (!state || !def) {
      return { success: false, message: 'Unknown ability' };
    }

    // Execute ability-specific logic
    const result = this.executeAbility(abilityId, context);
    
    if (result.success) {
      // Consume charges or start cooldown
      if (def.charges) {
        state.charges--;
        if (state.charges === 0 && def.chargeRegenTime) {
          state.cooldownRemaining = def.chargeRegenTime;
        }
      } else {
        state.cooldownRemaining = def.cooldown;
      }

      // Consume ultimate charge
      if (def.type === 'ultimate' && def.resourceCost) {
        this.ultimateCharge = 0;
      }

      result.cooldownStarted = true;
    }

    return result;
  }

  abstract executeAbility(abilityId: string, context: AbilityContext): AbilityResult;
  
  abstract updatePassive(deltaTime: number): void;

  addUltimateCharge(amount: number): void {
    this.ultimateCharge = Math.min(100, this.ultimateCharge + amount);
  }

  getUltimateCharge(): number {
    return this.ultimateCharge;
  }

  getAbilityState(abilityId: string): AbilityState | undefined {
    return this.abilities.get(abilityId);
  }

  getAllAbilityStates(): Map<string, AbilityState> {
    return new Map(this.abilities);
  }

  getStats() {
    return this.definition.stats;
  }

  reset(): void {
    this.ultimateCharge = 0;
    this.abilities.forEach((state, id) => {
      const def = ABILITY_DEFINITIONS[id];
      state.cooldownRemaining = 0;
      state.charges = def?.charges ?? 1;
      state.isActive = false;
    });
  }
}

export async function createHero(heroId: HeroId): Promise<HeroBase> {
  switch (heroId) {
    case 'phantom':
      const { PhantomHero } = await import('./PhantomHero.js');
      return new PhantomHero();
    case 'hookshot':
      const { HookshotHero } = await import('./HookshotHero.js');
      return new HookshotHero();
    case 'blaze':
      const { BlazeHero } = await import('./BlazeHero.js');
      return new BlazeHero();
    case 'glacier':
      const { GlacierHero } = await import('./GlacierHero.js');
      return new GlacierHero();
    default:
      throw new Error(`Unknown hero: ${heroId}`);
  }
}
