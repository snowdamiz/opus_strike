import assert from 'node:assert/strict';
import {
  buildBotBlackboard,
  buildTeamTactics,
  chooseBotAbilityPlan,
  chooseBotCombatPlan,
  chooseLocalAvoidanceDirection,
  createBotRouteGraphAdapter,
  getBotSkillProfile,
  planBotRoute,
  scoreBotIntents,
  type BotAbilityGeometry,
  type BotFlagSnapshot,
  type BotPlayerSnapshot,
  type BotRouteGraphAdapter,
  type BotTeamTactics,
  type PlainVec3,
} from '../rooms/bot-ai';
import type { BotDifficulty, HeroId, Team, VoxelMapManifest } from '@voxel-strike/shared';

const NOW = 10_000;

function vec(x: number, z: number, y = 1): PlainVec3 {
  return { x, y, z };
}

function ability(abilityId: string, charges = 1) {
  return {
    abilityId,
    cooldownRemaining: 0,
    charges,
    isActive: false,
    activatedAt: 0,
  };
}

function abilitiesFor(heroId: HeroId): BotPlayerSnapshot['abilities'] {
  switch (heroId) {
    case 'phantom':
      return {
        phantom_blink: ability('phantom_blink', 2),
        phantom_personal_shield: ability('phantom_personal_shield'),
        phantom_veil: ability('phantom_veil'),
      };
    case 'hookshot':
      return {
        hookshot_grapple: ability('hookshot_grapple'),
        hookshot_anchor_wall: ability('hookshot_anchor_wall'),
        hookshot_grapple_trap: ability('hookshot_grapple_trap'),
      };
    case 'blaze':
      return {
        blaze_flamethrower: ability('blaze_flamethrower'),
        blaze_rocketjump: ability('blaze_rocketjump'),
        blaze_airstrike: ability('blaze_airstrike'),
      };
    case 'chronos':
      return {
        chronos_lifeline_conduit: ability('chronos_lifeline_conduit', 3),
        chronos_timebreak: ability('chronos_timebreak'),
        chronos_ascendant_paradox: ability('chronos_ascendant_paradox'),
      };
  }
}

function player(options: {
  id: string;
  team: Team;
  heroId?: HeroId;
  x: number;
  z: number;
  health?: number;
  maxHealth?: number;
  isBot?: boolean;
  difficulty?: BotDifficulty;
  profile?: string;
  hasFlag?: boolean;
  ultimateCharge?: number;
}): BotPlayerSnapshot {
  const heroId = options.heroId ?? 'phantom';
  return {
    id: options.id,
    name: options.id,
    team: options.team,
    heroId,
    state: 'alive',
    isBot: options.isBot ?? true,
    botDifficulty: options.difficulty ?? 'normal',
    botProfileId: options.profile ?? options.id,
    position: vec(options.x, options.z),
    velocity: { x: 0, y: 0, z: 0 },
    lookYaw: 0,
    lookPitch: 0,
    health: options.health ?? options.maxHealth ?? 200,
    maxHealth: options.maxHealth ?? 200,
    ultimateCharge: options.ultimateCharge ?? 0,
    movement: {
      isGrounded: true,
      isSprinting: false,
      isCrouching: false,
      isSliding: false,
      isGrappling: false,
      isJetpacking: false,
      isGliding: false,
    },
    abilities: abilitiesFor(heroId),
    hasFlag: options.hasFlag ?? false,
    spawnProtectionUntil: 0,
  };
}

function flags(overrides: Partial<Record<Team, Partial<BotFlagSnapshot>>> = {}): Record<Team, BotFlagSnapshot> {
  return {
    red: {
      team: 'red',
      position: overrides.red?.position ?? vec(-40, 0),
      basePosition: overrides.red?.basePosition ?? vec(-40, 0),
      carrierId: overrides.red?.carrierId ?? '',
      isAtBase: overrides.red?.isAtBase ?? true,
      droppedAt: overrides.red?.droppedAt ?? 0,
    },
    blue: {
      team: 'blue',
      position: overrides.blue?.position ?? vec(40, 0),
      basePosition: overrides.blue?.basePosition ?? vec(40, 0),
      carrierId: overrides.blue?.carrierId ?? '',
      isAtBase: overrides.blue?.isAtBase ?? true,
      droppedAt: overrides.blue?.droppedAt ?? 0,
    },
  };
}

