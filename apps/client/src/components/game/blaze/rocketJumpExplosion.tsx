import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SHARED_GEOMETRIES } from '../effectResources';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { getFrameClock } from '../../../utils/frameClock';
import {
  MOVEMENT_DIAGNOSTICS_ENABLED,
  measureFrameWork,
  recordEffectSlotDiagnostics,
} from '../../../movement/networkDiagnostics';

interface RocketJumpExplosionData {
  id: string;
  position: { x: number; y: number; z: number };
  frameStartTime: number;
}

export const ROCKET_JUMP_DURATION = 1000;

const POOLED_ROCKET_JUMP_EXPLOSIONS = 8;
const ROCKET_JUMP_SLOT_INDICES = Array.from({ length: POOLED_ROCKET_JUMP_EXPLOSIONS }, (_, i) => i);
const rocketJumpExplosions: RocketJumpExplosionData[] = [];
let explosionIdCounter = 0;

export function triggerRocketJumpExplosion(position: { x: number; y: number; z: number }) {
  const now = getFrameClock().nowMs;
  pruneExpiredRocketJumpExplosions(now);

  if (rocketJumpExplosions.length >= POOLED_ROCKET_JUMP_EXPLOSIONS) {
    rocketJumpExplosions.shift();
  }

  rocketJumpExplosions.push({
    id: `rj_${explosionIdCounter++}`,
    position: { ...position },
    frameStartTime: now,
  });
}

const ROCKET_JUMP_SPARKS = Array.from({ length: 20 }, (_, i) => ({
  angle: (i / 20) * Math.PI * 2 + Math.random() * 0.35,
  speed: 5 + Math.random() * 8,
  ySpeed: 7 + Math.random() * 10,
  size: 0.035 + Math.random() * 0.07,
}));

const ROCKET_JUMP_SMOKE_PUFFS = Array.from({ length: 6 }, (_, i) => ({
  angle: i * 1.14,
  radius: 0.28 + (i % 3) * 0.18,
  lift: 1.8 + i * 0.34,
}));

type RocketJumpMaterialKind =
  | 'flash'
  | 'core'
  | 'mid'
  | 'outer'
  | 'pressureShell'
  | 'heatCurtain'
  | 'outerShockwave'
  | 'innerShockwave'
  | 'emberShockwave'
  | 'smoke'
  | 'spark'
  | 'scorch';

const ROCKET_JUMP_MATERIAL_OPTIONS: Record<RocketJumpMaterialKind, THREE.MeshBasicMaterialParameters> = {
  flash: {
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  },
  core: {
    color: 0xffffcc,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  },
  mid: {
    color: 0xff8800,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  },
  outer: {
    color: 0xff3300,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  },
  pressureShell: {
    color: 0xfff0a0,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  },
  heatCurtain: {
    color: 0xff7a00,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  },
  outerShockwave: {
    color: 0xff5a12,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  },
  innerShockwave: {
    color: 0xffc03a,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  },
  emberShockwave: {
    color: 0xffff88,
    transparent: true,
    opacity: 0.62,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  },
  smoke: {
    color: 0x555555,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  },
  spark: {
    color: 0xffcc00,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  },
  scorch: {
    color: 0x331100,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
  },
};

const ROCKET_JUMP_PREWARM_MATERIAL_KINDS: RocketJumpMaterialKind[] = [
  'flash',
  'pressureShell',
  'heatCurtain',
  'outerShockwave',
  'innerShockwave',
  'emberShockwave',
  'smoke',
  'spark',
  'scorch',
];

interface RocketJumpSlotMaterials {
  flash: THREE.MeshBasicMaterial;
  core: THREE.MeshBasicMaterial;
  mid: THREE.MeshBasicMaterial;
  outer: THREE.MeshBasicMaterial;
  pressureShell: THREE.MeshBasicMaterial;
  heatCurtain: THREE.MeshBasicMaterial;
  outerShockwave: THREE.MeshBasicMaterial;
  innerShockwave: THREE.MeshBasicMaterial;
  emberShockwave: THREE.MeshBasicMaterial;
  smoke: THREE.MeshBasicMaterial[];
  sparks: THREE.MeshBasicMaterial[];
  scorch: THREE.MeshBasicMaterial;
}

