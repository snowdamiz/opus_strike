import type { Room } from 'colyseus.js';
import * as THREE from 'three';
import {
  ABILITY_DEFINITIONS,
  BLAZE_BOMB_SPLASH_RADIUS,
  CHRONOS_ASCENDANT_PARADOX_DURATION_MS,
  CHRONOS_LIFELINE_RELEASE_DELAY_MS,
  CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
  HOOKSHOT_GROUND_HOOKS_RADIUS,
  HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS,
  CHRONOS_VERDANT_PULSE_SPEED,
  VOID_RAY_CHARGE_TIME,
  createDefaultPlayerMovementState,
  DEFAULT_GAMEPLAY_MODE,
  DEFAULT_VOXEL_MAP_SIZE_ID,
  isGameplayMode,
  normalizeVoxelMapSizeId,
  type PublicRankSnapshot,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
import { useGameStore } from '../store/gameStore';
import { useCombatFeedbackStore } from '../store/combatFeedbackStore';
import { setGameTiming } from '../store/gameTimingStore';
import {
  addDeathVisual,
  clearAllDeathVisuals,
  clearDeathVisualsForPlayer,
  DEATH_VISUAL_LIFETIME_MS,
  updateDeathVisualExpirationForPlayer,
  pushLocalPlayerImpulse,
  addRemoteTransformSnapshot,
  pruneRemoteTransformHistories,
  removePlayerLiveVisualState,
  removePlayerVisualState,
  setChronosAegisVisualState,
  setPlayerVisualRotation,
  setPlayerVisualTransform,
  syncPlayerVisualEffectIndexes,
  triggerRemotePlayerAttack,
  visualStore,
} from '../store/visualStore';
import { confirmLocalMovementTransform, enqueueSelfMovementAuthority, setLocalMovementRootedUntil } from '../movement/localPrediction';
import {
  measureFrameWork,
  recordAuthorityAckReceived,
  recordLocalReactiveUpdate,
  recordTransformMessage,
} from '../movement/networkDiagnostics';
import { recordMovementTraceAuthorityAck } from '../anticheat/movementTraceRecorder';
import { addEffect } from '../components/game/Effects';
import { triggerAirStrike, triggerRocketJumpExplosion } from '../components/game/BlazeEffects';
import { triggerBlinkEffect } from '../components/game/PhantomEffects';
import { triggerPhantomShieldBreakEffect, triggerPhantomShieldCastEffect } from '../components/game/phantom';
import {
  startObservedAbilityCastEffect,
  stopObservedAbilityCastEffects,
} from '../components/game/ObservedAbilityCastEffects';
import { triggerTeleportEffect } from '../components/ui/TeleportEffects';
import { addChronosLifelineEffects, addChronosSelfHealPulseEffect } from '../components/game/chronos/lifeline';
import { addChronosTimebreakEffect } from '../components/game/chronos/timebreak';
import { triggerBlazeRocketJumpStaffSlam } from '../viewmodel/blazePose';
import {
  triggerChronosAscendantParadoxPose,
  triggerChronosLifelineConduitPose,
  triggerChronosPrimaryShotGlow,
  triggerChronosTimebreakPose,
} from '../viewmodel/chronosPose';
import { resolveAbilitySocketOrigin } from '../model-system/abilitySocketResolver';
import {
  chronosOrbForwardFromYaw,
  offsetChronosOrbVisualPlainPosition,
  type Vec3Like,
} from '../model-system/chronosOrbVisualOrigin';
import {
  DRAG_HOOK_SPEED,
  BLAZE_BOMB_FALL_DURATION,
  BLAZE_ROCKET_SPEED,
  HOOKSHOT_MAX_DISTANCE,
  HOOKSHOT_SPEED,
  PHANTOM_PROJECTILE_SPEED,
} from '../hooks/player/constants';
import { shouldSuppressPredictedLocalAbilitySound } from '../hooks/player/useLocalAbilityAudioPrediction';
import { consumePredictedLocalAbilityVisual } from '../hooks/player/useLocalAbilityVisualPrediction';
import {
  BLAZE_BOMB_RELEASE_SOUND_DURATION_MS,
  BLAZE_BOMB_RELEASE_SOUND_FADE_OUT_MS,
  BLAZE_BOMB_RELEASE_SOUND_START_OFFSET_MS,
  CHRONOS_VERDANT_PULSE_SHOT_PITCH,
  CHRONOS_VERDANT_PULSE_SHOT_VOLUME,
  playSharedBlazeAirstrikeSound,
  playSharedSound,
  type SoundName,
} from '../hooks/useAudio';
import { loggers } from '../utils/logger';
import { prepareVoxelMapCpu } from '../utils/mapWarmup/mapPrepCache';
import { prebuildPreparedVoxelMapGeometry } from '../utils/mapWarmup/mapGeometryWarmup';
import type {
  BotDifficulty,
  ChronosAegisDamagedEvent,
  ChronosAegisBrokenEvent,
  PhantomShieldBrokenEvent,
  HeroId,
  MatchSnapshotMessage,
  PlayerDeathEvent,
  Player,
  PlayerInterestMessage,
  PlayerVitalsAbilitySnapshot,
  PlayerVisibilityState,
  PlayerMovementState,
  PlayerTransformsV2Message,
  PlayerVitalsMessage,
  PlayerVitalsSnapshot,
  PackedPlayerTransform,
  PowerupCollectedMessage,
  PowerupStateMessage,
  SelfMovementAuthority,
  Team,
} from '@voxel-strike/shared';

const TRANSFORM_POSITION_SCALE = 100;
const TRANSFORM_VELOCITY_SCALE = 100;
const TRANSFORM_ANGLE_SCALE = 10000;
const CHRONOS_TIMEBREAK_CHARGE_FADE_OUT_MS = 110;
const MOVEMENT_BIT_GROUNDED = 1 << 0;
const MOVEMENT_BIT_SPRINTING = 1 << 1;
const MOVEMENT_BIT_CROUCHING = 1 << 2;
const MOVEMENT_BIT_SLIDING = 1 << 3;
const MOVEMENT_BIT_WALL_RUNNING = 1 << 4;
const MOVEMENT_BIT_GRAPPLING = 1 << 5;
const MOVEMENT_BIT_JETPACKING = 1 << 6;
const MOVEMENT_BIT_GLIDING = 1 << 7;
const MOVEMENT_BIT_CHRONOS_AEGIS = 1 << 8;
const remotePhantomChargeControllers = new Map<string, AbortController>();
const playerIdByNetId = new Map<number, string>();
const netIdByPlayerId = new Map<string, number>();
let lastLocalPhantomReloadSoundKey = '';
let hasReceivedSelfMovementAuthority = false;
const HOOKSHOT_SHOT_CLIP_MS = 250;

function measureNetworkMessage<T>(type: string, handler: (data: T) => void): (data: T) => void {
  return (data) => {
    measureFrameWork(`network.${type}`, () => handler(data));
  };
}

interface UnpackedPlayerTransform {
  netId: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  movementBits: number;
  wallRunSide: -1 | 0 | 1;
  movementEpoch: number;
  chronosAegisShieldRatio: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Creates a default movement state object for a player
 */
export function createDefaultMovement() {
  return createDefaultPlayerMovementState();
}

function normalizeMovementState(
  movement: any,
  fallback?: PlayerMovementState
): PlayerMovementState {
  const base: PlayerMovementState = fallback
    ? {
        ...fallback,
        grapplePoint: fallback.grapplePoint ? { ...fallback.grapplePoint } : null,
      }
    : createDefaultMovement();
  const wallRunSide = movement?.wallRunSide === 'left' || movement?.wallRunSide === 'right'
    ? movement.wallRunSide
    : base.wallRunSide;

  return {
    ...base,
    isGrounded: movement?.isGrounded ?? base.isGrounded,
    isSprinting: movement?.isSprinting ?? base.isSprinting,
    isCrouching: movement?.isCrouching ?? base.isCrouching,
    isSliding: movement?.isSliding ?? base.isSliding,
    slideTimeRemaining: movement?.slideTimeRemaining ?? base.slideTimeRemaining,
    isWallRunning: movement?.isWallRunning ?? base.isWallRunning,
    wallRunSide,
    isGrappling: movement?.isGrappling ?? base.isGrappling,
    grapplePoint: movement?.grapplePoint
      ? {
          x: movement.grapplePoint.x ?? 0,
          y: movement.grapplePoint.y ?? 0,
          z: movement.grapplePoint.z ?? 0,
        }
      : base.grapplePoint,
    isJetpacking: movement?.isJetpacking ?? base.isJetpacking,
    jetpackFuel: movement?.jetpackFuel ?? base.jetpackFuel,
    isGliding: movement?.isGliding ?? base.isGliding,
    chronosAscendantStartY: Number.isFinite(movement?.chronosAscendantStartY)
      ? movement.chronosAscendantStartY
      : base.chronosAscendantStartY,
  };
}

/**
 * Creates a default stats object for a player
 */
export function createDefaultStats() {
  return {
    kills: 0,
    deaths: 0,
    assists: 0,
    flagCaptures: 0,
    flagReturns: 0,
  };
}

function normalizeRankSnapshot(source: any, fallback?: PublicRankSnapshot): PublicRankSnapshot | undefined {
  if (source?.rank) return source.rank as PublicRankSnapshot;
  if (!source?.rankLabel && !source?.rankTier) return fallback;

  return {
    tier: source.rankTier || 'unranked',
    tierLabel: source.rankTierLabel || 'Unranked',
    division: typeof source.rankDivision === 'number' && source.rankDivision > 0 ? source.rankDivision : null,
    divisionIndex: typeof source.rankDivisionIndex === 'number' && source.rankDivisionIndex >= 0 ? source.rankDivisionIndex : null,
    label: source.rankLabel || 'Unranked',
    iconKey: source.rankIconKey || 'unranked',
    isRanked: source.rankIsRanked === true,
    placementRemaining: typeof source.rankPlacementRemaining === 'number' ? source.rankPlacementRemaining : 0,
  };
}

/**
 * Creates a Player object from server schema data
 */
export function createPlayerFromSchema(schemaPlayer: any, id: string): Player {
  return {
    id,
    name: schemaPlayer.name || 'Unknown',
    team: (schemaPlayer.team || 'red') as Team,
    heroId: (schemaPlayer.heroId || null) as HeroId | null,
    state: (schemaPlayer.state || 'alive') as any,
    isReady: schemaPlayer.isReady || false,
    isBot: Boolean(schemaPlayer.isBot),
    botDifficulty: schemaPlayer.botDifficulty || undefined,
    botProfileId: schemaPlayer.botProfileId || undefined,
    rank: normalizeRankSnapshot(schemaPlayer),
    position: { x: 0, y: 1, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    lookYaw: 0,
    lookPitch: 0,
    health: 100,
    maxHealth: 100,
    ultimateCharge: 0,
    onFireUntil: null,
    movement: createDefaultMovement(),
    abilities: {},
    hasFlag: false,
    respawnTime: null,
    spawnProtectionUntil: null,
    stats: createDefaultStats(),
    visibility: 'hidden',
  };
}

/**
 * Creates a default local player object
 */
export function createDefaultLocalPlayer(sessionId: string, playerName: string): Player {
  return {
    id: sessionId,
    name: playerName,
    team: 'red',
    heroId: null,
    state: 'alive',
    isReady: false,
    isBot: false,
    position: { x: 0, y: 1, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    lookYaw: 0,
    lookPitch: 0,
    health: 100,
    maxHealth: 100,
    ultimateCharge: 0,
    onFireUntil: null,
    movement: createDefaultMovement(),
    abilities: {},
    hasFlag: false,
    respawnTime: null,
    spawnProtectionUntil: null,
    stats: createDefaultStats(),
    visibility: 'visible',
  };
}

function shouldSyncLocalPosition(localPlayer: Player, nextState: string, nextPosition: { x: number; y: number; z: number }): boolean {
  const visualPosition = visualStore.getState().playerPositions.get(localPlayer.id);

  if (!visualPosition) return true;
  if (nextState !== 'alive') return true;
  if (localPlayer.state !== nextState && ['dead', 'spawning', 'selecting'].includes(localPlayer.state)) return true;

  const isDefaultLocalPosition =
    localPlayer.position.x === 0 &&
    localPlayer.position.y === 1 &&
    localPlayer.position.z === 0;
  if (isDefaultLocalPosition) return true;

  const dx = visualPosition.x - nextPosition.x;
  const dy = visualPosition.y - nextPosition.y;
  const dz = visualPosition.z - nextPosition.z;
  return dx * dx + dy * dy + dz * dz > 400;
}

function syncLocalVisualPosition(player: Player): void {
  setPlayerVisualTransform(player.id, player.position, player.lookYaw);
}

function shouldHideLiveVisuals(visibility?: PlayerVisibilityState): boolean {
  return visibility === 'hidden' || visibility === 'last_known' || visibility === 'audible';
}

function clearHiddenLiveVisuals(playerId: string): void {
  stopRemotePhantomCharge(playerId);
  stopObservedAbilityCastEffects(playerId);
  removePlayerLiveVisualState(playerId);
}

function setStoredPlayerVisibility(playerId: string, visibility: PlayerVisibilityState): Player | null {
  const store = useGameStore.getState();
  const current = store.players.get(playerId);
  if (!current) return null;
  if (current.visibility === visibility) return current;

  const nextPlayer = { ...current, visibility };
  const nextPlayers = new Map(store.players);
  nextPlayers.set(playerId, nextPlayer);
  useGameStore.setState({
    players: nextPlayers,
    localPlayer: store.localPlayer?.id === playerId ? nextPlayer : store.localPlayer,
  });
  return nextPlayer;
}

function clonePlainVec3(source: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return {
    x: Number.isFinite(source.x) ? source.x : 0,
    y: Number.isFinite(source.y) ? source.y : 0,
    z: Number.isFinite(source.z) ? source.z : 0,
  };
}

function normalizePlainVec3(
  source: { x: number; y: number; z: number } | null | undefined
): { x: number; y: number; z: number } | null {
  if (!source) return null;

  const length = Math.sqrt(source.x * source.x + source.y * source.y + source.z * source.z);
  if (!Number.isFinite(length) || length <= 0.0001) return null;

  return {
    x: source.x / length,
    y: source.y / length,
    z: source.z / length,
  };
}

function getPlayerSnapshotPosition(player: Player): { x: number; y: number; z: number } {
  const visualPosition = visualStore.getState().playerPositions.get(player.id);
  return clonePlainVec3(visualPosition ?? player.position);
}

function getKillerSourceDirection(
  victimPosition: { x: number; y: number; z: number },
  victim: Player,
  killerId: string | null,
  event: Partial<PlayerDeathEvent>,
  players: Map<string, Player>
): { x: number; y: number; z: number } | null {
  const explicitDirection = normalizePlainVec3(event.sourceDirection);
  if (explicitDirection) return explicitDirection;

  const sourcePosition = event.sourcePosition ?? (killerId ? players.get(killerId)?.position : null);
  if (sourcePosition) {
    const visualSourcePosition = killerId
      ? visualStore.getState().playerPositions.get(killerId) ?? sourcePosition
      : sourcePosition;
    const fromSource = normalizePlainVec3({
      x: victimPosition.x - visualSourcePosition.x,
      y: victimPosition.y - visualSourcePosition.y,
      z: victimPosition.z - visualSourcePosition.z,
    });
    if (fromSource) return fromSource;
  }

  const velocityDirection = normalizePlainVec3(victim.velocity);
  if (velocityDirection) return velocityDirection;

  return normalizePlainVec3({
    x: Math.sin(victim.lookYaw),
    y: 0,
    z: Math.cos(victim.lookYaw),
  });
}

function addDeathVisualFromKillEvent(data: PlayerDeathEvent): void {
  const store = useGameStore.getState();
  const localPlayerId = store.localPlayer?.id ?? store.playerId;
  const victim = store.players.get(data.victimId) ?? (
    store.localPlayer?.id === data.victimId ? store.localPlayer : null
  );
  if (!victim) return;

  const startedAtMs = Number.isFinite(data.occurredAt) ? data.occurredAt! : Date.now();
  const position = data.position ? clonePlainVec3(data.position) : getPlayerSnapshotPosition(victim);
  const visualPosition = visualStore.getState().playerPositions.get(victim.id);
  const snapshotPosition = clonePlainVec3(visualPosition ?? position);
  const velocity = data.velocity ? clonePlainVec3(data.velocity) : clonePlainVec3(victim.velocity);
  const lookYaw = visualStore.getState().playerRotations.get(victim.id) ?? victim.lookYaw;
  const killerId = data.killerId && data.killerId.length > 0 ? data.killerId : null;
  const sourceDirection = getKillerSourceDirection(snapshotPosition, victim, killerId, data, store.players);
  const expiresAtMs = Number.isFinite(data.respawnTime)
    ? data.respawnTime!
    : Number.isFinite(victim.respawnTime)
      ? victim.respawnTime!
      : startedAtMs + DEATH_VISUAL_LIFETIME_MS;

  addDeathVisual({
    id: `death:${victim.id}:${startedAtMs}`,
    playerId: victim.id,
    heroId: victim.heroId,
    team: victim.team,
    isBot: victim.isBot,
    name: victim.name,
    position: snapshotPosition,
    velocity,
    lookYaw,
    lookPitch: victim.lookPitch,
    movement: normalizeMovementState(victim.movement),
    killerId,
    sourceDirection,
    startedAtMs,
    expiresAtMs,
    local: victim.id === localPlayerId,
  });
}

function syncDeathVisualForVitals(
  playerId: string,
  nextState: Player['state'],
  previousHeroId: HeroId | null,
  nextHeroId: HeroId | null,
  respawnTime: number | null
): void {
  if (nextState !== 'dead' || previousHeroId !== nextHeroId) {
    clearDeathVisualsForPlayer(playerId);
    return;
  }

  updateDeathVisualExpirationForPlayer(playerId, respawnTime);
}

type MovementBitsTransform = Pick<UnpackedPlayerTransform, 'movementBits' | 'wallRunSide'>;

function dequantizeTransform(transform: Pick<UnpackedPlayerTransform, 'px' | 'py' | 'pz' | 'vx' | 'vy' | 'vz' | 'yaw' | 'pitch'>) {
  return {
    position: {
      x: transform.px / TRANSFORM_POSITION_SCALE,
      y: transform.py / TRANSFORM_POSITION_SCALE,
      z: transform.pz / TRANSFORM_POSITION_SCALE,
    },
    velocity: {
      x: transform.vx / TRANSFORM_VELOCITY_SCALE,
      y: transform.vy / TRANSFORM_VELOCITY_SCALE,
      z: transform.vz / TRANSFORM_VELOCITY_SCALE,
    },
    lookYaw: transform.yaw / TRANSFORM_ANGLE_SCALE,
    lookPitch: transform.pitch / TRANSFORM_ANGLE_SCALE,
  };
}

function movementFromBits(
  transform: MovementBitsTransform,
  fallback: PlayerMovementState
): PlayerMovementState {
  return {
    ...fallback,
    isGrounded: Boolean(transform.movementBits & MOVEMENT_BIT_GROUNDED),
    isSprinting: Boolean(transform.movementBits & MOVEMENT_BIT_SPRINTING),
    isCrouching: Boolean(transform.movementBits & MOVEMENT_BIT_CROUCHING),
    isSliding: Boolean(transform.movementBits & MOVEMENT_BIT_SLIDING),
    isWallRunning: Boolean(transform.movementBits & MOVEMENT_BIT_WALL_RUNNING),
    wallRunSide: transform.wallRunSide === -1 ? 'left' : transform.wallRunSide === 1 ? 'right' : null,
    isGrappling: Boolean(transform.movementBits & MOVEMENT_BIT_GRAPPLING),
    isJetpacking: Boolean(transform.movementBits & MOVEMENT_BIT_JETPACKING),
    isGliding: Boolean(transform.movementBits & MOVEMENT_BIT_GLIDING),
  };
}

function unpackPackedTransform(transform: PackedPlayerTransform): UnpackedPlayerTransform {
  return {
    netId: transform[0],
    px: transform[1],
    py: transform[2],
    pz: transform[3],
    vx: transform[4],
    vy: transform[5],
    vz: transform[6],
    yaw: transform[7],
    pitch: transform[8],
    movementBits: transform[9],
    wallRunSide: transform[10],
    movementEpoch: transform[11],
    chronosAegisShieldRatio: (transform[12] ?? 255) / 255,
  };
}

export function forgetPlayerNetId(playerId: string): void {
  const netId = netIdByPlayerId.get(playerId);
  if (netId !== undefined) {
    playerIdByNetId.delete(netId);
    netIdByPlayerId.delete(playerId);
  }
}

function rememberPlayerNetId(vitals: PlayerVitalsSnapshot): void {
  forgetPlayerNetId(vitals.id);
  playerIdByNetId.set(vitals.netId, vitals.id);
  netIdByPlayerId.set(vitals.id, vitals.netId);
}

type NetworkAbilityVitals = PlayerVitalsAbilitySnapshot & { cooldownRemaining?: number };
const COOLDOWN_AFTER_ACTIVE_ABILITY_IDS = new Set<string>([
  'phantom_personal_shield',
]);

function normalizeAbilityVitals(
  abilities: Record<string, NetworkAbilityVitals> | undefined,
  serverTime: number,
  fallback?: Player['abilities']
): Player['abilities'] {
  if (!abilities) return fallback || {};

  const normalized: Player['abilities'] = {};
  for (const [abilityId, ability] of Object.entries(abilities)) {
    const cooldownUntil = Number.isFinite(ability.cooldownUntil)
      ? ability.cooldownUntil
      : Number.isFinite(ability.cooldownRemaining)
        ? serverTime + Math.max(0, ability.cooldownRemaining || 0) * 1000
        : 0;
    const cooldownRemainingMs = Math.max(0, cooldownUntil - serverTime);
    normalized[abilityId] = {
      abilityId: ability.abilityId || abilityId,
      cooldownRemaining: cooldownRemainingMs / 1000,
      cooldownUntil: cooldownRemainingMs > 0 ? Date.now() + cooldownRemainingMs : 0,
      charges: ability.charges,
      isActive: ability.isActive,
      activatedAt: ability.activatedAt,
    };
  }

  return normalized;
}

function createPlayerFromVitals(vitals: PlayerVitalsSnapshot, serverTime: number, existing?: Player): Player {
  return {
    id: vitals.id,
    name: vitals.name || existing?.name || 'Unknown',
    team: vitals.team,
    heroId: vitals.heroId,
    state: vitals.state,
    isReady: vitals.isReady,
    isBot: Boolean(vitals.isBot),
    botDifficulty: vitals.botDifficulty || existing?.botDifficulty,
    botProfileId: vitals.botProfileId || existing?.botProfileId,
    rank: normalizeRankSnapshot(vitals, existing?.rank),
    position: existing?.position || { x: 0, y: 1, z: 0 },
    velocity: existing?.velocity || { x: 0, y: 0, z: 0 },
    lookYaw: existing?.lookYaw ?? 0,
    lookPitch: existing?.lookPitch ?? 0,
    health: vitals.health,
    maxHealth: vitals.maxHealth,
    ultimateCharge: vitals.ultimateCharge,
    onFireUntil: vitals.onFireUntil ?? null,
    powerupBoostUntil: vitals.powerupBoostUntil ?? null,
    movement: normalizeMovementState(vitals.movement, existing?.movement),
    abilities: normalizeAbilityVitals(vitals.abilities, serverTime, existing?.abilities),
    hasFlag: vitals.hasFlag,
    respawnTime: vitals.respawnTime,
    spawnProtectionUntil: vitals.spawnProtectionUntil,
    stats: vitals.stats || existing?.stats || createDefaultStats(),
    visibility: vitals.visibility ?? existing?.visibility ?? 'visible',
  };
}

function isDefaultBootstrapPosition(player: Player): boolean {
  return (
    player.position.x === 0 &&
    player.position.y === 1 &&
    player.position.z === 0
  );
}

function shouldPreservePredictionOwnedLocalSimulation(
  existing: Player | undefined,
  nextState: Player['state'],
  nextHeroId: Player['heroId']
): existing is Player {
  return Boolean(
    existing &&
    hasReceivedSelfMovementAuthority &&
    existing.state === 'alive' &&
    nextState === 'alive' &&
    existing.heroId === nextHeroId &&
    !isDefaultBootstrapPosition(existing)
  );
}

function createLocalPlayerFromVitals(vitals: PlayerVitalsSnapshot, serverTime: number, existing?: Player): Player {
  const next = createPlayerFromVitals(vitals, serverTime, existing);
  if (!shouldPreservePredictionOwnedLocalSimulation(existing, vitals.state, vitals.heroId)) {
    return next;
  }

  return {
    ...next,
    position: existing.position,
    velocity: existing.velocity,
    lookYaw: existing.lookYaw,
    lookPitch: existing.lookPitch,
    movement: existing.movement,
  };
}

function applyLocalVitalsPatchInPlace(player: Player, vitals: PlayerVitalsSnapshot, serverTime: number): void {
  player.name = vitals.name || player.name;
  player.team = vitals.team;
  player.heroId = vitals.heroId;
  player.state = vitals.state;
  player.isReady = vitals.isReady;
  player.isBot = Boolean(vitals.isBot);
  player.botDifficulty = vitals.botDifficulty || player.botDifficulty;
  player.botProfileId = vitals.botProfileId || player.botProfileId;
  player.rank = normalizeRankSnapshot(vitals, player.rank);
  player.health = vitals.health;
  player.maxHealth = vitals.maxHealth;
  player.ultimateCharge = vitals.ultimateCharge;
  player.onFireUntil = vitals.onFireUntil ?? null;
  player.powerupBoostUntil = vitals.powerupBoostUntil ?? null;
  player.abilities = normalizeAbilityVitals(vitals.abilities, serverTime, player.abilities);
  player.hasFlag = vitals.hasFlag;
  player.respawnTime = vitals.respawnTime;
  player.spawnProtectionUntil = vitals.spawnProtectionUntil;
  player.stats = vitals.stats || player.stats;
  player.visibility = vitals.visibility ?? player.visibility ?? 'visible';
}

// ============================================================================
// STORE ACTION TYPES
// ============================================================================

export interface GameStoreActions {
  setLocalPlayer: (player: Player) => void;
  updatePlayer: (playerId: string, player: Player) => void;
  removePlayer: (playerId: string) => void;
  setGamePhase: (phase: any) => void;
  setPhaseEndTime: (time: number | null) => void;
  setMapSeed: (seed: number) => void;
  setConnected: (connected: boolean) => void;
  setRoomId: (roomId: string | null) => void;
  setAppPhase: (phase: any) => void;
  resetLobby: () => void;
}

// ============================================================================
// PLAYER STATE SYNC HANDLERS
// ============================================================================

/**
 * Syncs a player from schema to store (for local and remote players)
 */
export function syncPlayerFromSchema(
  schemaPlayer: any,
  id: string,
  sessionId: string,
  localPlayerName: string,
  actions: Pick<GameStoreActions, 'setLocalPlayer' | 'updatePlayer'>
) {
  if (id === sessionId) {
    // Our own player - update local player with server data
    const store = useGameStore.getState();
    if (store.localPlayer) {
      const nextState = schemaPlayer.state || store.localPlayer.state;
      const nextHeroId = (schemaPlayer.heroId || store.localPlayer.heroId) as HeroId | null;
      const updated = {
        ...store.localPlayer,
        heroId: nextHeroId,
        team: schemaPlayer.team || store.localPlayer.team,
        isBot: Boolean(schemaPlayer.isBot ?? store.localPlayer.isBot),
        botDifficulty: schemaPlayer.botDifficulty || store.localPlayer.botDifficulty,
        botProfileId: schemaPlayer.botProfileId || store.localPlayer.botProfileId,
        rank: normalizeRankSnapshot(schemaPlayer, store.localPlayer.rank),
        state: nextState,
      };
      actions.setLocalPlayer(updated);
    }
  } else {
    // Skip ghost players: same name as us but different ID
    if (schemaPlayer.name === localPlayerName) {
      loggers.network.sample('schema-ghost', 5000, 'ignoring ghost schema player', schemaPlayer.name, id);
      return;
    }

    // Other player - add/update in store
    const playerData = createPlayerFromSchema(schemaPlayer, id);
    actions.updatePlayer(id, playerData);
  }
}

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

/**
 * Sets up the playerJoined message handler
 */
export function setupPlayerJoinedHandler(
  room: Room,
  sessionId: string,
  localPlayerName: string,
  updatePlayer: GameStoreActions['updatePlayer']
) {
  room.onMessage('playerJoined', measureNetworkMessage('playerJoined', (data: {
    playerId: string;
    playerName: string;
    team?: string;
    heroId?: string;
    isBot?: boolean;
    botDifficulty?: BotDifficulty;
    botProfileId?: string;
    rank?: PublicRankSnapshot;
    position?: { x: number; y: number; z: number };
  }) => {
    if (data.playerId !== sessionId) {
      // Skip ghost players
      if (data.playerName === localPlayerName) {
        loggers.network.sample('join-ghost', 5000, 'ignoring ghost join', data.playerName, data.playerId);
        return;
      }

      const currentStore = useGameStore.getState();
      const existingPlayer = currentStore.players.get(data.playerId);
      if (existingPlayer) {
        updatePlayer(data.playerId, {
          ...existingPlayer,
          name: data.playerName || existingPlayer.name,
          team: (data.team || existingPlayer.team) as Team,
          heroId: (data.heroId || existingPlayer.heroId) as HeroId | null,
          isBot: Boolean(data.isBot ?? existingPlayer.isBot),
          botDifficulty: data.botDifficulty || existingPlayer.botDifficulty,
          botProfileId: data.botProfileId || existingPlayer.botProfileId,
          rank: data.rank || existingPlayer.rank,
          position: data.position || existingPlayer.position,
          visibility: data.position ? 'visible' : existingPlayer.visibility ?? 'hidden',
        });
      } else {
        const newPlayer: Player = {
          id: data.playerId,
          name: data.playerName,
          team: (data.team || 'red') as Team,
          heroId: (data.heroId || null) as HeroId | null,
          state: 'selecting',
          isReady: false,
          isBot: Boolean(data.isBot),
          botDifficulty: data.botDifficulty,
          botProfileId: data.botProfileId,
          rank: data.rank,
          position: data.position || { x: 0, y: 1, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          lookYaw: 0,
          lookPitch: 0,
          health: 100,
          maxHealth: 100,
          ultimateCharge: 0,
          onFireUntil: null,
          movement: createDefaultMovement(),
          abilities: {},
          hasFlag: false,
          respawnTime: null,
          spawnProtectionUntil: null,
          stats: createDefaultStats(),
          visibility: data.position ? 'visible' : 'hidden',
        };
        updatePlayer(data.playerId, newPlayer);
      }
    }
  }));
}

export function setupPlayerTransformsHandler(
  room: Room,
  sessionId: string,
  localPlayerName: string,
  actions: Pick<GameStoreActions, 'setLocalPlayer'>
) {
  const handleTransform = (
    playerId: string,
    transform: UnpackedPlayerTransform,
    tick: number,
    serverTime: number,
    allowSelfBootstrap: boolean
  ): 'remote' | 'self' | 'ignored' => {
    const decoded = dequantizeTransform(transform);

    if (playerId === sessionId) {
      if (allowSelfBootstrap && !hasReceivedSelfMovementAuthority) {
        const localPlayer = useGameStore.getState().localPlayer;
        if (!localPlayer) return 'self';

        const nextMovement = movementFromBits(transform, localPlayer.movement);
        const shouldSyncPosition = shouldSyncLocalPosition(localPlayer, localPlayer.state, decoded.position);
        if (shouldSyncPosition) {
          const updated: Player = {
            ...localPlayer,
            position: decoded.position,
            velocity: decoded.velocity,
            lookYaw: decoded.lookYaw,
            lookPitch: decoded.lookPitch,
            movement: nextMovement,
          };
          actions.setLocalPlayer(updated);
          syncLocalVisualPosition(updated);
          recordLocalReactiveUpdate('transforms');
        }
      }

      return 'self';
    }

    const store = useGameStore.getState();
    const existingPlayer = store.players.get(playerId);
    if (!existingPlayer) return 'ignored';
    if (existingPlayer.name === localPlayerName) {
      loggers.network.sample('ghost-transform', 5000, 'ignoring ghost transform', playerId);
      return 'ignored';
    }

    const remotePlayer = setStoredPlayerVisibility(playerId, 'visible') ?? existingPlayer;
    const wasGrappling = remotePlayer.movement.isGrappling;
    const nextMovement = movementFromBits(transform, remotePlayer.movement);
    remotePlayer.position = decoded.position;
    remotePlayer.velocity = decoded.velocity;
    remotePlayer.lookYaw = decoded.lookYaw;
    remotePlayer.lookPitch = decoded.lookPitch;
    remotePlayer.movement = nextMovement;
    if (wasGrappling && !nextMovement.isGrappling) {
      const freshStore = useGameStore.getState();
      for (const line of freshStore.grappleLines) {
        if (line.ownerId === playerId) {
          freshStore.removeGrappleLine(line.id);
        }
      }
    }
    addRemoteTransformSnapshot(playerId, {
      serverTick: tick,
      serverTime,
      position: decoded.position,
      velocity: decoded.velocity,
      lookYaw: decoded.lookYaw,
      lookPitch: decoded.lookPitch,
      movementBits: transform.movementBits,
      wallRunSide: transform.wallRunSide,
      movementEpoch: transform.movementEpoch,
    });
    setPlayerVisualRotation(playerId, decoded.lookYaw);
    const chronosAegisActive = remotePlayer.heroId === 'chronos' && Boolean(transform.movementBits & MOVEMENT_BIT_CHRONOS_AEGIS);
    const previousChronosAegis = visualStore.getState().chronosAegisStates.get(playerId);
    if (chronosAegisActive && !previousChronosAegis?.active) {
      playChronosWorldSound('chronosAegis', decoded.position);
    }
    setChronosAegisVisualState(
      playerId,
      chronosAegisActive,
      Date.now(),
      transform.chronosAegisShieldRatio,
      { renderWorldEffect: true }
    );
    syncPlayerVisualEffectIndexes(remotePlayer, { localPlayerId: sessionId });
    return 'remote';
  };

  room.onMessage('playerTransformsV2', measureNetworkMessage('playerTransformsV2', (data: PlayerTransformsV2Message) => {
    const fullSnapshotPlayerIds = data.full ? new Set<string>() : null;
    let selfTransformCount = 0;
    let remoteTransformCount = 0;
    for (const hiddenPlayerId of data.hiddenPlayerIds || []) {
      if (hiddenPlayerId === sessionId) continue;
      setStoredPlayerVisibility(hiddenPlayerId, 'hidden');
      clearHiddenLiveVisuals(hiddenPlayerId);
    }
    for (const packedTransform of data.players) {
      const transform = unpackPackedTransform(packedTransform);
      const playerId = playerIdByNetId.get(transform.netId);
      if (!playerId) continue;
      fullSnapshotPlayerIds?.add(playerId);
      const result = handleTransform(playerId, transform, data.tick, data.serverTime, data.full === true);
      if (result === 'self') {
        selfTransformCount++;
      } else if (result === 'remote') {
        remoteTransformCount++;
      }
    }
    if (remoteTransformCount > 0 || (data.hiddenPlayerIds?.length ?? 0) > 0) {
      setGameTiming(data.tick, data.serverTime);
    }
    if (fullSnapshotPlayerIds) {
      pruneRemoteTransformHistories(fullSnapshotPlayerIds);
    }
    recordTransformMessage({
      transformCount: data.players.length,
      selfTransformCount,
      remoteTransformCount,
    });
  }));
}

export function setupPlayerInterestHandler(room: Room, sessionId: string) {
  room.onMessage('playerInterest', measureNetworkMessage('playerInterest', (data: PlayerInterestMessage) => {
    const store = useGameStore.getState();
    let nextPlayers: Map<string, Player> | null = null;
    let nextLocalPlayer = store.localPlayer;

    for (const snapshot of data.players) {
      const current = (nextPlayers ?? store.players).get(snapshot.playerId);
      if (!current) continue;

      if (current.visibility !== snapshot.state) {
        const nextPlayer = { ...current, visibility: snapshot.state };
        nextPlayers ??= new Map(store.players);
        nextPlayers.set(snapshot.playerId, nextPlayer);
        if (nextLocalPlayer?.id === snapshot.playerId) {
          nextLocalPlayer = nextPlayer;
        }
      }

      if (snapshot.playerId !== sessionId && shouldHideLiveVisuals(snapshot.state)) {
        clearHiddenLiveVisuals(snapshot.playerId);
      }
    }

    setGameTiming(data.tick, data.serverTime);
    if (nextPlayers) {
      useGameStore.setState({ players: nextPlayers, localPlayer: nextLocalPlayer });
    }

    if (import.meta.env.DEV && typeof window !== 'undefined') {
      (window as unknown as { __voxelPlayerInterest?: PlayerInterestMessage }).__voxelPlayerInterest = data;
    }
  }));
}

export function setupSelfMovementAuthorityHandler(room: Room) {
  hasReceivedSelfMovementAuthority = false;

  room.onMessage('selfMovementAuthority', measureNetworkMessage('selfMovementAuthority', (authority: SelfMovementAuthority) => {
    hasReceivedSelfMovementAuthority = true;
    recordMovementTraceAuthorityAck(authority);
    recordAuthorityAckReceived(authority);
    enqueueSelfMovementAuthority(authority);
    const localPlayer = useGameStore.getState().localPlayer;
    if (localPlayer?.heroId === 'chronos') {
      setChronosAegisVisualState(
        localPlayer.id,
        Boolean(authority.chronosAegisActive),
        Date.now(),
        authority.chronosAegisShieldRatio
      );
    }
    if (localPlayer && authority.powerupBoostUntil !== undefined) {
      useGameStore.getState().updateLocalPlayer({ powerupBoostUntil: authority.powerupBoostUntil ?? null });
    }
  }));
}

export function setupPlayerVitalsHandler(
  room: Room,
  sessionId: string,
  localPlayerName: string
) {
  room.onMessage('playerVitals', measureNetworkMessage('playerVitals', (data: PlayerVitalsMessage) => {
    const nowMs = Date.now();
    const initialStore = useGameStore.getState();
    let nextPlayers = initialStore.players;
    let nextLocalPlayer = initialStore.localPlayer;
    let nextPlayerPings = initialStore.playerPings;
    let playersChanged = false;
    let playerPingsChanged = false;
    let shouldPublishTiming = false;
    const liveVisualUpdates: Player[] = [];
    const hiddenVisualUpdates: string[] = [];
    const removedVisuals: string[] = [];
    const localVisualSyncs: Player[] = [];

    const writablePlayers = () => {
      if (nextPlayers === initialStore.players) {
        nextPlayers = new Map(initialStore.players);
      }
      playersChanged = true;
      return nextPlayers;
    };

    const writablePlayerPings = () => {
      if (nextPlayerPings === initialStore.playerPings) {
        nextPlayerPings = new Map(initialStore.playerPings);
      }
      playerPingsChanged = true;
      return nextPlayerPings;
    };

    for (const removedId of data.removedPlayerIds || []) {
      stopRemotePhantomCharge(removedId);
      stopObservedAbilityCastEffects(removedId);
      clearDeathVisualsForPlayer(removedId);
      forgetPlayerNetId(removedId);
      if (nextPlayers.has(removedId)) {
        writablePlayers().delete(removedId);
      }
      if (nextPlayerPings.has(removedId)) {
        writablePlayerPings().delete(removedId);
      }
      removedVisuals.push(removedId);
      shouldPublishTiming = true;
    }

    for (const vitals of data.players) {
      if (vitals.id !== sessionId && vitals.name === localPlayerName) {
        loggers.network.sample('ghost-vitals', 5000, 'ignoring ghost vitals', vitals.id);
        continue;
      }

      rememberPlayerNetId(vitals);

      if (vitals.id === sessionId) {
        if (useGameStore.getState().isObserverMode) {
          if (nextPlayers.has(vitals.id)) {
            writablePlayers().delete(vitals.id);
          }
          nextLocalPlayer = null;
          removedVisuals.push(vitals.id);
          shouldPublishTiming = true;
          continue;
        }

        const existing = nextLocalPlayer || nextPlayers.get(vitals.id);
        const existingPlayer = existing || undefined;
        const previousHeroId = existingPlayer?.heroId ?? null;
        if (shouldPreservePredictionOwnedLocalSimulation(existingPlayer, vitals.state, vitals.heroId)) {
          applyLocalVitalsPatchInPlace(existingPlayer, vitals, data.serverTime);
          const indexedPlayer = nextPlayers.get(vitals.id);
          if (indexedPlayer && indexedPlayer !== existingPlayer) {
            applyLocalVitalsPatchInPlace(indexedPlayer, vitals, data.serverTime);
          }
          syncDeathVisualForVitals(vitals.id, vitals.state, previousHeroId, vitals.heroId, vitals.respawnTime);
          if (nextLocalPlayer?.id === vitals.id) {
            nextLocalPlayer = existingPlayer;
          }
          syncPlayerVisualEffectIndexes(existingPlayer, { localPlayerId: sessionId, nowMs });
          continue;
        }

        const next = createLocalPlayerFromVitals(vitals, data.serverTime, existing || undefined);
        syncDeathVisualForVitals(next.id, next.state, previousHeroId, next.heroId, next.respawnTime);
        writablePlayers().set(next.id, next);
        nextLocalPlayer = next;
        recordLocalReactiveUpdate('vitals');
        shouldPublishTiming = true;
        syncPlayerVisualEffectIndexes(next, { localPlayerId: sessionId, nowMs });
        if (!existing) {
          localVisualSyncs.push(next);
        }
        continue;
      }

      const existing = nextPlayers.get(vitals.id);
      const next = createPlayerFromVitals(vitals, data.serverTime, existing);
      syncDeathVisualForVitals(next.id, next.state, existing?.heroId ?? null, next.heroId, next.respawnTime);
      writablePlayers().set(vitals.id, next);
      if (shouldHideLiveVisuals(next.visibility)) {
        hiddenVisualUpdates.push(next.id);
      } else {
        liveVisualUpdates.push(next);
      }
      syncPlayerVisualEffectIndexes(next, { localPlayerId: sessionId, nowMs });
      shouldPublishTiming = true;
    }

    if (shouldPublishTiming) {
      setGameTiming(data.tick, data.serverTime);
    }

    if (playersChanged || playerPingsChanged) {
      useGameStore.setState({
        ...(playersChanged ? { players: nextPlayers, localPlayer: nextLocalPlayer } : {}),
        ...(playerPingsChanged ? { playerPings: nextPlayerPings } : {}),
      });
    }

    for (const removedId of removedVisuals) {
      removePlayerVisualState(removedId);
    }
    for (const playerId of hiddenVisualUpdates) {
      clearHiddenLiveVisuals(playerId);
    }
    for (const player of liveVisualUpdates) {
      setPlayerVisualTransform(player.id, player.position, player.lookYaw);
    }
    for (const player of localVisualSyncs) {
      syncLocalVisualPosition(player);
    }
  }));
}

export function setupMatchSnapshotHandler(room: Room) {
  room.onMessage('matchSnapshot', measureNetworkMessage('matchSnapshot', (data: MatchSnapshotMessage) => {
    const store = useGameStore.getState();
    if (data.phase !== 'playing' && data.phase !== 'countdown') {
      clearAllDeathVisuals();
    }
    setGameTiming(data.tick, data.serverTime);
    useGameStore.setState({
      mapSeed: data.mapSeed,
      gameplayMode: isGameplayMode(data.gameplayMode) ? data.gameplayMode : store.gameplayMode ?? DEFAULT_GAMEPLAY_MODE,
      mapThemeId: data.mapThemeId ?? null,
      mapSize: normalizeVoxelMapSizeId(data.mapSize),
      gamePhase: data.phase,
      redScore: data.redScore,
      blueScore: data.blueScore,
      redFlag: data.redFlag ?? store.redFlag,
      blueFlag: data.blueFlag ?? store.blueFlag,
      roundTimeRemaining: data.roundTimeRemaining,
      phaseEndTime: data.phaseEndTime,
      gameClockFrozen: data.gameClockFrozen === true,
    });
  }));
}

export function setupPowerupHandlers(room: Room) {
  room.onMessage('powerupState', measureNetworkMessage('powerupState', (data: PowerupStateMessage) => {
    if (!data || !Array.isArray(data.pickups)) return;
    useGameStore.getState().setPowerupPickups(data.pickups);
  }));

  room.onMessage('powerupCollected', measureNetworkMessage('powerupCollected', (data: PowerupCollectedMessage) => {
    if (!data || typeof data.pickupId !== 'string') return;

    const store = useGameStore.getState();
    store.updatePowerupPickup({
      pickupId: data.pickupId,
      availableAt: data.availableAt,
    });
    store.recordPowerupPickupCollection({
      pickupId: data.pickupId,
      collectedAt: Date.now(),
    });

    void playSharedSound(data.kind === 'health_pack' ? 'healPickup' : 'powerupPickup', {
      position: data.position,
    });

    if (data.kind !== 'powerup' || !data.playerId) return;
    const powerupBoostUntil = data.expiresAt ?? null;
    if (data.playerId === store.localPlayer?.id) {
      store.updateLocalPlayer({ powerupBoostUntil });
      return;
    }

    const player = store.players.get(data.playerId);
    if (player) {
      store.updatePlayer(data.playerId, {
        ...player,
        powerupBoostUntil,
      });
    }
  }));
}

/**
 * Sets up void zone event handlers
 */
export function setupVoidZoneHandlers(room: Room, sessionId: string) {
  room.onMessage('voidZoneCreated', measureNetworkMessage('voidZoneCreated', (data: {
    id: string;
    position: { x: number; y: number; z: number };
    radius: number;
    duration: number;
    startTime: number;
    ownerId: string;
    ownerTeam: 'red' | 'blue';
  }) => {
    useGameStore.getState().addVoidZone(data);
  }));

  room.onMessage('voidZoneExpired', measureNetworkMessage('voidZoneExpired', (data: { id: string }) => {
    useGameStore.getState().removeVoidZone(data.id);
  }));
}

interface AbilityUsedMessage {
  playerId: string;
  abilityId: string;
  success?: boolean;
  castId?: string;
  position?: { x: number; y: number; z: number };
  startPosition?: { x: number; y: number; z: number };
  targetPosition?: { x: number; y: number; z: number };
  interceptPosition?: { x: number; y: number; z: number };
  impactPosition?: { x: number; y: number; z: number };
  interceptedByChronosAegis?: boolean;
  targetIds?: string[];
  targets?: Array<{
    targetId: string;
    position: { x: number; y: number; z: number };
    rootUntil: number;
  }>;
  rootUntil?: number;
  mode?: 'allies' | 'self';
  aimDirection?: { x: number; y: number; z: number };
  velocity?: { x: number; y: number; z: number };
  maxDistance?: number;
  direction?: { yaw?: number; pitch?: number; x?: number; y?: number; z?: number };
  ownerTeam?: Team;
  launchSide?: -1 | 1;
  launchYaw?: number;
  serverTime?: number;
  durationMs?: number;
  ammoRemaining?: number;
  reloadStartedAt?: number;
  reloadUntil?: number;
  shockwaveDirection?: { x: number; y: number; z: number };
  releaseAt?: number;
  radius?: number;
  duration?: number;
  meteorStartTime?: number;
  impactTime?: number;
  active?: boolean;
  fuel?: number;
  supercharged?: boolean;
}

function normalizeAimDirection(data: AbilityUsedMessage): { x: number; y: number; z: number } {
  if (data.aimDirection) return data.aimDirection;
  if (
    typeof data.direction?.x === 'number' &&
    typeof data.direction?.y === 'number' &&
    typeof data.direction?.z === 'number'
  ) {
    return {
      x: data.direction.x,
      y: data.direction.y,
      z: data.direction.z,
    };
  }

  const yaw = data.direction?.yaw ?? 0;
  const pitch = data.direction?.pitch ?? 0;
  const cosPitch = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  };
}

function resolveOwnerTeam(data: AbilityUsedMessage): Team {
  const store = useGameStore.getState();
  return data.ownerTeam ?? store.players.get(data.playerId)?.team ?? store.localPlayer?.team ?? 'red';
}

function toPlainPosition(vector: THREE.Vector3): { x: number; y: number; z: number } {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}

function resolvePlayerFlatForward(playerId: string): Vec3Like | null {
  const store = useGameStore.getState();
  const visual = visualStore.getState();
  const yaw = visual.playerRotations.get(playerId)
    ?? store.players.get(playerId)?.lookYaw
    ?? (store.localPlayer?.id === playerId ? store.localPlayer.lookYaw : undefined);
  return typeof yaw === 'number' && Number.isFinite(yaw)
    ? chronosOrbForwardFromYaw(yaw)
    : null;
}

function resolveChronosOrbVisualDirection(data: AbilityUsedMessage): Vec3Like | null {
  if (data.aimDirection) return data.aimDirection;
  if (
    typeof data.direction?.x === 'number' &&
    typeof data.direction?.y === 'number' &&
    typeof data.direction?.z === 'number'
  ) {
    return {
      x: data.direction.x,
      y: data.direction.y,
      z: data.direction.z,
    };
  }

  const yaw = typeof data.direction?.yaw === 'number'
    ? data.direction.yaw
    : typeof data.launchYaw === 'number'
      ? data.launchYaw
      : undefined;
  if (typeof yaw === 'number' && Number.isFinite(yaw)) {
    const pitch = typeof data.direction?.pitch === 'number' && Number.isFinite(data.direction.pitch)
      ? data.direction.pitch
      : 0;
    const cosPitch = Math.cos(pitch);
    return {
      x: -Math.sin(yaw) * cosPitch,
      y: Math.sin(pitch),
      z: -Math.cos(yaw) * cosPitch,
    };
  }

  return resolvePlayerFlatForward(data.playerId);
}

function resolveObservedStartPosition(
  data: AbilityUsedMessage,
  localPlayerId: string | null,
  fallback: { x: number; y: number; z: number } | undefined
): { x: number; y: number; z: number } | undefined {
  if (data.playerId !== localPlayerId) {
    const resolvedOrigin = resolveAbilitySocketOrigin({
      ownerScope: 'remoteBody',
      playerId: data.playerId,
      abilityId: data.abilityId,
      side: data.launchSide,
    });
    if (resolvedOrigin) {
      return offsetChronosOrbVisualPlainPosition(
        toPlainPosition(resolvedOrigin.position),
        resolveChronosOrbVisualDirection(data),
        data.abilityId
      );
    }
  }

  return fallback;
}

function triggerObservedRemoteAttack(
  data: AbilityUsedMessage,
  localPlayerId: string | null,
  side: -1 | 1 | undefined = data.launchSide
): void {
  if (data.playerId === localPlayerId) return;

  triggerRemotePlayerAttack(data.playerId, data.abilityId, {
    side: side ?? 1,
    startedAtMs: Date.now(),
  });
}

export function stopRemotePhantomCharge(playerId: string): void {
  const controller = remotePhantomChargeControllers.get(playerId);
  if (!controller) return;
  controller.abort();
  remotePhantomChargeControllers.delete(playerId);
}

function playPhantomWorldSound(
  sound: SoundName,
  position: { x: number; y: number; z: number } | undefined,
  options: { durationMs?: number; signal?: AbortSignal; volume?: number } = {}
): void {
  void playSharedSound(sound, {
    position,
    durationMs: options.durationMs,
    signal: options.signal,
    volume: options.volume,
  });
}

function playHookshotWorldSound(
  sound: SoundName,
  position: { x: number; y: number; z: number } | undefined,
  options: { durationMs?: number; fadeOutMs?: number; volume?: number } = {}
): void {
  void playSharedSound(sound, {
    position,
    durationMs: options.durationMs,
    fadeOutMs: options.fadeOutMs,
    volume: options.volume,
  });
}

function playHookshotShotSound(position: { x: number; y: number; z: number } | undefined): void {
  playHookshotWorldSound('hookshotShot', position, {
    durationMs: HOOKSHOT_SHOT_CLIP_MS,
    fadeOutMs: 24,
  });
}

function playBlazeWorldSound(
  sound: SoundName,
  position: { x: number; y: number; z: number } | undefined,
  options: { durationMs?: number; fadeOutMs?: number; startOffsetMs?: number; volume?: number; pitch?: number } = {}
): void {
  void playSharedSound(sound, {
    position,
    durationMs: options.durationMs,
    fadeOutMs: options.fadeOutMs,
    startOffsetMs: options.startOffsetMs,
    volume: options.volume,
    pitch: options.pitch,
  });
}

function playChronosWorldSound(
  sound: SoundName,
  position: { x: number; y: number; z: number } | undefined,
  options: { durationMs?: number; fadeOutMs?: number; volume?: number; pitch?: number } = {}
): void {
  if (sound === 'chronosPulse' || sound === 'chronosAegis' || sound === 'chronosTimebreak') {
    return;
  }

  void playSharedSound(sound, {
    position,
    durationMs: options.durationMs,
    fadeOutMs: options.fadeOutMs,
    volume: options.volume,
    pitch: options.pitch,
  });
}

function scaleDirection(
  direction: { x: number; y: number; z: number },
  speed: number
): { x: number; y: number; z: number } {
  return {
    x: direction.x * speed,
    y: direction.y * speed,
    z: direction.z * speed,
  };
}

function applyPhantomPrimaryState(data: {
  ammo?: number;
  ammoRemaining?: number;
  reloading?: boolean;
  reloadStartedAt?: number;
  reloadUntil?: number;
}): void {
  const store = useGameStore.getState();
  const wasReloading = store.phantomPrimaryReloading;
  const previousReloadStart = store.phantomPrimaryReloadStart;
  const previousReloadEnd = store.phantomPrimaryReloadEnd;
  const now = Date.now();
  const ammo = data.ammoRemaining ?? data.ammo;
  const reloading = data.reloading ?? Boolean(data.reloadUntil && data.reloadUntil > now);
  const shouldPreserveEmptyReloadAmmo =
    reloading &&
    wasReloading &&
    store.phantomPrimaryAmmo <= 0 &&
    typeof ammo === 'number' &&
    ammo > 0;
  if (typeof ammo === 'number') {
    store.setPhantomPrimaryAmmo(shouldPreserveEmptyReloadAmmo ? 0 : ammo);
  }

  const reloadStartedAt = reloading ? (data.reloadStartedAt ?? now) : 0;
  const reloadUntil = reloading ? (data.reloadUntil ?? now) : 0;
  store.setPhantomPrimaryReload(
    reloading,
    reloadStartedAt,
    reloadUntil
  );

  const reloadSoundKey = `${reloadStartedAt}:${reloadUntil}`;
  const startedNewReload = reloading &&
    reloadUntil > reloadStartedAt &&
    reloadUntil > now &&
    (!wasReloading || previousReloadStart !== reloadStartedAt || previousReloadEnd !== reloadUntil);

  if (startedNewReload && lastLocalPhantomReloadSoundKey !== reloadSoundKey) {
    lastLocalPhantomReloadSoundKey = reloadSoundKey;
    if (shouldSuppressPredictedLocalAbilitySound('phantom_reload', now)) return;

    const reloadDurationMs = Math.max(0, reloadUntil - now);
    const fadeOutMs = Math.min(450, reloadDurationMs);
    void playSharedSound('phantomReload', {
      durationMs: reloadDurationMs,
      fadeOutMs,
    });
  }
}

function applyConfirmedPhantomActiveAbility(data: AbilityUsedMessage): void {
  const abilityDef = ABILITY_DEFINITIONS[data.abilityId];
  if (!abilityDef) return;

  const store = useGameStore.getState();
  const player = store.players.get(data.playerId);
  if (!player) return;

  const existingAbility = player.abilities?.[data.abilityId];
  const activatedAt = data.serverTime ?? Date.now();
  const cooldownSeconds = COOLDOWN_AFTER_ACTIVE_ABILITY_IDS.has(data.abilityId)
    ? 0
    : abilityDef.cooldown ?? existingAbility?.cooldownRemaining ?? 0;
  const abilities = {
    ...player.abilities,
    [data.abilityId]: {
      abilityId: data.abilityId,
      cooldownRemaining: cooldownSeconds,
      cooldownUntil: cooldownSeconds > 0 ? Date.now() + cooldownSeconds * 1000 : 0,
      charges: existingAbility?.charges ?? abilityDef.charges ?? 1,
      isActive: true,
      activatedAt,
    },
  };

  if (data.playerId === (store.localPlayer?.id ?? store.playerId)) {
    store.updateLocalPlayer({
      abilities,
      ultimateCharge: data.abilityId === 'phantom_veil' ? 0 : player.ultimateCharge,
    });
    if (data.abilityId === 'phantom_veil') {
      const durationMs = (abilityDef.duration ?? 0) * 1000;
      const effectEndTime = Date.now() + durationMs;
      store.setUltimateEffect(true, 'phantom_veil', effectEndTime);
    }
    return;
  }

  store.updatePlayer(data.playerId, {
    ...player,
    abilities,
  });
}

function hasActivePhantomVeil(player: Player | null | undefined): boolean {
  return player?.heroId === 'phantom' && player.abilities?.phantom_veil?.isActive === true;
}

function isRemotePhantomVeiled(playerId: string, localPlayerId: string | null): boolean {
  if (playerId === localPlayerId) return false;
  return hasActivePhantomVeil(useGameStore.getState().players.get(playerId));
}

function applyLocalPhantomBlinkConfirmation(
  data: AbilityUsedMessage,
  destination: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number }
): void {
  const store = useGameStore.getState();
  const localPlayer = store.localPlayer;
  if (!localPlayer || data.playerId !== (localPlayer.id ?? store.playerId)) return;
  const horizontalLength = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
  const velocity = {
    x: horizontalLength > 0.0001 ? (direction.x / horizontalLength) * 2 : 0,
    y: localPlayer.velocity.y,
    z: horizontalLength > 0.0001 ? (direction.z / horizontalLength) * 2 : -2,
  };
  const movement = {
    ...localPlayer.movement,
    isGrounded: false,
    isSliding: false,
    slideTimeRemaining: 0,
  };

  store.updateLocalPlayer({
    position: destination,
    velocity,
    movement,
  });
  confirmLocalMovementTransform(localPlayer, {
    position: destination,
    velocity,
    movement,
  }, localPlayer.lookYaw);
}

function handlePhantomAbilityUsed(data: AbilityUsedMessage, localPlayerId: string | null): boolean {
  const store = useGameStore.getState();
  const isLocalPlayer = data.playerId === localPlayerId;
  const position = data.position ?? store.players.get(data.playerId)?.position ?? store.localPlayer?.position;
  const fallbackStartPosition = data.startPosition ?? position;
  const ownerTeam = resolveOwnerTeam(data);
  const castId = data.castId ?? `${data.abilityId}_${data.playerId}_${data.serverTime ?? Date.now()}`;

  switch (data.abilityId) {
    case 'phantom_dire_ball': {
      const launchSide = data.launchSide ?? 1;
      const startPosition = resolveObservedStartPosition(
        data,
        localPlayerId,
        fallbackStartPosition
      );
      if (!startPosition) return true;
      triggerObservedRemoteAttack(data, localPlayerId, launchSide);
      const direction = normalizeAimDirection(data);
      const predictedVisualId = isLocalPlayer
        ? consumePredictedLocalAbilityVisual('phantom_dire_ball', data.playerId, { launchSide: data.launchSide })
        : null;
      if (isLocalPlayer) {
        applyPhantomPrimaryState(data);
      }
      if (!predictedVisualId) {
        store.addDireBall({
          id: castId,
          position: startPosition,
          velocity: {
            x: direction.x * PHANTOM_PROJECTILE_SPEED,
            y: direction.y * PHANTOM_PROJECTILE_SPEED,
            z: direction.z * PHANTOM_PROJECTILE_SPEED,
          },
          impactPosition: data.interceptedByChronosAegis ? data.impactPosition : undefined,
          interceptedByChronosAegis: Boolean(data.interceptedByChronosAegis),
          startTime: Date.now(),
          ownerId: data.playerId,
          ownerTeam,
          launchSide: data.launchSide,
          launchYaw: data.launchYaw,
        });
      }
      if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('phantom_dire_ball')) {
        playPhantomWorldSound('phantomBasic', startPosition);
      }
      return true;
    }

    case 'phantom_void_ray_charge': {
      const startPosition = resolveObservedStartPosition(
        data,
        localPlayerId,
        fallbackStartPosition
      );
      if (!startPosition) return true;
      triggerObservedRemoteAttack(data, localPlayerId);
      stopRemotePhantomCharge(data.playerId);
      stopObservedAbilityCastEffects(data.playerId, 'phantom_void_ray_charge');
      if (!isLocalPlayer) {
        const visualStartTime = Date.now();
        startObservedAbilityCastEffect({
          id: `phantom_void_ray_charge_${data.playerId}`,
          playerId: data.playerId,
          abilityId: 'phantom_void_ray_charge',
          startPosition,
          startTime: visualStartTime,
          endTime: visualStartTime + (data.durationMs ?? VOID_RAY_CHARGE_TIME),
          color: 0x9f7aea,
          secondaryColor: 0x22d3ee,
          scale: 1.08,
        });
      }
      const controller = new AbortController();
      remotePhantomChargeControllers.set(data.playerId, controller);
      const predictedVisualId = isLocalPlayer
        ? consumePredictedLocalAbilityVisual('phantom_void_ray_charge', data.playerId)
        : null;
      if (isLocalPlayer) {
        if (!predictedVisualId) {
          store.setVoidRayCharging(true, Date.now());
        }
      }
      if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('phantom_void_ray_charge')) {
        playPhantomWorldSound('phantomVoidRayCharge', startPosition, {
          durationMs: data.durationMs,
          signal: controller.signal,
        });
      }
      return true;
    }

    case 'phantom_void_ray_charge_cancel':
      stopRemotePhantomCharge(data.playerId);
      stopObservedAbilityCastEffects(data.playerId, 'phantom_void_ray_charge');
      if (isLocalPlayer) {
        store.setVoidRayCharging(false, 0);
      }
      return true;

    case 'phantom_void_ray': {
      const startPosition = resolveObservedStartPosition(
        data,
        localPlayerId,
        fallbackStartPosition
      );
      stopRemotePhantomCharge(data.playerId);
      stopObservedAbilityCastEffects(data.playerId, 'phantom_void_ray_charge');
      const predictedVisualId = isLocalPlayer
        ? consumePredictedLocalAbilityVisual('phantom_void_ray', data.playerId)
        : null;
      if (isLocalPlayer) {
        store.setVoidRayCharging(false, 0);
        const abilityDef = ABILITY_DEFINITIONS[data.abilityId];
        if (abilityDef?.cooldown) {
          store.setClientCooldown(data.abilityId, Date.now() + abilityDef.cooldown * 1000);
        }
      }
      if (!startPosition) return true;
      triggerObservedRemoteAttack(data, localPlayerId);
      if (!predictedVisualId) {
        store.addVoidRay({
          id: castId,
          startPosition,
          direction: normalizeAimDirection(data),
          impactPosition: data.interceptedByChronosAegis ? data.impactPosition : undefined,
          interceptedByChronosAegis: Boolean(data.interceptedByChronosAegis),
          startTime: Date.now(),
          ownerId: data.playerId,
          ownerTeam,
        });
      }
      if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('phantom_void_ray')) {
        playPhantomWorldSound('phantomVoidRay', startPosition);
      }
      return true;
    }

    case 'phantom_blink': {
      if (fallbackStartPosition && position) {
        const hideRemoteVeilParticles = isRemotePhantomVeiled(data.playerId, localPlayerId);
        if (isLocalPlayer) {
          applyLocalPhantomBlinkConfirmation(data, position, normalizeAimDirection(data));
          triggerTeleportEffect('blink');
          if (!shouldSuppressPredictedLocalAbilitySound('phantom_blink')) {
            playPhantomWorldSound('phantomBlink', undefined, { durationMs: 900, volume: 1.1 });
          }
        } else {
          playPhantomWorldSound('phantomBlink', fallbackStartPosition, { durationMs: 900, volume: 1.1 });
        }
        if (!hideRemoteVeilParticles) {
          triggerBlinkEffect(fallbackStartPosition, position);
        }
      }
      return true;
    }

    case 'phantom_personal_shield':
      applyConfirmedPhantomActiveAbility(data);
      if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('phantom_personal_shield')) {
        triggerPhantomShieldCastEffect({
          playerId: data.playerId,
          isLocalPlayer,
          position,
          yaw: data.direction?.yaw,
        });
      }
      return true;

    case 'phantom_veil':
      applyConfirmedPhantomActiveAbility(data);
      if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('phantom_veil')) {
        playPhantomWorldSound('phantomVeil', position);
      }
      return true;

    default:
      return false;
  }
}

