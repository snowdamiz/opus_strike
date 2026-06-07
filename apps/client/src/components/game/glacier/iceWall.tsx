import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { type IceWallRushData } from '../../../store/gameStore';
import { isPhysicsReady, addIceWallCollider } from '../../../hooks/usePhysics';
import { SHARED_GEOMETRIES } from '../effectResources';
import { ICE_WALL_DURATION, ICE_WALL_SEGMENT_DEPTH } from '@voxel-strike/shared';
import { getFrameClock } from '../../../utils/frameClock';
import {
  tempVec3,
  tempMatrix,
  tempQuaternion,
  tempScale,
  tempEuler,
  getWallCrystalGeometry,
  getWallMaterials,
  CRYSTALS_PER_SEGMENT,
  MAX_WALL_SEGMENTS,
  MAX_WALL_CRYSTALS,
  CRYSTAL_LAYOUT,
} from './materials';

// ============================================================================
// ICE WALL RUSH - Glacier E ability
// Optimized: InstancedMesh for crystals, single useFrame
// ============================================================================

const ICE_WALL_RISE_DURATION = 0.3;
const ICE_WALL_FADE_DURATION = 1.0;
const FRAME_TIME_ORIGIN =
  typeof performance !== 'undefined' && typeof performance.timeOrigin === 'number'
    ? performance.timeOrigin
    : 0;

interface IceWallRushProps {
  rush: IceWallRushData;
}

function getSegmentFrameCreatedAt(segment: IceWallRushData['segments'][number]): number {
  if (segment.createdFrameAt !== undefined) return segment.createdFrameAt;
  return FRAME_TIME_ORIGIN > 0 ? segment.createdAt - FRAME_TIME_ORIGIN : segment.createdAt;
}

