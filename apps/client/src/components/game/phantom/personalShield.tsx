import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ABILITY_DEFINITIONS, type Player } from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { visualStore } from '../../../store/visualStore';
import { PHANTOM_COLORS, SHARED_GEOMETRIES } from '../effectResources';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';

const PHANTOM_PERSONAL_SHIELD_ABILITY_ID = 'phantom_personal_shield';
const SHIELD_RADIUS = 1.58;
const SHIELD_CENTER_Y_OFFSET = 0;
const SHIELD_FADE_IN_SECONDS = 0.18;
const SHIELD_FADE_OUT_SECONDS = 0.45;
const REMOTE_BUBBLE_OPACITY = 0.16;
const REMOTE_WIREFRAME_OPACITY = 0.34;
const REMOTE_RIM_OPACITY = 0.34;
const REMOTE_RING_OPACITY = 0.44;
const LOCAL_BUBBLE_OPACITY = 0.07;
const LOCAL_WIREFRAME_OPACITY = 0.2;
const LOCAL_RIM_OPACITY = 0.16;
const LOCAL_RING_OPACITY = 0.24;

function hasActivePersonalShield(player: Player | null | undefined): boolean {
  if (!player || player.state !== 'alive' || player.heroId !== 'phantom') return false;
  return Boolean(player.abilities?.[PHANTOM_PERSONAL_SHIELD_ABILITY_ID]?.isActive);
}

function getShieldAbilityStart(player: Player): number {
  return player.abilities?.[PHANTOM_PERSONAL_SHIELD_ABILITY_ID]?.activatedAt ?? Date.now();
}

function collectActiveShieldIds(): string[] {
  const store = useGameStore.getState();
  const ids: string[] = [];
  const seen = new Set<string>();

  const addPlayer = (player: Player | null | undefined) => {
    if (!hasActivePersonalShield(player) || !player || seen.has(player.id)) return;
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

function getShieldPlayer(playerId: string): Player | null {
  const store = useGameStore.getState();
  if (store.localPlayer?.id === playerId) return store.localPlayer;
  return store.players.get(playerId) ?? null;
}

function createBubbleMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: PHANTOM_COLORS.lightPurple,
    transparent: true,
    opacity: 0,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function createRimMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: PHANTOM_COLORS.violet,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function createWireMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: PHANTOM_COLORS.lightPurple,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    wireframe: true,
    toneMapped: false,
  });
}

