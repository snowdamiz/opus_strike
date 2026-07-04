import assert from 'node:assert/strict';
import {
  DEFAULT_GAMEPLAY_MODE,
  PLAYER_HEIGHT,
  type GameplayMode,
  type PlayerInput,
  type Team,
} from '@voxel-strike/shared';
import {
  createVoxelCollisionWorld,
  type MovementAabb,
  type MovementCollisionWorld,
} from '@voxel-strike/physics';
import {
  getBotSkillProfile,
  type BotSteeringChoice,
  type PlainVec2,
} from '../rooms/bot-ai';
import { SERVER_OWNED_MOVEMENT_STEP_SECONDS } from '../rooms/movementCommandDrain';
import { GameRoom } from '../rooms/GameRoom';
import { Player } from '../rooms/schema/Player';
import { createEmptyBotInput } from '../rooms/playerRuntime';
import { PlayerPressStateTracker } from '../rooms/playerPressState';

type BotMovementLodRoom = {
  stepServerOwnedBotMovementLodProxy(player: Player, input: PlayerInput, stepSeconds: number): boolean;
  stepServerOwnedBotKinematicMovementProxy(player: Player, input: PlayerInput, stepSeconds: number): boolean;
  getBotPlanningBudgets(scheduledBotCount: number): { urgentBudget: number; deferredBudget: number };
  consumeServerOwnedBotMovementFullStepBudget(
    aliveBotCount: number,
    simulationTier?: 'critical' | 'near' | 'background'
  ): boolean;
  getServerOwnedBotMovementFullStepBudget(aliveBotCount: number): number;
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
  chooseBotSteering(
    bot: Player,
    desiredMove: PlainVec2 | null,
    skill: ReturnType<typeof getBotSkillProfile>,
    frameContext: { steeringProbeChecksRemaining: number }
  ): { steering: BotSteeringChoice; directPathBlocked: boolean };
  continueDeferredBotInput(botId: string, now: number, simulationTier?: 'critical' | 'near' | 'background'): void;
  shouldServerOwnedBotMovementReasonBypassBudget(
    reason: string,
    tier: 'critical' | 'near' | 'background',
    input: PlayerInput
  ): boolean;
  isBattleRoyalPriorityBot(bot: Player, now: number): boolean;
  isServerOwnedBotNearBattleRoyalEnemy(bot: Player, distanceSq: number): boolean;
  isServerOwnedBotNearBattleRoyalDownedPlayer(bot: Player, distanceSq: number): boolean;
  suppressServerOwnedBotSkippedFullStepGameplayInput(input: PlayerInput): void;
  suppressServerOwnedBotHighCountFullStepAbilityInput(input: PlayerInput): void;
  shouldSuppressServerOwnedBotHighCountFullStepAbilityInput(
    simulationTier: 'critical' | 'near' | 'background'
  ): boolean;
  shouldProcessServerOwnedBotProxyGameplayInput(player: Player, input: PlayerInput): boolean;
  queryPlayersRadiusInto(
    position: { x: number; y: number; z: number },
    radius: number,
    results: Player[],
    options?: { team?: Team; excludeTeam?: Team; excludeId?: string; includeDowned?: boolean }
  ): void;
  state: { tick: number; serverTime: number; players: Map<string, Player> };
  gameplayMode: GameplayMode;
  tickProfiler: { recordCounter(name: string, count?: number): void };
  botRuntime: { getBrain(botId: string): undefined };
  botSteeringPathCache: Map<string, { clear: boolean; expiresAt: number; collisionRevision: number }>;
  botsWithReusedInputThisTick: Set<string>;
  playerPressStates: PlayerPressStateTracker;
  botSimulationHumanScratch: Player[];
  streamerManagedBotGame?: boolean;
  streamerFeedMode?: string | null;
  botMovementFullStepBudgetTick: number;
  botMovementFullStepBudgetRemaining: number;
  clampToPlayableMap(position: { x: number; y: number; z: number }): { x: number; y: number; z: number };
  getProceduralGroundY(position: { x: number; y: number; z: number }): number | null;
  getMovementCollisionRevision(now?: number): number;
  getMovementCollisionWorld(now?: number): MovementCollisionWorld;
  getActiveSpeedMultiplier(player: Player): number;
  isFiniteVec3(position: { x: number; y: number; z: number }): boolean;
};

