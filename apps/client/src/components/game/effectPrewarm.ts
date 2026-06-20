import * as THREE from 'three';
import {
  HOOKSHOT_COLORS,
  SHARED_GEOMETRIES,
  getGlowMaterial,
  getHookshotMaterials,
  initializeEffectResources,
} from './effectResources';
import * as BlazeMaterials from './blaze/materials';
import {
  appendBlazeAirstrikeGpuPrewarmObjects,
  prewarmBlazeAirstrikeResources,
} from './blaze/airstrike';
import { prewarmRocketResources } from './blaze/rockets';
import {
  appendDireBallGpuPrewarmObjects,
  prewarmDireBallResources,
} from './phantom/direBall';
import { getRiftMaterial, getTrailMaterial } from './phantom/materials';
import {
  appendVoidRayGpuPrewarmObjects,
  prewarmVoidRayResources,
} from './phantom/voidRay';
import {
  appendVoidZoneGpuPrewarmObjects,
  prewarmVoidZoneResources,
} from './phantom/voidZone';
import {
  appendChronosPulseGpuPrewarmObjects,
  prewarmChronosPulseResources,
} from './chronos/verdantPulse';
import {
  appendChronosTimebreakGpuPrewarmObjects,
  prewarmChronosTimebreakResources,
} from './chronos/timebreak';
import { appendObservedCastGpuPrewarmObjects } from './ObservedAbilityCastEffects';
import {
  HEAVY_HOOK_MAIN_ROPE_MATERIAL,
  HOOK_MAIN_ROPE_MATERIAL,
} from './hookshot/rope';
import {
  getRagdollGpuPrewarmMaterials,
  prewarmRagdollRenderResources,
} from './RagdollManager';
import {
  getHeroViewmodelGpuPrewarmMaterials,
  prewarmHeroViewmodelResources,
} from './heroViewmodelMaterials';

export interface GameplayEffectGpuPrewarmBundle {
  scene: THREE.Scene;
  camera: THREE.Camera;
}

let gameplayEffectGpuPrewarmBundle: GameplayEffectGpuPrewarmBundle | null = null;

export async function prewarmPhantomEffects(): Promise<void> {
  initializeEffectResources();
  getRiftMaterial();
  getTrailMaterial();
  prewarmDireBallResources();
  prewarmVoidRayResources();
  prewarmVoidZoneResources();
}

export async function prewarmBlazeEffects(): Promise<void> {
  initializeEffectResources();
  BlazeMaterials.prewarmBlazeMaterials();
  prewarmRocketResources();
  prewarmBlazeAirstrikeResources();
}

export async function prewarmHookshotEffects(): Promise<void> {
  initializeEffectResources();
  getHookshotMaterials();
}

export async function prewarmChronosEffects(): Promise<void> {
  initializeEffectResources();
  prewarmChronosPulseResources();
  prewarmChronosTimebreakResources();
}

export async function prewarmGameplayEffectResources(): Promise<void> {
  await Promise.all([
    prewarmPhantomEffects(),
    prewarmBlazeEffects(),
    prewarmHookshotEffects(),
    prewarmChronosEffects(),
  ]);
  prewarmHeroViewmodelResources();
  prewarmRagdollRenderResources();
}

function addMesh(
  target: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number] | number = 1,
  rotation: [number, number, number] = [0, 0, 0]
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'gpu-prewarm-mesh';
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  if (typeof scale === 'number') {
    mesh.scale.setScalar(scale);
  } else {
    mesh.scale.set(...scale);
  }
  mesh.frustumCulled = false;
  target.add(mesh);
  return mesh;
}

function addInstancedMesh(
  target: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  scale: number,
  name: string
): void {
  const mesh = new THREE.InstancedMesh(geometry, material, 1);
  const dummy = new THREE.Object3D();
  dummy.position.set(...position);
  dummy.scale.setScalar(scale);
  dummy.updateMatrix();
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.setMatrixAt(0, dummy.matrix);
  mesh.instanceMatrix.needsUpdate = true;
  target.add(mesh);
}

function addMaterialSwatches(
  target: THREE.Object3D,
  materials: THREE.Material[],
  y: number,
  z: number
): void {
  const geometries = [
    SHARED_GEOMETRIES.box,
    SHARED_GEOMETRIES.sphere8,
    SHARED_GEOMETRIES.cylinder8,
    SHARED_GEOMETRIES.cone8,
    SHARED_GEOMETRIES.ring16,
    SHARED_GEOMETRIES.plane,
  ];

  materials.forEach((material, index) => {
    const x = -2.4 + (index % 12) * 0.42;
    const row = Math.floor(index / 12);
    addMesh(
      target,
      geometries[index % geometries.length],
      material,
      [x, y - row * 0.42, z],
      index % geometries.length === 4 ? [0.18, 0.18, 0.18] : 0.18,
      index % geometries.length === 4 ? [-Math.PI / 2, 0, 0] : [0, 0, 0]
    );
  });
}

