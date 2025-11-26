import { useEffect, useRef, useState } from 'react';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Map configuration - must match VoxelWorld.tsx
const CURRENT_MAP = '/maps/Inferno_World_free.glb';
const MAP_SCALE = 1;

interface PhysicsContext {
  world: RAPIER.World | null;
  playerBody: RAPIER.RigidBody | null;
  isReady: boolean;
}

let rapierInstance: typeof RAPIER | null = null;
let worldInstance: RAPIER.World | null = null;
let physicsReady = false;

export async function initPhysics(): Promise<typeof RAPIER> {
  if (rapierInstance) return rapierInstance;
  
  await RAPIER.init();
  rapierInstance = RAPIER;
  return RAPIER;
}

export function usePhysics(): PhysicsContext {
  const [isReady, setIsReady] = useState(false);
  const worldRef = useRef<RAPIER.World | null>(null);
  const playerBodyRef = useRef<RAPIER.RigidBody | null>(null);

  useEffect(() => {
    let mounted = true;

    async function setup() {
      try {
        console.log('[Physics] Initializing Rapier...');
        const RAPIER = await initPhysics();

        if (!mounted) return;

        // Create physics world with gravity
        const gravity = { x: 0, y: -20, z: 0 }; // Reduced for floatier feel
        worldRef.current = new RAPIER.World(gravity);
        worldInstance = worldRef.current;
        console.log('[Physics] World created');

        // Create ground as a fixed rigid body - positioned LOW as safety net
        // The actual terrain from GLB is higher (around y=10-20)
        const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -50, 0);
        const groundBody = worldRef.current.createRigidBody(groundBodyDesc);
        const groundColliderDesc = RAPIER.ColliderDesc.cuboid(200, 1, 200);
        worldRef.current.createCollider(groundColliderDesc, groundBody);
        console.log('[Physics] Fallback ground plane created at y=-49 (safety net)');

        // Note: No test platform needed - terrain from GLB provides collision

        // Create player rigid body
        const playerDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(0, 50, 0);
        playerBodyRef.current = worldRef.current.createRigidBody(playerDesc);

        // Create player collider
        const playerColliderDesc = RAPIER.ColliderDesc.capsule(0.5, 0.4)
          .setTranslation(0, 0.9, 0);
        worldRef.current.createCollider(playerColliderDesc, playerBodyRef.current);

        // Create boundary walls
        createBoundaryColliders(worldRef.current, RAPIER);

        // Load GLB map and create trimesh colliders
        console.log('[Physics] Loading map colliders...');
        await loadMapColliders(worldRef.current, RAPIER);

        // IMPORTANT: Step the world to initialize collision structures
        // This is required for raycasts to work in Rapier
        worldRef.current.step();
        worldRef.current.step(); // Step twice to be safe
        console.log('[Physics] World stepped to initialize');
        
        // Also update the internal structures for queries
        worldRef.current.updateSceneQueries();
        console.log('[Physics] Scene queries updated');

        physicsReady = true;
        setIsReady(true);
        console.log('[Physics] Ready!');
        
        // Test raycast from above to verify it works
        testRaycast();
      } catch (error) {
        console.error('[Physics] Failed to initialize:', error);
      }
    }

    setup();

    return () => {
      mounted = false;
    };
  }, []);

  return {
    world: worldRef.current,
    playerBody: playerBodyRef.current,
    isReady,
  };
}

