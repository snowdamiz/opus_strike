import { Router, type NextFunction, type Request, type Response } from 'express';
import prisma from '../db';
import { verifyAuthToken } from '../auth/session';
import type { ColyseusRuntimeConfig } from '../config/colyseus';
import { loggers } from '../utils/logger';
import {
  collectLocalAdminMachineSnapshot,
  listAdminMachineSnapshots,
  type AdminMachineRedisClient,
  type AdminMachineSnapshot,
  type AdminMatchMaker,
  type AdminRoomListing,
} from './machineRegistry';

interface AdminRouterOptions {
  config: ColyseusRuntimeConfig;
  matchMaker: AdminMatchMaker;
  redis: AdminMachineRedisClient | null;
  flyReplayRegistered: () => boolean;
}

interface AdminUser {
  id: string;
  name: string;
  walletAddress: string;
}

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
  localCcu: number;
  gameRoomCount: number;
  lobbyRoomCount: number;
  playersInGame: number;
  botsInGame: number;
  participantsInGame: number;
  lobbyParticipants: number;
  processes: AdminMachineSnapshot[];
}

function adminWallet(): string | null {
  const wallet = process.env.ADMIN_WALLET?.trim();
  return wallet || null;
}

function notFound(res: Response): void {
  res.status(404).type('text').send('Not found');
}

function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
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

