import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useGameStore, type UserStats } from '../../store/gameStore';
import { config } from '../../config/environment';
import { getLevelProgress } from '@voxel-strike/shared';
import { lamportsToSolDisplay } from '../../utils/wagerPayments';
import { RankBadge, RankInlineLabel, RankProgress, getRankForStats } from './RankBadge';

type LeaderboardMode = 'ranked' | 'score';

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
  mode: LeaderboardMode;
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

const STATS_GLASS_STYLE = {
  backdropFilter: 'blur(12px) saturate(1.12)',
  WebkitBackdropFilter: 'blur(12px) saturate(1.12)',
} satisfies CSSProperties;

const STATS_PANEL_CLASS = 'relative overflow-hidden rounded-lg border border-white/10 bg-[rgb(var(--color-strike-surface)/0.45)] shadow-[0_16px_38px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.08)]';

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

function parseLamports(value: string | undefined): bigint {
  return typeof value === 'string' && /^[0-9]+$/.test(value) ? BigInt(value) : 0n;
}

function formatLamports(value: string | bigint): string {
  return `${lamportsToSolDisplay(value)} SOL`;
}

function formatSignedLamports(value: bigint): string {
  const sign = value > 0n ? '+' : value < 0n ? '-' : '';
  const absoluteValue = value < 0n ? -value : value;
  return `${sign}${lamportsToSolDisplay(absoluteValue)} SOL`;
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

function StatsPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`${STATS_PANEL_CLASS} ${className}`} style={STATS_GLASS_STYLE}>
      <div className="absolute inset-x-0 top-0 h-px bg-white/15" />
      {children}
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/35">{eyebrow}</p>
      <h2 className="font-display text-2xl leading-none text-white">{title}</h2>
      {description ? (
        <p className="mt-1 font-body text-xs leading-snug text-white/45">{description}</p>
      ) : null}
    </div>
  );
}

export function StatsPage() {
  const playerName = useGameStore((state) => state.playerName);
  const userStats = useGameStore((state) => state.userStats);

  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [leaderboardMode, setLeaderboardMode] = useState<LeaderboardMode>('ranked');

  const loadLeaderboard = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);

    try {
      const response = await fetch(`${getHttpUrl()}/auth/leaderboard?limit=25&mode=${leaderboardMode}`, {
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
  }, [leaderboardMode]);

  useEffect(() => {
    const controller = new AbortController();
    loadLeaderboard(controller.signal);
    return () => controller.abort();
  }, [loadLeaderboard]);

  const personalStats = useMemo(
    () => data?.currentUser ?? getLocalPersonalStats(playerName, userStats),
    [data?.currentUser, playerName, userStats]
  );

  const leaderboardDescription = leaderboardMode === 'ranked'
    ? 'Ordered by competitive rating'
    : 'Ordered by total score';

  return (
    <div className="h-full menu-content-wide menu-scroll-y no-scrollbar py-4 lg:py-5">
      <div className="mx-auto flex min-h-full max-w-[86rem] flex-col justify-center gap-4 xl:gap-5">
        <PersonalStatsBand player={personalStats} />

        <div className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <StatsPanel className="min-w-0 p-4 lg:p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <SectionHeading
                eyebrow="Global"
                title="LEADERBOARD"
                description={leaderboardDescription}
              />
              <div className="flex flex-wrap items-center gap-2">
                <ModeButton
                  active={leaderboardMode === 'ranked'}
                  onClick={() => setLeaderboardMode('ranked')}
                >
                  Competitive
                </ModeButton>
                <ModeButton
                  active={leaderboardMode === 'score'}
                  onClick={() => setLeaderboardMode('score')}
                >
                  Score
                </ModeButton>
                {data?.leaderboard.length ? (
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">
                    {data.leaderboard.length} players
                  </p>
                ) : null}
              </div>
            </div>

            {isLoading && !data ? (
              <LeaderboardSkeleton />
            ) : data?.leaderboard.length ? (
              <LeaderboardTable
                players={data.leaderboard}
                currentUserId={data.currentUser?.userId ?? null}
                mode={leaderboardMode}
              />
            ) : (
              <EmptyLeaderboard />
            )}
          </StatsPanel>

          <RecordsRail player={personalStats} />
        </div>
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 font-display text-xs leading-none transition-colors ${
        active
          ? 'border-accent-primary/70 bg-accent-primary/20 text-white shadow-[0_0_18px_rgba(249,115,22,0.12)]'
          : 'border-white/10 bg-white/[0.04] text-white/45 hover:border-white/20 hover:text-white/70'
      }`}
    >
      {children}
    </button>
  );
}

function PersonalStatsBand({ player }: { player: PersonalLeaderboardPlayer | null }) {
  const personalRank = player ? getRankForStats(player.stats) : null;

  return (
    <StatsPanel className="p-4 lg:p-5">
      {player ? (
        <>
          <div className="grid gap-5 lg:grid-cols-[minmax(13rem,18rem)_1fr] lg:items-stretch">
            <div className="min-w-0 border-b border-white/10 pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-accent-primary/80">Your rank</p>
              <div className="mt-3">
                <RankInlineLabel rank={personalRank} iconSize={28} className="text-xl" />
              </div>
              <p className="mt-3 font-mono text-sm text-white/45">
                {player.rank ? `Leaderboard #${player.rank}` : 'No ranked matches yet'}
              </p>
              <p className="mt-1 truncate font-display text-2xl leading-none text-white/70">{player.name}</p>
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <div className="grid grid-cols-2 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
                <InlineStat label="Level" value={formatNumber(getLevelProgress(player.stats.totalExperience).level)} />
                <InlineStat label="Score" value={formatNumber(player.stats.totalScore)} />
                <InlineStat label="Win Rate" value={formatPercent(player.stats.totalWins, player.stats.totalGames)} />
                <InlineStat label="Games" value={formatNumber(player.stats.totalGames)} />
                <InlineStat label="K/D" value={formatRatio(player.stats.totalKills, player.stats.totalDeaths)} />
                <InlineStat label="Captures" value={formatNumber(player.stats.totalCaptures)} />
              </div>
              <div className="border-t border-white/10 pt-3">
                <RankProgress stats={player.stats} />
              </div>
            </div>
          </div>
          <WagerStatsStrip stats={player.stats} />
        </>
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
    </StatsPanel>
  );
}

