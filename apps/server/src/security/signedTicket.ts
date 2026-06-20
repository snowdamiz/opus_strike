import crypto from 'crypto';
import { getEntryTicketSecret } from '../config/security';

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

export function createSignedTicket(claims: unknown): string {
  const payload = base64UrlEncode(JSON.stringify(claims));
  return `${payload}.${signPayload(payload)}`;
}

export function readSignedTicketClaims<TClaims>(ticket: unknown, maxLength = 4096): TClaims | null {
  if (typeof ticket !== 'string' || ticket.length > maxLength) return null;

  const [payload, signature, ...extra] = ticket.split('.');
  if (!payload || !signature || extra.length > 0) return null;
  if (!safeEqual(signPayload(payload), signature)) return null;

  try {
    return JSON.parse(base64UrlDecode(payload).toString('utf8')) as TClaims;
  } catch {
    return null;
  }
}
