import { memo, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { BattleRoyalHeroSoulSnapshot, MapSummoningCircle } from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import { getPreparedVoxelMap, prepareVoxelMapCpu } from '../../utils/mapWarmup/mapPrepCache';
import { HeroVoxelBody } from './HeroVoxelBody';

const SOUL_COLOR = '#8eeaff';
const SOUL_CORE_COLOR = '#c8fbff';
const SOUL_GLOW_COLOR = '#2dd4ff';
const CIRCLE_BASE_COLOR = '#0c2f2c';
const CIRCLE_INNER_COLOR = '#d9fff6';
const CIRCLE_PRIMARY_COLOR = '#41f0c8';
const CIRCLE_SECONDARY_COLOR = '#6ab7ff';
const RING_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0];
const STATION_POST_ANGLES = [0, Math.PI / 2, Math.PI, Math.PI * 1.5] as const;
const SOUL_HOVER_HEIGHT = 0.42;
const SOUL_BOB_AMPLITUDE = 0.055;

function getStablePhase(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index++) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x45d9f3b) >>> 0;
  }
  return (hash / 0xffffffff) * Math.PI * 2;
}

const FloatingHeroSoul = memo(function FloatingHeroSoul({
  soul,
}: {
  soul: BattleRoyalHeroSoulSnapshot;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const phase = useMemo(() => getStablePhase(soul.soulId), [soul.soulId]);

  useFrame(({ clock }, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const elapsed = clock.elapsedTime;
    group.position.y = soul.position.y + SOUL_HOVER_HEIGHT + Math.sin(elapsed * 1.65 + phase) * SOUL_BOB_AMPLITUDE;
    group.rotation.y += delta * 0.36;
    const pulse = 1 + Math.sin(elapsed * 2.4 + phase) * 0.035;
    group.scale.setScalar(pulse);
  });

  return (
    <group
      ref={groupRef}
      position={[soul.position.x, soul.position.y + SOUL_HOVER_HEIGHT, soul.position.z]}
      renderOrder={5}
    >
      <mesh scale={[0.72, 1.14, 0.72]} renderOrder={3}>
        <sphereGeometry args={[0.82, 18, 14]} />
        <meshBasicMaterial
          color={SOUL_GLOW_COLOR}
          transparent
          opacity={0.14}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, -0.04, 0]} scale={[0.36, 0.52, 0.36]} renderOrder={4}>
        <sphereGeometry args={[0.42, 18, 12]} />
        <meshBasicMaterial
          color={SOUL_CORE_COLOR}
          transparent
          opacity={0.18}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <HeroVoxelBody
        heroId={soul.heroId}
        skinId={soul.skinId}
        team={soul.team}
        height={1.52}
        idleIntensity={0.82}
        showTeamAccents={false}
        castShadow={false}
        bodyOpacity={0.5}
        showOutline
        silhouetteColor={SOUL_COLOR}
        silhouetteOpacity={0.62}
      />
    </group>
  );
});