function createRepresentativeHookshotMaterials(): THREE.Material[] {
  return [
    new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.9, roughness: 0.2 }),
    new THREE.MeshStandardMaterial({ color: 0x59616d, metalness: 0.72, roughness: 0.55 }),
    new THREE.MeshBasicMaterial({
      color: HOOKSHOT_COLORS.energy,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
    new THREE.MeshBasicMaterial({
      color: HOOKSHOT_COLORS.energyGlow,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  ];
}

function createRepresentativeChronosMaterials(): THREE.Material[] {
  return [
    new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
    new THREE.MeshBasicMaterial({
      color: 0x86efac,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      wireframe: true,
      toneMapped: false,
    }),
    new THREE.MeshBasicMaterial({
      color: 0x13f76d,
      transparent: true,
      opacity: 0.24,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  ];
}

function createRepresentativeGlobalEffectMaterials(): THREE.Material[] {
  return [
    new THREE.LineBasicMaterial({ color: 0x00ff88 }),
    new THREE.MeshBasicMaterial({ color: 0xff6b35, transparent: true, opacity: 0.85 }),
    new THREE.MeshBasicMaterial({
      color: 0xbbf7d0,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
    new THREE.PointsMaterial({
      color: 0xc084fc,
      size: 0.12,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    }),
  ];
}

function createPrewarmCamera(): THREE.Camera {
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 24);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -4);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function addBlazeGpuPrewarmObjects(scene: THREE.Scene): void {
  const materials = [
    BlazeMaterials.getBombBodyMaterial(),
    BlazeMaterials.getBombBandMaterial(),
    BlazeMaterials.getBombNoseMaterial(),
    BlazeMaterials.getBombFinMaterial(),
    BlazeMaterials.getBombStripeMaterial(),
    BlazeMaterials.getBombTrailMaterial(),
    BlazeMaterials.getBombGlowMaterial(),
    BlazeMaterials.getWarningOuterRingMaterial(),
    BlazeMaterials.getWarningInnerRingMaterial(),
    BlazeMaterials.getWarningCenterRingMaterial(),
    BlazeMaterials.getWarningCrossMainMaterial(),
    BlazeMaterials.getWarningCrossDiagMaterial(),
    BlazeMaterials.getWarningPulseFillMaterial(),
    BlazeMaterials.getExplosionFlashMaterial(),
    BlazeMaterials.getExplosionWhiteMaterial(),
    BlazeMaterials.getExplosionYellowMaterial(),
    BlazeMaterials.getExplosionOrangeMaterial(),
    BlazeMaterials.getExplosionRedMaterial(),
    BlazeMaterials.getExplosionDarkRedMaterial(),
    BlazeMaterials.getExplosionSmokeDarkMaterial(),
    BlazeMaterials.getExplosionSmokeLightMaterial(),
    BlazeMaterials.getExplosionDebrisOrangeMaterial(),
    BlazeMaterials.getExplosionDebrisYellowMaterial(),
    BlazeMaterials.getShockwaveOuterMaterial(),
    BlazeMaterials.getShockwaveInnerMaterial(),
    BlazeMaterials.getTargetRing1Material(),
    BlazeMaterials.getTargetRing2Material(),
    BlazeMaterials.getTargetRing3Material(),
    BlazeMaterials.getTargetCenterMaterial(),
    BlazeMaterials.getTargetFillMaterial(),
    BlazeMaterials.getTargetCrossMaterial(),
    BlazeMaterials.getTargetBeamMaterial(),
    BlazeMaterials.getTargetBeamTopMaterial(),
  ];

  addMaterialSwatches(scene, materials, -1.35, -5.4);
  appendBlazeAirstrikeGpuPrewarmObjects(scene);
  addInstancedMesh(scene, SHARED_GEOMETRIES.sphere8, BlazeMaterials.getFireballCoreMaterial(), [-0.7, -0.65, -4.2], 0.22, 'gpu-prewarm-blaze-fireball-core');
  addInstancedMesh(scene, SHARED_GEOMETRIES.sphere12, BlazeMaterials.getFireballOuterMaterial(), [-0.35, -0.65, -4.2], 0.28, 'gpu-prewarm-blaze-fireball-outer');
  addInstancedMesh(scene, SHARED_GEOMETRIES.cylinder8, BlazeMaterials.getFireballTrailOuterMaterial(), [0, -0.65, -4.2], 0.26, 'gpu-prewarm-blaze-fireball-trail');
}

function addHookshotGpuPrewarmObjects(scene: THREE.Scene): void {
  const hookMaterials = getHookshotMaterials();
  addMaterialSwatches(scene, [
    hookMaterials.ring,
    hookMaterials.shaft,
    hookMaterials.crown,
    hookMaterials.fluke,
    hookMaterials.tip,
    hookMaterials.glow,
    hookMaterials.ropeMain,
    hookMaterials.ropeGlow,
    hookMaterials.ropeCore,
    hookMaterials.heavyChainMain,
    hookMaterials.heavyChainOuter,
    hookMaterials.heavyChainCore,
    hookMaterials.heavyChainMegaGlow,
    HOOK_MAIN_ROPE_MATERIAL,
    HEAVY_HOOK_MAIN_ROPE_MATERIAL,
    ...createRepresentativeHookshotMaterials(),
  ], 1.6, -5.2);
}

function addChronosGpuPrewarmObjects(scene: THREE.Scene): void {
  appendChronosPulseGpuPrewarmObjects(scene);
  appendChronosTimebreakGpuPrewarmObjects(scene);
  addMaterialSwatches(scene, createRepresentativeChronosMaterials(), 0.9, -5.6);
}

function addPhantomGpuPrewarmObjects(scene: THREE.Scene): void {
  appendDireBallGpuPrewarmObjects(scene);
  appendVoidRayGpuPrewarmObjects(scene);
  appendVoidZoneGpuPrewarmObjects(scene);
  addMesh(scene, SHARED_GEOMETRIES.circle32, getRiftMaterial(), [-1.95, 0.68, -4.4], [0.35, 0.35, 0.35], [-Math.PI / 2, 0, 0]);
  addMesh(scene, SHARED_GEOMETRIES.cylinderOpen16, getTrailMaterial(), [-1.55, 0.68, -4.4], [0.16, 0.6, 0.16]);
  addMesh(scene, SHARED_GEOMETRIES.sphere8, getGlowMaterial(0x7c3aed, 0.5), [-1.15, 0.68, -4.4], 0.22);
}

function addGlobalEffectGpuPrewarmObjects(scene: THREE.Scene): void {
  const [lineMaterial, explosionMaterial, lifelineMaterial, pointsMaterial] = createRepresentativeGlobalEffectMaterials();
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.4, 0.25, -4.6,
    0.4, 0.25, -4.6,
  ]), 3));
  const line = new THREE.Line(lineGeometry, lineMaterial);
  line.frustumCulled = false;
  scene.add(line);

  addInstancedMesh(scene, SHARED_GEOMETRIES.box, explosionMaterial, [0.85, 0.25, -4.6], 0.16, 'gpu-prewarm-global-explosion');
  addMesh(scene, SHARED_GEOMETRIES.cylinder8, lifelineMaterial, [1.2, 0.25, -4.6], [0.12, 0.55, 0.12]);
  appendObservedCastGpuPrewarmObjects(scene);

  const pointsGeometry = new THREE.BufferGeometry();
  pointsGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    1.55, 0.25, -4.6,
    1.68, 0.36, -4.72,
    1.42, 0.18, -4.52,
  ]), 3));
  scene.add(new THREE.Points(pointsGeometry, pointsMaterial));
}

