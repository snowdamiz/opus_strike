#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  BATTLE_ROYAL_GAMEPLAY_MODE,
  BATTLE_ROYAL_MATCH_DURATION_SECONDS,
  BATTLE_ROYAL_TEAM_IDS,
  RANKED_GAMEPLAY_MODE,
  createGameConfigForGameplayMode,
  createProceduralMapPreview,
  createProceduralTerrainLookup,
  generateProceduralVoxelMap,
  getGameplayModeCapacityCost,
  getGameplayModeRules,
  getPartyMaxMembersForMode,
  getTeamCatalogForGameplayMode,
  getTeamIdsForGameplayMode,
  PLAYER_HEIGHT,
  STEP_HEIGHT,
} from '../dist/index.js';

function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function heightfieldRowAt(manifest, point) {
  const { origin, voxelSize, size, topSolidRows } = manifest.heightfield;
  const x = Math.floor((point.x - origin.x) / voxelSize.x);
  const z = Math.floor((point.z - origin.z) / voxelSize.z);
  return topSolidRows[x + z * size.x];
}

function surfaceYAt(manifest, point) {
  return manifest.heightfield.origin.y + heightfieldRowAt(manifest, point) * manifest.heightfield.voxelSize.y;
}

function maxSurfaceY(manifest) {
  let maxRow = 0;
  for (const row of manifest.heightfield.topSolidRows) {
    maxRow = Math.max(maxRow, row);
  }
  return manifest.heightfield.origin.y + maxRow * manifest.heightfield.voxelSize.y;
}

function elevatedRoofCellCount(manifest, node, radius = 2.6, minRowsAboveSurface = 6) {
  const { origin, voxelSize, size, topSolidRows } = manifest.heightfield;
  const centerX = Math.floor((node.position.x - origin.x) / voxelSize.x);
  const centerZ = Math.floor((node.position.z - origin.z) / voxelSize.z);
  const baseRow = Math.floor((node.position.y - origin.y) / voxelSize.y);
  const radiusCells = Math.ceil(radius / Math.min(voxelSize.x, voxelSize.z));
  let count = 0;

  for (let z = centerZ - radiusCells; z <= centerZ + radiusCells; z++) {
    if (z < 0 || z >= size.z) continue;
    for (let x = centerX - radiusCells; x <= centerX + radiusCells; x++) {
      if (x < 0 || x >= size.x) continue;
      const worldX = origin.x + (x + 0.5) * voxelSize.x;
      const worldZ = origin.z + (z + 0.5) * voxelSize.z;
      if (Math.hypot(worldX - node.position.x, worldZ - node.position.z) > radius) continue;
      if (topSolidRows[x + z * size.x] >= baseRow + minRowsAboveSurface) count++;
    }
  }

  return count;
}

function playableHeightRows(manifest, radius, maxMeasuredRow = 68) {
  const rows = [];
  const { origin, voxelSize, size, topSolidRows } = manifest.heightfield;
  for (let z = 0; z < size.z; z++) {
    const worldZ = origin.z + (z + 0.5) * voxelSize.z;
    for (let x = 0; x < size.x; x++) {
      const worldX = origin.x + (x + 0.5) * voxelSize.x;
      if (Math.hypot(worldX, worldZ) > radius) continue;
      const row = topSolidRows[x + z * size.x];
      if (row <= 0 || row >= maxMeasuredRow) continue;
      rows.push(row);
    }
  }
  return rows.sort((a, b) => a - b);
}

