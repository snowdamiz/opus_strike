import assert from 'node:assert/strict';
import { TokenVerifier } from 'livekit-server-sdk';
import { VoiceService } from '../voice/VoiceService';
import type { VoiceConfig } from '../voice/config';

const config: VoiceConfig = {
  requested: true,
  enabled: true,
  disabledReason: null,
  livekitUrl: 'http://livekit.test',
  livekitWsUrl: 'wss://livekit.test',
  apiKey: 'test-key',
  apiSecret: 'test-secret',
  environmentName: 'test',
  tokenTtlSeconds: 300,
  maxParticipantsPerRoom: 8,
};

const createdRooms: string[] = [];
const removedParticipants: Array<{ room: string; identity: string }> = [];

const roomClient = {
  async createRoom(options: { name: string }) {
    createdRooms.push(options.name);
    return {} as never;
  },
  async removeParticipant(room: string, identity: string) {
    removedParticipants.push({ room, identity });
  },
};

async function run() {
  const service = new VoiceService(config, roomClient);

  assert.equal(
    service.buildMatchTeamRoomName('game-123', 'red'),
    'opus:test:match:game-123:red'
  );
  assert.equal(
    service.buildMatchTeamRoomName('game-123', 'blue'),
    'opus:test:match:game-123:blue'
  );

  const tokenResponse = await service.issueMatchVoiceToken({
    requestId: 'request-1',
    playerId: 'session-red',
    identity: 'user:lobby-red',
    displayName: 'Red Player',
    team: 'red',
    lobbyId: 'lobby-1',
    gameRoomId: 'game-123',
    human: true,
    canPublish: true,
  });

  assert.equal(tokenResponse.enabled, true);
  assert.equal(tokenResponse.url, 'wss://livekit.test');
  assert.equal(tokenResponse.roomName, 'opus:test:match:game-123:red');
  assert.equal(tokenResponse.team, 'red');
  assert.ok(tokenResponse.token);
  assert.equal(JSON.stringify(tokenResponse).includes(config.apiSecret!), false);

  const verifier = new TokenVerifier(config.apiKey!, config.apiSecret!);
  const claims = await verifier.verify(tokenResponse.token!);
  assert.equal(claims.video?.roomJoin, true);
  assert.equal(claims.video?.room, 'opus:test:match:game-123:red');
  assert.equal(claims.video?.canSubscribe, true);
  assert.equal(claims.video?.canPublish, true);
  assert.equal(claims.video?.canPublishData, false);
  assert.deepEqual(claims.video?.canPublishSources, ['microphone']);

  const metadata = JSON.parse(String(claims.metadata));
  assert.equal(metadata.colyseusSessionId, 'session-red');
  assert.equal(metadata.team, 'red');
  assert.equal(metadata.gameRoomId, 'game-123');
  assert.equal(metadata.human, true);

  const botResponse = await service.issueMatchVoiceToken({
    requestId: 'request-bot',
    playerId: 'bot-1',
    identity: 'bot-1',
    displayName: 'Bot',
    team: 'blue',
    lobbyId: 'lobby-1',
    gameRoomId: 'game-123',
    human: false,
    canPublish: true,
  });
  assert.equal(botResponse.enabled, false);
  assert.equal(botResponse.reason, 'bots cannot join voice');

  await service.removeMatchParticipant('game-123', 'user:lobby-red', null, 'test');
  assert.deepEqual(removedParticipants, [
    { room: 'opus:test:match:game-123:red', identity: 'user:lobby-red' },
    { room: 'opus:test:match:game-123:blue', identity: 'user:lobby-red' },
  ]);

  assert.deepEqual(createdRooms, ['opus:test:match:game-123:red']);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
