import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { config } from '../../config/environment';

interface MachineProcess {
  processId: string;
  pid: number;
  updatedAtMs: number;
  loadAvg1: number;
  loadPct1: number;
  memoryRssBytes: number;
  heapUsedBytes: number;
  localCcu: number;
  localGamePlayers: number;
  localGameBots: number;
  localGameRoomCount: number;
  localLobbyRoomCount: number;
  matchmakerQueryUp: boolean;
  matchmakerError: string | null;
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
  processes: MachineProcess[];
}

interface GameRoomOverview {
  roomId: string;
  processId: string | null;
  machineId: string;
  publicAddress: string | null;
  clients: number;
  maxClients: number;
  players: number;
  bots: number;
  participants: number;
  phase: string;
  matchMode: string;
  lobbyId: string | null;
}

interface LobbyRoomOverview {
  roomId: string;
  processId: string | null;
  machineId: string;
  publicAddress: string | null;
  name: string;
  clients: number;
  maxClients: number;
  participants: number;
  humans: number;
  bots: number;
  status: string;
  matchMode: string;
  isPublic: boolean;
}

interface AdminOverview {
  generatedAt: string;
  status: 'ok' | 'degraded' | string;
  admin: {
    userId: string;
    name: string;
    walletAddress: string;
  };
  totals: {
    runningMachines: number;
    serverProcesses: number;
    totalConnectedClients: number;
    playersInGame: number;
    botsInGame: number;
    participantsInGame: number;
    gameRooms: number;
    lobbyRooms: number;
    lobbyParticipants: number;
  };
  machines: MachineOverview[];
  rooms: {
    game: GameRoomOverview[];
    lobbies: LobbyRoomOverview[];
  };
  diagnostics: {
    distributed: boolean;
    routingStrategy: string;
    roomCreateStrategy: string;
    redis: {
      ok: boolean;
      status: string;
      error?: string;
    };
    flyReplay: {
      enabled: boolean;
      registered: boolean;
      appName: string | null;
      machineId: string | null;
      region: string | null;
    };
    localProcessId: string | null;
    warnings: string[];
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value || 0);
}

function formatBytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let current = Math.max(0, value || 0);
  let index = 0;

  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index++;
  }

  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(current)} ${units[index]}`;
}

function formatAge(ms: number): string {
  if (!ms) return 'unknown';
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString();
}

function StatusPill({ status }: { status: string }) {
  const color = status === 'ok'
    ? 'bg-ui-success'
    : status === 'degraded'
      ? 'bg-ui-warning'
      : 'bg-ui-danger';

  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 font-body text-sm uppercase tracking-[0.08em] text-white">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {status}
    </div>
  );
}

function MetricTile({ label, value, sublabel }: { label: string; value: string | number; sublabel?: string }) {
  return (
    <div className="min-h-[104px] rounded-lg border border-white/10 bg-strike-panel-raised/95 p-4">
      <div className="font-body text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">{label}</div>
      <div className="mt-3 break-words font-display text-4xl leading-none text-white">{value}</div>
      {sublabel && <div className="mt-2 font-body text-xs text-white/45">{sublabel}</div>}
    </div>
  );
}

function EmptyTable({ label }: { label: string }) {
  return <div className="px-4 py-6 font-body text-sm text-white/45">{label}</div>;
}

function Section({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-strike-panel/95">
      <div className="flex min-h-[52px] items-center justify-between gap-4 border-b border-white/10 bg-white/[0.035] px-4">
        <h2 className="font-display text-2xl tracking-[0.04em] text-white">{title}</h2>
        {meta && <span className="font-body text-xs uppercase tracking-[0.1em] text-white/45">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

function HeaderCell({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`border-b border-white/10 px-3 py-3 font-body text-[11px] font-bold uppercase tracking-[0.1em] text-white/45 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}

function Cell({ children, align = 'left', mono = false }: { children: ReactNode; align?: 'left' | 'right'; mono?: boolean }) {
  return (
    <td className={`border-b border-white/10 px-3 py-3 align-middle text-sm text-white/80 ${align === 'right' ? 'text-right tabular-nums' : 'text-left'} ${mono ? 'font-mono text-xs' : 'font-body'}`}>
      {children}
    </td>
  );
}

