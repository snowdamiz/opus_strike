import assert from 'node:assert/strict';
import {
  GOLDEN_VOXEL_MAP_THEME_ID,
  getRankFromRating,
  toPublicRankSnapshot,
  type PublicRankSnapshot,
  type Team,
} from '@voxel-strike/shared';
import type { AntiCheatIntegrityGate } from '../anticheat';
import type { RoomAuthContext } from '../auth/session';
import type { MatchParticipantSnapshot } from '../persistence/matchPersistence';
import {
  MatchSummaryRuntime,
  buildRankedUserStatesFromAuthContexts,
} from '../rooms/matchSummaryRuntime';
import type { Player } from '../rooms/schema/Player';

const rankSummary = getRankFromRating(800, 10);
const publicRank = toPublicRankSnapshot(rankSummary);

function player(input: {
  id: string;
  name?: string;
  team?: string;
  heroId?: string;
  isBot?: boolean;
  kills?: number;
  deaths?: number;
  assists?: number;
  flagCaptures?: number;
  flagReturns?: number;
  rank?: PublicRankSnapshot;
}): Player {
  const rank = input.rank ?? publicRank;
  return {
    id: input.id,
    name: input.name ?? input.id,
    team: input.team ?? 'red',
    heroId: input.heroId ?? 'phantom',
    isBot: input.isBot ?? false,
    kills: input.kills ?? 0,
    deaths: input.deaths ?? 0,
    assists: input.assists ?? 0,
    flagCaptures: input.flagCaptures ?? 0,
    flagReturns: input.flagReturns ?? 0,
    rankTier: rank.tier,
    rankTierLabel: rank.tierLabel,
    rankDivision: rank.division ?? 0,
    rankDivisionIndex: rank.divisionIndex ?? -1,
    rankLabel: rank.label,
    rankIconKey: rank.iconKey,
    rankIsRanked: rank.isRanked,
    rankPlacementRemaining: rank.placementRemaining,
  } as unknown as Player;
}

function playersMap(players: Player[]): { forEach(callback: (player: Player, playerId: string) => void): void } {
  const map = new Map(players.map((current) => [current.id, current]));
  return {
    forEach: (callback) => map.forEach((current, id) => callback(current, id)),
  };
}

function gate(input: Partial<AntiCheatIntegrityGate> = {}): AntiCheatIntegrityGate {
  return {
    status: 'clean',
    reviewRequired: false,
    rankedHoldRequired: false,
    observedOnly: false,
    reason: null,
    affectedUserIds: [],
    affectedTeams: [],
    score: 0,
    caseId: null,
    ...input,
  };
}

function participant(input: Partial<MatchParticipantSnapshot> = {}): MatchParticipantSnapshot {
  return {
    userId: 'user-red',
    playerSessionId: 'red',
    displayName: 'Red',
    team: 'red',
    heroId: 'phantom',
    kills: 2,
    deaths: 1,
    assists: 0,
    flagCaptures: 0,
    flagReturns: 0,
    joinedAt: new Date('2026-06-10T10:00:00.000Z'),
    leftAt: null,
    ...input,
  };
}

function authContext(input: {
  userId: string;
  competitiveRating: number;
  rankedGames?: number;
  rankedWins?: number;
  rankedLosses?: number;
  rankedDraws?: number;
  rankedPlacementsRemaining?: number;
  rankedPeakRating?: number;
}): RoomAuthContext {
  return {
    userId: input.userId,
    displayName: input.userId,
    competitiveRating: input.competitiveRating,
    rankedGames: input.rankedGames ?? 10,
    rankedPlacementsRemaining: input.rankedPlacementsRemaining ?? 0,
    tutorialCompletedAt: null,
    rankDivisionIndex: 0,
    rank: rankSummary,
    rankPayload: {
      current: publicRank,
      peak: {
        ...publicRank,
        rating: input.rankedPeakRating ?? input.competitiveRating,
      },
      competitiveRating: input.competitiveRating,
      rankedGames: input.rankedGames ?? 10,
      rankedWins: input.rankedWins ?? 5,
      rankedLosses: input.rankedLosses ?? 4,
      rankedDraws: input.rankedDraws ?? 1,
      rankedPlacementsRemaining: input.rankedPlacementsRemaining ?? 0,
    },
  } as unknown as RoomAuthContext;
}

const durableUsers = new Map<string, string>();
const npcIds = new Set<string>();
const runtime = new MatchSummaryRuntime({
  getDurableUserId: (playerId) => durableUsers.get(playerId) ?? null,
  isNpc: (playerId) => npcIds.has(playerId),
  getRankPayload: (current) => ({
    tier: current.rankTier as PublicRankSnapshot['tier'],
    tierLabel: current.rankTierLabel,
    division: current.rankDivision > 0 ? current.rankDivision : null,
    divisionIndex: current.rankDivisionIndex >= 0 ? current.rankDivisionIndex : null,
    label: current.rankLabel,
    iconKey: current.rankIconKey,
    isRanked: current.rankIsRanked,
    placementRemaining: current.rankPlacementRemaining,
  }),
});

