/**
 * Sci-Fi CTF Map Position Configuration
 *
 * Shared between client and server to ensure spawn/flag positions
 * are consistent across game systems.
 */

import type { Vec3 } from '../types/vector.js';

export const SCI_FI_CTF_POSITIONS = {
  // Team base center positions
  teamABase: { x: -80, y: 0, z: 0 },
  teamBBase: { x: 80, y: 0, z: 0 },

  // Spawn positions - distributed across base area
  spawnPoints: {
    red: [
      { x: -80, y: 1, z: -12 },
      { x: -80, y: 1, z: 0 },
      { x: -80, y: 1, z: 12 },
      { x: -75, y: 1, z: -6 },
      { x: -75, y: 1, z: 6 },
    ] as Vec3[],
    blue: [
      { x: 80, y: 1, z: -12 },
      { x: 80, y: 1, z: 0 },
      { x: 80, y: 1, z: 12 },
      { x: 75, y: 1, z: -6 },
      { x: 75, y: 1, z: 6 },
    ] as Vec3[],
  },

  // Flag zone positions
  flagZones: {
    red: { x: -90, y: 1, z: 0 },
    blue: { x: 92, y: 1, z: 0 },
  },
} as const;

export type SciFiCTFPositions = typeof SCI_FI_CTF_POSITIONS;
