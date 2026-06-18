import type { GameplayMode } from './gameplayMode.js';
import type { HeroId } from './hero.js';
import type { RankSummary } from '../progression/ranking.js';

export const PARTY_MODES = ['quick_play', 'ranked', 'custom', 'practice'] as const;

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
  rank: RankSummary;
}

export interface PartyStateSnapshot {
  partyId: string;
  leaderUserId: string;
  selectedMode: PartyMode;
  gameplayMode: GameplayMode;
  members: PartyMemberSnapshot[];
  launchError: string | null;
}

export interface PartyLaunchPayload {
  mode: PartyMode;
  lobbyId: string;
  matchMode: 'quick_play' | 'ranked' | 'custom';
  gameplayMode: GameplayMode;
  matchmakingTicket?: string;
  targetRankDivisionIndex?: number;
  targetRankLabel?: string;
}
