import { deserializeVoxelMapManifest } from '@voxel-strike/shared';
import type {
  GameplayMode,
  HeroId,
  HeroLoadoutSelection,
  HeroSkinCatalogResponse,
  HeroSkinId,
  MatchPerspective,
  PlayerDailyMissionsResponse,
  PregeneratedMapArtifactEnvelope,
  PregeneratedMapCatalogSummary,
  SkinPurchaseIntentSnapshot,
  SkinPurchaseTransactionSnapshot,
  VoxelMapSizeId,
  VoxelMapTheme,
  VoxelMapManifest,
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
  pregeneratedMapId?: string | null;
  mapArtifactId?: string | null;
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

export type RecordingShowcaseJobStatus = 'recording' | 'rendering' | 'succeeded' | 'failed';

export interface RecordingShowcaseJob {
  id: string;
  recordingId: string;
  renderId: string | null;
  status: RecordingShowcaseJobStatus;
  heroId: HeroId;
  gameplayMode: GameplayMode;
  recordingDurationMs: number;
  recordingStartedAt: string | null;
  downloadUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  serverProcessId: string | null;
  serverMachineId: string | null;
}

export interface RecordingsIndexResponse {
  recordings: unknown[];
  csrfToken: string;
}

export interface RecordingShowcaseJobResponse {
  job: RecordingShowcaseJob;
  csrfToken: string;
}

export interface RewardEconomyResponse {
  economy: {
    rewardTokenSymbol: string | null;
    rankedEntryGate: {
      mode: 'locked' | 'token_required';
      tokenAddress: string;
      requiredTokenAmount: string;
    };
    playerRewards: {
      enabled: boolean;
      settingsVersion: number;
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
      rankedBrCombatRewardsEnabled: boolean;
      rankedBrCombatRewardsShadowMode: boolean;
      rankedBrDamageLamportsPerHp: string;
      rankedBrKillLamports: string;
      rankedBrBotTargetRewardBps: number;
      rankedBrSourceVictimDamageCapHp: number;
      rankedBrMaxPlayerMatchLamports: string;
      rankedBrMaxPlayerDailyLamports: string;
      rankedBrMaxMatchLamports: string;
      rankedBrTreasuryExposureBps: number;
      rankedBrClientRewardTextMinLamports: string;
      minPayoutUsdCents: number;
      payoutPriceQuoteTtlMs: number;
      payoutPriceQuote: {
        source: string;
        solUsdPriceMicroUsd: string;
        observedAt: string;
        expiresAt: string;
        fresh: boolean;
      } | null;
      updatedByUserId: string | null;
      updatedAt: string | null;
    };
    wagers: {
      enabled: boolean;
      winnerPoolBps: number;
      burnBps: number;
      treasuryBps: number;
      burnWallet: string;
      treasuryWallet: string | null;
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

export type PlayerRewardStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'canceled';
export type PlayerRewardPayoutStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';
export type PlayerRewardKind =
  | 'daily_ranked_drip'
  | 'objective_bounty'
  | 'season_top_10'
  | 'daily_mission'
  | 'ranked_br_combat_bounty';

export interface PlayerRewardTotalsEntry {
  amountLamports: string;
  count: number;
}

export type PlayerRewardTotals = Partial<Record<PlayerRewardStatus, PlayerRewardTotalsEntry>>;

export interface PlayerRewardPriceQuote {
  source: string;
  solUsdPriceMicroUsd: string;
  observedAt: string;
}

export interface PlayerRewardPayoutProgress {
  minPayoutUsdCents: number;
  pendingLamports: string;
  minimumPayoutLamports: string | null;
  remainingLamports: string | null;
  progressBps: number | null;
  priceQuote: PlayerRewardPriceQuote | null;
}

export interface PlayerRewardRow {
  id: string;
  kind: PlayerRewardKind;
  status: PlayerRewardStatus;
  amountLamports: string;
  reason: string;
  matchId: string | null;
  metadata: unknown;
  createdAt: string;
  paidAt: string | null;
}

export interface PlayerRewardPayoutRow {
  id: string;
  amountLamports: string;
  status: PlayerRewardPayoutStatus;
  signature: string | null;
  walletAddress: string;
  priceSource: string | null;
  solUsdPriceMicroUsd: string | null;
  priceObservedAt: string | null;
  createdAt: string;
  submittedAt: string | null;
  confirmedAt: string | null;
  failedAt: string | null;
  lastError: string | null;
}

export interface PlayerRewardSummary {
  totals: PlayerRewardTotals;
  payoutProgress: PlayerRewardPayoutProgress;
  rewards: PlayerRewardRow[];
  payouts: PlayerRewardPayoutRow[];
}

export interface PlayerRewardSummaryResponse {
  rewards: PlayerRewardSummary;
}

export interface WagerPaymentIntentSnapshot {
  intentId: string;
  lobbyId: string;
  status: string;
  token: 'SOL';
  amountLamports: string;
  treasuryWallet: string;
  walletAddress: string;
  memo: string;
  expiresAt: string;
  cluster: string;
  lastError?: string | null;
}

export interface WagerPaymentTransactionSnapshot {
  intentId: string;
  transactionBase64: string;
  lastValidBlockHeight: number;
  cluster: string;
}

export interface PregeneratedMapManifestResponse {
  map: PregeneratedMapCatalogSummary;
  artifact: PregeneratedMapArtifactEnvelope;
  manifest: VoxelMapManifest;
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

export async function requestPregeneratedMapManifest(mapId: string): Promise<PregeneratedMapManifestResponse> {
  const response = await fetch(`${getHttpUrl()}/maps/pregenerated/${encodeURIComponent(mapId)}/manifest`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load pregenerated map'));
  }

  const payload = await response.json() as {
    map?: PregeneratedMapCatalogSummary;
    artifact?: PregeneratedMapArtifactEnvelope;
  };
  if (!payload.map || !payload.artifact?.manifest || payload.artifact.header?.mapId !== mapId) {
    throw new Error('Pregenerated map response is invalid');
  }

  return {
    map: payload.map,
    artifact: payload.artifact,
    manifest: deserializeVoxelMapManifest(payload.artifact.manifest),
  };
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

export async function requestPlayerRewardSummary(signal?: AbortSignal): Promise<PlayerRewardSummary> {
  const response = await fetch(`${getHttpUrl()}/rewards`, {
    credentials: 'include',
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, 'Failed to load reward summary');
    throw Object.assign(new Error(message), { statusCode: response.status });
  }

  const payload = await response.json() as PlayerRewardSummaryResponse;
  return payload.rewards;
}

export async function createWagerPaymentIntent(input: {
  lobbyId: string;
  walletAddress: string;
  lobbyPlayerId?: string | null;
}): Promise<WagerPaymentIntentSnapshot> {
  const response = await fetch(`${getHttpUrl()}/wagers/lobbies/${encodeURIComponent(input.lobbyId)}/intents`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletAddress: input.walletAddress,
      lobbyPlayerId: input.lobbyPlayerId ?? null,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to create wager payment'));
  }

  const payload = await response.json() as { intent: WagerPaymentIntentSnapshot };
  return payload.intent;
}

export async function buildWagerPaymentTransaction(intentId: string): Promise<WagerPaymentTransactionSnapshot> {
  const response = await fetch(`${getHttpUrl()}/wagers/intents/${encodeURIComponent(intentId)}/transaction`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to build wager transaction'));
  }

  const payload = await response.json() as { transaction: WagerPaymentTransactionSnapshot };
  return payload.transaction;
}

export async function submitSignedWagerPaymentTransaction(input: {
  intentId: string;
  signedTransactionBase64: string;
}): Promise<WagerPaymentIntentSnapshot> {
  const response = await fetch(`${getHttpUrl()}/wagers/intents/${encodeURIComponent(input.intentId)}/signed-transaction`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedTransactionBase64: input.signedTransactionBase64 }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to submit wager payment'));
  }

  const payload = await response.json() as { intent: WagerPaymentIntentSnapshot };
  return payload.intent;
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

export async function requestRecordingsIndex(): Promise<RecordingsIndexResponse> {
  const response = await fetch(`${getHttpUrl()}/recordings`, {
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load recording controls'));
  }

  return response.json();
}

export async function requestCreateRecordingShowcase(input: {
  csrfToken: string;
  heroId: HeroId;
  gameplayMode: GameplayMode;
}): Promise<RecordingShowcaseJobResponse> {
  const response = await fetch(`${getHttpUrl()}/recordings/showcase`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': input.csrfToken,
    },
    body: JSON.stringify({
      heroId: input.heroId,
      gameplayMode: input.gameplayMode,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to start showcase recording'));
  }

  return response.json();
}

export async function requestRecordingShowcaseJob(jobId: string): Promise<RecordingShowcaseJobResponse> {
  const response = await fetch(`${getHttpUrl()}/recordings/showcase/${encodeURIComponent(jobId)}`, {
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load showcase recording'));
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
