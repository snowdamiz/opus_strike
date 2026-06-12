import type { Room } from 'colyseus.js';
import * as THREE from 'three';
import {
  ABILITY_DEFINITIONS,
  CHRONOS_ASCENDANT_PARADOX_DURATION_MS,
  CHRONOS_LIFELINE_RELEASE_DELAY_MS,
  CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
  CHRONOS_VERDANT_PULSE_SPEED,
  VOID_RAY_CHARGE_TIME,
  type PublicRankSnapshot,
} from '@voxel-strike/shared';
import { useGameStore } from '../store/gameStore';
import { useCombatFeedbackStore } from '../store/combatFeedbackStore';
import {
  pushLocalPlayerImpulse,
  addRemoteTransformSnapshot,
  setChronosAegisVisualState,
  setPlayerVisualPosition,
  setPlayerVisualRotation,
  triggerRemotePlayerAttack,
  visualStore,
} from '../store/visualStore';
import { applySelfMovementAuthority, confirmLocalMovementTransform } from '../movement/localPrediction';
import { recordMovementTraceAuthorityAck } from '../anticheat/movementTraceRecorder';
import { addEffect } from '../components/game/Effects';
import { triggerAirStrike, triggerRocketJumpExplosion } from '../components/game/BlazeEffects';
import { triggerBlinkEffect, triggerShadowArrival } from '../components/game/PhantomEffects';
import {
  startObservedAbilityCastEffect,
  stopObservedAbilityCastEffects,
} from '../components/game/ObservedAbilityCastEffects';
import { triggerTeleportEffect } from '../components/ui/TeleportEffects';
import { addChronosLifelineEffects } from '../components/game/chronos/lifeline';
import { addChronosTimebreakEffect } from '../components/game/chronos/timebreak';
import {
  BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
  triggerBlazeRocketJumpStaffSlam,
} from '../viewmodel/blazePose';
import {
  CHRONOS_PRIMARY_ORB_SOCKET_NAME,
  triggerChronosAscendantParadoxPose,
  triggerChronosLifelineConduitPose,
  triggerChronosPrimaryShotGlow,
  triggerChronosTimebreakPose,
} from '../viewmodel/chronosPose';
import { HOOKSHOT_HOOK_SOCKET_NAMES } from '../viewmodel/hookshotPose';
import {
  PHANTOM_PRIMARY_PALM_SOCKET_NAMES,
  PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
} from '../viewmodel/phantomPrimaryPose';
import { readRemoteModelSocketAny } from '../viewmodel/remoteModelSocketRegistry';
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
  CHRONOS_VERDANT_PULSE_SHOT_PITCH,
  CHRONOS_VERDANT_PULSE_SHOT_VOLUME,
  playSharedSound,
  type SoundName,
} from '../hooks/useAudio';
import { recordNetworkMessage } from '../utils/perfMarks';
import { loggers } from '../utils/logger';
import { prepareVoxelMapCpu } from '../utils/mapWarmup/mapPrepCache';
import type {
  BotDifficulty,
  HeroId,
  MatchSnapshotMessage,
  Player,
  PlayerMovementState,
  PlayerTransformsMessage,
  PlayerVitalsMessage,
  PlayerVitalsSnapshot,
  QuantizedPlayerTransform,
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
let lastLocalPhantomReloadSoundKey = '';
let hasReceivedSelfMovementAuthority = false;
const HOOKSHOT_SHOT_CLIP_MS = 250;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Creates a default movement state object for a player
 */
export function createDefaultMovement() {
  return {
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
    jetpackFuel: 100,
    isGliding: false,
  };
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
    position: {
      x: schemaPlayer.position?.x ?? 0,
      y: schemaPlayer.position?.y ?? 1,
      z: schemaPlayer.position?.z ?? 0,
    },
    velocity: {
      x: schemaPlayer.velocity?.x ?? 0,
      y: schemaPlayer.velocity?.y ?? 0,
      z: schemaPlayer.velocity?.z ?? 0,
    },
    lookYaw: schemaPlayer.lookYaw ?? 0,
    lookPitch: schemaPlayer.lookPitch ?? 0,
    health: schemaPlayer.health ?? 100,
    maxHealth: schemaPlayer.maxHealth ?? 100,
    ultimateCharge: schemaPlayer.ultimateCharge ?? 0,
    movement: normalizeMovementState(schemaPlayer.movement),
    abilities: {},
    hasFlag: schemaPlayer.hasFlag || false,
    respawnTime: null,
    spawnProtectionUntil: null,
    stats: schemaPlayer.stats || {
      kills: schemaPlayer.kills ?? 0,
      deaths: schemaPlayer.deaths ?? 0,
      assists: schemaPlayer.assists ?? 0,
      flagCaptures: schemaPlayer.flagCaptures ?? 0,
      flagReturns: schemaPlayer.flagReturns ?? 0,
    },
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
    movement: createDefaultMovement(),
    abilities: {},
    hasFlag: false,
    respawnTime: null,
    spawnProtectionUntil: null,
    stats: createDefaultStats(),
  };
}

