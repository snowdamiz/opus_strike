import { HeroBase, AbilityContext, AbilityResult } from './HeroBase.js';
import {
  CHRONOS_LIFELINE_HEAL,
  CHRONOS_LIFELINE_MAX_TARGETS,
  CHRONOS_LIFELINE_RADIUS,
  CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE,
} from '@voxel-strike/shared';

export class ChronosHero extends HeroBase {
  constructor() {
    super('chronos');
  }

  executeAbility(abilityId: string, context: AbilityContext): AbilityResult {
    switch (abilityId) {
      case 'chronos_lifeline_conduit':
        return this.executeLifelineConduit(context);
      case 'chronos_timebreak':
        return this.executeTimebreak(context);
      case 'chronos_ascendant_paradox':
        return { success: false, message: 'Chronos abilities are metadata-only for now' };
      default:
        return { success: false, message: 'Unknown ability' };
    }
  }

  private executeLifelineConduit(context: AbilityContext): AbilityResult {
    return {
      success: true,
      effect: {
        type: 'lifeline_conduit',
        position: context.position,
        radius: CHRONOS_LIFELINE_RADIUS,
        value: CHRONOS_LIFELINE_HEAL,
        maxDistance: CHRONOS_LIFELINE_MAX_TARGETS,
      },
    };
  }

  private executeTimebreak(context: AbilityContext): AbilityResult {
    return {
      success: true,
      effect: {
        type: 'timebreak',
        position: context.position,
        radius: CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE,
      },
    };
  }

  updatePassive(_deltaTime: number): void {
    // Chronos passive metadata is wired, but no gameplay effect exists yet.
  }
}
