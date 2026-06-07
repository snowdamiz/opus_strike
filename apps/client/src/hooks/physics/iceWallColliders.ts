import RAPIER from '@dimforge/rapier3d-compat';

// ============================================================================
// TEMPORARY WALL COLLIDERS - Dynamic colliders for deployable ability walls
// ============================================================================

interface TemporaryWallColliderData {
  rigidBody: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  createdAt: number;
}

const temporaryWallColliders = new Map<string, TemporaryWallColliderData>();

// These will be set by the main physics module
let rapierInstance: typeof RAPIER | null = null;
let worldInstance: RAPIER.World | null = null;

/**
 * Initialize the temporary wall collider system with physics instances
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
 * Add a collider for a temporary wall segment
 * @param id - Unique identifier for this wall segment
 * @param x - X position (center of wall)
 * @param y - Y position (base of wall)
 * @param z - Z position (center of wall)
 * @param rotation - Y rotation in radians
 * @param width - Wall width
 * @param height - Wall height
 * @param depth - Wall thickness
 */
export function addTemporaryWallCollider(
  id: string,
  x: number, y: number, z: number,
  rotation: number,
  width: number, height: number, depth: number
): boolean {
  if (!rapierInstance || !worldInstance) return false;

  // Don't add duplicate
  if (temporaryWallColliders.has(id)) return true;

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

    temporaryWallColliders.set(id, {
      rigidBody,
      collider,
      createdAt: Date.now(),
    });

    return true;
  } catch (e) {
    console.error('[Physics] Failed to add temporary wall collider:', e);
    return false;
  }
}

/**
 * Remove a temporary wall collider
 */
export function removeTemporaryWallCollider(id: string): boolean {
  if (!worldInstance) return false;

  const data = temporaryWallColliders.get(id);
  if (!data) return false;

  try {
    worldInstance.removeCollider(data.collider, true);
    worldInstance.removeRigidBody(data.rigidBody);
    temporaryWallColliders.delete(id);
    return true;
  } catch (e) {
    console.error('[Physics] Failed to remove temporary wall collider:', e);
    temporaryWallColliders.delete(id);
    return false;
  }
}

/**
 * Remove all expired temporary wall colliders
 * @param maxAge - Maximum age in milliseconds before removal
 * @param idPrefix - Optional ID prefix for cleaning a specific ability family
 */
export function cleanupExpiredTemporaryWallColliders(maxAge: number, idPrefix?: string): number {
  if (!worldInstance) return 0;

  const now = Date.now();
  let removed = 0;

  for (const [id, data] of temporaryWallColliders) {
    if (idPrefix && !id.startsWith(idPrefix)) continue;

    if (now - data.createdAt > maxAge) {
      try {
        worldInstance.removeCollider(data.collider, true);
        worldInstance.removeRigidBody(data.rigidBody);
        temporaryWallColliders.delete(id);
        removed++;
      } catch (e) {
        // Collider may already be removed
        temporaryWallColliders.delete(id);
      }
    }
  }

  return removed;
}

/**
 * Remove all temporary wall colliders (cleanup on game end)
 */
export function clearAllTemporaryWallColliders(idPrefix?: string): void {
  if (!worldInstance) {
    if (!idPrefix) {
      temporaryWallColliders.clear();
    } else {
      for (const id of temporaryWallColliders.keys()) {
        if (id.startsWith(idPrefix)) temporaryWallColliders.delete(id);
      }
    }
    return;
  }

  for (const [id, data] of temporaryWallColliders) {
    if (idPrefix && !id.startsWith(idPrefix)) continue;

    try {
      worldInstance.removeCollider(data.collider, true);
      worldInstance.removeRigidBody(data.rigidBody);
    } catch (e) {
      // Ignore errors during cleanup
    }
    temporaryWallColliders.delete(id);
  }
}

/**
 * Get the number of active temporary wall colliders
 */
export function getTemporaryWallColliderCount(idPrefix?: string): number {
  if (!idPrefix) return temporaryWallColliders.size;

  let count = 0;
  for (const id of temporaryWallColliders.keys()) {
    if (id.startsWith(idPrefix)) count++;
  }
  return count;
}

export const addIceWallCollider = addTemporaryWallCollider;
export const removeIceWallCollider = removeTemporaryWallCollider;
export const cleanupExpiredIceWallColliders = (maxAge: number): number =>
  cleanupExpiredTemporaryWallColliders(maxAge, 'icewall_');
export const clearAllIceWallColliders = (): void =>
  clearAllTemporaryWallColliders('icewall_');
export const getIceWallColliderCount = (): number =>
  getTemporaryWallColliderCount('icewall_');
