import assert from 'node:assert/strict';
import type { StreamerNextTarget } from '../contexts/networkApi';
import { useStreamerStore } from './streamerStore';

const botDeathmatchTarget = {
  roomId: 'bot-room-a',
  roomName: 'game_room',
  processId: null,
  publicAddress: null,
  source: 'bot_deathmatch',
  streamerObserverTicket: 'ticket-a',
  metadata: {
    phase: 'waiting',
    gameplayMode: 'team_deathmatch',
    matchPerspective: 'third_person',
    mapSeed: 20260701,
    mapThemeId: 'forest',
    mapSize: 'medium',
    mapProfileId: 'ctf_arena',
    combatHumanCount: 0,
    regularObserverCount: 0,
    streamerObserverCount: 0,
    streamerManagedBotGame: true,
    streamerFeedMode: 'bot_deathmatch',
    streamerCameraMode: 'fixed_aerial',
  },
} satisfies StreamerNextTarget;

useStreamerStore.getState().reset();
useStreamerStore.getState().setLoading('spinning_up_bot_match');
useStreamerStore.getState().setPendingTarget(botDeathmatchTarget);

const pendingState = useStreamerStore.getState();
assert.equal(pendingState.isActive, true);
assert.equal(pendingState.isLoading, true);
assert.equal(pendingState.currentRoomId, 'bot-room-a');
assert.equal(pendingState.source, 'bot_deathmatch');
assert.equal(pendingState.metadata?.streamerFeedMode, 'bot_deathmatch');
assert.equal(pendingState.metadata?.streamerCameraMode, 'fixed_aerial');

const unchangedState = useStreamerStore.getState();
useStreamerStore.getState().setHiddenFirstPersonTargetId(null);
assert.equal(useStreamerStore.getState(), unchangedState);

useStreamerStore.getState().setTarget(botDeathmatchTarget);
const joinedState = useStreamerStore.getState();
assert.equal(joinedState.isLoading, false);
assert.equal(joinedState.metadata?.streamerCameraMode, 'fixed_aerial');

useStreamerStore.getState().reset();

console.log('streamer store tests passed');
