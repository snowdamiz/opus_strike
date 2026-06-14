#!/usr/bin/env node

import { isCollisionBlock } from '../dist/maps/procedural/blocks.js';
import { PLAYER_HEIGHT, PLAYER_RADIUS } from '../dist/constants/physics.js';
import { generateProceduralVoxelMapWithDiagnostics } from '../dist/maps/procedural/generator.js';

const DEFAULT_SEQUENTIAL_SEEDS = 20;
const DEFAULT_RANDOM_SEEDS = 8;
const DEFAULT_MAX_COLLIDERS = 48_000;
const MIN_AUTHORED_OBJECTS = 24;
const MIN_OBJECT_VARIANTS = 7;
const SPAWN_EGRESS_MAX_DISTANCE = 3.4;
const SPAWN_EGRESS_FLAG_BUFFER = 1.55;
const KNOWN_REGRESSION_SEEDS = [0, 1, 2, 42, 1337, 0x57564f58, 0xdecafbad, 0xc0ffee];
const BIOME_SIGNATURE_OBJECTS = {
  verdant: ['tree_cluster', 'pine_cluster', 'garden_marker'],
  basalt: ['basalt_columns', 'bamboo_thicket'],
  desert: ['cactus_stand', 'desert_outpost'],
  frost: ['pine_cluster', 'ice_outcrop'],
  crystal: ['crystal_tree_cluster', 'crystal_spire', 'basalt_columns'],
  volcanic: ['basalt_columns', 'broken_arch', 'crystal_spire'],
  sakura: ['blossom_tree_cluster', 'shrine_gate', 'bamboo_thicket'],
  golden: ['gold_cache', 'monument_ring'],
};
const TREE_OBJECTS = ['tree_cluster', 'pine_cluster', 'blossom_tree_cluster', 'crystal_tree_cluster', 'garden_marker'];

function parseArgs(argv) {
  const options = {
    start: 0,
    count: DEFAULT_SEQUENTIAL_SEEDS,
    randomCount: DEFAULT_RANDOM_SEEDS,
    debugSeed: null,
    maxColliders: DEFAULT_MAX_COLLIDERS,
    knownSeeds: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--start' && next) {
      options.start = Number(next);
      index++;
    } else if ((arg === '--count' || arg === '--seeds') && next) {
      options.count = Number(next);
      index++;
    } else if (arg === '--random-count' && next) {
      options.randomCount = Number(next);
      index++;
    } else if ((arg === '--debug' || arg === '--seed') && next) {
      options.debugSeed = Number(next);
      index++;
    } else if (arg === '--max-colliders' && next) {
      options.maxColliders = Number(next);
      index++;
    } else if (arg === '--known') {
      options.knownSeeds = true;
    } else if (arg === '--json') {
      options.json = true;
    }
  }

  return options;
}

