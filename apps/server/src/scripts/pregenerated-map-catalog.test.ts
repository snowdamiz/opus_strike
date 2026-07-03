import assert from 'node:assert/strict';
import {
  createProceduralMapPreview,
  type MapProfileId,
  type MapTopologyId,
  type PregeneratedMapCatalogSummary,
  type PregeneratedMapVisibility,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
import {
  formatMapPoolConsoleStatus,
  getRequiredMapPoolSlices,
  planMapPoolTopUpSliceIndexes,
  PregeneratedMapCatalogService,
} from '../maps/pregeneratedMapCatalog';

type ListInput = Parameters<PregeneratedMapCatalogService['listSelectableMaps']>[0];

function catalogMap(input: {
  id: string;
  seed: number;
  profileId: MapProfileId;
  mapSize: VoxelMapSizeId;
  themeId: VoxelMapTheme['id'];
  topologyId?: MapTopologyId;
  visibility?: PregeneratedMapVisibility;
  lastSelectedAt?: string | null;
  selectionCount?: number;
}): PregeneratedMapCatalogSummary {
  const preview = createProceduralMapPreview(input.seed, input.mapSize, {
    profileId: input.profileId,
    themeId: input.themeId,
  });
  return {
    id: input.id,
    artifactId: `${input.id}_artifact`,
    seed: input.seed >>> 0,
    themeId: input.themeId,
    profileId: input.profileId,
    gameplayMode: input.profileId === 'battle_royal_large' ? 'battle_royal' : 'ctf',
    familyId: input.profileId === 'battle_royal_large' ? 'battle_royal_large' : 'ctf_semantic_arena',
    mapSize: input.mapSize,
    topologyId: input.topologyId ?? preview.topologyId,
    displayName: `${input.themeId} ${input.mapSize}`,
    previewTags: [input.themeId, input.mapSize, input.topologyId ?? preview.topologyId],
    preview: preview.preview,
    stats: {
      solidBlockCount: 100,
      renderableChunkCount: 8,
      colliderCount: 12,
      estimatedTriangles: 400,
    },
    diagnosticsScore: 90,
    diagnosticsWarnings: [],
    status: 'ready',
    visibility: input.visibility ?? 'public',
    generatorVersion: 13,
    lastSelectedAt: input.lastSelectedAt ?? null,
    selectionCount: input.selectionCount ?? 0,
    failureCount: 0,
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
  };
}

class FakeCatalogService extends PregeneratedMapCatalogService {
  readonly listCalls: ListInput[] = [];

  constructor(private readonly maps: PregeneratedMapCatalogSummary[]) {
    super({} as never, {} as never);
  }

  override async releaseExpiredReservations(): Promise<number> {
    return 0;
  }

  override async listSelectableMaps(input: ListInput = {}): Promise<PregeneratedMapCatalogSummary[]> {
    this.listCalls.push(input);
    const visibilities = Array.isArray(input.visibility)
      ? input.visibility
      : [input.visibility ?? 'public'];
    return this.maps
      .filter((map) => map.status === 'ready')
      .filter((map) => visibilities.includes(map.visibility))
      .filter((map) => !input.gameplayMode || map.gameplayMode === input.gameplayMode)
      .filter((map) => !input.profileId || map.profileId === input.profileId)
      .filter((map) => !input.mapSize || map.mapSize === input.mapSize)
      .filter((map) => !input.themeId || map.themeId === input.themeId)
      .filter((map) => !input.topologyId || map.topologyId === input.topologyId)
      .slice(0, input.limit ?? 100);
  }
}

async function withMapPoolConsoleStatusDisabled<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.PREGENERATED_MAP_POOL_CONSOLE_STATUS;
  process.env.PREGENERATED_MAP_POOL_CONSOLE_STATUS = '0';
  try {
    return await fn();
  } finally {
    if (previous == null) {
      delete process.env.PREGENERATED_MAP_POOL_CONSOLE_STATUS;
    } else {
      process.env.PREGENERATED_MAP_POOL_CONSOLE_STATUS = previous;
    }
  }
}

