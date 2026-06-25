import assert from 'node:assert/strict';
import type { SafeZoneSnapshot, VoxelMapManifest } from '@voxel-strike/shared';
import { shouldRenderBattleRoyalSafeZone } from './BattleRoyalSafeZone';
import { getBattleRoyalTerrainLodDistances } from './battleRoyalTerrainLod';
import {
  getBattleRoyalOuterFillY,
  markBattleRoyalMacroTileDetail,
  shouldHideBattleRoyalRegionForMacroTile,
  writeActiveBattleRoyalMacroTileIds,
} from './procedural/VoxelMap';
import {
  BATTLE_ROYAL_VISIBILITY_CONFIG,
  createBattleRoyalFlightVisibilityConfig,
  DEFAULT_CAMERA_FAR,
  getVisualQualityConfig,
  scaleBattleRoyalVisibilityConfig,
} from './visualQuality';

const orderedProfiles = ['potato', 'competitive', 'balanced', 'cinematic'] as const;

let previousCameraFar = 0;
let previousCullDistance = 0;
let previousFullLodDistance = 0;

for (const profile of orderedProfiles) {
  const config = BATTLE_ROYAL_VISIBILITY_CONFIG[profile];
  assert.equal(config.terrainLodEnabled, true, `${profile} runtime config should enable terrain LOD`);
  assert.ok(config.cameraFar < DEFAULT_CAMERA_FAR, `${profile} should reduce BR camera far plane`);
  assert.equal(config.adaptiveVisibilityScale, 1, `${profile} runtime config should start at neutral adaptive scale`);
  assert.ok(config.terrainLodFullDistance < config.terrainLodCoarseDistance, `${profile} should use coarse terrain after full detail`);
  assert.ok(config.terrainLodCoarseDistance < config.terrainLodUltraCoarseDistance, `${profile} should use ultra-coarse terrain after coarse`);
  assert.ok(config.terrainLodUltraCoarseDistance < config.terrainCullDistance, `${profile} should cull after ultra-coarse terrain`);
  assert.ok(config.terrainPrebuildFullDistance >= config.terrainLodFullDistance, `${profile} should prebuild at least the runtime full LOD band`);
  assert.ok(config.terrainPrebuildFullDistance <= config.terrainCullDistance, `${profile} should not prebuild full-detail terrain outside cull range`);
  assert.ok(config.terrainLodUltraCoarseDistance <= config.cameraFar, `${profile} ultra-coarse terrain should fade before camera far plane`);
  assert.ok(config.dressingCullDistance <= config.terrainCullDistance, `${profile} dressing should not outlive terrain visibility`);
  assert.ok(config.remoteMovementEffectDistance <= config.terrainCullDistance, `${profile} remote movement effects should stay inside terrain visibility`);
  assert.ok(config.terrainImpactDistance <= config.terrainCullDistance, `${profile} terrain impacts should stay inside terrain visibility`);
  assert.ok(config.fogDensity > 0, `${profile} fog density should be positive`);

  assert.ok(config.cameraFar >= previousCameraFar, `${profile} camera far should be monotonic by preset`);
  assert.ok(config.terrainCullDistance >= previousCullDistance, `${profile} cull distance should be monotonic by preset`);
  assert.ok(config.terrainLodFullDistance >= previousFullLodDistance, `${profile} full LOD distance should be monotonic by preset`);

  previousCameraFar = config.cameraFar;
  previousCullDistance = config.terrainCullDistance;
  previousFullLodDistance = config.terrainLodFullDistance;
}

const balanced = getVisualQualityConfig({
  resolutionScale: 'medium',
  antialiasing: true,
  shadowQuality: 'medium',
  reflectionQuality: 'medium',
  environmentQuality: 'medium',
  materialQuality: 'medium',
  graphicsPreset: 'balanced',
});

