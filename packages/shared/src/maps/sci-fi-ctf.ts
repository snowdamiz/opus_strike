/**
 * Sci-Fi CTF Map Position Configuration
 *
 * Shared between client and server to ensure spawn/flag positions
 * are consistent across game systems.
 */

import type { Vec3 } from '../types/vector.js';

export const SCI_FI_CTF_POSITIONS = {
  // Team base center positions (Tron map)
  // CT spawn at Z=-35, T spawn at Z=32
  teamABase: { x: -35, y: 0, z: -25 },  // A site
  teamBBase: { x: 35, y: 0, z: -25 },   // B site

  // Spawn positions based on actual Tron map spawn platforms
  // CT_Spawn_Platform: X[-10,10], Z=-35 (Blender Y=35)
  // T_Spawn_Platform: X[-10,10], Z=32 (Blender Y=-32)
  // y=1 places player just above ground level
  spawnPoints: {
    red: [
      // T spawn (terrorist/red team) - south side of map (Z=32)
      { x: -6, y: 1, z: 32 },
      { x: 0, y: 1, z: 32 },
      { x: 6, y: 1, z: 32 },
      { x: -3, y: 1, z: 35 },
      { x: 3, y: 1, z: 35 },
    ] as Vec3[],
    blue: [
      // CT spawn (counter-terrorist/blue team) - north side of map (Z=-35)
      { x: -6, y: 1, z: -35 },
      { x: 0, y: 1, z: -35 },
      { x: 6, y: 1, z: -35 },
      { x: -3, y: 1, z: -38 },
      { x: 3, y: 1, z: -38 },
    ] as Vec3[],
  },

  // Flag zone positions at A and B sites
  flagZones: {
    red: { x: -35, y: 1, z: -25 },   // A site
    blue: { x: 35, y: 1, z: -25 },   // B site
  },
} as const;

export type SciFiCTFPositions = typeof SCI_FI_CTF_POSITIONS;
