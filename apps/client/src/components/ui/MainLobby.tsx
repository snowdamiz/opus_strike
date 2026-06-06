import { useState, useEffect } from 'react';
import { useGameStore, LobbyInfo } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';
import { useWallet } from '../../contexts/WalletContext';
import { HeroesPage } from './HeroesPage';
import { SettingsModal } from './SettingsModal';
import { GameDialog } from './GameDialog';
import { HeroSVG } from './HeroSVG';
import { useUISounds } from '../../hooks/useAudio';
import { HERO_DEFINITIONS, ALL_HERO_IDS } from '@voxel-strike/shared';
import type { HeroId } from '@voxel-strike/shared';

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

function SlopHeroesMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="slop-core" x1="10" y1="8" x2="48" y2="49" gradientUnits="userSpaceOnUse">
          <stop stopColor="#b8ff4d" />
          <stop offset="0.46" stopColor="#20d389" />
          <stop offset="1" stopColor="#f97316" />
        </linearGradient>
        <linearGradient id="slop-side" x1="16" y1="42" x2="49" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0f8f68" />
          <stop offset="1" stopColor="#0d5f5a" />
        </linearGradient>
        <linearGradient id="slop-slash" x1="18" y1="5" x2="35" y2="51" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff7ad" />
          <stop offset="0.52" stopColor="#ffffff" />
          <stop offset="1" stopColor="#48f0ff" />
        </linearGradient>
        <filter id="slop-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.30 0 0 0 0 1 0 0 0 0 0.54 0 0 0 0.52 0" />
          <feBlend in="SourceGraphic" />
        </filter>
      </defs>

      <g filter="url(#slop-glow)">
        <path d="M28 4L47 14.5V36.5L28 47L9 36.5V14.5L28 4Z" fill="url(#slop-core)" />
        <path d="M28 25L47 14.5V36.5L28 47V25Z" fill="url(#slop-side)" opacity="0.82" />
        <path d="M9 14.5L28 25V47L9 36.5V14.5Z" fill="#16895f" opacity="0.78" />
        <path d="M28 4L47 14.5L28 25L9 14.5L28 4Z" fill="#caff5b" opacity="0.92" />
        <path d="M16 37C16 42 20 40.5 20 46.5C20 49.5 16.5 51 14.5 48.5C12.6 46.1 14.5 42.5 12 38.5L16 37Z" fill="#20d389" />
        <path d="M38.5 35C37.5 39.5 41.8 40.5 40.2 45.4C39.2 48.2 35.3 48.2 34.4 45.2C33.6 42.3 36.1 39.9 35.3 36.5L38.5 35Z" fill="#f97316" />
        <path
          d="M33.5 7L20.8 28.2H28.1L20.5 50L38 22.7H29.6L33.5 7Z"
          fill="url(#slop-slash)"
          stroke="#0a0a12"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <circle cx="16" cy="11" r="1.5" fill="#fff7ad" />
        <circle cx="45" cy="25" r="1.2" fill="#48f0ff" />
      </g>
    </svg>
  );
}

// Navigation tabs
type MainTab = 'play' | 'heroes' | 'loadout';

// Hero colors for display
const HERO_COLORS: Record<HeroId, string> = {
  phantom: '#a855f7',
  hookshot: '#06b6d4',
  blaze: '#f97316',
  glacier: '#3b82f6',
  pulse: '#22c55e',
  sentinel: '#eab308',
};

