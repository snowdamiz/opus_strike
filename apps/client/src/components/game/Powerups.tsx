import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { type MapPowerupPickup } from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import { getPreparedVoxelMap, prepareVoxelMapCpu } from '../../utils/mapWarmup/mapPrepCache';

const HEALTH_PACK_COLOR = '#e63b3b';
const HEALTH_CROSS_COLOR = '#fff4e8';
const POWERUP_CORE_COLOR = '#40d7ff';
const POWERUP_TRIM_COLOR = '#ffd35a';
const POWERUP_RING_COLOR = '#7cf7c8';
const PICKUP_POP_DURATION_MS = 520;
const BURST_SPARK_ANGLES = [0, Math.PI / 3, (Math.PI * 2) / 3, Math.PI, (Math.PI * 4) / 3, (Math.PI * 5) / 3] as const;
const IDENTITY_QUATERNION = new THREE.Quaternion();
const HEALTH_RING_QUATERNION = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
const POWERUP_RING_QUATERNION = HEALTH_RING_QUATERNION.clone();
const POWERUP_TRIM_QUATERNION = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0));
const OBJECT_POSITION = new THREE.Vector3();
const OBJECT_ROTATION = new THREE.Euler();
const OBJECT_QUATERNION = new THREE.Quaternion();
const OBJECT_SCALE = new THREE.Vector3();
const CHILD_POSITION = new THREE.Vector3();
const CHILD_SCALE = new THREE.Vector3();
const PARENT_MATRIX = new THREE.Matrix4();
const CHILD_MATRIX = new THREE.Matrix4();
const INSTANCE_MATRIX = new THREE.Matrix4();

interface VisiblePowerupPickup {
  pickup: MapPowerupPickup;
  collectedAt?: number;
}