function createCollisionWorld(aabbs: readonly MovementAabb[] = []): MovementCollisionWorld {
  return createVoxelCollisionWorld({
    collisionRevision: 1,
    getCollisionAabbs: () => aabbs,
  });
}

function createRoom(): BotMovementLodRoom {
  const room = Object.create(GameRoom.prototype) as BotMovementLodRoom;
  const collisionWorld = createCollisionWorld();
  room.state = { tick: 0, serverTime: 1_800_000_000_000, players: new Map() };
  room.gameplayMode = DEFAULT_GAMEPLAY_MODE;
  room.tickProfiler = { recordCounter: () => undefined };
  room.botRuntime = { getBrain: () => undefined };
  room.botSteeringPathCache = new Map();
  room.botsWithReusedInputThisTick = new Set();
  room.playerPressStates = new PlayerPressStateTracker();
  room.botSimulationHumanScratch = [];
  room.botMovementFullStepBudgetTick = -1;
  room.botMovementFullStepBudgetRemaining = Number.POSITIVE_INFINITY;
  room.clampToPlayableMap = (position) => ({ ...position });
  room.getProceduralGroundY = () => 0;
  room.getMovementCollisionRevision = () => 1;
  room.getMovementCollisionWorld = () => collisionWorld;
  room.getActiveSpeedMultiplier = () => 1;
  room.isFiniteVec3 = (position) => (
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Number.isFinite(position.z)
  );
  room.queryPlayersRadiusInto = (position, radius, results, options = {}) => {
    results.length = 0;
    const radiusSq = radius * radius;
    for (const player of room.state.players.values()) {
      if (options.excludeId && player.id === options.excludeId) continue;
      if (options.team && player.team !== options.team) continue;
      if (options.excludeTeam && player.team === options.excludeTeam) continue;
      if (!options.includeDowned && player.state !== 'alive') continue;
      const dx = player.position.x - position.x;
      const dy = player.position.y - position.y;
      const dz = player.position.z - position.z;
      if (dx * dx + dy * dy + dz * dz <= radiusSq) {
        results.push(player);
      }
    }
  };
  return room;
}

function enableStreamerBotDeathmatch(room: BotMovementLodRoom): void {
  room.streamerManagedBotGame = true;
  room.streamerFeedMode = 'bot_deathmatch';
}

function createBot(
  room: BotMovementLodRoom,
  options: Partial<{
    id: string;
    team: Team;
    heroId: string;
    isBot: boolean;
    state: string;
    x: number;
    y: number;
    z: number;
  }> = {}
): Player {
  const bot = new Player();
  bot.id = options.id ?? 'bot-lod';
  bot.name = bot.id;
  bot.team = options.team ?? 'red';
  bot.heroId = options.heroId ?? 'phantom';
  bot.state = options.state ?? 'alive';
  bot.isBot = options.isBot ?? true;
  bot.maxHealth = 200;
  bot.health = 200;
  bot.position.x = options.x ?? 0;
  bot.position.z = options.z ?? 0;
  bot.position.y = options.y ?? PLAYER_HEIGHT / 2;
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
  const wall = {
    min: { x: -4, y: 0, z: -0.95 },
    max: { x: 4, y: PLAYER_HEIGHT + 1, z: -0.75 },
  };
  const collisionWorld = createCollisionWorld([wall]);
  room.getMovementCollisionWorld = () => collisionWorld;
  const bot = createBot(room);
  bot.velocity.z = -20;
  const moved = room.stepServerOwnedBotMovementLodProxy(
    bot,
    botInput(bot),
    SERVER_OWNED_MOVEMENT_STEP_SECONDS
  );

  assert.equal(moved, true);
  assert.equal(bot.position.z, 0);
  assert.equal(bot.velocity.z, 0);
}