assert.equal(balanced.battleRoyalVisibility, BATTLE_ROYAL_VISIBILITY_CONFIG.balanced);
assert.equal(balanced.effects.maxRemoteMovementEffectDistance, Number.POSITIVE_INFINITY);
assert.equal(balanced.effects.remoteMovementEffectDensityScale, 1);
assert.equal(balanced.effects.remoteMovementEffectBotDistanceScale, 1);
assert.equal(balanced.effects.maxTerrainImpactRenderDistance, Number.POSITIVE_INFINITY);
assert.equal(balanced.remotePlayers.botFullBodyDistanceScale, 1);
assert.equal(balanced.remotePlayers.botOutlineDistanceScale, 1);

assert.equal(shouldHideBattleRoyalRegionForMacroTile({
  active: false,
  macroGeometryReady: true,
  regionVisible: true,
  regionDetail: 'ultraCoarse',
}), false);

assert.equal(shouldHideBattleRoyalRegionForMacroTile({
  active: true,
  macroGeometryReady: false,
  regionVisible: true,
  regionDetail: 'ultraCoarse',
}), false);

assert.equal(shouldHideBattleRoyalRegionForMacroTile({
  active: true,
  macroGeometryReady: true,
  regionVisible: false,
  regionDetail: 'ultraCoarse',
}), false);

assert.equal(shouldHideBattleRoyalRegionForMacroTile({
  active: true,
  macroGeometryReady: true,
  regionVisible: true,
  regionDetail: 'ultraCoarse',
}), true);

assert.equal(shouldHideBattleRoyalRegionForMacroTile({
  active: true,
  macroGeometryReady: true,
  regionVisible: true,
  regionDetail: 'full',
}), false);

const activeMacroTileIds = new Set<string>();
const ultraMacroTileIds = new Set<string>();
const nearMacroTileIds = new Set<string>();
markBattleRoyalMacroTileDetail({
  tileId: 'tile-ultra-only',
  visible: true,
  detail: 'ultraCoarse',
  tilesWithUltraCoarseVisibleRegions: ultraMacroTileIds,
  tilesWithNearVisibleRegions: nearMacroTileIds,
});
markBattleRoyalMacroTileDetail({
  tileId: 'tile-near',
  visible: true,
  detail: 'coarse',
  tilesWithUltraCoarseVisibleRegions: ultraMacroTileIds,
  tilesWithNearVisibleRegions: nearMacroTileIds,
});
markBattleRoyalMacroTileDetail({
  tileId: 'tile-near',
  visible: true,
  detail: 'ultraCoarse',
  tilesWithUltraCoarseVisibleRegions: ultraMacroTileIds,
  tilesWithNearVisibleRegions: nearMacroTileIds,
});
markBattleRoyalMacroTileDetail({
  tileId: 'tile-hidden',
  visible: false,
  detail: 'ultraCoarse',
  tilesWithUltraCoarseVisibleRegions: ultraMacroTileIds,
  tilesWithNearVisibleRegions: nearMacroTileIds,
});
markBattleRoyalMacroTileDetail({
  tileId: undefined,
  visible: true,
  detail: 'ultraCoarse',
  tilesWithUltraCoarseVisibleRegions: ultraMacroTileIds,
  tilesWithNearVisibleRegions: nearMacroTileIds,
});
writeActiveBattleRoyalMacroTileIds(activeMacroTileIds, ultraMacroTileIds, nearMacroTileIds);
assert.deepEqual([...activeMacroTileIds], ['tile-ultra-only']);

markBattleRoyalMacroTileDetail({
  tileId: 'tile-ultra-only',
  visible: true,
  detail: 'full',
  tilesWithUltraCoarseVisibleRegions: ultraMacroTileIds,
  tilesWithNearVisibleRegions: nearMacroTileIds,
});
writeActiveBattleRoyalMacroTileIds(activeMacroTileIds, ultraMacroTileIds, nearMacroTileIds);
assert.equal(activeMacroTileIds.size, 0);

