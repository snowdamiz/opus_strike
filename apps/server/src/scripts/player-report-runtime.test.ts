import assert from 'node:assert/strict';
import {
  buildCreatePlayerReportInput,
  buildPlayerReportEvidenceInput,
  buildPlayerReportResultPayload,
  parsePlayerReportPayload,
  readPlayerReportRequestId,
  validatePlayerReportContext,
  type AuthenticatedPlayerReportParticipant,
  type PlayerReportParticipantSnapshot,
} from '../rooms/playerReportRuntime';

type ParticipantOverrides = Partial<Omit<PlayerReportParticipantSnapshot, 'stats' | 'position'>> & {
  stats?: Partial<PlayerReportParticipantSnapshot['stats']>;
  position?: Partial<PlayerReportParticipantSnapshot['position']>;
};

function makeParticipant(overrides: ParticipantOverrides = {}): PlayerReportParticipantSnapshot {
  const { stats: statsOverrides, position: positionOverrides, ...participantOverrides } = overrides;

  return {
    id: 'player-1',
    name: 'Player One',
    team: 'red',
    heroId: 'blaze',
    isBot: false,
    isNpc: false,
    userId: 'user-1',
    stats: {
      kills: 1,
      deaths: 2,
      assists: 3,
      flagCaptures: 4,
      flagReturns: 5,
      ...statsOverrides,
    },
    position: {
      x: 10,
      y: 20,
      z: 30,
      ...positionOverrides,
    },
    ...participantOverrides,
  };
}

function makeAuthenticatedParticipant(
  overrides: ParticipantOverrides & { userId?: string } = {}
): AuthenticatedPlayerReportParticipant {
  const participant = makeParticipant({ userId: 'user-1', ...overrides });
  if (!participant.userId) throw new Error('expected authenticated participant fixture');
  return participant as AuthenticatedPlayerReportParticipant;
}


{
  assert.equal(readPlayerReportRequestId(null), null);
  assert.equal(readPlayerReportRequestId({ requestId: '  report-1  ' }), 'report-1');
  assert.equal(readPlayerReportRequestId({ requestId: 'a'.repeat(120) }), 'a'.repeat(96));
}

{
  assert.deepEqual(parsePlayerReportPayload(null, 'reporter-1'), {
    ok: false,
    requestId: null,
    error: 'Invalid report payload',
  });
  assert.deepEqual(parsePlayerReportPayload({ requestId: 'r-1' }, 'reporter-1'), {
    ok: false,
    requestId: 'r-1',
    error: 'Target player is required',
  });
  assert.deepEqual(parsePlayerReportPayload({ requestId: 'r-1', targetPlayerId: 'reporter-1' }, 'reporter-1'), {
    ok: false,
    requestId: 'r-1',
    error: 'You cannot report yourself',
  });
}

{
  assert.deepEqual(
    parsePlayerReportPayload(
      {
        requestId: ' report-7 ',
        targetPlayerId: ' target-1 ',
        reason: 'Speed Hack',
        details: '  blinked    across the map  ',
      },
      'reporter-1'
    ),
    {
      ok: true,
      requestId: 'report-7',
      targetPlayerId: 'target-1',
      reason: 'speed_hack',
      details: 'blinked across the map',
    }
  );
}

{
  assert.deepEqual(
    parsePlayerReportPayload(
      {
        targetPlayerId: 'target-1',
        reason: 'not a real reason',
        details: 'x'.repeat(1100),
      },
      'reporter-1'
    ),
    {
      ok: true,
      requestId: null,
      targetPlayerId: 'target-1',
      reason: 'cheating',
      details: 'x'.repeat(1000),
    }
  );
}

