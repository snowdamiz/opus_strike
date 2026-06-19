import { VoxelMap } from './procedural';
import type { MapProfileId, VoxelMapTheme } from '@voxel-strike/shared';
import type { VoxelMapWarmupStatus } from './procedural/VoxelMap';
import type { BattleRoyalVisibilityConfig, MaterialQualityConfig, WorldPerformanceBudget } from './visualQuality';

interface VoxelWorldProps {
  seed?: number;
  themeId?: VoxelMapTheme['id'] | null;
  mapProfileId?: MapProfileId | null;
  enablePhysics?: boolean;
  shadowsEnabled: boolean;
  dressingShadows: boolean;
  dressingDensity: number;
  reflectionIntensity: number;
  materialQuality: MaterialQualityConfig['terrainTextureQuality'];
  performanceBudget: WorldPerformanceBudget;
  battleRoyalVisibility?: BattleRoyalVisibilityConfig;
  prebuildRegions?: boolean;
  onWarmupStatus?: (status: VoxelMapWarmupStatus) => void;
  onReady?: () => void;
}

export function VoxelWorld({
  seed,
  themeId,
  mapProfileId,
  enablePhysics = true,
  shadowsEnabled,
  dressingShadows,
  dressingDensity,
  reflectionIntensity,
  materialQuality,
  performanceBudget,
  battleRoyalVisibility,
  prebuildRegions = false,
  onWarmupStatus,
  onReady,
}: VoxelWorldProps) {
  return (
    <group>
      <VoxelMap
        seed={seed}
        themeId={themeId}
        mapProfileId={mapProfileId}
        enablePhysics={enablePhysics}
        shadowsEnabled={shadowsEnabled}
        dressingShadows={dressingShadows}
        dressingDensity={dressingDensity}
        reflectionIntensity={reflectionIntensity}
        materialQuality={materialQuality}
        performanceBudget={performanceBudget}
        battleRoyalVisibility={battleRoyalVisibility}
        prebuildRegions={prebuildRegions}
        onWarmupStatus={onWarmupStatus}
        onReady={onReady}
      />
    </group>
  );
}
