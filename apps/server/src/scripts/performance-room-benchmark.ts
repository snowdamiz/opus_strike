import { performance } from 'node:perf_hooks';
import {
  DEFAULT_GAMEPLAY_MODE,
  HERO_DEFINITIONS,
  MOVEMENT_BUTTON_MOVE_FORWARD,
  MOVEMENT_BUTTON_MOVE_LEFT,
  MOVEMENT_BUTTON_SPRINT,
  movementButtonsToInputState,
  type PlayerMovementState,
  type MovementCommand,
  type BotDifficulty,
  type HeroId,
  type PackedPlayerTransform,
  type SelfMovementAuthority,
  type Team,
  type VoxelMapManifest,
} from '@voxel-strike/shared';
import {
  createVoxelCollisionWorld,
  simulateSharedMovement,
  type MovementTerrainAdapter,
  type SharedMovementSimulationResult,
} from '@voxel-strike/physics';
import { MovementCommandQueue } from '../rooms/MovementCommandQueue';
import { PlayerSpatialIndex } from '../rooms/PlayerSpatialIndex';
import { estimateCustomMessageBytes } from '../rooms/customMessageMetrics';
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
  };
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
      queue.dropOldest(Math.max(0, queue.length - 96));
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
        recentDamageSources: [],
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
    affectsRankedOrWager: false,
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
          players: Array.from({ length: playerCount }, (_, playerIndex) => ({
            id: `player-${playerIndex}`,
            name: `Player ${playerIndex}`,
            team: playerIndex < Math.ceil(playerCount / 2) ? 'red' : 'blue',
            heroId: playerIndex % 2 === 0 ? 'phantom' : 'chronos',
            state: 'alive',
            health: 180 - playerIndex,
            maxHealth: 225,
            ultimateCharge: (iteration + playerIndex) % 100,
            abilities: [
              { abilityId: 'primary', cooldownUntil: 0, charges: 1, isActive: false },
              { abilityId: 'utility', cooldownUntil: serverTime + 1200, charges: 2, isActive: playerIndex % 3 === 0 },
            ],
            hasFlag: playerIndex === 2,
          })),
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

const results = [
  runMovementQueueBenchmark(),
  runMovementSimulationBenchmark(),
  runSpatialBenchmark(),
  runBotAiBenchmark(8),
  runBotAiBenchmark(16),
  runBotAiBenchmark(24),
  runAntiCheatQueueBenchmark(),
  runCustomMessageTrackingBenchmark(12),
  runCustomMessageTrackingBenchmark(24),
  runCustomMessageTrackingBenchmark(48),
];

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  results,
}, null, 2));
