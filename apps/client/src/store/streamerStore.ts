import { create } from 'zustand';
import type { StreamerNextTarget, StreamerTargetMetadata } from '../contexts/networkApi';

export type StreamerLoadingReason = 'finding_live_game' | 'spinning_up_bot_match' | 'switching_feed';
export type StreamerSceneTransitionReason = 'initial_feed' | 'switching_feed' | 'map_rotation';

export interface StreamerSceneTransition {
  key: string;
  reason: StreamerSceneTransitionReason;
  startedAt: number;
}

interface StreamerStoreState {
  isActive: boolean;
  isLoading: boolean;
  currentRoomId: string | null;
  source: StreamerNextTarget['source'] | null;
  metadata: StreamerTargetMetadata | null;
  csrfToken: string | null;
  loadingReason: StreamerLoadingReason;
  lastError: string | null;
  hiddenFirstPersonTargetId: string | null;
  sceneTransition: StreamerSceneTransition | null;
  setCsrfToken: (csrfToken: string | null) => void;
  setLoading: (reason: StreamerLoadingReason) => void;
  setPendingTarget: (target: StreamerNextTarget) => void;
  setTarget: (target: StreamerNextTarget) => void;
  setError: (message: string | null) => void;
  setHiddenFirstPersonTargetId: (playerId: string | null) => void;
  beginSceneTransition: (transition: Pick<StreamerSceneTransition, 'key' | 'reason'>) => void;
  endSceneTransition: (key?: string) => void;
  reset: () => void;
}

const initialStreamerState = {
  isActive: false,
  isLoading: false,
  currentRoomId: null,
  source: null,
  metadata: null,
  csrfToken: null,
  loadingReason: 'finding_live_game' as StreamerLoadingReason,
  lastError: null,
  hiddenFirstPersonTargetId: null,
  sceneTransition: null,
};

export const useStreamerStore = create<StreamerStoreState>((set) => ({
  ...initialStreamerState,
  setCsrfToken: (csrfToken) => set({ csrfToken }),
  setLoading: (loadingReason) => set({
    isActive: true,
    isLoading: true,
    loadingReason,
    lastError: null,
    hiddenFirstPersonTargetId: null,
  }),
  setPendingTarget: (target) => set({
    isActive: true,
    isLoading: true,
    currentRoomId: target.roomId,
    source: target.source,
    metadata: target.metadata,
    lastError: null,
    hiddenFirstPersonTargetId: null,
  }),
  setTarget: (target) => set({
    isActive: true,
    isLoading: false,
    currentRoomId: target.roomId,
    source: target.source,
    metadata: target.metadata,
    lastError: null,
    hiddenFirstPersonTargetId: null,
  }),
  setError: (lastError) => set({ lastError }),
  setHiddenFirstPersonTargetId: (hiddenFirstPersonTargetId) => set((state) => (
    state.hiddenFirstPersonTargetId === hiddenFirstPersonTargetId
      ? state
      : { hiddenFirstPersonTargetId }
  )),
  beginSceneTransition: (transition) => set({
    isActive: true,
    sceneTransition: {
      ...transition,
      startedAt: Date.now(),
    },
    hiddenFirstPersonTargetId: null,
  }),
  endSceneTransition: (key) => set((state) => (
    state.sceneTransition && (!key || state.sceneTransition.key === key)
      ? { sceneTransition: null }
      : state
  )),
  reset: () => set({ ...initialStreamerState }),
}));
