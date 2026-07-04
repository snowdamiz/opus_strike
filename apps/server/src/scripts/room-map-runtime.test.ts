import assert from 'node:assert/strict';
import {
  CONSTRUCTED_MAP_MANIFEST_VERSION,
  DEFAULT_GAMEPLAY_MODE,
  generateProceduralVoxelMap,
  getPregeneratedMapDiagnostics,
  getPregeneratedMapPreviewTags,
  getPregeneratedMapStats,
  type Team,
  type MapProfileId,
  type PregeneratedMapCatalogSummary,
  type VoxelMapSizeId,
  type VoxelMapTheme,
  type VoxelMapManifest,
} from '@voxel-strike/shared';
import {
  BOT_TACTICS_INTERVAL_MS,
  type BotFlagSnapshot,
  type BotPlayerSnapshot,
} from '../rooms/bot-ai';
import { RoomMapRuntime, type RoomMapRuntimeConfig } from '../rooms/roomMapRuntime';

let config: RoomMapRuntimeConfig = {
  mapSeed: 12_345,
  mapThemeId: null,
  mapSize: 'small',
};

function createRuntime(): RoomMapRuntime {
  return new RoomMapRuntime({
    getMapConfig: () => config,
    getCollisionAabbs: () => [],
  });
}

function createPregeneratedSummary(
  manifest: VoxelMapManifest,
  id = 'pgmap_room_runtime',
  artifactId = 'pgartifact_room_runtime'
): PregeneratedMapCatalogSummary {
  const diagnostics = getPregeneratedMapDiagnostics(manifest);
  return {
    id,
    artifactId,
    seed: manifest.seed,
    themeId: manifest.themeId,
    profileId: manifest.profileId ?? 'ctf_arena',
    gameplayMode: manifest.gameplay.mode,
    familyId: manifest.familyId,
    mapSize: manifest.mapSize,
    topologyId: manifest.topologyId,
    displayName: 'Runtime Test Map',
    previewTags: getPregeneratedMapPreviewTags(manifest),
    preview: manifest.preview,
    stats: getPregeneratedMapStats(manifest),
    diagnosticsScore: diagnostics.score,
    diagnosticsWarnings: diagnostics.warnings,
    status: 'ready',
    visibility: 'public',
    generatorVersion: manifest.version,
    lastSelectedAt: null,
    selectionCount: 0,
    failureCount: 0,
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
  };
}

function flag(team: Team): BotFlagSnapshot {
  return {
    team,
    position: { x: 0, y: 0, z: 0 },
    basePosition: { x: 0, y: 0, z: 0 },
    carrierId: '',
    isAtBase: true,
    droppedAt: 0,
  };
}

const flags: Record<Team, BotFlagSnapshot> = {
  red: flag('red'),
  blue: flag('blue'),
};

const players: BotPlayerSnapshot[] = [];

async function runAsyncTests(): Promise<void> {
  config = {
    mapSeed: 33_333,
    mapThemeId: null,
    mapSize: 'small',
    mapProfileId: 'ctf_arena',
  };
  const runtime = createRuntime();
  const manifest = await runtime.refreshMapAsync();

  assert.equal(manifest.seed, config.mapSeed);
  assert.equal(runtime.getMapManifest(), manifest);
  assert.notEqual(runtime.getBotRouteGraph(), null);

  const pregeneratedManifest = generateProceduralVoxelMap(44_444, {
    themeId: 'verdant',
    mapSize: 'small',
    profileId: 'ctf_arena',
  });
  const pregeneratedSummary = createPregeneratedSummary(pregeneratedManifest);
  config = {
    mapSeed: pregeneratedManifest.seed,
    mapThemeId: pregeneratedManifest.themeId,
    mapSize: pregeneratedManifest.mapSize,
    mapProfileId: pregeneratedManifest.profileId,
    pregeneratedMapId: pregeneratedSummary.id,
    mapArtifactId: pregeneratedSummary.artifactId,
  };
  let loadCalls = 0;
  let fallbackRecordCount = 0;
  const artifactRuntime = new RoomMapRuntime({
    getMapConfig: () => config,
    getCollisionAabbs: () => [],
    isMapGenerationFallbackEnabled: () => false,
    loadPregeneratedMapManifest: async (mapId) => {
      loadCalls += 1;
      assert.equal(mapId, pregeneratedSummary.id);
      return { summary: pregeneratedSummary, manifest: pregeneratedManifest };
    },
    recordMapFallbackGeneration: async () => {
      fallbackRecordCount += 1;
    },
  });
  const loaded = await artifactRuntime.refreshMapAsync();
  assert.equal(loaded, pregeneratedManifest);
  assert.equal(artifactRuntime.getMapManifest(), pregeneratedManifest);
  assert.equal(artifactRuntime.getLoadedPregeneratedMapSummary()?.id, pregeneratedSummary.id);
  assert.equal(loadCalls, 1);
  assert.equal(fallbackRecordCount, 0);

  const outdatedRuntime = new RoomMapRuntime({
    getMapConfig: () => config,
    getCollisionAabbs: () => [],
    isMapGenerationFallbackEnabled: () => false,
    loadPregeneratedMapManifest: async () => ({
      summary: {
        ...pregeneratedSummary,
        generatorVersion: CONSTRUCTED_MAP_MANIFEST_VERSION - 1,
      },
      manifest: pregeneratedManifest,
    }),
  });
  await assert.rejects(
    () => outdatedRuntime.refreshMapAsync(),
    /outdated generator version/
  );

  const missingRuntime = new RoomMapRuntime({
    getMapConfig: () => config,
    getCollisionAabbs: () => [],
    isMapGenerationFallbackEnabled: () => false,
    loadPregeneratedMapManifest: async () => {
      throw new Error('artifact missing');
    },
  });
  await assert.rejects(() => missingRuntime.refreshMapAsync(), /artifact missing/);
  assert.throws(() => missingRuntime.getMapManifest(), /required but cannot be loaded synchronously/);

  let fallbackReason = '';
  const fallbackRuntime = new RoomMapRuntime({
    getMapConfig: () => config,
    getCollisionAabbs: () => [],
    isMapGenerationFallbackEnabled: () => true,
    loadPregeneratedMapManifest: async () => {
      throw new Error('hash mismatch');
    },
    recordMapFallbackGeneration: async (input) => {
      fallbackReason = input.reason;
    },
  });
  const fallbackManifest = await fallbackRuntime.refreshMapAsync();
  assert.equal(fallbackManifest.seed, config.mapSeed);
  assert.match(fallbackReason, /hash mismatch/);
}

