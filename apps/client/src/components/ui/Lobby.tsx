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
    <div className="w-full h-full flex flex-col relative overflow-hidden">
      {/* Background with pan animation */}
      <div className="absolute inset-0">
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat blur-[3px] animate-bg-pan"
          style={{ backgroundImage: 'url(/bg.jpg)' }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a12]/85 via-[#0f0f1a]/80 to-[#08080c]/95" />
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{ boxShadow: 'inset 0 0 200px 100px rgba(0,0,0,0.8)' }}
        />
      </div>

      {/* Header */}
      <div className="relative z-10 flex items-center justify-center gap-4 py-6">
        <div className={`w-3 h-3 rounded-full ${pulseReady ? 'bg-green-400 animate-pulse shadow-lg shadow-green-400/50' : 'bg-orange-400 shadow-lg shadow-orange-400/30'}`} />
        <h1 className="font-display text-3xl text-white drop-shadow-lg tracking-wide">{currentLobbyName || 'Game Lobby'}</h1>
        {isLobbyHost && (
          <span className="px-3 py-1 bg-gradient-to-r from-orange-500/30 to-amber-500/20 text-orange-300 text-xs font-display rounded-full border border-orange-500/30 shadow-lg shadow-orange-500/10">
            HOST
          </span>
        )}
      </div>

      {/* Main Content */}
      <div className="relative z-10 flex-1 flex items-stretch px-8 pb-6 gap-6 overflow-hidden">
        {/* Red Team Panel */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center shadow-lg shadow-red-500/30">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
              </svg>
            </div>
            <h2 className="font-display text-2xl text-red-400 drop-shadow-md">RED TEAM</h2>
            <span className="ml-auto text-white/50 text-sm font-mono bg-red-500/10 px-2 py-1 rounded-lg">{redTeamPlayers.length}/5</span>
          </div>
          
          <div 
            className="flex-1 rounded-2xl overflow-hidden backdrop-blur-md"
            style={{
              background: 'linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(15,15,26,0.9) 100%)',
              border: '1px solid rgba(239,68,68,0.25)',
              boxShadow: '0 8px 32px rgba(239,68,68,0.15), inset 0 1px 0 rgba(255,255,255,0.05)'
            }}
          >
            <div className="p-4 space-y-3 h-full overflow-y-auto">
              {redTeamPlayers.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-8">
                  <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4 border border-red-500/20">
                    <svg className="w-8 h-8 text-red-400/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                  </div>
                  <p className="text-red-400/60 font-body text-sm">Waiting for players</p>
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
                <div 
                  key={i} 
                  className="h-14 rounded-xl border border-dashed border-red-500/15 flex items-center justify-center bg-red-500/5"
                >
                  <span className="text-[10px] text-red-400/30 font-body uppercase tracking-wider">Empty Slot</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Center Controls */}
        <div className="w-80 flex flex-col items-center justify-center gap-5">
          {/* VS Badge */}
          <div className={`relative w-20 h-20 rounded-2xl rotate-45 flex items-center justify-center transition-all duration-500 ${
            pulseReady ? 'shadow-xl shadow-green-500/30' : ''
          }`}
          style={{
            background: pulseReady 
              ? 'linear-gradient(135deg, rgba(34,197,94,0.3) 0%, rgba(15,15,26,0.9) 100%)'
              : 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(15,15,26,0.9) 100%)',
            border: pulseReady ? '2px solid rgba(34,197,94,0.5)' : '1px solid rgba(255,255,255,0.15)',
          }}>
            <span className="font-display text-2xl text-white -rotate-45 drop-shadow-lg">VS</span>
            {pulseReady && (
              <div className="absolute inset-0 rounded-2xl animate-ping opacity-30 bg-green-500/30" />
            )}
          </div>

          {/* Team Selection */}
          <div 
            className="w-full rounded-2xl p-5 backdrop-blur-md"
            style={{
              background: 'linear-gradient(135deg, rgba(15,15,26,0.95) 0%, rgba(15,15,26,0.8) 100%)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)'
            }}
          >
            <p className="text-[11px] text-white/50 font-body uppercase tracking-widest text-center mb-4">Select Team</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleTeamChange('red')}
                className={`flex-1 py-3 rounded-xl font-display text-sm transition-all ${
                  currentPlayer?.team === 'red' 
                    ? 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg shadow-red-500/30' 
                    : 'bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20'
                }`}
              >
                RED
              </button>
              <button
                onClick={() => handleTeamChange('')}
                className={`flex-1 py-3 rounded-xl font-display text-sm transition-all ${
                  !currentPlayer?.team
                    ? 'bg-gradient-to-r from-white/20 to-white/10 text-white shadow-lg' 
                    : 'bg-white/5 text-white/50 hover:bg-white/10 border border-white/10'
                }`}
              >
                AUTO
              </button>
              <button
                onClick={() => handleTeamChange('blue')}
                className={`flex-1 py-3 rounded-xl font-display text-sm transition-all ${
                  currentPlayer?.team === 'blue' 
                    ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/30' 
                    : 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 border border-blue-500/20'
                }`}
              >
                BLUE
              </button>
            </div>
          </div>

          {/* Ready Status & Actions */}
          <div 
            className="w-full rounded-2xl p-5 backdrop-blur-md"
            style={{
              background: 'linear-gradient(135deg, rgba(15,15,26,0.95) 0%, rgba(15,15,26,0.8) 100%)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)'
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-white/70 font-body text-sm">
                <span className="text-green-400 font-display">{readyCount}</span>/{playerList.length} Ready
              </span>
              <div className="flex gap-1.5">
                {playerList.map((p, i) => (
                  <div 
                    key={i}
                    className={`w-2.5 h-2.5 rounded-full transition-all ${
                      p.isReady || p.isHost 
                        ? 'bg-green-400 shadow-sm shadow-green-400/50' 
                        : 'bg-white/20'
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {!isLobbyHost && (
                <button
                  onClick={handleToggleReady}
                  className={`w-full py-4 rounded-xl font-display text-lg transition-all ${
                    isReady
                      ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg shadow-green-500/30'
                      : 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/30 hover:shadow-orange-500/40'
                  }`}
                >
                  {isReady ? '✓ READY' : 'READY UP'}
                </button>
              )}
              
              {isLobbyHost && (
                <button
                  onClick={handleStartGame}
                  disabled={!canStart || isLoading}
                  className={`w-full py-4 rounded-xl font-display text-lg transition-all ${
                    canStart 
                      ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg shadow-green-500/30 hover:shadow-green-500/40' 
                      : 'bg-white/10 text-white/30 cursor-not-allowed'
                  }`}
                >
                  {isLoading ? 'STARTING...' : 'START GAME'}
                </button>
              )}

              <button
                onClick={leaveLobby}
                className="w-full py-3 bg-transparent border border-red-500/30 rounded-xl font-display text-sm text-red-400 hover:bg-red-500/10 hover:border-red-500/50 transition-all"
              >
                LEAVE LOBBY
              </button>
            </div>
          </div>

          {/* Unassigned */}
          {unassignedPlayers.length > 0 && (
            <div 
              className="w-full rounded-2xl p-4 backdrop-blur-md"
              style={{
                background: 'linear-gradient(135deg, rgba(15,15,26,0.95) 0%, rgba(15,15,26,0.8) 100%)',
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
              }}
            >
              <p className="text-[11px] text-white/50 font-body uppercase tracking-widest mb-3">Unassigned</p>
              <div className="space-y-2">
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

        {/* Blue Team Panel */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-end gap-3 mb-4 px-2">
            <span className="mr-auto text-white/50 text-sm font-mono bg-blue-500/10 px-2 py-1 rounded-lg">{blueTeamPlayers.length}/5</span>
            <h2 className="font-display text-2xl text-blue-400 drop-shadow-md">BLUE TEAM</h2>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
              </svg>
            </div>
          </div>
          
          <div 
            className="flex-1 rounded-2xl overflow-hidden backdrop-blur-md"
            style={{
              background: 'linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(15,15,26,0.9) 100%)',
              border: '1px solid rgba(59,130,246,0.25)',
              boxShadow: '0 8px 32px rgba(59,130,246,0.15), inset 0 1px 0 rgba(255,255,255,0.05)'
            }}
          >
            <div className="p-4 space-y-3 h-full overflow-y-auto">
              {blueTeamPlayers.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-8">
                  <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-4 border border-blue-500/20">
                    <svg className="w-8 h-8 text-blue-400/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                  </div>
                  <p className="text-blue-400/60 font-body text-sm">Waiting for players</p>
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
                <div 
                  key={i} 
                  className="h-14 rounded-xl border border-dashed border-blue-500/15 flex items-center justify-center bg-blue-500/5"
                >
                  <span className="text-[10px] text-blue-400/30 font-body uppercase tracking-wider">Empty Slot</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div 
        className="relative z-10 flex items-center justify-between px-8 py-4"
        style={{
          background: 'linear-gradient(to top, rgba(10,10,18,0.95), rgba(10,10,18,0.7))',
          borderTop: '1px solid rgba(255,255,255,0.05)'
        }}
      >
        <div className="flex items-center gap-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-display text-lg shadow-lg ${
            currentPlayer?.team === 'red' 
              ? 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-red-500/30' 
              : currentPlayer?.team === 'blue' 
                ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-blue-500/30' 
                : 'bg-gradient-to-br from-white/20 to-white/10 text-white'
          }`}>
            {playerName.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-[10px] text-white/40 font-body uppercase tracking-wider">Playing as</p>
            <p className={`font-display text-base ${
              currentPlayer?.team === 'red' ? 'text-red-400' :
              currentPlayer?.team === 'blue' ? 'text-blue-400' :
              'text-white'
            }`}>{playerName}</p>
          </div>
        </div>
        
        <p className="text-white/40 text-sm font-body">
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
  const gradientBg = teamColor === 'red' 
    ? 'from-red-500/20 to-red-500/5' 
    : teamColor === 'blue' 
      ? 'from-blue-500/20 to-blue-500/5' 
      : 'from-white/10 to-white/5';
  
  const accentColor = teamColor === 'red' 
    ? 'red' 
    : teamColor === 'blue' 
      ? 'blue' 
      : 'white';

  const avatarStyle = teamColor === 'red'
    ? 'bg-gradient-to-br from-red-500 to-red-600 shadow-red-500/30'
    : teamColor === 'blue'
      ? 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-blue-500/30'
      : 'bg-gradient-to-br from-white/20 to-white/10';

  return (
    <div 
      className={`flex items-center gap-3 ${compact ? 'p-2.5' : 'p-3.5'} rounded-xl bg-gradient-to-r ${gradientBg} backdrop-blur-sm transition-all ${
        isCurrentPlayer ? 'ring-2 ring-white/20 shadow-lg' : 'hover:bg-white/5'
      }`}
      style={{
        border: isCurrentPlayer 
          ? `1px solid rgba(255,255,255,0.2)` 
          : `1px solid rgba(255,255,255,0.05)`
      }}
    >
      <div className={`${compact ? 'w-8 h-8 text-sm' : 'w-10 h-10 text-base'} rounded-lg flex items-center justify-center font-display text-white shadow-lg ${avatarStyle}`}>
        {player.name.charAt(0).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`font-body ${compact ? 'text-sm' : 'text-base'} truncate ${isCurrentPlayer ? 'text-white font-medium' : 'text-white/80'}`}>
            {player.name}
          </span>
          {player.isHost && (
            <span className="px-1.5 py-0.5 bg-gradient-to-r from-orange-500/30 to-amber-500/20 text-orange-300 text-[9px] font-display rounded border border-orange-500/30">
              HOST
            </span>
          )}
          {isCurrentPlayer && (
            <span className="px-1.5 py-0.5 bg-gradient-to-r from-cyan-500/30 to-blue-500/20 text-cyan-300 text-[9px] font-display rounded border border-cyan-500/30">
              YOU
            </span>
          )}
        </div>
      </div>

      <div className={`${compact ? 'w-7 h-7' : 'w-8 h-8'} rounded-lg flex items-center justify-center transition-all ${
        player.isReady || player.isHost 
          ? 'bg-gradient-to-br from-green-500/30 to-green-500/10 border border-green-500/30' 
          : 'bg-white/5 border border-white/10'
      }`}>
        {player.isReady || player.isHost ? (
          <svg className={`${compact ? 'w-4 h-4' : 'w-4 h-4'} text-green-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <div className="w-2 h-2 bg-white/30 rounded-full" />
        )}
      </div>

      {isHost && !isCurrentPlayer && !player.isHost && (
        <button
          onClick={onKick}
          className={`${compact ? 'w-7 h-7' : 'w-8 h-8'} rounded-lg flex items-center justify-center bg-red-500/10 border border-red-500/20 text-red-400/60 hover:text-red-400 hover:bg-red-500/20 hover:border-red-500/30 transition-all`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