const flightLodManifest = {
  seed: 0x51f15eed,
  origin: { x: -128, y: 0, z: -128 },
  voxelSize: { x: 1, y: 1, z: 1 },
  size: { x: 256, y: 96, z: 256 },
  boundary: [],
} as unknown as VoxelMapManifest;
const balancedFlightLod = getBattleRoyalTerrainLodDistances({
  manifest: flightLodManifest,
  visibility: createBattleRoyalFlightVisibilityConfig(BATTLE_ROYAL_VISIBILITY_CONFIG.balanced),
  cameraPosition: { x: 0, y: 153, z: 0 },
});
const balancedFlightVisibility = createBattleRoyalFlightVisibilityConfig(BATTLE_ROYAL_VISIBILITY_CONFIG.balanced);
assert.equal(balancedFlightVisibility.terrainMacroTileSize, BATTLE_ROYAL_VISIBILITY_CONFIG.balanced.terrainMacroTileSize);
assert.ok(
  balancedFlightVisibility.terrainLodFullDistance >= BATTLE_ROYAL_VISIBILITY_CONFIG.balanced.terrainLodFullDistance * 4,
  'flight full LOD breakpoint should be much farther than runtime'
);
assert.ok(
  balancedFlightVisibility.terrainCullDistance >= BATTLE_ROYAL_VISIBILITY_CONFIG.balanced.terrainCullDistance * 4,
  'flight cull distance should be much farther than runtime'
);
assert.ok(
  balancedFlightVisibility.cameraFar >= balancedFlightVisibility.terrainCullDistance + 90,
  'flight camera far plane should leave headroom after terrain cull'
);
const scaledBalancedFlightVisibility = scaleBattleRoyalVisibilityConfig(balancedFlightVisibility, 0.68);
assert.ok(
  scaledBalancedFlightVisibility.terrainCullDistance >= 500,
  'flight cull distance should still cover high deployment views after adaptive scaling'
);
assert.equal(
  balancedFlightVisibility.fogDensity,
  BATTLE_ROYAL_VISIBILITY_CONFIG.balanced.fogDensity,
  'flight visibility should keep runtime fog density unchanged'
);
assert.equal(
  balancedFlightVisibility.farTerrainFogBlend,
  BATTLE_ROYAL_VISIBILITY_CONFIG.balanced.farTerrainFogBlend,
  'flight visibility should keep runtime far-terrain fog blend unchanged'
);
assert.equal(
  balancedFlightVisibility.dressingCullDistance,
  BATTLE_ROYAL_VISIBILITY_CONFIG.balanced.dressingCullDistance,
  'flight visibility should not change dressing visibility'
);
assert.equal(
  balancedFlightVisibility.gridFadeDistance,
  BATTLE_ROYAL_VISIBILITY_CONFIG.balanced.gridFadeDistance,
  'flight visibility should not change grid fade distance'
);
assert.equal(
  balancedFlightVisibility.remoteMovementEffectDistance,
  BATTLE_ROYAL_VISIBILITY_CONFIG.balanced.remoteMovementEffectDistance,
  'flight visibility should not change remote movement effect visibility'
);
assert.equal(
  balancedFlightVisibility.terrainImpactDistance,
  BATTLE_ROYAL_VISIBILITY_CONFIG.balanced.terrainImpactDistance,
  'flight visibility should not change terrain impact visibility'
);
assert.equal(balancedFlightLod.full, balancedFlightVisibility.terrainLodFullDistance);
assert.equal(getBattleRoyalOuterFillY(flightLodManifest), flightLodManifest.origin.y - 0.08);

const safeZone = {
  enabled: true,
  center: { x: 0, y: 0, z: 0 },
  radius: 180,
  nextCenter: { x: 0, y: 0, z: 0 },
  nextRadius: 120,
  shrinking: false,
  warning: false,
} as SafeZoneSnapshot;
assert.equal(shouldRenderBattleRoyalSafeZone({
  gamePhase: 'countdown',
  gameplayMode: 'battle_royal',
  safeZone,
}), false);
assert.equal(shouldRenderBattleRoyalSafeZone({
  gamePhase: 'deployment',
  gameplayMode: 'battle_royal',
  safeZone,
}), false);
assert.equal(shouldRenderBattleRoyalSafeZone({
  gamePhase: 'playing',
  gameplayMode: 'battle_royal',
  safeZone,
}), true);

console.log('battle royal visibility config tests passed');
