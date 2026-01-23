import { useEffect, useRef, useState } from 'react';
import RAPIER from '@dimforge/rapier3d-compat';
import { createMapColliders } from '../components/game/maps/sci-fi-ctf/colliders';

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
        const RAPIER = await initPhysics();

        if (!mounted) return;

        // Create physics world with gravity
        const gravity = { x: 0, y: -20, z: 0 }; // Reduced for floatier feel
        worldRef.current = new RAPIER.World(gravity);
        worldInstance = worldRef.current;

        // Create ground as a fixed rigid body - positioned LOW as safety net
        // The actual terrain from GLB is higher (around y=10-20)
        const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -50, 0);
        const groundBody = worldRef.current.createRigidBody(groundBodyDesc);
        const groundColliderDesc = RAPIER.ColliderDesc.cuboid(200, 1, 200);
        worldRef.current.createCollider(groundColliderDesc, groundBody);

        // Note: No test platform needed - terrain from GLB provides collision

        // Create player rigid body
        const playerDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(0, 50, 0);
        playerBodyRef.current = worldRef.current.createRigidBody(playerDesc);

        // Create player collider
        const playerColliderDesc = RAPIER.ColliderDesc.capsule(0.5, 0.4)
          .setTranslation(0, 0.9, 0);
        worldRef.current.createCollider(playerColliderDesc, playerBodyRef.current);

        // Create all map colliders (ground floors, walls, platforms, tunnels)
        createMapColliders(worldRef.current, RAPIER);

        // IMPORTANT: Step the world to initialize collision structures
        // This is required for raycasts to work in Rapier
        worldRef.current.step();
        worldRef.current.step(); // Step twice to be safe
        
        // Also update the internal structures for queries
        worldRef.current.updateSceneQueries();

        physicsReady = true;
        setIsReady(true);
        
        // Initialize ice wall system with physics instances
        initializeIceWallSystem();
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

