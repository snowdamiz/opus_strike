#!/usr/bin/env node

import { getBlockNumericId, isCollisionBlock, isSolidBlock } from '../dist/maps/procedural/blocks.js';
import { DEFAULT_GAME_CONFIG } from '../dist/constants/game.js';
import { PLAYER_RADIUS } from '../dist/constants/physics.js';
import { generateProceduralVoxelMapWithDiagnostics } from '../dist/maps/procedural/generator.js';

const DEFAULT_SEQUENTIAL_SEEDS = 20;
const DEFAULT_RANDOM_SEEDS = 8;
const DEFAULT_MAX_COLLIDERS = 48_000;
const DEFAULT_MAX_FAILURE_RATE = 0.95;
const DEFAULT_MIN_SIGNATURE_VARIETY = 0.58;
const MAX_NAVIGATION_STEP_ROWS = 2;
const FLAG_DISTANCE_AUDIT_CLEARANCE = 8.7;
const SPAWN_DISTANCE_AUDIT_CLEARANCE = 5;
const SPAWN_DISTANCE_AUDIT_BASE_RADIUS = 4.41;
const SPAWN_DISTANCE_AUDIT_MIN_RADIUS = 3.24;
const SPAWN_DISTANCE_AUDIT_GRID_STEP = 1.75;
const SPAWN_DISTANCE_AUDIT_PAIR_LIMIT = 128;
const SPAWN_POINT_COUNT = DEFAULT_GAME_CONFIG.teamSize;
const SPAWN_DISTANCE_AUDIT_ARC_ANGLES = [-54, -18, 18, 54];