function getSchemaPosition(schemaPlayer: any): { x: number; y: number; z: number } | null {
  if (!schemaPlayer.position) return null;

  return {
    x: schemaPlayer.position.x ?? 0,
    y: schemaPlayer.position.y ?? 1,
    z: schemaPlayer.position.z ?? 0,
  };
}

function getSchemaVelocity(schemaPlayer: any, fallback: Player['velocity']): Player['velocity'] {
  if (!schemaPlayer.velocity) return fallback;

  return {
    x: schemaPlayer.velocity.x ?? fallback.x,
    y: schemaPlayer.velocity.y ?? fallback.y,
    z: schemaPlayer.velocity.z ?? fallback.z,
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
  setPlayerVisualPosition(player.id, player.position);
  setPlayerVisualRotation(player.id, player.lookYaw);
}

function dequantizeTransform(transform: QuantizedPlayerTransform) {
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
  transform: QuantizedPlayerTransform,
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

function createPlayerFromVitals(vitals: PlayerVitalsSnapshot, existing?: Player): Player {
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
    movement: normalizeMovementState(vitals.movement, existing?.movement),
    abilities: vitals.abilities || existing?.abilities || {},
    hasFlag: vitals.hasFlag,
    respawnTime: vitals.respawnTime,
    spawnProtectionUntil: vitals.spawnProtectionUntil,
    stats: vitals.stats || existing?.stats || createDefaultStats(),
  };
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
      const nextPosition = getSchemaPosition(schemaPlayer);
      const shouldSyncPosition = nextPosition
        ? shouldSyncLocalPosition(store.localPlayer, nextState, nextPosition)
        : false;
      const updated = {
        ...store.localPlayer,
        heroId: schemaPlayer.heroId || store.localPlayer.heroId,
        team: schemaPlayer.team || store.localPlayer.team,
        isBot: Boolean(schemaPlayer.isBot ?? store.localPlayer.isBot),
        botDifficulty: schemaPlayer.botDifficulty || store.localPlayer.botDifficulty,
        botProfileId: schemaPlayer.botProfileId || store.localPlayer.botProfileId,
        rank: normalizeRankSnapshot(schemaPlayer, store.localPlayer.rank),
        health: schemaPlayer.health ?? store.localPlayer.health,
        maxHealth: schemaPlayer.maxHealth ?? store.localPlayer.maxHealth,
        state: nextState,
        position: shouldSyncPosition ? nextPosition! : store.localPlayer.position,
        velocity: shouldSyncPosition ? getSchemaVelocity(schemaPlayer, store.localPlayer.velocity) : store.localPlayer.velocity,
        lookYaw: schemaPlayer.lookYaw ?? store.localPlayer.lookYaw,
        lookPitch: schemaPlayer.lookPitch ?? store.localPlayer.lookPitch,
        // Explicitly preserve ultimateCharge - it's managed by playerVitals.
        ultimateCharge: store.localPlayer.ultimateCharge,
        movement: normalizeMovementState(schemaPlayer.movement, store.localPlayer.movement),
      };
      actions.setLocalPlayer(updated);
      if (shouldSyncPosition) {
        syncLocalVisualPosition(updated);
      }
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

/**
 * Processes a player during polling sync
 */
export function processPlayerDuringPoll(
  schemaPlayer: any,
  id: string,
  sessionId: string,
  localPlayerName: string,
  actions: Pick<GameStoreActions, 'setLocalPlayer' | 'updatePlayer'>
) {
  if (id === sessionId) {
    const freshStore = useGameStore.getState();
    if (freshStore.localPlayer) {
      const nextState = schemaPlayer.state || freshStore.localPlayer.state;
      const nextPosition = getSchemaPosition(schemaPlayer);
      const shouldSyncPosition = nextPosition
        ? shouldSyncLocalPosition(freshStore.localPlayer, nextState, nextPosition)
        : false;
      const updated = {
        ...freshStore.localPlayer,
        heroId: schemaPlayer.heroId || freshStore.localPlayer.heroId,
        team: schemaPlayer.team || freshStore.localPlayer.team,
        isBot: Boolean(schemaPlayer.isBot ?? freshStore.localPlayer.isBot),
        botDifficulty: schemaPlayer.botDifficulty || freshStore.localPlayer.botDifficulty,
        botProfileId: schemaPlayer.botProfileId || freshStore.localPlayer.botProfileId,
        rank: normalizeRankSnapshot(schemaPlayer, freshStore.localPlayer.rank),
        health: schemaPlayer.health ?? freshStore.localPlayer.health,
        maxHealth: schemaPlayer.maxHealth ?? freshStore.localPlayer.maxHealth,
        state: nextState,
        position: shouldSyncPosition ? nextPosition! : freshStore.localPlayer.position,
        velocity: shouldSyncPosition ? getSchemaVelocity(schemaPlayer, freshStore.localPlayer.velocity) : freshStore.localPlayer.velocity,
        lookYaw: schemaPlayer.lookYaw ?? freshStore.localPlayer.lookYaw,
        lookPitch: schemaPlayer.lookPitch ?? freshStore.localPlayer.lookPitch,
        ultimateCharge: freshStore.localPlayer.ultimateCharge,
        movement: normalizeMovementState(schemaPlayer.movement, freshStore.localPlayer.movement),
      };
      actions.setLocalPlayer(updated);
      if (shouldSyncPosition) {
        syncLocalVisualPosition(updated);
      }
    }
    return;
  }

  // Skip ghost players
  if (schemaPlayer.name === localPlayerName) {
    loggers.network.sample('poll-ghost', 5000, 'ignoring ghost polled player', schemaPlayer.name, id);
    return;
  }

  const otherStore = useGameStore.getState();
  const existingPlayer = otherStore.players.get(id);

  if (!existingPlayer) {
    const playerData = createPlayerFromSchema(schemaPlayer, id);
    actions.updatePlayer(id, playerData);
  } else {
    const positionUpdated = {
      ...existingPlayer,
      position: {
        x: schemaPlayer.position?.x ?? existingPlayer.position.x,
        y: schemaPlayer.position?.y ?? existingPlayer.position.y,
        z: schemaPlayer.position?.z ?? existingPlayer.position.z,
      },
      velocity: {
        x: schemaPlayer.velocity?.x ?? existingPlayer.velocity.x,
        y: schemaPlayer.velocity?.y ?? existingPlayer.velocity.y,
        z: schemaPlayer.velocity?.z ?? existingPlayer.velocity.z,
      },
      lookYaw: schemaPlayer.lookYaw ?? existingPlayer.lookYaw,
      lookPitch: schemaPlayer.lookPitch ?? existingPlayer.lookPitch,
      state: schemaPlayer.state || existingPlayer.state,
      heroId: schemaPlayer.heroId || existingPlayer.heroId,
      team: schemaPlayer.team || existingPlayer.team,
      isReady: schemaPlayer.isReady ?? existingPlayer.isReady,
      isBot: Boolean(schemaPlayer.isBot ?? existingPlayer.isBot),
      botDifficulty: schemaPlayer.botDifficulty || existingPlayer.botDifficulty,
      botProfileId: schemaPlayer.botProfileId || existingPlayer.botProfileId,
      rank: normalizeRankSnapshot(schemaPlayer, existingPlayer.rank),
      health: schemaPlayer.health ?? existingPlayer.health,
      maxHealth: schemaPlayer.maxHealth ?? existingPlayer.maxHealth,
      ultimateCharge: schemaPlayer.ultimateCharge ?? existingPlayer.ultimateCharge,
      hasFlag: schemaPlayer.hasFlag ?? existingPlayer.hasFlag,
      stats: schemaPlayer.stats || existingPlayer.stats,
      movement: normalizeMovementState(schemaPlayer.movement, existingPlayer.movement),
    };
    actions.updatePlayer(id, positionUpdated);
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
  room.onMessage('playerJoined', (data: {
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
    loggers.network.debug('player joined message', data.playerName, data.playerId);

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
          movement: createDefaultMovement(),
          abilities: {},
          hasFlag: false,
          respawnTime: null,
          spawnProtectionUntil: null,
          stats: createDefaultStats(),
        };
        updatePlayer(data.playerId, newPlayer);
      }
    }
  });
}

export function setupPlayerTransformsHandler(
  room: Room,
  sessionId: string,
  localPlayerName: string,
  actions: Pick<GameStoreActions, 'setLocalPlayer'>
) {
  room.onMessage('playerTransforms', (data: PlayerTransformsMessage) => {
    recordNetworkMessage('playerTransforms', data);
    useGameStore.setState({
      tick: data.tick,
      serverTime: data.serverTime,
    });

    const store = useGameStore.getState();

    for (const transform of data.players) {
      const decoded = dequantizeTransform(transform);

      if (transform.id === sessionId) {
        if (!hasReceivedSelfMovementAuthority) {
          const localPlayer = useGameStore.getState().localPlayer;
          if (!localPlayer) continue;

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
          }
        }

        // Local correction is private and sequence-aware; shared transform entries
        // are retained only for migration and ignored during normal prediction.
        continue;
      }

      const existingPlayer = store.players.get(transform.id);
      if (!existingPlayer) continue;
      if (existingPlayer.name === localPlayerName) {
        loggers.network.sample('ghost-transform', 5000, 'ignoring ghost transform', transform.id);
        continue;
      }

      const wasGrappling = existingPlayer.movement.isGrappling;
      const nextMovement = movementFromBits(transform, existingPlayer.movement);
      existingPlayer.position = decoded.position;
      existingPlayer.velocity = decoded.velocity;
      existingPlayer.lookYaw = decoded.lookYaw;
      existingPlayer.lookPitch = decoded.lookPitch;
      existingPlayer.movement = nextMovement;
      if (wasGrappling && !nextMovement.isGrappling) {
        const freshStore = useGameStore.getState();
        for (const line of freshStore.grappleLines) {
          if (line.ownerId === transform.id) {
            freshStore.removeGrappleLine(line.id);
          }
        }
      }
      addRemoteTransformSnapshot(transform.id, {
        serverTick: data.tick,
        serverTime: data.serverTime,
        position: decoded.position,
        velocity: decoded.velocity,
        lookYaw: decoded.lookYaw,
        lookPitch: decoded.lookPitch,
        movementBits: transform.movementBits,
        wallRunSide: transform.wallRunSide,
        movementEpoch: transform.movementEpoch,
      });
      setPlayerVisualRotation(transform.id, decoded.lookYaw);
      const chronosAegisActive = existingPlayer.heroId === 'chronos' && Boolean(transform.movementBits & MOVEMENT_BIT_CHRONOS_AEGIS);
      const previousChronosAegis = visualStore.getState().chronosAegisStates.get(transform.id);
      if (chronosAegisActive && !previousChronosAegis?.active) {
        playChronosWorldSound('chronosAegis', decoded.position);
      }
      setChronosAegisVisualState(
        transform.id,
        chronosAegisActive,
        Date.now()
      );
    }
  });
}

