import type { Prisma } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import prisma from '../db';
import {
  DEFAULT_COMPETITIVE_RATING,
  RANK_DEFINITIONS,
  STANDARD_VOXEL_MAP_THEMES,
  VOXEL_MAP_SIZE_IDS,
  getRankFromRating,
  type DailyMissionAdminOverview,
  type MapProfileId,
  type PregeneratedMapVisibility,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
import type { ColyseusRuntimeConfig } from '../config/colyseus';
import { loggers } from '../utils/logger';
import {
  AntiCheatEvidenceStore,
  applyHeldRankedOutcome,
  cancelHeldRankedOutcome,
  type AntiCheatAccountActionType,
  type AntiCheatCaseStatus,
} from '../anticheat';
import {
  buildPlayerReportResolution,
  buildReportActionResolution,
  createPlayerReportUpdate,
  isPlayerReportStatus,
  listPlayerReportQueue,
} from '../reports/playerReportService';
import { wagerService } from '../wagers/service';
import { playerRewardService } from '../rewards/service';
import {
  collectLocalAdminMachineSnapshot,
  listAdminMachineSnapshots,
  type AdminMachineRedisClient,
  type AdminMachineSnapshot,
  type AdminMatchMaker,
  type AdminRoomListing,
} from './machineRegistry';
import { createInGameCapacitySnapshot } from '../matchmaking/playerCapacity';
import { getGameTokenConfig } from '../config/gameToken';
import {
  getGlobalNotification,
  setGlobalNotification,
  removeGlobalNotification,
  GLOBAL_NOTIFICATION_MAX_MESSAGE_LENGTH,
} from '../notifications/globalNotificationService';
import {
  getEventBiomeAdminOverview,
  setEventBiomeSettings,
} from '../liveops/eventBiomeService';
import {
  dailyMissionService,
} from '../missions/service';
import { MissionValidationError } from '../missions/validation';
import {
  getRankedSeason,
  setRankedSeason,
  type RankedSeasonAdminView,
} from '../ranking/seasonService';
import {
  getRankedEntryGateSettings,
  setRankedEntryGateSettings,
  type RankedEntryGateAdminView,
} from '../matchmaking/rankedTokenHold';
import {
  SkinShopServiceError,
  getSkinShopAdminOverview,
  parseSkinIdInput,
  updateSkinShopItemSettings,
  updateSkinShopSettings,
  type SkinShopAdminOverview,
} from '../cosmetics/skinShopService';
import {
  createAdminCsrfToken,
  ensureGameAdmin as ensureAdmin,
  ensureGameAdminMutation as ensureAdminMutation,
  noStore,
  type GameAdminUser as AdminUser,
} from '../auth/gameAdmin';
import {
  pregeneratedMapCatalogService,
  type MapPoolTopUpOptions,
} from '../maps/pregeneratedMapCatalog';

interface AdminRouterOptions {
  config: ColyseusRuntimeConfig;
  matchMaker: AdminMatchMaker;
  redis: AdminMachineRedisClient | null;
  flyReplayRegistered: () => boolean;
}

const ADMIN_RANK_USER_LIMIT_MAX = 100;
const ADMIN_MANUAL_RATING_MAX = 5000;
const ADMIN_POOL_PROFILE_IDS = ['ctf_arena', 'tdm_arena', 'battle_royal_large'] as const satisfies readonly MapProfileId[];
const ADMIN_POOL_VISIBILITIES = ['public', 'matchmaking-only', 'admin-only'] as const satisfies readonly PregeneratedMapVisibility[];

const adminRankUserSelect = {
  id: true,
  name: true,
  walletAddress: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  totalGames: true,
  totalWins: true,
  totalLosses: true,
  totalDraws: true,
  competitiveRating: true,
  rankedGames: true,
  rankedWins: true,
  rankedLosses: true,
  rankedDraws: true,
  rankedPlacementsRemaining: true,
  rankedPeakRating: true,
  rankedLastMatchAt: true,
} satisfies Prisma.UserSelect;

type AdminRankUserRecord = Prisma.UserGetPayload<{ select: typeof adminRankUserSelect }>;

interface RoomQueryResult {
  rooms: AdminRoomListing[];
  error: string | null;
}

interface MachineOverview {
  machineId: string;
  region: string | null;
  appName: string | null;
  processCount: number;
  latestUpdatedAtMs: number;
  loadAvg1: number;
  loadPct1: number;
  cpuCount: number;
  memoryRssBytes: number;
  systemFreeMemoryBytes: number;
  systemTotalMemoryBytes: number;
  capacityPressure: number;
  dynamicCapacityPlayers: number;
  dynamicCapacitySource: 'live' | 'room_metrics' | 'bootstrap' | null;
  eventLoopDelayP95Ms: number;
  processCpuUtilization: number;
  localCcu: number;
  gameRoomCount: number;
  lobbyRoomCount: number;
  playersInGame: number;
  botsInGame: number;
  participantsInGame: number;
  lobbyParticipants: number;
  processes: AdminMachineSnapshot[];
}

type AdminRankedSeason = RankedSeasonAdminView;
type AdminRankedEntryGate = RankedEntryGateAdminView;
type AdminSkinShop = SkinShopAdminOverview;
type AdminMissions = DailyMissionAdminOverview;

function readStringField(body: unknown, key: string): string | null {
  if (!body || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readOptionalBoundedInteger(
  body: unknown,
  key: string,
  min: number,
  max: number
): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = (body as Record<string, unknown>)[key];
  if (value == null || value === '') return undefined;
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numberValue) || numberValue < min || numberValue > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return numberValue;
}

function parseAdminMapPoolTopUpOptions(body: unknown): MapPoolTopUpOptions {
  const profileId = readStringField(body, 'profileId');
  const mapSize = readStringField(body, 'mapSize');
  const themeId = readStringField(body, 'themeId');
  const visibility = readStringField(body, 'visibility');

  if (profileId && !(ADMIN_POOL_PROFILE_IDS as readonly string[]).includes(profileId)) {
    throw new Error(`Unsupported map profile: ${profileId}`);
  }
  if (mapSize && !VOXEL_MAP_SIZE_IDS.includes(mapSize as VoxelMapSizeId)) {
    throw new Error(`Unsupported map size: ${mapSize}`);
  }
  if (themeId && !STANDARD_VOXEL_MAP_THEMES.some((theme) => theme.id === themeId)) {
    throw new Error(`Unsupported map theme: ${themeId}`);
  }
  if (visibility && !ADMIN_POOL_VISIBILITIES.includes(visibility as PregeneratedMapVisibility)) {
    throw new Error(`Unsupported map visibility: ${visibility}`);
  }

  return {
    profileId: profileId as MapProfileId | undefined,
    mapSize: mapSize as VoxelMapSizeId | undefined,
    themeId: themeId as VoxelMapTheme['id'] | undefined,
    visibility: visibility as PregeneratedMapVisibility | undefined,
    targetReadyCount: readOptionalBoundedInteger(body, 'targetReadyCount', 1, 100),
    maxGenerated: readOptionalBoundedInteger(body, 'maxGenerated', 1, 250),
  };
}

const antiCheatEvidenceStore = new AntiCheatEvidenceStore(prisma);

function readRequestString(value: unknown, maxLength = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function readQueryString(value: unknown, maxLength = 500): string {
  if (Array.isArray(value)) return readQueryString(value[0], maxLength);
  return readRequestString(value, maxLength);
}

function readRequestInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  }
  return null;
}

