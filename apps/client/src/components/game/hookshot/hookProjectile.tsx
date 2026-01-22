import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, type HookProjectileData } from '../../../store/gameStore';
import { isPhysicsReady, raycastDirection } from '../../../hooks/usePhysics';
import { damageNpc } from '../../ui/GameConsole';
import { 
  SHARED_GEOMETRIES, 
  HOOKSHOT_COLORS, 
  getHookshotMaterials,
  TEMP_VECTORS,
} from '../effectResources';

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

export const HookProjectile = React.memo(({ hook }: HookProjectileProps) => {
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
}, (prev, next) => {
  // Custom comparison: only re-render if hook.id or hook.state changes
  return prev.hook.id === next.hook.id && prev.hook.state === next.hook.state;
});