export function setupSelfMovementAuthorityHandler(
  room: Room,
  actions: Pick<GameStoreActions, 'setLocalPlayer'>
) {
  hasReceivedSelfMovementAuthority = false;

  room.onMessage('selfMovementAuthority', (authority: SelfMovementAuthority) => {
    hasReceivedSelfMovementAuthority = true;
    recordNetworkMessage('selfMovementAuthority', authority);
    recordMovementTraceAuthorityAck(authority);
    const store = useGameStore.getState();
    const localPlayer = store.localPlayer;
    if (!localPlayer) return;

    const { result, state } = applySelfMovementAuthority(localPlayer, authority);
    actions.setLocalPlayer({
      ...localPlayer,
      position: state.position,
      velocity: state.velocity,
      lookYaw: authority.lookYaw,
      lookPitch: authority.lookPitch,
      movement: state.movement,
    });

    if (result.hardCorrection) {
      loggers.network.sample('local-hard-correction', 1500, 'hard movement correction', {
        ackSeq: result.ackSeq,
        reason: authority.correctionReason,
        positionError: result.positionError,
      });
    } else if (result.corrected) {
      loggers.network.sample('local-movement-correction', 1500, 'movement correction', {
        ackSeq: result.ackSeq,
        positionError: result.positionError,
        replayedCommands: result.replayedCommands,
      });
    }
  });
}

