import {
  BLAZE_FLAMETHROWER_RANGE,
  BLAZE_GEARSTORM_RADIUS,
  CHRONOS_LIFELINE_ALLY_HEAL,
  CHRONOS_LIFELINE_MAX_TARGETS,
  CHRONOS_LIFELINE_RADIUS,
  CHRONOS_LIFELINE_SELF_HEAL,
  CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE,
  type AbilityState,
  type BotDifficulty,
  type HeroId,
  type Team,
  type VoxelMapManifest,
} from '@voxel-strike/shared';

export type PlainVec3 = { x: number; y: number; z: number };
export type PlainVec2 = { x: number; z: number };

export type BotStrategicRole =
  | 'runner'
  | 'escort'
  | 'interceptor'
  | 'defender'
  | 'support'
  | 'fighter';

export type BotPersonality =
  | 'aggressive'
  | 'cautious'
  | 'defender'
  | 'flanker'
  | 'bodyguard'
  | 'support-first';

export type BotIntentType =
  | 'selecting'
  | 'respawning'
  | 'capture_enemy_flag'
  | 'carry_flag_home'
  | 'escort_allied_carrier'
  | 'return_dropped_friendly_flag'
  | 'intercept_enemy_carrier'
  | 'defend_base'
  | 'fight_local_enemy'
  | 'peel_for_ally'
  | 'retreat'
  | 'regroup'
  | 'pressure_lane';

export type BotTacticsJob =
  | 'carry'
  | 'return_flag'
  | 'escort_carrier'
  | 'clear_carrier_route'
  | 'intercept_carrier'
  | 'defend_base'
  | 'support_cluster'
  | 'fight'
  | 'run_flag'
  | 'regroup';

export interface BotSkillProfile {
  thinkIntervalMs: number;
  reactionMs: number;
  turnRateRadians: number;
  aimLeadSeconds: number;
  aimErrorRadians: number;
  aimJitterRefreshMs: [number, number];
  aimFireToleranceScale: number;
  fireChance: number;
  secondaryChance: number;
  fireDecisionMs: [number, number];
  burstDurationMs: [number, number];
  abilityCadenceMs: [number, number];
  ultimateCadenceMs: [number, number];
  preferredRangeScale: number;
  aggression: number;
  retreatHealthRatio: number;
  routeDangerWeight: number;
  blockedEdgeTtlMs: number;
  pathExpansionLimit: number;
  memoryMs: number;
  minHealValue: number;
  abilityScoreThreshold: number;
  replanIntervalMs: number;
  localProbeDistance: number;
  focusFireWeight: number;
  escortCommitDistance: number;
  directRouteBias: number;
}

export interface BotAbilitySnapshot extends Pick<AbilityState, 'abilityId' | 'cooldownRemaining' | 'charges' | 'isActive' | 'activatedAt'> {}

export interface BotMovementSnapshot {
  isGrounded: boolean;
  isSprinting: boolean;
  isCrouching: boolean;
  isSliding: boolean;
  isGrappling: boolean;
  isJetpacking: boolean;
  isGliding: boolean;
}

export interface BotPlayerSnapshot {
  id: string;
  name: string;
  team: Team;
  heroId: HeroId | '';
  state: string;
  isBot: boolean;
  botDifficulty: BotDifficulty;
  botProfileId: string;
  position: PlainVec3;
  velocity: PlainVec3;
  lookYaw: number;
  lookPitch: number;
  health: number;
  maxHealth: number;
  ultimateCharge: number;
  movement: BotMovementSnapshot;
  abilities: Record<string, BotAbilitySnapshot>;
  hasFlag: boolean;
  spawnProtectionUntil: number;
}

export interface BotFlagSnapshot {
  team: Team;
  position: PlainVec3;
  basePosition: PlainVec3;
  carrierId: string;
  isAtBase: boolean;
  droppedAt: number;
}

export interface BotRecentDamageSource {
  sourceId: string;
  damage: number;
  timestamp: number;
  sourcePosition: PlainVec3 | null;
  sourceDirection: PlainVec3 | null;
  damageType: string;
}

export interface BotEnemyMemory {
  enemyId: string;
  lastKnownPosition: PlainVec3;
  lastVelocity: PlainVec3;
  lastSeenAt: number;
  uncertaintyRadius: number;
  source: 'visible' | 'damage' | 'objective';
}

export interface BotRouteNodeInfo {
  id: string;
  kind: string;
  position: PlainVec3;
  team?: Team;
  laneIds: string[];
  tags: string[];
}

export interface BotRouteEdgeInfo {
  id: string;
  from: string;
  to: string;
  laneId: string;
  distance: number;
  expectedTravelTimeSeconds: number;
  width: number;
  traversal: string;
  tags: string[];
  midpoint: PlainVec3;
}

export interface BotRouteLaneInfo {
  id: string;
  kind: string;
  nodeIds: string[];
  width: number;
  expectedDistance: number;
  expectedTravelTimeSeconds: number;
}

export interface BotTacticalSlotInfo {
  id: string;
  role: string;
  position: PlainVec3;
  laneId?: string;
  nodeId?: string;
  edgeId?: string;
  team?: Team;
}

export interface BotRouteGraphAdapter {
  nodes: BotRouteNodeInfo[];
  edges: BotRouteEdgeInfo[];
  nodeById: Map<string, BotRouteNodeInfo>;
  adjacency: Map<string, BotRouteEdgeInfo[]>;
  lanes: Map<string, BotRouteLaneInfo>;
  primaryRouteNodeIds: Record<Team, string[]>;
  fallbackAnchorNodeIds: Record<Team, string[]>;
  tacticalSlots: BotTacticalSlotInfo[];
}

export interface BotThreatCluster {
  id: string;
  team: Team;
  center: PlainVec3;
  radius: number;
  count: number;
  carrierId: string | null;
  threat: number;
  playerIds: string[];
}

export interface BotResourceFact {
  playerId: string;
  position: PlainVec3;
  missingHealth: number;
  healthRatio: number;
  isCarrier: boolean;
  threatened: boolean;
  distanceToNearestEnemy: number;
}

export interface BotRoleDemand {
  runners: number;
  defenders: number;
  escorts: number;
  interceptors: number;
  support: number;
  fighters: number;
}

export interface BotRoleAssignment {
  botId: string;
  role: BotStrategicRole;
  job: BotTacticsJob;
  targetPlayerId?: string;
  targetPosition?: PlainVec3;
  reason: string;
  priority: number;
}

export interface BotTeamTactics {
  team: Team;
  revision: number;
  ownFlagState: 'safe' | 'dropped' | 'stolen' | 'carrier_near_base' | 'carrier_under_pressure';
  enemyFlagState: 'at_base' | 'dropped' | 'carried_by_ally' | 'contested';
  roleDemand: BotRoleDemand;
  assignments: Record<string, BotRoleAssignment>;
  threatClusters: BotThreatCluster[];
  lowHealthAllies: BotResourceFact[];
  carrierDanger: Record<string, number>;
}

export type BotTeamTacticsByTeam = Record<Team, BotTeamTactics>;

export interface BotAllyHealthDebt {
  playerId: string;
  position: PlainVec3;
  missingHealth: number;
  effectiveMissingHealth: number;
  healthRatio: number;
  distance: number;
  isCarrier: boolean;
  threatened: boolean;
  fighting: boolean;
  retreating: boolean;
}

export interface BotKnownEnemy {
  player: BotPlayerSnapshot;
  visible: boolean;
  lastKnownPosition: PlainVec3;
  distance: number;
  hasLineOfSight: boolean;
  memoryAgeMs: number;
  uncertaintyRadius: number;
}

export interface BotBlackboard {
  bot: BotPlayerSnapshot;
  team: Team;
  enemyTeam: Team;
  allies: BotPlayerSnapshot[];
  enemies: BotKnownEnemy[];
  visibleEnemies: BotKnownEnemy[];
  lastKnownEnemies: BotKnownEnemy[];
  nearestEnemy: BotKnownEnemy | null;
  weakestEnemy: BotKnownEnemy | null;
  enemyCarrier: BotKnownEnemy | null;
  nearestAlly: BotPlayerSnapshot | null;
  alliedCarrier: BotPlayerSnapshot | null;
  droppedFriendlyFlag: PlainVec3 | null;
  droppedEnemyFlag: PlainVec3 | null;
  enemyFlagPosition: PlainVec3;
  ownBasePosition: PlainVec3;
  ownFlagAtBase: boolean;
  enemyFlagAtBase: boolean;
  nearbyEnemyCount: number;
  nearbyAllyCount: number;
  allyHealthDebts: BotAllyHealthDebt[];
  healCluster: { center: PlainVec3; expectedHeal: number; targetIds: string[]; inRange: boolean } | null;
  recentDamageSource: BotRecentDamageSource | null;
  currentAssignment: BotRoleAssignment | null;
  teamTactics: BotTeamTactics;
}

export interface BotIntentCandidate {
  type: BotIntentType;
  score: number;
  targetPosition: PlainVec3;
  targetPlayerId?: string;
  reason: string;
}

export interface BotIntentPlan extends BotIntentCandidate {
  role: BotStrategicRole;
  job: BotTacticsJob | 'none';
  candidates: BotIntentCandidate[];
}

export interface BotRoutePlan {
  targetPosition: PlainVec3;
  steeringTarget: PlainVec3;
  pathNodeIds: string[];
  nextNodeId: string | null;
  activeEdgeId: string | null;
  laneId: string | null;
  cost: number;
  expandedNodes: number;
  capped: boolean;
  reason: string;
  plannedAt: number;
}

export interface BotCombatPlan {
  targetId: string | null;
  stance: 'close' | 'kite' | 'strafe' | 'hold_cover' | 'escort' | 'block' | 'retreat';
  score: number;
  reason: string;
}

export type BotAbilityPlanMode =
  | 'none'
  | 'chronos_lifeline_allies'
  | 'chronos_lifeline_self'
  | 'chronos_aegis'
  | 'chronos_timebreak'
  | 'chronos_ascendant'
  | 'phantom_blink'
  | 'phantom_shield'
  | 'phantom_veil'
  | 'hookshot_grapple'
  | 'hookshot_anchor_wall'
  | 'hookshot_trap'
  | 'blaze_flamethrower'
  | 'blaze_rocketjump'
  | 'blaze_bomb'
  | 'blaze_airstrike';

export interface BotAbilityPlan {
  mode: BotAbilityPlanMode;
  slot: 'ability1' | 'ability2' | 'ultimate' | 'secondary' | null;
  score: number;
  reason: string;
  targetPosition?: PlainVec3;
  targetPlayerId?: string;
  holdMs?: number;
}

export interface BotMovementProgress {
  desiredTarget: PlainVec3 | null;
  lastPosition: PlainVec3;
  lastDistanceToTarget: number;
  lastProgressAt: number;
  stalledMs: number;
  blockerDirection: PlainVec2 | null;
  failedEdgeId: string | null;
}

