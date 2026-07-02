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
import type { GrappleLineData } from '../../../store/types';
import {
  checkGroundWithNormal,
  createRaycastDirectionHitResult,
  isPhysicsReady,
  raycastDirectionInto,
  type RaycastDirectionHitResult,
} from '../../usePhysics';
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

type MutableVec3 = { x: number; y: number; z: number };

export function selectCurrentGrappleLine(
  grappleLines: readonly GrappleLineData[],
  activeLineId: string | null,
  ownerId: string
): GrappleLineData | null {
  if (activeLineId) {
    return grappleLines.find((line) => line.id === activeLineId) ?? null;
  }

  for (let index = grappleLines.length - 1; index >= 0; index--) {
    const line = grappleLines[index];
    if (line.ownerId !== ownerId) continue;
    if (line.state === 'done' || line.state === 'retracting') continue;
    return line;
  }

  return null;
}

function writeLookDirection(out: MutableVec3, yaw: number, pitch: number): MutableVec3 {
  const cosPitch = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cosPitch;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cosPitch;
  return out;
}

function writeNormalizedDeltaFromCoords(
  out: MutableVec3,
  fromX: number,
  fromY: number,
  fromZ: number,
  to: { x: number; y: number; z: number }
): number {
  const x = to.x - fromX;
  const y = to.y - fromY;
  const z = to.z - fromZ;
  const length = Math.sqrt(x * x + y * y + z * z);
  if (length <= 0.0001) return 0;
  out.x = x / length;
  out.y = y / length;
  out.z = z / length;
  return length;
}

function writeRaycastHitPoint(
  out: MutableVec3,
  hit: RaycastDirectionHitResult,
  originX: number,
  originY: number,
  originZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  maxDistance: number
): boolean {
  if (!raycastDirectionInto(hit, originX, originY, originZ, dirX, dirY, dirZ, maxDistance)) {
    return false;
  }

  out.x = hit.point.x;
  out.y = hit.point.y;
  out.z = hit.point.z;
  return true;
}

function isNearPoint(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  maxDistance: number
): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz <= maxDistance * maxDistance;
}

function calculateHookshotLaunch(
  ctx: AbilityContext,
  launchSide: -1 | 1,
  maxDistance: number,
  raycastHit: RaycastDirectionHitResult,
  lookDirection: MutableVec3,
  spawnOverride?: { x: number; y: number; z: number } | null
) {
  writeLookDirection(lookDirection, ctx.yaw, ctx.pitch);
  const spawnPos = spawnOverride ?? calculatePlayerSocketPosition(ctx.position, ctx.yaw, {
    ...HOOKSHOT_CHAIN_SOCKET,
    sideOffset: HOOKSHOT_CHAIN_SOCKET.sideOffset * launchSide,
  });
  const aimOriginX = ctx.position.x;
  const aimOriginY = ctx.position.y + EYE_HEIGHT;
  const aimOriginZ = ctx.position.z;
  let aimPointX = aimOriginX + lookDirection.x * maxDistance;
  let aimPointY = aimOriginY + lookDirection.y * maxDistance;
  let aimPointZ = aimOriginZ + lookDirection.z * maxDistance;

  if (ctx.aimPoint) {
    aimPointX = ctx.aimPoint.x;
    aimPointY = ctx.aimPoint.y;
    aimPointZ = ctx.aimPoint.z;
  } else if (isPhysicsReady()) {
    if (raycastDirectionInto(
      raycastHit,
      aimOriginX, aimOriginY, aimOriginZ,
      lookDirection.x, lookDirection.y, lookDirection.z,
      maxDistance
    )) {
      aimPointX = raycastHit.point.x;
      aimPointY = raycastHit.point.y;
      aimPointZ = raycastHit.point.z;
    }
  }

  const aimDeltaX = aimPointX - spawnPos.x;
  const aimDeltaY = aimPointY - spawnPos.y;
  const aimDeltaZ = aimPointZ - spawnPos.z;
  const aimLength = Math.sqrt(aimDeltaX ** 2 + aimDeltaY ** 2 + aimDeltaZ ** 2) || 1;

  return {
    spawnPos,
    direction: {
      x: aimDeltaX / aimLength,
      y: aimDeltaY / aimLength,
      z: aimDeltaZ / aimLength,
    },
  };
}

