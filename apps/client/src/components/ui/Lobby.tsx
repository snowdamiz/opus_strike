import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useGameStore } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';
import { useUISounds } from '../../hooks/useUiAudio';
import {
  ALL_HERO_IDS,
  DEFAULT_GAME_CONFIG,
  HERO_DEFINITIONS,
  getGameplayModeLabel,
  getGameplayModeRules,
  getPickedTeamHeroIds,
  getTeamCatalogForGameplayMode,
  getTeamCatalogEntry,
  isTeamIdForGameplayMode,
  type BotDifficulty,
  type HeroId,
  type Team,
} from '@voxel-strike/shared';
import type { LobbyPlayer } from '../../store/types';
import { BLAZE_UI_COLORS, FACTIONS, TEAM_FALLBACK_COLORS } from '../../styles/colorTokens';
import { RankIcon, getRankForStats } from './RankBadge';
import { SocialBox, SocialButton, useSocialBadgeCount } from './SocialBox';
import { DailyMissionTracker } from './DailyMissionTracker';

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

function SquadIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 10a3 3 0 100-6 3 3 0 000 6zM16 10a3 3 0 100-6 3 3 0 000 6z" fill="currentColor" opacity="0.82" />
      <path d="M4 20a4 4 0 018 0M12 20a4 4 0 018 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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

function InvitePlayerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M15 19a6 6 0 00-12 0" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M9 11a4 4 0 100-8 4 4 0 000 8z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M19 8v6m3-3h-6" />
    </svg>
  );
}

function ObserverIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 12s3.2-6 9-6 9 6 9 6-3.2 6-9 6-9-6-9-6z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}

type LobbyTeam = Team;
type LobbyBotHero = HeroId | '';

type LobbyFaction = {
  id: Team;
  name: string;
  fullName: string;
  primaryColor: string;
  secondaryColor: string;
  glowColor: string;
  bgColor: string;
};

function factionFromCatalog(team: Team): LobbyFaction {
  if (team === 'red') return FACTIONS.red;
  if (team === 'blue') return FACTIONS.blue;
  const entry = getTeamCatalogEntry(team);
  return {
    id: team,
    name: entry?.compactLabel ?? team.toUpperCase(),
    fullName: entry?.label ?? team,
    primaryColor: entry?.color ?? TEAM_FALLBACK_COLORS.primaryColor,
    secondaryColor: entry?.accentColor ?? TEAM_FALLBACK_COLORS.secondaryColor,
    glowColor: entry ? `${entry.color}66` : TEAM_FALLBACK_COLORS.glowColor,
    bgColor: entry ? `${entry.color}1a` : TEAM_FALLBACK_COLORS.bgColor,
  };
}

type InlinePickerOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
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

const BOT_HERO_OPTIONS: readonly InlinePickerOption<LobbyBotHero>[] = [
  { value: '', label: 'Random' },
  ...ALL_HERO_IDS.map((heroId) => ({
    value: heroId,
    label: HERO_DEFINITIONS[heroId].name,
  })),
];
const EMPTY_HERO_LOCKS = new Set<HeroId>();
const OBSERVER_LOBBY_FACTION: LobbyFaction = {
  id: 'blue',
  name: 'Observer',
  fullName: 'Observer',
  primaryColor: 'rgb(var(--color-accent-primary))',
  secondaryColor: 'rgb(var(--color-accent-primary-deep))',
  glowColor: 'rgb(var(--color-accent-primary) / 0.35)',
  bgColor: 'rgb(var(--color-accent-primary) / 0.12)',
};