function handleHookshotAbilityUsed(data: AbilityUsedMessage, localPlayerId: string | null): boolean {
  const store = useGameStore.getState();
  const isLocalPlayer = data.playerId === localPlayerId;
  const position = data.position ?? store.players.get(data.playerId)?.position ?? store.localPlayer?.position;
  const fallbackStartPosition = data.startPosition ?? position;
  const targetPosition = data.targetPosition ?? position;
  const ownerTeam = resolveOwnerTeam(data);
  const castId = data.castId ?? `${data.abilityId}_${data.playerId}_${data.serverTime ?? Date.now()}`;
  const now = Date.now();

  switch (data.abilityId) {
    case 'hookshot_basic_attack': {
      const launchSide = data.launchSide ?? 1;
      const startPosition = resolveObservedStartPosition(
        data,
        localPlayerId,
        fallbackStartPosition
      );
      if (!startPosition) return true;
      triggerObservedRemoteAttack(data, localPlayerId, launchSide);
      const velocity = data.velocity ?? scaleDirection(normalizeAimDirection(data), HOOKSHOT_SPEED);
      const predictedVisualId = isLocalPlayer
        ? consumePredictedLocalAbilityVisual('hookshot_basic_attack', data.playerId, { launchSide: data.launchSide })
        : null;
      if (!predictedVisualId) {
        store.addHookProjectile({
          id: castId,
          position: startPosition,
          velocity,
          impactPosition: data.interceptedByChronosAegis ? data.impactPosition : undefined,
          interceptedByChronosAegis: Boolean(data.interceptedByChronosAegis),
          startTime: now,
          ownerId: data.playerId,
          ownerTeam,
          state: 'extending',
          maxDistance: data.maxDistance ?? HOOKSHOT_MAX_DISTANCE,
          startPosition,
          launchSide: data.launchSide,
          launchYaw: data.launchYaw,
        });
      }
      if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('hookshot_basic_attack')) {
        playHookshotShotSound(startPosition);
        playHookshotWorldSound('hookshotPrimary', startPosition);
      }
      return true;
    }

    case 'hookshot_heavy_attack': {
      const launchSide = data.launchSide ?? 1;
      const startPosition = resolveObservedStartPosition(
        data,
        localPlayerId,
        fallbackStartPosition
      );
      if (!startPosition) return true;
      triggerObservedRemoteAttack(data, localPlayerId, launchSide);
      const velocity = data.velocity ?? scaleDirection(normalizeAimDirection(data), DRAG_HOOK_SPEED);
      const predictedVisualId = isLocalPlayer
        ? consumePredictedLocalAbilityVisual('hookshot_heavy_attack', data.playerId, { launchSide: data.launchSide })
        : null;
      const targetId = data.targetIds?.[0];
      if (!predictedVisualId) {
        store.addDragHook({
          id: castId,
          position: startPosition,
          velocity,
          impactPosition: data.interceptedByChronosAegis ? data.impactPosition : undefined,
          interceptedByChronosAegis: Boolean(data.interceptedByChronosAegis),
          startTime: now,
          ownerId: data.playerId,
          ownerTeam,
          state: 'flying',
          targetId,
          startPosition,
          launchSide: data.launchSide,
          launchYaw: data.launchYaw,
        });
      } else if (targetId) {
        store.updateDragHook(predictedVisualId, {
          targetId,
          velocity,
        });
      }
      if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('hookshot_heavy_attack')) {
        playHookshotShotSound(startPosition);
        playHookshotWorldSound('hookshotSecondary', startPosition, { volume: 1.05 });
      }
      return true;
    }

    case 'hookshot_grapple': {
      const launchSide = data.launchSide ?? 1;
      const startPosition = resolveObservedStartPosition(
        data,
        localPlayerId,
        fallbackStartPosition
      );
      if (!startPosition || !targetPosition) return true;
      triggerObservedRemoteAttack(data, localPlayerId, launchSide);
      const startTime = data.serverTime ?? now;
      const predictedLocalLine = isLocalPlayer
        ? store.grappleLines.find((line) => (
          line.ownerId === data.playerId &&
          line.state !== 'done' &&
          line.state !== 'retracting'
        ))
        : null;
      if (isLocalPlayer) {
        consumePredictedLocalAbilityVisual('hookshot_grapple', data.playerId, { launchSide: data.launchSide });
      }

      if (predictedLocalLine) {
        store.updateGrappleLine(predictedLocalLine.id, {
          startPosition,
          endPosition: targetPosition,
          startTime,
          launchSide: data.launchSide,
          launchYaw: data.launchYaw,
        });
      } else {
        store.addGrappleLine({
          id: castId,
          startPosition,
          endPosition: targetPosition,
          startTime,
          ownerId: data.playerId,
          state: 'extending',
          launchSide: data.launchSide,
          launchYaw: data.launchYaw,
        });
      }
      if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('hookshot_grapple')) {
        playHookshotShotSound(startPosition);
        playHookshotWorldSound('hookshotGrapple', startPosition);
      }
      return true;
    }

    case 'hookshot_anchor_wall': {
      const startPosition = resolveObservedStartPosition(
        data,
        localPlayerId,
        fallbackStartPosition
      );
      if (!startPosition) return true;
      triggerObservedRemoteAttack(data, localPlayerId, data.launchSide);
      const predictedVisualId = isLocalPlayer
        ? consumePredictedLocalAbilityVisual('hookshot_anchor_wall', data.playerId)
        : null;
      const direction = normalizeAimDirection(data);
      if (!predictedVisualId) {
        store.addEarthWall({
          id: castId,
          startPosition,
          direction: { x: direction.x, y: 0, z: direction.z },
          startTime: now,
          duration: data.duration ?? 6.25,
          ownerId: data.playerId,
          ownerTeam,
          maxDistance: data.maxDistance ?? 24.35,
          hookProgress: 0,
        });
      }
      return true;
    }

    case 'hookshot_ground_hooks': {
      const effectPosition = data.position ?? fallbackStartPosition;
      if (!effectPosition) return true;
      triggerObservedRemoteAttack(data, localPlayerId, data.launchSide);
      const predictedVisualId = isLocalPlayer
        ? consumePredictedLocalAbilityVisual('hookshot_ground_hooks', data.playerId)
        : null;
      const duration = data.duration ?? HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS;
      const rootUntil = data.rootUntil ?? now + duration * 1000;
      const targets = data.targets ?? [];
      const effect = {
        id: castId,
        position: effectPosition,
        startTime: now,
        duration,
        ownerId: data.playerId,
        ownerTeam,
        radius: data.radius ?? HOOKSHOT_GROUND_HOOKS_RADIUS,
        rootUntil,
        targets,
      };

      if (predictedVisualId) {
        store.updateHookshotGroundHooks(predictedVisualId, effect);
      } else {
        store.addHookshotGroundHooks(effect);
      }
      if (isLocalPlayer) {
        store.updateLocalPlayer({ ultimateCharge: 0 });
      }
      if (localPlayerId && targets.some((target) => target.targetId === localPlayerId)) {
        setLocalMovementRootedUntil(rootUntil);
      }
      if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('hookshot_ground_hooks')) {
        playHookshotShotSound(effectPosition);
        playHookshotWorldSound('hookshotGroundHooks', effectPosition, { volume: 1.12 });
      }
      return true;
    }

    default:
      return false;
  }
}

