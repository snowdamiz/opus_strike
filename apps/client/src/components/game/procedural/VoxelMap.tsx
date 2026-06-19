import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type RootState } from '@react-three/fiber';
import * as THREE from 'three';
import type { MapProfileId, VoxelMapManifest, VoxelMapSizeId, VoxelMapTheme } from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { areProceduralMapCollidersLoaded, isPhysicsReady, loadProceduralMapColliders } from '../../../hooks/usePhysics';
import { setMapBoundaryPolygon } from '../../../config/mapBoundaries';
import { useVoxelFarMaterial, useVoxelMaterial } from './materials';
import { VoxelRegionMesh, type VoxelMeshBuildMode } from './VoxelRegionMesh';
import { WorldDressing } from './WorldDressing';
import { clearVoxelGeometryCache, prebuildVoxelRegionGeometries } from './meshBuilder';
import type { BattleRoyalVisibilityConfig, MaterialQualityConfig, WorldPerformanceBudget } from '../visualQuality';
import type { VoxelRegionGeometryDetail } from './meshGeometryData';
import {
  prepareVoxelMapCpu,
  type PreparedVoxelMap,
  type VoxelChunkRegion,
} from '../../../utils/mapWarmup/mapPrepCache';
import {
  MOVEMENT_DIAGNOSTICS_ENABLED,
  measureFrameWork,
} from '../../../movement/networkDiagnostics';

const TERRAIN_CULL_UPDATE_INTERVAL_MS = 180;
const TERRAIN_CULL_HYSTERESIS = 18;
const TERRAIN_CULL_CAMERA_MOVE_EPSILON_SQ = 0.45 * 0.45;
const TERRAIN_CULL_CAMERA_ROTATE_EPSILON = 0.00008;
const BATTLE_ROYAL_OUTER_FILL_SCALE = 2.75;
const BATTLE_ROYAL_OUTER_FILL_HEIGHT_ROWS = 44;
const BATTLE_ROYAL_OUTER_FILL_Y_OFFSET = 0.06;
const BATTLE_ROYAL_OUTER_FILL_BOUNDARY_PADDING = 2.4;
const BATTLE_ROYAL_OUTER_FILL_FOG_BLEND = 0.42;

function getRuntimeTerrainCullDistance(
  performanceBudget?: WorldPerformanceBudget,
  visibilityBudget?: BattleRoyalVisibilityConfig
): number {
  if (visibilityBudget) {
    return visibilityBudget.terrainLodEnabled ? visibilityBudget.terrainCullDistance : Number.POSITIVE_INFINITY;
  }

  const drawCalls = performanceBudget?.drawCalls ?? Number.POSITIVE_INFINITY;
  if (drawCalls <= 320) return 155;
  if (drawCalls <= 450) return 190;
  if (drawCalls <= 560) return 235;
  return Number.POSITIVE_INFINITY;
}

function getRegionFocusPoint(manifest: VoxelMapManifest): { x: number; y: number; z: number } {
  return {
    x: manifest.origin.x + (manifest.size.x * manifest.voxelSize.x) / 2,
    y: manifest.origin.y + (manifest.size.y * manifest.voxelSize.y) * 0.25,
    z: manifest.origin.z + (manifest.size.z * manifest.voxelSize.z) / 2,
  };
}

function distanceSqToRegionFocus(region: VoxelChunkRegion, focus: { x: number; y: number; z: number }): number {
  const dx = region.bounds.center.x - focus.x;
  const dy = region.bounds.center.y - focus.y;
  const dz = region.bounds.center.z - focus.z;
  return dx * dx + dy * dy + dz * dz;
}

function prioritizeRenderableRegions(
  regions: VoxelChunkRegion[],
  manifest: VoxelMapManifest,
  visibilityBudget?: BattleRoyalVisibilityConfig
): VoxelChunkRegion[] {
  if (manifest.gameplay.mode !== 'battle_royal' || !visibilityBudget?.terrainLodEnabled) return regions;

  const focus = getRegionFocusPoint(manifest);
  return [...regions].sort((a, b) => distanceSqToRegionFocus(a, focus) - distanceSqToRegionFocus(b, focus));
}

