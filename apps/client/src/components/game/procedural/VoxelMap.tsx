import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VoxelMapManifest } from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { areProceduralMapCollidersLoaded, isPhysicsReady, loadProceduralMapColliders } from '../../../hooks/usePhysics';
import { setMapBoundaryPolygon } from '../../../config/mapBoundaries';
import { useVoxelMaterial } from './materials';
import { VoxelRegionMesh, type VoxelMeshBuildMode } from './VoxelChunkMesh';
import { WorldDressing } from './WorldDressing';
import { clearVoxelGeometryCache, prebuildVoxelRegionGeometries } from './meshBuilder';
import type { VoxelMaterialDetail, WorldPerformanceBudget } from '../visualQuality';
import { recordStartupStageTime, recordVoxelWorldRegions } from '../../../utils/perfMarks';
import {
  prepareVoxelMapCpu,
  type PreparedVoxelMap,
} from '../../../utils/mapWarmup/mapPrepCache';

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
  prebuildRegions?: boolean;
  onWarmupStatus?: (status: VoxelMapWarmupStatus) => void;
  onReady?: () => void;
}

interface ReadyRegionsState {
  manifestId: string;
  ids: Set<string>;
}

export interface VoxelMapWarmupStatus {
  preparedMap: PreparedVoxelMap;
  manifest: VoxelMapManifest;
  renderableRegionCount: number;
  visibleRegionCount: number;
  readyRegionCount: number;
  terrainReady: boolean;
  collidersReady: boolean;
  ready: boolean;
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
  prebuildRegions = false,
  onWarmupStatus,
  onReady,
}: VoxelMapProps) {
  const storeMapSeed = useGameStore((state) => state.mapSeed);
  const mapSeed = seed ?? storeMapSeed;
  const preparedMap = useMemo(() => {
    return prepareVoxelMapCpu({
      seed: mapSeed,
      manifest: providedManifest,
      source: providedManifest ? 'mapVotePreview' : 'match',
    });
  }, [mapSeed, providedManifest]);
  const manifest = preparedMap.manifest;
  const renderableRegions = preparedMap.renderableRegions;
  const material = useVoxelMaterial(manifest.theme, { reflectionIntensity, detail: materialDetail });
  const collidersLoadedRef = useRef(false);
  const didSignalReadyRef = useRef<string | null>(null);
  const colliderWaitStartRef = useRef(0);
  const terrainWaitStartRef = useRef(performance.now());
  const recordedTerrainReadyKeyRef = useRef<string | null>(null);
  const recordedColliderReadyKeyRef = useRef<string | null>(null);
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
    terrainWaitStartRef.current = performance.now();
    recordedTerrainReadyKeyRef.current = null;
    recordedColliderReadyKeyRef.current = null;
  }, [manifest.id]);

  useEffect(() => {
    if (!prebuildRegions) return;

    let cancelled = false;
    prebuildVoxelRegionGeometries(
      manifest,
      renderableRegions,
      { frameBudgetMs: 4 }
    ).catch((error) => {
      if (!cancelled) console.warn('[VoxelMap] Failed to prebuild region meshes', error);
    });

    return () => {
      cancelled = true;
    };
  }, [manifest, prebuildRegions, renderableRegions]);

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
    colliderWaitStartRef.current = performance.now();
    setMapBoundaryPolygon(manifest.boundary);

    const markCollidersReady = () => {
      if (cancelled) return;
      collidersLoadedRef.current = true;
      setCollidersReady(true);
      const readyKey = `${manifest.id}:colliders`;
      if (recordedColliderReadyKeyRef.current !== readyKey) {
        recordedColliderReadyKeyRef.current = readyKey;
        recordStartupStageTime('colliders', performance.now() - colliderWaitStartRef.current);
      }
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
    if (!terrainReady) return;

    const readyKey = `${manifest.id}:terrain:${renderableRegions.length}`;
    if (recordedTerrainReadyKeyRef.current === readyKey) return;
    recordedTerrainReadyKeyRef.current = readyKey;
    recordStartupStageTime('meshes', performance.now() - terrainWaitStartRef.current);
  }, [manifest.id, renderableRegions.length, terrainReady]);

  useEffect(() => {
    onWarmupStatus?.({
      preparedMap,
      manifest,
      renderableRegionCount: renderableRegions.length,
      visibleRegionCount,
      readyRegionCount,
      terrainReady,
      collidersReady,
      ready: isReady,
    });
  }, [
    collidersReady,
    isReady,
    manifest,
    onWarmupStatus,
    preparedMap,
    readyRegionCount,
    renderableRegions.length,
    terrainReady,
    visibleRegionCount,
  ]);

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
