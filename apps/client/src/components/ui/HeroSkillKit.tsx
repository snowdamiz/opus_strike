import {
  ABILITY_DEFINITIONS,
  BLAZE_FLAMETHROWER_FUEL_DRAIN,
  BLAZE_FLAMETHROWER_FUEL_REGEN,
  BLAZE_FLAMETHROWER_MAX_FUEL,
  BLAZE_FLAMETHROWER_RANGE,
  BLAZE_GEARSTORM_RADIUS,
  BLAZE_ROCKET_FIRE_INTERVAL_MS,
  CHRONOS_ASCENDANT_PARADOX_PULSE_RADIUS,
  CHRONOS_LIFELINE_HEAL,
  CHRONOS_LIFELINE_MAX_TARGETS,
  CHRONOS_LIFELINE_RADIUS,
  CHRONOS_LIFELINE_RELEASE_DELAY_MS,
  CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
  CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE,
  CHRONOS_VERDANT_PULSE_COOLDOWN_MS,
  PHANTOM_BLINK_DISTANCE,
  PHANTOM_PRIMARY_MAGAZINE_SIZE,
  PHANTOM_PRIMARY_RELOAD_SECONDS,
  PHANTOM_VOID_RAY_COOLDOWN_SECONDS,
  VOID_RAY_CHARGE_TIME,
} from '@voxel-strike/shared';
import type { HeroId } from '@voxel-strike/shared';
import {
  BLAZE_BOMB_FALL_DURATION,
  DRAG_HOOK_COOLDOWN,
  DRAG_HOOK_MAX_DISTANCE,
  GRAPPLE_MAX_RANGE,
  GRAPPLE_TRAP_MAX_RANGE,
  HOOKSHOT_FIRE_INTERVAL,
  HOOKSHOT_MAX_DISTANCE,
  PHANTOM_FIRE_INTERVAL,
} from '../../hooks/player/constants';
import { ABILITY_COLORS } from '../../styles/colorTokens';
import { AbilityIcon, getAbilityIconType, type AbilityIconType } from './HeroIcons';

export type HeroSkillTone = 'click' | 'ultimate';

export interface HeroSkillItem {
  input: string;
  name: string;
  description: string;
  iconType: AbilityIconType;
  abilityId?: string;
  tone?: HeroSkillTone;
  cooldown?: number;
  duration?: number;
  charges?: number;
  chargeRegenTime?: number;
  resourceCost?: number;
  meta?: string[];
}

export interface HeroClickSkill extends HeroSkillItem {
  input: 'LMB' | 'RMB';
  cooldown: number;
  tone?: 'click';
}

const fromAbility = (
  input: string,
  abilityId: string,
  tone?: HeroSkillItem['tone'],
  overrides: Partial<Omit<HeroSkillItem, 'input' | 'abilityId'>> = {}
): HeroSkillItem => {
  const ability = ABILITY_DEFINITIONS[abilityId];

  return {
    input,
    abilityId,
    name: ability.name,
    description: ability.description,
    iconType: getAbilityIconType(abilityId),
    tone,
    cooldown: ability.cooldown,
    duration: ability.duration,
    charges: ability.charges,
    chargeRegenTime: ability.chargeRegenTime,
    resourceCost: ability.resourceCost,
    ...overrides,
  };
};

function secondsFromMs(ms: number): number {
  return ms / 1000;
}

function formatMetaSeconds(seconds: number): string {
  return `${seconds < 1 ? seconds.toFixed(2).replace(/0$/, '') : seconds.toFixed(seconds % 1 === 0 ? 0 : 1)}s`;
}