async function ensureAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  noStore(res);

  const configuredAdminWallet = adminWallet();
  if (!configuredAdminWallet) {
    loggers.auth.warn('Admin route requested without ADMIN_WALLET configured', { path: req.path });
    notFound(res);
    return;
  }

  try {
    const token = req.cookies?.auth_token;
    const payload = typeof token === 'string' ? verifyAuthToken(token) : null;
    if (!payload) {
      loggers.auth.warn('Admin route rejected non-admin session', {
        path: req.path,
        hasSession: false,
      });
      notFound(res);
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        id: payload.userId,
        walletAddress: configuredAdminWallet,
      },
      select: {
        id: true,
        name: true,
        walletAddress: true,
      },
    });

    const walletAddress = user?.walletAddress;
    if (!user || !walletAddress) {
      loggers.auth.warn('Admin route rejected stale admin token', {
        path: req.path,
        userId: payload.userId,
      });
      notFound(res);
      return;
    }

    res.locals.adminUser = {
      id: user.id,
      name: user.name,
      walletAddress,
    } satisfies AdminUser;
    next();
  } catch (error) {
    loggers.auth.error('Admin authorization failed', {
      path: req.path,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Admin authorization failed' });
  }
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
  const redis = await pingRedis(options.redis);
  const [gameRoomResult, lobbyRoomResult] = await Promise.all([
    queryRooms(options.matchMaker, 'game_room'),
    queryRooms(options.matchMaker, 'lobby_room'),
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

  return {
    generatedAt: new Date(generatedAtMs).toISOString(),
    status: warnings.length === 0 && redis.ok ? 'ok' : 'degraded',
    admin: {
      userId: adminUser.id,
      name: adminUser.name,
      walletAddress: adminUser.walletAddress,
    },
    totals,
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
  };
}

function renderAdminHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Slop Heroes Admin</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #101114;
      --panel: #17191f;
      --panel-2: #1f232b;
      --line: #303642;
      --text: #eef2f6;
      --muted: #98a2b3;
      --good: #39d98a;
      --warn: #f4bf50;
      --bad: #ff6b6b;
      --accent: #66d9ef;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(1360px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 24px 0 40px;
    }
    header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
    }
    h1, h2 { margin: 0; font-weight: 700; letter-spacing: 0; }
    h1 { font-size: 28px; }
    h2 { font-size: 16px; }
    .muted { color: var(--muted); }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      padding: 6px 10px;
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 6px;
      white-space: nowrap;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--muted);
    }
    .ok .dot { background: var(--good); }
    .degraded .dot { background: var(--warn); }
    .error .dot { background: var(--bad); }
    .grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .metric, section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .metric { padding: 14px; min-width: 0; }
    .metric .label {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    .metric .value {
      margin-top: 4px;
      font-size: 28px;
      font-weight: 750;
      line-height: 1.1;
      overflow-wrap: anywhere;
    }
    section { margin-top: 16px; overflow: hidden; }
    section .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 13px 14px;
      border-bottom: 1px solid var(--line);
      background: var(--panel-2);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: middle;
      overflow-wrap: anywhere;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
      letter-spacing: .06em;
      background: rgba(255,255,255,.02);
    }
    tr:last-child td { border-bottom: 0; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      max-width: 100%;
      padding: 2px 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--text);
      background: rgba(255,255,255,.03);
    }
    .warnings {
      display: none;
      margin: 0 0 16px;
      padding: 12px 14px;
      border: 1px solid rgba(244,191,80,.45);
      background: rgba(244,191,80,.11);
      border-radius: 8px;
      color: #ffe4a3;
    }
    .empty {
      padding: 18px 14px;
      color: var(--muted);
    }
    @media (max-width: 1050px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      header { align-items: start; flex-direction: column; }
    }
    @media (max-width: 720px) {
      main { width: min(100vw - 20px, 1360px); padding-top: 16px; }
      .grid { grid-template-columns: 1fr; }
      table { min-width: 760px; }
      .table-wrap { overflow-x: auto; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Slop Heroes Admin</h1>
        <div class="muted" id="subtitle">Loading production telemetry</div>
      </div>
      <div class="status" id="status"><span class="dot"></span><span>Loading</span></div>
    </header>

    <div class="warnings" id="warnings"></div>

    <div class="grid" id="metrics"></div>

    <section>
      <div class="section-head">
        <h2>Machines</h2>
        <span class="muted" id="machine-count"></span>
      </div>
      <div class="table-wrap" id="machines"></div>
    </section>

    <section>
      <div class="section-head">
        <h2>Game Rooms</h2>
        <span class="muted" id="game-room-count"></span>
      </div>
      <div class="table-wrap" id="game-rooms"></div>
    </section>

    <section>
      <div class="section-head">
        <h2>Lobbies</h2>
        <span class="muted" id="lobby-count"></span>
      </div>
      <div class="table-wrap" id="lobbies"></div>
    </section>
  </main>

  <script>
    const state = {
      formatter: new Intl.NumberFormat(),
      bytes: new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }),
    };

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[char]));
    }

    function num(value) {
      return state.formatter.format(Number(value) || 0);
    }

    function bytes(value) {
      const raw = Number(value) || 0;
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let current = raw;
      let index = 0;
      while (current >= 1024 && index < units.length - 1) {
        current /= 1024;
        index++;
      }
      return state.bytes.format(current) + ' ' + units[index];
    }

    function age(ms) {
      if (!ms) return 'unknown';
      const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
      if (seconds < 60) return seconds + 's ago';
      return Math.round(seconds / 60) + 'm ago';
    }

    function setStatus(data) {
      const el = document.getElementById('status');
      el.className = 'status ' + (data.status === 'ok' ? 'ok' : 'degraded');
      el.innerHTML = '<span class="dot"></span><span>' + escapeHtml(data.status) + '</span>';
      document.getElementById('subtitle').textContent = 'Updated ' + new Date(data.generatedAt).toLocaleString();
    }

    function renderMetrics(data) {
      const metrics = [
        ['Machines', data.totals.runningMachines],
        ['Game Players', data.totals.playersInGame],
        ['Game Rooms', data.totals.gameRooms],
        ['Lobby Participants', data.totals.lobbyParticipants],
        ['Connected Clients', data.totals.totalConnectedClients],
      ];

      document.getElementById('metrics').innerHTML = metrics.map(([label, value]) =>
        '<div class="metric"><div class="label">' + escapeHtml(label) + '</div><div class="value">' + num(value) + '</div></div>'
      ).join('');
    }

    function renderWarnings(data) {
      const el = document.getElementById('warnings');
      const warnings = data.diagnostics.warnings || [];
      if (warnings.length === 0) {
        el.style.display = 'none';
        el.innerHTML = '';
        return;
      }
      el.style.display = 'block';
      el.innerHTML = warnings.map((warning) => '<div>' + escapeHtml(warning) + '</div>').join('');
    }

    function renderMachines(data) {
      document.getElementById('machine-count').textContent = num(data.machines.length) + ' running';
      if (data.machines.length === 0) {
        document.getElementById('machines').innerHTML = '<div class="empty">No running machines reported.</div>';
        return;
      }

      document.getElementById('machines').innerHTML = '<table><thead><tr>' +
        '<th>Machine</th><th>Region</th><th class="num">Players</th><th class="num">Bots</th><th class="num">Rooms</th><th class="num">Load</th><th class="num">Memory</th><th class="num">CCU</th><th>Updated</th>' +
        '</tr></thead><tbody>' + data.machines.map((machine) => (
          '<tr>' +
          '<td><span class="mono">' + escapeHtml(machine.machineId) + '</span><br><span class="muted">' + num(machine.processCount) + ' process</span></td>' +
          '<td>' + escapeHtml(machine.region || 'unknown') + '</td>' +
          '<td class="num">' + num(machine.playersInGame) + '</td>' +
          '<td class="num">' + num(machine.botsInGame) + '</td>' +
          '<td class="num">' + num(machine.gameRoomCount) + ' game / ' + num(machine.lobbyRoomCount) + ' lobby</td>' +
          '<td class="num">' + (Number(machine.loadAvg1) || 0).toFixed(2) + ' / ' + num(machine.cpuCount) + '<br><span class="muted">' + (Number(machine.loadPct1) || 0).toFixed(0) + '%</span></td>' +
          '<td class="num">' + bytes(machine.memoryRssBytes) + '<br><span class="muted">' + bytes(machine.systemFreeMemoryBytes) + ' free</span></td>' +
          '<td class="num">' + num(machine.localCcu) + '</td>' +
          '<td>' + escapeHtml(age(machine.latestUpdatedAtMs)) + '</td>' +
          '</tr>'
        )).join('') + '</tbody></table>';
    }

    function renderGameRooms(data) {
      const rooms = data.rooms.game;
      document.getElementById('game-room-count').textContent = num(rooms.length) + ' active';
      if (rooms.length === 0) {
        document.getElementById('game-rooms').innerHTML = '<div class="empty">No active game rooms.</div>';
        return;
      }

      document.getElementById('game-rooms').innerHTML = '<table><thead><tr>' +
        '<th>Room</th><th>Machine</th><th>Phase</th><th>Mode</th><th class="num">Players</th><th class="num">Bots</th><th class="num">Clients</th>' +
        '</tr></thead><tbody>' + rooms.map((room) => (
          '<tr>' +
          '<td><span class="mono">' + escapeHtml(room.roomId) + '</span></td>' +
          '<td><span class="mono">' + escapeHtml(room.machineId) + '</span></td>' +
          '<td><span class="pill">' + escapeHtml(room.phase) + '</span></td>' +
          '<td>' + escapeHtml(room.matchMode) + '</td>' +
          '<td class="num">' + num(room.players) + '</td>' +
          '<td class="num">' + num(room.bots) + '</td>' +
          '<td class="num">' + num(room.clients) + ' / ' + num(room.maxClients) + '</td>' +
          '</tr>'
        )).join('') + '</tbody></table>';
    }

    function renderLobbies(data) {
      const rooms = data.rooms.lobbies;
      document.getElementById('lobby-count').textContent = num(rooms.length) + ' active';
      if (rooms.length === 0) {
        document.getElementById('lobbies').innerHTML = '<div class="empty">No active lobbies.</div>';
        return;
      }

      document.getElementById('lobbies').innerHTML = '<table><thead><tr>' +
        '<th>Lobby</th><th>Machine</th><th>Status</th><th>Mode</th><th class="num">Humans</th><th class="num">Bots</th><th class="num">Participants</th>' +
        '</tr></thead><tbody>' + rooms.map((room) => (
          '<tr>' +
          '<td>' + escapeHtml(room.name) + '<br><span class="mono muted">' + escapeHtml(room.roomId) + '</span></td>' +
          '<td><span class="mono">' + escapeHtml(room.machineId) + '</span></td>' +
          '<td><span class="pill">' + escapeHtml(room.status) + '</span></td>' +
          '<td>' + escapeHtml(room.matchMode) + '</td>' +
          '<td class="num">' + num(room.humans) + '</td>' +
          '<td class="num">' + num(room.bots) + '</td>' +
          '<td class="num">' + num(room.participants) + '</td>' +
          '</tr>'
        )).join('') + '</tbody></table>';
    }

    async function load() {
      try {
        const response = await fetch('/admin/api/overview', { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        setStatus(data);
        renderWarnings(data);
        renderMetrics(data);
        renderMachines(data);
        renderGameRooms(data);
        renderLobbies(data);
      } catch (error) {
        const el = document.getElementById('status');
        el.className = 'status error';
        el.innerHTML = '<span class="dot"></span><span>Refresh failed</span>';
        document.getElementById('warnings').style.display = 'block';
        document.getElementById('warnings').textContent = error instanceof Error ? error.message : String(error);
      }
    }

    load();
    window.setInterval(load, 3000);
  </script>
</body>
</html>`;
}

export function createAdminRouter(options: AdminRouterOptions): Router {
  const router: Router = Router();

  router.get('/', ensureAdmin, (_req, res) => {
    noStore(res);
    res.type('html').send(renderAdminHtml());
  });

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

  return router;
}

export default createAdminRouter;
