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
import {
  clearVoxelGeometryCache,
  getVoxelGeometryCacheStats,
  prebuildVoxelRegionGeometries,
} from './meshBuilder';
import type { BattleRoyalVisibilityConfig, MaterialQualityConfig, WorldPerformanceBudget } from '../visualQuality';
import type { VoxelRegionGeometryDetail } from './meshGeometryData';
import {
  getBattleRoyalTerrainLodDistances,
  isBattleRoyalRegionInsideCullDistance,
  selectBattleRoyalTerrainDetail,
} from '../battleRoyalTerrainLod';
import {
  prepareVoxelMapCpu,
  type PreparedVoxelMap,
  type VoxelChunkRegion,
  type VoxelChunkRegionBounds,
} from '../../../utils/mapWarmup/mapPrepCache';
import {
  getBattleRoyalStartupFullDetailRegions,
  getBattleRoyalStartupRegions,
} from '../../../utils/mapWarmup/mapGeometryWarmup';
import {
  MOVEMENT_DIAGNOSTICS_ENABLED,
  measureFrameWork,
  recordTerrainRendererDiagnostics,
} from '../../../movement/networkDiagnostics';

const TERRAIN_CULL_UPDATE_INTERVAL_MS = 180;
const TERRAIN_CULL_HYSTERESIS = 18;
const TERRAIN_CULL_CAMERA_MOVE_EPSILON_SQ = 0.45 * 0.45;
const TERRAIN_CULL_CAMERA_ROTATE_EPSILON = 0.00008;
const TERRAIN_HORIZON_BIN_COUNT = 64;
const TERRAIN_HORIZON_SLOPE_EPSILON = 0.055;
const TERRAIN_HORIZON_MIN_DISTANCE_SCALE = 1.15;
const TERRAIN_CULL_DISTANCE_BUCKET_COUNT = 64;
const BATTLE_ROYAL_OUTER_FILL_SCALE = 2.75;
const BATTLE_ROYAL_OUTER_FILL_WORLD_CLEARANCE = 0.08;
const BATTLE_ROYAL_OUTER_FILL_BOUNDARY_PADDING = 2.4;
const BATTLE_ROYAL_OUTER_FILL_FOG_BLEND = 0.42;

interface BattleRoyalMacroTerrainTile extends VoxelChunkRegion {
  regions: VoxelChunkRegion[];
}

interface TerrainCullingEntry {
  region: VoxelChunkRegion;
  dx: number;
  dy: number;
  dz: number;
  distanceSq: number;
}

type RegionVisibilityTarget = Pick<VoxelChunkRegion, 'id'>;

function orderTerrainCullingEntriesByDistance(
  entries: TerrainCullingEntry[],
  orderedEntries: TerrainCullingEntry[],
  bucketCounts: Uint32Array,
  bucketOffsets: Uint32Array
): TerrainCullingEntry[] {
  const entryCount = entries.length;
  if (entryCount <= 1) return entries;

  let maxDistanceSq = 0;
  for (let index = 0; index < entryCount; index++) {
    maxDistanceSq = Math.max(maxDistanceSq, entries[index].distanceSq);
  }
  if (maxDistanceSq <= 0) return entries;

  bucketCounts.fill(0);
  const bucketScale = (TERRAIN_CULL_DISTANCE_BUCKET_COUNT - 1) / maxDistanceSq;
  for (let index = 0; index < entryCount; index++) {
    const bucket = Math.min(
      TERRAIN_CULL_DISTANCE_BUCKET_COUNT - 1,
      Math.max(0, Math.floor(entries[index].distanceSq * bucketScale))
    );
    bucketCounts[bucket]++;
  }

  let offset = 0;
  for (let bucket = 0; bucket < TERRAIN_CULL_DISTANCE_BUCKET_COUNT; bucket++) {
    bucketOffsets[bucket] = offset;
    offset += bucketCounts[bucket];
  }
  bucketCounts.fill(0);

  orderedEntries.length = entryCount;
  for (let index = 0; index < entryCount; index++) {
    const entry = entries[index];
    const bucket = Math.min(
      TERRAIN_CULL_DISTANCE_BUCKET_COUNT - 1,
      Math.max(0, Math.floor(entry.distanceSq * bucketScale))
    );
    orderedEntries[bucketOffsets[bucket] + bucketCounts[bucket]] = entry;
    bucketCounts[bucket]++;
  }

  return orderedEntries;
}

