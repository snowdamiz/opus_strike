import type { IncomingMessage } from 'http';
import { Room, Client, matchMaker } from 'colyseus';
import { LobbyState, LobbyPlayer } from './schema/LobbyState';
import { DEFAULT_GAMEPLAY_MODE, DEFAULT_GAME_CONFIG, HERO_DEFINITIONS, getRankFromRating, getVoxelMapTheme, hashSeed, isGameplayMode, isMatchMode, isTeamHeroAvailable, toPublicRankSnapshot } from '@voxel-strike/shared';
import type { MatchMode } from '@voxel-strike/shared';
import type { BotDifficulty, GameplayMode, HeroId, Team, VoxelMapSizeId, VoxelMapTheme } from '@voxel-strike/shared';
import { assertUsableEntryTicketSecret, isDevelopmentToolsEnabled } from '../config/security';
import { resolveRoomAuthContext, type RoomAuthContext } from '../auth/session';
import { assertGameplayAccountEligible } from '../auth/accountEligibility';
import { assertTutorialCompleted } from '../auth/tutorialCompletion';
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
import { LOBBY_MESSAGE_RATE_LIMITS, MessageRateLimiter, type RateLimitRule } from './rateLimiter';
import { assignBalancedTeam as selectBalancedTeam } from './spawnAssignments';
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
import { buildLobbyChatPayload } from './roomChatRuntime';
import {
  countLobbyRoster,
  countLobbyTeamMembers,
  countLobbyTeamMembersExcluding,
} from './lobbyRoster';
import {
  buildLobbyPlayerJoinedPayload,
  buildLobbyStatePayload,
} from './lobbyNetworkPayloads';
import {
  buildMapVoteStartedPayload,
  buildMapVoteUpdatedPayload,
  createMapVoteOptions,
  getMapVoteRecords,
  getWinningMapOption,
  type MapVoteOption,
} from './lobbyMapVoteRuntime';
import {
  buildGameEntryTicketInputs,
  buildGameStartingPayload,
  createLobbyGameStartAssignments,
  type ParticipantAssignment,
} from './lobbyGameStartRuntime';
import {
  cleanupLobbySession as cleanupLobbySessionState,
  type CleanupLobbySessionResult,
} from './lobbySessionCleanup';
import { applyRoomRankState } from './roomRankSnapshot';

interface JoinOptions {
  playerName?: string;
  lobbyName?: string;
  isPrivate?: boolean;
  matchmakingMode?: boolean;
  matchMode?: MatchMode;
  gameplayMode?: GameplayMode;
  matchmakingTicket?: string;
  rankBandId?: number;
  rankedEntryQuoteId?: string;
  authToken?: string;
  initialBotCount?: number;
  botFillMode?: 'manual' | 'fill_even' | 'fill_empty';
  defaultBotDifficulty?: BotDifficulty;
  wager?: CreateWagerOptions;
  mapSeed?: number;
  forceGoldenMapOption?: boolean;
  observersEnabled?: boolean;
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

const MAX_PARTICIPANTS = DEFAULT_GAME_CONFIG.maxPlayers;
const MAX_PLAYERS_PER_TEAM = DEFAULT_GAME_CONFIG.teamSize;
const MAX_OBSERVERS = 1;
const QUICK_PLAY_REQUIRED_PLAYERS = DEFAULT_GAME_CONFIG.maxPlayers;
const PRODUCTION_CUSTOM_MIN_PARTICIPANTS = 2;
const MAP_VOTE_DURATION_MS = 30000;
const WAGER_SAFETY_REFRESH_MS = 10_000;
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
  private gameplayMode: GameplayMode = DEFAULT_GAMEPLAY_MODE;
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
    this.gameplayMode = this.resolveRoomGameplayMode(options);
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
    this.state.gameplayMode = this.gameplayMode;
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
    const authContext = (client as Client & { auth?: RoomAuthContext }).auth;
    if (!authContext) {
      client.send('error', { message: 'Authentication required' });
      client.leave();
      return;
    }