function withMapPoolReadyCountEnv<T>(arena: string | undefined, battleRoyal: string | undefined, fn: () => T): T {
  const previousArena = process.env.PREGENERATED_MAP_POOL_ARENA_READY_PER_SLICE;
  const previousBattleRoyal = process.env.PREGENERATED_MAP_POOL_BATTLE_ROYAL_READY_PER_SLICE;
  if (arena == null) {
    delete process.env.PREGENERATED_MAP_POOL_ARENA_READY_PER_SLICE;
  } else {
    process.env.PREGENERATED_MAP_POOL_ARENA_READY_PER_SLICE = arena;
  }
  if (battleRoyal == null) {
    delete process.env.PREGENERATED_MAP_POOL_BATTLE_ROYAL_READY_PER_SLICE;
  } else {
    process.env.PREGENERATED_MAP_POOL_BATTLE_ROYAL_READY_PER_SLICE = battleRoyal;
  }

  try {
    return fn();
  } finally {
    if (previousArena == null) {
      delete process.env.PREGENERATED_MAP_POOL_ARENA_READY_PER_SLICE;
    } else {
      process.env.PREGENERATED_MAP_POOL_ARENA_READY_PER_SLICE = previousArena;
    }
    if (previousBattleRoyal == null) {
      delete process.env.PREGENERATED_MAP_POOL_BATTLE_ROYAL_READY_PER_SLICE;
    } else {
      process.env.PREGENERATED_MAP_POOL_BATTLE_ROYAL_READY_PER_SLICE = previousBattleRoyal;
    }
  }
}

function createFakePoolPrisma() {
  const calls = {
    readyGroupBy: 0,
    statusGroupBy: 0,
    count: 0,
  };

  const client = {
    pregeneratedMap: {
      updateMany: async () => ({ count: 0 }),
      groupBy: async (args: { by: string[] }) => {
        if (args.by.includes('status')) {
          calls.statusGroupBy += 1;
          return [
            { status: 'ready', _count: { _all: 1 } },
            { status: 'failed', _count: { _all: 0 } },
          ];
        }

        calls.readyGroupBy += 1;
        return [
          {
            profileId: 'ctf_arena',
            mapSize: 'small',
            themeId: 'verdant',
            _count: { _all: 1 },
          },
        ];
      },
      findFirst: async () => null,
      findMany: async () => [],
      count: async () => {
        calls.count += 1;
        throw new Error('pregenerated map pool readiness must use grouped counts');
      },
    },
    pregeneratedMapArtifact: {
      aggregate: async () => ({ _sum: { byteSize: 0 } }),
    },
    pregeneratedMapSelection: {
      count: async () => 0,
    },
  };

  return { calls, client: client as never };
}

