import { VoxelMap } from './procedural';
import type { VoxelMaterialDetail } from './visualQuality';

interface VoxelWorldProps {
  seed?: number;
  enablePhysics?: boolean;
  shadowsEnabled: boolean;
  dressingShadows: boolean;
  dressingDensity: number;
  reflectionIntensity: number;
  materialDetail: VoxelMaterialDetail;
}

export function VoxelWorld({
  seed,
  enablePhysics = true,
  shadowsEnabled,
  dressingShadows,
  dressingDensity,
  reflectionIntensity,
  materialDetail,
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
      />
    </group>
  );
}