function createMacroTileBounds(regions: VoxelChunkRegion[]): VoxelChunkRegionBounds {
  const bounds: VoxelChunkRegionBounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
    center: { x: 0, y: 0, z: 0 },
    radius: 0,
  };

  for (const region of regions) {
    bounds.min.x = Math.min(bounds.min.x, region.bounds.min.x);
    bounds.min.y = Math.min(bounds.min.y, region.bounds.min.y);
    bounds.min.z = Math.min(bounds.min.z, region.bounds.min.z);
    bounds.max.x = Math.max(bounds.max.x, region.bounds.max.x);
    bounds.max.y = Math.max(bounds.max.y, region.bounds.max.y);
    bounds.max.z = Math.max(bounds.max.z, region.bounds.max.z);
  }

  bounds.center.x = (bounds.min.x + bounds.max.x) * 0.5;
  bounds.center.y = (bounds.min.y + bounds.max.y) * 0.5;
  bounds.center.z = (bounds.min.z + bounds.max.z) * 0.5;
  bounds.radius = Math.hypot(
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    bounds.max.z - bounds.min.z
  ) * 0.5;
  return bounds;
}

function createBattleRoyalMacroTerrainTiles(
  regions: VoxelChunkRegion[],
  manifest: VoxelMapManifest,
  visibilityBudget?: BattleRoyalVisibilityConfig
): BattleRoyalMacroTerrainTile[] {
  const tileSize = visibilityBudget?.terrainMacroTileSize ?? 0;
  if (manifest.gameplay.mode !== 'battle_royal' || !visibilityBudget?.terrainLodEnabled || tileSize <= 0) {
    return [];
  }

  const regionsByTile = new Map<string, VoxelChunkRegion[]>();
  for (const region of regions) {
    const tileX = Math.floor((region.bounds.center.x - manifest.origin.x) / tileSize);
    const tileZ = Math.floor((region.bounds.center.z - manifest.origin.z) / tileSize);
    const tileId = `${tileX}:${tileZ}`;
    const tileRegions = regionsByTile.get(tileId);
    if (tileRegions) {
      tileRegions.push(region);
    } else {
      regionsByTile.set(tileId, [region]);
    }
  }

  return Array.from(regionsByTile.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, tileRegions]) => ({
      id: `macro:${id}`,
      regions: tileRegions,
      chunks: tileRegions.flatMap((region) => region.chunks),
      castShadow: false,
      bounds: createMacroTileBounds(tileRegions),
    }));
}

