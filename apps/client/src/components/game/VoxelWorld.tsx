import { SciFiCTFMap } from './maps/sci-fi-ctf';


// Fallback floor size (invisible, catches players who fall through)
const FALLBACK_FLOOR_SIZE = 500;

export function VoxelWorld() {
  return (
    <group>
      {/* Procedural sci-fi CTF map */}
      <SciFiCTFMap />

      {/* Ground plane as fallback/extension */}
      <Ground />

      {/* Boundaries */}
      <ArenaBoundaries />
    </group>
  );
}

function Ground() {
  // Fallback floor positioned far below the map - invisible death pit catcher
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

function ArenaBoundaries() {
  // Note: These are visual only - physics boundaries are in usePhysics.ts
  // Outer safety boundary - polygon boundary in mapBoundaries.ts handles gameplay
  const boundaryHeight = 100;
  const mapSize = 120;
  
  return (
    <group>
      {/* Invisible boundary walls - visual markers only */}
      <mesh position={[0, boundaryHeight / 2, -mapSize / 2]} visible={false}>
        <boxGeometry args={[mapSize, boundaryHeight, 2]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <mesh position={[0, boundaryHeight / 2, mapSize / 2]} visible={false}>
        <boxGeometry args={[mapSize, boundaryHeight, 2]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <mesh position={[-mapSize / 2, boundaryHeight / 2, 0]} visible={false}>
        <boxGeometry args={[2, boundaryHeight, mapSize]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <mesh position={[mapSize / 2, boundaryHeight / 2, 0]} visible={false}>
        <boxGeometry args={[2, boundaryHeight, mapSize]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

