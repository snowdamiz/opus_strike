import assert from 'node:assert/strict';
import type {
  DevBotLookOverride,
  DevBotSkillOverride,
} from '../rooms/devBotCommands';
import {
  DevRoomRuntime,
  buildDevBotSpawnProfile,
  parseDevBotLookRequest,
  parseDevBotSkillRequest,
  parseDevHeroTeamRequest,
  parseDevNpcDamageRequest,
  parseDevNpcIdRequest,
  parseDevNpcSpawnRequest,
  readDevEnabledFlag,
  resolveDevBotStateForPhase,
  validateDevBotAddRequest,
} from '../rooms/devRoomRuntime';

{
  assert.equal(readDevEnabledFlag(null), false);
  assert.equal(readDevEnabledFlag({ enabled: false }), false);
  assert.equal(readDevEnabledFlag({ enabled: true }), true);
}

{
  assert.deepEqual(parseDevNpcSpawnRequest({
    heroId: 'phantom',
    team: 'blue',
    position: { x: 1, y: 2, z: 3 },
    name: '  Test   NPC ',
  }), {
    heroId: 'phantom',
    team: 'blue',
    position: { x: 1, y: 2, z: 3 },
    name: 'Test NPC',
  });

  assert.equal(parseDevNpcSpawnRequest(null), null);
  assert.equal(parseDevNpcSpawnRequest({ heroId: 'missing' }), null);
  assert.equal(parseDevNpcSpawnRequest({ heroId: 'phantom', team: 'green' }), null);
  assert.equal(parseDevNpcSpawnRequest({ heroId: 'phantom', position: { x: 1, y: 2 } }), null);
  assert.deepEqual(parseDevNpcSpawnRequest({ heroId: 'phantom', name: 123 }), {
    heroId: 'phantom',
    team: undefined,
    position: undefined,
    name: undefined,
  });
}

{
  assert.deepEqual(parseDevNpcDamageRequest({
    npcId: '  npc-a  ',
    damage: 1234,
  }), {
    npcId: 'npc-a',
    damage: 1000,
  });
  assert.deepEqual(parseDevNpcDamageRequest({
    npcId: 'npc-a',
    damage: -50,
  }), {
    npcId: 'npc-a',
    damage: 0,
  });
  assert.equal(parseDevNpcDamageRequest({ npcId: 'npc-a', damage: Number.NaN }), null);
  assert.equal(parseDevNpcDamageRequest({ damage: 10 }), null);

  assert.deepEqual(parseDevNpcIdRequest({ npcId: ' npc-b ' }), { npcId: 'npc-b' });
  assert.equal(parseDevNpcIdRequest({}), null);
}

{
  assert.deepEqual(parseDevHeroTeamRequest({ heroId: 'blaze', team: 'red' }), {
    heroId: 'blaze',
    team: 'red',
  });
  assert.equal(parseDevHeroTeamRequest({ heroId: 'blaze', team: 'yellow' }), null);

  assert.deepEqual(parseDevBotSkillRequest({
    heroId: 'chronos',
    team: 'blue',
    skillKey: '  right click  ',
  }), {
    heroId: 'chronos',
    team: 'blue',
    skillKey: 'right click',
  });
  assert.equal(parseDevBotSkillRequest({ heroId: 'chronos', team: 'blue', skillKey: '' }), null);

  assert.deepEqual(parseDevBotLookRequest({
    heroId: 'hookshot',
    team: 'red',
    direction: ' up ',
  }), {
    heroId: 'hookshot',
    team: 'red',
    direction: 'up',
  });
  assert.equal(parseDevBotLookRequest({ heroId: 'hookshot', team: 'red', direction: 42 }), null);
}