function parseArgs(argv) {
  const options = {
    start: 0,
    count: DEFAULT_SEQUENTIAL_SEEDS,
    randomCount: DEFAULT_RANDOM_SEEDS,
    debugSeed: null,
    maxColliders: DEFAULT_MAX_COLLIDERS,
    maxFailureRate: DEFAULT_MAX_FAILURE_RATE,
    minSignatureVariety: DEFAULT_MIN_SIGNATURE_VARIETY,
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
    } else if (arg === '--max-failure-rate' && next) {
      options.maxFailureRate = Number(next);
      index++;
    } else if (arg === '--min-signature-variety' && next) {
      options.minSignatureVariety = Number(next);
      index++;
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
  if (Number.isFinite(options.debugSeed)) {
    return [options.debugSeed >>> 0];
  }

  const seeds = [];
  for (let index = 0; index < options.count; index++) {
    seeds.push((options.start + index) >>> 0);
  }

  const random = mulberry32(0x51f15eed ^ options.start ^ options.count);
  for (let index = 0; index < options.randomCount; index++) {
    seeds.push(Math.floor(random() * 0xffffffff) >>> 0);
  }

  return [...new Set(seeds)];
}

function countStructureBlocks(manifest) {
  const structureIds = new Set([
    getBlockNumericId('metal'),
    getBlockNumericId('glass'),
    getBlockNumericId('neon_red'),
    getBlockNumericId('neon_blue'),
  ]);
  let count = 0;

  for (const chunk of manifest.chunks) {
    for (const block of chunk.blocks) {
      if (structureIds.has(block)) count++;
    }
  }

  return count;
}

function chunkIndex(x, y, z, size) {
  return x + size.x * (z + size.z * y);
}

function getManifestBlock(manifest, x, y, z) {
  if (x < 0 || x >= manifest.size.x || y < 0 || y >= manifest.size.y || z < 0 || z >= manifest.size.z) return getBlockNumericId('air');

  const chunkSize = manifest.chunkSize;
  const chunkCoord = {
    x: Math.floor(x / chunkSize.x),
    y: Math.floor(y / chunkSize.y),
    z: Math.floor(z / chunkSize.z),
  };
  const chunk = manifest.chunks.find(
    (candidate) =>
      candidate.coord.x === chunkCoord.x &&
      candidate.coord.y === chunkCoord.y &&
      candidate.coord.z === chunkCoord.z
  );

  if (!chunk) return getBlockNumericId('air');

  const localX = x - chunkCoord.x * chunkSize.x;
  const localY = y - chunkCoord.y * chunkSize.y;
  const localZ = z - chunkCoord.z * chunkSize.z;

  return chunk.blocks[chunkIndex(localX, localY, localZ, chunk.size)];
}

function getCollisionTopRows(manifest) {
  const topRows = new Uint16Array(manifest.size.x * manifest.size.z);

  for (const chunk of manifest.chunks) {
    const originX = chunk.coord.x * manifest.chunkSize.x;
    const originY = chunk.coord.y * manifest.chunkSize.y;
    const originZ = chunk.coord.z * manifest.chunkSize.z;

    for (let y = 0; y < chunk.size.y; y++) {
      for (let z = 0; z < chunk.size.z; z++) {
        for (let x = 0; x < chunk.size.x; x++) {
          const block = chunk.blocks[chunkIndex(x, y, z, chunk.size)];
          if (!isCollisionBlock(block)) continue;

          const globalX = originX + x;
          const globalY = originY + y;
          const globalZ = originZ + z;
          const topIndex = globalX + globalZ * manifest.size.x;
          topRows[topIndex] = Math.max(topRows[topIndex], globalY + 1);
        }
      }
    }
  }

  return topRows;
}

function countUnsafeNarrowGrooveColumns(manifest) {
  const topRows = getCollisionTopRows(manifest);
  const counted = new Uint8Array(manifest.size.x * manifest.size.z);
  const maxUnsafeWidthCells = Math.max(
    1,
    Math.ceil((PLAYER_RADIUS * 2) / Math.min(manifest.voxelSize.x, manifest.voxelSize.z)) - 1
  );
  const markRun = (cells) => {
    for (const cell of cells) {
      const worldX = manifest.origin.x + (cell.x + 0.5) * manifest.voxelSize.x;
      const worldZ = manifest.origin.z + (cell.z + 0.5) * manifest.voxelSize.z;
      if (!isInsideBoundaryPolygon(worldX, worldZ, manifest.boundary)) continue;

      counted[cell.x + cell.z * manifest.size.x] = 1;
    }
  };
  const scanAxis = (axis) => {
    const movingLimit = axis === 'x' ? manifest.size.x : manifest.size.z;
    const fixedLimit = axis === 'x' ? manifest.size.z : manifest.size.x;
    const toCell = (moving, fixed) => axis === 'x' ? { x: moving, z: fixed } : { x: fixed, z: moving };
    const getTopRow = (moving, fixed) => {
      const cell = toCell(moving, fixed);
      return topRows[cell.x + cell.z * manifest.size.x];
    };
    const scanDirection = (direction) => {
      for (let fixed = 1; fixed < fixedLimit - 1; fixed++) {
        let moving = direction === 1 ? 1 : movingLimit - 2;

        while (moving > 0 && moving < movingLimit - 1) {
          const openingSideTopRow = getTopRow(moving - direction, fixed);
          const currentTopRow = getTopRow(moving, fixed);

          if (openingSideTopRow === 0 || openingSideTopRow - currentTopRow <= MAX_NAVIGATION_STEP_ROWS) {
            moving += direction;
            continue;
          }

          const cells = [];
          let maxRunTopRow = 0;
          let cursor = moving;

          while (
            cursor > 0 &&
            cursor < movingLimit - 1 &&
            openingSideTopRow - getTopRow(cursor, fixed) > MAX_NAVIGATION_STEP_ROWS
          ) {
            const cell = toCell(cursor, fixed);
            cells.push(cell);
            maxRunTopRow = Math.max(maxRunTopRow, topRows[cell.x + cell.z * manifest.size.x]);
            cursor += direction;
          }

          const closingSideTopRow = getTopRow(cursor, fixed);
          const targetTopRow = Math.min(openingSideTopRow, closingSideTopRow);

          if (
            closingSideTopRow > 0 &&
            cells.length <= maxUnsafeWidthCells &&
            targetTopRow - maxRunTopRow > MAX_NAVIGATION_STEP_ROWS
          ) {
            markRun(cells);
          }

          moving = cursor;
        }
      }
    };

    scanDirection(1);
    scanDirection(-1);
  };

  scanAxis('x');
  scanAxis('z');

  return counted.reduce((count, value) => count + value, 0);
}

function countUnsafeCornerPocketColumns(manifest) {
  const topRows = getCollisionTopRows(manifest);
  const directions = [
    { dx: 1, dz: 0 },
    { dx: -1, dz: 0 },
    { dx: 0, dz: 1 },
    { dx: 0, dz: -1 },
  ];
  let count = 0;

  for (let x = 1; x < manifest.size.x - 1; x++) {
    for (let z = 1; z < manifest.size.z - 1; z++) {
      const worldX = manifest.origin.x + (x + 0.5) * manifest.voxelSize.x;
      const worldZ = manifest.origin.z + (z + 0.5) * manifest.voxelSize.z;
      if (!isInsideBoundaryPolygon(worldX, worldZ, manifest.boundary)) continue;

      const currentTopRow = topRows[x + z * manifest.size.x];
      if (currentTopRow === 0) continue;

      let blockingSides = 0;
      let targetTopRow = Number.POSITIVE_INFINITY;

      for (const direction of directions) {
        const neighborTopRow = topRows[x + direction.dx + (z + direction.dz) * manifest.size.x];

        if (neighborTopRow - currentTopRow > MAX_NAVIGATION_STEP_ROWS) {
          blockingSides++;
          targetTopRow = Math.min(targetTopRow, neighborTopRow);
        }
      }

      if (blockingSides >= 3 && targetTopRow - currentTopRow > MAX_NAVIGATION_STEP_ROWS) {
        count++;
      }
    }
  }

  return count;
}

function worldToGrid(value, origin, voxelSize, max) {
  return Math.max(0, Math.min(max - 1, Math.floor((value - origin) / voxelSize)));
}

function countFlagObstructions(manifest, flag) {
  const radius = 4.3;
  const gx0 = worldToGrid(flag.x - radius, manifest.origin.x, manifest.voxelSize.x, manifest.size.x);
  const gx1 = worldToGrid(flag.x + radius, manifest.origin.x, manifest.voxelSize.x, manifest.size.x);
  const gz0 = worldToGrid(flag.z - radius, manifest.origin.z, manifest.voxelSize.z, manifest.size.z);
  const gz1 = worldToGrid(flag.z + radius, manifest.origin.z, manifest.voxelSize.z, manifest.size.z);
  const flagRow = Math.max(1, Math.floor((flag.y - manifest.origin.y) / manifest.voxelSize.y));
  let obstructions = 0;

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const worldX = manifest.origin.x + (x + 0.5) * manifest.voxelSize.x;
      const worldZ = manifest.origin.z + (z + 0.5) * manifest.voxelSize.z;
      if (Math.hypot(worldX - flag.x, worldZ - flag.z) > radius) continue;

      for (let y = flagRow + 1; y <= Math.min(manifest.size.y - 1, flagRow + 12); y++) {
        if (isSolidBlock(getManifestBlock(manifest, x, y, z))) {
          obstructions++;
        }
      }
    }
  }

  return obstructions;
}

