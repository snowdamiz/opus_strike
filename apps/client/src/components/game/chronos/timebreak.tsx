import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ABILITY_DEFINITIONS,
  CHRONOS_TIMEBREAK_SHOCKWAVE_HALF_ANGLE,
  CHRONOS_TIMEBREAK_SHOCKWAVE_MAX_VERTICAL_DELTA,
  CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE,
  type Team,
} from '@voxel-strike/shared';
import { SHARED_GEOMETRIES } from '../effectResources';
import { getFrameClock } from '../../../utils/frameClock';

const TIMEBREAK_SHOCKWAVE_DURATION_MS = 680;
const TIMEBREAK_EMERALD = 0x13f76d;
const TIMEBREAK_DEEP_EMERALD = 0x069343;
const TIMEBREAK_BRIGHT_EMERALD = 0x73ffa2;
const TIMEBREAK_CORE_GREEN = 0xb8ffc8;
const CHRONOS_TIMEBREAK_ABILITY_ID = 'chronos_timebreak';
const DEFAULT_TIMEBREAK_DIRECTION = { x: 0, y: 0, z: -1 };
const CONE_CORE_RADIUS_SCALE = 0.18;
const TIMEBREAK_RING_SPECS = [
  { depth: 0.2, opacity: 0.34, pulse: 0.12, spin: -0.75 },
  { depth: 0.38, opacity: 0.28, pulse: 0.08, spin: 0.55 },
  { depth: 0.58, opacity: 0.32, pulse: 0.11, spin: -0.42 },
  { depth: 0.8, opacity: 0.42, pulse: 0.14, spin: 0.36 },
  { depth: 1, opacity: 0.62, pulse: 0.2, spin: -0.28 },
] as const;
const TIMEBREAK_SPIRAL_SPECS = [
  { phase: 0.25, turns: 1.14, width: 0.034, opacity: 0.46, spin: 0.42 },
  { phase: 2.26, turns: 1.42, width: 0.026, opacity: 0.34, spin: -0.5 },
  { phase: 4.42, turns: 0.92, width: 0.038, opacity: 0.38, spin: 0.28 },
] as const;
const TIMEBREAK_SHARD_SPECS = [
  { depth: 0.16, angle: 0.52, radial: 0.32, size: 0.7, spin: 0.8 },
  { depth: 0.22, angle: 2.18, radial: 0.42, size: 0.52, spin: -0.9 },
  { depth: 0.28, angle: 4.74, radial: 0.36, size: 0.62, spin: 1 },
  { depth: 0.34, angle: 1.38, radial: 0.62, size: 0.48, spin: -0.55 },
  { depth: 0.43, angle: 3.28, radial: 0.48, size: 0.82, spin: 0.72 },
  { depth: 0.5, angle: 5.72, radial: 0.58, size: 0.58, spin: -0.7 },
  { depth: 0.58, angle: 0.9, radial: 0.68, size: 0.76, spin: 0.44 },
  { depth: 0.66, angle: 2.76, radial: 0.55, size: 0.54, spin: -0.84 },
  { depth: 0.72, angle: 4.22, radial: 0.72, size: 0.66, spin: 0.62 },
  { depth: 0.8, angle: 1.94, radial: 0.78, size: 0.46, spin: -0.5 },
  { depth: 0.88, angle: 5.18, radial: 0.66, size: 0.7, spin: 0.68 },
  { depth: 0.95, angle: 3.72, radial: 0.84, size: 0.56, spin: -0.76 },
] as const;
let timebreakEffectIdCounter = 0;

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

interface ChronosTimebreakEffectData {
  id: string;
  position: Vec3Like;
  direction: Vec3Like;
  startTime: number;
  releaseTime: number;
  duration: number;
  radius: number;
  ownerId: string;
  ownerTeam: Team;
  active: boolean;
}

interface AddChronosTimebreakEffectOptions {
  id?: string;
  position: Vec3Like;
  ownerId: string;
  ownerTeam?: Team | null;
  direction?: Vec3Like;
  startTime?: number;
  releaseTime?: number;
  duration?: number;
  radius?: number;
}

interface TimebreakMaterialOptions {
  color: number;
  blending?: THREE.Blending;
}

