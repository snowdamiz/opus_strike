import { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';

// Track if hookshot materials have been precompiled
let hookshotMaterialsPrecompiled = false;
import { useGameStore, type HookProjectileData, type DragHookData, type GrappleTrapData, type SwingLineData, type GrappleLineData, type EarthWallData } from '../../store/gameStore';
import { checkGroundWithNormal, isPhysicsReady, raycastDirection } from '../../hooks/usePhysics';
import { damageNpc } from '../ui/GameConsole';
import { 
  SHARED_GEOMETRIES, 
  HOOKSHOT_COLORS, 
  EARTH_COLORS,
  getHookshotMaterials,
  TEMP_VECTORS,
  precompileHookshotMaterials,
} from './effectResources';

// PRE-LOAD all hookshot materials at module load time (before any component mounts)
// This ensures shaders are created immediately, not on first ability use
const HOOKSHOT_MATS = getHookshotMaterials();

// ============================================================================
// HOOK PROJECTILE - Short range chain hooks (basic attack)
// Features a proper hook with energy rope, shoots out and retracts
// FULLY OPTIMIZED: Zero state updates in useFrame, all refs, pre-allocated objects
// ============================================================================

const HOOK_SPEED = 38;
const HOOK_MAX_DISTANCE = 10; // Reduced for close-range
const HOOK_DAMAGE = 25;
const HOOK_HIT_RADIUS = 1.0;
const HOOK_RETRACT_SPEED = 50;

// Hand position offset from player feet (matches spawn position in PlayerController)
const HAND_HEIGHT = 0.3;

// Get shared materials from centralized resources
const getHookMaterials = () => getHookshotMaterials();

interface HookProjectileProps {
  hook: HookProjectileData;
}

function HookProjectile({ hook }: HookProjectileProps) {
  const groupRef = useRef<THREE.Group>(null);
  const hookRef = useRef<THREE.Group>(null);
  const ropeMainRef = useRef<THREE.Mesh>(null);
  const ropeGlowRef = useRef<THREE.Mesh>(null);
  const ropeCoreRef = useRef<THREE.Mesh>(null);
  
  // Get shared materials once
  const HOOK_MATERIALS = getHookMaterials();
  
  // All state tracked via refs - NO useState, NO store updates in render loop
  const hasHitRef = useRef(false);
  const hookStateRef = useRef<'extending' | 'retracting'>(hook.state as 'extending' | 'retracting');
  const currentPosRef = useRef({ x: hook.position.x, y: hook.position.y, z: hook.position.z });
  const playerPosRef = useRef({ x: hook.startPosition.x, y: hook.startPosition.y, z: hook.startPosition.z });
  const isFirstFrameRef = useRef(true);
  const shouldRemoveRef = useRef(false);
  
  // Cache velocity values (they don't change)
  const velX = hook.velocity.x;
  const velY = hook.velocity.y;
  const velZ = hook.velocity.z;
  const speed = Math.sqrt(velX * velX + velY * velY + velZ * velZ);
  const dirX = velX / speed;
  const dirY = velY / speed;
  const dirZ = velZ / speed;
  
  // Get store actions once (not in useFrame)
  const removeHookProjectile = useGameStore(state => state.removeHookProjectile);
  
  useFrame((_, delta) => {
    if (!hookRef.current || shouldRemoveRef.current) return;
    
    // Get player position without triggering re-renders
    const state = useGameStore.getState();
    const localPlayer = state.localPlayer;
    const players = state.players;
    
    // Determine target player position
    let targetX: number, targetY: number, targetZ: number;
    if (localPlayer && hook.ownerId === localPlayer.id) {
      targetX = localPlayer.position.x;
      targetY = localPlayer.position.y + HAND_HEIGHT;
      targetZ = localPlayer.position.z;
    } else {
      const owner = players.get(hook.ownerId);
      if (owner) {
        targetX = owner.position.x;
        targetY = owner.position.y + HAND_HEIGHT;
        targetZ = owner.position.z;
      } else {
        targetX = hook.startPosition.x;
        targetY = hook.startPosition.y;
        targetZ = hook.startPosition.z;
      }
    }
    
    // Smooth lerp for player position (snap on first frame)
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
      // Move forward
      curPos.x += velX * delta;
      curPos.y += velY * delta;
      curPos.z += velZ * delta;
      
      // Check max distance
      const dx = curPos.x - pX;
      const dy = curPos.y - pY;
      const dz = curPos.z - pZ;
      if (dx * dx + dy * dy + dz * dz >= HOOK_MAX_DISTANCE * HOOK_MAX_DISTANCE) {
        hookStateRef.current = 'retracting';
      }
      
      // Terrain collision (throttled - not every frame)
      if (isPhysicsReady()) {
        const hit = raycastDirection(curPos.x, curPos.y, curPos.z, dirX, dirY, dirZ, delta * speed + 0.5);
        if (hit?.hit) {
          hookStateRef.current = 'retracting';
        }
      }
      
      // Enemy collision
      if (!hasHitRef.current && localPlayer) {
        for (const [playerId, player] of players) {
          if (playerId === localPlayer.id || player.state !== 'alive') continue;
          if (player.team === localPlayer.team) continue;
          
          const pdx = player.position.x - curPos.x;
          const pdy = (player.position.y + 0.9) - curPos.y;
          const pdz = player.position.z - curPos.z;
          
          if (pdx * pdx + pdy * pdy + pdz * pdz <= HOOK_HIT_RADIUS * HOOK_HIT_RADIUS) {
            hasHitRef.current = true;
            if (playerId.startsWith('npc_')) {
              damageNpc(playerId, HOOK_DAMAGE);
            }
            hookStateRef.current = 'retracting';
            break;
          }
        }
      }
    } else {
      // Retracting - move toward player
      const toX = pX - curPos.x;
      const toY = pY - curPos.y;
      const toZ = pZ - curPos.z;
      const distSq = toX * toX + toY * toY + toZ * toZ;
      
      if (distSq < 0.25) { // 0.5^2
        shouldRemoveRef.current = true;
        removeHookProjectile(hook.id);
        return;
      }
      
      const dist = Math.sqrt(distSq);
      const retractDelta = HOOK_RETRACT_SPEED * delta;
      curPos.x += (toX / dist) * retractDelta;
      curPos.y += (toY / dist) * retractDelta;
      curPos.z += (toZ / dist) * retractDelta;
    }
    
    // Update hook position directly
    hookRef.current.position.set(curPos.x, curPos.y, curPos.z);
    
    // Update hook orientation using shared temp vectors
    const hdx = curPos.x - pX;
    const hdy = curPos.y - pY;
    const hdz = curPos.z - pZ;
    const hLen = Math.sqrt(hdx * hdx + hdy * hdy + hdz * hdz);
    
    if (hLen > 0.01) {
      TEMP_VECTORS.v1.set(hdx / hLen, hdy / hLen, hdz / hLen);
      TEMP_VECTORS.quat1.setFromUnitVectors(TEMP_VECTORS.forward, TEMP_VECTORS.v1);
      hookRef.current.quaternion.copy(TEMP_VECTORS.quat1);
    }
    
    // Update rope meshes directly (no React state)
    TEMP_VECTORS.v2.set(curPos.x, curPos.y, curPos.z);
    TEMP_VECTORS.v3.set((pX + curPos.x) * 0.5, (pY + curPos.y) * 0.5, (pZ + curPos.z) * 0.5);
    
    if (ropeMainRef.current) {
      ropeMainRef.current.position.copy(TEMP_VECTORS.v3);
      ropeMainRef.current.scale.set(0.025, hLen, 0.025);
      ropeMainRef.current.lookAt(TEMP_VECTORS.v2);
      ropeMainRef.current.rotateX(Math.PI / 2);
    }
    if (ropeGlowRef.current) {
      ropeGlowRef.current.position.copy(TEMP_VECTORS.v3);
      ropeGlowRef.current.scale.set(0.05, hLen, 0.05);
      ropeGlowRef.current.lookAt(TEMP_VECTORS.v2);
      ropeGlowRef.current.rotateX(Math.PI / 2);
    }
    if (ropeCoreRef.current) {
      ropeCoreRef.current.position.copy(TEMP_VECTORS.v3);
      ropeCoreRef.current.scale.set(0.012, hLen, 0.012);
      ropeCoreRef.current.lookAt(TEMP_VECTORS.v2);
      ropeCoreRef.current.rotateX(Math.PI / 2);
    }
  });
  
  return (
    <group ref={groupRef}>
      {/* Hook head - uses shared materials */}
      <group ref={hookRef} position={[hook.position.x, hook.position.y, hook.position.z]}>
        <mesh position={[0, 0, 0.25]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.15, 0.15, 0.06]} material={HOOK_MATERIALS.ring} />
        <mesh rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.06, 0.6, 0.06]} material={HOOK_MATERIALS.shaft} />
        <mesh position={[0, 0, 0.1]} rotation={[0, 0, Math.PI / 2]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.04, 0.35, 0.04]} material={HOOK_MATERIALS.crown} />
        {/* Left arm */}
        <mesh position={[-0.1, 0, -0.2]} rotation={[0.3, 0, -0.8]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.045, 0.25, 0.045]} material={HOOK_MATERIALS.shaft} />
        <mesh position={[-0.24, 0, -0.3]} rotation={[0.5, 0, -1.2]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.06, 0.14, 0.03]} material={HOOK_MATERIALS.fluke} />
        {/* Right arm */}
        <mesh position={[0.1, 0, -0.2]} rotation={[0.3, 0, 0.8]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.045, 0.25, 0.045]} material={HOOK_MATERIALS.shaft} />
        <mesh position={[0.24, 0, -0.3]} rotation={[0.5, 0, 1.2]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.06, 0.14, 0.03]} material={HOOK_MATERIALS.fluke} />
        {/* Tip */}
        <mesh position={[0, 0, -0.35]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.08, 0.12, 0.08]} material={HOOK_MATERIALS.tip} />
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={0.2} material={HOOK_MATERIALS.glow} />
        <pointLight color={HOOKSHOT_COLORS.energy} intensity={2} distance={3} decay={2} />
      </group>
      
      {/* Rope layers - updated via refs, using shared materials */}
      <mesh ref={ropeMainRef} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MATERIALS.ropeMain} />
      <mesh ref={ropeGlowRef} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MATERIALS.ropeGlow} />
      <mesh ref={ropeCoreRef} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MATERIALS.ropeCore} />
    </group>
  );
}

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

