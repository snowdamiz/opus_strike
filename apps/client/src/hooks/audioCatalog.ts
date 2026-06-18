import { BLAZE_GEARSTORM_DURATION_MS } from '@voxel-strike/shared';
import type { SoundDefinition } from './audioTypes';

export const SOUND_EFFECTS = {
  footstep: { path: '/sounds/walk.mp3', volume: 0.3 },
  walk: { path: '/sounds/walk.mp3', volume: 1.04 },
  jump: { path: '/sounds/jump.mp3', volume: 0.34 },
  land: { path: '/sounds/slide.mp3', volume: 0.4 },
  slide: { path: '/sounds/slide.mp3', volume: 0.32 },
  wallRun: { path: '/sounds/walk.mp3', volume: 0.4 },

  blink: { path: '/sounds/blink.mp3', volume: 0.6 },
  grapple: { path: '/sounds/hookshot_shot.mp3', volume: 0.5 },
  jetpack: { path: '/sounds/jetpack.mp3', volume: 0.4 },

  phantomBlink: { path: '/sounds/blink_short.mp3', volume: 0.39 },
  phantomVeil: { path: '/sounds/phantom_veil.mp3', volume: 0.2 },
  phantomBasic: { path: '/sounds/phantom_basic.mp3', volume: 0.1872 },
  phantomReload: { path: '/sounds/phantom_reload.mp3', volume: 0.27 },
  phantomShield: { path: '/sounds/phantom_shield.mp3', volume: 0.336 },
  phantomShieldCast: { path: '/sounds/phantom_shield_cast.mp3', volume: 0.464 },
  phantomVoidRay: { path: '/sounds/phantom_strong.mp3', volume: 0.6 },
  phantomVoidRayCharge: { path: '/sounds/phantom_right_click_charge.mp3', volume: 0.45 },

  blazeRocket: { path: '/sounds/rocket_fire.mp3', volume: 0.4 },
  blazeBombTarget: { path: '/sounds/button.mp3', volume: 0.75 },
  blazeBombRelease: { path: '/sounds/blaze_RMB_release.mp3', volume: 0.7 },
  blazeBombFall: { path: '/sounds/bomb_fall.mp3', volume: 0.8 },
  blazeBombExplode: { path: '/sounds/bomb_explode.mp3', volume: 1.862 },
  blazeFlamethrower: { path: '/sounds/jetpack.mp3', volume: 0.3 },
  blazeRocketJump: { path: '/sounds/rocket_jump.mp3', volume: 0.6 },
  blazeAirstrikeFire: { path: '/sounds/blaze_F_fire.mp3', volume: 0.5 },
  blazeAirstrikeGears: { path: '/sounds/blaze_F_gears.mp3', volume: 0.46 },

  hookshotShot: { path: '/sounds/hookshot_shot.mp3', volume: 0.58 },
  hookshotPrimary: { path: '/sounds/hookshot_lmb.mp3', volume: 0.48 },
  hookshotSecondary: { path: '/sounds/hookshot_rmb.mp3', volume: 0.58 },
  hookshotGrapple: { path: '/sounds/hookshot_lmb.mp3', volume: 0.5 },
  hookshotAnchorWall: { path: '/sounds/hookshot_q.mp3', volume: 0.6 },
  hookshotGroundHooks: { path: '/sounds/hookshot_voxel_strike.mp3', volume: 0.58 },
  hookshotRetract: { path: '/sounds/hookshot_retract.mp3', volume: 0.42 },

  chronosPulse: { path: '/sounds/chronos_charge.mp3', volume: 0 },
  chronosAegis: { path: '/sounds/chronos_shield.mp3', volume: 0.8352 },
  chronosLifeline: { path: '/sounds/choronos_heal.mp3', volume: 0.5 },
  chronosTimebreakCharge: { path: '/sounds/chronos_charge.mp3', volume: 0.72 },
  chronosPush: { path: '/sounds/chronos_push.mp3', volume: 0.72 },
  chronosTimebreak: { path: '/sounds/chronos_charge.mp3', volume: 0 },
  chronosSuperchargedImpact: { path: '/sounds/magic_impact.mp3', volume: 0.72 },

  hit: { path: '/sounds/laser_hit.mp3', volume: 0.6 },
  damage: { path: '/sounds/laser_hit.mp3', volume: 0.5 },
  death: { path: '/sounds/scream.mp3', volume: 0.6 },
  kill: { path: '/sounds/magic_impact.mp3', volume: 0.7 },

  flagPickup: { path: '/sounds/button_press.mp3', volume: 0.8 },
  flagDrop: { path: '/sounds/button.mp3', volume: 0.6 },
  flagCapture: { path: '/sounds/magic_impact.mp3', volume: 1.0 },
  flagReturn: { path: '/sounds/button_press.mp3', volume: 0.7 },

  healPickup: { path: '/sounds/heal_pickup.mp3', volume: 0.78 },
  powerupPickup: { path: '/sounds/powerup_pickkup.mp3', volume: 0.82 },

  buttonHover: { path: '/sounds/button.mp3', volume: 0.4 },
  buttonClick: { path: '/sounds/button.mp3', volume: 0.1, playbackDurationRatio: 0.15 },
  countdownTick: { path: '/sounds/tick.mp3', volume: 0.65 },
  countdown: { path: '/sounds/tick.mp3', volume: 0.6 },
  matchStart: { path: '/sounds/button_press.mp3', volume: 0.8 },
  roundEnd: { path: '/sounds/button_press.mp3', volume: 0.8 },
  victory: { path: '/sounds/magic_impact.mp3', volume: 0.9 },
  defeat: { path: '/sounds/scream.mp3', volume: 0.7 },

  lobbyMusic: { path: '/sounds/lobby.mp3', volume: 0.3 },
  gameMusic: { path: '/sounds/game.mp3', volume: 0.3 },
} as const satisfies Record<string, SoundDefinition>;