interface RocketJumpRenderSlot {
  group: THREE.Group | null;
  flash: THREE.Mesh | null;
  core: THREE.Mesh | null;
  mid: THREE.Mesh | null;
  outer: THREE.Mesh | null;
  pressureShell: THREE.Mesh | null;
  heatCurtain: THREE.Mesh | null;
  outerShockwave: THREE.Mesh | null;
  innerShockwave: THREE.Mesh | null;
  emberShockwave: THREE.Mesh | null;
  scorch: THREE.Mesh | null;
  smoke: (THREE.Mesh | null)[];
  sparks: (THREE.Mesh | null)[];
  light: THREE.PointLight | null;
  materials: RocketJumpSlotMaterials;
}

function createRocketJumpMaterial(kind: RocketJumpMaterialKind): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial(ROCKET_JUMP_MATERIAL_OPTIONS[kind]);
}

function createRocketJumpSlotMaterials(): RocketJumpSlotMaterials {
  return {
    flash: createRocketJumpMaterial('flash'),
    core: createRocketJumpMaterial('core'),
    mid: createRocketJumpMaterial('mid'),
    outer: createRocketJumpMaterial('outer'),
    pressureShell: createRocketJumpMaterial('pressureShell'),
    heatCurtain: createRocketJumpMaterial('heatCurtain'),
    outerShockwave: createRocketJumpMaterial('outerShockwave'),
    innerShockwave: createRocketJumpMaterial('innerShockwave'),
    emberShockwave: createRocketJumpMaterial('emberShockwave'),
    smoke: ROCKET_JUMP_SMOKE_PUFFS.map(() => createRocketJumpMaterial('smoke')),
    sparks: ROCKET_JUMP_SPARKS.map(() => createRocketJumpMaterial('spark')),
    scorch: createRocketJumpMaterial('scorch'),
  };
}

function disposeRocketJumpSlotMaterials(materials: RocketJumpSlotMaterials): void {
  materials.flash.dispose();
  materials.core.dispose();
  materials.mid.dispose();
  materials.outer.dispose();
  materials.pressureShell.dispose();
  materials.heatCurtain.dispose();
  materials.outerShockwave.dispose();
  materials.innerShockwave.dispose();
  materials.emberShockwave.dispose();
  materials.scorch.dispose();
  materials.smoke.forEach((material) => material.dispose());
  materials.sparks.forEach((material) => material.dispose());
}

function createRocketJumpRenderSlot(): RocketJumpRenderSlot {
  return {
    group: null,
    flash: null,
    core: null,
    mid: null,
    outer: null,
    pressureShell: null,
    heatCurtain: null,
    outerShockwave: null,
    innerShockwave: null,
    emberShockwave: null,
    scorch: null,
    smoke: Array.from({ length: ROCKET_JUMP_SMOKE_PUFFS.length }, () => null),
    sparks: Array.from({ length: ROCKET_JUMP_SPARKS.length }, () => null),
    light: null,
    materials: createRocketJumpSlotMaterials(),
  };
}

function ensureRocketJumpRenderSlot(renderSlots: RocketJumpRenderSlot[], index: number): RocketJumpRenderSlot {
  let slot = renderSlots[index];
  if (!slot) {
    slot = createRocketJumpRenderSlot();
    renderSlots[index] = slot;
  }
  return slot;
}

let rocketJumpGpuPrewarmMaterials: THREE.MeshBasicMaterial[] | null = null;

function getRocketJumpGpuPrewarmMaterials(): THREE.MeshBasicMaterial[] {
  if (!rocketJumpGpuPrewarmMaterials) {
    rocketJumpGpuPrewarmMaterials = ROCKET_JUMP_PREWARM_MATERIAL_KINDS.map(createRocketJumpMaterial);
  }
  return rocketJumpGpuPrewarmMaterials;
}

export function prewarmRocketJumpExplosionResources(): void {
  getRocketJumpGpuPrewarmMaterials();
  void SHARED_GEOMETRIES.sphere8;
  void SHARED_GEOMETRIES.sphere16;
  void SHARED_GEOMETRIES.cylinderOpen16;
  void SHARED_GEOMETRIES.ring32;
  void SHARED_GEOMETRIES.ring24;
  void SHARED_GEOMETRIES.ring16;
  void SHARED_GEOMETRIES.circle16;
}