function mulberry32(seed) {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createSeedList(options) {
  if (Number.isFinite(options.debugSeed)) return [options.debugSeed >>> 0];
  if (options.knownSeeds) return KNOWN_REGRESSION_SEEDS.map((seed) => seed >>> 0);

  const seeds = [];
  for (let index = 0; index < options.count; index++) seeds.push((options.start + index) >>> 0);

  const random = mulberry32(0x51f15eed ^ options.start ^ options.count);
  for (let index = 0; index < options.randomCount; index++) {
    seeds.push(Math.floor(random() * 0xffffffff) >>> 0);
  }

  return [...new Set(seeds)];
}

function chunkIndex(x, y, z, size) {
  return x + size.x * (z + size.z * y);
}

function assertCondition(condition, failures, message) {
  if (!condition) failures.push(message);
}

function getSolidOccupancy(manifest) {
  const solid = new Uint8Array(manifest.size.x * manifest.size.y * manifest.size.z);

  for (const chunk of manifest.chunks) {
    const originX = chunk.coord.x * manifest.chunkSize.x;
    const originY = chunk.coord.y * manifest.chunkSize.y;
    const originZ = chunk.coord.z * manifest.chunkSize.z;

    for (let y = 0; y < chunk.size.y; y++) {
      for (let z = 0; z < chunk.size.z; z++) {
        for (let x = 0; x < chunk.size.x; x++) {
          const block = chunk.blocks[chunkIndex(x, y, z, chunk.size)];
          if (!isCollisionBlock(block)) continue;
          solid[chunkIndex(originX + x, originY + y, originZ + z, manifest.size)] = 1;
        }
      }
    }
  }

  return solid;
}

function countFloatingSolidComponents(manifest, solid = getSolidOccupancy(manifest)) {
  const visited = new Uint8Array(solid.length);
  const queue = [];
  const directions = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  let floating = 0;
  let largestFloating = 0;

  for (let y = 0; y < manifest.size.y; y++) {
    for (let z = 0; z < manifest.size.z; z++) {
      for (let x = 0; x < manifest.size.x; x++) {
        const start = chunkIndex(x, y, z, manifest.size);
        if (!solid[start] || visited[start]) continue;

        visited[start] = 1;
        queue.length = 0;
        queue.push(start);
        let touchesGround = y === 0;
        let count = 0;

        for (let cursor = 0; cursor < queue.length; cursor++) {
          const current = queue[cursor];
          const cx = current % manifest.size.x;
          const cy = Math.floor(current / (manifest.size.x * manifest.size.z));
          const cz = Math.floor((current - cy * manifest.size.x * manifest.size.z) / manifest.size.x);
          count++;
          if (cy === 0) touchesGround = true;

          for (const [dx, dy, dz] of directions) {
            const nx = cx + dx;
            const ny = cy + dy;
            const nz = cz + dz;
            if (nx < 0 || nx >= manifest.size.x || ny < 0 || ny >= manifest.size.y || nz < 0 || nz >= manifest.size.z) {
              continue;
            }
            const next = chunkIndex(nx, ny, nz, manifest.size);
            if (!solid[next] || visited[next]) continue;
            visited[next] = 1;
            queue.push(next);
          }
        }

        if (!touchesGround) {
          floating++;
          largestFloating = Math.max(largestFloating, count);
        }
      }
    }
  }

  return { floating, largestFloating };
}

function getGroundYBelow(manifest, point, solid = getSolidOccupancy(manifest)) {
  const gx = Math.floor((point.x - manifest.origin.x) / manifest.voxelSize.x);
  const gz = Math.floor((point.z - manifest.origin.z) / manifest.voxelSize.z);
  const startY = Math.min(
    manifest.size.y - 1,
    Math.max(0, Math.floor((point.y - PLAYER_HEIGHT / 2 - manifest.origin.y) / manifest.voxelSize.y))
  );

  if (gx < 0 || gx >= manifest.size.x || gz < 0 || gz >= manifest.size.z) return null;

  for (let y = startY; y >= 0; y--) {
    if (solid[chunkIndex(gx, y, gz, manifest.size)]) {
      return manifest.origin.y + (y + 1) * manifest.voxelSize.y;
    }
  }

  return null;
}

function averagePoint(points) {
  return points.reduce(
    (sum, point) => ({
      x: sum.x + point.x / points.length,
      y: sum.y + point.y / points.length,
      z: sum.z + point.z / points.length,
    }),
    { x: 0, y: 0, z: 0 }
  );
}

function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function normalize2D(vector) {
  const length = Math.hypot(vector.x, vector.z);
  if (length < 0.0001) return { x: 0, z: 1 };
  return { x: vector.x / length, z: vector.z / length };
}

function capsuleColumnClear(manifest, solid, point) {
  const radius = PLAYER_RADIUS + Math.max(manifest.voxelSize.x, manifest.voxelSize.z) * 0.6;
  const radiusSq = radius * radius;
  const feetY = point.y - PLAYER_HEIGHT / 2;
  const minX = Math.floor((point.x - radius - manifest.origin.x) / manifest.voxelSize.x);
  const maxX = Math.floor((point.x + radius - manifest.origin.x) / manifest.voxelSize.x);
  const minZ = Math.floor((point.z - radius - manifest.origin.z) / manifest.voxelSize.z);
  const maxZ = Math.floor((point.z + radius - manifest.origin.z) / manifest.voxelSize.z);
  const minY = Math.floor((feetY - manifest.origin.y) / manifest.voxelSize.y);
  const maxY = Math.ceil((feetY + PLAYER_HEIGHT - manifest.origin.y) / manifest.voxelSize.y) - 1;

  for (let y = Math.max(0, minY); y <= Math.min(manifest.size.y - 1, maxY); y++) {
    for (let z = Math.max(0, minZ); z <= Math.min(manifest.size.z - 1, maxZ); z++) {
      const worldZ = manifest.origin.z + (z + 0.5) * manifest.voxelSize.z;
      for (let x = Math.max(0, minX); x <= Math.min(manifest.size.x - 1, maxX); x++) {
        const worldX = manifest.origin.x + (x + 0.5) * manifest.voxelSize.x;
        if ((worldX - point.x) ** 2 + (worldZ - point.z) ** 2 > radiusSq) continue;
        if (solid[chunkIndex(x, y, z, manifest.size)]) return false;
      }
    }
  }

  return true;
}

function capsulePathClear(manifest, solid, start, end) {
  const distance = distance2D(start, end);
  const steps = Math.max(1, Math.ceil(distance / Math.max(0.2, manifest.voxelSize.x)));

  for (let step = 0; step <= steps; step++) {
    const amount = step / steps;
    const point = {
      x: start.x + (end.x - start.x) * amount,
      y: start.y + (end.y - start.y) * amount,
      z: start.z + (end.z - start.z) * amount,
    };

    if (!capsuleColumnClear(manifest, solid, point)) return false;
  }

  return true;
}

function assertSpawnEgress(manifest, solid, failures, seed) {
  for (const team of ['red', 'blue']) {
    const flag = manifest.flagZones[team];
    const spawnCenter = averagePoint(manifest.spawnPoints[team]);

    for (const [index, spawn] of manifest.spawnPoints[team].entries()) {
      const toFlag = normalize2D({ x: flag.x - spawn.x, z: flag.z - spawn.z });
      const corridorDistance = Math.min(
        SPAWN_EGRESS_MAX_DISTANCE,
        Math.max(0, distance2D(spawn, flag) - SPAWN_EGRESS_FLAG_BUFFER)
      );
      const exit = {
        x: spawn.x + toFlag.x * corridorDistance,
        y: spawn.y,
        z: spawn.z + toFlag.z * corridorDistance,
      };

      assertCondition(
        capsuleColumnClear(manifest, solid, spawn),
        failures,
        `seed ${seed}: ${team} spawn ${index} is obstructed at the spawn point`
      );
      assertCondition(
        capsulePathClear(manifest, solid, spawn, exit),
        failures,
        `seed ${seed}: ${team} spawn ${index} has no clear forward egress corridor`
      );
      assertCondition(
        capsulePathClear(manifest, solid, spawn, spawnCenter),
        failures,
        `seed ${seed}: ${team} spawn ${index} cannot reach its spawn cluster center`
      );
    }
  }
}

function summarizeHeightRows(manifest) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;

  for (const row of manifest.heightfield.topSolidRows) {
    if (row === 0) continue;
    min = Math.min(min, row);
    max = Math.max(max, row);
    sum += row;
    count++;
  }

  return { min, max, average: count === 0 ? 0 : sum / count };
}

