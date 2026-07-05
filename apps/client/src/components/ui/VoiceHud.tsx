import { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import type { Team } from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import { useVoiceStore, type VoiceConnectionState, type VoiceParticipant } from '../../store/voiceStore';
import { EditableHudItem } from './EditableHudItem';

function SpeakerIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 15H3.75A1.75 1.75 0 012 13.25v-2.5C2 9.784 2.784 9 3.75 9H5l4.2-3.15A1.125 1.125 0 0111 6.75v10.5a1.125 1.125 0 01-1.8.9L5 15z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 9.5a3.5 3.5 0 010 5M17.5 7a7 7 0 010 10" />
    </svg>
  );
}

function MicrophoneIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3.75a3.25 3.25 0 00-3.25 3.25v4.5a3.25 3.25 0 006.5 0V7A3.25 3.25 0 0012 3.75z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.75 10.75v.75a6.25 6.25 0 0012.5 0v-.75M12 17.75v2.5M8.75 20.25h6.5" />
    </svg>
  );
}

export function voiceHudStatusMessage(state: VoiceConnectionState, error: string | null): string | null {
  if (state === 'permission_denied') return error || 'MIC DENIED';
  if (state === 'error') return error || 'VOICE ERROR';
  return null;
}

export interface VoiceHudPlayer {
  id: string;
  name: string;
  team: Team;
  isBot: boolean;
}

export interface VoiceHudTalkerRow {
  id: string;
  name: string;
  isLocal: boolean;
  isPublishing: boolean;
}

function isAudibleSpeaker(participant: VoiceParticipant | null): boolean {
  return Boolean(participant?.isSpeaking && !participant.isLocallyMuted);
}

export function buildVoiceHudTalkers({
  localPlayer,
  players,
  participants,
  pushToTalkActive,
  micPublishing,
  micMuted,
}: {
  localPlayer: VoiceHudPlayer | null;
  players: Iterable<VoiceHudPlayer>;
  participants: Iterable<VoiceParticipant>;
  pushToTalkActive: boolean;
  micPublishing: boolean;
  micMuted: boolean;
}): VoiceHudTalkerRow[] {
  if (!localPlayer) return [];

  const participantsByPlayerId = new Map<string, VoiceParticipant>();
  for (const participant of participants) {
    if (participant.playerId) {
      participantsByPlayerId.set(participant.playerId, participant);
    }
  }
  const playersById = new Map<string, VoiceHudPlayer>();
  for (const player of players) {
    playersById.set(player.id, player);
  }

  const next: VoiceHudTalkerRow[] = [];
  const seenPlayerIds = new Set<string>();

  if (pushToTalkActive) {
    seenPlayerIds.add(localPlayer.id);
    next.push({
      id: localPlayer.id,
      name: localPlayer.name,
      isLocal: true,
      isPublishing: micPublishing && !micMuted,
    });
  }

  for (const player of players) {
    if (player.team !== localPlayer.team || player.isBot) continue;
    if (seenPlayerIds.has(player.id)) continue;

    const participant = participantsByPlayerId.get(player.id) ?? null;
    if (!isAudibleSpeaker(participant)) continue;

    seenPlayerIds.add(player.id);
    next.push({
      id: player.id,
      name: player.name,
      isLocal: false,
      isPublishing: true,
    });
  }

  for (const participant of participants) {
    const hydratedPlayer = participant.playerId ? playersById.get(participant.playerId) ?? null : null;
    if (
      participant.isLocal ||
      !participant.playerId ||
      seenPlayerIds.has(participant.playerId) ||
      hydratedPlayer?.isBot ||
      (hydratedPlayer && hydratedPlayer.team !== localPlayer.team) ||
      participant.team !== localPlayer.team ||
      !isAudibleSpeaker(participant)
    ) {
      continue;
    }

    next.push({
      id: participant.identity,
      name: participant.name,
      isLocal: false,
      isPublishing: true,
    });
  }

  return next.slice(0, 4);
}

export function VoiceHud() {
  const { players, localPlayer } = useGameStore(
    useShallow((state) => ({
      players: state.players,
      localPlayer: state.localPlayer,
    }))
  );
  const {
    connectionState,
    error,
    micMuted,
    micPublishing,
    pushToTalkActive,
    participants,
  } = useVoiceStore(
    useShallow((state) => ({
      connectionState: state.connectionState,
      error: state.error,
      micMuted: state.micMuted,
      micPublishing: state.micPublishing,
      pushToTalkActive: state.pushToTalkActive,
      participants: state.participants,
    }))
  );

  const talkers = useMemo(() => buildVoiceHudTalkers({
    localPlayer,
    players: players.values(),
    participants: participants.values(),
    pushToTalkActive,
    micPublishing,
    micMuted,
  }), [localPlayer, micMuted, micPublishing, participants, players, pushToTalkActive]);

  const message = voiceHudStatusMessage(connectionState, error);
  if (talkers.length === 0 && !message) return null;

  return (
    <EditableHudItem
      id="hud-voice"
      label="Voice"
      desktopClassName="hud-voice absolute z-[130] pointer-events-none select-none"
      desktopStyle={{
        left: 'clamp(0.75rem, 1.25vw, 1.125rem)',
        bottom: 'calc(clamp(0.75rem, 1.25vw, 1.125rem) + 1.35rem)',
      }}
      mobileClassName="hud-voice z-[130] select-none"
      contentClassName="flex h-full w-full items-end justify-start"
    >
      <div className="flex max-w-[min(15rem,44vw)] flex-col items-start gap-1.5">
        {talkers.map((talker) => (
          <div
            key={talker.id}
            className={`flex h-8 items-center gap-2 rounded-md border px-2.5 font-body text-xs shadow-lg backdrop-blur-md animate-fade-in ${
              talker.isLocal
                ? talker.isPublishing
                  ? 'border-emerald-300/32 bg-emerald-500/18 text-emerald-50'
                  : 'border-amber-300/28 bg-amber-400/14 text-amber-50'
                : 'border-white/12 bg-black/46 text-white/86'
            }`}
          >
            <span className={talker.isLocal ? talker.isPublishing ? 'text-emerald-200' : 'text-amber-200' : 'text-cyan-200'}>
              {talker.isLocal ? <MicrophoneIcon /> : <SpeakerIcon />}
            </span>
            <span className="max-w-[10rem] truncate">{talker.name}</span>
          </div>
        ))}

        {message && (
          <div className="flex h-8 items-center gap-2 rounded-md border border-red-300/26 bg-red-500/16 px-2.5 font-body text-xs text-red-100 shadow-lg backdrop-blur-md animate-fade-in">
            <SpeakerIcon />
            <span className="max-w-[12rem] truncate">{message}</span>
          </div>
        )}
      </div>
    </EditableHudItem>
  );
}
