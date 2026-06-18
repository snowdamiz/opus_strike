import assert from 'node:assert/strict';
import type { PlayerInput } from '@voxel-strike/shared';
import {
  applyBotAbilityInputPlan,
  buildBotBlackboard,
  buildTeamTactics,
  chooseBotAbilityPlan,
  chooseBotCombatPlan,
  composeBotInputMovementState,
  chooseLocalAvoidanceDirection,
  composeBotMovementDirection,
  createInitialBotBrain,
  createBotRouteGraphAdapter,
  getBotAimReadinessTrace,
  getBotCombatEngagementState,
  getBotPredictedAimPoint,
  getBotLocomotionActionState,
  getBotSkillProfile,
  getBotYawPitchTowardPosition,
  isBotSecondaryFireWindowOpen,
  planBotRoute,
  scoreBotIntents,
  shouldRefreshBotPlanningState,
  updateBotAimState,
  updateBotPrimaryFireDecision,
  updateBotSecondaryFireDecision,
  updateBotMovementRecoveryState,
  updateBotPlanningState,
  type BotAbilityGeometry,
  type BotFlagSnapshot,
  type BotPlayerSnapshot,
  type BotRouteGraphAdapter,
  type BotRoutePlan,
  type BotTeamTactics,
  type PlainVec3,
} from '../rooms/bot-ai';
import { DEFAULT_GAMEPLAY_MODE, type BotDifficulty, type HeroId, type Team, type VoxelMapManifest } from '@voxel-strike/shared';

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
        hookshot_ground_hooks: ability('hookshot_ground_hooks'),
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
    gameplayMode: DEFAULT_GAMEPLAY_MODE,
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
    gameplayMode: DEFAULT_GAMEPLAY_MODE,
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
    groundHooksValuable: false,
    ...overrides,
  };
}

function randomSequence(values: number[]): () => number {
  return () => values.shift() ?? 0;
}

function assertClose(actual: number, expected: number, message: string): void {
  assert.ok(Math.abs(actual - expected) < 0.000001, `${message}: expected ${expected}, got ${actual}`);
}

