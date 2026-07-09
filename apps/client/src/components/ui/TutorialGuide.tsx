import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/shallow';
import {
  PLAYER_RADIUS,
  POWERUP_BUFF_DURATION_MS,
  POWERUP_HEALTH_RESTORE_RATIO,
  createTutorialVoxelMapManifest,
} from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useAudio } from '../../hooks/useAudio';
import { useNetwork } from '../../contexts/NetworkContext';
import { useWallet } from '../../contexts/WalletContext';
import { formatKeybind } from '../../utils/keybindings';
import { isTutorialOfflineTrainingHeroId } from '../../utils/tutorialOfflineCombatRuntime';
import { visualStore } from '../../store/visualStore';
import { BLAZE_UI_COLORS, WALLET_AUTH_COLORS } from '../../styles/colorTokens';
import {
  MOVEMENT_CHECKPOINT_Z,
  TUTORIAL_TASK_IDS,
  collectMovementTutorialCompletions,
  completeTasks,
  createInitialTaskCompletion,
  createTutorialMovementHistory,
  type TutorialStageId,
  type TutorialTaskCompletion,
  type TutorialTaskId,
} from './tutorialProgress';

type TutorialIconId =
  | 'move'
  | 'run'
  | 'crouch'
  | 'slide'
  | 'hop'
  | 'checkpoint'
  | 'target'
  | 'skill'
  | 'boost'
  | 'health'
  | 'flag'
  | 'capture'
  | 'complete';

interface TutorialTask {
  id: TutorialTaskId;
  stage: TutorialStageId;
  title: string;
  detail: string;
  icon: TutorialIconId;
}

const TUTORIAL_PICKUP_CHECK_MS = 80;
const TUTORIAL_OBJECTIVE_CHECK_MS = 80;
const TUTORIAL_PROGRESS_CHECK_MS = 80;
const LIVE_MOVEMENT_SAMPLE_MAX_AGE_MS = 250;
const OBJECTIVE_PICKUP_RADIUS = 2.4;
const OBJECTIVE_CAPTURE_RADIUS = 3;
const FLOATING_TEXT_STYLE = {
  textShadow: '0 2px 7px rgba(0,0,0,0.95), 0 0 18px rgba(0,0,0,0.72)',
} satisfies CSSProperties;
const STAGE_LABELS: Record<TutorialStageId, string> = {
  movement: 'Movement',
  combat: 'Target Practice',
  skills: 'Skills',
  powerups: 'Power Ups',
  objective: 'Objective',
};

function distance2D(
  a: { x: number; z: number },
  b: { x: number; z: number }
): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function horizontalSpeed(velocity: { x: number; z: number }): number {
  return Math.hypot(velocity.x, velocity.z);
}

function hasDownedTutorialTrainingHero(players: Iterable<{ id: string; state: string; health: number }>): boolean {
  for (const player of players) {
    if (isTutorialOfflineTrainingHeroId(player.id) && (player.state === 'dead' || player.health <= 0)) {
      return true;
    }
  }
  return false;
}

