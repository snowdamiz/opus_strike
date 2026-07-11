import { create } from 'zustand';
import {
  ALL_HERO_IDS,
  BLAZE_ABILITY_SKILLS,
  DEFAULT_PHANTOM_PRIMARY_SKILL,
  DEFAULT_PHANTOM_SECONDARY_SKILL,
  DEFAULT_BLAZE_PRIMARY_SKILL,
  DEFAULT_BLAZE_SECONDARY_SKILL,
  DEFAULT_BLAZE_ULTIMATE_SKILL,
  HERO_DEFINITIONS,
  hasBlazeAfterburner,
  isBlazePrimarySkill,
  isBlazeSecondarySkill,
  isBlazeUltimateSkill,
  isPhantomPrimarySkill,
  isPhantomSecondarySkill,
  type BlazePrimarySkill,
  type BlazeSecondarySkill,
  type BlazeUltimateSkill,
  type BlazeAbilityBindings,
  type HeroId,
  type InputState,
  type PhantomPrimarySkill,
  type PhantomSecondarySkill,
} from '@voxel-strike/shared';

export const LOADOUT_STORAGE_KEY = 'voxel-strike-loadout';

export type HeroAbilitySlot = 'ability1' | 'ability2';

export interface HeroAbilityBindings {
  ability1: string;
  ability2: string;
}

export type HeroAbilityBindingsMap = Partial<Record<HeroId, HeroAbilityBindings>>;

interface StoredLoadout {
  phantomPrimarySkill: PhantomPrimarySkill;
  phantomSecondarySkill: PhantomSecondarySkill;
  blazePrimarySkill: BlazePrimarySkill;
  blazeSecondarySkill: BlazeSecondarySkill;
  blazeUltimateSkill: BlazeUltimateSkill;
  heroAbilityBindings: HeroAbilityBindingsMap;
}

interface LoadoutState extends StoredLoadout {
  setPhantomPrimarySkill: (skill: PhantomPrimarySkill) => void;
  setPhantomSecondarySkill: (skill: PhantomSecondarySkill) => void;
  setBlazePrimarySkill: (skill: BlazePrimarySkill) => void;
  setBlazeSecondarySkill: (skill: BlazeSecondarySkill) => void;
  setBlazeUltimateSkill: (skill: BlazeUltimateSkill) => void;
  assignHeroAbility: (heroId: HeroId, slot: HeroAbilitySlot, abilityId: string) => void;
}

export function getDefaultHeroAbilityBindings(heroId: HeroId): HeroAbilityBindings {
  const hero = HERO_DEFINITIONS[heroId];
  return {
    ability1: hero.ability1.abilityId,
    ability2: hero.ability2.abilityId,
  };
}

function isValidHeroAbilityBindings(
  heroId: HeroId,
  value: unknown,
): value is HeroAbilityBindings {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<HeroAbilityBindings>;
  const defaults = getDefaultHeroAbilityBindings(heroId);
  const supportedAbilityIds = new Set(
    heroId === 'blaze'
      ? BLAZE_ABILITY_SKILLS
      : [defaults.ability1, defaults.ability2]
  );

  return (
    typeof candidate.ability1 === 'string' &&
    typeof candidate.ability2 === 'string' &&
    candidate.ability1 !== candidate.ability2 &&
    supportedAbilityIds.has(candidate.ability1) &&
    supportedAbilityIds.has(candidate.ability2)
  );
}

function sanitizeHeroAbilityBindings(value: unknown): HeroAbilityBindingsMap {
  if (!value || typeof value !== 'object') return {};

  const candidate = value as Partial<Record<HeroId, unknown>>;
  const sanitized: HeroAbilityBindingsMap = {};
  for (const heroId of ALL_HERO_IDS) {
    const bindings = candidate[heroId];
    if (!isValidHeroAbilityBindings(heroId, bindings)) continue;

    const defaults = getDefaultHeroAbilityBindings(heroId);
    if (bindings.ability1 === defaults.ability1 && bindings.ability2 === defaults.ability2) continue;
    sanitized[heroId] = { ...bindings };
  }
  return sanitized;
}

export function resolveHeroAbilityBindings(
  heroId: HeroId,
  bindingsByHero: HeroAbilityBindingsMap,
): HeroAbilityBindings {
  const bindings = bindingsByHero[heroId];
  return isValidHeroAbilityBindings(heroId, bindings)
    ? bindings
    : getDefaultHeroAbilityBindings(heroId);
}

