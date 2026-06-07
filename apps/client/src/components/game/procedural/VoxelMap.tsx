import { useEffect, useMemo, useRef } from 'react';
import { generateProceduralVoxelMap } from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { areProceduralMapCollidersLoaded, isPhysicsReady, loadProceduralMapColliders } from '../../../hooks/usePhysics';
import { setMapBoundaryPolygon } from '../../../config/mapBoundaries';
import { useVoxelMaterial } from './materials';
import { VoxelChunkMesh } from './VoxelChunkMesh';
import { WorldDressing } from './WorldDressing';
import { clearVoxelGeometryCache } from './meshBuilder';
import type { VoxelMaterialDetail } from '../visualQuality';

interface VoxelMapProps {
  seed?: number;
  enablePhysics?: boolean;
  shadowsEnabled: boolean;
  dressingShadows: boolean;
  dressingDensity: number;
  reflectionIntensity: number;
  materialDetail: VoxelMaterialDetail;
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
  const manifest = useMemo(() => generateProceduralVoxelMap(mapSeed), [mapSeed]);
  const material = useVoxelMaterial(manifest.theme, { reflectionIntensity, detail: materialDetail });
  const collidersLoadedRef = useRef(false);

  useEffect(() => () => {
    clearVoxelGeometryCache(manifest.id);
  }, [manifest.id]);

  useEffect(() => {
    if (!enablePhysics) return;

    collidersLoadedRef.current = false;
    setMapBoundaryPolygon(manifest.boundary);

    if (collidersLoadedRef.current || areProceduralMapCollidersLoaded(manifest.id)) {
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
      {manifest.chunks.map((chunk) => (
        <VoxelChunkMesh
          key={`${chunk.coord.x}:${chunk.coord.y}:${chunk.coord.z}`}
          chunk={chunk}
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
