import { createHash, randomUUID } from 'node:crypto';
import type { AntiCheatRetentionClass, AntiCheatSeverity, AntiCheatSignal, AntiCheatSignalInput } from './types';
import { getAntiCheatConfig } from './config';

const SENSITIVE_KEY_PATTERN = /(wallet|address|signature|secret|token|password|cookie|ip|useragent|private|mnemonic|seed)/i;
const SOLANA_ADDRESS_PATTERN = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const MAX_DETAIL_DEPTH = 4;
const MAX_ARRAY_ITEMS = 24;
const MAX_STRING_LENGTH = 256;

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function fallbackSeverity(category: string, eventType: string, reason?: string | null): AntiCheatSeverity {
  if (category === 'auth' && (eventType.includes('replay') || eventType.includes('direct_join'))) return 'critical';
  if (category === 'objective' && (eventType.includes('carrier_mismatch') || eventType.includes('capture'))) return 'high';
  if (category === 'movement' && (reason === 'bounds' || reason === 'blocked_path' || reason === 'invalid_transform')) return 'high';
  if (category === 'movement' && (reason === 'speed_limit' || reason === 'queue_overflow')) return 'medium';
  if (category === 'combat' || category === 'ability') return 'medium';
  if (category === 'network') return 'low';
  return 'low';
}

function fallbackRetention(severity: AntiCheatSeverity): AntiCheatRetentionClass {
  return severity === 'low' ? 'short' : severity === 'medium' ? 'standard' : 'extended';
}

function redactString(value: string): string {
  const shortened = value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
  return shortened.replace(SOLANA_ADDRESS_PATTERN, '[redacted-address]');
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DETAIL_DEPTH) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : '[non-finite]';
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value !== 'object') return String(value);

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = '[redacted]';
      continue;
    }
    output[key] = sanitizeValue(child, depth + 1);
  }
  return output;
}

function boundDetails(details: Record<string, unknown>, maxBytes: number): { details: Record<string, unknown>; detailBytes: number } {
  const sanitized = sanitizeValue(details, 0) as Record<string, unknown>;
  let encoded = JSON.stringify(sanitized);
  if (Buffer.byteLength(encoded, 'utf8') <= maxBytes) {
    return { details: sanitized, detailBytes: Buffer.byteLength(encoded, 'utf8') };
  }

  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sanitized)) {
    compact[key] = value;
    encoded = JSON.stringify({ ...compact, truncated: true });
    if (Buffer.byteLength(encoded, 'utf8') > maxBytes) {
      delete compact[key];
      compact.truncated = true;
      break;
    }
  }
  const finalEncoded = JSON.stringify(compact);
  return { details: compact, detailBytes: Buffer.byteLength(finalEncoded, 'utf8') };
}

export function hashIdentifier(value: string, salt = process.env.ANTICHEAT_HASH_SALT ?? process.env.AUTH_SECRET ?? 'local-dev'): string {
  return createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32);
}

export function normalizeAntiCheatSignal(input: AntiCheatSignalInput, now = new Date()): AntiCheatSignal {
  const config = getAntiCheatConfig();
  const severity = input.severity ?? fallbackSeverity(input.category, input.eventType, input.reason);
  const bounded = boundDetails(input.details ?? {}, config.maxSignalDetailBytes);

  return {
    eventId: randomUUID(),
    eventType: input.eventType.slice(0, 96),
    category: input.category,
    source: input.source.slice(0, 96),
    roomId: input.roomId.slice(0, 128),
    matchId: input.matchId ?? null,
    lobbyId: input.lobbyId ?? null,
    matchMode: input.matchMode ?? null,
    userId: input.userId ?? null,
    playerSessionId: input.playerSessionId ?? null,
    team: input.team ?? null,
    heroId: input.heroId ?? null,
    serverTick: Math.max(0, Math.trunc(input.serverTick ?? 0)),
    serverTime: Math.max(0, Math.trunc(input.serverTime ?? now.getTime())),
    movementEpoch: input.movementEpoch === null || input.movementEpoch === undefined ? null : Math.max(0, Math.trunc(input.movementEpoch)),
    movementSequence: input.movementSequence === null || input.movementSequence === undefined ? null : Math.max(0, Math.trunc(input.movementSequence)),
    severity,
    confidence: clampConfidence(input.confidence),
    reason: input.reason?.slice(0, 160) ?? null,
    details: bounded.details,
    detailBytes: bounded.detailBytes,
    retentionClass: input.retentionClass ?? fallbackRetention(severity),
    observedAt: now,
  };
}

export function signalDetailsToJson(details: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(details)) as Record<string, unknown>;
}
