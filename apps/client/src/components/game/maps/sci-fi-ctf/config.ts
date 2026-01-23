/**
 * Map Configuration for Sci-Fi CTF Arena
 *
 * Defines dimensions, spawn positions, and elevation constants
 * for the asymmetrical CTF map.
 */

export const MAP_CONFIG = {
  // Map dimensions (elongated rectangle)
  dimensions: {
    width: 200, // X-axis (perpendicular to team axis)
    depth: 100, // Z-axis (team A to team B axis)
  },

  // Team base positions
  // Team A: Tech/platform aesthetic (left side)
  // Team B: Natural/cave aesthetic (right side)
  teamABase: { x: -80, y: 0, z: 0 },
  teamBBase: { x: 80, y: 0, z: 0 },

  // Elevation constants
  groundY: 0, // Base ground level
  platformHeight: 3, // Standard platform elevation
  wallHeight: 15, // Boundary wall height (impassable)

  // Route engagement distances
  routes: {
    closeQuarters: { name: 'Tunnels', avgWidth: 4 },
    mediumRange: { name: 'Mid Lane', avgWidth: 12 },
    longRange: { name: 'Skybridge', avgWidth: 8 },
  },

  // Spawn positions - distributed across base area
  // 5 positions per team for rotation variety
  // y=3 ensures player spawns above floor geometry
  spawnPoints: {
    teamA: [
      { x: -80, y: 3, z: -12 }, // North spawn (near north route)
      { x: -80, y: 3, z: 0 }, // Center spawn
      { x: -80, y: 3, z: 12 }, // South spawn (near south route)
      { x: -75, y: 3, z: -6 }, // Front-north spawn
      { x: -75, y: 3, z: 6 }, // Front-south spawn
    ],
    teamB: [
      { x: 80, y: 3, z: -12 }, // North spawn
      { x: 80, y: 3, z: 0 }, // Center spawn
      { x: 80, y: 3, z: 12 }, // South spawn
      { x: 75, y: 3, z: -6 }, // Front-north spawn (closer to routes)
      { x: 75, y: 3, z: 6 }, // Front-south spawn
    ],
  },

  // Flag zone positions - center of flag platforms in world coordinates
  flagZones: {
    teamA: { x: -90, y: 1, z: 0 }, // Back of Team A base on raised platform
    teamB: { x: 92, y: 1, z: 0 }, // Back of Team B base in alcove
  },
} as const;

// Type export for consumers
export type MapConfig = typeof MAP_CONFIG;
