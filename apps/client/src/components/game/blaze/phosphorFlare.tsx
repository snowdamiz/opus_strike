import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  BLAZE_PHOSPHOR_FLARE_DAMAGE,
  BLAZE_PHOSPHOR_FLARE_DAMAGE_INTERVAL_MS,
  writeBlazePhosphorFlarePoint,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import type { PhosphorFlareData } from '../../../store/types';
import { getFrameClock } from '../../../utils/frameClock';
import { applyTutorialOfflineTrainingAreaDamage } from '../../../utils/tutorialOfflineCombatRuntime';
import { measureFrameWork } from '../../../movement/networkDiagnostics';
import { SHARED_GEOMETRIES } from '../effectResources';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';

const IMPACT_BURST_DURATION_MS = 650;
const POOL_FADE_OUT_MS = 500;
const POOL_FLAME_COUNT = 14;
const CANISTER_UP = new THREE.Vector3(0, 1, 0);

const POOL_FLAMES = Array.from({ length: POOL_FLAME_COUNT }, (_, index) => {
  const angle = index * Math.PI * 2 / POOL_FLAME_COUNT;
  const ring = index % 3 === 0 ? 0.34 : index % 3 === 1 ? 0.58 : 0.78;
  return {
    x: Math.cos(angle) * ring,
    z: Math.sin(angle) * ring,
    phase: index * 0.73,
    size: 0.72 + (index % 4) * 0.11,
  };
});

interface PhosphorFlareEffectProps {
  flare: PhosphorFlareData;
}