function addRagdollGpuPrewarmObjects(scene: THREE.Scene): void {
  addMaterialSwatches(scene, getRagdollGpuPrewarmMaterials(), -2.45, -5.8);
}

function addViewmodelGpuPrewarmObjects(scene: THREE.Scene): void {
  addMaterialSwatches(scene, getHeroViewmodelGpuPrewarmMaterials(), 2.42, -5.85);
}

export function getGameplayEffectGpuPrewarmBundle(): GameplayEffectGpuPrewarmBundle {
  if (gameplayEffectGpuPrewarmBundle) return gameplayEffectGpuPrewarmBundle;

  void prewarmGameplayEffectResources();

  const scene = new THREE.Scene();
  scene.name = 'gameplay-effect-gpu-prewarm-scene';
  scene.background = new THREE.Color(0x050505);
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  scene.add(new THREE.HemisphereLight(0xdbeafe, 0x1f2937, 1.2));
  const directionalLight = new THREE.DirectionalLight(0xffffff, 2.4);
  directionalLight.position.set(2.5, 4, 3);
  scene.add(directionalLight);
  const pointLight = new THREE.PointLight(0x7dd3fc, 3, 8, 2);
  pointLight.position.set(0, 1.2, -3);
  scene.add(pointLight);

  addPhantomGpuPrewarmObjects(scene);
  addBlazeGpuPrewarmObjects(scene);
  addHookshotGpuPrewarmObjects(scene);
  addChronosGpuPrewarmObjects(scene);
  addGlobalEffectGpuPrewarmObjects(scene);
  addRagdollGpuPrewarmObjects(scene);
  addViewmodelGpuPrewarmObjects(scene);

  const camera = createPrewarmCamera();
  scene.updateMatrixWorld(true);
  gameplayEffectGpuPrewarmBundle = { scene, camera };
  return gameplayEffectGpuPrewarmBundle;
}
