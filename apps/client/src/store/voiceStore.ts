import { create } from 'zustand';
import type { Team } from '@voxel-strike/shared';

export type VoiceConnectionState =
  | 'disabled'
  | 'idle'
  | 'requesting_token'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'permission_denied'
  | 'error';

export interface VoiceParticipant {
  identity: string;
  playerId: string | null;
  name: string;
  team: Team | null;
  isLocal: boolean;
  isSpeaking: boolean;
  isLocallyMuted: boolean;
}

export interface VoiceDiagnostics {
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  lastError: string | null;
  reconnectCount: number;
  permissionDeniedCount: number;
  tokenRefreshCount: number;
  remoteParticipantCount: number;
}

export interface VoiceStoreState {
  connectionState: VoiceConnectionState;
  available: boolean;
  roomName: string | null;
  identity: string | null;
  playerId: string | null;
  team: Team | null;
  error: string | null;
  micMuted: boolean;
  micPublishing: boolean;
  pushToTalkActive: boolean;
  deafened: boolean;
  mutedPlayerIds: Set<string>;
  participants: Map<string, VoiceParticipant>;
  inputDevices: MediaDeviceInfo[];
  outputDevices: MediaDeviceInfo[];
  diagnostics: VoiceDiagnostics;
}

interface VoiceStoreActions {
  setAvailability: (available: boolean, reason?: string | null) => void;
  setConnectionState: (connectionState: VoiceConnectionState, error?: string | null) => void;
  setRoomInfo: (info: {
    roomName: string | null;
    identity: string | null;
    playerId: string | null;
    team: Team | null;
  }) => void;
  setLocalMicState: (micMuted: boolean, micPublishing: boolean) => void;
  setPushToTalkActive: (active: boolean) => void;
  setDeafened: (deafened: boolean) => void;
  setDevices: (inputDevices: MediaDeviceInfo[], outputDevices: MediaDeviceInfo[]) => void;
  upsertParticipant: (participant: VoiceParticipant) => void;
  removeParticipant: (identity: string) => void;
  setSpeakingIdentities: (identities: Set<string>) => void;
  togglePlayerMute: (playerId: string) => void;
  setPlayerMuted: (playerId: string, muted: boolean) => void;
  markReconnect: () => void;
  markTokenRefresh: () => void;
  markPermissionDenied: (message?: string) => void;
  resetVoiceSession: (reason?: string | null) => void;
}

export type VoiceStore = VoiceStoreState & VoiceStoreActions;

export const initialVoiceDiagnostics: VoiceDiagnostics = {
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  lastError: null,
  reconnectCount: 0,
  permissionDeniedCount: 0,
  tokenRefreshCount: 0,
  remoteParticipantCount: 0,
};

export const initialVoiceState: VoiceStoreState = {
  connectionState: 'idle',
  available: false,
  roomName: null,
  identity: null,
  playerId: null,
  team: null,
  error: null,
  micMuted: true,
  micPublishing: false,
  pushToTalkActive: false,
  deafened: false,
  mutedPlayerIds: new Set(),
  participants: new Map(),
  inputDevices: [],
  outputDevices: [],
  diagnostics: { ...initialVoiceDiagnostics },
};

export function computeVoiceElementVolume(
  masterVolume: number,
  voiceVolume: number,
  deafened: boolean,
  participantMuted: boolean
): number {
  if (deafened || participantMuted) return 0;
  const master = Math.max(0, Math.min(100, masterVolume)) / 100;
  const voice = Math.max(0, Math.min(100, voiceVolume)) / 100;
  return master * voice;
}

export function shouldHandlePushToTalkKey(
  eventCode: string,
  pushToTalkKey: string
): boolean {
  return pushToTalkKey.length > 0 && eventCode === pushToTalkKey;
}