function createPhosphorMaterialTemplates() {
  return {
    shell: new THREE.MeshStandardMaterial({
      color: 0x261d16,
      roughness: 0.58,
      metalness: 0.68,
      emissive: 0x4a1a00,
      emissiveIntensity: 0.35,
    }),
    band: new THREE.MeshStandardMaterial({
      color: 0xffd36b,
      roughness: 0.34,
      metalness: 0.48,
      emissive: 0xff5a00,
      emissiveIntensity: 1.8,
    }),
    trail: new THREE.MeshBasicMaterial({
      color: 0xff7a00,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    pool: new THREE.MeshBasicMaterial({
      color: 0xff4b00,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
    poolCore: new THREE.MeshBasicMaterial({
      color: 0xffd24a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
    ring: new THREE.MeshBasicMaterial({
      color: 0xff9a22,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
    flameOuter: new THREE.MeshBasicMaterial({
      color: 0xff5a00,
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
    flameInner: new THREE.MeshBasicMaterial({
      color: 0xfff2a3,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
    burst: new THREE.MeshBasicMaterial({
      color: 0xfff3bd,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  };
}

type PhosphorMaterials = ReturnType<typeof createPhosphorMaterialTemplates>;

let phosphorMaterialTemplates: PhosphorMaterials | null = null;

function getPhosphorMaterialTemplates(): PhosphorMaterials {
  phosphorMaterialTemplates ??= createPhosphorMaterialTemplates();
  return phosphorMaterialTemplates;
}

function createPhosphorMaterials(): PhosphorMaterials {
  const templates = getPhosphorMaterialTemplates();
  return {
    shell: templates.shell.clone(),
    band: templates.band.clone(),
    trail: templates.trail.clone(),
    pool: templates.pool.clone(),
    poolCore: templates.poolCore.clone(),
    ring: templates.ring.clone(),
    flameOuter: templates.flameOuter.clone(),
    flameInner: templates.flameInner.clone(),
    burst: templates.burst.clone(),
  };
}

export function prewarmPhosphorFlareResources(): void {
  getPhosphorMaterialTemplates();
}

export function getPhosphorFlareGpuPrewarmMaterials(): THREE.Material[] {
  return Object.values(getPhosphorMaterialTemplates());
}

function disposePhosphorMaterials(materials: PhosphorMaterials): void {
  Object.values(materials).forEach((material) => material.dispose());
}

export const PhosphorFlareEffect = React.memo(({ flare }: PhosphorFlareEffectProps) => {
  const removePhosphorFlare = useGameStore((state) => state.removePhosphorFlare);
  const canisterRef = useRef<THREE.Group>(null);
  const trailRef = useRef<THREE.Mesh>(null);
  const poolRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const burstRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const outerFlamesRef = useRef<THREE.InstancedMesh>(null);
  const innerFlamesRef = useRef<THREE.InstancedMesh>(null);
  const flameDummyRef = useRef(new THREE.Object3D());
  const positionRef = useRef(new THREE.Vector3());
  const nextPositionRef = useRef(new THREE.Vector3());
  const directionRef = useRef(new THREE.Vector3());
  const quaternionRef = useRef(new THREE.Quaternion());
  const removedRef = useRef(false);
  const lastDamageTickRef = useRef(new Map<string, number>());
  const materials = useMemo(createPhosphorMaterials, []);
  const createdAtMs = Date.now();
  const createdFrameTimeMs = getFrameClock().nowMs;
  const startFrameTimeRef = useRef(createdFrameTimeMs - (createdAtMs - flare.startTime));
  const impactFrameTimeRef = useRef(createdFrameTimeMs - (createdAtMs - flare.impactTime));
  const poolEndFrameTimeRef = useRef(createdFrameTimeMs - (createdAtMs - flare.poolEndsAt));
  const nextDamageScanFrameTimeRef = useRef(impactFrameTimeRef.current);

  useEffect(() => () => disposePhosphorMaterials(materials), [materials]);

  useLayoutEffect(() => {
    outerFlamesRef.current?.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    innerFlamesRef.current?.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }, []);

  useFrame(() => measureFrameWork('frame.effects.blazePhosphorFlare', () => {
    const now = getFrameClock().nowMs;
    const impactAt = impactFrameTimeRef.current;
    const poolEndsAt = poolEndFrameTimeRef.current;
    const beforeImpact = now < impactAt;

    if (beforeImpact) {
      const flightDuration = Math.max(60, impactAt - startFrameTimeRef.current);
      const flightProgress = THREE.MathUtils.clamp(
        (now - startFrameTimeRef.current) / flightDuration,
        0,
        1
      );
      const pathProgress = flightProgress * flare.impactProgress;
      const position = positionRef.current;
      const nextPosition = nextPositionRef.current;
      writeBlazePhosphorFlarePoint(position, flare.startPosition, flare.targetPosition, pathProgress);
      writeBlazePhosphorFlarePoint(
        nextPosition,
        flare.startPosition,
        flare.targetPosition,
        Math.min(flare.impactProgress, pathProgress + 0.015)
      );

      if (canisterRef.current) {
        canisterRef.current.visible = true;
        canisterRef.current.position.copy(position);
        const direction = directionRef.current.copy(nextPosition).sub(position);
        if (direction.lengthSq() > 0.000001) {
          direction.normalize();
          quaternionRef.current.setFromUnitVectors(CANISTER_UP, direction);
          canisterRef.current.quaternion.copy(quaternionRef.current);
        }
        canisterRef.current.rotateY(now * 0.012);
      }
      if (trailRef.current) {
        trailRef.current.visible = true;
        trailRef.current.position.copy(position);
        const pulse = 0.8 + Math.sin(now * 0.035) * 0.16;
        trailRef.current.scale.setScalar(pulse);
      }
      if (poolRef.current) poolRef.current.visible = false;
      if (burstRef.current) burstRef.current.visible = false;
      if (lightRef.current) {
        lightRef.current.intensity = 6;
        lightRef.current.position.copy(position);
      }
      return;
    }

    if (canisterRef.current) canisterRef.current.visible = false;
    if (trailRef.current) trailRef.current.visible = false;

    const impactElapsed = now - impactAt;
    if (lightRef.current) {
      lightRef.current.position.set(
        flare.impactPosition.x,
        flare.impactPosition.y + 0.5,
        flare.impactPosition.z
      );
    }
    const burstProgress = Math.min(1, impactElapsed / IMPACT_BURST_DURATION_MS);
    if (burstRef.current) {
      burstRef.current.visible = burstProgress < 1;
      burstRef.current.position.set(
        flare.impactPosition.x,
        flare.impactPosition.y + 0.18,
        flare.impactPosition.z
      );
      burstRef.current.scale.setScalar(0.2 + burstProgress * (flare.interceptedByChronosAegis ? 1.2 : 2.1));
      materials.burst.opacity = Math.max(0, 0.9 - burstProgress * 0.9);
    }

    if (!flare.interceptedByChronosAegis && now < poolEndsAt + POOL_FADE_OUT_MS) {
      const fadeIn = Math.min(1, impactElapsed / 180);
      const fadeOut = Math.min(1, Math.max(0, poolEndsAt + POOL_FADE_OUT_MS - now) / POOL_FADE_OUT_MS);
      const fade = fadeIn * fadeOut;
      if (poolRef.current) poolRef.current.visible = true;
      materials.pool.opacity = 0.34 * fade;
      materials.poolCore.opacity = 0.48 * fade;
      materials.ring.opacity = 0.72 * fade;
      materials.flameOuter.opacity = 0.84 * fade;
      materials.flameInner.opacity = 0.92 * fade;
      if (ringRef.current) ringRef.current.rotation.z = now * 0.0014;

      const outerFlames = outerFlamesRef.current;
      const innerFlames = innerFlamesRef.current;
      const flameDummy = flameDummyRef.current;
      for (let index = 0; index < POOL_FLAMES.length; index++) {
        const config = POOL_FLAMES[index];
        const flicker = 0.72 + Math.sin(now * 0.018 + config.phase) * 0.28;
        const height = config.size * (0.72 + flicker * 0.68) * fade;
        const width = 0.34 * config.size * fade;
        flameDummy.position.set(
          config.x * flare.radius,
          0.18 + height * 0.42,
          config.z * flare.radius
        );
        flameDummy.rotation.set(0, -config.phase + Math.sin(now * 0.003 + config.phase) * 0.22, 0);
        flameDummy.scale.set(width, height, width);
        flameDummy.updateMatrix();
        outerFlames?.setMatrixAt(index, flameDummy.matrix);

        flameDummy.position.y -= height * 0.05;
        flameDummy.scale.set(width * 0.52, height * 0.72, width * 0.52);
        flameDummy.updateMatrix();
        innerFlames?.setMatrixAt(index, flameDummy.matrix);
      }
      if (outerFlames) outerFlames.instanceMatrix.needsUpdate = true;
      if (innerFlames) innerFlames.instanceMatrix.needsUpdate = true;

      if (now >= nextDamageScanFrameTimeRef.current) {
        nextDamageScanFrameTimeRef.current = now + BLAZE_PHOSPHOR_FLARE_DAMAGE_INTERVAL_MS;
        applyTutorialOfflineTrainingAreaDamage({
          center: flare.targetPosition,
          radius: flare.radius,
          damage: BLAZE_PHOSPHOR_FLARE_DAMAGE,
          damageType: 'phosphor_flare',
          sourceId: flare.ownerId,
          sourceTeam: flare.ownerTeam,
          abilityId: 'blaze_phosphor_flare',
          falloffScale: 0,
          damageIntervalMs: BLAZE_PHOSPHOR_FLARE_DAMAGE_INTERVAL_MS,
          lastDamageTick: lastDamageTickRef.current,
        });
      }
      if (lightRef.current) lightRef.current.intensity = 11 * fade;
    } else {
      if (poolRef.current) poolRef.current.visible = false;
      if (lightRef.current) lightRef.current.intensity = Math.max(0, 5 * (1 - burstProgress));
    }

    const expiresAt = flare.interceptedByChronosAegis
      ? impactAt + IMPACT_BURST_DURATION_MS
      : poolEndsAt + POOL_FADE_OUT_MS;
    if (now >= expiresAt && !removedRef.current) {
      removedRef.current = true;
      removePhosphorFlare(flare.id);
    }
  }));

  return (
    <group>
      <group ref={canisterRef}>
        <mesh geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.2, 0.46, 0.2]} material={materials.shell} />
        <mesh geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.225, 0.12, 0.225]} material={materials.band} />
        <mesh position={[0, 0.3, 0]} geometry={SHARED_GEOMETRIES.sphere8} scale={[0.18, 0.18, 0.18]} material={materials.band} />
      </group>

      <mesh ref={trailRef} visible={false} geometry={SHARED_GEOMETRIES.sphere8} material={materials.trail} />
      <mesh ref={burstRef} visible={false} geometry={SHARED_GEOMETRIES.sphere8} material={materials.burst} />

      <group
        ref={poolRef}
        visible={false}
        position={[flare.targetPosition.x, flare.targetPosition.y + 0.08, flare.targetPosition.z]}
      >
        <mesh rotation-x={-Math.PI / 2} geometry={SHARED_GEOMETRIES.circle32} scale={[flare.radius, flare.radius, 1]} material={materials.pool} />
        <mesh rotation-x={-Math.PI / 2} position-y={0.025} geometry={SHARED_GEOMETRIES.circle16} scale={[flare.radius * 0.58, flare.radius * 0.58, 1]} material={materials.poolCore} />
        <mesh ref={ringRef} rotation-x={-Math.PI / 2} position-y={0.045} geometry={SHARED_GEOMETRIES.ring32} scale={[flare.radius, flare.radius, 1]} material={materials.ring} />
        <instancedMesh
          ref={outerFlamesRef}
          args={[SHARED_GEOMETRIES.cone8, materials.flameOuter, POOL_FLAME_COUNT]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={innerFlamesRef}
          args={[SHARED_GEOMETRIES.cone8, materials.flameInner, POOL_FLAME_COUNT]}
          frustumCulled={false}
        />
      </group>

      <BudgetedPointLight ref={lightRef} budgetPriority={1.15} color={0xff6a00} intensity={6} distance={16} decay={2} />
    </group>
  );
}, (previous, next) => previous.flare === next.flare);
