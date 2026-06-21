import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  getBlockId,
  isSolidBlock,
  type VoxelBlockId,
  type VoxelChunk,
  type VoxelMapManifest,
  type VoxelMapTheme,
} from '@voxel-strike/shared';

interface SurfaceCell {
  x: number;
  y: number;
  z: number;
  blockId: VoxelBlockId;
}

interface DressingInstance {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

interface DressingPalette {
  tuft: string;
  pebble: string;
  crystal: string;
  crystalEmissive: string;
}

interface DressingSet {
  tufts: DressingInstance[];
  pebbles: DressingInstance[];
  crystals: DressingInstance[];
}

interface CachedDressingSet {
  dressing: DressingSet;
  instanceCount: number;
  lastUsedAt: number;
}

interface ProtectedSurfaceZone {
  x: number;
  z: number;
  radiusSq: number;
}

const MAX_TUFTS = 520;
const MAX_PEBBLES = 260;
const MAX_CRYSTALS = 140;

const DRESSING_GEOMETRIES = {
  tuft: new THREE.ConeGeometry(1, 1, 5),
  pebble: new THREE.DodecahedronGeometry(1, 0),
  crystal: new THREE.OctahedronGeometry(1, 0),
};

const dressingMatrixDummy = new THREE.Object3D();
const dressingSetCache = new Map<string, CachedDressingSet>();
const DRESSING_SET_CACHE_MAX_ENTRIES = 8;
const DRESSING_SET_CACHE_MAX_INSTANCES = 5200;
const DRESSING_CULL_UPDATE_INTERVAL_SECONDS = 0.2;
const DRESSING_CULL_CAMERA_MOVE_EPSILON_SQ = 1.6 * 1.6;
let dressingSetCacheInstances = 0;

function chunkIndex(x: number, y: number, z: number, chunk: VoxelChunk): number {
  return x + chunk.size.x * (z + chunk.size.z * y);
}

function chunkLookupIndex(x: number, y: number, z: number, chunksX: number, chunksZ: number): number {
  return x + chunksX * (z + chunksZ * y);
}

function hashCell(seed: number, x: number, z: number, salt: number): number {
  let h = Math.imul((seed >>> 0) ^ Math.imul(x + salt, 374761393) ^ Math.imul(z - salt, 668265263), 1274126177);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 0xffffffff;
}

function distanceSq(xA: number, zA: number, xB: number, zB: number): number {
  const dx = xA - xB;
  const dz = zA - zB;
  return dx * dx + dz * dz;
}

function getTopSurfaces(manifest: VoxelMapManifest): (SurfaceCell | null)[] {
  if (manifest.heightfield?.topSolidRows?.length) {
    return getTopSurfacesFromHeightfield(manifest);
  }

  const surfaces = new Array<SurfaceCell | null>(manifest.size.x * manifest.size.z).fill(null);

  for (const chunk of manifest.chunks) {
    const originX = chunk.coord.x * manifest.chunkSize.x;
    const originY = chunk.coord.y * manifest.chunkSize.y;
    const originZ = chunk.coord.z * manifest.chunkSize.z;

    for (let y = 0; y < chunk.size.y; y++) {
      for (let z = 0; z < chunk.size.z; z++) {
        for (let x = 0; x < chunk.size.x; x++) {
          const block = chunk.blocks[chunkIndex(x, y, z, chunk)];
          if (!isSolidBlock(block)) continue;

          const globalX = originX + x;
          const globalY = originY + y;
          const globalZ = originZ + z;
          const surfaceIndex = globalX + globalZ * manifest.size.x;
          const current = surfaces[surfaceIndex];

          if (!current || globalY > current.y) {
            surfaces[surfaceIndex] = {
              x: globalX,
              y: globalY,
              z: globalZ,
              blockId: getBlockId(block),
            };
          }
        }
      }
    }
  }

  return surfaces;
}

function getTopSurfacesFromHeightfield(manifest: VoxelMapManifest): (SurfaceCell | null)[] {
  const surfaces = new Array<SurfaceCell | null>(manifest.size.x * manifest.size.z).fill(null);
  const chunksX = Math.ceil(manifest.size.x / manifest.chunkSize.x);
  const chunksZ = Math.ceil(manifest.size.z / manifest.chunkSize.z);
  const chunks = new Map<number, VoxelChunk>();

  for (const chunk of manifest.chunks) {
    chunks.set(chunkLookupIndex(chunk.coord.x, chunk.coord.y, chunk.coord.z, chunksX, chunksZ), chunk);
  }

  const getBlock = (gx: number, gy: number, gz: number): number => {
    if (gx < 0 || gx >= manifest.size.x || gy < 0 || gy >= manifest.size.y || gz < 0 || gz >= manifest.size.z) {
      return 0;
    }

    const cx = Math.floor(gx / manifest.chunkSize.x);
    const cy = Math.floor(gy / manifest.chunkSize.y);
    const cz = Math.floor(gz / manifest.chunkSize.z);
    const chunk = chunks.get(chunkLookupIndex(cx, cy, cz, chunksX, chunksZ));
    if (!chunk) return 0;

    return chunk.blocks[
      chunkIndex(
        gx - cx * manifest.chunkSize.x,
        gy - cy * manifest.chunkSize.y,
        gz - cz * manifest.chunkSize.z,
        chunk
      )
    ] ?? 0;
  };

  for (let z = 0; z < manifest.heightfield.size.z; z++) {
    for (let x = 0; x < manifest.heightfield.size.x; x++) {
      const topRow = manifest.heightfield.topSolidRows[x + z * manifest.heightfield.size.x];
      if (topRow === 0) continue;

      const block = getBlock(x, topRow - 1, z);
      if (!isSolidBlock(block)) continue;

      surfaces[x + z * manifest.size.x] = {
        x,
        y: topRow - 1,
        z,
        blockId: getBlockId(block),
      };
    }
  }

  return surfaces;
}

function worldPositionForSurface(
  manifest: VoxelMapManifest,
  surface: SurfaceCell,
  jitterX: number,
  jitterZ: number
): [number, number, number] {
  return [
    manifest.origin.x + (surface.x + 0.5) * manifest.voxelSize.x + jitterX,
    manifest.origin.y + (surface.y + 1) * manifest.voxelSize.y,
    manifest.origin.z + (surface.z + 0.5) * manifest.voxelSize.z + jitterZ,
  ];
}

function createProtectedSurfaceZones(manifest: VoxelMapManifest): ProtectedSurfaceZone[] {
  const spawnZones = Object.values(manifest.spawnPoints).flatMap((spawnPoints) => (
    spawnPoints.map((spawn) => ({ x: spawn.x, z: spawn.z, radiusSq: 5.8 ** 2 }))
  ));

  return [
    { x: manifest.flagZones.red.x, z: manifest.flagZones.red.z, radiusSq: 7.5 ** 2 },
    { x: manifest.flagZones.blue.x, z: manifest.flagZones.blue.z, radiusSq: 7.5 ** 2 },
    ...spawnZones,
  ];
}

function isProtectedSurface(zones: ProtectedSurfaceZone[], worldX: number, worldZ: number): boolean {
  for (const zone of zones) {
    if (distanceSq(worldX, worldZ, zone.x, zone.z) < zone.radiusSq) return true;
  }

  return false;
}

function isNaturalSurface(blockId: VoxelBlockId): boolean {
  return (
    blockId === 'grass' ||
    blockId === 'dirt' ||
    blockId === 'stone' ||
    blockId === 'sand' ||
    blockId === 'snow' ||
    blockId === 'ice' ||
    blockId === 'ash' ||
    blockId === 'obsidian' ||
    blockId === 'moss' ||
    blockId === 'gold' ||
    blockId === 'gold_ore' ||
    blockId === 'gold_panel'
  );
}

function getDressingPalette(theme: VoxelMapTheme): DressingPalette {
  if (theme.skyVariantId === 'late_day') {
    return {
      tuft: '#79b85f',
      pebble: '#7f786c',
      crystal: '#ffc66f',
      crystalEmissive: '#ffd98a',
    };
  }

  if (theme.id === 'golden') {
    return {
      tuft: '#d9b956',
      pebble: '#a67932',
      crystal: '#fff0a6',
      crystalEmissive: '#fff36b',
    };
  }

  if (theme.id === 'desert') {
    return {
      tuft: '#b7a75a',
      pebble: '#a5764d',
      crystal: '#7ee8dd',
      crystalEmissive: '#3beed8',
    };
  }

  if (theme.id === 'frost') {
    return {
      tuft: '#94d1c7',
      pebble: '#8aa6b5',
      crystal: '#d6fbff',
      crystalEmissive: '#9cf7ff',
    };
  }

  if (theme.id === 'basalt') {
    return {
      tuft: '#4f7f6f',
      pebble: '#515a64',
      crystal: '#64f5d2',
      crystalEmissive: '#45ffd2',
    };
  }

  if (theme.id === 'crystal') {
    return {
      tuft: '#77b978',
      pebble: '#7b7596',
      crystal: '#d1a8ff',
      crystalEmissive: '#ff9df2',
    };
  }

  if (theme.id === 'volcanic') {
    return {
      tuft: '#7f6b4f',
      pebble: '#252127',
      crystal: '#ff7b39',
      crystalEmissive: '#ff4a1f',
    };
  }

  if (theme.id === 'sakura') {
    return {
      tuft: '#7fbd6e',
      pebble: '#8a7b78',
      crystal: '#ffd2e5',
      crystalEmissive: '#ff8fbd',
    };
  }

  return {
    tuft: '#58b957',
    pebble: '#737b80',
    crystal: '#7bdfff',
    crystalEmissive: '#ffe076',
  };
}

function getBiomeDensities(theme: VoxelMapTheme): { tuft: number; pebble: number; crystal: number } {
  if (theme.skyVariantId === 'late_day') {
    return { tuft: 0.058, pebble: 0.025, crystal: 0.018 };
  }

  if (theme.id === 'golden') {
    return { tuft: 0.018, pebble: 0.028, crystal: 0.034 };
  }

  if (theme.id === 'desert') {
    return { tuft: 0.024, pebble: 0.04, crystal: 0.008 };
  }

  if (theme.id === 'frost') {
    return { tuft: 0.016, pebble: 0.028, crystal: 0.024 };
  }

  if (theme.id === 'basalt') {
    return { tuft: 0.01, pebble: 0.046, crystal: 0.018 };
  }

  if (theme.id === 'crystal') {
    return { tuft: 0.026, pebble: 0.024, crystal: 0.035 };
  }

  if (theme.id === 'volcanic') {
    return { tuft: 0.006, pebble: 0.052, crystal: 0.022 };
  }

  if (theme.id === 'sakura') {
    return { tuft: 0.04, pebble: 0.02, crystal: 0.012 };
  }

  return { tuft: 0.048, pebble: 0.022, crystal: 0.01 };
}

function createDressingSet(manifest: VoxelMapManifest, densityScale: number, maxInstances = Number.POSITIVE_INFINITY): DressingSet {
  if (densityScale <= 0) {
    return { tufts: [], pebbles: [], crystals: [] };
  }

  const safeDensityScale = Math.min(1.35, Math.max(0, densityScale));
  const safeMaxInstances = Math.max(0, Math.floor(maxInstances));
  const maxTufts = Math.min(Math.round(MAX_TUFTS * safeDensityScale), Math.ceil(safeMaxInstances * 0.58));
  const maxPebbles = Math.min(Math.round(MAX_PEBBLES * safeDensityScale), Math.ceil(safeMaxInstances * 0.28));
  const maxCrystals = Math.min(Math.round(MAX_CRYSTALS * safeDensityScale), Math.ceil(safeMaxInstances * 0.14));
  const surfaces = getTopSurfaces(manifest);
  const protectedZones = createProtectedSurfaceZones(manifest);
  const densities = getBiomeDensities(manifest.theme);
  const tufts: DressingInstance[] = [];
  const pebbles: DressingInstance[] = [];
  const crystals: DressingInstance[] = [];

  scan:
  for (let z = 2; z < manifest.size.z - 2; z += 2) {
    for (let x = 2; x < manifest.size.x - 2; x += 2) {
      const surface = surfaces[x + z * manifest.size.x];
      if (!surface || !isNaturalSurface(surface.blockId)) continue;
      if (
        tufts.length + pebbles.length + crystals.length >= safeMaxInstances ||
        (tufts.length >= maxTufts && pebbles.length >= maxPebbles && crystals.length >= maxCrystals)
      ) {
        break scan;
      }

      const jitterX = (hashCell(manifest.seed, x, z, 0x51) - 0.5) * manifest.voxelSize.x * 0.7;
      const jitterZ = (hashCell(manifest.seed, x, z, 0x7a) - 0.5) * manifest.voxelSize.z * 0.7;
      const [worldX, worldY, worldZ] = worldPositionForSurface(manifest, surface, jitterX, jitterZ);
      if (isProtectedSurface(protectedZones, worldX, worldZ)) continue;

      const rotationY = hashCell(manifest.seed, x, z, 0xa11) * Math.PI * 2;
      const tuftRoll = hashCell(manifest.seed, x, z, 0x7475);
      const pebbleRoll = hashCell(manifest.seed, x, z, 0xbeef);
      const crystalRoll = hashCell(manifest.seed, x, z, 0xc275);

      if (tufts.length < maxTufts && surface.blockId !== 'stone' && tuftRoll < densities.tuft * safeDensityScale) {
        const height = 0.24 + hashCell(manifest.seed, x, z, 0x77) * 0.28;
        const radius = 0.055 + hashCell(manifest.seed, x, z, 0x78) * 0.045;
        tufts.push({
          position: [worldX, worldY + height * 0.5 - 0.01, worldZ],
          rotation: [0, rotationY, (hashCell(manifest.seed, x, z, 0x79) - 0.5) * 0.18],
          scale: [radius, height, radius],
        });
      }

      if (pebbles.length < maxPebbles && pebbleRoll < densities.pebble * safeDensityScale) {
        const radius = 0.07 + hashCell(manifest.seed, x, z, 0x91) * 0.12;
        pebbles.push({
          position: [worldX, worldY + radius * 0.42, worldZ],
          rotation: [
            (hashCell(manifest.seed, x, z, 0x92) - 0.5) * 0.55,
            rotationY,
            (hashCell(manifest.seed, x, z, 0x93) - 0.5) * 0.55,
          ],
          scale: [radius * 1.2, radius * 0.62, radius],
        });
      }

      if (
        crystals.length < maxCrystals &&
        (surface.blockId === 'stone' ||
          surface.blockId === 'obsidian' ||
          manifest.theme.id === 'crystal' ||
          manifest.theme.id === 'frost' ||
          manifest.theme.id === 'volcanic') &&
        crystalRoll < densities.crystal * safeDensityScale
      ) {
        const height = 0.18 + hashCell(manifest.seed, x, z, 0xd1) * 0.34;
        const radius = 0.045 + hashCell(manifest.seed, x, z, 0xd2) * 0.055;
        crystals.push({
          position: [worldX, worldY + height * 0.5, worldZ],
          rotation: [
            (hashCell(manifest.seed, x, z, 0xd3) - 0.5) * 0.35,
            rotationY,
            (hashCell(manifest.seed, x, z, 0xd4) - 0.5) * 0.35,
          ],
          scale: [radius, height, radius],
        });
      }
    }
  }

  return { tufts, pebbles, crystals };
}

function getCachedDressingSet(
  manifest: VoxelMapManifest,
  densityScale: number,
  maxInstances = Number.POSITIVE_INFINITY
): DressingSet {
  const cacheKey = `${manifest.id}:${densityScale.toFixed(3)}:${Number.isFinite(maxInstances) ? Math.floor(maxInstances) : 'inf'}`;
  const cached = dressingSetCache.get(cacheKey);
  if (cached) {
    cached.lastUsedAt = performance.now();
    return cached.dressing;
  }

  const dressing = createDressingSet(manifest, densityScale, maxInstances);
  const instanceCount = dressing.tufts.length + dressing.pebbles.length + dressing.crystals.length;

  dressingSetCache.set(cacheKey, {
    dressing,
    instanceCount,
    lastUsedAt: performance.now(),
  });
  dressingSetCacheInstances += instanceCount;
  enforceDressingSetCacheBudget(cacheKey);
  return dressing;
}

function enforceDressingSetCacheBudget(activeCacheKey: string): void {
  if (
    dressingSetCache.size <= DRESSING_SET_CACHE_MAX_ENTRIES &&
    dressingSetCacheInstances <= DRESSING_SET_CACHE_MAX_INSTANCES
  ) {
    return;
  }

  while (
    dressingSetCache.size > DRESSING_SET_CACHE_MAX_ENTRIES ||
    dressingSetCacheInstances > DRESSING_SET_CACHE_MAX_INSTANCES
  ) {
    let oldestCacheKey: string | null = null;
    let oldestEntry: CachedDressingSet | null = null;

    for (const [cacheKey, entry] of dressingSetCache) {
      if (cacheKey === activeCacheKey) continue;
      if (!oldestEntry || entry.lastUsedAt < oldestEntry.lastUsedAt) {
        oldestCacheKey = cacheKey;
        oldestEntry = entry;
      }
    }

    if (!oldestCacheKey || !oldestEntry) return;
    dressingSetCache.delete(oldestCacheKey);
    dressingSetCacheInstances = Math.max(0, dressingSetCacheInstances - oldestEntry.instanceCount);
  }
}

function writeDressingInstanceMatrix(mesh: THREE.InstancedMesh, instance: DressingInstance, index: number): void {
  const { position, rotation, scale } = instance;
  dressingMatrixDummy.position.set(position[0], position[1], position[2]);
  dressingMatrixDummy.rotation.set(rotation[0], rotation[1], rotation[2]);
  dressingMatrixDummy.scale.set(scale[0], scale[1], scale[2]);
  dressingMatrixDummy.updateMatrix();
  mesh.setMatrixAt(index, dressingMatrixDummy.matrix);
}

function writeVisibleDressingMatrices(
  mesh: THREE.InstancedMesh,
  instances: DressingInstance[],
  cameraPosition: THREE.Vector3,
  maxRenderDistance: number
): number {
  let writeIndex = 0;
  const maxRenderDistanceSq = Number.isFinite(maxRenderDistance)
    ? maxRenderDistance * maxRenderDistance
    : Number.POSITIVE_INFINITY;

  for (const instance of instances) {
    if (Number.isFinite(maxRenderDistanceSq)) {
      const position = instance.position;
      const dx = position[0] - cameraPosition.x;
      const dz = position[2] - cameraPosition.z;
      if (dx * dx + dz * dz > maxRenderDistanceSq) continue;
    }
    writeDressingInstanceMatrix(mesh, instance, writeIndex++);
  }

  mesh.count = writeIndex;
  mesh.instanceMatrix.needsUpdate = true;
  return writeIndex;
}

function useInstancedMatrices(
  ref: RefObject<THREE.InstancedMesh>,
  instances: DressingInstance[],
  maxRenderDistance = Number.POSITIVE_INFINITY
): void {
  const { camera } = useThree();
  const cullAccumulatorRef = useRef(0);
  const visibleCountRef = useRef(-1);
  const lastCullCameraXRef = useRef(Number.NaN);
  const lastCullCameraZRef = useRef(Number.NaN);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;

    mesh.instanceMatrix.setUsage(Number.isFinite(maxRenderDistance) ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
    visibleCountRef.current = writeVisibleDressingMatrices(mesh, instances, camera.position, maxRenderDistance);
    lastCullCameraXRef.current = camera.position.x;
    lastCullCameraZRef.current = camera.position.z;
    if (!Number.isFinite(maxRenderDistance)) {
      mesh.count = instances.length;
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [camera, instances, maxRenderDistance, ref]);

  useFrame((_, delta) => {
    if (!Number.isFinite(maxRenderDistance)) return;
    const mesh = ref.current;
    if (!mesh) return;

    cullAccumulatorRef.current += delta;
    if (
      cullAccumulatorRef.current < DRESSING_CULL_UPDATE_INTERVAL_SECONDS &&
      visibleCountRef.current >= 0
    ) {
      return;
    }

    const dx = camera.position.x - lastCullCameraXRef.current;
    const dz = camera.position.z - lastCullCameraZRef.current;
    if (
      Number.isFinite(lastCullCameraXRef.current) &&
      dx * dx + dz * dz < DRESSING_CULL_CAMERA_MOVE_EPSILON_SQ
    ) {
      cullAccumulatorRef.current = 0;
      return;
    }

    cullAccumulatorRef.current = 0;
    lastCullCameraXRef.current = camera.position.x;
    lastCullCameraZRef.current = camera.position.z;
    visibleCountRef.current = writeVisibleDressingMatrices(mesh, instances, camera.position, maxRenderDistance);
  });
}

function InstancedDressingMesh({
  name,
  instances,
  geometry,
  material,
  maxRenderDistance,
  castShadow = false,
  receiveShadow = false,
}: {
  name: string;
  instances: DressingInstance[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  maxRenderDistance?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useInstancedMatrices(ref, instances, maxRenderDistance);

  if (instances.length === 0) return null;

  return (
    <instancedMesh
      ref={ref}
      name={name}
      args={[geometry, material, instances.length]}
      frustumCulled={!Number.isFinite(maxRenderDistance)}
      matrixAutoUpdate={false}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  );
}

export function WorldDressing({
  manifest,
  densityScale,
  maxInstances,
  maxRenderDistance,
  shadowsEnabled,
  reflectionIntensity,
}: {
  manifest: VoxelMapManifest;
  densityScale: number;
  maxInstances?: number;
  maxRenderDistance?: number;
  shadowsEnabled: boolean;
  reflectionIntensity: number;
}) {
  const palette = useMemo(() => getDressingPalette(manifest.theme), [manifest.theme]);
  const dressing = useMemo(() => getCachedDressingSet(manifest, densityScale, maxInstances), [densityScale, manifest, maxInstances]);
  const resources = useMemo(() => {
    const tuftMaterial = new THREE.MeshStandardMaterial({
      color: palette.tuft,
      roughness: 0.96,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const pebbleMaterial = new THREE.MeshStandardMaterial({
      color: palette.pebble,
      roughness: 0.88,
      metalness: 0.04,
    });
    const crystalMaterial = new THREE.MeshStandardMaterial({
      color: palette.crystal,
      emissive: palette.crystalEmissive,
      emissiveIntensity: 0.55,
      roughness: 0.2,
      metalness: 0.04,
    });

    tuftMaterial.envMapIntensity = reflectionIntensity * 0.15;
    pebbleMaterial.envMapIntensity = reflectionIntensity * 0.45;
    crystalMaterial.envMapIntensity = reflectionIntensity * 1.15;

    return {
      tuftMaterial,
      pebbleMaterial,
      crystalMaterial,
    };
  }, [palette, reflectionIntensity]);

  useEffect(
    () => () => {
      resources.tuftMaterial.dispose();
      resources.pebbleMaterial.dispose();
      resources.crystalMaterial.dispose();
    },
    [resources]
  );

  return (
    <group name="procedural-world-dressing">
      <InstancedDressingMesh
        name="surface-tufts"
        instances={dressing.tufts}
        geometry={DRESSING_GEOMETRIES.tuft}
        material={resources.tuftMaterial}
        maxRenderDistance={maxRenderDistance}
        receiveShadow={shadowsEnabled}
      />
      <InstancedDressingMesh
        name="surface-pebbles"
        instances={dressing.pebbles}
        geometry={DRESSING_GEOMETRIES.pebble}
        material={resources.pebbleMaterial}
        maxRenderDistance={maxRenderDistance}
        castShadow={shadowsEnabled}
        receiveShadow={shadowsEnabled}
      />
      <InstancedDressingMesh
        name="surface-crystal-glints"
        instances={dressing.crystals}
        geometry={DRESSING_GEOMETRIES.crystal}
        material={resources.crystalMaterial}
        maxRenderDistance={maxRenderDistance}
        castShadow={shadowsEnabled}
        receiveShadow={shadowsEnabled}
      />
    </group>
  );
}