function createBoundaryColliders(world: RAPIER.World, rapier: typeof RAPIER) {
  const boundaryHeight = 100;
  const mapSize = 200;

  // Invisible boundary walls - use fixed rigid bodies
  const walls = [
    { pos: [0, boundaryHeight / 2, -mapSize / 2], size: [mapSize / 2, boundaryHeight / 2, 1] },
    { pos: [0, boundaryHeight / 2, mapSize / 2], size: [mapSize / 2, boundaryHeight / 2, 1] },
    { pos: [-mapSize / 2, boundaryHeight / 2, 0], size: [1, boundaryHeight / 2, mapSize / 2] },
    { pos: [mapSize / 2, boundaryHeight / 2, 0], size: [1, boundaryHeight / 2, mapSize / 2] },
  ];

  for (const wall of walls) {
    const bodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(
      wall.pos[0] as number,
      wall.pos[1] as number,
      wall.pos[2] as number
    );
    const body = world.createRigidBody(bodyDesc);
    const colliderDesc = rapier.ColliderDesc.cuboid(
      wall.size[0] as number,
      wall.size[1] as number,
      wall.size[2] as number
    );
    world.createCollider(colliderDesc, body);
  }
  console.log('[Physics] Boundary walls created');
}

async function loadMapColliders(world: RAPIER.World, rapier: typeof RAPIER): Promise<void> {
  return new Promise((resolve) => {
    console.log('[Physics] Starting to load map from:', CURRENT_MAP);
    const loader = new GLTFLoader();
    
    loader.load(
      CURRENT_MAP,
      (gltf) => {
        console.log('[Physics] GLB loaded successfully, processing meshes...');
        let meshCount = 0;
        let successCount = 0;
        let totalVertices = 0;
        
        // First, update all world matrices
        gltf.scene.updateMatrixWorld(true);
        
        gltf.scene.traverse((child) => {
          if (child instanceof THREE.Mesh && child.geometry) {
            meshCount++;
            const vertCount = child.geometry.getAttribute('position')?.count || 0;
            totalVertices += vertCount;
            
            try {
              const success = createTrimeshCollider(world, rapier, child);
              if (success) {
                successCount++;
              } else {
                console.log(`[Physics] Skipped mesh "${child.name}" (${vertCount} verts)`);
              }
            } catch (error) {
              console.warn('[Physics] Failed to create collider for mesh:', child.name, error);
            }
          }
        });
        
        console.log(`[Physics] Created ${successCount}/${meshCount} trimesh colliders (${totalVertices} total vertices)`);
        console.log(`[Physics] Total colliders in world: ${world.colliders.len()}`);
        resolve();
      },
      (progress) => {
        if (progress.total > 0) {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          if (percent % 25 === 0) {
            console.log(`[Physics] Loading: ${percent}%`);
          }
        }
      },
      (error) => {
        console.error('[Physics] Failed to load GLB:', error);
        console.log('[Physics] Continuing with fallback ground only');
        // Resolve anyway so the game can continue with fallback ground
        resolve();
      }
    );
  });
}

function createTrimeshCollider(
  world: RAPIER.World,
  rapier: typeof RAPIER,
  mesh: THREE.Mesh
): boolean {
  const geometry = mesh.geometry;
  
  if (!geometry) return false;

  // Clone geometry to avoid modifying the original
  const bufferGeometry = geometry.clone();
  
  // Apply mesh's world transform to geometry
  bufferGeometry.applyMatrix4(mesh.matrixWorld);

  // Get position attribute
  const positionAttribute = bufferGeometry.getAttribute('position');
  if (!positionAttribute) return false;

  // Extract vertices
  const vertexCount = positionAttribute.count;
  const vertices = new Float32Array(vertexCount * 3);
  
  for (let i = 0; i < vertexCount; i++) {
    vertices[i * 3] = positionAttribute.getX(i) * MAP_SCALE;
    vertices[i * 3 + 1] = positionAttribute.getY(i) * MAP_SCALE;
    vertices[i * 3 + 2] = positionAttribute.getZ(i) * MAP_SCALE;
  }

  // Get indices
  let indices: Uint32Array;
  if (bufferGeometry.index) {
    indices = new Uint32Array(bufferGeometry.index.array);
  } else {
    // Non-indexed geometry - create sequential indices for triangles
    const indexCount = vertexCount;
    indices = new Uint32Array(indexCount);
    for (let i = 0; i < indexCount; i++) {
      indices[i] = i;
    }
  }

  // Ensure we have valid triangles (at least 3 vertices and 3 indices)
  if (vertices.length < 9 || indices.length < 3) {
    return false;
  }

  // Create trimesh collider attached to a fixed rigid body
  try {
    const colliderDesc = rapier.ColliderDesc.trimesh(vertices, indices);

    if (colliderDesc) {
      // Create a fixed rigid body at origin for the trimesh
      const bodyDesc = rapier.RigidBodyDesc.fixed();
      const body = world.createRigidBody(bodyDesc);
      world.createCollider(colliderDesc, body);
      return true;
    }
  } catch (error) {
    // Silently fail for invalid meshes
  }
  
  return false;
}

