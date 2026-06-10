import crypto from 'crypto';
import { getEntryTicketSecret } from '../config/security';
import {
  DEFAULT_MATCHMAKING_RATING,
  DEFAULT_MATCHMAKING_SKILL_BUCKET,
  normalizeSkillBucket,
  type MatchmakingSkillBucket,
} from '../matchmaking/skill';

export interface MatchmakingTicketClaims {
  version: 1;
  userId: string;
  skillRating: number;
  skillBucket: MatchmakingSkillBucket;
  targetSkillBucket: MatchmakingSkillBucket;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface CreateMatchmakingTicketInput {
  userId: string;
  skillRating: number;
  skillBucket: MatchmakingSkillBucket;
  targetSkillBucket: MatchmakingSkillBucket;
  ttlMs?: number;
}

const DEFAULT_TICKET_TTL_MS = 60_000;

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

export function createMatchmakingTicket(input: CreateMatchmakingTicketInput): {
  ticket: string;
  claims: MatchmakingTicketClaims;
} {
  const now = Date.now();
  const claims: MatchmakingTicketClaims = {
    version: 1,
    userId: input.userId,
    skillRating: Math.round(Number.isFinite(input.skillRating) ? input.skillRating : DEFAULT_MATCHMAKING_RATING),
    skillBucket: normalizeSkillBucket(input.skillBucket),
    targetSkillBucket: normalizeSkillBucket(input.targetSkillBucket),
    issuedAt: now,
    expiresAt: now + (input.ttlMs ?? DEFAULT_TICKET_TTL_MS),
    nonce: crypto.randomBytes(16).toString('hex'),
  };

  const payload = base64UrlEncode(JSON.stringify(claims));
  return {
    ticket: `${payload}.${signPayload(payload)}`,
    claims,
  };
}

export function verifyMatchmakingTicket(ticket: unknown, now = Date.now()): MatchmakingTicketClaims | null {
  if (typeof ticket !== 'string' || ticket.length > 4096) return null;

  const [payload, signature, ...extra] = ticket.split('.');
  if (!payload || !signature || extra.length > 0) return null;
  if (!safeEqual(signPayload(payload), signature)) return null;

  let claims: MatchmakingTicketClaims;
  try {
    claims = JSON.parse(base64UrlDecode(payload).toString('utf8')) as MatchmakingTicketClaims;
  } catch {
    return null;
  }

  if (claims.version !== 1) return null;
  if (!claims.userId || !claims.nonce) return null;
  if (claims.expiresAt < now || claims.issuedAt > now + 5_000) return null;
  if (!Number.isFinite(claims.skillRating)) return null;
  if (normalizeSkillBucket(claims.skillBucket) !== claims.skillBucket) return null;
  if (normalizeSkillBucket(claims.targetSkillBucket) !== claims.targetSkillBucket) return null;

  return {
    ...claims,
    skillRating: Math.round(claims.skillRating),
    skillBucket: claims.skillBucket ?? DEFAULT_MATCHMAKING_SKILL_BUCKET,
    targetSkillBucket: claims.targetSkillBucket ?? DEFAULT_MATCHMAKING_SKILL_BUCKET,
  };
}
