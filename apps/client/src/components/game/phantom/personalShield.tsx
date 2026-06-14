import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ABILITY_DEFINITIONS, type Player } from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { visualStore } from '../../../store/visualStore';
import { playSharedLoop, playSharedSound, setSharedLoopPosition, stopSharedLoop } from '../../../hooks/useAudio';
import { resolveAbilitySocketOrigin } from '../../../model-system/abilitySocketResolver';
import { PHANTOM_COLORS, SHARED_GEOMETRIES } from '../effectResources';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { getFrameClock } from '../../../utils/frameClock';
import {
  PHANTOM_SHIELD_CAST_POSE_DURATION_MS,
  triggerPhantomShieldCastPose,
} from '../../../viewmodel/phantomPrimaryPose';

const PHANTOM_PERSONAL_SHIELD_ABILITY_ID = 'phantom_personal_shield';
const PHANTOM_SHIELD_LOOP_ID_PREFIX = 'phantom-shield';
const PHANTOM_SHIELD_CAST_DURATION_MS = PHANTOM_SHIELD_CAST_POSE_DURATION_MS;
const PHANTOM_SHIELD_CAST_FADE_OUT_MS = 160;
const PHANTOM_SHIELD_CAST_FADE_START_PROGRESS = 0.46;
const PHANTOM_SHIELD_CAST_SIDES = [-1, 1] as const;
const MAX_SHIELD_CAST_EFFECTS = 14;
const SHIELD_CAST_RAY_COUNT = 18;
const SHIELD_CAST_PALM_SPARK_COUNT = 8;
const SHIELD_RADIUS = 1.58;
const SHIELD_CENTER_Y_OFFSET = 0;
const SHIELD_FADE_IN_SECONDS = 0.18;
const SHIELD_FADE_OUT_SECONDS = 0.45;
const SHIELD_AUDIO_FADE_IN_MS = 90;
const SHIELD_AUDIO_FADE_OUT_MS = 180;
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
const SHIELD_CAST_RAY_AXIS = new THREE.Vector3(0, 1, 0);

type ShieldCastSide = typeof PHANTOM_SHIELD_CAST_SIDES[number];

interface ShieldCastEffectData {
  id: string;
  playerId: string;
  isLocalPlayer: boolean;
  startTime: number;
  startFrameTime: number;
  fallbackPosition?: { x: number; y: number; z: number };
  fallbackYaw?: number;
}

interface EffectSlot<T> {
  active: boolean;
  endFrameTime: number;
  data: T;
}

interface TriggerPhantomShieldCastEffectOptions {
  playerId: string;
  isLocalPlayer?: boolean;
  position?: { x: number; y: number; z: number };
  yaw?: number;
  playAudio?: boolean;
}

interface ShieldCastRay {
  direction: THREE.Vector3;
  quaternion: THREE.Quaternion;
  spin: number;
  delay: number;
  length: number;
  width: number;
}

interface ShieldCastPalmSpark {
  angle: number;
  height: number;
  radiusScale: number;
  speed: number;
  delay: number;
  length: number;
  width: number;
}

const shieldCastEffectSlots: EffectSlot<ShieldCastEffectData>[] = Array.from({ length: MAX_SHIELD_CAST_EFFECTS }, (_, index) => ({
  active: false,
  endFrameTime: 0,
  data: {
    id: `phantom_shield_cast_slot_${index}`,
    playerId: '',
    isLocalPlayer: false,
    startTime: 0,
    startFrameTime: 0,
  },
}));

let shieldCastEffectCounter = 0;
let nextShieldCastEffectSlot = 0;
let shieldCastEffectRevision = 0;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function claimShieldCastEffectSlot(): EffectSlot<ShieldCastEffectData> {
  for (let i = 0; i < shieldCastEffectSlots.length; i++) {
    const index = (nextShieldCastEffectSlot + i) % shieldCastEffectSlots.length;
    const slot = shieldCastEffectSlots[index];
    if (!slot.active) {
      nextShieldCastEffectSlot = (index + 1) % shieldCastEffectSlots.length;
      return slot;
    }
  }

  const slot = shieldCastEffectSlots[nextShieldCastEffectSlot];
  nextShieldCastEffectSlot = (nextShieldCastEffectSlot + 1) % shieldCastEffectSlots.length;
  return slot;
}

