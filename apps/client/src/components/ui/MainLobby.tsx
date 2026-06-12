import { type CSSProperties, useState, useEffect, useRef, useId } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';
import { useWallet } from '../../contexts/WalletContext';
import { HeroesPage } from './HeroesPage';
import { StatsPage } from './StatsPage';
import { SettingsModal } from './SettingsModal';
import { GameDialog } from './GameDialog';
import { HeroPreviewCanvas, type HeroPreviewAnimationMode } from './HeroPreviewCanvas';
import { LobbyBackdrop } from './LobbyBackdrop';
import { SocialBox, SocialButton } from './SocialBox';
import { useUISounds } from '../../hooks/useAudio';
import { config } from '../../config/environment';
import { HERO_DEFINITIONS, ALL_HERO_IDS } from '@voxel-strike/shared';
import type { HeroId } from '@voxel-strike/shared';
import { HERO_COLORS, WALLET_AUTH_COLORS } from '../../styles/colorTokens';
import { usePwaInstallPrompt } from '../../pwa';
import { parseOptionalMapSeedInput } from '../../utils/mapSeedInput';
import { solInputToLamports } from '../../utils/wagerPayments';
import { RankIcon, getRankForStats } from './RankBadge';

// Phantom wallet icon component
function PhantomIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="64" cy="64" r="64" fill="url(#phantom-gradient)" />
      <path
        d="M110.584 64.9142H99.142C99.142 41.7651 80.173 23 56.7724 23C33.6612 23 14.8716 41.3057 14.4169 64.0583C13.9504 87.4446 33.2917 108 56.7724 108H62.5765C84.1057 108 110.584 88.7974 110.584 64.9142Z"
        fill="url(#phantom-gradient-2)"
      />
      <path
        d="M77.3711 59.9142C77.3711 63.6499 74.3292 66.6799 70.5787 66.6799C66.8283 66.6799 63.7864 63.6499 63.7864 59.9142C63.7864 56.1785 66.8283 53.1485 70.5787 53.1485C74.3292 53.1485 77.3711 56.1785 77.3711 59.9142Z"
        fill="#FFF"
      />
      <path
        d="M52.3711 59.9142C52.3711 63.6499 49.3292 66.6799 45.5787 66.6799C41.8283 66.6799 38.7864 63.6499 38.7864 59.9142C38.7864 56.1785 41.8283 53.1485 45.5787 53.1485C49.3292 53.1485 52.3711 56.1785 52.3711 59.9142Z"
        fill="#FFF"
      />
      <defs>
        <linearGradient id="phantom-gradient" x1="64" y1="0" x2="64" y2="128" gradientUnits="userSpaceOnUse">
          <stop stopColor="#534BB1" />
          <stop offset="1" stopColor="#551BF9" />
        </linearGradient>
        <linearGradient id="phantom-gradient-2" x1="62.5" y1="23" x2="62.5" y2="108" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFF" />
          <stop offset="1" stopColor="#FFF" stopOpacity="0.82" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.54 5.34A18.2 18.2 0 0015.02 4c-.2.36-.42.84-.58 1.22a16.9 16.9 0 00-5.01 0A11.7 11.7 0 008.84 4c-1.6.27-3.12.72-4.52 1.34C1.46 9.6.68 13.74 1.07 17.81A18.5 18.5 0 006.61 20.6c.45-.61.84-1.26 1.18-1.95-.65-.24-1.27-.54-1.86-.89.16-.12.31-.24.46-.36a13.05 13.05 0 0011.14 0l.46.36c-.6.35-1.22.65-1.87.89.34.69.74 1.34 1.18 1.95a18.43 18.43 0 005.55-2.79c.46-4.72-.78-8.82-3.31-12.47zM8.52 15.3c-1.08 0-1.97-.99-1.97-2.2 0-1.22.87-2.2 1.97-2.2 1.1 0 1.99.99 1.97 2.2 0 1.21-.87 2.2-1.97 2.2zm6.96 0c-1.08 0-1.97-.99-1.97-2.2 0-1.22.87-2.2 1.97-2.2 1.1 0 1.99.99 1.97 2.2 0 1.21-.87 2.2-1.97 2.2z" />
    </svg>
  );
}

function SignInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 3h3.5A2.5 2.5 0 0121 5.5v13a2.5 2.5 0 01-2.5 2.5H15" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10 7l5 5-5 5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12H3" />
    </svg>
  );
}

