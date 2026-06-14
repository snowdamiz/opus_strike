import { createServerLoadCapacitySnapshot } from '../capacity/serverLoadCapacity';
import { processLoadSampler, type ProcessLoadSnapshot } from '../runtime/processLoad';

export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

export interface RedisHealthSnapshot {
  ok: boolean;
  status: string;
  error?: string;
}

export interface AutoscalerRoomListing {
  clients?: number;
  metadata?: Record<string, unknown> | null;
  processId?: string;
}

export interface AutoscalerMatchMaker {
  processId?: string;
  stats: {
    local: {
      roomCount: number;
      ccu: number;
    };
  };
  query(criteria: { name: string }): Promise<AutoscalerRoomListing[]>;
}

export interface AutoscalerMetricSnapshot {
  localCcu: number;
  localRoomCount: number;
  lobbyParticipants: number;
  visibleLobbyCount: number;
  flyReplayRegistered: number;
  redisUp: number;
  matchmakerQueryUp: number;
  processUptimeSeconds: number;
  processHeapUsedBytes: number;
  processCpuUtilization: number;
  processLoadPct1: number;
  processEventLoopDelayP95Ms: number;
  processEventLoopDelayP99Ms: number;
  processHeapUsedRatio: number;
  processSystemMemoryUsedRatio: number;
  dynamicCapacityPressure: number;
  dynamicCapacityPlayersPerMachine: number;
  matchmakerError?: string;
  labels: AutoscalerMetricLabels;
}

export interface AutoscalerMetricLabels {
  colyseusProcessId?: string;
  flyMachineId?: string;
  flyRegion?: string;
}

interface CollectAutoscalerMetricSnapshotOptions {
  matchMaker: AutoscalerMatchMaker;
  redisStatus: RedisHealthSnapshot;
  flyReplayRegistered: boolean;
  labels?: AutoscalerMetricLabels;
  uptime?: () => number;
  memoryUsage?: () => NodeJS.MemoryUsage;
  processLoad?: () => ProcessLoadSnapshot;
}

interface GaugeDefinition {
  name: string;
  help: string;
  value: number;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value);
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
  }

  return null;
}

function readMetadataNumber(metadata: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!metadata) return null;
  return readFiniteNumber(metadata[key]);
}

function readRoomClientCount(room: AutoscalerRoomListing): number {
  return readFiniteNumber(room.clients) ?? 0;
}

function readLobbyParticipantCount(room: AutoscalerRoomListing): number {
  const metadata = room.metadata;
  const participantCount = readMetadataNumber(metadata, 'participantCount');
  if (participantCount !== null) return participantCount;

  const humanCount = readMetadataNumber(metadata, 'humanCount');
  const botCount = readMetadataNumber(metadata, 'botCount');
  if (humanCount !== null || botCount !== null) {
    return (humanCount ?? 0) + (botCount ?? 0);
  }

  return readRoomClientCount(room);
}

function isVisibleLobby(room: AutoscalerRoomListing): boolean {
  return room.metadata?.isPublic !== false;
}

function ownsRoom(room: AutoscalerRoomListing, localProcessId: string | undefined): boolean {
  return !room.processId || !localProcessId || room.processId === localProcessId;
}

function readGameHumanCount(room: AutoscalerRoomListing): number {
  return readMetadataNumber(room.metadata, 'humanCount') ?? readRoomClientCount(room);
}

