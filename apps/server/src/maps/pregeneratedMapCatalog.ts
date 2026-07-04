import crypto from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  CONSTRUCTED_MAP_MANIFEST_VERSION,
  STANDARD_VOXEL_MAP_THEMES,
  VOXEL_MAP_SIZE_IDS,
  createRandomSeed,
  generateProceduralVoxelMap,
  getPregeneratedMapDiagnostics,
  getPregeneratedMapPreviewTags,
  getPregeneratedMapStats,
  getVoxelMapThemeById,
  type GameplayMode,
  type MapGameMode,
  type MapProfileId,
  type MapTopologyId,
  type PregeneratedMapCatalogSummary,
  type PregeneratedMapArtifactEnvelope,
  type PregeneratedMapId,
  type PregeneratedMapSelectionSource,
  type PregeneratedMapStatus,
  type PregeneratedMapStats,
  type PregeneratedMapVisibility,
  type VoxelMapManifest,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
import prisma from '../db';
import { loggers } from '../utils/logger';
import { mapSeedToDatabaseValue, mapSeedFromDatabaseValue } from '../utils/mapSeedPersistence';
import {
  createPregeneratedMapArtifactEnvelope,
  decodePregeneratedMapManifest,
  encodePregeneratedMapArtifactEnvelope,
} from './pregeneratedMapArtifact';
import {
  pregeneratedMapArtifactStorage,
  type PregeneratedMapArtifactStorage,
} from './pregeneratedMapStorage';

export interface PregeneratedMapLaunchSelection {
  id: string;
  seed: number;
  mapSize: VoxelMapSizeId;
  mapProfileId: MapProfileId;
  mapThemeId: VoxelMapTheme['id'];
  pregeneratedMapId: PregeneratedMapId;
  mapArtifactId: string;
  topologyId: MapTopologyId;
  displayName: string;
}

export interface ReservedPregeneratedMapLaunch {
  map: PregeneratedMapCatalogSummary;
  selectionId: string;
}

export interface GenerateMapForLaunchInput {
  seed: number;
  themeId: VoxelMapTheme['id'];
  profileId: MapProfileId;
  mapSize: VoxelMapSizeId;
  visibility?: PregeneratedMapVisibility;
  maxAttempts?: number;
  lobbyId?: string | null;
  roomId?: string | null;
  matchId?: string | null;
  selectionSource: PregeneratedMapSelectionSource;
  selectedByPlayerId?: string | null;
}

export interface MapPoolTopUpOptions {
  profileId?: MapProfileId;
  mapSize?: VoxelMapSizeId;
  themeId?: VoxelMapTheme['id'];
  visibility?: PregeneratedMapVisibility;
  targetReadyCount?: number;
  maxGenerated?: number;
}

export interface MapPoolGeneratedMapReport {
  mapId: PregeneratedMapId;
  artifactId: string;
  displayName: string;
  seed: number;
  profileId: MapProfileId;
  mapSize: VoxelMapSizeId;
  themeId: VoxelMapTheme['id'];
  topologyId: MapTopologyId;
  visibility: PregeneratedMapVisibility;
  status: PregeneratedMapStatus;
  diagnosticsScore: number;
  diagnosticsWarningCount: number;
}

export interface MapPoolTopUpResult {
  generated: number;
  failed: number;
  skipped: number;
  generatedMaps: MapPoolGeneratedMapReport[];
  slices: Array<{
    profileId: MapProfileId;
    mapSize: VoxelMapSizeId;
    themeId: VoxelMapTheme['id'];
    targetReadyCount: number;
    readyCount: number;
    readyCountAfter: number;
    remainingDeficit: number;
    generated: number;
    failed: number;
  }>;
}

export interface MapPoolAdminOverview {
  requiredReadyTotal: number;
  readyTotal: number;
  reservedTotal: number;
  activeTotal: number;
  failedTotal: number;
  retiredTotal: number;
  artifactBytesTotal: number;
  oldestReadyCreatedAt: string | null;
  recentSelectionCount: number;
  lowSlices: Array<{
    profileId: MapProfileId;
    mapSize: VoxelMapSizeId;
    themeId: VoxelMapTheme['id'];
    readyCount: number;
    requiredReadyCount: number;
  }>;
  failures: Array<{
    id: string;
    seed: number;
    profileId: string;
    mapSize: string;
    themeId: string;
    diagnosticsWarnings: string[];
    updatedAt: string;
  }>;
}

interface ListSelectableMapsInput {
  gameplayMode?: MapGameMode;
  profileId?: MapProfileId;
  mapSize?: VoxelMapSizeId;
  themeId?: VoxelMapTheme['id'] | null;
  topologyId?: MapTopologyId | null;
  visibility?: PregeneratedMapVisibility | PregeneratedMapVisibility[];
  limit?: number;
}

interface ReserveMapForLaunchInput {
  mapId: PregeneratedMapId;
  lobbyId?: string | null;
  roomId?: string | null;
  matchId?: string | null;
  selectionSource: PregeneratedMapSelectionSource;
  selectedByPlayerId?: string | null;
}

interface RecordMapLaunchResultInput {
  mapId?: PregeneratedMapId | null;
  selectionId?: string | null;
  roomId?: string | null;
  matchId?: string | null;
  ok: boolean;
  error?: string | null;
}

interface CreateMapVoteOptionsFromPoolInput {
  gameplayMode: GameplayMode;
  profileId: MapProfileId;
  source: number;
  visibility?: PregeneratedMapVisibility | PregeneratedMapVisibility[];
  eventThemeId?: VoxelMapTheme['id'] | null;
}

