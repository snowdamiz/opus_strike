import { Room, Client, matchMaker } from 'colyseus';
import { LobbyState, LobbyPlayer } from './schema/LobbyState';
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

const MAX_PARTICIPANTS = 10;
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

export class LobbyRoom extends Room<LobbyState> {
  maxClients = 10;
  private botIdCounter = 0;
  
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
        this.sessionIdToClientId.delete(existingSessionId);
        
        // Broadcast that old player left
        this.broadcast('playerLeft', { playerId: existingSessionId });
        
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
    this.updateMetadata();
  }

  onLeave(client: Client, consented: boolean) {
    console.log('Player left lobby:', client.sessionId, 'consented:', consented);

    const player = this.state.players.get(client.sessionId);
    const wasHost = player?.isHost;

    this.state.players.delete(client.sessionId);
    
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
    this.updateMetadata();
  }

  onDispose() {
    console.log('Lobby room disposing:', this.roomId);
  }

  private handleReady(client: Client, ready: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

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

    if (team !== 'red' && team !== 'blue' && team !== '') return;

    // Check team balance
    if (team) {
      const teamCount = this.getTeamCountExcluding(team, client.sessionId);
      const maxPerTeam = Math.ceil(this.state.maxParticipants / 2);
      if (teamCount >= maxPerTeam) {
        client.send('error', { message: 'Team is full' });
        return;
      }
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

    // Set status to 'starting' IMMEDIATELY to prevent race conditions
    this.state.status = 'starting';
    this.updateMetadata({ status: 'starting' });
    console.log('[LobbyRoom] Starting game, status set to starting');

    try {
      const playerAssignments = this.createPlayerAssignments();

      // Create the game room
      const gameRoom = await matchMaker.createRoom('game_room', {
        lobbyId: this.state.lobbyId,
        lobbyName: this.state.name,
        botAssignments: playerAssignments.filter((assignment) => assignment.isBot),
      });

      this.state.gameRoomId = gameRoom.roomId;
      this.state.status = 'in_game';
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

    } catch (error) {
      console.error('Failed to create game room:', error);
      this.state.status = 'waiting';
      this.updateMetadata({ status: 'waiting' });
      client.send('error', { message: 'Failed to start game' });
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
    if (team !== 'red' && team !== 'blue' && team !== '') return;

    const bot = this.state.players.get(botId);
    if (!bot?.isBot) return;

    if (team) {
      const teamCount = this.getTeamCountExcluding(team, botId);
      const maxPerTeam = Math.ceil(this.state.maxParticipants / 2);
      if (teamCount >= maxPerTeam) {
        client.send('error', { message: 'Team is full' });
        return;
      }
    }

    bot.team = team;
    this.broadcast('playerTeamChanged', { playerId: botId, team });
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
    this.broadcast('playerLeft', { playerId: botId, isBot: true });
    this.updateMetadata();
  }

  private createPlayerAssignments(): ParticipantAssignment[] {
    const assignments: ParticipantAssignment[] = [];
    let redCount = 0;
    let blueCount = 0;

    this.state.players.forEach((p) => {
      let team = p.team as Team | '';
      if (!team) {
        team = redCount <= blueCount ? 'red' : 'blue';
        p.team = team;
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
