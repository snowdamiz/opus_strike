import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, type DragHookData } from '../../../store/gameStore';
import { isPhysicsReady, raycastDirection } from '../../../hooks/usePhysics';
import { damageNpc } from '../../ui/GameConsole';
import { getOwnerVisualPosition } from './ownerPosition';
import { triggerTerrainImpact } from '../TerrainImpactEffects';
import { 
  SHARED_GEOMETRIES, 
  HOOKSHOT_COLORS, 
  getHookshotMaterials,
  TEMP_VECTORS,
} from '../effectResources';

// ============================================================================
// DRAG HOOK - Long range hook that pulls enemies (heavy attack / right click)
// SAME MECHANICS AS LEFT CLICK: Extends out, retracts back to player
// If it hits an enemy, it pulls them back with it
// OVER-THE-TOP STYLING: Bigger hook, thicker glowing chains
// ============================================================================

const DRAG_HOOK_SPEED = 45;
const DRAG_HOOK_MAX_DISTANCE = 30; // Increased for long-range pulls
const DRAG_HOOK_DAMAGE = 40;
const DRAG_HOOK_RETRACT_SPEED = 55;
const DRAG_HOOK_HIT_RADIUS = 1.2;

// Hand height for drag hook
const DRAG_HOOK_HAND_HEIGHT = 0.3;

// Get shared materials from centralized resources
const getHookMaterials = () => getHookshotMaterials();

interface DragHookProps {
  hook: DragHookData;
}

