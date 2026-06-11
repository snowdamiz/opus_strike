import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ABILITY_DEFINITIONS,
  CHRONOS_ASCENDANT_PARADOX_DURATION_MS,
  type Player,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { visualStore } from '../../../store/visualStore';
import { SHARED_GEOMETRIES } from '../effectResources';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';

const CHRONOS_ASCENDANT_ABILITY_ID = 'chronos_ascendant_paradox';
const ASCENDANT_GREEN = 0x22c55e;
const ASCENDANT_LIGHT = 0xbbf7d0;
const ASCENDANT_DEEP = 0x15803d;
const BUBBLE_RADIUS = 1.82;
const BUBBLE_CENTER_Y_OFFSET = 0.08;
const FADE_IN_SECONDS = 0.24;
const FADE_OUT_SECONDS = 0.6;
const LOCAL_BUBBLE_OPACITY = 0.004;
const LOCAL_WIRE_OPACITY = 0.006;
const LOCAL_RING_OPACITY = 0.08;
const LOCAL_RIM_OPACITY = 0.008;
const REMOTE_BUBBLE_OPACITY = 0.12;
const REMOTE_WIRE_OPACITY = 0.32;
const REMOTE_RING_OPACITY = 0.42;
const REMOTE_RIM_OPACITY = 0.3;

function hasActiveAscendant(player: Player | null | undefined, now = Date.now()): boolean {
  if (!player || player.state !== 'alive' || player.heroId !== 'chronos') return false;

  const ability = player.abilities?.[CHRONOS_ASCENDANT_ABILITY_ID];
  if (!ability?.isActive) return false;

  const activatedAt = ability.activatedAt ?? now;
  return now - activatedAt < CHRONOS_ASCENDANT_PARADOX_DURATION_MS;
}

function getAscendantStart(player: Player): number {
  return player.abilities?.[CHRONOS_ASCENDANT_ABILITY_ID]?.activatedAt ?? Date.now();
}

function getAscendantDurationSeconds(): number {
  return ABILITY_DEFINITIONS[CHRONOS_ASCENDANT_ABILITY_ID]?.duration ??
    CHRONOS_ASCENDANT_PARADOX_DURATION_MS / 1000;
}

function collectActiveAscendantIds(): string[] {
  const store = useGameStore.getState();
  const ids: string[] = [];
  const seen = new Set<string>();
  const now = Date.now();

  const addPlayer = (player: Player | null | undefined) => {
    if (!player || seen.has(player.id) || !hasActiveAscendant(player, now)) return;
    ids.push(player.id);
    seen.add(player.id);
  };

  addPlayer(store.localPlayer);
  for (const player of store.players.values()) {
    addPlayer(player);
  }

  ids.sort();
  return ids;
}

function getAscendantPlayer(playerId: string): Player | null {
  const store = useGameStore.getState();
  if (store.localPlayer?.id === playerId) return store.localPlayer;
  return store.players.get(playerId) ?? null;
}

function createBubbleMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: ASCENDANT_GREEN,
    transparent: true,
    opacity: 0,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function createEnergyMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function ChronosAscendantBubble({ playerId }: { playerId: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const bubbleRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const ringARef = useRef<THREE.Mesh>(null);
  const ringBRef = useRef<THREE.Mesh>(null);
  const ringCRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const bubbleMaterialRef = useRef(createBubbleMaterial());
  const wireMaterialRef = useRef(createEnergyMaterial(ASCENDANT_LIGHT));
  const ringMaterialRef = useRef(createEnergyMaterial(ASCENDANT_LIGHT));
  const rimMaterialRef = useRef(createEnergyMaterial(ASCENDANT_GREEN));

  useEffect(() => () => {
    bubbleMaterialRef.current.dispose();
    wireMaterialRef.current.dispose();
    ringMaterialRef.current.dispose();
    rimMaterialRef.current.dispose();
  }, []);

  useFrame(() => {
    const group = groupRef.current;
    const player = getAscendantPlayer(playerId);
    const now = Date.now();
    if (!group || !player || !hasActiveAscendant(player, now)) {
      if (group) group.visible = false;
      return;
    }

    const visualPosition = visualStore.getState().playerPositions.get(playerId) ?? player.position;
    const isLocalPlayer = useGameStore.getState().localPlayer?.id === playerId;
    const duration = getAscendantDurationSeconds();
    const elapsed = Math.max(0, (now - getAscendantStart(player)) / 1000);
    const remaining = Math.max(0, duration - elapsed);
    const fadeIn = Math.min(1, elapsed / FADE_IN_SECONDS);
    const fadeOut = Math.min(1, remaining / FADE_OUT_SECONDS);
    const intensity = Math.max(0, Math.min(fadeIn, fadeOut));
    const pulse = 1 + Math.sin(elapsed * 5.8) * 0.026 + Math.sin(elapsed * 11.4) * 0.012;
    const radius = BUBBLE_RADIUS * pulse;

    group.visible = intensity > 0.01;
    group.position.set(
      visualPosition.x,
      visualPosition.y + BUBBLE_CENTER_Y_OFFSET,
      visualPosition.z
    );
    group.scale.setScalar(radius);

    bubbleMaterialRef.current.opacity = (isLocalPlayer ? LOCAL_BUBBLE_OPACITY : REMOTE_BUBBLE_OPACITY) * intensity;
    wireMaterialRef.current.opacity = (isLocalPlayer ? LOCAL_WIRE_OPACITY : REMOTE_WIRE_OPACITY) * intensity;
    ringMaterialRef.current.opacity = (isLocalPlayer ? LOCAL_RING_OPACITY : REMOTE_RING_OPACITY) * intensity;
    rimMaterialRef.current.opacity = (isLocalPlayer ? LOCAL_RIM_OPACITY : REMOTE_RIM_OPACITY) * intensity;

    const energyBlending = isLocalPlayer ? THREE.NormalBlending : THREE.AdditiveBlending;
    if (wireMaterialRef.current.blending !== energyBlending) {
      wireMaterialRef.current.blending = energyBlending;
      ringMaterialRef.current.blending = energyBlending;
      rimMaterialRef.current.blending = energyBlending;
      wireMaterialRef.current.needsUpdate = true;
      ringMaterialRef.current.needsUpdate = true;
      rimMaterialRef.current.needsUpdate = true;
    }

    const huePulse = (Math.sin(elapsed * 4.7) + 1) * 0.5;
    bubbleMaterialRef.current.color.setHex(ASCENDANT_DEEP).lerp(new THREE.Color(ASCENDANT_GREEN), 0.45 + huePulse * 0.24);
    wireMaterialRef.current.color.setHex(ASCENDANT_LIGHT).lerp(new THREE.Color(ASCENDANT_GREEN), huePulse * 0.2);
    ringMaterialRef.current.color.setHex(ASCENDANT_GREEN).lerp(new THREE.Color(ASCENDANT_LIGHT), huePulse * 0.26);

    if (bubbleRef.current) bubbleRef.current.scale.setScalar(1);
    if (wireRef.current) wireRef.current.scale.setScalar(1.012 + Math.sin(elapsed * 7.2) * 0.006);
    if (ringARef.current) ringARef.current.rotation.z = elapsed * 1.28;
    if (ringBRef.current) ringBRef.current.rotation.z = -elapsed * 1.55;
    if (ringCRef.current) ringCRef.current.rotation.z = elapsed * 1.82;
    if (lightRef.current) {
      lightRef.current.intensity = (isLocalPlayer ? 0.04 : 1.35) * intensity;
      lightRef.current.distance = isLocalPlayer ? 3.2 : 5.8;
    }
  });

  return (
    <group ref={groupRef} visible={false} frustumCulled={false}>
      <mesh ref={bubbleRef} geometry={SHARED_GEOMETRIES.sphere16} material={bubbleMaterialRef.current} frustumCulled={false} />
      <mesh ref={wireRef} geometry={SHARED_GEOMETRIES.sphere16} material={wireMaterialRef.current} scale={[1.012, 1.012, 1.012]} frustumCulled={false} />
      <mesh geometry={SHARED_GEOMETRIES.sphere12} material={rimMaterialRef.current} scale={[1.026, 1.026, 1.026]} frustumCulled={false} />
      <mesh ref={ringARef} geometry={SHARED_GEOMETRIES.ring32} material={ringMaterialRef.current} scale={[1.04, 1.04, 1.04]} frustumCulled={false} />
      <mesh ref={ringBRef} geometry={SHARED_GEOMETRIES.ring32} material={ringMaterialRef.current} rotation={[Math.PI / 2, 0, 0]} scale={[1.05, 1.05, 1.05]} frustumCulled={false} />
      <mesh ref={ringCRef} geometry={SHARED_GEOMETRIES.ring32} material={ringMaterialRef.current} rotation={[0, Math.PI / 2, 0]} scale={[1.06, 1.06, 1.06]} frustumCulled={false} />
      <BudgetedPointLight ref={lightRef} budgetPriority={0.32} position={[0, 0.18, 0]} color={ASCENDANT_GREEN} intensity={0} distance={5.8} decay={2} />
    </group>
  );
}

export function ChronosAscendantManager() {
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const activeKeyRef = useRef('');

  useFrame(() => {
    const nextIds = collectActiveAscendantIds();
    const nextKey = nextIds.join('|');
    if (nextKey === activeKeyRef.current) return;

    activeKeyRef.current = nextKey;
    setActiveIds(nextIds);
  });

  return (
    <group>
      {activeIds.map((playerId) => (
        <ChronosAscendantBubble key={playerId} playerId={playerId} />
      ))}
    </group>
  );
}