{
  assert.deepEqual(validateDevBotAddRequest({
    heroId: undefined,
    team: 'red',
    playerCount: 0,
    maxPlayers: 4,
    heroAvailable: true,
  }), { ok: false, error: 'Invalid bot hero: ' });
  assert.deepEqual(validateDevBotAddRequest({
    heroId: 'phantom',
    team: undefined,
    playerCount: 0,
    maxPlayers: 4,
    heroAvailable: true,
  }), { ok: false, error: 'Invalid bot team: ' });
  assert.deepEqual(validateDevBotAddRequest({
    heroId: 'phantom',
    team: 'red',
    playerCount: 4,
    maxPlayers: 4,
    heroAvailable: true,
  }), { ok: false, error: 'Game room is full' });
  assert.deepEqual(validateDevBotAddRequest({
    heroId: 'phantom',
    team: 'red',
    playerCount: 1,
    maxPlayers: 4,
    heroAvailable: false,
  }), { ok: false, error: 'Hero is already picked on that team' });
  assert.deepEqual(validateDevBotAddRequest({
    heroId: 'phantom',
    team: 'red',
    playerCount: 1,
    maxPlayers: 4,
    heroAvailable: true,
  }), {
    ok: true,
    heroId: 'phantom',
    heroName: 'Phantom',
    team: 'red',
  });
}

{
  assert.equal(resolveDevBotStateForPhase('playing'), 'alive');
  assert.equal(resolveDevBotStateForPhase('countdown'), 'spawning');
  assert.equal(resolveDevBotStateForPhase('waiting'), 'selecting');
  assert.equal(resolveDevBotStateForPhase('hero_select'), 'selecting');
}

{
  assert.deepEqual(buildDevBotSpawnProfile({
    roomId: 'room-a',
    heroId: 'phantom',
    heroName: 'Phantom',
    team: 'red',
    botIndex: 2,
    phase: 'playing',
  }), {
    id: 'bot_dev_room-a_2',
    name: 'Phantom Bot 3',
    team: 'red',
    isBot: true,
    botDifficulty: 'normal',
    botProfileId: 'dev-phantom-2',
    isReady: true,
    state: 'alive',
  });
}

{
  const runtime = new DevRoomRuntime();

  assert.equal(runtime.isGameClockFrozen(), false);
  assert.equal(runtime.areBotsRooted(), false);
  assert.equal(runtime.isBotBrainEnabled(), true);

  runtime.setGameClockFrozen(true);
  runtime.setBotsRooted(true);
  runtime.setBotBrainEnabled(false);

  assert.equal(runtime.isGameClockFrozen(), true);
  assert.equal(runtime.areBotsRooted(), true);
  assert.equal(runtime.isBotBrainEnabled(), false);
}

{
  const runtime = new DevRoomRuntime();

  runtime.setPlayerImmune('player-a', true);
  assert.equal(runtime.isPlayerImmune('player-a'), true);
  runtime.setPlayerImmune('player-a', false);
  assert.equal(runtime.isPlayerImmune('player-a'), false);
}

{
  const runtime = new DevRoomRuntime();
  const skill: DevBotSkillOverride = {
    slot: 'secondary',
    skillKey: 'rmb',
    expiresAt: 2_000,
  };
  const look: DevBotLookOverride = {
    direction: 'up',
    pitch: 1.25,
    expiresAt: 3_000,
  };

  runtime.setBotSkillOverride('bot-a', skill);
  runtime.setBotLookOverride('bot-a', look);

  assert.equal(runtime.getBotSkillOverride('bot-a'), skill);
  assert.equal(runtime.getBotLookOverride('bot-a'), look);
  assert.equal(runtime.clearBotSkillOverride('bot-a'), true);
  assert.equal(runtime.clearBotSkillOverride('bot-a'), false);
  assert.equal(runtime.getBotSkillOverride('bot-a'), null);
  assert.equal(runtime.getBotLookOverride('bot-a'), look);

  runtime.clearPlayer('bot-a');
  assert.equal(runtime.getBotLookOverride('bot-a'), null);
}

{
  const runtime = new DevRoomRuntime();

  runtime.setPlayerImmune('bot-a', true);
  runtime.setBotSkillOverride('bot-a', { slot: 'primary', skillKey: 'lmb', expiresAt: 1_000 });
  runtime.setBotLookOverride('bot-a', { direction: 'down', pitch: -1, expiresAt: 1_000 });

  runtime.clearPlayer('bot-a');
  assert.equal(runtime.isPlayerImmune('bot-a'), false);
  assert.equal(runtime.getBotSkillOverride('bot-a'), null);
  assert.equal(runtime.getBotLookOverride('bot-a'), null);
}

console.log('dev room runtime tests passed');
