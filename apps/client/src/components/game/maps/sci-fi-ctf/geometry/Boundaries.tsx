/**
 * Boundaries - Perimeter walls enclosing the map
 *
 * Creates tall visual walls around the entire playable area.
 * Physics colliders for these walls are defined separately in MapColliders.
 */

import { MAP_CONFIG } from '../config';
import { wallMaterial, energyBarrierMaterial, platformMaterial } from '../materials';

const { dimensions, wallHeight } = MAP_CONFIG;

// Map bounds: x: -100 to +100, z: -50 to +50
const MAP_HALF_WIDTH = dimensions.width / 2; // 100
const MAP_HALF_DEPTH = dimensions.depth / 2; // 50
const WALL_HEIGHT = wallHeight; // 15
const WALL_THICKNESS = 2;

// Corner pillar dimensions
const PILLAR_SIZE = 4;
const PILLAR_HEIGHT = 18; // Extends above wall height

/**
 * Single perimeter wall segment
 */
function WallSegment({
  position,
  size,
}: {
  position: [number, number, number];
  size: [number, number, number];
}) {
  return (
    <group position={position}>
      {/* Main wall body */}
      <mesh material={wallMaterial}>
        <boxGeometry args={size} />
      </mesh>
      {/* Glow strip at top edge */}
      <mesh
        position={[0, size[1] / 2 - 0.1, 0]}
        material={energyBarrierMaterial}
      >
        <boxGeometry args={[size[0] - 0.2, 0.2, size[2] - 0.2]} />
      </mesh>
    </group>
  );
}

/**
 * Corner pillar with glow accent
 */
function CornerPillar({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Main pillar body */}
      <mesh position={[0, PILLAR_HEIGHT / 2, 0]} material={platformMaterial}>
        <boxGeometry args={[PILLAR_SIZE, PILLAR_HEIGHT, PILLAR_SIZE]} />
      </mesh>
      {/* Glow cap at top */}
      <mesh
        position={[0, PILLAR_HEIGHT - 0.1, 0]}
        material={energyBarrierMaterial}
      >
        <boxGeometry args={[PILLAR_SIZE - 0.5, 0.2, PILLAR_SIZE - 0.5]} />
      </mesh>
      {/* Vertical glow strips on corners */}
      {[
        [PILLAR_SIZE / 2 - 0.05, 0],
        [-PILLAR_SIZE / 2 + 0.05, 0],
        [0, PILLAR_SIZE / 2 - 0.05],
        [0, -PILLAR_SIZE / 2 + 0.05],
      ].map(([xOff, zOff], i) => (
        <mesh
          key={i}
          position={[xOff, PILLAR_HEIGHT / 2, zOff]}
          material={energyBarrierMaterial}
        >
          <boxGeometry args={[xOff !== 0 ? 0.1 : 0.5, PILLAR_HEIGHT - 2, zOff !== 0 ? 0.1 : 0.5]} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Boundaries - Main export
 * Creates four perimeter walls and corner pillars
 */
export function Boundaries() {
  return (
    <group name="boundaries">
      {/* North wall: z = -50, spans x = -100 to +100 */}
      <WallSegment
        position={[0, WALL_HEIGHT / 2, -MAP_HALF_DEPTH]}
        size={[dimensions.width, WALL_HEIGHT, WALL_THICKNESS]}
      />

      {/* South wall: z = +50, spans x = -100 to +100 */}
      <WallSegment
        position={[0, WALL_HEIGHT / 2, MAP_HALF_DEPTH]}
        size={[dimensions.width, WALL_HEIGHT, WALL_THICKNESS]}
      />

      {/* West wall: x = -100, spans z = -50 to +50 (behind Team A) */}
      <WallSegment
        position={[-MAP_HALF_WIDTH, WALL_HEIGHT / 2, 0]}
        size={[WALL_THICKNESS, WALL_HEIGHT, dimensions.depth]}
      />

      {/* East wall: x = +100, spans z = -50 to +50 (behind Team B) */}
      <WallSegment
        position={[MAP_HALF_WIDTH, WALL_HEIGHT / 2, 0]}
        size={[WALL_THICKNESS, WALL_HEIGHT, dimensions.depth]}
      />

      {/* Corner pillars */}
      <CornerPillar position={[-MAP_HALF_WIDTH, 0, -MAP_HALF_DEPTH]} />
      <CornerPillar position={[MAP_HALF_WIDTH, 0, -MAP_HALF_DEPTH]} />
      <CornerPillar position={[-MAP_HALF_WIDTH, 0, MAP_HALF_DEPTH]} />
      <CornerPillar position={[MAP_HALF_WIDTH, 0, MAP_HALF_DEPTH]} />
    </group>
  );
}
