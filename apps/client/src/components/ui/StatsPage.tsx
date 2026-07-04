import * as SelectPrimitive from '@radix-ui/react-select';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { UserStats } from '../../store/types';
import {
  requestPlayerRewardSummary,
  type PlayerRewardKind,
  type PlayerRewardPayoutRow,
  type PlayerRewardPayoutStatus,
  type PlayerRewardRow,
  type PlayerRewardStatus,
  type PlayerRewardSummary,
} from '../../contexts/networkApi';
import { config } from '../../config/environment';
import { getLevelProgress } from '@voxel-strike/shared';
import { RankBadge, RankInlineLabel, RankProgress, getRankForStats } from './RankBadge';

interface LeaderboardPlayer {
  rank: number;
  userId: string;
  name: string;
  stats: UserStats;
}

interface PersonalLeaderboardPlayer extends Omit<LeaderboardPlayer, 'rank'> {
  rank: number | null;
}

interface LeaderboardSeasonOption {
  identity: string;
  mode: 'preseason' | 'season';
  seasonNumber: number;
  label: string;
  endsAt: string | null;
  current: boolean;
}

interface LeaderboardResponse {
  seasons: LeaderboardSeasonOption[];
  selectedSeason: LeaderboardSeasonOption;
  leaderboard: LeaderboardPlayer[];
  currentUser: PersonalLeaderboardPlayer | null;
}

const LAMPORTS_PER_SOL = 1_000_000_000n;
const UNSIGNED_INTEGER_PATTERN = /^[0-9]+$/;
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const REWARD_KIND_LABELS: Record<PlayerRewardKind, string> = {
  daily_ranked_drip: 'Ranked Daily Drip',
  objective_bounty: 'Objective Bounty',
  season_top_10: 'Season Top 10',
  daily_mission: 'Daily Mission',
  ranked_br_combat_bounty: 'Ranked BR Combat',
};

const REWARD_STATUS_LABELS: Record<PlayerRewardStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  paid: 'Paid',
  failed: 'Failed',
  canceled: 'Canceled',
};

const PAYOUT_STATUS_LABELS: Record<PlayerRewardPayoutStatus, string> = {
  pending: 'Pending',
  submitted: 'Submitted',
  confirmed: 'Confirmed',
  failed: 'Failed',
};

