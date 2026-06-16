import crypto from 'crypto';
import type { HeroId, Team } from '@voxel-strike/shared';
import { getEntryTicketSecret } from '../config/security';

export interface GameEntryTicketClaims {
  version: 1;
  lobbyId: string;
  gameRoomId: string;
  lobbyPlayerId: string;
  userId: string;
  displayName: string;
  assignedTeam?: Team;
  selectedHero?: HeroId;
  observer?: boolean;
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
  observer?: boolean;
  ttlMs?: number;
}

const DEFAULT_TICKET_TTL_MS = 90_000;

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(padded, 'base64');
}

function signPayload(payload: string): string {
  return base64UrlEncode(
    crypto.createHmac('sha256', getEntryTicketSecret()).update(payload).digest()
  );
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

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
    observer: input.observer === true ? true : undefined,
    issuedAt: now,
    expiresAt: now + (input.ttlMs ?? DEFAULT_TICKET_TTL_MS),
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  const payload = base64UrlEncode(JSON.stringify(claims));
  return `${payload}.${signPayload(payload)}`;
}

export function verifyGameEntryTicket(
  ticket: unknown,
  expected: { lobbyId?: string | null; gameRoomId: string; now?: number }
): GameEntryTicketClaims | null {
  if (typeof ticket !== 'string' || ticket.length > 4096) return null;

  const [payload, signature, ...extra] = ticket.split('.');
  if (!payload || !signature || extra.length > 0) return null;
  if (!safeEqual(signPayload(payload), signature)) return null;

  let claims: GameEntryTicketClaims;
  try {
    claims = JSON.parse(base64UrlDecode(payload).toString('utf8')) as GameEntryTicketClaims;
  } catch {
    return null;
  }

  const now = expected.now ?? Date.now();
  if (claims.version !== 1) return null;
  if (claims.gameRoomId !== expected.gameRoomId) return null;
  if (expected.lobbyId && claims.lobbyId !== expected.lobbyId) return null;
  if (claims.expiresAt < now) return null;
  if (claims.issuedAt > now + 5_000) return null;
  const isObserver = claims.observer === true;
  if (!isObserver && claims.assignedTeam !== 'red' && claims.assignedTeam !== 'blue') return null;
  if (isObserver && claims.assignedTeam !== undefined && claims.assignedTeam !== 'red' && claims.assignedTeam !== 'blue') return null;
  if (!claims.userId || !claims.lobbyPlayerId || !claims.displayName || !claims.nonce) return null;

  return claims;
}
