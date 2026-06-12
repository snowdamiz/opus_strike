import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  CHRONOS_ASCENDANT_PARADOX_PULSE_RADIUS,
  PLAYER_COMBAT_HITBOX_PADDING,
  PLAYER_RADIUS,
  doesSegmentHitPlayerCombatHitbox,
  type Player,
} from '@voxel-strike/shared';
import { useGameStore, type ChronosPulseData } from '../../../store/gameStore';
import { getPhysicsWorld, isPhysicsReady, raycast } from '../../../hooks/usePhysics';
import { getFrameClock } from '../../../utils/frameClock';
import { SHARED_GEOMETRIES } from '../effectResources';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { triggerTerrainImpact } from '../TerrainImpactEffects';
import { playSharedSound } from '../../../hooks/useAudio';
import { fillCombatVisualEnemyPlayers, rebuildCombatVisualFrameCache } from '../../../store/visualStore';

const CHRONOS_PULSE_CAPACITY = 96;
const CHRONOS_PULSE_LIFETIME_MS = 3000;
const CHRONOS_PULSE_RADIUS = 0.12;
const CHRONOS_PULSE_COLLISION_RADIUS = 0.18;
const PROJECTILE_COMBAT_QUERY_PADDING = PLAYER_RADIUS + PLAYER_COMBAT_HITBOX_PADDING + 0.75;
const CHRONOS_IMPACT_CLIP_MS = 350;
const CHRONOS_REGULAR_IMPACT_VOLUME = 0.78;
const RING_FORWARD = new THREE.Vector3(0, 0, 1);
const ZERO_VEC3 = { x: 0, y: 0, z: 0 };

interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

interface ChronosPulseRuntimeSlot {
  active: boolean;
  id: string;
  ownerId: string;
  ownerTeam: ChronosPulseData['ownerTeam'];
  position: MutableVec3;
  velocity: MutableVec3;
  direction: MutableVec3;
  speed: number;
  expiresAtMs: number;
  radiusScale: number;
  supercharged: boolean;
}

let sharedPulseCoreMaterial: THREE.MeshBasicMaterial | null = null;
let sharedPulseGlowMaterial: THREE.MeshBasicMaterial | null = null;
let sharedPulseRingMaterial: THREE.MeshBasicMaterial | null = null;

