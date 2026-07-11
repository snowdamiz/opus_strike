import assert from 'node:assert/strict';
import { raycastVoxelTerrain } from '../rooms/voxelTerrainRaycast';

const origin = { x: -1, y: -1, z: -1 };
const voxelSize = { x: 0.5, y: 0.5, z: 0.5 };

function createCollisionLookup(solidVoxels: string[]) {
  const solids = new Set(solidVoxels);
  let probes = 0;
  return {
    isCollisionAtWorld(point: { x: number; y: number; z: number }): boolean {
      probes += 1;
      const x = Math.floor((point.x - origin.x) / voxelSize.x);
      const y = Math.floor((point.y - origin.y) / voxelSize.y);
      const z = Math.floor((point.z - origin.z) / voxelSize.z);
      return solids.has(`${x}:${y}:${z}`);
    },
    get probes(): number {
      return probes;
    },
  };
}

{
  const lookup = createCollisionLookup(['4:0:0']);
  const hit = raycastVoxelTerrain(
    { x: -0.75, y: -0.75, z: -0.75 },
    { x: 1, y: 0, z: 0 },
    5,
    origin,
    voxelSize,
    lookup.isCollisionAtWorld,
  );
  assert.deepEqual(hit, { x: 1, y: -0.75, z: -0.75 });
  assert.equal(lookup.probes, 5);
}

{
  const lookup = createCollisionLookup(['2:0:0']);
  const hit = raycastVoxelTerrain(
    { x: 1.75, y: -0.75, z: -0.75 },
    { x: -1, y: 0, z: 0 },
    5,
    origin,
    voxelSize,
    lookup.isCollisionAtWorld,
  );
  assert.deepEqual(hit, { x: 0.5, y: -0.75, z: -0.75 });
}

{
  const unitOrigin = { x: 0, y: 0, z: 0 };
  const unitVoxel = { x: 1, y: 1, z: 1 };
  const solids = new Set(['1:0:0', '2:2:2']);
  const hit = raycastVoxelTerrain(
    { x: 0.5, y: 0.5, z: 0.5 },
    { x: 1, y: 1, z: 1 },
    10,
    unitOrigin,
    unitVoxel,
    (point) => solids.has([
      Math.floor(point.x),
      Math.floor(point.y),
      Math.floor(point.z),
    ].join(':')),
  );
  assert.ok(hit);
  assert.ok(Math.abs(hit.x - 2) < 1e-9);
  assert.ok(Math.abs(hit.y - 2) < 1e-9);
  assert.ok(Math.abs(hit.z - 2) < 1e-9);
}

{
  const lookup = createCollisionLookup(['4:0:0']);
  assert.equal(raycastVoxelTerrain(
    { x: -0.75, y: -0.75, z: -0.75 },
    { x: 1, y: 0, z: 0 },
    1.74,
    origin,
    voxelSize,
    lookup.isCollisionAtWorld,
  ), null);
}

{
  const quarterVoxel = { x: 0.25, y: 0.25, z: 0.25 };
  let probes = 0;
  assert.equal(raycastVoxelTerrain(
    { x: 0.125, y: 0.125, z: 0.125 },
    { x: 1, y: 0, z: 0 },
    14,
    { x: 0, y: 0, z: 0 },
    quarterVoxel,
    () => {
      probes += 1;
      return false;
    },
  ), null);
  assert.ok(probes <= 58, `expected at most 58 voxel probes, received ${probes}`);
}

console.log('scrapshot terrain raycast tests passed');
