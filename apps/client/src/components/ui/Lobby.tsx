import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';
import { useUISounds } from '../../hooks/useAudio';
import { DEFAULT_GAME_CONFIG, type BotDifficulty } from '@voxel-strike/shared';
import type { LobbyPlayer } from '../../store/gameStore';
import { FACTIONS } from '../../styles/colorTokens';

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

function CrownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4 8l4.5 4L12 5l3.5 7L20 8l-1.5 10h-13L4 8z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M6.5 18h11" />
    </svg>
  );
}

function BotIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M12 5V3" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M8 5h8a4 4 0 014 4v5a4 4 0 01-4 4H8a4 4 0 01-4-4V9a4 4 0 014-4z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M9 11h.01M15 11h.01M9.5 15h5" />
    </svg>
  );
}

type LobbyTeam = 'red' | 'blue';

type InlinePickerOption<T extends string> = {
  value: T;
  label: string;
};

const BOT_DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Easy' },
  { value: 'normal', label: 'Norm' },
  { value: 'hard', label: 'Hard' },
] satisfies readonly InlinePickerOption<BotDifficulty>[];

const BOT_TEAM_OPTIONS = [
  { value: 'red', label: 'Sol' },
  { value: 'blue', label: 'Void' },
] satisfies readonly InlinePickerOption<LobbyTeam>[];

interface InlinePickerProps<T extends string> {
  label: string;
  value: T;
  options: readonly InlinePickerOption<T>[];
  accentColor: string;
  widthClass: string;
  onChange: (value: T) => void;
}

