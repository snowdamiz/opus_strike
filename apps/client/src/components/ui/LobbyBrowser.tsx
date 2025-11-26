import { useState, useEffect } from 'react';
import { useGameStore, LobbyInfo } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';

export function LobbyBrowser() {
  const { playerName, availableLobbies, isLoading, setAppPhase } = useGameStore();
  const { fetchLobbies, createLobby, joinLobby } = useNetwork();
  const [isCreating, setIsCreating] = useState(false);
  const [lobbyName, setLobbyName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch lobbies on mount and periodically
  useEffect(() => {
    fetchLobbies();
    const interval = setInterval(fetchLobbies, 5000);
    return () => clearInterval(interval);
  }, [fetchLobbies]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchLobbies();
    setIsRefreshing(false);
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

  const handleBack = () => {
    setAppPhase('menu');
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-voxel-darker via-voxel-dark to-voxel-darker">
        <div className="absolute inset-0 opacity-10">
          <div 
            className="absolute w-full h-full"
            style={{
              backgroundImage: `
                linear-gradient(rgba(0, 255, 136, 0.15) 1px, transparent 1px),
                linear-gradient(90deg, rgba(0, 255, 136, 0.15) 1px, transparent 1px)
              `,
              backgroundSize: '40px 40px',
            }}
          />
        </div>
      </div>

      {/* Header */}
      <div className="relative z-10 mb-8 text-center">
        <h1 
          className="font-display text-5xl font-black tracking-tight text-voxel-primary"
          style={{ textShadow: '0 0 40px rgba(0, 255, 136, 0.4)' }}
        >
          GAME LOBBIES
        </h1>
        <p className="font-body text-lg text-gray-400 mt-2">
          Create or join a lobby to start playing
        </p>
      </div>

      {/* Main content */}
      <div className="relative z-10 w-full max-w-4xl px-8">
        <div className="grid grid-cols-5 gap-6">
          {/* Lobby list */}
          <div className="col-span-3 bg-voxel-surface/80 backdrop-blur-lg border border-voxel-border rounded-lg overflow-hidden">
            <div className="p-4 border-b border-voxel-border flex items-center justify-between">
              <h2 className="font-display text-xl text-white">Available Lobbies</h2>
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="px-3 py-1.5 bg-voxel-dark border border-voxel-border rounded
                         font-display text-sm text-gray-400
                         hover:border-voxel-primary hover:text-voxel-primary
                         disabled:opacity-50 transition-all duration-200"
              >
                {isRefreshing ? (
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  'REFRESH'
                )}
              </button>
            </div>
            
            <div className="max-h-96 overflow-y-auto">
              {availableLobbies.length === 0 ? (
                <div className="p-8 text-center">
                  <div className="w-16 h-16 mx-auto mb-4 bg-voxel-dark rounded-lg flex items-center justify-center">
                    <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <p className="font-body text-gray-500">No lobbies available</p>
                  <p className="font-body text-sm text-gray-600 mt-1">Create one to get started!</p>
                </div>
              ) : (
                <div className="divide-y divide-voxel-border">
                  {availableLobbies.map((lobby) => (
                    <LobbyListItem 
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

          {/* Create lobby panel */}
          <div className="col-span-2 space-y-4">
            <div className="bg-voxel-surface/80 backdrop-blur-lg border border-voxel-border rounded-lg p-6">
              <h2 className="font-display text-xl text-white mb-4">Create Lobby</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block font-display text-sm text-gray-400 mb-2 tracking-wider">
                    LOBBY NAME
                  </label>
                  <input
                    type="text"
                    value={lobbyName}
                    onChange={(e) => setLobbyName(e.target.value)}
                    placeholder={`${playerName}'s Lobby`}
                    maxLength={30}
                    className="w-full px-4 py-3 bg-voxel-dark border border-voxel-border rounded
                             font-body text-white placeholder-gray-500
                             focus:outline-none focus:border-voxel-primary focus:ring-1 focus:ring-voxel-primary
                             transition-all duration-200"
                  />
                </div>

                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                    className="w-5 h-5 rounded border-2 border-voxel-border bg-voxel-dark
                             checked:bg-voxel-primary checked:border-voxel-primary
                             focus:ring-1 focus:ring-voxel-primary focus:ring-offset-0
                             transition-all duration-200"
                  />
                  <span className="font-body text-gray-400 group-hover:text-gray-300 transition-colors">
                    Private Lobby
                  </span>
                </label>

                {error && (
                  <div className="p-3 bg-red-500/20 border border-red-500/50 rounded">
                    <p className="font-body text-red-400 text-sm">{error}</p>
                  </div>
                )}

                <button
                  onClick={handleCreateLobby}
                  disabled={isLoading}
                  className="w-full py-3 bg-voxel-primary text-voxel-dark font-display text-lg font-bold
                           rounded transition-all duration-200
                           hover:bg-voxel-primary/90 hover:shadow-lg hover:shadow-voxel-primary/30
                           disabled:opacity-50 disabled:cursor-not-allowed
                           active:scale-[0.98]"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      CREATING...
                    </span>
                  ) : (
                    'CREATE LOBBY'
                  )}
                </button>
              </div>
            </div>

            {/* Back button */}
            <button
              onClick={handleBack}
              className="w-full py-3 bg-voxel-dark border border-voxel-border rounded
                       font-display text-gray-400
                       hover:border-voxel-primary hover:text-voxel-primary
                       transition-all duration-200"
            >
              ← BACK TO MENU
            </button>
          </div>
        </div>
      </div>

      {/* Player info */}
      <div className="absolute bottom-4 left-4 z-10">
        <div className="px-4 py-2 bg-voxel-surface/60 backdrop-blur border border-voxel-border rounded">
          <span className="font-body text-gray-400 text-sm">Playing as </span>
          <span className="font-display text-voxel-primary">{playerName}</span>
        </div>
      </div>
    </div>
  );
}

interface LobbyListItemProps {
  lobby: LobbyInfo;
  onJoin: () => void;
  disabled?: boolean;
}

function LobbyListItem({ lobby, onJoin, disabled }: LobbyListItemProps) {
  const isFull = lobby.playerCount >= lobby.maxPlayers;
  const isInGame = lobby.status === 'in_game' || lobby.status === 'starting';

  return (
    <div className="p-4 hover:bg-voxel-dark/50 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg text-white truncate">{lobby.name}</h3>
          <div className="flex items-center gap-4 mt-1">
            <span className="font-mono text-sm text-gray-400">
              {lobby.playerCount}/{lobby.maxPlayers} players
            </span>
            {isInGame && (
              <span className="px-2 py-0.5 bg-orange-500/20 border border-orange-500/50 rounded text-orange-400 text-xs font-display">
                IN GAME
              </span>
            )}
            {!isInGame && isFull && (
              <span className="px-2 py-0.5 bg-red-500/20 border border-red-500/50 rounded text-red-400 text-xs font-display">
                FULL
              </span>
            )}
          </div>
        </div>
        
        <button
          onClick={onJoin}
          disabled={disabled || isFull || isInGame}
          className="ml-4 px-6 py-2 bg-voxel-primary/10 border border-voxel-primary/50 rounded
                   font-display text-voxel-primary
                   hover:bg-voxel-primary hover:text-voxel-dark
                   disabled:opacity-30 disabled:cursor-not-allowed
                   transition-all duration-200"
        >
          JOIN
        </button>
      </div>
    </div>
  );
}