export function MainLobby() {
  const { playerName, availableLobbies, isLoading, setAppPhase, setPlayerName: storeSetPlayerName, setUser, setWalletAddress } = useGameStore();
  const { watchLobbies, createLobby, joinLobby } = useNetwork();
  const { playButtonClick } = useUISounds();
  const {
    isPhantomInstalled,
    isConnected,
    isConnecting,
    walletAddress,
    isAuthenticated,
    isNewUser,
    user,
    connect,
    disconnect,
    logout,
    authenticate,
    registerUser,
    error: walletError,
    clearError,
  } = useWallet();

  const [activeTab, setActiveTab] = useState<MainTab>('play');
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateLobby, setShowCreateLobby] = useState(false);
  const [showBrowseGames, setShowBrowseGames] = useState(false);
  const [featuredHero, setFeaturedHero] = useState<HeroId>('blaze');

  // Authentication states
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [showNameInput, setShowNameInput] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  // Handle authentication after wallet connection
  useEffect(() => {
    if (isConnected && !isAuthenticated && !isAuthenticating && showAuthModal) {
      handleAuthenticate();
    }
  }, [isConnected, showAuthModal]);

  // Handle user authenticated - close modal and set user info
  useEffect(() => {
    if (isAuthenticated && user && !isNewUser) {
      storeSetPlayerName(user.name);
      setUser(user.id, user.name, user.stats);
      setWalletAddress(user.walletAddress);
      setShowAuthModal(false);
      setShowNameInput(false);
    }
  }, [isAuthenticated, user, isNewUser]);

  // Show name input for new users
  useEffect(() => {
    if (isAuthenticated && isNewUser) {
      setShowNameInput(true);
    }
  }, [isAuthenticated, isNewUser]);

  const handleConnect = async () => {
    clearError();
    await connect();
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
      setWalletAddress(registeredUser.walletAddress);
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
    setShowAuthModal(false);
  };

  const handleSignInClick = () => {
    clearError();
    setShowAuthModal(true);
  };

  // Format wallet address for display
  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

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

  useEffect(() => {
    if (activeTab === 'play') {
      return watchLobbies();
    }
  }, [watchLobbies, activeTab]);

  const handleCreateLobby = async (lobbyName: string, isPrivate: boolean) => {
    setError(null);
    try {
      await createLobby(playerName, lobbyName || `${playerName}'s Lobby`, isPrivate);
      setShowCreateLobby(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create lobby');
    }
  };

  const handleQuickPlay = async () => {
    setError(null);
    try {
      await createLobby(playerName, `${playerName}'s Lobby`, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create lobby');
    }
  };

  const handleJoinLobby = async (lobbyId: string) => {
    setError(null);
    try {
      await joinLobby(playerName, lobbyId);
      setShowBrowseGames(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join lobby');
    }
  };

  const handleBack = () => setAppPhase('menu');

  const heroInfo = HERO_DEFINITIONS[featuredHero];
  const heroColor = HERO_COLORS[featuredHero];

  return (
    <div className="w-full h-full relative overflow-hidden bg-strike-bg">
      {/* Cinematic Background */}
      <div className="absolute inset-0">
        {/* Background Image */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: 'url(/bg.jpg)' }}
        />

        {/* Dark overlay gradient for readability - stronger to let heroes pop */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a12]/80 via-[#0f0f1a]/75 to-[#08080c]/90" />

        {/* Center darkening for hero contrast */}
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 60% 70% at 50% 45%, rgba(10,10,18,0.5) 0%, transparent 70%)'
          }}
        />

        <div className="absolute inset-0 pattern-grid opacity-10" />
        <div className="absolute bottom-0 left-0 right-0 h-2/5 bg-gradient-to-t from-[#0a0a12] to-transparent" />

        {/* Extra vignette for edges */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            boxShadow: 'inset 0 0 200px 80px rgba(0,0,0,0.7)'
          }}
        />

      </div>

      {/* Top Navigation Bar */}
      <nav className="absolute top-0 left-0 right-0 z-20">
        <div className="flex items-center justify-between px-4 lg:px-6 xl:px-8 py-3 lg:py-4">
          {/* Logo & Tabs */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 relative flex items-center justify-center">
                <SlopHeroesMark className="w-full h-full" />
              </div>
              <div>
                <h1 className="font-display text-xl text-white tracking-wider">SLOP HEROES</h1>
                <p className="text-[10px] text-white/40 font-body uppercase tracking-widest">Season 1</p>
              </div>
            </div>

            <div className="flex items-center ml-8">
              {(['play', 'heroes', 'loadout'] as MainTab[]).map((tab) => (
 <button
 key={tab}
 onClick={() => { playButtonClick(); setActiveTab(tab); }}
 className={`relative px-6 py-3 font-display text-lg tracking-wide ${activeTab === tab ? 'text-white' : 'text-white/40 hover:text-white/70'
 }`}
 >
 {tab.toUpperCase()}
 {activeTab === tab && (
 <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
 )}
 </button>
              ))}
            </div>
          </div>

          {/* Right side controls */}
          <div className="flex items-center gap-4">
 <button
 onClick={() => { playButtonClick(); setShowSettings(true); }}
 className="w-10 h-10 flex items-center justify-center text-white/60 hover:text-white"
 >
 <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
 </svg>
 </button>

            {/* Conditional: Show sign-in button or profile card */}
            {isAuthenticated && user ? (
              <div className="flex items-center gap-3 py-1 pl-1 pr-0 rounded-lg group">
                <div
                  className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center font-display text-white"
                  style={{ background: heroColor }}
                >
                  {playerName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-display text-white text-sm">{playerName}</p>
                  <p className="text-[10px] text-white/40 font-body">Level 1</p>
                </div>
                {/* Disconnect button on hover */}
 <button
 onClick={handleDisconnect}
 className="w-8 h-8 shrink-0 opacity-60 group-hover:opacity-100 rounded-lg flex items-center justify-center hover:bg-white/10"
 title="Disconnect wallet"
 >
 <svg className="w-4 h-4 text-white/40 hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
 </svg>
 </button>
              </div>
            ) : (
 <button
 onClick={handleSignInClick}
 disabled={isConnecting}
 className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl font-display text-sm text-white border border-white/10 hover:border-white/30 relative overflow-hidden group"
 style={{
 background: 'linear-gradient(135deg, #9945FF 0%, #7B3FE4 50%, #5B2CC9 100%)',
 boxShadow: '0 0 30px rgba(153, 69, 255, 0.25), inset 0 1px 0 rgba(255,255,255,0.2)',
 }}
 >
 {/* Button shimmer */}
 <div
 className="absolute inset-0 opacity-0 group-hover:opacity-100"
 style={{
 background: 'linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.15) 50%, transparent 70%)',
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
 <PhantomIcon className="w-5 h-5" />
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
      <div className={`absolute inset-0 pt-20 pb-4 z-10 ${activeTab === 'play' ? 'lg:pb-20' : ''}`}>
        {activeTab === 'play' && (
          <PlayTab
            isLoading={isLoading}
            error={error}
            featuredHero={featuredHero}
            heroInfo={heroInfo}
            heroColor={heroColor}
            lobbyCount={availableLobbies.length}
            isAuthenticated={isAuthenticated}
            onQuickPlay={isAuthenticated ? handleQuickPlay : handleSignInClick}
            onOpenCreateLobby={isAuthenticated ? () => setShowCreateLobby(true) : handleSignInClick}
            onOpenBrowseGames={() => setShowBrowseGames(true)}
            onPrevHero={handlePrevHero}
            onNextHero={handleNextHero}
            onSelectHero={handleSelectHero}
          />
        )}
        {activeTab === 'heroes' && <HeroesPage />}
        {activeTab === 'loadout' && (
          <div className="h-full flex items-center justify-center">
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
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showCreateLobby && (
        <CreateLobbyModal
          playerName={playerName}
          isLoading={isLoading}
          error={error}
          onClose={() => setShowCreateLobby(false)}
          onCreate={handleCreateLobby}
        />
      )}
      {showBrowseGames && (
        <BrowseGamesModal
          availableLobbies={availableLobbies}
          isLoading={isLoading}
          onJoinLobby={handleJoinLobby}
          onClose={() => setShowBrowseGames(false)}
        />
      )}

      {/* Authentication Modal */}
      {showAuthModal && (
        <AuthModal
          isPhantomInstalled={isPhantomInstalled}
          isConnected={isConnected}
          isConnecting={isConnecting}
          walletAddress={walletAddress}
          isAuthenticating={isAuthenticating}
          isAuthenticated={isAuthenticated}
          showNameInput={showNameInput}
          newPlayerName={newPlayerName}
          nameError={nameError}
          walletError={walletError}
          isRegistering={isRegistering}
          onConnect={handleConnect}
          onAuthenticate={handleAuthenticate}
          onDisconnect={handleDisconnect}
          onRegister={handleRegister}
          onNameChange={setNewPlayerName}
          onNameErrorClear={() => setNameError(null)}
          onClose={() => setShowAuthModal(false)}
          formatAddress={formatAddress}
        />
      )}
    </div>
  );
}

// Play Tab Component
interface PlayTabProps {
  isLoading: boolean;
  error: string | null;
  featuredHero: HeroId;
  heroInfo: (typeof HERO_DEFINITIONS)[HeroId];
  heroColor: string;
  lobbyCount: number;
  isAuthenticated: boolean;
  onQuickPlay: () => void;
  onOpenCreateLobby: () => void;
  onOpenBrowseGames: () => void;
  onPrevHero: () => void;
  onNextHero: () => void;
  onSelectHero: (heroId: HeroId) => void;
}

function PlayTab({
  isLoading,
  error,
  featuredHero,
  heroInfo,
  heroColor,
  lobbyCount,
  isAuthenticated,
  onQuickPlay,
  onOpenCreateLobby,
  onOpenBrowseGames,
  onPrevHero,
  onNextHero,
  onSelectHero,
}: PlayTabProps) {
  const { playButtonClick } = useUISounds();

  return (
    <div className="h-full flex items-center justify-center">
      {/* Centered Content */}
      <div className="relative flex flex-col items-center">
        {/* Hero Visual with Carousel Controls */}
        <div className="relative flex items-center gap-4">
          {/* Previous Arrow */}
 <button
 onClick={onPrevHero}
 className="group relative w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 hover:border-white/20"
 aria-label="Previous hero"
 >
 <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
 </svg>
 </button>

          {/* Hero Container */}
          <div className="relative">
            {/* Background glow that matches hero color */}
            <div
              className="absolute inset-0 opacity-20 -z-10"
              style={{
                background: `radial-gradient(ellipse at center, ${heroColor} 0%, transparent 60%)`,
                transform: 'scale(1.4)',
              }}
            />

            {/* Hero SVG */}
            <div
              className="relative hero-svg-container scale-[0.55] sm:scale-[0.6] md:scale-[0.68] lg:scale-[0.8] xl:scale-90 2xl:scale-100"
            >
              <HeroSVG
                heroId={featuredHero}
                size={440}
              />
            </div>
          </div>

          {/* Next Arrow */}
 <button
 onClick={onNextHero}
 className="group relative w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 hover:border-white/20"
 aria-label="Next hero"
 >
 <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
 </svg>
 </button>
        </div>

        {/* Hero info - below the SVG with proper spacing */}
        <div className="text-center w-[240px] sm:w-[260px] md:w-[280px] lg:w-[300px] xl:w-[340px] 2xl:w-[400px] -mt-10 sm:-mt-8 md:-mt-6 lg:-mt-4 xl:-mt-2 2xl:mt-0">
          <h2
            className="font-display text-xl sm:text-2xl md:text-2xl lg:text-3xl xl:text-4xl 2xl:text-5xl text-white mb-0.5 lg:mb-1 xl:mb-2"
            style={{ textShadow: `0 0 30px ${heroColor}50, 0 2px 10px rgba(0,0,0,0.5)` }}
          >
            {heroInfo.name.toUpperCase()}
          </h2>
          <p className="text-white/50 font-body text-[10px] sm:text-xs xl:text-sm max-w-sm mx-auto leading-relaxed">{heroInfo.description}</p>

          {/* Carousel Dot Indicators */}
          <div className="flex items-center justify-center gap-1.5 sm:gap-2 mt-1 sm:mt-1.5 lg:mt-2 xl:mt-3 2xl:mt-4 mb-1 sm:mb-1.5 lg:mb-2 xl:mb-3 2xl:mb-4">
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
 ? `0 0 12px ${dotColor}80, 0 0 0 2px rgba(10,10,18,1), 0 0 0 4px ${dotColor}`
 : 'none',
 }}
 />
 </button>
              );
            })}
          </div>
        </div>

        {/* Spacer before buttons */}
        <div className="h-0 lg:h-1 xl:h-2 2xl:h-3" />

        {/* Action Buttons */}
        <div className="w-[220px] sm:w-[240px] md:w-[260px] lg:w-[300px] xl:w-[360px] 2xl:w-[440px] space-y-1 sm:space-y-1.5 lg:space-y-2 xl:space-y-2.5">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg mb-4">
              <p className="text-red-400 text-sm font-body text-center">{error}</p>
            </div>
          )}

 <button
 onClick={() => { playButtonClick(); onQuickPlay(); }}
 disabled={isLoading}
 className="w-full py-1.5 sm:py-2 md:py-2.5 lg:py-3 xl:py-3.5 2xl:py-4 rounded-lg sm:rounded-xl font-display text-sm sm:text-base md:text-lg xl:text-xl 2xl:text-2xl text-white border border-white/10 hover:border-white/30 relative overflow-hidden group"
 style={{
 background: isAuthenticated
 ? `linear-gradient(135deg, ${heroColor}, ${heroColor}dd)`
 : 'linear-gradient(135deg, #9945FF 0%, #7B3FE4 50%, #5B2CC9 100%)',
 boxShadow: isAuthenticated
 ? `0 0 60px ${heroColor}40, inset 0 1px 0 rgba(255,255,255,0.2)`
 : '0 0 60px rgba(153, 69, 255, 0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
 }}
 >
 {/* Button shimmer effect */}
 <div
 className="absolute inset-0 opacity-0 group-hover:opacity-100"
 style={{
 background: `linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.15) 50%, transparent 70%)`,
 }}
 />
 <span className="relative flex items-center justify-center gap-1.5 sm:gap-2 lg:gap-2.5">
 {isAuthenticated ? (
 <>
 <svg className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 xl:w-7 xl:h-7" fill="currentColor" viewBox="0 0 24 24">
 <path d="M8 5v14l11-7z" />
 </svg>
 {isLoading ? 'STARTING...' : 'QUICK PLAY'}
 </>
 ) : (
 <>
 <PhantomIcon className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 xl:w-7 xl:h-7" />
 SIGN IN TO PLAY
 </>
 )}
 </span>
 </button>

          <div className="grid grid-cols-2 gap-1 sm:gap-1.5 lg:gap-2 xl:gap-2.5">
 <button
 onClick={() => { playButtonClick(); onOpenCreateLobby(); }}
 disabled={isLoading}
 className="py-1.5 sm:py-2 lg:py-2.5 xl:py-3 2xl:py-3.5 rounded-md sm:rounded-lg lg:rounded-xl font-display text-[10px] sm:text-xs lg:text-sm xl:text-base text-white/80 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white hover:border-white/20 flex items-center justify-center gap-1 sm:gap-1.5 lg:gap-2"
 >
 {isAuthenticated ? (
 <>
 <svg className="w-3 h-3 sm:w-4 sm:h-4 lg:w-5 lg:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
 </svg>
 CREATE GAME
 </>
 ) : (
 <>
 <svg className="w-3 h-3 sm:w-4 sm:h-4 lg:w-5 lg:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
 </svg>
 SIGN IN
 </>
 )}
 </button>

 <button
 onClick={() => { playButtonClick(); onOpenBrowseGames(); }}
 className="py-1.5 sm:py-2 lg:py-2.5 xl:py-3 2xl:py-3.5 rounded-md sm:rounded-lg lg:rounded-xl font-display text-[10px] sm:text-xs lg:text-sm xl:text-base text-white/80 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white hover:border-white/20 flex items-center justify-center gap-1 sm:gap-1.5 lg:gap-2"
 >
 <svg className="w-3 h-3 sm:w-4 sm:h-4 lg:w-5 lg:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
 </svg>
 BROWSE GAMES
 {lobbyCount > 0 && (
 <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">
 {lobbyCount}
 </span>
 )}
 </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Browse Games Modal
