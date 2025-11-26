import RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3 } from '@voxel-strike/shared';
import { GRAVITY } from '@voxel-strike/shared';

let isInitialized = false;

export async function initRapier(): Promise<void> {
  if (isInitialized) return;
  await RAPIER.init();
  isInitialized = true;
}

export interface PhysicsConfig {
  gravity?: number;
  timestep?: number;
}

export class PhysicsWorld {
  private world: RAPIER.World;
  private bodies: Map<string, RAPIER.RigidBody> = new Map();
  private colliders: Map<string, RAPIER.Collider> = new Map();

  constructor(config: PhysicsConfig = {}) {
    const gravity = { x: 0, y: config.gravity ?? GRAVITY, z: 0 };
    this.world = new RAPIER.World(gravity);
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  createStaticBody(
    id: string,
    position: Vec3,
    halfExtents: Vec3
  ): void {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z);
    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      halfExtents.x,
      halfExtents.y,
      halfExtents.z
    );
    const collider = this.world.createCollider(colliderDesc, body);

    this.bodies.set(id, body);
    this.colliders.set(id, collider);
  }

  createDynamicBody(
    id: string,
    position: Vec3,
    radius: number,
    height: number
  ): RAPIER.RigidBody {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(0.1)
      .setAngularDamping(1.0)
      .lockRotations();

    const body = this.world.createRigidBody(bodyDesc);

    // Capsule collider for character
    const colliderDesc = RAPIER.ColliderDesc.capsule(height / 2 - radius, radius)
      .setFriction(0.1)
      .setRestitution(0);

    const collider = this.world.createCollider(colliderDesc, body);

    this.bodies.set(id, body);
    this.colliders.set(id, collider);

    return body;
  }

  createKinematicBody(
    id: string,
    position: Vec3,
    radius: number,
    height: number
  ): RAPIER.RigidBody {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(position.x, position.y, position.z);

    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.capsule(height / 2 - radius, radius);
    const collider = this.world.createCollider(colliderDesc, body);

    this.bodies.set(id, body);
    this.colliders.set(id, collider);

    return body;
  }

  getBody(id: string): RAPIER.RigidBody | undefined {
    return this.bodies.get(id);
  }

  removeBody(id: string): void {
    const body = this.bodies.get(id);
    if (body) {
      this.world.removeRigidBody(body);
      this.bodies.delete(id);
    }
    this.colliders.delete(id);
  }

  raycast(
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
    excludeId?: string
  ): RaycastHit | null {
    const ray = new RAPIER.Ray(origin, direction);
    
    const hit = this.world.castRay(
      ray,
      maxDistance,
      true,
      undefined,
      undefined,
      excludeId ? this.colliders.get(excludeId) : undefined
    );

    if (hit) {
      const point = ray.pointAt(hit.timeOfImpact);
      const collider = hit.collider;
      
      // Get normal using shape cast
      const normal = this.getNormalAtPoint(collider, point);

      return {
        point: { x: point.x, y: point.y, z: point.z },
        normal,
        distance: hit.timeOfImpact,
      };
    }

    return null;
  }

  sphereCast(
    origin: Vec3,
    radius: number,
    direction: Vec3,
    maxDistance: number,
    excludeId?: string
  ): RaycastHit | null {
    // Use raycast with adjusted origin for simplicity
    // A proper implementation would use world.castShape with proper Rapier API
    const adjustedOrigin = {
      x: origin.x,
      y: origin.y - radius,
      z: origin.z,
    };
    
    return this.raycast(adjustedOrigin, direction, maxDistance + radius, excludeId);
  }

  private getNormalAtPoint(collider: RAPIER.Collider, point: Vec3): Vec3 {
    // Project point to find closest point on surface
    const projected = collider.projectPoint(point, true);
    
    if (!projected) {
      return { x: 0, y: 1, z: 0 };
    }
    
    if (projected.isInside) {
      // Point is inside, estimate normal from center
      const center = collider.translation();
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      const dz = point.z - center.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      if (len > 0) {
        return { x: dx / len, y: dy / len, z: dz / len };
      }
      return { x: 0, y: 1, z: 0 };
    }

    // Calculate normal from point to projected point
    const dx = point.x - projected.point.x;
    const dy = point.y - projected.point.y;
    const dz = point.z - projected.point.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (len > 0.001) {
      return { x: dx / len, y: dy / len, z: dz / len };
    }

    return { x: 0, y: 1, z: 0 };
  }

  getWorld(): RAPIER.World {
    return this.world;
  }

  destroy(): void {
    this.bodies.clear();
    this.colliders.clear();
  }
}

export interface RaycastHit {
  point: Vec3;
  normal: Vec3;
  distance: number;
}