function getPulseCoreMaterial(): THREE.MeshBasicMaterial {
  if (!sharedPulseCoreMaterial) {
    sharedPulseCoreMaterial = new THREE.MeshBasicMaterial({
      color: 0xb7ffd1,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
  }

  return sharedPulseCoreMaterial;
}

function getPulseGlowMaterial(): THREE.MeshBasicMaterial {
  if (!sharedPulseGlowMaterial) {
    sharedPulseGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
  }

  return sharedPulseGlowMaterial;
}

function getPulseRingMaterial(): THREE.MeshBasicMaterial {
  if (!sharedPulseRingMaterial) {
    sharedPulseRingMaterial = new THREE.MeshBasicMaterial({
      color: 0x86efac,
      transparent: true,
      opacity: 0.46,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  }

  return sharedPulseRingMaterial;
}

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

class ChronosPulseRuntimePool {
  private readonly slots: ChronosPulseRuntimeSlot[];
  private readonly freeList: number[];
  private readonly idToSlot = new Map<string, number>();
  private overflowCursor = 0;
  activeCount = 0;

  constructor(private readonly capacity = CHRONOS_PULSE_CAPACITY) {
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
      radiusScale: 1,
      supercharged: false,
    }));
    this.freeList = Array.from({ length: capacity }, (_, i) => capacity - 1 - i);
  }

  add(pulse: ChronosPulseData, expiresAtMs: number): void {
    if (this.idToSlot.has(pulse.id)) return;

    const slotIndex = this.allocateSlot();
    const slot = this.slots[slotIndex];
    if (!slot.active) this.activeCount++;

    slot.active = true;
    slot.id = pulse.id;
    slot.ownerId = pulse.ownerId;
    slot.ownerTeam = pulse.ownerTeam;
    slot.position.x = pulse.position.x;
    slot.position.y = pulse.position.y;
    slot.position.z = pulse.position.z;
    slot.velocity.x = pulse.velocity.x;
    slot.velocity.y = pulse.velocity.y;
    slot.velocity.z = pulse.velocity.z;
    slot.speed = normalizeInto(slot.velocity, slot.direction);
    slot.expiresAtMs = expiresAtMs;
    slot.supercharged = Boolean(pulse.supercharged);
    slot.radiusScale = pulse.supercharged
      ? Math.max(2.4, (pulse.radius ?? CHRONOS_ASCENDANT_PARADOX_PULSE_RADIUS) / CHRONOS_ASCENDANT_PARADOX_PULSE_RADIUS * 3.1)
      : 1;

    this.idToSlot.set(pulse.id, slotIndex);
  }

  removeMissing(activeIds: Set<string>): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.active && !activeIds.has(slot.id)) {
        this.deactivate(i);
      }
    }
  }

  forEachActive(callback: (slot: ChronosPulseRuntimeSlot, slotIndex: number) => void): void {
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
    slot.supercharged = false;
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

function playChronosImpact(position: MutableVec3, supercharged: boolean): void {
  void playSharedSound('chronosSuperchargedImpact', {
    position,
    durationMs: CHRONOS_IMPACT_CLIP_MS,
    fadeOutMs: 36,
    volume: supercharged ? 1 : CHRONOS_REGULAR_IMPACT_VOLUME,
  });
}

function setSphereInstance(
  mesh: THREE.InstancedMesh | null,
  dummy: THREE.Object3D,
  slot: ChronosPulseRuntimeSlot,
  index: number,
  scale: number,
  offsetBack = 0
): void {
  if (!mesh) return;

  dummy.position.set(
    slot.position.x - slot.direction.x * offsetBack,
    slot.position.y - slot.direction.y * offsetBack,
    slot.position.z - slot.direction.z * offsetBack
  );
  dummy.quaternion.identity();
  dummy.scale.setScalar(scale);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

function setRingInstance(
  mesh: THREE.InstancedMesh | null,
  dummy: THREE.Object3D,
  slot: ChronosPulseRuntimeSlot,
  index: number,
  direction: THREE.Vector3,
  ringQuaternion: THREE.Quaternion,
  scale: number,
  offsetBack: number
): void {
  if (!mesh) return;

  direction.set(slot.direction.x, slot.direction.y, slot.direction.z);
  ringQuaternion.setFromUnitVectors(RING_FORWARD, direction);
  dummy.position.set(
    slot.position.x - slot.direction.x * offsetBack,
    slot.position.y - slot.direction.y * offsetBack,
    slot.position.z - slot.direction.z * offsetBack
  );
  dummy.quaternion.copy(ringQuaternion);
  dummy.scale.set(scale, scale, 1);
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

export function ChronosPulsesManager() {
  const storePulses = useGameStore(state => state.chronosPulses);
  const removeChronosPulses = useGameStore(state => state.removeChronosPulses);
  const poolRef = useRef<ChronosPulseRuntimePool>();
  const removalsRef = useRef<string[]>([]);
  const activeStoreIdsRef = useRef<Set<string>>(new Set());
  const enemyPlayersRef = useRef<Player[]>([]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const pulseDirection = useMemo(() => new THREE.Vector3(0, 0, -1), []);
  const pulseQuaternion = useMemo(() => new THREE.Quaternion(), []);

  const glowMeshRef = useRef<THREE.InstancedMesh>(null);
  const coreMeshRef = useRef<THREE.InstancedMesh>(null);
  const trailMeshRef = useRef<THREE.InstancedMesh>(null);
  const frontRingMeshRef = useRef<THREE.InstancedMesh>(null);
  const backRingMeshRef = useRef<THREE.InstancedMesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  if (!poolRef.current) {
    poolRef.current = new ChronosPulseRuntimePool(CHRONOS_PULSE_CAPACITY);
  }
  useEffect(() => {
    const pool = poolRef.current;
    if (!pool) return;

    const activeIds = activeStoreIdsRef.current;
    const nowDateMs = Date.now();
    const frameNowMs = getFrameClock().nowMs;

    activeIds.clear();
    for (const pulse of storePulses) {
      activeIds.add(pulse.id);
      const ageMs = Math.max(0, nowDateMs - pulse.startTime);
      const expiresAtMs = frameNowMs + Math.max(0, CHRONOS_PULSE_LIFETIME_MS - ageMs);
      pool.add(pulse, expiresAtMs);
    }
    pool.removeMissing(activeIds);
  }, [storePulses]);

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
      setInstancedMeshCount(glowMeshRef.current, 0);
      setInstancedMeshCount(coreMeshRef.current, 0);
      setInstancedMeshCount(trailMeshRef.current, 0);
      setInstancedMeshCount(frontRingMeshRef.current, 0);
      setInstancedMeshCount(backRingMeshRef.current, 0);
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
      const collisionRadius = CHRONOS_PULSE_COLLISION_RADIUS * slot.radiusScale;
      if (moveDistance > 0.001 && physicsWorld) {
        const hit = raycast(
          physicsWorld,
          slot.position,
          slot.direction,
          moveDistance + collisionRadius,
          {
            priority: 'visual',
            feature: 'projectile:chronosPulse',
          }
        );
        if (hit && hit.distance <= moveDistance + collisionRadius) {
          triggerTerrainImpact('chronos_pulse', hit.point, {
            normal: hit.normal,
            direction: slot.direction,
            scale: 0.72 * slot.radiusScale,
          });
          playChronosImpact(hit.point, slot.supercharged);
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
        moveDistance + collisionRadius + PROJECTILE_COMBAT_QUERY_PADDING
      );
      for (let i = 0; i < enemies.length; i++) {
        const player = enemies[i];
        if (doesSegmentHitPlayerCombatHitbox(slot.position, slot.direction, moveDistance, player, collisionRadius)) {
          playChronosImpact(slot.position, slot.supercharged);
          removals.push(slot.id);
          pool.deactivate(slotIndex);
          return;
        }
      }

      const pulse = 1 + Math.sin(clock.nowMs * 0.02 + slotIndex * 0.8) * 0.055;
      const radius = CHRONOS_PULSE_RADIUS * slot.radiusScale;
      setSphereInstance(
        glowMeshRef.current,
        dummy,
        slot,
        instanceIndex,
        radius * 1.35 * pulse
      );
      setSphereInstance(coreMeshRef.current, dummy, slot, instanceIndex, radius * 0.68);
      setSphereInstance(trailMeshRef.current, dummy, slot, instanceIndex, radius * 0.82, 0.22 * slot.radiusScale);
      setRingInstance(
        frontRingMeshRef.current,
        dummy,
        slot,
        instanceIndex,
        pulseDirection,
        pulseQuaternion,
        radius * 1.55,
        0.08 * slot.radiusScale
      );
      setRingInstance(
        backRingMeshRef.current,
        dummy,
        slot,
        instanceIndex,
        pulseDirection,
        pulseQuaternion,
        radius * 1.15,
        0.3 * slot.radiusScale
      );

      lightX += slot.position.x;
      lightY += slot.position.y;
      lightZ += slot.position.z;
      instanceIndex++;

      slot.position.x += slot.velocity.x * delta;
      slot.position.y += slot.velocity.y * delta;
      slot.position.z += slot.velocity.z * delta;
    });

    setInstancedMeshCount(glowMeshRef.current, instanceIndex);
    setInstancedMeshCount(coreMeshRef.current, instanceIndex);
    setInstancedMeshCount(trailMeshRef.current, instanceIndex);
    setInstancedMeshCount(frontRingMeshRef.current, instanceIndex);
    setInstancedMeshCount(backRingMeshRef.current, instanceIndex);

    if (lightRef.current) {
      if (instanceIndex > 0) {
        lightRef.current.position.set(lightX / instanceIndex, lightY / instanceIndex, lightZ / instanceIndex);
        lightRef.current.intensity = Math.min(instanceIndex * 1.2, 5.5);
      } else {
        lightRef.current.intensity = 0;
      }
    }

    if (removals.length > 0) {
      removeChronosPulses(removals);
      removals.length = 0;
    }
  });

  return (
    <group>
      <instancedMesh
        ref={glowMeshRef}
        args={[SHARED_GEOMETRIES.sphere12, getPulseGlowMaterial(), CHRONOS_PULSE_CAPACITY]}
        count={0}
        frustumCulled={false}
      />
      <instancedMesh
        ref={coreMeshRef}
        args={[SHARED_GEOMETRIES.sphere8, getPulseCoreMaterial(), CHRONOS_PULSE_CAPACITY]}
        count={0}
        frustumCulled={false}
      />
      <instancedMesh
        ref={trailMeshRef}
        args={[SHARED_GEOMETRIES.sphere8, getPulseGlowMaterial(), CHRONOS_PULSE_CAPACITY]}
        count={0}
        frustumCulled={false}
      />
      <instancedMesh
        ref={frontRingMeshRef}
        args={[SHARED_GEOMETRIES.ring24, getPulseRingMaterial(), CHRONOS_PULSE_CAPACITY]}
        count={0}
        frustumCulled={false}
      />
      <instancedMesh
        ref={backRingMeshRef}
        args={[SHARED_GEOMETRIES.ring24, getPulseRingMaterial(), CHRONOS_PULSE_CAPACITY]}
        count={0}
        frustumCulled={false}
      />
      <BudgetedPointLight
        ref={lightRef}
        budgetPriority={3.1}
        color={0x86efac}
        intensity={0}
        distance={7}
        decay={2}
      />
    </group>
  );
}

if (typeof window !== 'undefined') {
  requestAnimationFrame(() => {
    getPulseCoreMaterial();
    getPulseGlowMaterial();
    getPulseRingMaterial();
  });
}
