import assert from 'node:assert/strict';
import { BATTLE_ROYAL_VISIBILITY_CONFIG } from '../../components/game/visualQuality';
import { defaultSettings, useSettingsStore, type GraphicsPreset } from '../../store/settingsStore';
import { clearPreparedVoxelMapCache, prepareVoxelMapCpu } from './mapPrepCache';
import {
  getBattleRoyalStartupFullDetailRegions,
  getBattleRoyalStartupRegions,
  getBattleRoyalWarmupFullDetailDistance,
  getCentralBattleRoyalRegions,
} from './mapGeometryWarmup';

const orderedProfiles: GraphicsPreset[] = ['potato', 'competitive', 'balanced', 'cinematic'];

useSettingsStore.getState().resetSettings();
assert.equal(
  getBattleRoyalWarmupFullDetailDistance(),
  BATTLE_ROYAL_VISIBILITY_CONFIG[defaultSettings.graphicsPreset].terrainPrebuildFullDistance
);

for (const profile of orderedProfiles) {
  assert.equal(
    getBattleRoyalWarmupFullDetailDistance({ graphicsPreset: profile }),
    BATTLE_ROYAL_VISIBILITY_CONFIG[profile].terrainPrebuildFullDistance
  );
}

assert.equal(getBattleRoyalWarmupFullDetailDistance({ battleRoyalFullDetailDistance: 42 }), 42);
assert.equal(getBattleRoyalWarmupFullDetailDistance({ battleRoyalFullDetailDistance: -10 }), 0);

clearPreparedVoxelMapCache();
const preparedMap = prepareVoxelMapCpu({
  seed: 20260611,
  mapSize: 'large',
  mapProfileId: 'battle_royal_large',
  source: 'test',
});

let previousCount = 0;
for (const profile of orderedProfiles) {
  const regions = getCentralBattleRoyalRegions(preparedMap, { graphicsPreset: profile });
  assert.ok(regions.length > 0, `${profile} should prebuild some central BR regions`);
  assert.ok(regions.length >= previousCount, `${profile} warmup region count should be monotonic`);
  assert.ok(
    regions.length < preparedMap.renderableRegions.length,
    `${profile} warmup should not prebuild the whole BR map at full detail`
  );
  previousCount = regions.length;
}

const narrowRegions = getCentralBattleRoyalRegions(preparedMap, { battleRoyalFullDetailDistance: 1 });
const balancedRegions = getCentralBattleRoyalRegions(preparedMap, { graphicsPreset: 'balanced' });
assert.ok(narrowRegions.length < balancedRegions.length);

const startupRegions = getBattleRoyalStartupRegions(preparedMap, { graphicsPreset: 'cinematic' });
const startupFullDetailRegions = getBattleRoyalStartupFullDetailRegions(preparedMap, { graphicsPreset: 'cinematic' });
const cinematicCentralRegions = getCentralBattleRoyalRegions(preparedMap, { graphicsPreset: 'cinematic' });
assert.ok(startupRegions.length > 0);
assert.ok(startupFullDetailRegions.length > 0);
assert.ok(startupFullDetailRegions.length <= startupRegions.length);
assert.ok(startupRegions.length < preparedMap.renderableRegions.length);
assert.ok(startupFullDetailRegions.length <= cinematicCentralRegions.length);
assert.ok(startupRegions.length <= 96);

clearPreparedVoxelMapCache();

console.log('map geometry warmup tests passed');