function TutorialIcon({ icon, className = 'h-8 w-8' }: { icon: TutorialIconId; className?: string }) {
  const commonProps = {
    className: `${className} shrink-0 text-white drop-shadow-[0_2px_7px_rgba(0,0,0,0.95)]`,
    fill: 'none',
    viewBox: '0 0 24 24',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (icon) {
    case 'run':
      return (
        <svg {...commonProps}>
          <path strokeWidth={2.2} d="M13 4l3 3-2.6 2.6 2.1 2.1" />
          <path strokeWidth={2.2} d="M10.5 8.5L7 12l-3 1" />
          <path strokeWidth={2.2} d="M11.2 12.2L8.8 20" />
          <path strokeWidth={2.2} d="M14.4 14.2l3.8 4.8" />
          <path strokeWidth={2.2} d="M16.5 3.5h.01" />
        </svg>
      );
    case 'crouch':
      return (
        <svg {...commonProps}>
          <path strokeWidth={2.2} d="M7 16h7.5l3 3" />
          <path strokeWidth={2.2} d="M8 12l3.5 3.5" />
          <path strokeWidth={2.2} d="M12 6h.01" />
          <path strokeWidth={2.2} d="M4 20h16" />
        </svg>
      );
    case 'slide':
      return (
        <svg {...commonProps}>
          <path strokeWidth={2.2} d="M4 18h16" />
          <path strokeWidth={2.2} d="M6 15l5.5-5.5 4 4L20 14" />
          <path strokeWidth={2.2} d="M12 5h.01" />
          <path strokeWidth={2.2} d="M3.5 12.5h3" />
        </svg>
      );
    case 'hop':
      return (
        <svg {...commonProps}>
          <path strokeWidth={2.2} d="M5 17c3.5-6.5 10.5-6.5 14 0" />
          <path strokeWidth={2.2} d="M8 17h.01M16 17h.01" />
          <path strokeWidth={2.2} d="M12 5v6" />
          <path strokeWidth={2.2} d="M9.5 8L12 5l2.5 3" />
        </svg>
      );
    case 'target':
      return (
        <svg {...commonProps}>
          <path strokeWidth={2.2} d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
          <path strokeWidth={2.2} d="M12 17a5 5 0 100-10 5 5 0 000 10z" />
          <path strokeWidth={2.2} d="M12 13a1 1 0 100-2 1 1 0 000 2z" />
          <path strokeWidth={2.2} d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
      );
    case 'checkpoint':
      return (
        <svg {...commonProps}>
          <path strokeWidth={2.2} d="M5 20V5" />
          <path strokeWidth={2.2} d="M5 5h10l-1.5 3L15 11H5" />
          <path strokeWidth={2.2} d="M3.5 20h5" />
        </svg>
      );
    case 'skill':
      return (
        <svg {...commonProps}>
          <path strokeWidth={2.2} d="M12 3l1.6 5.1L19 10l-5.4 1.9L12 17l-1.6-5.1L5 10l5.4-1.9L12 3z" />
          <path strokeWidth={2.2} d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15z" />
        </svg>
      );
    case 'boost':
      return (
        <svg {...commonProps}>
          <path strokeWidth={2.2} d="M12 3l4 7h-3l2 11-7-12h3L12 3z" />
          <path strokeWidth={2.2} d="M5 15h2M17 9h2" />
        </svg>
      );
    case 'health':
      return (
        <svg {...commonProps}>
          <path strokeWidth={2.2} d="M12 21s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 11c0 5.5-7 10-7 10z" />
          <path strokeWidth={2.2} d="M12 10v5M9.5 12.5h5" />
        </svg>
      );
    case 'flag':
      return (
        <svg {...commonProps}>
          <path strokeWidth={2.2} d="M6 20V5" />
          <path strokeWidth={2.2} d="M6 5h10l-1.4 3L16 11H6" />
          <path strokeWidth={2.2} d="M4 20h5" />
        </svg>
      );
    case 'capture':
      return (
        <svg {...commonProps}>
          <path strokeWidth={2.2} d="M12 3l8 4v5c0 4.2-3.1 7.1-8 9-4.9-1.9-8-4.8-8-9V7l8-4z" />
          <path strokeWidth={2.2} d="M8.5 12.2l2.2 2.2 4.8-5" />
        </svg>
      );
    case 'complete':
      return (
        <svg {...commonProps}>
          <path strokeWidth={2.4} d="M20 6L9 17l-5-5" />
        </svg>
      );
    case 'move':
    default:
      return (
        <svg {...commonProps}>
          <path strokeWidth={2.2} d="M4 12h14" />
          <path strokeWidth={2.2} d="M13 7l5 5-5 5" />
          <path strokeWidth={2.2} d="M4 7h4M4 17h4" />
        </svg>
      );
  }
}

function TutorialCompletionOverlay({
  isSaving,
  saveError,
  onComplete,
}: {
  isSaving: boolean;
  saveError: string | null;
  onComplete: () => void;
}) {
  const ctaColor = BLAZE_UI_COLORS.primary;

  return (
    <div
      data-tutorial-completion-overlay="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-completion-title"
      className="pointer-events-auto fixed inset-0 z-[120] flex items-center justify-center bg-white/10 p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] text-white backdrop-blur-md animate-fade-in"
    >
      <div
        className="w-[min(34rem,calc(100vw-2rem))] text-center animate-scale-in"
        style={FLOATING_TEXT_STYLE}
      >
        <div className="mx-auto flex h-16 w-16 items-center justify-center">
          <TutorialIcon icon="complete" className="h-11 w-11" />
        </div>
        <p className="mt-7 font-display text-sm uppercase tracking-[0.2em] text-orange-200">
          Training Complete
        </p>
        <h2 id="tutorial-completion-title" className="mt-2 text-balance font-display text-5xl leading-none text-white">
          Tutorial Complete
        </h2>
        <p className="mx-auto mt-4 max-w-[26rem] text-pretty text-lg leading-snug text-white/[0.84]">
          Nice work. Quick play, ranked, and custom lobbies are now unlocked.
        </p>
        {saveError && (
          <p className="mx-auto mt-4 max-w-[22rem] text-sm leading-snug text-red-200">
            {saveError}
          </p>
        )}
        <button
          type="button"
          autoFocus
          onClick={onComplete}
          disabled={isSaving}
          className="play-main-cta group"
          style={{
            background: `linear-gradient(135deg, ${ctaColor}, ${ctaColor}dd)`,
            boxShadow: `0 0 60px ${ctaColor}40, inset 0 1px 0 rgba(255,255,255,0.2)`,
          }}
        >
          <span
            className="absolute inset-0 opacity-0 group-hover:opacity-100"
            style={{ background: WALLET_AUTH_COLORS.shimmer }}
          />
          <span className="relative flex items-center justify-center gap-2">
            <svg className="h-5 w-5 sm:h-6 sm:w-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            {isSaving ? 'SAVING...' : 'COMPLETE'}
          </span>
        </button>
      </div>
    </div>
  );
}

export function TutorialGuide() {
  const {
    hasLocalPlayer,
    isTutorialMode,
    gamePhase,
    setTutorialCompletionOverlayOpen,
  } = useGameStore(
    useShallow((state) => ({
      hasLocalPlayer: Boolean(state.localPlayer),
      isTutorialMode: state.isTutorialMode,
      gamePhase: state.gamePhase,
      setTutorialCompletionOverlayOpen: state.setTutorialCompletionOverlayOpen,
    }))
  );
  const keybinds = useSettingsStore(
    useShallow((state) => ({
      forward: formatKeybind(state.settings.keybindings.moveForward),
      left: formatKeybind(state.settings.keybindings.moveLeft),
      right: formatKeybind(state.settings.keybindings.moveRight),
      sprint: formatKeybind(state.settings.keybindings.sprint),
      crouch: formatKeybind(state.settings.keybindings.crouch),
      jump: formatKeybind(state.settings.keybindings.jump),
      ability1: formatKeybind(state.settings.keybindings.ability1),
      ability2: formatKeybind(state.settings.keybindings.ability2),
      ultimate: formatKeybind(state.settings.keybindings.ultimate),
    }))
  );
  const { playSound } = useAudio();
  const { leaveGame } = useNetwork();
  const { completeTutorial } = useWallet();
  const [completedTasks, setCompletedTasks] = useState<TutorialTaskCompletion>(createInitialTaskCompletion);
  const [objectivePickedUp, setObjectivePickedUp] = useState(false);
  const [objectiveCaptured, setObjectiveCaptured] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const manifest = useMemo(() => createTutorialVoxelMapManifest(), []);
  const completedTasksRef = useRef(completedTasks);
  const movementHistoryRef = useRef(createTutorialMovementHistory());
  const targetTaskActivatedAtRef = useRef(0);
  const skillTaskActivatedAtRef = useRef(0);

  useEffect(() => {
    completedTasksRef.current = completedTasks;
  }, [completedTasks]);

  const markTasksComplete = useCallback((taskIds: readonly TutorialTaskId[]) => {
    setCompletedTasks((current) => completeTasks(current, taskIds));
  }, []);

  const tutorialTasks = useMemo<TutorialTask[]>(() => [
    {
      id: 'move_forward',
      stage: 'movement',
      title: 'Move Forward',
      detail: `Press ${keybinds.forward} and leave the red spawn pad.`,
      icon: 'move',
    },
    {
      id: 'run',
      stage: 'movement',
      title: 'Run',
      detail: `Hold ${keybinds.sprint} while moving to build speed.`,
      icon: 'run',
    },
    {
      id: 'crouch',
      stage: 'movement',
      title: 'Crouch',
      detail: `Use ${keybinds.crouch} to drop your profile before the low cover.`,
      icon: 'crouch',
    },
    {
      id: 'slide',
      stage: 'movement',
      title: 'Slide',
      detail: `Run first, then hit ${keybinds.crouch} to slide through the lane.`,
      icon: 'slide',
    },
    {
      id: 'bunny_hop',
      stage: 'movement',
      title: 'Bunny Hop',
      detail: `CS-style: tap ${keybinds.jump} on landing; air-strafe ${keybinds.left}/${keybinds.right} with mouse; release ${keybinds.forward}.`,
      icon: 'hop',
    },
    {
      id: 'movement_checkpoint',
      stage: 'movement',
      title: 'Checkpoint',
      detail: 'Reach the checkpoint after the hop zone.',
      icon: 'checkpoint',
    },
    {
      id: 'skill_use',
      stage: 'skills',
      title: 'Skills',
      detail: `Cast any skill at the gate: ${keybinds.ability1}, ${keybinds.ability2}, or ${keybinds.ultimate}.`,
      icon: 'skill',
    },
    {
      id: 'boost_pickup',
      stage: 'powerups',
      title: 'Boost Pickup',
      detail: 'Grab the boost from the gold pad and feel the speed spike.',
      icon: 'boost',
    },
    {
      id: 'health_pickup',
      stage: 'powerups',
      title: 'Health Pack',
      detail: 'Take the left side lane for a health pack.',
      icon: 'health',
    },
    {
      id: 'target_practice',
      stage: 'combat',
      title: 'Target Practice',
      detail: 'Down a moving training hero in the range bay.',
      icon: 'target',
    },
    {
      id: 'flag_pickup',
      stage: 'objective',
      title: 'Steal The Flag',
      detail: 'Cross to the blue base and take the flag.',
      icon: 'flag',
    },
    {
      id: 'flag_capture',
      stage: 'objective',
      title: 'Objective',
      detail: 'Bring the flag home to the red capture pad.',
      icon: 'capture',
    },
  ], [
    keybinds.ability1,
    keybinds.ability2,
    keybinds.crouch,
    keybinds.forward,
    keybinds.jump,
    keybinds.left,
    keybinds.right,
    keybinds.sprint,
    keybinds.ultimate,
  ]);

  const totalTaskCount = TUTORIAL_TASK_IDS.length;
  const completedCount = TUTORIAL_TASK_IDS.reduce((count, taskId) => count + (completedTasks[taskId] ? 1 : 0), 0);
  const tutorialComplete = completedCount === totalTaskCount;
  const activeTaskIndex = tutorialTasks.findIndex((task) => !completedTasks[task.id]);
  const activeTask = activeTaskIndex >= 0 ? tutorialTasks[activeTaskIndex] : null;
  const activeStageLabel = activeTask ? STAGE_LABELS[activeTask.stage] : 'Training Complete';

  useEffect(() => {
    if (!isTutorialMode || gamePhase !== 'playing') return;

    const interval = window.setInterval(() => {
      const store = useGameStore.getState();
      const player = store.localPlayer;
      if (!player || player.state !== 'alive') return;

      const now = Date.now();
      const visualState = visualStore.getState();
      const playerPosition = visualState.playerPositions.get(player.id) ?? player.position;
      const freshViewmodelMovement = now - visualState.localViewmodelMovement.updatedAtMs <= LIVE_MOVEMENT_SAMPLE_MAX_AGE_MS
        ? visualState.localViewmodelMovement
        : null;
      const movement = freshViewmodelMovement ? visualState.localMovement : player.movement;
      const speed = Math.max(
        horizontalSpeed(player.velocity),
        freshViewmodelMovement?.horizontalSpeed ?? 0
      );
      const history = movementHistoryRef.current;
      const completed = collectMovementTutorialCompletions({
        completedTasks: completedTasksRef.current,
        history,
        movement,
        nowMs: now,
        playerZ: playerPosition.z,
        speed,
        verticalVelocity: player.velocity.y,
      });
      const skillTaskReady = (
        !completedTasksRef.current.skill_use &&
        (completedTasksRef.current.movement_checkpoint || completed.includes('movement_checkpoint'))
      );
      if (skillTaskReady && skillTaskActivatedAtRef.current <= 0) {
        skillTaskActivatedAtRef.current = now;
      } else if (!skillTaskReady) {
        skillTaskActivatedAtRef.current = 0;
      }
      if (
        skillTaskActivatedAtRef.current > 0 &&
        store.lastSkillCastAt >= skillTaskActivatedAtRef.current
      ) {
        completed.push('skill_use');
      }
      if (store.powerupPickupCollections.has('tutorial_boost_pickup')) completed.push('boost_pickup');
      if (store.powerupPickupCollections.has('tutorial_health_pickup')) completed.push('health_pickup');
      const targetTaskReady = (
        !completedTasksRef.current.target_practice &&
        (completedTasksRef.current.boost_pickup || completed.includes('boost_pickup')) &&
        (completedTasksRef.current.health_pickup || completed.includes('health_pickup'))
      );
      if (targetTaskReady && targetTaskActivatedAtRef.current <= 0) {
        targetTaskActivatedAtRef.current = now;
      } else if (!targetTaskReady) {
        targetTaskActivatedAtRef.current = 0;
      }
      if (
        targetTaskActivatedAtRef.current > 0 &&
        hasDownedTutorialTrainingHero(store.players.values())
      ) {
        completed.push('target_practice');
      }
      if (player.hasFlag || objectivePickedUp) completed.push('flag_pickup');
      if (objectiveCaptured) completed.push('flag_capture');

      if (completed.length > 0) {
        markTasksComplete(completed);
      }
    }, TUTORIAL_PROGRESS_CHECK_MS);

    return () => window.clearInterval(interval);
  }, [gamePhase, isTutorialMode, markTasksComplete, objectiveCaptured, objectivePickedUp]);

  useEffect(() => {
    if (!isTutorialMode || gamePhase !== 'playing') return;

    const interval = window.setInterval(() => {
      const store = useGameStore.getState();
      const player = store.localPlayer;
      if (!player || player.state !== 'alive') return;

      const now = Date.now();
      const playerPosition = visualStore.getState().playerPositions.get(player.id) ?? player.position;
      for (const pickup of manifest.gameplay.powerups) {
        const state = store.powerupPickups.get(pickup.id);
        if (state && state.availableAt > now) continue;
        if (distance2D(playerPosition, pickup.position) > pickup.radius + PLAYER_RADIUS) continue;

        store.updatePowerupPickup({
          pickupId: pickup.id,
          availableAt: now + Math.max(0, pickup.respawnSeconds * 1000),
        });
        store.recordPowerupPickupCollection({
          pickupId: pickup.id,
          collectedAt: now,
        });
        if (pickup.id === 'tutorial_boost_pickup') {
          markTasksComplete(['boost_pickup']);
        } else if (pickup.id === 'tutorial_health_pickup') {
          markTasksComplete(['health_pickup']);
        }

        if (pickup.kind === 'health_pack') {
          store.updateLocalPlayer({
            health: Math.min(
              player.maxHealth,
              player.health + Math.max(1, Math.round(player.maxHealth * POWERUP_HEALTH_RESTORE_RATIO))
            ),
          });
          void playSound('healPickup');
        } else {
          store.updateLocalPlayer({
            powerupBoostUntil: now + POWERUP_BUFF_DURATION_MS,
          });
          void playSound('powerupPickup');
        }
        break;
      }
    }, TUTORIAL_PICKUP_CHECK_MS);

    return () => window.clearInterval(interval);
  }, [gamePhase, isTutorialMode, manifest, markTasksComplete, playSound]);

  useEffect(() => {
    if (!isTutorialMode || gamePhase !== 'playing' || objectiveCaptured) return;

    const interval = window.setInterval(() => {
      const store = useGameStore.getState();
      const player = store.localPlayer;
      if (!player || player.state !== 'alive') return;

      const playerPosition = visualStore.getState().playerPositions.get(player.id) ?? player.position;

      if (!objectivePickedUp && distance2D(playerPosition, manifest.flagZones.blue) <= OBJECTIVE_PICKUP_RADIUS) {
        setObjectivePickedUp(true);
        markTasksComplete(['flag_pickup']);
        store.updateLocalPlayer({ hasFlag: true });
        useGameStore.setState({
          blueFlag: { position: { ...manifest.flagZones.blue }, carrierId: player.id, isAtBase: false },
        });
        return;
      }

      if (objectivePickedUp && distance2D(playerPosition, manifest.flagZones.red) <= OBJECTIVE_CAPTURE_RADIUS) {
        setObjectiveCaptured(true);
        markTasksComplete(['flag_capture']);
        store.updateLocalPlayer({ hasFlag: false });
        useGameStore.setState({
          redScore: 1,
          blueFlag: { position: { ...manifest.flagZones.blue }, carrierId: null, isAtBase: true },
        });
      }
    }, TUTORIAL_OBJECTIVE_CHECK_MS);

    return () => window.clearInterval(interval);
  }, [gamePhase, isTutorialMode, manifest, markTasksComplete, objectiveCaptured, objectivePickedUp]);

  const saveTutorialCompletion = useCallback(async () => {
    if (isSaving) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      await completeTutorial();
      setTutorialCompletionOverlayOpen(false);
      leaveGame();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save tutorial completion');
      setIsSaving(false);
    }
  }, [completeTutorial, isSaving, leaveGame, setTutorialCompletionOverlayOpen]);

  const handleFinish = useCallback(() => {
    if (!tutorialComplete) return;
    void saveTutorialCompletion();
  }, [saveTutorialCompletion, tutorialComplete]);

  const handleSkipTutorial = useCallback(() => {
    void saveTutorialCompletion();
  }, [saveTutorialCompletion]);

  useEffect(() => {
    if (!isTutorialMode || gamePhase !== 'playing' || !tutorialComplete) {
      setTutorialCompletionOverlayOpen(false);
      return;
    }

    setTutorialCompletionOverlayOpen(true);
    try {
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    } catch {
      // Browser pointer-lock APIs can throw if the lock has already been released.
    }

    return () => setTutorialCompletionOverlayOpen(false);
  }, [gamePhase, isTutorialMode, setTutorialCompletionOverlayOpen, tutorialComplete]);

  if (!isTutorialMode || gamePhase !== 'playing' || !hasLocalPlayer) return null;

  if (tutorialComplete) {
    return (
      <TutorialCompletionOverlay
        isSaving={isSaving}
        saveError={saveError}
        onComplete={handleFinish}
      />
    );
  }

  return (
    <div
      className="pointer-events-none absolute left-[max(1.5rem,env(safe-area-inset-left))] top-[max(1.5rem,env(safe-area-inset-top))] z-[80] w-[min(24rem,calc(100vw-3rem))] select-none text-white"
      style={FLOATING_TEXT_STYLE}
    >
      <div className="flex items-start gap-3" aria-live="polite">
        <TutorialIcon icon={activeTask?.icon ?? 'complete'} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-display text-[0.7rem] uppercase leading-none text-white/70">
            <span>Tutorial</span>
            <span aria-hidden="true">/</span>
            <span>{activeStageLabel}</span>
            <span className="ml-auto tabular-nums text-white/60">
              {completedCount}/{totalTaskCount}
            </span>
          </div>
          <h2 className="mt-2 text-balance font-display text-2xl leading-none text-white">
            {activeTask?.title}
          </h2>
          <p className="mt-1 max-w-[22rem] text-sm leading-snug text-white/90">
            {activeTask?.detail}
          </p>
          {saveError && (
            <p className="mt-3 max-w-[22rem] text-xs font-bold leading-snug text-red-200" role="status">
              {saveError}
            </p>
          )}
          <button
            type="button"
            onClick={handleSkipTutorial}
            disabled={isSaving}
            className="play-secondary-cta pointer-events-auto mt-4 max-w-[11rem]"
          >
            {isSaving ? 'SKIPPING...' : 'SKIP TUTORIAL'}
          </button>
        </div>
      </div>
    </div>
  );
}