function getHttpUrl(): string {
  return config.serverUrl.replace('ws://', 'http://').replace('wss://', 'https://');
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatPercent(wins: number, games: number): string {
  if (games <= 0) return '0%';
  return `${Math.round((wins / games) * 100)}%`;
}

function formatRatio(kills: number, deaths: number): string {
  if (kills <= 0 && deaths <= 0) return '0.0';
  const ratio = deaths > 0 ? kills / deaths : kills;
  return ratio.toFixed(1);
}

function formatGroupedInteger(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const digits = (value < 0n ? -value : value).toString();
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function parseLamports(value: string | bigint | null | undefined): bigint {
  if (typeof value === 'bigint') return value >= 0n ? value : 0n;
  if (typeof value !== 'string') return 0n;
  const trimmed = value.trim();
  if (!UNSIGNED_INTEGER_PATTERN.test(trimmed)) return 0n;
  return BigInt(trimmed);
}

function formatSolAmount(value: string | bigint | null | undefined, maxDecimals = 6): string {
  const lamports = parseLamports(value);
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = lamports % LAMPORTS_PER_SOL;
  const wholeText = formatGroupedInteger(whole);
  if (fraction === 0n) return `${wholeText} SOL`;

  const trimmedFraction = fraction.toString().padStart(9, '0').replace(/0+$/, '');
  if (trimmedFraction.length <= maxDecimals) {
    return `${wholeText}.${trimmedFraction} SOL`;
  }

  const visibleFraction = trimmedFraction.slice(0, maxDecimals).replace(/0+$/, '');
  if (visibleFraction) return `${wholeText}.${visibleFraction} SOL`;
  return `<0.${'0'.repeat(Math.max(0, maxDecimals - 1))}1 SOL`;
}

function formatUsdCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatBpsPercent(bps: number | null): string {
  if (bps === null) return 'Quote pending';
  const clamped = Math.max(0, Math.min(10_000, bps));
  const percent = clamped / 100;
  return `${percent >= 10 || percent === 0 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return 'Unknown time';
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return 'Unknown time';
  return DATE_TIME_FORMATTER.format(new Date(ms));
}

function truncateMiddle(value: string, lead = 5, tail = 5): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}...${value.slice(-tail)}`;
}

function getRewardTotal(summary: PlayerRewardSummary | null, status: PlayerRewardStatus): bigint {
  return parseLamports(summary?.totals[status]?.amountLamports);
}

function getRewardCount(summary: PlayerRewardSummary | null, status: PlayerRewardStatus): number {
  return summary?.totals[status]?.count ?? 0;
}

function formatRewardCount(count: number): string {
  return `${formatNumber(count)} reward${count === 1 ? '' : 's'}`;
}

function getRequestStatusCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return null;
  const statusCode = Number((error as { statusCode?: unknown }).statusCode);
  return Number.isInteger(statusCode) ? statusCode : null;
}

function getRewardPanelStatus(input: {
  isLoading: boolean;
  hasSummary: boolean;
  hasPriceQuote: boolean;
  payoutReady: boolean;
}): { label: string; state: 'loading' | 'signed-out' | 'ready' | 'tracking' | 'quote' } {
  if (input.isLoading && !input.hasSummary) return { label: 'Loading', state: 'loading' };
  if (!input.hasSummary) return { label: 'Sign in', state: 'signed-out' };
  if (input.payoutReady) return { label: 'Ready', state: 'ready' };
  if (input.hasPriceQuote) return { label: 'Tracking', state: 'tracking' };
  return { label: 'Quote pending', state: 'quote' };
}

function formatRemainingPayoutLabel(remainingLamports: bigint | null, payoutReady: boolean): string {
  if (remainingLamports === null) return 'Waiting for SOL/USD quote';
  if (remainingLamports === 0n) return payoutReady ? 'Ready for payout' : 'No pending SOL yet';
  return `${formatSolAmount(remainingLamports)} to payout`;
}

function getLocalPersonalStats(playerName: string, userStats: UserStats | null): PersonalLeaderboardPlayer | null {
  if (!userStats) return null;

  return {
    rank: null,
    userId: 'local',
    name: playerName || 'You',
    stats: userStats,
  };
}

function StatsPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`stats-panel ${className}`}>
      {children}
    </section>
  );
}