function tacticsFor(bot: BotPlayerSnapshot, players: BotPlayerSnapshot[], flagState = flags()): BotTeamTactics {
  return buildTeamTactics({
    now: NOW,
    revision: 1,
    players,
    flags: flagState,
  })[bot.team];
}

function blackboardFor(
  bot: BotPlayerSnapshot,
  players: BotPlayerSnapshot[],
  options: {
    flagState?: Record<Team, BotFlagSnapshot>;
    visibleEnemyIds?: string[];
    losEnemyIds?: string[];
    difficulty?: BotDifficulty;
  } = {}
) {
  const flagState = options.flagState ?? flags();
  return buildBotBlackboard({
    now: NOW,
    bot,
    players,
    flags: flagState,
    visibleEnemyIds: new Set(options.visibleEnemyIds ?? players.filter((candidate) => candidate.team !== bot.team).map((candidate) => candidate.id)),
    enemyLineOfSightIds: new Set(options.losEnemyIds ?? options.visibleEnemyIds ?? []),
    recentDamageSources: [],
    teamTactics: tacticsFor(bot, players, flagState),
    enemyMemory: new Map(),
    skill: getBotSkillProfile(options.difficulty ?? bot.botDifficulty),
  });
}

function defaultGeometry(overrides: Partial<BotAbilityGeometry> = {}): BotAbilityGeometry {
  return {
    directPathBlocked: false,
    movementProgressBlocked: false,
    blinkSafe: true,
    blinkDangerous: false,
    grappleAnchorAvailable: true,
    anchorWallProtectsAlly: false,
    anchorWallBlocksFriendlyCarrier: false,
    trapZoneValuable: false,
    ...overrides,
  };
}

function routeGraph(): BotRouteGraphAdapter {
  const manifest = {
    gameplay: {
      lanes: [
        { id: 'primary', kind: 'primary', nodeIds: ['red_base', 'mid', 'blue_flag'], width: 5, expectedDistance: 80, expectedTravelTimeSeconds: 10, label: 'Primary', coverDensityTarget: 0, verticalityBand: { minY: 0, maxY: 4 } },
        { id: 'flank', kind: 'flank', nodeIds: ['red_base', 'flank', 'blue_flag'], width: 5, expectedDistance: 88, expectedTravelTimeSeconds: 11, label: 'Flank', coverDensityTarget: 0, verticalityBand: { minY: 0, maxY: 4 } },
      ],
      routeGraph: {
        nodes: [
          { id: 'red_base', kind: 'base', position: vec(-40, 0), team: 'red', laneIds: ['primary', 'flank'], tags: ['base'] },
          { id: 'mid', kind: 'midfield', position: vec(0, 0), laneIds: ['primary'], tags: [] },
          { id: 'flank', kind: 'flank', position: vec(0, 24), laneIds: ['flank'], tags: [] },
          { id: 'blue_flag', kind: 'flag', position: vec(40, 0), team: 'blue', laneIds: ['primary', 'flank'], tags: ['flag'] },
        ],
        edges: [
          { id: 'edge_direct_a', from: 'red_base', to: 'mid', laneId: 'primary', distance: 40, expectedTravelTimeSeconds: 5, width: 5, traversal: 'ground', tags: [] },
          { id: 'edge_direct_b', from: 'mid', to: 'blue_flag', laneId: 'primary', distance: 40, expectedTravelTimeSeconds: 5, width: 5, traversal: 'ground', tags: [] },
          { id: 'edge_flank_a', from: 'red_base', to: 'flank', laneId: 'flank', distance: 46, expectedTravelTimeSeconds: 5.6, width: 5, traversal: 'ground', tags: [] },
          { id: 'edge_flank_b', from: 'flank', to: 'blue_flag', laneId: 'flank', distance: 46, expectedTravelTimeSeconds: 5.6, width: 5, traversal: 'ground', tags: [] },
        ],
        primaryRouteNodeIds: { red: ['red_base', 'mid', 'blue_flag'], blue: ['blue_flag', 'mid', 'red_base'] },
        fallbackAnchorNodeIds: { red: ['red_base'], blue: ['blue_flag'] },
      },
    },
    construction: { tacticalSlots: [] },
  } as unknown as VoxelMapManifest;
  const graph = createBotRouteGraphAdapter(manifest);
  assert.ok(graph);
  return graph;
}