{
  durableUsers.clear();
  npcIds.clear();
  durableUsers.set('red-ace', 'user-red');
  durableUsers.set('blue-ace', 'user-blue');
  npcIds.add('npc');

  const summaries = runtime.buildPlayers(playersMap([
    player({ id: 'blue-ace', name: 'Blue', team: 'blue', kills: 5 }),
    player({ id: 'red-bot', name: 'Bot', team: 'red', isBot: true, flagCaptures: 1 }),
    player({ id: 'red-ace', name: 'Ace', team: 'red', kills: 2, assists: 1 }),
    player({ id: 'invalid', name: 'Invalid', team: 'spectator', heroId: 'missing', kills: 1 }),
    player({ id: 'npc', name: 'NPC', team: 'blue', kills: 99 }),
  ]), 'red');

  assert.deepEqual(summaries.map((summary) => summary.playerId), ['red-bot', 'red-ace', 'invalid', 'blue-ace']);
  assert.equal(summaries.find((summary) => summary.playerId === 'npc'), undefined);
  assert.equal(summaries.find((summary) => summary.playerId === 'red-bot')?.experienceGained, 0);
  assert.equal(summaries.find((summary) => summary.playerId === 'invalid')?.team, 'red');
  assert.equal(summaries.find((summary) => summary.playerId === 'invalid')?.heroId, null);
  assert.equal(summaries.find((summary) => summary.playerId === 'blue-ace')?.userId, 'user-blue');
}

{
  durableUsers.clear();
  npcIds.clear();
  durableUsers.set('red', 'user-red');
  durableUsers.set('blue', 'user-blue');

  const event = runtime.buildGameEndEvent({
    matchMode: 'ranked',
    gameplayMode: 'capture_the_flag',
    matchPerspective: 'first_person',
    winningTeam: 'red',
    finalScore: { red: 3, blue: 1 },
    matchId: 'match-a',
    startedAt: 1000,
    endedAt: 7000,
    players: playersMap([
      player({ id: 'red', team: 'red', kills: 2 }),
      player({ id: 'blue', team: 'blue', kills: 1 }),
    ]),
    integrityGate: gate({ reviewRequired: true, observedOnly: true, status: 'suspicious' }),
    mapThemeId: GOLDEN_VOXEL_MAP_THEME_ID,
    goldenBiomeRewardLamports: '200000000',
  });

  assert.equal(event.durationMs, 6000);
  assert.equal(event.matchIntegrity?.status, 'suspicious');
  assert.equal(event.matchIntegrity?.reviewRequired, false);
  assert.equal(event.matchIntegrity?.message, 'Match integrity telemetry has been recorded.');
  assert.deepEqual(event.goldenBiomeReward, {
    rewardLamports: '200000000',
    rewardToken: 'SOL',
    winningTeam: 'red',
    eligiblePlayerIds: ['red'],
    status: 'pending',
  });
}

{
  durableUsers.clear();
  npcIds.clear();
  durableUsers.set('red', 'user-red');
  durableUsers.set('blue', 'user-blue');

  const rankedUserStates = buildRankedUserStatesFromAuthContexts([
    authContext({ userId: 'user-red', competitiveRating: 900, rankedGames: 12 }),
    authContext({ userId: 'user-blue', competitiveRating: 900, rankedGames: 12 }),
  ]);
  assert.equal(rankedUserStates[0].rankedPeakRating, 900);

  const event = runtime.buildGameEndEvent({
    matchMode: 'ranked',
    gameplayMode: 'team_deathmatch',
    matchPerspective: 'third_person',
    winningTeam: 'red',
    finalScore: { red: 10, blue: 8 },
    matchId: 'match-ranked',
    startedAt: 0,
    endedAt: 120000,
    players: playersMap([
      player({ id: 'red', team: 'red', kills: 10, deaths: 2 }),
      player({ id: 'blue', team: 'blue', kills: 8, deaths: 4 }),
    ]),
    mapThemeId: 'forest',
    goldenBiomeRewardLamports: '200000000',
    rankedPreview: {
      participants: [
        participant({ userId: 'user-red', playerSessionId: 'red', team: 'red', kills: 10, deaths: 2 }),
        participant({ userId: 'user-blue', playerSessionId: 'blue', team: 'blue', kills: 8, deaths: 4 }),
      ],
      rankedUserStates,
      rankedEligible: true,
      rankedHoldRequired: false,
      gameplayMode: 'team_deathmatch',
    },
  });

  const red = event.players.find((summary) => summary.playerId === 'red');
  const blue = event.players.find((summary) => summary.playerId === 'blue');
  assert.equal(typeof red?.ratingDelta, 'number');
  assert.equal(typeof blue?.ratingDelta, 'number');
  assert.ok(red?.rankBefore);
  assert.ok(red?.rankAfter);
}

{
  durableUsers.clear();
  npcIds.clear();
  durableUsers.set('red', 'user-red');
  durableUsers.set('blue', 'user-blue');

  const event = runtime.buildGameEndEvent({
    matchMode: 'ranked',
    gameplayMode: 'team_deathmatch',
    matchPerspective: 'first_person',
    winningTeam: 'red',
    finalScore: { red: 1, blue: 0 },
    matchId: 'match-held',
    startedAt: 0,
    endedAt: 1000,
    players: playersMap([
      player({ id: 'red', team: 'red', kills: 1 }),
      player({ id: 'blue', team: 'blue' }),
    ]),
    mapThemeId: 'forest',
    goldenBiomeRewardLamports: '200000000',
    rankedPreview: {
      participants: [
        participant({ userId: 'user-red', playerSessionId: 'red', team: 'red' }),
        participant({ userId: 'user-blue', playerSessionId: 'blue', team: 'blue' }),
      ],
      rankedUserStates: [authContext({ userId: 'user-red', competitiveRating: 900 })]
        .map((context) => buildRankedUserStatesFromAuthContexts([context])[0]),
      rankedEligible: true,
      rankedHoldRequired: true,
      gameplayMode: 'team_deathmatch',
    },
  });

  assert.equal(event.players.some((summary) => typeof summary.ratingDelta === 'number'), false);
}

console.log('match summary runtime tests passed');
