import type {
  GameplayMode,
  HeroId,
  HeroLoadoutSelection,
  HeroSkinCatalogResponse,
  HeroSkinId,
  MatchPerspective,
  SkinPurchaseIntentSnapshot,
  SkinPurchaseTransactionSnapshot,
  VoxelMapSizeId,
  VoxelMapTheme,
} from '@voxel-strike/shared';
import { config } from '../config/environment';
import { useSettingsStore } from '../store/settingsStore';
import { DEV_TUTORIAL_BYPASS_HEADER, shouldBypassTutorialForDev } from '../utils/tutorialAccess';

export interface QuickPlayTicketResponse {
  ticket: string;
  mode: 'quick_play';
  gameplayMode: GameplayMode;
  botFillMode: 'manual' | 'fill_even';
  matchPerspective: MatchPerspective;
  selectedHero?: HeroId;
  selectedSkinId?: HeroSkinId;
  competitiveRating: number;
  rankDivisionIndex: number;
  rank: unknown;
  targetRankDivisionIndex: number;
  targetRankLabel: string;
}

export interface RankedTokenHoldStatus {
  eligible: boolean;
  mode: 'locked' | 'token_required';
  lockedReason?: string;
  tokenMintAddress: string | null;
  tokenAddress: string;
  tokenSymbol?: string;
  tokenDecimals: number | null;
  requiredTokenAmount: string;
  requiredTokenBaseUnits: string;
  balanceTokenBaseUnits: string;
  cluster: string;
  checkedAt: string;
}

export interface RankedTicketResponse {
  ticket: string;
  mode: 'ranked';
  gameplayMode: GameplayMode;
  botFillMode: 'manual' | 'fill_even';
  matchPerspective: MatchPerspective;
  selectedHero?: HeroId;
  selectedSkinId?: HeroSkinId;
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

export interface SkinPurchaseSimulationResponse {
  intentId: string;
  ok: boolean;
  error: unknown;
  logs: string[];
}

export interface RewardEconomyResponse {
  economy: {
    rewardTokenSymbol: string | null;
    playerRewards: {
      enabled: boolean;
      dailyRankedDripLamports: string;
      dailyRankedDripMaxMatches: number;
      minMatchDurationMs: number;
      objectiveWinLamports: string;
      objectiveFlagCaptureLamports: string;
      objectiveFlagReturnLamports: string;
      objectiveAssistLamports: string;
      maxPlayerMatchLamports: string;
      maxMatchPayoutLamports: string;
      treasuryReserveLamports: string;
      payoutBatchSize: number;
      weeklyEnabled: boolean;
      weeklyPoolLamports: string;
      weeklyTopPlayers: number;
      updatedByUserId: string | null;
      updatedAt: string | null;
    };
    wagers: {
      enabled: boolean;
      platformFeeBps: number;
      updatedByUserId: string | null;
      updatedAt: string | null;
    };
    goldenBiome: {
      distributionMode: 'manual' | 'auto';
      enabled: boolean;
      chanceBps: number;
      winnerRewardLamports: string;
      treasuryMinLamports: string;
      treasuryWallet: string | null;
      updatedByUserId: string | null;
      updatedAt: string | null;
    };
  };
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
  selectedHero?: HeroId;
  selectedSkinId?: HeroSkinId;
}): Promise<QuickPlayTicketResponse> {
  const devTutorialBypassHeaders = getDevTutorialBypassHeaders();
  const params = new URLSearchParams({
    gameplayMode: input.gameplayMode,
    botFillMode: input.botFillMode,
    perspective: input.matchPerspective,
  });
  if (input.selectedHero) {
    params.set('selectedHero', input.selectedHero);
  }
  if (input.selectedSkinId) {
    params.set('selectedSkinId', input.selectedSkinId);
  }
  const response = await fetch(`${getHttpUrl()}/matchmaking/quick-play-ticket?${params.toString()}`, {
    credentials: 'include',
    ...(devTutorialBypassHeaders ? { headers: devTutorialBypassHeaders } : {}),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to issue matchmaking ticket'));
  }

  return response.json();
}

export async function requestRankedTicket(input: { selectedHero?: HeroId; selectedSkinId?: HeroSkinId } = {}): Promise<RankedTicketResponse> {
  const body = {
    ...(input.selectedHero ? { selectedHero: input.selectedHero } : {}),
    ...(input.selectedSkinId ? { selectedSkinId: input.selectedSkinId } : {}),
  };
  const response = await fetch(`${getHttpUrl()}/matchmaking/ranked-ticket`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...getDevTutorialBypassHeaders(),
    },
    body: JSON.stringify(body),
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

export async function requestRewardEconomy(): Promise<RewardEconomyResponse['economy']> {
  const response = await fetch(`${getHttpUrl()}/rewards/economy`, {
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load reward economy'));
  }

  const payload = await response.json() as RewardEconomyResponse;
  return payload.economy;
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

export async function requestSkinCatalog(): Promise<HeroSkinCatalogResponse> {
  const response = await fetch(`${getHttpUrl()}/cosmetics/catalog`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load skin catalog'));
  }

  return response.json();
}

export async function updateHeroSkinLoadout(input: {
  heroId: HeroId;
  skinId: HeroSkinId;
}): Promise<HeroLoadoutSelection> {
  const response = await fetch(`${getHttpUrl()}/cosmetics/loadouts/${encodeURIComponent(input.heroId)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skinId: input.skinId }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to update skin selection'));
  }

  return response.json();
}

export async function createSkinPurchaseIntent(skinId: HeroSkinId): Promise<SkinPurchaseIntentSnapshot> {
  const response = await fetch(`${getHttpUrl()}/cosmetics/purchases/intents`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skinId }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to create purchase intent'));
  }

  return response.json();
}

export async function getSkinPurchaseIntent(intentId: string): Promise<SkinPurchaseIntentSnapshot> {
  const response = await fetch(`${getHttpUrl()}/cosmetics/purchases/intents/${encodeURIComponent(intentId)}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load purchase intent'));
  }

  return response.json();
}

export async function buildSkinPurchaseTransaction(intentId: string): Promise<SkinPurchaseTransactionSnapshot> {
  const response = await fetch(`${getHttpUrl()}/cosmetics/purchases/intents/${encodeURIComponent(intentId)}/transaction`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to build purchase transaction'));
  }

  return response.json();
}

export async function simulateSkinPurchaseTransaction(input: {
  intentId: string;
  transactionBase64: string;
}): Promise<SkinPurchaseSimulationResponse> {
  const response = await fetch(`${getHttpUrl()}/cosmetics/purchases/intents/${encodeURIComponent(input.intentId)}/simulate`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionBase64: input.transactionBase64 }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to simulate purchase transaction'));
  }

  return response.json();
}

export async function submitSignedSkinPurchaseTransaction(input: {
  intentId: string;
  signedTransactionBase64: string;
}): Promise<SkinPurchaseIntentSnapshot> {
  const response = await fetch(`${getHttpUrl()}/cosmetics/purchases/intents/${encodeURIComponent(input.intentId)}/signed-transaction`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedTransactionBase64: input.signedTransactionBase64 }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to submit signed purchase transaction'));
  }

  return response.json();
}