function testTeamTacticsAssignments() {
  const redCarrier = player({ id: 'red-carrier', team: 'red', heroId: 'phantom', x: 10, z: 0, hasFlag: true });
  const redChronos = player({ id: 'red-chronos', team: 'red', heroId: 'chronos', x: 9, z: 1, profile: 'support-main' });
  const redDefender = player({ id: 'red-defender', team: 'red', heroId: 'blaze', x: -38, z: 2, profile: 'defender' });
  const redFighter = player({ id: 'red-fighter', team: 'red', heroId: 'hookshot', x: -4, z: 8 });
  const blueThreat = player({ id: 'blue-threat', team: 'blue', heroId: 'hookshot', x: 13, z: 0 });
  const flagState = flags({ blue: { carrierId: redCarrier.id, isAtBase: false, position: redCarrier.position } });
  const tactics = buildTeamTactics({ now: NOW, revision: 1, players: [redCarrier, redChronos, redDefender, redFighter, blueThreat], flags: flagState }).red;

  assert.equal(tactics.assignments[redCarrier.id].job, 'carry');
  assert.equal(tactics.assignments[redChronos.id].job, 'escort_carrier');
  assert.ok(Object.values(tactics.assignments).some((assignment) => assignment.job === 'defend_base'));
}

function testIntentScoring() {
  const bot = player({ id: 'red-hook', team: 'red', heroId: 'hookshot', x: -20, z: 0 });
  const carrier = player({ id: 'blue-carrier', team: 'blue', heroId: 'phantom', x: -5, z: 0, hasFlag: true });
  const flagState = flags({ red: { carrierId: carrier.id, isAtBase: false, position: carrier.position } });
  const blackboard = blackboardFor(bot, [bot, carrier], { flagState, visibleEnemyIds: [carrier.id] });
  const intent = scoreBotIntents(bot, blackboard, getBotSkillProfile('hard'));

  assert.equal(intent.type, 'intercept_enemy_carrier');
  assert.equal(intent.targetPlayerId, carrier.id);
}

function testRoutePlannerAvoidsBlockedEdge() {
  const bot = player({ id: 'red-runner', team: 'red', heroId: 'phantom', x: -40, z: 0 });
  const blackboard = blackboardFor(bot, [bot]);
  const intent = {
    ...scoreBotIntents(bot, blackboard, getBotSkillProfile('hard')),
    type: 'capture_enemy_flag' as const,
    targetPosition: vec(40, 0),
    reason: 'test capture route',
  };
  const blockedEdges = new Map<string, number>([
    ['edge_direct_a', NOW + 5000],
    ['edge_direct_b', NOW + 5000],
  ]);
  const plan = planBotRoute({
    now: NOW,
    bot,
    intent,
    blackboard,
    routeGraph: routeGraph(),
    blockedEdges,
    skill: getBotSkillProfile('hard'),
  });

  assert.ok(plan.pathNodeIds.includes('flank'), `expected flank route, got ${plan.pathNodeIds.join('>')}`);
}

function testLocalAvoidance() {
  const choice = chooseLocalAvoidanceDirection(
    { x: 1, z: 0 },
    [
      { label: 'direct', direction: { x: 1, z: 0 }, clear: false, distance: 2 },
      { label: 'left', direction: { x: 0.7, z: -0.7 }, clear: true, distance: 2 },
      { label: 'right', direction: { x: 0.7, z: 0.7 }, clear: false, distance: 2 },
    ],
    getBotSkillProfile('normal')
  );

  assert.equal(choice.blocked, true);
  assert.ok(choice.direction && choice.direction.z < 0, 'expected left tangent recovery');
}

