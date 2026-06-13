import { VoxelMap } from './procedural';
import type { VoxelMapTheme } from '@voxel-strike/shared';
import type { VoxelMapWarmupStatus } from './procedural/VoxelMap';
import type { WorldPerformanceBudget } from './visualQuality';

interface VoxelWorldProps {
  seed?: number;
  themeId?: VoxelMapTheme['id'] | null;
  enablePhysics?: boolean;
  shadowsEnabled: boolean;
  dressingShadows: boolean;
  dressingDensity: number;
  reflectionIntensity: number;
  performanceBudget: WorldPerformanceBudget;
  prebuildRegions?: boolean;
  onWarmupStatus?: (status: VoxelMapWarmupStatus) => void;
  onReady?: () => void;
}

export function VoxelWorld({
  seed,
  themeId,
  enablePhysics = true,
  shadowsEnabled,
  dressingShadows,
  dressingDensity,
  reflectionIntensity,
  performanceBudget,
  prebuildRegions = false,
  onWarmupStatus,
  onReady,
}: VoxelWorldProps) {
  return (
    <group>
      <VoxelMap
        seed={seed}
        themeId={themeId}
        enablePhysics={enablePhysics}
        shadowsEnabled={shadowsEnabled}
        dressingShadows={dressingShadows}
        dressingDensity={dressingDensity}
        reflectionIntensity={reflectionIntensity}
        performanceBudget={performanceBudget}
        prebuildRegions={prebuildRegions}
        onWarmupStatus={onWarmupStatus}
        onReady={onReady}
      />
    </group>
  );
}