function PhantomPersonalShieldBubble({ playerId }: { playerId: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const bubbleRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const rimRef = useRef<THREE.Mesh>(null);
  const ringARef = useRef<THREE.Mesh>(null);
  const ringBRef = useRef<THREE.Mesh>(null);
  const ringCRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const bubbleMaterialRef = useRef(createBubbleMaterial());
  const wireMaterialRef = useRef(createWireMaterial());
  const rimMaterialRef = useRef(createRimMaterial());
  const ringMaterialRef = useRef(createRimMaterial());

  useEffect(() => () => {
    bubbleMaterialRef.current.dispose();
    wireMaterialRef.current.dispose();
    rimMaterialRef.current.dispose();
    ringMaterialRef.current.dispose();
  }, []);

  useFrame(() => {
    const group = groupRef.current;
    const player = getShieldPlayer(playerId);
    if (!group || !player || !hasActivePersonalShield(player)) {
      if (group) group.visible = false;
      return;
    }

    const visualPosition = visualStore.getState().playerPositions.get(playerId) ?? player.position;
    const isLocalPlayer = useGameStore.getState().localPlayer?.id === playerId;
    const abilityDef = ABILITY_DEFINITIONS[PHANTOM_PERSONAL_SHIELD_ABILITY_ID];
    const duration = abilityDef?.duration ?? 6;
    const elapsed = Math.max(0, (Date.now() - getShieldAbilityStart(player)) / 1000);
    const remaining = Math.max(0, duration - elapsed);
    const fadeIn = Math.min(1, elapsed / SHIELD_FADE_IN_SECONDS);
    const fadeOut = Math.min(1, remaining / SHIELD_FADE_OUT_SECONDS);
    const intensity = Math.max(0, Math.min(fadeIn, fadeOut));
    const pulse = 1 + Math.sin(elapsed * 6.2) * 0.025;
    const radius = SHIELD_RADIUS * pulse;

    group.visible = intensity > 0.01;
    group.position.set(
      visualPosition.x,
      visualPosition.y + SHIELD_CENTER_Y_OFFSET,
      visualPosition.z
    );
    group.scale.setScalar(radius);

    const bubbleMaterial = bubbleMaterialRef.current;
    const wireMaterial = wireMaterialRef.current;
    const rimMaterial = rimMaterialRef.current;
    const ringMaterial = ringMaterialRef.current;
    bubbleMaterial.opacity = (isLocalPlayer ? LOCAL_BUBBLE_OPACITY : REMOTE_BUBBLE_OPACITY) * intensity;
    wireMaterial.opacity = (isLocalPlayer ? LOCAL_WIREFRAME_OPACITY : REMOTE_WIREFRAME_OPACITY) * intensity;
    rimMaterial.opacity = (isLocalPlayer ? LOCAL_RIM_OPACITY : REMOTE_RIM_OPACITY) * intensity;
    ringMaterial.opacity = (isLocalPlayer ? LOCAL_RING_OPACITY : REMOTE_RING_OPACITY) * intensity;

    const huePulse = (Math.sin(elapsed * 4.4) + 1) * 0.5;
    bubbleMaterial.color.set(PHANTOM_COLORS.purple).lerp(new THREE.Color(PHANTOM_COLORS.lightPurple), huePulse * 0.28);
    wireMaterial.color.set(PHANTOM_COLORS.lightPurple).lerp(new THREE.Color(PHANTOM_COLORS.violet), huePulse * 0.16);
    rimMaterial.color.set(PHANTOM_COLORS.violet).lerp(new THREE.Color(PHANTOM_COLORS.lightPurple), huePulse * 0.18);
    ringMaterial.color.set(PHANTOM_COLORS.purple).lerp(new THREE.Color(PHANTOM_COLORS.violet), huePulse * 0.2);

    if (bubbleRef.current) bubbleRef.current.scale.setScalar(1);
    if (wireRef.current) wireRef.current.scale.setScalar(1.01 + Math.sin(elapsed * 5.2) * 0.004);
    if (rimRef.current) rimRef.current.scale.setScalar(1.018 + Math.sin(elapsed * 8) * 0.008);
    if (ringARef.current) ringARef.current.rotation.z = elapsed * 0.9;
    if (ringBRef.current) ringBRef.current.rotation.z = -elapsed * 1.12;
    if (ringCRef.current) ringCRef.current.rotation.z = elapsed * 1.35;
    if (lightRef.current) {
      lightRef.current.intensity = (isLocalPlayer ? 0.65 : 1.5) * intensity;
      lightRef.current.distance = 5.2;
    }
  });

  return (
    <group ref={groupRef} visible={false} frustumCulled={false}>
      <mesh ref={bubbleRef} geometry={SHARED_GEOMETRIES.sphere16} material={bubbleMaterialRef.current} frustumCulled={false} />
      <mesh ref={wireRef} geometry={SHARED_GEOMETRIES.sphere16} material={wireMaterialRef.current} scale={[1.01, 1.01, 1.01]} frustumCulled={false} />
      <mesh ref={rimRef} geometry={SHARED_GEOMETRIES.sphere12} material={rimMaterialRef.current} scale={[1.018, 1.018, 1.018]} frustumCulled={false} />
      <mesh ref={ringARef} geometry={SHARED_GEOMETRIES.ring32} material={ringMaterialRef.current} scale={[1.03, 1.03, 1.03]} frustumCulled={false} />
      <mesh ref={ringBRef} geometry={SHARED_GEOMETRIES.ring32} material={ringMaterialRef.current} rotation={[Math.PI / 2, 0, 0]} scale={[1.04, 1.04, 1.04]} frustumCulled={false} />
      <mesh ref={ringCRef} geometry={SHARED_GEOMETRIES.ring32} material={ringMaterialRef.current} rotation={[0, Math.PI / 2, 0]} scale={[1.05, 1.05, 1.05]} frustumCulled={false} />
      <BudgetedPointLight ref={lightRef} budgetPriority={0.24} position={[0, 0.12, 0]} color={PHANTOM_COLORS.violet} intensity={0} distance={5.2} decay={2} />
    </group>
  );
}

export function PhantomPersonalShieldsManager() {
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const activeKeyRef = useRef('');

  useFrame(() => {
    const nextIds = collectActiveShieldIds();
    const nextKey = nextIds.join('|');
    if (nextKey === activeKeyRef.current) return;
    activeKeyRef.current = nextKey;
    setActiveIds(nextIds);
  });

  return (
    <group>
      {activeIds.map((playerId) => (
        <PhantomPersonalShieldBubble key={playerId} playerId={playerId} />
      ))}
    </group>
  );
}
