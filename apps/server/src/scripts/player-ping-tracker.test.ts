import assert from 'node:assert/strict';
import {
  DEFAULT_COMPETITIVE_NETWORK_QUALITY_GATE,
} from '../rooms/networkQualityGate';
import { PlayerPingTracker, type PlayerPingParticipant } from '../rooms/playerPingTracker';

const config = DEFAULT_COMPETITIVE_NETWORK_QUALITY_GATE;

function participants(): Map<string, PlayerPingParticipant> {
  return new Map([
    ['red-human', { name: 'Red Human', team: 'red', isBot: false }],
    ['blue-human', { name: 'Blue Human', team: 'blue', isBot: false }],
    ['red-bot', { name: 'Red Bot', team: 'red', isBot: true }],
  ]);
}

{
  const tracker = new PlayerPingTracker();

  assert.equal(tracker.shouldBroadcast(), true);
  assert.equal(tracker.shouldBroadcast(), false);
  tracker.markDirty();
  assert.equal(tracker.shouldBroadcast(), true);
}

{
  const tracker = new PlayerPingTracker(config, 999);
  const request = tracker.createPingRequest('red-human', 12, 1_000);

  assert.deepEqual(request, { nonce: '12:1:red-human' });
  assert.equal(tracker.hasPendingPing('red-human'), true);
  assert.deepEqual(tracker.recordPingResponse('red-human', 'wrong', 1_010), { accepted: false });
  assert.equal(tracker.hasPendingPing('red-human'), true);

  const response = tracker.recordPingResponse('red-human', request.nonce, 1_037);
  assert.deepEqual(response, { accepted: true, pingMs: 37 });
  assert.equal(tracker.hasPendingPing('red-human'), false);
  assert.equal(tracker.getPingMs('red-human'), 37);
  assert.equal(tracker.shouldBroadcast(), true);
}

{
  const tracker = new PlayerPingTracker(config);
  tracker.shouldStartProbe(3_000, 3_000);
  tracker.createPingRequest('red-human', 1, 3_000);

  assert.equal(tracker.shouldStartProbe(5_999, 3_000), false);
  assert.equal(tracker.shouldStartProbe(6_000, 3_000), true);
  assert.deepEqual(tracker.recordTimedOutPings(13_001, 10_000), ['red-human']);
  assert.equal(tracker.hasPendingPing('red-human'), false);
}

{
  const tracker = new PlayerPingTracker(config);
  const redRequest = tracker.createPingRequest('red-human', 1, 1_000);
  tracker.recordPingResponse('red-human', redRequest.nonce, 1_044);
  const blueRequest = tracker.createPingRequest('blue-human', 2, 2_000);
  tracker.recordPingResponse('blue-human', blueRequest.nonce, 2_088);

  assert.deepEqual(
    tracker.buildPlayerPingsMessage({
      serverTime: 3_000,
      players: participants(),
      recipient: { id: 'red-human', team: 'red' },
    }),
    {
      serverTime: 3_000,
      players: [
        { playerId: 'red-human', pingMs: 44 },
        { playerId: 'blue-human', pingMs: null },
        { playerId: 'red-bot', pingMs: null },
      ],
    }
  );

  assert.deepEqual(
    tracker.buildPlayerPingsMessage({
      serverTime: 3_000,
      players: participants(),
      recipient: null,
    }),
    {
      serverTime: 3_000,
      players: [
        { playerId: 'red-human', pingMs: 44 },
        { playerId: 'blue-human', pingMs: 88 },
        { playerId: 'red-bot', pingMs: null },
      ],
    }
  );
}

{
  const tracker = new PlayerPingTracker(config);

  assert.deepEqual(
    tracker.evaluateCompetitiveGate(participants(), 20_000, false),
    { status: 'ready' }
  );

  const stateStartedAt = 1_000;
  tracker.getNetworkQualityState('red-human', stateStartedAt);
  tracker.recordNetworkQualitySample('red-human', { at: 7_000, pingMs: 190 });
  tracker.recordNetworkQualitySample('red-human', { at: 7_500, pingMs: 205 });
  tracker.recordNetworkQualitySample('red-human', { at: 8_000, pingMs: 215 });

  assert.deepEqual(
    tracker.evaluateCompetitiveGate(
      new Map([['red-human', participants().get('red-human')!]]),
      8_000,
      true
    ),
    { status: 'ready' }
  );

  tracker.recordNetworkQualitySample('red-human', { at: 11_000, pingMs: null, timedOut: true });
  tracker.recordNetworkQualitySample('red-human', { at: 14_000, pingMs: null, timedOut: true });

  const blocked = tracker.evaluateCompetitiveGate(
    new Map([['red-human', participants().get('red-human')!]]),
    14_000,
    true
  );
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.evaluation?.reason, 'network_timeouts');
}

{
  const tracker = new PlayerPingTracker(config);
  const rankedPlayers = new Map([['red-human', participants().get('red-human')!]]);
  const staleRequest = tracker.createPingRequest('red-human', 1, 1_000);
  tracker.recordPingResponse('red-human', staleRequest.nonce, 1_900);

  tracker.resetNetworkQualityForPlayers(rankedPlayers, 2_000);

  assert.equal(tracker.hasPendingPing('red-human'), false);
  assert.deepEqual(tracker.recordPingResponse('red-human', staleRequest.nonce, 2_050), { accepted: false });
  const pending = tracker.evaluateCompetitiveGate(rankedPlayers, 2_100, true);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.evaluation?.reason, 'collecting_network_samples');

  tracker.recordNetworkQualitySample('red-human', { at: 5_000, pingMs: 42 });
  tracker.recordNetworkQualitySample('red-human', { at: 8_000, pingMs: 48 });
  tracker.recordNetworkQualitySample('red-human', { at: 10_000, pingMs: 45 });

  assert.deepEqual(
    tracker.evaluateCompetitiveGate(rankedPlayers, 10_000, true),
    { status: 'ready' }
  );
}

console.log('player ping tracker tests passed');