export function StatsPage() {
  const playerName = useGameStore((state) => state.playerName);
  const userStats = useGameStore((state) => state.userStats);

  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedSeasonIdentity, setSelectedSeasonIdentity] = useState('current');
  const [rewardSummary, setRewardSummary] = useState<PlayerRewardSummary | null>(null);
  const [isRewardsLoading, setIsRewardsLoading] = useState(false);

  const loadLeaderboard = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);

    try {
      const params = new URLSearchParams({
        limit: '25',
        mode: 'ranked',
      });
      if (selectedSeasonIdentity !== 'current') {
        params.set('season', selectedSeasonIdentity);
      }

      const response = await fetch(`${getHttpUrl()}/auth/leaderboard?${params.toString()}`, {
        credentials: 'include',
        signal,
      });

      if (!response.ok) {
        throw new Error('Stats are unavailable right now');
      }

      const nextData = await response.json() as LeaderboardResponse;
      setData(nextData);
    } catch (err) {
      if (signal?.aborted) return;
      console.warn('[StatsPage] Leaderboard unavailable:', err);
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [selectedSeasonIdentity]);

  const loadRewardSummary = useCallback(async (signal?: AbortSignal) => {
    setIsRewardsLoading(true);

    try {
      const nextSummary = await requestPlayerRewardSummary(signal);
      setRewardSummary(nextSummary);
    } catch (err) {
      if (signal?.aborted) return;
      setRewardSummary(null);
      if (getRequestStatusCode(err) !== 401) {
        console.warn('[StatsPage] Rewards unavailable:', err);
      }
    } finally {
      if (!signal?.aborted) {
        setIsRewardsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadLeaderboard(controller.signal);
    return () => controller.abort();
  }, [loadLeaderboard]);

  useEffect(() => {
    const controller = new AbortController();
    loadRewardSummary(controller.signal);
    return () => controller.abort();
  }, [loadRewardSummary]);

  const personalStats = useMemo(() => {
    if (data?.currentUser) return data.currentUser;
    if (data && !data.selectedSeason.current) return null;
    return getLocalPersonalStats(playerName, userStats);
  }, [data, playerName, userStats]);
  const activeSeasonIdentity = data?.selectedSeason.identity ?? selectedSeasonIdentity;
  const seasons = useMemo(
    () => (data?.seasons ?? []).filter((season) => season.mode === 'season'),
    [data?.seasons]
  );

  return (
    <div className="stats-page menu-content-wide menu-scroll-y no-scrollbar">
      <div className="stats-page-inner">
        <PersonalStatsBand player={personalStats} />

        <section className="stats-leaderboard-section" aria-labelledby="stats-leaderboard-title">
          <div className="stats-floating-heading">
            <h2 id="stats-leaderboard-title">LEADERBOARD</h2>
            <div className="stats-toolbar">
              <SeasonSelect
                seasons={seasons}
                activeSeasonIdentity={activeSeasonIdentity}
                onSelect={setSelectedSeasonIdentity}
              />
              {data?.leaderboard.length ? (
                <p className="stats-player-count">
                  {data.leaderboard.length} players
                </p>
              ) : null}
            </div>
          </div>

          <div className="stats-leaderboard-row">
            <StatsPanel className="stats-leaderboard-panel">
              <div className="stats-panel-body">
                {isLoading && !data ? (
                  <LeaderboardSkeleton />
                ) : data?.leaderboard.length ? (
                  <LeaderboardTable
                    players={data.leaderboard}
                    currentUserId={data.currentUser?.userId ?? null}
                  />
                ) : (
                  <EmptyLeaderboard />
                )}
              </div>
            </StatsPanel>

            <RewardPayoutPanel summary={rewardSummary} isLoading={isRewardsLoading} />
          </div>
        </section>
      </div>
    </div>
  );
}

function SeasonSelect({
  seasons,
  activeSeasonIdentity,
  onSelect,
}: {
  seasons: LeaderboardSeasonOption[];
  activeSeasonIdentity: string;
  onSelect: (identity: string) => void;
}) {
  const selectedSeason = seasons.find((season) => season.identity === activeSeasonIdentity) ?? seasons[0];

  if (!selectedSeason) return null;

  return (
    <div className="stats-season-select-field">
      <span className="stats-season-select-label">Season</span>
      <SelectPrimitive.Root value={selectedSeason.identity} onValueChange={onSelect}>
        <SelectPrimitive.Trigger className="stats-season-select-trigger" aria-label="Leaderboard season">
          <SelectPrimitive.Value />
          <span className="stats-season-select-icon" aria-hidden="true" />
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            align="end"
            className="stats-season-select-content"
            position="popper"
            sideOffset={6}
          >
            <SelectPrimitive.Viewport className="stats-season-select-viewport">
              {seasons.map((season) => (
                <SelectPrimitive.Item
                  key={season.identity}
                  className="stats-season-select-item"
                  value={season.identity}
                >
                  <SelectPrimitive.ItemIndicator className="stats-season-select-item-indicator">
                    <span className="stats-season-select-check-mark" />
                  </SelectPrimitive.ItemIndicator>
                  <SelectPrimitive.ItemText>{season.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}

function PersonalStatsBand({ player }: { player: PersonalLeaderboardPlayer | null }) {
  const personalRank = player ? getRankForStats(player.stats) : null;
  const overviewStats = player ? [
    { label: 'Level', value: formatNumber(getLevelProgress(player.stats.totalExperience).level) },
    { label: 'XP', value: formatNumber(player.stats.totalExperience) },
    { label: 'Win Rate', value: formatPercent(player.stats.totalWins, player.stats.totalGames) },
    { label: 'Games', value: formatNumber(player.stats.totalGames) },
    { label: 'K/D', value: formatRatio(player.stats.totalKills, player.stats.totalDeaths) },
    { label: 'Captures', value: formatNumber(player.stats.totalCaptures) },
  ] : [];

  return (
    <StatsPanel className="stats-personal-panel">
      {player ? (
        <>
          <div className="stats-personal-main">
            <div className="stats-rank-block">
              <div className="stats-rank-label">
                <RankInlineLabel rank={personalRank} iconSize={30} className="stats-rank-inline" />
              </div>
              <p className="stats-player-name">{player.name}</p>
              <p className="stats-rank-position">{player.rank ? `Leaderboard #${player.rank}` : 'No ranked matches yet'}</p>
            </div>

            <div className="stats-metric-grid">
              {overviewStats.map((stat) => (
                <InlineStat key={stat.label} label={stat.label} value={stat.value} />
              ))}
            </div>
          </div>
          <div className="stats-rank-progress-row">
            <RankProgress stats={player.stats} />
          </div>
        </>
      ) : (
        <div className="stats-empty-profile">
          <div>
            <p className="stats-empty-title">NO PROFILE</p>
            <p className="stats-empty-copy">Sign in to track scores, wins, and ranked progress.</p>
          </div>
          <svg className="stats-empty-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v8m-4-4h8M5 20h14a2 2 0 002-2V8.8a2 2 0 00-.6-1.43l-3.77-3.77A2 2 0 0015.2 3H5a2 2 0 00-2 2v13a2 2 0 002 2z" />
          </svg>
        </div>
      )}
    </StatsPanel>
  );
}

function RewardPayoutPanel({
  summary,
  isLoading,
}: {
  summary: PlayerRewardSummary | null;
  isLoading: boolean;
}) {
  const progress = summary?.payoutProgress ?? null;
  const pendingLamports = progress ? parseLamports(progress.pendingLamports) : getRewardTotal(summary, 'pending');
  const processingLamports = getRewardTotal(summary, 'processing');
  const paidLamports = getRewardTotal(summary, 'paid');
  const progressBps = progress?.progressBps ?? null;
  const progressPercent = progressBps === null ? 0 : Math.max(0, Math.min(100, progressBps / 100));
  const minimumPayoutLamports = parseLamports(progress?.minimumPayoutLamports);
  const remainingLamports = progress?.remainingLamports === null ? null : parseLamports(progress?.remainingLamports);
  const payoutReady = Boolean(
    progress
      && progress.minimumPayoutLamports !== null
      && pendingLamports > 0n
      && remainingLamports === 0n
  );
  const panelStatus = getRewardPanelStatus({
    isLoading,
    hasSummary: Boolean(summary),
    hasPriceQuote: Boolean(progress?.priceQuote),
    payoutReady,
  });
  const progressLabel = progressBps === null ? 'Quote pending' : `${formatBpsPercent(progressBps)} funded`;
  const thresholdLabel = minimumPayoutLamports > 0n
    ? formatSolAmount(minimumPayoutLamports)
    : `${formatUsdCents(progress?.minPayoutUsdCents ?? 0)} minimum`;
  const remainingLabel = formatRemainingPayoutLabel(remainingLamports, payoutReady);
  const recentRewards = summary?.rewards.slice(0, 3) ?? [];
  const recentPayouts = summary?.payouts.slice(0, 2) ?? [];

  return (
    <StatsPanel className="stats-rewards-panel">
      <div className="stats-rewards-content">
        <div className="stats-rewards-header">
          <div className="stats-rewards-title-block">
            <p className="stats-rewards-kicker">SOL REWARDS</p>
            <h2>Earned payouts</h2>
          </div>
          <span
            className="stats-rewards-status"
            data-state={panelStatus.state}
          >
            {panelStatus.label}
          </span>
        </div>

        {isLoading && !summary ? (
          <RewardPanelSkeleton />
        ) : summary ? (
          <>
            <div className="stats-rewards-balance-row">
              <div className="stats-rewards-balance-main">
                <p>Pending payout</p>
                <strong>{formatSolAmount(pendingLamports)}</strong>
              </div>
              <div className="stats-rewards-balance-side">
                <p>Paid lifetime</p>
                <strong>{formatSolAmount(paidLamports)}</strong>
              </div>
            </div>

            <div className="stats-rewards-progress-block">
              <div className="stats-rewards-progress-head">
                <span>Payout threshold</span>
                <strong>{progressLabel}</strong>
              </div>
              <div className="stats-rewards-progress-track" aria-hidden="true">
                <div className="stats-rewards-progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="stats-rewards-progress-meta">
                <span>{thresholdLabel}</span>
                <span>{remainingLabel}</span>
              </div>
            </div>

            <div className="stats-rewards-mini-grid">
              <RewardMiniStat
                label="Pending"
                value={formatSolAmount(pendingLamports)}
                sub={formatRewardCount(getRewardCount(summary, 'pending'))}
              />
              <RewardMiniStat
                label="Processing"
                value={formatSolAmount(processingLamports)}
                sub={formatRewardCount(getRewardCount(summary, 'processing'))}
              />
              <RewardMiniStat
                label="Paid"
                value={formatSolAmount(paidLamports)}
                sub={formatRewardCount(getRewardCount(summary, 'paid'))}
              />
            </div>

            <div className="stats-rewards-feed-grid">
              <div className="stats-rewards-feed">
                <div className="stats-rewards-feed-heading">
                  <span>Recent earnings</span>
                </div>
                {recentRewards.length ? (
                  recentRewards.map((reward) => (
                    <RewardActivityRow key={reward.id} reward={reward} />
                  ))
                ) : (
                  <p className="stats-rewards-empty-line">Ranked BR rewards will appear here after eligible matches.</p>
                )}
              </div>

              <div className="stats-rewards-feed">
                <div className="stats-rewards-feed-heading">
                  <span>Payouts</span>
                </div>
                {recentPayouts.length ? (
                  recentPayouts.map((payout) => (
                    <RewardPayoutRow key={payout.id} payout={payout} />
                  ))
                ) : (
                  <p className="stats-rewards-empty-line">No SOL payouts submitted yet.</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="stats-rewards-empty-state">
            <p className="stats-empty-title">REWARDS LOCKED</p>
            <p className="stats-empty-copy">Sign in to see earned SOL, payout progress, and recent reward history.</p>
          </div>
        )}
      </div>
    </StatsPanel>
  );
}

function RewardMiniStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="stats-rewards-mini-stat">
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{sub}</span>
    </div>
  );
}

function RewardActivityRow({ reward }: { reward: PlayerRewardRow }) {
  return (
    <div className="stats-rewards-feed-row" data-status={reward.status}>
      <div className="stats-rewards-feed-copy">
        <p>{REWARD_KIND_LABELS[reward.kind] ?? reward.kind}</p>
        <span>{formatShortDate(reward.createdAt)} - {REWARD_STATUS_LABELS[reward.status]}</span>
      </div>
      <strong className="stats-rewards-feed-amount">+{formatSolAmount(reward.amountLamports)}</strong>
    </div>
  );
}

function RewardPayoutRow({ payout }: { payout: PlayerRewardPayoutRow }) {
  const eventTime = payout.confirmedAt ?? payout.submittedAt ?? payout.failedAt ?? payout.createdAt;
  const reference = payout.signature
    ? `Sig ${truncateMiddle(payout.signature, 6, 6)}`
    : `Wallet ${truncateMiddle(payout.walletAddress, 4, 4)}`;

  return (
    <div className="stats-rewards-feed-row" data-status={payout.status}>
      <div className="stats-rewards-feed-copy">
        <p>{PAYOUT_STATUS_LABELS[payout.status]}</p>
        <span>{formatShortDate(eventTime)} - {reference}</span>
      </div>
      <strong className="stats-rewards-feed-amount">{formatSolAmount(payout.amountLamports)}</strong>
    </div>
  );
}

function RewardPanelSkeleton() {
  return (
    <div className="stats-rewards-skeleton" aria-label="Loading rewards">
      <div className="stats-rewards-skeleton-total animate-pulse" />
      <div className="stats-rewards-skeleton-bar animate-pulse" />
      <div className="stats-rewards-skeleton-grid">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="stats-rewards-skeleton-tile animate-pulse" />
        ))}
      </div>
      <div className="stats-rewards-skeleton-list">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="stats-rewards-skeleton-row animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function InlineStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-metric-item">
      <p className="stats-metric-value">{value}</p>
      <p className="stats-tile-label">{label}</p>
    </div>
  );
}

function LeaderboardTable({
  players,
  currentUserId,
}: {
  players: LeaderboardPlayer[];
  currentUserId: string | null;
}) {
  return (
    <div className="stats-table">
      <div className="stats-table-head">
        <span>Rank</span>
        <span>Player</span>
        <span className="text-right">Rating</span>
        <span className="hidden text-right sm:block">Wins</span>
        <span className="hidden text-right sm:block">K/D</span>
        <span className="hidden text-right md:block">Caps</span>
      </div>

      <div className="stats-table-scroll no-scrollbar">
        {players.map((player) => (
          <LeaderboardRow
            key={player.userId}
            player={player}
            isCurrentUser={player.userId === currentUserId}
          />
        ))}
      </div>
    </div>
  );
}

function LeaderboardRow({
  player,
  isCurrentUser,
}: {
  player: LeaderboardPlayer;
  isCurrentUser: boolean;
}) {
  return (
    <div className={`stats-table-row${isCurrentUser ? ' is-current-user' : ''}`}>
      <div className="stats-table-cell">
        <span className={`stats-row-rank ${player.rank <= 3 ? 'is-podium' : ''}`}>
          #{player.rank}
        </span>
      </div>
      <div className="stats-player-cell">
        <p className="stats-row-player">{player.name}</p>
        <div className="stats-row-meta">
          <RankBadge rank={getRankForStats(player.stats)} compact className="max-w-[8rem] py-0.5 text-[10px]" />
          <p>{formatNumber(player.stats.rankedGames)} games</p>
        </div>
      </div>
      <span className="stats-row-number stats-row-primary">{formatNumber(player.stats.competitiveRating)}</span>
      <span className="stats-row-number hidden sm:block">{formatNumber(player.stats.totalWins)}</span>
      <span className="stats-row-number hidden sm:block">{formatRatio(player.stats.totalKills, player.stats.totalDeaths)}</span>
      <span className="stats-row-number hidden md:block">{formatNumber(player.stats.totalCaptures)}</span>
    </div>
  );
}

function LeaderboardSkeleton() {
  return (
    <div className="stats-skeleton">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="stats-skeleton-row animate-pulse" />
      ))}
    </div>
  );
}

function EmptyLeaderboard() {
  return (
    <div className="stats-empty-leaderboard">
      <p className="stats-empty-title">NO SCORES YET</p>
      <p className="stats-empty-copy">Completed matches will appear here once players start logging results.</p>
    </div>
  );
}
