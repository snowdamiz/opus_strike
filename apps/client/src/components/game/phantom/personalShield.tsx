import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ABILITY_DEFINITIONS, type Player } from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { visualStore } from '../../../store/visualStore';
import { PHANTOM_COLORS, SHARED_GEOMETRIES } from '../effectResources';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { getFrameClock } from '../../../utils/frameClock';

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
const ACTIVE_ID_SCAN_INTERVAL_MS = 80;
const PHANTOM_PURPLE_COLOR = new THREE.Color(PHANTOM_COLORS.purple);
const PHANTOM_LIGHT_PURPLE_COLOR = new THREE.Color(PHANTOM_COLORS.lightPurple);
const PHANTOM_VIOLET_COLOR = new THREE.Color(PHANTOM_COLORS.violet);

function hasActivePersonalShield(player: Player | null | undefined): boolean {
  if (!player || player.state !== 'alive' || player.heroId !== 'phantom') return false;
  return Boolean(player.abilities?.[PHANTOM_PERSONAL_SHIELD_ABILITY_ID]?.isActive);
}

function getShieldAbilityStart(player: Player, now: number): number {
  return player.abilities?.[PHANTOM_PERSONAL_SHIELD_ABILITY_ID]?.activatedAt ?? now;
}

function collectActiveShieldIds(target: string[]): string[] {
  const store = useGameStore.getState();
  const localPlayerId = store.localPlayer?.id ?? null;
  target.length = 0;

  const addPlayer = (player: Player | null | undefined) => {
    if (!hasActivePersonalShield(player) || !player) return;
    target.push(player.id);
  };

  addPlayer(store.localPlayer);
  for (const player of store.players.values()) {
    if (player.id === localPlayerId) continue;
    addPlayer(player);
  }

  return target;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
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
    const now = getFrameClock().epochNowMs;
    if (!group || !player || !hasActivePersonalShield(player)) {
      if (group) group.visible = false;
      return;
    }

    const visualPosition = visualStore.getState().playerPositions.get(playerId) ?? player.position;
    const isLocalPlayer = useGameStore.getState().localPlayer?.id === playerId;
    const abilityDef = ABILITY_DEFINITIONS[PHANTOM_PERSONAL_SHIELD_ABILITY_ID];
    const duration = abilityDef?.duration ?? 6;
    const elapsed = Math.max(0, (now - getShieldAbilityStart(player, now)) / 1000);
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
    bubbleMaterial.color.copy(PHANTOM_PURPLE_COLOR).lerp(PHANTOM_LIGHT_PURPLE_COLOR, huePulse * 0.28);
    wireMaterial.color.copy(PHANTOM_LIGHT_PURPLE_COLOR).lerp(PHANTOM_VIOLET_COLOR, huePulse * 0.16);
    rimMaterial.color.copy(PHANTOM_VIOLET_COLOR).lerp(PHANTOM_LIGHT_PURPLE_COLOR, huePulse * 0.18);
    ringMaterial.color.copy(PHANTOM_PURPLE_COLOR).lerp(PHANTOM_VIOLET_COLOR, huePulse * 0.2);

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
  const activeIdsRef = useRef<string[]>([]);
  const scratchIdsRef = useRef<string[]>([]);
  const scanAccumulatorRef = useRef(ACTIVE_ID_SCAN_INTERVAL_MS);

  useFrame((_, delta) => {
    scanAccumulatorRef.current += delta * 1000;
    if (scanAccumulatorRef.current < ACTIVE_ID_SCAN_INTERVAL_MS) return;
    scanAccumulatorRef.current = 0;

    const nextIds = collectActiveShieldIds(scratchIdsRef.current);
    if (sameIds(nextIds, activeIdsRef.current)) return;

    const committedIds = nextIds.slice();
    activeIdsRef.current = committedIds;
    setActiveIds(committedIds);
  });

  return (
    <group>
      {activeIds.map((playerId) => (
        <PhantomPersonalShieldBubble key={playerId} playerId={playerId} />
      ))}
    </group>
  );
}