function InlinePicker<T extends string>({
  label,
  value,
  options,
  accentColor,
  widthClass,
  onChange,
}: InlinePickerProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className="relative shrink-0" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((open) => !open);
        }}
        className={`flex h-5 ${widthClass} items-center justify-between gap-1 rounded-md border px-1.5 font-body text-[9px] uppercase outline-none transition-all hover:bg-white/[0.06] focus-visible:ring-1 focus-visible:ring-white/30`}
        style={{
          background: isOpen ? `${accentColor}1f` : 'rgba(0,0,0,0.25)',
          borderColor: isOpen ? `${accentColor}80` : `${accentColor}35`,
          color: isOpen ? accentColor : 'rgba(255,255,255,0.62)',
        }}
      >
        <span className="min-w-0 truncate">{selected.label}</span>
        <svg className={`h-2.5 w-2.5 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 top-[calc(100%+0.25rem)] z-40 min-w-full overflow-hidden rounded-md border bg-strike-chrome/95 p-0.5 shadow-2xl backdrop-blur-xl"
          style={{
            borderColor: `${accentColor}42`,
            boxShadow: `0 14px 30px rgba(0,0,0,0.45), 0 0 18px ${accentColor}24`,
          }}
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={(event) => {
                  event.stopPropagation();
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className="flex h-6 w-full items-center rounded px-1.5 text-left font-body text-[9px] uppercase tracking-wide transition-colors hover:bg-white/[0.07]"
                style={{
                  background: isSelected ? `${accentColor}20` : 'transparent',
                  color: isSelected ? accentColor : 'rgba(255,255,255,0.58)',
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
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
    clearMapVote,
  } = useGameStore();
  const {
    leaveLobby,
    setLobbyReady,
    setLobbyTeam,
    addLobbyBot,
    removeLobbyBot,
    updateLobbyBotTeam,
    updateLobbyBotDifficulty,
    startGame,
    kickPlayer,
  } = useNetwork();
  const { playButtonClick } = useUISounds();

  const currentPlayer = playerId ? lobbyPlayers.get(playerId) : null;
  const currentTeam = currentPlayer?.team;
  const hasChosenTeam = currentTeam === 'red' || currentTeam === 'blue';
  const isReady = currentPlayer?.isReady || false;

  const handleToggleReady = () => {
    if (!hasChosenTeam) return;
    setLobbyReady(!isReady);
  };
  const handleTeamChange = (team: LobbyTeam) => {
    if (currentTeam === team) return;
    setLobbyTeam(team);
  };
  const handleStartGame = () => {
    clearMapVote();
    setAppPhase('map_vote');
    startGame();
  };
  const handleKick = (targetId: string) => kickPlayer(targetId);

  const playerList = Array.from(lobbyPlayers.values());
  const readyCount = playerList.filter(p => p.isReady || p.isHost).length;
  const assignedCount = playerList.filter(p => p.team === 'red' || p.team === 'blue').length;
  const allPlayersAssigned = playerList.length > 0 && assignedCount === playerList.length;
  const canStart = isLobbyHost && allPlayersAssigned && (playerList.length === 1 || readyCount === playerList.length);

  const solarPlayers = playerList.filter(p => p.team === 'red');
  const voidPlayers = playerList.filter(p => p.team === 'blue');

  const currentFaction = currentPlayer?.team === 'red' ? FACTIONS.red : currentPlayer?.team === 'blue' ? FACTIONS.blue : null;

  const handleBack = () => {
    leaveLobby();
    setAppPhase('browsing_lobbies');
  };

  const handleAddBot = (team: LobbyTeam) => {
    playButtonClick();
    addLobbyBot({ difficulty: 'normal', team });
  };

  const handleRemoveBot = (botId: string) => {
    playButtonClick();
    removeLobbyBot(botId);
  };

  const handleBotTeamChange = (botId: string, team: LobbyTeam) => {
    updateLobbyBotTeam(botId, team);
  };

  const handleBotDifficultyChange = (botId: string, difficulty: BotDifficulty) => {
    updateLobbyBotDifficulty(botId, difficulty);
  };

  return (
    <div className="menu-screen bg-strike-bg">
      {/* Cinematic Background */}
      <div className="absolute inset-0">
        {/* Background image */}
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: 'url(/bg.jpg)' }}
        />
        
        {/* Dark overlay gradient */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to bottom, rgb(var(--color-strike-page-top) / 0.85), rgb(var(--color-strike-page-mid) / 0.8), rgb(var(--color-strike-page-bottom) / 0.95))',
          }}
        />
        
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
        <div
          className="absolute bottom-0 left-0 right-0 h-1/3"
          style={{
            background: 'linear-gradient(to top, rgb(var(--color-strike-page-top)), transparent)',
          }}
        />
        
        {/* Vignette */}
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{ boxShadow: 'inset 0 0 200px 80px rgba(0,0,0,0.7)' }}
        />
      </div>

      {/* Top Navigation Bar */}
      <nav className="absolute top-0 left-0 right-0 z-20">
        <div className="menu-nav flex items-center justify-between gap-4">
          {/* Back button and lobby info */}
          <div className="flex min-w-0 items-center gap-3 xl:gap-4">
            <button
              onClick={() => { playButtonClick(); handleBack(); }}
              className="w-10 h-10 shrink-0 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 hover:border-white/20 group"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            
            <div className="flex h-10 min-w-0 items-center">
              <h1 className="font-display translate-y-[0.08em] text-xl xl:text-2xl leading-none text-white tracking-wide truncate">{currentLobbyName || 'Game Lobby'}</h1>
            </div>
          </div>

          {/* Right side - Player info */}
          <div className="flex shrink-0 items-center gap-3 xl:gap-4">
            <div 
              className="flex items-center gap-3 py-2 pl-2 pr-4 rounded-xl border"
              style={{
                background: currentFaction 
                  ? `linear-gradient(135deg, ${currentFaction.bgGradient}, rgb(var(--color-strike-panel-raised) / 0.9))`
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
      <div className="menu-main menu-main-play">
        <div className="lobby-layout menu-content-wide">
        {/* Solar Vanguard Panel */}
        <div className="lobby-team-panel">
          <FactionPanel
            faction={FACTIONS.red}
            players={solarPlayers}
            playerId={playerId}
            isSelected={currentTeam === 'red'}
            isLobbyHost={isLobbyHost}
            onSelect={() => handleTeamChange('red')}
            onAddBot={handleAddBot}
            onKick={handleKick}
            onRemoveBot={handleRemoveBot}
            onBotTeamChange={handleBotTeamChange}
            onBotDifficultyChange={handleBotDifficultyChange}
          />
        </div>

        {/* Void Legion Panel */}
        <div className="lobby-team-panel">
          <FactionPanel
            faction={FACTIONS.blue}
            players={voidPlayers}
            playerId={playerId}
            isSelected={currentTeam === 'blue'}
            isLobbyHost={isLobbyHost}
            onSelect={() => handleTeamChange('blue')}
            onAddBot={handleAddBot}
            onKick={handleKick}
            onRemoveBot={handleRemoveBot}
            onBotTeamChange={handleBotTeamChange}
            onBotDifficultyChange={handleBotDifficultyChange}
            reverse
          />
        </div>
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20"
        style={{
          background: 'linear-gradient(to top, rgb(var(--color-strike-page-top) / 0.95), rgb(var(--color-strike-page-top) / 0.6), transparent)',
        }}
      >
        <div className="flex items-center justify-center py-2 xl:py-4">
          <div className="flex items-center gap-3 xl:gap-4 px-4 xl:px-5 py-2 rounded-full bg-white/[0.035] border border-white/5 backdrop-blur-xl shadow-2xl shadow-black/30">
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
            
            {isLobbyHost ? (
              <button
                type="button"
                onClick={() => { playButtonClick(); handleStartGame(); }}
                disabled={!canStart || isLoading}
                className={`h-10 min-w-[12.5rem] rounded-full px-5 font-display text-xs uppercase tracking-wide transition-all ${
                  canStart
                    ? 'text-white hover:brightness-110 active:scale-[0.98]'
                    : 'bg-white/[0.055] text-white/30 cursor-not-allowed'
                }`}
                style={canStart ? {
                  background: 'linear-gradient(135deg, rgb(var(--color-ui-success)) 0%, rgb(var(--color-ui-success-deep)) 100%)',
                  boxShadow: '0 0 32px rgb(var(--color-ui-success) / 0.28)',
                } : undefined}
              >
                <span className="flex items-center justify-center gap-2">
                  {isLoading ? (
                    <>
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Opening Vote
                    </>
                  ) : !allPlayersAssigned ? (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4z" />
                      </svg>
                      Awaiting Teams
                    </>
                  ) : !canStart ? (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Awaiting Warriors
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Map Vote
                    </>
                  )}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { playButtonClick(); handleToggleReady(); }}
                disabled={!hasChosenTeam || isLoading}
                className={`h-10 min-w-[12.5rem] rounded-full px-5 font-display text-xs uppercase tracking-wide transition-all ${
                  hasChosenTeam
                    ? 'text-white hover:brightness-110 active:scale-[0.98]'
                    : 'bg-white/[0.055] text-white/30 cursor-not-allowed'
                }`}
                style={hasChosenTeam ? {
                  background: isReady
                    ? 'linear-gradient(135deg, rgb(var(--color-ui-success)) 0%, rgb(var(--color-ui-success-deep)) 100%)'
                    : 'linear-gradient(135deg, rgb(var(--color-accent-primary)) 0%, rgb(var(--color-accent-primary-deep)) 100%)',
                  boxShadow: isReady
                    ? '0 0 32px rgb(var(--color-ui-success) / 0.28)'
                    : '0 0 32px rgb(var(--color-accent-primary) / 0.28)',
                } : undefined}
              >
                <span className="flex items-center justify-center gap-2">
                  {!hasChosenTeam ? (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4z" />
                      </svg>
                      Team Unassigned
                    </>
                  ) : isReady ? (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      Battle Ready
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      Ready For Combat
                    </>
                  )}
                </span>
              </button>
            )}
            
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

// Faction Panel Component
interface FactionPanelProps {
  faction: typeof FACTIONS.red | typeof FACTIONS.blue;
  players: LobbyPlayer[];
  playerId: string | null;
  isSelected: boolean;
  isLobbyHost: boolean;
  onSelect: () => void;
  onAddBot: (team: LobbyTeam) => void;
  onKick: (id: string) => void;
  onRemoveBot: (id: string) => void;
  onBotTeamChange: (id: string, team: LobbyTeam) => void;
  onBotDifficultyChange: (id: string, difficulty: BotDifficulty) => void;
  reverse?: boolean;
}

function FactionPanel({
  faction,
  players,
  playerId,
  isSelected,
  isLobbyHost,
  onSelect,
  onAddBot,
  onKick,
  onRemoveBot,
  onBotTeamChange,
  onBotDifficultyChange,
  reverse,
}: FactionPanelProps) {
  const maxPlayers = DEFAULT_GAME_CONFIG.teamSize;
  const emptySlots = Math.max(0, maxPlayers - players.length);
  const Icon = faction.id === 'red' ? SolarIcon : VoidIcon;
  const canJoin = !isSelected && emptySlots > 0;
  const canAddBot = isLobbyHost && emptySlots > 0;
  const factionTeam = faction.id as LobbyTeam;

  return (
    <div className="h-full flex flex-col">
      {/* Faction Header */}
      <div className={`flex items-center gap-2 xl:gap-3 mb-3 xl:mb-4 ${reverse ? 'flex-row-reverse' : ''}`}>
        <div 
          className="w-10 h-10 xl:w-12 xl:h-12 rounded-xl border flex shrink-0 items-center justify-center"
          style={{
            background: isSelected ? `${faction.primaryColor}28` : `${faction.primaryColor}16`,
            borderColor: isSelected ? `${faction.primaryColor}70` : `${faction.primaryColor}35`,
          }}
        >
          <Icon className="w-5 h-5 xl:w-6 xl:h-6" style={{ color: faction.primaryColor }} />
        </div>
        <div className={`min-w-0 ${reverse ? 'text-right flex-1' : 'flex-1'}`}>
          <div className={`flex items-center gap-2 ${reverse ? 'justify-end' : ''}`}>
            <h2 className="min-w-0 font-display text-lg xl:text-xl 2xl:text-2xl tracking-wide truncate" style={{ color: faction.primaryColor }}>
              {faction.fullName}
            </h2>
            {isSelected && (
              <span className="w-5 h-5 rounded-full bg-green-500/15 text-green-400 flex shrink-0 items-center justify-center">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </span>
            )}
          </div>
          <div className={`flex gap-1 mt-1.5 ${reverse ? 'justify-end' : ''}`}>
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

      <div className="flex-1 space-y-1.5 px-1 py-1">
        {players.map((player) => (
          <PlayerCard
            key={player.id}
            player={player}
            isCurrentPlayer={player.id === playerId}
            isLobbyHost={isLobbyHost}
            onKick={() => onKick(player.id)}
            onRemoveBot={() => onRemoveBot(player.id)}
            onBotTeamChange={(team) => onBotTeamChange(player.id, team)}
            onBotDifficultyChange={(difficulty) => onBotDifficultyChange(player.id, difficulty)}
            faction={faction}
          />
        ))}

        {(canJoin || canAddBot) && (
          <JoinTeamCard
            faction={faction}
            reverse={reverse}
            canJoin={canJoin}
            canAddBot={canAddBot}
            onJoin={onSelect}
            onAddBot={() => onAddBot(factionTeam)}
          />
        )}
      </div>
    </div>
  );
}

interface JoinTeamCardProps {
  faction: typeof FACTIONS.red | typeof FACTIONS.blue;
  reverse?: boolean;
  canJoin: boolean;
  canAddBot: boolean;
  onJoin: () => void;
  onAddBot: () => void;
}

function JoinTeamCard({ faction, reverse, canJoin, canAddBot, onJoin, onAddBot }: JoinTeamCardProps) {
  const Icon = faction.id === 'red' ? SolarIcon : VoidIcon;
  const { playButtonClick } = useUISounds();

  return (
    <div className={`flex h-14 w-full items-stretch gap-2 ${reverse ? 'flex-row-reverse' : ''}`}>
      {canJoin && (
        <button
          type="button"
          onClick={() => { playButtonClick(); onJoin(); }}
          className={`group flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-dashed p-2 transition-all hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
            reverse ? 'flex-row-reverse text-right' : ''
          }`}
          style={{
            background: 'rgb(var(--color-strike-panel-raised) / 0.16)',
            borderColor: `${faction.primaryColor}30`,
          }}
        >
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors group-hover:bg-white/[0.04]"
            style={{
              borderColor: `${faction.primaryColor}32`,
              color: faction.primaryColor,
            }}
          >
            <Icon className="h-5 w-5 opacity-80" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm uppercase tracking-wide" style={{ color: faction.primaryColor }}>
              Join
            </p>
            <p className="mt-0.5 text-[9px] font-body uppercase tracking-widest text-white/25">
              {faction.name}
            </p>
          </div>
        </button>
      )}

      {canAddBot && (
        <button
          type="button"
          onClick={() => { playButtonClick(); onAddBot(); }}
          aria-label={`Add ${faction.name} bot`}
          title="Add bot"
          className="group relative flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-dashed bg-cyan-500/[0.055] text-cyan-300 transition-all hover:bg-cyan-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
          style={{
            borderColor: `${faction.primaryColor}28`,
          }}
        >
          <BotIcon className="h-5 w-5" />
          <span className="absolute right-2 top-1.5 font-display text-[11px] leading-none">+</span>
        </button>
      )}
    </div>
  );
}

// Player Card Component
interface PlayerCardProps {
  player: LobbyPlayer;
  isCurrentPlayer: boolean;
  isLobbyHost: boolean;
  onKick: () => void;
  onRemoveBot: () => void;
  onBotTeamChange?: (team: LobbyTeam) => void;
  onBotDifficultyChange?: (difficulty: BotDifficulty) => void;
  faction?: typeof FACTIONS.red | typeof FACTIONS.blue;
  compact?: boolean;
}

function PlayerCard({
  player,
  isCurrentPlayer,
  isLobbyHost,
  onKick,
  onRemoveBot,
  onBotTeamChange,
  onBotDifficultyChange,
  faction,
  compact,
}: PlayerCardProps) {
  const color = faction?.primaryColor || FACTIONS.red.primaryColor;
  const secondaryColor = faction?.secondaryColor || FACTIONS.red.secondaryColor;
  const { playButtonClick } = useUISounds();
  const cardClass = compact ? 'h-12 p-2' : 'h-14 p-2';
  const avatarClass = compact ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-base';
  const readyClass = compact ? 'w-8 h-8' : 'w-9 h-9';
  const botDifficulty: BotDifficulty =
    player.botDifficulty === 'easy' || player.botDifficulty === 'hard'
      ? player.botDifficulty
      : 'normal';
  const botTeam: LobbyTeam = player.team === 'blue' ? 'blue' : 'red';

  return (
    <div
      className={`group relative flex w-full min-w-0 items-center gap-3 ${cardClass} rounded-xl transition-all ${
        isCurrentPlayer 
          ? 'bg-white/[0.08] ring-1 ring-inset ring-white/20'
          : 'bg-white/[0.02] hover:bg-white/[0.05]'
      }`}
    >
      <div
        className={`${avatarClass} rounded-lg flex shrink-0 items-center justify-center font-display text-white`}
        style={{
          background: `linear-gradient(135deg, ${color}, ${secondaryColor})`,
          boxShadow: `0 4px 15px ${color}40`,
        }}
      >
        {player.name.charAt(0).toUpperCase()}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`font-display ${compact ? 'text-sm' : 'text-sm'} truncate ${isCurrentPlayer ? 'text-white' : 'text-white/80'}`}>
            {player.name}
          </span>
          {player.isHost && (
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-amber-500/30 bg-amber-500/15 text-amber-300"
              title="Commander"
            >
              <CrownIcon className="h-3.5 w-3.5" />
            </span>
          )}
          {!player.isHost && player.isBot && (
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-cyan-500/30 bg-cyan-500/15 text-cyan-300"
              title="Bot"
            >
              <BotIcon className="h-3.5 w-3.5" />
            </span>
          )}
          {!player.isHost && player.isBot && isLobbyHost && (
            <div className="flex shrink-0 items-center gap-1">
              <InlinePicker
                label={`${player.name} difficulty`}
                value={botDifficulty}
                options={BOT_DIFFICULTY_OPTIONS}
                accentColor={FACTIONS.blue.primaryColor}
                widthClass="w-[3.65rem]"
                onChange={(difficulty) => onBotDifficultyChange?.(difficulty)}
              />
              <InlinePicker
                label={`${player.name} team`}
                value={botTeam}
                options={BOT_TEAM_OPTIONS}
                accentColor={color}
                widthClass="w-[3.35rem]"
                onChange={(team) => onBotTeamChange?.(team)}
              />
            </div>
          )}
          {isCurrentPlayer && !player.isHost && (
            <span className="px-1.5 py-0.5 bg-cyan-500/20 text-cyan-400 text-[8px] font-display rounded border border-cyan-500/30 uppercase">
              You
            </span>
          )}
        </div>
      </div>

      {!player.isBot && (
        <div
          className={`${readyClass} rounded-lg flex shrink-0 items-center justify-center transition-all ${
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
      )}

      {/* Kick Button */}
      {isLobbyHost && !isCurrentPlayer && !player.isHost && (
 <button
 onClick={(event) => { event.stopPropagation(); playButtonClick(); player.isBot ? onRemoveBot() : onKick(); }}
 className="absolute right-2 top-1/2 z-10 h-8 w-8 -translate-y-1/2 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 bg-red-500/10 text-red-400/60 hover:text-red-400 hover:bg-red-500/20"
 >
 <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
 </svg>
 </button>
      )}
    </div>
  );
}
