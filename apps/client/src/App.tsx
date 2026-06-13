import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useGameStore } from './store/gameStore';
import { useSettingsStore } from './store/settingsStore';
import { MainLobby } from './components/ui/MainLobby';
import { Lobby } from './components/ui/Lobby';
import { MatchmakingScreen } from './components/ui/MatchmakingScreen';
import { MapVoteScreen } from './components/ui/MapVoteScreen';
import { HUD } from './components/ui/HUD';
import { HeroSelect } from './components/ui/HeroSelect';
import { LoadingScreen } from './components/ui/LoadingScreen';
import { PracticeLoadingScreen } from './components/ui/PracticeLoadingScreen';
import { MatchLoadingScreen } from './components/ui/MatchLoadingScreen';
import { TeleportEffects } from './components/ui/TeleportEffects';
import { UltimateEffects } from './components/ui/UltimateEffects';
import { SlideEffects } from './components/ui/SlideEffects';
import { MobileControls } from './components/ui/MobileControls';
import { useAudio, useGlobalButtonSounds, useMusic } from './hooks/useAudio';
import { mouseButtonToKeybindCode } from './utils/keybindings';
import { installLocalCombatStressScenario } from './utils/combatStressScenario';
import { getMapPrepCacheKey } from './utils/mapWarmup/mapPrepCache';
import type { MapWarmupSnapshot } from './utils/mapWarmup/mapWarmupCoordinator';

const GameCanvas = lazy(() => import('./components/game/GameCanvas').then((module) => ({ default: module.GameCanvas })));
const Scoreboard = lazy(() => import('./components/ui/Scoreboard').then((module) => ({ default: module.Scoreboard })));
const InGameMenu = lazy(() => import('./components/ui/InGameMenu').then((module) => ({ default: module.InGameMenu })));
const GameConsole = lazy(() => import('./components/ui/GameConsole').then((module) => ({ default: module.GameConsole })));
const MatchSummaryScreen = lazy(() => import('./components/ui/MatchSummaryScreen').then((module) => ({ default: module.MatchSummaryScreen })));
const PerfMonitorOverlay = lazy(() => import('./components/game/PerfMonitor').then((module) => ({ default: module.PerfMonitorOverlay })));
const PREMATCH_COUNTDOWN_EFFECT_FADE_MS = 3000;
const STARTUP_QUALITY_RAMP_MS = 1600;

type CountdownEffectStyle = CSSProperties & {
  '--prematch-countdown-backdrop-opacity': string;
  '--prematch-countdown-brightness': string;
  '--prematch-countdown-edge-opacity': string;
  '--prematch-countdown-grayscale': string;
  '--prematch-countdown-saturate': string;
  '--prematch-countdown-scan-opacity': string;
  '--prematch-countdown-side-mid-opacity': string;
  '--prematch-countdown-side-opacity': string;
};

function getCountdownRemainingMs(phaseEndTime: number | null): number {
  return phaseEndTime ? Math.max(0, phaseEndTime - Date.now()) : 0;
}

function smoothstep(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function isStartupQualityRampDisabled(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('disableStartupRamp') === '1') return true;
    return window.localStorage.getItem('voxel:disableStartupRamp') === '1';
  } catch {
    return false;
  }
}

