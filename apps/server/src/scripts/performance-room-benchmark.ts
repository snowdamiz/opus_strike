import { performance } from 'node:perf_hooks';
import {
  DEFAULT_GAMEPLAY_MODE,
  createProceduralTerrainLookup,
  generateProceduralVoxelMap,
  getGameplayModeRules,
  getTeamIdsForGameplayMode,
  HERO_DEFINITIONS,
  MOVEMENT_BUTTON_MOVE_FORWARD,
  MOVEMENT_BUTTON_MOVE_LEFT,
  MOVEMENT_BUTTON_PRIMARY_FIRE,
  MOVEMENT_BUTTON_SECONDARY_FIRE,
  MOVEMENT_BUTTON_ABILITY_1,
  MOVEMENT_BUTTON_SPRINT,
  MOVEMENT_PROTOCOL_VERSION,
  MOVEMENT_SUBSTEP_MS,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  movementButtonsToInputState,
  type PlayerMovementState,
  type MovementCommand,
  type BotDifficulty,
  type GameplayMode,
  type HeroId,
  type MapProfileId,
  type PackedPlayerTransform,
  type PlayerInput,
  type SelfMovementAuthority,
  type Team,
  type VoxelMapSizeId,
  type VoxelMapManifest,
} from '@voxel-strike/shared';
import {
  canCapsuleOccupy,
  createVoxelCollisionWorld,
  simulateSharedMovement,
  type MovementCollisionWorld,
  type MovementTerrainAdapter,
  type SharedMovementSimulationResult,
} from '@voxel-strike/physics';
import { MovementCommandQueue } from '../rooms/MovementCommandQueue';
import { PlayerSpatialIndex } from '../rooms/PlayerSpatialIndex';
import { GameRoom } from '../rooms/GameRoom';
import { estimateCustomMessageBytes } from '../rooms/customMessageMetrics';
import type { RoomLoadSnapshot } from '../rooms/roomLoadSnapshot';
import { initializePlayerAbilities } from '../rooms/abilityHandlers';
import {
  buildBotBlackboard,
  buildTeamTactics,
  chooseBotAbilityPlan,
  chooseBotCombatPlan,
  createBotRouteGraphAdapter,
  getBotSkillProfile,
  planBotRoute,
  scoreBotIntents,
  type BotFlagSnapshot,
  type BotPlayerSnapshot,
  type PlainVec3,
} from '../rooms/bot-ai';
import { AntiCheatSignalPriorityQueue } from '../anticheat';
import { normalizeAntiCheatSignal } from '../anticheat/signal';
import { Player } from '../rooms/schema/Player';
import {
  advanceBattleRoyalDropState,
  createBattleRoyalDropState,
  setBattleRoyalDropPlayerInput,
  startBattleRoyalTeamDrop,
} from '../rooms/battleRoyalDrop';

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

function summarize(name: string, samples: number[]): Record<string, number | string> {
  samples.sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    name,
    iterations: samples.length,
    averageMs: total / Math.max(1, samples.length),
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    p99Ms: percentile(samples, 0.99),
    maxMs: samples[samples.length - 1] ?? 0,
  };
}

type BenchmarkSummaryValue = number | string | boolean | Record<string, number>;
type BenchmarkResult = Record<string, BenchmarkSummaryValue>;
type BenchmarkCase = {
  name: string;
  run: () => BenchmarkResult;
};

function topNumericEntries(values: Record<string, number>, limit = 3): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => Number.isFinite(value) && value > 0)
      .sort(([, left], [, right]) => right - left)
      .slice(0, limit)
  );
}

function command(seq: number, buttons = MOVEMENT_BUTTON_MOVE_FORWARD | MOVEMENT_BUTTON_SPRINT): MovementCommand {
  return {
    seq,
    buttons,
    lookYaw: Math.sin(seq / 30) * 0.45,
    lookPitch: 0,
    clientTimeMs: seq * (1000 / 60),
    movementEpoch: 0,
    collisionRevision: 1,
  };
}

function runMovementQueueBenchmark(): Record<string, number | string> {
  const samples: number[] = [];
  for (let iteration = 0; iteration < 600; iteration++) {
    const queue = new MovementCommandQueue(128);
    const startedAt = performance.now();
    for (let player = 0; player < 8; player++) {
      const base = player * 10000 + iteration * 128;
      for (let index = 0; index < 96; index++) {
        const jitter = index % 9 === 0 ? 1 : index % 11 === 0 ? -1 : 0;
        queue.push(command(base + index + jitter));
      }
      queue.discardOldest(Math.max(0, queue.length - 96));
      while (queue.pop()) {
        // Drain the queue to exercise head advancement.
      }
    }
    samples.push(performance.now() - startedAt);
  }
  return summarize('movement_queue_8_players_burst', samples);
}

function createMovementState(): PlayerMovementState {
  return {
    isGrounded: true,
    isSprinting: false,
    isCrouching: false,
    isSliding: false,
    slideTimeRemaining: 0,
    isWallRunning: false,
    wallRunSide: null,
    isGrappling: false,
    grapplePoint: null,
    isJetpacking: false,
    jetpackFuel: 100,
    isGliding: false,
  };
}

function runMovementSimulationBenchmark(): Record<string, number | string> {
  const terrain: MovementTerrainAdapter = {
    getGroundY: () => 0,
    clampPosition: (position) => ({
      x: Math.max(-90, Math.min(90, position.x)),
      y: Math.max(-20, Math.min(90, position.y)),
      z: Math.max(-90, Math.min(90, position.z)),
    }),
    getBlockAtWorld: (position) => (Math.abs(position.x - 10) < 0.7 && Math.abs(position.z) < 18 && position.y < 4 ? 1 : 0),
    cacheStaticAabbs: true,
    collisionRevision: 1,
  };
  const world = createVoxelCollisionWorld(terrain);
  const samples: number[] = [];
  const players: SharedMovementSimulationResult[] = Array.from({ length: 8 }, (_, index) => ({
    position: { x: -12 + index * 2, y: 0.9, z: index % 2 },
    velocity: { x: 0, y: 0, z: 0 },
    movement: createMovementState(),
  }));

  for (let iteration = 0; iteration < 420; iteration++) {
    const startedAt = performance.now();
    for (let playerIndex = 0; playerIndex < players.length; playerIndex++) {
      const state = players[playerIndex];
      const input = movementButtonsToInputState(
        MOVEMENT_BUTTON_MOVE_FORWARD |
        MOVEMENT_BUTTON_SPRINT |
        (iteration % 45 < 12 ? MOVEMENT_BUTTON_MOVE_LEFT : 0)
      );
      const result = simulateSharedMovement({
        position: state.position,
        velocity: state.velocity,
        movement: state.movement,
        heroStats: HERO_DEFINITIONS.phantom.stats,
        input,
        lookYaw: Math.sin((iteration + playerIndex) / 45) * 0.8,
        deltaTime: 1 / 60,
        terrain,
        collisionWorld: world,
      });
      players[playerIndex] = result;
    }
    samples.push(performance.now() - startedAt);
  }
  return summarize('shared_movement_8_players', samples);
}

