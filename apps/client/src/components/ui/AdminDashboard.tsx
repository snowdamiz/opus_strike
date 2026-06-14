import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { config } from '../../config/environment';
import { lamportsToSolDisplay } from '../../utils/wagerPayments';

interface MachineProcess {
  processId: string;
  pid: number;
  updatedAtMs: number;
  loadAvg1: number;
  loadPct1: number;
  memoryRssBytes: number;
  heapUsedBytes: number;
  processCpuUtilization: number;
  eventLoopDelayP95Ms: number;
  capacityPressure: number;
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
  capacityPressure: number;
  dynamicCapacityPlayers: number;
  eventLoopDelayP95Ms: number;
  processCpuUtilization: number;
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

interface PlayerReportOverview {
  id: string;
  status: string;
  reason: string;
  details: string | null;
  reporterUserId: string;
  reporterPlayerSessionId: string;
  reporterName: string;
  reporterUser: { id: string; name: string; walletAddress: string | null } | null;
  targetUserId: string;
  targetPlayerSessionId: string;
  targetName: string;
  targetTeam: string | null;
  targetUser: { id: string; name: string; walletAddress: string | null } | null;
  roomId: string;
  matchId: string | null;
  lobbyId: string | null;
  matchMode: string | null;
  mapSeed: number | null;
  serverTick: number;
  evidenceEventId: string | null;
  resolvedByUserId: string | null;
  resolvedByUser: { id: string; name: string; walletAddress: string | null } | null;
  resolvedAt: string | null;
  resolution: string | null;
  actionType: string | null;
  accountActionId: string | null;
  createdAt: string;
  updatedAt: string;
}

type GoldenBiomeDistributionMode = 'manual' | 'auto';

interface GoldenBiomeRewardTransferOverview {
  id: string;
  userId: string;
  playerSessionId: string;
  displayName: string | null;
  recipientWallet: string;
  amountLamports: string;
  signature: string | null;
  status: string;
  lastError: string | null;
  confirmedAt: string | null;
  updatedAt: string;
}

interface GoldenBiomeRewardOverview {
  id: string;
  matchId: string;
  roomId: string;
  lobbyId: string | null;
  mapSeed: number;
  mapThemeId: string;
  winningTeam: string;
  treasuryWallet: string;
  rewardUsdCents: number;
  solUsdPriceMicroUsd: string;
  rewardLamports: string;
  totalRewardLamports: string;
  paidPlayerCount: number;
  treasuryBalanceLamports: string;
  status: string;
  distributionMode: GoldenBiomeDistributionMode;
  distributedByUserId: string | null;
  distributedAt: string | null;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  transfers: GoldenBiomeRewardTransferOverview[];
}

interface GoldenBiomeRewardsOverview {
  settings: {
    distributionMode: GoldenBiomeDistributionMode;
    enabled: boolean;
    chanceBps: number;
    winnerRewardUsdCents: number;
    treasuryMinUsdCents: number;
    treasuryWallet: string | null;
    updatedByUserId: string | null;
    updatedAt: string | null;
  };
  treasury: {
    eligible: boolean;
    enabled: boolean;
    treasuryWallet: string | null;
    treasuryBalanceLamports: string;
    requiredLamports: string;
    solUsdPriceMicroUsd: string;
    checkedAt: string;
    reason?: string;
  };
  rewards: GoldenBiomeRewardOverview[];
}

interface GlobalNotificationOverview {
  id: string;
  message: string;
  updatedByUserId: string | null;
  updatedAt: string;
}

interface AdminOverview {
  generatedAt: string;
  status: 'ok' | 'degraded' | string;
  admin: {
    userId: string;
    name: string;
    walletAddress: string;
    elevatedAntiCheatRole?: boolean;
    csrfToken?: string;
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
  capacity: {
    playersPerMachine: number;
    maxMachines: number;
    maxPlayers: number;
    activePlayers: number;
    reservedPlayers: number;
    availablePlayers: number;
    full: boolean;
    capacityPressure: number;
    machineCount: number;
    projectedMachineCount: number;
    source: 'live' | 'room_metrics' | 'bootstrap' | string;
  };
  machines: MachineOverview[];
  rooms: {
    game: GameRoomOverview[];
    lobbies: LobbyRoomOverview[];
  };
  playerReports?: {
    reports: PlayerReportOverview[];
    counts: Record<string, number>;
  };
  goldenBiomeRewards?: GoldenBiomeRewardsOverview;
  globalNotification: GlobalNotificationOverview | null;
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

function formatUsdCents(usdCents: number): string {
  const dollars = Math.floor(Math.max(0, usdCents) / 100);
  const cents = Math.max(0, usdCents) % 100;
  return cents === 0 ? `$${dollars}` : `$${dollars}.${cents.toString().padStart(2, '0')}`;
}

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.00$/, '')}%`;
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
      <table className="w-full min-w-[1040px] table-fixed border-collapse">
        <thead>
          <tr>
            <HeaderCell>Machine</HeaderCell>
            <HeaderCell>Region</HeaderCell>
            <HeaderCell align="right">Players</HeaderCell>
            <HeaderCell align="right">Capacity</HeaderCell>
            <HeaderCell align="right">Bots</HeaderCell>
            <HeaderCell align="right">Rooms</HeaderCell>
            <HeaderCell align="right">Pressure</HeaderCell>
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
              <Cell align="right">
                {formatNumber(machine.dynamicCapacityPlayers)}
                <div className="text-xs text-white/40">{formatNumber(Math.max(0, machine.dynamicCapacityPlayers - machine.playersInGame))} open</div>
              </Cell>
              <Cell align="right">{formatNumber(machine.botsInGame)}</Cell>
              <Cell align="right">
                {formatNumber(machine.gameRoomCount)} game
                <div className="text-xs text-white/40">{formatNumber(machine.lobbyRoomCount)} lobby</div>
              </Cell>
              <Cell align="right">
                {(machine.capacityPressure * 100).toFixed(0)}%
                <div className="text-xs text-white/40">CPU {(machine.processCpuUtilization * 100).toFixed(0)}% / loop {machine.eventLoopDelayP95Ms.toFixed(1)}ms</div>
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

function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-8 rounded-md border border-white/10 bg-white/[0.04] px-2.5 font-body text-xs font-semibold uppercase tracking-[0.06em] text-white/70 transition hover:border-accent-primary/45 hover:bg-white/[0.08] hover:text-white disabled:cursor-wait disabled:opacity-45"
    >
      {children}
    </button>
  );
}

function GlobalNotificationPanel({
  notification,
  draft,
  busy,
  onDraftChange,
  onSave,
  onRemove,
}: {
  notification: GlobalNotificationOverview | null;
  draft: string;
  busy: boolean;
  onDraftChange: (message: string) => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const trimmedDraft = draft.trim();
  const hasActiveNotification = Boolean(notification);

  return (
    <div className="grid gap-4 border-b border-white/10 bg-black/20 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.42fr)]">
      <div className="min-w-0">
        <label htmlFor="global-notification-message" className="font-body text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
          Message
        </label>
        <textarea
          id="global-notification-message"
          value={draft}
          maxLength={240}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="Maintenance starts in 10 minutes."
          className="mt-2 min-h-[76px] w-full resize-y rounded-md border border-white/10 bg-black/30 px-3 py-2 font-body text-sm leading-relaxed text-white outline-none transition placeholder:text-white/25 focus:border-accent-primary/55 focus:bg-black/40"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="font-body text-xs text-white/40">{trimmedDraft.length} / 240</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!trimmedDraft || busy}
              onClick={onSave}
              className="h-9 rounded-md border border-accent-primary/45 bg-accent-primary/20 px-3 font-body text-xs font-semibold uppercase tracking-[0.08em] text-orange-50 transition hover:border-accent-primary/70 hover:bg-accent-primary/30 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-white/35"
            >
              Set Message
            </button>
            <ActionButton disabled={!hasActiveNotification || busy} onClick={onRemove}>
              Remove
            </ActionButton>
          </div>
        </div>
      </div>

      <div className="min-w-0 rounded-md border border-white/10 bg-white/[0.025] p-3">
        <div className="font-body text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">Current</div>
        {notification ? (
          <>
            <div className="mt-2 inline-flex rounded-md border border-ui-warning/35 bg-ui-warning/10 px-2.5 py-1 font-body text-xs uppercase tracking-[0.08em] text-yellow-100">
              Active
            </div>
            <p className="mt-3 break-words font-body text-sm leading-relaxed text-white/80">{notification.message}</p>
            <div className="mt-3 font-body text-xs text-white/40">
              Updated {formatDate(notification.updatedAt)}
            </div>
          </>
        ) : (
          <>
            <div className="mt-2 inline-flex rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 font-body text-xs uppercase tracking-[0.08em] text-white/50">
              Off
            </div>
            <p className="mt-3 font-body text-sm text-white/45">No active message.</p>
          </>
        )}
      </div>
    </div>
  );
}

function ModeButton({
  mode,
  active,
  busy,
  onClick,
}: {
  mode: GoldenBiomeDistributionMode;
  active: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={active || busy}
      onClick={onClick}
      className={`h-9 rounded-md border px-3 font-body text-xs font-semibold uppercase tracking-[0.08em] transition disabled:cursor-default ${
        active
          ? 'border-amber-300/45 bg-amber-300/15 text-amber-100'
          : 'border-white/10 bg-white/[0.04] text-white/65 hover:border-amber-300/35 hover:text-white'
      }`}
    >
      {mode}
    </button>
  );
}

function GoldenBiomeRewardsPanel({
  overview,
  busyRewardId,
  busyMode,
  onSetMode,
  onDistribute,
}: {
  overview: GoldenBiomeRewardsOverview | undefined;
  busyRewardId: string | null;
  busyMode: boolean;
  onSetMode: (mode: GoldenBiomeDistributionMode) => void;
  onDistribute: (reward: GoldenBiomeRewardOverview) => void;
}) {
  if (!overview) return <EmptyTable label="Golden reward telemetry unavailable." />;

  const pendingRewards = overview.rewards.filter((reward) => reward.status !== 'complete').length;
  const treasury = overview.treasury;

  return (
    <div>
      <div className="grid gap-3 border-b border-white/10 bg-black/20 p-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <div className="font-body text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">Distribution</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <ModeButton
              mode="manual"
              active={overview.settings.distributionMode === 'manual'}
              busy={busyMode}
              onClick={() => onSetMode('manual')}
            />
            <ModeButton
              mode="auto"
              active={overview.settings.distributionMode === 'auto'}
              busy={busyMode}
              onClick={() => onSetMode('auto')}
            />
          </div>
          <div className="mt-2 font-body text-xs text-white/40">
            Manual queues rewards for admin payout. Auto pays eligible golden wins after match end.
          </div>
        </div>

        <div className="min-w-0">
          <div className="font-body text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">Treasury</div>
          <div className={`mt-2 inline-flex rounded-md border px-2.5 py-1 font-body text-xs uppercase tracking-[0.08em] ${
            treasury.eligible ? 'border-ui-success/35 bg-ui-success/10 text-emerald-100' : 'border-ui-warning/35 bg-ui-warning/10 text-yellow-100'
          }`}>
            {treasury.eligible ? 'Eligible' : treasury.reason || 'Not eligible'}
          </div>
          <div className="mt-2 break-all font-mono text-xs text-white/45">
            {treasury.treasuryWallet || overview.settings.treasuryWallet || 'No treasury wallet'}
          </div>
          <div className="mt-1 font-body text-xs text-white/40">
            {lamportsToSolDisplay(treasury.treasuryBalanceLamports)} SOL balance / {lamportsToSolDisplay(treasury.requiredLamports)} SOL minimum
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 md:min-w-[16rem]">
          <MetricTile label="Reward" value={formatUsdCents(overview.settings.winnerRewardUsdCents)} sublabel="per winner" />
          <MetricTile label="Chance" value={formatBps(overview.settings.chanceBps)} sublabel={`${formatNumber(pendingRewards)} pending`} />
        </div>
      </div>

      <GoldenBiomeRewardsTable
        rewards={overview.rewards}
        busyRewardId={busyRewardId}
        onDistribute={onDistribute}
      />
    </div>
  );
}

function GoldenBiomeRewardsTable({
  rewards,
  busyRewardId,
  onDistribute,
}: {
  rewards: GoldenBiomeRewardOverview[];
  busyRewardId: string | null;
  onDistribute: (reward: GoldenBiomeRewardOverview) => void;
}) {
  if (rewards.length === 0) return <EmptyTable label="No golden biome reward records yet." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1220px] table-fixed border-collapse">
        <thead>
          <tr>
            <HeaderCell>Match</HeaderCell>
            <HeaderCell>Status</HeaderCell>
            <HeaderCell>Team</HeaderCell>
            <HeaderCell align="right">Reward</HeaderCell>
            <HeaderCell>Transfers</HeaderCell>
            <HeaderCell>Actions</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {rewards.map((reward) => {
            const canDistribute = reward.status === 'pending' || reward.status === 'failed';
            return (
              <tr key={reward.id} className="hover:bg-white/[0.025]">
                <Cell mono>
                  <div className="break-all text-white">{reward.matchId}</div>
                  <div className="mt-1 font-body text-xs text-white/40">
                    seed {reward.mapSeed} / {formatAge(Date.parse(reward.createdAt))}
                  </div>
                  {reward.lastError && <div className="mt-2 font-body text-xs text-red-200/70">{reward.lastError}</div>}
                </Cell>
                <Cell>
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-xs uppercase tracking-[0.08em] text-white/70">
                    {reward.status}
                  </span>
                  <div className="mt-2 text-xs text-white/40">{reward.distributionMode}</div>
                  {reward.distributedAt && <div className="mt-1 text-xs text-white/35">sent {formatDate(reward.distributedAt)}</div>}
                </Cell>
                <Cell>
                  <div className="text-white">{reward.winningTeam}</div>
                  <div className="mt-1 text-xs text-white/40">{reward.paidPlayerCount} winner{reward.paidPlayerCount === 1 ? '' : 's'}</div>
                </Cell>
                <Cell align="right">
                  {formatUsdCents(reward.rewardUsdCents)}
                  <div className="text-xs text-white/40">{lamportsToSolDisplay(reward.rewardLamports)} SOL each</div>
                  <div className="text-xs text-white/35">{lamportsToSolDisplay(reward.totalRewardLamports)} SOL total</div>
                </Cell>
                <Cell>
                  <div className="space-y-2">
                    {reward.transfers.map((transfer) => (
                      <div key={transfer.id} className="min-w-0 border-l border-white/10 pl-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate text-white/80">{transfer.displayName || transfer.userId}</span>
                          <span className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-white/55">
                            {transfer.status}
                          </span>
                        </div>
                        <div className="mt-1 break-all font-mono text-[11px] text-white/35">{transfer.recipientWallet}</div>
                        {transfer.signature && <div className="mt-1 break-all font-mono text-[11px] text-emerald-100/55">{transfer.signature}</div>}
                        {transfer.lastError && <div className="mt-1 text-xs text-red-200/70">{transfer.lastError}</div>}
                      </div>
                    ))}
                  </div>
                </Cell>
                <Cell>
                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      disabled={!canDistribute || busyRewardId === reward.id}
                      onClick={() => onDistribute(reward)}
                    >
                      Distribute
                    </ActionButton>
                  </div>
                </Cell>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PlayerReportsTable({
  reports,
  busyId,
  onSetStatus,
  onAccountAction,
}: {
  reports: PlayerReportOverview[];
  busyId: string | null;
  onSetStatus: (report: PlayerReportOverview, status: string) => void;
  onAccountAction: (report: PlayerReportOverview, actionType: 'suspension' | 'ban') => void;
}) {
  if (reports.length === 0) return <EmptyTable label="No player reports." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1180px] table-fixed border-collapse">
        <thead>
          <tr>
            <HeaderCell>Report</HeaderCell>
            <HeaderCell>Status</HeaderCell>
            <HeaderCell>Target</HeaderCell>
            <HeaderCell>Reporter</HeaderCell>
            <HeaderCell>Match</HeaderCell>
            <HeaderCell>Reason</HeaderCell>
            <HeaderCell>Actions</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => (
            <tr key={report.id} className="hover:bg-white/[0.025]">
              <Cell mono>
                <div className="break-all text-white">{report.id}</div>
                <div className="mt-1 font-body text-xs text-white/40">{formatAge(Date.parse(report.createdAt))}</div>
              </Cell>
              <Cell>
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-xs uppercase tracking-[0.08em] text-white/70">
                  {report.status}
                </span>
              </Cell>
              <Cell>
                <div className="truncate text-white">{report.targetUser?.name || report.targetName}</div>
                <div className="mt-1 break-all font-mono text-xs text-white/40">{report.targetUserId}</div>
                {report.targetTeam && <div className="mt-1 text-xs text-white/35">{report.targetTeam}</div>}
              </Cell>
              <Cell>
                <div className="truncate text-white/80">{report.reporterUser?.name || report.reporterName}</div>
                <div className="mt-1 break-all font-mono text-xs text-white/40">{report.reporterUserId}</div>
              </Cell>
              <Cell>
                <div className="break-all font-mono text-xs text-white/80">{report.matchId || report.roomId}</div>
                <div className="mt-1 text-xs text-white/40">{report.matchMode || 'unknown'} seed {report.mapSeed ?? '-'}</div>
              </Cell>
              <Cell>
                <div className="text-white/80">{report.reason}</div>
                {report.details && <div className="mt-1 line-clamp-2 text-xs text-white/40">{report.details}</div>}
                {report.resolution && <div className="mt-2 line-clamp-2 text-xs text-emerald-100/55">{report.resolution}</div>}
              </Cell>
              <Cell>
                <div className="flex flex-wrap gap-2">
                  <ActionButton disabled={busyId === report.id} onClick={() => onSetStatus(report, 'reviewing')}>Review</ActionButton>
                  <ActionButton disabled={busyId === report.id} onClick={() => onSetStatus(report, 'cleared')}>Clear</ActionButton>
                  <ActionButton disabled={busyId === report.id} onClick={() => onSetStatus(report, 'dismissed')}>Dismiss</ActionButton>
                  <ActionButton disabled={busyId === report.id} onClick={() => onAccountAction(report, 'suspension')}>Suspend</ActionButton>
                  <ActionButton disabled={busyId === report.id} onClick={() => onAccountAction(report, 'ban')}>Ban</ActionButton>
                </div>
              </Cell>
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
  const [busyReportId, setBusyReportId] = useState<string | null>(null);
  const [busyGoldenRewardId, setBusyGoldenRewardId] = useState<string | null>(null);
  const [busyGoldenMode, setBusyGoldenMode] = useState(false);
  const [busyGlobalNotification, setBusyGlobalNotification] = useState(false);
  const [globalNotificationDraft, setGlobalNotificationDraft] = useState('');

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

  const postAdminJson = useCallback(async (endpoint: string, payload: unknown) => {
    setError(null);
    const csrfToken = overview?.admin.csrfToken ?? '';
    const response = await fetch(`${config.serverHttpUrl}${endpoint}`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify(payload ?? {}),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: `Admin request failed (${response.status})` }));
      throw new Error(data.error || `Admin request failed (${response.status})`);
    }

    await loadOverview();
  }, [loadOverview, overview?.admin.csrfToken]);

  const updateReportStatus = useCallback((report: PlayerReportOverview, status: string) => {
    const note = window.prompt(status === 'cleared' ? 'Clear note' : 'Review note', '') ?? '';
    if ((status === 'cleared' || status === 'dismissed') && !window.confirm(`${status} report ${report.id}?`)) return;

    setBusyReportId(report.id);
    postAdminJson(`/admin/api/player-reports/${encodeURIComponent(report.id)}/status`, { status, note })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyReportId(null));
  }, [postAdminJson]);

  const applyReportAccountAction = useCallback((report: PlayerReportOverview, actionType: 'suspension' | 'ban') => {
    const reason = window.prompt(`${actionType} reason`, report.reason);
    if (!reason) return;
    const expiresAt = actionType === 'suspension'
      ? window.prompt('Suspension expiration, ISO or local datetime', '')
      : '';
    if (actionType === 'suspension' && !expiresAt) return;
    if (!window.confirm(`${actionType} ${report.targetUser?.name || report.targetName}?`)) return;

    setBusyReportId(report.id);
    postAdminJson(`/admin/api/player-reports/${encodeURIComponent(report.id)}/account-actions`, {
      actionType,
      reason,
      expiresAt: expiresAt || null,
    })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyReportId(null));
  }, [postAdminJson]);

  const setGoldenDistributionMode = useCallback((mode: GoldenBiomeDistributionMode) => {
    const currentMode = overview?.goldenBiomeRewards?.settings.distributionMode;
    if (currentMode === mode) return;
    if (!window.confirm(`Switch golden reward distribution to ${mode}?`)) return;

    setBusyGoldenMode(true);
    postAdminJson('/admin/api/golden-biome/distribution-mode', { mode })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyGoldenMode(false));
  }, [overview?.goldenBiomeRewards?.settings.distributionMode, postAdminJson]);

  const distributeGoldenReward = useCallback((reward: GoldenBiomeRewardOverview) => {
    if (!window.confirm(`Distribute ${formatUsdCents(reward.rewardUsdCents)} worth of SOL to ${reward.paidPlayerCount} ${reward.winningTeam} winner${reward.paidPlayerCount === 1 ? '' : 's'}?`)) {
      return;
    }

    setBusyGoldenRewardId(reward.id);
    postAdminJson(`/admin/api/golden-biome/rewards/${encodeURIComponent(reward.id)}/distribute`, {})
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyGoldenRewardId(null));
  }, [postAdminJson]);

  const saveGlobalNotification = useCallback(() => {
    const message = globalNotificationDraft.trim();
    if (!message) {
      setError('Notification message is required');
      return;
    }

    setBusyGlobalNotification(true);
    postAdminJson('/admin/api/global-notification', { message })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyGlobalNotification(false));
  }, [globalNotificationDraft, postAdminJson]);

  const removeGlobalNotification = useCallback(() => {
    if (!overview?.globalNotification) return;
    if (!window.confirm('Remove the global notification?')) return;

    setBusyGlobalNotification(true);
    postAdminJson('/admin/api/global-notification/remove', {})
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyGlobalNotification(false));
  }, [overview?.globalNotification, postAdminJson]);

  useEffect(() => {
    void loadOverview();
    const interval = window.setInterval(() => void loadOverview(), 3000);
    return () => window.clearInterval(interval);
  }, [loadOverview]);

  useEffect(() => {
    setGlobalNotificationDraft(overview?.globalNotification?.message ?? '');
  }, [overview?.globalNotification?.message]);

  const metrics = useMemo(() => {
    if (!overview) return [];
    const activeReports = (overview.playerReports?.counts.open ?? 0) + (overview.playerReports?.counts.reviewing ?? 0);
    const pendingGoldenRewards = overview.goldenBiomeRewards?.rewards.filter((reward) => reward.status !== 'complete').length ?? 0;
    return [
      { label: 'Machines', value: formatNumber(overview.totals.runningMachines), sublabel: `${formatNumber(overview.totals.serverProcesses)} processes` },
      { label: 'Capacity', value: `${formatNumber(overview.capacity.reservedPlayers)} / ${formatNumber(overview.capacity.maxPlayers)}`, sublabel: `${formatNumber(overview.capacity.availablePlayers)} open / ${overview.capacity.source}` },
      { label: 'Game Players', value: formatNumber(overview.totals.playersInGame), sublabel: `${formatNumber(overview.totals.botsInGame)} bots` },
      { label: 'Game Rooms', value: formatNumber(overview.totals.gameRooms), sublabel: `${formatNumber(overview.totals.participantsInGame)} participants` },
      { label: 'Lobby Participants', value: formatNumber(overview.totals.lobbyParticipants), sublabel: `${formatNumber(overview.totals.lobbyRooms)} lobbies` },
      { label: 'Golden Rewards', value: formatNumber(pendingGoldenRewards), sublabel: overview.goldenBiomeRewards?.settings.distributionMode ?? 'manual' },
      { label: 'Player Reports', value: formatNumber(activeReports), sublabel: `${formatNumber(overview.playerReports?.reports.length ?? 0)} listed` },
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
            {overview.capacity.full && (
              <div className="rounded-lg border border-ui-warning/45 bg-ui-warning/10 px-4 py-3 font-body text-sm text-yellow-100">
                Max in-game players hit: {formatNumber(overview.capacity.reservedPlayers)} / {formatNumber(overview.capacity.maxPlayers)} reserved across {formatNumber(overview.capacity.maxMachines)} machines. Queued players will wait until a match frees space.
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-8">
              {metrics.map((metric) => (
                <MetricTile key={metric.label} {...metric} />
              ))}
            </div>

            <Section
              title="Global Notification"
              meta={overview.globalNotification ? 'active' : 'off'}
            >
              <GlobalNotificationPanel
                notification={overview.globalNotification}
                draft={globalNotificationDraft}
                busy={busyGlobalNotification}
                onDraftChange={setGlobalNotificationDraft}
                onSave={saveGlobalNotification}
                onRemove={removeGlobalNotification}
              />
            </Section>

            <Section title="Machines" meta={`${formatNumber(overview.machines.length)} running`}>
              <MachinesTable machines={overview.machines} />
            </Section>

            <Section title="Game Rooms" meta={`${formatNumber(overview.rooms.game.length)} active`}>
              <GameRoomsTable rooms={overview.rooms.game} />
            </Section>

            <Section title="Lobbies" meta={`${formatNumber(overview.rooms.lobbies.length)} active`}>
              <LobbiesTable lobbies={overview.rooms.lobbies} />
            </Section>

            <Section
              title="Golden Rewards"
              meta={`${formatNumber(overview.goldenBiomeRewards?.rewards.filter((reward) => reward.status !== 'complete').length ?? 0)} pending`}
            >
              <GoldenBiomeRewardsPanel
                overview={overview.goldenBiomeRewards}
                busyRewardId={busyGoldenRewardId}
                busyMode={busyGoldenMode}
                onSetMode={setGoldenDistributionMode}
                onDistribute={distributeGoldenReward}
              />
            </Section>

            <Section
              title="Player Reports"
              meta={`${formatNumber((overview.playerReports?.counts.open ?? 0) + (overview.playerReports?.counts.reviewing ?? 0))} active`}
            >
              <PlayerReportsTable
                reports={overview.playerReports?.reports ?? []}
                busyId={busyReportId}
                onSetStatus={updateReportStatus}
                onAccountAction={applyReportAccountAction}
              />
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
