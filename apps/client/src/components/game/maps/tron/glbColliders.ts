/**
 * GLB Collider Loader - Creates Rapier colliders from GLB collision properties
 *
 * Reads the 'collision' custom property from Blender objects (exported in GLB extras):
 * - "box": Creates a cuboid collider from the object's bounding box
 * - "trimesh": Creates a trimesh collider from the exact geometry
 * - "hull": Creates a convex hull collider
 * - "none": No collision (decorative object)
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

interface ColliderStats {
  box: number;
  trimesh: number;
  hull: number;
  skipped: number;
}

/**
 * Create Rapier colliders from a GLB scene based on collision properties
 */
export function createCollidersFromGLB(
  scene: THREE.Object3D,
  world: RAPIER.World,
  rapier: typeof RAPIER
): ColliderStats {
  const stats: ColliderStats = { box: 0, trimesh: 0, hull: 0, skipped: 0 };

  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    // Get collision type from userData (populated from GLB extras)
    const collisionType = child.userData?.collision as string | undefined;

    if (!collisionType || collisionType === 'none') {
      stats.skipped++;
      return;
    }

    try {
      switch (collisionType) {
        case 'box':
          createBoxCollider(child, world, rapier);
          stats.box++;
          break;
        case 'trimesh':
          createTrimeshCollider(child, world, rapier);
          stats.trimesh++;
          break;
        case 'hull':
          createHullCollider(child, world, rapier);
          stats.hull++;
          break;
        default:
          console.warn(`[GLBColliders] Unknown collision type "${collisionType}" on ${child.name}`);
          stats.skipped++;
      }
    } catch (error) {
      console.error(`[GLBColliders] Failed to create collider for ${child.name}:`, error);
      stats.skipped++;
    }
  });

  console.log(
    `[GLBColliders] Created colliders - Box: ${stats.box}, Trimesh: ${stats.trimesh}, Hull: ${stats.hull}, Skipped: ${stats.skipped}`
  );

  return stats;
}

/**
 * Create a box collider from the mesh's world-space bounding box
 */
function createBoxCollider(
  mesh: THREE.Mesh,
  world: RAPIER.World,
  rapier: typeof RAPIER
): void {
  // Compute world matrix to get actual position/rotation/scale
  mesh.updateWorldMatrix(true, false);

  // Get geometry bounding box in local space
  const geometry = mesh.geometry;
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox();
  }

  if (!geometry.boundingBox) {
    console.warn(`[GLBColliders] No bounding box for ${mesh.name}`);
    return;
  }

  // Get the bounding box in world space
  const bbox = geometry.boundingBox.clone();
  bbox.applyMatrix4(mesh.matrixWorld);

  // Calculate center and half-extents
  const center = new THREE.Vector3();
  bbox.getCenter(center);

  const size = new THREE.Vector3();
  bbox.getSize(size);

  const halfExtents = {
    x: size.x / 2,
    y: size.y / 2,
    z: size.z / 2,
  };

  // Minimum thickness for colliders (important for flat planes like floors)
  const MIN_HALF_EXTENT = 0.25; // 0.5 units total thickness minimum

  // Detect flat planes (one dimension is very thin)
  const isFlatX = halfExtents.x < 0.01;
  const isFlatY = halfExtents.y < 0.01;
  const isFlatZ = halfExtents.z < 0.01;

  // For flat horizontal planes (floors), give them thickness below the surface
  // so players stand ON the floor, not inside it
  let adjustedCenter = { x: center.x, y: center.y, z: center.z };
  let adjustedHalfExtents = { ...halfExtents };

  if (isFlatY && !isFlatX && !isFlatZ) {
    // Horizontal plane (floor/ceiling) - thin in Y
    adjustedHalfExtents.y = MIN_HALF_EXTENT;
    // Move center down so top of collider is at original surface
    adjustedCenter.y = center.y - MIN_HALF_EXTENT;
    console.log(
      `[GLBColliders] Flat floor "${mesh.name}": center=${center.y.toFixed(2)} -> ${adjustedCenter.y.toFixed(2)}, ` +
      `halfY=${halfExtents.y.toFixed(3)} -> ${adjustedHalfExtents.y.toFixed(2)}, ` +
      `size=${size.x.toFixed(1)}x${size.z.toFixed(1)}`
    );
  } else if (isFlatX) {
    adjustedHalfExtents.x = MIN_HALF_EXTENT;
  } else if (isFlatZ) {
    adjustedHalfExtents.z = MIN_HALF_EXTENT;
  }

  // Ensure minimum size on all dimensions
  adjustedHalfExtents.x = Math.max(adjustedHalfExtents.x, 0.01);
  adjustedHalfExtents.y = Math.max(adjustedHalfExtents.y, 0.01);
  adjustedHalfExtents.z = Math.max(adjustedHalfExtents.z, 0.01);

  // Create fixed rigid body at the adjusted center position
  const bodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(
    adjustedCenter.x,
    adjustedCenter.y,
    adjustedCenter.z
  );
  const body = world.createRigidBody(bodyDesc);

  // Create cuboid collider
  const colliderDesc = rapier.ColliderDesc.cuboid(
    adjustedHalfExtents.x,
    adjustedHalfExtents.y,
    adjustedHalfExtents.z
  );
  world.createCollider(colliderDesc, body);
}

