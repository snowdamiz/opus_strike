import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import type { Player } from '@voxel-strike/shared';
import { getFrameClock } from '../../utils/frameClock';
import { SHARED_GEOMETRIES } from './effectResources';
import {
  ShadowStepArrivalEffect,
  PhantomVeil3DEffect,
  BLINK_EFFECT_DURATION,
  collectActivePhantomEffects,
  type BlinkEffectData,
  type ShadowArrivalData,
} from './phantom';
import { getRiftMaterial } from './phantom/materials';

// Re-export trigger functions for external use
export { triggerBlinkEffect, triggerShadowArrival } from './phantom';

// ============================================================================
// PHANTOM EFFECTS MANAGER
// Tracks and renders active phantom effects
// ============================================================================

const POOLED_BLINK_EFFECTS = 16;
const BLINK_TRAIL_PARTICLE_COUNT = 50;
const BLINK_BURST_PARTICLE_COUNT = 30;
const BLINK_SLOT_INDICES = Array.from({ length: POOLED_BLINK_EFFECTS }, (_, i) => i);
const BLINK_PILLAR_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x7c3aed,
  transparent: true,
  opacity: 0.4,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
});
const PHANTOM_VEIL_ABILITY_ID = 'phantom_veil';
const ACTIVE_VEIL_SCAN_INTERVAL_MS = 80;

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

