import type { DirectionalMovementIntent, HeroStats, PlayerInput, PlayerMovementState, Vec3 } from '@voxel-strike/shared';
import {
  CHRONOS_ASCENDANT_PARADOX_AIR_ACCEL_MULTIPLIER,
  CHRONOS_ASCENDANT_PARADOX_GRAVITY_SCALE,
  CHRONOS_ASCENDANT_PARADOX_HORIZONTAL_DAMPING,
  CHRONOS_ASCENDANT_PARADOX_HORIZONTAL_STOP_SPEED,
  CHRONOS_ASCENDANT_PARADOX_HOVER_DAMPING,
  CHRONOS_ASCENDANT_PARADOX_MAX_ELEVATION_GAIN,
  CHRONOS_ASCENDANT_PARADOX_MAX_ASCEND_SPEED,
  CHRONOS_ASCENDANT_PARADOX_MAX_DESCEND_SPEED,
  CHRONOS_ASCENDANT_PARADOX_VERTICAL_ACCEL,
  BHOP_AIR_ACCEL,
  BHOP_AIR_SPEED_CAP,
  BHOP_GROUND_ACCEL,
  BHOP_GROUND_FRICTION,
  BHOP_GROUND_STOP_THRESHOLD,
  BHOP_MAX_VELOCITY,
  BHOP_NO_INPUT_FRICTION_MULTIPLIER,
  BHOP_STOP_SPEED,
  CROUCH_MULTIPLIER,
  GRAVITY,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  PROCEDURAL_VOXEL_SIZE,
  resolveDirectionalMovementIntent,
  SLIDE_COOLDOWN,
  SLIDE_DURATION,
  SLIDE_ENTRY_SPEED_CAP_MULTIPLIER,
  SLIDE_FRICTION,
  SLIDE_INITIAL_BOOST,
  SLIDE_JUMP_MAX_SPEED_MULTIPLIER,
  SLIDE_JUMP_SPEED_RETENTION,
  SLIDE_MAX_SPEED_MULTIPLIER,
  SPRINT_MULTIPLIER,
  STEP_HEIGHT,
  getBlockDefinition,
  isCollisionBlock,
} from '@voxel-strike/shared';

export interface MovementAabb {
  min: Vec3;
  max: Vec3;
  id?: string;
}

export interface MovementCollisionBounds {
  min: Vec3;
  max: Vec3;
}

export interface VoxelMovementTerrainAdapter {
  getGroundY?: (position: Vec3) => number | null;
  clampPosition?: (position: Vec3) => Vec3;
  getBlockAtWorld?: (position: Vec3) => number;
  origin?: Vec3;
  voxelSize?: Vec3;
  collisionRevision?: number;
  cacheStaticAabbs?: boolean;
  getCollisionAabbs?: (bounds: MovementCollisionBounds) => readonly MovementAabb[];
}

export interface MovementOverlap {
  normal: Vec3;
  depth: number;
  aabb: MovementAabb;
}

export interface CapsuleSweepHit {
  time: number;
  position: Vec3;
  normal: Vec3;
  distance: number;
  aabb: MovementAabb;
}

export interface MovementGroundHit {
  position: Vec3;
  normal: Vec3;
  distance: number;
  walkable: boolean;
  aabb: MovementAabb;
}

export interface MovementCollisionWorld {
  collisionRevision: number;
  testCapsule(position: Vec3, height: number, radius: number): MovementOverlap[];
  sweepCapsule(position: Vec3, delta: Vec3, height: number, radius: number): CapsuleSweepHit | null;
  findGround(position: Vec3, snapDistance: number, radius: number, height: number): MovementGroundHit | null;
  clampToPlayableArea(position: Vec3): Vec3;
}

export interface MovementCommandInput {
  input: Pick<PlayerInput, 'moveForward' | 'moveBackward' | 'moveLeft' | 'moveRight' | 'jump' | 'crouch' | 'crouchPressed' | 'sprint'>;
  lookYaw: number;
}

export interface MovementSimulationState {
  position: Vec3;
  velocity: Vec3;
  movement: PlayerMovementState;
}

export interface MovementModifiers {
  flagCarrier?: boolean;
  activeSpeedMultiplier?: number;
  chronosAscendantActive?: boolean;
}

export interface CapsuleMotorInput {
  state: MovementSimulationState;
  command: MovementCommandInput;
  terrain: MovementCollisionWorld;
  heroStats: HeroStats;
  modifiers?: MovementModifiers;
  dt: number;
}

export interface MovementContact {
  normal: Vec3;
  position: Vec3;
  time: number;
  kind: 'wall' | 'ground' | 'ceiling' | 'depenetration' | 'boundary' | 'step';
  aabb?: MovementAabb;
}

export interface MovementCorrectionSummary {
  depenetrationIterations: number;
  depenetrationDistance: number;
  slideIterations: number;
  steppedUp: boolean;
  snappedDown: boolean;
  clampedToPlayableArea: boolean;
}

export interface CapsuleMotorResult {
  state: MovementSimulationState;
  contacts: MovementContact[];
  correction: MovementCorrectionSummary;
}

const PLAYER_STANDING_HALF_HEIGHT = PLAYER_HEIGHT / 2;
const GROUND_SNAP_DISTANCE = 0.18;
const GROUND_PROBE_UP = 0.04;
const SKIN_WIDTH = 0.03;
const WALKABLE_NORMAL_Y = 0.7;
const MAX_SLIDE_ITERATIONS = 5;
const MAX_DEPENETRATION_ITERATIONS = 8;
const STEP_UP_MIN_HEIGHT = 0.06;
const DEFAULT_ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };
const DEFAULT_VOXEL_SIZE: Vec3 = {
  x: PROCEDURAL_VOXEL_SIZE.x,
  y: PROCEDURAL_VOXEL_SIZE.y,
  z: PROCEDURAL_VOXEL_SIZE.z,
};
const EPSILON = 0.00001;
const STATIC_AABB_CACHE_LIMIT = 512;