interface DragHookProps {
  hook: DragHookData;
}

function DragHookEffect({ hook }: DragHookProps) {
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
    
    // Determine target player position (same as left click)
    let targetX: number, targetY: number, targetZ: number;
    if (localPlayer && hook.ownerId === localPlayer.id) {
      targetX = localPlayer.position.x;
      targetY = localPlayer.position.y + DRAG_HOOK_HAND_HEIGHT;
      targetZ = localPlayer.position.z;
    } else {
      const owner = players.get(hook.ownerId);
      if (owner) {
        targetX = owner.position.x;
        targetY = owner.position.y + DRAG_HOOK_HAND_HEIGHT;
        targetZ = owner.position.z;
      } else {
        targetX = hook.startPosition.x;
        targetY = hook.startPosition.y;
        targetZ = hook.startPosition.z;
      }
    }
    
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
        
        {/* Energy glow - BIGGER and more intense - uses shared materials */}
        <mesh ref={glowRef} geometry={SHARED_GEOMETRIES.sphere8} scale={0.35} material={HOOK_MATERIALS.glow} />
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={0.5} material={HOOK_MATERIALS.heavyGlowOuter} />
        
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
}

// ============================================================================
// GRAPPLE TRAP - AOE trap that hooks enemies (Ultimate / F ability)
// THROWN LIKE A GRENADE: Flies in arc affected by gravity, lands and activates
// VISUALS: Red circle border + hook device in center
// ============================================================================

const GRAPPLE_TRAP_RADIUS = 8;
const GRAPPLE_TRAP_DOT_DAMAGE = 15;
const GRAPPLE_TRAP_GRAVITY = 25; // Gravity affecting the thrown device
const GRAPPLE_TRAP_THROW_SPEED = 30; // Initial throw velocity

interface GrappleTrapProps {
  trap: GrappleTrapData;
}

