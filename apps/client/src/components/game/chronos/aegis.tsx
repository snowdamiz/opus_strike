import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../../store/gameStore';
import { visualStore } from '../../../store/visualStore';
import { SHARED_GEOMETRIES } from '../effectResources';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import {
  CHRONOS_AEGIS_PANEL_HEIGHT,
  CHRONOS_AEGIS_PANEL_WIDTH,
  createChronosAegisPanelGeometry,
} from './aegisGeometry';

const CHRONOS_AEGIS_COLOR = 0x22c55e;
const CHRONOS_AEGIS_EDGE_COLOR = 0x86efac;
const CHRONOS_AEGIS_STALE_MS = 320;
const CHRONOS_AEGIS_WORLD_WIDTH = CHRONOS_AEGIS_PANEL_WIDTH * 1.05;
const CHRONOS_AEGIS_WORLD_HEIGHT = CHRONOS_AEGIS_PANEL_HEIGHT * 1.05;
const CHRONOS_AEGIS_EDGE_THICKNESS = 0.09;
const CHRONOS_AEGIS_FORWARD_OFFSET = 1.85;
const CHRONOS_AEGIS_CENTER_Y = 1.02;
const CHRONOS_AEGIS_FADE_IN_SECONDS = 0.18;
const CHRONOS_AEGIS_FILL_OPACITY = 0.2;
const CHRONOS_AEGIS_EDGE_OPACITY = 0.72;
const CHRONOS_AEGIS_WIRE_OPACITY = 0.28;

function createAegisFillMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: CHRONOS_AEGIS_COLOR,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function createAegisRingMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: CHRONOS_AEGIS_EDGE_COLOR,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function createAegisWireMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: CHRONOS_AEGIS_EDGE_COLOR,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    wireframe: true,
    toneMapped: false,
  });
}

function collectActiveChronosAegisIds(): string[] {
  const store = useGameStore.getState();
  const localPlayerId = store.localPlayer?.id;
  const visual = visualStore.getState();
  const now = Date.now();
  const ids: string[] = [];

  for (const player of store.players.values()) {
    if (player.id === localPlayerId) continue;
    if (player.heroId !== 'chronos' || player.state !== 'alive') continue;

    const aegis = visual.chronosAegisStates.get(player.id);
    if (!aegis?.active || now - aegis.updatedAtMs > CHRONOS_AEGIS_STALE_MS) continue;

    ids.push(player.id);
  }

  ids.sort();
  return ids;
}

