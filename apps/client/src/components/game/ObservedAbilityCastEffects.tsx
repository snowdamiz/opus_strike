import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import { visualStore } from '../../store/visualStore';
import { resolveAbilitySocketOrigin } from '../../model-system/abilitySocketResolver';
import {
  chronosOrbForwardFromYaw,
  offsetChronosOrbVisualVector,
} from '../../model-system/chronosOrbVisualOrigin';
import { SHARED_GEOMETRIES } from './effectResources';
import { BudgetedPointLight } from './systems/DynamicLightBudget';
import { getFrameClock } from '../../utils/frameClock';
import {
  MOVEMENT_DIAGNOSTICS_ENABLED,
  measureFrameWork,
  recordEffectSlotDiagnostics,
} from '../../movement/networkDiagnostics';

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
const OBSERVED_CAST_EFFECT_CAPACITY = 18;
const OBSERVED_CAST_EFFECT_SLOT_INDICES = Array.from({ length: OBSERVED_CAST_EFFECT_CAPACITY }, (_, index) => index);
const observedCastSlots: Array<{
  effect: ObservedAbilityCastEffectData | null;
  token: number;
}> = Array.from({ length: OBSERVED_CAST_EFFECT_CAPACITY }, () => ({
  effect: null,
  token: 0,
}));
const observedCastActiveSlotIndices: number[] = [];
const observedCastActiveSlotFlags = new Uint8Array(OBSERVED_CAST_EFFECT_CAPACITY);
let observedCastTokenCounter = 0;

interface ObservedAbilityCastSlotRuntime {
  groupRef: RefObject<THREE.Group>;
  coreRef: RefObject<THREE.Mesh>;
  outerRef: RefObject<THREE.Mesh>;
  shellRef: RefObject<THREE.Mesh>;
  ringARef: RefObject<THREE.Mesh>;
  ringBRef: RefObject<THREE.Mesh>;
  ringCRef: RefObject<THREE.Mesh>;
  lightRef: RefObject<THREE.PointLight>;
  position: THREE.Vector3;
  materials: {
    core: THREE.MeshBasicMaterial;
    outer: THREE.MeshBasicMaterial;
    shell: THREE.MeshBasicMaterial;
    ring: THREE.MeshBasicMaterial;
  };
  lastSlotToken: number;
}

type RegisterObservedCastSlot = (slotIndex: number, runtime: ObservedAbilityCastSlotRuntime | null) => void;

interface RankedObservedCastSlot {
  slotIndex: number;
  score: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function markObservedCastSlotActive(slotIndex: number): void {
  if (observedCastActiveSlotFlags[slotIndex]) return;
  observedCastActiveSlotFlags[slotIndex] = 1;
  observedCastActiveSlotIndices.push(slotIndex);
}

function markObservedCastSlotInactive(slotIndex: number): void {
  observedCastActiveSlotFlags[slotIndex] = 0;
}

function compactObservedCastActiveSlotIndices(): void {
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < observedCastActiveSlotIndices.length; readIndex++) {
    const slotIndex = observedCastActiveSlotIndices[readIndex];
    if (!observedCastActiveSlotFlags[slotIndex]) continue;
    observedCastActiveSlotIndices[writeIndex++] = slotIndex;
  }
  observedCastActiveSlotIndices.length = writeIndex;
}

function clearObservedCastSlot(slotIndex: number): void {
  const slot = observedCastSlots[slotIndex];
  if (!slot.effect) return;
  slot.effect = null;
  slot.token++;
  markObservedCastSlotInactive(slotIndex);
}

function hideObservedAbilityCastEffectSlot(runtime: ObservedAbilityCastSlotRuntime): void {
  if (runtime.groupRef.current) runtime.groupRef.current.visible = false;
  if (runtime.lightRef.current) runtime.lightRef.current.intensity = 0;
}

function getObservedCastPriorityScore(effect: ObservedAbilityCastEffectData, camera: THREE.Camera): number {
  const store = useGameStore.getState();
  const player = store.players.get(effect.playerId) ??
    (store.localPlayer?.id === effect.playerId ? store.localPlayer : null);
  const localPlayerId = store.localPlayer?.id ?? store.playerId ?? null;
  const localTeam = store.localPlayer?.team ?? null;
  let priority = effect.playerId === localPlayerId ? 2_000_000 : 0;
  if (player?.team && localTeam && player.team === localTeam) priority += 500_000;

  const visualPosition = visualStore.getState().playerPositions.get(effect.playerId);
  const position = visualPosition ?? player?.position ?? effect.startPosition;
  if (!position) return priority - 1_000_000;

  const dx = camera.position.x - position.x;
  const dy = camera.position.y - position.y;
  const dz = camera.position.z - position.z;
  return priority - (dx * dx + dy * dy + dz * dz);
}

