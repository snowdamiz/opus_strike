import {
  HERO_DEFINITIONS,
  type HeroId,
  type Team,
} from '@voxel-strike/shared';
import type {
  DevBotLookOverride,
  DevBotSkillOverride,
} from './devBotCommands';
import {
  isHeroId,
  isRecord,
  isTeam,
  sanitizeShortText,
  validateBotIdPayload,
  validateVec3,
} from './protocolValidation';

export interface DevNpcSpawnRequest {
  heroId: HeroId;
  team?: Team;
  position?: { x: number; y: number; z: number };
  name?: string;
}

export interface DevNpcDamageRequest {
  npcId: string;
  damage: number;
}

export interface DevNpcIdRequest {
  npcId: string;
}

export interface DevHeroTeamRequest {
  heroId: HeroId;
  team: Team;
}

export interface DevBotSkillRequest extends DevHeroTeamRequest {
  skillKey: string;
}

export interface DevBotLookRequest extends DevHeroTeamRequest {
  direction: string;
}

export interface DevBotSpawnProfileInput {
  roomId: string;
  heroId: HeroId;
  heroName: string;
  team: Team;
  botIndex: number;
  phase: string;
}

export interface DevBotSpawnProfile {
  id: string;
  name: string;
  team: Team;
  isBot: true;
  botDifficulty: 'normal';
  botProfileId: string;
  isReady: true;
  state: 'alive' | 'spawning' | 'selecting';
}

export type DevBotAddRequestResult =
  | {
      ok: true;
      heroId: HeroId;
      heroName: string;
      team: Team;
    }
  | {
      ok: false;
      error: string;
    };

function clampDevDamage(value: number): number {
  return Math.max(0, Math.min(1000, value));
}

export function readDevEnabledFlag(payload: unknown): boolean {
  return isRecord(payload) && payload.enabled === true;
}

export function parseDevNpcSpawnRequest(payload: unknown): DevNpcSpawnRequest | null {
  if (!isRecord(payload) || !isHeroId(payload.heroId)) return null;

  const team = payload.team === undefined
    ? undefined
    : isTeam(payload.team) ? payload.team : null;
  const position = payload.position === undefined
    ? undefined
    : validateVec3(payload.position);
  const name = payload.name === undefined
    ? undefined
    : sanitizeShortText(payload.name, 24) ?? undefined;

  if (team === null || (payload.position !== undefined && !position)) return null;

  return {
    heroId: payload.heroId,
    team,
    position: position ?? undefined,
    name,
  };
}

export function parseDevNpcDamageRequest(payload: unknown): DevNpcDamageRequest | null {
  if (!isRecord(payload) || typeof payload.damage !== 'number' || !Number.isFinite(payload.damage)) {
    return null;
  }

  const npcId = sanitizeShortText(payload.npcId, 96);
  if (!npcId) return null;

  return {
    npcId,
    damage: clampDevDamage(payload.damage),
  };
}

export function parseDevNpcIdRequest(payload: unknown): DevNpcIdRequest | null {
  const npcId = validateBotIdPayload(payload, 'npcId');
  return npcId ? { npcId } : null;
}

export function parseDevHeroTeamRequest(payload: unknown): DevHeroTeamRequest | null {
  if (!isRecord(payload) || !isHeroId(payload.heroId) || !isTeam(payload.team)) return null;
  return {
    heroId: payload.heroId,
    team: payload.team,
  };
}

export function parseDevBotSkillRequest(payload: unknown): DevBotSkillRequest | null {
  const heroTeam = parseDevHeroTeamRequest(payload);
  if (!heroTeam || !isRecord(payload)) return null;

  const skillKey = sanitizeShortText(payload.skillKey, 24);
  return skillKey ? { ...heroTeam, skillKey } : null;
}

export function parseDevBotLookRequest(payload: unknown): DevBotLookRequest | null {
  const heroTeam = parseDevHeroTeamRequest(payload);
  if (!heroTeam || !isRecord(payload)) return null;

  const direction = sanitizeShortText(payload.direction, 12);
  return direction ? { ...heroTeam, direction } : null;
}

