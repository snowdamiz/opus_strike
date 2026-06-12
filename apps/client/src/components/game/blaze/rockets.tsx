import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import React from 'react';
import {
  PLAYER_COMBAT_HITBOX_PADDING,
  PLAYER_RADIUS,
  doesSegmentHitPlayerCombatHitbox,
  type Player,
} from '@voxel-strike/shared';
import { useGameStore, type RocketData } from '../../../store/gameStore';
import { getPhysicsWorld, isPhysicsReady, raycast } from '../../../hooks/usePhysics';
import { SHARED_GEOMETRIES } from '../effectResources';
import { triggerTerrainImpact } from '../TerrainImpactEffects';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { getFrameClock } from '../../../utils/frameClock';
import { fillCombatVisualEnemyPlayers, rebuildCombatVisualFrameCache } from '../../../store/visualStore';
import {
  getFireballCoreMaterial,
  getFireballInnerMaterial,
  getFireballOuterMaterial,
  getFireballTrailCoreMaterial,
  getFireballTrailInnerMaterial,
  getFireballTrailOuterMaterial,
} from './materials';

// ============================================================================
// BLAZE PRIMARY PROJECTILE
// ============================================================================

const MAX_ROCKETS = 50;
const ROCKET_LIFETIME = 3000;
const PROJECTILE_RADIUS = 0.21;
const PROJECTILE_COMBAT_QUERY_PADDING = PLAYER_RADIUS + PLAYER_COMBAT_HITBOX_PADDING + 0.75;
const ROCKET_IMPACT_SCALE = 1.15;
const FIREBALL_FLICKER_RATE = 0.018;
const FIREBALL_TRAIL_FLICKER_RATE = 0.024;

interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

interface RocketRuntimeSlot {
  active: boolean;
  id: string;
  ownerId: string;
  ownerTeam: RocketData['ownerTeam'];
  position: MutableVec3;
  velocity: MutableVec3;
  direction: MutableVec3;
  speed: number;
  expiresAtMs: number;
}

const ZERO_VEC3 = { x: 0, y: 0, z: 0 };
const PROJECTILE_FORWARD = new THREE.Vector3(0, 0, -1);
const FLAME_TRAIL_ROTATION = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));

const FIREBALL_PARTS = {
  outer: {
    scale: new THREE.Vector3(0.32, 0.32, 0.32),
    offset: null,
  },
  inner: {
    scale: new THREE.Vector3(0.23, 0.23, 0.23),
    offset: new THREE.Vector3(0, 0, -0.02),
  },
  core: {
    scale: new THREE.Vector3(0.14, 0.14, 0.14),
    offset: new THREE.Vector3(0, 0, -0.04),
  },
  trailCore: {
    scale: new THREE.Vector3(0.08, 0.48, 0.08),
    offset: new THREE.Vector3(0, 0, 0.25),
    rotation: FLAME_TRAIL_ROTATION,
  },
  trailInner: {
    scale: new THREE.Vector3(0.14, 0.66, 0.14),
    offset: new THREE.Vector3(0, 0, 0.48),
    rotation: FLAME_TRAIL_ROTATION,
  },
  trailOuter: {
    scale: new THREE.Vector3(0.22, 0.88, 0.22),
    offset: new THREE.Vector3(0, 0, 0.72),
    rotation: FLAME_TRAIL_ROTATION,
  },
} as const;

function normalizeInto(input: MutableVec3, output: MutableVec3): number {
  const speed = Math.sqrt(input.x * input.x + input.y * input.y + input.z * input.z);
  if (speed <= 0.0001) {
    output.x = 0;
    output.y = 0;
    output.z = -1;
    return 0;
  }

  output.x = input.x / speed;
  output.y = input.y / speed;
  output.z = input.z / speed;
  return speed;
}

class RocketRuntimePool {
  private readonly slots: RocketRuntimeSlot[];
  private readonly freeList: number[];
  private readonly idToSlot = new Map<string, number>();
  private overflowCursor = 0;
  activeCount = 0;