function MachinesTable({ machines }: { machines: MachineOverview[] }) {
  if (machines.length === 0) return <EmptyTable label="No running machines reported." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] table-fixed border-collapse">
        <thead>
          <tr>
            <HeaderCell>Machine</HeaderCell>
            <HeaderCell>Region</HeaderCell>
            <HeaderCell align="right">Players</HeaderCell>
            <HeaderCell align="right">Bots</HeaderCell>
            <HeaderCell align="right">Rooms</HeaderCell>
            <HeaderCell align="right">Load</HeaderCell>
            <HeaderCell align="right">Memory</HeaderCell>
            <HeaderCell align="right">CCU</HeaderCell>
            <HeaderCell>Updated</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {machines.map((machine) => (
            <tr key={machine.machineId} className="hover:bg-white/[0.025]">
              <Cell mono>
                <div className="break-all text-white">{machine.machineId}</div>
                <div className="mt-1 font-body text-xs text-white/40">{formatNumber(machine.processCount)} process</div>
              </Cell>
              <Cell>{machine.region || 'unknown'}</Cell>
              <Cell align="right">{formatNumber(machine.playersInGame)}</Cell>
              <Cell align="right">{formatNumber(machine.botsInGame)}</Cell>
              <Cell align="right">
                {formatNumber(machine.gameRoomCount)} game
                <div className="text-xs text-white/40">{formatNumber(machine.lobbyRoomCount)} lobby</div>
              </Cell>
              <Cell align="right">
                {machine.loadAvg1.toFixed(2)} / {formatNumber(machine.cpuCount)}
                <div className="text-xs text-white/40">{machine.loadPct1.toFixed(0)}%</div>
              </Cell>
              <Cell align="right">
                {formatBytes(machine.memoryRssBytes)}
                <div className="text-xs text-white/40">{formatBytes(machine.systemFreeMemoryBytes)} free</div>
              </Cell>
              <Cell align="right">{formatNumber(machine.localCcu)}</Cell>
              <Cell>{formatAge(machine.latestUpdatedAtMs)}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GameRoomsTable({ rooms }: { rooms: GameRoomOverview[] }) {
  if (rooms.length === 0) return <EmptyTable label="No active game rooms." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] table-fixed border-collapse">
        <thead>
          <tr>
            <HeaderCell>Room</HeaderCell>
            <HeaderCell>Machine</HeaderCell>
            <HeaderCell>Phase</HeaderCell>
            <HeaderCell>Mode</HeaderCell>
            <HeaderCell align="right">Players</HeaderCell>
            <HeaderCell align="right">Bots</HeaderCell>
            <HeaderCell align="right">Clients</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <tr key={room.roomId} className="hover:bg-white/[0.025]">
              <Cell mono>{room.roomId}</Cell>
              <Cell mono>{room.machineId}</Cell>
              <Cell>
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-xs uppercase tracking-[0.08em] text-white/70">
                  {room.phase}
                </span>
              </Cell>
              <Cell>{room.matchMode}</Cell>
              <Cell align="right">{formatNumber(room.players)}</Cell>
              <Cell align="right">{formatNumber(room.bots)}</Cell>
              <Cell align="right">{formatNumber(room.clients)} / {formatNumber(room.maxClients)}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LobbiesTable({ lobbies }: { lobbies: LobbyRoomOverview[] }) {
  if (lobbies.length === 0) return <EmptyTable label="No active lobbies." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] table-fixed border-collapse">
        <thead>
          <tr>
            <HeaderCell>Lobby</HeaderCell>
            <HeaderCell>Machine</HeaderCell>
            <HeaderCell>Status</HeaderCell>
            <HeaderCell>Mode</HeaderCell>
            <HeaderCell align="right">Humans</HeaderCell>
            <HeaderCell align="right">Bots</HeaderCell>
            <HeaderCell align="right">Participants</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {lobbies.map((lobby) => (
            <tr key={lobby.roomId} className="hover:bg-white/[0.025]">
              <Cell>
                <div className="text-white">{lobby.name}</div>
                <div className="mt-1 break-all font-mono text-xs text-white/40">{lobby.roomId}</div>
              </Cell>
              <Cell mono>{lobby.machineId}</Cell>
              <Cell>
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-xs uppercase tracking-[0.08em] text-white/70">
                  {lobby.status}
                </span>
              </Cell>
              <Cell>{lobby.matchMode}</Cell>
              <Cell align="right">{formatNumber(lobby.humans)}</Cell>
              <Cell align="right">{formatNumber(lobby.bots)}</Cell>
              <Cell align="right">{formatNumber(lobby.participants)}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminDashboard() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadOverview = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`${config.serverHttpUrl}/admin/api/overview`, {
        credentials: 'include',
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(response.status === 404 ? 'Admin access denied' : `Admin request failed (${response.status})`);
      }

      setOverview(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
    const interval = window.setInterval(() => void loadOverview(), 3000);
    return () => window.clearInterval(interval);
  }, [loadOverview]);

  const metrics = useMemo(() => {
    if (!overview) return [];
    return [
      { label: 'Machines', value: formatNumber(overview.totals.runningMachines), sublabel: `${formatNumber(overview.totals.serverProcesses)} processes` },
      { label: 'Game Players', value: formatNumber(overview.totals.playersInGame), sublabel: `${formatNumber(overview.totals.botsInGame)} bots` },
      { label: 'Game Rooms', value: formatNumber(overview.totals.gameRooms), sublabel: `${formatNumber(overview.totals.participantsInGame)} participants` },
      { label: 'Lobby Participants', value: formatNumber(overview.totals.lobbyParticipants), sublabel: `${formatNumber(overview.totals.lobbyRooms)} lobbies` },
      { label: 'Connected Clients', value: formatNumber(overview.totals.totalConnectedClients), sublabel: overview.diagnostics.redis.ok ? 'redis ok' : `redis ${overview.diagnostics.redis.status}` },
    ];
  }, [overview]);

  return (
    <main className="h-dvh overflow-y-auto bg-strike-bg text-white">
      <div className="mx-auto flex min-h-full w-full max-w-[1440px] flex-col gap-4 px-4 py-5 md:px-6 md:py-6">
        <header className="flex flex-col justify-between gap-4 border-b border-white/10 pb-4 md:flex-row md:items-end">
          <div>
            <h1 className="font-display text-4xl tracking-[0.04em] text-white md:text-5xl">SLOP HEROES Admin</h1>
            <div className="mt-1 font-body text-sm text-white/45">
              {overview ? `Updated ${formatDate(overview.generatedAt)}` : loading ? 'Loading' : 'No telemetry'}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {overview && <StatusPill status={overview.status} />}
            <button
              type="button"
              onClick={() => void loadOverview()}
              className="h-10 rounded-md border border-white/10 bg-white/[0.04] px-4 font-body text-sm font-semibold uppercase tracking-[0.08em] text-white/80 transition hover:border-accent-primary/50 hover:text-white"
            >
              Refresh
            </button>
          </div>
        </header>

        {error && (
          <div className="rounded-lg border border-ui-danger/40 bg-ui-danger/10 px-4 py-3 font-body text-sm text-red-100">
            {error}
          </div>
        )}

        {overview?.diagnostics.warnings && overview.diagnostics.warnings.length > 0 && (
          <div className="rounded-lg border border-ui-warning/40 bg-ui-warning/10 px-4 py-3 font-body text-sm text-yellow-100">
            {overview.diagnostics.warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        )}

        {overview ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {metrics.map((metric) => (
                <MetricTile key={metric.label} {...metric} />
              ))}
            </div>

            <Section title="Machines" meta={`${formatNumber(overview.machines.length)} running`}>
              <MachinesTable machines={overview.machines} />
            </Section>

            <Section title="Game Rooms" meta={`${formatNumber(overview.rooms.game.length)} active`}>
              <GameRoomsTable rooms={overview.rooms.game} />
            </Section>

            <Section title="Lobbies" meta={`${formatNumber(overview.rooms.lobbies.length)} active`}>
              <LobbiesTable lobbies={overview.rooms.lobbies} />
            </Section>
          </>
        ) : (
          !loading && <EmptyTable label="Telemetry unavailable." />
        )}
      </div>
    </main>
  );
}

export default AdminDashboard;
