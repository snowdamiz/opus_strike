import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  RECORDING_ARTIFACT_VERSION,
  type RecordingManifest,
  type RecordingSummary,
} from '@voxel-strike/shared';
import {
  RecordingArtifactWriter,
  readCompleteNdjsonRows,
  readRecordingManifest,
  readRecordingSummary,
  redactRecordingPayload,
  requestRecordingStop,
  resolveRecordingArtifactPath,
  shouldRecordObserverMessage,
} from '../recordings/artifacts';

function createManifest(id: string): RecordingManifest {
  return {
    recordingVersion: RECORDING_ARTIFACT_VERSION,
    id,
    source: 'bot_match',
    status: 'creating',
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    finalizedAt: null,
    requestedDurationMs: 10_000,
    maxDurationMs: 60_000,
    fps: 60,
    viewport: { width: 1280, height: 720 },
    devicePixelRatio: 1,
    cameraMode: 'fixed_aerial',
    hudMode: 'selected_player',
    hudSubjectPlayerId: 'bot-1',
    gameBuildId: 'client-build',
    serverBuildId: 'server-build',
    roomId: 'room-1',
    matchId: 'match-1',
    map: {
      seed: 123,
      themeId: null,
      size: 'medium',
      profileId: 'tdm_arena',
      pregeneratedMapId: null,
      artifactId: null,
    },
    gameMode: 'team_deathmatch',
    matchMode: 'custom',
    matchPerspective: 'third_person',
    botAssignments: [{
      playerId: 'bot-1',
      playerName: 'Bot One',
      team: 'red',
      heroId: 'blaze',
      skinId: null,
      botDifficulty: 'hard',
      botProfileId: 'profile-1',
    }],
    roomOptions: {
      lobbyName: 'Recording Test',
      matchMode: 'custom',
      gameplayMode: 'team_deathmatch',
      matchPerspective: 'third_person',
      rankedEligible: false,
      requiredHumanPlayers: 0,
      reservedHumanPlayers: 0,
      capacityPlayerCost: 10,
      streamerManagedBotGame: true,
      streamerFeedMode: 'bot_deathmatch',
      streamerCameraMode: 'fixed_aerial',
      endlessMatch: true,
    },
    artifacts: {
      manifest: `${id}/manifest.json`,
      events: `${id}/events.ndjson`,
      actions: `${id}/actions.ndjson`,
      checkpoints: `${id}/checkpoints.ndjson`,
      summary: `${id}/summary.json`,
      mp4: null,
    },
    checksums: {},
    error: null,
  };
}

function createSummary(id: string): Omit<RecordingSummary, 'eventCount' | 'actionCount' | 'checkpointCount' | 'checksums'> {
  return {
    recordingVersion: RECORDING_ARTIFACT_VERSION,
    id,
    status: 'finalized',
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    finalizedAt: '2026-01-01T00:00:10.000Z',
    durationMs: 10_000,
    requestedDurationMs: 10_000,
    roomId: 'room-1',
    matchId: 'match-1',
    players: [{
      playerId: 'bot-1',
      playerName: 'Bot One',
      role: 'combat',
      team: 'red',
      heroId: 'blaze',
      isBot: true,
      kills: 1,
      deaths: 0,
      assists: 0,
    }],
    winner: 'red',
    notableEvents: [],
    renders: [],
    artifacts: {
      manifest: `${id}/manifest.json`,
      events: `${id}/events.ndjson`,
      actions: `${id}/actions.ndjson`,
      checkpoints: `${id}/checkpoints.ndjson`,
      summary: `${id}/summary.json`,
      mp4: null,
    },
    error: null,
  };
}

async function main(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recording-artifacts-'));
  const recordingId = 'rec_test';

  const redacted = redactRecordingPayload({
    ok: true,
    nested: {
      authToken: 'secret-token',
      csrfToken: 'secret-csrf',
      safe: 'kept',
    },
    list: [{ streamerObserverTicket: 'ticket' }],
  });
  assert.deepEqual(redacted, {
    ok: true,
    nested: {
      authToken: '[redacted]',
      csrfToken: '[redacted]',
      safe: 'kept',
    },
    list: [{ streamerObserverTicket: '[redacted]' }],
  });

  assert.equal(shouldRecordObserverMessage('matchSnapshot'), true);
  assert.equal(shouldRecordObserverMessage('playerTransformsV2'), true);
  assert.equal(shouldRecordObserverMessage('voiceToken'), false);
  assert.equal(shouldRecordObserverMessage('playerPingRequest'), false);
  assert.equal(shouldRecordObserverMessage('unknownMessage'), false);

  const writer = await RecordingArtifactWriter.create({
    manifest: createManifest(recordingId),
    rootDir,
    now: () => Date.parse('2026-01-01T00:00:00.250Z'),
  });
  writer.appendEvent('matchSnapshot', {
    token: 'must-redact',
    phase: 'playing',
  }, { serverTime: 250, tick: 5 });
  writer.appendEvent('voiceToken', { token: 'blocked' }, { serverTime: 300, tick: 6 });
  writer.appendAction({
    recordingTimeMs: 250,
    serverTime: 250,
    tick: 5,
    playerId: 'bot-1',
    kind: 'bot_input',
    buttons: { moveForward: true, primaryFire: true },
    lookYaw: 1,
    lookPitch: 0.25,
    selectedAbilitySlot: 'primary',
    combatTargetId: 'bot-2',
    botIntent: 'pressure',
    routeTarget: { x: 1, y: 2, z: 3 },
  });
  writer.appendCheckpoint({
    recordingTimeMs: 250,
    serverTime: 250,
    tick: 5,
    phase: 'playing',
    hash: 'hash-1',
    snapshot: {
      matchSnapshot: { phase: 'playing' },
    },
  });
  await requestRecordingStop(recordingId, rootDir);
  assert.equal(await writer.hasStopBeenRequested(), true);
  const summary = await writer.finalize(createSummary(recordingId));

  assert.equal(summary.eventCount, 1);
  assert.equal(summary.actionCount, 1);
  assert.equal(summary.checkpointCount, 1);
  assert.equal(typeof summary.checksums.eventsSha256, 'string');
  const eventsSha256 = summary.checksums.eventsSha256;
  assert.ok(eventsSha256);
  assert.equal(eventsSha256.length, 64);
  assert.equal(summary.checksums.summarySha256?.length, 64);

  const manifest = await readRecordingManifest(recordingId, rootDir);
  assert.equal(manifest.status, 'finalized');
  assert.equal(manifest.checksums.eventsSha256, summary.checksums.eventsSha256);

  const persistedSummary = await readRecordingSummary(recordingId, rootDir);
  assert.equal(persistedSummary.eventCount, 1);
  assert.equal(persistedSummary.renders.length, 0);

  const events = await readCompleteNdjsonRows<{ payload: Record<string, unknown> }>(
    resolveRecordingArtifactPath(recordingId, 'events', rootDir)
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.token, '[redacted]');

  const truncatedPath = path.join(rootDir, recordingId, 'truncated.ndjson');
  await fs.writeFile(truncatedPath, '{"ok":true}\n{"ok":', 'utf8');
  const truncatedRows = await readCompleteNdjsonRows<{ ok: boolean }>(truncatedPath);
  assert.deepEqual(truncatedRows, [{ ok: true }]);

  await fs.rm(rootDir, { recursive: true, force: true });

  console.log('recording artifact tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