function runSpatialBenchmark(): Record<string, number | string> {
  const index = new PlayerSpatialIndex(8);
  const players = Array.from({ length: 48 }, (_, itemIndex) => {
    const player = new Player();
    player.id = `player-${itemIndex}`;
    player.team = itemIndex % 2 === 0 ? 'red' : 'blue';
    player.state = 'alive';
    player.position.x = Math.cos(itemIndex) * 32;
    player.position.y = 1;
    player.position.z = Math.sin(itemIndex * 1.7) * 32;
    return player;
  });
  const out: Player[] = [];
  const samples: number[] = [];
  for (let iteration = 0; iteration < 800; iteration++) {
    const startedAt = performance.now();
    index.rebuild(players);
    for (let query = 0; query < 24; query++) {
      index.queryRadius({ x: Math.sin(query) * 22, z: Math.cos(query) * 22 }, 16, out, {
        team: query % 2 === 0 ? 'red' : 'blue',
      });
    }
    samples.push(performance.now() - startedAt);
  }
  return summarize('spatial_rebuild_and_queries', samples);
}

function createBattleRoyalDropBenchmarkInput(index: number, tick: number): PlayerInput {
  return {
    tick,
    moveForward: true,
    moveBackward: false,
    moveLeft: (tick + index) % 5 === 0,
    moveRight: (tick + index) % 7 === 0,
    jump: false,
    crouch: false,
    sprint: index % 2 === 0,
    primaryFire: false,
    secondaryFire: false,
    reload: false,
    ability1: false,
    ability2: false,
    ultimate: false,
    interact: false,
    lookYaw: Math.sin((tick + index) / 24) * 1.15,
    lookPitch: Math.sin((tick + index) / 31) * 0.35,
    timestamp: tick * ROOM_TICK_INTERVAL_MS,
  };
}

function runBattleRoyalDropBenchmark(): Record<string, BenchmarkSummaryValue> {
  const manifest = generateProceduralVoxelMap(424242, {
    profileId: 'battle_royal_large',
    mapSize: 'large',
  });
  const terrain = createProceduralTerrainLookup(manifest);
  const rules = getGameplayModeRules('battle_royal');
  const participants = Array.from({ length: 30 }, (_, index) => ({
    playerId: `drop-human-${index}`,
    team: getBenchmarkTeamForPlayer('battle_royal', index),
    isBot: false,
  }));
  const state = createBattleRoyalDropState(manifest, participants, 2_200_000_000_000);
  const teams = Array.from(state.teamPlayers.keys());
  const dropAt = state.dropStartsAt + 100;
  for (const team of teams) {
    startBattleRoyalTeamDrop(state, team, dropAt);
  }

  const samples: number[] = [];
  const warmupIterations = 40;
  const sampleIterations = 420;
  const totalIterations = warmupIterations + sampleIterations;
  let landedPlayers = 0;

  for (let iteration = 0; iteration < totalIterations; iteration++) {
    const now = dropAt + iteration * ROOM_TICK_INTERVAL_MS;
    let playerIndex = 0;
    for (const player of state.players.values()) {
      if (!player.attachedToPlayerId) {
        setBattleRoyalDropPlayerInput(state, player.playerId, createBattleRoyalDropBenchmarkInput(playerIndex, iteration));
      }
      playerIndex++;
    }

    const startedAt = performance.now();
    advanceBattleRoyalDropState({
      state,
      now,
      dt: ROOM_TICK_INTERVAL_MS / 1000,
      getGroundY: (position) => terrain.getGroundY(position),
      clampToPlayableMap: (position) => terrain.clampToPlayableMap(position),
    });
    if (iteration >= warmupIterations) {
      samples.push(performance.now() - startedAt);
    }
  }

  for (const player of state.players.values()) {
    if (player.status === 'landed') landedPlayers++;
  }

  return {
    ...summarize('battle_royal_drop_30_players_deployment', samples),
    players: state.players.size,
    teams: teams.length,
    maxTeamSize: rules.maxTeamSize,
    landedPlayers,
  };
}

function botVec(x: number, z: number, y = 1): PlainVec3 {
  return { x, y, z };
}

function botAbility(abilityId: string, charges = 1) {
  return {
    abilityId,
    cooldownRemaining: 0,
    charges,
    isActive: false,
    activatedAt: 0,
  };
}

function botAbilities(heroId: HeroId): BotPlayerSnapshot['abilities'] {
  if (heroId === 'chronos') {
    return {
      chronos_lifeline_conduit: botAbility('chronos_lifeline_conduit', 3),
      chronos_timebreak: botAbility('chronos_timebreak'),
      chronos_ascendant_paradox: botAbility('chronos_ascendant_paradox'),
    };
  }
  if (heroId === 'hookshot') {
    return {
      hookshot_grapple: botAbility('hookshot_grapple'),
      hookshot_anchor_wall: botAbility('hookshot_anchor_wall'),
      hookshot_ground_hooks: botAbility('hookshot_ground_hooks'),
    };
  }
  if (heroId === 'blaze') {
    return {
      blaze_flamethrower: botAbility('blaze_flamethrower'),
      blaze_rocketjump: botAbility('blaze_rocketjump'),
      blaze_airstrike: botAbility('blaze_airstrike'),
    };
  }
  return {
    phantom_blink: botAbility('phantom_blink', 2),
    phantom_personal_shield: botAbility('phantom_personal_shield'),
    phantom_veil: botAbility('phantom_veil'),
  };
}

function botSnapshot(id: string, team: Team, heroId: HeroId, x: number, z: number, difficulty: BotDifficulty): BotPlayerSnapshot {
  return {
    id,
    name: id,
    team,
    heroId,
    state: 'alive',
    isBot: true,
    botDifficulty: difficulty,
    botProfileId: id,
    position: botVec(x, z),
    velocity: { x: 0, y: 0, z: 0 },
    lookYaw: 0,
    lookPitch: 0,
    health: heroId === 'chronos' ? 240 : 185,
    maxHealth: heroId === 'chronos' ? 275 : 225,
    ultimateCharge: id.endsWith('0') ? 100 : 40,
    movement: {
      isGrounded: true,
      isSprinting: false,
      isCrouching: false,
      isSliding: false,
      isGrappling: false,
      isJetpacking: false,
      isGliding: false,
    },
    abilities: botAbilities(heroId),
    hasFlag: false,
    spawnProtectionUntil: 0,
  };
}

function botFlags(): Record<Team, BotFlagSnapshot> {
  return {
    red: {
      team: 'red',
      position: botVec(-42, 0),
      basePosition: botVec(-42, 0),
      carrierId: '',
      isAtBase: true,
      droppedAt: 0,
    },
    blue: {
      team: 'blue',
      position: botVec(42, 0),
      basePosition: botVec(42, 0),
      carrierId: '',
      isAtBase: true,
      droppedAt: 0,
    },
  };
}

