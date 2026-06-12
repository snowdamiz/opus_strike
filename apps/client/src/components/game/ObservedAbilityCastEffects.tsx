import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import { visualStore } from '../../store/visualStore';
import { resolveAbilitySocketOrigin } from '../../model-system/abilitySocketResolver';
import { SHARED_GEOMETRIES } from './effectResources';
import { BudgetedPointLight } from './systems/DynamicLightBudget';

export type ObservedAbilityCastEffectKind =
  | 'phantom_void_ray_charge'
  | 'chronos_lifeline_conduit'
  | 'chronos_timebreak'
  | 'chronos_ascendant_paradox';

export interface ObservedAbilityCastEffectInput {
  id: string;
  playerId: string;
  abilityId: ObservedAbilityCastEffectKind;
  socketName?: string;
  startPosition?: { x: number; y: number; z: number };
  startTime?: number;
  endTime: number;
  color: number;
  secondaryColor: number;
  scale?: number;
}

interface ObservedAbilityCastEffectData extends Required<Omit<ObservedAbilityCastEffectInput, 'socketName' | 'startPosition' | 'scale'>> {
  socketName?: string;
  startPosition?: { x: number; y: number; z: number };
  scale: number;
}

const CAST_EFFECT_FADE_IN_MS = 120;
const CAST_EFFECT_FADE_OUT_MS = 260;
const MIN_CAST_EFFECT_DURATION_MS = 80;
const PLAYER_CAST_FALLBACK_HEIGHT = 1.12;
const activeObservedCastEffects = new Map<string, ObservedAbilityCastEffectData>();
let observedCastRevision = 0;