export function getPhysicsWorld(): RAPIER.World | null {
  return worldInstance;
}

export function isPhysicsReady(): boolean {
  return physicsReady;
}

// Utility function for raycasting
export function raycast(
  world: RAPIER.World,
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  maxDistance: number
): { point: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number }; distance: number } | null {
  if (!rapierInstance || !world) {
    return null;
  }
  
  try {
    // Create ray - Rapier accepts plain objects
    const ray = new rapierInstance.Ray(origin, direction);
    
    // Cast ray - solidHit=true means we want the first solid hit
    const hit = world.castRay(ray, maxDistance, true);

    if (hit) {
      const hitDistance = hit.timeOfImpact;
      const hitPoint = ray.pointAt(hitDistance);
      
      return {
        point: { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z },
        normal: { x: 0, y: 1, z: 0 }, // Default up normal
        distance: hitDistance,
      };
    }
  } catch (error) {
    console.error('[Physics] Raycast error:', error);
  }

  return null;
}

// Ground check with surface normal - returns ground height and slope info
export interface GroundInfo {
  groundY: number;
  normal: { x: number; y: number; z: number };
  isWalkable: boolean; // true if slope < MAX_SLOPE_ANGLE
}

const MAX_SLOPE_ANGLE = 50; // degrees - max angle player can walk up
const MAX_SLOPE_DOT = Math.cos((MAX_SLOPE_ANGLE * Math.PI) / 180); // ~0.64

export function checkGroundWithNormal(x: number, y: number, z: number, maxDist: number = 100): GroundInfo | null {
  if (!rapierInstance || !worldInstance) return null;
  
  try {
    const origin = { x, y, z };
    const direction = { x: 0, y: -1, z: 0 };
    const ray = new rapierInstance.Ray(origin, direction);
    
    const hit = worldInstance.castRay(ray, maxDist, true);
    if (hit) {
      const groundY = y - hit.timeOfImpact;
      
      // Get the surface normal
      let normal = { x: 0, y: 1, z: 0 };
      try {
        const hitWithNormal = hit.collider.castRayAndGetNormal(ray, maxDist, true);
        if (hitWithNormal) {
          normal = {
            x: hitWithNormal.normal.x,
            y: hitWithNormal.normal.y,
            z: hitWithNormal.normal.z
          };
        }
      } catch {
        // Use default up normal
      }
      
      // Check if slope is walkable (normal.y > cos(maxAngle))
      const isWalkable = normal.y >= MAX_SLOPE_DOT;
      
      return { groundY, normal, isWalkable };
    }
  } catch (e) {
    console.error('[Physics] checkGroundWithNormal error:', e);
  }
  return null;
}

// Simple ground check (backwards compatible)
export function checkGroundBelow(x: number, y: number, z: number, maxDist: number = 100): number | null {
  const info = checkGroundWithNormal(x, y, z, maxDist);
  return info ? info.groundY : null;
}

