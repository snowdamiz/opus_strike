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
  type GameplayMode,
  type HeroId,
  type PlayerInput,
  type Team,
  type VoxelMapManifest,
} from '@voxel-strike/shared';
import {
  getForwardVector,
  normalizeAngle,
  rotateAngleToward,
} from '../roomMath';

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
  gameplayMode: GameplayMode;
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
  gameplayMode: GameplayMode;
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
  cacheKey?: string;
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
  | 'hookshot_ground_hooks'
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

export interface BotSecondaryAttackTiming {
  range: number;
  cooldownMs: number;
}

export interface BotPrimaryFireDecisionInput {
  brain: BotBrain;
  skill: BotSkillProfile;
  now: number;
  aimReady: boolean;
  tempoMultiplier: number;
  random?: () => number;
}

export interface BotCombatEngagementInput {
  hasCombatTarget: boolean;
  enemyDistance: number;
  attackRange: number;
  hasClearShot: boolean;
  targetProtected: boolean;
  primaryAimReady: boolean;
}

export interface BotCombatEngagementState {
  shouldFight: boolean;
  aimReady: boolean;
}

export interface BotAimLeadInput {
  sourcePosition: PlainVec3;
  targetPosition: PlainVec3;
  targetVelocity: PlainVec3;
  targetDistance?: number;
  skill: BotSkillProfile;
}

export interface BotAimAngles {
  yaw: number;
  pitch: number;
}

export interface BotAimUpdateInput {
  brain: BotBrain;
  skill: BotSkillProfile;
  desiredAim: BotAimAngles;
  currentYaw: number;
  currentPitch: number;
  targetDistance: number | null;
  now: number;
  dt: number;
  random?: () => number;
}

export interface BotAimReadinessTraceInput {
  origin: PlainVec3;
  yaw: number;
  pitch: number;
  attackRange: number;
  attackCollisionRadius?: number;
  hitboxPadding: number;
  skill: BotSkillProfile;
}

export interface BotAimReadinessTrace {
  origin: PlainVec3;
  direction: PlainVec3;
  range: number;
  extraRadius: number;
}

export interface BotSecondaryFireWindowInput {
  brain: Pick<BotBrain, 'nextSecondaryAt'>;
  now: number;
  shouldFight: boolean;
  heroId: HeroId | '';
  secondaryAttack?: BotSecondaryAttackTiming | null;
  enemyDistance: number;
}

export interface BotSecondaryFireDecisionInput extends BotSecondaryFireWindowInput {
  brain: BotBrain;
  skill: BotSkillProfile;
  aimReady: boolean;
  tempoMultiplier: number;
  random?: () => number;
}

export interface BotLocomotionActionInput {
  botId: string;
  position: PlainVec3;
  hasFlag: boolean;
  isGrounded: boolean;
  previousCrouch?: boolean | null;
  intentType: BotIntentType;
  steeringTarget: PlainVec3;
  steeringJump: boolean;
  stalled: boolean;
  hasCombatTarget: boolean;
  now: number;
}

export interface BotLocomotionActionState {
  sprint: boolean;
  jump: boolean;
  crouch: boolean;
  crouchPressed: boolean;
}

export interface BotInputMovementStateInput extends BotLocomotionActionInput {
  lookYaw: number;
  desiredMove: PlainVec2 | null;
  recovering: boolean;
  strafeDirection: -1 | 1;
}

export interface BotInputMovementState extends BotLocomotionActionState {
  moveForward: boolean;
  moveBackward: boolean;
  moveLeft: boolean;
  moveRight: boolean;
}

export interface BotAbilityInputPlanInput {
  input: PlayerInput;
  brain: BotBrain;
  plan: BotAbilityPlan;
  skill: BotSkillProfile;
  now: number;
  tempoMultiplier: number;
  random?: () => number;
}

export interface BotPlanningStateInput {
  brain: BotBrain;
  now: number;
  gameplayMode: GameplayMode;
  bot: BotPlayerSnapshot;
  players: BotPlayerSnapshot[];
  flags: Record<Team, BotFlagSnapshot>;
  visibleEnemyIds: Set<string>;
  enemyLineOfSightIds: Set<string>;
  recentDamageSources: BotRecentDamageSource[];
  teamTactics: BotTeamTactics;
  routeGraph: BotRouteGraphAdapter | null;
  skill: BotSkillProfile;
  random?: () => number;
}

export interface BotPlanningStateResult {
  blackboard: BotBlackboard;
  routePlan: BotRoutePlan;
}

export interface BotMovementRecoveryInput {
  brain: BotBrain;
  now: number;
  bot: BotPlayerSnapshot;
  blackboard: BotBlackboard;
  routeGraph: BotRouteGraphAdapter | null;
  routePlan: BotRoutePlan;
  desiredMove: PlainVec2 | null;
  steeringBlocked: boolean;
  skill: BotSkillProfile;
  random?: () => number;
}

export interface BotMovementRecoveryResult {
  stalled: boolean;
  markBlockedEdgeId: string | null;
  routePlan: BotRoutePlan;
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
  groundHooksValuable: boolean;
}

export interface BotTeamTacticsInput {
  now: number;
  revision: number;
  gameplayMode: GameplayMode;
  players: BotPlayerSnapshot[];
  flags: Record<Team, BotFlagSnapshot>;
}

export interface BotBlackboardInput {
  now: number;
  gameplayMode: GameplayMode;
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
  previousPlan?: BotRoutePlan | null;
}

