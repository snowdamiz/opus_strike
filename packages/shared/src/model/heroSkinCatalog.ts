import { ALL_HERO_IDS } from '../constants/heroes.js';
import type { HeroId } from '../types/hero.js';
import type {
  HeroSkinDefinition,
  HeroSkinId,
  HeroSkinPrice,
} from '../types/skins.js';

export interface HeroSkinCatalogValidationResult {
  ok: boolean;
  errors: string[];
}

export interface ResolveHeroSkinOptions {
  ownedSkinIds?: ReadonlySet<HeroSkinId>;
  warn?: (message: string) => void;
}

export interface ResolvedHeroSkin {
  requestedSkinId: HeroSkinId | null;
  skin: HeroSkinDefinition;
  fallback: boolean;
  fallbackReason: 'missing' | 'unknown_skin' | 'hero_mismatch' | 'locked' | null;
}

const HERO_SKIN_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const TOKEN_LAUNCH_PENDING_PRICE = {
  tokenSymbol: 'TOKEN',
  tokenMintAddress: null,
  amountBaseUnits: null,
  adminEditable: true,
  disabledReason: 'Game SPL token has not launched yet',
} as const satisfies HeroSkinPrice;

export const DEFAULT_HERO_SKIN_IDS: Record<HeroId, HeroSkinId> = {
  phantom: 'phantom.default',
  hookshot: 'hookshot.default',
  blaze: 'blaze.default',
  chronos: 'chronos.default',
};

export const HERO_SKIN_CATALOG = [
  {
    id: 'phantom.default',
    heroId: 'phantom',
    displayName: 'Phantom',
    subtitle: 'The original void-bent Phantom frame.',
    rarity: 'common',
    availability: 'free',
    releaseState: 'live',
    modelDocumentId: 'phantom.default',
  },
  {
    id: 'hookshot.default',
    heroId: 'hookshot',
    displayName: 'Hookshot',
    subtitle: 'The standard anchor-line Hookshot rig.',
    rarity: 'common',
    availability: 'free',
    releaseState: 'live',
    modelDocumentId: 'hookshot.default',
  },
  {
    id: 'blaze.default',
    heroId: 'blaze',
    displayName: 'Blaze',
    subtitle: 'The stock firebreak assault chassis.',
    rarity: 'common',
    availability: 'free',
    releaseState: 'live',
    modelDocumentId: 'blaze.default',
  },
  {
    id: 'chronos.default',
    heroId: 'chronos',
    displayName: 'Chronos',
    subtitle: 'The baseline temporal support frame.',
    rarity: 'common',
    availability: 'free',
    releaseState: 'live',
    modelDocumentId: 'chronos.default',
  },
  {
    id: 'phantom.void-monarch',
    heroId: 'phantom',
    displayName: 'Void Monarch',
    subtitle: 'A royal void-forged Phantom frame with crownlit armor and colder first-person gauntlets.',
    rarity: 'epic',
    availability: 'paid',
    releaseState: 'ready_when_token_launches',
    modelDocumentId: 'phantom.void-monarch',
    price: TOKEN_LAUNCH_PENDING_PRICE,
  },
  {
    id: 'hookshot.tidebreaker',
    heroId: 'hookshot',
    displayName: 'Tidebreaker',
    subtitle: 'A storm-forged Hookshot rig with brass anchor plating and luminous deep-current hooks.',
    rarity: 'epic',
    availability: 'paid',
    releaseState: 'ready_when_token_launches',
    modelDocumentId: 'hookshot.tidebreaker',
    price: TOKEN_LAUNCH_PENDING_PRICE,
  },
  {
    id: 'blaze.solar-forge',
    heroId: 'blaze',
    displayName: 'Solar Forge',
    subtitle: 'A white-hot Blaze chassis with furnace-gold trim, ember vents, and a brighter staff crystal.',
    rarity: 'epic',
    availability: 'paid',
    releaseState: 'ready_when_token_launches',
    modelDocumentId: 'blaze.solar-forge',
    price: TOKEN_LAUNCH_PENDING_PRICE,
  },
  {
    id: 'chronos.epoch-regent',
    heroId: 'chronos',
    displayName: 'Epoch Regent',
    subtitle: 'A gilded Chronos frame with royal timeglass plates and cool paradox-blue conduits.',
    rarity: 'epic',
    availability: 'paid',
    releaseState: 'ready_when_token_launches',
    modelDocumentId: 'chronos.epoch-regent',
    price: TOKEN_LAUNCH_PENDING_PRICE,
  },
] as const satisfies readonly HeroSkinDefinition[];

