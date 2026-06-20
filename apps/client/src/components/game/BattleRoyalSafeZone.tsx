import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { SafeZoneSnapshot } from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import { isSafeZoneTargetRevealed } from '../../utils/battleRoyalSafeZoneReveal';

const SAFE_ZONE_SMOOTHING = 9.5;
const CURRENT_RING_OPACITY = 0.62;
const NEXT_RING_OPACITY = 0.3;

const SAFE_ZONE_RING_GEOMETRY = new THREE.RingGeometry(0.982, 1.018, 128);
const SAFE_ZONE_STABLE_COLOR = new THREE.Color('#67e8f9');
const SAFE_ZONE_DANGER_COLOR = new THREE.Color('#f97316');
const SAFE_ZONE_NEXT_COLOR = new THREE.Color('#f8fafc');

function getSafeZoneWarningMix(safeZone: SafeZoneSnapshot): number {
  return safeZone.warning || safeZone.shrinking ? 1 : 0;
}

function updateRingMaterial(
  material: THREE.MeshBasicMaterial,
  color: THREE.Color,
  opacity: number
): void {
  material.color.copy(color);
  material.opacity = opacity;
}

export function BattleRoyalSafeZone() {
  const rootRef = useRef<THREE.Group>(null);
  const currentRingRef = useRef<THREE.Mesh>(null);
  const nextRingRef = useRef<THREE.Mesh>(null);
  const currentCenterRef = useRef(new THREE.Vector3());
  const nextCenterRef = useRef(new THREE.Vector3());
  const targetCenterRef = useRef(new THREE.Vector3());
  const targetNextCenterRef = useRef(new THREE.Vector3());
  const currentRadiusRef = useRef(0);
  const nextRadiusRef = useRef(0);
  const initializedRef = useRef(false);
  const currentRingMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: SAFE_ZONE_STABLE_COLOR,
    transparent: true,
    opacity: CURRENT_RING_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);
  const nextRingMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: SAFE_ZONE_NEXT_COLOR,
    transparent: true,
    opacity: NEXT_RING_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);

  useFrame(({ clock }, delta) => {
    const root = rootRef.current;
    const currentRing = currentRingRef.current;
    const nextRing = nextRingRef.current;
    if (!root || !currentRing || !nextRing) return;

    const store = useGameStore.getState();
    const safeZone = store.gameplayMode === 'battle_royal' ? store.safeZone : null;
    if (!safeZone?.enabled) {
      root.visible = false;
      initializedRef.current = false;
      return;
    }

    root.visible = true;
    const targetCenter = safeZone.center;
    const targetNextCenter = safeZone.nextCenter;
    const targetRadius = Math.max(0.1, safeZone.radius);
    const targetNextRadius = Math.max(0.1, safeZone.nextRadius);
    targetCenterRef.current.set(targetCenter.x, targetCenter.y, targetCenter.z);
    targetNextCenterRef.current.set(targetNextCenter.x, targetNextCenter.y, targetNextCenter.z);

    if (!initializedRef.current) {
      currentCenterRef.current.copy(targetCenterRef.current);
      nextCenterRef.current.copy(targetNextCenterRef.current);
      currentRadiusRef.current = targetRadius;
      nextRadiusRef.current = targetNextRadius;
      initializedRef.current = true;
    } else {
      const alpha = 1 - Math.exp(-SAFE_ZONE_SMOOTHING * Math.max(0, delta));
      currentCenterRef.current.lerp(targetCenterRef.current, alpha);
      nextCenterRef.current.lerp(targetNextCenterRef.current, alpha);
      currentRadiusRef.current = THREE.MathUtils.lerp(currentRadiusRef.current, targetRadius, alpha);
      nextRadiusRef.current = THREE.MathUtils.lerp(nextRadiusRef.current, targetNextRadius, alpha);
    }

    const center = currentCenterRef.current;
    const nextCenter = nextCenterRef.current;
    const radius = currentRadiusRef.current;
    const nextRadius = nextRadiusRef.current;
    const warningMix = getSafeZoneWarningMix(safeZone);
    const showNextZone = isSafeZoneTargetRevealed(safeZone);

    currentRing.position.set(center.x, center.y + 0.18, center.z);
    currentRing.rotation.set(-Math.PI / 2, 0, clock.elapsedTime * 0.08);
    currentRing.scale.setScalar(radius);

    nextRing.visible = showNextZone;
    if (showNextZone) {
      nextRing.position.set(nextCenter.x, nextCenter.y + 0.22, nextCenter.z);
      nextRing.rotation.set(-Math.PI / 2, 0, -clock.elapsedTime * 0.055);
      nextRing.scale.setScalar(nextRadius);
    }

    updateRingMaterial(
      currentRingMaterial,
      warningMix > 0 ? SAFE_ZONE_DANGER_COLOR : SAFE_ZONE_STABLE_COLOR,
      CURRENT_RING_OPACITY * (safeZone.shrinking ? 1.08 : 1)
    );
    updateRingMaterial(nextRingMaterial, SAFE_ZONE_NEXT_COLOR, NEXT_RING_OPACITY);
  });

  return (
    <group ref={rootRef} visible={false}>
      <mesh ref={currentRingRef} geometry={SAFE_ZONE_RING_GEOMETRY} material={currentRingMaterial} frustumCulled={false} />
      <mesh ref={nextRingRef} geometry={SAFE_ZONE_RING_GEOMETRY} material={nextRingMaterial} frustumCulled={false} />
    </group>
  );
}
