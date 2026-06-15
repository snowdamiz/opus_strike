import React, { useRef } from 'react';
import * as THREE from 'three';
import { useGameStore, type DragHookData } from '../../../store/gameStore';
import { findCombatVisualEnemyPlayerHit, rebuildCombatVisualFrameCache } from '../../../store/visualStore';
import { isPhysicsReady, raycastDirection } from '../../../hooks/usePhysics';
import { DRAG_HOOK_MAX_DISTANCE, HOOKSHOT_CHAIN_SOCKET } from '../../../hooks/player/constants';
import { writeOwnerVisualPosition } from './ownerPosition';
import { triggerTerrainImpact } from '../TerrainImpactEffects';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { getFirstChronosAegisVisualHit } from '../chronos/aegisCollision';
import { getAuthoritativeProjectileImpactHit } from '../projectileImpact';
import { 
  SHARED_GEOMETRIES, 
  HOOKSHOT_COLORS, 
  getHookshotMaterials,
  TEMP_VECTORS,
} from '../effectResources';
import { writeAbilitySocketOrigin } from '../../../model-system/abilitySocketResolver';
import { getFrameClock } from '../../../utils/frameClock';
import {
  HEAVY_HOOK_MAIN_ROPE_MATERIAL,
  PLIABLE_ROPE_SEGMENT_COUNT,
  ROPE_SEGMENT_INDICES,
  createRopePoints,
  updatePliableRopePoints,
  updateRopeSegment,
} from './rope';
import { HookshotProjectileArrowHead } from './arrowHead';
import { useHookshotFrameUpdater } from './hookshotFrameRegistry';

// ============================================================================
// DRAG HOOK - Long range hook that pulls enemies (heavy attack / right click)
// SAME MECHANICS AS LEFT CLICK: Extends out, retracts back to player
// If it hits an enemy, it pulls them back with it
// OVER-THE-TOP STYLING: Bigger hook, thicker glowing chains
// ============================================================================

const DRAG_HOOK_RETRACT_SPEED = 55;
const DRAG_HOOK_COLLISION_RADIUS = 0.28;

// Get shared materials from centralized resources
const getHookMaterials = () => getHookshotMaterials();
const DRAG_HOOK_OUTER_GLOW_MATERIAL = new THREE.MeshBasicMaterial({
  color: HOOKSHOT_COLORS.energyGlow,
  transparent: true,
  opacity: 0.2,
});

function writeLocalDragHookSocketPosition(out: { x: number; y: number; z: number }, launchSide: -1 | 1): boolean {
  return writeAbilitySocketOrigin(out, {
    ownerScope: 'localViewmodel',
    abilityId: 'hookshot_heavy_attack',
    side: launchSide,
  });
}

export interface DragHookSlotHandle {
  slotIndex: number;
  hook: DragHookData | null;
}

export function createDragHookSlotHandle(slotIndex: number): DragHookSlotHandle {
  return {
    slotIndex,
    hook: null,
  };
}

interface DragHookProps {
  slot: DragHookSlotHandle;
}

