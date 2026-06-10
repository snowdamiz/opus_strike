import type { IncomingMessage } from 'http';
import { Room, Client, matchMaker } from 'colyseus';
import { LobbyState, LobbyPlayer } from './schema/LobbyState';
import { DEFAULT_GAME_CONFIG, HERO_DEFINITIONS, createRandomSeed, createProceduralMapPreview, getVoxelMapTheme, hashSeed, VOXEL_MAP_THEMES } from '@voxel-strike/shared';
import type { BlueprintPreview, BotDifficulty, HeroId, MapTopologyId, Team } from '@voxel-strike/shared';
import { assertUsableEntryTicketSecret } from '../config/security';
import { resolveRoomAuthContext, type RoomAuthContext } from '../auth/session';
import { createGameEntryTicket } from '../security/entryTickets';
import { verifyMatchmakingTicket, type MatchmakingTicketClaims } from '../security/matchmakingTickets';
import {
  DEFAULT_MATCHMAKING_RATING,
  DEFAULT_MATCHMAKING_SKILL_BUCKET,
  getAllowedBucketDistance,
  getSkillBucketLabel,
  normalizeSkillBucket,
  type MatchmakingSkillBucket,
} from '../matchmaking/skill';
import { LOBBY_MESSAGE_RATE_LIMITS, MessageRateLimiter } from './rateLimiter';
import { wagerService, type CreateWagerOptions, type LobbyWagerSnapshot, type LockedWagerContext, type WagerPaymentStatusChanged } from '../wagers/service';
import type { WagerRosterPlayer } from '../wagers/math';
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

interface JoinOptions {
  playerName?: string;
  lobbyName?: string;
  isPrivate?: boolean;
  matchmakingMode?: boolean;
  matchmakingTicket?: string;
  skillBucket?: string;
  clientId?: string; // Persistent client ID for reconnection detection
  authToken?: string;
  initialBotCount?: number;
  botFillMode?: 'manual' | 'fill_even' | 'fill_empty';
  defaultBotDifficulty?: BotDifficulty;
  wager?: CreateWagerOptions;
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

interface MapVoteOption {
  id: string;
  seed: number;
  name: string;
  themeId: string;
  themeName: string;
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
const QUICK_PLAY_REQUIRED_PLAYERS = DEFAULT_GAME_CONFIG.maxPlayers;
const MAP_VOTE_OPTION_COUNT = 3;
const MAP_VOTE_DURATION_MS = 30000;
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

export class LobbyRoom extends Room<LobbyState> {
  maxClients = DEFAULT_GAME_CONFIG.maxPlayers;
  private botIdCounter = 0;
  private mapVoteSession: MapVoteSession | null = null;
  private mapVoteFinalizeTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly rateLimiter = new MessageRateLimiter();
  private readonly playerAuthContexts = new Map<string, RoomAuthContext>();
  private readonly playerSkillRatings = new Map<string, number>();
  private readonly onWagerPaymentStatusChanged = (payload: WagerPaymentStatusChanged) => {
    if (payload.lobbyId !== this.state.lobbyId) return;
    this.applyPaymentStatusUpdate(payload).catch((error) => {
      console.error('[LobbyRoom] Failed to apply payment status update:', error);
    });
  };
  private isQuickPlayQueue = false;
  private skillBucket: MatchmakingSkillBucket = DEFAULT_MATCHMAKING_SKILL_BUCKET;
  private pendingWagerOptions: CreateWagerOptions | undefined;
  
  // Track clientId -> sessionId mapping for reconnection detection
  private clientIdToSessionId: Map<string, string> = new Map();
  private sessionIdToClientId: Map<string, string> = new Map();

  async onAuth(client: Client, options: JoinOptions, request?: IncomingMessage): Promise<RoomAuthContext> {
    return resolveRoomAuthContext(client.sessionId, options as Record<string, unknown>, request);
  }

