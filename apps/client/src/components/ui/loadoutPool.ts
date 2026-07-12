import { ALL_HERO_IDS } from '@voxel-strike/shared';
import type { HeroId } from '@voxel-strike/shared';
import { getHeroSkillItems, type HeroSkillItem, type HeroSkillRarity } from './HeroSkillKit';
import type { AbilityIconType } from './HeroIcons';

// Data for the Loadout tab.
//
// The game currently binds exactly one skill to each input slot. Each slot is
// seeded from the real shipped skill (`getHeroSkillItems`, common rarity, owned)
// plus one hand-authored "epic" alternative per category (LMB / RMB / ability /
// ultimate). Implemented alternatives are owned/equippable; concepts that are not
// wired to gameplay remain locked and browsable.

export type LoadoutSlotKey =
  | 'primaryFire'
  | 'secondaryFire'
  | 'ability1'
  | 'ability2'
  | 'ultimate';

export type LoadoutGroupId = 'lmb' | 'rmb' | 'abilities' | 'ultimates';

export type LoadoutRarity = HeroSkillRarity;

// Placeholder ownership state, mirroring the skins armory filters.
export type LoadoutOwnership = 'owned' | 'available' | 'locked';

export interface LoadoutSkillPreviewVideo {
  videoSrc: string;
  posterSrc: string;
}

export interface LoadoutSlotDef {
  key: LoadoutSlotKey;
  /** keybind code, fed to formatKeybind() for the LMB / RMB / E / Q / F badge */
  code: string;
  group: LoadoutGroupId;
  /** human label for the slot ("Primary Fire", "Ultimate", …) */
  category: string;
}

// Order matches getHeroSkillItems(): [LMB, RMB, E, Q, F].
export const LOADOUT_SLOTS: LoadoutSlotDef[] = [
  { key: 'primaryFire', code: 'Mouse0', group: 'lmb', category: 'Primary Fire' },
  { key: 'secondaryFire', code: 'Mouse1', group: 'rmb', category: 'Secondary Fire' },
  { key: 'ability1', code: 'KeyE', group: 'abilities', category: 'Ability' },
  { key: 'ability2', code: 'KeyQ', group: 'abilities', category: 'Ability' },
  { key: 'ultimate', code: 'KeyF', group: 'ultimates', category: 'Ultimate' },
];

export const LOADOUT_GROUPS: { id: LoadoutGroupId; label: string }[] = [
  { id: 'lmb', label: 'LMB' },
  { id: 'rmb', label: 'RMB' },
  { id: 'abilities', label: 'Abilities' },
  { id: 'ultimates', label: 'Ultimates' },
];

export interface LoadoutSkillOption extends HeroSkillItem {
  /** unique within hero + slot, e.g. 'phantom-primaryFire-stock' */
  id: string;
  isPlaceholder: boolean;
  /** one-line subtitle shown on the catalog row */
  tagline: string;
  rarity: LoadoutRarity;
  ownership: LoadoutOwnership;
  previewVideo?: LoadoutSkillPreviewVideo;
}

export type HeroLoadoutPool = Record<HeroId, Record<LoadoutSlotKey, LoadoutSkillOption[]>>;

// A hand-authored epic loadout skill. One per hero per category; implemented
// entries are equippable while the remaining concepts stay locked.
interface NewEpicSkill {
  /** id suffix, unique within hero + slot (e.g. 'soulrend') */
  key: string;
  abilityId?: string;
  iconType: AbilityIconType;
  /** drives the cooldown-suppression rule in buildDisplayMeta ('LMB' hides cd) */
  input: 'LMB' | 'RMB' | 'E' | 'F';
  name: string;
  /** one-line subtitle shown on the catalog row */
  tagline: string;
  description: string;
  cooldown?: number;
  duration?: number;
  charges?: number;
  /** flavor stat pills (damage / effects); cd & active pills are derived */
  meta: string[];
}

type HeroEpicSet = {
  primaryFire: NewEpicSkill; // LMB
  secondaryFire: NewEpicSkill; // RMB
  ability: NewEpicSkill; // slots into E or Q
  ultimate: NewEpicSkill; // F
};