export function setupPlayerVitalsHandler(
  room: Room,
  sessionId: string,
  localPlayerName: string,
  actions: Pick<GameStoreActions, 'setLocalPlayer' | 'updatePlayer' | 'removePlayer'>
) {
  room.onMessage('playerVitals', (data: PlayerVitalsMessage) => {
    recordNetworkMessage('playerVitals', data);
    useGameStore.setState({
      tick: data.tick,
      serverTime: data.serverTime,
    });

    for (const removedId of data.removedPlayerIds || []) {
      stopRemotePhantomCharge(removedId);
      stopObservedAbilityCastEffects(removedId);
      actions.removePlayer(removedId);
    }

    for (const vitals of data.players) {
      if (vitals.id !== sessionId && vitals.name === localPlayerName) {
        loggers.network.sample('ghost-vitals', 5000, 'ignoring ghost vitals', vitals.id);
        continue;
      }

      const store = useGameStore.getState();
      if (vitals.id === sessionId) {
        const existing = store.localPlayer || store.players.get(vitals.id);
        const next = createPlayerFromVitals(vitals, existing || undefined);
        actions.setLocalPlayer(next);
        if (!existing) {
          syncLocalVisualPosition(next);
        }
        continue;
      }

      const existing = store.players.get(vitals.id);
      const next = createPlayerFromVitals(vitals, existing);
      actions.updatePlayer(vitals.id, next);
    }
  });
}