export function resolveRuntimeHeroAbilityBindings(
  heroId: HeroId,
  bindingsByHero: HeroAbilityBindingsMap,
): HeroAbilityBindings {
  const bindings = resolveHeroAbilityBindings(heroId, bindingsByHero);
  if (heroId === 'blaze' && hasBlazeAfterburner(bindings as BlazeAbilityBindings)) {
    return bindings;
  }
  return getDefaultHeroAbilityBindings(heroId);
}

export function isHeroAbilityInputActive(
  input: Pick<InputState, 'ability1' | 'ability2'>,
  heroId: HeroId,
  bindingsByHero: HeroAbilityBindingsMap,
  abilityId: string,
): boolean {
  const bindings = resolveRuntimeHeroAbilityBindings(heroId, bindingsByHero);
  if (bindings.ability1 === abilityId) return input.ability1;
  if (bindings.ability2 === abilityId) return input.ability2;
  return false;
}

export function applyHeroAbilityBindings(
  input: InputState,
  heroId: HeroId,
  bindingsByHero: HeroAbilityBindingsMap,
): InputState {
  const defaults = getDefaultHeroAbilityBindings(heroId);
  const selectedBindings = resolveHeroAbilityBindings(heroId, bindingsByHero);
  if (heroId === 'blaze' && hasBlazeAfterburner(selectedBindings as BlazeAbilityBindings)) {
    return input;
  }
  const bindings = selectedBindings;
  if (bindings.ability1 === defaults.ability1 && bindings.ability2 === defaults.ability2) {
    return input;
  }

  const pressedAbilityIds = new Set<string>();
  if (input.ability1) pressedAbilityIds.add(bindings.ability1);
  if (input.ability2) pressedAbilityIds.add(bindings.ability2);

  return {
    ...input,
    ability1: pressedAbilityIds.has(defaults.ability1),
    ability2: pressedAbilityIds.has(defaults.ability2),
  };
}

export function loadStoredLoadout(): StoredLoadout {
  if (typeof window === 'undefined') {
    return {
      phantomPrimarySkill: DEFAULT_PHANTOM_PRIMARY_SKILL,
      phantomSecondarySkill: DEFAULT_PHANTOM_SECONDARY_SKILL,
      blazePrimarySkill: DEFAULT_BLAZE_PRIMARY_SKILL,
      blazeSecondarySkill: DEFAULT_BLAZE_SECONDARY_SKILL,
      blazeUltimateSkill: DEFAULT_BLAZE_ULTIMATE_SKILL,
      heroAbilityBindings: {},
    };
  }

  try {
    const raw = JSON.parse(window.localStorage.getItem(LOADOUT_STORAGE_KEY) ?? '{}') as {
      phantomPrimarySkill?: unknown;
      phantomSecondarySkill?: unknown;
      blazePrimarySkill?: unknown;
      blazeSecondarySkill?: unknown;
      blazeUltimateSkill?: unknown;
      heroAbilityBindings?: unknown;
    };
    return {
      phantomPrimarySkill: isPhantomPrimarySkill(raw.phantomPrimarySkill)
        ? raw.phantomPrimarySkill
        : DEFAULT_PHANTOM_PRIMARY_SKILL,
      phantomSecondarySkill: isPhantomSecondarySkill(raw.phantomSecondarySkill)
        ? raw.phantomSecondarySkill
        : DEFAULT_PHANTOM_SECONDARY_SKILL,
      blazePrimarySkill: isBlazePrimarySkill(raw.blazePrimarySkill)
        ? raw.blazePrimarySkill
        : DEFAULT_BLAZE_PRIMARY_SKILL,
      blazeSecondarySkill: isBlazeSecondarySkill(raw.blazeSecondarySkill)
        ? raw.blazeSecondarySkill
        : DEFAULT_BLAZE_SECONDARY_SKILL,
      blazeUltimateSkill: isBlazeUltimateSkill(raw.blazeUltimateSkill)
        ? raw.blazeUltimateSkill
        : DEFAULT_BLAZE_ULTIMATE_SKILL,
      heroAbilityBindings: sanitizeHeroAbilityBindings(raw.heroAbilityBindings),
    };
  } catch {
    return {
      phantomPrimarySkill: DEFAULT_PHANTOM_PRIMARY_SKILL,
      phantomSecondarySkill: DEFAULT_PHANTOM_SECONDARY_SKILL,
      blazePrimarySkill: DEFAULT_BLAZE_PRIMARY_SKILL,
      blazeSecondarySkill: DEFAULT_BLAZE_SECONDARY_SKILL,
      blazeUltimateSkill: DEFAULT_BLAZE_ULTIMATE_SKILL,
      heroAbilityBindings: {},
    };
  }
}

