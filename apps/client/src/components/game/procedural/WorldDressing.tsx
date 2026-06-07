import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
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

const MAX_TUFTS = 520;
const MAX_PEBBLES = 260;
const MAX_CRYSTALS = 140;

const DRESSING_GEOMETRIES = {
  tuft: new THREE.ConeGeometry(1, 1, 5),
  pebble: new THREE.DodecahedronGeometry(1, 0),
  crystal: new THREE.OctahedronGeometry(1, 0),
};

const dressingMatrixDummy = new THREE.Object3D();

function chunkIndex(x: number, y: number, z: number, chunk: VoxelChunk): number {
  return x + chunk.size.x * (z + chunk.size.z * y);
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

function isProtectedSurface(manifest: VoxelMapManifest, worldX: number, worldZ: number): boolean {
  for (const flag of [manifest.flagZones.red, manifest.flagZones.blue]) {
    if (distanceSq(worldX, worldZ, flag.x, flag.z) < 7.5 ** 2) return true;
  }

  for (const spawn of [...manifest.spawnPoints.red, ...manifest.spawnPoints.blue]) {
    if (distanceSq(worldX, worldZ, spawn.x, spawn.z) < 5.8 ** 2) return true;
  }

  return false;
}

function isNaturalSurface(blockId: VoxelBlockId): boolean {
  return blockId === 'grass' || blockId === 'dirt' || blockId === 'stone';
}

function getDressingPalette(theme: VoxelMapTheme): DressingPalette {
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

  return {
    tuft: '#58b957',
    pebble: '#737b80',
    crystal: '#7bdfff',
    crystalEmissive: '#ffe076',
  };
}

function getBiomeDensities(theme: VoxelMapTheme): { tuft: number; pebble: number; crystal: number } {
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

  return { tuft: 0.048, pebble: 0.022, crystal: 0.01 };
}

function createDressingSet(manifest: VoxelMapManifest, densityScale: number): DressingSet {
  if (densityScale <= 0) {
    return { tufts: [], pebbles: [], crystals: [] };
  }

  const safeDensityScale = Math.min(1.35, Math.max(0, densityScale));
  const maxTufts = Math.round(MAX_TUFTS * safeDensityScale);
  const maxPebbles = Math.round(MAX_PEBBLES * safeDensityScale);
  const maxCrystals = Math.round(MAX_CRYSTALS * safeDensityScale);
  const surfaces = getTopSurfaces(manifest);
  const densities = getBiomeDensities(manifest.theme);
  const tufts: DressingInstance[] = [];
  const pebbles: DressingInstance[] = [];
  const crystals: DressingInstance[] = [];

  for (let z = 2; z < manifest.size.z - 2; z += 2) {
    for (let x = 2; x < manifest.size.x - 2; x += 2) {
      const surface = surfaces[x + z * manifest.size.x];
      if (!surface || !isNaturalSurface(surface.blockId)) continue;

      const jitterX = (hashCell(manifest.seed, x, z, 0x51) - 0.5) * manifest.voxelSize.x * 0.7;
      const jitterZ = (hashCell(manifest.seed, x, z, 0x7a) - 0.5) * manifest.voxelSize.z * 0.7;
      const [worldX, worldY, worldZ] = worldPositionForSurface(manifest, surface, jitterX, jitterZ);
      if (isProtectedSurface(manifest, worldX, worldZ)) continue;

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
        (surface.blockId === 'stone' || manifest.theme.id === 'crystal' || manifest.theme.id === 'frost') &&
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

function useInstancedMatrices(ref: RefObject<THREE.InstancedMesh>, instances: DressingInstance[]): void {
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;

    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    instances.forEach((instance, index) => {
      dressingMatrixDummy.position.set(...instance.position);
      dressingMatrixDummy.rotation.set(...instance.rotation);
      dressingMatrixDummy.scale.set(...instance.scale);
      dressingMatrixDummy.updateMatrix();
      mesh.setMatrixAt(index, dressingMatrixDummy.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [instances, ref]);
}

function InstancedDressingMesh({
  name,
  instances,
  geometry,
  material,
  castShadow = false,
  receiveShadow = false,
}: {
  name: string;
  instances: DressingInstance[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useInstancedMatrices(ref, instances);

  if (instances.length === 0) return null;

  return (
    <instancedMesh
      ref={ref}
      name={name}
      args={[geometry, material, instances.length]}
      matrixAutoUpdate={false}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  );
}

export function WorldDressing({
  manifest,
  densityScale,
  shadowsEnabled,
  reflectionIntensity,
}: {
  manifest: VoxelMapManifest;
  densityScale: number;
  shadowsEnabled: boolean;
  reflectionIntensity: number;
}) {
  const palette = useMemo(() => getDressingPalette(manifest.theme), [manifest.theme]);
  const dressing = useMemo(() => createDressingSet(manifest, densityScale), [densityScale, manifest]);
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
        receiveShadow={shadowsEnabled}
      />
      <InstancedDressingMesh
        name="surface-pebbles"
        instances={dressing.pebbles}
        geometry={DRESSING_GEOMETRIES.pebble}
        material={resources.pebbleMaterial}
        castShadow={shadowsEnabled}
        receiveShadow={shadowsEnabled}
      />
      <InstancedDressingMesh
        name="surface-crystal-glints"
        instances={dressing.crystals}
        geometry={DRESSING_GEOMETRIES.crystal}
        material={resources.crystalMaterial}
        castShadow={shadowsEnabled}
        receiveShadow={shadowsEnabled}
      />
    </group>
  );
}
