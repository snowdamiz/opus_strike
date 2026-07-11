import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  PHANTOM_RIFT_BOLT_COLLISION_RADIUS,
  PHANTOM_RIFT_BOLT_DAMAGE,
  PHANTOM_RIFT_BOLT_MAX_DISTANCE,
  PHANTOM_RIFT_BOLT_SPEED,
  PLAYER_COMBAT_HITBOX_PADDING,
  PLAYER_RADIUS,
  getPlayerBodyAimPosition,
} from '@voxel-strike/shared';
import { getPhysicsWorld, isPhysicsReady, raycastInto, type RaycastHitResult } from '../../../hooks/usePhysics';
import { useGameStore } from '../../../store/gameStore';
import type { RiftBoltData } from '../../../store/types';
import { applyTutorialOfflineTrainingDamage } from '../../../utils/tutorialOfflineCombatRuntime';
import { getAdditiveRingMaterial, getGlowMaterial, SHARED_GEOMETRIES } from '../effectResources';
import { triggerTerrainImpact } from '../TerrainImpactEffects';

const MAX_RIFT_BOLT_INSTANCES = 24;
const coreMaterial = getGlowMaterial(0xa855f7, 0.96);
const shellMaterial = getGlowMaterial(0x22d3ee, 0.34);
const ringMaterial = getAdditiveRingMaterial(0xc084fc, 0.72);
const directionScratch = new THREE.Vector3();
const ringBLocalRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));

interface RiftBoltRuntime {
  previousPosition: THREE.Vector3;
  nextPosition: THREE.Vector3;
  rayDirection: THREE.Vector3;
  terrainHit: RaycastHitResult;
  practiceImpactResolved: boolean;
  rotationX: number;
  rotationY: number;
}

function createRiftBoltRuntime(bolt: RiftBoltData): RiftBoltRuntime {
  return {
    previousPosition: new THREE.Vector3(
      bolt.startPosition.x,
      bolt.startPosition.y,
      bolt.startPosition.z,
    ),
    nextPosition: new THREE.Vector3(),
    rayDirection: new THREE.Vector3(),
    terrainHit: {
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      distance: 0,
    },
    practiceImpactResolved: false,
    rotationX: 0,
    rotationY: 0,
  };
}

function resolvePracticePlayerImpact(
  bolt: RiftBoltData,
  start: THREE.Vector3,
  end: THREE.Vector3,
): { targetId: string; point: { x: number; y: number; z: number }; progress: number } | null {
  const store = useGameStore.getState();
  const segment = directionScratch.subVectors(end, start);
  const lengthSq = segment.lengthSq();
  if (lengthSq <= 0.000001) return null;

  const hitRadius = PLAYER_RADIUS + PLAYER_COMBAT_HITBOX_PADDING + PHANTOM_RIFT_BOLT_COLLISION_RADIUS;
  const hitRadiusSq = hitRadius * hitRadius;
  let bestTargetId: string | null = null;
  let bestProgress = Number.POSITIVE_INFINITY;
  let bestPointX = 0;
  let bestPointY = 0;
  let bestPointZ = 0;

  for (const player of store.players.values()) {
    if (player.id === bolt.ownerId || player.team === bolt.ownerTeam || player.state !== 'alive') continue;
    const body = getPlayerBodyAimPosition({ position: player.position, heroId: player.heroId });
    const toBodyX = body.x - start.x;
    const toBodyY = body.y - start.y;
    const toBodyZ = body.z - start.z;
    const progress = THREE.MathUtils.clamp(
      (toBodyX * segment.x + toBodyY * segment.y + toBodyZ * segment.z) / lengthSq,
      0,
      1,
    );
    if (progress >= bestProgress) continue;

    const pointX = start.x + segment.x * progress;
    const pointY = start.y + segment.y * progress;
    const pointZ = start.z + segment.z * progress;
    const dx = body.x - pointX;
    const dy = body.y - pointY;
    const dz = body.z - pointZ;
    if (dx * dx + dy * dy + dz * dz > hitRadiusSq) continue;

    bestTargetId = player.id;
    bestProgress = progress;
    bestPointX = pointX;
    bestPointY = pointY;
    bestPointZ = pointZ;
  }

  return bestTargetId
    ? {
      targetId: bestTargetId,
      point: { x: bestPointX, y: bestPointY, z: bestPointZ },
      progress: bestProgress,
    }
    : null;
}