function botBenchmarkRouteGraph() {
  const manifest = {
    gameplay: {
      lanes: [
        { id: 'primary', kind: 'primary', nodeIds: ['red_base', 'mid', 'blue_base'], width: 5, expectedDistance: 84, expectedTravelTimeSeconds: 10.5, label: 'Primary', coverDensityTarget: 0, verticalityBand: { minY: 0, maxY: 5 } },
        { id: 'flank_left', kind: 'flank', nodeIds: ['red_base', 'left', 'blue_base'], width: 4.5, expectedDistance: 96, expectedTravelTimeSeconds: 12, label: 'Left', coverDensityTarget: 0, verticalityBand: { minY: 0, maxY: 5 } },
        { id: 'flank_right', kind: 'flank', nodeIds: ['red_base', 'right', 'blue_base'], width: 4.5, expectedDistance: 96, expectedTravelTimeSeconds: 12, label: 'Right', coverDensityTarget: 0, verticalityBand: { minY: 0, maxY: 5 } },
      ],
      routeGraph: {
        nodes: [
          { id: 'red_base', kind: 'base', position: botVec(-42, 0), team: 'red', laneIds: ['primary', 'flank_left', 'flank_right'], tags: ['base'] },
          { id: 'mid', kind: 'midfield', position: botVec(0, 0), laneIds: ['primary'], tags: [] },
          { id: 'left', kind: 'flank', position: botVec(0, -25), laneIds: ['flank_left'], tags: [] },
          { id: 'right', kind: 'flank', position: botVec(0, 25), laneIds: ['flank_right'], tags: [] },
          { id: 'blue_base', kind: 'base', position: botVec(42, 0), team: 'blue', laneIds: ['primary', 'flank_left', 'flank_right'], tags: ['base'] },
        ],
        edges: [
          { id: 'e-primary-a', from: 'red_base', to: 'mid', laneId: 'primary', distance: 42, expectedTravelTimeSeconds: 5.2, width: 5, traversal: 'ground', tags: [] },
          { id: 'e-primary-b', from: 'mid', to: 'blue_base', laneId: 'primary', distance: 42, expectedTravelTimeSeconds: 5.2, width: 5, traversal: 'ground', tags: [] },
          { id: 'e-left-a', from: 'red_base', to: 'left', laneId: 'flank_left', distance: 49, expectedTravelTimeSeconds: 6, width: 4.5, traversal: 'ground', tags: [] },
          { id: 'e-left-b', from: 'left', to: 'blue_base', laneId: 'flank_left', distance: 49, expectedTravelTimeSeconds: 6, width: 4.5, traversal: 'ground', tags: [] },
          { id: 'e-right-a', from: 'red_base', to: 'right', laneId: 'flank_right', distance: 49, expectedTravelTimeSeconds: 6, width: 4.5, traversal: 'ground', tags: [] },
          { id: 'e-right-b', from: 'right', to: 'blue_base', laneId: 'flank_right', distance: 49, expectedTravelTimeSeconds: 6, width: 4.5, traversal: 'ground', tags: [] },
        ],
        primaryRouteNodeIds: { red: ['red_base', 'mid', 'blue_base'], blue: ['blue_base', 'mid', 'red_base'] },
        fallbackAnchorNodeIds: { red: ['red_base'], blue: ['blue_base'] },
      },
    },
    construction: { tacticalSlots: [] },
  } as unknown as VoxelMapManifest;
  return createBotRouteGraphAdapter(manifest);
}

function runBotAiBenchmark(botCount = 8): Record<string, number | string> {
  const graph = botBenchmarkRouteGraph();
  const flags = botFlags();
  const heroes: HeroId[] = ['phantom', 'hookshot', 'blaze', 'chronos'];
  const teamSize = botCount;
  const playerCount = botCount * 2;
  const players = Array.from({ length: playerCount }, (_, index) => {
    const team: Team = index < teamSize ? 'red' : 'blue';
    const offset = index % teamSize;
    return botSnapshot(
      `${team}-bot-${offset}`,
      team,
      heroes[offset % heroes.length],
      team === 'red' ? -36 + offset : 36 - offset,
      -14 + offset * 4,
      offset % 3 === 0 ? 'hard' : offset % 3 === 1 ? 'normal' : 'easy'
    );
  });
  const carrier = players[Math.min(players.length - 1, teamSize + 2)];
  carrier.hasFlag = true;
  flags.red.carrierId = carrier.id;
  flags.red.isAtBase = false;
  flags.red.position = carrier.position;

  const samples: number[] = [];
  const iterations = botCount <= 8 ? 280 : botCount <= 16 ? 180 : 120;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const startedAt = performance.now();
    const now = Date.now() + iteration * 33;
    const tactics = buildTeamTactics({ gameplayMode: DEFAULT_GAMEPLAY_MODE, now, revision: iteration, players, flags });
    const blockedEdges = new Map<string, number>(iteration % 4 === 0 ? [['e-primary-a', now + 1200]] : []);

    for (let botIndex = 0; botIndex < botCount; botIndex++) {
      const bot = players[botIndex];
      const skill = getBotSkillProfile(bot.botDifficulty);
      const visibleEnemyIds = new Set<string>();
      for (const player of players) {
        if (player.team !== bot.team) visibleEnemyIds.add(player.id);
      }
      const blackboard = buildBotBlackboard({
        now,
        gameplayMode: DEFAULT_GAMEPLAY_MODE,
        bot,
        players,
        flags,
        visibleEnemyIds,
        enemyLineOfSightIds: visibleEnemyIds,
        recentDamageSource: null,
        teamTactics: tactics[bot.team],
        enemyMemory: new Map(),
        skill,
      });
      const intent = scoreBotIntents(bot, blackboard, skill);
      const route = planBotRoute({ now, bot, intent, blackboard, routeGraph: graph, blockedEdges, skill });
      const combat = chooseBotCombatPlan({
        bot,
        intent,
        blackboard,
        skill,
        primaryRange: 30,
        protectedEnemyIds: new Set(),
      });
      chooseBotAbilityPlan({
        now,
        bot,
        intent,
        blackboard,
        combatPlan: combat,
        skill,
        geometry: {
          directPathBlocked: route.activeEdgeId ? blockedEdges.has(route.activeEdgeId) : false,
          movementProgressBlocked: false,
          blinkSafe: true,
          blinkDangerous: blackboard.nearbyEnemyCount >= 3,
          grappleAnchorAvailable: true,
          anchorWallProtectsAlly: blackboard.alliedCarrier !== null,
          anchorWallBlocksFriendlyCarrier: false,
          groundHooksValuable: blackboard.droppedFriendlyFlag !== null || blackboard.enemyCarrier !== null,
        },
      });
    }

    samples.push(performance.now() - startedAt);
  }
  return summarize(`bot_ai_${botCount}_bots_tactics_path_abilities`, samples);
}

function runAntiCheatQueueBenchmark(): Record<string, number | string> {
  const queue = new AntiCheatSignalPriorityQueue();
  const samples: number[] = [];
  const change = {
    userId: null,
    playerSessionId: null,
    scoreBefore: 0,
    scoreAfter: 0,
    scoreDelta: 0,
    integrityStatus: 'clean' as const,
    casePriority: null,
    shouldCreateCase: false,
    affectsRanked: false,
  };

  for (let iteration = 0; iteration < 600; iteration++) {
    const startedAt = performance.now();
    for (let index = 0; index < 500; index++) {
      const high = index % 97 === 0;
      queue.push({
        signal: normalizeAntiCheatSignal({
          eventType: high ? 'movement.critical' : 'movement.noise',
          category: 'movement',
          source: 'benchmark',
          roomId: 'benchmark-room',
          matchMode: 'ranked',
          severity: high ? 'critical' : 'low',
          confidence: high ? 1 : 0.35,
        }),
        change,
        queuedAt: Date.now(),
        resolve: () => undefined,
      }, high);
    }
    while (queue.shift()) {
      // Drain priority lanes.
    }
    samples.push(performance.now() - startedAt);
  }
  return summarize('anti_cheat_priority_queue_noise', samples);
}

