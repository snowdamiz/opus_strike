import assert from 'node:assert/strict';
import {
  PLAYER_HEIGHT,
  type PlayerInput,
} from '@voxel-strike/shared';
import { SERVER_OWNED_MOVEMENT_STEP_SECONDS } from '../rooms/movementCommandDrain';
import { GameRoom } from '../rooms/GameRoom';
import { Player } from '../rooms/schema/Player';
import { createEmptyBotInput } from '../rooms/playerRuntime';
import { PlayerPressStateTracker } from '../rooms/playerPressState';

type BotMovementLodRoom = {
  stepServerOwnedBotMovementLodProxy(player: Player, input: PlayerInput, stepSeconds: number): boolean;
  stepServerOwnedBotKinematicMovementProxy(player: Player, input: PlayerInput, stepSeconds: number): boolean;
  consumeServerOwnedBotMovementFullStepBudget(
    aliveBotCount: number,
    simulationTier?: 'critical' | 'near' | 'background'
  ): boolean;
  shouldScheduleBotPlanningForTier(
    bot: Player,
    tier: 'critical' | 'near' | 'background',
    aliveBotCount: number
  ): boolean;
  getBotPerceptionLineOfSightCandidateLimit(
    aliveBotCount: number,
    simulationTier: 'critical' | 'near' | 'background'
  ): number;
  getBotLineOfSightFrameBudget(aliveBotCount: number): number;
  getBotSteeringProbeFrameBudget(aliveBotCount: number): number;
  consumeBotLineOfSightFrameBudget(frameContext: { lineOfSightChecksRemaining: number }): boolean;
  consumeBotSteeringProbeFrameBudget(frameContext: { steeringProbeChecksRemaining: number }): boolean;
  continueDeferredBotInput(botId: string, now: number, simulationTier?: 'critical' | 'near' | 'background'): void;
  shouldServerOwnedBotMovementReasonBypassBudget(
    reason: string,
    tier: 'critical' | 'near' | 'background',
    input: PlayerInput
  ): boolean;
  suppressServerOwnedBotSkippedFullStepGameplayInput(input: PlayerInput): void;
  suppressServerOwnedBotHighCountFullStepAbilityInput(input: PlayerInput): void;
  shouldProcessServerOwnedBotProxyGameplayInput(player: Player, input: PlayerInput): boolean;
  state: { tick: number; serverTime: number; players: Map<string, Player> };
  tickProfiler: { recordCounter(name: string, count?: number): void };
  botsWithReusedInputThisTick: Set<string>;
  playerPressStates: PlayerPressStateTracker;
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
  room.playerPressStates = new PlayerPressStateTracker();
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
  assert.equal(
    room.stepServerOwnedBotMovementLodProxy(bot, botInput(bot, { ability1: true }), SERVER_OWNED_MOVEMENT_STEP_SECONDS),
    false
  );
}

{
  const room = createRoom();
  room.state.tick = 77;
  for (let index = 0; index < 3; index++) {
    assert.equal(room.consumeServerOwnedBotMovementFullStepBudget(8), true);
  }
  assert.equal(room.consumeServerOwnedBotMovementFullStepBudget(8), false);
}

{
  const room = createRoom();
  room.state.tick = 78;
  for (let index = 0; index < 2; index++) {
    assert.equal(room.consumeServerOwnedBotMovementFullStepBudget(24), true);
  }
  assert.equal(room.consumeServerOwnedBotMovementFullStepBudget(24), false);
}

