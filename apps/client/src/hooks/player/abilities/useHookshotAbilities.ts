/**
 * Hookshot Hero Abilities Hook
 * 
 * Handles Hookshot-specific abilities:
 * - Chain Hooks (primary fire)
 * - Drag Hook (secondary fire)
 * - Grapple (E ability)
 * - Anchor Wall (Q ability)
 * - Ground Hooks (Ultimate)
 */

import { useRef, useCallback } from 'react';
import {
  HOOKSHOT_GROUND_HOOKS_RADIUS,
  HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS,
  type Team,
} from '@voxel-strike/shared';
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
  groundHooksIdRef: React.MutableRefObject<number>;
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

  // Methods
  fireChainHook: (ctx: AbilityContext) => boolean;
  fireDragHook: (ctx: AbilityContext) => boolean;
  canGrapple: (ctx: AbilityContext) => boolean;
  executeGrapple: (ctx: AbilityContext) => boolean;
  executeEarthWall: (ctx: AbilityContext) => boolean;
  executeGroundHooks: (ctx: AbilityContext, updateLocalPlayer: (data: any) => void) => boolean;
  updateGrapplePhysics: (ctx: AbilityContext) => void;
  handleSwingTerrainContact: () => void;
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

function resolveGroundHookTargets(ctx: AbilityContext, rootUntil: number) {
  const ownerTeam: Team = ctx.localPlayer.team || 'red';
  const radiusSq = HOOKSHOT_GROUND_HOOKS_RADIUS * HOOKSHOT_GROUND_HOOKS_RADIUS;
  const targets: Array<{
    targetId: string;
    position: { x: number; y: number; z: number };
    rootUntil: number;
  }> = [];

  useGameStore.getState().players.forEach((player) => {
    if (player.id === ctx.localPlayer.id) return;
    if (player.state !== 'alive') return;
    if (player.team === ownerTeam) return;

    const dx = player.position.x - ctx.position.x;
    const dz = player.position.z - ctx.position.z;
    if (dx * dx + dz * dz > radiusSq) return;

    targets.push({
      targetId: player.id,
      position: {
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
      },
      rootUntil,
    });
  });

  return targets;
}

export function useHookshotAbilities(): UseHookshotAbilitiesReturn {
  // ID counters
  const hookProjectileIdRef = useRef(0);
  const dragHookIdRef = useRef(0);
  const groundHooksIdRef = useRef(0);
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
      ownerTeam: ctx.localPlayer.team || 'red',
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
      ownerTeam: ctx.localPlayer.team || 'red',
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
      ownerTeam: ctx.localPlayer.team || 'red',
      maxDistance: 24.35,
      hookProgress: 0,
    });
    markPredictedLocalAbilityVisual('hookshot_anchor_wall', ctx.localPlayer.id, wallId);
    return true;
  }, []);

  // Execute Ground Hooks (Ultimate)
  const executeGroundHooks = useCallback((
    ctx: AbilityContext,
    updateLocalPlayer: (data: any) => void
  ) => {
    const now = Date.now();
    const rootUntil = now + HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS * 1000;
    const targets = resolveGroundHookTargets(ctx, rootUntil);
    groundHooksIdRef.current++;
    const effectId = `ground_hooks_${ctx.localPlayer.id}_${groundHooksIdRef.current}`;
    const store = useGameStore.getState();

    store.addHookshotGroundHooks({
      id: effectId,
      position: { x: ctx.position.x, y: ctx.position.y, z: ctx.position.z },
      startTime: now,
      duration: HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS,
      ownerId: ctx.localPlayer.id,
      ownerTeam: ctx.localPlayer.team || 'red',
      radius: HOOKSHOT_GROUND_HOOKS_RADIUS,
      rootUntil,
      targets,
    });
    markPredictedLocalAbilityVisual('hookshot_ground_hooks', ctx.localPlayer.id, effectId, { now });

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

  return {
    hookProjectileIdRef,
    dragHookIdRef,
    groundHooksIdRef,
    grappleLineIdRef,
    earthWallIdRef,
    lastHookTimeRef,
    lastDragHookTimeRef,
    secondaryFirePressedRef,
    isGrapplingRef,
    grappleTargetRef,
    activeGrappleLineIdRef,
    isSwingingRef,
    fireChainHook,
    fireDragHook,
    canGrapple,
    executeGrapple,
    executeEarthWall,
    executeGroundHooks,
    updateGrapplePhysics,
    handleSwingTerrainContact,
  };
}