function GrappleTrapEffect({ trap }: GrappleTrapProps) {
  const groupRef = useRef<THREE.Group>(null);
  const deviceRef = useRef<THREE.Group>(null);
  const circleRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  
  // Get pre-compiled shared materials once
  const HOOK_MATERIALS = getHookshotMaterials();
  
  // Flying state for grenade arc
  const isLandedRef = useRef(false);
  const currentPosRef = useRef({ 
    x: trap.startPosition?.x ?? trap.position.x, 
    y: trap.startPosition?.y ?? trap.position.y, 
    z: trap.startPosition?.z ?? trap.position.z 
  });
  const velocityRef = useRef({ 
    x: trap.velocity?.x ?? 0, 
    y: trap.velocity?.y ?? 0, 
    z: trap.velocity?.z ?? 0 
  });
  const landedPosRef = useRef({ x: trap.position.x, y: trap.position.y, z: trap.position.z });
  const landedTimeRef = useRef<number | null>(null);
  
  const lastDamageTimeRef = useRef<Map<string, number>>(new Map());
  
  useFrame((state, delta) => {
    if (!groupRef.current || !deviceRef.current) return;
    
    const time = state.clock.elapsedTime;
    const elapsed = (Date.now() - trap.startTime) / 1000;
    
    // Check if trap has expired
    if (landedTimeRef.current !== null) {
      const landedElapsed = (Date.now() - landedTimeRef.current) / 1000;
      if (landedElapsed >= trap.duration) return;
    }
    
    // === FLYING PHASE (grenade arc) ===
    if (!isLandedRef.current) {
      const pos = currentPosRef.current;
      const vel = velocityRef.current;
      
      // Apply gravity
      vel.y -= GRAPPLE_TRAP_GRAVITY * delta;
      
      // Move device
      pos.x += vel.x * delta;
      pos.y += vel.y * delta;
      pos.z += vel.z * delta;
      
      // Check for ground collision
      if (isPhysicsReady()) {
        const groundCheck = checkGroundWithNormal(pos.x, pos.y + 2, pos.z, 10);
        if (groundCheck && pos.y <= groundCheck.groundY + 0.1) {
          // Landed!
          isLandedRef.current = true;
          landedPosRef.current = { x: pos.x, y: groundCheck.groundY, z: pos.z };
          landedTimeRef.current = Date.now();
          pos.y = groundCheck.groundY;
        }
      } else if (pos.y <= 0) {
        // Fallback ground check
        isLandedRef.current = true;
        landedPosRef.current = { x: pos.x, y: 0, z: pos.z };
        landedTimeRef.current = Date.now();
        pos.y = 0;
      }
      
      // Update device position while flying
      groupRef.current.position.set(pos.x, pos.y, pos.z);
      
      // Spin while flying
      deviceRef.current.rotation.x += delta * 8;
      deviceRef.current.rotation.z += delta * 6;
      
      // Hide circle while flying
      if (circleRef.current) {
        circleRef.current.visible = false;
      }
      
      return;
    }
    
    // === LANDED PHASE (active trap) ===
    const { players, localPlayer } = useGameStore.getState();
    const landedPos = landedPosRef.current;
    
    // Position group at landed location
    groupRef.current.position.set(landedPos.x, landedPos.y, landedPos.z);
    
    // Show and animate circle
    if (circleRef.current) {
      circleRef.current.visible = true;
    }
    
    // Check for players in AOE and apply damage
    for (const [playerId, player] of players) {
      if (playerId === localPlayer?.id && trap.ownerTeam === localPlayer?.team) continue;
      if (player.state !== 'alive') continue;
      if (localPlayer && player.team === trap.ownerTeam) continue;
      
      const dx = player.position.x - landedPos.x;
      const dz = player.position.z - landedPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      
      if (dist <= trap.radius) {
        const lastDamage = lastDamageTimeRef.current.get(playerId) || 0;
        const now = Date.now();
        
        if (now - lastDamage > 1000) {
          lastDamageTimeRef.current.set(playerId, now);
          
          if (playerId.startsWith('npc_')) {
            damageNpc(playerId, GRAPPLE_TRAP_DOT_DAMAGE);
          }
        }
      }
    }
    
    // Animate device - slow spin when landed
    deviceRef.current.rotation.y += delta * 1.5;
    deviceRef.current.position.y = 0.4 + Math.sin(time * 2) * 0.05;
    
    // Animate light pulse
    if (lightRef.current) {
      lightRef.current.intensity = 2 + Math.sin(time * 4) * 0.5;
    }
  });
  
  // Check if already expired on mount
  const elapsed = (Date.now() - trap.startTime) / 1000;
  if (elapsed >= trap.duration + 5) return null; // Extra time for flight
  
  return (
    <group ref={groupRef} position={[currentPosRef.current.x, currentPosRef.current.y, currentPosRef.current.z]}>
      {/* === HOOK DEVICE - Central mechanical trap device === OPTIMIZED: uses shared materials */}
      <group ref={deviceRef} position={[0, 0.4, 0]}>
        {/* Main body - cylindrical core */}
        <mesh geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.2, 0.15, 0.2]} material={HOOK_MATERIALS.trapBody} />
        
        {/* Top cap with hook ring */}
        <mesh position={[0, 0.1, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.25, 0.05, 0.25]} material={HOOK_MATERIALS.trapCap} />
        
        {/* Hook attachment ring on top */}
        <mesh position={[0, 0.15, 0]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.12, 0.12, 0.04]} material={HOOK_MATERIALS.trapRing} />
      
        {/* Four hook arms extending outward */}
        {[0, 1, 2, 3].map(i => {
          const angle = (i * Math.PI / 2);
          return (
            <group key={i} rotation={[0, angle, 0]}>
              {/* Arm */}
              <mesh position={[0.18, -0.02, 0]} rotation={[0, 0, 0.6]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.04, 0.15, 0.04]} material={HOOK_MATERIALS.trapArm} />
              {/* Hook tip */}
              <mesh position={[0.28, -0.08, 0]} rotation={[0, 0, 1.8]} geometry={SHARED_GEOMETRIES.cone6} scale={[0.035, 0.08, 0.035]} material={HOOK_MATERIALS.trapHookTip} />
            </group>
          );
        })}
        
        {/* Bottom base */}
        <mesh position={[0, -0.1, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.22, 0.05, 0.22]} material={HOOK_MATERIALS.trapBase} />
      
        {/* Cyan energy core glow - matches hookshot theme */}
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={0.12} material={HOOK_MATERIALS.trapCoreGlow} />
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={0.2} material={HOOK_MATERIALS.trapOuterGlow} />
        
        {/* Device light */}
        <pointLight color={HOOKSHOT_COLORS.energy} intensity={2} distance={4} decay={2} />
      </group>
      
      {/* === CYAN CIRCLE BORDER - AOE indicator matching hookshot theme === */}
      <mesh ref={circleRef} rotation-x={-Math.PI / 2} position-y={0.05} geometry={SHARED_GEOMETRIES.ring24} scale={[trap.radius, trap.radius, 1]} material={HOOK_MATERIALS.trapCircleRing} />
      
      {/* Ground light when active */}
      <pointLight ref={lightRef} color={HOOKSHOT_COLORS.energy} intensity={2} distance={trap.radius * 1.2} decay={2} position={[0, 0.5, 0]} />
    </group>
  );
}

