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

import { useRef, useEffect, useCallback, useMemo, type MutableRefObject } from 'react';
import { useFrame, useThree, type RootState } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import { useCombatFeedbackStore } from '../../store/combatFeedbackStore';
import {
  consumeLocalPlayerImpulses,
  getDeathVisualForPlayer,
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
  PHANTOM_VEIL_CAST_POSE_DURATION_MS,
  PHANTOM_VOID_RAY_RELEASE_LOCK_MS,
  setPhantomPrimaryHeld,
  triggerPhantomVeilCastPose,
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
  setChronosLifelineQueued,
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
  type AbilityContext,
  type MovementSounds,
  type PlayerSounds,
  type UseAbilitySystemReturn,
  type UseBlazeAbilitiesReturn,
  type UseCameraReturn,
  type UseChronosAbilitiesReturn,
  type UseHookshotAbilitiesReturn,
  type UseMovementReturn,
  type UsePhantomAbilitiesReturn,
} from '../../hooks/player';
import { getFrameClock } from '../../utils/frameClock';
import {
  markPredictedLocalAbilitySound,
  useLocalAbilityAudioPrediction,
} from '../../hooks/player/useLocalAbilityAudioPrediction';
import { buildAbilityCastOriginHints } from '../../hooks/player/abilityCastOriginHints';
import {
  ABILITY_DEFINITIONS,
  BLAZE_FLAMETHROWER_MAX_FUEL,
  CHRONOS_LIFELINE_ALLY_HEAL,
  CHRONOS_LIFELINE_MAX_TARGETS,
  CHRONOS_LIFELINE_RADIUS,
  CHRONOS_LIFELINE_SELF_HEAL,
  CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
  MOVEMENT_MAX_PACKET_COMMANDS,
  MOVEMENT_SUBSTEP_SECONDS,
  PHANTOM_VEIL_SPEED_MULTIPLIER,
  TICK_RATE,
  createEmptyInputState,
  getHeroStats,
  HERO_DEFINITIONS,
  type HeroId,
  type MatchMode,
  type AbilityCastOriginHint,
  type InputState,
  type MovementCommand,
  type Player,
  type PlayerMovementState,
} from '@voxel-strike/shared';
import type { MovementSimulationState, PredictionCorrectionMetrics } from '@voxel-strike/physics';
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
  getPendingSelfMovementAuthorityCount,
  movementStateFromPlayer,
  predictLocalBlazeRocketJump,
  predictLocalPhantomBlink,
  stepLocalMovementPrediction,
} from '../../movement/localPrediction';
import {
  recordAuthorityDrainFrame,
  recordAuthorityFrameApplied,
  recordLocalReactiveUpdate,
  measureFrameWork,
  MOVEMENT_DIAGNOSTICS_ENABLED,
  recordMovementCommandGenerated,
  recordMovementCommandsSent,
  recordMovementFrameTiming,
} from '../../movement/networkDiagnostics';

// Component imports for targeting indicators
import { BombTargetingIndicator, triggerAirStrike, triggerRocketJumpExplosion } from './BlazeEffects';
import { GrappleTrapTargetingIndicator } from './HookshotEffects';
import { triggerBlinkEffect } from './PhantomEffects';
import { triggerPhantomShieldCastEffect } from './phantom';
import { addChronosLifelineEffects, addChronosSelfHealPulseEffect } from './chronos/lifeline';
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
const LOCAL_VISUAL_INTERPOLATION_RESET_DISTANCE_SQ = 1.8 * 1.8;
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

const authorityMetricsScratch: PredictionCorrectionMetrics[] = [];

interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

interface LocalVisualInterpolationState {
  previous: MutableVec3;
  current: MutableVec3;
  initialized: boolean;
}

export function createLocalVisualInterpolationState(): LocalVisualInterpolationState {
  return {
    previous: { x: 0, y: 0, z: 0 },
    current: { x: 0, y: 0, z: 0 },
    initialized: false,
  };
}

function copyMutableVec3(target: MutableVec3, source: MutableVec3): void {
  target.x = source.x;
  target.y = source.y;
  target.z = source.z;
}

