import type { IncomingMessage } from 'http';
import { Room, Client, matchMaker } from 'colyseus';
import { LobbyState, LobbyPlayer } from './schema/LobbyState';
import {
  DEFAULT_GAMEPLAY_MODE,
  DEFAULT_GAME_CONFIG,
  DEFAULT_MATCH_PERSPECTIVE,
  HERO_DEFINITIONS,
  assignTeamByCapacity,
  getGameplayModeCapacityCost,
  getGameplayModeLabel,
  getGameplayModeRules,
  getRankFromRating,
  getTeamIdsForGameplayMode,
  getVoxelMapTheme,
  hashSeed,
  isGameplayMode,
  isMatchMode,
  isMatchPerspective,
  isTeamHeroAvailable,
  isTeamIdForGameplayMode,
  toPublicRankSnapshot,
  type GameplayModeRules,
} from '@voxel-strike/shared';
import type { MatchMode, MatchPerspective, PartyBotLaunchDescriptor } from '@voxel-strike/shared';
import type { BotDifficulty, GameplayMode, HeroId, MapProfileId, Team, VoxelMapSizeId, VoxelMapTheme } from '@voxel-strike/shared';
import { assertUsableEntryTicketSecret } from '../config/security';
import { resolveRoomAuthContext, type RoomAuthContext } from '../auth/session';
import { assertGameplayAccountEligible } from '../auth/accountEligibility';
import { assertTutorialCompleted } from '../auth/tutorialCompletion';
import { createGameEntryTicket, verifyGameEntryTicket } from '../security/entryTickets';
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
} from './lobbyRoster';
import {
  buildLobbyPlayerJoinedPayload,
  buildLobbyStatePayload,
} from './lobbyNetworkPayloads';
import {
  buildMapVoteStartedPayload,
  buildMapVoteUpdatedPayload,
  createMapLaunchSelection,
  createMapVoteOptions,
  getMapVoteRecords,
  getWinningMapOption,
  haveAllHumanPlayersVoted,
  type MapVoteOption,
  type MapVotePlayer,
} from './lobbyMapVoteRuntime';
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

type BotFillMode = 'manual' | 'fill_even';

interface JoinOptions {
  playerName?: string;
  lobbyName?: string;
  isPrivate?: boolean;
  matchmakingMode?: boolean;
  matchMode?: MatchMode;
  gameplayMode?: GameplayMode;
  matchmakingTicket?: string;
  matchPerspective?: MatchPerspective;
  rankBandId?: number;
  rankedEntryQuoteId?: string;
  authToken?: string;
  expectedHumanPlayers?: number;
  expectedHumanUserIds?: string[];
  initialBotCount?: number;
  botFillMode?: BotFillMode;
  defaultBotDifficulty?: BotDifficulty;
  selectedHero?: HeroId;
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

const MAX_PLAYERS_PER_TEAM = DEFAULT_GAME_CONFIG.teamSize;
const PRODUCTION_CUSTOM_MIN_PARTICIPANTS = 2;
const MAP_VOTE_DURATION_MS = 30000;
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

export class LobbyRoom extends Room<LobbyState> {
  maxClients = DEFAULT_GAME_CONFIG.maxPlayers;
  private botIdCounter = 0;
  private mapVoteSession: MapVoteSession | null = null;
  private isFinalizingMapVote = false;
  private mapVoteFinalizeTimeout: ReturnType<typeof setTimeout> | null = null;
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
  private rankBandId = DEFAULT_RANK_DIVISION_INDEX;
  private rankedEntryQuoteId: string | null = null;
  private minimumMatchmakingHumanCount = 1;
  private expectedMatchmakingPartyParticipantCount = 1;
  private expectedMatchmakingUserIds: Set<string> | null = null;
  private matchmakingPartyTeam: Team | null = null;
  private pendingPartyBots: PartyBotLaunchDescriptor[] = [];
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
    this.gameplayMode = this.resolveRoomGameplayMode(options, initialMatchmakingTicket);
    this.matchPerspective = this.resolveRoomMatchPerspective(options, initialMatchmakingTicket);
    this.gameplayRules = getGameplayModeRules(this.gameplayMode);
    this.isQuickPlayQueue = this.matchMode === 'quick_play';
    this.isRankedQueue = this.matchMode === 'ranked';
    this.rankBandId = this.resolveRoomRankBand(options, initialMatchmakingTicket);
    this.rankedEntryQuoteId = this.isRankedQueue ? initialMatchmakingTicket?.rankedEntryQuoteId ?? null : null;

