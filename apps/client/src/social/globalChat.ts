import { useEffect } from 'react';
import { Client, type Room } from 'colyseus.js';
import { create } from 'zustand';
import { config } from '../config/environment';
import { loggers } from '../utils/logger';

export interface GlobalChatMessage {
  id: string;
  userId: string | null;
  playerName: string;
  message: string;
  createdAt: string;
}

type GlobalChatStatus = 'idle' | 'connecting' | 'connected' | 'error';

interface GlobalChatHistoryMessage {
  messages: unknown;
}

interface GlobalChatState {
  messages: GlobalChatMessage[];
  status: GlobalChatStatus;
  error: string | null;
  hasLoaded: boolean;
  setConnecting: () => void;
  setConnected: () => void;
  setError: (error: string) => void;
  setHistory: (payload: unknown) => void;
  addMessage: (payload: unknown) => void;
  reset: () => void;
}

const MAX_VISIBLE_GLOBAL_CHAT_MESSAGES = 80;
const BASE_RECONNECT_DELAY_MS = 750;
const MAX_RECONNECT_DELAY_MS = 10_000;
const RECONNECT_JITTER_MS = 350;

let client: Client | null = null;
let room: Room | null = null;
let connectPromise: Promise<void> | null = null;
let reconnectTimer: number | null = null;
let retainCount = 0;
let activeDisplayName: string | null = null;
let reconnectAttempts = 0;
let intentionallyClosed = false;

export const useGlobalChatStore = create<GlobalChatState>((set) => ({
  messages: [],
  status: 'idle',
  error: null,
  hasLoaded: false,
  setConnecting: () => set((state) => ({
    status: state.hasLoaded ? state.status : 'connecting',
    error: null,
  })),
  setConnected: () => set({ status: 'connected', error: null }),
  setError: (error) => set({ status: 'error', error }),
  setHistory: (payload) => {
    const messages = parseGlobalChatHistory(payload);
    set({
      messages,
      status: 'connected',
      error: null,
      hasLoaded: true,
    });
  },
  addMessage: (payload) => {
    const message = parseGlobalChatMessage(payload);
    if (!message) return;

    set((state) => {
      const existingIndex = state.messages.findIndex((item) => item.id === message.id);
      const messages = existingIndex >= 0
        ? state.messages.map((item, index) => (index === existingIndex ? message : item))
        : [...state.messages, message];

      return {
        messages: sortGlobalChatMessages(messages).slice(-MAX_VISIBLE_GLOBAL_CHAT_MESSAGES),
        status: 'connected',
        error: null,
        hasLoaded: true,
      };
    });
  },
  reset: () => set({
    messages: [],
    status: 'idle',
    error: null,
    hasLoaded: false,
  }),
}));

export function useGlobalChat(displayName: string | null | undefined): void {
  useEffect(() => {
    const normalizedDisplayName = normalizeDisplayName(displayName);
    return retainGlobalChat(normalizedDisplayName);
  }, [displayName]);
}

export function sendGlobalChatMessage(message: string): boolean {
  const normalizedMessage = message.trim();
  if (!room || !normalizedMessage) return false;
  room.send('globalChatSend', { message: normalizedMessage });
  return true;
}

function parseGlobalChatMessage(value: unknown): GlobalChatMessage | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<GlobalChatMessage>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.playerName !== 'string' ||
    typeof candidate.message !== 'string' ||
    typeof candidate.createdAt !== 'string'
  ) {
    return null;
  }

  const date = new Date(candidate.createdAt);
  if (Number.isNaN(date.getTime())) return null;

  return {
    id: candidate.id,
    userId: typeof candidate.userId === 'string' ? candidate.userId : null,
    playerName: candidate.playerName.trim() || 'Player',
    message: candidate.message,
    createdAt: date.toISOString(),
  };
}

