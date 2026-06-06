// Blaze hero visual effects - split for maintainability

export { 
  RocketsManager, 
  triggerRocketJumpExplosion, 
  RocketJumpExplosions,
  ROCKET_JUMP_DURATION,
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

export { 
  prewarmBlazeMaterials,
} from './materials';