// ============================================================================
// EARTH WALL - Hook slides on ground, wall of dirt rises behind (E ability)
// ============================================================================

// Earth wall colors imported from effectResources

const EARTH_WALL_SPEED = 35; // Units per second
const EARTH_WALL_MAX_DISTANCE = 25;
const EARTH_WALL_SEGMENT_SPACING = 1.5; // Distance between wall segments
const EARTH_WALL_MAX_HEIGHT = 4; // Maximum wall height
const EARTH_WALL_WIDTH = 2.5; // Wall width
const EARTH_WALL_RISE_SPEED = 8; // How fast segments rise

interface EarthWallProps {
  wall: EarthWallData;
}

// Single dirt/rock wall segment - OPTIMIZED: Uses pre-compiled shared materials
function WallSegment({ 
  position, 
  targetHeight, 
  creationTime,
  index,
  rotationY, // Rotation to face perpendicular to travel direction
}: { 
  position: { x: number; y: number; z: number };
  targetHeight: number;
  creationTime: number;
  index: number;
  rotationY: number;
}) {
  const meshRef = useRef<THREE.Group>(null);
  const currentHeightRef = useRef(0.1); // Start with small height so it renders
  
  // Get pre-compiled shared materials once
  const HOOK_MATERIALS = getHookshotMaterials();
  
  // Select material variant based on index for natural look (uses pre-compiled materials)
  const colorVariation = (index % 3);
  const mainMaterial = colorVariation === 0 ? HOOK_MATERIALS.earthDirt : 
                       colorVariation === 1 ? HOOK_MATERIALS.earthDirtDark : HOOK_MATERIALS.earthDirtLight;
  
  useFrame((_, delta) => {
    if (!meshRef.current) return;
    
    // Rise up from ground
    if (currentHeightRef.current < targetHeight) {
      currentHeightRef.current = Math.min(
        currentHeightRef.current + EARTH_WALL_RISE_SPEED * delta, 
        targetHeight
      );
    }
    
    const h = currentHeightRef.current;
    
    // Update position - wall rises from ground
    meshRef.current.position.set(position.x, position.y + h / 2, position.z);
    meshRef.current.scale.set(1, Math.max(0.01, h), 1);
  });
  
  return (
    <group ref={meshRef} position={[position.x, position.y, position.z]} rotation={[0, rotationY, 0]}>
      {/* Main dirt block - wide to block vision - uses shared material */}
      <mesh geometry={SHARED_GEOMETRIES.box} scale={[EARTH_WALL_WIDTH, 1, 1]} material={mainMaterial} />
      
      {/* Rock chunks embedded in dirt - uses shared material */}
      <mesh 
        position={[0.4 * (index % 2 === 0 ? 1 : -1), 0.2, 0.35]} 
        geometry={SHARED_GEOMETRIES.box} 
        scale={[0.4, 0.3, 0.3]}
        rotation={[0.2, 0.3, 0.1]}
        material={HOOK_MATERIALS.earthRock}
      />
      
      <mesh 
        position={[-0.3 * (index % 2 === 0 ? 1 : -1), -0.15, 0.3]} 
        geometry={SHARED_GEOMETRIES.box} 
        scale={[0.35, 0.25, 0.25]}
        rotation={[0.1, -0.2, 0.15]}
        material={HOOK_MATERIALS.earthRock}
      />
      
      {/* Back side rock - uses shared material */}
      <mesh 
        position={[0.2 * (index % 2 === 0 ? -1 : 1), 0, -0.35]} 
        geometry={SHARED_GEOMETRIES.box} 
        scale={[0.3, 0.35, 0.25]}
        rotation={[-0.1, 0.2, 0.1]}
        material={HOOK_MATERIALS.earthRock}
      />
      
      {/* Top grass/soil texture - uses shared material */}
      <mesh 
        position={[0, 0.51, 0]} 
        geometry={SHARED_GEOMETRIES.box} 
        scale={[EARTH_WALL_WIDTH * 0.95, 0.1, 0.9]}
        material={HOOK_MATERIALS.earthGrass}
      />
      
      {/* Dirt debris around base - front - uses shared material */}
      {[0, 1, 2].map((i) => (
        <mesh 
          key={`front-${i}`}
          position={[
            (i - 1) * 0.7 + Math.sin(index + i) * 0.2, 
            -0.45, 
            0.6 + Math.cos(index + i) * 0.15
          ]} 
          geometry={SHARED_GEOMETRIES.sphere8} 
          scale={[0.2, 0.12, 0.2]}
          material={HOOK_MATERIALS.earthDebris}
        />
      ))}
      
      {/* Dirt debris around base - back - uses shared material */}
      {[0, 1].map((i) => (
        <mesh 
          key={`back-${i}`}
          position={[
            (i - 0.5) * 0.8, 
            -0.45, 
            -0.55 + Math.sin(index + i) * 0.1
          ]} 
          geometry={SHARED_GEOMETRIES.sphere8} 
          scale={[0.18, 0.1, 0.18]}
          material={HOOK_MATERIALS.earthDebris}
        />
      ))}
    </group>
  );
}

