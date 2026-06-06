import { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';
import { useUISounds } from '../../hooks/useAudio';

// Faction definitions
const FACTIONS = {
  red: {
    id: 'red',
    name: 'SOLAR',
    fullName: 'SOLAR VANGUARD',
    tagline: 'Warriors of Light',
    primaryColor: '#f97316', // Orange
    secondaryColor: '#fbbf24', // Gold/Amber
    glowColor: 'rgba(249,115,22,0.4)',
    bgGradient: 'rgba(249,115,22,0.08)',
    borderColor: 'rgba(249,115,22,0.15)',
  },
  blue: {
    id: 'blue',
    name: 'VOID',
    fullName: 'VOID LEGION',
    tagline: 'Masters of Shadow',
    primaryColor: '#06b6d4', // Cyan
    secondaryColor: '#8b5cf6', // Purple
    glowColor: 'rgba(6,182,212,0.4)',
    bgGradient: 'rgba(6,182,212,0.08)',
    borderColor: 'rgba(6,182,212,0.15)',
  },
} as const;

// Solar Vanguard Icon - Stylized sun with radiating beams
function SolarIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="5" fill="currentColor" />
      <path d="M12 2V5M12 19V22M2 12H5M19 12H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4.93 4.93L7.05 7.05M16.95 16.95L19.07 19.07M4.93 19.07L7.05 16.95M16.95 7.05L19.07 4.93" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Void Legion Icon - Abstract void portal/eclipse
function VoidIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <path d="M12 2C6.48 2 2 6.48 2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 2" />
      <path d="M22 12C22 17.52 17.52 22 12 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 2" />
    </svg>
  );
}

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
  const { playButtonClick } = useUISounds();
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

  const solarPlayers = playerList.filter(p => p.team === 'red');
  const voidPlayers = playerList.filter(p => p.team === 'blue');
  const unassignedPlayers = playerList.filter(p => !p.team);

  const currentFaction = currentPlayer?.team === 'red' ? FACTIONS.red : currentPlayer?.team === 'blue' ? FACTIONS.blue : null;

  const handleBack = () => {
    leaveLobby();
    setAppPhase('browsing_lobbies');
  };

  return (
    <div className="w-full h-full relative overflow-hidden bg-strike-bg">
      {/* Cinematic Background */}
      <div className="absolute inset-0">
        {/* Background image */}
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: 'url(/bg.jpg)' }}
        />
        
        {/* Dark overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a12]/85 via-[#0f0f1a]/80 to-[#08080c]/95" />
        
        {/* Faction color glows */}
        <div 
          className="absolute top-0 left-0 w-1/2 h-full opacity-25"
          style={{ 
            background: `radial-gradient(ellipse 70% 50% at 20% 50%, ${FACTIONS.red.glowColor} 0%, transparent 70%)`
          }}
        />
        <div 
          className="absolute top-0 right-0 w-1/2 h-full opacity-25"
          style={{ 
            background: `radial-gradient(ellipse 70% 50% at 80% 50%, ${FACTIONS.blue.glowColor} 0%, transparent 70%)`
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
      </div>

      {/* Top Navigation Bar */}
      <nav className="absolute top-0 left-0 right-0 z-20">
        <div className="flex items-center justify-between px-8 py-4">
          {/* Back button and lobby info */}
          <div className="flex items-center gap-4">
 <button
 onClick={() => { playButtonClick(); handleBack(); }}
 className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 hover:border-white/20 group"
 >
 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                  {readyCount}/{playerList.length} Ready • Awaiting combatants
                </p>
              </div>
            </div>
          </div>

          {/* Right side - Host badge & Player info */}
          <div className="flex items-center gap-4">
            {isLobbyHost && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500/20 to-orange-500/10 border border-amber-500/30">
                <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
                <span className="font-display text-sm text-amber-300">COMMANDER</span>
              </div>
            )}
            
            <div 
              className="flex items-center gap-3 px-4 py-2 rounded-xl border"
              style={{
                background: currentFaction 
                  ? `linear-gradient(135deg, ${currentFaction.bgGradient}, rgba(15,15,26,0.9))`
                  : 'rgba(255,255,255,0.03)',
                borderColor: currentFaction?.borderColor || 'rgba(255,255,255,0.05)',
              }}
            >
              <div 
                className="w-9 h-9 rounded-lg flex items-center justify-center font-display text-white shadow-lg"
                style={{
                  background: currentFaction 
                    ? `linear-gradient(135deg, ${currentFaction.primaryColor}, ${currentFaction.secondaryColor})`
                    : 'linear-gradient(135deg, rgba(255,255,255,0.2), rgba(255,255,255,0.1))',
                  boxShadow: currentFaction ? `0 4px 15px ${currentFaction.glowColor}` : undefined,
                }}
              >
                {playerName.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-display text-white text-sm">{playerName}</p>
                <p className="text-[10px] font-body" style={{ color: currentFaction?.primaryColor || 'rgba(255,255,255,0.4)' }}>
                  {currentFaction?.fullName || 'Unassigned'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="absolute inset-0 pt-20 pb-20 z-10 flex items-center justify-center gap-10 px-8">
        {/* Solar Vanguard Panel */}
        <div className="w-52 lg:w-60 xl:w-72 2xl:w-80 h-[340px] lg:h-[380px] xl:h-[460px] 2xl:h-[520px] flex-shrink-0">
          <FactionPanel
            faction={FACTIONS.red}
            players={solarPlayers}
            playerId={playerId}
            isLobbyHost={isLobbyHost}
            onKick={handleKick}
          />
        </div>

        {/* Center Battle Arena */}
        <div className="w-[240px] lg:w-[280px] xl:w-[320px] 2xl:w-[360px] flex-shrink-0 flex flex-col items-center justify-center relative">
          {/* Epic VS Section */}
          <div className="relative mb-6">
            {/* Outer glow ring */}
            <div 
              className={`absolute -inset-8 rounded-full transition-all duration-700 ${
                pulseReady ? 'opacity-100' : 'opacity-0'
              }`}
              style={{
                background: 'radial-gradient(circle, rgba(34,197,94,0.15) 0%, transparent 70%)',
              }}
            />
            
            {/* Battle emblem */}
            <div 
              className={`relative w-28 h-28 rounded-2xl flex items-center justify-center transition-all duration-500 ${
                pulseReady ? 'scale-105' : 'scale-100'
              }`}
              style={{
                background: pulseReady 
                  ? 'linear-gradient(135deg, rgba(34,197,94,0.25) 0%, rgba(15,15,26,0.95) 100%)'
                  : 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(15,15,26,0.95) 100%)',
                border: pulseReady ? '2px solid rgba(34,197,94,0.4)' : '1px solid rgba(255,255,255,0.12)',
                boxShadow: pulseReady 
                  ? '0 0 60px rgba(34,197,94,0.25), inset 0 0 40px rgba(34,197,94,0.08)' 
                  : '0 0 40px rgba(0,0,0,0.4), inset 0 0 30px rgba(255,255,255,0.02)',
              }}
            >
              {/* Crossed swords or battle icon */}
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-3">
                  <SolarIcon className="w-5 h-5 text-orange-400" />
                  <span className={`font-display text-2xl transition-colors ${pulseReady ? 'text-green-400' : 'text-white/80'}`}>⚔</span>
                  <VoidIcon className="w-5 h-5 text-cyan-400" />
                </div>
                <span className={`font-display text-lg tracking-[0.2em] transition-colors ${pulseReady ? 'text-green-400' : 'text-white/60'}`}>
                  BATTLE
                </span>
              </div>
            </div>
          </div>

          {/* Faction Selection */}
          <div 
            className="w-full rounded-xl p-4 backdrop-blur-xl mb-3"
            style={{
              background: 'linear-gradient(180deg, rgba(15,15,26,0.95) 0%, rgba(15,15,26,0.9) 100%)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 15px 40px rgba(0,0,0,0.4)',
            }}
          >
            <p className="text-[10px] text-white/40 font-body uppercase tracking-[0.2em] text-center mb-3">
              Choose Your Faction
            </p>
            <div className="flex gap-2">
              <FactionButton
                faction={FACTIONS.red}
                isSelected={currentPlayer?.team === 'red'}
                onClick={() => handleTeamChange('red')}
              />
 <button
 onClick={() => { playButtonClick(); handleTeamChange(''); }}
 className={`flex-1 py-3 rounded-lg font-display text-xs ${
 !currentPlayer?.team
 ? 'bg-white/15 text-white ring-1 ring-white/30'
 : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60'
 }`}
 >
 AUTO
 </button>
              <FactionButton
                faction={FACTIONS.blue}
                isSelected={currentPlayer?.team === 'blue'}
                onClick={() => handleTeamChange('blue')}
              />
            </div>
          </div>

          {/* Ready Status & Main Actions */}
          <div 
            className="w-full rounded-xl p-4 backdrop-blur-xl"
            style={{
              background: 'linear-gradient(180deg, rgba(15,15,26,0.95) 0%, rgba(15,15,26,0.9) 100%)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 15px 40px rgba(0,0,0,0.4)',
            }}
          >
            {/* Ready indicator */}
            <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/5">
              <div className="flex items-center gap-2.5">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                  readyCount === playerList.length
                    ? 'bg-green-500/20'
                    : 'bg-white/5'
                }`}>
                  <span className={`font-display text-base ${
                    readyCount === playerList.length ? 'text-green-400' : 'text-white/50'
                  }`}>{readyCount}</span>
                </div>
                <div>
                  <p className="font-display text-white text-xs">Combat Ready</p>
                  <p className="text-[9px] text-white/30 font-body">of {playerList.length} warriors</p>
                </div>
              </div>
              
              <div className="flex gap-1.5">
                {playerList.map((p, i) => (
                  <div 
                    key={i}
                    className={`w-2.5 h-2.5 rounded-full transition-all ${
                      p.isReady || p.isHost 
                        ? 'bg-green-400 shadow-sm shadow-green-400/50' 
                        : 'bg-white/15'
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2.5">
              {/* Ready / Start Button */}
              {isLobbyHost ? (
 <button
 onClick={() => { playButtonClick(); handleStartGame(); }}
 disabled={!canStart || isLoading || countdown !== null}
 className={`w-full py-4 rounded-lg font-display text-base relative overflow-hidden group ${
 canStart
 ? 'text-white'
 : 'bg-white/5 text-white/25 cursor-not-allowed'
 }`}
 style={canStart ? {
 background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
 boxShadow: '0 0 40px rgba(34,197,94,0.3)',
 } : undefined}
 >
 <span className="relative flex items-center justify-center gap-2">
 {countdown !== null ? (
 <span className="text-3xl font-bold">{countdown}</span>
 ) : isLoading ? (
 <>
 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24">
 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
 </svg>
 INITIATING...
 </>
 ) : (
 <>
 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
 </svg>
 COMMENCE BATTLE
 </>
 )}
 </span>
 </button>
              ) : (
 <button
 onClick={() => { playButtonClick(); handleToggleReady(); }}
 className="w-full py-4 rounded-lg font-display text-base relative overflow-hidden group text-white"
 style={{
 background: isReady
 ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
 : 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
 boxShadow: isReady
 ? '0 0 40px rgba(34,197,94,0.3)'
 : '0 0 40px rgba(249,115,22,0.3)',
 }}
 >
 <span className="relative flex items-center justify-center gap-2">
 {isReady ? (
 <>
 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
 </svg>
 BATTLE READY!
 </>
 ) : (
 <>
 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
 </svg>
 READY FOR COMBAT
 </>
 )}
 </span>
 </button>
              )}

              {/* Leave Lobby Button */}
 <button
 onClick={() => { playButtonClick(); leaveLobby(); }}
 className="w-full py-2.5 rounded-lg font-display text-xs text-white/40 hover:bg-red-500/10 hover:text-red-400 flex items-center justify-center gap-1.5"
 >
 <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
 </svg>
 Abandon Mission
 </button>
            </div>
          </div>

          {/* Unassigned Players */}
          {unassignedPlayers.length > 0 && (
            <div 
              className="w-full rounded-xl p-3 backdrop-blur-xl mt-3"
              style={{
                background: 'rgba(15,15,26,0.8)',
                border: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <p className="text-[9px] text-white/30 font-body uppercase tracking-[0.15em] mb-2 px-1">Awaiting Assignment</p>
              <div className="space-y-1.5">
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

        {/* Void Legion Panel */}
        <div className="w-52 lg:w-60 xl:w-72 2xl:w-80 h-[340px] lg:h-[380px] xl:h-[460px] 2xl:h-[520px] flex-shrink-0">
          <FactionPanel
            faction={FACTIONS.blue}
            players={voidPlayers}
            playerId={playerId}
            isLobbyHost={isLobbyHost}
            onKick={handleKick}
            reverse
          />
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div 
        className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none"
        style={{
          background: 'linear-gradient(to top, rgba(10,10,18,0.95), rgba(10,10,18,0.6), transparent)',
        }}
      >
        <div className="flex items-center justify-center py-4">
          <div className="flex items-center gap-8 px-6 py-2.5 rounded-full bg-white/[0.03] border border-white/5">
            {/* Solar count */}
            <div className="flex items-center gap-2.5">
              <div 
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: `${FACTIONS.red.primaryColor}20` }}
              >
                <SolarIcon className="w-4 h-4" style={{ color: FACTIONS.red.primaryColor }} />
              </div>
              <div>
                <span className="font-display text-sm" style={{ color: FACTIONS.red.primaryColor }}>{solarPlayers.length}</span>
                <span className="text-[9px] text-white/30 font-body ml-1.5">SOLAR</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${pulseReady ? 'bg-green-400 animate-pulse' : 'bg-white/20'}`} />
              <span className="text-[10px] text-white/40 font-body">
                {isLobbyHost 
                  ? canStart ? 'Ready for battle' : 'Awaiting warriors'
                  : isReady ? 'Awaiting commander' : 'Prepare for combat'
                }
              </span>
            </div>
            
            {/* Void count */}
            <div className="flex items-center gap-2.5">
              <div>
                <span className="text-[9px] text-white/30 font-body mr-1.5">VOID</span>
                <span className="font-display text-sm" style={{ color: FACTIONS.blue.primaryColor }}>{voidPlayers.length}</span>
              </div>
              <div 
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: `${FACTIONS.blue.primaryColor}20` }}
              >
                <VoidIcon className="w-4 h-4" style={{ color: FACTIONS.blue.primaryColor }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Faction Button Component
interface FactionButtonProps {
  faction: typeof FACTIONS.red | typeof FACTIONS.blue;
  isSelected: boolean;
  onClick: () => void;
}

function FactionButton({ faction, isSelected, onClick }: FactionButtonProps) {
  const Icon = faction.id === 'red' ? SolarIcon : VoidIcon;
  const { playButtonClick } = useUISounds();
  
  return (
 <button
 onClick={() => { playButtonClick(); onClick(); }}
 className={`flex-1 py-3 rounded-lg font-display text-xs flex items-center justify-center gap-1.5 ${
 isSelected ? 'text-white' : 'hover:text-white'
 }`}
 style={isSelected ? {
 background: `linear-gradient(135deg, ${faction.primaryColor}, ${faction.secondaryColor})`,
 boxShadow: `0 0 30px ${faction.glowColor}`,
 } : {
 background: `${faction.primaryColor}15`,
 color: `${faction.primaryColor}aa`,
 }}
 >
 <Icon className="w-3.5 h-3.5" />
 {faction.name}
 </button>
  );
}

// Faction Panel Component
interface FactionPanelProps {
  faction: typeof FACTIONS.red | typeof FACTIONS.blue;
  players: { id: string; name: string; isHost: boolean; isReady: boolean; team: string }[];
  playerId: string | null;
  isLobbyHost: boolean;
  onKick: (id: string) => void;
  reverse?: boolean;
}

function FactionPanel({ faction, players, playerId, isLobbyHost, onKick, reverse }: FactionPanelProps) {
  const maxPlayers = 5;
  const emptySlots = Math.max(0, maxPlayers - players.length);
  const Icon = faction.id === 'red' ? SolarIcon : VoidIcon;

  return (
    <div className="h-full flex flex-col">
      {/* Faction Header */}
      <div className={`flex items-center gap-3 mb-4 ${reverse ? 'flex-row-reverse' : ''}`}>
        <div 
          className="w-12 h-12 rounded-xl flex items-center justify-center shadow-lg"
          style={{
            background: `linear-gradient(135deg, ${faction.primaryColor}, ${faction.secondaryColor})`,
            boxShadow: `0 4px 20px ${faction.glowColor}`,
          }}
        >
          <Icon className="w-6 h-6 text-white" />
        </div>
        <div className={reverse ? 'text-right flex-1' : 'flex-1'}>
          <h2 className="font-display text-xl tracking-wide" style={{ color: faction.primaryColor }}>
            {faction.fullName}
          </h2>
          <div className={`flex items-center gap-2 mt-0.5 ${reverse ? 'justify-end' : ''}`}>
            <p className="text-[10px] text-white/30 font-body italic">{faction.tagline}</p>
            <span className="text-white/20">•</span>
            <div className="flex gap-1">
              {[...Array(maxPlayers)].map((_, i) => (
                <div 
                  key={i} 
                  className="w-1.5 h-1.5 rounded-full transition-all"
                  style={{ 
                    background: i < players.length ? faction.primaryColor : 'rgba(255,255,255,0.15)'
                  }} 
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Faction Container */}
      <div 
        className="flex-1 rounded-2xl overflow-hidden backdrop-blur-xl relative"
        style={{
          background: `linear-gradient(180deg, ${faction.bgGradient} 0%, rgba(15,15,26,0.95) 40%)`,
          border: `1px solid ${faction.borderColor}`,
          boxShadow: '0 20px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.03)',
        }}
      >
        {/* Top glow accent */}
        <div 
          className="absolute top-0 left-0 right-0 h-px"
          style={{
            background: `linear-gradient(90deg, transparent, ${faction.primaryColor}60, transparent)`
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
              faction={faction}
            />
          ))}

          {/* Empty state */}
          {players.length === 0 && emptySlots === maxPlayers && (
            <div className="h-full flex flex-col items-center justify-center text-center py-8">
              <div 
                className="w-16 h-16 rounded-xl flex items-center justify-center mb-4"
                style={{ 
                  background: `${faction.primaryColor}10`,
                  border: `1px solid ${faction.primaryColor}20`,
                }}
              >
                <Icon className="w-8 h-8" style={{ color: `${faction.primaryColor}30` }} />
              </div>
              <p className="font-display text-sm" style={{ color: `${faction.primaryColor}40` }}>
                Awaiting Warriors
              </p>
              <p className="text-white/20 text-[10px] font-body mt-1">Join to represent {faction.name}</p>
            </div>
          )}

          {/* Empty slots - only show if there are some players */}
          {players.length > 0 && [...Array(emptySlots)].map((_, i) => (
            <div 
              key={i} 
              className="h-12 rounded-lg border border-dashed flex items-center justify-center"
              style={{ 
                borderColor: `${faction.primaryColor}15`,
                background: `${faction.primaryColor}02`,
              }}
            >
              <span 
                className="text-[9px] uppercase tracking-widest font-body"
                style={{ color: `${faction.primaryColor}20` }}
              >
                Recruit
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
  faction?: typeof FACTIONS.red | typeof FACTIONS.blue;
  compact?: boolean;
}

function PlayerCard({ player, isCurrentPlayer, isLobbyHost, onKick, faction, compact }: PlayerCardProps) {
  const color = faction?.primaryColor || '#f97316';
  const secondaryColor = faction?.secondaryColor || '#fbbf24';
  const { playButtonClick } = useUISounds();

  return (
    <div 
      className={`flex items-center gap-3 ${compact ? 'p-2.5' : 'p-3'} rounded-xl transition-all group ${
        isCurrentPlayer 
          ? 'bg-white/[0.08] ring-1 ring-white/20' 
          : 'bg-white/[0.02] hover:bg-white/[0.05]'
      }`}
    >
      {/* Avatar with faction glow */}
      <div className="relative">
        <div 
          className={`${compact ? 'w-9 h-9 text-sm' : 'w-10 h-10 text-base'} rounded-lg flex items-center justify-center font-display text-white`}
          style={{
            background: `linear-gradient(135deg, ${color}, ${secondaryColor})`,
            boxShadow: `0 4px 15px ${color}40`,
          }}
        >
          {player.name.charAt(0).toUpperCase()}
        </div>
        {/* Online indicator */}
        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-[#0f0f1a]" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`font-display ${compact ? 'text-sm' : 'text-sm'} truncate ${isCurrentPlayer ? 'text-white' : 'text-white/80'}`}>
            {player.name}
          </span>
          {player.isHost && (
            <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[8px] font-display rounded border border-amber-500/30 uppercase">
              CMD
            </span>
          )}
          {isCurrentPlayer && !player.isHost && (
            <span className="px-1.5 py-0.5 bg-cyan-500/20 text-cyan-400 text-[8px] font-display rounded border border-cyan-500/30 uppercase">
              You
            </span>
          )}
        </div>
      </div>

      {/* Ready Status */}
      <div 
        className={`${compact ? 'w-8 h-8' : 'w-8 h-8'} rounded-lg flex items-center justify-center transition-all ${
          player.isReady || player.isHost 
            ? 'bg-green-500/15' 
            : 'bg-white/5'
        }`}
      >
        {player.isReady || player.isHost ? (
          <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <div className="w-2 h-2 bg-white/20 rounded-full animate-pulse" />
        )}
      </div>

      {/* Kick Button */}
      {isLobbyHost && !isCurrentPlayer && !player.isHost && (
 <button
 onClick={() => { playButtonClick(); onKick(); }}
 className="w-8 h-8 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 bg-red-500/10 text-red-400/60 hover:text-red-400 hover:bg-red-500/20"
 >
 <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
 </svg>
 </button>
      )}
    </div>
  );
}