function areSetsEqual<T>(left: Set<T>, right: Set<T>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

export function shouldHideBattleRoyalRegionForMacroTile(input: {
  active: boolean;
  macroGeometryReady: boolean;
  regionVisible: boolean;
  regionDetail: VoxelRegionGeometryDetail;
}): boolean {
  return input.active && input.macroGeometryReady && input.regionVisible && input.regionDetail === 'ultraCoarse';
}

export function getBattleRoyalOuterFillY(manifest: Pick<VoxelMapManifest, 'origin'>): number {
  return manifest.origin.y - BATTLE_ROYAL_OUTER_FILL_WORLD_CLEARANCE;
}

function getHorizonBin(dx: number, dz: number): number {
  const normalizedAngle = (Math.atan2(dz, dx) + Math.PI) / (Math.PI * 2);
  return Math.max(0, Math.min(TERRAIN_HORIZON_BIN_COUNT - 1, Math.floor(normalizedAngle * TERRAIN_HORIZON_BIN_COUNT)));
}

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
  warmupRequiredRegionCount: number;
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
  const activeBattleRoyalTerrainLodEnabled = activeBattleRoyalVisibility?.terrainLodEnabled ?? false;
  const activeBattleRoyalTerrainMacroTileSize = activeBattleRoyalVisibility?.terrainMacroTileSize ?? 0;
  const activeBattleRoyalTerrainPrebuildFullDistance = activeBattleRoyalVisibility?.terrainPrebuildFullDistance;
  const renderableRegions = useMemo(
    () => prioritizeRenderableRegions(preparedMap.renderableRegions, manifest, activeBattleRoyalVisibility),
    [activeBattleRoyalTerrainLodEnabled, manifest, preparedMap.renderableRegions]
  );
  const battleRoyalStartupRegions = useMemo(
    () => (
      activeBattleRoyalVisibility?.terrainLodEnabled
        ? getBattleRoyalStartupRegions(preparedMap, {
          battleRoyalFullDetailDistance: activeBattleRoyalVisibility.terrainPrebuildFullDistance,
        })
        : renderableRegions
    ),
    [
      activeBattleRoyalTerrainLodEnabled,
      activeBattleRoyalTerrainPrebuildFullDistance,
      preparedMap,
      renderableRegions,
    ]
  );
  const warmupRequiredRegionCount = activeBattleRoyalVisibility?.terrainLodEnabled
    ? Math.min(renderableRegions.length, battleRoyalStartupRegions.length)
    : renderableRegions.length;
  const macroTerrainTiles = useMemo(
    () => createBattleRoyalMacroTerrainTiles(renderableRegions, manifest, activeBattleRoyalVisibility),
    [activeBattleRoyalTerrainLodEnabled, activeBattleRoyalTerrainMacroTileSize, manifest, renderableRegions]
  );
  const material = useVoxelMaterial(manifest.theme, materialQuality);
  const farMaterial = useVoxelFarMaterial(manifest.theme, activeBattleRoyalVisibility?.farTerrainFogBlend ?? 0.52);
  const collidersLoadedRef = useRef(false);
  const didSignalReadyRef = useRef<string | null>(null);
  const regionRevealBudgetRef = useRef(performanceBudget?.maxGeneratedRegionMeshesPerFrame ?? 3);
  const readyRegionManifestIdRef = useRef(manifest.id);
  const readyRegionIdsRef = useRef<Set<string>>(new Set());
  const readyRegionCountRafRef = useRef(0);
  const terrainCullAccumulatorRef = useRef(0);
  const terrainCullNeedsRefreshRef = useRef(true);
  const terrainCullLastCameraPositionRef = useRef(new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN));
  const terrainCullLastCameraQuaternionRef = useRef(new THREE.Quaternion());
  const terrainCullEntriesRef = useRef<TerrainCullingEntry[]>([]);
  const terrainCullOrderedEntriesRef = useRef<TerrainCullingEntry[]>([]);
  const terrainCullBucketCountsRef = useRef(new Uint32Array(TERRAIN_CULL_DISTANCE_BUCKET_COUNT));
  const terrainCullBucketOffsetsRef = useRef(new Uint32Array(TERRAIN_CULL_DISTANCE_BUCKET_COUNT));
  const terrainHorizonSlopesRef = useRef(new Float32Array(TERRAIN_HORIZON_BIN_COUNT));
  const regionVisibilityRef = useRef<Map<string, boolean>>(new Map());
  const regionDetailRef = useRef<Map<string, VoxelRegionGeometryDetail>>(new Map());
  const regionGroupsRef = useRef<Map<string, THREE.Group>>(new Map());
  const activeMacroTileIdsRef = useRef<Set<string>>(new Set());
  const readyMacroTileIdsRef = useRef<Set<string>>(new Set());
  const macroHiddenRegionIdsRef = useRef<Set<string>>(new Set());
  const terrainCullFrustumRef = useRef(new THREE.Frustum());
  const terrainCullMatrixRef = useRef(new THREE.Matrix4());
  const terrainCullSphereRef = useRef(new THREE.Sphere());
  const shouldRevealAllRegions = meshBuildMode === 'sync' || !progressiveReveal;
  const [visibleRegionCount, setVisibleRegionCount] = useState(() => (
    shouldRevealAllRegions ? renderableRegions.length : 0
  ));
  const [regionRenderRevision, setRegionRenderRevision] = useState(0);
  const [readyRegionCount, setReadyRegionCount] = useState(0);
  const [collidersReady, setCollidersReady] = useState(!enablePhysics);
  const terrainCullDistance = useMemo(
    () => getRuntimeTerrainCullDistance(performanceBudget, activeBattleRoyalVisibility),
    [activeBattleRoyalTerrainLodEnabled, activeBattleRoyalVisibility?.terrainCullDistance, performanceBudget?.drawCalls]
  );
  const effectiveReadyRegionCount = readyRegionManifestIdRef.current === manifest.id ? readyRegionCount : 0;
  const terrainReady = (
    visibleRegionCount >= warmupRequiredRegionCount &&
    effectiveReadyRegionCount >= warmupRequiredRegionCount
  );
  const isReady = terrainReady && collidersReady;

  const applyRegionGroupVisibility = useCallback((regionId: string) => {
    const group = regionGroupsRef.current.get(regionId);
    if (!group) return;
    const logicallyVisible = regionVisibilityRef.current.get(regionId) ?? true;
    group.visible = logicallyVisible && !macroHiddenRegionIdsRef.current.has(regionId);
  }, []);

  const setRegionVisibility = useCallback((regionId: string, visible: boolean) => {
    const visibility = regionVisibilityRef.current;
    if (visibility.get(regionId) === visible) {
      applyRegionGroupVisibility(regionId);
      return;
    }
    visibility.set(regionId, visible);
    applyRegionGroupVisibility(regionId);
  }, [applyRegionGroupVisibility]);

  const applyRegionGroupVisibilityForRegions = useCallback((regions: RegionVisibilityTarget[]) => {
    for (const region of regions) {
      applyRegionGroupVisibility(region.id);
    }
  }, [applyRegionGroupVisibility]);

  const refreshMacroHiddenRegions = useCallback((regionsToRefresh: RegionVisibilityTarget[]) => {
    const nextHiddenRegionIds = new Set<string>();
    const activeMacroTileIds = activeMacroTileIdsRef.current;
    const readyMacroTileIds = readyMacroTileIdsRef.current;

    for (const tile of macroTerrainTiles) {
      const tileActive = activeMacroTileIds.has(tile.id);
      const macroGeometryReady = readyMacroTileIds.has(tile.id);
      if (!tileActive || !macroGeometryReady) continue;

      for (const region of tile.regions) {
        if (shouldHideBattleRoyalRegionForMacroTile({
          active: tileActive,
          macroGeometryReady,
          regionVisible: regionVisibilityRef.current.get(region.id) ?? false,
          regionDetail: regionDetailRef.current.get(region.id) ?? 'ultraCoarse',
        })) {
          nextHiddenRegionIds.add(region.id);
        }
      }
    }

    macroHiddenRegionIdsRef.current = nextHiddenRegionIds;
    applyRegionGroupVisibilityForRegions(regionsToRefresh);
  }, [applyRegionGroupVisibilityForRegions, macroTerrainTiles]);

  const setActiveMacroTiles = useCallback((
    nextActiveMacroTileIds: Set<string>,
    regionsToRefresh: RegionVisibilityTarget[]
  ): boolean => {
    const previousActiveMacroTileIds = activeMacroTileIdsRef.current;
    const changed = !areSetsEqual(previousActiveMacroTileIds, nextActiveMacroTileIds);
    activeMacroTileIdsRef.current = nextActiveMacroTileIds;

    refreshMacroHiddenRegions(regionsToRefresh);
    return changed;
  }, [refreshMacroHiddenRegions]);

  const getActiveMacroTerrainTiles = useCallback((): BattleRoyalMacroTerrainTile[] => {
    const activeIds = activeMacroTileIdsRef.current;
    if (activeIds.size === 0) return [];
    return macroTerrainTiles.filter((tile) => activeIds.has(tile.id));
  }, [macroTerrainTiles]);

  const activeMacroTerrainTiles = useMemo(
    () => getActiveMacroTerrainTiles(),
    [getActiveMacroTerrainTiles, regionRenderRevision]
  );

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
    applyRegionGroupVisibility(regionId);
  }, [applyRegionGroupVisibility]);

  useEffect(() => {
    regionRevealBudgetRef.current = Math.max(1, performanceBudget?.maxGeneratedRegionMeshesPerFrame ?? 3);
  }, [performanceBudget?.maxGeneratedRegionMeshesPerFrame]);

  useEffect(() => {
    terrainCullAccumulatorRef.current = 0;
    terrainCullNeedsRefreshRef.current = true;
    terrainCullLastCameraPositionRef.current.set(Number.NaN, Number.NaN, Number.NaN);
    terrainCullLastCameraQuaternionRef.current.identity();
  }, [
    activeBattleRoyalTerrainLodEnabled,
    activeBattleRoyalVisibility?.terrainCullDistance,
    activeBattleRoyalVisibility?.terrainLodFullDistance,
    activeBattleRoyalVisibility?.terrainLodCoarseDistance,
    activeBattleRoyalVisibility?.terrainLodUltraCoarseDistance,
    activeBattleRoyalVisibility?.terrainMacroTileSize,
    terrainCullDistance,
  ]);

  useEffect(() => {
    terrainCullAccumulatorRef.current = 0;
    terrainCullNeedsRefreshRef.current = true;
    terrainCullLastCameraPositionRef.current.set(Number.NaN, Number.NaN, Number.NaN);
    terrainCullLastCameraQuaternionRef.current.identity();
    regionVisibilityRef.current.clear();
    regionDetailRef.current.clear();
    activeMacroTileIdsRef.current = new Set();
    readyMacroTileIdsRef.current = new Set();
    macroHiddenRegionIdsRef.current = new Set();
    for (const group of regionGroupsRef.current.values()) {
      group.visible = true;
    }
    setRegionRenderRevision((revision) => revision + 1);
  }, [activeBattleRoyalTerrainLodEnabled, manifest.id]);

  useEffect(() => {
    activeMacroTileIdsRef.current = new Set();
    readyMacroTileIdsRef.current = new Set();
    macroHiddenRegionIdsRef.current = new Set();
    terrainCullNeedsRefreshRef.current = true;
    for (const [regionId, group] of regionGroupsRef.current) {
      group.visible = regionVisibilityRef.current.get(regionId) ?? true;
    }
    setRegionRenderRevision((revision) => revision + 1);
  }, [activeBattleRoyalTerrainMacroTileSize, manifest.id]);

  useEffect(() => {
    if (!prebuildRegions) return;

    let cancelled = false;
    const prebuild = async () => {
      if (activeBattleRoyalVisibility) {
        const startupRegions = getBattleRoyalStartupRegions(preparedMap, {
          battleRoyalFullDetailDistance: activeBattleRoyalVisibility.terrainPrebuildFullDistance,
        });
        const fullDetailRegions = getBattleRoyalStartupFullDetailRegions(preparedMap, {
          battleRoyalFullDetailDistance: activeBattleRoyalVisibility.terrainPrebuildFullDistance,
        });
        await prebuildVoxelRegionGeometries(
          manifest,
          startupRegions,
          { detail: 'ultraCoarse', frameBudgetMs: 4 }
        );
        if (cancelled) return;
        await prebuildVoxelRegionGeometries(
          manifest,
          fullDetailRegions,
          { detail: 'full', frameBudgetMs: 4 }
        );
        if (cancelled) return;
        await prebuildVoxelRegionGeometries(
          manifest,
          startupRegions,
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
  }, [
    activeBattleRoyalTerrainLodEnabled,
    activeBattleRoyalTerrainPrebuildFullDistance,
    manifest,
    prebuildRegions,
    preparedMap,
    renderableRegions,
  ]);

  useEffect(() => {
    const targetRegionCount = shouldRevealAllRegions || terrainReady
      ? renderableRegions.length
      : warmupRequiredRegionCount;

    if (shouldRevealAllRegions) {
      setVisibleRegionCount(targetRegionCount);
      return;
    }

    let cancelled = false;
    let rafId = 0;
    let nextVisibleCount = Math.min(
      targetRegionCount,
      Math.max(visibleRegionCount, regionRevealBudgetRef.current)
    );

    setVisibleRegionCount(nextVisibleCount);

    const revealNextBatch = () => {
      if (cancelled) return;
      nextVisibleCount = Math.min(
        targetRegionCount,
        nextVisibleCount + regionRevealBudgetRef.current
      );
      setVisibleRegionCount(nextVisibleCount);

      if (nextVisibleCount < targetRegionCount) {
        rafId = window.requestAnimationFrame(revealNextBatch);
      }
    };

    if (nextVisibleCount < targetRegionCount) {
      rafId = window.requestAnimationFrame(revealNextBatch);
    }

    return () => {
      cancelled = true;
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [manifest.id, renderableRegions, shouldRevealAllRegions, terrainReady, warmupRequiredRegionCount]);

  const cancelReadyRegionCountFlush = useCallback(() => {
    if (readyRegionCountRafRef.current && typeof window !== 'undefined') {
      window.cancelAnimationFrame(readyRegionCountRafRef.current);
    }
    readyRegionCountRafRef.current = 0;
  }, []);

  const flushReadyRegionCount = useCallback(() => {
    readyRegionCountRafRef.current = 0;
    const nextReadyRegionCount = readyRegionIdsRef.current.size;
    setReadyRegionCount((previousReadyRegionCount) => (
      previousReadyRegionCount === nextReadyRegionCount ? previousReadyRegionCount : nextReadyRegionCount
    ));
  }, []);

  const scheduleReadyRegionCountFlush = useCallback(() => {
    if (readyRegionCountRafRef.current) return;
    if (typeof window === 'undefined') {
      flushReadyRegionCount();
      return;
    }

    readyRegionCountRafRef.current = window.requestAnimationFrame(flushReadyRegionCount);
  }, [flushReadyRegionCount]);

  const resetReadyRegionTracking = useCallback(() => {
    readyRegionManifestIdRef.current = manifest.id;
    readyRegionIdsRef.current = new Set();
    cancelReadyRegionCountFlush();
    setReadyRegionCount((previousReadyRegionCount) => (
      previousReadyRegionCount === 0 ? previousReadyRegionCount : 0
    ));
  }, [cancelReadyRegionCountFlush, manifest.id]);

  const handleRegionGeometryReady = useCallback((regionId: string) => {
    if (readyRegionManifestIdRef.current !== manifest.id) {
      resetReadyRegionTracking();
    }

    if (readyRegionIdsRef.current.has(regionId)) return;
    readyRegionIdsRef.current.add(regionId);
    scheduleReadyRegionCountFlush();
  }, [manifest.id, resetReadyRegionTracking, scheduleReadyRegionCountFlush]);

  const handleMacroTileGeometryReady = useCallback((tile: BattleRoyalMacroTerrainTile) => {
    const wasReady = readyMacroTileIdsRef.current.has(tile.id);
    readyMacroTileIdsRef.current.add(tile.id);

    for (const region of tile.regions) {
      handleRegionGeometryReady(region.id);
    }

    if (!wasReady && activeMacroTileIdsRef.current.has(tile.id)) {
      refreshMacroHiddenRegions(tile.regions);
    }
  }, [handleRegionGeometryReady, refreshMacroHiddenRegions]);

  useEffect(() => {
    if (readyRegionManifestIdRef.current === manifest.id) return;
    resetReadyRegionTracking();
  }, [manifest.id, resetReadyRegionTracking]);

  useEffect(() => () => {
    cancelReadyRegionCountFlush();
  }, [cancelReadyRegionCountFlush]);

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

  const visibleRegions = useMemo(
    () => renderableRegions.slice(0, visibleRegionCount),
    [renderableRegions, visibleRegionCount]
  );

  const runTerrainCullingFrame = (state: RootState, delta: number): void => {
    if (visibleRegions.length === 0) return;
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

    const entries = terrainCullEntriesRef.current;
    entries.length = visibleRegions.length;
    for (let index = 0; index < visibleRegions.length; index++) {
      const region = visibleRegions[index];
      const { bounds } = region;
      const dx = bounds.center.x - camera.position.x;
      const dy = bounds.center.y - camera.position.y;
      const dz = bounds.center.z - camera.position.z;
      const existingEntry = entries[index];
      if (existingEntry) {
        existingEntry.region = region;
        existingEntry.dx = dx;
        existingEntry.dy = dy;
        existingEntry.dz = dz;
        existingEntry.distanceSq = dx * dx + dy * dy + dz * dz;
      } else {
        entries[index] = {
          region,
          dx,
          dy,
          dz,
          distanceSq: dx * dx + dy * dy + dz * dz,
        };
      }
    }
    const orderedEntries = orderTerrainCullingEntriesByDistance(
      entries,
      terrainCullOrderedEntriesRef.current,
      terrainCullBucketCountsRef.current,
      terrainCullBucketOffsetsRef.current
    );
    const battleRoyalLodDistances = activeBattleRoyalVisibility
      ? getBattleRoyalTerrainLodDistances({
        manifest,
        visibility: activeBattleRoyalVisibility,
        cameraPosition: camera.position,
      })
      : null;
    const horizonSlopes = activeBattleRoyalVisibility
      ? terrainHorizonSlopesRef.current.fill(Number.NEGATIVE_INFINITY)
      : null;
    const cameraFovDegrees = 'fov' in camera ? (camera as THREE.PerspectiveCamera).fov : 75;

    let closestRegion: VoxelChunkRegion | null = null;
    let closestDistanceSq = Infinity;
    let visibleAfterCull = 0;
    let fullDetailRegionCount = 0;
    let coarseRegionCount = 0;
    let ultraCoarseRegionCount = 0;
    let closestVisibleRegion: VoxelChunkRegion | null = null;
    let closestVisibleDistanceSq = Infinity;
    let hiddenByDistance = 0;
    let hiddenByFrustum = 0;
    let hiddenByHorizon = 0;
    let detailSwaps = 0;
    let detailChanged = false;

    for (const entry of orderedEntries) {
      const { region, dx, dz, distanceSq } = entry;
      const { bounds } = region;
      if (distanceSq < closestDistanceSq) {
        closestDistanceSq = distanceSq;
        closestRegion = region;
      }

      const wasVisible = regionVisibilityRef.current.get(region.id) ?? true;
      let nextDetail: VoxelRegionGeometryDetail = 'full';
      let nextVisible = true;

      if (activeBattleRoyalVisibility && battleRoyalLodDistances) {
        nextVisible = isBattleRoyalRegionInsideCullDistance({
          manifest,
          visibility: activeBattleRoyalVisibility,
          lodDistances: battleRoyalLodDistances,
          cameraPosition: camera.position,
          regionBounds: bounds,
          distanceSq,
          wasVisible,
        });
        if (!nextVisible) hiddenByDistance++;

        nextDetail = nextVisible
          ? selectBattleRoyalTerrainDetail({
            manifest,
            visibility: activeBattleRoyalVisibility,
            lodDistances: battleRoyalLodDistances,
            cameraPosition: camera.position,
            regionBounds: bounds,
            distanceSq,
            previousDetail: regionDetailRef.current.get(region.id),
            viewportHeight: state.size.height,
            cameraFovDegrees,
          })
          : 'ultraCoarse';
      } else {
        const maxDistance = terrainCullDistance + bounds.radius + (wasVisible ? TERRAIN_CULL_HYSTERESIS : 0);
        nextVisible = distanceSq <= maxDistance * maxDistance;
        if (!nextVisible) hiddenByDistance++;
      }

      if (nextVisible) {
        sphere.center.set(bounds.center.x, bounds.center.y, bounds.center.z);
        sphere.radius = bounds.radius + (wasVisible ? TERRAIN_CULL_HYSTERESIS : 0);
        nextVisible = frustum.intersectsSphere(sphere);
        if (!nextVisible) hiddenByFrustum++;
      }

      if (nextVisible && activeBattleRoyalVisibility && battleRoyalLodDistances && horizonSlopes) {
        const horizontalDistance = Math.max(0.001, Math.hypot(dx, dz));
        const bin = getHorizonBin(dx, dz);
        const topSlope = (bounds.max.y + manifest.voxelSize.y * 2 - camera.position.y) / horizontalDistance;
        const shouldApplyHorizon = horizontalDistance > battleRoyalLodDistances.coarse * TERRAIN_HORIZON_MIN_DISTANCE_SCALE;

        if (shouldApplyHorizon && topSlope < horizonSlopes[bin] - TERRAIN_HORIZON_SLOPE_EPSILON) {
          nextVisible = false;
          hiddenByHorizon++;
        } else {
          horizonSlopes[bin] = Math.max(horizonSlopes[bin], topSlope);
          horizonSlopes[(bin + TERRAIN_HORIZON_BIN_COUNT - 1) % TERRAIN_HORIZON_BIN_COUNT] = Math.max(
            horizonSlopes[(bin + TERRAIN_HORIZON_BIN_COUNT - 1) % TERRAIN_HORIZON_BIN_COUNT],
            topSlope - TERRAIN_HORIZON_SLOPE_EPSILON * 0.5
          );
          horizonSlopes[(bin + 1) % TERRAIN_HORIZON_BIN_COUNT] = Math.max(
            horizonSlopes[(bin + 1) % TERRAIN_HORIZON_BIN_COUNT],
            topSlope - TERRAIN_HORIZON_SLOPE_EPSILON * 0.5
          );
        }
      }

      if (setRegionDetail(region.id, nextDetail)) {
        detailChanged = true;
        detailSwaps++;
      }

      if (nextVisible) {
        visibleAfterCull++;
        if (distanceSq < closestVisibleDistanceSq) {
          closestVisibleDistanceSq = distanceSq;
          closestVisibleRegion = region;
        }
        if (nextDetail === 'full') {
          fullDetailRegionCount++;
        } else if (nextDetail === 'coarse') {
          coarseRegionCount++;
        } else {
          ultraCoarseRegionCount++;
        }
      }
      setRegionVisibility(region.id, nextVisible);
    }

    if (visibleAfterCull === 0 && closestRegion) {
      setRegionVisibility(closestRegion.id, true);
      if (setRegionDetail(closestRegion.id, 'full')) {
        detailChanged = true;
        detailSwaps++;
      }
      visibleAfterCull = 1;
      fullDetailRegionCount = 1;
      closestVisibleRegion = closestRegion;
    }

    if (activeBattleRoyalVisibility && visibleAfterCull > 0 && fullDetailRegionCount === 0 && closestVisibleRegion) {
      const previousDetail = regionDetailRef.current.get(closestVisibleRegion.id) ?? 'ultraCoarse';
      if (setRegionDetail(closestVisibleRegion.id, 'full')) {
        detailChanged = true;
        detailSwaps++;
      }
      fullDetailRegionCount = 1;
      if (previousDetail === 'coarse') {
        coarseRegionCount = Math.max(0, coarseRegionCount - 1);
      } else if (previousDetail === 'ultraCoarse') {
        ultraCoarseRegionCount = Math.max(0, ultraCoarseRegionCount - 1);
      }
    }

    const nextActiveMacroTileIds = new Set<string>();
    if (activeBattleRoyalVisibility) {
      for (const tile of macroTerrainTiles) {
        let hasUltraCoarseVisibleRegion = false;
        let hasNearVisibleRegion = false;

        for (const region of tile.regions) {
          if (!(regionVisibilityRef.current.get(region.id) ?? false)) continue;
          const detail = regionDetailRef.current.get(region.id) ?? 'ultraCoarse';
          if (detail === 'ultraCoarse') {
            hasUltraCoarseVisibleRegion = true;
          } else {
            hasNearVisibleRegion = true;
            break;
          }
        }

        if (hasUltraCoarseVisibleRegion && !hasNearVisibleRegion) {
          nextActiveMacroTileIds.add(tile.id);
        }
      }
    }

    const macroChanged = setActiveMacroTiles(nextActiveMacroTileIds, visibleRegions);
    if (detailChanged || macroChanged) {
      setRegionRenderRevision((revision) => revision + 1);
    }

    if (activeBattleRoyalVisibility) {
      const cacheStats = getVoxelGeometryCacheStats();
      recordTerrainRendererDiagnostics({
        visibleRegionCount: visibleAfterCull,
        fullDetailRegionCount,
        coarseRegionCount,
        ultraCoarseRegionCount,
        macroMeshCount: nextActiveMacroTileIds.size,
        macroRegionCount: macroHiddenRegionIdsRef.current.size,
        hiddenByDistance,
        hiddenByFrustum,
        hiddenByHorizon,
        pendingRegionBuilds: cacheStats.pendingRegionBuilds,
        pendingRegionFinalizations: cacheStats.pendingRegionFinalizations,
        adaptiveVisibilityScale: activeBattleRoyalVisibility.adaptiveVisibilityScale,
        detailSwaps,
      });
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
      warmupRequiredRegionCount,
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
    warmupRequiredRegionCount,
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
      {activeMacroTerrainTiles.map((tile) => (
        <VoxelRegionMesh
          key={`${manifest.id}:${tile.id}:ultraCoarse`}
          region={tile}
          manifest={manifest}
          material={farMaterial}
          shadowsEnabled={false}
          buildMode={meshBuildMode}
          detail="ultraCoarse"
          onGeometryReady={() => handleMacroTileGeometryReady(tile)}
        />
      ))}
      {visibleRegions.map((region) => {
        const detail = activeBattleRoyalVisibility?.terrainLodEnabled
          ? regionDetailRef.current.get(region.id) ?? 'ultraCoarse'
          : 'full';
        return (
          <group
            key={`${manifest.id}:${region.id}`}
            ref={(group) => setRegionGroupNode(region.id, group)}
          >
            <VoxelRegionMesh
              region={region}
              manifest={manifest}
              material={detail === 'ultraCoarse' ? farMaterial : material}
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
  const outerFillY = getBattleRoyalOuterFillY(manifest);

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
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow={false}
    >
      <shapeGeometry key={`${manifest.id}:battle-royal-outer-fill`} args={[outerFillShape]} />
      <meshBasicMaterial color={outerFillColor} depthWrite />
    </mesh>
  );
}
