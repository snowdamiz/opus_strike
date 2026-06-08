import { useEffect, useMemo, useRef } from 'react';
import { generateProceduralVoxelMap, type VoxelChunk } from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { areProceduralMapCollidersLoaded, isPhysicsReady, loadProceduralMapColliders } from '../../../hooks/usePhysics';
import { setMapBoundaryPolygon } from '../../../config/mapBoundaries';
import { useVoxelMaterial } from './materials';
import { VoxelRegionMesh, type VoxelChunkRegion } from './VoxelChunkMesh';
import { WorldDressing } from './WorldDressing';
import { clearVoxelGeometryCache } from './meshBuilder';
import type { VoxelMaterialDetail } from '../visualQuality';
import { recordSystemTime, recordVoxelMapGenerated, recordVoxelWorldRegions } from '../../../utils/perfMarks';

const VOXEL_REGION_CHUNK_SPAN = 4;

interface VoxelMapProps {
  seed?: number;
  enablePhysics?: boolean;
  shadowsEnabled: boolean;
  dressingShadows: boolean;
  dressingDensity: number;
  reflectionIntensity: number;
  materialDetail: VoxelMaterialDetail;
}

function createVoxelChunkRegions(chunks: VoxelChunk[]): VoxelChunkRegion[] {
  const regions = new Map<string, VoxelChunkRegion>();

  for (const chunk of chunks) {
    const regionX = Math.floor(chunk.coord.x / VOXEL_REGION_CHUNK_SPAN);
    const regionZ = Math.floor(chunk.coord.z / VOXEL_REGION_CHUNK_SPAN);
    const id = `${regionX}:${chunk.coord.y}:${regionZ}`;
    let region = regions.get(id);

    if (!region) {
      region = { id, chunks: [], castShadow: chunk.coord.y > 0 };
      regions.set(id, region);
    }

    region.chunks.push(chunk);
    region.castShadow ||= chunk.coord.y > 0;
  }

  return Array.from(regions.values());
}

export function VoxelMap({
  seed,
  enablePhysics = true,
  shadowsEnabled,
  dressingShadows,
  dressingDensity,
  reflectionIntensity,
  materialDetail,
}: VoxelMapProps) {
  const storeMapSeed = useGameStore((state) => state.mapSeed);
  const mapSeed = seed ?? storeMapSeed;
  const manifest = useMemo(() => {
    const start = performance.now();
    const nextManifest = generateProceduralVoxelMap(mapSeed);
    const generationMs = performance.now() - start;
    recordSystemTime('voxelMapGenerate', generationMs);
    recordVoxelMapGenerated({
      generationMs,
      totalChunkSlots: nextManifest.stats.totalChunkSlots ?? nextManifest.stats.chunkCount,
      renderableChunks: nextManifest.stats.renderableChunkCount ?? nextManifest.stats.chunkCount,
      emptyChunkSlots: nextManifest.stats.emptyChunkSlots ?? 0,
      colliders: nextManifest.stats.colliderCount,
    });
    return nextManifest;
  }, [mapSeed]);
  const renderableRegions = useMemo(() => {
    const start = performance.now();
    const renderableChunks = manifest.chunks.filter((chunk) => chunk.solidBlockCount > 0);
    const regions = createVoxelChunkRegions(renderableChunks);
    recordSystemTime('voxelRegionBatch', performance.now() - start);
    return regions;
  }, [manifest]);
  const material = useVoxelMaterial(manifest.theme, { reflectionIntensity, detail: materialDetail });
  const collidersLoadedRef = useRef(false);

  useEffect(() => {
    recordVoxelWorldRegions(renderableRegions.length);
  }, [renderableRegions]);

  useEffect(() => () => {
    clearVoxelGeometryCache(manifest.id);
  }, [manifest.id]);

  useEffect(() => {
    if (!enablePhysics) return;

    collidersLoadedRef.current = false;
    setMapBoundaryPolygon(manifest.boundary);

    if (collidersLoadedRef.current || areProceduralMapCollidersLoaded(manifest)) {
      return;
    }

    const loadColliders = () => {
      if (isPhysicsReady() && !collidersLoadedRef.current) {
        const success = loadProceduralMapColliders(manifest);
        if (success) {
          collidersLoadedRef.current = true;
        }
      }
    };

    loadColliders();

    if (!collidersLoadedRef.current) {
      const interval = window.setInterval(() => {
        loadColliders();
        if (collidersLoadedRef.current) {
          window.clearInterval(interval);
        }
      }, 100);

      return () => window.clearInterval(interval);
    }
  }, [enablePhysics, manifest]);

  return (
    <group name="procedural-voxel-map">
      {renderableRegions.map((region) => (
        <VoxelRegionMesh
          key={region.id}
          region={region}
          manifest={manifest}
          material={material}
          shadowsEnabled={shadowsEnabled}
        />
      ))}
      <WorldDressing
        manifest={manifest}
        densityScale={dressingDensity}
        shadowsEnabled={dressingShadows}
        reflectionIntensity={reflectionIntensity}
      />
    </group>
  );
}
