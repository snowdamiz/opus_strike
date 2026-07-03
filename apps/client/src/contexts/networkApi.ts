import type {
  GameplayMode,
  HeroId,
  HeroLoadoutSelection,
  HeroSkinCatalogResponse,
  HeroSkinId,
  MatchPerspective,
  PlayerDailyMissionsResponse,
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
  matchmakingRegion?: string;
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
  matchmakingRegion?: string;
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

export interface StreamerTargetMetadata {
  phase: string | null;
  gameplayMode: string | null;
  matchPerspective: string | null;
  mapSeed: number | null;
  mapThemeId: string | null;
  mapSize: string | null;
  mapProfileId: string | null;
  combatHumanCount: number;
  regularObserverCount: number;
  streamerObserverCount: number;
  streamerManagedBotGame: boolean;
  streamerFeedMode: 'random' | 'bot_deathmatch';
  streamerCameraMode: 'directed' | 'fixed_aerial';
  streamerMapRotationStartedAt?: number | null;
}

export interface GameSeatReservationPayload {
  sessionId: string;
  room: {
    name: string;
    roomId: string;
    processId: string;
    publicAddress?: string;
  };
  devMode?: boolean;
}

export interface StreamerNextTarget {
  roomId: string;
  roomName: 'game_room';
  processId: string | null;
  publicAddress: string | null;
  source: 'real_player' | 'fallback_bot' | 'bot_deathmatch';
  streamerObserverTicket?: string;
  seatReservation?: GameSeatReservationPayload;
  metadata: StreamerTargetMetadata;
}

export interface StreamerStatusResponse {
  allowed: true;
  currentRoomId: string | null;
  fallbackBotGame: {
    exists: boolean;
    roomId: string | null;
    phase: string | null;
  };
  csrfToken: string;
}

export interface StreamerNextResponse {
  target: StreamerNextTarget;
  csrfToken: string;
}

export interface StreamerStopResponse {
  stopped: true;
  csrfToken: string;
}

export interface RewardEconomyResponse {
  economy: {
    rewardTokenSymbol: string | null;
    rankedEntryGate: {
      mode: 'locked' | 'token_required';
      requiredTokenAmount: string;
    };
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

export async function requestDailyMissions(): Promise<PlayerDailyMissionsResponse> {
  const response = await fetch(`${getHttpUrl()}/missions/daily`, {
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load daily missions'));
  }

  return response.json() as Promise<PlayerDailyMissionsResponse>;
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

export async function requestStreamerStatus(): Promise<StreamerStatusResponse> {
  const response = await fetch(`${getHttpUrl()}/streamer/status`, {
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load streamer status'));
  }

  return response.json();
}

export async function requestNextStreamerTarget(input: {
  currentRoomId: string | null;
  csrfToken: string;
  feedMode: 'random' | 'bot_deathmatch';
}): Promise<StreamerNextResponse> {
  const response = await fetch(`${getHttpUrl()}/streamer/next`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': input.csrfToken,
    },
    body: JSON.stringify({
      currentRoomId: input.currentRoomId,
      clientBuildId: config.buildId,
      feedMode: input.feedMode,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to resolve streamer target'));
  }

  return response.json();
}

export async function requestStopStreamer(csrfToken: string): Promise<StreamerStopResponse> {
  const response = await fetch(`${getHttpUrl()}/streamer/stop`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to stop streamer mode'));
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

export async function createSkinPurchaseIntent(input: {
  skinId: HeroSkinId;
  walletAddress: string;
}): Promise<SkinPurchaseIntentSnapshot> {
  const response = await fetch(`${getHttpUrl()}/cosmetics/purchases/intents`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
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