function SlopHeroesMark({ className }: { className?: string }) {
  return (
    <img
      className={className}
      src="/voxel.svg"
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

function PwaInstallButton({ onInstall }: { onInstall: () => void }) {
  return (
    <button
      type="button"
      onClick={onInstall}
      className="group relative w-10 h-10 shrink-0 rounded-lg border border-orange-400/20 bg-orange-500/10 text-orange-200 shadow-[0_0_24px_rgba(249,115,22,0.14)] transition hover:border-orange-300/50 hover:bg-orange-400/20 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
      aria-label="Install Slop Heroes app"
      title="Install Slop Heroes app"
    >
      <span className="absolute inset-0 rounded-lg opacity-0 transition group-hover:opacity-100 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.18),transparent_62%)]" />
      <span className="relative flex h-full w-full items-center justify-center">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v10m0 0l4-4m-4 4L8 9" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 14v3.5A2.5 2.5 0 007.5 20h9a2.5 2.5 0 002.5-2.5V14" />
        </svg>
      </span>
    </button>
  );
}

// Navigation tabs
type MainTab = 'play' | 'heroes' | 'stats' | 'loadout';
const LOBBY_HERO_ANIMATION_MODE: HeroPreviewAnimationMode = 'showcaseLoop';

export function MainLobby() {
  const { playerName, isLoading, userStats, setAppPhase, setPlayerName: storeSetPlayerName, setUser, setWalletAddress } = useGameStore();
  const { createLobby, quickPlay, rankedPlay, startPracticeGame } = useNetwork();
  const { playButtonClick } = useUISounds();
  const {
    isPhantomInstalled,
    isConnected,
    isConnecting,
    walletAddress,
    isAuthenticated,
    isDiscordAuthEnabled,
    isNewUser,
    authProvider,
    user,
    pendingRegistration,
    suggestedPlayerName,
    hasFullFunctionality,
    connect,
    logout,
    authenticate,
    signInWithDiscord,
    linkPhantom,
    registerUser,
    error: walletError,
    notice,
    clearError,
    clearNotice,
  } = useWallet();
  const { canInstall, install: installPwa } = usePwaInstallPrompt();

  const [activeTab, setActiveTab] = useState<MainTab>('play');
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSocial, setShowSocial] = useState(false);
  const [showPlayDialog, setShowPlayDialog] = useState(false);
  const [showCreateLobby, setShowCreateLobby] = useState(false);
  const [showPracticeSetup, setShowPracticeSetup] = useState(false);
  const [featuredHero, setFeaturedHero] = useState<HeroId>('blaze');
  const heroAnimationMode = LOBBY_HERO_ANIMATION_MODE;

  // Authentication states
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [showNameInput, setShowNameInput] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isLinkingPhantom, setIsLinkingPhantom] = useState(false);
  const shouldAuthenticateConnectedWalletRef = useRef(false);
  const currentRank = getRankForStats(userStats);

  // Handle authentication after wallet connection
  useEffect(() => {
    if (isConnected && !isAuthenticated && !isAuthenticating && showAuthModal && shouldAuthenticateConnectedWalletRef.current) {
      shouldAuthenticateConnectedWalletRef.current = false;
      handleAuthenticate();
    }
  }, [isConnected, isAuthenticated, isAuthenticating, showAuthModal]);

  // Handle user authenticated - close modal and set user info
  useEffect(() => {
    if (isAuthenticated && user && !isNewUser) {
      storeSetPlayerName(user.name);
      setUser(user.id, user.name, user.stats);
      setWalletAddress(user.walletAddress ?? null);
      setShowAuthModal(false);
      setShowNameInput(false);
    }
  }, [isAuthenticated, user, isNewUser]);

  // Show name input for new users
  useEffect(() => {
    if (isAuthenticated && isNewUser) {
      setShowAuthModal(true);
      setShowNameInput(true);
      setNewPlayerName((currentName) => currentName || suggestedPlayerName);
    }
  }, [isAuthenticated, isNewUser, suggestedPlayerName]);

  const handleDiscordSignIn = () => {
    clearError();
    clearNotice();
    signInWithDiscord();
  };

  const handleConnect = async () => {
    clearError();
    clearNotice();
    shouldAuthenticateConnectedWalletRef.current = true;
    try {
      await connect();
    } catch (err) {
      shouldAuthenticateConnectedWalletRef.current = false;
      throw err;
    }
  };

  const handleAuthenticate = async () => {
    if (isAuthenticating) return;
    setIsAuthenticating(true);
    try {
      await authenticate();
    } catch (err) {
      console.error('Authentication failed:', err);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleRegister = async () => {
    if (!newPlayerName.trim()) {
      setNameError('Please enter a player name');
      return;
    }

    if (newPlayerName.trim().length < 2) {
      setNameError('Name must be at least 2 characters');
      return;
    }

    if (newPlayerName.trim().length > 16) {
      setNameError('Name must be 16 characters or less');
      return;
    }

    setIsRegistering(true);
    setNameError(null);

    try {
      const registeredUser = await registerUser(newPlayerName.trim());
      storeSetPlayerName(registeredUser.name);
      setUser(registeredUser.id, registeredUser.name, registeredUser.stats);
      setWalletAddress(registeredUser.walletAddress ?? null);
      setShowAuthModal(false);
      setShowNameInput(false);
      setNewPlayerName('');
    } catch (err: any) {
      setNameError(err.message || 'Registration failed');
    } finally {
      setIsRegistering(false);
    }
  };

  const handleDisconnect = async () => {
    await logout();
    setShowNameInput(false);
    setNewPlayerName('');
    setNameError(null);
    shouldAuthenticateConnectedWalletRef.current = false;
    setShowAuthModal(false);
  };

  const handleSignInClick = () => {
    clearError();
    clearNotice();
    shouldAuthenticateConnectedWalletRef.current = false;
    setShowAuthModal(true);
  };

  const handleAuthModalClose = () => {
    shouldAuthenticateConnectedWalletRef.current = false;
    setShowAuthModal(false);
  };

  const handleLinkPhantom = async () => {
    if (isLinkingPhantom || hasFullFunctionality) return;

    setIsLinkingPhantom(true);
    try {
      const linkedUser = await linkPhantom();
      storeSetPlayerName(linkedUser.name);
      setUser(linkedUser.id, linkedUser.name, linkedUser.stats);
      setWalletAddress(linkedUser.walletAddress ?? null);
    } catch (err: any) {
      setError(err.message || 'Failed to connect Phantom');
    } finally {
      setIsLinkingPhantom(false);
    }
  };

  const handleInstallPwa = () => {
    playButtonClick();
    installPwa().catch(() => undefined);
  };

  // Format wallet address for display
  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };
  const discordDisplayName = pendingRegistration?.displayName
    || user?.linkedAccounts.find((account) => account.provider === 'discord')?.displayName
    || 'Discord';

  // Manual carousel navigation
  const handlePrevHero = () => {
    const heroes = ALL_HERO_IDS;
    const currentIndex = heroes.indexOf(featuredHero);
    const prevIndex = (currentIndex - 1 + heroes.length) % heroes.length;
    setFeaturedHero(heroes[prevIndex]);
  };

  const handleNextHero = () => {
    const heroes = ALL_HERO_IDS;
    const currentIndex = heroes.indexOf(featuredHero);
    const nextIndex = (currentIndex + 1) % heroes.length;
    setFeaturedHero(heroes[nextIndex]);
  };

  const handleSelectHero = (heroId: HeroId) => {
    setFeaturedHero(heroId);
  };

  const handleCreateLobby = async (lobbyName: string, isPrivate: boolean, wager?: { enabled: boolean; coverChargeLamports?: string; token?: 'SOL' }, mapSeed?: number) => {
    setError(null);
    try {
      await createLobby(playerName, lobbyName || `${playerName}'s Lobby`, isPrivate, { wager, mapSeed });
      setShowCreateLobby(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create lobby');
    }
  };

  const handleQuickPlay = async () => {
    setError(null);
    try {
      await quickPlay(playerName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to find a match');
    }
  };

  const handlePracticeGame = (mapSeed?: number) => {
    setError(null);
    startPracticeGame(playerName, { mapSeed });
    setShowPracticeSetup(false);
  };

  const handleRankedPlay = async () => {
    setError(null);
    if (!isAuthenticated) {
      handleSignInClick();
      return;
    }
    if (!hasFullFunctionality) {
      await handleLinkPhantom();
      return;
    }
    try {
      await rankedPlay(playerName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enter ranked');
    }
  };

  const handleBack = () => setAppPhase('menu');

  const heroInfo = HERO_DEFINITIONS[featuredHero];
  const heroColor = HERO_COLORS[featuredHero];

  return (
    <div className="menu-screen bg-strike-bg">
      <LobbyBackdrop />

      {/* Top Navigation Bar */}
      <nav className="absolute top-0 left-0 right-0 z-20">
        <div className="menu-nav main-lobby-nav">
          {/* Logo */}
          <div className="main-lobby-brand flex min-w-0 shrink-0 items-center gap-3">
            <div className="w-10 h-10 xl:w-12 xl:h-12 relative flex items-center justify-center">
              <SlopHeroesMark className="w-full h-full" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-lg xl:text-xl text-white tracking-wider whitespace-nowrap">SLOP HEROES</h1>
              <p className="text-[10px] text-white/40 font-body uppercase tracking-widest">Season 1</p>
            </div>
          </div>

          <div className="main-lobby-tabs flex min-w-0 items-center">
            {(['play', 'heroes', 'stats', 'loadout'] as MainTab[]).map((tab) => (
 <button
 key={tab}
 onClick={() => { playButtonClick(); setActiveTab(tab); }}
 className={`relative px-3 lg:px-5 xl:px-6 py-3 font-display text-base xl:text-lg tracking-wide whitespace-nowrap ${activeTab === tab ? 'text-white' : 'text-white/40 hover:text-white/70'
 }`}
 >
 {tab.toUpperCase()}
 {activeTab === tab && (
 <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
 )}
 </button>
            ))}
          </div>

          {/* Right side controls */}
          <div className="main-lobby-controls flex shrink-0 items-center gap-3 xl:gap-4">
            <SocialButton
              onClick={() => {
                playButtonClick();
                setShowSocial(true);
              }}
            />

 <button
 onClick={() => { playButtonClick(); setShowSettings(true); }}
 className="w-10 h-10 flex items-center justify-center text-white/60 hover:text-white"
 >
 <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
 </svg>
 </button>

            {canInstall && <PwaInstallButton onInstall={handleInstallPwa} />}

            {/* Conditional: Show sign-in button or profile card */}
            {isAuthenticated && user ? (
              <div className="flex items-center gap-3 py-1 pl-1 pr-2 rounded-lg">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center"
                  title={currentRank.label}
                >
                  <RankIcon rank={currentRank} size={42} labelled />
                </div>
                <div className="min-w-0">
                  <p className="font-display text-white text-sm">{playerName}</p>
                  <p className="mt-1 font-display text-[10px] uppercase leading-none text-white/70">{currentRank.label}</p>
                </div>
              </div>
            ) : (
 <button
 onClick={handleSignInClick}
 disabled={isConnecting}
 className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl font-display text-sm text-white border border-white/10 hover:border-white/30 relative overflow-hidden group"
 style={{
 background: WALLET_AUTH_COLORS.gradient,
 boxShadow: WALLET_AUTH_COLORS.subtleGlow,
 }}
 >
 {/* Button shimmer */}
 <div
 className="absolute inset-0 opacity-0 group-hover:opacity-100"
 style={{
 background: WALLET_AUTH_COLORS.shimmer,
 }}
 />
 <span className="relative flex items-center gap-2">
 {isConnecting ? (
 <>
 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24">
 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
 </svg>
 CONNECTING...
 </>
 ) : (
 <>
 <SignInIcon className="w-5 h-5" />
 SIGN IN
 </>
 )}
 </span>
 </button>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <div className={`menu-main ${activeTab === 'play' ? 'menu-main-play' : ''}`}>
        {activeTab === 'play' && (
          <PlayTab
            isLoading={isLoading}
            featuredHero={featuredHero}
            heroInfo={heroInfo}
            heroColor={heroColor}
            heroAnimationMode={heroAnimationMode}
            isAuthenticated={isAuthenticated}
            onOpenPlayDialog={() => setShowPlayDialog(true)}
            onSignIn={handleSignInClick}
            onPrevHero={handlePrevHero}
            onNextHero={handleNextHero}
            onSelectHero={handleSelectHero}
          />
        )}
        {activeTab === 'heroes' && <HeroesPage />}
        {activeTab === 'stats' && <StatsPage />}
        {activeTab === 'loadout' && (
          <div className="h-full flex items-center justify-center menu-content">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                <svg className="w-10 h-10 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              </div>
              <h2 className="font-display text-3xl text-white/40">LOADOUT</h2>
              <p className="text-white/20 font-body mt-2">Coming Soon</p>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showSocial && (
        <SocialBox
          onClose={() => setShowSocial(false)}
          onRequireAuth={handleSignInClick}
        />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showPlayDialog && (
        <PlayDialog
          error={error}
          heroColor={heroColor}
          isLoading={isLoading}
          isAuthenticated={isAuthenticated}
          hasFullFunctionality={hasFullFunctionality}
          isLinkingPhantom={isLinkingPhantom}
          onQuickPlay={handleQuickPlay}
          onRankedPlay={handleRankedPlay}
          onLinkPhantom={handleLinkPhantom}
          onOpenPracticeSetup={() => {
            setShowPlayDialog(false);
            setShowPracticeSetup(true);
          }}
          onOpenCreateLobby={() => {
            setShowPlayDialog(false);
            setShowCreateLobby(true);
          }}
          onClose={() => setShowPlayDialog(false)}
        />
      )}
      {showCreateLobby && (
        <CreateLobbyModal
          playerName={playerName}
          isLoading={isLoading}
          error={error}
          onClose={() => setShowCreateLobby(false)}
          onCreate={handleCreateLobby}
        />
      )}
      {showPracticeSetup && (
        <PracticeSetupModal
          isLoading={isLoading}
          error={error}
          onClose={() => setShowPracticeSetup(false)}
          onStart={handlePracticeGame}
        />
      )}

      {/* Authentication Modal */}
      {showAuthModal && (
        <AuthModal
          isPhantomInstalled={isPhantomInstalled}
          isConnected={isConnected}
          isConnecting={isConnecting}
          walletAddress={walletAddress}
          isDiscordAuthEnabled={isDiscordAuthEnabled}
          authProvider={authProvider}
          pendingRegistrationDisplayName={discordDisplayName}
          isAuthenticating={isAuthenticating}
          isAuthenticated={isAuthenticated}
          showNameInput={showNameInput}
          newPlayerName={newPlayerName}
          nameError={nameError}
          walletError={walletError}
          notice={notice}
          isRegistering={isRegistering}
          onDiscordSignIn={handleDiscordSignIn}
          onConnect={handleConnect}
          onAuthenticate={handleAuthenticate}
          onDisconnect={handleDisconnect}
          onRegister={handleRegister}
          onNameChange={setNewPlayerName}
          onNameErrorClear={() => setNameError(null)}
          onClose={handleAuthModalClose}
          formatAddress={formatAddress}
        />
      )}
    </div>
  );
}

// Play Tab Component
interface PlayTabProps {
  isLoading: boolean;
  featuredHero: HeroId;
  heroInfo: (typeof HERO_DEFINITIONS)[HeroId];
  heroColor: string;
  heroAnimationMode: HeroPreviewAnimationMode;
  isAuthenticated: boolean;
  onOpenPlayDialog: () => void;
  onSignIn: () => void;
  onPrevHero: () => void;
  onNextHero: () => void;
  onSelectHero: (heroId: HeroId) => void;
}

function PlayTab({
  isLoading,
  featuredHero,
  heroInfo,
  heroColor,
  heroAnimationMode,
  isAuthenticated,
  onOpenPlayDialog,
  onSignIn,
  onPrevHero,
  onNextHero,
  onSelectHero,
}: PlayTabProps) {
  const { playButtonClick } = useUISounds();
  const featuredPreviewClassName =
    heroAnimationMode === 'showcaseLoop'
      ? 'relative -mt-[clamp(1.6rem,5vh,4rem)] h-[clamp(16rem,40vh,29rem)] w-[clamp(14.5rem,29vw,27rem)]'
      : heroAnimationMode === 'jump'
      ? 'relative -mt-[clamp(4rem,11vh,8rem)] h-[clamp(17.5rem,45vh,32rem)] w-[clamp(12rem,26vw,24rem)]'
      : heroAnimationMode === 'slide'
        ? 'relative h-[clamp(14.5rem,35vh,26rem)] w-[clamp(14.5rem,29vw,27rem)]'
      : 'relative h-[clamp(13.5rem,34vh,24rem)] w-[clamp(12rem,26vw,24rem)]';

  return (
    <div className="play-tab-shell h-full menu-content">
      <div className="play-tab-stage menu-compact-scale relative">
        <div className="play-hero-column flex flex-col items-center justify-center">
          {/* Hero Visual with Carousel Controls */}
        <div className="play-hero-nav relative flex items-center gap-3 lg:gap-4 2xl:gap-6">
          {/* Previous Arrow */}
 <button
 onClick={onPrevHero}
 className="play-carousel-arrow play-carousel-prev group relative w-10 h-10 xl:w-12 xl:h-12 2xl:w-14 2xl:h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 hover:border-white/20"
 aria-label="Previous hero"
 >
 <svg className="w-5 h-5 xl:w-6 xl:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
 </svg>
 </button>

          {/* Hero Container */}
          <div className="play-hero-preview-wrap relative">
            {/* Background glow that matches hero color */}
            <div
              className="absolute inset-0 opacity-20 -z-10"
              style={{
                background: `radial-gradient(ellipse at center, ${heroColor} 0%, transparent 60%)`,
                transform: 'scale(1.4)',
              }}
            />

            <DeferredFeaturedHeroPreview
              heroId={featuredHero}
              accentColor={heroColor}
              initialYaw={Math.PI - 0.18}
              animationMode={heroAnimationMode}
              className={featuredPreviewClassName}
            />
          </div>

          {/* Next Arrow */}
 <button
 onClick={onNextHero}
 className="play-carousel-arrow play-carousel-next group relative w-10 h-10 xl:w-12 xl:h-12 2xl:w-14 2xl:h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 hover:border-white/20"
 aria-label="Next hero"
 >
 <svg className="w-5 h-5 xl:w-6 xl:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
 </svg>
 </button>
        </div>

        {/* Hero info - below the preview with proper spacing */}
        <div className="play-hero-info text-center w-[clamp(17rem,24vw,32rem)] mt-2 sm:mt-3 lg:mt-4 xl:mt-5">
          <h2
            className="font-display text-xl sm:text-2xl md:text-2xl lg:text-3xl xl:text-4xl 2xl:text-5xl text-white mb-0.5 lg:mb-1 xl:mb-2"
            style={{ textShadow: `0 0 30px ${heroColor}50, 0 2px 10px rgba(0,0,0,0.5)` }}
          >
            {heroInfo.name.toUpperCase()}
          </h2>
          <p className="text-white/50 font-body text-[10px] sm:text-xs xl:text-sm max-w-sm mx-auto leading-relaxed">{heroInfo.description}</p>

          {/* Carousel Dot Indicators */}
          <div className="play-carousel-dots flex items-center justify-center gap-1.5 sm:gap-2 mt-1 sm:mt-1.5 lg:mt-2 xl:mt-3 2xl:mt-4 mb-1 sm:mb-1.5 lg:mb-2 xl:mb-3 2xl:mb-4">
            {ALL_HERO_IDS.map((heroId) => {
              const isActive = heroId === featuredHero;
              const dotColor = HERO_COLORS[heroId];
              return (
 <button
 key={heroId}
 onClick={() => onSelectHero(heroId)}
 className={`relative ${isActive ? 'scale-100' : 'scale-75 opacity-50 hover:opacity-80 '
 }`}
 aria-label={`Select ${HERO_DEFINITIONS[heroId].name}`}
 title={HERO_DEFINITIONS[heroId].name}
 >
 <div
 className="w-3 h-3 rounded-full"
 style={{
 background: isActive ? dotColor : 'rgba(255,255,255,0.3)',
 boxShadow: isActive
 ? `0 0 12px ${dotColor}80, 0 0 0 2px rgb(var(--color-strike-page-top)), 0 0 0 4px ${dotColor}`
 : 'none',
 }}
 />
 </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => {
              playButtonClick();
              if (isAuthenticated) {
                onOpenPlayDialog();
              } else {
                onSignIn();
              }
            }}
            disabled={isAuthenticated && isLoading}
            className="play-main-cta group"
            style={{
              background: isAuthenticated
                ? `linear-gradient(135deg, ${heroColor}, ${heroColor}dd)`
                : WALLET_AUTH_COLORS.gradient,
              boxShadow: isAuthenticated
                ? `0 0 60px ${heroColor}40, inset 0 1px 0 rgba(255,255,255,0.2)`
                : WALLET_AUTH_COLORS.glow,
            }}
          >
            <span
              className="absolute inset-0 opacity-0 group-hover:opacity-100"
              style={{ background: WALLET_AUTH_COLORS.shimmer }}
            />
            <span className="relative flex items-center justify-center gap-2">
              {isAuthenticated ? (
                <>
                  <svg className="h-5 w-5 sm:h-6 sm:w-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  PLAY
                </>
              ) : (
                <>
                  <SignInIcon className="h-5 w-5 sm:h-6 sm:w-6" />
                  SIGN IN
                </>
              )}
            </span>
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

interface PlayDialogProps {
  error: string | null;
  heroColor: string;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasFullFunctionality: boolean;
  isLinkingPhantom: boolean;
  onQuickPlay: () => void;
  onRankedPlay: () => void;
  onLinkPhantom: () => void;
  onOpenPracticeSetup: () => void;
  onOpenCreateLobby: () => void;
  onClose: () => void;
}

function PlayDialog({
  error,
  heroColor,
  isLoading,
  isAuthenticated,
  hasFullFunctionality,
  isLinkingPhantom,
  onQuickPlay,
  onRankedPlay,
  onLinkPhantom,
  onOpenPracticeSetup,
  onOpenCreateLobby,
  onClose,
}: PlayDialogProps) {
  const { playButtonClick } = useUISounds();
  const titleId = useId();
  const dialogStyle = { '--play-dialog-accent': heroColor } as CSSProperties;

  const runAction = (action: () => void) => {
    playButtonClick();
    action();
  };

  return (
    <div className="play-pay-dialog-root fixed inset-0 z-modal flex items-center justify-center p-[clamp(1rem,2vw,2rem)]">
      <div className="play-pay-dialog-scrim absolute inset-0" onClick={onClose} />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="play-pay-dialog relative w-full"
        style={dialogStyle}
      >
        <header className="play-pay-dialog-header">
          <div className="min-w-0">
            <p className="play-pay-dialog-kicker">MATCH DESK</p>
            <h2 id={titleId} className="play-pay-dialog-title">Choose a match</h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="play-pay-dialog-close"
            aria-label="Close play dialog"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="play-pay-dialog-body">
          {error && (
            <div className="play-pay-dialog-error">
              <p>{error}</p>
            </div>
          )}

          {isAuthenticated && !hasFullFunctionality && (
            <div className="play-pay-dialog-wallet">
              <div>
                <p className="font-display text-sm text-amber-50">PHANTOM REQUIRED</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-100/60">Link Phantom before entering ranked queues.</p>
              </div>
              <button
                type="button"
                onClick={() => runAction(onLinkPhantom)}
                disabled={isLinkingPhantom}
                className="play-pay-dialog-wallet-button"
              >
                {isLinkingPhantom ? 'LINKING...' : 'LINK'}
              </button>
            </div>
          )}

          <div className="play-pay-dialog-grid">
            <button
              type="button"
              onClick={() => runAction(onRankedPlay)}
              disabled={isLoading || isLinkingPhantom}
              className="play-pay-option play-pay-option-ranked"
              style={{
                background: `linear-gradient(135deg, ${heroColor}, ${heroColor}dd)`,
                boxShadow: `0 0 60px ${heroColor}40, inset 0 1px 0 rgba(255,255,255,0.2)`,
              }}
            >
              <span
                className="play-pay-option-shimmer"
                style={{ background: WALLET_AUTH_COLORS.shimmer }}
              />
              <span className="play-pay-option-icon">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M12 3l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.3 6.8 19l1-5.8L3.6 9.1l5.8-.8L12 3z" />
                </svg>
              </span>
              <span className="play-pay-option-copy">
                <span className="play-pay-option-title">{isLoading ? 'PREPARING...' : 'RANKED'}</span>
                <span className="play-pay-option-subtitle">Competitive queue</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => runAction(onQuickPlay)}
              disabled={isLoading}
              className="play-pay-option"
            >
              <span className="play-pay-option-icon">
                <svg fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
              <span className="play-pay-option-copy">
                <span className="play-pay-option-title">{isLoading ? 'STARTING...' : 'QUICK PLAY'}</span>
                <span className="play-pay-option-subtitle">Instant casual queue</span>
              </span>
            </button>

            <div className="play-pay-option-row">
              <button
                type="button"
                onClick={() => runAction(onOpenCreateLobby)}
                disabled={isLoading}
                className="play-pay-option play-pay-option-compact"
              >
                <span className="play-pay-option-icon">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </span>
                <span className="play-pay-option-copy">
                  <span className="play-pay-option-title">CUSTOM GAME</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => runAction(onOpenPracticeSetup)}
                disabled={isLoading}
                className="play-pay-option play-pay-option-compact"
              >
                <span className="play-pay-option-icon">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M12 3v6m0 0l4 7a3 3 0 01-2.6 4.5H10.6A3 3 0 018 16l4-7zm-3.5 11h7" />
                  </svg>
                </span>
                <span className="play-pay-option-copy">
                  <span className="play-pay-option-title">PRACTICE</span>
                </span>
              </button>
            </div>

          </div>

        </div>
      </section>
    </div>
  );
}

interface PracticeSetupModalProps {
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onStart: (mapSeed?: number) => void;
}

function PracticeSetupModal({ isLoading, error, onClose, onStart }: PracticeSetupModalProps) {
  const [mapSeedInput, setMapSeedInput] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);

    try {
      onStart(parseOptionalMapSeedInput(mapSeedInput));
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Invalid map seed');
    }
  };

  return (
    <GameDialog
      title="PRACTICE"
      icon={(
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M12 3v6m0 0l4 7a3 3 0 01-2.6 4.5H10.6A3 3 0 018 16l4-7zm-3.5 11h7" />
        </svg>
      )}
      size="sm"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs text-white/50 font-body uppercase tracking-wider mb-1.5">
            Map Seed
          </label>
          <input
            type="text"
            value={mapSeedInput}
            onChange={(event) => {
              setMapSeedInput(event.target.value);
              setLocalError(null);
            }}
            placeholder="Random"
            className="input w-full px-3.5 py-2.5 text-base rounded-lg"
            autoFocus
          />
        </div>

        {(error || localError) && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-red-400 text-sm font-body">{localError || error}</p>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg font-display text-sm text-white/60 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white"
          >
            CANCEL
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="flex-1 py-2.5 rounded-lg font-display text-sm text-white bg-orange-500 hover:bg-orange-400 disabled:opacity-50"
          >
            {isLoading ? 'STARTING...' : 'START'}
          </button>
        </div>
      </form>
    </GameDialog>
  );
}

function DeferredFeaturedHeroPreview({
  heroId,
  accentColor,
  initialYaw,
  animationMode,
  className,
}: {
  heroId: HeroId;
  accentColor: string;
  initialYaw: number;
  animationMode: HeroPreviewAnimationMode;
  className: string;
}) {
  const [shouldMountPreview, setShouldMountPreview] = useState(false);

  useEffect(() => {
    setShouldMountPreview(false);

    let secondFrame = 0;
    let thirdFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        thirdFrame = window.requestAnimationFrame(() => {
          setShouldMountPreview(true);
        });
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.cancelAnimationFrame(thirdFrame);
    };
  }, [animationMode, heroId]);

  if (!shouldMountPreview) {
    return (
      <div
        className={`hero-preview-shell relative overflow-hidden select-none ${className}`}
        data-ready="false"
        data-size="featured"
        style={{ '--hero-preview-accent': accentColor } as CSSProperties}
        aria-label={`Loading ${HERO_DEFINITIONS[heroId].name} voxel preview`}
        aria-busy
      >
        <div className="hero-preview-loading pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="hero-preview-loader-ring" />
        </div>
      </div>
    );
  }

  return (
    <HeroPreviewCanvas
      heroId={heroId}
      accentColor={accentColor}
      size="featured"
      initialYaw={initialYaw}
      animationMode={animationMode}
      className={className}
    />
  );
}

// Create Lobby Modal
interface CreateLobbyModalProps {
  playerName: string;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (name: string, isPrivate: boolean, wager?: { enabled: boolean; coverChargeLamports?: string; token?: 'SOL' }, mapSeed?: number) => void;
}

function CreateLobbyModal({ playerName, isLoading, error, onClose, onCreate }: CreateLobbyModalProps) {
  const [lobbyName, setLobbyName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [wagerEnabled, setWagerEnabled] = useState(false);
  const [coverChargeSol, setCoverChargeSol] = useState('0.01');
  const [mapSeedInput, setMapSeedInput] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    try {
      const mapSeed = config.isDev ? parseOptionalMapSeedInput(mapSeedInput) : undefined;
      onCreate(lobbyName, isPrivate, wagerEnabled
        ? { enabled: true, token: 'SOL', coverChargeLamports: solInputToLamports(coverChargeSol) }
        : { enabled: false }, mapSeed);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Invalid lobby settings');
    }
  };

  return (
    <GameDialog
      title="CUSTOM GAME"
      icon={(
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
      )}
      size="md"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Game Name */}
        <div>
          <label className="block text-xs text-white/50 font-body uppercase tracking-wider mb-1.5">
            Game Name
          </label>
          <input
            type="text"
            value={lobbyName}
            onChange={(e) => setLobbyName(e.target.value)}
            placeholder={`${playerName}'s Lobby`}
            maxLength={24}
            className="input w-full px-3.5 py-2.5 text-base rounded-lg"
            autoFocus
          />
          <p className="mt-1.5 text-white/30 text-[11px] font-body">
            Leave empty for default name
          </p>
        </div>

        {config.isDev && (
          <div>
            <label className="block text-xs text-white/50 font-body uppercase tracking-wider mb-1.5">
              Map Seed
            </label>
            <input
              type="text"
              value={mapSeedInput}
              onChange={(e) => {
                setMapSeedInput(e.target.value);
                setLocalError(null);
              }}
              placeholder="Random"
              className="input w-full px-3.5 py-2.5 text-base rounded-lg"
            />
          </div>
        )}

        {/* Private Toggle */}
        <div
          className="flex items-center justify-between gap-3 p-3 bg-white/[0.03] border border-white/5 rounded-lg cursor-pointer hover:border-white/10 transition-colors"
          onClick={() => setIsPrivate(!isPrivate)}
        >
          <div className="flex items-center gap-3">
            <svg className={`w-4 h-4 ${isPrivate ? 'text-orange-400' : 'text-white/30'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <div>
              <p className="font-body text-sm text-white">Private Game</p>
              <p className="text-[11px] text-white/40">Invite only - won't appear in browser</p>
            </div>
          </div>
          <div className={`w-10 h-5 shrink-0 rounded-full transition-all relative ${isPrivate ? 'bg-orange-500' : 'bg-white/20'}`}>
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${isPrivate ? 'left-[22px]' : 'left-0.5'}`} />
          </div>
        </div>

        <div
          className="flex items-center justify-between gap-3 p-3 bg-white/[0.03] border border-white/5 rounded-lg cursor-pointer hover:border-white/10 transition-colors"
          onClick={() => setWagerEnabled(!wagerEnabled)}
        >
          <div className="flex items-center gap-3">
            <svg className={`w-4 h-4 ${wagerEnabled ? 'text-cyan-300' : 'text-white/30'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v18m5-14H9.5a3.5 3.5 0 000 7H14a3.5 3.5 0 010 7H6" />
            </svg>
            <div>
              <p className="font-body text-sm text-white">SOL Pot</p>
              <p className="text-[11px] text-white/40">Cover charge per human player</p>
            </div>
          </div>
          <div className={`w-10 h-5 shrink-0 rounded-full transition-all relative ${wagerEnabled ? 'bg-cyan-500' : 'bg-white/20'}`}>
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${wagerEnabled ? 'left-[22px]' : 'left-0.5'}`} />
          </div>
        </div>

        {wagerEnabled && (
          <div>
            <label className="block text-xs text-white/50 font-body uppercase tracking-wider mb-1.5">
              Cover Charge
            </label>
            <div className="flex items-center rounded-lg border border-white/10 bg-black/20 focus-within:border-cyan-300/50">
              <input
                type="text"
                inputMode="decimal"
                value={coverChargeSol}
                onChange={(e) => setCoverChargeSol(e.target.value)}
                className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-base text-white outline-none"
              />
              <span className="px-3 text-xs font-display text-cyan-200">SOL</span>
            </div>
          </div>
        )}

        {/* Error */}
        {(error || localError) && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-red-400 text-sm font-body">{localError || error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
          className="flex-1 py-2.5 rounded-lg font-display text-sm text-white/60 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white"
          >
            CANCEL
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="flex-1 py-2.5 rounded-lg font-display text-sm text-white bg-orange-500 hover:bg-orange-400 disabled:opacity-50"
          >
            {isLoading ? 'CREATING...' : 'CREATE'}
          </button>
        </div>
      </form>
    </GameDialog>
  );
}

// Authentication Modal
interface AuthModalProps {
  isPhantomInstalled: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  walletAddress: string | null;
  isDiscordAuthEnabled: boolean;
  authProvider: 'discord' | 'phantom' | null;
  pendingRegistrationDisplayName: string;
  isAuthenticating: boolean;
  isAuthenticated: boolean;
  showNameInput: boolean;
  newPlayerName: string;
  nameError: string | null;
  walletError: string | null;
  notice: string | null;
  isRegistering: boolean;
  onDiscordSignIn: () => void;
  onConnect: () => void;
  onAuthenticate: () => void;
  onDisconnect: () => void;
  onRegister: () => void;
  onNameChange: (name: string) => void;
  onNameErrorClear: () => void;
  onClose: () => void;
  formatAddress: (address: string) => string;
}

function AuthModal({
  isPhantomInstalled,
  isConnected,
  isConnecting,
  walletAddress,
  isDiscordAuthEnabled,
  authProvider,
  pendingRegistrationDisplayName,
  isAuthenticating,
  isAuthenticated,
  showNameInput,
  newPlayerName,
  nameError,
  walletError,
  notice,
  isRegistering,
  onDiscordSignIn,
  onConnect,
  onAuthenticate,
  onDisconnect,
  onRegister,
  onNameChange,
  onNameErrorClear,
  onClose,
  formatAddress,
}: AuthModalProps) {
  const isDiscordPending = authProvider === 'discord' && !walletAddress;

  return (
    <GameDialog
      title={showNameInput ? 'CREATE PROFILE' : 'SIGN IN'}
      icon={
        showNameInput
          ? isDiscordPending
            ? <DiscordIcon className="w-6 h-6 text-indigo-200" />
            : <PhantomIcon className="w-6 h-6" />
          : <SignInIcon className="w-6 h-6 text-accent-primary" />
      }
      iconClassName="bg-accent-primary/15 border border-accent-primary/20"
      size="sm"
      onClose={onClose}
      bodyClassName="p-5 space-y-3"
    >
          {/* Name input for new users */}
          {showNameInput ? (
            <>
              {/* Connected wallet display */}
              <div className="flex items-center justify-between p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                <div className="flex items-center gap-3">
                  {isDiscordPending ? <DiscordIcon className="w-6 h-6 text-indigo-200" /> : <PhantomIcon className="w-6 h-6" />}
                  <div>
                    <p className="text-white/60 text-xs font-body">Connected</p>
                    <p className={isDiscordPending ? 'text-white text-sm font-body' : 'text-white font-mono text-sm'}>
                      {isDiscordPending ? pendingRegistrationDisplayName : walletAddress && formatAddress(walletAddress)}
                    </p>
                  </div>
                </div>
 <button
 onClick={onDisconnect}
 className="text-white/40 hover:text-white/80"
 >
 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
 </svg>
 </button>
              </div>

              {/* Player name input */}
              <div>
                <label className="block text-xs font-body text-white/50 uppercase tracking-wider mb-2">
                  Player Name
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={newPlayerName}
                    onChange={(e) => {
                      onNameChange(e.target.value);
                      onNameErrorClear();
                    }}
                    placeholder="Enter your name"
                    maxLength={16}
                    className="input w-full px-3.5 py-2.5 text-base"
                    onKeyDown={(e) => e.key === 'Enter' && onRegister()}
                    autoFocus
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/30 font-mono">
                    {newPlayerName.length}/16
                  </div>
                </div>
              </div>

              {/* Error message */}
              {nameError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg animate-fade-in">
                  <p className="text-red-400 text-sm font-body">{nameError}</p>
                </div>
              )}

              {/* Register button */}
 <button
 onClick={onRegister}
 disabled={isRegistering}
 className="btn btn-primary w-full py-3 rounded-lg text-base clip-corner"
 >
 <span className="flex items-center justify-center gap-2">
 {isRegistering ? (
 <>
 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24">
 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
 </svg>
 CREATING...
 </>
 ) : (
 <>
 <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
 <path d="M8 5v14l11-7z" />
 </svg>
 START PLAYING
 </>
 )}
 </span>
 </button>
            </>
          ) : (
            <>
              {isDiscordAuthEnabled && (
                <>
                  <button
                    onClick={onDiscordSignIn}
                    className="w-full py-3 rounded-lg font-display text-base text-white border border-accent-primary/25 bg-accent-primary hover:bg-[rgb(var(--color-accent-primary-hover))] shadow-glow-orange relative overflow-hidden group"
                  >
                    <span className="relative flex items-center justify-center gap-2.5">
                      <DiscordIcon className="w-5 h-5" />
                      CONTINUE WITH DISCORD
                    </span>
                  </button>

                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="text-[10px] font-body uppercase tracking-widest text-white/35">or use Phantom</span>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>
                </>
              )}

              {/* Wallet connection state */}
              {isConnected && walletAddress ? (
                <div className="space-y-3">
                  {/* Connected wallet */}
                  <div className="flex items-center justify-between p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      <div>
                        <p className="text-green-400/80 text-xs font-body">Connected</p>
                        <p className="text-white font-mono text-sm">{formatAddress(walletAddress)}</p>
                      </div>
                    </div>
 <button
 onClick={onDisconnect}
 className="text-white/40 hover:text-white/80"
 >
 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
 </svg>
 </button>
                  </div>

                  {/* Authenticating state */}
                  {isAuthenticating && (
                    <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                      <div className="flex items-center justify-center gap-3">
                        <svg className="w-5 h-5 animate-spin text-purple-400" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span className="text-white/70 font-body">Sign message to authenticate...</span>
                      </div>
                    </div>
                  )}

                  {/* Retry authentication button */}
                  {!isAuthenticating && !isAuthenticated && (
 <button
 onClick={onAuthenticate}
 className="btn btn-primary w-full py-3 rounded-lg text-base"
 >
 <span className="flex items-center justify-center gap-2">
 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
 </svg>
 SIGN TO AUTHENTICATE
 </span>
 </button>
                  )}
                </div>
              ) : (
                <>
                  {/* Connect wallet button */}
 <button
 onClick={onConnect}
 disabled={isConnecting}
 className="w-full py-3 rounded-lg font-display text-base text-white border border-white/10 hover:border-white/30 relative overflow-hidden group"
 style={{
 background: WALLET_AUTH_COLORS.gradient,
 boxShadow: WALLET_AUTH_COLORS.glow,
 }}
 >
 {/* Button shimmer */}
 <div
 className="absolute inset-0 opacity-0 group-hover:opacity-100"
 style={{
 background: WALLET_AUTH_COLORS.shimmer,
 }}
 />
 <span className="relative flex items-center justify-center gap-2.5">
 {isConnecting ? (
 <>
 <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24">
 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
 </svg>
 CONNECTING...
 </>
 ) : (
 <>
 <PhantomIcon className="w-5 h-5" />
 CONNECT PHANTOM
 </>
 )}
 </span>
 </button>

                  {/* Phantom not installed message */}
                  {!isPhantomInstalled && (
                    <div className="text-center">
                      <p className="text-white/40 text-xs font-body">
                        Don't have Phantom?{' '}
                        <a
                          href="https://phantom.app/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-purple-400 hover:text-purple-300 transition-colors"
                        >
                          Download here
                        </a>
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* Error message */}
              {notice && (
                <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg animate-fade-in">
                  <p className="text-green-300 text-sm font-body">{notice}</p>
                </div>
              )}

              {walletError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg animate-fade-in">
                  <p className="text-red-400 text-sm font-body">{walletError}</p>
                </div>
              )}
            </>
          )}

          {/* Cancel button */}
 <button
 onClick={onClose}
 className="w-full py-3 rounded-xl font-display text-white/60 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white"
 >
 CANCEL
 </button>
    </GameDialog>
  );
}
