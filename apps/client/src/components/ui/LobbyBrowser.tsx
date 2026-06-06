import { useState, useEffect } from 'react';
import { useGameStore, LobbyInfo } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';

export function LobbyBrowser() {
  const { playerName, availableLobbies, isLoading, setAppPhase } = useGameStore();
  const { fetchLobbies, createLobby, joinLobby } = useNetwork();
  const [lobbyName, setLobbyName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    fetchLobbies();
    const interval = setInterval(fetchLobbies, 5000);
    return () => clearInterval(interval);
  }, [fetchLobbies]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchLobbies();
    setTimeout(() => setIsRefreshing(false), 400);
  };

  const handleCreateLobby = async () => {
    setError(null);
    try {
      await createLobby(playerName, lobbyName || `${playerName}'s Lobby`, isPrivate);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create lobby');
    }
  };

  const handleJoinLobby = async (lobbyId: string) => {
    setError(null);
    try {
      await joinLobby(playerName, lobbyId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join lobby');
    }
  };

  const handleBack = () => setAppPhase('menu');

  return (
    <div className="w-full h-full flex items-center justify-center relative overflow-hidden bg-strike-bg">
      {/* Background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-radial from-orange-500/5 via-transparent to-transparent" />
        <div className="absolute bottom-0 right-0 w-2/3 h-2/3 bg-gradient-radial from-cyan-500/5 via-transparent to-transparent" />
        <div className="absolute inset-0 pattern-grid opacity-30" />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-2xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto px-4 lg:px-6">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="font-display text-5xl text-white">
            FIND <span className="text-orange-500">MATCH</span>
          </h1>
          <p className="mt-2 text-white/40 font-body">Join a game or create your own</p>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-12 gap-6">
          {/* Lobby List */}
          <div className="col-span-12 lg:col-span-8">
            <div className="card overflow-hidden">
              {/* Header */}
              <div className="px-5 py-3 border-b border-strike-border flex items-center justify-between bg-strike-elevated/50">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                  <h2 className="font-display text-lg text-white">ACTIVE GAMES</h2>
                  <span className="px-2 py-0.5 bg-orange-500/10 text-orange-400 text-xs font-mono rounded">
                    {availableLobbies.length}
                  </span>
                </div>
 <button
 onClick={handleRefresh}
 disabled={isRefreshing}
 className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded text-white/60 text-sm font-body hover:bg-white/10 hover:text-white "
 >
 <svg
 className={`w-4 h-4 ${isRefreshing ? '' : ''}`}
 fill="none" viewBox="0 0 24 24" stroke="currentColor"
 >
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
 </svg>
 Refresh
 </button>
              </div>

              {/* List */}
              <div className="max-h-[280px] lg:max-h-[320px] xl:max-h-[360px] overflow-y-auto">
                {availableLobbies.length === 0 ? (
                  <div className="py-16 text-center">
                    <div className="w-14 h-14 mx-auto mb-4 rounded-lg bg-white/5 flex items-center justify-center">
                      <svg className="w-7 h-7 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <p className="font-display text-white/40">NO GAMES FOUND</p>
                    <p className="mt-1 text-white/20 text-sm font-body">Create one to get started</p>
                  </div>
                ) : (
                  <div className="p-2 space-y-1">
                    {availableLobbies.map((lobby) => (
                      <LobbyRow 
                        key={lobby.roomId} 
                        lobby={lobby} 
                        onJoin={() => handleJoinLobby(lobby.roomId)}
                        disabled={isLoading}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Create Lobby */}
          <div className="col-span-12 lg:col-span-4 space-y-4">
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-8 h-8 rounded bg-orange-500/20 flex items-center justify-center">
                  <svg className="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <h2 className="font-display text-lg text-white">CREATE GAME</h2>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-white/40 font-body uppercase tracking-wider mb-2">
                    Game Name
                  </label>
                  <input
                    type="text"
                    value={lobbyName}
                    onChange={(e) => setLobbyName(e.target.value)}
                    placeholder={`${playerName}'s Lobby`}
                    maxLength={24}
                    className="input w-full px-3 py-2.5"
                  />
                </div>

                <label className="flex items-center gap-3 p-3 bg-black/20 border border-white/5 rounded-lg cursor-pointer hover:border-white/10 transition-colors">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={isPrivate}
                      onChange={(e) => setIsPrivate(e.target.checked)}
                      className="sr-only"
                    />
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                      isPrivate ? 'bg-orange-500 border-orange-400' : 'bg-transparent border-white/30'
                    }`}>
                      {isPrivate && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="font-body text-sm text-white/70">Private Game</p>
                    <p className="text-xs text-white/30">Invite only</p>
                  </div>
                  <svg className={`w-4 h-4 ${isPrivate ? 'text-orange-400' : 'text-white/30'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </label>

                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <p className="text-red-400 text-sm font-body">{error}</p>
                  </div>
                )}

 <button
 onClick={handleCreateLobby}
 disabled={isLoading}
 className="btn btn-primary w-full py-3 rounded-lg text-lg clip-corner-sm"
 >
 {isLoading ? 'CREATING...' : 'CREATE'}
 </button>
              </div>
            </div>

 <button
 onClick={handleBack}
 className="btn btn-secondary w-full py-3 rounded-lg flex items-center justify-center gap-2"
 >
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
 </svg>
 BACK
 </button>
          </div>
        </div>
      </div>

      {/* Player Card */}
      <div className="absolute bottom-4 left-4 z-10">
        <div className="flex items-center gap-3 px-4 py-2 bg-strike-surface border border-strike-border rounded-lg">
          <div className="w-8 h-8 rounded bg-orange-500/20 flex items-center justify-center">
            <span className="font-display text-orange-400">{playerName.charAt(0).toUpperCase()}</span>
          </div>
          <div>
            <p className="text-xs text-white/40 font-body">Playing as</p>
            <p className="font-display text-orange-400 text-sm">{playerName}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

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
    <div className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
      {/* Icon */}
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
        canJoin ? 'bg-orange-500/10' : 'bg-white/5'
      }`}>
        {isInGame ? (
          <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : (
          <svg className={`w-5 h-5 ${canJoin ? 'text-orange-400' : 'text-white/30'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-white truncate">{lobby.name}</h3>
          {isInGame && (
            <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[10px] font-display rounded animate-pulse">
              IN GAME
            </span>
          )}
          {!isInGame && isFull && (
            <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[10px] font-display rounded">
              FULL
            </span>
          )}
        </div>
        
        {/* Progress */}
        <div className="flex items-center gap-2 mt-1.5">
          <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full ${
                isFull ? 'bg-red-500' : isInGame ? 'bg-amber-500' : 'bg-orange-500'
              }`}
              style={{ width: `${(lobby.playerCount / lobby.maxPlayers) * 100}%` }}
            />
          </div>
          <span className="text-xs text-white/40 font-mono">
            {lobby.playerCount}/{lobby.maxPlayers}
          </span>
        </div>
      </div>

      {/* Join */}
 <button
 onClick={onJoin}
 disabled={disabled || !canJoin}
 className={`px-4 py-2 rounded font-display text-sm ${
 canJoin
 ? 'bg-orange-500 text-white hover:bg-orange-400'
 : 'bg-white/5 text-white/30 cursor-not-allowed'
 }`}
 >
 {isInGame ? 'LIVE' : isFull ? 'FULL' : 'JOIN'}
 </button>
    </div>
  );
}