function readAdminRankUserLimit(value: unknown): number {
  const limit = readRequestInteger(value) ?? 25;
  return Math.max(1, Math.min(ADMIN_RANK_USER_LIMIT_MAX, limit));
}

function readAdminRankUserPage(value: unknown): number {
  const page = readRequestInteger(value) ?? 1;
  return Math.max(1, page);
}

function readManualRating(value: unknown): number | null {
  const rating = readRequestInteger(value);
  if (rating === null || rating < 0 || rating > ADMIN_MANUAL_RATING_MAX) return null;
  return rating;
}

function prismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const RANK_GATE_OPTIONS = RANK_DEFINITIONS.flatMap((tier) => (
  tier.divisionThresholds.map((rating, index) => ({
    label: `${tier.label} ${index + 1}`,
    tier: tier.id,
    division: index + 1,
    rating,
  }))
)).map((option, index, options) => {
  const nextRating = options[index + 1]?.rating ?? null;
  const maxRating = nextRating === null ? null : nextRating - 1;
  return {
    ...option,
    minRating: option.rating,
    maxRating,
    rangeLabel: maxRating === null ? `${option.rating}+` : `${option.rating}-${maxRating}`,
  };
});

function rankDivisionOptions() {
  return RANK_GATE_OPTIONS;
}

function rankGateForRating(rating: number) {
  let current = RANK_GATE_OPTIONS[0];
  for (const option of RANK_GATE_OPTIONS) {
    if (rating >= option.minRating) current = option;
    else break;
  }
  return current;
}

function serializeAdminRankUser(user: AdminRankUserRecord) {
  const currentRank = getRankFromRating(user.competitiveRating, user.rankedGames);
  const peakRank = getRankFromRating(user.rankedPeakRating, Math.max(user.rankedGames, 1));
  const currentGate = rankGateForRating(user.competitiveRating);
  const peakGate = rankGateForRating(user.rankedPeakRating);

  return {
    id: user.id,
    name: user.name,
    walletAddress: user.walletAddress,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    totalGames: user.totalGames,
    totalWins: user.totalWins,
    totalLosses: user.totalLosses,
    totalDraws: user.totalDraws,
    competitiveRating: user.competitiveRating,
    rankedGames: user.rankedGames,
    rankedWins: user.rankedWins,
    rankedLosses: user.rankedLosses,
    rankedDraws: user.rankedDraws,
    rankedPlacementsRemaining: user.rankedPlacementsRemaining,
    rankedPeakRating: user.rankedPeakRating,
    rankedLastMatchAt: user.rankedLastMatchAt?.toISOString() ?? null,
    rank: {
      label: currentRank.label,
      tier: currentRank.tier,
      division: currentRank.division,
      rating: currentRank.rating,
      minRating: currentGate.minRating,
      maxRating: currentGate.maxRating,
      rangeLabel: currentGate.rangeLabel,
    },
    peakRank: {
      label: peakRank.label,
      tier: peakRank.tier,
      division: peakRank.division,
      rating: peakRank.rating,
      minRating: peakGate.minRating,
      maxRating: peakGate.maxRating,
      rangeLabel: peakGate.rangeLabel,
    },
  };
}