// Directional raycast from world instance (for use outside component)
// Returns hit point, normal, and whether the surface is walkable
export function raycastDirection(
  originX: number, originY: number, originZ: number,
  dirX: number, dirY: number, dirZ: number,
  maxDistance: number
): { 
  hit: boolean; 
  point: { x: number; y: number; z: number }; 
  normal: { x: number; y: number; z: number }; 
  distance: number;
  isWalkable: boolean;
} | null {
  if (!rapierInstance || !worldInstance) {
    return null;
  }
  
  try {
    const origin = { x: originX, y: originY, z: originZ };
    const direction = { x: dirX, y: dirY, z: dirZ };
    const ray = new rapierInstance.Ray(origin, direction);
    
    const hit = worldInstance.castRay(ray, maxDistance, true);
    
    if (hit) {
      const hitDistance = hit.timeOfImpact;
      const hitPoint = ray.pointAt(hitDistance);
      
      // Get surface normal
      let normal = { x: 0, y: 1, z: 0 };
      try {
        const hitWithNormal = hit.collider.castRayAndGetNormal(ray, maxDistance, true);
        if (hitWithNormal) {
          normal = {
            x: hitWithNormal.normal.x,
            y: hitWithNormal.normal.y,
            z: hitWithNormal.normal.z
          };
        }
      } catch {
        // Use default normal
      }
      
      // Check if surface is walkable (not too steep)
      const isWalkable = normal.y >= MAX_SLOPE_DOT;
      
      return {
        hit: true,
        point: { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z },
        normal,
        distance: hitDistance,
        isWalkable
      };
    }
  } catch (error) {
    console.error('[Physics] raycastDirection error:', error);
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

// Check if a teleport destination is valid (not inside geometry)
// Returns: { valid: boolean, adjustedPosition?: { x, y, z }, reason?: string }
export function validateTeleportDestination(
  targetX: number, 
  targetY: number, 
  targetZ: number,
  playerHeight: number = 1.8,
  playerRadius: number = 0.4
): { valid: boolean; adjustedPosition?: { x: number; y: number; z: number }; reason?: string } {
  if (!rapierInstance || !worldInstance) {
    return { valid: true }; // Allow if physics not ready
  }

  try {
    const playerHalfHeight = playerHeight / 2;
    const feetY = targetY - playerHalfHeight;
    const headY = targetY + playerHalfHeight;
    const centerY = targetY;

    // 1. Check if there's solid ground below the target
    const groundCheck = checkGroundWithNormal(targetX, targetY + 5, targetZ, playerHeight + 10);
    if (!groundCheck) {
      return { valid: false, reason: 'No ground below target' };
    }

    // Use ground-adjusted Y for all further checks
    const adjustedFeetY = groundCheck.groundY;
    const adjustedCenterY = groundCheck.groundY + playerHalfHeight;
    const adjustedHeadY = groundCheck.groundY + playerHeight;

    // 2. Check for geometry at CENTER and HEAD heights only (skip feet to avoid ground hits)
    const checkPoints = [
      { y: adjustedCenterY, label: 'center' },
      { y: adjustedHeadY - 0.3, label: 'head' },
    ];

    // 8 directions for coverage
    const directions: { x: number; z: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      directions.push({ x: Math.cos(angle), z: Math.sin(angle) });
    }

    // Cast rays FROM the target position OUTWARD
    // Only reject if VERY close hit (definitely inside solid geometry)
    for (const point of checkPoints) {
      for (const dir of directions) {
        const ray = new rapierInstance.Ray(
          { x: targetX, y: point.y, z: targetZ },
          { x: dir.x, y: 0, z: dir.z }
        );
        const hit = worldInstance.castRay(ray, playerRadius + 0.3, true);
        
        // Only reject if extremely close (less than 20cm) - definitely inside
        if (hit && hit.timeOfImpact < 0.2) {
          return { 
            valid: false, 
            reason: `Inside solid geometry at ${point.label}` 
          };
        }
      }
    }

    // 3. Simple up ray check - make sure there's headroom
    const rayUp = new rapierInstance.Ray(
      { x: targetX, y: adjustedFeetY + 0.3, z: targetZ },
      { x: 0, y: 1, z: 0 }
    );
    const hitUp = worldInstance.castRay(rayUp, playerHeight - 0.2, true);
    if (hitUp && hitUp.timeOfImpact < playerHeight - 0.5) {
      return { valid: false, reason: 'Not enough headroom' };
    }

    // 5. Ensure the ground isn't too far below original target
    if (groundCheck.groundY < feetY - 5) {
      return { valid: false, reason: 'Ground too far below' };
    }

    // 6. Final adjusted position
    const adjustedY = groundCheck.groundY + playerHalfHeight + 0.05;
    
    return { 
      valid: true, 
      adjustedPosition: { x: targetX, y: adjustedY, z: targetZ } 
    };
  } catch (e) {
    console.error('[Physics] validateTeleportDestination error:', e);
    return { valid: false, reason: 'Validation error' }; // Block on error to be safe
  }
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

// ============================================================================
// ICE WALL COLLIDERS - Re-exported from separate module
// ============================================================================

import {
  initIceWallSystem,
  updateIceWallWorld,
  addIceWallCollider,
  removeIceWallCollider,
  cleanupExpiredIceWallColliders,
  clearAllIceWallColliders,
  getIceWallColliderCount,
} from './physics/iceWallColliders';

// Re-export ice wall functions for backwards compatibility
export {
  addIceWallCollider,
  removeIceWallCollider,
  cleanupExpiredIceWallColliders,
  clearAllIceWallColliders,
  getIceWallColliderCount,
};

// Initialize ice wall system when physics is ready (called after world creation)
function initializeIceWallSystem() {
  if (rapierInstance && worldInstance) {
    initIceWallSystem(rapierInstance, worldInstance);
  }
}
