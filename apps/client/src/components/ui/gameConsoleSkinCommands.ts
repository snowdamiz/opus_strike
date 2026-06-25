import {
  HERO_SKIN_CATALOG,
  type HeroId,
  type HeroSkinDefinition,
} from '@voxel-strike/shared';

export type ConsoleSkinResolution =
  | { status: 'empty'; matches: [] }
  | { status: 'not_found'; matches: [] }
  | { status: 'matched'; skin: HeroSkinDefinition }
  | { status: 'ambiguous'; matches: HeroSkinDefinition[] };

const SKIN_QUERY_SEPARATOR = /[^a-z0-9]+/g;

export function normalizeConsoleSkinQuery(value: string): string {
  return value.toLowerCase().replace(SKIN_QUERY_SEPARATOR, '');
}

function getSkinAliases(skin: HeroSkinDefinition): string[] {
  const shortId = skin.id.split('.').at(-1);
  return [
    skin.id,
    skin.displayName,
    shortId ?? skin.id,
  ];
}

function skinMatchesQuery(skin: HeroSkinDefinition, normalizedQuery: string, exact: boolean): boolean {
  return getSkinAliases(skin).some((alias) => {
    const normalizedAlias = normalizeConsoleSkinQuery(alias);
    return exact
      ? normalizedAlias === normalizedQuery
      : normalizedAlias.includes(normalizedQuery);
  });
}

function preferHeroSkinMatches(
  matches: HeroSkinDefinition[],
  heroId?: HeroId | null
): HeroSkinDefinition[] {
  if (!heroId || matches.length <= 1) return matches;
  const preferred = matches.filter((skin) => skin.heroId === heroId);
  return preferred.length > 0 ? preferred : matches;
}

function toResolution(matches: HeroSkinDefinition[]): ConsoleSkinResolution {
  if (matches.length === 0) return { status: 'not_found', matches: [] };
  if (matches.length === 1) return { status: 'matched', skin: matches[0] };
  return { status: 'ambiguous', matches };
}

export function resolveConsoleSkinQuery(
  query: string,
  options: { heroId?: HeroId | null } = {}
): ConsoleSkinResolution {
  const normalizedQuery = normalizeConsoleSkinQuery(query);
  if (!normalizedQuery) return { status: 'empty', matches: [] };

  const exactMatches = preferHeroSkinMatches(
    HERO_SKIN_CATALOG.filter((skin) => skinMatchesQuery(skin, normalizedQuery, true)),
    options.heroId
  );
  if (exactMatches.length > 0) return toResolution(exactMatches);

  const partialMatches = preferHeroSkinMatches(
    HERO_SKIN_CATALOG.filter((skin) => skinMatchesQuery(skin, normalizedQuery, false)),
    options.heroId
  );
  return toResolution(partialMatches);
}

function formatReleaseState(releaseState: HeroSkinDefinition['releaseState']): string | null {
  return releaseState === 'live' ? null : releaseState.replace(/_/g, ' ');
}

export function formatConsoleSkinLine(skin: HeroSkinDefinition): string {
  const release = formatReleaseState(skin.releaseState);
  const metadata = [
    skin.rarity,
    skin.availability,
    release,
  ].filter(Boolean).join(', ');

  return `${skin.displayName} (${skin.id}) - ${metadata}`;
}