function playableSlopeStats(manifest, radius, maxMeasuredRow = 68) {
  const { origin, voxelSize, size, topSolidRows } = manifest.heightfield;
  let checked = 0;
  let maxRowDifference = 0;
  let movementBlockingSteps = 0;
  let steepSteps = 0;
  let cliffSteps = 0;
  const maxStepRows = Math.max(1, Math.ceil(STEP_HEIGHT / voxelSize.y));

  for (let z = 0; z < size.z; z++) {
    const worldZ = origin.z + (z + 0.5) * voxelSize.z;
    for (let x = 0; x < size.x; x++) {
      const worldX = origin.x + (x + 0.5) * voxelSize.x;
      if (Math.hypot(worldX, worldZ) > radius) continue;
      const row = topSolidRows[x + z * size.x];
      if (row <= 0 || row >= maxMeasuredRow) continue;

      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const neighborX = x + dx;
        const neighborZ = z + dz;
        if (neighborX >= size.x || neighborZ >= size.z) continue;

        const neighborWorldX = origin.x + (neighborX + 0.5) * voxelSize.x;
        const neighborWorldZ = origin.z + (neighborZ + 0.5) * voxelSize.z;
        if (Math.hypot(neighborWorldX, neighborWorldZ) > radius) continue;

        const neighborRow = topSolidRows[neighborX + neighborZ * size.x];
        if (neighborRow <= 0 || neighborRow >= maxMeasuredRow) continue;
        const rowDifference = Math.abs(row - neighborRow);
        checked++;
        maxRowDifference = Math.max(maxRowDifference, rowDifference);
        if (rowDifference > maxStepRows) movementBlockingSteps++;
        if (rowDifference > 12) steepSteps++;
        if (rowDifference > 24) cliffSteps++;
      }
    }
  }

  return {
    maxRowDifference,
    movementBlockingStepRatio: movementBlockingSteps / checked,
    steepStepRatio: steepSteps / checked,
    cliffStepRatio: cliffSteps / checked,
  };
}

function terrainTrapStats(manifest, radius, maxMeasuredRow = 68) {
  const { origin, voxelSize, size, topSolidRows } = manifest.heightfield;
  const maxStepRows = Math.max(1, Math.ceil(STEP_HEIGHT / voxelSize.y));
  const minDepthRows = maxStepRows + 2;
  let checked = 0;
  let trapCells = 0;

  for (let z = 0; z < size.z; z++) {
    const worldZ = origin.z + (z + 0.5) * voxelSize.z;
    for (let x = 0; x < size.x; x++) {
      const worldX = origin.x + (x + 0.5) * voxelSize.x;
      if (Math.hypot(worldX, worldZ) > radius) continue;
      const row = topSolidRows[x + z * size.x];
      if (row <= 0 || row >= maxMeasuredRow) continue;

      let neighborCount = 0;
      let highNeighborCount = 0;
      let passableExitCount = 0;
      let shallowestBlockingRow = Infinity;

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const neighborX = x + dx;
          const neighborZ = z + dz;
          if (neighborX < 0 || neighborZ < 0 || neighborX >= size.x || neighborZ >= size.z) continue;

          const neighborWorldX = origin.x + (neighborX + 0.5) * voxelSize.x;
          const neighborWorldZ = origin.z + (neighborZ + 0.5) * voxelSize.z;
          if (Math.hypot(neighborWorldX, neighborWorldZ) > radius) continue;

          neighborCount++;
          const neighborRow = topSolidRows[neighborX + neighborZ * size.x];
          if (neighborRow - row > maxStepRows) {
            highNeighborCount++;
            shallowestBlockingRow = Math.min(shallowestBlockingRow, neighborRow);
          } else {
            passableExitCount++;
          }
        }
      }

      checked++;
      if (
        neighborCount >= 7 &&
        highNeighborCount >= 5 &&
        passableExitCount <= 2 &&
        Number.isFinite(shallowestBlockingRow) &&
        shallowestBlockingRow - row >= minDepthRows
      ) {
        trapCells++;
      }
    }
  }

  return {
    trapCellRatio: checked === 0 ? 0 : trapCells / checked,
    trapCells,
    checked,
  };
}

function percentile(sortedValues, percentileValue) {
  return sortedValues[Math.floor(sortedValues.length * percentileValue)];
}

function boundaryRadiusRange(boundary) {
  const radii = boundary.map((point) => Math.hypot(point.x, point.z));
  return Math.max(...radii) - Math.min(...radii);
}

