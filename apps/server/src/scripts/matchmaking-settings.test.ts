import assert from 'node:assert/strict';
import {
  createMatchmakingSettings,
  doesMatchmakingMetadataMatchSettings,
  getQueueStatusCacheKey,
} from '../matchmaking/matchSettings';
import { createGameEntryTicket, verifyGameEntryTicket } from '../security/entryTickets';

const firstPersonQuickPlay = createMatchmakingSettings({
  matchMode: 'quick_play',
  gameplayMode: 'team_deathmatch',
  botFillMode: 'manual',
  matchPerspective: 'first_person',
});
const thirdPersonQuickPlay = createMatchmakingSettings({
  matchMode: 'quick_play',
  gameplayMode: 'team_deathmatch',
  botFillMode: 'manual',
  matchPerspective: 'third_person',
});
const rankedSettings = createMatchmakingSettings({
  matchMode: 'ranked',
  gameplayMode: 'capture_the_flag',
  botFillMode: 'manual',
  matchPerspective: 'third_person',
});

assert.notEqual(
  getQueueStatusCacheKey('quick_play', 'team_deathmatch', 'manual', 'first_person'),
  getQueueStatusCacheKey('quick_play', 'team_deathmatch', 'manual', 'third_person')
);
assert.notEqual(
  getQueueStatusCacheKey('quick_play', 'team_deathmatch', 'manual', 'third_person'),
  getQueueStatusCacheKey('quick_play', 'team_deathmatch', 'fill_even', 'third_person')
);
assert.equal(
  getQueueStatusCacheKey('ranked', 'capture_the_flag', 'manual', 'third_person'),
  'ranked:battle_royal:fill_even:first_person'
);
assert.equal(
  getQueueStatusCacheKey('quick_play', 'team_deathmatch', 'manual', 'third_person', 'lhr'),
  'quick_play:team_deathmatch:manual:third_person:lhr'
);
assert.equal(
  getQueueStatusCacheKey('ranked', 'capture_the_flag', 'manual', 'third_person', 'nrt'),
  'ranked:battle_royal:fill_even:first_person:nrt'
);

const regionalQuickPlay = createMatchmakingSettings({
  matchMode: 'quick_play',
  gameplayMode: 'team_deathmatch',
  botFillMode: 'manual',
  matchPerspective: 'first_person',
  matchmakingRegion: 'LHR',
});
assert.equal(regionalQuickPlay.matchmakingRegion, 'lhr');

assert.equal(doesMatchmakingMetadataMatchSettings({
  matchMode: 'quick_play',
  gameplayMode: 'team_deathmatch',
  botFillMode: 'manual',
  matchPerspective: 'first_person',
  matchmakingRegion: 'lhr',
}, regionalQuickPlay), true);
assert.equal(doesMatchmakingMetadataMatchSettings({
  matchMode: 'quick_play',
  gameplayMode: 'team_deathmatch',
  botFillMode: 'manual',
  matchPerspective: 'first_person',
  matchmakingRegion: 'iad',
}, regionalQuickPlay), false);
assert.equal(doesMatchmakingMetadataMatchSettings({
  matchMode: 'quick_play',
  gameplayMode: 'team_deathmatch',
  botFillMode: 'manual',
  matchPerspective: 'first_person',
}, firstPersonQuickPlay), true);
assert.equal(doesMatchmakingMetadataMatchSettings({
  matchMode: 'quick_play',
  gameplayMode: 'team_deathmatch',
  botFillMode: 'manual',
  matchPerspective: 'first_person',
}, thirdPersonQuickPlay), false);
assert.equal(doesMatchmakingMetadataMatchSettings({
  matchMode: 'quick_play',
  gameplayMode: 'team_deathmatch',
  botFillMode: 'fill_even',
  matchPerspective: 'third_person',
}, thirdPersonQuickPlay), false);
assert.equal(rankedSettings.gameplayMode, 'battle_royal');
assert.equal(rankedSettings.botFillMode, 'fill_even');
assert.equal(rankedSettings.matchPerspective, 'first_person');
assert.equal(doesMatchmakingMetadataMatchSettings({
  matchMode: 'ranked',
  gameplayMode: 'battle_royal',
  botFillMode: 'fill_even',
  matchPerspective: 'first_person',
}, rankedSettings), true);
assert.equal(doesMatchmakingMetadataMatchSettings({
  matchMode: 'ranked',
  gameplayMode: 'capture_the_flag',
  botFillMode: 'manual',
  matchPerspective: 'first_person',
}, rankedSettings), false);

const ticket = createGameEntryTicket({
  lobbyId: 'lobby-settings',
  gameRoomId: 'game-settings',
  lobbyPlayerId: 'player-a',
  userId: 'user-a',
  displayName: 'Player A',
  matchPerspective: 'third_person',
  assignedTeam: 'red',
});
const verified = verifyGameEntryTicket(ticket, {
  lobbyId: 'lobby-settings',
  gameRoomId: 'game-settings',
});
assert.ok(verified);
assert.equal(verified.matchPerspective, 'third_person');

console.log('matchmaking settings tests passed');
