export interface RoomJoinCapacityInput {
  playerCount: number;
  maxPlayers: number;
}

export interface RoomJoinPlayerNameInput {
  ticketDisplayName?: string | null;
  authDisplayName?: string | null;
  playerNumber: number;
}

export interface JoinedPlayerActivationInput {
  phase: string;
  heroId?: string | null;
}

export function shouldRejectRoomJoinForCapacity(input: RoomJoinCapacityInput): boolean {
  return input.playerCount >= input.maxPlayers;
}

export function resolveRoomJoinPlayerName(input: RoomJoinPlayerNameInput): string {
  return input.ticketDisplayName || input.authDisplayName || `Player${input.playerNumber}`;
}

export function shouldActivateJoinedPlayer(input: JoinedPlayerActivationInput): boolean {
  return (
    input.phase === 'countdown' ||
    input.phase === 'deployment' ||
    input.phase === 'playing'
  ) && Boolean(input.heroId);
}
