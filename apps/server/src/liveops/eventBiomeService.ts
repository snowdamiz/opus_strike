import { ALL_VOXEL_MAP_THEMES, INDEPENDENCE_VOXEL_MAP_THEME_ID, type VoxelMapTheme } from '@voxel-strike/shared';
import prisma from '../db';
import { envFlag } from '../config/security';

export const EVENT_BIOME_SETTINGS_ID = 'default';
const EVENT_BIOME_CACHE_TTL_MS = 15_000;
const DEFAULT_EVENT_BIOME_THEME_ID = INDEPENDENCE_VOXEL_MAP_THEME_ID;

const VALID_THEME_IDS = new Set<string>(ALL_VOXEL_MAP_THEMES.map((theme) => theme.id));

export interface EventBiomeSettingsView {
  enabled: boolean;
  themeId: string;
  updatedByUserId: string | null;
  updatedAt: string;
}

let cachedEventBiome: (EventBiomeSettingsView & { expiresAt: number }) | null = null;

function clearEventBiomeCache(): void {
  cachedEventBiome = null;
}

function toView(row: {
  enabled: boolean;
  themeId: string;
  updatedByUserId: string | null;
  updatedAt: Date;
}): EventBiomeSettingsView {
  return {
    enabled: row.enabled,
    themeId: row.themeId,
    updatedByUserId: row.updatedByUserId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getOrCreateRow() {
  const existing = await prisma.eventBiomeSettings.findUnique({
    where: { id: EVENT_BIOME_SETTINGS_ID },
  });
  if (existing) return existing;

  return prisma.eventBiomeSettings.create({
    data: {
      id: EVENT_BIOME_SETTINGS_ID,
      // Allow an env default so the biome can be pre-armed for an event window.
      enabled: envFlag('EVENT_BIOME_ENABLED', false),
      themeId: DEFAULT_EVENT_BIOME_THEME_ID,
    },
  });
}

export async function getEventBiomeSettings(): Promise<EventBiomeSettingsView> {
  return toView(await getOrCreateRow());
}

/**
 * Resilient read for the admin overview: never throws, so a not-yet-migrated table can't
 * take down the whole `/overview` response. Returns an "off" default on any failure.
 */
export async function getEventBiomeAdminOverview(): Promise<EventBiomeSettingsView> {
  try {
    return await getEventBiomeSettings();
  } catch {
    return {
      enabled: false,
      themeId: DEFAULT_EVENT_BIOME_THEME_ID,
      updatedByUserId: null,
      updatedAt: new Date(0).toISOString(),
    };
  }
}

export async function getCachedEventBiomeSettings(): Promise<EventBiomeSettingsView> {
  const now = Date.now();
  if (cachedEventBiome && cachedEventBiome.expiresAt > now) {
    const { expiresAt, ...view } = cachedEventBiome;
    void expiresAt;
    return view;
  }

  const view = await getEventBiomeSettings();
  cachedEventBiome = { ...view, expiresAt: now + EVENT_BIOME_CACHE_TTL_MS };
  return view;
}

export async function setEventBiomeSettings(input: {
  enabled: boolean;
  updatedByUserId: string | null;
}): Promise<EventBiomeSettingsView> {
  const enabled = Boolean(input.enabled);
  const row = await prisma.eventBiomeSettings.upsert({
    where: { id: EVENT_BIOME_SETTINGS_ID },
    create: {
      id: EVENT_BIOME_SETTINGS_ID,
      enabled,
      themeId: DEFAULT_EVENT_BIOME_THEME_ID,
      updatedByUserId: input.updatedByUserId,
    },
    update: {
      enabled,
      updatedByUserId: input.updatedByUserId,
    },
  });

  clearEventBiomeCache();
  return toView(row);
}

/**
 * The theme id to force onto one map-vote option, or null when the event is off or the
 * stored theme id is not a real biome. Used by the lobby when building the CTF/TDM vote.
 */
export async function getEnabledEventBiomeThemeId(): Promise<VoxelMapTheme['id'] | null> {
  try {
    const settings = await getCachedEventBiomeSettings();
    if (!settings.enabled) return null;
    if (!VALID_THEME_IDS.has(settings.themeId)) return null;
    return settings.themeId as VoxelMapTheme['id'];
  } catch {
    // Never let a settings lookup failure block matchmaking.
    return null;
  }
}
