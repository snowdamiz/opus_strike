/**
 * Routes - Three distinct lane paths connecting team bases
 *
 * Layout (teams on left/right):
 * - North route (z = -30): Elevated long-range corridor
 * - Middle route (z = 0): Ground-level medium-range main street
 * - South route (z = +30): Close-quarters tunnel system
 */

import {
  floorMaterial,
  platformMaterial,
  wallMaterial,
  energyBarrierMaterial,
} from '../materials';
import { MAP_CONFIG } from '../config';

// Route spans from just outside Team A base to just outside Team B base
const ROUTE_START_X = -70; // Leave gap for base geometry
const ROUTE_END_X = 70;
const ROUTE_LENGTH = ROUTE_END_X - ROUTE_START_X;
const ROUTE_CENTER_X = (ROUTE_START_X + ROUTE_END_X) / 2;

// Z positions for each route
const NORTH_Z = -30;
const MIDDLE_Z = 0;
const SOUTH_Z = 30;

/**
 * North Route - Elevated long-range corridor
 * - Open sightlines, exposed position
 * - Railings for partial cover
 * - Glow strip edges
 */
function NorthRoute() {
  const elevationY = MAP_CONFIG.platformHeight; // y=3
  const width = 12;
  const floorThickness = 0.5;

  return (
    <group name="north-route" position={[0, 0, NORTH_Z]}>
      {/* Main elevated platform floor */}
      <mesh
        position={[ROUTE_CENTER_X, elevationY - floorThickness / 2, 0]}
        material={platformMaterial}
      >
        <boxGeometry args={[ROUTE_LENGTH, floorThickness, width]} />
      </mesh>

      {/* Glow strip edges - north side */}
      <mesh
        position={[ROUTE_CENTER_X, elevationY, -width / 2 + 0.15]}
        material={energyBarrierMaterial}
      >
        <boxGeometry args={[ROUTE_LENGTH, 0.1, 0.3]} />
      </mesh>

      {/* Glow strip edges - south side */}
      <mesh
        position={[ROUTE_CENTER_X, elevationY, width / 2 - 0.15]}
        material={energyBarrierMaterial}
      >
        <boxGeometry args={[ROUTE_LENGTH, 0.1, 0.3]} />
      </mesh>

      {/* Low railings for partial cover - north side */}
      <mesh
        position={[ROUTE_CENTER_X, elevationY + 0.25, -width / 2 + 0.25]}
        material={wallMaterial}
      >
        <boxGeometry args={[ROUTE_LENGTH, 0.5, 0.5]} />
      </mesh>

      {/* Low railings for partial cover - south side */}
      <mesh
        position={[ROUTE_CENTER_X, elevationY + 0.25, width / 2 - 0.25]}
        material={wallMaterial}
      >
        <boxGeometry args={[ROUTE_LENGTH, 0.5, 0.5]} />
      </mesh>

      {/* Sparse cover pillars along route - for minimal obstruction */}
      {[-40, 0, 40].map((xOffset) => (
        <mesh
          key={`pillar-${xOffset}`}
          position={[xOffset, elevationY + 1, 0]}
          material={wallMaterial}
        >
          <boxGeometry args={[1, 2, 1]} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Middle Route - Ground-level medium-range main street
 * - Widest and most direct path
 * - Mix of open areas and scattered cover
 */
function MiddleRoute() {
  const width = 15;
  const floorThickness = 0.5;

  return (
    <group name="middle-route" position={[0, 0, MIDDLE_Z]}>
      {/* Main floor */}
      <mesh
        position={[ROUTE_CENTER_X, -floorThickness / 2, 0]}
        material={floorMaterial}
      >
        <boxGeometry args={[ROUTE_LENGTH, floorThickness, width]} />
      </mesh>

      {/* Scattered cover blocks - low walls for medium-range engagement */}
      {/* Team A side covers */}
      <mesh position={[-50, 0.75, -4]} material={wallMaterial}>
        <boxGeometry args={[3, 1.5, 1]} />
      </mesh>
      <mesh position={[-50, 0.75, 4]} material={wallMaterial}>
        <boxGeometry args={[3, 1.5, 1]} />
      </mesh>

      {/* Mid-left covers */}
      <mesh position={[-25, 0.75, -2]} material={wallMaterial}>
        <boxGeometry args={[2, 1.5, 4]} />
      </mesh>
      <mesh position={[-25, 0.75, 5]} material={wallMaterial}>
        <boxGeometry args={[4, 1.5, 2]} />
      </mesh>

      {/* Mid-right covers */}
      <mesh position={[25, 0.75, 2]} material={wallMaterial}>
        <boxGeometry args={[2, 1.5, 4]} />
      </mesh>
      <mesh position={[25, 0.75, -5]} material={wallMaterial}>
        <boxGeometry args={[4, 1.5, 2]} />
      </mesh>

      {/* Team B side covers */}
      <mesh position={[50, 0.75, -4]} material={wallMaterial}>
        <boxGeometry args={[3, 1.5, 1]} />
      </mesh>
      <mesh position={[50, 0.75, 4]} material={wallMaterial}>
        <boxGeometry args={[3, 1.5, 1]} />
      </mesh>
    </group>
  );
}

/**
 * South Route - Close-quarters tunnel system
 * - Narrow corridors with tight turns
 * - Low ceilings in tunnel sections
 * - Glow strips for visibility
 */
function SouthRoute() {
  const width = 8;
  const floorThickness = 0.5;
  const tunnelHeight = 3;
  const tunnelWallThickness = 0.5;

  // Tunnel sections: define start and end X positions
  const tunnelSections = [
    { startX: -60, endX: -35 }, // Team A approach tunnel
    { startX: -10, endX: 10 }, // Center tunnel
    { startX: 35, endX: 60 }, // Team B approach tunnel
  ];

  return (
    <group name="south-route" position={[0, 0, SOUTH_Z]}>
      {/* Main floor spanning entire route */}
      <mesh
        position={[ROUTE_CENTER_X, -floorThickness / 2, 0]}
        material={floorMaterial}
      >
        <boxGeometry args={[ROUTE_LENGTH, floorThickness, width]} />
      </mesh>

      {/* Tunnel sections with walls and ceiling */}
      {tunnelSections.map((section, index) => {
        const sectionLength = section.endX - section.startX;
        const sectionCenterX = (section.startX + section.endX) / 2;

        return (
          <group key={`tunnel-${index}`}>
            {/* North wall */}
            <mesh
              position={[
                sectionCenterX,
                tunnelHeight / 2,
                -width / 2 - tunnelWallThickness / 2,
              ]}
              material={wallMaterial}
            >
              <boxGeometry
                args={[sectionLength, tunnelHeight, tunnelWallThickness]}
              />
            </mesh>

            {/* South wall */}
            <mesh
              position={[
                sectionCenterX,
                tunnelHeight / 2,
                width / 2 + tunnelWallThickness / 2,
              ]}
              material={wallMaterial}
            >
              <boxGeometry
                args={[sectionLength, tunnelHeight, tunnelWallThickness]}
              />
            </mesh>

            {/* Ceiling */}
            <mesh
              position={[sectionCenterX, tunnelHeight, 0]}
              material={wallMaterial}
            >
              <boxGeometry
                args={[sectionLength, tunnelWallThickness, width + 1]}
              />
            </mesh>

            {/* Glow strips on ceiling for visibility */}
            <mesh
              position={[sectionCenterX, tunnelHeight - 0.1, -2]}
              material={energyBarrierMaterial}
            >
              <boxGeometry args={[sectionLength - 1, 0.1, 0.3]} />
            </mesh>
            <mesh
              position={[sectionCenterX, tunnelHeight - 0.1, 2]}
              material={energyBarrierMaterial}
            >
              <boxGeometry args={[sectionLength - 1, 0.1, 0.3]} />
            </mesh>
          </group>
        );
      })}

      {/* Corner obstacles for tight engagement */}
      {/* Open section between Team A tunnel and center */}
      <mesh position={[-22, 1, -2]} material={wallMaterial}>
        <boxGeometry args={[2, 2, 2]} />
      </mesh>
      <mesh position={[-22, 1, 3]} material={wallMaterial}>
        <boxGeometry args={[1.5, 2, 1.5]} />
      </mesh>

      {/* Open section between center and Team B tunnel */}
      <mesh position={[22, 1, 2]} material={wallMaterial}>
        <boxGeometry args={[2, 2, 2]} />
      </mesh>
      <mesh position={[22, 1, -3]} material={wallMaterial}>
        <boxGeometry args={[1.5, 2, 1.5]} />
      </mesh>
    </group>
  );
}

/**
 * Routes - Main export combining all three routes
 */
export function Routes() {
  return (
    <group name="routes">
      <NorthRoute />
      <MiddleRoute />
      <SouthRoute />
    </group>
  );
}
