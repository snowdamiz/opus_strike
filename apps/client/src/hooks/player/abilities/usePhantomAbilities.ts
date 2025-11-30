/**
 * Phantom Hero Abilities Hook
 * 
 * Handles Phantom-specific abilities:
 * - Dire Ball (primary fire)
 * - Void Ray (secondary fire - charged)
 * - Blink (E ability)
 * - Shadow Step (Q ability - targeting)
 * - Phantom Veil (Ultimate)
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { ABILITY_DEFINITIONS, VOID_RAY_CHARGE_TIME } from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import {
  checkWallCollision,
  validateTeleportDestination,
} from '../../usePhysics';
import { triggerTeleportEffect } from '../../../components/ui/TeleportEffects';
import { triggerBlinkEffect, triggerShadowArrival } from '../../../components/game/PhantomEffects';
import {
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  PHANTOM_FIRE_INTERVAL,
  PHANTOM_PROJECTILE_SPEED,
  calculateProjectileSpawn,
  calculateLookDirection,
} from '../constants';
import type { AbilityContext, PlayerSounds, TargetingRefs } from '../types';

export interface UsePhantomAbilitiesReturn {
  // State refs
  lastFireTimeRef: React.MutableRefObject<number>;
  direBallIdRef: React.MutableRefObject<number>;
  voidRayChargingRef: React.MutableRefObject<boolean>;
  voidRayChargeStartRef: React.MutableRefObject<number>;
  voidRayIdRef: React.MutableRefObject<number>;
  shadowStepTargetRef: React.MutableRefObject<THREE.Vector3 | null>;
  shadowStepValidRef: React.MutableRefObject<boolean>;
  teleportingRef: React.MutableRefObject<boolean>;

  // Methods
  fireDireBall: (ctx: AbilityContext, sounds: PlayerSounds) => void;
  handleVoidRay: (ctx: AbilityContext, sounds: PlayerSounds) => void;
  executeBlink: (
    ctx: AbilityContext,
    sounds: PlayerSounds,
    useAbilityCharge: (id: string) => boolean
  ) => boolean;
  executeShadowStepTeleport: (
    ctx: AbilityContext,
    sounds: PlayerSounds,
    startClientCooldown: (id: string) => void,
    sendInput: (input: any) => void,
    updateLocalPlayer: (data: any) => void,
    camera: THREE.Camera
  ) => void;
  executePhantomVeil: (
    ctx: AbilityContext,
    sounds: PlayerSounds,
    updateLocalPlayer: (data: any) => void,
    setAbilityActive: (id: string, active: boolean) => void
  ) => void;
  handleShadowStepTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

export function usePhantomAbilities(): UsePhantomAbilitiesReturn {
  // Fire state
  const lastFireTimeRef = useRef(0);
  const direBallIdRef = useRef(0);

  // Void Ray state
  const voidRayChargingRef = useRef(false);
  const voidRayChargeStartRef = useRef(0);
  const voidRayIdRef = useRef(0);

  // Shadow Step state
  const shadowStepTargetRef = useRef<THREE.Vector3 | null>(null);
  const shadowStepValidRef = useRef(false);
  const teleportingRef = useRef(false);

  // Fire Dire Ball (primary fire)
  const fireDireBall = useCallback((ctx: AbilityContext, sounds: PlayerSounds) => {
    const now = Date.now();
    if (now - lastFireTimeRef.current < PHANTOM_FIRE_INTERVAL) return;

    lastFireTimeRef.current = now;
    const direction = calculateLookDirection(ctx.yaw, ctx.pitch);
    const spawnPos = calculateProjectileSpawn(ctx.position, direction);

    direBallIdRef.current++;
    const ballId = `dire_${ctx.localPlayer.id}_${direBallIdRef.current}`;

    useGameStore.getState().addDireBall({
      id: ballId,
      position: spawnPos,
      velocity: {
        x: direction.x * PHANTOM_PROJECTILE_SPEED,
        y: direction.y * PHANTOM_PROJECTILE_SPEED,
        z: direction.z * PHANTOM_PROJECTILE_SPEED,
      },
      startTime: now,
      ownerId: ctx.localPlayer.id,
    });

    sounds.playPhantomBasic();
  }, []);

  // Handle Void Ray charge and fire (secondary fire)
  const handleVoidRay = useCallback((ctx: AbilityContext, sounds: PlayerSounds) => {
    const now = Date.now();

    if (ctx.inputState.secondaryFire) {
      if (!voidRayChargingRef.current) {
        voidRayChargingRef.current = true;
        voidRayChargeStartRef.current = now;
        useGameStore.getState().setVoidRayCharging(true, now);
      }
    } else if (voidRayChargingRef.current) {
      const chargeTime = now - voidRayChargeStartRef.current;
      const chargeProgress = chargeTime / VOID_RAY_CHARGE_TIME;

      if (chargeProgress >= 1) {
        // Fully charged - FIRE!
        const direction = calculateLookDirection(ctx.yaw, ctx.pitch);
        const spawnPos = calculateProjectileSpawn(ctx.position, direction);

        voidRayIdRef.current++;
        const rayId = `voidray_${ctx.localPlayer.id}_${voidRayIdRef.current}`;

        useGameStore.getState().addVoidRay({
          id: rayId,
          startPosition: spawnPos,
          direction,
          startTime: now,
          ownerId: ctx.localPlayer.id,
          ownerTeam: (ctx.localPlayer.team || 'red') as 'red' | 'blue',
        });

        sounds.playPhantomVoidRay();
      }

      voidRayChargingRef.current = false;
      voidRayChargeStartRef.current = 0;
      useGameStore.getState().setVoidRayCharging(false, 0);
    }
  }, []);

  // Execute Blink ability (E)
  const executeBlink = useCallback((
    ctx: AbilityContext,
    sounds: PlayerSounds,
    useAbilityCharge: (id: string) => boolean
  ): boolean => {
    const blinkDistance = 8;
    const dx = -Math.sin(ctx.yaw);
    const dz = -Math.cos(ctx.yaw);

    let targetX = ctx.position.x + dx * blinkDistance;
    let targetY = ctx.position.y;
    let targetZ = ctx.position.z + dz * blinkDistance;

    // Upward boost if looking up
    if (ctx.pitch < -0.3) {
      targetY += 2;
    }

    // Check for walls
    const checkHeights = [0.9, 1.5];
    let wallBlocking = false;
    const distToTarget = Math.sqrt(
      (targetX - ctx.position.x) ** 2 +
      (targetZ - ctx.position.z) ** 2
    );

    for (const h of checkHeights) {
      const wallCheck = checkWallCollision(
        ctx.position.x,
        ctx.position.y - PLAYER_HEIGHT / 2 + h,
        ctx.position.z,
        dx, dz, distToTarget
      );

      if (wallCheck.hit && wallCheck.distance < distToTarget - 1.0) {
        const normalY = Math.abs(wallCheck.normal.y);
        if (normalY < 0.5) {
          wallBlocking = true;
          break;
        }
      }
    }

    if (wallBlocking) {
      // Find safe distance
      let safeDistance = 3;
      for (let testDist = blinkDistance - 1; testDist >= 3; testDist -= 1) {
        let blocked = false;
        for (const h of checkHeights) {
          const wallCheck = checkWallCollision(
            ctx.position.x,
            ctx.position.y - PLAYER_HEIGHT / 2 + h,
            ctx.position.z,
            dx, dz, testDist
          );
          const normalY = Math.abs(wallCheck.normal.y);
          if (wallCheck.hit && wallCheck.distance < testDist - 0.5 && normalY < 0.5) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          safeDistance = testDist;
          break;
        }
      }
      targetX = ctx.position.x + dx * safeDistance;
      targetZ = ctx.position.z + dz * safeDistance;
    }

    // Validate destination
    const validation = validateTeleportDestination(targetX, targetY, targetZ, PLAYER_HEIGHT, PLAYER_RADIUS);

    if (!validation.valid) {
      // Try shorter distances
      let foundValid = false;
      for (let dist = blinkDistance - 1; dist >= 2; dist--) {
        const shorterX = ctx.position.x + dx * dist;
        const shorterZ = ctx.position.z + dz * dist;
        const shorterValidation = validateTeleportDestination(shorterX, targetY, shorterZ, PLAYER_HEIGHT, PLAYER_RADIUS);

        if (shorterValidation.valid) {
          targetX = shorterValidation.adjustedPosition?.x ?? shorterX;
          targetY = shorterValidation.adjustedPosition?.y ?? targetY;
          targetZ = shorterValidation.adjustedPosition?.z ?? shorterZ;
          foundValid = true;
          break;
        }
      }
      if (!foundValid) return false;
    } else if (validation.adjustedPosition) {
      targetX = validation.adjustedPosition.x;
      targetY = validation.adjustedPosition.y;
      targetZ = validation.adjustedPosition.z;
    }

    // Use charge
    if (!useAbilityCharge('phantom_blink')) return false;

    // Save start position for effect
    const startPos = { x: ctx.position.x, y: ctx.position.y, z: ctx.position.z };

    // Play sound and effects
    sounds.playPhantomBlink();
    triggerTeleportEffect('blink');
    triggerBlinkEffect(startPos, { x: targetX, y: targetY, z: targetZ });

    // Apply teleport
    ctx.position.x = targetX;
    ctx.position.y = targetY;
    ctx.position.z = targetZ;

    ctx.velocity.x = dx * 2;
    ctx.velocity.z = dz * 2;

    // Create void zone
    const voidZoneId = `local_void_${Date.now()}`;
    useGameStore.getState().addVoidZone({
      id: voidZoneId,
      position: { x: targetX, y: targetY - 0.9, z: targetZ },
      radius: 3,
      duration: 4,
      startTime: Date.now(),
      ownerId: ctx.localPlayer.id,
      ownerTeam: (ctx.localPlayer.team || 'red') as 'red' | 'blue',
    });

    return true;
  }, []);

  // Execute Shadow Step teleport (Q)
  const executeShadowStepTeleport = useCallback((
    ctx: AbilityContext,
    sounds: PlayerSounds,
    startClientCooldown: (id: string) => void,
    sendInput: (input: any) => void,
    updateLocalPlayer: (data: any) => void,
    camera: THREE.Camera
  ) => {
    if (teleportingRef.current) return;

    // Check cooldown
    const store = useGameStore.getState();
    const clientCooldowns = store.clientCooldowns || {};
    const cooldownEnd = clientCooldowns['phantom_shadowstep'];
    if (cooldownEnd && Date.now() < cooldownEnd) {
      store.setShadowStepTargeting(false, false);
      shadowStepTargetRef.current = null;
      shadowStepValidRef.current = false;
      return;
    }

    if (!shadowStepTargetRef.current || !shadowStepValidRef.current) {
      if (!shadowStepTargetRef.current) {
        store.setShadowStepTargeting(false, false);
      }
      return;
    }

    teleportingRef.current = true;

    const target = shadowStepTargetRef.current.clone();
    let teleportX = target.x;
    let teleportY = target.y + PLAYER_HEIGHT / 2 + 0.1;
    let teleportZ = target.z;

    // Check for walls
    const dx = teleportX - ctx.localPlayer.position.x;
    const dz = teleportZ - ctx.localPlayer.position.z;
    const distToTarget = Math.sqrt(dx * dx + dz * dz);
    const dirX = dx / distToTarget;
    const dirZ = dz / distToTarget;

    const playerFeetY = ctx.localPlayer.position.y - PLAYER_HEIGHT / 2;
    const elevationDiff = target.y - playerFeetY;
    const isElevatedTarget = elevationDiff > 0.3;

    let wallBlocking = false;

    if (!isElevatedTarget) {
      const checkHeights = [0.9, 1.5];
      for (const h of checkHeights) {
        const wallCheck = checkWallCollision(
          ctx.localPlayer.position.x,
          ctx.localPlayer.position.y - PLAYER_HEIGHT / 2 + h,
          ctx.localPlayer.position.z,
          dirX, dirZ, distToTarget
        );
        const normalY = Math.abs(wallCheck.normal.y);
        if (wallCheck.hit && wallCheck.distance < distToTarget - 1.5 && normalY < 0.5) {
          wallBlocking = true;
          break;
        }
      }
    }

    if (wallBlocking) {
      teleportingRef.current = false;
      store.setShadowStepTargeting(false, false);
      shadowStepTargetRef.current = null;
      shadowStepValidRef.current = false;
      return;
    }

    // Validate destination
    const validation = validateTeleportDestination(teleportX, teleportY, teleportZ, PLAYER_HEIGHT, PLAYER_RADIUS);

    if (!validation.valid && !isElevatedTarget) {
      teleportingRef.current = false;
      store.setShadowStepTargeting(false, false);
      shadowStepTargetRef.current = null;
      shadowStepValidRef.current = false;
      return;
    } else if (validation.adjustedPosition) {
      teleportX = validation.adjustedPosition.x;
      teleportY = validation.adjustedPosition.y;
      teleportZ = validation.adjustedPosition.z;
    }

    // Trigger effects
    triggerTeleportEffect('shadowstep');
    triggerShadowArrival({ x: teleportX, y: teleportY, z: teleportZ });
    sounds.playPhantomShadowStep();

    // Exit targeting mode
    store.setShadowStepTargeting(false, false);
    shadowStepTargetRef.current = null;
    shadowStepValidRef.current = false;

    // Update player position
    updateLocalPlayer({
      position: { x: teleportX, y: teleportY, z: teleportZ },
      velocity: { x: 0, y: 0, z: 0 },
    });

    camera.position.set(teleportX, teleportY + 0.6, teleportZ);

    // Start cooldown
    startClientCooldown('phantom_shadowstep');

    // Send to server
    sendInput({
      tick: 0,
      ability2: true,
      timestamp: Date.now(),
      position: { x: target.x, y: teleportY, z: target.z },
      velocity: { x: 0, y: 0, z: 0 },
    });

    setTimeout(() => {
      teleportingRef.current = false;
    }, 100);
  }, []);

  // Execute Phantom Veil (Ultimate)
  const executePhantomVeil = useCallback((
    _ctx: AbilityContext,
    sounds: PlayerSounds,
    updateLocalPlayer: (data: any) => void,
    setAbilityActive: (id: string, active: boolean) => void
  ) => {
    const duration = ABILITY_DEFINITIONS['phantom_veil']?.duration ?? 6;
    setAbilityActive('phantom_veil', true);
    updateLocalPlayer({ ultimateCharge: 0 });
    useGameStore.getState().setUltimateEffect(true, 'phantom_veil', Date.now() + duration * 1000);
    sounds.playPhantomVeil();
  }, []);

  // Handle Shadow Step target updates
  const handleShadowStepTargetUpdate = useCallback((position: THREE.Vector3 | null, isValid: boolean) => {
    shadowStepTargetRef.current = position;
    shadowStepValidRef.current = isValid;

    const store = useGameStore.getState();
    if (store.shadowStepTargeting && store.shadowStepValid !== isValid) {
      store.setShadowStepTargeting(true, isValid);
    }
  }, []);

  return {
    lastFireTimeRef,
    direBallIdRef,
    voidRayChargingRef,
    voidRayChargeStartRef,
    voidRayIdRef,
    shadowStepTargetRef,
    shadowStepValidRef,
    teleportingRef,
    fireDireBall,
    handleVoidRay,
    executeBlink,
    executeShadowStepTeleport,
    executePhantomVeil,
    handleShadowStepTargetUpdate,
  };
}


