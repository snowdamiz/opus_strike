import type { Room } from 'colyseus.js';
import * as THREE from 'three';
import {
  ABILITY_DEFINITIONS,
  CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
  CHRONOS_VERDANT_PULSE_SPEED,
} from '@voxel-strike/shared';
import { useGameStore } from '../store/gameStore';
import { useCombatFeedbackStore } from '../store/combatFeedbackStore';
import {
  pushLocalPlayerImpulse,
  addRemoteTransformSnapshot,
  setChronosAegisVisualState,
  setPlayerVisualPosition,
  setPlayerVisualRotation,
  visualStore,
} from '../store/visualStore';
import { applySelfMovementAuthority, confirmLocalMovementTransform } from '../movement/localPrediction';
import { addEffect } from '../components/game/Effects';
import { triggerAirStrike, triggerRocketJumpExplosion } from '../components/game/BlazeEffects';
import { triggerBlinkEffect, triggerShadowArrival } from '../components/game/PhantomEffects';
import { triggerTeleportEffect } from '../components/ui/TeleportEffects';
import { addChronosLifelineEffects } from '../components/game/chronos/lifeline';
import { addChronosTimebreakEffect } from '../components/game/chronos/timebreak';
import { triggerBlazeRocketJumpStaffSlam } from '../viewmodel/blazePose';
import {
  triggerChronosLifelineConduitPose,
  triggerChronosPrimaryShotGlow,
  triggerChronosTimebreakPose,
} from '../viewmodel/chronosPose';
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
import { playSharedSound, type SoundName } from '../hooks/useAudio';
import { recordNetworkMessage } from '../utils/perfMarks';
import { loggers } from '../utils/logger';
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
        health: schemaPlayer.health ?? store.localPlayer.health,
        maxHealth: schemaPlayer.maxHealth ?? store.localPlayer.maxHealth,
        state: nextState,
        position: shouldSyncPosition ? nextPosition! : store.localPlayer.position,
        velocity: shouldSyncPosition ? getSchemaVelocity(schemaPlayer, store.localPlayer.velocity) : store.localPlayer.velocity,
        lookYaw: schemaPlayer.lookYaw ?? store.localPlayer.lookYaw,
        lookPitch: schemaPlayer.lookPitch ?? store.localPlayer.lookPitch,
        // Explicitly preserve ultimateCharge - it's managed by playerStates message
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
      if (!currentStore.players.has(data.playerId)) {
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
 * Sets up the playerStates message handler
 */
export function setupPlayerStatesHandler(
  room: Room,
  sessionId: string,
  localPlayerName: string,
  actions: Pick<GameStoreActions, 'setLocalPlayer' | 'updatePlayer'>
) {
  room.onMessage('playerStates', (data: {
    players: any[];
    mapSeed?: number;
    redScore?: number;
    blueScore?: number;
    redFlag?: { position: { x: number; y: number; z: number }; carrierId: string | null; isAtBase: boolean };
    blueFlag?: { position: { x: number; y: number; z: number }; carrierId: string | null; isAtBase: boolean };
    roundTimeRemaining?: number;
  }) => {
    recordNetworkMessage('playerStates', data);
    if (typeof data.mapSeed === 'number') {
      useGameStore.getState().setMapSeed(data.mapSeed);
    }

    useGameStore.setState({
      redScore: data.redScore ?? useGameStore.getState().redScore,
      blueScore: data.blueScore ?? useGameStore.getState().blueScore,
      redFlag: data.redFlag ?? useGameStore.getState().redFlag,
      blueFlag: data.blueFlag ?? useGameStore.getState().blueFlag,
      roundTimeRemaining: data.roundTimeRemaining ?? useGameStore.getState().roundTimeRemaining,
    });

    for (const serverPlayer of data.players) {
      // Skip ghost players
      if (serverPlayer.id !== sessionId && serverPlayer.name === localPlayerName) {
        loggers.network.sample('ghost-playerStates', 5000, 'ignoring ghost playerStates', serverPlayer.name, serverPlayer.id);
        continue;
      }

      if (serverPlayer.id === sessionId) {
        const freshStore = useGameStore.getState();
        if (freshStore.localPlayer) {
          const nextState = serverPlayer.state || freshStore.localPlayer.state;
          const nextPosition = serverPlayer.position ?? null;
          const shouldSyncPosition = nextPosition
            ? shouldSyncLocalPosition(freshStore.localPlayer, nextState, nextPosition)
            : false;
          const localUltCharge = freshStore.localPlayer.ultimateCharge;
          const serverUltCharge = serverPlayer.ultimateCharge ?? localUltCharge;

          // Race condition protection for ultimateCharge
          let ultimateCharge = serverUltCharge;
          const serverJumpedUp = serverUltCharge > localUltCharge + 50;
          const serverDroppedDown = serverUltCharge < localUltCharge && localUltCharge > 5;

          if (serverJumpedUp) {
            ultimateCharge = localUltCharge;
          } else if (serverDroppedDown) {
            ultimateCharge = localUltCharge;
          }

          const updated = {
            ...freshStore.localPlayer,
            health: serverPlayer.health ?? freshStore.localPlayer.health,
            maxHealth: serverPlayer.maxHealth ?? freshStore.localPlayer.maxHealth,
            ultimateCharge,
            state: nextState,
            heroId: serverPlayer.heroId || freshStore.localPlayer.heroId,
            team: serverPlayer.team || freshStore.localPlayer.team,
            isBot: Boolean(serverPlayer.isBot ?? freshStore.localPlayer.isBot),
            botDifficulty: serverPlayer.botDifficulty || freshStore.localPlayer.botDifficulty,
            botProfileId: serverPlayer.botProfileId || freshStore.localPlayer.botProfileId,
            position: shouldSyncPosition ? nextPosition! : freshStore.localPlayer.position,
            velocity: shouldSyncPosition
              ? (serverPlayer.velocity ?? freshStore.localPlayer.velocity)
              : freshStore.localPlayer.velocity,
            hasFlag: serverPlayer.hasFlag ?? freshStore.localPlayer.hasFlag,
            abilities: serverPlayer.abilities || freshStore.localPlayer.abilities,
            stats: serverPlayer.stats || freshStore.localPlayer.stats,
            movement: normalizeMovementState(serverPlayer.movement, freshStore.localPlayer.movement),
          };
          actions.setLocalPlayer(updated);
          if (shouldSyncPosition) {
            syncLocalVisualPosition(updated);
          }
        }
      } else {
        const otherPlayerStore = useGameStore.getState();
        const existingPlayer = otherPlayerStore.players.get(serverPlayer.id);

        if (existingPlayer) {
          const updatedPlayer: Player = {
            ...existingPlayer,
            name: serverPlayer.name || existingPlayer.name,
            team: (serverPlayer.team || existingPlayer.team) as Team,
            heroId: (serverPlayer.heroId || existingPlayer.heroId) as HeroId | null,
            state: serverPlayer.state || existingPlayer.state,
            isReady: serverPlayer.isReady ?? existingPlayer.isReady,
            isBot: Boolean(serverPlayer.isBot ?? existingPlayer.isBot),
            botDifficulty: serverPlayer.botDifficulty || existingPlayer.botDifficulty,
            botProfileId: serverPlayer.botProfileId || existingPlayer.botProfileId,
            position: serverPlayer.position || existingPlayer.position,
            velocity: serverPlayer.velocity || existingPlayer.velocity,
            lookYaw: serverPlayer.lookYaw ?? existingPlayer.lookYaw,
            lookPitch: serverPlayer.lookPitch ?? existingPlayer.lookPitch,
            health: serverPlayer.health ?? existingPlayer.health,
            maxHealth: serverPlayer.maxHealth ?? existingPlayer.maxHealth,
            ultimateCharge: serverPlayer.ultimateCharge ?? existingPlayer.ultimateCharge,
            hasFlag: serverPlayer.hasFlag ?? existingPlayer.hasFlag,
            abilities: serverPlayer.abilities || existingPlayer.abilities,
            stats: serverPlayer.stats || existingPlayer.stats,
            movement: normalizeMovementState(serverPlayer.movement, existingPlayer.movement),
          };
          actions.updatePlayer(serverPlayer.id, updatedPlayer);
        } else {
          const newPlayer: Player = {
            id: serverPlayer.id,
            name: serverPlayer.name || 'Unknown',
            team: (serverPlayer.team || 'red') as Team,
            heroId: (serverPlayer.heroId || null) as HeroId | null,
            state: serverPlayer.state || 'alive',
            isReady: false,
            isBot: Boolean(serverPlayer.isBot),
            botDifficulty: serverPlayer.botDifficulty || undefined,
            botProfileId: serverPlayer.botProfileId || undefined,
            position: serverPlayer.position || { x: 0, y: 1, z: 0 },
            velocity: serverPlayer.velocity || { x: 0, y: 0, z: 0 },
            lookYaw: serverPlayer.lookYaw ?? 0,
            lookPitch: serverPlayer.lookPitch ?? 0,
            health: serverPlayer.health ?? 100,
            maxHealth: serverPlayer.maxHealth ?? 100,
            ultimateCharge: serverPlayer.ultimateCharge ?? 0,
            movement: normalizeMovementState(serverPlayer.movement),
            abilities: serverPlayer.abilities || {},
            hasFlag: serverPlayer.hasFlag ?? false,
            respawnTime: null,
            spawnProtectionUntil: null,
            stats: serverPlayer.stats || createDefaultStats(),
          };
          actions.updatePlayer(serverPlayer.id, newPlayer);
        }
      }
    }
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
  options: { durationMs?: number; fadeOutMs?: number; volume?: number } = {}
): void {
  void playSharedSound(sound, {
    position,
    durationMs: options.durationMs,
    fadeOutMs: options.fadeOutMs,
    volume: options.volume,
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
  const startPosition = data.startPosition ?? position;
  const ownerTeam = resolveOwnerTeam(data);
  const castId = data.castId ?? `${data.abilityId}_${data.playerId}_${data.serverTime ?? Date.now()}`;

  switch (data.abilityId) {
    case 'phantom_dire_ball': {
      if (!startPosition) return true;
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
      if (!startPosition) return true;
      stopRemotePhantomCharge(data.playerId);
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
      if (isLocalPlayer) {
        store.setVoidRayCharging(false, 0);
      }
      return true;

    case 'phantom_void_ray': {
      stopRemotePhantomCharge(data.playerId);
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
      if (startPosition && position) {
        if (isLocalPlayer) {
          applyLocalPhantomBlinkConfirmation(data, position, normalizeAimDirection(data));
          triggerTeleportEffect('blink');
          if (!shouldSuppressPredictedLocalAbilitySound('phantom_blink')) {
            playPhantomWorldSound('phantomBlink', undefined, { durationMs: 900, volume: 1.1 });
          }
        } else {
          playPhantomWorldSound('phantomBlink', startPosition, { durationMs: 900, volume: 1.1 });
        }
        triggerBlinkEffect(startPosition, position);
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
  const startPosition = data.startPosition ?? position;
  const targetPosition = data.targetPosition ?? position;
  const ownerTeam = resolveOwnerTeam(data);
  const castId = data.castId ?? `${data.abilityId}_${data.playerId}_${data.serverTime ?? Date.now()}`;
  const now = Date.now();

  switch (data.abilityId) {
    case 'hookshot_basic_attack': {
      if (!startPosition) return true;
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
      if (!startPosition) return true;
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
      if (!startPosition || !targetPosition) return true;
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
      if (!startPosition) return true;
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
      if (!startPosition || !targetPosition) return true;
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
  const startPosition = data.startPosition ?? position;
  const targetPosition = data.targetPosition ?? position;
  const ownerTeam = resolveOwnerTeam(data);
  const castId = data.castId ?? `${data.abilityId}_${data.playerId}_${data.serverTime ?? Date.now()}`;
  const now = Date.now();

  switch (data.abilityId) {
    case 'blaze_rocket': {
      if (!startPosition) return true;
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
      if (!startPosition || !targetPosition) return true;
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
      const effectPosition = startPosition ?? position;
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
  const startPosition = data.startPosition ?? position;
  const ownerTeam = resolveOwnerTeam(data);
  const castId = data.castId ?? `${data.abilityId}_${data.playerId}_${data.serverTime ?? Date.now()}`;
  const now = Date.now();

  switch (data.abilityId) {
    case 'chronos_verdant_pulse': {
      if (!startPosition) return true;
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
        });
      }
      if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('chronos_verdant_pulse')) {
        playChronosWorldSound('chronosPulse', startPosition);
      }
      return true;
    }

    case 'chronos_lifeline_conduit': {
      const predictedVisualId = isLocalPlayer
        ? consumePredictedLocalAbilityVisual('chronos_lifeline_conduit', data.playerId)
        : null;
      if (isLocalPlayer && !predictedVisualId) {
        triggerChronosLifelineConduitPose(data.serverTime ?? now);
      }
      if (!isLocalPlayer || !shouldSuppressPredictedLocalAbilitySound('chronos_lifeline_conduit')) {
        playChronosWorldSound('chronosAegis', startPosition, { volume: 0.65 });
      }
      return true;
    }

    case 'chronos_timebreak': {
      const predictedVisualId = isLocalPlayer
        ? consumePredictedLocalAbilityVisual('chronos_timebreak', data.playerId)
        : null;
      if (isLocalPlayer && !predictedVisualId) {
        triggerChronosTimebreakPose(data.serverTime ?? now);
      }

      const releaseTime = data.releaseAt ?? now + CHRONOS_TIMEBREAK_RELEASE_DELAY_MS;
      const releaseDelay = Math.max(0, releaseTime - now);
      const suppressLocalTimebreakSound = isLocalPlayer && shouldSuppressPredictedLocalAbilitySound('chronos_timebreak');
      if (!suppressLocalTimebreakSound) {
        playChronosWorldSound('chronosTimebreak', startPosition, {
          durationMs: Math.max(180, releaseDelay),
          fadeOutMs: Math.min(140, releaseDelay),
          volume: 0.72,
        });
      }

      window.setTimeout(() => {
        const freshStore = useGameStore.getState();
        const caster = data.playerId === (freshStore.localPlayer?.id ?? freshStore.playerId)
          ? freshStore.localPlayer
          : freshStore.players.get(data.playerId);
        const casterPosition = caster?.position ?? data.position;
        if (!casterPosition) return;

        const effectPosition = {
          x: casterPosition.x,
          y: casterPosition.y + 1.18,
          z: casterPosition.z,
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
        if (!suppressLocalTimebreakSound) {
          playChronosWorldSound('chronosTimebreak', effectPosition, { volume: 1.05 });
        }
      }, releaseDelay);
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

    addChronosLifelineEffects(data.sourcePosition, data.targets.map((target) => ({
      position: target.position,
    })));
    if (data.abilityId === 'chronos_lifeline_conduit') {
      playChronosWorldSound('chronosLifeline', data.sourcePosition);
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