export function setupMatchSnapshotHandler(room: Room) {
  room.onMessage('matchSnapshot', (data: MatchSnapshotMessage) => {
    recordNetworkMessage('matchSnapshot', data);
    const store = useGameStore.getState();
    useGameStore.setState({
      tick: data.tick,
      serverTime: data.serverTime,
      mapSeed: data.mapSeed,
      gamePhase: data.phase,
      redScore: data.redScore,
      blueScore: data.blueScore,
      redFlag: data.redFlag ?? store.redFlag,
      blueFlag: data.blueFlag ?? store.blueFlag,
      roundTimeRemaining: data.roundTimeRemaining,
      phaseEndTime: data.phaseEndTime,
    });
  });
}

/**
 * Sets up void zone event handlers
 */
export function setupVoidZoneHandlers(room: Room, sessionId: string) {
  room.onMessage('voidZoneCreated', (data: {
    id: string;
    position: { x: number; y: number; z: number };
    radius: number;
    duration: number;
    startTime: number;
    ownerId: string;
    ownerTeam: 'red' | 'blue';
  }) => {
    loggers.effects.debug('void zone created by', data.ownerId);
    useGameStore.getState().addVoidZone(data);
  });

  room.onMessage('voidZoneExpired', (data: { id: string }) => {
    loggers.effects.debug('void zone expired', data.id);
    useGameStore.getState().removeVoidZone(data.id);
  });
}

