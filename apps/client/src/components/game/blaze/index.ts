// Blaze hero visual effects - split for maintainability

export { 
  RocketsManager, 
  prewarmRocketResources,
} from './rockets';

export {
  triggerRocketJumpExplosion, 
  RocketJumpExplosions,
  ROCKET_JUMP_DURATION,
  prewarmRocketJumpExplosionResources,
  appendRocketJumpExplosionGpuPrewarmObjects,
} from './rocketJumpExplosion';

export { 
  triggerAirStrike, 
  AirStrikeEffects,
  AIR_STRIKE_DURATION,
} from './airstrike';

export {
  BombEffect, 
  BombTargetingIndicator,
} from './bomb';

export {
  PhosphorFlareEffect,
  getPhosphorFlareGpuPrewarmMaterials,
  prewarmPhosphorFlareResources,
} from './phosphorFlare';

export { 
  FlamethrowerEffect,
  RemoteFlamethrowerInstancedVisuals,
} from './flamethrower';
export type { FlamethrowerPose } from './flamethrower';

export { 
  prewarmBlazeMaterials,
} from './materials';
