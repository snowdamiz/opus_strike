import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getFrameClock } from '../../utils/frameClock';
import { SHARED_GEOMETRIES } from './effectResources';
import {
  MOVEMENT_DIAGNOSTICS_ENABLED,
  measureFrameWork,
  recordEffectSlotDiagnostics,
} from '../../movement/networkDiagnostics';
import {
  BLINK_EFFECT_DURATION,
  collectActivePhantomEffects,
  type BlinkEffectData,
} from './phantom';
import { getRiftMaterial } from './phantom/materials';

// Re-export trigger functions for external use
export { triggerBlinkEffect } from './phantom';

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

export function PhantomEffectsManager() {
  // Use refs for effect arrays to avoid setState in useFrame (prevents 60fps re-renders)
  const activeBlinkEffectsRef = useRef<BlinkEffectData[]>([]);
  const blinkRenderSlotsRef = useRef<BlinkRenderSlot[]>([]);

  const runPhantomEffectsFrame = (delta: number): void => {
    const frameClock = getFrameClock();
    collectActivePhantomEffects(
      frameClock.nowMs,
      activeBlinkEffectsRef.current
    );
    updatePooledBlinkEffects(
      blinkRenderSlotsRef.current,
      activeBlinkEffectsRef.current,
      frameClock.nowMs,
      delta,
      frameClock.elapsedSeconds
    );
    if (MOVEMENT_DIAGNOSTICS_ENABLED) {
      recordEffectSlotDiagnostics('phantomBlink', {
        active: activeBlinkEffectsRef.current.length,
        capacity: POOLED_BLINK_EFFECTS,
        hiddenMounted: Math.max(0, POOLED_BLINK_EFFECTS - activeBlinkEffectsRef.current.length),
      });
    }
  };

  useFrame((_, delta) => {
    if (MOVEMENT_DIAGNOSTICS_ENABLED) {
      measureFrameWork('frame.effects.phantom', () => runPhantomEffectsFrame(delta));
      return;
    }

    runPhantomEffectsFrame(delta);
  });
  
  return (
    <group>
      {/* Blink teleport effects */}
      <PooledBlinkTeleportSlots renderSlots={blinkRenderSlotsRef.current} />
    </group>
  );
}