function resolveHookshotGrapplePoint(
  ctx: AbilityContext,
  raycastHit: RaycastDirectionHitResult,
  direction: MutableVec3,
  hintedDirection: MutableVec3,
  outPoint: MutableVec3
): boolean {
  writeLookDirection(direction, ctx.yaw, ctx.pitch);
  if (!isPhysicsReady()) return false;

  const aimOriginX = ctx.position.x;
  const aimOriginY = ctx.position.y + EYE_HEIGHT;
  const aimOriginZ = ctx.position.z;

  if (ctx.aimPoint) {
    const hintedLength = writeNormalizedDeltaFromCoords(
      hintedDirection,
      aimOriginX,
      aimOriginY,
      aimOriginZ,
      ctx.aimPoint
    );
    const hintedDistance = hintedLength > 0
      ? Math.min(GRAPPLE_MAX_RANGE, hintedLength + 0.75)
      : 0;
    const hintedHit = hintedDistance > 0
      ? writeRaycastHitPoint(
        outPoint,
        raycastHit,
        aimOriginX, aimOriginY, aimOriginZ,
        hintedDirection.x, hintedDirection.y, hintedDirection.z,
        hintedDistance
      )
      : false;

    if (hintedHit && isNearPoint(outPoint, ctx.aimPoint, 1.25)) {
      return true;
    }
  }

  if (writeRaycastHitPoint(
    outPoint,
    raycastHit,
    aimOriginX, aimOriginY, aimOriginZ,
    direction.x, direction.y, direction.z,
    GRAPPLE_MAX_RANGE
  )) {
    return true;
  }

  return writeRaycastHitPoint(
    outPoint,
    raycastHit,
    aimOriginX, aimOriginY, aimOriginZ,
    direction.x, Math.min(direction.y, -0.1), direction.z,
    GRAPPLE_MAX_RANGE
  );
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
  const launchRaycastHitRef = useRef(createRaycastDirectionHitResult());
  const grappleRaycastHitRef = useRef(createRaycastDirectionHitResult());
  const launchLookDirectionRef = useRef({ x: 0, y: 0, z: -1 });
  const grappleLookDirectionRef = useRef({ x: 0, y: 0, z: -1 });
  const grappleHintedDirectionRef = useRef({ x: 0, y: 0, z: -1 });
  const grapplePointScratchRef = useRef({ x: 0, y: 0, z: 0 });

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
      launchRaycastHitRef.current,
      launchLookDirectionRef.current,
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
      launchRaycastHitRef.current,
      launchLookDirectionRef.current,
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
    return resolveHookshotGrapplePoint(
      ctx,
      grappleRaycastHitRef.current,
      grappleLookDirectionRef.current,
      grappleHintedDirectionRef.current,
      grapplePointScratchRef.current
    );
  }, []);

  // Execute Grapple (E ability)
  const executeGrapple = useCallback((ctx: AbilityContext) => {
    if (!resolveHookshotGrapplePoint(
      ctx,
      grappleRaycastHitRef.current,
      grappleLookDirectionRef.current,
      grappleHintedDirectionRef.current,
      grapplePointScratchRef.current
    )) {
      return false;
    }
    const grapplePoint = {
      x: grapplePointScratchRef.current.x,
      y: grapplePointScratchRef.current.y,
      z: grapplePointScratchRef.current.z,
    };

    // Create grapple line visual
    grappleLineIdRef.current++;
    const lineId = `grapple_${ctx.localPlayer.id}_${grappleLineIdRef.current}`;
    const launchSide = 1;
    const startPos = readHookshotHookSocketPosition('hookshot_grapple', launchSide) ?? calculatePlayerSocketPosition(ctx.position, ctx.yaw, {
      ...HOOKSHOT_CHAIN_SOCKET,
      sideOffset: HOOKSHOT_CHAIN_SOCKET.sideOffset * launchSide,
    });

    const startTime = Date.now();
    const line: GrappleLineData = {
      id: lineId,
      startPosition: startPos,
      endPosition: grapplePoint,
      startTime,
      ownerId: ctx.localPlayer.id,
      state: 'extending',
      launchSide,
      launchYaw: ctx.yaw,
    };
    useGameStore.getState().addGrappleLine(line);
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
      const line = selectCurrentGrappleLine(store.grappleLines, null, ctx.localPlayer.id);
      if (line) {
        activeGrappleLineIdRef.current = line.id;
        activeGrappleStartTimeRef.current = line.startTime;
        grappleTargetRef.current = line.endPosition;
        isGrapplingRef.current = false;
        swingWasAirborneRef.current = false;
      }
    }

    const lineId = activeGrappleLineIdRef.current;
    let target = grappleTargetRef.current;
    if (!lineId || !target) {
      if (isGrapplingRef.current) {
        releaseGrappleSwing();
      }
      return;
    }

    if (!isGrapplingRef.current) {
      const activeLine = selectCurrentGrappleLine(store.grappleLines, lineId, ctx.localPlayer.id);
      if (!activeLine) {
        releaseGrappleSwing();
        return;
      }
      target = activeLine.endPosition;
      grappleTargetRef.current = target;
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