interface PowerupRenderResources {
  geometries: {
    box: THREE.BoxGeometry;
    healthRing: THREE.TorusGeometry;
    powerCore: THREE.OctahedronGeometry;
    powerRing: THREE.TorusGeometry;
    burstRing: THREE.TorusGeometry;
    burstSpark: THREE.SphereGeometry;
  };
  materials: {
    healthBody: THREE.MeshStandardMaterial;
    healthCross: THREE.MeshStandardMaterial;
    powerCore: THREE.MeshStandardMaterial;
    powerRing: THREE.MeshStandardMaterial;
    powerTrim: THREE.MeshStandardMaterial;
    healthBurstRing: THREE.MeshBasicMaterial;
    powerBurstRing: THREE.MeshBasicMaterial;
    healthBurstSpark: THREE.MeshBasicMaterial;
    powerBurstSpark: THREE.MeshBasicMaterial;
  };
  allGeometries: THREE.BufferGeometry[];
  allMaterials: THREE.Material[];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function easeOutCubic(value: number): number {
  const inverse = 1 - clamp01(value);
  return 1 - inverse * inverse * inverse;
}

function getPickupPopProgress(collectedAt: number | undefined, now = Date.now()): number | null {
  if (collectedAt === undefined) return null;
  const progress = (now - collectedAt) / PICKUP_POP_DURATION_MS;
  return progress < 1 ? clamp01(progress) : null;
}

function getNextPowerupVisualRefreshAt(
  pickups: MapPowerupPickup[],
  pickupStates: ReadonlyMap<string, { availableAt: number }>,
  collectionStates: ReadonlyMap<string, { collectedAt: number }>,
  now: number
): number | null {
  let nextRefreshAt = Number.POSITIVE_INFINITY;

  for (const pickup of pickups) {
    const state = pickupStates.get(pickup.id);
    if (state && state.availableAt > now) {
      nextRefreshAt = Math.min(nextRefreshAt, state.availableAt);
    }

    const collection = collectionStates.get(pickup.id);
    if (collection) {
      const popEndsAt = collection.collectedAt + PICKUP_POP_DURATION_MS;
      if (popEndsAt > now) {
        nextRefreshAt = Math.min(nextRefreshAt, popEndsAt);
      }
    }
  }

  return Number.isFinite(nextRefreshAt) ? nextRefreshAt : null;
}

function getVisiblePowerupPickups(
  pickups: MapPowerupPickup[],
  pickupStates: ReadonlyMap<string, { availableAt: number }>,
  collectionStates: ReadonlyMap<string, { collectedAt: number }>,
  now: number
): VisiblePowerupPickup[] {
  const visiblePickups: VisiblePowerupPickup[] = [];

  for (const pickup of pickups) {
    const state = pickupStates.get(pickup.id);
    const collection = collectionStates.get(pickup.id);
    const popProgress = getPickupPopProgress(collection?.collectedAt, now);
    const isRespawning = state !== undefined && state.availableAt > now;

    if (isRespawning && popProgress === null) continue;
    visiblePickups.push({
      pickup,
      collectedAt: popProgress === null ? undefined : collection?.collectedAt,
    });
  }

  return visiblePickups;
}

function getPickupPhase(pickupId: string): number {
  let hash = 0;
  for (let index = 0; index < pickupId.length; index++) {
    hash = Math.imul(hash ^ pickupId.charCodeAt(index), 0x45d9f3b) >>> 0;
  }
  return (hash / 0xffffffff) * Math.PI * 2;
}

function createPowerupRenderResources(): PowerupRenderResources {
  const geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    healthRing: new THREE.TorusGeometry(0.34, 0.025, 8, 28),
    powerCore: new THREE.OctahedronGeometry(0.48, 0),
    powerRing: new THREE.TorusGeometry(0.62, 0.035, 10, 42),
    burstRing: new THREE.TorusGeometry(0.5, 0.025, 8, 40),
    burstSpark: new THREE.SphereGeometry(0.055, 8, 8),
  };
  const materials = {
    healthBody: new THREE.MeshStandardMaterial({ color: HEALTH_PACK_COLOR, roughness: 0.42, metalness: 0.1 }),
    healthCross: new THREE.MeshStandardMaterial({ color: HEALTH_CROSS_COLOR, roughness: 0.35, metalness: 0.15 }),
    powerCore: new THREE.MeshStandardMaterial({
      color: POWERUP_CORE_COLOR,
      emissive: POWERUP_CORE_COLOR,
      emissiveIntensity: 0.65,
      roughness: 0.22,
      metalness: 0.35,
    }),
    powerRing: new THREE.MeshStandardMaterial({
      color: POWERUP_RING_COLOR,
      emissive: POWERUP_RING_COLOR,
      emissiveIntensity: 0.35,
      roughness: 0.24,
      metalness: 0.35,
    }),
    powerTrim: new THREE.MeshStandardMaterial({
      color: POWERUP_TRIM_COLOR,
      emissive: POWERUP_TRIM_COLOR,
      emissiveIntensity: 0.2,
      roughness: 0.32,
      metalness: 0.45,
    }),
    healthBurstRing: new THREE.MeshBasicMaterial({
      color: HEALTH_CROSS_COLOR,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    }),
    powerBurstRing: new THREE.MeshBasicMaterial({
      color: POWERUP_RING_COLOR,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    }),
    healthBurstSpark: new THREE.MeshBasicMaterial({
      color: HEALTH_PACK_COLOR,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    }),
    powerBurstSpark: new THREE.MeshBasicMaterial({
      color: POWERUP_TRIM_COLOR,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    }),
  };

  return {
    geometries,
    materials,
    allGeometries: Object.values(geometries),
    allMaterials: Object.values(materials),
  };
}

function composeParentMatrix(x: number, y: number, z: number, rotationY: number, scale: number): THREE.Matrix4 {
  OBJECT_POSITION.set(x, y, z);
  OBJECT_ROTATION.set(0, rotationY, 0);
  OBJECT_QUATERNION.setFromEuler(OBJECT_ROTATION);
  OBJECT_SCALE.setScalar(scale);
  return PARENT_MATRIX.compose(OBJECT_POSITION, OBJECT_QUATERNION, OBJECT_SCALE);
}

