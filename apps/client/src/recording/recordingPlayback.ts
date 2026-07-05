import {
  DEFAULT_GAMEPLAY_MODE,
  DEFAULT_MATCH_PERSPECTIVE,
  isGameplayMode,
  isMatchPerspective,
  normalizeVoxelMapSizeId,
  type RecordingEventRow,
  type RecordingHudMode,
  type RecordingManifest,
} from '@voxel-strike/shared';
import { useChatStore } from '../store/chatStore';
import { normalizeMapProfileId, useGameStore } from '../store/gameStore';
import { useRecordingPlaybackStore } from '../store/recordingPlaybackStore';
import { config } from '../config/environment';
import { setupGameRoomListeners } from '../contexts/gameRoomListeners';
import type { GameMessageBus } from '../contexts/gameMessageBus';

type RecordingMessageCallback<T = unknown> = (message: T) => void;

interface RecordingPlaybackSource {
  manifestUrl: string;
  eventsUrl: string;
  autoplay: boolean;
}

interface RecordingPlaybackStartOptions extends RecordingPlaybackSource {
  preferredHudMode?: RecordingHudMode | null;
  preferredHudSubjectPlayerId?: string | null;
  renderMode?: boolean;
}

class RecordingPlaybackBus implements GameMessageBus {
  readonly state = {};
  private readonly callbacks = new Map<string, Set<RecordingMessageCallback>>();
  private readonly errorCallbacks = new Set<(code: number, message?: string) => void>();
  private readonly leaveCallbacks = new Set<(code: number) => void>();
  private left = false;

  constructor(
    readonly id: string,
    readonly sessionId: string,
    private readonly onMessageError?: (type: string, error: unknown) => void
  ) {}

  onMessage<T = unknown>(type: string, callback: RecordingMessageCallback<T>): void {
    let callbacks = this.callbacks.get(type);
    if (!callbacks) {
      callbacks = new Set();
      this.callbacks.set(type, callbacks);
    }
    callbacks.add(callback as RecordingMessageCallback);
  }

  emit(type: string, payload: unknown): void {
    if (this.left) return;
    const callbacks = this.callbacks.get(type);
    if (!callbacks) return;
    for (const callback of callbacks) {
      try {
        callback(payload);
      } catch (error) {
        this.onMessageError?.(type, error);
      }
    }
  }

  send(): void {
    // Recording playback is read-only; live client requests are ignored.
  }

  onError(callback: (code: number, message?: string) => void): void {
    this.errorCallbacks.add(callback);
  }

  onLeave(callback: (code: number) => void): void {
    this.leaveCallbacks.add(callback);
  }

  fail(message: string): void {
    for (const callback of this.errorCallbacks) {
      callback(5000, message);
    }
  }

  leave(): void {
    if (this.left) return;
    this.left = true;
    for (const callback of this.leaveCallbacks) {
      callback(1000);
    }
  }
}

function readUrlParam(search: URLSearchParams, key: string): string | null {
  const value = search.get(key);
  return value && value.trim() ? value.trim() : null;
}

function readHudMode(value: string | null): RecordingHudMode | null {
  return value === 'hidden' || value === 'selected_player' || value === 'cinematic_observer'
    ? value
    : null;
}

function sameOriginArtifactUrl(recordingId: string, artifact: 'manifest' | 'events'): string {
  return `${config.serverHttpUrl}/recordings/${encodeURIComponent(recordingId)}/artifacts/${artifact}`;
}

export function resolveRecordingPlaybackSource(search = window.location.search): RecordingPlaybackSource | null {
  const params = new URLSearchParams(search);
  const enabled = params.get('recordingPlayback') === '1' || params.get('recording') === '1';
  const recordingId = readUrlParam(params, 'recordingId');
  const manifestUrl = readUrlParam(params, 'recordingManifestUrl')
    ?? (recordingId ? sameOriginArtifactUrl(recordingId, 'manifest') : null);
  const eventsUrl = readUrlParam(params, 'recordingEventsUrl')
    ?? (recordingId ? sameOriginArtifactUrl(recordingId, 'events') : null);

  if (!enabled && !manifestUrl && !eventsUrl) return null;
  if (!manifestUrl || !eventsUrl) {
    throw new Error('Recording playback requires recordingManifestUrl and recordingEventsUrl, or recordingId');
  }

  return {
    manifestUrl,
    eventsUrl,
    autoplay: params.get('recordingAutoplay') !== '0',
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return await response.json() as T;
}

async function fetchNdjsonRows<T>(url: string): Promise<T[]> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  const raw = await response.text();
  const rows: T[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line) as T);
  }
  return rows;
}

function getHudSubjectPlayerId(manifest: RecordingManifest, preferred: string | null | undefined): string {
  return preferred
    || manifest.hudSubjectPlayerId
    || manifest.botAssignments.find((assignment) => assignment.playerId)?.playerId
    || 'recording:observer';
}

