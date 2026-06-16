import { Client, type Room } from 'colyseus.js';

interface ParsedArgs {
  serverUrl: string;
  clientCount: number;
  holdMs: number;
  connectIntervalMs: number;
  authTokens: string[];
  lobbyPrefix: string;
  isPrivate: boolean;
}

function readOption(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);

  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseArgs(args: string[]): ParsedArgs {
  const clientCount = readPositiveInteger(readOption(args, '--clients') ?? process.env.AUTOSCALER_DEMAND_CLIENTS, 49);
  const authTokens = readCsv(
    readOption(args, '--auth-tokens')
      ?? process.env.AUTOSCALER_AUTH_TOKENS
      ?? readOption(args, '--auth-token')
      ?? process.env.AUTOSCALER_AUTH_TOKEN
  );

  if (authTokens.length < clientCount) {
    throw new Error(`AUTOSCALER_AUTH_TOKENS must provide at least ${clientCount} Discord auth tokens`);
  }

  return {
    serverUrl: readOption(args, '--server-url')
      ?? process.env.AUTOSCALER_SERVER_URL
      ?? 'wss://opus-strike-server.fly.dev',
    clientCount,
    holdMs: readPositiveInteger(readOption(args, '--hold-ms') ?? process.env.AUTOSCALER_DEMAND_HOLD_MS, 180_000),
    connectIntervalMs: readPositiveInteger(
      readOption(args, '--connect-interval-ms') ?? process.env.AUTOSCALER_DEMAND_CONNECT_INTERVAL_MS,
      100
    ),
    authTokens,
    lobbyPrefix: readOption(args, '--lobby-prefix') ?? process.env.AUTOSCALER_DEMAND_LOBBY_PREFIX ?? 'Autoscaler Demand',
    isPrivate: args.includes('--private') || process.env.AUTOSCALER_DEMAND_PRIVATE === '1',
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toWebSocketUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol === 'http:') url.protocol = 'ws:';
  return url.toString().replace(/\/+$/, '');
}

function toHttpUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol === 'wss:') url.protocol = 'https:';
  if (url.protocol === 'ws:') url.protocol = 'http:';
  return url.toString().replace(/\/+$/, '');
}

async function fetchMetricsSummary(serverUrl: string): Promise<Record<string, number>> {
  const response = await fetch(`${toHttpUrl(serverUrl)}/metrics`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return {};

  const text = await response.text();
  const summary: Record<string, number> = {};
  for (const metric of [
    'opus_strike_colyseus_local_ccu',
    'opus_strike_colyseus_local_room_count',
    'opus_strike_lobby_participants',
  ]) {
    const line = text.split(/\r?\n/).find((candidate) => candidate.startsWith(metric));
    if (!line) continue;
    const value = Number(line.trim().split(/\s+/).at(-1));
    if (Number.isFinite(value)) summary[metric] = value;
  }

  return summary;
}

async function leaveRooms(rooms: Room[]): Promise<void> {
  await Promise.all(rooms.map((room) => room.leave(true).catch(() => undefined)));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const wsUrl = toWebSocketUrl(args.serverUrl);
  const rooms: Room[] = [];
  let shuttingDown = false;

  const cleanup = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await leaveRooms(rooms);
  };

  process.once('SIGINT', () => {
    cleanup()
      .then(() => process.exit(130))
      .catch(() => process.exit(1));
  });
  process.once('SIGTERM', () => {
    cleanup()
      .then(() => process.exit(143))
      .catch(() => process.exit(1));
  });

  try {
    for (let index = 0; index < args.clientCount; index++) {
      const client = new Client(wsUrl);
      const room = await client.create('lobby_room', {
        playerName: `Autoscale ${index + 1}`,
        lobbyName: `${args.lobbyPrefix} ${index + 1}`,
        isPrivate: args.isPrivate,
        initialBotCount: 0,
        botFillMode: 'manual',
        defaultBotDifficulty: 'normal',
        authToken: args.authTokens[index],
      });
      room.onMessage('*', () => undefined);
      rooms.push(room);

      if ((index + 1) % 10 === 0 || index + 1 === args.clientCount) {
        console.log(`connected ${index + 1}/${args.clientCount}`);
      }
      await delay(args.connectIntervalMs);
    }

    console.log(JSON.stringify({
      connectedClients: rooms.length,
      distinctLobbyRooms: new Set(rooms.map((room) => room.roomId)).size,
      holdMs: args.holdMs,
      metrics: await fetchMetricsSummary(args.serverUrl),
    }, null, 2));

    await delay(args.holdMs);
  } finally {
    await cleanup();
    console.log(JSON.stringify({ disconnectedClients: rooms.length }, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
