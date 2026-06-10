import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGameStore, type UserStats } from '../../store/gameStore';
import { config } from '../../config/environment';
import { getLevelProgress } from '@voxel-strike/shared';

interface PlayerRecords {
  bestScore: number;
  bestKills: number;
  bestAssists: number;
  bestCaptures: number;
  bestReturns: number;
}

interface LeaderboardPlayer {
  rank: number;
  userId: string;
  name: string;
  stats: UserStats;
}

interface PersonalLeaderboardPlayer extends Omit<LeaderboardPlayer, 'rank'> {
  rank: number | null;
  records: PlayerRecords;
}

interface LeaderboardResponse {
  leaderboard: LeaderboardPlayer[];
  currentUser: PersonalLeaderboardPlayer | null;
}

const EMPTY_RECORDS: PlayerRecords = {
  bestScore: 0,
  bestKills: 0,
  bestAssists: 0,
  bestCaptures: 0,
  bestReturns: 0,
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

function getLocalPersonalStats(playerName: string, userStats: UserStats | null): PersonalLeaderboardPlayer | null {
  if (!userStats) return null;

  return {
    rank: null,
    userId: 'local',
    name: playerName || 'You',
    stats: userStats,
    records: EMPTY_RECORDS,
  };
}

export function StatsPage() {
  const playerName = useGameStore((state) => state.playerName);
  const userStats = useGameStore((state) => state.userStats);

  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadLeaderboard = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);

    try {
      const response = await fetch(`${getHttpUrl()}/auth/leaderboard?limit=25`, {
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
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadLeaderboard(controller.signal);
    return () => controller.abort();
  }, [loadLeaderboard]);

  const personalStats = useMemo(
    () => data?.currentUser ?? getLocalPersonalStats(playerName, userStats),
    [data?.currentUser, playerName, userStats]
  );

  return (
    <div className="h-full menu-content menu-scroll-y no-scrollbar py-5 lg:py-7">
      <div className="mx-auto flex min-h-full max-w-7xl flex-col justify-start gap-5">
        <PersonalStatsBand player={personalStats} />

        <div className="grid min-h-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="min-w-0">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <div>
                <p className="font-display text-2xl leading-none text-white">GLOBAL LEADERBOARD</p>
                <p className="mt-1 font-body text-xs text-white/30">Ranked by total score</p>
              </div>
              {data?.leaderboard.length ? (
                <p className="font-mono text-xs text-white/30">{data.leaderboard.length} PLAYERS</p>
              ) : null}
            </div>

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
          </section>

          <RecordsRail player={personalStats} />
        </div>
      </div>
    </div>
  );
}

function PersonalStatsBand({ player }: { player: PersonalLeaderboardPlayer | null }) {
  return (
    <section className="border-y border-white/10 bg-black/25 px-4 py-4 backdrop-blur-sm">
      {player ? (
        <div className="grid gap-5 md:grid-cols-[minmax(11rem,16rem)_1fr] md:items-center">
          <div className="min-w-0">
            <p className="font-body text-[11px] uppercase tracking-widest text-accent-primary/80">Your Rank</p>
            <p className="mt-1 font-display text-5xl leading-none text-white">
              {player.rank ? `#${player.rank}` : 'UNRANKED'}
            </p>
            <p className="mt-1 truncate font-display text-lg leading-none text-white/45">{player.name}</p>
          </div>

          <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
            <InlineStat label="Level" value={formatNumber(getLevelProgress(player.stats.totalExperience).level)} />
            <InlineStat label="Score" value={formatNumber(player.stats.totalScore)} />
            <InlineStat label="Win Rate" value={formatPercent(player.stats.totalWins, player.stats.totalGames)} />
            <InlineStat label="Games" value={formatNumber(player.stats.totalGames)} />
            <InlineStat label="K/D" value={formatRatio(player.stats.totalKills, player.stats.totalDeaths)} />
            <InlineStat label="Captures" value={formatNumber(player.stats.totalCaptures)} />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-display text-2xl text-white/50">NO PROFILE</p>
            <p className="mt-1 font-body text-sm text-white/30">Sign in to track scores, wins, and match records.</p>
          </div>
          <svg className="hidden h-8 w-8 text-white/20 sm:block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v8m-4-4h8M5 20h14a2 2 0 002-2V8.8a2 2 0 00-.6-1.43l-3.77-3.77A2 2 0 0015.2 3H5a2 2 0 00-2 2v13a2 2 0 002 2z" />
          </svg>
        </div>
      )}
    </section>
  );
}

function InlineStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-l border-white/10 pl-3">
      <p className="font-body text-[11px] uppercase tracking-widest text-white/30">{label}</p>
      <p className="mt-1 truncate font-display text-3xl leading-none text-white">{value}</p>
    </div>
  );
}