const SummoningCircleVisual = memo(function SummoningCircleVisual({
  circle,
}: {
  circle: MapSummoningCircle;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const phase = useMemo(() => getStablePhase(circle.id), [circle.id]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const pulse = 1 + Math.sin(clock.elapsedTime * 1.7 + phase) * 0.018;
    group.scale.set(pulse, 1, pulse);
  });

  return (
    <group
      ref={groupRef}
      position={[circle.position.x, circle.position.y + 0.08, circle.position.z]}
      renderOrder={2}
    >
      <mesh position={[0, -0.025, 0]} renderOrder={1} receiveShadow>
        <cylinderGeometry args={[circle.radius * 0.98, circle.radius * 0.98, 0.08, 80]} />
        <meshStandardMaterial
          color={CIRCLE_BASE_COLOR}
          emissive={CIRCLE_PRIMARY_COLOR}
          emissiveIntensity={0.18}
          roughness={0.62}
          metalness={0.18}
          transparent
          opacity={0.84}
        />
      </mesh>
      <mesh rotation={RING_ROTATION} renderOrder={2}>
        <torusGeometry args={[circle.radius * 0.92, 0.055, 10, 96]} />
        <meshBasicMaterial
          color={CIRCLE_PRIMARY_COLOR}
          transparent
          opacity={0.84}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={RING_ROTATION} renderOrder={2}>
        <torusGeometry args={[circle.radius * 0.58, 0.035, 8, 72]} />
        <meshBasicMaterial
          color={CIRCLE_SECONDARY_COLOR}
          transparent
          opacity={0.68}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={RING_ROTATION} renderOrder={2}>
        <torusGeometry args={[circle.radius * 0.22, 0.045, 8, 48]} />
        <meshBasicMaterial
          color={CIRCLE_INNER_COLOR}
          transparent
          opacity={0.72}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={RING_ROTATION} renderOrder={1}>
        <circleGeometry args={[circle.radius * 0.9, 72]} />
        <meshBasicMaterial
          color={CIRCLE_INNER_COLOR}
          transparent
          opacity={0.18}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 0.92, 0]} renderOrder={3}>
        <cylinderGeometry args={[0.16, 0.44, 1.7, 28, 1, true]} />
        <meshBasicMaterial
          color={CIRCLE_PRIMARY_COLOR}
          transparent
          opacity={0.16}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 0.2, 0]} renderOrder={3}>
        <cylinderGeometry args={[0.28, 0.36, 0.24, 24]} />
        <meshStandardMaterial
          color={CIRCLE_BASE_COLOR}
          emissive={CIRCLE_SECONDARY_COLOR}
          emissiveIntensity={0.28}
          roughness={0.5}
          metalness={0.22}
        />
      </mesh>
      {STATION_POST_ANGLES.map((angle, index) => {
        const x = Math.cos(angle) * circle.radius * 0.78;
        const z = Math.sin(angle) * circle.radius * 0.78;
        return (
          <group key={index} position={[x, 0, z]}>
            <mesh position={[0, 0.34, 0]} renderOrder={3}>
              <cylinderGeometry args={[0.09, 0.14, 0.68, 10]} />
              <meshStandardMaterial
                color={CIRCLE_BASE_COLOR}
                emissive={CIRCLE_PRIMARY_COLOR}
                emissiveIntensity={0.32}
                roughness={0.48}
                metalness={0.2}
              />
            </mesh>
            <mesh position={[0, 0.78, 0]} renderOrder={4}>
              <sphereGeometry args={[0.17, 12, 8]} />
              <meshBasicMaterial
                color={CIRCLE_INNER_COLOR}
                transparent
                opacity={0.86}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
});

export function BattleRoyalSouls() {
  const gameplayMode = useGameStore((state) => state.gameplayMode);
  const gamePhase = useGameStore((state) => state.gamePhase);
  const mapSeed = useGameStore((state) => state.mapSeed);
  const mapThemeId = useGameStore((state) => state.mapThemeId);
  const mapSize = useGameStore((state) => state.mapSize);
  const mapProfileId = useGameStore((state) => state.mapProfileId);
  const pregeneratedMapId = useGameStore((state) => state.pregeneratedMapId);
  const battleRoyalSouls = useGameStore((state) => state.battleRoyalSouls);
  const isBattleRoyalActive = gameplayMode === 'battle_royal' && (
    gamePhase === 'countdown' ||
    gamePhase === 'deployment' ||
    gamePhase === 'playing'
  );

  const manifest = useMemo(() => {
    if (!isBattleRoyalActive) return null;
    return (
      getPreparedVoxelMap({ seed: mapSeed, themeId: mapThemeId, mapSize, mapProfileId, pregeneratedMapId })
      ?? prepareVoxelMapCpu({ seed: mapSeed, themeId: mapThemeId, mapSize, mapProfileId, pregeneratedMapId, source: 'match' })
    ).manifest;
  }, [gamePhase, isBattleRoyalActive, mapProfileId, mapSeed, mapSize, mapThemeId, pregeneratedMapId]);

  const visibleSouls = useMemo(
    () => (battleRoyalSouls?.souls ?? []).filter((soul) => (
      soul.status === 'available' ||
      soul.status === 'collecting'
    )),
    [battleRoyalSouls?.souls]
  );
  const summoningCircles = manifest?.gameplay.summoningCircles ?? [];

  if (!isBattleRoyalActive || (summoningCircles.length === 0 && visibleSouls.length === 0)) return null;

  return (
    <group>
      {summoningCircles.map((circle) => (
        <SummoningCircleVisual key={circle.id} circle={circle} />
      ))}
      {visibleSouls.map((soul) => (
        <FloatingHeroSoul key={soul.soulId} soul={soul} />
      ))}
    </group>
  );
}