interface BrowseGamesModalProps {
  availableLobbies: LobbyInfo[];
  isLoading: boolean;
  onJoinLobby: (lobbyId: string) => void;
  onClose: () => void;
}

function BrowseGamesModal({
  availableLobbies,
  isLoading,
  onJoinLobby,
  onClose
}: BrowseGamesModalProps) {
  return (
    <GameDialog
      title="BROWSE GAMES"
      icon={(
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      )}
      iconClassName="bg-cyan-500/15 text-cyan-300"
      size="lg"
      onClose={onClose}
      bodyClassName="max-h-[400px] overflow-y-auto"
    >
      {availableLobbies.length === 0 ? (
        <div className="py-16 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-white/5 flex items-center justify-center">
            <svg className="w-8 h-8 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="font-display text-xl text-white/40">NO GAMES FOUND</p>
          <p className="mt-2 text-white/20 text-sm font-body">Create one to get started!</p>
        </div>
      ) : (
        <div className="p-4 space-y-2">
          {availableLobbies.map((lobby) => (
            <LobbyRow
              key={lobby.roomId}
              lobby={lobby}
              onJoin={() => onJoinLobby(lobby.roomId)}
              disabled={isLoading}
            />
          ))}
        </div>
      )}
    </GameDialog>
  );
}