function handleBlazeAbilityUsed(data: AbilityUsedMessage, localPlayerId: string | null): boolean {
  const store = useGameStore.getState();
  const isLocalPlayer = data.playerId === localPlayerId;
  const position = data.position ?? store.players.get(data.playerId)?.position ?? store.localPlayer?.position;
  const fallbackStartPosition = data.startPosition ?? position;
  const targetPosition = data.targetPosition ?? position;
  const ownerTeam = resolveOwnerTeam(data);
  const castId = data.castId ?? `${data.abilityId}_${data.playerId}_${data.serverTime ?? Date.now()}`;
  const now = Date.now();

  switch (data.abilityId) {
    case 'blaze_rocket': {
      const startPosition = resolveObservedStartPosition(
        data,
        localPlayerId,
        fallbackStartPosition
      );
      if (!startPosition) return true;
      triggerObservedRemoteAttack(data, localPlayerId);
      const velocity = data.velocity ?? scaleDirection(normalizeAimDirection(data), BLAZE_ROCKET_SPEED);
      const predictedVisualId = isLocalPlayer
        ? consumePredictedLocalAbilityVisual('blaze_rocket', data.playerId)
        : null;
      if (!predictedVisualId) {
        store.addRocket({
          id: castId,
          position: startPosition,
          velocity,
          impactPosition: data.impactPosition ?? targetPosition,
          interceptedByChronosAegis: Boolean(data.interceptedByChronosAegis),
          startTime: now,
          ownerId: data.playerId,
          ownerTeam,
        });
      }
      if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('blaze_rocket')) {
        playBlazeWorldSound('blazeRocket', startPosition, {
          pitch: 0.85 + Math.random() * 0.3,
        });
      }
      return true;
    }

    case 'blaze_bomb': {
      const startPosition = resolveObservedStartPosition(
        data,
        localPlayerId,
        fallbackStartPosition
      );
      if (!startPosition || !targetPosition) return true;
      triggerObservedRemoteAttack(data, localPlayerId);
      const serverTime = data.serverTime ?? now;
      const meteorStartDelay = data.meteorStartTime
        ? Math.max(0, data.meteorStartTime - serverTime)
        : 0;
      const impactDelay = data.impactTime
        ? Math.max(0, data.impactTime - serverTime)
        : BLAZE_BOMB_FALL_DURATION;
      const meteorStartTime = now + meteorStartDelay;
      const impactTime = now + impactDelay;
      const fallSoundDelay = Math.min(meteorStartDelay, impactDelay);
      const fallSoundDuration = Math.max(0, impactDelay - fallSoundDelay);
      const visualImpactPosition = data.impactPosition ?? data.interceptPosition ?? targetPosition;
      if (isLocalPlayer) {
        const abilityDef = ABILITY_DEFINITIONS[data.abilityId];
        if (abilityDef?.cooldown) {
          store.setClientCooldown(data.abilityId, now + abilityDef.cooldown * 1000);
        }
      }
      store.addBomb({
        id: castId,
        targetPosition,
        interceptPosition: data.interceptPosition,
        impactPosition: visualImpactPosition,
        interceptedByChronosAegis: Boolean(data.interceptedByChronosAegis || data.interceptPosition),
        startPosition,
        warningStartTime: now,
        startTime: meteorStartTime,
        impactTime,
        radius: data.radius ?? BLAZE_BOMB_SPLASH_RADIUS,
        ownerId: data.playerId,
        ownerTeam,
        hasExploded: false,
      });
      if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('blaze_bomb')) {
        playBlazeWorldSound('blazeBombRelease', startPosition, {
          startOffsetMs: BLAZE_BOMB_RELEASE_SOUND_START_OFFSET_MS,
          durationMs: BLAZE_BOMB_RELEASE_SOUND_DURATION_MS,
          fadeOutMs: BLAZE_BOMB_RELEASE_SOUND_FADE_OUT_MS,
        });
      }
      playBlazeWorldSound('blazeBombTarget', startPosition);
      if (fallSoundDuration > 0) {
        window.setTimeout(() => {
          playBlazeWorldSound('blazeBombFall', startPosition, {
            durationMs: fallSoundDuration,
            fadeOutMs: Math.min(200, fallSoundDuration),
          });
        }, fallSoundDelay);
      }
      window.setTimeout(() => {
        playBlazeWorldSound('blazeBombExplode', visualImpactPosition, { volume: 1.05 });
      }, impactDelay);
      return true;
    }

    case 'blaze_rocketjump': {
      const effectPosition = fallbackStartPosition ?? position;
      if (effectPosition) {
        triggerRocketJumpExplosion(effectPosition);
        if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('blaze_rocketjump')) {
          playBlazeWorldSound('blazeRocketJump', effectPosition);
        }
      }
      if (isLocalPlayer && data.velocity && store.localPlayer) {
        const predictedVisualId = consumePredictedLocalAbilityVisual('blaze_rocketjump', data.playerId);
        if (!predictedVisualId) {
          triggerBlazeRocketJumpStaffSlam(now);
        }
        const movement = {
          ...store.localPlayer.movement,
          isGrounded: false,
          isSliding: false,
          slideTimeRemaining: 0,
        };
        confirmLocalMovementTransform(store.localPlayer, {
          position,
          velocity: data.velocity,
          movement,
        }, store.localPlayer.lookYaw);
        pushLocalPlayerImpulse({ ...data.velocity, mode: 'set' });
        if (position) {
          store.updateLocalPlayer({
            position,
            velocity: data.velocity,
            movement,
          });
        }
      }
      return true;
    }

    case 'blaze_airstrike': {
      if (position) {
        triggerAirStrike(position, { ownerId: data.playerId, ownerTeam: data.ownerTeam ?? null });
        if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('blaze_airstrike')) {
          void playSharedBlazeAirstrikeSound({ position });
        }
      }
      if (isLocalPlayer && store.localPlayer) {
        store.updateLocalPlayer({ ultimateCharge: 0 });
      }
      return true;
    }

    case 'blaze_flamethrower': {
      const active = Boolean(data.active);
      const fuel = typeof data.fuel === 'number' ? data.fuel : undefined;

      if (active) {
        triggerObservedRemoteAttack(data, localPlayerId);
      }

      if (isLocalPlayer && store.localPlayer) {
        store.updateLocalPlayer({
          movement: {
            ...store.localPlayer.movement,
            isJetpacking: active,
            jetpackFuel: fuel ?? store.localPlayer.movement.jetpackFuel,
          },
        });
        store.setFlamethrowerActive(active);
        if (fuel !== undefined) {
          store.setFlamethrowerFuel(fuel);
        }
        return true;
      }

      const player = store.players.get(data.playerId);
      if (!player) return true;

      store.updatePlayer(data.playerId, {
        ...player,
        position: position ?? player.position,
        movement: {
          ...player.movement,
          isJetpacking: active,
          jetpackFuel: fuel ?? player.movement.jetpackFuel,
        },
      });
      return true;
    }

    default:
      return false;
  }
}

