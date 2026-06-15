import React, { useRef } from 'react';
import * as THREE from 'three';
import { HOOKSHOT_CHAIN_HOOKS_COLLISION_RADIUS } from '@voxel-strike/shared';
import { useGameStore, type HookProjectileData } from '../../../store/gameStore';
import { findCombatVisualEnemyPlayerHit, rebuildCombatVisualFrameCache } from '../../../store/visualStore';
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
import { writeAbilitySocketOrigin } from '../../../model-system/abilitySocketResolver';
import { getFirstChronosAegisVisualHit } from '../chronos/aegisCollision';
import { getAuthoritativeProjectileImpactHit } from '../projectileImpact';
import { getFrameClock } from '../../../utils/frameClock';
import {
  HOOK_MAIN_ROPE_MATERIAL,
  PLIABLE_ROPE_SEGMENT_COUNT,
  ROPE_SEGMENT_INDICES,
  createRopePoints,
  updatePliableRopePoints,
  updateRopeSegment,
} from './rope';
import { HookshotProjectileArrowHead } from './arrowHead';
import { useHookshotFrameUpdater } from './hookshotFrameRegistry';

// ============================================================================
// HOOK PROJECTILE - Short range chain hooks (basic attack)
// Features a proper hook with energy rope, shoots out and retracts
// FULLY OPTIMIZED: Zero state updates in useFrame, all refs, pre-allocated objects
// ============================================================================

const HOOK_RETRACT_SPEED = 50;

// Get shared materials from centralized resources
const getHookMaterials = () => getHookshotMaterials();

function writeLocalHookSocketPosition(out: { x: number; y: number; z: number }, launchSide: -1 | 1): boolean {
  return writeAbilitySocketOrigin(out, {
    ownerScope: 'localViewmodel',
    abilityId: 'hookshot_basic_attack',
    side: launchSide,
  });
}

export interface HookProjectileSlotHandle {
  slotIndex: number;
  hook: HookProjectileData | null;
}

export function createHookProjectileSlotHandle(slotIndex: number): HookProjectileSlotHandle {
  return {
    slotIndex,
    hook: null,
  };
}

interface HookProjectileProps {
  slot: HookProjectileSlotHandle;
}