interface AbilityUsedMessage {
  playerId: string;
  abilityId: string;
  success?: boolean;
  castId?: string;
  position?: { x: number; y: number; z: number };
  startPosition?: { x: number; y: number; z: number };
  targetPosition?: { x: number; y: number; z: number };
  targetIds?: string[];
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

function socketNamesForSide(
  sockets: Readonly<Record<-1 | 1, string>>,
  side: -1 | 1 | undefined
): readonly string[] {
  return side ? [sockets[side]] : [sockets[1], sockets[-1]];
}

function resolveObservedStartPosition(
  data: AbilityUsedMessage,
  localPlayerId: string | null,
  fallback: { x: number; y: number; z: number } | undefined,
  socketNames: readonly string[]
): { x: number; y: number; z: number } | undefined {
  if (data.playerId !== localPlayerId) {
    const socketPose = readRemoteModelSocketAny(data.playerId, socketNames);
    if (socketPose) return toPlainPosition(socketPose.position);
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
  options: { durationMs?: number; fadeOutMs?: number; volume?: number; pitch?: number } = {}
): void {
  void playSharedSound(sound, {
    position,
    durationMs: options.durationMs,
    fadeOutMs: options.fadeOutMs,
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
  const abilities = {
    ...player.abilities,
    [data.abilityId]: {
      abilityId: data.abilityId,
      cooldownRemaining: abilityDef.cooldown ?? existingAbility?.cooldownRemaining ?? 0,
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
      store.setUltimateEffect(true, 'phantom_veil', Date.now() + durationMs);
    }
    return;
  }

  store.updatePlayer(data.playerId, {
    ...player,
    abilities,
  });
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
        fallbackStartPosition,
        socketNamesForSide(PHANTOM_PRIMARY_PALM_SOCKET_NAMES, data.launchSide)
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
        fallbackStartPosition,
        [PHANTOM_VOID_RAY_ORB_SOCKET_NAME]
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
          socketName: PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
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
        fallbackStartPosition,
        [PHANTOM_VOID_RAY_ORB_SOCKET_NAME]
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
        if (isLocalPlayer) {
          applyLocalPhantomBlinkConfirmation(data, position, normalizeAimDirection(data));
          triggerTeleportEffect('blink');
          if (!shouldSuppressPredictedLocalAbilitySound('phantom_blink')) {
            playPhantomWorldSound('phantomBlink', undefined, { durationMs: 900, volume: 1.1 });
          }
        } else {
          playPhantomWorldSound('phantomBlink', fallbackStartPosition, { durationMs: 900, volume: 1.1 });
        }
        triggerBlinkEffect(fallbackStartPosition, position);
      }
      return true;
    }

    case 'phantom_shadowstep':
      if (!isLocalPlayer && position) {
        triggerShadowArrival(position);
        playPhantomWorldSound('phantomShadowStep', position);
      }
      return true;

    case 'phantom_personal_shield':
      applyConfirmedPhantomActiveAbility(data);
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
        fallbackStartPosition,
        socketNamesForSide(HOOKSHOT_HOOK_SOCKET_NAMES, data.launchSide)
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
        fallbackStartPosition,
        socketNamesForSide(HOOKSHOT_HOOK_SOCKET_NAMES, data.launchSide)
      );
      if (!startPosition) return true;
      triggerObservedRemoteAttack(data, localPlayerId, launchSide);
      const velocity = data.velocity ?? scaleDirection(normalizeAimDirection(data), DRAG_HOOK_SPEED);
      const predictedVisualId = isLocalPlayer
        ? consumePredictedLocalAbilityVisual('hookshot_heavy_attack', data.playerId, { launchSide: data.launchSide })
        : null;
      if (!predictedVisualId) {
        store.addDragHook({
          id: castId,
          position: startPosition,
          velocity,
          startTime: now,
          ownerId: data.playerId,
          ownerTeam,
          state: 'flying',
          startPosition,
          launchSide: data.launchSide,
          launchYaw: data.launchYaw,
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
        fallbackStartPosition,
        socketNamesForSide(HOOKSHOT_HOOK_SOCKET_NAMES, data.launchSide)
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
        fallbackStartPosition,
        []
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
          wallSegments: [],
        });
      }
      return true;
    }

