import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { HOOKSHOT_GRAPPLE_EXTENSION_SPEED } from '@voxel-strike/physics';
import { useGameStore, type GrappleLineData } from '../../../store/gameStore';
import { HOOKSHOT_CHAIN_SOCKET } from '../../../hooks/player/constants';
import { writeOwnerVisualPosition } from './ownerPosition';
import { triggerTerrainImpact } from '../TerrainImpactEffects';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { getFrameClock } from '../../../utils/frameClock';
import { 
  SHARED_GEOMETRIES, 
  HOOKSHOT_COLORS, 
  getHookshotMaterials,
  TEMP_VECTORS,
} from '../effectResources';
import { HOOKSHOT_HOOK_SOCKET_NAMES } from '../../../viewmodel/hookshotPose';
import { readViewmodelSocket } from '../../../viewmodel/viewmodelSocketRegistry';
import {
  HOOK_MAIN_ROPE_MATERIAL,
  PLIABLE_ROPE_SEGMENT_COUNT,
  ROPE_SEGMENT_INDICES,
  createRopePoints,
  updatePliableRopePoints,
  updateRopeSegment,
} from './rope';
import { HookshotProjectileArrowHead } from './arrowHead';

// ============================================================================
// GRAPPLE LINE - Quick grapple to geometry (E ability)
// Shows a hook shooting out and rope connecting player to hook
// OPTIMIZED: Uses same ref-based rope rendering as basic attack for smooth following
// ============================================================================

// Get shared materials from centralized resources
const getHookMaterials = () => getHookshotMaterials();

function writeLocalGrappleSocketPosition(out: { x: number; y: number; z: number }, launchSide: -1 | 1): boolean {
  const socketPose = readViewmodelSocket(HOOKSHOT_HOOK_SOCKET_NAMES[launchSide]);
  if (!socketPose) return false;

  out.x = socketPose.position.x;
  out.y = socketPose.position.y;
  out.z = socketPose.position.z;
  return true;
}

interface GrappleLineProps {
  line: GrappleLineData;
}