interface CustomMessageMetricAccumulator {
  messages: number;
  recipients: number;
  bytes: number;
}

function trackCustomMessage(
  metrics: Map<string, CustomMessageMetricAccumulator>,
  type: string,
  payload: unknown,
  recipients: number
): void {
  const existing = metrics.get(type) ?? { messages: 0, recipients: 0, bytes: 0 };
  existing.messages++;
  existing.recipients += recipients;
  existing.bytes += estimateCustomMessageBytes(type, payload) * Math.max(1, recipients);
  metrics.set(type, existing);
}

function packedTransform(playerIndex: number, tick: number): PackedPlayerTransform {
  return [
    playerIndex + 1,
    Math.round((Math.sin((tick + playerIndex) / 12) * 24 + playerIndex) * 100),
    100,
    Math.round((Math.cos((tick + playerIndex) / 13) * 24 - playerIndex) * 100),
    Math.round(Math.sin(tick / 7) * 300),
    0,
    Math.round(Math.cos(tick / 9) * 300),
    Math.round(Math.sin(tick / 20) * 10000),
    0,
    playerIndex % 3 === 0 ? 2 : 1,
    0,
    0,
    playerIndex % 4 === 0 ? 100 : 0,
  ];
}

function selfMovementAuthority(seq: number, tick: number): SelfMovementAuthority {
  return {
    serverTick: tick,
    serverTime: tick * 50,
    ackSeq: seq,
    movementEpoch: 0,
    position: {
      x: Math.sin(tick / 12) * 18,
      y: 1,
      z: Math.cos(tick / 14) * 18,
    },
    velocity: {
      x: Math.sin(tick / 6) * 4,
      y: 0,
      z: Math.cos(tick / 8) * 4,
    },
    lookYaw: Math.sin(tick / 20),
    lookPitch: 0,
    movement: createMovementState(),
    collisionRevision: 1,
    chronosAegisActive: tick % 11 === 0,
    chronosAegisShieldRatio: tick % 11 === 0 ? 0.8 : 1,
  };
}

function runCustomMessageTrackingBenchmark(playerCount = 8): Record<string, number | string> {
  const samples: number[] = [];
  const recipientCount = Math.min(12, Math.max(4, Math.ceil(playerCount / 2)));
  const iterations = playerCount <= 12 ? 700 : playerCount <= 24 ? 460 : 280;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const metrics = new Map<string, CustomMessageMetricAccumulator>();
    const startedAt = performance.now();
    const tick = iteration;
    const serverTime = tick * 50;

    for (let recipient = 0; recipient < recipientCount; recipient++) {
      const visibleTransformCount = recipient < Math.ceil(recipientCount / 2)
        ? playerCount
        : Math.max(4, Math.floor(playerCount * 0.62));
      trackCustomMessage(metrics, 'playerTransformsV2', {
        version: 2,
        tick,
        serverTime,
        streamEpoch: 1,
        players: Array.from({ length: visibleTransformCount }, (_, playerIndex) => packedTransform(playerIndex, tick)),
        hiddenPlayerIds: recipient < Math.ceil(recipientCount / 2) ? [] : ['enemy-hidden-1', 'enemy-hidden-2'],
      }, 1);

      trackCustomMessage(metrics, 'selfMovementAuthority', selfMovementAuthority(tick * 3 + recipient, tick), 1);

      if (iteration % 5 === 0) {
        trackCustomMessage(metrics, 'playerVitals', {
          tick,
          serverTime,
          players: Array.from({ length: playerCount }, (_, playerIndex) => {
            const heroId = playerIndex % 2 === 0 ? 'phantom' : 'chronos';
            const maxHealth = HERO_DEFINITIONS[heroId].stats.maxHealth;

            return {
              id: `player-${playerIndex}`,
              name: `Player ${playerIndex}`,
              team: playerIndex < Math.ceil(playerCount / 2) ? 'red' : 'blue',
              heroId,
              state: 'alive',
              health: Math.max(1, Math.min(maxHealth, maxHealth - playerIndex)),
              maxHealth,
              ultimateCharge: (iteration + playerIndex) % 100,
              abilities: [
                { abilityId: 'primary', cooldownUntil: 0, charges: 1, isActive: false },
                { abilityId: 'utility', cooldownUntil: serverTime + 1200, charges: 2, isActive: playerIndex % 3 === 0 },
              ],
              hasFlag: playerIndex === 2,
            };
          }),
          removedPlayerIds: [],
        }, 1);
      }

      if (iteration % 10 === 0) {
        trackCustomMessage(metrics, 'playerInterest', {
          tick,
          serverTime,
          players: Array.from({ length: playerCount }, (_, playerIndex) => ({
            playerId: `player-${playerIndex}`,
            state: playerIndex === recipient || playerIndex < Math.ceil(playerCount / 2) ? 'visible' : 'last_known',
            reason: playerIndex < Math.ceil(playerCount / 2) ? 'team' : 'line_of_sight',
            expiresAt: playerIndex < Math.ceil(playerCount / 2) ? undefined : serverTime + 600,
            lastKnownPosition: playerIndex < Math.ceil(playerCount / 2)
              ? undefined
              : { x: playerIndex * 4, y: 1, z: -playerIndex * 3 },
          })),
        }, 1);
      }

      if (iteration % 20 === 0) {
        trackCustomMessage(metrics, 'playerPings', {
          serverTime,
          players: Array.from({ length: playerCount }, (_, playerIndex) => ({
            playerId: `player-${playerIndex}`,
            pingMs: playerIndex === recipient || playerIndex < Math.ceil(playerCount / 2) ? 12 + playerIndex : null,
          })),
        }, 1);
      }
    }

    if (iteration % 20 === 0) {
      trackCustomMessage(metrics, 'matchSnapshot', {
        tick,
        serverTime,
        phase: 'playing',
        redScore: iteration % 3,
        blueScore: (iteration + 1) % 3,
        roundTimeRemaining: Math.max(0, 600 - iteration),
        phaseEndTime: serverTime + 120000,
        mapSeed: 123456,
        mapThemeId: null,
      }, recipientCount);
    }

    samples.push(performance.now() - startedAt);
  }

  return summarize(`replication_payload_${playerCount}_players_stream_mix`, samples);
}

interface BenchmarkClient {
  sessionId: string;
  lastPingNonce: string | null;
  sentMessages: number;
  send(type: string, payload: unknown): void;
  leave(): void;
}

interface GameRoomTickScenarioOptions {
  name: string;
  humanCount: number;
  botCount: number;
  gameplayMode?: GameplayMode;
  mapProfileId?: MapProfileId;
  mapSize?: VoxelMapSizeId;
  burstMovement?: boolean;
  clusteredCombat?: boolean;
}

