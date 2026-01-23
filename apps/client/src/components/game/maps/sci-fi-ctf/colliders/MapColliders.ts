/**
 * MapColliders - Physics collider definitions for Sci-Fi CTF map
 *
 * Creates all necessary cuboid colliders for ground floors, walls,
 * elevated platforms, and tunnel sections.
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import { MAP_CONFIG } from '../config';

const { dimensions, wallHeight, platformHeight, teamABase, teamBBase } = MAP_CONFIG;

// Map half dimensions
const MAP_HALF_WIDTH = dimensions.width / 2; // 100
const MAP_HALF_DEPTH = dimensions.depth / 2; // 50

// Route constants
const ROUTE_START_X = -70;
const ROUTE_END_X = 70;
const ROUTE_LENGTH = ROUTE_END_X - ROUTE_START_X;
const ROUTE_CENTER_X = (ROUTE_START_X + ROUTE_END_X) / 2;

const NORTH_Z = -30;
const MIDDLE_Z = 0;
const SOUTH_Z = 30;

/**
 * Helper to create a fixed rigid body with a cuboid collider
 */
function createCuboidCollider(
  world: RAPIER.World,
  rapier: typeof RAPIER,
  posX: number,
  posY: number,
  posZ: number,
  halfWidth: number,
  halfHeight: number,
  halfDepth: number
): void {
  const bodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(posX, posY, posZ);
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = rapier.ColliderDesc.cuboid(halfWidth, halfHeight, halfDepth);
  world.createCollider(colliderDesc, body);
}

/**
 * Create all physics colliders for the Sci-Fi CTF map
 */
