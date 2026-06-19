import { DEFAULT_GAME_CONFIG } from '../constants/game.js';
import { GAMEPLAY_MODES, type GameplayMode } from './gameplayMode.js';
import type { HeroId } from './hero.js';
import type { MatchPerspective, MatchPerspectiveSettings } from './matchPerspective.js';
import type { BotDifficulty } from './player.js';
import type { RankSummary } from '../progression/ranking.js';

export const PARTY_MODES = ['quick_play', 'ranked', 'custom', 'practice'] as const;
export const PARTY_MAX_MEMBERS = DEFAULT_GAME_CONFIG.teamSize;

export type PartyMode = typeof PARTY_MODES[number];

export function isPartyMode(value: unknown): value is PartyMode {
  return typeof value === 'string' && (PARTY_MODES as readonly string[]).includes(value);
}

export interface PartyMemberSnapshot {
  userId: string;
  displayName: string;
  heroId: HeroId;
  ready: boolean;
  connected: boolean;
  leader: boolean;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
  rank: RankSummary;
}

export interface PartyBotLaunchDescriptor {
  displayName: string;
  heroId: HeroId;
  difficulty: BotDifficulty;
}

export type PartyBotFillSettings = Record<GameplayMode, boolean>;

export function createDefaultPartyBotFillSettings(): PartyBotFillSettings {
  return Object.fromEntries(
    GAMEPLAY_MODES.map((mode) => [mode, false])
  ) as PartyBotFillSettings;
}

export interface PartyStateSnapshot {
  partyId: string;
  leaderUserId: string;
  selectedMode: PartyMode;
  gameplayMode: GameplayMode;
  botFillEnabledByMode: PartyBotFillSettings;
  perspectiveByMode: MatchPerspectiveSettings;
  members: PartyMemberSnapshot[];
  launchError: string | null;
}

export interface PartyLaunchPayload {
  mode: PartyMode;
  lobbyId: string;
  matchMode: 'quick_play' | 'ranked' | 'custom';
  gameplayMode: GameplayMode;
  botFillMode?: 'manual' | 'fill_even';
  matchPerspective: MatchPerspective;
  matchmakingTicket?: string;
  targetRankDivisionIndex?: number;
  targetRankLabel?: string;
}
