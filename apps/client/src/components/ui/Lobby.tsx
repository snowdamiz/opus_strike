import { useState, useEffect } from 'react';
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
  const [pulseReady, setPulseReady] = useState(false);

  const currentPlayer = playerId ? lobbyPlayers.get(playerId) : null;
  const isReady = currentPlayer?.isReady || false;

  useEffect(() => {
    const playerList = Array.from(lobbyPlayers.values());
    const allReady = playerList.length > 1 && playerList.every(p => p.isReady || p.isHost);
    setPulseReady(allReady);
  }, [lobbyPlayers]);

  const handleToggleReady = () => setLobbyReady(!isReady);
  const handleTeamChange = (team: string) => setLobbyTeam(team);
  const handleStartGame = () => startGame();
  const handleKick = (playerId: string) => kickPlayer(playerId);

  const playerList = Array.from(lobbyPlayers.values());
  const readyCount = playerList.filter(p => p.isReady || p.isHost).length;
  const canStart = isLobbyHost && (playerList.length === 1 || readyCount === playerList.length);

  const redTeamPlayers = playerList.filter(p => p.team === 'red');
  const blueTeamPlayers = playerList.filter(p => p.team === 'blue');
  const unassignedPlayers = playerList.filter(p => !p.team);

  return (
    <div className="w-full h-full flex flex-col bg-[#08080c]">
      {/* Header */}
      <div className="flex items-center justify-center gap-4 py-6 border-b border-white/5">
        <div className={`w-2 h-2 rounded-full ${pulseReady ? 'bg-green-400 animate-pulse' : 'bg-orange-400'}`} />
        <h1 className="font-display text-2xl text-white">{currentLobbyName || 'Game Lobby'}</h1>
        {isLobbyHost && (
          <span className="px-2 py-0.5 bg-orange-500/20 text-orange-400 text-xs font-display rounded">HOST</span>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-stretch p-6 gap-6 overflow-hidden">
        {/* Red Team */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded bg-red-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
              </svg>
            </div>
            <h2 className="font-display text-xl text-red-400">RED TEAM</h2>
            <span className="text-white/30 text-sm font-mono">{redTeamPlayers.length}/5</span>
          </div>
          
          <div className="flex-1 rounded-lg border border-red-500/20 bg-red-500/5 overflow-hidden">
            <div className="p-3 space-y-2 h-full overflow-y-auto">
              {redTeamPlayers.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-8">
                  <div className="w-12 h-12 rounded-lg bg-red-500/10 flex items-center justify-center mb-3">
                    <svg className="w-6 h-6 text-red-400/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                  </div>
                  <p className="text-red-400/50 font-body text-sm">Waiting for players</p>
                </div>
              ) : (
                redTeamPlayers.map((player) => (
                  <PlayerCard 
                    key={player.id} 
                    player={player} 
                    isCurrentPlayer={player.id === playerId}
                    isHost={isLobbyHost}
                    onKick={() => handleKick(player.id)}
                    teamColor="red"
                  />
                ))
              )}
              {/* Empty slots */}
              {[...Array(Math.max(0, 5 - redTeamPlayers.length))].map((_, i) => (
                <div key={i} className="h-12 rounded border border-dashed border-red-500/10 flex items-center justify-center">
                  <span className="text-[10px] text-red-400/20 font-body uppercase">Empty</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Center Controls */}
        <div className="w-72 flex flex-col items-center justify-center gap-4">
          {/* VS Badge */}
          <div className={`w-16 h-16 rounded-xl rotate-45 flex items-center justify-center border transition-all ${
            pulseReady ? 'bg-green-500/20 border-green-500/30' : 'bg-white/5 border-white/10'
          }`}>
            <span className="font-display text-xl text-white -rotate-45">VS</span>
          </div>

          {/* Team Selection */}
          <div className="w-full bg-[#0c0c10] rounded-lg p-4 border border-white/5">
            <p className="text-[10px] text-white/40 font-body uppercase tracking-wider text-center mb-3">Select Team</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleTeamChange('red')}
                className={`flex-1 py-2.5 rounded font-display text-sm transition-all ${
                  currentPlayer?.team === 'red' 
                    ? 'bg-red-500 text-white' 
                    : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                }`}
              >
                RED
              </button>
              <button
                onClick={() => handleTeamChange('')}
                className={`flex-1 py-2.5 rounded font-display text-sm transition-all ${
                  !currentPlayer?.team
                    ? 'bg-white/20 text-white' 
                    : 'bg-white/5 text-white/50 hover:bg-white/10'
                }`}
              >
                AUTO
              </button>
              <button
                onClick={() => handleTeamChange('blue')}
                className={`flex-1 py-2.5 rounded font-display text-sm transition-all ${
                  currentPlayer?.team === 'blue' 
                    ? 'bg-blue-500 text-white' 
                    : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
                }`}
              >
                BLUE
              </button>
            </div>
          </div>

          {/* Ready Status */}
          <div className="w-full bg-[#0c0c10] rounded-lg p-4 border border-white/5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-white/60 font-body text-sm">
                {readyCount}/{playerList.length} Ready
              </span>
              <div className="flex gap-1">
                {playerList.map((p, i) => (
                  <div 
                    key={i}
                    className={`w-2 h-2 rounded-full ${p.isReady || p.isHost ? 'bg-green-400' : 'bg-white/20'}`}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {!isLobbyHost && (
                <button
                  onClick={handleToggleReady}
                  className={`w-full py-3 rounded-lg font-display text-base transition-all ${
                    isReady
                      ? 'bg-green-500 text-white'
                      : 'bg-orange-500 text-white hover:bg-orange-400'
                  }`}
                >
                  {isReady ? '✓ READY' : 'READY UP'}
                </button>
              )}
              
              {isLobbyHost && (
                <button
                  onClick={handleStartGame}
                  disabled={!canStart || isLoading}
                  className={`w-full py-3 rounded-lg font-display text-base transition-all ${
                    canStart 
                      ? 'bg-green-500 text-white hover:bg-green-400' 
                      : 'bg-white/10 text-white/30 cursor-not-allowed'
                  }`}
                >
                  {isLoading ? 'STARTING...' : 'START GAME'}
                </button>
              )}

              <button
                onClick={leaveLobby}
                className="w-full py-2.5 bg-transparent border border-red-500/30 rounded-lg font-display text-sm text-red-400 hover:bg-red-500/10 transition-all"
              >
                LEAVE
              </button>
            </div>
          </div>

          {/* Unassigned */}
          {unassignedPlayers.length > 0 && (
            <div className="w-full bg-[#0c0c10] rounded-lg p-3 border border-white/5">
              <p className="text-[10px] text-white/40 font-body uppercase tracking-wider mb-2">Unassigned</p>
              <div className="space-y-1.5">
                {unassignedPlayers.map(player => (
                  <PlayerCard 
                    key={player.id} 
                    player={player} 
                    isCurrentPlayer={player.id === playerId}
                    isHost={isLobbyHost}
                    onKick={() => handleKick(player.id)}
                    compact
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Blue Team */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-end gap-3 mb-4">
            <span className="text-white/30 text-sm font-mono">{blueTeamPlayers.length}/5</span>
            <h2 className="font-display text-xl text-blue-400">BLUE TEAM</h2>
            <div className="w-8 h-8 rounded bg-blue-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
              </svg>
            </div>
          </div>
          
          <div className="flex-1 rounded-lg border border-blue-500/20 bg-blue-500/5 overflow-hidden">
            <div className="p-3 space-y-2 h-full overflow-y-auto">
              {blueTeamPlayers.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-8">
                  <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center mb-3">
                    <svg className="w-6 h-6 text-blue-400/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                  </div>
                  <p className="text-blue-400/50 font-body text-sm">Waiting for players</p>
                </div>
              ) : (
                blueTeamPlayers.map((player) => (
                  <PlayerCard 
                    key={player.id} 
                    player={player} 
                    isCurrentPlayer={player.id === playerId}
                    isHost={isLobbyHost}
                    onKick={() => handleKick(player.id)}
                    teamColor="blue"
                  />
                ))
              )}
              {/* Empty slots */}
              {[...Array(Math.max(0, 5 - blueTeamPlayers.length))].map((_, i) => (
                <div key={i} className="h-12 rounded border border-dashed border-blue-500/10 flex items-center justify-center">
                  <span className="text-[10px] text-blue-400/20 font-body uppercase">Empty</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-white/5">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded flex items-center justify-center font-display ${
            currentPlayer?.team === 'red' ? 'bg-red-500/20 text-red-400' :
            currentPlayer?.team === 'blue' ? 'bg-blue-500/20 text-blue-400' :
            'bg-white/10 text-white'
          }`}>
            {playerName.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-[10px] text-white/40 font-body uppercase">Playing as</p>
            <p className={`font-display text-sm ${
              currentPlayer?.team === 'red' ? 'text-red-400' :
              currentPlayer?.team === 'blue' ? 'text-blue-400' :
              'text-white'
            }`}>{playerName}</p>
          </div>
        </div>
        
        <p className="text-white/30 text-xs font-body">
          {isLobbyHost ? 'Start when everyone is ready' : 'Waiting for host to start'}
        </p>
      </div>
    </div>
  );
}

interface PlayerCardProps {
  player: { id: string; name: string; isHost: boolean; isReady: boolean; team: string };
  isCurrentPlayer: boolean;
  isHost: boolean;
  onKick: () => void;
  teamColor?: 'red' | 'blue';
  compact?: boolean;
}

function PlayerCard({ player, isCurrentPlayer, isHost, onKick, teamColor, compact }: PlayerCardProps) {
  const bgColor = teamColor === 'red' ? 'bg-red-500/10' : teamColor === 'blue' ? 'bg-blue-500/10' : 'bg-white/5';
  const textColor = teamColor === 'red' ? 'text-red-300' : teamColor === 'blue' ? 'text-blue-300' : 'text-white';

  return (
    <div className={`flex items-center gap-2 ${compact ? 'p-2' : 'p-3'} rounded-lg ${bgColor} ${isCurrentPlayer ? 'ring-1 ring-white/20' : ''}`}>
      <div className={`${compact ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm'} rounded flex items-center justify-center font-display ${bgColor} ${textColor}`}>
        {player.name.charAt(0).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`font-body ${compact ? 'text-xs' : 'text-sm'} truncate ${isCurrentPlayer ? 'text-white' : 'text-white/70'}`}>
            {player.name}
          </span>
          {player.isHost && (
            <span className="px-1 py-0.5 bg-orange-500/20 text-orange-400 text-[8px] font-display rounded">HOST</span>
          )}
          {isCurrentPlayer && (
            <span className="px-1 py-0.5 bg-cyan-500/20 text-cyan-400 text-[8px] font-display rounded">YOU</span>
          )}
        </div>
      </div>

      <div className={`${compact ? 'w-5 h-5' : 'w-6 h-6'} rounded flex items-center justify-center ${
        player.isReady || player.isHost ? 'bg-green-500/20' : 'bg-white/10'
      }`}>
        {player.isReady || player.isHost ? (
          <svg className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-green-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <div className="w-1.5 h-1.5 bg-white/30 rounded-full" />
        )}
      </div>

      {isHost && !isCurrentPlayer && !player.isHost && (
        <button
          onClick={onKick}
          className={`${compact ? 'w-5 h-5' : 'w-6 h-6'} rounded flex items-center justify-center bg-red-500/10 text-red-400/60 hover:text-red-400 hover:bg-red-500/20 transition-all`}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