function insertRankedObservedCastSlot(
  ranked: RankedObservedCastSlot[],
  slotIndex: number,
  score: number,
  limit: number
): void {
  if (limit <= 0) return;

  let insertIndex = ranked.length;
  if (insertIndex < limit) {
    ranked.push({ slotIndex, score });
  } else {
    insertIndex = limit - 1;
    const last = ranked[insertIndex];
    if (!last || score <= last.score) return;
    last.slotIndex = slotIndex;
    last.score = score;
  }

  const entry = ranked[insertIndex];
  while (insertIndex > 0 && ranked[insertIndex - 1].score < score) {
    ranked[insertIndex] = ranked[insertIndex - 1];
    insertIndex--;
  }
  ranked[insertIndex] = entry;
}

function offsetObservedChronosCastPosition(
  effect: ObservedAbilityCastEffectData,
  target: THREE.Vector3
): void {
  const store = useGameStore.getState();
  const yaw = visualStore.getState().playerRotations.get(effect.playerId)
    ?? store.players.get(effect.playerId)?.lookYaw
    ?? (store.localPlayer?.id === effect.playerId ? store.localPlayer.lookYaw : undefined);
  if (typeof yaw !== 'number' || !Number.isFinite(yaw)) return;

  offsetChronosOrbVisualVector(target, chronosOrbForwardFromYaw(yaw), effect.abilityId);
}

export function startObservedAbilityCastEffect(effect: ObservedAbilityCastEffectInput): void {
  const now = Date.now();
  const startTime = effect.startTime ?? now;
  const endTime = Math.max(startTime + MIN_CAST_EFFECT_DURATION_MS, effect.endTime);

  for (let slotIndex = 0; slotIndex < observedCastSlots.length; slotIndex++) {
    const slot = observedCastSlots[slotIndex];
    const activeEffect = slot.effect;
    if (!activeEffect) continue;
    if (
      activeEffect.id !== effect.id &&
      activeEffect.playerId === effect.playerId &&
      activeEffect.abilityId === effect.abilityId
    ) {
      clearObservedCastSlot(slotIndex);
    }
  }

  const nextEffect: ObservedAbilityCastEffectData = {
    ...effect,
    startTime,
    endTime,
    scale: effect.scale ?? 1,
  };
  let targetSlotIndex = -1;
  let emptySlotIndex = -1;
  let oldestSlotIndex = 0;
  let oldestEnd = observedCastSlots[0].effect?.endTime ?? Number.POSITIVE_INFINITY;

  for (let slotIndex = 0; slotIndex < observedCastSlots.length; slotIndex++) {
    const slot = observedCastSlots[slotIndex];
    if (slot.effect?.id === effect.id) {
      targetSlotIndex = slotIndex;
      break;
    }
    if (!slot.effect && emptySlotIndex < 0) {
      emptySlotIndex = slotIndex;
    }
    const candidateEnd = slot.effect?.endTime ?? Number.POSITIVE_INFINITY;
    if (candidateEnd < oldestEnd) {
      oldestEnd = candidateEnd;
      oldestSlotIndex = slotIndex;
    }
  }

  if (targetSlotIndex < 0) {
    targetSlotIndex = emptySlotIndex >= 0 ? emptySlotIndex : oldestSlotIndex;
  }

  const slot = observedCastSlots[targetSlotIndex];
  slot.effect = nextEffect;
  slot.token = ++observedCastTokenCounter;
  markObservedCastSlotActive(targetSlotIndex);
}

export function stopObservedAbilityCastEffects(playerId: string, abilityId?: ObservedAbilityCastEffectKind): void {
  const now = Date.now();

  for (const slot of observedCastSlots) {
    const effect = slot.effect;
    if (!effect) continue;
    if (effect.playerId !== playerId) continue;
    if (abilityId && effect.abilityId !== abilityId) continue;
    effect.endTime = Math.min(effect.endTime, now);
  }
}

function pruneObservedAbilityCastEffects(now: number): void {
  for (const slotIndex of observedCastActiveSlotIndices) {
    const slot = observedCastSlots[slotIndex];
    const effect = slot.effect;
    if (!effect) continue;
    if (now > effect.endTime + CAST_EFFECT_FADE_OUT_MS) {
      clearObservedCastSlot(slotIndex);
    }
  }
  compactObservedCastActiveSlotIndices();
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
    offsetObservedChronosCastPosition(effect, target);
    return true;
  }

  const visualPosition = visualStore.getState().playerPositions.get(effect.playerId);
  if (visualPosition) {
    target.set(
      visualPosition.x,
      visualPosition.y + PLAYER_CAST_FALLBACK_HEIGHT,
      visualPosition.z
    );
    offsetObservedChronosCastPosition(effect, target);
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
    offsetObservedChronosCastPosition(effect, target);
    return true;
  }

  if (effect.startPosition) {
    target.set(effect.startPosition.x, effect.startPosition.y, effect.startPosition.z);
    return true;
  }

  return false;
}