function EarthWallEffect({ wall }: EarthWallProps) {
  const groupRef = useRef<THREE.Group>(null);
  const hookRef = useRef<THREE.Group>(null);
  
  const hookProgressRef = useRef(0);
  const lastSegmentDistRef = useRef(0);
  const hookGroundYRef = useRef(wall.startPosition.y); // Track hook's ground level
  
  // Get pre-compiled shared materials once
  const HOOK_MATERIALS = getHookshotMaterials();
  
  // Use state for wall segments so React re-renders when they're added
  const [wallSegments, setWallSegments] = useState<{ x: number; y: number; z: number; height: number; time: number }[]>([]);
  
  const removeEarthWall = useGameStore(state => state.removeEarthWall);
  
  
  useFrame((state, delta) => {
    if (!groupRef.current || !hookRef.current) return;
    
    const time = state.clock.elapsedTime;
    const elapsed = (Date.now() - wall.startTime) / 1000;
    
    // Check if wall should be removed (duration expired)
    if (elapsed > wall.duration + 2) {
      removeEarthWall(wall.id);
      return;
    }
    
    // Calculate current hook XZ position (travels horizontally)
    const currentDist = Math.min(hookProgressRef.current, wall.maxDistance);
    const hookX = wall.startPosition.x + wall.direction.x * currentDist;
    const hookZ = wall.startPosition.z + wall.direction.z * currentDist;
    
    // Raycast to find ground level at hook position
    if (isPhysicsReady()) {
      const groundCheck = checkGroundWithNormal(hookX, wall.startPosition.y + 50, hookZ, 100);
      if (groundCheck) {
        hookGroundYRef.current = groundCheck.groundY;
      }
    }
    
    const hookPos = {
      x: hookX,
      y: hookGroundYRef.current,
      z: hookZ,
    };
    
    // Hook is still traveling
    if (hookProgressRef.current < wall.maxDistance) {
      hookProgressRef.current += EARTH_WALL_SPEED * delta;
      
      // Create new wall segments behind the hook
      if (currentDist - lastSegmentDistRef.current >= EARTH_WALL_SEGMENT_SPACING && currentDist > 1) {
        lastSegmentDistRef.current = currentDist;
        
        // Calculate segment XZ position (slightly behind hook head)
        const segmentX = hookPos.x - wall.direction.x * 1.5;
        const segmentZ = hookPos.z - wall.direction.z * 1.5;
        
        // Raycast to find ground level at segment position
        let segmentGroundY = hookGroundYRef.current;
        if (isPhysicsReady()) {
          const segmentGroundCheck = checkGroundWithNormal(segmentX, wall.startPosition.y + 50, segmentZ, 100);
          if (segmentGroundCheck) {
            segmentGroundY = segmentGroundCheck.groundY;
          }
        }
        
        // Vary height slightly for natural look
        const heightVariation = 0.8 + Math.random() * 0.4;
        
        // Add new segment using setState to trigger re-render
        setWallSegments(prev => [...prev, {
          x: segmentX,
          y: segmentGroundY,
          z: segmentZ,
          height: EARTH_WALL_MAX_HEIGHT * heightVariation,
          time: Date.now(),
        }]);
        
      }
      
      // Update hook visual - position on ground
      hookRef.current.visible = true;
      hookRef.current.position.set(hookPos.x, hookPos.y + 0.5, hookPos.z);
      
      // Rotate hook to face direction of travel
      const angle = Math.atan2(wall.direction.x, wall.direction.z);
      hookRef.current.rotation.y = angle;
      
      // Bob the hook slightly as it travels
      hookRef.current.position.y += Math.sin(time * 15) * 0.1;
    } else {
      // Hook reached max distance - hide it
      hookRef.current.visible = false;
    }
  });
  
  return (
    <group ref={groupRef}>
      {/* THE GROUND HOOK - Large industrial hook that plows through ground - OPTIMIZED: uses shared materials */}
      <group ref={hookRef} position={[wall.startPosition.x, wall.startPosition.y + 0.5, wall.startPosition.z]}>
        {/* Main hook body - large and heavy */}
        <mesh geometry={SHARED_GEOMETRIES.box} scale={[0.8, 0.6, 1.5]} material={HOOK_MATERIALS.earthHookMetal} />
        
        {/* Plow blade at front */}
        <mesh position={[0, -0.1, -0.9]} rotation={[0.3, 0, 0]} geometry={SHARED_GEOMETRIES.box} scale={[1.2, 0.1, 0.5]} material={HOOK_MATERIALS.earthPlowBlade} />
        
        {/* Hook arm - curved down into ground */}
        <mesh position={[0, -0.2, -0.5]} rotation={[-0.5, 0, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.15, 0.8, 0.15]} material={HOOK_MATERIALS.earthHookMetal} />
        
        {/* Hook tip - buried in ground */}
        <mesh position={[0, -0.6, -0.2]} rotation={[-1.2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.2, 0.4, 0.2]} material={HOOK_MATERIALS.earthHookMetalLight} />
        
        {/* Side fins for stability */}
        <mesh position={[0.5, 0, 0]} rotation={[0, 0, 0.3]} geometry={SHARED_GEOMETRIES.box} scale={[0.1, 0.4, 0.8]} material={HOOK_MATERIALS.earthHookMetal} />
        <mesh position={[-0.5, 0, 0]} rotation={[0, 0, -0.3]} geometry={SHARED_GEOMETRIES.box} scale={[0.1, 0.4, 0.8]} material={HOOK_MATERIALS.earthHookMetal} />
        
        {/* Orange energy glow */}
        <mesh geometry={SHARED_GEOMETRIES.sphere12} scale={0.4} material={HOOK_MATERIALS.earthHookGlow} />
        
        {/* Dirt spray particles effect */}
        <pointLight color={EARTH_COLORS.hookGlow} intensity={4} distance={5} decay={2} />
        
        {/* Ground disturbance - ring of dirt being pushed up */}
        <mesh position={[0, -0.4, -0.3]} rotation={[-Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring24} scale={[1, 1, 0.3]} material={HOOK_MATERIALS.earthHookRing} />
      </group>
      
      {/* WALL SEGMENTS - Rising dirt walls perpendicular to travel direction */}
      {wallSegments.map((segment, i) => (
        <WallSegment
          key={`${wall.id}_seg_${i}`}
          position={segment}
          targetHeight={segment.height}
          creationTime={segment.time}
          index={i}
          rotationY={Math.atan2(wall.direction.x, wall.direction.z) + Math.PI / 2} // Perpendicular to travel
        />
      ))}
    </group>
  );
}

// ============================================================================
// SWING LINE - Kept for backwards compatibility but now unused for Hookshot E
// ============================================================================

interface SwingLineProps {
  line: SwingLineData;
}

function SwingLineEffect({ line }: SwingLineProps) {
  const groupRef = useRef<THREE.Group>(null);
  const hookRef = useRef<THREE.Group>(null);
  
  const hookExtensionRef = useRef(0);
  const hasReachedRef = useRef(false);
  const frameCount = useRef(0);
  
  const [ropePoints, setRopePoints] = useState<[[number, number, number], [number, number, number]]>([
    [line.startPosition.x, line.startPosition.y, line.startPosition.z],
    [line.startPosition.x, line.startPosition.y, line.startPosition.z]
  ]);
  
  const removeSwingLine = useGameStore(state => state.removeSwingLine);
  const updateSwingLine = useGameStore(state => state.updateSwingLine);
  
  
  useFrame((state, delta) => {
    frameCount.current++;
    
    if (!groupRef.current || !hookRef.current) return;
    
    const { localPlayer, players } = useGameStore.getState();
    
    let playerPos = line.startPosition;
    
    if (localPlayer && line.ownerId === localPlayer.id) {
      playerPos = {
        x: localPlayer.position.x,
        y: localPlayer.position.y + 0.6,
        z: localPlayer.position.z,
      };
    } else {
      const owner = players.get(line.ownerId);
      if (owner) {
        playerPos = {
          x: owner.position.x,
          y: owner.position.y + 0.6,
          z: owner.position.z,
        };
      }
    }
    
    const toTarget = {
      x: line.attachPoint.x - playerPos.x,
      y: line.attachPoint.y - playerPos.y,
      z: line.attachPoint.z - playerPos.z,
    };
    const totalDist = Math.sqrt(toTarget.x ** 2 + toTarget.y ** 2 + toTarget.z ** 2);
    const dirX = totalDist > 0 ? toTarget.x / totalDist : 0;
    const dirY = totalDist > 0 ? toTarget.y / totalDist : 0;
    const dirZ = totalDist > 0 ? toTarget.z / totalDist : 0;
    
    let hookPos = { x: playerPos.x, y: playerPos.y, z: playerPos.z };
    
    if (line.state === 'extending' && !hasReachedRef.current) {
      const speed = 90 * delta;
      hookExtensionRef.current += speed;
      
      const initialDist = Math.sqrt(
        (line.attachPoint.x - line.startPosition.x) ** 2 +
        (line.attachPoint.y - line.startPosition.y) ** 2 +
        (line.attachPoint.z - line.startPosition.z) ** 2
      );
      
      if (hookExtensionRef.current >= initialDist) {
        hasReachedRef.current = true;
        hookPos = { ...line.attachPoint };
        updateSwingLine(line.id, { state: 'attached' });
      } else {
        hookPos = {
          x: playerPos.x + dirX * hookExtensionRef.current,
          y: playerPos.y + dirY * hookExtensionRef.current,
          z: playerPos.z + dirZ * hookExtensionRef.current,
        };
      }
    } else if (line.state === 'attached' || line.state === 'swinging') {
      hasReachedRef.current = true;
      hookPos = { ...line.attachPoint };
    } else if (line.state === 'done') {
      removeSwingLine(line.id);
      return;
    }
    
    const elapsed = (Date.now() - line.startTime) / 1000;
    if (elapsed > line.duration + 1) {
      removeSwingLine(line.id);
      return;
    }
    
    hookRef.current.position.set(hookPos.x, hookPos.y, hookPos.z);
    
    if (totalDist > 0.01) {
      const quat = new THREE.Quaternion();
      quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(dirX, dirY, dirZ));
      hookRef.current.quaternion.copy(quat);
    }
    
    setRopePoints([
      [playerPos.x, playerPos.y, playerPos.z],
      [hookPos.x, hookPos.y, hookPos.z]
    ]);
  });
  
  if (!line.isActive && line.state === 'done') return null;
  
  // Get shared materials once (moved outside return to reduce allocations)
  const HOOK_MATERIALS = getHookMaterials();
  
  return (
    <group ref={groupRef}>
      <group ref={hookRef} position={[line.startPosition.x, line.startPosition.y, line.startPosition.z]}>
        {/* Uses shared pre-compiled materials */}
        <mesh position={[0, 0, 0.35]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.2, 0.2, 0.08]} material={HOOK_MATERIALS.ring} />
        <mesh rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.08, 0.8, 0.08]} material={HOOK_MATERIALS.shaft} />
        <mesh position={[0, 0, -0.45]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.1, 0.15, 0.1]} material={HOOK_MATERIALS.tip} />
        <pointLight color={0xffffff} intensity={2} distance={4} decay={2} />
      </group>
      
      <Line points={ropePoints} color={HOOKSHOT_COLORS.energy} lineWidth={8} transparent opacity={1} />
      <Line points={ropePoints} color={HOOKSHOT_COLORS.energyGlow} lineWidth={16} transparent opacity={0.4} />
      <Line points={ropePoints} color={0xffffff} lineWidth={3} transparent opacity={0.8} />
    </group>
  );
}

