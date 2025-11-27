import { useEffect, useState } from 'react';
import { useGameStore } from './store/gameStore';
import { MainMenu } from './components/ui/MainMenu';
import { MainLobby } from './components/ui/MainLobby';
import { Lobby } from './components/ui/Lobby';
import { GameCanvas } from './components/game/GameCanvas';
import { HUD } from './components/ui/HUD';
import { HeroSelect } from './components/ui/HeroSelect';
import { LoadingScreen } from './components/ui/LoadingScreen';
import { Scoreboard } from './components/ui/Scoreboard';
import { InGameMenu } from './components/ui/InGameMenu';
import { GameConsole } from './components/ui/GameConsole';
import { ShadowStepOverlay } from './components/ui/ShadowStepOverlay';

export function App() {
  const { appPhase, gamePhase, isLoading, localPlayer } = useGameStore();
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [showInGameMenu, setShowInGameMenu] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        setShowScoreboard(true);
      }
      // ESC handling - only when menu is already open (to close it)
      // When pointer is locked, browser will exit pointer lock on ESC,
      // and we handle that in pointerlockchange event below
      if (e.code === 'Escape' && appPhase === 'in_game' && showInGameMenu) {
        e.preventDefault();
        // Request pointer lock and close menu
        const canvas = document.querySelector('canvas');
        if (canvas) {
          canvas.requestPointerLock().catch(() => {});
        }
        setShowInGameMenu(false);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        setShowScoreboard(false);
      }
    };

    // When pointer lock is released (by ESC or other means), open the menu
    const handlePointerLockChange = () => {
      if (document.pointerLockElement === null && appPhase === 'in_game' && !showInGameMenu) {
        // Pointer lock was exited - open the menu
        setShowInGameMenu(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    document.addEventListener('pointerlockchange', handlePointerLockChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
    };
  }, [appPhase, showInGameMenu]);

  // Close menu when leaving the game
  useEffect(() => {
    if (appPhase !== 'in_game') {
      setShowInGameMenu(false);
    }
  }, [appPhase]);

  if (isLoading) {
    return <LoadingScreen />;
  }

  // Show appropriate screen based on app phase
  if (appPhase === 'menu') {
    return <MainMenu />;
  }

  if (appPhase === 'browsing_lobbies') {
    return <MainLobby />;
  }

  if (appPhase === 'in_lobby') {
    return <Lobby />;
  }

  // In game
  if (appPhase === 'in_game') {
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
            <ShadowStepOverlay />
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

        {/* In-game menu (ESC) */}
        {showInGameMenu && <InGameMenu onClose={() => setShowInGameMenu(false)} />}

        {/* Developer console (backtick key) */}
        <GameConsole />
      </div>
    );
  }

  // Fallback to main menu
  return <MainMenu />;
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
