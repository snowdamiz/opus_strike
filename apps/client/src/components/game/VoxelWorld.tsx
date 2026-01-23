import { TronMap } from './maps/tron';

// Fallback floor size (invisible, catches players who fall through)
const FALLBACK_FLOOR_SIZE = 500;

export function VoxelWorld() {
  return (
    <group>
      {/* Tron GLB map */}
      <TronMap />

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