interface SelectBattleRoyalMapInput {
  participantCount: number;
  preferredMapSize: VoxelMapSizeId;
  source: number;
  visibility?: PregeneratedMapVisibility | PregeneratedMapVisibility[];
  eventThemeId?: VoxelMapTheme['id'] | null;
}

export interface LoadedPregeneratedMapManifest {
  summary: PregeneratedMapCatalogSummary;
  manifest: VoxelMapManifest;
}

export interface MapPoolConsoleStatusPayload {
  [key: string]: unknown;
}

export interface PoolSliceIdentity {
  profileId: MapProfileId;
  mapSize: VoxelMapSizeId;
  themeId: VoxelMapTheme['id'];
}

export interface MapPoolRequiredSlice extends PoolSliceIdentity {
  requiredReadyCount: number;
}

type PregeneratedMapRow = Prisma.PregeneratedMapGetPayload<Record<string, never>>;

const DEFAULT_ARENA_READY_COUNT_PER_SLICE = 1;
const DEFAULT_BATTLE_ROYAL_READY_COUNT_PER_SLICE = 1;
const RESERVATION_TTL_MS = 90_000;
const RECENT_SELECTION_WINDOW_MS = 60 * 60 * 1000;
const MAP_NAME_SUFFIXES = [
  'Crucible',
  'Relay',
  'Bastion',
  'Run',
  'Vault',
  'Array',
  'Ridge',
  'Gate',
];

const PLAYABLE_PROFILE_IDS: readonly MapProfileId[] = [
  'ctf_arena',
  'tdm_arena',
  'battle_royal_large',
];

function mapPoolConsoleStatusEnabled(): boolean {
  const value = process.env.PREGENERATED_MAP_POOL_CONSOLE_STATUS?.trim().toLowerCase();
  return value !== '0' && value !== 'false' && value !== 'off';
}