function getPrebuildFullDetailRegions(
  regions: VoxelChunkRegion[],
  manifest: VoxelMapManifest,
  visibilityBudget: BattleRoyalVisibilityConfig
): VoxelChunkRegion[] {
  const focus = getRegionFocusPoint(manifest);
  const maxDistance = visibilityBudget.terrainPrebuildFullDistance;
  return regions.filter((region) => {
    const radiusAdjustedDistance = maxDistance + region.bounds.radius;
    return distanceSqToRegionFocus(region, focus) <= radiusAdjustedDistance * radiusAdjustedDistance;
  });
}

interface VoxelMapProps {
  seed?: number;
  themeId?: VoxelMapTheme['id'] | null;
  mapSize?: VoxelMapSizeId | null;
  mapProfileId?: MapProfileId | null;
  manifest?: VoxelMapManifest;
  enablePhysics?: boolean;
  shadowsEnabled: boolean;
  dressingShadows: boolean;
  dressingDensity: number;
  reflectionIntensity: number;
  materialQuality: MaterialQualityConfig['terrainTextureQuality'];
  performanceBudget?: WorldPerformanceBudget;
  battleRoyalVisibility?: BattleRoyalVisibilityConfig;
  meshBuildMode?: VoxelMeshBuildMode;
  progressiveReveal?: boolean;
  prebuildRegions?: boolean;
  disposeGeometryCacheOnUnmount?: boolean;
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
  mapSize: providedMapSize,
  mapProfileId: providedMapProfileId,
  manifest: providedManifest,
  enablePhysics = true,
  shadowsEnabled,
  dressingShadows,
  dressingDensity,
  reflectionIntensity,
  materialQuality,
  performanceBudget,
  battleRoyalVisibility,
  meshBuildMode = 'async',
  progressiveReveal = true,
  prebuildRegions = false,
  disposeGeometryCacheOnUnmount = true,
  onWarmupStatus,
  onReady,
}: VoxelMapProps) {
  const storeMapSeed = useGameStore((state) => state.mapSeed);
  const storeMapThemeId = useGameStore((state) => state.mapThemeId);
  const storeMapSize = useGameStore((state) => state.mapSize);
  const storeMapProfileId = useGameStore((state) => state.mapProfileId);
  const mapSeed = seed ?? storeMapSeed;
  const mapThemeId = providedThemeId ?? storeMapThemeId;
  const mapSize = providedMapSize ?? providedManifest?.mapSize ?? storeMapSize;
  const mapProfileId = providedMapProfileId ?? providedManifest?.profileId ?? storeMapProfileId;
  const preparedMap = useMemo(() => {
    return prepareVoxelMapCpu({
      seed: mapSeed,
      themeId: mapThemeId,
      mapSize,
      mapProfileId,
      manifest: providedManifest,
      source: providedManifest ? 'mapVotePreview' : 'match',
    });
  }, [mapSeed, mapThemeId, mapSize, mapProfileId, providedManifest]);
  const manifest = preparedMap.manifest;
  const activeBattleRoyalVisibility = manifest.gameplay.mode === 'battle_royal' ? battleRoyalVisibility : undefined;
  const renderableRegions = useMemo(
    () => prioritizeRenderableRegions(preparedMap.renderableRegions, manifest, activeBattleRoyalVisibility),
    [activeBattleRoyalVisibility, manifest, preparedMap.renderableRegions]
  );
  const material = useVoxelMaterial(manifest.theme, materialQuality);
  const farMaterial = useVoxelFarMaterial(manifest.theme, activeBattleRoyalVisibility?.farTerrainFogBlend ?? 0.52);
  const collidersLoadedRef = useRef(false);
  const didSignalReadyRef = useRef<string | null>(null);
  const regionRevealBudgetRef = useRef(performanceBudget?.maxGeneratedRegionMeshesPerFrame ?? 3);
  const readyRegionManifestIdRef = useRef(manifest.id);
  const readyRegionIdsRef = useRef<Set<string>>(new Set());
  const terrainCullAccumulatorRef = useRef(0);
  const terrainCullNeedsRefreshRef = useRef(true);
  const terrainCullLastCameraPositionRef = useRef(new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN));
  const terrainCullLastCameraQuaternionRef = useRef(new THREE.Quaternion());
  const regionVisibilityRef = useRef<Map<string, boolean>>(new Map());
  const regionDetailRef = useRef<Map<string, VoxelRegionGeometryDetail>>(new Map());
  const regionGroupsRef = useRef<Map<string, THREE.Group>>(new Map());
  const terrainCullFrustumRef = useRef(new THREE.Frustum());
  const terrainCullMatrixRef = useRef(new THREE.Matrix4());
  const terrainCullSphereRef = useRef(new THREE.Sphere());
  const shouldRevealAllRegions = meshBuildMode === 'sync' || !progressiveReveal;
  const [visibleRegionCount, setVisibleRegionCount] = useState(() => (
    shouldRevealAllRegions ? renderableRegions.length : 0
  ));
  const [, setRegionRenderRevision] = useState(0);
  const [readyRegionCount, setReadyRegionCount] = useState(0);
  const [collidersReady, setCollidersReady] = useState(!enablePhysics);
  const terrainCullDistance = useMemo(
    () => getRuntimeTerrainCullDistance(performanceBudget, activeBattleRoyalVisibility),
    [activeBattleRoyalVisibility, performanceBudget?.drawCalls]
  );

  const setRegionVisibility = useCallback((regionId: string, visible: boolean) => {
    const visibility = regionVisibilityRef.current;
    if (visibility.get(regionId) === visible) return;
    visibility.set(regionId, visible);
    const group = regionGroupsRef.current.get(regionId);
    if (group) group.visible = visible;
  }, []);

  const setRegionDetail = useCallback((regionId: string, detail: VoxelRegionGeometryDetail): boolean => {
    const detailByRegion = regionDetailRef.current;
    if (detailByRegion.get(regionId) === detail) return false;
    detailByRegion.set(regionId, detail);
    return true;
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
    terrainCullNeedsRefreshRef.current = true;
    terrainCullLastCameraPositionRef.current.set(Number.NaN, Number.NaN, Number.NaN);
    terrainCullLastCameraQuaternionRef.current.identity();
    regionVisibilityRef.current.clear();
    regionDetailRef.current.clear();
    for (const group of regionGroupsRef.current.values()) {
      group.visible = true;
    }
    setRegionRenderRevision((revision) => revision + 1);
  }, [manifest.id, terrainCullDistance, activeBattleRoyalVisibility]);

  useEffect(() => {
    if (!prebuildRegions) return;

    let cancelled = false;
    const prebuild = async () => {
      if (activeBattleRoyalVisibility) {
        if (!activeBattleRoyalVisibility.terrainLodEnabled) {
          await prebuildVoxelRegionGeometries(
            manifest,
            renderableRegions,
            { detail: 'full', frameBudgetMs: 4 }
          );
          return;
        }

        const fullDetailRegions = getPrebuildFullDetailRegions(
          renderableRegions,
          manifest,
          activeBattleRoyalVisibility
        );
        await prebuildVoxelRegionGeometries(
          manifest,
          fullDetailRegions,
          { detail: 'full', frameBudgetMs: 4 }
        );
        if (cancelled) return;
        await prebuildVoxelRegionGeometries(
          manifest,
          renderableRegions,
          { detail: 'coarse', frameBudgetMs: 4 }
        );
        return;
      }

      await prebuildVoxelRegionGeometries(
        manifest,
        renderableRegions,
        { detail: 'full', frameBudgetMs: 4 }
      );
    };

    prebuild().catch((error) => {
      if (!cancelled) console.warn('[VoxelMap] Failed to prebuild region meshes', error);
    });

    return () => {
      cancelled = true;
    };
  }, [activeBattleRoyalVisibility, manifest, prebuildRegions, renderableRegions]);

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
    if (disposeGeometryCacheOnUnmount) {
      clearVoxelGeometryCache(manifest.id);
    }
  }, [disposeGeometryCacheOnUnmount, manifest.id]);

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

  const runTerrainCullingFrame = (state: RootState, delta: number): void => {
    if (visibleRegions.length === 0) return;
    if (activeBattleRoyalVisibility && !activeBattleRoyalVisibility.terrainLodEnabled) return;
    if (!activeBattleRoyalVisibility && (!terrainReady || !Number.isFinite(terrainCullDistance))) return;

    const camera = state.camera;
    const lastCameraPosition = terrainCullLastCameraPositionRef.current;
    const lastCameraQuaternion = terrainCullLastCameraQuaternionRef.current;
    const cameraMoved = !Number.isFinite(lastCameraPosition.x) ||
      lastCameraPosition.distanceToSquared(camera.position) > TERRAIN_CULL_CAMERA_MOVE_EPSILON_SQ;
    const cameraRotated = 1 - Math.abs(lastCameraQuaternion.dot(camera.quaternion)) >
      TERRAIN_CULL_CAMERA_ROTATE_EPSILON;

    terrainCullAccumulatorRef.current += delta * 1000;
    if (
      !terrainCullNeedsRefreshRef.current &&
      !cameraMoved &&
      !cameraRotated &&
      terrainCullAccumulatorRef.current < TERRAIN_CULL_UPDATE_INTERVAL_MS
    ) {
      return;
    }

    if (!terrainCullNeedsRefreshRef.current && !cameraMoved && !cameraRotated) return;
    terrainCullAccumulatorRef.current = 0;
    terrainCullNeedsRefreshRef.current = false;
    lastCameraPosition.copy(camera.position);
    lastCameraQuaternion.copy(camera.quaternion);

    const frustum = terrainCullFrustumRef.current;
    const matrix = terrainCullMatrixRef.current;
    const sphere = terrainCullSphereRef.current;
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);

    let closestRegionId: string | null = null;
    let closestDistanceSq = Infinity;
    let visibleAfterCull = 0;
    let detailChanged = false;

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
      const cullDistance = activeBattleRoyalVisibility
        ? Math.min(terrainCullDistance, activeBattleRoyalVisibility.terrainLodCoarseDistance)
        : terrainCullDistance;
      const maxDistance = cullDistance + bounds.radius + (wasVisible ? TERRAIN_CULL_HYSTERESIS : 0);
      let nextVisible = distanceSq <= maxDistance * maxDistance;
      let nextDetail: VoxelRegionGeometryDetail = 'full';

      if (activeBattleRoyalVisibility) {
        const previousDetail = regionDetailRef.current.get(region.id) ?? 'coarse';
        const lodDistance = activeBattleRoyalVisibility.terrainLodFullDistance +
          bounds.radius +
          (previousDetail === 'full' ? TERRAIN_CULL_HYSTERESIS : 0);
        nextDetail = distanceSq <= lodDistance * lodDistance ? 'full' : 'coarse';
        detailChanged = setRegionDetail(region.id, nextDetail) || detailChanged;
      }

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
      detailChanged = setRegionDetail(closestRegionId, 'full') || detailChanged;
    }

    if (detailChanged) {
      setRegionRenderRevision((revision) => revision + 1);
    }
  };

  useFrame((state, delta) => {
    if (MOVEMENT_DIAGNOSTICS_ENABLED) {
      measureFrameWork('frame.terrainCulling', () => runTerrainCullingFrame(state, delta));
      return;
    }

    runTerrainCullingFrame(state, delta);
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
      {manifest.gameplay.mode === 'battle_royal' ? (
        <BattleRoyalOuterFill manifest={manifest} />
      ) : null}
      {visibleRegions.map((region) => {
        const detail = activeBattleRoyalVisibility?.terrainLodEnabled
          ? regionDetailRef.current.get(region.id) ?? 'coarse'
          : 'full';
        return (
          <group
            key={`${manifest.id}:${region.id}`}
            ref={(group) => setRegionGroupNode(region.id, group)}
          >
            <VoxelRegionMesh
              region={region}
              manifest={manifest}
              material={detail === 'full' ? material : farMaterial}
              shadowsEnabled={shadowsEnabled}
              buildMode={meshBuildMode}
              detail={detail}
              onGeometryReady={handleRegionGeometryReady}
            />
          </group>
        );
      })}
      <WorldDressing
        manifest={manifest}
        densityScale={dressingDensity}
        maxInstances={performanceBudget?.maxWorldDressingInstances}
        maxRenderDistance={activeBattleRoyalVisibility?.dressingCullDistance}
        shadowsEnabled={dressingShadows}
        reflectionIntensity={reflectionIntensity}
      />
    </group>
  );
}