function writeRiftBoltInstance(
  mesh: THREE.InstancedMesh | null,
  index: number,
  dummy: THREE.Object3D,
): void {
  if (!mesh) return;
  mesh.setMatrixAt(index, dummy.matrix);
}

function commitRiftBoltInstances(mesh: THREE.InstancedMesh, count: number): void {
  mesh.count = count;
  if (count === 0) return;
  mesh.instanceMatrix.clearUpdateRanges();
  mesh.instanceMatrix.addUpdateRange(0, count * mesh.instanceMatrix.itemSize);
  mesh.instanceMatrix.needsUpdate = true;
}

export function RiftBoltsManager() {
  const riftBolts = useGameStore((state) => state.riftBolts);
  const removeRiftBolt = useGameStore((state) => state.removeRiftBolt);
  const updateRiftBolt = useGameStore((state) => state.updateRiftBolt);
  const coreRef = useRef<THREE.InstancedMesh>(null);
  const shellRef = useRef<THREE.InstancedMesh>(null);
  const ringARef = useRef<THREE.InstancedMesh>(null);
  const ringBRef = useRef<THREE.InstancedMesh>(null);
  const runtimesRef = useRef(new Map<string, RiftBoltRuntime>());
  const liveIdsRef = useRef(new Set<string>());
  const dummyRef = useRef(new THREE.Object3D());
  const previousInstanceCountRef = useRef(0);

  useLayoutEffect(() => {
    const meshes = [coreRef.current, shellRef.current, ringARef.current, ringBRef.current];
    for (const mesh of meshes) {
      if (!mesh) continue;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    return () => {
      runtimesRef.current.clear();
      liveIdsRef.current.clear();
      previousInstanceCountRef.current = 0;
    };
  }, []);

  useFrame((state, delta) => {
    const coreMesh = coreRef.current;
    const shellMesh = shellRef.current;
    const ringAMesh = ringARef.current;
    const ringBMesh = ringBRef.current;
    if (!coreMesh || !shellMesh || !ringAMesh || !ringBMesh) return;

    if (riftBolts.length === 0) {
      if (previousInstanceCountRef.current > 0) {
        commitRiftBoltInstances(coreMesh, 0);
        commitRiftBoltInstances(shellMesh, 0);
        commitRiftBoltInstances(ringAMesh, 0);
        commitRiftBoltInstances(ringBMesh, 0);
        previousInstanceCountRef.current = 0;
        runtimesRef.current.clear();
      }
      return;
    }

    const now = Date.now();
    const store = useGameStore.getState();
    const liveIds = liveIdsRef.current;
    liveIds.clear();
    const dummy = dummyRef.current;
    let instanceCount = 0;

    for (let boltIndex = 0; boltIndex < riftBolts.length && instanceCount < MAX_RIFT_BOLT_INSTANCES; boltIndex++) {
      const bolt = riftBolts[boltIndex];
      if (now >= bolt.expiresAt) {
        removeRiftBolt(bolt.id);
        continue;
      }

      liveIds.add(bolt.id);
      let runtime = runtimesRef.current.get(bolt.id);
      if (!runtime) {
        runtime = createRiftBoltRuntime(bolt);
        runtimesRef.current.set(bolt.id, runtime);
      }

      const elapsedSeconds = Math.max(0, now - bolt.startTime) / 1000;
      const distance = Math.min(PHANTOM_RIFT_BOLT_MAX_DISTANCE, elapsedSeconds * PHANTOM_RIFT_BOLT_SPEED);
      const nextPosition = runtime.nextPosition;
      if (bolt.impactPosition) {
        nextPosition.set(bolt.impactPosition.x, bolt.impactPosition.y, bolt.impactPosition.z);
      } else {
        nextPosition.set(
          bolt.startPosition.x + bolt.direction.x * distance,
          bolt.startPosition.y + bolt.direction.y * distance,
          bolt.startPosition.z + bolt.direction.z * distance,
        );
      }

      const previousPosition = runtime.previousPosition;
      if (store.isPracticeMode && !bolt.impactPosition && !runtime.practiceImpactResolved) {
        const segmentDistance = previousPosition.distanceTo(nextPosition);
        if (segmentDistance > 0.0001) {
          const direction = runtime.rayDirection.subVectors(nextPosition, previousPosition).normalize();
          const world = isPhysicsReady() ? getPhysicsWorld() : null;
          const terrainHit = world && raycastInto(
            runtime.terrainHit,
            world,
            previousPosition,
            direction,
            segmentDistance,
            { priority: 'visual', feature: 'projectile:phantomRiftBolt' },
          ) ? runtime.terrainHit : null;
          const playerHit = resolvePracticePlayerImpact(bolt, previousPosition, nextPosition);
          const terrainProgress = terrainHit ? terrainHit.distance / segmentDistance : Number.POSITIVE_INFINITY;

          if (playerHit && playerHit.progress <= terrainProgress) {
            const target = store.players.get(playerHit.targetId);
            if (target) {
              applyTutorialOfflineTrainingDamage({
                target,
                damage: PHANTOM_RIFT_BOLT_DAMAGE,
                damageType: 'rift_bolt',
                hitPosition: playerHit.point,
                sourceId: bolt.ownerId,
                sourceTeam: bolt.ownerTeam,
                abilityId: 'phantom_rift_bolt',
              });
            }
            runtime.practiceImpactResolved = true;
            updateRiftBolt(bolt.id, { impactPosition: playerHit.point });
            nextPosition.set(playerHit.point.x, playerHit.point.y, playerHit.point.z);
          } else if (terrainHit) {
            const impactPosition = {
              x: terrainHit.point.x,
              y: terrainHit.point.y,
              z: terrainHit.point.z,
            };
            runtime.practiceImpactResolved = true;
            updateRiftBolt(bolt.id, { impactPosition });
            nextPosition.set(impactPosition.x, impactPosition.y, impactPosition.z);
            triggerTerrainImpact('phantom_dire_ball', impactPosition, {
              normal: terrainHit.normal,
              direction: bolt.direction,
              scale: 1.25,
            });
          }
        }
      }

      previousPosition.copy(nextPosition);
      const frameScale = Math.min(3, Math.max(0, delta * 60));
      runtime.rotationX += 0.018 * frameScale;
      runtime.rotationY -= 0.026 * frameScale;
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 8.5) * 0.09;
      dummy.position.copy(nextPosition);
      dummy.rotation.set(runtime.rotationX, runtime.rotationY, 0);
      dummy.scale.setScalar(pulse * 0.28);
      dummy.updateMatrix();
      writeRiftBoltInstance(coreMesh, instanceCount, dummy);
      dummy.scale.setScalar(pulse * 0.48);
      dummy.updateMatrix();
      writeRiftBoltInstance(shellMesh, instanceCount, dummy);
      dummy.scale.setScalar(pulse * 0.62);
      dummy.updateMatrix();
      writeRiftBoltInstance(ringAMesh, instanceCount, dummy);
      dummy.quaternion.multiply(ringBLocalRotation);
      dummy.scale.setScalar(pulse * 0.54);
      dummy.updateMatrix();
      writeRiftBoltInstance(ringBMesh, instanceCount, dummy);
      instanceCount++;
    }

    for (const id of runtimesRef.current.keys()) {
      if (!liveIds.has(id)) runtimesRef.current.delete(id);
    }

    commitRiftBoltInstances(coreMesh, instanceCount);
    commitRiftBoltInstances(shellMesh, instanceCount);
    commitRiftBoltInstances(ringAMesh, instanceCount);
    commitRiftBoltInstances(ringBMesh, instanceCount);
    previousInstanceCountRef.current = instanceCount;
  });

  return (
    <group frustumCulled={false}>
      <instancedMesh
        ref={coreRef}
        args={[SHARED_GEOMETRIES.sphere12, coreMaterial, MAX_RIFT_BOLT_INSTANCES]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={shellRef}
        args={[SHARED_GEOMETRIES.sphere16, shellMaterial, MAX_RIFT_BOLT_INSTANCES]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={ringARef}
        args={[SHARED_GEOMETRIES.ring16, ringMaterial, MAX_RIFT_BOLT_INSTANCES]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={ringBRef}
        args={[SHARED_GEOMETRIES.ring16, ringMaterial, MAX_RIFT_BOLT_INSTANCES]}
        frustumCulled={false}
      />
    </group>
  );
}