function addRocketJumpPrewarmMesh(
  target: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number] | number,
  rotation: [number, number, number] = [0, 0, 0]
): void {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'gpu-prewarm-rocket-jump-explosion';
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

export function appendRocketJumpExplosionGpuPrewarmObjects(target: THREE.Object3D): void {
  prewarmRocketJumpExplosionResources();
  const [
    flash,
    pressureShell,
    heatCurtain,
    outerShockwave,
    innerShockwave,
    emberShockwave,
    smoke,
    spark,
    scorch,
  ] = getRocketJumpGpuPrewarmMaterials();

  addRocketJumpPrewarmMesh(target, SHARED_GEOMETRIES.sphere8, flash, [0.42, -1.08, -4.35], 0.2);
  addRocketJumpPrewarmMesh(target, SHARED_GEOMETRIES.sphere16, pressureShell, [0.68, -1.08, -4.35], [0.28, 0.14, 0.28]);
  addRocketJumpPrewarmMesh(target, SHARED_GEOMETRIES.cylinderOpen16, heatCurtain, [0.98, -1.08, -4.35], [0.16, 0.42, 0.16]);
  addRocketJumpPrewarmMesh(target, SHARED_GEOMETRIES.ring32, outerShockwave, [1.28, -1.08, -4.35], [0.18, 0.18, 1], [-Math.PI / 2, 0, 0]);
  addRocketJumpPrewarmMesh(target, SHARED_GEOMETRIES.ring24, innerShockwave, [1.54, -1.08, -4.35], [0.16, 0.16, 1], [-Math.PI / 2, 0, 0]);
  addRocketJumpPrewarmMesh(target, SHARED_GEOMETRIES.ring16, emberShockwave, [1.78, -1.08, -4.35], [0.14, 0.14, 1], [-Math.PI / 2, 0, 0]);
  addRocketJumpPrewarmMesh(target, SHARED_GEOMETRIES.sphere8, smoke, [2.02, -1.08, -4.35], 0.18);
  addRocketJumpPrewarmMesh(target, SHARED_GEOMETRIES.sphere8, spark, [2.26, -1.08, -4.35], 0.08);
  addRocketJumpPrewarmMesh(target, SHARED_GEOMETRIES.circle16, scorch, [2.48, -1.08, -4.35], [0.18, 0.18, 1], [-Math.PI / 2, 0, 0]);
}

function hideRocketJumpSlot(slot: RocketJumpRenderSlot): void {
  if (slot.group) slot.group.visible = false;
  if (slot.light) slot.light.intensity = 0;
}

function pruneExpiredRocketJumpExplosions(now: number): void {
  for (let i = rocketJumpExplosions.length - 1; i >= 0; i--) {
    if (now - rocketJumpExplosions[i].frameStartTime >= ROCKET_JUMP_DURATION) {
      rocketJumpExplosions.splice(i, 1);
    }
  }
}

function updateRocketJumpSlot(
  slot: RocketJumpRenderSlot,
  explosion: RocketJumpExplosionData | undefined,
  now: number
): boolean {
  if (!explosion) {
    hideRocketJumpSlot(slot);
    return false;
  }

  const elapsed = now - explosion.frameStartTime;
  if (elapsed > ROCKET_JUMP_DURATION) {
    hideRocketJumpSlot(slot);
    return false;
  }

  const materials = slot.materials;
  const progress = elapsed / ROCKET_JUMP_DURATION;
  const easeOut = 1 - Math.pow(1 - progress, 2);
  const easeOutQuart = 1 - Math.pow(1 - progress, 4);
  const fadeOut = Math.max(0, 1 - progress * 1.1);
  const fadeOutSlow = Math.max(0, 1 - progress);
  const shockwaveFade = Math.max(0, 1 - progress * 1.35);

  if (slot.group) {
    slot.group.visible = true;
    slot.group.position.set(explosion.position.x, explosion.position.y - 0.3, explosion.position.z);
  }

  if (slot.flash) {
    const flashProgress = Math.min(1, elapsed / 110);
    const flashScale = 0.75 + flashProgress * 3.2;
    slot.flash.scale.setScalar(flashScale);
    materials.flash.opacity = Math.max(0, 1 - flashProgress * 1.75);
  }

  if (slot.core) {
    slot.core.scale.setScalar(0.55 + easeOut * 3.1);
    materials.core.opacity = fadeOut * 0.95;
  }
  if (slot.mid) {
    slot.mid.scale.setScalar(0.8 + easeOut * 3.8);
    materials.mid.opacity = fadeOut * 0.8;
  }
  if (slot.outer) {
    slot.outer.scale.setScalar(1 + easeOut * 4.8);
    materials.outer.opacity = fadeOut * 0.58;
  }

  if (slot.pressureShell) {
    const horizontalScale = 1.1 + easeOutQuart * 6.7;
    const verticalScale = 0.35 + easeOut * 1.85;
    slot.pressureShell.position.y = 0.55 + easeOut * 0.35;
    slot.pressureShell.scale.set(horizontalScale, verticalScale, horizontalScale);
    materials.pressureShell.opacity = shockwaveFade * 0.24;
  }
  if (slot.heatCurtain) {
    const radius = 0.7 + easeOutQuart * 8.8;
    slot.heatCurtain.position.y = 0.48 + easeOut * 0.42;
    slot.heatCurtain.scale.set(radius, 1.5 + easeOut * 1.1, radius);
    materials.heatCurtain.opacity = shockwaveFade * 0.3;
  }
  if (slot.outerShockwave) {
    const scale = 0.8 + easeOutQuart * 10.5;
    slot.outerShockwave.scale.set(scale, scale, 1);
    materials.outerShockwave.opacity = shockwaveFade * 0.9;
  }
  if (slot.innerShockwave) {
    const scale = 0.55 + easeOutQuart * 7.6;
    slot.innerShockwave.scale.set(scale, scale, 1);
    materials.innerShockwave.opacity = shockwaveFade * 0.72;
  }
  if (slot.emberShockwave) {
    const scale = 0.35 + easeOutQuart * 5.8;
    slot.emberShockwave.scale.set(scale, scale, 1);
    materials.emberShockwave.opacity = shockwaveFade * 0.62;
  }
  if (slot.scorch) {
    const scorchScale = 2.1 + easeOut * 1.8;
    slot.scorch.scale.set(scorchScale, scorchScale, 1);
    materials.scorch.opacity = fadeOutSlow * 0.48;
  }

  for (let i = 0; i < slot.smoke.length; i++) {
    const smoke = slot.smoke[i];
    if (!smoke) continue;

    const puff = ROCKET_JUMP_SMOKE_PUFFS[i];
    const smokeDelay = i * 38;
    const smokeElapsed = Math.max(0, elapsed - smokeDelay);
    const smokeProgress = Math.min(1, smokeElapsed / 700);
    const drift = smokeProgress * (0.28 + i * 0.04);
    const y = smokeProgress * puff.lift;
    const smokeScale = 0.42 + smokeProgress * (0.9 + i * 0.16);
    smoke.position.x = Math.cos(puff.angle) * (puff.radius + drift);
    smoke.position.z = Math.sin(puff.angle) * (puff.radius + drift);
    smoke.position.y = y;
    smoke.scale.setScalar(smokeScale);
    materials.smoke[i].opacity = Math.max(0, 0.45 - smokeProgress * 0.45);
  }

  const elapsedSeconds = elapsed / 1000;
  for (let i = 0; i < slot.sparks.length; i++) {
    const spark = slot.sparks[i];
    if (!spark) continue;

    const sparkConfig = ROCKET_JUMP_SPARKS[i];
    const sparkX = Math.cos(sparkConfig.angle) * sparkConfig.speed * elapsedSeconds;
    const sparkY = sparkConfig.ySpeed * elapsedSeconds - 15 * elapsedSeconds * elapsedSeconds;
    const sparkZ = Math.sin(sparkConfig.angle) * sparkConfig.speed * elapsedSeconds;
    spark.position.set(sparkX, Math.max(-0.3, sparkY), sparkZ);
    spark.scale.setScalar(sparkConfig.size * fadeOutSlow);
    materials.sparks[i].opacity = sparkY > 0 ? fadeOutSlow : 0;
  }

  if (slot.light) {
    slot.light.intensity = fadeOut * 36;
  }

  return true;
}

function updatePooledRocketJumpExplosions(renderSlots: RocketJumpRenderSlot[], now: number): number {
  pruneExpiredRocketJumpExplosions(now);
  let activeCount = 0;

  for (let i = 0; i < POOLED_ROCKET_JUMP_EXPLOSIONS; i++) {
    const slot = renderSlots[i];
    if (!slot) continue;
    if (updateRocketJumpSlot(slot, rocketJumpExplosions[i], now)) {
      activeCount++;
    }
  }

  return activeCount;
}

function PooledRocketJumpExplosionSlots({ renderSlots }: { renderSlots: RocketJumpRenderSlot[] }) {
  useEffect(() => () => {
    for (const slot of renderSlots) {
      disposeRocketJumpSlotMaterials(slot.materials);
    }
  }, [renderSlots]);

  return (
    <>
      {ROCKET_JUMP_SLOT_INDICES.map((slotIndex) => {
        const slot = ensureRocketJumpRenderSlot(renderSlots, slotIndex);
        return (
          <group key={slotIndex} ref={(el) => { slot.group = el; }} visible={false}>
            <mesh ref={(el) => { slot.flash = el; }} geometry={SHARED_GEOMETRIES.sphere8}>
              <primitive attach="material" object={slot.materials.flash} />
            </mesh>

            <mesh ref={(el) => { slot.core = el; }} geometry={SHARED_GEOMETRIES.sphere8}>
              <primitive attach="material" object={slot.materials.core} />
            </mesh>

            <mesh ref={(el) => { slot.mid = el; }} geometry={SHARED_GEOMETRIES.sphere8}>
              <primitive attach="material" object={slot.materials.mid} />
            </mesh>

            <mesh ref={(el) => { slot.outer = el; }} geometry={SHARED_GEOMETRIES.sphere8}>
              <primitive attach="material" object={slot.materials.outer} />
            </mesh>

            <mesh ref={(el) => { slot.pressureShell = el; }} geometry={SHARED_GEOMETRIES.sphere16}>
              <primitive attach="material" object={slot.materials.pressureShell} />
            </mesh>

            <mesh ref={(el) => { slot.heatCurtain = el; }} position-y={0.5} geometry={SHARED_GEOMETRIES.cylinderOpen16}>
              <primitive attach="material" object={slot.materials.heatCurtain} />
            </mesh>

            <mesh ref={(el) => { slot.outerShockwave = el; }} rotation-x={-Math.PI / 2} position-y={0.12} geometry={SHARED_GEOMETRIES.ring32}>
              <primitive attach="material" object={slot.materials.outerShockwave} />
            </mesh>
            <mesh ref={(el) => { slot.innerShockwave = el; }} rotation-x={-Math.PI / 2} position-y={0.2} geometry={SHARED_GEOMETRIES.ring24}>
              <primitive attach="material" object={slot.materials.innerShockwave} />
            </mesh>
            <mesh ref={(el) => { slot.emberShockwave = el; }} rotation-x={-Math.PI / 2} position-y={0.3} geometry={SHARED_GEOMETRIES.ring16}>
              <primitive attach="material" object={slot.materials.emberShockwave} />
            </mesh>

            {ROCKET_JUMP_SMOKE_PUFFS.map((puff, index) => (
              <mesh
                key={`smoke-${index}`}
                ref={(el) => { slot.smoke[index] = el; }}
                position={[Math.cos(puff.angle) * puff.radius, 0, Math.sin(puff.angle) * puff.radius]}
                geometry={SHARED_GEOMETRIES.sphere8}
              >
                <primitive attach="material" object={slot.materials.smoke[index]} />
              </mesh>
            ))}

            {ROCKET_JUMP_SPARKS.map((_, index) => (
              <mesh
                key={`spark-${index}`}
                ref={(el) => { slot.sparks[index] = el; }}
                geometry={SHARED_GEOMETRIES.sphere8}
              >
                <primitive attach="material" object={slot.materials.sparks[index]} />
              </mesh>
            ))}

            <mesh ref={(el) => { slot.scorch = el; }} rotation-x={-Math.PI / 2} position-y={0.02} geometry={SHARED_GEOMETRIES.circle16} scale={[2.1, 2.1, 1]}>
              <primitive attach="material" object={slot.materials.scorch} />
            </mesh>

            <BudgetedPointLight budgetPriority={7} ref={(el) => { slot.light = el; }} color={0xff6a00} intensity={0} distance={24} decay={2} />
          </group>
        );
      })}
    </>
  );
}

export function RocketJumpExplosions() {
  const renderSlotsRef = useRef<RocketJumpRenderSlot[]>([]);

  useFrame(() => {
    const runFrame = () => {
      const active = updatePooledRocketJumpExplosions(renderSlotsRef.current, getFrameClock().nowMs);
      if (MOVEMENT_DIAGNOSTICS_ENABLED) {
        recordEffectSlotDiagnostics('blazeRocketJumpExplosion', {
          active,
          capacity: POOLED_ROCKET_JUMP_EXPLOSIONS,
          hiddenMounted: POOLED_ROCKET_JUMP_EXPLOSIONS - active,
        });
      }
    };

    if (MOVEMENT_DIAGNOSTICS_ENABLED) {
      measureFrameWork('frame.effects.blazeRocketJumpExplosion', runFrame);
      return;
    }

    runFrame();
  });

  return <PooledRocketJumpExplosionSlots renderSlots={renderSlotsRef.current} />;
}