function cloneVec3(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(value: Vec3, amount: number): Vec3 {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(value: Vec3): number {
  return Math.sqrt(dot(value, value));
}

function normalize(value: Vec3, fallback: Vec3 = { x: 0, y: 1, z: 0 }): Vec3 {
  const valueLength = length(value);
  if (valueLength <= EPSILON) return fallback;
  return scale(value, 1 / valueLength);
}

function horizontalSpeed(velocity: Vec3): number {
  return Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
}

function clampHorizontalSpeed(velocity: Vec3, maxSpeed: number): Vec3 {
  const speed = horizontalSpeed(velocity);
  if (speed <= maxSpeed || speed <= EPSILON) return velocity;
  const amount = maxSpeed / speed;
  return {
    x: velocity.x * amount,
    y: velocity.y,
    z: velocity.z * amount,
  };
}

function normalizeHorizontal(vector: Vec3): Vec3 {
  const valueLength = Math.sqrt(vector.x * vector.x + vector.z * vector.z);
  if (valueLength <= EPSILON) return { x: 0, y: 0, z: 0 };
  return { x: vector.x / valueLength, y: 0, z: vector.z / valueLength };
}

function projectOnPlane(value: Vec3, normal: Vec3): Vec3 {
  const into = dot(value, normal);
  if (into >= 0) return value;
  return subtract(value, scale(normal, into));
}

function copyMovementState(value: PlayerMovementState): PlayerMovementState {
  return {
    ...value,
    grapplePoint: value.grapplePoint ? cloneVec3(value.grapplePoint) : null,
  };
}

function feetY(position: Vec3): number {
  return position.y - PLAYER_STANDING_HALF_HEIGHT;
}

function referencePositionFromFeet(position: Vec3, nextFeetY: number): Vec3 {
  return {
    x: position.x,
    y: nextFeetY + PLAYER_STANDING_HALF_HEIGHT,
    z: position.z,
  };
}

function bodyHeightForMovement(movement: PlayerMovementState): number {
  return movement.isSliding || movement.isCrouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
}

function capsuleSegment(position: Vec3, height: number, radius: number): { minY: number; maxY: number } {
  const bottom = feetY(position) + radius;
  const top = feetY(position) + Math.max(radius, height - radius);
  return {
    minY: Math.min(bottom, top),
    maxY: Math.max(bottom, top),
  };
}

function capsuleBounds(position: Vec3, height: number, radius: number): MovementCollisionBounds {
  return {
    min: {
      x: position.x - radius,
      y: feetY(position),
      z: position.z - radius,
    },
    max: {
      x: position.x + radius,
      y: feetY(position) + height,
      z: position.z + radius,
    },
  };
}

function expandBounds(bounds: MovementCollisionBounds, amount: Vec3): MovementCollisionBounds {
  return {
    min: {
      x: bounds.min.x - amount.x,
      y: bounds.min.y - amount.y,
      z: bounds.min.z - amount.z,
    },
    max: {
      x: bounds.max.x + amount.x,
      y: bounds.max.y + amount.y,
      z: bounds.max.z + amount.z,
    },
  };
}

function sweptCapsuleBounds(position: Vec3, delta: Vec3, height: number, radius: number): MovementCollisionBounds {
  const start = capsuleBounds(position, height, radius);
  const endX = position.x + delta.x;
  const endFeetY = feetY(position) + delta.y;
  const endZ = position.z + delta.z;
  return {
    min: {
      x: Math.min(start.min.x, endX - radius),
      y: Math.min(start.min.y, endFeetY),
      z: Math.min(start.min.z, endZ - radius),
    },
    max: {
      x: Math.max(start.max.x, endX + radius),
      y: Math.max(start.max.y, endFeetY + height),
      z: Math.max(start.max.z, endZ + radius),
    },
  };
}

function closestIntervalVector(value: number, min: number, max: number): number {
  if (value < min) return value - min;
  if (value > max) return value - max;
  return 0;
}

function intervalGap(minA: number, maxA: number, minB: number, maxB: number): number {
  if (maxA < minB) return maxA - minB;
  if (minA > maxB) return minA - maxB;
  return 0;
}

function normalKind(normal: Vec3): MovementContact['kind'] {
  if (normal.y >= WALKABLE_NORMAL_Y) return 'ground';
  if (normal.y <= -WALKABLE_NORMAL_Y) return 'ceiling';
  return 'wall';
}

function overlapCapsuleAabb(position: Vec3, height: number, radius: number, aabb: MovementAabb): MovementOverlap | null {
  const segment = capsuleSegment(position, height, radius);
  const vector = {
    x: closestIntervalVector(position.x, aabb.min.x, aabb.max.x),
    y: intervalGap(segment.minY, segment.maxY, aabb.min.y, aabb.max.y),
    z: closestIntervalVector(position.z, aabb.min.z, aabb.max.z),
  };
  const distanceSq = dot(vector, vector);
  const radiusSq = radius * radius;

  if (distanceSq >= radiusSq) return null;

  if (distanceSq > EPSILON) {
    const distance = Math.sqrt(distanceSq);
    return {
      normal: {
        x: vector.x / distance,
        y: vector.y / distance,
        z: vector.z / distance,
      },
      depth: radius - distance,
      aabb,
    };
  }

  const centerY = (segment.minY + segment.maxY) * 0.5;
  let bestDepth = Infinity;
  let bestNormalX = 0;
  let bestNormalY = 1;
  let bestNormalZ = 0;
  const consider = (depth: number, normalX: number, normalY: number, normalZ: number): void => {
    if (!Number.isFinite(depth) || depth < 0 || depth >= bestDepth) return;
    bestDepth = depth;
    bestNormalX = normalX;
    bestNormalY = normalY;
    bestNormalZ = normalZ;
  };
  consider(position.x - aabb.min.x + radius, -1, 0, 0);
  consider(aabb.max.x - position.x + radius, 1, 0, 0);
  consider(position.z - aabb.min.z + radius, 0, 0, -1);
  consider(aabb.max.z - position.z + radius, 0, 0, 1);
  consider(centerY - aabb.min.y + radius, 0, -1, 0);
  consider(aabb.max.y - centerY + radius, 0, 1, 0);

  return {
    normal: { x: bestNormalX, y: bestNormalY, z: bestNormalZ },
    depth: Number.isFinite(bestDepth) ? bestDepth : radius,
    aabb,
  };
}

function boundsOverlap(a: MovementCollisionBounds, b: MovementCollisionBounds): boolean {
  return (
    a.min.x <= b.max.x &&
    a.max.x >= b.min.x &&
    a.min.y <= b.max.y &&
    a.max.y >= b.min.y &&
    a.min.z <= b.max.z &&
    a.max.z >= b.min.z
  );
}

function collectVoxelAabbs(
  terrain: VoxelMovementTerrainAdapter,
  bounds: MovementCollisionBounds,
  origin: Vec3,
  voxelSize: Vec3
): MovementAabb[] {
  if (!terrain.getBlockAtWorld) return [];

  const gx0 = Math.floor((bounds.min.x - origin.x) / voxelSize.x) - 1;
  const gy0 = Math.floor((bounds.min.y - origin.y) / voxelSize.y) - 1;
  const gz0 = Math.floor((bounds.min.z - origin.z) / voxelSize.z) - 1;
  const gx1 = Math.floor((bounds.max.x - origin.x) / voxelSize.x) + 1;
  const gy1 = Math.floor((bounds.max.y - origin.y) / voxelSize.y) + 1;
  const gz1 = Math.floor((bounds.max.z - origin.z) / voxelSize.z) + 1;

  const aabbs: MovementAabb[] = [];
  const sample = { x: 0, y: 0, z: 0 };
  for (let y = gy0; y <= gy1; y++) {
    for (let z = gz0; z <= gz1; z++) {
      let runStart: number | null = null;
      for (let x = gx0; x <= gx1 + 1; x++) {
        let solid = false;
        if (x <= gx1) {
          sample.x = origin.x + (x + 0.5) * voxelSize.x;
          sample.y = origin.y + (y + 0.5) * voxelSize.y;
          sample.z = origin.z + (z + 0.5) * voxelSize.z;
          const block = terrain.getBlockAtWorld(sample);
          solid = isCollisionBlock(block);

          if (solid && terrain.getGroundY && getBlockDefinition(block).walkable) {
            const groundY = terrain.getGroundY({
              x: sample.x,
              y: bounds.max.y + STEP_HEIGHT + SKIN_WIDTH,
              z: sample.z,
            });
            const neighborDistance = Math.max(PLAYER_RADIUS, voxelSize.x, voxelSize.z);
            let lowestNeighborGroundY = groundY;
            const leftGroundY = terrain.getGroundY({ x: sample.x - neighborDistance, y: sample.y, z: sample.z });
            if (leftGroundY !== null) lowestNeighborGroundY = lowestNeighborGroundY === null ? leftGroundY : Math.min(lowestNeighborGroundY, leftGroundY);
            const rightGroundY = terrain.getGroundY({ x: sample.x + neighborDistance, y: sample.y, z: sample.z });
            if (rightGroundY !== null) lowestNeighborGroundY = lowestNeighborGroundY === null ? rightGroundY : Math.min(lowestNeighborGroundY, rightGroundY);
            const backGroundY = terrain.getGroundY({ x: sample.x, y: sample.y, z: sample.z - neighborDistance });
            if (backGroundY !== null) lowestNeighborGroundY = lowestNeighborGroundY === null ? backGroundY : Math.min(lowestNeighborGroundY, backGroundY);
            const forwardGroundY = terrain.getGroundY({ x: sample.x, y: sample.y, z: sample.z + neighborDistance });
            if (forwardGroundY !== null) lowestNeighborGroundY = lowestNeighborGroundY === null ? forwardGroundY : Math.min(lowestNeighborGroundY, forwardGroundY);
            const localRise = groundY !== null && lowestNeighborGroundY !== null
              ? groundY - lowestNeighborGroundY
              : Infinity;
            const blockTopY = origin.y + (y + 1) * voxelSize.y;
            const climbableGround = groundY !== null &&
              localRise <= STEP_HEIGHT + SKIN_WIDTH &&
              groundY <= bounds.min.y + STEP_HEIGHT + SKIN_WIDTH &&
              blockTopY <= groundY + SKIN_WIDTH;
            if (climbableGround) {
              solid = false;
            }
          }
        }

        if (solid && runStart === null) {
          runStart = x;
          continue;
        }

        if ((!solid || x > gx1) && runStart !== null) {
          aabbs.push({
            min: {
              x: origin.x + runStart * voxelSize.x,
              y: origin.y + y * voxelSize.y,
              z: origin.z + z * voxelSize.z,
            },
            max: {
              x: origin.x + x * voxelSize.x,
              y: origin.y + (y + 1) * voxelSize.y,
              z: origin.z + (z + 1) * voxelSize.z,
            },
          });
          runStart = null;
        }
      }
    }
  }

  return aabbs;
}

function sameInterval(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return Math.abs(aMin - bMin) <= EPSILON && Math.abs(aMax - bMax) <= EPSILON;
}

function mergeAabbRuns(aabbs: MovementAabb[]): MovementAabb[] {
  const zMerged: MovementAabb[] = [];
  const byZ = [...aabbs].sort((a, b) =>
    a.min.y - b.min.y ||
    a.min.x - b.min.x ||
    a.max.x - b.max.x ||
    a.min.z - b.min.z
  );

  for (const aabb of byZ) {
    const previous = zMerged[zMerged.length - 1];
    if (
      previous &&
      sameInterval(previous.min.x, previous.max.x, aabb.min.x, aabb.max.x) &&
      sameInterval(previous.min.y, previous.max.y, aabb.min.y, aabb.max.y) &&
      Math.abs(previous.max.z - aabb.min.z) <= EPSILON
    ) {
      previous.max.z = aabb.max.z;
    } else {
      zMerged.push({
        min: cloneVec3(aabb.min),
        max: cloneVec3(aabb.max),
        id: aabb.id,
      });
    }
  }

  const yMerged: MovementAabb[] = [];
  const byY = zMerged.sort((a, b) =>
    a.min.x - b.min.x ||
    a.max.x - b.max.x ||
    a.min.z - b.min.z ||
    a.max.z - b.max.z ||
    a.min.y - b.min.y
  );

  for (const aabb of byY) {
    const previous = yMerged[yMerged.length - 1];
    if (
      previous &&
      sameInterval(previous.min.x, previous.max.x, aabb.min.x, aabb.max.x) &&
      sameInterval(previous.min.z, previous.max.z, aabb.min.z, aabb.max.z) &&
      Math.abs(previous.max.y - aabb.min.y) <= EPSILON
    ) {
      previous.max.y = aabb.max.y;
    } else {
      yMerged.push({
        min: cloneVec3(aabb.min),
        max: cloneVec3(aabb.max),
        id: aabb.id,
      });
    }
  }

  return yMerged;
}

export function createVoxelCollisionWorld(terrain: VoxelMovementTerrainAdapter): MovementCollisionWorld {
  const origin = terrain.origin ?? DEFAULT_ORIGIN;
  const voxelSize = terrain.voxelSize ?? (
    terrain.getBlockAtWorld ? DEFAULT_VOXEL_SIZE : { x: 1, y: 1, z: 1 }
  );
  const sweepStep = Math.max(
    0.04,
    Math.min(voxelSize.x, voxelSize.y, voxelSize.z, PLAYER_RADIUS * 0.35)
  );
  const staticAabbCache = new Map<string, readonly MovementAabb[]>();
  const combinedAabbScratch: MovementAabb[] = [];

  function staticAabbCacheKey(bounds: MovementCollisionBounds): string {
    const gx0 = Math.floor((bounds.min.x - origin.x) / voxelSize.x) - 1;
    const gy0 = Math.floor((bounds.min.y - origin.y) / voxelSize.y) - 1;
    const gz0 = Math.floor((bounds.min.z - origin.z) / voxelSize.z) - 1;
    const gx1 = Math.floor((bounds.max.x - origin.x) / voxelSize.x) + 1;
    const gy1 = Math.floor((bounds.max.y - origin.y) / voxelSize.y) + 1;
    const gz1 = Math.floor((bounds.max.z - origin.z) / voxelSize.z) + 1;
    return `${gx0},${gy0},${gz0}:${gx1},${gy1},${gz1}:${bounds.min.y.toFixed(4)},${bounds.max.y.toFixed(4)}`;
  }

  function collectStaticAabbs(expanded: MovementCollisionBounds): readonly MovementAabb[] {
    if (!terrain.getBlockAtWorld) return [];

    const cacheKey = staticAabbCacheKey(expanded);
    const cached = staticAabbCache.get(cacheKey);
    if (cached) return cached;

    const staticAabbs = mergeAabbRuns(collectVoxelAabbs(terrain, expanded, origin, voxelSize));
    if (staticAabbCache.size >= STATIC_AABB_CACHE_LIMIT) {
      const oldestKey = staticAabbCache.keys().next().value;
      if (oldestKey) {
        staticAabbCache.delete(oldestKey);
      }
    }
    staticAabbCache.set(cacheKey, staticAabbs);
    return staticAabbs;
  }

  function collectAabbs(bounds: MovementCollisionBounds): readonly MovementAabb[] {
    const expanded = expandBounds(bounds, { x: SKIN_WIDTH, y: SKIN_WIDTH, z: SKIN_WIDTH });
    const staticAabbs = terrain.cacheStaticAabbs
      ? collectStaticAabbs(expanded)
      : mergeAabbRuns(collectVoxelAabbs(terrain, expanded, origin, voxelSize));
    const dynamicAabbs = terrain.getCollisionAabbs?.(expanded) ?? [];
    if (dynamicAabbs.length === 0) return staticAabbs;

    combinedAabbScratch.length = 0;
    for (const aabb of staticAabbs) combinedAabbScratch.push(aabb);
    for (const aabb of dynamicAabbs) {
      if (boundsOverlap(expanded, { min: aabb.min, max: aabb.max })) {
        combinedAabbScratch.push(aabb);
      }
    }
    return combinedAabbScratch;
  }

  function testCapsuleAgainstAabbs(position: Vec3, height: number, radius: number, aabbs: readonly MovementAabb[]): MovementOverlap[] {
    const overlaps: MovementOverlap[] = [];
    let bestIndex = -1;
    let bestDepth = -Infinity;
    for (const aabb of aabbs) {
      const overlap = overlapCapsuleAabb(position, height, radius, aabb);
      if (!overlap) continue;
      if (overlap.depth > bestDepth) {
        bestDepth = overlap.depth;
        if (bestIndex >= 0) {
          overlaps.push(overlaps[0]);
        }
        overlaps[0] = overlap;
        bestIndex = 0;
      } else {
        overlaps.push(overlap);
      }
    }
    return overlaps;
  }

  function testCapsule(position: Vec3, height: number, radius: number): MovementOverlap[] {
    return testCapsuleAgainstAabbs(position, height, radius, collectAabbs(capsuleBounds(position, height, radius)));
  }

  function sweepCapsule(position: Vec3, delta: Vec3, height: number, radius: number): CapsuleSweepHit | null {
    const travelDistance = length(delta);
    if (travelDistance <= EPSILON) return null;

    const aabbs = collectAabbs(sweptCapsuleBounds(position, delta, height, radius));
    if (aabbs.length === 0) return null;

    const startOverlap = testCapsuleAgainstAabbs(position, height, radius, aabbs)[0];
    if (startOverlap) {
      return {
        time: 0,
        position: cloneVec3(position),
        normal: startOverlap.normal,
        distance: 0,
        aabb: startOverlap.aabb,
      };
    }

    const steps = Math.max(1, Math.ceil(travelDistance / sweepStep));
    let low = 0;

    for (let step = 1; step <= steps; step++) {
      const high = step / steps;
      const probe = add(position, scale(delta, high));
      const hitOverlap = testCapsuleAgainstAabbs(probe, height, radius, aabbs)[0];
      if (!hitOverlap) {
        low = high;
        continue;
      }

      let hitTime = high;
      for (let iteration = 0; iteration < 10; iteration++) {
        const middle = (low + hitTime) * 0.5;
        const middlePosition = add(position, scale(delta, middle));
        const middleOverlap = testCapsuleAgainstAabbs(middlePosition, height, radius, aabbs)[0];
        if (middleOverlap) {
          hitTime = middle;
        } else {
          low = middle;
        }
      }

      const hitPosition = add(position, scale(delta, hitTime));
      const overlap = testCapsuleAgainstAabbs(hitPosition, height, radius, aabbs)[0] ?? hitOverlap;
      return {
        time: hitTime,
        position: hitPosition,
        normal: overlap.normal,
        distance: hitTime * travelDistance,
        aabb: overlap.aabb,
      };
    }

    return null;
  }

  function findHeightfieldGround(position: Vec3, snapDistance: number, radius: number): MovementGroundHit | null {
    if (!terrain.getGroundY) return null;

    const sampleRadius = radius * 0.72;
    const probeY = position.y + STEP_HEIGHT + 0.25;
    let bestGroundY: number | null = null;

    for (let index = 0; index < 5; index++) {
      const offsetX = index === 1 ? sampleRadius : index === 2 ? -sampleRadius : 0;
      const offsetZ = index === 3 ? sampleRadius : index === 4 ? -sampleRadius : 0;
      const groundY = terrain.getGroundY({
        x: position.x + offsetX,
        y: probeY,
        z: position.z + offsetZ,
      });
      if (groundY === null) continue;
      const distance = feetY(position) - groundY;
      const reachable = distance >= -STEP_HEIGHT - SKIN_WIDTH && distance <= snapDistance + SKIN_WIDTH;
      if (!reachable) continue;
      if (bestGroundY === null || groundY > bestGroundY) {
        bestGroundY = groundY;
      }
    }

    if (bestGroundY === null) return null;

    const distance = feetY(position) - bestGroundY;

    const groundedPosition = referencePositionFromFeet(position, bestGroundY);
    return {
      position: groundedPosition,
      normal: { x: 0, y: 1, z: 0 },
      distance: Math.max(0, distance),
      walkable: true,
      aabb: {
        min: {
          x: position.x - radius,
          y: bestGroundY - SKIN_WIDTH,
          z: position.z - radius,
        },
        max: {
          x: position.x + radius,
          y: bestGroundY,
          z: position.z + radius,
        },
        id: 'heightfield-ground',
      },
    };
  }

  function findGround(position: Vec3, snapDistance: number, radius: number, height: number): MovementGroundHit | null {
    const probeDistance = Math.max(0, snapDistance) + GROUND_PROBE_UP;
    const start = { x: position.x, y: position.y + GROUND_PROBE_UP, z: position.z };
    const hit = sweepCapsule(start, { x: 0, y: -probeDistance, z: 0 }, height, radius);
    if (!hit || hit.normal.y < WALKABLE_NORMAL_Y) {
      return findHeightfieldGround(position, snapDistance, radius);
    }

    const distance = Math.max(0, hit.distance - GROUND_PROBE_UP);
    if (distance > snapDistance + SKIN_WIDTH) {
      return findHeightfieldGround(position, snapDistance, radius);
    }
    const snapDistanceWithSkin = Math.max(0, distance - SKIN_WIDTH);

    return {
      position: { x: position.x, y: position.y - snapDistanceWithSkin, z: position.z },
      normal: hit.normal,
      distance,
      walkable: true,
      aabb: hit.aabb,
    };
  }

  return {
    collisionRevision: terrain.collisionRevision ?? 0,
    testCapsule,
    sweepCapsule,
    findGround,
    clampToPlayableArea(position: Vec3): Vec3 {
      return terrain.clampPosition ? terrain.clampPosition(position) : cloneVec3(position);
    },
  };
}

function accelerate(velocity: Vec3, wishDir: Vec3, wishSpeed: number, acceleration: number, dt: number): Vec3 {
  if (wishDir.x === 0 && wishDir.z === 0) return velocity;

  const currentSpeed = velocity.x * wishDir.x + velocity.z * wishDir.z;
  const addSpeed = wishSpeed - currentSpeed;
  if (addSpeed <= 0) return velocity;

  const accelSpeed = Math.min(acceleration * dt * wishSpeed, addSpeed);
  return {
    x: velocity.x + accelSpeed * wishDir.x,
    y: velocity.y,
    z: velocity.z + accelSpeed * wishDir.z,
  };
}

function getWishDirection(intent: DirectionalMovementIntent, lookYaw: number): Vec3 {
  const cos = Math.cos(lookYaw);
  const sin = Math.sin(lookYaw);

  return normalizeHorizontal({
    x: intent.localX * cos + intent.localZ * sin,
    y: 0,
    z: -intent.localX * sin + intent.localZ * cos,
  });
}

function canOccupy(world: MovementCollisionWorld, position: Vec3, height: number, radius: number): boolean {
  return world.testCapsule(position, height, radius).length === 0;
}

function tryStepUp(
  world: MovementCollisionWorld,
  position: Vec3,
  delta: Vec3,
  height: number,
  radius: number,
  blockingNormal: Vec3
): { position: Vec3; contact: MovementContact } | null {
  if (blockingNormal.y > 0.25 || blockingNormal.y < -0.25) return null;

  const horizontalDelta = { x: delta.x, y: 0, z: delta.z };
  const horizontalDistance = length(horizontalDelta);
  if (horizontalDistance <= EPSILON) return null;

  const upDelta = { x: 0, y: STEP_HEIGHT, z: 0 };
  if (world.sweepCapsule(position, upDelta, height, radius)) return null;

  const raised = add(position, upDelta);
  if (!canOccupy(world, raised, height, radius)) return null;

  const forwardHit = world.sweepCapsule(raised, horizontalDelta, height, radius);
  if (forwardHit) return null;

  const forwardPosition = add(raised, horizontalDelta);
  const downDistance = STEP_HEIGHT + GROUND_SNAP_DISTANCE + SKIN_WIDTH;
  const downHit = world.sweepCapsule(forwardPosition, { x: 0, y: -downDistance, z: 0 }, height, radius);
  if (!downHit || downHit.normal.y < WALKABLE_NORMAL_Y) return null;

  const landed = add(
    add(forwardPosition, { x: 0, y: -downHit.distance, z: 0 }),
    scale(downHit.normal, SKIN_WIDTH)
  );
  const rise = landed.y - position.y;
  if (rise < STEP_UP_MIN_HEIGHT || rise > STEP_HEIGHT + SKIN_WIDTH) return null;
  if (!canOccupy(world, landed, height, radius)) return null;

  return {
    position: landed,
    contact: {
      normal: downHit.normal,
      position: landed,
      time: downHit.time,
      kind: 'step',
      aabb: downHit.aabb,
    },
  };
}

function depenetrate(
  world: MovementCollisionWorld,
  position: Vec3,
  height: number,
  radius: number,
  contacts: MovementContact[]
): { position: Vec3; iterations: number; distance: number } {
  let nextPosition = position;
  let totalDistance = 0;
  let iterations = 0;

  for (; iterations < MAX_DEPENETRATION_ITERATIONS; iterations++) {
    const overlap = world.testCapsule(nextPosition, height, radius)[0];
    if (!overlap) break;

    const pushDistance = overlap.depth + SKIN_WIDTH;
    nextPosition = add(nextPosition, scale(overlap.normal, pushDistance));
    totalDistance += pushDistance;
    contacts.push({
      normal: overlap.normal,
      position: nextPosition,
      time: 0,
      kind: 'depenetration',
      aabb: overlap.aabb,
    });
  }

  return { position: nextPosition, iterations, distance: totalDistance };
}

function moveAndSlide(
  world: MovementCollisionWorld,
  position: Vec3,
  velocity: Vec3,
  dt: number,
  height: number,
  radius: number,
  canStepUp: boolean,
  contacts: MovementContact[]
): {
  position: Vec3;
  velocity: Vec3;
  slideIterations: number;
  steppedUp: boolean;
  depenetrationIterations: number;
  depenetrationDistance: number;
} {
  let nextPosition = position;
  let nextVelocity = velocity;
  let remainingDelta = scale(velocity, dt);
  let steppedUp = false;
  let slideIterations = 0;

  for (; slideIterations < MAX_SLIDE_ITERATIONS; slideIterations++) {
    const remainingDistance = length(remainingDelta);
    if (remainingDistance <= EPSILON) break;

    const hit = world.sweepCapsule(nextPosition, remainingDelta, height, radius);
    if (!hit) {
      nextPosition = add(nextPosition, remainingDelta);
      break;
    }

    if (canStepUp && !steppedUp && hit.normal.y > -0.15 && hit.normal.y < WALKABLE_NORMAL_Y) {
      const step = tryStepUp(world, nextPosition, remainingDelta, height, radius, hit.normal);
      if (step) {
        nextPosition = step.position;
        contacts.push(step.contact);
        steppedUp = true;
        break;
      }
    }

    const safeTime = Math.max(0, hit.time - SKIN_WIDTH / Math.max(remainingDistance, SKIN_WIDTH));
    nextPosition = add(nextPosition, scale(remainingDelta, safeTime));
    contacts.push({
      normal: hit.normal,
      position: hit.position,
      time: hit.time,
      kind: normalKind(hit.normal),
      aabb: hit.aabb,
    });

    nextVelocity = projectOnPlane(nextVelocity, hit.normal);
    if (hit.normal.y >= WALKABLE_NORMAL_Y && nextVelocity.y < 0) {
      nextVelocity.y = 0;
    }
    remainingDelta = projectOnPlane(scale(remainingDelta, 1 - safeTime), hit.normal);
  }

  const depenetration = depenetrate(world, nextPosition, height, radius, contacts);
  return {
    position: depenetration.position,
    velocity: nextVelocity,
    slideIterations,
    steppedUp,
    depenetrationIterations: depenetration.iterations,
    depenetrationDistance: depenetration.distance,
  };
}

function applyBoundaryClamp(
  world: MovementCollisionWorld,
  position: Vec3,
  velocity: Vec3,
  contacts: MovementContact[]
): { position: Vec3; velocity: Vec3; clamped: boolean } {
  const clampedPosition = world.clampToPlayableArea(position);
  const clamped =
    Math.abs(clampedPosition.x - position.x) > EPSILON ||
    Math.abs(clampedPosition.y - position.y) > EPSILON ||
    Math.abs(clampedPosition.z - position.z) > EPSILON;

  if (!clamped) return { position, velocity, clamped: false };

  const nextVelocity = cloneVec3(velocity);
  if (Math.abs(clampedPosition.x - position.x) > EPSILON) nextVelocity.x = 0;
  if (Math.abs(clampedPosition.y - position.y) > EPSILON) nextVelocity.y = 0;
  if (Math.abs(clampedPosition.z - position.z) > EPSILON) nextVelocity.z = 0;
  contacts.push({
    normal: normalize(subtract(clampedPosition, position), { x: 0, y: 1, z: 0 }),
    position: clampedPosition,
    time: 1,
    kind: 'boundary',
  });

  return { position: clampedPosition, velocity: nextVelocity, clamped: true };
}

export function simulateCapsuleMotor(input: CapsuleMotorInput): CapsuleMotorResult {
  const dt = Math.max(0, Math.min(0.1, input.dt));
  let position = cloneVec3(input.state.position);
  let velocity = cloneVec3(input.state.velocity);
  const movement = copyMovementState(input.state.movement);
  const contacts: MovementContact[] = [];
  const modifiers = input.modifiers ?? {};
  const chronosAscendantActive = Boolean(modifiers.chronosAscendantActive);
  const world = input.terrain;

  if (dt <= 0) {
    return {
      state: { position, velocity, movement },
      contacts,
      correction: {
        depenetrationIterations: 0,
        depenetrationDistance: 0,
        slideIterations: 0,
        steppedUp: false,
        snappedDown: false,
        clampedToPlayableArea: false,
      },
    };
  }

  const wasSliding = movement.isSliding;
  const startHeight = bodyHeightForMovement(movement);
  const startGround = world.findGround(position, GROUND_SNAP_DISTANCE, PLAYER_RADIUS, startHeight);
  const wasGrounded = !chronosAscendantActive && Boolean(startGround?.walkable && velocity.y <= 0);
  movement.isGrounded = wasGrounded;
  if (startGround && wasGrounded && startGround.distance <= GROUND_SNAP_DISTANCE) {
    position = startGround.position;
    velocity.y = 0;
  }

  const movementIntent = resolveDirectionalMovementIntent(input.command.input);
  const wishDir = getWishDirection(movementIntent, input.command.lookYaw);
  const hasMovementInput = movementIntent.hasMovementInput;

  const wantsCrouch = Boolean(input.command.input.crouch && !movement.isSliding);
  const canStand = wantsCrouch || canOccupy(world, position, PLAYER_HEIGHT, PLAYER_RADIUS);
  movement.isCrouching = wantsCrouch || !canStand;
  movement.isSprinting = Boolean(
    input.command.input.sprint &&
    movementIntent.allowsSprint &&
    hasMovementInput &&
    movement.isGrounded &&
    !movement.isCrouching &&
    !movement.isSliding
  );

  if (movement.slideTimeRemaining > 0) {
    movement.slideTimeRemaining = Math.max(0, movement.slideTimeRemaining - dt);
  }

  const slideStartRequested = input.command.input.crouchPressed ?? false;
  const canStartSlide =
    movement.isGrounded &&
    slideStartRequested &&
    input.command.input.sprint &&
    movementIntent.allowsSprint &&
    hasMovementInput &&
    !movement.isSliding &&
    movement.slideTimeRemaining <= 0;

  if (canStartSlide) {
    movement.isSliding = true;
    movement.isCrouching = false;
    movement.isSprinting = false;
    movement.slideTimeRemaining = SLIDE_DURATION;
    const sprintSpeed = input.heroStats.moveSpeed * SPRINT_MULTIPLIER;
    const slideEntrySpeed = Math.min(
      Math.max(horizontalSpeed(velocity), sprintSpeed),
      sprintSpeed * SLIDE_ENTRY_SPEED_CAP_MULTIPLIER
    );
    const slideSpeed = Math.min(
      slideEntrySpeed * SLIDE_INITIAL_BOOST,
      sprintSpeed * SLIDE_MAX_SPEED_MULTIPLIER
    );
    velocity.x = wishDir.x * slideSpeed;
    velocity.z = wishDir.z * slideSpeed;
  }

  if (movement.isSliding) {
    const sprintSpeed = input.heroStats.moveSpeed * SPRINT_MULTIPLIER;
    const friction = Math.pow(SLIDE_FRICTION, dt * 60);
    velocity.x *= friction;
    velocity.z *= friction;
    const slideSpeedAfterFriction = horizontalSpeed(velocity);

    if (hasMovementInput && slideSpeedAfterFriction > EPSILON) {
      const steer = input.heroStats.moveSpeed * 2.5 * dt;
      velocity.x += wishDir.x * steer;
      velocity.z += wishDir.z * steer;
      velocity = clampHorizontalSpeed(velocity, slideSpeedAfterFriction);
    }

    velocity = clampHorizontalSpeed(velocity, sprintSpeed * SLIDE_MAX_SPEED_MULTIPLIER);

    const slideJumpRequested = input.command.input.jump;
    if (movement.slideTimeRemaining <= 0 || slideJumpRequested || horizontalSpeed(velocity) < 2) {
      if (slideJumpRequested) {
        velocity.x *= SLIDE_JUMP_SPEED_RETENTION;
        velocity.z *= SLIDE_JUMP_SPEED_RETENTION;
        velocity = clampHorizontalSpeed(velocity, sprintSpeed * SLIDE_JUMP_MAX_SPEED_MULTIPLIER);
      }
      movement.isSliding = false;
      movement.slideTimeRemaining = SLIDE_COOLDOWN;
    }
  } else {
    let wishSpeed = input.heroStats.moveSpeed * movementIntent.speedMultiplier * (modifiers.activeSpeedMultiplier ?? 1);
    if (movement.isSprinting) wishSpeed *= SPRINT_MULTIPLIER;
    if (movement.isCrouching) wishSpeed *= CROUCH_MULTIPLIER;
    if (modifiers.flagCarrier) wishSpeed *= 0.85;

    if (movement.isGrounded) {
      const speed = horizontalSpeed(velocity);
      if (speed > 0) {
        const friction = hasMovementInput
          ? BHOP_GROUND_FRICTION
          : BHOP_GROUND_FRICTION * BHOP_NO_INPUT_FRICTION_MULTIPLIER;
        const control = speed < BHOP_STOP_SPEED ? BHOP_STOP_SPEED : speed;
        const drop = control * friction * dt;
        let nextSpeed = Math.max(0, speed - drop);
        if (!hasMovementInput && nextSpeed < BHOP_GROUND_STOP_THRESHOLD) nextSpeed = 0;
        if (nextSpeed !== speed) {
          const amount = nextSpeed / speed;
          velocity.x *= amount;
          velocity.z *= amount;
        }
      }
      velocity = accelerate(velocity, wishDir, wishSpeed, BHOP_GROUND_ACCEL, dt);
    } else {
      const airWishSpeed = chronosAscendantActive
        ? Math.max(BHOP_AIR_SPEED_CAP, wishSpeed * 0.92)
        : Math.min(wishSpeed, BHOP_AIR_SPEED_CAP);
      const airAcceleration = chronosAscendantActive
        ? BHOP_AIR_ACCEL * CHRONOS_ASCENDANT_PARADOX_AIR_ACCEL_MULTIPLIER
        : BHOP_AIR_ACCEL;
      velocity = accelerate(velocity, wishDir, airWishSpeed, airAcceleration, dt);
    }
  }

  let jumpedThisStep = false;
  if (input.command.input.jump && movement.isGrounded && !movement.isSliding) {
    velocity.y = input.heroStats.jumpForce;
    movement.isGrounded = false;
    jumpedThisStep = true;
  }

  if (chronosAscendantActive) {
    const ascendantStartY = Number.isFinite(movement.chronosAscendantStartY)
      ? movement.chronosAscendantStartY!
      : position.y;
    const ascendantMaxY = ascendantStartY + CHRONOS_ASCENDANT_PARADOX_MAX_ELEVATION_GAIN;

    movement.isGrounded = false;
    movement.isGliding = true;
    movement.isJetpacking = true;
    movement.isSliding = false;
    movement.slideTimeRemaining = 0;
    movement.chronosAscendantStartY = ascendantStartY;

    if (!hasMovementInput) {
      const horizontalDamping = Math.max(0, 1 - CHRONOS_ASCENDANT_PARADOX_HORIZONTAL_DAMPING * dt);
      velocity.x *= horizontalDamping;
      velocity.z *= horizontalDamping;
      if (horizontalSpeed(velocity) < CHRONOS_ASCENDANT_PARADOX_HORIZONTAL_STOP_SPEED) {
        velocity.x = 0;
        velocity.z = 0;
      }
    }

    const verticalInput = (input.command.input.jump ? 1 : 0) - (input.command.input.crouch ? 1 : 0);
    if (verticalInput !== 0) {
      velocity.y += verticalInput * CHRONOS_ASCENDANT_PARADOX_VERTICAL_ACCEL * dt;
    } else {
      velocity.y += GRAVITY * CHRONOS_ASCENDANT_PARADOX_GRAVITY_SCALE * dt;
      const damping = Math.max(0, 1 - CHRONOS_ASCENDANT_PARADOX_HOVER_DAMPING * dt);
      velocity.y *= damping;
    }
    velocity.y = Math.max(
      CHRONOS_ASCENDANT_PARADOX_MAX_DESCEND_SPEED,
      Math.min(CHRONOS_ASCENDANT_PARADOX_MAX_ASCEND_SPEED, velocity.y)
    );
    if (position.y >= ascendantMaxY && velocity.y > 0) {
      velocity.y = 0;
    }
  } else if (!movement.isGrounded && !movement.isGrappling && !movement.isWallRunning) {
    movement.chronosAscendantStartY = undefined;
    velocity.y += GRAVITY * dt;
  } else {
    movement.chronosAscendantStartY = undefined;
  }

  const maxHorizontalSpeed = BHOP_MAX_VELOCITY * Math.max(1, modifiers.activeSpeedMultiplier ?? 1);
  velocity = clampHorizontalSpeed(velocity, maxHorizontalSpeed);

  const height = bodyHeightForMovement(movement);
  const moveResult = moveAndSlide(
    world,
    position,
    velocity,
    dt,
    height,
    PLAYER_RADIUS,
    movement.isGrounded && !jumpedThisStep,
    contacts
  );
  position = moveResult.position;
  velocity = moveResult.velocity;

  const boundary = applyBoundaryClamp(world, position, velocity, contacts);
  position = boundary.position;
  velocity = boundary.velocity;

  if (chronosAscendantActive) {
    const ascendantStartY = movement.chronosAscendantStartY ?? position.y;
    const ascendantMaxY = ascendantStartY + CHRONOS_ASCENDANT_PARADOX_MAX_ELEVATION_GAIN;
    if (position.y > ascendantMaxY) {
      position.y = ascendantMaxY;
      if (velocity.y > 0) velocity.y = 0;
    }
  }

  let snappedDown = false;
  const hasGroundContact = contacts.some((contact) => contact.normal.y >= WALKABLE_NORMAL_Y);
  movement.isGrounded = !chronosAscendantActive && hasGroundContact && !jumpedThisStep;

  const canSnapDown =
    !chronosAscendantActive &&
    !jumpedThisStep &&
    !movement.isGrappling &&
    !movement.isWallRunning &&
    (wasGrounded || wasSliding) &&
    velocity.y <= 0.1;

  if (canSnapDown && !movement.isGrounded) {
    const ground = world.findGround(position, GROUND_SNAP_DISTANCE, PLAYER_RADIUS, height);
    if (ground?.walkable) {
      position = ground.position;
      velocity.y = 0;
      snappedDown = true;
      movement.isGrounded = true;
      contacts.push({
        normal: ground.normal,
        position,
        time: 1,
        kind: 'ground',
        aabb: ground.aabb,
      });
    }
  }

  if (!movement.isGrounded && !jumpedThisStep && hasGroundContact) {
    velocity.y = Math.max(0, velocity.y);
  }
  if (movement.isGrounded) {
    velocity.y = Math.max(0, velocity.y);
  }

  return {
    state: {
      position,
      velocity,
      movement,
    },
    contacts,
    correction: {
      depenetrationIterations: moveResult.depenetrationIterations,
      depenetrationDistance: moveResult.depenetrationDistance,
      slideIterations: moveResult.slideIterations,
      steppedUp: moveResult.steppedUp,
      snappedDown,
      clampedToPlayableArea: boundary.clamped,
    },
  };
}

export function canCapsuleOccupy(
  world: MovementCollisionWorld,
  position: Vec3,
  height = PLAYER_HEIGHT,
  radius = PLAYER_RADIUS
): boolean {
  return canOccupy(world, position, height, radius);
}

export function sweepCapsulePathClear(
  world: MovementCollisionWorld,
  start: Vec3,
  end: Vec3,
  height = PLAYER_HEIGHT,
  radius = PLAYER_RADIUS
): boolean {
  if (!canCapsuleOccupy(world, start, height, radius)) return false;
  if (!canCapsuleOccupy(world, end, height, radius)) return false;
  return world.sweepCapsule(start, subtract(end, start), height, radius) === null;
}

export function snapCapsuleToGround(
  world: MovementCollisionWorld,
  position: Vec3,
  snapDistance = GROUND_SNAP_DISTANCE,
  height = PLAYER_HEIGHT,
  radius = PLAYER_RADIUS
): Vec3 | null {
  const hit = world.findGround(position, snapDistance, radius, height);
  return hit?.walkable ? hit.position : null;
}
