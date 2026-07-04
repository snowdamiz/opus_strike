import assert from 'node:assert/strict';
import type { GameEndEvent, MatchOutcome, Team } from '@voxel-strike/shared';
import { GameRoom } from '../rooms/GameRoom';
import { BattleRoyalPlacementTracker } from '../rooms/battleRoyalPlacement';

interface TestPlayer {
  id: string;
  name: string;
  team: Team;
  role: 'combat';
  state: string;
  isBot: boolean;
  kills: number;
  deaths: number;
  assists: number;
  flagCaptures: number;
  flagReturns: number;
}

function player(id: string, team: Team, state = 'dead'): TestPlayer {
  return {
    id,
    name: id,
    team,
    role: 'combat',
    state,
    isBot: false,
    kills: 0,
    deaths: state === 'dead' ? 1 : 0,
    assists: 0,
    flagCaptures: 0,
    flagReturns: 0,
  };
}

function createSummaryPlayer(source: TestPlayer, outcome: MatchOutcome) {
  return {
    playerId: source.id,
    userId: `user-${source.id}`,
    playerName: source.name,
    team: source.team,
    heroId: null,
    isBot: source.isBot,
    outcome,
    stats: {
      kills: source.kills,
      deaths: source.deaths,
      assists: source.assists,
      flagCaptures: source.flagCaptures,
      flagReturns: source.flagReturns,
    },
    score: source.kills * 100 + source.assists * 50,
    experienceGained: 0,
  };
}

function createRoomWithPlacement(): any {
  const room = Object.create(GameRoom.prototype) as any;
  const local = player('local', 'br_01');
  const teammate = player('teammate', 'br_01');
  const enemy = player('enemy', 'br_02', 'alive');
  const players = new Map<string, TestPlayer>([
    [local.id, local],
    [teammate.id, teammate],
    [enemy.id, enemy],
  ]);

  room.gameplayMode = 'battle_royal';
  room.matchMode = 'ranked';
  room.matchPerspective = 'third_person';
  room.state = {
    phase: 'playing',
    roundStartTime: 1000,
    redTeam: { score: 0 },
    blueTeam: { score: 0 },
    mapThemeId: 'standard',
    players,
  };
  room.matchLedger = {
    getLedger: () => ({ startedAt: new Date(1000) }),
    getMatchId: () => 'match-1',
    markParticipantLeft: () => {
      room.leftMarks = (room.leftMarks ?? 0) + 1;
    },
  };
  room.matchSummary = {
    buildGameEndEvent: (input: {
      matchMode: GameEndEvent['matchMode'];
      gameplayMode: GameEndEvent['gameplayMode'];
      matchPerspective: GameEndEvent['matchPerspective'];
      winningTeam: Team | null;
      finalScore: GameEndEvent['finalScore'];
      matchId: string | null;
      startedAt: number;
      endedAt: number;
      players: Map<string, TestPlayer>;
    }): GameEndEvent => ({
      matchMode: input.matchMode,
      gameplayMode: input.gameplayMode,
      matchPerspective: input.matchPerspective,
      winningTeam: input.winningTeam,
      finalScore: input.finalScore,
      matchId: input.matchId,
      endedAt: input.endedAt,
      durationMs: input.endedAt - input.startedAt,
      players: Array.from(input.players.values(), (source) => createSummaryPlayer(source, 'draw')),
    }),
  };
  room.battleRoyalPlacement = new BattleRoyalPlacementTracker();
  room.battleRoyalPlacement.initialize([
    { team: 'br_01', state: 'alive' },
    { team: 'br_02', state: 'alive' },
  ], 1000);
  room.battleRoyalPlacement.update(players.values(), 2000);
  room.battleRoyalTeamSummarySent = new Set<Team>();
  room.clients = [
    { sessionId: local.id },
    { sessionId: teammate.id },
    { sessionId: enemy.id },
  ];
  room.sent = [] as Array<{ sessionId: string; type: string; payload: GameEndEvent }>;
  room.sendTrackedAfterGameplayWork = (client: { sessionId: string }, type: string, payload: GameEndEvent) => {
    room.sent.push({ sessionId: client.sessionId, type, payload });
  };

  return room;
}

{
  const room = createRoomWithPlacement();
  room.markMatchParticipantLeftIfIncomplete(player('left-before-complete', 'br_02', 'dead'));
  assert.equal(room.leftMarks, 1);

  room.markMatchParticipantLeftIfIncomplete(player('left-after-complete', 'br_01', 'dead'));
  assert.equal(room.leftMarks, 1);
}

{
  const room = createRoomWithPlacement();
  room.sendBattleRoyalTeamEliminatedSummary('br_01', 2000);
  assert.equal(room.sent.length, 2);
  assert.deepEqual(room.sent.map((message: { sessionId: string }) => message.sessionId), ['local', 'teammate']);
  assert.equal(room.sent.every((message: { type: string }) => message.type === 'gameEnd'), true);

  const summary: GameEndEvent = room.sent[0].payload;
  assert.equal(summary.completionReason, 'team_eliminated');
  assert.equal(summary.completedTeam, 'br_01');
  assert.equal(summary.completedTeamPlacement, 2);
  assert.equal(summary.activeTeamCount, 2);
  assert.equal(summary.winningTeam, null);
  assert.equal(summary.players.find((entry) => entry.playerId === 'local')?.outcome, 'loss');
  assert.equal(summary.players.find((entry) => entry.playerId === 'local')?.placement, 2);
  assert.equal(summary.players.find((entry) => entry.playerId === 'enemy')?.outcome, 'draw');

  room.sendBattleRoyalTeamEliminatedSummary('br_01', 2100);
  assert.equal(room.sent.length, 2);
}

{
  const room = createRoomWithPlacement();
  room.sendBattleRoyalTeamEliminatedSummary('br_01', 2000);
  room.sent = [];

  room.sendBattleRoyalCompletedTeamSummaryToClient({ sessionId: 'reconnect' }, 'br_01', 2200);

  assert.equal(room.sent.length, 1);
  assert.equal(room.sent[0].sessionId, 'reconnect');
  assert.equal(room.sent[0].type, 'gameEnd');
  assert.equal(room.sent[0].payload.completionReason, 'team_eliminated');
  assert.equal(room.sent[0].payload.completedTeam, 'br_01');
  assert.equal(room.sent[0].payload.completedTeamPlacement, 2);
}

console.log('battle royal completion tests passed');