    this.setState(new LobbyState());
    this.state.lobbyId = this.roomId;
    this.state.matchMode = this.matchMode;
    this.state.gameplayMode = this.gameplayMode;
    this.state.matchPerspective = this.matchPerspective;
    this.state.name = options.lobbyName || (this.isQuickPlayQueue ? getGameplayModeLabel(this.gameplayMode) : this.isRankedQueue ? 'Ranked' : `Lobby ${this.roomId.slice(0, 6)}`);
    this.state.maxPlayers = this.maxClients;
    this.state.maxParticipants = this.gameplayRules.maxPlayers;
    this.maxClients = this.state.maxParticipants;
    this.state.maxPlayers = this.maxClients;
    this.minimumMatchmakingHumanCount = this.resolveMinimumMatchmakingHumanCount(options);
    this.expectedMatchmakingUserIds = this.resolveExpectedMatchmakingUserIds(options);
    this.expectedMatchmakingPartyParticipantCount = this.resolveExpectedMatchmakingPartyParticipantCount(options);
    this.state.isPublic = !options.isPrivate && !this.isMatchmakingQueue();
    this.state.createdAt = Date.now();
    this.state.status = this.isMatchmakingQueue() ? 'matchmaking' : 'waiting';
    this.state.defaultBotDifficulty = this.normalizeDifficulty(options.defaultBotDifficulty);
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
      : Math.max(0, Math.min(this.state.maxParticipants - 1, Math.floor(options.initialBotCount || 0)));
    for (let i = 0; i < initialBotCount; i++) {
      const result = this.createBot({ difficulty: this.state.defaultBotDifficulty as BotDifficulty });
      if (!result.ok) break;
    }
    const partyBots = Array.isArray(options.partyBots)
      ? options.partyBots.slice(0, Math.max(0, this.state.maxParticipants - this.getCombatParticipantCount()))
      : [];
    if (this.isMatchmakingQueue() && this.expectedMatchmakingUserIds && partyBots.length > 0) {
      this.pendingPartyBots = partyBots;
    } else {
      for (const partyBot of partyBots) {
        const result = this.createBot({
          difficulty: partyBot.difficulty,
          name: partyBot.displayName,
          heroId: partyBot.heroId,
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

    const requestedGameplayMode = requestedMatchMode === 'ranked'
      ? DEFAULT_GAMEPLAY_MODE
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
    const requestedBotFillMode = requestedMatchMode === 'quick_play' && requestedTicket
      ? requestedTicket.botFillMode
      : this.normalizeBotFillMode(options.botFillMode);
    if (requestedBotFillMode !== this.state.botFillMode) return false;
    if (this.shouldReserveExpectedHumanSlot(this.getRequestedMatchmakingUserId(options))) return false;
    if (this.getCombatParticipantCount() >= this.getMatchmakingRequiredPlayers()) return false;
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

    const player = new LobbyPlayer();
    player.id = client.sessionId;
    player.name = authContext.displayName || `Player${this.state.players.size + 1}`;
    player.isHost = this.getLobbyHumanCount() === 0; // First human player is host
    player.isReady = this.isMatchmakingQueue();
    player.team = this.resolveJoiningPlayerTeam(authContext);
    player.heroId = isHeroId(options.selectedHero) ? options.selectedHero : '';
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
    const maxPerTeam = this.gameplayRules.maxTeamSize;
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

    await this.startMapSelection(client);
  }

  private createMapSelectionSource(): number {
    return hashSeed(Date.now() ^ Math.imul(this.botIdCounter + 1, 0x632be59b));
  }

  private async startMapSelection(errorClient?: Client): Promise<void> {
    if (this.gameplayMode === 'battle_royal') {
      await this.startBattleRoyalMapGeneration(errorClient);
      return;
    }

    this.beginMapVote();
  }

  private async startBattleRoyalMapGeneration(errorClient?: Client): Promise<void> {
    if (this.isFinalizingMapVote || this.state.status === 'starting' || this.state.status === 'in_game') return;

    this.isFinalizingMapVote = true;
    try {
      this.clearMapVoteTimer();
      this.clearCapacityRetry();
      this.setMatchmakingCapacityBlocked(false);
      this.mapVoteSession = null;

      const selection = createMapLaunchSelection({
        gameplayMode: this.gameplayMode,
        source: this.createMapSelectionSource(),
        participantCount: this.getCombatParticipantCount(),
      });
      const selectedMapThemeId = await this.resolveSelectedMapThemeId(selection.seed);

      this.state.status = 'starting';
      this.setMatchmakingLocked(true);
      this.updateMetadata({ status: 'starting' });

      this.broadcast('mapGenerationStarted', {
        mapSeed: selection.seed,
        mapThemeId: selectedMapThemeId,
        mapSize: selection.mapSize,
        mapProfileId: selection.mapProfileId,
        gameplayMode: this.gameplayMode,
      });

      await this.createGameFromLobby(
        selection.seed,
        selectedMapThemeId,
        selection.mapSize,
        selection.mapProfileId
      );
    } catch (error) {
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

  private beginMapVote(): void {
    this.clearMapVoteTimer();
    this.clearCapacityRetry();
    this.setMatchmakingCapacityBlocked(false);
    this.state.status = 'map_vote';
    this.setMatchmakingLocked(true);
    const mapVoteSource = this.createMapSelectionSource();
    this.mapVoteSession = {
      options: createMapVoteOptions({
        gameplayMode: this.gameplayMode,
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
      if (player.isBot) return;
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

    const players: MapVotePlayer[] = [];
    this.state.players.forEach((player, playerId) => {
      players.push({ id: playerId, isBot: player.isBot });
    });

    if (!haveAllHumanPlayersVoted({ players, votes: session.votes })) return;

    this.finalizeMapVote().catch((error) => {
      console.error('Failed to finalize completed map vote:', error);
    });
  }

  private async finalizeMapVote(errorClient?: Client): Promise<void> {
    if (!this.mapVoteSession || this.state.status !== 'map_vote' || this.isFinalizingMapVote) return;

    this.isFinalizingMapVote = true;
    try {
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
        mapProfileId: selectedOption.mapProfileId,
        gameplayMode: this.gameplayMode,
        votes: getMapVoteRecords(this.mapVoteSession.votes),
      });

      await this.createGameFromLobby(selectedOption.seed, selectedMapThemeId, selectedOption.mapSize, selectedOption.mapProfileId);
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
    mapProfileId: MapProfileId
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
    const requiredHumanPlayers = reservedHumanPlayers;
    const capacityPlayerCost = getGameplayModeCapacityCost(this.gameplayMode, reservedHumanPlayers);

    try {
      const rankedEligible = this.isRankedMatchCandidate(playerAssignments);

      const admission = await runWithInGameCapacity({
        matchMaker,
        requestedPlayers: capacityPlayerCost,
        localProcessId: matchMaker.processId,
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
          }),
        };
      }));

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
    const requestedTeam = data.team && this.isTeam(data.team)
      ? data.team
      : null;
    const failureReason = getCreateBotFailureReason({
      botsEnabled: this.gameplayRules.botsEnabled,
      combatParticipantCount: this.getCombatParticipantCount(),
      maxParticipants: this.state.maxParticipants,
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
    bot.isBot = true;
    bot.botDifficulty = this.normalizeDifficulty(data.difficulty);
    bot.botProfileId = profileName.toLowerCase();

    this.state.players.set(bot.id, bot);
    this.broadcast('playerJoined', buildLobbyPlayerJoinedPayload(bot.id, bot));
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
    return getVoxelMapTheme(seed).id;
  }

  private sendMapVoteStarted(client: Client): void {
    if (!this.mapVoteSession) return;
    client.send('mapVoteStarted', buildMapVoteStartedPayload({
      ...this.mapVoteSession,
      gameplayMode: this.gameplayMode,
    }));
  }

  private broadcastMapVoteStarted(): void {
    if (!this.mapVoteSession) return;
    this.broadcast('mapVoteStarted', buildMapVoteStartedPayload({
      ...this.mapVoteSession,
      gameplayMode: this.gameplayMode,
    }));
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
    return assignTeamByCapacity({
      players: this.state.players.values(),
      teamIds: this.getAssignableTeamIds(),
      maxTeamSize: this.gameplayRules.maxTeamSize,
    });
  }

  private resolveJoiningPlayerTeam(authContext: RoomAuthContext): Team | '' {
    if (!this.isMatchmakingQueue()) return '';

    if (this.expectedMatchmakingUserIds?.has(authContext.userId)) {
      if (
        this.matchmakingPartyTeam
        && this.isTeam(this.matchmakingPartyTeam)
        && this.getTeamCount(this.matchmakingPartyTeam) < this.gameplayRules.maxTeamSize
      ) {
        return this.matchmakingPartyTeam;
      }

      const team = this.assignBalancedTeam();
      this.matchmakingPartyTeam = team;
      return team;
    }

    return this.assignBalancedTeam();
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

  private getAssignableTeamIds(): readonly Team[] {
    return getTeamIdsForGameplayMode(this.gameplayMode).slice(0, this.gameplayRules.maxTeams);
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

  private getCombatParticipantCount(): number {
    return countLobbyRoster(this.state.players).combatParticipant;
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

  private getLargestAssignableTeamCount(): number {
    const counts = countLobbyRoster(this.state.players).team;
    return this.getAssignableTeamIds().reduce((largest, teamId) => (
      Math.max(largest, counts[teamId] ?? 0)
    ), 0);
  }

  private isBotFillMatchmakingQueue(): boolean {
    return this.matchMode === 'quick_play'
      && this.state.botFillMode === 'fill_even'
      && this.gameplayRules.botsEnabled;
  }

  private fillMatchmakingBotsToRequiredPlayers(requiredPlayers: number): void {
    if (!this.isBotFillMatchmakingQueue()) return;

    let missingParticipants = Math.max(0, requiredPlayers - this.getCombatParticipantCount());
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
    }

    while (missingParticipants > 0) {
      const result = this.createBot({
        difficulty: this.state.defaultBotDifficulty as BotDifficulty,
      });
      if (!result.ok) break;
      missingParticipants--;
    }

    this.updateMetadata();
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
      && this.matchMode === 'custom';
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
    if (this.matchMode === 'ranked') return 'manual';
    if (this.matchMode === 'quick_play' && ticket) return ticket.botFillMode;
    return this.normalizeBotFillMode(options.botFillMode);
  }

  private normalizeHeroId(heroId?: HeroId | string): HeroId | '' {
    return heroId && HERO_DEFINITIONS[heroId as HeroId] ? (heroId as HeroId) : '';
  }

  private isRankedMatchCandidate(playerAssignments: ParticipantAssignment[]): boolean {
    if (this.matchMode !== 'ranked') return false;
    const requiredPlayers = this.getMatchmakingRequiredPlayers();
    if (this.getCombatParticipantCount() !== requiredPlayers) return false;
    if (playerAssignments.length !== requiredPlayers) return false;

    return playerAssignments.every((assignment) => (
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
    this.fillMatchmakingBotsToRequiredPlayers(requiredPlayers);
    if (this.getCombatParticipantCount() < requiredPlayers) return;

    const capacityAvailable = await this.ensureInGameCapacityAvailableForRoster();
    if (!capacityAvailable || this.state.status !== 'matchmaking') return;

    await this.startMapSelection();
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
    return 'custom';
  }

  private resolveRoomGameplayMode(options: JoinOptions, ticket: MatchmakingTicketClaims | null): GameplayMode {
    if (options.matchmakingMode === true) {
      const requestedMode = ticket?.mode ?? (isMatchMode(options.matchMode) ? options.matchMode : null);
      if (requestedMode === 'ranked') return DEFAULT_GAMEPLAY_MODE;
      if (isGameplayMode(ticket?.gameplayMode)) return ticket.gameplayMode;
      return isGameplayMode(options.gameplayMode) ? options.gameplayMode : DEFAULT_GAMEPLAY_MODE;
    }
    return isGameplayMode(options.gameplayMode) ? options.gameplayMode : DEFAULT_GAMEPLAY_MODE;
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

  private isValidMatchmakingTicket(
    ticket: MatchmakingTicketClaims | null,
    authContext: RoomAuthContext
  ): ticket is MatchmakingTicketClaims {
    if (!ticket) return false;
    if (ticket.mode !== this.matchMode) return false;
    if (ticket.targetRankDivisionIndex !== this.rankBandId) return false;
    if (ticket.gameplayMode !== this.gameplayMode) return false;
    if (ticket.botFillMode !== this.state.botFillMode) return false;
    if (ticket.matchPerspective !== this.matchPerspective) return false;

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
      rankBandId: this.isMatchmakingQueue() ? this.rankBandId : undefined,
      requiredPlayers: this.isMatchmakingQueue() ? this.getMatchmakingRequiredPlayers() : undefined,
      queuedHumanCount: humanCount,
      capacityBlocked: this.isMatchmakingQueue() ? this.matchmakingCapacityBlocked : undefined,
      capacityMaxPlayers: this.isMatchmakingQueue() ? MAX_IN_GAME_PLAYERS : undefined,
      ...this.getMatchmakingStatusPayload(),
      ...overrides,
    });
  }
}
