import { DEFAULT_GAME_CONFIG } from '../constants/game.js';
import {
  DEFAULT_GAMEPLAY_MODE,
  GAMEPLAY_MODES,
  getGameplayModeRules,
  isCustomLobbyGameplayMode,
  type GameplayMode,
} from './gameplayMode.js';
import type { HeroId } from './hero.js';
import type { HeroSkinId } from './skins.js';
import type { MatchPerspective, MatchPerspectiveSettings } from './matchPerspective.js';
import type { BotDifficulty } from './player.js';
import type { RankSummary } from '../progression/ranking.js';

export const PARTY_MODES = ['quick_play', 'ranked', 'custom', 'practice'] as const;
export const PARTY_MAX_MEMBERS = DEFAULT_GAME_CONFIG.maxPlayers;

export type PartyMode = typeof PARTY_MODES[number];

export function isPartyMode(value: unknown): value is PartyMode {
  return typeof value === 'string' && (PARTY_MODES as readonly string[]).includes(value);
}

export function getPartyMaxMembersForMode(
  mode: PartyMode,
  gameplayMode: GameplayMode = DEFAULT_GAMEPLAY_MODE
): number {
  if (mode === 'custom') {
    const customGameplayMode = isCustomLobbyGameplayMode(gameplayMode)
      ? gameplayMode
      : DEFAULT_GAMEPLAY_MODE;
    return getGameplayModeRules(customGameplayMode).maxPlayers;
  }

  if (mode === 'practice') {
    return PARTY_MAX_MEMBERS;
  }

  return getGameplayModeRules(gameplayMode).maxTeamSize;
}

export function requiresUniquePartyHeroes(mode: PartyMode): boolean {
  return mode !== 'custom';
}

export interface PartyMemberSnapshot {
  userId: string;
  displayName: string;
  heroId: HeroId;
  skinId?: HeroSkinId;
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
  skinId?: HeroSkinId;
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
  selectedHero?: HeroId;
  selectedSkinId?: HeroSkinId;
  matchmakingTicket?: string;
  targetRankDivisionIndex?: number;
  targetRankLabel?: string;
}