// ============================================================================
// GRAPPLE LINE - Quick grapple to geometry (Q ability)
// Shows a hook shooting out and rope connecting player to hook
// OPTIMIZED: Uses same ref-based rope rendering as basic attack for smooth following
// ============================================================================

// Height offset from player feet to hand position (matches basic attack)
const GRAPPLE_HAND_HEIGHT = 0.6;

interface GrappleLineProps {
  line: GrappleLineData;
}

function GrappleLineEffect({ line }: GrappleLineProps) {
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
    
    // Determine target player position
    let targetX: number, targetY: number, targetZ: number;
    if (localPlayer && line.ownerId === localPlayer.id) {
      targetX = localPlayer.position.x;
      targetY = localPlayer.position.y + GRAPPLE_HAND_HEIGHT;
      targetZ = localPlayer.position.z;
    } else {
      const owner = players.get(line.ownerId);
      if (owner) {
        targetX = owner.position.x;
        targetY = owner.position.y + GRAPPLE_HAND_HEIGHT;
        targetZ = owner.position.z;
      } else {
        targetX = line.startPosition.x;
        targetY = line.startPosition.y;
        targetZ = line.startPosition.z;
      }
    }
    
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
      {/* ANCHOR-STYLE GRAPPLING HOOK - OPTIMIZED: uses pre-compiled shared materials */}
      <group ref={hookRef} position={[line.startPosition.x, line.startPosition.y, line.startPosition.z]}>
        {/* === ANCHOR RING (top) - where rope attaches === */}
        <mesh position={[0, 0, 0.35]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.2, 0.2, 0.08]} material={HOOK_MATERIALS.ring} />
        
        {/* === MAIN SHAFT (vertical bar) === */}
        <mesh rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.08, 0.8, 0.08]} material={HOOK_MATERIALS.shaft} />
        
        {/* === CROWN/STOCK (horizontal bar near top) === */}
        <mesh position={[0, 0, 0.15]} rotation={[0, 0, Math.PI / 2]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.05, 0.5, 0.05]} material={HOOK_MATERIALS.crown} />
        
        {/* === ANCHOR ARMS/FLUKES (curved hooks at bottom) === */}
        {/* Left arm */}
        <group position={[-0.15, 0, -0.3]}>
          {/* Arm going outward and down */}
          <mesh rotation={[0.3, 0, -0.8]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.06, 0.35, 0.06]} material={HOOK_MATERIALS.shaft} />
          {/* Curved fluke tip */}
          <mesh position={[-0.2, 0, -0.15]} rotation={[0.5, 0, -1.2]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.08, 0.2, 0.04]} material={HOOK_MATERIALS.fluke} />
        </group>
        
        {/* Right arm */}
        <group position={[0.15, 0, -0.3]}>
          {/* Arm going outward and down */}
          <mesh rotation={[0.3, 0, 0.8]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.06, 0.35, 0.06]} material={HOOK_MATERIALS.shaft} />
          {/* Curved fluke tip */}
          <mesh position={[0.2, 0, -0.15]} rotation={[0.5, 0, 1.2]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.08, 0.2, 0.04]} material={HOOK_MATERIALS.fluke} />
        </group>
        
        {/* === BOTTOM POINT === */}
        <mesh position={[0, 0, -0.45]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.1, 0.15, 0.1]} material={HOOK_MATERIALS.tip} />
        
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
}