  onCreate(options: JoinOptions) {
    this.autoDispose = true;
    assertUsableEntryTicketSecret();
    console.log('Lobby room created:', this.roomId);
    this.isQuickPlayQueue = options.matchmakingMode === true;
    this.skillBucket = this.resolveRoomSkillBucket(options);
    this.pendingWagerOptions = !this.isQuickPlayQueue ? options.wager : undefined;

    this.setState(new LobbyState());
    this.state.lobbyId = this.roomId;
    this.state.name = options.lobbyName || (this.isQuickPlayQueue ? 'Quick Play' : `Lobby ${this.roomId.slice(0, 6)}`);
    this.state.maxPlayers = this.maxClients;
    this.state.maxParticipants = MAX_PARTICIPANTS;
    this.state.isPublic = !options.isPrivate && !this.isQuickPlayQueue;
    this.state.createdAt = Date.now();
    this.state.status = this.isQuickPlayQueue ? 'matchmaking' : 'waiting';
    this.state.defaultBotDifficulty = this.normalizeDifficulty(options.defaultBotDifficulty);
    this.state.botFillMode = options.botFillMode || 'manual';
    wagerService.on('paymentStatusChanged', this.onWagerPaymentStatusChanged);

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

    this.onMessage('startGame', (client) => {
      if (!this.rateLimiter.consume(client.sessionId, 'startGame', LOBBY_MESSAGE_RATE_LIMITS.hostAction)) return;
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
      if (!this.rateLimiter.consume(client.sessionId, 'finalizeMapVote', LOBBY_MESSAGE_RATE_LIMITS.hostAction)) return;
      this.handleFinalizeMapVote(client);
    });

    this.onMessage('kick', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'kick', LOBBY_MESSAGE_RATE_LIMITS.hostAction)) return;
      if (!isRecord(data)) return;
      const playerId = sanitizeShortText(data.playerId, 96);
      if (!playerId) return;
      this.handleKick(client, playerId);
    });

    this.onMessage('addBot', (client, data: unknown = {}) => {
      if (!this.rateLimiter.consume(client.sessionId, 'addBot', LOBBY_MESSAGE_RATE_LIMITS.hostAction)) return;
      const payload = validateBotPayload(data);
      if (!payload) return;
      this.handleAddBot(client, payload);
    });