export function App() {
  const appPhase = useGameStore((state) => state.appPhase);
  const gamePhase = useGameStore((state) => state.gamePhase);
  const matchSummary = useGameStore((state) => state.matchSummary);
  const isLoading = useGameStore((state) => state.isLoading);
  const isPracticeMode = useGameStore((state) => state.isPracticeMode);
  const isPracticePreparing = useGameStore((state) => state.isPracticePreparing);
  const mapSeed = useGameStore((state) => state.mapSeed);
  const localHeroId = useGameStore((state) => state.localPlayer?.heroId ?? null);
  const scoreboardKeybind = useSettingsStore((state) => state.settings.keybindings.scoreboard);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [showInGameMenu, setShowInGameMenu] = useState(false);
  const [shouldMountMatchWorld, setShouldMountMatchWorld] = useState(false);
  const [isMatchSceneReady, setIsMatchSceneReady] = useState(false);
  const [isMatchLoadingVisible, setIsMatchLoadingVisible] = useState(false);
  const [areMatchResourcesReady, setAreMatchResourcesReady] = useState(false);
  const [matchWarmupSnapshot, setMatchWarmupSnapshot] = useState<MapWarmupSnapshot | null>(null);
  const [isStartupRampActive, setIsStartupRampActive] = useState(false);
  const mountedWarmupKeyRef = useRef<string | null>(null);
  const revealedWarmupKeyRef = useRef<string | null>(null);
  const { playLobbyMusic, playGameMusic, pauseMusic, resumeMusic } = useMusic();
  const { preloadSoundGroup, preloadHeroSounds } = useAudio();
  useGlobalButtonSounds();
  const isPreGame = gamePhase === 'waiting' || gamePhase === 'hero_select' || !gamePhase;
  const isActiveGame = gamePhase === 'playing' || gamePhase === 'countdown';
  const shouldPrepareMatchWorld = (
    appPhase === 'in_game' &&
    !matchSummary &&
    (gamePhase === 'waiting' || gamePhase === 'hero_select' || isActiveGame)
  );
  const warmupKey = useMemo(() => getMapPrepCacheKey({ seed: mapSeed }), [mapSeed]);

  useEffect(() => {
    installLocalCombatStressScenario();
  }, []);

  useEffect(() => {
    preloadSoundGroup(appPhase === 'matchmaking' || appPhase === 'in_lobby' || appPhase === 'map_vote' ? 'lobby' : 'menu');
  }, [appPhase, preloadSoundGroup]);

  useEffect(() => {
    if (!shouldPrepareMatchWorld) {
      setAreMatchResourcesReady(false);
      return;
    }

    let cancelled = false;
    setAreMatchResourcesReady(false);

    (async () => {
      try {
        const heroEffectWarmup = localHeroId === 'phantom'
          ? import('./components/game/effectPrewarm').then(({ prewarmPhantomEffects }) => prewarmPhantomEffects())
          : localHeroId === 'blaze'
            ? import('./components/game/effectPrewarm').then(({ prewarmBlazeEffects }) => prewarmBlazeEffects())
            : Promise.resolve();

        await Promise.all([
          preloadSoundGroup('commonCombat'),
          preloadHeroSounds(localHeroId),
          heroEffectWarmup,
        ]);
      } catch (error) {
        console.warn('[App] Match resource preload failed', error);
      } finally {
        if (!cancelled) {
          setAreMatchResourcesReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [localHeroId, preloadHeroSounds, preloadSoundGroup, shouldPrepareMatchWorld, warmupKey]);

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
    const showScoreboardForCode = (code: string) => {
      if (code !== scoreboardKeybind) return false;

      setShowScoreboard(true);
      return true;
    };

    const hideScoreboardForCode = (code: string) => {
      if (code !== scoreboardKeybind) return false;

      setShowScoreboard(false);
      return true;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (showScoreboardForCode(e.code)) {
        e.preventDefault();
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
      if (hideScoreboardForCode(e.code)) {
        e.preventDefault();
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (showScoreboardForCode(mouseButtonToKeybindCode(e.button))) {
        e.preventDefault();
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (hideScoreboardForCode(mouseButtonToKeybindCode(e.button))) {
        e.preventDefault();
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
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('pointerlockchange', handlePointerLockChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
    };
  }, [appPhase, scoreboardKeybind, showInGameMenu]);

  // Close menu when leaving the game
  useEffect(() => {
    if (appPhase !== 'in_game') {
      setShowInGameMenu(false);
    }
  }, [appPhase]);

  useEffect(() => {
    if (!shouldPrepareMatchWorld) {
      setShouldMountMatchWorld(false);
      setIsMatchSceneReady(false);
      setIsMatchLoadingVisible(false);
      setMatchWarmupSnapshot(null);
      setIsStartupRampActive(false);
      mountedWarmupKeyRef.current = null;
      revealedWarmupKeyRef.current = null;
      return;
    }

    if (mountedWarmupKeyRef.current !== warmupKey) {
      mountedWarmupKeyRef.current = warmupKey;
      revealedWarmupKeyRef.current = null;
      setShouldMountMatchWorld(false);
      setIsMatchSceneReady(false);
      setMatchWarmupSnapshot(null);
      setIsStartupRampActive(false);
    }

    if (isActiveGame && !isMatchSceneReady) {
      setIsMatchLoadingVisible(true);
    }

    if (!areMatchResourcesReady) {
      return;
    }

    if (shouldMountMatchWorld) {
      return;
    }

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
  }, [
    areMatchResourcesReady,
    isActiveGame,
    isMatchSceneReady,
    shouldMountMatchWorld,
    shouldPrepareMatchWorld,
    warmupKey,
  ]);

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

  const handleWarmupUpdate = useCallback((snapshot: MapWarmupSnapshot) => {
    setMatchWarmupSnapshot(snapshot);
  }, []);

  useEffect(() => {
    if (!isActiveGame || !isMatchSceneReady || isMatchLoadingVisible) return;
    if (revealedWarmupKeyRef.current === warmupKey) return;

    revealedWarmupKeyRef.current = warmupKey;
    if (isStartupQualityRampDisabled()) return;

    setIsStartupRampActive(true);
    const timeout = window.setTimeout(() => {
      setIsStartupRampActive(false);
    }, STARTUP_QUALITY_RAMP_MS);

    return () => {
      window.clearTimeout(timeout);
      setIsStartupRampActive(false);
    };
  }, [isActiveGame, isMatchLoadingVisible, isMatchSceneReady, warmupKey]);

  if (isPracticePreparing) {
    return <PracticeLoadingScreen />;
  }

  if (isLoading) {
    return <LoadingScreen />;
  }

  // Show appropriate screen based on app phase
  // Authentication is now handled within MainLobby
  if (appPhase === 'menu') {
    return <MainLobby />;
  }

  if (appPhase === 'in_lobby') {
    return <Lobby />;
  }

  if (appPhase === 'matchmaking') {
    return <MatchmakingScreen />;
  }

  if (appPhase === 'map_vote') {
    return <MapVoteScreen />;
  }

  // In game
  if (appPhase === 'in_game') {
    if (matchSummary) {
      return (
        <Suspense fallback={null}>
          <MatchSummaryScreen />
        </Suspense>
      );
    }

    return (
      <div className="w-full h-full relative game-active">
        <Suspense fallback={null}>
          {shouldMountMatchWorld && (
            <GameCanvas
              onReady={handleMatchSceneReady}
              onWarmupUpdate={handleWarmupUpdate}
              startupRampActive={isStartupRampActive}
            />
          )}
        </Suspense>

        {/* Show hero select during pre-game phases */}
        {isPreGame && <HeroSelect />}

        {!isPreGame && isMatchLoadingVisible && (
          <MatchLoadingScreen
            key={warmupKey}
            isComplete={isMatchSceneReady}
            progress={matchWarmupSnapshot?.progress}
            label={matchWarmupSnapshot?.label}
          />
        )}

        {/* Show HUD during active gameplay */}
        {isActiveGame && isMatchSceneReady && (
          <>
            <HUD />
            <TeleportEffects />
            <UltimateEffects />
            <SlideEffects />
            <MobileControls
              disabled={showInGameMenu}
              onOpenMenu={() => setShowInGameMenu(true)}
              onScoreboardChange={setShowScoreboard}
            />
            <Suspense fallback={null}>
              {showScoreboard && !isPracticeMode && <Scoreboard />}
            </Suspense>
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
        <Suspense fallback={null}>
          {showInGameMenu && <InGameMenu onClose={() => setShowInGameMenu(false)} />}
        </Suspense>

        {/* Developer console (Enter key) */}
        <Suspense fallback={null}>
          <GameConsole />
        </Suspense>

        {/* Performance monitor overlay */}
        <Suspense fallback={null}>
          {isMatchSceneReady && <PerfMonitorOverlay />}
        </Suspense>
      </div>
    );
  }

  // Fallback to main lobby
  return <MainLobby />;
}

function CountdownOverlay() {
  const phaseEndTime = useGameStore((state) => state.phaseEndTime);
  const { playSound } = useAudio();
  const [remainingMs, setRemainingMs] = useState(() => getCountdownRemainingMs(phaseEndTime));
  const previousCountdownRef = useRef<number | null>(null);

  useEffect(() => {
    const updateCountdown = () => {
      setRemainingMs(getCountdownRemainingMs(phaseEndTime));
    };

    updateCountdown();
    const interval = window.setInterval(updateCountdown, 50);

    return () => window.clearInterval(interval);
  }, [phaseEndTime]);

  const countdown = Math.ceil(remainingMs / 1000);

  useEffect(() => {
    const previousCountdown = previousCountdownRef.current;
    if (previousCountdown !== null && countdown > 0 && countdown < previousCountdown) {
      void playSound('countdownTick');
    }
    previousCountdownRef.current = countdown;
  }, [countdown, playSound]);

  if (countdown <= 0) return null;

  const fadeRatio = remainingMs / PREMATCH_COUNTDOWN_EFFECT_FADE_MS;
  const effectIntensity = smoothstep(fadeRatio);
  const effectStyle: CountdownEffectStyle = {
    '--prematch-countdown-backdrop-opacity': (effectIntensity * 0.14).toFixed(3),
    '--prematch-countdown-brightness': (1 - effectIntensity * 0.18).toFixed(3),
    '--prematch-countdown-edge-opacity': (effectIntensity * 0.36).toFixed(3),
    '--prematch-countdown-grayscale': effectIntensity.toFixed(3),
    '--prematch-countdown-saturate': (1 - effectIntensity * 0.86).toFixed(3),
    '--prematch-countdown-scan-opacity': (effectIntensity * 0.22).toFixed(3),
    '--prematch-countdown-side-mid-opacity': (effectIntensity * 0.44).toFixed(3),
    '--prematch-countdown-side-opacity': (effectIntensity * 0.78).toFixed(3),
  };

  return (
    <div className="prematch-countdown-overlay" style={effectStyle}>
      <div className="prematch-countdown-tone" />
      <div className="prematch-countdown-vignette" />
      <div className="prematch-countdown-scanlines" />
      <div className="prematch-countdown-content">
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