export function createMapColliders(world: RAPIER.World, rapier: typeof RAPIER): void {
  // =========================================================================
  // GROUND FLOOR COLLIDERS
  // =========================================================================

  // Main ground plane covering entire map base
  // Position: center of map at y=-0.5 (top surface at y=0)
  // Size: 200 x 1 x 100 (full map dimensions)
  createCuboidCollider(world, rapier, 0, -0.5, 0, MAP_HALF_WIDTH, 0.5, MAP_HALF_DEPTH);

  // =========================================================================
  // PERIMETER WALL COLLIDERS
  // =========================================================================

  const WALL_THICKNESS_HALF = 1; // 2 units thick / 2

  // North wall: z = -50
  createCuboidCollider(
    world, rapier,
    0, wallHeight / 2, -MAP_HALF_DEPTH,
    MAP_HALF_WIDTH, wallHeight / 2, WALL_THICKNESS_HALF
  );

  // South wall: z = +50
  createCuboidCollider(
    world, rapier,
    0, wallHeight / 2, MAP_HALF_DEPTH,
    MAP_HALF_WIDTH, wallHeight / 2, WALL_THICKNESS_HALF
  );

  // West wall: x = -100
  createCuboidCollider(
    world, rapier,
    -MAP_HALF_WIDTH, wallHeight / 2, 0,
    WALL_THICKNESS_HALF, wallHeight / 2, MAP_HALF_DEPTH
  );

  // East wall: x = +100
  createCuboidCollider(
    world, rapier,
    MAP_HALF_WIDTH, wallHeight / 2, 0,
    WALL_THICKNESS_HALF, wallHeight / 2, MAP_HALF_DEPTH
  );

  // =========================================================================
  // TEAM A BASE COLLIDERS
  // =========================================================================

  // Main spawn platform at Team A base
  // Position: teamABase.x = -80, y = -0.25 (top at y=0)
  // Size: 30 x 0.5 x 40
  // Coverage: x[-95 to -65], z[-20 to +20]
  // Verified: All 5 Team A spawn positions fall within this area:
  //   (-80,1,-12), (-80,1,0), (-80,1,12), (-75,1,-6), (-75,1,6)
  createCuboidCollider(
    world, rapier,
    teamABase.x, -0.25, teamABase.z,
    15, 0.25, 20
  );

  // Elevated command platform at Team A
  // Position: teamABase.x - 8 = -88, y = platformHeight - 0.25 = 2.75 (top at y=3)
  // Size: 12 x 0.5 x 15
  createCuboidCollider(
    world, rapier,
    teamABase.x - 8, platformHeight - 0.25, teamABase.z,
    6, 0.25, 7.5
  );

  // Flag zone platform at Team A
  // Position: teamABase.x - 10 = -90, y = 0.5 (top at y=1)
  // Size: 8 x 1 x 8
  createCuboidCollider(
    world, rapier,
    teamABase.x - 10, 0.5, teamABase.z,
    4, 0.5, 4
  );

  // =========================================================================
  // TEAM B BASE COLLIDERS
  // =========================================================================

  // Main spawn platform at Team B base
  // Position: teamBBase.x = +80, y = -0.25 (top at y=0)
  // Size: 30 x 0.5 x 40
  // Coverage: x[65 to 95], z[-20 to +20]
  // Verified: All 5 Team B spawn positions fall within this area:
  //   (80,1,-12), (80,1,0), (80,1,12), (75,1,-6), (75,1,6)
  createCuboidCollider(
    world, rapier,
    teamBBase.x, -0.25, teamBBase.z,
    15, 0.25, 20
  );

  // Elevated platforms at Team B (cave with overlook ledge)
  // Position: teamBBase.x + 8 = 88, y = platformHeight - 0.25 = 2.75 (top at y=3)
  // Size: 12 x 0.5 x 15
  createCuboidCollider(
    world, rapier,
    teamBBase.x + 8, platformHeight - 0.25, teamBBase.z,
    6, 0.25, 7.5
  );

  // Flag zone platform at Team B
  // Position: teamBBase.x + 10 = 90, y = 0.5 (top at y=1)
  // Size: 8 x 1 x 8
  createCuboidCollider(
    world, rapier,
    teamBBase.x + 10, 0.5, teamBBase.z,
    4, 0.5, 4
  );

  // =========================================================================
  // NORTH ROUTE COLLIDERS (Elevated skybridge at y=3)
  // =========================================================================

  // Elevated platform floor
  // Position: center of route at y = platformHeight - 0.25 = 2.75 (top at y=3)
  // Size: 140 x 0.5 x 12
  createCuboidCollider(
    world, rapier,
    ROUTE_CENTER_X, platformHeight - 0.25, NORTH_Z,
    ROUTE_LENGTH / 2, 0.25, 6
  );

  // Low railings for cover (north side)
  // Position: y = platformHeight + 0.25 = 3.25, z = NORTH_Z - 5.75
  createCuboidCollider(
    world, rapier,
    ROUTE_CENTER_X, platformHeight + 0.25, NORTH_Z - 5.75,
    ROUTE_LENGTH / 2, 0.25, 0.25
  );

  // Low railings for cover (south side)
  createCuboidCollider(
    world, rapier,
    ROUTE_CENTER_X, platformHeight + 0.25, NORTH_Z + 5.75,
    ROUTE_LENGTH / 2, 0.25, 0.25
  );

  // Cover pillars along north route
  [-40, 0, 40].forEach((xOffset) => {
    createCuboidCollider(
      world, rapier,
      xOffset, platformHeight + 1, NORTH_Z,
      0.5, 1, 0.5
    );
  });

  // =========================================================================
  // MIDDLE ROUTE COLLIDERS (Ground level)
  // =========================================================================

  // Main floor already covered by ground plane

  // Cover blocks - Team A side
  createCuboidCollider(world, rapier, -50, 0.75, MIDDLE_Z - 4, 1.5, 0.75, 0.5);
  createCuboidCollider(world, rapier, -50, 0.75, MIDDLE_Z + 4, 1.5, 0.75, 0.5);

  // Cover blocks - Mid-left
  createCuboidCollider(world, rapier, -25, 0.75, MIDDLE_Z - 2, 1, 0.75, 2);
  createCuboidCollider(world, rapier, -25, 0.75, MIDDLE_Z + 5, 2, 0.75, 1);

  // Cover blocks - Mid-right
  createCuboidCollider(world, rapier, 25, 0.75, MIDDLE_Z + 2, 1, 0.75, 2);
  createCuboidCollider(world, rapier, 25, 0.75, MIDDLE_Z - 5, 2, 0.75, 1);

  // Cover blocks - Team B side
  createCuboidCollider(world, rapier, 50, 0.75, MIDDLE_Z - 4, 1.5, 0.75, 0.5);
  createCuboidCollider(world, rapier, 50, 0.75, MIDDLE_Z + 4, 1.5, 0.75, 0.5);

  // =========================================================================
  // SOUTH ROUTE COLLIDERS (Tunnel system)
  // =========================================================================

  // Main floor already covered by ground plane

  // Tunnel sections with walls and ceiling
  const tunnelSections = [
    { startX: -60, endX: -35 }, // Team A approach tunnel
    { startX: -10, endX: 10 },  // Center tunnel
    { startX: 35, endX: 60 },   // Team B approach tunnel
  ];

  const tunnelWidth = 8;
  const tunnelHeight = 3;
  const wallThickness = 0.5;

  tunnelSections.forEach((section) => {
    const sectionLength = section.endX - section.startX;
    const sectionCenterX = (section.startX + section.endX) / 2;

    // North tunnel wall
    createCuboidCollider(
      world, rapier,
      sectionCenterX, tunnelHeight / 2, SOUTH_Z - tunnelWidth / 2 - wallThickness / 2,
      sectionLength / 2, tunnelHeight / 2, wallThickness / 2
    );

    // South tunnel wall
    createCuboidCollider(
      world, rapier,
      sectionCenterX, tunnelHeight / 2, SOUTH_Z + tunnelWidth / 2 + wallThickness / 2,
      sectionLength / 2, tunnelHeight / 2, wallThickness / 2
    );

    // Ceiling
    createCuboidCollider(
      world, rapier,
      sectionCenterX, tunnelHeight, SOUTH_Z,
      sectionLength / 2, wallThickness / 2, (tunnelWidth + 1) / 2
    );
  });

  // Corner obstacles in open sections
  // Between Team A tunnel and center
  createCuboidCollider(world, rapier, -22, 1, SOUTH_Z - 2, 1, 1, 1);
  createCuboidCollider(world, rapier, -22, 1, SOUTH_Z + 3, 0.75, 1, 0.75);

  // Between center and Team B tunnel
  createCuboidCollider(world, rapier, 22, 1, SOUTH_Z + 2, 1, 1, 1);
  createCuboidCollider(world, rapier, 22, 1, SOUTH_Z - 3, 0.75, 1, 0.75);

  // =========================================================================
  // CENTER ZONE COLLIDERS
  // =========================================================================

  // Central hub platform (slightly elevated)
  // Based on CenterZone.tsx: position [0, 0.25, 0], radius ~15
  createCuboidCollider(world, rapier, 0, 0.25, 0, 15, 0.25, 15);

  // Sniper perches (north and south of center)
  // These are at platformHeight = 3
  createCuboidCollider(world, rapier, 0, platformHeight - 0.25, -15, 4, 0.25, 3);
  createCuboidCollider(world, rapier, 0, platformHeight - 0.25, 15, 4, 0.25, 3);

  console.log('[MapColliders] Created all map colliders');
}
