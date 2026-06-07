/**
 * Glacier Hero Abilities Hook
 * 
 * Handles Glacier-specific abilities:
 * - Ice Mallet (primary fire - melee)
 * - Ice Shield (secondary fire - hold)
 * - Ice Wall Rush (E ability - hold)
 * - Ice Slide (Q ability)
 * - Frost Storm Shield (Ultimate)
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import {
  ICE_WALL_RUSH_SPEED,
  ICE_WALL_RUSH_FUEL_DRAIN,
  ICE_WALL_RUSH_FUEL_REGEN,
  ICE_WALL_RUSH_REGEN_DELAY,
  ICE_WALL_SEGMENT_INTERVAL,
  ICE_WALL_SEGMENT_HEIGHT,
  ICE_WALL_SEGMENT_WIDTH,
  FROST_STORM_SHIELD_AMOUNT,
  FROST_STORM_DURATION,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { checkGroundWithNormal } from '../../usePhysics';
import { triggerTerrainImpact } from '../../../components/game/TerrainImpactEffects';
import { getFrameClock } from '../../../utils/frameClock';
import {
  GLACIER_MALLET_SWING_INTERVAL,
  FUEL_UPDATE_THRESHOLD,
  PLAYER_HEIGHT,
  STEP_HEIGHT,
  TERRAIN_RAMP_DOWN_SMOOTH_SPEED,
  TERRAIN_RAMP_UP_SMOOTH_SPEED,
  calculateLookDirection,
  calculateHorizontalLookDirection,
} from '../constants';
import type { AbilityContext } from '../types';

export interface UseGlacierAbilitiesReturn {
  // State refs
  malletIdRef: React.MutableRefObject<number>;
  lastMalletTimeRef: React.MutableRefObject<number>;
  iceWallRushFuelRef: React.MutableRefObject<number>;
  iceWallRushActiveRef: React.MutableRefObject<boolean>;
  iceWallRushIdRef: React.MutableRefObject<number>;
  activeIceWallRushIdRef: React.MutableRefObject<string | null>;
  lastWallSegmentTimeRef: React.MutableRefObject<number>;
  lastFuelUpdateRef: React.MutableRefObject<number>;
  iceWallRushDeactivatedAtRef: React.MutableRefObject<number>;

  // Methods
  handleIceMalletSwing: (ctx: AbilityContext) => void;
  handleIceShield: (ctx: AbilityContext) => void;
  handleIceWallRush: (
    ctx: AbilityContext,
    smoothedY: React.MutableRefObject<number | null>,
    setIceWallRushActive: (active: boolean) => void,
    setIceWallRushFuel: (fuel: number) => void,
    addIceWallRush: (data: any) => void,
    updateIceWallRush: (id: string, data: any) => void
  ) => void;
  executeIceSlide: (ctx: AbilityContext, setAbilityActive: (id: string, active: boolean) => void) => void;
  executeFrostStormShield: (setAbilityActive: (id: string, active: boolean) => void) => void;
}

function smoothY(currentY: number, targetY: number, speed: number, dt: number): number {
  const t = 1 - Math.exp(-speed * dt);
  return currentY + (targetY - currentY) * t;
}

export function useGlacierAbilities(): UseGlacierAbilitiesReturn {
  // Ice Mallet state
  const malletIdRef = useRef(0);
  const lastMalletTimeRef = useRef(0);

  // Ice Wall Rush state
  const iceWallRushFuelRef = useRef(100);
  const iceWallRushActiveRef = useRef(false);
  const iceWallRushIdRef = useRef(0);
  const activeIceWallRushIdRef = useRef<string | null>(null);
  const lastWallSegmentTimeRef = useRef(0);
  const lastFuelUpdateRef = useRef(100);
  const iceWallRushDeactivatedAtRef = useRef(0);

  // Handle Ice Mallet swing (primary fire)
  const handleIceMalletSwing = useCallback((ctx: AbilityContext) => {
    const isShielding = ctx.inputState.secondaryFire;

    // Update swing held state (but not while shielding)
    useGameStore.getState().setGlacierSwingHeld(ctx.inputState.primaryFire && !isShielding);

    if (!ctx.inputState.primaryFire || isShielding) return;

    const now = Date.now();
    if (now - lastMalletTimeRef.current < GLACIER_MALLET_SWING_INTERVAL) return;

    lastMalletTimeRef.current = now;
    const direction = calculateLookDirection(ctx.yaw, ctx.pitch);

    malletIdRef.current++;
    const malletId = `mallet_${ctx.localPlayer.id}_${malletIdRef.current}`;
    const swingDirection = (malletIdRef.current % 2 === 1) ? 1 : -1;

    useGameStore.getState().addIceMalletSwing({
      id: malletId,
      position: { x: ctx.position.x, y: ctx.position.y, z: ctx.position.z },
      direction,
      startTime: now,
      ownerId: ctx.localPlayer.id,
      ownerTeam: (ctx.localPlayer.team || 'red') as 'red' | 'blue',
      hasHit: false,
      swingDirection: swingDirection as 1 | -1,
    });
  }, []);

  // Handle Ice Shield (secondary fire - hold)
  const handleIceShield = useCallback((ctx: AbilityContext) => {
    useGameStore.getState().setGlacierShieldActive(ctx.inputState.secondaryFire);
  }, []);

  // Handle Ice Wall Rush (E ability - hold)
  const handleIceWallRush = useCallback((
    ctx: AbilityContext,
    smoothedY: React.MutableRefObject<number | null>,
    setIceWallRushActive: (active: boolean) => void,
    setIceWallRushFuel: (fuel: number) => void,
    addIceWallRush: (data: any) => void,
    updateIceWallRush: (id: string, data: any) => void
  ) => {
    const now = Date.now();

    if (ctx.inputState.ability1 && iceWallRushFuelRef.current > 0) {
      const horizDir = calculateHorizontalLookDirection(ctx.yaw);
      const dirY = Math.sin(ctx.pitch) * 0.3;

      // Activate if not active
      if (!iceWallRushActiveRef.current) {
        iceWallRushActiveRef.current = true;
        setIceWallRushActive(true);

        iceWallRushIdRef.current++;
        const rushId = `icewall_${ctx.localPlayer.id}_${iceWallRushIdRef.current}`;
        activeIceWallRushIdRef.current = rushId;

        addIceWallRush({
          id: rushId,
          startPosition: { x: ctx.position.x, y: ctx.position.y, z: ctx.position.z },
          startTime: now,
          ownerId: ctx.localPlayer.id,
          ownerTeam: (ctx.localPlayer.team || 'red') as 'red' | 'blue',
          segments: [],
          isActive: true,
        });

        lastWallSegmentTimeRef.current = now;
        lastFuelUpdateRef.current = iceWallRushFuelRef.current;
      }

      // Apply propulsion
      ctx.velocity.x = horizDir.x * ICE_WALL_RUSH_SPEED;
      ctx.velocity.z = horizDir.z * ICE_WALL_RUSH_SPEED;

      // Ground-hugging for smooth stair climbing
      const lookAhead = ICE_WALL_RUSH_SPEED * ctx.dt * 3;
      const aheadX = ctx.position.x + horizDir.x * lookAhead;
      const aheadZ = ctx.position.z + horizDir.z * lookAhead;
      const groundAhead = checkGroundWithNormal(aheadX, ctx.position.y + STEP_HEIGHT + 1, aheadZ, STEP_HEIGHT + 3);

      if (groundAhead && groundAhead.isWalkable) {
        const currentFeetY = ctx.position.y - PLAYER_HEIGHT / 2;
        const targetGroundY = groundAhead.groundY;
        const heightDiff = targetGroundY - currentFeetY;

        if (heightDiff > 0.05 && heightDiff <= STEP_HEIGHT * 1.2) {
          const targetY = targetGroundY + PLAYER_HEIGHT / 2;
          smoothedY.current = smoothY(
            smoothedY.current ?? ctx.position.y,
            targetY,
            TERRAIN_RAMP_UP_SMOOTH_SPEED * 1.35,
            ctx.dt
          );
          ctx.position.y = targetY;
          ctx.velocity.y = 0;
        } else if (heightDiff < -0.1 && heightDiff > -STEP_HEIGHT) {
          const targetY = targetGroundY + PLAYER_HEIGHT / 2;
          smoothedY.current = smoothY(
            smoothedY.current ?? ctx.position.y,
            targetY,
            TERRAIN_RAMP_DOWN_SMOOTH_SPEED * 1.35,
            ctx.dt
          );
          ctx.position.y = targetY;
          ctx.velocity.y = 0;
        } else if (Math.abs(heightDiff) <= 0.05) {
          ctx.velocity.y = -1;
        }
      } else {
        ctx.velocity.y = Math.max(ctx.velocity.y + dirY * 5 * ctx.dt, dirY * ICE_WALL_RUSH_SPEED * 0.3);
      }

      // Create wall segments
      if (now - lastWallSegmentTimeRef.current >= ICE_WALL_SEGMENT_INTERVAL * 1000) {
        lastWallSegmentTimeRef.current = now;

        const behindDistance = 1.5;
        const segmentX = ctx.position.x + horizDir.x * -behindDistance;
        const segmentZ = ctx.position.z + horizDir.z * -behindDistance;
        const segmentY = ctx.position.y - 0.9;
        const wallRotation = ctx.yaw + Math.PI / 2;

        const newSegment = {
          position: { x: segmentX, y: segmentY, z: segmentZ },
          height: ICE_WALL_SEGMENT_HEIGHT,
          width: ICE_WALL_SEGMENT_WIDTH,
          rotation: wallRotation,
          createdAt: now,
          createdFrameAt: getFrameClock().nowMs,
        };

        triggerTerrainImpact('glacier_ice_wall', newSegment.position, {
          normal: { x: 0, y: 1, z: 0 },
          scale: 0.75,
        });

        if (activeIceWallRushIdRef.current) {
          const store = useGameStore.getState();
          const currentRush = store.iceWallRushes.find(r => r.id === activeIceWallRushIdRef.current);
          if (currentRush) {
            updateIceWallRush(activeIceWallRushIdRef.current, {
              segments: [...currentRush.segments, newSegment],
            });
          }
        }
      }

      // Consume fuel
      iceWallRushFuelRef.current -= ICE_WALL_RUSH_FUEL_DRAIN * ctx.dt;
      if (iceWallRushFuelRef.current <= 0) {
        iceWallRushFuelRef.current = 0;
        iceWallRushActiveRef.current = false;
        setIceWallRushActive(false);
        lastFuelUpdateRef.current = 0;
        iceWallRushDeactivatedAtRef.current = now;

        if (activeIceWallRushIdRef.current) {
          updateIceWallRush(activeIceWallRushIdRef.current, { isActive: false });
          activeIceWallRushIdRef.current = null;
        }
      }

      // Throttle fuel updates
      if (Math.abs(iceWallRushFuelRef.current - lastFuelUpdateRef.current) >= FUEL_UPDATE_THRESHOLD) {
        lastFuelUpdateRef.current = iceWallRushFuelRef.current;
        setIceWallRushFuel(iceWallRushFuelRef.current);
      }
    } else {
      // Deactivate
      if (iceWallRushActiveRef.current) {
        iceWallRushActiveRef.current = false;
        setIceWallRushActive(false);
        iceWallRushDeactivatedAtRef.current = now;

        if (activeIceWallRushIdRef.current) {
          updateIceWallRush(activeIceWallRushIdRef.current, { isActive: false });
          activeIceWallRushIdRef.current = null;
        }
      }

      // Regenerate fuel when grounded (with delay)
      const timeSinceDeactivation = now - iceWallRushDeactivatedAtRef.current;
      if (ctx.isGrounded && iceWallRushFuelRef.current < 100 && timeSinceDeactivation >= ICE_WALL_RUSH_REGEN_DELAY) {
        iceWallRushFuelRef.current = Math.min(100, iceWallRushFuelRef.current + ICE_WALL_RUSH_FUEL_REGEN * ctx.dt);

        if (Math.abs(iceWallRushFuelRef.current - lastFuelUpdateRef.current) >= FUEL_UPDATE_THRESHOLD) {
          lastFuelUpdateRef.current = iceWallRushFuelRef.current;
          setIceWallRushFuel(iceWallRushFuelRef.current);
        }
      }
    }
  }, []);

  // Execute Ice Slide (Q ability)
  const executeIceSlide = useCallback((
    ctx: AbilityContext,
    setAbilityActive: (id: string, active: boolean) => void
  ) => {
    const boost = 15;
    ctx.velocity.x = -Math.sin(ctx.yaw) * boost;
    ctx.velocity.z = -Math.cos(ctx.yaw) * boost;
    setAbilityActive('glacier_iceslide', true);
  }, []);

  // Execute Frost Storm Shield (Ultimate)
  const executeFrostStormShield = useCallback((
    setAbilityActive: (id: string, active: boolean) => void
  ) => {
    const store = useGameStore.getState();
    store.setFrostStormActive(true);
    setAbilityActive('glacier_frostshield', true);

    // Auto-deactivate after duration
    setTimeout(() => {
      const currentStore = useGameStore.getState();
      if (currentStore.frostStormActive) {
        currentStore.setFrostStormActive(false);
        setAbilityActive('glacier_frostshield', false);
      }
    }, FROST_STORM_DURATION * 1000);
  }, []);

  return {
    malletIdRef,
    lastMalletTimeRef,
    iceWallRushFuelRef,
    iceWallRushActiveRef,
    iceWallRushIdRef,
    activeIceWallRushIdRef,
    lastWallSegmentTimeRef,
    lastFuelUpdateRef,
    iceWallRushDeactivatedAtRef,
    handleIceMalletSwing,
    handleIceShield,
    handleIceWallRush,
    executeIceSlide,
    executeFrostStormShield,
  };
}
