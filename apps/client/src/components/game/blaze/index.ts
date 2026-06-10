// Blaze hero visual effects - split for maintainability

export { 
  RocketsManager, 
  triggerRocketJumpExplosion, 
  RocketJumpExplosions,
  ROCKET_JUMP_DURATION,
  prewarmRocketResources,
} from './rockets';

export { 
  triggerAirStrike, 
  AirStrikeTargetingIndicator,
  AirStrikeEffects,
  AIR_STRIKE_DURATION,
} from './airstrike';

export { 
  BombEffect, 
  BombTargetingIndicator,
} from './bomb';

export { 
  FlamethrowerEffect,
} from './flamethrower';
export type { FlamethrowerPose } from './flamethrower';

export { 
  prewarmBlazeMaterials,
} from './materials';
