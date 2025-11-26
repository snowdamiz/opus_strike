import type { AbilityState, AbilityDefinition, AbilityCast, Vec3 } from '@voxel-strike/shared';
import { ABILITY_DEFINITIONS } from '@voxel-strike/shared';
import type { HeroBase, AbilityContext, AbilityResult } from '../heroes/HeroBase.js';

export interface AbilityEvent {
  playerId: string;
  abilityId: string;
  position: Vec3;
  direction?: Vec3;
  targetPosition?: Vec3;
  timestamp: number;
  result: AbilityResult;
}

export class AbilitySystem {
  private heroes: Map<string, HeroBase> = new Map();
  private pendingAbilities: AbilityCast[] = [];
  private eventListeners: ((event: AbilityEvent) => void)[] = [];

  registerHero(playerId: string, hero: HeroBase): void {
    this.heroes.set(playerId, hero);
  }

  unregisterHero(playerId: string): void {
    this.heroes.delete(playerId);
  }

  getHero(playerId: string): HeroBase | undefined {
    return this.heroes.get(playerId);
  }

  queueAbility(cast: AbilityCast): void {
    this.pendingAbilities.push(cast);
  }

  processPendingAbilities(): AbilityEvent[] {
    const events: AbilityEvent[] = [];

    for (const cast of this.pendingAbilities) {
      const hero = this.heroes.get(cast.playerId);
      if (!hero) continue;

      const context: AbilityContext = {
        playerId: cast.playerId,
        position: cast.direction ? { x: 0, y: 0, z: 0 } : { x: 0, y: 0, z: 0 }, // Would come from player state
        direction: cast.direction ?? { x: 0, y: 0, z: 1 },
        targetPosition: cast.targetPosition,
        timestamp: cast.timestamp,
      };

      const result = hero.useAbility(cast.abilityId, context);

      const event: AbilityEvent = {
        playerId: cast.playerId,
        abilityId: cast.abilityId,
        position: context.position,
        direction: cast.direction,
        targetPosition: cast.targetPosition,
        timestamp: cast.timestamp,
        result,
      };

      events.push(event);
      this.notifyListeners(event);
    }

    this.pendingAbilities = [];
    return events;
  }

  update(deltaTime: number): void {
    // Update all hero cooldowns
    for (const hero of this.heroes.values()) {
      hero.update(deltaTime);
    }
  }

  canUseAbility(playerId: string, abilityId: string): boolean {
    const hero = this.heroes.get(playerId);
    if (!hero) return false;
    return hero.canUseAbility(abilityId);
  }

  getAbilityState(playerId: string, abilityId: string): AbilityState | undefined {
    const hero = this.heroes.get(playerId);
    if (!hero) return undefined;
    return hero.getAbilityState(abilityId);
  }

  getAllAbilityStates(playerId: string): Map<string, AbilityState> {
    const hero = this.heroes.get(playerId);
    if (!hero) return new Map();
    return hero.getAllAbilityStates();
  }

  addUltimateCharge(playerId: string, amount: number): void {
    const hero = this.heroes.get(playerId);
    if (hero) {
      hero.addUltimateCharge(amount);
    }
  }

  getUltimateCharge(playerId: string): number {
    const hero = this.heroes.get(playerId);
    return hero?.getUltimateCharge() ?? 0;
  }

  resetHero(playerId: string): void {
    const hero = this.heroes.get(playerId);
    if (hero) {
      hero.reset();
    }
  }

  onEvent(listener: (event: AbilityEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index !== -1) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  private notifyListeners(event: AbilityEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }
}