// Check for wall collision in a specific direction
export function checkWallCollision(
  x: number, y: number, z: number,
  dirX: number, dirZ: number,
  radius: number = 0.4
): { hit: boolean; distance: number; normal: { x: number; y: number; z: number }; pushBack: { x: number; z: number } } {
  if (!rapierInstance || !worldInstance) {
    return { hit: false, distance: Infinity, normal: { x: 0, y: 0, z: 0 }, pushBack: { x: 0, z: 0 } };
  }
  
  // Normalize direction
  const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
  if (len < 0.001) {
    return { hit: false, distance: Infinity, normal: { x: 0, y: 0, z: 0 }, pushBack: { x: 0, z: 0 } };
  }
  const ndx = dirX / len;
  const ndz = dirZ / len;
  
  try {
    // Cast rays at multiple heights to detect walls
    const heights = [0.3, 0.8, 1.4]; // Low, mid, high on player
    let closestHit: { distance: number; normal: { x: number; y: number; z: number } } | null = null;
    
    for (const h of heights) {
      const origin = { x, y: y - 0.9 + h, z }; // y-0.9 is player feet, then add height offset
      const direction = { x: ndx, y: 0, z: ndz };
      const ray = new rapierInstance.Ray(origin, direction);
      
      const hit = worldInstance.castRay(ray, radius + 0.5, true);
      if (hit && hit.timeOfImpact < radius + 0.1) {
        // Get normal
        let normal = { x: -ndx, y: 0, z: -ndz }; // Default: opposite of movement
        try {
          const hitWithNormal = hit.collider.castRayAndGetNormal(ray, radius + 0.5, true);
          if (hitWithNormal && Math.abs(hitWithNormal.normal.y) < 0.7) {
            // Only use if it's more wall-like than floor-like
            normal = {
              x: hitWithNormal.normal.x,
              y: 0, // Ignore Y for wall sliding
              z: hitWithNormal.normal.z
            };
          }
        } catch {
          // Use default normal
        }
        
        if (!closestHit || hit.timeOfImpact < closestHit.distance) {
          closestHit = { distance: hit.timeOfImpact, normal };
        }
      }
    }
    
    if (closestHit) {
      // Calculate push-back to prevent penetration
      const penetration = radius - closestHit.distance + 0.05;
      const pushBack = {
        x: closestHit.normal.x * penetration,
        z: closestHit.normal.z * penetration
      };
      
      return {
        hit: true,
        distance: closestHit.distance,
        normal: closestHit.normal,
        pushBack
      };
    }
  } catch (e) {
    console.error('[Physics] checkWallCollision error:', e);
  }
  
  return { hit: false, distance: Infinity, normal: { x: 0, y: 0, z: 0 }, pushBack: { x: 0, z: 0 } };
}

// Step height for climbing stairs/small obstacles
const STEP_UP_HEIGHT = 1.2; // Max height player can step up (tall stairs)

