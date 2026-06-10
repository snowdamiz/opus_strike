import { Schema, MapSchema, defineTypes } from '@colyseus/schema';
import { DEFAULT_GAME_CONFIG } from '@voxel-strike/shared';

export class LobbyPlayer extends Schema {
  id: string = '';
  name: string = '';
  isHost: boolean = false;
  isReady: boolean = false;
  team: string = ''; // empty = awaiting selection
  heroId: string = '';
  isBot: boolean = false;
  botDifficulty: string = 'normal';
  botProfileId: string = '';
}

defineTypes(LobbyPlayer, {
  id: 'string',
  name: 'string',
  isHost: 'boolean',
  isReady: 'boolean',
  team: 'string',
  heroId: 'string',
  isBot: 'boolean',
  botDifficulty: 'string',
  botProfileId: 'string',
});

export class LobbyState extends Schema {
  lobbyId: string = '';
  name: string = '';
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