async function listAdminRankUsers(query: string, page: number, limit: number) {
  const search = query.trim();
  const where = search
    ? {
      OR: [
        { id: { contains: search, mode: 'insensitive' as const } },
        { name: { contains: search, mode: 'insensitive' as const } },
        { walletAddress: { contains: search, mode: 'insensitive' as const } },
      ],
    } satisfies Prisma.UserWhereInput
    : undefined;

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: search
        ? [{ competitiveRating: 'desc' }, { rankedWins: 'desc' }, { updatedAt: 'desc' }]
        : [{ updatedAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      select: adminRankUserSelect,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    users: users.map(serializeAdminRankUser),
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
    },
  };
}

function readEvidenceEventIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim().slice(0, 96))
      .slice(0, 50)
    : [];
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
  }
  return null;
}

function readMetadataNumber(metadata: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!metadata) return null;
  return readFiniteNumber(metadata[key]);
}

function roomClientCount(room: AdminRoomListing): number {
  return readFiniteNumber(room.clients) ?? 0;
}

function gameHumanCount(room: AdminRoomListing): number {
  return readMetadataNumber(room.metadata, 'humanCount') ?? roomClientCount(room);
}

function gameBotCount(room: AdminRoomListing): number {
  return readMetadataNumber(room.metadata, 'botCount') ?? 0;
}

function gameParticipantCount(room: AdminRoomListing): number {
  return readMetadataNumber(room.metadata, 'participantCount') ?? gameHumanCount(room) + gameBotCount(room);
}

function lobbyParticipantCount(room: AdminRoomListing): number {
  const participantCount = readMetadataNumber(room.metadata, 'participantCount');
  if (participantCount !== null) return participantCount;

  const humanCount = readMetadataNumber(room.metadata, 'humanCount');
  const botCount = readMetadataNumber(room.metadata, 'botCount');
  if (humanCount !== null || botCount !== null) return (humanCount ?? 0) + (botCount ?? 0);

  return roomClientCount(room);
}

