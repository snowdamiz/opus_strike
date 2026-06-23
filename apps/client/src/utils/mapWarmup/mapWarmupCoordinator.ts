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
  partialProgress: number;
  done: boolean;
  detail?: string;
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
  | { type: 'stageProgress'; stage: MapWarmupStageId; progress: number; detail?: string }
  | { type: 'stageDone'; stage: MapWarmupStageId; durationMs?: number }
  | { type: 'startGpu' }
  | { type: 'gpuReady' }
  | { type: 'settlingFrame' }
  | { type: 'fallback'; reason: string }
  | { type: 'reset'; key: string; mapSeed: number };

const STAGE_DEFS: Array<Omit<MapWarmupStageSnapshot, 'done' | 'durationMs' | 'partialProgress' | 'detail'>> = [
  { id: 'resources', label: 'Resources', progress: 0.1 },
  { id: 'map', label: 'Map', progress: 0.22 },
  { id: 'colliders', label: 'Colliders', progress: 0.36 },
  { id: 'meshes', label: 'Terrain Meshes', progress: 0.68 },
  { id: 'textures', label: 'Textures', progress: 0.76 },
  { id: 'shaders', label: 'Shaders', progress: 0.84 },
  { id: 'shadowsReflections', label: 'Lighting', progress: 0.9 },
  { id: 'gameplayObjects', label: 'Gameplay Objects', progress: 0.94 },
  { id: 'settling', label: 'Settling', progress: 0.98 },
];

const SETTLING_FRAMES_REQUIRED = 2;

function createStages(): Record<MapWarmupStageId, MapWarmupStageSnapshot> {
  return Object.fromEntries(
    STAGE_DEFS.map((stage) => [stage.id, { ...stage, partialProgress: 0, done: false }])
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
    partialProgress: 1,
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

function getStageProgressRange(stage: MapWarmupStageId): { start: number; end: number } {
  const stageIndex = STAGE_DEFS.findIndex((candidate) => candidate.id === stage);
  if (stageIndex <= 0) return { start: 0, end: STAGE_DEFS[0]?.progress ?? 0 };
  return {
    start: STAGE_DEFS[stageIndex - 1]?.progress ?? 0,
    end: STAGE_DEFS[stageIndex]?.progress ?? 0,
  };
}

function applyStageProgress(
  snapshot: MapWarmupSnapshot,
  stage: MapWarmupStageId,
  progress: number,
  detail?: string
): MapWarmupSnapshot {
  const currentStage = snapshot.stages[stage];
  if (!currentStage || currentStage.done) return snapshot;

  const partialProgress = normalizeProgress(progress);
  if (
    partialProgress <= currentStage.partialProgress &&
    (!detail || detail === currentStage.detail)
  ) {
    return snapshot;
  }

  const nextStage = {
    ...currentStage,
    partialProgress: Math.max(currentStage.partialProgress, partialProgress),
    detail: detail ?? currentStage.detail,
  };
  const stages = {
    ...snapshot.stages,
    [stage]: nextStage,
  };
  const { start, end } = getStageProgressRange(stage);
  const nextProgress = Math.max(
    snapshot.progress,
    start + (end - start) * nextStage.partialProgress
  );

  return withBooleans({
    ...snapshot,
    stages,
    progress: normalizeProgress(nextProgress),
    label: nextStage.label,
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

    case 'stageProgress':
      return applyStageProgress(snapshot, event.stage, event.progress, event.detail);

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
        progress: Math.max(snapshot.progress, 0.94),
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
