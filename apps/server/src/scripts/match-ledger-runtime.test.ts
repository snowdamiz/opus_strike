import assert from 'node:assert/strict';
import type { MatchMode, Team, VoxelMapTheme } from '@voxel-strike/shared';
import {
  MatchLedgerRuntime,
  type MatchLedgerConfig,
} from '../rooms/matchLedgerRuntime';
import type { Player } from '../rooms/schema/Player';

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
}): Player {
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
  } as unknown as Player;
}

let config: MatchLedgerConfig = {
  roomId: 'room-a',
  lobbyId: 'lobby-a',
  matchMode: 'ranked',
  mapSeed: 123,
  mapThemeId: 'forest' as VoxelMapTheme['id'],
  mapSize: 'medium',
  mapProfileId: 'ctf_arena',
  mapTopologyId: 'lane_triad',
  mapGeneratorVersion: 13,
  pregeneratedMapId: 'pgmap_ledger',
  rankedEligible: true,
};
let nextMatchId = 1;
const durableUsers = new Map<string, string>();
const npcIds = new Set<string>();

function createRuntime(): MatchLedgerRuntime {
  return new MatchLedgerRuntime({
    getConfig: () => config,
    getDurableUserId: (playerId) => durableUsers.get(playerId) ?? null,
    isRankedRewardEligible: () => true,
    isNpc: (playerId) => npcIds.has(playerId),
    createMatchId: () => `match-${nextMatchId++}`,
  });
}

function setDurable(playerId: string, userId = `user-${playerId}`): void {
  durableUsers.set(playerId, userId);
}

{
  durableUsers.clear();
  npcIds.clear();
  nextMatchId = 1;
  config = { ...config, matchMode: 'ranked' as MatchMode, rankedEligible: true };
  const runtime = createRuntime();

  const first = runtime.ensureLedger(Date.UTC(2026, 0, 1));
  assert.equal(first.created, true);
  assert.equal(first.ledger.matchId, 'match-1');
  assert.equal(first.ledger.roomId, config.roomId);
  assert.equal(first.ledger.matchMode, 'ranked');
  assert.equal(first.ledger.pregeneratedMapId, 'pgmap_ledger');
  assert.equal(first.ledger.mapGeneratorVersion, 13);
  assert.equal(first.ledger.startedAt.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(runtime.getMatchId(), 'match-1');

  const same = runtime.ensureLedger(Date.UTC(2026, 0, 2));
  assert.equal(same.created, false);
  assert.equal(same.ledger, first.ledger);

  first.ledger.state = 'persisted';
  const next = runtime.ensureLedger(Date.UTC(2026, 0, 3));
  assert.equal(next.created, true);
  assert.equal(next.ledger.matchId, 'match-2');

  runtime.clear();
  assert.equal(runtime.getLedger(), null);
  assert.equal(runtime.getMatchId(), null);
}

{
  durableUsers.clear();
  npcIds.clear();
  nextMatchId = 10;
  const runtime = createRuntime();
  runtime.ensureLedger(Date.UTC(2026, 1, 1));

  const red = player({ id: 'red-session-1', name: 'Red One', team: 'red', heroId: 'phantom' });
  setDurable(red.id, 'red-user');
  const participant = runtime.registerParticipant(red, Date.UTC(2026, 1, 1, 0, 1));
  assert.ok(participant);
  assert.equal(participant.userId, 'red-user');
  assert.equal(participant.playerSessionId, 'red-session-1');
  assert.equal(participant.heroId, 'phantom');

  const reconnect = player({
    id: 'red-session-2',
    name: 'Red Two',
    team: 'blue',
    heroId: 'blaze',
    kills: 5,
    deaths: 2,
    assists: 3,
    flagCaptures: 1,
    flagReturns: 4,
  });
  setDurable(reconnect.id, 'red-user');
  runtime.markParticipantLeft(red, Date.UTC(2026, 1, 1, 0, 3));
  assert.notEqual(participant.leftAt, null);

  const rejoined = runtime.registerParticipant(reconnect);
  assert.equal(rejoined, participant);
  const synced = runtime.syncParticipant(reconnect);
  assert.equal(synced, participant);
  assert.equal(participant.playerSessionId, 'red-session-2');
  assert.equal(participant.displayName, 'Red Two');
  assert.equal(participant.team, 'blue');
  assert.equal(participant.heroId, 'blaze');
  assert.equal(participant.leftAt, null);
  assert.equal(participant.kills, 5);
  assert.equal(participant.flagReturns, 4);

  const lowerStats = player({ id: 'red-session-2', team: 'blue', kills: 1, deaths: 1, assists: 1 });
  setDurable(lowerStats.id, 'red-user');
  runtime.syncParticipant(lowerStats);
  assert.equal(participant.kills, 5);
  assert.equal(participant.deaths, 2);

  const snapshots = runtime.buildParticipantSnapshots([lowerStats]);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].userId, 'red-user');
  assert.equal(snapshots[0].kills, 5);
  assert.notEqual(snapshots[0], participant);
}

