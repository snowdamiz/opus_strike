import * as SelectPrimitive from '@radix-ui/react-select';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { UserStats } from '../../store/types';
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

  useEffect(() => {
    const controller = new AbortController();
    loadLeaderboard(controller.signal);
    return () => controller.abort();
  }, [loadLeaderboard]);

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