const ROOM_TICK_INTERVAL_MS = 50;
const ROOM_TICK_BUDGET_P99_MS = 20;
const ROOM_TICK_BUDGET_MAX_MS = 50;
const ROOM_TICK_WARMUP_ITERATIONS = 40;
const ROOM_TICK_SAMPLE_ITERATIONS = 220;
const ROOM_TICK_HEROES: HeroId[] = ['phantom', 'hookshot', 'blaze', 'chronos'];
const CLUSTERED_COMBAT_SPACING_METERS = PLAYER_RADIUS * 2 + 1.6;
const CLUSTERED_COMBAT_SEARCH_STEP_METERS = 2.25;
const CLUSTERED_COMBAT_MAX_SEARCH_RADIUS_METERS = 34;

function getBenchmarkTeamForPlayer(gameplayMode: GameplayMode, playerIndex: number): Team {
  const rules = getGameplayModeRules(gameplayMode);
  const teamIds = getTeamIdsForGameplayMode(gameplayMode).slice(0, rules.maxTeams);
  if (teamIds.length === 0) return 'red';

  if (gameplayMode === 'battle_royal') {
    return teamIds[Math.floor(playerIndex / rules.maxTeamSize) % teamIds.length] ?? teamIds[0] ?? 'red';
  }

  return teamIds[playerIndex % teamIds.length] ?? 'red';
}

function createBenchmarkClient(sessionId: string): BenchmarkClient {
  return {
    sessionId,
    lastPingNonce: null,
    sentMessages: 0,
    send(type: string, payload: unknown): void {
      this.sentMessages++;
      if (
        type === 'playerPingRequest' &&
        payload &&
        typeof payload === 'object' &&
        typeof (payload as { nonce?: unknown }).nonce === 'string'
      ) {
        this.lastPingNonce = (payload as { nonce: string }).nonce;
      }
    },
    leave(): void {
      // Fake benchmark clients never own transport resources.
    },
  };
}

function installBenchmarkRoomHost(room: GameRoom, roomId: string): void {
  const roomHost = room as unknown as {
    roomId: string;
    autoDispose: boolean;
    setMetadata: (metadata: Record<string, unknown>) => void;
    broadcast: (type: string, payload: unknown) => void;
    clients: BenchmarkClient[];
  };
  roomHost.roomId = roomId;
  roomHost.autoDispose = false;
  roomHost.setMetadata = () => undefined;
  roomHost.broadcast = (_type: string, _payload: unknown) => {
    for (const client of roomHost.clients) {
      client.send(_type, _payload);
    }
  };
}

function cleanupBenchmarkRoom(room: GameRoom): void {
  const roomAny = room as unknown as {
    tickInterval?: ReturnType<typeof setInterval> | null;
    matchStartCancelTimeout?: ReturnType<typeof setTimeout> | null;
    matchCancelDisconnectTimeout?: ReturnType<typeof setTimeout> | null;
    _autoDisposeTimeout?: ReturnType<typeof setTimeout> | null;
    _patchInterval?: ReturnType<typeof setInterval> | null;
    eventLoopDelay?: { disable(): void } | null;
    roomTimeouts?: { clear(): void };
    clock?: { clear(): void };
  };

  if (roomAny.tickInterval) {
    clearInterval(roomAny.tickInterval);
    roomAny.tickInterval = null;
  }
  if (roomAny.matchStartCancelTimeout) {
    clearTimeout(roomAny.matchStartCancelTimeout);
    roomAny.matchStartCancelTimeout = null;
  }
  if (roomAny.matchCancelDisconnectTimeout) {
    clearTimeout(roomAny.matchCancelDisconnectTimeout);
    roomAny.matchCancelDisconnectTimeout = null;
  }
  if (roomAny._autoDisposeTimeout) {
    clearTimeout(roomAny._autoDisposeTimeout);
    roomAny._autoDisposeTimeout = null;
  }
  if (roomAny._patchInterval) {
    clearInterval(roomAny._patchInterval);
    roomAny._patchInterval = null;
  }
  roomAny.eventLoopDelay?.disable();
  roomAny.roomTimeouts?.clear();
  roomAny.clock?.clear();
}

function addBenchmarkPlayer(input: {
  room: GameRoom;
  id: string;
  name: string;
  team: Team;
  heroId: HeroId;
  isBot: boolean;
  index: number;
  now: number;
  clientsById: Map<string, BenchmarkClient>;
}): Player {
  const roomAny = input.room as unknown as {
    clients: BenchmarkClient[];
    clientRegistry: { setClient(playerId: string, client: BenchmarkClient): void };
    replicationState: { markKnownPlayer(playerId: string): void };
    initializePressState(playerId: string): void;
    assignPlayerSpawnPosition(player: Player): void;
    resetPrimaryMagazineForHero(playerId: string, heroId: string): void;
  };
  const heroDef = HERO_DEFINITIONS[input.heroId];
  const player = new Player();
  player.id = input.id;
  player.name = input.name;
  player.team = input.team;
  player.heroId = input.heroId;
  player.state = 'alive';
  player.isReady = true;
  player.isBot = input.isBot;
  player.botDifficulty = input.isBot ? (input.index % 3 === 0 ? 'hard' : input.index % 3 === 1 ? 'normal' : 'easy') : '';
  player.botProfileId = input.isBot ? input.id : '';
  player.maxHealth = heroDef.stats.maxHealth;
  player.health = player.maxHealth;
  player.ultimateCharge = input.index % 5 === 0 ? 100 : 35;
  player.spawnProtectionUntil = 0;
  initializePlayerAbilities(player, input.heroId);
  roomAny.assignPlayerSpawnPosition(player);
  if (input.heroId === 'phantom' || input.heroId === 'blaze') {
    roomAny.resetPrimaryMagazineForHero(player.id, input.heroId);
  }

  input.room.state.players.set(player.id, player);
  roomAny.replicationState.markKnownPlayer(player.id);
  roomAny.initializePressState(player.id);

  if (!input.isBot) {
    const client = createBenchmarkClient(player.id);
    roomAny.clients.push(client);
    roomAny.clientRegistry.setClient(player.id, client);
    input.clientsById.set(player.id, client);
  }

  return player;
}

function getBenchmarkMovementCollisionWorld(room: GameRoom, now: number): MovementCollisionWorld {
  return (room as unknown as {
    getMovementCollisionWorld(now?: number): MovementCollisionWorld;
  }).getMovementCollisionWorld(now);
}

function getInvalidBenchmarkPlayerPlacements(room: GameRoom, now: number): string[] {
  const world = getBenchmarkMovementCollisionWorld(room, now);
  const invalidPlayerIds: string[] = [];
  for (const player of room.state.players.values()) {
    if (player.state !== 'alive') continue;
    if (!canCapsuleOccupy(world, player.position, PLAYER_HEIGHT, PLAYER_RADIUS)) {
      invalidPlayerIds.push(player.id);
    }
  }
  return invalidPlayerIds;
}

