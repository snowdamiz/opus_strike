import { Room, Client, matchMaker } from 'colyseus';
import { LobbyState, LobbyPlayer } from './schema/LobbyState';
import { DEFAULT_GAME_CONFIG, createRandomSeed, getVoxelMapTheme, hashSeed, VOXEL_MAP_THEMES } from '@voxel-strike/shared';
import type { BotDifficulty, Team } from '@voxel-strike/shared';

interface JoinOptions {
  playerName?: string;
  lobbyName?: string;
  isPrivate?: boolean;
  clientId?: string; // Persistent client ID for reconnection detection
  initialBotCount?: number;
  botFillMode?: 'manual' | 'fill_even' | 'fill_empty';
  defaultBotDifficulty?: BotDifficulty;
}

interface ParticipantAssignment {
  playerId: string;
  playerName: string;
  team: Team;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
  botProfileId?: string;
}

interface MapVoteOption {
  id: string;
  seed: number;
  name: string;
  themeId: string;
  themeName: string;
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
  
  // Track clientId -> sessionId mapping for reconnection detection
  private clientIdToSessionId: Map<string, string> = new Map();
  private sessionIdToClientId: Map<string, string> = new Map();

  onCreate(options: JoinOptions) {
    this.autoDispose = true;
    console.log('Lobby room created:', this.roomId);

    this.setState(new LobbyState());
    this.state.lobbyId = this.roomId;
    this.state.name = options.lobbyName || `Lobby ${this.roomId.slice(0, 6)}`;
    this.state.maxPlayers = this.maxClients;
    this.state.maxParticipants = MAX_PARTICIPANTS;
    this.state.isPublic = !options.isPrivate;
    this.state.createdAt = Date.now();
    this.state.status = 'waiting';
    this.state.defaultBotDifficulty = this.normalizeDifficulty(options.defaultBotDifficulty);
    this.state.botFillMode = options.botFillMode || 'manual';

    // Set metadata for lobby listing
    this.updateMetadata();

    // Handle messages
    this.onMessage('ready', (client, data: { ready: boolean }) => {
      this.handleReady(client, data.ready);
    });

    this.onMessage('setTeam', (client, data: { team: string }) => {
      this.handleSetTeam(client, data.team);
    });

    this.onMessage('startGame', (client) => {
      this.handleStartGame(client);
    });

    this.onMessage('voteMap', (client, data: { optionId: string }) => {
      this.handleMapVote(client, data.optionId);
    });

    this.onMessage('mapVotePreviewsReady', (client) => {
      this.handleMapVotePreviewsReady(client);
    });

    this.onMessage('finalizeMapVote', (client) => {
      this.handleFinalizeMapVote(client);
    });

    this.onMessage('kick', (client, data: { playerId: string }) => {
      this.handleKick(client, data.playerId);
    });

    this.onMessage('addBot', (client, data: { difficulty?: BotDifficulty; team?: string; name?: string } = {}) => {
      this.handleAddBot(client, data);
    });

    this.onMessage('removeBot', (client, data: { botId: string }) => {
      this.handleRemoveBot(client, data.botId);
    });

    this.onMessage('updateBotTeam', (client, data: { botId: string; team: string }) => {
      this.handleUpdateBotTeam(client, data.botId, data.team);
    });

    this.onMessage('updateBotDifficulty', (client, data: { botId: string; difficulty: BotDifficulty }) => {
      this.handleUpdateBotDifficulty(client, data.botId, data.difficulty);
    });

    this.onMessage('chat', (client, data: { message: string }) => {
      this.handleChat(client, data.message);
    });

    const initialBotCount = Math.max(0, Math.min(MAX_PARTICIPANTS - 1, Math.floor(options.initialBotCount || 0)));
    for (let i = 0; i < initialBotCount; i++) {
      this.createBot({ difficulty: this.state.defaultBotDifficulty as BotDifficulty });
    }
    this.updateMetadata();
  }

