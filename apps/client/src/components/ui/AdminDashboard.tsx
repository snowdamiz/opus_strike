import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  RANK_DEFINITIONS,
  getRankFromRating,
} from '@voxel-strike/shared';
import { config } from '../../config/environment';
import { lamportsToSolDisplay } from '../../utils/sol';
import { RankBadge } from './RankBadge';

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

type RankedSeasonMode = 'preseason' | 'season';
type RankedEntryGateMode = 'locked' | 'token_required';
const ADMIN_RANK_PAGE_SIZE = 25;

interface RankedSeasonOverview {
  mode: RankedSeasonMode;
  seasonNumber: number;
  label: string;
  endsAt: string | null;
  updatedAt: string;
  updatedByUserId: string | null;
  lastResetAt: string | null;
}

interface RankedSeasonDraft {
  mode: RankedSeasonMode;
  seasonNumber: string;
  endsAtLocal: string;
}

interface RankedEntryGateOverview {
  mode: RankedEntryGateMode;
  tokenMintAddress: string | null;
  tokenAddress: string;
  tokenSymbol: string;
  requiredTokenAmount: string;
  cluster: string;
  rpcConfigured: boolean;
  updatedAt: string;
  updatedByUserId: string | null;
}

interface RankedEntryGateDraft {
  mode: RankedEntryGateMode;
  tokenMintAddress: string;
  tokenSymbol: string;
  requiredTokenAmount: string;
}

interface SkinShopSettingsOverview {
  enabled: boolean;
  tokenMintAddress: string | null;
  tokenSymbol: string;
  treasuryWallet: string | null;
  cluster: string;
  rpcConfigured: boolean;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

interface SkinShopItemSettingsOverview {
  skinId: string;
  saleEnabled: boolean;
  tokenAmountBaseUnits: string | null;
  displayNote: string | null;
  priceVersion: number;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

interface SkinShopAuditOverview {
  id: string;
  updatedByUserId: string | null;
  createdAt: string;
  oldTokenAmountBaseUnits: string | null;
  newTokenAmountBaseUnits: string | null;
  oldSaleEnabled: boolean | null;
  newSaleEnabled: boolean | null;
}

interface SkinShopOverview {
  shop: SkinShopSettingsOverview;
  items: Array<{
    skin: {
      id: string;
      displayName: string;
      subtitle: string;
      rarity: string;
      availability: string;
      releaseState: string;
    };
    settings: SkinShopItemSettingsOverview;
    lastAudit: SkinShopAuditOverview | null;
  }>;
}

interface SkinShopSettingsDraft {
  enabled: boolean;
  tokenMintAddress: string;
  tokenSymbol: string;
  treasuryWallet: string;
  rpcUrl: string;
  cluster: string;
}

interface SkinShopItemDraft {
  saleEnabled: boolean;
  tokenAmountBaseUnits: string;
  displayNote: string;
  expectedPriceVersion: number;
}

interface AdminRankSummary {
  label: string;
  tier: string;
  division: number | null;
  rating: number;
  minRating: number;
  maxRating: number | null;
  rangeLabel: string;
}

interface AdminRankUser {
  id: string;
  name: string;
  walletAddress: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  totalGames: number;
  totalWins: number;
  totalLosses: number;
  totalDraws: number;
  competitiveRating: number;
  rankedGames: number;
  rankedWins: number;
  rankedLosses: number;
  rankedDraws: number;
  rankedPlacementsRemaining: number;
  rankedPeakRating: number;
  rankedLastMatchAt: string | null;
  rank: AdminRankSummary;
  peakRank: AdminRankSummary;
}

interface AdminRankGate {
  label: string;
  tier: string;
  division: number;
  rating: number;
  minRating: number;
  maxRating: number | null;
  rangeLabel: string;
}

interface AdminUsersPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

interface AdminUsersResponse {
  query: string;
  rankOptions: AdminRankGate[];
  users: AdminRankUser[];
  pagination: AdminUsersPagination;
}

const EMPTY_ADMIN_USERS_PAGINATION: AdminUsersPagination = {
  page: 1,
  limit: ADMIN_RANK_PAGE_SIZE,
  total: 0,
  totalPages: 1,
  hasPrevious: false,
  hasNext: false,
};

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
  rankedSeason: RankedSeasonOverview;
  rankedEntryGate: RankedEntryGateOverview;
  skinShop: SkinShopOverview;
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

function formatCompactIdentifier(value: string, head = 4, tail = 4): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function formatSeasonBoundary(mode: RankedSeasonMode, value: string | null): string {
  const fallback = mode === 'preseason' ? 'Next season TBA' : 'End date TBA';
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  const formattedDate = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return mode === 'preseason' ? `Next season begins ${formattedDate}` : `Ends ${formattedDate}`;
}

function toDateTimeLocalValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getRankedSeasonIdentity(mode: RankedSeasonMode, seasonNumber: number): string {
  return mode === 'preseason' ? 'preseason' : `season:${Math.max(1, Math.floor(seasonNumber || 1))}`;
}

function formatRankedEntryGateMode(mode: RankedEntryGateMode): string {
  return mode === 'token_required' ? 'Token Required' : 'Locked';
}

function isPositiveWholeNumberString(value: string): boolean {
  return /^[0-9]+$/.test(value.trim()) && BigInt(value.trim()) > 0n;
}

const ADMIN_MANUAL_RATING_MAX = 5000;

const RANK_OPTIONS = RANK_DEFINITIONS.flatMap((tier) => (
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
    rangeLabel: maxRating === null ? `${formatNumber(option.rating)}+` : `${formatNumber(option.rating)}-${formatNumber(maxRating)}`,
  };
});

function parseDraftRating(value: string): number | null {
  if (!value.trim()) return null;
  const rating = Math.round(Number(value));
  return Number.isFinite(rating) && rating >= 0 && rating <= ADMIN_MANUAL_RATING_MAX ? rating : null;
}

function getRankGateForRating(rating: number) {
  let current = RANK_OPTIONS[0];
  for (const option of RANK_OPTIONS) {
    if (rating >= option.minRating) current = option;
    else break;
  }
  return current;
}

function getRankPreview(value: string, rankedGames: number) {
  const rating = parseDraftRating(value);
  if (rating === null) {
    return {
      rating: null,
      label: 'Invalid rating',
      rangeLabel: '',
      gateLabel: '',
    };
  }

  const rank = getRankFromRating(rating, rankedGames);
  const gate = getRankGateForRating(rating);
  return {
    rating,
    label: rank.label,
    rangeLabel: gate.rangeLabel,
    gateLabel: gate.label,
  };
}

function formatUsdCents(usdCents: number): string {
  const dollars = Math.floor(Math.max(0, usdCents) / 100);
  const cents = Math.max(0, usdCents) % 100;
  return cents === 0 ? `$${dollars}` : `$${dollars}.${cents.toString().padStart(2, '0')}`;
}

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.00$/, '')}%`;
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'amber';
type AdminTabId = 'overview' | 'operations' | 'players' | 'servers' | 'rooms' | 'rewards' | 'reports';

interface MetricTileProps {
  label: string;
  value: string | number;
  sublabel?: string;
  tone?: Tone;
  meter?: number;
}

interface AdminTab {
  id: AdminTabId;
  label: string;
  meta: string;
  tone: Tone;
}

interface AdminSelectOption {
  value: string;
  label: string;
  detail?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value * 100));
}

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(value)} ${value === 1 ? singular : plural}`;
}

function toneForSystemStatus(status: string): Tone {
  if (status === 'ok' || status === 'complete' || status === 'cleared') return 'success';
  if (status === 'degraded' || status === 'pending' || status === 'reviewing') return 'warning';
  if (status === 'failed' || status === 'ban') return 'danger';
  return 'neutral';
}

function toneForPressure(value: number): Tone {
  if (value >= 0.9) return 'danger';
  if (value >= 0.7) return 'warning';
  return 'info';
}

const pillToneClasses: Record<Tone, string> = {
  neutral: 'border-white/10 bg-white/[0.035] text-white/60',
  success: 'border-ui-success/30 bg-ui-success/10 text-emerald-100',
  warning: 'border-ui-warning/35 bg-ui-warning/10 text-yellow-100',
  danger: 'border-ui-danger/35 bg-ui-danger/10 text-red-100',
  info: 'border-accent-secondary/30 bg-accent-secondary/10 text-cyan-100',
  amber: 'border-amber-300/35 bg-amber-300/10 text-amber-100',
};

const dotToneClasses: Record<Tone, string> = {
  neutral: 'bg-white/45',
  success: 'bg-ui-success',
  warning: 'bg-ui-warning',
  danger: 'bg-ui-danger',
  info: 'bg-accent-secondary',
  amber: 'bg-amber-300',
};

const meterToneClasses: Record<Tone, string> = {
  neutral: 'bg-white/55',
  success: 'bg-ui-success',
  warning: 'bg-ui-warning',
  danger: 'bg-ui-danger',
  info: 'bg-accent-secondary',
  amber: 'bg-amber-300',
};

