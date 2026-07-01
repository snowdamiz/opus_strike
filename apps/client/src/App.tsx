import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { MapProfileId, VoxelMapSizeId, VoxelMapTheme } from '@voxel-strike/shared';
import { useGameStore } from './store/gameStore';
import { useSettingsStore } from './store/settingsStore';
import { MainLobby } from './components/ui/MainLobby';
import { Lobby } from './components/ui/Lobby';
import { MatchmakingScreen } from './components/ui/MatchmakingScreen';
import { HUD } from './components/ui/HUD';
import { PracticeLoadingScreen } from './components/ui/PracticeLoadingScreen';
import { MATCH_LOADING_INITIAL_PROGRESS, MatchLoadingScreen } from './components/ui/MatchLoadingScreen';
import { TeleportEffects } from './components/ui/TeleportEffects';
import { UltimateEffects } from './components/ui/UltimateEffects';
import { SlideEffects } from './components/ui/SlideEffects';
import { MobileControls } from './components/ui/MobileControls';
import { TutorialGuide } from './components/ui/TutorialGuide';
import { disposeSharedAudioResources, useAudio, useMusic } from './hooks/useAudio';
import { useGlobalButtonSounds } from './hooks/useUiAudio';
import { useNetwork } from './contexts/NetworkContext';
import { mouseButtonToKeybindCode } from './utils/keybindings';
import { installLocalCombatStressScenario } from './utils/combatStressScenario';
import { requestMapPreviewManifest } from './utils/mapPreview/mapPreviewManifestClient';
import { seedMapPrepCacheFromManifest } from './utils/mapWarmup/mapPrepCache';
import { getMapPrepCacheKey } from './utils/mapWarmup/mapPrepCacheKey';
import { prebuildPreparedMapGeometryDeferred } from './utils/mapWarmup/deferredMapGeometryWarmup';
import { config } from './config/environment';
import type { MapWarmupSnapshot } from './utils/mapWarmup/mapWarmupCoordinator';

const GameCanvas = lazy(() => import('./components/game/GameCanvas').then((module) => ({ default: module.GameCanvas })));
const MapVoteScreen = lazy(() => import('./components/ui/MapVoteScreen').then((module) => ({ default: module.MapVoteScreen })));
const Scoreboard = lazy(() => import('./components/ui/Scoreboard').then((module) => ({ default: module.Scoreboard })));
const InGameMenu = lazy(() => import('./components/ui/InGameMenu').then((module) => ({ default: module.InGameMenu })));
const GameConsole = lazy(() => import('./components/ui/GameConsole').then((module) => ({ default: module.GameConsole })));
const MatchSummaryScreen = lazy(() => import('./components/ui/MatchSummaryScreen').then((module) => ({ default: module.MatchSummaryScreen })));
const PerfMonitorOverlay = lazy(() => import('./components/game/PerfMonitor').then((module) => ({ default: module.PerfMonitorOverlay })));
const PREMATCH_COUNTDOWN_EFFECT_FADE_MS = 3000;
const STARTUP_QUALITY_RAMP_MS = 1600;
const MATCH_RESOURCE_WARMUP_IDLE_TIMEOUT_MS = 80;
const BATTLE_ROYAL_PENDING_MAP_PROGRESS_CAP = 24;
const MENU_LOADING_PROGRESS_CAP = 72;
const MAP_VOTE_LOADING_PROGRESS_CAP = 64;

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

function yieldForMatchResourceWarmup(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => resolve(), { timeout: MATCH_RESOURCE_WARMUP_IDLE_TIMEOUT_MS });
      return;
    }

    window.setTimeout(resolve, 0);
  });
}

async function prepareMatchMapWarmupResources(input: {
  seed: number;
  themeId?: VoxelMapTheme['id'] | null;
  mapSize?: VoxelMapSizeId | null;
  mapProfileId?: MapProfileId | null;
  label: string;
}): Promise<void> {
  const manifest = await requestMapPreviewManifest({
    seed: input.seed,
    themeId: input.themeId ?? null,
    mapSize: input.mapSize,
    mapProfileId: input.mapProfileId,
  });
  const preparedMap = seedMapPrepCacheFromManifest(input.seed, manifest, 'match');
  prebuildPreparedMapGeometryDeferred(preparedMap, { frameBudgetMs: 2, label: input.label });
}

