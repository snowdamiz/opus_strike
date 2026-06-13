import { Schema, MapSchema, defineTypes } from '@colyseus/schema';
import { DEFAULT_GAME_CONFIG } from '@voxel-strike/shared';

export class LobbyPlayer extends Schema {
  id: string = '';
  name: string = '';
  isHost: boolean = false;
  isReady: boolean = false;
  team: string = ''; // empty = awaiting selection
  isObserver: boolean = false;
  heroId: string = '';
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
  paymentStatus: string = '';
  paymentWalletAddress: string = '';
  depositSignature: string = '';
  refundSignature: string = '';
}

defineTypes(LobbyPlayer, {
  id: 'string',
  name: 'string',
  isHost: 'boolean',
  isReady: 'boolean',
  team: 'string',
  isObserver: 'boolean',
  heroId: 'string',
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
  paymentStatus: 'string',
  paymentWalletAddress: 'string',
  depositSignature: 'string',
  refundSignature: 'string',
});

export class LobbyState extends Schema {
  lobbyId: string = '';
  name: string = '';
  matchMode: string = 'custom';
  hostId: string = '';
  maxPlayers: number = DEFAULT_GAME_CONFIG.maxPlayers;
  maxParticipants: number = DEFAULT_GAME_CONFIG.maxPlayers;
  observersEnabled: boolean = false;
  maxObservers: number = 0;
  isPublic: boolean = true;
  status: string = 'waiting'; // 'waiting' | 'matchmaking' | 'map_vote' | 'starting' | 'in_game'
  gameRoomId: string = ''; // Set when game starts
  defaultBotDifficulty: string = 'normal';
  botFillMode: string = 'manual';
  wagerEnabled: boolean = false;
  wagerStatus: string = '';
  wagerToken: string = '';
  wagerCoverChargeLamports: string = '';
  wagerTreasuryWallet: string = '';
  wagerPlatformFeeBps: number = 0;
  wagerPotLamports: string = '0';
  wagerPaidPlayerCount: number = 0;
  
  players = new MapSchema<LobbyPlayer>();
  
  createdAt: number = 0;
}

defineTypes(LobbyState, {
  lobbyId: 'string',
  name: 'string',
  matchMode: 'string',
  hostId: 'string',
  maxPlayers: 'number',
  maxParticipants: 'number',
  observersEnabled: 'boolean',
  maxObservers: 'number',
  isPublic: 'boolean',
  status: 'string',
  gameRoomId: 'string',
  defaultBotDifficulty: 'string',
  botFillMode: 'string',
  wagerEnabled: 'boolean',
  wagerStatus: 'string',
  wagerToken: 'string',
  wagerCoverChargeLamports: 'string',
  wagerTreasuryWallet: 'string',
  wagerPlatformFeeBps: 'number',
  wagerPotLamports: 'string',
  wagerPaidPlayerCount: 'number',
  players: { map: LobbyPlayer },
  createdAt: 'number',
});
