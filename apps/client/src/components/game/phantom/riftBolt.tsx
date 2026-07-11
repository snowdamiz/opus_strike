import { memo, useRef } from 'react';
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

const coreMaterial = getGlowMaterial(0xa855f7, 0.96);
const shellMaterial = getGlowMaterial(0x22d3ee, 0.34);
const ringMaterial = getAdditiveRingMaterial(0xc084fc, 0.72);
const directionScratch = new THREE.Vector3();

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
  let best: { targetId: string; point: { x: number; y: number; z: number }; progress: number } | null = null;

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
    const point = {
      x: start.x + segment.x * progress,
      y: start.y + segment.y * progress,
      z: start.z + segment.z * progress,
    };
    const dx = body.x - point.x;
    const dy = body.y - point.y;
    const dz = body.z - point.z;
    if (dx * dx + dy * dy + dz * dz > hitRadiusSq) continue;
    if (best && best.progress <= progress) continue;
    best = { targetId: player.id, point, progress };
  }

  return best;
}

const RiftBolt = memo(function RiftBolt({ bolt }: { bolt: RiftBoltData }) {
  const groupRef = useRef<THREE.Group>(null);
  const previousPositionRef = useRef(new THREE.Vector3(
    bolt.startPosition.x,
    bolt.startPosition.y,
    bolt.startPosition.z,
  ));
  const nextPositionRef = useRef(new THREE.Vector3());
  const rayDirectionRef = useRef(new THREE.Vector3());
  const terrainHitRef = useRef<RaycastHitResult>({
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    distance: 0,
  });
  const practiceImpactResolvedRef = useRef(false);
  const removeRiftBolt = useGameStore((state) => state.removeRiftBolt);
  const updateRiftBolt = useGameStore((state) => state.updateRiftBolt);

  useFrame((state) => {
    const now = Date.now();
    if (now >= bolt.expiresAt) {
      removeRiftBolt(bolt.id);
      return;
    }

    const elapsedSeconds = Math.max(0, now - bolt.startTime) / 1000;
    const distance = Math.min(PHANTOM_RIFT_BOLT_MAX_DISTANCE, elapsedSeconds * PHANTOM_RIFT_BOLT_SPEED);
    const nextPosition = nextPositionRef.current;
    if (bolt.impactPosition) {
      nextPosition.set(bolt.impactPosition.x, bolt.impactPosition.y, bolt.impactPosition.z);
    } else {
      nextPosition.set(
        bolt.startPosition.x + bolt.direction.x * distance,
        bolt.startPosition.y + bolt.direction.y * distance,
        bolt.startPosition.z + bolt.direction.z * distance,
      );
    }

    const store = useGameStore.getState();
    const previousPosition = previousPositionRef.current;
    if (store.isPracticeMode && !bolt.impactPosition && !practiceImpactResolvedRef.current) {
      const segmentDistance = previousPosition.distanceTo(nextPosition);
      if (segmentDistance > 0.0001) {
        const direction = rayDirectionRef.current.subVectors(nextPosition, previousPosition).normalize();
        const world = isPhysicsReady() ? getPhysicsWorld() : null;
        const terrainHit = world && raycastInto(
          terrainHitRef.current,
          world,
          previousPosition,
          direction,
          segmentDistance,
          { priority: 'visual', feature: 'projectile:phantomRiftBolt' },
        ) ? terrainHitRef.current : null;
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
          practiceImpactResolvedRef.current = true;
          updateRiftBolt(bolt.id, { impactPosition: playerHit.point });
          nextPosition.set(playerHit.point.x, playerHit.point.y, playerHit.point.z);
        } else if (terrainHit) {
          practiceImpactResolvedRef.current = true;
          updateRiftBolt(bolt.id, { impactPosition: { ...terrainHit.point } });
          nextPosition.set(terrainHit.point.x, terrainHit.point.y, terrainHit.point.z);
          triggerTerrainImpact('phantom_dire_ball', terrainHit.point, {
            normal: terrainHit.normal,
            direction: bolt.direction,
            scale: 1.25,
          });
        }
      }
    }

    previousPosition.copy(nextPosition);
    const group = groupRef.current;
    if (!group) return;
    group.position.copy(nextPosition);
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 8.5) * 0.09;
    group.scale.setScalar(pulse);
    group.rotation.x += 0.018;
    group.rotation.y -= 0.026;
  });

  return (
    <group ref={groupRef} position={[bolt.startPosition.x, bolt.startPosition.y, bolt.startPosition.z]}>
      <mesh geometry={SHARED_GEOMETRIES.sphere12} material={coreMaterial} scale={0.28} />
      <mesh geometry={SHARED_GEOMETRIES.sphere16} material={shellMaterial} scale={0.48} />
      <mesh geometry={SHARED_GEOMETRIES.ring16} material={ringMaterial} scale={0.62} />
      <mesh geometry={SHARED_GEOMETRIES.ring16} material={ringMaterial} scale={0.54} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  );
});

export function RiftBoltsManager() {
  const riftBolts = useGameStore((state) => state.riftBolts);
  return (
    <>
      {riftBolts.map((bolt) => <RiftBolt key={bolt.id} bolt={bolt} />)}
    </>
  );
}