export function App() {
  const appPhase = useGameStore((state) => state.appPhase);
  const gamePhase = useGameStore((state) => state.gamePhase);
  const matchSummary = useGameStore((state) => state.matchSummary);
  const isLoading = useGameStore((state) => state.isLoading);
  const isPracticeMode = useGameStore((state) => state.isPracticeMode);
  const isTutorialMode = useGameStore((state) => state.isTutorialMode);
  const tutorialCompletionOverlayOpen = useGameStore((state) => state.tutorialCompletionOverlayOpen);
  const isPracticePreparing = useGameStore((state) => state.isPracticePreparing);
  const mapSeed = useGameStore((state) => state.mapSeed);
  const mapThemeId = useGameStore((state) => state.mapThemeId);
  const mapSize = useGameStore((state) => state.mapSize);
  const mapProfileId = useGameStore((state) => state.mapProfileId);
  const gameplayMode = useGameStore((state) => state.gameplayMode);
  const isObserverMode = useGameStore((state) => state.localPlayer?.role === 'observer');
  const scoreboardKeybind = useSettingsStore((state) => state.settings.keybindings.scoreboard);
  const showHUD = useSettingsStore((state) => state.settings.showHUD);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [showInGameMenu, setShowInGameMenu] = useState(false);
  const [shouldMountMatchWorld, setShouldMountMatchWorld] = useState(false);
  const [isMatchStartSceneReady, setIsMatchStartSceneReady] = useState(false);
  const [isMatchSceneReady, setIsMatchSceneReady] = useState(false);
  const [isMatchLoadingVisible, setIsMatchLoadingVisible] = useState(false);
  const [areMatchResourcesReady, setAreMatchResourcesReady] = useState(false);
  const [matchWarmupSnapshot, setMatchWarmupSnapshot] = useState<MapWarmupSnapshot | null>(null);
  const [isStartupRampActive, setIsStartupRampActive] = useState(false);
  const mountedWarmupKeyRef = useRef<string | null>(null);
  const revealedWarmupKeyRef = useRef<string | null>(null);
  const matchLoadingProgressRef = useRef(MATCH_LOADING_INITIAL_PROGRESS);
  const wasTrackingMatchLoadingRef = useRef(false);
  const reportedMatchStartGateRef = useRef<number | null>(null);
  const { playLobbyMusic, playGameMusic, pauseMusic, resumeMusic } = useMusic();
  const { preloadSoundGroup } = useAudio();
  const { matchStartGateKey, reportMatchSceneReady } = useNetwork();
  useGlobalButtonSounds();

  useEffect(() => () => {
    disposeSharedAudioResources();
  }, []);

  const isActiveGame = gamePhase === 'playing' || gamePhase === 'countdown' || gamePhase === 'deployment';
  const shouldPrepareMatchWorld = (
    appPhase === 'in_game' &&
    !matchSummary &&
    (gamePhase === 'waiting' || gamePhase === 'hero_select' || isActiveGame)
  );
  const warmupKey = useMemo(
    () => getMapPrepCacheKey({ seed: mapSeed, themeId: mapThemeId, mapSize, mapProfileId }),
    [mapSeed, mapThemeId, mapSize, mapProfileId]
  );
  const shouldShowMatchLoading = (
    shouldPrepareMatchWorld &&
    (
      isMatchLoadingVisible ||
      !shouldMountMatchWorld ||
      !isMatchSceneReady
    )
  );
  const shouldTrackMatchLoadingProgress = appPhase === 'match_loading' || shouldPrepareMatchWorld;
  const isBattleRoyalLoading = gameplayMode === 'battle_royal' || mapProfileId === 'battle_royal_large';
  const matchLoadingTitle = isBattleRoyalLoading ? 'GENERATING MAP' : 'LOADING ARENA';
  const matchLoadingEyebrow = isBattleRoyalLoading ? 'Battle Royal' : 'Match';
  const matchWarmupStages = useMemo(
    () => matchWarmupSnapshot ? Object.values(matchWarmupSnapshot.stages) : undefined,
    [matchWarmupSnapshot]
  );

  useEffect(() => {
    installLocalCombatStressScenario();
  }, []);

  useEffect(() => {
    if (!shouldTrackMatchLoadingProgress) {
      wasTrackingMatchLoadingRef.current = false;
      matchLoadingProgressRef.current = MATCH_LOADING_INITIAL_PROGRESS;
      return;
    }

    if (!wasTrackingMatchLoadingRef.current) {
      wasTrackingMatchLoadingRef.current = true;
      matchLoadingProgressRef.current = MATCH_LOADING_INITIAL_PROGRESS;
    }
  }, [shouldTrackMatchLoadingProgress]);

  useEffect(() => {
    const shouldPreloadLobbyAudio = (
      appPhase === 'matchmaking' ||
      appPhase === 'in_lobby' ||
      appPhase === 'map_vote' ||
      appPhase === 'match_loading'
    );

    preloadSoundGroup(shouldPreloadLobbyAudio ? 'lobby' : 'menu');
  }, [appPhase, preloadSoundGroup]);

  useEffect(() => {
    if (!shouldPrepareMatchWorld) {
      setAreMatchResourcesReady(false);
      return;
    }

    let cancelled = false;
    setAreMatchResourcesReady(false);
    const mapWarmupPromise = isBattleRoyalLoading
      ? prepareMatchMapWarmupResources({
        seed: mapSeed,
        themeId: mapThemeId,
        mapSize,
        mapProfileId,
        label: 'match-loading',
      }).catch((error) => {
        console.warn('[App] Match map warmup failed', error);
      })
      : Promise.resolve();

    (async () => {
      try {
        const soundGroups = ['commonCombat', 'phantom', 'blaze', 'hookshot', 'chronos'] as const;
        const soundWarmupPromise = Promise.all(soundGroups.map((group) => preloadSoundGroup(group)));
        const effectWarmupPromise = import('./components/game/effectPrewarm')
          .then((effectPrewarm) => effectPrewarm.prewarmGameplayEffectResourcesOnce());
        const combatTextWarmupPromise = import('./components/game/CombatText')
          .then((combatText) => {
            combatText.prewarmCombatTextTextures();
          });

        await Promise.all([
          soundWarmupPromise,
          effectWarmupPromise,
          combatTextWarmupPromise,
          mapWarmupPromise,
        ]);
        await yieldForMatchResourceWarmup();
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
  }, [
    isBattleRoyalLoading,
    mapProfileId,
    mapSeed,
    mapSize,
    mapThemeId,
    preloadSoundGroup,
    shouldPrepareMatchWorld,
  ]);

  // Manage background music based on game phase
  useEffect(() => {
    if (isLoading) return;

    // Play game music during active gameplay, lobby music otherwise
    if (appPhase === 'in_game' && isActiveGame) {
      playGameMusic();
    } else {
      playLobbyMusic();
    }
  }, [appPhase, isActiveGame, isLoading, playLobbyMusic, playGameMusic]);

  // Pause/resume music when in-game menu opens/closes (only during active game)
  useEffect(() => {
    // Only manage pause/resume when actually in a playing game
    if (appPhase === 'in_game' && isActiveGame) {
      if (showInGameMenu) {
        pauseMusic();
      } else {
        resumeMusic();
      }
    }
  }, [showInGameMenu, appPhase, isActiveGame, pauseMusic, resumeMusic]);

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
      const tutorialCompletionOverlayOpen = useGameStore.getState().tutorialCompletionOverlayOpen;
      if (
        document.pointerLockElement === null &&
        appPhase === 'in_game' &&
        !showInGameMenu &&
        !tutorialCompletionOverlayOpen
      ) {
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
    if (tutorialCompletionOverlayOpen) {
      setShowInGameMenu(false);
    }
  }, [tutorialCompletionOverlayOpen]);

  useEffect(() => {
    if (!shouldPrepareMatchWorld) {
      setShouldMountMatchWorld(false);
      setIsMatchStartSceneReady(false);
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
      setIsMatchStartSceneReady(false);
      setIsMatchSceneReady(false);
      setMatchWarmupSnapshot(null);
      setIsStartupRampActive(false);
    }

    if (!isMatchSceneReady) {
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

  const handleMatchStartSceneReady = useCallback(() => {
    setIsMatchStartSceneReady(true);
  }, []);

  const handleMatchSceneReady = useCallback(() => {
    setIsMatchSceneReady(true);
  }, []);

  const handleWarmupUpdate = useCallback((snapshot: MapWarmupSnapshot) => {
    setMatchWarmupSnapshot(snapshot);
  }, []);

  const handleMatchLoadingProgressChange = useCallback((progress: number) => {
    matchLoadingProgressRef.current = progress;
  }, []);

  useEffect(() => {
    if (matchStartGateKey === null) {
      reportedMatchStartGateRef.current = null;
    }
  }, [matchStartGateKey]);

  useEffect(() => {
    if (
      isPracticeMode ||
      gamePhase !== 'hero_select' ||
      !isMatchStartSceneReady ||
      matchStartGateKey === null ||
      reportedMatchStartGateRef.current === matchStartGateKey
    ) {
      return;
    }

    reportedMatchStartGateRef.current = matchStartGateKey;
    reportMatchSceneReady();
  }, [
    gamePhase,
    isMatchStartSceneReady,
    isPracticeMode,
    matchStartGateKey,
    reportMatchSceneReady,
  ]);

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

  if (isLoading && appPhase === 'menu') {
    return (
      <MatchLoadingScreen
        eyebrow="Network"
        title="CONNECTING"
        label="Server"
        ariaLabel="Connecting to server"
        trackStartLabel="Client"
        trackEndLabel="Server"
        fallbackProgressCap={MENU_LOADING_PROGRESS_CAP}
      />
    );
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
    return (
      <Suspense
        fallback={(
          <MatchLoadingScreen
            eyebrow="Maps"
            title="PREPARING VOTE"
            label="Map Options"
            ariaLabel="Preparing map vote"
            trackStartLabel="Lobby"
            trackEndLabel="Vote"
            fallbackProgressCap={MAP_VOTE_LOADING_PROGRESS_CAP}
          />
        )}
      >
        <MapVoteScreen />
      </Suspense>
    );
  }

  if (appPhase === 'match_loading') {
    return (
      <MatchLoadingScreen
        key={warmupKey}
        initialProgress={matchLoadingProgressRef.current}
        eyebrow={matchLoadingEyebrow}
        title={matchLoadingTitle}
        label={isBattleRoyalLoading ? 'Server Map' : 'Preparing'}
        fallbackProgressCap={isBattleRoyalLoading ? BATTLE_ROYAL_PENDING_MAP_PROGRESS_CAP : undefined}
        onProgressChange={handleMatchLoadingProgressChange}
      />
    );
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
              onMatchStartReady={handleMatchStartSceneReady}
              onReady={handleMatchSceneReady}
              onWarmupUpdate={handleWarmupUpdate}
              startupRampActive={isStartupRampActive}
            />
          )}
        </Suspense>

        {shouldShowMatchLoading && (
          <MatchLoadingScreen
            key={warmupKey}
            isComplete={isMatchSceneReady}
            initialProgress={matchLoadingProgressRef.current}
            progress={matchWarmupSnapshot?.progress}
            eyebrow={matchLoadingEyebrow}
            title={matchLoadingTitle}
            label={matchWarmupSnapshot?.label ?? (isBattleRoyalLoading ? 'Client Map' : 'Preparing')}
            fallbackProgressCap={isBattleRoyalLoading ? BATTLE_ROYAL_PENDING_MAP_PROGRESS_CAP : undefined}
            stages={isBattleRoyalLoading ? matchWarmupStages : undefined}
            onProgressChange={handleMatchLoadingProgressChange}
          />
        )}

        {/* Show HUD during active gameplay */}
        {isActiveGame && isMatchSceneReady && !isObserverMode && (
          <>
            {showHUD && <HUD />}
            {isTutorialMode && <TutorialGuide />}
            <TeleportEffects />
            <UltimateEffects />
            <SlideEffects />
            <MobileControls
              disabled={showInGameMenu || tutorialCompletionOverlayOpen}
              onOpenMenu={() => setShowInGameMenu(true)}
              onScoreboardChange={setShowScoreboard}
            />
            <Suspense fallback={null}>
              {showScoreboard && !isPracticeMode && <Scoreboard />}
            </Suspense>
          </>
        )}

        {/* Countdown overlay */}
        {gamePhase === 'countdown' && isMatchSceneReady && !isObserverMode && <CountdownOverlay />}

        {/* Round/game end overlays */}
        {gamePhase === 'round_end' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-50 px-4 text-center">
            <h2 className="game-end-overlay-title font-display text-white">Round Over</h2>
          </div>
        )}

        {gamePhase === 'game_end' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-50 px-4 text-center">
            <h2 className="game-end-overlay-title font-display text-voxel-primary">Game Over</h2>
          </div>
        )}

        {/* In-game menu (ESC) */}
        <Suspense fallback={null}>
          {showInGameMenu && !tutorialCompletionOverlayOpen && <InGameMenu onClose={() => setShowInGameMenu(false)} />}
        </Suspense>

        {/* Developer console (Enter key) */}
        <Suspense fallback={null}>
          <GameConsole />
        </Suspense>

        {/* Performance monitor overlay */}
        <Suspense fallback={null}>
          {config.clientDiagnosticsEnabled && isMatchSceneReady && <PerfMonitorOverlay />}
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
    let timeoutId: number | null = null;

    const updateCountdown = () => {
      const nextRemainingMs = getCountdownRemainingMs(phaseEndTime);
      setRemainingMs(nextRemainingMs);
      if (nextRemainingMs <= 0) return;

      const msUntilNextSecond = nextRemainingMs % 1000 || 1000;
      timeoutId = window.setTimeout(updateCountdown, Math.max(32, msUntilNextSecond + 8));
    };

    updateCountdown();

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
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
          className="prematch-countdown-number font-display text-voxel-primary animate-pulse"
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