function testChronosHealingThresholds() {
  const chronos = player({ id: 'chronos', team: 'red', heroId: 'chronos', x: 0, z: 0 });
  const scratched = player({ id: 'scratched', team: 'red', heroId: 'phantom', x: 4, z: 0, health: 190, maxHealth: 200 });
  const trivialBoard = blackboardFor(chronos, [chronos, scratched]);
  const trivialCombat = chooseBotCombatPlan({
    bot: chronos,
    intent: scoreBotIntents(chronos, trivialBoard, getBotSkillProfile('normal')),
    blackboard: trivialBoard,
    skill: getBotSkillProfile('normal'),
    primaryRange: 18,
    preferredRange: 13,
    protectedEnemyIds: new Set(),
  });
  const trivialPlan = chooseBotAbilityPlan({
    now: NOW,
    bot: chronos,
    intent: scoreBotIntents(chronos, trivialBoard, getBotSkillProfile('normal')),
    blackboard: trivialBoard,
    combatPlan: trivialCombat,
    skill: getBotSkillProfile('normal'),
    geometry: defaultGeometry(),
  });
  assert.notEqual(trivialPlan.mode, 'chronos_lifeline_allies');

  const hurtA = player({ id: 'hurt-a', team: 'red', heroId: 'phantom', x: 4, z: 0, health: 105, maxHealth: 200 });
  const hurtB = player({ id: 'hurt-b', team: 'red', heroId: 'hookshot', x: 5, z: 1, health: 120, maxHealth: 225 });
  const healBoard = blackboardFor(chronos, [chronos, hurtA, hurtB]);
  const healIntent = scoreBotIntents(chronos, healBoard, getBotSkillProfile('normal'));
  const healPlan = chooseBotAbilityPlan({
    now: NOW,
    bot: chronos,
    intent: healIntent,
    blackboard: healBoard,
    combatPlan: { targetId: null, stance: 'hold_cover', score: 0, reason: 'test' },
    skill: getBotSkillProfile('normal'),
    geometry: defaultGeometry(),
  });
  assert.equal(healPlan.mode, 'chronos_lifeline_allies');

  const lowChronos = {
    ...chronos,
    health: 60,
    abilities: {
      ...chronos.abilities,
      chronos_timebreak: {
        ...chronos.abilities.chronos_timebreak,
        cooldownRemaining: 3,
      },
    },
  };
  const pressure = player({ id: 'pressure', team: 'blue', heroId: 'hookshot', x: 5, z: 0 });
  const selfBoard = blackboardFor(lowChronos, [lowChronos, pressure], { visibleEnemyIds: [pressure.id] });
  const selfPlan = chooseBotAbilityPlan({
    now: NOW,
    bot: lowChronos,
    intent: scoreBotIntents(lowChronos, selfBoard, getBotSkillProfile('normal')),
    blackboard: selfBoard,
    combatPlan: { targetId: null, stance: 'retreat', score: 0, reason: 'test' },
    skill: getBotSkillProfile('normal'),
    geometry: defaultGeometry(),
  });
  assert.equal(selfPlan.mode, 'chronos_lifeline_self');
}

function testHeroAbilityControllers() {
  const enemy = player({ id: 'enemy', team: 'blue', heroId: 'phantom', x: 3, z: 0, health: 120, maxHealth: 200 });

  const phantom = player({ id: 'phantom', team: 'red', heroId: 'phantom', x: 0, z: 0 });
  const phantomBoard = blackboardFor(phantom, [phantom, enemy], { visibleEnemyIds: [enemy.id], losEnemyIds: [enemy.id] });
  const phantomIntent = scoreBotIntents(phantom, phantomBoard, getBotSkillProfile('normal'));
  const phantomPlan = chooseBotAbilityPlan({
    now: NOW,
    bot: phantom,
    intent: phantomIntent,
    blackboard: phantomBoard,
    combatPlan: { targetId: enemy.id, stance: 'strafe', score: 100, reason: 'test' },
    skill: getBotSkillProfile('normal'),
    geometry: defaultGeometry({ directPathBlocked: true, movementProgressBlocked: true, blinkSafe: true }),
  });
  assert.equal(phantomPlan.mode, 'phantom_blink');

  const hookshot = player({ id: 'hook', team: 'red', heroId: 'hookshot', x: -2, z: 0, ultimateCharge: 100 });
  const dropped = flags({ red: { isAtBase: false, carrierId: '', position: vec(-4, 0), droppedAt: NOW } });
  const hookBoard = blackboardFor(hookshot, [hookshot, enemy], { flagState: dropped, visibleEnemyIds: [enemy.id] });
  const hookPlan = chooseBotAbilityPlan({
    now: NOW,
    bot: hookshot,
    intent: scoreBotIntents(hookshot, hookBoard, getBotSkillProfile('hard')),
    blackboard: hookBoard,
    combatPlan: { targetId: enemy.id, stance: 'block', score: 100, reason: 'test' },
    skill: getBotSkillProfile('hard'),
    geometry: defaultGeometry({ trapZoneValuable: true }),
  });
  assert.equal(hookPlan.mode, 'hookshot_trap');

  const blaze = player({ id: 'blaze', team: 'red', heroId: 'blaze', x: 0, z: 0 });
  const blazeBoard = blackboardFor(blaze, [blaze, enemy], { visibleEnemyIds: [enemy.id], losEnemyIds: [enemy.id] });
  const blazePlan = chooseBotAbilityPlan({
    now: NOW,
    bot: blaze,
    intent: scoreBotIntents(blaze, blazeBoard, getBotSkillProfile('normal')),
    blackboard: blazeBoard,
    combatPlan: { targetId: enemy.id, stance: 'close', score: 120, reason: 'test' },
    skill: getBotSkillProfile('normal'),
    geometry: defaultGeometry(),
  });
  assert.equal(blazePlan.mode, 'blaze_flamethrower');
}

