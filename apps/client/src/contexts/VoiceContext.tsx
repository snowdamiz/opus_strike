import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type {
  ConnectionState,
  LocalAudioTrack,
  Participant,
  RemoteAudioTrack,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room as LiveKitRoom,
} from 'livekit-client';
import type { Team } from '@voxel-strike/shared';
import type { VoiceParticipantMetadata, VoiceTokenResponse } from '../voice/types';
import { useNetwork } from './NetworkContext';
import { useGameStore } from '../store/gameStore';
import { useSettingsStore, type ClientSettings } from '../store/settingsStore';
import {
  computeVoiceElementVolume,
  shouldHandlePushToTalkKey,
  useVoiceStore,
  type VoiceParticipant,
} from '../store/voiceStore';
import { loggers } from '../utils/logger';
import { registerVoiceDisconnectHandler } from '../voice/voiceControls';

interface VoiceContextType {
  setDeafened: (deafened: boolean) => void;
  refreshDevices: () => Promise<void>;
}

const VoiceContext = createContext<VoiceContextType | null>(null);

type LiveKitModule = typeof import('livekit-client');

let liveKitModulePromise: Promise<LiveKitModule> | null = null;

function loadLiveKit(): Promise<LiveKitModule> {
  liveKitModulePromise ??= import('livekit-client');
  return liveKitModulePromise;
}

type AudioAttachment = {
  track: RemoteAudioTrack;
  element: HTMLMediaElement;
  identity: string;
  playerId: string | null;
};

function parseParticipantMetadata(metadata?: string): Partial<VoiceParticipantMetadata> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as Partial<VoiceParticipantMetadata>;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function toVoiceParticipant(participant: Participant, isLocal: boolean): VoiceParticipant {
  const metadata = parseParticipantMetadata(participant.metadata);
  return {
    identity: participant.identity,
    playerId: metadata.colyseusSessionId ?? null,
    name: participant.name || metadata.displayName || participant.identity,
    team: metadata.team ?? null,
    isLocal,
    isSpeaking: participant.isSpeaking,
    isLocallyMuted: false,
  };
}

function isPermissionDeniedError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError'
    : error instanceof Error && /permission|notallowed|denied/i.test(error.name + error.message);
}

function buildAudioCaptureOptions(settings: ClientSettings) {
  return {
    deviceId: settings.voiceInputDeviceId ? { exact: settings.voiceInputDeviceId } : undefined,
    echoCancellation: settings.echoCancellationEnabled,
    noiseSuppression: settings.noiseSuppressionEnabled,
    autoGainControl: settings.autoGainControlEnabled,
  };
}

function voiceLogState(extra: Record<string, unknown> = {}) {
  const state = useVoiceStore.getState();
  return {
    connectionState: state.connectionState,
    roomName: state.roomName,
    team: state.team,
    micMuted: state.micMuted,
    micPublishing: state.micPublishing,
    pushToTalkActive: state.pushToTalkActive,
    remoteParticipantCount: state.diagnostics.remoteParticipantCount,
    ...extra,
  };
}