export function validateDevBotAddRequest(input: {
  heroId?: HeroId;
  team?: Team;
  playerCount: number;
  maxPlayers: number;
  heroAvailable: boolean;
}): DevBotAddRequestResult {
  const heroDef = input.heroId ? HERO_DEFINITIONS[input.heroId] : null;
  if (!input.heroId || !heroDef) {
    return { ok: false, error: `Invalid bot hero: ${input.heroId || ''}` };
  }

  if (input.team !== 'red' && input.team !== 'blue') {
    return { ok: false, error: `Invalid bot team: ${input.team || ''}` };
  }

  if (input.playerCount >= input.maxPlayers) {
    return { ok: false, error: 'Game room is full' };
  }

  if (!input.heroAvailable) {
    return { ok: false, error: 'Hero is already picked on that team' };
  }

  return {
    ok: true,
    heroId: input.heroId,
    heroName: heroDef.name,
    team: input.team,
  };
}

export function resolveDevBotStateForPhase(phase: string): DevBotSpawnProfile['state'] {
  if (phase === 'playing') return 'alive';
  if (phase === 'countdown') return 'spawning';
  return 'selecting';
}

export function buildDevBotSpawnProfile(input: DevBotSpawnProfileInput): DevBotSpawnProfile {
  return {
    id: `bot_dev_${input.roomId}_${input.botIndex}`,
    name: `${input.heroName} Bot ${input.botIndex + 1}`,
    team: input.team,
    isBot: true,
    botDifficulty: 'normal',
    botProfileId: `dev-${input.heroId}-${input.botIndex}`,
    isReady: true,
    state: resolveDevBotStateForPhase(input.phase),
  };
}

export class DevRoomRuntime {
  private readonly immunePlayerIds = new Set<string>();
  private gameClockFrozen = false;
  private botsRooted = false;
  private botBrainEnabled = true;
  private readonly botSkillOverrides = new Map<string, DevBotSkillOverride>();
  private readonly botLookOverrides = new Map<string, DevBotLookOverride>();

  isPlayerImmune(playerId: string): boolean {
    return this.immunePlayerIds.has(playerId);
  }

  setPlayerImmune(playerId: string, enabled: boolean): void {
    if (enabled) {
      this.immunePlayerIds.add(playerId);
    } else {
      this.immunePlayerIds.delete(playerId);
    }
  }

  isGameClockFrozen(): boolean {
    return this.gameClockFrozen;
  }

  setGameClockFrozen(enabled: boolean): void {
    this.gameClockFrozen = enabled;
  }

  areBotsRooted(): boolean {
    return this.botsRooted;
  }

  setBotsRooted(enabled: boolean): void {
    this.botsRooted = enabled;
  }

  isBotBrainEnabled(): boolean {
    return this.botBrainEnabled;
  }

  setBotBrainEnabled(enabled: boolean): void {
    this.botBrainEnabled = enabled;
  }

  setBotSkillOverride(playerId: string, override: DevBotSkillOverride): void {
    this.botSkillOverrides.set(playerId, override);
  }

  getBotSkillOverride(playerId: string): DevBotSkillOverride | null {
    return this.botSkillOverrides.get(playerId) ?? null;
  }

  clearBotSkillOverride(playerId: string): boolean {
    return this.botSkillOverrides.delete(playerId);
  }

  setBotLookOverride(playerId: string, override: DevBotLookOverride): void {
    this.botLookOverrides.set(playerId, override);
  }

  getBotLookOverride(playerId: string): DevBotLookOverride | null {
    return this.botLookOverrides.get(playerId) ?? null;
  }

  clearBotLookOverride(playerId: string): boolean {
    return this.botLookOverrides.delete(playerId);
  }

  clearPlayer(playerId: string): void {
    this.immunePlayerIds.delete(playerId);
    this.botSkillOverrides.delete(playerId);
    this.botLookOverrides.delete(playerId);
  }
}
