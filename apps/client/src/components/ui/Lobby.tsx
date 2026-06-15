import { useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useGameStore } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';
import { useWallet } from '../../contexts/WalletContext';
import { useUISounds } from '../../hooks/useAudio';
import {
  ALL_HERO_IDS,
  DEFAULT_GAME_CONFIG,
  HERO_DEFINITIONS,
  type BotDifficulty,
  type HeroId,
} from '@voxel-strike/shared';
import type { LobbyPlayer } from '../../store/gameStore';
import { FACTIONS, HERO_COLORS } from '../../styles/colorTokens';
import { deserializeWagerPaymentTransaction, lamportsToSolDisplay } from '../../utils/wagerPayments';
import { RankIcon, getRankForStats } from './RankBadge';
import { SocialBox, SocialButton } from './SocialBox';

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

function InvitePlayerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M15 19a6 6 0 00-12 0" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M9 11a4 4 0 100-8 4 4 0 000 8z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M19 8v6m3-3h-6" />
    </svg>
  );
}

function ObserverIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M2.25 12s3.75-6.75 9.75-6.75S21.75 12 21.75 12 18 18.75 12 18.75 2.25 12 2.25 12z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M12 15.25A3.25 3.25 0 1012 8.75a3.25 3.25 0 000 6.5z" />
    </svg>
  );
}

type LobbyTeam = 'red' | 'blue';
type LobbyBotHero = HeroId | '';

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