function formatMetricValue(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : String(value);
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function formatMetricLabels(labels: AutoscalerMetricLabels): string {
  const entries = [
    ['colyseus_process_id', labels.colyseusProcessId],
    ['fly_machine_id', labels.flyMachineId],
    ['fly_region', labels.flyRegion],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  if (entries.length === 0) return '';

  return `{${entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(',')}}`;
}

function getGaugeDefinitions(snapshot: AutoscalerMetricSnapshot): GaugeDefinition[] {
  return [
    {
      name: 'opus_strike_colyseus_local_ccu',
      help: 'Connected Colyseus clients on this server process.',
      value: snapshot.localCcu,
    },
    {
      name: 'opus_strike_colyseus_local_room_count',
      help: 'Colyseus rooms owned by this server process.',
      value: snapshot.localRoomCount,
    },
    {
      name: 'opus_strike_lobby_participants',
      help: 'Participants represented by lobby room metadata on this server scrape.',
      value: snapshot.lobbyParticipants,
    },
    {
      name: 'opus_strike_visible_lobby_count',
      help: 'Public lobby rooms visible through lobby metadata.',
      value: snapshot.visibleLobbyCount,
    },
    {
      name: 'opus_strike_fly_replay_registered',
      help: 'Whether this process has registered its Fly Replay route in Redis.',
      value: snapshot.flyReplayRegistered,
    },
    {
      name: 'opus_strike_redis_up',
      help: 'Whether the server Redis dependency responded successfully.',
      value: snapshot.redisUp,
    },
    {
      name: 'opus_strike_matchmaker_query_up',
      help: 'Whether the server could query Colyseus room listings for autoscaler metrics.',
      value: snapshot.matchmakerQueryUp,
    },
    {
      name: 'opus_strike_process_uptime_seconds',
      help: 'Server process uptime in seconds.',
      value: snapshot.processUptimeSeconds,
    },
    {
      name: 'opus_strike_process_heap_used_bytes',
      help: 'Node.js heap bytes currently used by the server process.',
      value: snapshot.processHeapUsedBytes,
    },
    {
      name: 'opus_strike_process_cpu_utilization',
      help: 'Recent process CPU utilization normalized to available CPU count.',
      value: snapshot.processCpuUtilization,
    },
    {
      name: 'opus_strike_process_load_pct_1',
      help: 'One minute load average normalized to available CPU count.',
      value: snapshot.processLoadPct1,
    },
    {
      name: 'opus_strike_process_event_loop_delay_p95_ms',
      help: 'Recent p95 event loop delay in milliseconds.',
      value: snapshot.processEventLoopDelayP95Ms,
    },
    {
      name: 'opus_strike_process_event_loop_delay_p99_ms',
      help: 'Recent p99 event loop delay in milliseconds.',
      value: snapshot.processEventLoopDelayP99Ms,
    },
    {
      name: 'opus_strike_process_heap_used_ratio',
      help: 'Node.js heap used ratio against the current heap size limit.',
      value: snapshot.processHeapUsedRatio,
    },
    {
      name: 'opus_strike_process_system_memory_used_ratio',
      help: 'System memory used ratio visible to the server process.',
      value: snapshot.processSystemMemoryUsedRatio,
    },
    {
      name: 'opus_strike_dynamic_capacity_pressure',
      help: 'Capacity pressure score from CPU, event loop, heap, memory, and load. Values above 1 indicate overload.',
      value: snapshot.dynamicCapacityPressure,
    },
    {
      name: 'opus_strike_dynamic_capacity_players_per_machine',
      help: 'Current per-machine in-game player capacity estimate from live server load.',
      value: snapshot.dynamicCapacityPlayersPerMachine,
    },
  ];
}

export async function collectAutoscalerMetricSnapshot(
  options: CollectAutoscalerMetricSnapshotOptions
): Promise<AutoscalerMetricSnapshot> {
  let lobbyRooms: AutoscalerRoomListing[] = [];
  let gameRooms: AutoscalerRoomListing[] = [];
  let matchmakerQueryUp = 1;
  let matchmakerError: string | undefined;

  try {
    [lobbyRooms, gameRooms] = await Promise.all([
      options.matchMaker.query({ name: 'lobby_room' }),
      options.matchMaker.query({ name: 'game_room' }),
    ]);
  } catch (error) {
    matchmakerQueryUp = 0;
    matchmakerError = error instanceof Error ? error.message : String(error);
  }

  const uptime = options.uptime ?? (() => process.uptime());
  const memoryUsage = options.memoryUsage ?? (() => process.memoryUsage());
  const processLoad = (options.processLoad ?? (() => processLoadSampler.getSnapshot()))();
  const localGameRooms = gameRooms.filter((room) => ownsRoom(room, options.matchMaker.processId));
  const localCapacity = createServerLoadCapacitySnapshot({
    maxMachines: 1,
    rooms: localGameRooms,
    machines: [{
      processId: options.matchMaker.processId ?? 'local',
      localGamePlayers: localGameRooms.reduce((sum, room) => sum + readGameHumanCount(room), 0),
      localGameRoomCount: localGameRooms.length,
      processCpuUtilization: processLoad.processCpuUtilization,
      eventLoopDelayP95Ms: processLoad.eventLoopDelayP95Ms,
      eventLoopDelayP99Ms: processLoad.eventLoopDelayP99Ms,
      heapUsedRatio: processLoad.heapUsedRatio,
      systemMemoryUsedRatio: processLoad.systemMemoryUsedRatio,
      capacityPressure: processLoad.capacityPressure,
    }],
  });

  return {
    localCcu: readFiniteNumber(options.matchMaker.stats.local.ccu) ?? 0,
    localRoomCount: readFiniteNumber(options.matchMaker.stats.local.roomCount) ?? 0,
    lobbyParticipants: lobbyRooms.reduce((sum, room) => sum + readLobbyParticipantCount(room), 0),
    visibleLobbyCount: lobbyRooms.filter(isVisibleLobby).length,
    flyReplayRegistered: options.flyReplayRegistered ? 1 : 0,
    redisUp: options.redisStatus.ok ? 1 : 0,
    matchmakerQueryUp,
    processUptimeSeconds: readFiniteNumber(uptime()) ?? 0,
    processHeapUsedBytes: readFiniteNumber(memoryUsage().heapUsed) ?? 0,
    processCpuUtilization: processLoad.processCpuUtilization,
    processLoadPct1: processLoad.loadPct1,
    processEventLoopDelayP95Ms: processLoad.eventLoopDelayP95Ms,
    processEventLoopDelayP99Ms: processLoad.eventLoopDelayP99Ms,
    processHeapUsedRatio: processLoad.heapUsedRatio,
    processSystemMemoryUsedRatio: processLoad.systemMemoryUsedRatio,
    dynamicCapacityPressure: processLoad.capacityPressure,
    dynamicCapacityPlayersPerMachine: localCapacity.playersPerMachine,
    matchmakerError,
    labels: options.labels ?? {},
  };
}

export function renderPrometheusMetrics(snapshot: AutoscalerMetricSnapshot): string {
  const lines: string[] = [];
  const labels = formatMetricLabels(snapshot.labels);

  for (const gauge of getGaugeDefinitions(snapshot)) {
    lines.push(`# HELP ${gauge.name} ${gauge.help}`);
    lines.push(`# TYPE ${gauge.name} gauge`);
    lines.push(`${gauge.name}${labels} ${formatMetricValue(gauge.value)}`);
  }

  return `${lines.join('\n')}\n`;
}
