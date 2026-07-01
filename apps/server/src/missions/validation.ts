import {
  ALL_HERO_IDS,
  DAILY_MISSION_CRITERION_TYPES,
  DAILY_MISSION_REWARD_TYPES,
  DEFAULT_DAILY_MISSION_ELIGIBILITY,
  isGameplayMode,
  isHeroSkinId,
  isMatchMode,
  type DailyMissionAbilityCriterion,
  type DailyMissionCriteria,
  type DailyMissionCriterion,
  type DailyMissionCriterionType,
  type DailyMissionEligibility,
  type DailyMissionHeroCriterion,
  type DailyMissionReward,
  type DailyMissionRewardBundle,
} from '@voxel-strike/shared';

const UNSIGNED_INTEGER_PATTERN = /^[0-9]+$/;
const MISSION_TEXT_MAX = 160;
const MISSION_DESCRIPTION_MAX = 260;
const CRITERION_ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const ABILITY_ID_PATTERN = /^[a-z][a-z0-9_:-]{1,63}$/;

type RecordValue = Record<string, unknown>;

export class MissionValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'MissionValidationError';
    this.statusCode = statusCode;
  }
}

export interface MissionDefinitionPayload {
  displayName: string;
  description: string;
  enabled: boolean;
  sortOrder: number;
  activeStartsAt: Date | null;
  activeEndsAt: Date | null;
  resetPolicy: 'utc';
  criteria: DailyMissionCriteria;
  rewards: DailyMissionRewardBundle;
  eligibility: DailyMissionEligibility;
}

export function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown, fieldName: string, maxLength: number, required = true): string {
  if (typeof value !== 'string') {
    if (!required) return '';
    throw new MissionValidationError(`${fieldName} is required`);
  }
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
  if (!normalized && required) throw new MissionValidationError(`${fieldName} is required`);
  return normalized;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function readInteger(
  value: unknown,
  fieldName: string,
  options: { fallback?: number; min?: number; max?: number } = {}
): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : options.fallback;
  if (typeof parsed !== 'number' || !Number.isInteger(parsed)) {
    throw new MissionValidationError(`${fieldName} must be an integer`);
  }
  if (options.min !== undefined && parsed < options.min) {
    throw new MissionValidationError(`${fieldName} must be >= ${options.min}`);
  }
  if (options.max !== undefined && parsed > options.max) {
    throw new MissionValidationError(`${fieldName} must be <= ${options.max}`);
  }
  return parsed;
}

function readUnsignedBigintString(value: unknown, fieldName: string): string {
  const raw = typeof value === 'bigint'
    ? value.toString()
    : typeof value === 'number'
      ? Number.isSafeInteger(value) && value >= 0 ? String(value) : ''
      : typeof value === 'string'
        ? value.trim()
        : '';
  if (!UNSIGNED_INTEGER_PATTERN.test(raw)) {
    throw new MissionValidationError(`${fieldName} must be an unsigned integer string`);
  }
  if (BigInt(raw) <= 0n) throw new MissionValidationError(`${fieldName} must be greater than zero`);
  return raw;
}

function readDate(value: unknown, fieldName: string): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new MissionValidationError(`${fieldName} must be a valid date`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new MissionValidationError(`${fieldName} must be a valid date`);
  return date;
}

function readCriterionType(value: unknown): DailyMissionCriterionType {
  if (typeof value === 'string' && (DAILY_MISSION_CRITERION_TYPES as readonly string[]).includes(value)) {
    return value as DailyMissionCriterionType;
  }
  throw new MissionValidationError('Criterion type is invalid');
}

function criterionNeedsHero(type: DailyMissionCriterionType): type is DailyMissionHeroCriterion['type'] {
  return type === 'play_hero' || type === 'eliminations_as_hero' || type === 'eliminations_against_hero';
}

function criterionNeedsAbility(type: DailyMissionCriterionType): type is DailyMissionAbilityCriterion['type'] {
  return type === 'eliminations_with_ability';
}

function parseCriterion(value: unknown, index: number): DailyMissionCriterion {
  if (!isRecord(value)) throw new MissionValidationError(`Criterion ${index + 1} must be an object`);
  const type = readCriterionType(value.type);
  const id = readString(value.id, `Criterion ${index + 1} id`, 32);
  if (!CRITERION_ID_PATTERN.test(id)) {
    throw new MissionValidationError(`Criterion ${index + 1} id must use lowercase letters, numbers, "_" or "-"`);
  }
  const target = readInteger(value.target, `Criterion ${index + 1} target`, { min: 1, max: 1_000_000_000 });

  if (criterionNeedsHero(type)) {
    if (typeof value.heroId !== 'string' || !(ALL_HERO_IDS as readonly string[]).includes(value.heroId)) {
      throw new MissionValidationError(`Criterion ${index + 1} hero is invalid`);
    }
    return { id, type, target, heroId: value.heroId } as DailyMissionCriterion;
  }

  if (criterionNeedsAbility(type)) {
    const abilityId = readString(value.abilityId, `Criterion ${index + 1} ability`, 64);
    if (!ABILITY_ID_PATTERN.test(abilityId)) {
      throw new MissionValidationError(`Criterion ${index + 1} ability is invalid`);
    }
    return { id, type, target, abilityId };
  }

  return { id, type, target };
}