{
  const room = createRoom();
  const wall = {
    min: { x: -4, y: 0, z: -0.95 },
    max: { x: 4, y: PLAYER_HEIGHT + 1, z: -0.75 },
  };
  const collisionWorld = createCollisionWorld([wall]);
  room.getMovementCollisionWorld = () => collisionWorld;
  const bot = createBot(room);
  bot.movement.isGrounded = false;
  bot.velocity.z = -20;
  const moved = room.stepServerOwnedBotKinematicMovementProxy(
    bot,
    botInput(bot),
    SERVER_OWNED_MOVEMENT_STEP_SECONDS
  );

  assert.equal(moved, true);
  assert.equal(bot.position.z, 0);
  assert.equal(bot.velocity.z, 0);
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
  const wall = {
    min: { x: -8, y: 0, z: -3.4 },
    max: { x: 8, y: PLAYER_HEIGHT + 1, z: -2.2 },
  };
  const collisionWorld = createCollisionWorld([wall]);
  room.getMovementCollisionWorld = () => collisionWorld;
  const bot = createBot(room);
  const result = room.chooseBotSteering(
    bot,
    { x: 0, z: -1 },
    getBotSkillProfile('normal'),
    { steeringProbeChecksRemaining: 12 }
  );

  assert.equal(result.directPathBlocked, true);
  assert.equal(result.steering.blocked, true);
  assert.ok(
    result.steering.direction && result.steering.direction.z > -0.99,
    'expected terrain-aware steering to avoid the blocked direct route'
  );
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
  room.gameplayMode = 'battle_royal';
  room.state.tick = 80;
  for (let index = 0; index < 24; index++) {
    assert.equal(room.consumeServerOwnedBotMovementFullStepBudget(48, 'critical'), true);
  }
  assert.equal(room.consumeServerOwnedBotMovementFullStepBudget(48, 'critical'), false);
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
  enableStreamerBotDeathmatch(room);
  const bot = createBot(room);
  const planningBudgets = room.getBotPlanningBudgets(8);

  assert.equal(planningBudgets.urgentBudget, 8);
  assert.equal(planningBudgets.deferredBudget, 8);

  for (let tick = 0; tick < 6; tick++) {
    room.state.tick = tick;
    assert.equal(room.shouldScheduleBotPlanningForTier(bot, 'background', 48), true);
  }

  room.state.tick = 98;
  for (let index = 0; index < 12; index++) {
    assert.equal(room.consumeServerOwnedBotMovementFullStepBudget(48, 'background'), true);
  }

  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(48, 'background'), Number.POSITIVE_INFINITY);
  assert.equal(room.getBotLineOfSightFrameBudget(48), Number.POSITIVE_INFINITY);
  assert.equal(room.getBotSteeringProbeFrameBudget(48), Number.POSITIVE_INFINITY);
}