function isHeroId(value: string | undefined): value is HeroId {
  return ALL_HERO_IDS.includes(value as HeroId);
}

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
        title={selected.disabledReason}
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
            const isDisabled = option.disabled === true;
            return (
              <button
                key={option.value || option.label}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={isDisabled}
                title={option.disabledReason}
                onClick={(event) => {
                  event.stopPropagation();
                  if (isDisabled) return;
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`flex h-6 w-full items-center whitespace-nowrap rounded px-1.5 text-left font-body text-[9px] uppercase tracking-wide transition-colors ${
                  isDisabled ? 'cursor-not-allowed opacity-35' : 'hover:bg-white/[0.07]'
                }`}
                style={{
                  background: isSelected ? `${accentColor}20` : 'transparent',
                  color: isDisabled ? 'rgba(255,255,255,0.32)' : isSelected ? accentColor : 'rgba(255,255,255,0.58)',
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
    currentLobbyId,
    currentLobbyName, 
    gameplayMode,
    lobbyPlayers, 
    isLobbyHost,
    lobbyError,
    isLoading,
    userStats,
    userId,
    matchmakingStatus,
    setAppPhase,
    clearMapVote,
    setLobbyError,
  } = useGameStore(
    useShallow((state) => ({
      playerName: state.playerName,
      playerId: state.playerId,
      currentLobbyId: state.currentLobbyId,
      currentLobbyName: state.currentLobbyName,
      gameplayMode: state.gameplayMode,
      lobbyPlayers: state.lobbyPlayers,
      isLobbyHost: state.isLobbyHost,
      lobbyError: state.lobbyError,
      isLoading: state.isLoading,
      userStats: state.userStats,
      userId: state.userId,
      matchmakingStatus: state.matchmakingStatus,
      setAppPhase: state.setAppPhase,
      clearMapVote: state.clearMapVote,
      setLobbyError: state.setLobbyError,
    }))
  );
  const {
    leaveLobby,
    setLobbyReady,
    setLobbyTeam,
    setLobbyObserver,
    addLobbyBot,
    removeLobbyBot,
    updateLobbyBotTeam,
    updateLobbyBotDifficulty,
    updateLobbyBotHero,
    startGame,
    kickPlayer,
  } = useNetwork();
  const { playButtonClick } = useUISounds();
  const [showSocial, setShowSocial] = useState(false);
  const socialBadgeCount = useSocialBadgeCount();
  const isAuthenticated = Boolean(userId);

  const currentPlayer = playerId ? lobbyPlayers.get(playerId) : null;
  const currentTeam = currentPlayer?.team;
  const teamEntries = useMemo(() => getTeamCatalogForGameplayMode(gameplayMode), [gameplayMode]);
  const gameplayRules = getGameplayModeRules(gameplayMode);
  const isBattleRoyal = gameplayMode === 'battle_royal';
  const hasChosenTeam = isTeamIdForGameplayMode(currentTeam, gameplayMode);
  const isObserving = currentPlayer?.role === 'observer';
  const hasChosenRole = hasChosenTeam || isObserving;
  const isReady = currentPlayer?.isReady || false;
  const currentRank = currentPlayer?.rank ?? getRankForStats(userStats);
  const {
    combatPlayers,
    readyCount,
    assignedCount,
    solarPlayers,
    voidPlayers,
    observerPlayers,
    teamPlayers,
    pickedHeroIdsByTeam,
    pickedHeroIdsByTeamMap,
  } = useMemo(() => {
    const nextCombatPlayers: LobbyPlayer[] = [];
    const nextObserverPlayers: LobbyPlayer[] = [];
    const nextTeamPlayers = new Map<Team, LobbyPlayer[]>(teamEntries.map((entry) => [entry.id, []]));
    let nextReadyCount = 0;
    let nextAssignedCount = 0;

    for (const player of lobbyPlayers.values()) {
      if (player.role === 'observer') {
        nextObserverPlayers.push(player);
        continue;
      }

      nextCombatPlayers.push(player);

      if (player.isReady || player.isHost) {
        nextReadyCount += 1;
      }

      const teamGroup = nextTeamPlayers.get(player.team);
      const isAssigned = Boolean(teamGroup);
      if (!isAssigned) {
        continue;
      }

      nextAssignedCount += 1;
      teamGroup?.push(player);
    }
    const nextSolarPlayers = nextTeamPlayers.get('red') ?? [];
    const nextVoidPlayers = nextTeamPlayers.get('blue') ?? [];
    const nextPickedHeroIdsByTeamMap = new Map<Team, ReadonlySet<HeroId>>();
    for (const [team, players] of nextTeamPlayers) {
      nextPickedHeroIdsByTeamMap.set(team, getPickedTeamHeroIds(players, team));
    }

    return {
      combatPlayers: nextCombatPlayers,
      readyCount: nextReadyCount,
      assignedCount: nextAssignedCount,
      solarPlayers: nextSolarPlayers,
      voidPlayers: nextVoidPlayers,
      observerPlayers: nextObserverPlayers,
      teamPlayers: nextTeamPlayers,
      pickedHeroIdsByTeam: {
        red: getPickedTeamHeroIds(nextSolarPlayers, 'red'),
        blue: getPickedTeamHeroIds(nextVoidPlayers, 'blue'),
      },
      pickedHeroIdsByTeamMap: nextPickedHeroIdsByTeamMap,
    };
  }, [lobbyPlayers, teamEntries]);
  const currentMatchMode = matchmakingStatus.matchMode ?? null;
  const botsAllowed = currentMatchMode === 'custom';
  const invitesAllowed = currentMatchMode === 'custom';
  const observersAllowed = currentMatchMode === 'custom' && !isBattleRoyal;

  const handleToggleReady = () => {
    if (!hasChosenRole) return;
    setLobbyError(null);
    setLobbyReady(!isReady);
  };
  const handleTeamChange = (team: LobbyTeam) => {
    if (currentTeam === team) return;
    setLobbyError(null);
    setLobbyTeam(team);
  };
  const handleObserverJoin = () => {
    if (isObserving) return;
    setLobbyError(null);
    setLobbyObserver(true);
  };
  const handleStartGame = () => {
    setLobbyError(null);
    clearMapVote();
    setAppPhase('map_vote');
    startGame();
  };
  const handleKick = (targetId: string) => kickPlayer(targetId);

  const allPlayersAssigned = combatPlayers.length > 0 && assignedCount === combatPlayers.length;
  const isProductionCustomLobby = import.meta.env.PROD
    && currentMatchMode === 'custom';
  const minimumParticipantsToStart = isBattleRoyal
    ? gameplayRules.minPlayers
    : isProductionCustomLobby
      ? gameplayRules.minPlayers
      : 1;
  const hasMinimumParticipants = combatPlayers.length >= minimumParticipantsToStart;
  const canStart = isLobbyHost && hasMinimumParticipants && allPlayersAssigned && (combatPlayers.length === 1 || readyCount === combatPlayers.length);

  const currentFaction = currentPlayer?.team ? factionFromCatalog(currentPlayer.team) : null;
  const currentRoleLabel = isObserving ? 'Observer' : currentFaction?.fullName || 'Unassigned';
  const gameplayModeLabel = getGameplayModeLabel(gameplayMode);
  const currentRoleColor = isObserving ? 'rgb(var(--color-accent-primary))' : currentFaction?.primaryColor || 'rgb(var(--color-strike-border) / 0.4)';

  const handleBack = () => {
    leaveLobby();
    setAppPhase('menu');
  };

  const handleAddBot = (team: LobbyTeam) => {
    playButtonClick();
    addLobbyBot({ difficulty: 'normal', team });
  };

  const handleInvitePlayer = () => {
    setShowSocial(true);
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

  const handleBotHeroChange = (botId: string, heroId: LobbyBotHero) => {
    updateLobbyBotHero(botId, heroId);
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
              type="button"
              onClick={() => { playButtonClick(); handleBack(); }}
              className="menu-back-button"
              aria-label="Back to play"
            >
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            
            <div className="flex h-10 min-w-0 flex-col justify-center">
              <h1 className="font-display translate-y-[0.08em] text-xl xl:text-2xl leading-none text-white tracking-wide truncate">{currentLobbyName || 'Game Lobby'}</h1>
              <p className="mt-1 truncate font-body text-[10px] uppercase tracking-widest text-white/35">{gameplayModeLabel}</p>
            </div>
          </div>

          {/* Right side - Player info */}
          <div className="flex shrink-0 items-center gap-3 xl:gap-4">
            {isAuthenticated && (
              <SocialButton
                badgeCount={socialBadgeCount}
                onClick={() => {
                  playButtonClick();
                  setShowSocial(true);
                }}
              />
            )}
            <div 
              className="flex items-center gap-3"
            >
              <RankIcon rank={currentRank} size={34} labelled className="shrink-0" />
              <div>
                <p className="font-display text-white text-sm">{playerName}</p>
                <p className="text-[10px] font-body" style={{ color: currentRoleColor }}>
                  {currentRoleLabel}
                </p>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <DailyMissionTracker
        enabled={isAuthenticated}
        className="absolute left-4 top-[5.35rem] z-20 w-[min(23rem,calc(100vw-2rem))] sm:left-6 xl:left-8"
      />

      {/* Main Content */}
      <div className="team-select-main menu-main menu-main-play">
        {isBattleRoyal ? (
          <BattleRoyalLobbyGrid
            teamEntries={teamEntries}
            teamPlayers={teamPlayers}
            currentTeam={currentTeam}
            playerId={playerId}
            isLobbyHost={isLobbyHost}
            invitesAllowed={invitesAllowed}
            maxPlayersPerTeam={gameplayRules.maxTeamSize}
            combatPlayerCount={combatPlayers.length}
            maxCombatPlayers={gameplayRules.maxPlayers}
            onTeamChange={handleTeamChange}
            onInvite={handleInvitePlayer}
            onKick={handleKick}
            onRemoveBot={handleRemoveBot}
            pickedHeroIdsByTeam={pickedHeroIdsByTeamMap}
          />
        ) : (
          <div className={`team-select-layout lobby-layout menu-content-wide ${observersAllowed ? 'lobby-layout-observer' : ''}`}>
            <div className="lobby-team-header-row">
              <FactionHeader
                faction={FACTIONS.red}
                players={solarPlayers}
                isSelected={currentTeam === 'red'}
              />

              {observersAllowed ? (
                <div className="lobby-observer-header">
                  <ObserverIcon className="h-5 w-5" />
                  <span>Observer</span>
                </div>
              ) : (
                <div aria-hidden="true" />
              )}

              <FactionHeader
                faction={FACTIONS.blue}
                players={voidPlayers}
                isSelected={currentTeam === 'blue'}
                reverse
              />
            </div>

            {/* Solar Vanguard Panel */}
            <div className="lobby-team-panel">
              <FactionPanel
                faction={FACTIONS.red}
                players={solarPlayers}
                playerId={playerId}
                isSelected={currentTeam === 'red'}
                isLobbyHost={isLobbyHost}
                botsAllowed={botsAllowed}
                invitesAllowed={invitesAllowed}
                onSelect={() => handleTeamChange('red')}
                onAddBot={handleAddBot}
                onInvite={handleInvitePlayer}
                onKick={handleKick}
                onRemoveBot={handleRemoveBot}
                onBotTeamChange={handleBotTeamChange}
                onBotDifficultyChange={handleBotDifficultyChange}
                onBotHeroChange={handleBotHeroChange}
                pickedHeroIds={pickedHeroIdsByTeam.red}
              />
            </div>

            {observersAllowed && (
              <ObserverPanel
                players={observerPlayers}
                playerId={playerId}
                isSelected={isObserving}
                isLobbyHost={isLobbyHost}
                onSelect={handleObserverJoin}
                onKick={handleKick}
              />
            )}

            {/* Void Legion Panel */}
            <div className="lobby-team-panel">
              <FactionPanel
                faction={FACTIONS.blue}
                players={voidPlayers}
                playerId={playerId}
                isSelected={currentTeam === 'blue'}
                isLobbyHost={isLobbyHost}
                botsAllowed={botsAllowed}
                invitesAllowed={invitesAllowed}
                onSelect={() => handleTeamChange('blue')}
                onAddBot={handleAddBot}
                onInvite={handleInvitePlayer}
                onKick={handleKick}
                onRemoveBot={handleRemoveBot}
                onBotTeamChange={handleBotTeamChange}
                onBotDifficultyChange={handleBotDifficultyChange}
                onBotHeroChange={handleBotHeroChange}
                pickedHeroIds={pickedHeroIdsByTeam.blue}
                reverse
              />
            </div>
          </div>
        )}
      </div>

      {/* Bottom Status Bar */}
      <div
        className="lobby-bottom-bar absolute bottom-0 left-0 right-0 z-20"
        style={{
          background: 'linear-gradient(to top, rgb(var(--color-strike-page-top) / 0.95), rgb(var(--color-strike-page-top) / 0.6), transparent)',
        }}
      >
        {lobbyError && (
          <div className="lobby-error mx-auto mb-2 max-w-xl rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-center text-sm text-red-200">
            {lobbyError}
          </div>
        )}
        <div className="lobby-bottom-bar-inner flex items-center justify-center py-2 xl:py-4">
          <div className="lobby-action-bar flex items-center gap-3 xl:gap-4 px-4 xl:px-5 py-2 rounded-full bg-white/[0.035] border border-white/5 backdrop-blur-xl shadow-2xl shadow-black/30">
            {isBattleRoyal ? (
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500/15">
                  <SquadIcon className="h-4 w-4 text-orange-300" />
                </div>
                <div>
                  <span className="font-display text-sm text-orange-200">{combatPlayers.length}</span>
                  <span className="ml-1.5 font-body text-[9px] text-white/30">PLAYERS</span>
                </div>
              </div>
            ) : (
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
            )}

            {isLobbyHost ? (
              <button
                type="button"
                onClick={() => { playButtonClick(); handleStartGame(); }}
                disabled={!canStart || isLoading}
                className={`lobby-primary-action h-10 min-w-[12.5rem] rounded-full px-5 font-display text-xs uppercase tracking-wide transition-all ${
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
                disabled={!hasChosenRole || isLoading}
                className={`lobby-primary-action h-10 min-w-[12.5rem] rounded-full px-5 font-display text-xs uppercase tracking-wide transition-all ${
                  hasChosenRole
                    ? 'text-white hover:brightness-110 active:scale-[0.98]'
                    : 'bg-white/[0.055] text-white/30 cursor-not-allowed'
                }`}
                style={hasChosenRole ? {
                  background: isReady
                    ? 'linear-gradient(135deg, rgb(var(--color-ui-success)) 0%, rgb(var(--color-ui-success-deep)) 100%)'
                    : 'linear-gradient(135deg, rgb(var(--color-accent-primary)) 0%, rgb(var(--color-accent-primary-deep)) 100%)',
                  boxShadow: isReady
                    ? '0 0 32px rgb(var(--color-ui-success) / 0.28)'
                    : '0 0 32px rgb(var(--color-accent-primary) / 0.28)',
                } : undefined}
              >
                <span className="flex items-center justify-center gap-2">
                  {!hasChosenRole ? (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4z" />
                      </svg>
                      Team Unassigned
                    </>
                  ) : isObserving ? (
                    <>
                      <ObserverIcon className="h-4 w-4" />
                      Observing
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
            
            {isBattleRoyal ? (
              <div className="flex items-center gap-2.5">
                <div>
                  <span className="mr-1.5 font-body text-[9px] text-white/30">SQUADS</span>
                  <span className="font-display text-sm text-cyan-200">
                    {Array.from(teamPlayers.values()).filter((players) => players.length > 0).length}/{teamEntries.length}
                  </span>
                </div>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/15">
                  <SquadIcon className="h-4 w-4 text-cyan-200" />
                </div>
              </div>
            ) : (
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
            )}
          </div>
        </div>
      </div>

      {showSocial && isAuthenticated && (
        <SocialBox onClose={() => setShowSocial(false)} />
      )}
    </div>
  );
}

interface ObserverPanelProps {
  players: LobbyPlayer[];
  playerId: string | null;
  isSelected: boolean;
  isLobbyHost: boolean;
  onSelect: () => void;
  onKick: (id: string) => void;
}

function ObserverPanel({
  players,
  playerId,
  isSelected,
  isLobbyHost,
  onSelect,
  onKick,
}: ObserverPanelProps) {
  const { playButtonClick } = useUISounds();
  const observer = players[0] ?? null;
  const canJoin = !observer && !isSelected;

  return (
    <div className="lobby-center-panel lobby-observer-panel">
      {observer ? (
        <PlayerCard
          player={observer}
          isCurrentPlayer={observer.id === playerId}
          isLobbyHost={isLobbyHost}
          botsAllowed={false}
          onKick={() => onKick(observer.id)}
          onRemoveBot={() => undefined}
          pickedHeroIds={EMPTY_HERO_LOCKS}
          faction={OBSERVER_LOBBY_FACTION}
          compact
        />
      ) : (
        <button
          type="button"
          onClick={() => { playButtonClick(); onSelect(); }}
          disabled={!canJoin}
          className="lobby-observer-join"
          title="Join as observer"
        >
          <span className="lobby-observer-join-icon">
            <ObserverIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block font-display text-sm uppercase tracking-wide text-cyan-200">Observe</span>
            <span className="mt-0.5 block truncate font-body text-[9px] uppercase tracking-widest text-white/28">Free Camera</span>
          </span>
        </button>
      )}
    </div>
  );
}

interface BattleRoyalLobbyGridProps {
  teamEntries: ReturnType<typeof getTeamCatalogForGameplayMode>;
  teamPlayers: ReadonlyMap<Team, LobbyPlayer[]>;
  currentTeam: string | undefined;
  playerId: string | null;
  isLobbyHost: boolean;
  invitesAllowed: boolean;
  maxPlayersPerTeam: number;
  combatPlayerCount: number;
  maxCombatPlayers: number;
  onTeamChange: (team: LobbyTeam) => void;
  onInvite: () => void;
  onKick: (id: string) => void;
  onRemoveBot: (id: string) => void;
  pickedHeroIdsByTeam: ReadonlyMap<Team, ReadonlySet<HeroId>>;
}

function BattleRoyalLobbyGrid({
  teamEntries,
  teamPlayers,
  currentTeam,
  playerId,
  isLobbyHost,
  invitesAllowed,
  maxPlayersPerTeam,
  combatPlayerCount,
  maxCombatPlayers,
  onTeamChange,
  onInvite,
  onKick,
  onRemoveBot,
  pickedHeroIdsByTeam,
}: BattleRoyalLobbyGridProps) {
  return (
    <div className="menu-content-wide flex h-full min-h-0 flex-col gap-3 px-2 py-2 xl:gap-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2 backdrop-blur-xl">
        <div className="min-w-0">
          <p className="font-body text-[10px] uppercase tracking-widest text-white/35">Battle Royal Squads</p>
          <p className="mt-1 font-display text-lg leading-none text-white">
            {combatPlayerCount}/{maxCombatPlayers} combat players
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {teamEntries.map((entry) => {
            const faction = factionFromCatalog(entry.id);
            const players = teamPlayers.get(entry.id) ?? [];
            return (
              <section
                key={entry.id}
                className="min-h-[15rem] rounded-lg border border-white/10 bg-black/20 p-2 backdrop-blur-xl"
                style={{ boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 28px ${faction.primaryColor}10` }}
              >
                <FactionHeader
                  faction={faction}
                  players={players}
                  isSelected={currentTeam === entry.id}
                  maxPlayers={maxPlayersPerTeam}
                />
                <div className="mt-2">
                  <FactionPanel
                    faction={faction}
                    players={players}
                    playerId={playerId}
                    isSelected={currentTeam === entry.id}
                    isLobbyHost={isLobbyHost}
                    botsAllowed={false}
                    invitesAllowed={invitesAllowed}
                    maxPlayers={maxPlayersPerTeam}
                    onSelect={() => onTeamChange(entry.id)}
                    onAddBot={() => undefined}
                    onInvite={onInvite}
                    onKick={onKick}
                    onRemoveBot={onRemoveBot}
                    onBotTeamChange={() => undefined}
                    onBotDifficultyChange={() => undefined}
                    onBotHeroChange={() => undefined}
                    pickedHeroIds={pickedHeroIdsByTeam.get(entry.id) ?? EMPTY_HERO_LOCKS}
                  />
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface FactionHeaderProps {
  faction: LobbyFaction;
  players: LobbyPlayer[];
  isSelected: boolean;
  maxPlayers?: number;
  reverse?: boolean;
}

function FactionHeader({ faction, players, isSelected, maxPlayers = DEFAULT_GAME_CONFIG.teamSize, reverse }: FactionHeaderProps) {
  const Icon = faction.id === 'red' ? SolarIcon : faction.id === 'blue' ? VoidIcon : SquadIcon;

  return (
    <div className={`lobby-faction-header flex items-center gap-2 xl:gap-3 ${reverse ? 'flex-row-reverse' : ''}`}>
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
  );
}

// Faction Panel Component
interface FactionPanelProps {
  faction: LobbyFaction;
  players: LobbyPlayer[];
  playerId: string | null;
  isSelected: boolean;
  isLobbyHost: boolean;
  botsAllowed: boolean;
  invitesAllowed: boolean;
  maxPlayers?: number;
  onSelect: () => void;
  onAddBot: (team: LobbyTeam) => void;
  onInvite: () => void;
  onKick: (id: string) => void;
  onRemoveBot: (id: string) => void;
  onBotTeamChange: (id: string, team: LobbyTeam) => void;
  onBotDifficultyChange: (id: string, difficulty: BotDifficulty) => void;
  onBotHeroChange: (id: string, heroId: LobbyBotHero) => void;
  pickedHeroIds: ReadonlySet<HeroId>;
  reverse?: boolean;
}

function FactionPanel({
  faction,
  players,
  playerId,
  isSelected,
  isLobbyHost,
  botsAllowed,
  invitesAllowed,
  maxPlayers = DEFAULT_GAME_CONFIG.teamSize,
  onSelect,
  onAddBot,
  onInvite,
  onKick,
  onRemoveBot,
  onBotTeamChange,
  onBotDifficultyChange,
  onBotHeroChange,
  pickedHeroIds,
  reverse,
}: FactionPanelProps) {
  const emptySlots = Math.max(0, maxPlayers - players.length);
  const canJoin = !isSelected && emptySlots > 0;
  const canAddBot = botsAllowed && isLobbyHost && emptySlots > 0;
  const canInvite = invitesAllowed && isLobbyHost && emptySlots > 0;
  const factionTeam = faction.id as LobbyTeam;

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 space-y-1.5 px-1 py-1">
        {players.map((player) => (
          <PlayerCard
            key={player.id}
            player={player}
            isCurrentPlayer={player.id === playerId}
            isLobbyHost={isLobbyHost}
            botsAllowed={botsAllowed}
            onKick={() => onKick(player.id)}
            onRemoveBot={() => onRemoveBot(player.id)}
            onBotTeamChange={(team) => onBotTeamChange(player.id, team)}
            onBotDifficultyChange={(difficulty) => onBotDifficultyChange(player.id, difficulty)}
            onBotHeroChange={(heroId) => onBotHeroChange(player.id, heroId)}
            pickedHeroIds={pickedHeroIds}
            faction={faction}
            compact
          />
        ))}

        {(canJoin || canAddBot || canInvite) && (
          <JoinTeamCard
            faction={faction}
            reverse={reverse}
            canJoin={canJoin}
            canAddBot={canAddBot}
            canInvite={canInvite}
            onJoin={onSelect}
            onAddBot={() => onAddBot(factionTeam)}
            onInvite={onInvite}
            compact
          />
        )}
      </div>
    </div>
  );
}

interface JoinTeamCardProps {
  faction: LobbyFaction;
  reverse?: boolean;
  canJoin: boolean;
  canAddBot: boolean;
  canInvite: boolean;
  onJoin: () => void;
  onAddBot: () => void;
  onInvite: () => void;
  compact?: boolean;
}

function JoinTeamCard({ faction, reverse, canJoin, canAddBot, canInvite, onJoin, onAddBot, onInvite, compact }: JoinTeamCardProps) {
  const Icon = faction.id === 'red' ? SolarIcon : faction.id === 'blue' ? VoidIcon : SquadIcon;
  const { playButtonClick } = useUISounds();
  const containerClass = compact ? 'h-14 gap-2' : 'h-16 gap-2.5';
  const iconClass = compact ? 'h-10 w-10' : 'h-11 w-11';
  const actionButtonClass = compact ? 'h-14 w-14' : 'h-16 w-16';

  return (
    <div className={`flex w-full items-stretch ${containerClass} ${reverse ? 'flex-row-reverse' : ''}`}>
      {canJoin && (
        <button
          type="button"
          onClick={() => { playButtonClick(); onJoin(); }}
          className={`lobby-join-team-button group flex min-w-0 flex-1 items-center rounded-xl border border-dashed transition-all hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${compact ? 'gap-2 p-1.5' : 'gap-3 p-2'} ${
            reverse ? 'flex-row-reverse text-right' : ''
          }`}
          style={{
            background: 'rgb(var(--color-strike-panel-raised) / 0.16)',
            borderColor: `${faction.primaryColor}30`,
          }}
        >
          <div
            className={`flex ${iconClass} shrink-0 items-center justify-center rounded-lg border transition-colors group-hover:bg-white/[0.04]`}
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

      {canInvite && (
        <button
          type="button"
          onClick={() => { playButtonClick(); onInvite(); }}
          aria-label="Invite player"
          title="Invite player"
          className={`lobby-team-icon-action group relative flex ${actionButtonClass} shrink-0 items-center justify-center rounded-xl border border-dashed bg-white/[0.045] text-white/55 transition-all hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30`}
          style={{
            borderColor: `${faction.primaryColor}28`,
          }}
        >
          <InvitePlayerIcon className="h-5 w-5" />
          <span className="absolute right-2 top-1.5 font-display text-[11px] leading-none" style={{ color: faction.primaryColor }}>+</span>
        </button>
      )}

      {canAddBot && (
        <button
          type="button"
          onClick={() => { playButtonClick(); onAddBot(); }}
          aria-label={`Add ${faction.name} bot`}
          title="Add bot"
          className={`lobby-team-icon-action group relative flex ${actionButtonClass} shrink-0 items-center justify-center rounded-xl border border-dashed bg-cyan-500/[0.055] text-cyan-300 transition-all hover:bg-cyan-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40`}
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

interface PlayerCardProps {
  player: LobbyPlayer;
  isCurrentPlayer: boolean;
  isLobbyHost: boolean;
  botsAllowed: boolean;
  onKick: () => void;
  onRemoveBot: () => void;
  onBotTeamChange?: (team: LobbyTeam) => void;
  onBotDifficultyChange?: (difficulty: BotDifficulty) => void;
  onBotHeroChange?: (heroId: LobbyBotHero) => void;
  pickedHeroIds: ReadonlySet<HeroId>;
  faction?: LobbyFaction;
  compact?: boolean;
}

function PlayerCard({
  player,
  isCurrentPlayer,
  isLobbyHost,
  botsAllowed,
  onKick,
  onRemoveBot,
  onBotTeamChange,
  onBotDifficultyChange,
  onBotHeroChange,
  pickedHeroIds,
  faction,
  compact,
}: PlayerCardProps) {
  const color = faction?.primaryColor || FACTIONS.red.primaryColor;
  const secondaryColor = faction?.secondaryColor || FACTIONS.red.secondaryColor;
  const { playButtonClick } = useUISounds();
  const showBotControls = botsAllowed && !player.isHost && Boolean(player.isBot) && isLobbyHost;
  const cardClass = compact
    ? showBotControls ? 'min-h-16 p-2' : 'h-14 p-2'
    : showBotControls ? 'min-h-[4.5rem] p-2.5' : 'h-16 p-2.5';
  const avatarClass = compact ? 'h-10 w-10' : 'h-11 w-11';
  const avatarIconSize = compact ? 30 : 34;
  const readyClass = compact ? 'w-10 h-10' : 'w-11 h-11';
  const botDifficulty: BotDifficulty =
    player.botDifficulty === 'easy' || player.botDifficulty === 'hard'
      ? player.botDifficulty
      : 'normal';
  const botTeam: LobbyTeam = player.team === 'blue' ? 'blue' : 'red';
  const botHero: LobbyBotHero = isHeroId(player.heroId) ? player.heroId : '';
  const botHeroOptions = useMemo(() => BOT_HERO_OPTIONS.map((option) => {
    const heroId = option.value;
    if (!heroId || heroId === botHero || !pickedHeroIds.has(heroId)) {
      return option;
    }

    return {
      ...option,
      disabled: true,
      disabledReason: 'Picked by teammate',
    };
  }), [botHero, pickedHeroIds]);

  return (
    <div
      className={`lobby-player-card group relative flex w-full min-w-0 items-center ${compact ? 'gap-2' : 'gap-3'} ${cardClass} rounded-xl transition-all ${
        isCurrentPlayer 
          ? 'bg-white/[0.08] ring-1 ring-inset ring-white/20'
          : 'bg-white/[0.02] hover:bg-white/[0.05]'
      }`}
    >
      <div
        className={`${avatarClass} flex shrink-0 items-center justify-center font-display text-white ${
          player.isBot ? 'rounded-lg border' : ''
        }`}
        style={player.isBot ? {
          background: `linear-gradient(135deg, ${color}, ${secondaryColor})`,
          borderColor: 'rgba(255,255,255,0.12)',
          boxShadow: `0 6px 18px ${color}40`,
        } : undefined}
        title={player.isBot ? player.name : (player.rank?.label ?? 'Unranked')}
      >
        {player.isBot ? (
          <span className={compact ? 'text-sm' : 'text-base'}>{player.name.charAt(0).toUpperCase()}</span>
        ) : (
          <RankIcon rank={player.rank} size={avatarIconSize} labelled />
        )}
      </div>

      {/* Info */}
      <div className={`flex-1 min-w-0 ${showBotControls ? (compact ? 'pr-6' : 'pr-8') : ''}`}>
        <div className={`flex items-center ${compact ? 'gap-1' : 'gap-1.5'}`}>
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
          {isCurrentPlayer && !player.isHost && (
            <span className="px-1.5 py-0.5 bg-cyan-500/20 text-cyan-400 text-[8px] font-display rounded border border-cyan-500/30 uppercase">
              You
            </span>
          )}
        </div>
        {showBotControls && (
          <div className={`flex min-w-0 items-center ${compact ? 'mt-0 gap-0.5' : 'mt-0.5 gap-1'}`}>
            <InlinePicker
              label={`${player.name} hero`}
              value={botHero}
              options={botHeroOptions}
              accentColor={BLAZE_UI_COLORS.primary}
              widthClass="w-[4.65rem]"
              onChange={(heroId) => onBotHeroChange?.(heroId)}
            />
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
	          className="lobby-kick-button absolute right-2 top-1/2 z-10 h-8 w-8 -translate-y-1/2 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 bg-red-500/10 text-red-400/60 hover:text-red-400 hover:bg-red-500/20"
 >
 <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
 </svg>
 </button>
      )}
    </div>
  );
}
