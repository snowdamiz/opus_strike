import assert from 'node:assert/strict';
import {
  BATTLE_ROYAL_DOWNED_DURATION_MS,
  BATTLE_ROYAL_DOWNED_MAX_HP,
  BATTLE_ROYAL_REVIVE_DURATION_MS,
  BATTLE_ROYAL_REVIVED_HEALTH,
} from '@voxel-strike/shared';
import {
  BattleRoyalDownedRuntime,
  hasBattleRoyalHoldInteractionBreakingInput,
} from '../rooms/battleRoyalDownedRuntime';
import { GameRoom } from '../rooms/GameRoom';
import type { Player } from '../rooms/schema/Player';
import type { PlayerInput } from '@voxel-strike/shared';

function player(id: string, team = 'br_01', state = 'alive', x = 0): Player {
  return {
    id,
    team,
    state,
    health: 100,
    maxHealth: 100,
    downedHealth: 0,
    downedMaxHealth: 0,
    downedStartedAt: 0,
    downedRemainingMs: 0,
    downedExpiresAt: 0,
    reviveStartedAt: 0,
    reviveCompletesAt: 0,
    reviveByPlayerId: '',
    position: { x, y: 1, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    movement: {},
  } as unknown as Player;
}

function input(overrides: Partial<PlayerInput> = {}): PlayerInput {
  return {
    tick: 1,
    moveForward: false,
    moveBackward: false,
    moveLeft: false,
    moveRight: false,
    jump: false,
    crouch: false,
    sprint: false,
    primaryFire: false,
    secondaryFire: false,
    reload: false,
    ability1: false,
    ability2: false,
    ultimate: false,
    interact: false,
    lookYaw: 0,
    lookPitch: 0,
    timestamp: 0,
    ...overrides,
  };
}

const players = new Map<string, Player>();
const target = player('target');
const reviver = player('reviver', 'br_01', 'alive', 1);
players.set(target.id, target);
players.set(reviver.id, reviver);

const broadcasts: string[] = [];
const eliminated: Array<{ playerId: string; sourceId: string | null; damageType: string }> = [];
const preparedDowned: string[] = [];
const preparedRevived: string[] = [];
const runtime = new BattleRoyalDownedRuntime({
  getPlayerById: (playerId) => players.get(playerId) ?? null,
  prepareDownedPlayer: (downedPlayer) => preparedDowned.push(downedPlayer.id),
  prepareRevivedPlayer: (revivedPlayer) => preparedRevived.push(revivedPlayer.id),
  finalEliminate: (eliminatedPlayer, sourceId, damageType) => {
    eliminated.push({ playerId: eliminatedPlayer.id, sourceId, damageType });
  },
  broadcastPlayerDowned: (payload) => broadcasts.push(`downed:${payload.targetId}:${payload.sourceId}:${payload.damageType}`),
  broadcastReviveStarted: (payload) => broadcasts.push(`started:${payload.targetId}:${payload.reviverId}`),
  broadcastReviveCancelled: (payload) => broadcasts.push(`cancelled:${payload.targetId}:${payload.reviverId}:${payload.reason}`),
  broadcastPlayerRevived: (payload) => broadcasts.push(`revived:${payload.targetId}:${payload.reviverId}:${payload.health}`),
});

const now = 10_000;
runtime.enterDowned(target, 'enemy', 'primary', now);
assert.equal(target.state, 'downed');
assert.equal(target.health, 0);
assert.equal(target.downedHealth, BATTLE_ROYAL_DOWNED_MAX_HP);
assert.equal(target.downedRemainingMs, BATTLE_ROYAL_DOWNED_DURATION_MS);
assert.equal(target.downedExpiresAt, now + BATTLE_ROYAL_DOWNED_DURATION_MS);
assert.deepEqual(preparedDowned, ['target']);
assert.deepEqual(broadcasts, ['downed:target:enemy:primary']);

runtime.update(players.values(), now + 1_250);
assert.equal(target.downedRemainingMs, BATTLE_ROYAL_DOWNED_DURATION_MS - 1_250);

assert.equal(runtime.tryStartRevive(reviver, target, now + 2_000), true);
assert.equal(target.reviveByPlayerId, reviver.id);
assert.equal(target.downedExpiresAt, 0);
assert.equal(target.downedRemainingMs, BATTLE_ROYAL_DOWNED_DURATION_MS - 2_000);
assert.equal(runtime.isReviving(reviver.id), true);

runtime.update(players.values(), now + 4_000);
assert.equal(target.downedRemainingMs, BATTLE_ROYAL_DOWNED_DURATION_MS - 2_000);

assert.equal(runtime.cancelReviveForTarget(target, 'interrupted', now + 4_100), true);
assert.equal(target.reviveByPlayerId, '');
assert.equal(target.downedExpiresAt, now + 4_100 + BATTLE_ROYAL_DOWNED_DURATION_MS - 2_000);
assert.equal(runtime.isReviving(reviver.id), false);

assert.equal(runtime.tryStartRevive(reviver, target, now + 5_000), true);
runtime.update(players.values(), now + 5_000 + BATTLE_ROYAL_REVIVE_DURATION_MS);
assert.equal(target.state, 'alive');
assert.equal(target.health, BATTLE_ROYAL_REVIVED_HEALTH);
assert.equal(target.downedHealth, 0);
assert.equal(target.reviveByPlayerId, '');
assert.deepEqual(preparedRevived, ['target']);

const secondTarget = player('second');
players.set(secondTarget.id, secondTarget);
runtime.enterDowned(secondTarget, null, 'safe_zone', now);
runtime.update(players.values(), now + BATTLE_ROYAL_DOWNED_DURATION_MS + 1);
assert.deepEqual(eliminated, [{ playerId: 'second', sourceId: null, damageType: 'bleed_out' }]);

assert.equal(hasBattleRoyalHoldInteractionBreakingInput({
  ...input({ interact: true }),
  timestamp: now,
}), false);
assert.equal(hasBattleRoyalHoldInteractionBreakingInput({
  ...input({ tick: 2, moveForward: true, interact: true }),
  timestamp: now,
}), true);

{
  const room = Object.create(GameRoom.prototype) as any;
  const reviverPlayer = player('reviver-input');
  const downedPlayer = player('downed-input', 'br_01', 'downed');
  const cancelled: string[] = [];
  room.state = { players: new Map([[downedPlayer.id, downedPlayer]]) };
  room.playerRoots = { isRooted: () => false };
  room.battleRoyalDownedRuntime = {
    isReviving: (playerId: string) => playerId === reviverPlayer.id,
    getReviveTargetId: () => downedPlayer.id,
    cancelReviveForTarget: (_target: Player, reason: string) => {
      cancelled.push(reason);
      return true;
    },
    cancelReviveForPlayer: (_playerId: string, reason: string) => {
      cancelled.push(reason);
      return true;
    },
    isBeingRevived: () => false,
  };

  const sanitizedReviverInput = room.getSanitizedMovementInput(
    reviverPlayer,
    input({
      moveForward: true,
      jump: true,
      primaryFire: true,
      ability1: true,
      reload: true,
      interact: true,
    }),
    now
  );
  assert.deepEqual(cancelled, ['interrupted']);
  assert.equal(sanitizedReviverInput.moveForward, false);
  assert.equal(sanitizedReviverInput.primaryFire, false);
  assert.equal(sanitizedReviverInput.ability1, false);
  assert.equal(sanitizedReviverInput.reload, false);

  room.battleRoyalDownedRuntime.isReviving = () => false;
  const sanitizedDownedInput = room.getSanitizedMovementInput(
    downedPlayer,
    input({
      moveForward: true,
      moveLeft: true,
      jump: true,
      sprint: true,
      primaryFire: true,
      ability2: true,
      ultimate: true,
      interact: true,
    }),
    now
  );
  assert.equal(sanitizedDownedInput.moveForward, true);
  assert.equal(sanitizedDownedInput.moveLeft, true);
  assert.equal(sanitizedDownedInput.jump, false);
  assert.equal(sanitizedDownedInput.sprint, false);
  assert.equal(sanitizedDownedInput.primaryFire, false);
  assert.equal(sanitizedDownedInput.ability2, false);
  assert.equal(sanitizedDownedInput.ultimate, false);
  assert.equal(sanitizedDownedInput.interact, false);

  room.battleRoyalDownedRuntime.isBeingRevived = () => true;
  const frozenDownedInput = room.getSanitizedMovementInput(
    downedPlayer,
    input({ moveForward: true, moveRight: true }),
    now
  );
  assert.equal(frozenDownedInput.moveForward, false);
  assert.equal(frozenDownedInput.moveRight, false);
}

{
  const botRoom = Object.create(GameRoom.prototype) as any;
  const botReviver = player('bot-reviver', 'br_01', 'alive', 0);
  const closerBotAlly = player('closer-bot-ally', 'br_01', 'downed', 1);
  const humanAlly = player('human-ally', 'br_01', 'downed', 2);
  botReviver.isBot = true;
  closerBotAlly.isBot = true;
  humanAlly.isBot = false;

  const botStarted: string[] = [];
  botRoom.state = {
    players: new Map([
      [botReviver.id, botReviver],
      [closerBotAlly.id, closerBotAlly],
      [humanAlly.id, humanAlly],
    ]),
  };
  botRoom.battleRoyalDownedRuntime = {
    isReviving: () => false,
    tryStartRevive: (_reviver: Player, target: Player) => {
      botStarted.push(target.id);
      return true;
    },
  };

  assert.equal(botRoom.tryStartBattleRoyalRevive(botReviver, now), true);
  assert.deepEqual(botStarted, [humanAlly.id]);

  const humanRoom = Object.create(GameRoom.prototype) as any;
  const humanReviver = player('human-reviver', 'br_01', 'alive', 0);
  const nearestBotAlly = player('nearest-bot-ally', 'br_01', 'downed', 1);
  const fartherHumanAlly = player('farther-human-ally', 'br_01', 'downed', 2);
  humanReviver.isBot = false;
  nearestBotAlly.isBot = true;
  fartherHumanAlly.isBot = false;

  const humanStarted: string[] = [];
  humanRoom.state = {
    players: new Map([
      [humanReviver.id, humanReviver],
      [nearestBotAlly.id, nearestBotAlly],
      [fartherHumanAlly.id, fartherHumanAlly],
    ]),
  };
  humanRoom.battleRoyalDownedRuntime = {
    isReviving: () => false,
    tryStartRevive: (_reviver: Player, target: Player) => {
      humanStarted.push(target.id);
      return true;
    },
  };

  assert.equal(humanRoom.tryStartBattleRoyalRevive(humanReviver, now), true);
  assert.deepEqual(humanStarted, [nearestBotAlly.id]);
}

{
  const room = Object.create(GameRoom.prototype) as any;
  const requester = player('requester', 'br_01', 'alive');
  const teammate = player('teammate', 'br_01', 'alive');
  const enemy = player('enemy', 'br_02', 'alive');
  requester.heroId = 'blaze';
  teammate.heroId = 'blaze';
  enemy.heroId = 'blaze';

  const downed: Array<{ playerId: string; sourceId: string | null; damageType: string; now: number }> = [];
  const broadcasts: unknown[] = [];
  const sent: Array<{ type: string; payload: unknown }> = [];
  room.requireDevelopmentMode = () => true;
  room.gameplayMode = 'battle_royal';
  room.npcs = new Set<string>();
  room.state = {
    phase: 'playing',
    serverTime: 12_345,
    players: new Map([
      [requester.id, requester],
      [enemy.id, enemy],
      [teammate.id, teammate],
    ]),
  };
  room.battleRoyalDownedRuntime = {
    enterDowned: (target: Player, sourceId: string | null, damageType: string, nowMs: number) => {
      downed.push({ playerId: target.id, sourceId, damageType, now: nowMs });
    },
  };
  room.broadcastStateStreams = (options: unknown) => broadcasts.push(options);

  room.handleDevDownHero({ sessionId: requester.id, send: (type: string, payload: unknown) => sent.push({ type, payload }) }, 'blaze');

  assert.deepEqual(downed, [{
    playerId: teammate.id,
    sourceId: null,
    damageType: 'dev_command',
    now: 12_345,
  }]);
  assert.deepEqual(sent, []);
  assert.deepEqual(broadcasts, [{ transforms: true, forceVitals: true, forceMatch: true }]);
}

console.log('battle royal downed runtime tests passed');
