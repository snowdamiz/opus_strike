import { HeroBase, AbilityContext, AbilityResult } from './HeroBase.js';
import {
  GRAPPLE_MAX_DISTANCE,
  HOOKSHOT_GROUND_HOOKS_RADIUS,
  HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS,
} from '@voxel-strike/shared';
import { vec3Scale, vec3Add, vec3Normalize } from '@voxel-strike/shared';

export class HookshotHero extends HeroBase {
  constructor() {
    super('hookshot');
  }

  executeAbility(abilityId: string, context: AbilityContext): AbilityResult {
    switch (abilityId) {
      case 'hookshot_grapple':
        return this.executeGrapple(context);
      case 'hookshot_anchor_wall':
        return this.executeAnchorWall(context);
      case 'hookshot_ground_hooks':
        return this.executeGroundHooks(context);
      default:
        return { success: false, message: 'Unknown ability' };
    }
  }

  private executeGrapple(context: AbilityContext): AbilityResult {
    // E ability - Quick grapple that pulls player toward geometry
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

  private executeAnchorWall(context: AbilityContext): AbilityResult {
    // Q ability - Ground anchor raises a temporary solid barricade
    const direction = vec3Normalize(context.direction);
    // Use horizontal direction only (hook travels on ground)
    const horizontalDir = vec3Normalize({
      x: direction.x,
      y: 0,
      z: direction.z,
    });

    return {
      success: true,
      effect: {
        type: 'earth_wall',
        position: context.position,
        direction: horizontalDir,
        duration: 6.25,
        maxDistance: 24.35,
      },
    };
  }

  private executeGroundHooks(context: AbilityContext): AbilityResult {
    return {
      success: true,
      effect: {
        type: 'ground_hooks_root',
        position: context.position,
        radius: HOOKSHOT_GROUND_HOOKS_RADIUS,
        duration: HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS,
      },
    };
  }

  updatePassive(_deltaTime: number): void {}
}
