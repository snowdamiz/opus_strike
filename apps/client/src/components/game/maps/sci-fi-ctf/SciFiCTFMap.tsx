/**
 * SciFiCTFMap - Main map component for the asymmetrical CTF arena
 *
 * This component renders the procedural sci-fi themed CTF map.
 * Includes debug grid floor and team base geometry.
 */

import { Grid } from '@react-three/drei';
import { MAP_CONFIG } from './config';
import { TeamABase, TeamBBase } from './geometry';

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

      {/* Team base geometry */}
      <TeamABase />
      <TeamBBase />

      {/* Placeholder for additional map geometry - to be added in subsequent plans:
       * - Plan 04: Central arena and route structures
       * - Plan 05: Physics colliders
       */}
    </group>
  );
}
