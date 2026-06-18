import {
  ALL_HERO_IDS,
  isTeamId,
} from '@voxel-strike/shared';
import type { BotDifficulty, HeroId, Team } from '@voxel-strike/shared';

type RecordValue = Record<string, unknown>;

const MAX_TEXT_LENGTH = 200;
const MAX_NAME_LENGTH = 24;

export function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isTeam(value: unknown): value is Team {
  return isTeamId(value);
}

export function isHeroId(value: unknown): value is HeroId {
  return typeof value === 'string' && (ALL_HERO_IDS as readonly string[]).includes(value);
}

export function isBotDifficulty(value: unknown): value is BotDifficulty {
  return value === 'easy' || value === 'normal' || value === 'hard';
}

export function sanitizeShortText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
  return trimmed || null;
}

export function sanitizeDisplayName(value: unknown, fallback = 'Player'): string {
  return sanitizeShortText(value, MAX_NAME_LENGTH) ?? fallback;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 0) return false;
  if (value === 1) return true;
  return null;
}

export function validateVec3(value: unknown): { x: number; y: number; z: number } | null {
  if (!isRecord(value)) return null;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const z = finiteNumber(value.z);
  if (x === null || y === null || z === null) return null;
  return { x, y, z };
}

export function validateReadyPayload(value: unknown): boolean | null {
  return isRecord(value) ? booleanValue(value.ready) : null;
}

export function validateTeamPayload(value: unknown): Team | null {
  if (!isRecord(value)) return null;
  return isTeam(value.team) ? value.team : null;
}

export function validateHeroPayload(value: unknown): HeroId | null {
  if (!isRecord(value)) return null;
  return isHeroId(value.heroId) ? value.heroId : null;
}

export function validateChatPayload(value: unknown, options: { teamOnly?: boolean } = {}): { message: string; teamOnly: boolean } | null {
  if (!isRecord(value)) return null;
  const message = sanitizeShortText(value.message);
  if (!message) return null;
  const teamOnly = options.teamOnly
    ? Boolean(value.teamOnly)
    : false;
  return { message, teamOnly };
}

export function validateBotPayload(value: unknown): {
  difficulty?: BotDifficulty;
  team?: Team;
  name?: string;
  heroId?: HeroId | '';
} | null {
  if (!isRecord(value)) return {};
  const difficulty = value.difficulty === undefined
    ? undefined
    : isBotDifficulty(value.difficulty) ? value.difficulty : null;
  const team = value.team === undefined
    ? undefined
    : isTeam(value.team) ? value.team : null;
  const name = value.name === undefined ? undefined : sanitizeShortText(value.name, MAX_NAME_LENGTH);
  const heroId = value.heroId === '' || value.heroId === undefined
    ? (value.heroId as '' | undefined)
    : isHeroId(value.heroId) ? value.heroId : null;
  if (difficulty === null || team === null || heroId === null) return null;
  return {
    difficulty,
    team,
    name: name ?? undefined,
    heroId,
  };
}

export function validateBotIdPayload(value: unknown, key = 'botId'): string | null {
  if (!isRecord(value)) return null;
  return sanitizeShortText(value[key], 96);
}

export function validateMapVotePayload(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return sanitizeShortText(value.optionId, 64);
}
