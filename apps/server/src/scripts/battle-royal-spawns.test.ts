import assert from 'node:assert/strict';
import {
  BATTLE_ROYAL_TEAM_IDS,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  createProceduralTerrainLookup,
  generateProceduralVoxelMap,
} from '@voxel-strike/shared';
import {
  canCapsuleOccupy,
  createVoxelCollisionWorld,
} from '@voxel-strike/physics';

function assertBattleRoyalSpawnsAreCapsuleSafe(seed: number): void {
  const manifest = generateProceduralVoxelMap(seed, {
    profileId: 'battle_royal_large',
    mapSize: 'large',
  });
  const terrain = createProceduralTerrainLookup(manifest);
  const world = createVoxelCollisionWorld({
    origin: manifest.origin,
    voxelSize: manifest.voxelSize,
    cacheStaticAabbs: true,
    getGroundY: (position) => terrain.getGroundY(position),
    clampPosition: (position) => terrain.clampToPlayableMap(position),
    getBlockAtWorld: (position) => terrain.getBlockAtWorld(position),
    getMaxPlayableY: () => terrain.getMaxPlayableY(),
    getCollisionAabbs: () => [],
  });
  const invalidSpawnIds: string[] = [];

  for (const team of BATTLE_ROYAL_TEAM_IDS) {
    const points = manifest.gameplay.spawns?.[team]?.points ?? [];
    assert.equal(points.length, 3, `${team} should expose three squad spawn points`);

    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      if (!canCapsuleOccupy(world, point, PLAYER_HEIGHT, PLAYER_RADIUS)) {
        invalidSpawnIds.push(`${team}:${index}`);
      }
    }
  }

  assert.deepEqual(invalidSpawnIds, [], `battle royal seed ${seed} has blocked spawn capsules`);
}

assertBattleRoyalSpawnsAreCapsuleSafe(424242);

console.log('battle royal spawn safety tests passed');
