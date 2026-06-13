/**
 * Hookshot Hero Abilities Hook
 * 
 * Handles Hookshot-specific abilities:
 * - Chain Hooks (primary fire)
 * - Drag Hook (secondary fire)
 * - Grapple (E ability)
 * - Anchor Wall (Q ability)
 * - Grapple Trap (Ultimate)
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { ABILITY_DEFINITIONS } from '@voxel-strike/shared';
import {
  createHookshotSwingState,
  stepHookshotSwing,
  type HookshotSwingState,
} from '@voxel-strike/physics';
import { useGameStore } from '../../../store/gameStore';
import { raycastDirection, checkGroundWithNormal, isPhysicsReady } from '../../usePhysics';
import {
  EYE_HEIGHT,
  HOOKSHOT_FIRE_INTERVAL,
  HOOKSHOT_SPEED,
  HOOKSHOT_MAX_DISTANCE,
  DRAG_HOOK_COOLDOWN,
  DRAG_HOOK_SPEED,
  DRAG_HOOK_MAX_DISTANCE,
  GRAPPLE_MAX_RANGE,
  GRAPPLE_TRAP_MAX_RANGE,
  GRAPPLE_TRAP_THROW_SPEED,
  GRAPPLE_TRAP_GRAVITY,
  HOOKSHOT_CHAIN_SOCKET,
  calculatePlayerSocketPosition,
  calculateLookDirection,
  calculateHorizontalLookDirection,
} from '../constants';
import { getLocalChronosTimebreakTempoMultiplier } from '../chronosTimebreakTempo';
import type { AbilityContext } from '../types';
import { writeAbilitySocketOrigin } from '../../../model-system/abilitySocketResolver';
import { markPredictedLocalAbilityVisual } from '../useLocalAbilityVisualPrediction';

export interface UseHookshotAbilitiesReturn {
  // State refs
  hookProjectileIdRef: React.MutableRefObject<number>;
  dragHookIdRef: React.MutableRefObject<number>;
  grappleTrapIdRef: React.MutableRefObject<number>;
  grappleLineIdRef: React.MutableRefObject<number>;
  earthWallIdRef: React.MutableRefObject<number>;
  lastHookTimeRef: React.MutableRefObject<number>;
  lastDragHookTimeRef: React.MutableRefObject<number>;
  secondaryFirePressedRef: React.MutableRefObject<boolean>;

  // Grapple state
  isGrapplingRef: React.MutableRefObject<boolean>;
  grappleTargetRef: React.MutableRefObject<{ x: number; y: number; z: number } | null>;
  activeGrappleLineIdRef: React.MutableRefObject<string | null>;

  // Grapple swing state
  isSwingingRef: React.MutableRefObject<boolean>;

  // Grapple trap targeting
  grappleTrapTargetRef: React.MutableRefObject<THREE.Vector3 | null>;
  grappleTrapValidRef: React.MutableRefObject<boolean>;

  // Methods
  fireChainHook: (ctx: AbilityContext) => boolean;
  fireDragHook: (ctx: AbilityContext) => boolean;
  canGrapple: (ctx: AbilityContext) => boolean;
  executeGrapple: (ctx: AbilityContext) => boolean;
  executeEarthWall: (ctx: AbilityContext) => boolean;
  executeGrappleTrap: (ctx: AbilityContext, updateLocalPlayer: (data: any) => void) => boolean;
  updateGrapplePhysics: (ctx: AbilityContext) => void;
  handleSwingTerrainContact: () => void;
  handleGrappleTrapTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

function readHookshotHookSocketPosition(
  abilityId: string,
  launchSide: -1 | 1
): { x: number; y: number; z: number } | null {
  const origin = { x: 0, y: 0, z: 0 };
  return writeAbilitySocketOrigin(origin, {
    ownerScope: 'localViewmodel',
    abilityId,
    side: launchSide,
  }) ? origin : null;
}

function calculateHookshotLaunch(
  ctx: AbilityContext,
  launchSide: -1 | 1,
  maxDistance: number,
  spawnOverride?: { x: number; y: number; z: number } | null
) {
  const lookDirection = calculateLookDirection(ctx.yaw, ctx.pitch);
  const fallbackSpawnPos = calculatePlayerSocketPosition(ctx.position, ctx.yaw, {
    ...HOOKSHOT_CHAIN_SOCKET,
    sideOffset: HOOKSHOT_CHAIN_SOCKET.sideOffset * launchSide,
  });
  const spawnPos = spawnOverride ?? fallbackSpawnPos;
  const aimOrigin = {
    x: ctx.position.x,
    y: ctx.position.y + EYE_HEIGHT,
    z: ctx.position.z,
  };
  const aimPoint = {
    x: aimOrigin.x + lookDirection.x * maxDistance,
    y: aimOrigin.y + lookDirection.y * maxDistance,
    z: aimOrigin.z + lookDirection.z * maxDistance,
  };

  if (isPhysicsReady()) {
    const hit = raycastDirection(
      aimOrigin.x, aimOrigin.y, aimOrigin.z,
      lookDirection.x, lookDirection.y, lookDirection.z,
      maxDistance
    );

    if (hit?.hit) {
      aimPoint.x = hit.point.x;
      aimPoint.y = hit.point.y;
      aimPoint.z = hit.point.z;
    }
  }

  const aimDelta = {
    x: aimPoint.x - spawnPos.x,
    y: aimPoint.y - spawnPos.y,
    z: aimPoint.z - spawnPos.z,
  };
  const aimLength = Math.sqrt(aimDelta.x ** 2 + aimDelta.y ** 2 + aimDelta.z ** 2) || 1;

  return {
    spawnPos,
    direction: {
      x: aimDelta.x / aimLength,
      y: aimDelta.y / aimLength,
      z: aimDelta.z / aimLength,
    },
  };
}

function resolveHookshotGrapplePoint(ctx: AbilityContext): { x: number; y: number; z: number } | null {
  const direction = calculateLookDirection(ctx.yaw, ctx.pitch);

  if (!isPhysicsReady()) return null;

  const aimOrigin = {
    x: ctx.position.x,
    y: ctx.position.y + EYE_HEIGHT,
    z: ctx.position.z,
  };

  let hit = raycastDirection(
    aimOrigin.x, aimOrigin.y, aimOrigin.z,
    direction.x, direction.y, direction.z,
    GRAPPLE_MAX_RANGE
  );

  if (hit?.hit) {
    return hit.point;
  }

  hit = raycastDirection(
    aimOrigin.x, aimOrigin.y, aimOrigin.z,
    direction.x, Math.min(direction.y, -0.1), direction.z,
    GRAPPLE_MAX_RANGE
  );

  return hit?.hit ? hit.point : null;
}

export function useHookshotAbilities(): UseHookshotAbilitiesReturn {
  // ID counters
  const hookProjectileIdRef = useRef(0);
  const dragHookIdRef = useRef(0);
  const grappleTrapIdRef = useRef(0);
  const grappleLineIdRef = useRef(0);
  const earthWallIdRef = useRef(0);

  // Timing
  const lastHookTimeRef = useRef(0);
  const lastDragHookTimeRef = useRef(0);
  const secondaryFirePressedRef = useRef(false);

  // Grapple state
  const isGrapplingRef = useRef(false);
  const grappleTargetRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const activeGrappleLineIdRef = useRef<string | null>(null);
  const activeGrappleStartTimeRef = useRef(0);

  // Grapple swing state
  const isSwingingRef = useRef(false);
  const swingWasAirborneRef = useRef(false);
  const grappleSwingStateRef = useRef<HookshotSwingState | null>(null);

  // Grapple trap targeting
  const grappleTrapTargetRef = useRef<THREE.Vector3 | null>(null);
  const grappleTrapValidRef = useRef(false);

  // Fire Chain Hook (primary fire)
  const fireChainHook = useCallback((ctx: AbilityContext) => {
    const now = Date.now();
    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    if (now - lastHookTimeRef.current < HOOKSHOT_FIRE_INTERVAL / tempoMultiplier) return false;

    lastHookTimeRef.current = now;
    hookProjectileIdRef.current++;
    const launchSide = hookProjectileIdRef.current % 2 === 1 ? 1 : -1;
    const socketSpawnPos = readHookshotHookSocketPosition('hookshot_basic_attack', launchSide);
    const { spawnPos, direction } = calculateHookshotLaunch(
      ctx,
      launchSide,
      HOOKSHOT_MAX_DISTANCE,
      socketSpawnPos
    );
    const hookId = `hook_${ctx.localPlayer.id}_${hookProjectileIdRef.current}`;

    useGameStore.getState().addHookProjectile({
      id: hookId,
      position: spawnPos,
      velocity: {
        x: direction.x * HOOKSHOT_SPEED,
        y: direction.y * HOOKSHOT_SPEED,
        z: direction.z * HOOKSHOT_SPEED,
      },
      startTime: now,
      ownerId: ctx.localPlayer.id,
      ownerTeam: (ctx.localPlayer.team || 'red') as 'red' | 'blue',
      state: 'extending',
      maxDistance: HOOKSHOT_MAX_DISTANCE,
      startPosition: spawnPos,
      launchSide,
      launchYaw: ctx.yaw,
    });
    markPredictedLocalAbilityVisual('hookshot_basic_attack', ctx.localPlayer.id, hookId, {
      launchSide,
      now,
    });
    return true;
  }, []);

  // Fire Drag Hook (secondary fire)
  const fireDragHook = useCallback((ctx: AbilityContext) => {
    const now = Date.now();
    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    if (now - lastDragHookTimeRef.current < DRAG_HOOK_COOLDOWN / tempoMultiplier) return false;

    lastDragHookTimeRef.current = now;
    dragHookIdRef.current++;
    const launchSide = 1;
    const socketSpawnPos = readHookshotHookSocketPosition('hookshot_heavy_attack', launchSide);
    const { spawnPos, direction } = calculateHookshotLaunch(
      ctx,
      launchSide,
      DRAG_HOOK_MAX_DISTANCE,
      socketSpawnPos
    );
    const hookId = `draghook_${ctx.localPlayer.id}_${dragHookIdRef.current}`;

    useGameStore.getState().addDragHook({
      id: hookId,
      position: spawnPos,
      velocity: {
        x: direction.x * DRAG_HOOK_SPEED,
        y: direction.y * DRAG_HOOK_SPEED,
        z: direction.z * DRAG_HOOK_SPEED,
      },
      startTime: now,
      ownerId: ctx.localPlayer.id,
      ownerTeam: (ctx.localPlayer.team || 'red') as 'red' | 'blue',
      state: 'flying',
      startPosition: spawnPos,
      launchSide,
      launchYaw: ctx.yaw,
    });
    markPredictedLocalAbilityVisual('hookshot_heavy_attack', ctx.localPlayer.id, hookId, {
      launchSide,
      now,
    });
    return true;
  }, []);

  const canGrapple = useCallback((ctx: AbilityContext) => {
    return resolveHookshotGrapplePoint(ctx) !== null;
  }, []);

  // Execute Grapple (E ability)
  const executeGrapple = useCallback((ctx: AbilityContext) => {
    const grapplePoint = resolveHookshotGrapplePoint(ctx);
    if (!grapplePoint) return false;

    // Create grapple line visual
    grappleLineIdRef.current++;
    const lineId = `grapple_${ctx.localPlayer.id}_${grappleLineIdRef.current}`;
    const launchSide = 1;
    const startPos = readHookshotHookSocketPosition('hookshot_grapple', launchSide) ?? calculatePlayerSocketPosition(ctx.position, ctx.yaw, {
      ...HOOKSHOT_CHAIN_SOCKET,
      sideOffset: HOOKSHOT_CHAIN_SOCKET.sideOffset * launchSide,
    });

    const startTime = Date.now();
    useGameStore.getState().addGrappleLine({
      id: lineId,
      startPosition: startPos,
      endPosition: grapplePoint,
      startTime,
      ownerId: ctx.localPlayer.id,
      state: 'extending',
      launchSide,
      launchYaw: ctx.yaw,
    });
    markPredictedLocalAbilityVisual('hookshot_grapple', ctx.localPlayer.id, lineId, {
      launchSide,
      now: startTime,
    });

    // Store target - pulling will start when hook reaches target
    grappleTargetRef.current = grapplePoint;
    activeGrappleLineIdRef.current = lineId;
    activeGrappleStartTimeRef.current = startTime;
    isGrapplingRef.current = false;
    swingWasAirborneRef.current = false;
    return true;
  }, []);

  // Execute Anchor Wall (Q ability)
  const executeEarthWall = useCallback((ctx: AbilityContext) => {
    const horizDir = calculateHorizontalLookDirection(ctx.yaw);
    const dirLen = Math.sqrt(horizDir.x * horizDir.x + horizDir.z * horizDir.z);
    const normDirX = dirLen > 0 ? horizDir.x / dirLen : 0;
    const normDirZ = dirLen > 0 ? horizDir.z / dirLen : 1;

    // Find ground level
    let groundY = ctx.position.y;
    if (isPhysicsReady()) {
      const groundCheck = checkGroundWithNormal(ctx.position.x, ctx.position.y + 2, ctx.position.z, 10);
      if (groundCheck) {
        groundY = groundCheck.groundY;
      }
    }

    earthWallIdRef.current++;
    const wallId = `earthwall_${ctx.localPlayer.id}_${earthWallIdRef.current}`;

    useGameStore.getState().addEarthWall({
      id: wallId,
      startPosition: { x: ctx.position.x, y: groundY, z: ctx.position.z },
      direction: { x: normDirX, y: 0, z: normDirZ },
      startTime: Date.now(),
      duration: 6.25,
      ownerId: ctx.localPlayer.id,
      ownerTeam: (ctx.localPlayer.team || 'red') as 'red' | 'blue',
      maxDistance: 24.35,
      hookProgress: 0,
      wallSegments: [],
    });
    markPredictedLocalAbilityVisual('hookshot_anchor_wall', ctx.localPlayer.id, wallId);
    return true;
  }, []);

  // Execute Grapple Trap (Ultimate)
  const executeGrappleTrap = useCallback((
    ctx: AbilityContext,
    updateLocalPlayer: (data: any) => void
  ) => {
    const now = Date.now();
    const direction = calculateLookDirection(ctx.yaw, ctx.pitch);

    const launchSide = 1;
    const startPos = readHookshotHookSocketPosition('hookshot_grapple_trap', launchSide) ?? calculatePlayerSocketPosition(ctx.position, ctx.yaw, {
      ...HOOKSHOT_CHAIN_SOCKET,
      sideOffset: HOOKSHOT_CHAIN_SOCKET.sideOffset * launchSide,
    });

    const cachedTarget = grappleTrapValidRef.current ? grappleTrapTargetRef.current : null;
    let targetX = cachedTarget?.x ?? startPos.x + direction.x * GRAPPLE_TRAP_MAX_RANGE;
    let targetY = cachedTarget?.y ?? startPos.y + direction.y * GRAPPLE_TRAP_MAX_RANGE;
    let targetZ = cachedTarget?.z ?? startPos.z + direction.z * GRAPPLE_TRAP_MAX_RANGE;

    if (!cachedTarget && isPhysicsReady()) {
      const directHit = raycastDirection(
        ctx.position.x + 0.6, ctx.position.y, ctx.position.z,
        direction.x, direction.y, direction.z,
        GRAPPLE_TRAP_MAX_RANGE + 10
      );

      if (directHit?.hit) {
        targetX = directHit.point.x;
        targetY = directHit.point.y;
        targetZ = directHit.point.z;

        if (!directHit.isWalkable) {
          const groundBelow = checkGroundWithNormal(targetX, targetY + 5, targetZ, 50);
          if (groundBelow?.isWalkable) {
            targetY = groundBelow.groundY + 0.1;
          }
        } else {
          targetY += 0.1;
        }
      } else {
        // Sample along direction
        const sampleDistances = [15, 20, 25, GRAPPLE_TRAP_MAX_RANGE];
        for (const dist of sampleDistances) {
          const sampleX = ctx.position.x + direction.x * dist;
          const sampleY = ctx.position.y + direction.y * dist;
          const sampleZ = ctx.position.z + direction.z * dist;

          const groundCheck = checkGroundWithNormal(
            sampleX,
            Math.max(sampleY + 50, ctx.position.y + 50),
            sampleZ,
            150
          );
          if (groundCheck?.isWalkable) {
            targetX = sampleX;
            targetY = groundCheck.groundY + 0.1;
            targetZ = sampleZ;
            break;
          }
        }
      }
    }

    // Calculate throw velocity
    const dx = targetX - startPos.x;
    const dy = targetY - startPos.y;
    const dz = targetZ - startPos.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    const timeOfFlight = Math.max(0.5, horizontalDist / 20);

    const horizMag = Math.sqrt(dx * dx + dz * dz);
    const horizVelX = horizMag > 0 ? (dx / horizMag) * (horizontalDist / timeOfFlight) : 0;
    const horizVelZ = horizMag > 0 ? (dz / horizMag) * (horizontalDist / timeOfFlight) : 0;
    const vertVel = (dy + 0.5 * GRAPPLE_TRAP_GRAVITY * timeOfFlight * timeOfFlight) / timeOfFlight;

    const throwVelocity = {
      x: Math.max(-GRAPPLE_TRAP_THROW_SPEED, Math.min(GRAPPLE_TRAP_THROW_SPEED, horizVelX)),
      y: Math.max(5, Math.min(GRAPPLE_TRAP_THROW_SPEED * 1.2, vertVel)),
      z: Math.max(-GRAPPLE_TRAP_THROW_SPEED, Math.min(GRAPPLE_TRAP_THROW_SPEED, horizVelZ)),
    };

    // Create trap
    grappleTrapIdRef.current++;
    const trapId = `grapple_trap_${ctx.localPlayer.id}_${grappleTrapIdRef.current}`;

    useGameStore.getState().addGrappleTrap({
      id: trapId,
      position: { x: targetX, y: targetY, z: targetZ },
      startPosition: startPos,
      velocity: throwVelocity,
      startTime: now,
      duration: 8,
      ownerId: ctx.localPlayer.id,
      ownerTeam: (ctx.localPlayer.team || 'red') as 'red' | 'blue',
      radius: 8,
      hookedPlayers: [],
    });
    markPredictedLocalAbilityVisual('hookshot_grapple_trap', ctx.localPlayer.id, trapId, {
      launchSide,
      now,
    });

    updateLocalPlayer({ ultimateCharge: 0 });
    return true;
  }, []);

  const handleSwingTerrainContact = useCallback(() => {
    if (!swingWasAirborneRef.current || (!isGrapplingRef.current && !isSwingingRef.current)) return;

    const store = useGameStore.getState();
    if (activeGrappleLineIdRef.current) {
      store.removeGrappleLine(activeGrappleLineIdRef.current);
    }

    isGrapplingRef.current = false;
    isSwingingRef.current = false;
    grappleTargetRef.current = null;
    activeGrappleLineIdRef.current = null;
    activeGrappleStartTimeRef.current = 0;
    swingWasAirborneRef.current = false;
    grappleSwingStateRef.current = null;
  }, []);

  // Update grapple physics
  const updateGrapplePhysics = useCallback((ctx: AbilityContext) => {
    const releaseGrappleSwing = () => {
      if (activeGrappleLineIdRef.current) {
        useGameStore.getState().removeGrappleLine(activeGrappleLineIdRef.current);
      }

      isGrapplingRef.current = false;
      isSwingingRef.current = false;
      grappleTargetRef.current = null;
      activeGrappleLineIdRef.current = null;
      activeGrappleStartTimeRef.current = 0;
      swingWasAirborneRef.current = false;
      grappleSwingStateRef.current = null;
    };

    const store = useGameStore.getState();
    if (!activeGrappleLineIdRef.current) {
      for (let index = store.grappleLines.length - 1; index >= 0; index--) {
        const line = store.grappleLines[index];
        if (line.ownerId !== ctx.localPlayer.id) continue;
        if (line.state === 'done' || line.state === 'retracting') continue;

        activeGrappleLineIdRef.current = line.id;
        activeGrappleStartTimeRef.current = line.startTime;
        grappleTargetRef.current = line.endPosition;
        isGrapplingRef.current = false;
        swingWasAirborneRef.current = false;
        break;
      }
    }

    const lineId = activeGrappleLineIdRef.current;
    const target = grappleTargetRef.current;
    if (!lineId || !target) {
      if (isGrapplingRef.current) {
        releaseGrappleSwing();
      }
      return;
    }

    if (!isGrapplingRef.current) {
      const activeLine = store.grappleLines.find(l => l.id === lineId);
      if (!activeLine) {
        releaseGrappleSwing();
        return;
      }
      if (activeLine.state !== 'attached' && activeLine.state !== 'pulling') return;

      isGrapplingRef.current = true;
      isSwingingRef.current = true;
      activeGrappleStartTimeRef.current = activeLine.startTime;
      grappleSwingStateRef.current = createHookshotSwingState(
        { x: ctx.position.x, y: ctx.position.y, z: ctx.position.z },
        target,
        ctx.isGrounded
      );
      swingWasAirborneRef.current = grappleSwingStateRef.current.wasAirborne;
      store.updateGrappleLine(lineId, { state: 'pulling' });
    }

    if (!grappleSwingStateRef.current) return;

    const result = stepHookshotSwing({
      position: { x: ctx.position.x, y: ctx.position.y, z: ctx.position.z },
      velocity: { x: ctx.velocity.x, y: ctx.velocity.y, z: ctx.velocity.z },
      swing: grappleSwingStateRef.current,
      input: ctx.inputState,
      lookYaw: ctx.yaw,
      lookPitch: ctx.pitch,
      isGrounded: ctx.isGrounded,
      deltaTime: ctx.dt,
    });

    ctx.position.x = result.position.x;
    ctx.position.y = result.position.y;
    ctx.position.z = result.position.z;
    ctx.velocity.x = result.velocity.x;
    ctx.velocity.y = result.velocity.y;
    ctx.velocity.z = result.velocity.z;

    grappleSwingStateRef.current = result.swing;
    if (result.swing) {
      swingWasAirborneRef.current = result.swing.wasAirborne;
    } else {
      releaseGrappleSwing();
    }
  }, []);

  // Handle grapple trap target updates
  const handleGrappleTrapTargetUpdate = useCallback((position: THREE.Vector3 | null, isValid: boolean) => {
    grappleTrapTargetRef.current = position;
    grappleTrapValidRef.current = isValid;

    const store = useGameStore.getState();
    if (store.grappleTrapTargeting && store.grappleTrapTargetValid !== isValid) {
      store.setGrappleTrapTargeting(true, isValid);
    }
  }, []);

  return {
    hookProjectileIdRef,
    dragHookIdRef,
    grappleTrapIdRef,
    grappleLineIdRef,
    earthWallIdRef,
    lastHookTimeRef,
    lastDragHookTimeRef,
    secondaryFirePressedRef,
    isGrapplingRef,
    grappleTargetRef,
    activeGrappleLineIdRef,
    isSwingingRef,
    grappleTrapTargetRef,
    grappleTrapValidRef,
    fireChainHook,
    fireDragHook,
    canGrapple,
    executeGrapple,
    executeEarthWall,
    executeGrappleTrap,
    updateGrapplePhysics,
    handleSwingTerrainContact,
    handleGrappleTrapTargetUpdate,
  };
}