export const HookProjectile = React.memo(({ slot }: HookProjectileProps) => {
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
  const activeHookIdRef = useRef<string | null>(null);
  const hookStateRef = useRef<'extending' | 'retracting'>('extending');
  const currentPosRef = useRef({ x: 0, y: 0, z: 0 });
  const previousPosRef = useRef({ x: 0, y: 0, z: 0 });
  const playerPosRef = useRef({ x: 0, y: 0, z: 0 });
  const ownerVisualPositionRef = useRef({ x: 0, y: 0, z: 0 });
  const smoothedSocketRef = useRef(new THREE.Vector3());
  const ropeLagRef = useRef(new THREE.Vector3());
  const ropeControlARef = useRef(new THREE.Vector3());
  const ropeControlBRef = useRef(new THREE.Vector3());
  const ropePointsRef = useRef(createRopePoints());
  const isFirstFrameRef = useRef(true);
  const socketInitializedRef = useRef(false);
  const shouldRemoveRef = useRef(false);
  
  // Get store actions once (not in useFrame)
  const removeHookProjectile = useGameStore(state => state.removeHookProjectile);
  
  useHookshotFrameUpdater(`hook-projectile-slot:${slot.slotIndex}`, (frameState, delta) => {
    const hook = slot.hook;
    if (!hookRef.current || !groupRef.current || !hook) {
      if (groupRef.current) groupRef.current.visible = false;
      activeHookIdRef.current = null;
      return;
    }

    if (activeHookIdRef.current !== hook.id) {
      activeHookIdRef.current = hook.id;
      hasHitRef.current = false;
      hookStateRef.current = hook.state as 'extending' | 'retracting';
      currentPosRef.current.x = hook.position.x;
      currentPosRef.current.y = hook.position.y;
      currentPosRef.current.z = hook.position.z;
      previousPosRef.current.x = hook.position.x;
      previousPosRef.current.y = hook.position.y;
      previousPosRef.current.z = hook.position.z;
      playerPosRef.current.x = hook.startPosition.x;
      playerPosRef.current.y = hook.startPosition.y;
      playerPosRef.current.z = hook.startPosition.z;
      ownerVisualPositionRef.current.x = hook.startPosition.x;
      ownerVisualPositionRef.current.y = hook.startPosition.y;
      ownerVisualPositionRef.current.z = hook.startPosition.z;
      smoothedSocketRef.current.set(hook.startPosition.x, hook.startPosition.y, hook.startPosition.z);
      ropeLagRef.current.set(0, 0, 0);
      ropeControlARef.current.set(0, 0, 0);
      ropeControlBRef.current.set(0, 0, 0);
      ropePointsRef.current = createRopePoints();
      isFirstFrameRef.current = true;
      socketInitializedRef.current = false;
      shouldRemoveRef.current = false;
      groupRef.current.visible = true;
      hookRef.current.position.set(hook.position.x, hook.position.y, hook.position.z);
    }

    if (shouldRemoveRef.current) return;

    const velX = hook.velocity.x;
    const velY = hook.velocity.y;
    const velZ = hook.velocity.z;
    const speed = Math.max(0.0001, Math.sqrt(velX * velX + velY * velY + velZ * velZ));
    const dirX = velX / speed;
    const dirY = velY / speed;
    const dirZ = velZ / speed;
    const hookDirection = { x: dirX, y: dirY, z: dirZ };
    const launchSide = hook.launchSide ?? 1;
    const launchSocketOffset = {
      forwardOffset: HOOKSHOT_CHAIN_SOCKET.forwardOffset,
      sideOffset: HOOKSHOT_CHAIN_SOCKET.sideOffset * launchSide,
      yaw: hook.launchYaw,
      abilityId: 'hookshot_basic_attack',
      side: launchSide,
    };
    
    // Get player position without triggering re-renders
    const state = useGameStore.getState();
    const localPlayer = state.localPlayer;
    const players = state.players;
    
    const isLocalOwner = localPlayer?.id === hook.ownerId;
    const targetPosition = isLocalOwner && writeLocalHookSocketPosition(ownerVisualPositionRef.current, launchSide)
      ? ownerVisualPositionRef.current
      : writeOwnerVisualPosition(
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
      const moveDistance = speed * delta;
      const previousPosition = previousPosRef.current;
      previousPosition.x = curPos.x;
      previousPosition.y = curPos.y;
      previousPosition.z = curPos.z;
      curPos.x += velX * delta;
      curPos.y += velY * delta;
      curPos.z += velZ * delta;
      
      // Check max distance
      const dx = curPos.x - hook.startPosition.x;
      const dy = curPos.y - hook.startPosition.y;
      const dz = curPos.z - hook.startPosition.z;
      if (dx * dx + dy * dy + dz * dz >= hook.maxDistance * hook.maxDistance) {
        hookStateRef.current = 'retracting';
      }
      
      // Skill/terrain collision
      const authoritativeHit = hook.interceptedByChronosAegis
        ? getAuthoritativeProjectileImpactHit(
          previousPosition,
          hookDirection,
          hook.impactPosition,
          moveDistance + HOOKSHOT_CHAIN_HOOKS_COLLISION_RADIUS,
          HOOKSHOT_CHAIN_HOOKS_COLLISION_RADIUS
        )
        : null;
      const aegisHit = getFirstChronosAegisVisualHit(
        previousPosition,
        hookDirection,
        moveDistance + HOOKSHOT_CHAIN_HOOKS_COLLISION_RADIUS,
        hook.ownerTeam,
        hook.ownerId,
        HOOKSHOT_CHAIN_HOOKS_COLLISION_RADIUS
      );
      const terrainHit = isPhysicsReady()
        ? raycastDirection(previousPosition.x, previousPosition.y, previousPosition.z, dirX, dirY, dirZ, moveDistance + 0.5, {
          priority: 'visual',
          feature: 'projectile:hookshotHook',
        })
        : null;
      const hit = aegisHit && (!terrainHit?.hit || aegisHit.distance <= terrainHit.distance)
        ? { hit: true, point: aegisHit.point, normal: aegisHit.normal }
        : terrainHit;
      const hitDistance = hit?.hit && 'distance' in hit ? hit.distance : Number.POSITIVE_INFINITY;
      const resolvedHit = authoritativeHit && (!hit?.hit || authoritativeHit.distance <= hitDistance)
        ? { hit: true, point: authoritativeHit.point, normal: authoritativeHit.normal }
        : hit;
      if (resolvedHit?.hit) {
        curPos.x = resolvedHit.point.x;
        curPos.y = resolvedHit.point.y;
        curPos.z = resolvedHit.point.z;
        triggerTerrainImpact('hookshot_hook', resolvedHit.point, {
          normal: resolvedHit.normal,
          direction: { x: dirX, y: dirY, z: dirZ },
        });
        hookStateRef.current = 'retracting';
      }
      
      // Enemy collision
      if (!hasHitRef.current) {
        const clock = getFrameClock();
        const combatCache = rebuildCombatVisualFrameCache(players.values(), clock.nowMs, clock.nowMs, players.size);
        const hitPlayer = findCombatVisualEnemyPlayerHit(
          combatCache,
          hook.ownerTeam,
          hook.ownerId,
          previousPosition,
          hookDirection,
          moveDistance,
          HOOKSHOT_CHAIN_HOOKS_COLLISION_RADIUS,
          {
            x: previousPosition.x + dirX * moveDistance * 0.5,
            z: previousPosition.z + dirZ * moveDistance * 0.5,
          },
          moveDistance * 0.5 + HOOKSHOT_CHAIN_HOOKS_COLLISION_RADIUS + 1.2
        );

        if (hitPlayer) {
          hasHitRef.current = true;
          hookStateRef.current = 'retracting';
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
        groupRef.current.visible = false;
        slot.hook = null;
        activeHookIdRef.current = null;
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
      muzzleRef.current.visible = !isLocalOwner;
      muzzleRef.current.scale.setScalar(pulse);
      if (hLen > 0.01) {
        muzzleRef.current.quaternion.copy(hookRef.current.quaternion);
      }
    }

  });
  
  return (
    <group ref={groupRef} visible={false}>
      {/* Glowing arrow head - uses shared materials */}
      <group ref={hookRef}>
        <HookshotProjectileArrowHead
          materials={{
            shaft: HOOK_MATERIALS.shaft,
            tip: HOOK_MATERIALS.tip,
            glow: HOOK_MATERIALS.glow,
            core: HOOK_MATERIALS.ropeCore,
            ring: HOOK_MATERIALS.ring,
          }}
          scale={1}
          lightPriority={2}
          lightIntensity={2.4}
          lightDistance={3.2}
        />
      </group>
      
      {/* Local launcher flash so the hook has a visible source instead of appearing from empty air */}
      <group ref={muzzleRef} visible={false}>
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
});
