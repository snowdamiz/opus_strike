import { Schema, MapSchema, defineTypes } from '@colyseus/schema';
import { DEFAULT_GAME_CONFIG } from '@voxel-strike/shared';

export class LobbyPlayer extends Schema {
  id: string = '';
  name: string = '';
  isHost: boolean = false;
  isReady: boolean = false;
  team: string = ''; // empty = awaiting selection
  heroId: string = '';
  skinId: string = '';
  isBot: boolean = false;
  botDifficulty: string = 'normal';
  botProfileId: string = '';
  rankTier: string = 'unranked';
  rankTierLabel: string = 'Unranked';
  rankDivision: number = 0;
  rankDivisionIndex: number = -1;
  rankLabel: string = 'Unranked';
  rankIconKey: string = 'unranked';
  rankIsRanked: boolean = false;
  rankPlacementRemaining: number = 5;
}

defineTypes(LobbyPlayer, {
  id: 'string',
  name: 'string',
  isHost: 'boolean',
  isReady: 'boolean',
  team: 'string',
  heroId: 'string',
  skinId: 'string',
  isBot: 'boolean',
  botDifficulty: 'string',
  botProfileId: 'string',
  rankTier: 'string',
  rankTierLabel: 'string',
  rankDivision: 'number',
  rankDivisionIndex: 'number',
  rankLabel: 'string',
  rankIconKey: 'string',
  rankIsRanked: 'boolean',
  rankPlacementRemaining: 'number',
});

export class LobbyState extends Schema {
  lobbyId: string = '';
  name: string = '';
  matchMode: string = 'custom';
  gameplayMode: string = 'capture_the_flag';
  matchPerspective: string = 'first_person';
  hostId: string = '';
  maxPlayers: number = DEFAULT_GAME_CONFIG.maxPlayers;
  maxParticipants: number = DEFAULT_GAME_CONFIG.maxPlayers;
  isPublic: boolean = true;
  status: string = 'waiting'; // 'waiting' | 'matchmaking' | 'map_vote' | 'starting' | 'in_game'
  gameRoomId: string = ''; // Set when game starts
  defaultBotDifficulty: string = 'normal';
  botFillMode: string = 'manual';
  
  players = new MapSchema<LobbyPlayer>();
  
  createdAt: number = 0;
}

defineTypes(LobbyState, {
  lobbyId: 'string',
  name: 'string',
  matchMode: 'string',
  gameplayMode: 'string',
  matchPerspective: 'string',
  hostId: 'string',
  maxPlayers: 'number',
  maxParticipants: 'number',
  isPublic: 'boolean',
  status: 'string',
  gameRoomId: 'string',
  defaultBotDifficulty: 'string',
  botFillMode: 'string',
  players: { map: LobbyPlayer },
  createdAt: 'number',
});