function getShieldCastAudioPosition(options: TriggerPhantomShieldCastEffectOptions): { x: number; y: number; z: number } | undefined {
  if (options.isLocalPlayer) return undefined;
  if (options.position) {
    return {
      x: options.position.x,
      y: options.position.y + 1.1,
      z: options.position.z,
    };
  }

  const player = getShieldPlayer(options.playerId);
  return player ? getShieldPlayerPosition(options.playerId, player) : undefined;
}

export function triggerPhantomShieldCastEffect(options: TriggerPhantomShieldCastEffectOptions): void {
  const now = Date.now();
  const frameNow = getFrameClock().nowMs;
  const slot = claimShieldCastEffectSlot();

  if (options.isLocalPlayer) {
    triggerPhantomShieldCastPose(now);
  }

  slot.active = true;
  slot.endFrameTime = frameNow + PHANTOM_SHIELD_CAST_DURATION_MS;
  slot.data.id = `phantom_shield_cast_${shieldCastEffectCounter++}`;
  slot.data.playerId = options.playerId;
  slot.data.isLocalPlayer = Boolean(options.isLocalPlayer);
  slot.data.startTime = now;
  slot.data.startFrameTime = frameNow;
  slot.data.fallbackPosition = options.position ? { ...options.position } : undefined;
  slot.data.fallbackYaw = options.yaw;
  shieldCastEffectRevision++;

  if (options.playAudio !== false) {
    void playSharedSound('phantomShieldCast', {
      position: getShieldCastAudioPosition(options),
      durationMs: PHANTOM_SHIELD_CAST_DURATION_MS,
      fadeOutMs: PHANTOM_SHIELD_CAST_FADE_OUT_MS,
    });
  }
}

function collectActiveShieldCastEffects(frameNow: number, target: ShieldCastEffectData[]): number {
  target.length = 0;

  for (const slot of shieldCastEffectSlots) {
    if (!slot.active) continue;
    if (frameNow >= slot.endFrameTime) {
      slot.active = false;
      shieldCastEffectRevision++;
      continue;
    }
    target.push(slot.data);
  }

  return shieldCastEffectRevision;
}

function getShieldDurationMs(): number {
  return (ABILITY_DEFINITIONS[PHANTOM_PERSONAL_SHIELD_ABILITY_ID]?.duration ?? 0) * 1000;
}

function hasActivePersonalShield(player: Player | null | undefined, now: number): boolean {
  if (!player || player.state !== 'alive' || player.heroId !== 'phantom') return false;
  const shield = player.abilities?.[PHANTOM_PERSONAL_SHIELD_ABILITY_ID];
  if (!shield?.isActive) return false;

  const durationMs = getShieldDurationMs();
  if (durationMs <= 0) return true;

  const activatedAt = shield.activatedAt ?? now;
  return now < activatedAt || now - activatedAt < durationMs;
}

function getShieldAbilityStart(player: Player, now: number): number {
  return player.abilities?.[PHANTOM_PERSONAL_SHIELD_ABILITY_ID]?.activatedAt ?? now;
}

function getShieldAudioLoopId(playerId: string): string {
  return `${PHANTOM_SHIELD_LOOP_ID_PREFIX}:${playerId}`;
}

function getShieldPlayerPosition(playerId: string, player: Player): { x: number; y: number; z: number } {
  const visualPosition = visualStore.getState().playerPositions.get(playerId) ?? player.position;
  return {
    x: visualPosition.x,
    y: visualPosition.y + SHIELD_CENTER_Y_OFFSET,
    z: visualPosition.z,
  };
}

function startShieldAudioLoop(playerId: string, player: Player): void {
  void playSharedLoop(getShieldAudioLoopId(playerId), 'phantomShield', {
    position: getShieldPlayerPosition(playerId, player),
    fadeInMs: SHIELD_AUDIO_FADE_IN_MS,
  });
}

function stopShieldAudioLoop(playerId: string, fadeOutMs = SHIELD_AUDIO_FADE_OUT_MS): void {
  stopSharedLoop(getShieldAudioLoopId(playerId), fadeOutMs);
}

