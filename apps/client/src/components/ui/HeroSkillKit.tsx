import { ABILITY_DEFINITIONS, HERO_DEFINITIONS } from '@voxel-strike/shared';
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
      name: 'Void Ray',
      description: 'Charge, then release a piercing beam at long range.',
      cooldown: 1.2,
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
      name: 'Rockets',
      description: 'Fire direct rockets with splash pressure at mid range.',
      cooldown: 0.85,
      iconType: 'rocket',
    },
    {
      input: 'RMB',
      name: 'Bomb',
      description: 'Pick a target zone, then drop an explosive payload.',
      cooldown: 2.6,
      iconType: 'bomb',
    },
  ],
  glacier: [
    {
      input: 'LMB',
      name: 'Ice Mallet',
      description: 'Swing a heavy ice hammer through nearby enemies.',
      cooldown: 0.75,
      iconType: 'icemallet',
    },
    {
      input: 'RMB',
      name: 'Ice Shield',
      description: 'Hold up a frost guard to block pressure while advancing.',
      cooldown: 1.2,
      iconType: 'iceshield',
    },
  ],
  pulse: [
    {
      input: 'LMB',
      name: 'Pulse Burst',
      description: 'Send quick energy bursts downrange with a rapid cadence.',
      cooldown: 0.36,
      iconType: 'pulseburst',
    },
    {
      input: 'RMB',
      name: 'Dash Hit',
      description: 'Snap into close range and punish enemies caught in the lane.',
      cooldown: 0.9,
      iconType: 'dashhit',
    },
  ],
  sentinel: [
    {
      input: 'LMB',
      name: 'Sentinel Bolt',
      description: 'Fire steady defensive bolts from a guarded stance.',
      cooldown: 0.65,
      iconType: 'sentinelbolt',
    },
    {
      input: 'RMB',
      name: 'Barrier Bash',
      description: 'Shove nearby threats back with a short-range shield strike.',
      cooldown: 1.4,
      iconType: 'barrierbash',
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
  glacier: [
    fromAbility('E', 'glacier_iceslide', undefined, {
      name: 'Ice Wall Rush',
      description: 'Hold to surge forward while building an ice wall behind you.',
      iconType: 'icewallrush',
      cooldown: undefined,
    }),
    fromAbility('Q', 'glacier_frostshield', undefined, {
      name: 'Ice Slide',
      description: 'Burst forward in a fast ground slide.',
      iconType: 'iceslide',
    }),
    fromAbility('F', 'glacier_fortress', 'ultimate', {
      name: 'Frost Storm Shield',
      description: 'Activate a protective blizzard and gain 75 shield for 8 seconds.',
      iconType: 'froststorm',
      duration: ABILITY_DEFINITIONS.glacier_frostshield.duration,
    }),
  ],
  pulse: [
    fromAbility('E', 'pulse_speedboost'),
    fromAbility('Q', 'pulse_dash'),
    fromAbility('F', 'pulse_haste', 'ultimate'),
  ],
  sentinel: [
    fromAbility('E', 'sentinel_fortify'),
    fromAbility('Q', 'sentinel_barrier'),
    fromAbility('F', 'sentinel_dome', 'ultimate'),
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