    case 'hookshot_grapple_trap': {
      const startPosition = resolveObservedStartPosition(
        data,
        localPlayerId,
        fallbackStartPosition,
        socketNamesForSide(HOOKSHOT_HOOK_SOCKET_NAMES, data.launchSide)
      );
      if (!startPosition || !targetPosition) return true;
      triggerObservedRemoteAttack(data, localPlayerId, data.launchSide);
      const predictedVisualId = isLocalPlayer
        ? consumePredictedLocalAbilityVisual('hookshot_grapple_trap', data.playerId)
        : null;
      if (!predictedVisualId) {
        store.addGrappleTrap({
          id: castId,
          position: targetPosition,
          startPosition,
          velocity: data.velocity,
          startTime: now,
          duration: data.duration ?? 8,
          ownerId: data.playerId,
          ownerTeam,
          radius: data.radius ?? 8,
          hookedPlayers: [],
        });
      }
      if (isLocalPlayer) {
        store.updateLocalPlayer({ ultimateCharge: 0 });
      }
      if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('hookshot_grapple_trap')) {
        playHookshotShotSound(startPosition);
        playHookshotWorldSound('hookshotTrap', startPosition, { volume: 1.15 });
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
        fallbackStartPosition,
        [BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME]
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
        fallbackStartPosition,
        [BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME]
      );
      if (!startPosition || !targetPosition) return true;
      triggerObservedRemoteAttack(data, localPlayerId);
      const impactDelay = data.impactTime
        ? Math.max(0, data.impactTime - (data.serverTime ?? now))
        : BLAZE_BOMB_FALL_DURATION;
      const impactTime = now + impactDelay;
      store.addBomb({
        id: castId,
        targetPosition,
        startPosition,
        startTime: now,
        impactTime,
        ownerId: data.playerId,
        ownerTeam,
        hasExploded: false,
      });
      playBlazeWorldSound('blazeBombTarget', startPosition);
      playBlazeWorldSound('blazeBombFall', startPosition, {
        durationMs: impactDelay,
        fadeOutMs: Math.min(200, impactDelay),
      });
      window.setTimeout(() => {
        playBlazeWorldSound('blazeBombExplode', targetPosition, { volume: 1.05 });
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
        triggerAirStrike(position);
        if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('blaze_airstrike')) {
          playBlazeWorldSound('blazeAirstrike', position);
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
        fallbackStartPosition,
        [CHRONOS_PRIMARY_ORB_SOCKET_NAME]
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
        fallbackStartPosition,
        [CHRONOS_PRIMARY_ORB_SOCKET_NAME]
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
          socketName: CHRONOS_PRIMARY_ORB_SOCKET_NAME,
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
        fallbackStartPosition,
        [CHRONOS_PRIMARY_ORB_SOCKET_NAME]
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
          socketName: CHRONOS_PRIMARY_ORB_SOCKET_NAME,
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
        const socketPose = !isFreshLocalPlayer
          ? readRemoteModelSocketAny(data.playerId, [CHRONOS_PRIMARY_ORB_SOCKET_NAME])
          : null;
        const casterPosition = caster?.position ?? data.position;
        const fallbackEffectPosition = startPosition ?? data.startPosition;
        if (!casterPosition && !socketPose && !fallbackEffectPosition) return;

        const effectPosition = socketPose
          ? toPlainPosition(socketPose.position)
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
          socketName: CHRONOS_PRIMARY_ORB_SOCKET_NAME,
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
  room.onMessage('phantomPrimaryState', (data: {
    ammo: number;
    reloading: boolean;
    reloadStartedAt: number;
    reloadUntil: number;
    serverTime: number;
  }) => {
    applyPhantomPrimaryState(data);
  });

  room.onMessage('playerDamaged', (data: {
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
    if (data.sourceId === localPlayerId) {
      useCombatFeedbackStore.getState().addDamageNumber({
        damage: data.damage,
        damageType: data.damageType,
      });
    }

    const sourcePlayer = data.sourceId ? store.players.get(data.sourceId) : null;
    const targetPlayer = store.players.get(data.targetId);
    const sourcePosition = data.sourcePosition ?? sourcePlayer?.position ?? null;
    const targetPosition = data.targetPosition ?? targetPlayer?.position ?? null;

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
  });

  room.onMessage('playerHealed', (data: {
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
    for (const target of data.targets) {
      if (target.targetId === store.localPlayer?.id) {
        store.updateLocalPlayer({ health: target.newHealth });
        continue;
      }

      const player = store.players.get(target.targetId);
      if (player) {
        store.updatePlayer(target.targetId, {
          ...player,
          health: target.newHealth,
        });
      }
    }

    const isRemoteSource = data.sourceId !== localPlayerId;
    if (data.abilityId === 'chronos_lifeline_conduit') {
      stopObservedAbilityCastEffects(data.sourceId, 'chronos_lifeline_conduit');
    }
    const sourceSocketPose = isRemoteSource
      ? readRemoteModelSocketAny(data.sourceId, [CHRONOS_PRIMARY_ORB_SOCKET_NAME])
      : null;
    const sourcePosition = sourceSocketPose
      ? toPlainPosition(sourceSocketPose.position)
      : data.sourcePosition;

    addChronosLifelineEffects(
      sourcePosition,
      data.targets.map((target) => ({
        position: target.position,
      })),
      undefined,
      isRemoteSource
        ? {
          sourceIsExact: Boolean(sourceSocketPose),
          sourceSocketName: CHRONOS_PRIMARY_ORB_SOCKET_NAME,
          sourcePlayerId: data.sourceId,
        }
        : {}
    );
    if (
      data.abilityId === 'chronos_lifeline_conduit' &&
      (isRemoteSource || !shouldSuppressPredictedLocalAbilitySound('chronos_lifeline_conduit'))
    ) {
      playChronosWorldSound('chronosLifeline', sourcePosition);
    }
  });

  room.onMessage('playerKilled', (data: {
    victimId: string;
    killerId: string;
    position: { x: number; y: number; z: number };
  }) => {
    loggers.network.debug('player killed', data.victimId, data.killerId);

    const players = useGameStore.getState().players;
    useCombatFeedbackStore.getState().addKillFeedEvent({
      killerName: players.get(data.killerId)?.name ?? 'Unknown',
      victimName: players.get(data.victimId)?.name ?? 'Unknown',
    });
  });

  room.onMessage('abilityUsed', (data: AbilityUsedMessage) => {
    loggers.network.debug('ability used', data.abilityId, data.playerId, data.success);

    const store = useGameStore.getState();
    const localPlayerId = store.localPlayer?.id ?? store.playerId;
    if (handlePhantomAbilityUsed(data, localPlayerId)) return;
    if (handleHookshotAbilityUsed(data, localPlayerId)) return;
    if (handleBlazeAbilityUsed(data, localPlayerId)) return;
    if (handleChronosAbilityUsed(data, localPlayerId)) return;

  });

  room.onMessage('chronosTimebreakImpulse', (data: {
    sourceId: string;
    sourcePosition: { x: number; y: number; z: number };
    impulse: { x: number; y: number; z: number };
  }) => {
    pushLocalPlayerImpulse(data.impulse);
  });
}

/**
 * Sets up low-rate schema polling as a development fallback for explicit message streams.
 */
export function setupPollingSync(
  room: Room,
  sessionId: string,
  localPlayerName: string,
  actions: Pick<GameStoreActions, 'setLocalPlayer' | 'updatePlayer' | 'setGamePhase'>
): ReturnType<typeof setInterval> {
  const FALLBACK_POLL_INTERVAL_MS = 250;
  const GHOST_CLEANUP_EVERY_POLLS = 4;
  let lastLoggedPlayerCount = -1;
  let pollCount = 0;

  return setInterval(() => {
    if (!room.state) return;
    pollCount++;

    // Sync phase
    if (room.state.phase) {
      const store = useGameStore.getState();
      if (typeof room.state.mapSeed === 'number' && room.state.mapSeed !== store.mapSeed) {
        useGameStore.getState().setMapSeed(room.state.mapSeed);
        try {
          prepareVoxelMapCpu({ seed: room.state.mapSeed, source: 'match' });
        } catch (error) {
          loggers.network.warn('fallback poll map CPU prep failed', error);
        }
      }

      if (room.state.phase !== store.gamePhase) {
        loggers.network.debug('phase synced from fallback poll', room.state.phase);
        actions.setGamePhase(room.state.phase as any);
      }
    }

    // Sync all players
    if (room.state.players) {
      const playersMap = room.state.players as any;
      let serverPlayerCount = 0;

      const iterateMap = (forEach: (player: any, id: string) => void) => {
        if (playersMap.$items instanceof Map) {
          playersMap.$items.forEach(forEach);
        } else if (typeof playersMap.forEach === 'function') {
          try {
            playersMap.forEach(forEach);
          } catch {
            // Silent fail
          }
        }
      };

      iterateMap((schemaPlayer: any, id: string) => {
        serverPlayerCount++;
        processPlayerDuringPoll(schemaPlayer, id, sessionId, localPlayerName, actions);
      });

      if (serverPlayerCount !== lastLoggedPlayerCount || pollCount % 100 === 1) {
        loggers.network.sample('poll-count', 5000, `fallback poll #${pollCount}: server=${serverPlayerCount} players`);
        lastLoggedPlayerCount = serverPlayerCount;
      }

      // Periodic ghost cleanup at roughly 1Hz while fallback polling is enabled.
      if (pollCount % GHOST_CLEANUP_EVERY_POLLS === 0) {
        useGameStore.getState().cleanupGhostPlayers();
      }
    }
  }, FALLBACK_POLL_INTERVAL_MS);
}