const BLAZE_SKILL_PREVIEWS: Record<string, LoadoutSkillPreviewVideo> = {
  'blaze-primaryFire-stock': {
    videoSrc: '/videos/blaze/fireball-rockets.mp4',
    posterSrc: '/videos/blaze/posters/fireball-rockets.jpg',
  },
  'blaze-primaryFire-scrapshot': {
    videoSrc: '/videos/blaze/scrapshot.mp4',
    posterSrc: '/videos/blaze/posters/scrapshot.jpg',
  },
  'blaze-secondaryFire-stock': {
    videoSrc: '/videos/blaze/meteor-strike.mp4',
    posterSrc: '/videos/blaze/posters/meteor-strike.jpg',
  },
  'blaze-secondaryFire-phosphorflare': {
    videoSrc: '/videos/blaze/phosphor-flare.mp4',
    posterSrc: '/videos/blaze/posters/phosphor-flare.jpg',
  },
  'blaze-ability1-stock': {
    videoSrc: '/videos/blaze/flamethrower.mp4',
    posterSrc: '/videos/blaze/posters/flamethrower.jpg',
  },
  'blaze-ability1-afterburner': {
    videoSrc: '/videos/blaze/afterburner-dash.mp4',
    posterSrc: '/videos/blaze/posters/afterburner-dash.jpg',
  },
  'blaze-ability2-stock': {
    videoSrc: '/videos/blaze/rocket-jump.mp4',
    posterSrc: '/videos/blaze/posters/rocket-jump.jpg',
  },
  'blaze-ultimate-stock': {
    videoSrc: '/videos/blaze/infernal-gearstorm.mp4',
    posterSrc: '/videos/blaze/posters/infernal-gearstorm.jpg',
  },
  'blaze-ultimate-phoenixdive': {
    videoSrc: '/videos/blaze/phoenix-dive.mp4',
    posterSrc: '/videos/blaze/posters/phoenix-dive.jpg',
  },
};

function getSkillPreviewVideo(optionId: string): LoadoutSkillPreviewVideo | undefined {
  return BLAZE_SKILL_PREVIEWS[optionId];
}