function RecordsRail({ player }: { player: PersonalLeaderboardPlayer | null }) {
  const records = player?.records ?? EMPTY_RECORDS;

  return (
    <aside className="border-t border-white/10 pt-3 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
      <p className="font-display text-2xl leading-none text-white">RECORDS</p>
      <p className="mt-1 font-body text-xs text-white/30">Best single-match marks</p>
      <div className="mt-5 space-y-3">
        <RecordLine label="Best Score" value={records.bestScore} />
        <RecordLine label="Most Kills" value={records.bestKills} />
        <RecordLine label="Most Assists" value={records.bestAssists} />
        <RecordLine label="Most Captures" value={records.bestCaptures} />
        <RecordLine label="Most Returns" value={records.bestReturns} />
      </div>
    </aside>
  );
}

function RecordLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/10 pb-2">
      <span className="font-body text-sm text-white/40">{label}</span>
      <span className="font-mono text-sm text-white/75">{formatNumber(value)}</span>
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
    <div className="min-w-0">
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_4.75rem] gap-3 border-y border-white/10 px-1 py-2 font-body text-[11px] uppercase tracking-widest text-white/35 sm:grid-cols-[3rem_minmax(0,1fr)_5rem_4rem_4rem] md:grid-cols-[3rem_minmax(0,1fr)_5rem_4rem_4rem_5rem]">
        <span>Rank</span>
        <span>Player</span>
        <span className="text-right">Score</span>
        <span className="hidden text-right sm:block">Wins</span>
        <span className="hidden text-right sm:block">K/D</span>
        <span className="hidden text-right md:block">Caps</span>
      </div>

      <div className="max-h-[min(56vh,34rem)] overflow-y-auto no-scrollbar">
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
    <div className={`grid grid-cols-[2.75rem_minmax(0,1fr)_4.75rem] gap-3 border-b border-white/10 px-1 py-3 last:border-b-0 sm:grid-cols-[3rem_minmax(0,1fr)_5rem_4rem_4rem] md:grid-cols-[3rem_minmax(0,1fr)_5rem_4rem_4rem_5rem] ${isCurrentUser ? 'bg-accent-primary/10' : ''}`}>
      <div className="flex items-center">
        <span className={`font-mono text-sm ${player.rank <= 3 ? 'text-accent-primary' : 'text-white/45'}`}>
          #{player.rank}
        </span>
      </div>
      <div className="min-w-0">
        <p className="truncate font-display text-base leading-none text-white">{player.name}</p>
        <p className="mt-1 font-body text-xs text-white/30">{formatNumber(player.stats.totalGames)} games</p>
      </div>
      <span className="self-center text-right font-mono text-sm text-white/85">{formatNumber(player.stats.totalScore)}</span>
      <span className="hidden self-center text-right font-mono text-sm text-white/55 sm:block">{formatNumber(player.stats.totalWins)}</span>
      <span className="hidden self-center text-right font-mono text-sm text-white/55 sm:block">{formatRatio(player.stats.totalKills, player.stats.totalDeaths)}</span>
      <span className="hidden self-center text-right font-mono text-sm text-white/55 md:block">{formatNumber(player.stats.totalCaptures)}</span>
    </div>
  );
}

function LeaderboardSkeleton() {
  return (
    <div className="space-y-0 border-y border-white/10">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="h-14 border-b border-white/10 bg-white/[0.03] last:border-b-0 animate-pulse" />
      ))}
    </div>
  );
}

function EmptyLeaderboard() {
  return (
    <div className="flex min-h-[22rem] flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-2xl text-white/50">NO SCORES YET</p>
      <p className="mt-1 max-w-sm font-body text-sm text-white/30">Completed matches will appear here once players start logging results.</p>
    </div>
  );
}
