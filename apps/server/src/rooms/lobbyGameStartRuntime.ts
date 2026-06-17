import {
  ALL_HERO_IDS,
  HERO_DEFINITIONS,
  type BotDifficulty,
  type GameplayMode,
  type HeroId,
  type Team,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
import type { CreateGameEntryTicketInput } from '../security/entryTickets';

export interface LobbyGameStartPlayer {
  id: string;
  name: string;
  team: string;
  isObserver: boolean;
  isBot: boolean;
  heroId: string;
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
  team: Team;
  isBot: boolean;
  heroId?: HeroId;
  botDifficulty?: BotDifficulty;
  botProfileId?: string;
}

export interface ObserverAssignment {
  playerId: string;
  playerName: string;
  isBot: false;
  isObserver: true;
}

export type GameStartingAssignment = ParticipantAssignment | ObserverAssignment;

export interface LobbyGameStartAssignments {
  playerAssignments: ParticipantAssignment[];
  observerAssignments: ObserverAssignment[];
  gameStartingAssignments: GameStartingAssignment[];
  botAssignments: ParticipantAssignment[];
  reservedHumanPlayers: number;
}

export interface GameStartingPayload {
  gameRoomId: string;
  players: GameStartingAssignment[];
  entryTicket?: string;
  gameplayMode: GameplayMode;
  mapThemeId: VoxelMapTheme['id'];
  mapSize: VoxelMapSizeId;
  wager: unknown;
}

function isTeamValue(team: string): team is Team {
  return team === 'red' || team === 'blue';
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

export function createLobbyGameStartAssignments(input: {
  players: Iterable<LobbyGameStartPlayer>;
  random?: () => number;
  heroIds?: readonly HeroId[];
}): LobbyGameStartAssignments {
  const random = input.random ?? Math.random;
  const heroIds = input.heroIds ?? ALL_HERO_IDS;
  const participants: LobbyGameStartPlayer[] = [];
  const playerAssignments: ParticipantAssignment[] = [];
  const observerAssignments: ObserverAssignment[] = [];
  const claimedHeroesByTeam: Record<Team, Map<HeroId, string>> = {
    red: new Map(),
    blue: new Map(),
  };

  for (const player of input.players) {
    if (player.isObserver) {
      if (!player.isBot) {
        observerAssignments.push({
          playerId: player.id,
          playerName: player.name,
          isBot: false,
          isObserver: true,
        });
      }
      continue;
    }

    if (!isTeamValue(player.team)) {
      throw new Error('Cannot create assignments with unassigned players');
    }

    participants.push(player);
    const heroId = normalizeHeroId(player.heroId);
    if (heroId && !claimedHeroesByTeam[player.team].has(heroId)) {
      claimedHeroesByTeam[player.team].set(heroId, player.id);
    }
  }

  for (const player of participants) {
    const team = player.team as Team;
    const normalizedHeroId = normalizeHeroId(player.heroId);
    let heroId: HeroId | undefined = normalizedHeroId || undefined;
    if (heroId && claimedHeroesByTeam[team].get(heroId) !== player.id) {
      heroId = undefined;
    }

    if (player.isBot && !heroId) {
      const claimed = claimedHeroesByTeam[team];
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
      team,
      isBot: player.isBot,
      heroId,
      botDifficulty: player.isBot ? normalizeDifficulty(player.botDifficulty) : undefined,
      botProfileId: player.botProfileId || undefined,
    });
  }

  const botAssignments = playerAssignments.filter((assignment) => assignment.isBot);
  const reservedHumanPlayers = playerAssignments.length - botAssignments.length;
  return {
    playerAssignments,
    observerAssignments,
    gameStartingAssignments: [...playerAssignments, ...observerAssignments],
    botAssignments,
    reservedHumanPlayers,
  };
}

export function buildGameEntryTicketInputs(input: {
  lobbyId: string;
  gameRoomId: string;
  playerAssignments: readonly ParticipantAssignment[];
  observerAssignments: readonly ObserverAssignment[];
  authContexts: ReadonlyMap<string, LobbyGameStartAuthContext>;
}): Map<string, CreateGameEntryTicketInput> {
  const ticketInputs = new Map<string, CreateGameEntryTicketInput>();

  for (const assignment of input.playerAssignments) {
    if (assignment.isBot) continue;
    const authContext = input.authContexts.get(assignment.playerId);
    if (!authContext) {
      throw new Error('Authenticated player context missing');
    }

    ticketInputs.set(assignment.playerId, {
      lobbyId: input.lobbyId,
      gameRoomId: input.gameRoomId,
      lobbyPlayerId: assignment.playerId,
      userId: authContext.userId,
      displayName: authContext.displayName || assignment.playerName,
      assignedTeam: assignment.team,
      selectedHero: assignment.heroId,
    });
  }

  for (const assignment of input.observerAssignments) {
    const authContext = input.authContexts.get(assignment.playerId);
    if (!authContext) {
      throw new Error('Authenticated observer context missing');
    }

    ticketInputs.set(assignment.playerId, {
      lobbyId: input.lobbyId,
      gameRoomId: input.gameRoomId,
      lobbyPlayerId: assignment.playerId,
      userId: authContext.userId,
      displayName: authContext.displayName || assignment.playerName,
      observer: true,
    });
  }

  return ticketInputs;
}

export function buildGameStartingPayload(input: {
  gameRoomId: string;
  players: GameStartingAssignment[];
  entryTicket?: string;
  gameplayMode: GameplayMode;
  mapThemeId: VoxelMapTheme['id'];
  mapSize: VoxelMapSizeId;
  wager: unknown;
}): GameStartingPayload {
  return {
    gameRoomId: input.gameRoomId,
    players: input.players,
    entryTicket: input.entryTicket,
    gameplayMode: input.gameplayMode,
    mapThemeId: input.mapThemeId,
    mapSize: input.mapSize,
    wager: input.wager,
  };
}
