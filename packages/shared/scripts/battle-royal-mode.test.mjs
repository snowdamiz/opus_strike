#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  BATTLE_ROYAL_GAMEPLAY_MODE,
  BATTLE_ROYAL_TEAM_IDS,
  createGameConfigForGameplayMode,
  createProceduralMapPreview,
  generateProceduralVoxelMap,
  getGameplayModeCapacityCost,
  getGameplayModeRules,
  getTeamCatalogForGameplayMode,
  getTeamIdsForGameplayMode,
} from '../dist/index.js';

function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

const rules = getGameplayModeRules(BATTLE_ROYAL_GAMEPLAY_MODE);
assert.equal(rules.maxPlayers, 30);
assert.equal(rules.minPlayers, 10);
assert.equal(rules.maxTeamSize, 3);
assert.equal(rules.maxTeams, 10);
assert.equal(rules.scoreModel, 'last_team_alive');
assert.equal(rules.respawnPolicy, 'none_after_active_play');
assert.equal(rules.matchEndPolicy, 'last_team_alive');
assert.equal(rules.mapProfileId, 'battle_royal_large');
assert.equal(rules.safeZoneEnabled, true);
assert.equal(rules.flagsEnabled, false);
assert.equal(rules.teamScoresEnabled, false);
assert.equal(rules.botsEnabled, true);
assert.equal(rules.rankedEnabled, false);
assert.equal(getGameplayModeCapacityCost('battle_royal', 10), 38);
assert.equal(getGameplayModeCapacityCost('battle_royal', 30), 113);

assert.deepEqual(createGameConfigForGameplayMode('battle_royal'), {
  gameplayMode: 'battle_royal',
  maxPlayers: 30,
  minPlayers: 10,
  teamSize: 3,
  maxTeams: 10,
  scoreToWin: 0,
  roundTimeSeconds: 1200,
  respawnTimeSeconds: 0,
  spawnProtectionSeconds: 3,
  flagReturnTimeSeconds: 0,
  heroSelectTimeSeconds: 45,
  countdownSeconds: 12,
});

assert.deepEqual(getTeamIdsForGameplayMode('battle_royal'), [...BATTLE_ROYAL_TEAM_IDS]);
const catalog = getTeamCatalogForGameplayMode('battle_royal');
assert.equal(catalog.length, 10);
assert.equal(new Set(catalog.map((team) => team.color)).size, 10);

const preview = createProceduralMapPreview(0x51f15eed, 'large', { profileId: 'battle_royal_large' });
assert.equal(preview.familyId, 'battle_royal_large');
assert.equal(preview.mapSize, 'large');
assert.equal(preview.preview.labelTags.includes('Battle Royal'), true);
assert.equal(Object.keys(preview.preview.thumbnailSilhouette.objectives.spawns).length, 10);

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
assert.equal(manifest.size.x > 300, true);
assert.equal(manifest.size.z > 300, true);
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
  assert.equal(distance2D(spawn.center, { x: 0, z: 0 }) > 45, true);
  spawnCenters.push(spawn.center);
}

let minSpawnSeparation = Infinity;
for (let a = 0; a < spawnCenters.length; a++) {
  for (let b = a + 1; b < spawnCenters.length; b++) {
    minSpawnSeparation = Math.min(minSpawnSeparation, distance2D(spawnCenters[a], spawnCenters[b]));
  }
}
assert.equal(minSpawnSeparation > 20, true);

assert.equal(manifest.gameplay.powerups.length, 17);
assert.equal(manifest.construction.diagnostics.routeChoiceCount, 10);
assert.equal(manifest.construction.diagnostics.spawnVisibilityPairs, 0);
assert.deepEqual(manifest.construction.diagnostics.warnings, []);
assert.equal(manifest.stats.solidBlocks <= manifest.construction.designBrief.performanceBudget.maxSolidBlocks, true);
assert.equal(manifest.stats.colliderCount <= manifest.construction.designBrief.performanceBudget.maxColliders, true);
assert.equal(manifest.stats.renderableChunkCount <= manifest.construction.designBrief.performanceBudget.maxRenderableChunks, true);

console.log('battle royal shared mode tests passed');
