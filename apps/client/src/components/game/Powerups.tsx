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
const POWERUP_REFRESH_MS = 100;
const BURST_SPARK_ANGLES = [0, Math.PI / 3, (Math.PI * 2) / 3, Math.PI, (Math.PI * 4) / 3, (Math.PI * 5) / 3] as const;

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

function PowerupMesh({ pickup, collectedAt }: { pickup: MapPowerupPickup; collectedAt?: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const phase = useMemo(() => {
    let hash = 0;
    for (let index = 0; index < pickup.id.length; index++) {
      hash = Math.imul(hash ^ pickup.id.charCodeAt(index), 0x45d9f3b) >>> 0;
    }
    return (hash / 0xffffffff) * Math.PI * 2;
  }, [pickup.id]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const elapsed = clock.elapsedTime + phase;
    const popProgress = getPickupPopProgress(collectedAt) ?? 0;
    const popEase = easeOutCubic(popProgress);
    const idleWeight = 1 - popProgress;
    const popScale = collectedAt === undefined
      ? 1
      : Math.max(0.16, 1 + Math.sin(popProgress * Math.PI) * 0.5 - popEase * 0.78);

    group.position.y = pickup.position.y + Math.sin(elapsed * 2.2) * 0.14 * idleWeight + popEase * 0.72;
    group.rotation.y = elapsed * (pickup.kind === 'health_pack' ? 0.75 : 1.15) + popEase * Math.PI * 1.4;
    group.scale.setScalar(popScale);
  });

  if (pickup.kind === 'health_pack') {
    return (
      <group ref={groupRef} position={[pickup.position.x, pickup.position.y, pickup.position.z]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.82, 0.52, 0.82]} />
          <meshStandardMaterial color={HEALTH_PACK_COLOR} roughness={0.42} metalness={0.1} />
        </mesh>
        <mesh position={[0, 0.01, -0.415]}>
          <boxGeometry args={[0.18, 0.36, 0.04]} />
          <meshStandardMaterial color={HEALTH_CROSS_COLOR} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.01, -0.435]}>
          <boxGeometry args={[0.42, 0.14, 0.04]} />
          <meshStandardMaterial color={HEALTH_CROSS_COLOR} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.32, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.34, 0.025, 8, 28]} />
          <meshStandardMaterial color={HEALTH_CROSS_COLOR} roughness={0.28} metalness={0.15} />
        </mesh>
      </group>
    );
  }

  return (
    <group ref={groupRef} position={[pickup.position.x, pickup.position.y, pickup.position.z]}>
      <mesh castShadow>
        <octahedronGeometry args={[0.48, 0]} />
        <meshStandardMaterial color={POWERUP_CORE_COLOR} emissive={POWERUP_CORE_COLOR} emissiveIntensity={0.65} roughness={0.22} metalness={0.35} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.62, 0.035, 10, 42]} />
        <meshStandardMaterial color={POWERUP_RING_COLOR} emissive={POWERUP_RING_COLOR} emissiveIntensity={0.35} roughness={0.24} metalness={0.35} />
      </mesh>
      <mesh position={[0, -0.43, 0]} rotation={[0, Math.PI / 4, 0]}>
        <boxGeometry args={[0.48, 0.08, 0.48]} />
        <meshStandardMaterial color={POWERUP_TRIM_COLOR} emissive={POWERUP_TRIM_COLOR} emissiveIntensity={0.2} roughness={0.32} metalness={0.45} />
      </mesh>
    </group>
  );
}

function PickupCollectionBurst({ pickup, collectedAt }: { pickup: MapPowerupPickup; collectedAt: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const ringMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const color = pickup.kind === 'health_pack' ? HEALTH_CROSS_COLOR : POWERUP_RING_COLOR;
  const accentColor = pickup.kind === 'health_pack' ? HEALTH_PACK_COLOR : POWERUP_TRIM_COLOR;

  useFrame(() => {
    const group = groupRef.current;
    const progress = getPickupPopProgress(collectedAt);
    if (!group || progress === null) return;

    const eased = easeOutCubic(progress);
    group.position.y = pickup.position.y + 0.18 + eased * 0.54;
    group.rotation.y = eased * Math.PI * 2;
    group.scale.setScalar(0.65 + eased * 1.55);

    if (ringMaterialRef.current) {
      ringMaterialRef.current.opacity = Math.pow(1 - progress, 1.35) * 0.92;
    }
  });

  return (
    <group ref={groupRef} position={[pickup.position.x, pickup.position.y + 0.18, pickup.position.z]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.5, 0.025, 8, 40]} />
        <meshBasicMaterial ref={ringMaterialRef} color={color} transparent opacity={0.92} depthWrite={false} />
      </mesh>
      {BURST_SPARK_ANGLES.map((angle) => (
        <mesh
          key={angle}
          position={[Math.cos(angle) * 0.34, 0.05, Math.sin(angle) * 0.34]}
        >
          <sphereGeometry args={[0.055, 8, 8]} />
          <meshBasicMaterial color={accentColor} transparent opacity={0.85} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

export function Powerups() {
  const mapSeed = useGameStore((state) => state.mapSeed);
  const mapThemeId = useGameStore((state) => state.mapThemeId);
  const mapSize = useGameStore((state) => state.mapSize);
  const mapProfileId = useGameStore((state) => state.mapProfileId);
  const powerupPickups = useGameStore((state) => state.powerupPickups);
  const powerupPickupCollections = useGameStore((state) => state.powerupPickupCollections);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), POWERUP_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, []);

  const manifest = useMemo(() => {
    return (
      getPreparedVoxelMap({ seed: mapSeed, themeId: mapThemeId, mapSize, mapProfileId })
      ?? prepareVoxelMapCpu({ seed: mapSeed, themeId: mapThemeId, mapSize, mapProfileId, source: 'match' })
    ).manifest;
  }, [mapSeed, mapThemeId, mapSize, mapProfileId]);

  const visiblePickups = useMemo(() => {
    return manifest.gameplay.powerups.flatMap((pickup) => {
      const state = powerupPickups.get(pickup.id);
      const collection = powerupPickupCollections.get(pickup.id);
      const popProgress = getPickupPopProgress(collection?.collectedAt, now);
      const isRespawning = state !== undefined && state.availableAt > now;

      if (isRespawning && popProgress === null) return [];
      return [{
        pickup,
        collectedAt: popProgress === null ? undefined : collection?.collectedAt,
      }];
    });
  }, [manifest, now, powerupPickupCollections, powerupPickups]);

  if (visiblePickups.length === 0) return null;

  return (
    <group name="map-powerups">
      {visiblePickups.map(({ pickup, collectedAt }) => (
        <group key={pickup.id}>
          <PowerupMesh pickup={pickup} collectedAt={collectedAt} />
          {collectedAt !== undefined && <PickupCollectionBurst pickup={pickup} collectedAt={collectedAt} />}
        </group>
      ))}
    </group>
  );
}