function assertApproximately(actual, expected, tolerance, message) {
  assert.equal(
    Math.abs(actual - expected) <= tolerance,
    true,
    `${message}: expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

const rules = getGameplayModeRules(BATTLE_ROYAL_GAMEPLAY_MODE);
assert.equal(RANKED_GAMEPLAY_MODE, BATTLE_ROYAL_GAMEPLAY_MODE);
assert.equal(rules.maxPlayers, 27);
assert.equal(rules.minPlayers, 12);
assert.equal(rules.maxTeamSize, 3);
assert.equal(rules.maxTeams, 9);
assert.equal(rules.scoreModel, 'last_team_alive');
assert.equal(rules.roundTimeSeconds, BATTLE_ROYAL_MATCH_DURATION_SECONDS);
assert.equal(rules.respawnPolicy, 'none_after_active_play');
assert.equal(rules.matchEndPolicy, 'last_team_alive');
assert.equal(rules.mapProfileId, 'battle_royal_large');
assert.equal(rules.safeZoneEnabled, true);
assert.equal(rules.flagsEnabled, false);
assert.equal(rules.teamScoresEnabled, false);
assert.equal(rules.botsEnabled, true);
assert.equal(rules.rankedEnabled, true);
assert.equal(getGameplayModeRules('capture_the_flag').rankedEnabled, false);
assert.equal(getGameplayModeRules('team_deathmatch').rankedEnabled, false);
assert.equal(getPartyMaxMembersForMode('ranked', 'capture_the_flag'), 3);
assert.equal(getPartyMaxMembersForMode('ranked', 'team_deathmatch'), 3);
assert.equal(getPartyMaxMembersForMode('ranked', BATTLE_ROYAL_GAMEPLAY_MODE), 3);
assert.equal(getPartyMaxMembersForMode('quick_play', 'capture_the_flag'), 4);
assert.equal(getGameplayModeCapacityCost('battle_royal', 12), 41);
assert.equal(getGameplayModeCapacityCost('battle_royal', 27), 92);

assert.deepEqual(createGameConfigForGameplayMode('battle_royal'), {
  gameplayMode: 'battle_royal',
  maxPlayers: 27,
  minPlayers: 12,
  teamSize: 3,
  maxTeams: 9,
  scoreToWin: 0,
  roundTimeSeconds: BATTLE_ROYAL_MATCH_DURATION_SECONDS,
  respawnTimeSeconds: 0,
  spawnProtectionSeconds: 3,
  flagReturnTimeSeconds: 0,
  heroSelectTimeSeconds: 45,
  countdownSeconds: 12,
});

assert.deepEqual(getTeamIdsForGameplayMode('battle_royal'), [...BATTLE_ROYAL_TEAM_IDS]);
const catalog = getTeamCatalogForGameplayMode('battle_royal');
assert.equal(catalog.length, 9);
assert.equal(new Set(catalog.map((team) => team.color)).size, 9);

const preview = createProceduralMapPreview(0x51f15eed, 'large', { profileId: 'battle_royal_large' });
const mediumPreview = createProceduralMapPreview(0x51f15eed, 'medium', { profileId: 'battle_royal_large' });
const smallPreview = createProceduralMapPreview(0x51f15eed, 'small', { profileId: 'battle_royal_large' });
assert.equal(preview.familyId, 'battle_royal_large');
assert.equal(preview.mapSize, 'large');
assert.equal(mediumPreview.mapSize, 'medium');
assert.equal(smallPreview.mapSize, 'small');
assert.equal(preview.preview.labelTags.includes('Battle Royal'), true);
assert.equal(preview.preview.labelTags.includes('23-27 Players'), true);
assert.equal(mediumPreview.preview.labelTags.includes('17-22 Players'), true);
assert.equal(smallPreview.preview.labelTags.includes('12-16 Players'), true);
assert.equal(preview.preview.labelTags.includes('Expansive'), true);
assert.equal(preview.preview.labelTags.includes('Towns'), true);
assert.equal(preview.preview.labelTags.includes('Open Routes'), true);
assert.equal(Object.keys(preview.preview.thumbnailSilhouette.objectives.spawns).length, BATTLE_ROYAL_TEAM_IDS.length);
assert.equal(Object.keys(mediumPreview.preview.thumbnailSilhouette.objectives.spawns).length, BATTLE_ROYAL_TEAM_IDS.length);
assert.equal(Object.keys(smallPreview.preview.thumbnailSilhouette.objectives.spawns).length, BATTLE_ROYAL_TEAM_IDS.length);
assert.equal(
  smallPreview.preview.thumbnailSilhouette.bounds.maxX < mediumPreview.preview.thumbnailSilhouette.bounds.maxX,
  true
);
assert.equal(
  mediumPreview.preview.thumbnailSilhouette.bounds.maxX < preview.preview.thumbnailSilhouette.bounds.maxX,
  true
);
assertApproximately(smallPreview.preview.thumbnailSilhouette.bounds.maxX, 102.1392, 0.01, 'small BR radius should be toned down');
assertApproximately(mediumPreview.preview.thumbnailSilhouette.bounds.maxX, 121.9996, 0.01, 'medium BR radius should be toned down');
assertApproximately(preview.preview.thumbnailSilhouette.bounds.maxX, 141.86, 0.01, 'large BR radius should be toned down');
assert.equal(preview.preview.thumbnailSilhouette.routes.length >= 30, true);

const manifest = generateProceduralVoxelMap(0x51f15eed, {
  mapSize: 'large',
  profileId: 'battle_royal_large',
});
const manifestAgain = generateProceduralVoxelMap(0x51f15eed, {
  mapSize: 'large',
  profileId: 'battle_royal_large',
});

assert.equal(manifest.profileId, 'battle_royal_large');
assert.equal(manifest.mapSize, 'large');
assert.equal(manifest.gameplay.mode, 'battle_royal');
assert.equal(manifest.construction.designBrief.targetMatchLengthSeconds, BATTLE_ROYAL_MATCH_DURATION_SECONDS);
assert.equal(manifest.size.x >= 610 && manifest.size.x <= 625, true);
assert.equal(manifest.size.y >= 180, true);
assert.equal(manifest.size.z >= 610 && manifest.size.z <= 625, true);
assert.equal(boundaryRadiusRange(manifest.boundary) >= 38, true);
assert.equal(manifest.spawnPoints.red.length, 0);
assert.equal(manifest.spawnPoints.blue.length, 0);
assert.deepEqual(manifestAgain.boundary, manifest.boundary);
assert.equal(manifestAgain.stats.solidBlocks, manifest.stats.solidBlocks);

const spawnCenters = [];
for (const teamId of BATTLE_ROYAL_TEAM_IDS) {
  const spawnPoints = manifest.spawnPoints[teamId];
  assert.equal(spawnPoints.length, 3, `${teamId} should have trio spawn points`);
  const spawn = manifest.gameplay.spawns[teamId];
  assert.equal(Boolean(spawn), true);
  assert.equal(spawn.points.length, 3);
  assert.equal(distance2D(spawn.center, { x: 0, z: 0 }) > 100, true);
  for (const point of spawnPoints) {
    assert.equal(point.y - surfaceYAt(manifest, point) > 1, true, `${teamId} spawn should sit above generated surface`);
  }
  spawnCenters.push(spawn.center);
}

let minSpawnSeparation = Infinity;
for (let a = 0; a < spawnCenters.length; a++) {
  for (let b = a + 1; b < spawnCenters.length; b++) {
    minSpawnSeparation = Math.min(minSpawnSeparation, distance2D(spawnCenters[a], spawnCenters[b]));
  }
}
assert.equal(minSpawnSeparation > preview.preview.thumbnailSilhouette.bounds.maxX * 0.4, true);

const largePlayableRadius = preview.preview.thumbnailSilhouette.bounds.maxX * 0.96;
const playableRows = playableHeightRows(manifest, largePlayableRadius);
const playableSlopes = playableSlopeStats(manifest, largePlayableRadius);
const terrainTraps = terrainTrapStats(manifest, largePlayableRadius);
const terrainLookup = createProceduralTerrainLookup(manifest);
assert.equal(percentile(playableRows, 0.1) >= 10, true);
assert.equal(percentile(playableRows, 0.9) >= 22, true);
assert.equal(percentile(playableRows, 0.98) <= 30, true);
const playableMidSpan = percentile(playableRows, 0.9) - percentile(playableRows, 0.1);
assert.equal(playableMidSpan >= 8, true);
assert.equal(playableMidSpan <= 12, true);
assert.equal(percentile(playableRows, 0.98) - percentile(playableRows, 0.02) <= 18, true);
assert.equal(playableSlopes.maxRowDifference <= 18, true);
assert.equal(playableSlopes.movementBlockingStepRatio <= 0.03, true);
assert.equal(playableSlopes.steepStepRatio <= 0.002, true);
assert.equal(playableSlopes.cliffStepRatio <= 0.00005, true);
assert.equal(
  terrainTraps.trapCellRatio <= 0.001,
  true,
  `expected low terrain trap ratio, got ${terrainTraps.trapCells}/${terrainTraps.checked}`
);
assert.equal(terrainLookup.getMaxPlayableY() >= maxSurfaceY(manifest) + PLAYER_HEIGHT / 2 + 12, true);
const alternateManifest = generateProceduralVoxelMap(0x00000001, {
  mapSize: 'large',
  profileId: 'battle_royal_large',
});
const alternateRows = playableHeightRows(
  alternateManifest,
  alternateManifest.preview.thumbnailSilhouette.bounds.maxX * 0.96
);
const alternateMidSpan = percentile(alternateRows, 0.9) - percentile(alternateRows, 0.1);
const alternateSlopes = playableSlopeStats(
  alternateManifest,
  alternateManifest.preview.thumbnailSilhouette.bounds.maxX * 0.96
);
const alternateTerrainTraps = terrainTrapStats(
  alternateManifest,
  alternateManifest.preview.thumbnailSilhouette.bounds.maxX * 0.96
);
assert.equal(alternateMidSpan >= 8, true);
assert.equal(alternateMidSpan <= 12, true);
assert.equal(percentile(alternateRows, 0.98) - percentile(alternateRows, 0.02) <= 18, true);
assert.equal(alternateSlopes.maxRowDifference <= 18, true);
assert.equal(alternateSlopes.steepStepRatio <= 0.002, true);
assert.equal(alternateSlopes.cliffStepRatio <= 0.00005, true);
assert.equal(
  alternateTerrainTraps.trapCellRatio <= 0.001,
  true,
  `expected low alternate terrain trap ratio, got ${alternateTerrainTraps.trapCells}/${alternateTerrainTraps.checked}`
);
assert.equal(alternateManifest.construction.diagnostics.repairActions.terrainTrapRepairCells >= 0, true);
assert.equal(alternateManifest.construction.diagnostics.spawnVisibilityPairs, 0);
assert.deepEqual(alternateManifest.construction.diagnostics.warnings, []);
const pickupCounts = manifest.gameplay.powerups.reduce((counts, pickup) => {
  counts[pickup.kind] = (counts[pickup.kind] ?? 0) + 1;
  return counts;
}, {});
assert.equal(pickupCounts.health_pack, 42);
assert.equal(pickupCounts.powerup, 24);
assert.equal(manifest.gameplay.powerups.length, 66);
assert.equal(manifest.construction.diagnostics.routeChoiceCount >= 120, true);
assert.equal(manifest.construction.diagnostics.routeChoiceCount <= 165, true);
assert.equal(manifest.construction.diagnostics.moduleCountsByRole.medium_landmark >= 36, true);
assert.equal(manifest.construction.diagnostics.moduleCountsByRole.medium_landmark <= 48, true);
assert.equal(manifest.construction.diagnostics.moduleCountsByRole.district_city_core, 1);
assert.equal(manifest.construction.diagnostics.moduleCountsByRole.district_town, 3);
assert.equal(manifest.construction.diagnostics.moduleCountsByRole.district_industrial, 1);
assert.equal(manifest.construction.diagnostics.moduleCountsByRole.district_hamlet, 2);
assert.equal(manifest.construction.diagnostics.moduleCountsByRole.district_outpost, 3);
assert.equal(manifest.construction.diagnostics.moduleCountsByRole.open_area >= 8, true);
assert.equal(manifest.construction.diagnostics.moduleCountsByRole.road_segment >= 30, true);
assert.equal(manifest.gameplay.namedLocations.length >= 18, true);
assert.equal(new Set(manifest.gameplay.namedLocations.map((location) => location.name)).size, manifest.gameplay.namedLocations.length);
assert.equal(manifest.gameplay.namedLocations.some((location) => location.kind === 'city' && location.priority === 0), true);
assert.equal(manifest.gameplay.namedLocations.filter((location) => location.kind === 'town').length >= 3, true);
for (const location of manifest.gameplay.namedLocations) {
  assert.equal(typeof location.name, 'string');
  assert.equal(location.name.length > 3, true);
  assert.equal(distance2D(location.position, { x: 0, z: 0 }) <= 172, true);
}
const landmarkRoleTags = new Set(
  manifest.gameplay.routeGraph.nodes
    .filter((node) => node.kind === 'landmark')
    .flatMap((node) => node.tags)
);
assert.equal(['highrise', 'compound', 'hangar', 'relay', 'watchtower', 'bunker', 'depot']
  .filter((role) => landmarkRoleTags.has(role)).length >= 5, true);
assert.equal(['city_core', 'town', 'industrial', 'outpost']
  .filter((role) => landmarkRoleTags.has(role)).length >= 4, true);
const roofedBuildingRoles = new Set(['citadel', 'highrise', 'compound', 'hangar', 'relay', 'watchtower', 'bunker', 'depot']);
const roofedBuildingNodes = manifest.gameplay.routeGraph.nodes.filter((node) => (
  node.kind === 'landmark' && node.tags.some((tag) => roofedBuildingRoles.has(tag))
));
assert.equal(roofedBuildingNodes.length >= 36, true);
assert.equal(roofedBuildingNodes.length <= 48, true);
for (const node of roofedBuildingNodes) {
  const role = node.tags.find((tag) => roofedBuildingRoles.has(tag));
  const minRoofRows = role === 'depot' ? 4 : 6;
  const minRoofCells = role === 'depot' ? 18 : 24;
  const roofCells = elevatedRoofCellCount(manifest, node, 2.6, minRoofRows);
  assert.equal(
    roofCells >= minRoofCells,
    true,
    `${node.id} ${role} should have elevated roof coverage, got ${roofCells}`
  );
}
assert.equal(manifest.construction.diagnostics.moduleCountsByRole.cover_cluster >= 120, true);
assert.equal(manifest.construction.diagnostics.moduleCountsByRole.cover_cluster <= 170, true);
assert.deepEqual(manifest.gameplay.lanes.map((lane) => lane.id).sort(), [
  'outer_routes',
  'primary_roads',
  'settlement_loop',
  'settlement_paths',
  'wild_routes',
].sort());
assert.equal(manifest.gameplay.routeGraph.edges.every((edge) => edge.tags.includes('road_segment') || edge.tags.includes('settlement_path')), true);
assert.equal(manifest.construction.diagnostics.scoreBreakdown.settlementStructure > 0, true);
assert.equal(manifest.construction.diagnostics.scoreBreakdown.openAreaStructure > 0, true);
assert.equal(manifest.construction.diagnostics.repairActions.openAreaCoverage > 0.1, true);
assert.equal(manifest.construction.diagnostics.maxSightlineLength <= preview.preview.thumbnailSilhouette.bounds.maxX * 1.76, true);
assert.equal(manifest.construction.diagnostics.spawnVisibilityPairs, 0);
assert.deepEqual(manifest.construction.diagnostics.warnings, []);
assert.equal(manifest.stats.solidBlocks <= manifest.construction.designBrief.performanceBudget.maxSolidBlocks, true);
assert.equal(manifest.stats.colliderCount <= manifest.construction.designBrief.performanceBudget.maxColliders, true);
assert.equal(manifest.stats.renderableChunkCount <= manifest.construction.designBrief.performanceBudget.maxRenderableChunks, true);

console.log('battle royal shared mode tests passed');
