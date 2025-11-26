import { useState, useEffect } from 'react';
import { useGameStore, LobbyInfo } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';
import { HeroesPage } from './HeroesPage';
import { SettingsModal } from './SettingsModal';
import { HeroSVG } from './HeroSVG';
import { HERO_DEFINITIONS, ALL_HERO_IDS } from '@voxel-strike/shared';
import type { HeroId } from '@voxel-strike/shared';

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
  const { playerName, availableLobbies, isLoading, setAppPhase } = useGameStore();
  const { fetchLobbies, createLobby, joinLobby } = useNetwork();
  const [activeTab, setActiveTab] = useState<MainTab>('play');
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateLobby, setShowCreateLobby] = useState(false);
  const [showBrowseGames, setShowBrowseGames] = useState(false);
  const [featuredHero, setFeaturedHero] = useState<HeroId>('blaze');

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
        <div className="flex items-center justify-between px-8 py-4">
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
                      <feGaussianBlur stdDeviation="2" result="blur"/>
                      <feFlood floodColor="#fbbf24" floodOpacity="0.8"/>
                      <feComposite in2="blur" operator="in"/>
                      <feMerge>
                        <feMergeNode/>
                        <feMergeNode in="SourceGraphic"/>
                      </feMerge>
                    </filter>
                    {/* Drop shadow for cube */}
                    <filter id="cubeShadow" x="-20%" y="-20%" width="140%" height="140%">
                      <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.4"/>
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
                  onClick={() => setActiveTab(tab)}
                  className={`relative px-6 py-3 font-display text-lg tracking-wide transition-all ${
                    activeTab === tab ? 'text-white' : 'text-white/40 hover:text-white/70'
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
              onClick={() => setShowSettings(true)}
              className="w-10 h-10 flex items-center justify-center text-white/60 hover:text-white transition-all"
            >
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-strike-surface/80 border border-white/5">
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
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <div className="absolute inset-0 pt-20 pb-20 z-10">
        {activeTab === 'play' && (
          <PlayTab
            isLoading={isLoading}
            error={error}
            featuredHero={featuredHero}
            heroInfo={heroInfo}
            heroColor={heroColor}
            lobbyCount={availableLobbies.length}
            onQuickPlay={handleQuickPlay}
            onOpenCreateLobby={() => setShowCreateLobby(true)}
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
  onQuickPlay,
  onOpenCreateLobby,
  onOpenBrowseGames,
  onPrevHero,
  onNextHero,
  onSelectHero,
}: PlayTabProps) {
  const [prevHero, setPrevHero] = useState<HeroId>(featuredHero);
  const [isTransitioning, setIsTransitioning] = useState(false);

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
              className={`relative transition-all duration-300 ${isTransitioning ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}
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
        <div className="text-center w-[450px] mt-6">
          <h2 
            className="font-display text-5xl text-white mb-2 transition-all duration-500"
            style={{ textShadow: `0 0 30px ${heroColor}50, 0 2px 10px rgba(0,0,0,0.5)` }}
          >
            {heroInfo.name.toUpperCase()}
          </h2>
          <p className="text-white/50 font-body text-sm max-w-sm mx-auto leading-relaxed">{heroInfo.description}</p>

          {/* Carousel Dot Indicators */}
          <div className="flex items-center justify-center gap-2 mt-5 mb-6">
            {ALL_HERO_IDS.map((heroId) => {
              const isActive = heroId === featuredHero;
              const dotColor = HERO_COLORS[heroId];
              return (
                <button
                  key={heroId}
                  onClick={() => onSelectHero(heroId)}
                  className={`relative transition-all duration-300 ${
                    isActive ? 'scale-100' : 'scale-75 opacity-50 hover:opacity-80 hover:scale-90'
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
        <div className="h-6" />

        {/* Action Buttons */}
        <div className="w-[500px] space-y-3">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg mb-4 backdrop-blur-sm">
              <p className="text-red-400 text-sm font-body text-center">{error}</p>
            </div>
          )}

          <button
            onClick={onQuickPlay}
            disabled={isLoading}
            className="w-full py-5 rounded-xl font-display text-2xl text-white transition-all hover:brightness-110 hover:scale-[1.02] active:scale-[0.99] relative overflow-hidden group"
            style={{ 
              background: `linear-gradient(135deg, ${heroColor}, ${heroColor}dd)`,
              boxShadow: `0 0 60px ${heroColor}40, inset 0 1px 0 rgba(255,255,255,0.2)`,
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
              <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              {isLoading ? 'STARTING...' : 'QUICK PLAY'}
            </span>
          </button>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={onOpenCreateLobby}
              disabled={isLoading}
              className="py-4 rounded-xl font-display text-base text-white/80 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white hover:border-white/20 transition-all flex items-center justify-center gap-2 backdrop-blur-sm"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              CREATE GAME
            </button>

            <button
              onClick={onOpenBrowseGames}
              className="py-4 rounded-xl font-display text-base text-white/80 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white hover:border-white/20 transition-all flex items-center justify-center gap-2 backdrop-blur-sm"
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
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
        canJoin ? 'bg-orange-500/10' : 'bg-white/5'
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
              className={`h-full rounded-full transition-all ${
                isFull ? 'bg-red-500' : isInGame ? 'bg-amber-500' : 'bg-orange-500'
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
        className={`px-5 py-2.5 rounded-lg font-display text-sm transition-all ${
          canJoin 
            ? 'bg-orange-500 text-white hover:bg-orange-400 hover:scale-105' 
            : 'bg-white/5 text-white/30 cursor-not-allowed'
        }`}
      >
        {isInGame ? 'LIVE' : isFull ? 'FULL' : 'JOIN'}
      </button>
    </div>
  );
}