{
  const reporter = makeParticipant({ id: 'reporter-1', name: 'Reporter', userId: 'reporter-user' });
  const target = makeParticipant({
    id: 'target-1',
    name: 'Target',
    team: 'blue',
    heroId: 'phantom',
    userId: 'target-user',
  });

  assert.deepEqual(validatePlayerReportContext({ reporter: null, target }), {
    ok: false,
    error: 'Reporter is not in this match',
  });
  assert.deepEqual(validatePlayerReportContext({ reporter, target: null }), {
    ok: false,
    error: 'Target player is no longer in this match',
  });
  assert.deepEqual(validatePlayerReportContext({ reporter, target: makeParticipant({ isBot: true }) }), {
    ok: false,
    error: 'Bots cannot be reported',
  });
  assert.deepEqual(validatePlayerReportContext({ reporter, target: makeParticipant({ isNpc: true }) }), {
    ok: false,
    error: 'Bots cannot be reported',
  });
  assert.deepEqual(validatePlayerReportContext({ reporter, target: makeParticipant({ userId: null }) }), {
    ok: false,
    error: 'Reports require authenticated player accounts',
  });
  assert.deepEqual(validatePlayerReportContext({ reporter: makeParticipant({ userId: '' }), target }), {
    ok: false,
    error: 'Reports require authenticated player accounts',
  });
  assert.deepEqual(validatePlayerReportContext({ reporter, target }), {
    ok: true,
    reporter,
    target,
  });
}

{
  const parsed = parsePlayerReportPayload(
    {
      requestId: 'report-9',
      targetPlayerId: 'target-1',
      reason: 'wallhack',
      details: 'tracked through terrain',
    },
    'reporter-1'
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error('expected valid parsed report payload');

  const reporter = makeAuthenticatedParticipant({
    id: 'reporter-1',
    name: 'Reporter',
    team: 'red',
    heroId: 'hookshot',
    userId: 'reporter-user',
    position: { x: 1, y: 2, z: 3 },
  });
  const target = makeAuthenticatedParticipant({
    id: 'target-1',
    name: 'Target',
    team: 'blue',
    heroId: 'phantom',
    userId: 'target-user',
    stats: { kills: 7, deaths: 1, assists: 2, flagCaptures: 0, flagReturns: 6 },
    position: { x: 4, y: 5, z: 6 },
  });

  assert.deepEqual(buildPlayerReportEvidenceInput({ parsed, reporter, target }), {
    eventType: 'player_report.cheating',
    category: 'player_report',
    source: 'game_room_player_report',
    userId: 'target-user',
    playerSessionId: 'target-1',
    team: 'blue',
    heroId: 'phantom',
    severity: 'medium',
    confidence: 0.55,
    reason: 'wallhack',
    details: {
      reporterUserId: 'reporter-user',
      reporterPlayerSessionId: 'reporter-1',
      reporterName: 'Reporter',
      targetName: 'Target',
      targetTeam: 'blue',
      details: 'tracked through terrain',
    },
    retentionClass: 'extended',
  });

  assert.deepEqual(
    buildCreatePlayerReportInput({
      parsed,
      reporter,
      target,
      room: {
        roomId: 'room-1',
        matchId: 'match-1',
        lobbyId: 'lobby-1',
        matchMode: 'ranked',
        mapSeed: 42,
        serverTick: 9001,
      },
      evidenceEventId: 'signal-1',
    }),
    {
      reason: 'wallhack',
      details: 'tracked through terrain',
      reporterUserId: 'reporter-user',
      reporterPlayerSessionId: 'reporter-1',
      reporterName: 'Reporter',
      targetUserId: 'target-user',
      targetPlayerSessionId: 'target-1',
      targetName: 'Target',
      targetTeam: 'blue',
      roomId: 'room-1',
      matchId: 'match-1',
      lobbyId: 'lobby-1',
      matchMode: 'ranked',
      mapSeed: 42,
      serverTick: 9001,
      evidenceEventId: 'signal-1',
      metadata: {
        targetHeroId: 'phantom',
        reporterTeam: 'red',
        targetStats: {
          kills: 7,
          deaths: 1,
          assists: 2,
          flagCaptures: 0,
          flagReturns: 6,
        },
        reporterPosition: { x: 1, y: 2, z: 3 },
        targetPosition: { x: 4, y: 5, z: 6 },
      },
    }
  );
}

{
  assert.deepEqual(buildPlayerReportResultPayload('r-1', { ok: false, error: 'Please wait' }), {
    requestId: 'r-1',
    ok: false,
    error: 'Please wait',
  });
  assert.deepEqual(buildPlayerReportResultPayload(null, { ok: true, reportId: 'report-1' }), {
    requestId: null,
    ok: true,
    reportId: 'report-1',
  });
}

console.log('player report runtime tests passed');
