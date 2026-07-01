import { create } from 'zustand';
import type { StreamerNextTarget, StreamerTargetMetadata } from '../contexts/networkApi';

export type StreamerLoadingReason = 'finding_live_game' | 'spinning_up_bot_match' | 'switching_feed';

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
  setCsrfToken: (csrfToken: string | null) => void;
  setLoading: (reason: StreamerLoadingReason) => void;
  setTarget: (target: StreamerNextTarget) => void;
  setError: (message: string | null) => void;
  setHiddenFirstPersonTargetId: (playerId: string | null) => void;
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
  setHiddenFirstPersonTargetId: (hiddenFirstPersonTargetId) => set({ hiddenFirstPersonTargetId }),
  reset: () => set({ ...initialStreamerState }),
}));
