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
  const handleKick = (id: string) => kickPlayer(id);

  const playerList = Array.from(lobbyPlayers.values());
  const readyCount = playerList.filter(p => p.isReady || p.isHost).length;
  const canStart = isLobbyHost && (playerList.length === 1 || readyCount === playerList.length);

  const redTeamPlayers = playerList.filter(p => p.team === 'red');
  const blueTeamPlayers = playerList.filter(p => p.team === 'blue');
  const unassignedPlayers = playerList.filter(p => !p.team);

  return (
    <div className="w-full h-full relative overflow-hidden">
      {/* Background - matches main lobby */}
      <div className="absolute inset-0">
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat blur-[2px] animate-bg-pan"
          style={{ backgroundImage: 'url(/bg.jpg)' }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a12]/85 via-[#0f0f1a]/80 to-[#08080c]/95" />
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{ boxShadow: 'inset 0 0 200px 80px rgba(0,0,0,0.6)' }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full h-full flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-center py-8">
          <div className="flex items-center gap-4">
            <div className={`w-3 h-3 rounded-full ${pulseReady ? 'bg-green-400 animate-pulse shadow-lg shadow-green-400/50' : 'bg-orange-400 shadow-lg shadow-orange-400/30'}`} />
            <h1 className="font-display text-3xl text-white drop-shadow-lg tracking-wide">
              {currentLobbyName || 'Game Lobby'}
            </h1>
            {isLobbyHost && (
              <span className="px-3 py-1 bg-gradient-to-r from-orange-500 to-amber-500 text-white text-xs font-display rounded-full shadow-lg shadow-orange-500/30">
                HOST
              </span>
            )}
          </div>
        </header>

        {/* Main Content - Horizontal Layout */}
        <div className="flex-1 flex items-center justify-center px-8 pb-8 gap-6">
          {/* Red Team Panel */}
          <TeamPanel
            team="red"
            players={redTeamPlayers}
            maxPlayers={5}
            currentPlayerId={playerId}
            isHost={isLobbyHost}
            onKick={handleKick}
          />

          {/* Center Panel */}
          <div className="w-[340px] flex flex-col gap-4">
            {/* VS Badge */}
            <div className="flex justify-center mb-2">
              <div className={`relative w-20 h-20 ${pulseReady ? 'animate-pulse' : ''}`}>
                <div 
                  className="absolute inset-0 rounded-2xl rotate-45 border-2 transition-all duration-500"
                  style={{
                    background: pulseReady 
                      ? 'linear-gradient(135deg, rgba(34,197,94,0.3), rgba(34,197,94,0.1))'
                      : 'linear-gradient(135deg, rgba(249,115,22,0.2), rgba(234,179,8,0.1))',
                    borderColor: pulseReady ? 'rgba(34,197,94,0.5)' : 'rgba(249,115,22,0.3)',
                    boxShadow: pulseReady 
                      ? '0 0 40px rgba(34,197,94,0.3), inset 0 0 20px rgba(34,197,94,0.1)'
                      : '0 0 40px rgba(249,115,22,0.2), inset 0 0 20px rgba(249,115,22,0.1)'
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="font-display text-2xl text-white drop-shadow-lg">VS</span>
                </div>
              </div>
            </div>

            {/* Controls Card */}
            <div 
              className="rounded-2xl backdrop-blur-xl overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(15,15,26,0.95) 0%, rgba(15,15,26,0.85) 100%)',
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)'
              }}
            >
              {/* Team Selection */}
              <div className="p-5 border-b border-white/5">
                <p className="text-xs text-white/50 font-body uppercase tracking-wider text-center mb-4">Choose Your Side</p>
                <div className="flex gap-2">
                  <TeamButton 
                    team="red" 
                    selected={currentPlayer?.team === 'red'} 
                    onClick={() => handleTeamChange('red')} 
                  />
                  <button
                    onClick={() => handleTeamChange('')}
                    className={`flex-1 py-3 rounded-xl font-display text-sm transition-all ${
                      !currentPlayer?.team
                        ? 'bg-white/20 text-white shadow-lg' 
                        : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70'
                    }`}
                  >
                    AUTO
                  </button>
                  <TeamButton 
                    team="blue" 
                    selected={currentPlayer?.team === 'blue'} 
                    onClick={() => handleTeamChange('blue')} 
                  />
                </div>
              </div>

              {/* Ready Status */}
              <div className="p-5 border-b border-white/5">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-white/70 font-body text-sm">
                    {readyCount}/{playerList.length} Ready
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

                {!isLobbyHost && (
                  <button
                    onClick={handleToggleReady}
                    className={`w-full py-4 rounded-xl font-display text-lg transition-all ${
                      isReady
                        ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg shadow-green-500/30'
                        : 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50'
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
                        ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg shadow-green-500/30 hover:shadow-green-500/50' 
                        : 'bg-white/10 text-white/30 cursor-not-allowed'
                    }`}
                  >
                    {isLoading ? 'STARTING...' : 'START GAME'}
                  </button>
                )}
              </div>

              {/* Unassigned Players */}
              {unassignedPlayers.length > 0 && (
                <div className="p-5 border-b border-white/5">
                  <p className="text-xs text-white/40 font-body uppercase tracking-wider mb-3">Waiting to Join</p>
                  <div className="space-y-2">
                    {unassignedPlayers.map(player => (
                      <CompactPlayerCard
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

              {/* Leave Button */}
              <div className="p-5">
                <button
                  onClick={leaveLobby}
                  className="w-full py-3 rounded-xl font-display text-sm text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all"
                >
                  LEAVE LOBBY
                </button>
              </div>
            </div>

            {/* Tip */}
            <p className="text-center text-white/30 text-xs font-body">
              {isLobbyHost ? 'Start when everyone is ready' : 'Waiting for host to start the game'}
            </p>
          </div>

          {/* Blue Team Panel */}
          <TeamPanel
            team="blue"
            players={blueTeamPlayers}
            maxPlayers={5}
            currentPlayerId={playerId}
            isHost={isLobbyHost}
            onKick={handleKick}
          />
        </div>

        {/* Footer */}
        <footer className="absolute bottom-0 left-0 right-0 px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div 
                className="w-10 h-10 rounded-xl flex items-center justify-center font-display text-lg shadow-lg"
                style={{
                  background: currentPlayer?.team === 'red' 
                    ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                    : currentPlayer?.team === 'blue'
                    ? 'linear-gradient(135deg, #3b82f6, #2563eb)'
                    : 'linear-gradient(135deg, #f97316, #ea580c)',
                  boxShadow: currentPlayer?.team === 'red'
                    ? '0 4px 20px rgba(239,68,68,0.4)'
                    : currentPlayer?.team === 'blue'
                    ? '0 4px 20px rgba(59,130,246,0.4)'
                    : '0 4px 20px rgba(249,115,22,0.4)'
                }}
              >
                {playerName.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-[10px] text-white/40 font-body uppercase tracking-wider">Playing as</p>
                <p className="font-display text-white">{playerName}</p>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

// Team Button Component
function TeamButton({ team, selected, onClick }: { team: 'red' | 'blue'; selected: boolean; onClick: () => void }) {
  const colors = team === 'red' 
    ? { bg: 'from-red-500 to-red-600', hover: 'hover:bg-red-500/20', text: 'text-red-400', shadow: 'shadow-red-500/30' }
    : { bg: 'from-blue-500 to-blue-600', hover: 'hover:bg-blue-500/20', text: 'text-blue-400', shadow: 'shadow-blue-500/30' };

  return (
    <button
      onClick={onClick}
      className={`flex-1 py-3 rounded-xl font-display text-sm transition-all ${
        selected 
          ? `bg-gradient-to-r ${colors.bg} text-white shadow-lg ${colors.shadow}` 
          : `bg-${team === 'red' ? 'red' : 'blue'}-500/10 ${colors.text} ${colors.hover}`
      }`}
    >
      {team.toUpperCase()}
    </button>
  );
}

// Team Panel Component
interface TeamPanelProps {
  team: 'red' | 'blue';
  players: Array<{ id: string; name: string; isHost: boolean; isReady: boolean; team: string }>;
  maxPlayers: number;
  currentPlayerId: string | null;
  isHost: boolean;
  onKick: (id: string) => void;
}

function TeamPanel({ team, players, maxPlayers, currentPlayerId, isHost, onKick }: TeamPanelProps) {
  const isRed = team === 'red';
  const emptySlots = Math.max(0, maxPlayers - players.length);

  return (
    <div className="w-[280px] flex flex-col">
      {/* Header */}
      <div className={`flex items-center gap-3 mb-4 ${isRed ? '' : 'flex-row-reverse'}`}>
        <div 
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{
            background: isRed 
              ? 'linear-gradient(135deg, rgba(239,68,68,0.3), rgba(239,68,68,0.1))'
              : 'linear-gradient(135deg, rgba(59,130,246,0.3), rgba(59,130,246,0.1))',
            border: `1px solid ${isRed ? 'rgba(239,68,68,0.3)' : 'rgba(59,130,246,0.3)'}`,
            boxShadow: isRed 
              ? '0 4px 20px rgba(239,68,68,0.2)'
              : '0 4px 20px rgba(59,130,246,0.2)'
          }}
        >
          <svg className={`w-5 h-5 ${isRed ? 'text-red-400' : 'text-blue-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <div className={isRed ? '' : 'text-right'}>
          <h2 className={`font-display text-xl ${isRed ? 'text-red-400' : 'text-blue-400'}`}>
            {isRed ? 'RED TEAM' : 'BLUE TEAM'}
          </h2>
          <p className="text-white/30 text-xs font-mono">{players.length}/{maxPlayers}</p>
        </div>
      </div>

      {/* Player List */}
      <div 
        className="flex-1 rounded-2xl backdrop-blur-md overflow-hidden"
        style={{
          background: isRed
            ? 'linear-gradient(180deg, rgba(239,68,68,0.1) 0%, rgba(15,15,26,0.9) 100%)'
            : 'linear-gradient(180deg, rgba(59,130,246,0.1) 0%, rgba(15,15,26,0.9) 100%)',
          border: `1px solid ${isRed ? 'rgba(239,68,68,0.2)' : 'rgba(59,130,246,0.2)'}`,
          boxShadow: '0 20px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)'
        }}
      >
        <div className="p-4 space-y-2 h-full">
          {players.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center py-8">
              <div 
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{
                  background: isRed 
                    ? 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(239,68,68,0.05))'
                    : 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(59,130,246,0.05))',
                  border: `1px solid ${isRed ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)'}`
                }}
              >
                <svg className={`w-8 h-8 ${isRed ? 'text-red-400/40' : 'text-blue-400/40'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </div>
              <p className={`font-body text-sm ${isRed ? 'text-red-400/50' : 'text-blue-400/50'}`}>
                Waiting for players
              </p>
            </div>
          ) : (
            players.map((player) => (
              <PlayerCard 
                key={player.id} 
                player={player} 
                team={team}
                isCurrentPlayer={player.id === currentPlayerId}
                isHost={isHost}
                onKick={() => onKick(player.id)}
              />
            ))
          )}
          
          {/* Empty slots */}
          {emptySlots > 0 && players.length > 0 && [...Array(emptySlots)].map((_, i) => (
            <div 
              key={i} 
              className="h-14 rounded-xl border border-dashed flex items-center justify-center"
              style={{
                borderColor: isRed ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)'
              }}
            >
              <span className={`text-[10px] font-body uppercase ${isRed ? 'text-red-400/20' : 'text-blue-400/20'}`}>
                Open Slot
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Player Card Component
interface PlayerCardProps {
  player: { id: string; name: string; isHost: boolean; isReady: boolean; team: string };
  team: 'red' | 'blue';
  isCurrentPlayer: boolean;
  isHost: boolean;
  onKick: () => void;
}

function PlayerCard({ player, team, isCurrentPlayer, isHost, onKick }: PlayerCardProps) {
  const isRed = team === 'red';
  
  return (
    <div 
      className={`flex items-center gap-3 p-3 rounded-xl transition-all ${isCurrentPlayer ? 'ring-1 ring-white/30' : ''}`}
      style={{
        background: isRed 
          ? 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(239,68,68,0.05))'
          : 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(59,130,246,0.05))',
      }}
    >
      {/* Avatar */}
      <div 
        className="w-10 h-10 rounded-lg flex items-center justify-center font-display text-white text-sm"
        style={{
          background: isRed 
            ? 'linear-gradient(135deg, #ef4444, #dc2626)'
            : 'linear-gradient(135deg, #3b82f6, #2563eb)',
          boxShadow: isRed
            ? '0 4px 12px rgba(239,68,68,0.4)'
            : '0 4px 12px rgba(59,130,246,0.4)'
        }}
      >
        {player.name.charAt(0).toUpperCase()}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`font-body text-sm truncate ${isCurrentPlayer ? 'text-white' : 'text-white/80'}`}>
            {player.name}
          </span>
          {player.isHost && (
            <span className="px-1.5 py-0.5 bg-orange-500/30 text-orange-300 text-[9px] font-display rounded">HOST</span>
          )}
          {isCurrentPlayer && (
            <span className="px-1.5 py-0.5 bg-cyan-500/30 text-cyan-300 text-[9px] font-display rounded">YOU</span>
          )}
        </div>
      </div>

      {/* Status */}
      <div 
        className="w-8 h-8 rounded-lg flex items-center justify-center"
        style={{
          background: player.isReady || player.isHost ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.1)'
        }}
      >
        {player.isReady || player.isHost ? (
          <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <div className="w-2 h-2 bg-white/30 rounded-full" />
        )}
      </div>

      {/* Kick Button */}
      {isHost && !isCurrentPlayer && !player.isHost && (
        <button
          onClick={onKick}
          className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-500/10 text-red-400/60 hover:text-red-400 hover:bg-red-500/20 transition-all"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

// Compact Player Card for Unassigned
interface CompactPlayerCardProps {
  player: { id: string; name: string; isHost: boolean; isReady: boolean };
  isCurrentPlayer: boolean;
  isHost: boolean;
  onKick: () => void;
}

function CompactPlayerCard({ player, isCurrentPlayer, isHost, onKick }: CompactPlayerCardProps) {
  return (
    <div 
      className={`flex items-center gap-2 p-2 rounded-lg bg-white/5 ${isCurrentPlayer ? 'ring-1 ring-white/20' : ''}`}
    >
      <div className="w-7 h-7 rounded flex items-center justify-center font-display text-xs bg-gradient-to-br from-orange-500 to-amber-500 text-white">
        {player.name.charAt(0).toUpperCase()}
      </div>
      <span className="flex-1 font-body text-xs text-white/70 truncate">{player.name}</span>
      {player.isHost && (
        <span className="px-1 py-0.5 bg-orange-500/20 text-orange-400 text-[8px] font-display rounded">HOST</span>
      )}
      {isCurrentPlayer && (
        <span className="px-1 py-0.5 bg-cyan-500/20 text-cyan-400 text-[8px] font-display rounded">YOU</span>
      )}
      <div className={`w-5 h-5 rounded flex items-center justify-center ${
        player.isReady || player.isHost ? 'bg-green-500/20' : 'bg-white/10'
      }`}>
        {player.isReady || player.isHost ? (
          <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <div className="w-1.5 h-1.5 bg-white/30 rounded-full" />
        )}
      </div>
      {isHost && !isCurrentPlayer && !player.isHost && (
        <button
          onClick={onKick}
          className="w-5 h-5 rounded flex items-center justify-center bg-red-500/10 text-red-400/60 hover:text-red-400 hover:bg-red-500/20 transition-all"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
