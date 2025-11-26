import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';

export function Lobby() {
  const { 
    playerName, 
    playerId,
    currentLobbyName, 
    lobbyPlayers, 
    isLobbyHost,
    isLoading,
  } = useGameStore();
  const { leaveLobby, setLobbyReady, setLobbyTeam, startGame, kickPlayer } = useNetwork();
  const [selectedTeam, setSelectedTeam] = useState<string>('');

  const currentPlayer = playerId ? lobbyPlayers.get(playerId) : null;
  const isReady = currentPlayer?.isReady || false;

  const handleToggleReady = () => {
    setLobbyReady(!isReady);
  };

  const handleTeamChange = (team: string) => {
    setSelectedTeam(team);
    setLobbyTeam(team);
  };

  const handleStartGame = () => {
    startGame();
  };

  const handleKick = (playerId: string) => {
    kickPlayer(playerId);
  };

  // Count players and ready status
  const playerList = Array.from(lobbyPlayers.values());
  const readyCount = playerList.filter(p => p.isReady || p.isHost).length;
  const canStart = isLobbyHost && (playerList.length === 1 || readyCount === playerList.length);

  // Separate players by team
  const redTeamPlayers = playerList.filter(p => p.team === 'red');
  const blueTeamPlayers = playerList.filter(p => p.team === 'blue');
  const unassignedPlayers = playerList.filter(p => !p.team);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-voxel-darker via-voxel-dark to-voxel-darker">
        <div className="absolute inset-0 opacity-10">
          <div 
            className="absolute w-full h-full"
            style={{
              backgroundImage: `
                linear-gradient(rgba(0, 255, 136, 0.15) 1px, transparent 1px),
                linear-gradient(90deg, rgba(0, 255, 136, 0.15) 1px, transparent 1px)
              `,
              backgroundSize: '40px 40px',
            }}
          />
        </div>
      </div>

      {/* Header */}
      <div className="relative z-10 mb-6 text-center">
        <h1 
          className="font-display text-4xl font-black tracking-tight text-white"
          style={{ textShadow: '0 0 40px rgba(255, 255, 255, 0.2)' }}
        >
          {currentLobbyName || 'Game Lobby'}
        </h1>
        <p className="font-body text-gray-400 mt-2">
          {isLobbyHost ? 'You are the host • Start when ready' : 'Waiting for host to start the game'}
        </p>
      </div>

      {/* Main content */}
      <div className="relative z-10 w-full max-w-5xl px-8">
        <div className="grid grid-cols-7 gap-6">
          {/* Red Team */}
          <div className="col-span-2">
            <TeamPanel 
              team="red"
              label="RED TEAM"
              players={redTeamPlayers}
              currentPlayerId={playerId}
              isHost={isLobbyHost}
              selectedTeam={selectedTeam}
              onSelectTeam={handleTeamChange}
              onKick={handleKick}
            />
          </div>

          {/* Center - Unassigned & Controls */}
          <div className="col-span-3 space-y-4">
            {/* Unassigned players */}
            {unassignedPlayers.length > 0 && (
              <div className="bg-voxel-surface/80 backdrop-blur-lg border border-voxel-border rounded-lg p-4">
                <h3 className="font-display text-sm text-gray-400 mb-3 tracking-wider">UNASSIGNED</h3>
                <div className="space-y-2">
                  {unassignedPlayers.map(player => (
                    <PlayerRow 
                      key={player.id} 
                      player={player} 
                      isCurrentPlayer={player.id === playerId}
                      isHost={isLobbyHost}
                      onKick={() => handleKick(player.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Team selection */}
            <div className="bg-voxel-surface/80 backdrop-blur-lg border border-voxel-border rounded-lg p-4">
              <h3 className="font-display text-sm text-gray-400 mb-3 tracking-wider">SELECT TEAM</h3>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleTeamChange('red')}
                  className={`py-3 rounded font-display transition-all duration-200
                    ${currentPlayer?.team === 'red' 
                      ? 'bg-red-500 text-white' 
                      : 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/50'
                    }`}
                >
                  RED
                </button>
                <button
                  onClick={() => handleTeamChange('')}
                  className={`py-3 rounded font-display transition-all duration-200
                    ${!currentPlayer?.team
                      ? 'bg-gray-500 text-white' 
                      : 'bg-gray-500/20 text-gray-400 hover:bg-gray-500/30 border border-gray-500/50'
                    }`}
                >
                  AUTO
                </button>
                <button
                  onClick={() => handleTeamChange('blue')}
                  className={`py-3 rounded font-display transition-all duration-200
                    ${currentPlayer?.team === 'blue' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/50'
                    }`}
                >
                  BLUE
                </button>
              </div>
            </div>

            {/* Ready / Start controls */}
            <div className="bg-voxel-surface/80 backdrop-blur-lg border border-voxel-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <span className="font-body text-gray-400">
                  {readyCount}/{playerList.length} players ready
                </span>
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${readyCount === playerList.length ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  <span className="font-display text-sm text-gray-400">
                    {readyCount === playerList.length ? 'ALL READY' : 'WAITING'}
                  </span>
                </div>
              </div>

              <div className="flex gap-3">
                {!isLobbyHost && (
                  <button
                    onClick={handleToggleReady}
                    className={`flex-1 py-3 font-display text-lg font-bold rounded transition-all duration-200
                      ${isReady
                        ? 'bg-green-500 text-white hover:bg-green-600'
                        : 'bg-voxel-primary text-voxel-dark hover:bg-voxel-primary/90'
                      }`}
                  >
                    {isReady ? '✓ READY' : 'READY UP'}
                  </button>
                )}
                
                {isLobbyHost && (
                  <button
                    onClick={handleStartGame}
                    disabled={!canStart || isLoading}
                    className="flex-1 py-3 bg-voxel-accent text-white font-display text-lg font-bold
                             rounded transition-all duration-200
                             hover:bg-voxel-accent/90 hover:shadow-lg hover:shadow-voxel-accent/30
                             disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        STARTING...
                      </span>
                    ) : (
                      'START GAME'
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Leave button */}
            <button
              onClick={leaveLobby}
              className="w-full py-3 bg-voxel-dark border border-red-500/50 rounded
                       font-display text-red-400
                       hover:bg-red-500/20 hover:border-red-500
                       transition-all duration-200"
            >
              LEAVE LOBBY
            </button>
          </div>

          {/* Blue Team */}
          <div className="col-span-2">
            <TeamPanel 
              team="blue"
              label="BLUE TEAM"
              players={blueTeamPlayers}
              currentPlayerId={playerId}
              isHost={isLobbyHost}
              selectedTeam={selectedTeam}
              onSelectTeam={handleTeamChange}
              onKick={handleKick}
            />
          </div>
        </div>
      </div>

      {/* Player info */}
      <div className="absolute bottom-4 left-4 z-10">
        <div className="px-4 py-2 bg-voxel-surface/60 backdrop-blur border border-voxel-border rounded">
          <span className="font-body text-gray-400 text-sm">Playing as </span>
          <span className="font-display text-voxel-primary">{playerName}</span>
          {isLobbyHost && (
            <span className="ml-2 px-2 py-0.5 bg-voxel-accent/20 border border-voxel-accent/50 rounded text-voxel-accent text-xs font-display">
              HOST
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface TeamPanelProps {
  team: 'red' | 'blue';
  label: string;
  players: { id: string; name: string; isHost: boolean; isReady: boolean; team: string }[];
  currentPlayerId: string | null;
  isHost: boolean;
  selectedTeam: string;
  onSelectTeam: (team: string) => void;
  onKick: (playerId: string) => void;
}

function TeamPanel({ team, label, players, currentPlayerId, isHost, onKick }: TeamPanelProps) {
  const teamColor = team === 'red' ? 'red' : 'blue';
  const bgClass = team === 'red' ? 'bg-red-500/10 border-red-500/30' : 'bg-blue-500/10 border-blue-500/30';
  const headerClass = team === 'red' ? 'text-red-400' : 'text-blue-400';

  return (
    <div className={`h-full bg-voxel-surface/80 backdrop-blur-lg border rounded-lg overflow-hidden ${bgClass}`}>
      <div className={`p-4 border-b border-voxel-border ${team === 'red' ? 'border-red-500/30' : 'border-blue-500/30'}`}>
        <h2 className={`font-display text-lg ${headerClass}`}>{label}</h2>
        <p className="font-mono text-xs text-gray-500">{players.length}/5 players</p>
      </div>
      
      <div className="p-4 space-y-2 min-h-[200px]">
        {players.length === 0 ? (
          <div className="text-center py-8">
            <p className="font-body text-gray-600 text-sm">No players</p>
          </div>
        ) : (
          players.map(player => (
            <PlayerRow 
              key={player.id} 
              player={player} 
              isCurrentPlayer={player.id === currentPlayerId}
              isHost={isHost}
              onKick={() => onKick(player.id)}
              teamColor={teamColor}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface PlayerRowProps {
  player: { id: string; name: string; isHost: boolean; isReady: boolean; team: string };
  isCurrentPlayer: boolean;
  isHost: boolean;
  onKick: () => void;
  teamColor?: string;
}

function PlayerRow({ player, isCurrentPlayer, isHost, onKick, teamColor }: PlayerRowProps) {
  return (
    <div className={`flex items-center justify-between p-2 rounded bg-voxel-dark/50 ${isCurrentPlayer ? 'ring-1 ring-voxel-primary' : ''}`}>
      <div className="flex items-center gap-2 min-w-0">
        <div className={`w-2 h-2 rounded-full ${player.isReady || player.isHost ? 'bg-green-500' : 'bg-gray-500'}`} />
        <span className={`font-display text-sm truncate ${isCurrentPlayer ? 'text-voxel-primary' : 'text-white'}`}>
          {player.name}
        </span>
        {player.isHost && (
          <span className="px-1.5 py-0.5 bg-voxel-accent/20 border border-voxel-accent/50 rounded text-voxel-accent text-xs font-display">
            HOST
          </span>
        )}
      </div>
      
      {isHost && !isCurrentPlayer && !player.isHost && (
        <button
          onClick={onKick}
          className="p-1 text-gray-500 hover:text-red-400 transition-colors"
          title="Kick player"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