export const DragHookEffect = React.memo(({ hook }: DragHookProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const hookRef = useRef<THREE.Group>(null);
  
  // Multi-layer rope refs for over-the-top chain effect
  const chainMainRef = useRef<THREE.Mesh>(null);
  const chainOuterRef = useRef<THREE.Mesh>(null);
  const chainCoreRef = useRef<THREE.Mesh>(null);
  const chainMegaGlowRef = useRef<THREE.Mesh>(null);
  
  const glowRef = useRef<THREE.Mesh>(null);
  
  // Get shared materials
  const HOOK_MATERIALS = getHookMaterials();
  
  // All state tracked via refs - SAME PATTERN AS LEFT CLICK
  const hookStateRef = useRef<'extending' | 'retracting'>(hook.state === 'flying' ? 'extending' : 'retracting');
  const currentPosRef = useRef({ x: hook.position.x, y: hook.position.y, z: hook.position.z });
  const playerPosRef = useRef({ x: hook.startPosition.x, y: hook.startPosition.y, z: hook.startPosition.z });
  const isFirstFrameRef = useRef(true);
  const shouldRemoveRef = useRef(false);
  const hasHitRef = useRef(false);
  const hookedTargetIdRef = useRef<string | null>(null);
  
  // Cache velocity values (they don't change)
  const velX = hook.velocity.x;
  const velY = hook.velocity.y;
  const velZ = hook.velocity.z;
  const speed = Math.sqrt(velX * velX + velY * velY + velZ * velZ);
  const dirX = velX / speed;
  const dirY = velY / speed;
  const dirZ = velZ / speed;
  
  const removeDragHook = useGameStore(state => state.removeDragHook);
  
  useFrame((state, delta) => {
    if (!hookRef.current || shouldRemoveRef.current) return;
    
    const time = state.clock.elapsedTime;
    const storeState = useGameStore.getState();
    const { players, localPlayer } = storeState;
    
    const targetPosition = getOwnerVisualPosition(
      hook.ownerId,
      DRAG_HOOK_HAND_HEIGHT,
      hook.startPosition,
      players,
      localPlayer
    );
    const targetX = targetPosition.x;
    const targetY = targetPosition.y;
    const targetZ = targetPosition.z;
    
    // Smooth lerp for player position (snap on first frame) - SAME AS LEFT CLICK
    const lerpFactor = isFirstFrameRef.current ? 1 : Math.min(1, 20 * delta);
    playerPosRef.current.x += (targetX - playerPosRef.current.x) * lerpFactor;
    playerPosRef.current.y += (targetY - playerPosRef.current.y) * lerpFactor;
    playerPosRef.current.z += (targetZ - playerPosRef.current.z) * lerpFactor;
    isFirstFrameRef.current = false;
    
    const pX = playerPosRef.current.x;
    const pY = playerPosRef.current.y;
    const pZ = playerPosRef.current.z;
    
    const curPos = currentPosRef.current;
    
    if (hookStateRef.current === 'extending') {
      // Move forward - SAME AS LEFT CLICK
      curPos.x += velX * delta;
      curPos.y += velY * delta;
      curPos.z += velZ * delta;
      
      // Check max distance - if reached, start retracting
      const dx = curPos.x - pX;
      const dy = curPos.y - pY;
      const dz = curPos.z - pZ;
      if (dx * dx + dy * dy + dz * dz >= DRAG_HOOK_MAX_DISTANCE * DRAG_HOOK_MAX_DISTANCE) {
        hookStateRef.current = 'retracting';
      }
      
      // Terrain collision - if hit, start retracting
      if (isPhysicsReady()) {
        const hit = raycastDirection(curPos.x, curPos.y, curPos.z, dirX, dirY, dirZ, delta * speed + 0.5);
        if (hit?.hit) {
          triggerTerrainImpact('hookshot_drag_hook', hit.point, {
            normal: hit.normal,
            direction: { x: dirX, y: dirY, z: dirZ },
          });
          hookStateRef.current = 'retracting';
        }
      }
      
      // Enemy collision - if hit, start retracting AND pull enemy
      if (!hasHitRef.current && localPlayer) {
        for (const [playerId, player] of players) {
          if (playerId === localPlayer.id || player.state !== 'alive') continue;
          if (player.team === localPlayer.team) continue;
          
          const pdx = player.position.x - curPos.x;
          const pdy = (player.position.y + 0.9) - curPos.y;
          const pdz = player.position.z - curPos.z;
          
          if (pdx * pdx + pdy * pdy + pdz * pdz <= DRAG_HOOK_HIT_RADIUS * DRAG_HOOK_HIT_RADIUS) {
            hasHitRef.current = true;
            hookedTargetIdRef.current = playerId;
            if (playerId.startsWith('npc_')) {
              damageNpc(playerId, DRAG_HOOK_DAMAGE);
            }
            hookStateRef.current = 'retracting';
            break;
          }
        }
      }
    } else {
      // Retracting - move toward player - SAME AS LEFT CLICK
      const toX = pX - curPos.x;
      const toY = pY - curPos.y;
      const toZ = pZ - curPos.z;
      const distSq = toX * toX + toY * toY + toZ * toZ;
      
      if (distSq < 0.25) { // 0.5^2 - close enough to player, remove
        shouldRemoveRef.current = true;
        removeDragHook(hook.id);
        return;
      }
      
      const dist = Math.sqrt(distSq);
      const retractDelta = DRAG_HOOK_RETRACT_SPEED * delta;
      curPos.x += (toX / dist) * retractDelta;
      curPos.y += (toY / dist) * retractDelta;
      curPos.z += (toZ / dist) * retractDelta;
    }
    
    // Update hook position directly
    hookRef.current.position.set(curPos.x, curPos.y, curPos.z);
    
    // Update hook orientation - point away from player (using shared temp vectors)
    const hdx = curPos.x - pX;
    const hdy = curPos.y - pY;
    const hdz = curPos.z - pZ;
    const hLen = Math.sqrt(hdx * hdx + hdy * hdy + hdz * hdz);
    
    if (hLen > 0.01) {
      TEMP_VECTORS.v1.set(hdx / hLen, hdy / hLen, hdz / hLen);
      TEMP_VECTORS.quat1.setFromUnitVectors(TEMP_VECTORS.forward, TEMP_VECTORS.v1);
      hookRef.current.quaternion.copy(TEMP_VECTORS.quat1);
    }
    
    // Update chain meshes directly (no React state) - SAME PATTERN AS LEFT CLICK
    TEMP_VECTORS.v2.set(curPos.x, curPos.y, curPos.z);
    TEMP_VECTORS.v3.set((pX + curPos.x) * 0.5, (pY + curPos.y) * 0.5, (pZ + curPos.z) * 0.5);
    
    // Main energy layer (thicker than left click)
    if (chainMainRef.current) {
      chainMainRef.current.position.copy(TEMP_VECTORS.v3);
      chainMainRef.current.scale.set(0.045, hLen, 0.045);
      chainMainRef.current.lookAt(TEMP_VECTORS.v2);
      chainMainRef.current.rotateX(Math.PI / 2);
    }
    // Outer glow layer (thicker than left click)
    if (chainOuterRef.current) {
      chainOuterRef.current.position.copy(TEMP_VECTORS.v3);
      chainOuterRef.current.scale.set(0.08, hLen, 0.08);
      chainOuterRef.current.lookAt(TEMP_VECTORS.v2);
      chainOuterRef.current.rotateX(Math.PI / 2);
    }
    // Bright core (thicker than left click)
    if (chainCoreRef.current) {
      chainCoreRef.current.position.copy(TEMP_VECTORS.v3);
      chainCoreRef.current.scale.set(0.02, hLen, 0.02);
      chainCoreRef.current.lookAt(TEMP_VECTORS.v2);
      chainCoreRef.current.rotateX(Math.PI / 2);
    }
    // Mega outer glow (extra layer for heavy attack)
    if (chainMegaGlowRef.current) {
      chainMegaGlowRef.current.position.copy(TEMP_VECTORS.v3);
      chainMegaGlowRef.current.scale.set(0.12, hLen, 0.12);
      chainMegaGlowRef.current.lookAt(TEMP_VECTORS.v2);
      chainMegaGlowRef.current.rotateX(Math.PI / 2);
    }
    
    // Animate hook glow effects
    if (glowRef.current) {
      const pulse = 0.9 + Math.sin(time * 12) * 0.3;
      glowRef.current.scale.setScalar(pulse * 0.4);
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(time * 10) * 0.2;
    }
  });
  
  return (
    <group ref={groupRef}>
      {/* === HEAVY HOOK - Bigger version of left click hook === */}
      <group ref={hookRef} position={[hook.position.x, hook.position.y, hook.position.z]}>
        {/* Ring at back where rope attaches - BIGGER */}
        <mesh position={[0, 0, 0.35]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.22, 0.22, 0.08]} material={HOOK_MATERIALS.ring} />
        
        {/* Main shaft - THICKER */}
        <mesh rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.09, 0.75, 0.09]} material={HOOK_MATERIALS.shaft} />
        
        {/* Crown/crossbar - WIDER */}
        <mesh position={[0, 0, 0.12]} rotation={[0, 0, Math.PI / 2]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.055, 0.45, 0.055]} material={HOOK_MATERIALS.crown} />
        
        {/* Left arm - BIGGER */}
        <mesh position={[-0.14, 0, -0.25]} rotation={[0.3, 0, -0.8]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.06, 0.32, 0.06]} material={HOOK_MATERIALS.shaft} />
        <mesh position={[-0.32, 0, -0.38]} rotation={[0.5, 0, -1.2]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.08, 0.18, 0.04]} material={HOOK_MATERIALS.fluke} />
          
        {/* Right arm - BIGGER */}
        <mesh position={[0.14, 0, -0.25]} rotation={[0.3, 0, 0.8]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.06, 0.32, 0.06]} material={HOOK_MATERIALS.shaft} />
        <mesh position={[0.32, 0, -0.38]} rotation={[0.5, 0, 1.2]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.08, 0.18, 0.04]} material={HOOK_MATERIALS.fluke} />
        
        {/* Tip - BIGGER */}
        <mesh position={[0, 0, -0.45]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.12, 0.18, 0.12]} material={HOOK_MATERIALS.tip} />
        
        {/* Energy glow - BIGGER and more intense */}
        <mesh ref={glowRef} geometry={SHARED_GEOMETRIES.sphere8} scale={0.35} material={HOOK_MATERIALS.glow} />
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={0.5}>
          <meshBasicMaterial color={HOOKSHOT_COLORS.energyGlow} transparent opacity={0.2} />
        </mesh>
        
        {/* Lights - MORE INTENSE */}
        <pointLight color={HOOKSHOT_COLORS.energy} intensity={4} distance={5} decay={2} />
        <pointLight color={0xffffff} intensity={2} distance={3} decay={2} position={[0, 0, -0.3]} />
      </group>
      
      {/* === HEAVY CHAIN - Multi-layer, thicker than left click === */}
      <mesh ref={chainMainRef} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MATERIALS.heavyChainMain} />
      <mesh ref={chainOuterRef} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MATERIALS.heavyChainOuter} />
      <mesh ref={chainCoreRef} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MATERIALS.heavyChainCore} />
      <mesh ref={chainMegaGlowRef} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MATERIALS.heavyChainMegaGlow} />
    </group>
  );
}, (prev, next) => {
  // Custom comparison: only re-render if hook.id or state changes
  return prev.hook.id === next.hook.id && prev.hook.state === next.hook.state;
});
