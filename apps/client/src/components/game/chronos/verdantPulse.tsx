import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Player } from '@voxel-strike/shared';
import { useGameStore, type ChronosPulseData } from '../../../store/gameStore';
import { getPhysicsWorld, isPhysicsReady, raycast } from '../../../hooks/usePhysics';
import { getFrameClock } from '../../../utils/frameClock';
import { recordSystemTime, registerFrameSystem } from '../../../utils/perfMarks';
import { SHARED_GEOMETRIES } from '../effectResources';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { triggerTerrainImpact } from '../TerrainImpactEffects';

const CHRONOS_PULSE_CAPACITY = 96;
const CHRONOS_PULSE_LIFETIME_MS = 3000;
const CHRONOS_PULSE_RADIUS = 0.12;
const CHRONOS_PULSE_COLLISION_RADIUS = 0.18;
const NPC_HIT_RADIUS = 1.05;
const NPC_HIT_RADIUS_SQ = NPC_HIT_RADIUS * NPC_HIT_RADIUS;
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

  useEffect(() => registerFrameSystem('chronos-pulses'), []);

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

    const frameStart = performance.now();
    const store = useGameStore.getState();
    const clock = getFrameClock();
    const delta = clock.clampedDeltaSeconds;
    let instanceIndex = 0;
    let physicsMs = 0;
    let lightX = 0;
    let lightY = 0;
    let lightZ = 0;

    const removals = removalsRef.current;
    removals.length = 0;

    const enemies = enemyPlayersRef.current;
    enemies.length = 0;
    for (const [, player] of store.players) {
      if (player.state === 'alive') enemies.push(player);
    }

    pool.forEachActive((slot, slotIndex) => {
      if (clock.nowMs >= slot.expiresAtMs) {
        removals.push(slot.id);
        pool.deactivate(slotIndex);
        return;
      }

      const moveDistance = slot.speed * delta;
      if (moveDistance > 0.001 && isPhysicsReady()) {
        const world = getPhysicsWorld();
        if (world) {
          const physicsStart = performance.now();
          const hit = raycast(
            world,
            slot.position,
            slot.direction,
            moveDistance + CHRONOS_PULSE_COLLISION_RADIUS
          );
          physicsMs += performance.now() - physicsStart;
          if (hit && hit.distance <= moveDistance + CHRONOS_PULSE_COLLISION_RADIUS) {
            triggerTerrainImpact('chronos_pulse', hit.point, {
              normal: hit.normal,
              direction: slot.direction,
              scale: 0.72,
            });
            removals.push(slot.id);
            pool.deactivate(slotIndex);
            return;
          }
        }
      }

      for (let i = 0; i < enemies.length; i++) {
        const player = enemies[i];
        if (player.id === slot.ownerId) continue;
        if (player.state !== 'alive') continue;
        if (player.team === slot.ownerTeam) continue;

        const dx = player.position.x - slot.position.x;
        const dy = player.position.y + 0.9 - slot.position.y;
        const dz = player.position.z - slot.position.z;
        if (dx * dx + dy * dy + dz * dz <= NPC_HIT_RADIUS_SQ) {
          removals.push(slot.id);
          pool.deactivate(slotIndex);
          return;
        }
      }

      const pulse = 1 + Math.sin(clock.nowMs * 0.02 + slotIndex * 0.8) * 0.055;
      setSphereInstance(
        glowMeshRef.current,
        dummy,
        slot,
        instanceIndex,
        CHRONOS_PULSE_RADIUS * 1.35 * pulse
      );
      setSphereInstance(coreMeshRef.current, dummy, slot, instanceIndex, CHRONOS_PULSE_RADIUS * 0.68);
      setSphereInstance(trailMeshRef.current, dummy, slot, instanceIndex, CHRONOS_PULSE_RADIUS * 0.82, 0.22);
      setRingInstance(
        frontRingMeshRef.current,
        dummy,
        slot,
        instanceIndex,
        pulseDirection,
        pulseQuaternion,
        CHRONOS_PULSE_RADIUS * 1.55,
        0.08
      );
      setRingInstance(
        backRingMeshRef.current,
        dummy,
        slot,
        instanceIndex,
        pulseDirection,
        pulseQuaternion,
        CHRONOS_PULSE_RADIUS * 1.15,
        0.3
      );

      lightX += slot.position.x;
      lightY += slot.position.y;
      lightZ += slot.position.z;
      instanceIndex++;

      slot.position.x += slot.velocity.x * delta;
      slot.position.y += slot.velocity.y * delta;
      slot.position.z += slot.velocity.z * delta;
    });

    const meshes = [
      glowMeshRef.current,
      coreMeshRef.current,
      trailMeshRef.current,
      frontRingMeshRef.current,
      backRingMeshRef.current,
    ];
    for (const mesh of meshes) {
      if (!mesh) continue;
      mesh.count = instanceIndex;
      mesh.instanceMatrix.needsUpdate = true;
    }

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

    if (physicsMs > 0) {
      recordSystemTime('physicsQueries', physicsMs);
    }
    recordSystemTime('chronosPulses', performance.now() - frameStart);
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