  constructor(private readonly capacity = MAX_ROCKETS) {
    this.slots = Array.from({ length: capacity }, () => ({
      active: false,
      id: '',
      ownerId: '',
      ownerTeam: 'red',
      position: { ...ZERO_VEC3 },
      velocity: { ...ZERO_VEC3 },
      direction: { x: 0, y: 0, z: -1 },
      speed: 0,
      expiresAtMs: 0,
    }));
    this.freeList = Array.from({ length: capacity }, (_, i) => capacity - 1 - i);
  }

  add(rocket: RocketData, expiresAtMs: number): void {
    if (this.idToSlot.has(rocket.id)) return;

    const slotIndex = this.allocateSlot();
    const slot = this.slots[slotIndex];
    if (!slot.active) this.activeCount++;

    slot.active = true;
    slot.id = rocket.id;
    slot.ownerId = rocket.ownerId;
    slot.ownerTeam = rocket.ownerTeam;
    slot.position.x = rocket.position.x;
    slot.position.y = rocket.position.y;
    slot.position.z = rocket.position.z;
    slot.velocity.x = rocket.velocity.x;
    slot.velocity.y = rocket.velocity.y;
    slot.velocity.z = rocket.velocity.z;
    slot.speed = normalizeInto(slot.velocity, slot.direction);
    slot.expiresAtMs = expiresAtMs;

    this.idToSlot.set(rocket.id, slotIndex);
  }

  removeMissing(activeIds: Set<string>): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.active && !activeIds.has(slot.id)) {
        this.deactivate(i);
      }
    }
  }

  forEachActive(callback: (slot: RocketRuntimeSlot, slotIndex: number) => void): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.active) callback(slot, i);
    }
  }

  deactivate(index: number): void {
    const slot = this.slots[index];
    if (!slot.active) return;

    this.idToSlot.delete(slot.id);
    slot.active = false;
    slot.id = '';
    slot.ownerId = '';
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.freeList.push(index);
  }

  private allocateSlot(): number {
    const free = this.freeList.pop();
    if (free !== undefined) return free;

    for (let i = 0; i < this.capacity; i++) {
      const index = (this.overflowCursor + i) % this.capacity;
      if (this.slots[index].active) {
        this.idToSlot.delete(this.slots[index].id);
        this.slots[index].active = false;
        this.activeCount = Math.max(0, this.activeCount - 1);
        this.overflowCursor = (index + 1) % this.capacity;
        return index;
      }
    }

    return 0;
  }
}

