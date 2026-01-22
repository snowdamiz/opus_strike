/**
 * Hookshot Hero Abilities Hook
 * 
 * Handles Hookshot-specific abilities:
 * - Chain Hooks (primary fire)
 * - Drag Hook (secondary fire)
 * - Grapple (Q ability)
 * - Earth Wall (E ability)
 * - Grapple Trap (Ultimate)
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { ABILITY_DEFINITIONS, GRAVITY } from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { raycastDirection, checkGroundWithNormal, isPhysicsReady } from '../../usePhysics';
import {
  HOOKSHOT_FIRE_INTERVAL,
  HOOKSHOT_SPEED,
  HOOKSHOT_MAX_DISTANCE,
  DRAG_HOOK_COOLDOWN,
  DRAG_HOOK_SPEED,
  GRAPPLE_MAX_RANGE,
  GRAPPLE_TRAP_MAX_RANGE,
  GRAPPLE_TRAP_THROW_SPEED,
  GRAPPLE_TRAP_GRAVITY,
  calculateProjectileSpawn,
  calculateLookDirection,
  calculateHorizontalLookDirection,
} from '../constants';
import type { AbilityContext } from '../types';

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
  executeGrapple: (ctx: AbilityContext) => void;
  executeEarthWall: (ctx: AbilityContext) => void;
  executeGrappleTrap: (ctx: AbilityContext, updateLocalPlayer: (data: any) => void) => void;
  updateGrapplePhysics: (ctx: AbilityContext) => void;
  updateSwingPhysics: (ctx: AbilityContext) => void;
  handleGrappleTrapTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
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

  // Swing state
  const isSwingingRef = useRef(false);
  const swingAttachPointRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const swingRopeLengthRef = useRef(0);
  const swingInitialRopeLengthRef = useRef(0);
  const swingMomentumRef = useRef({ x: 0, y: 0, z: 0 });
  const activeSwingLineIdRef = useRef<string | null>(null);

  // Grapple trap targeting
  const grappleTrapTargetRef = useRef<THREE.Vector3 | null>(null);
  const grappleTrapValidRef = useRef(false);

  // Fire Chain Hook (primary fire)
  const fireChainHook = useCallback((ctx: AbilityContext) => {
    const now = Date.now();
    if (now - lastHookTimeRef.current < HOOKSHOT_FIRE_INTERVAL) return;

    lastHookTimeRef.current = now;
    const direction = calculateLookDirection(ctx.yaw, ctx.pitch);
    const spawnPos = calculateProjectileSpawn(ctx.position, direction);

    hookProjectileIdRef.current++;
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
    });
  }, []);

  // Fire Drag Hook (secondary fire)
  const fireDragHook = useCallback((ctx: AbilityContext) => {
    const now = Date.now();
    if (now - lastDragHookTimeRef.current < DRAG_HOOK_COOLDOWN) return;

    lastDragHookTimeRef.current = now;
    const direction = calculateLookDirection(ctx.yaw, ctx.pitch);
    const spawnPos = calculateProjectileSpawn(ctx.position, direction);

    dragHookIdRef.current++;
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
    });
  }, []);

  // Execute Grapple (Q ability)
  const executeGrapple = useCallback((ctx: AbilityContext) => {
    const direction = calculateLookDirection(ctx.yaw, ctx.pitch);

    if (!isPhysicsReady()) return;

    // Raycast to find grapple point
    let grapplePoint = null;

    let hit = raycastDirection(
      ctx.position.x, ctx.position.y + 0.6, ctx.position.z,
      direction.x, direction.y, direction.z,
      GRAPPLE_MAX_RANGE
    );

    if (hit?.hit) {
      grapplePoint = hit.point;
    } else {
      // Try slightly downward
      hit = raycastDirection(
        ctx.position.x, ctx.position.y + 0.6, ctx.position.z,
        direction.x, Math.min(direction.y, -0.1), direction.z,
        GRAPPLE_MAX_RANGE
      );
      if (hit?.hit) {
        grapplePoint = hit.point;
      }
    }

    if (!grapplePoint) return;

    // Create grapple line visual
    grappleLineIdRef.current++;
    const lineId = `grapple_${ctx.localPlayer.id}_${grappleLineIdRef.current}`;
    const startPos = { x: ctx.position.x, y: ctx.position.y + 0.6, z: ctx.position.z };

    useGameStore.getState().addGrappleLine({
      id: lineId,
      startPosition: startPos,
      endPosition: grapplePoint,
      startTime: Date.now(),
      ownerId: ctx.localPlayer.id,
      state: 'extending',
    });

    // Store target - pulling will start when hook reaches target
    grappleTargetRef.current = grapplePoint;
    activeGrappleLineIdRef.current = lineId;
    isGrapplingRef.current = false;
  }, []);

  // Execute Earth Wall (E ability)
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
      duration: 3,
      ownerId: ctx.localPlayer.id,
      ownerTeam: (ctx.localPlayer.team || 'red') as 'red' | 'blue',
      maxDistance: 25,
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

  // Update grapple physics
  const updateGrapplePhysics = useCallback((ctx: AbilityContext) => {
    // Check if hook has reached target
    if (activeGrappleLineIdRef.current && grappleTargetRef.current && !isGrapplingRef.current) {
      const grappleLines = useGameStore.getState().grappleLines;
      const activeLine = grappleLines.find(l => l.id === activeGrappleLineIdRef.current);

      if (activeLine && activeLine.state === 'attached') {
        isGrapplingRef.current = true;
        ctx.velocity.y = Math.max(ctx.velocity.y, 8);
      } else if (!activeLine) {
        activeGrappleLineIdRef.current = null;
        grappleTargetRef.current = null;
      }
    }

    // Pull player toward grapple target
    if (isGrapplingRef.current && grappleTargetRef.current) {
      const target = grappleTargetRef.current;
      const toTarget = {
        x: target.x - ctx.position.x,
        y: target.y - ctx.position.y,
        z: target.z - ctx.position.z,
      };
      const dist = Math.sqrt(toTarget.x ** 2 + toTarget.y ** 2 + toTarget.z ** 2);

      if (dist < 1.5) {
        // Arrived
        isGrapplingRef.current = false;
        grappleTargetRef.current = null;
        activeGrappleLineIdRef.current = null;
        ctx.velocity.y = Math.max(ctx.velocity.y, 5);
      } else {
        // Pull
        const maxDist = 40;
        const proximityFactor = 1 - Math.min(dist / maxDist, 1);
        const basePull = 28;
        const maxPull = 65;
        const pullStrength = basePull + (maxPull - basePull) * (proximityFactor * proximityFactor);

        ctx.velocity.x = (toTarget.x / dist) * pullStrength;
        ctx.velocity.y = (toTarget.y / dist) * pullStrength + 2;
        ctx.velocity.z = (toTarget.z / dist) * pullStrength;
      }
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
    if (isSwingingRef.current && swingAttachPointRef.current) {
      const attach = swingAttachPointRef.current;
      const swingLines = useGameStore.getState().swingLines;
      const activeLine = swingLines.find(l => l.id === activeSwingLineIdRef.current);
      const elapsed = activeLine ? (Date.now() - activeLine.startTime) / 1000 : 0;
      const duration = ABILITY_DEFINITIONS['hookshot_swing']?.duration ?? 3;

      if (elapsed >= duration || !activeLine) {
        isSwingingRef.current = false;
        swingAttachPointRef.current = null;
        activeSwingLineIdRef.current = null;
        return;
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
        if (activeSwingLineIdRef.current) {
          useGameStore.getState().updateSwingLine(activeSwingLineIdRef.current, { state: 'done', isActive: false });
        }
        activeSwingLineIdRef.current = null;
      }
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
    handleGrappleTrapTargetUpdate,
  };
}


