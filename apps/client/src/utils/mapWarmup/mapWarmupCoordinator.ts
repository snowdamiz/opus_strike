export type MapWarmupState =
  | 'idle'
  | 'preparingCpu'
  | 'preparingGpu'
  | 'settling'
  | 'ready'
  | 'failedWithFallback';

export type MapWarmupStageId =
  | 'resources'
  | 'map'
  | 'colliders'
  | 'meshes'
  | 'textures'
  | 'shaders'
  | 'shadowsReflections'
  | 'gameplayObjects'
  | 'settling';

export interface MapWarmupStageSnapshot {
  id: MapWarmupStageId;
  label: string;
  progress: number;
  done: boolean;
  durationMs?: number;
}

export interface MapWarmupSnapshot {
  key: string;
  mapSeed: number;
  state: MapWarmupState;
  label: string;
  progress: number;
  canAcceptInput: boolean;
  canShowGameplayObjects: boolean;
  canHideLoadingScreen: boolean;
  fallbackReason: string | null;
  settlingFrames: number;
  stages: Record<MapWarmupStageId, MapWarmupStageSnapshot>;
}

export type MapWarmupEvent =
  | { type: 'startCpu'; key: string; mapSeed: number }
  | { type: 'stageDone'; stage: MapWarmupStageId; durationMs?: number }
  | { type: 'startGpu' }
  | { type: 'gpuReady' }
  | { type: 'settlingFrame' }
  | { type: 'fallback'; reason: string }
  | { type: 'reset'; key: string; mapSeed: number };

const STAGE_DEFS: Array<Omit<MapWarmupStageSnapshot, 'done' | 'durationMs'>> = [
  { id: 'resources', label: 'Resources', progress: 0.16 },
  { id: 'map', label: 'Map', progress: 0.3 },
  { id: 'colliders', label: 'Colliders', progress: 0.42 },
  { id: 'meshes', label: 'Meshes', progress: 0.6 },
  { id: 'textures', label: 'Textures', progress: 0.7 },
  { id: 'shaders', label: 'Shaders', progress: 0.8 },
  { id: 'shadowsReflections', label: 'Shadows', progress: 0.86 },
  { id: 'gameplayObjects', label: 'Gameplay Objects', progress: 0.9 },
  { id: 'settling', label: 'Settling', progress: 0.96 },
];

const SETTLING_FRAMES_REQUIRED = 2;

function createStages(): Record<MapWarmupStageId, MapWarmupStageSnapshot> {
  return Object.fromEntries(
    STAGE_DEFS.map((stage) => [stage.id, { ...stage, done: false }])
  ) as Record<MapWarmupStageId, MapWarmupStageSnapshot>;
}

function normalizeProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

function withBooleans(snapshot: Omit<MapWarmupSnapshot, 'canAcceptInput' | 'canShowGameplayObjects' | 'canHideLoadingScreen'>): MapWarmupSnapshot {
  const canAcceptInput = snapshot.state === 'ready' || snapshot.state === 'failedWithFallback';
  return {
    ...snapshot,
    canAcceptInput,
    canShowGameplayObjects: snapshot.state !== 'idle' && snapshot.state !== 'preparingCpu',
    canHideLoadingScreen: canAcceptInput,
  };
}

export function createMapWarmupSnapshot(key: string, mapSeed: number): MapWarmupSnapshot {
  return withBooleans({
    key,
    mapSeed: mapSeed >>> 0,
    state: 'idle',
    label: 'Resources',
    progress: 0,
    fallbackReason: null,
    settlingFrames: 0,
    stages: createStages(),
  });
}

function applyStageDone(
  snapshot: MapWarmupSnapshot,
  stage: MapWarmupStageId,
  durationMs?: number
): MapWarmupSnapshot {
  const currentStage = snapshot.stages[stage];
  const nextStage = {
    ...currentStage,
    done: true,
    durationMs,
  };
  const stages = {
    ...snapshot.stages,
    [stage]: nextStage,
  };

  const nextProgress = Math.max(snapshot.progress, nextStage.progress);
  const nextLabel = STAGE_DEFS.find((candidate) => !stages[candidate.id].done)?.label ?? nextStage.label;

  return withBooleans({
    ...snapshot,
    stages,
    progress: normalizeProgress(nextProgress),
    label: nextLabel,
  });
}

export function reduceMapWarmup(
  snapshot: MapWarmupSnapshot,
  event: MapWarmupEvent
): MapWarmupSnapshot {
  switch (event.type) {
    case 'reset':
      return createMapWarmupSnapshot(event.key, event.mapSeed);

    case 'startCpu':
      return withBooleans({
        ...createMapWarmupSnapshot(event.key, event.mapSeed),
        state: 'preparingCpu',
        progress: 0.08,
        label: 'Resources',
      });

    case 'stageDone':
      return applyStageDone(snapshot, event.stage, event.durationMs);

    case 'startGpu':
      return withBooleans({
        ...snapshot,
        state: 'preparingGpu',
        progress: Math.max(snapshot.progress, 0.64),
        label: snapshot.stages.textures.done ? 'Shaders' : 'Textures',
      });

    case 'gpuReady':
      return withBooleans({
        ...snapshot,
        state: 'settling',
        progress: Math.max(snapshot.progress, 0.92),
        label: 'Settling',
        settlingFrames: 0,
      });

    case 'settlingFrame': {
      if (snapshot.state === 'ready' || snapshot.state === 'failedWithFallback') return snapshot;

      const settlingFrames = snapshot.settlingFrames + 1;
      if (settlingFrames < SETTLING_FRAMES_REQUIRED) {
        return withBooleans({
          ...snapshot,
          state: 'settling',
          progress: Math.max(snapshot.progress, 0.96),
          label: 'Settling',
          settlingFrames,
        });
      }

      return withBooleans({
        ...applyStageDone(snapshot, 'settling'),
        state: 'ready',
        label: 'Ready',
        progress: 1,
        settlingFrames,
      });
    }

    case 'fallback':
      return withBooleans({
        ...snapshot,
        state: 'failedWithFallback',
        label: 'Ready',
        progress: 1,
        fallbackReason: event.reason,
      });

    default:
      return snapshot;
  }
}

export function isTerminalMapWarmupState(state: MapWarmupState): boolean {
  return state === 'ready' || state === 'failedWithFallback';
}

export function isMapWarmupReadyForMatchStart(snapshot: MapWarmupSnapshot, key: string): boolean {
  return snapshot.key === key
    && snapshot.stages.map.done
    && snapshot.stages.colliders.done
    && snapshot.stages.meshes.done;
}