export const IceWallRush = React.memo(({ rush }: IceWallRushProps) => {
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const frostMeshesRef = useRef<Map<number, THREE.Mesh>>(new Map());
  // Track which segments have colliders registered
  const registeredCollidersRef = useRef<Set<string>>(new Set());
  
  const { wallCrystalMaterial, wallFrostMaterial } = getWallMaterials();
  const crystalGeometry = getWallCrystalGeometry();
  
  useFrame(() => {
    const mesh = instancedMeshRef.current;
    if (!mesh) return;
    
    const now = getFrameClock().nowMs;
    const sourceSegments = rush.segments;
    const segmentStartIndex = Math.max(0, sourceSegments.length - MAX_WALL_SEGMENTS);
    const visibleSegmentCount = sourceSegments.length - segmentStartIndex;
    const fadeStart = ICE_WALL_DURATION - ICE_WALL_FADE_DURATION;
    let fadeTotal = 0;
    
    for (let segIdx = 0; segIdx < visibleSegmentCount; segIdx++) {
      const segment = sourceSegments[segmentStartIndex + segIdx];
      const age = (now - getSegmentFrameCreatedAt(segment)) / 1000;
      const fadeProgress = age > fadeStart ? Math.min((age - fadeStart) / ICE_WALL_FADE_DURATION, 1) : 0;
      fadeTotal += fadeProgress;
      // Use createdAt for stable ID - segIdx shifts as array is sliced
      const segmentId = `${rush.id}_${segment.createdAt}`;
      
      // Register collider for new segments (if physics ready and not already registered)
      if (!registeredCollidersRef.current.has(segmentId) && age < fadeStart) {
        if (isPhysicsReady()) {
          // Add collision box for this wall segment
          const colliderAdded = addIceWallCollider(
            segmentId,
            segment.position.x,
            segment.position.y,
            segment.position.z,
            segment.rotation,
            segment.width,    // width
            segment.height,   // height  
            ICE_WALL_SEGMENT_DEPTH // depth/thickness
          );
          if (colliderAdded) {
            registeredCollidersRef.current.add(segmentId);
          }
        }
      }
      
      if (age >= ICE_WALL_DURATION) {
        for (let c = 0; c < CRYSTALS_PER_SEGMENT; c++) {
          tempScale.set(0, 0, 0);
          tempMatrix.compose(tempVec3, tempQuaternion, tempScale);
          mesh.setMatrixAt(segIdx * CRYSTALS_PER_SEGMENT + c, tempMatrix);
        }
        const frostMesh = frostMeshesRef.current.get(segIdx);
        if (frostMesh) {
          frostMesh.scale.setScalar(0);
          (frostMesh.material as THREE.MeshBasicMaterial).opacity = 0;
        }
        continue;
      }
      
      // Eased sink progress - starts slow, accelerates as it sinks (ease-in)
      const sinkProgress = fadeProgress > 0 ? Math.pow(fadeProgress, 2) : 0;
      
      for (let crystalIdx = 0; crystalIdx < CRYSTAL_LAYOUT.length; crystalIdx++) {
        const config = CRYSTAL_LAYOUT[crystalIdx];
        const idx = segIdx * CRYSTALS_PER_SEGMENT + crystalIdx;
        if (idx >= MAX_WALL_CRYSTALS) continue;
        
        const crystalRiseProgress = Math.min(Math.max(0, (age - config.delay) / ICE_WALL_RISE_DURATION), 1);
        const crystalEasedRise = 1 - Math.pow(1 - crystalRiseProgress, 3);
        
        // Full height when risen, then sink back down during fade
        const maxHeight = segment.height * config.heightMult * crystalEasedRise;
        // Stagger the sink - crystals on edges sink first (like they're crumbling inward)
        const staggeredSink = Math.min(1, sinkProgress + Math.abs(config.tOffset) * 0.3);
        const sinkFactor = 1 - staggeredSink;
        const height = maxHeight * sinkFactor;
        
        const cosR = Math.cos(segment.rotation);
        const sinR = Math.sin(segment.rotation);
        const localX = config.tOffset * segment.width;
        // Y position: base at ground, crystal sinks down so we keep bottom at ground level
        const yPos = segment.position.y + height / 2;
        tempVec3.set(segment.position.x + localX * cosR, yPos, segment.position.z + localX * sinR);
        
        tempEuler.set(0, segment.rotation, config.rotZ);
        tempQuaternion.setFromEuler(tempEuler);
        
        // Scale shrinks as crystal sinks - width shrinks slightly, height matches sink
        const widthFade = 1 - sinkProgress * 0.3;
        tempScale.set(config.widthBase * widthFade, Math.max(0.01, height), config.widthBase * 0.7 * widthFade);
        
        tempMatrix.compose(tempVec3, tempQuaternion, tempScale);
        mesh.setMatrixAt(idx, tempMatrix);
      }
      
      const frostMesh = frostMeshesRef.current.get(segIdx);
      if (frostMesh) {
        const riseProgress = Math.min(age / ICE_WALL_RISE_DURATION, 1);
        // Frost patch shrinks as crystals sink back down
        const frostScale = (1 - Math.pow(1 - riseProgress, 3)) * (1 - sinkProgress * 0.8);
        frostMesh.scale.setScalar(segment.width * 0.5 * frostScale);
        (frostMesh.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - fadeProgress);
      }
    }
    
    const usedCrystalSlots = visibleSegmentCount * CRYSTALS_PER_SEGMENT;
    for (let i = usedCrystalSlots; i < MAX_WALL_CRYSTALS; i++) {
      tempScale.set(0, 0, 0);
      tempMatrix.compose(tempVec3, tempQuaternion, tempScale);
      mesh.setMatrixAt(i, tempMatrix);
    }
    
    mesh.instanceMatrix.needsUpdate = true;
    
    // Update material opacity
    const avgFade = visibleSegmentCount > 0 ? fadeTotal / visibleSegmentCount : 0;
    wallCrystalMaterial.opacity = 0.9 * (1 - avgFade * 0.3);
    wallCrystalMaterial.emissiveIntensity = 0.2 * (1 - avgFade * 0.5);
  });
  
  const now = getFrameClock().nowMs;
  const renderedSegments: Array<{ segment: IceWallRushData['segments'][number]; segIdx: number }> = [];
  const renderStartIndex = Math.max(0, rush.segments.length - MAX_WALL_SEGMENTS);
  for (let i = renderStartIndex; i < rush.segments.length; i++) {
    renderedSegments.push({ segment: rush.segments[i], segIdx: i - renderStartIndex });
  }
  
  return (
    <group>
      <instancedMesh ref={instancedMeshRef} args={[crystalGeometry!, wallCrystalMaterial, MAX_WALL_CRYSTALS]} frustumCulled={false} />
      {renderedSegments.map(({ segment, segIdx }) => (
        <mesh
          key={segIdx}
          ref={el => {
            if (el) frostMeshesRef.current.set(segIdx, el);
            else frostMeshesRef.current.delete(segIdx);
          }}
          geometry={SHARED_GEOMETRIES.cylinder8}
          material={wallFrostMaterial}
          position={[segment.position.x, segment.position.y + 0.02, segment.position.z]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[segment.width * 0.5, 0.08, segment.width * 0.5]}
          visible={(now - getSegmentFrameCreatedAt(segment)) / 1000 < ICE_WALL_DURATION}
        />
      ))}
    </group>
  );
}, (prev, next) => {
  return (
    prev.rush.id === next.rush.id &&
    prev.rush.isActive === next.rush.isActive &&
    prev.rush.segments.length === next.rush.segments.length
  );
});