export function parseMissionCriteria(value: unknown): DailyMissionCriteria {
  if (!isRecord(value)) throw new MissionValidationError('Criteria must be an object');
  if (value.mode !== undefined && value.mode !== 'all') {
    throw new MissionValidationError('Only "all" criteria mode is supported');
  }
  if (!Array.isArray(value.items) || value.items.length === 0) {
    throw new MissionValidationError('At least one criterion is required');
  }
  if (value.items.length > 8) throw new MissionValidationError('Missions can have at most 8 criteria');

  const items = value.items.map(parseCriterion);
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new MissionValidationError(`Duplicate criterion id "${item.id}"`);
    ids.add(item.id);
  }
  return { mode: 'all', items };
}

function parseReward(value: unknown, index: number): DailyMissionReward {
  if (!isRecord(value)) throw new MissionValidationError(`Reward ${index + 1} must be an object`);
  if (typeof value.type !== 'string' || !(DAILY_MISSION_REWARD_TYPES as readonly string[]).includes(value.type)) {
    throw new MissionValidationError(`Reward ${index + 1} type is invalid`);
  }

  if (value.type === 'sol') {
    return {
      type: 'sol',
      amountLamports: readUnsignedBigintString(value.amountLamports, `Reward ${index + 1} SOL amount`),
    };
  }

  if (value.type === 'game_token') {
    const reward: DailyMissionReward = {
      type: 'game_token',
      amountBaseUnits: readUnsignedBigintString(value.amountBaseUnits, `Reward ${index + 1} token amount`),
    };
    if (typeof value.symbol === 'string' && value.symbol.trim()) {
      reward.symbol = value.symbol.trim().replace(/^\$/, '').toUpperCase().slice(0, 12);
    }
    return reward;
  }

  if (!isHeroSkinId(value.skinId)) throw new MissionValidationError(`Reward ${index + 1} skin id is invalid`);
  return { type: 'skin', skinId: value.skinId };
}

export function parseMissionRewardBundle(value: unknown): DailyMissionRewardBundle {
  if (!isRecord(value)) throw new MissionValidationError('Rewards must be an object');
  if (!Array.isArray(value.items) || value.items.length === 0) {
    throw new MissionValidationError('At least one reward is required');
  }
  if (value.items.length > 8) throw new MissionValidationError('Missions can have at most 8 rewards');
  const items = value.items.map(parseReward);
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.type === 'skin' ? `skin:${item.skinId}` : item.type;
    if (seen.has(key)) {
      throw new MissionValidationError(
        item.type === 'skin'
          ? `Skin reward ${item.skinId} is duplicated`
          : `Only one ${item.type} reward is supported per mission`
      );
    }
    seen.add(key);
  }
  return { items };
}

function readMatchModes(value: unknown): DailyMissionEligibility['matchModes'] {
  if (!Array.isArray(value)) return [...DEFAULT_DAILY_MISSION_ELIGIBILITY.matchModes];
  const modes = value.filter(isMatchMode);
  if (modes.length === 0) throw new MissionValidationError('At least one match mode is required');
  return Array.from(new Set(modes));
}

function readGameplayModes(value: unknown): DailyMissionEligibility['gameplayModes'] {
  if (!Array.isArray(value)) return [...DEFAULT_DAILY_MISSION_ELIGIBILITY.gameplayModes];
  const modes = value.filter(isGameplayMode);
  if (modes.length === 0) throw new MissionValidationError('At least one gameplay mode is required');
  return Array.from(new Set(modes));
}

export function parseMissionEligibility(value: unknown): DailyMissionEligibility {
  const source = isRecord(value) ? value : {};
  const leaverPolicy = source.leaverPolicy === 'allow_partial' ? 'allow_partial' : 'finish_required';
  return {
    matchModes: readMatchModes(source.matchModes),
    gameplayModes: readGameplayModes(source.gameplayModes),
    rankedOnly: readBoolean(source.rankedOnly, DEFAULT_DAILY_MISSION_ELIGIBILITY.rankedOnly),
    cleanIntegrityOnly: readBoolean(source.cleanIntegrityOnly, DEFAULT_DAILY_MISSION_ELIGIBILITY.cleanIntegrityOnly),
    minDurationMs: readInteger(source.minDurationMs, 'Minimum duration', { fallback: DEFAULT_DAILY_MISSION_ELIGIBILITY.minDurationMs, min: 0 }),
    leaverPolicy,
  };
}

export function parseMissionDefinitionPayload(input: unknown): MissionDefinitionPayload {
  if (!isRecord(input)) throw new MissionValidationError('Mission payload is required');

  const activeStartsAt = readDate(input.activeStartsAt, 'Active start');
  const activeEndsAt = readDate(input.activeEndsAt, 'Active end');
  if (activeStartsAt && activeEndsAt && activeEndsAt <= activeStartsAt) {
    throw new MissionValidationError('Active end must be after active start');
  }

  const resetPolicy = input.resetPolicy === undefined || input.resetPolicy === 'utc'
    ? 'utc'
    : null;
  if (!resetPolicy) throw new MissionValidationError('Only UTC reset policy is supported');

  return {
    displayName: readString(input.displayName, 'Mission name', MISSION_TEXT_MAX),
    description: readString(input.description ?? '', 'Mission description', MISSION_DESCRIPTION_MAX, false),
    enabled: readBoolean(input.enabled, true),
    sortOrder: readInteger(input.sortOrder, 'Sort order', { fallback: 0, min: -10000, max: 10000 }),
    activeStartsAt,
    activeEndsAt,
    resetPolicy,
    criteria: parseMissionCriteria(input.criteria),
    rewards: parseMissionRewardBundle(input.rewards),
    eligibility: parseMissionEligibility(input.eligibility),
  };
}