function WagerStatsStrip({ stats }: { stats: UserStats }) {
  const wonLamports = parseLamports(stats.totalWagerWonLamports);
  const lostLamports = parseLamports(stats.totalWagerLostLamports);
  const netLamports = wonLamports - lostLamports;
  const netTone = netLamports > 0n
    ? 'text-emerald-300'
    : netLamports < 0n
      ? 'text-red-300'
      : 'text-white/75';

  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">Wager games</p>
        <p className={`font-mono text-xs ${netTone}`}>{formatSignedLamports(netLamports)} net</p>
      </div>
      <div className="grid grid-cols-2 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
        <WagerStat label="Games" value={formatNumber(stats.totalWagerGames)} />
        <WagerStat label="W/L/D" value={`${stats.totalWagerWins}/${stats.totalWagerLosses}/${stats.totalWagerDraws}`} />
        <WagerStat label="Wagered" value={formatLamports(stats.totalWageredLamports)} />
        <WagerStat label="Won" value={formatLamports(stats.totalWagerWonLamports)} tone="text-emerald-300" />
        <WagerStat label="Lost" value={formatLamports(stats.totalWagerLostLamports)} tone="text-red-300" />
        <WagerStat label="Net" value={formatSignedLamports(netLamports)} tone={netTone} />
      </div>
    </div>
  );
}

function WagerStat({ label, value, tone = 'text-white/80' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 border-l border-white/10 px-3 first:border-l-0 sm:[&:nth-child(3n+1)]:border-l-0 xl:[&:nth-child(4)]:border-l">
      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/35">{label}</p>
      <p className={`mt-1 truncate font-mono text-sm leading-5 ${tone}`}>{value}</p>
    </div>
  );
}

function InlineStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-l border-white/10 px-3 text-center first:border-l-0 sm:[&:nth-child(3n+1)]:border-l-0 xl:[&:nth-child(4)]:border-l">
      <p className="font-display text-3xl leading-none text-white">{value}</p>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-white/45">{label}</p>
    </div>
  );
}