function testDifficultyChangesDecisionQuality() {
  const easyChronos = player({ id: 'easy-chronos', team: 'red', heroId: 'chronos', x: 0, z: 0, difficulty: 'easy' });
  const hardChronos = { ...easyChronos, id: 'hard-chronos', botDifficulty: 'hard' as const };
  const ally = player({ id: 'ally', team: 'red', heroId: 'phantom', x: 4, z: 0, health: 140, maxHealth: 200 });

  const easyBoard = blackboardFor(easyChronos, [easyChronos, ally], { difficulty: 'easy' });
  const hardBoard = blackboardFor(hardChronos, [hardChronos, ally], { difficulty: 'hard' });
  const easyPlan = chooseBotAbilityPlan({
    now: NOW,
    bot: easyChronos,
    intent: scoreBotIntents(easyChronos, easyBoard, getBotSkillProfile('easy')),
    blackboard: easyBoard,
    combatPlan: { targetId: null, stance: 'hold_cover', score: 0, reason: 'test' },
    skill: getBotSkillProfile('easy'),
    geometry: defaultGeometry(),
  });
  const hardPlan = chooseBotAbilityPlan({
    now: NOW,
    bot: hardChronos,
    intent: scoreBotIntents(hardChronos, hardBoard, getBotSkillProfile('hard')),
    blackboard: hardBoard,
    combatPlan: { targetId: null, stance: 'hold_cover', score: 0, reason: 'test' },
    skill: getBotSkillProfile('hard'),
    geometry: defaultGeometry(),
  });

  assert.equal(easyPlan.mode, 'chronos_lifeline_allies');
  assert.notEqual(hardPlan.mode, 'chronos_lifeline_allies');
}

function testNeutralAllBotOpenerPressuresFlag() {
  const redBots = [
    player({ id: 'red-phantom', team: 'red', heroId: 'phantom', x: -42, z: 0, profile: 'defender-alpha' }),
    player({ id: 'red-hook', team: 'red', heroId: 'hookshot', x: -40, z: 2, profile: 'defender-bravo' }),
    player({ id: 'red-chronos', team: 'red', heroId: 'chronos', x: -40, z: -2, profile: 'defender-charlie' }),
    player({ id: 'red-blaze', team: 'red', heroId: 'blaze', x: -43, z: 3, profile: 'defender-delta' }),
  ];
  const blueBots = [
    player({ id: 'blue-phantom', team: 'blue', heroId: 'phantom', x: 42, z: 0 }),
    player({ id: 'blue-hook', team: 'blue', heroId: 'hookshot', x: 40, z: -2 }),
    player({ id: 'blue-chronos', team: 'blue', heroId: 'chronos', x: 40, z: 2 }),
    player({ id: 'blue-blaze', team: 'blue', heroId: 'blaze', x: 43, z: -3 }),
  ];
  const players = [...redBots, ...blueBots];
  const flagState = flags();
  const tactics = buildTeamTactics({ now: NOW, revision: 1, players, flags: flagState }).red;
  const intents = redBots.map((bot) => scoreBotIntents(
    bot,
    blackboardFor(bot, players, { flagState, visibleEnemyIds: [], losEnemyIds: [] }),
    getBotSkillProfile('normal')
  ));

  assert.equal(Object.values(tactics.assignments).filter((assignment) => assignment.job === 'defend_base').length, 1);
  assert.ok(Object.values(tactics.assignments).filter((assignment) => assignment.job === 'run_flag').length >= 3);
  assert.equal(intents.filter((intent) => intent.type === 'defend_base').length, 1);
  assert.ok(intents.filter((intent) => intent.type === 'capture_enemy_flag').length >= 3);
}

