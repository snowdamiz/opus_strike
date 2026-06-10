import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generateProceduralVoxelMap, type VoxelChunk, type VoxelMapManifest } from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { areProceduralMapCollidersLoaded, isPhysicsReady, loadProceduralMapColliders } from '../../../hooks/usePhysics';
import { setMapBoundaryPolygon } from '../../../config/mapBoundaries';
import { useVoxelMaterial } from './materials';
import { VoxelRegionMesh, type VoxelChunkRegion, type VoxelMeshBuildMode } from './VoxelChunkMesh';
import { WorldDressing } from './WorldDressing';
import { clearVoxelGeometryCache } from './meshBuilder';
import type { VoxelMaterialDetail, WorldPerformanceBudget } from '../visualQuality';
import { recordSystemTime, recordVoxelMapGenerated, recordVoxelWorldRegions } from '../../../utils/perfMarks';

const VOXEL_REGION_CHUNK_SPAN = 4;

interface VoxelMapProps {
  seed?: number;
  manifest?: VoxelMapManifest;
  enablePhysics?: boolean;
  shadowsEnabled: boolean;
  dressingShadows: boolean;
  dressingDensity: number;
  reflectionIntensity: number;
  materialDetail: VoxelMaterialDetail;
  performanceBudget?: WorldPerformanceBudget;
  meshBuildMode?: VoxelMeshBuildMode;
  progressiveReveal?: boolean;
  onReady?: () => void;
}