function createClusteredCombatSearchOffsets(): Array<{ x: number; z: number }> {
  const offsets: Array<{ x: number; z: number }> = [{ x: 0, z: 0 }];
  for (
    let radius = CLUSTERED_COMBAT_SEARCH_STEP_METERS;
    radius <= CLUSTERED_COMBAT_MAX_SEARCH_RADIUS_METERS;
    radius += CLUSTERED_COMBAT_SEARCH_STEP_METERS
  ) {
    const sampleCount = Math.max(8, Math.ceil((Math.PI * 2 * radius) / CLUSTERED_COMBAT_SPACING_METERS));
    for (let sample = 0; sample < sampleCount; sample++) {
      const angle = (sample / sampleCount) * Math.PI * 2;
      offsets.push({
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
      });
    }
  }
  return offsets;
}

function getClusteredCombatPosition(input: {
  room: GameRoom;
  collisionWorld: MovementCollisionWorld;
  anchor: { x: number; y: number; z: number };
  offset: { x: number; z: number };
}): { x: number; y: number; z: number } | null {
  const roomAny = input.room as unknown as {
    getProceduralGroundY(position: { x: number; y: number; z: number }): number | null;
  };
  const x = input.anchor.x + input.offset.x;
  const z = input.anchor.z + input.offset.z;
  const groundY = roomAny.getProceduralGroundY({
    x,
    y: input.anchor.y + 48,
    z,
  });
  if (groundY === null) return null;

  const position = {
    x,
    y: groundY + PLAYER_HEIGHT / 2 + 0.12,
    z,
  };
  return canCapsuleOccupy(input.collisionWorld, position, PLAYER_HEIGHT, PLAYER_RADIUS)
    ? position
    : null;
}

function placeBenchmarkPlayersInCombatCluster(room: GameRoom, now: number): void {
  const roomAny = room as unknown as {
    updateLastSafeMovement(player: Player, sequence: number, acceptedAt?: number): void;
  };
  const players = Array.from(room.state.players.values()).filter((player) => player.state === 'alive');
  const anchorPlayer = players.find((player) => !player.isBot) ?? players[0];
  if (!anchorPlayer) return;

  const collisionWorld = getBenchmarkMovementCollisionWorld(room, now);
  const offsets = createClusteredCombatSearchOffsets();
  const positions: Array<{ x: number; y: number; z: number }> = [];

  for (const offset of offsets) {
    const position = getClusteredCombatPosition({
      room,
      collisionWorld,
      anchor: anchorPlayer.position,
      offset,
    });
    if (!position) continue;
    positions.push(position);
    if (positions.length >= players.length) break;
  }

  if (positions.length < players.length) {
    throw new Error(`clustered combat placement found ${positions.length}/${players.length} valid positions`);
  }

  for (let index = 0; index < players.length; index++) {
    const player = players[index];
    const position = positions[index];
    if (!player || !position) continue;
    const dx = anchorPlayer.position.x - position.x;
    const dz = anchorPlayer.position.z - position.z;
    player.position.x = position.x;
    player.position.y = position.y;
    player.position.z = position.z;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    player.lookYaw = index === 0 || Math.hypot(dx, dz) <= 0.001 ? 0 : Math.atan2(-dx, -dz);
    player.lookPitch = 0;
    player.movement.isGrounded = true;
    player.movement.isSprinting = false;
    player.movement.isSliding = false;
    player.movement.isGrappling = false;
    player.movement.isJetpacking = false;
    player.movement.isGliding = false;
    roomAny.updateLastSafeMovement(player, 0, now);
  }
}

function sustainBenchmarkCombatRoster(room: GameRoom): void {
  for (const player of room.state.players.values()) {
    player.state = 'alive';
    player.respawnTime = 0;
    player.spawnProtectionUntil = 0;
    player.health = player.maxHealth;
  }
}

function createBenchmarkRoomScenario(
  options: GameRoomTickScenarioOptions,
  now: number
): { room: GameRoom; clientsById: Map<string, BenchmarkClient>; humanIds: string[]; invalidSpawnCount: number } {
  const gameplayMode = options.gameplayMode ?? DEFAULT_GAMEPLAY_MODE;
  const rules = getGameplayModeRules(gameplayMode);
  const room = new GameRoom();
  installBenchmarkRoomHost(room, `benchmark-${options.name}`);
  room.onCreate({
    mapSeed: 424242,
    gameplayMode,
    mapProfileId: options.mapProfileId ?? rules.mapProfileId,
    mapSize: options.mapSize,
    requiredHumanPlayers: 0,
    reservedHumanPlayers: options.humanCount,
  });
  cleanupBenchmarkRoom(room);

  room.state.phase = 'playing';
  room.state.serverTime = now;
  room.state.roundStartTime = now;
  room.state.roundTimeRemaining = rules.roundTimeSeconds;
  room.state.phaseEndTime = now + rules.roundTimeSeconds * 1000;

  const clientsById = new Map<string, BenchmarkClient>();
  const humanIds: string[] = [];
  const createdPlayers: Array<{ player: Player; index: number }> = [];
  const totalPlayers = options.humanCount + options.botCount;
  for (let index = 0; index < totalPlayers; index++) {
    const isBot = index >= options.humanCount;
    const team = getBenchmarkTeamForPlayer(gameplayMode, index);
    const heroId = ROOM_TICK_HEROES[index % ROOM_TICK_HEROES.length];
    const id = isBot ? `bot-${index - options.humanCount}` : `human-${index}`;
    const player = addBenchmarkPlayer({
      room,
      id,
      name: isBot ? `Bot ${index - options.humanCount}` : `Human ${index}`,
      team,
      heroId,
      isBot,
      index,
      now,
      clientsById,
    });
    createdPlayers.push({ player, index });
    if (!isBot) humanIds.push(player.id);
  }

  const roomAny = room as unknown as {
    placeTeamsAtUniqueSpawns(reason?: string): void;
    updateLastSafeMovement(player: Player, sequence: number, acceptedAt?: number): void;
    botRuntime: { setBrain(playerId: string, brain: unknown): void };
    createBotBrain(player: Player, index: number): unknown;
  };
  roomAny.placeTeamsAtUniqueSpawns('spawn');
  if (options.clusteredCombat) {
    placeBenchmarkPlayersInCombatCluster(room, now);
  }

  for (const { player, index } of createdPlayers) {
    roomAny.updateLastSafeMovement(player, 0, now);
    if (player.isBot) {
      roomAny.botRuntime.setBrain(player.id, roomAny.createBotBrain(player, index));
    }
  }

  const invalidPlacements = getInvalidBenchmarkPlayerPlacements(room, now);
  if (invalidPlacements.length > 0) {
    throw new Error(`${options.name} invalidSpawnCount=${invalidPlacements.length} invalidPlayers=${invalidPlacements.join(',')}`);
  }

  return { room, clientsById, humanIds, invalidSpawnCount: invalidPlacements.length };
}

