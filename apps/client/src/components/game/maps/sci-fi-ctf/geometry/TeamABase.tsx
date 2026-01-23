/**
 * Team A Base Geometry - Tech/Platform Aesthetic
 *
 * Elevated platforms with red/orange glowing accents representing
 * the high-tech faction's spawn area and flag zone.
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { MAP_CONFIG } from '../config';
import {
  floorMaterial,
  platformMaterial,
  teamAAccent,
  teamAGlow,
} from '../materials';

const { teamABase, platformHeight } = MAP_CONFIG;

// Base dimensions
const BASE_WIDTH = 30; // X-axis
const BASE_DEPTH = 40; // Z-axis
const FLAG_PLATFORM_RADIUS = 4;
const PILLAR_HEIGHT = 8;
const PILLAR_WIDTH = 0.5;

/**
 * Floating tech element with subtle bobbing animation
 */
function FloatingTechElement({
  position,
  size = 1.5,
  speed = 1,
  offset = 0,
}: {
  position: [number, number, number];
  size?: number;
  speed?: number;
  offset?: number;
}) {
  const groupRef = useRef<Group>(null);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.position.y =
        position[1] + Math.sin(state.clock.elapsedTime * speed + offset) * 0.3;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      <mesh material={teamAGlow}>
        <boxGeometry args={[size, 0.2, size]} />
      </mesh>
    </group>
  );
}

/**
 * Decorative pillar with glow strip
 */
function TechPillar({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Main pillar body */}
      <mesh position={[0, PILLAR_HEIGHT / 2, 0]} material={platformMaterial}>
        <boxGeometry args={[PILLAR_WIDTH, PILLAR_HEIGHT, PILLAR_WIDTH]} />
      </mesh>
      {/* Glow strip on front */}
      <mesh position={[PILLAR_WIDTH / 2 + 0.01, PILLAR_HEIGHT / 2, 0]} material={teamAGlow}>
        <boxGeometry args={[0.1, PILLAR_HEIGHT - 1, 0.3]} />
      </mesh>
    </group>
  );
}

/**
 * Ramp connecting ground to elevated platform
 */
function Ramp({
  position,
  width,
  height,
  depth,
}: {
  position: [number, number, number];
  width: number;
  height: number;
  depth: number;
}) {
  // Ramp angled from ground to platform height
  const angle = Math.atan2(height, depth);

  return (
    <group position={position}>
      <mesh
        position={[0, height / 2, depth / 2]}
        rotation={[angle, 0, 0]}
        material={platformMaterial}
      >
        <boxGeometry args={[width, 0.3, Math.sqrt(height * height + depth * depth)]} />
      </mesh>
    </group>
  );
}

/**
 * Team A Base - Tech/Platform aesthetic with elevated platforms
 *
 * Structure:
 * - Main spawn platform at y=0
 * - Elevated command platform at y=3 (platformHeight)
 * - Flag zone platform at y=1 (raised, distinct)
 * - Decorative pillars at corners
 * - Three route openings facing center (top, middle, bottom)
 */
