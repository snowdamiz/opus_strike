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
    setAppPhase,
  } = useGameStore();
  const { leaveLobby, setLobbyReady, setLobbyTeam, startGame, kickPlayer } = useNetwork();
  const [pulseReady, setPulseReady] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const currentPlayer = playerId ? lobbyPlayers.get(playerId) : null;
  const isReady = currentPlayer?.isReady || false;

  useEffect(() => {
    const playerList = Array.from(lobbyPlayers.values());
    const allReady = playerList.length > 1 && playerList.every(p => p.isReady || p.isHost);
    setPulseReady(allReady);
  }, [lobbyPlayers]);

  const handleToggleReady = () => setLobbyReady(!isReady);
  const handleTeamChange = (team: string) => setLobbyTeam(team);
  const handleStartGame = () => {
    if (countdown !== null) return;
    setCountdown(3);
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev === 1) {
          clearInterval(timer);
          startGame();
          return null;
        }
        return prev ? prev - 1 : null;
      });
    }, 1000);
  };
  const handleKick = (targetId: string) => kickPlayer(targetId);

  const playerList = Array.from(lobbyPlayers.values());
  const readyCount = playerList.filter(p => p.isReady || p.isHost).length;
  const canStart = isLobbyHost && (playerList.length === 1 || readyCount === playerList.length);

  const redTeamPlayers = playerList.filter(p => p.team === 'red');
  const blueTeamPlayers = playerList.filter(p => p.team === 'blue');
  const unassignedPlayers = playerList.filter(p => !p.team);

  const handleBack = () => {
    leaveLobby();
    setAppPhase('browsing_lobbies');
  };

  return (
    <div className="w-full h-full relative overflow-hidden bg-strike-bg">
      {/* Cinematic Background */}
      <div className="absolute inset-0">
        {/* Background image with blur and pan */}
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat blur-[2px] animate-bg-pan scale-110"
          style={{ backgroundImage: 'url(/bg.jpg)' }}
        />
        
        {/* Dark overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a12]/85 via-[#0f0f1a]/80 to-[#08080c]/95" />
        
        {/* Team color glows */}
        <div 
          className="absolute top-0 left-0 w-1/2 h-full opacity-20 transition-opacity duration-1000"
          style={{ 
            background: 'radial-gradient(ellipse 80% 60% at 20% 50%, rgba(239,68,68,0.4) 0%, transparent 70%)'
          }}
        />
        <div 
          className="absolute top-0 right-0 w-1/2 h-full opacity-20 transition-opacity duration-1000"
          style={{ 
            background: 'radial-gradient(ellipse 80% 60% at 80% 50%, rgba(59,130,246,0.4) 0%, transparent 70%)'
          }}
        />
        
        {/* Grid pattern */}
        <div className="absolute inset-0 pattern-grid opacity-10" />
        
        {/* Bottom gradient */}
        <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-[#0a0a12] to-transparent" />
        
        {/* Vignette */}
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{ boxShadow: 'inset 0 0 200px 80px rgba(0,0,0,0.7)' }}
        />

        {/* Floating particles */}
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 rounded-full animate-float-particle"
            style={{
              left: `${5 + Math.random() * 90}%`,
              top: `${Math.random() * 100}%`,
              background: i % 3 === 0 
                ? 'rgba(239, 68, 68, 0.5)' 
                : i % 3 === 1 
                  ? 'rgba(59, 130, 246, 0.5)'
                  : 'rgba(255, 255, 255, 0.3)',
              animationDelay: `${Math.random() * 10}s`,
              animationDuration: `${15 + Math.random() * 10}s`,
            }}
          />
        ))}
      </div>

      {/* Top Navigation Bar */}
      <nav className="absolute top-0 left-0 right-0 z-20">
        <div className="flex items-center justify-between px-8 py-4">
          {/* Back button and lobby info */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleBack}
              className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all group"
            >
              <svg className="w-5 h-5 transition-transform group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full transition-all ${
                pulseReady 
                  ? 'bg-green-400 shadow-lg shadow-green-400/50 animate-pulse' 
                  : 'bg-orange-400 shadow-lg shadow-orange-400/30'
              }`} />
              <div>
                <h1 className="font-display text-2xl text-white tracking-wide">{currentLobbyName || 'Game Lobby'}</h1>
                <p className="text-[10px] text-white/40 font-body uppercase tracking-widest">
                  {readyCount}/{playerList.length} Ready • Waiting for players
                </p>
              </div>
            </div>
          </div>

          {/* Right side - Host badge & Player count */}
          <div className="flex items-center gap-4">
            {isLobbyHost && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-orange-500/20 to-amber-500/10 border border-orange-500/30">
                <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
                <span className="font-display text-sm text-orange-300">HOST</span>
              </div>
            )}
            
            <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-strike-surface/80 border border-white/5">
              <div 
                className={`w-9 h-9 rounded-lg flex items-center justify-center font-display text-white shadow-lg ${
                  currentPlayer?.team === 'red' 
                    ? 'bg-gradient-to-br from-red-500 to-red-600 shadow-red-500/30' 
                    : currentPlayer?.team === 'blue'
                      ? 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-blue-500/30'
                      : 'bg-gradient-to-br from-white/20 to-white/10'
                }`}
              >
                {playerName.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-display text-white text-sm">{playerName}</p>
                <p className="text-[10px] text-white/40 font-body">
                  {currentPlayer?.team === 'red' ? 'Red Team' : currentPlayer?.team === 'blue' ? 'Blue Team' : 'Unassigned'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="absolute inset-0 pt-20 pb-20 z-10 flex items-center justify-center gap-8 px-8">
        {/* Red Team Panel */}
        <div className="w-80 h-[520px] flex-shrink-0">
          <TeamPanel
            team="red"
            players={redTeamPlayers}
            playerId={playerId}
            isLobbyHost={isLobbyHost}
            onKick={handleKick}
          />
        </div>

        {/* Center Battle Arena */}
        <div className="w-[420px] flex-shrink-0 flex flex-col items-center justify-center relative">
          {/* Epic VS Section */}
          <div className="relative mb-8">
            {/* Animated ring */}
            <div 
              className={`absolute inset-0 -m-8 rounded-full transition-all duration-500 ${
                pulseReady ? 'opacity-100' : 'opacity-0'
              }`}
              style={{
                background: 'conic-gradient(from 0deg, transparent 0deg, rgba(34,197,94,0.3) 90deg, transparent 180deg)',
                animation: pulseReady ? 'spin 4s linear infinite' : 'none',
              }}
            />
            
            {/* VS Diamond */}
            <div 
              className={`relative w-28 h-28 rotate-45 rounded-3xl flex items-center justify-center transition-all duration-500 ${
                pulseReady ? 'scale-110' : 'scale-100'
              }`}
              style={{
                background: pulseReady 
                  ? 'linear-gradient(135deg, rgba(34,197,94,0.4) 0%, rgba(15,15,26,0.95) 100%)'
                  : 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(15,15,26,0.95) 100%)',
                border: pulseReady ? '2px solid rgba(34,197,94,0.6)' : '2px solid rgba(255,255,255,0.2)',
                boxShadow: pulseReady 
                  ? '0 0 60px rgba(34,197,94,0.4), inset 0 0 40px rgba(34,197,94,0.1)' 
                  : '0 0 40px rgba(255,255,255,0.1), inset 0 0 30px rgba(255,255,255,0.03)',
              }}
            >
              <span className="font-display text-4xl text-white -rotate-45 tracking-wider drop-shadow-2xl">VS</span>
              
              {/* Ready pulse */}
              {pulseReady && (
                <>
                  <div className="absolute inset-0 rounded-3xl animate-ping opacity-20 bg-green-500" />
                  <div className="absolute inset-0 rounded-3xl animate-pulse opacity-30 bg-green-500/50" />
                </>
              )}
            </div>
          </div>

          {/* Team Selection */}
          <div 
            className="w-full rounded-2xl p-6 backdrop-blur-xl mb-4"
            style={{
              background: 'linear-gradient(135deg, rgba(15,15,26,0.95) 0%, rgba(15,15,26,0.85) 100%)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
            }}
          >
            <p className="text-[11px] text-white/50 font-body uppercase tracking-[0.2em] text-center mb-5">
              Choose Your Side
            </p>
            <div className="flex gap-3">
              <TeamButton
                team="red"
                isSelected={currentPlayer?.team === 'red'}
                onClick={() => handleTeamChange('red')}
              />
              <button
                onClick={() => handleTeamChange('')}
                className={`flex-1 py-4 rounded-xl font-display text-sm transition-all relative overflow-hidden group ${
                  !currentPlayer?.team
                    ? 'bg-white/15 text-white shadow-lg ring-2 ring-white/30' 
                    : 'bg-white/5 text-white/50 hover:bg-white/10 border border-white/10 hover:border-white/20'
                }`}
              >
                <span className="relative z-10">AUTO</span>
                {!currentPlayer?.team && (
                  <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 animate-shimmer" />
                )}
              </button>
              <TeamButton
                team="blue"
                isSelected={currentPlayer?.team === 'blue'}
                onClick={() => handleTeamChange('blue')}
              />
            </div>
          </div>

          {/* Ready Status & Main Actions */}
          <div 
            className="w-full rounded-2xl p-6 backdrop-blur-xl"
            style={{
              background: 'linear-gradient(135deg, rgba(15,15,26,0.95) 0%, rgba(15,15,26,0.85) 100%)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
            }}
          >
            {/* Ready indicator */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                  readyCount === playerList.length
                    ? 'bg-green-500/20 border border-green-500/40'
                    : 'bg-white/5 border border-white/10'
                }`}>
                  <span className={`font-display text-lg ${
                    readyCount === playerList.length ? 'text-green-400' : 'text-white/60'
                  }`}>{readyCount}</span>
                </div>
                <div>
                  <p className="font-display text-white text-sm">Players Ready</p>
                  <p className="text-[10px] text-white/40 font-body">of {playerList.length} total</p>
                </div>
              </div>
              
              <div className="flex gap-2">
                {playerList.map((p, i) => (
                  <div 
                    key={i}
                    className={`w-3 h-3 rounded-full transition-all ${
                      p.isReady || p.isHost 
                        ? 'bg-green-400 shadow-md shadow-green-400/50 scale-110' 
                        : 'bg-white/20 scale-100'
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {/* Ready / Start Button */}
              {isLobbyHost ? (
                <button
                  onClick={handleStartGame}
                  disabled={!canStart || isLoading || countdown !== null}
                  className={`w-full py-5 rounded-xl font-display text-xl transition-all relative overflow-hidden group ${
                    canStart 
                      ? 'text-white shadow-2xl hover:scale-[1.02] active:scale-[0.99]' 
                      : 'bg-white/10 text-white/30 cursor-not-allowed'
                  }`}
                  style={canStart ? {
                    background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                    boxShadow: '0 0 60px rgba(34,197,94,0.4), inset 0 1px 0 rgba(255,255,255,0.2)',
                  } : undefined}
                >
                  {canStart && (
                    <div 
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                      style={{
                        background: 'linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.15) 50%, transparent 70%)',
                      }}
                    />
                  )}
                  <span className="relative flex items-center justify-center gap-3">
                    {countdown !== null ? (
                      <span className="text-3xl animate-pulse">{countdown}</span>
                    ) : isLoading ? (
                      <>
                        <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        STARTING...
                      </>
                    ) : (
                      <>
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                        START GAME
                      </>
                    )}
                  </span>
                </button>
              ) : (
                <button
                  onClick={handleToggleReady}
                  className={`w-full py-5 rounded-xl font-display text-xl transition-all relative overflow-hidden group hover:scale-[1.02] active:scale-[0.99] ${
                    isReady
                      ? 'text-white shadow-2xl'
                      : 'text-white shadow-2xl'
                  }`}
                  style={{
                    background: isReady
                      ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
                      : 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                    boxShadow: isReady
                      ? '0 0 60px rgba(34,197,94,0.4), inset 0 1px 0 rgba(255,255,255,0.2)'
                      : '0 0 60px rgba(249,115,22,0.4), inset 0 1px 0 rgba(255,255,255,0.2)',
                  }}
                >
                  <div 
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                    style={{
                      background: 'linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.15) 50%, transparent 70%)',
                    }}
                  />
                  <span className="relative flex items-center justify-center gap-3">
                    {isReady ? (
                      <>
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        READY!
                      </>
                    ) : (
                      <>
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        READY UP
                      </>
                    )}
                  </span>
                </button>
              )}

              {/* Leave Lobby Button */}
              <button
                onClick={leaveLobby}
                className="w-full py-3 rounded-xl font-display text-sm text-white/50 bg-white/5 border border-white/10 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-all flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                LEAVE LOBBY
              </button>
            </div>
          </div>

          {/* Unassigned Players */}
          {unassignedPlayers.length > 0 && (
            <div 
              className="w-full rounded-2xl p-5 backdrop-blur-xl mt-4"
              style={{
                background: 'linear-gradient(135deg, rgba(15,15,26,0.9) 0%, rgba(15,15,26,0.8) 100%)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <p className="text-[10px] text-white/40 font-body uppercase tracking-[0.2em] mb-3">Unassigned</p>
              <div className="space-y-2">
                {unassignedPlayers.map(player => (
                  <PlayerCard 
                    key={player.id} 
                    player={player} 
                    isCurrentPlayer={player.id === playerId}
                    isLobbyHost={isLobbyHost}
                    onKick={() => handleKick(player.id)}
                    compact
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Blue Team Panel */}
        <div className="w-80 h-[520px] flex-shrink-0">
          <TeamPanel
            team="blue"
            players={blueTeamPlayers}
            playerId={playerId}
            isLobbyHost={isLobbyHost}
            onKick={handleKick}
            reverse
          />
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div 
        className="absolute bottom-0 left-0 right-0 z-20"
        style={{
          background: 'linear-gradient(to top, rgba(10,10,18,0.98), rgba(10,10,18,0.8), transparent)',
        }}
      >
        <div className="flex items-center justify-between px-8 py-5">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4">
              {/* Red team count */}
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center">
                  <span className="font-display text-sm text-red-400">{redTeamPlayers.length}</span>
                </div>
                <span className="text-xs text-white/40 font-body">RED</span>
              </div>
              
              <div className="w-px h-6 bg-white/10" />
              
              {/* Blue team count */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/40 font-body">BLUE</span>
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                  <span className="font-display text-sm text-blue-400">{blueTeamPlayers.length}</span>
                </div>
              </div>
            </div>
          </div>
          
          <p className="text-white/30 text-sm font-body flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${pulseReady ? 'bg-green-400 animate-pulse' : 'bg-orange-400'}`} />
            {isLobbyHost 
              ? canStart ? 'Ready to start!' : 'Waiting for players to ready up'
              : isReady ? 'Waiting for host to start' : 'Press Ready when you\'re set'
            }
          </p>
        </div>
      </div>
    </div>
  );
}

// Team Button Component
interface TeamButtonProps {
  team: 'red' | 'blue';
  isSelected: boolean;
  onClick: () => void;
}

function TeamButton({ team, isSelected, onClick }: TeamButtonProps) {
  const isRed = team === 'red';
  
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-4 rounded-xl font-display text-sm transition-all relative overflow-hidden group ${
        isSelected
          ? 'text-white shadow-xl'
          : `${isRed ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40' : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 hover:border-blue-500/40'}`
      }`}
      style={isSelected ? {
        background: isRed 
          ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
          : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
        boxShadow: isRed
          ? '0 0 40px rgba(239,68,68,0.4), inset 0 1px 0 rgba(255,255,255,0.2)'
          : '0 0 40px rgba(59,130,246,0.4), inset 0 1px 0 rgba(255,255,255,0.2)',
      } : undefined}
    >
      <span className="relative z-10">{team.toUpperCase()}</span>
      {isSelected && (
        <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 animate-shimmer" />
      )}
    </button>
  );
}

// Team Panel Component
interface TeamPanelProps {
  team: 'red' | 'blue';
  players: { id: string; name: string; isHost: boolean; isReady: boolean; team: string }[];
  playerId: string | null;
  isLobbyHost: boolean;
  onKick: (id: string) => void;
  reverse?: boolean;
}

function TeamPanel({ team, players, playerId, isLobbyHost, onKick, reverse }: TeamPanelProps) {
  const isRed = team === 'red';
  const maxPlayers = 5;
  const emptySlots = Math.max(0, maxPlayers - players.length);

  return (
    <div className="h-full flex flex-col">
      {/* Team Header */}
      <div className={`flex items-center gap-3 mb-4 ${reverse ? 'flex-row-reverse' : ''}`}>
        <div 
          className={`w-11 h-11 rounded-xl flex items-center justify-center shadow-lg ${
            isRed 
              ? 'bg-gradient-to-br from-red-500 to-red-600 shadow-red-500/30' 
              : 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-blue-500/30'
          }`}
        >
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
          </svg>
        </div>
        <div className={reverse ? 'text-right flex-1' : 'flex-1'}>
          <h2 className={`font-display text-xl tracking-wide ${isRed ? 'text-red-400' : 'text-blue-400'}`}>
            {isRed ? 'RED' : 'BLUE'} TEAM
          </h2>
          <div className="flex items-center gap-2 mt-0.5">
            {reverse && <div className="flex-1" />}
            <div className="flex gap-1">
              {[...Array(maxPlayers)].map((_, i) => (
                <div 
                  key={i} 
                  className={`w-1.5 h-1.5 rounded-full transition-all ${
                    i < players.length 
                      ? isRed ? 'bg-red-400' : 'bg-blue-400'
                      : 'bg-white/15'
                  }`} 
                />
              ))}
            </div>
            <span className="text-white/30 text-[10px] font-mono">{players.length}/{maxPlayers}</span>
            {!reverse && <div className="flex-1" />}
          </div>
        </div>
      </div>

      {/* Team Container */}
      <div 
        className="flex-1 rounded-2xl overflow-hidden backdrop-blur-xl relative"
        style={{
          background: isRed
            ? 'linear-gradient(180deg, rgba(239,68,68,0.08) 0%, rgba(15,15,26,0.95) 40%)'
            : 'linear-gradient(180deg, rgba(59,130,246,0.08) 0%, rgba(15,15,26,0.95) 40%)',
          border: isRed ? '1px solid rgba(239,68,68,0.15)' : '1px solid rgba(59,130,246,0.15)',
          boxShadow: isRed
            ? '0 20px 60px rgba(239,68,68,0.1), inset 0 1px 0 rgba(255,255,255,0.03)'
            : '0 20px 60px rgba(59,130,246,0.1), inset 0 1px 0 rgba(255,255,255,0.03)',
        }}
      >
        {/* Top glow accent */}
        <div 
          className="absolute top-0 left-0 right-0 h-px"
          style={{
            background: isRed 
              ? 'linear-gradient(90deg, transparent, rgba(239,68,68,0.5), transparent)'
              : 'linear-gradient(90deg, transparent, rgba(59,130,246,0.5), transparent)'
          }}
        />
        
        <div className="p-4 h-full overflow-y-auto space-y-2">
          {/* Players */}
          {players.map((player) => (
            <PlayerCard 
              key={player.id} 
              player={player} 
              isCurrentPlayer={player.id === playerId}
              isLobbyHost={isLobbyHost}
              onKick={() => onKick(player.id)}
              teamColor={team}
            />
          ))}

          {/* Empty state */}
          {players.length === 0 && emptySlots === maxPlayers && (
            <div className="h-full flex flex-col items-center justify-center text-center py-8">
              <div 
                className={`w-14 h-14 rounded-xl flex items-center justify-center mb-4 ${
                  isRed ? 'bg-red-500/10 border border-red-500/15' : 'bg-blue-500/10 border border-blue-500/15'
                }`}
              >
                <svg className={`w-7 h-7 ${isRed ? 'text-red-400/25' : 'text-blue-400/25'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </div>
              <p className={`font-display text-sm ${isRed ? 'text-red-400/30' : 'text-blue-400/30'}`}>
                No players yet
              </p>
            </div>
          )}

          {/* Empty slots - only show if there are some players */}
          {players.length > 0 && [...Array(emptySlots)].map((_, i) => (
            <div 
              key={i} 
              className={`h-12 rounded-lg border border-dashed flex items-center justify-center ${
                isRed 
                  ? 'border-red-500/10 bg-red-500/[0.02]' 
                  : 'border-blue-500/10 bg-blue-500/[0.02]'
              }`}
            >
              <span className={`text-[9px] uppercase tracking-widest font-body ${isRed ? 'text-red-400/15' : 'text-blue-400/15'}`}>
                Open
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
  isCurrentPlayer: boolean;
  isLobbyHost: boolean;
  onKick: () => void;
  teamColor?: 'red' | 'blue';
  compact?: boolean;
}

function PlayerCard({ player, isCurrentPlayer, isLobbyHost, onKick, teamColor, compact }: PlayerCardProps) {
  const isRed = teamColor === 'red';
  const isBlue = teamColor === 'blue';

  const avatarGradient = isRed
    ? 'from-red-500 to-red-600'
    : isBlue
      ? 'from-blue-500 to-blue-600'
      : 'from-white/20 to-white/10';

  const avatarShadow = isRed
    ? 'shadow-red-500/40'
    : isBlue
      ? 'shadow-blue-500/40'
      : '';

  return (
    <div 
      className={`flex items-center gap-4 ${compact ? 'p-3' : 'p-4'} rounded-xl transition-all ${
        isCurrentPlayer 
          ? 'bg-white/10 ring-2 ring-white/20 shadow-xl' 
          : 'bg-white/[0.03] hover:bg-white/[0.06]'
      }`}
      style={{
        border: isCurrentPlayer 
          ? '1px solid rgba(255,255,255,0.15)' 
          : '1px solid rgba(255,255,255,0.05)',
      }}
    >
      {/* Avatar */}
      <div 
        className={`${compact ? 'w-10 h-10 text-base' : 'w-12 h-12 text-lg'} rounded-xl flex items-center justify-center font-display text-white shadow-lg bg-gradient-to-br ${avatarGradient} ${avatarShadow}`}
      >
        {player.name.charAt(0).toUpperCase()}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-display ${compact ? 'text-sm' : 'text-base'} truncate ${isCurrentPlayer ? 'text-white' : 'text-white/80'}`}>
            {player.name}
          </span>
          {player.isHost && (
            <span className="px-2 py-0.5 bg-gradient-to-r from-orange-500/30 to-amber-500/20 text-orange-300 text-[9px] font-display rounded-md border border-orange-500/30 uppercase tracking-wider">
              Host
            </span>
          )}
          {isCurrentPlayer && (
            <span className="px-2 py-0.5 bg-gradient-to-r from-cyan-500/30 to-blue-500/20 text-cyan-300 text-[9px] font-display rounded-md border border-cyan-500/30 uppercase tracking-wider">
              You
            </span>
          )}
        </div>
      </div>

      {/* Ready Status */}
      <div 
        className={`${compact ? 'w-9 h-9' : 'w-10 h-10'} rounded-xl flex items-center justify-center transition-all ${
          player.isReady || player.isHost 
            ? 'bg-green-500/20 border border-green-500/40' 
            : 'bg-white/5 border border-white/10'
        }`}
      >
        {player.isReady || player.isHost ? (
          <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <div className="w-2.5 h-2.5 bg-white/20 rounded-full" />
        )}
      </div>

      {/* Kick Button */}
      {isLobbyHost && !isCurrentPlayer && !player.isHost && (
        <button
          onClick={onKick}
          className={`${compact ? 'w-9 h-9' : 'w-10 h-10'} rounded-xl flex items-center justify-center bg-red-500/10 border border-red-500/20 text-red-400/50 hover:text-red-400 hover:bg-red-500/20 hover:border-red-500/40 transition-all`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
