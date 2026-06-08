/**
 * Map Configuration for Sci-Fi CTF Arena
 *
 * Defines dimensions, spawn positions, and elevation constants
 * for the asymmetrical CTF map.
 */

export const MAP_CONFIG = {
  // Map dimensions (Tron map - from Blender analysis)
  dimensions: {
    width: 100, // X-axis: -50 to 50
    depth: 80,  // Z-axis: -40 to 40
  },

  // Team base positions (A and B sites on Tron map)
  teamABase: { x: -35, y: 0, z: -25 },
  teamBBase: { x: 35, y: 0, z: -25 },

  // Elevation constants
  groundY: 0, // Base ground level
  platformHeight: 4, // Elevated platform height
  wallHeight: 12, // Boundary wall height (impassable)

  // Route engagement distances
  routes: {
    closeQuarters: { name: 'Tunnels', avgWidth: 4 },
    mediumRange: { name: 'Mid Lane', avgWidth: 12 },
    longRange: { name: 'Elevated', avgWidth: 8 },
  },

  // Spawn positions based on actual Tron map spawn platforms
  // T spawn (red/teamA): Z=32, CT spawn (blue/teamB): Z=-35
  spawnPoints: {
    teamA: [
      // T spawn - south side
      { x: -4, y: 1, z: 32 },
      { x: 4, y: 1, z: 32 },
      { x: -4, y: 1, z: 35 },
      { x: 4, y: 1, z: 35 },
    ],
    teamB: [
      // CT spawn - north side
      { x: -4, y: 1, z: -35 },
      { x: 4, y: 1, z: -35 },
      { x: -4, y: 1, z: -38 },
      { x: 4, y: 1, z: -38 },
    ],
  },

  // Flag zone positions at A and B sites
  flagZones: {
    teamA: { x: -35, y: 1, z: -25 },
    teamB: { x: 35, y: 1, z: -25 },
  },
} as const;

// Type export for consumers
export type MapConfig = typeof MAP_CONFIG;