function auditSeed(seed, options) {
  const { manifest, diagnostics } = generateProceduralVoxelMapWithDiagnostics(seed);
  const failures = [];
  const moduleInstances = manifest.construction?.moduleInstances ?? [];
  const acceptedModules = moduleInstances.filter((instance) => instance.validation?.status === 'accepted');
  const objectRoles = new Set(moduleInstances.flatMap((instance) => instance.roleTags ?? []));
  const objectVariantCount = Object.keys(diagnostics.objectSummary ?? {}).length;
  const biomeSignatureObjects = BIOME_SIGNATURE_OBJECTS[manifest.themeId] ?? [];
  const hasBiomeSignatureObject = biomeSignatureObjects.some((objectKind) => (diagnostics.objectSummary?.[objectKind] ?? 0) > 0);
  const desertTreeCount =
    manifest.themeId === 'desert'
      ? TREE_OBJECTS.reduce((sum, objectKind) => sum + (diagnostics.objectSummary?.[objectKind] ?? 0), 0)
      : 0;
  const solid = getSolidOccupancy(manifest);
  const floating = countFloatingSolidComponents(manifest, solid);
  const heightRows = summarizeHeightRows(manifest);

  assertCondition(manifest.size.x > 0 && manifest.size.y > 0 && manifest.size.z > 0, failures, `seed ${seed}: invalid map size`);
  assertCondition(manifest.chunks.length > 0, failures, `seed ${seed}: no chunks generated`);
  assertCondition(manifest.colliders.length > 0, failures, `seed ${seed}: no colliders generated`);
  assertCondition(manifest.stats.colliderCount <= options.maxColliders, failures, `seed ${seed}: collider count ${manifest.stats.colliderCount} > ${options.maxColliders}`);
  assertCondition(manifest.spawnPoints.red.length >= 4 && manifest.spawnPoints.blue.length >= 4, failures, `seed ${seed}: missing team spawn points`);
  assertCondition(Boolean(manifest.flagZones.red && manifest.flagZones.blue), failures, `seed ${seed}: missing flag zones`);
  assertCondition(moduleInstances.length >= MIN_AUTHORED_OBJECTS, failures, `seed ${seed}: expected denser authored objects, got ${moduleInstances.length}`);
  assertCondition(objectVariantCount >= MIN_OBJECT_VARIANTS, failures, `seed ${seed}: expected more object variety, got ${objectVariantCount} variants`);
  assertCondition(hasBiomeSignatureObject, failures, `seed ${seed}: missing biome-specific collision object for ${manifest.themeId}`);
  assertCondition(desertTreeCount === 0, failures, `seed ${seed}: desert map generated ${desertTreeCount} tree objects instead of cactus/desert props`);
  assertCondition(acceptedModules.length === moduleInstances.length, failures, `seed ${seed}: rejected generated module instances`);
  assertCondition(objectRoles.has('base_shell'), failures, `seed ${seed}: missing base structure`);
  assertCondition(objectRoles.has('spawn_shelter'), failures, `seed ${seed}: missing spawn shelter`);
  assertCondition(objectRoles.has('flag_stand'), failures, `seed ${seed}: missing flag plinth`);
  assertCondition(objectRoles.has('route_cover'), failures, `seed ${seed}: missing route cover`);
  assertCondition(Object.keys(manifest.construction?.diagnostics?.repairActions ?? {}).length === 0, failures, `seed ${seed}: legacy repair actions are still present`);
  assertCondition(floating.floating === 0, failures, `seed ${seed}: ${floating.floating} floating solid components, largest=${floating.largestFloating}`);

  for (const spawn of [...manifest.spawnPoints.red, ...manifest.spawnPoints.blue]) {
    const groundY = getGroundYBelow(manifest, spawn, solid);
    assertCondition(groundY !== null, failures, `seed ${seed}: spawn has no solid ground below`);
    if (groundY !== null) {
      const expectedCenterY = groundY + PLAYER_HEIGHT / 2;
      assertCondition(
        Math.abs(spawn.y - expectedCenterY) <= 0.25,
        failures,
        `seed ${seed}: spawn y ${spawn.y.toFixed(2)} is not aligned to ground ${groundY.toFixed(2)}`
      );
    }
  }
  assertSpawnEgress(manifest, solid, failures, seed);

  return {
    seed,
    failures,
    stats: manifest.stats,
    themeId: manifest.themeId,
    topologyId: manifest.topologyId,
    objectSummary: diagnostics.objectSummary ?? {},
    moduleCount: moduleInstances.length,
    heightRows,
    floating,
  };
}

function formatObjectSummary(summary) {
  return Object.entries(summary)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join(', ');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const seeds = createSeedList(options);
  const results = seeds.map((seed) => auditSeed(seed, options));
  const failures = results.flatMap((result) => result.failures);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          seeds,
          failures,
          results: results.map((result) => ({
            seed: result.seed,
            stats: result.stats,
            themeId: result.themeId,
            topologyId: result.topologyId,
            moduleCount: result.moduleCount,
            objectSummary: result.objectSummary,
            heightRows: result.heightRows,
            floating: result.floating,
          })),
        },
        null,
        2
      )
    );
  } else {
    console.log(`Fresh procedural map smoke: seeds=${seeds.length}`);
    for (const result of results) {
      console.log(
        `seed=${result.seed} theme=${result.themeId} topology=${result.topologyId} chunks=${result.stats.chunkCount} colliders=${result.stats.colliderCount} modules=${result.moduleCount} heightRows=${result.heightRows.min}-${result.heightRows.max} objects=[${formatObjectSummary(result.objectSummary)}]`
      );
    }
  }

  if (failures.length > 0) {
    console.error('\nFailures:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  }
}

main();
