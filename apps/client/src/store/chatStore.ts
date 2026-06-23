import { create } from 'zustand';

export type ChatMessageScope = 'lobby' | 'game';

export interface ChatMessage {
  id: string;
  scope: ChatMessageScope;
  playerId: string;
  playerName: string;
  message: string;
  teamOnly: boolean;
  timestamp: number;
}

interface ChatStoreState {
  messages: ChatMessage[];
  addIncomingMessage: (scope: ChatMessageScope, payload: unknown) => void;
  clearMessages: () => void;
}

const MAX_CHAT_MESSAGES = 80;
const MAX_CHAT_TEXT_LENGTH = 200;
const MAX_CHAT_NAME_LENGTH = 32;

let chatMessageSequence = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
  return text || null;
}

function readTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : Date.now();
}

export function parseIncomingChatMessage(scope: ChatMessageScope, payload: unknown): ChatMessage | null {
  if (!isRecord(payload)) return null;

  const message = sanitizeText(payload.message, MAX_CHAT_TEXT_LENGTH);
  if (!message) return null;

  const playerName = sanitizeText(payload.playerName, MAX_CHAT_NAME_LENGTH) ?? 'Player';
  const playerId = sanitizeText(payload.playerId, 96) ?? 'unknown';
  const timestamp = readTimestamp(payload.timestamp);

  chatMessageSequence += 1;

  return {
    id: `${scope}:${timestamp}:${chatMessageSequence}`,
    scope,
    playerId,
    playerName,
    message,
    teamOnly: payload.teamOnly === true,
    timestamp,
  };
}

export const useChatStore = create<ChatStoreState>((set) => ({
  messages: [],

  addIncomingMessage: (scope, payload) => {
    const message = parseIncomingChatMessage(scope, payload);
    if (!message) return;

    set((state) => ({
      messages: [...state.messages, message].slice(-MAX_CHAT_MESSAGES),
    }));
  },

  clearMessages: () => set((state) => (
    state.messages.length === 0 ? state : { messages: [] }
  )),
}));
