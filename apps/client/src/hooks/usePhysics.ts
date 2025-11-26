import { useEffect, useRef, useState } from 'react';
import RAPIER from '@dimforge/rapier3d-compat';

interface PhysicsContext {
  world: RAPIER.World | null;
  playerBody: RAPIER.RigidBody | null;
  isReady: boolean;
}

let rapierInstance: typeof RAPIER | null = null;
let worldInstance: RAPIER.World | null = null;

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
        const gravity = { x: 0, y: -30, z: 0 };
        worldRef.current = new RAPIER.World(gravity);
        worldInstance = worldRef.current;

        // Create ground
        const groundDesc = RAPIER.ColliderDesc.cuboid(50, 0.5, 50)
          .setTranslation(0, -0.5, 0);
        worldRef.current.createCollider(groundDesc);

        // Create player rigid body
        const playerDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(0, 2, 0);
        playerBodyRef.current = worldRef.current.createRigidBody(playerDesc);

        // Create player collider
        const playerColliderDesc = RAPIER.ColliderDesc.capsule(0.5, 0.4)
          .setTranslation(0, 0.9, 0);
        worldRef.current.createCollider(playerColliderDesc, playerBodyRef.current);

        // Create arena geometry
        createArenaColliders(worldRef.current, RAPIER);

        setIsReady(true);
      } catch (error) {
        console.error('Failed to initialize physics:', error);
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

function createArenaColliders(world: RAPIER.World, rapier: typeof RAPIER) {
  // Wall colliders
  const walls = [
    { pos: [0, 2.5, -45], size: [40, 2.5, 1.5] },
    { pos: [0, 2.5, 45], size: [40, 2.5, 1.5] },
    { pos: [-50, 10, 0], size: [0.5, 10, 50] },
    { pos: [50, 10, 0], size: [0.5, 10, 50] },
  ];

  for (const wall of walls) {
    const desc = rapier.ColliderDesc.cuboid(
      wall.size[0] as number,
      wall.size[1] as number,
      wall.size[2] as number
    ).setTranslation(
      wall.pos[0] as number,
      wall.pos[1] as number,
      wall.pos[2] as number
    );
    world.createCollider(desc);
  }

  // Platform colliders
  const platforms = [
    { pos: [-25, 6, -20], size: [4, 0.5, 4] },
    { pos: [25, 6, -20], size: [4, 0.5, 4] },
    { pos: [-25, 6, 20], size: [4, 0.5, 4] },
    { pos: [25, 6, 20], size: [4, 0.5, 4] },
    { pos: [0, 10.5, 0], size: [5, 0.5, 5] },
  ];

  for (const platform of platforms) {
    const desc = rapier.ColliderDesc.cuboid(
      platform.size[0] as number,
      platform.size[1] as number,
      platform.size[2] as number
    ).setTranslation(
      platform.pos[0] as number,
      platform.pos[1] as number,
      platform.pos[2] as number
    );
    world.createCollider(desc);
  }

  // Central tower
  const towerDesc = rapier.ColliderDesc.cuboid(3, 5, 3)
    .setTranslation(0, 5, 0);
  world.createCollider(towerDesc);

  // Team bases
  const bases = [
    { pos: [-40, 0.5, 0], size: [6, 0.5, 6] },
    { pos: [40, 0.5, 0], size: [6, 0.5, 6] },
  ];

  for (const base of bases) {
    const desc = rapier.ColliderDesc.cuboid(
      base.size[0] as number,
      base.size[1] as number,
      base.size[2] as number
    ).setTranslation(
      base.pos[0] as number,
      base.pos[1] as number,
      base.pos[2] as number
    );
    world.createCollider(desc);
  }
}

export function getPhysicsWorld(): RAPIER.World | null {
  return worldInstance;
}

// Utility function for raycasting
export function raycast(
  world: RAPIER.World,
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  maxDistance: number
): { point: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number }; distance: number } | null {
  const ray = new RAPIER.Ray(origin, direction);
  const hit = world.castRay(ray, maxDistance, true);

  if (hit) {
    const point = ray.pointAt(hit.timeOfImpact);
    const collider = hit.collider;
    const normal = collider.castRayAndGetNormal(ray, maxDistance, true)?.normal ?? { x: 0, y: 1, z: 0 };

    return {
      point: { x: point.x, y: point.y, z: point.z },
      normal: { x: normal.x, y: normal.y, z: normal.z },
      distance: hit.timeOfImpact,
    };
  }

  return null;
}

