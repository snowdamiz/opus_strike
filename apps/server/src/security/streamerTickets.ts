import crypto from 'node:crypto';
import { createSignedTicket, readSignedTicketClaims } from './signedTicket';

export const STREAMER_OBSERVER_TICKET_PURPOSE = 'streamer_observer' as const;

export interface StreamerObserverTicketClaims {
  version: 1;
  purpose: typeof STREAMER_OBSERVER_TICKET_PURPOSE;
  adminUserId: string;
  gameRoomId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface CreateStreamerObserverTicketInput {
  adminUserId: string;
  gameRoomId: string;
  ttlMs?: number;
}

const DEFAULT_STREAMER_TICKET_TTL_MS = 30_000;

export function createStreamerObserverTicket(input: CreateStreamerObserverTicketInput): string {
  const now = Date.now();
  const claims: StreamerObserverTicketClaims = {
    version: 1,
    purpose: STREAMER_OBSERVER_TICKET_PURPOSE,
    adminUserId: input.adminUserId,
    gameRoomId: input.gameRoomId,
    issuedAt: now,
    expiresAt: now + (input.ttlMs ?? DEFAULT_STREAMER_TICKET_TTL_MS),
    nonce: crypto.randomBytes(16).toString('hex'),
  };

  return createSignedTicket(claims);
}

export function verifyStreamerObserverTicket(
  ticket: unknown,
  expected: { gameRoomId: string; adminUserId?: string; now?: number }
): StreamerObserverTicketClaims | null {
  const claims = readSignedTicketClaims<StreamerObserverTicketClaims>(ticket);
  if (!claims) return null;

  const now = expected.now ?? Date.now();
  if (claims.version !== 1) return null;
  if (claims.purpose !== STREAMER_OBSERVER_TICKET_PURPOSE) return null;
  if (claims.gameRoomId !== expected.gameRoomId) return null;
  if (expected.adminUserId && claims.adminUserId !== expected.adminUserId) return null;
  if (!claims.adminUserId || !claims.nonce) return null;
  if (claims.expiresAt < now) return null;
  if (claims.issuedAt > now + 5_000) return null;

  return claims;
}