const NEW_EPIC_SKILLS: Record<HeroId, HeroEpicSet> = {
  phantom: {
    primaryFire: {
      key: 'soulrend',
      iconType: 'soulrend',
      input: 'LMB',
      name: 'Soulrend Daggers',
      tagline: 'Spectral daggers that ricochet to a second nearby target.',
      description:
        'Replaces the Dire Ball stream with thrown spectral daggers that ricochet once to a nearby enemy — less single-target DPS, but tags flankers around cover and punishes grouped backlines.',
      meta: ['14 dmg', 'ricochets x1', '10 ammo'],
    },
    secondaryFire: {
      key: 'riftbolt',
      abilityId: 'phantom_rift_bolt',
      iconType: 'riftbolt',
      input: 'RMB',
      cooldown: 6,
      name: 'Rift Bolt',
      tagline: 'Fire a void orb, then re-press to teleport to it.',
      description:
        'A no-charge alternative to Void Ray: fire a slow void orb and re-press RMB to teleport to its current position — a second repositioning tool baked into the secondary.',
      meta: ['22 dmg', 'recast to teleport'],
    },
    ability: {
      key: 'umbraldecoy',
      abilityId: 'phantom_umbral_decoy',
      iconType: 'umbraldecoy',
      input: 'E',
      cooldown: 12,
      duration: 3,
      name: 'Umbral Decoy',
      tagline: 'Spawn a convincing shadow clone that moves, casts, and draws fire while you cloak.',
      description:
        'Deploy a copy of your current Phantom and skin. It weaves toward your aim, fakes harmless attacks and abilities, and draws enemy and bot fire while you briefly turn invisible.',
      meta: ['random movement', 'fake casts', '1.5s cloak'],
    },
    ultimate: {
      key: 'nightreign',
      abilityId: 'phantom_nightreign',
      iconType: 'nightreign',
      input: 'F',
      duration: 7,
      name: 'Nightreign',
      tagline: 'Hunter’s wraith form — hits lifesteal, kills extend it.',
      description:
        'Enter a wraith form: every Dire Ball hit heals you and shaves Blink’s cooldown, and a kill extends the duration. The hunter’s ultimate, opposite Veil’s evasive stealth.',
      meta: ['hits lifesteal', 'kills extend'],
    },
  },
  hookshot: {
    primaryFire: {
      key: 'razorchain',
      iconType: 'razorchain',
      input: 'LMB',
      name: 'Razor Chain',
      tagline: 'Hooks bleed and slow, locking targets in the brawl.',
      description:
        'Chain Hooks now apply a short bleed and a brief slow on hit — lower hit damage, but sticky brawler pressure that keeps targets from peeling away.',
      meta: ['12 dmg', 'bleed 6 / 2s', 'slow 20%'],
    },
    secondaryFire: {
      key: 'reelslam',
      iconType: 'reelslam',
      input: 'RMB',
      cooldown: 4,
      name: 'Reel Slam',
      tagline: 'Yank yourself to the target and slam — a dive, not a pull.',
      description:
        'Identity flip of Drag Hook: instead of pulling the enemy to you, yank yourself to them and slam on arrival — a gap-closer dive in place of a peel.',
      meta: ['28 dmg', 'dash to target'],
    },
    ability: {
      key: 'tethertrap',
      iconType: 'tethertrap',
      input: 'E',
      cooldown: 9,
      duration: 6,
      name: 'Tether Trap',
      tagline: 'String a chain tripwire that slows and chips crossers.',
      description:
        'Anchor two points with a chain tripwire that slows and damages enemies crossing it — a zoning trap in place of the mobility Grapple or Anchor Wall.',
      meta: ['slow 35%', 'tripwire chain'],
    },
    ultimate: {
      key: 'leviathanhook',
      iconType: 'leviathanhook',
      input: 'F',
      name: 'Leviathan Hook',
      tagline: 'One giant line hook drags every enemy into a pile.',
      description:
        'Fire one massive line hook that drags every enemy it passes into a pile in front of you and briefly stuns them — a wombo-combo setup in place of Ground Hooks’ in-place root.',
      meta: ['line pull', '0.75s stun', '20 range'],
    },
  },
  blaze: {
    primaryFire: {
      key: 'scrapshot',
      iconType: 'scrapshot',
      input: 'LMB',
      name: 'Scrapshot',
      tagline: 'A point-blank incendiary scattergun for aerial dives.',
      description:
        'Trade the rocket stream for a fiery scattergun: one big incendiary burst at point-blank range that falls off hard at distance — built for aerial dives.',
      meta: ['8 x 6 pellets', '6 ammo', 'close range'],
    },
    secondaryFire: {
      key: 'phosphorflare',
      iconType: 'phosphorflare',
      input: 'RMB',
      cooldown: 6,
      name: 'Phosphor Flare',
      tagline: 'Lob a thermite canister that leaves a lingering fire pool.',
      description:
        'Lob an arcing thermite canister that creates a lingering fire pool for zone denial, in place of Meteor Strike’s single big burst — control over burst.',
      meta: ['12 dmg/tick', 'fire pool 4s'],
    },
    ability: {
      key: 'afterburner',
      abilityId: 'blaze_afterburner',
      iconType: 'afterburner',
      input: 'E',
      cooldown: 7,
      name: 'Afterburner Dash',
      tagline: 'Surge forward, leaving a trail of fire behind you.',
      description:
        'A fast forward afterburner burst that leaves a damaging ground fire trail — horizontal repositioning and chip damage, a counterpart to Rocket Jump’s vertical launch.',
      meta: ['long forward dash', 'wide fire trail'],
    },
    ultimate: {
      key: 'phoenixdive',
      abilityId: 'blaze_phoenix_dive',
      iconType: 'phoenixdive',
      input: 'F',
      name: 'Phoenix Dive',
      tagline: 'Launch high, then crash down on a target in flame.',
      description:
        'Launch high into the air and crash down at a targeted location in a huge fiery explosion — a mobile burst ultimate in place of Gearstorm’s stationary area-denial.',
      meta: ['80 impact', 'targeted crash', '5 radius'],
    },
  },
  chronos: {
    primaryFire: {
      key: 'entropybeam',
      iconType: 'entropybeam',
      input: 'LMB',
      name: 'Entropy Beam',
      tagline: 'A decay beam that ramps the longer it holds a target.',
      description:
        'A continuous decay beam that ramps up damage the longer it stays on one target — sustained single-target pressure in place of Verdant Pulse’s spammy pokes.',
      meta: ['8 → 20 dmg', 'ramps on target', 'continuous'],
    },
    secondaryFire: {
      key: 'rewindbulwark',
      iconType: 'rewindbulwark',
      input: 'RMB',
      name: 'Rewind Bulwark',
      tagline: 'A time-dilation dome that slows incoming enemy fire.',
      description:
        'Project a dome bubble around Chronos and nearby allies that slows enemy projectiles passing through it — area protection in place of Aegis’ forward wall.',
      meta: ['300 HP dome', 'slows enemy fire'],
    },
    ability: {
      key: 'rewind',
      iconType: 'rewind',
      input: 'E',
      cooldown: 14,
      name: 'Rewind',
      tagline: 'Mark an ally to snap back to their position and health.',
      description:
        'Mark yourself or an ally; after ~3 seconds they snap back to the position and health they had at cast — the iconic time-support save.',
      meta: ['recall after 3s', 'restores HP'],
    },
    ultimate: {
      key: 'chronosphere',
      iconType: 'chronosphere',
      input: 'F',
      duration: 5,
      name: 'Chronosphere',
      tagline: 'Drop a bubble that drastically slows enemies inside.',
      description:
        'Drop a large stationary bubble that heavily slows all enemies inside for its duration — team-fight lockdown in place of Ascendant Paradox’s personal flight.',
      meta: ['slow 60%', '8m radius'],
    },
  },
};

