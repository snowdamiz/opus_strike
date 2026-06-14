import { randomUUID } from 'node:crypto';
import * as os from 'node:os';
import type { ColyseusRuntimeConfig } from '../config/colyseus';
import { loggers } from '../utils/logger';
import { processLoadSampler, type ProcessLoadSnapshot } from '../runtime/processLoad';

const ADMIN_MACHINE_KEY_PREFIX = 'voxel-strike:admin:machine:';
const DEFAULT_HEARTBEAT_TTL_MS = 45_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

const UPSERT_MACHINE_SNAPSHOT_SCRIPT = `
for i = 1, #ARGV - 1, 2 do
  redis.call("HSET", KEYS[1], ARGV[i], ARGV[i + 1])
end
redis.call("PEXPIRE", KEYS[1], ARGV[#ARGV])
return 1
`;

const DELETE_MACHINE_SNAPSHOT_IF_OWNER_SCRIPT = `
if redis.call("HGET", KEYS[1], "ownerToken") == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export interface AdminMachineRedisClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  scan(cursor: string | number, ...args: unknown[]): Promise<[string, string[]]>;
}

export interface AdminRoomListing {
  clients?: number;
  maxClients?: number;
  metadata?: Record<string, unknown> | null;
  name?: string;
  processId?: string;
  publicAddress?: string;
  roomId?: string;
}

export interface AdminMatchMaker {
  processId?: string;
  stats: {
    local: {
      roomCount: number;
      ccu: number;
    };
  };
  query(criteria: { name: string }): Promise<AdminRoomListing[]>;
}

export interface AdminMachineSnapshot {
  processId: string;
  machineId: string;
  appName: string | null;
  region: string | null;
  publicAddress: string | null;
  pid: number;
  updatedAtMs: number;
  startedAtMs: number;
  nodeEnv: string;
  flyReplayRegistered: boolean;
  loadAvg1: number;
  loadAvg5: number;
  loadAvg15: number;
  cpuCount: number;
  loadPct1: number;
  memoryRssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  processCpuUtilization: number;
  eventLoopDelayP95Ms: number;
  eventLoopDelayP99Ms: number;
  heapUsedRatio: number;
  systemMemoryUsedRatio: number;
  capacityPressure: number;
  systemFreeMemoryBytes: number;
  systemTotalMemoryBytes: number;
  processUptimeSeconds: number;
  osUptimeSeconds: number;
  localCcu: number;
  localRoomCount: number;
  localGameRoomCount: number;
  localLobbyRoomCount: number;
  localGamePlayers: number;
  localGameBots: number;
  localGameParticipants: number;
  localLobbyParticipants: number;
  matchmakerQueryUp: boolean;
  matchmakerError: string | null;
}

export interface AdminMachineHeartbeatHandle {
  refresh(): Promise<void>;
  close(): Promise<void>;
}

interface LocalSnapshotOptions {
  matchMaker: AdminMatchMaker;
  config: ColyseusRuntimeConfig;
  flyReplayRegistered: boolean;
  now?: () => number;
  memoryUsage?: () => NodeJS.MemoryUsage;
  uptime?: () => number;
  processLoad?: () => ProcessLoadSnapshot;
}

interface StartHeartbeatOptions extends Omit<LocalSnapshotOptions, 'flyReplayRegistered'> {
  redis: AdminMachineRedisClient;
  flyReplayRegistered: () => boolean;
  intervalMs?: number;
  ttlMs?: number;
}

function machineKey(processId: string): string {
  return `${ADMIN_MACHINE_KEY_PREFIX}${processId}`;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
  }
  return null;
}

function readString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readBoolean(value: string | undefined): boolean {
  return value === '1' || value === 'true';
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

function ownsRoom(room: AdminRoomListing, localProcessId: string): boolean {
  return !room.processId || room.processId === localProcessId;
}

async function queryLocalRooms(
  matchMaker: AdminMatchMaker,
  roomName: string,
  localProcessId: string
): Promise<AdminRoomListing[]> {
  const rooms = await matchMaker.query({ name: roomName });
  return rooms.filter((room) => ownsRoom(room, localProcessId));
}

function serializeSnapshot(snapshot: AdminMachineSnapshot, ownerToken: string): Record<string, string> {
  return {
    processId: snapshot.processId,
    machineId: snapshot.machineId,
    appName: snapshot.appName ?? '',
    region: snapshot.region ?? '',
    publicAddress: snapshot.publicAddress ?? '',
    pid: String(snapshot.pid),
    updatedAtMs: String(snapshot.updatedAtMs),
    startedAtMs: String(snapshot.startedAtMs),
    nodeEnv: snapshot.nodeEnv,
    flyReplayRegistered: snapshot.flyReplayRegistered ? '1' : '0',
    loadAvg1: String(snapshot.loadAvg1),
    loadAvg5: String(snapshot.loadAvg5),
    loadAvg15: String(snapshot.loadAvg15),
    cpuCount: String(snapshot.cpuCount),
    loadPct1: String(snapshot.loadPct1),
    memoryRssBytes: String(snapshot.memoryRssBytes),
    heapUsedBytes: String(snapshot.heapUsedBytes),
    heapTotalBytes: String(snapshot.heapTotalBytes),
    processCpuUtilization: String(snapshot.processCpuUtilization),
    eventLoopDelayP95Ms: String(snapshot.eventLoopDelayP95Ms),
    eventLoopDelayP99Ms: String(snapshot.eventLoopDelayP99Ms),
    heapUsedRatio: String(snapshot.heapUsedRatio),
    systemMemoryUsedRatio: String(snapshot.systemMemoryUsedRatio),
    capacityPressure: String(snapshot.capacityPressure),
    systemFreeMemoryBytes: String(snapshot.systemFreeMemoryBytes),
    systemTotalMemoryBytes: String(snapshot.systemTotalMemoryBytes),
    processUptimeSeconds: String(snapshot.processUptimeSeconds),
    osUptimeSeconds: String(snapshot.osUptimeSeconds),
    localCcu: String(snapshot.localCcu),
    localRoomCount: String(snapshot.localRoomCount),
    localGameRoomCount: String(snapshot.localGameRoomCount),
    localLobbyRoomCount: String(snapshot.localLobbyRoomCount),
    localGamePlayers: String(snapshot.localGamePlayers),
    localGameBots: String(snapshot.localGameBots),
    localGameParticipants: String(snapshot.localGameParticipants),
    localLobbyParticipants: String(snapshot.localLobbyParticipants),
    matchmakerQueryUp: snapshot.matchmakerQueryUp ? '1' : '0',
    matchmakerError: snapshot.matchmakerError ?? '',
    ownerToken,
  };
}

function parseSnapshot(fields: Record<string, string>): AdminMachineSnapshot | null {
  const processId = readString(fields.processId);
  const machineId = readString(fields.machineId);
  if (!processId || !machineId) return null;

  return {
    processId,
    machineId,
    appName: readString(fields.appName),
    region: readString(fields.region),
    publicAddress: readString(fields.publicAddress),
    pid: readFiniteNumber(fields.pid) ?? 0,
    updatedAtMs: readFiniteNumber(fields.updatedAtMs) ?? 0,
    startedAtMs: readFiniteNumber(fields.startedAtMs) ?? 0,
    nodeEnv: fields.nodeEnv || 'unknown',
    flyReplayRegistered: readBoolean(fields.flyReplayRegistered),
    loadAvg1: readFiniteNumber(fields.loadAvg1) ?? 0,
    loadAvg5: readFiniteNumber(fields.loadAvg5) ?? 0,
    loadAvg15: readFiniteNumber(fields.loadAvg15) ?? 0,
    cpuCount: readFiniteNumber(fields.cpuCount) ?? 1,
    loadPct1: readFiniteNumber(fields.loadPct1) ?? 0,
    memoryRssBytes: readFiniteNumber(fields.memoryRssBytes) ?? 0,
    heapUsedBytes: readFiniteNumber(fields.heapUsedBytes) ?? 0,
    heapTotalBytes: readFiniteNumber(fields.heapTotalBytes) ?? 0,
    processCpuUtilization: readFiniteNumber(fields.processCpuUtilization) ?? 0,
    eventLoopDelayP95Ms: readFiniteNumber(fields.eventLoopDelayP95Ms) ?? 0,
    eventLoopDelayP99Ms: readFiniteNumber(fields.eventLoopDelayP99Ms) ?? 0,
    heapUsedRatio: readFiniteNumber(fields.heapUsedRatio) ?? 0,
    systemMemoryUsedRatio: readFiniteNumber(fields.systemMemoryUsedRatio) ?? 0,
    capacityPressure: readFiniteNumber(fields.capacityPressure) ?? 0,
    systemFreeMemoryBytes: readFiniteNumber(fields.systemFreeMemoryBytes) ?? 0,
    systemTotalMemoryBytes: readFiniteNumber(fields.systemTotalMemoryBytes) ?? 0,
    processUptimeSeconds: readFiniteNumber(fields.processUptimeSeconds) ?? 0,
    osUptimeSeconds: readFiniteNumber(fields.osUptimeSeconds) ?? 0,
    localCcu: readFiniteNumber(fields.localCcu) ?? 0,
    localRoomCount: readFiniteNumber(fields.localRoomCount) ?? 0,
    localGameRoomCount: readFiniteNumber(fields.localGameRoomCount) ?? 0,
    localLobbyRoomCount: readFiniteNumber(fields.localLobbyRoomCount) ?? 0,
    localGamePlayers: readFiniteNumber(fields.localGamePlayers) ?? 0,
    localGameBots: readFiniteNumber(fields.localGameBots) ?? 0,
    localGameParticipants: readFiniteNumber(fields.localGameParticipants) ?? 0,
    localLobbyParticipants: readFiniteNumber(fields.localLobbyParticipants) ?? 0,
    matchmakerQueryUp: readBoolean(fields.matchmakerQueryUp),
    matchmakerError: readString(fields.matchmakerError),
  };
}

async function scanMachineKeys(redis: AdminMachineRedisClient): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';

  do {
    const [nextCursor, batch] = await redis.scan(
      cursor,
      'MATCH',
      `${ADMIN_MACHINE_KEY_PREFIX}*`,
      'COUNT',
      '100'
    );
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');

  return keys;
}

export async function collectLocalAdminMachineSnapshot(
  options: LocalSnapshotOptions
): Promise<AdminMachineSnapshot> {
  const now = options.now ?? (() => Date.now());
  const memoryUsage = options.memoryUsage ?? (() => process.memoryUsage());
  const uptime = options.uptime ?? (() => process.uptime());
  const processLoad = (options.processLoad ?? (() => processLoadSampler.getSnapshot()))();
  const processId = options.matchMaker.processId || `pid:${process.pid}`;
  const machineId = options.config.flyReplay.machineId || process.env.FLY_MACHINE_ID || os.hostname() || processId;
  const cpuCount = Math.max(1, os.cpus().length);
  const [loadAvg1 = 0, loadAvg5 = 0, loadAvg15 = 0] = os.loadavg();

  let gameRooms: AdminRoomListing[] = [];
  let lobbyRooms: AdminRoomListing[] = [];
  let matchmakerQueryUp = true;
  let matchmakerError: string | null = null;

  try {
    [gameRooms, lobbyRooms] = await Promise.all([
      queryLocalRooms(options.matchMaker, 'game_room', processId),
      queryLocalRooms(options.matchMaker, 'lobby_room', processId),
    ]);
  } catch (error) {
    matchmakerQueryUp = false;
    matchmakerError = error instanceof Error ? error.message : String(error);
  }

  const memory = memoryUsage();
  const localGamePlayers = gameRooms.reduce((sum, room) => sum + gameHumanCount(room), 0);
  const localGameBots = gameRooms.reduce((sum, room) => sum + gameBotCount(room), 0);

  return {
    processId,
    machineId,
    appName: options.config.flyReplay.appName ?? process.env.FLY_APP_NAME ?? null,
    region: options.config.flyReplay.region ?? process.env.FLY_REGION ?? null,
    publicAddress: options.config.publicAddress ?? null,
    pid: process.pid,
    updatedAtMs: now(),
    startedAtMs: Math.max(0, now() - uptime() * 1000),
    nodeEnv: options.config.nodeEnv,
    flyReplayRegistered: options.flyReplayRegistered,
    loadAvg1,
    loadAvg5,
    loadAvg15,
    cpuCount,
    loadPct1: Math.min(999, (loadAvg1 / cpuCount) * 100),
    memoryRssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    processCpuUtilization: processLoad.processCpuUtilization,
    eventLoopDelayP95Ms: processLoad.eventLoopDelayP95Ms,
    eventLoopDelayP99Ms: processLoad.eventLoopDelayP99Ms,
    heapUsedRatio: processLoad.heapUsedRatio,
    systemMemoryUsedRatio: processLoad.systemMemoryUsedRatio,
    capacityPressure: processLoad.capacityPressure,
    systemFreeMemoryBytes: os.freemem(),
    systemTotalMemoryBytes: os.totalmem(),
    processUptimeSeconds: uptime(),
    osUptimeSeconds: os.uptime(),
    localCcu: readFiniteNumber(options.matchMaker.stats.local.ccu) ?? 0,
    localRoomCount: readFiniteNumber(options.matchMaker.stats.local.roomCount) ?? 0,
    localGameRoomCount: gameRooms.length,
    localLobbyRoomCount: lobbyRooms.length,
    localGamePlayers,
    localGameBots,
    localGameParticipants: localGamePlayers + localGameBots,
    localLobbyParticipants: lobbyRooms.reduce((sum, room) => sum + lobbyParticipantCount(room), 0),
    matchmakerQueryUp,
    matchmakerError,
  };
}

export async function listAdminMachineSnapshots(
  redis: AdminMachineRedisClient
): Promise<AdminMachineSnapshot[]> {
  const keys = await scanMachineKeys(redis);
  const snapshots = await Promise.all(
    keys.map(async (key) => parseSnapshot(await redis.hgetall(key)))
  );

  return snapshots
    .filter((snapshot): snapshot is AdminMachineSnapshot => snapshot !== null)
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export function startAdminMachineHeartbeat(options: StartHeartbeatOptions): AdminMachineHeartbeatHandle {
  const ownerToken = `${process.pid}:${randomUUID()}`;
  const ttlMs = options.ttlMs ?? DEFAULT_HEARTBEAT_TTL_MS;
  const intervalMs = Math.min(
    options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    Math.max(1_000, Math.floor(ttlMs / 2))
  );
  let closed = false;

  const refresh = async (): Promise<void> => {
    if (closed) return;

    const snapshot = await collectLocalAdminMachineSnapshot({
      matchMaker: options.matchMaker,
      config: options.config,
      flyReplayRegistered: options.flyReplayRegistered(),
      now: options.now,
      memoryUsage: options.memoryUsage,
      uptime: options.uptime,
      processLoad: options.processLoad,
    });
    const fields = serializeSnapshot(snapshot, ownerToken);
    const args = Object.entries(fields).flatMap(([key, value]) => [key, value]);

    await options.redis.eval(
      UPSERT_MACHINE_SNAPSHOT_SCRIPT,
      1,
      machineKey(snapshot.processId),
      ...args,
      String(ttlMs)
    );
  };

  void refresh().catch((error) => {
    loggers.room.warn('Failed to publish admin machine heartbeat', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const interval = setInterval(() => {
    void refresh().catch((error) => {
      loggers.room.warn('Failed to refresh admin machine heartbeat', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);
  interval.unref?.();

  return {
    refresh,
    close: async () => {
      closed = true;
      clearInterval(interval);
      const processId = options.matchMaker.processId || `pid:${process.pid}`;
      await options.redis.eval(
        DELETE_MACHINE_SNAPSHOT_IF_OWNER_SCRIPT,
        1,
        machineKey(processId),
        ownerToken
      ).catch((error) => {
        loggers.room.warn('Failed to remove admin machine heartbeat', {
          processId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
  };
}