function enqueueBenchmarkHumanMovement(input: {
  room: GameRoom;
  clientsById: Map<string, BenchmarkClient>;
  humanIds: readonly string[];
  sequences: Map<string, number>;
  tickIndex: number;
  now: number;
  burstMovement: boolean;
  combatInputs: boolean;
}): void {
  const roomAny = input.room as unknown as {
    getMovementAuthority(playerId: string): { movementEpoch: number };
    getMovementCollisionRevision(now?: number): number;
    handleMovementCommandPacket(client: BenchmarkClient, packet: { protocolVersion: number; firstSeq: number; commands: MovementCommand[] }): void;
  };
  const commandCount = input.burstMovement && input.tickIndex % 24 === 0
    ? 8
    : 3;

  for (let playerIndex = 0; playerIndex < input.humanIds.length; playerIndex++) {
    const playerId = input.humanIds[playerIndex];
    const client = input.clientsById.get(playerId);
    if (!client) continue;

    const authority = roomAny.getMovementAuthority(playerId);
    const commands: MovementCommand[] = [];
    let seq = input.sequences.get(playerId) ?? 0;
    for (let index = 0; index < commandCount; index++) {
      seq = (seq + 1) >>> 0;
      let buttons = MOVEMENT_BUTTON_MOVE_FORWARD |
        MOVEMENT_BUTTON_SPRINT |
        ((input.tickIndex + playerIndex + index) % 16 < 5 ? MOVEMENT_BUTTON_MOVE_LEFT : 0);
      if (input.combatInputs) {
        buttons |= MOVEMENT_BUTTON_PRIMARY_FIRE;
        if ((input.tickIndex + playerIndex + index) % 17 === 0) {
          buttons |= MOVEMENT_BUTTON_SECONDARY_FIRE;
        }
        if ((input.tickIndex + playerIndex + index) % 29 === 0) {
          buttons |= MOVEMENT_BUTTON_ABILITY_1;
        }
      }
      commands.push({
        seq,
        buttons,
        lookYaw: Math.sin((input.tickIndex + playerIndex) / 18) * 0.9,
        lookPitch: 0,
        clientTimeMs: input.now + index * MOVEMENT_SUBSTEP_MS,
        movementEpoch: authority.movementEpoch,
        collisionRevision: roomAny.getMovementCollisionRevision(input.now),
      });
    }
    input.sequences.set(playerId, seq);
    roomAny.handleMovementCommandPacket(client, {
      protocolVersion: MOVEMENT_PROTOCOL_VERSION,
      firstSeq: commands[0]?.seq ?? seq,
      commands,
    });
  }
}

function markBenchmarkCombatInterest(room: GameRoom, now: number): void {
  const roomAny = room as unknown as {
    replicationState: {
      markRecentCombatTransform(playerId: string, now: number, durationMs: number): void;
      markRecentCombatInterest(sourceId: string, targetId: string, now: number, durationMs: number): void;
    };
  };
  const players = Array.from(room.state.players.values());
  for (let index = 0; index < players.length; index++) {
    const player = players[index];
    if (index % 3 === 0) {
      roomAny.replicationState.markRecentCombatTransform(player.id, now, 650);
    }
    const target = players[(index + 3) % players.length];
    if (target && target.team !== player.team) {
      roomAny.replicationState.markRecentCombatInterest(player.id, target.id, now, 900);
    }
  }
}

function respondToBenchmarkPings(input: {
  room: GameRoom;
  clientsById: Map<string, BenchmarkClient>;
}): void {
  const roomAny = input.room as unknown as {
    handlePlayerPingResponse(client: BenchmarkClient, data: { nonce: string }): void;
  };
  for (const client of input.clientsById.values()) {
    if (!client.lastPingNonce) continue;
    roomAny.handlePlayerPingResponse(client, { nonce: client.lastPingNonce });
    client.lastPingNonce = null;
  }
}

function runGameRoomTickBenchmark(options: GameRoomTickScenarioOptions): Record<string, BenchmarkSummaryValue> {
  const originalDateNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  const samples: number[] = [];
  let firstTickMs = 0;
  let warmupMaxMs = 0;
  let room: GameRoom | null = null;
  let lastP99SpikeSpanName = '';
  let lastP99SpikeSpanMs = 0;
  let lastP99SpikeDurationMs = 0;
  let tickOverrun50Count = 0;
  let topSpanP99Ms: Record<string, number> = {};
  let topSpanMaxMs: Record<string, number> = {};
  let topOperationP99Counts: Record<string, number> = {};
  let topOperationMaxCounts: Record<string, number> = {};
  let topOperationTotalCounts: Record<string, number> = {};
  let tickOperationCounts: Record<string, number> = {};
  let invalidSpawnCount = 0;

  try {
    const scenario = createBenchmarkRoomScenario(options, now);
    room = scenario.room;
    invalidSpawnCount = scenario.invalidSpawnCount;
    const sequences = new Map<string, number>();
    const totalIterations = ROOM_TICK_WARMUP_ITERATIONS + ROOM_TICK_SAMPLE_ITERATIONS;

    for (let iteration = 0; iteration < totalIterations; iteration++) {
      if (options.clusteredCombat) {
        sustainBenchmarkCombatRoster(room);
      }
      enqueueBenchmarkHumanMovement({
        room,
        clientsById: scenario.clientsById,
        humanIds: scenario.humanIds,
        sequences,
        tickIndex: iteration,
        now,
        burstMovement: options.burstMovement === true,
        combatInputs: options.clusteredCombat === true,
      });
      if (iteration % 4 === 0) {
        markBenchmarkCombatInterest(room, now);
      }

      const startedAt = performance.now();
      (room as unknown as { tick(): void }).tick();
      const durationMs = performance.now() - startedAt;
      if (iteration === 0) firstTickMs = durationMs;
      if (iteration < ROOM_TICK_WARMUP_ITERATIONS) {
        warmupMaxMs = Math.max(warmupMaxMs, durationMs);
      }
      if (iteration >= ROOM_TICK_WARMUP_ITERATIONS) {
        samples.push(durationMs);
      }

      now += 16;
      respondToBenchmarkPings({
        room,
        clientsById: scenario.clientsById,
      });
      now += ROOM_TICK_INTERVAL_MS - 16;
    }

    const load = (room as unknown as { getRoomLoadSnapshot(): RoomLoadSnapshot }).getRoomLoadSnapshot();
    lastP99SpikeSpanName = load.tickLastP99SpikeSpanName;
    lastP99SpikeSpanMs = load.tickLastP99SpikeSpanMs;
    lastP99SpikeDurationMs = load.tickLastP99SpikeDurationMs;
    tickOverrun50Count = load.tickOverrun50Count;
    topSpanP99Ms = topNumericEntries(load.tickSpanP99Ms);
    topSpanMaxMs = topNumericEntries(load.tickSpanMaxMs);
    topOperationP99Counts = topNumericEntries(load.tickOperationCountP99, 10);
    topOperationMaxCounts = topNumericEntries(load.tickOperationCountMax, 10);
    topOperationTotalCounts = topNumericEntries(load.tickOperationCountTotal, 10);
    tickOperationCounts = load.tickOperationCounts;
  } finally {
    if (room) cleanupBenchmarkRoom(room);
    Date.now = originalDateNow;
  }

  const summary = summarize(options.name, samples) as Record<string, BenchmarkSummaryValue>;
  const p99Ms = typeof summary.p99Ms === 'number' ? summary.p99Ms : 0;
  const maxMs = typeof summary.maxMs === 'number' ? summary.maxMs : 0;
  summary.budgetP99Ms = ROOM_TICK_BUDGET_P99_MS;
  summary.budgetMaxMs = ROOM_TICK_BUDGET_MAX_MS;
  summary.firstTickMs = firstTickMs;
  summary.warmupMaxMs = warmupMaxMs;
  summary.budgetExceeded = p99Ms > ROOM_TICK_BUDGET_P99_MS || maxMs > ROOM_TICK_BUDGET_MAX_MS;
  summary.lastP99SpikeSpanName = lastP99SpikeSpanName;
  summary.lastP99SpikeSpanMs = lastP99SpikeSpanMs;
  summary.lastP99SpikeDurationMs = lastP99SpikeDurationMs;
  summary.tickOverrun50Count = tickOverrun50Count;
  summary.topSpanP99Ms = topSpanP99Ms;
  summary.topSpanMaxMs = topSpanMaxMs;
  summary.topOperationP99Counts = topOperationP99Counts;
  summary.topOperationMaxCounts = topOperationMaxCounts;
  summary.topOperationTotalCounts = topOperationTotalCounts;
  summary.tickOperationCounts = tickOperationCounts;
  summary.invalidSpawnCount = invalidSpawnCount;
  summary.humanCount = options.humanCount;
  summary.botCount = options.botCount;
  summary.clusteredCombat = options.clusteredCombat === true;
  summary.gameplayMode = options.gameplayMode ?? DEFAULT_GAMEPLAY_MODE;
  return summary;
}

