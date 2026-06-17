import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  BLAZE_ROCKET_COLLISION_RADIUS,
  BLAZE_ROCKET_DAMAGE,
  PLAYER_COMBAT_HITBOX_PADDING,
  PLAYER_RADIUS,
} from '@voxel-strike/shared';
import { useGameStore, type RocketData } from '../../../store/gameStore';
import { getPhysicsWorld, isPhysicsReady, raycast } from '../../../hooks/usePhysics';
import { SHARED_GEOMETRIES } from '../effectResources';
import { triggerTerrainImpact } from '../TerrainImpactEffects';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { getFrameClock } from '../../../utils/frameClock';
import { findCombatVisualEnemyPlayerHit, rebuildCombatVisualFrameCache } from '../../../store/visualStore';
import { getFirstChronosAegisVisualHit } from '../chronos/aegisCollision';
import { applyTutorialTrainingDamage } from '../../../utils/tutorialTrainingHeroes';
import {
  getFireballCoreMaterial,
  getFireballInnerMaterial,
  getFireballOuterMaterial,
  getFireballTrailCoreMaterial,
  getFireballTrailInnerMaterial,
  getFireballTrailOuterMaterial,
} from './materials';
import { playPrimaryImpactSound } from '../primaryImpactSound';

// ============================================================================
// BLAZE PRIMARY PROJECTILE
// ============================================================================

const MAX_ROCKETS = 50;
const ROCKET_LIFETIME = 3000;
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
  impactPosition: MutableVec3 | null;
  interceptedByChronosAegis: boolean;
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
      impactPosition: null,
      interceptedByChronosAegis: false,
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
    slot.impactPosition = rocket.impactPosition
      ? { ...rocket.impactPosition }
      : null;
    slot.interceptedByChronosAegis = Boolean(rocket.interceptedByChronosAegis);
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
    slot.impactPosition = null;
    slot.interceptedByChronosAegis = false;
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

function markInstancedMeshesDynamic(meshes: readonly (THREE.InstancedMesh | null)[]): void {
  for (const mesh of meshes) {
    mesh?.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
}

function getAuthoritativeRocketImpactHit(
  slot: RocketRuntimeSlot,
  collisionDistance: number
): { point: MutableVec3; normal: MutableVec3; distance: number } | null {
  if (!slot.impactPosition) return null;

  const toImpact = {
    x: slot.impactPosition.x - slot.position.x,
    y: slot.impactPosition.y - slot.position.y,
    z: slot.impactPosition.z - slot.position.z,
  };
  const forwardDistance =
    toImpact.x * slot.direction.x +
    toImpact.y * slot.direction.y +
    toImpact.z * slot.direction.z;

  if (forwardDistance < -BLAZE_ROCKET_COLLISION_RADIUS || forwardDistance > collisionDistance) {
    return null;
  }

  return {
    point: slot.impactPosition,
    normal: {
      x: -slot.direction.x,
      y: -slot.direction.y,
      z: -slot.direction.z,
    },
    distance: Math.max(0, forwardDistance),
  };
}

export function prewarmRocketResources(): void {
  getFireballCoreMaterial();
  getFireballInnerMaterial();
  getFireballOuterMaterial();
  getFireballTrailCoreMaterial();
  getFireballTrailInnerMaterial();
  getFireballTrailOuterMaterial();
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
    markInstancedMeshesDynamic([
      fireballOuterMeshRef.current,
      fireballInnerMeshRef.current,
      fireballCoreMeshRef.current,
      trailOuterMeshRef.current,
      trailInnerMeshRef.current,
      trailCoreMeshRef.current,
    ]);
  }, []);

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
    const combatCache = rebuildCombatVisualFrameCache(store.players.values(), clock.nowMs, clock.nowMs, store.players.size);
    const physicsWorld = isPhysicsReady() ? getPhysicsWorld() : null;

    pool.forEachActive((slot, slotIndex) => {
      if (clock.nowMs >= slot.expiresAtMs) {
        removals.push(slot.id);
        pool.deactivate(slotIndex);
        return;
      }

      const moveDistance = slot.speed * delta;
      if (moveDistance > 0.001) {
        const collisionDistance = moveDistance + BLAZE_ROCKET_COLLISION_RADIUS;
        const authoritativeHit = getAuthoritativeRocketImpactHit(slot, collisionDistance);
        const aegisHit = getFirstChronosAegisVisualHit(
          slot.position,
          slot.direction,
          collisionDistance,
          slot.ownerTeam,
          slot.ownerId,
          BLAZE_ROCKET_COLLISION_RADIUS
        );
        const terrainHit = physicsWorld
          ? raycast(physicsWorld, slot.position, slot.direction, collisionDistance, {
            priority: 'visual',
            feature: 'projectile:blazeRocket',
          })
          : null;
        let hit = authoritativeHit;
        if (aegisHit && (!hit || aegisHit.distance <= hit.distance)) {
          hit = aegisHit;
        }
        if (terrainHit && (!hit || terrainHit.distance <= hit.distance)) {
          hit = terrainHit;
        }
        if (hit && hit.distance <= collisionDistance) {
          triggerTerrainImpact('blaze_rocket', hit.point, {
            normal: hit.normal,
            direction: slot.direction,
            scale: ROCKET_IMPACT_SCALE,
          });
          playPrimaryImpactSound('blaze', hit.point);
          removals.push(slot.id);
          pool.deactivate(slotIndex);
          return;
        }
      }

      const hitPlayer = findCombatVisualEnemyPlayerHit(
        combatCache,
        slot.ownerTeam,
        slot.ownerId,
        slot.position,
        slot.direction,
        moveDistance,
        BLAZE_ROCKET_COLLISION_RADIUS,
        slot.position,
        moveDistance + BLAZE_ROCKET_COLLISION_RADIUS + PROJECTILE_COMBAT_QUERY_PADDING
      );
      if (hitPlayer) {
        applyTutorialTrainingDamage({
          target: hitPlayer,
          damage: BLAZE_ROCKET_DAMAGE,
          damageType: 'rocket',
          hitPosition: slot.position,
          sourceId: slot.ownerId,
          sourceTeam: slot.ownerTeam,
          abilityId: 'blaze_rocket',
        });
        triggerTerrainImpact('blaze_rocket', slot.position, {
          direction: slot.direction,
          scale: ROCKET_IMPACT_SCALE,
        });
        playPrimaryImpactSound('blaze', slot.position);
        removals.push(slot.id);
        pool.deactivate(slotIndex);
        return;
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
