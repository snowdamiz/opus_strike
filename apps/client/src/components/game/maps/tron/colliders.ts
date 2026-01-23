/**
 * TronMapColliders - Physics collider definitions for Tron map
 *
 * Based on actual Blender geometry analysis:
 * - Arena floor: 100x80 units (X: -50 to 50, Z: -40 to 40)
 * - Walls: 12 units tall at perimeter
 * - Various platforms and cover objects
 *
 * Coordinate conversion (Blender +Y Up export):
 * - Blender X → Three.js X
 * - Blender Y → Three.js Z (negated)
 * - Blender Z → Three.js Y
 */

import type RAPIER from '@dimforge/rapier3d-compat';

// Map dimensions from Blender analysis
const MAP_HALF_WIDTH_X = 50;  // X-axis: -50 to 50
const MAP_HALF_DEPTH_Z = 40;  // Z-axis: -40 to 40 (from Blender Y)
const WALL_HEIGHT = 12;

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
 * Create all physics colliders for the Tron map
 */
export function createTronMapColliders(world: RAPIER.World, rapier: typeof RAPIER): void {
  // =========================================================================
  // MAIN GROUND FLOOR
  // =========================================================================
  // Arena floor: 100x80 units at Y=0
  createCuboidCollider(world, rapier, 0, -0.5, 0, MAP_HALF_WIDTH_X, 0.5, MAP_HALF_DEPTH_Z);

  // =========================================================================
  // PERIMETER WALLS (12 units tall)
  // =========================================================================
  const WALL_THICKNESS_HALF = 1;

  // North wall (Blender Y=40 → Z=-40)
  createCuboidCollider(
    world, rapier,
    0, WALL_HEIGHT / 2, -MAP_HALF_DEPTH_Z,
    MAP_HALF_WIDTH_X, WALL_HEIGHT / 2, WALL_THICKNESS_HALF
  );

  // South wall (Blender Y=-40 → Z=40)
  createCuboidCollider(
    world, rapier,
    0, WALL_HEIGHT / 2, MAP_HALF_DEPTH_Z,
    MAP_HALF_WIDTH_X, WALL_HEIGHT / 2, WALL_THICKNESS_HALF
  );

  // West wall (X=-50)
  createCuboidCollider(
    world, rapier,
    -MAP_HALF_WIDTH_X, WALL_HEIGHT / 2, 0,
    WALL_THICKNESS_HALF, WALL_HEIGHT / 2, MAP_HALF_DEPTH_Z
  );

  // East wall (X=50)
  createCuboidCollider(
    world, rapier,
    MAP_HALF_WIDTH_X, WALL_HEIGHT / 2, 0,
    WALL_THICKNESS_HALF, WALL_HEIGHT / 2, MAP_HALF_DEPTH_Z
  );

  // =========================================================================
  // SPAWN PLATFORMS
  // =========================================================================
  // CT Spawn Platform: Blender (-10 to 10, 31 to 39, 0) → Three.js X[-10,10], Y=0, Z[-39,-31]
  createCuboidCollider(world, rapier, 0, -0.15, -35, 10, 0.15, 4);

  // T Spawn Platform: Blender (-10 to 10, -38 to -26, 0) → Three.js X[-10,10], Y=0, Z[26,38]
  createCuboidCollider(world, rapier, 0, -0.15, 32, 10, 0.15, 6);

  // =========================================================================
  // SITE PLATFORMS (A and B sites)
  // =========================================================================
  // A Site Platform: Blender (-43 to -27, 17 to 33, 0-0.3) → X[-43,-27], Y=0.15, Z[-33,-17]
  createCuboidCollider(world, rapier, -35, 0.15, -25, 8, 0.15, 8);

  // B Site Platform: Blender (27 to 43, 17 to 33, 0-0.3) → X[27,43], Y=0.15, Z[-33,-17]
  createCuboidCollider(world, rapier, 35, 0.15, -25, 8, 0.15, 8);

  // =========================================================================
  // ELEVATED PLATFORMS
  // =========================================================================
  // Elev_A_Platform: Blender (-22 to -14, -8 to 8, 3.8-4.2) → X[-22,-14], Y=4, Z[-8,8]
  createCuboidCollider(world, rapier, -18, 4, 0, 4, 0.2, 8);

  // Elev_B_Platform: Blender (14 to 22, -8 to 8, 3.8-4.2) → X[14,22], Y=4, Z[-8,8]
  createCuboidCollider(world, rapier, 18, 4, 0, 4, 0.2, 8);

  // B Tower Platform: Blender (37.5 to 46.5, 26 to 32, 2.8-3.2) → X[37.5,46.5], Y=3, Z[-32,-26]
  createCuboidCollider(world, rapier, 42, 3, -29, 4.5, 0.2, 3);

  // Platform_0: Blender (-37.5 to -32.5, -12.5 to -7.5, 1.8-2.2) → X[-37.5,-32.5], Y=2, Z[7.5,12.5]
  createCuboidCollider(world, rapier, -35, 2, 10, 2.5, 0.25, 2.5);

  // Platform_1: Blender (32.5 to 37.5, -12.5 to -7.5, 1.8-2.2) → X[32.5,37.5], Y=2, Z[7.5,12.5]
  createCuboidCollider(world, rapier, 35, 2, 10, 2.5, 0.25, 2.5);

  // =========================================================================
  // COVER WALLS (3 units tall)
  // =========================================================================
  // Cover_Wall_0: X[-13.5,-10.5], Y=1.5, Z[-8.1,-7.8] (thin wall)
  createCuboidCollider(world, rapier, -12, 1.5, -8, 1.5, 1.5, 0.15);

  // Cover_Wall_1: X[10.5,13.5], Y=1.5, Z[-8.1,-7.8]
  createCuboidCollider(world, rapier, 12, 1.5, -8, 1.5, 1.5, 0.15);

  // Cover_Wall_2: X[-13.5,-10.5], Y=1.5, Z[7.8,8.1]
  createCuboidCollider(world, rapier, -12, 1.5, 8, 1.5, 1.5, 0.15);

  // Cover_Wall_3: X[10.5,13.5], Y=1.5, Z[7.8,8.1]
  createCuboidCollider(world, rapier, 12, 1.5, 8, 1.5, 1.5, 0.15);

  // Cover_Wall_4: X[-30.2,-29.8], Y=2, Z[-4,4] (vertical wall)
  createCuboidCollider(world, rapier, -30, 2, 0, 0.25, 2, 4);

  // Cover_Wall_5: X[29.8,30.2], Y=2, Z[-4,4]
  createCuboidCollider(world, rapier, 30, 2, 0, 0.25, 2, 4);

  // Cover_Wall_6: X[-20,-16], Y=1.5, Z[-22.2,-21.8]
  createCuboidCollider(world, rapier, -18, 1.5, -22, 2, 1.5, 0.2);

  // Cover_Wall_7: X[16,20], Y=1.5, Z[-22.2,-21.8]
  createCuboidCollider(world, rapier, 18, 1.5, -22, 2, 1.5, 0.2);

  // Cover_Wall_8: X[-20,-16], Y=1.5, Z[21.8,22.2]
  createCuboidCollider(world, rapier, -18, 1.5, 22, 2, 1.5, 0.2);

  // Cover_Wall_9: X[16,20], Y=1.5, Z[21.8,22.2]
  createCuboidCollider(world, rapier, 18, 1.5, 22, 2, 1.5, 0.2);

  // =========================================================================
  // TEAM COVER WALLS (4 units tall)
  // =========================================================================
  // CT_Cover_Wall_1: X[-17,-13], Y=2, Z[24.8,25.2]
  createCuboidCollider(world, rapier, -15, 2, 25, 2, 2, 0.25);

  // CT_Cover_Wall_2: X[13,17], Y=2, Z[24.8,25.2]
  createCuboidCollider(world, rapier, 15, 2, 25, 2, 2, 0.25);

  // T_Cover_Wall_1: X[-17,-13], Y=2, Z[-30.2,-29.8]
  createCuboidCollider(world, rapier, -15, 2, -30, 2, 2, 0.25);

  // T_Cover_Wall_2: X[13,17], Y=2, Z[-30.2,-29.8]
  createCuboidCollider(world, rapier, 15, 2, -30, 2, 2, 0.25);

  // =========================================================================
  // TUNNEL WALLS
  // =========================================================================
  // A_Tunnel_Wall_L: X[-20.5,-19.5], Y=3, Z[-21,-15]
  createCuboidCollider(world, rapier, -20, 3, -18, 0.5, 3, 3);

  // A_Tunnel_Wall_R: X[-16.5,-15.5], Y=3, Z[-21,-15]
  createCuboidCollider(world, rapier, -16, 3, -18, 0.5, 3, 3);

  // B_Tunnel_Wall_L: X[15.5,16.5], Y=3, Z[-21,-15]
  createCuboidCollider(world, rapier, 16, 3, -18, 0.5, 3, 3);

  // B_Tunnel_Wall_R: X[19.5,20.5], Y=3, Z[-21,-15]
  createCuboidCollider(world, rapier, 20, 3, -18, 0.5, 3, 3);

  console.log('[TronMapColliders] Created comprehensive Tron map colliders');
}
