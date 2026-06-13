import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VoxelMapManifest, VoxelMapTheme } from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { areProceduralMapCollidersLoaded, isPhysicsReady, loadProceduralMapColliders } from '../../../hooks/usePhysics';
import { setMapBoundaryPolygon } from '../../../config/mapBoundaries';
import { useVoxelMaterial } from './materials';
import { VoxelRegionMesh, type VoxelMeshBuildMode } from './VoxelChunkMesh';
import { WorldDressing } from './WorldDressing';
import { clearVoxelGeometryCache, prebuildVoxelRegionGeometries } from './meshBuilder';
import type { WorldPerformanceBudget } from '../visualQuality';
import {
  prepareVoxelMapCpu,
  type PreparedVoxelMap,
} from '../../../utils/mapWarmup/mapPrepCache';

interface VoxelMapProps {
  seed?: number;
  themeId?: VoxelMapTheme['id'] | null;
  manifest?: VoxelMapManifest;
  enablePhysics?: boolean;
  shadowsEnabled: boolean;
  dressingShadows: boolean;
  dressingDensity: number;
  reflectionIntensity: number;
  performanceBudget?: WorldPerformanceBudget;
  meshBuildMode?: VoxelMeshBuildMode;
  progressiveReveal?: boolean;
  prebuildRegions?: boolean;
  onWarmupStatus?: (status: VoxelMapWarmupStatus) => void;
  onReady?: () => void;
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
  themeId: providedThemeId,
  manifest: providedManifest,
  enablePhysics = true,
  shadowsEnabled,
  dressingShadows,
  dressingDensity,
  reflectionIntensity,
  performanceBudget,
  meshBuildMode = 'async',
  progressiveReveal = true,
  prebuildRegions = false,
  onWarmupStatus,
  onReady,
}: VoxelMapProps) {
  const storeMapSeed = useGameStore((state) => state.mapSeed);
  const storeMapThemeId = useGameStore((state) => state.mapThemeId);
  const mapSeed = seed ?? storeMapSeed;
  const mapThemeId = providedThemeId ?? storeMapThemeId;
  const preparedMap = useMemo(() => {
    return prepareVoxelMapCpu({
      seed: mapSeed,
      themeId: mapThemeId,
      manifest: providedManifest,
      source: providedManifest ? 'mapVotePreview' : 'match',
    });
  }, [mapSeed, mapThemeId, providedManifest]);
  const manifest = preparedMap.manifest;
  const renderableRegions = preparedMap.renderableRegions;
  const material = useVoxelMaterial(manifest.theme);
  const collidersLoadedRef = useRef(false);
  const didSignalReadyRef = useRef<string | null>(null);
  const regionRevealBudgetRef = useRef(performanceBudget?.maxGeneratedRegionMeshesPerFrame ?? 3);
  const readyRegionManifestIdRef = useRef(manifest.id);
  const readyRegionIdsRef = useRef<Set<string>>(new Set());
  const shouldRevealAllRegions = meshBuildMode === 'sync' || !progressiveReveal;
  const [visibleRegionCount, setVisibleRegionCount] = useState(() => (
    shouldRevealAllRegions ? renderableRegions.length : 0
  ));
  const [readyRegionCount, setReadyRegionCount] = useState(0);
  const [collidersReady, setCollidersReady] = useState(!enablePhysics);

  useEffect(() => {
    regionRevealBudgetRef.current = Math.max(1, performanceBudget?.maxGeneratedRegionMeshesPerFrame ?? 3);
  }, [performanceBudget?.maxGeneratedRegionMeshesPerFrame]);

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
    if (readyRegionManifestIdRef.current !== manifest.id) {
      readyRegionManifestIdRef.current = manifest.id;
      readyRegionIdsRef.current = new Set();
      setReadyRegionCount(0);
    }

    if (readyRegionIdsRef.current.has(regionId)) return;
    readyRegionIdsRef.current.add(regionId);
    setReadyRegionCount(readyRegionIdsRef.current.size);
  }, [manifest.id]);

  useEffect(() => {
    if (readyRegionManifestIdRef.current === manifest.id) return;
    readyRegionManifestIdRef.current = manifest.id;
    readyRegionIdsRef.current = new Set();
    setReadyRegionCount(0);
  }, [manifest.id]);

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

  const effectiveReadyRegionCount = readyRegionManifestIdRef.current === manifest.id ? readyRegionCount : 0;
  const terrainReady = (
    visibleRegionCount >= renderableRegions.length &&
    effectiveReadyRegionCount >= renderableRegions.length
  );
  const isReady = terrainReady && collidersReady;
  const visibleRegions = useMemo(
    () => renderableRegions.slice(0, visibleRegionCount),
    [renderableRegions, visibleRegionCount]
  );

  useEffect(() => {
    onWarmupStatus?.({
      preparedMap,
      manifest,
      renderableRegionCount: renderableRegions.length,
      visibleRegionCount,
      readyRegionCount: effectiveReadyRegionCount,
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
    effectiveReadyRegionCount,
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
      {visibleRegions.map((region) => (
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