async function run(): Promise<void> {
  withMapPoolReadyCountEnv(undefined, undefined, () => {
    const slices = getRequiredMapPoolSlices();
    assert.deepEqual(slices.slice(0, 3).map((slice) => slice.profileId), [
      'ctf_arena',
      'tdm_arena',
      'battle_royal_large',
    ]);
    assert.equal(slices.every((slice) => slice.requiredReadyCount === 1), true);
    assert.equal(new Set(slices.map((slice) => `${slice.profileId}:${slice.mapSize}:${slice.themeId}`)).size, slices.length);
  });

  withMapPoolReadyCountEnv('2', '3', () => {
    const slices = getRequiredMapPoolSlices();
    const ctfSlice = slices.find((slice) => slice.profileId === 'ctf_arena');
    const tdmSlice = slices.find((slice) => slice.profileId === 'tdm_arena');
    const battleRoyalSlice = slices.find((slice) => slice.profileId === 'battle_royal_large');
    assert.equal(ctfSlice?.requiredReadyCount, 2);
    assert.equal(tdmSlice?.requiredReadyCount, 2);
    assert.equal(battleRoyalSlice?.requiredReadyCount, 3);
  });

  assert.deepEqual(planMapPoolTopUpSliceIndexes([2, 2, 1], 5), [0, 1, 2, 0, 1]);
  assert.deepEqual(planMapPoolTopUpSliceIndexes([0, 2, 0, 1], 3), [1, 3, 1]);

  {
    const line = formatMapPoolConsoleStatus('map-generated', {
      mapId: 'pgmap_test',
      readyCountAfter: 3,
      targetReadyCount: 3,
    });
    assert.equal(line.startsWith('[map-pool] '), true);
    assert.deepEqual(JSON.parse(line.slice('[map-pool] '.length)), {
      event: 'map-generated',
      mapId: 'pgmap_test',
      readyCountAfter: 3,
      targetReadyCount: 3,
    });
  }

  {
    const service = new FakeCatalogService([
      catalogMap({ id: 'arena-small', seed: 101, profileId: 'ctf_arena', mapSize: 'small', themeId: 'verdant', topologyId: 'lane_triad' }),
      catalogMap({ id: 'arena-medium', seed: 102, profileId: 'ctf_arena', mapSize: 'medium', themeId: 'basalt', topologyId: 'diamond' }),
      catalogMap({ id: 'arena-large', seed: 103, profileId: 'ctf_arena', mapSize: 'large', themeId: 'desert', topologyId: 'hourglass' }),
      catalogMap({ id: 'arena-medium-used', seed: 104, profileId: 'ctf_arena', mapSize: 'medium', themeId: 'verdant', topologyId: 'diamond', selectionCount: 20 }),
      catalogMap({ id: 'hidden-admin', seed: 105, profileId: 'ctf_arena', mapSize: 'small', themeId: 'basalt', visibility: 'admin-only' }),
    ]);

    const options = await service.createMapVoteOptionsFromPool({
      gameplayMode: 'capture_the_flag',
      profileId: 'ctf_arena',
      source: 0x701,
    });

    assert.equal(options.length, 3);
    assert.equal(options.every((map) => map.visibility === 'public'), true);
    assert.equal(new Set(options.map((map) => map.seed)).size, 3);
    assert.deepEqual(new Set(options.map((map) => map.mapSize)), new Set(['small', 'medium', 'large']));
    assert.equal(service.listCalls[0]?.profileId, 'ctf_arena');
  }

  {
    const service = new FakeCatalogService([
      catalogMap({ id: 'br-small', seed: 201, profileId: 'battle_royal_large', mapSize: 'small', themeId: 'verdant', topologyId: 'ring', visibility: 'matchmaking-only' }),
      catalogMap({ id: 'br-medium', seed: 202, profileId: 'battle_royal_large', mapSize: 'medium', themeId: 'basalt', topologyId: 'ring' }),
      catalogMap({ id: 'br-large', seed: 203, profileId: 'battle_royal_large', mapSize: 'large', themeId: 'desert', topologyId: 'ring' }),
    ]);

    const selected = await service.selectMapForBattleRoyal({
      participantCount: 4,
      preferredMapSize: 'small',
      source: 0x51f15eed,
    });
    assert.equal(selected?.pregeneratedMapId, 'br-small');
    assert.equal(selected?.mapSize, 'small');
  }

  {
    const service = new FakeCatalogService([
      catalogMap({ id: 'br-medium-only', seed: 301, profileId: 'battle_royal_large', mapSize: 'medium', themeId: 'basalt', topologyId: 'ring' }),
    ]);

    const selected = await service.selectMapForBattleRoyal({
      participantCount: 4,
      preferredMapSize: 'small',
      source: 0x51f15eed,
    });
    assert.equal(selected?.pregeneratedMapId, 'br-medium-only');
    assert.equal(selected?.mapSize, 'medium');
  }

  await withMapPoolConsoleStatusDisabled(async () => {
    const { calls, client } = createFakePoolPrisma();
    const service = new PregeneratedMapCatalogService(client, {} as never);

    const overview = await service.getAdminOverview();
    assert.equal(calls.count, 0);
    assert.equal(calls.statusGroupBy, 1);
    assert.equal(calls.readyGroupBy, 1);
    assert.equal(overview.lowSlices.some((slice) => (
      slice.profileId === 'ctf_arena'
      && slice.mapSize === 'small'
      && slice.themeId === 'verdant'
      && slice.readyCount === 1
    )), false);
    assert.equal(overview.lowSlices.some((slice) => (
      slice.profileId === 'tdm_arena'
      && slice.mapSize === 'small'
      && slice.themeId === 'verdant'
      && slice.readyCount === 0
      && slice.requiredReadyCount === 1
    )), true);

    const result = await service.topUpPool({
      profileId: 'ctf_arena',
      mapSize: 'small',
      themeId: 'verdant',
      maxGenerated: 0,
    });
    assert.equal(calls.count, 0);
    assert.equal(calls.readyGroupBy, 2);
    assert.equal(result.generated, 0);
  });
}

run()
  .then(() => {
    console.log('pregenerated map catalog tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
