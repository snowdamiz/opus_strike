/**
 * Team B Base - Natural/Cave Aesthetic
 *
 * The right side of the map featuring cave-like structures, rocky platforms,
 * and cool blue/cyan glowing accents. Contrasts with Team A's tech aesthetic.
 */

import { MAP_CONFIG } from '../config';
import {
  caveMaterial,
  teamBAccent,
  teamBGlow,
} from '../materials';

const { teamBBase: TEAM_B_BASE } = MAP_CONFIG;

/**
 * TeamBBase component renders the natural/cave-themed base area
 * including spawn floor, cave overhang, flag alcove, rock formations,
 * and route connection points.
 */
export function TeamBBase() {
  return (
    <group position={[TEAM_B_BASE.x, 0, TEAM_B_BASE.z]} name="team-b-base">
      {/* =====================================================================
          MAIN SPAWN FLOOR - Rocky irregular surface
          ===================================================================== */}

      {/* Primary floor section - slightly uneven for natural look */}
      <mesh position={[0, -0.1, 0]} material={caveMaterial}>
        <boxGeometry args={[30, 0.2, 40]} />
      </mesh>

      {/* Raised rocky section - adds height variation */}
      <mesh position={[-5, 0.05, 8]} rotation={[0, 0.15, 0]} material={caveMaterial}>
        <boxGeometry args={[12, 0.3, 10]} />
      </mesh>

      {/* Another raised section - opposite side */}
      <mesh position={[3, 0.08, -10]} rotation={[0, -0.1, 0]} material={caveMaterial}>
        <boxGeometry args={[10, 0.26, 8]} />
      </mesh>

      {/* Bioluminescent glow strips embedded in rock */}
      <mesh position={[-8, 0.02, 5]} material={teamBAccent}>
        <boxGeometry args={[0.4, 0.15, 12]} />
      </mesh>
      <mesh position={[6, 0.02, -3]} material={teamBAccent}>
        <boxGeometry args={[0.4, 0.15, 8]} />
      </mesh>
      <mesh position={[0, 0.02, 12]} rotation={[0, Math.PI / 6, 0]} material={teamBAccent}>
        <boxGeometry args={[0.4, 0.15, 10]} />
      </mesh>

      {/* =====================================================================
          CAVE OVERHANG - Provides cover over spawn area
          ===================================================================== */}

      {/* Main overhang rock formation */}
      <mesh position={[10, 6, 0]} rotation={[0, 0, -0.15]} material={caveMaterial}>
        <boxGeometry args={[8, 2, 25]} />
      </mesh>

      {/* Overhang support - angled pillar */}
      <mesh position={[12, 3, 8]} rotation={[0.1, 0, -0.2]} material={caveMaterial}>
        <boxGeometry args={[4, 6, 5]} />
      </mesh>

      {/* Overhang support - other side */}
      <mesh position={[12, 3, -8]} rotation={[-0.1, 0, -0.25]} material={caveMaterial}>
        <boxGeometry args={[4, 6, 5]} />
      </mesh>

      {/* Glowing crystals underneath overhang */}
      <mesh position={[8, 4.5, 3]} rotation={[0.2, 0.3, 0.1]} material={teamBGlow}>
        <boxGeometry args={[0.6, 1.5, 0.6]} />
      </mesh>
      <mesh position={[9, 4.2, -2]} rotation={[-0.15, -0.2, 0.2]} material={teamBGlow}>
        <boxGeometry args={[0.5, 1.2, 0.5]} />
      </mesh>
      <mesh position={[7, 4.8, -5]} rotation={[0.1, 0.1, -0.1]} material={teamBGlow}>
        <boxGeometry args={[0.4, 1.0, 0.4]} />
      </mesh>
      <mesh position={[8, 4.3, 7]} rotation={[-0.1, 0.25, 0.15]} material={teamBGlow}>
        <boxGeometry args={[0.55, 1.3, 0.55]} />
      </mesh>

      {/* =====================================================================
          FLAG ZONE ALCOVE - Recessed protective area
          ===================================================================== */}

      {/* Raised platform for flag */}
      <mesh position={[12, 0.25, 0]} material={caveMaterial}>
        <boxGeometry args={[6, 0.5, 8]} />
      </mesh>

      {/* Back wall of alcove */}
      <mesh position={[14.5, 2, 0]} material={caveMaterial}>
        <boxGeometry args={[1, 4, 10]} />
      </mesh>

      {/* Left wall of alcove */}
      <mesh position={[12, 2, -5]} rotation={[0, 0.1, 0]} material={caveMaterial}>
        <boxGeometry args={[5, 4, 1]} />
      </mesh>

      {/* Right wall of alcove */}
      <mesh position={[12, 2, 5]} rotation={[0, -0.1, 0]} material={caveMaterial}>
        <boxGeometry args={[5, 4, 1]} />
      </mesh>

      {/* Crystal formations marking flag zone */}
      <mesh position={[11, 0.8, -3]} rotation={[0, 0.2, 0.15]} material={teamBGlow}>
        <boxGeometry args={[0.7, 1.6, 0.7]} />
      </mesh>
      <mesh position={[11, 0.9, 3]} rotation={[0, -0.15, -0.1]} material={teamBGlow}>
        <boxGeometry args={[0.65, 1.8, 0.65]} />
      </mesh>
      <mesh position={[13, 0.6, 0]} rotation={[0, 0, 0.08]} material={teamBGlow}>
        <boxGeometry args={[0.5, 1.2, 0.5]} />
      </mesh>

      {/* =====================================================================
          ROCK FORMATIONS - Stalagmites and columns
          ===================================================================== */}

      {/* Large stalagmite - creates sightline interest */}
      <mesh position={[-8, 2, -12]} material={caveMaterial}>
        <boxGeometry args={[3, 4, 3]} />
      </mesh>
      <mesh position={[-8, 4.5, -12]} rotation={[0.05, 0.1, 0.05]} material={caveMaterial}>
        <boxGeometry args={[2, 1.5, 2]} />
      </mesh>
      {/* Crystal cluster at base */}
      <mesh position={[-9, 0.5, -11]} rotation={[0.1, 0.3, 0.2]} material={teamBGlow}>
        <boxGeometry args={[0.5, 1.0, 0.5]} />
      </mesh>
      <mesh position={[-7.5, 0.4, -13]} rotation={[-0.1, -0.2, 0.1]} material={teamBGlow}>
        <boxGeometry args={[0.4, 0.8, 0.4]} />
      </mesh>

      {/* Medium rock column */}
      <mesh position={[-6, 1.5, 15]} material={caveMaterial}>
        <boxGeometry args={[2.5, 3, 2.5]} />
      </mesh>
      <mesh position={[-6, 3.5, 15]} rotation={[0, 0.15, 0.08]} material={caveMaterial}>
        <boxGeometry args={[1.8, 1.2, 1.8]} />
      </mesh>
      {/* Crystal at base */}
      <mesh position={[-5, 0.4, 14]} rotation={[0.15, -0.1, 0.05]} material={teamBGlow}>
        <boxGeometry args={[0.45, 0.9, 0.45]} />
      </mesh>

      {/* Smaller rock formation */}
      <mesh position={[2, 1.25, 18]} rotation={[0, 0.3, 0]} material={caveMaterial}>
        <boxGeometry args={[2, 2.5, 2]} />
      </mesh>
      {/* Small crystal */}
      <mesh position={[3, 0.35, 17]} rotation={[0.2, 0.1, 0.15]} material={teamBGlow}>
        <boxGeometry args={[0.35, 0.7, 0.35]} />
      </mesh>

      {/* =====================================================================
          ROUTE CONNECTION POINTS - Cave mouths facing center
          ===================================================================== */}

      {/* North route marker (top) - irregular cave mouth edges */}
      <mesh position={[-15, 0.5, -16]} rotation={[0, 0.15, 0]} material={caveMaterial}>
        <boxGeometry args={[3, 1, 2]} />
      </mesh>
      <mesh position={[-15, 0.4, -12]} rotation={[0, -0.1, 0]} material={caveMaterial}>
        <boxGeometry args={[2.5, 0.8, 1.5]} />
      </mesh>
      {/* Glow strip marking north route */}
      <mesh position={[-14, 0.05, -14]} material={teamBGlow}>
        <boxGeometry args={[8, 0.1, 0.6]} />
      </mesh>

      {/* Middle route marker (center) */}
      <mesh position={[-15, 0.6, 2]} rotation={[0, 0.08, 0]} material={caveMaterial}>
        <boxGeometry args={[2.5, 1.2, 2]} />
      </mesh>
      <mesh position={[-15, 0.5, -2]} rotation={[0, -0.12, 0]} material={caveMaterial}>
        <boxGeometry args={[2.5, 1, 1.8]} />
      </mesh>
      {/* Glow strip marking middle route */}
      <mesh position={[-14, 0.05, 0]} material={teamBGlow}>
        <boxGeometry args={[10, 0.1, 0.6]} />
      </mesh>

      {/* South route marker (bottom) */}
      <mesh position={[-15, 0.45, 14]} rotation={[0, -0.1, 0]} material={caveMaterial}>
        <boxGeometry args={[2.8, 0.9, 2]} />
      </mesh>
      <mesh position={[-15, 0.55, 18]} rotation={[0, 0.15, 0]} material={caveMaterial}>
        <boxGeometry args={[2.2, 1.1, 1.5]} />
      </mesh>
      {/* Glow strip marking south route */}
      <mesh position={[-14, 0.05, 16]} material={teamBGlow}>
        <boxGeometry args={[8, 0.1, 0.6]} />
      </mesh>
    </group>
  );
}