{
  durableUsers.clear();
  npcIds.clear();
  const runtime = createRuntime();
  runtime.ensureLedger();

  const red = player({ id: 'red', team: 'red' });
  const blue = player({ id: 'blue', team: 'blue' });
  const bot = player({ id: 'bot', team: 'blue', isBot: true });
  const npc = player({ id: 'npc', team: 'blue' });
  setDurable(red.id, 'red-user');
  setDurable(blue.id, 'blue-user');
  setDurable(npc.id, 'npc-user');
  npcIds.add(npc.id);

  runtime.recordDeath(red, bot);
  assert.equal(runtime.registerParticipant(red)?.deaths, 1);

  runtime.recordDeath(red, blue);
  runtime.recordKill(blue, red);
  runtime.recordAssist(blue, red);
  runtime.recordKill(red, bot);
  runtime.recordAssist(red, bot);
  runtime.recordFlagCapture(red);
  runtime.recordFlagReturn(red);
  runtime.recordFlagCapture(npc);

  const redParticipant = runtime.syncParticipant(red);
  const blueParticipant = runtime.syncParticipant(blue);
  assert.equal(redParticipant?.deaths, 2);
  assert.equal(redParticipant?.kills, 1);
  assert.equal(redParticipant?.assists, 1);
  assert.equal(redParticipant?.humanKills, 0);
  assert.equal(redParticipant?.botKills, 1);
  assert.equal(redParticipant?.humanAssists, 0);
  assert.equal(redParticipant?.botAssists, 1);
  assert.equal(redParticipant?.flagCaptures, 1);
  assert.equal(redParticipant?.flagReturns, 1);
  assert.equal(blueParticipant?.kills, 1);
  assert.equal(blueParticipant?.assists, 1);
  assert.equal(blueParticipant?.humanKills, 1);
  assert.equal(blueParticipant?.botKills, 0);
  assert.equal(blueParticipant?.humanAssists, 1);
  assert.equal(blueParticipant?.botAssists, 0);
  assert.equal(runtime.buildParticipantSnapshots([red, blue, bot, npc]).length, 2);
}

{
  durableUsers.clear();
  npcIds.clear();
  const runtime = createRuntime();
  const { ledger } = runtime.ensureLedger();
  const red = player({ id: 'red', team: 'red' });
  const blue = player({ id: 'blue', team: 'blue' });
  setDurable(red.id, 'red-user');
  setDurable(blue.id, 'blue-user');
  runtime.registerParticipant(red);
  runtime.registerParticipant(blue);
  const participants = runtime.buildParticipantSnapshots([red, blue]);

  assert.equal(runtime.isFinalRankedEligible({
    ledger,
    participants,
    currentMatchMode: 'ranked',
    gameplayMode: 'capture_the_flag',
    npcCount: 0,
    requiredHumanPlayers: 2,
  }), true);
  assert.equal(runtime.isFinalRankedEligible({
    ledger,
    participants,
    currentMatchMode: 'ranked',
    gameplayMode: 'capture_the_flag',
    npcCount: 1,
    requiredHumanPlayers: 2,
  }), false);
  assert.equal(runtime.isFinalRankedEligible({
    ledger,
    participants,
    currentMatchMode: 'ranked',
    gameplayMode: 'capture_the_flag',
    npcCount: 0,
    requiredHumanPlayers: 2,
    forcedByPlayerId: 'red',
  }), false);

  assert.equal(runtime.isFinalRankedEligible({
    ledger,
    participants,
    currentMatchMode: 'ranked',
    gameplayMode: 'battle_royal',
    npcCount: 0,
    requiredHumanPlayers: 1,
  }), true);
}

console.log('match ledger runtime tests passed');