{
  const room = createRoom();
  room.gameplayMode = 'battle_royal';
  const planningBudgets = room.getBotPlanningBudgets(48);
  const smallPlanningBudgets = room.getBotPlanningBudgets(8);

  assert.equal(smallPlanningBudgets.urgentBudget, 8);
  assert.equal(smallPlanningBudgets.deferredBudget, 8);
  assert.equal(planningBudgets.urgentBudget, 48);
  assert.equal(planningBudgets.deferredBudget, 48);
  assert.equal(room.getServerOwnedBotMovementFullStepBudget(8), 12);
  assert.equal(room.getServerOwnedBotMovementFullStepBudget(24), 18);
  assert.equal(room.getServerOwnedBotMovementFullStepBudget(48), 24);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(48, 'critical'), 14);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(48, 'near'), 10);
  assert.equal(room.getBotPerceptionLineOfSightCandidateLimit(48, 'background'), 6);
  assert.equal(room.getBotLineOfSightFrameBudget(8), 48);
  assert.equal(room.getBotLineOfSightFrameBudget(24), 72);
  assert.equal(room.getBotLineOfSightFrameBudget(48), 96);
  assert.equal(room.getBotSteeringProbeFrameBudget(8), 48);
  assert.equal(room.getBotSteeringProbeFrameBudget(24), 72);
  assert.equal(room.getBotSteeringProbeFrameBudget(48), 96);
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
  room.gameplayMode = 'battle_royal';
  bot.team = 'br_01';
  bot.lastInput = botInput(bot, {
    interact: true,
    primaryFire: true,
    secondaryFire: true,
    ability1: true,
    ability2: true,
    ultimate: true,
  });

  room.continueDeferredBotInput(bot.id, 1_800_000_000_000, 'critical');

  assert.equal(bot.lastInput?.interact, true);
  assert.equal(bot.lastInput?.primaryFire, true);
  assert.equal(bot.lastInput?.secondaryFire, true);
  assert.equal(bot.lastInput?.ability1, false);
  assert.equal(bot.lastInput?.ability2, false);
  assert.equal(bot.lastInput?.ultimate, false);
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
  room.gameplayMode = 'battle_royal';
  const bot = createBot(room, { team: 'br_01' });
  const input = botInput(bot, {
    primaryFire: true,
    secondaryFire: true,
    ability1: true,
    ability2: true,
    ultimate: true,
    interact: true,
  });

  room.suppressServerOwnedBotSkippedFullStepGameplayInput(input);

  assert.equal(input.primaryFire, false);
  assert.equal(input.secondaryFire, false);
  assert.equal(input.ability1, false);
  assert.equal(input.ability2, false);
  assert.equal(input.ultimate, false);
  assert.equal(input.interact, true);
  assert.equal(room.shouldProcessServerOwnedBotProxyGameplayInput(bot, input), true);
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
  room.gameplayMode = 'battle_royal';
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
  assert.equal(input.interact, true);
}

{
  const room = createRoom();
  room.gameplayMode = 'battle_royal';
  for (let index = 0; index < 32; index++) {
    createBot(room, { id: `br-bot-${index}`, team: index === 0 ? 'br_01' : 'br_02' });
  }

  assert.equal(room.shouldSuppressServerOwnedBotHighCountFullStepAbilityInput('critical'), false);
  assert.equal(room.shouldSuppressServerOwnedBotHighCountFullStepAbilityInput('near'), true);
  assert.equal(room.shouldSuppressServerOwnedBotHighCountFullStepAbilityInput('background'), true);
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

{
  const room = createRoom();
  room.gameplayMode = 'battle_royal';
  const bot = createBot(room, { team: 'br_01', x: 0, z: 0 });
  createBot(room, { id: 'enemy-bot', team: 'br_02', x: 10, z: 0 });

  assert.equal(room.isServerOwnedBotNearBattleRoyalEnemy(bot, 24 * 24), true);
  assert.equal(room.isBattleRoyalPriorityBot(bot, 1_800_000_000_000), true);
}

{
  const room = createRoom();
  room.gameplayMode = 'battle_royal';
  const bot = createBot(room, { team: 'br_01', x: 0, z: 0 });
  createBot(room, { id: 'downed-enemy-bot', team: 'br_02', x: 8, z: 0, state: 'downed' });

  assert.equal(room.isServerOwnedBotNearBattleRoyalDownedPlayer(bot, 18 * 18), true);
}

{
  const room = createRoom();
  room.gameplayMode = 'battle_royal';
  const bot = createBot(room);
  assert.equal(
    room.shouldServerOwnedBotMovementReasonBypassBudget(
      'movement_bot_lod_full_input',
      'critical',
      botInput(bot, { interact: true })
    ),
    true
  );
  assert.equal(
    room.shouldServerOwnedBotMovementReasonBypassBudget(
      'movement_bot_lod_full_enemy_battle_royal',
      'critical',
      botInput(bot)
    ),
    true
  );
  assert.equal(
    room.shouldServerOwnedBotMovementReasonBypassBudget(
      'movement_bot_lod_full_input',
      'critical',
      botInput(bot, { ability1: true })
    ),
    true
  );
  assert.equal(
    room.shouldServerOwnedBotMovementReasonBypassBudget(
      'movement_bot_lod_full_airborne',
      'near',
      botInput(bot)
    ),
    false
  );
}

console.log('bot movement LOD tests passed');
