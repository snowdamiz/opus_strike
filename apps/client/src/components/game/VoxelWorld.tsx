import { VoxelMap } from './procedural';
import type { VoxelMapWarmupStatus } from './procedural/VoxelMap';
import type { WorldPerformanceBudget } from './visualQuality';

interface VoxelWorldProps {
  seed?: number;
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
