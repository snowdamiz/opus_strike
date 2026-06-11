export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

export interface RedisHealthSnapshot {
  ok: boolean;
  status: string;
  error?: string;
}

export interface AutoscalerRoomListing {
  clients?: number;
  metadata?: Record<string, unknown> | null;
}

export interface AutoscalerMatchMaker {
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
  ];
}

export async function collectAutoscalerMetricSnapshot(
  options: CollectAutoscalerMetricSnapshotOptions
): Promise<AutoscalerMetricSnapshot> {
  let lobbyRooms: AutoscalerRoomListing[] = [];
  let matchmakerQueryUp = 1;
  let matchmakerError: string | undefined;

  try {
    lobbyRooms = await options.matchMaker.query({ name: 'lobby_room' });
  } catch (error) {
    matchmakerQueryUp = 0;
    matchmakerError = error instanceof Error ? error.message : String(error);
  }

  const uptime = options.uptime ?? (() => process.uptime());
  const memoryUsage = options.memoryUsage ?? (() => process.memoryUsage());

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
