import type { Vec3 } from '@voxel-strike/shared';
import { vec3Scale, vec3Add } from '@voxel-strike/shared';
import type { PhysicsWorld, RaycastHit } from './PhysicsWorld.js';
import { 
  GROUND_CHECK_DISTANCE, 
  GROUND_NORMAL_THRESHOLD,
  WALL_DETECT_DISTANCE,
  PLAYER_RADIUS,
} from '@voxel-strike/shared';

export interface GroundInfo {
  isGrounded: boolean;
  normal: Vec3;
  distance: number;
  angle: number;
}

export interface WallInfo {
  isNearWall: boolean;
  wallNormal: Vec3;
  wallPoint: Vec3;
  side: 'left' | 'right' | 'front' | null;
  distance: number;
}

export function checkGround(
  world: PhysicsWorld,
  position: Vec3,
  playerId: string
): GroundInfo {
  const origin = { ...position };
  const direction = { x: 0, y: -1, z: 0 };
  
  const hit = world.sphereCast(
    origin,
    PLAYER_RADIUS * 0.9,
    direction,
    GROUND_CHECK_DISTANCE + 0.5,
    playerId
  );

  if (hit && hit.distance <= GROUND_CHECK_DISTANCE + 0.5) {
    const angle = Math.acos(Math.max(-1, Math.min(1, hit.normal.y)));
    
    return {
      isGrounded: hit.normal.y >= GROUND_NORMAL_THRESHOLD,
      normal: hit.normal,
      distance: hit.distance,
      angle: angle * (180 / Math.PI),
    };
  }

  return {
    isGrounded: false,
    normal: { x: 0, y: 1, z: 0 },
    distance: Infinity,
    angle: 0,
  };
}

export function checkWalls(
  world: PhysicsWorld,
  position: Vec3,
  forward: Vec3,
  right: Vec3,
  playerId: string
): WallInfo {
  const origin = { x: position.x, y: position.y + 0.5, z: position.z };
  
  // Check multiple directions
  const directions = [
    { dir: right, side: 'right' as const },
    { dir: vec3Scale(right, -1), side: 'left' as const },
    { dir: forward, side: 'front' as const },
  ];

  let closestHit: RaycastHit | null = null;
  let closestSide: 'left' | 'right' | 'front' | null = null;
  let closestDistance = WALL_DETECT_DISTANCE;

  for (const { dir, side } of directions) {
    const hit = world.raycast(origin, dir, WALL_DETECT_DISTANCE, playerId);
    
    if (hit && hit.distance < closestDistance) {
      // Check if this is a valid wall (mostly vertical)
      const verticalness = Math.abs(hit.normal.y);
      if (verticalness < 0.3) {
        closestHit = hit;
        closestSide = side;
        closestDistance = hit.distance;
      }
    }
  }

  if (closestHit && closestSide) {
    return {
      isNearWall: true,
      wallNormal: closestHit.normal,
      wallPoint: closestHit.point,
      side: closestSide,
      distance: closestHit.distance,
    };
  }

  return {
    isNearWall: false,
    wallNormal: { x: 0, y: 0, z: 0 },
    wallPoint: { x: 0, y: 0, z: 0 },
    side: null,
    distance: Infinity,
  };
}

export function checkLedge(
  world: PhysicsWorld,
  position: Vec3,
  forward: Vec3,
  playerId: string
): { canMantle: boolean; ledgePoint: Vec3; ledgeHeight: number } {
  // Cast ray forward to find wall
  const forwardOrigin = { x: position.x, y: position.y + 0.5, z: position.z };
  const wallHit = world.raycast(forwardOrigin, forward, 1.5, playerId);

  if (!wallHit) {
    return { canMantle: false, ledgePoint: position, ledgeHeight: 0 };
  }

  // Cast ray down from above the wall to find ledge
  const aboveWall = {
    x: position.x + forward.x * 0.8,
    y: position.y + 2.5,
    z: position.z + forward.z * 0.8,
  };
  
  const ledgeHit = world.raycast(aboveWall, { x: 0, y: -1, z: 0 }, 2.5, playerId);

  if (ledgeHit && ledgeHit.point.y > position.y + 0.5 && ledgeHit.point.y < position.y + 2.5) {
    // Check if there's space above the ledge
    const spaceCheck = world.raycast(
      { x: ledgeHit.point.x, y: ledgeHit.point.y + 0.1, z: ledgeHit.point.z },
      { x: 0, y: 1, z: 0 },
      2,
      playerId
    );

    if (!spaceCheck || spaceCheck.distance > 1.8) {
      return {
        canMantle: true,
        ledgePoint: ledgeHit.point,
        ledgeHeight: ledgeHit.point.y - position.y,
      };
    }
  }

  return { canMantle: false, ledgePoint: position, ledgeHeight: 0 };
}

export function checkGrappleTarget(
  world: PhysicsWorld,
  position: Vec3,
  direction: Vec3,
  maxDistance: number,
  playerId: string
): { hit: boolean; point: Vec3; distance: number } {
  const hit = world.raycast(position, direction, maxDistance, playerId);

  if (hit) {
    return {
      hit: true,
      point: hit.point,
      distance: hit.distance,
    };
  }

  return {
    hit: false,
    point: vec3Add(position, vec3Scale(direction, maxDistance)),
    distance: maxDistance,
  };
}

export function resolvePenetration(
  world: PhysicsWorld,
  position: Vec3,
  radius: number,
  playerId: string
): Vec3 {
  // Simple penetration resolution using sphere overlap
  const adjustedPosition = { ...position };
  const maxIterations = 4;
  const pushDistance = 0.05;

  for (let i = 0; i < maxIterations; i++) {
    // Check in 6 cardinal directions
    const directions = [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
    ];

    let pushed = false;

    for (const dir of directions) {
      const hit = world.raycast(
        adjustedPosition,
        dir,
        radius + 0.1,
        playerId
      );

      if (hit && hit.distance < radius) {
        // Push away from collision
        const pushDir = vec3Scale(hit.normal, pushDistance);
        adjustedPosition.x += pushDir.x;
        adjustedPosition.y += pushDir.y;
        adjustedPosition.z += pushDir.z;
        pushed = true;
      }
    }

    if (!pushed) break;
  }

  return adjustedPosition;
}

