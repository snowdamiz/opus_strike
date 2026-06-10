import { ABILITY_DEFINITIONS, HERO_DEFINITIONS, PHANTOM_VOID_RAY_COOLDOWN_SECONDS } from '@voxel-strike/shared';
import type { HeroId } from '@voxel-strike/shared';
import { ABILITY_COLORS } from '../../styles/colorTokens';
import { AbilityIcon, getAbilityIconType, type AbilityIconType } from './HeroIcons';

export type HeroSkillTone = 'passive' | 'click' | 'ultimate';

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
    ...overrides,
  };
};

export const HERO_CLICK_SKILLS: Record<HeroId, HeroClickSkill[]> = {
  phantom: [
    {
      input: 'LMB',
      name: 'Dire Ball',
      description: 'Fire alternating shadow projectiles down your aim line.',
      cooldown: 0.55,
      iconType: 'direball',
    },
    {
      input: 'RMB',
      abilityId: 'phantom_void_ray',
      name: 'Void Ray',
      description: 'Charge, then release a piercing beam at long range.',
      cooldown: PHANTOM_VOID_RAY_COOLDOWN_SECONDS,
      iconType: 'voidray',
    },
  ],
  hookshot: [
    {
      input: 'LMB',
      name: 'Chain Hooks',
      description: 'Launch short hooks that extend, snap back, and pressure close targets.',
      cooldown: 0.6,
      iconType: 'chainhooks',
    },
    {
      input: 'RMB',
      name: 'Drag Hook',
      description: 'Fire a heavier hook that catches enemy heroes and pulls them in.',
      cooldown: 3.6,
      iconType: 'draghook',
    },
  ],
  blaze: [
    {
      input: 'LMB',
      name: 'Fireballs',
      description: 'Launch flaming fireballs that burst with splash pressure at mid range.',
      cooldown: 0.85,
      iconType: 'fireball',
    },
    {
      input: 'RMB',
      name: 'Meteor Strike',
      description: 'Mark a target zone, then call a blazing meteor down at an angle.',
      cooldown: 2.6,
      iconType: 'meteorstrike',
    },
  ],
  chronos: [
    {
      input: 'LMB',
      name: 'Verdant Pulse',
      description: 'Fire green pulses that damage enemies and lightly heal teammates on hit.',
      cooldown: 0.42,
      iconType: 'verdantpulse',
    },
    {
      input: 'RMB',
      name: 'Aegis of Ages',
      description: 'Hold a magic shield in front of Chronos to protect himself and teammates behind it.',
      cooldown: 0,
      iconType: 'aegisofages',
    },
  ],
};

export const HERO_ABILITY_SKILLS: Record<HeroId, HeroSkillItem[]> = {
  phantom: [
    fromAbility('E', 'phantom_blink'),
    fromAbility('Q', 'phantom_personal_shield'),
    fromAbility('F', 'phantom_veil', 'ultimate'),
  ],
  hookshot: [
    fromAbility('E', 'hookshot_grapple'),
    fromAbility('Q', 'hookshot_anchor_wall'),
    fromAbility('F', 'hookshot_grapple_trap', 'ultimate'),
  ],
  blaze: [
    fromAbility('E', 'blaze_flamethrower'),
    fromAbility('Q', 'blaze_rocketjump'),
    fromAbility('F', 'blaze_airstrike', 'ultimate'),
  ],
  chronos: [
    fromAbility('E', 'chronos_lifeline_conduit'),
    fromAbility('Q', 'chronos_timebreak'),
    fromAbility('F', 'chronos_ascendant_paradox', 'ultimate'),
  ],
};

export function getHeroSkillItems(heroId: HeroId): HeroSkillItem[] {
  const heroInfo = HERO_DEFINITIONS[heroId];

  return [
    {
      input: 'PASSIVE',
      name: heroInfo.passive.name,
      description: heroInfo.passive.description,
      iconType: 'passive',
      tone: 'passive',
    },
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
  const isPassive = item.tone === 'passive';
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
            : isPassive
              ? 'rgba(255,255,255,0.12)'
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