function handleChronosAbilityUsed(data: AbilityUsedMessage, localPlayerId: string | null): boolean {
  const store = useGameStore.getState();
  const isLocalPlayer = data.playerId === localPlayerId;
  const position = data.position ?? store.players.get(data.playerId)?.position ?? store.localPlayer?.position;
  const fallbackStartPosition = data.startPosition ?? position;
  const ownerTeam = resolveOwnerTeam(data);
  const castId = data.castId ?? `${data.abilityId}_${data.playerId}_${data.serverTime ?? Date.now()}`;
  const now = Date.now();

  switch (data.abilityId) {
    case 'chronos_verdant_pulse': {
      const startPosition = resolveObservedStartPosition(
        data,
        localPlayerId,
        fallbackStartPosition
      );
      if (!startPosition) return true;
      triggerObservedRemoteAttack(data, localPlayerId);
      const velocity = data.velocity ?? scaleDirection(normalizeAimDirection(data), CHRONOS_VERDANT_PULSE_SPEED);
      const predictedVisualId = isLocalPlayer
        ? consumePredictedLocalAbilityVisual('chronos_verdant_pulse', data.playerId)
        : null;

      if (isLocalPlayer && !predictedVisualId) {
        triggerChronosPrimaryShotGlow(data.serverTime ?? now);
      }

      if (!predictedVisualId) {
        store.addChronosPulse({
          id: castId,
          position: startPosition,
          velocity,
          impactPosition: data.interceptedByChronosAegis ? data.impactPosition : undefined,
          interceptedByChronosAegis: Boolean(data.interceptedByChronosAegis),
          startTime: now,
          ownerId: data.playerId,
          ownerTeam,
          supercharged: data.supercharged,
          radius: data.radius,
        });
      }
      if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('chronos_verdant_pulse')) {
        playChronosWorldSound('phantomBasic', startPosition, {
          pitch: CHRONOS_VERDANT_PULSE_SHOT_PITCH,
          volume: CHRONOS_VERDANT_PULSE_SHOT_VOLUME,
        });
      }
      return true;
    }

    case 'chronos_lifeline_conduit': {
      const startPosition = resolveObservedStartPosition(
        data,
        localPlayerId,
        fallbackStartPosition
      );
      triggerObservedRemoteAttack(data, localPlayerId);
      const predictedVisualId = isLocalPlayer
        ? consumePredictedLocalAbilityVisual('chronos_lifeline_conduit', data.playerId)
        : null;
      if (isLocalPlayer && !predictedVisualId) {
        triggerChronosLifelineConduitPose(data.serverTime ?? now);
      }
      if (!isLocalPlayer) {
        const releaseDelay = data.releaseAt
          ? Math.max(0, data.releaseAt - (data.serverTime ?? now))
          : CHRONOS_LIFELINE_RELEASE_DELAY_MS;
        startObservedAbilityCastEffect({
          id: `${castId}_cast`,
          playerId: data.playerId,
          abilityId: 'chronos_lifeline_conduit',
          startPosition,
          startTime: now,
          endTime: now + Math.max(160, releaseDelay),
          color: 0x22c55e,
          secondaryColor: 0xbbf7d0,
          scale: 0.96,
        });
      }
      if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('chronos_lifeline_conduit')) {
        playChronosWorldSound('chronosLifeline', startPosition);
      }
      return true;
    }

    case 'chronos_timebreak': {
      const startPosition = resolveObservedStartPosition(
        data,
        localPlayerId,
        fallbackStartPosition
      );
      triggerObservedRemoteAttack(data, localPlayerId);
      const predictedVisualId = isLocalPlayer
        ? consumePredictedLocalAbilityVisual('chronos_timebreak', data.playerId)
        : null;
      if (isLocalPlayer && !predictedVisualId) {
        triggerChronosTimebreakPose(data.serverTime ?? now);
      }

      const releaseTime = data.releaseAt ?? now + CHRONOS_TIMEBREAK_RELEASE_DELAY_MS;
      const releaseDelay = Math.max(0, releaseTime - now);
      const suppressLocalTimebreakCharge = isLocalPlayer && shouldSuppressPredictedLocalAbilitySound('chronos_timebreak');
      if (!suppressLocalTimebreakCharge && releaseDelay > 0) {
        playChronosWorldSound('chronosTimebreakCharge', startPosition, {
          durationMs: releaseDelay,
          fadeOutMs: Math.min(CHRONOS_TIMEBREAK_CHARGE_FADE_OUT_MS, releaseDelay),
        });
      }
      if (!isLocalPlayer && releaseDelay > 0) {
        startObservedAbilityCastEffect({
          id: `${castId}_cast`,
          playerId: data.playerId,
          abilityId: 'chronos_timebreak',
          startPosition,
          startTime: now,
          endTime: now + releaseDelay,
          color: 0xdc2626,
          secondaryColor: 0x22c55e,
          scale: 1.16,
        });
      }

      window.setTimeout(() => {
        stopObservedAbilityCastEffects(data.playerId, 'chronos_timebreak');
        const freshStore = useGameStore.getState();
        const freshLocalPlayerId = freshStore.localPlayer?.id ?? freshStore.playerId;
        const isFreshLocalPlayer = data.playerId === freshLocalPlayerId;
        const caster = isFreshLocalPlayer
          ? freshStore.localPlayer
          : freshStore.players.get(data.playerId);
        const resolvedOrigin = !isFreshLocalPlayer
          ? resolveAbilitySocketOrigin({
            ownerScope: 'remoteBody',
            playerId: data.playerId,
            abilityId: 'chronos_timebreak',
          })
          : null;
        const casterPosition = caster?.position ?? data.position;
        const fallbackEffectPosition = startPosition ?? data.startPosition;
        if (!casterPosition && !resolvedOrigin && !fallbackEffectPosition) return;

        const effectPosition = resolvedOrigin
          ? toPlainPosition(resolvedOrigin.position)
          : fallbackEffectPosition ?? {
            x: casterPosition!.x,
            y: casterPosition!.y + 1.18,
            z: casterPosition!.z,
          };

        addChronosTimebreakEffect({
          id: castId,
          position: effectPosition,
          ownerId: data.playerId,
          ownerTeam: (caster?.team ?? data.ownerTeam) as Team | undefined,
          direction: data.shockwaveDirection ?? data.aimDirection,
          startTime: data.serverTime ?? now,
          releaseTime,
          duration: data.duration,
          radius: data.radius,
        });
        playChronosWorldSound('chronosPush', effectPosition, { volume: 1.05 });
      }, releaseDelay);
      return true;
    }

    case 'chronos_ascendant_paradox': {
      const durationMs = data.durationMs ?? (
        typeof data.duration === 'number'
          ? data.duration * 1000
          : CHRONOS_ASCENDANT_PARADOX_DURATION_MS
      );
      const activatedAt = data.serverTime ?? now;
      const predictedVisualId = isLocalPlayer
        ? consumePredictedLocalAbilityVisual('chronos_ascendant_paradox', data.playerId)
        : null;
      const abilityState = {
        abilityId: 'chronos_ascendant_paradox',
        cooldownRemaining: 0,
        charges: 1,
        isActive: true,
        activatedAt,
      };

      if (!predictedVisualId) {
        triggerChronosAscendantParadoxPose(activatedAt);
      }
      if (!isLocalPlayer) {
        startObservedAbilityCastEffect({
          id: `${castId}_cast`,
          playerId: data.playerId,
          abilityId: 'chronos_ascendant_paradox',
          startPosition: position
            ? { x: position.x, y: position.y + 1.12, z: position.z }
            : undefined,
          startTime: now,
          endTime: now + 650,
          color: 0x22c55e,
          secondaryColor: 0xdc2626,
          scale: 1.22,
        });
      }
      if (position) {
        playChronosWorldSound('chronosAegis', position, { volume: 0.9 });
      }

      if (isLocalPlayer && store.localPlayer) {
        const nextMovement = {
          ...store.localPlayer.movement,
          isGrounded: false,
          isSliding: false,
          slideTimeRemaining: 0,
          isJetpacking: true,
          isGliding: true,
          chronosAscendantStartY: store.localPlayer.movement.chronosAscendantStartY ?? store.localPlayer.position.y,
        };
        if (data.velocity) {
          confirmLocalMovementTransform(store.localPlayer, {
            position,
            velocity: data.velocity,
            movement: nextMovement,
          }, store.localPlayer.lookYaw);
          pushLocalPlayerImpulse({ ...data.velocity, mode: 'set' });
        }
        store.setUltimateEffect(true, 'chronos_ascendant_paradox', activatedAt + durationMs);
        store.updateLocalPlayer({
          ultimateCharge: 0,
          position: position ?? store.localPlayer.position,
          velocity: data.velocity ?? store.localPlayer.velocity,
          movement: nextMovement,
          abilities: {
            ...store.localPlayer.abilities,
            chronos_ascendant_paradox: abilityState,
          },
        });
        return true;
      }

      const player = store.players.get(data.playerId);
      if (player) {
        store.updatePlayer(data.playerId, {
          ...player,
          position: position ?? player.position,
          velocity: data.velocity ?? player.velocity,
          movement: {
            ...player.movement,
            isGrounded: false,
            isSliding: false,
            slideTimeRemaining: 0,
            isJetpacking: true,
            isGliding: true,
            chronosAscendantStartY: player.movement.chronosAscendantStartY ?? player.position.y,
          },
          abilities: {
            ...player.abilities,
            chronos_ascendant_paradox: abilityState,
          },
        });
      }
      return true;
    }

    default:
      return false;
  }
}

