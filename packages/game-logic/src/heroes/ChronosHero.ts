import { HeroBase, AbilityContext, AbilityResult } from './HeroBase.js';

export class ChronosHero extends HeroBase {
  constructor() {
    super('chronos');
  }

  executeAbility(abilityId: string, _context: AbilityContext): AbilityResult {
    switch (abilityId) {
      case 'chronos_lifeline_conduit':
      case 'chronos_timebreak':
      case 'chronos_ascendant_paradox':
        return { success: false, message: 'Chronos abilities are metadata-only for now' };
      default:
        return { success: false, message: 'Unknown ability' };
    }
  }

  updatePassive(_deltaTime: number): void {
    // Chronos passive metadata is wired, but no gameplay effect exists yet.
  }
}
