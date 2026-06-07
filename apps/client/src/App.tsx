import { useCallback, useEffect, useState } from 'react';
import { useGameStore } from './store/gameStore';
import { MainLobby } from './components/ui/MainLobby';
import { Lobby } from './components/ui/Lobby';
import { GameCanvas } from './components/game/GameCanvas';
import { HUD } from './components/ui/HUD';
import { HeroSelect } from './components/ui/HeroSelect';
import { LoadingScreen } from './components/ui/LoadingScreen';
import { MatchLoadingScreen } from './components/ui/MatchLoadingScreen';
import { Scoreboard } from './components/ui/Scoreboard';
import { InGameMenu } from './components/ui/InGameMenu';
import { GameConsole } from './components/ui/GameConsole';
import { PerfMonitorOverlay } from './components/game/PerfMonitor';
import { ShadowStepOverlay } from './components/ui/ShadowStepOverlay';
import { TeleportEffects } from './components/ui/TeleportEffects';
import { UltimateEffects } from './components/ui/UltimateEffects';
import { SlideEffects } from './components/ui/SlideEffects';
import { useMusic } from './hooks/useAudio';

export function App() {
  const appPhase = useGameStore((state) => state.appPhase);
  const gamePhase = useGameStore((state) => state.gamePhase);
  const isLoading = useGameStore((state) => state.isLoading);
  const mapSeed = useGameStore((state) => state.mapSeed);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [showInGameMenu, setShowInGameMenu] = useState(false);
  const [shouldMountMatchWorld, setShouldMountMatchWorld] = useState(false);
  const [isMatchSceneReady, setIsMatchSceneReady] = useState(false);
  const [isMatchLoadingVisible, setIsMatchLoadingVisible] = useState(false);
  const { playLobbyMusic, playGameMusic, pauseMusic, resumeMusic } = useMusic();
  const isPreGame = gamePhase === 'waiting' || gamePhase === 'hero_select' || !gamePhase;
  const shouldLoadMatchWorld = appPhase === 'in_game' && !isPreGame;

  // Manage background music based on game phase
  useEffect(() => {
    if (isLoading) return;

    // Play game music during active gameplay, lobby music otherwise
    if (appPhase === 'in_game' && (gamePhase === 'playing' || gamePhase === 'countdown')) {
      playGameMusic();
    } else {
      playLobbyMusic();
    }
  }, [appPhase, gamePhase, isLoading, playLobbyMusic, playGameMusic]);

  // Pause/resume music when in-game menu opens/closes (only during active game)
  useEffect(() => {
    // Only manage pause/resume when actually in a playing game
    if (appPhase === 'in_game' && (gamePhase === 'playing' || gamePhase === 'countdown')) {
      if (showInGameMenu) {
        pauseMusic();
      } else {
        resumeMusic();
      }
    }
  }, [showInGameMenu, appPhase, gamePhase, pauseMusic, resumeMusic]);

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
          canvas.requestPointerLock().catch(() => { });
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

  useEffect(() => {
    if (!shouldLoadMatchWorld) {
      setShouldMountMatchWorld(false);
      setIsMatchSceneReady(false);
      setIsMatchLoadingVisible(false);
      return;
    }

    setShouldMountMatchWorld(false);
    setIsMatchSceneReady(false);
    setIsMatchLoadingVisible(true);

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setShouldMountMatchWorld(true);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [mapSeed, shouldLoadMatchWorld]);

  useEffect(() => {
    if (!isMatchSceneReady) return;

    const timeout = window.setTimeout(() => {
      setIsMatchLoadingVisible(false);
    }, 240);

    return () => window.clearTimeout(timeout);
  }, [isMatchSceneReady]);

  const handleMatchSceneReady = useCallback(() => {
    setIsMatchSceneReady(true);
  }, []);

  if (isLoading) {
    return <LoadingScreen />;
  }

  // Show appropriate screen based on app phase
  // Authentication is now handled within MainLobby
  if (appPhase === 'menu' || appPhase === 'browsing_lobbies') {
    return <MainLobby />;
  }

  if (appPhase === 'in_lobby') {
    return <Lobby />;
  }

  // In game
  if (appPhase === 'in_game') {
    // Determine what phase we're in
    const isActiveGame = gamePhase === 'playing' || gamePhase === 'countdown';

    return (
      <div className="w-full h-full relative game-active">
        {shouldMountMatchWorld && <GameCanvas onReady={handleMatchSceneReady} />}

        {/* Show hero select during pre-game phases */}
        {isPreGame && <HeroSelect />}

        {!isPreGame && isMatchLoadingVisible && (
          <MatchLoadingScreen isComplete={isMatchSceneReady} />
        )}

        {/* Show HUD during active gameplay */}
        {isActiveGame && isMatchSceneReady && (
          <>
            <HUD />
            <ShadowStepOverlay />
            <TeleportEffects />
            <UltimateEffects />
            <SlideEffects />
            {showScoreboard && <Scoreboard />}
          </>
        )}

        {/* Countdown overlay */}
        {gamePhase === 'countdown' && isMatchSceneReady && <CountdownOverlay />}

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

        {/* Developer console (Enter key) */}
        <GameConsole />

        {/* Performance monitor overlay */}
        {isMatchSceneReady && <PerfMonitorOverlay />}
      </div>
    );
  }

  // Fallback to main lobby
  return <MainLobby />;
}

function CountdownOverlay() {
  const phaseEndTime = useGameStore((state) => state.phaseEndTime);
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
          style={{ textShadow: '0 0 60px rgb(var(--color-ui-objective) / 0.8)' }}
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