function updateObservedAbilityCastEffectSlot(
  runtime: ObservedAbilityCastSlotRuntime,
  slotIndex: number,
  delta: number
): void {
  const group = runtime.groupRef.current;
  if (!group) return;

  const slot = observedCastSlots[slotIndex];
  const effect = slot.effect;
  if (!effect) {
    group.visible = false;
    if (runtime.lightRef.current) runtime.lightRef.current.intensity = 0;
    return;
  }

  const { materials } = runtime;
  if (runtime.lastSlotToken !== slot.token) {
    runtime.lastSlotToken = slot.token;
    materials.outer.color.setHex(effect.color);
    materials.shell.color.setHex(effect.secondaryColor);
    materials.ring.color.setHex(effect.secondaryColor);
    if (runtime.lightRef.current) runtime.lightRef.current.color.setHex(effect.color);
  }

  if (!writeObservedCastPosition(effect, runtime.position)) {
    group.visible = false;
    return;
  }

  const now = getFrameClock().epochNowMs;
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
  group.position.copy(runtime.position);
  group.scale.setScalar(baseScale);
  group.rotation.y += delta * (0.9 + charge * 1.8);
  group.rotation.z += delta * (0.35 + pulse * 0.45);

  if (runtime.coreRef.current) {
    runtime.coreRef.current.scale.setScalar(0.12 + charge * 0.16 + pulse * 0.035);
  }
  if (runtime.outerRef.current) {
    runtime.outerRef.current.scale.setScalar(0.38 + charge * 0.24 + pulse * 0.08);
  }
  if (runtime.shellRef.current) {
    runtime.shellRef.current.scale.setScalar(0.58 + charge * 0.32 + pulse * 0.08);
  }
  if (runtime.ringARef.current) {
    runtime.ringARef.current.rotation.z += delta * 1.8;
    runtime.ringARef.current.scale.setScalar(0.78 + charge * 0.48 + pulse * 0.08);
  }
  if (runtime.ringBRef.current) {
    runtime.ringBRef.current.rotation.z -= delta * 1.35;
    runtime.ringBRef.current.scale.setScalar(0.62 + charge * 0.42 + pulse * 0.06);
  }
  if (runtime.ringCRef.current) {
    runtime.ringCRef.current.rotation.z += delta * 1.1;
    runtime.ringCRef.current.scale.setScalar(0.46 + charge * 0.34 + pulse * 0.05);
  }

  materials.core.opacity = intensity * (0.52 + pulse * 0.22);
  materials.outer.opacity = intensity * (0.22 + charge * 0.18);
  materials.shell.opacity = intensity * (0.13 + charge * 0.11);
  materials.ring.opacity = intensity * (0.34 + pulse * 0.18);

  if (runtime.lightRef.current) {
    runtime.lightRef.current.intensity = intensity * (1.7 + charge * 2.6 + pulse * 0.9);
  }
}

function ObservedAbilityCastEffectSlot({
  slotIndex,
  registerSlot,
}: {
  slotIndex: number;
  registerSlot: RegisterObservedCastSlot;
}) {
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
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const shell = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const ring = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    return { core, outer, shell, ring };
  }, []);

  const runtime = useMemo<ObservedAbilityCastSlotRuntime>(() => ({
    groupRef,
    coreRef,
    outerRef,
    shellRef,
    ringARef,
    ringBRef,
    ringCRef,
    lightRef,
    position: positionRef.current,
    materials,
    lastSlotToken: -1,
  }), [materials]);

  useEffect(() => {
    registerSlot(slotIndex, runtime);
    return () => {
      registerSlot(slotIndex, null);
    };
  }, [registerSlot, runtime, slotIndex]);

  useEffect(() => {
    return () => {
      materials.core.dispose();
      materials.outer.dispose();
      materials.shell.dispose();
      materials.ring.dispose();
    };
  }, [materials]);

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
        color={0xffffff}
        intensity={0}
        distance={5.6}
        decay={2}
      />
    </group>
  );
}

function createObservedCastPrewarmMaterial(
  color: number,
  side: THREE.Side = THREE.FrontSide
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side,
    toneMapped: false,
  });
}

function addObservedCastPrewarmMesh(
  target: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  scale: number | [number, number, number],
  rotation: [number, number, number] = [0, 0, 0]
): void {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  if (typeof scale === 'number') {
    mesh.scale.setScalar(scale);
  } else {
    mesh.scale.set(...scale);
  }
  mesh.frustumCulled = false;
  target.add(mesh);
}