export function TeamABase() {
  return (
    <group position={[teamABase.x, 0, teamABase.z]}>
      {/* ============= MAIN SPAWN PLATFORM ============= */}
      <mesh position={[0, -0.25, 0]} material={floorMaterial}>
        <boxGeometry args={[BASE_WIDTH, 0.5, BASE_DEPTH]} />
      </mesh>

      {/* Accent trim around main platform edges */}
      {/* Front edge (facing center) */}
      <mesh position={[BASE_WIDTH / 2 - 0.15, 0.01, 0]} material={teamAAccent}>
        <boxGeometry args={[0.3, 0.1, BASE_DEPTH - 1]} />
      </mesh>
      {/* Back edge */}
      <mesh position={[-BASE_WIDTH / 2 + 0.15, 0.01, 0]} material={teamAAccent}>
        <boxGeometry args={[0.3, 0.1, BASE_DEPTH - 1]} />
      </mesh>
      {/* Top edge (north) */}
      <mesh position={[0, 0.01, -BASE_DEPTH / 2 + 0.15]} material={teamAAccent}>
        <boxGeometry args={[BASE_WIDTH - 1, 0.1, 0.3]} />
      </mesh>
      {/* Bottom edge (south) */}
      <mesh position={[0, 0.01, BASE_DEPTH / 2 - 0.15]} material={teamAAccent}>
        <boxGeometry args={[BASE_WIDTH - 1, 0.1, 0.3]} />
      </mesh>

      {/* ============= ELEVATED COMMAND PLATFORM ============= */}
      {/* Position behind spawn area (further from center, negative X) */}
      <mesh position={[-8, platformHeight - 0.25, 0]} material={platformMaterial}>
        <boxGeometry args={[12, 0.5, 15]} />
      </mesh>
      {/* Command platform accent edges */}
      <mesh position={[-8, platformHeight + 0.01, -7]} material={teamAGlow}>
        <boxGeometry args={[12, 0.1, 0.3]} />
      </mesh>
      <mesh position={[-8, platformHeight + 0.01, 7]} material={teamAGlow}>
        <boxGeometry args={[12, 0.1, 0.3]} />
      </mesh>

      {/* Ramp from ground to command platform */}
      <Ramp position={[-2, 0, 0]} width={4} height={platformHeight} depth={6} />

      {/* ============= FLAG ZONE PLATFORM ============= */}
      {/* Hexagonal-approximated platform using box geometry at y=1 */}
      {/* Back-center of base */}
      <mesh position={[-10, 0.5, 0]} material={platformMaterial}>
        <boxGeometry args={[FLAG_PLATFORM_RADIUS * 2, 1, FLAG_PLATFORM_RADIUS * 2]} />
      </mesh>
      {/* Glowing edge ring to mark flag zone */}
      {/* Front */}
      <mesh position={[-10 + FLAG_PLATFORM_RADIUS - 0.15, 1.01, 0]} material={teamAGlow}>
        <boxGeometry args={[0.3, 0.1, FLAG_PLATFORM_RADIUS * 2 - 0.5]} />
      </mesh>
      {/* Back */}
      <mesh position={[-10 - FLAG_PLATFORM_RADIUS + 0.15, 1.01, 0]} material={teamAGlow}>
        <boxGeometry args={[0.3, 0.1, FLAG_PLATFORM_RADIUS * 2 - 0.5]} />
      </mesh>
      {/* Top */}
      <mesh position={[-10, 1.01, -FLAG_PLATFORM_RADIUS + 0.15]} material={teamAGlow}>
        <boxGeometry args={[FLAG_PLATFORM_RADIUS * 2 - 0.5, 0.1, 0.3]} />
      </mesh>
      {/* Bottom */}
      <mesh position={[-10, 1.01, FLAG_PLATFORM_RADIUS - 0.15]} material={teamAGlow}>
        <boxGeometry args={[FLAG_PLATFORM_RADIUS * 2 - 0.5, 0.1, 0.3]} />
      </mesh>

      {/* ============= DECORATIVE PILLARS ============= */}
      {/* Corners of main platform */}
      <TechPillar position={[BASE_WIDTH / 2 - 2, 0, -BASE_DEPTH / 2 + 2]} />
      <TechPillar position={[BASE_WIDTH / 2 - 2, 0, BASE_DEPTH / 2 - 2]} />
      <TechPillar position={[-BASE_WIDTH / 2 + 2, 0, -BASE_DEPTH / 2 + 2]} />
      <TechPillar position={[-BASE_WIDTH / 2 + 2, 0, BASE_DEPTH / 2 - 2]} />

      {/* ============= FLOATING TECH ELEMENTS ============= */}
      <FloatingTechElement position={[5, 5, -10]} speed={0.8} offset={0} />
      <FloatingTechElement position={[5, 6, 10]} speed={1.2} offset={Math.PI / 2} />
      <FloatingTechElement position={[-5, 7, 0]} size={2} speed={0.6} offset={Math.PI} />

      {/* ============= ROUTE CONNECTION MARKERS ============= */}
      {/* Three openings facing center (positive X direction) */}

      {/* Top route (north) - ~8 units wide */}
      <mesh position={[BASE_WIDTH / 2 - 1, 0.02, -12]} material={teamAGlow}>
        <boxGeometry args={[4, 0.05, 8]} />
      </mesh>

      {/* Middle route (center) - ~10 units wide */}
      <mesh position={[BASE_WIDTH / 2 - 1, 0.02, 0]} material={teamAGlow}>
        <boxGeometry args={[4, 0.05, 10]} />
      </mesh>

      {/* Bottom route (south) - ~8 units wide */}
      <mesh position={[BASE_WIDTH / 2 - 1, 0.02, 12]} material={teamAGlow}>
        <boxGeometry args={[4, 0.05, 8]} />
      </mesh>
    </group>
  );
}
