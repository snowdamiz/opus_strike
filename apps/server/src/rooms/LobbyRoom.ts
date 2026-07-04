import type { IncomingMessage } from 'http';
import { Room, Client, matchMaker } from 'colyseus';
import { LobbyState, LobbyPlayer } from './schema/LobbyState';
import {
  DEFAULT_GAMEPLAY_MODE,
  DEFAULT_GAME_CONFIG,
  DEFAULT_MATCH_PERSPECTIVE,
  RANKED_GAMEPLAY_MODE,
  GOLDEN_VOXEL_MAP_THEME_ID,
  HERO_DEFINITIONS,
  assignTeamByCapacity,
  getGameplayModeCapacityCost,
  getGameplayModeLabel,
  getGameplayModeRules,
  getDefaultHeroSkinId,
  getHeroSkinDefinition,
  getRankFromRating,
  getTeamIdsForGameplayMode,
  getVoxelMapTheme,
  hashSeed,
  isCustomLobbyGameplayMode,
  isGameplayMode,
  isHeroSkinId,
  isMatchMode,
  isMatchPerspective,
  isTeamHeroAvailable,
  isTeamIdForGameplayMode,
  toPublicRankSnapshot,
  type GameplayModeRules,
} from '@voxel-strike/shared';
import type { MatchMode, MatchPerspective, PartyBotLaunchDescriptor } from '@voxel-strike/shared';
import type { BotDifficulty, GameplayMode, HeroId, HeroSkinId, MapProfileId, Team, VoxelMapSizeId, VoxelMapTheme } from '@voxel-strike/shared';
import { assertUsableEntryTicketSecret } from '../config/security';
import { resolveRoomAuthContext, type RoomAuthContext } from '../auth/session';
import { assertGameplayAccountEligible } from '../auth/accountEligibility';
import { assertTutorialCompleted } from '../auth/tutorialCompletion';
import { createGameEntryTicket, verifyGameEntryTicket } from '../security/entryTickets';
import { verifyMatchmakingTicket, type MatchmakingTicketClaims } from '../security/matchmakingTickets';
import { consumeReplayNonce } from '../security/replayNonceStore';
import {
  doesMatchmakingRegionMatch,
  getLocalMatchmakingRegion,
  normalizeMatchmakingRegion,
} from '../matchmaking/region';
import {
  DEFAULT_MATCHMAKING_RATING,
  DEFAULT_RANK_DIVISION_INDEX,
  getAllowedRankDivisionDistance,
  getRankDivisionLabel,
  normalizeRankDivisionIndex,
} from '../matchmaking/skill';
import { RANKED_BOT_FILL_MODE } from '../matchmaking/matchSettings';
import {
  IN_GAME_CAPACITY_RETRY_MS,
  MAX_IN_GAME_PLAYERS,
  canAdmitInGameCapacity,
  collectInGameCapacitySnapshot,
  isInGameCapacityAdmissionError,
  runWithInGameCapacity,
  InGameCapacityAdmissionError,
} from '../matchmaking/playerCapacity';
import {
  buildMatchmakingHeroQueueState,
  resolveMatchmakingHeroTeam,
} from '../matchmaking/heroQueues';
import { LOBBY_MESSAGE_RATE_LIMITS, MessageRateLimiter, type RateLimitRule } from './rateLimiter';
import prisma from '../db';
import {
  isBotDifficulty,
  isHeroId,
  isRecord,
  isTeam,
  sanitizeDisplayName,
  sanitizeShortText,
  validateBotIdPayload,
  validateBotPayload,
  validateChatPayload,
  validateMapVotePayload,
  validateReadyPayload,
  validateTeamPayload,
} from './protocolValidation';
import { buildLobbyChatPayload } from './roomChatRuntime';
import {
  countLobbyRoster,
  countLobbyTeamMembers,
  countLobbyTeamMembersExcluding,
  isLobbyObserver,
} from './lobbyRoster';
import {
  buildLobbyPlayerJoinedPayload,
  buildLobbyStatePayload,
} from './lobbyNetworkPayloads';
import {
  addMissingBotMapVotes as addMissingBotMapVotesForRoster,
  buildMapVoteStartedPayload,
  buildMapVoteUpdatedPayload,
  createMapVoteOptionFromCatalog,
  createMapLaunchSelection,
  createMapVoteOptions,
  getBattleRoyalEventBiomeThemeId,
  getBattleRoyalMapSizeForParticipantCount,
  getMapVoteRecords,
  getWinningMapOption,
  haveAllHumanPlayersVoted,
  type MapLaunchSelection,
  type MapVoteOption,
  type MapVotePlayer,
} from './lobbyMapVoteRuntime';
import {
  isPublicSeedGenerationFallbackEnabled,
  pregeneratedMapCatalogService,
  type PregeneratedMapLaunchSelection,
  type ReservedPregeneratedMapLaunch,
} from '../maps/pregeneratedMapCatalog';
import {
  buildGameEntryTicketInputs,
  buildGameStartingPayload,
  createLobbyGameStartAssignments,
  serializeGameSeatReservation,
  type ParticipantAssignment,
} from './lobbyGameStartRuntime';
import {
  cleanupLobbySession as cleanupLobbySessionState,
  type CleanupLobbySessionResult,
} from './lobbySessionCleanup';
import { applyRoomRankState } from './roomRankSnapshot';
import { resolveUserLoadoutForHero } from '../cosmetics/skinShopService';
import { loggers } from '../utils/logger';
import {
  wagerService,
  type CreateWagerOptions,
  type LobbyWagerSnapshot,
  type PlayerWagerPaymentStatus,
  type WagerPaymentStatusChanged,
} from '../wagers/service';
import { wagerEventBus } from '../wagers/eventBus';
import { getEnabledEventBiomeThemeId } from '../liveops/eventBiomeService';
import type { WagerRosterPlayer } from '../wagers/math';
import { BOT_RANKED_BATTLE_ROYAL_PROFILE_PREFIX } from './bot-ai';

type BotFillMode = 'manual' | 'fill_even';

interface JoinOptions {
  playerName?: string;
  lobbyName?: string;
  isPrivate?: boolean;
  matchmakingMode?: boolean;
  matchMode?: MatchMode;
  gameplayMode?: GameplayMode;
  matchmakingTicket?: string;
  matchmakingRegion?: string;
  matchPerspective?: MatchPerspective;
  rankBandId?: number;
  expectedPartyLeaderUserId?: string;
  authToken?: string;
  expectedHumanPlayers?: number;
  expectedHumanUserIds?: string[];
  wager?: CreateWagerOptions;
  initialBotCount?: number;
  botFillMode?: BotFillMode;
  defaultBotDifficulty?: BotDifficulty;
  botProfilePrefix?: string;
  selectedHero?: HeroId;
  selectedSkinId?: HeroSkinId;
  partyBots?: PartyBotLaunchDescriptor[];
  devTutorialBypass?: boolean;
}

export type CreateBotFailureReason = 'bots_disabled' | 'lobby_full' | 'team_full' | 'hero_taken';
type CreateBotResult =
  | { ok: true; bot: LobbyPlayer }
  | { ok: false; reason: CreateBotFailureReason };

interface MapVoteSession {
  options: MapVoteOption[];
  votes: Map<string, string>;
  phaseEndTime: number | null;
  previewReadyPlayerIds: Set<string>;
}

interface CreateGameMapLaunchOptions {
  pregeneratedMapId?: string | null;
  mapArtifactId?: string | null;
  mapSelectionId?: string | null;
}

const MAX_PLAYERS_PER_TEAM = DEFAULT_GAME_CONFIG.teamSize;
const PRODUCTION_CUSTOM_MIN_PARTICIPANTS = 2;
const CUSTOM_OBSERVER_SLOT_COUNT = 1;
const MAP_VOTE_DURATION_MS = 30000;
const MAP_VOTE_PREVIEW_READY_TIMEOUT_MS = 5000;
const MATCHMAKING_AUTO_START_DELAY_MS = 250;
const MATCHMAKING_BOT_FILL_GRACE_PERIOD_MS = 30000;
const RANKED_MATCHMAKING_BOT_FILL_GRACE_PERIOD_MS = 10000;
const BOT_NAMES = [
  'Vector',
  'Cipher',
  'Nova',
  'Kestrel',
  'Rook',
  'Sable',
  'Orbit',
  'Vega',
  'Mako',
  'Axiom',
];

export function getCreateBotFailureReason(input: {
  botsEnabled?: boolean;
  combatParticipantCount: number;
  maxParticipants: number;
  requestedTeam: Team | null;
  requestedTeamCount: number;
  maxPlayersPerTeam?: number;
}): CreateBotFailureReason | null {
  if (input.botsEnabled === false) {
    return 'bots_disabled';
  }

  if (
    input.requestedTeam
    && input.requestedTeamCount >= (input.maxPlayersPerTeam ?? MAX_PLAYERS_PER_TEAM)
  ) {
    return 'team_full';
  }

  if (input.combatParticipantCount >= input.maxParticipants) {
    return 'lobby_full';
  }

  return null;
}

export function getMatchmakingBotFillRequiredParticipants(input: {
  gameplayMode: GameplayMode;
  rules: GameplayModeRules;
  expectedPartyParticipantCount: number;
  largestTeamCount: number;
}): number {
  if (input.gameplayMode === 'battle_royal') {
    return Math.min(input.rules.maxPlayers, input.rules.maxTeams * input.rules.maxTeamSize);
  }

  const sideSize = Math.max(
    1,
    input.expectedPartyParticipantCount,
    input.largestTeamCount
  );
  return Math.min(
    input.rules.maxPlayers,
    Math.max(input.rules.minPlayers, sideSize * input.rules.maxTeams)
  );
}

export function getMatchmakingBotFillPriorityTeams(input: {
  gameplayMode: GameplayMode;
  partyTeam: Team | null;
  partyTeamCount: number;
  maxTeamSize: number;
  missingParticipants: number;
}): Team[] {
  if (input.gameplayMode !== 'battle_royal' || !input.partyTeam || input.missingParticipants <= 0) {
    return [];
  }

  const partyTeam = input.partyTeam;
  const openSquadSlots = Math.max(0, Math.floor(input.maxTeamSize) - Math.max(0, Math.floor(input.partyTeamCount)));
  const fillCount = Math.min(openSquadSlots, Math.floor(input.missingParticipants));
  return Array.from({ length: fillCount }, () => partyTeam);
}

export function getMatchmakingJoinCapacity(input: {
  botFillEnabled: boolean;
  status: string;
  requiredPlayers: number;
  maxPlayers: number;
}): number {
  if (input.botFillEnabled && input.status === 'matchmaking') {
    return input.maxPlayers;
  }

  return input.requiredPlayers;
}

export function shouldCancelExpectedPartyMatchmakingQueue(input: {
  status: string;
  leavingUserId: string | null;
  expectedPartyLeaderUserId: string | null;
  expectedHumanUserCount: number;
}): boolean {
  return input.status === 'matchmaking'
    && input.expectedHumanUserCount > 1
    && Boolean(input.leavingUserId)
    && input.leavingUserId === input.expectedPartyLeaderUserId;
}

export class LobbyRoom extends Room<LobbyState> {
  maxClients = DEFAULT_GAME_CONFIG.maxPlayers;
  private botIdCounter = 0;
  private mapVoteSession: MapVoteSession | null = null;
  private isFinalizingMapVote = false;
  private mapVoteFinalizeTimeout: ReturnType<typeof setTimeout> | null = null;
  private mapVotePreviewReadyTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly rateLimiter = new MessageRateLimiter();
  private readonly playerAuthContexts = new Map<string, RoomAuthContext>();
  private readonly playerCompetitiveRatings = new Map<string, number>();
  private readonly playerMatchmakingTickets = new Map<string, MatchmakingTicketClaims>();
  private disposed = false;
  private matchMode: MatchMode = 'custom';
  private gameplayMode: GameplayMode = DEFAULT_GAMEPLAY_MODE;
  private matchPerspective: MatchPerspective = DEFAULT_MATCH_PERSPECTIVE;
  private gameplayRules: GameplayModeRules = getGameplayModeRules(DEFAULT_GAMEPLAY_MODE);
  private isQuickPlayQueue = false;
  private isRankedQueue = false;
  private matchmakingRegion: string | undefined;
  private wagerSetupStarted = false;
  private rankBandId = DEFAULT_RANK_DIVISION_INDEX;
  private minimumMatchmakingHumanCount = 1;
  private expectedMatchmakingPartyParticipantCount = 1;
  private expectedMatchmakingUserIds: Set<string> | null = null;
  private expectedMatchmakingPartyLeaderUserId: string | null = null;
  private matchmakingPartyTeam: Team | null = null;
  private pendingPartyBots: PartyBotLaunchDescriptor[] = [];
  private initialWagerOptions: CreateWagerOptions | undefined;
  private lobbyWagerSnapshot: LobbyWagerSnapshot = { enabled: false };
  private playerWagerPaymentStatuses: PlayerWagerPaymentStatus[] = [];
  private unsubscribeWagerEvents: (() => Promise<void>) | null = null;
  private matchmakingAutoStartTimeout: ReturnType<typeof setTimeout> | null = null;
  private matchmakingAutoStartAt = 0;
  private capacityRetryTimeout: ReturnType<typeof setTimeout> | null = null;
  private gameStartDisconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private matchmakingCapacityBlocked = false;
  private matchmakingCapacityCheckInFlight = false;
  private botProfilePrefix = '';
  
  // Track durable auth identity -> sessionId mapping for duplicate session handling.
  private identityToSessionId: Map<string, string> = new Map();
  private sessionIdToIdentity: Map<string, string> = new Map();