function mapPoolVerboseConsoleStatusEnabled(): boolean {
  const value = process.env.PREGENERATED_MAP_POOL_VERBOSE_STATUS?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function formatMapPoolConsoleStatus(
  event: string,
  payload: MapPoolConsoleStatusPayload = {}
): string {
  return `[map-pool] ${JSON.stringify({ ...payload, event })}`;
}

export function writeMapPoolConsoleStatus(
  event: string,
  payload: MapPoolConsoleStatusPayload = {}
): void {
  if (!mapPoolConsoleStatusEnabled()) return;
  console.info(formatMapPoolConsoleStatus(event, payload));
}

function writeVerboseMapPoolConsoleStatus(
  event: string,
  payload: MapPoolConsoleStatusPayload = {}
): void {
  if (!mapPoolVerboseConsoleStatusEnabled()) return;
  writeMapPoolConsoleStatus(event, payload);
}

function hashText(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function shortHash(value: string): string {
  return hashText(value).slice(0, 20);
}

function profileToGameplayMode(profileId: MapProfileId): MapGameMode {
  return profileId === 'battle_royal_large' ? 'battle_royal' : 'ctf';
}

function readReadyCountEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw == null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 10 ? parsed : fallback;
}

function requiredCountForProfile(profileId: MapProfileId): number {
  if (profileId === 'battle_royal_large') {
    return readReadyCountEnv(
      'PREGENERATED_MAP_POOL_BATTLE_ROYAL_READY_PER_SLICE',
      DEFAULT_BATTLE_ROYAL_READY_COUNT_PER_SLICE
    );
  }

  return readReadyCountEnv(
    'PREGENERATED_MAP_POOL_ARENA_READY_PER_SLICE',
    DEFAULT_ARENA_READY_COUNT_PER_SLICE
  );
}

function createDisplayName(manifest: VoxelMapManifest, salt: number): string {
  const suffix = MAP_NAME_SUFFIXES[(manifest.seed + salt) % MAP_NAME_SUFFIXES.length] ?? 'Arena';
  return `${manifest.theme.name} ${suffix}`;
}

function createMapIdentityKey(input: {
  seed: number;
  themeId: string;
  profileId: string;
  mapSize: string;
  topologyId: string;
  generatorVersion: number;
  visibility: string;
}): string {
  return [
    input.seed >>> 0,
    input.themeId,
    input.profileId,
    input.mapSize,
    input.topologyId,
    input.generatorVersion,
    input.visibility,
  ].join(':');
}

function createMapId(identityKey: string): string {
  return `pgmap_${shortHash(identityKey)}`;
}

function createPoolSliceKey(input: PoolSliceIdentity): string {
  return `${input.profileId}:${input.mapSize}:${input.themeId}`;
}

function createArtifactId(identityKey: string): string {
  return `pgartifact_${shortHash(`artifact:${identityKey}`)}`;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toVisibilityArray(visibility?: PregeneratedMapVisibility | PregeneratedMapVisibility[]): PregeneratedMapVisibility[] {
  if (Array.isArray(visibility)) return visibility;
  return [visibility ?? 'public'];
}

function normalizeStatus(status: string): PregeneratedMapStatus {
  if (
    status === 'generating' ||
    status === 'ready' ||
    status === 'reserved' ||
    status === 'active' ||
    status === 'retired' ||
    status === 'failed'
  ) {
    return status;
  }
  return 'failed';
}

function normalizeVisibility(visibility: string): PregeneratedMapVisibility {
  if (visibility === 'matchmaking-only' || visibility === 'admin-only' || visibility === 'public') {
    return visibility;
  }
  return 'admin-only';
}

function normalizeMapSize(mapSize: string): VoxelMapSizeId {
  return mapSize === 'small' || mapSize === 'large' ? mapSize : 'medium';
}

function normalizeMapProfileId(profileId: string): MapProfileId {
  return profileId === 'tdm_arena' || profileId === 'battle_royal_large' || profileId === 'dev_testing'
    ? profileId
    : 'ctf_arena';
}

function normalizeThemeId(themeId: string): VoxelMapTheme['id'] {
  return getVoxelMapThemeById(themeId as VoxelMapTheme['id']).id;
}

function normalizeTopologyId(topologyId: string): MapTopologyId {
  const known = new Set<MapTopologyId>(['lane_triad', 'diamond', 'hourglass', 'ring', 'split_level']);
  return known.has(topologyId as MapTopologyId) ? topologyId as MapTopologyId : 'lane_triad';
}

function parseStats(stats: unknown): PregeneratedMapStats {
  const record = stats && typeof stats === 'object' ? stats as Partial<PregeneratedMapStats> : {};
  return {
    solidBlockCount: Number(record.solidBlockCount ?? 0),
    renderableChunkCount: Number(record.renderableChunkCount ?? 0),
    colliderCount: Number(record.colliderCount ?? 0),
    estimatedTriangles: Number(record.estimatedTriangles ?? 0),
  };
}

function summarizeMap(row: PregeneratedMapRow): PregeneratedMapCatalogSummary {
  return {
    id: row.id,
    artifactId: row.artifactId,
    seed: mapSeedFromDatabaseValue(row.seed),
    themeId: normalizeThemeId(row.themeId),
    profileId: normalizeMapProfileId(row.profileId),
    gameplayMode: profileToGameplayMode(normalizeMapProfileId(row.profileId)),
    familyId: row.familyId as PregeneratedMapCatalogSummary['familyId'],
    mapSize: normalizeMapSize(row.mapSize),
    topologyId: normalizeTopologyId(row.topologyId),
    displayName: row.displayName,
    previewTags: row.previewTags,
    preview: row.previewSilhouette as unknown as PregeneratedMapCatalogSummary['preview'],
    stats: parseStats(row.stats),
    diagnosticsScore: row.diagnosticsScore,
    diagnosticsWarnings: row.diagnosticsWarnings,
    status: normalizeStatus(row.status),
    visibility: normalizeVisibility(row.visibility),
    generatorVersion: row.generatorVersion,
    lastSelectedAt: row.lastSelectedAt?.toISOString() ?? null,
    selectionCount: row.selectionCount,
    failureCount: row.failureCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function summarizeGeneratedMapForStatus(
  summary: PregeneratedMapCatalogSummary
): MapPoolGeneratedMapReport {
  return {
    mapId: summary.id,
    artifactId: summary.artifactId,
    displayName: summary.displayName,
    seed: summary.seed,
    profileId: summary.profileId,
    mapSize: summary.mapSize,
    themeId: summary.themeId,
    topologyId: summary.topologyId,
    visibility: summary.visibility,
    status: summary.status,
    diagnosticsScore: summary.diagnosticsScore,
    diagnosticsWarningCount: summary.diagnosticsWarnings.length,
  };
}

function isShippableMap(manifest: VoxelMapManifest): boolean {
  const severeWarningPattern = /(failed|blocked spawn|unreachable|invalid|missing)/i;
  return !manifest.construction.diagnostics.warnings.some((warning) => severeWarningPattern.test(warning));
}

export function getRequiredMapPoolSlices(): MapPoolRequiredSlice[] {
  return VOXEL_MAP_SIZE_IDS.flatMap((mapSize) => (
    STANDARD_VOXEL_MAP_THEMES.flatMap((theme) => (
      PLAYABLE_PROFILE_IDS.map((profileId) => ({
        profileId,
        mapSize,
        themeId: theme.id,
        requiredReadyCount: requiredCountForProfile(profileId),
      }))
    ))
  ));
}

export function planMapPoolTopUpSliceIndexes(
  deficits: readonly number[],
  maxGenerated: number
): number[] {
  const remainingDeficits = deficits.map((deficit) => Math.max(0, Math.floor(deficit)));
  const generationOrder: number[] = [];
  let cursor = 0;

  while (generationOrder.length < maxGenerated) {
    let selectedIndex = -1;
    for (let offset = 0; offset < remainingDeficits.length; offset += 1) {
      const index = (cursor + offset) % remainingDeficits.length;
      if ((remainingDeficits[index] ?? 0) > 0) {
        selectedIndex = index;
        break;
      }
    }

    if (selectedIndex < 0) break;

    generationOrder.push(selectedIndex);
    remainingDeficits[selectedIndex] = Math.max(0, (remainingDeficits[selectedIndex] ?? 0) - 1);
    cursor = (selectedIndex + 1) % remainingDeficits.length;
  }

  return generationOrder;
}

function scoreSelectableMap(map: PregeneratedMapCatalogSummary, source: number): number {
  const selectedAt = map.lastSelectedAt ? Date.parse(map.lastSelectedAt) : 0;
  const ageBonus = selectedAt > 0 ? Math.min(10_000, Date.now() - selectedAt) / 1000 : 20_000;
  const usePenalty = map.selectionCount * 500;
  const failurePenalty = map.failureCount * 2000;
  const jitter = Number.parseInt(shortHash(`${source}:${map.id}`).slice(0, 8), 16) / 0xffffffff;
  return ageBonus - usePenalty - failurePenalty + jitter;
}

function chooseDiverseVoteMaps(
  maps: PregeneratedMapCatalogSummary[],
  source: number,
  count: number
): PregeneratedMapCatalogSummary[] {
  const selected: PregeneratedMapCatalogSummary[] = [];
  const remaining = [...maps].sort((a, b) => scoreSelectableMap(b, source) - scoreSelectableMap(a, source));

  while (selected.length < count && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const duplicateSeed = selected.some((map) => map.seed === candidate.seed);
      if (duplicateSeed) continue;

      const sizePenalty = selected.some((map) => map.mapSize === candidate.mapSize) ? 4000 : 0;
      const themePenalty = selected.some((map) => map.themeId === candidate.themeId) ? 2200 : 0;
      const topologyPenalty = selected.some((map) => map.topologyId === candidate.topologyId) ? 1400 : 0;
      const score = scoreSelectableMap(candidate, source) - sizePenalty - themePenalty - topologyPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    const [picked] = remaining.splice(bestIndex, 1);
    if (picked) selected.push(picked);
  }

  return selected;
}

function createSeedForSlice(input: {
  profileId: MapProfileId;
  mapSize: VoxelMapSizeId;
  themeId: VoxelMapTheme['id'];
  index: number;
  salt: number;
}): number {
  return createRandomSeed(
    Number.parseInt(shortHash([
      input.profileId,
      input.mapSize,
      input.themeId,
      input.index,
      input.salt,
      Date.now(),
    ].join(':')).slice(0, 8), 16)
  );
}

export function isPublicSeedGenerationFallbackEnabled(): boolean {
  const raw = process.env.PREGENERATED_MAP_FALLBACK_ENABLED
    ?? process.env.PUBLIC_MAP_GENERATION_FALLBACK;
  if (raw === '1' || raw?.toLowerCase() === 'true') return true;
  if (raw === '0' || raw?.toLowerCase() === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

export class PregeneratedMapCatalogService {
  constructor(
    private readonly client: PrismaClient,
    private readonly artifactStorage: PregeneratedMapArtifactStorage
  ) {}

  private async countReadyMapsBySlice(
    slices: readonly PoolSliceIdentity[],
    visibility: PregeneratedMapVisibility
  ): Promise<Map<string, number>> {
    if (slices.length === 0) return new Map();

    const rows = await this.client.pregeneratedMap.groupBy({
      by: ['profileId', 'mapSize', 'themeId'],
      where: {
        status: 'ready',
        visibility,
        generatorVersion: CONSTRUCTED_MAP_MANIFEST_VERSION,
        profileId: { in: Array.from(new Set(slices.map((slice) => slice.profileId))) },
        mapSize: { in: Array.from(new Set(slices.map((slice) => slice.mapSize))) },
        themeId: { in: Array.from(new Set(slices.map((slice) => slice.themeId))) },
      },
      _count: { _all: true },
    });

    return new Map(rows.map((row) => [
      createPoolSliceKey({
        profileId: row.profileId as MapProfileId,
        mapSize: row.mapSize as VoxelMapSizeId,
        themeId: row.themeId as VoxelMapTheme['id'],
      }),
      row._count._all,
    ]));
  }

  async releaseExpiredReservations(now = new Date()): Promise<number> {
    const result = await this.client.pregeneratedMap.updateMany({
      where: {
        status: 'reserved',
        reservationExpiresAt: { lt: now },
      },
      data: {
        status: 'ready',
        reservationExpiresAt: null,
      },
    });
    return result.count;
  }

  async listSelectableMaps(input: ListSelectableMapsInput = {}): Promise<PregeneratedMapCatalogSummary[]> {
    await this.releaseExpiredReservations();
    const where: Prisma.PregeneratedMapWhereInput = {
      status: 'ready',
      visibility: { in: toVisibilityArray(input.visibility) },
      generatorVersion: CONSTRUCTED_MAP_MANIFEST_VERSION,
    };
    if (input.gameplayMode) where.gameplayMode = input.gameplayMode;
    if (input.profileId) where.profileId = input.profileId;
    if (input.mapSize) where.mapSize = input.mapSize;
    if (input.themeId) where.themeId = input.themeId;
    if (input.topologyId) where.topologyId = input.topologyId;

    const rows = await this.client.pregeneratedMap.findMany({
      where,
      orderBy: [
        { lastSelectedAt: 'asc' },
        { selectionCount: 'asc' },
        { createdAt: 'asc' },
      ],
      take: Math.max(1, Math.min(250, input.limit ?? 100)),
    });
    return rows.map(summarizeMap);
  }

  async createMapVoteOptionsFromPool(input: CreateMapVoteOptionsFromPoolInput): Promise<PregeneratedMapCatalogSummary[]> {
    const visibility = input.visibility ?? 'public';
    const maps = await this.listSelectableMaps({
      gameplayMode: profileToGameplayMode(input.profileId),
      profileId: input.profileId,
      visibility,
      limit: 120,
    });

    const eventThemeId = input.eventThemeId ?? null;
    const eventMaps = eventThemeId
      ? maps.filter((map) => map.themeId === eventThemeId)
      : [];
    const standardMaps = eventThemeId
      ? maps.filter((map) => map.themeId !== eventThemeId)
      : maps;
    const selected = chooseDiverseVoteMaps(standardMaps, input.source, VOXEL_MAP_SIZE_IDS.length);

    if (eventMaps.length > 0 && selected.length > 0) {
      const eventIndex = input.source % selected.length;
      const [eventMap] = chooseDiverseVoteMaps(eventMaps, input.source ^ 0x17762026, 1);
      if (eventMap && !selected.some((map) => map.id === eventMap.id)) {
        selected[eventIndex] = eventMap;
      }
    }

    return selected;
  }

  async selectMapForBattleRoyal(input: SelectBattleRoyalMapInput): Promise<PregeneratedMapLaunchSelection | null> {
    const visibility = input.visibility ?? ['public', 'matchmaking-only'];
    const sizesToTry = input.preferredMapSize === 'medium'
      ? ['medium', 'large', 'small'] as const
      : input.preferredMapSize === 'small'
      ? ['small', 'medium'] as const
      : ['large', 'medium'] as const;

    for (const mapSize of sizesToTry) {
      const exactThemeMaps = input.eventThemeId
        ? await this.listSelectableMaps({
          gameplayMode: 'battle_royal',
          profileId: 'battle_royal_large',
          mapSize,
          themeId: input.eventThemeId,
          visibility,
          limit: 50,
        })
        : [];
      const maps = exactThemeMaps.length > 0
        ? exactThemeMaps
        : await this.listSelectableMaps({
          gameplayMode: 'battle_royal',
          profileId: 'battle_royal_large',
          mapSize,
          visibility,
          limit: 80,
        });
      const [selected] = chooseDiverseVoteMaps(maps, input.source, 1);
      if (selected) {
        return {
          id: 'map_1',
          seed: selected.seed,
          mapSize: selected.mapSize,
          mapProfileId: selected.profileId,
          mapThemeId: selected.themeId,
          pregeneratedMapId: selected.id,
          mapArtifactId: selected.artifactId,
          topologyId: selected.topologyId,
          displayName: selected.displayName,
        };
      }
    }

    return null;
  }

  async reserveMapForLaunch(input: ReserveMapForLaunchInput): Promise<ReservedPregeneratedMapLaunch | null> {
    await this.releaseExpiredReservations();
    const reservationExpiresAt = new Date(Date.now() + RESERVATION_TTL_MS);
    const selectionId = await this.client.$transaction(async (tx) => {
      const updated = await tx.pregeneratedMap.updateMany({
        where: {
          id: input.mapId,
          status: 'ready',
          generatorVersion: CONSTRUCTED_MAP_MANIFEST_VERSION,
        },
        data: {
          status: 'reserved',
          reservationExpiresAt,
          lastSelectedAt: new Date(),
          selectionCount: { increment: 1 },
        },
      });
      if (updated.count === 0) return null;

      const selection = await tx.pregeneratedMapSelection.create({
        data: {
          mapId: input.mapId,
          lobbyId: input.lobbyId ?? null,
          roomId: input.roomId ?? null,
          matchId: input.matchId ?? null,
          selectionSource: input.selectionSource,
          selectedByPlayerId: input.selectedByPlayerId ?? null,
        },
      });
      return selection.id;
    });
    if (!selectionId) return null;

    const map = await this.client.pregeneratedMap.findUnique({
      where: { id: input.mapId },
    });
    if (!map) return null;

    return {
      map: summarizeMap(map),
      selectionId,
    };
  }

  async recordMapLaunchResult(input: RecordMapLaunchResultInput): Promise<void> {
    if (!input.mapId) return;

    await this.client.pregeneratedMap.update({
      where: { id: input.mapId },
      data: input.ok
        ? {
          status: 'active',
          reservationExpiresAt: null,
        }
        : {
          status: 'ready',
          reservationExpiresAt: null,
          failureCount: { increment: 1 },
          diagnosticsWarnings: input.error ? { push: `launch:${input.error}` } : undefined,
        },
    }).catch((error) => {
      loggers.room.warn('Failed to record pregenerated map launch result', {
        mapId: input.mapId,
        ok: input.ok,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    if (input.roomId || input.matchId) {
      await this.client.pregeneratedMapSelection.updateMany({
        where: input.selectionId
          ? { id: input.selectionId }
          : {
            mapId: input.mapId,
            selectedAt: { gte: new Date(Date.now() - RESERVATION_TTL_MS * 2) },
          },
        data: {
          roomId: input.roomId ?? undefined,
          matchId: input.matchId ?? undefined,
        },
      }).catch(() => undefined);
    }
  }

  async releaseMapAfterLaunch(input: {
    mapId?: PregeneratedMapId | null;
    roomId?: string | null;
    matchId?: string | null;
  }): Promise<void> {
    if (!input.mapId) return;
    await this.client.pregeneratedMap.updateMany({
      where: {
        id: input.mapId,
        status: { in: ['reserved', 'active'] },
      },
      data: {
        status: 'ready',
        reservationExpiresAt: null,
      },
    }).catch((error) => {
      loggers.room.warn('Failed to release pregenerated map after launch', {
        mapId: input.mapId,
        roomId: input.roomId,
        matchId: input.matchId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async loadMapManifest(mapId: PregeneratedMapId): Promise<LoadedPregeneratedMapManifest> {
    const row = await this.client.pregeneratedMap.findUnique({
      where: { id: mapId },
    });
    if (!row) throw new Error(`Pregenerated map ${mapId} was not found`);
    if (row.status === 'retired' || row.status === 'failed') {
      throw new Error(`Pregenerated map ${mapId} is ${row.status}`);
    }

    const stored = await this.artifactStorage.loadArtifact(row.artifactId);
    if (!stored) throw new Error(`Pregenerated map artifact ${row.artifactId} was not found`);
    const manifest = decodePregeneratedMapManifest(encodePregeneratedMapArtifactEnvelope(stored.envelope));
    const summary = summarizeMap(row);
    this.validateLoadedManifest(summary, stored.contentHash, manifest);
    return { summary, manifest };
  }

  async loadPublicMapArtifact(mapId: PregeneratedMapId): Promise<{
    summary: PregeneratedMapCatalogSummary;
    artifact: PregeneratedMapArtifactEnvelope;
  }> {
    const row = await this.client.pregeneratedMap.findUnique({
      where: { id: mapId },
    });
    if (!row) throw new Error(`Pregenerated map ${mapId} was not found`);
    if (row.visibility === 'admin-only' || row.status === 'retired' || row.status === 'failed') {
      throw new Error(`Pregenerated map ${mapId} is not publicly loadable`);
    }
    const stored = await this.artifactStorage.loadArtifact(row.artifactId);
    if (!stored) throw new Error(`Pregenerated map artifact ${row.artifactId} was not found`);
    const summary = summarizeMap(row);
    const manifest = decodePregeneratedMapManifest(encodePregeneratedMapArtifactEnvelope(stored.envelope));
    this.validateLoadedManifest(summary, stored.contentHash, manifest);
    return {
      summary,
      artifact: stored.envelope,
    };
  }

  async createCatalogEntry(input: {
    manifest: VoxelMapManifest;
    visibility?: PregeneratedMapVisibility;
    status?: PregeneratedMapStatus;
    displayName?: string;
  }): Promise<PregeneratedMapCatalogSummary> {
    const visibility = input.visibility ?? 'public';
    const manifest = input.manifest;
    const profileId = manifest.profileId ?? 'ctf_arena';
    const identityKey = createMapIdentityKey({
      seed: manifest.seed,
      themeId: manifest.themeId,
      profileId,
      mapSize: manifest.mapSize,
      topologyId: manifest.topologyId,
      generatorVersion: manifest.version,
      visibility,
    });
    const mapId = createMapId(identityKey);
    const artifactId = createArtifactId(identityKey);
    const envelope = createPregeneratedMapArtifactEnvelope({
      mapId,
      artifactId,
      manifest,
    });
    const stored = await this.artifactStorage.storeArtifact({ envelope });
    const stats = getPregeneratedMapStats(manifest);
    const diagnostics = getPregeneratedMapDiagnostics(manifest);

    const row = await this.client.pregeneratedMap.upsert({
      where: { id: mapId },
      create: {
        id: mapId,
        artifactId: stored.id,
        generatorVersion: manifest.version,
        seed: mapSeedToDatabaseValue(manifest.seed),
        themeId: manifest.themeId,
        profileId,
        gameplayMode: manifest.gameplay.mode,
        familyId: manifest.familyId,
        mapSize: manifest.mapSize,
        topologyId: manifest.topologyId,
        displayName: input.displayName ?? createDisplayName(manifest, Number.parseInt(shortHash(mapId).slice(0, 8), 16)),
        previewTags: getPregeneratedMapPreviewTags(manifest),
        previewSilhouette: toPrismaJson(manifest.preview),
        stats: toPrismaJson(stats),
        diagnosticsScore: diagnostics.score,
        diagnosticsWarnings: diagnostics.warnings,
        status: input.status ?? 'ready',
        visibility,
      },
      update: {
        artifactId: stored.id,
        displayName: input.displayName,
        previewTags: getPregeneratedMapPreviewTags(manifest),
        previewSilhouette: toPrismaJson(manifest.preview),
        stats: toPrismaJson(stats),
        diagnosticsScore: diagnostics.score,
        diagnosticsWarnings: diagnostics.warnings,
        status: input.status ?? 'ready',
      },
    });

    return summarizeMap(row);
  }

  async generateAndReserveMapForLaunch(input: GenerateMapForLaunchInput): Promise<ReservedPregeneratedMapLaunch> {
    const visibility = input.visibility ?? 'matchmaking-only';
    const maxAttempts = Math.max(1, Math.min(8, Math.floor(input.maxAttempts ?? 4)));
    let lastError: Error | null = null;

    writeMapPoolConsoleStatus('on-demand-generation-started', {
      seed: input.seed >>> 0,
      profileId: input.profileId,
      mapSize: input.mapSize,
      themeId: input.themeId,
      visibility,
      maxAttempts,
      selectionSource: input.selectionSource,
    });

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const seed = attempt === 0
        ? input.seed >>> 0
        : createSeedForSlice({
          profileId: input.profileId,
          mapSize: input.mapSize,
          themeId: input.themeId,
          index: attempt,
          salt: input.seed,
        });

      try {
        const manifest = generateProceduralVoxelMap(seed, {
          themeId: input.themeId,
          mapSize: input.mapSize,
          profileId: input.profileId,
        });

        if (!isShippableMap(manifest)) {
          const failedSummary = await this.createCatalogEntry({ manifest, visibility, status: 'failed' });
          writeMapPoolConsoleStatus('on-demand-candidate-rejected', {
            ...summarizeGeneratedMapForStatus(failedSummary),
            attempt: attempt + 1,
            maxAttempts,
          });
          lastError = new Error(`Generated on-demand map was rejected by diagnostics: ${failedSummary.diagnosticsWarnings.join('; ')}`);
          continue;
        }

        const summary = await this.createCatalogEntry({ manifest, visibility, status: 'ready' });
        const reserved = await this.reserveMapForLaunch({
          mapId: summary.id,
          lobbyId: input.lobbyId,
          roomId: input.roomId,
          matchId: input.matchId,
          selectionSource: input.selectionSource,
          selectedByPlayerId: input.selectedByPlayerId,
        });

        if (reserved) {
          writeMapPoolConsoleStatus('on-demand-map-generated', {
            ...summarizeGeneratedMapForStatus(reserved.map),
            attempt: attempt + 1,
            maxAttempts,
            selectionId: reserved.selectionId,
          });
          return reserved;
        }

        lastError = new Error(`Generated on-demand map ${summary.id} could not be reserved`);
        writeMapPoolConsoleStatus('on-demand-reservation-missed', {
          ...summarizeGeneratedMapForStatus(summary),
          attempt: attempt + 1,
          maxAttempts,
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        loggers.room.warn('On-demand pregenerated map generation failed', {
          seed,
          profileId: input.profileId,
          mapSize: input.mapSize,
          themeId: input.themeId,
          visibility,
          attempt: attempt + 1,
          maxAttempts,
          error: lastError.message,
        });
        writeMapPoolConsoleStatus('on-demand-generation-failed', {
          seed,
          profileId: input.profileId,
          mapSize: input.mapSize,
          themeId: input.themeId,
          visibility,
          attempt: attempt + 1,
          maxAttempts,
          error: lastError.message,
        });
      }
    }

    throw lastError ?? new Error('On-demand pregenerated map generation failed');
  }

  async topUpPool(options: MapPoolTopUpOptions = {}): Promise<MapPoolTopUpResult> {
    await this.releaseExpiredReservations();
    const visibility = options.visibility ?? 'public';
    const slices = getRequiredMapPoolSlices().filter((slice) => (
      (!options.profileId || slice.profileId === options.profileId) &&
      (!options.mapSize || slice.mapSize === options.mapSize) &&
      (!options.themeId || slice.themeId === options.themeId)
    ));
    const result: MapPoolTopUpResult = {
      generated: 0,
      failed: 0,
      skipped: 0,
      generatedMaps: [],
      slices: [],
    };
    let remainingGenerationBudget = Math.max(0, options.maxGenerated ?? 24);
    const startedAt = Date.now();

    writeMapPoolConsoleStatus('top-up-started', {
      visibility,
      profileId: options.profileId ?? null,
      mapSize: options.mapSize ?? null,
      themeId: options.themeId ?? null,
      targetReadyCount: options.targetReadyCount ?? null,
      maxGenerated: options.maxGenerated ?? 24,
      sliceCount: slices.length,
    });

    const readyCountsBySlice = await this.countReadyMapsBySlice(slices, visibility);

    const sliceStates = slices.map((slice) => {
      const targetReadyCount = options.targetReadyCount ?? slice.requiredReadyCount;
      const readyCount = readyCountsBySlice.get(createPoolSliceKey(slice)) ?? 0;
      const sliceResult = {
        profileId: slice.profileId,
        mapSize: slice.mapSize,
        themeId: slice.themeId,
        targetReadyCount,
        readyCount,
        readyCountAfter: readyCount,
        remainingDeficit: Math.max(0, targetReadyCount - readyCount),
        generated: 0,
        failed: 0,
      };
      result.slices.push(sliceResult);
      return {
        slice,
        result: sliceResult,
        deficit: Math.max(0, targetReadyCount - readyCount),
      };
    });

    for (const slice of slices) {
      const state = sliceStates.find((candidate) => candidate.slice === slice);
      if (!state) continue;
      const targetReadyCount = options.targetReadyCount ?? slice.requiredReadyCount;
      writeVerboseMapPoolConsoleStatus('slice-status', {
        profileId: slice.profileId,
        mapSize: slice.mapSize,
        themeId: slice.themeId,
        visibility,
        readyCount: state.result.readyCount,
        targetReadyCount,
        deficit: state.deficit,
        remainingGenerationBudget,
      });
      if (state.deficit === 0) {
        result.skipped += 1;
      }
    }

    for (const selectedStateIndex of planMapPoolTopUpSliceIndexes(
      sliceStates.map((state) => state.deficit),
      remainingGenerationBudget
    )) {
      const state = sliceStates[selectedStateIndex];
      if (!state) break;

      const { slice, result: sliceResult } = state;
      const targetReadyCount = sliceResult.targetReadyCount;
      const generatedIndex = targetReadyCount - state.deficit;
      remainingGenerationBudget -= 1;
      const seed = createSeedForSlice({
        profileId: slice.profileId,
        mapSize: slice.mapSize,
        themeId: slice.themeId,
        index: generatedIndex,
        salt: remainingGenerationBudget,
      });
      try {
        const manifest = generateProceduralVoxelMap(seed, {
          themeId: slice.themeId,
          mapSize: slice.mapSize,
          profileId: slice.profileId,
        });
        if (!isShippableMap(manifest)) {
          const failedSummary = await this.createCatalogEntry({ manifest, visibility, status: 'failed' });
          result.failed += 1;
          sliceResult.failed += 1;
          writeMapPoolConsoleStatus('map-candidate-rejected', {
            ...summarizeGeneratedMapForStatus(failedSummary),
            profileId: slice.profileId,
            mapSize: slice.mapSize,
            themeId: slice.themeId,
            readyCountAfter: sliceResult.readyCountAfter,
            remainingDeficit: state.deficit,
          });
          continue;
        }
        const summary = await this.createCatalogEntry({ manifest, visibility, status: 'ready' });
        const generatedMap = summarizeGeneratedMapForStatus(summary);
        result.generatedMaps.push(generatedMap);
        result.generated += 1;
        sliceResult.generated += 1;
        state.deficit -= 1;
        sliceResult.readyCountAfter += 1;
        sliceResult.remainingDeficit = Math.max(0, targetReadyCount - sliceResult.readyCountAfter);
        writeMapPoolConsoleStatus('map-generated', {
          ...generatedMap,
          readyCountAfter: sliceResult.readyCountAfter,
          targetReadyCount,
          remainingDeficit: sliceResult.remainingDeficit,
          remainingGenerationBudget,
        });
      } catch (error) {
        result.failed += 1;
        sliceResult.failed += 1;
        loggers.room.warn('Pregenerated map pool candidate failed', {
          profileId: slice.profileId,
          mapSize: slice.mapSize,
          themeId: slice.themeId,
          seed,
          error: error instanceof Error ? error.message : String(error),
        });
        writeMapPoolConsoleStatus('map-generation-failed', {
          profileId: slice.profileId,
          mapSize: slice.mapSize,
          themeId: slice.themeId,
          visibility,
          seed,
          readyCountAfter: sliceResult.readyCountAfter,
          targetReadyCount,
          remainingDeficit: Math.max(0, targetReadyCount - sliceResult.readyCountAfter),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const state of sliceStates) {
      const { slice, result: sliceResult } = state;
      sliceResult.remainingDeficit = Math.max(0, sliceResult.targetReadyCount - sliceResult.readyCountAfter);
      if (sliceResult.generated > 0 || sliceResult.failed > 0) {
        writeMapPoolConsoleStatus('slice-complete', {
          profileId: slice.profileId,
          mapSize: slice.mapSize,
          themeId: slice.themeId,
          visibility,
          readyCountBefore: sliceResult.readyCount,
          readyCountAfter: sliceResult.readyCountAfter,
          targetReadyCount: sliceResult.targetReadyCount,
          remainingDeficit: sliceResult.remainingDeficit,
          generated: sliceResult.generated,
          failed: sliceResult.failed,
        });
      }
    }

    writeMapPoolConsoleStatus('top-up-complete', {
      generated: result.generated,
      failed: result.failed,
      skipped: result.skipped,
      generatedMapCount: result.generatedMaps.length,
      remainingGenerationBudget,
      sliceCount: result.slices.length,
      lowSliceCount: result.slices.filter((slice) => slice.remainingDeficit > 0).length,
      readyTotalForSelectedSlices: result.slices.reduce((sum, slice) => sum + slice.readyCountAfter, 0),
      requiredReadyTotalForSelectedSlices: result.slices.reduce((sum, slice) => sum + slice.targetReadyCount, 0),
      durationMs: Date.now() - startedAt,
    });

    return result;
  }

  async getAdminOverview(): Promise<MapPoolAdminOverview> {
    await this.releaseExpiredReservations();
    const slices = getRequiredMapPoolSlices();
    const [
      statusCounts,
      artifactAggregate,
      oldestReady,
      recentSelectionCount,
      failures,
      readyCountsBySlice,
    ] = await Promise.all([
      this.client.pregeneratedMap.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.client.pregeneratedMapArtifact.aggregate({
        _sum: { byteSize: true },
      }),
      this.client.pregeneratedMap.findFirst({
        where: { status: 'ready' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.client.pregeneratedMapSelection.count({
        where: {
          selectedAt: { gte: new Date(Date.now() - RECENT_SELECTION_WINDOW_MS) },
        },
      }),
      this.client.pregeneratedMap.findMany({
        where: { status: 'failed' },
        orderBy: { updatedAt: 'desc' },
        take: 12,
        select: {
          id: true,
          seed: true,
          profileId: true,
          mapSize: true,
          themeId: true,
          diagnosticsWarnings: true,
          updatedAt: true,
        },
      }),
      this.countReadyMapsBySlice(slices, 'public'),
    ]);

    const statusCount = new Map(statusCounts.map((entry) => [entry.status, entry._count._all]));
    const lowSlices = [];
    for (const slice of slices) {
      const readyCount = readyCountsBySlice.get(createPoolSliceKey(slice)) ?? 0;
      if (readyCount < slice.requiredReadyCount) {
        lowSlices.push({
          profileId: slice.profileId,
          mapSize: slice.mapSize,
          themeId: slice.themeId,
          readyCount,
          requiredReadyCount: slice.requiredReadyCount,
        });
      }
    }

    return {
      requiredReadyTotal: slices.reduce((sum, slice) => sum + slice.requiredReadyCount, 0),
      readyTotal: statusCount.get('ready') ?? 0,
      reservedTotal: statusCount.get('reserved') ?? 0,
      activeTotal: statusCount.get('active') ?? 0,
      failedTotal: statusCount.get('failed') ?? 0,
      retiredTotal: statusCount.get('retired') ?? 0,
      artifactBytesTotal: artifactAggregate._sum.byteSize ?? 0,
      oldestReadyCreatedAt: oldestReady?.createdAt.toISOString() ?? null,
      recentSelectionCount,
      lowSlices,
      failures: failures.map((failure) => ({
        id: failure.id,
        seed: mapSeedFromDatabaseValue(failure.seed),
        profileId: failure.profileId,
        mapSize: failure.mapSize,
        themeId: failure.themeId,
        diagnosticsWarnings: failure.diagnosticsWarnings,
        updatedAt: failure.updatedAt.toISOString(),
      })),
    };
  }

  private validateLoadedManifest(
    summary: PregeneratedMapCatalogSummary,
    contentHash: string,
    manifest: VoxelMapManifest
  ): void {
    const expected = {
      seed: summary.seed,
      themeId: summary.themeId,
      mapSize: summary.mapSize,
      profileId: summary.profileId,
      topologyId: summary.topologyId,
      generatorVersion: summary.generatorVersion,
    };
    const actual = {
      seed: manifest.seed >>> 0,
      themeId: manifest.themeId,
      mapSize: manifest.mapSize,
      profileId: manifest.profileId ?? 'ctf_arena',
      topologyId: manifest.topologyId,
      generatorVersion: manifest.version,
    };
    for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
      if (expected[key] !== actual[key]) {
        throw new Error(`Pregenerated map ${summary.id} metadata mismatch for ${key}: expected ${expected[key]}, got ${actual[key]}`);
      }
    }
    if (actual.generatorVersion !== CONSTRUCTED_MAP_MANIFEST_VERSION) {
      throw new Error(`Pregenerated map ${summary.id} uses outdated generator version ${actual.generatorVersion}; expected ${CONSTRUCTED_MAP_MANIFEST_VERSION}`);
    }
    if (!contentHash) {
      throw new Error(`Pregenerated map ${summary.id} artifact is missing content hash`);
    }
  }
}

export const pregeneratedMapCatalogService = new PregeneratedMapCatalogService(
  prisma,
  pregeneratedMapArtifactStorage
);