/**
 * Sets up combat event handlers (damage, kills)
 */
export function setupCombatHandlers(room: Room) {
  room.onMessage('phantomPrimaryState', measureNetworkMessage('phantomPrimaryState', (data: {
    ammo: number;
    reloading: boolean;
    reloadStartedAt: number;
    reloadUntil: number;
    serverTime: number;
  }) => {
    applyPhantomPrimaryState(data);
  }));

  room.onMessage('chronosAegisDamaged', measureNetworkMessage('chronosAegisDamaged', (data: ChronosAegisDamagedEvent) => {
    const now = Date.now();
    const store = useGameStore.getState();
    const localPlayerId = store.localPlayer?.id ?? store.playerId;
    setChronosAegisVisualState(data.playerId, true, now, data.shieldRatio, {
      renderWorldEffect: data.playerId !== localPlayerId,
    });
    useCombatFeedbackStore.getState().addCombatTextEvent({
      kind: 'shieldDamage',
      amount: data.damage,
      damageType: data.damageType,
      targetId: null,
      position: data.position,
    });
  }));

  room.onMessage('chronosAegisBroken', measureNetworkMessage('chronosAegisBroken', (data: ChronosAegisBrokenEvent) => {
    const now = Date.now();
    setChronosAegisVisualState(data.playerId, false, now, 0);
    addEffect({
      type: 'chronosAegisBreak',
      position: new THREE.Vector3(data.position.x, data.position.y, data.position.z),
      direction: new THREE.Vector3(data.direction.x, data.direction.y, data.direction.z),
      duration: 720,
    });
    playChronosWorldSound('chronosSuperchargedImpact', data.position, {
      volume: 0.86,
      pitch: 1.12,
    });
  }));

  room.onMessage('phantomShieldBroken', measureNetworkMessage('phantomShieldBroken', (data: PhantomShieldBrokenEvent) => {
    const store = useGameStore.getState();
    const localPlayerId = store.localPlayer?.id ?? store.playerId;
    triggerPhantomShieldBreakEffect({
      playerId: data.playerId,
      isLocalPlayer: data.playerId === localPlayerId,
      position: data.position,
      direction: data.direction,
    });
  }));

  room.onMessage('playerDamaged', measureNetworkMessage('playerDamaged', (data: {
    targetId: string;
    damage: number;
    sourceId: string | null;
    damageType: string;
    sourcePosition?: { x: number; y: number; z: number } | null;
    targetPosition?: { x: number; y: number; z: number } | null;
  }) => {
    loggers.network.sample('playerDamaged', 1000, 'player damaged', data.targetId, data.damage, data.damageType);

    const store = useGameStore.getState();
    const localPlayerId = store.localPlayer?.id ?? store.playerId;
    const sourcePlayer = data.sourceId ? store.players.get(data.sourceId) : null;
    const targetPlayer = store.players.get(data.targetId);
    const sourcePosition = data.sourcePosition ?? sourcePlayer?.position ?? null;
    const targetPosition = data.targetPosition ?? targetPlayer?.position ?? null;

    if (data.sourceId === localPlayerId && targetPosition) {
      useCombatFeedbackStore.getState().addCombatTextEvent({
        kind: 'damage',
        amount: data.damage,
        damageType: data.damageType,
        targetId: data.targetId,
        position: targetPosition,
      });
    }

    if (data.sourceId && data.sourceId !== localPlayerId && sourcePosition && targetPosition) {
      const start = new THREE.Vector3(sourcePosition.x, sourcePosition.y + 1.1, sourcePosition.z);
      const end = new THREE.Vector3(targetPosition.x, targetPosition.y + 1.0, targetPosition.z);

      addEffect({
        type: 'grapple',
        position: start,
        endPosition: end,
        duration: 180,
      });
      addEffect({
        type: 'hit',
        position: end,
        duration: 260,
      });
    }
  }));

  room.onMessage('playerHealed', measureNetworkMessage('playerHealed', (data: {
    sourceId: string;
    abilityId: string;
    sourcePosition: { x: number; y: number; z: number };
    targets: Array<{
      targetId: string;
      amount: number;
      newHealth: number;
      position: { x: number; y: number; z: number };
    }>;
    timestamp: number;
  }) => {
    loggers.network.sample('playerHealed', 1000, 'player healed', data.sourceId, data.targets.length, data.abilityId);

    const store = useGameStore.getState();
    const localPlayerId = store.localPlayer?.id ?? store.playerId;
    const combatFeedback = useCombatFeedbackStore.getState();
    for (const target of data.targets) {
      if (target.targetId === store.localPlayer?.id) {
        store.updateLocalPlayer({ health: target.newHealth });
      } else {
        const player = store.players.get(target.targetId);
        if (player) {
          store.updatePlayer(target.targetId, {
            ...player,
            health: target.newHealth,
          });
        }
      }

      if (target.amount > 0) {
        combatFeedback.addCombatTextEvent({
          kind: 'heal',
          amount: target.amount,
          targetId: target.targetId,
          position: target.position,
        });
      }
    }

    const isRemoteSource = data.sourceId !== localPlayerId;
    const isChronosLifeline = data.abilityId === 'chronos_lifeline_conduit';
    const selfHealTarget = isChronosLifeline
      ? data.targets.find((target) => target.targetId === data.sourceId)
      : undefined;

    if (isChronosLifeline) {
      stopObservedAbilityCastEffects(data.sourceId, 'chronos_lifeline_conduit');
    }
    const sourceOrigin = isChronosLifeline
      ? resolveAbilitySocketOrigin({
        ownerScope: isRemoteSource ? 'remoteBody' : 'localViewmodel',
        playerId: isRemoteSource ? data.sourceId : undefined,
        abilityId: 'chronos_lifeline_conduit',
      })
      : null;
    const sourcePosition = isChronosLifeline
      ? offsetChronosOrbVisualPlainPosition(
        sourceOrigin ? toPlainPosition(sourceOrigin.position) : data.sourcePosition,
        resolvePlayerFlatForward(data.sourceId),
        'chronos_lifeline_conduit'
      )
      : sourceOrigin
        ? toPlainPosition(sourceOrigin.position)
        : data.sourcePosition;

    if (selfHealTarget) {
      addChronosSelfHealPulseEffect(
        sourcePosition,
        selfHealTarget.position,
        undefined,
        {
          sourceIsExact: Boolean(sourceOrigin),
          sourceAbilityId: 'chronos_lifeline_conduit',
          sourcePlayerId: isRemoteSource ? data.sourceId : undefined,
        }
      );
    } else {
      addChronosLifelineEffects(
        sourcePosition,
        data.targets.map((target) => ({
          position: target.position,
        })),
        undefined,
        isChronosLifeline
          ? {
            sourceIsExact: Boolean(sourceOrigin),
            sourceAbilityId: 'chronos_lifeline_conduit',
            sourcePlayerId: isRemoteSource ? data.sourceId : undefined,
          }
          : {}
      );
    }
    if (
      isChronosLifeline &&
      (isRemoteSource || !shouldSuppressPredictedLocalAbilitySound('chronos_lifeline_conduit'))
    ) {
      playChronosWorldSound('chronosLifeline', sourcePosition);
    }
  }));

  room.onMessage('playerKilled', measureNetworkMessage('playerKilled', (data: PlayerDeathEvent) => {
    addDeathVisualFromKillEvent(data);

    const players = useGameStore.getState().players;
    useCombatFeedbackStore.getState().addKillFeedEvent({
      killerName: data.killerId ? players.get(data.killerId)?.name ?? 'Unknown' : 'Unknown',
      victimName: players.get(data.victimId)?.name ?? 'Unknown',
    });
  }));

  room.onMessage('abilityUsed', measureNetworkMessage('abilityUsed', (data: AbilityUsedMessage) => {
    const store = useGameStore.getState();
    const localPlayerId = store.localPlayer?.id ?? store.playerId;
    if (handlePhantomAbilityUsed(data, localPlayerId)) return;
    if (handleHookshotAbilityUsed(data, localPlayerId)) return;
    if (handleBlazeAbilityUsed(data, localPlayerId)) return;
    if (handleChronosAbilityUsed(data, localPlayerId)) return;

  }));

  room.onMessage('chronosTimebreakImpulse', measureNetworkMessage('chronosTimebreakImpulse', (data: {
    sourceId: string;
    sourcePosition: { x: number; y: number; z: number };
    impulse: { x: number; y: number; z: number };
  }) => {
    pushLocalPlayerImpulse(data.impulse);
  }));
}