  onJoin(client: Client, options: JoinOptions) {
    console.log(`[LobbyRoom] Player joining: sessionId=${client.sessionId}, name=${options.playerName}, clientId=${options.clientId}`);
    console.log(`[LobbyRoom] Current players in lobby: ${this.state.players.size}, clientId map size: ${this.clientIdToSessionId.size}`);

    // Handle reconnection: if same clientId exists, kick the old session
    if (options.clientId) {
      const existingSessionId = this.clientIdToSessionId.get(options.clientId);
      console.log(`[LobbyRoom] Checking for existing session with clientId ${options.clientId}: found=${existingSessionId}`);
      
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
        
        // Broadcast that old player left
        this.broadcast('playerLeft', { playerId: existingSessionId });
        if (removedOldVote) {
          this.broadcastMapVoteUpdated();
        }
        
        // If old player was host, we'll assign new host below when creating this player
      }
      
      // Register this client's ID mapping
      this.clientIdToSessionId.set(options.clientId, client.sessionId);
      this.sessionIdToClientId.set(client.sessionId, options.clientId);
    }

    if (this.state.players.size >= this.state.maxParticipants) {
      client.send('error', { message: 'Lobby is full' });
      client.leave();
      return;
    }

    const player = new LobbyPlayer();
    player.id = client.sessionId;
    player.name = options.playerName || `Player${this.state.players.size + 1}`;
    player.isHost = this.getHumanCount() === 0; // First human player is host
    player.isReady = false;
    player.team = '';
    player.heroId = '';
    player.isBot = false;
    player.botDifficulty = '';
    player.botProfileId = '';

    if (player.isHost) {
      this.state.hostId = client.sessionId;
    }

    this.state.players.set(client.sessionId, player);

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
    });

    if (this.state.status === 'map_vote' && this.mapVoteSession) {
      this.sendMapVoteStarted(client);
    }
    this.updateMetadata();
  }

  onLeave(client: Client, consented: boolean) {
    console.log('Player left lobby:', client.sessionId, 'consented:', consented);

    const player = this.state.players.get(client.sessionId);
    const wasHost = player?.isHost;

    this.state.players.delete(client.sessionId);
    const removedVote = this.mapVoteSession?.votes.delete(client.sessionId) ?? false;
    this.mapVoteSession?.previewReadyPlayerIds.delete(client.sessionId);
    
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
    if (removedVote) {
      this.broadcastMapVoteUpdated();
    }
    this.startMapVoteCountdownIfReady();
    this.updateMetadata();
  }

  onDispose() {
    console.log('Lobby room disposing:', this.roomId);
    this.clearMapVoteTimer();
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

    this.beginMapVote();
  }

  private beginMapVote(): void {
    this.clearMapVoteTimer();
    this.state.status = 'map_vote';
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
      this.state.status = 'waiting';
      this.mapVoteSession = null;
      this.updateMetadata({ status: 'waiting' });
      this.broadcast('mapVoteCancelled', { reason: 'Failed to start game' });
      this.broadcastLobbyState();
      errorClient?.send('error', { message: 'Failed to start game' });
    }
  }

  private async createGameFromLobby(mapSeed: number): Promise<void> {
    const playerAssignments = this.createPlayerAssignments();

    // Create the game room
    const gameRoom = await matchMaker.createRoom('game_room', {
      lobbyId: this.state.lobbyId,
      lobbyName: this.state.name,
      mapSeed,
      botAssignments: playerAssignments.filter((assignment) => assignment.isBot),
    });

    this.state.gameRoomId = gameRoom.roomId;
    this.state.status = 'in_game';
    this.mapVoteSession = null;
    this.updateMetadata({ status: 'in_game' });

    // Tell all clients to join the game room
    this.broadcast('gameStarting', {
      gameRoomId: gameRoom.roomId,
      players: playerAssignments,
    });

    console.log('Game room created:', gameRoom.roomId, 'from lobby:', this.roomId);

    // Dispose this lobby after a short delay
    setTimeout(() => {
      this.disconnect();
    }, 5000);
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
    data: { difficulty?: BotDifficulty; team?: string; name?: string }
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

  private createBot(data: { difficulty?: BotDifficulty; team?: string; name?: string }): LobbyPlayer | null {
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
    bot.heroId = '';
    bot.isBot = true;
    bot.botDifficulty = this.normalizeDifficulty(data.difficulty);
    bot.botProfileId = profileName.toLowerCase();

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
      const suffix = MAP_NAME_SUFFIXES[hashSeed(seed ^ index) % MAP_NAME_SUFFIXES.length];

      return {
        id: `map_${index + 1}`,
        seed,
        name: `${theme.name} ${suffix}`,
        themeId: theme.id,
        themeName: theme.name,
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
    });
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
      ...overrides,
    });
  }
}
