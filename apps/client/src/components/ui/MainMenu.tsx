import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';

export function MainMenu() {
  const [playerName, setPlayerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  const { setPlayerName: storeSetPlayerName, setAppPhase } = useGameStore();

  const handlePlay = () => {
    if (!playerName.trim()) {
      setError('Please enter a player name');
      return;
    }

    storeSetPlayerName(playerName.trim());
    setAppPhase('browsing_lobbies');
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden bg-strike-bg">
      {/* Background layers */}
      <div className="absolute inset-0">
        {/* Gradient ambient */}
        <div className="absolute inset-0 bg-gradient-radial from-orange-500/5 via-transparent to-transparent" />
        <div className="absolute bottom-0 right-0 w-1/2 h-1/2 bg-gradient-radial from-cyan-500/5 via-transparent to-transparent" />
        
        {/* Subtle grid */}
        <div className="absolute inset-0 pattern-grid opacity-50" />
        
        {/* Diagonal accent lines */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-orange-500/30 to-transparent" />
        <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />
      </div>

      {/* Floating particles - subtle */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-orange-400/40 rounded-full animate-float-particle"
            style={{
              left: `${15 + Math.random() * 70}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 8}s`,
              animationDuration: `${12 + Math.random() * 6}s`,
            }}
          />
        ))}
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Logo */}
        <div className="mb-12 text-center">
          <h1 className="font-display text-8xl text-white tracking-wider">
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
              <div className="w-12 h-12 mx-auto mb-3 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <h2 className="font-display text-2xl text-white">ENTER ARENA</h2>
              <p className="text-white/40 text-sm mt-1 font-body">Choose your callsign</p>
            </div>

            <div className="space-y-4">
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
                      setError(null);
                    }}
                    placeholder="Enter your name"
                    maxLength={16}
                    className="input w-full px-4 py-3 text-lg"
                    onKeyDown={(e) => e.key === 'Enter' && handlePlay()}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/30 font-mono">
                    {playerName.length}/16
                  </div>
                </div>
              </div>

              {/* Error message */}
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg animate-fade-in">
                  <p className="text-red-400 text-sm font-body">{error}</p>
                </div>
              )}

              {/* Play button */}
              <button
                onClick={handlePlay}
                className="btn btn-primary w-full py-4 rounded-lg text-xl clip-corner"
              >
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  PLAY
                </span>
              </button>

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
        <p className="mt-8 font-mono text-xs text-white/20">
          v0.1.0
        </p>
      </div>
    </div>
  );
}
