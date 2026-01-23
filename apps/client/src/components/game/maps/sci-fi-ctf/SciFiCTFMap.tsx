/**
 * SciFiCTFMap - Main map component for the asymmetrical CTF arena
 *
 * This component renders the procedural sci-fi themed CTF map.
 * Complete layout with team bases, routes, and center zone.
 */

import { Grid } from '@react-three/drei';
import { MAP_CONFIG } from './config';
import { TeamABase, TeamBBase, Routes, CenterZone, Boundaries } from './geometry';

export function SciFiCTFMap() {
  return (
    <group name="sci-fi-ctf-map">
      {/* Sci-fi grid floor visible at center hub area */}
      <Grid
        position={[0, 0.02, 0]}
        args={[30, 30]}
        cellSize={2}
        cellThickness={0.5}
        cellColor="#1a1a2e"
        sectionSize={10}
        sectionThickness={1}
        sectionColor="#00ffff"
        fadeDistance={20}
        fadeStrength={1}
        followCamera={false}
        infiniteGrid={false}
      />

      {/* Team base geometry */}
      <TeamABase />
      <TeamBBase />

      {/* Route structures - three lanes connecting bases */}
      <Routes />

      {/* Central arena - hub, connectors, hazards, ramps */}
      <CenterZone />

      {/* Perimeter walls enclosing the map */}
      <Boundaries />
    </group>
  );
}