export const HERO_SKIN_CATALOG_BY_ID: Readonly<Record<HeroSkinId, HeroSkinDefinition>> = Object.freeze(
  Object.fromEntries(HERO_SKIN_CATALOG.map((skin) => [skin.id, skin]))
) as Readonly<Record<HeroSkinId, HeroSkinDefinition>>;

export const HERO_SKIN_IDS = HERO_SKIN_CATALOG.map((skin) => skin.id) as HeroSkinId[];

export function isHeroSkinId(value: unknown): value is HeroSkinId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(HERO_SKIN_CATALOG_BY_ID, value);
}

export function getDefaultHeroSkinId(heroId: HeroId): HeroSkinId {
  return DEFAULT_HERO_SKIN_IDS[heroId];
}

export function getHeroSkinDefinition(skinId: HeroSkinId): HeroSkinDefinition {
  return HERO_SKIN_CATALOG_BY_ID[skinId];
}

export function getHeroSkinsForHero(heroId: HeroId): HeroSkinDefinition[] {
  return HERO_SKIN_CATALOG.filter((skin) => skin.heroId === heroId);
}

export function isDefaultHeroSkin(skin: Pick<HeroSkinDefinition, 'id' | 'heroId' | 'availability'>): boolean {
  return skin.availability === 'free' && DEFAULT_HERO_SKIN_IDS[skin.heroId] === skin.id;
}