export interface BotCombatPlanInput {
  bot: BotPlayerSnapshot;
  intent: BotIntentPlan;
  blackboard: BotBlackboard;
  skill: BotSkillProfile;
  primaryRange: number;
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
export const BOT_TACTICS_INTERVAL_MS = 420;

export const BOT_SKILL_PROFILES: Record<BotDifficulty, BotSkillProfile> = {
  easy: {
    thinkIntervalMs: 360,
    reactionMs: 430,
    turnRateRadians: 4.2,
    aimLeadSeconds: 0.02,
    aimErrorRadians: 0.18,
    aimJitterRefreshMs: [420, 860],
    aimFireToleranceScale: 1.12,
    fireChance: 0.4,
    secondaryChance: 0.22,
    fireDecisionMs: [360, 720],
    burstDurationMs: [180, 420],
    abilityCadenceMs: [1500, 2600],
    ultimateCadenceMs: [2200, 3800],
    preferredRangeScale: 1.04,
    aggression: 0.62,
    retreatHealthRatio: 0.46,
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
    reactionMs: 280,
    turnRateRadians: 7.2,
    aimLeadSeconds: 0.1,
    aimErrorRadians: 0.105,
    aimJitterRefreshMs: [320, 680],
    aimFireToleranceScale: 1,
    fireChance: 0.56,
    secondaryChance: 0.36,
    fireDecisionMs: [300, 620],
    burstDurationMs: [200, 540],
    abilityCadenceMs: [1100, 2100],
    ultimateCadenceMs: [1600, 3000],
    preferredRangeScale: 1.08,
    aggression: 0.84,
    retreatHealthRatio: 0.38,
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
    reactionMs: 180,
    turnRateRadians: 9.5,
    aimLeadSeconds: 0.17,
    aimErrorRadians: 0.06,
    aimJitterRefreshMs: [260, 520],
    aimFireToleranceScale: 0.98,
    fireChance: 0.72,
    secondaryChance: 0.5,
    fireDecisionMs: [220, 440],
    burstDurationMs: [260, 680],
    abilityCadenceMs: [760, 1550],
    ultimateCadenceMs: [1200, 2400],
    preferredRangeScale: 1.12,
    aggression: 1.02,
    retreatHealthRatio: 0.31,
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

export function shouldRefreshBotPlanningState(brain: BotBrain, now: number): boolean {
  return !brain.blackboard || now >= brain.nextBlackboardAt || now >= brain.nextThinkAt;
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

export function updateBotPrimaryFireDecision(input: BotPrimaryFireDecisionInput): boolean {
  const { brain, skill, now, aimReady, tempoMultiplier } = input;
  const random = input.random ?? Math.random;

  if (now >= brain.nextFireDecisionAt) {
    brain.nextFireDecisionAt = now + randomBetweenWith(random, skill.fireDecisionMs[0], skill.fireDecisionMs[1]) / tempoMultiplier;
    if (aimReady && random() < skill.fireChance) {
      brain.fireUntil = now + randomBetweenWith(random, skill.burstDurationMs[0], skill.burstDurationMs[1]) / tempoMultiplier;
    }
  }

  return aimReady && now < brain.fireUntil;
}

export function getBotCombatEngagementState(input: BotCombatEngagementInput): BotCombatEngagementState {
  const shouldFight = Boolean(
    input.hasCombatTarget
    && input.enemyDistance <= input.attackRange
    && input.hasClearShot
    && !input.targetProtected
  );

  return {
    shouldFight,
    aimReady: shouldFight && input.primaryAimReady,
  };
}

export function getBotPredictedAimPoint(input: BotAimLeadInput): PlainVec3 {
  const targetDistance = input.targetDistance ?? distance3D(input.sourcePosition, input.targetPosition);
  const reactionLag = input.skill.reactionMs / 1000;
  const leadSeconds = clamp(
    input.skill.aimLeadSeconds + targetDistance / 160 - reactionLag * 0.45,
    -0.22,
    0.42
  );

  return {
    x: input.targetPosition.x + input.targetVelocity.x * leadSeconds,
    y: input.targetPosition.y + input.targetVelocity.y * leadSeconds,
    z: input.targetPosition.z + input.targetVelocity.z * leadSeconds,
  };
}

export function getBotYawPitchTowardPosition(sourcePosition: PlainVec3, targetPosition: PlainVec3): BotAimAngles {
  const dx = targetPosition.x - sourcePosition.x;
  const dy = targetPosition.y - sourcePosition.y;
  const dz = targetPosition.z - sourcePosition.z;
  const horizontal = Math.sqrt(dx * dx + dz * dz);
  return {
    yaw: Math.atan2(-dx, -dz),
    pitch: clamp(Math.atan2(dy, horizontal), -0.8, 0.8),
  };
}

export function updateBotAimState(input: BotAimUpdateInput): BotAimAngles {
  const { brain, skill, desiredAim, currentYaw, currentPitch, targetDistance, now, dt } = input;
  const random = input.random ?? Math.random;

  if (!Number.isFinite(brain.aimYaw)) brain.aimYaw = currentYaw;
  if (!Number.isFinite(brain.aimPitch)) brain.aimPitch = currentPitch;

  if (targetDistance !== null && Number.isFinite(targetDistance) && now >= brain.nextAimJitterAt) {
    const distanceScale = clamp(targetDistance / 24, 0.55, 1.35);
    brain.aimJitterYaw = randomSignedWith(random, skill.aimErrorRadians * distanceScale);
    brain.aimJitterPitch = randomSignedWith(random, skill.aimErrorRadians * 0.55 * distanceScale);
    brain.nextAimJitterAt = now + randomBetweenWith(random, skill.aimJitterRefreshMs[0], skill.aimJitterRefreshMs[1]);
  } else if (targetDistance === null) {
    brain.aimJitterYaw *= 0.82;
    brain.aimJitterPitch *= 0.82;
  }

  const targetYaw = normalizeAngle(desiredAim.yaw + brain.aimJitterYaw);
  const targetPitch = clamp(desiredAim.pitch + brain.aimJitterPitch, -0.8, 0.8);
  const maxStep = skill.turnRateRadians * clamp(dt, 0.016, 0.1);

  brain.aimYaw = rotateAngleToward(brain.aimYaw, targetYaw, maxStep);
  const pitchDelta = clamp(targetPitch - brain.aimPitch, -maxStep, maxStep);
  brain.aimPitch = clamp(brain.aimPitch + pitchDelta, -0.8, 0.8);

  return { yaw: brain.aimYaw, pitch: brain.aimPitch };
}

export function getBotAimReadinessTrace(input: BotAimReadinessTraceInput): BotAimReadinessTrace {
  const readinessPadding = Math.max(0, input.skill.aimFireToleranceScale - 1) * input.hitboxPadding;
  return {
    origin: input.origin,
    direction: getForwardVector(input.yaw, input.pitch),
    range: input.attackRange,
    extraRadius: readinessPadding + (input.attackCollisionRadius ?? 0),
  };
}

export function isBotSecondaryFireWindowOpen(input: BotSecondaryFireWindowInput): boolean {
  return Boolean(
    input.shouldFight
    && input.heroId !== 'blaze'
    && input.secondaryAttack
    && input.enemyDistance <= input.secondaryAttack.range
    && input.now >= input.brain.nextSecondaryAt
  );
}

export function updateBotSecondaryFireDecision(input: BotSecondaryFireDecisionInput): boolean {
  const {
    brain,
    skill,
    now,
    secondaryAttack,
    aimReady,
    tempoMultiplier,
  } = input;
  if (!isBotSecondaryFireWindowOpen(input) || !secondaryAttack || !aimReady) {
    return false;
  }

  const random = input.random ?? Math.random;
  const firedSecondary = random() < skill.secondaryChance;
  const secondaryDelayMs = firedSecondary
    ? randomBetweenWith(random, secondaryAttack.cooldownMs * 0.85, secondaryAttack.cooldownMs * 1.3)
    : randomBetweenWith(random, 350, 900);
  brain.nextSecondaryAt = now + secondaryDelayMs / tempoMultiplier;
  return firedSecondary;
}

export function getBotLocomotionActionState(input: BotLocomotionActionInput): BotLocomotionActionState {
  const routeDistance = distance2D(input.position, input.steeringTarget);
  const sprint = routeDistance > 9
    || input.hasFlag
    || (input.intentType !== 'fight_local_enemy' && input.intentType !== 'defend_base');
  const jump = input.steeringJump || (input.stalled && input.isGrounded);
  const crouch = sprint
    && routeDistance > 14
    && !input.hasCombatTarget
    && hashString(`${input.botId}:${Math.floor(input.now / 500)}`) % 11 === 0;

  return {
    sprint,
    jump,
    crouch,
    crouchPressed: crouch && input.previousCrouch !== true,
  };
}

export function composeBotInputMovementState(input: BotInputMovementStateInput): BotInputMovementState {
  const movement = getBotDirectionalMovementState({
    lookYaw: input.lookYaw,
    desiredMove: input.desiredMove,
    recovering: input.recovering,
    strafeDirection: input.strafeDirection,
  });
  const locomotion = getBotLocomotionActionState(input);

  return {
    ...movement,
    ...locomotion,
  };
}

export function applyBotAbilityInputPlan(input: BotAbilityInputPlanInput): void {
  const { brain, input: controls, plan, skill, now, tempoMultiplier } = input;
  const random = input.random ?? Math.random;

  if (brain.pendingSecondaryMode) {
    if (now < brain.secondaryHoldUntil) {
      controls.secondaryFire = true;
      controls.primaryFire = false;
      return;
    }
    brain.pendingSecondaryMode = '';
    brain.secondaryHoldUntil = 0;
    controls.secondaryFire = false;
    return;
  }

  if (plan.mode === 'none' || !plan.slot) return;

  if (plan.slot === 'ultimate') {
    if (now < brain.nextUltimateAt && plan.score < skill.abilityScoreThreshold + 75) return;
  } else if (plan.slot !== 'secondary' && plan.mode !== 'blaze_flamethrower') {
    if (now < brain.nextAbilityAt && plan.score < skill.abilityScoreThreshold + 55) return;
  }

  switch (plan.mode) {
    case 'chronos_lifeline_allies':
      controls.ability1 = true;
      controls.primaryFire = true;
      controls.secondaryFire = false;
      break;
    case 'chronos_lifeline_self':
      controls.ability1 = true;
      controls.primaryFire = false;
      controls.secondaryFire = true;
      break;
    case 'chronos_aegis':
      controls.secondaryFire = true;
      controls.primaryFire = false;
      return;
    case 'blaze_flamethrower':
      controls.ability1 = true;
      controls.primaryFire = false;
      break;
    case 'blaze_bomb':
      if (now < brain.nextSecondaryAt) return;
      controls.secondaryFire = true;
      controls.primaryFire = false;
      brain.pendingSecondaryMode = plan.mode;
      brain.secondaryHoldUntil = now + (plan.holdMs ?? 120);
      brain.nextSecondaryAt = now + randomBetweenWith(random, 900, 1450) / tempoMultiplier;
      return;
    default:
      if (plan.slot === 'ability1') controls.ability1 = true;
      if (plan.slot === 'ability2') controls.ability2 = true;
      if (plan.slot === 'ultimate') controls.ultimate = true;
      if (plan.slot) controls.primaryFire = false;
      break;
  }

  if (plan.slot === 'ultimate') {
    brain.nextUltimateAt = now + randomBetweenWith(random, skill.ultimateCadenceMs[0], skill.ultimateCadenceMs[1]) / tempoMultiplier;
  } else if (plan.slot !== 'secondary' && plan.mode !== 'blaze_flamethrower') {
    brain.nextAbilityAt = now + randomBetweenWith(random, skill.abilityCadenceMs[0], skill.abilityCadenceMs[1]) / tempoMultiplier;
  }
}

export function updateBotPlanningState(input: BotPlanningStateInput): BotPlanningStateResult {
  const { brain, now, bot, skill } = input;
  const random = input.random ?? Math.random;
  const shouldRefreshBlackboard = shouldRefreshBotPlanningState(brain, now);
  const blackboard = shouldRefreshBlackboard
    ? buildBotBlackboard({
      now,
      gameplayMode: input.gameplayMode,
      bot,
      players: input.players,
      flags: input.flags,
      visibleEnemyIds: input.visibleEnemyIds,
      enemyLineOfSightIds: input.enemyLineOfSightIds,
      recentDamageSources: input.recentDamageSources,
      teamTactics: input.teamTactics,
      enemyMemory: brain.enemyMemory,
      skill,
    })
    : brain.blackboard!;

  if (shouldRefreshBlackboard) {
    brain.blackboard = blackboard;
    brain.nextBlackboardAt = now + Math.max(80, skill.thinkIntervalMs * 0.75);
  }

  if (now >= brain.nextThinkAt) {
    brain.intent = scoreBotIntents(bot, blackboard, skill);
    brain.routePlan = planBotRoute({
      now,
      bot,
      intent: brain.intent,
      blackboard,
      routeGraph: input.routeGraph,
      blockedEdges: brain.blockedEdges,
      skill,
      previousPlan: brain.routePlan,
    });
    brain.nextThinkAt = now + randomBetweenWith(random, skill.thinkIntervalMs * 0.75, skill.thinkIntervalMs * 1.25);

    if (now >= brain.strafeUntil) {
      brain.strafeDirection = hashString(`${bot.id}:${Math.floor(now / 1000)}`) % 2 === 0 ? -1 : 1;
      brain.strafeUntil = now + randomBetweenWith(random, 900, 2600);
    }
  }

  if (!brain.routePlan || now - brain.routePlan.plannedAt > skill.replanIntervalMs * 2) {
    brain.routePlan = planBotRoute({
      now,
      bot,
      intent: brain.intent,
      blackboard,
      routeGraph: input.routeGraph,
      blockedEdges: brain.blockedEdges,
      skill,
      previousPlan: brain.routePlan,
    });
  }

  return {
    blackboard,
    routePlan: brain.routePlan,
  };
}

export function updateBotMovementRecoveryState(input: BotMovementRecoveryInput): BotMovementRecoveryResult {
  const { brain, now, bot, blackboard, routePlan, desiredMove, steeringBlocked, skill } = input;
  const random = input.random ?? Math.random;
  const progress = updateBotMovementProgress(
    brain.movementProgress,
    now,
    bot.position,
    routePlan.steeringTarget,
    routePlan.activeEdgeId,
    desiredMove,
    steeringBlocked,
    skill
  );

  if (progress.markBlockedEdgeId) {
    brain.blockedEdges.set(progress.markBlockedEdgeId, now + skill.blockedEdgeTtlMs);
    brain.routePlan = planBotRoute({
      now,
      bot,
      intent: brain.intent,
      blackboard,
      routeGraph: input.routeGraph,
      blockedEdges: brain.blockedEdges,
      skill,
      previousPlan: brain.routePlan,
    });
  }

  if (progress.stalled && steeringBlocked) {
    brain.reverseUntil = now + randomBetweenWith(random, 220, 420);
  }

  return {
    ...progress,
    routePlan: brain.routePlan ?? routePlan,
  };
}

function randomBetweenWith(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

function randomSignedWith(random: () => number, amount: number): number {
  return (random() * 2 - 1) * amount;
}

function getBotDirectionalMovementState(input: {
  lookYaw: number;
  desiredMove: PlainVec2 | null;
  recovering: boolean;
  strafeDirection: -1 | 1;
}): Pick<BotInputMovementState, 'moveForward' | 'moveBackward' | 'moveLeft' | 'moveRight'> {
  const movement = {
    moveForward: false,
    moveBackward: false,
    moveLeft: false,
    moveRight: false,
  };

  if (input.recovering) {
    movement.moveBackward = true;
    movement.moveLeft = input.strafeDirection < 0;
    movement.moveRight = input.strafeDirection > 0;
    return movement;
  }

  if (!input.desiredMove) return movement;

  const local = worldDirectionToLocalMove(input.desiredMove, input.lookYaw);
  const threshold = 0.22;
  movement.moveForward = local.z < -threshold;
  movement.moveBackward = local.z > threshold;
  movement.moveLeft = local.x < -threshold;
  movement.moveRight = local.x > threshold;

  if (!movement.moveForward && !movement.moveBackward && !movement.moveLeft && !movement.moveRight) {
    if (Math.abs(local.x) > Math.abs(local.z)) {
      movement.moveLeft = local.x < 0;
      movement.moveRight = local.x >= 0;
    } else {
      movement.moveForward = local.z <= 0;
      movement.moveBackward = local.z > 0;
    }
  }

  return movement;
}

function worldDirectionToLocalMove(direction: PlainVec2, lookYaw: number): PlainVec2 {
  const cos = Math.cos(lookYaw);
  const sin = Math.sin(lookYaw);
  return {
    x: direction.x * cos - direction.z * sin,
    z: direction.x * sin + direction.z * cos,
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

function isCaptureTheFlagGameplayMode(mode: GameplayMode): boolean {
  return mode === 'capture_the_flag';
}

function isEnemyForGameplayMode(mode: GameplayMode, playerTeam: Team, ownTeam: Team): boolean {
  if (playerTeam === ownTeam) return false;
  return !isCaptureTheFlagGameplayMode(mode) || playerTeam === otherTeam(ownTeam);
}

function createNeutralFlagSnapshot(team: Team, position: PlainVec3): BotFlagSnapshot {
  return {
    team,
    position: { ...position },
    basePosition: { ...position },
    carrierId: '',
    isAtBase: true,
    droppedAt: 0,
  };
}

function getFlagSnapshotOrFallback(
  flags: Record<Team, BotFlagSnapshot>,
  team: Team,
  fallbackPosition: PlainVec3
): BotFlagSnapshot {
  return flags[team] ?? createNeutralFlagSnapshot(team, fallbackPosition);
}

function createThreatClusters(team: Team, enemies: readonly BotPlayerSnapshot[]): BotThreatCluster[] {
  const clusters: BotThreatCluster[] = [];
  const consumed = new Set<string>();
  for (const enemy of enemies) {
    if (consumed.has(enemy.id)) continue;
    const playerIds: string[] = [];
    let centerX = 0;
    let centerY = 0;
    let centerZ = 0;
    let memberCount = 0;
    let carrierId: string | null = null;
    let missingHealthThreat = 0;

    for (const candidate of enemies) {
      if (distance2D(enemy.position, candidate.position) > 14) continue;
      consumed.add(candidate.id);
      playerIds.push(candidate.id);
      centerX += candidate.position.x;
      centerY += candidate.position.y;
      centerZ += candidate.position.z;
      memberCount++;
      if (candidate.hasFlag) carrierId = candidate.id;
      missingHealthThreat += 1 - candidate.health / Math.max(1, candidate.maxHealth);
    }

    const invMemberCount = 1 / Math.max(1, memberCount);
    const center = {
      x: centerX * invMemberCount,
      y: centerY * invMemberCount,
      z: centerZ * invMemberCount,
    };
    let radius = 8;
    for (const candidate of enemies) {
      if (distance2D(enemy.position, candidate.position) > 14) continue;
      radius = Math.max(radius, distance2D(center, candidate.position) + 5);
    }
    playerIds.sort();
    clusters.push({
      id: `${team}-threat-${clusters.length}`,
      team,
      center,
      radius,
      count: memberCount,
      carrierId,
      threat: memberCount + (carrierId ? 3 : 0) + missingHealthThreat,
      playerIds,
    });
  }
  return clusters;
}

function healthResources(allies: readonly BotPlayerSnapshot[], enemies: readonly BotPlayerSnapshot[]): BotResourceFact[] {
  const resources: BotResourceFact[] = [];
  for (const ally of allies) {
    if (ally.state !== 'alive' || ally.health >= ally.maxHealth) continue;

    let nearestEnemyDistance = Infinity;
    for (const enemy of enemies) {
      nearestEnemyDistance = Math.min(nearestEnemyDistance, distance2D(ally.position, enemy.position));
    }

    resources.push({
      playerId: ally.id,
      position: { ...ally.position },
      missingHealth: Math.max(0, ally.maxHealth - ally.health),
      healthRatio: ally.health / Math.max(1, ally.maxHealth),
      isCarrier: ally.hasFlag,
      threatened: nearestEnemyDistance <= 18,
      distanceToNearestEnemy: nearestEnemyDistance,
    });
  }
  resources.sort((a, b) => b.missingHealth - a.missingHealth);
  return resources;
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

function buildEliminationTacticsForTeam(input: BotTeamTacticsInput, team: Team): BotTeamTactics {
  const enemyTeam = otherTeam(team);
  const allies: BotPlayerSnapshot[] = [];
  const enemies: BotPlayerSnapshot[] = [];
  const bots: BotPlayerSnapshot[] = [];
  for (const player of input.players) {
    if (player.state !== 'alive') continue;
    if (player.team === team) {
      allies.push(player);
      if (player.isBot) bots.push(player);
    } else if (isEnemyForGameplayMode(input.gameplayMode, player.team, team)) {
      enemies.push(player);
    }
  }

  const threatClusters = createThreatClusters(enemyTeam, enemies);
  const healthFacts = healthResources(allies, enemies);
  const lowHealthAllies = healthFacts.filter((fact) => fact.healthRatio < 0.72);
  const roleDemand: BotRoleDemand = {
    runners: 0,
    defenders: 0,
    escorts: 0,
    interceptors: 0,
    support: lowHealthAllies.length > 0 ? 1 : 0,
    fighters: bots.length,
  };
  const assignments: Record<string, BotRoleAssignment> = {};
  const assigned = new Set<string>();
  const sortedBots = [...bots].sort((a, b) => a.id.localeCompare(b.id));

  if (lowHealthAllies.length > 0) {
    assignBestBot(
      sortedBots,
      assigned,
      'support',
      'support_cluster',
      lowHealthAllies[0].position,
      lowHealthAllies[0].playerId,
      'low-health ally resource cluster',
      640,
      assignments
    );
  }

  for (const bot of sortedBots) {
    if (assigned.has(bot.id)) continue;

    const nearestEnemy = nearestPlayer(enemies, bot.position);
    const targetPosition = nearestEnemy?.position
      ?? threatClusters[0]?.center
      ?? input.flags[enemyTeam]?.basePosition
      ?? bot.position;
    assignments[bot.id] = {
      botId: bot.id,
      role: bot.heroId === 'chronos' && roleDemand.support > 0 ? 'support' : 'fighter',
      job: 'fight',
      targetPosition: { ...targetPosition },
      targetPlayerId: nearestEnemy?.id,
      reason: nearestEnemy
        ? 'nearest enemy pressure'
        : input.gameplayMode === 'battle_royal'
          ? 'battle royal pressure'
          : 'team deathmatch pressure',
      priority: 420,
    };
  }

  return {
    team,
    gameplayMode: input.gameplayMode,
    revision: input.revision,
    ownFlagState: 'safe',
    enemyFlagState: 'at_base',
    roleDemand,
    assignments,
    threatClusters,
    lowHealthAllies,
    carrierDanger: {},
  };
}

function buildTeamTacticsForTeam(input: BotTeamTacticsInput, team: Team): BotTeamTactics {
  if (!isCaptureTheFlagGameplayMode(input.gameplayMode)) {
    return buildEliminationTacticsForTeam(input, team);
  }

  const enemyTeam = otherTeam(team);
  const alive: BotPlayerSnapshot[] = [];
  const allies: BotPlayerSnapshot[] = [];
  const enemies: BotPlayerSnapshot[] = [];
  const bots: BotPlayerSnapshot[] = [];
  for (const player of input.players) {
    if (player.state !== 'alive') continue;
    alive.push(player);
    if (player.team === team) {
      allies.push(player);
      if (player.isBot) bots.push(player);
    } else if (player.team === enemyTeam) {
      enemies.push(player);
    }
  }
  const ownFlag = input.flags[team];
  const enemyFlag = input.flags[enemyTeam];
  const enemyCarrier = ownFlag.carrierId ? alive.find((player) => player.id === ownFlag.carrierId) ?? null : null;
  const alliedCarrier = enemyFlag.carrierId ? alive.find((player) => player.id === enemyFlag.carrierId) ?? null : null;
  const droppedFriendlyFlag = !ownFlag.isAtBase && !ownFlag.carrierId ? ownFlag.position : null;
  const droppedEnemyFlag = !enemyFlag.isAtBase && !enemyFlag.carrierId ? enemyFlag.position : null;
  const threatClusters = createThreatClusters(enemyTeam, enemies);
  const healthFacts = healthResources(allies, enemies);
  const lowHealthAllies: BotResourceFact[] = [];
  for (const fact of healthFacts) {
    if (fact.healthRatio < 0.72 || fact.isCarrier) lowHealthAllies.push(fact);
  }
  const carrierDanger: Record<string, number> = {};
  for (const carrier of [enemyCarrier, alliedCarrier]) {
    if (!carrier) continue;
    let danger = 0;
    for (const enemy of enemies) {
      if (enemy.team === carrier.team) continue;
      danger += Math.max(0, 28 - distance2D(carrier.position, enemy.position)) / 8;
    }
    carrierDanger[carrier.id] = danger;
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

  const sortedBots = [...bots].sort((a, b) => a.id.localeCompare(b.id));
  for (const bot of sortedBots) {
    if (!bot.hasFlag) continue;
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
    let returner: BotPlayerSnapshot | null = null;
    let returnerDistance = Infinity;
    for (const bot of bots) {
      if (assigned.has(bot.id)) continue;
      const distance = distance2D(bot.position, droppedFriendlyFlag);
      if (distance < returnerDistance || (distance === returnerDistance && bot.id < (returner?.id ?? '~'))) {
        returner = bot;
        returnerDistance = distance;
      }
    }
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
    let nearbyEscort: BotPlayerSnapshot | null = null;
    let nearbyEscortDistance = Infinity;
    for (const bot of bots) {
      if (assigned.has(bot.id) || bot.id === alliedCarrier.id) continue;
      const distance = distance2D(bot.position, alliedCarrier.position);
      if (distance < nearbyEscortDistance || (distance === nearbyEscortDistance && bot.id < (nearbyEscort?.id ?? '~'))) {
        nearbyEscort = bot;
        nearbyEscortDistance = distance;
      }
    }
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

  let assignedDefenders = 0;
  let assignedRunners = 0;
  for (const assignment of Object.values(assignments)) {
    if (assignment.job === 'defend_base') assignedDefenders++;
    if (assignment.job === 'run_flag' || assignment.job === 'carry') assignedRunners++;
  }

  for (const bot of sortedBots) {
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
    gameplayMode: input.gameplayMode,
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
  const teams = input.gameplayMode === 'battle_royal'
    ? Array.from(new Set(input.players.map((player) => player.team))).sort((a, b) => a.localeCompare(b))
    : ['red', 'blue'];
  const tactics: BotTeamTacticsByTeam = {};
  for (const team of teams) {
    tactics[team] = buildTeamTacticsForTeam(input, team);
  }
  return tactics;
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
  const debts: BotAllyHealthDebt[] = [];
  for (const ally of allies) {
    if (ally.id === bot.id || ally.state !== 'alive' || ally.health >= ally.maxHealth) continue;

    let nearestEnemyDistance = Infinity;
    for (const enemy of visibleEnemies) {
      nearestEnemyDistance = Math.min(nearestEnemyDistance, distance2D(ally.position, enemy.lastKnownPosition));
    }

    const missingHealth = Math.max(0, ally.maxHealth - ally.health);
    const speed = Math.sqrt(ally.velocity.x * ally.velocity.x + ally.velocity.z * ally.velocity.z);
    const currentDistanceToBot = distance2D(ally.position, bot.position);
    const projectedDistanceToBot = distance2D({
      x: ally.position.x + ally.velocity.x,
      z: ally.position.z + ally.velocity.z,
    }, bot.position);
    const retreating = nearestEnemyDistance < 18 && speed > 0.8 && currentDistanceToBot < projectedDistanceToBot;
    const threatened = nearestEnemyDistance <= 18 || ally.hasFlag;
    const fighting = nearestEnemyDistance <= 24 && !retreating;
    const importance = (ally.hasFlag ? 1.65 : 1) * (threatened ? 1.32 : 1) * (fighting ? 1.12 : 1);
    debts.push({
      playerId: ally.id,
      position: { ...ally.position },
      missingHealth,
      effectiveMissingHealth: missingHealth * importance,
      healthRatio: ally.health / Math.max(1, ally.maxHealth),
      distance: currentDistanceToBot,
      isCarrier: ally.hasFlag,
      threatened,
      fighting,
      retreating,
    });
  }

  debts.sort((a, b) => b.effectiveMissingHealth - a.effectiveMissingHealth || a.distance - b.distance);
  return debts;
}

function buildHealCluster(bot: BotPlayerSnapshot, debts: readonly BotAllyHealthDebt[]): BotBlackboard['healCluster'] {
  if (debts.length === 0) return null;
  let best: BotBlackboard['healCluster'] = null;
  const targetIdsScratch: string[] = [];
  for (const anchor of debts) {
    let nearbyCount = 0;
    let expectedHeal = 0;
    let centerX = 0;
    let centerY = 0;
    let centerZ = 0;
    let inRange = false;
    targetIdsScratch.length = 0;

    for (const debt of debts) {
      if (nearbyCount >= CHRONOS_LIFELINE_MAX_TARGETS) break;
      if (distance2D(anchor.position, debt.position) > CHRONOS_LIFELINE_RADIUS * 1.25) continue;
      nearbyCount++;
      targetIdsScratch.push(debt.playerId);
      expectedHeal += Math.min(CHRONOS_LIFELINE_ALLY_HEAL, debt.missingHealth) *
        (debt.effectiveMissingHealth / Math.max(1, debt.missingHealth));
      centerX += debt.position.x;
      centerY += debt.position.y;
      centerZ += debt.position.z;
      if (debt.distance <= CHRONOS_LIFELINE_RADIUS) inRange = true;
    }
    if (nearbyCount === 0) continue;
    const invNearbyCount = 1 / nearbyCount;
    const center = {
      x: centerX * invNearbyCount,
      y: centerY * invNearbyCount,
      z: centerZ * invNearbyCount,
    };
    const candidate = {
      center,
      expectedHeal,
      targetIds: [...targetIdsScratch],
      inRange,
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
  const isCaptureTheFlag = isCaptureTheFlagGameplayMode(input.gameplayMode);
  const ownFlag = getFlagSnapshotOrFallback(input.flags, team, bot.position);
  const enemyFlag = getFlagSnapshotOrFallback(input.flags, enemyTeam, bot.position);
  const allies: BotPlayerSnapshot[] = [];
  const enemyPlayers: BotPlayerSnapshot[] = [];
  let alliedCarrier: BotPlayerSnapshot | null = null;
  let enemyCarrierPlayer: BotPlayerSnapshot | null = null;
  let enemyFlagCarrierPosition: PlainVec3 | null = null;

  for (const player of input.players) {
    if (player.state !== 'alive') continue;
    if (player.team === team) {
      if (player.id !== bot.id) {
        allies.push(player);
        if (isCaptureTheFlag && player.hasFlag) alliedCarrier = player;
      }
    } else if (isEnemyForGameplayMode(input.gameplayMode, player.team, team)) {
      enemyPlayers.push(player);
      if (isCaptureTheFlag && (player.hasFlag || ownFlag.carrierId === player.id)) {
        enemyCarrierPlayer = player;
      }
    }
    if (isCaptureTheFlag && enemyFlag.carrierId && player.id === enemyFlag.carrierId) {
      enemyFlagCarrierPosition = player.position;
    }
  }

  const visibleEnemies: BotKnownEnemy[] = [];
  const knownEnemies: BotKnownEnemy[] = [];

  pruneEnemyMemory(input.enemyMemory, input.now, input.skill);

  for (const enemy of enemyPlayers) {
    const objectiveVisible = input.gameplayMode === 'capture_the_flag' && Boolean(enemy.hasFlag);
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
  let weakestEnemy: BotKnownEnemy | null = null;
  let weakestEnemyHealthRatio = Infinity;
  for (const enemy of knownEnemies) {
    if (enemy.distance > BOT_AWARENESS_RANGE) continue;
    const healthRatio = enemy.player.health / Math.max(1, enemy.player.maxHealth);
    if (
      healthRatio < weakestEnemyHealthRatio ||
      (
        healthRatio === weakestEnemyHealthRatio &&
        (
          enemy.distance < (weakestEnemy?.distance ?? Infinity) ||
          (enemy.distance === (weakestEnemy?.distance ?? Infinity) && enemy.player.id < (weakestEnemy?.player.id ?? '~'))
        )
      )
    ) {
      weakestEnemy = enemy;
      weakestEnemyHealthRatio = healthRatio;
    }
  }
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
  let nearestAlly: BotPlayerSnapshot | null = null;
  let nearestAllyDistance = Infinity;
  for (const ally of allies) {
    const distance = distance2D(bot.position, ally.position);
    if (distance < nearestAllyDistance) {
      nearestAlly = ally;
      nearestAllyDistance = distance;
    }
  }
  const nearbyRangeSq = 16 * 16;
  let nearbyEnemyCount = 0;
  const lastKnownEnemies: BotKnownEnemy[] = [];
  for (const enemy of knownEnemies) {
    const dx = enemy.lastKnownPosition.x - bot.position.x;
    const dz = enemy.lastKnownPosition.z - bot.position.z;
    if (dx * dx + dz * dz <= nearbyRangeSq) nearbyEnemyCount++;
    if (!enemy.visible) lastKnownEnemies.push(enemy);
  }
  let nearbyAllyCount = 0;
  for (const ally of allies) {
    const dx = ally.position.x - bot.position.x;
    const dz = ally.position.z - bot.position.z;
    if (dx * dx + dz * dz <= nearbyRangeSq) nearbyAllyCount++;
  }
  const allyHealthDebts = buildAllyHealthDebts(bot, allies, visibleEnemies);

  return {
    bot,
    gameplayMode: input.gameplayMode,
    team,
    enemyTeam,
    allies,
    enemies: knownEnemies,
    visibleEnemies,
    lastKnownEnemies,
    nearestEnemy,
    weakestEnemy,
    enemyCarrier,
    nearestAlly,
    alliedCarrier,
    droppedFriendlyFlag: isCaptureTheFlag && !ownFlag.isAtBase && !ownFlag.carrierId ? { ...ownFlag.position } : null,
    droppedEnemyFlag: isCaptureTheFlag && !enemyFlag.isAtBase && !enemyFlag.carrierId ? { ...enemyFlag.position } : null,
    enemyFlagPosition: enemyFlag.carrierId
      ? { ...(enemyFlagCarrierPosition ?? enemyFlag.position) }
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
  const localEnemyPressure = Math.max(0, blackboard.nearbyEnemyCount - blackboard.nearbyAllyCount);
  const assignmentBoost = (job: BotTacticsJob, amount: number): number => assignment?.job === job ? amount + assignment.priority * 0.22 : 0;
  const role = assignment?.role ?? getDefaultRole(bot, blackboard.teamTactics.roleDemand);
  const isCaptureTheFlag = blackboard.gameplayMode === 'capture_the_flag';

  if (isCaptureTheFlag && bot.hasFlag) {
    addIntent(candidates, 'carry_flag_home', 10000, blackboard.ownBasePosition, 'bot is carrying enemy flag');
  }

  const pressuredRetreatHealthRatio = skill.retreatHealthRatio + localEnemyPressure * 0.08;
  if (healthRatio < pressuredRetreatHealthRatio && nearestEnemyDistance < 24 && !blackboard.enemyCarrier) {
    addIntent(candidates, 'retreat', 820 + (1 - healthRatio) * 520 + localEnemyPressure * 90, blackboard.ownBasePosition, 'low health under pressure');
  } else if (localEnemyPressure >= 2 && healthRatio < 0.72 && nearestEnemyDistance < 20 && !blackboard.enemyCarrier) {
    addIntent(candidates, 'regroup', 620 + localEnemyPressure * 80 + (0.72 - healthRatio) * 260, blackboard.nearestAlly?.position ?? blackboard.ownBasePosition, 'outnumbered local fight');
  }

  if (isCaptureTheFlag && blackboard.enemyCarrier) {
    addIntent(
      candidates,
      'intercept_enemy_carrier',
      720 + assignmentBoost('intercept_carrier', 280) + Math.max(0, 46 - blackboard.enemyCarrier.distance) * 5,
      blackboard.enemyCarrier.lastKnownPosition,
      'enemy flag carrier exists',
      blackboard.enemyCarrier.player.id
    );
  }

  if (isCaptureTheFlag && blackboard.droppedFriendlyFlag) {
    addIntent(
      candidates,
      'return_dropped_friendly_flag',
      780 + assignmentBoost('return_flag', 320) - distance2D(bot.position, blackboard.droppedFriendlyFlag) * 2.2,
      blackboard.droppedFriendlyFlag,
      'friendly flag is dropped'
    );
  }

  if (isCaptureTheFlag && blackboard.alliedCarrier) {
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

  if (!isCaptureTheFlag) {
    if (blackboard.weakestEnemy && blackboard.weakestEnemy.player.id !== blackboard.nearestEnemy?.player.id) {
      addIntent(
        candidates,
        'fight_local_enemy',
        360 + assignmentBoost('fight', 160) + Math.max(0, 1 - blackboard.weakestEnemy.player.health / Math.max(1, blackboard.weakestEnemy.player.maxHealth)) * 220,
        blackboard.weakestEnemy.lastKnownPosition,
        'pressure weakened enemy',
        blackboard.weakestEnemy.player.id
      );
    }

    if (assignment?.targetPosition) {
      addIntent(
        candidates,
        'pressure_lane',
        300 + assignmentBoost('fight', 180),
        assignment.targetPosition,
        'team deathmatch pressure',
        assignment.targetPlayerId
      );
    }

    addIntent(
      candidates,
      'regroup',
      190 + (blackboard.nearbyAllyCount === 0 ? 140 : 0),
      blackboard.nearestAlly?.position ?? assignment?.targetPosition ?? blackboard.ownBasePosition,
      'low urgency regroup'
    );

    candidates.sort((a, b) => b.score - a.score || a.type.localeCompare(b.type));
    const best = candidates[0] ?? {
      type: 'pressure_lane' as const,
      score: 0,
      targetPosition: assignment?.targetPosition ?? blackboard.nearestEnemy?.lastKnownPosition ?? blackboard.ownBasePosition,
      targetPlayerId: assignment?.targetPlayerId ?? blackboard.nearestEnemy?.player.id,
      reason: 'team deathmatch fallback',
    };

    return {
      ...best,
      role,
      job: assignment?.job ?? 'none',
      candidates,
    };
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

export function getBotMinimumCombatRange(heroId: HeroId | '', skill: BotSkillProfile): number {
  const preferredRange = getBotPreferredCombatRange(heroId) * skill.preferredRangeScale;
  switch (heroId) {
    case 'blaze':
      return Math.max(6.5, preferredRange * 0.56);
    case 'phantom':
      return Math.max(11, preferredRange * 0.68);
    case 'hookshot':
      return Math.max(9.5, preferredRange * 0.64);
    default:
      return Math.max(8.5, preferredRange * 0.62);
  }
}

export function getBotCloseCombatRange(heroId: HeroId | '', skill: BotSkillProfile, primaryRange = 18): number {
  const preferredRange = getBotPreferredCombatRange(heroId) * skill.preferredRangeScale;
  const usefulRangeScale = heroId === 'blaze' ? 0.58 : 0.72;
  return Math.min(
    primaryRange * 0.92,
    Math.max(preferredRange + 4, preferredRange + primaryRange * usefulRangeScale * 0.25)
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

interface RouteOpenEntry {
  nodeId: string;
  priority: number;
}

class RouteOpenHeap {
  private readonly entries: RouteOpenEntry[] = [];

  get size(): number {
    return this.entries.length;
  }

  push(nodeId: string, priority: number): void {
    const entry = { nodeId, priority };
    this.entries.push(entry);
    this.bubbleUp(this.entries.length - 1);
  }

  pop(): RouteOpenEntry | null {
    if (this.entries.length === 0) return null;
    const root = this.entries[0];
    const last = this.entries.pop();
    if (last && this.entries.length > 0) {
      this.entries[0] = last;
      this.sinkDown(0);
    }
    return root;
  }

  private bubbleUp(index: number): void {
    const entry = this.entries[index];
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.entries[parentIndex];
      if (compareRouteOpenEntry(parent, entry) <= 0) break;
      this.entries[index] = parent;
      index = parentIndex;
    }
    this.entries[index] = entry;
  }

  private sinkDown(index: number): void {
    const length = this.entries.length;
    const entry = this.entries[index];

    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      if (leftIndex >= length) break;

      let childIndex = leftIndex;
      if (rightIndex < length && compareRouteOpenEntry(this.entries[rightIndex], this.entries[leftIndex]) < 0) {
        childIndex = rightIndex;
      }
      if (compareRouteOpenEntry(entry, this.entries[childIndex]) <= 0) break;

      this.entries[index] = this.entries[childIndex];
      index = childIndex;
    }

    this.entries[index] = entry;
  }
}

function compareRouteOpenEntry(a: RouteOpenEntry, b: RouteOpenEntry): number {
  return a.priority - b.priority || a.nodeId.localeCompare(b.nodeId);
}

function routePriority(
  routeGraph: BotRouteGraphAdapter,
  nodeId: string,
  goalNode: BotRouteNodeInfo,
  targetPosition: PlainVec3,
  distance: number
): number {
  return distance + distance2D(routeGraph.nodeById.get(nodeId)?.position ?? targetPosition, goalNode.position) * 0.18;
}

function blockedEdgeSignature(blockedEdges: Map<string, number>, now: number): string {
  if (blockedEdges.size === 0) return '';

  const activeEdgeIds: string[] = [];
  for (const [edgeId, blockedUntil] of blockedEdges) {
    if (blockedUntil > now) activeEdgeIds.push(edgeId);
  }
  if (activeEdgeIds.length === 0) return '';
  activeEdgeIds.sort();
  return activeEdgeIds.join(',');
}

function routePlanCacheKey(
  input: BotRoutePlanInput,
  routeGraph: BotRouteGraphAdapter,
  startNode: BotRouteNodeInfo,
  goalNode: BotRouteNodeInfo
): string {
  return [
    routeGraph.nodes.length,
    routeGraph.edges.length,
    startNode.id,
    goalNode.id,
    input.intent.type,
    input.bot.hasFlag ? 'carrier' : 'free',
    input.blackboard.teamTactics.revision,
    blockedEdgeSignature(input.blockedEdges, input.now),
  ].join('|');
}

function resolvePathEdges(routeGraph: BotRouteGraphAdapter, pathNodeIds: readonly string[]): BotRouteEdgeInfo[] {
  const pathEdges: BotRouteEdgeInfo[] = [];
  for (let index = 1; index < pathNodeIds.length; index++) {
    const from = pathNodeIds[index - 1];
    const to = pathNodeIds[index];
    const edge = routeGraph.adjacency.get(from)?.find((candidate) => candidate.to === to);
    if (edge) pathEdges.push(edge);
  }
  return pathEdges;
}

function composeRoutePlanFromPath(
  input: BotRoutePlanInput,
  routeGraph: BotRouteGraphAdapter,
  goalNode: BotRouteNodeInfo,
  pathNodeIds: string[],
  pathEdges: BotRouteEdgeInfo[],
  cost: number,
  expandedNodes: number,
  capped: boolean,
  reason: string,
  cacheKey: string
): BotRoutePlan {
  const targetPosition = input.intent.targetPosition;
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
    cost,
    expandedNodes,
    capped,
    reason,
    plannedAt: input.now,
    cacheKey,
  };
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

  const cacheKey = routePlanCacheKey(input, routeGraph, startNode, goalNode);
  const previousPlan = input.previousPlan;
  if (previousPlan?.cacheKey === cacheKey && previousPlan.pathNodeIds.length > 0) {
    return composeRoutePlanFromPath(
      input,
      routeGraph,
      goalNode,
      [...previousPlan.pathNodeIds],
      resolvePathEdges(routeGraph, previousPlan.pathNodeIds),
      previousPlan.cost,
      0,
      previousPlan.capped,
      'cached route graph path',
      cacheKey
    );
  }

  const distances = new Map<string, number>([[startNode.id, 0]]);
  const previous = new Map<string, { nodeId: string; edge: BotRouteEdgeInfo }>();
  const open = new RouteOpenHeap();
  open.push(startNode.id, routePriority(routeGraph, startNode.id, goalNode, targetPosition, 0));
  let expandedNodes = 0;
  let capped = false;

  while (open.size > 0) {
    const current = open.pop();
    if (!current) break;
    const currentId = current.nodeId;
    const baseDistance = distances.get(currentId) ?? Infinity;
    if (current.priority > routePriority(routeGraph, currentId, goalNode, targetPosition, baseDistance) + 0.0001) {
      continue;
    }
    expandedNodes++;
    if (currentId === goalNode.id) break;
    if (expandedNodes >= input.skill.pathExpansionLimit) {
      capped = true;
      break;
    }
    for (const edge of routeGraph.adjacency.get(currentId) ?? []) {
      const nextDistance = baseDistance + edgeCost(edge, input, routeGraph);
      if (nextDistance >= (distances.get(edge.to) ?? Infinity)) continue;
      distances.set(edge.to, nextDistance);
      previous.set(edge.to, { nodeId: currentId, edge });
      open.push(edge.to, routePriority(routeGraph, edge.to, goalNode, targetPosition, nextDistance));
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

  return composeRoutePlanFromPath(
    input,
    routeGraph,
    goalNode,
    pathNodeIds,
    pathEdges,
    distances.get(goalNode.id) ?? distance2D(input.bot.position, targetPosition),
    expandedNodes,
    capped,
    capped ? 'route expansion cap reached' : 'planned route graph path',
    cacheKey
  );
}

export function chooseBotCombatPlan(input: BotCombatPlanInput): BotCombatPlan {
  let bestTarget: BotKnownEnemy | null = null;
  let bestScore = -Infinity;
  const healthRatio = input.bot.health / Math.max(1, input.bot.maxHealth);
  const localEnemyPressure = Math.max(0, input.blackboard.nearbyEnemyCount - input.blackboard.nearbyAllyCount);
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
    if (enemy.visible && !enemy.hasLineOfSight && !enemy.player.hasFlag) score -= 80;
    if (input.protectedEnemyIds.has(enemy.player.id)) score -= 260;
    if (input.focusTargetIds?.has(enemy.player.id)) score += input.skill.focusFireWeight * 120;
    score += (1 - enemyHealthRatio) * 180;
    score += Math.max(0, 28 - enemy.distance) * 4.5;
    score -= Math.max(0, enemy.distance - input.primaryRange) * (enemy.player.hasFlag ? 2 : 6);
    if (!enemy.visible && !enemy.player.hasFlag) score -= 80;
    if (localEnemyPressure > 0 && !enemy.player.hasFlag) score -= localEnemyPressure * 34;
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

  const minimumRange = getBotMinimumCombatRange(input.bot.heroId, input.skill);
  const closeRange = getBotCloseCombatRange(input.bot.heroId, input.skill, input.primaryRange);
  const cautiousUnderPressure = (localEnemyPressure >= 2 && healthRatio < 0.78) || healthRatio < input.skill.retreatHealthRatio + 0.1;
  const canSafelyClose = bestTarget.player.hasFlag
    || (
      bestTarget.visible &&
      bestTarget.hasLineOfSight &&
      !cautiousUnderPressure &&
      localEnemyPressure <= 1
    );
  const stance: BotCombatPlan['stance'] = input.intent.type === 'retreat' || (cautiousUnderPressure && bestTarget.distance < closeRange + 4)
    ? 'retreat'
    : input.intent.type === 'escort_allied_carrier'
      ? 'escort'
      : input.bot.hasFlag
        ? 'kite'
        : bestTarget.distance < minimumRange
          ? 'kite'
          : bestTarget.distance > closeRange && canSafelyClose
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
  const inRangeDebts: BotAllyHealthDebt[] = [];
  let allyHealValue = 0;
  let criticalAlly: BotAllyHealthDebt | null = null;
  for (const debt of input.blackboard.allyHealthDebts) {
    if (debt.distance > CHRONOS_LIFELINE_RADIUS) continue;
    inRangeDebts.push(debt);
    const actualHeal = Math.min(CHRONOS_LIFELINE_ALLY_HEAL, debt.missingHealth);
    allyHealValue += actualHeal * (debt.effectiveMissingHealth / Math.max(1, debt.missingHealth));
    if (!criticalAlly && (debt.healthRatio < 0.35 || (debt.isCarrier && debt.healthRatio < 0.7 && debt.threatened))) {
      criticalAlly = debt;
    }
    if (inRangeDebts.length >= CHRONOS_LIFELINE_MAX_TARGETS) break;
  }
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
  let count = 0;
  for (const enemy of input.blackboard.visibleEnemies) {
    if (distance2D(enemy.lastKnownPosition, position) <= radius) count++;
  }
  return count;
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
    canUseBotAbility(input.bot, 'hookshot_ground_hooks', 'ultimate') &&
    (
      input.geometry.groundHooksValuable ||
      input.intent.type === 'return_dropped_friendly_flag' ||
      input.blackboard.nearbyEnemyCount >= 2 ||
      hasVisibleObjectiveContest(input, input.intent.targetPosition, 14)
    )
  ) {
    best = abilityCandidate(best, {
      mode: 'hookshot_ground_hooks',
      slot: 'ultimate',
      score: 130 + input.blackboard.nearbyEnemyCount * 34 + (input.geometry.groundHooksValuable ? 58 : 0),
      reason: 'ground hooks control objective zone',
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

  let nearbyVisibleEnemyCount = 0;
  for (const enemy of input.blackboard.visibleEnemies) {
    if (enemy.distance <= BLAZE_GEARSTORM_RADIUS + 4) nearbyVisibleEnemyCount++;
  }
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
  skill: BotSkillProfile,
  combatPlan: Pick<BotCombatPlan, 'stance'> | null = null
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
    const minimumRange = getBotMinimumCombatRange(bot.heroId, skill);
    const stance = combatPlan?.stance
      ?? (intent.type === 'retreat' ? 'retreat' : bot.hasFlag ? 'kite' : 'strafe');
    let rangeMove: PlainVec2 = { x: 0, z: 0 };

    if (stance === 'retreat' || distance < minimumRange || (stance === 'kite' && distance < preferredRange + 3)) {
      rangeMove = awayFromEnemy;
    } else if (stance === 'close' && distance > preferredRange + 1) {
      rangeMove = toEnemy;
    } else if (stance === 'escort' && distance < preferredRange - 1) {
      rangeMove = awayFromEnemy;
    }

    if (intent.type === 'carry_flag_home' || intent.type === 'return_dropped_friendly_flag') {
      move = mix2D(move, 1.35, rangeMove, stance === 'kite' || stance === 'retreat' ? 0.85 : 0.45);
      move = mix2D(move, 1, strafe, 0.25);
    } else if (intent.type === 'retreat') {
      move = mix2D(move, 1.2, awayFromEnemy, 0.65);
      move = mix2D(move, 1, strafe, 0.25);
    } else if (intent.type === 'escort_allied_carrier') {
      move = mix2D(move, 0.95, rangeMove, 0.55);
      move = mix2D(move, 1, strafe, 0.35);
    } else if (intent.type === 'intercept_enemy_carrier') {
      move = stance === 'close'
        ? mix2D(toEnemy, 1.05, strafe, 0.26)
        : mix2D(rangeMove, 0.8, strafe, 0.72);
    } else {
      const rangeWeight = stance === 'close' ? 0.95 : stance === 'kite' || stance === 'retreat' ? 1.15 : 0.35;
      const strafeWeight = distance < preferredRange + 6 ? 0.82 : 0.52;
      move = mix2D(rangeMove, rangeWeight, strafe, strafeWeight);
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
