import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { GamePhase, SafeZoneSnapshot, Vec3, VoxelMapManifest } from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import { isSafeZoneTargetRevealed } from '../../utils/battleRoyalSafeZoneReveal';
import { getPreparedVoxelMap, prepareVoxelMapCpu } from '../../utils/mapWarmup/mapPrepCache';

const SAFE_ZONE_SMOOTHING = 9.5;
const CURRENT_RING_OPACITY = 0.9;
const NEXT_RING_OPACITY = 0.5;
const CURRENT_WALL_OPACITY = 0.2;
const NEXT_WALL_OPACITY = 0.11;
const SAFE_ZONE_WALL_HEIGHT = 42;
const SAFE_ZONE_VISUAL_Y_OFFSET = 1.4;
const SAFE_ZONE_FALLBACK_VISUAL_Y_OFFSET = 18;
const SAFE_ZONE_RING_SAMPLE_COUNT = 96;

const SAFE_ZONE_RING_GEOMETRY = new THREE.RingGeometry(0.965, 1.035, 160);
const SAFE_ZONE_WALL_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 160, 1, true);
const SAFE_ZONE_STABLE_COLOR = new THREE.Color('#67e8f9');
const SAFE_ZONE_DANGER_COLOR = new THREE.Color('#f97316');
const SAFE_ZONE_NEXT_COLOR = new THREE.Color('#f8fafc');

function getSafeZoneWarningMix(safeZone: SafeZoneSnapshot): number {
  return safeZone.warning || safeZone.shrinking ? 1 : 0;
}

export function shouldRenderBattleRoyalSafeZone(input: {
  gamePhase: GamePhase;
  gameplayMode: string | null | undefined;
  safeZone: SafeZoneSnapshot | null | undefined;
}): boolean {
  return input.gameplayMode === 'battle_royal' &&
    input.gamePhase === 'playing' &&
    input.safeZone?.enabled === true;
}

function updateRingMaterial(
  material: THREE.MeshBasicMaterial,
  color: THREE.Color,
  opacity: number
): void {
  material.color.copy(color);
  material.opacity = opacity;
}

function getHeightfieldSurfaceY(manifest: VoxelMapManifest, point: Pick<Vec3, 'x' | 'z'>): number | null {
  const { heightfield } = manifest;
  const gridX = Math.floor((point.x - heightfield.origin.x) / heightfield.voxelSize.x);
  const gridZ = Math.floor((point.z - heightfield.origin.z) / heightfield.voxelSize.z);
  if (gridX < 0 || gridZ < 0 || gridX >= heightfield.size.x || gridZ >= heightfield.size.z) return null;

  const row = heightfield.topSolidRows[gridX + gridZ * heightfield.size.x] ?? 0;
  return heightfield.origin.y + row * heightfield.voxelSize.y;
}

export function getBattleRoyalSafeZoneVisualY(
  manifest: VoxelMapManifest | null | undefined,
  center: Vec3,
  radius: number
): number {
  if (!manifest) return center.y + SAFE_ZONE_FALLBACK_VISUAL_Y_OFFSET;

  let visualY = getHeightfieldSurfaceY(manifest, center) ?? center.y;
  const sampleRadius = Math.max(0, radius);
  if (sampleRadius > 0.1) {
    for (let index = 0; index < SAFE_ZONE_RING_SAMPLE_COUNT; index++) {
      const angle = (index / SAFE_ZONE_RING_SAMPLE_COUNT) * Math.PI * 2;
      const sampleY = getHeightfieldSurfaceY(manifest, {
        x: center.x + Math.cos(angle) * sampleRadius,
        z: center.z + Math.sin(angle) * sampleRadius,
      });
      if (sampleY !== null) visualY = Math.max(visualY, sampleY);
    }
  }

  return visualY + SAFE_ZONE_VISUAL_Y_OFFSET;
}

