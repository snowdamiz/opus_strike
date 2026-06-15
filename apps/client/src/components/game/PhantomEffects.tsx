import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import { visualStore } from '../../store/visualStore';
import type { Player } from '@voxel-strike/shared';
import { getFrameClock } from '../../utils/frameClock';
import { SHARED_GEOMETRIES } from './effectResources';
import {
  PhantomVeil3DEffect,
  BLINK_EFFECT_DURATION,
  collectActivePhantomEffects,
  type BlinkEffectData,
} from './phantom';
import { getRiftMaterial } from './phantom/materials';
import {
  createPhantomVeilSplitMaterial,
  updatePhantomVeilSplitMaterial,
} from './phantom/veilClap';
import { PHANTOM_VEIL_CAST_POSE_DURATION_MS } from '../../viewmodel/phantomPrimaryPose';

// Re-export trigger functions for external use
export { triggerBlinkEffect } from './phantom';

// ============================================================================
// PHANTOM EFFECTS MANAGER
// Tracks and renders active phantom effects
// ============================================================================

const POOLED_BLINK_EFFECTS = 16;
const POOLED_VEIL_CLAP_EFFECTS = 12;
const BLINK_TRAIL_PARTICLE_COUNT = 50;
const BLINK_BURST_PARTICLE_COUNT = 30;
const BLINK_SLOT_INDICES = Array.from({ length: POOLED_BLINK_EFFECTS }, (_, i) => i);
const VEIL_CLAP_SLOT_INDICES = Array.from({ length: POOLED_VEIL_CLAP_EFFECTS }, (_, i) => i);
const BLINK_PILLAR_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x7c3aed,
  transparent: true,
  opacity: 0.4,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
});
const PHANTOM_VEIL_ABILITY_ID = 'phantom_veil';
const ACTIVE_VEIL_SCAN_INTERVAL_MS = 80;
const VEIL_CLAP_FORWARD_OFFSET = 0.68;
const VEIL_CLAP_HEIGHT_OFFSET = 1.18;
const VEIL_CLAP_SCALE_X = 1.45;
const VEIL_CLAP_SCALE_Y = 2.8;

interface BlinkRenderSlot {
  effectId: string;
  startFrameTime: number;
  group: THREE.Group | null;
  startGroup: THREE.Group | null;
  endGroup: THREE.Group | null;
  trail: THREE.Points | null;
  trailGeometry: THREE.BufferGeometry;
  burstGeometry: THREE.BufferGeometry;
  startRiftMaterial: THREE.ShaderMaterial;
  endRiftMaterial: THREE.ShaderMaterial;
  particleMaterial: THREE.PointsMaterial;
}

interface PhantomVeilClapEffectData {
  id: string;
  playerId: string;
  position: { x: number; y: number; z: number };
  yaw?: number;
  startFrameTime: number;
  endFrameTime: number;
}

interface PhantomVeilClapRenderSlot {
  effectId: string;
  group: THREE.Group | null;
  material: THREE.ShaderMaterial;
}

interface PhantomVeilClapEffectSlot {
  active: boolean;
  data: PhantomVeilClapEffectData;
}

const veilClapEffectSlots: PhantomVeilClapEffectSlot[] = Array.from({ length: POOLED_VEIL_CLAP_EFFECTS }, (_, index) => ({
  active: false,
  data: {
    id: `veil_clap_slot_${index}`,
    playerId: '',
    position: { x: 0, y: 0, z: 0 },
    startFrameTime: 0,
    endFrameTime: 0,
  },
}));

let nextVeilClapSlot = 0;
let veilClapEffectIdCounter = 0;

function createBlinkTrailGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BLINK_TRAIL_PARTICLE_COUNT * 3), 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(new Float32Array(BLINK_TRAIL_PARTICLE_COUNT), 1));
  geometry.setAttribute('random', new THREE.BufferAttribute(new Float32Array(BLINK_TRAIL_PARTICLE_COUNT), 1));
  return geometry;
}

function createBlinkBurstGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BLINK_BURST_PARTICLE_COUNT * 3), 3));
  geometry.setAttribute('velocity', new THREE.BufferAttribute(new Float32Array(BLINK_BURST_PARTICLE_COUNT * 3), 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(new Float32Array(BLINK_BURST_PARTICLE_COUNT), 1));
  return geometry;
}