    const matchmakingTicket = this.isMatchmakingQueue()
      ? verifyMatchmakingTicket(options.matchmakingTicket)
      : null;
    if (this.isMatchmakingQueue() && !this.isValidMatchmakingTicket(matchmakingTicket, authContext)) {
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
        
        // Clean up old session data
        const oldAuthContext = this.playerAuthContexts.get(existingSessionId);
        if (
          this.state.wagerEnabled
          && oldAuthContext
          && this.state.status !== 'in_game'
          && !this.state.gameRoomId
        ) {
          wagerService.refundPlayerBeforeGame(this.state.lobbyId, oldAuthContext.userId, 'duplicate_session').catch((error) => {
            console.error('[LobbyRoom] Failed to refund duplicate session wager:', error);
          });
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

    if (this.state.players.size >= this.state.maxParticipants + this.state.maxObservers) {
      client.send('error', { message: 'Lobby is full' });
      this.cleanupLobbySession(client.sessionId);
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
    applyRoomRankState(player, toPublicRankSnapshot(authContext.rank));

    if (player.isHost) {
      this.state.hostId = client.sessionId;
    }

    this.state.players.set(client.sessionId, player);
    if (player.isHost) {
      try {
        await this.ensureWagerCreatedForHost(authContext);
      } catch (error) {
        this.cleanupLobbySession(client.sessionId);
        client.send('error', { message: error instanceof Error ? error.message : 'Failed to create wagered lobby' });
        client.leave();
        return;
      }
    }
    await this.refreshWagerState();
    this.playerCompetitiveRatings.set(
      client.sessionId,
      this.resolvePlayerCompetitiveRating(authContext)
    );

    // Notify all players
    this.broadcast('playerJoined', buildLobbyPlayerJoinedPayload(client.sessionId, player));

    // Send current lobby state to the new player
    client.send('lobbyState', this.buildLobbyStatePayload());

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
    if (
      this.state.wagerEnabled
      && authContext
      && this.state.status !== 'in_game'
      && !this.state.gameRoomId
    ) {
      wagerService.refundPlayerBeforeGame(this.state.lobbyId, authContext.userId, 'pre_game_leave').catch((error) => {
        console.error('[LobbyRoom] Failed to refund leaving player wager:', error);
      });
    }
    if (cleanup.removedVote) {
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
    const mapVoteSource = hashSeed(Date.now() ^ Math.imul(this.botIdCounter + 1, 0x632be59b));
    this.mapVoteSession = {
      options: createMapVoteOptions({
        customMapSeed: this.customMapSeed,
        forceGoldenMapOption: this.forceGoldenMapOption,
        source: mapVoteSource,
      }),
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

    const selectedOption = getWinningMapOption({
      options: this.mapVoteSession.options,
      votes: this.mapVoteSession.votes,
      hostId: this.state.hostId,
    });
    const selectedMapThemeId = selectedOption.mapThemeId ?? await this.resolveSelectedMapThemeId(selectedOption.seed);
    this.clearMapVoteTimer();
    this.state.status = 'starting';
    this.updateMetadata({ status: 'starting' });

    this.broadcast('mapVoteFinalized', {
      selectedOptionId: selectedOption.id,
      mapSeed: selectedOption.seed,
      mapThemeId: selectedMapThemeId,
      mapSize: selectedOption.mapSize,
      votes: getMapVoteRecords(this.mapVoteSession.votes),
    });

    try {
      await this.createGameFromLobby(selectedOption.seed, selectedMapThemeId, selectedOption.mapSize);
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

  private async createGameFromLobby(
    mapSeed: number,
    mapThemeId: VoxelMapTheme['id'],
    mapSize: VoxelMapSizeId
  ): Promise<void> {
    const assignments = createLobbyGameStartAssignments({
      players: this.state.players.values(),
    });
    const {
      playerAssignments,
      observerAssignments,
      gameStartingAssignments,
      botAssignments,
      reservedHumanPlayers,
    } = assignments;
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
        gameplayMode: this.gameplayMode,
        mapSeed,
        mapThemeId,
        mapSize,
        botAssignments,
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

      const ticketInputsByPlayerId = buildGameEntryTicketInputs({
        lobbyId: this.state.lobbyId,
        gameRoomId: gameRoom.roomId,
        playerAssignments,
        observerAssignments,
        authContexts: this.playerAuthContexts,
      });
      const ticketsByPlayerId = new Map<string, string>();
      for (const [playerId, ticketInput] of ticketInputsByPlayerId) {
        ticketsByPlayerId.set(playerId, createGameEntryTicket(ticketInput));
      }

      // Tell each human client to join with only their own entry ticket.
      for (const client of this.clients) {
        client.send('gameStarting', buildGameStartingPayload({
          gameRoomId: gameRoom.roomId,
          players: gameStartingAssignments,
          entryTicket: ticketsByPlayerId.get(client.sessionId),
          gameplayMode: this.gameplayMode,
          mapThemeId,
          mapSize,
          wager: lockedWagerContext,
        }));
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

    const botHeroId = this.normalizeHeroId(bot.heroId);
    const shouldClearHero = botHeroId !== ''
      && !isTeamHeroAvailable(this.state.players.values(), team, botHeroId, botId);

    bot.team = team;
    this.broadcast('playerTeamChanged', { playerId: botId, team });
    if (shouldClearHero) {
      bot.heroId = '';
      this.broadcast('botHeroChanged', { playerId: botId, heroId: bot.heroId });
    }
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
    this.broadcast('botHeroChanged', { playerId: botId, heroId: bot.heroId });
    this.updateMetadata();
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
    const botHeroId = this.normalizeHeroId(data.heroId);
    if (
      botHeroId
      && this.isTeam(bot.team)
      && !isTeamHeroAvailable(this.state.players.values(), bot.team, botHeroId)
    ) {
      return { ok: false, reason: 'hero_taken' };
    }
    bot.heroId = botHeroId;
    bot.isBot = true;
    bot.botDifficulty = this.normalizeDifficulty(data.difficulty);
    bot.botProfileId = profileName.toLowerCase();
    bot.paymentStatus = this.state.wagerEnabled ? 'not_required' : '';

    this.state.players.set(bot.id, bot);
    this.broadcast('playerJoined', buildLobbyPlayerJoinedPayload(bot.id, bot, {
      includePaymentDetails: false,
    }));
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
    client.send('mapVoteStarted', buildMapVoteStartedPayload(this.mapVoteSession));
  }

  private broadcastMapVoteStarted(): void {
    if (!this.mapVoteSession) return;
    this.broadcast('mapVoteStarted', buildMapVoteStartedPayload(this.mapVoteSession));
  }

  private broadcastMapVoteUpdated(): void {
    if (!this.mapVoteSession) return;
    this.broadcast('mapVoteUpdated', buildMapVoteUpdatedPayload(this.mapVoteSession.votes));
  }

  private clearMapVoteTimer(): void {
    if (this.mapVoteFinalizeTimeout) {
      clearTimeout(this.mapVoteFinalizeTimeout);
      this.mapVoteFinalizeTimeout = null;
    }
  }

  private assignBalancedTeam(): Team {
    return selectBalancedTeam({
      redCount: this.getTeamCount('red'),
      blueCount: this.getTeamCount('blue'),
    });
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

  private getObserverCountExcluding(excludedPlayerId: string): number {
    let count = 0;
    this.state.players.forEach((player, playerId) => {
      if (playerId !== excludedPlayerId && player.isObserver) count++;
    });
    return count;
  }

  private getCombatParticipantCount(): number {
    return countLobbyRoster(this.state.players).combatParticipant;
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
        userId: player.isBot ? null : authContext?.userId ?? null,
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
      Boolean(this.playerAuthContexts.get(assignment.playerId))
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
    if (!authContext) {
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
    if (!authContext) {
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
    this.broadcast('lobbyState', this.buildLobbyStatePayload());
  }

  private buildLobbyStatePayload() {
    return buildLobbyStatePayload({
      lobbyId: this.state.lobbyId,
      name: this.state.name,
      matchMode: this.matchMode,
      gameplayMode: this.gameplayMode,
      hostId: this.state.hostId,
      status: this.state.status,
      players: this.state.players,
      maxPlayers: this.state.maxPlayers,
      maxParticipants: this.state.maxParticipants,
      observersEnabled: this.state.observersEnabled,
      maxObservers: this.state.maxObservers,
      wager: this.getWagerPayload(),
      requiredPlayers: this.isMatchmakingQueue() ? QUICK_PLAY_REQUIRED_PLAYERS : undefined,
      matchmakingStatus: this.getMatchmakingStatusPayload(),
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

  private resolveRoomGameplayMode(options: JoinOptions): GameplayMode {
    if (options.matchmakingMode === true) return DEFAULT_GAMEPLAY_MODE;
    return isGameplayMode(options.gameplayMode) ? options.gameplayMode : DEFAULT_GAMEPLAY_MODE;
  }

  private resolveRoomRankBand(options: JoinOptions, ticket: MatchmakingTicketClaims | null): number {
    if (options.matchmakingMode !== true) return DEFAULT_RANK_DIVISION_INDEX;

    return ticket?.targetRankDivisionIndex ?? normalizeRankDivisionIndex(options.rankBandId);
  }

  private isValidMatchmakingTicket(
    ticket: MatchmakingTicketClaims | null,
    authContext: RoomAuthContext
  ): ticket is MatchmakingTicketClaims {
    if (!ticket) return false;
    if (ticket.mode !== this.matchMode) return false;
    if (ticket.targetRankDivisionIndex !== this.rankBandId) return false;

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

  private getPaidHumanCount(): number {
    return countLobbyRoster(this.state.players).paidHuman;
  }

  private getPaidHumanCountByTeam(): Record<Team, number> {
    return countLobbyRoster(this.state.players).paidHumanByTeam;
  }

  private getMatchmakingStatusPayload(): Record<string, unknown> {
    if (!this.isMatchmakingQueue()) return {};
    const averageCompetitiveRating = this.getAverageCompetitiveRating();
    const rosterCounts = countLobbyRoster(this.state.players);
    const humanCount = rosterCounts.human;
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
        && rosterCounts.bot === 0,
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
    const observerCount = rosterCounts.observer;
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
      gameplayMode: this.gameplayMode,
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
