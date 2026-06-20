import type { GameplayMode, MatchPerspective, VoxelMapSizeId, VoxelMapTheme } from '@voxel-strike/shared';
import { config } from '../config/environment';
import { useSettingsStore } from '../store/settingsStore';
import { DEV_TUTORIAL_BYPASS_HEADER, shouldBypassTutorialForDev } from '../utils/tutorialAccess';

export interface QuickPlayTicketResponse {
  ticket: string;
  mode: 'quick_play';
  gameplayMode: GameplayMode;
  botFillMode: 'manual' | 'fill_even';
  matchPerspective: MatchPerspective;
  competitiveRating: number;
  rankDivisionIndex: number;
  rank: unknown;
  targetRankDivisionIndex: number;
  targetRankLabel: string;
}

export interface RankedTokenHoldStatus {
  eligible: boolean;
  tokenAddress: string;
  tokenSymbol?: string;
  tokenDecimals: number | null;
  usdCents: number;
  tokenUsdPrice: string;
  tokenUsdPriceMicroUsd: string;
  requiredTokenBaseUnits: string;
  balanceTokenBaseUnits: string;
  cluster: string;
  priceSource: string;
  checkedAt: string;
}

export interface RankedTicketResponse {
  ticket: string;
  mode: 'ranked';
  gameplayMode: GameplayMode;
  botFillMode: 'manual' | 'fill_even';
  matchPerspective: MatchPerspective;
  competitiveRating: number;
  rankDivisionIndex: number;
  rank: unknown;
  targetRankDivisionIndex: number;
  targetRankLabel: string;
  tokenHold: RankedTokenHoldStatus;
}

export interface RunningGameStatusResponse {
  available: boolean;
  reason?: string;
  matchPerspective?: MatchPerspective;
  mapSeed?: number;
  mapThemeId?: VoxelMapTheme['id'] | null;
  mapSize?: VoxelMapSizeId | null;
}

export interface ActivePartySessionResponse {
  party: {
    partyId: string;
    persistentPartyId: string;
    updatedAt: string;
  } | null;
}

function getHttpUrl(): string {
  return config.serverUrl.replace('ws://', 'http://').replace('wss://', 'https://');
}

function isDevTutorialBypassEnabled(): boolean {
  return shouldBypassTutorialForDev(useSettingsStore.getState().settings.devTutorialOverride);
}

function getDevTutorialBypassHeaders(): Record<string, string> | undefined {
  return isDevTutorialBypassEnabled() ? { [DEV_TUTORIAL_BYPASS_HEADER]: 'true' } : undefined;
}

export function getDevTutorialBypassRoomOptions(): { devTutorialBypass?: true } {
  return isDevTutorialBypassEnabled() ? { devTutorialBypass: true } : {};
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => ({ error: fallback }));
  return typeof payload?.error === 'string' && payload.error ? payload.error : fallback;
}

export async function requestQuickPlayTicket(input: {
  gameplayMode: GameplayMode;
  botFillMode: 'manual' | 'fill_even';
  matchPerspective: MatchPerspective;
}): Promise<QuickPlayTicketResponse> {
  const devTutorialBypassHeaders = getDevTutorialBypassHeaders();
  const params = new URLSearchParams({
    gameplayMode: input.gameplayMode,
    botFillMode: input.botFillMode,
    perspective: input.matchPerspective,
  });
  const response = await fetch(`${getHttpUrl()}/matchmaking/quick-play-ticket?${params.toString()}`, {
    credentials: 'include',
    ...(devTutorialBypassHeaders ? { headers: devTutorialBypassHeaders } : {}),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to issue matchmaking ticket'));
  }

  return response.json();
}

export async function requestRankedTicket(): Promise<RankedTicketResponse> {
  const response = await fetch(`${getHttpUrl()}/matchmaking/ranked-ticket`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...getDevTutorialBypassHeaders(),
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to issue ranked ticket'));
  }

  return response.json();
}

export async function requestRankedTokenHoldStatus(): Promise<RankedTokenHoldStatus> {
  const response = await fetch(`${getHttpUrl()}/matchmaking/ranked-token-hold-status`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to check ranked token holding'));
  }

  const payload = await response.json() as { tokenHold: RankedTokenHoldStatus };
  return payload.tokenHold;
}

export async function requestRunningGameStatus(roomId: string): Promise<RunningGameStatusResponse> {
  const response = await fetch(`${getHttpUrl()}/matchmaking/running-game/${encodeURIComponent(roomId)}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to check running game'));
  }

  return response.json();
}

export async function requestActivePartySession(): Promise<ActivePartySessionResponse> {
  const response = await fetch(`${getHttpUrl()}/social/party-session`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load saved party'));
  }

  return response.json();
}
