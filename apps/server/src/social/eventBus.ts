import { EventEmitter } from 'node:events';
import { matchMaker, type Presence } from 'colyseus';
import { getColyseusRuntimeConfig, type ColyseusRuntimeConfig } from '../config/colyseus';
import { loggers } from '../utils/logger';

export type SocialChangeReason =
  | 'friend_request_created'
  | 'friend_request_accepted'
  | 'friend_request_declined'
  | 'friend_request_canceled'
  | 'friend_removed'
  | 'party_invite_created'
  | 'party_invite_accepted'
  | 'party_invite_declined'
  | 'party_invite_canceled'
  | 'lobby_invite_created'
  | 'lobby_invite_accepted'
  | 'lobby_invite_declined'
  | 'lobby_invite_canceled';

export interface SocialChangedEvent {
  userId: string;
  reason: SocialChangeReason;
  changedAt: string;
}

type SocialChangedHandler = (payload: SocialChangedEvent) => void | Promise<void>;

export function socialUserChannel(userId: string): string {
  return `social:user:${userId}`;
}

function isSocialChangedEvent(value: unknown): value is SocialChangedEvent {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof (value as SocialChangedEvent).userId === 'string'
      && typeof (value as SocialChangedEvent).reason === 'string'
      && typeof (value as SocialChangedEvent).changedAt === 'string'
  );
}

function uniqueUserIds(userIds: readonly string[]): string[] {
  return [...new Set(userIds.map((userId) => userId.trim()).filter(Boolean))];
}

export class SocialEventBus {
  private readonly localEmitter = new EventEmitter();

  constructor(
    private readonly getConfig: () => ColyseusRuntimeConfig = getColyseusRuntimeConfig,
    private readonly getPresence: () => Presence | undefined = () => matchMaker.presence
  ) {
    this.localEmitter.setMaxListeners(0);
  }

  async publishSocialChanged(userIds: readonly string[], reason: SocialChangeReason): Promise<void> {
    const changedAt = new Date().toISOString();

    await Promise.all(uniqueUserIds(userIds).map(async (userId) => {
      const channel = socialUserChannel(userId);
      const payload: SocialChangedEvent = { userId, reason, changedAt };

      if (!this.getConfig().distributed) {
        this.localEmitter.emit(channel, payload);
        return;
      }

      const presence = this.getPresence();
      if (!presence) {
        throw new Error('Colyseus presence is not available for distributed social events');
      }

      await presence.publish(channel, payload);
      loggers.room.debug('Published social change event', {
        userId,
        reason,
        channel,
        processId: matchMaker.processId,
        pid: process.pid,
      });
    }));
  }

  async subscribeToUser(userId: string, handler: SocialChangedHandler): Promise<() => Promise<void>> {
    const channel = socialUserChannel(userId);
    const wrapped = (payload: unknown) => {
      if (!isSocialChangedEvent(payload) || payload.userId !== userId) {
        loggers.room.warn('Ignored malformed social change event', { userId, channel });
        return;
      }

      Promise.resolve(handler(payload)).catch((error) => {
        loggers.room.error('Social change handler failed', {
          userId,
          channel,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };

    if (!this.getConfig().distributed) {
      this.localEmitter.on(channel, wrapped);
      return async () => {
        this.localEmitter.off(channel, wrapped);
      };
    }

    const presence = this.getPresence();
    if (!presence) {
      throw new Error('Colyseus presence is not available for distributed social events');
    }

    await presence.subscribe(channel, wrapped);
    loggers.room.debug('Subscribed to social user channel', {
      userId,
      channel,
      processId: matchMaker.processId,
      pid: process.pid,
    });

    return async () => {
      await presence.unsubscribe(channel, wrapped);
      loggers.room.debug('Unsubscribed from social user channel', {
        userId,
        channel,
        processId: matchMaker.processId,
        pid: process.pid,
      });
    };
  }
}

export const socialEventBus = new SocialEventBus();
