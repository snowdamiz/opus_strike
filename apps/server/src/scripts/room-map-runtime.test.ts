import assert from 'node:assert/strict';
import {
  DEFAULT_GAMEPLAY_MODE,
  type Team,
  type MapProfileId,
  type VoxelMapSizeId,
  type VoxelMapTheme,
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