export function validateHeroSkinCatalog(
  catalog: readonly HeroSkinDefinition[] = HERO_SKIN_CATALOG
): HeroSkinCatalogValidationResult {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const defaultCounts = new Map<HeroId, number>();

  for (const heroId of ALL_HERO_IDS) {
    defaultCounts.set(heroId, 0);
  }

  for (const skin of catalog) {
    if (!HERO_SKIN_ID_PATTERN.test(skin.id)) {
      errors.push(`skin id "${skin.id}" must be stable lowercase dot-separated tokens`);
    }
    if (seenIds.has(skin.id)) {
      errors.push(`skin id "${skin.id}" must be unique`);
    }
    seenIds.add(skin.id);

    if (!ALL_HERO_IDS.includes(skin.heroId)) {
      errors.push(`${skin.id} references unknown hero ${skin.heroId}`);
    }
    if (!skin.modelDocumentId || skin.modelDocumentId !== skin.id) {
      errors.push(`${skin.id} modelDocumentId must match its skin id`);
    }
    if (!skin.displayName.trim()) {
      errors.push(`${skin.id} needs a display name`);
    }

    if (skin.id === DEFAULT_HERO_SKIN_IDS[skin.heroId]) {
      defaultCounts.set(skin.heroId, (defaultCounts.get(skin.heroId) ?? 0) + 1);
      if (skin.availability !== 'free') {
        errors.push(`${skin.id} is the default skin and must be free`);
      }
    } else if (skin.availability === 'free') {
      errors.push(`${skin.id} is free but is not the default skin for ${skin.heroId}`);
    }

    if (skin.availability === 'paid') {
      const price = skin.price;
      const hasPrice = Boolean(
        price &&
        typeof price.tokenSymbol === 'string' &&
        price.tokenSymbol.trim() &&
        typeof price.tokenMintAddress === 'string' &&
        price.tokenMintAddress.trim() &&
        typeof price.amountBaseUnits === 'string' &&
        /^[0-9]+$/.test(price.amountBaseUnits) &&
        BigInt(price.amountBaseUnits) > 0n
      );
      const disabledReason = price?.disabledReason?.trim();
      if (!hasPrice && !disabledReason) {
        errors.push(`${skin.id} needs a complete positive token price or a disabled reason`);
      }
    } else if (skin.price) {
      errors.push(`${skin.id} is free and must not define a price`);
    }
  }

  for (const [heroId, count] of defaultCounts) {
    if (count !== 1) {
      errors.push(`${heroId} must have exactly one default skin`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function assertHeroSkinCatalog(
  catalog: readonly HeroSkinDefinition[] = HERO_SKIN_CATALOG
): void {
  const validation = validateHeroSkinCatalog(catalog);
  if (!validation.ok) {
    throw new Error(`Invalid hero skin catalog:\n${validation.errors.join('\n')}`);
  }
}

function emitSkinFallbackWarning(
  heroId: HeroId,
  requestedSkinId: HeroSkinId | null,
  reason: NonNullable<ResolvedHeroSkin['fallbackReason']>,
  warn?: (message: string) => void
): void {
  warn?.(`[hero-skins] Falling back to ${heroId} default skin for ${requestedSkinId ?? 'missing'} (${reason})`);
}

export function resolveHeroSkinDefinition(
  heroId: HeroId,
  requestedSkinId?: HeroSkinId | string | null,
  options: ResolveHeroSkinOptions = {}
): ResolvedHeroSkin {
  const requested = isHeroSkinId(requestedSkinId) ? requestedSkinId : null;
  const fallback = HERO_SKIN_CATALOG_BY_ID[DEFAULT_HERO_SKIN_IDS[heroId]];

  if (!requestedSkinId) {
    return {
      requestedSkinId: null,
      skin: fallback,
      fallback: false,
      fallbackReason: null,
    };
  }

  if (!requested) {
    emitSkinFallbackWarning(heroId, null, 'unknown_skin', options.warn);
    return {
      requestedSkinId: null,
      skin: fallback,
      fallback: true,
      fallbackReason: 'unknown_skin',
    };
  }

  const skin = HERO_SKIN_CATALOG_BY_ID[requested];
  if (!skin) {
    emitSkinFallbackWarning(heroId, requested, 'unknown_skin', options.warn);
    return {
      requestedSkinId: requested,
      skin: fallback,
      fallback: true,
      fallbackReason: 'unknown_skin',
    };
  }
  if (skin.heroId !== heroId) {
    emitSkinFallbackWarning(heroId, requested, 'hero_mismatch', options.warn);
    return {
      requestedSkinId: requested,
      skin: fallback,
      fallback: true,
      fallbackReason: 'hero_mismatch',
    };
  }

  const ownedSkinIds = options.ownedSkinIds;
  if (
    skin.availability === 'paid' &&
    ownedSkinIds &&
    !ownedSkinIds.has(skin.id)
  ) {
    emitSkinFallbackWarning(heroId, requested, 'locked', options.warn);
    return {
      requestedSkinId: requested,
      skin: fallback,
      fallback: true,
      fallbackReason: 'locked',
    };
  }

  return {
    requestedSkinId: requested,
    skin,
    fallback: false,
    fallbackReason: null,
  };
}

export function getPurchaseDisabledReasonForSkin(
  skin: Pick<HeroSkinDefinition, 'availability' | 'price' | 'releaseState'>,
  saleEnabled: boolean,
  shopEnabled: boolean
): string | null {
  if (skin.availability !== 'paid') return null;
  if (skin.releaseState === 'disabled') return 'Skin is disabled';
  if (!shopEnabled) return 'Skin shop is disabled';
  if (!saleEnabled) return skin.price?.disabledReason ?? 'Skin is not available for purchase';
  if (!skin.price?.tokenMintAddress || !skin.price.amountBaseUnits) {
    return skin.price?.disabledReason ?? 'Token launch configuration is incomplete';
  }
  return null;
}