export function appendObservedCastGpuPrewarmObjects(target: THREE.Object3D): void {
  const core = createObservedCastPrewarmMaterial(0xffffff);
  const primary = createObservedCastPrewarmMaterial(0x73ffa2);
  const secondary = createObservedCastPrewarmMaterial(0xa78bfa);
  const ring = createObservedCastPrewarmMaterial(0x38bdf8, THREE.DoubleSide);

  addObservedCastPrewarmMesh(target, SHARED_GEOMETRIES.sphere8, core, [0.2, 1.48, -4.7], 0.14);
  addObservedCastPrewarmMesh(target, SHARED_GEOMETRIES.sphere16, primary, [0.45, 1.48, -4.7], 0.22);
  addObservedCastPrewarmMesh(target, SHARED_GEOMETRIES.sphere12, secondary, [0.75, 1.48, -4.7], 0.2);
  addObservedCastPrewarmMesh(target, SHARED_GEOMETRIES.ring32, ring, [1.05, 1.48, -4.7], 0.24);
  addObservedCastPrewarmMesh(target, SHARED_GEOMETRIES.ring24, ring, [1.35, 1.48, -4.7], 0.22, [Math.PI / 2, 0, 0]);
  addObservedCastPrewarmMesh(target, SHARED_GEOMETRIES.ring16, ring, [1.62, 1.48, -4.7], 0.2, [0, Math.PI / 2, 0]);
}

export function ObservedAbilityCastEffectsManager({
  maxVisibleEffects = OBSERVED_CAST_EFFECT_CAPACITY,
}: {
  maxVisibleEffects?: number;
}) {
  const camera = useThree((state) => state.camera);
  const slotRuntimesRef = useRef<Array<ObservedAbilityCastSlotRuntime | null>>(
    Array.from({ length: OBSERVED_CAST_EFFECT_CAPACITY }, () => null)
  );
  const rankedSlotsRef = useRef<RankedObservedCastSlot[]>([]);
  const visibleSlotFlagsRef = useRef(new Uint8Array(OBSERVED_CAST_EFFECT_CAPACITY));
  const registerSlot = useCallback<RegisterObservedCastSlot>((slotIndex, runtime) => {
    slotRuntimesRef.current[slotIndex] = runtime;
  }, []);

  useFrame((_, delta) => {
    measureFrameWork('frame.effects.observedCasts', () => {
      pruneObservedAbilityCastEffects(getFrameClock().epochNowMs);

      const runtimes = slotRuntimesRef.current;
      const visibleLimit = Math.max(
        0,
        Math.min(OBSERVED_CAST_EFFECT_CAPACITY, Math.floor(maxVisibleEffects))
      );
      const visibleSlotFlags = visibleSlotFlagsRef.current;
      visibleSlotFlags.fill(0);

      if (observedCastActiveSlotIndices.length <= visibleLimit) {
        for (const slotIndex of observedCastActiveSlotIndices) {
          visibleSlotFlags[slotIndex] = 1;
        }
      } else {
        const rankedSlots = rankedSlotsRef.current;
        rankedSlots.length = 0;
        for (const slotIndex of observedCastActiveSlotIndices) {
          const effect = observedCastSlots[slotIndex].effect;
          if (!effect) continue;
          insertRankedObservedCastSlot(
            rankedSlots,
            slotIndex,
            getObservedCastPriorityScore(effect, camera),
            visibleLimit
          );
        }
        for (const slot of rankedSlots) {
          visibleSlotFlags[slot.slotIndex] = 1;
        }
      }

      let visible = 0;
      for (const slotIndex of observedCastActiveSlotIndices) {
        const runtime = runtimes[slotIndex];
        if (!runtime) continue;
        if (visibleSlotFlags[slotIndex]) {
          visible++;
          updateObservedAbilityCastEffectSlot(runtime, slotIndex, delta);
        } else {
          hideObservedAbilityCastEffectSlot(runtime);
        }
      }

      const active = observedCastActiveSlotIndices.length;
      if (MOVEMENT_DIAGNOSTICS_ENABLED) {
        recordEffectSlotDiagnostics('observedAbilityCast', {
          active,
          capacity: OBSERVED_CAST_EFFECT_CAPACITY,
          hiddenMounted: OBSERVED_CAST_EFFECT_CAPACITY - visible,
        });
      }
    });
  });

  return (
    <group>
      {OBSERVED_CAST_EFFECT_SLOT_INDICES.map((slotIndex) => (
        <ObservedAbilityCastEffectSlot
          key={slotIndex}
          slotIndex={slotIndex}
          registerSlot={registerSlot}
        />
      ))}
    </group>
  );
}
