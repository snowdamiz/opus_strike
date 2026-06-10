import { VoxelMap } from './procedural';
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
        onReady={onReady}
      />
    </group>
  );
}
