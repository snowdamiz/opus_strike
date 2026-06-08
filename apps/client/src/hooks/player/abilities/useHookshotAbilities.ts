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
import { ABILITY_DEFINITIONS, GRAVITY } from '@voxel-strike/shared';
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
import type { AbilityContext } from '../types';
import { HOOKSHOT_HOOK_SOCKET_NAMES } from '../../../viewmodel/hookshotPose';
import { readViewmodelSocket } from '../../../viewmodel/viewmodelSocketRegistry';

export interface UseHookshotAbilitiesReturn {
  // State refs
  hookProjectileIdRef: React.MutableRefObject<number>;
  dragHookIdRef: React.MutableRefObject<number>;
  grappleTrapIdRef: React.MutableRefObject<number>;
  swingLineIdRef: React.MutableRefObject<number>;
  grappleLineIdRef: React.MutableRefObject<number>;
  earthWallIdRef: React.MutableRefObject<number>;
  lastHookTimeRef: React.MutableRefObject<number>;
  lastDragHookTimeRef: React.MutableRefObject<number>;
  secondaryFirePressedRef: React.MutableRefObject<boolean>;

  // Grapple state
  isGrapplingRef: React.MutableRefObject<boolean>;
  grappleTargetRef: React.MutableRefObject<{ x: number; y: number; z: number } | null>;
  activeGrappleLineIdRef: React.MutableRefObject<string | null>;

  // Swing state
  isSwingingRef: React.MutableRefObject<boolean>;
  swingAttachPointRef: React.MutableRefObject<{ x: number; y: number; z: number } | null>;
  swingRopeLengthRef: React.MutableRefObject<number>;
  swingInitialRopeLengthRef: React.MutableRefObject<number>;
  swingMomentumRef: React.MutableRefObject<{ x: number; y: number; z: number }>;
  activeSwingLineIdRef: React.MutableRefObject<string | null>;

  // Grapple trap targeting
  grappleTrapTargetRef: React.MutableRefObject<THREE.Vector3 | null>;
  grappleTrapValidRef: React.MutableRefObject<boolean>;

