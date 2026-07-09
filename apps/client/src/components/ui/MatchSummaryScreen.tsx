import { useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';
import {
  getLevelProgress,
  getGameplayModeLabel,
  getTeamCatalogEntry,
  getTeamCatalogForGameplayMode,
  HERO_DEFINITIONS,
  type GameEndEvent,
  type MatchSummaryPlayer,
  type Team,
} from '@voxel-strike/shared';
import { TEAM_FALLBACK_COLORS } from '../../styles/colorTokens';
import { RankBadge, RankChangeSummary } from './RankBadge';

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function getHeroLabel(player: MatchSummaryPlayer): string {
  if (!player.heroId) return 'No Hero';
  return HERO_DEFINITIONS[player.heroId]?.name ?? player.heroId;
}

function getFactionLabel(team: Team): string {
  return getTeamCatalogEntry(team)?.label ?? team;
}

type TeamPresentation = {
  id: Team;
  name: string;
  fullName: string;
  primaryColor: string;
  secondaryColor: string;
  bgColor: string;
};

function getTeamPresentation(team: Team): TeamPresentation {
  const entry = getTeamCatalogEntry(team);
  return {
    id: team,
    name: entry?.compactLabel ?? team.toUpperCase(),
    fullName: entry?.label ?? team,
    primaryColor: entry?.color ?? TEAM_FALLBACK_COLORS.primaryColor,
    secondaryColor: entry?.accentColor ?? TEAM_FALLBACK_COLORS.secondaryColor,
    bgColor: entry ? `${entry.color}14` : TEAM_FALLBACK_COLORS.bgColor,
  };
}

export function MatchSummaryScreen() {
  const summary = useGameStore((state) => state.matchSummary);
  const playerId = useGameStore((state) => state.playerId);
  const userStats = useGameStore((state) => state.userStats);
  const clearMatchSummary = useGameStore((state) => state.clearMatchSummary);
  const { leaveGame } = useNetwork();

  const localPlayer = useMemo(
    () => summary?.players.find((player) => player.playerId === playerId) ?? null,
    [playerId, summary]
  );

  const teamEntries = useMemo(
    () => getTeamCatalogForGameplayMode(summary?.gameplayMode ?? 'capture_the_flag'),
    [summary?.gameplayMode]
  );
  const playersByTeam = useMemo(() => {
    const groups = new Map<Team, MatchSummaryPlayer[]>();
    for (const entry of teamEntries) groups.set(entry.id, []);
    for (const player of summary?.players ?? []) {
      const group = groups.get(player.team);
      if (group) group.push(player);
    }
    return groups;
  }, [summary, teamEntries]);

  if (!summary) return null;

  const experienceGained = localPlayer?.experienceGained ?? 0;
  const totalExperience = userStats?.totalExperience ?? experienceGained;
  const previousProgress = getLevelProgress(Math.max(0, totalExperience - experienceGained));
  const currentProgress = getLevelProgress(totalExperience);
  const leveledUp = currentProgress.level > previousProgress.level;
  const localOutcome = localPlayer?.outcome ?? 'draw';
  const isCaptureTheFlag = summary.gameplayMode === 'capture_the_flag';
  const isBattleRoyal = summary.gameplayMode === 'battle_royal';
  const isTeamEliminatedSummary = isBattleRoyal && summary.completionReason === 'team_eliminated';
  const placementLabel = summary.completedTeamPlacement
    ? `Placed #${summary.completedTeamPlacement}${summary.activeTeamCount ? ` of ${summary.activeTeamCount}` : ''}`
    : null;
  const resultLabel = isTeamEliminatedSummary
    ? 'Squad Eliminated'
    : localOutcome === 'win' ? 'Victory' : localOutcome === 'loss' ? 'Defeat' : 'Draw';
  const winnerLabel = isTeamEliminatedSummary
    ? placementLabel ?? 'Placement Recorded'
    : summary.winningTeam ? `${getFactionLabel(summary.winningTeam)} Wins` : 'Draw';
  const showRankChange = summary.matchMode === 'ranked' && !isTeamEliminatedSummary;

  const handleReturn = () => {
    clearMatchSummary();
    leaveGame();
  };

  return (
    <main
      className="match-summary-screen fixed inset-0 z-[9000] overflow-y-auto bg-black text-white"
      style={{
        backgroundImage: 'linear-gradient(180deg, rgb(var(--color-strike-page-top) / 0.86), rgb(var(--color-strike-page-bottom) / 0.97)), url(/bg.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="match-summary-body min-h-full px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
        <div className="match-summary-shell mx-auto flex min-h-[calc(100dvh-2.5rem)] max-w-7xl flex-col gap-5">
          <header className="match-summary-header grid gap-4 border-b border-white/10 pb-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end">
            <div className="min-w-0">
              <p className="match-summary-kicker font-body text-xs uppercase text-white/40">
                {isTeamEliminatedSummary ? 'Battle Royal' : 'Match Complete'}
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
                <h1 className="match-summary-result-title font-display text-5xl leading-none text-white sm:text-7xl">{resultLabel}</h1>
                <span className="match-summary-result-badge mb-2 rounded border border-white/15 bg-white/10 px-2.5 py-1 font-mono text-sm text-white/70">
                  {winnerLabel}
                </span>
              </div>
              <p className="match-summary-meta mt-3 font-body text-sm text-white/45">
                {getGameplayModeLabel(summary.gameplayMode)} - {formatDuration(summary.durationMs)} match length
              </p>
              {summary.matchIntegrity?.reviewRequired && (
                <div className="mt-4 border border-amber-300/30 bg-amber-300/10 px-3 py-2 font-body text-sm text-amber-100">
                  {summary.matchIntegrity.message}
                </div>
              )}
            </div>

            {isBattleRoyal ? (
              <BattleRoyalSummaryHeader summary={summary} />
            ) : (
              <div className="match-summary-team-score grid grid-cols-[1fr_auto_1fr] items-center gap-3 border border-white/10 bg-black/35 p-3 backdrop-blur-sm">
                <TeamScore team="red" score={summary.finalScore.red} />
                <span className="font-display text-xl text-white/30">VS</span>
                <TeamScore team="blue" score={summary.finalScore.blue} align="right" />
              </div>
            )}
          </header>

          <section className="match-summary-layout grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <div className="match-summary-side space-y-5">
              <ExperiencePanel
                experienceGained={experienceGained}
                previousLevel={previousProgress.level}
                currentLevel={currentProgress.level}
                experienceIntoLevel={currentProgress.experienceIntoLevel}
                experienceToNextLevel={currentProgress.experienceToNextLevel}
                progress={currentProgress.progress}
                leveledUp={leveledUp}
              />

              {showRankChange && (
                <RankChangeSummary
                  delta={localPlayer?.ratingDelta}
                  before={localPlayer?.rankBefore}
                  after={localPlayer?.rankAfter ?? localPlayer?.rank}
                />
              )}

              <LocalStatsPanel player={localPlayer} isCaptureTheFlag={isCaptureTheFlag} />

              <button
                type="button"
                onClick={handleReturn}
                className="match-summary-return h-12 w-full border border-accent-primary/50 bg-accent-primary/20 px-4 font-display text-lg text-white transition-colors hover:bg-accent-primary/30 focus:outline-none focus:ring-2 focus:ring-accent-primary/60"
              >
                Return to Lobbies
              </button>
            </div>

            <div className={isBattleRoyal ? 'match-summary-scoreboards grid min-w-0 gap-5 xl:grid-cols-2' : 'match-summary-scoreboards min-w-0 space-y-5'}>
              {teamEntries.map((entry) => (
                <TeamScoreboard
                  key={entry.id}
                  team={entry.id}
                  players={playersByTeam.get(entry.id) ?? []}
                  localPlayerId={playerId}
                  isCaptureTheFlag={isCaptureTheFlag}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function TeamScore({ team, score, align = 'left' }: { team: Team; score: number; align?: 'left' | 'right' }) {
  const faction = getTeamPresentation(team);

  return (
    <div className={`min-w-0 ${align === 'right' ? 'text-right' : ''}`}>
      <p className="font-body text-xs uppercase text-white/35">{faction.name}</p>
      <p className="mt-1 font-display text-5xl leading-none" style={{ color: faction.primaryColor }}>
        {score}
      </p>
    </div>
  );
}

function BattleRoyalSummaryHeader({ summary }: { summary: GameEndEvent }) {
  if (summary.completionReason === 'team_eliminated') {
    const teamLabel = summary.completedTeam ? getFactionLabel(summary.completedTeam) : 'Squad';
    const placement = summary.completedTeamPlacement
      ? `#${summary.completedTeamPlacement}${summary.activeTeamCount ? ` / ${summary.activeTeamCount}` : ''}`
      : 'Recorded';

    return (
      <div className="match-summary-br-result border border-white/10 bg-black/35 p-3 backdrop-blur-sm">
        <p className="font-body text-xs uppercase text-white/35">Battle Royal Placement</p>
        <p className="mt-1 truncate font-display text-3xl leading-none text-white">
          {placement}
        </p>
        <p className="mt-2 font-body text-sm text-white/45">
          {teamLabel} eliminated
        </p>
      </div>
    );
  }

  const aliveTeams = new Set(
    summary.players
      .filter((player) => player.outcome === 'win' || player.team === summary.winningTeam)
      .map((player) => player.team)
  );

  return (
    <div className="match-summary-br-result border border-white/10 bg-black/35 p-3 backdrop-blur-sm">
      <p className="font-body text-xs uppercase text-white/35">Battle Royal Result</p>
      <p className="mt-1 truncate font-display text-3xl leading-none text-white">
        {summary.winningTeam ? getFactionLabel(summary.winningTeam) : 'No Contest'}
      </p>
      <p className="mt-2 font-body text-sm text-white/45">
        {summary.players.length} players - {aliveTeams.size || 0} final team
      </p>
    </div>
  );
}

function ExperiencePanel({
  experienceGained,
  previousLevel,
  currentLevel,
  experienceIntoLevel,
  experienceToNextLevel,
  progress,
  leveledUp,
}: {
  experienceGained: number;
  previousLevel: number;
  currentLevel: number;
  experienceIntoLevel: number;
  experienceToNextLevel: number;
  progress: number;
  leveledUp: boolean;
}) {
  return (
    <section className="match-summary-xp-panel border border-white/10 bg-black/45 p-4 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-body text-xs uppercase text-white/35">Experience</p>
          <p className="match-summary-xp-value mt-1 font-display text-5xl leading-none text-accent-primary">
            +{formatNumber(experienceGained)}
          </p>
        </div>
        <div className="text-right">
          {leveledUp && (
            <p className="font-display text-sm text-emerald-300">Level Up</p>
          )}
          <p className="font-mono text-sm text-white/55">
            Level {previousLevel === currentLevel ? currentLevel : `${previousLevel} -> ${currentLevel}`}
          </p>
        </div>
      </div>

      <div className="mt-4 h-3 overflow-hidden border border-white/10 bg-white/10">
        <div
          className="h-full bg-accent-primary transition-all duration-500"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 font-mono text-xs text-white/40">
        <span>{formatNumber(experienceIntoLevel)} XP</span>
        <span>{formatNumber(experienceToNextLevel)} to next</span>
      </div>
    </section>
  );
}

function LocalStatsPanel({ player, isCaptureTheFlag }: { player: MatchSummaryPlayer | null; isCaptureTheFlag: boolean }) {
  const stats = player?.stats ?? {
    kills: 0,
    deaths: 0,
    assists: 0,
    flagCaptures: 0,
    flagReturns: 0,
  };

  return (
    <section className="match-summary-local-panel border border-white/10 bg-black/35 p-4 backdrop-blur-sm">
      <div className="mb-3 min-w-0">
        <p className="font-body text-xs uppercase text-white/35">Your Match</p>
        <p className="mt-1 truncate font-display text-2xl leading-none text-white">
          {player ? getHeroLabel(player) : 'No Player'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden border border-white/10 bg-white/10">
        <SummaryStat label="Score" value={player?.score ?? 0} />
        <SummaryStat label="K/D/A" value={`${stats.kills}/${stats.deaths}/${stats.assists}`} />
        <SummaryStat label={isCaptureTheFlag ? 'Captures' : 'Elims'} value={isCaptureTheFlag ? stats.flagCaptures : stats.kills} />
        <SummaryStat label={isCaptureTheFlag ? 'Returns' : 'Assists'} value={isCaptureTheFlag ? stats.flagReturns : stats.assists} />
      </div>
    </section>
  );
}

function SummaryStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0 bg-black/55 p-3">
      <p className="font-body text-xs uppercase text-white/35">{label}</p>
      <p className="mt-1 truncate font-display text-2xl leading-none text-white">
        {typeof value === 'number' ? formatNumber(value) : value}
      </p>
    </div>
  );
}

function TeamScoreboard({
  team,
  players,
  localPlayerId,
  isCaptureTheFlag,
}: {
  team: Team;
  players: MatchSummaryPlayer[];
  localPlayerId: string | null;
  isCaptureTheFlag: boolean;
}) {
  const faction = getTeamPresentation(team);
  const objectiveLabel = isCaptureTheFlag ? 'Caps' : 'Elims';

  return (
    <section className="match-summary-team-board min-w-0 border border-white/10 bg-black/35 backdrop-blur-sm">
      <div
        className="match-summary-team-board-header flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3"
        style={{ background: faction.bgColor }}
      >
        <div>
          <p className="font-display text-2xl leading-none" style={{ color: faction.primaryColor }}>
            {faction.name}
          </p>
          <p className="mt-1 font-body text-xs text-white/35">{faction.fullName}</p>
        </div>
        <span className="font-mono text-sm text-white/45">{players.length} players</span>
      </div>

      <div className="match-summary-board-head grid grid-cols-[minmax(0,1.4fr)_2.75rem_2.75rem_2.75rem_3.25rem_4.5rem] gap-2 border-b border-white/10 px-4 py-2 font-body text-xs uppercase text-white/35 sm:grid-cols-[minmax(0,1.6fr)_4.5rem_2.75rem_2.75rem_2.75rem_3.25rem_4.5rem_4.5rem]">
        <span>Player</span>
        <span className="hidden text-right sm:block">Hero</span>
        <span className="text-right">K</span>
        <span className="text-right">D</span>
        <span className="text-right">A</span>
        <span className="text-right">{objectiveLabel}</span>
        <span className="text-right">Score</span>
        <span className="hidden text-right sm:block">XP</span>
      </div>

      <div>
        {players.length > 0 ? players.map((player) => (
          <ScoreboardRow
            key={player.playerId}
            player={player}
            isLocal={player.playerId === localPlayerId}
            faction={faction}
            isCaptureTheFlag={isCaptureTheFlag}
          />
        )) : (
          <div className="px-4 py-8 text-center font-body text-sm text-white/35">No players</div>
        )}
      </div>
    </section>
  );
}

function ScoreboardRow({
  player,
  isLocal,
  faction,
  isCaptureTheFlag,
}: {
  player: MatchSummaryPlayer;
  isLocal: boolean;
  faction: TeamPresentation;
  isCaptureTheFlag: boolean;
}) {
  const objectiveValue = isCaptureTheFlag ? player.stats.flagCaptures : player.stats.kills;

  return (
    <div className={`match-summary-board-row grid grid-cols-[minmax(0,1.4fr)_2.75rem_2.75rem_2.75rem_3.25rem_4.5rem] gap-2 border-b border-white/10 px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1.6fr)_4.5rem_2.75rem_2.75rem_2.75rem_3.25rem_4.5rem_4.5rem] ${isLocal ? 'bg-white/[0.08]' : ''}`}>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-display text-base leading-none text-white">{player.playerName}</span>
          {isLocal && (
            <span className="shrink-0 border border-white/15 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/60">
              YOU
            </span>
          )}
          {player.isBot && (
            <span className="shrink-0 border border-cyan-300/25 bg-cyan-400/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan-200">
              AI
            </span>
          )}
        </div>
        {!player.isBot && player.rank && (
          <RankBadge rank={player.rankAfter ?? player.rank} compact className="mt-1 max-w-[8rem] py-0.5 text-[10px]" />
        )}
        <p className="mt-1 truncate font-body text-xs text-white/30 sm:hidden">{getHeroLabel(player)}</p>
      </div>
      <span className="hidden self-center truncate text-right font-body text-xs text-white/45 sm:block">
        {getHeroLabel(player)}
      </span>
      <span className="self-center text-right font-mono text-sm text-white/80">{player.stats.kills}</span>
      <span className="self-center text-right font-mono text-sm text-white/55">{player.stats.deaths}</span>
      <span className="self-center text-right font-mono text-sm text-white/55">{player.stats.assists}</span>
      <span className="self-center text-right font-mono text-sm" style={{ color: objectiveValue > 0 ? faction.secondaryColor : 'rgba(255,255,255,0.45)' }}>
        {objectiveValue}
      </span>
      <span className="self-center text-right font-mono text-sm text-white/85">{formatNumber(player.score)}</span>
      <span className="hidden self-center text-right font-mono text-sm text-accent-primary sm:block">
        {player.experienceGained > 0 ? `+${formatNumber(player.experienceGained)}` : '-'}
      </span>
    </div>
  );
}