function RecordsRail({ player }: { player: PersonalLeaderboardPlayer | null }) {
  const records = player?.records ?? EMPTY_RECORDS;

  return (
    <StatsPanel className="p-4 lg:p-5">
      <SectionHeading
        eyebrow="Personal"
        title="RECORDS"
        description="Best single-match marks"
      />
      <div className="mt-4 space-y-2.5">
        <RecordLine label="Best Score" value={records.bestScore} />
        <RecordLine label="Most Kills" value={records.bestKills} />
        <RecordLine label="Most Assists" value={records.bestAssists} />
        <RecordLine label="Most Captures" value={records.bestCaptures} />
        <RecordLine label="Most Returns" value={records.bestReturns} />
      </div>
    </StatsPanel>
  );
}

function RecordLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2.5">
      <span className="font-body text-sm text-white/50">{label}</span>
      <span className="font-mono text-sm text-white/85">{formatNumber(value)}</span>
    </div>
  );
}

function LeaderboardTable({
  players,
  currentUserId,
  mode,
}: {
  players: LeaderboardPlayer[];
  currentUserId: string | null;
  mode: LeaderboardMode;
}) {
  const primaryLabel = mode === 'ranked' ? 'Rating' : 'Score';
  return (
    <div className="min-w-0 border-t border-white/10">
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_4.75rem] gap-3 border-b border-white/10 px-1 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35 sm:grid-cols-[3rem_minmax(0,1fr)_5rem_4rem_4rem] md:grid-cols-[3rem_minmax(0,1fr)_5rem_4rem_4rem_5rem]">
        <span>Rank</span>
        <span>Player</span>
        <span className="text-right">{primaryLabel}</span>
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
            mode={mode}
          />
        ))}
      </div>
    </div>
  );
}

function LeaderboardRow({
  player,
  isCurrentUser,
  mode,
}: {
  player: LeaderboardPlayer;
  isCurrentUser: boolean;
  mode: LeaderboardMode;
}) {
  const primaryValue = mode === 'ranked' ? player.stats.competitiveRating : player.stats.totalScore;
  return (
    <div className={`grid grid-cols-[2.75rem_minmax(0,1fr)_4.75rem] gap-3 border-b border-white/10 px-1 py-3 last:border-b-0 sm:grid-cols-[3rem_minmax(0,1fr)_5rem_4rem_4rem] md:grid-cols-[3rem_minmax(0,1fr)_5rem_4rem_4rem_5rem] ${isCurrentUser ? 'bg-accent-primary/10' : 'bg-transparent hover:bg-white/[0.025]'}`}>
      <div className="flex items-center">
        <span className={`font-mono text-sm ${player.rank <= 3 ? 'text-accent-primary' : 'text-white/45'}`}>
          #{player.rank}
        </span>
      </div>
      <div className="min-w-0">
        <p className="truncate font-display text-base leading-none text-white">{player.name}</p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
          {mode === 'ranked' ? <RankBadge rank={getRankForStats(player.stats)} compact className="max-w-[8rem] py-0.5 text-[10px]" /> : null}
          <p className="font-body text-xs text-white/30">{formatNumber(mode === 'ranked' ? player.stats.rankedGames : player.stats.totalGames)} games</p>
        </div>
      </div>
      <span className="self-center text-right font-mono text-sm text-white/85">{formatNumber(primaryValue)}</span>
      <span className="hidden self-center text-right font-mono text-sm text-white/55 sm:block">{formatNumber(player.stats.totalWins)}</span>
      <span className="hidden self-center text-right font-mono text-sm text-white/55 sm:block">{formatRatio(player.stats.totalKills, player.stats.totalDeaths)}</span>
      <span className="hidden self-center text-right font-mono text-sm text-white/55 md:block">{formatNumber(player.stats.totalCaptures)}</span>
    </div>
  );
}

function LeaderboardSkeleton() {
  return (
    <div className="border-t border-white/10">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="h-14 border-b border-white/10 bg-white/[0.035] last:border-b-0 animate-pulse" />
      ))}
    </div>
  );
}

function EmptyLeaderboard() {
  return (
    <div className="flex min-h-[22rem] flex-col items-center justify-center border-t border-white/10 px-6 text-center">
      <p className="font-display text-2xl text-white/55">NO SCORES YET</p>
      <p className="mt-1 max-w-sm font-body text-sm text-white/35">Completed matches will appear here once players start logging results.</p>
    </div>
  );
}