export interface BotBrain {
  nextThinkAt: number;
  nextBlackboardAt: number;
  blackboard: BotBlackboard | null;
  intent: BotIntentPlan;
  routePlan: BotRoutePlan | null;
  movementProgress: BotMovementProgress;
  blockedEdges: Map<string, number>;
  enemyMemory: Map<string, BotEnemyMemory>;
  targetId: string;
  strafeDirection: -1 | 1;
  strafeUntil: number;
  reverseUntil: number;
  aimYaw: number;
  aimPitch: number;
  aimJitterYaw: number;
  aimJitterPitch: number;
  nextAimJitterAt: number;
  fireUntil: number;
  nextFireDecisionAt: number;
  nextSecondaryAt: number;
  nextAbilityAt: number;
  nextUltimateAt: number;
  secondaryHoldUntil: number;
  pendingSecondaryMode: BotAbilityPlanMode | '';
}

export interface BotSteeringProbe {
  direction: PlainVec2;
  clear: boolean;
  distance: number;
  label: 'direct' | 'left' | 'right' | 'wide_left' | 'wide_right' | 'back';
}

export interface BotSteeringChoice {
  direction: PlainVec2 | null;
  blocked: boolean;
  jump: boolean;
  reason: string;
}

export interface BotAbilityGeometry {
  directPathBlocked: boolean;
  movementProgressBlocked: boolean;
  blinkSafe: boolean;
  blinkDangerous: boolean;
  grappleAnchorAvailable: boolean;
  anchorWallProtectsAlly: boolean;
  anchorWallBlocksFriendlyCarrier: boolean;
  trapZoneValuable: boolean;
}

export interface BotTeamTacticsInput {
  now: number;
  revision: number;
  players: BotPlayerSnapshot[];
  flags: Record<Team, BotFlagSnapshot>;
}

export interface BotBlackboardInput {
  now: number;
  bot: BotPlayerSnapshot;
  players: BotPlayerSnapshot[];
  flags: Record<Team, BotFlagSnapshot>;
  visibleEnemyIds: Set<string>;
  enemyLineOfSightIds: Set<string>;
  recentDamageSources: BotRecentDamageSource[];
  teamTactics: BotTeamTactics;
  enemyMemory: Map<string, BotEnemyMemory>;
  skill: BotSkillProfile;
}

export interface BotRoutePlanInput {
  now: number;
  bot: BotPlayerSnapshot;
  intent: BotIntentPlan;
  blackboard: BotBlackboard;
  routeGraph: BotRouteGraphAdapter | null;
  blockedEdges: Map<string, number>;
  skill: BotSkillProfile;
}

export interface BotCombatPlanInput {
  bot: BotPlayerSnapshot;
  intent: BotIntentPlan;
  blackboard: BotBlackboard;
  skill: BotSkillProfile;
  primaryRange: number;
  preferredRange: number;
  protectedEnemyIds: Set<string>;
  focusTargetIds?: Set<string>;
}

export interface BotAbilityPlanInput {
  now: number;
  bot: BotPlayerSnapshot;
  intent: BotIntentPlan;
  blackboard: BotBlackboard;
  combatPlan: BotCombatPlan;
  skill: BotSkillProfile;
  geometry: BotAbilityGeometry;
}

const TEAMS: readonly Team[] = ['red', 'blue'];

export const BOT_AWARENESS_RANGE = 58;
export const BOT_CLOSE_REVEAL_RANGE = 8;
export const BOT_LOS_SAMPLE_STEP = 0.55;
export const BOT_THINK_INTERVAL_MS = 200;
export const BOT_AI_BUDGET_MS = 5;
export const BOT_TACTICS_INTERVAL_MS = 420;

export const BOT_SKILL_PROFILES: Record<BotDifficulty, BotSkillProfile> = {
  easy: {
    thinkIntervalMs: 360,
    reactionMs: 360,
    turnRateRadians: 4.8,
    aimLeadSeconds: 0.05,
    aimErrorRadians: 0.14,
    aimJitterRefreshMs: [480, 900],
    aimFireToleranceScale: 1.4,
    fireChance: 0.48,
    secondaryChance: 0.28,
    fireDecisionMs: [360, 720],
    burstDurationMs: [180, 420],
    abilityCadenceMs: [1500, 2600],
    ultimateCadenceMs: [2200, 3800],
    preferredRangeScale: 0.92,
    aggression: 0.75,
    retreatHealthRatio: 0.38,
    routeDangerWeight: 0.45,
    blockedEdgeTtlMs: 1400,
    pathExpansionLimit: 18,
    memoryMs: 1200,
    minHealValue: 42,
    abilityScoreThreshold: 58,
    replanIntervalMs: 720,
    localProbeDistance: 1.3,
    focusFireWeight: 0.35,
    escortCommitDistance: 18,
    directRouteBias: 0.82,
  },
  normal: {
    thinkIntervalMs: 220,
    reactionMs: 210,
    turnRateRadians: 8.5,
    aimLeadSeconds: 0.16,
    aimErrorRadians: 0.075,
    aimJitterRefreshMs: [360, 720],
    aimFireToleranceScale: 1.18,
    fireChance: 0.68,
    secondaryChance: 0.46,
    fireDecisionMs: [260, 540],
    burstDurationMs: [240, 620],
    abilityCadenceMs: [1100, 2100],
    ultimateCadenceMs: [1600, 3000],
    preferredRangeScale: 1,
    aggression: 1,
    retreatHealthRatio: 0.3,
    routeDangerWeight: 0.82,
    blockedEdgeTtlMs: 2400,
    pathExpansionLimit: 36,
    memoryMs: 2600,
    minHealValue: 68,
    abilityScoreThreshold: 74,
    replanIntervalMs: 430,
    localProbeDistance: 1.8,
    focusFireWeight: 0.72,
    escortCommitDistance: 28,
    directRouteBias: 1,
  },
  hard: {
    thinkIntervalMs: 150,
    reactionMs: 120,
    turnRateRadians: 12.5,
    aimLeadSeconds: 0.24,
    aimErrorRadians: 0.035,
    aimJitterRefreshMs: [260, 520],
    aimFireToleranceScale: 1.06,
    fireChance: 0.84,
    secondaryChance: 0.62,
    fireDecisionMs: [180, 360],
    burstDurationMs: [300, 760],
    abilityCadenceMs: [760, 1550],
    ultimateCadenceMs: [1200, 2400],
    preferredRangeScale: 1.08,
    aggression: 1.18,
    retreatHealthRatio: 0.24,
    routeDangerWeight: 1.18,
    blockedEdgeTtlMs: 3600,
    pathExpansionLimit: 64,
    memoryMs: 5200,
    minHealValue: 78,
    abilityScoreThreshold: 84,
    replanIntervalMs: 260,
    localProbeDistance: 2.3,
    focusFireWeight: 1.05,
    escortCommitDistance: 36,
    directRouteBias: 1.15,
  },
};

export function normalizeBotDifficulty(difficulty?: string): BotDifficulty {
  if (difficulty === 'easy' || difficulty === 'hard') return difficulty;
  return 'normal';
}

export function getBotSkillProfile(difficulty?: string): BotSkillProfile {
  return BOT_SKILL_PROFILES[normalizeBotDifficulty(difficulty)];
}

export function otherTeam(team: Team): Team {
  return team === 'red' ? 'blue' : 'red';
}

export function distance2D(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function distance3D(a: PlainVec3, b: PlainVec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function direction2DFromTo(from: { x: number; z: number }, to: { x: number; z: number }): PlainVec2 | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length <= 0.001) return null;
  return { x: dx / length, z: dz / length };
}

export function normalize2D(vector: PlainVec2): PlainVec2 | null {
  const length = Math.sqrt(vector.x * vector.x + vector.z * vector.z);
  if (length <= 0.001) return null;
  return { x: vector.x / length, z: vector.z / length };
}

