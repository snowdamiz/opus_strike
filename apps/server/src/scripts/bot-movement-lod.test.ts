import assert from 'node:assert/strict';
import {
  PLAYER_HEIGHT,
  type PlayerInput,
} from '@voxel-strike/shared';
import { SERVER_OWNED_MOVEMENT_STEP_SECONDS } from '../rooms/movementCommandDrain';
import { GameRoom } from '../rooms/GameRoom';
import { Player } from '../rooms/schema/Player';
import { createEmptyBotInput } from '../rooms/playerRuntime';

type BotMovementLodRoom = {
  stepServerOwnedBotMovementLodProxy(player: Player, input: PlayerInput, stepSeconds: number): boolean;
  stepServerOwnedBotKinematicMovementProxy(player: Player, input: PlayerInput, stepSeconds: number): boolean;
  consumeServerOwnedBotMovementFullStepBudget(
    aliveBotCount: number,
    simulationTier?: 'critical' | 'near' | 'background'
  ): boolean;
  doesServerOwnedBotMovementInputRequireCriticalFullRate(input: PlayerInput): boolean;
  shouldScheduleBotPlanningForTier(
    bot: Player,
    tier: 'critical' | 'near' | 'background',
    aliveBotCount: number
  ): boolean;
  getBotPerceptionLineOfSightCandidateLimit(
    aliveBotCount: number,
    simulationTier: 'critical' | 'near' | 'background'
  ): number;
  continueDeferredBotInput(botId: string, now: number, simulationTier?: 'critical' | 'near' | 'background'): void;
  shouldServerOwnedBotMovementReasonBypassBudget(
    reason: string,
    tier: 'critical' | 'near' | 'background',
    input: PlayerInput
  ): boolean;
  state: { tick: number; serverTime: number; players: Map<string, Player> };
  tickProfiler: { recordCounter(name: string, count?: number): void };
  botsWithReusedInputThisTick: Set<string>;
  botMovementFullStepBudgetTick: number;
  botMovementFullStepBudgetRemaining: number;
  clampToPlayableMap(position: { x: number; y: number; z: number }): { x: number; y: number; z: number };
  getProceduralGroundY(position: { x: number; y: number; z: number }): number | null;
  getActiveSpeedMultiplier(player: Player): number;
  isFiniteVec3(position: { x: number; y: number; z: number }): boolean;
};

function createRoom(): BotMovementLodRoom {
  const room = Object.create(GameRoom.prototype) as BotMovementLodRoom;
  room.state = { tick: 0, serverTime: 1_800_000_000_000, players: new Map() };
  room.tickProfiler = { recordCounter: () => undefined };
  room.botsWithReusedInputThisTick = new Set();
  room.botMovementFullStepBudgetTick = -1;
  room.botMovementFullStepBudgetRemaining = Number.POSITIVE_INFINITY;
  room.clampToPlayableMap = (position) => ({ ...position });
  room.getProceduralGroundY = () => 0;
  room.getActiveSpeedMultiplier = () => 1;
  room.isFiniteVec3 = (position) => (
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Number.isFinite(position.z)
  );
  return room;
}

function createBot(room: BotMovementLodRoom): Player {
  const bot = new Player();
  bot.id = 'bot-lod';
  bot.name = 'bot-lod';
  bot.team = 'red';
  bot.heroId = 'phantom';
  bot.state = 'alive';
  bot.isBot = true;
  bot.maxHealth = 200;
  bot.health = 200;
  bot.position.x = 0;
  bot.position.z = 0;
  bot.position.y = PLAYER_HEIGHT / 2;
  bot.movement.isGrounded = true;
  room.state.players.set(bot.id, bot);
  return bot;
}

function botInput(bot: Player, overrides: Partial<PlayerInput> = {}): PlayerInput {
  return {
    ...createEmptyBotInput(1, bot, 1_800_000_000_000),
    lookYaw: 0,
    moveForward: true,
    sprint: true,
    ...overrides,
  };
}

{
  const room = createRoom();
  const bot = createBot(room);
  const moved = room.stepServerOwnedBotMovementLodProxy(
    bot,
    botInput(bot),
    SERVER_OWNED_MOVEMENT_STEP_SECONDS
  );

  assert.equal(moved, true);
  assert.ok(bot.position.z < -0.01, `expected forward proxy movement, got z=${bot.position.z}`);
  assert.equal(bot.velocity.y, 0);
  assert.equal(bot.movement.isGrounded, true);
  assert.equal(bot.movement.isSprinting, true);
}

{
  const room = createRoom();
  const bot = createBot(room);
  const moved = room.stepServerOwnedBotMovementLodProxy(
    bot,
    botInput(bot, { jump: true }),
    SERVER_OWNED_MOVEMENT_STEP_SECONDS
  );

  assert.equal(moved, true);
  assert.ok(bot.position.z < -0.01, `expected horizontal proxy movement while jump waits, got z=${bot.position.z}`);
}

{
  const room = createRoom();
  const bot = createBot(room);
  assert.equal(room.doesServerOwnedBotMovementInputRequireCriticalFullRate(botInput(bot, { ability1: true })), true);
  assert.equal(
    room.stepServerOwnedBotMovementLodProxy(bot, botInput(bot, { ability1: true }), SERVER_OWNED_MOVEMENT_STEP_SECONDS),
    false
  );
}

{
  const room = createRoom();
  room.state.tick = 77;
  for (let index = 0; index < 10; index++) {
    assert.equal(room.consumeServerOwnedBotMovementFullStepBudget(48), true);
  }
  assert.equal(room.consumeServerOwnedBotMovementFullStepBudget(48), false);
}