    this.onMessage('removeBot', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'removeBot', LOBBY_MESSAGE_RATE_LIMITS.hostAction)) return;
      const botId = validateBotIdPayload(data);
      if (!botId) return;
      this.handleRemoveBot(client, botId);
    });

    this.onMessage('updateBotTeam', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'updateBotTeam', LOBBY_MESSAGE_RATE_LIMITS.hostAction)) return;
      if (!isRecord(data)) return;
      const botId = validateBotIdPayload(data);
      const team = isTeam(data.team) ? data.team : null;
      if (!botId || !team) return;
      this.handleUpdateBotTeam(client, botId, team);
    });

    this.onMessage('updateBotDifficulty', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'updateBotDifficulty', LOBBY_MESSAGE_RATE_LIMITS.hostAction)) return;
      if (!isRecord(data)) return;
      const botId = validateBotIdPayload(data);
      const difficulty = isBotDifficulty(data.difficulty) ? data.difficulty : null;
      if (!botId || !difficulty) return;
      this.handleUpdateBotDifficulty(client, botId, difficulty);
    });

    this.onMessage('updateBotHero', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'updateBotHero', LOBBY_MESSAGE_RATE_LIMITS.hostAction)) return;
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

    const initialBotCount = Math.max(0, Math.min(MAX_PARTICIPANTS - 1, Math.floor(options.initialBotCount || 0)));
    for (let i = 0; i < initialBotCount; i++) {
      this.createBot({ difficulty: this.state.defaultBotDifficulty as BotDifficulty });
    }
    this.updateMetadata();
  }

  async onJoin(client: Client, options: JoinOptions) {
    const authContext = (client as Client & { auth?: RoomAuthContext }).auth ?? {
      kind: 'guest' as const,
      userId: `guest:${client.sessionId}`,
      displayName: sanitizeDisplayName(options.playerName),
      matchmakingSkillRating: DEFAULT_MATCHMAKING_RATING,
      matchmakingSkillBucket: DEFAULT_MATCHMAKING_SKILL_BUCKET,
    };

    const matchmakingTicket = this.isQuickPlayQueue
      ? verifyMatchmakingTicket(options.matchmakingTicket)
      : null;
    if (this.isQuickPlayQueue && !this.isValidMatchmakingTicket(matchmakingTicket, authContext)) {
      client.send('error', { message: 'Invalid matchmaking ticket' });
      client.leave();
      return;
    }

    this.playerAuthContexts.set(client.sessionId, authContext);

    console.log(`[LobbyRoom] Player joining: sessionId=${client.sessionId}, name=${authContext.displayName}, clientId=${options.clientId}, userId=${authContext.userId}`);
    console.log(`[LobbyRoom] Current players in lobby: ${this.state.players.size}, clientId map size: ${this.clientIdToSessionId.size}`);

    // Handle reconnection: identity comes from auth or explicit guest mode, not localStorage clientId.
    const identityKey = authContext.userId;
    if (identityKey) {
      const existingSessionId = this.clientIdToSessionId.get(identityKey);
      console.log(`[LobbyRoom] Checking for existing session with identity ${identityKey}: found=${existingSessionId}`);
      
      if (existingSessionId && existingSessionId !== client.sessionId) {
        console.log(`[LobbyRoom] DUPLICATE DETECTED! Kicking old session: ${existingSessionId}`);
        
        // Find and disconnect the old client
        const oldClient = this.clients.find(c => c.sessionId === existingSessionId);
        if (oldClient) {
          oldClient.send('duplicateSession', { reason: 'Connected from another tab/window' });
          oldClient.leave(4000); // Custom code for duplicate session
        }
        
        // Clean up old session data
        const oldPlayer = this.state.players.get(existingSessionId);
        const wasHost = oldPlayer?.isHost;
        this.state.players.delete(existingSessionId);
        const removedOldVote = this.mapVoteSession?.votes.delete(existingSessionId) ?? false;
        this.mapVoteSession?.previewReadyPlayerIds.delete(existingSessionId);
        this.sessionIdToClientId.delete(existingSessionId);
        this.playerAuthContexts.delete(existingSessionId);
        this.playerSkillRatings.delete(existingSessionId);
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

    if (this.state.players.size >= this.state.maxParticipants) {
      client.send('error', { message: 'Lobby is full' });
      this.playerAuthContexts.delete(client.sessionId);
      this.playerSkillRatings.delete(client.sessionId);
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
    player.isHost = this.getHumanCount() === 0; // First human player is host
    player.isReady = this.isQuickPlayQueue;
    player.team = this.isQuickPlayQueue ? this.assignBalancedTeam() : '';
    player.heroId = '';
    player.isBot = false;
    player.botDifficulty = '';
    player.botProfileId = '';

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
        this.playerSkillRatings.delete(client.sessionId);
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
    this.playerSkillRatings.set(
      client.sessionId,
      this.resolvePlayerSkillRating(authContext, matchmakingTicket)
    );

    // Notify all players
    this.broadcast('playerJoined', {
      playerId: client.sessionId,
      playerName: player.name,
      isHost: player.isHost,
      isReady: player.isReady,
      team: player.team,
      heroId: player.heroId,
      isBot: player.isBot,
      botDifficulty: player.botDifficulty,
      botProfileId: player.botProfileId,
      paymentStatus: player.paymentStatus,
      paymentWalletAddress: player.paymentWalletAddress,
      depositSignature: player.depositSignature,
      refundSignature: player.refundSignature,
    });

    // Send current lobby state to the new player
    client.send('lobbyState', {
      lobbyId: this.state.lobbyId,
      name: this.state.name,
      hostId: this.state.hostId,
      status: this.state.status,
      players: this.getPlayersArray(),
      maxPlayers: this.state.maxPlayers,
      maxParticipants: this.state.maxParticipants,
      humanCount: this.getHumanCount(),
      botCount: this.getBotCount(),
      wager: this.getWagerPayload(),
      requiredPlayers: this.isQuickPlayQueue ? QUICK_PLAY_REQUIRED_PLAYERS : undefined,
      ...this.getMatchmakingStatusPayload(),
    });

    if (this.state.status === 'map_vote' && this.mapVoteSession) {
      this.sendMapVoteStarted(client);
    }
    this.updateMetadata();
    this.broadcastMatchmakingStatus();
    this.tryStartQuickPlayMapVote();
  }

  onLeave(client: Client, consented: boolean) {
    console.log('Player left lobby:', client.sessionId, 'consented:', consented);

    const player = this.state.players.get(client.sessionId);
    const wasHost = player?.isHost;
    const authContext = this.playerAuthContexts.get(client.sessionId);

    this.state.players.delete(client.sessionId);
    const removedVote = this.mapVoteSession?.votes.delete(client.sessionId) ?? false;
    this.mapVoteSession?.previewReadyPlayerIds.delete(client.sessionId);
    this.playerAuthContexts.delete(client.sessionId);
    this.playerSkillRatings.delete(client.sessionId);
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

  onDispose() {
    console.log('Lobby room disposing:', this.roomId);
    this.clearMapVoteTimer();
    wagerService.off('paymentStatusChanged', this.onWagerPaymentStatusChanged);
    if (this.state.wagerEnabled && this.state.status !== 'in_game' && !this.state.gameRoomId) {
      wagerService.refundLobbyBeforeGame(this.state.lobbyId, 'lobby_dispose').catch((error) => {
        console.error('[LobbyRoom] Failed to refund disposed lobby wager:', error);
      });
    }
  }

  private handleReady(client: Client, ready: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

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

    if (!this.isTeam(team)) return;

    // Check team balance
    const teamCount = this.getTeamCountExcluding(team, client.sessionId);
    const maxPerTeam = MAX_PLAYERS_PER_TEAM;
    if (teamCount >= maxPerTeam) {
      client.send('error', { message: 'Team is full' });
      return;
    }

    player.team = team;

    this.broadcast('playerTeamChanged', {
      playerId: client.sessionId,
      team,
    });
    this.updateMetadata();
  }

  private async handleStartGame(client: Client) {
    // IMPORTANT: Prevent double-execution - check status FIRST before any async operations
    if (this.state.status === 'map_vote') {
      this.sendMapVoteStarted(client);
      return;
    }

    if (this.state.status === 'starting' || this.state.status === 'in_game') {
      console.log('[LobbyRoom] Game already starting/started, ignoring duplicate startGame request');
      return;
    }
    
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.isHost) {
      client.send('error', { message: 'Only the host can start the game' });
      return;
    }

    if (this.state.players.size < 1) {
      client.send('error', { message: 'Need at least 1 player to start' });
      return;
    }

    if (this.hasUnassignedPlayers()) {
      client.send('error', { message: 'All players must choose a team' });
      return;
    }

    // Check if all players are ready (except host who can start anytime)
    let allReady = true;
    this.state.players.forEach((p) => {
      if (!p.isHost && !p.isReady) {
        allReady = false;
      }
    });

    if (!allReady && this.state.players.size > 1) {
      client.send('error', { message: 'Not all players are ready' });
      return;
    }

    const wagerEligibility = await this.ensureWagerStartEligible(client);
    if (!wagerEligibility) return;

    this.beginMapVote();
  }

  private beginMapVote(): void {
    this.clearMapVoteTimer();
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

    console.log('[LobbyRoom] Map vote started');
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
      hasHumans = true;
      if (!session.previewReadyPlayerIds.has(playerId)) {
        allHumansReady = false;
      }
    });

    if (!hasHumans || !allHumansReady) return;

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
      this.state.status = this.isQuickPlayQueue ? 'matchmaking' : 'waiting';
      this.mapVoteSession = null;
      this.setMatchmakingLocked(false);
      this.updateMetadata({ status: this.state.status });
      this.broadcast('mapVoteCancelled', { reason: 'Wager payment required', status: this.state.status });
      this.broadcastLobbyState();
      return;
    }

    const selectedOption = this.getWinningMapOption();
    this.clearMapVoteTimer();
    this.state.status = 'starting';
    this.updateMetadata({ status: 'starting' });

    this.broadcast('mapVoteFinalized', {
      selectedOptionId: selectedOption.id,
      mapSeed: selectedOption.seed,
      votes: this.getMapVoteRecords(),
    });

    console.log('[LobbyRoom] Map vote finalized', selectedOption.id, selectedOption.seed);

    try {
      await this.createGameFromLobby(selectedOption.seed);
    } catch (error) {
      console.error('Failed to create game room:', error);
      this.state.status = this.isQuickPlayQueue ? 'matchmaking' : 'waiting';
      this.mapVoteSession = null;
      this.setMatchmakingLocked(false);
      this.updateMetadata({ status: this.state.status });
      this.broadcast('mapVoteCancelled', { reason: 'Failed to start game', status: this.state.status });
      this.broadcastLobbyState();
      errorClient?.send('error', { message: 'Failed to start game' });
    }
  }

  private async createGameFromLobby(mapSeed: number): Promise<void> {
    const playerAssignments = this.createPlayerAssignments();
    let lockedWagerContext: LockedWagerContext | null = null;

    try {
      if (this.state.wagerEnabled) {
        lockedWagerContext = await wagerService.lockLobbyRoster(this.state.lobbyId, this.buildWagerRoster());
      }

      // Create the game room
      const gameRoom = await matchMaker.createRoom('game_room', {
        lobbyId: this.state.lobbyId,
        lobbyName: this.state.name,
        mapSeed,
        botAssignments: playerAssignments.filter((assignment) => assignment.isBot),
        wagerContext: lockedWagerContext,
      });

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

      // Tell each human client to join with only their own entry ticket.
      for (const client of this.clients) {
        client.send('gameStarting', {
          gameRoomId: gameRoom.roomId,
          players: playerAssignments,
          entryTicket: ticketsByPlayerId.get(client.sessionId),
          wager: lockedWagerContext,
        });
      }

      console.log('Game room created:', gameRoom.roomId, 'from lobby:', this.roomId);

      // Dispose this lobby after a short delay
      setTimeout(() => {
        this.disconnect();
      }, 5000);
    } catch (error) {
      if (lockedWagerContext) {
        await wagerService.unlockLobbyAfterStartFailure(this.state.lobbyId);
        await this.refreshWagerState();
      }
      throw error;
    }
  }

  private handleKick(client: Client, playerId: string) {
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

  private getPlayersArray() {
    const players: any[] = [];
    this.state.players.forEach((p, id) => {
      players.push({
        id,
        name: p.name,
        isHost: p.isHost,
        isReady: p.isReady,
        team: p.team,
        heroId: p.heroId,
        isBot: p.isBot,
        botDifficulty: p.botDifficulty,
        botProfileId: p.botProfileId,
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
      if (p.team === team) count++;
    });
    return count;
  }

  private handleAddBot(
    client: Client,
    data: { difficulty?: BotDifficulty; team?: string; name?: string; heroId?: HeroId | '' }
  ): void {
    if (!this.isHost(client)) return;

    const bot = this.createBot(data);
    if (!bot) {
      client.send('error', { message: 'Lobby is full' });
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

  private createBot(data: { difficulty?: BotDifficulty; team?: string; name?: string; heroId?: HeroId | '' }): LobbyPlayer | null {
    if (this.state.players.size >= this.state.maxParticipants) {
      return null;
    }

    const bot = new LobbyPlayer();
    const botIndex = this.botIdCounter++;
    const profileName = BOT_NAMES[botIndex % BOT_NAMES.length];
    bot.id = `bot_${this.roomId}_${botIndex}`;
    bot.name = data.name?.trim().slice(0, 24) || `${profileName} Bot`;
    bot.isHost = false;
    bot.isReady = true;
    bot.team = data.team === 'red' || data.team === 'blue'
      ? data.team
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
      heroId: bot.heroId,
      isBot: bot.isBot,
      botDifficulty: bot.botDifficulty,
      botProfileId: bot.botProfileId,
      paymentStatus: bot.paymentStatus,
    });
    this.updateMetadata();
    return bot;
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
    const source = hashSeed(Date.now() ^ Math.imul(this.botIdCounter + 1, 0x632be59b));
    const themeIndices = getShuffledThemeIndices(source);

    return Array.from({ length: MAP_VOTE_OPTION_COUNT }, (_, index) => {
      const themeIndex = themeIndices[index % themeIndices.length];
      const seed = createSeedForTheme(themeIndex, source ^ Math.imul(index + 1, 0x85ebca6b));
      const theme = getVoxelMapTheme(seed);
      const preview = createProceduralMapPreview(seed);
      const suffix = MAP_NAME_SUFFIXES[hashSeed(seed ^ index) % MAP_NAME_SUFFIXES.length];

      return {
        id: `map_${index + 1}`,
        seed,
        name: `${preview.name} ${suffix}`,
        themeId: preview.themeId || theme.id,
        themeName: preview.themeName || theme.name,
        topologyId: preview.topologyId,
        preview: preview.preview,
        score: preview.diagnostics.score,
      };
    });
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
    let redCount = 0;
    let blueCount = 0;

    this.state.players.forEach((p) => {
      const team = p.team;
      if (!this.isTeam(team)) {
        throw new Error('Cannot create assignments with unassigned players');
      }

      if (team === 'red') redCount++;
      else blueCount++;

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
      if (!this.isTeam(player.team)) {
        hasUnassigned = true;
      }
    });
    return hasUnassigned;
  }

  private getTeamCountExcluding(team: string, excludedPlayerId: string): number {
    let count = 0;
    this.state.players.forEach((p, id) => {
      if (id !== excludedPlayerId && p.team === team) count++;
    });
    return count;
  }

  private getHumanCount(): number {
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

  private isHost(client: Client): boolean {
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

    const snapshot = await wagerService.createWageredLobby({
      lobbyId: this.state.lobbyId,
      createdByUserId: authContext.userId,
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
  }

  private async handleCreatePaymentIntent(client: Client, walletAddress: string): Promise<void> {
    const authContext = this.playerAuthContexts.get(client.sessionId);
    if (authContext?.kind !== 'authenticated') {
      throw new Error('Sign in with a Solana wallet before paying');
    }
    if (!this.state.wagerEnabled) {
      throw new Error('This lobby does not require payment');
    }

    const intent = await wagerService.createPaymentIntent({
      lobbyId: this.state.lobbyId,
      userId: authContext.userId,
      walletAddress: walletAddress || authContext.walletAddress || '',
      lobbyPlayerId: client.sessionId,
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
      hostId: this.state.hostId,
      status: this.state.status,
      players: this.getPlayersArray(),
      maxPlayers: this.state.maxPlayers,
      maxParticipants: this.state.maxParticipants,
      humanCount: this.getHumanCount(),
      botCount: this.getBotCount(),
      wager: this.getWagerPayload(),
      requiredPlayers: this.isQuickPlayQueue ? QUICK_PLAY_REQUIRED_PLAYERS : undefined,
      ...this.getMatchmakingStatusPayload(),
    });
  }

  private setMatchmakingLocked(locked: boolean): void {
    const operation = locked ? this.lock() : this.unlock();
    operation.catch((error) => {
      console.error(`Failed to ${locked ? 'lock' : 'unlock'} lobby matchmaking:`, error);
    });
  }

  private tryStartQuickPlayMapVote(): void {
    if (!this.isQuickPlayQueue || this.state.status !== 'matchmaking') return;
    if (this.getHumanCount() < QUICK_PLAY_REQUIRED_PLAYERS) return;

    this.beginMapVote();
  }

  private resolveRoomSkillBucket(options: JoinOptions): MatchmakingSkillBucket {
    if (options.matchmakingMode !== true) return DEFAULT_MATCHMAKING_SKILL_BUCKET;

    const ticket = verifyMatchmakingTicket(options.matchmakingTicket);
    return ticket?.targetSkillBucket ?? normalizeSkillBucket(options.skillBucket);
  }

  private isValidMatchmakingTicket(
    ticket: MatchmakingTicketClaims | null,
    authContext: RoomAuthContext
  ): ticket is MatchmakingTicketClaims {
    if (!ticket) return false;
    if (ticket.targetSkillBucket !== this.skillBucket) return false;

    if (authContext.kind === 'authenticated') {
      return ticket.userId === authContext.userId;
    }

    return ticket.userId.startsWith('guest:') || ticket.userId === authContext.userId;
  }

  private resolvePlayerSkillRating(
    authContext: RoomAuthContext,
    ticket: MatchmakingTicketClaims | null
  ): number {
    if (authContext.kind === 'authenticated') {
      return authContext.matchmakingSkillRating;
    }

    return ticket?.skillRating ?? authContext.matchmakingSkillRating;
  }

  private getAverageSkillRating(): number {
    if (this.playerSkillRatings.size === 0) return DEFAULT_MATCHMAKING_RATING;

    let total = 0;
    this.playerSkillRatings.forEach((rating) => {
      total += rating;
    });

    return Math.round(total / this.playerSkillRatings.size);
  }

  private getMatchmakingWaitMs(): number {
    return Math.max(0, Date.now() - (this.state.createdAt || Date.now()));
  }

  private getMatchmakingStatusPayload(): Record<string, unknown> {
    if (!this.isQuickPlayQueue) return {};

    return {
      skillBucket: this.skillBucket,
      skillBucketLabel: getSkillBucketLabel(this.skillBucket),
      averageSkillRating: this.getAverageSkillRating(),
      skillSearchDistance: getAllowedBucketDistance(this.getMatchmakingWaitMs()),
      matchmakingCreatedAt: this.state.createdAt,
    };
  }

  private broadcastMatchmakingStatus(): void {
    if (!this.isQuickPlayQueue) return;
    this.broadcast('matchmakingStatus', this.getMatchmakingStatusPayload());
  }

  private updateMetadata(overrides: Record<string, unknown> = {}): void {
    const humanCount = this.getHumanCount();
    const botCount = this.getBotCount();
    this.setMetadata({
      name: this.state.name,
      isPublic: this.state.isPublic,
      status: this.state.status,
      humanCount,
      botCount,
      participantCount: humanCount + botCount,
      maxParticipants: this.state.maxParticipants,
      maxPlayers: this.state.maxPlayers,
      matchmakingMode: this.isQuickPlayQueue,
      requiredPlayers: this.isQuickPlayQueue ? QUICK_PLAY_REQUIRED_PLAYERS : undefined,
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