  // Methods
  fireChainHook: (ctx: AbilityContext) => void;
  fireDragHook: (ctx: AbilityContext) => void;
  executeGrapple: (ctx: AbilityContext) => boolean;
  executeEarthWall: (ctx: AbilityContext) => void;
  executeGrappleTrap: (ctx: AbilityContext, updateLocalPlayer: (data: any) => void) => void;
  updateGrapplePhysics: (ctx: AbilityContext) => void;
  updateSwingPhysics: (ctx: AbilityContext) => void;
  handleSwingTerrainContact: () => void;
  handleGrappleTrapTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

const WEB_SWING_DURATION_SECONDS = 2.75;
const WEB_SWING_MIN_ROPE_LENGTH = 5;
const WEB_SWING_ANCHOR_RELEASE_DISTANCE = 1.15;
const WEB_SWING_TAUTNESS = 0.96;
const WEB_SWING_INITIAL_PULL = 8;
const WEB_SWING_LOOK_STEER = 46;
const WEB_SWING_INPUT_STEER = 30;
const WEB_SWING_STRAFE_PUMP = 13;
const WEB_SWING_STRAFE_PUMP_MAX_SPEED = 46;
const WEB_SWING_TENSION_FORCE = 76;
const WEB_SWING_NATURAL_PULL = 3.5;
const WEB_SWING_GRAVITY_SCALE = 0.9;
const WEB_SWING_MAX_SPEED = 72;
const WEB_SWING_RELEASE_BOOST = 7;
const WEB_SWING_RELEASE_UPWARD = 8;

function vectorToPlainPosition(vector: THREE.Vector3): { x: number; y: number; z: number } {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}

function readHookshotHookSocketPosition(launchSide: -1 | 1): { x: number; y: number; z: number } | null {
  const socketPose = readViewmodelSocket(HOOKSHOT_HOOK_SOCKET_NAMES[launchSide]);
  return socketPose ? vectorToPlainPosition(socketPose.position) : null;
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

export function useHookshotAbilities(): UseHookshotAbilitiesReturn {
  // ID counters
  const hookProjectileIdRef = useRef(0);
  const dragHookIdRef = useRef(0);
  const grappleTrapIdRef = useRef(0);
  const swingLineIdRef = useRef(0);
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

  // Swing state
  const isSwingingRef = useRef(false);
  const swingAttachPointRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const swingRopeLengthRef = useRef(0);
  const swingInitialRopeLengthRef = useRef(0);
  const swingMomentumRef = useRef({ x: 0, y: 0, z: 0 });
  const activeSwingLineIdRef = useRef<string | null>(null);
  const swingWasAirborneRef = useRef(false);

  // Grapple trap targeting
  const grappleTrapTargetRef = useRef<THREE.Vector3 | null>(null);
  const grappleTrapValidRef = useRef(false);

  // Fire Chain Hook (primary fire)
  const fireChainHook = useCallback((ctx: AbilityContext) => {
    const now = Date.now();
    if (now - lastHookTimeRef.current < HOOKSHOT_FIRE_INTERVAL) return;

    lastHookTimeRef.current = now;
    hookProjectileIdRef.current++;
    const launchSide = hookProjectileIdRef.current % 2 === 1 ? 1 : -1;
    const socketSpawnPos = readHookshotHookSocketPosition(launchSide);
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
  }, []);

  // Fire Drag Hook (secondary fire)
  const fireDragHook = useCallback((ctx: AbilityContext) => {
    const now = Date.now();
    if (now - lastDragHookTimeRef.current < DRAG_HOOK_COOLDOWN) return;

    lastDragHookTimeRef.current = now;
    dragHookIdRef.current++;
    const launchSide = 1;
    const socketSpawnPos = readHookshotHookSocketPosition(launchSide);
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
  }, []);

  // Execute Grapple (E ability)
  const executeGrapple = useCallback((ctx: AbilityContext) => {
    const direction = calculateLookDirection(ctx.yaw, ctx.pitch);

    if (!isPhysicsReady()) return false;

    // Raycast to find grapple point
    let grapplePoint = null;
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
      grapplePoint = hit.point;
    } else {
      // Try slightly downward
      hit = raycastDirection(
        aimOrigin.x, aimOrigin.y, aimOrigin.z,
        direction.x, Math.min(direction.y, -0.1), direction.z,
        GRAPPLE_MAX_RANGE
      );
      if (hit?.hit) {
        grapplePoint = hit.point;
      }
    }

    if (!grapplePoint) return false;

    // Create grapple line visual
    grappleLineIdRef.current++;
    const lineId = `grapple_${ctx.localPlayer.id}_${grappleLineIdRef.current}`;
    const launchSide = 1;
    const startPos = readHookshotHookSocketPosition(launchSide) ?? calculatePlayerSocketPosition(ctx.position, ctx.yaw, {
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
      duration: 4.25,
      ownerId: ctx.localPlayer.id,
      ownerTeam: (ctx.localPlayer.team || 'red') as 'red' | 'blue',
      maxDistance: 22,
      hookProgress: 0,
      wallSegments: [],
    });
  }, []);

  // Execute Grapple Trap (Ultimate)
  const executeGrappleTrap = useCallback((
    ctx: AbilityContext,
    updateLocalPlayer: (data: any) => void
  ) => {
    const now = Date.now();
    const direction = calculateLookDirection(ctx.yaw, ctx.pitch);

    // Start position
    const startPos = {
      x: ctx.localPlayer.position.x,
      y: ctx.localPlayer.position.y + 1.5,
      z: ctx.localPlayer.position.z,
    };

    // Find target
    let targetX = startPos.x + direction.x * GRAPPLE_TRAP_MAX_RANGE;
    let targetY = startPos.y + direction.y * GRAPPLE_TRAP_MAX_RANGE;
    let targetZ = startPos.z + direction.z * GRAPPLE_TRAP_MAX_RANGE;

    if (isPhysicsReady()) {
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

    updateLocalPlayer({ ultimateCharge: 0 });
  }, []);

  const handleSwingTerrainContact = useCallback(() => {
    if (!swingWasAirborneRef.current || (!isGrapplingRef.current && !isSwingingRef.current)) return;

    const store = useGameStore.getState();
    if (activeGrappleLineIdRef.current) {
      store.removeGrappleLine(activeGrappleLineIdRef.current);
    }
    if (activeSwingLineIdRef.current) {
      store.updateSwingLine(activeSwingLineIdRef.current, { state: 'done', isActive: false });
    }

    isGrapplingRef.current = false;
    isSwingingRef.current = false;
    grappleTargetRef.current = null;
    activeGrappleLineIdRef.current = null;
    activeGrappleStartTimeRef.current = 0;
    swingAttachPointRef.current = null;
    activeSwingLineIdRef.current = null;
    swingRopeLengthRef.current = 0;
    swingInitialRopeLengthRef.current = 0;
    swingWasAirborneRef.current = false;
  }, []);

  // Update grapple physics
  const updateGrapplePhysics = useCallback((ctx: AbilityContext) => {
    const releaseGrappleSwing = (withBoost: boolean) => {
      if (withBoost) {
        const horizontalSpeed = Math.sqrt(ctx.velocity.x ** 2 + ctx.velocity.z ** 2);
        if (horizontalSpeed > 0.1) {
          ctx.velocity.x += (ctx.velocity.x / horizontalSpeed) * WEB_SWING_RELEASE_BOOST;
          ctx.velocity.z += (ctx.velocity.z / horizontalSpeed) * WEB_SWING_RELEASE_BOOST;
        }

        const lookDir = calculateLookDirection(ctx.yaw, ctx.pitch);
        ctx.velocity.x += lookDir.x * 4;
        ctx.velocity.y += Math.max(0, lookDir.y) * 4;
        ctx.velocity.z += lookDir.z * 4;
        ctx.velocity.y = Math.max(ctx.velocity.y, WEB_SWING_RELEASE_UPWARD);
      }

      if (activeGrappleLineIdRef.current) {
        useGameStore.getState().removeGrappleLine(activeGrappleLineIdRef.current);
      }

      isGrapplingRef.current = false;
      isSwingingRef.current = false;
      grappleTargetRef.current = null;
      activeGrappleLineIdRef.current = null;
      activeGrappleStartTimeRef.current = 0;
      swingRopeLengthRef.current = 0;
      swingInitialRopeLengthRef.current = 0;
      swingWasAirborneRef.current = false;
    };

    const lineId = activeGrappleLineIdRef.current;
    const target = grappleTargetRef.current;
    if (!lineId || !target) {
      if (isGrapplingRef.current) {
        releaseGrappleSwing(false);
      }
      return;
    }

    const store = useGameStore.getState();

    const toTargetX = target.x - ctx.position.x;
    const toTargetY = target.y - ctx.position.y;
    const toTargetZ = target.z - ctx.position.z;
    const currentLength = Math.sqrt(toTargetX * toTargetX + toTargetY * toTargetY + toTargetZ * toTargetZ);
    if (currentLength < WEB_SWING_ANCHOR_RELEASE_DISTANCE) {
      releaseGrappleSwing(true);
      return;
    }

    const ropeDirX = toTargetX / currentLength;
    const ropeDirY = toTargetY / currentLength;
    const ropeDirZ = toTargetZ / currentLength;

    if (!isGrapplingRef.current) {
      const activeLine = store.grappleLines.find(l => l.id === lineId);
      if (!activeLine) {
        releaseGrappleSwing(false);
        return;
      }
      if (activeLine.state !== 'attached' && activeLine.state !== 'pulling') return;

      isGrapplingRef.current = true;
      isSwingingRef.current = true;
      activeGrappleStartTimeRef.current = activeLine.startTime;
      swingWasAirborneRef.current = !ctx.isGrounded;
      swingRopeLengthRef.current = Math.max(WEB_SWING_MIN_ROPE_LENGTH, currentLength * WEB_SWING_TAUTNESS);
      swingInitialRopeLengthRef.current = swingRopeLengthRef.current;
      swingMomentumRef.current = { x: ctx.velocity.x, y: ctx.velocity.y, z: ctx.velocity.z };
      store.updateGrappleLine(lineId, { state: 'pulling' });

      ctx.velocity.x += ropeDirX * WEB_SWING_INITIAL_PULL;
      ctx.velocity.y += ropeDirY * WEB_SWING_INITIAL_PULL;
      ctx.velocity.z += ropeDirZ * WEB_SWING_INITIAL_PULL;
      ctx.velocity.y = Math.max(ctx.velocity.y, 5);
    }

    if (ctx.isGrounded && swingWasAirborneRef.current) {
      releaseGrappleSwing(false);
      return;
    }
    if (!ctx.isGrounded) {
      swingWasAirborneRef.current = true;
    }

    const elapsed = (Date.now() - activeGrappleStartTimeRef.current) / 1000;
    const duration = WEB_SWING_DURATION_SECONDS;
    if (elapsed >= duration || ctx.inputState.jump) {
      releaseGrappleSwing(ctx.inputState.jump);
      return;
    }

    const lookDir = calculateLookDirection(ctx.yaw, ctx.pitch);
    const lookAlongRope = lookDir.x * ropeDirX + lookDir.y * ropeDirY + lookDir.z * ropeDirZ;
    const lookPerpX = lookDir.x - ropeDirX * lookAlongRope;
    const lookPerpY = lookDir.y - ropeDirY * lookAlongRope;
    const lookPerpZ = lookDir.z - ropeDirZ * lookAlongRope;
    const lookPerpLen = Math.sqrt(lookPerpX * lookPerpX + lookPerpY * lookPerpY + lookPerpZ * lookPerpZ);

    if (lookPerpLen > 0.05) {
      const lookInfluence = 0.35 + Math.min(lookPerpLen, 1) * 0.65;
      const lookForce = WEB_SWING_LOOK_STEER * lookInfluence * ctx.dt;
      ctx.velocity.x += (lookPerpX / lookPerpLen) * lookForce;
      ctx.velocity.y += (lookPerpY / lookPerpLen) * lookForce;
      ctx.velocity.z += (lookPerpZ / lookPerpLen) * lookForce;
    }

    const isPureStrafing = ctx.inputState.moveLeft !== ctx.inputState.moveRight &&
      !ctx.inputState.moveForward &&
      !ctx.inputState.moveBackward;
    let wishDirX = 0;
    let wishDirZ = 0;
    if (isPureStrafing && ctx.inputState.moveLeft) { wishDirX -= Math.cos(ctx.yaw); wishDirZ += Math.sin(ctx.yaw); }
    if (isPureStrafing && ctx.inputState.moveRight) { wishDirX += Math.cos(ctx.yaw); wishDirZ -= Math.sin(ctx.yaw); }

    const wishLen = Math.sqrt(wishDirX * wishDirX + wishDirZ * wishDirZ);
    if (wishLen > 0.1) {
      wishDirX /= wishLen;
      wishDirZ /= wishLen;

      const wishAlongRope = wishDirX * ropeDirX + wishDirZ * ropeDirZ;
      const wishPerpX = wishDirX - ropeDirX * wishAlongRope;
      const wishPerpY = -ropeDirY * wishAlongRope;
      const wishPerpZ = wishDirZ - ropeDirZ * wishAlongRope;
      const wishPerpLen = Math.sqrt(wishPerpX * wishPerpX + wishPerpY * wishPerpY + wishPerpZ * wishPerpZ);

      if (wishPerpLen > 0.05) {
        const inputForce = WEB_SWING_INPUT_STEER * ctx.dt;
        const tangentX = wishPerpX / wishPerpLen;
        const tangentY = wishPerpY / wishPerpLen;
        const tangentZ = wishPerpZ / wishPerpLen;
        ctx.velocity.x += tangentX * inputForce;
        ctx.velocity.y += tangentY * inputForce * 0.6;
        ctx.velocity.z += tangentZ * inputForce;

        const horizontalSpeed = Math.sqrt(ctx.velocity.x ** 2 + ctx.velocity.z ** 2);
        if (horizontalSpeed < WEB_SWING_STRAFE_PUMP_MAX_SPEED) {
          const pumpScale = 1 - horizontalSpeed / WEB_SWING_STRAFE_PUMP_MAX_SPEED;
          const pumpForce = WEB_SWING_STRAFE_PUMP * pumpScale * ctx.dt;
          const pumpX = horizontalSpeed > 0.1 ? ctx.velocity.x / horizontalSpeed : tangentX;
          const pumpZ = horizontalSpeed > 0.1 ? ctx.velocity.z / horizontalSpeed : tangentZ;
          ctx.velocity.x += pumpX * pumpForce;
          ctx.velocity.z += pumpZ * pumpForce;
        }
      }
    }

    ctx.velocity.y += GRAVITY * WEB_SWING_GRAVITY_SCALE * ctx.dt;

    const ropeLength = swingRopeLengthRef.current || currentLength;
    if (currentLength > ropeLength) {
      const awaySpeed = ctx.velocity.x * -ropeDirX + ctx.velocity.y * -ropeDirY + ctx.velocity.z * -ropeDirZ;
      if (awaySpeed > 0) {
        ctx.velocity.x += ropeDirX * awaySpeed;
        ctx.velocity.y += ropeDirY * awaySpeed;
        ctx.velocity.z += ropeDirZ * awaySpeed;
      }

      const overExtend = currentLength - ropeLength;
      const tensionForce = overExtend * WEB_SWING_TENSION_FORCE * ctx.dt;
      ctx.velocity.x += ropeDirX * tensionForce;
      ctx.velocity.y += ropeDirY * tensionForce;
      ctx.velocity.z += ropeDirZ * tensionForce;

      ctx.position.x = target.x - ropeDirX * ropeLength;
      ctx.position.y = target.y - ropeDirY * ropeLength;
      ctx.position.z = target.z - ropeDirZ * ropeLength;
    }

    ctx.velocity.x += ropeDirX * WEB_SWING_NATURAL_PULL * ctx.dt;
    ctx.velocity.y += ropeDirY * WEB_SWING_NATURAL_PULL * ctx.dt * 0.35;
    ctx.velocity.z += ropeDirZ * WEB_SWING_NATURAL_PULL * ctx.dt;

    if (ctx.position.y < target.y) {
      const heightDiff = target.y - ctx.position.y;
      const swingBoost = Math.min(heightDiff * 0.45, 4);
      const horizontalSpeed = Math.sqrt(ctx.velocity.x ** 2 + ctx.velocity.z ** 2);
      if (horizontalSpeed > 0.1) {
        ctx.velocity.x += (ctx.velocity.x / horizontalSpeed) * swingBoost * ctx.dt;
        ctx.velocity.z += (ctx.velocity.z / horizontalSpeed) * swingBoost * ctx.dt;
      }
    }

    const speed = Math.sqrt(ctx.velocity.x ** 2 + ctx.velocity.y ** 2 + ctx.velocity.z ** 2);
    if (speed > WEB_SWING_MAX_SPEED) {
      const scale = WEB_SWING_MAX_SPEED / speed;
      ctx.velocity.x *= scale;
      ctx.velocity.y *= scale;
      ctx.velocity.z *= scale;
    }
  }, []);

  // Update swing physics (Apex Pathfinder style)
  const updateSwingPhysics = useCallback((ctx: AbilityContext) => {
    // Phase 1: Wait for hook to reach target
    if (activeSwingLineIdRef.current && swingAttachPointRef.current && !isSwingingRef.current) {
      const swingLines = useGameStore.getState().swingLines;
      const activeLine = swingLines.find(l => l.id === activeSwingLineIdRef.current);

      if (activeLine && activeLine.state === 'attached') {
        isSwingingRef.current = true;
        useGameStore.getState().updateSwingLine(activeSwingLineIdRef.current, { state: 'swinging' });

        const attach = swingAttachPointRef.current;
        swingRopeLengthRef.current = Math.sqrt(
          (attach.x - ctx.position.x) ** 2 +
          (attach.y - ctx.position.y) ** 2 +
          (attach.z - ctx.position.z) ** 2
        );
        swingInitialRopeLengthRef.current = swingRopeLengthRef.current;
        swingMomentumRef.current = { x: ctx.velocity.x, y: ctx.velocity.y, z: ctx.velocity.z };
        swingWasAirborneRef.current = !ctx.isGrounded;

        // Initial pull
        const toAttach = {
          x: attach.x - ctx.position.x,
          y: attach.y - ctx.position.y,
          z: attach.z - ctx.position.z,
        };
        const dist = Math.sqrt(toAttach.x ** 2 + toAttach.y ** 2 + toAttach.z ** 2);
        if (dist > 0) {
          ctx.velocity.x += (toAttach.x / dist) * 12;
          ctx.velocity.y += (toAttach.y / dist) * 12;
          ctx.velocity.z += (toAttach.z / dist) * 12;
        }
      } else if (!activeLine) {
        activeSwingLineIdRef.current = null;
        swingAttachPointRef.current = null;
      }
    }

    // Phase 2: Active swing
    if (activeSwingLineIdRef.current && isSwingingRef.current && swingAttachPointRef.current) {
      const attach = swingAttachPointRef.current;
      const swingLines = useGameStore.getState().swingLines;
      const activeLine = swingLines.find(l => l.id === activeSwingLineIdRef.current);
      const elapsed = activeLine ? (Date.now() - activeLine.startTime) / 1000 : 0;
      const duration = WEB_SWING_DURATION_SECONDS;

      if (elapsed >= duration || !activeLine) {
        isSwingingRef.current = false;
        swingAttachPointRef.current = null;
        activeSwingLineIdRef.current = null;
        swingWasAirborneRef.current = false;
        return;
      }

      if (ctx.isGrounded && swingWasAirborneRef.current) {
        handleSwingTerrainContact();
        return;
      }
      if (!ctx.isGrounded) {
        swingWasAirborneRef.current = true;
      }

      // Rope direction
      const toAttach = {
        x: attach.x - ctx.position.x,
        y: attach.y - ctx.position.y,
        z: attach.z - ctx.position.z,
      };
      const currentLength = Math.sqrt(toAttach.x ** 2 + toAttach.y ** 2 + toAttach.z ** 2);
      const ropeDir = {
        x: toAttach.x / currentLength,
        y: toAttach.y / currentLength,
        z: toAttach.z / currentLength,
      };

      // Look direction slingshot effect
      const lookDir = calculateLookDirection(ctx.yaw, ctx.pitch);
      const lookDot = lookDir.x * ropeDir.x + lookDir.y * ropeDir.y + lookDir.z * ropeDir.z;
      const slingshotFactor = 1 - lookDot;
      const slingshotStrength = 25 * slingshotFactor;

      const lookAlongRope = lookDir.x * ropeDir.x + lookDir.y * ropeDir.y + lookDir.z * ropeDir.z;
      const lookPerp = {
        x: lookDir.x - ropeDir.x * lookAlongRope,
        y: lookDir.y - ropeDir.y * lookAlongRope,
        z: lookDir.z - ropeDir.z * lookAlongRope,
      };
      const lookPerpLen = Math.sqrt(lookPerp.x ** 2 + lookPerp.y ** 2 + lookPerp.z ** 2);

      if (lookPerpLen > 0.1) {
        ctx.velocity.x += (lookPerp.x / lookPerpLen) * slingshotStrength * ctx.dt;
        ctx.velocity.y += (lookPerp.y / lookPerpLen) * slingshotStrength * ctx.dt * 0.5;
        ctx.velocity.z += (lookPerp.z / lookPerpLen) * slingshotStrength * ctx.dt;
      }

      // Strafe input momentum
      const wishDir = { x: 0, y: 0, z: 0 };
      if (ctx.inputState.moveForward) { wishDir.x -= Math.sin(ctx.yaw); wishDir.z -= Math.cos(ctx.yaw); }
      if (ctx.inputState.moveBackward) { wishDir.x += Math.sin(ctx.yaw); wishDir.z += Math.cos(ctx.yaw); }
      if (ctx.inputState.moveLeft) { wishDir.x -= Math.cos(ctx.yaw); wishDir.z += Math.sin(ctx.yaw); }
      if (ctx.inputState.moveRight) { wishDir.x += Math.cos(ctx.yaw); wishDir.z -= Math.sin(ctx.yaw); }

      const wishLen = Math.sqrt(wishDir.x ** 2 + wishDir.z ** 2);
      if (wishLen > 0.1) {
        wishDir.x /= wishLen;
        wishDir.z /= wishLen;

        const strafeAlongRope = wishDir.x * ropeDir.x + wishDir.z * ropeDir.z;
        const strafePerp = {
          x: wishDir.x - ropeDir.x * strafeAlongRope,
          z: wishDir.z - ropeDir.z * strafeAlongRope,
        };
        const strafePerpLen = Math.sqrt(strafePerp.x ** 2 + strafePerp.z ** 2);

        if (strafePerpLen > 0.1) {
          ctx.velocity.x += (strafePerp.x / strafePerpLen) * 20 * ctx.dt;
          ctx.velocity.z += (strafePerp.z / strafePerpLen) * 20 * ctx.dt;
        }
      }

      // Gravity
      ctx.velocity.y += GRAVITY * ctx.dt;

      // Rope tension
      const maxLength = swingInitialRopeLengthRef.current;
      if (currentLength > maxLength) {
        const velAlongRope = ctx.velocity.x * (-ropeDir.x) + ctx.velocity.y * (-ropeDir.y) + ctx.velocity.z * (-ropeDir.z);
        if (velAlongRope > 0) {
          ctx.velocity.x += ropeDir.x * velAlongRope;
          ctx.velocity.y += ropeDir.y * velAlongRope;
          ctx.velocity.z += ropeDir.z * velAlongRope;
        }

        const overExtend = currentLength - maxLength;
        const tensionForce = overExtend * 50;
        ctx.velocity.x += ropeDir.x * tensionForce * ctx.dt;
        ctx.velocity.y += ropeDir.y * tensionForce * ctx.dt;
        ctx.velocity.z += ropeDir.z * tensionForce * ctx.dt;

        ctx.position.x = attach.x - ropeDir.x * maxLength;
        ctx.position.y = attach.y - ropeDir.y * maxLength;
        ctx.position.z = attach.z - ropeDir.z * maxLength;
      }

      // Natural pull
      ctx.velocity.x += ropeDir.x * 8 * ctx.dt;
      ctx.velocity.y += ropeDir.y * 8 * ctx.dt * 0.3;
      ctx.velocity.z += ropeDir.z * 8 * ctx.dt;

      // Pendulum boost
      if (ctx.position.y < attach.y) {
        const heightDiff = attach.y - ctx.position.y;
        const swingBoost = Math.min(heightDiff * 0.5, 3);
        const hSpeed = Math.sqrt(ctx.velocity.x ** 2 + ctx.velocity.z ** 2);
        if (hSpeed > 0.1) {
          ctx.velocity.x += (ctx.velocity.x / hSpeed) * swingBoost * ctx.dt;
          ctx.velocity.z += (ctx.velocity.z / hSpeed) * swingBoost * ctx.dt;
        }
      }

      // Jump to release
      if (ctx.inputState.jump) {
        const releaseBoost = 5;
        const hSpeed = Math.sqrt(ctx.velocity.x ** 2 + ctx.velocity.z ** 2);
        if (hSpeed > 0.1) {
          ctx.velocity.x += (ctx.velocity.x / hSpeed) * releaseBoost;
          ctx.velocity.z += (ctx.velocity.z / hSpeed) * releaseBoost;
        }
        ctx.velocity.y = Math.max(ctx.velocity.y, 8);

        isSwingingRef.current = false;
        swingAttachPointRef.current = null;
        swingWasAirborneRef.current = false;
        if (activeSwingLineIdRef.current) {
          useGameStore.getState().updateSwingLine(activeSwingLineIdRef.current, { state: 'done', isActive: false });
        }
        activeSwingLineIdRef.current = null;
      }
    }
  }, [handleSwingTerrainContact]);

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
    swingLineIdRef,
    grappleLineIdRef,
    earthWallIdRef,
    lastHookTimeRef,
    lastDragHookTimeRef,
    secondaryFirePressedRef,
    isGrapplingRef,
    grappleTargetRef,
    activeGrappleLineIdRef,
    isSwingingRef,
    swingAttachPointRef,
    swingRopeLengthRef,
    swingInitialRopeLengthRef,
    swingMomentumRef,
    activeSwingLineIdRef,
    grappleTrapTargetRef,
    grappleTrapValidRef,
    fireChainHook,
    fireDragHook,
    executeGrapple,
    executeEarthWall,
    executeGrappleTrap,
    updateGrapplePhysics,
    updateSwingPhysics,
    handleSwingTerrainContact,
    handleGrappleTrapTargetUpdate,
  };
}
