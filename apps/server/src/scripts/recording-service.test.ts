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
  buildRecordingArtifactRefs,
  getRecordingArtifactDir,
} from '../recordings/artifacts';
import {
  createBotMatchRecording,
  enqueueRecordingRender,
  getRecordingShowcaseJob,
  type RecordingShowcaseJob,
  type RecordingShowcaseJobRedis,
} from '../recordings/service';
import type {
  StreamerGameRoomCreateOptions,
  StreamerMatchMaker,
  StreamerObserverSeatOptions,
  StreamerRoomListing,
} from '../streamer/service';

class FakeRecordingMatchMaker implements StreamerMatchMaker {
  createdOptions: StreamerGameRoomCreateOptions[] = [];

  async query(): Promise<StreamerRoomListing[]> {
    return [];
  }

  async createRoom(_name: 'game_room', options: StreamerGameRoomCreateOptions): Promise<StreamerRoomListing> {
    this.createdOptions.push(options);
    const recording = options.recording;
    assert.ok(recording);
    const manifest = createManifestFromOptions(recording.id, options);
    const artifactDir = getRecordingArtifactDir(recording.id);
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(path.join(artifactDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return {
      name: 'game_room',
      roomId: manifest.roomId ?? 'room-1',
      processId: 'process-1',
      publicAddress: 'room-1.example.test',
      metadata: {
        streamerManagedBotGame: true,
        streamerFeedMode: options.streamerFeedMode,
        streamerCameraMode: options.streamerCameraMode,
      },
    };
  }

  async reserveSeatFor(_room: StreamerRoomListing, _options: StreamerObserverSeatOptions): Promise<never> {
    throw new Error('reserveSeatFor should not be called');
  }
}

class FakeShowcaseJobRedis implements RecordingShowcaseJobRedis {
  cachedValue: string | null = null;
  lastGetKey: string | null = null;

  async get(key: string): Promise<string | null> {
    this.lastGetKey = key;
    return this.cachedValue;
  }

  async set(_key: string, value: string, _mode: 'PX', _durationMs: number): Promise<unknown> {
    this.cachedValue = value;
    return 'OK';
  }
}

function createManifestFromOptions(id: string, options: StreamerGameRoomCreateOptions): RecordingManifest {
  assert.ok(options.recording);
  return {
    recordingVersion: RECORDING_ARTIFACT_VERSION,
    id,
    source: 'bot_match',
    status: 'recording',
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    finalizedAt: null,
    requestedDurationMs: options.recording.requestedDurationMs,
    maxDurationMs: options.recording.maxDurationMs,
    fps: options.recording.fps,
    viewport: options.recording.viewport,
    devicePixelRatio: options.recording.devicePixelRatio,
    cameraMode: options.recording.cameraMode,
    hudMode: options.recording.hudMode,
    hudSubjectPlayerId: options.recording.hudSubjectPlayerId ?? null,
    gameBuildId: options.recording.gameBuildId ?? null,
    serverBuildId: options.recording.serverBuildId ?? null,
    roomId: 'created-recording-room',
    matchId: 'match-1',
    map: {
      seed: options.mapSeed,
      themeId: options.mapThemeId,
      size: options.mapSize,
      profileId: options.mapProfileId,
      pregeneratedMapId: null,
      artifactId: null,
    },
    gameMode: options.gameplayMode,
    matchMode: options.matchMode,
    matchPerspective: options.matchPerspective,
    botAssignments: options.botAssignments.map((assignment) => ({
      playerId: assignment.playerId,
      playerName: assignment.playerName,
      team: assignment.team,
      heroId: assignment.heroId,
      skinId: assignment.skinId,
      botDifficulty: assignment.botDifficulty,
      botProfileId: assignment.botProfileId,
    })),
    roomOptions: {
      lobbyName: options.lobbyName,
      matchMode: options.matchMode,
      gameplayMode: options.gameplayMode,
      matchPerspective: options.matchPerspective,
      rankedEligible: options.rankedEligible,
      requiredHumanPlayers: options.requiredHumanPlayers,
      reservedHumanPlayers: options.reservedHumanPlayers,
      capacityPlayerCost: options.capacityPlayerCost,
      streamerManagedBotGame: options.streamerManagedBotGame,
      streamerFeedMode: options.streamerFeedMode,
      streamerCameraMode: options.streamerCameraMode,
      endlessMatch: options.endlessMatch,
    },
    artifacts: buildRecordingArtifactRefs(id),
    checksums: {},
    error: null,
  };
}

function createSummaryFromManifest(manifest: RecordingManifest): RecordingSummary {
  return {
    recordingVersion: RECORDING_ARTIFACT_VERSION,
    id: manifest.id,
    status: 'finalized',
    createdAt: manifest.createdAt,
    startedAt: manifest.startedAt,
    finalizedAt: '2026-01-01T00:00:05.000Z',
    durationMs: 5_000,
    requestedDurationMs: manifest.requestedDurationMs,
    roomId: manifest.roomId,
    matchId: manifest.matchId,
    eventCount: 3,
    actionCount: 2,
    checkpointCount: 1,
    players: manifest.botAssignments.map((assignment) => ({
      playerId: assignment.playerId,
      playerName: assignment.playerName,
      role: 'combat',
      team: assignment.team,
      heroId: assignment.heroId,
      isBot: true,
      kills: 0,
      deaths: 0,
      assists: 0,
    })),
    winner: null,
    notableEvents: [],
    renders: [],
    artifacts: manifest.artifacts,
    checksums: {},
    error: null,
  };
}

async function main(): Promise<void> {
  const previousRecordingsDir = process.env.RECORDINGS_DIR;
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recording-service-'));
  process.env.RECORDINGS_DIR = rootDir;

  try {
    const matchMaker = new FakeRecordingMatchMaker();
    const result = await createBotMatchRecording({
      adminUserId: 'admin-1',
      matchMaker,
      request: {
        heroId: 'chronos',
        gameplayMode: 'capture_the_flag',
        durationMs: 15_000,
        fps: 30,
        viewport: { width: 1280, height: 720 },
        hudMode: 'selected_player',
        gameBuildId: 'client-build',
        serverBuildId: 'server-build',
      },
      random: () => 0.42,
      now: () => 1_000,
    });

    assert.equal(matchMaker.createdOptions.length, 1);
    const roomOptions = matchMaker.createdOptions[0];
    assert.ok(roomOptions.recording);
    assert.equal(roomOptions.gameplayMode, 'capture_the_flag');
    assert.equal(roomOptions.streamerFeedMode, 'bot_deathmatch');
    assert.equal(roomOptions.streamerCameraMode, 'fixed_aerial');
    assert.equal(roomOptions.botAssignments[0]?.heroId, 'chronos');
    assert.equal(roomOptions.botAssignments[0]?.skinId, 'chronos.default');
    assert.equal(roomOptions.recording.requestedDurationMs, 15_000);
    assert.equal(roomOptions.recording.fps, 30);
    assert.equal(roomOptions.recording.viewport.width, 1280);
    assert.equal(roomOptions.recording.hudSubjectPlayerId, roomOptions.botAssignments[0]?.playerId);
    assert.equal(result.room.roomId, 'created-recording-room');
    assert.equal(result.manifest.id, roomOptions.recording.id);
    assert.equal(result.manifest.status, 'recording');

    const summaryPath = path.join(getRecordingArtifactDir(result.id), 'summary.json');
    await fs.writeFile(summaryPath, `${JSON.stringify(createSummaryFromManifest(result.manifest), null, 2)}\n`, 'utf8');

    const render = await enqueueRecordingRender(result.id, {
      fps: 24,
      viewport: { width: 640, height: 360 },
      hudMode: 'hidden',
    });
    assert.equal(render.recordingId, result.id);
    assert.equal(render.fps, 24);
    assert.equal(render.viewport.width, 640);
    assert.equal(render.hudMode, 'hidden');

    const queuedJob = JSON.parse(
      await fs.readFile(path.join(rootDir, 'render-queue', `${render.renderId}.json`), 'utf8')
    ) as typeof render;
    assert.equal(queuedJob.renderId, render.renderId);

    const cachedShowcaseJob: RecordingShowcaseJob = {
      id: 'showcase_cached',
      recordingId: 'rec_cached',
      renderId: null,
      status: 'recording',
      heroId: 'blaze',
      gameplayMode: 'team_deathmatch',
      recordingDurationMs: 300_000,
      recordingStartedAt: '2026-01-01T00:00:00.000Z',
      downloadUrl: null,
      error: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      serverProcessId: 'process-a',
      serverMachineId: 'machine-a',
    };
    const showcaseRedis = new FakeShowcaseJobRedis();
    showcaseRedis.cachedValue = JSON.stringify(cachedShowcaseJob);
    const loadedShowcaseJob = await getRecordingShowcaseJob(cachedShowcaseJob.id, {
      redis: showcaseRedis,
    });
    assert.deepEqual(loadedShowcaseJob, cachedShowcaseJob);
    assert.match(showcaseRedis.lastGetKey ?? '', /showcase_cached$/);
    const hydratedShowcaseJob = JSON.parse(
      await fs.readFile(path.join(rootDir, 'showcase-jobs', `${cachedShowcaseJob.id}.json`), 'utf8')
    ) as RecordingShowcaseJob;
    assert.equal(hydratedShowcaseJob.id, cachedShowcaseJob.id);

    await fs.rm(rootDir, { recursive: true, force: true });
  } finally {
    if (previousRecordingsDir === undefined) {
      delete process.env.RECORDINGS_DIR;
    } else {
      process.env.RECORDINGS_DIR = previousRecordingsDir;
    }
  }

  console.log('recording service tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
