import {
  ALL_HERO_IDS,
  HERO_DEFINITIONS,
  getDefaultHeroSkinId,
  getHeroSkinDefinition,
  getPlayerRole,
  isHeroSkinId,
  isTeamId,
  type BotDifficulty,
  type GameplayMode,
  type HeroId,
  type HeroSkinId,
  type MapProfileId,
  type MatchPerspective,
  type PregeneratedMapArtifactId,
  type PregeneratedMapId,
  type PlayerRole,
  type Team,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
import type { CreateGameEntryTicketInput } from '../security/entryTickets';
import type { MatchmakingTicketClaims } from '../security/matchmakingTickets';

export interface LobbyGameStartPlayer {
  id: string;
  name: string;
  role?: string;
  team: string;
  isBot: boolean;
  heroId: string;
  skinId?: string;
  botDifficulty: string;
  botProfileId: string;
}

export interface LobbyGameStartAuthContext {
  userId: string;
  displayName?: string | null;
}

export interface ParticipantAssignment {
  playerId: string;
  playerName: string;
  role: PlayerRole;
  team?: Team;
  isBot: boolean;
  heroId?: HeroId;
  skinId?: HeroSkinId;
  botDifficulty?: BotDifficulty;
  botProfileId?: string;
}

export interface LobbyGameStartAssignments {
  playerAssignments: ParticipantAssignment[];
  gameStartingAssignments: ParticipantAssignment[];
  botAssignments: ParticipantAssignment[];
  reservedHumanPlayers: number;
}

export interface GameStartingPayload {
  gameRoomId: string;
  players: ParticipantAssignment[];
  entryTicket?: string;
  seatReservation?: GameSeatReservationPayload;
  gameplayMode: GameplayMode;
  matchPerspective: MatchPerspective;
  mapThemeId: VoxelMapTheme['id'];
  mapSize: VoxelMapSizeId;
  mapProfileId: MapProfileId;
  pregeneratedMapId?: PregeneratedMapId | null;
  mapArtifactId?: PregeneratedMapArtifactId | null;
}

export interface GameSeatReservationPayload {
  sessionId: string;
  room: {
    name: string;
    roomId: string;
    processId: string;
    publicAddress?: string;
  };
  devMode?: boolean;
}

export interface GameSeatReservationLike {
  sessionId: string;
  room: {
    name?: string;
    roomId?: string;
    processId?: string;
    publicAddress?: string;
  };
  devMode?: boolean;
}

function normalizeHeroId(heroId?: string): HeroId | '' {
  return heroId && HERO_DEFINITIONS[heroId as HeroId] ? (heroId as HeroId) : '';
}

function normalizeDifficulty(difficulty?: string): BotDifficulty {
  if (difficulty === 'easy' || difficulty === 'hard') {
    return difficulty;
  }
  return 'normal';
}

function normalizeSkinId(heroId: HeroId | undefined, skinId?: string): HeroSkinId | undefined {
  if (!heroId) return undefined;
  if (isHeroSkinId(skinId) && getHeroSkinDefinition(skinId).heroId === heroId) {
    return skinId;
  }
  return getDefaultHeroSkinId(heroId);
}

export function createLobbyGameStartAssignments(input: {
  players: Iterable<LobbyGameStartPlayer>;
  random?: () => number;
  heroIds?: readonly HeroId[];
}): LobbyGameStartAssignments {
  const random = input.random ?? Math.random;
  const heroIds = input.heroIds ?? ALL_HERO_IDS;
  const participants: LobbyGameStartPlayer[] = [];
  const playerAssignments: ParticipantAssignment[] = [];
  const claimedHeroesByTeam = new Map<Team, Map<HeroId, string>>();

  for (const player of input.players) {
    if (getPlayerRole(player) === 'observer') {
      participants.push(player);
      continue;
    }

    if (!isTeamId(player.team)) {
      throw new Error('Cannot create assignments with unassigned players');
    }

    participants.push(player);
    if (!claimedHeroesByTeam.has(player.team)) {
      claimedHeroesByTeam.set(player.team, new Map());
    }
  }

  for (const player of participants) {
    if (getPlayerRole(player) === 'observer') continue;
    if (player.isBot) continue;
    const heroId = normalizeHeroId(player.heroId);
    const claimed = claimedHeroesByTeam.get(player.team as Team);
    if (claimed && heroId && !claimed.has(heroId)) {
      claimed.set(heroId, player.id);
    }
  }

  for (const player of participants) {
    if (getPlayerRole(player) === 'observer') continue;
    if (!player.isBot) continue;
    const heroId = normalizeHeroId(player.heroId);
    const claimed = claimedHeroesByTeam.get(player.team as Team);
    if (claimed && heroId && !claimed.has(heroId)) {
      claimed.set(heroId, player.id);
    }
  }

  for (const player of participants) {
    const role = getPlayerRole(player);
    if (role === 'observer') {
      playerAssignments.push({
        playerId: player.id,
        playerName: player.name,
        role,
        isBot: player.isBot,
      });
      continue;
    }

    const team = player.team as Team;
    const normalizedHeroId = normalizeHeroId(player.heroId);
    let heroId: HeroId | undefined = normalizedHeroId || undefined;
    let claimed = claimedHeroesByTeam.get(team);
    if (!claimed) {
      claimed = new Map();
      claimedHeroesByTeam.set(team, claimed);
    }
    if (heroId && claimed.get(heroId) !== player.id) {
      heroId = undefined;
    }

    if (player.isBot && !heroId) {
      const availableHeroes = heroIds.filter((candidate) => !claimed.has(candidate));
      const randomIndex = Math.floor(random() * availableHeroes.length);
      heroId = availableHeroes[randomIndex];
      if (heroId) {
        claimed.set(heroId, player.id);
      }
    }

    playerAssignments.push({
      playerId: player.id,
      playerName: player.name,
      role,
      team,
      isBot: player.isBot,
      heroId,
      skinId: normalizeSkinId(heroId, player.skinId),
      botDifficulty: player.isBot ? normalizeDifficulty(player.botDifficulty) : undefined,
      botProfileId: player.botProfileId || undefined,
    });
  }

  const botAssignments = playerAssignments.filter((assignment) => assignment.isBot);
  const reservedHumanPlayers = playerAssignments.length - botAssignments.length;
  return {
    playerAssignments,
    gameStartingAssignments: playerAssignments,
    botAssignments,
    reservedHumanPlayers,
  };
}

export function buildGameEntryTicketInputs(input: {
  lobbyId: string;
  gameRoomId: string;
  matchPerspective: MatchPerspective;
  playerAssignments: readonly ParticipantAssignment[];
  authContexts: ReadonlyMap<string, LobbyGameStartAuthContext>;
  matchmakingTickets?: ReadonlyMap<string, MatchmakingTicketClaims>;
}): Map<string, CreateGameEntryTicketInput> {
  const ticketInputs = new Map<string, CreateGameEntryTicketInput>();

  for (const assignment of input.playerAssignments) {
    if (assignment.isBot) continue;
    const authContext = input.authContexts.get(assignment.playerId);
    if (!authContext) {
      throw new Error('Authenticated player context missing');
    }
    const matchmakingTicket = input.matchmakingTickets?.get(assignment.playerId);

    ticketInputs.set(assignment.playerId, {
      lobbyId: input.lobbyId,
      gameRoomId: input.gameRoomId,
      lobbyPlayerId: assignment.playerId,
      userId: authContext.userId,
      displayName: authContext.displayName || assignment.playerName,
      matchPerspective: input.matchPerspective,
      role: assignment.role,
      assignedTeam: assignment.team,
      selectedHero: assignment.heroId,
      selectedSkinId: assignment.skinId,
      ...(matchmakingTicket?.mode === 'ranked' && matchmakingTicket.rankedRewardEligible === true
        ? { rankedRewardEligible: true }
        : {}),
    });
  }

  return ticketInputs;
}

export function buildGameStartingPayload(input: {
  gameRoomId: string;
  players: ParticipantAssignment[];
  entryTicket?: string;
  seatReservation?: GameSeatReservationPayload;
  gameplayMode: GameplayMode;
  matchPerspective: MatchPerspective;
  mapThemeId: VoxelMapTheme['id'];
  mapSize: VoxelMapSizeId;
  mapProfileId?: MapProfileId;
  pregeneratedMapId?: PregeneratedMapId | null;
  mapArtifactId?: PregeneratedMapArtifactId | null;
}): GameStartingPayload {
  return {
    gameRoomId: input.gameRoomId,
    players: input.players,
    entryTicket: input.entryTicket,
    seatReservation: input.seatReservation,
    gameplayMode: input.gameplayMode,
    matchPerspective: input.matchPerspective,
    mapThemeId: input.mapThemeId,
    mapSize: input.mapSize,
    mapProfileId: input.mapProfileId ?? 'ctf_arena',
    pregeneratedMapId: input.pregeneratedMapId ?? null,
    mapArtifactId: input.mapArtifactId ?? null,
  };
}

export function serializeGameSeatReservation(
  reservation: GameSeatReservationLike
): GameSeatReservationPayload {
  const roomName = reservation.room.name;
  const roomId = reservation.room.roomId;
  const processId = reservation.room.processId;
  if (!roomName || !roomId || !processId) {
    throw new Error('Cannot serialize incomplete game seat reservation');
  }

  return {
    sessionId: reservation.sessionId,
    room: {
      name: roomName,
      roomId,
      processId,
      ...(reservation.room.publicAddress ? { publicAddress: reservation.room.publicAddress } : {}),
    },
    ...(reservation.devMode ? { devMode: true } : {}),
  };
}