function updateRemoteCount(participants: Map<string, VoiceParticipant>): number {
  let count = 0;
  participants.forEach((participant) => {
    if (!participant.isLocal) count++;
  });
  return count;
}

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  ...initialVoiceState,

  setAvailability: (available, reason = null) => set((state) => ({
    available,
    connectionState: available ? state.connectionState : 'disabled',
    error: available ? null : reason,
  })),

  setConnectionState: (connectionState, error = null) => set((state) => ({
    connectionState,
    error,
    diagnostics: {
      ...state.diagnostics,
      lastConnectedAt: connectionState === 'connected' ? Date.now() : state.diagnostics.lastConnectedAt,
      lastDisconnectedAt: connectionState === 'disconnected' || connectionState === 'disabled' ? Date.now() : state.diagnostics.lastDisconnectedAt,
      lastError: error ?? state.diagnostics.lastError,
    },
  })),

  setRoomInfo: (info) => set(info),

  setLocalMicState: (micMuted, micPublishing) => set({ micMuted, micPublishing }),

  setPushToTalkActive: (pushToTalkActive) => set({ pushToTalkActive }),

  setDeafened: (deafened) => set({ deafened }),

  setDevices: (inputDevices, outputDevices) => set({ inputDevices, outputDevices }),

  upsertParticipant: (participant) => set((state) => {
    const mutedPlayerIds = state.mutedPlayerIds;
    const next = new Map(state.participants);
    next.set(participant.identity, {
      ...participant,
      isLocallyMuted: participant.playerId ? mutedPlayerIds.has(participant.playerId) : participant.isLocallyMuted,
    });
    return {
      participants: next,
      diagnostics: {
        ...state.diagnostics,
        remoteParticipantCount: updateRemoteCount(next),
      },
    };
  }),

  removeParticipant: (identity) => set((state) => {
    const next = new Map(state.participants);
    next.delete(identity);
    return {
      participants: next,
      diagnostics: {
        ...state.diagnostics,
        remoteParticipantCount: updateRemoteCount(next),
      },
    };
  }),

  setSpeakingIdentities: (identities) => set((state) => {
    const next = new Map<string, VoiceParticipant>();
    state.participants.forEach((participant, identity) => {
      next.set(identity, {
        ...participant,
        isSpeaking: identities.has(identity),
      });
    });
    return { participants: next };
  }),

  togglePlayerMute: (playerId) => {
    const muted = !get().mutedPlayerIds.has(playerId);
    get().setPlayerMuted(playerId, muted);
  },

  setPlayerMuted: (playerId, muted) => set((state) => {
    const mutedPlayerIds = new Set(state.mutedPlayerIds);
    if (muted) {
      mutedPlayerIds.add(playerId);
    } else {
      mutedPlayerIds.delete(playerId);
    }

    const participants = new Map<string, VoiceParticipant>();
    state.participants.forEach((participant, identity) => {
      participants.set(identity, {
        ...participant,
        isLocallyMuted: participant.playerId === playerId ? muted : participant.isLocallyMuted,
      });
    });

    return { mutedPlayerIds, participants };
  }),

  markReconnect: () => set((state) => ({
    diagnostics: {
      ...state.diagnostics,
      reconnectCount: state.diagnostics.reconnectCount + 1,
    },
  })),

  markTokenRefresh: () => set((state) => ({
    diagnostics: {
      ...state.diagnostics,
      tokenRefreshCount: state.diagnostics.tokenRefreshCount + 1,
    },
  })),

  markPermissionDenied: (message = 'Microphone permission denied') => set((state) => ({
    connectionState: 'permission_denied',
    error: message,
    micMuted: true,
    micPublishing: false,
    diagnostics: {
      ...state.diagnostics,
      permissionDeniedCount: state.diagnostics.permissionDeniedCount + 1,
      lastError: message,
    },
  })),

  resetVoiceSession: (reason = null) => set((state) => ({
    ...initialVoiceState,
    mutedPlayerIds: state.mutedPlayerIds,
    inputDevices: state.inputDevices,
    outputDevices: state.outputDevices,
    connectionState: reason ? 'disconnected' : 'idle',
    error: reason,
    diagnostics: {
      ...state.diagnostics,
      lastDisconnectedAt: Date.now(),
      lastError: reason ?? state.diagnostics.lastError,
      remoteParticipantCount: 0,
    },
  })),
}));
