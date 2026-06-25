import {
  getDefaultHeroSkinId,
  isHeroSkinId,
  resolveHeroSkinDefinition,
  type HeroId,
  type HeroSkinDefinition,
  type HeroSkinId,
  type HeroModelDocumentV1,
} from '@voxel-strike/shared';
import { HERO_SKIN_BODY_MANIFESTS } from './heroBodyManifests';
import { getHeroSkinModelDocument } from './heroModelDocuments';
import type { HeroBodyManifest } from './heroBodyTypes';

export interface ResolvedHeroSkinModel {
  heroId: HeroId;
  skinId: HeroSkinId;
  skin: HeroSkinDefinition;
  bodyManifest: HeroBodyManifest;
  document: HeroModelDocumentV1;
  fallback: boolean;
}

export interface ResolveHeroSkinModelOptions {
  ownedSkinIds?: ReadonlySet<HeroSkinId>;
}

const emittedFallbackWarnings = new Set<string>();

function shouldEmitDevelopmentWarning(): boolean {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
    return false;
  }
  return true;
}

function warnOnce(message: string): void {
  if (!shouldEmitDevelopmentWarning() || emittedFallbackWarnings.has(message)) return;
  emittedFallbackWarnings.add(message);
  console.warn(message);
}

export function resolveHeroSkinModel(
  heroId: HeroId,
  requestedSkinId?: HeroSkinId | string | null,
  options: ResolveHeroSkinModelOptions = {}
): ResolvedHeroSkinModel {
  const resolved = resolveHeroSkinDefinition(heroId, requestedSkinId, {
    ownedSkinIds: options.ownedSkinIds,
    warn: warnOnce,
  });
  let skin = resolved.skin;
  let skinId = skin.id;
  let bodyManifest = HERO_SKIN_BODY_MANIFESTS[skinId];
  let document = getHeroSkinModelDocument(skinId);

  if (!bodyManifest || !document) {
    const defaultSkinId = getDefaultHeroSkinId(heroId);
    warnOnce(`[hero-skins] Missing model document for ${skinId}; falling back to ${defaultSkinId}`);
    skinId = defaultSkinId;
    skin = resolveHeroSkinDefinition(heroId, defaultSkinId).skin;
    bodyManifest = HERO_SKIN_BODY_MANIFESTS[skinId];
    document = getHeroSkinModelDocument(skinId);
  }

  if (!bodyManifest || !document) {
    throw new Error(`[hero-skins] Missing fallback model document for ${heroId}`);
  }

  return {
    heroId,
    skinId,
    skin,
    bodyManifest,
    document,
    fallback: resolved.fallback || skinId !== resolved.skin.id,
  };
}

export function getRenderableHeroSkinId(heroId: HeroId, skinId?: HeroSkinId | string | null): HeroSkinId {
  return resolveHeroSkinModel(heroId, skinId).skinId;
}

export function isRenderableHeroSkinId(value: unknown): value is HeroSkinId {
  return isHeroSkinId(value) && Boolean(HERO_SKIN_BODY_MANIFESTS[value] && getHeroSkinModelDocument(value));
}
