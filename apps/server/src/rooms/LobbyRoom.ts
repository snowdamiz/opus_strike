import type { IncomingMessage } from 'http';
import { Room, Client, matchMaker } from 'colyseus';
import { LobbyState, LobbyPlayer } from './schema/LobbyState';
import { DEFAULT_GAME_CONFIG, GOLDEN_VOXEL_MAP_THEME_ID, HERO_DEFINITIONS, createRandomSeed, createProceduralMapPreview, getRankDivisionIndex, getRankFromRating, getVoxelMapTheme, hashSeed, isMatchMode, toPublicRankSnapshot, VOXEL_MAP_THEMES } from '@voxel-strike/shared';
import type { MatchMode } from '@voxel-strike/shared';
import type { BlueprintPreview, BotDifficulty, HeroId, MapTopologyId, Team, VoxelMapTheme } from '@voxel-strike/shared';
import { assertUsableEntryTicketSecret, isDevelopmentToolsEnabled } from '../config/security';
import { resolveRoomAuthContext, type RoomAuthContext } from '../auth/session';
import { assertGameplayAccountEligible } from '../auth/accountEligibility';
import { createGameEntryTicket } from '../security/entryTickets';
import { verifyMatchmakingTicket, type MatchmakingTicketClaims } from '../security/matchmakingTickets';
import { consumeReplayNonce } from '../security/replayNonceStore';
import {
  DEFAULT_MATCHMAKING_RATING,
  DEFAULT_RANK_DIVISION_INDEX,
  getAllowedRankDivisionDistance,
  getRankDivisionLabel,
  normalizeRankDivisionIndex,
} from '../matchmaking/skill';
import {
  IN_GAME_CAPACITY_RETRY_MS,
  MAX_IN_GAME_PLAYERS,
  collectInGameCapacitySnapshot,
  isInGameCapacityAdmissionError,
  runWithInGameCapacity,
  InGameCapacityAdmissionError,
} from '../matchmaking/playerCapacity';
import { serializeRankPayload } from '../ranking/serialization';
import { LOBBY_MESSAGE_RATE_LIMITS, MessageRateLimiter, type RateLimitRule } from './rateLimiter';
import { wagerService, type CreateWagerOptions, type LobbyWagerSnapshot, type LockedWagerContext, type WagerPaymentStatusChanged } from '../wagers/service';
import { wagerEventBus } from '../wagers/eventBus';
import type { WagerRosterPlayer } from '../wagers/math';
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
  validateObserverPayload,
  validateReadyPayload,
  validateTeamPayload,
} from './protocolValidation';

interface JoinOptions {
  playerName?: string;
  lobbyName?: string;
  isPrivate?: boolean;
  matchmakingMode?: boolean;
  matchMode?: MatchMode;
  matchmakingTicket?: string;
  rankBandId?: number;
  rankedEntryQuoteId?: string;
  clientId?: string; // Persistent client ID for reconnection detection
  authToken?: string;
  initialBotCount?: number;
  botFillMode?: 'manual' | 'fill_even' | 'fill_empty';
  defaultBotDifficulty?: BotDifficulty;
  wager?: CreateWagerOptions;
  mapSeed?: number;
  forceGoldenMapOption?: boolean;
  observersEnabled?: boolean;
}

interface ParticipantAssignment {
  playerId: string;
  playerName: string;
  team: Team;
  isBot: boolean;
  heroId?: HeroId;
  botDifficulty?: BotDifficulty;
  botProfileId?: string;
}

interface ObserverAssignment {
  playerId: string;
  playerName: string;
  isBot: false;
  isObserver: true;
}

type GameStartingAssignment = ParticipantAssignment | ObserverAssignment;
export type CreateBotFailureReason = 'bots_disabled' | 'lobby_full' | 'team_full';
type CreateBotResult =
  | { ok: true; bot: LobbyPlayer }
  | { ok: false; reason: CreateBotFailureReason };

interface MapVoteOption {
  id: string;
  seed: number;
  name: string;
  themeId: string;
  themeName: string;
  mapThemeId?: VoxelMapTheme['id'] | null;
  topologyId: MapTopologyId;
  preview: BlueprintPreview;
  score: number;
}

interface MapVoteRecord {
  playerId: string;
  optionId: string;
}

interface MapVoteSession {
  options: MapVoteOption[];
  votes: Map<string, string>;
  phaseEndTime: number | null;
  previewReadyPlayerIds: Set<string>;
}