export const DragHookEffect = React.memo(({ slot }: DragHookProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const hookRef = useRef<THREE.Group>(null);
  const muzzleRef = useRef<THREE.Group>(null);
  
  // Multi-layer rope refs for over-the-top chain effect
  const chainMainRefs = useRef<(THREE.Mesh | null)[]>([]);
  const chainOuterRefs = useRef<(THREE.Mesh | null)[]>([]);
  const chainCoreRefs = useRef<(THREE.Mesh | null)[]>([]);
  const chainMegaGlowRefs = useRef<(THREE.Mesh | null)[]>([]);
  
  const glowRef = useRef<THREE.Mesh>(null);
  
  // Get shared materials
  const HOOK_MATERIALS = getHookMaterials();
  
  // All state tracked via refs - SAME PATTERN AS LEFT CLICK
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
  const hasHitRef = useRef(false);
  const hookedTargetIdRef = useRef<string | null>(null);
  
  const removeDragHook = useGameStore(state => state.removeDragHook);
  
  useHookshotFrameUpdater(`drag-hook-slot:${slot.slotIndex}`, (state, delta) => {
    const hook = slot.hook;
    if (!hookRef.current || !groupRef.current || !hook) {
      if (groupRef.current) groupRef.current.visible = false;
      activeHookIdRef.current = null;
      return;
    }

    if (activeHookIdRef.current !== hook.id) {
      activeHookIdRef.current = hook.id;
      hookStateRef.current = hook.state === 'flying' ? 'extending' : 'retracting';
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
      hasHitRef.current = false;
      hookedTargetIdRef.current = null;
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
      abilityId: 'hookshot_heavy_attack',
      side: launchSide,
    };
    
    const time = state.clock.elapsedTime;
    const storeState = useGameStore.getState();
    const { players, localPlayer } = storeState;
    
    const isLocalOwner = localPlayer?.id === hook.ownerId;
    const targetPosition = isLocalOwner && writeLocalDragHookSocketPosition(ownerVisualPositionRef.current, launchSide)
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
      // Move forward - SAME AS LEFT CLICK
      const moveDistance = speed * delta;
      const previousPosition = previousPosRef.current;
      previousPosition.x = curPos.x;
      previousPosition.y = curPos.y;
      previousPosition.z = curPos.z;
      curPos.x += velX * delta;
      curPos.y += velY * delta;
      curPos.z += velZ * delta;
      
      // Check max distance - if reached, start retracting
      const dx = curPos.x - hook.startPosition.x;
      const dy = curPos.y - hook.startPosition.y;
      const dz = curPos.z - hook.startPosition.z;
      if (dx * dx + dy * dy + dz * dz >= DRAG_HOOK_MAX_DISTANCE * DRAG_HOOK_MAX_DISTANCE) {
        hookStateRef.current = 'retracting';
      }
      
      // Skill/terrain collision - if hit, start retracting
      const authoritativeHit = hook.interceptedByChronosAegis
        ? getAuthoritativeProjectileImpactHit(
          previousPosition,
          hookDirection,
          hook.impactPosition,
          moveDistance + DRAG_HOOK_COLLISION_RADIUS,
          DRAG_HOOK_COLLISION_RADIUS
        )
        : null;
      const aegisHit = getFirstChronosAegisVisualHit(
        previousPosition,
        hookDirection,
        moveDistance + DRAG_HOOK_COLLISION_RADIUS,
        hook.ownerTeam,
        hook.ownerId,
        DRAG_HOOK_COLLISION_RADIUS
      );
      const terrainHit = isPhysicsReady()
        ? raycastDirection(previousPosition.x, previousPosition.y, previousPosition.z, dirX, dirY, dirZ, moveDistance + 0.5, {
          priority: 'visual',
          feature: 'projectile:hookshotDrag',
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
        triggerTerrainImpact('hookshot_drag_hook', resolvedHit.point, {
          normal: resolvedHit.normal,
          direction: { x: dirX, y: dirY, z: dirZ },
        });
        hookStateRef.current = 'retracting';
      }
      
      // Enemy collision - if hit, start retracting AND pull enemy
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
          DRAG_HOOK_COLLISION_RADIUS,
          {
            x: previousPosition.x + dirX * moveDistance * 0.5,
            z: previousPosition.z + dirZ * moveDistance * 0.5,
          },
          moveDistance * 0.5 + DRAG_HOOK_COLLISION_RADIUS + 1.5
        );

        if (hitPlayer) {
          hasHitRef.current = true;
          hookedTargetIdRef.current = hitPlayer.id;
          hookStateRef.current = 'retracting';
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
        groupRef.current.visible = false;
        slot.hook = null;
        activeHookIdRef.current = null;
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
    const maxLag = 1.35;
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
      0.36
    );
    
    for (let i = 0; i < PLIABLE_ROPE_SEGMENT_COUNT; i++) {
      updateRopeSegment(chainMegaGlowRefs.current[i], ropePoints[i], ropePoints[i + 1], 0.1);
      updateRopeSegment(chainOuterRefs.current[i], ropePoints[i], ropePoints[i + 1], 0.07);
      updateRopeSegment(chainMainRefs.current[i], ropePoints[i], ropePoints[i + 1], 0.032);
      updateRopeSegment(chainCoreRefs.current[i], ropePoints[i], ropePoints[i + 1], 0.018);
    }

    if (muzzleRef.current) {
      const pulse = 1 + Math.sin(time * 28) * 0.08;
      muzzleRef.current.position.copy(ropePoints[0]);
      muzzleRef.current.visible = !isLocalOwner;
      muzzleRef.current.scale.setScalar(pulse);
      if (hLen > 0.01) {
        muzzleRef.current.quaternion.copy(hookRef.current.quaternion);
      }
    }
    
    // Animate hook glow effects
    if (glowRef.current) {
      const pulse = 0.9 + Math.sin(time * 12) * 0.3;
      glowRef.current.scale.setScalar(pulse * 0.4);
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(time * 10) * 0.2;
    }
  });
  
  return (
    <group ref={groupRef} visible={false}>
      {/* === HEAVY GLOWING ARROW - Bigger version of left click head === */}
      <group ref={hookRef}>
        <HookshotProjectileArrowHead
          materials={{
            shaft: HOOK_MATERIALS.shaft,
            tip: HOOK_MATERIALS.tip,
            glow: HOOK_MATERIALS.glow,
            core: HOOK_MATERIALS.heavyChainCore,
            ring: HOOK_MATERIALS.ring,
          }}
          scale={1.22}
          lightPriority={3}
          lightIntensity={4.5}
          lightDistance={5.8}
        />
        <mesh ref={glowRef} geometry={SHARED_GEOMETRIES.sphere8} scale={0.35} material={HOOK_MATERIALS.glow} />
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={0.5} material={DRAG_HOOK_OUTER_GLOW_MATERIAL} />
        <BudgetedPointLight budgetPriority={2} color={0xffffff} intensity={2} distance={3} decay={2} position={[0, 0, -0.3]} />
      </group>
      
      {/* === HEAVY CHAIN - Multi-layer, thicker than left click === */}
      <group ref={muzzleRef} visible={false}>
        <mesh rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.2, 0.2, 0.05]} material={HOOK_MATERIALS.ring} />
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={0.16} material={HOOK_MATERIALS.glow} />
        <BudgetedPointLight budgetPriority={2} color={HOOKSHOT_COLORS.energy} intensity={1.5} distance={3} decay={2} />
      </group>

      {ROPE_SEGMENT_INDICES.map(i => (
        <mesh key={`drag-mega-${i}`} ref={el => chainMegaGlowRefs.current[i] = el} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MATERIALS.heavyChainMegaGlow} />
      ))}
      {ROPE_SEGMENT_INDICES.map(i => (
        <mesh key={`drag-outer-${i}`} ref={el => chainOuterRefs.current[i] = el} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MATERIALS.heavyChainOuter} />
      ))}
      {ROPE_SEGMENT_INDICES.map(i => (
        <mesh key={`drag-main-${i}`} ref={el => chainMainRefs.current[i] = el} geometry={SHARED_GEOMETRIES.cylinder8} material={HEAVY_HOOK_MAIN_ROPE_MATERIAL} />
      ))}
      {ROPE_SEGMENT_INDICES.map(i => (
        <mesh key={`drag-core-${i}`} ref={el => chainCoreRefs.current[i] = el} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MATERIALS.heavyChainCore} />
      ))}
    </group>
  );
});
