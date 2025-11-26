import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';

export function MainMenu() {
  const [playerName, setPlayerName] = useState('');
  const [serverUrl, setServerUrl] = useState('ws://localhost:2567');
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { setLoading } = useGameStore();
  const { connect } = useNetwork();

  const handleJoin = async () => {
    if (!playerName.trim()) {
      setError('Please enter a player name');
      return;
    }

    setIsJoining(true);
    setError(null);
    setLoading(true);

    try {
      await connect(serverUrl, playerName.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setLoading(false);
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 bg-gradient-to-br from-voxel-darker via-voxel-dark to-voxel-darker">
        <div className="absolute inset-0 opacity-20">
          <div 
            className="absolute w-full h-full"
            style={{
              backgroundImage: `
                linear-gradient(rgba(0, 255, 136, 0.1) 1px, transparent 1px),
                linear-gradient(90deg, rgba(0, 255, 136, 0.1) 1px, transparent 1px)
              `,
              backgroundSize: '50px 50px',
              animation: 'grid-move 20s linear infinite',
            }}
          />
        </div>
        
        {/* Floating voxel particles */}
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 bg-voxel-primary/30"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animation: `float ${5 + Math.random() * 5}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 5}s`,
            }}
          />
        ))}
      </div>

      {/* Logo */}
      <div className="relative z-10 mb-12 text-center">
        <h1 
          className="font-display text-8xl font-black tracking-tight"
          style={{
            background: 'linear-gradient(135deg, #00ff88 0%, #7c3aed 50%, #ff6b35 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            textShadow: '0 0 80px rgba(0, 255, 136, 0.5)',
          }}
        >
          VOXEL STRIKE
        </h1>
        <p className="font-body text-xl text-gray-400 tracking-[0.3em] mt-2">
          MOVEMENT • ABILITIES • CHAOS
        </p>
      </div>

      {/* Menu card */}
      <div className="relative z-10 w-full max-w-md p-8 bg-voxel-surface/80 backdrop-blur-lg border border-voxel-border rounded-lg">
        <div className="space-y-6">
          {/* Player name input */}
          <div>
            <label className="block font-display text-sm text-voxel-primary mb-2 tracking-wider">
              PLAYER NAME
            </label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter your name"
              maxLength={20}
              className="w-full px-4 py-3 bg-voxel-dark border border-voxel-border rounded
                       font-body text-white placeholder-gray-500
                       focus:outline-none focus:border-voxel-primary focus:ring-1 focus:ring-voxel-primary
                       transition-all duration-200"
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
          </div>

          {/* Server URL input */}
          <div>
            <label className="block font-display text-sm text-gray-400 mb-2 tracking-wider">
              SERVER
            </label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              className="w-full px-4 py-3 bg-voxel-dark border border-voxel-border rounded
                       font-mono text-sm text-gray-300
                       focus:outline-none focus:border-voxel-primary focus:ring-1 focus:ring-voxel-primary
                       transition-all duration-200"
            />
          </div>

          {/* Error message */}
          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/50 rounded">
              <p className="font-body text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Join button */}
          <button
            onClick={handleJoin}
            disabled={isJoining}
            className="w-full py-4 bg-voxel-primary text-voxel-dark font-display text-xl font-bold
                     rounded transition-all duration-200
                     hover:bg-voxel-primary/90 hover:shadow-lg hover:shadow-voxel-primary/30
                     disabled:opacity-50 disabled:cursor-not-allowed
                     active:scale-[0.98]"
          >
            {isJoining ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                CONNECTING...
              </span>
            ) : (
              'JOIN GAME'
            )}
          </button>

          {/* Quick actions */}
          <div className="flex gap-3">
            <button className="flex-1 py-2 bg-voxel-dark border border-voxel-border rounded
                             font-display text-sm text-gray-400
                             hover:border-voxel-primary hover:text-voxel-primary
                             transition-all duration-200">
              SETTINGS
            </button>
            <button className="flex-1 py-2 bg-voxel-dark border border-voxel-border rounded
                             font-display text-sm text-gray-400
                             hover:border-voxel-primary hover:text-voxel-primary
                             transition-all duration-200">
              HOW TO PLAY
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="relative z-10 mt-8 text-center">
        <p className="font-mono text-xs text-gray-600">
          v0.1.0 • Movement-Based CTF
        </p>
      </div>

      <style>{`
        @keyframes grid-move {
          0% { transform: translate(0, 0); }
          100% { transform: translate(50px, 50px); }
        }
        
        @keyframes float {
          0%, 100% { transform: translateY(0) rotate(0deg); opacity: 0.3; }
          50% { transform: translateY(-20px) rotate(180deg); opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}

