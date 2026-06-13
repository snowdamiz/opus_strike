import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ABILITY_DEFINITIONS,
  CHRONOS_TIMEBREAK_SHOCKWAVE_HALF_ANGLE,
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
const CONE_HORIZONTAL_RADIUS_SCALE = 0.72;
const CONE_VERTICAL_RADIUS_SCALE = 0.42;
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
  ownerTeam: 'red' | 'blue';
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
const CHRONOS_TIMEBREAK_RETENTION_MS = TIMEBREAK_SHOCKWAVE_DURATION_MS + 120;
const activeChronosTimebreakEffects: ChronosTimebreakEffectData[] = [];
let chronosTimebreakRevision = 0;

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
    ownerTeam: (ownerTeam || 'red') as 'red' | 'blue',
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
  chronosTimebreakRevision++;
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

function ChronosTimebreakEffect({ timebreak }: { timebreak: ChronosTimebreakEffectData }) {
  const groupRef = useRef<THREE.Group>(null);
  const outerShellRef = useRef<THREE.Mesh>(null);
  const innerShellRef = useRef<THREE.Mesh>(null);
  const coreBeamRef = useRef<THREE.Mesh>(null);
  const muzzleFlashRef = useRef<THREE.Mesh>(null);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const spiralRefs = useRef<(THREE.Mesh | null)[]>([]);
  const shardRefs = useRef<(THREE.Mesh | null)[]>([]);
  const sparkRefs = useRef<(THREE.Mesh | null)[]>([]);
  const timebreakMaterials = useMemo(createTimebreakMaterials, []);
  const outerShellMaterial = timebreakMaterials.outerShell;
  const innerShellMaterial = timebreakMaterials.innerShell;
  const coreBeamMaterial = timebreakMaterials.coreBeam;
  const muzzleFlashMaterial = timebreakMaterials.muzzleFlash;
  const ringMaterials = timebreakMaterials.rings;
  const spiralMaterials = timebreakMaterials.spirals;
  const shardMaterial = timebreakMaterials.shard;
  const sparkMaterial = timebreakMaterials.spark;
  const hasRemovedRef = useRef(false);

  useEffect(() => () => disposeTimebreakMaterials(timebreakMaterials), [timebreakMaterials]);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;

    const now = getFrameClock().epochNowMs;
    const elapsedMs = now - timebreak.releaseTime;

    if (elapsedMs < 0) {
      group.visible = false;
      return;
    }

    if (elapsedMs > TIMEBREAK_SHOCKWAVE_DURATION_MS) {
      group.visible = false;
      if (!hasRemovedRef.current) {
        hasRemovedRef.current = true;
        timebreak.active = false;
        chronosTimebreakRevision++;
      }
      return;
    }

    const progress = THREE.MathUtils.clamp(elapsedMs / TIMEBREAK_SHOCKWAVE_DURATION_MS, 0, 1);
    const expansion = easeOutCubic(progress);
    const waveLength = (timebreak.radius || CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE) * THREE.MathUtils.lerp(0.08, 1, expansion);
    const maxHorizontalRadius = Math.tan(CHRONOS_TIMEBREAK_SHOCKWAVE_HALF_ANGLE)
      * (timebreak.radius || CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE)
      * CONE_HORIZONTAL_RADIUS_SCALE;
    const waveHorizontalRadius = maxHorizontalRadius * THREE.MathUtils.lerp(0.12, 1, expansion);
    const waveVerticalRadius = waveHorizontalRadius * CONE_VERTICAL_RADIUS_SCALE;
    const fade = 1 - THREE.MathUtils.smoothstep(progress, 0.46, 1);
    const birth = THREE.MathUtils.smoothstep(progress, 0, 0.08);
    const opacity = birth * fade;
    const ripple = 0.82 + Math.sin(progress * Math.PI * 7.5) * 0.18 * (1 - progress);
    const recoilPulse = Math.sin(progress * Math.PI) * (1 - progress * 0.35);

    group.visible = true;
    group.position.set(timebreak.position.x, timebreak.position.y, timebreak.position.z);
    group.rotation.y = getYawFromDirection(timebreak.direction);

    if (outerShellRef.current) {
      outerShellRef.current.rotation.z = progress * 0.28;
      outerShellRef.current.scale.set(waveHorizontalRadius, waveVerticalRadius, waveLength);
    }
    outerShellMaterial.opacity = THREE.MathUtils.clamp(opacity * 0.24, 0, 0.24);

    if (innerShellRef.current) {
      innerShellRef.current.rotation.z = -progress * 0.48 + 0.18;
      innerShellRef.current.scale.set(waveHorizontalRadius * 0.72, waveVerticalRadius * 0.66, waveLength * 0.94);
    }
    innerShellMaterial.opacity = THREE.MathUtils.clamp(opacity * 0.18 * ripple, 0, 0.18);

    if (coreBeamRef.current) {
      coreBeamRef.current.rotation.z = progress * -0.32;
      coreBeamRef.current.scale.set(
        waveHorizontalRadius * CONE_CORE_RADIUS_SCALE,
        waveVerticalRadius * 0.5,
        waveLength * 0.98
      );
    }
    coreBeamMaterial.opacity = THREE.MathUtils.clamp(opacity * 0.36 * ripple, 0, 0.34);

    if (muzzleFlashRef.current) {
      const muzzleScale = 0.12 + recoilPulse * 0.24;
      muzzleFlashRef.current.scale.set(muzzleScale, muzzleScale, muzzleScale);
      muzzleFlashRef.current.position.z = -0.08 - progress * 0.34;
    }
    muzzleFlashMaterial.opacity = THREE.MathUtils.clamp(opacity * (0.38 - progress * 0.18), 0, 0.38);

    ringRefs.current.forEach((ring, index) => {
      if (!ring) return;

      const spec = TIMEBREAK_RING_SPECS[index];
      const depth = waveLength * spec.depth;
      const ringPulse = 1 + Math.sin(progress * Math.PI * 4 + index * 0.9) * spec.pulse * (1 - progress);
      ring.position.z = -depth;
      ring.rotation.z = progress * spec.spin + index * 0.18;
      ring.scale.set(
        Math.max(0.001, waveHorizontalRadius * spec.depth * ringPulse),
        Math.max(0.001, waveVerticalRadius * spec.depth * ringPulse),
        1
      );
      ringMaterials[index].opacity = THREE.MathUtils.clamp(opacity * spec.opacity * ripple, 0, spec.opacity);
    });

    spiralRefs.current.forEach((spiral, index) => {
      if (!spiral) return;

      const spec = TIMEBREAK_SPIRAL_SPECS[index];
      spiral.rotation.z = progress * spec.spin;
      spiral.scale.set(waveHorizontalRadius * (0.96 - index * 0.08), waveVerticalRadius * (0.9 - index * 0.07), waveLength);
      spiralMaterials[index].opacity = THREE.MathUtils.clamp(opacity * spec.opacity * ripple, 0, spec.opacity);
    });

    shardRefs.current.forEach((shard, index) => {
      if (!shard) return;

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
    });
    shardMaterial.opacity = THREE.MathUtils.clamp(opacity * 0.54 * ripple, 0, 0.54);

    sparkRefs.current.forEach((spark, index) => {
      if (!spark) return;

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
    });
    sparkMaterial.opacity = THREE.MathUtils.clamp(opacity * 0.44, 0, 0.44);
  });

  return (
    <group ref={groupRef} visible={false} frustumCulled={false}>
      <mesh ref={outerShellRef} geometry={TIMEBREAK_OUTER_SHELL_GEOMETRY} material={outerShellMaterial} scale={[0.001, 0.001, 0.001]} frustumCulled={false} />
      <mesh ref={innerShellRef} geometry={TIMEBREAK_INNER_SHELL_GEOMETRY} material={innerShellMaterial} scale={[0.001, 0.001, 0.001]} frustumCulled={false} />
      <mesh ref={coreBeamRef} geometry={TIMEBREAK_CORE_BEAM_GEOMETRY} material={coreBeamMaterial} scale={[0.001, 0.001, 0.001]} frustumCulled={false} />
      <mesh ref={muzzleFlashRef} geometry={SHARED_GEOMETRIES.sphere16} material={muzzleFlashMaterial} scale={[0.001, 0.001, 0.001]} frustumCulled={false} />
      {TIMEBREAK_RING_SPECS.map((_, index) => (
        <mesh
          key={`ring-${index}`}
          ref={(node) => {
            ringRefs.current[index] = node;
          }}
          geometry={TIMEBREAK_RING_GEOMETRY}
          material={ringMaterials[index]}
          scale={[0.001, 0.001, 0.001]}
          frustumCulled={false}
        />
      ))}
      {TIMEBREAK_SPIRAL_GEOMETRIES.map((geometry, index) => (
        <mesh
          key={`spiral-${index}`}
          ref={(node) => {
            spiralRefs.current[index] = node;
          }}
          geometry={geometry}
          material={spiralMaterials[index]}
          scale={[0.001, 0.001, 0.001]}
          frustumCulled={false}
        />
      ))}
      {TIMEBREAK_SHARD_SPECS.map((_, index) => (
        <mesh
          key={`shard-${index}`}
          ref={(node) => {
            shardRefs.current[index] = node;
          }}
          geometry={SHARED_GEOMETRIES.cone6}
          material={shardMaterial}
          visible={false}
          frustumCulled={false}
        />
      ))}
      {TIMEBREAK_SHARD_SPECS.map((_, index) => (
        <mesh
          key={`spark-${index}`}
          ref={(node) => {
            sparkRefs.current[index] = node;
          }}
          geometry={SHARED_GEOMETRIES.sphere8}
          material={sparkMaterial}
          visible={false}
          frustumCulled={false}
        />
      ))}
    </group>
  );
}

function pruneChronosTimebreakEffects(now: number): number {
  let changed = false;
  for (let index = activeChronosTimebreakEffects.length - 1; index >= 0; index--) {
    const effect = activeChronosTimebreakEffects[index];
    if (!effect.active || now - effect.releaseTime > CHRONOS_TIMEBREAK_RETENTION_MS) {
      activeChronosTimebreakEffects.splice(index, 1);
      changed = true;
    }
  }

  if (changed) {
    chronosTimebreakRevision++;
  }

  return chronosTimebreakRevision;
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

export function ChronosTimebreakManager() {
  const [timebreaks, setTimebreaks] = useState<ChronosTimebreakEffectData[]>([]);
  const lastRevisionRef = useRef(-1);

  useFrame(() => {
    const revision = pruneChronosTimebreakEffects(getFrameClock().epochNowMs);
    if (revision === lastRevisionRef.current) return;

    lastRevisionRef.current = revision;
    setTimebreaks(activeChronosTimebreakEffects.filter((effect) => effect.active));
  });

  return (
    <group>
      {timebreaks.map((timebreak) => (
        <ChronosTimebreakEffect key={timebreak.id} timebreak={timebreak} />
      ))}
    </group>
  );
}
