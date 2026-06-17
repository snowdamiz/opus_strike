import assert from 'node:assert/strict';
import {
  PlayerPingRuntime,
  buildNetworkQualityCancelNotice,
} from '../rooms/playerPingRuntime';
import type { PlayerPingParticipant } from '../rooms/playerPingTracker';

interface TestClient {
  sessionId: string;
}

function participants(): Map<string, PlayerPingParticipant> {
  return new Map([
    ['red-human', { name: 'Red Human', team: 'red', isBot: false }],
    ['blue-human', { name: 'Blue Human', team: 'blue', isBot: false }],
    ['red-bot', { name: 'Red Bot', team: 'red', isBot: true }],
  ]);
}

const clients: TestClient[] = [
  { sessionId: 'red-human' },
  { sessionId: 'blue-human' },
  { sessionId: 'red-bot' },
  { sessionId: 'missing-player' },
];

{
  const runtime = new PlayerPingRuntime();

  assert.deepEqual(
    runtime.startProbe({
      clients,
      players: participants(),
      tick: 1,
      now: 2_999,
    }),
    {
      started: false,
      timedOutPlayerIds: [],
      requests: [],
    }
  );

  const firstProbe = runtime.startProbe({
    clients,
    players: participants(),
    tick: 1,
    now: 3_000,
  });

  assert.equal(firstProbe.started, true);
  assert.deepEqual(firstProbe.timedOutPlayerIds, []);
  assert.deepEqual(
    firstProbe.requests.map(({ client, message }) => [client.sessionId, message]),
    [
      ['red-human', { nonce: '1:1:red-human' }],
      ['blue-human', { nonce: '1:2:blue-human' }],
    ]
  );

  const pendingProbe = runtime.startProbe({
    clients,
    players: participants(),
    tick: 2,
    now: 6_000,
  });

  assert.equal(pendingProbe.started, true);
  assert.deepEqual(pendingProbe.timedOutPlayerIds, []);
  assert.deepEqual(pendingProbe.requests, []);

  const timeoutProbe = runtime.startProbe({
    clients,
    players: participants(),
    tick: 3,
    now: 13_001,
  });

  assert.equal(timeoutProbe.started, true);
  assert.deepEqual(timeoutProbe.timedOutPlayerIds, ['red-human', 'blue-human']);
  assert.deepEqual(
    timeoutProbe.requests.map(({ client, message }) => [client.sessionId, message]),
    [
      ['red-human', { nonce: '3:3:red-human' }],
      ['blue-human', { nonce: '3:4:blue-human' }],
    ]
  );
}

{
  const runtime = new PlayerPingRuntime();
  const request = runtime.createPingRequest('red-human', 12, 1_000);

  assert.deepEqual(runtime.recordPingResponse('red-human', request.nonce, 1_042), {
    accepted: true,
    pingMs: 42,
  });
  assert.equal(runtime.getPingMs('red-human'), 42);
  assert.deepEqual(
    runtime.buildMessage({
      serverTime: 2_000,
      players: participants(),
      recipient: { id: 'red-human', team: 'red' },
    }),
    {
      serverTime: 2_000,
      players: [
        { playerId: 'red-human', pingMs: 42 },
        { playerId: 'blue-human', pingMs: null },
        { playerId: 'red-bot', pingMs: null },
      ],
    }
  );
}

{
  const runtime = new PlayerPingRuntime();

  assert.deepEqual(
    runtime.ensureCompetitiveGateForStart({
      players: participants(),
      now: 5_000,
      matchMode: 'custom',
      wagered: false,
    }),
    {
      ready: true,
      gate: { status: 'ready' },
    }
  );

  const pending = runtime.ensureCompetitiveGateForStart({
    players: new Map([['red-human', participants().get('red-human')!]]),
    now: 5_000,
    matchMode: 'ranked',
    wagered: false,
  });
  assert.equal(pending.ready, false);
  assert.equal(pending.gate.status, 'pending');
  assert.equal(pending.cancelNotice, undefined);

  const cancelledPending = runtime.ensureCompetitiveGateForStart({
    players: new Map([['red-human', participants().get('red-human')!]]),
    now: 5_000,
    matchMode: 'ranked',
    wagered: false,
    cancelPending: true,
  });
  assert.equal(cancelledPending.ready, false);
  assert.equal(cancelledPending.gate.status, 'pending');
  assert.equal(cancelledPending.cancelNotice?.blockedPlayerId, 'red-human');
  assert.equal(cancelledPending.cancelNotice?.networkQuality?.reason, 'collecting_network_samples');
}

{
  const runtime = new PlayerPingRuntime();
  const rankedPlayers = new Map([['red-human', participants().get('red-human')!]]);

  let request = runtime.createPingRequest('red-human', 1, 1_000);
  runtime.recordPingResponse('red-human', request.nonce, 1_200);
  request = runtime.createPingRequest('red-human', 2, 4_000);
  runtime.recordPingResponse('red-human', request.nonce, 4_210);
  request = runtime.createPingRequest('red-human', 3, 7_000);
  runtime.recordPingResponse('red-human', request.nonce, 7_220);

  const result = runtime.ensureCompetitiveGateForStart({
    players: rankedPlayers,
    now: 8_000,
    matchMode: 'ranked',
    wagered: false,
  });

  assert.equal(result.ready, false);
  assert.equal(result.gate.status, 'blocked');
  assert.equal(result.cancelNotice?.blockedPlayerId, 'red-human');
  assert.equal(result.cancelNotice?.blockedPlayerName, 'Red Human');
  assert.equal(result.cancelNotice?.networkQuality?.reason, 'average_ping_high');
  assert.match(result.cancelNotice?.message ?? '', /Red Human/);
}

{
  const notice = buildNetworkQualityCancelNotice(undefined, 'network_not_verified');

  assert.equal(notice.blockedPlayerId, undefined);
  assert.equal(notice.networkQuality?.reason, 'network_not_verified');
  assert.match(notice.message, /A player/);
}

console.log('player ping runtime tests passed');
