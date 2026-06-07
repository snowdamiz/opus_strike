import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, type HookProjectileData } from '../../../store/gameStore';
import { isPhysicsReady, raycastDirection } from '../../../hooks/usePhysics';
import { HOOKSHOT_CHAIN_SOCKET } from '../../../hooks/player/constants';
import { writeOwnerVisualPosition } from './ownerPosition';
import { triggerTerrainImpact } from '../TerrainImpactEffects';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { 
  SHARED_GEOMETRIES, 
  HOOKSHOT_COLORS, 
  getHookshotMaterials,
  TEMP_VECTORS,
} from '../effectResources';
import {
  HOOK_MAIN_ROPE_MATERIAL,
  PLIABLE_ROPE_SEGMENT_COUNT,
  ROPE_SEGMENT_INDICES,
  createRopePoints,
  updatePliableRopePoints,
  updateRopeSegment,
} from './rope';

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

// Get shared materials from centralized resources
const getHookMaterials = () => getHookshotMaterials();

interface HookProjectileProps {
  hook: HookProjectileData;
}

export const HookProjectile = React.memo(({ hook }: HookProjectileProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const hookRef = useRef<THREE.Group>(null);
  const muzzleRef = useRef<THREE.Group>(null);
  const ropeMainRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ropeGlowRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ropeCoreRefs = useRef<(THREE.Mesh | null)[]>([]);
  
  // Get shared materials once
  const HOOK_MATERIALS = getHookMaterials();
  
  // All state tracked via refs - NO useState, NO store updates in render loop
  const hasHitRef = useRef(false);
  const hookStateRef = useRef<'extending' | 'retracting'>(hook.state as 'extending' | 'retracting');
  const currentPosRef = useRef({ x: hook.position.x, y: hook.position.y, z: hook.position.z });
  const playerPosRef = useRef({ x: hook.startPosition.x, y: hook.startPosition.y, z: hook.startPosition.z });
  const ownerVisualPositionRef = useRef({ x: hook.startPosition.x, y: hook.startPosition.y, z: hook.startPosition.z });
  const smoothedSocketRef = useRef(new THREE.Vector3(hook.startPosition.x, hook.startPosition.y, hook.startPosition.z));
  const ropeLagRef = useRef(new THREE.Vector3());
  const ropeControlARef = useRef(new THREE.Vector3());
  const ropeControlBRef = useRef(new THREE.Vector3());
  const ropePointsRef = useRef(createRopePoints());
  const isFirstFrameRef = useRef(true);
  const socketInitializedRef = useRef(false);
  const shouldRemoveRef = useRef(false);
  
  // Cache velocity values (they don't change)
  const velX = hook.velocity.x;
  const velY = hook.velocity.y;
  const velZ = hook.velocity.z;
  const speed = Math.sqrt(velX * velX + velY * velY + velZ * velZ);
  const dirX = velX / speed;
  const dirY = velY / speed;
  const dirZ = velZ / speed;
  const launchSide = hook.launchSide ?? 1;
  const launchSocketOffset = {
    forwardOffset: HOOKSHOT_CHAIN_SOCKET.forwardOffset,
    sideOffset: HOOKSHOT_CHAIN_SOCKET.sideOffset * launchSide,
    yaw: hook.launchYaw,
  };
  
  // Get store actions once (not in useFrame)
  const removeHookProjectile = useGameStore(state => state.removeHookProjectile);
  
  useFrame((frameState, delta) => {
    if (!hookRef.current || shouldRemoveRef.current) return;
    
    // Get player position without triggering re-renders
    const state = useGameStore.getState();
    const localPlayer = state.localPlayer;
    const players = state.players;
    
    const targetPosition = writeOwnerVisualPosition(
      ownerVisualPositionRef.current,
      hook.ownerId,
      HOOKSHOT_CHAIN_SOCKET.handHeight,
      hook.startPosition,
      players,
      localPlayer,
      launchSocketOffset
    );
    const targetX = targetPosition.x;
    const targetY = targetPosition.y;
    const targetZ = targetPosition.z;
    
    // Local hooks should feel hard-attached to the hand. Remote owners keep a
    // short visual smoothing step to hide network position jumps.
    const isLocalOwner = localPlayer?.id === hook.ownerId;
    const lerpFactor = isLocalOwner || isFirstFrameRef.current ? 1 : Math.min(1, 20 * delta);
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
      const dx = curPos.x - hook.startPosition.x;
      const dy = curPos.y - hook.startPosition.y;
      const dz = curPos.z - hook.startPosition.z;
      const maxDistance = Math.min(hook.maxDistance, HOOK_MAX_DISTANCE);
      if (dx * dx + dy * dy + dz * dz >= maxDistance * maxDistance) {
        hookStateRef.current = 'retracting';
      }
      
      // Terrain collision (throttled - not every frame)
      if (isPhysicsReady()) {
        const hit = raycastDirection(curPos.x, curPos.y, curPos.z, dirX, dirY, dirZ, delta * speed + 0.5);
        if (hit?.hit) {
          triggerTerrainImpact('hookshot_hook', hit.point, {
            normal: hit.normal,
            direction: { x: dirX, y: dirY, z: dirZ },
          });
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
    const ropePoints = ropePointsRef.current;
    ropePoints[0].set(pX, pY, pZ);
    ropePoints[PLIABLE_ROPE_SEGMENT_COUNT].set(curPos.x, curPos.y, curPos.z);

    if (!socketInitializedRef.current) {
      smoothedSocketRef.current.copy(ropePoints[0]);
      socketInitializedRef.current = true;
    }

    const socketAlpha = 1 - Math.exp(-delta * 7);
    smoothedSocketRef.current.lerp(ropePoints[0], socketAlpha);
    ropeLagRef.current.copy(smoothedSocketRef.current).sub(ropePoints[0]);
    const maxLag = 1.15;
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
      hLen
    );

    // Update rope meshes directly (no React state). The endpoints stay exact,
    // while the sampled curve inherits a little source lag like Blaze's flame.
    for (let i = 0; i < PLIABLE_ROPE_SEGMENT_COUNT; i++) {
      updateRopeSegment(ropeGlowRefs.current[i], ropePoints[i], ropePoints[i + 1], 0.055);
      updateRopeSegment(ropeMainRefs.current[i], ropePoints[i], ropePoints[i + 1], 0.018);
      updateRopeSegment(ropeCoreRefs.current[i], ropePoints[i], ropePoints[i + 1], 0.012);
    }

    if (muzzleRef.current) {
      const pulse = 1 + Math.sin(frameState.clock.elapsedTime * 32) * 0.08;
      muzzleRef.current.position.copy(ropePoints[0]);
      muzzleRef.current.scale.setScalar(pulse);
      if (hLen > 0.01) {
        muzzleRef.current.quaternion.copy(hookRef.current.quaternion);
      }
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
        <BudgetedPointLight budgetPriority={2} color={HOOKSHOT_COLORS.energy} intensity={2} distance={3} decay={2} />
      </group>
      
      {/* Local launcher flash so the hook has a visible source instead of appearing from empty air */}
      <group ref={muzzleRef} position={[hook.startPosition.x, hook.startPosition.y, hook.startPosition.z]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.16, 0.16, 0.04]} material={HOOK_MATERIALS.ring} />
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={0.12} material={HOOK_MATERIALS.glow} />
        <BudgetedPointLight budgetPriority={1.5} color={HOOKSHOT_COLORS.energy} intensity={1.2} distance={2.5} decay={2} />
      </group>

      {/* Curved rope layers - segmented so source movement has velocity lag */}
      {ROPE_SEGMENT_INDICES.map(i => (
        <mesh key={`rope-glow-${i}`} ref={el => ropeGlowRefs.current[i] = el} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MATERIALS.ropeGlow} />
      ))}
      {ROPE_SEGMENT_INDICES.map(i => (
        <mesh key={`rope-main-${i}`} ref={el => ropeMainRefs.current[i] = el} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MAIN_ROPE_MATERIAL} />
      ))}
      {ROPE_SEGMENT_INDICES.map(i => (
        <mesh key={`rope-core-${i}`} ref={el => ropeCoreRefs.current[i] = el} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MATERIALS.ropeCore} />
      ))}
    </group>
  );
}, (prev, next) => {
  // Custom comparison: only re-render if hook.id or hook.state changes
  return prev.hook.id === next.hook.id && prev.hook.state === next.hook.state;
});
