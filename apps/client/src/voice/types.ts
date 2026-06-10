import type { Team } from '@voxel-strike/shared';

export type VoiceScope = 'match';

export interface VoiceParticipantMetadata {
  displayName: string;
  colyseusSessionId: string;
  team: Team;
  lobbyId: string | null;
  gameRoomId: string;
  human: boolean;
}

export interface VoiceTokenResponse {
  requestId: string;
  enabled: boolean;
  scope: VoiceScope;
  mode: 'team';
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