function Pill({
  children,
  tone = 'neutral',
  withDot = false,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  withDot?: boolean;
  className?: string;
}) {
  return (
    <span className={cx(
      'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-body text-[11px] font-semibold uppercase leading-5',
      pillToneClasses[tone],
      className,
    )}>
      {withDot && <span className={cx('h-1.5 w-1.5 rounded-full', dotToneClasses[tone])} />}
      {children}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  return <Pill tone={toneForSystemStatus(status)} withDot>{status}</Pill>;
}

function MiniMeter({ value, tone = 'info' }: { value: number; tone?: Tone }) {
  const width = `${clampPercent(value)}%`;
  return (
    <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.08]">
      <div className={cx('h-full rounded-full', meterToneClasses[tone])} style={{ width }} />
    </div>
  );
}

function MetricTile({ label, value, sublabel, tone = 'neutral', meter }: MetricTileProps) {
  return (
    <div className="min-h-[78px] rounded-md border border-white/10 bg-strike-panel-raised/90 p-3 shadow-[inset_0_1px_0_rgb(var(--color-strike-border)_/_0.04)]">
      <div className="font-body text-[10px] font-semibold uppercase leading-none text-white/45">{label}</div>
      <div className="mt-2 break-words font-body text-[1.45rem] font-semibold leading-none text-white">{value}</div>
      {sublabel && <div className="mt-1.5 truncate font-body text-[11px] leading-4 text-white/42">{sublabel}</div>}
      {typeof meter === 'number' && <MiniMeter value={meter} tone={tone} />}
    </div>
  );
}

function EmptyTable({ label }: { label: string }) {
  return <div className="px-3 py-5 font-body text-xs text-white/45">{label}</div>;
}

function Section({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-md border border-white/10 bg-strike-panel/95 shadow-[0_12px_30px_rgb(var(--color-strike-canvas)_/_0.35)]">
      <div className="flex min-h-[42px] items-center justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-3">
        <h2 className="font-body text-sm font-semibold uppercase text-white/90">{title}</h2>
        {meta && <Pill>{meta}</Pill>}
      </div>
      {children}
    </section>
  );
}

function HeaderCell({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`border-b border-white/10 bg-white/[0.018] px-3 py-2 font-body text-[10px] font-bold uppercase text-white/45 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}

function Cell({ children, align = 'left', mono = false }: { children: ReactNode; align?: 'left' | 'right'; mono?: boolean }) {
  return (
    <td className={`border-b border-white/[0.07] px-3 py-2 align-middle text-xs text-white/78 ${align === 'right' ? 'text-right tabular-nums' : 'text-left'} ${mono ? 'font-mono text-[11px]' : 'font-body'}`}>
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
            <HeaderCell align="right">Load</HeaderCell>
            <HeaderCell align="right">Memory</HeaderCell>
            <HeaderCell align="right">CCU</HeaderCell>
            <HeaderCell>Updated</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {machines.map((machine) => {
            const loadRatio = machine.loadPct1 / 100;
            const loadTone = toneForPressure(loadRatio);
            const hasMeasuredCapacity = machine.dynamicCapacitySource === 'live' && machine.gameRoomCount > 0;
            const projectedCapacity = machine.dynamicCapacityPlayers > 0
              ? `projected ${formatNumber(machine.dynamicCapacityPlayers)}`
              : 'no samples';
            return (
              <tr key={machine.machineId} className="hover:bg-white/[0.025]">
                <Cell mono>
                  <div className="break-all text-white">{machine.machineId}</div>
                  <div className="mt-1 font-body text-[11px] text-white/40">{formatCount(machine.processCount, 'process', 'processes')}</div>
                </Cell>
                <Cell>{machine.region || 'unknown'}</Cell>
                <Cell align="right">{formatNumber(machine.playersInGame)}</Cell>
                <Cell align="right">
                  {hasMeasuredCapacity ? formatNumber(machine.dynamicCapacityPlayers) : 'Learning'}
                  <div className="text-[11px] text-white/40">
                    {hasMeasuredCapacity
                      ? `${formatNumber(Math.max(0, machine.dynamicCapacityPlayers - machine.playersInGame))} open`
                      : projectedCapacity}
                  </div>
                </Cell>
                <Cell align="right">{formatNumber(machine.botsInGame)}</Cell>
                <Cell align="right">
                  {formatCount(machine.gameRoomCount, 'game')}
                  <div className="text-[11px] text-white/40">{formatCount(machine.lobbyRoomCount, 'lobby', 'lobbies')}</div>
                </Cell>
                <Cell align="right">
                  <Pill tone={loadTone}>{machine.loadPct1.toFixed(0)}%</Pill>
                  <div className="text-[11px] text-white/40">1m {machine.loadAvg1.toFixed(2)} / {formatNumber(machine.cpuCount)} CPUs</div>
                  <div className="text-[11px] text-white/40">CPU {(machine.processCpuUtilization * 100).toFixed(0)}% / loop {machine.eventLoopDelayP95Ms.toFixed(1)}ms</div>
                  <MiniMeter value={loadRatio} tone={loadTone} />
                </Cell>
                <Cell align="right">
                  {formatBytes(machine.memoryRssBytes)}
                  <div className="text-[11px] text-white/40">{formatBytes(machine.systemFreeMemoryBytes)} free</div>
                </Cell>
                <Cell align="right">{formatNumber(machine.localCcu)}</Cell>
                <Cell>{formatAge(machine.latestUpdatedAtMs)}</Cell>
              </tr>
            );
          })}
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
                <Pill tone={room.phase === 'playing' ? 'success' : 'neutral'}>{room.phase}</Pill>
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
                <Pill tone={lobby.status === 'open' ? 'success' : 'neutral'}>{lobby.status}</Pill>
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
      className="h-7 rounded-md border border-white/10 bg-white/[0.04] px-2.5 font-body text-[11px] font-semibold uppercase text-white/70 transition hover:border-accent-primary/45 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
}

function AdminSelect({
  label,
  value,
  options,
  disabled,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: AdminSelectOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  const updateMenuPosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportPadding = 12;
    const menuWidth = Math.min(Math.max(rect.width, 280), window.innerWidth - viewportPadding * 2);
    const left = Math.min(Math.max(rect.left, viewportPadding), window.innerWidth - menuWidth - viewportPadding);
    const availableBelow = Math.max(160, window.innerHeight - rect.bottom - 12);
    setMenuStyle({
      position: 'fixed',
      left: Math.round(left),
      top: Math.round(rect.bottom + 4),
      width: Math.round(menuWidth),
      maxHeight: Math.min(320, availableBelow),
    });
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    updateMenuPosition();

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const menu = open && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={menuRef}
        id={menuId}
        role="listbox"
        aria-label={label}
        style={menuStyle}
        className="z-50 overflow-auto rounded-md border border-white/10 bg-strike-panel-raised py-1 shadow-[0_18px_44px_rgb(0_0_0_/_0.55)] backdrop-blur"
      >
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <button
              key={option.value || 'exact'}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cx(
                'flex w-full items-start justify-between gap-3 px-3 py-2 text-left font-body text-xs transition',
                isSelected
                  ? 'bg-accent-primary/15 text-white'
                  : 'text-white/74 hover:bg-white/[0.055] hover:text-white',
              )}
            >
              <span className="min-w-0">
                <span className="block whitespace-nowrap">{option.label}</span>
                {option.detail && <span className="mt-0.5 block whitespace-nowrap font-mono text-[11px] text-white/38">{option.detail}</span>}
              </span>
              <span className={cx('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', isSelected ? 'bg-accent-primary' : 'bg-transparent')} />
            </button>
          );
        })}
      </div>,
      document.body,
    )
    : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          updateMenuPosition();
          setOpen(true);
        }}
        className={cx(
          'flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-white/10 bg-black/30 px-2.5 font-body text-xs text-white outline-none transition hover:border-white/20 focus:border-accent-primary/55 disabled:cursor-not-allowed disabled:opacity-45',
          open && 'border-accent-primary/55 bg-black/45',
          className,
        )}
      >
        <span className="truncate">{selected?.label ?? 'Select'}</span>
        <span aria-hidden="true" className="shrink-0 font-mono text-[10px] text-white/40">v</span>
      </button>
      {menu}
    </>
  );
}

function AdminTabs({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: AdminTab[];
  activeTab: AdminTabId;
  onChange: (tab: AdminTabId) => void;
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div role="tablist" aria-label="Admin sections" className="flex min-w-max gap-1.5">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`admin-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`admin-panel-${tab.id}`}
              onClick={() => onChange(tab.id)}
              className={cx(
                'group flex h-9 min-w-[8.5rem] items-center justify-between gap-3 rounded-md border px-3 font-body text-xs font-semibold uppercase transition',
                isActive
                  ? 'border-accent-primary/55 bg-accent-primary/15 text-white shadow-[inset_0_1px_0_rgb(var(--color-strike-border)_/_0.08)]'
                  : 'border-white/10 bg-white/[0.035] text-white/55 hover:border-white/20 hover:bg-white/[0.06] hover:text-white/80',
              )}
            >
              <span>{tab.label}</span>
              <Pill tone={isActive ? tab.tone : 'neutral'} className="px-1.5 py-0 text-[10px] leading-4">
                {tab.meta}
              </Pill>
            </button>
          );
        })}
      </div>
    </div>
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
    <div className="grid gap-3 border-b border-white/10 bg-black/20 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.38fr)]">
      <div className="min-w-0">
        <label htmlFor="global-notification-message" className="font-body text-[10px] font-semibold uppercase text-white/45">
          Message
        </label>
        <textarea
          id="global-notification-message"
          value={draft}
          maxLength={240}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="Maintenance starts in 10 minutes."
          className="mt-2 min-h-[64px] w-full resize-y rounded-md border border-white/10 bg-black/30 px-3 py-2 font-body text-xs leading-relaxed text-white outline-none transition placeholder:text-white/25 focus:border-accent-primary/55 focus:bg-black/40"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="font-body text-[11px] text-white/40">{trimmedDraft.length} / 240</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!trimmedDraft || busy}
              onClick={onSave}
              className="h-7 rounded-md border border-accent-primary/45 bg-accent-primary/20 px-3 font-body text-[11px] font-semibold uppercase text-white transition hover:border-accent-primary/70 hover:bg-accent-primary/30 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-white/35"
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
        <div className="font-body text-[10px] font-semibold uppercase text-white/45">Current</div>
        {notification ? (
          <>
            <div className="mt-2"><Pill tone="warning">Active</Pill></div>
            <p className="mt-2 break-words font-body text-xs leading-relaxed text-white/80">{notification.message}</p>
            <div className="mt-2 font-body text-[11px] text-white/40">
              Updated {formatDate(notification.updatedAt)}
            </div>
          </>
        ) : (
          <>
            <div className="mt-2"><Pill>Off</Pill></div>
            <p className="mt-2 font-body text-xs text-white/45">No active message.</p>
          </>
        )}
      </div>
    </div>
  );
}