function distanceSq(a: MutableVec3, b: MutableVec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function resetLocalVisualInterpolation(
  interpolation: LocalVisualInterpolationState,
  position: MutableVec3
): void {
  copyMutableVec3(interpolation.previous, position);
  copyMutableVec3(interpolation.current, position);
  interpolation.initialized = true;
}

export function recordLocalVisualFixedStep(
  interpolation: LocalVisualInterpolationState,
  previousPosition: MutableVec3,
  currentPosition: MutableVec3
): void {
  if (
    !interpolation.initialized ||
    distanceSq(interpolation.current, previousPosition) > LOCAL_VISUAL_INTERPOLATION_RESET_DISTANCE_SQ
  ) {
    resetLocalVisualInterpolation(interpolation, previousPosition);
  }

  copyMutableVec3(interpolation.previous, previousPosition);
  copyMutableVec3(interpolation.current, currentPosition);
  interpolation.initialized = true;
}

export function sampleLocalVisualInterpolatedPosition(
  interpolation: LocalVisualInterpolationState,
  fallbackPosition: MutableVec3,
  accumulatorSeconds: number,
  target: MutableVec3
): MutableVec3 {
  if (
    !interpolation.initialized ||
    distanceSq(interpolation.current, fallbackPosition) > LOCAL_VISUAL_INTERPOLATION_RESET_DISTANCE_SQ
  ) {
    resetLocalVisualInterpolation(interpolation, fallbackPosition);
  }

  const alpha = Math.max(0, Math.min(1, accumulatorSeconds / MOVEMENT_SUBSTEP_SECONDS));
  target.x = interpolation.previous.x + (interpolation.current.x - interpolation.previous.x) * alpha;
  target.y = interpolation.previous.y + (interpolation.current.y - interpolation.previous.y) * alpha;
  target.z = interpolation.previous.z + (interpolation.current.z - interpolation.previous.z) * alpha;
  return target;
}

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

export function smoothTerrainVisualY(
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

function getInitialPracticeCooldownSeconds(
  abilityId: string,
  abilityDef: typeof ABILITY_DEFINITIONS[string] | undefined,
  existingAbility: { cooldownRemaining?: number } | undefined,
  isActive: boolean
): number {
  if (isActive && abilityId === 'phantom_personal_shield') return 0;
  return abilityDef?.cooldown ?? existingAbility?.cooldownRemaining ?? 0;
}

function buildPracticeAbilityState(
  existingAbilities: Record<string, { charges?: number; cooldownRemaining?: number }> | undefined,
  abilityId: string,
  now: number,
  isActive: boolean
) {
  const abilityDef = ABILITY_DEFINITIONS[abilityId];
  const existingAbility = existingAbilities?.[abilityId];
  const cooldownSeconds = getInitialPracticeCooldownSeconds(abilityId, abilityDef, existingAbility, isActive);

  return {
    abilityId,
    cooldownRemaining: cooldownSeconds,
    cooldownUntil: cooldownSeconds > 0 ? now + cooldownSeconds * 1000 : 0,
    charges: existingAbility?.charges ?? abilityDef?.charges ?? 1,
    isActive,
    activatedAt: now,
  };
}

type CastActionFields = Pick<InputState, 'primaryFire' | 'secondaryFire' | 'ability1' | 'ability2' | 'ultimate'>;
type ExclusiveHoldInput = Pick<InputState, 'primaryFire' | 'secondaryFire' | 'ability1'>;
export type ServerCombatInput = CastActionFields;
export type CommandScheduleReason = 'combat_edge' | 'movement_barrier';
interface CommandSchedule {
  forceSubstep: boolean;
  flushExistingBeforeSample: boolean;
  forcePacketFlush: boolean;
}
type ChronosLifelineMode = 'allies' | 'self';
type ChronosPracticeLifelineTarget = {
  id: string;
  position: { x: number; y: number; z: number };
  isLocal: boolean;
  newHealth: number;
};

const EMPTY_EXCLUSIVE_HOLD_INPUT: ExclusiveHoldInput = {
  primaryFire: false,
  secondaryFire: false,
  ability1: false,
};
const EMPTY_SERVER_COMBAT_INPUT: ServerCombatInput = {
  primaryFire: false,
  secondaryFire: false,
  ability1: false,
  ability2: false,
  ultimate: false,
};

export function withCastActionFields(input: InputState, actions: Partial<CastActionFields> = {}): InputState {
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

export function getExclusiveHeroInput(
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

export function getContinuingHeroHoldInput(
  heroId: HeroId,
  input: InputState,
  previousInput: ExclusiveHoldInput
): Partial<CastActionFields> | null {
  if (previousInput.primaryFire && input.primaryFire) {
    return { primaryFire: true };
  }

  if (previousInput.secondaryFire && input.secondaryFire) {
    return { secondaryFire: true };
  }

  if (heroId === 'blaze' && previousInput.ability1 && input.ability1) {
    return { ability1: true };
  }

  return null;
}

export function getExclusiveHoldInput(input: InputState): ExclusiveHoldInput {
  return {
    primaryFire: input.primaryFire,
    secondaryFire: input.secondaryFire,
    ability1: input.ability1,
  };
}

export function shouldForceImmediateCombatCommand(
  current: ServerCombatInput,
  previous: ServerCombatInput
): boolean {
  return (
    current.primaryFire !== previous.primaryFire ||
    current.secondaryFire !== previous.secondaryFire ||
    current.ability1 !== previous.ability1 ||
    current.ability2 !== previous.ability2 ||
    current.ultimate !== previous.ultimate
  );
}

function addCommandScheduleReason(reasons: CommandScheduleReason[], reason: CommandScheduleReason): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
}

function resolveCommandSchedule(reasons: CommandScheduleReason[]): CommandSchedule {
  const forceCommand = reasons.length > 0;
  return {
    forceSubstep: forceCommand,
    flushExistingBeforeSample: reasons.includes('movement_barrier'),
    forcePacketFlush: forceCommand,
  };
}

export function deriveServerCombatInput(input: {
  frameInput: InputState;
  primaryFireForServer: boolean;
  ability2ForServer: boolean;
}): ServerCombatInput {
  return {
    primaryFire: input.primaryFireForServer,
    secondaryFire: input.frameInput.secondaryFire,
    ability1: input.frameInput.ability1,
    ability2: input.ability2ForServer,
    ultimate: input.frameInput.ultimate,
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

export function movementClassForTrace(input: {
  heroId: HeroId;
  movement: PlayerMovementState;
  inputState: typeof INACTIVE_INPUT_STATE;
  flagCarrier: boolean;
}): string {
  if (input.movement.isSliding) return 'slide';
  if (input.heroId === 'blaze' && input.inputState.ability2) return 'rocket_jump';
  if (input.heroId === 'phantom' && input.inputState.ability1) return 'blink';
  if (input.heroId === 'hookshot' && (input.inputState.ability1 || input.movement.isGrappling)) return 'grapple';
  if (input.heroId === 'hookshot' && input.inputState.ultimate) return 'grapple_trap';
  if (input.heroId === 'chronos' && input.inputState.ability1) {
    return input.inputState.secondaryFire ? 'chronos_lifeline_self' : 'chronos_lifeline_allies';
  }
  if (input.flagCarrier) return 'flag_route';
  return 'baseline';
}

// ============================================================================
// PLAYER CONTROLLER COMPONENT
// ============================================================================

interface PlayerControllerProps {
  enabled?: boolean;
}

type GameStoreSnapshot = ReturnType<typeof useGameStore.getState>;
type NetworkContextValue = ReturnType<typeof useNetwork>;
type LocalAbilityAudioPrediction = ReturnType<typeof useLocalAbilityAudioPrediction>;

interface LocalPlayerFrameRefs {
  tickRef: MutableRefObject<number>;
  lastTraceRef: MutableRefObject<number>;
  traceAbilityIdsRef: MutableRefObject<string[]>;
  movementCommandAccumulatorRef: MutableRefObject<number>;
  pendingMovementCommandsRef: MutableRefObject<MovementCommand[]>;
  localVisualInterpolationRef: MutableRefObject<LocalVisualInterpolationState>;
  localVisualInterpolatedPositionRef: MutableRefObject<MutableVec3>;
  localVisualPositionRef: MutableRefObject<MutableVec3>;
  smoothedVisualPositionRef: MutableRefObject<MutableVec3>;
  latestAbilityCastHintsRef: MutableRefObject<AbilityCastOriginHint[]>;
  lastCrouchHeldRef: MutableRefObject<boolean>;
  pendingCrouchPressedRef: MutableRefObject<boolean>;
  lastHeroIdRef: MutableRefObject<string | null>;
  reloadPressedRef: MutableRefObject<boolean>;
  pendingReloadInputRef: MutableRefObject<boolean>;
  wasSlidingLastFrameRef: MutableRefObject<boolean>;
  lastExclusiveHoldInputRef: MutableRefObject<ExclusiveHoldInput>;
  lastServerCombatInputRef: MutableRefObject<ServerCombatInput>;
  chronosLifelineQueuedRef: MutableRefObject<boolean>;
  chronosLifelineBlockPrimaryRef: MutableRefObject<boolean>;
  chronosLifelineBlockSecondaryRef: MutableRefObject<boolean>;
  chronosLifelineCommitHeldRef: MutableRefObject<boolean>;
  positionRef: MutableRefObject<THREE.Vector3>;
  audioForwardRef: MutableRefObject<THREE.Vector3>;
  audioUpRef: MutableRefObject<THREE.Vector3>;
  cachedHeroStatsRef: MutableRefObject<{
    heroId: string | null;
    stats: ReturnType<typeof getHeroStats> | null;
  }>;
}

export interface LocalPlayerFrameContext {
  enabled: boolean;
  frameState: RootState;
  delta: number;
  camera: THREE.Camera;
  gamePhase: GameStoreSnapshot['gamePhase'];
  inputState: InputState;
  isPointerLocked: boolean;
  isControlPressed: boolean;
  isTouchInputActive: boolean;
  bombTargeting: boolean;
  grappleTrapTargeting: boolean;
  isPracticeMode: boolean;
  updateLocalPlayer: GameStoreSnapshot['updateLocalPlayer'];
  setBombTargeting: GameStoreSnapshot['setBombTargeting'];
  setFlamethrowerActive: GameStoreSnapshot['setFlamethrowerActive'];
  setFlamethrowerFuel: GameStoreSnapshot['setFlamethrowerFuel'];
  setGrappleTrapTargeting: GameStoreSnapshot['setGrappleTrapTargeting'];
  sendMovementCommands: NetworkContextValue['sendMovementCommands'];
  cameraControl: UseCameraReturn;
  movement: UseMovementReturn;
  abilitySystem: UseAbilitySystemReturn;
  phantomAbilities: UsePhantomAbilitiesReturn;
  blazeAbilities: UseBlazeAbilitiesReturn;
  hookshotAbilities: UseHookshotAbilitiesReturn;
  chronosAbilities: UseChronosAbilitiesReturn;
  playerSounds: PlayerSounds;
  movementSounds: Pick<MovementSounds, 'updateWalkingSound' | 'startSlide' | 'stopSlide'>;
  resetPredictedAbilitySounds: LocalAbilityAudioPrediction['resetPredictedAbilitySounds'];
  updatePredictedAbilitySounds: LocalAbilityAudioPrediction['updatePredictedAbilitySounds'];
  resetMovementCommandBuffer: () => void;
  lockHeroActions: (heroId: HeroId, durationMs: number, timestampMs?: number) => void;
  clearHeroActionLock: () => void;
  setChronosLifelineQueuedState: (
    queued: boolean,
    timestampMs?: number,
    input?: Pick<InputState, 'primaryFire' | 'secondaryFire'>
  ) => void;
  isHeroActionLocked: (heroId: HeroId, timestampMs?: number) => boolean;
  flushMovementCommands: (nowMs: number, force?: boolean) => void;
  hasChronosLifelineTarget: () => boolean;
  getChronosPracticeLifelineTargets: (
    mode: ChronosLifelineMode,
    healAmount: number
  ) => ChronosPracticeLifelineTarget[];
  resetViewmodelPoseState: (reason: string, heroId: HeroId | null, timestampMs?: number) => void;
  resetBlazeFlamethrower: (timestampMs?: number) => void;
  refs: LocalPlayerFrameRefs;
}

export type LocalPlayerFrameResult =
  | { kind: 'no-player'; authorityApplied: 0; substeps: 0 }
  | { kind: 'disabled'; authorityApplied: number; substeps: 0 }
  | { kind: 'inactive'; authorityApplied: number; substeps: 0; deathCamera: boolean }
  | { kind: 'live'; authorityApplied: number; substeps: number };

interface FrameTiming {
  dt: number;
  now: number;
  frameNowMs: number;
  isPlaying: boolean;
}

interface InputPhaseResult {
  heroDef: (typeof HERO_DEFINITIONS)[HeroId] | undefined;
  bombTargetingForFrame: boolean;
  frameInput: InputState;
  localAbilityInput: InputState;
  primaryFireForServer: boolean;
  ability2ForServer: boolean;
  serverCombatInput: ServerCombatInput;
  requestedCommandScheduleReasons: CommandScheduleReason[];
  phantomPrimaryReloading: boolean;
  phantomPrimaryHeldForPose: boolean;
  chronosLifelineCommitMode: ChronosLifelineMode | null;
  chronosLifelineCommitActive: boolean;
  chronosLifelineCommitPressed: boolean;
}

interface PredictionAndCommandPhaseResult {
  predictedState: MovementSimulationState;
  wasGroundedBeforePrediction: boolean;
  currentBombTargeting: boolean;
  commandInput: InputState;
  abilityCastHints: AbilityCastOriginHint[] | undefined;
  substepsThisFrame: number;
  commandScheduleReasons: CommandScheduleReason[];
}

interface PresentationPhaseResult {
  localMovementForTrace: PlayerMovementState;
  isSliding: boolean;
  wasSlidingBeforeFrame: boolean;
}

function runPresentationPhase(input: {
  ctx: LocalPlayerFrameContext;
  localPlayer: Player;
  heroId: HeroId;
  heroStats: ReturnType<typeof getHeroStats>;
  predictedState: MovementSimulationState;
  abilityCtx: AbilityContext;
  frameInput: InputState;
  hasMovementInput: boolean;
  speedMultiplier: number;
  wasGroundedBeforePrediction: boolean;
  now: number;
  frameNowMs: number;
  dt: number;
}): PresentationPhaseResult {
  const {
    ctx,
    localPlayer,
    heroId,
    heroStats,
    predictedState,
    abilityCtx,
    frameInput,
    hasMovementInput,
    wasGroundedBeforePrediction,
    now,
    frameNowMs,
    dt,
  } = input;
  const {
    camera,
    cameraControl,
    movement,
    hookshotAbilities,
    phantomAbilities,
    playerSounds,
    movementSounds,
    refs,
  } = ctx;
  const position = refs.positionRef.current;
  const velocity = movement.refs.velocity.current;

  position.set(predictedState.position.x, predictedState.position.y, predictedState.position.z);
  velocity.set(predictedState.velocity.x, predictedState.velocity.y, predictedState.velocity.z);
  const predictedVisualPosition = getCurrentPredictedVisualPosition(predictedState.position, frameNowMs);
  const interpolatedBasePosition = sampleLocalVisualInterpolatedPosition(
    refs.localVisualInterpolationRef.current,
    predictedState.position,
    refs.movementCommandAccumulatorRef.current,
    refs.localVisualInterpolatedPositionRef.current
  );
  const visualPosition = refs.localVisualPositionRef.current;
  visualPosition.x = interpolatedBasePosition.x + (predictedVisualPosition.x - predictedState.position.x);
  visualPosition.y = interpolatedBasePosition.y + (predictedVisualPosition.y - predictedState.position.y);
  visualPosition.z = interpolatedBasePosition.z + (predictedVisualPosition.z - predictedState.position.z);
  const smoothedVisualY = smoothTerrainVisualY(
    movement.refs.smoothedY.current,
    visualPosition.y,
    dt,
    predictedState.movement.isGrounded
  );
  const smoothedVisualPosition = refs.smoothedVisualPositionRef.current;
  smoothedVisualPosition.x = visualPosition.x;
  smoothedVisualPosition.y = smoothedVisualY;
  smoothedVisualPosition.z = visualPosition.z;
  movement.refs.isGrounded.current = predictedState.movement.isGrounded;
  movement.refs.wasGrounded.current = predictedState.movement.isGrounded;
  movement.refs.canJump.current = predictedState.movement.isGrounded;
  movement.refs.isCrouching.current = predictedState.movement.isCrouching;
  movement.refs.isSprinting.current = predictedState.movement.isSprinting;
  movement.refs.isSliding.current = predictedState.movement.isSliding;
  movement.refs.slideTime.current = predictedState.movement.slideTimeRemaining;
  movement.refs.smoothedY.current = smoothedVisualY;

  const isSliding = predictedState.movement.isSliding;
  const wasSlidingBeforeFrame = refs.wasSlidingLastFrameRef.current;
  if (isSliding && !wasSlidingBeforeFrame) {
    movementSounds.startSlide();
  } else if (!isSliding && wasSlidingBeforeFrame) {
    movementSounds.stopSlide();
  }
  refs.wasSlidingLastFrameRef.current = isSliding;
  const justLanded = predictedState.movement.isGrounded && !wasGroundedBeforePrediction;
  if (heroId === 'hookshot' && predictedState.movement.isGrounded && !wasGroundedBeforePrediction) {
    hookshotAbilities.handleSwingTerrainContact();
  }

  const walkingSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
  setLocalViewmodelMovement({
    hasMovementInput,
    isSprinting: movement.refs.isSprinting.current || frameInput.sprint,
    horizontalSpeed: walkingSpeed,
    updatedAtMs: now,
  });
  movementSounds.updateWalkingSound(walkingSpeed, movement.refs.isGrounded.current, isSliding, heroStats.moveSpeed, justLanded);

  cameraControl.updateCameraRotation(camera, isSliding, movement.refs.isCrouching.current, dt);
  const cameraBodyY = movement.refs.smoothedY.current ?? smoothedVisualPosition.y;
  camera.position.set(smoothedVisualPosition.x, cameraBodyY + EYE_HEIGHT + cameraControl.refs.crouchHeight.current, smoothedVisualPosition.z);
  camera.updateMatrixWorld();
  camera.getWorldDirection(refs.audioForwardRef.current);
  refs.audioUpRef.current.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  setAudioListenerTransform(camera.position, refs.audioForwardRef.current, refs.audioUpRef.current);

  if (heroId === 'phantom') {
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
  setPlayerVisualTransform(localPlayer.id, smoothedVisualPosition, cameraControl.refs.yaw.current);

  const slideIntensity = isSliding
    ? Math.min(1, Math.max(0.25, predictedState.movement.slideTimeRemaining / 0.8))
    : 0;
  setLocalSlideIntensity(slideIntensity, {
    x: velocity.x,
    y: velocity.y,
    z: velocity.z,
  }, cameraControl.refs.yaw.current);

  return {
    localMovementForTrace,
    isSliding,
    wasSlidingBeforeFrame,
  };
}

function runTracePhase(input: {
  ctx: LocalPlayerFrameContext;
  localPlayer: Player;
  heroId: HeroId;
  heroDef: (typeof HERO_DEFINITIONS)[HeroId] | undefined;
  frameInput: InputState;
  commandInput: InputState;
  localMovementForTrace: PlayerMovementState;
  isSliding: boolean;
  wasSlidingBeforeFrame: boolean;
  speedMultiplier: number;
  now: number;
  dt: number;
}): void {
  const {
    ctx,
    localPlayer,
    heroId,
    heroDef,
    frameInput,
    commandInput,
    localMovementForTrace,
    isSliding,
    wasSlidingBeforeFrame,
    speedMultiplier,
    now,
    dt,
  } = input;
  const { bombTargeting, grappleTrapTargeting, cameraControl, movement, refs } = ctx;
  const position = refs.positionRef.current;
  const velocity = movement.refs.velocity.current;

  if (now - refs.lastTraceRef.current < 1000 / TICK_RATE) return;

  refs.lastTraceRef.current = now;
  const storeForTrace = useGameStore.getState();
  const traceAbilityIds = writeActiveAbilityIdsForTrace(localPlayer.abilities, refs.traceAbilityIdsRef.current);
  if (frameInput.ability1) pushUniqueTraceAbilityId(traceAbilityIds, heroDef?.ability1.abilityId);
  if (frameInput.ability2) pushUniqueTraceAbilityId(traceAbilityIds, heroDef?.ability2.abilityId);
  if (frameInput.ultimate) pushUniqueTraceAbilityId(traceAbilityIds, heroDef?.ultimate.abilityId);
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
    flagCarrier: localPlayer.hasFlag,
  });
  const traceMovementBarrier = heroId === 'phantom' && frameInput.ability1
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
    tick: refs.tickRef.current,
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
      movementBarrier: traceMovementBarrier === 'teleport' ||
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
    crouchPressed: isSliding && !wasSlidingBeforeFrame,
    correctionReason: traceMovementBarrier ?? undefined,
  });
}

export function runPredictionAndCommandPhase(input: {
  ctx: LocalPlayerFrameContext;
  localPlayer: Player;
  heroId: HeroId;
  frameInput: InputState;
  serverCombatInput: ServerCombatInput;
  requestedCommandScheduleReasons: CommandScheduleReason[];
  abilityCtx: AbilityContext;
  predictedState: MovementSimulationState;
  now: number;
  dt: number;
  rawDelta: number;
}): PredictionAndCommandPhaseResult {
  const {
    ctx,
    localPlayer,
    heroId,
    frameInput,
    serverCombatInput,
    requestedCommandScheduleReasons,
    abilityCtx,
    now,
    dt,
    rawDelta,
  } = input;
  const { cameraControl, phantomAbilities, flushMovementCommands, refs } = ctx;
  let { predictedState } = input;
  const wasGroundedBeforePrediction = predictedState.movement.isGrounded;
  const currentBombTargeting = useGameStore.getState().bombTargeting;
  const phantomAutoReloadForServer = heroId === 'phantom' &&
    phantomAbilities.phantomPrimaryReloadingRef.current &&
    phantomAbilities.phantomPrimaryAmmoRef.current <= 0;
  const reloadForServer = frameInput.reload ||
    refs.pendingReloadInputRef.current ||
    (phantomAutoReloadForServer && !serverCombatInput.primaryFire);
  const crouchHeld = frameInput.crouch || ctx.isControlPressed;
  if (crouchHeld && !refs.lastCrouchHeldRef.current) {
    refs.pendingCrouchPressedRef.current = true;
  }
  refs.lastCrouchHeldRef.current = crouchHeld;

  const commandInput: InputState = {
    ...frameInput,
    crouch: crouchHeld,
    primaryFire: heroId === 'blaze' && currentBombTargeting ? false : serverCombatInput.primaryFire,
    secondaryFire: serverCombatInput.secondaryFire,
    ability1: serverCombatInput.ability1,
    reload: reloadForServer,
    ability2: serverCombatInput.ability2,
    ultimate: serverCombatInput.ultimate,
  };
  const abilityCastHints = buildAbilityCastOriginHints(abilityCtx, commandInput, {
    bombTargeting: currentBombTargeting,
  });
  refs.latestAbilityCastHintsRef.current = abilityCastHints ?? [];

  const commandScheduleReasons = [...requestedCommandScheduleReasons];
  if (shouldForceImmediateCombatCommand(serverCombatInput, refs.lastServerCombatInputRef.current)) {
    addCommandScheduleReason(commandScheduleReasons, 'combat_edge');
  }
  refs.lastServerCombatInputRef.current = serverCombatInput;
  const commandSchedule = resolveCommandSchedule(commandScheduleReasons);
  if (commandSchedule.flushExistingBeforeSample) {
    flushMovementCommands(now, true);
  }

  refs.movementCommandAccumulatorRef.current = Math.min(
    refs.movementCommandAccumulatorRef.current + dt,
    MOVEMENT_SUBSTEP_SECONDS * MOVEMENT_MAX_PACKET_COMMANDS
  );
  if (commandSchedule.forceSubstep) {
    refs.movementCommandAccumulatorRef.current = Math.max(
      refs.movementCommandAccumulatorRef.current,
      MOVEMENT_SUBSTEP_SECONDS
    );
  }
  const movementAccumulatorBeforeStep = refs.movementCommandAccumulatorRef.current;

  let substepsThisFrame = 0;
  while (
    refs.movementCommandAccumulatorRef.current >= MOVEMENT_SUBSTEP_SECONDS &&
    substepsThisFrame < MOVEMENT_MAX_PACKET_COMMANDS
  ) {
    const previousStepPosition = predictedState.position;
    const command = createLocalMovementCommand(commandInput, {
      lookYaw: cameraControl.refs.yaw.current,
      lookPitch: cameraControl.refs.pitch.current,
      clientTimeMs: now,
      crouchPressed: refs.pendingCrouchPressedRef.current,
      abilityCastHints,
    });
    recordMovementCommandGenerated();
    refs.pendingCrouchPressedRef.current = false;
    refs.pendingMovementCommandsRef.current.push(command);
    const nextPredictedState = stepLocalMovementPrediction(localPlayer, command);
    recordLocalVisualFixedStep(
      refs.localVisualInterpolationRef.current,
      previousStepPosition,
      nextPredictedState.position
    );
    predictedState = nextPredictedState;
    refs.movementCommandAccumulatorRef.current -= MOVEMENT_SUBSTEP_SECONDS;
    refs.tickRef.current = command.seq;
    substepsThisFrame++;
  }
  recordMovementFrameTiming({
    frameDeltaSeconds: rawDelta,
    movementDeltaSeconds: dt,
    substepsThisFrame,
    accumulatorBeforeStepSeconds: movementAccumulatorBeforeStep,
    accumulatorAfterStepSeconds: refs.movementCommandAccumulatorRef.current,
    catchup: substepsThisFrame > 1,
  });
  flushMovementCommands(now, commandSchedule.forcePacketFlush);
  refs.pendingReloadInputRef.current = false;

  return {
    predictedState,
    wasGroundedBeforePrediction,
    currentBombTargeting,
    commandInput,
    abilityCastHints,
    substepsThisFrame,
    commandScheduleReasons,
  };
}

export function runInputPhase(
  ctx: LocalPlayerFrameContext,
  localPlayer: Player,
  heroId: HeroId,
  rawFrameInput: InputState,
  initialFrameInput: InputState,
  now: number
): InputPhaseResult {
  const {
    abilitySystem,
    phantomAbilities,
    lockHeroActions,
    isHeroActionLocked,
    refs,
  } = ctx;

  const heroDef = HERO_DEFINITIONS[heroId];
  const bombTargetingForFrame = useGameStore.getState().bombTargeting;
  const previousHoldInput = refs.lastExclusiveHoldInputRef.current;
  const chronosLifelineQueuedAtFrameStart = heroId === 'chronos' && refs.chronosLifelineQueuedRef.current;
  if (!rawFrameInput.primaryFire) {
    refs.chronosLifelineBlockPrimaryRef.current = false;
  }
  if (!rawFrameInput.secondaryFire) {
    refs.chronosLifelineBlockSecondaryRef.current = false;
  }
  let chronosLifelineCommitMode: ChronosLifelineMode | null = null;
  if (chronosLifelineQueuedAtFrameStart && !isHeroActionLocked(heroId, now)) {
    if (rawFrameInput.primaryFire && !refs.chronosLifelineBlockPrimaryRef.current) {
      chronosLifelineCommitMode = 'allies';
    } else if (rawFrameInput.secondaryFire && !refs.chronosLifelineBlockSecondaryRef.current) {
      chronosLifelineCommitMode = 'self';
    }
  }
  const chronosLifelineCommitActive = chronosLifelineCommitMode !== null;
  const chronosLifelineCommitPressed = chronosLifelineCommitActive && !refs.chronosLifelineCommitHeldRef.current;
  refs.chronosLifelineCommitHeldRef.current = chronosLifelineCommitActive;

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
  let frameInput = initialFrameInput;
  if (chronosLifelineQueuedAtFrameStart) {
    frameInput = chronosLifelineCommitMode === 'allies'
      ? withCastActionFields(rawFrameInput, { primaryFire: true, ability1: true })
      : chronosLifelineCommitMode === 'self'
        ? withCastActionFields(rawFrameInput, { secondaryFire: true, ability1: true })
        : withCastActionFields(rawFrameInput);
  } else {
    frameInput = getExclusiveHeroInput(
      heroId,
      rawFrameInput,
      isHeroActionLocked(heroId, now),
      heroId === 'blaze' && bombTargetingForFrame,
      continuingHoldInput,
      lockedAllowedInput
    );
    if (heroId === 'chronos' && frameInput.ability1) {
      frameInput = withCastActionFields(frameInput);
    }
  }
  refs.lastExclusiveHoldInputRef.current = getExclusiveHoldInput(frameInput);

  const reloadPressed = frameInput.reload && !refs.reloadPressedRef.current;
  refs.reloadPressedRef.current = frameInput.reload;
  if (reloadPressed) {
    refs.pendingReloadInputRef.current = true;
  }
  if (heroId === 'phantom') {
    phantomAbilities.updatePhantomPrimaryReload(now);
    if (reloadPressed) {
      phantomAbilities.reloadPhantomPrimary(now);
    }
  }

  const phantomPrimaryReloading = heroId === 'phantom' && phantomAbilities.phantomPrimaryReloadingRef.current;
  const phantomReloadBlocksNonBlinkCasts = heroId === 'phantom' && phantomPrimaryReloading;
  const localAbilityInput = phantomReloadBlocksNonBlinkCasts
    ? {
      ...frameInput,
      secondaryFire: false,
      ability2: false,
      ultimate: false,
    }
    : frameInput;
  const phantomPrimaryHeldForPose = (
    heroId === 'phantom' &&
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
  const ability2ForServer = frameInput.ability2;
  const serverCombatInput = deriveServerCombatInput({
    frameInput,
    primaryFireForServer,
    ability2ForServer,
  });
  const requestedCommandScheduleReasons: CommandScheduleReason[] = [];
  const movementBarrierInputPressed = (
    // Blaze Q stays on normal command cadence; forced flushes can bundle the rocket impulse with a movement burst.
    (heroId === 'phantom' && frameInput.ability1 && !abilitySystem.abilityPressedRef.current.ability1) ||
    (heroId === 'chronos' && frameInput.ultimate && !abilitySystem.abilityPressedRef.current.ultimate)
  );
  if (movementBarrierInputPressed) {
    requestedCommandScheduleReasons.push('movement_barrier');
  }

  return {
    heroDef,
    bombTargetingForFrame,
    frameInput,
    localAbilityInput,
    primaryFireForServer,
    ability2ForServer,
    serverCombatInput,
    requestedCommandScheduleReasons,
    phantomPrimaryReloading,
    phantomPrimaryHeldForPose,
    chronosLifelineCommitMode,
    chronosLifelineCommitActive,
    chronosLifelineCommitPressed,
  };
}

function runNoLocalPlayerFrame(ctx: LocalPlayerFrameContext, now: number): LocalPlayerFrameResult {
  const {
    camera,
    cameraControl,
    movement,
    phantomAbilities,
    blazeAbilities,
    resetPredictedAbilitySounds,
    resetViewmodelPoseState,
    resetBlazeFlamethrower,
    resetMovementCommandBuffer,
    clearHeroActionLock,
    refs,
  } = ctx;

  setLocalViewmodelMovement({
    hasMovementInput: false,
    isSprinting: false,
    horizontalSpeed: 0,
    updatedAtMs: now,
  });
  resetViewmodelPoseState('no-local-player', null, now);
  resetBlazeFlamethrower(now);
  refs.reloadPressedRef.current = false;
  refs.pendingReloadInputRef.current = false;
  resetMovementCommandBuffer();
  movement.refs.slideIntensity.current = 0;
  setLocalSlideIntensity(0);
  setLocalVisualMovement(INACTIVE_LOCAL_MOVEMENT);
  resetPredictedAbilitySounds();
  refs.lastExclusiveHoldInputRef.current = { ...EMPTY_EXCLUSIVE_HOLD_INPUT };
  clearHeroActionLock();
  phantomAbilities.resetPhantomPrimaryMagazine();
  blazeAbilities.resetRocketJump();
  cameraControl.resetDeathCamera(camera);
  return { kind: 'no-player', authorityApplied: 0, substeps: 0 };
}

function selectReactiveAuthority(
  appliedAuthorities: ReturnType<typeof drainSelfMovementAuthorities>
) {
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
  return reactiveAuthority;
}

function shouldApplyReactiveAuthority(
  application: ReturnType<typeof drainSelfMovementAuthorities>[number] | null
): boolean {
  return Boolean(
    application &&
    (
      (application.authority.correctionReason && application.authority.correctionReason !== 'normal') ||
      application.result.mediumCorrection ||
      application.result.hardCorrection
    )
  );
}

const AUTHORITY_RESOURCE_EPSILON = 0.01;

function syncBlazeAuthorityMovementAnchor(
  localPlayer: Player,
  movement: MovementSimulationState['movement']
): Player {
  if (localPlayer.heroId !== 'blaze') return localPlayer;

  const jetpackFuel = Math.max(0, Math.min(BLAZE_FLAMETHROWER_MAX_FUEL, movement.jetpackFuel));
  const isJetpacking = movement.isJetpacking;
  if (
    localPlayer.movement.isJetpacking === isJetpacking &&
    Math.abs(localPlayer.movement.jetpackFuel - jetpackFuel) < AUTHORITY_RESOURCE_EPSILON
  ) {
    return localPlayer;
  }

  let syncedPlayer: Player = {
    ...localPlayer,
    movement: {
      ...localPlayer.movement,
      isJetpacking,
      jetpackFuel,
    },
  };

  useGameStore.setState((state) => {
    if (!state.localPlayer || state.localPlayer.id !== localPlayer.id) return state;

    syncedPlayer = {
      ...state.localPlayer,
      movement: {
        ...state.localPlayer.movement,
        isJetpacking,
        jetpackFuel,
      },
    };
    const players = new Map(state.players);
    players.set(syncedPlayer.id, syncedPlayer);

    return {
      localPlayer: syncedPlayer,
      players,
    };
  });

  return syncedPlayer;
}

function runAuthorityPhase(
  ctx: LocalPlayerFrameContext,
  localPlayer: Player,
  frameNowMs: number
): { localPlayer: Player; authorityApplied: number } {
  const { updateLocalPlayer, resetMovementCommandBuffer } = ctx;
  const pendingAuthoritiesBeforeDrain = getPendingSelfMovementAuthorityCount();
  const authorityDrainStartedAt = pendingAuthoritiesBeforeDrain > 0 ? performance.now() : 0;
  const appliedAuthorities = drainSelfMovementAuthorities(localPlayer, frameNowMs);
  if (pendingAuthoritiesBeforeDrain > 0) {
    recordAuthorityDrainFrame({
      pendingBeforeDrain: pendingAuthoritiesBeforeDrain,
      appliedCount: appliedAuthorities.length,
      durationMs: Math.max(0, performance.now() - authorityDrainStartedAt),
    });
  }
  if (appliedAuthorities.length === 0) {
    return { localPlayer, authorityApplied: 0 };
  }

  localPlayer = syncBlazeAuthorityMovementAnchor(
    localPlayer,
    appliedAuthorities[appliedAuthorities.length - 1].state.movement
  );

  authorityMetricsScratch.length = 0;
  for (const application of appliedAuthorities) {
    authorityMetricsScratch.push(application.result);
  }
  recordAuthorityFrameApplied(authorityMetricsScratch);
  authorityMetricsScratch.length = 0;
  if (appliedAuthorities.some((application) => (
    application.authority.correctionReason &&
    application.authority.correctionReason !== 'normal'
  ))) {
    resetMovementCommandBuffer();
  }

  const reactiveAuthority = selectReactiveAuthority(appliedAuthorities);
  if (!shouldApplyReactiveAuthority(reactiveAuthority)) {
    return { localPlayer, authorityApplied: appliedAuthorities.length };
  }

  const updates = {
    position: { ...reactiveAuthority!.state.position },
    velocity: { ...reactiveAuthority!.state.velocity },
    lookYaw: reactiveAuthority!.authority.lookYaw,
    lookPitch: reactiveAuthority!.authority.lookPitch,
    movement: {
      ...reactiveAuthority!.state.movement,
      grapplePoint: reactiveAuthority!.state.movement.grapplePoint
        ? { ...reactiveAuthority!.state.movement.grapplePoint }
        : null,
    },
  };
  updateLocalPlayer(updates);
  recordLocalReactiveUpdate('selfAuthority');
  return {
    localPlayer: { ...localPlayer, ...updates },
    authorityApplied: appliedAuthorities.length,
  };
}

function runHeroSwapPhase(ctx: LocalPlayerFrameContext, localPlayer: Player, now: number): void {
  const {
    abilitySystem,
    hookshotAbilities,
    phantomAbilities,
    blazeAbilities,
    resetMovementCommandBuffer,
    resetPredictedAbilitySounds,
    clearHeroActionLock,
    setBombTargeting,
    setGrappleTrapTargeting,
    setFlamethrowerActive,
    resetViewmodelPoseState,
    resetBlazeFlamethrower,
    refs,
  } = ctx;

  if (refs.lastHeroIdRef.current === localPlayer.heroId) return;

  refs.lastHeroIdRef.current = localPlayer.heroId;
  abilitySystem.abilityPressedRef.current = { ability1: false, ability2: false, ultimate: false };
  abilitySystem.clientCooldownsRef.current = {};
  abilitySystem.clientChargesRef.current = {};
  abilitySystem.abilityActiveRef.current = {};
  refs.reloadPressedRef.current = false;
  refs.pendingReloadInputRef.current = false;
  resetMovementCommandBuffer();
  resetPredictedAbilitySounds();
  refs.lastExclusiveHoldInputRef.current = { ...EMPTY_EXCLUSIVE_HOLD_INPUT };
  clearHeroActionLock();
  hookshotAbilities.secondaryFirePressedRef.current = false;
  setChronosAegisVisualState(localPlayer.id, false, now);
  setBombTargeting(false, false);
  setGrappleTrapTargeting(false, false);
  setFlamethrowerActive(false);
  phantomAbilities.resetPhantomPrimaryMagazine();
  resetViewmodelPoseState('hero-swap', localPlayer.heroId as HeroId, now);
  resetBlazeFlamethrower(now);
  blazeAbilities.resetRocketJump();
}

function runDisabledLifecycleFrame(
  ctx: LocalPlayerFrameContext,
  localPlayer: Player,
  timing: FrameTiming,
  authorityApplied: number
): LocalPlayerFrameResult {
  const {
    camera,
    cameraControl,
    movement,
    resetPredictedAbilitySounds,
    resetViewmodelPoseState,
    resetBlazeFlamethrower,
    resetMovementCommandBuffer,
    clearHeroActionLock,
    blazeAbilities,
    refs,
  } = ctx;
  const { dt, now } = timing;

  setLocalViewmodelMovement({
    hasMovementInput: false,
    isSprinting: false,
    horizontalSpeed: 0,
    updatedAtMs: now,
  });
  resetViewmodelPoseState('disabled', localPlayer.heroId as HeroId, now);
  setChronosAegisVisualState(localPlayer.id, false, now);
  resetBlazeFlamethrower(now);
  refs.reloadPressedRef.current = false;
  refs.pendingReloadInputRef.current = false;
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
  resetPredictedAbilitySounds();
  refs.lastExclusiveHoldInputRef.current = { ...EMPTY_EXCLUSIVE_HOLD_INPUT };
  clearHeroActionLock();
  blazeAbilities.resetRocketJump();
  cameraControl.resetDeathCamera(camera);

  const visualPos = visualStore.getState().playerPositions.get(localPlayer.id) || localPlayer.position;
  cameraControl.updateCameraRotation(camera, false, false, dt);
  camera.position.set(visualPos.x, visualPos.y + EYE_HEIGHT + cameraControl.refs.crouchHeight.current, visualPos.z);
  setPlayerVisualTransform(localPlayer.id, visualPos, cameraControl.refs.yaw.current);
  return { kind: 'disabled', authorityApplied, substeps: 0 };
}

function runInactiveLifecycleFrame(
  ctx: LocalPlayerFrameContext,
  localPlayer: Player,
  timing: FrameTiming,
  frameInput: InputState,
  hasLocalDeathVisual: boolean,
  localDeathVisual: ReturnType<typeof getDeathVisualForPlayer>,
  authorityApplied: number
): LocalPlayerFrameResult {
  const {
    camera,
    cameraControl,
    movement,
    resetPredictedAbilitySounds,
    resetViewmodelPoseState,
    resetBlazeFlamethrower,
    resetMovementCommandBuffer,
    clearHeroActionLock,
    blazeAbilities,
    refs,
  } = ctx;
  const { dt, now, isPlaying } = timing;

  setLocalViewmodelMovement({
    hasMovementInput: false,
    isSprinting: false,
    horizontalSpeed: 0,
    updatedAtMs: now,
  });
  resetViewmodelPoseState('inactive-player', localPlayer.heroId as HeroId, now);
  setChronosAegisVisualState(localPlayer.id, false, now);
  resetBlazeFlamethrower(now);
  refs.reloadPressedRef.current = frameInput.reload;
  refs.pendingReloadInputRef.current = false;
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
  resetPredictedAbilitySounds();
  refs.lastExclusiveHoldInputRef.current = { ...EMPTY_EXCLUSIVE_HOLD_INPUT };
  clearHeroActionLock();
  blazeAbilities.resetRocketJump();
  const visualPos = visualStore.getState().playerPositions.get(localPlayer.id) || localPlayer.position;
  const shouldUseDeathCamera = isPlaying && (hasLocalDeathVisual || localPlayer.state === 'dead');
  if (shouldUseDeathCamera) {
    if (!cameraControl.isDeathCameraActive()) {
      cameraControl.startDeathCamera(camera, visualPos, {
        nowMs: now,
        sourceDirection: localDeathVisual?.sourceDirection ?? null,
      });
    }
    cameraControl.updateDeathCamera(camera, visualPos, dt, now);
  } else {
    cameraControl.updateCameraRotation(camera, false, false, dt);
    camera.position.set(visualPos.x, visualPos.y + EYE_HEIGHT + cameraControl.refs.crouchHeight.current, visualPos.z);
  }
  camera.updateMatrixWorld();
  camera.getWorldDirection(refs.audioForwardRef.current);
  refs.audioUpRef.current.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  setAudioListenerTransform(camera.position, refs.audioForwardRef.current, refs.audioUpRef.current);
  setPlayerVisualTransform(localPlayer.id, visualPos, cameraControl.refs.yaw.current);
  return { kind: 'inactive', authorityApplied, substeps: 0, deathCamera: shouldUseDeathCamera };
}

export function PlayerController({ enabled = true }: PlayerControllerProps) {
  const { camera } = useThree();

  // Store state and actions
  const updateLocalPlayer = useGameStore(state => state.updateLocalPlayer);
  const setBombTargeting = useGameStore(state => state.setBombTargeting);
  const bombTargeting = useGameStore(state => state.bombTargeting);
  const setFlamethrowerActive = useGameStore(state => state.setFlamethrowerActive);
  const setFlamethrowerFuel = useGameStore(state => state.setFlamethrowerFuel);
  const gamePhase = useGameStore(state => state.gamePhase);
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
    playPhantomBlink, playPhantomVeil, playPhantomBasic, playPhantomVoidRay,
    startPhantomVoidRayCharge, stopPhantomVoidRayCharge,
    playBlazeRocket, playBlazeBombTarget, playBlazeBombRelease, playBlazeBombFall, playBlazeBombExplode, playBlazeRocketJump,
    startFlamethrowerSound, stopFlamethrowerSound,
  } = useAbilitySounds();
  const { updateWalkingSound, preloadWalkingSound, startSlide, stopSlide } = useMovementSounds();

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
  const localVisualInterpolationRef = useRef(createLocalVisualInterpolationState());
  const localVisualInterpolatedPositionRef = useRef({ x: 0, y: 0, z: 0 });
  const localVisualPositionRef = useRef({ x: 0, y: 0, z: 0 });
  const smoothedVisualPositionRef = useRef({ x: 0, y: 0, z: 0 });
  const latestAbilityCastHintsRef = useRef<AbilityCastOriginHint[]>([]);
  const lastCrouchHeldRef = useRef(false);
  const pendingCrouchPressedRef = useRef(false);
  const lastHeroIdRef = useRef<string | null>(null);
  const reloadPressedRef = useRef(false);
  const pendingReloadInputRef = useRef(false);
  const wasSlidingLastFrameRef = useRef(false);
  const lastViewmodelPoseResetKeyRef = useRef<string | null>(null);
  const actionLockUntilRef = useRef(0);
  const lastExclusiveHoldInputRef = useRef<ExclusiveHoldInput>({
    ...EMPTY_EXCLUSIVE_HOLD_INPUT,
  });
  const lastServerCombatInputRef = useRef<ServerCombatInput>({
    ...EMPTY_SERVER_COMBAT_INPUT,
  });
  const chronosLifelineQueuedRef = useRef(false);
  const chronosLifelineBlockPrimaryRef = useRef(false);
  const chronosLifelineBlockSecondaryRef = useRef(false);
  const chronosLifelineCommitHeldRef = useRef(false);
  const positionRef = useRef(new THREE.Vector3());
  const audioForwardRef = useRef(new THREE.Vector3());
  const audioUpRef = useRef(new THREE.Vector3(0, 1, 0));
  const frameContextRef = useRef<LocalPlayerFrameContext | null>(null);

  const resetMovementCommandBuffer = useCallback(() => {
    movementCommandAccumulatorRef.current = 0;
    pendingMovementCommandsRef.current = [];
    lastCrouchHeldRef.current = false;
    pendingCrouchPressedRef.current = false;
    lastServerCombatInputRef.current = { ...EMPTY_SERVER_COMBAT_INPUT };
    if (wasSlidingLastFrameRef.current) {
      stopSlide();
    }
    wasSlidingLastFrameRef.current = false;
    localVisualInterpolationRef.current.initialized = false;
  }, [stopSlide]);

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

  const setChronosLifelineQueuedState = useCallback((
    queued: boolean,
    timestampMs = Date.now(),
    input?: Pick<InputState, 'primaryFire' | 'secondaryFire'>
  ) => {
    chronosLifelineQueuedRef.current = queued;
    chronosLifelineBlockPrimaryRef.current = queued && Boolean(input?.primaryFire);
    chronosLifelineBlockSecondaryRef.current = queued && Boolean(input?.secondaryFire);
    chronosLifelineCommitHeldRef.current = false;
    setChronosLifelineQueued(queued, timestampMs);
  }, []);

  const isHeroActionLocked = useCallback((heroId: HeroId, timestampMs = Date.now()) => (
    heroId === 'blaze'
      ? isBlazeActionLocked(timestampMs)
      : actionLockUntilRef.current > timestampMs
  ), [isBlazeActionLocked]);

  const flushMovementCommands = useCallback((nowMs: number, force = false) => {
    const pending = pendingMovementCommandsRef.current;
    if (pending.length === 0) return;
    if (
      !force &&
      pending.length < MOVEMENT_COMMAND_TARGET_PACKET_SIZE &&
      nowMs - lastSendRef.current < MOVEMENT_COMMAND_MAX_FLUSH_AGE_MS
    ) {
      return;
    }

    do {
      const pendingBeforeFlush = pending.length;
      const packetSize = Math.min(pending.length, MOVEMENT_MAX_PACKET_COMMANDS);
      const packetCommands = pending.splice(0, packetSize);
      sendMovementCommands(createMovementCommandPacket(packetCommands));
      recordMovementCommandsSent(packetCommands.length, pendingBeforeFlush);
    } while (force && pending.length > 0);
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

    return false;
  }, []);

  const getChronosPracticeLifelineTargets = useCallback((
    mode: ChronosLifelineMode,
    healAmount: number
  ): ChronosPracticeLifelineTarget[] => {
    const store = useGameStore.getState();
    const localPlayer = store.localPlayer;
    if (!localPlayer || localPlayer.state !== 'alive') return [];

    if (mode === 'self') {
      return [{
        id: localPlayer.id,
        position: { ...localPlayer.position },
        isLocal: true,
        newHealth: Math.min(localPlayer.maxHealth, localPlayer.health + healAmount),
      }];
    }

    const origin = visualStore.getState().playerPositions.get(localPlayer.id) ?? localPlayer.position;
    const radiusSq = CHRONOS_LIFELINE_RADIUS * CHRONOS_LIFELINE_RADIUS;
    const candidates: Array<ChronosPracticeLifelineTarget & { distanceSq: number; healthScore: number }> = [];

    for (const candidate of store.players.values()) {
      if (candidate.id === localPlayer.id) continue;
      if (candidate.state !== 'alive') continue;
      if (candidate.team !== localPlayer.team) continue;

      const dx = candidate.position.x - origin.x;
      const dy = candidate.position.y - origin.y;
      const dz = candidate.position.z - origin.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq > radiusSq) continue;

      candidates.push({
        id: candidate.id,
        position: { ...candidate.position },
        isLocal: false,
        newHealth: Math.min(candidate.maxHealth, candidate.health + healAmount),
        distanceSq,
        healthScore: candidate.health / Math.max(1, candidate.maxHealth),
      });
    }

    candidates.sort((a, b) => (
      a.healthScore === b.healthScore
        ? a.distanceSq - b.distanceSq
        : a.healthScore - b.healthScore
    ));

    return candidates
      .slice(0, CHRONOS_LIFELINE_MAX_TARGETS)
      .map((target) => ({
        id: target.id,
        position: target.position,
        isLocal: target.isLocal,
        newHealth: target.newHealth,
      }));
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
  const playerSounds = useMemo(() => ({
    playPhantomBlink, playPhantomVeil, playPhantomBasic, playPhantomVoidRay,
    startPhantomVoidRayCharge, stopPhantomVoidRayCharge,
    playBlazeRocket, playBlazeBombTarget, playBlazeBombRelease, playBlazeBombFall, playBlazeBombExplode, playBlazeRocketJump,
    startFlamethrowerSound, stopFlamethrowerSound,
  }), [
    playPhantomBlink,
    playPhantomVeil,
    playPhantomBasic,
    playPhantomVoidRay,
    startPhantomVoidRayCharge,
    stopPhantomVoidRayCharge,
    playBlazeRocket,
    playBlazeBombTarget,
    playBlazeBombRelease,
    playBlazeBombFall,
    playBlazeBombExplode,
    playBlazeRocketJump,
    startFlamethrowerSound,
    stopFlamethrowerSound,
  ]);

  const resetViewmodelPoseState = useCallback((reason: string, heroId: HeroId | null, timestampMs = Date.now()) => {
    const resetKey = `${reason}:${heroId ?? 'none'}`;
    if (lastViewmodelPoseResetKeyRef.current === resetKey) return;

    lastViewmodelPoseResetKeyRef.current = resetKey;
    resetViewmodelPoseRuntime(defaultViewmodelPoseRuntime, heroId);
    setPhantomPrimaryHeld(false, timestampMs);
    setBlazeRocketHeld(false, timestampMs);
    setBlazeBombTargetHeld(false, timestampMs);
    setChronosPrimaryHeld(false, timestampMs);
    setChronosLifelineQueuedState(false, timestampMs);
  }, [setChronosLifelineQueuedState]);

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
      resetMovementCommandBuffer();
      resetBlazeFlamethrower();
      resetViewmodelPoseState('unmount', lastHeroIdRef.current as HeroId | null);
      lastExclusiveHoldInputRef.current = { ...EMPTY_EXCLUSIVE_HOLD_INPUT };
      clearHeroActionLock();
      setChronosPrimaryHeld(false);
      setChronosLifelineQueuedState(false);
    };
  }, [clearHeroActionLock, resetBlazeFlamethrower, resetMovementCommandBuffer, resetViewmodelPoseState, setChronosLifelineQueuedState]);

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
    enabled, isPointerLocked, requestPointerLock, bombTargeting, grappleTrapTargeting,
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
      const isBombTargeting = store.bombTargeting;
      const isGrappleTrapTargeting = store.grappleTrapTargeting;

      if (!isBombTargeting && !isGrappleTrapTargeting) return;

      const isRightClick = e instanceof MouseEvent && e.button === 2;
      const isEscape = e instanceof KeyboardEvent && e.code === 'Escape';
      if (isRightClick || isEscape) {
        e.preventDefault();

        if (isBombTargeting && isEscape) {
          store.setBombTargeting(false, false);
          blazeAbilities.bombTargetRef.current = null;
          blazeAbilities.bombValidRef.current = false;
          setBlazeBombTargetHeld(false);
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
      if (store.bombTargeting || store.grappleTrapTargeting) {
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

  const runLocalPlayerFrame = (frameState: RootState, delta: number) => {
    let frameCtx = frameContextRef.current;
    if (!frameCtx) {
      frameCtx = {
      enabled,
      frameState,
      delta,
      camera,
      gamePhase,
      inputState,
      isPointerLocked,
      isControlPressed,
      isTouchInputActive,
      bombTargeting,
      grappleTrapTargeting,
      isPracticeMode,
      updateLocalPlayer,
      setBombTargeting,
      setFlamethrowerActive,
      setFlamethrowerFuel,
      setGrappleTrapTargeting,
      sendMovementCommands,
      cameraControl,
      movement,
      abilitySystem,
      phantomAbilities,
      blazeAbilities,
      hookshotAbilities,
      chronosAbilities,
      playerSounds,
      movementSounds: {
        updateWalkingSound,
        startSlide,
        stopSlide,
      },
      resetPredictedAbilitySounds,
      updatePredictedAbilitySounds,
      resetMovementCommandBuffer,
      lockHeroActions,
      clearHeroActionLock,
      setChronosLifelineQueuedState,
      isHeroActionLocked,
      flushMovementCommands,
      hasChronosLifelineTarget,
      getChronosPracticeLifelineTargets,
      resetViewmodelPoseState,
      resetBlazeFlamethrower,
      refs: {
        tickRef,
        lastTraceRef,
        traceAbilityIdsRef,
        movementCommandAccumulatorRef,
        pendingMovementCommandsRef,
        localVisualInterpolationRef,
        localVisualInterpolatedPositionRef,
        localVisualPositionRef,
        smoothedVisualPositionRef,
        latestAbilityCastHintsRef,
        lastCrouchHeldRef,
        pendingCrouchPressedRef,
        lastHeroIdRef,
        reloadPressedRef,
        pendingReloadInputRef,
        wasSlidingLastFrameRef,
        lastExclusiveHoldInputRef,
        lastServerCombatInputRef,
        chronosLifelineQueuedRef,
        chronosLifelineBlockPrimaryRef,
        chronosLifelineBlockSecondaryRef,
        chronosLifelineCommitHeldRef,
        positionRef,
        audioForwardRef,
        audioUpRef,
        cachedHeroStatsRef,
      },
    };
      frameContextRef.current = frameCtx;
    } else {
      frameCtx.enabled = enabled;
      frameCtx.frameState = frameState;
      frameCtx.delta = delta;
      frameCtx.camera = camera;
      frameCtx.gamePhase = gamePhase;
      frameCtx.inputState = inputState;
      frameCtx.isPointerLocked = isPointerLocked;
      frameCtx.isControlPressed = isControlPressed;
      frameCtx.isTouchInputActive = isTouchInputActive;
      frameCtx.bombTargeting = bombTargeting;
      frameCtx.grappleTrapTargeting = grappleTrapTargeting;
      frameCtx.isPracticeMode = isPracticeMode;
      frameCtx.updateLocalPlayer = updateLocalPlayer;
      frameCtx.setBombTargeting = setBombTargeting;
      frameCtx.setFlamethrowerActive = setFlamethrowerActive;
      frameCtx.setFlamethrowerFuel = setFlamethrowerFuel;
      frameCtx.setGrappleTrapTargeting = setGrappleTrapTargeting;
      frameCtx.sendMovementCommands = sendMovementCommands;
      frameCtx.cameraControl = cameraControl;
      frameCtx.movement = movement;
      frameCtx.abilitySystem = abilitySystem;
      frameCtx.phantomAbilities = phantomAbilities;
      frameCtx.blazeAbilities = blazeAbilities;
      frameCtx.hookshotAbilities = hookshotAbilities;
      frameCtx.chronosAbilities = chronosAbilities;
      frameCtx.playerSounds = playerSounds;
      frameCtx.movementSounds.updateWalkingSound = updateWalkingSound;
      frameCtx.movementSounds.startSlide = startSlide;
      frameCtx.movementSounds.stopSlide = stopSlide;
      frameCtx.resetPredictedAbilitySounds = resetPredictedAbilitySounds;
      frameCtx.updatePredictedAbilitySounds = updatePredictedAbilitySounds;
      frameCtx.resetMovementCommandBuffer = resetMovementCommandBuffer;
      frameCtx.lockHeroActions = lockHeroActions;
      frameCtx.clearHeroActionLock = clearHeroActionLock;
      frameCtx.setChronosLifelineQueuedState = setChronosLifelineQueuedState;
      frameCtx.isHeroActionLocked = isHeroActionLocked;
      frameCtx.flushMovementCommands = flushMovementCommands;
      frameCtx.hasChronosLifelineTarget = hasChronosLifelineTarget;
      frameCtx.getChronosPracticeLifelineTargets = getChronosPracticeLifelineTargets;
      frameCtx.resetViewmodelPoseState = resetViewmodelPoseState;
      frameCtx.resetBlazeFlamethrower = resetBlazeFlamethrower;
    }
    let localPlayer = useGameStore.getState().localPlayer;
    const isPlaying = gamePhase === 'playing' || gamePhase === 'countdown';
    const frameClock = getFrameClock();
    const now = frameClock.epochNowMs;
    const frameNowMs = frameClock.nowMs;

    if (!localPlayer) {
      runNoLocalPlayerFrame(frameCtx, now);
      return;
    }

    const authority = runAuthorityPhase(frameCtx, localPlayer, frameNowMs);
    localPlayer = authority.localPlayer;
    runHeroSwapPhase(frameCtx, localPlayer, now);

    const dt = Math.min(delta, 0.1);
    const timing: FrameTiming = { dt, now, frameNowMs, isPlaying };
    const localDeathVisual = getDeathVisualForPlayer(localPlayer.id, now);
    const hasLocalDeathVisual = Boolean(localDeathVisual?.local);
    const isLocalAliveForCamera = isPlaying && localPlayer.state === 'alive' && !hasLocalDeathVisual;
    if ((!isPlaying || isLocalAliveForCamera || localPlayer.state !== 'dead') && !hasLocalDeathVisual && cameraControl.isDeathCameraActive()) {
      cameraControl.resetDeathCamera(camera);
    }

    if (!enabled) {
      runDisabledLifecycleFrame(frameCtx, localPlayer, timing, authority.authorityApplied);
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

    if (!isPlaying || localPlayer.state !== 'alive' || hasLocalDeathVisual) {
      runInactiveLifecycleFrame(
        frameCtx,
        localPlayer,
        timing,
        frameInput,
        hasLocalDeathVisual,
        localDeathVisual,
        authority.authorityApplied
      );
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

    let { speedMultiplier } = abilitySystem.updateActiveAbilities(dt);
    if (localPlayer.heroId === 'phantom' && localPlayer.abilities?.['phantom_veil']?.isActive) {
      speedMultiplier *= PHANTOM_VEIL_SPEED_MULTIPLIER;
    }

    // Handle hero-specific abilities
    const inputPhase = runInputPhase(frameCtx, localPlayer, heroId, rawFrameInput, frameInput, now);
    const {
      heroDef,
      bombTargetingForFrame,
      localAbilityInput,
      primaryFireForServer,
      ability2ForServer,
      serverCombatInput,
      requestedCommandScheduleReasons,
      phantomPrimaryReloading,
      phantomPrimaryHeldForPose,
      chronosLifelineCommitMode,
      chronosLifelineCommitActive,
      chronosLifelineCommitPressed,
    } = inputPhase;
    frameInput = inputPhase.frameInput;

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
      inputState: localAbilityInput,
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
      heroId === 'chronos' && frameInput.primaryFire && !chronosLifelineCommitActive,
      now
    );
    const chronosAegisDurability = heroId === 'chronos'
      ? visualStore.getState().chronosAegisStates.get(localPlayer.id)?.durabilityRatio ?? 1
      : 1;
    setChronosAegisVisualState(
      localPlayer.id,
      heroId === 'chronos' &&
        frameInput.secondaryFire &&
        !chronosLifelineCommitActive &&
        chronosAegisDurability > 0.005,
      now
    );
    if (heroDef) {
      updatePredictedAbilitySounds({
        now,
        heroId,
        inputState: frameInput,
        ultimateCharge: localPlayer.ultimateCharge ?? 0,
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
        const ability1Id = heroDef.ability1.abilityId;
        const chronosQueuePressed = heroId === 'chronos' &&
          rawFrameInput.ability1 &&
          !abilitySystem.abilityPressedRef.current.ability1;

        if (heroId === 'chronos') {
          if (chronosQueuePressed) {
            if (chronosLifelineQueuedRef.current) {
              setChronosLifelineQueuedState(false, now);
            } else if (!grappleTrapTargeting && abilitySystem.canUseAbility(ability1Id, false)) {
              setChronosLifelineQueuedState(true, now, rawFrameInput);
            }
          }

          if (chronosLifelineCommitPressed && chronosLifelineCommitMode) {
            const canCommitLifeline = abilitySystem.canUseAbility(ability1Id, false);
            const hasCommitTargets = chronosLifelineCommitMode === 'self' || hasChronosLifelineTarget();

            if (!canCommitLifeline) {
              setChronosLifelineQueuedState(false, now);
            } else if (hasCommitTargets) {
              if (isPracticeMode) {
                const healAmount = chronosLifelineCommitMode === 'self'
                  ? CHRONOS_LIFELINE_SELF_HEAL
                  : CHRONOS_LIFELINE_ALLY_HEAL;
                const targets = getChronosPracticeLifelineTargets(chronosLifelineCommitMode, healAmount);
                if (targets.length > 0 && abilitySystem.useAbilityCharge(ability1Id)) {
                  if (chronosAbilities.executeLifelineConduit(abilityCtx, abilitySystem.useAbilityCharge)) {
                    lockHeroActions(heroId, CHRONOS_LIFELINE_POSE_DURATION_MS, now);
                  }
                  const store = useGameStore.getState();
                  const combatFeedback = useCombatFeedbackStore.getState();
                  for (const target of targets) {
                    if (target.isLocal) {
                      const healedAmount = Math.max(0, target.newHealth - (store.localPlayer?.health ?? target.newHealth));
                      store.updateLocalPlayer({ health: target.newHealth });
                      if (healedAmount > 0) {
                        combatFeedback.addCombatTextEvent({
                          kind: 'heal',
                          amount: healedAmount,
                          targetId: target.id,
                          position: target.position,
                        });
                      }
                    } else {
                      const player = store.players.get(target.id);
                      const healedAmount = Math.max(0, target.newHealth - (player?.health ?? target.newHealth));
                      if (player) {
                        store.updatePlayer(target.id, {
                          ...player,
                          health: target.newHealth,
                        });
                      }
                      if (healedAmount > 0) {
                        combatFeedback.addCombatTextEvent({
                          kind: 'heal',
                          amount: healedAmount,
                          targetId: target.id,
                          position: target.position,
                        });
                      }
                    }
                  }
                  if (chronosLifelineCommitMode === 'self') {
                    addChronosSelfHealPulseEffect(
                      { x: position.x, y: position.y, z: position.z },
                      targets[0].position,
                      undefined,
                      { sourceAbilityId: 'chronos_lifeline_conduit' }
                    );
                  } else {
                    addChronosLifelineEffects(
                      { x: position.x, y: position.y, z: position.z },
                      targets.map((target) => ({ position: target.position })),
                      undefined,
                      { sourceAbilityId: 'chronos_lifeline_conduit' }
                    );
                  }
                  setChronosLifelineQueuedState(false, now);
                }
              } else if (chronosAbilities.executeLifelineConduit(abilityCtx, abilitySystem.useAbilityCharge)) {
                lockHeroActions(heroId, CHRONOS_LIFELINE_POSE_DURATION_MS, now);
                setChronosLifelineQueuedState(false, now);
              }
            }
          }
        } else if (frameInput.ability1 && !abilitySystem.abilityPressedRef.current.ability1) {
          if (!grappleTrapTargeting && abilitySystem.canUseAbility(ability1Id, false)) {
            if (heroId === 'phantom') {
              if (isPracticeMode) {
                const startPosition = { x: position.x, y: position.y, z: position.z };
                if (abilitySystem.useAbilityCharge(ability1Id)) {
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
                  abilitySystem.startClientCooldown(ability1Id);
                }
              }
            }
          }
        }
        abilitySystem.abilityPressedRef.current.ability1 = rawFrameInput.ability1;
      }

      // Ability 2 (Q)
      if (localAbilityInput.ability2 && !abilitySystem.abilityPressedRef.current.ability2) {
        if (abilitySystem.canUseAbility(heroDef.ability2.abilityId, false)) {
          if (heroId === 'phantom') {
            const abilityId = heroDef.ability2.abilityId;
            const playLocalShieldCast = () => {
              markPredictedLocalAbilitySound(abilityId, now, 1600);
              triggerPhantomShieldCastEffect({
                playerId: localPlayer.id,
                isLocalPlayer: true,
                position: { x: position.x, y: position.y, z: position.z },
                yaw: abilityCtx.yaw,
              });
            };

            if (isPracticeMode) {
              abilitySystem.setAbilityActive(abilityId, true, { startTime: now, startCooldownOnEnd: true });
              updateLocalPlayer({
                abilities: {
                  ...localPlayer.abilities,
                  [abilityId]: buildPracticeAbilityState(localPlayer.abilities, abilityId, now, true),
                },
              });
              playLocalShieldCast();
              lockHeroActions(heroId, PHANTOM_PRIMARY_RETURN_TO_IDLE_MS, now);
            } else if (phantomAbilities.executePersonalShield(
              abilityCtx,
              playerSounds,
              abilitySystem.setAbilityActive,
              abilitySystem.startClientCooldown,
              updateLocalPlayer
            )) {
              playLocalShieldCast();
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
      if (localAbilityInput.ultimate && !abilitySystem.abilityPressedRef.current.ultimate) {
        if (abilitySystem.canUseAbility(heroDef.ultimate.abilityId, true)) {
          if (heroId === 'phantom') {
            if (isPracticeMode) {
              const abilityId = heroDef.ultimate.abilityId;
              const abilityDef = ABILITY_DEFINITIONS[abilityId];
              const durationMs = (abilityDef?.duration ?? 0) * 1000;
              const effectEndTime = now + durationMs;
              triggerPhantomVeilCastPose(now);
              abilitySystem.setAbilityActive(abilityId, true, { startTime: now, startCooldownOnEnd: true });
              useGameStore.getState().setUltimateEffect(true, abilityId, effectEndTime);
              updateLocalPlayer({
                ultimateCharge: 0,
                abilities: {
                  ...localPlayer.abilities,
                  [abilityId]: buildPracticeAbilityState(localPlayer.abilities, abilityId, now, true),
                },
              });
              lockHeroActions(heroId, PHANTOM_VEIL_CAST_POSE_DURATION_MS, now);
            } else if (phantomAbilities.executePhantomVeil(abilityCtx, playerSounds, updateLocalPlayer, abilitySystem.setAbilityActive)) {
              lockHeroActions(heroId, PHANTOM_VEIL_CAST_POSE_DURATION_MS, now);
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
      if (heroId === 'phantom') {
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

    const predictionPhase = runPredictionAndCommandPhase({
      ctx: frameCtx,
      localPlayer,
      heroId,
      frameInput,
      serverCombatInput,
      requestedCommandScheduleReasons,
      abilityCtx,
      predictedState,
      now,
      dt,
      rawDelta: delta,
    });
    predictedState = predictionPhase.predictedState;
    const {
      wasGroundedBeforePrediction,
      commandInput,
    } = predictionPhase;

    const presentation = runPresentationPhase({
      ctx: frameCtx,
      localPlayer,
      heroId,
      heroStats,
      predictedState,
      abilityCtx,
      frameInput,
      hasMovementInput,
      speedMultiplier,
      wasGroundedBeforePrediction,
      now,
      frameNowMs,
      dt,
    });

    runTracePhase({
      ctx: frameCtx,
      localPlayer,
      heroId,
      heroDef,
      frameInput,
      commandInput,
      localMovementForTrace: presentation.localMovementForTrace,
      isSliding: presentation.isSliding,
      wasSlidingBeforeFrame: presentation.wasSlidingBeforeFrame,
      speedMultiplier,
      now,
      dt,
    });
  };

  // Main game loop. Run early so viewmodel/effects sample the updated camera and predicted velocity.
  useFrame((frameState, delta) => {
    if (MOVEMENT_DIAGNOSTICS_ENABLED) {
      measureFrameWork('frame.playerController', () => runLocalPlayerFrame(frameState, delta));
      return;
    }

    runLocalPlayerFrame(frameState, delta);
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