function formatSeconds(seconds: number): string {
  return `${seconds < 1 ? seconds.toFixed(2).replace(/0$/, '') : seconds.toFixed(seconds % 1 === 0 ? 0 : 1)}s`;
}

// Mirrors HeroesPage.getMetaPills: cooldown chip is suppressed for LMB weapons,
// charges take precedence over a plain cooldown, then duration, then the skill's
// own card-stat chips (already baked into item.meta by getHeroSkillItems).
function buildDisplayMeta(item: HeroSkillItem): string[] {
  const pills: string[] = [];
  const suppressCooldown = item.input === 'LMB';
  const cooldown = item.cooldown ?? 0;
  const duration = item.duration ?? 0;
  const charges = item.charges ?? 0;
  const chargeRegenTime = item.chargeRegenTime ?? cooldown;

  if (charges > 1) {
    pills.push(`${charges} charges`);
    if (chargeRegenTime > 0) pills.push(`${formatSeconds(chargeRegenTime)} cd`);
  } else if (!suppressCooldown && cooldown > 0) {
    pills.push(`${formatSeconds(cooldown)} cd`);
  }

  if (duration > 0) pills.push(`${formatSeconds(duration)} active`);

  return [...pills, ...(item.meta ?? [])];
}

// The real shipped skill for the slot: common rarity, owned, equipped by default.
function buildStockOption(heroId: HeroId, slot: LoadoutSlotDef, base: HeroSkillItem): LoadoutSkillOption {
  const id = `${heroId}-${slot.key}-stock`;
  return {
    ...base,
    id,
    isPlaceholder: false,
    tagline: isWeaponSlot(slot) ? 'Standard issue.' : 'Default kit ability.',
    rarity: base.rarity ?? 'common',
    ownership: 'owned',
    meta: buildDisplayMeta(base),
    previewVideo: getSkillPreviewVideo(id),
  };
}

// A hand-authored epic alternative with ownership derived from implementation status.
function buildEpicOption(heroId: HeroId, slot: LoadoutSlotDef, def: NewEpicSkill): LoadoutSkillOption {
  const id = `${heroId}-${slot.key}-${def.key}`;
  const item: HeroSkillItem = {
    input: def.input,
    abilityId: def.abilityId,
    name: def.name,
    description: def.description,
    iconType: def.iconType,
    cooldown: def.cooldown,
    duration: def.duration,
    charges: def.charges,
    rarity: 'epic',
    meta: def.meta,
  };
  return {
    ...item,
    id,
    isPlaceholder: false,
    tagline: def.tagline,
    rarity: 'epic',
    ownership: (heroId === 'phantom' && (
      (slot.key === 'primaryFire' && def.key === 'soulrend') ||
      (slot.key === 'secondaryFire' && def.key === 'riftbolt') ||
      (slot.key === 'ability1' && def.key === 'umbraldecoy') ||
      (slot.key === 'ultimate' && def.key === 'nightreign')
    )) ||
      (heroId === 'blaze' && (
      (slot.key === 'primaryFire' && def.key === 'scrapshot') ||
      (slot.key === 'secondaryFire' && def.key === 'phosphorflare') ||
      (slot.key === 'ability1' && def.key === 'afterburner') ||
      (slot.key === 'ultimate' && def.key === 'phoenixdive')
      ))
      ? 'owned'
      : 'locked',
    meta: buildDisplayMeta(item),
    previewVideo: getSkillPreviewVideo(id),
  };
}