const MAX_PARTICIPANTS = DEFAULT_GAME_CONFIG.maxPlayers;
const MAX_PLAYERS_PER_TEAM = DEFAULT_GAME_CONFIG.teamSize;
const MAX_OBSERVERS = 1;
const QUICK_PLAY_REQUIRED_PLAYERS = DEFAULT_GAME_CONFIG.maxPlayers;
const PRODUCTION_CUSTOM_MIN_PARTICIPANTS = 2;
const MAP_VOTE_OPTION_COUNT = 3;
const MAP_VOTE_DURATION_MS = 30000;
const WAGER_SAFETY_REFRESH_MS = 10_000;
const MAP_NAME_SUFFIXES = [
  'Crucible',
  'Relay',
  'Bastion',
  'Run',
  'Vault',
  'Array',
  'Ridge',
  'Gate',
];
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
  wageredLobby: boolean;
  combatParticipantCount: number;
  maxParticipants: number;
  requestedTeam: Team | null;
  requestedTeamCount: number;
  maxPlayersPerTeam?: number;
}): CreateBotFailureReason | null {
  if (input.wageredLobby) {
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

function getShuffledThemeIndices(source: number): number[] {
  const themeIndices = VOXEL_MAP_THEMES.map((_, index) => index);

  for (let index = themeIndices.length - 1; index > 0; index--) {
    const swapIndex = createRandomSeed(source + index * 0x9e3779b1) % (index + 1);
    [themeIndices[index], themeIndices[swapIndex]] = [themeIndices[swapIndex], themeIndices[index]];
  }

  return themeIndices;
}

function createSeedForTheme(themeIndex: number, source: number): number {
  const seed = createRandomSeed(source ^ Math.imul(themeIndex + 1, 0x9e3779b1));
  const stride = hashSeed(seed ^ source ^ 0xa5a5a5a5) | 1;
  const targetTheme = VOXEL_MAP_THEMES[themeIndex];
  if (!targetTheme) return seed;

  for (let attempt = 0; attempt < 512; attempt++) {
    const candidate = (seed + Math.imul(attempt, stride)) >>> 0;
    if (getVoxelMapTheme(candidate).id === targetTheme.id) {
      return candidate;
    }
  }

  return themeIndex >>> 0;
}

function hashText(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class LobbyRoom extends Room<LobbyState> {
  maxClients = DEFAULT_GAME_CONFIG.maxPlayers;
  private botIdCounter = 0;
  private mapVoteSession: MapVoteSession | null = null;
  private mapVoteFinalizeTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly rateLimiter = new MessageRateLimiter();
  private readonly playerAuthContexts = new Map<string, RoomAuthContext>();
  private readonly playerCompetitiveRatings = new Map<string, number>();
  private readonly playerMatchmakingTickets = new Map<string, MatchmakingTicketClaims>();
  private readonly onWagerPaymentStatusChanged = (payload: WagerPaymentStatusChanged) => {
    if (payload.lobbyId !== this.state.lobbyId) return;
    this.applyPaymentStatusUpdate(payload).catch((error) => {
      console.error('[LobbyRoom] Failed to apply payment status update:', error);
    });
  };
  private unsubscribeWagerPaymentStatusChanged: (() => Promise<void>) | null = null;
  private wagerSafetyRefreshInterval: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private matchMode: MatchMode = 'custom';
  private isQuickPlayQueue = false;
  private isRankedQueue = false;
  private rankBandId = DEFAULT_RANK_DIVISION_INDEX;
  private rankedEntryQuoteId: string | null = null;
  private pendingWagerOptions: CreateWagerOptions | undefined;
  private customMapSeed: number | null = null;
  private forceGoldenMapOption = false;
  private capacityRetryTimeout: ReturnType<typeof setTimeout> | null = null;
  private gameStartDisconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private matchmakingCapacityBlocked = false;
  private matchmakingCapacityCheckInFlight = false;
  
  // Track clientId -> sessionId mapping for reconnection detection
  private clientIdToSessionId: Map<string, string> = new Map();
  private sessionIdToClientId: Map<string, string> = new Map();

  async onAuth(client: Client, options: JoinOptions, request?: IncomingMessage): Promise<RoomAuthContext> {
    const authContext = await resolveRoomAuthContext(client.sessionId, options as Record<string, unknown>, request);
    await assertGameplayAccountEligible(authContext.userId);
    return authContext;
  }

  onCreate(options: JoinOptions) {
    this.autoDispose = true;
    assertUsableEntryTicketSecret();
    const initialMatchmakingTicket = options.matchmakingMode === true
      ? verifyMatchmakingTicket(options.matchmakingTicket)
      : null;
    this.matchMode = this.resolveRoomMatchMode(options, initialMatchmakingTicket);
    this.isQuickPlayQueue = this.matchMode === 'quick_play';
    this.isRankedQueue = this.matchMode === 'ranked';
    this.rankBandId = this.resolveRoomRankBand(options, initialMatchmakingTicket);
    this.rankedEntryQuoteId = this.isRankedQueue ? initialMatchmakingTicket?.rankedEntryQuoteId ?? null : null;
    this.pendingWagerOptions = this.isMatchmakingQueue() ? undefined : options.wager;
    this.customMapSeed = this.resolveCustomMapSeed(options);
    this.forceGoldenMapOption = this.resolveForceGoldenMapOption(options);

    this.setState(new LobbyState());
    this.state.lobbyId = this.roomId;
    this.state.matchMode = this.matchMode;
    this.state.name = options.lobbyName || (this.isQuickPlayQueue ? 'Quick Play' : this.isRankedQueue ? 'Ranked' : `Lobby ${this.roomId.slice(0, 6)}`);
    this.state.maxPlayers = this.maxClients;
    this.state.maxParticipants = MAX_PARTICIPANTS;
    this.state.observersEnabled = this.resolveObserversEnabled(options);
    this.state.maxObservers = this.state.observersEnabled ? MAX_OBSERVERS : 0;
    this.maxClients = MAX_PARTICIPANTS + this.state.maxObservers;
    this.state.maxPlayers = this.maxClients;
    this.state.isPublic = !options.isPrivate && !this.isMatchmakingQueue();
    this.state.createdAt = Date.now();
    this.state.status = this.isMatchmakingQueue() ? 'matchmaking' : 'waiting';
    this.state.defaultBotDifficulty = this.normalizeDifficulty(options.defaultBotDifficulty);
    this.state.botFillMode = options.botFillMode || 'manual';
    this.subscribeToWagerEvents();
    this.startWagerSafetyRefresh();

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
      const observer = validateObserverPayload(data);
      if (observer === null) return;
      this.handleSetObserver(client, observer);
    });

    this.onMessage('devSetObserver', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'devSetObserver', LOBBY_MESSAGE_RATE_LIMITS.devCommand)) return;
      const observer = validateObserverPayload(data);
      if (observer === null) return;
      this.handleDevSetObserver(client, observer);
    });

    this.onMessage('startGame', (client) => {
      if (!this.consumeLobbyMessage(client, 'startGame', LOBBY_MESSAGE_RATE_LIMITS.hostAction)) return;
      this.handleStartGame(client);
    });

    this.onMessage('createPaymentIntent', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'createPaymentIntent', LOBBY_MESSAGE_RATE_LIMITS.payment)) return;
      if (!isRecord(data)) return;
      const walletAddress = sanitizeShortText(data.walletAddress, 64);
      this.handleCreatePaymentIntent(client, walletAddress || '').catch((error) => {
        client.send('paymentIntentError', { message: error instanceof Error ? error.message : 'Failed to create payment intent' });
      });
    });

    this.onMessage('submitPaymentSignature', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'submitPaymentSignature', LOBBY_MESSAGE_RATE_LIMITS.payment)) return;
      if (!isRecord(data)) return;
      const intentId = sanitizeShortText(data.intentId, 96);
      const signature = sanitizeShortText(data.signature, 128);
      if (!intentId || !signature) return;
      this.handleSubmitPaymentSignature(client, intentId, signature).catch((error) => {
        client.send('paymentIntentError', { message: error instanceof Error ? error.message : 'Failed to verify payment' });
      });
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

    this.onMessage('finalizeMapVote', (client) => {
      if (!this.consumeLobbyMessage(client, 'finalizeMapVote', LOBBY_MESSAGE_RATE_LIMITS.hostAction)) return;
      this.handleFinalizeMapVote(client);
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

    const initialBotCount = this.isWageredLobby()
      ? 0
      : Math.max(0, Math.min(MAX_PARTICIPANTS - 1, Math.floor(options.initialBotCount || 0)));
    for (let i = 0; i < initialBotCount; i++) {
      const result = this.createBot({ difficulty: this.state.defaultBotDifficulty as BotDifficulty });
      if (!result.ok) break;
    }
    this.updateMetadata();
  }

  async onJoin(client: Client, options: JoinOptions) {
    const authContext = (client as Client & { auth?: RoomAuthContext }).auth ?? {
      kind: 'guest' as const,
      userId: `guest:${client.sessionId}`,
      displayName: sanitizeDisplayName(options.playerName),
      competitiveRating: DEFAULT_MATCHMAKING_RATING,
      rankedGames: 0,
      rankedPlacementsRemaining: 0,
      rankDivisionIndex: DEFAULT_RANK_DIVISION_INDEX,
      rank: getRankFromRating(DEFAULT_MATCHMAKING_RATING, 0),
      rankPayload: serializeRankPayload(null),
    };

    const matchmakingTicket = this.isMatchmakingQueue()
      ? verifyMatchmakingTicket(options.matchmakingTicket)
      : null;
    if (this.isMatchmakingQueue() && !this.isValidMatchmakingTicket(matchmakingTicket, authContext, options.clientId)) {
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

    // Handle reconnection: identity comes from auth or explicit guest mode, not localStorage clientId.
    const identityKey = authContext.userId;
    if (identityKey) {
      const existingSessionId = this.clientIdToSessionId.get(identityKey);
      
      if (existingSessionId && existingSessionId !== client.sessionId) {
        // Find and disconnect the old client
        const oldClient = this.clients.find(c => c.sessionId === existingSessionId);
        if (oldClient) {
          oldClient.send('duplicateSession', { reason: 'Connected from another tab/window' });
          oldClient.leave(4000); // Custom code for duplicate session
        }
        
        // Clean up old session data
        const oldPlayer = this.state.players.get(existingSessionId);
        const oldAuthContext = this.playerAuthContexts.get(existingSessionId);
        if (
          this.state.wagerEnabled
          && oldAuthContext?.kind === 'authenticated'
          && this.state.status !== 'in_game'
          && !this.state.gameRoomId
        ) {
          wagerService.refundPlayerBeforeGame(this.state.lobbyId, oldAuthContext.userId, 'duplicate_session').catch((error) => {
            console.error('[LobbyRoom] Failed to refund duplicate session wager:', error);
          });
        }
        const wasHost = oldPlayer?.isHost;
        this.state.players.delete(existingSessionId);
        const removedOldVote = this.mapVoteSession?.votes.delete(existingSessionId) ?? false;
        this.mapVoteSession?.previewReadyPlayerIds.delete(existingSessionId);
        this.sessionIdToClientId.delete(existingSessionId);
        this.playerAuthContexts.delete(existingSessionId);
        this.playerMatchmakingTickets.delete(existingSessionId);
        this.playerCompetitiveRatings.delete(existingSessionId);
        this.rateLimiter.clearScope(existingSessionId);
        
        // Broadcast that old player left
        this.broadcast('playerLeft', { playerId: existingSessionId });
        if (removedOldVote) {
          this.broadcastMapVoteUpdated();
        }
        
        // If old player was host, we'll assign new host below when creating this player
      }
      
      // Register this identity mapping. The clientId remains reconnect convenience only.
      this.clientIdToSessionId.set(identityKey, client.sessionId);
      this.sessionIdToClientId.set(client.sessionId, identityKey);
    }

    if (this.state.players.size >= this.state.maxParticipants + this.state.maxObservers) {
      client.send('error', { message: 'Lobby is full' });
      this.playerAuthContexts.delete(client.sessionId);
      this.playerMatchmakingTickets.delete(client.sessionId);
      this.playerCompetitiveRatings.delete(client.sessionId);
      if (this.clientIdToSessionId.get(identityKey) === client.sessionId) {
        this.clientIdToSessionId.delete(identityKey);
      }
      this.sessionIdToClientId.delete(client.sessionId);
      client.leave();
      return;
    }

    const player = new LobbyPlayer();
    player.id = client.sessionId;
    player.name = authContext.displayName || `Player${this.state.players.size + 1}`;
    player.isHost = this.getLobbyHumanCount() === 0; // First human player is host
    player.isReady = this.isMatchmakingQueue();
    player.team = this.isMatchmakingQueue() ? this.assignBalancedTeam() : '';
    player.isObserver = false;
    player.heroId = '';
    player.isBot = false;
    player.botDifficulty = '';
    player.botProfileId = '';
    this.applyLobbyPlayerRank(player, toPublicRankSnapshot(authContext.rank));

    if (player.isHost) {
      this.state.hostId = client.sessionId;
    }

    this.state.players.set(client.sessionId, player);
    if (player.isHost) {
      try {
        await this.ensureWagerCreatedForHost(authContext);
      } catch (error) {
        this.state.players.delete(client.sessionId);
        this.playerAuthContexts.delete(client.sessionId);
        this.playerMatchmakingTickets.delete(client.sessionId);
        this.playerCompetitiveRatings.delete(client.sessionId);
        this.rateLimiter.clearScope(client.sessionId);
        const identity = this.sessionIdToClientId.get(client.sessionId);
        if (identity && this.clientIdToSessionId.get(identity) === client.sessionId) {
          this.clientIdToSessionId.delete(identity);
        }
        this.sessionIdToClientId.delete(client.sessionId);
        client.send('error', { message: error instanceof Error ? error.message : 'Failed to create wagered lobby' });
        client.leave();
        return;
      }
    }
    await this.refreshWagerState();
    this.playerCompetitiveRatings.set(
      client.sessionId,
      this.resolvePlayerCompetitiveRating(authContext, matchmakingTicket)
    );

    // Notify all players
    this.broadcast('playerJoined', {
      playerId: client.sessionId,
      playerName: player.name,
      isHost: player.isHost,
      isReady: player.isReady,
      team: player.team,
      isObserver: player.isObserver,
      heroId: player.heroId,
      isBot: player.isBot,
      botDifficulty: player.botDifficulty,
      botProfileId: player.botProfileId,
      rank: this.getLobbyRankPayload(player),
      paymentStatus: player.paymentStatus,
      paymentWalletAddress: player.paymentWalletAddress,
      depositSignature: player.depositSignature,
      refundSignature: player.refundSignature,
    });

    // Send current lobby state to the new player
    client.send('lobbyState', {
      lobbyId: this.state.lobbyId,
      name: this.state.name,
      matchMode: this.matchMode,
      hostId: this.state.hostId,
      status: this.state.status,
      players: this.getPlayersArray(),
      maxPlayers: this.state.maxPlayers,
      maxParticipants: this.state.maxParticipants,
      observersEnabled: this.state.observersEnabled,
      maxObservers: this.state.maxObservers,
      observerCount: this.getObserverCount(),
      humanCount: this.getHumanCount(),
      botCount: this.getBotCount(),
      wager: this.getWagerPayload(),
      requiredPlayers: this.isMatchmakingQueue() ? QUICK_PLAY_REQUIRED_PLAYERS : undefined,
      ...this.getMatchmakingStatusPayload(),
    });

    if (this.state.status === 'map_vote' && this.mapVoteSession) {
      this.sendMapVoteStarted(client);
    }
    this.updateMetadata();
    this.broadcastMatchmakingStatus();
    this.tryStartMatchmakingMapVote();
  }

  private async canJoinInviteOnlyLobby(authContext: RoomAuthContext): Promise<boolean> {
    if (this.isMatchmakingQueue() || this.state.isPublic || this.getLobbyHumanCount() === 0) {
      return true;
    }

    const existingSessionId = this.clientIdToSessionId.get(authContext.userId);
    if (existingSessionId && this.state.players.has(existingSessionId)) {
      return true;
    }

    if (authContext.kind !== 'authenticated') {
      return false;
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

    this.state.players.delete(client.sessionId);
    const removedVote = this.mapVoteSession?.votes.delete(client.sessionId) ?? false;
    this.mapVoteSession?.previewReadyPlayerIds.delete(client.sessionId);
    this.playerAuthContexts.delete(client.sessionId);
    this.playerMatchmakingTickets.delete(client.sessionId);
    this.playerCompetitiveRatings.delete(client.sessionId);
    this.rateLimiter.clearScope(client.sessionId);
    
    // Clean up clientId mappings
    const clientId = this.sessionIdToClientId.get(client.sessionId);
    if (clientId) {
      // Only remove from clientIdToSessionId if it still points to this session
      if (this.clientIdToSessionId.get(clientId) === client.sessionId) {
        this.clientIdToSessionId.delete(clientId);
      }
      this.sessionIdToClientId.delete(client.sessionId);
    }

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
    if (
      this.state.wagerEnabled
      && authContext?.kind === 'authenticated'
      && this.state.status !== 'in_game'
      && !this.state.gameRoomId
    ) {
      wagerService.refundPlayerBeforeGame(this.state.lobbyId, authContext.userId, 'pre_game_leave').catch((error) => {
        console.error('[LobbyRoom] Failed to refund leaving player wager:', error);
      });
    }
    if (removedVote) {
      this.broadcastMapVoteUpdated();
    }
    this.startMapVoteCountdownIfReady();
    this.updateMetadata();
    this.broadcastMatchmakingStatus();
  }

  async onDispose() {
    this.disposed = true;
    this.clearMapVoteTimer();
    this.clearCapacityRetry();
    this.clearGameStartDisconnectTimer();
    this.stopWagerSafetyRefresh();
    if (this.unsubscribeWagerPaymentStatusChanged) {
      const unsubscribe = this.unsubscribeWagerPaymentStatusChanged;
      this.unsubscribeWagerPaymentStatusChanged = null;
      await unsubscribe().catch((error) => {
        console.error('[LobbyRoom] Failed to unsubscribe from wager events:', error);
      });
    }
    if (this.state.wagerEnabled && this.state.status !== 'in_game' && !this.state.gameRoomId) {
      wagerService.refundLobbyBeforeGame(this.state.lobbyId, 'lobby_dispose').catch((error) => {
        console.error('[LobbyRoom] Failed to refund disposed lobby wager:', error);
      });
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

    if (player.isObserver) {
      player.isReady = true;
      this.broadcast('playerReady', {
        playerId: client.sessionId,
        ready: true,
      });
      this.updateMetadata();
      return;
    }

    if (ready && !this.isTeam(player.team)) {
      client.send('error', { message: 'Choose a team before readying up' });
      return;
    }

    player.isReady = ready;

    this.broadcast('playerReady', {
      playerId: client.sessionId,
      ready,
    });
    this.updateMetadata();
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
    const maxPerTeam = MAX_PLAYERS_PER_TEAM;
    if (teamCount >= maxPerTeam) {
      client.send('error', { message: 'Team is full' });
      return;
    }

    player.team = team;
    if (player.isObserver) {
      player.isObserver = false;
      player.isReady = player.isHost;
      player.paymentStatus = this.state.wagerEnabled ? 'unpaid' : '';
      this.broadcast('playerObserverChanged', {
        playerId: client.sessionId,
        isObserver: false,
        team: player.team,
        isReady: player.isReady,
      });
    }

    this.broadcast('playerTeamChanged', {
      playerId: client.sessionId,
      team,
    });
    this.updateMetadata();
  }

  private handleSetObserver(client: Client, observer: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.isBot) return;

    if (!this.state.observersEnabled) {
      client.send('error', { message: 'Observers are not enabled for this lobby' });
      return;
    }

    if (this.isRankedQueue) {
      client.send('error', { message: 'Ranked lobbies do not allow observers' });
      return;
    }

    if (!observer) {
      if (!player.isObserver) return;
      player.isObserver = false;
      player.team = '';
      player.isReady = false;
      player.paymentStatus = this.state.wagerEnabled ? 'unpaid' : '';
      this.broadcast('playerObserverChanged', {
        playerId: client.sessionId,
        isObserver: false,
        team: player.team,
        isReady: player.isReady,
      });
      this.broadcast('playerTeamChanged', { playerId: client.sessionId, team: player.team });
      this.broadcast('playerReady', { playerId: client.sessionId, ready: player.isReady });
      this.updateMetadata();
      this.broadcastLobbyState();
      return;
    }

    if (this.getObserverCountExcluding(client.sessionId) >= this.state.maxObservers) {
      client.send('error', { message: 'Observer slot is full' });
      return;
    }

    const hasActiveWagerPayment = this.state.wagerEnabled
      && player.paymentStatus !== ''
      && player.paymentStatus !== 'not_required'
      && player.paymentStatus !== 'unpaid'
      && player.paymentStatus !== 'failed'
      && player.paymentStatus !== 'expired';
    if (hasActiveWagerPayment) {
      client.send('error', { message: 'Paid combat entries cannot switch to observer' });
      return;
    }

    player.isObserver = true;
    player.team = '';
    player.isReady = true;
    player.paymentStatus = this.state.wagerEnabled ? 'not_required' : '';
    player.paymentWalletAddress = '';
    player.depositSignature = '';
    player.refundSignature = '';
    this.broadcast('playerObserverChanged', {
      playerId: client.sessionId,
      isObserver: true,
      team: player.team,
      isReady: player.isReady,
    });
    this.broadcast('playerTeamChanged', { playerId: client.sessionId, team: player.team });
    this.broadcast('playerReady', { playerId: client.sessionId, ready: player.isReady });
    this.updateMetadata();
    this.broadcastLobbyState();
  }

  private handleDevSetObserver(client: Client, observer: boolean) {
    if (!this.isDevelopmentMode()) {
      client.send('error', { message: 'Developer commands are disabled' });
      return;
    }

    if (observer && this.isMatchmakingQueue()) {
      client.send('error', { message: 'Matchmaking lobbies do not allow observers' });
      return;
    }

    if (observer && !this.state.observersEnabled) {
      this.state.observersEnabled = true;
      this.state.maxObservers = MAX_OBSERVERS;
      this.maxClients = MAX_PARTICIPANTS + this.state.maxObservers;
      this.state.maxPlayers = this.maxClients;
    }

    this.handleSetObserver(client, observer);
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
        : this.isWageredLobby()
          ? 'players'
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
      if (p.isObserver) return;
      if (!p.isHost && !p.isReady) {
        allReady = false;
      }
    });

    if (!allReady && combatParticipantCount > 1) {
      client.send('error', { message: 'Not all players are ready' });
      return;
    }

    const wagerEligibility = await this.ensureWagerStartEligible(client);
    if (!wagerEligibility) return;

    const capacityAvailable = await this.ensureInGameCapacityAvailableForRoster(client);
    if (!capacityAvailable) return;

    this.beginMapVote();
  }

  private beginMapVote(): void {
    this.clearMapVoteTimer();
    this.clearCapacityRetry();
    this.setMatchmakingCapacityBlocked(false);
    this.state.status = 'map_vote';
    this.setMatchmakingLocked(true);
    this.mapVoteSession = {
      options: this.createMapVoteOptions(),
      votes: new Map(),
      phaseEndTime: null,
      previewReadyPlayerIds: new Set(),
    };

    this.state.players.forEach((player, playerId) => {
      if (!player.isBot) return;
      const option = this.mapVoteSession!.options[Math.floor(Math.random() * this.mapVoteSession!.options.length)];
      this.mapVoteSession!.votes.set(playerId, option.id);
    });

    this.updateMetadata({ status: 'map_vote' });
    this.broadcastMapVoteStarted();
    this.startMapVoteCountdownIfReady();
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
      if (player.isBot || player.isObserver) return;
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
    });

    this.clearMapVoteTimer();
    this.mapVoteFinalizeTimeout = setTimeout(() => {
      this.finalizeMapVote().catch((error) => {
        console.error('Failed to finalize map vote:', error);
      });
    }, MAP_VOTE_DURATION_MS);
  }

  private handleMapVote(client: Client, optionId: string): void {
    if (!this.mapVoteSession || this.state.status !== 'map_vote') {
      client.send('error', { message: 'Map vote is not active' });
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
  }

  private handleFinalizeMapVote(client: Client): void {
    if (this.isRankedQueue) {
      client.send('error', { message: 'Ranked map voting finalizes automatically' });
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player?.isHost) {
      client.send('error', { message: 'Only the host can lock the map vote' });
      return;
    }

    if (!this.mapVoteSession?.phaseEndTime) {
      client.send('error', { message: 'Map vote is still preparing' });
      return;
    }

    this.finalizeMapVote(client).catch((error) => {
      console.error('Failed to finalize map vote:', error);
      client.send('error', { message: 'Failed to start game' });
    });
  }

  private async finalizeMapVote(errorClient?: Client): Promise<void> {
    if (!this.mapVoteSession || this.state.status !== 'map_vote') return;

    const wagerEligibility = await this.ensureWagerStartEligible(errorClient);
    if (!wagerEligibility) {
      this.clearMapVoteTimer();
      this.state.status = this.isMatchmakingQueue() ? 'matchmaking' : 'waiting';
      this.mapVoteSession = null;
      this.setMatchmakingLocked(false);
      this.updateMetadata({ status: this.state.status });
      this.broadcast('mapVoteCancelled', { reason: 'Wager payment required', status: this.state.status });
      this.broadcastLobbyState();
      return;
    }

    const selectedOption = this.getWinningMapOption();
    const selectedMapThemeId = selectedOption.mapThemeId ?? await this.resolveSelectedMapThemeId(selectedOption.seed);
    this.clearMapVoteTimer();
    this.state.status = 'starting';
    this.updateMetadata({ status: 'starting' });

    this.broadcast('mapVoteFinalized', {
      selectedOptionId: selectedOption.id,
      mapSeed: selectedOption.seed,
      mapThemeId: selectedMapThemeId,
      votes: this.getMapVoteRecords(),
    });

    try {
      await this.createGameFromLobby(selectedOption.seed, selectedMapThemeId);
    } catch (error) {
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
      this.broadcast('mapVoteCancelled', { reason, status: this.state.status });
      this.broadcastLobbyState();
      errorClient?.send('error', { message: reason });
    }
  }

  private async createGameFromLobby(mapSeed: number, mapThemeId: VoxelMapTheme['id']): Promise<void> {
    const playerAssignments = this.createPlayerAssignments();
    const observerAssignments = this.createObserverAssignments();
    const gameStartingAssignments: GameStartingAssignment[] = [...playerAssignments, ...observerAssignments];
    const reservedHumanPlayers = playerAssignments.filter((assignment) => !assignment.isBot).length;
    const requiredHumanPlayers = this.isMatchmakingQueue()
      ? QUICK_PLAY_REQUIRED_PLAYERS
      : reservedHumanPlayers;
    let lockedWagerContext: LockedWagerContext | null = null;

    try {
      if (this.state.wagerEnabled) {
        if (this.getBotCount() > 0) {
          throw new Error('Wagered lobbies do not allow bots');
        }
        lockedWagerContext = await wagerService.lockLobbyRoster(this.state.lobbyId, this.buildWagerRoster());
      }
      const rankedEligible = this.isRankedMatchCandidate(playerAssignments, lockedWagerContext);

      const admission = await runWithInGameCapacity({
        matchMaker,
        requestedPlayers: reservedHumanPlayers,
        localProcessId: matchMaker.processId,
      }, () => matchMaker.createRoom('game_room', {
        lobbyId: this.state.lobbyId,
        lobbyName: this.state.name,
        matchMode: this.matchMode,
        mapSeed,
        mapThemeId,
        botAssignments: playerAssignments.filter((assignment) => assignment.isBot),
        observerCount: observerAssignments.length,
        wagerContext: lockedWagerContext,
        rankedEligible,
        requiredHumanPlayers,
        reservedHumanPlayers,
      }));

      if (!admission.admitted) {
        throw new InGameCapacityAdmissionError(admission.reason, admission.snapshot, reservedHumanPlayers);
      }

      const gameRoom = admission.result;
      this.clearCapacityRetry();
      this.setMatchmakingCapacityBlocked(false);

      if (lockedWagerContext) {
        await wagerService.markLobbyInGame(this.state.lobbyId, gameRoom.roomId);
      }

      this.state.gameRoomId = gameRoom.roomId;
      this.state.status = 'in_game';
      this.mapVoteSession = null;
      await this.refreshWagerState();
      this.updateMetadata({ status: 'in_game' });

      const ticketsByPlayerId = new Map<string, string>();
      for (const assignment of playerAssignments) {
        if (assignment.isBot) continue;
        const authContext = this.playerAuthContexts.get(assignment.playerId);
        ticketsByPlayerId.set(assignment.playerId, createGameEntryTicket({
          lobbyId: this.state.lobbyId,
          gameRoomId: gameRoom.roomId,
          lobbyPlayerId: assignment.playerId,
          userId: authContext?.userId ?? `guest:${assignment.playerId}`,
          displayName: authContext?.displayName ?? assignment.playerName,
          assignedTeam: assignment.team,
          selectedHero: assignment.heroId,
        }));
      }
      for (const assignment of observerAssignments) {
        const authContext = this.playerAuthContexts.get(assignment.playerId);
        ticketsByPlayerId.set(assignment.playerId, createGameEntryTicket({
          lobbyId: this.state.lobbyId,
          gameRoomId: gameRoom.roomId,
          lobbyPlayerId: assignment.playerId,
          userId: authContext?.userId ?? `guest:${assignment.playerId}`,
          displayName: authContext?.displayName ?? assignment.playerName,
          observer: true,
        }));
      }

      // Tell each human client to join with only their own entry ticket.
      for (const client of this.clients) {
        client.send('gameStarting', {
          gameRoomId: gameRoom.roomId,
          players: gameStartingAssignments,
          entryTicket: ticketsByPlayerId.get(client.sessionId),
          mapThemeId,
          wager: lockedWagerContext,
        });
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
      if (lockedWagerContext) {
        await wagerService.refundLobbyBeforeGame(this.state.lobbyId, 'game_start_failed');
        await this.refreshWagerState();
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

    const sanitized = message.trim().substring(0, 200);
    if (!sanitized) return;

    this.broadcast('chat', {
      playerId: client.sessionId,
      playerName: player.name,
      message: sanitized,
      timestamp: Date.now(),
    });
  }

  private applyLobbyPlayerRank(
    player: LobbyPlayer,
    rank: ReturnType<typeof toPublicRankSnapshot>
  ): void {
    player.rankTier = rank.tier;
    player.rankTierLabel = rank.tierLabel;
    player.rankDivision = rank.division ?? 0;
    player.rankDivisionIndex = rank.divisionIndex ?? -1;
    player.rankLabel = rank.label;
    player.rankIconKey = rank.iconKey;
    player.rankIsRanked = rank.isRanked;
    player.rankPlacementRemaining = rank.placementRemaining;
  }

  private getLobbyRankPayload(player: LobbyPlayer): ReturnType<typeof toPublicRankSnapshot> {
    return {
      tier: player.rankTier as ReturnType<typeof toPublicRankSnapshot>['tier'],
      tierLabel: player.rankTierLabel,
      division: player.rankDivision > 0 ? player.rankDivision : null,
      divisionIndex: player.rankDivisionIndex >= 0 ? player.rankDivisionIndex : null,
      label: player.rankLabel,
      iconKey: player.rankIconKey,
      isRanked: player.rankIsRanked,
      placementRemaining: player.rankPlacementRemaining,
    };
  }

  private getPlayersArray() {
    const players: any[] = [];
    this.state.players.forEach((p, id) => {
      players.push({
        id,
        name: p.name,
        isHost: p.isHost,
        isReady: p.isReady,
        team: p.team,
        isObserver: p.isObserver,
        heroId: p.heroId,
        isBot: p.isBot,
        botDifficulty: p.botDifficulty,
        botProfileId: p.botProfileId,
        rank: this.getLobbyRankPayload(p),
        paymentStatus: p.paymentStatus,
        paymentWalletAddress: p.paymentWalletAddress,
        depositSignature: p.depositSignature,
        refundSignature: p.refundSignature,
      });
    });
    return players;
  }

  private getTeamCount(team: string): number {
    let count = 0;
    this.state.players.forEach((p) => {
      if (!p.isObserver && p.team === team) count++;
    });
    return count;
  }

  private handleAddBot(
    client: Client,
    data: { difficulty?: BotDifficulty; team?: string; name?: string; heroId?: HeroId | '' }
  ): void {
    if (!this.isHost(client)) return;
    if (this.isWageredLobby()) {
      client.send('error', { message: 'Wagered lobbies do not allow bots' });
      return;
    }

    const result = this.createBot(data);
    if (!result.ok) {
      client.send('error', { message: this.getCreateBotFailureMessage(result.reason) });
    }
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
    const maxPerTeam = MAX_PLAYERS_PER_TEAM;
    if (teamCount >= maxPerTeam) {
      client.send('error', { message: 'Team is full' });
      return;
    }

    bot.team = team;
    this.broadcast('playerTeamChanged', { playerId: botId, team });
    this.updateMetadata();
  }

  private handleUpdateBotDifficulty(client: Client, botId: string, difficulty: BotDifficulty): void {
    if (!this.isHost(client)) return;

    const bot = this.state.players.get(botId);
    if (!bot?.isBot) return;

    bot.botDifficulty = this.normalizeDifficulty(difficulty);
    this.broadcast('botDifficultyChanged', { playerId: botId, difficulty: bot.botDifficulty });
    this.updateMetadata();
  }

  private handleUpdateBotHero(client: Client, botId: string, heroId: HeroId | ''): void {
    if (!this.isHost(client)) return;

    const bot = this.state.players.get(botId);
    if (!bot?.isBot) return;

    bot.heroId = this.normalizeHeroId(heroId);
    this.broadcast('botHeroChanged', { playerId: botId, heroId: bot.heroId });
    this.updateMetadata();
  }

  private getCreateBotFailureMessage(reason: CreateBotFailureReason): string {
    switch (reason) {
      case 'team_full':
        return 'Team is full';
      case 'bots_disabled':
        return 'Bots are disabled for this lobby';
      case 'lobby_full':
      default:
        return 'Lobby is full';
    }
  }

  private createBot(data: { difficulty?: BotDifficulty; team?: string; name?: string; heroId?: HeroId | '' }): CreateBotResult {
    const requestedTeam = data.team === 'red' || data.team === 'blue'
      ? data.team
      : null;
    const failureReason = getCreateBotFailureReason({
      wageredLobby: this.isWageredLobby(),
      combatParticipantCount: this.getCombatParticipantCount(),
      maxParticipants: this.state.maxParticipants,
      requestedTeam,
      requestedTeamCount: requestedTeam ? this.getTeamCount(requestedTeam) : 0,
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
    bot.heroId = this.normalizeHeroId(data.heroId);
    bot.isBot = true;
    bot.botDifficulty = this.normalizeDifficulty(data.difficulty);
    bot.botProfileId = profileName.toLowerCase();
    bot.paymentStatus = this.state.wagerEnabled ? 'not_required' : '';

    this.state.players.set(bot.id, bot);
    this.broadcast('playerJoined', {
      playerId: bot.id,
      playerName: bot.name,
      isHost: bot.isHost,
      isReady: bot.isReady,
      team: bot.team,
      isObserver: bot.isObserver,
      heroId: bot.heroId,
      isBot: bot.isBot,
      botDifficulty: bot.botDifficulty,
      botProfileId: bot.botProfileId,
      rank: this.getLobbyRankPayload(bot),
      paymentStatus: bot.paymentStatus,
    });
    this.updateMetadata();
    return { ok: true, bot };
  }

  private removeBot(botId: string): void {
    const bot = this.state.players.get(botId);
    if (!bot?.isBot) return;

    this.state.players.delete(botId);
    const removedVote = this.mapVoteSession?.votes.delete(botId) ?? false;
    this.broadcast('playerLeft', { playerId: botId, isBot: true });
    if (removedVote) {
      this.broadcastMapVoteUpdated();
    }
    this.updateMetadata();
  }

  private createMapVoteOptions(): MapVoteOption[] {
    if (this.customMapSeed !== null) {
      const mapThemeId = this.forceGoldenMapOption ? GOLDEN_VOXEL_MAP_THEME_ID : null;
      return [this.createMapVoteOption(this.customMapSeed, 0, mapThemeId)];
    }

    const source = hashSeed(Date.now() ^ Math.imul(this.botIdCounter + 1, 0x632be59b));
    const themeIndices = getShuffledThemeIndices(source);
    const forcedGoldenIndex = this.forceGoldenMapOption
      ? hashSeed(source ^ 0x676f6c64) % MAP_VOTE_OPTION_COUNT
      : -1;

    return Array.from({ length: MAP_VOTE_OPTION_COUNT }, (_, index) => {
      const themeIndex = themeIndices[index % themeIndices.length];
      const seed = createSeedForTheme(themeIndex, source ^ Math.imul(index + 1, 0x85ebca6b));
      const mapThemeId = index === forcedGoldenIndex ? GOLDEN_VOXEL_MAP_THEME_ID : null;
      return this.createMapVoteOption(seed, index, mapThemeId);
    });
  }

  private createMapVoteOption(seed: number, index: number, mapThemeId: VoxelMapTheme['id'] | null = null): MapVoteOption {
    const normalizedSeed = seed >>> 0;
    const theme = getVoxelMapTheme(normalizedSeed, mapThemeId);
    const preview = createProceduralMapPreview(normalizedSeed);
    const suffix = MAP_NAME_SUFFIXES[hashSeed(normalizedSeed ^ index) % MAP_NAME_SUFFIXES.length];
    const themeName = mapThemeId ? theme.name : preview.themeName || theme.name;
    const topologyLabel = preview.name.replace(`${preview.themeName || getVoxelMapTheme(normalizedSeed).name} `, '');

    return {
      id: `map_${index + 1}`,
      seed: normalizedSeed,
      name: `${themeName} ${topologyLabel} ${suffix}`,
      themeId: theme.id,
      themeName,
      mapThemeId,
      topologyId: preview.topologyId,
      preview: preview.preview,
      score: preview.diagnostics.score,
    };
  }

  private getMapVoteRecords(): MapVoteRecord[] {
    if (!this.mapVoteSession) return [];
    return Array.from(this.mapVoteSession.votes, ([playerId, optionId]) => ({ playerId, optionId }));
  }

  private getWinningMapOption(): MapVoteOption {
    const session = this.mapVoteSession;
    if (!session) {
      throw new Error('Cannot choose map without an active vote');
    }

    const voteCounts = new Map(session.options.map((option) => [option.id, 0]));
    session.votes.forEach((optionId) => {
      voteCounts.set(optionId, (voteCounts.get(optionId) || 0) + 1);
    });

    const hostVote = this.state.hostId ? session.votes.get(this.state.hostId) : null;
    let bestOption = session.options[0];
    let bestCount = voteCounts.get(bestOption.id) || 0;

    for (const option of session.options.slice(1)) {
      const count = voteCounts.get(option.id) || 0;
      const hostBreaksTie = count === bestCount && hostVote === option.id && hostVote !== bestOption.id;

      if (count > bestCount || hostBreaksTie) {
        bestOption = option;
        bestCount = count;
      }
    }

    return bestOption;
  }

  private async resolveSelectedMapThemeId(seed: number): Promise<VoxelMapTheme['id']> {
    const standardThemeId = getVoxelMapTheme(seed).id;
    if (!this.isRankedQueue) return standardThemeId;

    const rollSalt = hashText(this.state.lobbyId || this.roomId);
    if (!wagerService.shouldRollGoldenBiome(seed, rollSalt)) return standardThemeId;

    const eligibility = await wagerService.getGoldenBiomeTreasuryEligibility().catch((error) => {
      console.error('[LobbyRoom] Golden biome treasury eligibility check failed:', error);
      return { eligible: false };
    });

    return eligibility.eligible ? 'golden' : standardThemeId;
  }

  private sendMapVoteStarted(client: Client): void {
    if (!this.mapVoteSession) return;
    client.send('mapVoteStarted', {
      options: this.mapVoteSession.options,
      votes: this.getMapVoteRecords(),
      phaseEndTime: this.mapVoteSession.phaseEndTime,
    });
  }

  private broadcastMapVoteStarted(): void {
    if (!this.mapVoteSession) return;
    this.broadcast('mapVoteStarted', {
      options: this.mapVoteSession.options,
      votes: this.getMapVoteRecords(),
      phaseEndTime: this.mapVoteSession.phaseEndTime,
    });
  }

  private broadcastMapVoteUpdated(): void {
    if (!this.mapVoteSession) return;
    this.broadcast('mapVoteUpdated', {
      votes: this.getMapVoteRecords(),
    });
  }

  private clearMapVoteTimer(): void {
    if (this.mapVoteFinalizeTimeout) {
      clearTimeout(this.mapVoteFinalizeTimeout);
      this.mapVoteFinalizeTimeout = null;
    }
  }

  private createPlayerAssignments(): ParticipantAssignment[] {
    const assignments: ParticipantAssignment[] = [];

    this.state.players.forEach((p) => {
      if (p.isObserver) return;

      const team = p.team;
      if (!this.isTeam(team)) {
        throw new Error('Cannot create assignments with unassigned players');
      }

      assignments.push({
        playerId: p.id,
        playerName: p.name,
        team,
        isBot: p.isBot,
        heroId: this.normalizeHeroId(p.heroId) || undefined,
        botDifficulty: p.isBot ? this.normalizeDifficulty(p.botDifficulty) : undefined,
        botProfileId: p.botProfileId || undefined,
      });
    });

    return assignments;
  }

  private createObserverAssignments(): ObserverAssignment[] {
    const assignments: ObserverAssignment[] = [];
    this.state.players.forEach((player) => {
      if (!player.isObserver || player.isBot) return;
      assignments.push({
        playerId: player.id,
        playerName: player.name,
        isBot: false,
        isObserver: true,
      });
    });
    return assignments;
  }

  private assignBalancedTeam(): Team {
    const redCount = this.getTeamCount('red');
    const blueCount = this.getTeamCount('blue');
    return redCount <= blueCount ? 'red' : 'blue';
  }

  private isTeam(team: string): team is Team {
    return team === 'red' || team === 'blue';
  }

  private hasUnassignedPlayers(): boolean {
    let hasUnassigned = false;
    this.state.players.forEach((player) => {
      if (player.isObserver) return;
      if (!this.isTeam(player.team)) {
        hasUnassigned = true;
      }
    });
    return hasUnassigned;
  }

  private getTeamCountExcluding(team: string, excludedPlayerId: string): number {
    let count = 0;
    this.state.players.forEach((p, id) => {
      if (id !== excludedPlayerId && !p.isObserver && p.team === team) count++;
    });
    return count;
  }

  private getHumanCount(): number {
    let count = 0;
    this.state.players.forEach((player) => {
      if (!player.isBot && !player.isObserver) count++;
    });
    return count;
  }

  private getLobbyHumanCount(): number {
    let count = 0;
    this.state.players.forEach((player) => {
      if (!player.isBot) count++;
    });
    return count;
  }

  private getBotCount(): number {
    let count = 0;
    this.state.players.forEach((player) => {
      if (player.isBot) count++;
    });
    return count;
  }

  private getObserverCount(): number {
    let count = 0;
    this.state.players.forEach((player) => {
      if (player.isObserver) count++;
    });
    return count;
  }

  private getObserverCountExcluding(excludedPlayerId: string): number {
    let count = 0;
    this.state.players.forEach((player, playerId) => {
      if (playerId !== excludedPlayerId && player.isObserver) count++;
    });
    return count;
  }

  private getCombatParticipantCount(): number {
    let count = 0;
    this.state.players.forEach((player) => {
      if (!player.isObserver) count++;
    });
    return count;
  }

  private getMinimumParticipantsToStart(): number {
    if (this.isProductionCustomLobby()) {
      return PRODUCTION_CUSTOM_MIN_PARTICIPANTS;
    }

    return 1;
  }

  private isProductionCustomLobby(): boolean {
    return process.env.NODE_ENV === 'production'
      && (this.matchMode === 'custom' || this.matchMode === 'custom_wager');
  }

  private isWageredLobby(): boolean {
    return this.matchMode === 'ranked'
      || this.matchMode === 'custom_wager'
      || this.pendingWagerOptions?.enabled === true
      || this.state?.wagerEnabled === true;
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

  private normalizeHeroId(heroId?: HeroId | string): HeroId | '' {
    return heroId && HERO_DEFINITIONS[heroId as HeroId] ? (heroId as HeroId) : '';
  }

  private async ensureWagerCreatedForHost(authContext: RoomAuthContext): Promise<void> {
    if (!this.pendingWagerOptions) return;
    const pending = this.pendingWagerOptions;
    this.pendingWagerOptions = undefined;

    if (!pending.enabled) return;
    if (authContext.kind !== 'authenticated') {
      throw new Error('Sign in before creating a wagered lobby');
    }
    if (this.getBotCount() > 0) {
      throw new Error('Wagered lobbies do not allow bots');
    }

    const snapshot = await wagerService.createWageredLobby({
      lobbyId: this.state.lobbyId,
      createdByUserId: authContext.userId,
      matchMode: this.matchMode,
      rankedEntryQuoteId: this.isRankedQueue ? this.rankedEntryQuoteId : null,
      options: pending,
    });
    this.applyWagerSnapshot(snapshot);
    this.updateMetadata();
  }

  private applyWagerSnapshot(snapshot: LobbyWagerSnapshot): void {
    this.state.wagerEnabled = snapshot.enabled;
    this.state.wagerStatus = snapshot.status || '';
    this.state.wagerToken = snapshot.token || '';
    this.state.wagerCoverChargeLamports = snapshot.coverChargeLamports || '';
    this.state.wagerTreasuryWallet = snapshot.treasuryWallet || '';
    this.state.wagerPlatformFeeBps = snapshot.platformFeeBps || 0;
    this.state.wagerPotLamports = snapshot.potLamports || '0';
    this.state.wagerPaidPlayerCount = snapshot.paidPlayerCount || 0;
  }

  private getWagerPayload(): Record<string, unknown> {
    if (!this.state.wagerEnabled) {
      return { enabled: false };
    }

    return {
      enabled: true,
      matchMode: this.matchMode,
      rankedEntryQuoteId: this.rankedEntryQuoteId,
      status: this.state.wagerStatus,
      token: this.state.wagerToken,
      coverChargeLamports: this.state.wagerCoverChargeLamports,
      treasuryWallet: this.state.wagerTreasuryWallet,
      platformFeeBps: this.state.wagerPlatformFeeBps,
      potLamports: this.state.wagerPotLamports,
      paidPlayerCount: this.state.wagerPaidPlayerCount,
    };
  }

  private buildWagerRoster(): WagerRosterPlayer[] {
    const roster: WagerRosterPlayer[] = [];
    this.state.players.forEach((player, playerId) => {
      if (player.isObserver) return;
      const authContext = this.playerAuthContexts.get(playerId);
      roster.push({
        lobbyPlayerId: playerId,
        userId: player.isBot ? null : authContext?.userId ?? `guest:${playerId}`,
        name: player.name,
        team: this.isTeam(player.team) ? player.team : null,
        isBot: player.isBot,
      });
    });
    return roster;
  }

  private isRankedMatchCandidate(
    playerAssignments: ParticipantAssignment[],
    lockedWagerContext: LockedWagerContext | null
  ): boolean {
    if (this.matchMode !== 'ranked' || lockedWagerContext || this.state.wagerEnabled) return false;
    if (this.getHumanCount() !== QUICK_PLAY_REQUIRED_PLAYERS || this.getBotCount() !== 0) return false;
    if (playerAssignments.length !== QUICK_PLAY_REQUIRED_PLAYERS) return false;
    if (playerAssignments.some((assignment) => assignment.isBot)) return false;

    return playerAssignments.every((assignment) => (
      this.playerAuthContexts.get(assignment.playerId)?.kind === 'authenticated'
      && this.playerMatchmakingTickets.get(assignment.playerId)?.mode === 'ranked'
    ));
  }

  private async refreshWagerState(): Promise<void> {
    const snapshot = await wagerService.getLobbySnapshot(this.state.lobbyId);
    this.applyWagerSnapshot(snapshot);

    if (!snapshot.enabled) {
      this.state.players.forEach((player) => {
        player.paymentStatus = '';
        player.paymentWalletAddress = '';
        player.depositSignature = '';
        player.refundSignature = '';
      });
      this.updateMetadata();
      return;
    }

    const statuses = await wagerService.getPlayerPaymentStatuses(this.state.lobbyId, this.buildWagerRoster());
    for (const status of statuses) {
      const player = this.state.players.get(status.lobbyPlayerId);
      if (!player) continue;
      player.paymentStatus = status.status;
      player.paymentWalletAddress = status.walletAddress || '';
      player.depositSignature = status.depositSignature || '';
      player.refundSignature = status.refundSignature || '';
    }
    this.updateMetadata();
  }

  private async applyPaymentStatusUpdate(payload: WagerPaymentStatusChanged): Promise<void> {
    await this.refreshWagerState();
    this.broadcast('paymentStatusChanged', payload);
    this.broadcastLobbyState();
    this.broadcastMatchmakingStatus();
    this.tryStartMatchmakingMapVote();
  }

  private async handleCreatePaymentIntent(client: Client, walletAddress: string): Promise<void> {
    const authContext = this.playerAuthContexts.get(client.sessionId);
    if (authContext?.kind !== 'authenticated') {
      throw new Error('Sign in with a Solana wallet before paying');
    }
    if (!this.state.wagerEnabled) {
      throw new Error('This lobby does not require payment');
    }
    const player = this.state.players.get(client.sessionId);
    if (player?.isObserver) {
      throw new Error('Observers do not pay the combat entry');
    }

    const intent = await wagerService.createPaymentIntent({
      lobbyId: this.state.lobbyId,
      userId: authContext.userId,
      walletAddress: walletAddress || authContext.walletAddress || '',
      lobbyPlayerId: client.sessionId,
      rankedEntryQuoteId: this.playerMatchmakingTickets.get(client.sessionId)?.rankedEntryQuoteId ?? null,
    });
    await this.refreshWagerState();
    client.send('paymentIntentCreated', { intent });
  }

  private async handleSubmitPaymentSignature(client: Client, intentId: string, signature: string): Promise<void> {
    const authContext = this.playerAuthContexts.get(client.sessionId);
    if (authContext?.kind !== 'authenticated') {
      throw new Error('Sign in before verifying payment');
    }

    const intent = await wagerService.submitPaymentSignature({
      intentId,
      userId: authContext.userId,
      signature,
    });
    await this.refreshWagerState();
    client.send('paymentIntentUpdated', { intent });
  }

  private async ensureWagerStartEligible(client?: Client): Promise<boolean> {
    if (!this.state.wagerEnabled) return true;
    await this.refreshWagerState();
    if (this.getBotCount() > 0) {
      const payload = {
        message: 'Wagered lobbies do not allow bots',
        unpaidPlayers: [],
        paidHumanCountByTeam: this.getPaidHumanCountByTeam(),
        reasons: ['wager_bots_not_allowed'],
      };
      client?.send('wagerStartBlocked', payload);
      client?.send('error', { message: payload.message });
      return false;
    }
    if (this.isRankedQueue && (this.getHumanCount() !== QUICK_PLAY_REQUIRED_PLAYERS || this.getBotCount() !== 0)) {
      const payload = {
        message: 'Ranked requires a full human roster before starting',
        unpaidPlayers: [],
        paidHumanCountByTeam: this.getPaidHumanCountByTeam(),
        reasons: ['ranked_full_human_roster_required'],
      };
      client?.send('wagerStartBlocked', payload);
      client?.send('error', { message: payload.message });
      return false;
    }
    const eligibility = await wagerService.getStartEligibility(this.state.lobbyId, this.buildWagerRoster());
    if (eligibility.canStart) return true;

    const payload = {
      message: 'All assigned human players must pay before this wagered lobby can start',
      unpaidPlayers: eligibility.unpaidPlayers,
      paidHumanCountByTeam: eligibility.paidHumanCountByTeam,
      reasons: eligibility.reasons,
    };
    client?.send('wagerStartBlocked', payload);
    client?.send('error', { message: payload.message, unpaidPlayers: eligibility.unpaidPlayers });
    return false;
  }

  private broadcastLobbyState(): void {
    this.broadcast('lobbyState', {
      lobbyId: this.state.lobbyId,
      name: this.state.name,
      matchMode: this.matchMode,
      hostId: this.state.hostId,
      status: this.state.status,
      players: this.getPlayersArray(),
      maxPlayers: this.state.maxPlayers,
      maxParticipants: this.state.maxParticipants,
      observersEnabled: this.state.observersEnabled,
      maxObservers: this.state.maxObservers,
      observerCount: this.getObserverCount(),
      humanCount: this.getHumanCount(),
      botCount: this.getBotCount(),
      wager: this.getWagerPayload(),
      requiredPlayers: this.isMatchmakingQueue() ? QUICK_PLAY_REQUIRED_PLAYERS : undefined,
      ...this.getMatchmakingStatusPayload(),
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
    if (this.getHumanCount() < QUICK_PLAY_REQUIRED_PLAYERS) return;

    const capacityAvailable = await this.ensureInGameCapacityAvailableForRoster();
    if (!capacityAvailable || this.state.status !== 'matchmaking') return;

    if (!this.isRankedQueue) {
      this.beginMapVote();
      return;
    }

    if (this.getBotCount() !== 0) return;

    const canStart = await this.ensureWagerStartEligible();
    if (!canStart || this.state.status !== 'matchmaking') return;
    this.beginMapVote();
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
    const requestedPlayers = this.getHumanCount();
    if (requestedPlayers <= 0) return true;

    const snapshot = await collectInGameCapacitySnapshot(matchMaker);
    const localMachine = snapshot.machines.find((machine) => machine.processId === matchMaker.processId);
    const localAvailablePlayers = localMachine?.availablePlayers ?? snapshot.availablePlayers;
    if (requestedPlayers <= snapshot.availablePlayers && requestedPlayers <= localAvailablePlayers) {
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

  private subscribeToWagerEvents(): void {
    wagerEventBus.subscribeToLobby(this.state.lobbyId, this.onWagerPaymentStatusChanged)
      .then((unsubscribe) => {
        if (this.disposed) {
          unsubscribe().catch((error) => {
            console.error('[LobbyRoom] Failed to unsubscribe from wager events:', error);
          });
          return;
        }
        this.unsubscribeWagerPaymentStatusChanged = unsubscribe;
      })
      .catch((error) => {
        console.error('[LobbyRoom] Failed to subscribe to wager events:', error);
      });
  }

  private startWagerSafetyRefresh(): void {
    this.wagerSafetyRefreshInterval = setInterval(() => {
      if (!this.shouldRefreshPreGameWager()) return;
      this.refreshWagerState()
        .then(() => {
          this.broadcastLobbyState();
          this.broadcastMatchmakingStatus();
          this.tryStartMatchmakingMapVote();
        })
        .catch((error) => {
          console.error('[LobbyRoom] Failed to refresh wager state:', error);
        });
    }, WAGER_SAFETY_REFRESH_MS);
    this.wagerSafetyRefreshInterval.unref?.();
  }

  private stopWagerSafetyRefresh(): void {
    if (!this.wagerSafetyRefreshInterval) return;
    clearInterval(this.wagerSafetyRefreshInterval);
    this.wagerSafetyRefreshInterval = null;
  }

  private shouldRefreshPreGameWager(): boolean {
    return Boolean(
      this.state.wagerEnabled
        && !this.state.gameRoomId
        && this.state.status !== 'in_game'
    );
  }

  private isMatchmakingQueue(): boolean {
    return this.matchMode === 'quick_play' || this.matchMode === 'ranked';
  }

  private resolveCustomMapSeed(options: JoinOptions): number | null {
    const seed = options.mapSeed;
    if (process.env.NODE_ENV === 'production' || this.isMatchmakingQueue()) return null;
    if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
    return seed >>> 0;
  }

  private resolveForceGoldenMapOption(options: JoinOptions): boolean {
    return process.env.NODE_ENV !== 'production'
      && !this.isMatchmakingQueue()
      && options.forceGoldenMapOption === true;
  }

  private resolveObserversEnabled(options: JoinOptions): boolean {
    return process.env.NODE_ENV !== 'production'
      && !this.isMatchmakingQueue()
      && options.observersEnabled === true;
  }

  private isDevelopmentMode(): boolean {
    return isDevelopmentToolsEnabled();
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
    return options.wager?.enabled ? 'custom_wager' : 'custom';
  }

  private resolveRoomRankBand(options: JoinOptions, ticket: MatchmakingTicketClaims | null): number {
    if (options.matchmakingMode !== true) return DEFAULT_RANK_DIVISION_INDEX;

    return ticket?.targetRankDivisionIndex ?? normalizeRankDivisionIndex(options.rankBandId);
  }

  private isValidMatchmakingTicket(
    ticket: MatchmakingTicketClaims | null,
    authContext: RoomAuthContext,
    clientId: string | undefined
  ): ticket is MatchmakingTicketClaims {
    if (!ticket) return false;
    if (ticket.mode !== this.matchMode) return false;
    if (ticket.targetRankDivisionIndex !== this.rankBandId) return false;

    if (this.isRankedQueue) {
      return authContext.kind === 'authenticated'
        && ticket.userId === authContext.userId
        && ticket.mode === 'ranked';
    }

    if (authContext.kind === 'authenticated') {
      return ticket.userId === authContext.userId;
    }

    return Boolean(
      ticket.clientId
        && clientId
        && ticket.clientId === clientId
        && ticket.userId === `guest:${clientId}`
    );
  }

  private resolvePlayerCompetitiveRating(
    authContext: RoomAuthContext,
    ticket: MatchmakingTicketClaims | null
  ): number {
    if (authContext.kind === 'authenticated') {
      return authContext.competitiveRating;
    }

    return ticket?.competitiveRating ?? authContext.competitiveRating;
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

  private getPaidHumanCount(): number {
    let count = 0;
    this.state.players.forEach((player) => {
      if (player.isBot || player.isObserver) return;
      if (player.paymentStatus === 'credited' || player.paymentStatus === 'settled') {
        count++;
      }
    });
    return count;
  }

  private getPaidHumanCountByTeam(): Record<Team, number> {
    const counts: Record<Team, number> = { red: 0, blue: 0 };
    this.state.players.forEach((player) => {
      if (player.isBot || player.isObserver || (player.paymentStatus !== 'credited' && player.paymentStatus !== 'settled')) return;
      if (player.team === 'red' || player.team === 'blue') {
        counts[player.team]++;
      }
    });
    return counts;
  }

  private getMatchmakingStatusPayload(): Record<string, unknown> {
    if (!this.isMatchmakingQueue()) return {};
    const averageCompetitiveRating = this.getAverageCompetitiveRating();
    const humanCount = this.getHumanCount();
    const queuedHumanCount = humanCount;

    return {
      matchMode: this.matchMode,
      rankBandId: this.rankBandId,
      rankBandLabel: getRankDivisionLabel(this.rankBandId),
      averageCompetitiveRating,
      averageVisibleRank: getRankFromRating(averageCompetitiveRating, 0).label,
      rankSearchDistance: getAllowedRankDivisionDistance(this.getMatchmakingWaitMs()),
      matchmakingCreatedAt: this.state.createdAt,
      requiredPlayers: QUICK_PLAY_REQUIRED_PLAYERS,
      queuedHumanCount,
      provisionalHumanCount: Math.max(0, humanCount - queuedHumanCount),
      capacityBlocked: this.matchmakingCapacityBlocked,
      capacityMaxPlayers: MAX_IN_GAME_PLAYERS,
      rankedEligible: this.isRankedQueue
        && queuedHumanCount === QUICK_PLAY_REQUIRED_PLAYERS
        && humanCount === QUICK_PLAY_REQUIRED_PLAYERS
        && this.getBotCount() === 0,
    };
  }

  private broadcastMatchmakingStatus(): void {
    if (!this.isMatchmakingQueue()) return;
    this.broadcast('matchmakingStatus', this.getMatchmakingStatusPayload());
  }

  private updateMetadata(overrides: Record<string, unknown> = {}): void {
    const humanCount = this.getHumanCount();
    const botCount = this.getBotCount();
    const observerCount = this.getObserverCount();
    this.setMetadata({
      name: this.state.name,
      isPublic: this.state.isPublic,
      status: this.state.status,
      humanCount,
      botCount,
      participantCount: humanCount + botCount,
      observerCount,
      observersEnabled: this.state.observersEnabled,
      maxObservers: this.state.maxObservers,
      maxParticipants: this.state.maxParticipants,
      maxPlayers: this.state.maxPlayers,
      matchMode: this.matchMode,
      matchmakingMode: this.isMatchmakingQueue(),
      rankBandId: this.isMatchmakingQueue() ? this.rankBandId : undefined,
      requiredPlayers: this.isMatchmakingQueue() ? QUICK_PLAY_REQUIRED_PLAYERS : undefined,
      queuedHumanCount: humanCount,
      capacityBlocked: this.isMatchmakingQueue() ? this.matchmakingCapacityBlocked : undefined,
      capacityMaxPlayers: this.isMatchmakingQueue() ? MAX_IN_GAME_PLAYERS : undefined,
      wagerEnabled: this.state.wagerEnabled,
      wagerStatus: this.state.wagerStatus || undefined,
      wagerToken: this.state.wagerToken || undefined,
      wagerCoverChargeLamports: this.state.wagerCoverChargeLamports || undefined,
      wagerPotLamports: this.state.wagerPotLamports || undefined,
      wagerPaidPlayerCount: this.state.wagerPaidPlayerCount,
      wagerTreasuryWallet: this.state.wagerTreasuryWallet || undefined,
      ...this.getMatchmakingStatusPayload(),
      ...overrides,
    });
  }
}