function createBlinkRenderSlot(): BlinkRenderSlot {
  return {
    effectId: '',
    startFrameTime: 0,
    group: null,
    startGroup: null,
    endGroup: null,
    trail: null,
    trailGeometry: createBlinkTrailGeometry(),
    burstGeometry: createBlinkBurstGeometry(),
    startRiftMaterial: getRiftMaterial().clone(),
    endRiftMaterial: getRiftMaterial().clone(),
    particleMaterial: new THREE.PointsMaterial({
      color: 0xc084fc,
      size: 0.15,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  };
}

function ensureBlinkRenderSlot(renderSlots: BlinkRenderSlot[], index: number): BlinkRenderSlot {
  let slot = renderSlots[index];
  if (!slot) {
    slot = createBlinkRenderSlot();
    renderSlots[index] = slot;
  }
  return slot;
}

function createVeilClapRenderSlot(): PhantomVeilClapRenderSlot {
  return {
    effectId: '',
    group: null,
    material: createPhantomVeilSplitMaterial(),
  };
}

function ensureVeilClapRenderSlot(
  renderSlots: PhantomVeilClapRenderSlot[],
  index: number
): PhantomVeilClapRenderSlot {
  let slot = renderSlots[index];
  if (!slot) {
    slot = createVeilClapRenderSlot();
    renderSlots[index] = slot;
  }
  return slot;
}

function claimVeilClapEffectSlot(): PhantomVeilClapEffectSlot {
  for (let index = 0; index < veilClapEffectSlots.length; index++) {
    const slotIndex = (nextVeilClapSlot + index) % veilClapEffectSlots.length;
    const slot = veilClapEffectSlots[slotIndex];
    if (!slot.active) {
      nextVeilClapSlot = (slotIndex + 1) % veilClapEffectSlots.length;
      return slot;
    }
  }

  const slot = veilClapEffectSlots[nextVeilClapSlot];
  nextVeilClapSlot = (nextVeilClapSlot + 1) % veilClapEffectSlots.length;
  return slot;
}

export function triggerPhantomVeilClapEffect({
  playerId,
  position,
  yaw,
}: {
  playerId: string;
  position: { x: number; y: number; z: number };
  yaw?: number;
}): void {
  const frameNow = getFrameClock().nowMs;
  const slot = claimVeilClapEffectSlot();
  slot.active = true;
  slot.data.id = `phantom_veil_clap_${veilClapEffectIdCounter++}`;
  slot.data.playerId = playerId;
  slot.data.position.x = position.x;
  slot.data.position.y = position.y;
  slot.data.position.z = position.z;
  slot.data.yaw = yaw;
  slot.data.startFrameTime = frameNow;
  slot.data.endFrameTime = frameNow + PHANTOM_VEIL_CAST_POSE_DURATION_MS;
}

function collectActivePhantomVeilClapEffects(
  frameNow: number,
  out: PhantomVeilClapEffectData[]
): void {
  out.length = 0;

  for (const slot of veilClapEffectSlots) {
    if (!slot.active) continue;
    if (frameNow >= slot.data.endFrameTime) {
      slot.active = false;
      continue;
    }
    out.push(slot.data);
  }
}

function refillBlinkSlot(slot: BlinkRenderSlot, effect: BlinkEffectData): void {
  const trailPositions = slot.trailGeometry.attributes.position as THREE.BufferAttribute;
  const trailSizes = slot.trailGeometry.attributes.size as THREE.BufferAttribute;
  const trailRandoms = slot.trailGeometry.attributes.random as THREE.BufferAttribute;
  const trailPositionArray = trailPositions.array as Float32Array;
  const trailSizeArray = trailSizes.array as Float32Array;
  const trailRandomArray = trailRandoms.array as Float32Array;
  const dx = effect.endPosition.x - effect.startPosition.x;
  const dy = effect.endPosition.y - effect.startPosition.y;
  const dz = effect.endPosition.z - effect.startPosition.z;

  for (let i = 0; i < BLINK_TRAIL_PARTICLE_COUNT; i++) {
    const t = i / BLINK_TRAIL_PARTICLE_COUNT;
    const positionIndex = i * 3;
    trailPositionArray[positionIndex] = effect.startPosition.x + dx * t + (Math.random() - 0.5) * 0.5;
    trailPositionArray[positionIndex + 1] = effect.startPosition.y + dy * t + (Math.random() - 0.5) * 0.5;
    trailPositionArray[positionIndex + 2] = effect.startPosition.z + dz * t + (Math.random() - 0.5) * 0.5;
    trailSizeArray[i] = Math.random() * 0.15 + 0.05;
    trailRandomArray[i] = Math.random();
  }

  trailPositions.needsUpdate = true;
  trailSizes.needsUpdate = true;
  trailRandoms.needsUpdate = true;

  const burstPositions = slot.burstGeometry.attributes.position as THREE.BufferAttribute;
  const burstVelocities = slot.burstGeometry.attributes.velocity as THREE.BufferAttribute;
  const burstSizes = slot.burstGeometry.attributes.size as THREE.BufferAttribute;
  const burstPositionArray = burstPositions.array as Float32Array;
  const burstVelocityArray = burstVelocities.array as Float32Array;
  const burstSizeArray = burstSizes.array as Float32Array;

  for (let i = 0; i < BLINK_BURST_PARTICLE_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const speed = Math.random() * 3 + 2;
    const positionIndex = i * 3;
    burstPositionArray[positionIndex] = 0;
    burstPositionArray[positionIndex + 1] = 0;
    burstPositionArray[positionIndex + 2] = 0;
    burstVelocityArray[positionIndex] = Math.sin(phi) * Math.cos(theta) * speed;
    burstVelocityArray[positionIndex + 1] = Math.cos(phi) * speed;
    burstVelocityArray[positionIndex + 2] = Math.sin(phi) * Math.sin(theta) * speed;
    burstSizeArray[i] = Math.random() * 0.2 + 0.1;
  }

  burstPositions.needsUpdate = true;
  burstVelocities.needsUpdate = true;
  burstSizes.needsUpdate = true;

  slot.startGroup?.position.set(effect.startPosition.x, effect.startPosition.y, effect.startPosition.z);
  slot.startGroup?.scale.setScalar(0.01);
  slot.startGroup?.rotation.set(0, 0, 0);
  slot.endGroup?.position.set(effect.endPosition.x, effect.endPosition.y, effect.endPosition.z);
  slot.endGroup?.scale.setScalar(0.01);
  slot.endGroup?.rotation.set(0, 0, 0);
  if (slot.endGroup) slot.endGroup.visible = false;
  slot.particleMaterial.opacity = 0.8;
}

function updatePooledBlinkEffects(
  renderSlots: BlinkRenderSlot[],
  effects: BlinkEffectData[],
  frameNow: number,
  delta: number,
  elapsedSeconds: number
): void {
  for (let i = 0; i < POOLED_BLINK_EFFECTS; i++) {
    const slot = renderSlots[i];
    if (!slot) continue;

    const effect = effects[i];
    if (!effect) {
      if (slot.group) slot.group.visible = false;
      continue;
    }

    if (slot.effectId !== effect.id) {
      slot.effectId = effect.id;
      slot.startFrameTime = effect.startFrameTime;
      refillBlinkSlot(slot, effect);
    }

    if (slot.group) slot.group.visible = true;

    const elapsed = frameNow - slot.startFrameTime;
    const progress = Math.min(1, elapsed / BLINK_EFFECT_DURATION);

    if (slot.startRiftMaterial.uniforms) {
      slot.startRiftMaterial.uniforms.time.value += delta;
      slot.startRiftMaterial.uniforms.progress.value = progress;
    }
    if (slot.endRiftMaterial.uniforms) {
      slot.endRiftMaterial.uniforms.time.value += delta;
      slot.endRiftMaterial.uniforms.progress.value = progress;
    }

    if (slot.startGroup) {
      const startScale = progress < 0.3 ? progress / 0.3 : 1 - (progress - 0.3) / 0.7;
      slot.startGroup.scale.setScalar(Math.max(0.01, startScale * 2));
      slot.startGroup.rotation.z += delta * 5;
    }

    if (slot.endGroup) {
      const endProgress = Math.max(0, (progress - 0.2) / 0.8);
      const endScale = endProgress < 0.4 ? endProgress / 0.4 : 1 - (endProgress - 0.4) / 0.6;
      slot.endGroup.scale.setScalar(Math.max(0.01, endScale * 2));
      slot.endGroup.rotation.z -= delta * 5;
      slot.endGroup.visible = progress > 0.1;
    }

    if (slot.trail) {
      const positions = slot.trail.geometry.attributes.position as THREE.BufferAttribute;
      const randoms = slot.trail.geometry.attributes.random as THREE.BufferAttribute;
      const positionArray = positions.array as Float32Array;
      const randomArray = randoms.array as Float32Array;

      for (let particleIndex = 0; particleIndex < positions.count; particleIndex++) {
        const positionIndex = particleIndex * 3 + 1;
        positionArray[positionIndex] += Math.sin(elapsedSeconds * 5 + randomArray[particleIndex] * 10) * 0.01;
      }

      positions.needsUpdate = true;
      slot.particleMaterial.opacity = (1 - progress) * 0.8;
    }
  }
}

function writeVeilClapWorldTransform(
  effect: PhantomVeilClapEffectData,
  group: THREE.Group
): void {
  const store = useGameStore.getState();
  const visualState = visualStore.getState();
  const player = store.players.get(effect.playerId) ??
    (store.localPlayer?.id === effect.playerId ? store.localPlayer : null);
  const visualPosition = visualState.playerPositions.get(effect.playerId);
  const position = visualPosition ?? player?.position ?? effect.position;
  const yaw = visualState.playerRotations.get(effect.playerId) ?? player?.lookYaw ?? effect.yaw ?? 0;
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);

  group.position.set(
    position.x + forwardX * VEIL_CLAP_FORWARD_OFFSET,
    position.y + VEIL_CLAP_HEIGHT_OFFSET,
    position.z + forwardZ * VEIL_CLAP_FORWARD_OFFSET
  );
  group.rotation.set(0, yaw + Math.PI, 0);
}

function updatePooledVeilClapEffects(
  renderSlots: PhantomVeilClapRenderSlot[],
  effects: PhantomVeilClapEffectData[],
  frameNow: number,
  delta: number
): void {
  for (let index = 0; index < POOLED_VEIL_CLAP_EFFECTS; index++) {
    const slot = renderSlots[index];
    if (!slot) continue;

    const effect = effects[index];
    const group = slot.group;
    if (!effect || !group) {
      if (group) group.visible = false;
      continue;
    }

    if (slot.effectId !== effect.id) {
      slot.effectId = effect.id;
    }

    const duration = Math.max(1, effect.endFrameTime - effect.startFrameTime);
    const progress = THREE.MathUtils.clamp((frameNow - effect.startFrameTime) / duration, 0, 1);
    const fadeIn = THREE.MathUtils.smoothstep(progress, 0, 0.1);
    const fadeOut = 1 - THREE.MathUtils.smoothstep(progress, 0.66, 1);
    const intensity = fadeIn * fadeOut;
    const splitProgress = THREE.MathUtils.smoothstep(progress, 0, 0.74);

    group.visible = intensity > 0.01;
    if (!group.visible) {
      updatePhantomVeilSplitMaterial(slot.material, 0, 0, 0, delta);
      continue;
    }

    writeVeilClapWorldTransform(effect, group);
    group.scale.set(
      VEIL_CLAP_SCALE_X * (0.74 + splitProgress * 0.26),
      VEIL_CLAP_SCALE_Y * (0.8 + splitProgress * 0.2),
      1
    );
    updatePhantomVeilSplitMaterial(slot.material, splitProgress, intensity, fadeIn, delta);
  }
}

function PooledBlinkTeleportSlots({ renderSlots }: { renderSlots: BlinkRenderSlot[] }) {
  useEffect(() => () => {
    for (const slot of renderSlots) {
      slot.trailGeometry.dispose();
      slot.burstGeometry.dispose();
      slot.startRiftMaterial.dispose();
      slot.endRiftMaterial.dispose();
      slot.particleMaterial.dispose();
    }
  }, [renderSlots]);

  return (
    <>
      {BLINK_SLOT_INDICES.map((slotIndex) => {
        const slot = ensureBlinkRenderSlot(renderSlots, slotIndex);
        return (
          <group key={slotIndex} ref={el => { slot.group = el; }} visible={false}>
            <group ref={el => { slot.startGroup = el; }}>
              <mesh rotation-x={-Math.PI / 2} geometry={SHARED_GEOMETRIES.circle32} scale={[1.5, 1.5, 1]}>
                <primitive object={slot.startRiftMaterial} />
              </mesh>
              <mesh geometry={SHARED_GEOMETRIES.cylinderOpen16} scale={[0.4, 3, 0.4]} material={BLINK_PILLAR_MATERIAL} />
            </group>

            <group ref={el => { slot.endGroup = el; }}>
              <mesh rotation-x={-Math.PI / 2} geometry={SHARED_GEOMETRIES.circle32} scale={[1.5, 1.5, 1]}>
                <primitive object={slot.endRiftMaterial} />
              </mesh>
              <points geometry={slot.burstGeometry}>
                <primitive object={slot.particleMaterial} />
              </points>
            </group>

            <points ref={el => { slot.trail = el; }} geometry={slot.trailGeometry}>
              <primitive object={slot.particleMaterial} />
            </points>
          </group>
        );
      })}
    </>
  );
}

function PooledVeilClapSlots({ renderSlots }: { renderSlots: PhantomVeilClapRenderSlot[] }) {
  useEffect(() => () => {
    for (const slot of renderSlots) {
      slot.material.dispose();
    }
  }, [renderSlots]);

  return (
    <>
      {VEIL_CLAP_SLOT_INDICES.map((slotIndex) => {
        const slot = ensureVeilClapRenderSlot(renderSlots, slotIndex);
        return (
          <group key={slotIndex} ref={el => { slot.group = el; }} visible={false} renderOrder={18}>
            <mesh geometry={SHARED_GEOMETRIES.plane} material={slot.material} frustumCulled={false} />
          </group>
        );
      })}
    </>
  );
}

function hasActivePhantomVeil(
  player: Player | null | undefined,
  _now: number
): boolean {
  if (!player || player.state !== 'alive' || player.heroId !== 'phantom') return false;
  const veil = player.abilities?.[PHANTOM_VEIL_ABILITY_ID];
  return veil?.isActive === true;
}

function collectActivePhantomVeilIds(target: string[], now: number): string[] {
  const store = useGameStore.getState();
  const activeIds = visualStore.getState().activePhantomVeilPlayerIds;
  const localPlayerId = store.localPlayer?.id ?? null;
  target.length = 0;

  for (let index = 0; index < activeIds.length; index++) {
    const playerId = activeIds[index];
    if (playerId === localPlayerId) continue;
    const player = store.players.get(playerId);
    if (hasActivePhantomVeil(player, now)) {
      target.push(playerId);
    }
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

function getPhantomVeilPlayerPosition(playerId: string): { x: number; y: number; z: number } | undefined {
  const store = useGameStore.getState();
  if (store.localPlayer?.id === playerId) return store.localPlayer.position;
  return store.players.get(playerId)?.position;
}

export function PhantomEffectsManager() {
  const localPlayerId = useGameStore((state) => state.localPlayer?.id ?? null);
  const isObserverMode = useGameStore((state) => state.isObserverMode);

  // Use refs for effect arrays to avoid setState in useFrame (prevents 60fps re-renders)
  const activeBlinkEffectsRef = useRef<BlinkEffectData[]>([]);
  const activeVeilClapEffectsRef = useRef<PhantomVeilClapEffectData[]>([]);
  const blinkRenderSlotsRef = useRef<BlinkRenderSlot[]>([]);
  const veilClapRenderSlotsRef = useRef<PhantomVeilClapRenderSlot[]>([]);

  const [activeVeilIds, setActiveVeilIds] = useState<string[]>([]);
  const activeVeilIdsRef = useRef<string[]>([]);
  const scratchVeilIdsRef = useRef<string[]>([]);
  const veilScanAccumulatorRef = useRef(ACTIVE_VEIL_SCAN_INTERVAL_MS);

  const runPhantomEffectsFrame = (delta: number): void => {
    const frameClock = getFrameClock();
    collectActivePhantomEffects(
      frameClock.nowMs,
      activeBlinkEffectsRef.current
    );
    collectActivePhantomVeilClapEffects(
      frameClock.nowMs,
      activeVeilClapEffectsRef.current
    );
    updatePooledBlinkEffects(
      blinkRenderSlotsRef.current,
      activeBlinkEffectsRef.current,
      frameClock.nowMs,
      delta,
      frameClock.elapsedSeconds
    );
    updatePooledVeilClapEffects(
      veilClapRenderSlotsRef.current,
      activeVeilClapEffectsRef.current,
      frameClock.nowMs,
      delta
    );

    veilScanAccumulatorRef.current += delta * 1000;
    if (veilScanAccumulatorRef.current >= ACTIVE_VEIL_SCAN_INTERVAL_MS) {
      veilScanAccumulatorRef.current = 0;
      const nextVeilIds = collectActivePhantomVeilIds(scratchVeilIdsRef.current, frameClock.epochNowMs);
      if (!sameIds(nextVeilIds, activeVeilIdsRef.current)) {
        const committedIds = nextVeilIds.slice();
        activeVeilIdsRef.current = committedIds;
        setActiveVeilIds(committedIds);
      }
    }
  };

  useFrame((_, delta) => {
    runPhantomEffectsFrame(delta);
  });
  
  return (
    <group>
      {/* Blink teleport effects */}
      <PooledBlinkTeleportSlots renderSlots={blinkRenderSlotsRef.current} />

      {/* World-space Phantom Veil clap split visible to other players */}
      <PooledVeilClapSlots renderSlots={veilClapRenderSlotsRef.current} />

      {/* Phantom Veil 3D effects */}
      {activeVeilIds.map(playerId => (
        <PhantomVeil3DEffect
          key={playerId}
          isActive={true}
          playerId={playerId}
          playerPosition={getPhantomVeilPlayerPosition(playerId)}
          renderParticles={!isObserverMode && playerId !== localPlayerId}
        />
      ))}
    </group>
  );
}