function nextObservedCastRevision(): void {
  observedCastRevision += 1;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function startObservedAbilityCastEffect(effect: ObservedAbilityCastEffectInput): void {
  const now = Date.now();
  const startTime = effect.startTime ?? now;
  const endTime = Math.max(startTime + MIN_CAST_EFFECT_DURATION_MS, effect.endTime);

  for (const [id, activeEffect] of activeObservedCastEffects) {
    if (
      id !== effect.id &&
      activeEffect.playerId === effect.playerId &&
      activeEffect.abilityId === effect.abilityId
    ) {
      activeObservedCastEffects.delete(id);
    }
  }

  activeObservedCastEffects.set(effect.id, {
    ...effect,
    startTime,
    endTime,
    scale: effect.scale ?? 1,
  });
  nextObservedCastRevision();
}

export function stopObservedAbilityCastEffects(playerId: string, abilityId?: ObservedAbilityCastEffectKind): void {
  const now = Date.now();
  let changed = false;

  for (const effect of activeObservedCastEffects.values()) {
    if (effect.playerId !== playerId) continue;
    if (abilityId && effect.abilityId !== abilityId) continue;
    effect.endTime = Math.min(effect.endTime, now);
    changed = true;
  }

  if (changed) {
    nextObservedCastRevision();
  }
}

function collectObservedAbilityCastEffects(now: number): {
  effects: ObservedAbilityCastEffectData[];
  revision: number;
} {
  let changed = false;
  for (const [id, effect] of activeObservedCastEffects) {
    if (now > effect.endTime + CAST_EFFECT_FADE_OUT_MS) {
      activeObservedCastEffects.delete(id);
      changed = true;
    }
  }

  if (changed) {
    nextObservedCastRevision();
  }

  return {
    effects: Array.from(activeObservedCastEffects.values()),
    revision: observedCastRevision,
  };
}

function writeObservedCastPosition(
  effect: ObservedAbilityCastEffectData,
  target: THREE.Vector3
): boolean {
  const resolvedOrigin = resolveAbilitySocketOrigin({
    ownerScope: 'remoteBody',
    playerId: effect.playerId,
    abilityId: effect.abilityId,
  });
  if (resolvedOrigin) {
    target.copy(resolvedOrigin.position);
    return true;
  }

  const visualPosition = visualStore.getState().playerPositions.get(effect.playerId);
  if (visualPosition) {
    target.set(
      visualPosition.x,
      visualPosition.y + PLAYER_CAST_FALLBACK_HEIGHT,
      visualPosition.z
    );
    return true;
  }

  const gameState = useGameStore.getState();
  const player = gameState.players.get(effect.playerId) ??
    (gameState.localPlayer?.id === effect.playerId ? gameState.localPlayer : null);
  if (player) {
    target.set(
      player.position.x,
      player.position.y + PLAYER_CAST_FALLBACK_HEIGHT,
      player.position.z
    );
    return true;
  }

  if (effect.startPosition) {
    target.set(effect.startPosition.x, effect.startPosition.y, effect.startPosition.z);
    return true;
  }

  return false;
}

function ObservedAbilityCastEffect({ effect }: { effect: ObservedAbilityCastEffectData }) {
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const outerRef = useRef<THREE.Mesh>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const ringARef = useRef<THREE.Mesh>(null);
  const ringBRef = useRef<THREE.Mesh>(null);
  const ringCRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const positionRef = useRef(new THREE.Vector3());

  const materials = useMemo(() => {
    const core = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const outer = new THREE.MeshBasicMaterial({
      color: effect.color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const shell = new THREE.MeshBasicMaterial({
      color: effect.secondaryColor,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const ring = new THREE.MeshBasicMaterial({
      color: effect.secondaryColor,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    return { core, outer, shell, ring };
  }, [effect.color, effect.secondaryColor]);

  useEffect(() => {
    return () => {
      materials.core.dispose();
      materials.outer.dispose();
      materials.shell.dispose();
      materials.ring.dispose();
    };
  }, [materials]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    if (!writeObservedCastPosition(effect, positionRef.current)) {
      group.visible = false;
      return;
    }

    const now = Date.now();
    const elapsedMs = Math.max(0, now - effect.startTime);
    const durationMs = Math.max(MIN_CAST_EFFECT_DURATION_MS, effect.endTime - effect.startTime);
    const charge = clamp01(elapsedMs / durationMs);
    const fadeIn = clamp01(elapsedMs / CAST_EFFECT_FADE_IN_MS);
    const fadeOut = now <= effect.endTime
      ? 1
      : 1 - clamp01((now - effect.endTime) / CAST_EFFECT_FADE_OUT_MS);
    const intensity = fadeIn * fadeOut;
    const pulse = 0.5 + 0.5 * Math.sin(elapsedMs * 0.021);
    const baseScale = effect.scale * (0.82 + charge * 0.32 + pulse * 0.08);

    group.visible = intensity > 0.01;
    group.position.copy(positionRef.current);
    group.scale.setScalar(baseScale);
    group.rotation.y += delta * (0.9 + charge * 1.8);
    group.rotation.z += delta * (0.35 + pulse * 0.45);

    if (coreRef.current) {
      coreRef.current.scale.setScalar(0.12 + charge * 0.16 + pulse * 0.035);
    }
    if (outerRef.current) {
      outerRef.current.scale.setScalar(0.38 + charge * 0.24 + pulse * 0.08);
    }
    if (shellRef.current) {
      shellRef.current.scale.setScalar(0.58 + charge * 0.32 + pulse * 0.08);
    }
    if (ringARef.current) {
      ringARef.current.rotation.z += delta * 1.8;
      ringARef.current.scale.setScalar(0.78 + charge * 0.48 + pulse * 0.08);
    }
    if (ringBRef.current) {
      ringBRef.current.rotation.z -= delta * 1.35;
      ringBRef.current.scale.setScalar(0.62 + charge * 0.42 + pulse * 0.06);
    }
    if (ringCRef.current) {
      ringCRef.current.rotation.z += delta * 1.1;
      ringCRef.current.scale.setScalar(0.46 + charge * 0.34 + pulse * 0.05);
    }

    materials.core.opacity = intensity * (0.52 + pulse * 0.22);
    materials.outer.opacity = intensity * (0.22 + charge * 0.18);
    materials.shell.opacity = intensity * (0.13 + charge * 0.11);
    materials.ring.opacity = intensity * (0.34 + pulse * 0.18);

    if (lightRef.current) {
      lightRef.current.intensity = intensity * (1.7 + charge * 2.6 + pulse * 0.9);
    }
  });

  return (
    <group ref={groupRef}>
      <mesh ref={outerRef} geometry={SHARED_GEOMETRIES.sphere16} material={materials.outer} />
      <mesh ref={shellRef} geometry={SHARED_GEOMETRIES.sphere12} material={materials.shell} />
      <mesh ref={coreRef} geometry={SHARED_GEOMETRIES.sphere8} material={materials.core} />
      <mesh ref={ringARef} geometry={SHARED_GEOMETRIES.ring32} material={materials.ring} />
      <mesh
        ref={ringBRef}
        geometry={SHARED_GEOMETRIES.ring24}
        material={materials.ring}
        rotation={[Math.PI / 2, 0, 0]}
      />
      <mesh
        ref={ringCRef}
        geometry={SHARED_GEOMETRIES.ring16}
        material={materials.ring}
        rotation={[0, Math.PI / 2, 0]}
      />
      <BudgetedPointLight
        ref={lightRef}
        budgetPriority={1.9}
        color={effect.color}
        intensity={0}
        distance={5.6}
        decay={2}
      />
    </group>
  );
}

export function ObservedAbilityCastEffectsManager() {
  const [effects, setEffects] = useState<ObservedAbilityCastEffectData[]>([]);
  const lastRevisionRef = useRef(-1);

  useFrame(() => {
    const snapshot = collectObservedAbilityCastEffects(Date.now());
    if (snapshot.revision === lastRevisionRef.current) return;

    lastRevisionRef.current = snapshot.revision;
    setEffects(snapshot.effects);
  });

  return (
    <group>
      {effects.map((effect) => (
        <ObservedAbilityCastEffect key={effect.id} effect={effect} />
      ))}
    </group>
  );
}
