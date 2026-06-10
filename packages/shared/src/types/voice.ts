import type { Team } from './player.js';

export type VoiceScope = 'match';
export type VoiceConnectionMode = 'team';

export interface VoiceParticipantMetadata {
  displayName: string;
  colyseusSessionId: string;
  team: Team;
  lobbyId: string | null;
  gameRoomId: string;
  human: boolean;
}

export interface VoiceTokenRequest {
  requestId: string;
  scope?: VoiceScope;
}

export interface VoiceTokenResponse {
  requestId: string;
  enabled: boolean;
  scope: VoiceScope;
  mode: VoiceConnectionMode;
  url?: string;
  token?: string;
  roomName?: string;
  identity?: string;
  playerId?: string;
  team?: Team;
  ttlSeconds?: number;
  expiresAt?: number;
  reason?: string;
}

export interface VoiceTeamChangedMessage {
  team: Team;
  previousTeam: Team;
}
