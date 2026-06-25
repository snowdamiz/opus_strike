import prisma from '../db';

export const GLOBAL_CHAT_HISTORY_LIMIT = 80;
export const GLOBAL_CHAT_MAX_MESSAGE_LENGTH = 220;
export const GLOBAL_CHAT_MAX_NAME_LENGTH = 24;

export interface GlobalChatMessageView {
  id: string;
  userId: string | null;
  playerName: string;
  message: string;
  createdAt: string;
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
  return text || null;
}

export function normalizeGlobalChatMessage(value: unknown): string | null {
  return normalizeText(value, GLOBAL_CHAT_MAX_MESSAGE_LENGTH);
}

export function normalizeGlobalChatName(value: unknown, fallback = 'Player'): string {
  return normalizeText(value, GLOBAL_CHAT_MAX_NAME_LENGTH) ?? fallback;
}

function toGlobalChatMessageView(row: {
  id: string;
  userId: string | null;
  playerName: string;
  message: string;
  createdAt: Date;
}): GlobalChatMessageView {
  return {
    id: row.id,
    userId: row.userId,
    playerName: row.playerName,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listRecentGlobalChatMessages(
  limit = GLOBAL_CHAT_HISTORY_LIMIT
): Promise<GlobalChatMessageView[]> {
  const safeLimit = Math.max(1, Math.min(GLOBAL_CHAT_HISTORY_LIMIT, Math.floor(limit)));
  const rows = await prisma.globalChatMessage.findMany({
    orderBy: { createdAt: 'desc' },
    take: safeLimit,
  });

  return rows.reverse().map(toGlobalChatMessageView);
}

export async function createGlobalChatMessage(input: {
  userId?: string | null;
  playerName: string;
  message: string;
}): Promise<GlobalChatMessageView> {
  const message = normalizeGlobalChatMessage(input.message);
  if (!message) throw new Error('Message is required');

  const row = await prisma.globalChatMessage.create({
    data: {
      userId: input.userId ?? null,
      playerName: normalizeGlobalChatName(input.playerName),
      message,
    },
  });

  return toGlobalChatMessageView(row);
}
