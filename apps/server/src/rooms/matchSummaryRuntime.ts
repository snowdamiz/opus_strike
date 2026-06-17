import {
  GOLDEN_VOXEL_MAP_THEME_ID,
  getRankFromRating,
  toPublicRankSnapshot,
  type GameEndEvent,
  type GameplayMode,
  type MatchMode,
  type MatchOutcome,
  type MatchSummaryPlayer,
  type PublicRankSnapshot,
  type Team,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
import type { AntiCheatIntegrityGate } from '../anticheat';
import {
  calculateRankedRatingUpdates,
  type RankedUserState,
} from '../ranking/ratingService';
import type { RoomAuthContext } from '../auth/session';
import {
  calculateParticipantExperience,
  calculateParticipantScore,
  getMatchOutcome,
  type MatchParticipantSnapshot,
} from '../persistence/matchPersistence';
import { isHeroId, isTeam } from './protocolValidation';
import type { Player } from './schema/Player';

type PlayerMapLike = {
  forEach(callback: (player: Player, playerId: string) => void): void;
};

export interface MatchSummaryRuntimeDeps {
  getDurableUserId(playerId: string): string | null;
  isNpc(playerId: string): boolean;
  getRankPayload(player: Player): PublicRankSnapshot;
}

export interface RankedSummaryPreviewInput {
  participants: readonly MatchParticipantSnapshot[];
  rankedUserStates: readonly RankedUserState[];
  rankedEligible: boolean;
  rankedHoldRequired: boolean;
}

export interface BuildGameEndEventInput {
  matchMode: MatchMode;
  gameplayMode: GameplayMode;
  winningTeam: Team | null;
  finalScore: { red: number; blue: number };
  matchId: string | null;
  startedAt: number;
  endedAt: number;
  forcedByPlayerId?: string;
  players: PlayerMapLike;
  integrityGate?: AntiCheatIntegrityGate | null;
  mapThemeId: VoxelMapTheme['id'] | string | null;
  goldenBiomeRewardUsdCents: number;
  rankedPreview?: RankedSummaryPreviewInput;
}

export class MatchSummaryRuntime {
  constructor(private readonly deps: MatchSummaryRuntimeDeps) {}

  buildPlayerStats(player: Player): MatchSummaryPlayer['stats'] {
    return {
      kills: player.kills,
      deaths: player.deaths,
      assists: player.assists,
      flagCaptures: player.flagCaptures,
      flagReturns: player.flagReturns,
    };
  }

  buildPlayers(players: PlayerMapLike, winningTeam: Team | null): MatchSummaryPlayer[] {
    const summaries: MatchSummaryPlayer[] = [];

    players.forEach((player, playerId) => {
      if (this.deps.isNpc(playerId)) return;

      const team = isTeam(player.team) ? player.team : 'red';
      const outcome: MatchOutcome = getMatchOutcome(team, winningTeam);
      const stats = this.buildPlayerStats(player);
      const score = calculateParticipantScore(stats);

      summaries.push({
        playerId,
        userId: this.deps.getDurableUserId(playerId),
        playerName: player.name,
        team,
        heroId: isHeroId(player.heroId) ? player.heroId : null,
        isBot: player.isBot,
        outcome,
        stats,
        score,
        experienceGained: player.isBot ? 0 : calculateParticipantExperience(stats, outcome),
        rank: this.deps.getRankPayload(player),
      });
    });

    return summaries.sort(compareMatchSummaryPlayers);
  }

  buildGameEndEvent(input: BuildGameEndEventInput): GameEndEvent {
    const event: GameEndEvent = {
      matchMode: input.matchMode,
      gameplayMode: input.gameplayMode,
      winningTeam: input.winningTeam,
      finalScore: input.finalScore,
      matchId: input.matchId,
      endedAt: input.endedAt,
      durationMs: Math.max(0, input.endedAt - input.startedAt),
      forcedByPlayerId: input.forcedByPlayerId,
      players: this.buildPlayers(input.players, input.winningTeam),
    };

    if (input.integrityGate?.reviewRequired) {
      event.matchIntegrity = {
        status: input.integrityGate.status,
        reviewRequired: input.integrityGate.rankedHoldRequired || input.integrityGate.payoutHoldRequired,
        rankedOutcome: input.integrityGate.rankedHoldRequired ? 'review_required' : 'normal',
        wagerOutcome: input.integrityGate.payoutHoldRequired ? 'review_required' : 'normal',
        message: input.integrityGate.rankedHoldRequired || input.integrityGate.payoutHoldRequired
          ? 'Match rewards are pending integrity review.'
          : 'Match integrity telemetry has been recorded.',
      };
    }

    if (input.rankedPreview) {
      this.applyRankedSummaryUpdates(event, {
        ...input.rankedPreview,
        winningTeam: input.winningTeam,
        endedAt: new Date(input.endedAt),
      });
    }

    if (input.mapThemeId === GOLDEN_VOXEL_MAP_THEME_ID && input.matchMode === 'ranked') {
      event.goldenBiomeReward = {
        rewardUsdCents: input.goldenBiomeRewardUsdCents,
        rewardToken: 'SOL',
        winningTeam: input.winningTeam,
        eligiblePlayerIds: input.winningTeam
          ? event.players
            .filter((player) => !player.isBot && player.team === input.winningTeam)
            .map((player) => player.playerId)
          : [],
        status: input.winningTeam ? 'pending' : 'not_applicable',
      };
    }

    return event;
  }

  applyRankedSummaryUpdates(
    event: GameEndEvent,
    input: RankedSummaryPreviewInput & {
      winningTeam: Team | null;
      endedAt: Date;
    }
  ): boolean {
    if (!input.rankedEligible || input.rankedHoldRequired) return false;

    const usersById = new Map(input.rankedUserStates.map((user) => [user.id, user]));
    const users = input.participants.map((participant) => usersById.get(participant.userId));
    if (users.some((user) => !user)) return false;

    const participantsByUserId = new Map(input.participants.map((participant) => [participant.userId, participant]));
    const updates = calculateRankedRatingUpdates({
      participants: event.players
        .filter((player) => !player.isBot && player.userId)
        .map((player) => ({
          userId: player.userId!,
          team: player.team,
          outcome: player.outcome,
          score: player.score,
          kills: player.stats.kills,
          deaths: player.stats.deaths,
          assists: player.stats.assists,
          flagCaptures: player.stats.flagCaptures,
          flagReturns: player.stats.flagReturns,
          leftAt: participantsByUserId.get(player.userId!)?.leftAt ?? null,
        })),
      users: users as RankedUserState[],
      winningTeam: input.winningTeam,
      endedAt: input.endedAt,
    });
    const updatesByUserId = new Map(updates.map((update) => [update.userId, update]));

    for (const player of event.players) {
      if (!player.userId) continue;
      const update = updatesByUserId.get(player.userId);
      const user = usersById.get(player.userId);
      if (!update || !user) continue;

      player.ratingDelta = update.ratingDelta;
      player.rankBefore = toPublicRankSnapshot(getRankFromRating(update.ratingBefore, user.rankedGames));
      player.rankAfter = toPublicRankSnapshot(getRankFromRating(update.ratingAfter, update.rankedGamesAfter));
    }

    return updates.length > 0;
  }
}

export function buildRankedUserStatesFromAuthContexts(authContexts: Iterable<RoomAuthContext>): RankedUserState[] {
  return Array.from(authContexts, (authContext) => ({
    id: authContext.userId,
    competitiveRating: authContext.competitiveRating,
    rankedGames: authContext.rankedGames,
    rankedWins: authContext.rankPayload.rankedWins,
    rankedLosses: authContext.rankPayload.rankedLosses,
    rankedDraws: authContext.rankPayload.rankedDraws,
    rankedPlacementsRemaining: authContext.rankedPlacementsRemaining,
    rankedPeakRating: authContext.rankPayload.peak.rating,
  }));
}

function compareMatchSummaryPlayers(a: MatchSummaryPlayer, b: MatchSummaryPlayer): number {
  if (a.team !== b.team) return a.team === 'red' ? -1 : 1;
  return b.score - a.score || b.stats.kills - a.stats.kills || a.playerName.localeCompare(b.playerName);
}