function BattleRoyalOuterFill({ manifest }: { manifest: VoxelMapManifest }) {
  const worldWidth = manifest.size.x * manifest.voxelSize.x;
  const worldDepth = manifest.size.z * manifest.voxelSize.z;
  const centerX = manifest.origin.x + worldWidth / 2;
  const centerZ = manifest.origin.z + worldDepth / 2;
  const outerFillSize = Math.max(worldWidth, worldDepth) * BATTLE_ROYAL_OUTER_FILL_SCALE;
  const outerFillY = manifest.origin.y +
    manifest.voxelSize.y * BATTLE_ROYAL_OUTER_FILL_HEIGHT_ROWS -
    BATTLE_ROYAL_OUTER_FILL_Y_OFFSET;

  const outerFillColor = useMemo(() => {
    const color = new THREE.Color(manifest.theme.ground.side);
    color.lerp(new THREE.Color(manifest.theme.fogColor), BATTLE_ROYAL_OUTER_FILL_FOG_BLEND);
    return `#${color.getHexString()}`;
  }, [manifest.theme.fogColor, manifest.theme.ground.side]);

  const outerFillShape = useMemo(() => {
    const halfSize = outerFillSize / 2;
    const shape = new THREE.Shape([
      new THREE.Vector2(centerX - halfSize, centerZ - halfSize),
      new THREE.Vector2(centerX + halfSize, centerZ - halfSize),
      new THREE.Vector2(centerX + halfSize, centerZ + halfSize),
      new THREE.Vector2(centerX - halfSize, centerZ + halfSize),
    ]);

    if (manifest.boundary.length < 3) return shape;

    const holeCenter = manifest.boundary.reduce(
      (total, point) => ({ x: total.x + point.x, z: total.z + point.z }),
      { x: 0, z: 0 }
    );
    holeCenter.x /= manifest.boundary.length;
    holeCenter.z /= manifest.boundary.length;

    const holePoints = manifest.boundary.map((point) => {
      const dx = point.x - holeCenter.x;
      const dz = point.z - holeCenter.z;
      const distance = Math.hypot(dx, dz);
      if (distance <= 0.0001) return new THREE.Vector2(point.x, point.z);
      const paddedDistance = distance + BATTLE_ROYAL_OUTER_FILL_BOUNDARY_PADDING;
      return new THREE.Vector2(
        holeCenter.x + (dx / distance) * paddedDistance,
        holeCenter.z + (dz / distance) * paddedDistance
      );
    });
    shape.holes.push(new THREE.Path(holePoints));
    return shape;
  }, [centerX, centerZ, manifest.boundary, outerFillSize]);

  return (
    <mesh
      name="battle-royal-outer-fill"
      position={[0, outerFillY, 0]}
      rotation={[Math.PI / 2, 0, 0]}
      receiveShadow={false}
    >
      <shapeGeometry key={`${manifest.id}:battle-royal-outer-fill`} args={[outerFillShape]} />
      <meshBasicMaterial color={outerFillColor} depthWrite />
    </mesh>
  );
}
