import { sanitizeShortText } from '../rooms/protocolValidation';

const PLAYER_REPORT_REASONS = new Set([
  'cheating',
  'aimbot',
  'wallhack',
  'speed_hack',
  'movement_exploit',
  'ability_exploit',
  'match_exploit',
  'other',
]);

export function normalizePlayerReportReason(value: unknown): string {
  const normalized = sanitizeShortText(value, 64)?.toLowerCase().replace(/[^a-z0-9_]+/g, '_') ?? '';
  return PLAYER_REPORT_REASONS.has(normalized) ? normalized : 'cheating';
}
