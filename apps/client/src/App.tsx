import { useEffect, useState } from 'react';
import { useGameStore } from './store/gameStore';
import { MainMenu } from './components/ui/MainMenu';
import { GameCanvas } from './components/game/GameCanvas';
import { HUD } from './components/ui/HUD';
import { HeroSelect } from './components/ui/HeroSelect';
import { LoadingScreen } from './components/ui/LoadingScreen';
import { Scoreboard } from './components/ui/Scoreboard';

export function App() {
  const { gamePhase, isConnected, isLoading, localPlayer } = useGameStore();
  const [showScoreboard, setShowScoreboard] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        setShowScoreboard(true);
      }
      if (e.code === 'Escape') {
        // Handle escape menu
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        setShowScoreboard(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isConnected) {
    return <MainMenu />;
  }

  // Determine what phase we're in
  const isActiveGame = gamePhase === 'playing' || gamePhase === 'countdown';
  const isPreGame = gamePhase === 'waiting' || gamePhase === 'hero_select' || !gamePhase;

  return (
    <div className="w-full h-full relative game-active">
      <GameCanvas />
      
      {/* Show hero select during pre-game phases */}
      {isPreGame && <HeroSelect />}
      
      {/* Show HUD during active gameplay */}
      {isActiveGame && (
        <>
          <HUD />
          {showScoreboard && <Scoreboard />}
        </>
      )}

      {/* Countdown overlay */}
      {gamePhase === 'countdown' && <CountdownOverlay />}
      
      {/* Round/game end overlays */}
      {gamePhase === 'round_end' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-50">
          <h2 className="font-display text-6xl text-white">Round Over</h2>
        </div>
      )}
      
      {gamePhase === 'game_end' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-50">
          <h2 className="font-display text-6xl text-voxel-primary">Game Over</h2>
        </div>
      )}
    </div>
  );
}

function CountdownOverlay() {
  const { phaseEndTime } = useGameStore();
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const interval = setInterval(() => {
      if (phaseEndTime) {
        const remaining = Math.ceil((phaseEndTime - Date.now()) / 1000);
        setCountdown(Math.max(0, remaining));
      }
    }, 100);

    return () => clearInterval(interval);
  }, [phaseEndTime]);

  if (countdown <= 0) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
      <div className="text-center">
        <div 
          className="font-display text-[200px] text-voxel-primary animate-pulse"
          style={{ textShadow: '0 0 60px rgba(0, 255, 136, 0.8)' }}
        >
          {countdown}
        </div>
        <p className="font-display text-2xl text-white/80 tracking-widest">
          GET READY
        </p>
      </div>
    </div>
  );
}

