import assert from 'node:assert/strict';
import {
  computeVoiceElementVolume,
  initialVoiceState,
  shouldHandlePushToTalkKey,
  useVoiceStore,
} from './voiceStore';

function resetStore() {
  useVoiceStore.setState({
    ...initialVoiceState,
    mutedPlayerIds: new Set(),
    participants: new Map(),
    inputDevices: [],
    outputDevices: [],
    diagnostics: { ...initialVoiceState.diagnostics },
  });
}

resetStore();

assert.equal(computeVoiceElementVolume(80, 50, false, false), 0.4);
assert.equal(computeVoiceElementVolume(80, 50, true, false), 0);
assert.equal(computeVoiceElementVolume(80, 50, false, true), 0);
assert.equal(computeVoiceElementVolume(150, 100, false, false), 1);
assert.equal(computeVoiceElementVolume(-10, 100, false, false), 0);

assert.equal(shouldHandlePushToTalkKey('KeyV', 'KeyV'), true);
assert.equal(shouldHandlePushToTalkKey('KeyB', 'KeyV'), false);
assert.equal(shouldHandlePushToTalkKey('KeyV', ''), false);

useVoiceStore.getState().upsertParticipant({
  identity: 'identity-a',
  playerId: 'player-a',
  name: 'Alpha',
  team: 'red',
  isLocal: false,
  isSpeaking: false,
  isLocallyMuted: false,
});
assert.equal(useVoiceStore.getState().participants.get('identity-a')?.isLocallyMuted, false);

useVoiceStore.getState().setPlayerMuted('player-a', true);
assert.equal(useVoiceStore.getState().mutedPlayerIds.has('player-a'), true);
assert.equal(useVoiceStore.getState().participants.get('identity-a')?.isLocallyMuted, true);

useVoiceStore.getState().setSpeakingIdentities(new Set(['identity-a']));
assert.equal(useVoiceStore.getState().participants.get('identity-a')?.isSpeaking, true);

useVoiceStore.getState().setDeafened(true);
assert.equal(useVoiceStore.getState().deafened, true);

useVoiceStore.getState().resetVoiceSession('test reset');
assert.equal(useVoiceStore.getState().participants.size, 0);
assert.equal(useVoiceStore.getState().mutedPlayerIds.has('player-a'), true);
assert.equal(useVoiceStore.getState().connectionState, 'disconnected');

console.log('voice store tests passed');