// Create Lobby Modal
interface CreateLobbyModalProps {
  playerName: string;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (name: string, isPrivate: boolean) => void;
}

function CreateLobbyModal({ playerName, isLoading, error, onClose, onCreate }: CreateLobbyModalProps) {
  const [lobbyName, setLobbyName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate(lobbyName, isPrivate);
  };

  return (
    <GameDialog
      title="CREATE GAME"
      icon={(
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
      )}
      size="md"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Game Name */}
        <div>
          <label className="block text-xs text-white/50 font-body uppercase tracking-wider mb-2">
            Game Name
          </label>
          <input
            type="text"
            value={lobbyName}
            onChange={(e) => setLobbyName(e.target.value)}
            placeholder={`${playerName}'s Lobby`}
            maxLength={24}
            className="input w-full px-4 py-3 text-lg rounded-xl"
            autoFocus
          />
          <p className="mt-1.5 text-white/30 text-xs font-body">
            Leave empty for default name
          </p>
        </div>

        {/* Private Toggle */}
        <div
          className="flex items-center justify-between p-4 bg-white/[0.03] border border-white/5 rounded-xl cursor-pointer hover:border-white/10 transition-colors"
          onClick={() => setIsPrivate(!isPrivate)}
        >
          <div className="flex items-center gap-3">
            <svg className={`w-5 h-5 ${isPrivate ? 'text-orange-400' : 'text-white/30'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <div>
              <p className="font-body text-white">Private Game</p>
              <p className="text-xs text-white/40">Invite only - won't appear in browser</p>
            </div>
          </div>
          <div className={`w-12 h-6 rounded-full transition-all relative ${isPrivate ? 'bg-orange-500' : 'bg-white/20'}`}>
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${isPrivate ? 'left-7' : 'left-1'}`} />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-red-400 text-sm font-body">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-xl font-display text-white/60 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white"
          >
            CANCEL
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="flex-1 py-3 rounded-xl font-display text-white bg-orange-500 hover:bg-orange-400 disabled:opacity-50"
          >
            {isLoading ? 'CREATING...' : 'CREATE'}
          </button>
        </div>
      </form>
    </GameDialog>
  );
}