function ChronosAegisShield({ playerId }: { playerId: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const fillRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const braceRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const fillGeometry = useMemo(
    () => createChronosAegisPanelGeometry(
      CHRONOS_AEGIS_WORLD_WIDTH,
      CHRONOS_AEGIS_WORLD_HEIGHT,
      0.24,
      1
    ),
    []
  );
  const wireGeometry = useMemo(
    () => createChronosAegisPanelGeometry(
      CHRONOS_AEGIS_WORLD_WIDTH * 0.96,
      CHRONOS_AEGIS_WORLD_HEIGHT * 0.94,
      0.2,
      1,
      6,
      5
    ),
    []
  );
  const fillMaterialRef = useRef(createAegisFillMaterial());
  const ringMaterialRef = useRef(createAegisRingMaterial());
  const wireMaterialRef = useRef(createAegisWireMaterial());

  useEffect(() => () => {
    fillGeometry.dispose();
    wireGeometry.dispose();
    fillMaterialRef.current.dispose();
    ringMaterialRef.current.dispose();
    wireMaterialRef.current.dispose();
  }, [fillGeometry, wireGeometry]);

  useFrame(() => {
    const group = groupRef.current;
    const player = useGameStore.getState().players.get(playerId);
    const aegis = visualStore.getState().chronosAegisStates.get(playerId);
    if (!group || !player || !aegis?.active) {
      if (group) group.visible = false;
      return;
    }

    const now = Date.now();
    if (now - aegis.updatedAtMs > CHRONOS_AEGIS_STALE_MS) {
      group.visible = false;
      return;
    }

    const visualPosition = visualStore.getState().playerPositions.get(playerId) ?? player.position;
    const visualYaw = visualStore.getState().playerRotations.get(playerId) ?? player.lookYaw;
    const forwardX = -Math.sin(visualYaw);
    const forwardZ = -Math.cos(visualYaw);
    const elapsed = Math.max(0, (now - aegis.activatedAtMs) / 1000);
    const fade = THREE.MathUtils.smoothstep(elapsed, 0, CHRONOS_AEGIS_FADE_IN_SECONDS);
    const pulse = 1 + Math.sin(elapsed * 5.4) * 0.018;
    const shieldScale = THREE.MathUtils.lerp(0.74, 1.05, fade) * pulse;

    group.visible = fade > 0.01;
    group.position.set(
      visualPosition.x + forwardX * CHRONOS_AEGIS_FORWARD_OFFSET,
      visualPosition.y + CHRONOS_AEGIS_CENTER_Y,
      visualPosition.z + forwardZ * CHRONOS_AEGIS_FORWARD_OFFSET
    );
    group.rotation.set(0, Math.atan2(forwardX, forwardZ), 0);
    group.scale.set(shieldScale, shieldScale, 1);

    fillMaterialRef.current.opacity = CHRONOS_AEGIS_FILL_OPACITY * fade;
    ringMaterialRef.current.opacity = CHRONOS_AEGIS_EDGE_OPACITY * fade;
    wireMaterialRef.current.opacity = CHRONOS_AEGIS_WIRE_OPACITY * fade;

    if (fillRef.current) {
      fillRef.current.scale.set(1, 1 + Math.sin(elapsed * 4.2) * 0.006, 1);
    }
    if (wireRef.current) {
      wireRef.current.scale.setScalar(0.97 + Math.sin(elapsed * 6.1) * 0.01);
    }
    if (braceRef.current) {
      braceRef.current.position.z = 0.02 + Math.sin(elapsed * 4.8) * 0.008;
    }
    if (lightRef.current) {
      lightRef.current.intensity = 1.35 * fade;
      lightRef.current.distance = 4.4;
    }
  });

  const halfWidth = CHRONOS_AEGIS_WORLD_WIDTH * 0.5;
  const halfHeight = CHRONOS_AEGIS_WORLD_HEIGHT * 0.5;
  const edgeThickness = CHRONOS_AEGIS_EDGE_THICKNESS;

  return (
    <group ref={groupRef} visible={false} frustumCulled={false}>
      <mesh ref={fillRef} geometry={fillGeometry} material={fillMaterialRef.current} frustumCulled={false} />
      <mesh ref={wireRef} geometry={wireGeometry} material={wireMaterialRef.current} frustumCulled={false} />
      <group ref={braceRef}>
        <mesh geometry={SHARED_GEOMETRIES.box} material={ringMaterialRef.current} position={[0, halfHeight, 0.018]} scale={[CHRONOS_AEGIS_WORLD_WIDTH + edgeThickness * 1.8, edgeThickness, 0.03]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={ringMaterialRef.current} position={[0, -halfHeight, 0.018]} scale={[CHRONOS_AEGIS_WORLD_WIDTH + edgeThickness * 1.8, edgeThickness, 0.03]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={ringMaterialRef.current} position={[-halfWidth, 0, 0.018]} scale={[edgeThickness, CHRONOS_AEGIS_WORLD_HEIGHT + edgeThickness * 1.8, 0.03]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={ringMaterialRef.current} position={[halfWidth, 0, 0.018]} scale={[edgeThickness, CHRONOS_AEGIS_WORLD_HEIGHT + edgeThickness * 1.8, 0.03]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={ringMaterialRef.current} position={[-halfWidth, halfHeight, 0.026]} scale={[edgeThickness * 2.1, edgeThickness * 2.1, 0.036]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={ringMaterialRef.current} position={[halfWidth, halfHeight, 0.026]} scale={[edgeThickness * 2.1, edgeThickness * 2.1, 0.036]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={ringMaterialRef.current} position={[-halfWidth, -halfHeight, 0.026]} scale={[edgeThickness * 2.1, edgeThickness * 2.1, 0.036]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={ringMaterialRef.current} position={[halfWidth, -halfHeight, 0.026]} scale={[edgeThickness * 2.1, edgeThickness * 2.1, 0.036]} frustumCulled={false} />
      </group>
      <BudgetedPointLight ref={lightRef} budgetPriority={0.2} position={[0, 0, 0.08]} color={CHRONOS_AEGIS_COLOR} intensity={0} distance={4.4} decay={2} />
    </group>
  );
}

export function ChronosAegisManager() {
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const activeKeyRef = useRef('');

  useFrame(() => {
    const nextIds = collectActiveChronosAegisIds();
    const nextKey = nextIds.join('|');
    if (nextKey === activeKeyRef.current) return;

    activeKeyRef.current = nextKey;
    setActiveIds(nextIds);
  });

  return (
    <group>
      {activeIds.map((playerId) => (
        <ChronosAegisShield key={playerId} playerId={playerId} />
      ))}
    </group>
  );
}
