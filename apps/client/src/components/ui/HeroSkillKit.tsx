import {
  ABILITY_CARD_STATS,
  ABILITY_DEFINITIONS,
  BLAZE_ROCKET_FIRE_INTERVAL_MS,
  DEFAULT_BLAZE_PRIMARY_SKILL,
  DEFAULT_BLAZE_SECONDARY_SKILL,
  DEFAULT_BLAZE_ULTIMATE_SKILL,
  DEFAULT_PHANTOM_PRIMARY_SKILL,
  DEFAULT_PHANTOM_SECONDARY_SKILL,
  CHRONOS_AEGIS_SHIELD_MAX_HP,
  CHRONOS_AEGIS_SHIELD_RECHARGE_PER_SECOND,
  CHRONOS_VERDANT_PULSE_COOLDOWN_MS,
  PHANTOM_VOID_RAY_COOLDOWN_SECONDS,
} from '@voxel-strike/shared';
import type { AbilityCardStat, BlazePrimarySkill, BlazeSecondarySkill, BlazeUltimateSkill, HeroId, PhantomPrimarySkill, PhantomSecondarySkill } from '@voxel-strike/shared';
import {
  DRAG_HOOK_COOLDOWN,
  HOOKSHOT_FIRE_INTERVAL,
  PHANTOM_FIRE_INTERVAL,
} from '../../hooks/player/constants';
import { SKILL_RARITY_COLORS } from '../../styles/colorTokens';
import {
  getDefaultHeroAbilityBindings,
  type HeroAbilityBindings,
} from '../../store/loadoutStore';
import { AbilityIcon, getAbilityIconType, type AbilityIconType } from './HeroIcons';

export type HeroSkillTone = 'click' | 'ultimate';
export type HeroSkillRarity = 'common' | 'epic' | 'unique' | 'legendary';

export interface HeroSkillItem {
  input: string;
  name: string;
  description: string;
  iconType: AbilityIconType;
  abilityId?: string;
  tone?: HeroSkillTone;
  rarity?: HeroSkillRarity;
  cooldown?: number;
  duration?: number;
  charges?: number;
  chargeRegenTime?: number;
  statKey?: string;
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
    statKey: abilityId,
    name: ability.name,
    description: ability.description,
    iconType: getAbilityIconType(abilityId),
    tone,
    cooldown: ability.cooldown,
    duration: ability.duration,
    charges: ability.charges,
    chargeRegenTime: ability.chargeRegenTime,
    ...overrides,
  };
};

function secondsFromMs(ms: number): number {
  return ms / 1000;
}

function formatMetaSeconds(seconds: number): string {
  return `${seconds < 1 ? seconds.toFixed(2).replace(/0$/, '') : seconds.toFixed(seconds % 1 === 0 ? 0 : 1)}s`;
}

function formatStatNumber(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1).replace(/\.0$/, '');
}

function formatAbilityCardStat(stat: AbilityCardStat): string {
  const value = stat.format === 'seconds'
    ? formatMetaSeconds(stat.value)
    : formatStatNumber(stat.value);

  return `${stat.prefix ?? ''}${value}${stat.suffix ?? ''} ${stat.label}`;
}

const abilityCardStats = ABILITY_CARD_STATS as Record<string, readonly AbilityCardStat[]>;

function getAbilityCardMeta(statKey?: string): string[] {
  if (!statKey) return [];
  return (abilityCardStats[statKey] ?? []).map(formatAbilityCardStat);
}