function directRoutePlan(targetPosition: PlainVec3): BotRoutePlan {
  return {
    targetPosition,
    steeringTarget: targetPosition,
    pathNodeIds: [],
    nextNodeId: null,
    activeEdgeId: null,
    laneId: null,
    cost: 0,
    expandedNodes: 0,
    capped: false,
    reason: 'test direct route',
    plannedAt: NOW,
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
  const tactics = buildTeamTactics({
    gameplayMode: DEFAULT_GAMEPLAY_MODE,
    now: NOW,
    revision: 1,
    players: [redCarrier, redChronos, redDefender, redFighter, blueThreat],
    flags: flagState,
  }).red;

  assert.equal(tactics.assignments[redCarrier.id].job, 'carry');
  assert.equal(tactics.assignments[redChronos.id].job, 'escort_carrier');
  assert.ok(Object.values(tactics.assignments).some((assignment) => assignment.job === 'defend_base'));
}

function testBattleRoyalTacticsUseAllEnemySquads() {
  const alphaBot = player({ id: 'alpha-bot', team: 'br_01', heroId: 'hookshot', x: 0, z: 0 });
  const alphaAlly = player({ id: 'alpha-ally', team: 'br_01', heroId: 'chronos', x: 3, z: 0 });
  const bravoEnemy = player({ id: 'bravo-enemy', team: 'br_02', heroId: 'phantom', x: 24, z: 0, isBot: false });
  const charlieEnemy = player({ id: 'charlie-enemy', team: 'br_03', heroId: 'blaze', x: 10, z: 0 });
  const players = [alphaBot, alphaAlly, bravoEnemy, charlieEnemy];
  const tactics = buildTeamTactics({
    gameplayMode: 'battle_royal',
    now: NOW,
    revision: 1,
    players,
    flags: flags(),
  });

  assert.ok(tactics[alphaBot.team], 'battle royal tactics should be keyed by BR team id');
  assert.equal(tactics[alphaBot.team].assignments[alphaBot.id].targetPlayerId, charlieEnemy.id);

  const blackboard = buildBotBlackboard({
    now: NOW,
    gameplayMode: 'battle_royal',
    bot: alphaBot,
    players,
    flags: flags(),
    visibleEnemyIds: new Set([bravoEnemy.id, charlieEnemy.id]),
    enemyLineOfSightIds: new Set([charlieEnemy.id]),
    recentDamageSources: [],
    teamTactics: tactics[alphaBot.team],
    enemyMemory: new Map(),
    skill: getBotSkillProfile('normal'),
  });
  const enemyIds = blackboard.enemies.map((enemy) => enemy.player.id).sort();
  assert.deepEqual(enemyIds, [bravoEnemy.id, charlieEnemy.id].sort());
  assert.equal(blackboard.allies.length, 1);
  assert.equal(blackboard.nearestEnemy?.player.id, charlieEnemy.id);

  const intent = scoreBotIntents(alphaBot, blackboard, getBotSkillProfile('normal'));
  assert.equal(intent.type, 'fight_local_enemy');
  assert.equal(intent.targetPlayerId, charlieEnemy.id);
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

function testBotPlanningStateRefreshesAndReusesCachedState() {
  const bot = player({ id: 'red-runner', team: 'red', heroId: 'phantom', x: -40, z: 0 });
  const flagState = flags();
  const brain = createInitialBotBrain(bot.position);
  const skill = {
    ...getBotSkillProfile('normal'),
    thinkIntervalMs: 200,
    replanIntervalMs: 500,
  };
  const graph = routeGraph();
  const players = [bot];
  const teamTactics = tacticsFor(bot, players, flagState);
  assert.equal(shouldRefreshBotPlanningState(brain, NOW), true);

  const planned = updateBotPlanningState({
    brain,
    now: NOW,
    gameplayMode: DEFAULT_GAMEPLAY_MODE,
    bot,
    players,
    flags: flagState,
    visibleEnemyIds: new Set(),
    enemyLineOfSightIds: new Set(),
    recentDamageSources: [],
    teamTactics,
    routeGraph: graph,
    skill,
    random: randomSequence([0, 0]),
  });

  assert.equal(planned.blackboard, brain.blackboard);
  assert.equal(planned.routePlan, brain.routePlan);
  assert.equal(brain.nextBlackboardAt, NOW + 150);
  assert.equal(brain.nextThinkAt, NOW + 150);
  assert.equal(brain.strafeUntil, NOW + 900);
  assert.equal(brain.intent.type, 'capture_enemy_flag');

  const cachedBlackboard = planned.blackboard;
  const cachedRoutePlan = planned.routePlan;
  assert.equal(shouldRefreshBotPlanningState(brain, NOW + 50), false);
  const reused = updateBotPlanningState({
    brain,
    now: NOW + 50,
    gameplayMode: DEFAULT_GAMEPLAY_MODE,
    bot,
    players,
    flags: flagState,
    visibleEnemyIds: new Set(),
    enemyLineOfSightIds: new Set(),
    recentDamageSources: [],
    teamTactics,
    routeGraph: graph,
    skill,
    random: randomSequence([1, 1]),
  });

  assert.equal(reused.blackboard, cachedBlackboard);
  assert.equal(reused.routePlan, cachedRoutePlan);
  assert.equal(brain.nextBlackboardAt, NOW + 150);
  assert.equal(brain.nextThinkAt, NOW + 150);
  assert.equal(shouldRefreshBotPlanningState(brain, NOW + 150), true);
}

function testBotMovementRecoveryStateReplansBlockedEdges() {
  const bot = player({ id: 'red-runner', team: 'red', heroId: 'phantom', x: -40, z: 0 });
  const blackboard = blackboardFor(bot, [bot]);
  const brain = createInitialBotBrain(bot.position);
  const skill = {
    ...getBotSkillProfile('normal'),
    replanIntervalMs: 400,
    blockedEdgeTtlMs: 2_000,
  };
  brain.intent = {
    ...scoreBotIntents(bot, blackboard, skill),
    type: 'capture_enemy_flag',
    targetPosition: vec(40, 0),
    reason: 'test capture route',
  };
  brain.routePlan = {
    ...directRoutePlan(vec(40, 0)),
    activeEdgeId: 'edge_direct_a',
    pathNodeIds: ['red_base', 'mid', 'blue_flag'],
  };
  brain.movementProgress.desiredTarget = { x: 40, y: 1, z: 0 };
  brain.movementProgress.lastPosition = { ...bot.position };
  brain.movementProgress.lastDistanceToTarget = 80;
  brain.movementProgress.lastProgressAt = NOW - 800;

  const recovered = updateBotMovementRecoveryState({
    brain,
    now: NOW,
    bot,
    blackboard,
    routeGraph: routeGraph(),
    routePlan: brain.routePlan,
    desiredMove: { x: 1, z: 0 },
    steeringBlocked: true,
    skill,
    random: randomSequence([0]),
  });

  assert.equal(recovered.stalled, true);
  assert.equal(recovered.markBlockedEdgeId, 'edge_direct_a');
  assert.equal(brain.blockedEdges.get('edge_direct_a'), NOW + 2_000);
  assert.equal(brain.reverseUntil, NOW + 220);
  assert.ok(brain.routePlan?.pathNodeIds.includes('flank'), `expected flank replan, got ${brain.routePlan?.pathNodeIds.join('>')}`);
  assert.equal(recovered.routePlan, brain.routePlan);
}

function testBotMovementRecoveryStateKeepsRouteWhenProgressing() {
  const bot = player({ id: 'red-runner', team: 'red', heroId: 'phantom', x: -30, z: 0 });
  const blackboard = blackboardFor(bot, [bot]);
  const brain = createInitialBotBrain(bot.position);
  const skill = getBotSkillProfile('normal');
  brain.intent = {
    ...scoreBotIntents(bot, blackboard, skill),
    type: 'capture_enemy_flag',
    targetPosition: vec(40, 0),
    reason: 'test capture route',
  };
  brain.routePlan = directRoutePlan(vec(40, 0));
  brain.movementProgress.desiredTarget = { x: 40, y: 1, z: 0 };
  brain.movementProgress.lastPosition = vec(-40, 0);
  brain.movementProgress.lastDistanceToTarget = 80;
  brain.movementProgress.lastProgressAt = NOW - 800;

  const recovered = updateBotMovementRecoveryState({
    brain,
    now: NOW,
    bot,
    blackboard,
    routeGraph: routeGraph(),
    routePlan: brain.routePlan,
    desiredMove: { x: 1, z: 0 },
    steeringBlocked: true,
    skill,
    random: randomSequence([0]),
  });

  assert.equal(recovered.stalled, false);
  assert.equal(recovered.markBlockedEdgeId, null);
  assert.equal(brain.blockedEdges.size, 0);
  assert.equal(brain.reverseUntil, 0);
  assert.equal(recovered.routePlan, brain.routePlan);
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

function testBotPrimaryFireDecisionTiming() {
  const brain = createInitialBotBrain();
  const skill = {
    ...getBotSkillProfile('normal'),
    fireChance: 0.5,
    fireDecisionMs: [100, 100] as [number, number],
    burstDurationMs: [200, 200] as [number, number],
  };

  const firing = updateBotPrimaryFireDecision({
    brain,
    skill,
    now: NOW,
    aimReady: true,
    tempoMultiplier: 2,
    random: randomSequence([0, 0.2, 0]),
  });

  assert.equal(firing, true);
  assert.equal(brain.nextFireDecisionAt, NOW + 50);
  assert.equal(brain.fireUntil, NOW + 100);

  const notReadyBrain = createInitialBotBrain();
  const notReady = updateBotPrimaryFireDecision({
    brain: notReadyBrain,
    skill,
    now: NOW,
    aimReady: false,
    tempoMultiplier: 1,
    random: randomSequence([0]),
  });

  assert.equal(notReady, false);
  assert.equal(notReadyBrain.nextFireDecisionAt, NOW + 100);
  assert.equal(notReadyBrain.fireUntil, 0);
}

function testBotCombatEngagementState() {
  assert.deepEqual(getBotCombatEngagementState({
    hasCombatTarget: false,
    enemyDistance: 10,
    attackRange: 20,
    hasClearShot: true,
    targetProtected: false,
    primaryAimReady: true,
  }), {
    shouldFight: false,
    aimReady: false,
  });

  assert.deepEqual(getBotCombatEngagementState({
    hasCombatTarget: true,
    enemyDistance: 25,
    attackRange: 20,
    hasClearShot: true,
    targetProtected: false,
    primaryAimReady: true,
  }), {
    shouldFight: false,
    aimReady: false,
  });

  assert.deepEqual(getBotCombatEngagementState({
    hasCombatTarget: true,
    enemyDistance: 10,
    attackRange: 20,
    hasClearShot: false,
    targetProtected: false,
    primaryAimReady: true,
  }), {
    shouldFight: false,
    aimReady: false,
  });

  assert.deepEqual(getBotCombatEngagementState({
    hasCombatTarget: true,
    enemyDistance: 10,
    attackRange: 20,
    hasClearShot: true,
    targetProtected: true,
    primaryAimReady: true,
  }), {
    shouldFight: false,
    aimReady: false,
  });

  assert.deepEqual(getBotCombatEngagementState({
    hasCombatTarget: true,
    enemyDistance: 10,
    attackRange: 20,
    hasClearShot: true,
    targetProtected: false,
    primaryAimReady: false,
  }), {
    shouldFight: true,
    aimReady: false,
  });

  assert.deepEqual(getBotCombatEngagementState({
    hasCombatTarget: true,
    enemyDistance: 20,
    attackRange: 20,
    hasClearShot: true,
    targetProtected: false,
    primaryAimReady: true,
  }), {
    shouldFight: true,
    aimReady: true,
  });
}

function testBotAimLeadPrediction() {
  const skill = {
    ...getBotSkillProfile('normal'),
    aimLeadSeconds: 0.1,
    reactionMs: 100,
  };
  const aimPoint = getBotPredictedAimPoint({
    sourcePosition: vec(0, 0, 0),
    targetPosition: vec(16, 0, 1),
    targetVelocity: { x: 10, y: 2, z: -5 },
    targetDistance: 16,
    skill,
  });

  const leadSeconds = 0.1 + 16 / 160 - 0.1 * 0.45;
  assertClose(aimPoint.x, 16 + 10 * leadSeconds, 'predicted x lead');
  assertClose(aimPoint.y, 1 + 2 * leadSeconds, 'predicted y lead');
  assertClose(aimPoint.z, -5 * leadSeconds, 'predicted z lead');

  const upperClamp = getBotPredictedAimPoint({
    sourcePosition: vec(0, 0, 0),
    targetPosition: vec(0, 0, 0),
    targetVelocity: { x: 10, y: 0, z: 0 },
    targetDistance: 1_000,
    skill: { ...skill, aimLeadSeconds: 0.5, reactionMs: 0 },
  });
  assertClose(upperClamp.x, 4.2, 'lead clamps high');

  const lowerClamp = getBotPredictedAimPoint({
    sourcePosition: vec(0, 0, 0),
    targetPosition: vec(0, 0, 0),
    targetVelocity: { x: 0, y: 0, z: 10 },
    targetDistance: 0,
    skill: { ...skill, aimLeadSeconds: -0.5, reactionMs: 500 },
  });
  assertClose(lowerClamp.z, -2.2, 'lead clamps low');
}

function testBotYawPitchTowardPosition() {
  const aim = getBotYawPitchTowardPosition(
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 2, z: -10 }
  );
  assertClose(aim.yaw, 0, 'yaw faces negative z');
  assertClose(aim.pitch, Math.atan2(1, 10), 'pitch aims toward elevation');

  const clamped = getBotYawPitchTowardPosition(
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 100, z: -1 }
  );
  assert.equal(clamped.pitch, 0.8);
}

function testBotAimStateUpdate() {
  const skill = {
    ...getBotSkillProfile('normal'),
    aimErrorRadians: 0.1,
    aimJitterRefreshMs: [50, 50] as [number, number],
    turnRateRadians: 50,
  };
  const brain = createInitialBotBrain();
  brain.aimYaw = Number.NaN;
  brain.aimPitch = Number.NaN;

  const aimed = updateBotAimState({
    brain,
    skill,
    desiredAim: { yaw: 0.2, pitch: 0.3 },
    currentYaw: 0,
    currentPitch: 0,
    targetDistance: 24,
    now: NOW,
    dt: 0.1,
    random: randomSequence([1, 0.5, 0]),
  });

  assertClose(brain.aimJitterYaw, 0.1, 'target jitter yaw');
  assertClose(brain.aimJitterPitch, 0, 'target jitter pitch');
  assert.equal(brain.nextAimJitterAt, NOW + 50);
  assertClose(aimed.yaw, 0.3, 'aim yaw includes jitter');
  assertClose(aimed.pitch, 0.3, 'aim pitch follows desired pitch');

  const idleBrain = createInitialBotBrain();
  idleBrain.aimJitterYaw = 1;
  idleBrain.aimJitterPitch = -0.5;
  const idleAim = updateBotAimState({
    brain: idleBrain,
    skill,
    desiredAim: { yaw: 0, pitch: 0 },
    currentYaw: 0,
    currentPitch: 0,
    targetDistance: null,
    now: NOW,
    dt: 0.1,
  });

  assertClose(idleBrain.aimJitterYaw, 0.82, 'idle yaw jitter decays');
  assertClose(idleBrain.aimJitterPitch, -0.41, 'idle pitch jitter decays');
  assertClose(idleAim.yaw, 0.82, 'idle aim keeps decayed yaw jitter');
  assertClose(idleAim.pitch, -0.41, 'idle aim keeps decayed pitch jitter');
}

function testBotAimReadinessTrace() {
  const trace = getBotAimReadinessTrace({
    origin: { x: 1, y: 2, z: 3 },
    yaw: 0,
    pitch: 0,
    attackRange: 30,
    attackCollisionRadius: 0.25,
    hitboxPadding: 0.6,
    skill: { ...getBotSkillProfile('normal'), aimFireToleranceScale: 1.5 },
  });

  assert.deepEqual(trace.origin, { x: 1, y: 2, z: 3 });
  assert.equal(trace.range, 30);
  assertClose(trace.direction.x, 0, 'trace direction x');
  assertClose(trace.direction.y, 0, 'trace direction y');
  assertClose(trace.direction.z, -1, 'trace direction z');
  assertClose(trace.extraRadius, 0.55, 'readiness trace radius');
}

function testBotSecondaryFireDecisionTiming() {
  const skill = {
    ...getBotSkillProfile('normal'),
    secondaryChance: 0.5,
  };
  const secondaryAttack = { range: 42, cooldownMs: 1000 };
  const windowBrain = createInitialBotBrain();

  assert.equal(isBotSecondaryFireWindowOpen({
    brain: windowBrain,
    now: NOW,
    shouldFight: true,
    heroId: 'phantom',
    secondaryAttack,
    enemyDistance: 24,
  }), true);

  windowBrain.nextSecondaryAt = NOW + 1;
  assert.equal(isBotSecondaryFireWindowOpen({
    brain: windowBrain,
    now: NOW,
    shouldFight: true,
    heroId: 'phantom',
    secondaryAttack,
    enemyDistance: 24,
  }), false);

  assert.equal(isBotSecondaryFireWindowOpen({
    brain: createInitialBotBrain(),
    now: NOW,
    shouldFight: true,
    heroId: 'phantom',
    secondaryAttack,
    enemyDistance: 43,
  }), false);

  assert.equal(isBotSecondaryFireWindowOpen({
    brain: createInitialBotBrain(),
    now: NOW,
    shouldFight: true,
    heroId: 'blaze',
    secondaryAttack,
    enemyDistance: 24,
  }), false);

  const firedBrain = createInitialBotBrain();

  const fired = updateBotSecondaryFireDecision({
    brain: firedBrain,
    skill,
    now: NOW,
    shouldFight: true,
    heroId: 'phantom',
    secondaryAttack,
    enemyDistance: 24,
    aimReady: true,
    tempoMultiplier: 2,
    random: randomSequence([0.2, 0]),
  });

  assert.equal(fired, true);
  assert.equal(firedBrain.nextSecondaryAt, NOW + 425);

  const missedBrain = createInitialBotBrain();
  const missed = updateBotSecondaryFireDecision({
    brain: missedBrain,
    skill,
    now: NOW,
    shouldFight: true,
    heroId: 'phantom',
    secondaryAttack,
    enemyDistance: 24,
    aimReady: true,
    tempoMultiplier: 1,
    random: randomSequence([0.8, 0]),
  });

  assert.equal(missed, false);
  assert.equal(missedBrain.nextSecondaryAt, NOW + 350);

  const blockedBrain = createInitialBotBrain();
  blockedBrain.nextSecondaryAt = NOW + 123;
  const blocked = updateBotSecondaryFireDecision({
    brain: blockedBrain,
    skill,
    now: NOW,
    shouldFight: true,
    heroId: 'blaze',
    secondaryAttack,
    enemyDistance: 24,
    aimReady: true,
    tempoMultiplier: 1,
    random: randomSequence([0]),
  });

  assert.equal(blocked, false);
  assert.equal(blockedBrain.nextSecondaryAt, NOW + 123);
}

function testBotLocomotionActionState() {
  assert.deepEqual(getBotLocomotionActionState({
    botId: 'bot-a',
    position: vec(0, 0),
    hasFlag: false,
    isGrounded: true,
    previousCrouch: false,
    intentType: 'fight_local_enemy',
    steeringTarget: vec(8, 0),
    steeringJump: false,
    stalled: false,
    hasCombatTarget: true,
    now: 0,
  }), {
    sprint: false,
    jump: false,
    crouch: false,
    crouchPressed: false,
  });

  assert.deepEqual(getBotLocomotionActionState({
    botId: 'bot-a',
    position: vec(0, 0),
    hasFlag: false,
    isGrounded: true,
    previousCrouch: false,
    intentType: 'capture_enemy_flag',
    steeringTarget: vec(20, 0),
    steeringJump: false,
    stalled: false,
    hasCombatTarget: false,
    now: 1_500,
  }), {
    sprint: true,
    jump: false,
    crouch: true,
    crouchPressed: true,
  });

  assert.deepEqual(getBotLocomotionActionState({
    botId: 'bot-a',
    position: vec(0, 0),
    hasFlag: true,
    isGrounded: true,
    previousCrouch: true,
    intentType: 'fight_local_enemy',
    steeringTarget: vec(20, 0),
    steeringJump: false,
    stalled: true,
    hasCombatTarget: false,
    now: 1_500,
  }), {
    sprint: true,
    jump: true,
    crouch: true,
    crouchPressed: false,
  });
}

function testBotInputMovementState() {
  assert.deepEqual(composeBotInputMovementState({
    botId: 'bot-a',
    position: vec(0, 0),
    hasFlag: false,
    isGrounded: true,
    previousCrouch: false,
    intentType: 'fight_local_enemy',
    steeringTarget: vec(8, 0),
    steeringJump: false,
    stalled: false,
    hasCombatTarget: true,
    now: 0,
    lookYaw: 0,
    desiredMove: { x: 0, z: -1 },
    recovering: false,
    strafeDirection: 1,
  }), {
    moveForward: true,
    moveBackward: false,
    moveLeft: false,
    moveRight: false,
    sprint: false,
    jump: false,
    crouch: false,
    crouchPressed: false,
  });

  assert.deepEqual(composeBotInputMovementState({
    botId: 'bot-a',
    position: vec(0, 0),
    hasFlag: false,
    isGrounded: true,
    previousCrouch: false,
    intentType: 'capture_enemy_flag',
    steeringTarget: vec(20, 0),
    steeringJump: false,
    stalled: false,
    hasCombatTarget: false,
    now: 1_500,
    lookYaw: 0,
    desiredMove: { x: 1, z: 0 },
    recovering: true,
    strafeDirection: -1,
  }), {
    moveForward: false,
    moveBackward: true,
    moveLeft: true,
    moveRight: false,
    sprint: true,
    jump: false,
    crouch: true,
    crouchPressed: true,
  });

  assert.deepEqual(composeBotInputMovementState({
    botId: 'bot-a',
    position: vec(0, 0),
    hasFlag: false,
    isGrounded: false,
    previousCrouch: false,
    intentType: 'fight_local_enemy',
    steeringTarget: vec(0, 0),
    steeringJump: true,
    stalled: false,
    hasCombatTarget: false,
    now: 0,
    lookYaw: 0,
    desiredMove: { x: 0.1, z: 0.05 },
    recovering: false,
    strafeDirection: 1,
  }), {
    moveForward: false,
    moveBackward: false,
    moveLeft: false,
    moveRight: true,
    sprint: false,
    jump: true,
    crouch: false,
    crouchPressed: false,
  });
}

function testBotAbilityInputPlanApplication() {
  {
    const brain = createInitialBotBrain();
    brain.pendingSecondaryMode = 'blaze_bomb';
    brain.secondaryHoldUntil = NOW + 20;
    const input = { primaryFire: true } as PlayerInput;

    applyBotAbilityInputPlan({
      input,
      brain,
      plan: { mode: 'none', slot: null, score: 0, reason: 'test' },
      skill: getBotSkillProfile('normal'),
      now: NOW,
      tempoMultiplier: 1,
    });

    assert.equal(input.primaryFire, false);
    assert.equal(input.secondaryFire, true);
    assert.equal(brain.pendingSecondaryMode, 'blaze_bomb');
  }

  {
    const brain = createInitialBotBrain();
    brain.pendingSecondaryMode = 'blaze_bomb';
    brain.secondaryHoldUntil = NOW - 1;
    const input = { secondaryFire: true } as PlayerInput;

    applyBotAbilityInputPlan({
      input,
      brain,
      plan: { mode: 'none', slot: null, score: 0, reason: 'test' },
      skill: getBotSkillProfile('normal'),
      now: NOW,
      tempoMultiplier: 1,
    });

    assert.equal(input.secondaryFire, false);
    assert.equal(brain.pendingSecondaryMode, '');
    assert.equal(brain.secondaryHoldUntil, 0);
  }

  {
    const brain = createInitialBotBrain();
    const input = { primaryFire: true } as PlayerInput;

    applyBotAbilityInputPlan({
      input,
      brain,
      plan: { mode: 'blaze_bomb', slot: 'secondary', score: 100, reason: 'test bomb', holdMs: 180 },
      skill: getBotSkillProfile('normal'),
      now: NOW,
      tempoMultiplier: 2,
      random: randomSequence([0]),
    });

    assert.equal(input.primaryFire, false);
    assert.equal(input.secondaryFire, true);
    assert.equal(brain.pendingSecondaryMode, 'blaze_bomb');
    assert.equal(brain.secondaryHoldUntil, NOW + 180);
    assert.equal(brain.nextSecondaryAt, NOW + 450);
  }

  {
    const skill = {
      ...getBotSkillProfile('normal'),
      abilityScoreThreshold: 80,
      abilityCadenceMs: [1_000, 1_000] as [number, number],
    };
    const gatedBrain = createInitialBotBrain();
    gatedBrain.nextAbilityAt = NOW + 100;
    const gatedInput = {} as PlayerInput;

    applyBotAbilityInputPlan({
      input: gatedInput,
      brain: gatedBrain,
      plan: { mode: 'phantom_blink', slot: 'ability1', score: 100, reason: 'below override threshold' },
      skill,
      now: NOW,
      tempoMultiplier: 1,
    });

    assert.equal(gatedInput.ability1, undefined);
    assert.equal(gatedBrain.nextAbilityAt, NOW + 100);

    const readyBrain = createInitialBotBrain();
    const readyInput = { primaryFire: true } as PlayerInput;
    applyBotAbilityInputPlan({
      input: readyInput,
      brain: readyBrain,
      plan: { mode: 'phantom_blink', slot: 'ability1', score: 100, reason: 'ready' },
      skill,
      now: NOW,
      tempoMultiplier: 1,
      random: randomSequence([0]),
    });

    assert.equal(readyInput.ability1, true);
    assert.equal(readyInput.primaryFire, false);
    assert.equal(readyBrain.nextAbilityAt, NOW + 1_000);
  }
}

function testCombatPlannerHoldsStandoffInsideAttackEnvelope() {
  const bot = player({ id: 'red-phantom', team: 'red', heroId: 'phantom', x: 0, z: 0 });
  const enemy = player({ id: 'blue-hook', team: 'blue', heroId: 'hookshot', x: 21.5, z: 0 });
  const blackboard = blackboardFor(bot, [bot, enemy], { visibleEnemyIds: [enemy.id], losEnemyIds: [enemy.id] });
  const intent = {
    ...scoreBotIntents(bot, blackboard, getBotSkillProfile('normal')),
    type: 'fight_local_enemy' as const,
    targetPosition: enemy.position,
    targetPlayerId: enemy.id,
    reason: 'test local duel',
  };
  const combatPlan = chooseBotCombatPlan({
    bot,
    intent,
    blackboard,
    skill: getBotSkillProfile('normal'),
    primaryRange: 30,
    protectedEnemyIds: new Set(),
  });

  assert.equal(combatPlan.targetId, enemy.id);
  assert.equal(combatPlan.stance, 'strafe');
}

function testCombatMovementKitesInsideMinimumRange() {
  const bot = player({ id: 'red-phantom', team: 'red', heroId: 'phantom', x: 0, z: 0 });
  const enemy = player({ id: 'blue-hook', team: 'blue', heroId: 'hookshot', x: 7, z: 0 });
  const skill = getBotSkillProfile('normal');
  const blackboard = blackboardFor(bot, [bot, enemy], { visibleEnemyIds: [enemy.id], losEnemyIds: [enemy.id] });
  const intent = {
    ...scoreBotIntents(bot, blackboard, skill),
    type: 'fight_local_enemy' as const,
    targetPosition: enemy.position,
    targetPlayerId: enemy.id,
    reason: 'test close duel',
  };
  const move = composeBotMovementDirection(
    bot,
    { strafeDirection: 1 },
    intent,
    directRoutePlan(vec(40, 0)),
    enemy,
    blackboard,
    skill,
    { stance: 'kite' }
  );

  assert.ok(move, 'expected a movement direction');
  assert.ok(move.x < -0.45, `expected bot to back away from close enemy, got ${JSON.stringify(move)}`);
}

function testOutnumberedBotsRegroupBeforeCriticalHealth() {
  const bot = player({ id: 'red-phantom', team: 'red', heroId: 'phantom', x: 0, z: 0, health: 125, maxHealth: 200 });
  const enemyA = player({ id: 'blue-a', team: 'blue', heroId: 'phantom', x: 8, z: 0 });
  const enemyB = player({ id: 'blue-b', team: 'blue', heroId: 'hookshot', x: 10, z: 3 });
  const blackboard = blackboardFor(bot, [bot, enemyA, enemyB], {
    visibleEnemyIds: [enemyA.id, enemyB.id],
    losEnemyIds: [enemyA.id, enemyB.id],
  });
  const intent = scoreBotIntents(bot, blackboard, getBotSkillProfile('normal'));

  assert.equal(intent.type, 'regroup');
  assert.equal(intent.reason, 'outnumbered local fight');
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
    geometry: defaultGeometry({ groundHooksValuable: true }),
  });
  assert.equal(hookPlan.mode, 'hookshot_ground_hooks');

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
  const tactics = buildTeamTactics({
    gameplayMode: DEFAULT_GAMEPLAY_MODE,
    now: NOW,
    revision: 1,
    players,
    flags: flagState,
  }).red;
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
  assert.notEqual(hookPlan.mode, 'hookshot_ground_hooks');
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
testBattleRoyalTacticsUseAllEnemySquads();
testIntentScoring();
testRoutePlannerAvoidsBlockedEdge();
testBotPlanningStateRefreshesAndReusesCachedState();
testBotMovementRecoveryStateReplansBlockedEdges();
testBotMovementRecoveryStateKeepsRouteWhenProgressing();
testLocalAvoidance();
testBotPrimaryFireDecisionTiming();
testBotCombatEngagementState();
testBotAimLeadPrediction();
testBotYawPitchTowardPosition();
testBotAimStateUpdate();
testBotAimReadinessTrace();
testBotSecondaryFireDecisionTiming();
testBotLocomotionActionState();
testBotInputMovementState();
testBotAbilityInputPlanApplication();
testCombatPlannerHoldsStandoffInsideAttackEnvelope();
testCombatMovementKitesInsideMinimumRange();
testOutnumberedBotsRegroupBeforeCriticalHealth();
testChronosHealingThresholds();
testHeroAbilityControllers();
testDifficultyChangesDecisionQuality();
testNeutralAllBotOpenerPressuresFlag();
testUncontestedDefendersHoldControlUltimates();
testContestedObjectiveStillSpendsControlUltimate();

console.log('bot-ai-overhaul tests passed');