export function mix2D(a: PlainVec2, aWeight: number, b: PlainVec2, bWeight: number): PlainVec2 {
  return {
    x: a.x * aWeight + b.x * bWeight,
    z: a.z * aWeight + b.z * bWeight,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function getBotPersonality(bot: Pick<BotPlayerSnapshot, 'botProfileId' | 'id' | 'name' | 'heroId'>): BotPersonality {
  const source = `${bot.botProfileId || ''} ${bot.name || ''}`.toLowerCase();
  if (source.includes('defend')) return 'defender';
  if (source.includes('flank')) return 'flanker';
  if (source.includes('guard') || source.includes('body')) return 'bodyguard';
  if (source.includes('support') || bot.heroId === 'chronos') return 'support-first';
  const bucket = hashString(bot.botProfileId || bot.id || bot.name) % 12;
  if (bucket < 2) return 'cautious';
  if (bucket < 4) return 'defender';
  if (bucket < 6) return 'flanker';
  if (bucket < 8) return 'bodyguard';
  if (bucket < 10) return 'support-first';
  return 'aggressive';
}

export function createInitialIntent(position: PlainVec3 = { x: 0, y: 0, z: 0 }): BotIntentPlan {
  return {
    type: 'selecting',
    role: 'runner',
    job: 'none',
    score: 0,
    targetPosition: { ...position },
    reason: 'initial',
    candidates: [],
  };
}

export function createInitialBotBrain(position: PlainVec3 = { x: 0, y: 0, z: 0 }, seed = 0): BotBrain {
  return {
    nextThinkAt: 0,
    nextBlackboardAt: 0,
    blackboard: null,
    intent: createInitialIntent(position),
    routePlan: null,
    movementProgress: {
      desiredTarget: null,
      lastPosition: { ...position },
      lastDistanceToTarget: Infinity,
      lastProgressAt: 0,
      stalledMs: 0,
      blockerDirection: null,
      failedEdgeId: null,
    },
    blockedEdges: new Map(),
    enemyMemory: new Map(),
    targetId: '',
    strafeDirection: seed % 2 === 0 ? 1 : -1,
    strafeUntil: 0,
    reverseUntil: 0,
    aimYaw: 0,
    aimPitch: 0,
    aimJitterYaw: 0,
    aimJitterPitch: 0,
    nextAimJitterAt: 0,
    fireUntil: 0,
    nextFireDecisionAt: 0,
    nextSecondaryAt: 0,
    nextAbilityAt: 0,
    nextUltimateAt: 0,
    secondaryHoldUntil: 0,
    pendingSecondaryMode: '',
  };
}

export function createBotRouteGraphAdapter(manifest: VoxelMapManifest | null | undefined): BotRouteGraphAdapter | null {
  const routeGraph = manifest?.gameplay?.routeGraph;
  if (!routeGraph) return null;

  const nodeById = new Map<string, BotRouteNodeInfo>();
  const nodes = routeGraph.nodes.map((node) => {
    const mapped: BotRouteNodeInfo = {
      id: node.id,
      kind: node.kind,
      position: { x: node.position.x, y: node.position.y, z: node.position.z },
      team: node.team as Team | undefined,
      laneIds: [...node.laneIds],
      tags: [...node.tags],
    };
    nodeById.set(mapped.id, mapped);
    return mapped;
  });

  const lanes = new Map<string, BotRouteLaneInfo>();
  for (const lane of manifest?.gameplay?.lanes ?? []) {
    lanes.set(lane.id, {
      id: lane.id,
      kind: lane.kind,
      nodeIds: [...lane.nodeIds],
      width: lane.width,
      expectedDistance: lane.expectedDistance,
      expectedTravelTimeSeconds: lane.expectedTravelTimeSeconds,
    });
  }

  const edges: BotRouteEdgeInfo[] = [];
  const adjacency = new Map<string, BotRouteEdgeInfo[]>();
  const addEdge = (edge: BotRouteEdgeInfo): void => {
    edges.push(edge);
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge);
    adjacency.set(edge.from, list);
  };

  for (const edge of routeGraph.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    const midpoint = {
      x: (from.position.x + to.position.x) * 0.5,
      y: (from.position.y + to.position.y) * 0.5,
      z: (from.position.z + to.position.z) * 0.5,
    };
    const mapped: BotRouteEdgeInfo = {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      laneId: edge.laneId,
      distance: edge.distance,
      expectedTravelTimeSeconds: edge.expectedTravelTimeSeconds,
      width: edge.width,
      traversal: edge.traversal,
      tags: [...edge.tags],
      midpoint,
    };
    addEdge(mapped);
    addEdge({
      ...mapped,
      from: edge.to,
      to: edge.from,
    });
  }

  const tacticalSlots = (manifest?.construction?.tacticalSlots ?? []).map((slot) => ({
    id: slot.id,
    role: slot.role,
    position: { x: slot.position.x, y: slot.position.y, z: slot.position.z },
    laneId: slot.laneId,
    nodeId: slot.nodeId,
    edgeId: slot.edgeId,
    team: slot.team as Team | undefined,
  }));

  return {
    nodes,
    edges,
    nodeById,
    adjacency,
    lanes,
    primaryRouteNodeIds: {
      red: [...(routeGraph.primaryRouteNodeIds.red ?? [])],
      blue: [...(routeGraph.primaryRouteNodeIds.blue ?? [])],
    },
    fallbackAnchorNodeIds: {
      red: [...(routeGraph.fallbackAnchorNodeIds.red ?? [])],
      blue: [...(routeGraph.fallbackAnchorNodeIds.blue ?? [])],
    },
    tacticalSlots,
  };
}

function alivePlayers(players: readonly BotPlayerSnapshot[]): BotPlayerSnapshot[] {
  return players.filter((player) => player.state === 'alive');
}

function nearestPlayer(
  players: readonly BotPlayerSnapshot[],
  position: PlainVec3,
  predicate: (player: BotPlayerSnapshot) => boolean = () => true
): BotPlayerSnapshot | null {
  let best: BotPlayerSnapshot | null = null;
  let bestDistance = Infinity;
  for (const player of players) {
    if (!predicate(player)) continue;
    const distance = distance2D(position, player.position);
    if (distance < bestDistance) {
      best = player;
      bestDistance = distance;
    }
  }
  return best;
}

function createThreatClusters(team: Team, enemies: readonly BotPlayerSnapshot[]): BotThreatCluster[] {
  const clusters: BotThreatCluster[] = [];
  const consumed = new Set<string>();
  for (const enemy of enemies) {
    if (consumed.has(enemy.id)) continue;
    const members = enemies.filter((candidate) => distance2D(enemy.position, candidate.position) <= 14);
    for (const member of members) consumed.add(member.id);
    const center = members.reduce<PlainVec3>((sum, member) => ({
      x: sum.x + member.position.x,
      y: sum.y + member.position.y,
      z: sum.z + member.position.z,
    }), { x: 0, y: 0, z: 0 });
    center.x /= members.length;
    center.y /= members.length;
    center.z /= members.length;
    const carrier = members.find((member) => member.hasFlag) ?? null;
    clusters.push({
      id: `${team}-threat-${clusters.length}`,
      team,
      center,
      radius: Math.max(8, ...members.map((member) => distance2D(center, member.position) + 5)),
      count: members.length,
      carrierId: carrier?.id ?? null,
      threat: members.length + (carrier ? 3 : 0) + members.reduce((sum, member) => sum + (1 - member.health / Math.max(1, member.maxHealth)), 0),
      playerIds: members.map((member) => member.id).sort(),
    });
  }
  return clusters;
}

function healthResources(allies: readonly BotPlayerSnapshot[], enemies: readonly BotPlayerSnapshot[]): BotResourceFact[] {
  return allies
    .filter((ally) => ally.state === 'alive' && ally.health < ally.maxHealth)
    .map((ally) => {
      const nearestEnemyDistance = nearestPlayer(enemies, ally.position)?.position
        ? Math.min(...enemies.map((enemy) => distance2D(ally.position, enemy.position)))
        : Infinity;
      return {
        playerId: ally.id,
        position: { ...ally.position },
        missingHealth: Math.max(0, ally.maxHealth - ally.health),
        healthRatio: ally.health / Math.max(1, ally.maxHealth),
        isCarrier: ally.hasFlag,
        threatened: nearestEnemyDistance <= 18,
        distanceToNearestEnemy: nearestEnemyDistance,
      };
    })
    .sort((a, b) => b.missingHealth - a.missingHealth);
}

function assignmentSuitability(bot: BotPlayerSnapshot, role: BotStrategicRole, targetPosition?: PlainVec3): number {
  const personality = getBotPersonality(bot);
  let score = 0;
  switch (role) {
    case 'runner':
      score += bot.heroId === 'phantom' || bot.heroId === 'hookshot' ? 45 : 0;
      score += personality === 'flanker' ? 18 : 0;
      break;
    case 'escort':
      score += bot.heroId === 'chronos' ? 32 : 0;
      score += personality === 'bodyguard' || personality === 'support-first' ? 22 : 0;
      break;
    case 'interceptor':
      score += bot.heroId === 'phantom' || bot.heroId === 'hookshot' ? 38 : 0;
      score += personality === 'aggressive' || personality === 'flanker' ? 16 : 0;
      break;
    case 'defender':
      score += bot.heroId === 'chronos' || bot.heroId === 'blaze' ? 26 : 0;
      score += personality === 'defender' || personality === 'cautious' ? 24 : 0;
      break;
    case 'support':
      score += bot.heroId === 'chronos' ? 60 : 0;
      score += personality === 'support-first' ? 24 : 0;
      break;
    case 'fighter':
      score += bot.heroId === 'blaze' || bot.heroId === 'hookshot' ? 30 : 0;
      score += personality === 'aggressive' ? 18 : 0;
      break;
  }
  if (targetPosition) score -= distance2D(bot.position, targetPosition) * 0.8;
  return score;
}

function assignBestBot(
  bots: readonly BotPlayerSnapshot[],
  assigned: Set<string>,
  role: BotStrategicRole,
  job: BotTacticsJob,
  targetPosition: PlainVec3 | undefined,
  targetPlayerId: string | undefined,
  reason: string,
  priority: number,
  assignments: Record<string, BotRoleAssignment>
): BotPlayerSnapshot | null {
  let best: BotPlayerSnapshot | null = null;
  let bestScore = -Infinity;
  for (const bot of bots) {
    if (assigned.has(bot.id)) continue;
    const score = assignmentSuitability(bot, role, targetPosition);
    if (score > bestScore || (score === bestScore && bot.id < (best?.id ?? '~'))) {
      best = bot;
      bestScore = score;
    }
  }
  if (!best) return null;
  assigned.add(best.id);
  assignments[best.id] = {
    botId: best.id,
    role,
    job,
    targetPosition: targetPosition ? { ...targetPosition } : undefined,
    targetPlayerId,
    reason,
    priority,
  };
  return best;
}

function buildTeamTacticsForTeam(input: BotTeamTacticsInput, team: Team): BotTeamTactics {
  const enemyTeam = otherTeam(team);
  const alive = alivePlayers(input.players);
  const allies = alive.filter((player) => player.team === team);
  const enemies = alive.filter((player) => player.team === enemyTeam);
  const bots = allies.filter((player) => player.isBot);
  const ownFlag = input.flags[team];
  const enemyFlag = input.flags[enemyTeam];
  const enemyCarrier = ownFlag.carrierId ? alive.find((player) => player.id === ownFlag.carrierId) ?? null : null;
  const alliedCarrier = enemyFlag.carrierId ? alive.find((player) => player.id === enemyFlag.carrierId) ?? null : null;
  const droppedFriendlyFlag = !ownFlag.isAtBase && !ownFlag.carrierId ? ownFlag.position : null;
  const droppedEnemyFlag = !enemyFlag.isAtBase && !enemyFlag.carrierId ? enemyFlag.position : null;
  const threatClusters = createThreatClusters(enemyTeam, enemies);
  const lowHealthAllies = healthResources(allies, enemies).filter((fact) => fact.healthRatio < 0.72 || fact.isCarrier);
  const carrierDanger: Record<string, number> = {};
  for (const carrier of [enemyCarrier, alliedCarrier]) {
    if (!carrier) continue;
    carrierDanger[carrier.id] = enemies
      .filter((enemy) => enemy.team !== carrier.team)
      .reduce((danger, enemy) => danger + Math.max(0, 28 - distance2D(carrier.position, enemy.position)) / 8, 0);
  }

  const enemyNearBase = enemies.some((enemy) => distance2D(enemy.position, ownFlag.basePosition) <= 28);
  const neutralOpening = ownFlag.isAtBase
    && enemyFlag.isAtBase
    && !enemyCarrier
    && !alliedCarrier
    && !droppedFriendlyFlag
    && !droppedEnemyFlag;
  const targetDefenders = !ownFlag.isAtBase
    ? 0
    : droppedFriendlyFlag
      ? 1
      : enemyNearBase
        ? Math.min(2, Math.max(1, bots.length - 1))
        : bots.length >= 3
          ? 1
          : 0;
  const maxPressureBots = Math.max(0, bots.length - targetDefenders);
  const targetRunners = enemyFlag.isAtBase || droppedEnemyFlag
    ? Math.min(
      maxPressureBots,
      neutralOpening
        ? Math.max(1, Math.ceil(bots.length * 0.6))
        : Math.max(1, Math.min(2, maxPressureBots))
    )
    : 0;

  const roleDemand: BotRoleDemand = {
    runners: targetRunners,
    defenders: targetDefenders,
    escorts: alliedCarrier ? 1 : 0,
    interceptors: enemyCarrier ? 1 : 0,
    support: lowHealthAllies.length > 0 || alliedCarrier ? 1 : 0,
    fighters: Math.max(0, Math.min(2, maxPressureBots - targetRunners, enemies.length - (enemyCarrier ? 1 : 0))),
  };
  if (alliedCarrier && (carrierDanger[alliedCarrier.id] ?? 0) > 2) roleDemand.escorts = Math.min(2, roleDemand.escorts + 1);
  if (enemyCarrier && (carrierDanger[enemyCarrier.id] ?? 0) < 1) roleDemand.interceptors = Math.min(2, roleDemand.interceptors + 1);

  const assignments: Record<string, BotRoleAssignment> = {};
  const assigned = new Set<string>();

  for (const bot of bots.filter((candidate) => candidate.hasFlag).sort((a, b) => a.id.localeCompare(b.id))) {
    assigned.add(bot.id);
    assignments[bot.id] = {
      botId: bot.id,
      role: 'runner',
      job: 'carry',
      targetPosition: { ...ownFlag.basePosition },
      reason: 'bot is carrying enemy flag',
      priority: 1000,
    };
  }

  if (droppedFriendlyFlag) {
    const sorted = [...bots]
      .filter((bot) => !assigned.has(bot.id))
      .sort((a, b) => distance2D(a.position, droppedFriendlyFlag) - distance2D(b.position, droppedFriendlyFlag) || a.id.localeCompare(b.id));
    const returner = sorted[0];
    if (returner) {
      assigned.add(returner.id);
      assignments[returner.id] = {
        botId: returner.id,
        role: returner.heroId === 'chronos' ? 'support' : 'defender',
        job: 'return_flag',
        targetPosition: { ...droppedFriendlyFlag },
        reason: 'friendly flag is dropped',
        priority: 920,
      };
    }
  }

  if (enemyCarrier) {
    assignBestBot(bots, assigned, 'interceptor', 'intercept_carrier', enemyCarrier.position, enemyCarrier.id, 'enemy carrier is public objective', 880, assignments);
  }

  if (alliedCarrier) {
    const nearbyEscort = [...bots]
      .filter((bot) => !assigned.has(bot.id) && bot.id !== alliedCarrier.id)
      .sort((a, b) => distance2D(a.position, alliedCarrier.position) - distance2D(b.position, alliedCarrier.position) || a.id.localeCompare(b.id))[0];
    if (nearbyEscort && distance2D(nearbyEscort.position, alliedCarrier.position) <= 42) {
      assigned.add(nearbyEscort.id);
      assignments[nearbyEscort.id] = {
        botId: nearbyEscort.id,
        role: nearbyEscort.heroId === 'chronos' ? 'support' : 'escort',
        job: 'escort_carrier',
        targetPosition: { ...alliedCarrier.position },
        targetPlayerId: alliedCarrier.id,
        reason: 'nearby allied carrier needs escort',
        priority: 840,
      };
    }
    assignBestBot(bots, assigned, 'fighter', 'clear_carrier_route', ownFlag.basePosition, alliedCarrier.id, 'clear route ahead of allied carrier', 700, assignments);
  }

  if (lowHealthAllies.length > 0) {
    const cluster = lowHealthAllies[0];
    assignBestBot(bots, assigned, 'support', 'support_cluster', cluster.position, cluster.playerId, 'low-health ally resource cluster', 640, assignments);
  }

  if (ownFlag.isAtBase && roleDemand.defenders > 0) {
    assignBestBot(bots, assigned, 'defender', 'defend_base', ownFlag.basePosition, undefined, enemyNearBase ? 'enemy pressure near base' : 'base defense demand', 560, assignments);
  }

  if (droppedEnemyFlag) {
    assignBestBot(bots, assigned, 'runner', 'run_flag', droppedEnemyFlag, undefined, 'enemy flag is dropped and capturable', 520, assignments);
  }

  let assignedDefenders = Object.values(assignments).filter((assignment) => assignment.job === 'defend_base').length;
  let assignedRunners = Object.values(assignments).filter((assignment) => (
    assignment.job === 'run_flag' || assignment.job === 'carry'
  )).length;

  for (const bot of [...bots].sort((a, b) => a.id.localeCompare(b.id))) {
    if (assigned.has(bot.id)) continue;
    const defaultRole = getDefaultRole(bot, {
      ...roleDemand,
      defenders: Math.max(0, roleDemand.defenders - assignedDefenders),
      runners: Math.max(0, roleDemand.runners - assignedRunners),
    });
    let role: BotStrategicRole = defaultRole;
    let job: BotTacticsJob = 'run_flag';
    let targetPosition = droppedEnemyFlag ?? enemyFlag.position;
    let targetPlayerId: string | undefined;
    let reason = neutralOpening ? 'neutral opener objective pressure' : 'remaining team demand';

    if (
      assignedDefenders < roleDemand.defenders &&
      (enemyNearBase || droppedFriendlyFlag || getBotPersonality(bot) === 'defender' || bot.heroId === 'blaze')
    ) {
      role = 'defender';
      job = 'defend_base';
      targetPosition = ownFlag.basePosition;
      reason = enemyNearBase ? 'enemy pressure near base' : 'base defense demand';
      assignedDefenders++;
    } else if ((enemyFlag.isAtBase || droppedEnemyFlag) && assignedRunners < roleDemand.runners) {
      role = bot.heroId === 'chronos' ? 'support' : bot.heroId === 'blaze' ? 'fighter' : 'runner';
      job = 'run_flag';
      targetPosition = droppedEnemyFlag ?? enemyFlag.position;
      reason = neutralOpening ? 'opening flag pressure' : droppedEnemyFlag ? 'enemy flag is dropped and capturable' : 'flag pressure demand';
      assignedRunners++;
    } else if (lowHealthAllies.length > 0 && (bot.heroId === 'chronos' || getBotPersonality(bot) === 'support-first')) {
      role = 'support';
      job = 'support_cluster';
      targetPosition = lowHealthAllies[0].position;
      targetPlayerId = lowHealthAllies[0].playerId;
      reason = 'low-health ally resource cluster';
    } else {
      role = defaultRole === 'defender' ? 'fighter' : defaultRole;
      job = enemyFlag.isAtBase || droppedEnemyFlag ? 'run_flag' : 'fight';
      targetPosition = droppedEnemyFlag ?? enemyFlag.position;
      if (job === 'run_flag') assignedRunners++;
    }

    assignments[bot.id] = {
      botId: bot.id,
      role,
      job,
      targetPosition: { ...targetPosition },
      targetPlayerId,
      reason,
      priority: 320,
    };
  }

  const ownFlagState = enemyCarrier
    ? carrierDanger[enemyCarrier.id] > 2 ? 'carrier_under_pressure' : 'stolen'
    : droppedFriendlyFlag
      ? 'dropped'
      : 'safe';
  const enemyFlagState = alliedCarrier
    ? 'carried_by_ally'
    : droppedEnemyFlag
      ? 'dropped'
      : enemyFlag.isAtBase
        ? 'at_base'
        : 'contested';

  return {
    team,
    revision: input.revision,
    ownFlagState,
    enemyFlagState,
    roleDemand,
    assignments,
    threatClusters,
    lowHealthAllies,
    carrierDanger,
  };
}

function getDefaultRole(bot: BotPlayerSnapshot, demand: BotRoleDemand): BotStrategicRole {
  const personality = getBotPersonality(bot);
  if (bot.heroId === 'chronos' && demand.support > 0) return 'support';
  if ((bot.heroId === 'phantom' || bot.heroId === 'hookshot') && demand.interceptors > 0) return 'interceptor';
  if (personality === 'defender' && demand.defenders > 0) return 'defender';
  if (personality === 'bodyguard' && demand.escorts > 0) return 'escort';
  if (bot.heroId === 'blaze') return 'fighter';
  if (bot.heroId === 'chronos') return 'support';
  return 'runner';
}

export function buildTeamTactics(input: BotTeamTacticsInput): BotTeamTacticsByTeam {
  return {
    red: buildTeamTacticsForTeam(input, 'red'),
    blue: buildTeamTacticsForTeam(input, 'blue'),
  };
}

function getAbilityState(bot: BotPlayerSnapshot, abilityId: string): BotAbilitySnapshot | null {
  return bot.abilities[abilityId] ?? null;
}

export function canUseBotAbility(bot: BotPlayerSnapshot, abilityId: string, slot: 'ability1' | 'ability2' | 'ultimate'): boolean {
  const state = getAbilityState(bot, abilityId);
  if (!state || state.isActive) return false;
  if (slot === 'ultimate' && bot.ultimateCharge < 100) return false;
  return state.cooldownRemaining <= 0 && state.charges > 0;
}

function pruneEnemyMemory(memory: Map<string, BotEnemyMemory>, now: number, skill: BotSkillProfile): void {
  for (const [enemyId, entry] of memory) {
    if (now - entry.lastSeenAt > skill.memoryMs) {
      memory.delete(enemyId);
    }
  }
}

function recentDamageSource(sources: readonly BotRecentDamageSource[], now: number): BotRecentDamageSource | null {
  let best: BotRecentDamageSource | null = null;
  for (const source of sources) {
    if (now - source.timestamp > 2600) continue;
    if (!best || source.timestamp > best.timestamp || (source.timestamp === best.timestamp && source.damage > best.damage)) {
      best = source;
    }
  }
  return best;
}

function buildAllyHealthDebts(
  bot: BotPlayerSnapshot,
  allies: readonly BotPlayerSnapshot[],
  visibleEnemies: readonly BotKnownEnemy[]
): BotAllyHealthDebt[] {
  return allies
    .filter((ally) => ally.id !== bot.id && ally.state === 'alive' && ally.health < ally.maxHealth)
    .map((ally) => {
      const missingHealth = Math.max(0, ally.maxHealth - ally.health);
      const nearestEnemyDistance = visibleEnemies.length
        ? Math.min(...visibleEnemies.map((enemy) => distance2D(ally.position, enemy.lastKnownPosition)))
        : Infinity;
      const speed = Math.sqrt(ally.velocity.x * ally.velocity.x + ally.velocity.z * ally.velocity.z);
      const retreating = nearestEnemyDistance < 18 && speed > 0.8 && distance2D(ally.position, bot.position) < distance2D({
        x: ally.position.x + ally.velocity.x,
        z: ally.position.z + ally.velocity.z,
      }, bot.position);
      const threatened = nearestEnemyDistance <= 18 || ally.hasFlag;
      const fighting = nearestEnemyDistance <= 24 && !retreating;
      const importance = (ally.hasFlag ? 1.65 : 1) * (threatened ? 1.32 : 1) * (fighting ? 1.12 : 1);
      return {
        playerId: ally.id,
        position: { ...ally.position },
        missingHealth,
        effectiveMissingHealth: missingHealth * importance,
        healthRatio: ally.health / Math.max(1, ally.maxHealth),
        distance: distance2D(bot.position, ally.position),
        isCarrier: ally.hasFlag,
        threatened,
        fighting,
        retreating,
      };
    })
    .sort((a, b) => b.effectiveMissingHealth - a.effectiveMissingHealth || a.distance - b.distance);
}

function buildHealCluster(bot: BotPlayerSnapshot, debts: readonly BotAllyHealthDebt[]): BotBlackboard['healCluster'] {
  if (debts.length === 0) return null;
  let best: BotBlackboard['healCluster'] = null;
  for (const anchor of debts) {
    const nearby = debts
      .filter((debt) => distance2D(anchor.position, debt.position) <= CHRONOS_LIFELINE_RADIUS * 1.25)
      .slice(0, CHRONOS_LIFELINE_MAX_TARGETS);
    const expectedHeal = nearby.reduce((sum, debt) => (
      sum + Math.min(CHRONOS_LIFELINE_ALLY_HEAL, debt.missingHealth) * (debt.effectiveMissingHealth / Math.max(1, debt.missingHealth))
    ), 0);
    const center = nearby.reduce<PlainVec3>((sum, debt) => ({
      x: sum.x + debt.position.x,
      y: sum.y + debt.position.y,
      z: sum.z + debt.position.z,
    }), { x: 0, y: 0, z: 0 });
    center.x /= nearby.length;
    center.y /= nearby.length;
    center.z /= nearby.length;
    const candidate = {
      center,
      expectedHeal,
      targetIds: nearby.map((debt) => debt.playerId),
      inRange: nearby.some((debt) => debt.distance <= CHRONOS_LIFELINE_RADIUS),
    };
    if (!best || candidate.expectedHeal > best.expectedHeal) {
      best = candidate;
    }
  }
  return best && distance2D(bot.position, best.center) <= CHRONOS_LIFELINE_RADIUS + 12 ? best : null;
}

export function buildBotBlackboard(input: BotBlackboardInput): BotBlackboard {
  const bot = input.bot;
  const team = bot.team;
  const enemyTeam = otherTeam(team);
  const allies = input.players.filter((player) => player.state === 'alive' && player.team === team && player.id !== bot.id);
  const enemyPlayers = input.players.filter((player) => player.state === 'alive' && player.team === enemyTeam);
  const ownFlag = input.flags[team];
  const enemyFlag = input.flags[enemyTeam];
  const visibleEnemies: BotKnownEnemy[] = [];
  const knownEnemies: BotKnownEnemy[] = [];

  pruneEnemyMemory(input.enemyMemory, input.now, input.skill);

  for (const enemy of enemyPlayers) {
    const objectiveVisible = Boolean(enemy.hasFlag);
    const visible = input.visibleEnemyIds.has(enemy.id) || objectiveVisible;
    const hasLineOfSight = input.enemyLineOfSightIds.has(enemy.id);
    if (visible) {
      input.enemyMemory.set(enemy.id, {
        enemyId: enemy.id,
        lastKnownPosition: { ...enemy.position },
        lastVelocity: { ...enemy.velocity },
        lastSeenAt: input.now,
        uncertaintyRadius: objectiveVisible && !input.visibleEnemyIds.has(enemy.id) ? 4 : 1.5,
        source: objectiveVisible && !input.visibleEnemyIds.has(enemy.id) ? 'objective' : 'visible',
      });
    }
    const memory = input.enemyMemory.get(enemy.id);
    if (!memory) continue;
    const known: BotKnownEnemy = {
      player: enemy,
      visible,
      lastKnownPosition: visible ? { ...enemy.position } : { ...memory.lastKnownPosition },
      distance: distance2D(bot.position, visible ? enemy.position : memory.lastKnownPosition),
      hasLineOfSight,
      memoryAgeMs: Math.max(0, input.now - memory.lastSeenAt),
      uncertaintyRadius: memory.uncertaintyRadius + Math.max(0, input.now - memory.lastSeenAt) / 1000 * 2.2,
    };
    knownEnemies.push(known);
    if (visible) visibleEnemies.push(known);
  }

  const recentDamage = recentDamageSource(input.recentDamageSources, input.now);
  if (recentDamage?.sourcePosition) {
    const existing = input.enemyMemory.get(recentDamage.sourceId);
    if (!existing || recentDamage.timestamp >= existing.lastSeenAt) {
      input.enemyMemory.set(recentDamage.sourceId, {
        enemyId: recentDamage.sourceId,
        lastKnownPosition: { ...recentDamage.sourcePosition },
        lastVelocity: { x: 0, y: 0, z: 0 },
        lastSeenAt: recentDamage.timestamp,
        uncertaintyRadius: 5.5,
        source: 'damage',
      });
    }
  }

  knownEnemies.sort((a, b) => a.distance - b.distance || a.player.id.localeCompare(b.player.id));
  const nearestEnemy = knownEnemies[0] ?? null;
  const weakestEnemy = [...knownEnemies]
    .filter((enemy) => enemy.distance <= BOT_AWARENESS_RANGE)
    .sort((a, b) => (
      a.player.health / Math.max(1, a.player.maxHealth) - b.player.health / Math.max(1, b.player.maxHealth)
      || a.distance - b.distance
      || a.player.id.localeCompare(b.player.id)
    ))[0] ?? null;
  const alliedCarrier = allies.find((ally) => ally.hasFlag) ?? null;
  const enemyCarrierPlayer = enemyPlayers.find((enemy) => enemy.hasFlag || ownFlag.carrierId === enemy.id) ?? null;
  const enemyCarrier = enemyCarrierPlayer
    ? knownEnemies.find((enemy) => enemy.player.id === enemyCarrierPlayer.id) ?? {
      player: enemyCarrierPlayer,
      visible: enemyCarrierPlayer.hasFlag,
      lastKnownPosition: { ...enemyCarrierPlayer.position },
      distance: distance2D(bot.position, enemyCarrierPlayer.position),
      hasLineOfSight: false,
      memoryAgeMs: 0,
      uncertaintyRadius: enemyCarrierPlayer.hasFlag ? 4 : 12,
    }
    : null;
  const nearestAlly = nearestPlayer(allies, bot.position);
  const nearbyRangeSq = 16 * 16;
  const nearbyEnemyCount = knownEnemies.filter((enemy) => {
    const dx = enemy.lastKnownPosition.x - bot.position.x;
    const dz = enemy.lastKnownPosition.z - bot.position.z;
    return dx * dx + dz * dz <= nearbyRangeSq;
  }).length;
  const nearbyAllyCount = allies.filter((ally) => {
    const dx = ally.position.x - bot.position.x;
    const dz = ally.position.z - bot.position.z;
    return dx * dx + dz * dz <= nearbyRangeSq;
  }).length;
  const allyHealthDebts = buildAllyHealthDebts(bot, allies, visibleEnemies);

  return {
    bot,
    team,
    enemyTeam,
    allies,
    enemies: knownEnemies,
    visibleEnemies,
    lastKnownEnemies: knownEnemies.filter((enemy) => !enemy.visible),
    nearestEnemy,
    weakestEnemy,
    enemyCarrier,
    nearestAlly,
    alliedCarrier,
    droppedFriendlyFlag: !ownFlag.isAtBase && !ownFlag.carrierId ? { ...ownFlag.position } : null,
    droppedEnemyFlag: !enemyFlag.isAtBase && !enemyFlag.carrierId ? { ...enemyFlag.position } : null,
    enemyFlagPosition: enemyFlag.carrierId
      ? { ...(input.players.find((player) => player.id === enemyFlag.carrierId)?.position ?? enemyFlag.position) }
      : { ...enemyFlag.position },
    ownBasePosition: { ...ownFlag.basePosition },
    ownFlagAtBase: ownFlag.isAtBase,
    enemyFlagAtBase: enemyFlag.isAtBase,
    nearbyEnemyCount,
    nearbyAllyCount,
    allyHealthDebts,
    healCluster: buildHealCluster(bot, allyHealthDebts),
    recentDamageSource: recentDamage,
    currentAssignment: input.teamTactics.assignments[bot.id] ?? null,
    teamTactics: input.teamTactics,
  };
}

function addIntent(candidates: BotIntentCandidate[], type: BotIntentType, score: number, targetPosition: PlainVec3, reason: string, targetPlayerId?: string): void {
  candidates.push({
    type,
    score,
    targetPosition: { ...targetPosition },
    targetPlayerId,
    reason,
  });
}

export function scoreBotIntents(bot: BotPlayerSnapshot, blackboard: BotBlackboard, skill: BotSkillProfile): BotIntentPlan {
  if (bot.state === 'dead') {
    return {
      ...createInitialIntent(bot.position),
      type: 'respawning',
      targetPosition: { ...bot.position },
      reason: 'bot is dead',
    };
  }
  if (!bot.heroId || bot.state === 'selecting') {
    return {
      ...createInitialIntent(bot.position),
      type: 'selecting',
      targetPosition: { ...bot.position },
      reason: 'hero selection',
    };
  }

  const assignment = blackboard.currentAssignment;
  const candidates: BotIntentCandidate[] = [];
  const healthRatio = bot.health / Math.max(1, bot.maxHealth);
  const nearestEnemyDistance = blackboard.nearestEnemy?.distance ?? Infinity;
  const assignmentBoost = (job: BotTacticsJob, amount: number): number => assignment?.job === job ? amount + assignment.priority * 0.22 : 0;
  const role = assignment?.role ?? getDefaultRole(bot, blackboard.teamTactics.roleDemand);

  if (bot.hasFlag) {
    addIntent(candidates, 'carry_flag_home', 10000, blackboard.ownBasePosition, 'bot is carrying enemy flag');
  }

  if (healthRatio < skill.retreatHealthRatio && nearestEnemyDistance < 24 && !blackboard.enemyCarrier) {
    addIntent(candidates, 'retreat', 820 + (1 - healthRatio) * 520, blackboard.ownBasePosition, 'low health under pressure');
  }

  if (blackboard.enemyCarrier) {
    addIntent(
      candidates,
      'intercept_enemy_carrier',
      720 + assignmentBoost('intercept_carrier', 280) + Math.max(0, 46 - blackboard.enemyCarrier.distance) * 5,
      blackboard.enemyCarrier.lastKnownPosition,
      'enemy flag carrier exists',
      blackboard.enemyCarrier.player.id
    );
  }

  if (blackboard.droppedFriendlyFlag) {
    addIntent(
      candidates,
      'return_dropped_friendly_flag',
      780 + assignmentBoost('return_flag', 320) - distance2D(bot.position, blackboard.droppedFriendlyFlag) * 2.2,
      blackboard.droppedFriendlyFlag,
      'friendly flag is dropped'
    );
  }

  if (blackboard.alliedCarrier) {
    const distanceToCarrier = distance2D(bot.position, blackboard.alliedCarrier.position);
    addIntent(
      candidates,
      'escort_allied_carrier',
      620 + assignmentBoost('escort_carrier', 280) + Math.max(0, skill.escortCommitDistance - distanceToCarrier) * 5,
      blackboard.alliedCarrier.position,
      'allied carrier needs escort',
      blackboard.alliedCarrier.id
    );
    addIntent(
      candidates,
      'pressure_lane',
      420 + assignmentBoost('clear_carrier_route', 240),
      blackboard.ownBasePosition,
      'clear route ahead of allied carrier',
      blackboard.alliedCarrier.id
    );
  }

  if (blackboard.healCluster && bot.heroId === 'chronos') {
    addIntent(
      candidates,
      'peel_for_ally',
      540 + assignmentBoost('support_cluster', 220) + blackboard.healCluster.expectedHeal * 1.3,
      blackboard.healCluster.center,
      'high-value heal cluster',
      blackboard.healCluster.targetIds[0]
    );
  }

  if (blackboard.nearestEnemy && nearestEnemyDistance <= getBotEngageRange(bot.heroId, skill)) {
    const focusBonus = blackboard.nearestEnemy.player.hasFlag ? 260 : 0;
    addIntent(
      candidates,
      'fight_local_enemy',
      410 + assignmentBoost('fight', 180) + focusBonus + Math.max(0, 24 - nearestEnemyDistance) * 7 * skill.aggression,
      blackboard.nearestEnemy.lastKnownPosition,
      'local enemy pressure',
      blackboard.nearestEnemy.player.id
    );
  }

  const assignedToDefend = assignment?.job === 'defend_base';
  const ownBaseThreatened = blackboard.teamTactics.ownFlagState !== 'safe'
    || Boolean(blackboard.droppedFriendlyFlag)
    || blackboard.enemies.some((enemy) => distance2D(enemy.lastKnownPosition, blackboard.ownBasePosition) <= 30);
  if (blackboard.ownFlagAtBase && (assignedToDefend || ownBaseThreatened)) {
    const score = (assignedToDefend ? 380 + assignmentBoost('defend_base', 260) : 520)
      + (blackboard.enemyFlagAtBase ? 40 : -30);
    addIntent(candidates, 'defend_base', score, assignment?.targetPosition ?? blackboard.ownBasePosition, 'base defense demand');
  }

  if (blackboard.droppedEnemyFlag) {
    addIntent(
      candidates,
      'capture_enemy_flag',
      500 + assignmentBoost('run_flag', 180) - distance2D(bot.position, blackboard.droppedEnemyFlag) * 1.4,
      blackboard.droppedEnemyFlag,
      'enemy flag dropped'
    );
  }

  addIntent(
    candidates,
    'capture_enemy_flag',
    340 + assignmentBoost('run_flag', 220) + (role === 'runner' ? 90 : 0) + (blackboard.enemyFlagAtBase ? 70 : -60),
    blackboard.enemyFlagPosition,
    'default flag pressure'
  );

  addIntent(candidates, 'regroup', 180 + (blackboard.nearbyAllyCount === 0 ? 120 : 0), assignment?.targetPosition ?? blackboard.ownBasePosition, 'low urgency regroup');

  candidates.sort((a, b) => b.score - a.score || a.type.localeCompare(b.type));
  const best = candidates[0] ?? {
    type: 'capture_enemy_flag' as const,
    score: 0,
    targetPosition: blackboard.enemyFlagPosition,
    reason: 'fallback',
  };

  return {
    ...best,
    role,
    job: assignment?.job ?? 'none',
    candidates,
  };
}

export function getBotPreferredCombatRange(heroId: HeroId | ''): number {
  switch (heroId) {
    case 'blaze':
      return 12;
    case 'hookshot':
      return 15;
    case 'phantom':
      return 18;
    default:
      return 13;
  }
}

export function getBotEngageRange(heroId: HeroId | '', skill: BotSkillProfile, primaryRange = 18): number {
  const preferredRange = getBotPreferredCombatRange(heroId);
  return Math.min(
    BOT_AWARENESS_RANGE,
    Math.max(18, primaryRange * (1.05 + skill.aggression * 0.18), preferredRange + 8)
  );
}

function nearestRouteNode(routeGraph: BotRouteGraphAdapter, position: PlainVec3): BotRouteNodeInfo | null {
  let best: BotRouteNodeInfo | null = null;
  let bestDistance = Infinity;
  for (const node of routeGraph.nodes) {
    const distance = distance2D(position, node.position);
    if (distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

function edgeCost(
  edge: BotRouteEdgeInfo,
  input: BotRoutePlanInput,
  routeGraph: BotRouteGraphAdapter
): number {
  const lane = routeGraph.lanes.get(edge.laneId);
  let cost = Math.max(edge.distance, edge.expectedTravelTimeSeconds * 7.2);
  const blockedUntil = input.blockedEdges.get(edge.id);
  if (blockedUntil && blockedUntil > input.now) cost += 900;
  if (edge.width < 4.4 && input.bot.hasFlag) cost *= 1.18;
  if (lane?.kind === 'flank') {
    if (input.intent.type === 'intercept_enemy_carrier' || input.intent.type === 'capture_enemy_flag') cost *= 0.88;
    if (input.bot.hasFlag) cost *= 0.94;
  }
  if (lane?.kind === 'primary') cost *= input.skill.directRouteBias;
  if (input.intent.type === 'defend_base' && edge.tags.includes('base')) cost *= 0.86;

  for (const cluster of input.blackboard.teamTactics.threatClusters) {
    const distance = distance2D(edge.midpoint, cluster.center);
    if (distance > cluster.radius + 8) continue;
    const influence = 1 - clamp((distance - cluster.radius) / 8, 0, 1);
    cost += cluster.threat * influence * 16 * input.skill.routeDangerWeight;
  }

  return cost;
}

export function planBotRoute(input: BotRoutePlanInput): BotRoutePlan {
  const targetPosition = input.intent.targetPosition;
  const routeGraph = input.routeGraph;
  if (!routeGraph || routeGraph.nodes.length === 0) {
    return {
      targetPosition: { ...targetPosition },
      steeringTarget: { ...targetPosition },
      pathNodeIds: [],
      nextNodeId: null,
      activeEdgeId: null,
      laneId: null,
      cost: distance2D(input.bot.position, targetPosition),
      expandedNodes: 0,
      capped: false,
      reason: 'no route graph',
      plannedAt: input.now,
    };
  }

  const startNode = nearestRouteNode(routeGraph, input.bot.position);
  const goalNode = nearestRouteNode(routeGraph, targetPosition);
  if (!startNode || !goalNode) {
    return {
      targetPosition: { ...targetPosition },
      steeringTarget: { ...targetPosition },
      pathNodeIds: [],
      nextNodeId: null,
      activeEdgeId: null,
      laneId: null,
      cost: distance2D(input.bot.position, targetPosition),
      expandedNodes: 0,
      capped: false,
      reason: 'missing route endpoint',
      plannedAt: input.now,
    };
  }

  const distances = new Map<string, number>([[startNode.id, 0]]);
  const previous = new Map<string, { nodeId: string; edge: BotRouteEdgeInfo }>();
  const open = new Set<string>([startNode.id]);
  let expandedNodes = 0;
  let capped = false;

  while (open.size > 0) {
    let currentId = '';
    let currentScore = Infinity;
    for (const nodeId of open) {
      const score = (distances.get(nodeId) ?? Infinity) + distance2D(routeGraph.nodeById.get(nodeId)?.position ?? targetPosition, goalNode.position) * 0.18;
      if (score < currentScore || (score === currentScore && nodeId < currentId)) {
        currentId = nodeId;
        currentScore = score;
      }
    }
    if (!currentId) break;
    open.delete(currentId);
    expandedNodes++;
    if (currentId === goalNode.id) break;
    if (expandedNodes >= input.skill.pathExpansionLimit) {
      capped = true;
      break;
    }
    const baseDistance = distances.get(currentId) ?? Infinity;
    for (const edge of routeGraph.adjacency.get(currentId) ?? []) {
      const nextDistance = baseDistance + edgeCost(edge, input, routeGraph);
      if (nextDistance >= (distances.get(edge.to) ?? Infinity)) continue;
      distances.set(edge.to, nextDistance);
      previous.set(edge.to, { nodeId: currentId, edge });
      open.add(edge.to);
    }
  }

  const pathNodeIds: string[] = [];
  const pathEdges: BotRouteEdgeInfo[] = [];
  let cursor = distances.has(goalNode.id) ? goalNode.id : startNode.id;
  if (!distances.has(goalNode.id)) {
    let bestNodeId = startNode.id;
    let bestScore = Infinity;
    for (const [nodeId, cost] of distances) {
      const node = routeGraph.nodeById.get(nodeId);
      if (!node) continue;
      const score = cost + distance2D(node.position, goalNode.position) * 2.5;
      if (score < bestScore) {
        bestScore = score;
        bestNodeId = nodeId;
      }
    }
    cursor = bestNodeId;
  }
  while (cursor) {
    pathNodeIds.push(cursor);
    const prev = previous.get(cursor);
    if (!prev) break;
    pathEdges.push(prev.edge);
    cursor = prev.nodeId;
  }
  pathNodeIds.reverse();
  pathEdges.reverse();

  let nextNodeId: string | null = null;
  let steeringTarget = { ...targetPosition };
  for (const nodeId of pathNodeIds) {
    const node = routeGraph.nodeById.get(nodeId);
    if (!node) continue;
    if (distance2D(input.bot.position, node.position) > 4.2) {
      nextNodeId = nodeId;
      steeringTarget = { ...node.position };
      break;
    }
  }
  if (!nextNodeId && distance2D(input.bot.position, targetPosition) > 6) {
    steeringTarget = { ...targetPosition };
  }

  const activeEdge = pathEdges[0] ?? null;
  return {
    targetPosition: { ...targetPosition },
    steeringTarget,
    pathNodeIds,
    nextNodeId,
    activeEdgeId: activeEdge?.id ?? null,
    laneId: activeEdge?.laneId ?? null,
    cost: distances.get(goalNode.id) ?? distance2D(input.bot.position, targetPosition),
    expandedNodes,
    capped,
    reason: capped ? 'route expansion cap reached' : 'planned route graph path',
    plannedAt: input.now,
  };
}

export function chooseBotCombatPlan(input: BotCombatPlanInput): BotCombatPlan {
  let bestTarget: BotKnownEnemy | null = null;
  let bestScore = -Infinity;
  for (const enemy of input.blackboard.enemies) {
    if (enemy.distance > BOT_AWARENESS_RANGE && !enemy.player.hasFlag) continue;
    const enemyHealthRatio = enemy.player.health / Math.max(1, enemy.player.maxHealth);
    let score = 0;
    if (enemy.player.hasFlag) score += 950;
    if (input.bot.hasFlag && enemy.distance < 24) score += 420;
    if (input.intent.type === 'intercept_enemy_carrier' && enemy.player.id === input.blackboard.enemyCarrier?.player.id) score += 520;
    if (input.intent.type === 'fight_local_enemy' && enemy.player.id === input.blackboard.nearestEnemy?.player.id) score += 130;
    if (enemy.player.id === input.blackboard.weakestEnemy?.player.id) score += 90;
    if (enemy.hasLineOfSight) score += 120;
    if (input.protectedEnemyIds.has(enemy.player.id)) score -= 260;
    if (input.focusTargetIds?.has(enemy.player.id)) score += input.skill.focusFireWeight * 120;
    score += (1 - enemyHealthRatio) * 180;
    score += Math.max(0, 28 - enemy.distance) * 4.5;
    score -= Math.max(0, enemy.distance - input.primaryRange) * (enemy.player.hasFlag ? 2 : 6);
    score -= enemy.memoryAgeMs / 1000 * 28;
    score *= input.skill.aggression;
    if (score > bestScore || (score === bestScore && enemy.player.id < (bestTarget?.player.id ?? '~'))) {
      bestScore = score;
      bestTarget = enemy;
    }
  }

  if (!bestTarget || bestScore <= 20) {
    return {
      targetId: null,
      stance: input.intent.type === 'retreat' ? 'retreat' : input.intent.type === 'escort_allied_carrier' ? 'escort' : 'hold_cover',
      score: 0,
      reason: 'no valuable combat target',
    };
  }

  const stance: BotCombatPlan['stance'] = input.intent.type === 'retreat'
    ? 'retreat'
    : input.intent.type === 'escort_allied_carrier'
      ? 'escort'
      : input.bot.hasFlag
        ? 'kite'
        : bestTarget.distance < input.preferredRange - 2
          ? 'kite'
          : bestTarget.distance > input.preferredRange + 4
            ? 'close'
            : 'strafe';

  return {
    targetId: bestTarget.player.id,
    stance,
    score: bestScore,
    reason: bestTarget.player.hasFlag ? 'focus carrier' : bestTarget.hasLineOfSight ? 'visible valuable target' : 'pursue remembered target',
  };
}

function abilityCandidate(
  current: BotAbilityPlan,
  candidate: BotAbilityPlan
): BotAbilityPlan {
  return candidate.score > current.score ? candidate : current;
}

function scoreChronosAbility(input: BotAbilityPlanInput, current: BotAbilityPlan): BotAbilityPlan {
  if (input.bot.heroId !== 'chronos') return current;
  let best = current;
  const canLifeline = canUseBotAbility(input.bot, 'chronos_lifeline_conduit', 'ability1');
  const inRangeDebts = input.blackboard.allyHealthDebts
    .filter((debt) => debt.distance <= CHRONOS_LIFELINE_RADIUS)
    .slice(0, CHRONOS_LIFELINE_MAX_TARGETS);
  const allyHealValue = inRangeDebts.reduce((sum, debt) => {
    const actualHeal = Math.min(CHRONOS_LIFELINE_ALLY_HEAL, debt.missingHealth);
    return sum + actualHeal * (debt.effectiveMissingHealth / Math.max(1, debt.missingHealth));
  }, 0);
  const criticalAlly = inRangeDebts.find((debt) => debt.healthRatio < 0.35 || (debt.isCarrier && debt.healthRatio < 0.7 && debt.threatened));
  if (canLifeline && (allyHealValue >= input.skill.minHealValue || criticalAlly)) {
    best = abilityCandidate(best, {
      mode: 'chronos_lifeline_allies',
      slot: 'ability1',
      score: allyHealValue + (criticalAlly ? 90 : 0),
      reason: criticalAlly ? 'critical ally heal' : 'high expected ally healing',
      targetPlayerId: criticalAlly?.playerId ?? inRangeDebts[0]?.playerId,
      targetPosition: criticalAlly?.position ?? inRangeDebts[0]?.position,
    });
  }

  const selfMissing = Math.max(0, input.bot.maxHealth - input.bot.health);
  const selfHealthRatio = input.bot.health / Math.max(1, input.bot.maxHealth);
  const selfValue = Math.min(CHRONOS_LIFELINE_SELF_HEAL, selfMissing) * (input.blackboard.nearbyEnemyCount > 0 ? 1.65 : 1);
  if (canLifeline && selfValue >= Math.max(24, input.skill.minHealValue * 0.42) && selfValue > allyHealValue * 0.72) {
    best = abilityCandidate(best, {
      mode: 'chronos_lifeline_self',
      slot: 'ability1',
      score: selfValue + (selfHealthRatio < 0.35 ? 58 : 0) + (input.blackboard.nearbyEnemyCount > 0 ? 18 : 0),
      reason: 'self heal is higher value than available ally heal',
    });
  }

  const nearestThreat = input.blackboard.nearestEnemy;
  if (
    canUseBotAbility(input.bot, 'chronos_timebreak', 'ability2') &&
    nearestThreat &&
    nearestThreat.distance <= CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE + 2 &&
    (input.intent.type === 'peel_for_ally' || input.intent.type === 'escort_allied_carrier' || input.blackboard.nearbyEnemyCount >= 2 || input.bot.health / Math.max(1, input.bot.maxHealth) < 0.45)
  ) {
    best = abilityCandidate(best, {
      mode: 'chronos_timebreak',
      slot: 'ability2',
      score: 95 + Math.max(0, CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE + 2 - nearestThreat.distance) * 8 + input.blackboard.nearbyEnemyCount * 28,
      reason: 'peel nearby threat',
      targetPlayerId: nearestThreat.player.id,
      targetPosition: nearestThreat.lastKnownPosition,
    });
  }

  if (
    canUseBotAbility(input.bot, 'chronos_ascendant_paradox', 'ultimate') &&
    (input.blackboard.nearbyEnemyCount >= 2 || (input.intent.type === 'defend_base' && input.blackboard.enemies.some((enemy) => distance2D(enemy.lastKnownPosition, input.blackboard.ownBasePosition) < 18)))
  ) {
    best = abilityCandidate(best, {
      mode: 'chronos_ascendant',
      slot: 'ultimate',
      score: 135 + input.blackboard.nearbyEnemyCount * 36,
      reason: 'objective air pressure',
    });
  }

  if (
    input.blackboard.nearestEnemy &&
    input.blackboard.nearestEnemy.distance <= 22 &&
    input.geometry.anchorWallProtectsAlly &&
    !input.geometry.anchorWallBlocksFriendlyCarrier
  ) {
    best = abilityCandidate(best, {
      mode: 'chronos_aegis',
      slot: 'secondary',
      score: 82 + (input.intent.type === 'escort_allied_carrier' ? 40 : 0),
      reason: 'shield line protects ally behind Chronos',
      targetPlayerId: input.blackboard.alliedCarrier?.id,
    });
  }

  return best;
}

function scorePhantomAbility(input: BotAbilityPlanInput, current: BotAbilityPlan): BotAbilityPlan {
  if (input.bot.heroId !== 'phantom') return current;
  let best = current;
  const healthRatio = input.bot.health / Math.max(1, input.bot.maxHealth);
  const objective = input.intent.type === 'capture_enemy_flag' || input.intent.type === 'carry_flag_home' || input.intent.type === 'intercept_enemy_carrier';
  if (
    canUseBotAbility(input.bot, 'phantom_blink', 'ability1') &&
    input.geometry.blinkSafe &&
    !input.geometry.blinkDangerous &&
    (objective || input.geometry.directPathBlocked || healthRatio < 0.42)
  ) {
    best = abilityCandidate(best, {
      mode: 'phantom_blink',
      slot: 'ability1',
      score: 88 + (objective ? 36 : 0) + (input.geometry.directPathBlocked ? 45 : 0) + (healthRatio < 0.42 ? 42 : 0),
      reason: objective ? 'blink advances objective route' : 'blink recovers positioning',
      targetPosition: input.intent.targetPosition,
    });
  }

  if (
    canUseBotAbility(input.bot, 'phantom_personal_shield', 'ability2') &&
    input.combatPlan.targetId &&
    (healthRatio < 0.55 || input.intent.type === 'intercept_enemy_carrier' || input.bot.hasFlag)
  ) {
    best = abilityCandidate(best, {
      mode: 'phantom_shield',
      slot: 'ability2',
      score: 82 + (input.bot.hasFlag ? 52 : 0) + (healthRatio < 0.55 ? 36 : 0),
      reason: 'committed duel needs shield',
      targetPlayerId: input.combatPlan.targetId,
    });
  }

  if (
    canUseBotAbility(input.bot, 'phantom_veil', 'ultimate') &&
    (input.bot.hasFlag || input.intent.type === 'capture_enemy_flag' || healthRatio < 0.35)
  ) {
    best = abilityCandidate(best, {
      mode: 'phantom_veil',
      slot: 'ultimate',
      score: 132 + (input.bot.hasFlag ? 80 : 0),
      reason: input.bot.hasFlag ? 'veil enables flag escape' : 'veil enables objective pressure',
      targetPosition: input.intent.targetPosition,
    });
  }

  return best;
}

function countVisibleEnemiesNear(input: BotAbilityPlanInput, position: PlainVec3, radius: number): number {
  return input.blackboard.visibleEnemies.filter((enemy) => distance2D(enemy.lastKnownPosition, position) <= radius).length;
}

function hasVisibleObjectiveContest(input: BotAbilityPlanInput, position = input.intent.targetPosition, radius = 16): boolean {
  return countVisibleEnemiesNear(input, position, radius) > 0
    || Boolean(input.blackboard.enemyCarrier && distance2D(input.blackboard.enemyCarrier.lastKnownPosition, position) <= radius + 8);
}

function scoreHookshotAbility(input: BotAbilityPlanInput, current: BotAbilityPlan): BotAbilityPlan {
  if (input.bot.heroId !== 'hookshot') return current;
  let best = current;
  const objective = input.intent.type === 'capture_enemy_flag' || input.intent.type === 'carry_flag_home' || input.intent.type === 'intercept_enemy_carrier';
  if (
    canUseBotAbility(input.bot, 'hookshot_grapple', 'ability1') &&
    input.geometry.grappleAnchorAvailable &&
    (objective || input.geometry.movementProgressBlocked || input.intent.type === 'retreat')
  ) {
    best = abilityCandidate(best, {
      mode: 'hookshot_grapple',
      slot: 'ability1',
      score: 90 + (objective ? 42 : 0) + (input.geometry.movementProgressBlocked ? 44 : 0),
      reason: 'grapple improves route progress',
      targetPosition: input.intent.targetPosition,
    });
  }

  if (
    canUseBotAbility(input.bot, 'hookshot_anchor_wall', 'ability2') &&
    input.blackboard.nearestEnemy &&
    input.blackboard.nearestEnemy.distance <= 30 &&
    input.geometry.anchorWallProtectsAlly &&
    !input.geometry.anchorWallBlocksFriendlyCarrier
  ) {
    best = abilityCandidate(best, {
      mode: 'hookshot_anchor_wall',
      slot: 'ability2',
      score: 94 + (input.intent.type === 'escort_allied_carrier' ? 54 : 0),
      reason: 'anchor wall protects route or splits chase',
      targetPlayerId: input.blackboard.nearestEnemy.player.id,
    });
  }

  if (
    canUseBotAbility(input.bot, 'hookshot_grapple_trap', 'ultimate') &&
    (
      input.geometry.trapZoneValuable ||
      input.intent.type === 'return_dropped_friendly_flag' ||
      input.blackboard.nearbyEnemyCount >= 2 ||
      hasVisibleObjectiveContest(input, input.intent.targetPosition, 14)
    )
  ) {
    best = abilityCandidate(best, {
      mode: 'hookshot_trap',
      slot: 'ultimate',
      score: 130 + input.blackboard.nearbyEnemyCount * 34 + (input.geometry.trapZoneValuable ? 58 : 0),
      reason: 'trap controls objective zone',
      targetPosition: input.intent.targetPosition,
    });
  }

  return best;
}

function scoreBlazeAbility(input: BotAbilityPlanInput, current: BotAbilityPlan): BotAbilityPlan {
  if (input.bot.heroId !== 'blaze') return current;
  let best = current;
  const target = input.combatPlan.targetId
    ? input.blackboard.enemies.find((enemy) => enemy.player.id === input.combatPlan.targetId)
    : null;
  if (
    canUseBotAbility(input.bot, 'blaze_flamethrower', 'ability1') &&
    target &&
    target.visible &&
    target.hasLineOfSight &&
    target.distance <= BLAZE_FLAMETHROWER_RANGE * 0.94
  ) {
    best = abilityCandidate(best, {
      mode: 'blaze_flamethrower',
      slot: 'ability1',
      score: 86 + Math.max(0, BLAZE_FLAMETHROWER_RANGE - target.distance) * 8 + (target.player.hasFlag ? 55 : 0),
      reason: 'close sustained cone target',
      targetPlayerId: target.player.id,
      targetPosition: target.lastKnownPosition,
      holdMs: 450,
    });
  }

  const healthRatio = input.bot.health / Math.max(1, input.bot.maxHealth);
  if (
    canUseBotAbility(input.bot, 'blaze_rocketjump', 'ability2') &&
    (input.geometry.movementProgressBlocked || input.intent.type === 'retreat' || input.intent.type === 'intercept_enemy_carrier' || healthRatio < 0.34)
  ) {
    best = abilityCandidate(best, {
      mode: 'blaze_rocketjump',
      slot: 'ability2',
      score: 84 + (input.geometry.movementProgressBlocked ? 48 : 0) + (healthRatio < 0.34 ? 48 : 0),
      reason: 'rocket jump for repositioning',
      targetPosition: input.intent.targetPosition,
    });
  }

  if (
    input.blackboard.visibleEnemies.length >= 2 ||
    (target && target.distance > BLAZE_FLAMETHROWER_RANGE && target.distance <= 38 && target.hasLineOfSight && (target.player.hasFlag || input.intent.type === 'defend_base'))
  ) {
    best = abilityCandidate(best, {
      mode: 'blaze_bomb',
      slot: 'secondary',
      score: 78 + input.blackboard.visibleEnemies.length * 26 + (target?.player.hasFlag ? 45 : 0),
      reason: 'bomb valuable cluster or objective target',
      targetPlayerId: target?.player.id,
      targetPosition: target?.lastKnownPosition ?? input.intent.targetPosition,
      holdMs: 120,
    });
  }

  const nearbyVisibleEnemyCount = input.blackboard.visibleEnemies.filter((enemy) => enemy.distance <= BLAZE_GEARSTORM_RADIUS + 4).length;
  const objectiveVisibleEnemyCount = countVisibleEnemiesNear(input, input.intent.targetPosition, BLAZE_GEARSTORM_RADIUS + 4);
  const airstrikeControlsCarrier = Boolean(
    target?.player.hasFlag ||
    (input.blackboard.enemyCarrier && input.intent.type === 'intercept_enemy_carrier' && input.blackboard.enemyCarrier.distance <= BLAZE_GEARSTORM_RADIUS + 10)
  );
  if (
    canUseBotAbility(input.bot, 'blaze_airstrike', 'ultimate') &&
    (
      nearbyVisibleEnemyCount >= 2 ||
      objectiveVisibleEnemyCount >= 2 ||
      airstrikeControlsCarrier ||
      (input.intent.type === 'return_dropped_friendly_flag' && hasVisibleObjectiveContest(input, input.intent.targetPosition, BLAZE_GEARSTORM_RADIUS + 4))
    )
  ) {
    best = abilityCandidate(best, {
      mode: 'blaze_airstrike',
      slot: 'ultimate',
      score: 138 + Math.max(nearbyVisibleEnemyCount, objectiveVisibleEnemyCount) * 38 + (airstrikeControlsCarrier ? 52 : 0),
      reason: 'ultimate affects objective fight',
      targetPosition: input.intent.targetPosition,
    });
  }

  return best;
}

export function chooseBotAbilityPlan(input: BotAbilityPlanInput): BotAbilityPlan {
  let best: BotAbilityPlan = {
    mode: 'none',
    slot: null,
    score: 0,
    reason: 'no valuable ability',
  };
  best = scoreChronosAbility(input, best);
  best = scorePhantomAbility(input, best);
  best = scoreHookshotAbility(input, best);
  best = scoreBlazeAbility(input, best);

  const threshold = best.slot === 'ultimate'
    ? input.skill.abilityScoreThreshold + 34
    : best.slot === 'secondary' && best.mode !== 'chronos_aegis'
      ? input.skill.abilityScoreThreshold - 8
      : input.skill.abilityScoreThreshold;
  return best.score >= threshold ? best : {
    mode: 'none',
    slot: null,
    score: best.score,
    reason: `best candidate below threshold: ${best.reason}`,
  };
}

export function composeBotMovementDirection(
  bot: BotPlayerSnapshot,
  brain: Pick<BotBrain, 'strafeDirection'>,
  intent: BotIntentPlan,
  routePlan: BotRoutePlan,
  combatTarget: BotPlayerSnapshot | null,
  blackboard: BotBlackboard,
  skill: BotSkillProfile
): PlainVec2 | null {
  const objectiveDir = direction2DFromTo(bot.position, routePlan.steeringTarget);
  let move: PlainVec2 = objectiveDir ? { ...objectiveDir } : { x: 0, z: 0 };

  if (intent.type === 'defend_base' && !combatTarget && distance2D(bot.position, routePlan.steeringTarget) < 5) {
    const orbit = direction2DFromTo(routePlan.steeringTarget, bot.position) || { x: -Math.sin(bot.lookYaw), z: -Math.cos(bot.lookYaw) };
    move = { x: -orbit.z * brain.strafeDirection, z: orbit.x * brain.strafeDirection };
  }

  if (combatTarget) {
    const toEnemy = direction2DFromTo(bot.position, combatTarget.position) || { x: -Math.sin(bot.lookYaw), z: -Math.cos(bot.lookYaw) };
    const awayFromEnemy = { x: -toEnemy.x, z: -toEnemy.z };
    const strafe = { x: -toEnemy.z * brain.strafeDirection, z: toEnemy.x * brain.strafeDirection };
    const distance = distance2D(bot.position, combatTarget.position);
    const preferredRange = getBotPreferredCombatRange(bot.heroId) * skill.preferredRangeScale;
    let rangeMove: PlainVec2 = { x: 0, z: 0 };

    if (distance > preferredRange + 3) {
      rangeMove = toEnemy;
    } else if (distance < Math.max(2.2, preferredRange - 2)) {
      rangeMove = awayFromEnemy;
    }

    if (intent.type === 'carry_flag_home' || intent.type === 'return_dropped_friendly_flag') {
      move = mix2D(move, 1.35, rangeMove, 0.45);
      move = mix2D(move, 1, strafe, 0.25);
    } else if (intent.type === 'retreat') {
      move = mix2D(move, 1.2, awayFromEnemy, 0.65);
      move = mix2D(move, 1, strafe, 0.25);
    } else if (intent.type === 'escort_allied_carrier') {
      move = mix2D(move, 0.95, rangeMove, 0.55);
      move = mix2D(move, 1, strafe, 0.35);
    } else if (intent.type === 'intercept_enemy_carrier') {
      move = mix2D(toEnemy, 1.25, strafe, 0.18);
    } else {
      move = mix2D(rangeMove, 1, strafe, distance < preferredRange + 6 ? 0.7 : 0.28);
    }
  }

  if (bot.heroId === 'chronos' && blackboard.healCluster && !blackboard.healCluster.inRange && blackboard.healCluster.expectedHeal >= skill.minHealValue) {
    const toCluster = direction2DFromTo(bot.position, blackboard.healCluster.center);
    if (toCluster) move = mix2D(move, 0.8, toCluster, 0.7);
  }

  for (const ally of blackboard.allies) {
    const distance = distance2D(bot.position, ally.position);
    if (distance <= 0.001 || distance > 2.4) continue;
    const away = direction2DFromTo(ally.position, bot.position);
    if (away) move = mix2D(move, 1, away, (2.4 - distance) * 0.35);
  }

  for (const enemy of blackboard.visibleEnemies) {
    const distance = distance2D(bot.position, enemy.lastKnownPosition);
    if (distance <= 0.001 || distance > 1.6) continue;
    const away = direction2DFromTo(enemy.lastKnownPosition, bot.position);
    if (away) move = mix2D(move, 1, away, (1.6 - distance) * 0.45);
  }

  return normalize2D(move);
}

function rotate2D(direction: PlainVec2, radians: number): PlainVec2 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: direction.x * cos - direction.z * sin,
    z: direction.x * sin + direction.z * cos,
  };
}

export function createSteeringProbeDirections(direction: PlainVec2 | null): Array<Omit<BotSteeringProbe, 'clear' | 'distance'>> {
  const base = direction ? normalize2D(direction) : null;
  if (!base) return [];
  return [
    { direction: base, label: 'direct' as const },
    { direction: rotate2D(base, -Math.PI / 5), label: 'left' as const },
    { direction: rotate2D(base, Math.PI / 5), label: 'right' as const },
    { direction: rotate2D(base, -Math.PI / 2.8), label: 'wide_left' as const },
    { direction: rotate2D(base, Math.PI / 2.8), label: 'wide_right' as const },
    { direction: { x: -base.x, z: -base.z }, label: 'back' as const },
  ];
}

export function chooseLocalAvoidanceDirection(
  desiredDirection: PlainVec2 | null,
  probes: readonly BotSteeringProbe[],
  skill: BotSkillProfile
): BotSteeringChoice {
  if (!desiredDirection) {
    return { direction: null, blocked: false, jump: false, reason: 'no desired direction' };
  }
  const normalized = normalize2D(desiredDirection);
  if (!normalized) {
    return { direction: null, blocked: false, jump: false, reason: 'zero desired direction' };
  }
  const direct = probes.find((probe) => probe.label === 'direct');
  if (!direct || direct.clear) {
    return { direction: normalized, blocked: false, jump: false, reason: 'direct path clear' };
  }

  let best: BotSteeringProbe | null = null;
  let bestScore = -Infinity;
  for (const probe of probes) {
    if (!probe.clear) continue;
    const progressDot = probe.direction.x * normalized.x + probe.direction.z * normalized.z;
    const sidePenalty = probe.label === 'back' ? 38 : probe.label.startsWith('wide') ? 7 : 0;
    const score = progressDot * 100 + probe.distance * 8 - sidePenalty + skill.directRouteBias * 8;
    if (score > bestScore) {
      best = probe;
      bestScore = score;
    }
  }
  if (!best) {
    return {
      direction: { x: -normalized.x, z: -normalized.z },
      blocked: true,
      jump: true,
      reason: 'all probes blocked, reversing as last resort',
    };
  }
  return {
    direction: best.direction,
    blocked: true,
    jump: best.label !== 'back',
    reason: `direct path blocked, selected ${best.label}`,
  };
}

export function updateBotMovementProgress(
  progress: BotMovementProgress,
  now: number,
  position: PlainVec3,
  desiredTarget: PlainVec3,
  activeEdgeId: string | null,
  desiredDirection: PlainVec2 | null,
  directBlocked: boolean,
  skill: BotSkillProfile
): { stalled: boolean; markBlockedEdgeId: string | null } {
  const targetChanged = !progress.desiredTarget || distance2D(progress.desiredTarget, desiredTarget) > 3.5;
  const currentDistance = distance2D(position, desiredTarget);
  if (targetChanged) {
    progress.desiredTarget = { ...desiredTarget };
    progress.lastPosition = { ...position };
    progress.lastDistanceToTarget = currentDistance;
    progress.lastProgressAt = now;
    progress.stalledMs = 0;
    progress.blockerDirection = null;
    progress.failedEdgeId = null;
    return { stalled: false, markBlockedEdgeId: null };
  }

  const movedDistance = distance2D(position, progress.lastPosition);
  const madeProgress = progress.lastDistanceToTarget - currentDistance;
  if (madeProgress > 0.24 || movedDistance > 0.45) {
    progress.lastPosition = { ...position };
    progress.lastDistanceToTarget = currentDistance;
    progress.lastProgressAt = now;
    progress.stalledMs = 0;
    progress.blockerDirection = null;
    progress.failedEdgeId = null;
    return { stalled: false, markBlockedEdgeId: null };
  }

  const elapsed = Math.max(0, now - progress.lastProgressAt);
  progress.stalledMs = elapsed;
  if (directBlocked && desiredDirection) {
    progress.blockerDirection = { ...desiredDirection };
  }
  const stalled = elapsed >= Math.max(420, skill.replanIntervalMs * 1.25);
  const markBlockedEdgeId = stalled && activeEdgeId ? activeEdgeId : null;
  if (markBlockedEdgeId) progress.failedEdgeId = markBlockedEdgeId;
  return { stalled, markBlockedEdgeId };
}

export function clearExpiredBlockedEdges(blockedEdges: Map<string, number>, now: number): void {
  for (const [edgeId, expiresAt] of blockedEdges) {
    if (expiresAt <= now) blockedEdges.delete(edgeId);
  }
}
