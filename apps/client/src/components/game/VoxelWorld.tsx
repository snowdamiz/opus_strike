import { VoxelMap } from './procedural';
import type { VoxelMaterialDetail } from './visualQuality';

// Fallback floor size (invisible, catches players who fall through)
const FALLBACK_FLOOR_SIZE = 500;

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

      {/* Fallback ground plane far below the map - invisible safety net */}
      <Ground />
    </group>
  );
}

function Ground() {
  // Fallback floor positioned far below the map - invisible death pit catcher
  // Physics collider for this is in usePhysics.ts (y=-50)
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -50, 0]}
    >
      <planeGeometry args={[FALLBACK_FLOOR_SIZE, FALLBACK_FLOOR_SIZE]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}