function roomMetadataString(room: AdminRoomListing, key: string): string | null {
  const value = room.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function groupKeyForRoom(
  room: AdminRoomListing,
  processSnapshots: Map<string, AdminMachineSnapshot>
): string {
  if (room.processId && processSnapshots.has(room.processId)) {
    return processSnapshots.get(room.processId)!.machineId;
  }

  return room.processId ? `process:${room.processId}` : room.publicAddress || 'unknown';
}

async function queryRooms(matchMaker: AdminMatchMaker, name: string): Promise<RoomQueryResult> {
  try {
    return { rooms: await matchMaker.query({ name }), error: null };
  } catch (error) {
    return {
      rooms: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function pingRedis(redis: AdminMachineRedisClient | null): Promise<{ ok: boolean; status: string; error?: string }> {
  if (!redis) return { ok: false, status: 'not_configured' };

  const maybeRedis = redis as AdminMachineRedisClient & { ping?: () => Promise<string>; status?: string };
  if (typeof maybeRedis.ping !== 'function') {
    return { ok: false, status: 'ping_unavailable' };
  }

  try {
    const response = await maybeRedis.ping();
    return { ok: response === 'PONG', status: response };
  } catch (error) {
    return {
      ok: false,
      status: typeof maybeRedis.status === 'string' ? maybeRedis.status : 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createMachineMap(snapshots: AdminMachineSnapshot[]): Map<string, MachineOverview> {
  const machines = new Map<string, MachineOverview>();

  for (const snapshot of snapshots) {
    const existing = machines.get(snapshot.machineId);
    if (!existing) {
      machines.set(snapshot.machineId, {
        machineId: snapshot.machineId,
        region: snapshot.region,
        appName: snapshot.appName,
        processCount: 1,
        latestUpdatedAtMs: snapshot.updatedAtMs,
        loadAvg1: snapshot.loadAvg1,
        loadPct1: snapshot.loadPct1,
        cpuCount: snapshot.cpuCount,
        memoryRssBytes: snapshot.memoryRssBytes,
        systemFreeMemoryBytes: snapshot.systemFreeMemoryBytes,
        systemTotalMemoryBytes: snapshot.systemTotalMemoryBytes,
        capacityPressure: snapshot.capacityPressure,
        dynamicCapacityPlayers: 0,
        dynamicCapacitySource: null,
        eventLoopDelayP95Ms: snapshot.eventLoopDelayP95Ms,
        processCpuUtilization: snapshot.processCpuUtilization,
        localCcu: snapshot.localCcu,
        gameRoomCount: 0,
        lobbyRoomCount: 0,
        playersInGame: 0,
        botsInGame: 0,
        participantsInGame: 0,
        lobbyParticipants: 0,
        processes: [snapshot],
      });
      continue;
    }

    existing.processCount += 1;
    existing.processes.push(snapshot);
    existing.loadAvg1 = Math.max(existing.loadAvg1, snapshot.loadAvg1);
    existing.loadPct1 = Math.max(existing.loadPct1, snapshot.loadPct1);
    existing.cpuCount = Math.max(existing.cpuCount, snapshot.cpuCount);
    existing.memoryRssBytes += snapshot.memoryRssBytes;
    existing.capacityPressure = Math.max(existing.capacityPressure, snapshot.capacityPressure);
    existing.eventLoopDelayP95Ms = Math.max(existing.eventLoopDelayP95Ms, snapshot.eventLoopDelayP95Ms);
    existing.processCpuUtilization = Math.max(existing.processCpuUtilization, snapshot.processCpuUtilization);
    existing.localCcu += snapshot.localCcu;

    if (snapshot.updatedAtMs > existing.latestUpdatedAtMs) {
      existing.latestUpdatedAtMs = snapshot.updatedAtMs;
      existing.region = snapshot.region;
      existing.appName = snapshot.appName;
      existing.systemFreeMemoryBytes = snapshot.systemFreeMemoryBytes;
      existing.systemTotalMemoryBytes = snapshot.systemTotalMemoryBytes;
    }
  }

  return machines;
}

function pickCapacitySource(
  current: MachineOverview['dynamicCapacitySource'],
  next: NonNullable<MachineOverview['dynamicCapacitySource']>
): NonNullable<MachineOverview['dynamicCapacitySource']> {
  const rank = { bootstrap: 0, room_metrics: 1, live: 2 };
  return !current || rank[next] > rank[current] ? next : current;
}

function addFallbackMachineRoomCounts(machines: Map<string, MachineOverview>): void {
  for (const machine of machines.values()) {
    machine.gameRoomCount = machine.processes.reduce((sum, process) => sum + process.localGameRoomCount, 0);
    machine.lobbyRoomCount = machine.processes.reduce((sum, process) => sum + process.localLobbyRoomCount, 0);
    machine.playersInGame = machine.processes.reduce((sum, process) => sum + process.localGamePlayers, 0);
    machine.botsInGame = machine.processes.reduce((sum, process) => sum + process.localGameBots, 0);
    machine.participantsInGame = machine.processes.reduce((sum, process) => sum + process.localGameParticipants, 0);
    machine.lobbyParticipants = machine.processes.reduce((sum, process) => sum + process.localLobbyParticipants, 0);
  }
}

function addGlobalRoomCounts(
  machines: Map<string, MachineOverview>,
  processSnapshots: Map<string, AdminMachineSnapshot>,
  gameRooms: AdminRoomListing[],
  lobbyRooms: AdminRoomListing[]
): void {
  for (const room of gameRooms) {
    const key = groupKeyForRoom(room, processSnapshots);
    const machine = machines.get(key) ?? {
      machineId: key,
      region: null,
      appName: null,
      processCount: 0,
      latestUpdatedAtMs: 0,
      loadAvg1: 0,
      loadPct1: 0,
      cpuCount: 1,
      memoryRssBytes: 0,
      systemFreeMemoryBytes: 0,
      systemTotalMemoryBytes: 0,
      capacityPressure: 0,
      dynamicCapacityPlayers: 0,
      dynamicCapacitySource: null,
      eventLoopDelayP95Ms: 0,
      processCpuUtilization: 0,
      localCcu: 0,
      gameRoomCount: 0,
      lobbyRoomCount: 0,
      playersInGame: 0,
      botsInGame: 0,
      participantsInGame: 0,
      lobbyParticipants: 0,
      processes: [],
    };
    machine.gameRoomCount += 1;
    machine.playersInGame += gameHumanCount(room);
    machine.botsInGame += gameBotCount(room);
    machine.participantsInGame += gameParticipantCount(room);
    machines.set(key, machine);
  }

  for (const room of lobbyRooms) {
    const key = groupKeyForRoom(room, processSnapshots);
    const machine = machines.get(key) ?? {
      machineId: key,
      region: null,
      appName: null,
      processCount: 0,
      latestUpdatedAtMs: 0,
      loadAvg1: 0,
      loadPct1: 0,
      cpuCount: 1,
      memoryRssBytes: 0,
      systemFreeMemoryBytes: 0,
      systemTotalMemoryBytes: 0,
      capacityPressure: 0,
      dynamicCapacityPlayers: 0,
      dynamicCapacitySource: null,
      eventLoopDelayP95Ms: 0,
      processCpuUtilization: 0,
      localCcu: 0,
      gameRoomCount: 0,
      lobbyRoomCount: 0,
      playersInGame: 0,
      botsInGame: 0,
      participantsInGame: 0,
      lobbyParticipants: 0,
      processes: [],
    };
    machine.lobbyRoomCount += 1;
    machine.lobbyParticipants += lobbyParticipantCount(room);
    machines.set(key, machine);
  }
}

function summarizeGameRoom(room: AdminRoomListing, processSnapshots: Map<string, AdminMachineSnapshot>) {
  return {
    roomId: room.roomId ?? '',
    processId: room.processId ?? null,
    machineId: groupKeyForRoom(room, processSnapshots),
    publicAddress: room.publicAddress ?? null,
    clients: roomClientCount(room),
    maxClients: readFiniteNumber(room.maxClients) ?? 0,
    players: gameHumanCount(room),
    bots: gameBotCount(room),
    participants: gameParticipantCount(room),
    phase: roomMetadataString(room, 'phase') ?? roomMetadataString(room, 'status') ?? 'unknown',
    matchMode: roomMetadataString(room, 'matchMode') ?? 'unknown',
    lobbyId: roomMetadataString(room, 'lobbyId'),
  };
}

function summarizeLobbyRoom(room: AdminRoomListing, processSnapshots: Map<string, AdminMachineSnapshot>) {
  return {
    roomId: room.roomId ?? '',
    processId: room.processId ?? null,
    machineId: groupKeyForRoom(room, processSnapshots),
    publicAddress: room.publicAddress ?? null,
    name: roomMetadataString(room, 'name') ?? (room.roomId ? `Lobby ${room.roomId.slice(0, 6)}` : 'Lobby'),
    clients: roomClientCount(room),
    maxClients: readFiniteNumber(room.maxClients) ?? 0,
    participants: lobbyParticipantCount(room),
    humans: readMetadataNumber(room.metadata, 'humanCount') ?? roomClientCount(room),
    bots: readMetadataNumber(room.metadata, 'botCount') ?? 0,
    status: roomMetadataString(room, 'status') ?? 'unknown',
    matchMode: roomMetadataString(room, 'matchMode') ?? 'unknown',
    isPublic: room.metadata?.isPublic !== false,
  };
}

async function collectAdminOverview(options: AdminRouterOptions, adminUser: AdminUser) {
  const generatedAtMs = Date.now();
  const [redis, gameRoomResult, lobbyRoomResult, antiCheat, playerReports, rewardEconomySettings, goldenBiomeRewards, globalNotification, rankedSeason, rankedEntryGate, missions, skinShop, eventBiome, mapPool] = await Promise.all([
    pingRedis(options.redis),
    queryRooms(options.matchMaker, 'game_room'),
    queryRooms(options.matchMaker, 'lobby_room'),
    antiCheatEvidenceStore.listReviewData(),
    listPlayerReportQueue(prisma),
    Promise.all([
      playerRewardService.getSettingsOverview(),
      wagerService.getWagerEconomySettings(),
    ]).then(([playerRewards, wagers]) => ({ playerRewards, wagers })),
    wagerService.getGoldenBiomeAdminOverview(),
    getGlobalNotification(),
    getRankedSeason(),
    getRankedEntryGateSettings(),
    dailyMissionService.getAdminOverview(),
    getSkinShopAdminOverview(),
    getEventBiomeAdminOverview(),
    pregeneratedMapCatalogService.getAdminOverview(),
  ]);

  let machineSnapshots: AdminMachineSnapshot[] = [];
  let machineRegistryError: string | null = null;
  if (options.redis) {
    try {
      machineSnapshots = await listAdminMachineSnapshots(options.redis);
    } catch (error) {
      machineRegistryError = error instanceof Error ? error.message : String(error);
    }
  }

  const localSnapshot = await collectLocalAdminMachineSnapshot({
    matchMaker: options.matchMaker,
    config: options.config,
    flyReplayRegistered: options.flyReplayRegistered(),
  });

  const snapshotsByProcess = new Map<string, AdminMachineSnapshot>();
  for (const snapshot of machineSnapshots) snapshotsByProcess.set(snapshot.processId, snapshot);
  snapshotsByProcess.set(localSnapshot.processId, localSnapshot);

  const freshSnapshots = Array.from(snapshotsByProcess.values())
    .filter((snapshot) => generatedAtMs - snapshot.updatedAtMs < 60_000)
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  const processSnapshots = new Map(freshSnapshots.map((snapshot) => [snapshot.processId, snapshot]));
  const machines = createMachineMap(freshSnapshots);

  if (gameRoomResult.error || lobbyRoomResult.error) {
    addFallbackMachineRoomCounts(machines);
  } else {
    addGlobalRoomCounts(machines, processSnapshots, gameRoomResult.rooms, lobbyRoomResult.rooms);
  }

  const capacity = createInGameCapacitySnapshot(gameRoomResult.rooms, freshSnapshots);
  for (const estimate of capacity.machines) {
    const snapshot = processSnapshots.get(estimate.processId);
    if (!snapshot) continue;
    const machine = machines.get(snapshot.machineId);
    if (!machine) continue;
    machine.dynamicCapacityPlayers += estimate.playersPerMachine;
    machine.dynamicCapacitySource = pickCapacitySource(machine.dynamicCapacitySource, estimate.source);
  }

  const machineList = Array.from(machines.values())
    .map((machine) => ({
      ...machine,
      processes: machine.processes.sort((a, b) => b.updatedAtMs - a.updatedAtMs),
    }))
    .sort((a, b) => b.playersInGame - a.playersInGame || b.localCcu - a.localCcu || a.machineId.localeCompare(b.machineId));

  const gameRooms = gameRoomResult.rooms
    .map((room) => summarizeGameRoom(room, processSnapshots))
    .sort((a, b) => b.players - a.players || a.roomId.localeCompare(b.roomId));
  const lobbyRooms = lobbyRoomResult.rooms
    .map((room) => summarizeLobbyRoom(room, processSnapshots))
    .sort((a, b) => b.participants - a.participants || a.roomId.localeCompare(b.roomId));

  const warnings = [
    gameRoomResult.error ? `game_room query failed: ${gameRoomResult.error}` : null,
    lobbyRoomResult.error ? `lobby_room query failed: ${lobbyRoomResult.error}` : null,
    machineRegistryError ? `machine registry failed: ${machineRegistryError}` : null,
    mapPool.lowSlices.length > 0 ? `pregenerated map pool has ${mapPool.lowSlices.length} low slice${mapPool.lowSlices.length === 1 ? '' : 's'}` : null,
    ...freshSnapshots
      .filter((snapshot) => !snapshot.matchmakerQueryUp && snapshot.matchmakerError)
      .map((snapshot) => `${snapshot.machineId}/${snapshot.processId}: ${snapshot.matchmakerError}`),
  ].filter((warning): warning is string => Boolean(warning));

  const totals = {
    runningMachines: machineList.length,
    serverProcesses: freshSnapshots.length,
    totalConnectedClients: gameRoomResult.rooms.reduce((sum, room) => sum + roomClientCount(room), 0)
      + lobbyRoomResult.rooms.reduce((sum, room) => sum + roomClientCount(room), 0),
    playersInGame: gameRooms.reduce((sum, room) => sum + room.players, 0),
    botsInGame: gameRooms.reduce((sum, room) => sum + room.bots, 0),
    participantsInGame: gameRooms.reduce((sum, room) => sum + room.participants, 0),
    gameRooms: gameRooms.length,
    lobbyRooms: lobbyRooms.length,
    lobbyParticipants: lobbyRooms.reduce((sum, room) => sum + room.participants, 0),
  };
  const gameToken = getGameTokenConfig();
  const rewardEconomy = {
    rewardTokenSymbol: gameToken.mintAddress ? gameToken.symbol : null,
    ...rewardEconomySettings,
  };

  return {
    generatedAt: new Date(generatedAtMs).toISOString(),
    status: warnings.length === 0 && redis.ok ? 'ok' : 'degraded',
    admin: {
      userId: adminUser.id,
      name: adminUser.name,
      walletAddress: adminUser.walletAddress,
      elevatedAntiCheatRole: adminUser.elevatedAntiCheatRole,
      csrfToken: createAdminCsrfToken(adminUser, generatedAtMs),
    },
    totals,
    capacity,
    machines: machineList,
    rooms: {
      game: gameRooms,
      lobbies: lobbyRooms,
    },
    diagnostics: {
      distributed: options.config.distributed,
      routingStrategy: options.config.routingStrategy,
      roomCreateStrategy: options.config.roomCreateStrategy,
      redis,
      flyReplay: {
        enabled: options.config.flyReplay.enabled,
        registered: options.flyReplayRegistered(),
        appName: options.config.flyReplay.appName ?? null,
        machineId: options.config.flyReplay.machineId ?? null,
        region: options.config.flyReplay.region ?? null,
      },
      localProcessId: options.matchMaker.processId ?? null,
      warnings,
    },
    gameToken,
    antiCheat,
    playerReports,
    rewardEconomy,
    goldenBiomeRewards,
    globalNotification,
    rankedSeason: rankedSeason satisfies AdminRankedSeason,
    rankedEntryGate: rankedEntryGate satisfies AdminRankedEntryGate,
    missions: missions satisfies AdminMissions,
    skinShop: skinShop satisfies AdminSkinShop,
    eventBiome,
    mapPool,
  };
}

function sendAdminMutationError(res: Response, error: unknown): void {
  if (error instanceof MissionValidationError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  if (error instanceof SkinShopServiceError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
}

export function createAdminRouter(options: AdminRouterOptions): Router {
  const router: Router = Router();

  router.get('/api/overview', ensureAdmin, async (_req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;
    try {
      res.json(await collectAdminOverview(options, adminUser));
    } catch (error) {
      loggers.room.error('Failed to collect admin overview', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'Failed to collect admin overview' });
    }
  });

  router.get('/api/missions', ensureAdmin, async (_req, res) => {
    noStore(res);
    try {
      res.json(await dailyMissionService.getAdminOverview());
    } catch (error) {
      loggers.room.error('Failed to collect mission overview', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'Failed to collect mission overview' });
    }
  });

  router.post('/api/map-pool/top-up', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    try {
      const options = parseAdminMapPoolTopUpOptions(req.body);
      const result = await pregeneratedMapCatalogService.topUpPool(options);
      const mapPool = await pregeneratedMapCatalogService.getAdminOverview();
      res.json({ ok: true, result, mapPool });
    } catch (error) {
      sendAdminMutationError(res, error);
    }
  });

  router.post('/api/missions', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;
    try {
      const mission = await dailyMissionService.createMission(req.body, adminUser.id);
      res.json({ ok: true, mission });
    } catch (error) {
      sendAdminMutationError(res, error);
    }
  });

  router.post('/api/missions/reorder', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;
    try {
      const missions = await dailyMissionService.reorderMissions(req.body, adminUser.id);
      res.json({ ok: true, missions });
    } catch (error) {
      sendAdminMutationError(res, error);
    }
  });

  router.post('/api/missions/:missionId', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;
    try {
      const mission = await dailyMissionService.updateMission(req.params.missionId, req.body, adminUser.id);
      res.json({ ok: true, mission });
    } catch (error) {
      sendAdminMutationError(res, error);
    }
  });

  router.post('/api/missions/:missionId/archive', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;
    try {
      const mission = await dailyMissionService.archiveMission(req.params.missionId, adminUser.id);
      res.json({ ok: true, mission });
    } catch (error) {
      sendAdminMutationError(res, error);
    }
  });

  router.post('/api/missions/:missionId/duplicate', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;
    try {
      const mission = await dailyMissionService.duplicateMission(req.params.missionId, adminUser.id);
      res.json({ ok: true, mission });
    } catch (error) {
      sendAdminMutationError(res, error);
    }
  });

  router.get('/api/anti-cheat/overview', ensureAdmin, async (_req, res) => {
    noStore(res);
    try {
      res.json(await antiCheatEvidenceStore.listReviewData());
    } catch (error) {
      loggers.room.error('Failed to collect anti-cheat overview', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'Failed to collect anti-cheat overview' });
    }
  });

  router.get('/api/users', ensureAdmin, async (req, res) => {
    noStore(res);
    const query = readQueryString(req.query.query, 128);
    const limit = readAdminRankUserLimit(req.query.limit);
    const page = readAdminRankUserPage(req.query.page);

    try {
      const result = await listAdminRankUsers(query, page, limit);
      res.json({
        query,
        ratingBounds: {
          min: 0,
          max: ADMIN_MANUAL_RATING_MAX,
          default: DEFAULT_COMPETITIVE_RATING,
        },
        rankOptions: rankDivisionOptions(),
        ...result,
      });
    } catch (error) {
      loggers.room.error('Failed to list admin users', {
        query,
        page,
        limit,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'Failed to list users' });
    }
  });

  router.post('/api/users/:userId/rank', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;
    const competitiveRating = readManualRating(req.body?.competitiveRating);
    if (competitiveRating === null) {
      res.status(400).json({ error: `Rating must be between 0 and ${ADMIN_MANUAL_RATING_MAX}` });
      return;
    }

    const reason = readRequestString(req.body?.reason, 500) || 'Manual rank adjustment';

    try {
      const existing = await prisma.user.findUnique({
        where: { id: req.params.userId },
        select: adminRankUserSelect,
      });
      if (!existing) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const previousRank = getRankFromRating(existing.competitiveRating, existing.rankedGames);
      const nextRank = getRankFromRating(competitiveRating, existing.rankedGames);
      const rankedPeakRating = Math.max(existing.rankedPeakRating, competitiveRating);

      const updated = await prisma.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id: existing.id },
          data: {
            competitiveRating,
            rankedPeakRating,
          },
          select: adminRankUserSelect,
        });

        await tx.antiCheatAction.create({
          data: {
            actionType: 'manual_rank_adjustment',
            userId: existing.id,
            actorUserId: adminUser.id,
            reason,
            details: prismaJson({
              targetUserName: existing.name,
              targetWalletAddress: existing.walletAddress,
              ratingBefore: existing.competitiveRating,
              ratingAfter: competitiveRating,
              rankBefore: previousRank.label,
              rankAfter: nextRank.label,
              rankedGames: existing.rankedGames,
              rankedPeakRatingBefore: existing.rankedPeakRating,
              rankedPeakRatingAfter: rankedPeakRating,
            }),
            observedOnly: false,
            evidenceEventIds: [],
          },
        });

        return user;
      });

      res.json({ ok: true, user: serializeAdminRankUser(updated) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/golden-biome/distribution-mode', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;
    const mode = readRequestString(req.body?.mode, 16);
    if (mode !== 'manual' && mode !== 'auto') {
      res.status(400).json({ error: 'Invalid golden biome reward distribution mode' });
      return;
    }

    try {
      const distributionMode = await wagerService.setGoldenBiomeRewardDistributionMode(mode, adminUser.id);
      res.json({ ok: true, distributionMode });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/reward-economy', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;
    const body = req.body && typeof req.body === 'object' ? req.body as {
      playerRewards?: Record<string, unknown>;
      wagers?: Record<string, unknown>;
      goldenBiome?: Record<string, unknown>;
    } : {};

    try {
      const [playerRewards, wagers, goldenBiome] = await Promise.all([
        playerRewardService.updateSettings(
          body.playerRewards && typeof body.playerRewards === 'object' ? body.playerRewards : {},
          adminUser.id
        ),
        wagerService.updateWagerEconomySettings(
          body.wagers && typeof body.wagers === 'object' ? body.wagers : {},
          adminUser.id
        ),
        wagerService.updateGoldenBiomeSettings(
          body.goldenBiome && typeof body.goldenBiome === 'object' ? body.goldenBiome : {},
          adminUser.id
        ),
      ]);
      res.json({ ok: true, rewardEconomy: { playerRewards, wagers }, goldenBiome });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/reward-economy/season-top-10', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;

    try {
      const payout = await playerRewardService.settleSeasonTopTenRewards({
        amountLamports: req.body?.amountLamports,
        mode: req.body?.mode,
        seasonNumber: req.body?.seasonNumber,
        updatedByUserId: adminUser.id,
      });
      res.json({ ok: true, payout });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/golden-biome/rewards/:rewardId/distribute', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;

    try {
      const reward = await wagerService.distributeGoldenBiomeReward(req.params.rewardId, adminUser.id);
      res.json({ ok: true, reward });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/global-notification', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;
    const message = readRequestString(req.body?.message, GLOBAL_NOTIFICATION_MAX_MESSAGE_LENGTH);

    if (!message) {
      res.status(400).json({ error: 'Notification message is required' });
      return;
    }

    try {
      const notification = await setGlobalNotification(message, adminUser.id);
      res.json({ ok: true, notification });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/global-notification/remove', ensureAdmin, ensureAdminMutation, async (_req, res) => {
    noStore(res);

    try {
      await removeGlobalNotification();
      res.json({ ok: true, notification: null });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/ranked-season', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;

    try {
      const result = await setRankedSeason({
        mode: req.body?.mode,
        seasonNumber: req.body?.seasonNumber,
        endsAt: req.body?.endsAt ?? null,
      }, adminUser.id);

      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/ranked-entry-gate', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;

    try {
      const rankedEntryGate = await setRankedEntryGateSettings({
        mode: req.body?.mode,
        requiredTokenAmount: req.body?.requiredTokenAmount,
      }, adminUser.id);

      res.json({ ok: true, rankedEntryGate });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/skin-shop/settings', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;

    try {
      const shop = await updateSkinShopSettings({
        enabled: req.body?.enabled,
        updatedByUserId: adminUser.id,
      });
      res.json({ ok: true, shop });
    } catch (error) {
      sendAdminMutationError(res, error);
    }
  });

  router.post('/api/event-biome', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;

    try {
      const eventBiome = await setEventBiomeSettings({
        enabled: req.body?.enabled === true,
        updatedByUserId: adminUser.id,
      });
      res.json({ ok: true, eventBiome });
    } catch (error) {
      sendAdminMutationError(res, error);
    }
  });

  router.post('/api/skin-shop/items/:skinId', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;
    const skinId = parseSkinIdInput(req.params.skinId);
    if (!skinId) {
      res.status(400).json({ error: 'Invalid skin id' });
      return;
    }

    try {
      const settings = await updateSkinShopItemSettings({
        skinId,
        saleEnabled: req.body?.saleEnabled,
        tokenAmount: req.body?.tokenAmount,
        maxSupply: req.body?.maxSupply,
        expectedPriceVersion: req.body?.expectedPriceVersion,
        updatedByUserId: adminUser.id,
      });
      res.json({ ok: true, settings });
    } catch (error) {
      sendAdminMutationError(res, error);
    }
  });

  router.post('/api/player-reports/:reportId/status', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;
    const status = req.body?.status;
    if (!isPlayerReportStatus(status)) {
      res.status(400).json({ error: 'Invalid report status' });
      return;
    }

    const note = readRequestString(req.body?.note, 800);
    try {
      await prisma.playerReport.update({
        where: { id: req.params.reportId },
        data: createPlayerReportUpdate({
          status,
          actorUserId: adminUser.id,
          resolution: buildPlayerReportResolution({
            status,
            actorName: adminUser.name,
            note,
          }),
        }),
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/player-reports/:reportId/account-actions', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;
    const actionType = readRequestString(req.body?.actionType, 64) as AntiCheatAccountActionType;
    if (!['suspension', 'ban', 'lift_suspension', 'lift_ban'].includes(actionType)) {
      res.status(400).json({ error: 'Invalid account action type' });
      return;
    }

    const reason = readRequestString(req.body?.reason, 800);
    if (!reason) {
      res.status(400).json({ error: 'Reason is required' });
      return;
    }

    const expiresAtRaw = readRequestString(req.body?.expiresAt, 64);
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
    if (expiresAtRaw && Number.isNaN(expiresAt?.getTime())) {
      res.status(400).json({ error: 'Invalid expiration' });
      return;
    }

    try {
      const report = await prisma.playerReport.findUniqueOrThrow({
        where: { id: req.params.reportId },
      });
      if (!report.targetUserId) {
        res.status(400).json({ error: 'Report target has no linked account for account actions' });
        return;
      }

      const accountActionId = await antiCheatEvidenceStore.createAccountAction({
        actorUserId: adminUser.id,
        targetUserId: report.targetUserId,
        actionType,
        reason,
        evidenceCaseId: null,
        evidenceEventIds: report.evidenceEventId ? [report.evidenceEventId] : [],
        expiresAt,
        elevated: adminUser.elevatedAntiCheatRole,
      });

      await prisma.playerReport.update({
        where: { id: report.id },
        data: {
          status: 'actioned',
          resolvedByUserId: adminUser.id,
          resolvedAt: new Date(),
          resolution: buildReportActionResolution({
            actionType,
            actorName: adminUser.name,
            reason,
          }),
          actionType,
          accountActionId,
        },
      });

      res.json({ ok: true, accountActionId });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/anti-cheat/cases/:caseId', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;
    const status = req.body?.status;
    const allowedStatuses = new Set(['open', 'investigating', 'resolved', 'false_positive', 'escalated']);
    if (status !== undefined && !allowedStatuses.has(status)) {
      res.status(400).json({ error: 'Invalid case status' });
      return;
    }

    try {
      await antiCheatEvidenceStore.updateCase({
        caseId: req.params.caseId,
        actorUserId: adminUser.id,
        status: status as AntiCheatCaseStatus | undefined,
        note: readRequestString(req.body?.note),
        resolution: readRequestString(req.body?.resolution),
        falsePositive: status === 'false_positive' ? true : undefined,
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/anti-cheat/ranked/:matchId/apply', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;
    const reason = readRequestString(req.body?.reason);
    if (!reason) {
      res.status(400).json({ error: 'Reason is required' });
      return;
    }
    try {
      await applyHeldRankedOutcome(prisma, {
        matchId: req.params.matchId,
        actorUserId: adminUser.id,
        reason,
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/anti-cheat/ranked/:matchId/cancel', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;
    const reason = readRequestString(req.body?.reason);
    if (!reason) {
      res.status(400).json({ error: 'Reason is required' });
      return;
    }
    try {
      await cancelHeldRankedOutcome(prisma, {
        matchId: req.params.matchId,
        actorUserId: adminUser.id,
        reason,
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/anti-cheat/account-actions', ensureAdmin, ensureAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as AdminUser;
    const actionType = readRequestString(req.body?.actionType, 64) as AntiCheatAccountActionType;
    if (!['suspension', 'ban', 'lift_suspension', 'lift_ban'].includes(actionType)) {
      res.status(400).json({ error: 'Invalid account action type' });
      return;
    }
    const expiresAtRaw = readRequestString(req.body?.expiresAt, 64);
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
    if (expiresAtRaw && Number.isNaN(expiresAt?.getTime())) {
      res.status(400).json({ error: 'Invalid expiration' });
      return;
    }

    try {
      await antiCheatEvidenceStore.createAccountAction({
        actorUserId: adminUser.id,
        targetUserId: readRequestString(req.body?.targetUserId, 128),
        actionType,
        reason: readRequestString(req.body?.reason),
        evidenceCaseId: readRequestString(req.body?.evidenceCaseId, 128) || null,
        evidenceEventIds: readEvidenceEventIds(req.body?.evidenceEventIds),
        expiresAt,
        elevated: adminUser.elevatedAntiCheatRole,
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

export default createAdminRouter;