export const GrappleLineEffect = React.memo(({ line }: GrappleLineProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const hookRef = useRef<THREE.Group>(null);
  const muzzleRef = useRef<THREE.Group>(null);
  
  // Rope mesh refs - same approach as basic attack for smooth updates
  const ropeMainRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ropeGlowRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ropeCoreRefs = useRef<(THREE.Mesh | null)[]>([]);
  
  // Get shared materials
  const HOOK_MATERIALS = getHookMaterials();
  
  // All state tracked via refs - NO useState, NO store updates in render loop (like basic attack)
  const hookExtensionRef = useRef(0);
  const hasReachedRef = useRef(false);
  const isFirstFrameRef = useRef(true);
  const shouldRemoveRef = useRef(false);
  
  // Track current positions via refs for smooth interpolation
  const currentHookPosRef = useRef({ x: line.startPosition.x, y: line.startPosition.y, z: line.startPosition.z });
  const playerPosRef = useRef({ x: line.startPosition.x, y: line.startPosition.y, z: line.startPosition.z });
  const ownerVisualPositionRef = useRef({ x: line.startPosition.x, y: line.startPosition.y, z: line.startPosition.z });
  const smoothedSocketRef = useRef(new THREE.Vector3(line.startPosition.x, line.startPosition.y, line.startPosition.z));
  const ropeLagRef = useRef(new THREE.Vector3());
  const ropeControlARef = useRef(new THREE.Vector3());
  const ropeControlBRef = useRef(new THREE.Vector3());
  const ropePointsRef = useRef(createRopePoints());
  const socketInitializedRef = useRef(false);
  const startFrameTimeRef = useRef(getFrameClock().nowMs - Math.max(0, Date.now() - line.startTime));
  const launchSide = line.launchSide ?? 1;
  const launchSocketOffset = {
    forwardOffset: HOOKSHOT_CHAIN_SOCKET.forwardOffset,
    sideOffset: HOOKSHOT_CHAIN_SOCKET.sideOffset * launchSide,
    yaw: line.launchYaw,
  };
  
  const removeGrappleLine = useGameStore(state => state.removeGrappleLine);
  const localPlayerId = useGameStore(state => state.localPlayer?.id);
  const isLocalOwnerForRender = localPlayerId === line.ownerId;
  
  useFrame((frameState, delta) => {
    if (!hookRef.current || shouldRemoveRef.current) return;
    const frameNow = getFrameClock().nowMs;
    
    // Get player position without triggering re-renders (like basic attack)
    const state = useGameStore.getState();
    const localPlayer = state.localPlayer;
    const players = state.players;
    
    const isLocalOwner = localPlayer?.id === line.ownerId;
    const targetPosition = ownerVisualPositionRef.current;
    if (isLocalOwner) {
      writeLocalGrappleSocketPosition(targetPosition, launchSide);
    } else {
      writeOwnerVisualPosition(
        targetPosition,
        line.ownerId,
        HOOKSHOT_CHAIN_SOCKET.handHeight,
        line.startPosition,
        players,
        localPlayer,
        launchSocketOffset
      );
    }
    const targetX = targetPosition.x;
    const targetY = targetPosition.y;
    const targetZ = targetPosition.z;
    
    const lerpFactor = isLocalOwner || isFirstFrameRef.current ? 1 : Math.min(1, 20 * delta);
    playerPosRef.current.x += (targetX - playerPosRef.current.x) * lerpFactor;
    playerPosRef.current.y += (targetY - playerPosRef.current.y) * lerpFactor;
    playerPosRef.current.z += (targetZ - playerPosRef.current.z) * lerpFactor;
    isFirstFrameRef.current = false;
    
    const pX = playerPosRef.current.x;
    const pY = playerPosRef.current.y;
    const pZ = playerPosRef.current.z;
    
    // Calculate direction from player to target
    const toTargetX = line.endPosition.x - pX;
    const toTargetY = line.endPosition.y - pY;
    const toTargetZ = line.endPosition.z - pZ;
    const totalDist = Math.sqrt(toTargetX * toTargetX + toTargetY * toTargetY + toTargetZ * toTargetZ);
    const dirX = totalDist > 0 ? toTargetX / totalDist : 0;
    const dirY = totalDist > 0 ? toTargetY / totalDist : 0;
    const dirZ = totalDist > 0 ? toTargetZ / totalDist : 0;
    const castToTargetX = line.endPosition.x - line.startPosition.x;
    const castToTargetY = line.endPosition.y - line.startPosition.y;
    const castToTargetZ = line.endPosition.z - line.startPosition.z;
    const castDist = Math.sqrt(
      castToTargetX * castToTargetX +
      castToTargetY * castToTargetY +
      castToTargetZ * castToTargetZ
    );
    const castDirX = castDist > 0 ? castToTargetX / castDist : dirX;
    const castDirY = castDist > 0 ? castToTargetY / castDist : dirY;
    const castDirZ = castDist > 0 ? castToTargetZ / castDist : dirZ;
    
    // Hook position calculation
    const hookPos = currentHookPosRef.current;
    
    // Hook extension logic
    if (!hasReachedRef.current && line.state === 'extending') {
      const elapsed = Math.max(0, (frameNow - startFrameTimeRef.current) / 1000);
      hookExtensionRef.current = Math.max(
        hookExtensionRef.current + HOOKSHOT_GRAPPLE_EXTENSION_SPEED * delta,
        HOOKSHOT_GRAPPLE_EXTENSION_SPEED * elapsed
      );
      
      if (hookExtensionRef.current >= castDist) {
        // Hook reached target
        hasReachedRef.current = true;
        hookPos.x = line.endPosition.x;
        hookPos.y = line.endPosition.y;
        hookPos.z = line.endPosition.z;
        triggerTerrainImpact('hookshot_grapple', line.endPosition, {
          normal: { x: -castDirX, y: -castDirY, z: -castDirZ },
          direction: { x: castDirX, y: castDirY, z: castDirZ },
        });
        useGameStore.getState().updateGrappleLine(line.id, { state: 'attached' });
      } else {
        hookPos.x = line.startPosition.x + castDirX * hookExtensionRef.current;
        hookPos.y = line.startPosition.y + castDirY * hookExtensionRef.current;
        hookPos.z = line.startPosition.z + castDirZ * hookExtensionRef.current;
      }
    } else if (line.state === 'attached' || line.state === 'pulling') {
      // Hook is attached to geometry - stays at target position
      hasReachedRef.current = true;
      hookPos.x = line.endPosition.x;
      hookPos.y = line.endPosition.y;
      hookPos.z = line.endPosition.z;
    }
    
    if (line.state === 'done') {
      shouldRemoveRef.current = true;
      removeGrappleLine(line.id);
      return;
    }
    
    // Timeout
    const elapsed = (frameNow - startFrameTimeRef.current) / 1000;
    if (elapsed > 5.0) {
      shouldRemoveRef.current = true;
      removeGrappleLine(line.id);
      return;
    }
    
    // Update hook visual position directly
    hookRef.current.position.set(hookPos.x, hookPos.y, hookPos.z);
    
    // Update hook orientation - point toward target (away from player)
    const hdx = hookPos.x - pX;
    const hdy = hookPos.y - pY;
    const hdz = hookPos.z - pZ;
    const hLen = Math.sqrt(hdx * hdx + hdy * hdy + hdz * hdz);
    const ropePoints = ropePointsRef.current;
    ropePoints[0].set(pX, pY, pZ);
    ropePoints[PLIABLE_ROPE_SEGMENT_COUNT].set(hookPos.x, hookPos.y, hookPos.z);

    if (!socketInitializedRef.current) {
      smoothedSocketRef.current.copy(ropePoints[0]);
      socketInitializedRef.current = true;
    }

    const socketAlpha = 1 - Math.exp(-delta * 7);
    smoothedSocketRef.current.lerp(ropePoints[0], socketAlpha);
    ropeLagRef.current.copy(smoothedSocketRef.current).sub(ropePoints[0]);
    const maxLag = 1.2;
    const lagLength = ropeLagRef.current.length();
    if (lagLength > maxLag) {
      ropeLagRef.current.multiplyScalar(maxLag / lagLength);
    }
    
    if (hLen > 0.01) {
      TEMP_VECTORS.v1.set(hdx / hLen, hdy / hLen, hdz / hLen);
      TEMP_VECTORS.quat1.setFromUnitVectors(TEMP_VECTORS.forward, TEMP_VECTORS.v1);
      hookRef.current.quaternion.copy(TEMP_VECTORS.quat1);
    }

    const ropeStart = ropePoints[0];
    const ropeEnd = ropePoints[PLIABLE_ROPE_SEGMENT_COUNT];
    updatePliableRopePoints(
      ropePoints,
      ropeControlARef.current,
      ropeControlBRef.current,
      ropeStart,
      ropeEnd,
      ropeLagRef.current,
      hLen,
      0.28
    );
    
    for (let i = 0; i < PLIABLE_ROPE_SEGMENT_COUNT; i++) {
      updateRopeSegment(ropeGlowRefs.current[i], ropePoints[i], ropePoints[i + 1], 0.055);
      updateRopeSegment(ropeMainRefs.current[i], ropePoints[i], ropePoints[i + 1], 0.02);
      updateRopeSegment(ropeCoreRefs.current[i], ropePoints[i], ropePoints[i + 1], 0.012);
    }

    if (muzzleRef.current) {
      const pulse = 1 + Math.sin(frameState.clock.elapsedTime * 30) * 0.08;
      muzzleRef.current.position.copy(ropePoints[0]);
      muzzleRef.current.scale.setScalar(pulse);
      if (hLen > 0.01) {
        muzzleRef.current.quaternion.copy(hookRef.current.quaternion);
      }
    }
  });
  
  return (
    <group ref={groupRef}>
      {/* Glowing arrow-style grappling head */}
      <group ref={hookRef} position={[line.startPosition.x, line.startPosition.y, line.startPosition.z]}>
        <HookshotProjectileArrowHead
          materials={{
            shaft: HOOK_MATERIALS.shaft,
            tip: HOOK_MATERIALS.tip,
            glow: HOOK_MATERIALS.glow,
            core: HOOK_MATERIALS.ropeCore,
            ring: HOOK_MATERIALS.ring,
          }}
          scale={1.05}
          lightPriority={3}
          lightIntensity={3.2}
          lightDistance={5}
        />
      </group>
      
      {/* ENERGY ROPE - Using cylinder meshes updated via refs (same as basic attack) */}
      <group ref={muzzleRef} position={[line.startPosition.x, line.startPosition.y, line.startPosition.z]} visible={!isLocalOwnerForRender}>
        <mesh rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.16, 0.16, 0.04]} material={HOOK_MATERIALS.ring} />
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={0.12} material={HOOK_MATERIALS.glow} />
        <BudgetedPointLight budgetPriority={1.5} color={HOOKSHOT_COLORS.energy} intensity={1.2} distance={2.5} decay={2} />
      </group>

      {ROPE_SEGMENT_INDICES.map(i => (
        <mesh key={`grapple-glow-${i}`} ref={el => ropeGlowRefs.current[i] = el} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MATERIALS.ropeGlow} />
      ))}
      {ROPE_SEGMENT_INDICES.map(i => (
        <mesh key={`grapple-main-${i}`} ref={el => ropeMainRefs.current[i] = el} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MAIN_ROPE_MATERIAL} />
      ))}
      {ROPE_SEGMENT_INDICES.map(i => (
        <mesh key={`grapple-core-${i}`} ref={el => ropeCoreRefs.current[i] = el} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MATERIALS.ropeCore} />
      ))}
    </group>
  );
}, (prev, next) => {
  // Custom comparison: only re-render if line.id or state changes
  return prev.line.id === next.line.id && prev.line.state === next.line.state;
});
