import { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useWallet } from '../../contexts/WalletContext';
import { WALLET_AUTH_COLORS } from '../../styles/colorTokens';

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

export function MainMenu() {
  const { setPlayerName: storeSetPlayerName, setAppPhase, setUser, setWalletAddress } = useGameStore();
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
    isSessionLoading,
    connect,
    disconnect,
    logout,
    authenticate,
    signInWithDiscord,
    registerUser,
    error: walletError,
    notice,
    clearError,
    clearNotice,
  } = useWallet();

  const [showNameInput, setShowNameInput] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);

  // Handle authentication after wallet connection (only if not loading session)
  useEffect(() => {
    if (isConnected && !isAuthenticated && !isAuthenticating && !isSessionLoading) {
      handleAuthenticate();
    }
  }, [isConnected, isSessionLoading]);

  // Handle user authenticated.
  useEffect(() => {
    if (isAuthenticated && user && !isNewUser) {
      // User exists, set their info and proceed
      storeSetPlayerName(user.name);
      setUser(user.id, user.name, user.stats);
      setWalletAddress(user.walletAddress ?? null);
      setAppPhase('menu');
    }
  }, [isAuthenticated, user, isNewUser]);

  // Show name input for new users
  useEffect(() => {
    if (isAuthenticated && isNewUser) {
      setShowNameInput(true);
      setPlayerName((currentName) => currentName || suggestedPlayerName);
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
    if (!playerName.trim()) {
      setNameError('Please enter a player name');
      return;
    }

    if (playerName.trim().length < 2) {
      setNameError('Name must be at least 2 characters');
      return;
    }

    if (playerName.trim().length > 16) {
      setNameError('Name must be 16 characters or less');
      return;
    }

    setIsRegistering(true);
    setNameError(null);

    try {
      const registeredUser = await registerUser(playerName.trim());
      storeSetPlayerName(registeredUser.name);
      setUser(registeredUser.id, registeredUser.name, registeredUser.stats);
      setWalletAddress(registeredUser.walletAddress ?? null);
      setAppPhase('menu');
    } catch (err: any) {
      setNameError(err.message || 'Registration failed');
    } finally {
      setIsRegistering(false);
    }
  };

  const handleDisconnect = async () => {
    await logout();
    setShowNameInput(false);
    setPlayerName('');
    setNameError(null);
  };

  // Format wallet address for display
  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };
  const discordDisplayName = pendingRegistration?.displayName
    || user?.linkedAccounts.find((account) => account.provider === 'discord')?.displayName
    || 'Discord';
  const isDiscordPending = authProvider === 'discord' && !walletAddress;

  // Show loading state while restoring session
  if (isSessionLoading) {
    return (
      <div className="menu-screen flex flex-col items-center justify-center px-4 bg-strike-bg">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-radial from-purple-500/5 via-transparent to-transparent" />
          <div className="absolute inset-0 pattern-grid opacity-50" />
        </div>
        <div className="relative z-10 flex flex-col items-center">
          <h1 className="font-display text-4xl lg:text-6xl text-white tracking-wider mb-8">
            VOXEL <span className="text-orange-500">STRIKE</span>
          </h1>
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 animate-spin text-purple-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="font-body text-white/60">Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="menu-screen flex flex-col items-center justify-center px-4 bg-strike-bg">
      {/* Background layers */}
      <div className="absolute inset-0">
        {/* Gradient ambient */}
        <div className="absolute inset-0 bg-gradient-radial from-purple-500/5 via-transparent to-transparent" />
        <div className="absolute bottom-0 right-0 w-1/2 h-1/2 bg-gradient-radial from-cyan-500/5 via-transparent to-transparent" />

        {/* Subtle grid */}
        <div className="absolute inset-0 pattern-grid opacity-50" />

        {/* Diagonal accent lines */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-purple-500/30 to-transparent" />
        <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />
      </div>

      {/* Main content */}
      <div className="dialog-page relative z-10 flex flex-col items-center responsive-scale-container">
        {/* Logo */}
        <div className="mb-6 lg:mb-12 text-center">
          <h1 className="font-display text-5xl md:text-6xl lg:text-8xl text-white tracking-wider">
            VOXEL <span className="text-orange-500">STRIKE</span>
          </h1>
          <div className="mt-3 flex items-center justify-center gap-4">
            <div className="h-px w-20 bg-gradient-to-r from-transparent to-orange-500/50" />
            <p className="font-body text-sm text-white/40 tracking-widest uppercase">
              Hero Shooter
            </p>
            <div className="h-px w-20 bg-gradient-to-l from-transparent to-orange-500/50" />
          </div>
        </div>

        {/* Login card */}
        <div className="w-full max-w-sm">
          <div className="card p-6">
            {/* Header */}
            <div className="text-center mb-6">
              <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 border border-purple-500/20 flex items-center justify-center">
                {(showNameInput && !isDiscordPending) || !isDiscordAuthEnabled ? <PhantomIcon className="w-8 h-8" /> : <DiscordIcon className="w-8 h-8 text-indigo-200" />}
              </div>
              <h2 className="font-display text-2xl text-white">
                {showNameInput ? 'CREATE PROFILE' : 'ENTER ARENA'}
              </h2>
              <p className="text-white/40 text-sm mt-1 font-body">
                {showNameInput
                  ? 'Choose your callsign to continue'
                  : isDiscordAuthEnabled ? 'Continue with Discord to play' : 'Connect your Phantom wallet to play'}
              </p>
            </div>

            <div className="space-y-4">
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
                          {isDiscordPending ? discordDisplayName : walletAddress && formatAddress(walletAddress)}
                        </p>
                      </div>
                    </div>
 <button
 onClick={handleDisconnect}
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
                        value={playerName}
                        onChange={(e) => {
                          setPlayerName(e.target.value);
                          setNameError(null);
                        }}
                        placeholder="Enter your name"
                        maxLength={16}
                        className="input w-full px-4 py-3 text-lg"
                        onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                        autoFocus
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/30 font-mono">
                        {playerName.length}/16
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
 onClick={handleRegister}
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
                  {isDiscordAuthEnabled && (
                    <>
                      <button
                        onClick={handleDiscordSignIn}
                        className="w-full py-4 rounded-xl font-display text-xl text-white border border-accent-primary/25 bg-accent-primary hover:bg-[rgb(var(--color-accent-primary-hover))] shadow-glow-orange relative overflow-hidden group"
                      >
                        <span className="relative flex items-center justify-center gap-3">
                          <DiscordIcon className="w-6 h-6" />
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
 onClick={handleDisconnect}
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
 onClick={handleAuthenticate}
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
 onClick={handleConnect}
 disabled={isConnecting}
 className="w-full py-4 rounded-xl font-display text-xl text-white border border-white/10 hover:border-white/30 relative overflow-hidden group"
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

              {/* Secondary actions */}
              <div className="grid grid-cols-2 gap-2 pt-2">
 <button className="btn btn-secondary py-2.5 rounded-lg text-sm flex items-center justify-center gap-2">
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
 </svg>
 SETTINGS
 </button>
 <button className="btn btn-secondary py-2.5 rounded-lg text-sm flex items-center justify-center gap-2">
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
 </svg>
 HELP
 </button>
              </div>
            </div>
          </div>
        </div>

        {/* Version */}
        <p className="mt-4 lg:mt-8 font-mono text-xs text-white/20">
          v0.1.0
        </p>
      </div>
    </div>
  );
}