export type SoundName = keyof typeof SOUND_EFFECTS;
export type SoundGroup = 'menu' | 'lobby' | 'commonCombat' | 'phantom' | 'blaze' | 'hookshot' | 'chronos';

export const CHRONOS_VERDANT_PULSE_SHOT_PITCH = 1.28;
export const CHRONOS_VERDANT_PULSE_SHOT_VOLUME = 0.72;
export const BLAZE_BOMB_RELEASE_SOUND_START_OFFSET_MS = 260;
export const BLAZE_BOMB_RELEASE_SOUND_DURATION_MS = 1100;
export const BLAZE_BOMB_RELEASE_SOUND_FADE_OUT_MS = 80;
export const BLAZE_AIRSTRIKE_SOUND_DURATION_MS = BLAZE_GEARSTORM_DURATION_MS;
export const BLAZE_AIRSTRIKE_SOUND_FADE_IN_MS = 420;
export const BLAZE_AIRSTRIKE_SOUND_FADE_OUT_MS = 950;

export const SOUND_GROUPS: Record<SoundGroup, SoundName[]> = {
  menu: ['buttonHover', 'buttonClick'],
  lobby: ['buttonHover', 'buttonClick'],
  commonCombat: [
    'footstep',
    'walk',
    'jump',
    'land',
    'slide',
    'wallRun',
    'blink',
    'grapple',
    'jetpack',
    'hit',
    'damage',
    'death',
    'kill',
    'flagPickup',
    'flagDrop',
    'flagCapture',
    'flagReturn',
    'healPickup',
    'powerupPickup',
    'countdownTick',
    'countdown',
    'matchStart',
    'roundEnd',
    'victory',
    'defeat',
  ],
  phantom: [
    'phantomBlink',
    'phantomVeil',
    'phantomBasic',
    'phantomReload',
    'phantomShield',
    'phantomShieldCast',
    'phantomVoidRay',
    'phantomVoidRayCharge',
  ],
  blaze: [
    'blazeRocket',
    'blazeBombTarget',
    'blazeBombRelease',
    'blazeBombFall',
    'blazeBombExplode',
    'blazeFlamethrower',
    'blazeRocketJump',
    'blazeAirstrikeFire',
    'blazeAirstrikeGears',
  ],
  hookshot: [
    'hookshotShot',
    'hookshotPrimary',
    'hookshotSecondary',
    'hookshotGrapple',
    'hookshotAnchorWall',
    'hookshotGroundHooks',
    'hookshotRetract',
  ],
  chronos: [
    'phantomBasic',
    'chronosPulse',
    'chronosAegis',
    'chronosLifeline',
    'chronosTimebreakCharge',
    'chronosTimebreak',
    'chronosPush',
    'chronosSuperchargedImpact',
  ],
};

export const BLAZE_AIRSTRIKE_SOUND_LAYERS = [
  'blazeAirstrikeFire',
  'blazeAirstrikeGears',
] as const satisfies readonly SoundName[];

export const MUSIC_SOUND_NAMES = new Set<SoundName>(['lobbyMusic', 'gameMusic']);