function isWeaponSlot(slot: LoadoutSlotDef): boolean {
  return slot.group === 'lmb' || slot.group === 'rmb';
}

// Built once at module load — the pools are static, so item references stay
// stable across renders. Never mutate the cached base items from getHeroSkillItems.
export const HERO_LOADOUT_POOL: HeroLoadoutPool = (() => {
  const pool = {} as HeroLoadoutPool;
  for (const heroId of ALL_HERO_IDS) {
    const baseItems = getHeroSkillItems(heroId); // [LMB, RMB, E, Q, F]
    const epics = NEW_EPIC_SKILLS[heroId];
    const heroPool = {} as Record<LoadoutSlotKey, LoadoutSkillOption[]>;
    LOADOUT_SLOTS.forEach((slot, index) => {
      const base = baseItems[index];
      const options = [buildStockOption(heroId, slot, base)];
      // Attach the hand-authored epic for this category. The single new ability
      // hangs off the E (ability1) list so it appears once in the shared E/Q pool.
      if (slot.key === 'primaryFire') options.push(buildEpicOption(heroId, slot, epics.primaryFire));
      else if (slot.key === 'secondaryFire') options.push(buildEpicOption(heroId, slot, epics.secondaryFire));
      else if (slot.key === 'ability1') options.push(buildEpicOption(heroId, slot, epics.ability));
      else if (slot.key === 'ultimate') options.push(buildEpicOption(heroId, slot, epics.ultimate));
      heroPool[slot.key] = options;
    });
    pool[heroId] = heroPool;
  }
  return pool;
})();

export function defaultOptionId(heroId: HeroId, slot: LoadoutSlotKey): string {
  return HERO_LOADOUT_POOL[heroId][slot][0].id;
}

export const BLAZE_SCRAPSHOT_OPTION_ID = 'blaze-primaryFire-scrapshot';
export const PHANTOM_SOULREND_OPTION_ID = 'phantom-primaryFire-soulrend';
export const PHANTOM_RIFT_BOLT_OPTION_ID = 'phantom-secondaryFire-riftbolt';
export const PHANTOM_UMBRAL_DECOY_OPTION_ID = 'phantom-ability1-umbraldecoy';
export const PHANTOM_NIGHTREIGN_OPTION_ID = 'phantom-ultimate-nightreign';
export const BLAZE_PHOSPHOR_FLARE_OPTION_ID = 'blaze-secondaryFire-phosphorflare';
export const BLAZE_AFTERBURNER_OPTION_ID = 'blaze-ability1-afterburner';
export const BLAZE_PHOENIX_DIVE_OPTION_ID = 'blaze-ultimate-phoenixdive';

// E (ability1) and Q (ability2) draw from one shared, interchangeable pool —
// any ability can occupy either slot.
export const ABILITY_SLOT_KEYS: LoadoutSlotKey[] = ['ability1', 'ability2'];

export function isAbilitySlot(slot: LoadoutSlotKey): boolean {
  return slot === 'ability1' || slot === 'ability2';
}

export function getAbilityPool(heroId: HeroId): LoadoutSkillOption[] {
  return ABILITY_SLOT_KEYS.flatMap((slot) => HERO_LOADOUT_POOL[heroId][slot]);
}

export function findOption(
  heroId: HeroId,
  slot: LoadoutSlotKey,
  id: string | undefined,
): LoadoutSkillOption {
  // An equipped ability id may belong to the other ability slot's pool.
  const options = isAbilitySlot(slot) ? getAbilityPool(heroId) : HERO_LOADOUT_POOL[heroId][slot];
  return options.find((option) => option.id === id) ?? HERO_LOADOUT_POOL[heroId][slot][0];
}
