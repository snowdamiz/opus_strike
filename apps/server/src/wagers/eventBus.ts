import { EventEmitter } from 'node:events';
import { matchMaker, type Presence } from 'colyseus';
import { getColyseusRuntimeConfig, type ColyseusRuntimeConfig } from '../config/colyseus';
import { loggers } from '../utils/logger';
import type { WagerPaymentStatusChanged } from './service';

type WagerPaymentStatusHandler = (payload: WagerPaymentStatusChanged) => void | Promise<void>;

export function wagerLobbyChannel(lobbyId: string): string {
  return `wager:lobby:${lobbyId}`;
}

function isWagerPaymentStatusChanged(value: unknown): value is WagerPaymentStatusChanged {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof (value as WagerPaymentStatusChanged).lobbyId === 'string'
      && typeof (value as WagerPaymentStatusChanged).userId === 'string'
      && typeof (value as WagerPaymentStatusChanged).status === 'string'
  );
}

export class WagerEventBus {
  private readonly localEmitter = new EventEmitter();

  constructor(
    private readonly getConfig: () => ColyseusRuntimeConfig = getColyseusRuntimeConfig,
    private readonly getPresence: () => Presence | undefined = () => matchMaker.presence
  ) {
    this.localEmitter.setMaxListeners(0);
  }

  async publishPaymentStatusChanged(payload: WagerPaymentStatusChanged): Promise<void> {
    const channel = wagerLobbyChannel(payload.lobbyId);

    if (!this.getConfig().distributed) {
      this.localEmitter.emit(channel, payload);
      return;
    }

    const presence = this.getPresence();
    if (!presence) {
      throw new Error('Colyseus presence is not available for distributed wager events');
    }

    await presence.publish(channel, payload);
    loggers.room.debug('Published wager payment status event', {
      lobbyId: payload.lobbyId,
      channel,
      userId: payload.userId,
      status: payload.status,
      processId: matchMaker.processId,
      pid: process.pid,
    });
  }

  async subscribeToLobby(lobbyId: string, handler: WagerPaymentStatusHandler): Promise<() => Promise<void>> {
    const channel = wagerLobbyChannel(lobbyId);
    const wrapped = (payload: unknown) => {
      if (!isWagerPaymentStatusChanged(payload)) {
        loggers.room.warn('Ignored malformed wager payment status event', { lobbyId, channel });
        return;
      }

      Promise.resolve(handler(payload)).catch((error) => {
        loggers.room.error('Wager payment status handler failed', {
          lobbyId,
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
      throw new Error('Colyseus presence is not available for distributed wager events');
    }

    await presence.subscribe(channel, wrapped);
    loggers.room.debug('Subscribed to wager lobby channel', {
      lobbyId,
      channel,
      processId: matchMaker.processId,
      pid: process.pid,
    });

    return async () => {
      await presence.unsubscribe(channel, wrapped);
      loggers.room.debug('Unsubscribed from wager lobby channel', {
        lobbyId,
        channel,
        processId: matchMaker.processId,
        pid: process.pid,
      });
    };
  }
}

export const wagerEventBus = new WagerEventBus();