const benchmarkCases: BenchmarkCase[] = [
  { name: 'movement_queue_8_players_burst', run: () => runMovementQueueBenchmark() },
  { name: 'shared_movement_8_players', run: () => runMovementSimulationBenchmark() },
  { name: 'spatial_rebuild_and_queries', run: () => runSpatialBenchmark() },
  { name: 'battle_royal_drop_30_players_deployment', run: () => runBattleRoyalDropBenchmark() },
  { name: 'bot_ai_8_bots_tactics_path_abilities', run: () => runBotAiBenchmark(8) },
  { name: 'bot_ai_16_bots_tactics_path_abilities', run: () => runBotAiBenchmark(16) },
  { name: 'bot_ai_24_bots_tactics_path_abilities', run: () => runBotAiBenchmark(24) },
  { name: 'anti_cheat_priority_queue_noise', run: () => runAntiCheatQueueBenchmark() },
  { name: 'replication_payload_12_players_stream_mix', run: () => runCustomMessageTrackingBenchmark(12) },
  { name: 'replication_payload_24_players_stream_mix', run: () => runCustomMessageTrackingBenchmark(24) },
  { name: 'replication_payload_48_players_stream_mix', run: () => runCustomMessageTrackingBenchmark(48) },
  {
    name: 'game_room_tick_8_players',
    run: () => runGameRoomTickBenchmark({ name: 'game_room_tick_8_players', humanCount: 8, botCount: 0 }),
  },
  {
    name: 'game_room_tick_40_players',
    run: () => runGameRoomTickBenchmark({ name: 'game_room_tick_40_players', humanCount: 40, botCount: 0 }),
  },
  {
    name: 'game_room_tick_40_players_burst',
    run: () => runGameRoomTickBenchmark({ name: 'game_room_tick_40_players_burst', humanCount: 40, botCount: 0, burstMovement: true }),
  },
  {
    name: 'game_room_tick_br_30_players',
    run: () => runGameRoomTickBenchmark({
      name: 'game_room_tick_br_30_players',
      gameplayMode: 'battle_royal',
      mapProfileId: 'battle_royal_large',
      mapSize: 'large',
      humanCount: 30,
      botCount: 0,
    }),
  },
  {
    name: 'game_room_tick_br_30_players_burst',
    run: () => runGameRoomTickBenchmark({
      name: 'game_room_tick_br_30_players_burst',
      gameplayMode: 'battle_royal',
      mapProfileId: 'battle_royal_large',
      mapSize: 'large',
      humanCount: 30,
      botCount: 0,
      burstMovement: true,
    }),
  },
  {
    name: 'game_room_tick_br_cluster_1_player_8_bots',
    run: () => runGameRoomTickBenchmark({
      name: 'game_room_tick_br_cluster_1_player_8_bots',
      gameplayMode: 'battle_royal',
      mapProfileId: 'battle_royal_large',
      mapSize: 'large',
      humanCount: 1,
      botCount: 8,
      burstMovement: true,
      clusteredCombat: true,
    }),
  },
  {
    name: 'game_room_tick_br_cluster_8_players_8_bots',
    run: () => runGameRoomTickBenchmark({
      name: 'game_room_tick_br_cluster_8_players_8_bots',
      gameplayMode: 'battle_royal',
      mapProfileId: 'battle_royal_large',
      mapSize: 'large',
      humanCount: 8,
      botCount: 8,
      burstMovement: true,
      clusteredCombat: true,
    }),
  },
  {
    name: 'game_room_tick_br_cluster_4_players_24_bots',
    run: () => runGameRoomTickBenchmark({
      name: 'game_room_tick_br_cluster_4_players_24_bots',
      gameplayMode: 'battle_royal',
      mapProfileId: 'battle_royal_large',
      mapSize: 'large',
      humanCount: 4,
      botCount: 24,
      burstMovement: true,
      clusteredCombat: true,
    }),
  },
  {
    name: 'game_room_tick_8_players_8_bots',
    run: () => runGameRoomTickBenchmark({ name: 'game_room_tick_8_players_8_bots', humanCount: 8, botCount: 8 }),
  },
  {
    name: 'game_room_tick_8_players_16_bots',
    run: () => runGameRoomTickBenchmark({ name: 'game_room_tick_8_players_16_bots', humanCount: 8, botCount: 16 }),
  },
  {
    name: 'game_room_tick_8_players_24_bots',
    run: () => runGameRoomTickBenchmark({ name: 'game_room_tick_8_players_24_bots', humanCount: 8, botCount: 24 }),
  },
  {
    name: 'game_room_tick_8_players_32_bots',
    run: () => runGameRoomTickBenchmark({ name: 'game_room_tick_8_players_32_bots', humanCount: 8, botCount: 32 }),
  },
  {
    name: 'game_room_tick_4_players_48_bots',
    run: () => runGameRoomTickBenchmark({ name: 'game_room_tick_4_players_48_bots', humanCount: 4, botCount: 48 }),
  },
  {
    name: 'game_room_tick_burst_alignment',
    run: () => runGameRoomTickBenchmark({ name: 'game_room_tick_burst_alignment', humanCount: 8, botCount: 8, burstMovement: true }),
  },
];

const benchmarkFilter = (process.env.ROOM_BENCH_FILTER ?? '').trim();
const benchmarkFilterParts = benchmarkFilter
  .split(',')
  .map((part) => part.trim())
  .filter(Boolean);
const selectedBenchmarkCases = benchmarkFilterParts.length === 0
  ? benchmarkCases
  : benchmarkCases.filter((benchmarkCase) => (
    benchmarkFilterParts.some((filterPart) => benchmarkCase.name.includes(filterPart))
  ));

if (selectedBenchmarkCases.length === 0) {
  throw new Error(`ROOM_BENCH_FILTER="${benchmarkFilter}" did not match any benchmark cases`);
}

const results = selectedBenchmarkCases.map((benchmarkCase) => benchmarkCase.run());

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  filter: benchmarkFilter || undefined,
  results,
}, null, 2));

if (results.some((result) => result.budgetExceeded === true)) {
  process.exitCode = 1;
}

process.exit(process.exitCode ?? 0);