{
  const room = createRoom();
  room.state.tick = 79;
  for (let index = 0; index < 1; index++) {
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

  assert.equal(room.consumeServerOwnedBotMovementFullStepBudget(48, 'background'), false);
  assert.ok(counters.includes('movement_bot_lod_budget_exhausted'));
  assert.ok(counters.includes('movement_bot_lod_budget_exhausted_background'));
}

{
  const room = createRoom();
  const bot = createBot(room);
  let scheduled = 0;
  for (let tick = 0; tick < 6; tick++) {
    room.state.tick = tick;
    if (room.shouldScheduleBotPlanningForTier(bot, 'background', 8)) scheduled++;
  }
  assert.ok(scheduled > 0 && scheduled < 6, `expected cadenced 8-bot background planning, got ${scheduled}`);
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
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(8, 'critical'), 5);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(8, 'near'), 4);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(8, 'background'), 2);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(24, 'critical'), 6);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(24, 'near'), 4);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(24, 'background'), 2);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(48, 'critical'), 5);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(48, 'near'), 3);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(48, 'background'), 1);
  assert.equal(room.getBotLineOfSightFrameBudget(7), Number.POSITIVE_INFINITY);
  assert.equal(room.getBotLineOfSightFrameBudget(8), 12);
  assert.equal(room.getBotLineOfSightFrameBudget(24), 14);
  assert.equal(room.getBotLineOfSightFrameBudget(48), 16);
  assert.equal(room.getBotSteeringProbeFrameBudget(7), Number.POSITIVE_INFINITY);
  assert.equal(room.getBotSteeringProbeFrameBudget(8), 12);
  assert.equal(room.getBotSteeringProbeFrameBudget(24), 14);
  assert.equal(room.getBotSteeringProbeFrameBudget(48), 16);

  const losFrame = { lineOfSightChecksRemaining: 1 };
  assert.equal(room.consumeBotLineOfSightFrameBudget(losFrame), true);
  assert.equal(losFrame.lineOfSightChecksRemaining, 0);
  assert.equal(room.consumeBotLineOfSightFrameBudget(losFrame), false);

  const steeringFrame = { steeringProbeChecksRemaining: 1 };
  assert.equal(room.consumeBotSteeringProbeFrameBudget(steeringFrame), true);
  assert.equal(steeringFrame.steeringProbeChecksRemaining, 0);
  assert.equal(room.consumeBotSteeringProbeFrameBudget(steeringFrame), false);
}

{
  const room = createRoom();
  const bot = createBot(room);
  bot.lastInput = botInput(bot, {
    jump: true,
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
  assert.equal(bot.lastInput?.secondaryFire, false);
  assert.equal(bot.lastInput?.jump, false);
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
  bot.lastInput = botInput(bot, { jump: true, primaryFire: true, secondaryFire: true });

  room.continueDeferredBotInput(bot.id, 1_800_000_000_000, 'critical');

  assert.equal(bot.lastInput?.primaryFire, true);
  assert.equal(bot.lastInput?.secondaryFire, true);
  assert.equal(bot.lastInput?.jump, true);
}

{
  const room = createRoom();
  const bot = createBot(room);
  const inertInput = botInput(bot, { moveForward: false, sprint: false });
  assert.equal(room.shouldProcessServerOwnedBotProxyGameplayInput(bot, inertInput), false);

  room.playerPressStates.applyInput(bot.id, {
    primaryFire: false,
    secondaryFire: true,
    reload: false,
    ability1: false,
    ability2: false,
    ultimate: false,
  });
  assert.equal(room.shouldProcessServerOwnedBotProxyGameplayInput(bot, inertInput), true);
  room.playerPressStates.reset(bot.id);
  assert.equal(
    room.shouldProcessServerOwnedBotProxyGameplayInput(bot, botInput(bot, { primaryFire: true })),
    true
  );
}

{
  const room = createRoom();
  const bot = createBot(room);
  const input = botInput(bot, {
    jump: true,
    primaryFire: true,
    secondaryFire: true,
    reload: true,
    ability1: true,
    ability2: true,
    ultimate: true,
    interact: true,
  });

  room.suppressServerOwnedBotSkippedFullStepGameplayInput(input);

  assert.equal(input.jump, true);
  assert.equal(input.moveForward, true);
  assert.equal(input.primaryFire, false);
  assert.equal(input.secondaryFire, false);
  assert.equal(input.reload, false);
  assert.equal(input.ability1, false);
  assert.equal(input.ability2, false);
  assert.equal(input.ultimate, false);
  assert.equal(input.interact, false);
  assert.equal(room.shouldProcessServerOwnedBotProxyGameplayInput(bot, input), false);
}

{
  const room = createRoom();
  const bot = createBot(room);
  const input = botInput(bot, {
    primaryFire: true,
    secondaryFire: true,
    ability1: true,
    ability2: true,
    ultimate: true,
    interact: true,
  });

  room.suppressServerOwnedBotHighCountFullStepAbilityInput(input);

  assert.equal(input.primaryFire, true);
  assert.equal(input.secondaryFire, true);
  assert.equal(input.ability1, false);
  assert.equal(input.ability2, false);
  assert.equal(input.ultimate, false);
  assert.equal(input.interact, false);
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
    false
  );
}

console.log('bot movement LOD tests passed');
