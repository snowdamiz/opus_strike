import type { Room } from 'colyseus.js';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { useCombatFeedbackStore } from '../store/combatFeedbackStore';
import {
  setChronosAegisVisualState,
  setPlayerVisualPosition,
  setPlayerVisualRotation,
  visualStore,
} from '../store/visualStore';
import { addEffect } from '../components/game/Effects';
import { triggerAirStrike } from '../components/game/BlazeEffects';
import { addChronosLifelineEffects } from '../components/game/chronos/lifeline';
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
        const localPlayer = useGameStore.getState().localPlayer;
        if (!localPlayer) continue;

        const shouldSyncPosition = shouldSyncLocalPosition(localPlayer, localPlayer.state, decoded.position);
        if (!shouldSyncPosition) continue;

        const updated: Player = {
          ...localPlayer,
          position: decoded.position,
          velocity: decoded.velocity,
          lookYaw: decoded.lookYaw,
          lookPitch: decoded.lookPitch,
          movement: movementFromBits(transform, localPlayer.movement),
        };
        actions.setLocalPlayer(updated);
        syncLocalVisualPosition(updated);
        loggers.network.sample('local-correction', 1500, 'server corrected local transform', transform.id);
        continue;
      }

      const existingPlayer = store.players.get(transform.id);
      if (!existingPlayer) continue;
      if (existingPlayer.name === localPlayerName) {
        loggers.network.sample('ghost-transform', 5000, 'ignoring ghost transform', transform.id);
        continue;
      }

      existingPlayer.position = decoded.position;
      existingPlayer.velocity = decoded.velocity;
      existingPlayer.lookYaw = decoded.lookYaw;
      existingPlayer.lookPitch = decoded.lookPitch;
      existingPlayer.movement = movementFromBits(transform, existingPlayer.movement);
      setPlayerVisualPosition(transform.id, decoded.position);
      setPlayerVisualRotation(transform.id, decoded.lookYaw);
      setChronosAegisVisualState(
        transform.id,
        existingPlayer.heroId === 'chronos' && Boolean(transform.movementBits & MOVEMENT_BIT_CHRONOS_AEGIS),
        Date.now()
      );
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
    // Skip if this is our own void zone (already created client-side)
    if (data.ownerId === sessionId) {
      loggers.effects.debug('void zone from server skipped as duplicate');
      return;
    }
    loggers.effects.debug('void zone created by', data.ownerId);
    useGameStore.getState().addVoidZone(data);
  });

  room.onMessage('voidZoneExpired', (data: { id: string }) => {
    loggers.effects.debug('void zone expired', data.id);
    useGameStore.getState().removeVoidZone(data.id);
  });
}

/**
 * Sets up combat event handlers (damage, kills)
 */
export function setupCombatHandlers(room: Room) {
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

    const localPlayerId = store.localPlayer?.id ?? store.playerId;
    if (data.sourceId === localPlayerId) return;

    addChronosLifelineEffects(data.sourcePosition, data.targets.map((target) => ({
      position: target.position,
    })));
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

  room.onMessage('abilityUsed', (data: {
    playerId: string;
    abilityId: string;
    success?: boolean;
    position?: { x: number; y: number; z: number };
  }) => {
    loggers.network.debug('ability used', data.abilityId, data.playerId, data.success);

    if (data.abilityId === 'blaze_airstrike') {
      const store = useGameStore.getState();
      const localPlayerId = store.localPlayer?.id ?? store.playerId;
      if (data.playerId === localPlayerId) return;

      const casterPosition = data.position ?? store.players.get(data.playerId)?.position;
      if (casterPosition) {
        triggerAirStrike(casterPosition);
      }
    }
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