function refillBlinkSlot(slot: BlinkRenderSlot, effect: BlinkEffectData): void {
  const trailPositions = slot.trailGeometry.attributes.position as THREE.BufferAttribute;
  const trailSizes = slot.trailGeometry.attributes.size as THREE.BufferAttribute;
  const trailRandoms = slot.trailGeometry.attributes.random as THREE.BufferAttribute;
  const dx = effect.endPosition.x - effect.startPosition.x;
  const dy = effect.endPosition.y - effect.startPosition.y;
  const dz = effect.endPosition.z - effect.startPosition.z;

  for (let i = 0; i < BLINK_TRAIL_PARTICLE_COUNT; i++) {
    const t = i / BLINK_TRAIL_PARTICLE_COUNT;
    trailPositions.setXYZ(
      i,
      effect.startPosition.x + dx * t + (Math.random() - 0.5) * 0.5,
      effect.startPosition.y + dy * t + (Math.random() - 0.5) * 0.5,
      effect.startPosition.z + dz * t + (Math.random() - 0.5) * 0.5
    );
    trailSizes.setX(i, Math.random() * 0.15 + 0.05);
    trailRandoms.setX(i, Math.random());
  }

  trailPositions.needsUpdate = true;
  trailSizes.needsUpdate = true;
  trailRandoms.needsUpdate = true;

  const burstPositions = slot.burstGeometry.attributes.position as THREE.BufferAttribute;
  const burstVelocities = slot.burstGeometry.attributes.velocity as THREE.BufferAttribute;
  const burstSizes = slot.burstGeometry.attributes.size as THREE.BufferAttribute;

  for (let i = 0; i < BLINK_BURST_PARTICLE_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const speed = Math.random() * 3 + 2;
    burstPositions.setXYZ(i, 0, 0, 0);
    burstVelocities.setXYZ(
      i,
      Math.sin(phi) * Math.cos(theta) * speed,
      Math.cos(phi) * speed,
      Math.sin(phi) * Math.sin(theta) * speed
    );
    burstSizes.setX(i, Math.random() * 0.2 + 0.1);
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

      for (let particleIndex = 0; particleIndex < positions.count; particleIndex++) {
        const random = randoms.getX(particleIndex);
        positions.setY(
          particleIndex,
          positions.getY(particleIndex) + Math.sin(elapsedSeconds * 5 + random * 10) * 0.01
        );
      }

      positions.needsUpdate = true;
      slot.particleMaterial.opacity = (1 - progress) * 0.8;
    }
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

function hasActivePhantomVeil(
  player: Player | null | undefined,
  now: number,
  localUltimateActive = false
): boolean {
  if (!player || player.state !== 'alive' || player.heroId !== 'phantom') return false;
  const veil = player.abilities?.[PHANTOM_VEIL_ABILITY_ID];
  if (veil?.isActive) return true;

  return localUltimateActive;
}

function collectActivePhantomVeilIds(target: string[], now: number): string[] {
  const store = useGameStore.getState();
  const localPlayerId = store.localPlayer?.id ?? null;
  const localUltimateActive = Boolean(
    store.ultimateEffectActive &&
    store.ultimateEffectType === PHANTOM_VEIL_ABILITY_ID &&
    store.ultimateEffectEndTime > now
  );
  target.length = 0;

  const addPlayer = (player: Player | null | undefined, isLocalPlayer = false) => {
    if (!hasActivePhantomVeil(player, now, isLocalPlayer && localUltimateActive) || !player) return;
    target.push(player.id);
  };

  addPlayer(store.localPlayer, true);
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

function getPhantomVeilPlayerPosition(playerId: string): { x: number; y: number; z: number } | undefined {
  const store = useGameStore.getState();
  if (store.localPlayer?.id === playerId) return store.localPlayer.position;
  return store.players.get(playerId)?.position;
}

export function PhantomEffectsManager() {
  const localPlayerId = useGameStore((state) => state.localPlayer?.id ?? null);

  // Use refs for effect arrays to avoid setState in useFrame (prevents 60fps re-renders)
  const activeBlinkEffectsRef = useRef<BlinkEffectData[]>([]);
  const activeShadowArrivalsRef = useRef<ShadowArrivalData[]>([]);
  const blinkRenderSlotsRef = useRef<BlinkRenderSlot[]>([]);

  // Version counters to trigger re-renders only when effect counts change
  const [, setBlinkVersion] = useState(0);
  const [, setShadowVersion] = useState(0);
  const [activeVeilIds, setActiveVeilIds] = useState<string[]>([]);
  const activeVeilIdsRef = useRef<string[]>([]);
  const scratchVeilIdsRef = useRef<string[]>([]);
  const veilScanAccumulatorRef = useRef(ACTIVE_VEIL_SCAN_INTERVAL_MS);
  const lastBlinkCountRef = useRef(0);
  const lastShadowCountRef = useRef(0);
  const lastRevisionRef = useRef(0);

  useFrame((_, delta) => {
    const frameClock = getFrameClock();
    const snapshot = collectActivePhantomEffects(
      frameClock.nowMs,
      activeBlinkEffectsRef.current,
      activeShadowArrivalsRef.current
    );
    updatePooledBlinkEffects(
      blinkRenderSlotsRef.current,
      activeBlinkEffectsRef.current,
      frameClock.nowMs,
      delta,
      frameClock.elapsedSeconds
    );

    if (
      snapshot.blinkCount !== lastBlinkCountRef.current ||
      snapshot.revision !== lastRevisionRef.current
    ) {
      lastBlinkCountRef.current = snapshot.blinkCount;
      setBlinkVersion(version => version + 1);
    }

    if (
      snapshot.shadowCount !== lastShadowCountRef.current ||
      snapshot.revision !== lastRevisionRef.current
    ) {
      lastShadowCountRef.current = snapshot.shadowCount;
      setShadowVersion(version => version + 1);
    }

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

    lastRevisionRef.current = snapshot.revision;
  });
  
  return (
    <group>
      {/* Blink teleport effects */}
      <PooledBlinkTeleportSlots renderSlots={blinkRenderSlotsRef.current} />

      {/* Shadow Step arrival effects */}
      {activeShadowArrivalsRef.current.map(effect => (
        <ShadowStepArrivalEffect
          key={effect.id}
          position={effect.position}
          startTime={effect.startTime}
        />
      ))}

      {/* Phantom Veil 3D effects */}
      {activeVeilIds.map(playerId => (
        <PhantomVeil3DEffect
          key={playerId}
          isActive={true}
          playerId={playerId}
          playerPosition={getPhantomVeilPlayerPosition(playerId)}
          renderParticles={playerId !== localPlayerId}
        />
      ))}
    </group>
  );
}