function testUncontestedDefendersHoldControlUltimates() {
  const enemy = player({ id: 'far-enemy', team: 'blue', heroId: 'phantom', x: 40, z: 0 });
  const blaze = player({ id: 'blaze-defender', team: 'red', heroId: 'blaze', x: -40, z: 0, ultimateCharge: 100 });
  const hookshot = player({ id: 'hook-defender', team: 'red', heroId: 'hookshot', x: -40, z: 2, ultimateCharge: 100 });
  const flagState = flags();
  const defendIntent = {
    ...scoreBotIntents(blaze, blackboardFor(blaze, [blaze, enemy], { flagState, visibleEnemyIds: [], losEnemyIds: [] }), getBotSkillProfile('normal')),
    type: 'defend_base' as const,
    role: 'defender' as const,
    job: 'defend_base' as const,
    targetPosition: flagState.red.basePosition,
    reason: 'test empty base defense',
  };

  const blazePlan = chooseBotAbilityPlan({
    now: NOW,
    bot: blaze,
    intent: defendIntent,
    blackboard: blackboardFor(blaze, [blaze, enemy], { flagState, visibleEnemyIds: [], losEnemyIds: [] }),
    combatPlan: { targetId: null, stance: 'hold_cover', score: 0, reason: 'test' },
    skill: getBotSkillProfile('normal'),
    geometry: defaultGeometry(),
  });
  assert.notEqual(blazePlan.mode, 'blaze_airstrike');

  const hookPlan = chooseBotAbilityPlan({
    now: NOW,
    bot: hookshot,
    intent: defendIntent,
    blackboard: blackboardFor(hookshot, [hookshot, enemy], { flagState, visibleEnemyIds: [], losEnemyIds: [] }),
    combatPlan: { targetId: null, stance: 'hold_cover', score: 0, reason: 'test' },
    skill: getBotSkillProfile('normal'),
    geometry: defaultGeometry(),
  });
  assert.notEqual(hookPlan.mode, 'hookshot_trap');
}

function testContestedObjectiveStillSpendsControlUltimate() {
  const blaze = player({ id: 'blaze', team: 'red', heroId: 'blaze', x: -40, z: 0, ultimateCharge: 100 });
  const enemyA = player({ id: 'enemy-a', team: 'blue', heroId: 'phantom', x: -36, z: 0 });
  const enemyB = player({ id: 'enemy-b', team: 'blue', heroId: 'hookshot', x: -34, z: 2 });
  const flagState = flags();
  const board = blackboardFor(blaze, [blaze, enemyA, enemyB], {
    flagState,
    visibleEnemyIds: [enemyA.id, enemyB.id],
    losEnemyIds: [enemyA.id, enemyB.id],
  });
  const plan = chooseBotAbilityPlan({
    now: NOW,
    bot: blaze,
    intent: {
      ...scoreBotIntents(blaze, board, getBotSkillProfile('normal')),
      type: 'defend_base',
      role: 'defender',
      job: 'defend_base',
      targetPosition: flagState.red.basePosition,
      reason: 'test contested base',
    },
    blackboard: board,
    combatPlan: { targetId: null, stance: 'hold_cover', score: 0, reason: 'test' },
    skill: getBotSkillProfile('normal'),
    geometry: defaultGeometry(),
  });

  assert.equal(plan.mode, 'blaze_airstrike');
}

testTeamTacticsAssignments();
testIntentScoring();
testRoutePlannerAvoidsBlockedEdge();
testLocalAvoidance();
testChronosHealingThresholds();
testHeroAbilityControllers();
testDifficultyChangesDecisionQuality();
testNeutralAllBotOpenerPressuresFlag();
testUncontestedDefendersHoldControlUltimates();
testContestedObjectiveStillSpendsControlUltimate();

console.log('bot-ai-overhaul tests passed');
