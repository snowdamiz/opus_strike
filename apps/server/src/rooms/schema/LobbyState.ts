import { Schema, MapSchema, ArraySchema, defineTypes } from '@colyseus/schema';

export class LobbyPlayer extends Schema {
  id: string = '';
  name: string = '';
  isHost: boolean = false;
  isReady: boolean = false;
  team: string = ''; // empty = auto-assign
}

defineTypes(LobbyPlayer, {
  id: 'string',
  name: 'string',
  isHost: 'boolean',
  isReady: 'boolean',
  team: 'string',
});

export class LobbyState extends Schema {
  lobbyId: string = '';
  name: string = '';
  hostId: string = '';
  maxPlayers: number = 10;
  isPublic: boolean = true;
  status: string = 'waiting'; // 'waiting' | 'starting' | 'in_game'
  gameRoomId: string = ''; // Set when game starts
  
  players = new MapSchema<LobbyPlayer>();
  
  createdAt: number = 0;
}

defineTypes(LobbyState, {
  lobbyId: 'string',
  name: 'string',
  hostId: 'string',
  maxPlayers: 'number',
  isPublic: 'boolean',
  status: 'string',
  gameRoomId: 'string',
  players: { map: LobbyPlayer },
  createdAt: 'number',
});