{
  const runtime = createRuntime();
  assert.doesNotThrow(() => runtime.getMovementCollisionWorld());
  assert.equal(runtime.getMapManifest().seed, config.mapSeed);
}

{
  const runtime = createRuntime();
  const manifest = runtime.refreshMap();

  assert.equal(manifest.seed, config.mapSeed);
  assert.equal(manifest.mapSize, config.mapSize);
  assert.equal(runtime.getMapManifest(), manifest);
  assert.equal(runtime.getBotRouteGraph(), runtime.getBotRouteGraph());

  const redSpawn = manifest.spawnPoints.red[0];
  assert.ok(redSpawn);
  assert.notEqual(runtime.getProceduralGroundY(redSpawn), null);
  assert.deepEqual(runtime.clampToPlayableMap(redSpawn), redSpawn);
}

{
  const previousConfig = config;
  for (const mapProfileId of ['ctf_arena', 'tdm_arena'] satisfies MapProfileId[]) {
    config = {
      mapSeed: 24_680,
      mapThemeId: null,
      mapSize: 'small',
      mapProfileId,
    };
    const runtime = createRuntime();
    const manifest = runtime.refreshMap();

    assert.equal(manifest.profileId, mapProfileId);
    assert.equal(runtime.getMapManifest(), manifest);
    assert.equal(runtime.getMapManifest(), manifest);
  }
  config = previousConfig;
}

{
  const runtime = createRuntime();
  runtime.refreshMap();

  const firstWorld = runtime.getMovementCollisionWorld();
  assert.equal(runtime.getMovementCollisionWorld(), firstWorld);
  assert.equal(runtime.getMovementCollisionRevision(), 0);

  runtime.bumpMovementCollisionRevision();
  assert.equal(runtime.getMovementCollisionRevision(), 1);
  assert.notEqual(runtime.getMovementCollisionWorld(), firstWorld);
}

{
  const runtime = createRuntime();
  const firstManifest = runtime.refreshMap();
  runtime.bumpMovementCollisionRevision();

  config = {
    mapSeed: 54_321,
    mapThemeId: firstManifest.themeId as VoxelMapTheme['id'],
    mapSize: 'medium' as VoxelMapSizeId,
  };
  const refreshedManifest = runtime.getMapManifest();

  assert.notEqual(refreshedManifest.id, firstManifest.id);
  assert.equal(refreshedManifest.seed, config.mapSeed);
  assert.equal(refreshedManifest.mapSize, config.mapSize);
  assert.equal(runtime.getMovementCollisionRevision(), 0);
}

{
  const runtime = createRuntime();
  runtime.refreshMap();

  const firstTactics = runtime.refreshBotTeamTactics({
    now: 1_000,
    gameplayMode: DEFAULT_GAMEPLAY_MODE,
    players,
    flags,
  });
  assert.equal(runtime.refreshBotTeamTactics({
    now: 1_000 + BOT_TACTICS_INTERVAL_MS - 1,
    gameplayMode: DEFAULT_GAMEPLAY_MODE,
    players,
    flags,
  }), firstTactics);
  assert.notEqual(runtime.refreshBotTeamTactics({
    now: 1_000 + BOT_TACTICS_INTERVAL_MS,
    gameplayMode: DEFAULT_GAMEPLAY_MODE,
    players,
    flags,
  }), firstTactics);

  const cachedTactics = runtime.refreshBotTeamTactics({
    now: 2_000,
    gameplayMode: DEFAULT_GAMEPLAY_MODE,
    players,
    flags,
  });
  runtime.refreshMap();
  assert.notEqual(runtime.refreshBotTeamTactics({
    now: 2_001,
    gameplayMode: DEFAULT_GAMEPLAY_MODE,
    players,
    flags,
  }), cachedTactics);
}

runAsyncTests()
  .then(() => {
    console.log('room map runtime tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
