import {
  ALL_HERO_IDS,
  DEFAULT_MATCH_PERSPECTIVE,
  GAMEPLAY_MODES,
  VOXEL_MAP_SIZE_IDS,
  VOXEL_MAP_THEMES,
  createRandomSeed,
  getDefaultHeroSkinId,
  getGameplayModeCapacityCost,
  getGameplayModeRules,
  getTeamIdsForGameplayMode,
  getVoxelMapTheme,
  type BotDifficulty,
  type GameplayMode,
  type HeroId,
  type HeroSkinId,
  type MapProfileId,
  type MatchPerspective,
  type Team,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
import { runWithInGameCapacity, type InGameCapacityAdmissionFailureReason } from '../matchmaking/playerCapacity';
import { createStreamerObserverTicket } from '../security/streamerTickets';
import { getStreamerObserverSeatCount } from './config';

export interface StreamerRoomListing {
  roomId: string;
  processId?: string;
  publicAddress?: string;
  clients?: number;
  maxClients?: number;
  locked?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface StreamerMatchMaker {
  processId?: string;
  query(criteria: { name: string }): Promise<StreamerRoomListing[]>;
  createRoom(name: 'game_room', options: StreamerGameRoomCreateOptions): Promise<StreamerRoomListing>;
}

export interface StreamerGameRoomCreateOptions {
  lobbyName: string;
  matchMode: 'custom';
  gameplayMode: GameplayMode;
  matchPerspective: MatchPerspective;
  mapSeed: number;
  mapThemeId: VoxelMapTheme['id'];
  mapSize: VoxelMapSizeId;
  mapProfileId: MapProfileId;
  botAssignments: StreamerBotAssignment[];
  rankedEligible: false;
  requiredHumanPlayers: 0;
  reservedHumanPlayers: 0;
  capacityPlayerCost: number;
  streamerManagedBotGame: true;
  streamerManagedByUserId: string;
}

export interface StreamerBotAssignment {
  playerId: string;
  playerName: string;
  team: Team;
  isBot: true;
  heroId: HeroId;
  skinId: HeroSkinId;
  botDifficulty: BotDifficulty;
  botProfileId: string;
}

export interface StreamerTarget {
  room: StreamerRoomListing;
  source: 'real_player' | 'fallback_bot';
}

export interface StreamerNextTarget {
  roomId: string;
  roomName: 'game_room';
  processId: string | null;
  publicAddress: string | null;
  source: StreamerTarget['source'];
  streamerObserverTicket: string;
  metadata: {
    phase: string | null;
    gameplayMode: string | null;
    matchPerspective: string | null;
    mapSeed: number | null;
    mapThemeId: string | null;
    mapSize: string | null;
    mapProfileId: string | null;
    combatHumanCount: number;
    regularObserverCount: number;
    streamerObserverCount: number;
    streamerManagedBotGame: boolean;
  };
}

export interface StreamerFallbackStatus {
  exists: boolean;
  roomId: string | null;
  phase: string | null;
}

export interface StreamerSessionStatus {
  currentRoomId: string | null;
  fallbackBotGame: StreamerFallbackStatus;
}

interface StreamerSessionRecord {
  adminUserId: string;
  roomId: string;
  updatedAt: number;
}

interface CreateFallbackResult {
  room: StreamerRoomListing | null;
  capacityFailure: {
    reason: InGameCapacityAdmissionFailureReason;
    requestedPlayers: number;
  } | null;
}

const STREAMER_LIVE_PHASES = new Set(['hero_select', 'countdown', 'deployment', 'playing', 'round_end']);
const STREAMER_ACTIVE_PHASES = new Set(['countdown', 'deployment', 'playing', 'round_end']);
const STREAMER_BOT_NAMES = [
  'Ash Relay',
  'Byte Caster',
  'Copper Lens',
  'Delta Cue',
  'Echo Rail',
  'Flux Anchor',
  'Glint Runner',
  'Halo Drift',
  'Ion Replay',
  'Jolt Marker',
  'Kilo Focus',
  'Lumen Pan',
  'Mica Signal',
  'Nova Frame',
  'Orbit Cut',
  'Pixel Tempo',
  'Quartz Dash',
  'Rift Slate',
  'Signal Bloom',
  'Tangent Rush',
  'Umbra Cue',
  'Vector Pop',
  'Wisp Relay',
  'Xeno Drift',
  'Yonder Flash',
  'Zenith Byte',
  'Arc Fuse',
  'Blip Vista',
  'Core Glimmer',
  'Dusk Signal',
  'Ember Route',
  'Focal Sprint',
  'Grid Nova',
];

const streamerSessions = new Map<string, StreamerSessionRecord>();

function readNumber(metadata: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function readBoolean(metadata: Record<string, unknown> | null | undefined, key: string): boolean {
  return metadata?.[key] === true;
}

function metadataForRoom(room: StreamerRoomListing): Record<string, unknown> {
  return room.metadata ?? {};
}

export function getStreamerRoomMetadata(room: StreamerRoomListing): StreamerNextTarget['metadata'] {
  const metadata = metadataForRoom(room);
  return {
    phase: readString(metadata, 'phase') ?? readString(metadata, 'status'),
    gameplayMode: readString(metadata, 'gameplayMode'),
    matchPerspective: readString(metadata, 'matchPerspective'),
    mapSeed: readNumber(metadata, 'mapSeed'),
    mapThemeId: readString(metadata, 'mapThemeId'),
    mapSize: readString(metadata, 'mapSize'),
    mapProfileId: readString(metadata, 'mapProfileId'),
    combatHumanCount: readNumber(metadata, 'combatHumanCount') ?? readNumber(metadata, 'humanCount') ?? 0,
    regularObserverCount: readNumber(metadata, 'regularObserverCount') ?? 0,
    streamerObserverCount: readNumber(metadata, 'streamerObserverCount') ?? 0,
    streamerManagedBotGame: readBoolean(metadata, 'streamerManagedBotGame'),
  };
}

function hasStreamerSeat(room: StreamerRoomListing): boolean {
  return getStreamerRoomMetadata(room).streamerObserverCount < getStreamerObserverSeatCount();
}

export function isEligibleRealPlayerStreamerRoom(room: StreamerRoomListing): boolean {
  const metadata = getStreamerRoomMetadata(room);
  if (room.locked) return false;
  if (metadata.streamerManagedBotGame) return false;
  if (!metadata.phase || !STREAMER_LIVE_PHASES.has(metadata.phase)) return false;
  if (metadata.combatHumanCount <= 0) return false;
  return hasStreamerSeat(room);
}

export function isUsableFallbackStreamerRoom(room: StreamerRoomListing): boolean {
  const metadata = getStreamerRoomMetadata(room);
  if (room.locked) return false;
  if (!metadata.streamerManagedBotGame) return false;
  if (!metadata.phase || metadata.phase === 'game_end' || metadata.phase === 'cancelled') return false;
  return hasStreamerSeat(room);
}

function selectionScore(room: StreamerRoomListing, currentRoomId: string | null, random: () => number): number {
  const metadata = getStreamerRoomMetadata(room);
  const phaseScore = metadata.phase && STREAMER_ACTIVE_PHASES.has(metadata.phase) ? 1_000_000 : 0;
  const realGameScore = metadata.streamerManagedBotGame ? 0 : 100_000;
  const combatScore = metadata.combatHumanCount * 1_000;
  const currentScore = currentRoomId && room.roomId === currentRoomId ? 500 : 0;
  const jitter = Math.floor(random() * 300);
  return phaseScore + realGameScore + combatScore + currentScore + jitter;
}

export function selectStreamerTargetRoom(input: {
  rooms: StreamerRoomListing[];
  currentRoomId?: string | null;
  random?: () => number;
}): StreamerTarget | null {
  const random = input.random ?? Math.random;
  const currentRoomId = input.currentRoomId ?? null;
  const realRooms = input.rooms.filter(isEligibleRealPlayerStreamerRoom);
  if (realRooms.length > 0) {
    realRooms.sort((a, b) => selectionScore(b, currentRoomId, random) - selectionScore(a, currentRoomId, random));
    return { room: realRooms[0], source: 'real_player' };
  }

  const fallbackRooms = input.rooms.filter(isUsableFallbackStreamerRoom);
  if (fallbackRooms.length === 0) return null;
  fallbackRooms.sort((a, b) => selectionScore(b, currentRoomId, random) - selectionScore(a, currentRoomId, random));
  return { room: fallbackRooms[0], source: 'fallback_bot' };
}

function chooseFrom<T>(values: readonly T[], random: () => number): T {
  return values[Math.floor(random() * values.length)] ?? values[0];
}

function botDifficultyForIndex(index: number): BotDifficulty {
  if (index % 7 === 0) return 'hard';
  if (index % 5 === 0) return 'easy';
  return 'normal';
}

export function createStreamerBotAssignments(input: {
  gameplayMode: GameplayMode;
  seed: number;
}): StreamerBotAssignment[] {
  const rules = getGameplayModeRules(input.gameplayMode);
  const teamIds = getTeamIdsForGameplayMode(input.gameplayMode).slice(0, rules.maxTeams) as Team[];
  const heroCountByTeam = new Map<Team, number>();
  const assignments: StreamerBotAssignment[] = [];

  for (let index = 0; index < rules.maxPlayers; index++) {
    const team = teamIds[index % teamIds.length] ?? 'red';
    const teamHeroIndex = heroCountByTeam.get(team) ?? 0;
    heroCountByTeam.set(team, teamHeroIndex + 1);
    const heroId = ALL_HERO_IDS[(teamHeroIndex + index) % ALL_HERO_IDS.length];
    const botName = STREAMER_BOT_NAMES[index % STREAMER_BOT_NAMES.length] ?? `Bot ${index + 1}`;

    assignments.push({
      playerId: `streamer-bot:${input.seed}:${index}`,
      playerName: botName,
      team,
      isBot: true,
      heroId,
      skinId: getDefaultHeroSkinId(heroId),
      botDifficulty: botDifficultyForIndex(index),
      botProfileId: `streamer-${input.gameplayMode}-${botDifficultyForIndex(index)}`,
    });
  }

  return assignments;
}

function createFallbackRoomOptions(input: {
  adminUserId: string;
  gameplayMode: GameplayMode;
  random: () => number;
}): StreamerGameRoomCreateOptions {
  const mapSeed = createRandomSeed();
  const mapThemeId = chooseFrom(VOXEL_MAP_THEMES, input.random).id;
  const mapSize = chooseFrom(VOXEL_MAP_SIZE_IDS, input.random);
  const rules = getGameplayModeRules(input.gameplayMode);
  const matchPerspective: MatchPerspective = input.random() > 0.5 ? 'third_person' : DEFAULT_MATCH_PERSPECTIVE;
  const botAssignments = createStreamerBotAssignments({
    gameplayMode: input.gameplayMode,
    seed: mapSeed,
  });

  return {
    lobbyName: `Streamer ${rules.label}`,
    matchMode: 'custom',
    gameplayMode: input.gameplayMode,
    matchPerspective,
    mapSeed,
    mapThemeId,
    mapSize,
    mapProfileId: rules.mapProfileId,
    botAssignments,
    rankedEligible: false,
    requiredHumanPlayers: 0,
    reservedHumanPlayers: 0,
    capacityPlayerCost: getGameplayModeCapacityCost(input.gameplayMode, 0),
    streamerManagedBotGame: true,
    streamerManagedByUserId: input.adminUserId,
  };
}

async function createFallbackRoom(input: {
  adminUserId: string;
  matchMaker: StreamerMatchMaker;
  random: () => number;
}): Promise<CreateFallbackResult> {
  const preferredModes = [...GAMEPLAY_MODES].sort(() => input.random() - 0.5);
  let lastFailure: CreateFallbackResult['capacityFailure'] = null;

  for (const gameplayMode of preferredModes) {
    const createOptions = createFallbackRoomOptions({
      adminUserId: input.adminUserId,
      gameplayMode,
      random: input.random,
    });
    const admission = await runWithInGameCapacity({
      matchMaker: input.matchMaker,
      requestedPlayers: createOptions.capacityPlayerCost,
    }, () => input.matchMaker.createRoom('game_room', createOptions));

    if (admission.admitted) {
      return { room: admission.result, capacityFailure: null };
    }

    lastFailure = {
      reason: admission.reason,
      requestedPlayers: createOptions.capacityPlayerCost,
    };
  }

  return { room: null, capacityFailure: lastFailure };
}

function toNextTarget(input: {
  adminUserId: string;
  target: StreamerTarget;
}): StreamerNextTarget {
  const room = input.target.room;
  return {
    roomId: room.roomId,
    roomName: 'game_room',
    processId: room.processId ?? null,
    publicAddress: room.publicAddress ?? null,
    source: input.target.source,
    streamerObserverTicket: createStreamerObserverTicket({
      adminUserId: input.adminUserId,
      gameRoomId: room.roomId,
    }),
    metadata: getStreamerRoomMetadata(room),
  };
}

export async function getStreamerSessionStatus(input: {
  adminUserId: string;
  matchMaker: Pick<StreamerMatchMaker, 'query'>;
}): Promise<StreamerSessionStatus> {
  const rooms = await input.matchMaker.query({ name: 'game_room' });
  const fallback = rooms.find(isUsableFallbackStreamerRoom) ?? null;
  const fallbackMetadata = fallback ? getStreamerRoomMetadata(fallback) : null;
  return {
    currentRoomId: streamerSessions.get(input.adminUserId)?.roomId ?? null,
    fallbackBotGame: {
      exists: Boolean(fallback),
      roomId: fallback?.roomId ?? null,
      phase: fallbackMetadata?.phase ?? null,
    },
  };
}

export async function getNextStreamerTarget(input: {
  adminUserId: string;
  matchMaker: StreamerMatchMaker;
  currentRoomId?: string | null;
  random?: () => number;
}): Promise<StreamerNextTarget> {
  const random = input.random ?? Math.random;
  const rooms = await input.matchMaker.query({ name: 'game_room' });
  const target = selectStreamerTargetRoom({
    rooms,
    currentRoomId: input.currentRoomId ?? streamerSessions.get(input.adminUserId)?.roomId ?? null,
    random,
  });

  if (target) {
    streamerSessions.set(input.adminUserId, {
      adminUserId: input.adminUserId,
      roomId: target.room.roomId,
      updatedAt: Date.now(),
    });
    return toNextTarget({ adminUserId: input.adminUserId, target });
  }

  const fallback = await createFallbackRoom({
    adminUserId: input.adminUserId,
    matchMaker: input.matchMaker,
    random,
  });
  if (!fallback.room) {
    const reason = fallback.capacityFailure
      ? `capacity_${fallback.capacityFailure.reason}`
      : 'fallback_unavailable';
    throw new Error(`Streamer fallback bot game unavailable: ${reason}`);
  }

  const nextTarget = {
    room: fallback.room,
    source: 'fallback_bot' as const,
  };
  streamerSessions.set(input.adminUserId, {
    adminUserId: input.adminUserId,
    roomId: fallback.room.roomId,
    updatedAt: Date.now(),
  });
  return toNextTarget({ adminUserId: input.adminUserId, target: nextTarget });
}

export function stopStreamerSession(adminUserId: string): void {
  streamerSessions.delete(adminUserId);
}

export function clearStreamerSessionsForTests(): void {
  streamerSessions.clear();
}

export function getRandomFallbackPreview(input: { gameplayMode: GameplayMode; random?: () => number }) {
  const random = input.random ?? Math.random;
  const options = createFallbackRoomOptions({
    adminUserId: 'preview',
    gameplayMode: input.gameplayMode,
    random,
  });
  return {
    gameplayMode: options.gameplayMode,
    matchPerspective: options.matchPerspective,
    mapSeed: options.mapSeed,
    mapThemeId: getVoxelMapTheme(options.mapSeed, options.mapThemeId).id,
    mapSize: options.mapSize,
    mapProfileId: options.mapProfileId,
    botCount: options.botAssignments.length,
    capacityPlayerCost: options.capacityPlayerCost,
  };
}