function formatReasonCounts(reasonCounts) {
  return Object.entries(reasonCounts)
    .sort(([, countA], [, countB]) => countB - countA)
    .slice(0, 8)
    .map(([reason, count]) => `${reason}:${count}`)
    .join(', ') || 'none';
}

function isInsideBoundaryPolygon(x, z, polygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const zi = polygon[i].z;
    const xj = polygon[j].x;
    const zj = polygon[j].z;

    if (((zi > z) !== (zj > z)) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

function distanceToSegment(pointX, pointZ, startX, startZ, endX, endZ) {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const lengthSq = dx * dx + dz * dz;

  if (lengthSq <= 0.0001) {
    return Math.hypot(pointX - startX, pointZ - startZ);
  }

  const t = Math.max(0, Math.min(1, ((pointX - startX) * dx + (pointZ - startZ) * dz) / lengthSq));
  return Math.hypot(pointX - (startX + dx * t), pointZ - (startZ + dz * t));
}

function distanceToBoundary(worldX, worldZ, boundary) {
  let closest = Number.POSITIVE_INFINITY;

  for (let index = 0; index < boundary.length; index++) {
    const start = boundary[index];
    const end = boundary[(index + 1) % boundary.length];
    closest = Math.min(closest, distanceToSegment(worldX, worldZ, start.x, start.z, end.x, end.z));
  }

  return closest;
}

function snapHalfStep(value) {
  return Math.round(value * 2) / 2;
}

function dot(a, b) {
  return a.x * b.x + a.z * b.z;
}

function normalize(vector, fallback = { x: 0, z: 1 }) {
  const length = Math.hypot(vector.x, vector.z);
  if (length < 0.0001) return fallback;

  return {
    x: vector.x / length,
    z: vector.z / length,
  };
}

function getSpawnArcAuditCandidate(flag, outward, arcAngle, radius) {
  const tangent = { x: -outward.z, z: outward.x };
  const angle = (arcAngle * Math.PI) / 180;

  return {
    x: snapHalfStep(flag.x + outward.x * Math.cos(angle) * radius + tangent.x * Math.sin(angle) * radius),
    z: snapHalfStep(flag.z + outward.z * Math.cos(angle) * radius + tangent.z * Math.sin(angle) * radius),
  };
}

function isBoundarySafeAuditPoint(x, z, boundary, minBoundaryDistance) {
  return isInsideBoundaryPolygon(x, z, boundary) && distanceToBoundary(x, z, boundary) >= minBoundaryDistance;
}

function canFitSpawnArcAudit(boundary, flag, outward) {
  const spawns = [];

  for (let index = 0; index < SPAWN_DISTANCE_AUDIT_ARC_ANGLES.length; index++) {
    const arcAngle = SPAWN_DISTANCE_AUDIT_ARC_ANGLES[index];

    for (let attempts = 0; attempts < 28; attempts++) {
      const centerBias = Math.abs(arcAngle) < 1 ? 0.27 : 0.63;
      const radius = Math.max(
        SPAWN_DISTANCE_AUDIT_MIN_RADIUS,
        SPAWN_DISTANCE_AUDIT_BASE_RADIUS + centerBias - attempts * 0.108
      );
      const candidate = getSpawnArcAuditCandidate(flag, outward, arcAngle, radius);
      const flagOffset = { x: candidate.x - flag.x, z: candidate.z - flag.z };

      if (dot(flagOffset, outward) < 1.44) continue;
      if (!isBoundarySafeAuditPoint(candidate.x, candidate.z, boundary, SPAWN_DISTANCE_AUDIT_CLEARANCE)) continue;
      if (!spawns.every((spawn) => Math.hypot(spawn.x - candidate.x, spawn.z - candidate.z) >= 2.0)) continue;

      spawns.push(candidate);
      break;
    }
  }

  for (let offset = 0; spawns.length < SPAWN_POINT_COUNT && offset < 18; offset++) {
    const direction = offset % 2 === 0 ? 1 : -1;
    const radius = Math.max(SPAWN_DISTANCE_AUDIT_MIN_RADIUS, SPAWN_DISTANCE_AUDIT_BASE_RADIUS - offset * 0.135);
    const candidate = getSpawnArcAuditCandidate(flag, outward, direction * (28 + offset * 4), radius);
    const flagOffset = { x: candidate.x - flag.x, z: candidate.z - flag.z };

    if (dot(flagOffset, outward) < 1.26) continue;
    if (!isBoundarySafeAuditPoint(candidate.x, candidate.z, boundary, SPAWN_DISTANCE_AUDIT_CLEARANCE)) continue;
    if (!spawns.every((spawn) => Math.hypot(spawn.x - candidate.x, spawn.z - candidate.z) >= 2.1)) continue;

    spawns.push(candidate);
  }

  return spawns.length === SPAWN_POINT_COUNT;
}

function getSpawnSafeFlagCandidateDistance(manifest) {
  const candidates = [];
  const rankedPairs = [];
  const minX = manifest.origin.x + FLAG_DISTANCE_AUDIT_CLEARANCE;
  const maxX = manifest.origin.x + manifest.size.x * manifest.voxelSize.x - FLAG_DISTANCE_AUDIT_CLEARANCE;
  const minZ = manifest.origin.z + FLAG_DISTANCE_AUDIT_CLEARANCE;
  const maxZ = manifest.origin.z + manifest.size.z * manifest.voxelSize.z - FLAG_DISTANCE_AUDIT_CLEARANCE;

  for (let x = minX; x <= maxX; x += SPAWN_DISTANCE_AUDIT_GRID_STEP) {
    for (let z = minZ; z <= maxZ; z += SPAWN_DISTANCE_AUDIT_GRID_STEP) {
      const candidate = { x: snapHalfStep(x), z: snapHalfStep(z) };
      if (!isBoundarySafeAuditPoint(candidate.x, candidate.z, manifest.boundary, FLAG_DISTANCE_AUDIT_CLEARANCE)) continue;

      candidates.push(candidate);
    }
  }

  for (let indexA = 0; indexA < candidates.length; indexA++) {
    for (let indexB = indexA + 1; indexB < candidates.length; indexB++) {
      const a = candidates[indexA];
      const b = candidates[indexB];
      const distanceSq = (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

      if (rankedPairs.length < SPAWN_DISTANCE_AUDIT_PAIR_LIMIT) {
        rankedPairs.push({ a, b, distanceSq });
        rankedPairs.sort((pairA, pairB) => pairB.distanceSq - pairA.distanceSq);
        continue;
      }

      if (distanceSq <= rankedPairs[rankedPairs.length - 1].distanceSq) continue;

      rankedPairs[rankedPairs.length - 1] = { a, b, distanceSq };
      rankedPairs.sort((pairA, pairB) => pairB.distanceSq - pairA.distanceSq);
    }
  }

  for (const pair of rankedPairs) {
    const redOutward = normalize({ x: pair.a.x - pair.b.x, z: pair.a.z - pair.b.z });
    const blueOutward = normalize({ x: pair.b.x - pair.a.x, z: pair.b.z - pair.a.z });

    if (canFitSpawnArcAudit(manifest.boundary, pair.a, redOutward) && canFitSpawnArcAudit(manifest.boundary, pair.b, blueOutward)) {
      return Math.sqrt(pair.distanceSq);
    }
  }

  return rankedPairs.length > 0 ? Math.sqrt(rankedPairs[0].distanceSq) : 0;
}

function getBoundaryShapeStats(manifest) {
  const boundary = manifest.boundary;
  let area = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let insideColumns = 0;
  let outsideColumns = 0;
  let filledOutsideColumns = 0;
  let nearOutsideColumns = 0;
  let filledNearOutsideColumns = 0;
  let farOutsideColumns = 0;
  let filledFarOutsideColumns = 0;

  for (let index = 0; index < boundary.length; index++) {
    const point = boundary[index];
    const next = boundary[(index + 1) % boundary.length];
    area += point.x * next.z - next.x * point.z;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }

  area = Math.abs(area) * 0.5;

  for (let x = 0; x < manifest.heightfield.size.x; x++) {
    for (let z = 0; z < manifest.heightfield.size.z; z++) {
      const worldX = manifest.heightfield.origin.x + (x + 0.5) * manifest.heightfield.voxelSize.x;
      const worldZ = manifest.heightfield.origin.z + (z + 0.5) * manifest.heightfield.voxelSize.z;
      const inside = isInsideBoundaryPolygon(worldX, worldZ, boundary);
      const boundaryDistance = distanceToBoundary(worldX, worldZ, boundary);
      const solid = manifest.heightfield.topSolidRows[x + z * manifest.heightfield.size.x] > 0;

      if (inside) {
        insideColumns++;
      } else {
        outsideColumns++;
        if (solid) filledOutsideColumns++;
        if (boundaryDistance <= 3.0) {
          nearOutsideColumns++;
          if (solid) filledNearOutsideColumns++;
        } else {
          farOutsideColumns++;
          if (solid) filledFarOutsideColumns++;
        }
      }
    }
  }

  const boundingArea = Math.max(1, (maxX - minX) * (maxZ - minZ));

  return {
    boundaryPointCount: boundary.length,
    area,
    boundingArea,
    areaRatio: area / boundingArea,
    insideColumns,
    outsideColumns,
    outsideFilledRatio: outsideColumns === 0 ? 0 : filledOutsideColumns / outsideColumns,
    nearOutsideFilledRatio: nearOutsideColumns === 0 ? 0 : filledNearOutsideColumns / nearOutsideColumns,
    farOutsideFilledRatio: farOutsideColumns === 0 ? 0 : filledFarOutsideColumns / farOutsideColumns,
    signature: `${boundary.length}:${Math.round((area / boundingArea) * 100)}:${Math.round((maxX - minX) / Math.max(1, maxZ - minZ) * 10)}`,
  };
}

function getGameplayBoundaryStats(manifest) {
  const spawns = [...manifest.spawnPoints.red, ...manifest.spawnPoints.blue];
  const flags = [manifest.flagZones.red, manifest.flagZones.blue];
  const spawnDistances = spawns.map((spawn) => distanceToBoundary(spawn.x, spawn.z, manifest.boundary));
  const flagDistances = flags.map((flag) => distanceToBoundary(flag.x, flag.z, manifest.boundary));
  const allGameplayPoints = [...spawns, ...flags];

  return {
    allInsideBoundary: allGameplayPoints.every((point) => isInsideBoundaryPolygon(point.x, point.z, manifest.boundary)),
    minSpawnBoundaryDistance: Math.min(...spawnDistances),
    minFlagBoundaryDistance: Math.min(...flagDistances),
  };
}

function averagePoint(points) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
  };
}

function getSpawnArcStats(manifest) {
  const getTeamStats = (spawns, flag, opponentFlag) => {
    const outward = normalize({
      x: flag.x - opponentFlag.x,
      z: flag.z - opponentFlag.z,
    });
    const distances = spawns.map((spawn) => Math.hypot(spawn.x - flag.x, spawn.z - flag.z));
    const outwardDistances = spawns.map((spawn) => dot({ x: spawn.x - flag.x, z: spawn.z - flag.z }, outward));
    let minPairDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < spawns.length; i++) {
      for (let j = i + 1; j < spawns.length; j++) {
        minPairDistance = Math.min(minPairDistance, Math.hypot(spawns[i].x - spawns[j].x, spawns[i].z - spawns[j].z));
      }
    }

    return {
      minDistanceToFlag: Math.min(...distances),
      maxDistanceToFlag: Math.max(...distances),
      minOutwardDistance: Math.min(...outwardDistances),
      minPairDistance,
    };
  };
  const redCenter = averagePoint(manifest.spawnPoints.red);
  const blueCenter = averagePoint(manifest.spawnPoints.blue);
  const red = getTeamStats(manifest.spawnPoints.red, manifest.flagZones.red, manifest.flagZones.blue);
  const blue = getTeamStats(manifest.spawnPoints.blue, manifest.flagZones.blue, manifest.flagZones.red);
  const flagDistance = Math.hypot(
    manifest.flagZones.red.x - manifest.flagZones.blue.x,
    manifest.flagZones.red.z - manifest.flagZones.blue.z
  );

  return {
    red,
    blue,
    flagDistance,
    bestSpawnSafeFlagDistance: getSpawnSafeFlagCandidateDistance(manifest),
    teamCenterDistance: Math.hypot(redCenter.x - blueCenter.x, redCenter.z - blueCenter.z),
    mapLongAxis: Math.max(manifest.size.x * manifest.voxelSize.x, manifest.size.z * manifest.voxelSize.z),
  };
}