function collectActiveShieldIds(target: string[], now: number): string[] {
  const store = useGameStore.getState();
  const localPlayerId = store.localPlayer?.id ?? null;
  target.length = 0;

  const addPlayer = (player: Player | null | undefined) => {
    if (!hasActivePersonalShield(player, now) || !player) return;
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

function syncShieldAudioLoopPositions(activeAudioIds: Set<string>, now: number): void {
  for (const playerId of Array.from(activeAudioIds)) {
    const player = getShieldPlayer(playerId);
    if (!player || !hasActivePersonalShield(player, now)) {
      activeAudioIds.delete(playerId);
      stopShieldAudioLoop(playerId);
      continue;
    }

    setSharedLoopPosition(getShieldAudioLoopId(playerId), getShieldPlayerPosition(playerId, player));
  }
}

function syncShieldAudioLoops(activeAudioIds: Set<string>, activeShieldIds: readonly string[]): void {
  const activeShieldIdSet = new Set(activeShieldIds);
  for (const playerId of Array.from(activeAudioIds)) {
    if (activeShieldIdSet.has(playerId)) continue;

    activeAudioIds.delete(playerId);
    stopShieldAudioLoop(playerId);
  }

  for (const playerId of activeShieldIds) {
    if (activeAudioIds.has(playerId)) continue;

    const player = getShieldPlayer(playerId);
    if (!player) continue;

    activeAudioIds.add(playerId);
    startShieldAudioLoop(playerId, player);
  }
}

function writeShieldCastHandPosition(
  effect: ShieldCastEffectData,
  side: ShieldCastSide,
  target: THREE.Vector3
): boolean {
  const resolvedOrigin = resolveAbilitySocketOrigin({
    ownerScope: effect.isLocalPlayer ? 'localViewmodel' : 'remoteBody',
    playerId: effect.isLocalPlayer ? undefined : effect.playerId,
    abilityId: PHANTOM_PERSONAL_SHIELD_ABILITY_ID,
    side,
    fallback: effect.fallbackPosition
      ? {
        position: effect.fallbackPosition,
        yaw: effect.fallbackYaw ?? 0,
      }
      : undefined,
  });
  if (resolvedOrigin) {
    target.copy(resolvedOrigin.position);
    return true;
  }

  const player = getShieldPlayer(effect.playerId);
  if (!player) return false;

  const visualPosition = visualStore.getState().playerPositions.get(effect.playerId) ?? player.position;
  const yaw = effect.fallbackYaw ?? visualStore.getState().playerRotations.get(effect.playerId) ?? player.lookYaw ?? 0;
  const sideX = Math.cos(yaw) * side * 0.34;
  const sideZ = -Math.sin(yaw) * side * 0.34;
  target.set(
    visualPosition.x + sideX,
    visualPosition.y + 1.08,
    visualPosition.z + sideZ
  );
  return true;
}

function createShieldCastMaterial(color: number): THREE.MeshBasicMaterial {
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

function createShieldCastRays(side: ShieldCastSide, effectId: string): ShieldCastRay[] {
  const rays: ShieldCastRay[] = [];
  const sidePhase = side === 1 ? 0.42 : 1.17;
  const idPhase = (effectId.length % 11) * 0.13;

  for (let index = 0; index < SHIELD_CAST_RAY_COUNT; index++) {
    const y = 1 - (index / Math.max(1, SHIELD_CAST_RAY_COUNT - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = index * 2.399963229728653 + sidePhase + idPhase;
    const direction = new THREE.Vector3(
      Math.cos(theta) * radius,
      y,
      Math.sin(theta) * radius
    ).normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(SHIELD_CAST_RAY_AXIS, direction);

    rays.push({
      direction,
      quaternion,
      spin: (index % 2 === 0 ? 1 : -1) * (0.7 + (index % 5) * 0.13),
      delay: (index % 6) * 0.035,
      length: 0.36 + (index % 4) * 0.055,
      width: 0.018 + (index % 3) * 0.004,
    });
  }

  return rays;
}

function createShieldCastPalmSparks(side: ShieldCastSide, effectId: string): ShieldCastPalmSpark[] {
  const sparks: ShieldCastPalmSpark[] = [];
  const sidePhase = side === 1 ? 0.18 : 0.79;
  const idPhase = (effectId.length % 13) * 0.11;

  for (let index = 0; index < SHIELD_CAST_PALM_SPARK_COUNT; index++) {
    sparks.push({
      angle: index * ((Math.PI * 2) / SHIELD_CAST_PALM_SPARK_COUNT) + sidePhase + idPhase,
      height: 0.018 + (index % 3) * 0.012,
      radiusScale: 0.82 + (index % 4) * 0.08,
      speed: (index % 2 === 0 ? 1 : -1) * (0.78 + (index % 5) * 0.08),
      delay: (index % 4) * 0.045,
      length: 0.075 + (index % 3) * 0.012,
      width: 0.011 + (index % 2) * 0.003,
    });
  }

  return sparks;
}

function PhantomShieldCastHandBurst({
  effect,
  side,
}: {
  effect: ShieldCastEffectData;
  side: ShieldCastSide;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const innerGlowRef = useRef<THREE.Mesh>(null);
  const outerGlowRef = useRef<THREE.Mesh>(null);
  const ringARef = useRef<THREE.Mesh>(null);
  const ringBRef = useRef<THREE.Mesh>(null);
  const ringCRef = useRef<THREE.Mesh>(null);
  const rayRefs = useRef<(THREE.Mesh | null)[]>([]);
  const sparkRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  const positionRef = useRef(new THREE.Vector3());
  const sparkDirectionRef = useRef(new THREE.Vector3());
  const rays = useMemo(() => createShieldCastRays(side, effect.id), [effect.id, side]);
  const sparks = useMemo(() => createShieldCastPalmSparks(side, effect.id), [effect.id, side]);
  const materials = useMemo(() => ({
    core: createShieldCastMaterial(PHANTOM_COLORS.white),
    innerGlow: createShieldCastMaterial(PHANTOM_COLORS.lightPurple),
    outerGlow: createShieldCastMaterial(PHANTOM_COLORS.violet),
    ring: createShieldCastMaterial(PHANTOM_COLORS.cyan),
    ray: createShieldCastMaterial(PHANTOM_COLORS.violet),
    spark: createShieldCastMaterial(PHANTOM_COLORS.cyan),
  }), []);

  useEffect(() => () => {
    materials.core.dispose();
    materials.innerGlow.dispose();
    materials.outerGlow.dispose();
    materials.ring.dispose();
    materials.ray.dispose();
    materials.spark.dispose();
  }, [materials]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    if (!writeShieldCastHandPosition(effect, side, positionRef.current)) {
      group.visible = false;
      return;
    }

    const frameNow = getFrameClock().nowMs;
    const elapsedMs = Math.max(0, frameNow - effect.startFrameTime);
    const progress = clamp01(elapsedMs / PHANTOM_SHIELD_CAST_DURATION_MS);
    const charge = THREE.MathUtils.smoothstep(progress, 0, 0.52);
    const release = THREE.MathUtils.smoothstep(progress, 0.42, 1);
    const fade = 1 - THREE.MathUtils.smoothstep(progress, PHANTOM_SHIELD_CAST_FADE_START_PROGRESS, 1);
    const pulse = 0.5 + Math.sin(elapsedMs * 0.028) * 0.5;
    const intensity = Math.max(0, fade);
    const burst = Math.sin(release * Math.PI);

    group.visible = intensity > 0.01;
    group.position.copy(positionRef.current);
    group.rotation.y += delta * (1.2 + release * 2.2);
    group.rotation.z += delta * side * (0.8 + pulse * 0.6);

    if (coreRef.current) {
      coreRef.current.scale.setScalar(0.05 + charge * 0.12 + release * 0.055 + pulse * 0.012);
    }
    if (innerGlowRef.current) {
      const innerGlow = 0.1 + charge * 0.17 + burst * 0.045 + pulse * 0.012;
      innerGlowRef.current.scale.set(
        innerGlow * 1.12,
        innerGlow * 0.78,
        innerGlow * 1.12
      );
    }
    if (outerGlowRef.current) {
      const outerGlow = 0.16 + charge * 0.22 + burst * 0.055;
      outerGlowRef.current.scale.set(
        Math.min(0.48, outerGlow * (1.16 + pulse * 0.08)),
        Math.min(0.34, outerGlow * (0.7 + release * 0.08)),
        Math.min(0.48, outerGlow * (1.08 + (1 - pulse) * 0.08))
      );
    }
    if (ringARef.current) {
      ringARef.current.scale.setScalar(0.18 + release * 0.58);
      ringARef.current.rotation.z += delta * 2.8;
    }
    if (ringBRef.current) {
      ringBRef.current.scale.setScalar(0.14 + release * 0.46);
      ringBRef.current.rotation.z -= delta * 2.1;
    }
    if (ringCRef.current) {
      ringCRef.current.scale.setScalar(0.1 + release * 0.34);
      ringCRef.current.rotation.z += delta * 1.7;
    }

    materials.core.opacity = intensity * (0.34 + charge * 0.42 + pulse * 0.18);
    materials.innerGlow.opacity = intensity * (0.2 + charge * 0.24 + burst * 0.12);
    materials.outerGlow.opacity = intensity * (0.1 + charge * 0.14 + burst * 0.08);
    materials.ring.opacity = intensity * release * (0.36 + pulse * 0.18);
    materials.ray.opacity = intensity * release * (0.42 + burst * 0.2);
    materials.spark.opacity = intensity * (0.18 + charge * 0.28 + burst * 0.18);

    for (let index = 0; index < sparks.length; index++) {
      const spark = sparks[index];
      const mesh = sparkRefs.current[index];
      if (!spark || !mesh) continue;

      const sparkProgress = clamp01((charge + release * 0.72 - spark.delay) / Math.max(0.001, 1 - spark.delay));
      mesh.visible = sparkProgress > 0.01;

      const angle = spark.angle + elapsedMs * 0.006 * spark.speed + release * side * 1.35;
      const orbitRadius = (0.075 + charge * 0.085 + release * 0.035) * spark.radiusScale;
      mesh.position.set(
        Math.cos(angle) * orbitRadius,
        Math.sin(angle * 1.7 + elapsedMs * 0.004) * spark.height,
        Math.sin(angle) * orbitRadius
      );

      const sparkDirection = sparkDirectionRef.current;
      sparkDirection.copy(mesh.position);
      if (sparkDirection.lengthSq() < 0.0001) {
        sparkDirection.set(0, 1, 0);
      } else {
        sparkDirection.normalize();
      }

      mesh.quaternion.setFromUnitVectors(SHIELD_CAST_RAY_AXIS, sparkDirection);
      mesh.rotateY(elapsedMs * 0.014 + index);
      mesh.scale.set(
        spark.width * (0.8 + sparkProgress * 0.45),
        spark.length * (0.62 + sparkProgress * 0.7),
        spark.width * (0.8 + sparkProgress * 0.45)
      );
    }

    for (let index = 0; index < rays.length; index++) {
      const ray = rays[index];
      const mesh = rayRefs.current[index];
      if (!ray || !mesh) continue;

      const rayProgress = clamp01((release - ray.delay) / Math.max(0.001, 1 - ray.delay));
      mesh.visible = rayProgress > 0.01;
      mesh.quaternion.copy(ray.quaternion);
      mesh.rotateY(ray.spin * progress);
      mesh.position.copy(ray.direction).multiplyScalar(0.075 + rayProgress * (0.34 + burst * 0.18));
      mesh.scale.set(
        ray.width * (1 - rayProgress * 0.32),
        ray.length * (0.12 + rayProgress * 0.82),
        ray.width * (1 - rayProgress * 0.32)
      );
    }

    if (lightRef.current) {
      lightRef.current.intensity = intensity * (0.55 + charge * 1.25 + burst * 1.6);
      lightRef.current.distance = 3.2 + release * 1.1;
    }
  });

  return (
    <group ref={groupRef} visible={false} frustumCulled={false}>
      <mesh ref={outerGlowRef} geometry={SHARED_GEOMETRIES.sphere16} material={materials.outerGlow} frustumCulled={false} />
      <mesh ref={innerGlowRef} geometry={SHARED_GEOMETRIES.sphere12} material={materials.innerGlow} frustumCulled={false} />
      <mesh ref={coreRef} geometry={SHARED_GEOMETRIES.sphere8} material={materials.core} frustumCulled={false} />
      <mesh ref={ringARef} geometry={SHARED_GEOMETRIES.ring32} material={materials.ring} frustumCulled={false} />
      <mesh ref={ringBRef} geometry={SHARED_GEOMETRIES.ring24} material={materials.ring} rotation={[Math.PI / 2, 0, 0]} frustumCulled={false} />
      <mesh ref={ringCRef} geometry={SHARED_GEOMETRIES.ring16} material={materials.ring} rotation={[0, Math.PI / 2, 0]} frustumCulled={false} />
      {sparks.map((_, index) => (
        <mesh
          key={`spark-${index}`}
          ref={(node) => {
            sparkRefs.current[index] = node;
          }}
          geometry={SHARED_GEOMETRIES.cone6}
          material={materials.spark}
          visible={false}
          frustumCulled={false}
        />
      ))}
      {rays.map((_, index) => (
        <mesh
          key={`ray-${index}`}
          ref={(node) => {
            rayRefs.current[index] = node;
          }}
          geometry={SHARED_GEOMETRIES.cone6}
          material={materials.ray}
          visible={false}
          frustumCulled={false}
        />
      ))}
      <BudgetedPointLight ref={lightRef} budgetPriority={0.82} color={PHANTOM_COLORS.lightPurple} intensity={0} distance={3.2} decay={2} />
    </group>
  );
}

function PhantomShieldCastEffect({ effect }: { effect: ShieldCastEffectData }) {
  return (
    <>
      {PHANTOM_SHIELD_CAST_SIDES.map((side) => (
        <PhantomShieldCastHandBurst key={side} effect={effect} side={side} />
      ))}
    </>
  );
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
    if (!group || !player || !hasActivePersonalShield(player, now)) {
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
  const [activeCastEffects, setActiveCastEffects] = useState<ShieldCastEffectData[]>([]);
  const activeIdsRef = useRef<string[]>([]);
  const scratchIdsRef = useRef<string[]>([]);
  const scratchCastEffectsRef = useRef<ShieldCastEffectData[]>([]);
  const lastCastEffectRevisionRef = useRef(-1);
  const scanAccumulatorRef = useRef(ACTIVE_ID_SCAN_INTERVAL_MS);
  const activeAudioIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => () => {
    for (const playerId of activeAudioIdsRef.current) {
      stopShieldAudioLoop(playerId, 0);
    }
    activeAudioIdsRef.current.clear();
  }, []);

  useFrame((_, delta) => {
    const frameClock = getFrameClock();
    const now = frameClock.epochNowMs;
    const castRevision = collectActiveShieldCastEffects(frameClock.nowMs, scratchCastEffectsRef.current);
    if (castRevision !== lastCastEffectRevisionRef.current) {
      lastCastEffectRevisionRef.current = castRevision;
      setActiveCastEffects(scratchCastEffectsRef.current.slice());
    }

    syncShieldAudioLoopPositions(activeAudioIdsRef.current, now);

    scanAccumulatorRef.current += delta * 1000;
    if (scanAccumulatorRef.current < ACTIVE_ID_SCAN_INTERVAL_MS) return;
    scanAccumulatorRef.current = 0;

    const nextIds = collectActiveShieldIds(scratchIdsRef.current, now);
    syncShieldAudioLoops(activeAudioIdsRef.current, nextIds);
    if (sameIds(nextIds, activeIdsRef.current)) return;

    const committedIds = nextIds.slice();
    activeIdsRef.current = committedIds;
    setActiveIds(committedIds);
  });

  return (
    <group>
      {activeCastEffects.map((effect) => (
        <PhantomShieldCastEffect key={effect.id} effect={effect} />
      ))}
      {activeIds.map((playerId) => (
        <PhantomPersonalShieldBubble key={playerId} playerId={playerId} />
      ))}
    </group>
  );
}