export const HERO_CLICK_SKILLS: Record<HeroId, HeroClickSkill[]> = {
  phantom: [
    {
      input: 'LMB',
      name: 'Dire Ball',
      description: 'Hold to fire alternating shadow projectiles from a 12-shot magazine.',
      cooldown: secondsFromMs(PHANTOM_FIRE_INTERVAL),
      iconType: 'direball',
      meta: [
        `${PHANTOM_PRIMARY_MAGAZINE_SIZE} ammo`,
        `${PHANTOM_PRIMARY_RELOAD_SECONDS}s reload`,
      ],
    },
    {
      input: 'RMB',
      abilityId: 'phantom_void_ray',
      name: 'Void Ray',
      description: 'Hold to charge for 1 second, then fire a piercing long-range beam.',
      cooldown: PHANTOM_VOID_RAY_COOLDOWN_SECONDS,
      iconType: 'voidray',
      meta: [`${formatMetaSeconds(secondsFromMs(VOID_RAY_CHARGE_TIME))} charge`, '42m range'],
    },
  ],
  hookshot: [
    {
      input: 'LMB',
      name: 'Chain Hooks',
      description: 'Launch short hooks that extend, snap back, and pressure close targets.',
      cooldown: secondsFromMs(HOOKSHOT_FIRE_INTERVAL),
      iconType: 'chainhooks',
      meta: [`${HOOKSHOT_MAX_DISTANCE}m range`],
    },
    {
      input: 'RMB',
      name: 'Drag Hook',
      description: 'Fire a heavier hook that catches enemy heroes and pulls them in.',
      cooldown: secondsFromMs(DRAG_HOOK_COOLDOWN),
      iconType: 'draghook',
      meta: [`${DRAG_HOOK_MAX_DISTANCE}m range`, 'pulls heroes'],
    },
  ],
  blaze: [
    {
      input: 'LMB',
      name: 'Fireball Rockets',
      description: 'Hold to launch fast fireball rockets that burst with splash pressure.',
      cooldown: BLAZE_ROCKET_FIRE_INTERVAL_MS / 1000,
      iconType: 'fireball',
      meta: ['24 dmg', '2.8m splash'],
    },
    {
      input: 'RMB',
      abilityId: 'blaze_bomb',
      name: ABILITY_DEFINITIONS.blaze_bomb.name,
      description: 'Hold to target a zone, then release to call down a blazing meteor.',
      cooldown: ABILITY_DEFINITIONS.blaze_bomb.cooldown,
      iconType: getAbilityIconType('blaze_bomb'),
      meta: [`${formatMetaSeconds(secondsFromMs(BLAZE_BOMB_FALL_DURATION))} fall`, '60m max', '4m splash'],
    },
  ],
  chronos: [
    {
      input: 'LMB',
      name: 'Verdant Pulse',
      description: 'Hold to fire green pulses that damage enemies. Ascendant Paradox turns them into larger AOE blasts.',
      cooldown: secondsFromMs(CHRONOS_VERDANT_PULSE_COOLDOWN_MS),
      iconType: 'verdantpulse',
      meta: [
        '16 dmg',
        'AOE while F active',
      ],
    },
    {
      input: 'RMB',
      name: 'Aegis of Ages',
      description: 'Hold a forward shield that blocks enemy damage for Chronos and allies behind it.',
      cooldown: 0,
      iconType: 'aegisofages',
      meta: ['hold', 'blocks damage'],
    },
  ],
};