function writeChildInstance(
  mesh: THREE.InstancedMesh | null,
  index: number,
  parentMatrix: THREE.Matrix4,
  localX: number,
  localY: number,
  localZ: number,
  quaternion: THREE.Quaternion,
  scaleX: number,
  scaleY: number,
  scaleZ: number
): void {
  if (!mesh) return;
  CHILD_POSITION.set(localX, localY, localZ);
  CHILD_SCALE.set(scaleX, scaleY, scaleZ);
  CHILD_MATRIX.compose(CHILD_POSITION, quaternion, CHILD_SCALE);
  INSTANCE_MATRIX.copy(parentMatrix).multiply(CHILD_MATRIX);
  mesh.setMatrixAt(index, INSTANCE_MATRIX);
}

function commitInstancedMesh(mesh: THREE.InstancedMesh | null, count: number): void {
  if (!mesh) return;
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
}

function PowerupInstancedMeshes({
  visiblePickups,
  phaseByPickupId,
  capacity,
}: {
  visiblePickups: VisiblePowerupPickup[];
  phaseByPickupId: ReadonlyMap<string, number>;
  capacity: number;
}) {
  const resources = useMemo(createPowerupRenderResources, []);
  const visiblePickupsRef = useRef(visiblePickups);
  const healthBodyRef = useRef<THREE.InstancedMesh>(null);
  const healthCrossVerticalRef = useRef<THREE.InstancedMesh>(null);
  const healthCrossHorizontalRef = useRef<THREE.InstancedMesh>(null);
  const healthRingRef = useRef<THREE.InstancedMesh>(null);
  const powerCoreRef = useRef<THREE.InstancedMesh>(null);
  const powerRingRef = useRef<THREE.InstancedMesh>(null);
  const powerTrimRef = useRef<THREE.InstancedMesh>(null);
  const healthBurstRingRef = useRef<THREE.InstancedMesh>(null);
  const powerBurstRingRef = useRef<THREE.InstancedMesh>(null);
  const healthBurstSparkRef = useRef<THREE.InstancedMesh>(null);
  const powerBurstSparkRef = useRef<THREE.InstancedMesh>(null);

  visiblePickupsRef.current = visiblePickups;

  useEffect(() => {
    return () => {
      for (const geometry of resources.allGeometries) geometry.dispose();
      for (const material of resources.allMaterials) material.dispose();
    };
  }, [resources]);

  useEffect(() => {
    const meshes = [
      healthBodyRef.current,
      healthCrossVerticalRef.current,
      healthCrossHorizontalRef.current,
      healthRingRef.current,
      powerCoreRef.current,
      powerRingRef.current,
      powerTrimRef.current,
      healthBurstRingRef.current,
      powerBurstRingRef.current,
      healthBurstSparkRef.current,
      powerBurstSparkRef.current,
    ];
    for (const mesh of meshes) {
      mesh?.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
  }, []);

  useFrame(({ clock }) => {
    const frameNow = Date.now();
    let healthCount = 0;
    let powerCount = 0;
    let healthBurstRingCount = 0;
    let powerBurstRingCount = 0;
    let healthBurstSparkCount = 0;
    let powerBurstSparkCount = 0;

    for (const { pickup, collectedAt } of visiblePickupsRef.current) {
      const popProgress = getPickupPopProgress(collectedAt, frameNow);
      if (collectedAt !== undefined && popProgress === null) continue;

      const phase = phaseByPickupId.get(pickup.id) ?? 0;
      const elapsed = clock.elapsedTime + phase;
      const resolvedPopProgress = popProgress ?? 0;
      const popEase = easeOutCubic(resolvedPopProgress);
      const idleWeight = 1 - resolvedPopProgress;
      const popScale = collectedAt === undefined
        ? 1
        : Math.max(0.16, 1 + Math.sin(resolvedPopProgress * Math.PI) * 0.5 - popEase * 0.78);
      const parentMatrix = composeParentMatrix(
        pickup.position.x,
        pickup.position.y + Math.sin(elapsed * 2.2) * 0.14 * idleWeight + popEase * 0.72,
        pickup.position.z,
        elapsed * (pickup.kind === 'health_pack' ? 0.75 : 1.15) + popEase * Math.PI * 1.4,
        popScale
      );

      if (pickup.kind === 'health_pack') {
        const index = healthCount++;
        writeChildInstance(healthBodyRef.current, index, parentMatrix, 0, 0, 0, IDENTITY_QUATERNION, 0.82, 0.52, 0.82);
        writeChildInstance(healthCrossVerticalRef.current, index, parentMatrix, 0, 0.01, -0.415, IDENTITY_QUATERNION, 0.18, 0.36, 0.04);
        writeChildInstance(healthCrossHorizontalRef.current, index, parentMatrix, 0, 0.01, -0.435, IDENTITY_QUATERNION, 0.42, 0.14, 0.04);
        writeChildInstance(healthRingRef.current, index, parentMatrix, 0, 0.32, 0, HEALTH_RING_QUATERNION, 1, 1, 1);
      } else {
        const index = powerCount++;
        writeChildInstance(powerCoreRef.current, index, parentMatrix, 0, 0, 0, IDENTITY_QUATERNION, 1, 1, 1);
        writeChildInstance(powerRingRef.current, index, parentMatrix, 0, 0, 0, POWERUP_RING_QUATERNION, 1, 1, 1);
        writeChildInstance(powerTrimRef.current, index, parentMatrix, 0, -0.43, 0, POWERUP_TRIM_QUATERNION, 0.48, 0.08, 0.48);
      }

      if (collectedAt === undefined || popProgress === null) continue;

      const eased = easeOutCubic(popProgress);
      const burstMatrix = composeParentMatrix(
        pickup.position.x,
        pickup.position.y + 0.18 + eased * 0.54,
        pickup.position.z,
        eased * Math.PI * 2,
        0.65 + eased * 1.55
      );
      const ringRef = pickup.kind === 'health_pack' ? healthBurstRingRef.current : powerBurstRingRef.current;
      const ringIndex = pickup.kind === 'health_pack' ? healthBurstRingCount++ : powerBurstRingCount++;
      writeChildInstance(ringRef, ringIndex, burstMatrix, 0, 0, 0, HEALTH_RING_QUATERNION, 1, 1, 1);

      for (const angle of BURST_SPARK_ANGLES) {
        const sparkRef = pickup.kind === 'health_pack' ? healthBurstSparkRef.current : powerBurstSparkRef.current;
        const sparkIndex = pickup.kind === 'health_pack' ? healthBurstSparkCount++ : powerBurstSparkCount++;
        writeChildInstance(
          sparkRef,
          sparkIndex,
          burstMatrix,
          Math.cos(angle) * 0.34,
          0.05,
          Math.sin(angle) * 0.34,
          IDENTITY_QUATERNION,
          1,
          1,
          1
        );
      }
    }

    commitInstancedMesh(healthBodyRef.current, healthCount);
    commitInstancedMesh(healthCrossVerticalRef.current, healthCount);
    commitInstancedMesh(healthCrossHorizontalRef.current, healthCount);
    commitInstancedMesh(healthRingRef.current, healthCount);
    commitInstancedMesh(powerCoreRef.current, powerCount);
    commitInstancedMesh(powerRingRef.current, powerCount);
    commitInstancedMesh(powerTrimRef.current, powerCount);
    commitInstancedMesh(healthBurstRingRef.current, healthBurstRingCount);
    commitInstancedMesh(powerBurstRingRef.current, powerBurstRingCount);
    commitInstancedMesh(healthBurstSparkRef.current, healthBurstSparkCount);
    commitInstancedMesh(powerBurstSparkRef.current, powerBurstSparkCount);
  });

  const sparkCapacity = Math.max(1, capacity * BURST_SPARK_ANGLES.length);

  return (
    <group name="map-powerups">
      <instancedMesh ref={healthBodyRef} args={[resources.geometries.box, resources.materials.healthBody, capacity]} castShadow receiveShadow />
      <instancedMesh ref={healthCrossVerticalRef} args={[resources.geometries.box, resources.materials.healthCross, capacity]} />
      <instancedMesh ref={healthCrossHorizontalRef} args={[resources.geometries.box, resources.materials.healthCross, capacity]} />
      <instancedMesh ref={healthRingRef} args={[resources.geometries.healthRing, resources.materials.healthCross, capacity]} />
      <instancedMesh ref={powerCoreRef} args={[resources.geometries.powerCore, resources.materials.powerCore, capacity]} castShadow />
      <instancedMesh ref={powerRingRef} args={[resources.geometries.powerRing, resources.materials.powerRing, capacity]} />
      <instancedMesh ref={powerTrimRef} args={[resources.geometries.box, resources.materials.powerTrim, capacity]} />
      <instancedMesh ref={healthBurstRingRef} args={[resources.geometries.burstRing, resources.materials.healthBurstRing, capacity]} />
      <instancedMesh ref={powerBurstRingRef} args={[resources.geometries.burstRing, resources.materials.powerBurstRing, capacity]} />
      <instancedMesh ref={healthBurstSparkRef} args={[resources.geometries.burstSpark, resources.materials.healthBurstSpark, sparkCapacity]} />
      <instancedMesh ref={powerBurstSparkRef} args={[resources.geometries.burstSpark, resources.materials.powerBurstSpark, sparkCapacity]} />
    </group>
  );
}

function usePickupPhases(pickups: MapPowerupPickup[]): ReadonlyMap<string, number> {
  return useMemo(() => {
    const phases = new Map<string, number>();
    for (const pickup of pickups) {
      phases.set(pickup.id, getPickupPhase(pickup.id));
    }
    return phases;
  }, [pickups]);
}

export function Powerups() {
  const mapSeed = useGameStore((state) => state.mapSeed);
  const mapThemeId = useGameStore((state) => state.mapThemeId);
  const mapSize = useGameStore((state) => state.mapSize);
  const mapProfileId = useGameStore((state) => state.mapProfileId);
  const pregeneratedMapId = useGameStore((state) => state.pregeneratedMapId);
  const powerupPickups = useGameStore((state) => state.powerupPickups);
  const powerupPickupCollections = useGameStore((state) => state.powerupPickupCollections);
  const [now, setNow] = useState(() => Date.now());

  const manifest = useMemo(() => {
    return (
      getPreparedVoxelMap({ seed: mapSeed, themeId: mapThemeId, mapSize, mapProfileId, pregeneratedMapId })
      ?? prepareVoxelMapCpu({ seed: mapSeed, themeId: mapThemeId, mapSize, mapProfileId, pregeneratedMapId, source: 'match' })
    ).manifest;
  }, [mapSeed, mapThemeId, mapSize, mapProfileId, pregeneratedMapId]);

  useEffect(() => {
    setNow(Date.now());
  }, [powerupPickupCollections, powerupPickups]);

  useEffect(() => {
    const nextRefreshAt = getNextPowerupVisualRefreshAt(
      manifest.gameplay.powerups,
      powerupPickups,
      powerupPickupCollections,
      now
    );
    if (nextRefreshAt === null) return undefined;

    const timeout = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(16, nextRefreshAt - Date.now())
    );
    return () => window.clearTimeout(timeout);
  }, [manifest.gameplay.powerups, now, powerupPickupCollections, powerupPickups]);

  const visiblePickups = useMemo(() => {
    return getVisiblePowerupPickups(
      manifest.gameplay.powerups,
      powerupPickups,
      powerupPickupCollections,
      now
    );
  }, [manifest, now, powerupPickupCollections, powerupPickups]);
  const phaseByPickupId = usePickupPhases(manifest.gameplay.powerups);
  const instanceCapacity = Math.max(1, manifest.gameplay.powerups.length);

  if (visiblePickups.length === 0) return null;

  return (
    <PowerupInstancedMeshes
      visiblePickups={visiblePickups}
      phaseByPickupId={phaseByPickupId}
      capacity={instanceCapacity}
    />
  );
}
