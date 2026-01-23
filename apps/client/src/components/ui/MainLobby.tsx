import { useState, useEffect } from 'react';
import { useGameStore, LobbyInfo } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';
import { useWallet } from '../../contexts/WalletContext';
import { HeroesPage } from './HeroesPage';
import { SettingsModal } from './SettingsModal';
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
  const { fetchLobbies, createLobby, joinLobby } = useNetwork();
  const { playButtonHover, playButtonClick } = useUISounds();
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
  const [isRefreshing, setIsRefreshing] = useState(false);
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

  // Cycle featured hero for visual interest (auto-rotate)
  useEffect(() => {
    const interval = setInterval(() => {
      const heroes = ALL_HERO_IDS;
      const currentIndex = heroes.indexOf(featuredHero);
      const nextIndex = (currentIndex + 1) % heroes.length;
      setFeaturedHero(heroes[nextIndex]);
    }, 8000);
    return () => clearInterval(interval);
  }, [featuredHero]);

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
      fetchLobbies();
      const interval = setInterval(fetchLobbies, 5000);
      return () => clearInterval(interval);
    }
  }, [fetchLobbies, activeTab]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchLobbies();
    setTimeout(() => setIsRefreshing(false), 400);
  };

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
        {/* Background Image - blurred with slow pan for depth */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat blur-[2px] animate-bg-pan"
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

        {/* Subtle color spots */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-gradient-radial from-orange-900/20 to-transparent blur-3xl" />
          <div className="absolute bottom-1/3 right-1/3 w-80 h-80 rounded-full bg-gradient-radial from-cyan-900/20 to-transparent blur-3xl" />
        </div>

        <div className="absolute inset-0 pattern-grid opacity-10" />
        <div className="absolute bottom-0 left-0 right-0 h-2/5 bg-gradient-to-t from-[#0a0a12] to-transparent" />
        <div className="absolute inset-0 vignette-pulse" />

        {/* Extra vignette for edges */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            boxShadow: 'inset 0 0 200px 80px rgba(0,0,0,0.7)'
          }}
        />

        {/* Floating particles */}
        {[...Array(15)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 rounded-full animate-float-particle"
            style={{
              left: `${5 + Math.random() * 90}%`,
              top: `${Math.random() * 100}%`,
              background: i % 2 === 0 ? 'rgba(249, 115, 22, 0.4)' : 'rgba(6, 182, 212, 0.3)',
              animationDelay: `${Math.random() * 10}s`,
              animationDuration: `${15 + Math.random() * 10}s`,
            }}
          />
        ))}
      </div>

      {/* Top Navigation Bar */}
      <nav className="absolute top-0 left-0 right-0 z-20">
        <div className="flex items-center justify-between px-4 lg:px-6 xl:px-8 py-3 lg:py-4">
          {/* Logo & Tabs */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              {/* Logo Icon - Stylized voxel with energy bolt */}
              <div className="w-12 h-12 relative flex items-center justify-center">
                <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full drop-shadow-lg">
                  <defs>
                    {/* Cube face gradients */}
                    <linearGradient id="frontFace" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#f97316" />
                      <stop offset="100%" stopColor="#dc2626" />
                    </linearGradient>
                    <linearGradient id="sideFace" x1="100%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#b91c1c" />
                      <stop offset="100%" stopColor="#7f1d1d" />
                    </linearGradient>
                    <linearGradient id="topFace" x1="0%" y1="100%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#fb923c" />
                      <stop offset="100%" stopColor="#fbbf24" />
                    </linearGradient>
                    {/* Bolt gradient */}
                    <linearGradient id="boltMain" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#fef3c7" />
                      <stop offset="50%" stopColor="#fde047" />
                      <stop offset="100%" stopColor="#f59e0b" />
                    </linearGradient>
                    {/* Glow filter */}
                    <filter id="boltGlow" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="2" result="blur" />
                      <feFlood floodColor="#fbbf24" floodOpacity="0.8" />
                      <feComposite in2="blur" operator="in" />
                      <feMerge>
                        <feMergeNode />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    {/* Drop shadow for cube */}
                    <filter id="cubeShadow" x="-20%" y="-20%" width="140%" height="140%">
                      <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.4" />
                    </filter>
                  </defs>

                  {/* Isometric Cube - clean geometry */}
                  <g filter="url(#cubeShadow)">
                    {/* Left face (darker) */}
                    <path d="M24 22 L10 14 L10 30 L24 38 Z" fill="url(#sideFace)" />
                    {/* Right face (medium) */}
                    <path d="M24 22 L38 14 L38 30 L24 38 Z" fill="url(#frontFace)" />
                    {/* Top face (brightest) */}
                    <path d="M24 6 L38 14 L24 22 L10 14 Z" fill="url(#topFace)" />
                  </g>

                  {/* Edge highlights */}
                  <path d="M24 22 L24 38" stroke="rgba(0,0,0,0.3)" strokeWidth="0.5" />
                  <path d="M24 6 L24 22" stroke="rgba(255,255,255,0.4)" strokeWidth="0.75" />
                  <path d="M10 14 L24 22 L38 14" stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" fill="none" />

                  {/* Lightning bolt - sharp & dynamic */}
                  <g filter="url(#boltGlow)">
                    <path
                      d="M28 2 L20 19 L26 19 L18 40 L22 40 L30 21 L24 21 L30 2 Z"
                      fill="url(#boltMain)"
                      stroke="#fff"
                      strokeWidth="0.5"
                      strokeLinejoin="round"
                    />
                    {/* Inner highlight */}
                    <path
                      d="M27 6 L22 17 L25 17 L21 32"
                      stroke="rgba(255,255,255,0.9)"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </g>

                  {/* Subtle sparkle accents */}
                  <circle cx="15" cy="10" r="0.8" fill="#fef3c7" opacity="0.7" />
                  <circle cx="33" cy="8" r="0.6" fill="#fef3c7" opacity="0.5" />
                </svg>
              </div>
              <div>
                <h1 className="font-display text-xl text-white tracking-wider drop-shadow-lg">VOXEL STRIKE</h1>
                <p className="text-[10px] text-white/40 font-body uppercase tracking-widest">Season 1</p>
              </div>
            </div>

            <div className="flex items-center ml-8">
              {(['play', 'heroes', 'loadout'] as MainTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => { playButtonClick(); setActiveTab(tab); }}
                  onMouseEnter={playButtonHover}
                  className={`relative px-6 py-3 font-display text-lg tracking-wide transition-all ${activeTab === tab ? 'text-white' : 'text-white/40 hover:text-white/70'
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
              onMouseEnter={playButtonHover}
              className="w-10 h-10 flex items-center justify-center text-white/60 hover:text-white transition-all"
            >
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            {/* Conditional: Show sign-in button or profile card */}
            {isAuthenticated && user ? (
              <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-strike-surface/80 border border-white/5 group relative">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center font-display text-white"
                  style={{ background: heroColor }}
                >
                  {playerName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-display text-white text-sm">{playerName}</p>
                  <p className="text-[10px] text-white/40 font-body">Level 1</p>
                </div>
                {/* Disconnect button on hover */}
                <button
                  onClick={handleDisconnect}
                  className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-white/10"
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
                className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl font-display text-sm text-white transition-all hover:brightness-110 hover:scale-[1.02] active:scale-[0.99] relative overflow-hidden group"
                style={{
                  background: 'linear-gradient(135deg, #9945FF 0%, #7B3FE4 50%, #5B2CC9 100%)',
                  boxShadow: '0 0 30px rgba(153, 69, 255, 0.25), inset 0 1px 0 rgba(255,255,255,0.2)',
                }}
              >
                {/* Button shimmer */}
                <div
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                  style={{
                    background: 'linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.15) 50%, transparent 70%)',
                  }}
                />
                <span className="relative flex items-center gap-2">
                  {isConnecting ? (
                    <>
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
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
      <div className="absolute inset-0 pt-20 pb-4 lg:pb-20 z-10">
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
          isRefreshing={isRefreshing}
          onRefresh={handleRefresh}
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
  const [prevHero, setPrevHero] = useState<HeroId>(featuredHero);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const { playButtonHover, playButtonClick } = useUISounds();

  // Handle hero transition animation
  useEffect(() => {
    if (featuredHero !== prevHero) {
      setIsTransitioning(true);
      const timer = setTimeout(() => {
        setPrevHero(featuredHero);
        setIsTransitioning(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [featuredHero, prevHero]);

  return (
    <div className="h-full flex items-center justify-center">
      {/* Centered Content */}
      <div className="relative flex flex-col items-center">
        {/* Hero Visual with Carousel Controls */}
        <div className="relative flex items-center gap-4">
          {/* Previous Arrow */}
          <button
            onClick={onPrevHero}
            className="group relative w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all hover:scale-110 active:scale-95"
            aria-label="Previous hero"
          >
            <svg className="w-6 h-6 transition-transform group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {/* Glow effect on hover */}
            <div
              className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 -z-10 blur-lg"
              style={{ background: heroColor + '30' }}
            />
          </button>

          {/* Hero Container */}
          <div className="relative">
            {/* Background glow that matches hero color */}
            <div
              className="absolute inset-0 blur-[120px] opacity-40 transition-colors duration-1000 -z-10"
              style={{
                background: `radial-gradient(ellipse at center, ${heroColor} 0%, transparent 60%)`,
                transform: 'scale(2)',
              }}
            />

            {/* Animated Hero SVG */}
            <div
              className={`relative transition-all duration-300 hero-svg-container ${isTransitioning ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}
              style={{
                filter: `drop-shadow(0 0 60px ${heroColor}50)`,
              }}
            >
              <HeroSVG
                heroId={isTransitioning ? prevHero : featuredHero}
                size={440}
                className="hero-svg-enter"
              />
            </div>
          </div>

          {/* Next Arrow */}
          <button
            onClick={onNextHero}
            className="group relative w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all hover:scale-110 active:scale-95"
            aria-label="Next hero"
          >
            <svg className="w-6 h-6 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {/* Glow effect on hover */}
            <div
              className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 -z-10 blur-lg"
              style={{ background: heroColor + '30' }}
            />
          </button>
        </div>

        {/* Hero info - below the SVG with proper spacing */}
        <div className="text-center w-[280px] lg:w-[300px] xl:w-[360px] 2xl:w-[450px] mt-1 md:mt-2 lg:mt-3 xl:mt-4 2xl:mt-6">
          <h2
            className="font-display text-2xl md:text-3xl xl:text-4xl 2xl:text-5xl text-white mb-1 xl:mb-2 transition-all duration-500"
            style={{ textShadow: `0 0 30px ${heroColor}50, 0 2px 10px rgba(0,0,0,0.5)` }}
          >
            {heroInfo.name.toUpperCase()}
          </h2>
          <p className="text-white/50 font-body text-xs xl:text-sm max-w-sm mx-auto leading-relaxed">{heroInfo.description}</p>

          {/* Carousel Dot Indicators */}
          <div className="flex items-center justify-center gap-2 mt-2 xl:mt-3 2xl:mt-5 mb-2 xl:mb-4 2xl:mb-6">
            {ALL_HERO_IDS.map((heroId) => {
              const isActive = heroId === featuredHero;
              const dotColor = HERO_COLORS[heroId];
              return (
                <button
                  key={heroId}
                  onClick={() => onSelectHero(heroId)}
                  className={`relative transition-all duration-300 ${isActive ? 'scale-100' : 'scale-75 opacity-50 hover:opacity-80 hover:scale-90'
                    }`}
                  aria-label={`Select ${HERO_DEFINITIONS[heroId].name}`}
                  title={HERO_DEFINITIONS[heroId].name}
                >
                  <div
                    className="w-3 h-3 rounded-full transition-all duration-300"
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
        <div className="h-1 xl:h-3 2xl:h-6" />

        {/* Action Buttons */}
        <div className="w-[280px] lg:w-[320px] xl:w-[400px] 2xl:w-[500px] space-y-2 lg:space-y-2.5 xl:space-y-3">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg mb-4 backdrop-blur-sm">
              <p className="text-red-400 text-sm font-body text-center">{error}</p>
            </div>
          )}

          <button
            onClick={() => { playButtonClick(); onQuickPlay(); }}
            onMouseEnter={playButtonHover}
            disabled={isLoading}
            className="w-full py-3 xl:py-4 2xl:py-5 rounded-xl font-display text-lg xl:text-xl 2xl:text-2xl text-white transition-all hover:brightness-110 hover:scale-[1.02] active:scale-[0.99] relative overflow-hidden group"
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
              className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{
                background: `linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.15) 50%, transparent 70%)`,
              }}
            />
            <span className="relative flex items-center justify-center gap-3">
              {isAuthenticated ? (
                <>
                  <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  {isLoading ? 'STARTING...' : 'QUICK PLAY'}
                </>
              ) : (
                <>
                  <PhantomIcon className="w-7 h-7" />
                  SIGN IN TO PLAY
                </>
              )}
            </span>
          </button>

          <div className="grid grid-cols-2 gap-2 xl:gap-3">
            <button
              onClick={() => { playButtonClick(); onOpenCreateLobby(); }}
              onMouseEnter={playButtonHover}
              disabled={isLoading}
              className="py-2.5 xl:py-3 2xl:py-4 rounded-xl font-display text-sm xl:text-base text-white/80 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white hover:border-white/20 transition-all flex items-center justify-center gap-2 backdrop-blur-sm"
            >
              {isAuthenticated ? (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  CREATE GAME
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  SIGN IN
                </>
              )}
            </button>

            <button
              onClick={() => { playButtonClick(); onOpenBrowseGames(); }}
              onMouseEnter={playButtonHover}
              className="py-2.5 xl:py-3 2xl:py-4 rounded-xl font-display text-sm xl:text-base text-white/80 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white hover:border-white/20 transition-all flex items-center justify-center gap-2 backdrop-blur-sm"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
  isRefreshing: boolean;
  onRefresh: () => void;
  onJoinLobby: (lobbyId: string) => void;
  onClose: () => void;
}

function BrowseGamesModal({
  availableLobbies,
  isLoading,
  isRefreshing,
  onRefresh,
  onJoinLobby,
  onClose
}: BrowseGamesModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl mx-4 bg-strike-surface border border-white/10 rounded-2xl overflow-hidden shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div>
              <h2 className="font-display text-2xl text-white">BROWSE GAMES</h2>
              <p className="text-white/40 text-xs font-body">{availableLobbies.length} games available</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white/60 text-sm font-body hover:bg-white/10 hover:text-white transition-all"
            >
              <svg
                className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* List */}
        <div className="max-h-[400px] overflow-y-auto">
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
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 bg-strike-elevated/30">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl font-display text-white/60 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white transition-all"
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-strike-surface border border-white/10 rounded-2xl overflow-hidden shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <h2 className="font-display text-2xl text-white">CREATE GAME</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
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
              className="flex-1 py-3 rounded-xl font-display text-white/60 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white transition-all"
            >
              CANCEL
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 py-3 rounded-xl font-display text-white bg-orange-500 hover:bg-orange-400 transition-all disabled:opacity-50"
            >
              {isLoading ? 'CREATING...' : 'CREATE'}
            </button>
          </div>
        </form>
      </div>
    </div>
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
        className={`px-5 py-2.5 rounded-lg font-display text-sm transition-all ${canJoin
          ? 'bg-orange-500 text-white hover:bg-orange-400 hover:scale-105'
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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-sm mx-4 bg-strike-surface border border-white/10 rounded-2xl overflow-hidden shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="text-center p-6 pb-4">
          <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 border border-purple-500/20 flex items-center justify-center">
            <PhantomIcon className="w-8 h-8" />
          </div>
          <h2 className="font-display text-2xl text-white">
            {showNameInput ? 'CREATE PROFILE' : 'CONNECT WALLET'}
          </h2>
          <p className="text-white/40 text-sm mt-1 font-body">
            {showNameInput
              ? 'Choose your callsign to continue'
              : 'Sign in with your Phantom wallet'}
          </p>
        </div>

        {/* Content */}
        <div className="px-6 pb-6 space-y-4">
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
                  className="text-white/40 hover:text-white/80 transition-colors"
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
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
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
                      className="text-white/40 hover:text-white/80 transition-colors"
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
                    className="w-full py-4 rounded-xl font-display text-xl text-white transition-all hover:brightness-110 hover:scale-[1.02] active:scale-[0.99] relative overflow-hidden group"
                    style={{
                      background: 'linear-gradient(135deg, #9945FF 0%, #7B3FE4 50%, #5B2CC9 100%)',
                      boxShadow: '0 0 40px rgba(153, 69, 255, 0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
                    }}
                  >
                    {/* Button shimmer */}
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                      style={{
                        background: 'linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.15) 50%, transparent 70%)',
                      }}
                    />
                    <span className="relative flex items-center justify-center gap-3">
                      {isConnecting ? (
                        <>
                          <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
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
            className="w-full py-3 rounded-xl font-display text-white/60 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white transition-all"
          >
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}