export const HERO_ABILITY_SKILLS: Record<HeroId, HeroSkillItem[]> = {
  phantom: [
    fromAbility('E', 'phantom_blink', undefined, {
      meta: [`${PHANTOM_BLINK_DISTANCE}m blink`, 'void zone'],
    }),
    fromAbility('Q', 'phantom_personal_shield', undefined, {
      meta: ['absorbs 1 hit'],
    }),
    fromAbility('F', 'phantom_veil', 'ultimate', {
      meta: ['30% speed', 'attack breaks'],
    }),
  ],
  hookshot: [
    fromAbility('E', 'hookshot_grapple', undefined, {
      meta: [`${GRAPPLE_MAX_RANGE}m range`, 'terrain pull'],
    }),
    fromAbility('Q', 'hookshot_anchor_wall', undefined, {
      meta: ['24.35m range'],
    }),
    fromAbility('F', 'hookshot_grapple_trap', 'ultimate', {
      meta: [`${GRAPPLE_TRAP_MAX_RANGE}m throw`, '8m radius', '15 dmg/s'],
    }),
  ],
  blaze: [
    fromAbility('E', 'blaze_flamethrower', undefined, {
      meta: [
        `${BLAZE_FLAMETHROWER_MAX_FUEL} fuel`,
        `${BLAZE_FLAMETHROWER_RANGE}m range`,
        `${BLAZE_FLAMETHROWER_FUEL_DRAIN}/s drain`,
        `${BLAZE_FLAMETHROWER_FUEL_REGEN}/s regen`,
      ],
    }),
    fromAbility('Q', 'blaze_rocketjump', undefined, {
      meta: ['self launch', 'nearby damage'],
    }),
    fromAbility('F', 'blaze_airstrike', 'ultimate', {
      meta: [`${BLAZE_GEARSTORM_RADIUS}m radius`, '10 dmg/tick'],
    }),
  ],
  chronos: [
    fromAbility('E', 'chronos_lifeline_conduit', undefined, {
      meta: [
        `${CHRONOS_LIFELINE_HEAL} heal`,
        `${CHRONOS_LIFELINE_RADIUS}m radius`,
        `${CHRONOS_LIFELINE_MAX_TARGETS} targets`,
        `${formatMetaSeconds(secondsFromMs(CHRONOS_LIFELINE_RELEASE_DELAY_MS))} release`,
      ],
    }),
    fromAbility('Q', 'chronos_timebreak', undefined, {
      meta: [
        `${CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE}m range`,
        `${formatMetaSeconds(secondsFromMs(CHRONOS_TIMEBREAK_RELEASE_DELAY_MS))} release`,
      ],
    }),
    fromAbility('F', 'chronos_ascendant_paradox', 'ultimate', {
      meta: [`${CHRONOS_ASCENDANT_PARADOX_PULSE_RADIUS}m pulse AOE`, 'supercharges LMB'],
    }),
  ],
};

export function getHeroSkillItems(heroId: HeroId): HeroSkillItem[] {
  return [
    ...HERO_CLICK_SKILLS[heroId].map((skill) => ({
      ...skill,
      tone: 'click' as const,
    })),
    ...HERO_ABILITY_SKILLS[heroId],
  ];
}

type HeroSkillIconSize = 'card' | 'hud';

const iconSizeClass: Record<HeroSkillIconSize, string> = {
  card: 'w-9 h-9',
  hud: 'w-9 h-9 sm:w-10 sm:h-10 lg:w-11 lg:h-11',
};

const iconGlyphSize: Record<HeroSkillIconSize, number> = {
  card: 20,
  hud: 23,
};

export function HeroSkillIcon({
  item,
  color,
  size = 'card',
  muted = false,
  active = false,
  className = '',
}: {
  item: HeroSkillItem;
  color: string;
  size?: HeroSkillIconSize;
  muted?: boolean;
  active?: boolean;
  className?: string;
}) {
  const isUltimate = item.tone === 'ultimate';
  const activeColor = isUltimate ? ABILITY_COLORS.ultimate : color;

  return (
    <div
      className={`${iconSizeClass[size]} rounded-md flex items-center justify-center flex-shrink-0 overflow-hidden ${className}`}
      style={{
        background: muted
          ? 'rgba(255,255,255,0.06)'
          : isUltimate
            ? `linear-gradient(135deg, ${ABILITY_COLORS.ultimate}, ${ABILITY_COLORS.ultimateDarker})`
            : color,
        border: active ? `1px solid ${activeColor}` : '1px solid rgba(255,255,255,0.12)',
        boxShadow: active ? `0 0 18px ${activeColor}55` : 'inset 0 1px 0 rgba(255,255,255,0.08)',
      }}
    >
      <AbilityIcon
        type={item.iconType}
        size={iconGlyphSize[size]}
        color={muted ? 'rgba(255,255,255,0.42)' : '#ffffff'}
      />
    </div>
  );
}
