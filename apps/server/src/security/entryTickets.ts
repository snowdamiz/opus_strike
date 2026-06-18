import crypto from 'crypto';
import { isTeamId, type HeroId, type Team } from '@voxel-strike/shared';
import { createSignedTicket, readSignedTicketClaims } from './signedTicket';

export interface GameEntryTicketClaims {
  version: 1;
  lobbyId: string;
  gameRoomId: string;
  lobbyPlayerId: string;
  userId: string;
  displayName: string;
  assignedTeam?: Team;
  selectedHero?: HeroId;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface CreateGameEntryTicketInput {
  lobbyId: string;
  gameRoomId: string;
  lobbyPlayerId: string;
  userId: string;
  displayName: string;
  assignedTeam?: Team;
  selectedHero?: HeroId;
  ttlMs?: number;
}

const DEFAULT_TICKET_TTL_MS = 90_000;

export function createGameEntryTicket(input: CreateGameEntryTicketInput): string {
  const now = Date.now();
  const claims: GameEntryTicketClaims = {
    version: 1,
    lobbyId: input.lobbyId,
    gameRoomId: input.gameRoomId,
    lobbyPlayerId: input.lobbyPlayerId,
    userId: input.userId,
    displayName: input.displayName,
    assignedTeam: input.assignedTeam,
    selectedHero: input.selectedHero,
    issuedAt: now,
    expiresAt: now + (input.ttlMs ?? DEFAULT_TICKET_TTL_MS),
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  return createSignedTicket(claims);
}

export function verifyGameEntryTicket(
  ticket: unknown,
  expected: { lobbyId?: string | null; gameRoomId: string; now?: number }
): GameEntryTicketClaims | null {
  const claims = readSignedTicketClaims<GameEntryTicketClaims>(ticket);
  if (!claims) return null;

  const now = expected.now ?? Date.now();
  if (claims.version !== 1) return null;
  if (claims.gameRoomId !== expected.gameRoomId) return null;
  if (expected.lobbyId && claims.lobbyId !== expected.lobbyId) return null;
  if (claims.expiresAt < now) return null;
  if (claims.issuedAt > now + 5_000) return null;
  if (!isTeamId(claims.assignedTeam)) return null;
  if (!claims.userId || !claims.lobbyPlayerId || !claims.displayName || !claims.nonce) return null;

  return claims;
}
