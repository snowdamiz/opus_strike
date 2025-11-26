import { Room, Client, matchMaker } from 'colyseus';
import { LobbyState, LobbyPlayer } from './schema/LobbyState';

interface JoinOptions {
  playerName?: string;
  lobbyName?: string;
  isPrivate?: boolean;
}

export class LobbyRoom extends Room<LobbyState> {
  maxClients = 10;
  autoDispose = true;

  onCreate(options: JoinOptions) {
    console.log('Lobby room created:', this.roomId);

    this.setState(new LobbyState());
    this.state.lobbyId = this.roomId;
    this.state.name = options.lobbyName || `Lobby ${this.roomId.slice(0, 6)}`;
    this.state.isPublic = !options.isPrivate;
    this.state.createdAt = Date.now();
    this.state.status = 'waiting';

    // Set metadata for lobby listing
    this.setMetadata({
      name: this.state.name,
      isPublic: this.state.isPublic,
      status: this.state.status,
    });

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

    this.onMessage('chat', (client, data: { message: string }) => {
      this.handleChat(client, data.message);
    });
  }

  onJoin(client: Client, options: JoinOptions) {
    console.log('Player joined lobby:', client.sessionId, options.playerName);

    const player = new LobbyPlayer();
    player.id = client.sessionId;
    player.name = options.playerName || `Player${this.state.players.size + 1}`;
    player.isHost = this.state.players.size === 0; // First player is host
    player.isReady = false;
    player.team = '';

    if (player.isHost) {
      this.state.hostId = client.sessionId;
    }

    this.state.players.set(client.sessionId, player);

    // Notify all players
    this.broadcast('playerJoined', {
      playerId: client.sessionId,
      playerName: player.name,
      isHost: player.isHost,
    });

    // Send current lobby state to the new player
    client.send('lobbyState', {
      lobbyId: this.state.lobbyId,
      name: this.state.name,
      hostId: this.state.hostId,
      status: this.state.status,
      players: this.getPlayersArray(),
    });
  }

  onLeave(client: Client, consented: boolean) {
    console.log('Player left lobby:', client.sessionId);

    const player = this.state.players.get(client.sessionId);
    const wasHost = player?.isHost;

    this.state.players.delete(client.sessionId);

    // If host left, assign new host
    if (wasHost && this.state.players.size > 0) {
      const newHost = this.state.players.values().next().value;
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
  }

  private handleSetTeam(client: Client, team: string) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (team !== 'red' && team !== 'blue' && team !== '') return;

    // Check team balance
    if (team) {
      const teamCount = this.getTeamCount(team);
      const maxPerTeam = Math.ceil(this.state.maxPlayers / 2);
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
  }

  private async handleStartGame(client: Client) {
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

    this.state.status = 'starting';
    this.setMetadata({ ...this.metadata, status: 'starting' });

    try {
      // Create the game room
      const gameRoom = await matchMaker.createRoom('game_room', {
        lobbyId: this.state.lobbyId,
        lobbyName: this.state.name,
      });

      this.state.gameRoomId = gameRoom.roomId;
      this.state.status = 'in_game';

      // Collect player info with team assignments
      const playerAssignments: { playerId: string; playerName: string; team: string }[] = [];
      let redCount = 0;
      let blueCount = 0;

      this.state.players.forEach((p) => {
        let team = p.team;
        if (!team) {
          // Auto-assign to smaller team
          team = redCount <= blueCount ? 'red' : 'blue';
        }
        if (team === 'red') redCount++;
        else blueCount++;
        
        playerAssignments.push({
          playerId: p.id,
          playerName: p.name,
          team,
        });
      });

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
      this.setMetadata({ ...this.metadata, status: 'waiting' });
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
}