// ============================================================================
// GRAPPLE TRAP TARGETING INDICATOR
// ============================================================================

interface GrappleTrapTargetingProps {
  isActive: boolean;
  onTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

const TRAP_MAX_RANGE = 30;
const TRAP_MIN_RANGE = 3;

export function GrappleTrapTargetingIndicator({ isActive, onTargetUpdate }: GrappleTrapTargetingProps) {
  const indicatorRef = useRef<THREE.Group>(null);
  const isValidRef = useRef(false);
  const { camera } = useThree();
  
  useFrame(() => {
    if (!isActive) {
      if (indicatorRef.current) indicatorRef.current.visible = false;
      onTargetUpdate(null, false);
      return;
    }
    
    const localPlayer = useGameStore.getState().localPlayer;
    if (!localPlayer) {
      onTargetUpdate(null, false);
      return;
    }
    
    TEMP_VECTORS.v1.set(0, 0, -1).applyQuaternion(camera.quaternion);
    
    let targetX = camera.position.x;
    let targetY = camera.position.y;
    let targetZ = camera.position.z;
    let isValid = false;
    let foundTarget = false;
    
    if (isPhysicsReady()) {
      const directHit = raycastDirection(
        camera.position.x, camera.position.y, camera.position.z,
        TEMP_VECTORS.v1.x, TEMP_VECTORS.v1.y, TEMP_VECTORS.v1.z,
        TRAP_MAX_RANGE + 10
      );
      
      if (directHit && directHit.hit) {
        targetX = directHit.point.x;
        targetY = directHit.point.y;
        targetZ = directHit.point.z;
        foundTarget = true;
        
        if (!directHit.isWalkable) {
          const groundBelow = checkGroundWithNormal(targetX, targetY + 5, targetZ, 50);
          if (groundBelow?.isWalkable) {
            targetY = groundBelow.groundY + 0.1;
          }
        } else {
          targetY += 0.1;
        }
      }
      
      if (!foundTarget) {
        const pitch = Math.asin(Math.max(-1, Math.min(1, -TEMP_VECTORS.v1.y)));
        const baseDist = pitch > 0.3 ? 15 : (pitch > 0 ? 20 : 25);
        const sampleDistances = [baseDist * 0.5, baseDist, baseDist * 1.5, TRAP_MAX_RANGE];
        
        for (const dist of sampleDistances) {
          const sampleX = camera.position.x + TEMP_VECTORS.v1.x * dist;
          const sampleY = camera.position.y + TEMP_VECTORS.v1.y * dist;
          const sampleZ = camera.position.z + TEMP_VECTORS.v1.z * dist;
          
          const groundCheck = checkGroundWithNormal(sampleX, Math.max(sampleY + 50, camera.position.y + 50), sampleZ, 150);
          
          if (groundCheck?.isWalkable) {
            targetX = sampleX;
            targetY = groundCheck.groundY + 0.1;
            targetZ = sampleZ;
            foundTarget = true;
            break;
          }
        }
      }
      
      if (foundTarget) {
        const dx = targetX - localPlayer.position.x;
        const dz = targetZ - localPlayer.position.z;
        const distH = Math.sqrt(dx * dx + dz * dz);
        
        if (distH > TRAP_MAX_RANGE) {
          const scale = TRAP_MAX_RANGE / distH;
          targetX = localPlayer.position.x + dx * scale;
          targetZ = localPlayer.position.z + dz * scale;
          
          const groundCheck = checkGroundWithNormal(targetX, targetY + 30, targetZ, 100);
          if (groundCheck?.isWalkable) {
            targetY = groundCheck.groundY + 0.1;
          } else {
            foundTarget = false;
          }
        }
        
        if (foundTarget && distH >= TRAP_MIN_RANGE) {
          isValid = true;
        }
      }
    }
    
    TEMP_VECTORS.v4.set(targetX, targetY, targetZ);
    isValidRef.current = isValid;
    
    if (indicatorRef.current) {
      indicatorRef.current.visible = true;
      indicatorRef.current.position.copy(TEMP_VECTORS.v4);
    }
    
    onTargetUpdate(TEMP_VECTORS.v4.clone(), isValid);
  });
  
  if (!isActive) return null;
  
  // Use pre-compiled shared materials - select based on validity state
  const ringMaterial = isValidRef.current ? HOOKSHOT_MATS.targetRingValid : HOOKSHOT_MATS.targetRingInvalid;
  const crossMaterial = isValidRef.current ? HOOKSHOT_MATS.targetCross : HOOKSHOT_MATS.targetCrossInvalid;
  
  return (
    <group ref={indicatorRef}>
      {/* Main AOE ring - cyan border matching hookshot theme - OPTIMIZED: uses shared materials */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.1} geometry={SHARED_GEOMETRIES.ring24} scale={[GRAPPLE_TRAP_RADIUS, GRAPPLE_TRAP_RADIUS, 1]} material={ringMaterial} />
      {/* Center marker - white crosshair */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.circle16} scale={[0.4, 0.4, 1]} material={HOOKSHOT_MATS.targetCenter} />
      {/* Cross hairs */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.plane} scale={[0.12, GRAPPLE_TRAP_RADIUS * 2, 1]} material={crossMaterial} />
      <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.plane} scale={[0.12, GRAPPLE_TRAP_RADIUS * 2, 1]} material={crossMaterial} />
      
      <pointLight color={HOOKSHOT_COLORS.energy} intensity={2} distance={GRAPPLE_TRAP_RADIUS} decay={2} position-y={0.5} />
    </group>
  );
}

// ============================================================================
// HOOKSHOT EFFECTS WARMUP - Pre-renders hidden effects to eliminate first-use stutter
// Mount this BEFORE gameplay starts to precompile all shaders and geometries
// ============================================================================