export function BattleRoyalSafeZone() {
  const gameplayMode = useGameStore((state) => state.gameplayMode);
  const mapSeed = useGameStore((state) => state.mapSeed);
  const mapThemeId = useGameStore((state) => state.mapThemeId);
  const mapSize = useGameStore((state) => state.mapSize);
  const mapProfileId = useGameStore((state) => state.mapProfileId);
  const rootRef = useRef<THREE.Group>(null);
  const currentRingRef = useRef<THREE.Mesh>(null);
  const nextRingRef = useRef<THREE.Mesh>(null);
  const currentWallRef = useRef<THREE.Mesh>(null);
  const nextWallRef = useRef<THREE.Mesh>(null);
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
    depthTest: false,
    blending: THREE.AdditiveBlending,
  }), []);
  const nextRingMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: SAFE_ZONE_NEXT_COLOR,
    transparent: true,
    opacity: NEXT_RING_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  }), []);
  const currentWallMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: SAFE_ZONE_STABLE_COLOR,
    transparent: true,
    opacity: CURRENT_WALL_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  }), []);
  const nextWallMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: SAFE_ZONE_NEXT_COLOR,
    transparent: true,
    opacity: NEXT_WALL_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  }), []);
  const manifest = useMemo(() => {
    if (gameplayMode !== 'battle_royal') return null;
    return (
      getPreparedVoxelMap({ seed: mapSeed, themeId: mapThemeId, mapSize, mapProfileId })
      ?? prepareVoxelMapCpu({ seed: mapSeed, themeId: mapThemeId, mapSize, mapProfileId, source: 'match' })
    ).manifest;
  }, [gameplayMode, mapProfileId, mapSeed, mapSize, mapThemeId]);

  useFrame(({ clock }, delta) => {
    const root = rootRef.current;
    const currentRing = currentRingRef.current;
    const nextRing = nextRingRef.current;
    const currentWall = currentWallRef.current;
    const nextWall = nextWallRef.current;
    if (!root || !currentRing || !nextRing || !currentWall || !nextWall) return;

    const store = useGameStore.getState();
    const safeZone = store.safeZone;
    if (!safeZone || !shouldRenderBattleRoyalSafeZone({
      gamePhase: store.gamePhase,
      gameplayMode: store.gameplayMode,
      safeZone,
    })) {
      root.visible = false;
      initializedRef.current = false;
      return;
    }

    root.visible = true;
    const targetCenter = safeZone.center;
    const targetNextCenter = safeZone.nextCenter;
    const targetRadius = Math.max(0.1, safeZone.radius);
    const targetNextRadius = Math.max(0.1, safeZone.nextRadius);
    targetCenterRef.current.set(
      targetCenter.x,
      getBattleRoyalSafeZoneVisualY(manifest, targetCenter, targetRadius),
      targetCenter.z
    );
    targetNextCenterRef.current.set(
      targetNextCenter.x,
      getBattleRoyalSafeZoneVisualY(manifest, targetNextCenter, targetNextRadius),
      targetNextCenter.z
    );

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
    currentWall.position.set(center.x, center.y - SAFE_ZONE_WALL_HEIGHT * 0.5, center.z);
    currentWall.rotation.set(0, clock.elapsedTime * 0.025, 0);
    currentWall.scale.set(radius, SAFE_ZONE_WALL_HEIGHT, radius);

    nextRing.visible = showNextZone;
    nextWall.visible = showNextZone;
    if (showNextZone) {
      nextRing.position.set(nextCenter.x, nextCenter.y + 0.22, nextCenter.z);
      nextRing.rotation.set(-Math.PI / 2, 0, -clock.elapsedTime * 0.055);
      nextRing.scale.setScalar(nextRadius);
      nextWall.position.set(nextCenter.x, nextCenter.y - SAFE_ZONE_WALL_HEIGHT * 0.5, nextCenter.z);
      nextWall.rotation.set(0, -clock.elapsedTime * 0.018, 0);
      nextWall.scale.set(nextRadius, SAFE_ZONE_WALL_HEIGHT, nextRadius);
    }

    updateRingMaterial(
      currentRingMaterial,
      warningMix > 0 ? SAFE_ZONE_DANGER_COLOR : SAFE_ZONE_STABLE_COLOR,
      CURRENT_RING_OPACITY * (safeZone.shrinking ? 1.08 : 1)
    );
    updateRingMaterial(nextRingMaterial, SAFE_ZONE_NEXT_COLOR, NEXT_RING_OPACITY);
    updateRingMaterial(
      currentWallMaterial,
      warningMix > 0 ? SAFE_ZONE_DANGER_COLOR : SAFE_ZONE_STABLE_COLOR,
      CURRENT_WALL_OPACITY * (safeZone.shrinking ? 1.28 : 1)
    );
    updateRingMaterial(nextWallMaterial, SAFE_ZONE_NEXT_COLOR, NEXT_WALL_OPACITY);
  });

  return (
    <group ref={rootRef} visible={false}>
      <mesh ref={currentWallRef} geometry={SAFE_ZONE_WALL_GEOMETRY} material={currentWallMaterial} frustumCulled={false} renderOrder={22} />
      <mesh ref={nextWallRef} geometry={SAFE_ZONE_WALL_GEOMETRY} material={nextWallMaterial} frustumCulled={false} renderOrder={21} />
      <mesh ref={currentRingRef} geometry={SAFE_ZONE_RING_GEOMETRY} material={currentRingMaterial} frustumCulled={false} renderOrder={24} />
      <mesh ref={nextRingRef} geometry={SAFE_ZONE_RING_GEOMETRY} material={nextRingMaterial} frustumCulled={false} renderOrder={23} />
    </group>
  );
}
