import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { VoxelMapManifest, VoxelMapTheme } from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { areProceduralMapCollidersLoaded, isPhysicsReady, loadProceduralMapColliders } from '../../../hooks/usePhysics';
import { setMapBoundaryPolygon } from '../../../config/mapBoundaries';
import { useVoxelMaterial } from './materials';
import { VoxelRegionMesh, type VoxelMeshBuildMode } from './VoxelChunkMesh';
import { WorldDressing } from './WorldDressing';
import { clearVoxelGeometryCache, prebuildVoxelRegionGeometries } from './meshBuilder';
import type { MaterialQualityConfig, WorldPerformanceBudget } from '../visualQuality';
import {
  prepareVoxelMapCpu,
  type PreparedVoxelMap,
} from '../../../utils/mapWarmup/mapPrepCache';
import { measureFrameWork } from '../../../movement/networkDiagnostics';

const TERRAIN_CULL_UPDATE_INTERVAL_MS = 180;
const TERRAIN_CULL_HYSTERESIS = 18;

function getRuntimeTerrainCullDistance(performanceBudget?: WorldPerformanceBudget): number {
  const drawCalls = performanceBudget?.drawCalls ?? Number.POSITIVE_INFINITY;
  if (drawCalls <= 320) return 155;
  if (drawCalls <= 450) return 190;
  if (drawCalls <= 560) return 235;
  return Number.POSITIVE_INFINITY;
}

interface VoxelMapProps {
  seed?: number;
  themeId?: VoxelMapTheme['id'] | null;
  manifest?: VoxelMapManifest;
  enablePhysics?: boolean;
  shadowsEnabled: boolean;
  dressingShadows: boolean;
  dressingDensity: number;
  reflectionIntensity: number;
  materialQuality: MaterialQualityConfig['terrainTextureQuality'];
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
  materialQuality,
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
  const material = useVoxelMaterial(manifest.theme, materialQuality);
  const collidersLoadedRef = useRef(false);
  const didSignalReadyRef = useRef<string | null>(null);
  const regionRevealBudgetRef = useRef(performanceBudget?.maxGeneratedRegionMeshesPerFrame ?? 3);
  const readyRegionManifestIdRef = useRef(manifest.id);
  const readyRegionIdsRef = useRef<Set<string>>(new Set());
  const terrainCullAccumulatorRef = useRef(0);
  const regionVisibilityRef = useRef<Map<string, boolean>>(new Map());
  const regionGroupsRef = useRef<Map<string, THREE.Group>>(new Map());
  const terrainCullFrustumRef = useRef(new THREE.Frustum());
  const terrainCullMatrixRef = useRef(new THREE.Matrix4());
  const terrainCullSphereRef = useRef(new THREE.Sphere());
  const shouldRevealAllRegions = meshBuildMode === 'sync' || !progressiveReveal;
  const [visibleRegionCount, setVisibleRegionCount] = useState(() => (
    shouldRevealAllRegions ? renderableRegions.length : 0
  ));
  const [readyRegionCount, setReadyRegionCount] = useState(0);
  const [collidersReady, setCollidersReady] = useState(!enablePhysics);
  const terrainCullDistance = useMemo(
    () => getRuntimeTerrainCullDistance(performanceBudget),
    [performanceBudget?.drawCalls]
  );

  const setRegionVisibility = useCallback((regionId: string, visible: boolean) => {
    const visibility = regionVisibilityRef.current;
    if (visibility.get(regionId) === visible) return;
    visibility.set(regionId, visible);
    const group = regionGroupsRef.current.get(regionId);
    if (group) group.visible = visible;
  }, []);

  const setRegionGroupNode = useCallback((regionId: string, group: THREE.Group | null) => {
    if (!group) {
      regionGroupsRef.current.delete(regionId);
      return;
    }

    regionGroupsRef.current.set(regionId, group);
    const visible = regionVisibilityRef.current.get(regionId);
    group.visible = visible ?? true;
  }, []);

  useEffect(() => {
    regionRevealBudgetRef.current = Math.max(1, performanceBudget?.maxGeneratedRegionMeshesPerFrame ?? 3);
  }, [performanceBudget?.maxGeneratedRegionMeshesPerFrame]);

  useEffect(() => {
    terrainCullAccumulatorRef.current = 0;
    regionVisibilityRef.current.clear();
    for (const group of regionGroupsRef.current.values()) {
      group.visible = true;
    }
  }, [manifest.id, terrainCullDistance]);

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

  useFrame((state, delta) => {
    if (!terrainReady || !Number.isFinite(terrainCullDistance)) return;

    measureFrameWork('frame.terrainCulling', () => {
      terrainCullAccumulatorRef.current += delta * 1000;
      if (terrainCullAccumulatorRef.current < TERRAIN_CULL_UPDATE_INTERVAL_MS) return;
      terrainCullAccumulatorRef.current = 0;

      const camera = state.camera;
      const frustum = terrainCullFrustumRef.current;
      const matrix = terrainCullMatrixRef.current;
      const sphere = terrainCullSphereRef.current;
      matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(matrix);

      let closestRegionId: string | null = null;
      let closestDistanceSq = Infinity;
      let visibleAfterCull = 0;

      for (const region of visibleRegions) {
        const { bounds } = region;
        const dx = bounds.center.x - camera.position.x;
        const dy = bounds.center.y - camera.position.y;
        const dz = bounds.center.z - camera.position.z;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq < closestDistanceSq) {
          closestDistanceSq = distanceSq;
          closestRegionId = region.id;
        }

        const wasVisible = regionVisibilityRef.current.get(region.id) ?? true;
        const maxDistance = terrainCullDistance + bounds.radius + (wasVisible ? TERRAIN_CULL_HYSTERESIS : 0);
        let nextVisible = distanceSq <= maxDistance * maxDistance;

        if (nextVisible) {
          sphere.center.set(bounds.center.x, bounds.center.y, bounds.center.z);
          sphere.radius = bounds.radius + (wasVisible ? TERRAIN_CULL_HYSTERESIS : 0);
          nextVisible = frustum.intersectsSphere(sphere);
        }

        if (nextVisible) visibleAfterCull++;
        setRegionVisibility(region.id, nextVisible);
      }

      if (visibleAfterCull === 0 && closestRegionId) {
        setRegionVisibility(closestRegionId, true);
      }
    });
  });

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
        <group
          key={`${manifest.id}:${region.id}`}
          ref={(group) => setRegionGroupNode(region.id, group)}
        >
          <VoxelRegionMesh
            region={region}
            manifest={manifest}
            material={material}
            shadowsEnabled={shadowsEnabled}
            buildMode={meshBuildMode}
            onGeometryReady={handleRegionGeometryReady}
          />
        </group>
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