/**
 * Sets up low-rate room metadata polling as a development fallback.
 */
export function setupPollingSync(
  room: Room,
  actions: Pick<GameStoreActions, 'setGamePhase'>
): ReturnType<typeof setInterval> {
  const FALLBACK_POLL_INTERVAL_MS = 250;

  return setInterval(() => {
    if (!room.state) return;

    // Sync phase
    if (room.state.phase) {
      const store = useGameStore.getState();
      const nextMapThemeId = typeof room.state.mapThemeId === 'string'
        ? room.state.mapThemeId as VoxelMapTheme['id']
        : null;
      const nextMapSize = normalizeVoxelMapSizeId(
        typeof room.state.mapSize === 'string' ? room.state.mapSize : DEFAULT_VOXEL_MAP_SIZE_ID
      );
      if (
        typeof room.state.mapSeed === 'number'
        && (
          room.state.mapSeed !== store.mapSeed
          || nextMapThemeId !== store.mapThemeId
          || nextMapSize !== store.mapSize
        )
      ) {
        useGameStore.getState().setMapSeed(room.state.mapSeed);
        useGameStore.getState().setMapThemeId(nextMapThemeId);
        useGameStore.getState().setMapSize(nextMapSize);
        try {
          const preparedMap = prepareVoxelMapCpu({
            seed: room.state.mapSeed,
            themeId: nextMapThemeId,
            mapSize: nextMapSize,
            source: 'match',
          });
          prebuildPreparedVoxelMapGeometry(preparedMap, { frameBudgetMs: 2, label: 'fallback-poll' });
        } catch (error) {
          loggers.network.warn('fallback poll map CPU prep failed', error);
        }
      }

      if (room.state.phase !== store.gamePhase) {
        actions.setGamePhase(room.state.phase as any);
      }
      if (isGameplayMode(room.state.gameplayMode) && room.state.gameplayMode !== store.gameplayMode) {
        useGameStore.setState({ gameplayMode: room.state.gameplayMode });
      }
    }
  }, FALLBACK_POLL_INTERVAL_MS);
}