function isEditablePushToTalkTarget(target: EventTarget | null): boolean {
  if (document.body.dataset.rebindingKeybind === 'true') return true;
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const { requestVoiceToken } = useNetwork();
  const appPhase = useGameStore((state) => state.appPhase);
  const roomId = useGameStore((state) => state.roomId);
  const localTeam = useGameStore((state) => state.localPlayer?.team ?? null);
  const settings = useSettingsStore((state) => state.settings);
  const settingsRef = useRef(settings);
  const liveKitModuleRef = useRef<LiveKitModule | null>(null);
  const livekitRoomRef = useRef<LiveKitRoom | null>(null);
  const audioRootRef = useRef<HTMLDivElement | null>(null);
  const attachmentsRef = useRef(new Map<string, AudioAttachment>());
  const localMicTrackRef = useRef<LocalAudioTrack | null>(null);
  const localMicSourceTrackRef = useRef<MediaStreamTrack | null>(null);
  const localMicAudioContextRef = useRef<AudioContext | null>(null);
  const localMicGainRef = useRef<GainNode | null>(null);
  const tokenRefreshTimeoutRef = useRef<number | null>(null);
  const connectingKeyRef = useRef<string | null>(null);
  const connectedKeyRef = useRef<string | null>(null);
  const activeConnectionKey = appPhase === 'in_game' && settings.voiceEnabled && roomId && localTeam
    ? `${roomId}:${localTeam}`
    : null;

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const clearTokenRefresh = useCallback(() => {
    if (tokenRefreshTimeoutRef.current !== null) {
      window.clearTimeout(tokenRefreshTimeoutRef.current);
      tokenRefreshTimeoutRef.current = null;
    }
  }, []);

  const updateAttachmentVolumes = useCallback(() => {
    const state = useVoiceStore.getState();
    const currentSettings = settingsRef.current;

    attachmentsRef.current.forEach((attachment) => {
      const muted = attachment.playerId ? state.mutedPlayerIds.has(attachment.playerId) : false;
      const volume = computeVoiceElementVolume(
        currentSettings.masterVolume,
        currentSettings.voiceVolume,
        state.deafened,
        muted
      );
      attachment.element.volume = volume;
      attachment.track.setVolume(volume);
    });
  }, []);

  const applyOutputDevice = useCallback(async () => {
    const deviceId = settingsRef.current.voiceOutputDeviceId;
    const room = livekitRoomRef.current;
    if (room && deviceId) {
      await room.switchActiveDevice('audiooutput', deviceId).catch((error) => {
        loggers.audio.warn('failed to switch voice output device', error);
      });
    }

    await Promise.all(Array.from(attachmentsRef.current.values()).map(async (attachment) => {
      if (!deviceId) return;
      await attachment.track.setSinkId(deviceId).catch((error) => {
        loggers.audio.warn('failed to set voice sink id', error);
      });
    }));
  }, []);

  const cleanupLocalMicrophone = useCallback(async () => {
    const room = livekitRoomRef.current;
    const localTrack = localMicTrackRef.current;
    localMicTrackRef.current = null;
    localMicGainRef.current = null;

    if (room && localTrack) {
      await room.localParticipant.unpublishTrack(localTrack, true).catch((error) => {
        loggers.audio.debug('failed to unpublish voice microphone track', error);
      });
    } else {
      localTrack?.stop();
    }

    localMicSourceTrackRef.current?.stop();
    localMicSourceTrackRef.current = null;

    const audioContext = localMicAudioContextRef.current;
    localMicAudioContextRef.current = null;
    if (audioContext && audioContext.state !== 'closed') {
      await audioContext.close().catch(() => undefined);
    }

    useVoiceStore.getState().setLocalMicState(true, false);
  }, []);

  const refreshDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      useVoiceStore.getState().setDevices([], []);
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      useVoiceStore.getState().setDevices(
        devices.filter((device) => device.kind === 'audioinput'),
        devices.filter((device) => device.kind === 'audiooutput')
      );
    } catch (error) {
      loggers.audio.warn('failed to enumerate voice devices', error);
      useVoiceStore.getState().setDevices([], []);
    }
  }, []);

  const detachRemoteAudio = useCallback((trackSid?: string) => {
    if (trackSid) {
      const attachment = attachmentsRef.current.get(trackSid);
      if (!attachment) return;
      attachment.track.detach(attachment.element);
      attachment.element.remove();
      attachmentsRef.current.delete(trackSid);
      return;
    }

    attachmentsRef.current.forEach((attachment) => {
      attachment.track.detach(attachment.element);
      attachment.element.remove();
    });
    attachmentsRef.current.clear();
  }, []);

  const attachRemoteAudio = useCallback((
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) => {
    const livekit = liveKitModuleRef.current;
    if (
      !livekit ||
      track.kind !== livekit.Track.Kind.Audio ||
      !publication.trackSid ||
      attachmentsRef.current.has(publication.trackSid)
    ) {
      return;
    }

    const audioTrack = track as RemoteAudioTrack;
    const metadata = parseParticipantMetadata(participant.metadata);
    const element = audioTrack.attach();
    element.autoplay = true;
    element.setAttribute('data-voice-identity', participant.identity);
    element.style.display = 'none';
    audioRootRef.current?.appendChild(element);

    attachmentsRef.current.set(publication.trackSid, {
      track: audioTrack,
      element,
      identity: participant.identity,
      playerId: metadata.colyseusSessionId ?? null,
    });

    void applyOutputDevice();
    updateAttachmentVolumes();
  }, [applyOutputDevice, updateAttachmentVolumes]);

  const syncParticipants = useCallback((room: LiveKitRoom, response?: VoiceTokenResponse) => {
    const store = useVoiceStore.getState();
    if (response?.identity) {
      store.upsertParticipant({
        identity: response.identity,
        playerId: response.playerId ?? null,
        name: room.localParticipant.name || response.identity,
        team: response.team ?? null,
        isLocal: true,
        isSpeaking: room.localParticipant.isSpeaking,
        isLocallyMuted: false,
      });
    } else {
      store.upsertParticipant(toVoiceParticipant(room.localParticipant, true));
    }

    room.remoteParticipants.forEach((participant) => {
      store.upsertParticipant(toVoiceParticipant(participant, false));
      participant.audioTrackPublications.forEach((publication) => {
        if (publication.track) {
          attachRemoteAudio(publication.track, publication as RemoteTrackPublication, participant);
        }
      });
    });
  }, [attachRemoteAudio]);

  const scheduleTokenRefresh = useCallback((response: VoiceTokenResponse) => {
    clearTokenRefresh();
    if (!response.enabled || !response.expiresAt) return;

    const delayMs = Math.max(15000, response.expiresAt - Date.now() - 60000);
    tokenRefreshTimeoutRef.current = window.setTimeout(async () => {
      try {
        const refreshed = await requestVoiceToken('match');
        if (refreshed.enabled) {
          useVoiceStore.getState().markTokenRefresh();
          scheduleTokenRefresh(refreshed);
        }
      } catch (error) {
        loggers.audio.warn('voice token refresh failed', error);
      }
    }, delayMs);
  }, [clearTokenRefresh, requestVoiceToken]);

  const disconnectRoom = useCallback(async (reason: string | null = 'voice_disconnect') => {
    clearTokenRefresh();
    connectingKeyRef.current = null;
    connectedKeyRef.current = null;
    const room = livekitRoomRef.current;
    livekitRoomRef.current = null;
    await cleanupLocalMicrophone();
    detachRemoteAudio();

    if (room) {
      room.removeAllListeners();
      await room.disconnect(true).catch((error) => {
        loggers.audio.debug('voice room disconnect failed', error);
      });
    }

    useVoiceStore.getState().setLocalMicState(true, false);
    useVoiceStore.getState().resetVoiceSession(reason);
  }, [clearTokenRefresh, cleanupLocalMicrophone, detachRemoteAudio]);

  const connectRoom = useCallback(async (connectionKey: string) => {
    if (connectingKeyRef.current === connectionKey) return;
    if (
      livekitRoomRef.current &&
      useVoiceStore.getState().connectionState === 'connected' &&
      connectedKeyRef.current === connectionKey
    ) {
      return;
    }

    connectingKeyRef.current = connectionKey;
    useVoiceStore.getState().setConnectionState('requesting_token');

    let response: VoiceTokenResponse;
    try {
      response = await requestVoiceToken('match');
    } catch (error) {
      useVoiceStore.getState().setConnectionState('error', error instanceof Error ? error.message : 'voice token request failed');
      connectingKeyRef.current = null;
      return;
    }

    if (!response.enabled || !response.url || !response.token) {
      useVoiceStore.getState().setAvailability(false, response.reason || 'voice unavailable');
      loggers.voice.warn('voice token rejected', voiceLogState({
        reason: response.reason || 'voice unavailable',
      }));
      connectingKeyRef.current = null;
      return;
    }

    await disconnectRoom(null);
    useVoiceStore.getState().setAvailability(true);
    useVoiceStore.getState().setRoomInfo({
      roomName: response.roomName ?? null,
      identity: response.identity ?? null,
      playerId: response.playerId ?? null,
      team: response.team ?? null,
    });
    useVoiceStore.getState().setConnectionState('connecting');

    let livekit: LiveKitModule;
    try {
      livekit = await loadLiveKit();
      liveKitModuleRef.current = livekit;
    } catch (error) {
      useVoiceStore.getState().setConnectionState('error', error instanceof Error ? error.message : 'voice client failed to load');
      loggers.audio.warn('voice client load failed', error);
      connectingKeyRef.current = null;
      return;
    }

    const room = new livekit.Room({
      dynacast: false,
      adaptiveStream: false,
      publishDefaults: {
        audioPreset: livekit.AudioPresets.speech,
        dtx: true,
        stopMicTrackOnMute: true,
      },
    });
    livekitRoomRef.current = room;

    room.on(livekit.RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      useVoiceStore.getState().setConnectionState(
        state === livekit.ConnectionState.Connected
          ? 'connected'
          : state === livekit.ConnectionState.Reconnecting || state === livekit.ConnectionState.SignalReconnecting
            ? 'reconnecting'
            : state === livekit.ConnectionState.Disconnected
              ? 'disconnected'
              : 'connecting'
      );
    });
    room.on(livekit.RoomEvent.Reconnecting, () => useVoiceStore.getState().markReconnect());
    room.on(livekit.RoomEvent.SignalReconnecting, () => useVoiceStore.getState().markReconnect());
    room.on(livekit.RoomEvent.Reconnected, () => useVoiceStore.getState().setConnectionState('connected'));
    room.on(livekit.RoomEvent.Disconnected, () => {
      detachRemoteAudio();
      useVoiceStore.getState().setLocalMicState(true, false);
      useVoiceStore.getState().setConnectionState('disconnected');
    });
    room.on(livekit.RoomEvent.ParticipantConnected, (participant) => {
      useVoiceStore.getState().upsertParticipant(toVoiceParticipant(participant, false));
    });
    room.on(livekit.RoomEvent.ParticipantDisconnected, (participant) => {
      useVoiceStore.getState().removeParticipant(participant.identity);
    });
    room.on(livekit.RoomEvent.ParticipantMetadataChanged, (_prev, participant) => {
      useVoiceStore.getState().upsertParticipant(toVoiceParticipant(participant, participant.isLocal));
    });
    room.on(livekit.RoomEvent.TrackSubscribed, attachRemoteAudio);
    room.on(livekit.RoomEvent.TrackUnsubscribed, (_track, publication) => {
      detachRemoteAudio(publication.trackSid);
    });
    room.on(livekit.RoomEvent.TrackMuted, (_publication, participant) => {
      useVoiceStore.getState().upsertParticipant(toVoiceParticipant(participant, participant.isLocal));
    });
    room.on(livekit.RoomEvent.TrackUnmuted, (_publication, participant) => {
      useVoiceStore.getState().upsertParticipant(toVoiceParticipant(participant, participant.isLocal));
    });
    room.on(livekit.RoomEvent.ActiveSpeakersChanged, (speakers) => {
      useVoiceStore.getState().setSpeakingIdentities(new Set(speakers.map((speaker) => speaker.identity)));
    });
    room.on(livekit.RoomEvent.MediaDevicesChanged, () => {
      void refreshDevices();
    });
    room.on(livekit.RoomEvent.LocalTrackPublished, () => {
      useVoiceStore.getState().setLocalMicState(false, true);
    });
    room.on(livekit.RoomEvent.LocalTrackUnpublished, () => {
      useVoiceStore.getState().setLocalMicState(true, false);
    });

    try {
      await room.connect(response.url, response.token, { autoSubscribe: true });
      syncParticipants(room, response);
      useVoiceStore.getState().setConnectionState('connected');
      useVoiceStore.getState().setLocalMicState(true, false);
      connectedKeyRef.current = connectionKey;
      loggers.voice.info('voice room connected', voiceLogState({
        livekitRoom: response.roomName ?? null,
        urlHost: (() => {
          try {
            return new URL(response.url).host;
          } catch {
            return 'invalid-url';
          }
        })(),
      }));
      scheduleTokenRefresh(response);
      void room.startAudio().catch((error) => {
        loggers.audio.debug('voice audio playback needs user gesture', error);
      });
      void refreshDevices();
    } catch (error) {
      room.removeAllListeners();
      livekitRoomRef.current = null;
      detachRemoteAudio();
      useVoiceStore.getState().setConnectionState('error', error instanceof Error ? error.message : 'voice connection failed');
      loggers.audio.warn('voice connection failed', error);
      loggers.voice.warn('voice room connection failed', voiceLogState({
        error: error instanceof Error ? error.message : 'voice connection failed',
      }));
    } finally {
      connectingKeyRef.current = null;
    }
  }, [
    attachRemoteAudio,
    detachRemoteAudio,
    disconnectRoom,
    refreshDevices,
    requestVoiceToken,
    scheduleTokenRefresh,
    syncParticipants,
  ]);

  const setMicrophoneMuted = useCallback(async (muted: boolean) => {
    const room = livekitRoomRef.current;
    const state = useVoiceStore.getState();
    if (!room || state.connectionState !== 'connected') {
      useVoiceStore.getState().setLocalMicState(true, false);
      if (!muted) {
        loggers.voice.warn('push-to-talk ignored because voice room is not ready', voiceLogState({
          reason: !room ? 'no_livekit_room' : 'not_connected',
        }));
      }
      return;
    }

    try {
      if (!muted) {
        await room.startAudio().catch(() => undefined);
      }
      const currentSettings = settingsRef.current;
      if (muted) {
        const wasPublishing = Boolean(localMicTrackRef.current || useVoiceStore.getState().micPublishing);
        await cleanupLocalMicrophone();
        if (wasPublishing) {
          loggers.voice.info('microphone unpublished after push-to-talk release', voiceLogState());
        }
        return;
      }

      if (localMicTrackRef.current) {
        if (localMicGainRef.current) {
          localMicGainRef.current.gain.value = currentSettings.micVolume / 100;
        }
        useVoiceStore.getState().setLocalMicState(false, true);
        loggers.voice.debug('microphone publish reused existing local track', voiceLogState());
        return;
      }

      const audioConstraints = buildAudioCaptureOptions(currentSettings);
      loggers.voice.info('microphone publish requested', voiceLogState({
        hasInputDeviceOverride: Boolean(currentSettings.voiceInputDeviceId),
        echoCancellation: currentSettings.echoCancellationEnabled,
        noiseSuppression: currentSettings.noiseSuppressionEnabled,
        autoGainControl: currentSettings.autoGainControlEnabled,
      }));
      const sourceStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      const sourceTrack = sourceStream.getAudioTracks()[0];
      if (!sourceTrack) {
        throw new Error('No microphone track available');
      }

      const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) {
        throw new Error('Web Audio is unavailable');
      }

      const audioContext = new AudioContextConstructor();
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      const source = audioContext.createMediaStreamSource(new MediaStream([sourceTrack]));
      const gain = audioContext.createGain();
      gain.gain.value = currentSettings.micVolume / 100;
      const destination = audioContext.createMediaStreamDestination();
      source.connect(gain);
      gain.connect(destination);
      const processedTrack = destination.stream.getAudioTracks()[0];
      if (!processedTrack) {
        throw new Error('Unable to create processed microphone track');
      }

      const livekit = liveKitModuleRef.current ?? await loadLiveKit();
      liveKitModuleRef.current = livekit;
      const localTrack = new livekit.LocalAudioTrack(processedTrack, audioConstraints, true, audioContext);
      await room.localParticipant.publishTrack(localTrack, {
        source: livekit.Track.Source.Microphone,
        audioPreset: livekit.AudioPresets.speech,
        dtx: true,
        stopMicTrackOnMute: true,
        name: 'team-microphone',
      });

      localMicSourceTrackRef.current = sourceTrack;
      localMicAudioContextRef.current = audioContext;
      localMicGainRef.current = gain;
      localMicTrackRef.current = localTrack;
      useVoiceStore.getState().setLocalMicState(false, true);
      loggers.voice.info('microphone published for push-to-talk', voiceLogState({
        hasInputDeviceOverride: Boolean(currentSettings.voiceInputDeviceId),
      }));
    } catch (error) {
      await cleanupLocalMicrophone();
      if (isPermissionDeniedError(error)) {
        useVoiceStore.getState().markPermissionDenied();
        loggers.voice.warn('microphone permission denied during push-to-talk', voiceLogState({
          error: error instanceof Error ? error.message : 'permission denied',
        }));
        return;
      }
      useVoiceStore.getState().setConnectionState('error', error instanceof Error ? error.message : 'microphone unavailable');
      useVoiceStore.getState().setLocalMicState(true, false);
      loggers.audio.warn('failed to change microphone state', error);
      loggers.voice.warn('microphone publish failed', voiceLogState({
        error: error instanceof Error ? error.message : 'microphone unavailable',
      }));
    }
  }, [cleanupLocalMicrophone]);

  const setDeafened = useCallback((deafened: boolean) => {
    useVoiceStore.getState().setDeafened(deafened);
    updateAttachmentVolumes();
  }, [updateAttachmentVolumes]);

  useEffect(() => {
    const unregister = registerVoiceDisconnectHandler((reason) => {
      void disconnectRoom(reason || 'voice_control_disconnect');
    });
    return unregister;
  }, [disconnectRoom]);

  useEffect(() => {
    if (!activeConnectionKey) {
      void disconnectRoom(settings.voiceEnabled ? 'voice_inactive' : 'voice_disabled');
      return;
    }

    void connectRoom(activeConnectionKey);
  }, [activeConnectionKey, connectRoom, disconnectRoom, settings.voiceEnabled]);

  useEffect(() => {
    updateAttachmentVolumes();
    void applyOutputDevice();
  }, [
    settings.masterVolume,
    settings.voiceVolume,
    settings.voiceOutputDeviceId,
    updateAttachmentVolumes,
    applyOutputDevice,
  ]);

  useEffect(() => {
    const room = livekitRoomRef.current;
    if (!room || useVoiceStore.getState().micMuted) return;

    void (async () => {
      await cleanupLocalMicrophone();
      await setMicrophoneMuted(false);
    })();
  }, [cleanupLocalMicrophone, setMicrophoneMuted, settings.voiceInputDeviceId]);

  useEffect(() => {
    if (localMicGainRef.current) {
      localMicGainRef.current.gain.value = settings.micVolume / 100;
    }
  }, [settings.micVolume]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const currentSettings = settingsRef.current;
      if (
        event.repeat ||
        isEditablePushToTalkTarget(event.target) ||
        !shouldHandlePushToTalkKey(event.code, currentSettings.keybindings.pushToTalk)
      ) {
        return;
      }
      event.preventDefault();
      useVoiceStore.getState().setPushToTalkActive(true);
      loggers.voice.info('push-to-talk pressed', voiceLogState({ key: event.code }));
      void setMicrophoneMuted(false);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const currentSettings = settingsRef.current;
      if (!shouldHandlePushToTalkKey(event.code, currentSettings.keybindings.pushToTalk)) {
        return;
      }
      event.preventDefault();
      useVoiceStore.getState().setPushToTalkActive(false);
      loggers.voice.info('push-to-talk released', voiceLogState({ key: event.code, reason: 'keyup' }));
      void setMicrophoneMuted(true);
    };

    const releasePushToTalk = (reason = 'lost_focus') => {
      if (!useVoiceStore.getState().pushToTalkActive && useVoiceStore.getState().micMuted) return;
      useVoiceStore.getState().setPushToTalkActive(false);
      loggers.voice.info('push-to-talk released', voiceLogState({ reason }));
      void setMicrophoneMuted(true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        releasePushToTalk('page_hidden');
      }
    };
    const handleWindowBlur = () => releasePushToTalk('window_blur');

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [setMicrophoneMuted]);

  useEffect(() => {
    useVoiceStore.getState().setPushToTalkActive(false);
    void setMicrophoneMuted(true);
  }, [setMicrophoneMuted, settings.keybindings.pushToTalk]);

  useEffect(() => {
    const unsubscribe = useVoiceStore.subscribe((state, previousState) => {
      if (state.deafened !== previousState.deafened || state.mutedPlayerIds !== previousState.mutedPlayerIds) {
        updateAttachmentVolumes();
      }
    });
    return unsubscribe;
  }, [updateAttachmentVolumes]);

  useEffect(() => () => {
    void disconnectRoom('voice_provider_unmount');
  }, [disconnectRoom]);

  const value = useMemo<VoiceContextType>(() => ({
    setDeafened,
    refreshDevices,
  }), [refreshDevices, setDeafened]);

  return (
    <VoiceContext.Provider value={value}>
      {children}
      <div ref={audioRootRef} aria-hidden="true" className="hidden" />
    </VoiceContext.Provider>
  );
}

export function useVoice() {
  const context = useContext(VoiceContext);
  if (!context) {
    throw new Error('useVoice must be used within a VoiceProvider');
  }
  return context;
}
