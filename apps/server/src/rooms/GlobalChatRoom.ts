import type { IncomingMessage } from 'http';
import { Client, Room } from 'colyseus';
import { resolveRoomAuthContext, type RoomAuthContext } from '../auth/session';
import {
  createGlobalChatMessage,
  listRecentGlobalChatMessages,
  normalizeGlobalChatMessage,
  normalizeGlobalChatName,
  type GlobalChatMessageView,
} from '../chat/globalChatService';
import { LOBBY_MESSAGE_RATE_LIMITS, MessageRateLimiter } from './rateLimiter';
import { isRecord } from './protocolValidation';
import { loggers } from '../utils/logger';

interface GlobalChatJoinOptions {
  displayName?: string;
}

interface GlobalChatAuth {
  authContext: RoomAuthContext | null;
  displayName: string;
}

interface GlobalChatClientProfile {
  userId: string | null;
  displayName: string;
}

const GLOBAL_CHAT_MESSAGE_TOPIC = 'global_chat:message';

function isGlobalChatMessageView(value: unknown): value is GlobalChatMessageView {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof (value as GlobalChatMessageView).id === 'string'
      && typeof (value as GlobalChatMessageView).playerName === 'string'
      && typeof (value as GlobalChatMessageView).message === 'string'
      && typeof (value as GlobalChatMessageView).createdAt === 'string'
  );
}

export class GlobalChatRoom extends Room {
  private readonly rateLimiter = new MessageRateLimiter();
  private readonly profiles = new Map<string, GlobalChatClientProfile>();
  private readonly handleGlobalChatMessage = (message: unknown) => {
    if (!isGlobalChatMessageView(message)) {
      loggers.room.warn('Ignored malformed global chat message', { roomId: this.roomId });
      return;
    }

    this.broadcast('globalChatMessage', message);
  };

  async onAuth(
    _client: Client,
    options: GlobalChatJoinOptions,
    request?: IncomingMessage
  ): Promise<GlobalChatAuth> {
    try {
      const authContext = await resolveRoomAuthContext(options as Record<string, unknown>, request);
      return {
        authContext,
        displayName: authContext.displayName,
      };
    } catch {
      return {
        authContext: null,
        displayName: normalizeGlobalChatName(options?.displayName, 'Guest'),
      };
    }
  }

  onCreate() {
    this.setPrivate(true);

    Promise.resolve(this.presence.subscribe(GLOBAL_CHAT_MESSAGE_TOPIC, this.handleGlobalChatMessage))
      .catch((error) => {
        loggers.room.error('Failed to subscribe to global chat messages', {
          error: error instanceof Error ? error.message : String(error),
        });
      });

    this.onMessage('globalChatSend', (client, data: unknown) => {
      void this.handleSendMessage(client, data);
    });
  }

  onDispose() {
    Promise.resolve(this.presence.unsubscribe(GLOBAL_CHAT_MESSAGE_TOPIC, this.handleGlobalChatMessage))
      .catch((error) => {
        loggers.room.warn('Failed to unsubscribe from global chat messages', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  async onJoin(client: Client) {
    const auth = (client as Client & { auth?: GlobalChatAuth }).auth;
    const profile = {
      userId: auth?.authContext?.userId ?? null,
      displayName: normalizeGlobalChatName(auth?.displayName, 'Guest'),
    };
    this.profiles.set(client.sessionId, profile);

    try {
      client.send('globalChatHistory', {
        messages: await listRecentGlobalChatMessages(),
      });
    } catch (error) {
      loggers.room.error('Failed to load global chat history', {
        error: error instanceof Error ? error.message : String(error),
      });
      client.send('globalChatError', { message: 'Chat history unavailable' });
    }
  }

  onLeave(client: Client) {
    this.profiles.delete(client.sessionId);
    this.rateLimiter.clearScope(client.sessionId);
  }

  private async handleSendMessage(client: Client, data: unknown): Promise<void> {
    if (!this.rateLimiter.consume(client.sessionId, 'globalChat', LOBBY_MESSAGE_RATE_LIMITS.chat)) {
      client.send('globalChatError', { message: 'Slow down before sending another message' });
      return;
    }

    if (!isRecord(data)) return;

    const message = normalizeGlobalChatMessage(data.message);
    if (!message) return;

    const profile = this.profiles.get(client.sessionId) ?? {
      userId: null,
      displayName: 'Guest',
    };

    try {
      const saved = await createGlobalChatMessage({
        userId: profile.userId,
        playerName: profile.displayName,
        message,
      });
      await this.presence.publish(GLOBAL_CHAT_MESSAGE_TOPIC, saved);
    } catch (error) {
      loggers.room.error('Failed to save global chat message', {
        sessionId: client.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      client.send('globalChatError', { message: 'Message failed to send' });
    }
  }
}
