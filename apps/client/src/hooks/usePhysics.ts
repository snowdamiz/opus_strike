import { useEffect, useRef, useState } from 'react';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  getBlockDefinition,
  GRAVITY,
  isCollisionBlock,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  type VoxelChunk,
  type VoxelMapManifest,
} from '@voxel-strike/shared';

interface PhysicsContext {
  world: RAPIER.World | null;
  playerBody: RAPIER.RigidBody | null;
  isReady: boolean;
}

let rapierInstance: typeof RAPIER | null = null;
let worldInstance: RAPIER.World | null = null;
let playerColliderInstance: RAPIER.Collider | null = null;
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

        physicsReady = false;
        loadedProceduralMapId = null;
        loadedProceduralMapColliderSignature = null;
        mapColliderBodies = [];
        pendingProceduralColliderLoad = null;
        activeProceduralMap = null;
        activeProceduralChunkLookup = new Map();
        activeProceduralChunksX = 0;
        activeProceduralChunksZ = 0;

        // Create physics world with gravity
        const gravity = { x: 0, y: GRAVITY, z: 0 };
        worldRef.current = new RAPIER.World(gravity);
        worldInstance = worldRef.current;

        // Thin fallback under the procedural terrain while map colliders load.
        const floorBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
        const floorBody = worldRef.current.createRigidBody(floorBodyDesc);
        const floorColliderDesc = RAPIER.ColliderDesc.cuboid(50, 0.5, 40);
        worldRef.current.createCollider(floorColliderDesc, floorBody);

        // Safety net ground far below in case player falls through
        const safetyBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -50, 0);
        const safetyBody = worldRef.current.createRigidBody(safetyBodyDesc);
        const safetyColliderDesc = RAPIER.ColliderDesc.cuboid(200, 1, 200);
        worldRef.current.createCollider(safetyColliderDesc, safetyBody);

        // Create player rigid body
        const playerDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(0, 50, 0);
        playerBodyRef.current = worldRef.current.createRigidBody(playerDesc);

        // Create player collider
        const playerColliderDesc = RAPIER.ColliderDesc.capsule(
          PLAYER_HEIGHT / 2 - PLAYER_RADIUS,
          PLAYER_RADIUS
        )
          .setTranslation(0, PLAYER_HEIGHT / 2, 0);
        playerColliderInstance = worldRef.current.createCollider(playerColliderDesc, playerBodyRef.current);

        // IMPORTANT: Step the world to initialize collision structures
        // This is required for raycasts to work in Rapier
        worldRef.current.step();
        worldRef.current.step(); // Step twice to be safe
        
        // Also update the internal structures for queries
        worldRef.current.updateSceneQueries();

        physicsReady = true;
        setIsReady(true);
        
        // Initialize ice wall system with physics instances
        initializeTemporaryWallSystem();
      } catch (error) {
        console.error('[Physics] Failed to initialize:', error);
      }
    }

    setup();

    return () => {
      mounted = false;
      if (worldInstance === worldRef.current) {
        physicsReady = false;
        worldInstance = null;
        playerColliderInstance = null;
        loadedProceduralMapId = null;
        loadedProceduralMapColliderSignature = null;
        mapColliderBodies = [];
        pendingProceduralColliderLoad = null;
        activeProceduralMap = null;
        activeProceduralChunkLookup = new Map();
        activeProceduralChunksX = 0;
        activeProceduralChunksZ = 0;
      }
      worldRef.current = null;
      playerBodyRef.current = null;
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

let loadedProceduralMapId: string | null = null;
let loadedProceduralMapColliderSignature: string | null = null;
let mapColliderBodies: RAPIER.RigidBody[] = [];
let activeProceduralMap: VoxelMapManifest | null = null;
let activeProceduralChunkLookup = new Map<number, VoxelChunk>();
let activeProceduralChunksX = 0;
let activeProceduralChunksZ = 0;
let visualPhysicsQueryBudgetPerFrame = 44;
let visualPhysicsQueryFrame = -1;
let visualPhysicsQueriesUsed = 0;

type PhysicsQueryPriority = 'gameplay' | 'visual';

interface PhysicsQueryOptions {
  feature?: string;
  priority?: PhysicsQueryPriority;
}

interface RaycastOptions extends PhysicsQueryOptions {
  includeNormal?: boolean;
}

interface ProceduralColliderLoadJob {
  manifest: VoxelMapManifest;
  signature: string;
  mapBody: RAPIER.RigidBody;
  nextIndex: number;
  loadStart: number;
  rafId: number | null;
}

let pendingProceduralColliderLoad: ProceduralColliderLoadJob | null = null;

export function getActiveProceduralMap(): VoxelMapManifest | null {
  return activeProceduralMap;
}

function chunkLookupIndex(x: number, y: number, z: number, chunksX: number, chunksZ: number): number {
  return x + chunksX * (z + chunksZ * y);
}

function buildActiveProceduralChunkLookup(manifest: VoxelMapManifest): void {
  activeProceduralChunksX = Math.ceil(manifest.size.x / manifest.chunkSize.x);
  activeProceduralChunksZ = Math.ceil(manifest.size.z / manifest.chunkSize.z);
  activeProceduralChunkLookup = new Map<number, VoxelChunk>();

  for (const chunk of manifest.chunks) {
    activeProceduralChunkLookup.set(
      chunkLookupIndex(chunk.coord.x, chunk.coord.y, chunk.coord.z, activeProceduralChunksX, activeProceduralChunksZ),
      chunk
    );
  }
}

function getActiveProceduralBlock(gx: number, gy: number, gz: number): number {
  const manifest = activeProceduralMap;
  if (!manifest) return 0;
  if (gx < 0 || gx >= manifest.size.x || gy < 0 || gy >= manifest.size.y || gz < 0 || gz >= manifest.size.z) {
    return 0;
  }

  const cx = Math.floor(gx / manifest.chunkSize.x);
  const cy = Math.floor(gy / manifest.chunkSize.y);
  const cz = Math.floor(gz / manifest.chunkSize.z);
  const chunk = activeProceduralChunkLookup.get(chunkLookupIndex(cx, cy, cz, activeProceduralChunksX, activeProceduralChunksZ));
  if (!chunk) return 0;

  const lx = gx - cx * manifest.chunkSize.x;
  const ly = gy - cy * manifest.chunkSize.y;
  const lz = gz - cz * manifest.chunkSize.z;
  return chunk.blocks[lx + chunk.size.x * (lz + chunk.size.z * ly)] ?? 0;
}

function getProceduralMapColliderSignature(manifest: VoxelMapManifest): string {
  const stats = manifest.stats as VoxelMapManifest['stats'] & { colliderSignature?: string };
  if (stats.colliderSignature) {
    return `${manifest.id}:${stats.colliderSignature}`;
  }

  let hash = 2166136261 >>> 0;

  const addValue = (value: number) => {
    hash ^= Math.round(value * 1000);
    hash = Math.imul(hash, 16777619) >>> 0;
  };

  addValue(manifest.colliders.length);
  for (const collider of manifest.colliders) {
    addValue(collider.center.x);
    addValue(collider.center.y);
    addValue(collider.center.z);
    addValue(collider.halfExtents.x);
    addValue(collider.halfExtents.y);
    addValue(collider.halfExtents.z);
  }

  return `${manifest.id}:${manifest.colliders.length}:${hash.toString(16)}`;
}

export function configureVisualPhysicsQueryBudget(maxQueriesPerFrame: number): void {
  visualPhysicsQueryBudgetPerFrame = Math.max(0, Math.floor(maxQueriesPerFrame));
}

function getFrameBudgetId(): number {
  return typeof performance !== 'undefined' ? Math.floor(performance.now() / (1000 / 60)) : Date.now();
}

function tryConsumeVisualPhysicsQuery(feature: string): boolean {
  const frame = getFrameBudgetId();
  if (frame !== visualPhysicsQueryFrame) {
    visualPhysicsQueryFrame = frame;
    visualPhysicsQueriesUsed = 0;
  }

  if (visualPhysicsQueriesUsed >= visualPhysicsQueryBudgetPerFrame) {
    return false;
  }

  visualPhysicsQueriesUsed++;
  return true;
}

function shouldRunPhysicsQuery(options?: PhysicsQueryOptions): boolean {
  if (options?.priority !== 'visual') return true;
  return tryConsumeVisualPhysicsQuery(options.feature ?? 'visual');
}

/**
 * Load fixed cuboid colliders generated from the shared procedural voxel map.
 */
export function loadProceduralMapColliders(manifest: VoxelMapManifest): boolean {
  if (!rapierInstance || !worldInstance) {
    console.warn('[Physics] Cannot load procedural map colliders - physics not ready');
    return false;
  }

  const colliderSignature = getProceduralMapColliderSignature(manifest);

  if (loadedProceduralMapId === manifest.id && loadedProceduralMapColliderSignature === colliderSignature) {
    return true;
  }

  if (
    pendingProceduralColliderLoad &&
    pendingProceduralColliderLoad.manifest.id === manifest.id &&
    pendingProceduralColliderLoad.signature === colliderSignature
  ) {
    continueProceduralColliderLoad();
    return false;
  }

  if (pendingProceduralColliderLoad && pendingProceduralColliderLoad.rafId !== null) {
    window.cancelAnimationFrame(pendingProceduralColliderLoad.rafId);
  }
  pendingProceduralColliderLoad = null;

  for (const body of mapColliderBodies) {
    worldInstance.removeRigidBody(body);
  }
  mapColliderBodies = [];
  loadedProceduralMapId = null;
  loadedProceduralMapColliderSignature = null;

  const loadStart = performance.now();

  if (manifest.colliders.length > 0) {
    const bodyDesc = rapierInstance.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
    const mapBody = worldInstance.createRigidBody(bodyDesc);
    mapColliderBodies.push(mapBody);
    pendingProceduralColliderLoad = {
      manifest,
      signature: colliderSignature,
      mapBody,
      nextIndex: 0,
      loadStart,
      rafId: null,
    };
    continueProceduralColliderLoad();
    return false;
  }

  finishProceduralColliderLoad(manifest, colliderSignature, loadStart);
  return true;
}

function scheduleProceduralColliderLoadContinuation(): void {
  if (!pendingProceduralColliderLoad || pendingProceduralColliderLoad.rafId !== null) return;

  pendingProceduralColliderLoad.rafId = window.requestAnimationFrame(() => {
    if (pendingProceduralColliderLoad) pendingProceduralColliderLoad.rafId = null;
    continueProceduralColliderLoad();
  });
}

function continueProceduralColliderLoad(): void {
  if (!rapierInstance || !worldInstance || !pendingProceduralColliderLoad) return;

  const job = pendingProceduralColliderLoad;
  const batchStart = performance.now();
  const maxBatchMs = 4;
  const maxBatchColliders = 384;
  let created = 0;

  while (job.nextIndex < job.manifest.colliders.length) {
    const collider = job.manifest.colliders[job.nextIndex++];
    const colliderDesc = rapierInstance.ColliderDesc.cuboid(
      collider.halfExtents.x,
      collider.halfExtents.y,
      collider.halfExtents.z
    ).setTranslation(
      collider.center.x,
      collider.center.y,
      collider.center.z
    );
    worldInstance.createCollider(colliderDesc, job.mapBody);
    created++;

    if (created >= maxBatchColliders || performance.now() - batchStart >= maxBatchMs) {
      scheduleProceduralColliderLoadContinuation();
      return;
    }
  }

  finishProceduralColliderLoad(job.manifest, job.signature, job.loadStart);
  pendingProceduralColliderLoad = null;
}

function finishProceduralColliderLoad(manifest: VoxelMapManifest, colliderSignature: string, loadStart: number): void {
  if (!worldInstance) return;

  worldInstance.step();
  worldInstance.updateSceneQueries();

  loadedProceduralMapId = manifest.id;
  loadedProceduralMapColliderSignature = colliderSignature;
  activeProceduralMap = manifest;
  buildActiveProceduralChunkLookup(manifest);
}

/**
 * Check if the generated map colliders have been loaded.
 */
export function areProceduralMapCollidersLoaded(manifestOrMapId?: VoxelMapManifest | string): boolean {
  if (!manifestOrMapId) return loadedProceduralMapId !== null;

  if (typeof manifestOrMapId === 'string') {
    return loadedProceduralMapId === manifestOrMapId;
  }

  return (
    loadedProceduralMapId === manifestOrMapId.id &&
    loadedProceduralMapColliderSignature === getProceduralMapColliderSignature(manifestOrMapId)
  );
}

// Utility function for raycasting
export function raycast(
  world: RAPIER.World,
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  maxDistance: number,
  options?: RaycastOptions
): { point: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number }; distance: number } | null {
  if (!rapierInstance || !world) {
    return null;
  }
  if (!shouldRunPhysicsQuery(options)) return null;
  
  try {
    // Create ray - Rapier accepts plain objects
    const ray = new rapierInstance.Ray(origin, direction);
    
    // Cast ray - solidHit=true means we want the first solid hit
    const hit = options?.includeNormal
      ? world.castRayAndGetNormal(ray, maxDistance, true)
      : world.castRay(ray, maxDistance, true);

    if (hit) {
      const hitDistance = hit.timeOfImpact;
      const hitPoint = ray.pointAt(hitDistance);
      const normal = 'normal' in hit && hit.normal
        ? { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z }
        : { x: 0, y: 1, z: 0 };
      
      return {
        point: { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z },
        normal,
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
  maxDistance: number,
  options?: PhysicsQueryOptions
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
  if (!shouldRunPhysicsQuery(options)) return null;
  
  try {
    const origin = { x: originX, y: originY, z: originZ };
    const direction = { x: dirX, y: dirY, z: dirZ };
    const ray = new rapierInstance.Ray(origin, direction);
    
    const hit = worldInstance.castRayAndGetNormal(ray, maxDistance, true);
    
    if (hit) {
      const hitDistance = hit.timeOfImpact;
      const hitPoint = ray.pointAt(hitDistance);
      const normal = {
        x: hit.normal.x,
        y: hit.normal.y,
        z: hit.normal.z
      };
      
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
const HEIGHTFIELD_GROUND_EPSILON = 0.05;

function checkProceduralHeightfieldGround(x: number, y: number, z: number, maxDist: number): GroundInfo | null {
  const manifest = activeProceduralMap;
  if (!manifest || getTemporaryWallColliderCount() > 0) {
    return null;
  }

  const gx = Math.floor((x - manifest.heightfield.origin.x) / manifest.heightfield.voxelSize.x);
  const gz = Math.floor((z - manifest.heightfield.origin.z) / manifest.heightfield.voxelSize.z);
  if (gx < 0 || gx >= manifest.heightfield.size.x || gz < 0 || gz >= manifest.heightfield.size.z) {
    return null;
  }

  const topRow = manifest.heightfield.topSolidRows[gx + gz * manifest.heightfield.size.x];
  if (topRow === 0) return null;

  const groundY = manifest.heightfield.origin.y + topRow * manifest.heightfield.voxelSize.y;
  if (groundY > y + HEIGHTFIELD_GROUND_EPSILON || y - groundY > maxDist) {
    return null;
  }

  const block = getActiveProceduralBlock(gx, topRow - 1, gz);
  const blockDefinition = getBlockDefinition(block);
  if (!blockDefinition.walkable || !isCollisionBlock(block)) {
    return null;
  }

  return {
    groundY,
    normal: { x: 0, y: 1, z: 0 },
    isWalkable: true,
  };
}

export function checkGroundWithNormal(
  x: number,
  y: number,
  z: number,
  maxDist: number = 100,
  options?: PhysicsQueryOptions
): GroundInfo | null {
  if (!rapierInstance || !worldInstance) return null;
  const heightfieldGround = checkProceduralHeightfieldGround(x, y, z, maxDist);
  if (heightfieldGround) return heightfieldGround;
  if (!shouldRunPhysicsQuery(options)) return null;
  
  try {
    const origin = { x, y, z };
    const direction = { x: 0, y: -1, z: 0 };
    const ray = new rapierInstance.Ray(origin, direction);
    
    const hit = worldInstance.castRayAndGetNormal(ray, maxDist, true);
    if (hit) {
      const groundY = y - hit.timeOfImpact;
      const normal = {
        x: hit.normal.x,
        y: hit.normal.y,
        z: hit.normal.z
      };
      
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

const PLAYER_BODY_FLOOR_CLEARANCE = 0.08;
const PLAYER_BODY_HEAD_CLEARANCE = 0.04;
const PLAYER_BODY_CAST_SKIN = 0.02;
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
const playerBodyShapeCache = new Map<string, RAPIER.Capsule>();

function isSolidCollisionCollider(collider: RAPIER.Collider): boolean {
  return collider !== playerColliderInstance && !collider.isSensor();
}

function createPlayerBodyQuery(
  x: number,
  y: number,
  z: number,
  playerRadius: number,
  playerHeight: number
): { position: { x: number; y: number; z: number }; shape: RAPIER.Capsule } | null {
  if (!rapierInstance) return null;

  const queryHeight = Math.max(
    playerRadius * 2 + 0.02,
    playerHeight - PLAYER_BODY_FLOOR_CLEARANCE - PLAYER_BODY_HEAD_CLEARANCE
  );
  const halfHeight = Math.max(0.01, queryHeight / 2 - playerRadius);
  const centerOffsetY = (PLAYER_BODY_FLOOR_CLEARANCE - PLAYER_BODY_HEAD_CLEARANCE) / 2;
  const shapeKey = `${playerRadius}:${playerHeight}:${halfHeight}`;
  let shape = playerBodyShapeCache.get(shapeKey);

  if (!shape) {
    shape = new rapierInstance.Capsule(halfHeight, playerRadius);
    playerBodyShapeCache.set(shapeKey, shape);
  }

  return {
    position: { x, y: y + centerOffsetY, z },
    shape,
  };
}

export function hasPlayerBodyClearance(
  x: number,
  y: number,
  z: number,
  playerRadius: number = PLAYER_RADIUS,
  playerHeight: number = PLAYER_HEIGHT
): boolean {
  if (!rapierInstance || !worldInstance) return true;

  try {
    const query = createPlayerBodyQuery(x, y, z, playerRadius, playerHeight);
    if (!query) return true;

    const hit = worldInstance.intersectionWithShape(
      query.position,
      IDENTITY_ROTATION,
      query.shape,
      undefined,
      undefined,
      playerColliderInstance ?? undefined,
      undefined,
      isSolidCollisionCollider
    );

    return hit === null;
  } catch (e) {
    console.error('[Physics] hasPlayerBodyClearance error:', e);
    return false;
  }
}

export function checkPlayerBodyMovement(
  x: number,
  y: number,
  z: number,
  moveX: number,
  moveZ: number,
  playerRadius: number = PLAYER_RADIUS,
  playerHeight: number = PLAYER_HEIGHT
): {
  blocked: boolean;
  normal: { x: number; y: number; z: number };
  timeOfImpact: number;
} {
  if (!rapierInstance || !worldInstance) {
    return { blocked: false, normal: { x: 0, y: 0, z: 0 }, timeOfImpact: Infinity };
  }

  try {
    const query = createPlayerBodyQuery(x, y, z, playerRadius, playerHeight);
    if (!query) {
      return { blocked: false, normal: { x: 0, y: 0, z: 0 }, timeOfImpact: Infinity };
    }

    const moveLength = Math.sqrt(moveX * moveX + moveZ * moveZ);
    if (moveLength <= 0.0001) {
      return {
        blocked: !hasPlayerBodyClearance(x, y, z, playerRadius, playerHeight),
        normal: { x: 0, y: 0, z: 0 },
        timeOfImpact: 0,
      };
    }

    const hit = worldInstance.castShape(
      query.position,
      IDENTITY_ROTATION,
      { x: moveX, y: 0, z: moveZ },
      query.shape,
      PLAYER_BODY_CAST_SKIN,
      1,
      false,
      undefined,
      undefined,
      playerColliderInstance ?? undefined,
      undefined,
      isSolidCollisionCollider
    );

    if (hit && hit.time_of_impact <= 1) {
      return {
        blocked: true,
        normal: { x: hit.normal2.x, y: hit.normal2.y, z: hit.normal2.z },
        timeOfImpact: hit.time_of_impact,
      };
    }

    const targetHasClearance = hasPlayerBodyClearance(
      x + moveX,
      y,
      z + moveZ,
      playerRadius,
      playerHeight
    );

    return {
      blocked: !targetHasClearance,
      normal: { x: 0, y: 0, z: 0 },
      timeOfImpact: targetHasClearance ? Infinity : 1,
    };
  } catch (e) {
    console.error('[Physics] checkPlayerBodyMovement error:', e);
    return { blocked: true, normal: { x: 0, y: 0, z: 0 }, timeOfImpact: 0 };
  }
}

// Check if a teleport destination is valid (not inside geometry)
// Returns: { valid: boolean, adjustedPosition?: { x, y, z }, reason?: string }
export function validateTeleportDestination(
  targetX: number, 
  targetY: number, 
  targetZ: number,
  playerHeight: number = PLAYER_HEIGHT,
  playerRadius: number = PLAYER_RADIUS
): { valid: boolean; adjustedPosition?: { x: number; y: number; z: number }; reason?: string } {
  if (!rapierInstance || !worldInstance) {
    return { valid: true }; // Allow if physics not ready
  }

  try {
    const playerHalfHeight = playerHeight / 2;
    const feetY = targetY - playerHalfHeight;

    // 1. Check if there's solid ground below the target
    const groundCheck = checkGroundWithNormal(targetX, targetY + 5, targetZ, playerHeight + 10);
    if (!groundCheck) {
      return { valid: false, reason: 'No ground below target' };
    }

    // Use ground-adjusted Y for all further checks
    const adjustedFeetY = groundCheck.groundY;
    const adjustedCenterY = groundCheck.groundY + playerHalfHeight;

    // 2. Check that the full standing hero body fits at the destination.
    if (!hasPlayerBodyClearance(targetX, adjustedCenterY, targetZ, playerRadius, playerHeight)) {
      return {
        valid: false,
        reason: 'Not enough body clearance'
      };
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
  radius: number = PLAYER_RADIUS
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
  playerRadius: number = PLAYER_RADIUS,
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
// TEMPORARY WALL COLLIDERS - Re-exported from separate module
// ============================================================================

import {
  initTemporaryWallSystem,
  updateTemporaryWallWorld,
  addTemporaryWallCollider,
  removeTemporaryWallCollider,
  cleanupExpiredTemporaryWallColliders,
  clearAllTemporaryWallColliders,
  getTemporaryWallColliderCount,
} from './physics/temporaryWallColliders';

// Re-export wall collider functions for ability effects
export {
  addTemporaryWallCollider,
  removeTemporaryWallCollider,
  cleanupExpiredTemporaryWallColliders,
  clearAllTemporaryWallColliders,
  getTemporaryWallColliderCount,
};

// Initialize temporary wall collider system when physics is ready (called after world creation)
function initializeTemporaryWallSystem() {
  if (rapierInstance && worldInstance) {
    initTemporaryWallSystem(rapierInstance, worldInstance);
  }
}