export const HERO_CLICK_SKILLS: Record<HeroId, HeroClickSkill[]> = {
  phantom: [
    {
      input: 'LMB',
      statKey: 'phantom_dire_ball',
      name: 'Dire Ball',
      description: 'Hold to fire alternating shadow projectiles from a 12-shot magazine.',
      cooldown: secondsFromMs(PHANTOM_FIRE_INTERVAL),
      iconType: 'direball',
    },
    {
      input: 'RMB',
      abilityId: 'phantom_void_ray',
      statKey: 'phantom_void_ray',
      name: 'Void Ray',
      description: 'Hold to charge for 1 second, then fire a piercing long-range beam.',
      cooldown: PHANTOM_VOID_RAY_COOLDOWN_SECONDS,
      iconType: 'voidray',
    },
  ],
  hookshot: [
    {
      input: 'LMB',
      statKey: 'hookshot_basic_attack',
      name: 'Chain Hooks',
      description: 'Launch short hooks that extend, snap back, and pressure close targets.',
      cooldown: secondsFromMs(HOOKSHOT_FIRE_INTERVAL),
      iconType: 'chainhooks',
    },
    {
      input: 'RMB',
      statKey: 'hookshot_heavy_attack',
      name: 'Drag Hook',
      description: 'Fire a heavier hook that catches heroes and pulls them in front of you.',
      cooldown: secondsFromMs(DRAG_HOOK_COOLDOWN),
      iconType: 'draghook',
    },
  ],
  blaze: [
    {
      input: 'LMB',
      statKey: 'blaze_rocket',
      name: 'Fireball Rockets',
      description: 'Hold to launch fast fireball rockets that burst with splash pressure.',
      cooldown: BLAZE_ROCKET_FIRE_INTERVAL_MS / 1000,
      iconType: 'fireball',
    },
    {
      input: 'RMB',
      abilityId: 'blaze_bomb',
      statKey: 'blaze_bomb',
      name: ABILITY_DEFINITIONS.blaze_bomb.name,
      description: 'Hold to target a zone, then release to call down a blazing meteor.',
      cooldown: ABILITY_DEFINITIONS.blaze_bomb.cooldown,
      iconType: getAbilityIconType('blaze_bomb'),
    },
  ],
  chronos: [
    {
      input: 'LMB',
      statKey: 'chronos_verdant_pulse',
      name: 'Verdant Pulse',
      description: 'Hold to fire green pulses that damage enemies. Ascendant Paradox turns them into larger AOE blasts.',
      cooldown: secondsFromMs(CHRONOS_VERDANT_PULSE_COOLDOWN_MS),
      iconType: 'verdantpulse',
    },
    {
      input: 'RMB',
      name: 'Aegis of Ages',
      description: `Hold a ${CHRONOS_AEGIS_SHIELD_MAX_HP} HP forward shield that blocks enemy damage for Chronos and allies behind it. Recharges slowly while lowered.`,
      cooldown: 0,
      iconType: 'aegisofages',
      meta: [`${CHRONOS_AEGIS_SHIELD_MAX_HP} HP`, `${CHRONOS_AEGIS_SHIELD_RECHARGE_PER_SECOND}/s recharge`],
    },
  ],
};

export const BLAZE_SCRAPSHOT_SKILL: HeroClickSkill = {
  input: 'LMB',
  statKey: 'blaze_scrapshot',
  name: 'Scrapshot',
  description: 'Fire six incendiary pellets in a short-range burst with steep distance falloff.',
  cooldown: BLAZE_ROCKET_FIRE_INTERVAL_MS / 1000,
  iconType: 'scrapshot',
  rarity: 'epic',
};

export const PHANTOM_SOULREND_SKILL: HeroClickSkill = {
  input: 'LMB',
  statKey: 'phantom_soulrend_daggers',
  name: 'Soulrend Daggers',
  description: 'Throw spectral daggers that ricochet once to the nearest enemy within 8 meters of the first target.',
  cooldown: secondsFromMs(PHANTOM_FIRE_INTERVAL),
  iconType: 'soulrend',
  rarity: 'epic',
};

export const PHANTOM_RIFT_BOLT_SKILL: HeroClickSkill = {
  input: 'RMB',
  abilityId: 'phantom_rift_bolt',
  statKey: 'phantom_rift_bolt',
  name: ABILITY_DEFINITIONS.phantom_rift_bolt.name,
  description: ABILITY_DEFINITIONS.phantom_rift_bolt.description,
  cooldown: ABILITY_DEFINITIONS.phantom_rift_bolt.cooldown,
  duration: ABILITY_DEFINITIONS.phantom_rift_bolt.duration,
  iconType: 'riftbolt',
  rarity: 'epic',
};

