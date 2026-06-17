export const ROOM_CHAT_MESSAGE_MAX_LENGTH = 200;

export interface RoomChatPayload {
  playerId: string;
  playerName: string;
  message: string;
  teamOnly: boolean;
  timestamp: number;
}

export interface LobbyChatPayload {
  playerId: string;
  playerName: string;
  message: string;
  timestamp: number;
}

export interface RoomChatRecipientPlayer {
  team?: string | null;
}

export interface RoomChatRecipientCollection {
  forEach(callback: (player: RoomChatRecipientPlayer, sessionId: string) => void): void;
}

export function normalizeRoomChatMessage(
  message: string,
  maxLength = ROOM_CHAT_MESSAGE_MAX_LENGTH
): string | null {
  if (!message.trim()) return null;
  return message.substring(0, maxLength);
}

export function normalizeLobbyChatMessage(
  message: string,
  maxLength = ROOM_CHAT_MESSAGE_MAX_LENGTH
): string | null {
  const normalizedMessage = message.trim().substring(0, maxLength);
  return normalizedMessage || null;
}

export function buildRoomChatPayload(input: {
  playerId: string;
  playerName: string;
  message: string;
  teamOnly: boolean;
  timestamp: number;
}): RoomChatPayload | null {
  const normalizedMessage = normalizeRoomChatMessage(input.message);
  if (normalizedMessage === null) return null;

  return {
    playerId: input.playerId,
    playerName: input.playerName,
    message: normalizedMessage,
    teamOnly: input.teamOnly,
    timestamp: input.timestamp,
  };
}

export function buildLobbyChatPayload(input: {
  playerId: string;
  playerName: string;
  message: string;
  timestamp: number;
}): LobbyChatPayload | null {
  const normalizedMessage = normalizeLobbyChatMessage(input.message);
  if (normalizedMessage === null) return null;

  return {
    playerId: input.playerId,
    playerName: input.playerName,
    message: normalizedMessage,
    timestamp: input.timestamp,
  };
}

export function getRoomChatRecipientIds(input: {
  players: RoomChatRecipientCollection;
  senderTeam?: string | null;
  teamOnly: boolean;
}): string[] {
  const recipientIds: string[] = [];
  input.players.forEach((player, sessionId) => {
    if (!input.teamOnly || player.team === input.senderTeam) {
      recipientIds.push(sessionId);
    }
  });
  return recipientIds;
}
