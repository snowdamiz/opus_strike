import { create } from 'zustand';
import type { RecordingHudMode } from '@voxel-strike/shared';

interface RecordingPlaybackState {
  isActive: boolean;
  isReady: boolean;
  id: string | null;
  hudMode: RecordingHudMode;
  hudSubjectPlayerId: string | null;
  error: string | null;
  setActive: (options: {
    id: string;
    hudMode: RecordingHudMode;
    hudSubjectPlayerId: string | null;
  }) => void;
  setReady: (ready: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialRecordingPlaybackState = {
  isActive: false,
  isReady: false,
  id: null,
  hudMode: 'selected_player' as RecordingHudMode,
  hudSubjectPlayerId: null,
  error: null,
};

export const useRecordingPlaybackStore = create<RecordingPlaybackState>((set) => ({
  ...initialRecordingPlaybackState,
  setActive: ({ id, hudMode, hudSubjectPlayerId }) => set({
    isActive: true,
    isReady: false,
    id,
    hudMode,
    hudSubjectPlayerId,
    error: null,
  }),
  setReady: (ready) => set({ isReady: ready }),
  setError: (error) => set({ error }),
  reset: () => set(initialRecordingPlaybackState),
}));