function getHudMode(manifest: RecordingManifest, preferred: RecordingHudMode | null | undefined): RecordingHudMode {
  return preferred ?? manifest.hudMode ?? 'selected_player';
}

function getHudSubjectName(manifest: RecordingManifest, playerId: string): string {
  return manifest.botAssignments.find((assignment) => assignment.playerId === playerId)?.playerName
    || 'Recording';
}

function applyManifestToGameStore(manifest: RecordingManifest, hudSubjectPlayerId: string): void {
  const store = useGameStore.getState();
  store.reset();
  store.setRoomId(manifest.roomId);
  store.setPlayerId(hudSubjectPlayerId);
  store.setPlayerName(getHudSubjectName(manifest, hudSubjectPlayerId));
  store.setConnected(true);
  store.setLoading(false);
  store.setPracticeMode(false);
  store.setMapSeed(manifest.map.seed);
  store.setMapThemeId(manifest.map.themeId ?? null);
  store.setMapSize(normalizeVoxelMapSizeId(manifest.map.size));
  store.setMapProfileId(normalizeMapProfileId(manifest.map.profileId));
  store.setPregeneratedMapIdentity(manifest.map.pregeneratedMapId, manifest.map.artifactId);
  store.clearMatchSummary();
  useGameStore.setState({
    gameplayMode: isGameplayMode(manifest.gameMode) ? manifest.gameMode : DEFAULT_GAMEPLAY_MODE,
    matchPerspective: isMatchPerspective(manifest.matchPerspective) ? manifest.matchPerspective : DEFAULT_MATCH_PERSPECTIVE,
    gamePhase: 'waiting',
    appPhase: 'in_game',
  });
  useChatStore.getState().clearMessages();
}

function sortRecordingEvents(events: RecordingEventRow[]): RecordingEventRow[] {
  return [...events].sort((left, right) => (
    left.recordingTimeMs - right.recordingTimeMs ||
    left.tick - right.tick ||
    left.serverTime - right.serverTime
  ));
}