function persistLoadout(loadout: StoredLoadout): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LOADOUT_STORAGE_KEY, JSON.stringify(loadout));
}

const initialLoadout = loadStoredLoadout();

export const useLoadoutStore = create<LoadoutState>((set) => ({
  ...initialLoadout,
  setPhantomPrimarySkill: (phantomPrimarySkill) => {
    set((state) => {
      const stored = {
        phantomPrimarySkill,
        phantomSecondarySkill: state.phantomSecondarySkill,
        blazePrimarySkill: state.blazePrimarySkill,
        blazeSecondarySkill: state.blazeSecondarySkill,
        blazeUltimateSkill: state.blazeUltimateSkill,
        heroAbilityBindings: state.heroAbilityBindings,
      };
      persistLoadout(stored);
      return stored;
    });
  },
  setPhantomSecondarySkill: (phantomSecondarySkill) => {
    set((state) => {
      const stored = {
        phantomPrimarySkill: state.phantomPrimarySkill,
        phantomSecondarySkill,
        blazePrimarySkill: state.blazePrimarySkill,
        blazeSecondarySkill: state.blazeSecondarySkill,
        blazeUltimateSkill: state.blazeUltimateSkill,
        heroAbilityBindings: state.heroAbilityBindings,
      };
      persistLoadout(stored);
      return stored;
    });
  },
  setBlazePrimarySkill: (blazePrimarySkill) => {
    set((state) => {
      const stored = {
        phantomPrimarySkill: state.phantomPrimarySkill,
        phantomSecondarySkill: state.phantomSecondarySkill,
        blazePrimarySkill,
        blazeSecondarySkill: state.blazeSecondarySkill,
        blazeUltimateSkill: state.blazeUltimateSkill,
        heroAbilityBindings: state.heroAbilityBindings,
      };
      persistLoadout(stored);
      return stored;
    });
  },
  setBlazeSecondarySkill: (blazeSecondarySkill) => {
    set((state) => {
      const stored = {
        phantomPrimarySkill: state.phantomPrimarySkill,
        phantomSecondarySkill: state.phantomSecondarySkill,
        blazePrimarySkill: state.blazePrimarySkill,
        blazeSecondarySkill,
        blazeUltimateSkill: state.blazeUltimateSkill,
        heroAbilityBindings: state.heroAbilityBindings,
      };
      persistLoadout(stored);
      return stored;
    });
  },
  setBlazeUltimateSkill: (blazeUltimateSkill) => {
    set((state) => {
      const stored = {
        phantomPrimarySkill: state.phantomPrimarySkill,
        phantomSecondarySkill: state.phantomSecondarySkill,
        blazePrimarySkill: state.blazePrimarySkill,
        blazeSecondarySkill: state.blazeSecondarySkill,
        blazeUltimateSkill,
        heroAbilityBindings: state.heroAbilityBindings,
      };
      persistLoadout(stored);
      return stored;
    });
  },
  assignHeroAbility: (heroId, slot, abilityId) => {
    set((state) => {
      const current = resolveHeroAbilityBindings(heroId, state.heroAbilityBindings);
      const defaults = getDefaultHeroAbilityBindings(heroId);
      const supportedAbilityIds = new Set(
        heroId === 'blaze'
          ? BLAZE_ABILITY_SKILLS
          : [defaults.ability1, defaults.ability2]
      );
      if (!supportedAbilityIds.has(abilityId)) return state;

      const otherSlot: HeroAbilitySlot = slot === 'ability1' ? 'ability2' : 'ability1';
      const nextBindings: HeroAbilityBindings = { ...current };
      if (nextBindings[otherSlot] === abilityId) {
        nextBindings[otherSlot] = nextBindings[slot];
      }
      nextBindings[slot] = abilityId;

      const nextByHero = { ...state.heroAbilityBindings };
      if (
        nextBindings.ability1 === defaults.ability1 &&
        nextBindings.ability2 === defaults.ability2
      ) {
        delete nextByHero[heroId];
      } else {
        nextByHero[heroId] = nextBindings;
      }

      const stored = {
        phantomPrimarySkill: state.phantomPrimarySkill,
        phantomSecondarySkill: state.phantomSecondarySkill,
        blazePrimarySkill: state.blazePrimarySkill,
        blazeSecondarySkill: state.blazeSecondarySkill,
        blazeUltimateSkill: state.blazeUltimateSkill,
        heroAbilityBindings: nextByHero,
      };
      persistLoadout(stored);
      return stored;
    });
  },
}));