const BOT_HERO_OPTIONS: readonly InlinePickerOption<LobbyBotHero>[] = [
  { value: '', label: 'Random' },
  ...ALL_HERO_IDS.map((heroId) => ({
    value: heroId,
    label: HERO_DEFINITIONS[heroId].name,
  })),
];

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
                key={option.value || option.label}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={(event) => {
                  event.stopPropagation();
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className="flex h-6 w-full items-center whitespace-nowrap rounded px-1.5 text-left font-body text-[9px] uppercase tracking-wide transition-colors hover:bg-white/[0.07]"
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
    currentLobbyId,
    currentLobbyName, 
    currentLobbyWager,
    lobbyPlayers, 
    isLobbyHost,
    lobbyObserversEnabled,
    maxLobbyObservers,
    lobbyError,
    isLoading,
    userStats,
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
      currentLobbyWager: state.currentLobbyWager,
      lobbyPlayers: state.lobbyPlayers,
      isLobbyHost: state.isLobbyHost,
      lobbyObserversEnabled: state.lobbyObserversEnabled,
      maxLobbyObservers: state.maxLobbyObservers,
      lobbyError: state.lobbyError,
      isLoading: state.isLoading,
      userStats: state.userStats,
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
    createWagerPaymentIntent,
    createWagerPaymentTransaction,
    submitWagerSignedPaymentTransaction,
  } = useNetwork();
  const {
    walletAddress,
    isAuthenticated,
    isConnected: isWalletConnected,
    connect: connectWallet,
    signTransaction,
  } = useWallet();
  const { playButtonClick } = useUISounds();
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const [showSocial, setShowSocial] = useState(false);

  const currentPlayer = playerId ? lobbyPlayers.get(playerId) : null;
  const isLocalObserver = currentPlayer?.isObserver === true;
  const currentTeam = isLocalObserver ? '' : currentPlayer?.team;
  const hasChosenTeam = currentTeam === 'red' || currentTeam === 'blue';
  const isReady = currentPlayer?.isReady || false;
  const currentRank = currentPlayer?.rank ?? getRankForStats(userStats);
  const playerList = Array.from(lobbyPlayers.values());
  const combatPlayers = playerList.filter((p) => !p.isObserver);
  const observerPlayers = playerList.filter((p) => p.isObserver);
  const observerSlotCapacity = Math.max(0, maxLobbyObservers);
  const observerSlotAvailable = lobbyObserversEnabled && observerPlayers.length < observerSlotCapacity;
  const wagerEnabled = currentLobbyWager.enabled;
  const currentMatchMode = matchmakingStatus.matchMode ?? currentLobbyWager.matchMode ?? null;
  const botsAllowed = !wagerEnabled && currentMatchMode === 'custom';
  const invitesAllowed = currentMatchMode === 'custom' || currentMatchMode === 'custom_wager';
  const localPaymentStatus = currentPlayer?.paymentStatus || '';
  const localPlayerPaid = localPaymentStatus === 'credited' || localPaymentStatus === 'settled';
  const localPaymentConfirming = localPaymentStatus === 'intent_created' || localPaymentStatus === 'submitted' || localPaymentStatus === 'confirmed';
  const localPaymentRefunding = localPaymentStatus === 'refunding';
  const showPayEntry = wagerEnabled
    && Boolean(currentPlayer)
    && !currentPlayer?.isBot
    && !isLocalObserver
    && !localPlayerPaid
    && !localPaymentRefunding;

  const handleToggleReady = () => {
    if (!hasChosenTeam || isLocalObserver) return;
    setLobbyError(null);
    setLobbyReady(!isReady);
  };
  const handleTeamChange = (team: LobbyTeam) => {
    if (currentTeam === team) return;
    setLobbyError(null);
    setLobbyTeam(team);
  };
  const handleObserverToggle = () => {
    if (!lobbyObserversEnabled) return;
    setLobbyError(null);
    setLobbyObserver(!isLocalObserver);
  };
  const handleStartGame = () => {
    setLobbyError(null);
    clearMapVote();
    setAppPhase('map_vote');
    startGame();
  };
  const handleKick = (targetId: string) => kickPlayer(targetId);

  const readyCount = combatPlayers.filter(p => p.isReady || p.isHost).length;
  const assignedCount = combatPlayers.filter(p => p.team === 'red' || p.team === 'blue').length;
  const allPlayersAssigned = combatPlayers.length > 0 && assignedCount === combatPlayers.length;
  const isProductionCustomLobby = import.meta.env.PROD
    && (currentMatchMode === 'custom' || currentMatchMode === 'custom_wager');
  const minimumParticipantsToStart = isProductionCustomLobby ? 2 : 1;
  const hasMinimumParticipants = combatPlayers.length >= minimumParticipantsToStart;
  const assignedHumanPlayers = combatPlayers.filter((p) => !p.isBot && (p.team === 'red' || p.team === 'blue'));
  const unpaidHumanPlayers = wagerEnabled
    ? assignedHumanPlayers.filter((p) => p.paymentStatus !== 'credited' && p.paymentStatus !== 'settled')
    : [];
  const paidRedHumans = assignedHumanPlayers.filter((p) => p.team === 'red' && (p.paymentStatus === 'credited' || p.paymentStatus === 'settled')).length;
  const paidBlueHumans = assignedHumanPlayers.filter((p) => p.team === 'blue' && (p.paymentStatus === 'credited' || p.paymentStatus === 'settled')).length;
  const wagerStartReady = !wagerEnabled || (unpaidHumanPlayers.length === 0 && paidRedHumans > 0 && paidBlueHumans > 0);
  const canStart = isLobbyHost && hasMinimumParticipants && allPlayersAssigned && wagerStartReady && (combatPlayers.length === 1 || readyCount === combatPlayers.length);

  const solarPlayers = combatPlayers.filter(p => p.team === 'red');
  const voidPlayers = combatPlayers.filter(p => p.team === 'blue');

  const currentFaction = currentPlayer?.team === 'red' ? FACTIONS.red : currentPlayer?.team === 'blue' ? FACTIONS.blue : null;
  const currentRoleLabel = isLocalObserver ? 'Observer' : currentFaction?.fullName || 'Unassigned';
  const currentRoleColor = isLocalObserver
    ? 'rgb(var(--color-accent-secondary))'
    : currentFaction?.primaryColor || 'rgb(var(--color-strike-border) / 0.4)';

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

  const handlePayEntry = async () => {
    if (!currentLobbyId || !currentPlayer || !wagerEnabled || isPaying) return;
    setPaymentError(null);
    setIsPaying(true);

    try {
      let payerWallet = walletAddress;
      if (!isWalletConnected || !walletAddress) {
        payerWallet = await connectWallet();
      }
      if (!payerWallet) {
        throw new Error('Connect Phantom before paying');
      }

      const intent = await createWagerPaymentIntent(currentLobbyId, payerWallet, currentPlayer.id);
      const paymentTransaction = await createWagerPaymentTransaction(intent.intentId);
      const transaction = await deserializeWagerPaymentTransaction(paymentTransaction.transactionBase64);
      const signedTransactionBase64 = await signTransaction(transaction);
      await submitWagerSignedPaymentTransaction(intent.intentId, signedTransactionBase64);
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setIsPaying(false);
    }
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
            
            <div className="flex h-10 min-w-0 items-center">
              <h1 className="font-display translate-y-[0.08em] text-xl xl:text-2xl leading-none text-white tracking-wide truncate">{currentLobbyName || 'Game Lobby'}</h1>
            </div>
          </div>

          {/* Right side - Player info */}
          <div className="flex shrink-0 items-center gap-3 xl:gap-4">
            {isAuthenticated && (
              <SocialButton
                onClick={() => {
                  playButtonClick();
                  setShowSocial(true);
                }}
              />
            )}
            {wagerEnabled && (
              <div className="hidden sm:flex items-center gap-3 rounded-xl border border-cyan-300/15 bg-cyan-500/[0.055] px-3 py-2">
                <div>
                  <p className="font-body text-[9px] uppercase tracking-widest text-cyan-100/45">Entry</p>
                  <p className="font-display text-sm text-cyan-100">{lamportsToSolDisplay(currentLobbyWager.coverChargeLamports)} SOL</p>
                </div>
                <div className="h-7 w-px bg-cyan-100/10" />
                <div>
                  <p className="font-body text-[9px] uppercase tracking-widest text-cyan-100/45">Pot</p>
                  <p className="font-display text-sm text-cyan-100">{lamportsToSolDisplay(currentLobbyWager.potLamports)} SOL</p>
                </div>
              </div>
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

      {/* Main Content */}
      <div className="team-select-main menu-main menu-main-play">
        <div className="team-select-layout lobby-layout menu-content-wide">
          <div className="lobby-team-header-row">
            <FactionHeader
              faction={FACTIONS.red}
              players={solarPlayers}
              isSelected={currentTeam === 'red'}
            />

            {lobbyObserversEnabled ? (
              <ObserverSlot
                observers={observerPlayers}
                playerId={playerId}
                isLocalObserver={isLocalObserver}
                canJoin={observerSlotAvailable || isLocalObserver}
                capacity={observerSlotCapacity}
                onToggle={handleObserverToggle}
              />
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
        {lobbyError && (
          <div className="mx-auto mb-2 max-w-xl rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-center text-sm text-red-200">
            {lobbyError}
          </div>
        )}
        {paymentError && (
          <div className="mx-auto mb-2 max-w-xl rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-center text-sm text-red-200">
            {paymentError}
          </div>
        )}
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

            {wagerEnabled && (
              <button
                type="button"
                onClick={() => { playButtonClick(); handlePayEntry(); }}
                disabled={!showPayEntry || localPaymentConfirming || isPaying}
                className={`h-10 min-w-[8.5rem] rounded-full px-4 font-display text-xs uppercase tracking-wide transition-all ${
                  localPlayerPaid
                    ? 'bg-cyan-500/15 text-cyan-100 border border-cyan-300/20'
                    : showPayEntry && !localPaymentConfirming
                      ? 'text-white bg-cyan-500 hover:bg-cyan-400 active:scale-[0.98]'
                      : 'bg-white/[0.055] text-white/30 cursor-not-allowed'
                }`}
              >
                {isPaying || localPaymentConfirming ? 'Confirming' : localPlayerPaid ? 'Paid' : 'Pay Entry'}
              </button>
            )}
            
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
                  ) : !wagerStartReady ? (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v18m5-14H9.5a3.5 3.5 0 000 7H14a3.5 3.5 0 010 7H6" />
                      </svg>
                      Awaiting Payments
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
                disabled={!hasChosenTeam || isLoading || isLocalObserver}
                className={`h-10 min-w-[12.5rem] rounded-full px-5 font-display text-xs uppercase tracking-wide transition-all ${
                  isLocalObserver
                    ? 'bg-sky-500/15 text-sky-100 border border-sky-300/20 cursor-default'
                    : hasChosenTeam
                    ? 'text-white hover:brightness-110 active:scale-[0.98]'
                    : 'bg-white/[0.055] text-white/30 cursor-not-allowed'
                }`}
                style={!isLocalObserver && hasChosenTeam ? {
                  background: isReady
                    ? 'linear-gradient(135deg, rgb(var(--color-ui-success)) 0%, rgb(var(--color-ui-success-deep)) 100%)'
                    : 'linear-gradient(135deg, rgb(var(--color-accent-primary)) 0%, rgb(var(--color-accent-primary-deep)) 100%)',
                  boxShadow: isReady
                    ? '0 0 32px rgb(var(--color-ui-success) / 0.28)'
                    : '0 0 32px rgb(var(--color-accent-primary) / 0.28)',
                } : undefined}
              >
                <span className="flex items-center justify-center gap-2">
                  {isLocalObserver ? (
                    <>
                      <ObserverIcon className="h-4 w-4" />
                      Observer Mode
                    </>
                  ) : !hasChosenTeam ? (
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

      {showSocial && isAuthenticated && (
        <SocialBox onClose={() => setShowSocial(false)} />
      )}
    </div>
  );
}

interface ObserverSlotProps {
  observers: LobbyPlayer[];
  playerId: string | null;
  isLocalObserver: boolean;
  canJoin: boolean;
  capacity: number;
  onToggle: () => void;
}

function ObserverSlot({
  observers,
  playerId,
  isLocalObserver,
  canJoin,
  capacity,
  onToggle,
}: ObserverSlotProps) {
  const { playButtonClick } = useUISounds();
  const observer = observers[0] ?? null;
  const isClaimable = canJoin && !isLocalObserver;
  const statusLabel = observer ? `${observers.length}/${Math.max(1, capacity)}` : `0/${Math.max(1, capacity)}`;

  return (
    <div className="lobby-observer-slot">
      <button
        type="button"
        aria-pressed={isLocalObserver}
        disabled={!isClaimable}
        onClick={() => {
          if (!isClaimable) return;
          playButtonClick();
          onToggle();
        }}
        className={`group lobby-observer-chip ${
          isLocalObserver
            ? 'lobby-observer-chip-active'
            : isClaimable
              ? 'lobby-observer-chip-claimable'
              : 'lobby-observer-chip-disabled'
        }`}
      >
        <ObserverIcon className="h-4 w-4 shrink-0" />
        <span className="truncate">Observer</span>
        <span className="lobby-observer-count">{statusLabel}</span>
      </button>
      <p className="lobby-observer-caption">
        {isLocalObserver ? 'Watching' : observer ? (observer.id === playerId ? 'You' : observer.name) : 'Ghost slot'}
      </p>
    </div>
  );
}

interface FactionHeaderProps {
  faction: typeof FACTIONS.red | typeof FACTIONS.blue;
  players: LobbyPlayer[];
  isSelected: boolean;
  reverse?: boolean;
}

function FactionHeader({ faction, players, isSelected, reverse }: FactionHeaderProps) {
  const maxPlayers = DEFAULT_GAME_CONFIG.teamSize;
  const Icon = faction.id === 'red' ? SolarIcon : VoidIcon;

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
  faction: typeof FACTIONS.red | typeof FACTIONS.blue;
  players: LobbyPlayer[];
  playerId: string | null;
  isSelected: boolean;
  isLobbyHost: boolean;
  botsAllowed: boolean;
  invitesAllowed: boolean;
  onSelect: () => void;
  onAddBot: (team: LobbyTeam) => void;
  onInvite: () => void;
  onKick: (id: string) => void;
  onRemoveBot: (id: string) => void;
  onBotTeamChange: (id: string, team: LobbyTeam) => void;
  onBotDifficultyChange: (id: string, difficulty: BotDifficulty) => void;
  onBotHeroChange: (id: string, heroId: LobbyBotHero) => void;
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
  onSelect,
  onAddBot,
  onInvite,
  onKick,
  onRemoveBot,
  onBotTeamChange,
  onBotDifficultyChange,
  onBotHeroChange,
  reverse,
}: FactionPanelProps) {
  const maxPlayers = DEFAULT_GAME_CONFIG.teamSize;
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
  faction: typeof FACTIONS.red | typeof FACTIONS.blue;
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
  const Icon = faction.id === 'red' ? SolarIcon : VoidIcon;
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
          className={`group flex min-w-0 flex-1 items-center rounded-xl border border-dashed transition-all hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${compact ? 'gap-2 p-1.5' : 'gap-3 p-2'} ${
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
          className={`group relative flex ${actionButtonClass} shrink-0 items-center justify-center rounded-xl border border-dashed bg-white/[0.045] text-white/55 transition-all hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30`}
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
          className={`group relative flex ${actionButtonClass} shrink-0 items-center justify-center rounded-xl border border-dashed bg-cyan-500/[0.055] text-cyan-300 transition-all hover:bg-cyan-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40`}
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
function PaymentBadge({ status }: { status: LobbyPlayer['paymentStatus'] }) {
  if (!status || status === 'not_required') return null;
  const paid = status === 'credited' || status === 'settled';
  const pending = status === 'intent_created' || status === 'submitted' || status === 'confirmed';
  const refunding = status === 'refunding' || status === 'refunded';
  const failed = status === 'failed' || status === 'expired';
  const label = paid ? 'Paid' : pending ? 'Pending' : refunding ? 'Refund' : failed ? 'Due' : 'Due';
  const className = paid
    ? 'border-cyan-300/25 bg-cyan-500/15 text-cyan-100'
    : pending
      ? 'border-amber-300/25 bg-amber-500/15 text-amber-100'
      : refunding
        ? 'border-sky-300/25 bg-sky-500/15 text-sky-100'
        : 'border-white/10 bg-white/[0.055] text-white/45';

  return (
    <span className={`flex h-5 shrink-0 items-center rounded-md border px-1.5 font-display text-[8px] uppercase ${className}`}>
      {label}
    </span>
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
  faction?: typeof FACTIONS.red | typeof FACTIONS.blue;
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
  const botHeroColor = botHero ? HERO_COLORS[botHero] : color;

  return (
    <div
      className={`group relative flex w-full min-w-0 items-center ${compact ? 'gap-2' : 'gap-3'} ${cardClass} rounded-xl transition-all ${
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
          {!player.isBot && <PaymentBadge status={player.paymentStatus} />}
        </div>
        {showBotControls && (
          <div className={`flex min-w-0 items-center ${compact ? 'mt-0 gap-0.5' : 'mt-0.5 gap-1'}`}>
            <InlinePicker
              label={`${player.name} hero`}
              value={botHero}
              options={BOT_HERO_OPTIONS}
              accentColor={botHeroColor}
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