// Lobby Row Component
interface LobbyRowProps {
  lobby: LobbyInfo;
  onJoin: () => void;
  disabled?: boolean;
}

function LobbyRow({ lobby, onJoin, disabled }: LobbyRowProps) {
  const isFull = lobby.playerCount >= lobby.maxPlayers;
  const isInGame = lobby.status === 'in_game' || lobby.status === 'starting';
  const canJoin = !isFull && !isInGame;

  return (
    <div className="flex items-center gap-4 p-4 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] transition-colors group">
      {/* Icon */}
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${canJoin ? 'bg-orange-500/10' : 'bg-white/5'
        }`}>
        {isInGame ? (
          <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : (
          <svg className={`w-6 h-6 ${canJoin ? 'text-orange-400' : 'text-white/30'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-display text-lg text-white truncate">{lobby.name}</h3>
          {isInGame && (
            <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-[10px] font-display rounded-full animate-pulse">
              IN GAME
            </span>
          )}
          {!isInGame && isFull && (
            <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-[10px] font-display rounded-full">
              FULL
            </span>
          )}
        </div>

        {/* Player count */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden max-w-40">
            <div
              className={`h-full rounded-full transition-all ${isFull ? 'bg-red-500' : isInGame ? 'bg-amber-500' : 'bg-orange-500'
                }`}
              style={{ width: `${(lobby.playerCount / lobby.maxPlayers) * 100}%` }}
            />
          </div>
          <span className="text-sm text-white/50 font-mono">
            {lobby.playerCount}/{lobby.maxPlayers}
          </span>
        </div>
      </div>

      {/* Join Button */}
 <button
 onClick={onJoin}
 disabled={disabled || !canJoin}
 className={`px-5 py-2.5 rounded-lg font-display text-sm ${canJoin
 ? 'bg-orange-500 text-white hover:bg-orange-400 '
 : 'bg-white/5 text-white/30 cursor-not-allowed'
 }`}
 >
 {isInGame ? 'LIVE' : isFull ? 'FULL' : 'JOIN'}
 </button>
    </div>
  );
}

// Authentication Modal
interface AuthModalProps {
  isPhantomInstalled: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  walletAddress: string | null;
  isAuthenticating: boolean;
  isAuthenticated: boolean;
  showNameInput: boolean;
  newPlayerName: string;
  nameError: string | null;
  walletError: string | null;
  isRegistering: boolean;
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
  isAuthenticating,
  isAuthenticated,
  showNameInput,
  newPlayerName,
  nameError,
  walletError,
  isRegistering,
  onConnect,
  onAuthenticate,
  onDisconnect,
  onRegister,
  onNameChange,
  onNameErrorClear,
  onClose,
  formatAddress,
}: AuthModalProps) {
  return (
    <GameDialog
      title={showNameInput ? 'CREATE PROFILE' : 'CONNECT WALLET'}
      description={showNameInput ? 'Choose your callsign to continue' : 'Sign in with your Phantom wallet'}
      icon={<PhantomIcon className="w-6 h-6" />}
      iconClassName="bg-gradient-to-br from-purple-500/20 to-purple-600/10 border border-purple-500/20"
      size="sm"
      onClose={onClose}
      bodyClassName="p-6 space-y-4"
    >
          {/* Name input for new users */}
          {showNameInput ? (
            <>
              {/* Connected wallet display */}
              <div className="flex items-center justify-between p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                <div className="flex items-center gap-3">
                  <PhantomIcon className="w-6 h-6" />
                  <div>
                    <p className="text-white/60 text-xs font-body">Connected</p>
                    <p className="text-white font-mono text-sm">{walletAddress && formatAddress(walletAddress)}</p>
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
                    className="input w-full px-4 py-3 text-lg"
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
 className="btn btn-primary w-full py-4 rounded-lg text-xl clip-corner"
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
 className="btn btn-primary w-full py-4 rounded-lg text-lg"
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
 className="w-full py-4 rounded-xl font-display text-xl text-white border border-white/10 hover:border-white/30 relative overflow-hidden group"
 style={{
 background: 'linear-gradient(135deg, #9945FF 0%, #7B3FE4 50%, #5B2CC9 100%)',
 boxShadow: '0 0 40px rgba(153, 69, 255, 0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
 }}
 >
 {/* Button shimmer */}
 <div
 className="absolute inset-0 opacity-0 group-hover:opacity-100"
 style={{
 background: 'linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.15) 50%, transparent 70%)',
 }}
 />
 <span className="relative flex items-center justify-center gap-3">
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
 <PhantomIcon className="w-6 h-6" />
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