export const BLAZE_PHOSPHOR_FLARE_SKILL: HeroClickSkill = {
  input: 'RMB',
  abilityId: 'blaze_phosphor_flare',
  statKey: 'blaze_phosphor_flare',
  name: ABILITY_DEFINITIONS.blaze_phosphor_flare.name,
  description: ABILITY_DEFINITIONS.blaze_phosphor_flare.description,
  cooldown: ABILITY_DEFINITIONS.blaze_phosphor_flare.cooldown,
  duration: ABILITY_DEFINITIONS.blaze_phosphor_flare.duration,
  iconType: 'phosphorflare',
  rarity: 'epic',
};

export const BLAZE_AFTERBURNER_SKILL: HeroSkillItem = fromAbility(
  'E',
  'blaze_afterburner',
  undefined,
  { iconType: 'afterburner', rarity: 'epic' },
);

export const BLAZE_PHOENIX_DIVE_SKILL: HeroSkillItem = fromAbility(
  'F',
  'blaze_phoenix_dive',
  'ultimate',
  { iconType: 'phoenixdive', rarity: 'epic' },
);

export const HERO_ABILITY_SKILLS: Record<HeroId, HeroSkillItem[]> = {
  phantom: [
    fromAbility('E', 'phantom_blink'),
    fromAbility('Q', 'phantom_personal_shield'),
    fromAbility('F', 'phantom_veil', 'ultimate'),
  ],
  hookshot: [
    fromAbility('E', 'hookshot_grapple'),
    fromAbility('Q', 'hookshot_anchor_wall'),
    fromAbility('F', 'hookshot_ground_hooks', 'ultimate'),
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

// The skill list is static per hero, so cache it once per heroId. This keeps the
// returned array (and its item objects) referentially stable across renders, which
// lets memoized HUD leaf components (e.g. HUDSkillSlot) skip re-renders.
const heroSkillItemsCache = new Map<string, HeroSkillItem[]>();

export function getHeroSkillItems(
  heroId: HeroId,
  blazePrimarySkill: BlazePrimarySkill = DEFAULT_BLAZE_PRIMARY_SKILL,
  abilityBindings: HeroAbilityBindings = getDefaultHeroAbilityBindings(heroId),
  blazeSecondarySkill: BlazeSecondarySkill = DEFAULT_BLAZE_SECONDARY_SKILL,
  blazeUltimateSkill: BlazeUltimateSkill = DEFAULT_BLAZE_ULTIMATE_SKILL,
  phantomPrimarySkill: PhantomPrimarySkill = DEFAULT_PHANTOM_PRIMARY_SKILL,
  phantomSecondarySkill: PhantomSecondarySkill = DEFAULT_PHANTOM_SECONDARY_SKILL,
): HeroSkillItem[] {
  const cacheKey = [
    heroId,
    heroId === 'blaze' ? blazePrimarySkill : DEFAULT_BLAZE_PRIMARY_SKILL,
    heroId === 'blaze' ? blazeSecondarySkill : DEFAULT_BLAZE_SECONDARY_SKILL,
    heroId === 'blaze' ? blazeUltimateSkill : DEFAULT_BLAZE_ULTIMATE_SKILL,
    abilityBindings.ability1,
    abilityBindings.ability2,
    heroId === 'phantom' ? phantomPrimarySkill : DEFAULT_PHANTOM_PRIMARY_SKILL,
    heroId === 'phantom' ? phantomSecondarySkill : DEFAULT_PHANTOM_SECONDARY_SKILL,
  ].join(':');
  const cached = heroSkillItemsCache.get(cacheKey);
  if (cached) return cached;

  const clickSkills = heroId === 'blaze'
    ? [
      blazePrimarySkill === 'scrapshot' ? BLAZE_SCRAPSHOT_SKILL : HERO_CLICK_SKILLS.blaze[0],
      blazeSecondarySkill === 'phosphor_flare' ? BLAZE_PHOSPHOR_FLARE_SKILL : HERO_CLICK_SKILLS.blaze[1],
    ]
    : heroId === 'phantom'
      ? [
        phantomPrimarySkill === 'soulrend_daggers' ? PHANTOM_SOULREND_SKILL : HERO_CLICK_SKILLS.phantom[0],
        phantomSecondarySkill === 'rift_bolt' ? PHANTOM_RIFT_BOLT_SKILL : HERO_CLICK_SKILLS.phantom[1],
      ]
      : HERO_CLICK_SKILLS[heroId];
  const stockAbilitySkills = HERO_ABILITY_SKILLS[heroId];
  const stockAbilityById = new Map(
    stockAbilitySkills.slice(0, 2).map((skill) => [skill.abilityId, skill]),
  );
  if (heroId === 'blaze') {
    stockAbilityById.set('blaze_afterburner', BLAZE_AFTERBURNER_SKILL);
  }
  const slottedAbilitySkills: HeroSkillItem[] = [
    {
      ...(stockAbilityById.get(abilityBindings.ability1) ?? stockAbilitySkills[0]),
      input: 'E',
    },
    {
      ...(stockAbilityById.get(abilityBindings.ability2) ?? stockAbilitySkills[1]),
      input: 'Q',
    },
    heroId === 'blaze' && blazeUltimateSkill === 'phoenix_dive'
      ? BLAZE_PHOENIX_DIVE_SKILL
      : stockAbilitySkills[2],
  ];

  const items: HeroSkillItem[] = [
    ...clickSkills.map((skill) => ({
      ...skill,
      tone: 'click' as const,
      rarity: skill.rarity ?? 'common',
      meta: [
        ...getAbilityCardMeta(skill.statKey),
        ...(skill.meta ?? []),
      ],
    })),
    ...slottedAbilitySkills.map((skill) => ({
      ...skill,
      rarity: skill.rarity ?? 'common' as const,
      meta: [
        ...getAbilityCardMeta(skill.statKey),
        ...(skill.meta ?? []),
      ],
    })),
  ];

  heroSkillItemsCache.set(cacheKey, items);
  return items;
}

type HeroSkillIconSize = 'card' | 'hud';

const iconSizeClass: Record<HeroSkillIconSize, string> = {
  card: 'w-9 h-9',
  hud: 'w-10 h-10 sm:w-11 sm:h-11 lg:w-12 lg:h-12',
};

const iconGlyphSize: Record<HeroSkillIconSize, number> = {
  card: 20,
  hud: 26,
};

export function HeroSkillIcon({
  item,
  color: _color,
  size = 'card',
  muted = false,
  active = false,
  className = '',
}: {
  item: HeroSkillItem;
  /** Deprecated: skills are tinted by rarity now, not hero color. Kept for callers. */
  color?: string;
  size?: HeroSkillIconSize;
  muted?: boolean;
  active?: boolean;
  className?: string;
}) {
  const hex = SKILL_RARITY_COLORS[item.rarity ?? 'common'].hex;

  return (
    <div
      className={`${iconSizeClass[size]} rounded-md flex items-center justify-center flex-shrink-0 overflow-hidden ${className}`}
      style={{
        background: muted
          ? 'rgba(255,255,255,0.05)'
          : `radial-gradient(circle at 50% 32%, ${hex}3d, transparent 70%), linear-gradient(160deg, ${hex}29, rgba(0,0,0,0.42))`,
        border: `1px solid ${hex}${active ? 'e6' : '57'}`,
        boxShadow: active
          ? `0 0 16px ${hex}80, inset 0 1px 0 rgba(255,255,255,0.1)`
          : `inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 14px ${hex}0d`,
      }}
    >
      <AbilityIcon
        type={item.iconType}
        size={iconGlyphSize[size]}
        color={muted ? 'rgba(255,255,255,0.4)' : hex}
      />
    </div>
  );
}