function parseGlobalChatHistory(value: unknown): GlobalChatMessage[] {
  if (!value || typeof value !== 'object') return [];
  const messages = (value as GlobalChatHistoryMessage).messages;
  if (!Array.isArray(messages)) return [];
  return sortGlobalChatMessages(messages
    .map(parseGlobalChatMessage)
    .filter((message): message is GlobalChatMessage => Boolean(message)))
    .slice(-MAX_VISIBLE_GLOBAL_CHAT_MESSAGES);
}

function sortGlobalChatMessages(messages: GlobalChatMessage[]): GlobalChatMessage[] {
  return [...messages].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id.localeCompare(right.id);
  });
}

function normalizeDisplayName(displayName: string | null | undefined): string {
  const normalized = displayName?.trim().replace(/\s+/g, ' ').slice(0, 24);
  return normalized || 'Guest';
}

function retainGlobalChat(displayName: string): () => void {
  if (activeDisplayName && activeDisplayName !== displayName) {
    closeGlobalChatRoom();
    useGlobalChatStore.getState().reset();
  }

  activeDisplayName = displayName;
  retainCount += 1;
  intentionallyClosed = false;
  void connectGlobalChatRoom(displayName);

  return () => {
    retainCount = Math.max(0, retainCount - 1);
    if (retainCount === 0) {
      closeGlobalChatRoom();
    }
  };
}

function getClient(): Client {
  if (!client) {
    client = new Client(config.serverUrl);
  }
  return client;
}

function connectGlobalChatRoom(displayName: string): Promise<void> {
  if (room || connectPromise) {
    return connectPromise ?? Promise.resolve();
  }

  clearReconnectTimer();
  useGlobalChatStore.getState().setConnecting();

  connectPromise = getClient().create('global_chat_room', { displayName })
    .then((nextRoom) => {
      if (activeDisplayName !== displayName || retainCount === 0 || intentionallyClosed) {
        nextRoom.leave(false);
        return;
      }

      room = nextRoom;
      reconnectAttempts = 0;
      useGlobalChatStore.getState().setConnected();

      nextRoom.onMessage('globalChatHistory', (payload: unknown) => {
        useGlobalChatStore.getState().setHistory(payload);
      });

      nextRoom.onMessage('globalChatMessage', (payload: unknown) => {
        useGlobalChatStore.getState().addMessage(payload);
      });

      nextRoom.onMessage('globalChatError', (payload: unknown) => {
        const message = payload && typeof payload === 'object' && 'message' in payload
          ? String((payload as { message?: unknown }).message || 'Chat unavailable')
          : 'Chat unavailable';
        useGlobalChatStore.getState().setError(message);
      });

      nextRoom.onError((_code, message) => {
        useGlobalChatStore.getState().setError(message || 'Chat connection failed');
      });

      nextRoom.onLeave(() => {
        if (room !== nextRoom) return;
        room = null;
        if (!intentionallyClosed && retainCount > 0 && activeDisplayName === displayName) {
          scheduleReconnect(displayName);
        }
      });
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Failed to connect chat';
      loggers.network.warn('global chat connection failed', error);
      useGlobalChatStore.getState().setError(message);
      scheduleReconnect(displayName);
    })
    .finally(() => {
      connectPromise = null;
    });

  return connectPromise;
}

function scheduleReconnect(displayName: string): void {
  clearReconnectTimer();
  reconnectAttempts += 1;
  const delay = Math.min(MAX_RECONNECT_DELAY_MS, BASE_RECONNECT_DELAY_MS * 2 ** (reconnectAttempts - 1));
  const jitter = Math.floor(Math.random() * RECONNECT_JITTER_MS);
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (retainCount > 0 && activeDisplayName === displayName && !intentionallyClosed) {
      void connectGlobalChatRoom(displayName);
    }
  }, delay + jitter);
}

function closeGlobalChatRoom(): void {
  intentionallyClosed = true;
  clearReconnectTimer();
  reconnectAttempts = 0;
  connectPromise = null;
  if (room) {
    room.leave(false);
    room = null;
  }
  activeDisplayName = null;
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}