// Move with collision - handles wall sliding and step-up
// Uses "lift and move" approach for stairs
export function moveWithCollision(
  x: number, y: number, z: number,
  velX: number, velZ: number,
  dt: number,
  playerRadius: number = 0.4,
  isGrounded: boolean = true
): { newX: number; newZ: number; newY: number; velX: number; velZ: number; stepped: boolean } {
  if (!rapierInstance || !worldInstance) {
    return { newX: x + velX * dt, newZ: z + velZ * dt, newY: y, velX, velZ, stepped: false };
  }
  
  let newX = x;
  let newZ = z;
  let newY = y;
  let newVelX = velX;
  let newVelZ = velZ;
  let stepped = false;
  
  const moveX = velX * dt;
  const moveZ = velZ * dt;
  
  const hasHorizontalMovement = Math.abs(velX) > 0.01 || Math.abs(velZ) > 0.01;
  
  if (!hasHorizontalMovement) {
    return { newX, newZ, newY, velX, velZ, stepped };
  }

  // Target position
  const targetX = x + moveX;
  const targetZ = z + moveZ;
  
  // Check if we can move directly to target at current height
  const dirX = moveX !== 0 ? Math.sign(moveX) : 0;
  const dirZ = moveZ !== 0 ? Math.sign(moveZ) : 0;
  
  // Check for blocking at current position
  const blocked = checkWallCollision(x, y, z, dirX, dirZ, playerRadius);
  const isBlocked = blocked.hit && blocked.distance < playerRadius + Math.max(Math.abs(moveX), Math.abs(moveZ)) + 0.1;
  
  if (isBlocked && isGrounded) {
    // We're blocked - try step-up approach
    // Lift player up, try to move forward, then find ground
    
    const liftedY = y + STEP_UP_HEIGHT;
    
    // Check if we can move at the lifted height
    const liftedBlocked = checkWallCollision(x, liftedY, z, dirX, dirZ, playerRadius);
    const canMoveLifted = !liftedBlocked.hit || liftedBlocked.distance > playerRadius + Math.max(Math.abs(moveX), Math.abs(moveZ));
    
    if (canMoveLifted) {
      // We can move when lifted - check if there's ground at the target
      const groundAtTarget = checkGroundWithNormal(targetX, liftedY + 0.5, targetZ, STEP_UP_HEIGHT + 1);
      
      if (groundAtTarget && groundAtTarget.isWalkable) {
        // There's walkable ground! Step up to it
        const newGroundY = groundAtTarget.groundY;
        const stepHeight = newGroundY - (y - 0.9); // How much we're stepping up
        
        if (stepHeight > 0 && stepHeight <= STEP_UP_HEIGHT) {
          newX = targetX;
          newZ = targetZ;
          newY = newGroundY + 0.9; // Player center = ground + half player height
          stepped = true;
          return { newX, newZ, newY, velX, velZ, stepped };
        }
      }
    }
  }
  
  // Normal movement with wall collision (no step-up)
  // Try X movement
  if (Math.abs(velX) > 0.01) {
    const wallCheck = checkWallCollision(newX, y, newZ, velX > 0 ? 1 : -1, 0, playerRadius);
    if (wallCheck.hit && wallCheck.distance < playerRadius + Math.abs(moveX) + 0.05) {
      newVelX = 0;
      newX += wallCheck.pushBack.x;
    } else {
      newX += moveX;
    }
  }
  
  // Try Z movement
  if (Math.abs(velZ) > 0.01) {
    const wallCheck = checkWallCollision(newX, y, newZ, 0, velZ > 0 ? 1 : -1, playerRadius);
    if (wallCheck.hit && wallCheck.distance < playerRadius + Math.abs(moveZ) + 0.05) {
      newVelZ = 0;
      newZ += wallCheck.pushBack.z;
    } else {
      newZ += moveZ;
    }
  }
  
  return { newX, newZ, newY, velX: newVelX, velZ: newVelZ, stepped };
}

// Debug function to count colliders
export function getColliderCount(): number {
  if (!worldInstance) return 0;
  return worldInstance.colliders.len();
}

// Test function to verify raycasting works
function testRaycast() {
  if (!rapierInstance || !worldInstance) {
    console.log('[Physics] Test: Cannot test, physics not ready');
    return;
  }

  // Test 1: Cast from y=50 down, should hit test platform at y=10
  const ray1 = new rapierInstance.Ray({ x: 0, y: 50, z: 0 }, { x: 0, y: -1, z: 0 });
  const hit1 = worldInstance.castRay(ray1, 100, true);
  console.log('[Physics] Test 1 (y=50 down):', hit1 ? `hit at distance ${hit1.timeOfImpact.toFixed(2)} (ground y=${(50 - hit1.timeOfImpact).toFixed(2)})` : 'NO HIT');

  // Test 2: Cast from y=5 down, should hit ground at y=0
  const ray2 = new rapierInstance.Ray({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 });
  const hit2 = worldInstance.castRay(ray2, 100, true);
  console.log('[Physics] Test 2 (y=5 down):', hit2 ? `hit at distance ${hit2.timeOfImpact.toFixed(2)} (ground y=${(5 - hit2.timeOfImpact).toFixed(2)})` : 'NO HIT');

  // Test 3: Cast from y=1 down, should hit ground at y=0
  const ray3 = new rapierInstance.Ray({ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 });
  const hit3 = worldInstance.castRay(ray3, 100, true);
  console.log('[Physics] Test 3 (y=1 down):', hit3 ? `hit at distance ${hit3.timeOfImpact.toFixed(2)} (ground y=${(1 - hit3.timeOfImpact).toFixed(2)})` : 'NO HIT');
}