let warmupComplete = false;

// Dummy data for warmup - positions far away so invisible
const WARMUP_HOOK: HookProjectileData = {
  id: 'warmup_hook',
  position: { x: -9999, y: -9999, z: -9999 },
  velocity: { x: 1, y: 0, z: 0 },
  startTime: 0,
  ownerId: 'warmup',
  ownerTeam: 'red',
  state: 'extending',
  maxDistance: 10,
  startPosition: { x: -9999, y: -9999, z: -9999 },
};

const WARMUP_DRAG_HOOK: DragHookData = {
  id: 'warmup_drag',
  position: { x: -9999, y: -9999, z: -9999 },
  velocity: { x: 1, y: 0, z: 0 },
  startTime: 0,
  ownerId: 'warmup',
  ownerTeam: 'red',
  state: 'flying',
  startPosition: { x: -9999, y: -9999, z: -9999 },
};

const WARMUP_SWING_LINE: SwingLineData = {
  id: 'warmup_swing',
  startPosition: { x: -9999, y: -9999, z: -9999 },
  attachPoint: { x: -9998, y: -9999, z: -9999 },
  startTime: 0,
  duration: 1,
  ownerId: 'warmup',
  state: 'extending',
  isActive: true,
};

const WARMUP_GRAPPLE_LINE: GrappleLineData = {
  id: 'warmup_grapple',
  startPosition: { x: -9999, y: -9999, z: -9999 },
  endPosition: { x: -9998, y: -9999, z: -9999 },
  startTime: 0,
  ownerId: 'warmup',
  state: 'extending',
};

const WARMUP_EARTH_WALL: EarthWallData = {
  id: 'warmup_wall',
  startPosition: { x: -9999, y: -9999, z: -9999 },
  direction: { x: 1, y: 0, z: 0 },
  startTime: 0,
  duration: 1,
  maxDistance: 10,
  ownerId: 'warmup',
  ownerTeam: 'red',
  hookProgress: 0,
  wallSegments: [],
};

const WARMUP_TRAP: GrappleTrapData = {
  id: 'warmup_trap',
  position: { x: -9999, y: -9999, z: -9999 },
  radius: 8,
  startTime: 0,
  duration: 1,
  ownerId: 'warmup',
  ownerTeam: 'red',
  startPosition: { x: -9999, y: -9999, z: -9999 },
  velocity: { x: 0, y: 0, z: 0 },
  hookedPlayers: [],
};

/**
 * Warmup component - Mount this OUTSIDE the isPlaying check to precompile
 * all hookshot effect shaders before gameplay starts.
 * Renders hidden instances of each effect type once, then removes them.
 */
export function HookshotEffectsWarmup() {
  const [showWarmup, setShowWarmup] = useState(!warmupComplete);
  const { gl } = useThree();
  
  useEffect(() => {
    if (!warmupComplete && gl) {
      warmupComplete = true;
      // Precompile materials
      precompileHookshotMaterials(gl);
      
      // Keep warmup meshes rendered for 2 frames to ensure GPU compilation
      const timer = setTimeout(() => {
        setShowWarmup(false);
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [gl]);
  
  if (!showWarmup) return null;
  
  // Render hidden instances of ALL effect types to force shader compilation
  return (
    <group position={[-9999, -9999, -9999]} visible={false}>
      {/* Basic hook projectile */}
      <HookProjectile hook={WARMUP_HOOK} />
      
      {/* Drag hook (heavy attack) */}
      <DragHookEffect hook={WARMUP_DRAG_HOOK} />
      
      {/* Swing line (has Line component from drei that needs compilation) */}
      <SwingLineEffect line={WARMUP_SWING_LINE} />
      
      {/* Grapple line (Q ability) */}
      <GrappleLineEffect line={WARMUP_GRAPPLE_LINE} />
      
      {/* Earth wall (E ability) */}
      <EarthWallEffect wall={WARMUP_EARTH_WALL} />
      
      {/* Grapple trap (ultimate) */}
      <GrappleTrapEffect trap={WARMUP_TRAP} />
    </group>
  );
}

// ============================================================================
// HOOKSHOT EFFECTS MANAGER
// ============================================================================

export function HookshotEffectsManager() {
  const hookProjectiles = useGameStore(state => state.hookProjectiles);
  const dragHooks = useGameStore(state => state.dragHooks);
  const grappleTraps = useGameStore(state => state.grappleTraps);
  const swingLines = useGameStore(state => state.swingLines);
  const grappleLines = useGameStore(state => state.grappleLines);
  const earthWalls = useGameStore(state => state.earthWalls);
  
  // Get the WebGL renderer for shader precompilation
  const { gl } = useThree();
  
  // Pre-compile all hookshot materials on first render (backup in case warmup missed)
  useEffect(() => {
    if (gl && !hookshotMaterialsPrecompiled) {
      hookshotMaterialsPrecompiled = true;
      precompileHookshotMaterials(gl);
    }
  }, [gl]);
  
  // Cleanup interval
  useEffect(() => {
    const interval = setInterval(() => {
      useGameStore.getState().clearExpiredHookProjectiles();
      useGameStore.getState().clearExpiredDragHooks();
      useGameStore.getState().clearExpiredGrappleTraps();
      useGameStore.getState().clearExpiredSwingLines();
      useGameStore.getState().clearExpiredGrappleLines();
      useGameStore.getState().clearExpiredEarthWalls();
    }, 150);
    
    return () => clearInterval(interval);
  }, []);
  
  return (
    <group>
      {/* Basic attack hooks */}
      {hookProjectiles.map(hook => (
        <HookProjectile key={hook.id} hook={hook} />
      ))}
      
      {/* Heavy attack drag hooks */}
      {dragHooks.map(hook => (
        <DragHookEffect key={hook.id} hook={hook} />
      ))}
      
      {/* Ultimate grapple traps */}
      {grappleTraps.map(trap => (
        <GrappleTrapEffect key={trap.id} trap={trap} />
      ))}
      
      {/* Swing lines (legacy, kept for compatibility) */}
      {swingLines.map(line => (
        <SwingLineEffect key={line.id} line={line} />
      ))}
      
      {/* Grapple lines (Q ability) */}
      {grappleLines.map(line => (
        <GrappleLineEffect key={line.id} line={line} />
      ))}
      
      {/* Earth Walls (E ability - hook slides on ground, wall rises behind) */}
      {earthWalls.map(wall => (
        <EarthWallEffect key={wall.id} wall={wall} />
      ))}
    </group>
  );
}


