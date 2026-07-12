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
import { useGameStore, type ObserverFlightSpeed } from '../../store/gameStore';
import { useSettingsStore } from '../../store/settingsStore';
import {
  applyHeroAbilityBindings,
  isHeroAbilityInputActive,
  resolveRuntimeHeroAbilityBindings,
  useLoadoutStore,
} from '../../store/loadoutStore';
import { useCombatFeedbackStore } from '../../store/combatFeedbackStore';
import {
  consumeLocalPlayerImpulses,
  getDeathVisualForPlayer,
  visualStore,
  setChronosAegisVisualState,
  setLocalViewmodelMovement,
  setLocalSlideIntensity,
  setLocalVisualMovement,
  setBattleRoyalFirstPersonDropBodyVisibleUntil,
  setPlayerVisualTransform,
  setFlamethrowerVisualPose,
  rebuildCombatVisualFrameCache,
} from '../../store/visualStore';
import { useInput } from '../../hooks/useInput';
import { checkGroundWithNormal, getPhysicsWorld, isPhysicsReady, raycast, usePhysics } from '../../hooks/usePhysics';
import { useNetwork } from '../../contexts/NetworkContext';
import { isGameConsoleOpen } from '../../store/gameConsoleState';
import { mouseButtonToKeybindCode } from '../../utils/keybindings';
import {
  playSharedBlazeAirstrikeSound,
  playSharedLoop,
  playSharedSound,
  stopSharedLoop,
  setAudioListenerTransform,
  useAbilitySounds,
  useMovementSounds,
} from '../../hooks/useAudio';
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
  triggerBlazeRocketJumpStaffSlam,
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
  CHRONOS_PRIMARY_ORB_SOCKET,
  PLAYER_HEIGHT,
  EYE_HEIGHT,
  calculateLookDirection,
  calculatePlayerSocketPosition,
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
import {
  getMobileAimAssistActionConfig,
  resolveMobileAimAssistPoint,
  THIRD_PERSON_CROSSHAIR_AIM_DISTANCE,
} from '../../hooks/player/abilityAim';
import { writeThirdPersonCameraPosition } from '../../hooks/player/useCamera';
import {
  HERO_ACTION_OVERLAP_GRACE_MS,
  isActionLockBlocking,
} from '../../hooks/player/actionLock';
import { getFrameClock } from '../../utils/frameClock';
import {
  markPredictedLocalAbilitySound,
  shouldSuppressPredictedLocalAbilitySound,
  useLocalAbilityAudioPrediction,
  type LocalAbilityAudioPredictionFrame,
} from '../../hooks/player/useLocalAbilityAudioPrediction';
import { buildAbilityCastOriginHints } from '../../hooks/player/abilityCastOriginHints';
import { getLocalChronosTimebreakTempoMultiplier } from '../../hooks/player/chronosTimebreakTempo';
import {
  ABILITY_DEFINITIONS,
  BLAZE_FLAMETHROWER_MAX_FUEL,
  BLAZE_PHOENIX_DIVE_DAMAGE,
  BLAZE_PHOENIX_DIVE_FALL_SPEED,
  BLAZE_PHOENIX_DIVE_HOVER_DURATION_MS,
  BLAZE_PHOENIX_DIVE_LAUNCH_DURATION_MS,
  BLAZE_PHOENIX_DIVE_MAX_FALL_DURATION_MS,
  BLAZE_PHOENIX_DIVE_MAX_RANGE,
  BLAZE_PHOENIX_DIVE_RADIUS,
  BLAZE_PHOENIX_DIVE_START_HEIGHT,
  CHRONOS_LIFELINE_ALLY_HEAL,
  CHRONOS_LIFELINE_MAX_TARGETS,
  CHRONOS_LIFELINE_RADIUS,
  CHRONOS_LIFELINE_SELF_HEAL,
  CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
  MOVEMENT_MAX_PACKET_COMMANDS,
  MOVEMENT_SUBSTEP_SECONDS,
  PHANTOM_VEIL_SPEED_MULTIPLIER,
  PHANTOM_UMBRAL_DECOY_DURATION_SECONDS,
  PHANTOM_VOID_ZONE_DURATION_SECONDS,
  PHANTOM_VOID_ZONE_RADIUS,
  POWERUP_MOVEMENT_SPEED_MULTIPLIER,
  VOID_RAY_CHARGE_TIME,
  TICK_RATE,
  createEmptyInputState,
  getHeroStats,
  getBlazeUltimateAbilityId,
  getPhantomUltimateAbilityId,
  calculateBlazePhoenixDiveLaunchVelocity,
  createBlazePhoenixDiveHoverMotion,
  getBlazePhoenixDiveHoverVelocity,
  getBlazePhoenixDiveStartPosition,
  getBlazePhoenixDiveVelocity,
  HERO_DEFINITIONS,
  type HeroId,
  type MatchMode,
  type MatchPerspective,
  type AbilityCastOriginHint,
  type BattleRoyalDropPlayerSnapshot,
  type BlazeUltimateSkill,
  type PhantomUltimateSkill,
  type InputState,
  type MovementCommand,
  type Player,
  type PlayerMovementState,
} from '@voxel-strike/shared';
import type { MovementSimulationState, PredictionCorrectionMetrics } from '@voxel-strike/physics';
import { isMovementTraceRecordingEnabled, recordMovementTraceFrame } from '../../anticheat/movementTraceRecorder';
import {
  addLocalMovementImpulse,
  attachClientMovementState,
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
  predictLocalBattleRoyalDrop,
  predictLocalBlazeAfterburner,
  predictLocalBlazeRocketJump,
  setLocalBlazePhoenixDiving,
  setLocalBlazePhoenixHovering,
  predictLocalPhantomBlink,
  predictLocalRiftBoltTeleport,
  stepLocalMovementPrediction,
  stripClientMovementState,
  suppressDownedMovementInput,
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
import { triggerBlinkEffect } from './PhantomEffects';
import { triggerPhantomShieldCastEffect } from './phantom';
import { addUmbralDecoyEffect } from './Effects';
import { addChronosLifelineEffects, addChronosSelfHealPulseEffect } from './chronos/lifeline';
import { addChronosTimebreakEffect } from './chronos/timebreak';
import { triggerTeleportEffect } from '../ui/TeleportEffects';
import { resolveAbilitySocketOrigin } from '../../model-system/abilitySocketResolver';
import {
  chronosOrbForwardFromYaw,
  offsetChronosOrbVisualPlainPosition,
} from '../../model-system/chronosOrbVisualOrigin';
import {
  createLocalVisualInterpolationState,
  recordLocalVisualFixedStep,
  sampleLocalVisualInterpolatedPosition,
  smoothTerrainVisualY,
  type LocalVisualInterpolationState,
  type MutableVec3,
} from './localVisualInterpolation';
import {
  EMPTY_EXCLUSIVE_HOLD_INPUT,
  EMPTY_SERVER_COMBAT_INPUT,
  addCommandScheduleReason,
  deriveDownedServerCombatInput,
  deriveServerCombatInput,
  getContinuingHeroHoldInput,
  getExclusiveHeroInput,
  getExclusiveHoldInput,
  movementClassForTrace,
  resolveCommandSchedule,
  shouldForceImmediateCombatCommand,
  withCastActionFields,
  type CommandScheduleReason,
  type ExclusiveHoldInput,
  type ServerCombatInput,
} from './playerControllerInput';
import {
  applyBattleRoyalDeploymentCamera,
  applyBattleRoyalFirstPersonDropCamera,
  beginBattleRoyalFirstPersonDropCamera,
  BATTLE_ROYAL_FIRST_PERSON_DROP_BODY_VISIBLE_MS,
  createBattleRoyalFirstPersonDropCameraRuntime,
  findBattleRoyalDropPlayer,
  resetBattleRoyalFirstPersonDropCamera,
  writeBattleRoyalDeploymentCameraTarget,
  type BattleRoyalFirstPersonDropCameraRuntime,
  type BattleRoyalDeploymentCameraTarget,
} from './battleRoyalDropView';
import {
  createDevTestingHeroSwitchUpdates,
  getDevTestingHeroInteraction,
  isDevTestingMapProfileId,
} from '../../utils/devTestingMapInteraction';
import {
  applyTutorialOfflineTrainingAreaDamage,
  applyTutorialOfflineTrainingTimebreakKnockback,
} from '../../utils/tutorialOfflineCombatRuntime';
import { getPreparedVoxelMap } from '../../utils/mapWarmup/mapPrepCache';
export {
  deriveDownedServerCombatInput,
  deriveServerCombatInput,
  getContinuingHeroHoldInput,
  getExclusiveHeroInput,
  movementClassForTrace,
  shouldForceImmediateCombatCommand,
  withCastActionFields,
} from './playerControllerInput';
export type {
  CommandScheduleReason,
  ServerCombatInput,
} from './playerControllerInput';

const INACTIVE_INPUT_STATE = createEmptyInputState();
const DEFAULT_FLAMETHROWER_DIRECTION = { x: 0, y: 0, z: -1 };
const CHRONOS_LIFELINE_READY_LOOP_ID = 'local-chronos-lifeline-ready';
const CHRONOS_LIFELINE_READY_FADE_IN_MS = 40;
const CHRONOS_TIMEBREAK_CHARGE_FADE_OUT_MS = 110;
const BATTLE_ROYAL_DROP_SHIP_LOOP_ID = 'battle-royal-local-drop-ship';
const BATTLE_ROYAL_FLY_LOOP_ID = 'battle-royal-local-fly';
const BATTLE_ROYAL_DROP_AUDIO_FADE_IN_MS = 120;
const BATTLE_ROYAL_DROP_AUDIO_FADE_OUT_MS = 180;
const MOVEMENT_COMMAND_TARGET_PACKET_SIZE = 3;
const MOVEMENT_COMMAND_MAX_FLUSH_AGE_MS = 1000 / TICK_RATE;
const OBSERVER_FLIGHT_SPEED_UNITS: Record<ObserverFlightSpeed, number> = {
  low: 8,
  med: 18,
  hight: 32,
};
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

type BattleRoyalDeploymentAudioStatus = BattleRoyalDropPlayerSnapshot['status'] | null;

interface BattleRoyalDeploymentAudioRuntime {
  playerId: string | null;
  status: BattleRoyalDeploymentAudioStatus;
  landedSoundKey: string | null;
}

function createBattleRoyalDeploymentAudioRuntime(): BattleRoyalDeploymentAudioRuntime {
  return {
    playerId: null,
    status: null,
    landedSoundKey: null,
  };
}

const authorityMetricsScratch: PredictionCorrectionMetrics[] = [];
const battleRoyalDeploymentVisualPosition = new THREE.Vector3();
const battleRoyalDeploymentCameraPosition = new THREE.Vector3();
const battleRoyalDeploymentLookTarget = new THREE.Vector3();
const observerFlightMove = new THREE.Vector3();
const observerFlightForward = new THREE.Vector3();
const observerFlightRight = new THREE.Vector3();
const thirdPersonAimCameraPosition = new THREE.Vector3();
const thirdPersonAimCollisionAnchor = new THREE.Vector3();
const thirdPersonAimCameraDirection = new THREE.Vector3();
const mobileAimAssistThirdPersonOrigin = new THREE.Vector3();
const mobileAimAssistThirdPersonCollisionAnchor = new THREE.Vector3();
const mobileAimAssistThirdPersonCameraDirection = new THREE.Vector3();
const mobileAimAssistOriginScratch: MutableVec3 = { x: 0, y: 0, z: 0 };
const mobileAimAssistDirectionScratch: MutableVec3 = { x: 0, y: 0, z: -1 };
const mobileAimAssistLosDirectionScratch: MutableVec3 = { x: 0, y: 0, z: -1 };
const THIRD_PERSON_CAMERA_RAYCAST_OPTIONS = {
  priority: 'visual',
  feature: 'third-person-camera',
} as const;
const THIRD_PERSON_CROSSHAIR_AIM_RAYCAST_OPTIONS = {
  priority: 'visual',
  feature: 'third-person-crosshair-aim',
} as const;
const MAP_PING_RAYCAST_OPTIONS = {
  priority: 'gameplay',
  feature: 'map-ping',
  includeNormal: true,
} as const;
const MOBILE_AIM_ASSIST_RAYCAST_OPTIONS = {
  priority: 'gameplay',
  feature: 'mobile-aim-assist',
} as const;
const MAP_PING_RAYCAST_MAX_DISTANCE = 360;
const MAP_PING_CLEAR_DISTANCE_SQ = 4.5 * 4.5;
const MOBILE_AIM_ASSIST_LINE_OF_SIGHT_PADDING = 0.2;
const thirdPersonAimPointScratch: MutableVec3 = { x: 0, y: 0, z: 0 };
const mapPingRayDirectionScratch = new THREE.Vector3();
// Reused scratch for confirmLocalMovementTransform. That function copies every
// field out synchronously into a fresh state object and never retains the arg,
// so a single mutable scratch is safe to reuse across both call sites per frame.
const confirmTransformScratch: {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  movement: { isGrappling: boolean; grapplePoint: { x: number; y: number; z: number } | null };
} = {
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  movement: { isGrappling: false, grapplePoint: null },
};
const CONFIRM_TRANSFORM_UPDATE_LATEST_OPTIONS = { updateLatestCommandRecord: true } as const;
const battleRoyalDeploymentCameraTarget: BattleRoyalDeploymentCameraTarget = {
  mode: 'ship',
  position: new THREE.Vector3(),
  yaw: 0,
};

function resolveThirdPersonCameraCollision(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  maxDistance: number
): number | null {
  if (!isPhysicsReady()) return null;
  const world = getPhysicsWorld();
  if (!world) return null;
  return raycast(world, origin, direction, maxDistance, THIRD_PERSON_CAMERA_RAYCAST_OPTIONS)?.distance ?? null;
}

function resolveMapPingAimPosition(camera: THREE.Camera): MutableVec3 | null {
  if (!isPhysicsReady()) return null;
  const world = getPhysicsWorld();
  if (!world) return null;

  camera.getWorldDirection(mapPingRayDirectionScratch).normalize();
  const hit = raycast(
    world,
    camera.position,
    mapPingRayDirectionScratch,
    MAP_PING_RAYCAST_MAX_DISTANCE,
    MAP_PING_RAYCAST_OPTIONS
  );
  return hit?.point ?? null;
}

function isNearActivePing(position: MutableVec3): boolean {
  const store = useGameStore.getState();
  const localPlayer = store.localPlayer;
  if (!localPlayer) return false;
  const ping = store.mapPings.get(localPlayer.id);
  if (!ping || ping.expiresAt <= Date.now()) return false;

  const dx = ping.position.x - position.x;
  const dz = ping.position.z - position.z;
  return dx * dx + dz * dz <= MAP_PING_CLEAR_DISTANCE_SQ;
}

export function resolveThirdPersonCrosshairAimPoint({
  bodyPosition,
  yaw,
  pitch,
  eyeHeight,
  matchPerspective,
}: {
  bodyPosition: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  eyeHeight: number;
  matchPerspective: MatchPerspective;
}): MutableVec3 | null {
  if (matchPerspective !== 'third_person') return null;

  writeThirdPersonCameraPosition(
    thirdPersonAimCameraPosition,
    thirdPersonAimCollisionAnchor,
    thirdPersonAimCameraDirection,
    {
      bodyPosition,
      yaw,
      eyeHeight,
      collision: resolveThirdPersonCameraCollision,
    }
  );

  const direction = calculateLookDirection(yaw, pitch);
  const world = isPhysicsReady() ? getPhysicsWorld() : null;
  const hit = world
    ? raycast(
      world,
      thirdPersonAimCameraPosition,
      direction,
      THIRD_PERSON_CROSSHAIR_AIM_DISTANCE,
      THIRD_PERSON_CROSSHAIR_AIM_RAYCAST_OPTIONS
    )
    : null;

  if (hit) return hit.point;

  thirdPersonAimPointScratch.x = thirdPersonAimCameraPosition.x + direction.x * THIRD_PERSON_CROSSHAIR_AIM_DISTANCE;
  thirdPersonAimPointScratch.y = thirdPersonAimCameraPosition.y + direction.y * THIRD_PERSON_CROSSHAIR_AIM_DISTANCE;
  thirdPersonAimPointScratch.z = thirdPersonAimCameraPosition.z + direction.z * THIRD_PERSON_CROSSHAIR_AIM_DISTANCE;
  return thirdPersonAimPointScratch;
}

function resolvePracticeBlazePhoenixDiveTarget(ctx: AbilityContext): { x: number; y: number; z: number } {
  const forward = calculateLookDirection(ctx.yaw, ctx.pitch);
  const rawTarget = ctx.aimPoint ?? {
    x: ctx.position.x + forward.x * BLAZE_PHOENIX_DIVE_MAX_RANGE,
    y: ctx.position.y + forward.y * BLAZE_PHOENIX_DIVE_MAX_RANGE,
    z: ctx.position.z + forward.z * BLAZE_PHOENIX_DIVE_MAX_RANGE,
  };
  const dx = rawTarget.x - ctx.position.x;
  const dz = rawTarget.z - ctx.position.z;
  const horizontalDistance = Math.hypot(dx, dz);
  const rangeScale = horizontalDistance > BLAZE_PHOENIX_DIVE_MAX_RANGE
    ? BLAZE_PHOENIX_DIVE_MAX_RANGE / horizontalDistance
    : 1;
  const x = ctx.position.x + dx * rangeScale;
  const z = ctx.position.z + dz * rangeScale;
  const ground = checkGroundWithNormal(
    x,
    Math.max(rawTarget.y + 50, ctx.position.y + 50),
    z,
    160,
    { priority: 'visual', feature: 'practice:blazePhoenixDive' },
  );
  return {
    x,
    y: ground?.groundY ?? ctx.position.y - PLAYER_HEIGHT / 2,
    z,
  };
}

function writeMobileAimAssistOrigin({
  out,
  bodyPosition,
  yaw,
  eyeHeight,
  matchPerspective,
}: {
  out: MutableVec3;
  bodyPosition: { x: number; y: number; z: number };
  yaw: number;
  eyeHeight: number;
  matchPerspective: MatchPerspective;
}): MutableVec3 {
  if (matchPerspective === 'third_person') {
    writeThirdPersonCameraPosition(
      mobileAimAssistThirdPersonOrigin,
      mobileAimAssistThirdPersonCollisionAnchor,
      mobileAimAssistThirdPersonCameraDirection,
      {
        bodyPosition,
        yaw,
        eyeHeight,
        collision: resolveThirdPersonCameraCollision,
      }
    );
    out.x = mobileAimAssistThirdPersonOrigin.x;
    out.y = mobileAimAssistThirdPersonOrigin.y;
    out.z = mobileAimAssistThirdPersonOrigin.z;
    return out;
  }

  out.x = bodyPosition.x;
  out.y = bodyPosition.y + eyeHeight;
  out.z = bodyPosition.z;
  return out;
}

function hasMobileAimAssistLineOfSight(from: MutableVec3, to: MutableVec3): boolean {
  const world = isPhysicsReady() ? getPhysicsWorld() : null;
  if (!world) return true;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance <= 0.001) return false;

  mobileAimAssistLosDirectionScratch.x = dx / distance;
  mobileAimAssistLosDirectionScratch.y = dy / distance;
  mobileAimAssistLosDirectionScratch.z = dz / distance;
  const hit = raycast(
    world,
    from,
    mobileAimAssistLosDirectionScratch,
    distance,
    MOBILE_AIM_ASSIST_RAYCAST_OPTIONS
  );

  return !hit || hit.distance >= distance - MOBILE_AIM_ASSIST_LINE_OF_SIGHT_PADDING;
}

