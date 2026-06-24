import type { IncomingMessage } from 'http';
import { Client, ErrorCode, Room, ServerError } from 'colyseus';
import {
  AUTHENTICATION_REQUIRED_MESSAGE,
  isAuthenticationRequiredError,
  resolveRoomAuthContext,
  type RoomAuthContext,
} from '../auth/session';
import { socialEventBus } from '../social/eventBus';
import { loadSocialStateForUser, type SocialStatePayload } from '../social/service';
import { loggers } from '../utils/logger';

interface SocialJoinOptions {
  authToken?: string;
}

type SocialRefreshReason = 'initial' | 'event' | 'client' | 'invite_expired';

const SOCIAL_REFRESH_DEBOUNCE_MS = 50;
const MAX_INVITE_EXPIRY_TIMEOUT_MS = 2_147_483_647;

function nextInviteExpiryMs(social: SocialStatePayload): number | null {
  const now = Date.now();
  const expiresAt = [...social.lobbyInvites, ...social.partyInvites]
    .map((invite) => Date.parse(invite.expiresAt))
    .filter((value) => Number.isFinite(value) && value > now)
    .sort((left, right) => left - right)[0];

  if (!expiresAt) return null;
  return Math.min(Math.max(0, expiresAt - now + 25), MAX_INVITE_EXPIRY_TIMEOUT_MS);
}

export class SocialRoom extends Room {
  maxClients = 1;

  private authContext: RoomAuthContext | null = null;
  private unsubscribeSocial: (() => Promise<void>) | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshInFlight = false;
  private refreshQueued = false;
  private disposed = false;

  async onAuth(client: Client, options: SocialJoinOptions, request?: IncomingMessage): Promise<RoomAuthContext> {
    try {
      return await resolveRoomAuthContext(options as Record<string, unknown>, request);
    } catch (error) {
      if (isAuthenticationRequiredError(error)) {
        throw new ServerError(ErrorCode.AUTH_FAILED, AUTHENTICATION_REQUIRED_MESSAGE);
      }
      throw error;
    }
  }

  onCreate() {
    this.onMessage('refreshSocial', (client) => {
      if (!this.isAuthorizedClient(client)) return;
      this.queueSocialState('client');
    });
  }

  async onJoin(client: Client) {
    const authContext = (client as Client & { auth?: RoomAuthContext }).auth;
    if (!authContext) {
      client.send('error', { message: 'Authentication required' });
      client.leave();
      return;
    }

    this.authContext = authContext;
    try {
      this.unsubscribeSocial = await socialEventBus.subscribeToUser(authContext.userId, () => {
        this.queueSocialState('event');
      });
      await this.sendSocialState('initial');
    } catch (error) {
      loggers.room.error('Failed to initialize social room', {
        userId: authContext.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      client.send('error', { message: 'Failed to load social updates' });
      client.leave();
    }
  }

  onLeave() {
    this.disposed = true;
    this.cleanup();
  }

  onDispose() {
    this.disposed = true;
    this.cleanup();
  }

  private isAuthorizedClient(client: Client): boolean {
    return Boolean(this.authContext && this.clients.some((candidate) => candidate.sessionId === client.sessionId));
  }

  private queueSocialState(reason: SocialRefreshReason): void {
    if (this.disposed) return;

    if (this.refreshInFlight) {
      this.refreshQueued = true;
      return;
    }

    if (this.refreshTimer) {
      this.refreshQueued = true;
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.sendSocialState(reason).catch((error) => {
        loggers.room.error('Failed to send queued social state', {
          userId: this.authContext?.userId,
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, SOCIAL_REFRESH_DEBOUNCE_MS);
  }

  private async sendSocialState(reason: SocialRefreshReason): Promise<void> {
    if (this.disposed || !this.authContext) return;

    this.refreshInFlight = true;
    try {
      const social = await loadSocialStateForUser(this.authContext.userId);
      this.sendToConnectedClient('socialState', {
        social,
        reason,
        updatedAt: new Date().toISOString(),
      });
      this.scheduleInviteExpiryRefresh(social);
    } finally {
      this.refreshInFlight = false;
      if (this.refreshQueued) {
        this.refreshQueued = false;
        this.queueSocialState('event');
      }
    }
  }

  private sendToConnectedClient(type: string, payload: unknown): void {
    for (const client of this.clients) {
      client.send(type, payload);
    }
  }

  private scheduleInviteExpiryRefresh(social: SocialStatePayload): void {
    this.clearExpiryTimer();

    const expiresInMs = nextInviteExpiryMs(social);
    if (expiresInMs === null) return;

    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      this.queueSocialState('invite_expired');
    }, expiresInMs);
    this.expiryTimer.unref?.();
  }

  private cleanup(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.clearExpiryTimer();

    const unsubscribe = this.unsubscribeSocial;
    this.unsubscribeSocial = null;
    if (unsubscribe) {
      unsubscribe().catch((error) => {
        loggers.room.warn('Failed to unsubscribe social room', {
          userId: this.authContext?.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  private clearExpiryTimer(): void {
    if (!this.expiryTimer) return;
    clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }
}
