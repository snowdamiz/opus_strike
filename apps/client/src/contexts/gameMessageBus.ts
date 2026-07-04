export interface GameMessageBus {
  id: string;
  sessionId: string;
  state?: {
    players?: unknown;
  };
  onMessage<T = unknown>(type: string, callback: (message: T) => void): void;
  send(type: string, message?: unknown): void;
  onError?(callback: (code: number, message?: string) => void): void;
  onLeave?(callback: (code: number) => void): void;
  leave?(consented?: boolean): void;
}