function assertCondition(condition, failures, message) {
  if (!condition) failures.push(message);
}

function inspectMap(seed, options) {
  const { manifest, diagnostics } = generateProceduralVoxelMapWithDiagnostics(seed);
  const failures = [];
  const structureBlocks = countStructureBlocks(manifest);
  const shapeStats = getBoundaryShapeStats(manifest);
  const gameplayBoundaryStats = getGameplayBoundaryStats(manifest);
  const spawnArcStats = getSpawnArcStats(manifest);
  const flagObstructions = countFlagObstructions(manifest, manifest.flagZones.red) + countFlagObstructions(manifest, manifest.flagZones.blue);
  const unsafeGrooveColumns = countUnsafeNarrowGrooveColumns(manifest);
  const unsafeCornerPocketColumns = countUnsafeCornerPocketColumns(manifest);
  const acceptedBuildings = diagnostics.buildings.acceptedPlans;
  const mediumEntranceFailures = acceptedBuildings.filter(
    (entry) => entry.metrics.footprintCellCount >= 90 && entry.metrics.entranceCount < 2
  );
  const entranceClearanceFailures = acceptedBuildings.filter(
    (entry) => entry.metrics.minEntranceHeightRows < 12 || entry.metrics.minEntranceWidthCells < 6
  );
  const flatLargeBuildings = acceptedBuildings.filter(
    (entry) => entry.metrics.footprintCellCount >= 140 && entry.intent !== 'bridge_outpost' && entry.metrics.variedRoofCellCount <= 0
  );
  const protectedFailures = acceptedBuildings.filter((entry) => entry.metrics.minProtectedZoneDistance < 0);
  const heightFailures = acceptedBuildings.filter((entry) => entry.metrics.maxFloorRow + entry.metrics.maxHeightRows >= manifest.size.y - 2);

  assertCondition(manifest.spawnPoints.red.length === SPAWN_POINT_COUNT, failures, `seed ${seed}: expected ${SPAWN_POINT_COUNT} red spawns`);
  assertCondition(manifest.spawnPoints.blue.length === SPAWN_POINT_COUNT, failures, `seed ${seed}: expected ${SPAWN_POINT_COUNT} blue spawns`);
  assertCondition(Boolean(manifest.flagZones.red && manifest.flagZones.blue), failures, `seed ${seed}: missing flag zones`);
  assertCondition(manifest.stats.colliderCount > 0, failures, `seed ${seed}: no colliders generated`);
  assertCondition(manifest.stats.colliderCount <= options.maxColliders, failures, `seed ${seed}: collider count ${manifest.stats.colliderCount} > ${options.maxColliders}`);
  assertCondition(shapeStats.boundaryPointCount >= 13 && shapeStats.boundaryPointCount <= 16, failures, `seed ${seed}: boundary point count ${shapeStats.boundaryPointCount} is outside the moderated range`);
  assertCondition(shapeStats.areaRatio > 0.45 && shapeStats.areaRatio < 0.94, failures, `seed ${seed}: boundary area ratio ${shapeStats.areaRatio.toFixed(2)} is too extreme`);
  assertCondition(manifest.size.x * manifest.voxelSize.x >= 66 && manifest.size.z * manifest.voxelSize.z >= 54.5, failures, `seed ${seed}: map footprint is too small`);
  assertCondition(shapeStats.outsideFilledRatio < 0.65, failures, `seed ${seed}: ${shapeStats.outsideFilledRatio.toFixed(2)} outside-boundary columns are still filled`);
  assertCondition(shapeStats.farOutsideFilledRatio < 0.025, failures, `seed ${seed}: ${shapeStats.farOutsideFilledRatio.toFixed(2)} far outside-boundary columns are filled`);
  assertCondition(shapeStats.nearOutsideFilledRatio > 0.4, failures, `seed ${seed}: boundary wall shell is too sparse`);
  assertCondition(shapeStats.insideColumns > 1600, failures, `seed ${seed}: generated boundary has too little playable terrain`);
  assertCondition(gameplayBoundaryStats.allInsideBoundary, failures, `seed ${seed}: gameplay point outside movement boundary`);
  assertCondition(gameplayBoundaryStats.minSpawnBoundaryDistance >= 5.0, failures, `seed ${seed}: spawn boundary clearance ${gameplayBoundaryStats.minSpawnBoundaryDistance.toFixed(2)} is too low`);
  assertCondition(gameplayBoundaryStats.minFlagBoundaryDistance >= 4.8, failures, `seed ${seed}: flag boundary clearance ${gameplayBoundaryStats.minFlagBoundaryDistance.toFixed(2)} is too low`);
  assertCondition(spawnArcStats.red.minDistanceToFlag >= 2.8 && spawnArcStats.blue.minDistanceToFlag >= 2.8, failures, `seed ${seed}: spawn arc is too close to a flag`);
  assertCondition(spawnArcStats.red.maxDistanceToFlag <= 6.6 && spawnArcStats.blue.maxDistanceToFlag <= 6.6, failures, `seed ${seed}: spawn arc is too far from a flag`);
  assertCondition(spawnArcStats.red.minOutwardDistance >= 1.2 && spawnArcStats.blue.minOutwardDistance >= 1.2, failures, `seed ${seed}: spawn arc is not behind the flag`);
  assertCondition(spawnArcStats.red.minPairDistance >= 1.8 && spawnArcStats.blue.minPairDistance >= 1.8, failures, `seed ${seed}: same-team spawns are too clustered`);
  assertCondition(spawnArcStats.flagDistance >= spawnArcStats.bestSpawnSafeFlagDistance * 0.96, failures, `seed ${seed}: flag distance ${spawnArcStats.flagDistance.toFixed(2)} left too much safe separation unused (${spawnArcStats.bestSpawnSafeFlagDistance.toFixed(2)} possible)`);
  assertCondition(spawnArcStats.teamCenterDistance >= spawnArcStats.mapLongAxis * 0.68, failures, `seed ${seed}: team spawn centers are not far enough apart`);
  assertCondition(flagObstructions === 0, failures, `seed ${seed}: ${flagObstructions} solid blocks obstruct flag zones`);
  assertCondition(unsafeGrooveColumns === 0, failures, `seed ${seed}: ${unsafeGrooveColumns} unsafe narrow groove columns remain`);
  assertCondition(unsafeCornerPocketColumns === 0, failures, `seed ${seed}: ${unsafeCornerPocketColumns} unsafe corner pocket columns remain`);
  assertCondition(structureBlocks > 0, failures, `seed ${seed}: no structure blocks generated`);
  assertCondition(structureBlocks < 11_000, failures, `seed ${seed}: structure block count ${structureBlocks} is too cluttered`);
  assertCondition(diagnostics.buildings.attempted > 0, failures, `seed ${seed}: no building plans attempted`);
  assertCondition(diagnostics.buildings.accepted > 0, failures, `seed ${seed}: no building plans accepted`);
  assertCondition(mediumEntranceFailures.length === 0, failures, `seed ${seed}: medium/large building with fewer than 2 entrances`);
  assertCondition(entranceClearanceFailures.length === 0, failures, `seed ${seed}: accepted building with too-narrow or too-short entrance`);
  assertCondition(flatLargeBuildings.length === 0, failures, `seed ${seed}: large accepted building without roofline variation`);
  assertCondition(protectedFailures.length === 0, failures, `seed ${seed}: building overlapped protected spawn/flag area`);
  assertCondition(heightFailures.length === 0, failures, `seed ${seed}: building exceeded map height bounds`);

  return {
    seed,
    manifest,
    diagnostics,
    shapeStats,
    structureBlocks,
    failures,
  };
}