{
  const room = createRoom();
  const counters: string[] = [];
  room.tickProfiler = { recordCounter: (name) => counters.push(name) };
  room.state.tick = 88;
  assert.equal(room.consumeServerOwnedBotMovementFullStepBudget(48, 'near'), true);
  assert.ok(counters.includes('movement_bot_lod_budget_steps'));
  assert.ok(counters.includes('movement_bot_lod_budget_steps_near'));

  for (let index = 0; index < 9; index++) {
    assert.equal(room.consumeServerOwnedBotMovementFullStepBudget(48, 'background'), true);
  }
  assert.equal(room.consumeServerOwnedBotMovementFullStepBudget(48, 'background'), false);
  assert.ok(counters.includes('movement_bot_lod_budget_exhausted'));
  assert.ok(counters.includes('movement_bot_lod_budget_exhausted_background'));
}

{
  const room = createRoom();
  const bot = createBot(room);
  let scheduled = 0;
  for (let tick = 0; tick < 5; tick++) {
    room.state.tick = tick;
    if (room.shouldScheduleBotPlanningForTier(bot, 'background', 48)) scheduled++;
  }
  assert.equal(scheduled, 1, `expected one high-count background planning slot in 5 ticks, got ${scheduled}`);
}

{
  const room = createRoom();
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(8, 'critical'), Number.POSITIVE_INFINITY);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(8, 'near'), Number.POSITIVE_INFINITY);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(8, 'background'), Number.POSITIVE_INFINITY);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(24, 'critical'), 10);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(24, 'near'), 6);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(24, 'background'), 2);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(48, 'critical'), 8);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(48, 'near'), 4);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(48, 'background'), 1);
}

{
  const room = createRoom();
  const bot = createBot(room);
  bot.lastInput = botInput(bot, {
    primaryFire: true,
    secondaryFire: true,
    reload: true,
    ability1: true,
    ability2: true,
    ultimate: true,
    interact: true,
  });

  room.continueDeferredBotInput(bot.id, 1_800_000_000_000, 'background');

  assert.equal(bot.lastInput?.primaryFire, false);
  assert.equal(bot.lastInput?.secondaryFire, true);
  assert.equal(bot.lastInput?.reload, false);
  assert.equal(bot.lastInput?.ability1, false);
  assert.equal(bot.lastInput?.ability2, false);
  assert.equal(bot.lastInput?.ultimate, false);
  assert.equal(bot.lastInput?.interact, false);
}

{
  const room = createRoom();
  const bot = createBot(room);
  bot.lastInput = botInput(bot, { primaryFire: true });

  room.continueDeferredBotInput(bot.id, 1_800_000_000_000, 'near');

  assert.equal(bot.lastInput?.primaryFire, false);
}

{
  const room = createRoom();
  const bot = createBot(room);
  bot.lastInput = botInput(bot, { primaryFire: true });

  room.continueDeferredBotInput(bot.id, 1_800_000_000_000, 'critical');

  assert.equal(bot.lastInput?.primaryFire, true);
}

{
  const room = createRoom();
  const bot = createBot(room);
  bot.movement.isGrounded = false;
  bot.position.y = PLAYER_HEIGHT / 2 + 2;
  bot.velocity.z = -4;
  const moved = room.stepServerOwnedBotKinematicMovementProxy(
    bot,
    botInput(bot),
    SERVER_OWNED_MOVEMENT_STEP_SECONDS
  );

  assert.equal(moved, true);
  assert.ok(bot.position.z < -0.01, `expected airborne background proxy to preserve horizontal motion, got z=${bot.position.z}`);
  assert.ok(bot.position.y < PLAYER_HEIGHT / 2 + 2, `expected airborne background proxy to apply gravity, got y=${bot.position.y}`);
  assert.ok(bot.velocity.y < 0, `expected falling velocity, got vy=${bot.velocity.y}`);
  assert.equal(bot.movement.isGrounded, false);
}

{
  const room = createRoom();
  const bot = createBot(room);
  bot.movement.isGrounded = false;
  bot.position.y = PLAYER_HEIGHT / 2 + 0.02;
  bot.velocity.y = -1;
  const moved = room.stepServerOwnedBotKinematicMovementProxy(
    bot,
    botInput(bot, { moveForward: false, sprint: false }),
    SERVER_OWNED_MOVEMENT_STEP_SECONDS
  );

  assert.equal(moved, true);
  assert.equal(bot.position.y, PLAYER_HEIGHT / 2);
  assert.equal(bot.velocity.y, 0);
  assert.equal(bot.movement.isGrounded, true);
}

{
  const room = createRoom();
  const bot = createBot(room);
  assert.equal(
    room.shouldServerOwnedBotMovementReasonBypassBudget('movement_bot_lod_full_airborne', 'background', botInput(bot)),
    false
  );
  assert.equal(
    room.shouldServerOwnedBotMovementReasonBypassBudget('movement_bot_lod_full_airborne', 'critical', botInput(bot)),
    false
  );
  assert.equal(
    room.shouldServerOwnedBotMovementReasonBypassBudget(
      'movement_bot_lod_full_input',
      'critical',
      botInput(bot, { jump: true })
    ),
    false
  );
  assert.equal(
    room.shouldServerOwnedBotMovementReasonBypassBudget(
      'movement_bot_lod_full_input',
      'near',
      botInput(bot, { ability1: true })
    ),
    true
  );
}

console.log('bot movement LOD tests passed');
