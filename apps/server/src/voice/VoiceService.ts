import { AccessToken, RoomServiceClient, TrackSource, type CreateOptions } from 'livekit-server-sdk';
import type { Team } from '@voxel-strike/shared';
import { loggers } from '../utils/logger';
import { resolveVoiceConfig, type VoiceConfig } from './config';

type VoiceScope = 'match';

interface VoiceParticipantMetadata {
  displayName: string;
  colyseusSessionId: string;
  team: Team;
  lobbyId: string | null;
  gameRoomId: string;
  human: boolean;
}

interface VoiceTokenResponse {
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

interface IssueMatchVoiceTokenInput {
  requestId: string;
  playerId: string;
  identity: string;
  displayName: string;
  team: Team;
  lobbyId: string | null;
  gameRoomId: string;
  human: boolean;
  canPublish: boolean;
}

interface VoiceMetrics {
  tokensIssued: number;
  tokenFailures: number;
  cleanupAttempts: number;
  cleanupFailures: number;
  roomsEnsured: number;
  roomEnsureFailures: number;
}

export class VoiceService {
  private readonly ensuredRooms = new Set<string>();
  private readonly metrics: VoiceMetrics = {
    tokensIssued: 0,
    tokenFailures: 0,
    cleanupAttempts: 0,
    cleanupFailures: 0,
    roomsEnsured: 0,
    roomEnsureFailures: 0,
  };

  constructor(
    private readonly config: VoiceConfig = resolveVoiceConfig(),
    private readonly roomClient: Pick<RoomServiceClient, 'createRoom' | 'removeParticipant'> | null =
      config.enabled && config.livekitUrl && config.apiKey && config.apiSecret
        ? new RoomServiceClient(config.livekitUrl, config.apiKey, config.apiSecret)
        : null
  ) {
    if (!config.enabled && config.requested) {
      loggers.voice.warn('voice disabled by incomplete configuration', config.disabledReason);
    }
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getStatus() {
    return {
      enabled: this.config.enabled,
      requested: this.config.requested,
      disabledReason: this.config.disabledReason,
      livekitWsUrlConfigured: Boolean(this.config.livekitWsUrl),
      livekitUrlConfigured: Boolean(this.config.livekitUrl),
      ttlSeconds: this.config.tokenTtlSeconds,
      environmentName: this.config.environmentName,
      metrics: { ...this.metrics },
    };
  }

  buildMatchTeamRoomName(gameRoomId: string, team: Team): string {
    return `opus:${this.config.environmentName}:match:${gameRoomId}:${team}`;
  }

  buildLobbyRoomName(lobbyId: string): string {
    return `opus:${this.config.environmentName}:lobby:${lobbyId}`;
  }

  createDisabledResponse(requestId: string, reason = this.config.disabledReason || 'voice disabled'): VoiceTokenResponse {
    return {
      requestId,
      enabled: false,
      scope: 'match',
      mode: 'team',
      reason,
    };
  }

  async issueMatchVoiceToken(input: IssueMatchVoiceTokenInput): Promise<VoiceTokenResponse> {
    const scope: VoiceScope = 'match';
    if (!this.config.enabled || !this.config.livekitWsUrl || !this.config.apiKey || !this.config.apiSecret) {
      return this.createDisabledResponse(input.requestId);
    }

    if (!input.human) {
      return this.createDisabledResponse(input.requestId, 'bots cannot join voice');
    }

    const roomName = this.buildMatchTeamRoomName(input.gameRoomId, input.team);
    const now = Date.now();
    const expiresAt = now + this.config.tokenTtlSeconds * 1000;
    const metadata: VoiceParticipantMetadata = {
      displayName: input.displayName,
      colyseusSessionId: input.playerId,
      team: input.team,
      lobbyId: input.lobbyId,
      gameRoomId: input.gameRoomId,
      human: input.human,
    };

    try {
      await this.ensureRoom(roomName);

      const token = new AccessToken(this.config.apiKey, this.config.apiSecret, {
        identity: input.identity,
        name: input.displayName,
        metadata: JSON.stringify(metadata),
        ttl: this.config.tokenTtlSeconds,
      });

      token.addGrant({
        roomJoin: true,
        room: roomName,
        canSubscribe: true,
        canPublish: input.canPublish,
        canPublishData: false,
        canPublishSources: input.canPublish ? [TrackSource.MICROPHONE] : [],
      });

      this.metrics.tokensIssued++;
      loggers.voice.info('issued voice token', {
        identity: input.identity,
        playerId: input.playerId,
        team: input.team,
        roomName,
        expiresAt,
      });

      return {
        requestId: input.requestId,
        enabled: true,
        scope,
        mode: 'team',
        url: this.config.livekitWsUrl,
        token: await token.toJwt(),
        roomName,
        identity: input.identity,
        playerId: input.playerId,
        team: input.team,
        ttlSeconds: this.config.tokenTtlSeconds,
        expiresAt,
      };
    } catch (error) {
      this.metrics.tokenFailures++;
      loggers.voice.error('failed to issue voice token', {
        playerId: input.playerId,
        identity: input.identity,
        roomName,
        error,
      });
      return this.createDisabledResponse(input.requestId, 'voice token unavailable');
    }
  }

  async removeMatchParticipant(
    gameRoomId: string,
    identity: string,
    team?: Team | null,
    reason = 'game_lifecycle'
  ): Promise<void> {
    if (!this.config.enabled || !this.roomClient) return;

    const teams: Team[] = team ? [team] : ['red', 'blue'];
    await Promise.all(teams.map(async (candidateTeam) => {
      const roomName = this.buildMatchTeamRoomName(gameRoomId, candidateTeam);
      await this.removeParticipant(roomName, identity, reason);
    }));
  }

  private async ensureRoom(roomName: string): Promise<void> {
    if (!this.roomClient || this.ensuredRooms.has(roomName)) return;

    const options: CreateOptions = {
      name: roomName,
      emptyTimeout: 60,
      departureTimeout: 20,
      maxParticipants: this.config.maxParticipantsPerRoom,
      metadata: JSON.stringify({
        product: 'opus-strike',
        environment: this.config.environmentName,
        voice: true,
      }),
    };

    try {
      await this.roomClient.createRoom(options);
      this.metrics.roomsEnsured++;
      this.ensuredRooms.add(roomName);
      loggers.voice.info('ensured LiveKit voice room', roomName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already exists|already_exist|exists/i.test(message)) {
        this.ensuredRooms.add(roomName);
        return;
      }

      this.metrics.roomEnsureFailures++;
      throw error;
    }
  }

  private async removeParticipant(roomName: string, identity: string, reason: string): Promise<void> {
    if (!this.roomClient) return;

    this.metrics.cleanupAttempts++;
    try {
      await this.roomClient.removeParticipant(roomName, identity, {
        revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)),
      });
      loggers.voice.info('removed voice participant', { roomName, identity, reason });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not[ _-]?found|participant|room/i.test(message) && /not[ _-]?found|does not exist|not exist/i.test(message)) {
        loggers.voice.debug('voice participant already absent', { roomName, identity, reason });
        return;
      }

      this.metrics.cleanupFailures++;
      loggers.voice.warn('failed to remove voice participant', { roomName, identity, reason, error });
    }
  }
}

export const voiceService = new VoiceService();