function resolveMobileAimAssistAimPoint({
  isTouchInputActive,
  inputState,
  heroId,
  localPlayer,
  storeSnapshot,
  bodyPosition,
  yaw,
  pitch,
  eyeHeight,
  matchPerspective,
  frameNowMs,
}: {
  isTouchInputActive: boolean;
  inputState: InputState;
  heroId: HeroId;
  localPlayer: Player;
  storeSnapshot: GameStoreSnapshot;
  bodyPosition: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  eyeHeight: number;
  matchPerspective: MatchPerspective;
  frameNowMs: number;
}): MutableVec3 | null {
  if (!isTouchInputActive) return null;

  const assistConfig = getMobileAimAssistActionConfig(
    heroId,
    inputState,
    useLoadoutStore.getState().blazePrimarySkill
  );
  if (!assistConfig) return null;

  writeMobileAimAssistOrigin({
    out: mobileAimAssistOriginScratch,
    bodyPosition,
    yaw,
    eyeHeight,
    matchPerspective,
  });
  const direction = calculateLookDirection(yaw, pitch);
  mobileAimAssistDirectionScratch.x = direction.x;
  mobileAimAssistDirectionScratch.y = direction.y;
  mobileAimAssistDirectionScratch.z = direction.z;

  const combatCache = rebuildCombatVisualFrameCache(
    storeSnapshot.players.values(),
    frameNowMs,
    frameNowMs,
    storeSnapshot.players.size
  );

  return resolveMobileAimAssistPoint({
    ownerId: localPlayer.id,
    ownerTeam: localPlayer.team,
    origin: mobileAimAssistOriginScratch,
    direction: mobileAimAssistDirectionScratch,
    candidates: combatCache.alivePlayers,
    maxDistance: assistConfig.maxDistance,
    targetTeam: assistConfig.targetTeam,
    hasLineOfSight: hasMobileAimAssistLineOfSight,
  });
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

function resolveTraceMatchMode(): MatchMode {
  const store = useGameStore.getState();
  return store.matchmakingStatus.matchMode ?? 'custom';
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
  return target;
}

function pushUniqueTraceAbilityId(target: string[], abilityId: string | undefined): void {
  if (!abilityId || target.includes(abilityId)) return;
  target.push(abilityId);
}

export function resolveEquippedUltimateAbilityId(
  heroId: HeroId,
  blazeUltimateSkill: BlazeUltimateSkill = useLoadoutStore.getState().blazeUltimateSkill,
  phantomUltimateSkill: PhantomUltimateSkill = useLoadoutStore.getState().phantomUltimateSkill,
): string {
  if (heroId === 'blaze') return getBlazeUltimateAbilityId(blazeUltimateSkill);
  if (heroId === 'phantom') return getPhantomUltimateAbilityId(phantomUltimateSkill);
  return HERO_DEFINITIONS[heroId].ultimate.abilityId;
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

interface PracticeBlazePhoenixDiveRuntime {
  playerId: string;
  ownerTeam: Player['team'];
  phase: 'launch' | 'hover' | 'dive';
  targetPosition: { x: number; y: number; z: number } | null;
  launchYaw: number;
  launchTimer: number;
  hoverTimer: number;
  impactTimer: number;
}

function clearPracticeBlazePhoenixDiveRuntime(
  runtimeRef: MutableRefObject<PracticeBlazePhoenixDiveRuntime | null>
): void {
  const runtime = runtimeRef.current;
  if (!runtime) return;
  window.clearTimeout(runtime.launchTimer);
  window.clearTimeout(runtime.hoverTimer);
  window.clearTimeout(runtime.impactTimer);
  setLocalBlazePhoenixHovering(runtime.playerId, null);
  setLocalBlazePhoenixDiving(runtime.playerId, false);
  runtimeRef.current = null;
}

function beginPracticeBlazePhoenixDiveDescent(
  runtimeRef: MutableRefObject<PracticeBlazePhoenixDiveRuntime | null>
): void {
  const runtime = runtimeRef.current;
  if (!runtime || runtime.phase === 'dive' || !runtime.targetPosition) return;

  const store = useGameStore.getState();
  const currentPlayer = store.localPlayer;
  if (!store.isPracticeMode || currentPlayer?.id !== runtime.playerId || currentPlayer.state !== 'alive') {
    clearPracticeBlazePhoenixDiveRuntime(runtimeRef);
    return;
  }

  runtime.phase = 'dive';
  window.clearTimeout(runtime.hoverTimer);
  store.setPhoenixDiveTargeting(false, false);
  setLocalBlazePhoenixHovering(runtime.playerId, null);

  const divePosition = getBlazePhoenixDiveStartPosition(currentPlayer.position, runtime.targetPosition);
  const diveVelocity = getBlazePhoenixDiveVelocity();
  const diveMovement = {
    ...currentPlayer.movement,
    isGrounded: false,
    isSliding: false,
    slideTimeRemaining: 0,
  };
  setLocalBlazePhoenixDiving(runtime.playerId, true);
  confirmLocalMovementTransform(currentPlayer, {
    position: divePosition,
    velocity: diveVelocity,
    movement: diveMovement,
  }, currentPlayer.lookYaw);
  store.updateLocalPlayer({
    position: divePosition,
    velocity: diveVelocity,
    movement: diveMovement,
  });
  triggerBlazeRocketJumpStaffSlam(Date.now());
  void playSharedSound('blazeBombFall', {
    position: divePosition,
    durationMs: BLAZE_PHOENIX_DIVE_MAX_FALL_DURATION_MS,
    fadeOutMs: 120,
    pitch: 1.15,
  });

  const fallDurationMs = Math.min(
    BLAZE_PHOENIX_DIVE_MAX_FALL_DURATION_MS,
    Math.max(120, BLAZE_PHOENIX_DIVE_START_HEIGHT / BLAZE_PHOENIX_DIVE_FALL_SPEED * 1000),
  );
  runtime.impactTimer = window.setTimeout(() => {
    const impactRuntime = runtimeRef.current;
    const impactStore = useGameStore.getState();
    const impactPlayer = impactStore.localPlayer;
    if (
      !impactRuntime ||
      impactRuntime.playerId !== runtime.playerId ||
      !impactStore.isPracticeMode ||
      impactPlayer?.id !== runtime.playerId ||
      impactPlayer.state !== 'alive'
    ) {
      clearPracticeBlazePhoenixDiveRuntime(runtimeRef);
      return;
    }

    const ground = checkGroundWithNormal(
      runtime.targetPosition!.x,
      Math.max(runtime.targetPosition!.y + 50, impactPlayer.position.y + 50),
      runtime.targetPosition!.z,
      160,
      { priority: 'visual', feature: 'practice:blazePhoenixDiveImpact' },
    );
    const groundedTarget = {
      x: runtime.targetPosition!.x,
      y: ground?.groundY ?? runtime.targetPosition!.y,
      z: runtime.targetPosition!.z,
    };
    const impactPosition = {
      x: groundedTarget.x,
      y: groundedTarget.y + PLAYER_HEIGHT / 2 + 0.06,
      z: groundedTarget.z,
    };
    const impactVelocity = { x: 0, y: 0, z: 0 };
    const impactMovement = {
      ...impactPlayer.movement,
      isGrounded: true,
      isSliding: false,
      slideTimeRemaining: 0,
    };
    setLocalBlazePhoenixDiving(runtime.playerId, false);
    confirmLocalMovementTransform(impactPlayer, {
      position: impactPosition,
      velocity: impactVelocity,
      movement: impactMovement,
    }, impactPlayer.lookYaw);
    impactStore.updateLocalPlayer({
      position: impactPosition,
      velocity: impactVelocity,
      movement: impactMovement,
    });
    triggerRocketJumpExplosion(groundedTarget);
    void playSharedSound('blazeBombExplode', {
      position: groundedTarget,
      pitch: 0.86,
      volume: 1.15,
    });
    applyTutorialOfflineTrainingAreaDamage({
      center: groundedTarget,
      radius: BLAZE_PHOENIX_DIVE_RADIUS,
      damage: BLAZE_PHOENIX_DIVE_DAMAGE,
      damageType: 'phoenix_dive',
      sourceId: runtime.playerId,
      sourceTeam: runtime.ownerTeam,
      abilityId: 'blaze_phoenix_dive',
    });
    runtimeRef.current = null;
  }, fallDurationMs);
}

function confirmPracticeBlazePhoenixDive(
  runtimeRef: MutableRefObject<PracticeBlazePhoenixDiveRuntime | null>,
  targetPosition: THREE.Vector3
): void {
  const runtime = runtimeRef.current;
  if (!runtime || runtime.phase !== 'hover') return;
  runtime.targetPosition = {
    x: targetPosition.x,
    y: targetPosition.y,
    z: targetPosition.z,
  };
  beginPracticeBlazePhoenixDiveDescent(runtimeRef);
}

export function resolvePracticeBlazePhoenixHoverState(
  localPlayer: Player,
  launchYaw: number,
  startedAtMs = Date.now(),
): MovementSimulationState {
  const liveState = getCurrentPredictedState(movementStateFromPlayer(localPlayer));
  const motion = createBlazePhoenixDiveHoverMotion(liveState.velocity, launchYaw, startedAtMs);
  return {
    position: { ...liveState.position },
    velocity: getBlazePhoenixDiveHoverVelocity(motion, startedAtMs),
    movement: {
      ...liveState.movement,
      isGrounded: false,
      isSliding: false,
      slideTimeRemaining: 0,
    },
  };
}

function startPracticeBlazePhoenixDive(
  localPlayer: Player,
  launchYaw: number,
  now: number,
  runtimeRef: MutableRefObject<PracticeBlazePhoenixDiveRuntime | null>,
  fallbackTarget: { x: number; y: number; z: number },
  liveTargetRef: MutableRefObject<THREE.Vector3 | null>,
): MovementSimulationState {
  clearPracticeBlazePhoenixDiveRuntime(runtimeRef);
  const currentState = getCurrentPredictedState(movementStateFromPlayer(localPlayer));
  const launchState: MovementSimulationState = {
    position: {
      ...currentState.position,
      y: currentState.position.y + 0.5,
    },
    velocity: calculateBlazePhoenixDiveLaunchVelocity(currentState.velocity, launchYaw),
    movement: {
      ...currentState.movement,
      isGrounded: false,
      isSliding: false,
      slideTimeRemaining: 0,
    },
  };
  confirmLocalMovementTransform(localPlayer, launchState, localPlayer.lookYaw);
  useGameStore.getState().updateLocalPlayer({
    position: launchState.position,
    velocity: launchState.velocity,
    movement: launchState.movement,
  });
  triggerRocketJumpExplosion(currentState.position);

  const runtime: PracticeBlazePhoenixDiveRuntime = {
    playerId: localPlayer.id,
    ownerTeam: localPlayer.team,
    phase: 'launch',
    targetPosition: null,
    launchYaw,
    launchTimer: 0,
    hoverTimer: 0,
    impactTimer: 0,
  };
  runtimeRef.current = runtime;
  useGameStore.getState().setPhoenixDiveTargeting(true, false);

  runtime.launchTimer = window.setTimeout(() => {
    const store = useGameStore.getState();
    const currentPlayer = store.localPlayer;
    const currentRuntime = runtimeRef.current;
    if (
      !currentRuntime ||
      currentRuntime.playerId !== runtime.playerId ||
      !store.isPracticeMode ||
      currentPlayer?.id !== runtime.playerId ||
      currentPlayer.state !== 'alive'
    ) {
      clearPracticeBlazePhoenixDiveRuntime(runtimeRef);
      return;
    }

    currentRuntime.phase = 'hover';
    const hoverStartedAtMs = Date.now();
    const hoverState = resolvePracticeBlazePhoenixHoverState(
      currentPlayer,
      currentRuntime.launchYaw,
      hoverStartedAtMs,
    );
    setLocalBlazePhoenixHovering(runtime.playerId, {
      velocity: hoverState.velocity,
      lookYaw: currentRuntime.launchYaw,
      startedAtMs: hoverStartedAtMs,
    });
    confirmLocalMovementTransform(currentPlayer, hoverState, currentPlayer.lookYaw);
    store.updateLocalPlayer({
      position: hoverState.position,
      velocity: hoverState.velocity,
      movement: hoverState.movement,
    });

    currentRuntime.hoverTimer = window.setTimeout(() => {
      const timeoutRuntime = runtimeRef.current;
      if (!timeoutRuntime || timeoutRuntime.playerId !== runtime.playerId || timeoutRuntime.phase !== 'hover') return;
      const liveTarget = liveTargetRef.current;
      timeoutRuntime.targetPosition = liveTarget
        ? { x: liveTarget.x, y: liveTarget.y, z: liveTarget.z }
        : blazeFallbackTarget(useGameStore.getState().localPlayer, fallbackTarget);
      beginPracticeBlazePhoenixDiveDescent(runtimeRef);
    }, BLAZE_PHOENIX_DIVE_HOVER_DURATION_MS);
  }, BLAZE_PHOENIX_DIVE_LAUNCH_DURATION_MS);

  return launchState;
}

function blazeFallbackTarget(
  player: Player | null,
  fallbackTarget: { x: number; y: number; z: number }
): { x: number; y: number; z: number } {
  if (!player) return fallbackTarget;
  const ground = checkGroundWithNormal(
    fallbackTarget.x,
    Math.max(fallbackTarget.y + 50, player.position.y + 50),
    fallbackTarget.z,
    160,
    { priority: 'visual', feature: 'practice:blazePhoenixDiveFallback' },
  );
  return {
    x: fallbackTarget.x,
    y: ground?.groundY ?? fallbackTarget.y,
    z: fallbackTarget.z,
  };
}

function buildPracticeChargedAbilityState(
  existingAbilities: Player['abilities'] | undefined,
  abilityId: string,
  now: number,
  charges: number | undefined,
  cooldownUntil: number | undefined
) {
  const abilityDef = ABILITY_DEFINITIONS[abilityId];
  const existingAbility = existingAbilities?.[abilityId];
  const maxCharges = abilityDef?.charges ?? existingAbility?.charges ?? 1;
  const nextCharges = Math.max(0, Math.min(maxCharges, charges ?? existingAbility?.charges ?? maxCharges));
  const activeCooldownUntil = cooldownUntil && cooldownUntil > now ? cooldownUntil : 0;

  return {
    abilityId,
    cooldownRemaining: activeCooldownUntil > 0 ? Math.max(0, (activeCooldownUntil - now) / 1000) : 0,
    cooldownUntil: activeCooldownUntil,
    charges: nextCharges,
    isActive: existingAbility?.isActive ?? false,
    activatedAt: now,
  };
}

function resolveChronosTimebreakPracticeOrigin(ctx: AbilityContext, now: number): MutableVec3 {
  const resolvedOrigin = resolveAbilitySocketOrigin({
    ownerScope: 'localViewmodel',
    abilityId: 'chronos_timebreak',
    sampledContext: ctx.camera
      ? {
        camera: ctx.camera,
        elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
        timestampMs: ctx.viewmodelNowMs ?? now,
      }
      : undefined,
    preferSampled: true,
    warnOnSampleDrift: true,
    fallback: {
      position: ctx.position,
      yaw: ctx.yaw,
    },
  });
  const socketPosition = resolvedOrigin
    ? {
      x: resolvedOrigin.position.x,
      y: resolvedOrigin.position.y,
      z: resolvedOrigin.position.z,
    }
    : calculatePlayerSocketPosition(ctx.position, ctx.yaw, CHRONOS_PRIMARY_ORB_SOCKET);

  return offsetChronosOrbVisualPlainPosition(
    socketPosition,
    chronosOrbForwardFromYaw(ctx.yaw),
    'chronos_timebreak'
  );
}

type ChronosLifelineMode = 'allies' | 'self';
type ChronosPracticeLifelineTarget = {
  id: string;
  position: { x: number; y: number; z: number };
  isLocal: boolean;
  newHealth: number;
};

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

function didReleaseChargedPhantomVoidRay(input: {
  heroId: HeroId;
  previousSecondaryFire: boolean;
  nextSecondaryFire: boolean;
  phantomAbilities: UsePhantomAbilitiesReturn;
  now: number;
}): boolean {
  if (
    input.heroId !== 'phantom' ||
    !input.previousSecondaryFire ||
    input.nextSecondaryFire
  ) {
    return false;
  }

  const store = useGameStore.getState();
  const chargeStart = input.phantomAbilities.voidRayChargeStartRef.current || store.voidRayChargeStart || 0;
  if (chargeStart <= 0) return false;

  const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(input.now);
  return input.now - chargeStart >= VOID_RAY_CHARGE_TIME / tempoMultiplier;
}

function getAbility1ReleaseLockMs(heroId: HeroId): number {
  return heroId === 'blaze' ? BLAZE_STAFF_RETURN_TO_IDLE_MS : 0;
}

function setLocalPlayerVisualTransformFromCamera(
  playerId: string,
  position: { x: number; y: number; z: number },
  cameraControl: UseCameraReturn
): void {
  setPlayerVisualTransform(
    playerId,
    position,
    cameraControl.refs.yaw.current,
    cameraControl.refs.pitch.current
  );
}

function stopBattleRoyalDeploymentLoops(fadeOutMs = BATTLE_ROYAL_DROP_AUDIO_FADE_OUT_MS): void {
  stopSharedLoop(BATTLE_ROYAL_DROP_SHIP_LOOP_ID, fadeOutMs);
  stopSharedLoop(BATTLE_ROYAL_FLY_LOOP_ID, fadeOutMs);
}

function resetBattleRoyalDeploymentAudio(
  runtime: BattleRoyalDeploymentAudioRuntime,
  clearLandedSoundKey = false
): void {
  stopBattleRoyalDeploymentLoops();
  runtime.playerId = null;
  runtime.status = null;
  if (clearLandedSoundKey) {
    runtime.landedSoundKey = null;
  }
}

function getBattleRoyalLandedSoundKey(dropPlayer: BattleRoyalDropPlayerSnapshot): string {
  return `${dropPlayer.playerId}:${dropPlayer.droppedAt ?? 'unknown'}:${dropPlayer.landedAt ?? 'landed'}`;
}

function syncBattleRoyalDeploymentAudio(
  runtime: BattleRoyalDeploymentAudioRuntime,
  dropPlayer: BattleRoyalDropPlayerSnapshot | null | undefined
): void {
  if (!dropPlayer) {
    resetBattleRoyalDeploymentAudio(runtime);
    return;
  }

  const statusChanged = runtime.playerId !== dropPlayer.playerId || runtime.status !== dropPlayer.status;
  if (dropPlayer.status === 'aboard') {
    if (statusChanged) {
      stopSharedLoop(BATTLE_ROYAL_FLY_LOOP_ID, BATTLE_ROYAL_DROP_AUDIO_FADE_OUT_MS);
      void playSharedLoop(BATTLE_ROYAL_DROP_SHIP_LOOP_ID, 'battleRoyalDropShip', {
        fadeInMs: BATTLE_ROYAL_DROP_AUDIO_FADE_IN_MS,
      });
    }
  } else if (dropPlayer.status === 'dropping') {
    if (statusChanged) {
      stopSharedLoop(BATTLE_ROYAL_DROP_SHIP_LOOP_ID, BATTLE_ROYAL_DROP_AUDIO_FADE_OUT_MS);
      void playSharedLoop(BATTLE_ROYAL_FLY_LOOP_ID, 'battleRoyalFly', {
        fadeInMs: BATTLE_ROYAL_DROP_AUDIO_FADE_IN_MS,
      });
    }
  } else if (dropPlayer.status === 'landed') {
    if (statusChanged) {
      stopBattleRoyalDeploymentLoops(90);
    }

    const landedSoundKey = getBattleRoyalLandedSoundKey(dropPlayer);
    if (runtime.landedSoundKey !== landedSoundKey) {
      runtime.landedSoundKey = landedSoundKey;
      void playSharedSound('battleRoyalFlyDrop');
    }
  }

  runtime.playerId = dropPlayer.playerId;
  runtime.status = dropPlayer.status;
}

function clearBattleRoyalDeploymentPresentation(
  ctx: LocalPlayerFrameContext,
  clearDropKey = false
): void {
  resetBattleRoyalDeploymentAudio(ctx.refs.battleRoyalDeploymentAudioRef.current, clearDropKey);
  resetBattleRoyalFirstPersonDropCamera(ctx.refs.battleRoyalFirstPersonDropCameraRef.current, clearDropKey);
  setBattleRoyalFirstPersonDropBodyVisibleUntil(0);
}

// ============================================================================
// PLAYER CONTROLLER COMPONENT
// ============================================================================

interface PlayerControllerProps {
  enabled?: boolean;
  inputEnabled?: boolean;
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
  suppressJumpUntilReleaseRef: MutableRefObject<boolean>;
  positionRef: MutableRefObject<THREE.Vector3>;
  audioForwardRef: MutableRefObject<THREE.Vector3>;
  audioUpRef: MutableRefObject<THREE.Vector3>;
  battleRoyalFirstPersonDropCameraRef: MutableRefObject<BattleRoyalFirstPersonDropCameraRuntime>;
  battleRoyalDeploymentAudioRef: MutableRefObject<BattleRoyalDeploymentAudioRuntime>;
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
  isTouchInputActive: boolean;
  bombTargeting: boolean;
  isPracticeMode: boolean;
  updateLocalPlayer: GameStoreSnapshot['updateLocalPlayer'];
  setBombTargeting: GameStoreSnapshot['setBombTargeting'];
  setFlamethrowerActive: GameStoreSnapshot['setFlamethrowerActive'];
  setFlamethrowerFuel: GameStoreSnapshot['setFlamethrowerFuel'];
  sendMovementCommands: NetworkContextValue['sendMovementCommands'];
  cameraControl: UseCameraReturn;
  movement: UseMovementReturn;
  abilitySystem: UseAbilitySystemReturn;
  phantomAbilities: UsePhantomAbilitiesReturn;
  blazeAbilities: UseBlazeAbilitiesReturn;
  hookshotAbilities: UseHookshotAbilitiesReturn;
  chronosAbilities: UseChronosAbilitiesReturn;
  playerSounds: PlayerSounds;
  movementSounds: Pick<MovementSounds, 'playGroundJump' | 'updateWalkingSound' | 'startSlide' | 'stopSlide'>;
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
  isHeroActionLocked: (heroId: HeroId, timestampMs?: number, overlapGraceMs?: number) => boolean;
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
  blazePrimaryReloading: boolean;
  blazePrimaryHeldForPose: boolean;
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

export function suppressJumpInputUntilReleased(
  input: InputState,
  suppressJumpUntilReleaseRef: MutableRefObject<boolean>
): InputState {
  if (!suppressJumpUntilReleaseRef.current) return input;
  if (!input.jump) {
    suppressJumpUntilReleaseRef.current = false;
    return input;
  }
  return {
    ...input,
    jump: false,
  };
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
  const matchPerspective = useGameStore.getState().matchPerspective;
  cameraControl.updateCameraPosition(camera, {
    x: smoothedVisualPosition.x,
    y: cameraBodyY,
    z: smoothedVisualPosition.z,
  }, {
    perspective: matchPerspective,
    collision: resolveThirdPersonCameraCollision,
  });
  if (matchPerspective === 'first_person' && refs.battleRoyalFirstPersonDropCameraRef.current.active) {
    applyBattleRoyalFirstPersonDropCamera({
      runtime: refs.battleRoyalFirstPersonDropCameraRef.current,
      camera,
      bodyPosition: {
        x: smoothedVisualPosition.x,
        y: cameraBodyY,
        z: smoothedVisualPosition.z,
      },
      eyeHeight: EYE_HEIGHT + cameraControl.refs.crouchHeight.current,
      localYaw: cameraControl.refs.yaw.current,
      localPitch: cameraControl.refs.pitch.current + cameraControl.refs.slidePitch.current,
      nowMs: now,
    });
  } else if (matchPerspective !== 'first_person') {
    resetBattleRoyalFirstPersonDropCamera(refs.battleRoyalFirstPersonDropCameraRef.current, true);
    setBattleRoyalFirstPersonDropBodyVisibleUntil(0);
  }
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
  setLocalPlayerVisualTransformFromCamera(localPlayer.id, smoothedVisualPosition, cameraControl);

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
  if (!isMovementTraceRecordingEnabled()) return;

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
  const { bombTargeting, cameraControl, movement, refs } = ctx;
  const position = refs.positionRef.current;
  const velocity = movement.refs.velocity.current;

  if (now - refs.lastTraceRef.current < 1000 / TICK_RATE) return;

  refs.lastTraceRef.current = now;
  const storeForTrace = useGameStore.getState();
  const isTraceFlagCarrier = storeForTrace.gameplayMode === 'capture_the_flag' && localPlayer.hasFlag;
  const traceAbilityIds = writeActiveAbilityIdsForTrace(localPlayer.abilities, refs.traceAbilityIdsRef.current);
  const traceBindings = resolveRuntimeHeroAbilityBindings(
    heroId,
    useLoadoutStore.getState().heroAbilityBindings
  );
  if (frameInput.ability1) pushUniqueTraceAbilityId(traceAbilityIds, traceBindings.ability1);
  if (frameInput.ability2) pushUniqueTraceAbilityId(traceAbilityIds, traceBindings.ability2);
  if (frameInput.ultimate) {
    pushUniqueTraceAbilityId(
      traceAbilityIds,
      heroDef ? resolveEquippedUltimateAbilityId(heroId) : undefined,
    );
  }
  if (bombTargeting) pushUniqueTraceAbilityId(traceAbilityIds, 'blaze_bomb_targeting');
  traceAbilityIds.sort();
  const traceGroundY = localMovementForTrace.isGrounded
    ? position.y - PLAYER_HEIGHT / 2
    : null;
  const traceMovementClass = movementClassForTrace({
    heroId,
    movement: localMovementForTrace,
    inputState: commandInput,
    flagCarrier: isTraceFlagCarrier,
  });
  const afterburnerPressed = heroId === 'blaze' && (
    (frameInput.ability1 && traceBindings.ability1 === 'blaze_afterburner') ||
    (frameInput.ability2 && traceBindings.ability2 === 'blaze_afterburner')
  );
  const rocketJumpPressed = heroId === 'blaze' && (
    (frameInput.ability1 && traceBindings.ability1 === 'blaze_rocketjump') ||
    (frameInput.ability2 && traceBindings.ability2 === 'blaze_rocketjump')
  );
  const traceMovementBarrier = heroId === 'phantom' && frameInput.ability1
    ? 'teleport'
    : afterburnerPressed
      ? 'knockback'
      : rocketJumpPressed
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
    flagCarrier: isTraceFlagCarrier,
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
  const { cameraControl, phantomAbilities, blazeAbilities, chronosAbilities, flushMovementCommands, movementSounds, refs } = ctx;
  let { predictedState } = input;
  const wasGroundedBeforePrediction = predictedState.movement.isGrounded;
  const currentBombTargeting = useGameStore.getState().bombTargeting;
  const currentPhoenixDiveTargeting = useGameStore.getState().phoenixDiveTargeting;
  const phantomAutoReloadForServer = heroId === 'phantom' &&
    phantomAbilities.phantomPrimaryReloadingRef.current &&
    phantomAbilities.phantomPrimaryAmmoRef.current <= 0;
  const blazeAutoReloadForServer = heroId === 'blaze' &&
    blazeAbilities.blazePrimaryReloadingRef.current &&
    blazeAbilities.blazePrimaryAmmoRef.current <= 0;
  const chronosAutoReloadForServer = heroId === 'chronos' &&
    chronosAbilities.chronosPrimaryReloadingRef.current &&
    chronosAbilities.chronosPrimaryAmmoRef.current <= 0;
  const reloadForServer = frameInput.reload ||
    refs.pendingReloadInputRef.current ||
    ((phantomAutoReloadForServer || blazeAutoReloadForServer || chronosAutoReloadForServer) && !serverCombatInput.primaryFire);
  const crouchHeld = frameInput.crouch;
  const crouchPressedThisFrame = crouchHeld && !refs.lastCrouchHeldRef.current;
  if (crouchPressedThisFrame) {
    refs.pendingCrouchPressedRef.current = true;
  }
  refs.lastCrouchHeldRef.current = crouchHeld;
  const suppressPrimaryForBombTargeting = (
    heroId === 'blaze' &&
    currentBombTargeting &&
    localPlayer.state !== 'downed'
  );

  const commandInput: InputState = {
    ...frameInput,
    crouch: crouchHeld,
    primaryFire: suppressPrimaryForBombTargeting ? false : serverCombatInput.primaryFire,
    secondaryFire: serverCombatInput.secondaryFire,
    ability1: serverCombatInput.ability1,
    reload: reloadForServer,
    ability2: serverCombatInput.ability2,
    ultimate: serverCombatInput.ultimate,
  };
  const abilityCastHints = buildAbilityCastOriginHints(abilityCtx, commandInput, {
    bombTargeting: currentBombTargeting,
    phoenixDiveTarget: currentPhoenixDiveTargeting && blazeAbilities.phoenixDiveValidRef.current
      ? blazeAbilities.phoenixDiveTargetRef.current
      : null,
  });
  refs.latestAbilityCastHintsRef.current = abilityCastHints ?? [];

  const commandScheduleReasons = [...requestedCommandScheduleReasons];
  if (crouchPressedThisFrame) {
    addCommandScheduleReason(commandScheduleReasons, 'crouch_edge');
  }
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
    const wasGroundedBeforeStep = predictedState.movement.isGrounded;
    const wasSlidingBeforeStep = predictedState.movement.isSliding;
    const command = createLocalMovementCommand(commandInput, {
      lookYaw: cameraControl.refs.yaw.current,
      lookPitch: cameraControl.refs.pitch.current,
      clientTimeMs: now,
      crouchPressed: refs.pendingCrouchPressedRef.current,
      abilityCastHints,
    });
    recordMovementCommandGenerated();
    refs.pendingCrouchPressedRef.current = false;
    const nextPredictedState = stepLocalMovementPrediction(localPlayer, command);
    refs.pendingMovementCommandsRef.current.push(
      attachClientMovementState(command, nextPredictedState)
    );
    if (
      commandInput.jump &&
      wasGroundedBeforeStep &&
      !wasSlidingBeforeStep &&
      !nextPredictedState.movement.isGrounded
    ) {
      movementSounds.playGroundJump();
    }
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
  if (MOVEMENT_DIAGNOSTICS_ENABLED) {
    recordMovementFrameTiming({
      frameDeltaSeconds: rawDelta,
      movementDeltaSeconds: dt,
      substepsThisFrame,
      accumulatorBeforeStepSeconds: movementAccumulatorBeforeStep,
      accumulatorAfterStepSeconds: refs.movementCommandAccumulatorRef.current,
      catchup: substepsThisFrame > 1,
    });
  }
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
    blazeAbilities,
    chronosAbilities,
    lockHeroActions,
    isHeroActionLocked,
    refs,
  } = ctx;

  const heroDef = HERO_DEFINITIONS[heroId];
  const bombTargetingForFrame = useGameStore.getState().bombTargeting;
  const phoenixDiveTargetingForFrame = useGameStore.getState().phoenixDiveTargeting;
  const previousHoldInput = refs.lastExclusiveHoldInputRef.current;
  const chronosLifelineQueuedAtFrameStart = heroId === 'chronos' && refs.chronosLifelineQueuedRef.current;
  if (!rawFrameInput.primaryFire) {
    refs.chronosLifelineBlockPrimaryRef.current = false;
  }
  if (!rawFrameInput.secondaryFire) {
    refs.chronosLifelineBlockSecondaryRef.current = false;
  }
  let chronosLifelineCommitMode: ChronosLifelineMode | null = null;
  if (chronosLifelineQueuedAtFrameStart && !isHeroActionLocked(heroId, now, HERO_ACTION_OVERLAP_GRACE_MS)) {
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
    const didReleaseChargedVoidRay = didReleaseChargedPhantomVoidRay({
      heroId,
      previousSecondaryFire: previousHoldInput.secondaryFire,
      nextSecondaryFire: rawFrameInput.secondaryFire,
      phantomAbilities,
      now,
    });
    lockHeroActions(
      heroId,
      getSecondaryReleaseLockMs(heroId, didReleaseChargedVoidRay),
      now
    );
  }
  if (previousHoldInput.ability1 && !rawFrameInput.ability1) {
    lockHeroActions(heroId, getAbility1ReleaseLockMs(heroId), now);
  }
  if (previousHoldInput.ability2 && !rawFrameInput.ability2) {
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
      isHeroActionLocked(heroId, now, HERO_ACTION_OVERLAP_GRACE_MS),
      heroId === 'blaze' && bombTargetingForFrame,
      continuingHoldInput,
      lockedAllowedInput,
      heroId === 'blaze' && phoenixDiveTargetingForFrame,
    );
    if (
      heroId === 'blaze' &&
      phoenixDiveTargetingForFrame &&
      frameInput.ultimate &&
      !blazeAbilities.phoenixDiveValidRef.current
    ) {
      frameInput = withCastActionFields(frameInput);
    }
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
    if (reloadPressed) {
      phantomAbilities.reloadPhantomPrimary(now);
    } else {
      phantomAbilities.updatePhantomPrimaryReload(now);
    }
  } else if (heroId === 'blaze') {
    if (reloadPressed) {
      blazeAbilities.reloadBlazePrimary(now);
    } else {
      blazeAbilities.updateBlazePrimaryReload(now);
    }
  } else if (heroId === 'chronos') {
    if (reloadPressed) {
      chronosAbilities.reloadChronosPrimary(now);
    } else {
      chronosAbilities.updateChronosPrimaryReload(now);
    }
  }

  const phantomPrimaryReloading = heroId === 'phantom' && phantomAbilities.phantomPrimaryReloadingRef.current;
  const blazePrimaryReloading = heroId === 'blaze' && blazeAbilities.blazePrimaryReloadingRef.current;
  const chronosPrimaryReloading = heroId === 'chronos' && chronosAbilities.chronosPrimaryReloadingRef.current;
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
  const blazePrimaryHeldForPose = (
    heroId === 'blaze' &&
    frameInput.primaryFire &&
    !bombTargetingForFrame &&
    !blazePrimaryReloading
  );
  const primaryFireForServer = heroId === 'phantom'
    ? phantomPrimaryHeldForPose && phantomAbilities.phantomPrimaryAmmoRef.current > 0
    : heroId === 'chronos'
      ? frameInput.primaryFire && !chronosPrimaryReloading && chronosAbilities.chronosPrimaryAmmoRef.current > 0
      : heroId === 'blaze'
        ? blazePrimaryHeldForPose && blazeAbilities.blazePrimaryAmmoRef.current > 0
        : frameInput.primaryFire;
  const ability2ForServer = frameInput.ability2;
  const serverCombatInput = deriveServerCombatInput({
    frameInput,
    primaryFireForServer,
    ability2ForServer,
  });
  const requestedCommandScheduleReasons: CommandScheduleReason[] = [];
  const movementBarrierInputPressed = (
    (heroId === 'phantom' && frameInput.ability1 && !abilitySystem.abilityPressedRef.current.ability1) ||
    (
      heroId === 'phantom' &&
      useLoadoutStore.getState().phantomSecondarySkill === 'rift_bolt' &&
      frameInput.secondaryFire &&
      !previousHoldInput.secondaryFire &&
      useGameStore.getState().riftBolts.some((bolt) => bolt.ownerId === localPlayer.id)
    ) ||
    (heroId === 'blaze' && (
      (frameInput.ability1 && !abilitySystem.abilityPressedRef.current.ability1) ||
      (frameInput.ability2 && !abilitySystem.abilityPressedRef.current.ability2)
    )) ||
    (
      heroId === 'blaze' &&
      frameInput.ultimate &&
      !abilitySystem.abilityPressedRef.current.ultimate &&
      resolveEquippedUltimateAbilityId(heroId) === 'blaze_phoenix_dive'
    ) ||
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
    blazePrimaryReloading,
    blazePrimaryHeldForPose,
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
    chronosAbilities,
    resetPredictedAbilitySounds,
    resetViewmodelPoseState,
    resetBlazeFlamethrower,
    resetMovementCommandBuffer,
    clearHeroActionLock,
    refs,
  } = ctx;

  clearBattleRoyalDeploymentPresentation(ctx, true);
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
  blazeAbilities.resetBlazePrimaryMagazine();
  chronosAbilities.resetChronosPrimaryMagazine();
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

function localControlLookForAuthority(
  ctx: LocalPlayerFrameContext,
  localPlayer: Player
): Pick<Player, 'lookYaw' | 'lookPitch'> {
  const lookYaw = ctx.cameraControl.refs.yaw.current;
  const lookPitch = ctx.cameraControl.refs.pitch.current;
  return {
    lookYaw: Number.isFinite(lookYaw) ? lookYaw : localPlayer.lookYaw,
    lookPitch: Number.isFinite(lookPitch) ? lookPitch : localPlayer.lookPitch,
  };
}

const AUTHORITY_RESOURCE_EPSILON = 0.01;

function syncBlazeAuthorityMovementAnchor(
  localPlayer: Player,
  movement: MovementSimulationState['movement']
): Player {
  if (localPlayer.heroId !== 'blaze') return localPlayer;

  const jetpackFuel = Math.max(0, Math.min(BLAZE_FLAMETHROWER_MAX_FUEL, movement.jetpackFuel));
  const isJetpacking = movement.isJetpacking;
  const store = useGameStore.getState();
  const currentLocalPlayer = store.localPlayer?.id === localPlayer.id ? store.localPlayer : localPlayer;
  if (
    currentLocalPlayer.movement.isJetpacking === isJetpacking &&
    Math.abs(currentLocalPlayer.movement.jetpackFuel - jetpackFuel) < AUTHORITY_RESOURCE_EPSILON
  ) {
    return currentLocalPlayer;
  }

  const syncedMovement = {
    ...currentLocalPlayer.movement,
    isJetpacking,
    jetpackFuel,
  };
  const syncedPlayer: Player = {
    ...currentLocalPlayer,
    movement: syncedMovement,
  };

  // Local player updates are mirrored into the players Map by updateLocalPlayer
  // without replacing the Map reference, keeping remote render subscribers stable.
  store.updateLocalPlayer({
    movement: {
      ...syncedMovement,
    },
  });

  return syncedPlayer;
}

export function runAuthorityPhase(
  ctx: LocalPlayerFrameContext,
  localPlayer: Player,
  frameNowMs: number
): { localPlayer: Player; authorityApplied: number } {
  const { updateLocalPlayer, resetMovementCommandBuffer } = ctx;
  const localLook = localControlLookForAuthority(ctx, localPlayer);
  const pendingAuthoritiesBeforeDrain = getPendingSelfMovementAuthorityCount();
  const shouldMeasureAuthorityDrain = MOVEMENT_DIAGNOSTICS_ENABLED && pendingAuthoritiesBeforeDrain > 0;
  const authorityDrainStartedAt = shouldMeasureAuthorityDrain ? performance.now() : 0;
  const appliedAuthorities = drainSelfMovementAuthorities(localPlayer, frameNowMs, {
    visualLookYaw: localLook.lookYaw,
    includeDuplicateAckAuthorities: localPlayer.state === 'dropping',
  });
  if (shouldMeasureAuthorityDrain) {
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

  if (MOVEMENT_DIAGNOSTICS_ENABLED) {
    authorityMetricsScratch.length = 0;
    for (const application of appliedAuthorities) {
      authorityMetricsScratch.push(application.result);
    }
    recordAuthorityFrameApplied(authorityMetricsScratch);
    authorityMetricsScratch.length = 0;
  }
  if (appliedAuthorities.some((application) => (
    application.authority.correctionReason &&
    application.authority.correctionReason !== 'normal'
  ))) {
    resetMovementCommandBuffer();
  }

  if (localPlayer.state === 'dropping') {
    const latestAuthority = appliedAuthorities[appliedAuthorities.length - 1];
    const movement = {
      ...latestAuthority.authority.movement,
      grapplePoint: latestAuthority.authority.movement.grapplePoint
        ? { ...latestAuthority.authority.movement.grapplePoint }
        : null,
    };
    const updates = {
      position: { ...latestAuthority.authority.position },
      velocity: { ...latestAuthority.authority.velocity },
      lookYaw: localLook.lookYaw,
      lookPitch: localLook.lookPitch,
      movement,
    };
    confirmLocalMovementTransform(localPlayer, {
      position: updates.position,
      velocity: updates.velocity,
      movement,
    }, localLook.lookYaw);
    updateLocalPlayer(updates);
    recordLocalReactiveUpdate('selfAuthority');
    return {
      localPlayer: { ...localPlayer, ...updates },
      authorityApplied: appliedAuthorities.length,
    };
  }

  const reactiveAuthority = selectReactiveAuthority(appliedAuthorities);
  if (!shouldApplyReactiveAuthority(reactiveAuthority)) {
    return { localPlayer, authorityApplied: appliedAuthorities.length };
  }

  const updates = {
    position: { ...reactiveAuthority!.state.position },
    velocity: { ...reactiveAuthority!.state.velocity },
    lookYaw: localLook.lookYaw,
    lookPitch: localLook.lookPitch,
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
    chronosAbilities,
    resetMovementCommandBuffer,
    resetPredictedAbilitySounds,
    clearHeroActionLock,
    setBombTargeting,
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
  setFlamethrowerActive(false);
  phantomAbilities.resetPhantomPrimaryMagazine();
  blazeAbilities.resetBlazePrimaryMagazine();
  chronosAbilities.resetChronosPrimaryMagazine();
  resetViewmodelPoseState('hero-swap', localPlayer.heroId as HeroId, now);
  resetBlazeFlamethrower(now);
  blazeAbilities.resetRocketJump();
}

function runDevTestingInteractionFrame(
  localPlayer: Player,
  frameInput: InputState,
  interactHeldRef: MutableRefObject<boolean>
): boolean {
  const store = useGameStore.getState();
  const canInteract = (
    store.isPracticeMode &&
    store.gamePhase === 'playing' &&
    localPlayer.state === 'alive' &&
    isDevTestingMapProfileId(store.mapProfileId)
  );

  if (!canInteract) {
    store.setInteractionPrompt(null);
    interactHeldRef.current = frameInput.interact;
    return false;
  }

  const position = visualStore.getState().playerPositions.get(localPlayer.id) ?? localPlayer.position;
  const preparedMap = getPreparedVoxelMap({
    seed: store.mapSeed,
    themeId: store.mapThemeId,
    mapSize: store.mapSize,
    mapProfileId: store.mapProfileId,
    pregeneratedMapId: store.pregeneratedMapId,
  });
  const manifest = preparedMap?.manifest ?? null;
  const interaction = manifest ? getDevTestingHeroInteraction(manifest, position, localPlayer.heroId) : null;
  const pressed = frameInput.interact && !interactHeldRef.current;
  interactHeldRef.current = frameInput.interact;

  if (!interaction) {
    store.setInteractionPrompt(null);
    return false;
  }

  store.setInteractionPrompt({
    id: `dev-testing-switch-${interaction.heroId}`,
    actionLabel: 'Switch hero',
    targetLabel: interaction.label,
  });

  if (!pressed) return false;

  store.updateLocalPlayer(createDevTestingHeroSwitchUpdates(
    localPlayer,
    interaction.heroId,
    useLoadoutStore.getState().blazeUltimateSkill,
  ));
  store.setInteractionPrompt(null);
  return true;
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
    chronosAbilities,
    refs,
  } = ctx;
  const { dt, now } = timing;

  clearBattleRoyalDeploymentPresentation(ctx, true);
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
  chronosAbilities.resetChronosPrimaryMagazine();
  cameraControl.resetDeathCamera(camera);

  const visualPos = visualStore.getState().playerPositions.get(localPlayer.id) || localPlayer.position;
  cameraControl.updateCameraRotation(camera, false, false, dt);
  cameraControl.updateCameraPosition(camera, visualPos, {
    perspective: useGameStore.getState().matchPerspective,
    collision: resolveThirdPersonCameraCollision,
  });
  setLocalPlayerVisualTransformFromCamera(localPlayer.id, visualPos, cameraControl);
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

  clearBattleRoyalDeploymentPresentation(ctx, true);
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
    cameraControl.updateCameraPosition(camera, visualPos, {
      perspective: useGameStore.getState().matchPerspective,
      collision: resolveThirdPersonCameraCollision,
    });
  }
  camera.updateMatrixWorld();
  camera.getWorldDirection(refs.audioForwardRef.current);
  refs.audioUpRef.current.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  setAudioListenerTransform(camera.position, refs.audioForwardRef.current, refs.audioUpRef.current);
  setLocalPlayerVisualTransformFromCamera(localPlayer.id, visualPos, cameraControl);
  return { kind: 'inactive', authorityApplied, substeps: 0, deathCamera: shouldUseDeathCamera };
}

function runObserverLifecycleFrame(
  ctx: LocalPlayerFrameContext,
  localPlayer: Player,
  timing: FrameTiming,
  frameInput: InputState
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
    updateLocalPlayer,
    refs,
  } = ctx;
  const { dt, now } = timing;

  clearBattleRoyalDeploymentPresentation(ctx, true);
  cameraControl.resetDeathCamera(camera);
  resetViewmodelPoseState('observer', null, now);
  resetBlazeFlamethrower(now);
  resetMovementCommandBuffer();
  resetPredictedAbilitySounds();
  clearHeroActionLock();
  refs.reloadPressedRef.current = false;
  refs.pendingReloadInputRef.current = false;
  refs.lastExclusiveHoldInputRef.current = { ...EMPTY_EXCLUSIVE_HOLD_INPUT };

  setLocalViewmodelMovement({
    hasMovementInput: false,
    isSprinting: false,
    horizontalSpeed: 0,
    updatedAtMs: now,
  });
  setChronosAegisVisualState(localPlayer.id, false, now);
  setLocalSlideIntensity(0);
  setLocalVisualMovement(INACTIVE_LOCAL_MOVEMENT);
  movement.refs.slideIntensity.current = 0;
  movement.refs.velocity.current.set(0, 0, 0);
  movement.refs.isGrounded.current = false;
  movement.refs.wasGrounded.current = false;
  movement.refs.canJump.current = false;
  movement.refs.isCrouching.current = false;
  movement.refs.isSprinting.current = false;
  movement.refs.isSliding.current = false;
  movement.refs.slideTime.current = 0;
  movement.refs.smoothedY.current = null;

  cameraControl.updateCameraRotation(camera, false, false, dt);
  camera.getWorldDirection(observerFlightForward).normalize();
  observerFlightRight
    .set(Math.cos(cameraControl.refs.yaw.current), 0, -Math.sin(cameraControl.refs.yaw.current))
    .normalize();
  observerFlightMove.set(0, 0, 0);

  if (frameInput.moveForward) observerFlightMove.add(observerFlightForward);
  if (frameInput.moveBackward) observerFlightMove.sub(observerFlightForward);
  if (frameInput.moveRight) observerFlightMove.add(observerFlightRight);
  if (frameInput.moveLeft) observerFlightMove.sub(observerFlightRight);
  if (frameInput.jump) observerFlightMove.y += 1;
  if (frameInput.crouch) observerFlightMove.y -= 1;

  if (observerFlightMove.lengthSq() > 0.0001) {
    observerFlightMove.normalize();
    const speed = OBSERVER_FLIGHT_SPEED_UNITS[useGameStore.getState().observerFlightSpeed] ?? OBSERVER_FLIGHT_SPEED_UNITS.med;
    camera.position.addScaledVector(observerFlightMove, speed * dt);
    camera.position.y = Math.max(0.5, camera.position.y);
  }

  camera.updateMatrixWorld();
  camera.getWorldDirection(refs.audioForwardRef.current);
  refs.audioUpRef.current.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  setAudioListenerTransform(camera.position, refs.audioForwardRef.current, refs.audioUpRef.current);

  const observerPosition = {
    x: camera.position.x,
    y: camera.position.y,
    z: camera.position.z,
  };
  refs.positionRef.current.copy(camera.position);
  setPlayerVisualTransform(
    localPlayer.id,
    observerPosition,
    cameraControl.refs.yaw.current,
    cameraControl.refs.pitch.current
  );
  updateLocalPlayer({
    role: 'observer',
    state: 'spectating',
    heroId: null,
    skinId: null,
    position: observerPosition,
    velocity: { x: 0, y: 0, z: 0 },
    lookYaw: cameraControl.refs.yaw.current,
    lookPitch: cameraControl.refs.pitch.current,
    movement: INACTIVE_LOCAL_MOVEMENT,
  });

  return { kind: 'inactive', authorityApplied: 0, substeps: 0, deathCamera: false };
}

function runBattleRoyalDeploymentFrame(
  ctx: LocalPlayerFrameContext,
  localPlayer: Player,
  timing: FrameTiming,
  frameInput: InputState,
  authorityApplied: number,
  sendDropCommands: boolean
): LocalPlayerFrameResult {
  const {
    camera,
    cameraControl,
    flushMovementCommands,
    movement,
    resetBlazeFlamethrower,
    resetPredictedAbilitySounds,
    resetViewmodelPoseState,
    clearHeroActionLock,
    resetMovementCommandBuffer,
    refs,
  } = ctx;
  const { dt, now } = timing;
  const store = useGameStore.getState();
  const drop = store.battleRoyalDrop;
  const dropPlayer = findBattleRoyalDropPlayer(drop, localPlayer.id);
  const isLanded = dropPlayer?.status === 'landed' || localPlayer.movement.isGrounded;
  const isDropping = (dropPlayer ? dropPlayer.status === 'dropping' : localPlayer.state === 'dropping') && !isLanded;
  syncBattleRoyalDeploymentAudio(refs.battleRoyalDeploymentAudioRef.current, dropPlayer);

  setLocalViewmodelMovement({
    hasMovementInput: false,
    isSprinting: false,
    horizontalSpeed: 0,
    updatedAtMs: now,
  });
  resetViewmodelPoseState('battle-royal-deployment', localPlayer.heroId as HeroId, now);
  setChronosAegisVisualState(localPlayer.id, false, now);
  resetBlazeFlamethrower(now);
  resetPredictedAbilitySounds();
  clearHeroActionLock();
  movement.refs.slideIntensity.current = 0;
  setLocalSlideIntensity(0);
  const deploymentMovement: PlayerMovementState = {
    ...localPlayer.movement,
    isGrounded: isLanded,
    isSprinting: false,
    isCrouching: false,
    isSliding: false,
    slideTimeRemaining: 0,
    isWallRunning: false,
    wallRunSide: null,
    isGrappling: false,
    grapplePoint: null,
    isJetpacking: isDropping,
    isGliding: false,
  };
  const isDropMaster = Boolean(dropPlayer && dropPlayer.attachedToPlayerId === null);
  const canSendDropInteract = Boolean(
    dropPlayer?.status === 'aboard' &&
    isDropMaster &&
    drop?.ship.canDrop === true
  );

  const commandInput: InputState = {
    ...frameInput,
    interact: frameInput.interact && canSendDropInteract,
    primaryFire: false,
    secondaryFire: false,
    reload: false,
    jump: false,
    ability1: false,
    ability2: false,
    ultimate: false,
  };
  cameraControl.updateCameraRotation(camera, false, false, dt);
  const predictedDropState = sendDropCommands && isDropping && isDropMaster
    ? predictLocalBattleRoyalDrop(localPlayer, commandInput, {
      lookYaw: cameraControl.refs.yaw.current,
      lookPitch: cameraControl.refs.pitch.current,
      deltaTime: dt,
      nowMs: now,
    })
    : null;
  setLocalVisualMovement(predictedDropState?.movement ?? deploymentMovement);
  const visualPos = predictedDropState?.position ?? visualStore.getState().playerPositions.get(localPlayer.id) ?? localPlayer.position;
  battleRoyalDeploymentVisualPosition.set(visualPos.x, visualPos.y, visualPos.z);
  if (drop) {
    writeBattleRoyalDeploymentCameraTarget({
      drop,
      playerId: localPlayer.id,
      now: sendDropCommands ? now : drop.ship.startedAt,
      livePodPosition: battleRoyalDeploymentVisualPosition,
      target: battleRoyalDeploymentCameraTarget,
    });
    resetBattleRoyalFirstPersonDropCamera(refs.battleRoyalFirstPersonDropCameraRef.current);
    applyBattleRoyalDeploymentCamera({
      camera,
      currentPosition: battleRoyalDeploymentCameraPosition,
      lookTarget: battleRoyalDeploymentLookTarget,
      cameraTarget: battleRoyalDeploymentCameraTarget,
      localYaw: cameraControl.refs.yaw.current,
      localPitch: cameraControl.refs.pitch.current,
      delta: dt,
    });
  } else {
    resetBattleRoyalFirstPersonDropCamera(refs.battleRoyalFirstPersonDropCameraRef.current, true);
    setBattleRoyalFirstPersonDropBodyVisibleUntil(0);
    camera.position.set(
      battleRoyalDeploymentVisualPosition.x,
      battleRoyalDeploymentVisualPosition.y + EYE_HEIGHT * 0.82,
      battleRoyalDeploymentVisualPosition.z
    );
  }
  camera.updateMatrixWorld();
  camera.getWorldDirection(refs.audioForwardRef.current);
  refs.audioUpRef.current.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  setAudioListenerTransform(camera.position, refs.audioForwardRef.current, refs.audioUpRef.current);
  setLocalPlayerVisualTransformFromCamera(localPlayer.id, battleRoyalDeploymentVisualPosition, cameraControl);

  if (!sendDropCommands) {
    resetMovementCommandBuffer();
    return { kind: 'inactive', authorityApplied, substeps: 0, deathCamera: false };
  }

  refs.movementCommandAccumulatorRef.current = Math.min(
    refs.movementCommandAccumulatorRef.current + dt,
    MOVEMENT_SUBSTEP_SECONDS * MOVEMENT_MAX_PACKET_COMMANDS
  );
  if (commandInput.interact) {
    refs.movementCommandAccumulatorRef.current = Math.max(
      refs.movementCommandAccumulatorRef.current,
      MOVEMENT_SUBSTEP_SECONDS
    );
  }

  let substepsThisFrame = 0;
  while (
    refs.movementCommandAccumulatorRef.current >= MOVEMENT_SUBSTEP_SECONDS &&
    substepsThisFrame < MOVEMENT_MAX_PACKET_COMMANDS
  ) {
    const command = createLocalMovementCommand(commandInput, {
      lookYaw: cameraControl.refs.yaw.current,
      lookPitch: cameraControl.refs.pitch.current,
      clientTimeMs: now,
    });
    recordMovementCommandGenerated();
    // Drop movement is server-owned; only buttons and look angles are consumed.
    refs.pendingMovementCommandsRef.current.push(
      stripClientMovementState(command)
    );
    refs.movementCommandAccumulatorRef.current -= MOVEMENT_SUBSTEP_SECONDS;
    refs.tickRef.current = command.seq;
    substepsThisFrame++;
  }
  flushMovementCommands(now, commandInput.interact);

  return { kind: 'live', authorityApplied, substeps: substepsThisFrame };
}

export function PlayerController({ enabled = true, inputEnabled = true }: PlayerControllerProps) {
  const { camera } = useThree();

  // Store state and actions
  const updateLocalPlayer = useGameStore(state => state.updateLocalPlayer);
  const setBombTargeting = useGameStore(state => state.setBombTargeting);
  const bombTargeting = useGameStore(state => state.bombTargeting);
  const phoenixDiveTargeting = useGameStore(state => state.phoenixDiveTargeting);
  const setFlamethrowerActive = useGameStore(state => state.setFlamethrowerActive);
  const setFlamethrowerFuel = useGameStore(state => state.setFlamethrowerFuel);
  const gamePhase = useGameStore(state => state.gamePhase);
  const localPlayerForInit = useGameStore(state => state.localPlayer);
  const isPracticeMode = useGameStore(state => state.isPracticeMode);

  // Input and network
  const {
    inputState,
    isPointerLocked,
    isTouchInputActive,
    isGamepadInputActive,
    requestPointerLock,
    exitPointerLock,
  } = useInput({ gamepadEnabled: inputEnabled });
  usePhysics();
  const { sendMovementCommands, sendMapPing } = useNetwork();
  const pingKeybinding = useSettingsStore(state => state.settings.keybindings.ping);
  const blazePrimarySkill = useLoadoutStore(state => state.blazePrimarySkill);
  const phantomPrimarySkill = useLoadoutStore(state => state.phantomPrimarySkill);
  const phantomSecondarySkill = useLoadoutStore(state => state.phantomSecondarySkill);
  const blazeSecondarySkill = useLoadoutStore(state => state.blazeSecondarySkill);
  const heroAbilityBindings = useLoadoutStore(state => state.heroAbilityBindings);

  // Audio hooks
  const {
    playPhantomBlink, playPhantomVeil, playPhantomBasic, playPhantomVoidRay,
    startPhantomVoidRayCharge, stopPhantomVoidRayCharge,
    playBlazeRocket, playBlazeBombTarget, playBlazeBombRelease, playBlazeBombFall, playBlazeBombExplode, playBlazeRocketJump,
    startFlamethrowerSound, stopFlamethrowerSound,
  } = useAbilitySounds();
  const { playGroundJump, updateWalkingSound, preloadWalkingSound, startSlide, stopSlide } = useMovementSounds();

  // Player hooks
  const cameraControl = useCamera({ isPointerLocked });
  const movement = useMovement();
  const abilitySystem = useAbilitySystem();

  // Hero ability hooks
  const phantomAbilities = usePhantomAbilities(phantomPrimarySkill, phantomSecondarySkill);
  const blazeAbilities = useBlazeAbilities(blazePrimarySkill, blazeSecondarySkill);
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
  const devTestingInteractHeldRef = useRef(false);
  const suppressJumpUntilReleaseRef = useRef(false);
  const positionRef = useRef(new THREE.Vector3());
  const audioForwardRef = useRef(new THREE.Vector3());
  const audioUpRef = useRef(new THREE.Vector3(0, 1, 0));
  const battleRoyalFirstPersonDropCameraRef = useRef(createBattleRoyalFirstPersonDropCameraRuntime());
  const battleRoyalDeploymentAudioRef = useRef(createBattleRoyalDeploymentAudioRuntime());
  const practiceBlazePhoenixDiveRef = useRef<PracticeBlazePhoenixDiveRuntime | null>(null);
  const frameContextRef = useRef<LocalPlayerFrameContext | null>(null);
  // Persistent per-frame scratch objects for the alive-path frame loop. Each is
  // mutated in place every frame; all consumers read them synchronously and copy
  // out (verified: no command-buffer / prediction-record / network retention).
  const abilityCtxRef = useRef<AbilityContext | null>(null);
  const predictionOptionsRef = useRef<Parameters<typeof runPredictionAndCommandPhase>[0] | null>(null);
  const presentationOptionsRef = useRef<Parameters<typeof runPresentationPhase>[0] | null>(null);
  const traceOptionsRef = useRef<Parameters<typeof runTracePhase>[0] | null>(null);
  const soundFrameArgRef = useRef<LocalAbilityAudioPredictionFrame | null>(null);
  const soundLocalPlayerRef = useRef<Player | null>(null);

  useEffect(() => () => {
    clearPracticeBlazePhoenixDiveRuntime(practiceBlazePhoenixDiveRef);
    useGameStore.getState().setPhoenixDiveTargeting(false, false);
  }, []);

  useEffect(() => {
    if (localPlayerForInit?.heroId === 'blaze' && localPlayerForInit.state === 'alive') return;
    clearPracticeBlazePhoenixDiveRuntime(practiceBlazePhoenixDiveRef);
    useGameStore.getState().setPhoenixDiveTargeting(false, false);
  }, [localPlayerForInit?.heroId, localPlayerForInit?.state]);
  // Stable closures for the reused sound-update arg. updatePredictedAbilitySounds
  // invokes both only synchronously and never retains them.
  const getAbilityChargesForSound = useCallback(
    (abilityId: string) => soundLocalPlayerRef.current?.abilities?.[abilityId]?.charges,
    []
  );
  const canUseHookshotGrappleForSound = useCallback(() => {
    const ctx = abilityCtxRef.current;
    const frameCtx = frameContextRef.current;
    if (!ctx || !frameCtx) return false;
    return frameCtx.hookshotAbilities.canGrapple(ctx);
  }, []);

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
    const wasQueued = chronosLifelineQueuedRef.current;
    chronosLifelineQueuedRef.current = queued;
    chronosLifelineBlockPrimaryRef.current = queued && Boolean(input?.primaryFire);
    chronosLifelineBlockSecondaryRef.current = queued && Boolean(input?.secondaryFire);
    chronosLifelineCommitHeldRef.current = false;
    useGameStore.getState().setChronosLifelineQueuedHud(queued);
    setChronosLifelineQueued(queued, timestampMs);
    if (queued && !wasQueued) {
      void playSharedLoop(CHRONOS_LIFELINE_READY_LOOP_ID, 'chronosLifelineActive', {
        fadeInMs: CHRONOS_LIFELINE_READY_FADE_IN_MS,
      });
    } else if (!queued) {
      stopSharedLoop(CHRONOS_LIFELINE_READY_LOOP_ID);
    }
  }, []);

  const isHeroActionLocked = useCallback((heroId: HeroId, timestampMs = Date.now(), overlapGraceMs = 0) => (
    heroId === 'blaze'
      ? isBlazeActionLocked(timestampMs, overlapGraceMs)
      : isActionLockBlocking(actionLockUntilRef.current, timestampMs, overlapGraceMs)
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
      const startYaw = Number.isFinite(localPlayerForInit.lookYaw) ? localPlayerForInit.lookYaw : 0;
      const startPitch = Number.isFinite(localPlayerForInit.lookPitch) ? localPlayerForInit.lookPitch : 0;
      cameraControl.refs.yaw.current = startYaw;
      cameraControl.refs.pitch.current = startPitch;
      camera.position.set(localPlayerForInit.position.x, startY + EYE_HEIGHT, localPlayerForInit.position.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = startYaw;
      camera.rotation.x = startPitch;
      camera.rotation.z = 0;

      initializedRef.current = true;
    }
  }, [localPlayerForInit, camera, cameraControl.refs.pitch, cameraControl.refs.yaw]);

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
      resetBattleRoyalDeploymentAudio(battleRoyalDeploymentAudioRef.current, true);
      resetBattleRoyalFirstPersonDropCamera(battleRoyalFirstPersonDropCameraRef.current, true);
      setBattleRoyalFirstPersonDropBodyVisibleUntil(0);
      resetViewmodelPoseState('unmount', lastHeroIdRef.current as HeroId | null);
      lastExclusiveHoldInputRef.current = { ...EMPTY_EXCLUSIVE_HOLD_INPUT };
      clearHeroActionLock();
      setChronosPrimaryHeld(false);
      setChronosLifelineQueuedState(false);
    };
  }, [clearHeroActionLock, resetBlazeFlamethrower, resetMovementCommandBuffer, resetViewmodelPoseState, setChronosLifelineQueuedState]);

  // Enter pointer lock from the canvas click.
  const handleClick = useCallback(() => {
    if (!enabled) return;

    if (!isPointerLocked) {
      requestPointerLock();
    }
  }, [enabled, isPointerLocked, requestPointerLock]);

  // Canvas click listener
  useEffect(() => {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.addEventListener('click', handleClick);
      return () => canvas.removeEventListener('click', handleClick);
    }
  }, [handleClick]);

  useEffect(() => {
    const consumePingEvent = (event: MouseEvent | KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const handlePingAction = (event: MouseEvent | KeyboardEvent): void => {
      if (!enabled || !inputEnabled || !isPointerLocked) return;
      if (document.body.dataset.rebindingKeybind === 'true' || isGameConsoleOpen()) return;

      const localPlayer = useGameStore.getState().localPlayer;
      if (!localPlayer || localPlayer.state !== 'alive') return;

      const position = resolveMapPingAimPosition(camera);
      if (!position) return;

      consumePingEvent(event);
      sendMapPing(isNearActivePing(position) ? null : position);
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (mouseButtonToKeybindCode(event.button) !== pingKeybinding) return;
      handlePingAction(event);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== pingKeybinding) return;
      handlePingAction(event);
    };

    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [camera, enabled, inputEnabled, isPointerLocked, pingKeybinding, sendMapPing]);

  // Cancel targeting on right-click or Escape
  useEffect(() => {
    const handleCancel = (e: MouseEvent | KeyboardEvent) => {
      const store = useGameStore.getState();
      const isBombTargeting = store.bombTargeting;

      if (!isBombTargeting) return;

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
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      const store = useGameStore.getState();
      if (store.bombTargeting) {
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
      isTouchInputActive,
      bombTargeting,
      isPracticeMode,
      updateLocalPlayer,
      setBombTargeting,
      setFlamethrowerActive,
      setFlamethrowerFuel,
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
        playGroundJump,
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
        suppressJumpUntilReleaseRef,
        positionRef,
        audioForwardRef,
        audioUpRef,
        battleRoyalFirstPersonDropCameraRef,
        battleRoyalDeploymentAudioRef,
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
      frameCtx.isTouchInputActive = isTouchInputActive;
      frameCtx.bombTargeting = bombTargeting;
      frameCtx.isPracticeMode = isPracticeMode;
      frameCtx.updateLocalPlayer = updateLocalPlayer;
      frameCtx.setBombTargeting = setBombTargeting;
      frameCtx.setFlamethrowerActive = setFlamethrowerActive;
      frameCtx.setFlamethrowerFuel = setFlamethrowerFuel;
      frameCtx.sendMovementCommands = sendMovementCommands;
      frameCtx.cameraControl = cameraControl;
      frameCtx.movement = movement;
      frameCtx.abilitySystem = abilitySystem;
      frameCtx.phantomAbilities = phantomAbilities;
      frameCtx.blazeAbilities = blazeAbilities;
      frameCtx.hookshotAbilities = hookshotAbilities;
      frameCtx.chronosAbilities = chronosAbilities;
      frameCtx.playerSounds = playerSounds;
      frameCtx.movementSounds.playGroundJump = playGroundJump;
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
    const isPlaying = gamePhase === 'playing' || gamePhase === 'countdown' || gamePhase === 'deployment';
    const frameClock = getFrameClock();
    const now = frameClock.epochNowMs;
    const frameNowMs = frameClock.nowMs;

    if (!localPlayer) {
      useGameStore.getState().setInteractionPrompt(null);
      devTestingInteractHeldRef.current = false;
      runNoLocalPlayerFrame(frameCtx, now);
      return;
    }

    const isObserverMode = localPlayer.role === 'observer';
    const authority = isObserverMode
      ? { localPlayer, authorityApplied: 0 }
      : runAuthorityPhase(frameCtx, localPlayer, frameNowMs);
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
      useGameStore.getState().setInteractionPrompt(null);
      devTestingInteractHeldRef.current = false;
      runDisabledLifecycleFrame(frameCtx, localPlayer, timing, authority.authorityApplied);
      return;
    }

    // ESC/menu releases pointer lock, but local physics still needs to keep
    // grounding and server position sync alive instead of replaying stale input.
    const hasControlInput = inputEnabled && (isPointerLocked || isTouchInputActive || isGamepadInputActive);
    let rawFrameInput = hasControlInput ? inputState : INACTIVE_INPUT_STATE;
    let frameInput = rawFrameInput;
    const hasMovementInput = (
      rawFrameInput.moveForward ||
      rawFrameInput.moveBackward ||
      rawFrameInput.moveLeft ||
      rawFrameInput.moveRight
    );

    if (localPlayer.role === 'observer') {
      useGameStore.getState().setInteractionPrompt(null);
      devTestingInteractHeldRef.current = frameInput.interact;
      runObserverLifecycleFrame(frameCtx, localPlayer, timing, frameInput);
      return;
    }

    const storeSnapshot = useGameStore.getState();
    const localDropPlayer = findBattleRoyalDropPlayer(storeSnapshot.battleRoyalDrop, localPlayer.id);
    if (storeSnapshot.gameplayMode === 'battle_royal' && localDropPlayer?.status === 'landed') {
      syncBattleRoyalDeploymentAudio(frameCtx.refs.battleRoyalDeploymentAudioRef.current, localDropPlayer);
    }
    if (storeSnapshot.gameplayMode === 'battle_royal' && localDropPlayer?.status === 'landed' && localPlayer.state === 'dropping') {
      if (storeSnapshot.matchPerspective === 'first_person') {
        const didBeginDropCamera = beginBattleRoyalFirstPersonDropCamera({
          runtime: frameCtx.refs.battleRoyalFirstPersonDropCameraRef.current,
          camera,
          playerId: localPlayer.id,
          droppedAt: localDropPlayer.droppedAt ?? localDropPlayer.landedAt,
          nowMs: now,
        });
        if (didBeginDropCamera) {
          setBattleRoyalFirstPersonDropBodyVisibleUntil(
            now + BATTLE_ROYAL_FIRST_PERSON_DROP_BODY_VISIBLE_MS
          );
        }
      }

      const landedMovement: PlayerMovementState = {
        ...localPlayer.movement,
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
        isGliding: false,
      };
      const landedUpdates: Partial<Player> = {
        state: 'alive',
        position: { ...localDropPlayer.position },
        velocity: { ...localDropPlayer.velocity },
        movement: landedMovement,
      };
      confirmLocalMovementTransform(localPlayer, {
        position: landedUpdates.position,
        velocity: landedUpdates.velocity,
        movement: landedMovement,
      }, cameraControl.refs.yaw.current);
      updateLocalPlayer(landedUpdates);
      setLocalPlayerVisualTransformFromCamera(localPlayer.id, localDropPlayer.position, cameraControl);
      resetMovementCommandBuffer();
      frameCtx.refs.suppressJumpUntilReleaseRef.current = rawFrameInput.jump;
      localPlayer = { ...localPlayer, ...landedUpdates };
    }
    frameInput = suppressJumpInputUntilReleased(frameInput, frameCtx.refs.suppressJumpUntilReleaseRef);
    if (runDevTestingInteractionFrame(localPlayer, frameInput, devTestingInteractHeldRef)) {
      return;
    }
    const isLocalStillDeploying = localDropPlayer
      ? localDropPlayer.status !== 'landed'
      : localPlayer.state === 'dropping';
    const hasActiveLocalDropSnapshot = Boolean(localDropPlayer && localDropPlayer.status !== 'landed');
    const shouldUseBattleRoyalDeploymentCamera = (
      storeSnapshot.gameplayMode === 'battle_royal' &&
      Boolean(storeSnapshot.battleRoyalDrop) &&
      !hasLocalDeathVisual &&
      (
        (gamePhase === 'countdown' && (localPlayer.state === 'spawning' || hasActiveLocalDropSnapshot)) ||
        (gamePhase === 'deployment' && (hasActiveLocalDropSnapshot || (localPlayer.state === 'dropping' && isLocalStillDeploying)))
      )
    );
    if (shouldUseBattleRoyalDeploymentCamera) {
      runBattleRoyalDeploymentFrame(
        frameCtx,
        localPlayer,
        timing,
        frameInput,
        authority.authorityApplied,
        gamePhase === 'deployment'
      );
      return;
    }
    const deploymentAudioStatus = frameCtx.refs.battleRoyalDeploymentAudioRef.current.status;
    if (deploymentAudioStatus === 'aboard' || deploymentAudioStatus === 'dropping') {
      resetBattleRoyalDeploymentAudio(frameCtx.refs.battleRoyalDeploymentAudioRef.current);
    }

    const canRunLocalGameplayFrame = (
      isPlaying &&
      (localPlayer.state === 'alive' || localPlayer.state === 'downed') &&
      !hasLocalDeathVisual
    );
    if (!canRunLocalGameplayFrame) {
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
    const runtimeAbilityBindings = resolveRuntimeHeroAbilityBindings(heroId, heroAbilityBindings);
    rawFrameInput = applyHeroAbilityBindings(rawFrameInput, heroId, heroAbilityBindings);
    frameInput = applyHeroAbilityBindings(frameInput, heroId, heroAbilityBindings);
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

    const consumePracticeAbilityCharge = (abilityId: string): boolean => {
      if (!abilitySystem.useAbilityCharge(abilityId)) return false;

      const currentPlayer = localPlayer ?? useGameStore.getState().localPlayer;
      if (!currentPlayer) return false;

      const nextAbilities = {
        ...currentPlayer.abilities,
        [abilityId]: buildPracticeChargedAbilityState(
          currentPlayer.abilities,
          abilityId,
          now,
          abilitySystem.clientChargesRef.current[abilityId],
          abilitySystem.clientCooldownsRef.current[abilityId]
        ),
      };

      updateLocalPlayer({ abilities: nextAbilities });
      localPlayer = { ...currentPlayer, abilities: nextAbilities };
      soundLocalPlayerRef.current = localPlayer;
      return true;
    };

    if (localPlayer.state === 'downed') {
      const downedFrameInput = suppressDownedMovementInput(frameInput, {
        frozen: Boolean(localPlayer.reviveByPlayerId),
      });
      const downedServerCombatInput = deriveDownedServerCombatInput(downedFrameInput);
      const downedHasMovementInput = (
        downedFrameInput.moveForward ||
        downedFrameInput.moveBackward ||
        downedFrameInput.moveLeft ||
        downedFrameInput.moveRight
      );
      setPhantomPrimaryHeld(false, now);
      setBlazeRocketHeld(false, now);
      setBlazeBombTargetHeld(false, now);
      resetBlazeFlamethrower(now);
      setChronosPrimaryHeld(false, now);
      setChronosLifelineQueuedState(false, now);
      setChronosAegisVisualState(
        localPlayer.id,
        false,
        now,
        0,
        { renderWorldEffect: storeSnapshot.matchPerspective === 'third_person' }
      );
      resetViewmodelPoseState('downed', heroId, now);
      if (storeSnapshot.bombTargeting) {
        frameCtx.setBombTargeting(false, false);
        blazeAbilities.bombTargetRef.current = null;
        blazeAbilities.bombValidRef.current = false;
      }

      const aimYaw = cameraControl.refs.yaw.current;
      const aimPitch = cameraControl.refs.pitch.current + cameraControl.refs.slidePitch.current;
      const thirdPersonAimPoint = resolveThirdPersonCrosshairAimPoint({
        bodyPosition: position,
        yaw: aimYaw,
        pitch: aimPitch,
        eyeHeight: EYE_HEIGHT + cameraControl.refs.crouchHeight.current,
        matchPerspective: storeSnapshot.matchPerspective,
      });
      const downedAbilityCtx: AbilityContext = {
        position,
        velocity,
        yaw: aimYaw,
        pitch: cameraControl.refs.pitch.current,
        heroId,
        localPlayer: {
          id: localPlayer.id,
          team: localPlayer.team,
          position: localPlayer.position,
          ultimateCharge: localPlayer.ultimateCharge,
        },
        inputState: downedFrameInput,
        dt,
        isGrounded: movement.refs.isGrounded.current,
        camera,
        viewmodelElapsedSeconds: frameState.clock.elapsedTime,
        viewmodelNowMs: now,
        aimPoint: thirdPersonAimPoint,
      };
      const predictionPhase = runPredictionAndCommandPhase({
        ctx: frameCtx,
        localPlayer,
        heroId,
        frameInput: downedFrameInput,
        serverCombatInput: downedServerCombatInput,
        requestedCommandScheduleReasons: [],
        abilityCtx: downedAbilityCtx,
        predictedState,
        now,
        dt,
        rawDelta: delta,
      });
      predictedState = predictionPhase.predictedState;
      const presentation = runPresentationPhase({
        ctx: frameCtx,
        localPlayer,
        heroId,
        heroStats,
        predictedState,
        abilityCtx: downedAbilityCtx,
        frameInput: downedFrameInput,
        hasMovementInput: downedHasMovementInput,
        speedMultiplier: 1,
        wasGroundedBeforePrediction: predictionPhase.wasGroundedBeforePrediction,
        now,
        frameNowMs,
        dt,
      });
      runTracePhase({
        ctx: frameCtx,
        localPlayer,
        heroId,
        heroDef: HERO_DEFINITIONS[heroId],
        frameInput: downedFrameInput,
        commandInput: predictionPhase.commandInput,
        localMovementForTrace: presentation.localMovementForTrace,
        isSliding: presentation.isSliding,
        wasSlidingBeforeFrame: presentation.wasSlidingBeforeFrame,
        speedMultiplier: 1,
        now,
        dt,
      });
      return;
    }

    let { speedMultiplier } = abilitySystem.updateActiveAbilities(dt);
    if (localPlayer.heroId === 'phantom' && localPlayer.abilities?.['phantom_veil']?.isActive) {
      speedMultiplier *= PHANTOM_VEIL_SPEED_MULTIPLIER;
    }
    if ((localPlayer.powerupBoostUntil ?? 0) > now) {
      speedMultiplier *= POWERUP_MOVEMENT_SPEED_MULTIPLIER;
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
      blazePrimaryReloading,
      blazePrimaryHeldForPose,
      chronosLifelineCommitMode,
      chronosLifelineCommitActive,
      chronosLifelineCommitPressed,
    } = inputPhase;
    frameInput = inputPhase.frameInput;

    const aimYaw = cameraControl.refs.yaw.current;
    const aimPitch = cameraControl.refs.pitch.current + cameraControl.refs.slidePitch.current;
    const thirdPersonAimPoint = resolveThirdPersonCrosshairAimPoint({
      bodyPosition: position,
      yaw: aimYaw,
      pitch: aimPitch,
      eyeHeight: EYE_HEIGHT + cameraControl.refs.crouchHeight.current,
      matchPerspective: storeSnapshot.matchPerspective,
    });
    const mobileAimAssistPoint = resolveMobileAimAssistAimPoint({
      isTouchInputActive: frameCtx.isTouchInputActive,
      inputState: localAbilityInput,
      heroId,
      localPlayer,
      storeSnapshot,
      bodyPosition: position,
      yaw: aimYaw,
      pitch: aimPitch,
      eyeHeight: EYE_HEIGHT + cameraControl.refs.crouchHeight.current,
      matchPerspective: storeSnapshot.matchPerspective,
      frameNowMs,
    });

    // Create ability context (reused mutable object; consumers read synchronously)
    let abilityCtx = abilityCtxRef.current;
    if (!abilityCtx) {
      abilityCtx = {} as AbilityContext;
      abilityCtx.localPlayer = { id: '', position: { x: 0, y: 0, z: 0 } };
      abilityCtxRef.current = abilityCtx;
    }
    abilityCtx.position = position;
    abilityCtx.velocity = velocity;
    abilityCtx.yaw = aimYaw;
    abilityCtx.pitch = cameraControl.refs.pitch.current;
    abilityCtx.heroId = heroId;
    abilityCtx.localPlayer.id = localPlayer.id;
    abilityCtx.localPlayer.team = localPlayer.team;
    abilityCtx.localPlayer.position = localPlayer.position;
    abilityCtx.localPlayer.ultimateCharge = localPlayer.ultimateCharge;
    abilityCtx.inputState = localAbilityInput;
    abilityCtx.dt = dt;
    abilityCtx.isGrounded = movement.refs.isGrounded.current;
    abilityCtx.camera = camera;
    abilityCtx.viewmodelElapsedSeconds = frameState.clock.elapsedTime;
    abilityCtx.viewmodelNowMs = now;
    abilityCtx.aimPoint = mobileAimAssistPoint ?? thirdPersonAimPoint;

    setPhantomPrimaryHeld(phantomPrimaryHeldForPose, now);
    setBlazeRocketHeld(
      blazePrimaryHeldForPose,
      now
    );
    setChronosPrimaryHeld(
      heroId === 'chronos' && frameInput.primaryFire && !chronosLifelineCommitActive && !chronosAbilities.chronosPrimaryReloadingRef.current,
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
      now,
      undefined,
      { renderWorldEffect: storeSnapshot.matchPerspective === 'third_person' }
    );
    if (heroDef) {
      soundLocalPlayerRef.current = localPlayer;
      const soundFrameArg = soundFrameArgRef.current
        ?? (soundFrameArgRef.current = {} as LocalAbilityAudioPredictionFrame);
      soundFrameArg.now = now;
      soundFrameArg.heroId = heroId;
      soundFrameArg.inputState = frameInput;
      soundFrameArg.ultimateCharge = localPlayer.ultimateCharge ?? 0;
      soundFrameArg.bombTargeting = bombTargetingForFrame;
      soundFrameArg.phantomPrimaryAmmo = phantomAbilities.phantomPrimaryAmmoRef.current;
      soundFrameArg.phantomPrimaryReloading = phantomPrimaryReloading;
      soundFrameArg.blazePrimaryAmmo = blazeAbilities.blazePrimaryAmmoRef.current;
      soundFrameArg.blazePrimaryReloading = blazePrimaryReloading;
      soundFrameArg.blazePrimarySkill = blazePrimarySkill;
      soundFrameArg.phantomPrimarySkill = phantomPrimarySkill;
      soundFrameArg.phantomSecondarySkill = phantomSecondarySkill;
      soundFrameArg.chronosPrimaryAmmo = chronosAbilities.chronosPrimaryAmmoRef.current;
      soundFrameArg.chronosPrimaryReloading = chronosAbilities.chronosPrimaryReloadingRef.current;
      soundFrameArg.canUseAbility = abilitySystem.canUseAbility;
      soundFrameArg.getAbilityCharges = getAbilityChargesForSound;
      soundFrameArg.canUseHookshotGrapple = canUseHookshotGrappleForSound;
      soundFrameArg.hasChronosLifelineTarget = hasChronosLifelineTarget;
      updatePredictedAbilitySounds(soundFrameArg);

      // Handle ability input
      const executeBlazeSlottedAbility = (abilityId: string) => {
        if (!abilitySystem.canUseAbility(abilityId, false)) return;

        if (abilityId === 'blaze_rocketjump') {
          blazeAbilities.executeRocketJump(abilityCtx);
          useGameStore.getState().recordSkillCast(now);
          if (isPracticeMode) {
            const startPosition = { x: position.x, y: position.y, z: position.z };
            const nextState = predictLocalBlazeRocketJump(localPlayer!, abilityCtx.yaw);
            applyPracticePredictedState(nextState);
            triggerRocketJumpExplosion(startPosition);
            abilitySystem.startClientCooldown(abilityId);
          }
          return;
        }

        if (abilityId === 'blaze_afterburner') {
          blazeAbilities.executeAfterburner(abilityCtx);
          useGameStore.getState().recordSkillCast(now);
          if (isPracticeMode) {
            const nextState = predictLocalBlazeAfterburner(localPlayer!, abilityCtx.yaw);
            applyPracticePredictedState(nextState);
            abilitySystem.startClientCooldown(abilityId);
          }
        }
      };

      const executePhantomSlottedAbility = (abilityId: string) => {
        if (!abilitySystem.canUseAbility(abilityId, false)) return;
        const phantomLocalPlayer = localPlayer!;

        if (abilityId === 'phantom_umbral_decoy') {
          if (isPracticeMode) {
            const direction = calculateLookDirection(abilityCtx.yaw, 0);
            abilitySystem.startClientCooldown(abilityId);
            abilitySystem.setAbilityActive(abilityId, true, { startTime: now });
            updateLocalPlayer({
              abilities: {
                ...phantomLocalPlayer.abilities,
                [abilityId]: buildPracticeAbilityState(phantomLocalPlayer.abilities, abilityId, now, true),
              },
            });
            addUmbralDecoyEffect({
              position: { x: position.x, y: position.y, z: position.z },
              direction,
              durationMs: PHANTOM_UMBRAL_DECOY_DURATION_SECONDS * 1000,
              ownerTeam: phantomLocalPlayer.team,
              ownerSkinId: phantomLocalPlayer.skinId,
              ownerIsBot: phantomLocalPlayer.isBot,
              castId: `practice_phantom_umbral_decoy_${phantomLocalPlayer.id}_${now}`,
            });
          }
          useGameStore.getState().recordSkillCast(now);
          lockHeroActions(heroId, PHANTOM_PRIMARY_RETURN_TO_IDLE_MS, now);
          return;
        }

        if (abilityId === 'phantom_blink') {
          if (isPracticeMode) {
            const startPosition = { x: position.x, y: position.y, z: position.z };
            if (!consumePracticeAbilityCharge(abilityId)) return;
            const nextState = predictLocalPhantomBlink(phantomLocalPlayer, abilityCtx.yaw, abilityCtx.pitch);
            applyPracticePredictedState(nextState);
            triggerBlinkEffect(startPosition, nextState.position);
            triggerTeleportEffect('blink');
            useGameStore.getState().addVoidZone({
              id: `practice_void_${phantomLocalPlayer.id}_${now}`,
              position: {
                x: nextState.position.x,
                y: nextState.position.y - 0.9,
                z: nextState.position.z,
              },
              radius: PHANTOM_VOID_ZONE_RADIUS,
              duration: PHANTOM_VOID_ZONE_DURATION_SECONDS,
              startTime: now,
              ownerId: phantomLocalPlayer.id,
              ownerTeam: phantomLocalPlayer.team,
            });
          } else if (!phantomAbilities.executeBlink(abilityCtx, playerSounds, abilitySystem.useAbilityCharge)) {
            return;
          }
          useGameStore.getState().recordSkillCast(now);
          lockHeroActions(heroId, PHANTOM_PRIMARY_RETURN_TO_IDLE_MS, now);
          return;
        }

        if (abilityId !== 'phantom_personal_shield') return;
        const playLocalShieldCast = () => {
          markPredictedLocalAbilitySound(abilityId, now, 1600);
          triggerPhantomShieldCastEffect({
            playerId: abilityCtx.localPlayer.id,
            isLocalPlayer: true,
            position: { x: position.x, y: position.y, z: position.z },
            yaw: abilityCtx.yaw,
          });
        };
        if (isPracticeMode) {
          abilitySystem.setAbilityActive(abilityId, true, { startTime: now, startCooldownOnEnd: true });
          updateLocalPlayer({
            abilities: {
              ...phantomLocalPlayer.abilities,
              [abilityId]: buildPracticeAbilityState(phantomLocalPlayer.abilities, abilityId, now, true),
            },
          });
        } else if (!phantomAbilities.executePersonalShield(
          abilityCtx,
          playerSounds,
          abilitySystem.setAbilityActive,
          abilitySystem.startClientCooldown,
          updateLocalPlayer
        )) {
          return;
        }
        useGameStore.getState().recordSkillCast(now);
        playLocalShieldCast();
        lockHeroActions(heroId, PHANTOM_PRIMARY_RETURN_TO_IDLE_MS, now);
      };

      if (
        heroId === 'blaze' &&
        localAbilityInput.ability1 &&
        !abilitySystem.abilityPressedRef.current.ability1
      ) {
        executeBlazeSlottedAbility(runtimeAbilityBindings.ability1);
      }

      if (
        heroId === 'phantom' &&
        localAbilityInput.ability1 &&
        !abilitySystem.abilityPressedRef.current.ability1
      ) {
        executePhantomSlottedAbility(runtimeAbilityBindings.ability1);
      }

      if (heroId !== 'blaze' && heroId !== 'phantom') {
        const ability1Id = heroDef.ability1.abilityId;
        const chronosQueuePressed = heroId === 'chronos' &&
          rawFrameInput.ability1 &&
          !abilitySystem.abilityPressedRef.current.ability1;

        if (heroId === 'chronos') {
          if (chronosQueuePressed) {
            if (chronosLifelineQueuedRef.current) {
              setChronosLifelineQueuedState(false, now);
            } else if (abilitySystem.canUseAbility(ability1Id, false)) {
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
                if (targets.length > 0 && consumePracticeAbilityCharge(ability1Id)) {
                  useGameStore.getState().recordSkillCast(now);
                  if (chronosAbilities.executeLifelineConduit(abilityCtx)) {
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
              } else if (chronosAbilities.executeLifelineConduit(abilityCtx)) {
                useGameStore.getState().recordSkillCast(now);
                lockHeroActions(heroId, CHRONOS_LIFELINE_POSE_DURATION_MS, now);
                setChronosLifelineQueuedState(false, now);
              }
            }
          }
        } else if (frameInput.ability1 && !abilitySystem.abilityPressedRef.current.ability1) {
          if (abilitySystem.canUseAbility(ability1Id, false)) {
            if (heroId === 'hookshot') {
              if (hookshotAbilities.executeGrapple(abilityCtx)) {
                useGameStore.getState().recordSkillCast(now);
                lockHeroActions(heroId, HOOKSHOT_SECONDARY_POSE_DURATION_MS, now);
                if (isPracticeMode) {
                  abilitySystem.startClientCooldown(ability1Id);
                }
              }
            }
          }
        }
        abilitySystem.abilityPressedRef.current.ability1 = heroId === 'chronos'
          ? rawFrameInput.ability1
          : frameInput.ability1;
      } else {
        abilitySystem.abilityPressedRef.current.ability1 = localAbilityInput.ability1;
      }

      // Ability 2 (Q)
      if (localAbilityInput.ability2 && !abilitySystem.abilityPressedRef.current.ability2) {
        const ability2Id = heroId === 'blaze' || heroId === 'phantom'
          ? runtimeAbilityBindings.ability2
          : heroDef.ability2.abilityId;
        if (abilitySystem.canUseAbility(ability2Id, false)) {
          if (heroId === 'phantom') {
            executePhantomSlottedAbility(ability2Id);
          } else if (heroId === 'blaze') {
            executeBlazeSlottedAbility(ability2Id);
          } else if (heroId === 'hookshot') {
            if (hookshotAbilities.executeEarthWall(abilityCtx)) {
              useGameStore.getState().recordSkillCast(now);
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
              useGameStore.getState().recordSkillCast(now);
              lockHeroActions(heroId, CHRONOS_TIMEBREAK_POSE_DURATION_MS, now);
            }
            if (didCastTimebreak && isPracticeMode) {
              const forward = {
                x: -Math.sin(abilityCtx.yaw),
                y: 0,
                z: -Math.cos(abilityCtx.yaw),
              };
              const effectPosition = resolveChronosTimebreakPracticeOrigin(abilityCtx, now);
              if (!shouldSuppressPredictedLocalAbilitySound('chronos_timebreak', now)) {
                void playSharedSound('chronosTimebreakCharge', {
                  position: effectPosition,
                  durationMs: CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
                  fadeOutMs: CHRONOS_TIMEBREAK_CHARGE_FADE_OUT_MS,
                });
              }
              addChronosTimebreakEffect({
                position: effectPosition,
                ownerId: localPlayer.id,
                ownerTeam: localPlayer.team,
                direction: forward,
                startTime: now,
                releaseTime: now + CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
              });
              const shockwaveOrigin = { x: position.x, y: position.y, z: position.z };
              const shockwaveSourceId = localPlayer.id;
              const shockwaveSourceTeam = localPlayer.team;
              window.setTimeout(() => {
                applyTutorialOfflineTrainingTimebreakKnockback({
                  origin: shockwaveOrigin,
                  direction: forward,
                  sourceId: shockwaveSourceId,
                  sourceTeam: shockwaveSourceTeam,
                });
                void playSharedSound('chronosPush', {
                  position: effectPosition,
                  volume: 1.05,
                });
              }, CHRONOS_TIMEBREAK_RELEASE_DELAY_MS);
              abilitySystem.startClientCooldown(heroDef.ability2.abilityId);
            }
          }
        }
      }
      abilitySystem.abilityPressedRef.current.ability2 = localAbilityInput.ability2;

      // Ultimate (F)
      if (localAbilityInput.ultimate && !abilitySystem.abilityPressedRef.current.ultimate) {
        const ultimateAbilityId = resolveEquippedUltimateAbilityId(heroId);
        const isConfirmingPhoenixDive = (
          heroId === 'blaze' &&
          ultimateAbilityId === 'blaze_phoenix_dive' &&
          useGameStore.getState().phoenixDiveTargeting
        );
        if (isConfirmingPhoenixDive) {
          if (blazeAbilities.phoenixDiveValidRef.current && blazeAbilities.phoenixDiveTargetRef.current) {
            if (isPracticeMode) {
              confirmPracticeBlazePhoenixDive(
                practiceBlazePhoenixDiveRef,
                blazeAbilities.phoenixDiveTargetRef.current,
              );
            }
          }
        } else if (abilitySystem.canUseAbility(ultimateAbilityId, true)) {
          if (heroId === 'phantom') {
            if (isPracticeMode) {
              const abilityId = ultimateAbilityId;
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
              useGameStore.getState().recordSkillCast(now);
              lockHeroActions(heroId, PHANTOM_VEIL_CAST_POSE_DURATION_MS, now);
            } else if (phantomAbilities.executePhantomUltimate(ultimateAbilityId, abilityCtx)) {
              useGameStore.getState().recordSkillCast(now);
              lockHeroActions(heroId, PHANTOM_VEIL_CAST_POSE_DURATION_MS, now);
            }
          } else if (heroId === 'blaze') {
            const abilityId = ultimateAbilityId;
            blazeAbilities.lockActions(BLAZE_STAFF_RETURN_TO_IDLE_MS, now);
            useGameStore.getState().recordSkillCast(now);
            if (isPracticeMode) {
              resetBlazeFlamethrower(now);
              if (abilityId === 'blaze_phoenix_dive') {
                blazeAbilities.phoenixDiveTargetRef.current = null;
                blazeAbilities.phoenixDiveValidRef.current = false;
                const launchState = startPracticeBlazePhoenixDive(
                  localPlayer,
                  abilityCtx.yaw,
                  now,
                  practiceBlazePhoenixDiveRef,
                  resolvePracticeBlazePhoenixDiveTarget(abilityCtx),
                  blazeAbilities.phoenixDiveTargetRef,
                );
                predictedState = launchState;
                position.set(launchState.position.x, launchState.position.y, launchState.position.z);
                velocity.set(launchState.velocity.x, launchState.velocity.y, launchState.velocity.z);
                movement.refs.isGrounded.current = false;
                movement.refs.wasGrounded.current = false;
                movement.refs.canJump.current = false;
              } else {
                const abilityDef = ABILITY_DEFINITIONS[abilityId];
                const durationMs = (abilityDef?.duration ?? 0) * 1000;
                const effectEndTime = now + durationMs;
                const effectPosition = { x: position.x, y: position.y, z: position.z };
                triggerAirStrike(effectPosition, { ownerId: localPlayer.id, ownerTeam: localPlayer.team });
                abilitySystem.setAbilityActive(abilityId, true, { startTime: now, startCooldownOnEnd: true });
                useGameStore.getState().setUltimateEffect(true, abilityId, effectEndTime);
                if (!shouldSuppressPredictedLocalAbilitySound(abilityId, now)) {
                  void playSharedBlazeAirstrikeSound({ position: effectPosition });
                }
              }
              updateLocalPlayer({
                ultimateCharge: 0,
                abilities: {
                  ...localPlayer.abilities,
                  [abilityId]: buildPracticeAbilityState(
                    localPlayer.abilities,
                    abilityId,
                    now,
                    abilityId === 'blaze_airstrike',
                  ),
                },
              });
            } else if (abilityId === 'blaze_phoenix_dive') {
              blazeAbilities.phoenixDiveTargetRef.current = null;
              blazeAbilities.phoenixDiveValidRef.current = false;
              useGameStore.getState().setPhoenixDiveTargeting(true, false);
            }
          } else if (heroId === 'hookshot') {
            if (hookshotAbilities.executeGroundHooks(abilityCtx, updateLocalPlayer)) {
              useGameStore.getState().recordSkillCast(now);
              lockHeroActions(heroId, HOOKSHOT_SECONDARY_POSE_DURATION_MS, now);
            }
          } else if (heroId === 'chronos') {
            if (chronosAbilities.executeAscendantParadox(abilityCtx, abilitySystem.setAbilityActive)) {
              useGameStore.getState().recordSkillCast(now);
              lockHeroActions(heroId, CHRONOS_ASCENDANT_CAST_LOCK_MS, now);
              predictedState = getCurrentPredictedState(predictedState);
              position.set(predictedState.position.x, predictedState.position.y, predictedState.position.z);
              velocity.set(predictedState.velocity.x, predictedState.velocity.y, predictedState.velocity.z);
            }
          }
        }
      }
      abilitySystem.abilityPressedRef.current.ultimate = localAbilityInput.ultimate;

      // Hero-specific primary/secondary fire and hold abilities
      if (heroId === 'phantom') {
        const riftBoltTeleportTarget = phantomAbilities.handleSecondaryFire(abilityCtx, playerSounds);
        if (riftBoltTeleportTarget && isPracticeMode) {
          const startPosition = { x: position.x, y: position.y, z: position.z };
          const nextState = predictLocalRiftBoltTeleport(localPlayer, riftBoltTeleportTarget);
          applyPracticePredictedState(nextState);
          triggerBlinkEffect(startPosition, nextState.position);
          triggerTeleportEffect('blink');
        }
      }

      if (heroId === 'blaze') {
        blazeAbilities.firePrimary(abilityCtx);
        blazeAbilities.handleSecondaryFire(abilityCtx, playerSounds);
        blazeAbilities.handleFlamethrower(
          abilityCtx,
          playerSounds,
          isHeroAbilityInputActive(
            localAbilityInput,
            'blaze',
            heroAbilityBindings,
            'blaze_flamethrower'
          ),
          setFlamethrowerActive,
          setFlamethrowerFuel
        );
      }

      if (heroId === 'hookshot') {
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
      confirmTransformScratch.position.x = position.x;
      confirmTransformScratch.position.y = position.y;
      confirmTransformScratch.position.z = position.z;
      confirmTransformScratch.velocity.x = velocity.x;
      confirmTransformScratch.velocity.y = velocity.y;
      confirmTransformScratch.velocity.z = velocity.z;
      confirmTransformScratch.movement.isGrappling =
        hookshotAbilities.isGrapplingRef.current || hookshotAbilities.isSwingingRef.current;
      confirmTransformScratch.movement.grapplePoint = hookshotAbilities.grappleTargetRef.current;
      predictedState = confirmLocalMovementTransform(
        localPlayer,
        confirmTransformScratch,
        cameraControl.refs.yaw.current
      );
    }

    const predictionOptions = predictionOptionsRef.current
      ?? (predictionOptionsRef.current = {} as Parameters<typeof runPredictionAndCommandPhase>[0]);
    predictionOptions.ctx = frameCtx;
    predictionOptions.localPlayer = localPlayer;
    predictionOptions.heroId = heroId;
    predictionOptions.frameInput = frameInput;
    predictionOptions.serverCombatInput = serverCombatInput;
    predictionOptions.requestedCommandScheduleReasons = requestedCommandScheduleReasons;
    predictionOptions.abilityCtx = abilityCtx;
    predictionOptions.predictedState = predictedState;
    predictionOptions.now = now;
    predictionOptions.dt = dt;
    predictionOptions.rawDelta = delta;
    const predictionPhase = runPredictionAndCommandPhase(predictionOptions);
    predictedState = predictionPhase.predictedState;
    const {
      wasGroundedBeforePrediction,
      commandInput,
    } = predictionPhase;

    if (heroId === 'hookshot') {
      position.set(predictedState.position.x, predictedState.position.y, predictedState.position.z);
      velocity.set(predictedState.velocity.x, predictedState.velocity.y, predictedState.velocity.z);
      // position/velocity already alias abilityCtx.position/velocity (set above);
      // only inputState/isGrounded differ for the grapple step. Mutating in place
      // is safe: updateGrapplePhysics reads ctx synchronously without retaining it,
      // and for hookshot abilityCtx is not read again this frame (presentation only
      // reads it on the phantom path).
      abilityCtx.inputState = commandInput;
      abilityCtx.isGrounded = predictedState.movement.isGrounded;
      hookshotAbilities.updateGrapplePhysics(abilityCtx);

      const nextGrappleActive = hookshotAbilities.isGrapplingRef.current || hookshotAbilities.isSwingingRef.current;
      const nextGrapplePoint = hookshotAbilities.grappleTargetRef.current;
      const predictedGrapplePoint = predictedState.movement.grapplePoint;
      const grapplePointChanged = predictedGrapplePoint === null || nextGrapplePoint === null
        ? predictedGrapplePoint !== nextGrapplePoint
        : predictedGrapplePoint.x !== nextGrapplePoint.x ||
          predictedGrapplePoint.y !== nextGrapplePoint.y ||
          predictedGrapplePoint.z !== nextGrapplePoint.z;
      if (
        position.x !== predictedState.position.x ||
        position.y !== predictedState.position.y ||
        position.z !== predictedState.position.z ||
        velocity.x !== predictedState.velocity.x ||
        velocity.y !== predictedState.velocity.y ||
        velocity.z !== predictedState.velocity.z ||
        predictedState.movement.isGrappling !== nextGrappleActive ||
        grapplePointChanged
      ) {
        confirmTransformScratch.position.x = position.x;
        confirmTransformScratch.position.y = position.y;
        confirmTransformScratch.position.z = position.z;
        confirmTransformScratch.velocity.x = velocity.x;
        confirmTransformScratch.velocity.y = velocity.y;
        confirmTransformScratch.velocity.z = velocity.z;
        confirmTransformScratch.movement.isGrappling = nextGrappleActive;
        confirmTransformScratch.movement.grapplePoint = nextGrapplePoint;
        predictedState = confirmLocalMovementTransform(
          localPlayer,
          confirmTransformScratch,
          cameraControl.refs.yaw.current,
          CONFIRM_TRANSFORM_UPDATE_LATEST_OPTIONS
        );
      }
    }

    const presentationOptions = presentationOptionsRef.current
      ?? (presentationOptionsRef.current = {} as Parameters<typeof runPresentationPhase>[0]);
    presentationOptions.ctx = frameCtx;
    presentationOptions.localPlayer = localPlayer;
    presentationOptions.heroId = heroId;
    presentationOptions.heroStats = heroStats;
    presentationOptions.predictedState = predictedState;
    presentationOptions.abilityCtx = abilityCtx;
    presentationOptions.frameInput = frameInput;
    presentationOptions.hasMovementInput = hasMovementInput;
    presentationOptions.speedMultiplier = speedMultiplier;
    presentationOptions.wasGroundedBeforePrediction = wasGroundedBeforePrediction;
    presentationOptions.now = now;
    presentationOptions.frameNowMs = frameNowMs;
    presentationOptions.dt = dt;
    const presentation = runPresentationPhase(presentationOptions);

    const traceOptions = traceOptionsRef.current
      ?? (traceOptionsRef.current = {} as Parameters<typeof runTracePhase>[0]);
    traceOptions.ctx = frameCtx;
    traceOptions.localPlayer = localPlayer;
    traceOptions.heroId = heroId;
    traceOptions.heroDef = heroDef;
    traceOptions.frameInput = frameInput;
    traceOptions.commandInput = commandInput;
    traceOptions.localMovementForTrace = presentation.localMovementForTrace;
    traceOptions.isSliding = presentation.isSliding;
    traceOptions.wasSlidingBeforeFrame = presentation.wasSlidingBeforeFrame;
    traceOptions.speedMultiplier = speedMultiplier;
    traceOptions.now = now;
    traceOptions.dt = dt;
    runTracePhase(traceOptions);
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
        isActive={bombTargeting || phoenixDiveTargeting}
        maxRange={phoenixDiveTargeting ? BLAZE_PHOENIX_DIVE_MAX_RANGE : undefined}
        minRange={phoenixDiveTargeting ? 0 : undefined}
        radius={phoenixDiveTargeting ? BLAZE_PHOENIX_DIVE_RADIUS : undefined}
        raycastFeature={phoenixDiveTargeting ? 'targeting:blazePhoenixDive' : undefined}
        onTargetUpdate={phoenixDiveTargeting
          ? blazeAbilities.handlePhoenixDiveTargetUpdate
          : blazeAbilities.handleBombTargetUpdate}
      />
    </>
  );
}