function getRecordingDurationMs(manifest: RecordingManifest, events: RecordingEventRow[]): number {
  const eventDuration = events.length > 0
    ? Math.max(...events.map((event) => event.recordingTimeMs))
    : 0;
  return Math.max(eventDuration, manifest.requestedDurationMs || 0);
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function formatPlaybackError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function startRecordingPlayback(options: RecordingPlaybackStartOptions): Promise<() => void> {
  const manifest = await fetchJson<RecordingManifest>(options.manifestUrl);
  const events = sortRecordingEvents(await fetchNdjsonRows<RecordingEventRow>(options.eventsUrl));
  const hudMode = getHudMode(manifest, options.preferredHudMode);
  const hudSubjectPlayerId = getHudSubjectPlayerId(manifest, options.preferredHudSubjectPlayerId);
  const hudSubjectName = getHudSubjectName(manifest, hudSubjectPlayerId);
  const durationMs = getRecordingDurationMs(manifest, events);
  let eventIndex = 0;
  let currentTimeMs = 0;
  let frameHandle = 0;
  let playing = false;
  let lastWallTime = 0;
  let disposed = false;
  let playbackReadyResolved = false;
  let sceneReadyResolved = false;
  let finishResolved = false;
  let playbackError: string | null = null;
  let playbackWarningCount = 0;
  const finishResolvers = new Set<{
    resolve: () => void;
    reject: (error: Error) => void;
  }>();
  let recordingControls: NonNullable<Window['__voxelRecording']> | null = null;

  const recordPlaybackWarning = (type: string, error: unknown) => {
    playbackWarningCount += 1;
    if (recordingControls) {
      recordingControls.playbackWarningCount = playbackWarningCount;
    }
    if (playbackWarningCount <= 10 || playbackWarningCount % 100 === 0) {
      console.warn(`[recording-playback] ignored ${type} handler error`, error);
    }
  };
  const bus = new RecordingPlaybackBus(manifest.roomId || manifest.id, hudSubjectPlayerId, recordPlaybackWarning);
  const gameRoomRef = { current: bus };

  const playbackStore = useRecordingPlaybackStore.getState();
  playbackStore.setActive({
    id: manifest.id,
    hudMode,
    hudSubjectPlayerId,
    renderMode: options.renderMode === true,
  });
  applyManifestToGameStore(manifest, hudSubjectPlayerId);
  setupGameRoomListeners(bus, {
    playerName: hudSubjectName,
    gameRoomRef,
    isJoiningGameRef: { current: false },
    voiceTokenRequestsRef: { current: new Map() },
    playerReportRequestsRef: { current: new Map() },
    rejectPendingVoiceTokenRequests: () => {},
    rejectPendingPlayerReportRequests: () => {},
    setMatchStartGateKey: () => {},
  });

  const updateRecordingProgress = () => {
    if (!recordingControls) return;
    recordingControls.currentTimeMs = currentTimeMs;
    recordingControls.progress = durationMs > 0 ? Math.min(1, currentTimeMs / durationMs) : 1;
    recordingControls.playbackError = playbackError;
    recordingControls.playbackWarningCount = playbackWarningCount;
    if (currentTimeMs < durationMs) return;

    finishResolved = true;
    for (const { resolve } of finishResolvers) resolve();
    finishResolvers.clear();
  };

  const failPlayback = (error: unknown) => {
    if (finishResolved) return;
    playbackError = formatPlaybackError(error);
    if (recordingControls) recordingControls.playbackError = playbackError;
    pause();
    const rejection = error instanceof Error ? error : new Error(playbackError);
    for (const { reject } of finishResolvers) reject(rejection);
    finishResolvers.clear();
  };

  const emitThrough = (targetTimeMs: number) => {
    while (eventIndex < events.length && events[eventIndex].recordingTimeMs <= targetTimeMs) {
      const event = events[eventIndex];
      eventIndex++;
      bus.emit(event.type, event.payload);
    }
    currentTimeMs = Math.max(0, Math.min(durationMs, targetTimeMs));
    updateRecordingProgress();
  };

  const resetToStart = () => {
    applyManifestToGameStore(manifest, hudSubjectPlayerId);
    eventIndex = 0;
    currentTimeMs = 0;
    finishResolved = false;
    updateRecordingProgress();
  };

  const stepTo = async (targetTimeMs: number) => {
    if (disposed) return;
    try {
      const normalizedTarget = Math.max(0, Math.min(durationMs, Math.trunc(targetTimeMs)));
      if (normalizedTarget < currentTimeMs) {
        resetToStart();
      }
      emitThrough(normalizedTarget);
      await waitForNextFrame();
    } catch (error) {
      failPlayback(error);
      throw error;
    }
  };

  const pause = () => {
    playing = false;
    if (frameHandle) {
      window.cancelAnimationFrame(frameHandle);
      frameHandle = 0;
    }
  };

  const playFrame = (wallTime: number) => {
    if (!playing || disposed) return;
    const delta = lastWallTime ? wallTime - lastWallTime : 0;
    lastWallTime = wallTime;
    void stepTo(currentTimeMs + delta)
      .then(() => {
        if (currentTimeMs >= durationMs) {
          pause();
          return;
        }
        frameHandle = window.requestAnimationFrame(playFrame);
      })
      .catch((error) => {
        failPlayback(error);
      });
  };

  const play = () => {
    if (playing || disposed) return;
    playing = true;
    lastWallTime = 0;
    frameHandle = window.requestAnimationFrame(playFrame);
  };

  const waitUntilFinished = () => {
    if (finishResolved || currentTimeMs >= durationMs) return Promise.resolve();
    if (playbackError) return Promise.reject(new Error(playbackError));
    return new Promise<void>((resolve, reject) => {
      finishResolvers.add({ resolve, reject });
    });
  };
  const resolveRecordingReady = () => {
    if (!recordingControls || !playbackReadyResolved || !sceneReadyResolved || recordingControls.isReady) return;
    recordingControls.isReady = true;
    useRecordingPlaybackStore.getState().setReady(true);
  };

  recordingControls = {
    isReady: false,
    durationMs,
    fps: manifest.fps,
    currentTimeMs: 0,
    progress: 0,
    playbackError: null,
    playbackWarningCount: 0,
    stepTo,
    play,
    pause,
    waitUntilFinished,
    markSceneReady: () => {
      if (disposed || sceneReadyResolved) return;
      sceneReadyResolved = true;
      resolveRecordingReady();
    },
  };
  window.__voxelRecording = recordingControls;

  await stepTo(0);
  playbackReadyResolved = true;
  resolveRecordingReady();
  if (options.autoplay) play();

  return () => {
    disposed = true;
    pause();
    bus.leave();
    useRecordingPlaybackStore.getState().reset();
    if (recordingControls && window.__voxelRecording === recordingControls) {
      delete window.__voxelRecording;
    }
  };
}

export function readRecordingPlaybackOptionsFromLocation(): RecordingPlaybackStartOptions | null {
  const source = resolveRecordingPlaybackSource();
  if (!source) return null;
  const params = new URLSearchParams(window.location.search);
  return {
    ...source,
    preferredHudMode: readHudMode(params.get('recordingHudMode')),
    preferredHudSubjectPlayerId: readUrlParam(params, 'recordingHudSubjectPlayerId'),
    renderMode: params.get('recordingRender') === '1',
  };
}
