import { VoxelMap } from './procedural';
import type { VoxelMapWarmupStatus } from './procedural/VoxelMap';
import type { VoxelMaterialDetail, WorldPerformanceBudget } from './visualQuality';

interface VoxelWorldProps {
  seed?: number;
  enablePhysics?: boolean;
  shadowsEnabled: boolean;
  dressingShadows: boolean;
  dressingDensity: number;
  reflectionIntensity: number;
  materialDetail: VoxelMaterialDetail;
  performanceBudget: WorldPerformanceBudget;
  prebuildRegions?: boolean;
  onWarmupStatus?: (status: VoxelMapWarmupStatus) => void;
  onReady?: () => void;
}

export function VoxelWorld({
  seed,
  enablePhysics = true,
  shadowsEnabled,
  dressingShadows,
  dressingDensity,
  reflectionIntensity,
  materialDetail,
  performanceBudget,
  prebuildRegions = false,
  onWarmupStatus,
  onReady,
}: VoxelWorldProps) {
  return (
    <group>
      <VoxelMap
        seed={seed}
        enablePhysics={enablePhysics}
        shadowsEnabled={shadowsEnabled}
        dressingShadows={dressingShadows}
        dressingDensity={dressingDensity}
        reflectionIntensity={reflectionIntensity}
        materialDetail={materialDetail}
        performanceBudget={performanceBudget}
        prebuildRegions={prebuildRegions}
        onWarmupStatus={onWarmupStatus}
        onReady={onReady}
      />
    </group>
  );
}
