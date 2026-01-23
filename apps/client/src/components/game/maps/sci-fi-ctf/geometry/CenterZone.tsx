/**
 * CenterZone - Central map hub with interconnects and hazards
 *
 * Features:
 * - Central octagonal hub where all routes converge (x=0, z=0)
 * - Route interconnection passages for flanking between lanes
 * - Hazard zones (void pits) with glowing warning edges
 * - Elevation ramps connecting ground to north elevated route
 */

import {
  floorMaterial,
  wallMaterial,
  hazardMaterial,
  energyBarrierMaterial,
} from '../materials';
import { MAP_CONFIG } from '../config';

// Z positions for routes (must match Routes.tsx)
const NORTH_Z = -30;
const MIDDLE_Z = 0;
const SOUTH_Z = 30;

// Connector positions (left and right of center)
const CONNECTOR_LEFT_X = -20;
const CONNECTOR_RIGHT_X = 20;

/**
 * CentralHub - Octagonal crossroads platform at map center
 */
function CentralHub() {
  const hubRadius = 12.5; // ~25 units diameter
  const floorThickness = 0.5;

  return (
    <group name="central-hub" position={[0, 0, 0]}>
      {/* Main hub floor - octagonal approximated with cylinder */}
      <mesh
        position={[0, -floorThickness / 2, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={floorMaterial}
      >
        <cylinderGeometry args={[hubRadius, hubRadius, floorThickness, 8]} />
      </mesh>

      {/* Energy barrier accent ring */}
      <mesh
        position={[0, 0.01, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={energyBarrierMaterial}
      >
        <torusGeometry args={[hubRadius - 1, 0.2, 4, 8]} />
      </mesh>

      {/* Inner accent ring */}
      <mesh
        position={[0, 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={energyBarrierMaterial}
      >
        <torusGeometry args={[hubRadius / 2, 0.15, 4, 8]} />
      </mesh>
    </group>
  );
}

/**
 * RouteConnectors - Passages between routes for flanking
 * Connects North-Middle and Middle-South at x=-20 and x=+20
 */
function RouteConnectors() {
  const connectorWidth = 6;
  const floorThickness = 0.5;

  // Distance between routes
  const northToMiddle = Math.abs(NORTH_Z - MIDDLE_Z); // 30 units
  const middleToSouth = Math.abs(SOUTH_Z - MIDDLE_Z); // 30 units

  return (
    <group name="route-connectors">
      {/* North-to-Middle connectors */}
      {[CONNECTOR_LEFT_X, CONNECTOR_RIGHT_X].map((xPos) => (
        <group key={`n-m-${xPos}`} position={[xPos, 0, NORTH_Z / 2]}>
          {/* Floor */}
          <mesh
            position={[0, -floorThickness / 2, 0]}
            material={floorMaterial}
          >
            <boxGeometry
              args={[connectorWidth, floorThickness, northToMiddle]}
            />
          </mesh>

          {/* Side walls for corridor feel */}
          <mesh
            position={[-connectorWidth / 2 - 0.25, 1, 0]}
            material={wallMaterial}
          >
            <boxGeometry args={[0.5, 2, northToMiddle - 2]} />
          </mesh>
          <mesh
            position={[connectorWidth / 2 + 0.25, 1, 0]}
            material={wallMaterial}
          >
            <boxGeometry args={[0.5, 2, northToMiddle - 2]} />
          </mesh>
        </group>
      ))}

      {/* Middle-to-South connectors */}
      {[CONNECTOR_LEFT_X, CONNECTOR_RIGHT_X].map((xPos) => (
        <group key={`m-s-${xPos}`} position={[xPos, 0, SOUTH_Z / 2]}>
          {/* Floor */}
          <mesh
            position={[0, -floorThickness / 2, 0]}
            material={floorMaterial}
          >
            <boxGeometry
              args={[connectorWidth, floorThickness, middleToSouth]}
            />
          </mesh>

          {/* Side walls for corridor feel */}
          <mesh
            position={[-connectorWidth / 2 - 0.25, 1, 0]}
            material={wallMaterial}
          >
            <boxGeometry args={[0.5, 2, middleToSouth - 2]} />
          </mesh>
          <mesh
            position={[connectorWidth / 2 + 0.25, 1, 0]}
            material={wallMaterial}
          >
            <boxGeometry args={[0.5, 2, middleToSouth - 2]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * HazardZones - Void pits with glowing warning edges
 * Visual-only in this phase; physics integration in Phase 5
 */
function HazardZones() {
  const pitWidth = 10;
  const pitDepth = 8;
  const edgeThickness = 0.3;
  const edgeHeight = 0.2;

  // Pit positions flanking the central hub
  const pitPositions: [number, number][] = [
    [0, -15], // North pit
    [0, 15], // South pit
  ];

  return (
    <group name="hazard-zones">
      {pitPositions.map(([x, z], index) => (
        <group key={`pit-${index}`} position={[x, 0, z]}>
          {/* Glowing warning edge - north side */}
          <mesh
            position={[0, edgeHeight / 2, -pitDepth / 2 - edgeThickness / 2]}
            material={hazardMaterial}
          >
            <boxGeometry args={[pitWidth + edgeThickness * 2, edgeHeight, edgeThickness]} />
          </mesh>

          {/* Glowing warning edge - south side */}
          <mesh
            position={[0, edgeHeight / 2, pitDepth / 2 + edgeThickness / 2]}
            material={hazardMaterial}
          >
            <boxGeometry args={[pitWidth + edgeThickness * 2, edgeHeight, edgeThickness]} />
          </mesh>

          {/* Glowing warning edge - west side */}
          <mesh
            position={[-pitWidth / 2 - edgeThickness / 2, edgeHeight / 2, 0]}
            material={hazardMaterial}
          >
            <boxGeometry args={[edgeThickness, edgeHeight, pitDepth]} />
          </mesh>

          {/* Glowing warning edge - east side */}
          <mesh
            position={[pitWidth / 2 + edgeThickness / 2, edgeHeight / 2, 0]}
            material={hazardMaterial}
          >
            <boxGeometry args={[edgeThickness, edgeHeight, pitDepth]} />
          </mesh>

          {/* Pit floor far below (visual indication of depth) */}
          <mesh position={[0, -10, 0]} material={wallMaterial}>
            <boxGeometry args={[pitWidth, 0.5, pitDepth]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * ElevationRamps - Connect ground level to north elevated route
 * One on each side (Team A and Team B approach)
 */
function ElevationRamps() {
  const elevationY = MAP_CONFIG.platformHeight; // y=3
  const rampWidth = 5;
  // Ramp length based on 30 degree angle: rise=3, run=3/tan(30)=~5.2
  // Using a simpler approximation with a longer ramp for better gameplay
  const rampLength = 8;
  const rampAngle = Math.atan2(elevationY, rampLength); // ~20 degrees

  // Ramp positions - at connector X positions, approaching north route
  const rampConfigs = [
    { x: CONNECTOR_LEFT_X, zDir: 1 }, // Team A side, ramp goes toward north
    { x: CONNECTOR_RIGHT_X, zDir: 1 }, // Team B side, ramp goes toward north
  ];

  return (
    <group name="elevation-ramps">
      {rampConfigs.map((config, index) => {
        // Position ramp between middle connector and north route
        const rampCenterZ = NORTH_Z + rampLength / 2 + 1;
        const rampCenterY = elevationY / 2;

        return (
          <group key={`ramp-${index}`}>
            {/* Ramp surface */}
            <mesh
              position={[config.x, rampCenterY, rampCenterZ]}
              rotation={[-rampAngle, 0, 0]}
              material={floorMaterial}
            >
              <boxGeometry args={[rampWidth, 0.3, rampLength + 1]} />
            </mesh>

            {/* Ramp side rails */}
            <mesh
              position={[config.x - rampWidth / 2 - 0.15, rampCenterY + 0.3, rampCenterZ]}
              rotation={[-rampAngle, 0, 0]}
              material={wallMaterial}
            >
              <boxGeometry args={[0.3, 0.6, rampLength + 1]} />
            </mesh>
            <mesh
              position={[config.x + rampWidth / 2 + 0.15, rampCenterY + 0.3, rampCenterZ]}
              rotation={[-rampAngle, 0, 0]}
              material={wallMaterial}
            >
              <boxGeometry args={[0.3, 0.6, rampLength + 1]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/**
 * CenterZone - Main export combining all central map features
 */
export function CenterZone() {
  return (
    <group name="center-zone">
      <CentralHub />
      <RouteConnectors />
      <HazardZones />
      <ElevationRamps />
    </group>
  );
}
