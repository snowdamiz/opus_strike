import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, type GrappleLineData } from '../../../store/gameStore';
import { getOwnerVisualPosition } from './ownerPosition';
import { triggerTerrainImpact } from '../TerrainImpactEffects';
import { 
  SHARED_GEOMETRIES, 
  HOOKSHOT_COLORS, 
  getHookshotMaterials,
  TEMP_VECTORS,
} from '../effectResources';

// ============================================================================
// GRAPPLE LINE - Quick grapple to geometry (Q ability)
// Shows a hook shooting out and rope connecting player to hook
// OPTIMIZED: Uses same ref-based rope rendering as basic attack for smooth following
// ============================================================================

// Height offset from player feet to hand position (matches basic attack)
const GRAPPLE_HAND_HEIGHT = 0.6;

// Get shared materials from centralized resources
const getHookMaterials = () => getHookshotMaterials();

interface GrappleLineProps {
  line: GrappleLineData;
}

export const GrappleLineEffect = React.memo(({ line }: GrappleLineProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const hookRef = useRef<THREE.Group>(null);
  
  // Rope mesh refs - same approach as basic attack for smooth updates
  const ropeMainRef = useRef<THREE.Mesh>(null);
  const ropeGlowRef = useRef<THREE.Mesh>(null);
  const ropeCoreRef = useRef<THREE.Mesh>(null);
  
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
  
  const removeGrappleLine = useGameStore(state => state.removeGrappleLine);
  
  useFrame((_, delta) => {
    if (!hookRef.current || shouldRemoveRef.current) return;
    
    // Get player position without triggering re-renders (like basic attack)
    const state = useGameStore.getState();
    const localPlayer = state.localPlayer;
    const players = state.players;
    
    const targetPosition = getOwnerVisualPosition(
      line.ownerId,
      GRAPPLE_HAND_HEIGHT,
      line.startPosition,
      players,
      localPlayer
    );
    const targetX = targetPosition.x;
    const targetY = targetPosition.y;
    const targetZ = targetPosition.z;
    
    // Smooth lerp for player position (snap on first frame) - same as basic attack
    const lerpFactor = isFirstFrameRef.current ? 1 : Math.min(1, 20 * delta);
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
    
    // Hook position calculation
    const hookPos = currentHookPosRef.current;
    
    // Hook extension logic
    if (!hasReachedRef.current && line.state === 'extending') {
      // Extend the hook outward from player
      const speed = 80 * delta;
      hookExtensionRef.current += speed;
      
      if (hookExtensionRef.current >= totalDist) {
        // Hook reached target
        hasReachedRef.current = true;
        hookPos.x = line.endPosition.x;
        hookPos.y = line.endPosition.y;
        hookPos.z = line.endPosition.z;
        triggerTerrainImpact('hookshot_grapple', line.endPosition, {
          normal: { x: -dirX, y: -dirY, z: -dirZ },
          direction: { x: dirX, y: dirY, z: dirZ },
        });
        useGameStore.getState().updateGrappleLine(line.id, { state: 'attached' });
      } else {
        // Position hook along the line from player toward target
        hookPos.x = pX + dirX * hookExtensionRef.current;
        hookPos.y = pY + dirY * hookExtensionRef.current;
        hookPos.z = pZ + dirZ * hookExtensionRef.current;
      }
    } else if (line.state === 'attached' || line.state === 'pulling') {
      // Hook is attached to geometry - stays at target position
      hasReachedRef.current = true;
      hookPos.x = line.endPosition.x;
      hookPos.y = line.endPosition.y;
      hookPos.z = line.endPosition.z;
    }
    
    // Check completion - player reached the hook
    if (hasReachedRef.current && totalDist < 1.5) {
      shouldRemoveRef.current = true;
      removeGrappleLine(line.id);
      return;
    }
    
    // Timeout
    const elapsed = (Date.now() - line.startTime) / 1000;
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
    
    if (hLen > 0.01) {
      TEMP_VECTORS.v1.set(hdx / hLen, hdy / hLen, hdz / hLen);
      TEMP_VECTORS.quat1.setFromUnitVectors(TEMP_VECTORS.forward, TEMP_VECTORS.v1);
      hookRef.current.quaternion.copy(TEMP_VECTORS.quat1);
    }
    
    // Update rope meshes directly (no React state) - same approach as basic attack
    TEMP_VECTORS.v2.set(hookPos.x, hookPos.y, hookPos.z);
    TEMP_VECTORS.v3.set((pX + hookPos.x) * 0.5, (pY + hookPos.y) * 0.5, (pZ + hookPos.z) * 0.5);
    
    if (ropeMainRef.current) {
      ropeMainRef.current.position.copy(TEMP_VECTORS.v3);
      ropeMainRef.current.scale.set(0.035, hLen, 0.035);
      ropeMainRef.current.lookAt(TEMP_VECTORS.v2);
      ropeMainRef.current.rotateX(Math.PI / 2);
    }
    if (ropeGlowRef.current) {
      ropeGlowRef.current.position.copy(TEMP_VECTORS.v3);
      ropeGlowRef.current.scale.set(0.06, hLen, 0.06);
      ropeGlowRef.current.lookAt(TEMP_VECTORS.v2);
      ropeGlowRef.current.rotateX(Math.PI / 2);
    }
    if (ropeCoreRef.current) {
      ropeCoreRef.current.position.copy(TEMP_VECTORS.v3);
      ropeCoreRef.current.scale.set(0.015, hLen, 0.015);
      ropeCoreRef.current.lookAt(TEMP_VECTORS.v2);
      ropeCoreRef.current.rotateX(Math.PI / 2);
    }
  });
  
  return (
    <group ref={groupRef}>
      {/* ANCHOR-STYLE GRAPPLING HOOK */}
      <group ref={hookRef} position={[line.startPosition.x, line.startPosition.y, line.startPosition.z]}>
        {/* === ANCHOR RING (top) - where rope attaches === */}
        <mesh position={[0, 0, 0.35]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.2, 0.2, 0.08]}>
          <meshStandardMaterial color={0x888888} metalness={0.9} roughness={0.2} side={THREE.DoubleSide} />
        </mesh>
        
        {/* === MAIN SHAFT (vertical bar) === */}
        <mesh rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.08, 0.8, 0.08]}>
          <meshStandardMaterial color={0x666666} metalness={0.85} roughness={0.25} />
        </mesh>
        
        {/* === CROWN/STOCK (horizontal bar near top) === */}
        <mesh position={[0, 0, 0.15]} rotation={[0, 0, Math.PI / 2]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.05, 0.5, 0.05]}>
          <meshStandardMaterial color={0x777777} metalness={0.85} roughness={0.25} />
        </mesh>
        
        {/* === ANCHOR ARMS/FLUKES (curved hooks at bottom) === */}
        {/* Left arm */}
        <group position={[-0.15, 0, -0.3]}>
          {/* Arm going outward and down */}
          <mesh rotation={[0.3, 0, -0.8]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.06, 0.35, 0.06]}>
            <meshStandardMaterial color={0x666666} metalness={0.85} roughness={0.25} />
          </mesh>
          {/* Curved fluke tip */}
          <mesh position={[-0.2, 0, -0.15]} rotation={[0.5, 0, -1.2]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.08, 0.2, 0.04]}>
            <meshStandardMaterial color={0xaaaaaa} metalness={0.9} roughness={0.15} />
          </mesh>
        </group>
        
        {/* Right arm */}
        <group position={[0.15, 0, -0.3]}>
          {/* Arm going outward and down */}
          <mesh rotation={[0.3, 0, 0.8]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.06, 0.35, 0.06]}>
            <meshStandardMaterial color={0x666666} metalness={0.85} roughness={0.25} />
          </mesh>
          {/* Curved fluke tip */}
          <mesh position={[0.2, 0, -0.15]} rotation={[0.5, 0, 1.2]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.08, 0.2, 0.04]}>
            <meshStandardMaterial color={0xaaaaaa} metalness={0.9} roughness={0.15} />
          </mesh>
        </group>
        
        {/* === BOTTOM POINT === */}
        <mesh position={[0, 0, -0.45]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.1, 0.15, 0.1]}>
          <meshStandardMaterial color={0xcccccc} metalness={0.95} roughness={0.1} />
        </mesh>
        
        {/* Energy glow around hook */}
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={0.25} material={HOOK_MATERIALS.glow} />
        
        {/* Small point light so the hook is visible */}
        <pointLight color={HOOKSHOT_COLORS.energy} intensity={3} distance={5} decay={2} />
      </group>
      
      {/* ENERGY ROPE - Using cylinder meshes updated via refs (same as basic attack) */}
      <mesh ref={ropeMainRef} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MATERIALS.ropeMain} />
      <mesh ref={ropeGlowRef} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MATERIALS.ropeGlow} />
      <mesh ref={ropeCoreRef} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MATERIALS.ropeCore} />
    </group>
  );
}, (prev, next) => {
  // Custom comparison: only re-render if line.id or state changes
  return prev.line.id === next.line.id && prev.line.state === next.line.state;
});
