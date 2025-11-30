import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { type IceWallRushData } from '../../../store/gameStore';
import { isPhysicsReady, addIceWallCollider } from '../../../hooks/usePhysics';
import { SHARED_GEOMETRIES } from '../effectResources';
import { ICE_WALL_DURATION, ICE_WALL_SEGMENT_DEPTH } from '@voxel-strike/shared';
import {
  tempVec3,
  tempMatrix,
  tempQuaternion,
  tempScale,
  tempEuler,
  getWallCrystalGeometry,
  getWallMaterials,
  wallCrystalMaterial,
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

interface IceWallRushProps {
  rush: IceWallRushData;
}

export function IceWallRush({ rush }: IceWallRushProps) {
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const frostMeshesRef = useRef<Map<number, THREE.Mesh>>(new Map());
  // Track which segments have colliders registered
  const registeredCollidersRef = useRef<Set<string>>(new Set());
  
  const { wallCrystalMaterial, wallFrostMaterial } = getWallMaterials();
  const crystalGeometry = getWallCrystalGeometry();
  
  useFrame(() => {
    const mesh = instancedMeshRef.current;
    if (!mesh) return;
    
    const now = Date.now();
    const segments = rush.segments.slice(-MAX_WALL_SEGMENTS);
    
    let instanceIdx = 0;
    
    segments.forEach((segment, segIdx) => {
      const age = (now - segment.createdAt) / 1000;
      // Use createdAt for stable ID - segIdx shifts as array is sliced
      const segmentId = `${rush.id}_${segment.createdAt}`;
      
      // Register collider for new segments (if physics ready and not already registered)
      if (!registeredCollidersRef.current.has(segmentId) && age < ICE_WALL_DURATION - ICE_WALL_FADE_DURATION) {
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
        return;
      }
      
      const fadeStart = ICE_WALL_DURATION - ICE_WALL_FADE_DURATION;
      const fadeProgress = age > fadeStart ? Math.min((age - fadeStart) / ICE_WALL_FADE_DURATION, 1) : 0;
      // Eased sink progress - starts slow, accelerates as it sinks (ease-in)
      const sinkProgress = fadeProgress > 0 ? Math.pow(fadeProgress, 2) : 0;
      
      CRYSTAL_LAYOUT.forEach((config, crystalIdx) => {
        const idx = segIdx * CRYSTALS_PER_SEGMENT + crystalIdx;
        if (idx >= MAX_WALL_CRYSTALS) return;
        
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
        instanceIdx++;
      });
      
      const frostMesh = frostMeshesRef.current.get(segIdx);
      if (frostMesh) {
        const riseProgress = Math.min(age / ICE_WALL_RISE_DURATION, 1);
        // Frost patch shrinks as crystals sink back down
        const frostScale = (1 - Math.pow(1 - riseProgress, 3)) * (1 - sinkProgress * 0.8);
        frostMesh.scale.setScalar(segment.width * 0.5 * frostScale);
        (frostMesh.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - fadeProgress);
      }
    });
    
    for (let i = instanceIdx; i < MAX_WALL_CRYSTALS; i++) {
      tempScale.set(0, 0, 0);
      tempMatrix.compose(tempVec3, tempQuaternion, tempScale);
      mesh.setMatrixAt(i, tempMatrix);
    }
    
    mesh.instanceMatrix.needsUpdate = true;
    
    // Update material opacity
    const avgFade = segments.length > 0 ? segments.reduce((sum, s) => {
      const age = (now - s.createdAt) / 1000;
      const fadeStart = ICE_WALL_DURATION - ICE_WALL_FADE_DURATION;
      return sum + (age > fadeStart ? Math.min((age - fadeStart) / ICE_WALL_FADE_DURATION, 1) : 0);
    }, 0) / segments.length : 0;
    wallCrystalMaterial.opacity = 0.9 * (1 - avgFade * 0.3);
    wallCrystalMaterial.emissiveIntensity = 0.2 * (1 - avgFade * 0.5);
  });
  
  const now = Date.now();
  const activeSegments = rush.segments.slice(-MAX_WALL_SEGMENTS).filter(seg => (now - seg.createdAt) / 1000 < ICE_WALL_DURATION);
  
  return (
    <group>
      <instancedMesh ref={instancedMeshRef} args={[crystalGeometry!, wallCrystalMaterial, MAX_WALL_CRYSTALS]} frustumCulled={false} />
      {activeSegments.map((segment, segIdx) => (
        <mesh key={segIdx} ref={el => { if (el) frostMeshesRef.current.set(segIdx, el); }} geometry={SHARED_GEOMETRIES.cylinder8} material={wallFrostMaterial} position={[segment.position.x, segment.position.y + 0.02, segment.position.z]} rotation={[Math.PI / 2, 0, 0]} scale={[segment.width * 0.5, 0.08, segment.width * 0.5]} />
      ))}
    </group>
  );
}

