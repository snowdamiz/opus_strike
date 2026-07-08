import assert from 'node:assert/strict';
import type { Team } from '@voxel-strike/shared';
import {
  buildVoiceHudTalkers,
  voiceHudStatusMessage,
  type VoiceHudPlayer,
} from './VoiceHud';
import type { VoiceParticipant } from '../../store/voiceStore';

function player(id: string, name: string, team: Team = 'red', isBot = false): VoiceHudPlayer {
  return { id, name, team, isBot };
}

function participant(overrides: Partial<VoiceParticipant> = {}): VoiceParticipant {
  return {
    identity: 'identity-a',
    playerId: 'player-a',
    name: 'Alpha',
    team: 'red',
    isLocal: false,
    isSpeaking: false,
    isLocallyMuted: false,
    ...overrides,
  };
}

const localPlayer = player('local-player', 'SN0w');

assert.deepEqual(
  buildVoiceHudTalkers({
    localPlayer,
    players: [localPlayer],
    participants: [],
    pushToTalkActive: true,
    micPublishing: false,
    micMuted: true,
  }),
  [{
    id: 'local-player',
    name: 'SN0w',
    isLocal: true,
    isPublishing: false,
  }],
  'holding push-to-talk should show the local mic row immediately, before publish completes'
);

assert.deepEqual(
  buildVoiceHudTalkers({
    localPlayer,
    players: [localPlayer],
    participants: [],
    pushToTalkActive: true,
    micPublishing: true,
    micMuted: false,
  }),
  [{
    id: 'local-player',
    name: 'SN0w',
    isLocal: true,
    isPublishing: true,
  }],
  'published local mic should be marked as publishing'
);

assert.deepEqual(
  buildVoiceHudTalkers({
    localPlayer,
    players: [localPlayer],
    participants: [],
    pushToTalkActive: false,
    micPublishing: false,
    micMuted: true,
  }),
  [],
  'idle local mic should not render a talker row'
);

assert.deepEqual(
  buildVoiceHudTalkers({
    localPlayer,
    players: [
      localPlayer,
      player('teammate', 'Echo'),
      player('enemy', 'Rival', 'blue'),
      player('bot', 'Practice Bot', 'red', true),
    ],
    participants: [
      participant({ identity: 'voice-teammate', playerId: 'teammate', name: 'Echo', isSpeaking: true }),
      participant({ identity: 'voice-enemy', playerId: 'enemy', name: 'Rival', team: 'blue', isSpeaking: true }),
      participant({ identity: 'voice-bot', playerId: 'bot', name: 'Practice Bot', isSpeaking: true }),
    ],
    pushToTalkActive: false,
    micPublishing: false,
    micMuted: true,
  }),
  [{
    id: 'teammate',
    name: 'Echo',
    isLocal: false,
    isPublishing: true,
  }],
  'only audible human teammates should render as remote talkers'
);

assert.deepEqual(
  buildVoiceHudTalkers({
    localPlayer,
    players: [localPlayer, player('teammate', 'Echo')],
    participants: [
      participant({
        identity: 'voice-muted-teammate',
        playerId: 'teammate',
        name: 'Echo',
        isSpeaking: true,
        isLocallyMuted: true,
      }),
    ],
    pushToTalkActive: false,
    micPublishing: false,
    micMuted: true,
  }),
  [],
  'locally muted teammates should not render as audible speakers'
);

assert.deepEqual(
  buildVoiceHudTalkers({
    localPlayer,
    players: [localPlayer],
    participants: [
      participant({
        identity: 'voice-late-metadata',
        playerId: 'late-player',
        name: 'Late Joiner',
        team: 'red',
        isSpeaking: true,
      }),
    ],
    pushToTalkActive: false,
    micPublishing: false,
    micMuted: true,
  }),
  [{
    id: 'voice-late-metadata',
    name: 'Late Joiner',
    isLocal: false,
    isPublishing: true,
  }],
  'speaking teammates without a hydrated player row should still be visible from voice metadata'
);

assert.equal(voiceHudStatusMessage('permission_denied', null), 'MIC DENIED');
assert.equal(voiceHudStatusMessage('error', 'microphone unavailable'), 'microphone unavailable');
assert.equal(voiceHudStatusMessage('error', 'could not establish pc connection'), 'VOICE LINK FAILED');
assert.equal(voiceHudStatusMessage('reconnecting', 'could not establish pc connection'), 'RETRYING VOICE LINK');
assert.equal(voiceHudStatusMessage('connected', null), null);

console.log('voice hud tests passed');
