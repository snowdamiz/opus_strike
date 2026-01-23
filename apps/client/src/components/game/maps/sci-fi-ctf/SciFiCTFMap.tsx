/**
 * SciFiCTFMap - Main map component for the asymmetrical CTF arena
 *
 * This component renders the procedural sci-fi themed CTF map.
 * Currently renders a debug grid floor; geometry will be added in subsequent plans.
 */

import { Grid } from '@react-three/drei';
import { MAP_CONFIG } from './config';

export function SciFiCTFMap() {
  const { dimensions } = MAP_CONFIG;

  return (
    <group name="sci-fi-ctf-map">
      {/* Debug grid floor - provides sci-fi aesthetic with fade */}
      <Grid
        position={[0, 0.01, 0]}
        args={[dimensions.width, dimensions.depth]}
        cellSize={2}
        cellThickness={0.5}
        cellColor="#1a1a2e"
        sectionSize={10}
        sectionThickness={1}
        sectionColor="#00ffff"
        fadeDistance={150}
        fadeStrength={1}
        followCamera={false}
        infiniteGrid={false}
      />

      {/* Placeholder for map geometry - to be added in subsequent plans:
       * - Plan 02: Ground geometry and elevation
       * - Plan 03: Boundary walls and route structures
       * - Plan 04: Team base areas
       * - Plan 05: Physics colliders
       */}
    </group>
  );
}