function SkinShopPanel({
  overview,
  settingsDraft,
  itemDrafts,
  dirtyById,
  busySettings,
  busyItemId,
  onSettingsDraftChange,
  onItemDraftChange,
  onSaveSettings,
  onSaveItem,
}: {
  overview: SkinShopOverview;
  settingsDraft: SkinShopSettingsDraft;
  itemDrafts: Record<string, SkinShopItemDraft>;
  dirtyById: Record<string, boolean>;
  busySettings: boolean;
  busyItemId: string | null;
  onSettingsDraftChange: (draft: SkinShopSettingsDraft) => void;
  onItemDraftChange: (skinId: string, draft: SkinShopItemDraft) => void;
  onSaveSettings: () => void;
  onSaveItem: (skinId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 rounded-md border border-accent-primary/25 bg-black/20 p-3 lg:grid-cols-[0.4fr_1fr_1fr_0.45fr_0.45fr_auto] lg:items-end">
        <div>
          <div className="font-body text-[10px] font-semibold uppercase text-white/45">Shop</div>
          <button
            type="button"
            disabled={busySettings}
            aria-pressed={settingsDraft.enabled}
            onClick={() => onSettingsDraftChange({ ...settingsDraft, enabled: !settingsDraft.enabled })}
            className={`mt-2 h-8 rounded-md border px-3 font-body text-[11px] font-semibold uppercase transition disabled:cursor-wait ${
              settingsDraft.enabled
                ? 'border-ui-success/45 bg-ui-success/15 text-emerald-100'
                : 'border-white/10 bg-white/[0.04] text-white/60 hover:border-ui-success/35'
            }`}
          >
            {settingsDraft.enabled ? 'Enabled' : 'Locked'}
          </button>
        </div>

        <label className="block min-w-0">
          <span className="font-body text-[10px] font-semibold uppercase text-white/45">Token Mint</span>
          <input
            value={settingsDraft.tokenMintAddress}
            disabled={busySettings}
            onChange={(event) => onSettingsDraftChange({ ...settingsDraft, tokenMintAddress: event.target.value })}
            className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-mono text-xs text-white outline-none transition placeholder:text-white/25 focus:border-accent-primary/55"
            placeholder="SPL mint address"
          />
        </label>

        <label className="block min-w-0">
          <span className="font-body text-[10px] font-semibold uppercase text-white/45">Treasury Wallet</span>
          <input
            value={settingsDraft.treasuryWallet}
            disabled={busySettings}
            onChange={(event) => onSettingsDraftChange({ ...settingsDraft, treasuryWallet: event.target.value })}
            className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-mono text-xs text-white outline-none transition placeholder:text-white/25 focus:border-accent-primary/55"
            placeholder="Treasury owner wallet"
          />
        </label>

        <label className="block">
          <span className="font-body text-[10px] font-semibold uppercase text-white/45">Symbol</span>
          <input
            value={settingsDraft.tokenSymbol}
            disabled={busySettings}
            maxLength={16}
            onChange={(event) => onSettingsDraftChange({ ...settingsDraft, tokenSymbol: event.target.value.toUpperCase() })}
            className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-body text-xs text-white outline-none transition focus:border-accent-primary/55"
          />
        </label>

        <label className="block">
          <span className="font-body text-[10px] font-semibold uppercase text-white/45">Cluster</span>
          <input
            value={settingsDraft.cluster}
            disabled={busySettings}
            onChange={(event) => onSettingsDraftChange({ ...settingsDraft, cluster: event.target.value })}
            className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-body text-xs text-white outline-none transition focus:border-accent-primary/55"
          />
        </label>

        <button
          type="button"
          disabled={busySettings}
          onClick={onSaveSettings}
          className="h-8 rounded-md border border-accent-primary/45 bg-accent-primary/20 px-3 font-body text-[11px] font-semibold uppercase text-white transition hover:border-accent-primary/70 hover:bg-accent-primary/30 disabled:cursor-wait disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-white/35"
        >
          Save Shop
        </button>

        <label className="block min-w-0 lg:col-span-5">
          <span className="font-body text-[10px] font-semibold uppercase text-white/45">RPC URL</span>
          <input
            value={settingsDraft.rpcUrl}
            disabled={busySettings}
            onChange={(event) => onSettingsDraftChange({ ...settingsDraft, rpcUrl: event.target.value })}
            className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-mono text-xs text-white outline-none transition placeholder:text-white/25 focus:border-accent-primary/55"
            placeholder={overview.shop.rpcConfigured ? 'Configured. Enter a new URL to rotate.' : 'RPC URL required before enabling purchases'}
          />
        </label>
        <div className="flex items-end justify-end">
          <Pill tone={overview.shop.rpcConfigured ? 'success' : 'warning'}>
            RPC {overview.shop.rpcConfigured ? 'set' : 'missing'}
          </Pill>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {overview.items.map((item) => {
          const draft = itemDrafts[item.settings.skinId] ?? {
            saleEnabled: item.settings.saleEnabled,
            tokenAmountBaseUnits: item.settings.tokenAmountBaseUnits ?? '',
            displayNote: item.settings.displayNote ?? '',
            expectedPriceVersion: item.settings.priceVersion,
          };
          const busy = busyItemId === item.settings.skinId;
          const canSave = !busy && Boolean(dirtyById[item.settings.skinId]);
          return (
            <article key={item.settings.skinId} className="rounded-md border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-display text-lg leading-none text-white">{item.skin.displayName}</h3>
                  <p className="mt-1 font-body text-[11px] uppercase text-white/45">
                    {item.settings.skinId} · v{item.settings.priceVersion}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={draft.saleEnabled}
                  onClick={() => onItemDraftChange(item.settings.skinId, { ...draft, saleEnabled: !draft.saleEnabled })}
                  className={`h-7 rounded-md border px-3 font-body text-[11px] font-semibold uppercase transition disabled:cursor-wait ${
                    draft.saleEnabled
                      ? 'border-ui-success/45 bg-ui-success/15 text-emerald-100'
                      : 'border-white/10 bg-white/[0.04] text-white/55 hover:border-ui-success/35'
                  }`}
                >
                  {draft.saleEnabled ? 'For Sale' : 'Locked'}
                </button>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_auto] sm:items-end">
                <label className="block">
                  <span className="font-body text-[10px] font-semibold uppercase text-white/45">Base Units</span>
                  <input
                    value={draft.tokenAmountBaseUnits}
                    inputMode="numeric"
                    disabled={busy}
                    onChange={(event) => onItemDraftChange(item.settings.skinId, {
                      ...draft,
                      tokenAmountBaseUnits: event.target.value.replace(/\D/g, ''),
                    })}
                    className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-mono text-xs text-white outline-none transition focus:border-accent-primary/55"
                  />
                </label>
                <label className="block min-w-0">
                  <span className="font-body text-[10px] font-semibold uppercase text-white/45">Display Note</span>
                  <input
                    value={draft.displayNote}
                    disabled={busy}
                    onChange={(event) => onItemDraftChange(item.settings.skinId, { ...draft, displayNote: event.target.value })}
                    className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-body text-xs text-white outline-none transition placeholder:text-white/25 focus:border-accent-primary/55"
                    placeholder="Optional disabled or sale note"
                  />
                </label>
                <button
                  type="button"
                  disabled={!canSave}
                  onClick={() => onSaveItem(item.settings.skinId)}
                  className="h-8 rounded-md border border-accent-primary/45 bg-accent-primary/20 px-3 font-body text-[11px] font-semibold uppercase text-white transition hover:border-accent-primary/70 hover:bg-accent-primary/30 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-white/35"
                >
                  Save
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 font-body text-[11px] text-white/42">
                <Pill>{item.settings.tokenAmountBaseUnits ?? 'no price'} {overview.shop.tokenSymbol}</Pill>
                <Pill tone={item.settings.saleEnabled ? 'success' : 'warning'}>{item.settings.saleEnabled ? 'sale enabled' : 'sale locked'}</Pill>
                {item.lastAudit && (
                  <span>
                    Last update {formatDate(item.lastAudit.createdAt)}
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function RankedEntryGatePanel({
  gate,
  draft,
  busy,
  onDraftChange,
  onSave,
}: {
  gate: RankedEntryGateOverview;
  draft: RankedEntryGateDraft;
  busy: boolean;
  onDraftChange: (draft: RankedEntryGateDraft) => void;
  onSave: () => void;
}) {
  const tokenMint = draft.tokenMintAddress.trim();
  const tokenSymbol = draft.tokenSymbol.trim().replace(/^\$/, '').toUpperCase();
  const requiredTokenAmount = draft.requiredTokenAmount.trim();
  const tokenRequired = draft.mode === 'token_required';
  const draftValid = (
    !tokenRequired ||
    (tokenMint.length > 0 && /^[A-Z0-9]{1,12}$/.test(tokenSymbol) && isPositiveWholeNumberString(requiredTokenAmount))
  );
  const canSave = !busy && draftValid;
  const currentTone: Tone = gate.mode === 'token_required' ? 'success' : 'warning';

  return (
    <div className="grid gap-3 border-b border-white/10 bg-black/20 p-3 lg:grid-cols-[minmax(15rem,0.32fr)_minmax(0,1fr)]">
      <div className="min-w-0 rounded-md border border-amber-300/25 bg-white/[0.025] p-3">
        <div className="font-body text-[10px] font-semibold uppercase text-amber-200/70">Ranked Entry</div>
        <div className="mt-2"><Pill tone={currentTone}>{formatRankedEntryGateMode(gate.mode)}</Pill></div>
        <div className="mt-3 break-all font-mono text-xs text-white/50">
          {gate.tokenMintAddress ? formatCompactIdentifier(gate.tokenMintAddress, 6, 6) : 'No token mint'}
        </div>
        <div className="mt-2 font-body text-[11px] text-white/40">
          {gate.requiredTokenAmount} {gate.tokenSymbol} required
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Pill tone={gate.rpcConfigured ? 'success' : 'warning'}>{gate.rpcConfigured ? 'RPC ready' : 'RPC missing'}</Pill>
          <Pill>{gate.cluster}</Pill>
        </div>
      </div>

      <div className="min-w-0">
        <div className="grid gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(6rem,0.25fr)_minmax(10rem,0.45fr)_auto] md:items-end">
          <div>
            <div className="font-body text-[10px] font-semibold uppercase text-white/45">Mode</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(['locked', 'token_required'] as RankedEntryGateMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={draft.mode === mode}
                  disabled={busy}
                  onClick={() => onDraftChange({ ...draft, mode })}
                  className={`h-7 rounded-md border px-3 font-body text-[11px] font-semibold uppercase transition disabled:cursor-wait ${
                    draft.mode === mode
                      ? 'border-amber-300/55 bg-amber-300/15 text-amber-100'
                      : 'border-white/10 bg-white/[0.04] text-white/65 hover:border-amber-300/35 hover:text-white'
                  }`}
                >
                  {mode === 'token_required' ? 'Token' : 'Locked'}
                </button>
              ))}
            </div>
          </div>

          <label className="block min-w-0">
            <span className="font-body text-[10px] font-semibold uppercase text-white/45">Mint Address</span>
            <input
              type="text"
              value={draft.tokenMintAddress}
              disabled={busy}
              onChange={(event) => onDraftChange({ ...draft, tokenMintAddress: event.target.value })}
              placeholder="SPL mint address"
              className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-mono text-xs text-white outline-none transition placeholder:text-white/25 focus:border-amber-300/55"
            />
          </label>

          <label className="block">
            <span className="font-body text-[10px] font-semibold uppercase text-white/45">Symbol</span>
            <input
              type="text"
              value={draft.tokenSymbol}
              disabled={busy}
              maxLength={12}
              onChange={(event) => onDraftChange({ ...draft, tokenSymbol: event.target.value.toUpperCase() })}
              className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-body text-xs text-white outline-none transition focus:border-amber-300/55"
            />
          </label>

          <label className="block">
            <span className="font-body text-[10px] font-semibold uppercase text-white/45">Tokens Required</span>
            <input
              type="text"
              inputMode="numeric"
              value={draft.requiredTokenAmount}
              disabled={busy}
              onChange={(event) => onDraftChange({ ...draft, requiredTokenAmount: event.target.value.replace(/\D/g, '') })}
              className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-mono text-xs text-white outline-none transition focus:border-amber-300/55"
            />
          </label>

          <button
            type="button"
            disabled={!canSave}
            onClick={onSave}
            className="h-8 rounded-md border border-amber-300/45 bg-amber-300/15 px-3 font-body text-[11px] font-semibold uppercase text-amber-100 transition hover:border-amber-300/70 hover:bg-amber-300/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-white/35"
          >
            Save Gate
          </button>
        </div>

        <div className={`mt-3 rounded-md border px-3 py-2 font-body text-[11px] ${
          tokenRequired
            ? draftValid
              ? 'border-ui-success/30 bg-ui-success/10 text-emerald-100'
              : 'border-ui-warning/35 bg-ui-warning/10 text-yellow-100'
            : 'border-white/10 bg-white/[0.025] text-white/42'
        }`}>
          {tokenRequired
            ? draftValid
              ? 'Ranked will require the configured whole-token amount.'
              : 'Token mode needs a mint address, symbol, and positive whole-token amount.'
            : 'Ranked entry is locked until token mode is enabled.'}
        </div>
      </div>
    </div>
  );
}

function RankedSeasonPanel({
  season,
  draft,
  busy,
  onDraftChange,
  onSave,
}: {
  season: RankedSeasonOverview;
  draft: RankedSeasonDraft;
  busy: boolean;
  onDraftChange: (draft: RankedSeasonDraft) => void;
  onSave: () => void;
}) {
  const currentIdentity = getRankedSeasonIdentity(season.mode, season.seasonNumber);
  const nextSeasonNumber = Number(draft.seasonNumber);
  const invalidSeasonNumber = !Number.isFinite(nextSeasonNumber) || nextSeasonNumber < 1 || nextSeasonNumber > 999;
  const nextIdentity = getRankedSeasonIdentity(draft.mode, nextSeasonNumber);
  const willReset = currentIdentity !== nextIdentity;
  const boundaryLabel = draft.mode === 'preseason' ? 'Next Season Begins At' : 'Ends At';

  return (
    <div className="grid gap-3 border-b border-white/10 bg-black/20 p-3 lg:grid-cols-[minmax(15rem,0.32fr)_minmax(0,1fr)]">
      <div className="ranked-season-admin-card min-w-0 rounded-md border border-accent-primary/25 p-3">
        <div className="font-body text-[10px] font-semibold uppercase text-accent-primary/75">Ranked Cycle</div>
        <div className="mt-2 font-body text-2xl font-semibold leading-none text-white">{season.label}</div>
        <div className="mt-2">
          <Pill>{formatSeasonBoundary(season.mode, season.endsAt)}</Pill>
        </div>
        <div className="mt-2 font-body text-[11px] text-white/40">
          Last reset {season.lastResetAt ? formatDate(season.lastResetAt) : 'not recorded'}
        </div>
      </div>

      <div className="min-w-0">
        <div className="grid gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(7rem,0.35fr)_minmax(12rem,0.55fr)_auto] md:items-end">
          <div>
            <div className="font-body text-[10px] font-semibold uppercase text-white/45">Mode</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(['season', 'preseason'] as RankedSeasonMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={draft.mode === mode}
                  disabled={busy}
                  onClick={() => onDraftChange({ ...draft, mode })}
                  className={`h-7 rounded-md border px-3 font-body text-[11px] font-semibold uppercase transition disabled:cursor-wait ${
                    draft.mode === mode
                      ? 'border-accent-primary/55 bg-accent-primary/20 text-white'
                      : 'border-white/10 bg-white/[0.04] text-white/65 hover:border-accent-primary/35 hover:text-white'
                  }`}
                >
                  {mode === 'season' ? 'Season' : 'Pre-Season'}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="font-body text-[10px] font-semibold uppercase text-white/45">Number</span>
            <input
              type="number"
              min={1}
              max={999}
              value={draft.seasonNumber}
              disabled={busy || draft.mode === 'preseason'}
              onChange={(event) => onDraftChange({ ...draft, seasonNumber: event.target.value })}
              className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-body text-xs text-white outline-none transition focus:border-accent-primary/55 disabled:opacity-45"
            />
          </label>

          <label className="block">
            <span className="font-body text-[10px] font-semibold uppercase text-white/45">{boundaryLabel}</span>
            <input
              type="datetime-local"
              value={draft.endsAtLocal}
              disabled={busy}
              onChange={(event) => onDraftChange({ ...draft, endsAtLocal: event.target.value })}
              title={boundaryLabel}
              className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-body text-xs text-white outline-none transition focus:border-accent-primary/55"
            />
          </label>

          <button
            type="button"
            disabled={busy || (draft.mode === 'season' && invalidSeasonNumber)}
            onClick={onSave}
            className="h-8 rounded-md border border-accent-primary/45 bg-accent-primary/20 px-3 font-body text-[11px] font-semibold uppercase text-white transition hover:border-accent-primary/70 hover:bg-accent-primary/30 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-white/35"
          >
            Save Season
          </button>
        </div>

        <div className={`mt-3 rounded-md border px-3 py-2 font-body text-[11px] ${
          willReset
            ? 'border-ui-warning/35 bg-ui-warning/10 text-yellow-100'
            : 'border-white/10 bg-white/[0.025] text-white/42'
        }`}>
          {willReset
            ? 'Changing this season will archive the current season and reset player ratings to ranked defaults.'
            : 'Schedule edits keep ranked stats intact.'}
        </div>
      </div>
    </div>
  );
}

function PlayerRankPanel({
  users,
  pagination,
  search,
  reason,
  drafts,
  loading,
  busyUserId,
  onSearchChange,
  onReasonChange,
  onSearch,
  onClearSearch,
  onPageChange,
  onDraftChange,
  onSave,
}: {
  users: AdminRankUser[];
  pagination: AdminUsersPagination;
  search: string;
  reason: string;
  drafts: Record<string, string>;
  loading: boolean;
  busyUserId: string | null;
  onSearchChange: (search: string) => void;
  onReasonChange: (reason: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
  onPageChange: (page: number) => void;
  onDraftChange: (userId: string, rating: string) => void;
  onSave: (user: AdminRankUser) => void;
}) {
  const firstVisible = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const lastVisible = Math.min(pagination.total, pagination.page * pagination.limit);
  const rankGateSelectOptions = useMemo<AdminSelectOption[]>(() => [
    {
      value: '',
      label: 'Exact override',
      detail: 'Use the rating field',
    },
    ...RANK_OPTIONS.map((option) => ({
      value: option.rating.toString(),
      label: option.label,
      detail: `${option.rangeLabel} range / ${formatNumber(option.rating)} floor`,
    })),
  ], []);

  return (
    <div>
      <form
        className="grid gap-3 border-b border-white/10 bg-black/20 p-3 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <label className="block min-w-0">
          <span className="font-body text-[10px] font-semibold uppercase text-white/45">Search</span>
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Name, wallet, or user id"
            className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-body text-xs text-white outline-none transition placeholder:text-white/25 focus:border-accent-primary/55"
          />
        </label>

        <label className="block min-w-0">
          <span className="font-body text-[10px] font-semibold uppercase text-white/45">Reason</span>
          <input
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="Manual correction"
            className="mt-2 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-body text-xs text-white outline-none transition placeholder:text-white/25 focus:border-accent-primary/55"
          />
        </label>

        <div className="flex items-end gap-2">
          <button
            type="submit"
            disabled={loading}
            className="h-8 rounded-md border border-accent-primary/45 bg-accent-primary/20 px-3 font-body text-[11px] font-semibold uppercase text-white transition hover:border-accent-primary/70 hover:bg-accent-primary/30 disabled:cursor-wait disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-white/35"
          >
            Search
          </button>
          <ActionButton disabled={loading} onClick={onClearSearch}>
            Clear
          </ActionButton>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-white/[0.018] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="amber">{formatNumber(pagination.total)} users</Pill>
          <span className="font-body text-[11px] text-white/42">
            Showing {formatNumber(firstVisible)}-{formatNumber(lastVisible)} / page {formatNumber(pagination.page)} of {formatNumber(pagination.totalPages)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ActionButton disabled={loading || !pagination.hasPrevious} onClick={() => onPageChange(pagination.page - 1)}>
            Prev
          </ActionButton>
          <span className="min-w-[5.5rem] text-center font-mono text-[11px] text-white/45">
            {formatNumber(pagination.page)} / {formatNumber(pagination.totalPages)}
          </span>
          <ActionButton disabled={loading || !pagination.hasNext} onClick={() => onPageChange(pagination.page + 1)}>
            Next
          </ActionButton>
        </div>
      </div>

      {users.length === 0 ? (
        <EmptyTable label={loading ? 'Loading players.' : 'No users found.'} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1480px] table-fixed border-collapse">
            <colgroup>
              <col className="w-[15%]" />
              <col className="w-[13%]" />
              <col className="w-[21%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
              <col className="w-[9%]" />
            </colgroup>
            <thead>
              <tr>
                <HeaderCell>Player</HeaderCell>
                <HeaderCell>Current</HeaderCell>
                <HeaderCell>Target</HeaderCell>
                <HeaderCell>Ranked Record</HeaderCell>
                <HeaderCell>Total Record</HeaderCell>
                <HeaderCell>Peak</HeaderCell>
                <HeaderCell>Actions</HeaderCell>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const draft = drafts[user.id] ?? user.competitiveRating.toString();
                const parsedRating = parseDraftRating(draft);
                const canSave = parsedRating !== null && parsedRating !== user.competitiveRating && busyUserId !== user.id;
                const optionValue = parsedRating === null
                  ? ''
                  : RANK_OPTIONS.some((option) => option.rating === parsedRating)
                    ? parsedRating.toString()
                    : '';
                const preview = getRankPreview(draft, user.rankedGames);
                const currentRank = getRankFromRating(user.competitiveRating, user.rankedGames);
                const peakRank = getRankFromRating(user.rankedPeakRating, user.rankedGames);

                return (
                  <tr key={user.id} className="hover:bg-white/[0.025]">
                    <Cell>
                      <div className="truncate text-white">{user.name}</div>
                      {user.walletAddress && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <span
                            title={user.walletAddress}
                            className="inline-flex max-w-full items-center rounded border border-white/10 bg-white/[0.025] px-1.5 py-0.5 font-mono text-[10px] leading-none text-white/35"
                          >
                            Wallet {formatCompactIdentifier(user.walletAddress)}
                          </span>
                        </div>
                      )}
                      <div className="mt-1.5 text-[11px] text-white/35">
                        Last login {user.lastLoginAt ? formatAge(Date.parse(user.lastLoginAt)) : 'never'}
                      </div>
                    </Cell>
                    <Cell>
                      <RankBadge rank={currentRank} compact className="max-w-full rounded-md" />
                      <div className="mt-2 text-[11px] text-white/45">{formatNumber(user.competitiveRating)} rating</div>
                      <div className="mt-1 font-mono text-[11px] text-white/35">{user.rank.rangeLabel}</div>
                    </Cell>
                    <Cell>
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(6.5rem,0.42fr)]">
                        <AdminSelect
                          label={`Target rank gate for ${user.name}`}
                          value={optionValue}
                          disabled={busyUserId === user.id}
                          options={rankGateSelectOptions}
                          onChange={(nextValue) => {
                            if (nextValue) onDraftChange(user.id, nextValue);
                          }}
                        />

                        <input
                          type="number"
                          min={0}
                          max={ADMIN_MANUAL_RATING_MAX}
                          value={draft}
                          disabled={busyUserId === user.id}
                          onChange={(event) => onDraftChange(user.id, event.target.value)}
                          className="h-8 w-full rounded-md border border-white/10 bg-black/30 px-2.5 font-mono text-xs text-white outline-none transition focus:border-accent-primary/55"
                        />
                      </div>
                      <div className={`mt-2 font-body text-[11px] ${parsedRating === null ? 'text-red-200/70' : 'text-white/42'}`}>
                        {preview.rating === null
                          ? preview.label
                          : (
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <RankBadge rank={getRankFromRating(preview.rating, user.rankedGames)} compact className="max-w-full rounded-md py-1" />
                              <span className="text-white/42">
                                Gate {preview.gateLabel} / range <span className="font-mono text-white/45">{preview.rangeLabel}</span>
                              </span>
                            </div>
                          )}
                      </div>
                    </Cell>
                    <Cell>
                      <div className="text-white/80">{formatNumber(user.rankedWins)}W / {formatNumber(user.rankedLosses)}L / {formatNumber(user.rankedDraws)}D</div>
                      <div className="mt-1 text-[11px] text-white/40">{formatCount(user.rankedGames, 'ranked game')}</div>
                      <div className="mt-1 text-[11px] text-white/35">Last ranked {user.rankedLastMatchAt ? formatAge(Date.parse(user.rankedLastMatchAt)) : 'never'}</div>
                    </Cell>
                    <Cell>
                      <div className="text-white/80">{formatNumber(user.totalWins)}W / {formatNumber(user.totalLosses)}L / {formatNumber(user.totalDraws)}D</div>
                      <div className="mt-1 text-[11px] text-white/40">{formatCount(user.totalGames, 'game')}</div>
                      <div className="mt-1 text-[11px] text-white/35">Updated {formatAge(Date.parse(user.updatedAt))}</div>
                    </Cell>
                    <Cell>
                      <RankBadge rank={peakRank} compact className="max-w-full rounded-md" />
                      <div className="mt-2 text-[11px] text-white/45">{formatNumber(user.rankedPeakRating)} rating</div>
                      <div className="mt-1 font-mono text-[11px] text-white/35">{user.peakRank.rangeLabel}</div>
                    </Cell>
                    <Cell>
                      <div className="flex flex-wrap gap-2">
                        <ActionButton disabled={!canSave} onClick={() => onSave(user)}>
                          Save Rank
                        </ActionButton>
                      </div>
                    </Cell>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
      className={`h-7 rounded-md border px-3 font-body text-[11px] font-semibold uppercase transition disabled:cursor-default ${
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
      <div className="grid gap-3 border-b border-white/10 bg-black/20 p-3 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <div className="font-body text-[10px] font-semibold uppercase text-white/45">Distribution</div>
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
          <div className="mt-2 font-body text-[11px] text-white/40">{overview.settings.distributionMode} payout mode</div>
        </div>

        <div className="min-w-0">
          <div className="font-body text-[10px] font-semibold uppercase text-white/45">Treasury</div>
          <div className="mt-2">
            <Pill tone={treasury.eligible ? 'success' : 'warning'}>
              {treasury.eligible ? 'Eligible' : treasury.reason || 'Not eligible'}
            </Pill>
          </div>
          <div className="mt-2 break-all font-mono text-xs text-white/45">
            {treasury.treasuryWallet || overview.settings.treasuryWallet || 'No treasury wallet'}
          </div>
          <div className="mt-1 font-body text-[11px] text-white/40">
            {lamportsToSolDisplay(treasury.treasuryBalanceLamports)} SOL balance / {lamportsToSolDisplay(treasury.requiredLamports)} SOL minimum
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 md:min-w-[14rem]">
          <MetricTile label="Reward" value={formatUsdCents(overview.settings.winnerRewardUsdCents)} sublabel="per winner" tone="amber" />
          <MetricTile label="Chance" value={formatBps(overview.settings.chanceBps)} sublabel={`${formatNumber(pendingRewards)} pending`} tone="warning" />
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
                  <Pill tone={toneForSystemStatus(reward.status)}>{reward.status}</Pill>
                  <div className="mt-2 text-[11px] text-white/40">{reward.distributionMode}</div>
                  {reward.distributedAt && <div className="mt-1 text-[11px] text-white/35">sent {formatDate(reward.distributedAt)}</div>}
                </Cell>
                <Cell>
                  <div className="text-white">{reward.winningTeam}</div>
                  <div className="mt-1 text-[11px] text-white/40">{formatCount(reward.paidPlayerCount, 'winner')}</div>
                </Cell>
                <Cell align="right">
                  {formatUsdCents(reward.rewardUsdCents)}
                  <div className="text-[11px] text-white/40">{lamportsToSolDisplay(reward.rewardLamports)} SOL each</div>
                  <div className="text-[11px] text-white/35">{lamportsToSolDisplay(reward.totalRewardLamports)} SOL total</div>
                </Cell>
                <Cell>
                  <div className="space-y-2">
                    {reward.transfers.map((transfer) => (
                      <div key={transfer.id} className="min-w-0 border-l border-white/10 pl-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate text-white/80">{transfer.displayName || transfer.userId}</span>
                          <Pill tone={toneForSystemStatus(transfer.status)} className="px-1.5 py-0 text-[10px]">{transfer.status}</Pill>
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
                <Pill tone={toneForSystemStatus(report.status)}>{report.status}</Pill>
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
                {report.details && <div className="mt-1 line-clamp-2 text-[11px] text-white/40">{report.details}</div>}
                {report.resolution && <div className="mt-2 line-clamp-2 text-[11px] text-emerald-100/55">{report.resolution}</div>}
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
  const [activeTab, setActiveTab] = useState<AdminTabId>('overview');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyReportId, setBusyReportId] = useState<string | null>(null);
  const [busyGoldenRewardId, setBusyGoldenRewardId] = useState<string | null>(null);
  const [busyGoldenMode, setBusyGoldenMode] = useState(false);
  const [busyGlobalNotification, setBusyGlobalNotification] = useState(false);
  const [busyRankedSeason, setBusyRankedSeason] = useState(false);
  const [busyRankedEntryGate, setBusyRankedEntryGate] = useState(false);
  const [busySkinShopSettings, setBusySkinShopSettings] = useState(false);
  const [busySkinShopItemId, setBusySkinShopItemId] = useState<string | null>(null);
  const [busyRankUserId, setBusyRankUserId] = useState<string | null>(null);
  const [rankUsersLoading, setRankUsersLoading] = useState(false);
  const [rankUsersLoaded, setRankUsersLoaded] = useState(false);
  const [globalNotificationDraft, setGlobalNotificationDraft] = useState('');
  const [rankedSeasonDraft, setRankedSeasonDraft] = useState<RankedSeasonDraft>({
    mode: 'season',
    seasonNumber: '1',
    endsAtLocal: '',
  });
  const [rankedEntryGateDraft, setRankedEntryGateDraft] = useState<RankedEntryGateDraft>({
    mode: 'locked',
    tokenMintAddress: '',
    tokenSymbol: 'TOKEN',
    requiredTokenAmount: '0',
  });
  const [skinShopDraft, setSkinShopDraft] = useState<SkinShopSettingsDraft>({
    enabled: false,
    tokenMintAddress: '',
    tokenSymbol: 'TOKEN',
    treasuryWallet: '',
    rpcUrl: '',
    cluster: 'devnet',
  });
  const [skinShopItemDrafts, setSkinShopItemDrafts] = useState<Record<string, SkinShopItemDraft>>({});
  const [rankedSeasonDraftDirty, setRankedSeasonDraftDirty] = useState(false);
  const [rankedEntryGateDraftDirty, setRankedEntryGateDraftDirty] = useState(false);
  const [skinShopDraftDirty, setSkinShopDraftDirty] = useState(false);
  const [skinShopItemDraftDirtyById, setSkinShopItemDraftDirtyById] = useState<Record<string, boolean>>({});
  const [rankSearch, setRankSearch] = useState('');
  const [rankReason, setRankReason] = useState('');
  const [rankUsers, setRankUsers] = useState<AdminRankUser[]>([]);
  const [rankUsersPagination, setRankUsersPagination] = useState<AdminUsersPagination>(EMPTY_ADMIN_USERS_PAGINATION);
  const [rankUserDrafts, setRankUserDrafts] = useState<Record<string, string>>({});

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

  const loadRankUsers = useCallback(async (query: string, page = 1) => {
    setRankUsersLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: ADMIN_RANK_PAGE_SIZE.toString(),
        page: Math.max(1, page).toString(),
        query,
      });
      const response = await fetch(`${config.serverHttpUrl}/admin/api/users?${params.toString()}`, {
        credentials: 'include',
        cache: 'no-store',
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: `Admin request failed (${response.status})` }));
        throw new Error(data.error || `Admin request failed (${response.status})`);
      }

      const data = await response.json() as AdminUsersResponse;
      setRankUsers(data.users);
      setRankUsersPagination(data.pagination);
      setRankUserDrafts(Object.fromEntries(data.users.map((user) => [user.id, user.competitiveRating.toString()])));
      setRankUsersLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRankUsersLoaded(true);
    } finally {
      setRankUsersLoading(false);
    }
  }, []);

  const updateRankUserDraft = useCallback((userId: string, rating: string) => {
    setRankUserDrafts((drafts) => ({ ...drafts, [userId]: rating }));
  }, []);

  const searchRankUsers = useCallback(() => {
    void loadRankUsers(rankSearch.trim(), 1);
  }, [loadRankUsers, rankSearch]);

  const clearRankUserSearch = useCallback(() => {
    setRankSearch('');
    void loadRankUsers('', 1);
  }, [loadRankUsers]);

  const changeRankUserPage = useCallback((page: number) => {
    void loadRankUsers(rankSearch.trim(), page);
  }, [loadRankUsers, rankSearch]);

  const saveRankUser = useCallback((user: AdminRankUser) => {
    const rating = parseDraftRating(rankUserDrafts[user.id] ?? user.competitiveRating.toString());
    if (rating === null) {
      setError(`Rating must be between 0 and ${ADMIN_MANUAL_RATING_MAX}`);
      return;
    }

    const nextRank = getRankFromRating(rating, user.rankedGames).label;
    if (!window.confirm(`Set ${user.name} from ${user.rank.label} / ${user.competitiveRating} to ${nextRank} / ${rating}?`)) {
      return;
    }

    setBusyRankUserId(user.id);
    postAdminJson(`/admin/api/users/${encodeURIComponent(user.id)}/rank`, {
      competitiveRating: rating,
      reason: rankReason.trim(),
    })
      .then(() => loadRankUsers(rankSearch.trim(), rankUsersPagination.page))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyRankUserId(null));
  }, [loadRankUsers, postAdminJson, rankReason, rankSearch, rankUserDrafts, rankUsersPagination.page]);

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

  const updateRankedSeasonDraft = useCallback((draft: RankedSeasonDraft) => {
    setRankedSeasonDraft(draft);
    setRankedSeasonDraftDirty(true);
  }, []);

  const updateRankedEntryGateDraft = useCallback((draft: RankedEntryGateDraft) => {
    setRankedEntryGateDraft(draft);
    setRankedEntryGateDraftDirty(true);
  }, []);

  const updateSkinShopDraft = useCallback((draft: SkinShopSettingsDraft) => {
    setSkinShopDraft(draft);
    setSkinShopDraftDirty(true);
  }, []);

  const updateSkinShopItemDraft = useCallback((skinId: string, draft: SkinShopItemDraft) => {
    setSkinShopItemDrafts((drafts) => ({ ...drafts, [skinId]: draft }));
    setSkinShopItemDraftDirtyById((dirty) => ({ ...dirty, [skinId]: true }));
  }, []);

  const saveRankedSeason = useCallback(() => {
    if (!overview?.rankedSeason) return;

    const seasonNumber = Math.floor(Number(rankedSeasonDraft.seasonNumber));
    if (rankedSeasonDraft.mode === 'season' && (!Number.isFinite(seasonNumber) || seasonNumber < 1 || seasonNumber > 999)) {
      setError('Season number must be between 1 and 999');
      return;
    }

    const currentIdentity = getRankedSeasonIdentity(overview.rankedSeason.mode, overview.rankedSeason.seasonNumber);
    const nextIdentity = getRankedSeasonIdentity(rankedSeasonDraft.mode, seasonNumber);
    if (
      currentIdentity !== nextIdentity &&
      !window.confirm('Changing the ranked season archives the current season and resets player ratings. Ranked records are preserved. Continue?')
    ) {
      return;
    }

    setBusyRankedSeason(true);
    postAdminJson('/admin/api/ranked-season', {
      mode: rankedSeasonDraft.mode,
      seasonNumber,
      endsAt: fromDateTimeLocalValue(rankedSeasonDraft.endsAtLocal),
    })
      .then(() => setRankedSeasonDraftDirty(false))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyRankedSeason(false));
  }, [overview?.rankedSeason, postAdminJson, rankedSeasonDraft]);

  const saveRankedEntryGate = useCallback(() => {
    if (!overview?.rankedEntryGate) return;

    const tokenSymbol = rankedEntryGateDraft.tokenSymbol.trim().replace(/^\$/, '').toUpperCase();
    const tokenMintAddress = rankedEntryGateDraft.tokenMintAddress.trim();
    const requiredTokenAmount = rankedEntryGateDraft.requiredTokenAmount.trim();

    if (rankedEntryGateDraft.mode === 'token_required') {
      if (!tokenMintAddress) {
        setError('Ranked token mint is required before enabling token-gated ranked');
        return;
      }
      if (!/^[A-Z0-9]{1,12}$/.test(tokenSymbol)) {
        setError('Ranked token symbol must be 1-12 letters or numbers');
        return;
      }
      if (!isPositiveWholeNumberString(requiredTokenAmount)) {
        setError('Required token amount must be greater than zero');
        return;
      }
      if (overview.rankedEntryGate.mode !== 'token_required' && !window.confirm('Enable ranked token gate with the configured SPL token?')) {
        return;
      }
    } else if (overview.rankedEntryGate.mode !== 'locked' && !window.confirm('Lock ranked entry?')) {
      return;
    }

    setBusyRankedEntryGate(true);
    postAdminJson('/admin/api/ranked-entry-gate', {
      mode: rankedEntryGateDraft.mode,
      tokenMintAddress,
      tokenSymbol,
      requiredTokenAmount,
    })
      .then(() => setRankedEntryGateDraftDirty(false))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyRankedEntryGate(false));
  }, [overview?.rankedEntryGate, postAdminJson, rankedEntryGateDraft]);

  const saveSkinShopSettings = useCallback(() => {
    const tokenSymbol = skinShopDraft.tokenSymbol.trim().replace(/^\$/, '').toUpperCase();
    const tokenMintAddress = skinShopDraft.tokenMintAddress.trim();
    const treasuryWallet = skinShopDraft.treasuryWallet.trim();
    const rpcUrl = skinShopDraft.rpcUrl.trim();
    const cluster = skinShopDraft.cluster.trim() || 'devnet';

    if (skinShopDraft.enabled && (!tokenMintAddress || !treasuryWallet || !rpcUrl)) {
      setError('Token mint, treasury wallet, and RPC URL are required before enabling the skin shop');
      return;
    }
    if (!/^[A-Z0-9]{1,16}$/.test(tokenSymbol)) {
      setError('Skin shop token symbol must be 1-16 letters or numbers');
      return;
    }
    if (skinShopDraft.enabled && !window.confirm('Enable the skin shop with the configured SPL token settings?')) {
      return;
    }

    setBusySkinShopSettings(true);
    postAdminJson('/admin/api/skin-shop/settings', {
      enabled: skinShopDraft.enabled,
      tokenMintAddress,
      tokenSymbol,
      treasuryWallet,
      rpcUrl,
      cluster,
    })
      .then(() => setSkinShopDraftDirty(false))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusySkinShopSettings(false));
  }, [postAdminJson, skinShopDraft]);

  const saveSkinShopItem = useCallback((skinId: string) => {
    const draft = skinShopItemDrafts[skinId];
    if (!draft) return;
    const tokenAmountBaseUnits = draft.tokenAmountBaseUnits.trim();
    if (draft.saleEnabled && !isPositiveWholeNumberString(tokenAmountBaseUnits)) {
      setError('Sale-enabled skins need a positive integer base-unit amount');
      return;
    }

    setBusySkinShopItemId(skinId);
    postAdminJson(`/admin/api/skin-shop/items/${encodeURIComponent(skinId)}`, {
      saleEnabled: draft.saleEnabled,
      tokenAmountBaseUnits,
      displayNote: draft.displayNote.trim(),
      expectedPriceVersion: draft.expectedPriceVersion,
    })
      .then(() => {
        setSkinShopItemDraftDirtyById((dirty) => ({ ...dirty, [skinId]: false }));
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusySkinShopItemId(null));
  }, [postAdminJson, skinShopItemDrafts]);

  useEffect(() => {
    void loadOverview();
    const interval = window.setInterval(() => void loadOverview(), 3000);
    return () => window.clearInterval(interval);
  }, [loadOverview]);

  useEffect(() => {
    if (activeTab !== 'players' || rankUsersLoaded || rankUsersLoading) return;
    void loadRankUsers('', 1);
  }, [activeTab, loadRankUsers, rankUsersLoaded, rankUsersLoading]);

  useEffect(() => {
    setGlobalNotificationDraft(overview?.globalNotification?.message ?? '');
  }, [overview?.globalNotification?.message]);

  useEffect(() => {
    if (!overview?.rankedSeason || rankedSeasonDraftDirty) return;
    setRankedSeasonDraft({
      mode: overview.rankedSeason.mode,
      seasonNumber: overview.rankedSeason.seasonNumber.toString(),
      endsAtLocal: toDateTimeLocalValue(overview.rankedSeason.endsAt),
    });
  }, [
    overview?.rankedSeason?.endsAt,
    overview?.rankedSeason?.mode,
    overview?.rankedSeason?.seasonNumber,
    rankedSeasonDraftDirty,
  ]);

  useEffect(() => {
    if (!overview?.rankedEntryGate || rankedEntryGateDraftDirty) return;
    setRankedEntryGateDraft({
      mode: overview.rankedEntryGate.mode,
      tokenMintAddress: overview.rankedEntryGate.tokenMintAddress ?? '',
      tokenSymbol: overview.rankedEntryGate.tokenSymbol || 'TOKEN',
      requiredTokenAmount: overview.rankedEntryGate.requiredTokenAmount || '0',
    });
  }, [
    overview?.rankedEntryGate?.mode,
    overview?.rankedEntryGate?.requiredTokenAmount,
    overview?.rankedEntryGate?.tokenMintAddress,
    overview?.rankedEntryGate?.tokenSymbol,
    rankedEntryGateDraftDirty,
  ]);

  useEffect(() => {
    if (!overview?.skinShop?.shop || skinShopDraftDirty) return;
    setSkinShopDraft({
      enabled: overview.skinShop.shop.enabled,
      tokenMintAddress: overview.skinShop.shop.tokenMintAddress ?? '',
      tokenSymbol: overview.skinShop.shop.tokenSymbol || 'TOKEN',
      treasuryWallet: overview.skinShop.shop.treasuryWallet ?? '',
      rpcUrl: '',
      cluster: overview.skinShop.shop.cluster || 'devnet',
    });
  }, [
    overview?.skinShop?.shop?.cluster,
    overview?.skinShop?.shop?.enabled,
    overview?.skinShop?.shop?.tokenMintAddress,
    overview?.skinShop?.shop?.tokenSymbol,
    overview?.skinShop?.shop?.treasuryWallet,
    skinShopDraftDirty,
  ]);

  useEffect(() => {
    if (!overview?.skinShop?.items) return;
    setSkinShopItemDrafts((current) => {
      const next = { ...current };
      for (const item of overview.skinShop.items) {
        if (skinShopItemDraftDirtyById[item.settings.skinId]) continue;
        next[item.settings.skinId] = {
          saleEnabled: item.settings.saleEnabled,
          tokenAmountBaseUnits: item.settings.tokenAmountBaseUnits ?? '',
          displayNote: item.settings.displayNote ?? '',
          expectedPriceVersion: item.settings.priceVersion,
        };
      }
      return next;
    });
  }, [overview?.skinShop?.items, skinShopItemDraftDirtyById]);

  const metrics = useMemo<MetricTileProps[]>(() => {
    if (!overview) return [];
    const activeReports = (overview.playerReports?.counts.open ?? 0) + (overview.playerReports?.counts.reviewing ?? 0);
    const pendingGoldenRewards = overview.goldenBiomeRewards?.rewards.filter((reward) => reward.status !== 'complete').length ?? 0;
    const purchasableSkins = overview.skinShop.items.filter((item) => item.settings.saleEnabled).length;
    const capacityTone = overview.capacity.full ? 'danger' : toneForPressure(overview.capacity.capacityPressure);
    return [
      { label: 'Machines', value: formatNumber(overview.totals.runningMachines), sublabel: formatCount(overview.totals.serverProcesses, 'process', 'processes'), tone: 'info' },
      { label: 'Capacity', value: `${formatNumber(overview.capacity.reservedPlayers)} / ${formatNumber(overview.capacity.maxPlayers)}`, sublabel: `${formatNumber(overview.capacity.availablePlayers)} open / ${overview.capacity.source}`, tone: capacityTone, meter: overview.capacity.capacityPressure },
      { label: 'Game Players', value: formatNumber(overview.totals.playersInGame), sublabel: `${formatNumber(overview.totals.botsInGame)} bots`, tone: 'success' },
      { label: 'Game Rooms', value: formatNumber(overview.totals.gameRooms), sublabel: `${formatNumber(overview.totals.participantsInGame)} participants`, tone: 'info' },
      { label: 'Lobby', value: formatNumber(overview.totals.lobbyParticipants), sublabel: formatCount(overview.totals.lobbyRooms, 'lobby', 'lobbies'), tone: 'neutral' },
      { label: 'Ranked', value: overview.rankedSeason.label, sublabel: formatRankedEntryGateMode(overview.rankedEntryGate.mode), tone: overview.rankedEntryGate.mode === 'token_required' ? 'success' : 'amber' },
      { label: 'Skin Shop', value: overview.skinShop.shop.enabled ? 'Online' : 'Locked', sublabel: `${formatNumber(purchasableSkins)} priced`, tone: overview.skinShop.shop.enabled ? 'success' : 'amber' },
      { label: 'Golden Rewards', value: formatNumber(pendingGoldenRewards), sublabel: overview.goldenBiomeRewards?.settings.distributionMode ?? 'manual', tone: pendingGoldenRewards > 0 ? 'warning' : 'success' },
      { label: 'Reports', value: formatNumber(activeReports), sublabel: `${formatNumber(overview.playerReports?.reports.length ?? 0)} listed`, tone: activeReports > 0 ? 'warning' : 'success' },
      { label: 'Clients', value: formatNumber(overview.totals.totalConnectedClients), sublabel: overview.diagnostics.redis.ok ? 'redis ok' : `redis ${overview.diagnostics.redis.status}`, tone: overview.diagnostics.redis.ok ? 'success' : 'danger' },
    ];
  }, [overview]);

  const tabs = useMemo<AdminTab[]>(() => {
    if (!overview) return [];
    const activeReports = (overview.playerReports?.counts.open ?? 0) + (overview.playerReports?.counts.reviewing ?? 0);
    const pendingGoldenRewards = overview.goldenBiomeRewards?.rewards.filter((reward) => reward.status !== 'complete').length ?? 0;
    const totalRooms = overview.rooms.game.length + overview.rooms.lobbies.length;
    const capacityTone = overview.capacity.full ? 'danger' : toneForPressure(overview.capacity.capacityPressure);

    return [
      {
        id: 'overview',
        label: 'Overview',
        meta: overview.status,
        tone: toneForSystemStatus(overview.status),
      },
      {
        id: 'operations',
        label: 'Operations',
        meta: overview.globalNotification ? 'message on' : formatRankedEntryGateMode(overview.rankedEntryGate.mode),
        tone: overview.globalNotification ? 'warning' : 'amber',
      },
      {
        id: 'players',
        label: 'Players',
        meta: 'rank edit',
        tone: 'amber',
      },
      {
        id: 'servers',
        label: 'Servers',
        meta: `${formatNumber(overview.machines.length)} machines`,
        tone: capacityTone,
      },
      {
        id: 'rooms',
        label: 'Rooms',
        meta: `${formatNumber(totalRooms)} active`,
        tone: totalRooms > 0 ? 'info' : 'neutral',
      },
      {
        id: 'rewards',
        label: 'Rewards',
        meta: `${formatNumber(pendingGoldenRewards)} pending`,
        tone: pendingGoldenRewards > 0 ? 'warning' : 'success',
      },
      {
        id: 'reports',
        label: 'Reports',
        meta: `${formatNumber(activeReports)} active`,
        tone: activeReports > 0 ? 'warning' : 'success',
      },
    ];
  }, [overview]);

  return (
    <main className="admin-dashboard h-dvh overflow-y-auto bg-strike-bg text-white">
      <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-3 px-3 py-3 md:px-4">
        <header className="sticky top-0 z-20 -mx-3 flex flex-col gap-3 border-b border-white/10 bg-strike-bg/90 px-3 py-3 backdrop-blur-xl md:-mx-4 md:px-4">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div className="min-w-0">
              <h1 className="font-body text-2xl font-semibold leading-none text-white">SLOP HEROES Admin</h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {overview && <StatusPill status={overview.status} />}
              {overview?.admin.elevatedAntiCheatRole && <Pill tone="info">Anti-cheat</Pill>}
              <ActionButton onClick={() => void loadOverview()}>Refresh</ActionButton>
            </div>
          </div>

          {overview && <AdminTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />}
        </header>

        {error && (
          <div className="rounded-md border border-ui-danger/40 bg-ui-danger/10 px-3 py-2 font-body text-xs text-red-100">
            {error}
          </div>
        )}

        {overview?.diagnostics.warnings && overview.diagnostics.warnings.length > 0 && (
          <div className="rounded-md border border-ui-warning/40 bg-ui-warning/10 px-3 py-2 font-body text-xs text-yellow-100">
            {overview.diagnostics.warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        )}

        {overview ? (
          <>
            {overview.capacity.full && (
              <div className="rounded-md border border-ui-warning/45 bg-ui-warning/10 px-3 py-2 font-body text-xs text-yellow-100">
                Max in-game players hit: {formatNumber(overview.capacity.reservedPlayers)} / {formatNumber(overview.capacity.maxPlayers)} reserved across {formatNumber(overview.capacity.maxMachines)} machines. Queued players will wait until a match frees space.
              </div>
            )}

            {activeTab === 'overview' && (
              <div
                role="tabpanel"
                id="admin-panel-overview"
                aria-labelledby="admin-tab-overview"
                className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:grid-cols-10"
              >
                {metrics.map((metric) => (
                  <MetricTile key={metric.label} {...metric} />
                ))}
              </div>
            )}

            {activeTab === 'operations' && (
              <div
                role="tabpanel"
                id="admin-panel-operations"
                aria-labelledby="admin-tab-operations"
                className="flex flex-col gap-3"
              >
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

                <Section title="Skin Shop" meta={overview.skinShop.shop.enabled ? 'online' : 'locked'}>
                  <SkinShopPanel
                    overview={overview.skinShop}
                    settingsDraft={skinShopDraft}
                    itemDrafts={skinShopItemDrafts}
                    dirtyById={skinShopItemDraftDirtyById}
                    busySettings={busySkinShopSettings}
                    busyItemId={busySkinShopItemId}
                    onSettingsDraftChange={updateSkinShopDraft}
                    onItemDraftChange={updateSkinShopItemDraft}
                    onSaveSettings={saveSkinShopSettings}
                    onSaveItem={saveSkinShopItem}
                  />
                </Section>

                <Section title="Ranked Entry Gate" meta={formatRankedEntryGateMode(overview.rankedEntryGate.mode)}>
                  <RankedEntryGatePanel
                    gate={overview.rankedEntryGate}
                    draft={rankedEntryGateDraft}
                    busy={busyRankedEntryGate}
                    onDraftChange={updateRankedEntryGateDraft}
                    onSave={saveRankedEntryGate}
                  />
                </Section>

                <Section title="Ranked Season" meta={overview.rankedSeason.label}>
                  <RankedSeasonPanel
                    season={overview.rankedSeason}
                    draft={rankedSeasonDraft}
                    busy={busyRankedSeason}
                    onDraftChange={updateRankedSeasonDraft}
                    onSave={saveRankedSeason}
                  />
                </Section>
              </div>
            )}

            {activeTab === 'players' && (
              <div role="tabpanel" id="admin-panel-players" aria-labelledby="admin-tab-players">
                <Section title="Player Ranks" meta={`${formatNumber(rankUsersPagination.total)} users`}>
                  <PlayerRankPanel
                    users={rankUsers}
                    pagination={rankUsersPagination}
                    search={rankSearch}
                    reason={rankReason}
                    drafts={rankUserDrafts}
                    loading={rankUsersLoading}
                    busyUserId={busyRankUserId}
                    onSearchChange={setRankSearch}
                    onReasonChange={setRankReason}
                    onSearch={searchRankUsers}
                    onClearSearch={clearRankUserSearch}
                    onPageChange={changeRankUserPage}
                    onDraftChange={updateRankUserDraft}
                    onSave={saveRankUser}
                  />
                </Section>
              </div>
            )}

            {activeTab === 'servers' && (
              <div role="tabpanel" id="admin-panel-servers" aria-labelledby="admin-tab-servers">
                <Section title="Machines" meta={`${formatNumber(overview.machines.length)} running`}>
                  <MachinesTable machines={overview.machines} />
                </Section>
              </div>
            )}

            {activeTab === 'rooms' && (
              <div
                role="tabpanel"
                id="admin-panel-rooms"
                aria-labelledby="admin-tab-rooms"
                className="flex flex-col gap-3"
              >
                <Section title="Game Rooms" meta={`${formatNumber(overview.rooms.game.length)} active`}>
                  <GameRoomsTable rooms={overview.rooms.game} />
                </Section>

                <Section title="Lobbies" meta={`${formatNumber(overview.rooms.lobbies.length)} active`}>
                  <LobbiesTable lobbies={overview.rooms.lobbies} />
                </Section>
              </div>
            )}

            {activeTab === 'rewards' && (
              <div role="tabpanel" id="admin-panel-rewards" aria-labelledby="admin-tab-rewards">
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
              </div>
            )}

            {activeTab === 'reports' && (
              <div role="tabpanel" id="admin-panel-reports" aria-labelledby="admin-tab-reports">
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
              </div>
            )}
          </>
        ) : (
          !loading && <EmptyTable label="Telemetry unavailable." />
        )}
      </div>
    </main>
  );
}

export default AdminDashboard;
