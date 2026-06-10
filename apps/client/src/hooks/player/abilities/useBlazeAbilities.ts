/**
 * Blaze Hero Abilities Hook
 * 
 * Handles Blaze-specific abilities:
 * - Fireballs (primary fire)
 * - Meteor Strike (secondary fire - targeting)
 * - Flamethrower (E ability - hold)
 * - Rocket Jump (Q ability)
 * - Infernal Gearstorm (Ultimate - hero-centered AOE)
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import {
  BLAZE_FLAMETHROWER_MAX_FUEL,
  BLAZE_FLAMETHROWER_SOCKET_FORWARD_OFFSET,
  BLAZE_FLAMETHROWER_SOCKET_HAND_HEIGHT,
  BLAZE_FLAMETHROWER_SOCKET_SIDE_OFFSET,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import {
  BLAZE_ROCKET_FIRE_INTERVAL,
  BLAZE_ROCKET_SPEED,
  BLAZE_BOMB_COOLDOWN,
  calculatePlayerSocketPosition,
  calculateLookDirection,
} from '../constants';
import { getLocalChronosTimebreakTempoMultiplier } from '../chronosTimebreakTempo';
import { setFlamethrowerVisualPose } from '../../../store/visualStore';
import {
  BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
  clearBlazeRocketJumpStaffSlam,
  getBlazeFlamethrowerHeldBlend,
  setBlazeFlamethrowerHeld,
  setBlazeBombTargetHeld,
  triggerBlazeStaffShockwave,
  triggerBlazeRocketJumpStaffSlam,
  type BlazeRocketStaffPoseSampleContext,
} from '../../../viewmodel/blazePose';
import {
  sampleViewmodelPose,
  type ViewmodelSocketPose,
} from '../../../viewmodel/viewmodelSocketRegistry';
import type { AbilityContext, PlayerSounds } from '../types';
import { markPredictedLocalAbilityVisual } from '../useLocalAbilityVisualPrediction';

const BLAZE_FLAMETHROWER_SOCKET = {
  handHeight: BLAZE_FLAMETHROWER_SOCKET_HAND_HEIGHT,
  forwardOffset: BLAZE_FLAMETHROWER_SOCKET_FORWARD_OFFSET,
  sideOffset: BLAZE_FLAMETHROWER_SOCKET_SIDE_OFFSET,
};
const BLAZE_ROCKET_STAFF_SOCKET = {
  handHeight: 0.24,
  forwardOffset: 0.64,
  sideOffset: 0.22,
};

function vectorToPlainPosition(vector: THREE.Vector3): { x: number; y: number; z: number } {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}

function sampleBlazeStaffTipPose(
  ctx: AbilityContext,
  nowMs: number,
  holdBlend: number
): ViewmodelSocketPose | null {
  if (!ctx.camera) return null;

  ctx.camera.updateMatrixWorld();

  return sampleViewmodelPose<BlazeRocketStaffPoseSampleContext>(
    BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
    {
      camera: ctx.camera,
      elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
      holdBlend,
      timestampMs: ctx.viewmodelNowMs ?? nowMs,
    }
  );
}

function calculateBlazeFlamethrowerPose(
  ctx: AbilityContext,
  originOverride?: { x: number; y: number; z: number }
) {
  return {
    origin: originOverride ?? calculatePlayerSocketPosition(ctx.position, ctx.yaw, BLAZE_FLAMETHROWER_SOCKET),
    direction: calculateLookDirection(ctx.yaw, ctx.pitch),
  };
}

export interface UseBlazeAbilitiesReturn {
  // State refs
  lastBombTimeRef: React.MutableRefObject<number>;
  lastRocketTimeRef: React.MutableRefObject<number>;
  rocketIdRef: React.MutableRefObject<number>;
  bombTargetRef: React.MutableRefObject<THREE.Vector3 | null>;
  bombValidRef: React.MutableRefObject<boolean>;
  flamethrowerFuelRef: React.MutableRefObject<number>;
  flamethrowerActiveRef: React.MutableRefObject<boolean>;
  airStrikeTargetRef: React.MutableRefObject<THREE.Vector3 | null>;
  airStrikeValidRef: React.MutableRefObject<boolean>;
  secondaryFirePressedRef: React.MutableRefObject<boolean>;
  pendingRocketJumpRef: React.MutableRefObject<PendingRocketJump | null>;

  // Methods
  handleBombTargeting: (ctx: AbilityContext, sounds: PlayerSounds) => void;
  fireRocket: (ctx: AbilityContext) => void;
  executeBombDrop: (sounds: PlayerSounds) => void;
  handleFlamethrower: (
    ctx: AbilityContext,
    sounds: PlayerSounds,
    setFlamethrowerActive: (active: boolean) => void,
    setFlamethrowerFuel: (fuel: number) => void
  ) => void;
  executeRocketJump: (ctx: AbilityContext) => void;
  updateRocketJump: (ctx: AbilityContext, sounds: PlayerSounds) => void;
  resetRocketJump: () => void;
  executeAirStrike: (
    ctx: AbilityContext,
    sounds: PlayerSounds,
    updateLocalPlayer: (data: any) => void
  ) => void;
  handleBombTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
  handleAirStrikeTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

interface PendingRocketJump {
  ownerId: string;
  activateAtMs: number;
}

export function useBlazeAbilities(): UseBlazeAbilitiesReturn {
  const lastRocketTimeRef = useRef(0);
  const rocketIdRef = useRef(0);

  // Meteor Strike state
  const lastBombTimeRef = useRef(0);
  const bombTargetRef = useRef<THREE.Vector3 | null>(null);
  const bombValidRef = useRef(false);
  const secondaryFirePressedRef = useRef(false);

  // Flamethrower state
  const flamethrowerFuelRef = useRef(BLAZE_FLAMETHROWER_MAX_FUEL);
  const flamethrowerActiveRef = useRef(false);
  const pendingRocketJumpRef = useRef<PendingRocketJump | null>(null);

  // Legacy targeting refs kept so stale target state can be cleared safely.
  const airStrikeTargetRef = useRef<THREE.Vector3 | null>(null);
  const airStrikeValidRef = useRef(false);

  // Handle Meteor Strike targeting mode
  const handleBombTargeting = useCallback((ctx: AbilityContext, sounds: PlayerSounds) => {
    const store = useGameStore.getState();
    const bombTargeting = store.bombTargeting;
    const now = Date.now();
    const timestampMs = ctx.viewmodelNowMs ?? now;
    const isHoldingSecondary = ctx.inputState.secondaryFire;
    const wasHoldingSecondary = secondaryFirePressedRef.current;

    if (isHoldingSecondary) {
      if (!bombTargeting) {
        const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
        if (now - lastBombTimeRef.current >= BLAZE_BOMB_COOLDOWN / tempoMultiplier) {
          store.setBombTargeting(true);
          setBlazeBombTargetHeld(true, timestampMs);
          sounds.playBlazeBombTarget();
        } else {
          setBlazeBombTargetHeld(false, timestampMs);
        }
      } else {
        setBlazeBombTargetHeld(true, timestampMs);
      }
    } else if (wasHoldingSecondary) {
      if (bombTargeting) {
        if (bombValidRef.current && bombTargetRef.current) {
          executeBombDrop(sounds);
        } else {
          store.setBombTargeting(false, false);
          bombTargetRef.current = null;
          bombValidRef.current = false;
          setBlazeBombTargetHeld(false, timestampMs);
        }
      } else {
        setBlazeBombTargetHeld(false, timestampMs);
      }
    } else if (!bombTargeting) {
      setBlazeBombTargetHeld(false, timestampMs);
    }

    secondaryFirePressedRef.current = isHoldingSecondary;
  }, []);

  const fireRocket = useCallback((ctx: AbilityContext) => {
    if (!ctx.inputState.primaryFire) return;
    if (useGameStore.getState().bombTargeting) return;

    const now = Date.now();
    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    if (now - lastRocketTimeRef.current < BLAZE_ROCKET_FIRE_INTERVAL / tempoMultiplier) return;

    lastRocketTimeRef.current = now;
    rocketIdRef.current += 1;
    const direction = calculateLookDirection(ctx.yaw, ctx.pitch);
    const holdBlend = 1;
    const staffTipPose = sampleBlazeStaffTipPose(ctx, now, holdBlend);
    const startPosition = staffTipPose
      ? vectorToPlainPosition(staffTipPose.position)
      : calculatePlayerSocketPosition(ctx.position, ctx.yaw, BLAZE_ROCKET_STAFF_SOCKET);
    const visualId = `predicted_blaze_rocket_${ctx.localPlayer.id}_${rocketIdRef.current}`;

    useGameStore.getState().addRocket({
      id: visualId,
      position: startPosition,
      velocity: {
        x: direction.x * BLAZE_ROCKET_SPEED,
        y: direction.y * BLAZE_ROCKET_SPEED,
        z: direction.z * BLAZE_ROCKET_SPEED,
      },
      startTime: now,
      ownerId: ctx.localPlayer.id,
      ownerTeam: (ctx.localPlayer.team || 'red') as 'red' | 'blue',
    });
    markPredictedLocalAbilityVisual('blaze_rocket', ctx.localPlayer.id, visualId, { now });
  }, []);

  // Execute Meteor Strike
  const executeBombDrop = useCallback((_sounds: PlayerSounds) => {
    if (!bombTargetRef.current || !bombValidRef.current) return;

    const now = Date.now();
    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    if (now - lastBombTimeRef.current < BLAZE_BOMB_COOLDOWN / tempoMultiplier) return;

    triggerBlazeStaffShockwave(now);

    lastBombTimeRef.current = now;

    // Exit targeting mode
    useGameStore.getState().setBombTargeting(false, false);
    bombTargetRef.current = null;
    bombValidRef.current = false;
    setBlazeBombTargetHeld(false, now);
  }, []);

  // Handle flamethrower (E ability - hold)
  const handleFlamethrower = useCallback((
    ctx: AbilityContext,
    sounds: PlayerSounds,
    setFlamethrowerActive: (active: boolean) => void,
    setFlamethrowerFuel: (fuel: number) => void
  ) => {
    const now = Date.now();
    const timestampMs = ctx.viewmodelNowMs ?? now;
    const localPlayer = useGameStore.getState().localPlayer;
    const serverFuel = localPlayer?.heroId === 'blaze'
      ? (localPlayer.movement?.jetpackFuel ?? BLAZE_FLAMETHROWER_MAX_FUEL)
      : BLAZE_FLAMETHROWER_MAX_FUEL;
    const serverActive = Boolean(
      localPlayer?.heroId === 'blaze' &&
      localPlayer.state === 'alive' &&
      localPlayer.movement?.isJetpacking &&
      serverFuel > 0
    );
    const isHoldingFlamethrower = ctx.inputState.ability1 && serverFuel > 0;
    const shouldPlayLocalFlamethrowerSound = isHoldingFlamethrower;

    flamethrowerFuelRef.current = serverFuel;
    setFlamethrowerFuel(serverFuel);
    setBlazeFlamethrowerHeld(isHoldingFlamethrower || serverActive, timestampMs);

    if (shouldPlayLocalFlamethrowerSound && !flamethrowerActiveRef.current) {
      flamethrowerActiveRef.current = true;
      sounds.startFlamethrowerSound();
    } else if (!shouldPlayLocalFlamethrowerSound && flamethrowerActiveRef.current) {
      flamethrowerActiveRef.current = false;
      sounds.stopFlamethrowerSound();
    }

    if (serverActive) {
      setFlamethrowerActive(true);

      const holdBlend = getBlazeFlamethrowerHeldBlend(timestampMs);
      const staffTipPose = sampleBlazeStaffTipPose(ctx, now, holdBlend);
      const staffTipOrigin = staffTipPose ? vectorToPlainPosition(staffTipPose.position) : undefined;
      const { origin, direction } = calculateBlazeFlamethrowerPose(ctx, staffTipOrigin);
      setFlamethrowerVisualPose(origin, direction);
    } else {
      setFlamethrowerActive(false);
      setFlamethrowerVisualPose(null, { x: 0, y: 0, z: -1 });
    }
  }, []);

  const applyRocketJump = useCallback((_ctx: AbilityContext, _sounds: PlayerSounds) => {
    // Server-confirmed blaze_rocketjump events own movement, explosion, and sound.
  }, []);

  // Execute Rocket Jump (Q ability)
  const executeRocketJump = useCallback((ctx: AbilityContext) => {
    const now = Date.now();
    triggerBlazeRocketJumpStaffSlam(now);
    markPredictedLocalAbilityVisual('blaze_rocketjump', ctx.localPlayer.id, `predicted_blaze_rocketjump_${ctx.localPlayer.id}_${now}`, {
      now,
    });
    pendingRocketJumpRef.current = null;
  }, []);

  const updateRocketJump = useCallback((ctx: AbilityContext, sounds: PlayerSounds) => {
    const pendingRocketJump = pendingRocketJumpRef.current;
    if (!pendingRocketJump) return;

    if (ctx.heroId !== 'blaze' || ctx.localPlayer.id !== pendingRocketJump.ownerId) {
      pendingRocketJumpRef.current = null;
      clearBlazeRocketJumpStaffSlam();
      return;
    }

    if (Date.now() < pendingRocketJump.activateAtMs) return;

    pendingRocketJumpRef.current = null;
    applyRocketJump(ctx, sounds);
  }, [applyRocketJump]);

  const resetRocketJump = useCallback(() => {
    pendingRocketJumpRef.current = null;
    clearBlazeRocketJumpStaffSlam();
  }, []);

  // Execute Infernal Gearstorm (Ultimate)
  const executeAirStrike = useCallback((
    ctx: AbilityContext,
    _sounds: PlayerSounds,
    _updateLocalPlayer: (data: any) => void
  ) => {
    const localPlayer = useGameStore.getState().localPlayer;
    if (!localPlayer || (localPlayer.ultimateCharge ?? 0) < 100) return;

    // Clear any stale target state from older targeting flows.
    useGameStore.getState().setAirStrikeTargeting(false, false);
    airStrikeTargetRef.current = null;
    airStrikeValidRef.current = false;
  }, []);

  // Handle bomb target updates
  const handleBombTargetUpdate = useCallback((position: THREE.Vector3 | null, isValid: boolean) => {
    bombTargetRef.current = position;
    bombValidRef.current = isValid;

    const store = useGameStore.getState();
    if (store.bombTargeting && store.bombTargetValid !== isValid) {
      store.setBombTargeting(true, isValid);
    }
  }, []);

  // Legacy target update hook for the removed targeted ultimate flow.
  const handleAirStrikeTargetUpdate = useCallback((position: THREE.Vector3 | null, isValid: boolean) => {
    airStrikeTargetRef.current = position;
    airStrikeValidRef.current = isValid;

    const store = useGameStore.getState();
    if (store.airStrikeTargeting && store.airStrikeTargetValid !== isValid) {
      store.setAirStrikeTargeting(true, isValid);
    }
  }, []);

  return {
    lastRocketTimeRef,
    rocketIdRef,
    lastBombTimeRef,
    bombTargetRef,
    bombValidRef,
    flamethrowerFuelRef,
    flamethrowerActiveRef,
    airStrikeTargetRef,
    airStrikeValidRef,
    secondaryFirePressedRef,
    pendingRocketJumpRef,
    handleBombTargeting,
    fireRocket,
    executeBombDrop,
    handleFlamethrower,
    executeRocketJump,
    updateRocketJump,
    resetRocketJump,
    executeAirStrike,
    handleBombTargetUpdate,
    handleAirStrikeTargetUpdate,
  };
}