interface ReadyRegionsState {
  manifestId: string;
  ids: Set<string>;
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
  manifest: providedManifest,
  enablePhysics = true,
  shadowsEnabled,
  dressingShadows,
  dressingDensity,
  reflectionIntensity,
  materialDetail,
  performanceBudget,
  meshBuildMode = 'async',
  progressiveReveal = true,
  onReady,
}: VoxelMapProps) {
  const storeMapSeed = useGameStore((state) => state.mapSeed);
  const mapSeed = seed ?? storeMapSeed;
  const manifest = useMemo(() => {
    if (providedManifest) return providedManifest;

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
  }, [mapSeed, providedManifest]);
  const renderableRegions = useMemo(() => {
    const start = performance.now();
    const renderableChunks = manifest.chunks.filter((chunk) => chunk.solidBlockCount > 0);
    const regions = createVoxelChunkRegions(renderableChunks);
    recordSystemTime('voxelRegionBatch', performance.now() - start);
    return regions;
  }, [manifest]);
  const material = useVoxelMaterial(manifest.theme, { reflectionIntensity, detail: materialDetail });
  const collidersLoadedRef = useRef(false);
  const didSignalReadyRef = useRef<string | null>(null);
  const regionRevealBudgetRef = useRef(performanceBudget?.maxGeneratedRegionMeshesPerFrame ?? 3);
  const shouldRevealAllRegions = meshBuildMode === 'sync' || !progressiveReveal;
  const [visibleRegionCount, setVisibleRegionCount] = useState(() => (
    shouldRevealAllRegions ? renderableRegions.length : 0
  ));
  const [readyRegions, setReadyRegions] = useState<ReadyRegionsState>(() => ({
    manifestId: manifest.id,
    ids: new Set(),
  }));
  const [collidersReady, setCollidersReady] = useState(!enablePhysics);

  useEffect(() => {
    regionRevealBudgetRef.current = Math.max(1, performanceBudget?.maxGeneratedRegionMeshesPerFrame ?? 3);
  }, [performanceBudget?.maxGeneratedRegionMeshesPerFrame]);

  useEffect(() => {
    if (shouldRevealAllRegions) {
      setVisibleRegionCount(renderableRegions.length);
      return;
    }

    let cancelled = false;
    let rafId = 0;
    let nextVisibleCount = Math.min(renderableRegions.length, regionRevealBudgetRef.current);

    setVisibleRegionCount(nextVisibleCount);

    const revealNextBatch = () => {
      if (cancelled) return;
      nextVisibleCount = Math.min(
        renderableRegions.length,
        nextVisibleCount + regionRevealBudgetRef.current
      );
      setVisibleRegionCount(nextVisibleCount);

      if (nextVisibleCount < renderableRegions.length) {
        rafId = window.requestAnimationFrame(revealNextBatch);
      }
    };

    if (nextVisibleCount < renderableRegions.length) {
      rafId = window.requestAnimationFrame(revealNextBatch);
    }

    return () => {
      cancelled = true;
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [manifest.id, renderableRegions, shouldRevealAllRegions]);

  const handleRegionGeometryReady = useCallback((regionId: string) => {
    setReadyRegions((current) => {
      const currentIds = current.manifestId === manifest.id ? current.ids : new Set<string>();
      if (currentIds.has(regionId)) return current;

      const nextIds = new Set(currentIds);
      nextIds.add(regionId);
      return {
        manifestId: manifest.id,
        ids: nextIds,
      };
    });
  }, [manifest.id]);

  useEffect(() => {
    recordVoxelWorldRegions(renderableRegions.length);
  }, [renderableRegions]);

  useEffect(() => () => {
    clearVoxelGeometryCache(manifest.id);
  }, [manifest.id]);

  useEffect(() => {
    let cancelled = false;
    let interval = 0;

    collidersLoadedRef.current = !enablePhysics;
    setCollidersReady(!enablePhysics);

    if (!enablePhysics) return undefined;

    collidersLoadedRef.current = false;
    setMapBoundaryPolygon(manifest.boundary);

    const markCollidersReady = () => {
      if (cancelled) return;
      collidersLoadedRef.current = true;
      setCollidersReady(true);
    };

    if (areProceduralMapCollidersLoaded(manifest)) {
      markCollidersReady();
      return undefined;
    }

    const loadColliders = () => {
      if (collidersLoadedRef.current) return;
      if (areProceduralMapCollidersLoaded(manifest)) {
        markCollidersReady();
        return;
      }

      if (isPhysicsReady()) {
        const loadedSynchronously = loadProceduralMapColliders(manifest);
        if (loadedSynchronously || areProceduralMapCollidersLoaded(manifest)) {
          markCollidersReady();
        }
      }
    };

    loadColliders();

    if (!collidersLoadedRef.current) {
      interval = window.setInterval(() => {
        loadColliders();
        if (collidersLoadedRef.current) {
          window.clearInterval(interval);
        }
      }, 100);

      return () => {
        cancelled = true;
        window.clearInterval(interval);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [enablePhysics, manifest]);

  const readyRegionCount = readyRegions.manifestId === manifest.id ? readyRegions.ids.size : 0;
  const terrainReady = (
    visibleRegionCount >= renderableRegions.length &&
    readyRegionCount >= renderableRegions.length
  );
  const isReady = terrainReady && collidersReady;

  useEffect(() => {
    if (!onReady || !isReady) return;

    const readyKey = `${manifest.id}:${enablePhysics ? 'physics' : 'visual'}:${renderableRegions.length}`;
    if (didSignalReadyRef.current === readyKey) return;

    didSignalReadyRef.current = readyKey;
    onReady();
  }, [enablePhysics, isReady, manifest.id, onReady, renderableRegions.length]);

  return (
    <group name="procedural-voxel-map">
      {renderableRegions.slice(0, visibleRegionCount).map((region) => (
        <VoxelRegionMesh
          key={`${manifest.id}:${region.id}`}
          region={region}
          manifest={manifest}
          material={material}
          shadowsEnabled={shadowsEnabled}
          buildMode={meshBuildMode}
          onGeometryReady={handleRegionGeometryReady}
        />
      ))}
      <WorldDressing
        manifest={manifest}
        densityScale={dressingDensity}
        maxInstances={performanceBudget?.maxWorldDressingInstances}
        shadowsEnabled={dressingShadows}
        reflectionIntensity={reflectionIntensity}
      />
    </group>
  );
}