/**
 * Create a trimesh collider from the mesh's geometry
 * This is more accurate but more expensive than box colliders
 */
function createTrimeshCollider(
  mesh: THREE.Mesh,
  world: RAPIER.World,
  rapier: typeof RAPIER
): void {
  mesh.updateWorldMatrix(true, false);

  const geometry = mesh.geometry;

  // Get position attribute
  const positionAttr = geometry.getAttribute('position');
  if (!positionAttr) {
    console.warn(`[GLBColliders] No position attribute for ${mesh.name}`);
    return;
  }

  // Transform vertices to world space
  const vertices = new Float32Array(positionAttr.count * 3);
  const vertex = new THREE.Vector3();

  for (let i = 0; i < positionAttr.count; i++) {
    vertex.fromBufferAttribute(positionAttr, i);
    vertex.applyMatrix4(mesh.matrixWorld);
    vertices[i * 3] = vertex.x;
    vertices[i * 3 + 1] = vertex.y;
    vertices[i * 3 + 2] = vertex.z;
  }

  // Get indices (or generate them if not indexed)
  let indices: Uint32Array;
  if (geometry.index) {
    indices = new Uint32Array(geometry.index.array);
  } else {
    // Non-indexed geometry - create sequential indices
    indices = new Uint32Array(positionAttr.count);
    for (let i = 0; i < positionAttr.count; i++) {
      indices[i] = i;
    }
  }

  // Create fixed rigid body at origin (vertices are in world space)
  const bodyDesc = rapier.RigidBodyDesc.fixed();
  const body = world.createRigidBody(bodyDesc);

  // Create trimesh collider
  const colliderDesc = rapier.ColliderDesc.trimesh(vertices, indices);
  if (colliderDesc) {
    world.createCollider(colliderDesc, body);
  } else {
    console.warn(`[GLBColliders] Failed to create trimesh for ${mesh.name}`);
  }
}

/**
 * Create a convex hull collider from the mesh's geometry
 * Good middle-ground between box and trimesh
 */
function createHullCollider(
  mesh: THREE.Mesh,
  world: RAPIER.World,
  rapier: typeof RAPIER
): void {
  mesh.updateWorldMatrix(true, false);

  const geometry = mesh.geometry;
  const positionAttr = geometry.getAttribute('position');

  if (!positionAttr) {
    console.warn(`[GLBColliders] No position attribute for ${mesh.name}`);
    return;
  }

  // Transform vertices to world space
  const vertices = new Float32Array(positionAttr.count * 3);
  const vertex = new THREE.Vector3();

  for (let i = 0; i < positionAttr.count; i++) {
    vertex.fromBufferAttribute(positionAttr, i);
    vertex.applyMatrix4(mesh.matrixWorld);
    vertices[i * 3] = vertex.x;
    vertices[i * 3 + 1] = vertex.y;
    vertices[i * 3 + 2] = vertex.z;
  }

  // Create fixed rigid body at origin
  const bodyDesc = rapier.RigidBodyDesc.fixed();
  const body = world.createRigidBody(bodyDesc);

  // Create convex hull collider
  const colliderDesc = rapier.ColliderDesc.convexHull(vertices);
  if (colliderDesc) {
    world.createCollider(colliderDesc, body);
  } else {
    // Fall back to box if hull fails
    console.warn(`[GLBColliders] Hull failed for ${mesh.name}, falling back to box`);
    createBoxCollider(mesh, world, rapier);
  }
}