  async onAuth(client: Client, options: JoinOptions, request?: IncomingMessage): Promise<RoomAuthContext> {
    const authContext = await resolveRoomAuthContext(options as Record<string, unknown>, request);
    await assertGameplayAccountEligible(authContext.userId);
    assertTutorialCompleted(authContext.tutorialCompletedAt, {
      devBypass: options.devTutorialBypass,
    });
    return authContext;
  }

  onCreate(options: JoinOptions) {
    this.autoDispose = true;
    assertUsableEntryTicketSecret();
    const initialMatchmakingTicket = options.matchmakingMode === true
      ? verifyMatchmakingTicket(options.matchmakingTicket)
      : null;
    this.matchMode = this.resolveRoomMatchMode(options, initialMatchmakingTicket);
    this.gameplayMode = this.resolveRoomGameplayMode(options, initialMatchmakingTicket);
    this.matchPerspective = this.resolveRoomMatchPerspective(options, initialMatchmakingTicket);
    this.initialWagerOptions = options.wager;
    this.gameplayRules = getGameplayModeRules(this.gameplayMode);
    this.isQuickPlayQueue = this.matchMode === 'quick_play';
    this.isRankedQueue = this.matchMode === 'ranked';
    this.matchmakingRegion = this.resolveRoomMatchmakingRegion(options, initialMatchmakingTicket);
    this.rankBandId = this.resolveRoomRankBand(options, initialMatchmakingTicket);

    this.setState(new LobbyState());
    this.state.lobbyId = this.roomId;
    this.state.matchMode = this.matchMode;
    this.state.gameplayMode = this.gameplayMode;
    this.state.matchPerspective = this.matchPerspective;
    this.state.name = options.lobbyName || (this.isQuickPlayQueue ? getGameplayModeLabel(this.gameplayMode) : this.isRankedQueue ? 'Ranked' : `Lobby ${this.roomId.slice(0, 6)}`);
    this.state.maxPlayers = this.gameplayRules.maxPlayers;
    this.state.maxParticipants = this.getLobbyParticipantCapacity();
    this.maxClients = this.state.maxParticipants;
    this.minimumMatchmakingHumanCount = this.resolveMinimumMatchmakingHumanCount(options);
    this.expectedMatchmakingUserIds = this.resolveExpectedMatchmakingUserIds(options);
    this.expectedMatchmakingPartyLeaderUserId = this.resolveExpectedMatchmakingPartyLeaderUserId(options);
    this.expectedMatchmakingPartyParticipantCount = this.resolveExpectedMatchmakingPartyParticipantCount(options);
    this.state.isPublic = !options.isPrivate && !this.isMatchmakingQueue();
    this.state.createdAt = Date.now();
    this.state.status = this.isMatchmakingQueue() ? 'matchmaking' : 'waiting';
    this.state.defaultBotDifficulty = this.normalizeDifficulty(options.defaultBotDifficulty);
    this.botProfilePrefix = this.resolveBotProfilePrefix(options);
    this.state.botFillMode = this.gameplayRules.botsEnabled
      ? this.resolveRoomBotFillMode(options, initialMatchmakingTicket)
      : 'manual';

    // Set metadata for lobby listing
    this.updateMetadata();

    // Handle messages
    this.onMessage('ready', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'ready', LOBBY_MESSAGE_RATE_LIMITS.ready)) return;
      const ready = validateReadyPayload(data);
      if (ready === null) return;
      this.handleReady(client, ready);
    });

    this.onMessage('setTeam', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'setTeam', LOBBY_MESSAGE_RATE_LIMITS.team)) return;
      const team = validateTeamPayload(data);
      if (!team) return;
      this.handleSetTeam(client, team);
    });

    this.onMessage('setObserver', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'setObserver', LOBBY_MESSAGE_RATE_LIMITS.team)) return;
      const observer = !isRecord(data) || data.observer !== false;
      this.handleSetObserver(client, observer);
    });

    this.onMessage('startGame', (client) => {
      if (!this.consumeLobbyMessage(client, 'startGame', LOBBY_MESSAGE_RATE_LIMITS.hostAction)) return;
      this.handleStartGame(client);
    });

    this.onMessage('voteMap', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'voteMap', LOBBY_MESSAGE_RATE_LIMITS.mapVote)) return;
      const optionId = validateMapVotePayload(data);
      if (!optionId) return;
      this.handleMapVote(client, optionId);
    });

    this.onMessage('mapVotePreviewsReady', (client) => {
      if (!this.rateLimiter.consume(client.sessionId, 'mapVotePreviewsReady', LOBBY_MESSAGE_RATE_LIMITS.mapVote)) return;
      this.handleMapVotePreviewsReady(client);
    });

    this.onMessage('kick', (client, data: unknown) => {
      if (!this.consumeLobbyMessage(client, 'kick', LOBBY_MESSAGE_RATE_LIMITS.hostAction)) return;
      if (!isRecord(data)) return;
      const playerId = sanitizeShortText(data.playerId, 96);
      if (!playerId) return;
      this.handleKick(client, playerId);
    });

    this.onMessage('addBot', (client, data: unknown = {}) => {
      if (!this.consumeLobbyMessage(client, 'addBot', LOBBY_MESSAGE_RATE_LIMITS.hostAction)) return;
      const payload = validateBotPayload(data);
      if (!payload) return;
      this.handleAddBot(client, payload);
    });

    this.onMessage('removeBot', (client, data: unknown) => {
      if (!this.consumeLobbyMessage(client, 'removeBot', LOBBY_MESSAGE_RATE_LIMITS.hostAction)) return;
      const botId = validateBotIdPayload(data);
      if (!botId) return;
      this.handleRemoveBot(client, botId);
    });

    this.onMessage('updateBotTeam', (client, data: unknown) => {
      if (!this.consumeLobbyMessage(client, 'updateBotTeam', LOBBY_MESSAGE_RATE_LIMITS.hostAction)) return;
      if (!isRecord(data)) return;
      const botId = validateBotIdPayload(data);
      const team = isTeam(data.team) ? data.team : null;
      if (!botId || !team) return;
      this.handleUpdateBotTeam(client, botId, team);
    });

    this.onMessage('updateBotDifficulty', (client, data: unknown) => {
      if (!this.consumeLobbyMessage(client, 'updateBotDifficulty', LOBBY_MESSAGE_RATE_LIMITS.hostAction)) return;
      if (!isRecord(data)) return;
      const botId = validateBotIdPayload(data);
      const difficulty = isBotDifficulty(data.difficulty) ? data.difficulty : null;
      if (!botId || !difficulty) return;
      this.handleUpdateBotDifficulty(client, botId, difficulty);
    });

    this.onMessage('updateBotHero', (client, data: unknown) => {
      if (!this.consumeLobbyMessage(client, 'updateBotHero', LOBBY_MESSAGE_RATE_LIMITS.hostAction)) return;
      if (!isRecord(data)) return;
      const botId = validateBotIdPayload(data);
      const heroId = data.heroId === '' ? '' : isHeroId(data.heroId) ? data.heroId : null;
      if (!botId || heroId === null) return;
      this.handleUpdateBotHero(client, botId, heroId);
    });

    this.onMessage('chat', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'chat', LOBBY_MESSAGE_RATE_LIMITS.chat)) return;
      const chat = validateChatPayload(data);
      if (!chat) return;
      this.handleChat(client, chat.message);
    });

    const initialBotCount = !this.gameplayRules.botsEnabled
      ? 0
      : Math.max(0, Math.min(this.gameplayRules.maxPlayers - 1, Math.floor(options.initialBotCount || 0)));
    for (let i = 0; i < initialBotCount; i++) {
      const result = this.createBot({ difficulty: this.state.defaultBotDifficulty as BotDifficulty });
      if (!result.ok) break;
    }
    const partyBots = Array.isArray(options.partyBots)
      ? options.partyBots.slice(0, Math.max(0, this.gameplayRules.maxPlayers - this.getCombatParticipantCount()))
      : [];
    if (this.isMatchmakingQueue() && this.expectedMatchmakingUserIds && partyBots.length > 0) {
      this.pendingPartyBots = partyBots;
    } else {
      for (const partyBot of partyBots) {
        const result = this.createBot({
          difficulty: partyBot.difficulty,
          name: partyBot.displayName,
          heroId: partyBot.heroId,
          skinId: partyBot.skinId,
        });
        if (!result.ok && result.reason === 'hero_taken') {
          this.createBot({
            difficulty: partyBot.difficulty,
            name: partyBot.displayName,
          });
        }
      }
    }
    this.updateMetadata();
  }

  requestJoin(options: JoinOptions, isNewRoom: boolean): boolean {
    if (isNewRoom || options.matchmakingMode !== true) return true;
    if (!this.isMatchmakingQueue()) return false;

    const requestedTicket = options.matchmakingTicket
      ? verifyMatchmakingTicket(options.matchmakingTicket)
      : null;
    const requestedTicketMode = requestedTicket?.mode === 'ranked' ? 'ranked' : requestedTicket?.mode === 'quick_play' ? 'quick_play' : null;
    const requestedMatchMode: MatchMode = requestedTicketMode ?? (options.matchMode === 'ranked' ? 'ranked' : 'quick_play');
    if (requestedMatchMode !== this.matchMode) return false;
    const requestedRegion = normalizeMatchmakingRegion(requestedTicket?.matchmakingRegion)
      ?? normalizeMatchmakingRegion(options.matchmakingRegion);
    if (!doesMatchmakingRegionMatch(this.matchmakingRegion, requestedRegion)) return false;

    const requestedGameplayMode = requestedMatchMode === 'ranked'
      ? RANKED_GAMEPLAY_MODE
      : isGameplayMode(requestedTicket?.gameplayMode)
        ? requestedTicket.gameplayMode
        : isGameplayMode(options.gameplayMode)
        ? options.gameplayMode
        : DEFAULT_GAMEPLAY_MODE;
    if (requestedGameplayMode !== this.gameplayMode) return false;

    const requestedPerspective = requestedMatchMode === 'ranked'
      ? DEFAULT_MATCH_PERSPECTIVE
      : isMatchPerspective(requestedTicket?.matchPerspective)
        ? requestedTicket.matchPerspective
        : isMatchPerspective(options.matchPerspective)
          ? options.matchPerspective
          : DEFAULT_MATCH_PERSPECTIVE;
    if (requestedPerspective !== this.matchPerspective) return false;

    if (typeof options.rankBandId === 'number' && options.rankBandId !== this.rankBandId) return false;
    const requestedBotFillMode = requestedMatchMode === 'ranked'
      ? RANKED_BOT_FILL_MODE
      : requestedTicket
        ? requestedTicket.botFillMode
        : this.normalizeBotFillMode(options.botFillMode);
    if (requestedBotFillMode !== this.state.botFillMode) return false;
    if (!this.isJoinSelectedHeroConsistent(options, requestedTicket)) return false;
    if (!this.isJoinSelectedSkinConsistent(options, requestedTicket)) return false;
    const requestedUserId = this.getRequestedMatchmakingUserId(options);
    if (this.shouldReserveExpectedHumanSlot(requestedUserId)) return false;
    if (this.getCombatParticipantCount() >= this.getMatchmakingJoinCapacity()) return false;
    if (!this.canAdmitMatchmakingHero(requestedUserId, this.resolveJoinSelectedHero(options, requestedTicket))) return false;
    return true;
  }

  async onJoin(client: Client, options: JoinOptions) {
    const authContext = (client as Client & { auth?: RoomAuthContext }).auth;
    if (!authContext) {
      client.send('error', { message: 'Authentication required' });
      client.leave();
      return;
    }

    const matchmakingTicket = this.isMatchmakingQueue()
      ? verifyMatchmakingTicket(options.matchmakingTicket)
      : null;
    if (this.isMatchmakingQueue() && !this.isValidMatchmakingTicket(matchmakingTicket, authContext, options)) {
      client.send('error', { message: 'Invalid matchmaking ticket' });
      client.leave();
      return;
    }
    if (matchmakingTicket) {
      const consumed = await consumeReplayNonce('matchmaking', matchmakingTicket.nonce, matchmakingTicket.expiresAt);
      if (!consumed) {
        client.send('error', { message: 'Matchmaking ticket already used' });
        client.leave();
        return;
      }
      this.playerMatchmakingTickets.set(client.sessionId, matchmakingTicket);
    }

    let canJoinInviteOnlyLobby = false;
    try {
      canJoinInviteOnlyLobby = await this.canJoinInviteOnlyLobby(authContext);
    } catch (error) {
      console.error('[LobbyRoom] Failed to verify lobby invite access:', error);
    }

    if (!canJoinInviteOnlyLobby) {
      client.send('error', { message: 'This lobby is invite only' });
      client.leave();
      return;
    }

    this.playerAuthContexts.set(client.sessionId, authContext);

    // Handle duplicate tabs by durable auth identity.
    const identityKey = authContext.userId;
    if (identityKey) {
      const existingSessionId = this.identityToSessionId.get(identityKey);
      
      if (existingSessionId && existingSessionId !== client.sessionId) {
        // Find and disconnect the old client
        const oldClient = this.clients.find(c => c.sessionId === existingSessionId);
        if (oldClient) {
          oldClient.send('duplicateSession', { reason: 'Connected from another tab/window' });
          oldClient.leave(4000); // Custom code for duplicate session
        }
        
        const cleanup = this.cleanupLobbySession(existingSessionId);
        
        // Broadcast that old player left
        this.broadcast('playerLeft', { playerId: existingSessionId });
        if (cleanup.removedVote) {
          this.broadcastMapVoteUpdated();
        }
      }
      
      this.identityToSessionId.set(identityKey, client.sessionId);
      this.sessionIdToIdentity.set(client.sessionId, identityKey);
    }

    if (this.state.players.size >= this.state.maxParticipants) {
      client.send('error', { message: 'Lobby is full' });
      this.cleanupLobbySession(client.sessionId);
      client.leave();
      return;
    }

    const selectedHero = this.resolveJoinSelectedHero(options, matchmakingTicket);
    const selectedSkin = await this.resolveJoinSelectedSkinForUser(authContext, options, matchmakingTicket, selectedHero);
    const playerTeam = this.isMatchmakingQueue()
      ? this.resolveMatchmakingJoiningPlayerTeam(authContext, selectedHero)
      : '';
    if (playerTeam === null) {
      client.send('error', { message: 'Selected hero is already picked on the available team' });
      this.cleanupLobbySession(client.sessionId);
      client.leave();
      return;
    }

    const isHost = this.getLobbyHumanCount() === 0;
    if (isHost && !await this.ensureWageredLobbyForHost(authContext.userId, options.wager)) {
      client.send('error', { message: 'Failed to create wagered lobby' });
      client.leave();
      return;
    }

    const player = new LobbyPlayer();
    player.id = client.sessionId;
    player.name = authContext.displayName || `Player${this.state.players.size + 1}`;
    player.isHost = isHost; // First human player is host
    player.isReady = this.isMatchmakingQueue();
    player.team = playerTeam;
    player.heroId = selectedHero ?? '';
    player.skinId = selectedSkin ?? '';
    player.isBot = false;
    player.botDifficulty = '';
    player.botProfileId = '';
    applyRoomRankState(player, toPublicRankSnapshot(authContext.rank));

    if (player.isHost) {
      this.state.hostId = client.sessionId;
    }

    this.state.players.set(client.sessionId, player);
    this.playerCompetitiveRatings.set(
      client.sessionId,
      this.resolvePlayerCompetitiveRating(authContext)
    );
    this.createPendingPartyBotsForJoinedPlayer(authContext, player.team);
    await this.refreshWagerPaymentStatuses();

    // Notify all players
    this.broadcast('playerJoined', buildLobbyPlayerJoinedPayload(client.sessionId, player));

    // Send current lobby state to the new player
    client.send('lobbyState', this.buildLobbyStatePayload());

    if (this.state.status === 'map_vote' && this.mapVoteSession) {
      this.sendMapVoteStarted(client);
    }
    this.updateMetadata();
    this.broadcastLobbyState();
    this.broadcastMatchmakingStatus();
    this.scheduleMatchmakingAutoStart();
  }

  private async canJoinInviteOnlyLobby(authContext: RoomAuthContext): Promise<boolean> {
    if (this.isMatchmakingQueue() || this.state.isPublic || this.getLobbyHumanCount() === 0) {
      return true;
    }

    const existingSessionId = this.identityToSessionId.get(authContext.userId);
    if (existingSessionId && this.state.players.has(existingSessionId)) {
      return true;
    }

    const invite = await prisma.lobbyInvite.findFirst({
      where: {
        lobbyId: this.roomId,
        toUserId: authContext.userId,
        status: 'accepted',
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    return Boolean(invite);
  }

  onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    const wasHost = player?.isHost;
    const authContext = this.playerAuthContexts.get(client.sessionId);
    const leavingUserId = authContext?.userId ?? null;
    const shouldCancelExpectedPartyQueue = this.shouldCancelExpectedPartyQueueForLeavingUser(leavingUserId);

    const cleanup = this.cleanupLobbySession(client.sessionId);

    // If host left, assign new host
    if (wasHost && this.state.players.size > 0) {
      const newHost = Array.from(this.state.players.values()).find((p) => !p.isBot);
      if (newHost) {
        newHost.isHost = true;
        this.state.hostId = newHost.id;
        
        this.broadcast('hostChanged', {
          newHostId: newHost.id,
          newHostName: newHost.name,
        });
      }
    }

    this.broadcast('playerLeft', {
      playerId: client.sessionId,
    });
    if (cleanup.removedVote) {
      this.broadcastMapVoteUpdated();
    }
    this.startMapVoteCountdownIfReady();
    this.updateMetadata();
    this.broadcastLobbyState();
    this.broadcastMatchmakingStatus();

    if (shouldCancelExpectedPartyQueue) {
      this.cancelExpectedPartyQueueForLeader(leavingUserId);
    }
  }

  async onDispose() {
    this.disposed = true;
    this.clearMapVoteTimer();
    this.clearMatchmakingAutoStart();
    this.clearCapacityRetry();
    this.clearGameStartDisconnectTimer();
    if (this.unsubscribeWagerEvents) {
      await this.unsubscribeWagerEvents().catch((error) => {
        loggers.room.warn('Failed to unsubscribe wager events', {
          lobbyId: this.state.lobbyId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      this.unsubscribeWagerEvents = null;
    }
  }

  private consumeLobbyMessage(client: Client, messageType: string, rule: RateLimitRule): boolean {
    if (this.rateLimiter.consume(client.sessionId, messageType, rule)) {
      return true;
    }

    client.send('error', { message: 'Too many lobby actions. Wait a moment and try again.' });
    return false;
  }

  private handleReady(client: Client, ready: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (this.isRankedQueue) {
      client.send('error', { message: 'Ranked readiness is automatic' });
      return;
    }

    if (ready && !isLobbyObserver(player) && !this.isTeam(player.team)) {
      client.send('error', { message: 'Choose a team before readying up' });
      return;
    }

    player.isReady = isLobbyObserver(player) ? true : ready;

    this.broadcast('playerReady', {
      playerId: client.sessionId,
      ready: player.isReady,
    });
    this.updateMetadata();
    this.broadcastLobbyState();
  }

  private handleSetTeam(client: Client, team: string) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (this.isRankedQueue) {
      client.send('error', { message: 'Ranked teams are assigned automatically' });
      return;
    }

    if (!this.isTeam(team)) return;

    // Check team balance
    const teamCount = this.getTeamCountExcluding(team, client.sessionId);
    const maxPerTeam = this.gameplayRules.maxTeamSize;
    if (teamCount >= maxPerTeam) {
      client.send('error', { message: 'Team is full' });
      return;
    }

    const wasObserver = isLobbyObserver(player);
    player.role = 'combat';
    player.team = team;
    if (wasObserver) {
      player.isReady = false;
    }

    this.broadcast('playerTeamChanged', {
      playerId: client.sessionId,
      team,
    });
    this.broadcast('playerRoleChanged', {
      playerId: client.sessionId,
      role: player.role,
      team: player.team,
      isReady: player.isReady,
    });
    this.updateMetadata();
    this.broadcastLobbyState();
  }

  private handleSetObserver(client: Client, observer: boolean): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.isBot) return;

    if (!this.isObserverSlotEnabled()) {
      client.send('error', { message: 'Observers are only available in custom lobbies' });
      return;
    }

    if (observer && !isLobbyObserver(player) && this.getObserverCount() >= CUSTOM_OBSERVER_SLOT_COUNT) {
      client.send('error', { message: 'Observer slot is full' });
      return;
    }

    player.role = observer ? 'observer' : 'combat';
    if (observer) {
      player.team = '';
      player.heroId = '';
      player.skinId = '';
      player.isReady = true;
    } else {
      player.isReady = false;
    }

    this.broadcast('playerRoleChanged', {
      playerId: client.sessionId,
      role: player.role,
      team: player.team,
      heroId: player.heroId,
      skinId: player.skinId,
      isReady: player.isReady,
    });
    this.updateMetadata();
    this.broadcastLobbyState();
  }

  private async handleStartGame(client: Client) {
    // IMPORTANT: Prevent double-execution - check status FIRST before any async operations
    if (this.state.status === 'map_vote') {
      this.sendMapVoteStarted(client);
      return;
    }

    if (this.state.status === 'starting' || this.state.status === 'in_game') {
      return;
    }
    
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.isHost) {
      client.send('error', { message: 'Only the host can start the game' });
      return;
    }
    if (this.isRankedQueue) {
      client.send('error', { message: 'Ranked matches start automatically after the roster is full' });
      return;
    }

    const minimumParticipants = this.getMinimumParticipantsToStart();
    const combatParticipantCount = this.getCombatParticipantCount();
    if (combatParticipantCount < minimumParticipants) {
      const participantLabel = minimumParticipants === 1
        ? 'player'
        : 'players or bots';
      client.send('error', { message: `Need at least ${minimumParticipants} ${participantLabel} to start` });
      return;
    }

    if (this.hasUnassignedPlayers()) {
      client.send('error', { message: 'All players must choose a team' });
      return;
    }

    // Check if all players are ready (except host who can start anytime)
    let allReady = true;
    this.state.players.forEach((p) => {
      if (isLobbyObserver(p)) return;
      if (!p.isHost && !p.isReady) {
        allReady = false;
      }
    });

    if (!allReady && combatParticipantCount > 1) {
      client.send('error', { message: 'Not all players are ready' });
      return;
    }

    const capacityAvailable = await this.ensureInGameCapacityAvailableForRoster(client);
    if (!capacityAvailable) return;
    if (!await this.ensureWagerStartReady(client)) return;

    await this.startMapSelection(client);
  }

  private async ensureWagerStartReady(client?: Client): Promise<boolean> {
    try {
      const eligibility = await wagerService.getStartEligibility(this.state.lobbyId, this.buildWagerRoster());
      if (eligibility.canStart) return true;

      const message = eligibility.reasons.includes('unpaid_players')
        ? 'All combat players must pay the wager before the game can start'
        : 'Each team needs at least one paid human player before the wager can start';
      client?.send('error', { message });
      return false;
    } catch (error) {
      loggers.room.warn('Failed to check wager start eligibility', {
        lobbyId: this.state.lobbyId,
        error: error instanceof Error ? error.message : String(error),
      });
      client?.send('error', { message: 'Failed to verify wager payments' });
      return false;
    }
  }

  private async ensureWageredLobbyForHost(
    hostUserId: string,
    wagerOptions?: CreateWagerOptions
  ): Promise<boolean> {
    const baseWagerOptions = this.initialWagerOptions ?? wagerOptions;
    const effectiveWagerOptions = this.matchMode === 'custom_wager'
      ? { ...baseWagerOptions, enabled: true }
      : baseWagerOptions;
    if (effectiveWagerOptions?.enabled !== true) return true;
    if (this.wagerSetupStarted) return true;

    this.wagerSetupStarted = true;
    try {
      const snapshot = await wagerService.createWageredLobby({
        lobbyId: this.state.lobbyId,
        createdByUserId: hostUserId,
        matchMode: this.matchMode === 'ranked' ? 'ranked' : 'custom_wager',
        options: effectiveWagerOptions,
      });
      if (!snapshot.enabled) {
        this.wagerSetupStarted = false;
        return this.matchMode !== 'custom_wager';
      }
      this.lobbyWagerSnapshot = snapshot;
      await this.subscribeToWagerEvents();
      await this.refreshWagerPaymentStatuses();
      this.updateMetadata();
      return true;
    } catch (error) {
      loggers.room.warn('Failed to create wagered lobby', {
        lobbyId: this.state.lobbyId,
        hostUserId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.wagerSetupStarted = false;
      return false;
    }
  }

  private async subscribeToWagerEvents(): Promise<void> {
    if (this.unsubscribeWagerEvents || !this.lobbyWagerSnapshot.enabled) return;
    this.unsubscribeWagerEvents = await wagerEventBus.subscribeToLobby(
      this.state.lobbyId,
      (payload) => this.handleWagerPaymentStatusChanged(payload)
    );
  }

  private async handleWagerPaymentStatusChanged(payload: WagerPaymentStatusChanged): Promise<void> {
    if (payload.lobbyId !== this.state.lobbyId) return;
    await this.refreshWagerPaymentStatuses();
    this.updateMetadata();
    this.broadcastLobbyState();
  }

  private async refreshWagerPaymentStatuses(): Promise<void> {
    if (!this.lobbyWagerSnapshot.enabled) {
      this.playerWagerPaymentStatuses = [];
      return;
    }
    this.lobbyWagerSnapshot = await wagerService.getLobbySnapshot(this.state.lobbyId);
    this.playerWagerPaymentStatuses = await wagerService.getPlayerPaymentStatuses(
      this.state.lobbyId,
      this.buildWagerRoster()
    );
  }

  private createMapSelectionSource(): number {
    return hashSeed(Date.now() ^ Math.imul(this.botIdCounter + 1, 0x632be59b));
  }

  private async startMapSelection(errorClient?: Client): Promise<void> {
    try {
      if (this.gameplayMode === 'battle_royal') {
        await this.startBattleRoyalMapGeneration(errorClient);
        return;
      }

      await this.beginMapVote();
    } catch (error) {
      loggers.room.warn('Failed to start map selection', {
        lobbyId: this.state.lobbyId,
        gameplayMode: this.gameplayMode,
        error: error instanceof Error ? error.message : String(error),
      });
      const status = this.isMatchmakingQueue() ? 'matchmaking' : 'waiting';
      this.state.status = status;
      this.mapVoteSession = null;
      this.clearMapVoteTimer();
      this.setMatchmakingLocked(false);
      this.updateMetadata({ status });
      this.broadcast('mapVoteCancelled', {
        reason: 'Failed to load ready maps',
        status,
        gameplayMode: this.gameplayMode,
      });
      this.broadcastLobbyState();
      errorClient?.send('error', { message: 'Failed to load ready maps' });
    }
  }

  private async startBattleRoyalMapGeneration(errorClient?: Client): Promise<void> {
    if (this.isFinalizingMapVote || this.state.status === 'starting' || this.state.status === 'in_game') return;

    this.isFinalizingMapVote = true;
    let launchOptions: CreateGameMapLaunchOptions | null = null;
    try {
      this.clearMapVoteTimer();
      this.clearCapacityRetry();
      this.setMatchmakingCapacityBlocked(false);
      this.mapVoteSession = null;

      const source = this.createMapSelectionSource();
      const participantCount = this.getCombatParticipantCount();
      const eventThemeId = await getEnabledEventBiomeThemeId();
      const preferredMapSize = getBattleRoyalMapSizeForParticipantCount({
        participantCount,
        rules: this.gameplayRules,
      });
      const pooledSelection = await pregeneratedMapCatalogService.selectMapForBattleRoyal({
        participantCount,
        preferredMapSize,
        source,
        eventThemeId,
      });

      let selection: MapLaunchSelection | PregeneratedMapLaunchSelection | null = pooledSelection;
      let selectedMapThemeId: VoxelMapTheme['id'] | null = null;
      if (selection?.pregeneratedMapId) {
        let reserved: ReservedPregeneratedMapLaunch | null = null;
        try {
          reserved = await pregeneratedMapCatalogService.reserveMapForLaunch({
            mapId: selection.pregeneratedMapId,
            lobbyId: this.state.lobbyId,
            selectionSource: 'battle-royal-auto',
          });
        } catch (error) {
          if (!isPublicSeedGenerationFallbackEnabled()) throw error;
          loggers.room.warn('Using Battle Royal fallback because pregenerated map reservation failed', {
            lobbyId: this.state.lobbyId,
            mapId: selection.pregeneratedMapId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        if (!reserved) {
          if (!isPublicSeedGenerationFallbackEnabled()) {
            throw new Error('Selected Battle Royal map is no longer ready');
          }
          selection = null;
        } else {
          selection = {
            id: 'map_1',
            seed: reserved.map.seed,
            mapSize: reserved.map.mapSize,
            mapProfileId: reserved.map.profileId,
            mapThemeId: reserved.map.themeId,
            pregeneratedMapId: reserved.map.id,
            mapArtifactId: reserved.map.artifactId,
            topologyId: reserved.map.topologyId,
            displayName: reserved.map.displayName,
          };
          selectedMapThemeId = reserved.map.themeId;
          launchOptions = {
            pregeneratedMapId: reserved.map.id,
            mapArtifactId: reserved.map.artifactId,
            mapSelectionId: reserved.selectionId,
          };
        }
      }

      if (!selection) {
        if (!isPublicSeedGenerationFallbackEnabled()) {
          throw new Error('Battle Royal map pool is depleted');
        }
        selection = createMapLaunchSelection({
          gameplayMode: this.gameplayMode,
          source,
          participantCount,
          eventThemeId,
        });
        const fallbackMapThemeId = await this.resolveSelectedMapThemeId(selection.seed);
        try {
          const generated = await pregeneratedMapCatalogService.generateAndReserveMapForLaunch({
            seed: selection.seed,
            themeId: fallbackMapThemeId,
            mapSize: selection.mapSize,
            profileId: selection.mapProfileId,
            visibility: 'matchmaking-only',
            lobbyId: this.state.lobbyId,
            selectionSource: 'fallback',
          });
          selection = {
            id: 'map_1',
            seed: generated.map.seed,
            mapSize: generated.map.mapSize,
            mapProfileId: generated.map.profileId,
            mapThemeId: generated.map.themeId,
            pregeneratedMapId: generated.map.id,
            mapArtifactId: generated.map.artifactId,
            topologyId: generated.map.topologyId,
            displayName: generated.map.displayName,
          };
          selectedMapThemeId = generated.map.themeId;
          launchOptions = {
            pregeneratedMapId: generated.map.id,
            mapArtifactId: generated.map.artifactId,
            mapSelectionId: generated.selectionId,
          };
          loggers.room.warn('Using on-demand generated Battle Royal map fallback', {
            lobbyId: this.state.lobbyId,
            pregeneratedMapId: generated.map.id,
            mapArtifactId: generated.map.artifactId,
            mapSeed: generated.map.seed,
            mapSize: generated.map.mapSize,
            mapThemeId: generated.map.themeId,
          });
        } catch (error) {
          selectedMapThemeId = fallbackMapThemeId;
          loggers.room.warn('Using seed-generated Battle Royal map fallback because on-demand generation failed', {
            lobbyId: this.state.lobbyId,
            mapSeed: selection.seed,
            mapSize: selection.mapSize,
            mapProfileId: selection.mapProfileId,
            mapThemeId: fallbackMapThemeId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      selectedMapThemeId ??= await this.resolveSelectedMapThemeId(selection.seed);

      this.state.status = 'starting';
      this.setMatchmakingLocked(true);
      this.updateMetadata({ status: 'starting' });

      this.broadcast('mapGenerationStarted', {
        mapSeed: selection.seed,
        mapThemeId: selectedMapThemeId,
        mapSize: selection.mapSize,
        mapProfileId: selection.mapProfileId,
        pregeneratedMapId: launchOptions?.pregeneratedMapId ?? null,
        mapArtifactId: launchOptions?.mapArtifactId ?? null,
        gameplayMode: this.gameplayMode,
      });

      await this.createGameFromLobby(
        selection.seed,
        selectedMapThemeId,
        selection.mapSize,
        selection.mapProfileId,
        launchOptions ?? undefined
      );
    } catch (error) {
      if (launchOptions?.pregeneratedMapId) {
        await pregeneratedMapCatalogService.recordMapLaunchResult({
          mapId: launchOptions.pregeneratedMapId,
          selectionId: launchOptions.mapSelectionId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      console.error('Failed to create battle royal game room:', error);
      const capacityError = isInGameCapacityAdmissionError(error) ? error : null;
      const reason = capacityError
        ? this.getCapacityBlockedMessage(capacityError)
        : 'Failed to start game';
      this.state.status = this.isMatchmakingQueue() ? 'matchmaking' : 'waiting';
      this.mapVoteSession = null;
      this.setMatchmakingLocked(false);
      if (capacityError && this.isMatchmakingQueue()) {
        this.setMatchmakingCapacityBlocked(capacityError.reason === 'full');
        this.scheduleCapacityRetry();
      }
      this.updateMetadata({ status: this.state.status });
      this.broadcast('mapGenerationCancelled', { reason, status: this.state.status, gameplayMode: this.gameplayMode });
      this.broadcastLobbyState();
      errorClient?.send('error', { message: reason });
    } finally {
      this.isFinalizingMapVote = false;
    }
  }

  private async beginMapVote(): Promise<void> {
    this.clearMapVoteTimer();
    this.clearCapacityRetry();
    this.setMatchmakingCapacityBlocked(false);
    this.state.status = 'map_vote';
    this.setMatchmakingLocked(true);
    const mapVoteSource = this.createMapSelectionSource();
    // When the admin event-biome toggle is on, force it onto one of the three vote options.
    const eventThemeId = await getEnabledEventBiomeThemeId();
    const pooledOptions = await pregeneratedMapCatalogService.createMapVoteOptionsFromPool({
      gameplayMode: this.gameplayMode,
      profileId: this.gameplayRules.mapProfileId,
      source: mapVoteSource,
      eventThemeId,
    });
    let options = pooledOptions.map(createMapVoteOptionFromCatalog);
    if (options.length < 3) {
      if (!isPublicSeedGenerationFallbackEnabled()) {
        throw new Error(`Map pool is depleted for ${this.gameplayRules.mapProfileId}`);
      }
      loggers.room.warn('Using seed-generated map vote fallback because the pregenerated map pool is low', {
        lobbyId: this.state.lobbyId,
        gameplayMode: this.gameplayMode,
        profileId: this.gameplayRules.mapProfileId,
        pooledOptionCount: options.length,
      });
      options = createMapVoteOptions({
        gameplayMode: this.gameplayMode,
        source: mapVoteSource,
        eventThemeId,
      });
    }
    this.mapVoteSession = {
      options,
      votes: new Map(),
      phaseEndTime: null,
      previewReadyPlayerIds: new Set(),
    };

    this.addMissingBotMapVotes();

    this.updateMetadata({ status: 'map_vote' });
    this.broadcastMapVoteStarted();
    this.startMapVoteCountdownIfReady();
    this.scheduleMapVotePreviewReadyFallback();
  }

  private handleMapVotePreviewsReady(client: Client): void {
    const session = this.mapVoteSession;
    if (!session || this.state.status !== 'map_vote' || session.phaseEndTime) return;

    const player = this.state.players.get(client.sessionId);
    if (!player || player.isBot) return;

    session.previewReadyPlayerIds.add(client.sessionId);
    this.startMapVoteCountdownIfReady();
  }

  private startMapVoteCountdownIfReady(): void {
    const session = this.mapVoteSession;
    if (!session || this.state.status !== 'map_vote' || session.phaseEndTime) return;

    let hasHumans = false;
    let allHumansReady = true;
    this.state.players.forEach((player, playerId) => {
      if (player.isBot) return;
      if (isLobbyObserver(player)) return;
      hasHumans = true;
      if (!session.previewReadyPlayerIds.has(playerId)) {
        allHumansReady = false;
      }
    });

    if (!hasHumans) {
      if (this.getCombatParticipantCount() > 0) {
        this.startMapVoteCountdown();
      }
      return;
    }
    if (!allHumansReady) return;

    this.startMapVoteCountdown();
  }

  private startMapVoteCountdown(): void {
    const session = this.mapVoteSession;
    if (!session || session.phaseEndTime) return;

    session.phaseEndTime = Date.now() + MAP_VOTE_DURATION_MS;
    this.broadcast('mapVoteTimerStarted', {
      phaseEndTime: session.phaseEndTime,
      gameplayMode: this.gameplayMode,
    });

    this.clearMapVoteTimer();
    this.mapVoteFinalizeTimeout = setTimeout(() => {
      this.finalizeMapVote().catch((error) => {
        console.error('Failed to finalize map vote:', error);
      });
    }, MAP_VOTE_DURATION_MS);
  }

  private scheduleMapVotePreviewReadyFallback(): void {
    this.clearMapVotePreviewReadyTimeout();
    if (!this.mapVoteSession || this.state.status !== 'map_vote' || this.mapVoteSession.phaseEndTime || this.disposed) {
      return;
    }

    this.mapVotePreviewReadyTimeout = setTimeout(() => {
      this.mapVotePreviewReadyTimeout = null;
      if (!this.mapVoteSession || this.state.status !== 'map_vote' || this.mapVoteSession.phaseEndTime) return;

      let humanPlayerCount = 0;
      this.state.players.forEach((player) => {
        if (!player.isBot && !isLobbyObserver(player)) humanPlayerCount += 1;
      });

      loggers.room.warn('Starting map vote countdown after preview readiness timeout', {
        lobbyId: this.state.lobbyId,
        gameplayMode: this.gameplayMode,
        readyPlayerCount: this.mapVoteSession.previewReadyPlayerIds.size,
        humanPlayerCount,
      });
      this.startMapVoteCountdown();
    }, MAP_VOTE_PREVIEW_READY_TIMEOUT_MS);
    this.mapVotePreviewReadyTimeout.unref?.();
  }

  private handleMapVote(client: Client, optionId: string): void {
    if (!this.mapVoteSession || this.state.status !== 'map_vote') {
      client.send('error', { message: 'Map vote is not active' });
      return;
    }

    if (!this.mapVoteSession.phaseEndTime) {
      client.send('error', { message: 'Map vote is still preparing' });
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player || player.isBot) return;

    const optionExists = this.mapVoteSession.options.some((option) => option.id === optionId);
    if (!optionExists) {
      client.send('error', { message: 'Unknown map option' });
      return;
    }

    this.mapVoteSession.votes.set(client.sessionId, optionId);
    this.broadcastMapVoteUpdated();
    this.finalizeMapVoteIfAllHumansVoted();
  }

  private finalizeMapVoteIfAllHumansVoted(): void {
    const session = this.mapVoteSession;
    if (!session || this.state.status !== 'map_vote' || !session.phaseEndTime) return;

    this.addMissingBotMapVotes();
    const players: MapVotePlayer[] = [];
    this.state.players.forEach((player, playerId) => {
      players.push({ id: playerId, isBot: player.isBot || isLobbyObserver(player) });
    });

    if (!haveAllHumanPlayersVoted({ players, votes: session.votes })) return;

    this.finalizeMapVote().catch((error) => {
      console.error('Failed to finalize completed map vote:', error);
    });
  }

  private async finalizeMapVote(errorClient?: Client): Promise<void> {
    if (!this.mapVoteSession || this.state.status !== 'map_vote' || this.isFinalizingMapVote) return;

    this.isFinalizingMapVote = true;
    let launchOptions: CreateGameMapLaunchOptions | null = null;
    try {
      this.addMissingBotMapVotes();
      const selectedOption = getWinningMapOption({
        options: this.mapVoteSession.options,
        votes: this.mapVoteSession.votes,
        hostId: this.state.hostId,
      });
      let selectedMapThemeId = selectedOption.mapThemeId ?? await this.resolveSelectedMapThemeId(selectedOption.seed);
      let mapSeed = selectedOption.seed;
      let mapSize = selectedOption.mapSize;
      let mapProfileId = selectedOption.mapProfileId;
      if (selectedOption.pregeneratedMapId) {
        let reserved: ReservedPregeneratedMapLaunch | null = null;
        try {
          reserved = await pregeneratedMapCatalogService.reserveMapForLaunch({
            mapId: selectedOption.pregeneratedMapId,
            lobbyId: this.state.lobbyId,
            selectionSource: this.isMatchmakingQueue() ? 'matchmaking' : 'vote',
          });
        } catch (error) {
          if (!isPublicSeedGenerationFallbackEnabled()) throw error;
          loggers.room.warn('Using map vote fallback because pregenerated map reservation failed', {
            lobbyId: this.state.lobbyId,
            mapId: selectedOption.pregeneratedMapId,
            optionId: selectedOption.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        if (!reserved) {
          if (!isPublicSeedGenerationFallbackEnabled()) {
            throw new Error('Selected map is no longer ready');
          }
          loggers.room.warn('Using seed-generated fallback because selected pregenerated map could not be reserved', {
            lobbyId: this.state.lobbyId,
            mapId: selectedOption.pregeneratedMapId,
            optionId: selectedOption.id,
          });
          try {
            const generated = await pregeneratedMapCatalogService.generateAndReserveMapForLaunch({
              seed: mapSeed,
              themeId: selectedMapThemeId,
              mapSize,
              profileId: mapProfileId,
              visibility: 'public',
              lobbyId: this.state.lobbyId,
              selectionSource: 'fallback',
            });
            mapSeed = generated.map.seed;
            mapSize = generated.map.mapSize;
            mapProfileId = generated.map.profileId;
            selectedMapThemeId = generated.map.themeId;
            launchOptions = {
              pregeneratedMapId: generated.map.id,
              mapArtifactId: generated.map.artifactId,
              mapSelectionId: generated.selectionId,
            };
            loggers.room.warn('Using on-demand generated map vote fallback', {
              lobbyId: this.state.lobbyId,
              optionId: selectedOption.id,
              pregeneratedMapId: generated.map.id,
              mapArtifactId: generated.map.artifactId,
              mapSeed,
              mapSize,
              mapThemeId: selectedMapThemeId,
            });
          } catch (error) {
            loggers.room.warn('Continuing with seed-generated map vote fallback because on-demand generation failed', {
              lobbyId: this.state.lobbyId,
              optionId: selectedOption.id,
              mapSeed,
              mapSize,
              mapProfileId,
              mapThemeId: selectedMapThemeId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        } else {
          mapSeed = reserved.map.seed;
          mapSize = reserved.map.mapSize;
          mapProfileId = reserved.map.profileId;
          selectedMapThemeId = reserved.map.themeId;
          launchOptions = {
            pregeneratedMapId: reserved.map.id,
            mapArtifactId: reserved.map.artifactId,
            mapSelectionId: reserved.selectionId,
          };
        }
      }
      this.clearMapVoteTimer();
      this.state.status = 'starting';
      this.updateMetadata({ status: 'starting' });

      this.broadcast('mapVoteFinalized', {
        selectedOptionId: selectedOption.id,
        mapSeed,
        mapThemeId: selectedMapThemeId,
        mapSize,
        mapProfileId,
        pregeneratedMapId: launchOptions?.pregeneratedMapId ?? null,
        mapArtifactId: launchOptions?.mapArtifactId ?? null,
        gameplayMode: this.gameplayMode,
        votes: getMapVoteRecords(this.mapVoteSession.votes),
      });

      await this.createGameFromLobby(mapSeed, selectedMapThemeId, mapSize, mapProfileId, launchOptions ?? undefined);
    } catch (error) {
      if (launchOptions?.pregeneratedMapId) {
        await pregeneratedMapCatalogService.recordMapLaunchResult({
          mapId: launchOptions.pregeneratedMapId,
          selectionId: launchOptions.mapSelectionId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      console.error('Failed to create game room:', error);
      const capacityError = isInGameCapacityAdmissionError(error) ? error : null;
      const reason = capacityError
        ? this.getCapacityBlockedMessage(capacityError)
        : 'Failed to start game';
      this.state.status = this.isMatchmakingQueue() ? 'matchmaking' : 'waiting';
      this.mapVoteSession = null;
      this.setMatchmakingLocked(false);
      if (capacityError && this.isMatchmakingQueue()) {
        this.setMatchmakingCapacityBlocked(capacityError.reason === 'full');
        this.scheduleCapacityRetry();
      }
      this.updateMetadata({ status: this.state.status });
      this.broadcast('mapVoteCancelled', { reason, status: this.state.status, gameplayMode: this.gameplayMode });
      this.broadcastLobbyState();
      errorClient?.send('error', { message: reason });
    } finally {
      this.isFinalizingMapVote = false;
    }
  }

  private async createGameFromLobby(
    mapSeed: number,
    mapThemeId: VoxelMapTheme['id'],
    mapSize: VoxelMapSizeId,
    mapProfileId: MapProfileId,
    mapLaunchOptions: CreateGameMapLaunchOptions = {}
  ): Promise<void> {
    const assignments = createLobbyGameStartAssignments({
      players: this.state.players.values(),
    });
    const {
      playerAssignments,
      gameStartingAssignments,
      botAssignments,
      reservedHumanPlayers,
    } = assignments;
    const requiredHumanPlayers = playerAssignments.filter((assignment) => (
      !assignment.isBot && assignment.role !== 'observer'
    )).length;
    const capacityPlayerCost = getGameplayModeCapacityCost(this.gameplayMode, reservedHumanPlayers);
    let wagerLocked = false;
    let wagerMarkedInGame = false;

    try {
      const rankedEligible = this.isRankedMatchCandidate(playerAssignments);
      const lockedWager = await wagerService.lockLobbyRoster(this.state.lobbyId, this.buildWagerRoster());
      wagerLocked = Boolean(lockedWager);

      const admission = await runWithInGameCapacity({
        matchMaker,
        requestedPlayers: capacityPlayerCost,
      }, () => matchMaker.createRoom('game_room', {
        lobbyId: this.state.lobbyId,
        lobbyName: this.state.name,
        matchMode: this.matchMode,
        gameplayMode: this.gameplayMode,
        matchPerspective: this.matchPerspective,
        mapSeed,
        mapThemeId,
        mapSize,
        mapProfileId,
        pregeneratedMapId: mapLaunchOptions.pregeneratedMapId ?? null,
        mapArtifactId: mapLaunchOptions.mapArtifactId ?? null,
        mapSelectionId: mapLaunchOptions.mapSelectionId ?? null,
        botAssignments,
        rankedEligible,
        requiredHumanPlayers,
        reservedHumanPlayers,
        capacityPlayerCost,
      }));

      if (!admission.admitted) {
        throw new InGameCapacityAdmissionError(admission.reason, admission.snapshot, capacityPlayerCost);
      }

      const gameRoom = admission.result;
      this.clearCapacityRetry();
      this.setMatchmakingCapacityBlocked(false);

      this.state.gameRoomId = gameRoom.roomId;
      this.state.status = 'in_game';
      this.mapVoteSession = null;
      this.updateMetadata({ status: 'in_game' });

      const ticketInputsByPlayerId = buildGameEntryTicketInputs({
        lobbyId: this.state.lobbyId,
        gameRoomId: gameRoom.roomId,
        matchPerspective: this.matchPerspective,
        playerAssignments,
        authContexts: this.playerAuthContexts,
      });
      const ticketsByPlayerId = new Map<string, {
        entryTicket: string;
        ticket: NonNullable<ReturnType<typeof verifyGameEntryTicket>>;
      }>();
      for (const [playerId, ticketInput] of ticketInputsByPlayerId) {
        const entryTicket = createGameEntryTicket(ticketInput);
        const ticket = verifyGameEntryTicket(entryTicket, {
          lobbyId: this.state.lobbyId,
          gameRoomId: gameRoom.roomId,
        });
        if (!ticket) {
          throw new Error(`Failed to verify game entry ticket for ${playerId}`);
        }
        ticketsByPlayerId.set(playerId, { entryTicket, ticket });
      }

      const launchPayloads = await Promise.all(this.clients.map(async (client) => {
        const ticketBundle = ticketsByPlayerId.get(client.sessionId);
        const authContext = this.playerAuthContexts.get(client.sessionId);
        if (!ticketBundle || !authContext) {
          throw new Error(`Cannot reserve game seat for missing lobby client ${client.sessionId}`);
        }

        const seatReservation = await matchMaker.reserveSeatFor(gameRoom, {
          playerName: ticketBundle.ticket.displayName,
          preferredTeam: ticketBundle.ticket.assignedTeam,
          entryTicket: ticketBundle.entryTicket,
        }, {
          auth: authContext,
          ticket: ticketBundle.ticket,
        });

        return {
          client,
          payload: buildGameStartingPayload({
            gameRoomId: gameRoom.roomId,
            players: gameStartingAssignments,
            entryTicket: ticketBundle.entryTicket,
            seatReservation: serializeGameSeatReservation(seatReservation),
            gameplayMode: this.gameplayMode,
            matchPerspective: this.matchPerspective,
            mapThemeId,
            mapSize,
            mapProfileId,
            pregeneratedMapId: mapLaunchOptions.pregeneratedMapId ?? null,
            mapArtifactId: mapLaunchOptions.mapArtifactId ?? null,
          }),
        };
      }));

      if (lockedWager) {
        await wagerService.markLobbyInGame(this.state.lobbyId, gameRoom.roomId);
        wagerMarkedInGame = true;
      }

      for (const { client, payload } of launchPayloads) {
        client.send('gameStarting', payload);
      }

      // Dispose this lobby after a short delay
      this.clearGameStartDisconnectTimer();
      this.gameStartDisconnectTimeout = setTimeout(() => {
        this.gameStartDisconnectTimeout = null;
        if (this.disposed) return;
        this.disconnect();
      }, 5000);
      this.gameStartDisconnectTimeout.unref?.();
    } catch (error) {
      if (wagerLocked && !wagerMarkedInGame) {
        await wagerService.unlockLobbyAfterStartFailure(this.state.lobbyId).catch((unlockError) => {
          loggers.room.warn('Failed to unlock wagered lobby after start failure', {
            lobbyId: this.state.lobbyId,
            error: unlockError instanceof Error ? unlockError.message : String(unlockError),
          });
        });
      }
      throw error;
    }
  }

  private handleKick(client: Client, playerId: string) {
    if (this.isRankedQueue) {
      client.send('error', { message: 'Ranked players cannot be kicked by a host' });
      return;
    }

    const requester = this.state.players.get(client.sessionId);
    if (!requester || !requester.isHost) {
      client.send('error', { message: 'Only the host can kick players' });
      return;
    }

    if (playerId === client.sessionId) {
      client.send('error', { message: 'Cannot kick yourself' });
      return;
    }

    const targetPlayer = this.state.players.get(playerId);
    if (targetPlayer?.isBot) {
      this.removeBot(playerId);
      return;
    }

    const targetClient = this.clients.find(c => c.sessionId === playerId);
    if (targetClient) {
      targetClient.send('kicked', { reason: 'Kicked by host' });
      targetClient.leave();
    }
  }

  private handleChat(client: Client, message: string) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const payload = buildLobbyChatPayload({
      playerId: client.sessionId,
      playerName: player.name,
      message,
      timestamp: Date.now(),
    });
    if (!payload) return;

    this.broadcast('chat', payload);
  }

  private getTeamCount(team: string): number {
    return countLobbyTeamMembers(this.state.players.values(), team);
  }

  private handleAddBot(
    client: Client,
    data: { difficulty?: BotDifficulty; team?: string; name?: string; heroId?: HeroId | '' }
  ): void {
    if (!this.isHost(client)) return;
    if (!this.gameplayRules.botsEnabled) {
      client.send('error', { message: 'Bots are disabled for this mode' });
      return;
    }

    const result = this.createBot(data);
    if (!result.ok) {
      client.send('error', { message: this.getCreateBotFailureMessage(result.reason) });
      return;
    }
    this.broadcastLobbyState();
  }

  private handleRemoveBot(client: Client, botId: string): void {
    if (!this.isHost(client)) return;
    this.removeBot(botId);
  }

  private handleUpdateBotTeam(client: Client, botId: string, team: string): void {
    if (!this.isHost(client)) return;
    if (!this.isTeam(team)) return;

    const bot = this.state.players.get(botId);
    if (!bot?.isBot) return;

    const teamCount = this.getTeamCountExcluding(team, botId);
    const maxPerTeam = this.gameplayRules.maxTeamSize;
    if (teamCount >= maxPerTeam) {
      client.send('error', { message: 'Team is full' });
      return;
    }

    const botHeroId = this.normalizeHeroId(bot.heroId);
    const shouldClearHero = botHeroId !== ''
      && !isTeamHeroAvailable(this.state.players.values(), team, botHeroId, botId);

    bot.team = team;
    this.broadcast('playerTeamChanged', { playerId: botId, team });
    if (shouldClearHero) {
      bot.heroId = '';
      bot.skinId = '';
      this.broadcast('botHeroChanged', { playerId: botId, heroId: bot.heroId, skinId: bot.skinId });
    }
    this.updateMetadata();
    this.broadcastLobbyState();
  }

  private handleUpdateBotDifficulty(client: Client, botId: string, difficulty: BotDifficulty): void {
    if (!this.isHost(client)) return;

    const bot = this.state.players.get(botId);
    if (!bot?.isBot) return;

    bot.botDifficulty = this.normalizeDifficulty(difficulty);
    this.broadcast('botDifficultyChanged', { playerId: botId, difficulty: bot.botDifficulty });
    this.updateMetadata();
    this.broadcastLobbyState();
  }

  private handleUpdateBotHero(client: Client, botId: string, heroId: HeroId | ''): void {
    if (!this.isHost(client)) return;

    const bot = this.state.players.get(botId);
    if (!bot?.isBot) return;

    const nextHeroId = this.normalizeHeroId(heroId);
    if (
      nextHeroId
      && this.isTeam(bot.team)
      && !isTeamHeroAvailable(this.state.players.values(), bot.team, nextHeroId, botId)
    ) {
      client.send('error', { message: 'Hero is already picked on that team' });
      return;
    }

    bot.heroId = nextHeroId;
    bot.skinId = this.normalizeSkinId(nextHeroId, bot.skinId);
    this.broadcast('botHeroChanged', { playerId: botId, heroId: bot.heroId, skinId: bot.skinId });
    this.updateMetadata();
    this.broadcastLobbyState();
  }

  private getCreateBotFailureMessage(reason: CreateBotFailureReason): string {
    switch (reason) {
      case 'team_full':
        return 'Team is full';
      case 'bots_disabled':
        return 'Bots are disabled for this lobby';
      case 'hero_taken':
        return 'Hero is already picked on that team';
      case 'lobby_full':
      default:
        return 'Lobby is full';
    }
  }

  private createBot(data: {
    difficulty?: BotDifficulty;
    team?: string;
    name?: string;
    heroId?: HeroId | '';
    skinId?: HeroSkinId | '';
    botProfileId?: string;
  }): CreateBotResult {
    const requestedTeam = data.team && this.isTeam(data.team)
      ? data.team
      : null;
    const failureReason = getCreateBotFailureReason({
      botsEnabled: this.gameplayRules.botsEnabled,
      combatParticipantCount: this.getCombatParticipantCount(),
      maxParticipants: this.gameplayRules.maxPlayers,
      requestedTeam,
      requestedTeamCount: requestedTeam ? this.getTeamCount(requestedTeam) : 0,
      maxPlayersPerTeam: this.gameplayRules.maxTeamSize,
    });
    if (failureReason) {
      return { ok: false, reason: failureReason };
    }

    const bot = new LobbyPlayer();
    const botIndex = this.botIdCounter++;
    const profileName = BOT_NAMES[botIndex % BOT_NAMES.length];
    bot.id = `bot_${this.roomId}_${botIndex}`;
    bot.name = data.name?.trim().slice(0, 24) || `${profileName} Bot`;
    bot.isHost = false;
    bot.isReady = true;
    bot.team = requestedTeam
      ? requestedTeam
      : this.assignBalancedTeam();
    const botHeroId = this.normalizeHeroId(data.heroId);
    if (
      botHeroId
      && this.isTeam(bot.team)
      && !isTeamHeroAvailable(this.state.players.values(), bot.team, botHeroId)
    ) {
      return { ok: false, reason: 'hero_taken' };
    }
    bot.heroId = botHeroId;
    bot.skinId = this.normalizeSkinId(botHeroId, data.skinId);
    bot.isBot = true;
    bot.botDifficulty = this.normalizeDifficulty(data.difficulty);
    bot.botProfileId = data.botProfileId ?? this.createBotProfileId(profileName, botIndex);

    this.state.players.set(bot.id, bot);
    this.broadcast('playerJoined', buildLobbyPlayerJoinedPayload(bot.id, bot));
    if (this.state.status === 'map_vote' && this.mapVoteSession) {
      this.addMissingBotMapVotes();
      this.broadcastMapVoteUpdated();
    }
    this.updateMetadata();
    return { ok: true, bot };
  }

  private removeBot(botId: string): void {
    const bot = this.state.players.get(botId);
    if (!bot?.isBot) return;

    const cleanup = this.cleanupLobbySession(botId);
    this.broadcast('playerLeft', { playerId: botId, isBot: true });
    if (cleanup.removedVote) {
      this.broadcastMapVoteUpdated();
    }
    this.updateMetadata();
    this.broadcastLobbyState();
  }

  private cleanupLobbySession(sessionId: string): CleanupLobbySessionResult {
    return cleanupLobbySessionState({
      sessionId,
      players: this.state.players,
      playerAuthContexts: this.playerAuthContexts,
      playerMatchmakingTickets: this.playerMatchmakingTickets,
      playerCompetitiveRatings: this.playerCompetitiveRatings,
      sessionIdToIdentity: this.sessionIdToIdentity,
      identityToSessionId: this.identityToSessionId,
      mapVoteSession: this.mapVoteSession,
      clearRateLimitScope: (scope) => this.rateLimiter.clearScope(scope),
    });
  }

  private async resolveSelectedMapThemeId(seed: number): Promise<VoxelMapTheme['id']> {
    if (this.matchMode === 'ranked') {
      try {
        if (await wagerService.shouldRollGoldenBiome(seed)) {
          const treasury = await wagerService.getGoldenBiomeTreasuryEligibility();
          if (treasury.eligible) return GOLDEN_VOXEL_MAP_THEME_ID;
        }
      } catch (error) {
        loggers.room.warn('Golden biome roll skipped after treasury eligibility failure', {
          lobbyId: this.roomId,
          seed,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (this.gameplayMode === 'battle_royal') {
      const eventThemeId = getBattleRoyalEventBiomeThemeId({
        seed,
        eventThemeId: await getEnabledEventBiomeThemeId(),
      });
      if (eventThemeId) return eventThemeId;
    }

    return getVoxelMapTheme(seed).id;
  }

  private sendMapVoteStarted(client: Client): void {
    if (!this.mapVoteSession) return;
    this.addMissingBotMapVotes();
    client.send('mapVoteStarted', buildMapVoteStartedPayload({
      ...this.mapVoteSession,
      gameplayMode: this.gameplayMode,
    }));
  }

  private broadcastMapVoteStarted(): void {
    if (!this.mapVoteSession) return;
    this.addMissingBotMapVotes();
    this.broadcast('mapVoteStarted', buildMapVoteStartedPayload({
      ...this.mapVoteSession,
      gameplayMode: this.gameplayMode,
    }));
  }

  private broadcastMapVoteUpdated(): void {
    if (!this.mapVoteSession) return;
    this.addMissingBotMapVotes();
    this.broadcast('mapVoteUpdated', buildMapVoteUpdatedPayload(this.mapVoteSession.votes));
  }

  private addMissingBotMapVotes(): number {
    const session = this.mapVoteSession;
    if (!session) return 0;
    return addMissingBotMapVotesForRoster({
      players: Array.from(this.state.players, ([id, player]) => ({ id, isBot: player.isBot })),
      options: session.options,
      votes: session.votes,
    });
  }

  private clearMapVoteTimer(): void {
    if (this.mapVoteFinalizeTimeout) {
      clearTimeout(this.mapVoteFinalizeTimeout);
      this.mapVoteFinalizeTimeout = null;
    }
    this.clearMapVotePreviewReadyTimeout();
  }

  private clearMapVotePreviewReadyTimeout(): void {
    if (!this.mapVotePreviewReadyTimeout) return;
    clearTimeout(this.mapVotePreviewReadyTimeout);
    this.mapVotePreviewReadyTimeout = null;
  }

  private assignBalancedTeam(): Team {
    return assignTeamByCapacity({
      players: this.state.players.values(),
      teamIds: this.getAssignableTeamIds(),
      maxTeamSize: this.gameplayRules.maxTeamSize,
    });
  }

  private resolveMatchmakingJoiningPlayerTeam(authContext: RoomAuthContext, selectedHero: HeroId | null): Team | null {
    if (!this.isMatchmakingQueue()) return null;

    const isExpectedPartyUser = this.expectedMatchmakingUserIds?.has(authContext.userId) === true;
    const preferredPartyTeam = isExpectedPartyUser
      && this.matchmakingPartyTeam
      && this.isTeam(this.matchmakingPartyTeam)
      && this.getTeamCount(this.matchmakingPartyTeam) < this.gameplayRules.maxTeamSize
      ? this.matchmakingPartyTeam
      : null;
    const team = this.resolveMatchmakingTeamForHero({
      selectedHero,
      preferredTeam: preferredPartyTeam,
      requirePreferredTeam: Boolean(preferredPartyTeam),
    });

    if (team && isExpectedPartyUser) {
      this.matchmakingPartyTeam = team;
    }

    return team;
  }

  private resolveMatchmakingTeamForHero(input: {
    selectedHero: HeroId | null;
    preferredTeam?: Team | null;
    requirePreferredTeam?: boolean;
  }): Team | null {
    const queueState = buildMatchmakingHeroQueueState({
      players: this.state.players.values(),
      teamIds: this.getAssignableTeamIds(),
    });

    return resolveMatchmakingHeroTeam({
      teamIds: this.getAssignableTeamIds(),
      maxTeamSize: this.gameplayRules.maxTeamSize,
      teamCounts: queueState.teamCounts,
      teamHeroIds: queueState.teamHeroIds,
      selectedHero: input.selectedHero,
      preferredTeam: input.preferredTeam,
      requirePreferredTeam: input.requirePreferredTeam,
    });
  }

  private canAdmitMatchmakingHero(requestedUserId: string | null, selectedHero: HeroId | null): boolean {
    if (!this.isMatchmakingQueue()) return true;

    const isExpectedPartyUser = Boolean(
      requestedUserId && this.expectedMatchmakingUserIds?.has(requestedUserId)
    );
    const preferredPartyTeam = isExpectedPartyUser
      && this.matchmakingPartyTeam
      && this.isTeam(this.matchmakingPartyTeam)
      && this.getTeamCount(this.matchmakingPartyTeam) < this.gameplayRules.maxTeamSize
      ? this.matchmakingPartyTeam
      : null;

    return Boolean(this.resolveMatchmakingTeamForHero({
      selectedHero,
      preferredTeam: preferredPartyTeam,
      requirePreferredTeam: Boolean(preferredPartyTeam),
    }));
  }

  private resolveJoinSelectedHero(options: JoinOptions, ticket: MatchmakingTicketClaims | null): HeroId | null {
    const selectedHero = ticket?.selectedHero ?? options.selectedHero;
    return this.normalizeHeroId(selectedHero) || null;
  }

  private resolveJoinSelectedSkin(
    options: JoinOptions,
    ticket: MatchmakingTicketClaims | null,
    selectedHero: HeroId | null
  ): HeroSkinId | null {
    if (!selectedHero) return null;
    const selectedSkin = ticket?.selectedSkinId ?? options.selectedSkinId;
    return this.normalizeSkinId(selectedHero, selectedSkin) || null;
  }

  private async resolveJoinSelectedSkinForUser(
    authContext: RoomAuthContext,
    options: JoinOptions,
    ticket: MatchmakingTicketClaims | null,
    selectedHero: HeroId | null
  ): Promise<HeroSkinId | null> {
    if (!selectedHero) return null;
    return resolveUserLoadoutForHero(
      authContext.userId,
      selectedHero,
      ticket?.selectedSkinId ?? options.selectedSkinId
    );
  }

  private isJoinSelectedHeroConsistent(options: JoinOptions, ticket: MatchmakingTicketClaims | null): boolean {
    const requestedHero = this.normalizeHeroId(options.selectedHero);
    return !ticket?.selectedHero || !requestedHero || ticket.selectedHero === requestedHero;
  }

  private isJoinSelectedSkinConsistent(options: JoinOptions, ticket: MatchmakingTicketClaims | null): boolean {
    const selectedHero = this.resolveJoinSelectedHero(options, ticket);
    const requestedSkin = this.normalizeSkinId(selectedHero, options.selectedSkinId);
    return !ticket?.selectedSkinId || !requestedSkin || ticket.selectedSkinId === requestedSkin;
  }

  private createPendingPartyBotsForJoinedPlayer(authContext: RoomAuthContext, team: string): void {
    if (!this.expectedMatchmakingUserIds?.has(authContext.userId)) return;
    if (!this.isTeam(team) || this.pendingPartyBots.length === 0) return;

    const partyBots = this.pendingPartyBots;
    this.pendingPartyBots = [];
    this.matchmakingPartyTeam = team;

    for (const partyBot of partyBots) {
      const result = this.createBot({
        difficulty: partyBot.difficulty,
        name: partyBot.displayName,
        heroId: partyBot.heroId,
        skinId: partyBot.skinId,
        team,
      });
      if (!result.ok && result.reason === 'hero_taken') {
        this.createBot({
          difficulty: partyBot.difficulty,
          name: partyBot.displayName,
          team,
        });
      }
    }
  }

  private isTeam(team: string): team is Team {
    return isTeamIdForGameplayMode(team, this.gameplayMode);
  }

  private isObserverSlotEnabled(): boolean {
    return this.isCustomLobbyVariant() && this.gameplayMode !== 'battle_royal';
  }

  private getLobbyParticipantCapacity(): number {
    return this.gameplayRules.maxPlayers + (this.isObserverSlotEnabled() ? CUSTOM_OBSERVER_SLOT_COUNT : 0);
  }

  private getAssignableTeamIds(): readonly Team[] {
    return getTeamIdsForGameplayMode(this.gameplayMode).slice(0, this.gameplayRules.maxTeams);
  }

  private hasUnassignedPlayers(): boolean {
    let hasUnassigned = false;
    this.state.players.forEach((player) => {
      if (isLobbyObserver(player)) return;
      if (!this.isTeam(player.team)) {
        hasUnassigned = true;
      }
    });
    return hasUnassigned;
  }

  private getTeamCountExcluding(team: string, excludedPlayerId: string): number {
    return countLobbyTeamMembersExcluding(this.state.players, team, excludedPlayerId);
  }

  private getHumanCount(): number {
    return countLobbyRoster(this.state.players).human;
  }

  private getLobbyHumanCount(): number {
    return countLobbyRoster(this.state.players).lobbyHuman;
  }

  private getBotCount(): number {
    return countLobbyRoster(this.state.players).bot;
  }

  private getObserverCount(): number {
    return countLobbyRoster(this.state.players).observer;
  }

  private getCombatParticipantCount(): number {
    return countLobbyRoster(this.state.players).combatParticipant;
  }

  private buildWagerRoster(): WagerRosterPlayer[] {
    const roster: WagerRosterPlayer[] = [];
    this.state.players.forEach((player) => {
      roster.push({
        lobbyPlayerId: player.id,
        userId: this.sessionIdToIdentity.get(player.id) ?? null,
        name: player.name,
        team: this.isTeam(player.team) ? player.team : null,
        isBot: player.isBot || isLobbyObserver(player),
      });
    });
    return roster;
  }

  private getMatchmakingRequiredPlayers(): number {
    if (this.isBotFillMatchmakingQueue()) {
      return getMatchmakingBotFillRequiredParticipants({
        gameplayMode: this.gameplayMode,
        rules: this.gameplayRules,
        expectedPartyParticipantCount: this.expectedMatchmakingPartyParticipantCount,
        largestTeamCount: this.getLargestAssignableTeamCount(),
      });
    }

    return this.gameplayRules.maxPlayers;
  }

  private getMatchmakingJoinCapacity(): number {
    return getMatchmakingJoinCapacity({
      botFillEnabled: this.isBotFillMatchmakingQueue(),
      status: this.state.status,
      requiredPlayers: this.getMatchmakingRequiredPlayers(),
      maxPlayers: this.gameplayRules.maxPlayers,
    });
  }

  private getLargestAssignableTeamCount(): number {
    const counts = countLobbyRoster(this.state.players).team;
    return this.getAssignableTeamIds().reduce((largest, teamId) => (
      Math.max(largest, counts[teamId] ?? 0)
    ), 0);
  }

  private isBotFillMatchmakingQueue(): boolean {
    return this.state.botFillMode === 'fill_even'
      && this.gameplayRules.botsEnabled
      && (
        this.matchMode === 'quick_play'
        || (this.matchMode === 'ranked' && this.gameplayMode === RANKED_GAMEPLAY_MODE)
      );
  }

  private fillMatchmakingBotsToRequiredPlayers(requiredPlayers: number): void {
    if (!this.isBotFillMatchmakingQueue()) return;

    let missingParticipants = Math.max(0, requiredPlayers - this.getCombatParticipantCount());
    let createdBotCount = 0;
    const partyTeam = this.matchmakingPartyTeam && this.isTeam(this.matchmakingPartyTeam)
      ? this.matchmakingPartyTeam
      : null;
    const priorityTeams = getMatchmakingBotFillPriorityTeams({
      gameplayMode: this.gameplayMode,
      partyTeam,
      partyTeamCount: partyTeam ? this.getTeamCount(partyTeam) : 0,
      maxTeamSize: this.gameplayRules.maxTeamSize,
      missingParticipants,
    });
    for (const team of priorityTeams) {
      const result = this.createBot({
        difficulty: this.state.defaultBotDifficulty as BotDifficulty,
        team,
      });
      if (!result.ok) break;
      missingParticipants--;
      createdBotCount++;
    }

    while (missingParticipants > 0) {
      const result = this.createBot({
        difficulty: this.state.defaultBotDifficulty as BotDifficulty,
      });
      if (!result.ok) break;
      missingParticipants--;
      createdBotCount++;
    }

    this.updateMetadata();
    if (createdBotCount > 0) {
      this.broadcastLobbyState();
    }
    this.broadcastMatchmakingStatus();
  }

  private getMinimumParticipantsToStart(): number {
    if (this.gameplayMode === 'battle_royal') {
      return this.gameplayRules.minPlayers;
    }

    if (this.isProductionCustomLobby()) {
      return PRODUCTION_CUSTOM_MIN_PARTICIPANTS;
    }

    return 1;
  }

  private isProductionCustomLobby(): boolean {
    return process.env.NODE_ENV === 'production'
      && this.isCustomLobbyVariant();
  }

  private isCustomLobbyVariant(): boolean {
    return this.matchMode === 'custom' || this.matchMode === 'custom_wager';
  }

  private isHost(client: Client): boolean {
    if (this.isRankedQueue) {
      client.send('error', { message: 'Ranked lobbies do not allow host bot controls' });
      return false;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player?.isHost) {
      client.send('error', { message: 'Only the host can manage bots' });
      return false;
    }
    return true;
  }

  private normalizeDifficulty(difficulty?: BotDifficulty | string): BotDifficulty {
    if (difficulty === 'easy' || difficulty === 'hard') {
      return difficulty;
    }
    return 'normal';
  }

  private normalizeBotFillMode(botFillMode?: string): BotFillMode {
    return botFillMode === 'fill_even' ? 'fill_even' : 'manual';
  }

  private resolveRoomBotFillMode(options: JoinOptions, ticket: MatchmakingTicketClaims | null): BotFillMode {
    if (this.matchMode === 'ranked') return RANKED_BOT_FILL_MODE;
    if (this.matchMode === 'quick_play' && ticket) return ticket.botFillMode;
    return this.normalizeBotFillMode(options.botFillMode);
  }

  private resolveBotProfilePrefix(options: JoinOptions): string {
    if (typeof options.botProfilePrefix === 'string' && options.botProfilePrefix.trim()) {
      return options.botProfilePrefix.trim().slice(0, 64);
    }
    return this.matchMode === 'ranked' ? BOT_RANKED_BATTLE_ROYAL_PROFILE_PREFIX : '';
  }

  private createBotProfileId(profileName: string, botIndex: number): string {
    return this.botProfilePrefix
      ? `${this.botProfilePrefix}-${botIndex}`
      : profileName.toLowerCase();
  }

  private normalizeHeroId(heroId?: HeroId | string): HeroId | '' {
    return heroId && HERO_DEFINITIONS[heroId as HeroId] ? (heroId as HeroId) : '';
  }

  private normalizeSkinId(heroId: HeroId | null | '', skinId?: HeroSkinId | string): HeroSkinId | '' {
    if (!heroId) return '';
    if (isHeroSkinId(skinId) && getHeroSkinDefinition(skinId).heroId === heroId) {
      return skinId;
    }
    return getDefaultHeroSkinId(heroId);
  }

  private isRankedMatchCandidate(playerAssignments: ParticipantAssignment[]): boolean {
    if (this.matchMode !== 'ranked') return false;
    const requiredPlayers = this.getMatchmakingRequiredPlayers();
    const combatAssignments = playerAssignments.filter((assignment) => assignment.role !== 'observer');
    if (this.getCombatParticipantCount() !== requiredPlayers) return false;
    if (combatAssignments.length !== requiredPlayers) return false;

    return combatAssignments.every((assignment) => (
      assignment.isBot || (
        Boolean(this.playerAuthContexts.get(assignment.playerId))
        && this.playerMatchmakingTickets.get(assignment.playerId)?.mode === 'ranked'
      )
    ));
  }

  private broadcastLobbyState(): void {
    this.broadcast('lobbyState', this.buildLobbyStatePayload());
  }

  private buildLobbyStatePayload() {
    return buildLobbyStatePayload({
      lobbyId: this.state.lobbyId,
      name: this.state.name,
      matchMode: this.matchMode,
      gameplayMode: this.gameplayMode,
      matchPerspective: this.matchPerspective,
      hostId: this.state.hostId,
      status: this.state.status,
      players: this.state.players,
      maxPlayers: this.state.maxPlayers,
      maxParticipants: this.state.maxParticipants,
      requiredPlayers: this.isMatchmakingQueue() ? this.getMatchmakingRequiredPlayers() : undefined,
      matchmakingStatus: this.getMatchmakingStatusPayload(),
      wager: this.lobbyWagerSnapshot,
      wagerPaymentStatuses: this.playerWagerPaymentStatuses,
    });
  }

  private setMatchmakingLocked(locked: boolean): void {
    const operation = locked ? this.lock() : this.unlock();
    operation.catch((error) => {
      console.error(`Failed to ${locked ? 'lock' : 'unlock'} lobby matchmaking:`, error);
    });
  }

  private tryStartMatchmakingMapVote(): void {
    if (this.matchmakingCapacityCheckInFlight) return;
    this.matchmakingCapacityCheckInFlight = true;
    this.tryStartMatchmakingMapVoteAsync()
      .catch((error) => {
        console.error('[LobbyRoom] Matchmaking auto-start check failed:', error);
      })
      .finally(() => {
        this.matchmakingCapacityCheckInFlight = false;
      });
  }

  private async tryStartMatchmakingMapVoteAsync(): Promise<void> {
    if (!this.isMatchmakingQueue() || this.state.status !== 'matchmaking') return;
    if (!this.hasMinimumMatchmakingHumans()) return;
    const requiredPlayers = this.getMatchmakingRequiredPlayers();
    if (!this.isBotFillMatchmakingQueue() && this.getCombatParticipantCount() < requiredPlayers) return;
    if (this.shouldWaitForMatchmakingBotFillGrace()) {
      this.scheduleMatchmakingAutoStart(this.getMatchmakingBotFillGraceRemainingMs());
      return;
    }

    const capacityAvailable = await this.ensureInGameCapacityAvailableForRoster();
    if (!capacityAvailable || this.state.status !== 'matchmaking') return;

    this.fillMatchmakingBotsToRequiredPlayers(requiredPlayers);
    if (this.getCombatParticipantCount() < requiredPlayers) return;

    await this.startMapSelection();
  }

  private shouldWaitForMatchmakingBotFillGrace(now = Date.now()): boolean {
    return this.isBotFillMatchmakingQueue()
      && this.state.status === 'matchmaking'
      && this.getCombatParticipantCount() < this.gameplayRules.maxPlayers
      && this.getMatchmakingBotFillGraceRemainingMs(now) > 0;
  }

  private getMatchmakingBotFillGraceRemainingMs(now = Date.now()): number {
    if (!this.isBotFillMatchmakingQueue()) return 0;
    return Math.max(0, this.getMatchmakingBotFillGraceEndsAt() - now);
  }

  private getMatchmakingBotFillGraceEndsAt(): number {
    if (
      this.isRankedQueue &&
      this.expectedMatchmakingUserIds &&
      this.expectedMatchmakingUserIds.size > 1 &&
      this.getMissingExpectedHumanCount() === 0
    ) {
      return this.state.createdAt || Date.now();
    }
    const gracePeriodMs = this.isRankedQueue
      ? RANKED_MATCHMAKING_BOT_FILL_GRACE_PERIOD_MS
      : MATCHMAKING_BOT_FILL_GRACE_PERIOD_MS;
    return (this.state.createdAt || Date.now()) + gracePeriodMs;
  }

  private scheduleMatchmakingAutoStart(delayMs = MATCHMAKING_AUTO_START_DELAY_MS): void {
    if (!this.isMatchmakingQueue() || this.disposed || this.state.status !== 'matchmaking') return;
    const delay = Math.max(0, Math.floor(delayMs));
    const scheduledAt = Date.now() + delay;
    if (this.matchmakingAutoStartTimeout) {
      if (this.matchmakingAutoStartAt <= scheduledAt) return;
      this.clearMatchmakingAutoStart();
    }

    this.matchmakingAutoStartTimeout = setTimeout(() => {
      this.matchmakingAutoStartTimeout = null;
      this.matchmakingAutoStartAt = 0;
      this.tryStartMatchmakingMapVote();
    }, delay);
    this.matchmakingAutoStartAt = scheduledAt;
    this.matchmakingAutoStartTimeout.unref?.();
  }

  private clearMatchmakingAutoStart(): void {
    if (!this.matchmakingAutoStartTimeout) return;
    clearTimeout(this.matchmakingAutoStartTimeout);
    this.matchmakingAutoStartTimeout = null;
    this.matchmakingAutoStartAt = 0;
  }

  private clearCapacityRetry(): void {
    if (!this.capacityRetryTimeout) return;
    clearTimeout(this.capacityRetryTimeout);
    this.capacityRetryTimeout = null;
  }

  private clearGameStartDisconnectTimer(): void {
    if (!this.gameStartDisconnectTimeout) return;
    clearTimeout(this.gameStartDisconnectTimeout);
    this.gameStartDisconnectTimeout = null;
  }

  private scheduleCapacityRetry(): void {
    if (!this.isMatchmakingQueue() || this.disposed || this.capacityRetryTimeout) return;
    this.capacityRetryTimeout = setTimeout(() => {
      this.capacityRetryTimeout = null;
      this.tryStartMatchmakingMapVote();
    }, IN_GAME_CAPACITY_RETRY_MS);
    this.capacityRetryTimeout.unref?.();
  }

  private setMatchmakingCapacityBlocked(blocked: boolean): void {
    if (this.matchmakingCapacityBlocked === blocked) return;
    this.matchmakingCapacityBlocked = blocked;
    if (!this.isMatchmakingQueue()) return;
    this.updateMetadata();
    this.broadcastMatchmakingStatus();
  }

  private getCapacityBlockedMessage(error: InGameCapacityAdmissionError): string {
    if (error.reason === 'busy') {
      return this.isMatchmakingQueue()
        ? 'Match capacity check is busy. Staying in queue.'
        : 'Match capacity check is busy. Try again shortly.';
    }

    const base = `Servers are full (${error.snapshot.reservedPlayers}/${error.snapshot.maxPlayers} players in game).`;
    return this.isMatchmakingQueue() ? `${base} Staying in queue.` : `${base} Try again when a match ends.`;
  }

  private async ensureInGameCapacityAvailableForRoster(client?: Client): Promise<boolean> {
    const requestedPlayers = getGameplayModeCapacityCost(this.gameplayMode, this.getHumanCount());
    if (requestedPlayers <= 0) return true;

    const snapshot = await collectInGameCapacitySnapshot(matchMaker);
    if (canAdmitInGameCapacity(snapshot, requestedPlayers)) {
      this.setMatchmakingCapacityBlocked(false);
      return true;
    }

    const error = new InGameCapacityAdmissionError('full', snapshot, requestedPlayers);
    const message = this.getCapacityBlockedMessage(error);
    if (this.isMatchmakingQueue()) {
      this.setMatchmakingCapacityBlocked(true);
      this.scheduleCapacityRetry();
    }

    client?.send('error', { message });
    return false;
  }

  private isMatchmakingQueue(): boolean {
    return this.matchMode === 'quick_play' || this.matchMode === 'ranked';
  }

  private resolveRoomMatchMode(
    options: JoinOptions,
    ticket: MatchmakingTicketClaims | null
  ): MatchMode {
    const requestedMode = isMatchMode(options.matchMode) ? options.matchMode : null;
    if (options.matchmakingMode === true) {
      if (ticket?.mode === 'ranked' || requestedMode === 'ranked') return 'ranked';
      return 'quick_play';
    }
    if (requestedMode === 'custom_wager' || options.wager?.enabled === true) return 'custom_wager';
    return 'custom';
  }

  private resolveRoomGameplayMode(options: JoinOptions, ticket: MatchmakingTicketClaims | null): GameplayMode {
    if (options.matchmakingMode === true) {
      const requestedMode = ticket?.mode ?? (isMatchMode(options.matchMode) ? options.matchMode : null);
      if (requestedMode === 'ranked') return RANKED_GAMEPLAY_MODE;
      if (isGameplayMode(ticket?.gameplayMode)) return ticket.gameplayMode;
      return isGameplayMode(options.gameplayMode) ? options.gameplayMode : DEFAULT_GAMEPLAY_MODE;
    }
    return isCustomLobbyGameplayMode(options.gameplayMode) ? options.gameplayMode : DEFAULT_GAMEPLAY_MODE;
  }

  private resolveRoomMatchPerspective(options: JoinOptions, ticket: MatchmakingTicketClaims | null): MatchPerspective {
    if (options.matchmakingMode === true) {
      const requestedMode = ticket?.mode ?? (isMatchMode(options.matchMode) ? options.matchMode : null);
      if (requestedMode === 'ranked') return DEFAULT_MATCH_PERSPECTIVE;
      if (isMatchPerspective(ticket?.matchPerspective)) return ticket.matchPerspective;
    }
    return isMatchPerspective(options.matchPerspective) ? options.matchPerspective : DEFAULT_MATCH_PERSPECTIVE;
  }

  private resolveRoomRankBand(options: JoinOptions, ticket: MatchmakingTicketClaims | null): number {
    if (options.matchmakingMode !== true) return DEFAULT_RANK_DIVISION_INDEX;

    return ticket?.targetRankDivisionIndex ?? normalizeRankDivisionIndex(options.rankBandId);
  }

  private resolveRoomMatchmakingRegion(
    options: JoinOptions,
    ticket: MatchmakingTicketClaims | null
  ): string | undefined {
    if (options.matchmakingMode !== true) return undefined;
    return normalizeMatchmakingRegion(ticket?.matchmakingRegion)
      ?? normalizeMatchmakingRegion(options.matchmakingRegion)
      ?? getLocalMatchmakingRegion();
  }

  private resolveMinimumMatchmakingHumanCount(options: JoinOptions): number {
    if (!this.isMatchmakingQueue()) return 1;
    const expectedHumanPlayers = typeof options.expectedHumanPlayers === 'number'
      ? Math.floor(options.expectedHumanPlayers)
      : 1;
    return Math.max(1, Math.min(this.state.maxParticipants, expectedHumanPlayers));
  }

  private resolveExpectedMatchmakingPartyParticipantCount(options: JoinOptions): number {
    if (!this.isMatchmakingQueue()) return 1;
    const expectedHumanPlayers = typeof options.expectedHumanPlayers === 'number'
      ? Math.floor(options.expectedHumanPlayers)
      : 1;
    const expectedBotPlayers = Array.isArray(options.partyBots) ? options.partyBots.length : 0;
    return Math.max(
      1,
      Math.min(this.gameplayRules.maxTeamSize, expectedHumanPlayers + expectedBotPlayers)
    );
  }

  private resolveExpectedMatchmakingUserIds(options: JoinOptions): Set<string> | null {
    if (!this.isMatchmakingQueue() || !Array.isArray(options.expectedHumanUserIds)) return null;
    const userIds = options.expectedHumanUserIds
      .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0);
    return userIds.length > 0 ? new Set(userIds) : null;
  }

  private resolveExpectedMatchmakingPartyLeaderUserId(options: JoinOptions): string | null {
    if (!this.isMatchmakingQueue() || typeof options.expectedPartyLeaderUserId !== 'string') return null;
    const leaderUserId = options.expectedPartyLeaderUserId.trim();
    if (!leaderUserId) return null;
    return this.expectedMatchmakingUserIds?.has(leaderUserId) ? leaderUserId : null;
  }

  private getRequestedMatchmakingUserId(options: JoinOptions): string | null {
    if (!options.matchmakingTicket) return null;
    try {
      return verifyMatchmakingTicket(options.matchmakingTicket)?.userId ?? null;
    } catch {
      return null;
    }
  }

  private getJoinedExpectedHumanUserIds(): Set<string> {
    const joined = new Set<string>();
    if (!this.expectedMatchmakingUserIds) return joined;

    this.playerAuthContexts.forEach((authContext) => {
      if (this.expectedMatchmakingUserIds?.has(authContext.userId)) {
        joined.add(authContext.userId);
      }
    });
    return joined;
  }

  private getMissingExpectedHumanCount(): number {
    if (!this.expectedMatchmakingUserIds) return 0;
    const joined = this.getJoinedExpectedHumanUserIds();
    let missing = 0;
    this.expectedMatchmakingUserIds.forEach((userId) => {
      if (!joined.has(userId)) missing++;
    });
    return missing;
  }

  private hasMinimumMatchmakingHumans(): boolean {
    if (this.expectedMatchmakingUserIds) {
      return this.getMissingExpectedHumanCount() === 0;
    }

    return this.getHumanCount() >= this.minimumMatchmakingHumanCount;
  }

  private shouldReserveExpectedHumanSlot(requestedUserId: string | null): boolean {
    if (!this.expectedMatchmakingUserIds) return false;
    if (requestedUserId && this.expectedMatchmakingUserIds.has(requestedUserId)) return false;
    const missingExpectedHumans = this.getMissingExpectedHumanCount();
    if (missingExpectedHumans <= 0) return false;
    const openParticipantSlots = this.state.maxParticipants - this.getCombatParticipantCount();
    return openParticipantSlots <= missingExpectedHumans;
  }

  private shouldCancelExpectedPartyQueueForLeavingUser(leavingUserId: string | null): boolean {
    return shouldCancelExpectedPartyMatchmakingQueue({
      status: this.state.status,
      leavingUserId,
      expectedPartyLeaderUserId: this.expectedMatchmakingPartyLeaderUserId,
      expectedHumanUserCount: this.expectedMatchmakingUserIds?.size ?? 0,
    });
  }

  private cancelExpectedPartyQueueForLeader(leaderUserId: string | null): void {
    if (!leaderUserId || !this.expectedMatchmakingUserIds) return;

    for (const candidate of [...this.clients]) {
      const authContext = this.playerAuthContexts.get(candidate.sessionId);
      const userId = authContext?.userId ?? null;
      if (!userId || userId === leaderUserId || !this.expectedMatchmakingUserIds.has(userId)) continue;

      candidate.send('partyQueueCancelled', {
        reason: 'Party leader left matchmaking',
        leaderUserId,
      });
      candidate.leave(4002);
    }
  }

  private isValidMatchmakingTicket(
    ticket: MatchmakingTicketClaims | null,
    authContext: RoomAuthContext,
    options: JoinOptions
  ): ticket is MatchmakingTicketClaims {
    if (!ticket) return false;
    if (ticket.mode !== this.matchMode) return false;
    if (ticket.targetRankDivisionIndex !== this.rankBandId) return false;
    if (ticket.gameplayMode !== this.gameplayMode) return false;
    if (ticket.botFillMode !== this.state.botFillMode) return false;
    if (ticket.matchPerspective !== this.matchPerspective) return false;
    if (!this.isJoinSelectedHeroConsistent(options, ticket)) return false;
    if (!this.isJoinSelectedSkinConsistent(options, ticket)) return false;

    return ticket.userId === authContext.userId;
  }

  private resolvePlayerCompetitiveRating(authContext: RoomAuthContext): number {
    return authContext.competitiveRating;
  }

  private getAverageCompetitiveRating(): number {
    if (this.playerCompetitiveRatings.size === 0) return DEFAULT_MATCHMAKING_RATING;

    let total = 0;
    this.playerCompetitiveRatings.forEach((rating) => {
      total += rating;
    });

    return Math.round(total / this.playerCompetitiveRatings.size);
  }

  private getMatchmakingWaitMs(): number {
    return Math.max(0, Date.now() - (this.state.createdAt || Date.now()));
  }

  private getMatchmakingStatusPayload(): Record<string, unknown> {
    if (!this.isMatchmakingQueue()) return {};
    const averageCompetitiveRating = this.getAverageCompetitiveRating();
    const rosterCounts = countLobbyRoster(this.state.players);
    const humanCount = rosterCounts.human;
    const combatParticipantCount = rosterCounts.combatParticipant;
    const queuedHumanCount = humanCount;

    return {
      matchMode: this.matchMode,
      gameplayMode: this.gameplayMode,
      matchPerspective: this.matchPerspective,
      botFillMode: this.state.botFillMode,
      rankBandId: this.rankBandId,
      rankBandLabel: getRankDivisionLabel(this.rankBandId),
      averageCompetitiveRating,
      averageVisibleRank: getRankFromRating(averageCompetitiveRating, 0).label,
      rankSearchDistance: getAllowedRankDivisionDistance(this.getMatchmakingWaitMs()),
      matchmakingCreatedAt: this.state.createdAt,
      requiredPlayers: this.getMatchmakingRequiredPlayers(),
      matchmakingJoinCapacity: this.getMatchmakingJoinCapacity(),
      botFillGraceEndsAt: this.isBotFillMatchmakingQueue()
        ? this.getMatchmakingBotFillGraceEndsAt()
        : undefined,
      queuedHumanCount,
      provisionalHumanCount: Math.max(0, humanCount - queuedHumanCount),
      capacityBlocked: this.matchmakingCapacityBlocked,
      capacityMaxPlayers: MAX_IN_GAME_PLAYERS,
      rankedEligible: this.isRankedQueue
        && combatParticipantCount === this.getMatchmakingRequiredPlayers(),
    };
  }

  private broadcastMatchmakingStatus(): void {
    if (!this.isMatchmakingQueue()) return;
    this.broadcast('matchmakingStatus', this.getMatchmakingStatusPayload());
  }

  private updateMetadata(overrides: Record<string, unknown> = {}): void {
    const rosterCounts = countLobbyRoster(this.state.players);
    const humanCount = rosterCounts.human;
    const botCount = rosterCounts.bot;
    const matchmakingHeroQueueState = this.isMatchmakingQueue()
      ? buildMatchmakingHeroQueueState({
          players: this.state.players.values(),
          teamIds: this.getAssignableTeamIds(),
        })
      : null;
    this.setMetadata({
      name: this.state.name,
      isPublic: this.state.isPublic,
      status: this.state.status,
      humanCount,
      botCount,
      participantCount: humanCount + botCount,
      maxParticipants: this.state.maxParticipants,
      maxPlayers: this.state.maxPlayers,
      matchMode: this.matchMode,
      gameplayMode: this.gameplayMode,
      matchPerspective: this.matchPerspective,
      botFillMode: this.state.botFillMode,
      matchmakingMode: this.isMatchmakingQueue(),
      matchmakingRegion: this.isMatchmakingQueue() ? this.matchmakingRegion : undefined,
      rankBandId: this.isMatchmakingQueue() ? this.rankBandId : undefined,
      requiredPlayers: this.isMatchmakingQueue() ? this.getMatchmakingRequiredPlayers() : undefined,
      matchmakingJoinCapacity: this.isMatchmakingQueue() ? this.getMatchmakingJoinCapacity() : undefined,
      queuedHumanCount: humanCount,
      matchmakingTeamCounts: matchmakingHeroQueueState?.teamCounts,
      matchmakingTeamHeroIds: matchmakingHeroQueueState?.teamHeroIds,
      capacityBlocked: this.isMatchmakingQueue() ? this.matchmakingCapacityBlocked : undefined,
      capacityMaxPlayers: this.isMatchmakingQueue() ? MAX_IN_GAME_PLAYERS : undefined,
      wagerEnabled: this.lobbyWagerSnapshot.enabled,
      wagerCoverChargeLamports: this.lobbyWagerSnapshot.coverChargeLamports,
      wagerPaidPlayerCount: this.lobbyWagerSnapshot.paidPlayerCount,
      wagerPotLamports: this.lobbyWagerSnapshot.potLamports,
      ...this.getMatchmakingStatusPayload(),
      ...overrides,
    });
  }
}