function printDebug(results) {
  for (const result of results) {
    const { diagnostics } = result;
    console.log(`\nDebug seed ${result.seed}`);
    console.log(`theme=${result.manifest.theme.id} colliders=${result.manifest.stats.colliderCount} structureBlocks=${result.structureBlocks}`);
    console.log(`shapePoints=${result.shapeStats.boundaryPointCount} areaRatio=${result.shapeStats.areaRatio.toFixed(2)} outsideFilled=${result.shapeStats.outsideFilledRatio.toFixed(3)} farOutsideFilled=${result.shapeStats.farOutsideFilledRatio.toFixed(3)}`);
    console.log(`buildingAttempts=${diagnostics.buildings.attempted} accepted=${diagnostics.buildings.accepted} rejected=${diagnostics.buildings.rejected}`);
    console.log(`rejectionReasons=${formatReasonCounts(diagnostics.buildings.rejectionReasons)}`);
    console.log('acceptedPlans=');

    for (const entry of diagnostics.buildings.acceptedPlans) {
      console.log(
        `  ${entry.intent} ${entry.signature} center=(${entry.center.x.toFixed(2)},${entry.center.z.toFixed(2)}) ` +
          `entrances=${entry.metrics.entranceCount} cells=${entry.metrics.footprintCellCount} maxH=${entry.metrics.maxHeightRows}`
      );
    }

    if (diagnostics.buildings.rejectedPlans.length > 0) {
      console.log('sampleRejectedPlans=');
      for (const entry of diagnostics.buildings.rejectedPlans.slice(0, 12)) {
        console.log(`  ${entry.intent} reasons=${entry.reasons.join('|') || 'unknown'} ${entry.signature}`);
      }
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const seeds = createSeedList(options);
  const results = [];
  const failures = [];
  const themes = new Set();
  const shapeSignatures = new Set();
  const signatures = [];
  let totalAttempts = 0;
  let totalAccepted = 0;
  let totalRejected = 0;
  let totalStructureBlocks = 0;
  let maxColliderCount = 0;

  for (const seed of seeds) {
    const result = inspectMap(seed, options);
    results.push(result);
    failures.push(...result.failures);
    themes.add(result.manifest.theme.id);
    shapeSignatures.add(result.shapeStats.signature);
    totalAttempts += result.diagnostics.buildings.attempted;
    totalAccepted += result.diagnostics.buildings.accepted;
    totalRejected += result.diagnostics.buildings.rejected;
    totalStructureBlocks += result.structureBlocks;
    maxColliderCount = Math.max(maxColliderCount, result.manifest.stats.colliderCount);
    signatures.push(...result.diagnostics.buildings.acceptedPlans.map((entry) => entry.signature));
  }

  const failureRate = totalAttempts === 0 ? 1 : totalRejected / totalAttempts;
  const uniqueSignatureCount = new Set(signatures).size;
  const signatureVariety = signatures.length === 0 ? 0 : uniqueSignatureCount / signatures.length;
  const distinctThemeTarget = Math.min(3, seeds.length);

  if (seeds.length > 1) {
    assertCondition(failureRate <= options.maxFailureRate, failures, `building validation failure rate ${failureRate.toFixed(2)} > ${options.maxFailureRate}`);
  }
  assertCondition(themes.size >= distinctThemeTarget, failures, `theme distribution too narrow: ${themes.size}/${distinctThemeTarget}`);
  assertCondition(signatureVariety >= options.minSignatureVariety, failures, `building signature variety ${signatureVariety.toFixed(2)} < ${options.minSignatureVariety}`);
  assertCondition(shapeSignatures.size >= Math.min(6, seeds.length), failures, `map shape variety too narrow: ${shapeSignatures.size}/${Math.min(6, seeds.length)}`);

  console.log(`Procedural building smoke: seeds=${seeds.length}`);
  console.log(`maps=${results.length} themes=${[...themes].join(',')} maxColliders=${maxColliderCount}`);
  console.log(`shapeSignatures=${shapeSignatures.size} samples=${[...shapeSignatures].slice(0, 6).join(',')}`);
  console.log(`buildingAttempts=${totalAttempts} accepted=${totalAccepted} rejected=${totalRejected} failureRate=${failureRate.toFixed(2)}`);
  console.log(`signatureVariety=${signatureVariety.toFixed(2)} uniqueSignatures=${uniqueSignatureCount}/${signatures.length}`);
  console.log(`structureBlocks=${totalStructureBlocks}`);
  console.log(`topRejectionReasons=${formatReasonCounts(results.reduce((counts, result) => {
    for (const [reason, count] of Object.entries(result.diagnostics.buildings.rejectionReasons)) {
      counts[reason] = (counts[reason] ?? 0) + count;
    }
    return counts;
  }, {}))}`);

  if (Number.isFinite(options.debugSeed)) {
    printDebug(results);
  }

  if (failures.length > 0) {
    console.error('\nFailures:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
  }
}

main();