const MAX_CHRONOS_TIMEBREAK_EFFECTS = 24;
const POOLED_CHRONOS_TIMEBREAK_EFFECTS = 8;
const CHRONOS_TIMEBREAK_SLOT_INDICES = Array.from({ length: POOLED_CHRONOS_TIMEBREAK_EFFECTS }, (_, i) => i);
const CHRONOS_TIMEBREAK_RETENTION_MS = TIMEBREAK_SHOCKWAVE_DURATION_MS + 120;
const activeChronosTimebreakEffects: ChronosTimebreakEffectData[] = [];

export function addChronosTimebreakEffect({
  id,
  position,
  ownerId,
  ownerTeam,
  direction = DEFAULT_TIMEBREAK_DIRECTION,
  startTime = Date.now(),
  releaseTime = startTime,
  duration = ABILITY_DEFINITIONS[CHRONOS_TIMEBREAK_ABILITY_ID]?.duration ?? 0,
  radius = CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE,
}: AddChronosTimebreakEffectOptions): void {
  pruneChronosTimebreakEffects(getFrameClock().epochNowMs || Date.now());

  const normalizedDirection = normalizeTimebreakDirection(direction);
  const effectId = id ?? `chronos_timebreak_${ownerId}_${timebreakEffectIdCounter++}`;

  const existingIndex = activeChronosTimebreakEffects.findIndex((effect) => effect.id === effectId);
  const effect: ChronosTimebreakEffectData = {
    id: effectId,
    position: {
      x: position.x,
      y: position.y,
      z: position.z,
    },
    direction: normalizedDirection,
    startTime,
    releaseTime,
    duration,
    radius,
    ownerId,
    ownerTeam: ownerTeam || 'red',
    active: true,
  };

  if (existingIndex >= 0) {
    activeChronosTimebreakEffects[existingIndex] = effect;
  } else {
    if (activeChronosTimebreakEffects.length >= MAX_CHRONOS_TIMEBREAK_EFFECTS) {
      activeChronosTimebreakEffects.shift();
    }
    activeChronosTimebreakEffects.push(effect);
  }
}

function normalizeTimebreakDirection(direction: Vec3Like): Vec3Like {
  const length = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
  if (length <= 0.0001) return DEFAULT_TIMEBREAK_DIRECTION;

  return {
    x: direction.x / length,
    y: 0,
    z: direction.z / length,
  };
}

