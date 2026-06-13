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
  const activeRegionIdsRef = useRef<Set<string> | null>(null);
  const activeRegionSignatureRef = useRef('all');
  const terrainCullFrustumRef = useRef(new THREE.Frustum());
  const terrainCullMatrixRef = useRef(new THREE.Matrix4());
  const terrainCullSphereRef = useRef(new THREE.Sphere());
  const shouldRevealAllRegions = meshBuildMode === 'sync' || !progressiveReveal;
  const [visibleRegionCount, setVisibleRegionCount] = useState(() => (
    shouldRevealAllRegions ? renderableRegions.length : 0
  ));
  const [readyRegionCount, setReadyRegionCount] = useState(0);
  const [collidersReady, setCollidersReady] = useState(!enablePhysics);
  const [activeRegionIds, setActiveRegionIds] = useState<Set<string> | null>(null);
  const terrainCullDistance = useMemo(
    () => getRuntimeTerrainCullDistance(performanceBudget),
    [performanceBudget?.drawCalls]
  );

  useEffect(() => {
    regionRevealBudgetRef.current = Math.max(1, performanceBudget?.maxGeneratedRegionMeshesPerFrame ?? 3);
  }, [performanceBudget?.maxGeneratedRegionMeshesPerFrame]);

  useEffect(() => {
    terrainCullAccumulatorRef.current = 0;
    activeRegionIdsRef.current = null;
    activeRegionSignatureRef.current = 'all';
    setActiveRegionIds(null);
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
  const renderedRegions = useMemo(() => {
    if (!terrainReady || activeRegionIds === null) return visibleRegions;
    return visibleRegions.filter((region) => activeRegionIds.has(region.id));
  }, [activeRegionIds, terrainReady, visibleRegions]);

  useFrame((state, delta) => {
    if (!terrainReady || !Number.isFinite(terrainCullDistance)) return;

    terrainCullAccumulatorRef.current += delta * 1000;
    if (terrainCullAccumulatorRef.current < TERRAIN_CULL_UPDATE_INTERVAL_MS) return;
    terrainCullAccumulatorRef.current = 0;

    const camera = state.camera;
    const frustum = terrainCullFrustumRef.current;
    const matrix = terrainCullMatrixRef.current;
    const sphere = terrainCullSphereRef.current;
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);

    const previousIds = activeRegionIdsRef.current;
    const nextIds = new Set<string>();
    let closestRegionId: string | null = null;
    let closestDistanceSq = Infinity;

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

      const wasActive = previousIds?.has(region.id) ?? false;
      const maxDistance = terrainCullDistance + bounds.radius + (wasActive ? TERRAIN_CULL_HYSTERESIS : 0);
      if (distanceSq > maxDistance * maxDistance) continue;

      sphere.center.set(bounds.center.x, bounds.center.y, bounds.center.z);
      sphere.radius = bounds.radius + (wasActive ? TERRAIN_CULL_HYSTERESIS : 0);
      if (frustum.intersectsSphere(sphere)) {
        nextIds.add(region.id);
      }
    }

    if (nextIds.size === 0 && closestRegionId) {
      nextIds.add(closestRegionId);
    }

    const signature = Array.from(nextIds).sort().join('|');
    if (signature === activeRegionSignatureRef.current) return;
    activeRegionSignatureRef.current = signature;
    activeRegionIdsRef.current = nextIds;
    setActiveRegionIds(nextIds);
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
      {renderedRegions.map((region) => (
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
