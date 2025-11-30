import RAPIER from '@dimforge/rapier3d-compat';

// ============================================================================
// ICE WALL COLLIDERS - Dynamic colliders for Glacier's E ability
// ============================================================================

interface IceWallColliderData {
  rigidBody: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  createdAt: number;
}

const iceWallColliders = new Map<string, IceWallColliderData>();

// These will be set by the main physics module
let rapierInstance: typeof RAPIER | null = null;
let worldInstance: RAPIER.World | null = null;

/**
 * Initialize the ice wall collider system with physics instances
 */
export function initIceWallSystem(rapier: typeof RAPIER, world: RAPIER.World): void {
  rapierInstance = rapier;
  worldInstance = world;
}

/**
 * Update world instance (called when world changes)
 */
export function updateIceWallWorld(world: RAPIER.World | null): void {
  worldInstance = world;
}

/**
 * Add a collider for an ice wall segment
 * @param id - Unique identifier for this wall segment
 * @param x - X position (center of wall)
 * @param y - Y position (base of wall)
 * @param z - Z position (center of wall)
 * @param rotation - Y rotation in radians
 * @param width - Wall width
 * @param height - Wall height
 * @param depth - Wall thickness
 */
export function addIceWallCollider(
  id: string,
  x: number, y: number, z: number,
  rotation: number,
  width: number, height: number, depth: number
): boolean {
  if (!rapierInstance || !worldInstance) return false;

  // Don't add duplicate
  if (iceWallColliders.has(id)) return true;

  try {
    // Create fixed rigid body at wall position
    // Position at center of wall (y + height/2)
    const bodyDesc = rapierInstance.RigidBodyDesc.fixed()
      .setTranslation(x, y + height / 2, z)
      .setRotation({ x: 0, y: Math.sin(rotation / 2), z: 0, w: Math.cos(rotation / 2) });

    const rigidBody = worldInstance.createRigidBody(bodyDesc);

    // Create cuboid collider (half-extents)
    const colliderDesc = rapierInstance.ColliderDesc.cuboid(width / 2, height / 2, depth / 2);
    const collider = worldInstance.createCollider(colliderDesc, rigidBody);

    // CRITICAL: Update scene queries so raycasts can detect this new collider
    // Without this, dynamically added colliders are invisible to raycasts
    worldInstance.updateSceneQueries();

    iceWallColliders.set(id, {
      rigidBody,
      collider,
      createdAt: Date.now(),
    });

    return true;
  } catch (e) {
    console.error('[Physics] Failed to add ice wall collider:', e);
    return false;
  }
}

/**
 * Remove an ice wall collider
 */
export function removeIceWallCollider(id: string): boolean {
  if (!worldInstance) return false;

  const data = iceWallColliders.get(id);
  if (!data) return false;

  try {
    worldInstance.removeCollider(data.collider, true);
    worldInstance.removeRigidBody(data.rigidBody);
    iceWallColliders.delete(id);
    return true;
  } catch (e) {
    console.error('[Physics] Failed to remove ice wall collider:', e);
    return false;
  }
}

/**
 * Remove all expired ice wall colliders
 * @param maxAge - Maximum age in milliseconds before removal
 */
export function cleanupExpiredIceWallColliders(maxAge: number): number {
  if (!worldInstance) return 0;

  const now = Date.now();
  let removed = 0;

  for (const [id, data] of iceWallColliders) {
    if (now - data.createdAt > maxAge) {
      try {
        worldInstance.removeCollider(data.collider, true);
        worldInstance.removeRigidBody(data.rigidBody);
        iceWallColliders.delete(id);
        removed++;
      } catch (e) {
        // Collider may already be removed
        iceWallColliders.delete(id);
      }
    }
  }

  return removed;
}

/**
 * Remove all ice wall colliders (cleanup on game end)
 */
export function clearAllIceWallColliders(): void {
  if (!worldInstance) {
    iceWallColliders.clear();
    return;
  }

  for (const [_id, data] of iceWallColliders) {
    try {
      worldInstance.removeCollider(data.collider, true);
      worldInstance.removeRigidBody(data.rigidBody);
    } catch (e) {
      // Ignore errors during cleanup
    }
  }
  iceWallColliders.clear();
}

/**
 * Get the number of active ice wall colliders
 */
export function getIceWallColliderCount(): number {
  return iceWallColliders.size;
}