function setFireballPartInstance(
  mesh: THREE.InstancedMesh | null,
  dummy: THREE.Object3D,
  offset: THREE.Vector3 | null,
  projectileQuaternion: THREE.Quaternion,
  slot: RocketRuntimeSlot,
  index: number,
  scale: THREE.Vector3,
  scratchOffset: THREE.Vector3,
  scratchScale: THREE.Vector3,
  scaleMultiplier = 1,
  rotation?: THREE.Quaternion
): void {
  if (!mesh) return;

  dummy.position.set(slot.position.x, slot.position.y, slot.position.z);
  if (offset) {
    scratchOffset.copy(offset).applyQuaternion(projectileQuaternion);
    dummy.position.add(scratchOffset);
  }
  dummy.quaternion.copy(projectileQuaternion);
  if (rotation) {
    dummy.quaternion.multiply(rotation);
  }
  scratchScale.copy(scale).multiplyScalar(scaleMultiplier);
  dummy.scale.copy(scratchScale);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

function setInstancedMeshCount(mesh: THREE.InstancedMesh | null, count: number): void {
  if (!mesh) return;
  mesh.count = count;
  if (count > 0) {
    mesh.instanceMatrix.needsUpdate = true;
  }
}

export function prewarmRocketResources(renderer?: THREE.WebGLRenderer): void {
  getFireballCoreMaterial();
  getFireballInnerMaterial();
  getFireballOuterMaterial();
  getFireballTrailCoreMaterial();
  getFireballTrailInnerMaterial();
  getFireballTrailOuterMaterial();

  if (!renderer) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
  const matrix = new THREE.Matrix4().makeScale(0.25, 0.25, 0.25);
  camera.position.z = 3;

  const meshes = [
    new THREE.InstancedMesh(SHARED_GEOMETRIES.sphere12, getFireballOuterMaterial(), 1),
    new THREE.InstancedMesh(SHARED_GEOMETRIES.sphere8, getFireballInnerMaterial(), 1),
    new THREE.InstancedMesh(SHARED_GEOMETRIES.sphere6, getFireballCoreMaterial(), 1),
    new THREE.InstancedMesh(SHARED_GEOMETRIES.cone8, getFireballTrailOuterMaterial(), 1),
    new THREE.InstancedMesh(SHARED_GEOMETRIES.cone8, getFireballTrailInnerMaterial(), 1),
    new THREE.InstancedMesh(SHARED_GEOMETRIES.cone8, getFireballTrailCoreMaterial(), 1),
  ];

  for (const mesh of meshes) {
    mesh.setMatrixAt(0, matrix);
    scene.add(mesh);
  }

  renderer.compile(scene, camera);
}

// ============================================================================
// FIREBALLS MANAGER
// ============================================================================

export function RocketsManager() {
  const storeRockets = useGameStore(state => state.rockets);
  const removeRockets = useGameStore(state => state.removeRockets);
  const poolRef = useRef<RocketRuntimePool>();
  const removalsRef = useRef<string[]>([]);
  const activeStoreIdsRef = useRef<Set<string>>(new Set());
  const enemyPlayersRef = useRef<Player[]>([]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const rocketQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const rocketDirection = useMemo(() => new THREE.Vector3(0, 0, -1), []);
  const partOffset = useMemo(() => new THREE.Vector3(), []);
  const partScale = useMemo(() => new THREE.Vector3(), []);

  const fireballOuterMeshRef = useRef<THREE.InstancedMesh>(null);
  const fireballInnerMeshRef = useRef<THREE.InstancedMesh>(null);
  const fireballCoreMeshRef = useRef<THREE.InstancedMesh>(null);
  const trailOuterMeshRef = useRef<THREE.InstancedMesh>(null);
  const trailInnerMeshRef = useRef<THREE.InstancedMesh>(null);
  const trailCoreMeshRef = useRef<THREE.InstancedMesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  if (!poolRef.current) {
    poolRef.current = new RocketRuntimePool(MAX_ROCKETS);
  }
  useEffect(() => {
    const pool = poolRef.current;
    if (!pool) return;

    const activeIds = activeStoreIdsRef.current;
    const nowDateMs = Date.now();
    const frameNowMs = getFrameClock().nowMs;

    activeIds.clear();
    for (const rocket of storeRockets) {
      activeIds.add(rocket.id);
      const ageMs = Math.max(0, nowDateMs - rocket.startTime);
      const expiresAtMs = frameNowMs + Math.max(0, ROCKET_LIFETIME - ageMs);
      pool.add(rocket, expiresAtMs);
    }
    pool.removeMissing(activeIds);
  }, [storeRockets]);

  useFrame(() => {
    const pool = poolRef.current;
    if (!pool) return;

    const clock = getFrameClock();
    const delta = clock.clampedDeltaSeconds;
    let instanceIndex = 0;
    let lightX = 0;
    let lightY = 0;
    let lightZ = 0;

    const removals = removalsRef.current;
    removals.length = 0;

    if (pool.activeCount === 0) {
      setInstancedMeshCount(fireballOuterMeshRef.current, 0);
      setInstancedMeshCount(fireballInnerMeshRef.current, 0);
      setInstancedMeshCount(fireballCoreMeshRef.current, 0);
      setInstancedMeshCount(trailOuterMeshRef.current, 0);
      setInstancedMeshCount(trailInnerMeshRef.current, 0);
      setInstancedMeshCount(trailCoreMeshRef.current, 0);
      if (lightRef.current) lightRef.current.intensity = 0;
      return;
    }

    const store = useGameStore.getState();
    const enemies = enemyPlayersRef.current;
    const combatCache = rebuildCombatVisualFrameCache(store.players.values(), clock.nowMs, clock.nowMs, store.players.size);
    const physicsWorld = isPhysicsReady() ? getPhysicsWorld() : null;

    pool.forEachActive((slot, slotIndex) => {
      if (clock.nowMs >= slot.expiresAtMs) {
        removals.push(slot.id);
        pool.deactivate(slotIndex);
        return;
      }

      const moveDistance = slot.speed * delta;
      if (moveDistance > 0.001 && physicsWorld) {
        const hit = raycast(physicsWorld, slot.position, slot.direction, moveDistance + PROJECTILE_RADIUS, {
          priority: 'visual',
          feature: 'projectile:blazeRocket',
        });
        if (hit && hit.distance <= moveDistance + PROJECTILE_RADIUS) {
          triggerTerrainImpact('blaze_rocket', hit.point, {
            normal: hit.normal,
            direction: slot.direction,
            scale: ROCKET_IMPACT_SCALE,
          });
          removals.push(slot.id);
          pool.deactivate(slotIndex);
          return;
        }
      }

      fillCombatVisualEnemyPlayers(
        combatCache,
        slot.ownerTeam,
        slot.ownerId,
        enemies,
        slot.position,
        moveDistance + PROJECTILE_RADIUS + PROJECTILE_COMBAT_QUERY_PADDING
      );
      for (let i = 0; i < enemies.length; i++) {
        const player = enemies[i];
        if (doesSegmentHitPlayerCombatHitbox(slot.position, slot.direction, moveDistance, player, PROJECTILE_RADIUS)) {
          triggerTerrainImpact('blaze_rocket', slot.position, {
            direction: slot.direction,
            scale: ROCKET_IMPACT_SCALE,
          });
          removals.push(slot.id);
          pool.deactivate(slotIndex);
          return;
        }
      }

      slot.position.x += slot.velocity.x * delta;
      slot.position.y += slot.velocity.y * delta;
      slot.position.z += slot.velocity.z * delta;

      rocketDirection.set(slot.direction.x, slot.direction.y, slot.direction.z);
      rocketQuaternion.setFromUnitVectors(PROJECTILE_FORWARD, rocketDirection);

      const headPulse = 1 + Math.sin(clock.nowMs * FIREBALL_FLICKER_RATE + slotIndex * 1.7) * 0.07;
      const trailPulse = 1 + Math.cos(clock.nowMs * FIREBALL_TRAIL_FLICKER_RATE + slotIndex * 2.3) * 0.11;

      setFireballPartInstance(trailOuterMeshRef.current, dummy, FIREBALL_PARTS.trailOuter.offset, rocketQuaternion, slot, instanceIndex, FIREBALL_PARTS.trailOuter.scale, partOffset, partScale, trailPulse, FIREBALL_PARTS.trailOuter.rotation);
      setFireballPartInstance(trailInnerMeshRef.current, dummy, FIREBALL_PARTS.trailInner.offset, rocketQuaternion, slot, instanceIndex, FIREBALL_PARTS.trailInner.scale, partOffset, partScale, trailPulse * 0.96, FIREBALL_PARTS.trailInner.rotation);
      setFireballPartInstance(trailCoreMeshRef.current, dummy, FIREBALL_PARTS.trailCore.offset, rocketQuaternion, slot, instanceIndex, FIREBALL_PARTS.trailCore.scale, partOffset, partScale, trailPulse * 1.04, FIREBALL_PARTS.trailCore.rotation);
      setFireballPartInstance(fireballOuterMeshRef.current, dummy, FIREBALL_PARTS.outer.offset, rocketQuaternion, slot, instanceIndex, FIREBALL_PARTS.outer.scale, partOffset, partScale, headPulse);
      setFireballPartInstance(fireballInnerMeshRef.current, dummy, FIREBALL_PARTS.inner.offset, rocketQuaternion, slot, instanceIndex, FIREBALL_PARTS.inner.scale, partOffset, partScale, headPulse * 0.98);
      setFireballPartInstance(fireballCoreMeshRef.current, dummy, FIREBALL_PARTS.core.offset, rocketQuaternion, slot, instanceIndex, FIREBALL_PARTS.core.scale, partOffset, partScale, headPulse * 1.05);

      lightX += slot.position.x;
      lightY += slot.position.y;
      lightZ += slot.position.z;
      instanceIndex++;
    });

    setInstancedMeshCount(fireballOuterMeshRef.current, instanceIndex);
    setInstancedMeshCount(fireballInnerMeshRef.current, instanceIndex);
    setInstancedMeshCount(fireballCoreMeshRef.current, instanceIndex);
    setInstancedMeshCount(trailOuterMeshRef.current, instanceIndex);
    setInstancedMeshCount(trailInnerMeshRef.current, instanceIndex);
    setInstancedMeshCount(trailCoreMeshRef.current, instanceIndex);

    if (lightRef.current) {
      if (instanceIndex > 0) {
        lightRef.current.position.set(lightX / instanceIndex, lightY / instanceIndex, lightZ / instanceIndex);
        lightRef.current.intensity = Math.min(instanceIndex * 2.6, 12);
      } else {
        lightRef.current.intensity = 0;
      }
    }

    if (removals.length > 0) {
      removeRockets(removals);
      removals.length = 0;
    }
  });

  return (
    <group>
      <instancedMesh
        ref={trailOuterMeshRef}
        args={[SHARED_GEOMETRIES.cone8, getFireballTrailOuterMaterial(), MAX_ROCKETS]}
        count={0}
        frustumCulled={false}
      />
      <instancedMesh
        ref={trailInnerMeshRef}
        args={[SHARED_GEOMETRIES.cone8, getFireballTrailInnerMaterial(), MAX_ROCKETS]}
        count={0}
        frustumCulled={false}
      />
      <instancedMesh
        ref={trailCoreMeshRef}
        args={[SHARED_GEOMETRIES.cone8, getFireballTrailCoreMaterial(), MAX_ROCKETS]}
        count={0}
        frustumCulled={false}
      />
      <instancedMesh
        ref={fireballOuterMeshRef}
        args={[SHARED_GEOMETRIES.sphere12, getFireballOuterMaterial(), MAX_ROCKETS]}
        count={0}
        frustumCulled={false}
      />
      <instancedMesh
        ref={fireballInnerMeshRef}
        args={[SHARED_GEOMETRIES.sphere8, getFireballInnerMaterial(), MAX_ROCKETS]}
        count={0}
        frustumCulled={false}
      />
      <instancedMesh
        ref={fireballCoreMeshRef}
        args={[SHARED_GEOMETRIES.sphere6, getFireballCoreMaterial(), MAX_ROCKETS]}
        count={0}
        frustumCulled={false}
      />
      <BudgetedPointLight
        budgetPriority={4}
        ref={lightRef}
        color={0xff9a33}
        intensity={0}
        distance={14}
        decay={2}
      />
    </group>
  );
}

// ============================================================================
// ROCKET JUMP EXPLOSION - Optimized
// ============================================================================

interface RocketJumpExplosionData {
  id: string;
  position: { x: number; y: number; z: number };
  startTime: number;
  frameStartTime: number;
}

const rocketJumpExplosions: RocketJumpExplosionData[] = [];
let explosionIdCounter = 0;
let rocketJumpExplosionRevision = 0;

export function triggerRocketJumpExplosion(position: { x: number; y: number; z: number }) {
  rocketJumpExplosions.push({
    id: `rj_${explosionIdCounter++}`,
    position: { ...position },
    startTime: Date.now(),
    frameStartTime: getFrameClock().nowMs,
  });
  rocketJumpExplosionRevision++;
}

export const ROCKET_JUMP_DURATION = 900; // Longer for more dramatic effect

// Pre-generate spark directions for rocket jump
const ROCKET_JUMP_SPARKS = Array.from({ length: 12 }, (_, i) => ({
  angle: (i / 12) * Math.PI * 2 + Math.random() * 0.5,
  speed: 4 + Math.random() * 6,
  ySpeed: 6 + Math.random() * 8,
  size: 0.04 + Math.random() * 0.06,
}));

const RocketJumpExplosion = React.memo(({ explosion }: { explosion: RocketJumpExplosionData }) => {
  const groupRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const midRef = useRef<THREE.Mesh>(null);
  const outerRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);
  const smokeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const sparkRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  
  useFrame(() => {
    const elapsed = getFrameClock().nowMs - explosion.frameStartTime;
    if (elapsed > ROCKET_JUMP_DURATION) return;
    
    const progress = elapsed / ROCKET_JUMP_DURATION;
    const easeOut = 1 - Math.pow(1 - progress, 2);
    const easeOutQuart = 1 - Math.pow(1 - progress, 4);
    const fadeOut = Math.max(0, 1 - progress * 1.2);
    const fadeOutSlow = Math.max(0, 1 - progress);
    
    // Initial flash (very quick)
    if (flashRef.current) {
      const flashProgress = Math.min(1, elapsed / 80);
      const flashScale = 0.5 + flashProgress * 2;
      flashRef.current.scale.setScalar(flashScale);
      (flashRef.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - flashProgress * 2);
    }
    
    // Core explosion
    if (coreRef.current) {
      const s = 0.4 + easeOut * 2.5;
      coreRef.current.scale.setScalar(s);
      (coreRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.95;
    }
    if (midRef.current) {
      const s = 0.6 + easeOut * 3;
      midRef.current.scale.setScalar(s);
      (midRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.8;
    }
    if (outerRef.current) {
      const s = 0.8 + easeOut * 3.5;
      outerRef.current.scale.setScalar(s);
      (outerRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.5;
    }
    
    // Shockwave rings
    if (ringRef.current) {
      const s = 0.5 + easeOutQuart * 5;
      ringRef.current.scale.set(s, s, 1);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.7;
    }
    if (ring2Ref.current) {
      const s = 0.3 + easeOutQuart * 4;
      ring2Ref.current.scale.set(s, s, 1);
      (ring2Ref.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.5;
    }
    
    // Rising smoke puffs
    smokeRefs.current.forEach((smoke, i) => {
      if (smoke) {
        const smokeDelay = i * 50;
        const smokeElapsed = Math.max(0, elapsed - smokeDelay);
        const smokeProgress = Math.min(1, smokeElapsed / 600);
        const y = smokeProgress * (2 + i * 0.5);
        const smokeScale = 0.3 + smokeProgress * (0.8 + i * 0.2);
        smoke.position.y = y;
        smoke.scale.setScalar(smokeScale);
        (smoke.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.5 - smokeProgress * 0.5);
      }
    });
    
    // Flying sparks
    const t = elapsed / 1000;
    sparkRefs.current.forEach((spark, i) => {
      if (spark && i < ROCKET_JUMP_SPARKS.length) {
        const s = ROCKET_JUMP_SPARKS[i];
        const sparkX = Math.cos(s.angle) * s.speed * t;
        const sparkY = s.ySpeed * t - 15 * t * t;
        const sparkZ = Math.sin(s.angle) * s.speed * t;
        spark.position.set(sparkX, Math.max(-0.3, sparkY), sparkZ);
        spark.scale.setScalar(s.size * fadeOutSlow);
        (spark.material as THREE.MeshBasicMaterial).opacity = sparkY > 0 ? fadeOutSlow : 0;
      }
    });
    
    // Light
    if (lightRef.current) {
      lightRef.current.intensity = fadeOut * 25;
    }
  });
  
  const elapsed = getFrameClock().nowMs - explosion.frameStartTime;
  if (elapsed > ROCKET_JUMP_DURATION) return null;
  
  return (
    <group ref={groupRef} position={[explosion.position.x, explosion.position.y - 0.3, explosion.position.z]}>
      {/* Initial bright flash */}
      <mesh ref={flashRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xffffff} transparent opacity={1} />
      </mesh>
      
      {/* Core - white hot */}
      <mesh ref={coreRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xffffcc} transparent opacity={0.95} />
      </mesh>
      
      {/* Mid - orange fire */}
      <mesh ref={midRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xff8800} transparent opacity={0.8} />
      </mesh>
      
      {/* Outer - red fire */}
      <mesh ref={outerRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xff3300} transparent opacity={0.5} />
      </mesh>
      
      {/* Primary shockwave ring */}
      <mesh ref={ringRef} rotation-x={-Math.PI / 2} position-y={0.1} geometry={SHARED_GEOMETRIES.ring24}>
        <meshBasicMaterial color={0xff6600} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Secondary inner ring */}
      <mesh ref={ring2Ref} rotation-x={-Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.ring16}>
        <meshBasicMaterial color={0xffaa00} transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Rising smoke puffs */}
      {[0, 1, 2, 3].map(i => (
        <mesh 
          key={`smoke-${i}`}
          ref={el => smokeRefs.current[i] = el}
          position={[Math.sin(i * 1.5) * 0.3, 0, Math.cos(i * 1.5) * 0.3]}
          geometry={SHARED_GEOMETRIES.sphere8}
        >
          <meshBasicMaterial color={0x555555} transparent opacity={0.4} />
        </mesh>
      ))}
      
      {/* Flying sparks */}
      {ROCKET_JUMP_SPARKS.map((_, i) => (
        <mesh 
          key={`spark-${i}`}
          ref={el => sparkRefs.current[i] = el}
          geometry={SHARED_GEOMETRIES.sphere8}
        >
          <meshBasicMaterial color={0xffcc00} transparent opacity={1} />
        </mesh>
      ))}
      
      {/* Ground scorch */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} geometry={SHARED_GEOMETRIES.circle16} scale={[1.5, 1.5, 1]}>
        <meshBasicMaterial color={0x331100} transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
      
      <BudgetedPointLight budgetPriority={7} ref={lightRef} color={0xff5500} intensity={25} distance={15} decay={2} />
    </group>
  );
}, (prev, next) => {
  // Custom comparison for object props (explosion)
  return (
    prev.explosion.id === next.explosion.id &&
    prev.explosion.position.x === next.explosion.position.x &&
    prev.explosion.position.y === next.explosion.position.y &&
    prev.explosion.position.z === next.explosion.position.z &&
    prev.explosion.startTime === next.explosion.startTime
  );
});

// Hook to manage rocket jump explosions
export function useRocketJumpExplosions() {
  const [activeExplosions, setActiveExplosions] = useState<RocketJumpExplosionData[]>([]);
  const lastRevisionRef = useRef(-1);

  useFrame(() => {
    const now = getFrameClock().nowMs;
    let changed = lastRevisionRef.current !== rocketJumpExplosionRevision;

    for (let i = rocketJumpExplosions.length - 1; i >= 0; i--) {
      if (now - rocketJumpExplosions[i].frameStartTime >= ROCKET_JUMP_DURATION) {
        rocketJumpExplosions.splice(i, 1);
        changed = true;
      }
    }

    if (changed) {
      lastRevisionRef.current = rocketJumpExplosionRevision;
      setActiveExplosions([...rocketJumpExplosions]);
    }
  });
  
  return activeExplosions;
}

export function RocketJumpExplosions() {
  const activeExplosions = useRocketJumpExplosions();
  
  return (
    <>
      {activeExplosions.map(explosion => (
        <RocketJumpExplosion key={explosion.id} explosion={explosion} />
      ))}
    </>
  );
}
