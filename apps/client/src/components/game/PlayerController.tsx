/**
 * PlayerController - Refactored
 *
 * Main player controller that orchestrates movement, camera, physics, and abilities.
 * Logic has been extracted into specialized hooks for better maintainability.
 *
 * @see hooks/player/useCamera.ts - Camera control and mouse look
 * @see hooks/player/useMovement.ts - Development fly helpers and movement-facing refs
 * @see hooks/player/useAbilitySystem.ts - Cooldowns and charge management
 * @see movement/localPrediction.ts - Shared capsule motor prediction
 * @see hooks/player/abilities/ - Hero-specific ability handlers
 */

import { useRef, useEffect, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import {
  consumeLocalPlayerImpulses,
  visualStore,
  setChronosAegisVisualState,
  setLocalViewmodelMovement,
  setLocalSlideIntensity,
  setLocalVisualMovement,
  setPlayerVisualTransform,
  setFlamethrowerVisualPose,
} from '../../store/visualStore';
import { useInput } from '../../hooks/useInput';
import { usePhysics } from '../../hooks/usePhysics';
import { useNetwork } from '../../contexts/NetworkContext';
import { setAudioListenerTransform, useAbilitySounds, useMovementSounds } from '../../hooks/useAudio';
import {
  PHANTOM_PRIMARY_RETURN_TO_IDLE_MS,
  PHANTOM_PRIMARY_SHOT_PULSE_DURATION_MS,
  PHANTOM_VOID_RAY_RELEASE_LOCK_MS,
  setPhantomPrimaryHeld,
} from '../../viewmodel/phantomPrimaryPose';
import {
  BLAZE_STAFF_RETURN_TO_IDLE_MS,
  setBlazeBombTargetHeld,
  setBlazeFlamethrowerHeld,
  setBlazeRocketHeld,
} from '../../viewmodel/blazePose';
import {
  CHRONOS_ASCENDANT_CAST_LOCK_MS,
  CHRONOS_LIFELINE_POSE_DURATION_MS,
  CHRONOS_PRIMARY_RETURN_TO_IDLE_MS,
  CHRONOS_PRIMARY_SHOT_GLOW_DURATION_MS,
  CHRONOS_TIMEBREAK_POSE_DURATION_MS,
  setChronosPrimaryHeld,
} from '../../viewmodel/chronosPose';
import {
  HOOKSHOT_PRIMARY_RECOIL_DURATION_MS,
  HOOKSHOT_SECONDARY_POSE_DURATION_MS,
} from '../../viewmodel/hookshotPose';
import {
  defaultViewmodelPoseRuntime,
  resetViewmodelPoseRuntime,
} from '../../viewmodel/viewmodelPoseRuntime';
import {
  useCamera,
  useMovement,
  useAbilitySystem,
  usePhantomAbilities,
  useBlazeAbilities,
  useHookshotAbilities,
  useChronosAbilities,
  PLAYER_HEIGHT,
  EYE_HEIGHT,
} from '../../hooks/player';
import { getFrameClock } from '../../utils/frameClock';
import { useLocalAbilityAudioPrediction } from '../../hooks/player/useLocalAbilityAudioPrediction';
import { buildAbilityCastOriginHints } from '../../hooks/player/abilityCastOriginHints';
import {
  ABILITY_DEFINITIONS,
  CHRONOS_LIFELINE_RADIUS,
  CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
  MOVEMENT_MAX_PACKET_COMMANDS,
  MOVEMENT_SUBSTEP_SECONDS,
  TICK_RATE,
  createEmptyInputState,
  getHeroStats,
  HERO_DEFINITIONS,
  type HeroId,
  type MatchMode,
  type AbilityCastOriginHint,
  type InputState,
  type MovementCommand,
  type MovementCorrectionReason,
  type PlayerMovementState,
} from '@voxel-strike/shared';
import { recordMovementTraceFrame } from '../../anticheat/movementTraceRecorder';
import {
  addLocalMovementImpulse,
  confirmLocalMovementTransform,
  createLocalMovementCommand,
  createMovementCommandPacket,
  drainSelfMovementAuthorities,
  ensureLocalPredictionInitialized,
  getCurrentPredictedState,
  getCurrentPredictedVisualPosition,
  getLocalMovementCollisionRevision,
  movementStateFromPlayer,
  predictLocalBlazeRocketJump,
  predictLocalPhantomBlink,
  stepLocalMovementPrediction,
} from '../../movement/localPrediction';
import {
  recordAuthorityFrameApplied,
  recordLocalReactiveUpdate,
  recordMovementCommandGenerated,
  recordMovementCommandsSent,
} from '../../movement/networkDiagnostics';

// Component imports for targeting indicators
import { BombTargetingIndicator, triggerAirStrike, triggerRocketJumpExplosion } from './BlazeEffects';
import { GrappleTrapTargetingIndicator } from './HookshotEffects';
import { triggerBlinkEffect } from './PhantomEffects';
import { addChronosLifelineEffects } from './chronos/lifeline';
import { addChronosTimebreakEffect } from './chronos/timebreak';
import { triggerTeleportEffect } from '../ui/TeleportEffects';

const INACTIVE_INPUT_STATE = createEmptyInputState();
const DEFAULT_FLAMETHROWER_DIRECTION = { x: 0, y: 0, z: -1 };
const PRACTICE_VOID_ZONE_RADIUS = 3;
const PRACTICE_VOID_ZONE_DURATION_SECONDS = 4;
const TERRAIN_STEP_VISUAL_SNAP_THRESHOLD = 1.35;
const TERRAIN_STEP_VISUAL_UP_RATE = 16;
const TERRAIN_STEP_VISUAL_DOWN_RATE = 28;
const TERRAIN_STEP_VISUAL_MAX_RISE_SPEED = 3.2;
const TERRAIN_STEP_VISUAL_MAX_DROP_SPEED = 6.5;
const MOVEMENT_COMMAND_TARGET_PACKET_SIZE = 3;
const MOVEMENT_COMMAND_MAX_FLUSH_AGE_MS = 1000 / TICK_RATE;
const INACTIVE_LOCAL_MOVEMENT: PlayerMovementState = {
  isGrounded: true,
  isSprinting: false,
  isCrouching: false,
  isSliding: false,
  slideTimeRemaining: 0,
  isWallRunning: false,
  wallRunSide: null,
  isGrappling: false,
  grapplePoint: null,
  isJetpacking: false,
  jetpackFuel: 0,
  isGliding: false,
};

function frameRateBand(deltaSeconds: number): string {
  if (deltaSeconds <= 1 / 90) return '90fps+';
  if (deltaSeconds <= 1 / 45) return '45-90fps';
  if (deltaSeconds <= 1 / 30) return '30-45fps';
  return 'sub30fps';
}

function pingBandMs(ping: number | null | undefined): string {
  if (ping === null || ping === undefined) return 'unknown';
  if (ping <= 50) return '0-50';
  if (ping <= 100) return '51-100';
  if (ping <= 180) return '101-180';
  return '181+';
}

function smoothTerrainVisualY(
  previousY: number | null,
  targetY: number,
  dt: number,
  isGrounded: boolean
): number {
  if (previousY === null || !Number.isFinite(previousY) || !Number.isFinite(targetY)) {
    return targetY;
  }

  const delta = targetY - previousY;
  if (!isGrounded || Math.abs(delta) <= 0.001 || Math.abs(delta) > TERRAIN_STEP_VISUAL_SNAP_THRESHOLD) {
    return targetY;
  }

  if (delta > 0) {
    const rise = Math.min(
      delta * (1 - Math.exp(-TERRAIN_STEP_VISUAL_UP_RATE * dt)),
      TERRAIN_STEP_VISUAL_MAX_RISE_SPEED * dt
    );
    return previousY + Math.max(0.001, rise);
  }

  const drop = Math.max(
    delta * (1 - Math.exp(-TERRAIN_STEP_VISUAL_DOWN_RATE * dt)),
    -TERRAIN_STEP_VISUAL_MAX_DROP_SPEED * dt
  );
  return previousY + Math.min(-0.001, drop);
}

function resolveTraceMatchMode(): MatchMode {
  const store = useGameStore.getState();
  return store.matchmakingStatus.matchMode ??
    store.currentLobbyWager.matchMode ??
    (store.currentLobbyWager.enabled ? 'custom_wager' : 'custom');
}

function writeActiveAbilityIdsForTrace(
  playerAbilities: Record<string, { isActive?: boolean }> | undefined,
  target: string[]
): string[] {
  target.length = 0;
  if (!playerAbilities) return target;

  for (const abilityId in playerAbilities) {
    if (playerAbilities[abilityId]?.isActive) {
      target.push(abilityId);
    }
  }
  target.sort();
  return target;
}

function pushUniqueTraceAbilityId(target: string[], abilityId: string | undefined): void {
  if (!abilityId || target.includes(abilityId)) return;
  target.push(abilityId);
}

function buildPracticeAbilityState(
  existingAbilities: Record<string, { charges?: number; cooldownRemaining?: number }> | undefined,
  abilityId: string,
  now: number,
  isActive: boolean
) {
  const abilityDef = ABILITY_DEFINITIONS[abilityId];
  const existingAbility = existingAbilities?.[abilityId];

  return {
    abilityId,
    cooldownRemaining: abilityDef?.cooldown ?? existingAbility?.cooldownRemaining ?? 0,
    charges: existingAbility?.charges ?? abilityDef?.charges ?? 1,
    isActive,
    activatedAt: now,
  };
}

type CastActionFields = Pick<InputState, 'primaryFire' | 'secondaryFire' | 'ability1' | 'ability2' | 'ultimate'>;
type ExclusiveHoldInput = Pick<InputState, 'primaryFire' | 'secondaryFire' | 'ability1'>;

const EMPTY_EXCLUSIVE_HOLD_INPUT: ExclusiveHoldInput = {
  primaryFire: false,
  secondaryFire: false,
  ability1: false,
};

function withCastActionFields(input: InputState, actions: Partial<CastActionFields> = {}): InputState {
  const primaryFire = actions.primaryFire ?? false;
  const secondaryFire = actions.secondaryFire ?? false;
  const ability1 = actions.ability1 ?? false;
  const ability2 = actions.ability2 ?? false;
  const ultimate = actions.ultimate ?? false;

  if (
    input.primaryFire === primaryFire &&
    input.secondaryFire === secondaryFire &&
    input.ability1 === ability1 &&
    input.ability2 === ability2 &&
    input.ultimate === ultimate
  ) {
    return input;
  }

  return {
    ...input,
    primaryFire,
    secondaryFire,
    ability1,
    ability2,
    ultimate,
  };
}

function getExclusiveHeroInput(
  heroId: HeroId,
  input: InputState,
  isActionLocked: boolean,
  isBombTargeting: boolean,
  continuingHoldInput: Partial<CastActionFields> | null = null,
  lockedAllowedInput: Partial<CastActionFields> | null = null
): InputState {
  if (isActionLocked) {
    return withCastActionFields(input, lockedAllowedInput ?? {});
  }

  if (isBombTargeting) {
    return withCastActionFields(input, { secondaryFire: input.secondaryFire });
  }

  if (continuingHoldInput) {
    return withCastActionFields(input, continuingHoldInput);
  }

  if (input.primaryFire) {
    return withCastActionFields(input, { primaryFire: true });
  }

  if (heroId === 'chronos' && input.secondaryFire && input.ability1) {
    return withCastActionFields(input, { secondaryFire: true, ability1: true });
  }

  if (input.secondaryFire) {
    return withCastActionFields(input, { secondaryFire: true });
  }

  if (input.ability1) {
    return withCastActionFields(input, { ability1: true });
  }

  if (input.ability2) {
    return withCastActionFields(input, { ability2: true });
  }

  if (input.ultimate) {
    return withCastActionFields(input, { ultimate: true });
  }

  return withCastActionFields(input);
}

function getContinuingHeroHoldInput(
  heroId: HeroId,
  input: InputState,
  previousInput: ExclusiveHoldInput
): Partial<CastActionFields> | null {
  if (previousInput.primaryFire && input.primaryFire) {
    return { primaryFire: true };
  }

  if (previousInput.secondaryFire && input.secondaryFire) {
    if (heroId === 'chronos' && input.ability1) {
      return { secondaryFire: true, ability1: true };
    }

    return { secondaryFire: true };
  }

  if (heroId === 'blaze' && previousInput.ability1 && input.ability1) {
    return { ability1: true };
  }

  return null;
}

function getExclusiveHoldInput(input: InputState): ExclusiveHoldInput {
  return {
    primaryFire: input.primaryFire,
    secondaryFire: input.secondaryFire,
    ability1: input.ability1,
  };
}

function getPrimaryReleaseLockMs(heroId: HeroId): number {
  switch (heroId) {
    case 'phantom':
      return Math.max(PHANTOM_PRIMARY_RETURN_TO_IDLE_MS, PHANTOM_PRIMARY_SHOT_PULSE_DURATION_MS);
    case 'blaze':
      return BLAZE_STAFF_RETURN_TO_IDLE_MS;
    case 'chronos':
      return Math.max(CHRONOS_PRIMARY_RETURN_TO_IDLE_MS, CHRONOS_PRIMARY_SHOT_GLOW_DURATION_MS);
    case 'hookshot':
      return 0;
  }

  return 0;
}

function getSecondaryReleaseLockMs(heroId: HeroId, didReleaseChargedVoidRay: boolean): number {
  switch (heroId) {
    case 'phantom':
      return didReleaseChargedVoidRay
        ? PHANTOM_VOID_RAY_RELEASE_LOCK_MS
        : PHANTOM_PRIMARY_RETURN_TO_IDLE_MS;
    case 'blaze':
      return BLAZE_STAFF_RETURN_TO_IDLE_MS;
    case 'chronos':
      return CHRONOS_PRIMARY_RETURN_TO_IDLE_MS;
    case 'hookshot':
      return 0;
  }

  return 0;
}

function getAbility1ReleaseLockMs(heroId: HeroId): number {
  return heroId === 'blaze' ? BLAZE_STAFF_RETURN_TO_IDLE_MS : 0;
}

function movementClassForTrace(input: {
  heroId: HeroId;
  movement: PlayerMovementState;
  inputState: typeof INACTIVE_INPUT_STATE;
  unstuck: boolean;
  flagCarrier: boolean;
}): string {
  if (input.movement.isSliding) return 'slide';
  if (input.heroId === 'blaze' && input.inputState.ability2) return 'rocket_jump';
  if (input.heroId === 'phantom' && input.inputState.ability1) return 'blink';
  if (input.heroId === 'hookshot' && (input.inputState.ability1 || input.movement.isGrappling)) return 'grapple';
  if (input.heroId === 'hookshot' && input.inputState.ultimate) return 'grapple_trap';
  if (input.unstuck) return 'unstuck';
  if (input.flagCarrier) return 'flag_route';
  return 'baseline';
}

// ============================================================================
// PLAYER CONTROLLER COMPONENT
// ============================================================================

interface PlayerControllerProps {
  enabled?: boolean;
}

export function PlayerController({ enabled = true }: PlayerControllerProps) {
  const { camera } = useThree();

  // Store state and actions
  const updateLocalPlayer = useGameStore(state => state.updateLocalPlayer);
  const setShadowStepTargeting = useGameStore(state => state.setShadowStepTargeting);
  const setBombTargeting = useGameStore(state => state.setBombTargeting);
  const bombTargeting = useGameStore(state => state.bombTargeting);
  const setAirStrikeTargeting = useGameStore(state => state.setAirStrikeTargeting);
  const setFlamethrowerActive = useGameStore(state => state.setFlamethrowerActive);
  const setFlamethrowerFuel = useGameStore(state => state.setFlamethrowerFuel);
  const gamePhase = useGameStore(state => state.gamePhase);
  const shadowStepTargeting = useGameStore(state => state.shadowStepTargeting);
  const grappleTrapTargeting = useGameStore(state => state.grappleTrapTargeting);
  const setGrappleTrapTargeting = useGameStore(state => state.setGrappleTrapTargeting);
  const localPlayerForInit = useGameStore(state => state.localPlayer);
  const isPracticeMode = useGameStore(state => state.isPracticeMode);

  // Input and network
  const { inputState, isPointerLocked, isControlPressed, isTouchInputActive, requestPointerLock, exitPointerLock } = useInput();
  usePhysics();
  const { sendMovementCommands, requestBlazeBombDrop } = useNetwork();

  // Audio hooks
  const {
    playPhantomBlink, playPhantomShadowStep, playPhantomVeil, playPhantomBasic, playPhantomVoidRay,
    startPhantomVoidRayCharge, stopPhantomVoidRayCharge,
    playBlazeRocket, playBlazeBombTarget, playBlazeBombRelease, playBlazeBombFall, playBlazeBombExplode, playBlazeRocketJump, playBlazeAirstrike,
    startFlamethrowerSound, stopFlamethrowerSound,
  } = useAbilitySounds();
  const { updateWalkingSound, preloadWalkingSound } = useMovementSounds();

  // Player hooks
  const cameraControl = useCamera({ isPointerLocked });
  const movement = useMovement();
  const abilitySystem = useAbilitySystem();

  // Hero ability hooks
  const phantomAbilities = usePhantomAbilities();
  const blazeAbilities = useBlazeAbilities();
  const hookshotAbilities = useHookshotAbilities();
  const chronosAbilities = useChronosAbilities();
  const {
    resetPredictedAbilitySounds,
    updatePredictedAbilitySounds,
  } = useLocalAbilityAudioPrediction();
  const blazeFlamethrowerActiveRef = blazeAbilities.flamethrowerActiveRef;
  const clearBlazeActionLock = blazeAbilities.clearActionLock;
  const isBlazeActionLocked = blazeAbilities.isActionLocked;
  const lockBlazeActions = blazeAbilities.lockActions;

  // Initialize refs
  const initializedRef = useRef(false);
  const tickRef = useRef(0);
  const lastSendRef = useRef(0);
  const lastTraceRef = useRef(0);
  const traceAbilityIdsRef = useRef<string[]>([]);
  const movementCommandAccumulatorRef = useRef(0);
  const pendingMovementCommandsRef = useRef<MovementCommand[]>([]);
  const latestAbilityCastHintsRef = useRef<AbilityCastOriginHint[]>([]);
  const lastCrouchHeldRef = useRef(false);
  const pendingCrouchPressedRef = useRef(false);
  const lastHeroIdRef = useRef<string | null>(null);
  const reloadPressedRef = useRef(false);
  const pendingReloadInputRef = useRef(false);
  const lastUnstuckRequestIdRef = useRef(0);
  const pendingUnstuckInputRef = useRef(false);
  const wasSlidingLastFrameRef = useRef(false);
  const lastViewmodelPoseResetKeyRef = useRef<string | null>(null);
  const actionLockUntilRef = useRef(0);
  const lastExclusiveHoldInputRef = useRef<ExclusiveHoldInput>({
    ...EMPTY_EXCLUSIVE_HOLD_INPUT,
  });
  const positionRef = useRef(new THREE.Vector3());
  const audioForwardRef = useRef(new THREE.Vector3());
  const audioUpRef = useRef(new THREE.Vector3(0, 1, 0));

  const resetMovementCommandBuffer = useCallback(() => {
    movementCommandAccumulatorRef.current = 0;
    pendingMovementCommandsRef.current = [];
    lastCrouchHeldRef.current = false;
    pendingCrouchPressedRef.current = false;
    wasSlidingLastFrameRef.current = false;
  }, []);

  const lockHeroActions = useCallback((heroId: HeroId, durationMs: number, timestampMs = Date.now()) => {
    if (heroId === 'blaze') {
      lockBlazeActions(durationMs, timestampMs);
      return;
    }

    actionLockUntilRef.current = Math.max(
      actionLockUntilRef.current,
      timestampMs + Math.max(0, durationMs)
    );
  }, [lockBlazeActions]);

  const clearHeroActionLock = useCallback(() => {
    actionLockUntilRef.current = 0;
    clearBlazeActionLock();
  }, [clearBlazeActionLock]);

  const isHeroActionLocked = useCallback((heroId: HeroId, timestampMs = Date.now()) => (
    heroId === 'blaze'
      ? isBlazeActionLocked(timestampMs)
      : actionLockUntilRef.current > timestampMs
  ), [isBlazeActionLocked]);

  const flushMovementCommands = useCallback((nowMs: number, force = false) => {
    const pending = pendingMovementCommandsRef.current;
    if (pending.length === 0) return;
    if (!force && pending.length < MOVEMENT_COMMAND_TARGET_PACKET_SIZE && nowMs - lastSendRef.current < MOVEMENT_COMMAND_MAX_FLUSH_AGE_MS) {
      return;
    }

    while (pending.length > 0) {
      const pendingBeforeFlush = pending.length;
      const packetSize = pending.length > MOVEMENT_MAX_PACKET_COMMANDS
        ? MOVEMENT_MAX_PACKET_COMMANDS
        : Math.min(pending.length, MOVEMENT_COMMAND_TARGET_PACKET_SIZE);
      const packetCommands = pending.splice(0, packetSize);
      sendMovementCommands(createMovementCommandPacket(packetCommands));
      recordMovementCommandsSent(packetCommands.length, pendingBeforeFlush);
    }
    lastSendRef.current = nowMs;
  }, [sendMovementCommands]);

  const hasChronosLifelineTarget = useCallback(() => {
    const store = useGameStore.getState();
    const localPlayer = store.localPlayer;
    if (!localPlayer) return false;

    const origin = visualStore.getState().playerPositions.get(localPlayer.id) ?? localPlayer.position;
    const radiusSq = CHRONOS_LIFELINE_RADIUS * CHRONOS_LIFELINE_RADIUS;

    for (const candidate of store.players.values()) {
      if (candidate.id === localPlayer.id) continue;
      if (candidate.state !== 'alive') continue;
      if (candidate.team !== localPlayer.team) continue;

      const dx = candidate.position.x - origin.x;
      const dy = candidate.position.y - origin.y;
      const dz = candidate.position.z - origin.z;
      if (dx * dx + dy * dy + dz * dz <= radiusSq) return true;
    }

    return localPlayer.heroId === 'chronos' && localPlayer.state === 'alive';
  }, []);

  // Hero stats cache
  const cachedHeroStatsRef = useRef<{ heroId: string | null; stats: ReturnType<typeof getHeroStats> | null }>({
    heroId: null,
    stats: null,
  });

  // Preload walking sound on mount
  useEffect(() => {
    preloadWalkingSound();
  }, [preloadWalkingSound]);

  useEffect(() => {
    if (!enabled && isPointerLocked) {
      exitPointerLock();
    }
  }, [enabled, exitPointerLock, isPointerLocked]);

  // Initialize camera position
  useEffect(() => {
    if (localPlayerForInit && !initializedRef.current) {
      // Trust the server's spawn position - it uses configured map positions
      const startY = localPlayerForInit.position.y;
      camera.position.set(localPlayerForInit.position.x, startY + EYE_HEIGHT, localPlayerForInit.position.z);

      initializedRef.current = true;
    }
  }, [localPlayerForInit, camera]);

  // Create sound objects for passing to ability hooks
  const playerSounds = {
    playPhantomBlink, playPhantomShadowStep, playPhantomVeil, playPhantomBasic, playPhantomVoidRay,
    startPhantomVoidRayCharge, stopPhantomVoidRayCharge,
    playBlazeRocket, playBlazeBombTarget, playBlazeBombRelease, playBlazeBombFall, playBlazeBombExplode, playBlazeRocketJump, playBlazeAirstrike,
    startFlamethrowerSound, stopFlamethrowerSound,
  };

  const resetViewmodelPoseState = useCallback((reason: string, heroId: HeroId | null, timestampMs = Date.now()) => {
    const resetKey = `${reason}:${heroId ?? 'none'}`;
    if (lastViewmodelPoseResetKeyRef.current === resetKey) return;

    lastViewmodelPoseResetKeyRef.current = resetKey;
    resetViewmodelPoseRuntime(defaultViewmodelPoseRuntime, heroId);
    setPhantomPrimaryHeld(false, timestampMs);
    setBlazeRocketHeld(false, timestampMs);
    setBlazeBombTargetHeld(false, timestampMs);
    setChronosPrimaryHeld(false, timestampMs);
  }, []);

  const resetBlazeFlamethrower = useCallback((timestampMs = Date.now()) => {
    const store = useGameStore.getState();
    const hadFlamethrowerState =
      blazeFlamethrowerActiveRef.current ||
      store.flamethrowerActive ||
      visualStore.getState().flamethrowerOrigin !== null;

    blazeFlamethrowerActiveRef.current = false;
    setBlazeFlamethrowerHeld(false, timestampMs);
    setFlamethrowerVisualPose(null, DEFAULT_FLAMETHROWER_DIRECTION);
    store.setFlamethrowerActive(false);

    if (hadFlamethrowerState) {
      stopFlamethrowerSound();
    }
  }, [blazeFlamethrowerActiveRef, stopFlamethrowerSound]);

  useEffect(() => {
    return () => {
      resetBlazeFlamethrower();
      resetViewmodelPoseState('unmount', lastHeroIdRef.current as HeroId | null);
      lastExclusiveHoldInputRef.current = { ...EMPTY_EXCLUSIVE_HOLD_INPUT };
      clearHeroActionLock();
      setChronosPrimaryHeld(false);
    };
  }, [clearHeroActionLock, resetBlazeFlamethrower, resetViewmodelPoseState]);

  // Handle targeting confirmations via click
  const handleClick = useCallback(() => {
    if (!enabled) return;

    if (!isPointerLocked) {
      requestPointerLock();
    } else if (bombTargeting && blazeAbilities.bombValidRef.current && blazeAbilities.bombTargetRef.current) {
      if (!isPracticeMode) {
        requestBlazeBombDrop({
          abilityCastHints: latestAbilityCastHintsRef.current.filter((hint) => hint.abilityId === 'blaze_bomb'),
        });
      }
      blazeAbilities.executeBombDrop(playerSounds);
    } else if (grappleTrapTargeting && hookshotAbilities.grappleTrapValidRef.current && hookshotAbilities.grappleTrapTargetRef.current) {
      setGrappleTrapTargeting(false);
    }
  }, [
    enabled, isPointerLocked, requestPointerLock, shadowStepTargeting, bombTargeting, grappleTrapTargeting,
    phantomAbilities, blazeAbilities, hookshotAbilities, playerSounds, abilitySystem, movement,
    cameraControl, requestBlazeBombDrop, updateLocalPlayer, camera, inputState, setGrappleTrapTargeting,
    isPracticeMode,
  ]);

  // Canvas click listener
  useEffect(() => {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.addEventListener('click', handleClick);
      return () => canvas.removeEventListener('click', handleClick);
    }
  }, [handleClick]);

  // Cancel targeting on right-click or Escape
  useEffect(() => {
    const handleCancel = (e: MouseEvent | KeyboardEvent) => {
      const store = useGameStore.getState();
      const isShadowStepTargeting = store.shadowStepTargeting;
      const isBombTargeting = store.bombTargeting;
      const isAirStrikeTargeting = store.airStrikeTargeting;
      const isGrappleTrapTargeting = store.grappleTrapTargeting;

      if (!isShadowStepTargeting && !isBombTargeting && !isAirStrikeTargeting && !isGrappleTrapTargeting) return;

      const isRightClick = e instanceof MouseEvent && e.button === 2;
      const isEscape = e instanceof KeyboardEvent && e.code === 'Escape';
      if (isRightClick || isEscape) {
        e.preventDefault();

        if (isShadowStepTargeting && (isRightClick || isEscape)) {
          store.setShadowStepTargeting(false, false);
        }
        if (isBombTargeting && isEscape) {
          store.setBombTargeting(false, false);
          blazeAbilities.bombTargetRef.current = null;
          blazeAbilities.bombValidRef.current = false;
          setBlazeBombTargetHeld(false);
        }
        if (isAirStrikeTargeting && (isRightClick || isEscape)) {
          store.setAirStrikeTargeting(false, false);
          blazeAbilities.airStrikeTargetRef.current = null;
          blazeAbilities.airStrikeValidRef.current = false;
        }
        if (isGrappleTrapTargeting && (isRightClick || isEscape)) {
          store.setGrappleTrapTargeting(false, false);
          hookshotAbilities.grappleTrapTargetRef.current = null;
          hookshotAbilities.grappleTrapValidRef.current = false;
        }
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      const store = useGameStore.getState();
      if (store.shadowStepTargeting || store.bombTargeting || store.airStrikeTargeting || store.grappleTrapTargeting) {
        e.preventDefault();
      }
    };

    window.addEventListener('mousedown', handleCancel);
    window.addEventListener('keydown', handleCancel);
    window.addEventListener('contextmenu', handleContextMenu);

    return () => {
      window.removeEventListener('mousedown', handleCancel);
      window.removeEventListener('keydown', handleCancel);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [phantomAbilities, blazeAbilities, hookshotAbilities]);

  // Main game loop. Run early so viewmodel/effects sample the updated camera and predicted velocity.
  useFrame((frameState, delta) => {
    let localPlayer = useGameStore.getState().localPlayer;
    const isPlaying = gamePhase === 'playing' || gamePhase === 'countdown';
    const frameClock = getFrameClock();
    const now = frameClock.epochNowMs;
    const frameNowMs = frameClock.nowMs;

    if (!localPlayer) {
      setLocalViewmodelMovement({
        hasMovementInput: false,
        isSprinting: false,
        horizontalSpeed: 0,
        updatedAtMs: now,
      });
      resetViewmodelPoseState('no-local-player', null, now);
      resetBlazeFlamethrower(now);
      reloadPressedRef.current = false;
      pendingReloadInputRef.current = false;
      pendingUnstuckInputRef.current = false;
      resetMovementCommandBuffer();
      movement.refs.slideIntensity.current = 0;
      setLocalSlideIntensity(0);
      setLocalVisualMovement(INACTIVE_LOCAL_MOVEMENT);
      wasSlidingLastFrameRef.current = false;
      resetPredictedAbilitySounds();
      lastExclusiveHoldInputRef.current = { ...EMPTY_EXCLUSIVE_HOLD_INPUT };
      clearHeroActionLock();
      phantomAbilities.resetPhantomPrimaryMagazine();
      blazeAbilities.resetRocketJump();
      return;
    }

    const appliedAuthorities = drainSelfMovementAuthorities(localPlayer, frameNowMs);
    if (appliedAuthorities.length > 0) {
      recordAuthorityFrameApplied(appliedAuthorities.map((application) => application.result));

      let reactiveAuthority = appliedAuthorities[appliedAuthorities.length - 1] ?? null;
      for (let index = appliedAuthorities.length - 1; index >= 0; index--) {
        const application = appliedAuthorities[index];
        if (
          (application.authority.correctionReason && application.authority.correctionReason !== 'normal') ||
          application.result.mediumCorrection ||
          application.result.hardCorrection
        ) {
          reactiveAuthority = application;
          break;
        }
      }

      if (
        reactiveAuthority &&
        (
          (reactiveAuthority.authority.correctionReason && reactiveAuthority.authority.correctionReason !== 'normal') ||
          reactiveAuthority.result.mediumCorrection ||
          reactiveAuthority.result.hardCorrection
        )
      ) {
        const updates = {
          position: { ...reactiveAuthority.state.position },
          velocity: { ...reactiveAuthority.state.velocity },
          lookYaw: reactiveAuthority.authority.lookYaw,
          lookPitch: reactiveAuthority.authority.lookPitch,
          movement: {
            ...reactiveAuthority.state.movement,
            grapplePoint: reactiveAuthority.state.movement.grapplePoint
              ? { ...reactiveAuthority.state.movement.grapplePoint }
              : null,
          },
        };
        updateLocalPlayer(updates);
        recordLocalReactiveUpdate('selfAuthority');
        localPlayer = { ...localPlayer, ...updates };
      }

    }

    if (lastHeroIdRef.current !== localPlayer.heroId) {
      lastHeroIdRef.current = localPlayer.heroId;
      abilitySystem.abilityPressedRef.current = { ability1: false, ability2: false, ultimate: false };
      abilitySystem.clientCooldownsRef.current = {};
      abilitySystem.clientChargesRef.current = {};
      abilitySystem.abilityActiveRef.current = {};
      reloadPressedRef.current = false;
      pendingReloadInputRef.current = false;
      pendingUnstuckInputRef.current = false;
      resetMovementCommandBuffer();
      resetPredictedAbilitySounds();
      lastExclusiveHoldInputRef.current = { ...EMPTY_EXCLUSIVE_HOLD_INPUT };
      clearHeroActionLock();
      hookshotAbilities.secondaryFirePressedRef.current = false;
      setChronosAegisVisualState(localPlayer.id, false, now);
      setShadowStepTargeting(false, false);
      setBombTargeting(false, false);
      setAirStrikeTargeting(false, false);
      setGrappleTrapTargeting(false, false);
      setFlamethrowerActive(false);
      phantomAbilities.resetPhantomPrimaryMagazine();
      resetViewmodelPoseState('hero-swap', localPlayer.heroId as HeroId, now);
      resetBlazeFlamethrower(now);
      blazeAbilities.resetRocketJump();
    }

    const dt = Math.min(delta, 0.1);

    if (!enabled) {
      setLocalViewmodelMovement({
        hasMovementInput: false,
        isSprinting: false,
        horizontalSpeed: 0,
        updatedAtMs: now,
      });
      resetViewmodelPoseState('disabled', localPlayer.heroId as HeroId, now);
      setChronosAegisVisualState(localPlayer.id, false, now);
      resetBlazeFlamethrower(now);
      reloadPressedRef.current = false;
      pendingReloadInputRef.current = false;
      pendingUnstuckInputRef.current = false;
      resetMovementCommandBuffer();
      movement.refs.slideIntensity.current = 0;
      movement.refs.velocity.current.set(0, 0, 0);
      movement.refs.isGrounded.current = false;
      movement.refs.wasGrounded.current = false;
      movement.refs.canJump.current = false;
      movement.refs.isSliding.current = false;
      movement.refs.slideTime.current = 0;
      movement.refs.smoothedY.current = null;
      setLocalSlideIntensity(0);
      setLocalVisualMovement(INACTIVE_LOCAL_MOVEMENT);
      wasSlidingLastFrameRef.current = false;
      resetPredictedAbilitySounds();
      lastExclusiveHoldInputRef.current = { ...EMPTY_EXCLUSIVE_HOLD_INPUT };
      clearHeroActionLock();
      blazeAbilities.resetRocketJump();

      const visualPos = visualStore.getState().playerPositions.get(localPlayer.id) || localPlayer.position;
      cameraControl.updateCameraRotation(camera, false, false, dt);
      camera.position.set(visualPos.x, visualPos.y + EYE_HEIGHT + cameraControl.refs.crouchHeight.current, visualPos.z);
      setPlayerVisualTransform(localPlayer.id, visualPos, cameraControl.refs.yaw.current);
      return;
    }

    // ESC/menu releases pointer lock, but local physics still needs to keep
    // grounding and server position sync alive instead of replaying stale input.
    const hasControlInput = isPointerLocked || isTouchInputActive;
    const rawFrameInput = hasControlInput ? inputState : INACTIVE_INPUT_STATE;
    let frameInput = rawFrameInput;
    const hasMovementInput = (
      rawFrameInput.moveForward ||
      rawFrameInput.moveBackward ||
      rawFrameInput.moveLeft ||
      rawFrameInput.moveRight
    );

    if (!isPlaying || localPlayer.state !== 'alive') {
      setLocalViewmodelMovement({
        hasMovementInput: false,
        isSprinting: false,
        horizontalSpeed: 0,
        updatedAtMs: now,
      });
      resetViewmodelPoseState('inactive-player', localPlayer.heroId as HeroId, now);
      setChronosAegisVisualState(localPlayer.id, false, now);
      resetBlazeFlamethrower(now);
      reloadPressedRef.current = frameInput.reload;
      pendingReloadInputRef.current = false;
      pendingUnstuckInputRef.current = false;
      resetMovementCommandBuffer();
      movement.refs.slideIntensity.current = 0;
      setLocalSlideIntensity(0);
      setLocalVisualMovement({
        ...localPlayer.movement,
        isSprinting: false,
        isSliding: false,
        slideTimeRemaining: 0,
        isGrappling: false,
        grapplePoint: null,
        isJetpacking: false,
        isGliding: false,
      });
      wasSlidingLastFrameRef.current = false;
      resetPredictedAbilitySounds();
      lastExclusiveHoldInputRef.current = { ...EMPTY_EXCLUSIVE_HOLD_INPUT };
      clearHeroActionLock();
      blazeAbilities.resetRocketJump();
      const visualPos = visualStore.getState().playerPositions.get(localPlayer.id) || localPlayer.position;
      cameraControl.updateCameraRotation(camera, false, false, dt);
      camera.position.set(visualPos.x, visualPos.y + EYE_HEIGHT + cameraControl.refs.crouchHeight.current, visualPos.z);
      setPlayerVisualTransform(localPlayer.id, visualPos, cameraControl.refs.yaw.current);
      return;
    }

    // Get hero stats (cached)
    const heroId = localPlayer.heroId as HeroId;
    defaultViewmodelPoseRuntime.heroId = heroId;
    if (hasControlInput) {
      lastViewmodelPoseResetKeyRef.current = null;
    } else {
      resetViewmodelPoseState('input-inactive', heroId, now);
    }

    if (cachedHeroStatsRef.current.heroId !== heroId) {
      cachedHeroStatsRef.current.heroId = heroId;
      cachedHeroStatsRef.current.stats = getHeroStats(heroId);
    }
    const heroStats = cachedHeroStatsRef.current.stats!;

    ensureLocalPredictionInitialized(localPlayer);
    let predictedState = getCurrentPredictedState(movementStateFromPlayer(localPlayer));

    const position = positionRef.current;
    const velocity = movement.refs.velocity.current;
    const localImpulses = consumeLocalPlayerImpulses();
    for (const impulse of localImpulses) {
      predictedState = addLocalMovementImpulse(
        { x: impulse.x, y: impulse.y, z: impulse.z },
        impulse.mode ?? 'add'
      ) ?? predictedState;
    }
    position.set(predictedState.position.x, predictedState.position.y, predictedState.position.z);
    velocity.set(predictedState.velocity.x, predictedState.velocity.y, predictedState.velocity.z);
    movement.refs.isGrounded.current = predictedState.movement.isGrounded;
    movement.refs.wasGrounded.current = predictedState.movement.isGrounded;
    movement.refs.canJump.current = predictedState.movement.isGrounded;
    movement.refs.isSliding.current = predictedState.movement.isSliding;
    movement.refs.isCrouching.current = predictedState.movement.isCrouching;
    movement.refs.isSprinting.current = predictedState.movement.isSprinting;
    movement.refs.slideTime.current = predictedState.movement.slideTimeRemaining;
    if (movement.refs.smoothedY.current === null) {
      movement.refs.smoothedY.current = predictedState.position.y;
    }

    const applyPracticePredictedState = (nextState: typeof predictedState) => {
      predictedState = nextState;
      position.set(nextState.position.x, nextState.position.y, nextState.position.z);
      velocity.set(nextState.velocity.x, nextState.velocity.y, nextState.velocity.z);
      movement.refs.isGrounded.current = nextState.movement.isGrounded;
      movement.refs.wasGrounded.current = nextState.movement.isGrounded;
      movement.refs.canJump.current = nextState.movement.isGrounded;
      movement.refs.isSliding.current = nextState.movement.isSliding;
      movement.refs.isCrouching.current = nextState.movement.isCrouching;
      movement.refs.isSprinting.current = nextState.movement.isSprinting;
      movement.refs.slideTime.current = nextState.movement.slideTimeRemaining;
      updateLocalPlayer({
        position: nextState.position,
        velocity: nextState.velocity,
        movement: nextState.movement,
      });
    };

    const unstuckRequestId = useGameStore.getState().unstuckRequestId;
    if (unstuckRequestId !== lastUnstuckRequestIdRef.current) {
      lastUnstuckRequestIdRef.current = unstuckRequestId;
      pendingUnstuckInputRef.current = true;
    }

    let { speedMultiplier } = abilitySystem.updateActiveAbilities(dt);
    if (localPlayer.heroId === 'phantom' && localPlayer.abilities?.['phantom_veil']?.isActive) {
      speedMultiplier *= 1.3;
    }

    // Handle hero-specific abilities
    const heroDef = HERO_DEFINITIONS[heroId];
    const bombTargetingForFrame = useGameStore.getState().bombTargeting;
    const previousHoldInput = lastExclusiveHoldInputRef.current;
    if (previousHoldInput.primaryFire && !rawFrameInput.primaryFire) {
      lockHeroActions(heroId, getPrimaryReleaseLockMs(heroId), now);
    }
    if (previousHoldInput.secondaryFire && !rawFrameInput.secondaryFire) {
      lockHeroActions(
        heroId,
        getSecondaryReleaseLockMs(heroId, phantomAbilities.voidRayAwaitingReleaseRef.current),
        now
      );
    }
    if (previousHoldInput.ability1 && !rawFrameInput.ability1) {
      lockHeroActions(heroId, getAbility1ReleaseLockMs(heroId), now);
    }

    const continuingHoldInput = getContinuingHeroHoldInput(heroId, rawFrameInput, previousHoldInput);
    const lockedAllowedInput = heroId === 'chronos' && previousHoldInput.secondaryFire && rawFrameInput.secondaryFire
      ? { secondaryFire: true }
      : null;
    frameInput = getExclusiveHeroInput(
      heroId,
      rawFrameInput,
      isHeroActionLocked(heroId, now),
      heroId === 'blaze' && bombTargetingForFrame,
      continuingHoldInput,
      lockedAllowedInput
    );
    lastExclusiveHoldInputRef.current = getExclusiveHoldInput(frameInput);

    const reloadPressed = frameInput.reload && !reloadPressedRef.current;
    reloadPressedRef.current = frameInput.reload;
    if (reloadPressed) {
      pendingReloadInputRef.current = true;
    }
    if (heroId === 'phantom') {
      phantomAbilities.updatePhantomPrimaryReload(now);
      if (reloadPressed) {
        phantomAbilities.reloadPhantomPrimary(now);
      }
    }

    const phantomPrimaryReloading = heroId === 'phantom' && phantomAbilities.phantomPrimaryReloadingRef.current;
    const phantomPrimaryHeldForPose = (
      heroId === 'phantom' &&
      !shadowStepTargeting &&
      frameInput.primaryFire &&
      !phantomPrimaryReloading
    );
    const primaryFireForServer = heroId === 'phantom'
      ? phantomPrimaryHeldForPose && phantomAbilities.phantomPrimaryAmmoRef.current > 0
      : heroId === 'chronos'
        ? frameInput.primaryFire
        : heroId === 'blaze'
          ? frameInput.primaryFire && !bombTargetingForFrame
          : frameInput.primaryFire;
    const ability2ForServer = shadowStepTargeting ? false : frameInput.ability2;

    // Create ability context
    const abilityCtx = {
      position,
      velocity,
      yaw: cameraControl.refs.yaw.current,
      pitch: cameraControl.refs.pitch.current,
      heroId,
      localPlayer: {
        id: localPlayer.id,
        team: localPlayer.team,
        position: localPlayer.position,
        ultimateCharge: localPlayer.ultimateCharge,
      },
      inputState: frameInput,
      dt,
      isGrounded: movement.refs.isGrounded.current,
      camera,
      viewmodelElapsedSeconds: frameState.clock.elapsedTime,
      viewmodelNowMs: now,
    };

    setPhantomPrimaryHeld(phantomPrimaryHeldForPose, now);
    setBlazeRocketHeld(
      heroId === 'blaze' && !bombTargetingForFrame && frameInput.primaryFire,
      now
    );
    setChronosPrimaryHeld(
      heroId === 'chronos' && frameInput.primaryFire,
      now
    );
    setChronosAegisVisualState(
      localPlayer.id,
      heroId === 'chronos' && frameInput.secondaryFire,
      now
    );
    if (heroDef) {
      updatePredictedAbilitySounds({
        now,
        heroId,
        inputState: frameInput,
        ultimateCharge: localPlayer.ultimateCharge ?? 0,
        shadowStepTargeting,
        bombTargeting: bombTargetingForFrame,
        grappleTrapTargeting,
        phantomPrimaryAmmo: phantomAbilities.phantomPrimaryAmmoRef.current,
        phantomPrimaryReloading,
        canUseAbility: abilitySystem.canUseAbility,
        getAbilityCharges: (abilityId: string) => localPlayer.abilities?.[abilityId]?.charges,
        canUseHookshotGrapple: () => hookshotAbilities.canGrapple(abilityCtx),
        hasChronosLifelineTarget,
      });

      // Handle ability input
      if (heroId !== 'blaze') {
        if (frameInput.ability1 && !abilitySystem.abilityPressedRef.current.ability1) {
          if (!shadowStepTargeting && !grappleTrapTargeting && abilitySystem.canUseAbility(heroDef.ability1.abilityId, false, shadowStepTargeting)) {
            if (heroId === 'phantom') {
              if (isPracticeMode) {
                const startPosition = { x: position.x, y: position.y, z: position.z };
                if (abilitySystem.useAbilityCharge(heroDef.ability1.abilityId)) {
                  const nextState = predictLocalPhantomBlink(localPlayer, abilityCtx.yaw, abilityCtx.pitch);
                  applyPracticePredictedState(nextState);
                  triggerBlinkEffect(startPosition, nextState.position);
                  triggerTeleportEffect('blink');
                  useGameStore.getState().addVoidZone({
                    id: `practice_void_${localPlayer.id}_${now}`,
                    position: {
                      x: nextState.position.x,
                      y: nextState.position.y - 0.9,
                      z: nextState.position.z,
                    },
                    radius: PRACTICE_VOID_ZONE_RADIUS,
                    duration: PRACTICE_VOID_ZONE_DURATION_SECONDS,
                    startTime: now,
                    ownerId: localPlayer.id,
                    ownerTeam: (localPlayer.team || 'red') as 'red' | 'blue',
                  });
                  lockHeroActions(heroId, PHANTOM_PRIMARY_RETURN_TO_IDLE_MS, now);
                }
              } else if (phantomAbilities.executeBlink(abilityCtx, playerSounds, abilitySystem.useAbilityCharge)) {
                lockHeroActions(heroId, PHANTOM_PRIMARY_RETURN_TO_IDLE_MS, now);
              }
            } else if (heroId === 'hookshot') {
              if (hookshotAbilities.executeGrapple(abilityCtx)) {
                lockHeroActions(heroId, HOOKSHOT_SECONDARY_POSE_DURATION_MS, now);
                if (isPracticeMode) {
                  abilitySystem.startClientCooldown(heroDef.ability1.abilityId);
                }
              }
            } else if (heroId === 'chronos' && hasChronosLifelineTarget()) {
              if (isPracticeMode) {
                if (abilitySystem.useAbilityCharge(heroDef.ability1.abilityId)) {
                  if (chronosAbilities.executeLifelineConduit(abilityCtx, abilitySystem.useAbilityCharge)) {
                    lockHeroActions(heroId, CHRONOS_LIFELINE_POSE_DURATION_MS, now);
                  }
                  addChronosLifelineEffects(
                    { x: position.x, y: position.y, z: position.z },
                    [{ position: { x: position.x, y: position.y, z: position.z } }],
                    undefined,
                    { sourcePlayerId: localPlayer.id }
                  );
                }
              } else if (chronosAbilities.executeLifelineConduit(abilityCtx, abilitySystem.useAbilityCharge)) {
                lockHeroActions(heroId, CHRONOS_LIFELINE_POSE_DURATION_MS, now);
              }
            }
          }
        }
        abilitySystem.abilityPressedRef.current.ability1 = rawFrameInput.ability1;
      }

      // Ability 2 (Q)
      if (frameInput.ability2 && !abilitySystem.abilityPressedRef.current.ability2) {
        if (abilitySystem.canUseAbility(heroDef.ability2.abilityId, false, shadowStepTargeting)) {
          if (heroId === 'phantom') {
            if (isPracticeMode) {
              const abilityId = heroDef.ability2.abilityId;
              abilitySystem.setAbilityActive(abilityId, true, { startTime: now, startCooldownOnEnd: true });
              updateLocalPlayer({
                abilities: {
                  ...localPlayer.abilities,
                  [abilityId]: buildPracticeAbilityState(localPlayer.abilities, abilityId, now, true),
                },
              });
              lockHeroActions(heroId, PHANTOM_PRIMARY_RETURN_TO_IDLE_MS, now);
            } else if (phantomAbilities.executePersonalShield(
              abilityCtx,
              playerSounds,
              abilitySystem.setAbilityActive,
              abilitySystem.startClientCooldown,
              updateLocalPlayer
            )) {
              lockHeroActions(heroId, PHANTOM_PRIMARY_RETURN_TO_IDLE_MS, now);
            }
          } else if (heroId === 'blaze') {
            blazeAbilities.executeRocketJump(abilityCtx);
            if (isPracticeMode) {
              const startPosition = { x: position.x, y: position.y, z: position.z };
              const nextState = predictLocalBlazeRocketJump(localPlayer, abilityCtx.yaw);
              applyPracticePredictedState(nextState);
              triggerRocketJumpExplosion(startPosition);
              abilitySystem.startClientCooldown(heroDef.ability2.abilityId);
            }
          } else if (heroId === 'hookshot') {
            if (hookshotAbilities.executeEarthWall(abilityCtx)) {
              lockHeroActions(heroId, HOOKSHOT_PRIMARY_RECOIL_DURATION_MS, now);
              if (isPracticeMode) {
                abilitySystem.startClientCooldown(heroDef.ability2.abilityId);
              }
            }
          } else if (heroId === 'chronos') {
            const didCastTimebreak = chronosAbilities.executeTimebreak(
              abilityCtx,
              abilitySystem.startClientCooldown
            );
            if (didCastTimebreak) {
              lockHeroActions(heroId, CHRONOS_TIMEBREAK_POSE_DURATION_MS, now);
            }
            if (didCastTimebreak && isPracticeMode) {
              const forward = {
                x: -Math.sin(abilityCtx.yaw),
                y: 0,
                z: -Math.cos(abilityCtx.yaw),
              };
              addChronosTimebreakEffect({
                position: { x: position.x, y: position.y + 1.18, z: position.z },
                ownerId: localPlayer.id,
                ownerTeam: localPlayer.team,
                direction: forward,
                startTime: now,
                releaseTime: now + CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
              });
              abilitySystem.startClientCooldown(heroDef.ability2.abilityId);
            }
          }
        }
      }
      abilitySystem.abilityPressedRef.current.ability2 = rawFrameInput.ability2;

      // Ultimate (F)
      if (frameInput.ultimate && !abilitySystem.abilityPressedRef.current.ultimate) {
        if (!shadowStepTargeting && abilitySystem.canUseAbility(heroDef.ultimate.abilityId, true, shadowStepTargeting)) {
          if (heroId === 'phantom') {
            if (isPracticeMode) {
              const abilityId = heroDef.ultimate.abilityId;
              const abilityDef = ABILITY_DEFINITIONS[abilityId];
              const durationMs = (abilityDef?.duration ?? 0) * 1000;
              abilitySystem.setAbilityActive(abilityId, true, { startTime: now, startCooldownOnEnd: true });
              useGameStore.getState().setUltimateEffect(true, abilityId, now + durationMs);
              updateLocalPlayer({
                ultimateCharge: 0,
                abilities: {
                  ...localPlayer.abilities,
                  [abilityId]: buildPracticeAbilityState(localPlayer.abilities, abilityId, now, true),
                },
              });
              lockHeroActions(heroId, PHANTOM_PRIMARY_RETURN_TO_IDLE_MS, now);
            } else if (phantomAbilities.executePhantomVeil(abilityCtx, playerSounds, updateLocalPlayer, abilitySystem.setAbilityActive)) {
              lockHeroActions(heroId, PHANTOM_PRIMARY_RETURN_TO_IDLE_MS, now);
            }
          } else if (heroId === 'blaze') {
            blazeAbilities.executeAirStrike(abilityCtx, playerSounds, updateLocalPlayer);
            if (isPracticeMode) {
              const effectPosition = { x: position.x, y: position.y, z: position.z };
              triggerAirStrike(effectPosition);
              updateLocalPlayer({ ultimateCharge: 0 });
            }
          } else if (heroId === 'hookshot') {
            if (hookshotAbilities.executeGrappleTrap(abilityCtx, updateLocalPlayer)) {
              lockHeroActions(heroId, HOOKSHOT_SECONDARY_POSE_DURATION_MS, now);
            }
          } else if (heroId === 'chronos') {
            if (chronosAbilities.executeAscendantParadox(abilityCtx, abilitySystem.setAbilityActive)) {
              lockHeroActions(heroId, CHRONOS_ASCENDANT_CAST_LOCK_MS, now);
              predictedState = getCurrentPredictedState(predictedState);
              position.set(predictedState.position.x, predictedState.position.y, predictedState.position.z);
              velocity.set(predictedState.velocity.x, predictedState.velocity.y, predictedState.velocity.z);
            }
          }
        }
      }
      abilitySystem.abilityPressedRef.current.ultimate = rawFrameInput.ultimate;

      // Hero-specific primary/secondary fire and hold abilities
      if (heroId === 'phantom' && !shadowStepTargeting) {
        phantomAbilities.handleVoidRay(abilityCtx, playerSounds);
      }

      if (heroId === 'blaze') {
        blazeAbilities.fireRocket(abilityCtx);
        blazeAbilities.handleBombTargeting(abilityCtx, playerSounds);
        blazeAbilities.handleFlamethrower(
          abilityCtx,
          playerSounds,
          setFlamethrowerActive,
          setFlamethrowerFuel
        );
      }

      if (heroId === 'hookshot' && !grappleTrapTargeting) {
        const secondaryPressed = frameInput.secondaryFire && !hookshotAbilities.secondaryFirePressedRef.current;
        if (frameInput.primaryFire) {
          if (hookshotAbilities.fireChainHook(abilityCtx)) {
            lockHeroActions(heroId, HOOKSHOT_PRIMARY_RECOIL_DURATION_MS, now);
          }
        }
        if (secondaryPressed) {
          if (hookshotAbilities.fireDragHook(abilityCtx)) {
            lockHeroActions(heroId, HOOKSHOT_SECONDARY_POSE_DURATION_MS, now);
          }
        }
        hookshotAbilities.secondaryFirePressedRef.current = frameInput.secondaryFire;

        // Update grapple physics
        hookshotAbilities.updateGrapplePhysics(abilityCtx);
      }

      if (heroId === 'chronos') {
        chronosAbilities.fireVerdantPulse(abilityCtx);
      }
    }

    if (
      position.x !== predictedState.position.x ||
      position.y !== predictedState.position.y ||
      position.z !== predictedState.position.z ||
      velocity.x !== predictedState.velocity.x ||
      velocity.y !== predictedState.velocity.y ||
      velocity.z !== predictedState.velocity.z
    ) {
      predictedState = confirmLocalMovementTransform(
        localPlayer,
        {
          position: { x: position.x, y: position.y, z: position.z },
          velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
          movement: {
            isGrappling: hookshotAbilities.isGrapplingRef.current || hookshotAbilities.isSwingingRef.current,
            grapplePoint: hookshotAbilities.grappleTargetRef.current,
          },
        },
        cameraControl.refs.yaw.current
      );
    }

    const wasGroundedBeforePrediction = predictedState.movement.isGrounded;
    const currentTargeting = useGameStore.getState().shadowStepTargeting;
    const currentBombTargeting = useGameStore.getState().bombTargeting;
    const phantomAutoReloadForServer = heroId === 'phantom' &&
      phantomAbilities.phantomPrimaryReloadingRef.current &&
      phantomAbilities.phantomPrimaryAmmoRef.current <= 0;
    const reloadForServer = frameInput.reload ||
      pendingReloadInputRef.current ||
      (phantomAutoReloadForServer && !primaryFireForServer);
    const unstuckForServer = pendingUnstuckInputRef.current;
    const crouchHeld = frameInput.crouch || isControlPressed;
    if (crouchHeld && !lastCrouchHeldRef.current) {
      pendingCrouchPressedRef.current = true;
    }
    lastCrouchHeldRef.current = crouchHeld;

    const commandInput = {
      ...frameInput,
      crouch: crouchHeld,
      primaryFire: heroId === 'blaze' && currentBombTargeting ? false : primaryFireForServer,
      reload: reloadForServer,
      ability2: currentTargeting ? false : ability2ForServer,
    };
    const abilityCastHints = buildAbilityCastOriginHints(abilityCtx, commandInput, {
      bombTargeting: currentBombTargeting,
    });
    latestAbilityCastHintsRef.current = abilityCastHints ?? [];

    movementCommandAccumulatorRef.current = Math.min(
      movementCommandAccumulatorRef.current + dt,
      MOVEMENT_SUBSTEP_SECONDS * MOVEMENT_MAX_PACKET_COMMANDS
    );

    let substepsThisFrame = 0;
    while (
      movementCommandAccumulatorRef.current >= MOVEMENT_SUBSTEP_SECONDS &&
      substepsThisFrame < MOVEMENT_MAX_PACKET_COMMANDS
    ) {
      const command = createLocalMovementCommand(commandInput, {
        lookYaw: cameraControl.refs.yaw.current,
        lookPitch: cameraControl.refs.pitch.current,
        clientTimeMs: now,
        unstuck: pendingUnstuckInputRef.current,
        crouchPressed: pendingCrouchPressedRef.current,
        abilityCastHints,
      });
      recordMovementCommandGenerated();
      pendingUnstuckInputRef.current = false;
      pendingCrouchPressedRef.current = false;
      pendingMovementCommandsRef.current.push(command);
      predictedState = stepLocalMovementPrediction(localPlayer, command);
      movementCommandAccumulatorRef.current -= MOVEMENT_SUBSTEP_SECONDS;
      tickRef.current = command.seq;
      substepsThisFrame++;
    }
    flushMovementCommands(now);
    pendingReloadInputRef.current = false;

    position.set(predictedState.position.x, predictedState.position.y, predictedState.position.z);
    velocity.set(predictedState.velocity.x, predictedState.velocity.y, predictedState.velocity.z);
    const visualPosition = getCurrentPredictedVisualPosition(predictedState.position, frameNowMs);
    const smoothedVisualY = smoothTerrainVisualY(
      movement.refs.smoothedY.current,
      visualPosition.y,
      dt,
      predictedState.movement.isGrounded
    );
    const smoothedVisualPosition = {
      x: visualPosition.x,
      y: smoothedVisualY,
      z: visualPosition.z,
    };
    movement.refs.isGrounded.current = predictedState.movement.isGrounded;
    movement.refs.wasGrounded.current = predictedState.movement.isGrounded;
    movement.refs.canJump.current = predictedState.movement.isGrounded;
    movement.refs.isCrouching.current = predictedState.movement.isCrouching;
    movement.refs.isSprinting.current = predictedState.movement.isSprinting;
    movement.refs.isSliding.current = predictedState.movement.isSliding;
    movement.refs.slideTime.current = predictedState.movement.slideTimeRemaining;
    movement.refs.smoothedY.current = smoothedVisualY;

    const isSliding = predictedState.movement.isSliding;
    const wasSlidingBeforeFrame = wasSlidingLastFrameRef.current;
    wasSlidingLastFrameRef.current = isSliding;
    const justLanded = predictedState.movement.isGrounded && !wasGroundedBeforePrediction;
    if (heroId === 'hookshot' && predictedState.movement.isGrounded && !wasGroundedBeforePrediction) {
      hookshotAbilities.handleSwingTerrainContact();
    }

    // Update walking sound
    const walkingSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    setLocalViewmodelMovement({
      hasMovementInput,
      isSprinting: movement.refs.isSprinting.current || frameInput.sprint,
      horizontalSpeed: walkingSpeed,
      updatedAtMs: now,
    });
    updateWalkingSound(walkingSpeed, movement.refs.isGrounded.current, isSliding, heroStats.moveSpeed, justLanded);

    // Update camera
    cameraControl.updateCameraRotation(camera, isSliding, movement.refs.isCrouching.current, dt);
    const cameraBodyY = movement.refs.smoothedY.current ?? smoothedVisualPosition.y;
    camera.position.set(smoothedVisualPosition.x, cameraBodyY + EYE_HEIGHT + cameraControl.refs.crouchHeight.current, smoothedVisualPosition.z);
    camera.updateMatrixWorld();
    camera.getWorldDirection(audioForwardRef.current);
    audioUpRef.current.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
    setAudioListenerTransform(camera.position, audioForwardRef.current, audioUpRef.current);

    if (heroId === 'phantom' && !shadowStepTargeting) {
      phantomAbilities.fireDireBall(abilityCtx, playerSounds);
    }

    const traceGrapplePoint = hookshotAbilities.grappleTargetRef.current;
    const latestLocalMovement = useGameStore.getState().localPlayer?.movement ?? localPlayer.movement;
    const localMovementForTrace: PlayerMovementState = {
      ...latestLocalMovement,
      isGrounded: movement.refs.isGrounded.current,
      isSprinting: movement.refs.isSprinting.current,
      isCrouching: movement.refs.isCrouching.current,
      isSliding,
      slideTimeRemaining: movement.refs.slideTime.current,
      isGrappling: hookshotAbilities.isGrapplingRef.current || hookshotAbilities.isSwingingRef.current || localPlayer.movement.isGrappling,
      grapplePoint: traceGrapplePoint
        ? { x: traceGrapplePoint.x, y: traceGrapplePoint.y, z: traceGrapplePoint.z }
        : localPlayer.movement.grapplePoint,
    };

    setLocalVisualMovement(localMovementForTrace);

    // Update visual store for non-reactive position access.
    setPlayerVisualTransform(localPlayer.id, smoothedVisualPosition, cameraControl.refs.yaw.current);

    const slideIntensity = isSliding
      ? Math.min(1, Math.max(0.25, predictedState.movement.slideTimeRemaining / 0.8))
      : 0;
    setLocalSlideIntensity(slideIntensity);

    if (now - lastTraceRef.current >= 1000 / TICK_RATE) {
      lastTraceRef.current = now;
      const storeForTrace = useGameStore.getState();
      const traceAbilityIds = writeActiveAbilityIdsForTrace(localPlayer.abilities, traceAbilityIdsRef.current);
      if (frameInput.ability1) pushUniqueTraceAbilityId(traceAbilityIds, heroDef?.ability1.abilityId);
      if (frameInput.ability2) pushUniqueTraceAbilityId(traceAbilityIds, heroDef?.ability2.abilityId);
      if (frameInput.ultimate) pushUniqueTraceAbilityId(traceAbilityIds, heroDef?.ultimate.abilityId);
      if (shadowStepTargeting) pushUniqueTraceAbilityId(traceAbilityIds, 'phantom_shadow_step_targeting');
      if (bombTargeting) pushUniqueTraceAbilityId(traceAbilityIds, 'blaze_bomb_targeting');
      if (grappleTrapTargeting) pushUniqueTraceAbilityId(traceAbilityIds, 'hookshot_grapple_trap_targeting');
      traceAbilityIds.sort();
      const traceGroundY = localMovementForTrace.isGrounded
        ? position.y - PLAYER_HEIGHT / 2
        : null;
      const traceMovementClass = movementClassForTrace({
        heroId,
        movement: localMovementForTrace,
        inputState: commandInput,
        unstuck: unstuckForServer,
        flagCarrier: localPlayer.hasFlag,
      });
      const traceMovementBarrier: MovementCorrectionReason | null = unstuckForServer
        ? 'unstuck'
        : heroId === 'phantom' && frameInput.ability1
          ? 'teleport'
          : heroId === 'blaze' && frameInput.ability2
            ? 'knockback'
            : null;
      recordMovementTraceFrame({
        heroId,
        matchMode: resolveTraceMatchMode(),
        movementClass: traceMovementClass,
        mapSeed: storeForTrace.mapSeed,
        frameRateBand: frameRateBand(dt),
        pingBandMs: pingBandMs(storeForTrace.playerPings.get(localPlayer.id)),
        tick: tickRef.current,
        inputState: commandInput,
        lookYaw: cameraControl.refs.yaw.current,
        lookPitch: cameraControl.refs.pitch.current,
        timestamp: now,
        position: { x: position.x, y: position.y, z: position.z },
        velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
        movement: localMovementForTrace,
        playerState: localPlayer.state,
        health: localPlayer.health,
        flagCarrier: localPlayer.hasFlag,
        activeAbilityState: {
          activeAbilityIds: traceAbilityIds,
          activeSpeedMultiplier: speedMultiplier,
          movementBarrier: traceMovementBarrier === 'unstuck' ||
            traceMovementBarrier === 'teleport' ||
            traceMovementBarrier === 'knockback'
            ? traceMovementBarrier
            : null,
        },
        terrainContact: {
          profile: 'procedural_map',
          isGrounded: localMovementForTrace.isGrounded,
          groundY: traceGroundY,
          blockedAhead: false,
          mapSeed: storeForTrace.mapSeed,
          collisionRevision: getLocalMovementCollisionRevision(),
        },
        unstuck: unstuckForServer,
        crouchPressed: isSliding && !wasSlidingBeforeFrame,
        correctionReason: traceMovementBarrier ?? undefined,
      });
    }
  }, -100);

  // Render targeting indicators
  return (
    <>
      <BombTargetingIndicator
        isActive={bombTargeting}
        onTargetUpdate={blazeAbilities.handleBombTargetUpdate}
      />
      <GrappleTrapTargetingIndicator
        isActive={grappleTrapTargeting}
        onTargetUpdate={hookshotAbilities.handleGrappleTrapTargetUpdate}
      />
    </>
  );
}
