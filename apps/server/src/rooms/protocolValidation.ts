import {
  ALL_HERO_IDS,
  clampLookPitch,
  normalizeLookYaw,
} from '@voxel-strike/shared';
import type { BotDifficulty, HeroId, PlayerInput, Team } from '@voxel-strike/shared';

type RecordValue = Record<string, unknown>;
type PlayerInputValidationResult =
  | { ok: true; input: PlayerInput }
  | { ok: false; reason: string };

const MAX_TEXT_LENGTH = 200;
const MAX_NAME_LENGTH = 24;
const REQUIRED_INPUT_BOOLEANS = [
  'moveForward',
  'moveBackward',
  'moveLeft',
  'moveRight',
  'jump',
  'crouch',
  'sprint',
  'primaryFire',
  'secondaryFire',
  'reload',
  'ability1',
  'ability2',
  'ultimate',
  'interact',
] as const;

export function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isTeam(value: unknown): value is Team {
  return value === 'red' || value === 'blue';
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

function finiteNumberLike(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function inputTimestampValue(value: unknown, receivedAt: number): number {
  const fallback = Number.isFinite(receivedAt) ? receivedAt : Date.now();
  if (value === undefined || value === null) return fallback;
  return finiteNumberLike(value) ?? fallback;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 0) return false;
  if (value === 1) return true;
  return null;
}

function inputBooleanValue(value: unknown): boolean | null {
  if (value === undefined || value === null) return false;
  return booleanValue(value);
}

function optionalBooleanValue(value: unknown): boolean | null | undefined {
  if (value === undefined || value === null) return undefined;
  return booleanValue(value);
}

function invalidPlayerInput(reason: string): PlayerInputValidationResult {
  return { ok: false, reason };
}

export function validateVec3(value: unknown): { x: number; y: number; z: number } | null {
  if (!isRecord(value)) return null;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const z = finiteNumber(value.z);
  if (x === null || y === null || z === null) return null;
  return { x, y, z };
}

export function parsePlayerInputPayload(value: unknown, receivedAt = Date.now()): PlayerInputValidationResult {
  if (!isRecord(value)) return invalidPlayerInput('not_object');

  const tick = finiteNumber(value.tick);
  const timestamp = inputTimestampValue(value.timestamp, receivedAt);
  const lookYaw = finiteNumber(value.lookYaw);
  const lookPitch = finiteNumber(value.lookPitch);
  if (tick === null) return invalidPlayerInput('tick');
  if (lookYaw === null) return invalidPlayerInput('lookYaw');
  if (lookPitch === null) return invalidPlayerInput('lookPitch');

  const booleans: Record<string, boolean> = {};
  for (const key of REQUIRED_INPUT_BOOLEANS) {
    const parsed = inputBooleanValue(value[key]);
    if (parsed === null) return invalidPlayerInput(key);
    booleans[key] = parsed;
  }

  const position = value.position == null ? undefined : validateVec3(value.position);
  const velocity = value.velocity == null ? undefined : validateVec3(value.velocity);
  if (value.position != null && !position) return invalidPlayerInput('position');
  if (value.velocity != null && !velocity) return invalidPlayerInput('velocity');

  const crouchPressed = optionalBooleanValue(value.crouchPressed);
  const unstuck = optionalBooleanValue(value.unstuck);
  const devFly = optionalBooleanValue(value.devFly);
  if (crouchPressed === null) return invalidPlayerInput('crouchPressed');
  if (unstuck === null) return invalidPlayerInput('unstuck');
  if (devFly === null) return invalidPlayerInput('devFly');

  return { ok: true, input: {
    tick: Math.max(0, Math.trunc(tick)),
    moveForward: booleans.moveForward,
    moveBackward: booleans.moveBackward,
    moveLeft: booleans.moveLeft,
    moveRight: booleans.moveRight,
    jump: booleans.jump,
    crouch: booleans.crouch,
    crouchPressed: crouchPressed ?? undefined,
    sprint: booleans.sprint,
    primaryFire: booleans.primaryFire,
    secondaryFire: booleans.secondaryFire,
    reload: booleans.reload,
    ability1: booleans.ability1,
    ability2: booleans.ability2,
    ultimate: booleans.ultimate,
    interact: booleans.interact,
    lookYaw: normalizeLookYaw(lookYaw),
    lookPitch: clampLookPitch(lookPitch),
    timestamp,
    unstuck: unstuck ?? undefined,
    position: position ?? undefined,
    velocity: velocity ?? undefined,
    devFly: devFly ?? undefined,
  } };
}

export function validatePlayerInputPayload(value: unknown): PlayerInput | null {
  const result = parsePlayerInputPayload(value);
  return result.ok ? result.input : null;
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