function getYawFromDirection(direction: Vec3Like): number {
  return Math.atan2(-direction.x, -direction.z);
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

function createEnergyConeShellGeometry(
  radialSegments = 42,
  lengthSegments = 14,
  radiusStart = 0.035,
  flareExponent = 0.82,
  waviness = 0.024
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let lengthIndex = 0; lengthIndex <= lengthSegments; lengthIndex++) {
    const t = lengthIndex / lengthSegments;
    const baseRadius = radiusStart + Math.pow(t, flareExponent) * (1 - radiusStart);

    for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex++) {
      const angle = (radialIndex / radialSegments) * Math.PI * 2;
      const wave = Math.sin(angle * 3 + t * Math.PI * 4.5) * waviness * (0.2 + t * 0.8);
      const radius = Math.max(0.001, baseRadius + wave);
      positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, -t);
    }
  }

  const rowSize = radialSegments + 1;
  for (let lengthIndex = 0; lengthIndex < lengthSegments; lengthIndex++) {
    for (let radialIndex = 0; radialIndex < radialSegments; radialIndex++) {
      const current = lengthIndex * rowSize + radialIndex;
      const next = current + rowSize;
      indices.push(current, next, current + 1);
      indices.push(current + 1, next, next + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createConeRingGeometry(radialSegments = 64, innerRadius = 0.91, outerRadius = 1.03): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index <= radialSegments; index++) {
    const angle = (index / radialSegments) * Math.PI * 2;
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    positions.push(x * innerRadius, y * innerRadius, 0);
    positions.push(x * outerRadius, y * outerRadius, 0);
  }

  for (let index = 0; index < radialSegments; index++) {
    const current = index * 2;
    indices.push(current, current + 1, current + 2);
    indices.push(current + 1, current + 3, current + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createConeSpiralRibbonGeometry(
  samples = 96,
  turns = 1.2,
  phase = 0,
  angularWidth = 0.032
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index <= samples; index++) {
    const t = 0.035 + (index / samples) * 0.965;
    const radius = Math.pow(t, 0.9);
    const angle = phase + turns * Math.PI * 2 * t + Math.sin(t * Math.PI * 3 + phase) * 0.16;

    for (const offset of [-angularWidth, angularWidth]) {
      positions.push(Math.cos(angle + offset) * radius, Math.sin(angle + offset) * radius, -t);
    }
  }

  for (let index = 0; index < samples; index++) {
    const current = index * 2;
    indices.push(current, current + 1, current + 2);
    indices.push(current + 1, current + 3, current + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createTimebreakMaterial({
  color,
  blending = THREE.AdditiveBlending,
}: TimebreakMaterialOptions): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

const TIMEBREAK_OUTER_SHELL_GEOMETRY = createEnergyConeShellGeometry(46, 16, 0.045, 0.76, 0.03);
const TIMEBREAK_INNER_SHELL_GEOMETRY = createEnergyConeShellGeometry(34, 12, 0.03, 0.96, 0.016);
const TIMEBREAK_CORE_BEAM_GEOMETRY = createEnergyConeShellGeometry(18, 8, 0.018, 1.08, 0.006);
const TIMEBREAK_RING_GEOMETRY = createConeRingGeometry(72, 0.9, 1.04);
const TIMEBREAK_SPIRAL_GEOMETRIES = TIMEBREAK_SPIRAL_SPECS.map((spec) =>
  createConeSpiralRibbonGeometry(100, spec.turns, spec.phase, spec.width)
);
const TIMEBREAK_OUTER_SHELL_MATERIAL_TEMPLATE = createTimebreakMaterial({
  color: TIMEBREAK_EMERALD,
  blending: THREE.NormalBlending,
});
const TIMEBREAK_INNER_SHELL_MATERIAL_TEMPLATE = createTimebreakMaterial({
  color: TIMEBREAK_DEEP_EMERALD,
  blending: THREE.NormalBlending,
});
const TIMEBREAK_CORE_BEAM_MATERIAL_TEMPLATE = createTimebreakMaterial({ color: TIMEBREAK_BRIGHT_EMERALD });
const TIMEBREAK_MUZZLE_FLASH_MATERIAL_TEMPLATE = createTimebreakMaterial({ color: TIMEBREAK_CORE_GREEN });
const TIMEBREAK_RING_MATERIAL_TEMPLATES = TIMEBREAK_RING_SPECS.map((spec, index) => createTimebreakMaterial({
  color: index === TIMEBREAK_RING_SPECS.length - 1 ? TIMEBREAK_BRIGHT_EMERALD : TIMEBREAK_EMERALD,
  blending: spec.depth < 0.4 ? THREE.NormalBlending : THREE.AdditiveBlending,
}));
const TIMEBREAK_SPIRAL_MATERIAL_TEMPLATES = TIMEBREAK_SPIRAL_SPECS.map((_, index) => createTimebreakMaterial({
  color: index === 1 ? TIMEBREAK_DEEP_EMERALD : TIMEBREAK_BRIGHT_EMERALD,
}));
const TIMEBREAK_SHARD_MATERIAL_TEMPLATE = createTimebreakMaterial({ color: TIMEBREAK_BRIGHT_EMERALD });
const TIMEBREAK_SPARK_MATERIAL_TEMPLATE = createTimebreakMaterial({ color: TIMEBREAK_CORE_GREEN });

interface TimebreakMaterials {
  outerShell: THREE.MeshBasicMaterial;
  innerShell: THREE.MeshBasicMaterial;
  coreBeam: THREE.MeshBasicMaterial;
  muzzleFlash: THREE.MeshBasicMaterial;
  rings: THREE.MeshBasicMaterial[];
  spirals: THREE.MeshBasicMaterial[];
  shard: THREE.MeshBasicMaterial;
  spark: THREE.MeshBasicMaterial;
}

function createTimebreakMaterials(): TimebreakMaterials {
  return {
    outerShell: TIMEBREAK_OUTER_SHELL_MATERIAL_TEMPLATE.clone(),
    innerShell: TIMEBREAK_INNER_SHELL_MATERIAL_TEMPLATE.clone(),
    coreBeam: TIMEBREAK_CORE_BEAM_MATERIAL_TEMPLATE.clone(),
    muzzleFlash: TIMEBREAK_MUZZLE_FLASH_MATERIAL_TEMPLATE.clone(),
    rings: TIMEBREAK_RING_MATERIAL_TEMPLATES.map((material) => material.clone()),
    spirals: TIMEBREAK_SPIRAL_MATERIAL_TEMPLATES.map((material) => material.clone()),
    shard: TIMEBREAK_SHARD_MATERIAL_TEMPLATE.clone(),
    spark: TIMEBREAK_SPARK_MATERIAL_TEMPLATE.clone(),
  };
}

function disposeTimebreakMaterials(materials: TimebreakMaterials): void {
  materials.outerShell.dispose();
  materials.innerShell.dispose();
  materials.coreBeam.dispose();
  materials.muzzleFlash.dispose();
  materials.rings.forEach((material) => material.dispose());
  materials.spirals.forEach((material) => material.dispose());
  materials.shard.dispose();
  materials.spark.dispose();
}

interface TimebreakRenderSlot {
  group: THREE.Group | null;
  outerShell: THREE.Mesh | null;
  innerShell: THREE.Mesh | null;
  coreBeam: THREE.Mesh | null;
  muzzleFlash: THREE.Mesh | null;
  rings: (THREE.Mesh | null)[];
  spirals: (THREE.Mesh | null)[];
  shards: (THREE.Mesh | null)[];
  sparks: (THREE.Mesh | null)[];
  materials: TimebreakMaterials;
}

function createTimebreakRenderSlot(): TimebreakRenderSlot {
  return {
    group: null,
    outerShell: null,
    innerShell: null,
    coreBeam: null,
    muzzleFlash: null,
    rings: Array.from({ length: TIMEBREAK_RING_SPECS.length }, () => null),
    spirals: Array.from({ length: TIMEBREAK_SPIRAL_GEOMETRIES.length }, () => null),
    shards: Array.from({ length: TIMEBREAK_SHARD_SPECS.length }, () => null),
    sparks: Array.from({ length: TIMEBREAK_SHARD_SPECS.length }, () => null),
    materials: createTimebreakMaterials(),
  };
}

function ensureTimebreakRenderSlot(renderSlots: TimebreakRenderSlot[], index: number): TimebreakRenderSlot {
  let slot = renderSlots[index];
  if (!slot) {
    slot = createTimebreakRenderSlot();
    renderSlots[index] = slot;
  }
  return slot;
}

function hideTimebreakSlot(slot: TimebreakRenderSlot): void {
  if (slot.group) slot.group.visible = false;
}

function updateTimebreakSlot(
  slot: TimebreakRenderSlot,
  timebreak: ChronosTimebreakEffectData | undefined,
  now: number
): boolean {
  const group = slot.group;
  if (!group || !timebreak?.active) {
    hideTimebreakSlot(slot);
    return false;
  }

  const elapsedMs = now - timebreak.releaseTime;

  if (elapsedMs < 0) {
    hideTimebreakSlot(slot);
    return false;
  }

  if (elapsedMs > TIMEBREAK_SHOCKWAVE_DURATION_MS) {
    timebreak.active = false;
    hideTimebreakSlot(slot);
    return false;
  }

  const materials = slot.materials;
  const progress = THREE.MathUtils.clamp(elapsedMs / TIMEBREAK_SHOCKWAVE_DURATION_MS, 0, 1);
  const expansion = easeOutCubic(progress);
  const shockwaveRange = timebreak.radius || CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE;
  const waveLength = shockwaveRange * THREE.MathUtils.lerp(0.08, 1, expansion);
  const maxHorizontalRadius = Math.tan(CHRONOS_TIMEBREAK_SHOCKWAVE_HALF_ANGLE)
    * shockwaveRange;
  const waveHorizontalRadius = maxHorizontalRadius * THREE.MathUtils.lerp(0.12, 1, expansion);
  const waveVerticalRadius = CHRONOS_TIMEBREAK_SHOCKWAVE_MAX_VERTICAL_DELTA
    * THREE.MathUtils.lerp(0.12, 1, expansion);
  const fade = 1 - THREE.MathUtils.smoothstep(progress, 0.46, 1);
  const birth = THREE.MathUtils.smoothstep(progress, 0, 0.08);
  const opacity = birth * fade;
  const ripple = 0.82 + Math.sin(progress * Math.PI * 7.5) * 0.18 * (1 - progress);
  const recoilPulse = Math.sin(progress * Math.PI) * (1 - progress * 0.35);

  group.visible = true;
  group.position.set(timebreak.position.x, timebreak.position.y, timebreak.position.z);
  group.rotation.y = getYawFromDirection(timebreak.direction);

  if (slot.outerShell) {
    slot.outerShell.rotation.z = progress * 0.28;
    slot.outerShell.scale.set(waveHorizontalRadius, waveVerticalRadius, waveLength);
  }
  materials.outerShell.opacity = THREE.MathUtils.clamp(opacity * 0.24, 0, 0.24);

  if (slot.innerShell) {
    slot.innerShell.rotation.z = -progress * 0.48 + 0.18;
    slot.innerShell.scale.set(waveHorizontalRadius * 0.72, waveVerticalRadius * 0.66, waveLength * 0.94);
  }
  materials.innerShell.opacity = THREE.MathUtils.clamp(opacity * 0.18 * ripple, 0, 0.18);

  if (slot.coreBeam) {
    slot.coreBeam.rotation.z = progress * -0.32;
    slot.coreBeam.scale.set(
      waveHorizontalRadius * CONE_CORE_RADIUS_SCALE,
      waveVerticalRadius * 0.5,
      waveLength * 0.98
    );
  }
  materials.coreBeam.opacity = THREE.MathUtils.clamp(opacity * 0.36 * ripple, 0, 0.34);

  if (slot.muzzleFlash) {
    const muzzleScale = 0.12 + recoilPulse * 0.24;
    slot.muzzleFlash.scale.set(muzzleScale, muzzleScale, muzzleScale);
    slot.muzzleFlash.position.z = -0.08 - progress * 0.34;
  }
  materials.muzzleFlash.opacity = THREE.MathUtils.clamp(opacity * (0.38 - progress * 0.18), 0, 0.38);

  for (let index = 0; index < slot.rings.length; index++) {
    const ring = slot.rings[index];
    if (!ring) continue;

    const spec = TIMEBREAK_RING_SPECS[index];
    const depth = waveLength * spec.depth;
    const ringPulse = Math.min(1, 1 + Math.sin(progress * Math.PI * 4 + index * 0.9) * spec.pulse * (1 - progress));
    ring.position.z = -depth;
    ring.rotation.z = progress * spec.spin + index * 0.18;
    ring.scale.set(
      Math.max(0.001, waveHorizontalRadius * spec.depth * ringPulse),
      Math.max(0.001, waveVerticalRadius * spec.depth * ringPulse),
      1
    );
    materials.rings[index].opacity = THREE.MathUtils.clamp(opacity * spec.opacity * ripple, 0, spec.opacity);
  }

  for (let index = 0; index < slot.spirals.length; index++) {
    const spiral = slot.spirals[index];
    if (!spiral) continue;

    const spec = TIMEBREAK_SPIRAL_SPECS[index];
    spiral.rotation.z = progress * spec.spin;
    spiral.scale.set(waveHorizontalRadius * (0.96 - index * 0.08), waveVerticalRadius * (0.9 - index * 0.07), waveLength);
    materials.spirals[index].opacity = THREE.MathUtils.clamp(opacity * spec.opacity * ripple, 0, spec.opacity);
  }

  for (let index = 0; index < slot.shards.length; index++) {
    const shard = slot.shards[index];
    if (!shard) continue;

    const spec = TIMEBREAK_SHARD_SPECS[index];
    const drift = progress * 0.18 * (1 - spec.depth);
    const depth = THREE.MathUtils.clamp(spec.depth + drift, 0.05, 1);
    const angle = spec.angle + progress * spec.spin * 0.58;
    const radial = spec.radial * depth;
    shard.visible = progress > 0.04 && progress < 0.96;
    shard.position.set(
      Math.cos(angle) * waveHorizontalRadius * radial,
      Math.sin(angle) * waveVerticalRadius * radial,
      -waveLength * depth
    );
    shard.rotation.set(-Math.PI / 2 + progress * 0.35, angle, progress * spec.spin);
    const shardScale = spec.size * (0.065 + recoilPulse * 0.03);
    shard.scale.set(shardScale * 0.42, shardScale * 1.35, shardScale * 0.42);
  }
  materials.shard.opacity = THREE.MathUtils.clamp(opacity * 0.54 * ripple, 0, 0.54);

  for (let index = 0; index < slot.sparks.length; index++) {
    const spark = slot.sparks[index];
    if (!spark) continue;

    const spec = TIMEBREAK_SHARD_SPECS[index];
    const angle = spec.angle - progress * spec.spin * 0.44 + 0.55;
    const depth = THREE.MathUtils.clamp(spec.depth + progress * 0.11, 0.04, 1);
    const radial = (0.18 + spec.radial * 0.34) * depth;
    spark.visible = progress > 0.02 && progress < 0.92;
    spark.position.set(
      Math.cos(angle) * waveHorizontalRadius * radial,
      Math.sin(angle) * waveVerticalRadius * radial,
      -waveLength * depth
    );
    const sparkScale = spec.size * (0.025 + Math.sin(progress * Math.PI) * 0.025);
    spark.scale.setScalar(sparkScale);
  }
  materials.spark.opacity = THREE.MathUtils.clamp(opacity * 0.44, 0, 0.44);

  return true;
}

function pruneChronosTimebreakEffects(now: number): void {
  for (let index = activeChronosTimebreakEffects.length - 1; index >= 0; index--) {
    const effect = activeChronosTimebreakEffects[index];
    if (!effect.active || now - effect.releaseTime > CHRONOS_TIMEBREAK_RETENTION_MS) {
      activeChronosTimebreakEffects.splice(index, 1);
    }
  }
}

function updatePooledChronosTimebreakEffects(renderSlots: TimebreakRenderSlot[], now: number): void {
  pruneChronosTimebreakEffects(now);

  for (let index = 0; index < POOLED_CHRONOS_TIMEBREAK_EFFECTS; index++) {
    const slot = renderSlots[index];
    if (!slot) continue;
    updateTimebreakSlot(slot, activeChronosTimebreakEffects[index], now);
  }
}

function PooledChronosTimebreakSlots({ renderSlots }: { renderSlots: TimebreakRenderSlot[] }) {
  useEffect(() => () => {
    for (const slot of renderSlots) {
      disposeTimebreakMaterials(slot.materials);
    }
  }, [renderSlots]);

  return (
    <group>
      {CHRONOS_TIMEBREAK_SLOT_INDICES.map((slotIndex) => {
        const slot = ensureTimebreakRenderSlot(renderSlots, slotIndex);
        const materials = slot.materials;
        return (
          <group key={slotIndex} ref={(node) => { slot.group = node; }} visible={false} frustumCulled={false}>
            <mesh ref={(node) => { slot.outerShell = node; }} geometry={TIMEBREAK_OUTER_SHELL_GEOMETRY} material={materials.outerShell} scale={[0.001, 0.001, 0.001]} frustumCulled={false} />
            <mesh ref={(node) => { slot.innerShell = node; }} geometry={TIMEBREAK_INNER_SHELL_GEOMETRY} material={materials.innerShell} scale={[0.001, 0.001, 0.001]} frustumCulled={false} />
            <mesh ref={(node) => { slot.coreBeam = node; }} geometry={TIMEBREAK_CORE_BEAM_GEOMETRY} material={materials.coreBeam} scale={[0.001, 0.001, 0.001]} frustumCulled={false} />
            <mesh ref={(node) => { slot.muzzleFlash = node; }} geometry={SHARED_GEOMETRIES.sphere16} material={materials.muzzleFlash} scale={[0.001, 0.001, 0.001]} frustumCulled={false} />
            {TIMEBREAK_RING_SPECS.map((_, index) => (
              <mesh
                key={`ring-${index}`}
                ref={(node) => { slot.rings[index] = node; }}
                geometry={TIMEBREAK_RING_GEOMETRY}
                material={materials.rings[index]}
                scale={[0.001, 0.001, 0.001]}
                frustumCulled={false}
              />
            ))}
            {TIMEBREAK_SPIRAL_GEOMETRIES.map((geometry, index) => (
              <mesh
                key={`spiral-${index}`}
                ref={(node) => { slot.spirals[index] = node; }}
                geometry={geometry}
                material={materials.spirals[index]}
                scale={[0.001, 0.001, 0.001]}
                frustumCulled={false}
              />
            ))}
            {TIMEBREAK_SHARD_SPECS.map((_, index) => (
              <mesh
                key={`shard-${index}`}
                ref={(node) => { slot.shards[index] = node; }}
                geometry={SHARED_GEOMETRIES.cone6}
                material={materials.shard}
                visible={false}
                frustumCulled={false}
              />
            ))}
            {TIMEBREAK_SHARD_SPECS.map((_, index) => (
              <mesh
                key={`spark-${index}`}
                ref={(node) => { slot.sparks[index] = node; }}
                geometry={SHARED_GEOMETRIES.sphere8}
                material={materials.spark}
                visible={false}
                frustumCulled={false}
              />
            ))}
          </group>
        );
      })}
    </group>
  );
}

export function ChronosTimebreakManager() {
  const renderSlotsRef = useRef<TimebreakRenderSlot[]>([]);

  useFrame(() => {
    updatePooledChronosTimebreakEffects(renderSlotsRef.current, getFrameClock().epochNowMs);
  });

  return <PooledChronosTimebreakSlots renderSlots={renderSlotsRef.current} />;
}

export function prewarmChronosTimebreakResources(): void {
  void TIMEBREAK_OUTER_SHELL_GEOMETRY;
  void TIMEBREAK_INNER_SHELL_GEOMETRY;
  void TIMEBREAK_CORE_BEAM_GEOMETRY;
  void TIMEBREAK_RING_GEOMETRY;
  void TIMEBREAK_SPIRAL_GEOMETRIES;
  void TIMEBREAK_OUTER_SHELL_MATERIAL_TEMPLATE;
  void TIMEBREAK_RING_MATERIAL_TEMPLATES;
}

function addTimebreakPrewarmMesh(
  target: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number] | number,
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

export function appendChronosTimebreakGpuPrewarmObjects(target: THREE.Object3D): void {
  prewarmChronosTimebreakResources();
  const materials = createTimebreakMaterials();
  addTimebreakPrewarmMesh(target, TIMEBREAK_OUTER_SHELL_GEOMETRY, materials.outerShell, [-2.55, 1.48, -4.8], [0.2, 0.09, 0.42], [0, 0.4, 0]);
  addTimebreakPrewarmMesh(target, TIMEBREAK_INNER_SHELL_GEOMETRY, materials.innerShell, [-2.18, 1.48, -4.8], [0.18, 0.08, 0.38], [0, -0.35, 0]);
  addTimebreakPrewarmMesh(target, TIMEBREAK_CORE_BEAM_GEOMETRY, materials.coreBeam, [-1.86, 1.48, -4.8], [0.08, 0.04, 0.36]);
  addTimebreakPrewarmMesh(target, TIMEBREAK_RING_GEOMETRY, materials.rings[0], [-1.55, 1.48, -4.8], [0.18, 0.1, 1]);
  TIMEBREAK_SPIRAL_GEOMETRIES.forEach((geometry, index) => {
    addTimebreakPrewarmMesh(
      target,
      geometry,
      materials.spirals[index],
      [-1.22 + index * 0.24, 1.48, -4.8],
      [0.16, 0.08, 0.34],
      [0, 0, index * 0.3]
    );
  });
  addTimebreakPrewarmMesh(target, SHARED_GEOMETRIES.cone6, materials.shard, [-0.45, 1.48, -4.8], 0.13);
  addTimebreakPrewarmMesh(target, SHARED_GEOMETRIES.sphere8, materials.spark, [-0.25, 1.48, -4.8], 0.11);
}
