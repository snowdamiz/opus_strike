import type { IncomingMessage } from 'http';
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay, performance, type IntervalHistogram } from 'node:perf_hooks';
import { Room, Client } from 'colyseus';
import { GameState } from './schema/GameState';
import { Player } from './schema/Player';
import { Vec3Schema, AbilityStateSchema } from './schema/Components';
import { PlayerSpatialIndex } from './PlayerSpatialIndex';
import { MovementCommandQueue } from './MovementCommandQueue';
import { estimateCustomMessageBytes } from './customMessageMetrics';
import {
  buildPlayerInterestSnapshot,
  getPlayerInterestSignature,
} from './playerInterestSnapshot';
import {
  VisibilityInterestManager,
  type RecipientInterestDecision,
  type VisibilityInterestContext,
  type VisibilityInterestPlayer,
  type VisibilityInterestMetrics,
} from './visibilityInterest';
import {
  SERVER_MOVEMENT_SUBSTEPS_PER_TICK,
  getMovementCommandDrainDecision,
} from './movementCommandDrain';
import {
  DEFAULT_GAME_CONFIG,
  TICK_INTERVAL_MS,
  HERO_DEFINITIONS,
  ABILITY_DEFINITIONS,
  getHeroStats,
  ALL_HERO_IDS,
  createRandomSeed,
  generateProceduralVoxelMap,
  createProceduralTerrainLookup,
  getVoxelMapTheme,
  GOLDEN_VOXEL_MAP_THEME_ID,
  getRankFromRating,
  toPublicRankSnapshot,
  isInsideBoundaryPolygon,
  clampToBoundaryPolygon,
  isCollisionBlock,
  FLAG_CAPTURE_RADIUS,
  FLAG_PICKUP_RADIUS,
  ULTIMATE_CHARGE_PER_CAPTURE,
  ULTIMATE_CHARGE_PER_KILL,
  ULTIMATE_CHARGE_PER_SECOND,
  BLAZE_FLAMETHROWER_MAX_FUEL,
  BLAZE_FLAMETHROWER_FUEL_DRAIN,
  BLAZE_FLAMETHROWER_FUEL_REGEN,
  BLAZE_FLAMETHROWER_RANGE,
  BLAZE_FLAMETHROWER_CONE_HALF_ANGLE,
  BLAZE_FLAMETHROWER_DAMAGE,
  BLAZE_FLAMETHROWER_DAMAGE_INTERVAL,
  BLAZE_FLAMETHROWER_BURN_DAMAGE,
  BLAZE_FLAMETHROWER_BURN_INTERVAL_MS,
  BLAZE_FLAMETHROWER_BURN_TICKS,
  BLAZE_GEARSTORM_RADIUS,
  BLAZE_GEARSTORM_DAMAGE,
  BLAZE_GEARSTORM_DAMAGE_INTERVAL_MS,
  BLAZE_ROCKET_DAMAGE,
  BLAZE_ROCKET_FIRE_INTERVAL_MS,
  BLAZE_ROCKET_SPEED,
  BLAZE_ROCKET_COLLISION_RADIUS,
  BLAZE_ROCKET_SPLASH_RADIUS,
  BLAZE_BOMB_DAMAGE,
  BLAZE_BOMB_SPLASH_RADIUS,
  BLAZE_BOMB_MAX_RANGE,
  BLAZE_BOMB_MIN_RANGE,
  BLAZE_BOMB_AEGIS_COLLISION_RADIUS,
  BLAZE_FLAMETHROWER_COLLISION_RADIUS,
  CHRONOS_ASCENDANT_PARADOX_DURATION_MS,
  CHRONOS_ASCENDANT_PARADOX_PULSE_COOLDOWN_MS,
  CHRONOS_ASCENDANT_PARADOX_PULSE_COLLISION_RADIUS,
  CHRONOS_ASCENDANT_PARADOX_PULSE_DAMAGE,
  CHRONOS_ASCENDANT_PARADOX_PULSE_RADIUS,
  CHRONOS_ASCENDANT_PARADOX_PULSE_SPEED,
  CHRONOS_ASCENDANT_PARADOX_SPEED_MULTIPLIER,
  CHRONOS_AEGIS_SHIELD_MAX_HP,
  CHRONOS_AEGIS_SHIELD_RECHARGE_PER_SECOND,
  CHRONOS_AEGIS_TARGET_BACK_MAX,
  CHRONOS_LIFELINE_ALLY_HEAL,
  CHRONOS_LIFELINE_MAX_TARGETS,
  CHRONOS_LIFELINE_RADIUS,
  CHRONOS_LIFELINE_RELEASE_DELAY_MS,
  CHRONOS_LIFELINE_SELF_HEAL,
  CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
  CHRONOS_TIMEBREAK_SHOCKWAVE_AUTHORITY_MS,
  CHRONOS_TIMEBREAK_SHOCKWAVE_HALF_ANGLE,
  CHRONOS_TIMEBREAK_SHOCKWAVE_KNOCKBACK_FORCE,
  CHRONOS_TIMEBREAK_SHOCKWAVE_MAX_VERTICAL_DELTA,
  CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE,
  CHRONOS_TIMEBREAK_SHOCKWAVE_VERTICAL_FORCE,
  CHRONOS_VERDANT_PULSE_AIM_DISTANCE,
  CHRONOS_VERDANT_PULSE_COLLISION_RADIUS,
  CHRONOS_VERDANT_PULSE_COOLDOWN_MS,
  CHRONOS_VERDANT_PULSE_DAMAGE,
  CHRONOS_VERDANT_PULSE_FIRE_READY_MS,
  CHRONOS_VERDANT_PULSE_SPEED,
  GRAPPLE_MAX_DISTANCE,
  HOOKSHOT_CHAIN_HOOKS_COOLDOWN_MS,
  HOOKSHOT_CHAIN_HOOKS_COLLISION_RADIUS,
  HOOKSHOT_CHAIN_HOOKS_DAMAGE,
  HOOKSHOT_CHAIN_HOOKS_MAX_DISTANCE,
  HOOKSHOT_DRAG_HOOK_COLLISION_RADIUS,
  HOOKSHOT_DRAG_HOOK_DAMAGE,
  HOOKSHOT_DRAG_HOOK_MAX_DISTANCE,
  HOOKSHOT_DRAG_HOOK_PULL_FRONT_DISTANCE,
  HOOKSHOT_DRAG_HOOK_RETRACT_SPEED,
  HOOKSHOT_GROUND_HOOKS_RADIUS,
  HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS,
  PHANTOM_DIRE_BALL_COLLISION_RADIUS,
  PHANTOM_DIRE_BALL_DAMAGE,
  PHANTOM_PRIMARY_MAGAZINE_SIZE,
  PHANTOM_PRIMARY_COOLDOWN_MS,
  PHANTOM_PRIMARY_FIRE_READY_MS,
  PHANTOM_PRIMARY_RELOAD_MS,
  PHANTOM_VEIL_SPEED_MULTIPLIER,
  PHANTOM_VOID_RAY_COOLDOWN_MS,
  PHANTOM_VOID_RAY_COLLISION_RADIUS,
  PHANTOM_VOID_RAY_DAMAGE,
  PLAYER_COMBAT_HITBOX_PADDING,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  VOID_RAY_CHARGE_TIME,
  MOVEMENT_PROTOCOL_VERSION,
  MOVEMENT_SUBSTEP_SECONDS,
  MOVEMENT_MAX_PACKET_COMMANDS,
  MOVEMENT_MAX_SERVER_QUEUE,
  MOVEMENT_MAX_COMMANDS_PER_SECOND,
  MOVEMENT_COMMAND_STALE_GRACE_STEPS,
  inputStateToMovementButtons,
  movementButtonsToInputState,
  isMovementSeqAfter,
  nextMovementSeq,
  movementSeqDistance,
  parseMovementCommandPayload,
  sanitizeAbilityCastOriginHints,
  normalizeLookYaw,
  clampLookPitch,
  calculateLookDirection,
  calculatePlayerSocketPosition,
  resolveAbilitySocket,
  getChronosAegisCenter as getSharedChronosAegisCenter,
  getChronosAegisForward as getSharedChronosAegisForward,
  getChronosAegisForwardDot as getSharedChronosAegisForwardDot,
  getBlazeMeteorPath,
  getPlayerBodyAimPosition as getSharedPlayerBodyAimPosition,
  getPlayerEyePosition as getSharedPlayerEyePosition,
  getPlayerLineOfSightSamplePoints as getSharedPlayerLineOfSightSamplePoints,
  getSegmentHitAgainstPlayerCombatHitbox,
  getSegmentHitAgainstChronosAegis,
} from '@voxel-strike/shared';
import type { 
  AbilityCastOriginHint,
  BotDifficulty,
  HeroId, 
  Team, 
  PlayerInput,
  PlayerMovementState,
  MovementCommand,
  MovementCommandPacket,
  MovementCorrectionReason,
  MovementTelemetrySnapshot,
  GameEndEvent,
  MatchMode,
  MatchOutcome,
  MatchSummaryPlayer,
  SelfMovementAuthority,
  MatchSnapshotMessage,
  PhantomShieldBrokenEvent,
  PlayerPingRequestMessage,
  PlayerPingsMessage,
  PlayerInterestMessage,
  PlayerTransformsV2Message,
  PlayerVitalsAbilitySnapshot,
  PlayerVitalsMessage,
  PlayerVitalsSnapshot,
  PlayerVisibilityState,
  PackedPlayerTransform,
  VoxelChunk,
  VoxelMapManifest,
  VoxelMapTheme,
} from '@voxel-strike/shared';
import {
  HOOKSHOT_GRAPPLE_EXTENSION_SPEED,
  canCapsuleOccupy,
  computeAnchorWallAabbs,
  createVoxelCollisionWorld,
  createHookshotSwingState,
  resolveCapsuleTeleportDestination,
  simulateSharedMovement,
  stepHookshotSwing,
  sweepCapsulePathClear,
  type AnchorWallCollisionSource,
  type HookshotSwingState,
  type MovementAabb,
  type MovementCollisionBounds,
  type MovementCollisionWorld,
  type MovementTerrainAdapter,
} from '@voxel-strike/physics';
import { loggers } from '../utils/logger';
import prisma from '../db';
import {
  assertUsableEntryTicketSecret,
  isDevelopmentToolsEnabled,
  isDirectGameRoomJoinAllowed,
} from '../config/security';
import { resolveRoomAuthContext, type RoomAuthContext } from '../auth/session';
import { verifyGameEntryTicket, type GameEntryTicketClaims } from '../security/entryTickets';
import {
  calculateRankedRatingUpdates,
  type RankedUserState,
} from '../ranking/ratingService';
import { voiceService } from '../voice/VoiceService';
import { wagerService, type GoldenBiomeRewardWinner, type LockedWagerContext } from '../wagers/service';
import {
  calculateParticipantExperience,
  calculateParticipantScore,
  getMatchOutcome,
  persistCompletedMatch,
  type MatchParticipantSnapshot,
} from '../persistence/matchPersistence';
import { serializeReportMetadata } from '../reports/playerReportService';
import {
  AntiCheatEvidenceStore,
  AntiCheatRoomRuntime,
  advanceMovementShadowSimulation,
  createMovementShadowSimulationState,
  getAntiCheatConfig,
  recordMovementShadowDriftSample,
  type AntiCheatIntegrityGate,
  type MovementShadowSimulationState,
} from '../anticheat';
import { AccountRestrictedError, assertGameplayAccountEligible } from '../auth/accountEligibility';
import { consumeReplayNonce } from '../security/replayNonceStore';
import type { LastSafeMovementState } from './movementValidation';
import {
  GAME_MESSAGE_RATE_LIMITS,
  MessageRateLimiter,
} from './rateLimiter';
import {
  DEFAULT_COMPETITIVE_NETWORK_QUALITY_GATE,
  createNetworkQualityState,
  evaluatePlayerNetworkQuality,
  isNetworkQualityGateRequiredForMatch,
  recordNetworkQualitySample,
  type NetworkQualityState,
  type PlayerNetworkQualityEvaluation,
} from './networkQualityGate';
import { shouldResolveGenericSecondaryAttack } from './combatInputRouting';
import { getSecurityEventLogLevel } from './securityEventLogging';
import {
  isHeroId,
  isRecord,
  isTeam,
  sanitizeShortText,
  validateBotIdPayload,
  validateChatPayload,
  validateHeroPayload,
  validateReadyPayload,
  validateTeamPayload,
  validateVec3,
} from './protocolValidation';
import {
  BOT_AWARENESS_RANGE,
  BOT_CLOSE_REVEAL_RANGE,
  BOT_LOS_SAMPLE_STEP,
  BOT_TACTICS_INTERVAL_MS,
  buildBotBlackboard,
  buildTeamTactics,
  chooseBotAbilityPlan,
  chooseBotCombatPlan,
  chooseLocalAvoidanceDirection,
  clearExpiredBlockedEdges,
  composeBotMovementDirection,
  createBotRouteGraphAdapter,
  createInitialBotBrain,
  createSteeringProbeDirections,
  getBotPreferredCombatRange,
  getBotSkillProfile,
  normalizeBotDifficulty,
  planBotRoute,
  scoreBotIntents,
  updateBotMovementProgress,
  type BotAbilityGeometry,
  type BotAbilityPlan,
  type BotBlackboard,
  type BotBrain,
  type BotFlagSnapshot,
  type BotPlayerSnapshot,
  type BotRecentDamageSource,
  type BotRouteGraphAdapter,
  type BotRoutePlan,
  type BotSkillProfile,
  type BotTeamTacticsByTeam,
  type PlainVec2,
  type PlainVec3,
} from './bot-ai';

// Import extracted ability handlers
import {
  VoidZone,
  VOID_ZONE_RADIUS,
  VOID_ZONE_DAMAGE,
  VOID_ZONE_DURATION,
  VOID_ZONE_DAMAGE_INTERVAL,
  initializePlayerAbilities,
  resetAbilityCooldowns,
  tryUseAbility,
  executeAbility,
  deactivateActiveAbility,
  updateAbilityCooldowns,
  updateActiveAbilities,
} from './abilityHandlers';

interface CreateOptions {
  lobbyId?: string;
  lobbyName?: string;
  matchMode?: MatchMode;
  mapSeed?: number;
  mapThemeId?: VoxelMapTheme['id'] | null;
  botAssignments?: BotAssignment[];
  observerCount?: number;
  wagerContext?: LockedWagerContext | null;
  rankedEligible?: boolean;
  requiredHumanPlayers?: number;
  reservedHumanPlayers?: number;
}

interface JoinOptions {
  playerName?: string;
  preferredTeam?: Team;
  entryTicket?: string;
  reconnectToRunningGame?: boolean;
  authToken?: string;
  clientBuildId?: string;
  movementProtocolVersion?: number;
}

const PLAYER_REPORT_REASONS = new Set([
  'cheating',
  'aimbot',
  'wallhack',
  'speed_hack',
  'movement_exploit',
  'ability_exploit',
  'match_exploit',
  'other',
]);

interface BotAssignment {
  playerId: string;
  playerName: string;
  team: Team;
  isBot: true;
  heroId?: HeroId;
  botDifficulty?: BotDifficulty;
  botProfileId?: string;
}

interface SpawnPosition {
  x: number;
  y: number;
  z: number;
}

export interface TeamSpawnParticipant {
  playerId: string;
  team: Team;
}

export interface TeamSpawnAssignment {
  playerId: string;
  team: Team;
  spawnIndex: number;
}

function normalizeSpawnOffset(offset: number, spawnPointCount: number): number {
  if (spawnPointCount <= 0) return 0;
  return ((Math.floor(offset) % spawnPointCount) + spawnPointCount) % spawnPointCount;
}

export function createTeamSpawnAssignments(
  participants: readonly TeamSpawnParticipant[],
  spawnPointCounts: Record<Team, number>,
  offsetByTeam: Partial<Record<Team, number>> = {}
): TeamSpawnAssignment[] {
  const nextTeamIndex: Record<Team, number> = { red: 0, blue: 0 };
  const assignments: TeamSpawnAssignment[] = [];

  for (const participant of participants) {
    const spawnPointCount = Math.max(0, Math.floor(spawnPointCounts[participant.team] ?? 0));
    if (spawnPointCount === 0) continue;

    const offset = normalizeSpawnOffset(offsetByTeam[participant.team] ?? 0, spawnPointCount);
    const teamIndex = nextTeamIndex[participant.team]++;
    assignments.push({
      playerId: participant.playerId,
      team: participant.team,
      spawnIndex: (offset + teamIndex) % spawnPointCount,
    });
  }

  return assignments;
}

type PendingPlayerPing = { nonce: string; sentAt: number };
type PreMatchCancelReason = 'start_timeout' | 'network_quality';

interface PreMatchCancelNotice {
  reason: PreMatchCancelReason;
  message: string;
  blockedPlayerId?: string;
  blockedPlayerName?: string;
  networkQuality?: Record<string, unknown>;
}

interface CompetitiveNetworkQualityGateResult {
  status: 'ready' | 'pending' | 'blocked';
  evaluation?: PlayerNetworkQualityEvaluation;
}

interface DamageHistoryEntry {
  damage: number;
  timestamp: number;
  damageType: string;
  sourcePosition: PlainVec3 | null;
  sourceDirection: PlainVec3 | null;
}

interface DamageContext {
  abilityId?: string;
  sourcePosition?: PlainVec3 | null;
  sourceDirection?: PlainVec3 | null;
}

interface PhantomPrimaryMagazineState {
  ammo: number;
  reloadUntil: number;
  reloadStartedAt: number;
}

interface PhantomCastPayload {
  playerId: string;
  abilityId: string;
  castId: string;
  position: PlainVec3;
  startPosition?: PlainVec3;
  targetPosition?: PlainVec3;
  impactPosition?: PlainVec3;
  interceptedByChronosAegis?: boolean;
  aimDirection?: PlainVec3;
  velocity?: PlainVec3;
  maxDistance?: number;
  ownerTeam?: Team;
  launchSide?: -1 | 1;
  launchYaw?: number;
  targetIds?: string[];
  serverTime: number;
  durationMs?: number;
  ammoRemaining?: number;
  reloadStartedAt?: number;
  reloadUntil?: number;
  targets?: HookshotGroundHooksTarget[];
  radius?: number;
  duration?: number;
  impactTime?: number;
  rootUntil?: number;
}

interface HookshotGroundHooksTarget {
  targetId: string;
  position: PlainVec3;
  rootUntil: number;
}

interface HookshotAnchorWallInstance extends AnchorWallCollisionSource {
  ownerId: string;
  ownerTeam: Team;
}

interface HookshotGrappleAuthorityState {
  castId: string;
  target: PlainVec3;
  attachAt: number;
  swing: HookshotSwingState | null;
}

interface HookshotDragPullAuthorityState {
  sourceId: string;
  forward: PlainVec3;
  frontDistance: number;
  startedAt: number;
  expiresAt: number;
}

interface PendingAreaDamageInstance {
  id: string;
  ownerId: string;
  center: PlainVec3;
  radius: number;
  damage: number;
  damageType: string;
  resolveAt: number;
}

interface BlazeGearstormInstance {
  id: string;
  ownerId: string;
  ownerTeam: Team;
  position: PlainVec3;
  radius: number;
  damage: number;
  startTime: number;
  endTime: number;
  lastDamageTick: Map<string, number>;
}

interface BlazeBurnEffect {
  sourceId: string;
  ticksRemaining: number;
  nextTickAt: number;
  sourcePosition: PlainVec3 | null;
  sourceDirection: PlainVec3 | null;
}

interface ServerMovementAuthorityState {
  pendingCommands: MovementCommandQueue;
  lastProcessedSeq: number;
  movementEpoch: number;
  correctionReason: MovementCorrectionReason | null;
  metrics: MovementTelemetrySnapshot;
  commandWindowStartedAt: number;
  commandsInWindow: number;
  lastAuthoritySentAt: number;
  lastSafe: LastSafeMovementState | null;
  objectiveSuppressedUntil: number;
  shadow: MovementShadowSimulationState;
}

interface SecurityEvent {
  type: string;
  playerId: string;
  userId?: string;
  roomId: string;
  tick: number;
  movementEpoch: number;
  movementSequence?: number;
  reason?: string;
  position?: PlainVec3;
  serverTime: number;
  detail?: Record<string, unknown>;
}

interface ReconnectParticipant {
  userId: string;
  lobbyPlayerId: string;
  displayName: string;
  assignedTeam?: Team;
  selectedHero?: HeroId;
  observer: boolean;
}

interface CustomMessageMetric {
  messages: number;
  recipients: number;
  bytes: number;
}

interface RoomLoadSnapshot {
  tickDurationP50Ms: number;
  tickDurationP95Ms: number;
  tickDurationP99Ms: number;
  eventLoopDelayP95Ms: number;
  eventLoopDelayP99Ms: number;
  customMessageBytes: number;
  customMessageCount: number;
  interestRecomputeMs: number;
  interestLosChecks: number;
  interestVisibleTargets: number;
  interestHiddenTargets: number;
  interestLastKnownTargets: number;
  streamTransformsBytes: number;
  streamVitalsBytes: number;
  streamFilteredTargets: number;
  streamHiddenTargetLeakCount: number;
  antiCheatQueueDepth: number;
  antiCheatDroppedLowMediumSignals: number;
  antiCheatDbErrors: number;
}

interface TransformReplicationState {
  signatures: Map<string, PackedPlayerTransform>;
  heartbeatAt: Map<string, number>;
}

interface PlayerVitalsReplicationState {
  signatures: Map<string, PlayerVitalsSnapshot>;
  reconcileAt: Map<string, number>;
  knownPlayerIds: Set<string>;
}

interface BotFrameContext {
  snapshots: BotPlayerSnapshot[];
  snapshotById: Map<string, BotPlayerSnapshot>;
  flags: Record<Team, BotFlagSnapshot>;
  teamTactics: BotTeamTacticsByTeam;
  protectedEnemyIdsByTeam: Record<Team, Set<string>>;
  visibleEnemyIdsByBot: Map<string, Set<string>>;
  enemyLineOfSightIdsByBot: Map<string, Set<string>>;
}

interface ReplicationFrameContext {
  now: number;
  currentIds: Set<string>;
  visibilityContext: VisibilityInterestContext;
  visibilityPlayers: Map<string, VisibilityInterestPlayer>;
  packedTransforms: Map<string, PackedPlayerTransform>;
  packedTransformSignatures: Map<string, PackedPlayerTransform>;
  recipientInterests: Map<string, Map<string, RecipientInterestDecision>>;
  fullVitalsByPlayer: Map<string, PlayerVitalsSnapshot>;
  visibleEnemyVitalsByPlayer: Map<string, PlayerVitalsSnapshot>;
  publicEnemyVitalsByPlayer: Map<string, PlayerVitalsSnapshot>;
}

interface RoomInterestMetricsSnapshot extends VisibilityInterestMetrics {
  transformBytes: number;
  vitalsBytes: number;
}

type MatchPersistenceState = 'active' | 'persisting' | 'persisted' | 'failed';

interface MatchLedgerParticipant extends MatchParticipantSnapshot {
  team: Team;
}

interface MatchPersistenceLedger {
  matchId: string;
  roomId: string;
  lobbyId: string | null;
  matchMode: MatchMode;
  mapSeed: number;
  mapThemeId: VoxelMapTheme['id'];
  rankedEligible: boolean;
  startedAt: Date;
  endedAt: Date | null;
  redScore: number | null;
  blueScore: number | null;
  winningTeam: Team | null;
  state: MatchPersistenceState;
  participants: Map<string, MatchLedgerParticipant>;
}

interface AttackConfig {
  damage: number;
  range: number;
  cooldownMs: number;
  coneDot: number;
  radius?: number;
  collisionRadius?: number;
  targetTeam?: AttackTargetTeam;
  damageType: string;
}

type AttackTargetTeam = 'enemy' | 'any';

interface AimTargetHit {
  target: Player;
  hit: NonNullable<ReturnType<typeof getSegmentHitAgainstPlayerCombatHitbox>>;
}

interface ChronosAegisSkillHit {
  blocker: Player;
  point: PlainVec3;
  normal: PlainVec3;
  distance: number;
}

interface SkillImpactHint {
  impactPosition?: PlainVec3;
  interceptedByChronosAegis?: boolean;
  targetIds?: string[];
}

const BLAZE_ROCKET_AIM_DISTANCE = 120;
const BLAZE_BOMB_COOLDOWN_MS = 8000;
const BLAZE_BOMB_FALL_DURATION_MS = 1500;
const BLAZE_BOMB_WARNING_LEAD_MS = 350;
const ABILITY_CAST_HINT_MAX_DISTANCE_FROM_FALLBACK = 1.15;
const ABILITY_CAST_HINT_MAX_DISTANCE_FROM_PLAYER_CENTER = 1.7;
const ABILITY_CAST_HINT_MAX_VERTICAL_FROM_PLAYER_CENTER = 1.15;

// Track previous press state to detect edges for both humans and server-owned bots.
type PlayerPressState = {
  primaryFire: boolean;
  secondaryFire: boolean;
  reload: boolean;
  ability1: boolean;
  ability2: boolean;
  ultimate: boolean;
};
type ChronosLifelineMode = 'allies' | 'self';
type DevBotSkillSlot = 'primary' | 'secondary' | 'ability1' | 'ability2' | 'ultimate';
type DevBotLookDirection = 'up' | 'down';
interface DevBotSkillOverride {
  slot: DevBotSkillSlot;
  skillKey: string;
  expiresAt: number;
}
interface DevBotLookOverride {
  direction: DevBotLookDirection;
  pitch: number;
  expiresAt: number;
}

const playerPressState = new Map<string, PlayerPressState>();
const DEV_BOT_SKILL_HOLD_MS = 10_000;
const DEV_BOT_LOOK_HOLD_MS = 10_000;
const DEV_BOT_LOOK_PITCH: Record<DevBotLookDirection, number> = {
  up: Math.PI / 2,
  down: -Math.PI / 2,
};
const DEV_BOT_SKILL_ALIASES: Record<string, { slot: DevBotSkillSlot; skillKey: string }> = {
  lmb: { slot: 'primary', skillKey: 'lmb' },
  m1: { slot: 'primary', skillKey: 'lmb' },
  mouse1: { slot: 'primary', skillKey: 'lmb' },
  leftmouse: { slot: 'primary', skillKey: 'lmb' },
  mouseleft: { slot: 'primary', skillKey: 'lmb' },
  primary: { slot: 'primary', skillKey: 'lmb' },
  fire: { slot: 'primary', skillKey: 'lmb' },
  attack: { slot: 'primary', skillKey: 'lmb' },
  rmb: { slot: 'secondary', skillKey: 'rmb' },
  m2: { slot: 'secondary', skillKey: 'rmb' },
  mouse2: { slot: 'secondary', skillKey: 'rmb' },
  rightmouse: { slot: 'secondary', skillKey: 'rmb' },
  mouseright: { slot: 'secondary', skillKey: 'rmb' },
  secondary: { slot: 'secondary', skillKey: 'rmb' },
  altfire: { slot: 'secondary', skillKey: 'rmb' },
  shield: { slot: 'secondary', skillKey: 'rmb' },
  e: { slot: 'ability1', skillKey: 'e' },
  ability1: { slot: 'ability1', skillKey: 'e' },
  q: { slot: 'ability2', skillKey: 'q' },
  ability2: { slot: 'ability2', skillKey: 'q' },
  f: { slot: 'ultimate', skillKey: 'f' },
  ult: { slot: 'ultimate', skillKey: 'f' },
  ultimate: { slot: 'ultimate', skillKey: 'f' },
};
const BLAZE_FLAMETHROWER_CONE_DOT = Math.cos(BLAZE_FLAMETHROWER_CONE_HALF_ANGLE);
const DAMAGE_HISTORY_WINDOW_MS = 10000;
const PLAYER_PING_INTERVAL_MS = 3000;
const PLAYER_PING_TIMEOUT_MS = 10000;
const MAX_REPORTED_PLAYER_PING_MS = 999;
const LOS_CACHE_TTL_MS = 180;
const TRANSFORM_POSITION_SCALE = 100;
const TRANSFORM_VELOCITY_SCALE = 100;
const TRANSFORM_ANGLE_SCALE = 10000;
const PLAYER_VITALS_INTERVAL_MS = 125;
const PLAYER_VITALS_RECONCILE_INTERVAL_MS = 2500;
const TRANSFORM_HEARTBEAT_INTERVAL_MS = 250;
const DISTANT_TRANSFORM_HEARTBEAT_INTERVAL_MS = 750;
const TRANSFORM_HIGH_RELEVANCE_DISTANCE_SQ = 48 * 48;
const RECENT_COMBAT_TRANSFORM_MS = 650;
const RECENT_COMBAT_INTEREST_MS = 900;
const PLAYER_INTEREST_INTERVAL_MS = 200;
const FLAG_CARRIER_APPROX_GRID_METERS = 12;
const MATCH_SNAPSHOT_DRIFT_SYNC_INTERVAL_MS = 2000;
const LOW_FREQUENCY_STATE_INTERVAL_MS = 250;
const ROOM_LOAD_SAMPLE_COUNT = 240;
const MOVEMENT_BIT_GROUNDED = 1 << 0;
const MOVEMENT_BIT_SPRINTING = 1 << 1;
const MOVEMENT_BIT_CROUCHING = 1 << 2;
const MOVEMENT_BIT_SLIDING = 1 << 3;
const MOVEMENT_BIT_WALL_RUNNING = 1 << 4;
const MOVEMENT_BIT_GRAPPLING = 1 << 5;
const MOVEMENT_BIT_JETPACKING = 1 << 6;
const MOVEMENT_BIT_GLIDING = 1 << 7;
const MOVEMENT_BIT_CHRONOS_AEGIS = 1 << 8;
const CHRONOS_AEGIS_SHIELD_TRANSFORM_SCALE = 255;
const OBJECTIVE_SUPPRESSION_MS = 650;
const DAMAGE_CAP_WINDOW_MS = 1000;
const DAMAGE_CAP_PER_SOURCE_TARGET_MULTIPLIER = 2.25;
const MAX_SECURITY_EVENTS = 2000;
const SECURITY_EVENT_LOG_SAMPLE_MS = 5000;
const MOVEMENT_CORRECTION_LOG_SAMPLE_MS = 1000;
const MAX_SECURITY_LOG_SAMPLE_KEYS = 1024;
const PRIMARY_ATTACKS: Partial<Record<HeroId, AttackConfig>> = {
  phantom: { damage: PHANTOM_DIRE_BALL_DAMAGE, range: 30, cooldownMs: PHANTOM_PRIMARY_COOLDOWN_MS, coneDot: Math.cos(0.18), collisionRadius: PHANTOM_DIRE_BALL_COLLISION_RADIUS, damageType: 'dire_ball' },
  hookshot: { damage: HOOKSHOT_CHAIN_HOOKS_DAMAGE, range: HOOKSHOT_CHAIN_HOOKS_MAX_DISTANCE, cooldownMs: HOOKSHOT_CHAIN_HOOKS_COOLDOWN_MS, coneDot: Math.cos(0.2), collisionRadius: HOOKSHOT_CHAIN_HOOKS_COLLISION_RADIUS, damageType: 'chain_hooks' },
  blaze: { damage: BLAZE_ROCKET_DAMAGE, range: 36, cooldownMs: BLAZE_ROCKET_FIRE_INTERVAL_MS, coneDot: Math.cos(0.22), radius: BLAZE_ROCKET_SPLASH_RADIUS, collisionRadius: BLAZE_ROCKET_COLLISION_RADIUS, damageType: 'rocket' },
  chronos: { damage: CHRONOS_VERDANT_PULSE_DAMAGE, range: 34, cooldownMs: CHRONOS_VERDANT_PULSE_COOLDOWN_MS, coneDot: Math.cos(0.18), collisionRadius: CHRONOS_VERDANT_PULSE_COLLISION_RADIUS, damageType: 'verdant_pulse' },
};
const SECONDARY_ATTACKS: Partial<Record<HeroId, AttackConfig>> = {
  phantom: { damage: PHANTOM_VOID_RAY_DAMAGE, range: 42, cooldownMs: PHANTOM_VOID_RAY_COOLDOWN_MS, coneDot: Math.cos(0.12), collisionRadius: PHANTOM_VOID_RAY_COLLISION_RADIUS, damageType: 'void_ray' },
  hookshot: { damage: HOOKSHOT_DRAG_HOOK_DAMAGE, range: HOOKSHOT_DRAG_HOOK_MAX_DISTANCE, cooldownMs: 3600, coneDot: Math.cos(0.14), collisionRadius: HOOKSHOT_DRAG_HOOK_COLLISION_RADIUS, targetTeam: 'any', damageType: 'drag_hook' },
  blaze: { damage: BLAZE_BOMB_DAMAGE, range: BLAZE_BOMB_MAX_RANGE, cooldownMs: BLAZE_BOMB_COOLDOWN_MS, coneDot: Math.cos(0.32), radius: BLAZE_BOMB_SPLASH_RADIUS, damageType: 'bomb' },
};
const HOOKSHOT_SPEED = 38;
const DRAG_HOOK_SPEED = 50;
const HOOKSHOT_DRAG_HOOK_PULL_MAX_DURATION_MS = 1250;
const HOOKSHOT_DRAG_HOOK_PULL_STOP_DISTANCE = 0.32;
const HOOKSHOT_DRAG_HOOK_PULL_BUMP_ITERATIONS = 3;
const HOOKSHOT_DRAG_HOOK_PULL_BUMP_SKIN = 0.04;
const HOOKSHOT_DRAG_HOOK_PULL_MIN_PROGRESS = 0.025;
const HOOKSHOT_ANCHOR_WALL_DURATION = 6.25;
const HOOKSHOT_ANCHOR_WALL_MAX_DISTANCE = 24.35;
const ROOT_BLOCKED_MOVEMENT_ABILITIES = new Set([
  'phantom_blink',
  'hookshot_grapple',
  'blaze_rocketjump',
  'chronos_ascendant_paradox',
]);
const DEFAULT_MATCH_START_CANCEL_TIMEOUT_MS = 60_000;
const MATCH_CANCEL_DISCONNECT_DELAY_MS = 750;

function readPositiveIntegerEnvMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const MATCH_START_CANCEL_TIMEOUT_MS = readPositiveIntegerEnvMs(
  'MATCH_START_CANCEL_TIMEOUT_MS',
  readPositiveIntegerEnvMs('MATCH_CONNECT_TIMEOUT_MS', DEFAULT_MATCH_START_CANCEL_TIMEOUT_MS)
);

function resolveDevBotSkillOverride(skillKey: string): Omit<DevBotSkillOverride, 'expiresAt'> | null {
  const normalized = skillKey.trim().toLowerCase().replace(/[\s_-]+/g, '');
  const keyWithoutDomPrefix = normalized.startsWith('key') ? normalized.slice(3) : normalized;
  return DEV_BOT_SKILL_ALIASES[keyWithoutDomPrefix] ?? null;
}

function resolveDevBotLookDirection(direction: string): DevBotLookDirection | null {
  const normalized = direction.trim().toLowerCase();
  return normalized === 'up' || normalized === 'down' ? normalized : null;
}

export class GameRoom extends Room<GameState> {
  maxClients = DEFAULT_GAME_CONFIG.maxPlayers;

  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private matchStartCancelTimeout: ReturnType<typeof setTimeout> | null = null;
  private matchCancelDisconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly scheduledTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private readonly config = DEFAULT_GAME_CONFIG;
  private lobbyId: string | null = null;
  private lobbyName: string | null = null;
  private voidZones: VoidZone[] = [];
  private phantomPrimaryMagazines: Map<string, PhantomPrimaryMagazineState> = new Map();
  private phantomPrimaryHoldStartedAt: Map<string, number> = new Map();
  private chronosPrimaryHoldStartedAt: Map<string, number> = new Map();
  private phantomVoidRayChargeStartedAt: Map<string, number> = new Map();
  private phantomVoidRayResolvedForPress: Set<string> = new Set();
  private phantomCastIdCounter: number = 0;
  private blazeRocketIdCounter: number = 0;
  private blazeBombIdCounter: number = 0;
  private blazeGearstormIdCounter: number = 0;
  private hookshotGroundHooksIdCounter: number = 0;
  private phantomPrimaryLaunchSide: Map<string, -1 | 1> = new Map();
  private hookshotPrimaryLaunchSide: Map<string, -1 | 1> = new Map();
  private hookshotAnchorWalls: HookshotAnchorWallInstance[] = [];
  private readonly emptyMovementAabbs: MovementAabb[] = [];
  private hookshotGrapples: Map<string, HookshotGrappleAuthorityState> = new Map();
  private hookshotDragPulls: Map<string, HookshotDragPullAuthorityState> = new Map();
  private playerRootedUntil: Map<string, number> = new Map();
  private pendingAreaDamage: PendingAreaDamageInstance[] = [];
  private blazeGearstorms: BlazeGearstormInstance[] = [];
  private blazeBombDropConsumedForHold: Set<string> = new Set();
  private blazeFlamethrowerActivePlayers: Set<string> = new Set();
  private blazeBurnEffects: Map<string, BlazeBurnEffect> = new Map();
  private voidZoneIdCounter: number = 0;
  private npcIdCounter: number = 0;
  private devBotIdCounter: number = 0;
  private spawnedNpcs: Set<string> = new Set(); // Track NPC IDs
  private movementAuthorities: Map<string, ServerMovementAuthorityState> = new Map();
  private flamethrowerLastDamageTick: Map<string, number> = new Map();
  private botBrains: Map<string, BotBrain> = new Map();
  private attackCooldownUntil: Map<string, number> = new Map();
  private damageHistory: Map<string, Map<string, DamageHistoryEntry>> = new Map();
  private chronosAegisShieldHp: Map<string, number> = new Map();
  private devImmunePlayers: Set<string> = new Set();
  private devGameClockFrozen = false;
  private devBotsRooted = false;
  private devBotBrainEnabled = true;
  private devBotSkillOverrides: Map<string, DevBotSkillOverride> = new Map();
  private devBotLookOverrides: Map<string, DevBotLookOverride> = new Map();
  private mapManifest: VoxelMapManifest | null = null;
  private botRouteGraph: BotRouteGraphAdapter | null = null;
  private botTeamTactics: BotTeamTacticsByTeam | null = null;
  private nextBotTacticsAt = 0;
  private botTacticsRevision = 0;
  private proceduralTerrainLookup: ReturnType<typeof createProceduralTerrainLookup> | null = null;
  private mapChunkLookup: Map<string, VoxelChunk> = new Map();
  private movementCollisionRevision = 0;
  private movementCollisionWorldCache: { revision: number; world: MovementCollisionWorld } | null = null;
  private movementTerrain: MovementTerrainAdapter = {
    getGroundY: (position: { x: number; y: number; z: number }) => this.getProceduralTerrainLookup().getGroundY(position),
    clampPosition: (position: { x: number; y: number; z: number }) => this.getProceduralTerrainLookup().clampToPlayableMap(position),
    getBlockAtWorld: (position: { x: number; y: number; z: number }) => this.getProceduralTerrainLookup().getBlockAtWorld(position),
    getMaxPlayableY: () => this.getProceduralTerrainLookup().getMaxPlayableY(),
    collisionRevision: 0,
    cacheStaticAabbs: true,
    getCollisionAabbs: (bounds: MovementCollisionBounds) => this.getHookshotAnchorWallAabbs(bounds),
  };
  
  // Track durable auth identity -> sessionId mapping for duplicate session handling.
  private identityToSessionId: Map<string, string> = new Map();
  private sessionIdToIdentity: Map<string, string> = new Map();
  private lastVitalsBroadcastAt = 0;
  private lastMatchSnapshotBroadcastAt = 0;
  private lastInterestBroadcastAt = 0;
  private lastLowFrequencyStateAt = 0;
  private lastPingProbeAt = 0;
  private pingProbeSequence = 0;
  private playerVitalRecipientStates = new Map<string, PlayerVitalsReplicationState>();
  private playerInterestSignatures = new Map<string, Map<string, string>>();
  private playerTransformSignatures = new Map<string, PackedPlayerTransform>();
  private playerTransformHeartbeatAt = new Map<string, number>();
  private transformRecipientStates = new Map<string, TransformReplicationState>();
  private readonly replicationVisibilityContext: VisibilityInterestContext = {
    now: 0,
    collisionRevision: 0,
    getEyePosition: GameRoom.getVisibilityEyePosition,
    getLineOfSightPoints: GameRoom.getVisibilityLineOfSightPoints,
    hasLineOfSight: (from, to) => this.hasLineOfSight(from, to),
    getRecentCombatRevealUntil: (recipient, target) => (
      this.recentCombatInterestUntil.get(this.getRecentCombatInterestKey(recipient.id, target.id)) ?? 0
    ),
  };
  private readonly standaloneVisibilityContext: VisibilityInterestContext = {
    now: 0,
    collisionRevision: 0,
    getEyePosition: GameRoom.getVisibilityEyePosition,
    getLineOfSightPoints: GameRoom.getVisibilityLineOfSightPoints,
    hasLineOfSight: (from, to) => this.hasLineOfSight(from, to),
    getRecentCombatRevealUntil: (recipient, target) => (
      this.recentCombatInterestUntil.get(this.getRecentCombatInterestKey(recipient.id, target.id)) ?? 0
    ),
  };
  private readonly replicationFrameContext: ReplicationFrameContext = {
    now: 0,
    currentIds: new Set(),
    visibilityContext: this.replicationVisibilityContext,
    visibilityPlayers: new Map(),
    packedTransforms: new Map(),
    packedTransformSignatures: new Map(),
    recipientInterests: new Map(),
    fullVitalsByPlayer: new Map(),
    visibleEnemyVitalsByPlayer: new Map(),
    publicEnemyVitalsByPlayer: new Map(),
  };
  private recentCombatTransformUntil = new Map<string, number>();
  private recentCombatInterestUntil = new Map<string, number>();
  private transformStreamEpoch = 0;
  private matchSnapshotSignature = '';
  private pendingPlayerPings = new Map<string, PendingPlayerPing>();
  private playerPingMs = new Map<string, number>();
  private playerNetworkQuality = new Map<string, NetworkQualityState>();
  private playerPingsDirty = true;
  private knownPlayerIds = new Set<string>();
  private playerNetIds = new Map<string, number>();
  private nextPlayerNetId = 1;
  private readonly playerSpatialIndex = new PlayerSpatialIndex(8);
  private readonly spatialQueryScratch: Player[] = [];
  private readonly customMessageMetrics = new Map<string, CustomMessageMetric>();
  private readonly visibilityInterest = new VisibilityInterestManager();
  private readonly tickDurationSamplesMs = new Float64Array(ROOM_LOAD_SAMPLE_COUNT);
  private tickDurationSampleIndex = 0;
  private tickDurationSampleCount = 0;
  private eventLoopDelay: IntervalHistogram | null = null;
  private readonly activeBlazePlayersScratch = new Set<string>();
  private readonly urgentBotIdsScratch: string[] = [];
  private readonly deferredBotIdsScratch: string[] = [];
  private alivePlayers: Player[] = [];
  private alivePlayersByTeam: Record<Team, Player[]> = { red: [], blue: [] };
  private losCache = new Map<string, { result: boolean; expiresAt: number }>();
  private readonly lineOfSightSamplePoint: PlainVec3 = { x: 0, y: 0, z: 0 };
  private preferredBotHeroes: Map<string, HeroId> = new Map();
  private readonly rateLimiter = new MessageRateLimiter();
  private readonly playerAuthContexts = new Map<string, RoomAuthContext>();
  private readonly playerEntryTickets = new Map<string, GameEntryTicketClaims>();
  private readonly reconnectParticipants = new Map<string, ReconnectParticipant>();
  private readonly clientsBySessionId = new Map<string, Client>();
  private readonly observerClientIds = new Set<string>();
  private readonly securityEvents: SecurityEvent[] = [];
  private readonly antiCheatEvidenceStore = new AntiCheatEvidenceStore(prisma);
  private antiCheat: AntiCheatRoomRuntime | null = null;
  private readonly securityLogSamples = new Map<string, { lastLoggedAt: number; suppressed: number }>();
  private readonly damageCapWindows = new Map<string, { startedAt: number; damage: number }>();
  private matchPersistenceLedger: MatchPersistenceLedger | null = null;
  private wagerContext: LockedWagerContext | null = null;
  private rankedEligibilityCandidate = false;
  private requiredHumanPlayers = 1;
  private rankedRequiredHumanPlayers = DEFAULT_GAME_CONFIG.maxPlayers;
  private reservedHumanPlayers = 0;
  private matchMode: MatchMode = 'custom';
  private wagerSettlementRequested = false;
  private countdownStartGateOpen = false;
  private countdownStartGateKey = 0;
  private readonly countdownSceneReadyPlayerIds = new Set<string>();
  private matchStartDeadlineAt = 0;
  private matchCancelled = false;
  private matchCancelNotice: PreMatchCancelNotice | null = null;

  async onAuth(
    client: Client,
    options: JoinOptions,
    request?: IncomingMessage
  ): Promise<{ auth: RoomAuthContext; ticket: GameEntryTicketClaims | null }> {
    const directJoin = !this.lobbyId;
    if (directJoin && !isDirectGameRoomJoinAllowed()) {
      this.recordAuthReject(client, 'direct_join_disabled');
      throw new Error('Direct game room joins are disabled');
    }

    const auth = await resolveRoomAuthContext(options as Record<string, unknown>, request);
    let ticket: GameEntryTicketClaims | null = null;

    if (this.lobbyId) {
      ticket = verifyGameEntryTicket(options.entryTicket, {
        lobbyId: this.lobbyId,
        gameRoomId: this.roomId,
      });
      if (!ticket) {
        ticket = this.createRunningGameReconnectTicket(auth, options);
        if (!ticket) {
          this.recordAuthReject(client, 'invalid_entry_ticket', { lobbyId: this.lobbyId });
          throw new Error('Valid game entry ticket required');
        }
      } else {
        const consumed = await consumeReplayNonce('game_entry', ticket.nonce, ticket.expiresAt);
        if (!consumed) {
          this.recordAuthReject(client, 'entry_ticket_nonce_replay', { lobbyId: this.lobbyId });
          throw new Error('Game entry ticket already used');
        }
        if (auth.userId !== ticket.userId) {
          this.recordAuthReject(client, 'entry_ticket_user_mismatch', {
            lobbyId: this.lobbyId,
            authUserId: auth.userId,
            ticketUserId: ticket.userId,
          });
          throw new Error('Game entry ticket does not match authenticated user');
        }
        this.rememberReconnectParticipant(ticket);
      }
    }

    try {
      await assertGameplayAccountEligible(auth.userId);
    } catch (error) {
      if (error instanceof AccountRestrictedError) {
        this.recordAuthReject(client, `account_${error.restriction.actionType}`, {
          userId: auth.userId,
          expiresAt: error.restriction.expiresAt?.toISOString() ?? null,
        });
      }
      throw error;
    }

    this.recordClientJoinHints(client, auth, options);
    return { auth, ticket };
  }

  private rememberReconnectParticipant(ticket: GameEntryTicketClaims): void {
    this.reconnectParticipants.set(ticket.userId, {
      userId: ticket.userId,
      lobbyPlayerId: ticket.lobbyPlayerId,
      displayName: ticket.displayName,
      assignedTeam: ticket.assignedTeam,
      selectedHero: ticket.selectedHero,
      observer: ticket.observer === true,
    });
  }

  private canAcceptRunningGameReconnect(): boolean {
    if (!this.lobbyId || this.matchCancelled) return false;
    return this.state?.phase !== 'game_end';
  }

  private createRunningGameReconnectTicket(
    auth: RoomAuthContext,
    options: JoinOptions
  ): GameEntryTicketClaims | null {
    if (options.reconnectToRunningGame !== true || !this.canAcceptRunningGameReconnect()) return null;

    const participant = this.reconnectParticipants.get(auth.userId);
    if (!participant || !this.lobbyId) return null;

    const now = Date.now();
    return {
      version: 1,
      lobbyId: this.lobbyId,
      gameRoomId: this.roomId,
      lobbyPlayerId: participant.lobbyPlayerId,
      userId: participant.userId,
      displayName: participant.displayName,
      assignedTeam: participant.assignedTeam,
      selectedHero: participant.selectedHero,
      observer: participant.observer ? true : undefined,
      issuedAt: now,
      expiresAt: now + 60_000,
      nonce: `reconnect:${participant.userId}:${now}`,
    };
  }

  private syncReconnectParticipantFromPlayer(player: Player): void {
    const userId = this.playerAuthContexts.get(player.id)?.userId ?? this.playerEntryTickets.get(player.id)?.userId;
    if (!userId) return;

    const participant = this.reconnectParticipants.get(userId);
    if (!participant) return;

    participant.displayName = player.name || participant.displayName;
    participant.assignedTeam = player.team as Team;
    participant.selectedHero = isHeroId(player.heroId) ? player.heroId : participant.selectedHero;
    participant.observer = false;
  }

  onCreate(options: CreateOptions) {
    this.eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
    this.eventLoopDelay.enable();
    this.lobbyId = options.lobbyId || null;
    this.lobbyName = options.lobbyName || null;
    this.matchMode = options.matchMode ?? options.wagerContext?.matchMode ?? (options.wagerContext ? 'custom_wager' : 'custom');
    this.wagerContext = options.wagerContext || null;
    this.rankedEligibilityCandidate = options.rankedEligible === true;
    this.requiredHumanPlayers = Math.max(
      0,
      Math.floor(options.requiredHumanPlayers ?? (this.lobbyId ? DEFAULT_GAME_CONFIG.maxPlayers : 1))
    );
    this.rankedRequiredHumanPlayers = this.requiredHumanPlayers;
    this.reservedHumanPlayers = Math.max(0, Math.floor(options.reservedHumanPlayers ?? this.requiredHumanPlayers));
    this.maxClients = this.config.maxPlayers + Math.max(0, Math.floor(options.observerCount ?? 0));
    this.antiCheat = new AntiCheatRoomRuntime({
      roomId: this.roomId,
      lobbyId: this.lobbyId,
      matchMode: this.matchMode,
      getMatchId: () => this.matchPersistenceLedger?.matchId ?? null,
      getServerTick: () => this.state?.tick ?? 0,
      getServerTime: () => this.state?.serverTime || Date.now(),
      evidenceStore: this.antiCheatEvidenceStore,
    });
    if (this.lobbyId) {
      assertUsableEntryTicketSecret();
    }
    loggers.room.info('Game room created', this.roomId, 'from lobby', this.lobbyId || 'direct');

    // Initialize state
    this.setState(new GameState());
    this.state.roomId = this.roomId;
    this.state.config = this.config;
    this.state.mapSeed = typeof options.mapSeed === 'number'
      ? options.mapSeed >>> 0
      : createRandomSeed();
    this.state.mapThemeId = options.mapThemeId ?? getVoxelMapTheme(this.state.mapSeed).id;
    this.refreshMapManifest();
    loggers.room.info('Map seed', this.state.mapSeed);
    this.resetFlags();
    this.createBotsFromAssignments(options.botAssignments || []);
    this.updateMetadata();
    this.startMatchStartCancelTimer();

    // Set up tick loop
    this.tickInterval = setInterval(() => this.tick(), TICK_INTERVAL_MS);

    // Handle messages
    this.onMessage('movementCommands', (client, packet: MovementCommandPacket) => {
      if (!this.rateLimiter.consume(client.sessionId, 'movementCommands', GAME_MESSAGE_RATE_LIMITS.movementCommands)) {
        this.recordRateLimitDrop(client.sessionId, 'movementCommands');
        return;
      }
      this.handleMovementCommandPacket(client, packet);
    });

    this.onMessage('blazeBombDrop', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'blazeBombDrop', GAME_MESSAGE_RATE_LIMITS.blazeBombDrop)) {
        this.recordRateLimitDrop(client.sessionId, 'blazeBombDrop');
        return;
      }
      this.handleBlazeBombDrop(client, data);
    });

    this.onMessage('selectHero', (client, data: unknown) => {
      try {
        if (!this.rateLimiter.consume(client.sessionId, 'selectHero', GAME_MESSAGE_RATE_LIMITS.selection)) {
          this.recordRateLimitDrop(client.sessionId, 'selectHero');
          return;
        }
        const heroId = validateHeroPayload(data);
        if (!heroId) return;
        this.handleHeroSelect(client, heroId);
      } catch (error) {
        loggers.room.error('Failed to apply hero selection:', error);
        client.send('devCommandError', { message: 'Failed to switch hero' });
      }
    });

    this.onMessage('selectTeam', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'selectTeam', GAME_MESSAGE_RATE_LIMITS.selection)) {
        this.recordRateLimitDrop(client.sessionId, 'selectTeam');
        return;
      }
      const team = validateTeamPayload(data);
      if (!team) return;
      this.handleTeamSelect(client, team);
    });

    this.onMessage('ready', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'ready', GAME_MESSAGE_RATE_LIMITS.selection)) {
        this.recordRateLimitDrop(client.sessionId, 'ready');
        return;
      }
      const ready = validateReadyPayload(data);
      if (ready === null) return;
      this.handleReady(client, ready);
    });

    this.onMessage('matchSceneReady', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'matchSceneReady', GAME_MESSAGE_RATE_LIMITS.matchSceneReady)) {
        this.recordRateLimitDrop(client.sessionId, 'matchSceneReady');
        return;
      }
      this.handleMatchSceneReady(client, data);
    });

    this.onMessage('chat', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'chat', GAME_MESSAGE_RATE_LIMITS.chat)) {
        this.recordRateLimitDrop(client.sessionId, 'chat');
        return;
      }
      const chat = validateChatPayload(data, { teamOnly: true });
      if (!chat) return;
      this.handleChat(client, chat.message, chat.teamOnly);
    });

    this.onMessage('playerReport', (client, data: unknown) => {
      const requestId = this.readReportRequestId(data);
      if (!this.rateLimiter.consume(client.sessionId, 'playerReport', GAME_MESSAGE_RATE_LIMITS.playerReport)) {
        this.recordRateLimitDrop(client.sessionId, 'playerReport');
        this.sendPlayerReportResult(client, requestId, {
          ok: false,
          error: 'Please wait before sending another report',
        });
        return;
      }
      void this.handlePlayerReport(client, data);
    });

    this.onMessage('requestVoiceToken', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'requestVoiceToken', GAME_MESSAGE_RATE_LIMITS.voiceToken)) {
        this.recordRateLimitDrop(client.sessionId, 'requestVoiceToken');
        return;
      }
      void this.handleVoiceTokenRequest(client, data);
    });

    this.onMessage('playerPingResponse', (client, data: unknown) => {
      if (!this.rateLimiter.consume(client.sessionId, 'playerPingResponse', GAME_MESSAGE_RATE_LIMITS.playerPingResponse)) {
        this.recordRateLimitDrop(client.sessionId, 'playerPingResponse');
        return;
      }
      this.handlePlayerPingResponse(client, data);
    });

    if (this.isDevelopmentMode()) {
      this.onMessage('devSetHero', (client, data: unknown) => {
        try {
          if (!this.rateLimiter.consume(client.sessionId, 'devSetHero', GAME_MESSAGE_RATE_LIMITS.devCommand)) {
            this.recordRateLimitDrop(client.sessionId, 'devSetHero');
            return;
          }
          const heroId = validateHeroPayload(data);
          if (!heroId) return;
          this.handleDevSetHero(client, heroId);
        } catch (error) {
          loggers.room.error('Failed to apply dev hero switch:', error);
          client.send('devCommandError', { message: 'Failed to switch hero' });
        }
      });

      // Development-only entity helpers. Production bots are lobby participants.
      this.onMessage('spawnNpc', (client, data: unknown) => {
        if (!this.rateLimiter.consume(client.sessionId, 'spawnNpc', GAME_MESSAGE_RATE_LIMITS.devCommand)) {
          this.recordRateLimitDrop(client.sessionId, 'spawnNpc');
          return;
        }
        if (!isRecord(data) || !isHeroId(data.heroId)) return;
        const team = data.team === undefined ? undefined : isTeam(data.team) ? data.team : null;
        const position = data.position === undefined ? undefined : validateVec3(data.position);
        const name = data.name === undefined ? undefined : sanitizeShortText(data.name, 24) ?? undefined;
        if (team === null || (data.position !== undefined && !position)) return;
        this.handleSpawnNpc(client, { heroId: data.heroId, team, position: position ?? undefined, name });
      });

      this.onMessage('damageNpc', (client, data: unknown) => {
        if (!this.rateLimiter.consume(client.sessionId, 'damageNpc', GAME_MESSAGE_RATE_LIMITS.devCommand)) {
          this.recordRateLimitDrop(client.sessionId, 'damageNpc');
          return;
        }
        if (!isRecord(data) || typeof data.damage !== 'number' || !Number.isFinite(data.damage)) return;
        const npcId = sanitizeShortText(data.npcId, 96);
        if (!npcId) return;
        this.handleDamageNpc(client, { npcId, damage: Math.max(0, Math.min(1000, data.damage)) });
      });

      this.onMessage('killNpc', (client, data: unknown) => {
        if (!this.rateLimiter.consume(client.sessionId, 'killNpc', GAME_MESSAGE_RATE_LIMITS.devCommand)) {
          this.recordRateLimitDrop(client.sessionId, 'killNpc');
          return;
        }
        const npcId = validateBotIdPayload(data, 'npcId');
        if (!npcId) return;
        this.handleKillNpc(client, { npcId });
      });

      this.onMessage('killAllNpcs', (client) => {
        if (!this.rateLimiter.consume(client.sessionId, 'killAllNpcs', GAME_MESSAGE_RATE_LIMITS.devCommand)) {
          this.recordRateLimitDrop(client.sessionId, 'killAllNpcs');
          return;
        }
        this.handleKillAllNpcs(client);
      });

      this.onMessage('setDevImmune', (client, data: unknown) => {
        if (!this.rateLimiter.consume(client.sessionId, 'setDevImmune', GAME_MESSAGE_RATE_LIMITS.devCommand)) {
          this.recordRateLimitDrop(client.sessionId, 'setDevImmune');
          return;
        }
        this.handleSetDevImmune(client, isRecord(data) && data.enabled === true);
      });

      this.onMessage('devFillUltimate', (client) => {
        if (!this.rateLimiter.consume(client.sessionId, 'devFillUltimate', GAME_MESSAGE_RATE_LIMITS.devCommand)) {
          this.recordRateLimitDrop(client.sessionId, 'devFillUltimate');
          return;
        }
        this.handleDevFillUltimate(client);
      });

      this.onMessage('devEndGame', (client) => {
        if (!this.rateLimiter.consume(client.sessionId, 'devEndGame', GAME_MESSAGE_RATE_LIMITS.devCommand)) {
          this.recordRateLimitDrop(client.sessionId, 'devEndGame');
          return;
        }
        this.handleDevEndGame(client);
      });

      this.onMessage('devSetObserver', (client) => {
        if (!this.rateLimiter.consume(client.sessionId, 'devSetObserver', GAME_MESSAGE_RATE_LIMITS.devCommand)) {
          this.recordRateLimitDrop(client.sessionId, 'devSetObserver');
          return;
        }
        this.handleDevSetObserver(client);
      });

      this.onMessage('setDevTimeFrozen', (client, data: unknown) => {
        if (!this.rateLimiter.consume(client.sessionId, 'setDevTimeFrozen', GAME_MESSAGE_RATE_LIMITS.devCommand)) {
          this.recordRateLimitDrop(client.sessionId, 'setDevTimeFrozen');
          return;
        }
        this.handleSetDevTimeFrozen(client, isRecord(data) && data.enabled === true);
      });

      this.onMessage('setDevBotsRooted', (client, data: unknown) => {
        if (!this.rateLimiter.consume(client.sessionId, 'setDevBotsRooted', GAME_MESSAGE_RATE_LIMITS.devCommand)) {
          this.recordRateLimitDrop(client.sessionId, 'setDevBotsRooted');
          return;
        }
        this.handleSetDevBotsRooted(client, isRecord(data) && data.enabled === true);
      });

      this.onMessage('setDevBotBrainEnabled', (client, data: unknown) => {
        if (!this.rateLimiter.consume(client.sessionId, 'setDevBotBrainEnabled', GAME_MESSAGE_RATE_LIMITS.devCommand)) {
          this.recordRateLimitDrop(client.sessionId, 'setDevBotBrainEnabled');
          return;
        }
        this.handleSetDevBotBrainEnabled(client, isRecord(data) && data.enabled === true);
      });

      this.onMessage('devAddBot', (client, data: unknown) => {
        if (!this.rateLimiter.consume(client.sessionId, 'devAddBot', GAME_MESSAGE_RATE_LIMITS.devCommand)) {
          this.recordRateLimitDrop(client.sessionId, 'devAddBot');
          return;
        }
        if (!isRecord(data) || !isHeroId(data.heroId) || !isTeam(data.team)) return;
        this.handleDevAddBot(client, { heroId: data.heroId, team: data.team });
      });

      this.onMessage('devBotSkill', (client, data: unknown) => {
        if (!this.rateLimiter.consume(client.sessionId, 'devBotSkill', GAME_MESSAGE_RATE_LIMITS.devCommand)) {
          this.recordRateLimitDrop(client.sessionId, 'devBotSkill');
          return;
        }
        if (!isRecord(data) || !isHeroId(data.heroId) || !isTeam(data.team)) return;
        const skillKey = sanitizeShortText(data.skillKey, 24);
        if (!skillKey) return;
        this.handleDevBotSkill(client, { heroId: data.heroId, team: data.team, skillKey });
      });

      this.onMessage('devBotLook', (client, data: unknown) => {
        if (!this.rateLimiter.consume(client.sessionId, 'devBotLook', GAME_MESSAGE_RATE_LIMITS.devCommand)) {
          this.recordRateLimitDrop(client.sessionId, 'devBotLook');
          return;
        }
        if (!isRecord(data) || !isHeroId(data.heroId) || !isTeam(data.team)) return;
        const direction = sanitizeShortText(data.direction, 12);
        if (!direction) return;
        this.handleDevBotLook(client, { heroId: data.heroId, team: data.team, direction });
      });

    }
  }

  onJoin(client: Client, options: JoinOptions) {
    if (this.matchCancelled) {
      client.send('matchCancelled', this.buildMatchCancelledPayload(
        this.matchCancelNotice ?? this.createStartTimeoutCancelNotice()
      ));
      client.leave();
      return;
    }

    const authBundle = (client as Client & { auth?: { auth?: RoomAuthContext; ticket?: GameEntryTicketClaims | null } }).auth;
    const authContext = authBundle?.auth;
    if (!authContext) {
      client.send('error', { message: 'Authentication required' });
      client.leave();
      return;
    }
    const entryTicket = authBundle?.ticket ?? null;
    const joinsAsObserver = entryTicket?.observer === true;

    if (entryTicket) {
      this.playerEntryTickets.set(client.sessionId, entryTicket);
    }
    this.playerAuthContexts.set(client.sessionId, authContext);

    // Handle reconnect/duplicate tabs by authenticated user or signed lobby ticket identity.
    const identityKey = authContext.userId;
    if (identityKey) {
      const existingSessionId = this.identityToSessionId.get(identityKey);
      
      if (existingSessionId && existingSessionId !== client.sessionId) {
        loggers.room.info('Duplicate session detected, kicking old session', existingSessionId);
        this.recordSecurityEvent({
          type: 'auth_duplicate_session',
          playerId: client.sessionId,
          userId: authContext.userId,
          movementEpoch: this.getMovementAuthority(client.sessionId).movementEpoch,
          reason: 'duplicate_identity',
          detail: { previousSessionId: existingSessionId },
        });
        
        // Find and disconnect the old client
        const oldClient = this.clients.find(c => c.sessionId === existingSessionId);
        if (oldClient) {
          // Send a message to the old client before kicking
          oldClient.send('duplicateSession', { reason: 'Connected from another tab/window' });
          oldClient.leave(4000); // Custom code for duplicate session
        }
        
        // Clean up old session data (onLeave will also be called, but let's be safe)
        const oldPlayer = this.state.players.get(existingSessionId);
        void this.removeVoiceParticipantForPlayer(existingSessionId, this.normalizeVoiceTeam(oldPlayer?.team), 'duplicate_session');
        if (oldPlayer) {
          this.markMatchParticipantLeft(oldPlayer);
        }
        if (oldPlayer?.hasFlag) {
          this.dropFlag(oldPlayer);
        }
        this.state.players.delete(existingSessionId);
        this.clearCombatPlayerRuntimeState(existingSessionId);
        this.observerClientIds.delete(existingSessionId);
        this.sessionIdToIdentity.delete(existingSessionId);
        this.clientsBySessionId.delete(existingSessionId);
        this.playerAuthContexts.delete(existingSessionId);
        this.playerEntryTickets.delete(existingSessionId);
        this.rateLimiter.clearScope(existingSessionId);
        this.clearPlayerReplicationState(existingSessionId);
        this.resetCountdownStartGate();
        
        // Broadcast that old player left
        this.broadcastTracked('playerLeft', { playerId: existingSessionId });
      }
      
      // Register this durable identity mapping for duplicate-tab handling.
      this.identityToSessionId.set(identityKey, client.sessionId);
      this.sessionIdToIdentity.set(client.sessionId, identityKey);
    }

    if (!joinsAsObserver && this.state.players.size >= this.config.maxPlayers) {
      client.send('error', { message: 'Game room is full' });
      this.playerAuthContexts.delete(client.sessionId);
      this.playerEntryTickets.delete(client.sessionId);
      if (this.identityToSessionId.get(identityKey) === client.sessionId) {
        this.identityToSessionId.delete(identityKey);
      }
      this.sessionIdToIdentity.delete(client.sessionId);
      client.leave();
      return;
    }

    if (joinsAsObserver) {
      this.clientsBySessionId.set(client.sessionId, client);
      this.observerClientIds.add(client.sessionId);
      this.playerPingsDirty = true;
      this.updateMetadata();
      this.state.players.forEach((existingPlayer) => {
        this.sendPlayerJoinedSnapshot(client, existingPlayer, null);
      });
      this.sendCurrentSnapshots(client);
      this.requestPlayerPing(client, Date.now());
      loggers.room.info('Observer join complete', {
        sessionId: client.sessionId,
        totalObservers: this.observerClientIds.size,
      });
      this.checkPhaseTransition();
      return;
    }

    // Initialize ability press state tracking
    this.initializePressState(client.sessionId);

    // Create player
    const player = new Player();
    player.id = client.sessionId;
    player.name = entryTicket?.displayName || authContext.displayName || `Player${this.state.players.size + 1}`;
    player.team = entryTicket?.assignedTeam || this.assignTeam(isTeam(options.preferredTeam) ? options.preferredTeam : undefined);
    player.state = 'selecting';
    player.isBot = false;
    player.botDifficulty = '';
    player.botProfileId = '';
    this.applyPlayerRank(player, toPublicRankSnapshot(authContext.rank));

    // Set lobby spawn position without consuming a movement authority epoch.
    this.assignPlayerSpawnPosition(player);
    if (entryTicket?.selectedHero && isHeroId(entryTicket.selectedHero)) {
      this.setPlayerHero(player, entryTicket.selectedHero);
    }
    if ((this.state.phase === 'countdown' || this.state.phase === 'playing') && player.heroId) {
      player.state = 'alive';
      this.placePlayerAtSpawn(player, 'respawn');
    }
    this.syncReconnectParticipantFromPlayer(player);

    // Send existing players to the new client with recipient-scoped position data.
    this.state.players.forEach((existingPlayer) => {
      this.sendPlayerJoinedSnapshot(client, existingPlayer, player);
    });

    this.state.players.set(client.sessionId, player);
    this.clientsBySessionId.set(client.sessionId, client);
    this.knownPlayerIds.add(client.sessionId);
    this.resetCountdownStartGate();
    this.playerPingsDirty = true;
    this.forceTransformFullSync();
    this.updateMetadata();
    this.updateLastSafeMovement(player, 0);
    if (this.state.phase === 'playing') {
      this.ensureMatchPersistenceLedger();
    }
    this.registerMatchParticipant(player);

    // Broadcast join to all clients (including the new one) with recipient-scoped position data.
    for (const joinedClient of this.clients) {
      const recipient = this.state.players.get(joinedClient.sessionId) ?? null;
      this.sendPlayerJoinedSnapshot(joinedClient, player, recipient);
    }

    loggers.room.info('Player join complete', {
      sessionId: client.sessionId,
      totalPlayers: this.state.players.size,
    });

    this.sendCurrentSnapshots(client);
    this.requestPlayerPing(client, Date.now());

    // Check if we should start hero select
    this.checkPhaseTransition();
  }

  onLeave(client: Client, consented: boolean) {
    loggers.room.info('Player left', client.sessionId, 'consented', consented);

    const player = this.state.players.get(client.sessionId);
    if (!player && this.observerClientIds.has(client.sessionId)) {
      this.observerClientIds.delete(client.sessionId);
      this.clientsBySessionId.delete(client.sessionId);
      this.clearPlayerReplicationState(client.sessionId);
      this.playerAuthContexts.delete(client.sessionId);
      this.playerEntryTickets.delete(client.sessionId);
      this.rateLimiter.clearScope(client.sessionId);
      this.countdownSceneReadyPlayerIds.delete(client.sessionId);
      this.playerPingsDirty = true;

      const identity = this.sessionIdToIdentity.get(client.sessionId);
      if (identity) {
        if (this.identityToSessionId.get(identity) === client.sessionId) {
          this.identityToSessionId.delete(identity);
        }
        this.sessionIdToIdentity.delete(client.sessionId);
      }

      this.updateMetadata();
      return;
    }

    void this.removeVoiceParticipantForPlayer(client.sessionId, this.normalizeVoiceTeam(player?.team), consented ? 'leave' : 'disconnect');
    
    // Handle flag drop if carrying
    if (player?.hasFlag) {
      this.dropFlag(player);
    }
    if (player) {
      this.markMatchParticipantLeft(player);
    }

    this.state.players.delete(client.sessionId);
    this.clientsBySessionId.delete(client.sessionId);
    this.clearPlayerReplicationState(client.sessionId);
    this.clearCombatPlayerRuntimeState(client.sessionId);
    this.playerAuthContexts.delete(client.sessionId);
    this.playerEntryTickets.delete(client.sessionId);
    this.rateLimiter.clearScope(client.sessionId);
    this.updateMetadata();
    this.resetCountdownStartGate();
    
    // Clean up auth identity mappings.
    const identity = this.sessionIdToIdentity.get(client.sessionId);
    if (identity) {
      if (this.identityToSessionId.get(identity) === client.sessionId) {
        this.identityToSessionId.delete(identity);
      }
      this.sessionIdToIdentity.delete(client.sessionId);
    }

    this.broadcastTracked('playerLeft', {
      playerId: client.sessionId,
    });
    this.broadcastStateStreams({ transforms: false, forceVitals: true, forceMatch: true });

    // Check if game should end
    this.checkPhaseTransition();
  }

  private clearCombatPlayerRuntimeState(playerId: string): void {
    playerPressState.delete(playerId);
    this.phantomPrimaryMagazines.delete(playerId);
    this.phantomPrimaryHoldStartedAt.delete(playerId);
    this.chronosPrimaryHoldStartedAt.delete(playerId);
    this.phantomVoidRayChargeStartedAt.delete(playerId);
    this.phantomVoidRayResolvedForPress.delete(playerId);
    this.phantomPrimaryLaunchSide.delete(playerId);
    this.hookshotPrimaryLaunchSide.delete(playerId);
    this.devBotSkillOverrides.delete(playerId);
    this.devBotLookOverrides.delete(playerId);
    this.hookshotGrapples.delete(playerId);
    this.clearHookshotDragPullsInvolving(playerId);
    this.playerRootedUntil.delete(playerId);
    this.blazeBombDropConsumedForHold.delete(playerId);
    this.blazeFlamethrowerActivePlayers.delete(playerId);
    this.blazeBurnEffects.delete(playerId);
    for (const [targetId, burn] of this.blazeBurnEffects) {
      if (burn.sourceId === playerId) {
        this.blazeBurnEffects.delete(targetId);
      }
    }
    this.clearFlamethrowerDamageTicksForPlayer(playerId);
    this.movementAuthorities.delete(playerId);
    this.chronosAegisShieldHp.delete(playerId);
    this.attackCooldownUntil.delete(`${playerId}:primary`);
    this.attackCooldownUntil.delete(`${playerId}:secondary`);
    this.devImmunePlayers.delete(playerId);
    this.countdownSceneReadyPlayerIds.delete(playerId);
  }

  private clearFlamethrowerDamageTicksForPlayer(playerId: string): void {
    for (const key of this.flamethrowerLastDamageTick.keys()) {
      if (key.startsWith(`${playerId}:`) || key.endsWith(`:${playerId}`)) {
        this.flamethrowerLastDamageTick.delete(key);
      }
    }
  }

  onDispose() {
    loggers.room.info('Room disposing', this.roomId);
    this.clearMatchStartCancelTimer();
    this.clearMatchCancelDisconnectTimer();
    this.eventLoopDelay?.disable();
    this.clearScheduledTimeouts();
    this.antiCheat?.flushAggregates();
    void this.antiCheatEvidenceStore.flush();
    this.state.players.forEach((player, playerId) => {
      if (!player.isBot) {
        void this.removeVoiceParticipantForPlayer(playerId, this.normalizeVoiceTeam(player.team), 'room_dispose');
      }
    });
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.flamethrowerLastDamageTick.clear();
    this.settleWagerNoContest('room_dispose');
  }

  private startMatchStartCancelTimer(): void {
    this.clearMatchStartCancelTimer();
    this.matchStartDeadlineAt = Date.now() + MATCH_START_CANCEL_TIMEOUT_MS;
    this.matchStartCancelTimeout = setTimeout(() => {
      this.cancelPreMatch('start_timeout');
    }, MATCH_START_CANCEL_TIMEOUT_MS);
    this.matchStartCancelTimeout.unref?.();
  }

  private clearMatchStartCancelTimer(): void {
    if (!this.matchStartCancelTimeout) return;
    clearTimeout(this.matchStartCancelTimeout);
    this.matchStartCancelTimeout = null;
  }

  private clearMatchCancelDisconnectTimer(): void {
    if (!this.matchCancelDisconnectTimeout) return;
    clearTimeout(this.matchCancelDisconnectTimeout);
    this.matchCancelDisconnectTimeout = null;
  }

  private scheduleRoomTimeout(callback: () => void, delayMs: number): void {
    let timeout: ReturnType<typeof setTimeout>;
    timeout = setTimeout(() => {
      this.scheduledTimeouts.delete(timeout);
      callback();
    }, delayMs);
    this.scheduledTimeouts.add(timeout);
    timeout.unref?.();
  }

  private clearScheduledTimeouts(): void {
    for (const timeout of this.scheduledTimeouts) {
      clearTimeout(timeout);
    }
    this.scheduledTimeouts.clear();
  }

  private createStartTimeoutCancelNotice(): PreMatchCancelNotice {
    return {
      reason: 'start_timeout',
      message: 'Match canceled because all players did not connect and load in time.',
    };
  }

  private buildMatchCancelledPayload(notice: PreMatchCancelNotice): Record<string, unknown> {
    return {
      reason: notice.reason,
      message: notice.message,
      roomId: this.roomId,
      requiredHumanPlayers: this.requiredHumanPlayers,
      connectedHumanPlayers: this.getConnectedHumanPlayerCount(),
      deadlineAt: this.matchStartDeadlineAt,
      refundedWager: Boolean(this.wagerContext),
      serverTime: Date.now(),
      blockedPlayerId: notice.blockedPlayerId,
      blockedPlayerName: notice.blockedPlayerName,
      networkQuality: notice.networkQuality,
    };
  }

  private cancelPreMatch(reason: PreMatchCancelReason, details: Omit<PreMatchCancelNotice, 'reason'> | null = null): void {
    if (
      this.matchCancelled
      || (this.state.phase !== 'waiting' && this.state.phase !== 'hero_select' && this.state.phase !== 'countdown')
    ) {
      return;
    }

    this.matchCancelled = true;
    const fallbackDetails = details ?? { message: this.createStartTimeoutCancelNotice().message };
    this.matchCancelNotice = {
      reason,
      ...fallbackDetails,
    };
    this.clearMatchStartCancelTimer();
    this.resetCountdownStartGate();
    const connectedHumanPlayers = this.getConnectedHumanPlayerCount();

    loggers.room.warn('Pre-match canceled', {
      roomId: this.roomId,
      lobbyId: this.lobbyId,
      reason,
      message: this.matchCancelNotice.message,
      requiredHumanPlayers: this.requiredHumanPlayers,
      connectedHumanPlayers,
      deadlineAt: this.matchStartDeadlineAt,
      wageredLobbyId: this.wagerContext?.wageredLobbyId,
      blockedPlayerId: this.matchCancelNotice.blockedPlayerId,
      networkQuality: this.matchCancelNotice.networkQuality,
    });

    this.broadcastTracked('matchCancelled', this.buildMatchCancelledPayload(this.matchCancelNotice));

    this.settleWagerNoContest(reason);
    this.matchCancelDisconnectTimeout = setTimeout(() => {
      this.disconnect();
    }, MATCH_CANCEL_DISCONNECT_DELAY_MS);
    this.matchCancelDisconnectTimeout.unref?.();
  }

  private tick() {
    const tickStartedAt = performance.now();
    try {
      this.state.tick++;
      this.state.serverTime = Date.now();
      const dt = TICK_INTERVAL_MS / 1000;
      this.rebuildPlayerSpatialIndex();
      this.updateBots(this.state.serverTime, dt);

      // Update based on phase
      switch (this.state.phase) {
        case 'hero_select':
          if (this.state.serverTime - this.lastLowFrequencyStateAt >= LOW_FREQUENCY_STATE_INTERVAL_MS) {
            this.lastLowFrequencyStateAt = this.state.serverTime;
            this.broadcastStateStreams({ transforms: false });
          }
          break;
        case 'countdown':
          this.updateCountdown();
          this.updatePhysics();
          this.broadcastStateStreams({ transforms: true });
          break;
        case 'playing':
          this.updatePlaying();
          break;
        case 'round_end':
          this.updateRoundEnd();
          if (this.state.serverTime - this.lastLowFrequencyStateAt >= LOW_FREQUENCY_STATE_INTERVAL_MS) {
            this.lastLowFrequencyStateAt = this.state.serverTime;
            this.broadcastStateStreams({ transforms: false });
          }
          break;
      }
    } finally {
      this.recordTickDuration(performance.now() - tickStartedAt);
    }
  }

  private rebuildPlayerSpatialIndex(): void {
    this.playerSpatialIndex.rebuild(this.state.players.values());
    this.alivePlayers = this.playerSpatialIndex.getAlivePlayers();
    this.alivePlayersByTeam = this.playerSpatialIndex.getAlivePlayersByTeam();
  }

  private getEnemyPlayers(team: Team): Player[] {
    return this.playerSpatialIndex.getEnemyPlayers(team);
  }

  private updateCountdown() {
    if (this.state.phaseEndTime && Date.now() >= this.state.phaseEndTime) {
      this.startPlaying();
    }
  }

  private updatePlaying() {
    const now = Date.now();
    const dt = TICK_INTERVAL_MS / 1000;

    // Update round timer
    if (this.state.roundStartTime && !this.devGameClockFrozen) {
      this.state.roundTimeRemaining = this.getRoundTimeRemaining(now);

      if (this.state.roundTimeRemaining <= 0) {
        this.endRound();
      }
    }

    // Update each player
    this.state.players.forEach(player => {
      // Handle respawns
      if (player.state === 'dead') {
        if (!Number.isFinite(player.respawnTime) || player.respawnTime <= 0) {
          player.respawnTime = now + this.config.respawnTimeSeconds * 1000;
        }
        if (now >= player.respawnTime) {
          this.respawnPlayer(player);
        }
        return;
      }

      if (player.state !== 'alive') return;

      const tempoMultiplier = this.getChronosTimebreakTempoMultiplier(player);

      // Update ability cooldowns
      updateAbilityCooldowns(player, dt, tempoMultiplier);
      this.updateTimeScaledSkillTimers(player, dt, tempoMultiplier, now);

      // Passive ultimate charge
      if (player.ultimateCharge < 100) {
        player.ultimateCharge = Math.min(
          100,
          player.ultimateCharge + ULTIMATE_CHARGE_PER_SECOND * dt * tempoMultiplier
        );
      }

      // Process active abilities (like Phantom Veil)
      updateActiveAbilities(player, now);
      this.syncChronosAscendantMovementState(player, now);
    });
    this.updateChronosAegisShields(dt);
    this.cleanupExpiredPlayerRoots(now);

    // Update void zones (damage enemies inside)
    this.updateVoidZones(now);

    this.updatePendingAreaDamage(now);
    this.updateBlazeGearstorms(now);
    this.cleanupDamageWindows(now);

    // Update held Blaze flamethrowers
    this.updateBlazeFlamethrowers(now, dt);
    this.updateBlazeBurns(now);

    // Update physics simulation (simplified)
    this.updatePhysics();

    // Update CTF objective interactions after movement.
    this.updateCTFObjectives(now);

    this.broadcastStateStreams();
  }

  // Ability cooldown and active ability updates are now in abilityHandlers.ts

  private quantize(value: number, scale: number): number {
    return Math.round(value * scale);
  }

  private getMovementBits(player: Player): number {
    let bits = 0;
    if (player.movement.isGrounded) bits |= MOVEMENT_BIT_GROUNDED;
    if (player.movement.isSprinting) bits |= MOVEMENT_BIT_SPRINTING;
    if (player.movement.isCrouching) bits |= MOVEMENT_BIT_CROUCHING;
    if (player.movement.isSliding) bits |= MOVEMENT_BIT_SLIDING;
    if (player.movement.isWallRunning) bits |= MOVEMENT_BIT_WALL_RUNNING;
    if (player.movement.isGrappling) bits |= MOVEMENT_BIT_GRAPPLING;
    if (player.movement.isJetpacking) bits |= MOVEMENT_BIT_JETPACKING;
    if (player.movement.isGliding) bits |= MOVEMENT_BIT_GLIDING;
    if (this.isChronosAegisActive(player)) bits |= MOVEMENT_BIT_CHRONOS_AEGIS;
    return bits;
  }

  private getPlayerNetId(playerId: string): number {
    let netId = this.playerNetIds.get(playerId);
    if (netId === undefined) {
      netId = this.nextPlayerNetId++;
      this.playerNetIds.set(playerId, netId);
      this.forceTransformFullSync();
    }
    return netId;
  }

  private forceTransformFullSync(): void {
    this.transformStreamEpoch++;
    this.playerTransformSignatures.clear();
    this.playerTransformHeartbeatAt.clear();
    this.transformRecipientStates.clear();
  }

  private clearPlayerReplicationState(playerId: string): void {
    this.knownPlayerIds.delete(playerId);
    this.playerVitalRecipientStates.delete(playerId);
    for (const state of this.playerVitalRecipientStates.values()) {
      state.signatures.delete(playerId);
      state.reconcileAt.delete(playerId);
      state.knownPlayerIds.delete(playerId);
    }
    this.playerInterestSignatures.delete(playerId);
    for (const signatures of this.playerInterestSignatures.values()) {
      signatures.delete(playerId);
    }
    this.playerTransformSignatures.delete(playerId);
    this.playerTransformHeartbeatAt.delete(playerId);
    this.transformRecipientStates.delete(playerId);
    for (const state of this.transformRecipientStates.values()) {
      state.signatures.delete(playerId);
      state.heartbeatAt.delete(playerId);
    }
    this.recentCombatTransformUntil.delete(playerId);
    this.visibilityInterest.clearPlayer(playerId);
    for (const key of Array.from(this.recentCombatInterestUntil.keys())) {
      if (key.startsWith(`${playerId}:`) || key.endsWith(`:${playerId}`)) {
        this.recentCombatInterestUntil.delete(key);
      }
    }
    this.playerNetIds.delete(playerId);
    this.playerPingMs.delete(playerId);
    this.pendingPlayerPings.delete(playerId);
    this.playerNetworkQuality.delete(playerId);
    this.playerPingsDirty = true;
    this.forceTransformFullSync();
  }

  private getVitalsReplicationState(recipientId: string): PlayerVitalsReplicationState {
    let state = this.playerVitalRecipientStates.get(recipientId);
    if (!state) {
      state = {
        signatures: new Map<string, PlayerVitalsSnapshot>(),
        reconcileAt: new Map<string, number>(),
        knownPlayerIds: new Set<string>(),
      };
      this.playerVitalRecipientStates.set(recipientId, state);
    }
    return state;
  }

  private getInterestSignatureState(recipientId: string): Map<string, string> {
    let state = this.playerInterestSignatures.get(recipientId);
    if (!state) {
      state = new Map<string, string>();
      this.playerInterestSignatures.set(recipientId, state);
    }
    return state;
  }

  private getRecentCombatInterestKey(recipientId: string, targetId: string): string {
    return `${recipientId}:${targetId}`;
  }

  private markRecentCombatInterest(sourceId: string, targetId: string, now: number): void {
    const until = now + RECENT_COMBAT_INTEREST_MS;
    this.recentCombatInterestUntil.set(this.getRecentCombatInterestKey(sourceId, targetId), until);
    this.recentCombatInterestUntil.set(this.getRecentCombatInterestKey(targetId, sourceId), until);
  }

  private static getVisibilityEyePosition(player: VisibilityInterestPlayer): PlainVec3 {
    return getSharedPlayerEyePosition(player.position);
  }

  private static getVisibilityLineOfSightPoints(player: VisibilityInterestPlayer): readonly PlainVec3[] {
    return getSharedPlayerLineOfSightSamplePoints(player);
  }

  private prepareVisibilityContext(
    context: VisibilityInterestContext,
    now: number,
    collisionRevision = this.getMovementCollisionRevision(now)
  ): VisibilityInterestContext {
    context.now = now;
    context.collisionRevision = collisionRevision;
    return context;
  }

  private getVisibilityInterestPlayer(player: Player): VisibilityInterestPlayer {
    return {
      id: player.id,
      team: player.team,
      state: player.state,
      position: player.position,
      heroId: player.heroId,
      abilities: player.abilities.values(),
    };
  }

  private buildReplicationFrameContext(now = this.state.serverTime || Date.now()): ReplicationFrameContext {
    const frameContext = this.replicationFrameContext;
    const collisionRevision = this.getMovementCollisionRevision(now);
    frameContext.now = now;
    this.prepareVisibilityContext(frameContext.visibilityContext, now, collisionRevision);
    frameContext.currentIds.clear();
    frameContext.visibilityPlayers.clear();
    frameContext.packedTransforms.clear();
    frameContext.packedTransformSignatures.clear();
    frameContext.fullVitalsByPlayer.clear();
    frameContext.visibleEnemyVitalsByPlayer.clear();
    frameContext.publicEnemyVitalsByPlayer.clear();
    for (const targetInterests of frameContext.recipientInterests.values()) {
      targetInterests.clear();
    }

    this.state.players.forEach((player, id) => {
      frameContext.currentIds.add(id);
      frameContext.visibilityPlayers.set(id, player);
      if (player.state !== 'alive' && player.state !== 'spawning') return;

      const transform = this.buildPackedPlayerTransform(id, player);
      frameContext.packedTransforms.set(id, transform);
      frameContext.packedTransformSignatures.set(id, this.getPackedTransformSignature(transform));
    });

    for (const recipientId of frameContext.recipientInterests.keys()) {
      if (!frameContext.currentIds.has(recipientId)) {
        frameContext.recipientInterests.delete(recipientId);
      }
    }

    return frameContext;
  }

  private getRecipientInterest(
    recipient: Player | null,
    target: Player,
    now = this.state.serverTime || Date.now(),
    frameContext?: ReplicationFrameContext
  ): RecipientInterestDecision {
    if (recipient && frameContext) {
      let targetInterests = frameContext.recipientInterests.get(recipient.id);
      if (!targetInterests) {
        targetInterests = new Map<string, RecipientInterestDecision>();
        frameContext.recipientInterests.set(recipient.id, targetInterests);
      } else {
        const cached = targetInterests.get(target.id);
        if (cached) return cached;
      }

      const decision = this.computeRecipientInterest(recipient, target, now, frameContext);
      targetInterests.set(target.id, decision);
      return decision;
    }

    return this.computeRecipientInterest(recipient, target, now, frameContext);
  }

  private computeRecipientInterest(
    recipient: Player | null,
    target: Player,
    now = this.state.serverTime || Date.now(),
    frameContext?: ReplicationFrameContext
  ): RecipientInterestDecision {
    const recipientInterestPlayer = recipient
      ? frameContext?.visibilityPlayers.get(recipient.id) ?? this.getVisibilityInterestPlayer(recipient)
      : null;
    const targetInterestPlayer = frameContext?.visibilityPlayers.get(target.id) ?? this.getVisibilityInterestPlayer(target);
    const visibilityContext = frameContext?.visibilityContext
      ?? this.prepareVisibilityContext(this.standaloneVisibilityContext, now);

    return this.visibilityInterest.getRecipientInterest(
      recipientInterestPlayer,
      targetInterestPlayer,
      visibilityContext
    );
  }

  private shouldSendExactEnemyState(
    recipient: Player | null,
    targetId: string,
    target: Player,
    now: number,
    interest?: RecipientInterestDecision
  ): boolean {
    if (!recipient) return true;
    if (recipient.id === targetId) return true;
    if (recipient.team === target.team) return true;
    return (interest ?? this.getRecipientInterest(recipient, target, now)).state === 'visible';
  }

  private getPackedTransformSignature(transform: PackedPlayerTransform): PackedPlayerTransform {
    return transform;
  }

  private havePackedTransformsChanged(
    previous: PackedPlayerTransform | undefined,
    next: PackedPlayerTransform
  ): boolean {
    if (!previous) return true;
    for (let index = 0; index < next.length; index++) {
      if (previous[index] !== next[index]) return true;
    }
    return false;
  }

  private isVisibleAbilityActive(player: Player): boolean {
    for (const ability of player.abilities.values()) {
      if (ability.isActive) return true;
    }
    return false;
  }

  private shouldSendFullRateTransform(id: string, player: Player, now: number): boolean {
    return (
      player.hasFlag ||
      this.isChronosAegisActive(player) ||
      (this.recentCombatTransformUntil.get(id) ?? 0) > now ||
      this.isVisibleAbilityActive(player)
    );
  }

  private getTransformReplicationState(recipientId: string): TransformReplicationState {
    let state = this.transformRecipientStates.get(recipientId);
    if (!state) {
      state = {
        signatures: new Map<string, PackedPlayerTransform>(),
        heartbeatAt: new Map<string, number>(),
      };
      this.transformRecipientStates.set(recipientId, state);
    }
    return state;
  }

  private isHighRelevanceTransform(
    recipient: Player | null,
    targetId: string,
    target: Player,
    now: number
  ): boolean {
    if (this.shouldSendFullRateTransform(targetId, target, now)) return true;
    if (!recipient) return true;
    if (recipient.id === targetId) return true;

    const dx = recipient.position.x - target.position.x;
    const dz = recipient.position.z - target.position.z;
    return dx * dx + dz * dz <= TRANSFORM_HIGH_RELEVANCE_DISTANCE_SQ;
  }

  private getAbilityCooldownUntil(ability: AbilityStateSchema, now: number): number {
    if (ability.cooldownRemaining <= 0) return 0;
    return Math.round((now + ability.cooldownRemaining * 1000) / 100) * 100;
  }

  private buildPackedPlayerTransform(id: string, player: Player): PackedPlayerTransform {
    return [
      this.getPlayerNetId(id),
      this.quantize(player.position.x, TRANSFORM_POSITION_SCALE),
      this.quantize(player.position.y, TRANSFORM_POSITION_SCALE),
      this.quantize(player.position.z, TRANSFORM_POSITION_SCALE),
      this.quantize(player.velocity.x, TRANSFORM_VELOCITY_SCALE),
      this.quantize(player.velocity.y, TRANSFORM_VELOCITY_SCALE),
      this.quantize(player.velocity.z, TRANSFORM_VELOCITY_SCALE),
      this.quantize(player.lookYaw, TRANSFORM_ANGLE_SCALE),
      this.quantize(player.lookPitch, TRANSFORM_ANGLE_SCALE),
      this.getMovementBits(player),
      player.movement.wallRunSide === 'left' ? -1 : player.movement.wallRunSide === 'right' ? 1 : 0,
      this.getMovementAuthority(id).movementEpoch,
      this.getChronosAegisShieldByte(player),
    ];
  }

  private applyPlayerRank(
    player: Player,
    rank: ReturnType<typeof toPublicRankSnapshot>
  ): void {
    player.rankTier = rank.tier;
    player.rankTierLabel = rank.tierLabel;
    player.rankDivision = rank.division ?? 0;
    player.rankDivisionIndex = rank.divisionIndex ?? -1;
    player.rankLabel = rank.label;
    player.rankIconKey = rank.iconKey;
    player.rankIsRanked = rank.isRanked;
    player.rankPlacementRemaining = rank.placementRemaining;
  }

  private getPlayerRankPayload(player: Player): ReturnType<typeof toPublicRankSnapshot> {
    return {
      tier: player.rankTier as ReturnType<typeof toPublicRankSnapshot>['tier'],
      tierLabel: player.rankTierLabel,
      division: player.rankDivision > 0 ? player.rankDivision : null,
      divisionIndex: player.rankDivisionIndex >= 0 ? player.rankDivisionIndex : null,
      label: player.rankLabel,
      iconKey: player.rankIconKey,
      isRanked: player.rankIsRanked,
      placementRemaining: player.rankPlacementRemaining,
    };
  }

  private getDefaultPublicMovementVitals(): PlayerVitalsSnapshot['movement'] {
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
      jetpackFuel: 0,
      isGliding: false,
    };
  }

  private getBlazeBurnUntil(playerId: string): number | null {
    const burn = this.blazeBurnEffects.get(playerId);
    if (!burn || burn.ticksRemaining <= 0) return null;
    return burn.nextTickAt + Math.max(0, burn.ticksRemaining - 1) * BLAZE_FLAMETHROWER_BURN_INTERVAL_MS;
  }

  private buildPlayerVitals(
    id: string,
    player: Player,
    visibility: PlayerVisibilityState = 'visible'
  ): PlayerVitalsSnapshot {
    const now = this.state.serverTime || Date.now();
    const abilities: Record<string, PlayerVitalsAbilitySnapshot> = {};
    player.abilities.forEach((ability, abilityId) => {
      abilities[abilityId] = {
        abilityId: ability.abilityId,
        cooldownUntil: this.getAbilityCooldownUntil(ability, now),
        charges: ability.charges,
        isActive: ability.isActive,
        activatedAt: ability.activatedAt,
      };
    });

    return {
      id,
      netId: this.getPlayerNetId(id),
      name: player.name,
      team: player.team as Team,
      heroId: (player.heroId || null) as HeroId | null,
      state: player.state as PlayerVitalsSnapshot['state'],
      isReady: player.isReady,
      isBot: player.isBot,
      botDifficulty: player.botDifficulty ? normalizeBotDifficulty(player.botDifficulty) : undefined,
      botProfileId: player.botProfileId || undefined,
      rank: this.getPlayerRankPayload(player),
      health: player.health,
      maxHealth: player.maxHealth,
      ultimateCharge: player.ultimateCharge,
      onFireUntil: this.getBlazeBurnUntil(id),
      hasFlag: player.hasFlag,
      movement: {
        isGrounded: player.movement.isGrounded,
        isSprinting: player.movement.isSprinting,
        isCrouching: player.movement.isCrouching,
        isSliding: player.movement.isSliding,
        slideTimeRemaining: player.movement.slideTimeRemaining,
        isWallRunning: player.movement.isWallRunning,
        wallRunSide: player.movement.wallRunSide === 'left' || player.movement.wallRunSide === 'right'
          ? player.movement.wallRunSide
          : null,
        isGrappling: player.movement.isGrappling,
        grapplePoint: null,
        isJetpacking: player.movement.isJetpacking,
        jetpackFuel: player.movement.jetpackFuel,
        isGliding: player.movement.isGliding,
        chronosAscendantStartY: player.movement.chronosAscendantStartY || undefined,
      },
      abilities,
      stats: {
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        flagCaptures: player.flagCaptures,
        flagReturns: player.flagReturns,
      },
      respawnTime: player.respawnTime || null,
      spawnProtectionUntil: player.spawnProtectionUntil || null,
      visibility,
    };
  }

  private buildVisibleEnemyVitals(
    id: string,
    player: Player,
    visibility: PlayerVisibilityState
  ): PlayerVitalsSnapshot {
    const full = this.buildPlayerVitals(id, player, visibility);
    const activeAbilities: Record<string, PlayerVitalsAbilitySnapshot> = {};
    for (const [abilityId, ability] of Object.entries(full.abilities)) {
      if (!ability.isActive) continue;
      activeAbilities[abilityId] = {
        abilityId: ability.abilityId,
        cooldownUntil: 0,
        charges: 0,
        isActive: true,
        activatedAt: ability.activatedAt,
      };
    }

    return {
      ...full,
      ultimateCharge: 0,
      abilities: activeAbilities,
      respawnTime: null,
      spawnProtectionUntil: null,
    };
  }

  private buildPublicEnemyVitals(
    id: string,
    player: Player,
    visibility: PlayerVisibilityState
  ): PlayerVitalsSnapshot {
    const publicState: PlayerVitalsSnapshot['state'] = player.state === 'dead' ? 'dead' : 'alive';
    return {
      id,
      netId: this.getPlayerNetId(id),
      name: player.name,
      team: player.team as Team,
      heroId: (player.heroId || null) as HeroId | null,
      state: publicState,
      isReady: player.isReady,
      isBot: player.isBot,
      botDifficulty: player.botDifficulty ? normalizeBotDifficulty(player.botDifficulty) : undefined,
      botProfileId: player.botProfileId || undefined,
      rank: this.getPlayerRankPayload(player),
      health: player.maxHealth,
      maxHealth: player.maxHealth,
      ultimateCharge: 0,
      onFireUntil: null,
      hasFlag: false,
      movement: this.getDefaultPublicMovementVitals(),
      abilities: {},
      stats: {
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        flagCaptures: player.flagCaptures,
        flagReturns: player.flagReturns,
      },
      respawnTime: null,
      spawnProtectionUntil: null,
      visibility,
    };
  }

  private buildPlayerVitalsForRecipient(
    id: string,
    player: Player,
    recipient: Player | null,
    now = this.state.serverTime || Date.now(),
    interest?: RecipientInterestDecision,
    frameContext?: ReplicationFrameContext
  ): PlayerVitalsSnapshot {
    if (!recipient || recipient.id === id || recipient.team === player.team) {
      const cached = frameContext?.fullVitalsByPlayer.get(id);
      if (cached) return cached;
      const vitals = this.buildPlayerVitals(id, player, 'visible');
      frameContext?.fullVitalsByPlayer.set(id, vitals);
      return vitals;
    }

    const decision = interest ?? this.getRecipientInterest(recipient, player, now, frameContext);
    if (decision.state === 'visible') {
      const cached = frameContext?.visibleEnemyVitalsByPlayer.get(id);
      if (cached) return cached;
      const vitals = this.buildVisibleEnemyVitals(id, player, decision.state);
      frameContext?.visibleEnemyVitalsByPlayer.set(id, vitals);
      return vitals;
    }

    const publicCacheKey = `${id}:${decision.state}`;
    const cached = frameContext?.publicEnemyVitalsByPlayer.get(publicCacheKey);
    if (cached) return cached;
    const vitals = this.buildPublicEnemyVitals(id, player, decision.state);
    frameContext?.publicEnemyVitalsByPlayer.set(publicCacheKey, vitals);
    return vitals;
  }

  private haveVitalsChanged(previous: PlayerVitalsSnapshot | undefined, next: PlayerVitalsSnapshot): boolean {
    if (!previous) return true;

    return (
      previous.name !== next.name ||
      previous.netId !== next.netId ||
      previous.team !== next.team ||
      previous.heroId !== next.heroId ||
      previous.state !== next.state ||
      previous.isReady !== next.isReady ||
      previous.isBot !== next.isBot ||
      previous.botDifficulty !== next.botDifficulty ||
      previous.botProfileId !== next.botProfileId ||
      previous.visibility !== next.visibility ||
      previous.health !== next.health ||
      previous.maxHealth !== next.maxHealth ||
      Math.round(previous.ultimateCharge) !== Math.round(next.ultimateCharge) ||
      previous.onFireUntil !== next.onFireUntil ||
      previous.hasFlag !== next.hasFlag ||
      (next.state !== 'alive' && this.haveMovementVitalsChanged(previous.movement, next.movement)) ||
      this.haveAbilityVitalsChanged(previous.abilities, next.abilities) ||
      this.haveStatVitalsChanged(previous.stats, next.stats) ||
      previous.respawnTime !== next.respawnTime ||
      previous.spawnProtectionUntil !== next.spawnProtectionUntil
    );
  }

  private haveMovementVitalsChanged(
    previous: PlayerVitalsSnapshot['movement'],
    next: PlayerVitalsSnapshot['movement']
  ): boolean {
    return (
      previous.isGrounded !== next.isGrounded ||
      previous.isSprinting !== next.isSprinting ||
      previous.isCrouching !== next.isCrouching ||
      previous.isSliding !== next.isSliding ||
      previous.slideTimeRemaining !== next.slideTimeRemaining ||
      previous.isWallRunning !== next.isWallRunning ||
      previous.wallRunSide !== next.wallRunSide ||
      previous.isGrappling !== next.isGrappling ||
      previous.isJetpacking !== next.isJetpacking ||
      previous.jetpackFuel !== next.jetpackFuel ||
      previous.isGliding !== next.isGliding
    );
  }

  private haveAbilityVitalsChanged(
    previous: PlayerVitalsSnapshot['abilities'],
    next: PlayerVitalsSnapshot['abilities']
  ): boolean {
    const previousKeys = Object.keys(previous);
    const nextKeys = Object.keys(next);
    if (previousKeys.length !== nextKeys.length) return true;

    for (const abilityId of nextKeys) {
      const previousAbility = previous[abilityId];
      const nextAbility = next[abilityId];
      if (!previousAbility || !nextAbility) return true;
      if (
        previousAbility.abilityId !== nextAbility.abilityId ||
        previousAbility.cooldownUntil !== nextAbility.cooldownUntil ||
        previousAbility.charges !== nextAbility.charges ||
        previousAbility.isActive !== nextAbility.isActive ||
        previousAbility.activatedAt !== nextAbility.activatedAt
      ) {
        return true;
      }
    }

    return false;
  }

  private haveStatVitalsChanged(
    previous: PlayerVitalsSnapshot['stats'],
    next: PlayerVitalsSnapshot['stats']
  ): boolean {
    return (
      previous.kills !== next.kills ||
      previous.deaths !== next.deaths ||
      previous.assists !== next.assists ||
      previous.flagCaptures !== next.flagCaptures ||
      previous.flagReturns !== next.flagReturns
    );
  }

  private buildMatchSnapshot(): MatchSnapshotMessage {
    return {
      tick: this.state.tick,
      serverTime: this.state.serverTime,
      phase: this.state.phase as MatchSnapshotMessage['phase'],
      mapSeed: this.state.mapSeed,
      mapThemeId: this.state.mapThemeId as VoxelMapTheme['id'],
      redScore: this.state.redTeam.score,
      blueScore: this.state.blueTeam.score,
      redFlag: this.getFlagSync('red'),
      blueFlag: this.getFlagSync('blue'),
      roundTimeRemaining: this.state.roundTimeRemaining,
      phaseEndTime: this.state.phaseEndTime || null,
      gameClockFrozen: this.devGameClockFrozen,
    };
  }

  private getMatchSnapshotSignature(snapshot: MatchSnapshotMessage): string {
    return [
      snapshot.phase,
      snapshot.mapSeed,
      snapshot.redScore,
      snapshot.blueScore,
      snapshot.phaseEndTime ?? 0,
      snapshot.gameClockFrozen ? 1 : 0,
      snapshot.redFlag.carrierId ?? '',
      snapshot.redFlag.isAtBase ? 1 : 0,
      Math.round(snapshot.redFlag.position.x * TRANSFORM_POSITION_SCALE),
      Math.round(snapshot.redFlag.position.y * TRANSFORM_POSITION_SCALE),
      Math.round(snapshot.redFlag.position.z * TRANSFORM_POSITION_SCALE),
      snapshot.blueFlag.carrierId ?? '',
      snapshot.blueFlag.isAtBase ? 1 : 0,
      Math.round(snapshot.blueFlag.position.x * TRANSFORM_POSITION_SCALE),
      Math.round(snapshot.blueFlag.position.y * TRANSFORM_POSITION_SCALE),
      Math.round(snapshot.blueFlag.position.z * TRANSFORM_POSITION_SCALE),
    ].join(':');
  }

  private buildPlayerMatchStats(player: Player): MatchSummaryPlayer['stats'] {
    return {
      kills: player.kills,
      deaths: player.deaths,
      assists: player.assists,
      flagCaptures: player.flagCaptures,
      flagReturns: player.flagReturns,
    };
  }

  private buildMatchSummaryPlayers(winningTeam: Team | null): MatchSummaryPlayer[] {
    const players: MatchSummaryPlayer[] = [];

    this.state.players.forEach((player, playerId) => {
      if (this.spawnedNpcs.has(playerId)) return;

      const team = isTeam(player.team) ? player.team : 'red';
      const heroId = isHeroId(player.heroId) ? player.heroId : null;
      const outcome: MatchOutcome = getMatchOutcome(team, winningTeam);
      const stats = this.buildPlayerMatchStats(player);
      const score = calculateParticipantScore(stats);
      const isExperienceEligible = !player.isBot;

      players.push({
        playerId,
        userId: this.getDurableUserId(playerId),
        playerName: player.name,
        team,
        heroId,
        isBot: player.isBot,
        outcome,
        stats,
        score,
        experienceGained: isExperienceEligible
          ? calculateParticipantExperience(stats, outcome)
          : 0,
        rank: this.getPlayerRankPayload(player),
      });
    });

    return players.sort((a, b) => {
      if (a.team !== b.team) return a.team === 'red' ? -1 : 1;
      return b.score - a.score || b.stats.kills - a.stats.kills || a.playerName.localeCompare(b.playerName);
    });
  }

  private buildGameEndEvent(
    finalScore: { red: number; blue: number },
    winningTeam: Team | null,
    endedAt: number,
    forcedByPlayerId?: string
  ): GameEndEvent {
    const startedAt = this.matchPersistenceLedger?.startedAt.getTime()
      ?? (this.state.roundStartTime || endedAt);

    const event: GameEndEvent = {
      matchMode: this.matchMode,
      winningTeam,
      finalScore,
      matchId: this.matchPersistenceLedger?.matchId ?? null,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      forcedByPlayerId,
      players: this.buildMatchSummaryPlayers(winningTeam),
    };
    const gate = this.antiCheat?.buildIntegrityGate({
      rankedEligible: this.matchPersistenceLedger?.rankedEligible === true,
      wagered: Boolean(this.wagerContext),
    });
    if (gate && gate.reviewRequired) {
      event.matchIntegrity = {
        status: gate.status,
        reviewRequired: gate.rankedHoldRequired || gate.payoutHoldRequired,
        rankedOutcome: gate.rankedHoldRequired ? 'review_required' : 'normal',
        wagerOutcome: gate.payoutHoldRequired ? 'review_required' : 'normal',
        message: gate.rankedHoldRequired || gate.payoutHoldRequired
          ? 'Match rewards are pending integrity review.'
          : 'Match integrity telemetry has been recorded.',
      };
    }
    this.attachRankedSummaryUpdates(event, winningTeam, new Date(endedAt), forcedByPlayerId);
    if (this.state.mapThemeId === GOLDEN_VOXEL_MAP_THEME_ID && this.matchMode === 'ranked') {
      event.goldenBiomeReward = {
        rewardUsdCents: wagerService.getConfig().goldenBiomeWinnerRewardUsdCents,
        rewardToken: 'SOL',
        winningTeam,
        eligiblePlayerIds: winningTeam
          ? event.players
            .filter((player) => !player.isBot && player.team === winningTeam)
            .map((player) => player.playerId)
          : [],
        status: winningTeam ? 'pending' : 'not_applicable',
      };
    }
    return event;
  }

  private getRankedUserState(userId: string): RankedUserState | null {
    for (const authContext of this.playerAuthContexts.values()) {
      if (authContext.userId !== userId) continue;
      return {
        id: userId,
        competitiveRating: authContext.competitiveRating,
        rankedGames: authContext.rankedGames,
        rankedWins: authContext.rankPayload.rankedWins,
        rankedLosses: authContext.rankPayload.rankedLosses,
        rankedDraws: authContext.rankPayload.rankedDraws,
        rankedPlacementsRemaining: authContext.rankedPlacementsRemaining,
        rankedPeakRating: authContext.rankPayload.peak.rating,
      };
    }

    return null;
  }

  private attachRankedSummaryUpdates(
    event: GameEndEvent,
    winningTeam: Team | null,
    endedAt: Date,
    forcedByPlayerId?: string
  ): void {
    const ledger = this.matchPersistenceLedger;
    if (!ledger || ledger.state !== 'active') return;

    const participants = this.buildMatchParticipantSnapshots(ledger);

    if (!this.isFinalRankedEligible(ledger, participants, forcedByPlayerId)) return;
    const gate = this.antiCheat?.buildIntegrityGate({ rankedEligible: true, wagered: Boolean(this.wagerContext) });
    if (gate?.rankedHoldRequired) return;

    const users = participants
      .map((participant) => this.getRankedUserState(participant.userId))
      .filter((user): user is RankedUserState => user !== null);
    if (users.length !== participants.length) return;

    const updates = calculateRankedRatingUpdates({
      participants: event.players
        .filter((player) => !player.isBot && player.userId)
        .map((player) => ({
          userId: player.userId!,
          team: player.team,
          outcome: player.outcome,
          score: player.score,
          kills: player.stats.kills,
          deaths: player.stats.deaths,
          assists: player.stats.assists,
          flagCaptures: player.stats.flagCaptures,
          flagReturns: player.stats.flagReturns,
          leftAt: participants.find((participant) => participant.userId === player.userId)?.leftAt ?? null,
        })),
      users,
      winningTeam,
      endedAt,
    });
    const updatesByUserId = new Map(updates.map((update) => [update.userId, update]));
    const usersById = new Map(users.map((user) => [user.id, user]));

    for (const player of event.players) {
      if (!player.userId) continue;
      const update = updatesByUserId.get(player.userId);
      const user = usersById.get(player.userId);
      if (!update || !user) continue;

      player.ratingDelta = update.ratingDelta;
      player.rankBefore = toPublicRankSnapshot(getRankFromRating(update.ratingBefore, user.rankedGames));
      player.rankAfter = toPublicRankSnapshot(getRankFromRating(update.ratingAfter, update.rankedGamesAfter));
    }
  }

  private getPopulationCounts(): {
    humanCount: number;
    botCount: number;
    observerCount: number;
    npcCount: number;
    participantCount: number;
    entityCount: number;
  } {
    let humanCount = 0;
    let botCount = 0;
    let npcCount = 0;

    this.state.players.forEach((player) => {
      if (this.spawnedNpcs.has(player.id)) {
        npcCount++;
      } else if (player.isBot) {
        botCount++;
      } else {
        humanCount++;
      }
    });

    return {
      humanCount,
      botCount,
      observerCount: this.observerClientIds.size,
      npcCount,
      participantCount: humanCount + botCount,
      entityCount: humanCount + botCount + npcCount,
    };
  }

  private updateMetadata(): void {
    const counts = this.getPopulationCounts();
    const load = this.getRoomLoadSnapshot();
    this.setMetadata({
      name: this.lobbyName || `Game ${this.roomId.slice(0, 6)}`,
      status: this.state.phase,
      phase: this.state.phase,
      lobbyId: this.lobbyId || undefined,
      matchMode: this.matchMode,
      mapSeed: this.state.mapSeed,
      mapThemeId: this.state.mapThemeId,
      humanCount: counts.humanCount,
      botCount: counts.botCount,
      observerCount: counts.observerCount,
      npcCount: counts.npcCount,
      participantCount: counts.participantCount,
      entityCount: counts.entityCount,
      maxPlayers: this.config.maxPlayers,
      reservedHumanPlayers: this.reservedHumanPlayers,
      rankedEligibleCandidate: this.rankedEligibilityCandidate,
      rankedRequiredHumanPlayers: this.rankedRequiredHumanPlayers,
      reconnectIdentityKeys: Array.from(this.reconnectParticipants.keys()),
      wagerEnabled: Boolean(this.wagerContext),
      tickDurationP95Ms: load.tickDurationP95Ms,
      tickDurationP99Ms: load.tickDurationP99Ms,
      eventLoopDelayP95Ms: load.eventLoopDelayP95Ms,
      eventLoopDelayP99Ms: load.eventLoopDelayP99Ms,
      customMessageBytes: load.customMessageBytes,
      customMessageCount: load.customMessageCount,
      interestRecomputeMs: load.interestRecomputeMs,
      interestLosChecks: load.interestLosChecks,
      interestVisibleTargets: load.interestVisibleTargets,
      interestHiddenTargets: load.interestHiddenTargets,
      interestLastKnownTargets: load.interestLastKnownTargets,
      streamTransformsBytes: load.streamTransformsBytes,
      streamVitalsBytes: load.streamVitalsBytes,
      streamFilteredTargets: load.streamFilteredTargets,
      streamHiddenTargetLeakCount: load.streamHiddenTargetLeakCount,
      antiCheatQueueDepth: load.antiCheatQueueDepth,
      antiCheatDroppedLowMediumSignals: load.antiCheatDroppedLowMediumSignals,
      antiCheatDbErrors: load.antiCheatDbErrors,
    });
  }

  getCustomMessageMetricsSnapshot(): Record<string, CustomMessageMetric> {
    const snapshot: Record<string, CustomMessageMetric> = {};
    for (const [type, metric] of this.customMessageMetrics) {
      snapshot[type] = { ...metric };
    }
    return snapshot;
  }

  getInterestMetricsSnapshot(): RoomInterestMetricsSnapshot {
    const interest = this.visibilityInterest.getMetricsSnapshot();
    return {
      ...interest,
      transformBytes: this.customMessageMetrics.get('playerTransformsV2')?.bytes ?? 0,
      vitalsBytes: this.customMessageMetrics.get('playerVitals')?.bytes ?? 0,
    };
  }

  getRoomLoadSnapshot(): RoomLoadSnapshot {
    const tickP50 = this.getTickDurationPercentile(0.5);
    const tickP95 = this.getTickDurationPercentile(0.95);
    const tickP99 = this.getTickDurationPercentile(0.99);
    let customMessageBytes = 0;
    let customMessageCount = 0;
    for (const metric of this.customMessageMetrics.values()) {
      customMessageBytes += metric.bytes;
      customMessageCount += metric.messages;
    }
    const interest = this.visibilityInterest.getMetricsSnapshot();
    const transformMetric = this.customMessageMetrics.get('playerTransformsV2');
    const vitalsMetric = this.customMessageMetrics.get('playerVitals');
    const antiCheatQueue = this.antiCheatEvidenceStore.getQueueHealth();
    return {
      tickDurationP50Ms: tickP50,
      tickDurationP95Ms: tickP95,
      tickDurationP99Ms: tickP99,
      eventLoopDelayP95Ms: this.eventLoopDelay ? this.eventLoopDelay.percentile(95) / 1_000_000 : 0,
      eventLoopDelayP99Ms: this.eventLoopDelay ? this.eventLoopDelay.percentile(99) / 1_000_000 : 0,
      customMessageBytes,
      customMessageCount,
      interestRecomputeMs: interest.recomputeMs,
      interestLosChecks: interest.losChecks,
      interestVisibleTargets: interest.visibleTargets,
      interestHiddenTargets: interest.hiddenTargets,
      interestLastKnownTargets: interest.lastKnownTargets,
      streamTransformsBytes: transformMetric?.bytes ?? 0,
      streamVitalsBytes: vitalsMetric?.bytes ?? 0,
      streamFilteredTargets: interest.filteredTargets,
      streamHiddenTargetLeakCount: interest.hiddenTargetLeakCount,
      antiCheatQueueDepth: antiCheatQueue.depth,
      antiCheatDroppedLowMediumSignals: antiCheatQueue.droppedLowMediumSignals,
      antiCheatDbErrors: antiCheatQueue.dbErrorCount,
    };
  }

  private recordTickDuration(durationMs: number): void {
    this.tickDurationSamplesMs[this.tickDurationSampleIndex] = Math.max(0, durationMs);
    this.tickDurationSampleIndex = (this.tickDurationSampleIndex + 1) % this.tickDurationSamplesMs.length;
    this.tickDurationSampleCount = Math.min(this.tickDurationSamplesMs.length, this.tickDurationSampleCount + 1);
  }

  private getTickDurationPercentile(percentile: number): number {
    if (this.tickDurationSampleCount === 0) return 0;

    const samples: number[] = [];
    for (let index = 0; index < this.tickDurationSampleCount; index++) {
      samples.push(this.tickDurationSamplesMs[index]);
    }
    samples.sort((a, b) => a - b);
    return samples[Math.min(samples.length - 1, Math.floor((samples.length - 1) * percentile))] ?? 0;
  }

  private recordCustomMessage(type: string, payload: unknown, recipients: number): void {
    if (recipients <= 0) return;

    const metric = this.customMessageMetrics.get(type) ?? { messages: 0, recipients: 0, bytes: 0 };
    const bytes = estimateCustomMessageBytes(type, payload);
    metric.messages++;
    metric.recipients += recipients;
    metric.bytes += bytes * recipients;
    this.customMessageMetrics.set(type, metric);
  }

  private sendTracked(client: Client, type: string, payload: unknown): void {
    this.recordCustomMessage(type, payload, 1);
    client.send(type, payload);
  }

  private broadcastTracked(type: string, payload: unknown): void {
    this.recordCustomMessage(type, payload, this.clients.length);
    this.broadcast(type, payload);
  }

  private broadcastAbilityUsed(caster: Player, payload: Record<string, unknown>): void {
    const now = this.state.serverTime || Date.now();
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const interest = recipient ? this.getRecipientInterest(recipient, caster, now) : undefined;
      if (!this.shouldSendExactEnemyState(recipient, caster.id, caster, now, interest)) continue;
      this.sendTracked(client, 'abilityUsed', payload);
    }
  }

  private broadcastExactPlayerEvent(type: string, player: Player, payload: Record<string, unknown>): void {
    const now = this.state.serverTime || Date.now();
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const interest = recipient ? this.getRecipientInterest(recipient, player, now) : undefined;
      if (!this.shouldSendExactEnemyState(recipient, player.id, player, now, interest)) continue;
      this.sendTracked(client, type, payload);
    }
  }

  private broadcastPlayerDamaged(
    target: Player,
    source: Player | null,
    payload: {
      targetId: string;
      damage: number;
      sourceId: string | null;
      damageType: string;
      newHealth: number;
      sourcePosition: PlainVec3 | null;
      targetPosition: PlainVec3;
      sourceHeroId: string | null;
      targetHeroId: string | null;
    }
  ): void {
    const now = this.state.serverTime || Date.now();
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const targetInterest = recipient ? this.getRecipientInterest(recipient, target, now) : undefined;
      const sourceInterest = source && recipient ? this.getRecipientInterest(recipient, source, now) : undefined;
      const canKnowTarget = this.shouldSendExactEnemyState(recipient, target.id, target, now, targetInterest);
      const canKnowSource = source
        ? this.shouldSendExactEnemyState(recipient, source.id, source, now, sourceInterest)
        : true;
      const isParticipant = recipient?.id === target.id || (source && recipient?.id === source.id);

      if (!isParticipant && !canKnowTarget && !canKnowSource) continue;

      this.sendTracked(client, 'playerDamaged', {
        targetId: payload.targetId,
        damage: payload.damage,
        sourceId: payload.sourceId,
        damageType: payload.damageType,
        newHealth: canKnowTarget || isParticipant ? payload.newHealth : undefined,
        sourcePosition: canKnowSource || isParticipant ? payload.sourcePosition : undefined,
        targetPosition: canKnowTarget || isParticipant ? payload.targetPosition : undefined,
        sourceHeroId: canKnowSource || isParticipant ? payload.sourceHeroId : null,
        targetHeroId: canKnowTarget || isParticipant ? payload.targetHeroId : null,
      });
    }
  }

  private broadcastChronosAegisDamaged(
    blocker: Player,
    source: Player | null,
    payload: {
      playerId: string;
      sourceId: string | null;
      damage: number;
      damageType: string;
      shieldHp: number;
      shieldRatio: number;
      position: PlainVec3;
      direction: PlainVec3;
      serverTime: number;
    }
  ): void {
    const now = this.state.serverTime || Date.now();
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const blockerInterest = recipient ? this.getRecipientInterest(recipient, blocker, now) : undefined;
      const sourceInterest = source && recipient ? this.getRecipientInterest(recipient, source, now) : undefined;
      const canKnowBlocker = this.shouldSendExactEnemyState(recipient, blocker.id, blocker, now, blockerInterest);
      const canKnowSource = source
        ? this.shouldSendExactEnemyState(recipient, source.id, source, now, sourceInterest)
        : true;
      const isParticipant = recipient?.id === blocker.id || (source && recipient?.id === source.id);

      if (!isParticipant && !canKnowBlocker) continue;

      this.sendTracked(client, 'chronosAegisDamaged', {
        playerId: payload.playerId,
        sourceId: canKnowSource || isParticipant ? payload.sourceId : null,
        damage: payload.damage,
        damageType: payload.damageType,
        shieldHp: payload.shieldHp,
        shieldRatio: payload.shieldRatio,
        position: payload.position,
        direction: payload.direction,
        serverTime: payload.serverTime,
      });
    }
  }

  private broadcastPhantomShieldBroken(
    target: Player,
    source: Player | null,
    payload: PhantomShieldBrokenEvent
  ): void {
    const now = this.state.serverTime || Date.now();
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const targetInterest = recipient ? this.getRecipientInterest(recipient, target, now) : undefined;
      const canKnowTarget = this.shouldSendExactEnemyState(recipient, target.id, target, now, targetInterest);
      const isParticipant = recipient?.id === target.id || (source && recipient?.id === source.id);

      if (!isParticipant && !canKnowTarget) continue;
      this.sendTracked(client, 'phantomShieldBroken', payload);
    }
  }

  private broadcastPlayerHealed(source: Player, payload: {
    sourceId: string;
    abilityId: string;
    sourcePosition: PlainVec3;
    targets: Array<{
      targetId: string;
      amount: number;
      newHealth: number;
      position: PlainVec3;
    }>;
    timestamp: number;
  }): void {
    const now = this.state.serverTime || Date.now();
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const sourceInterest = recipient ? this.getRecipientInterest(recipient, source, now) : undefined;
      if (!this.shouldSendExactEnemyState(recipient, source.id, source, now, sourceInterest)) continue;

      const visibleTargets = payload.targets.filter((targetPayload) => {
        const target = this.state.players.get(targetPayload.targetId);
        if (!target) return false;
        const targetInterest = recipient ? this.getRecipientInterest(recipient, target, now) : undefined;
        return this.shouldSendExactEnemyState(recipient, target.id, target, now, targetInterest);
      });
      if (visibleTargets.length === 0) continue;

      this.sendTracked(client, 'playerHealed', {
        ...payload,
        targets: visibleTargets,
      });
    }
  }

  private getCoarseEventPosition(position: PlainVec3): PlainVec3 {
    return {
      x: Math.round(position.x / FLAG_CARRIER_APPROX_GRID_METERS) * FLAG_CARRIER_APPROX_GRID_METERS,
      y: Math.round(position.y),
      z: Math.round(position.z / FLAG_CARRIER_APPROX_GRID_METERS) * FLAG_CARRIER_APPROX_GRID_METERS,
    };
  }

  private broadcastPlayerKilled(victim: Player, killer: Player | null, payload: Record<string, unknown>): void {
    const now = this.state.serverTime || Date.now();
    const exactPosition = payload.position as PlainVec3;
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const victimInterest = recipient ? this.getRecipientInterest(recipient, victim, now) : undefined;
      const killerInterest = killer && recipient ? this.getRecipientInterest(recipient, killer, now) : undefined;
      const canKnowVictim = this.shouldSendExactEnemyState(recipient, victim.id, victim, now, victimInterest);
      const canKnowKiller = killer
        ? this.shouldSendExactEnemyState(recipient, killer.id, killer, now, killerInterest)
        : true;
      const isParticipant = recipient?.id === victim.id || (killer && recipient?.id === killer.id);

      if (isParticipant || (canKnowVictim && canKnowKiller)) {
        this.sendTracked(client, 'playerKilled', payload);
        continue;
      }

      this.sendTracked(client, 'playerKilled', {
        ...payload,
        position: canKnowVictim ? payload.position : this.getCoarseEventPosition(exactPosition),
        velocity: canKnowVictim ? payload.velocity : undefined,
        sourcePosition: canKnowKiller ? payload.sourcePosition : undefined,
        sourceDirection: canKnowKiller ? payload.sourceDirection : undefined,
        respawnTime: null,
      });
    }
  }

  private shouldIncludeJoinPosition(recipient: Player | null, target: Player): boolean {
    if (!recipient) return true;
    if (recipient.id === target.id) return true;
    if (recipient.team === target.team) return true;
    return this.state.phase !== 'playing' && this.state.phase !== 'countdown';
  }

  private sendPlayerJoinedSnapshot(client: Client, target: Player, recipient: Player | null): void {
    const payload: {
      playerId: string;
      playerName: string;
      team: string;
      heroId: string;
      isReady: boolean;
      isBot: boolean;
      botDifficulty?: string;
      botProfileId?: string;
      rank: ReturnType<typeof toPublicRankSnapshot>;
      position?: PlainVec3;
    } = {
      playerId: target.id,
      playerName: target.name,
      team: target.team,
      heroId: target.heroId,
      isReady: target.isReady,
      isBot: target.isBot,
      botDifficulty: target.botDifficulty,
      botProfileId: target.botProfileId,
      rank: this.getPlayerRankPayload(target),
    };

    if (this.shouldIncludeJoinPosition(recipient, target)) {
      payload.position = this.vec3SchemaToPlain(target.position);
    }

    this.sendTracked(client, 'playerJoined', payload);
  }

  private sendCurrentSnapshots(client: Client): void {
    const recipient = this.state.players.get(client.sessionId) ?? null;
    const matchSnapshot = this.buildMatchSnapshot();
    this.sendTracked(client, 'matchSnapshot', matchSnapshot);
    this.sendTracked(client, 'playerVitals', {
      tick: this.state.tick,
      serverTime: this.state.serverTime,
      players: Array.from(
        this.state.players,
        ([id, player]) => this.buildPlayerVitalsForRecipient(id, player, recipient)
      ),
    } satisfies PlayerVitalsMessage);
    this.sendTracked(client, 'playerPings', this.buildPlayerPingsMessage(recipient));
    this.sendTracked(client, 'playerInterest', {
      tick: this.state.tick,
      serverTime: this.state.serverTime,
      players: Array.from(this.state.players, ([targetId, target]) => {
        const decision = recipient
          ? this.getRecipientInterest(recipient, target)
          : this.getRecipientInterest(null, target);
        return buildPlayerInterestSnapshot(targetId, decision);
      }),
    } satisfies PlayerInterestMessage);

    const transformPayload = this.buildPlayerTransformsV2Payload({
      force: true,
      recipient,
      recipientId: client.sessionId,
    });
    if (transformPayload.players.length > 0 || transformPayload.hiddenPlayerIds?.length || transformPayload.full) {
      this.sendTracked(client, 'playerTransformsV2', transformPayload);
    }
  }

  private requestPlayerPing(client: Client, now: number): void {
    const nonce = `${this.state.tick}:${++this.pingProbeSequence}:${client.sessionId}`;
    this.pendingPlayerPings.set(client.sessionId, { nonce, sentAt: now });
    this.getPlayerNetworkQualityState(client.sessionId, now);
    this.sendTracked(client, 'playerPingRequest', { nonce } satisfies PlayerPingRequestMessage);
  }

  private handlePlayerPingResponse(client: Client, data: unknown): void {
    if (!isRecord(data) || typeof data.nonce !== 'string') return;

    const pending = this.pendingPlayerPings.get(client.sessionId);
    if (!pending || pending.nonce !== data.nonce) return;

    this.pendingPlayerPings.delete(client.sessionId);
    const pingMs = Math.min(
      MAX_REPORTED_PLAYER_PING_MS,
      Math.max(0, Math.round(Date.now() - pending.sentAt))
    );

    if (this.playerPingMs.get(client.sessionId) !== pingMs) {
      this.playerPingMs.set(client.sessionId, pingMs);
      this.playerPingsDirty = true;
    }
    this.recordPlayerNetworkQualitySample(client.sessionId, {
      at: Date.now(),
      pingMs,
    });
    this.checkCompetitiveNetworkQualityAfterProbe();
  }

  private probePlayerPings(): void {
    const now = this.state.serverTime || Date.now();
    if (now - this.lastPingProbeAt < PLAYER_PING_INTERVAL_MS) return;

    this.lastPingProbeAt = now;

    for (const [playerId, pending] of this.pendingPlayerPings) {
      if (now - pending.sentAt > PLAYER_PING_TIMEOUT_MS) {
        this.pendingPlayerPings.delete(playerId);
        this.recordPlayerNetworkQualitySample(playerId, {
          at: now,
          pingMs: null,
          timedOut: true,
        });
        this.checkCompetitiveNetworkQualityAfterProbe();
      }
    }

    for (const client of this.clients) {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isBot) continue;
      if (this.pendingPlayerPings.has(client.sessionId)) continue;
      this.requestPlayerPing(client, now);
    }
  }

  private getPlayerNetworkQualityState(playerId: string, now = Date.now()): NetworkQualityState {
    let state = this.playerNetworkQuality.get(playerId);
    if (!state) {
      state = createNetworkQualityState(now);
      this.playerNetworkQuality.set(playerId, state);
    }
    return state;
  }

  private recordPlayerNetworkQualitySample(playerId: string, sample: {
    at: number;
    pingMs: number | null;
    timedOut?: boolean;
  }): void {
    const state = this.getPlayerNetworkQualityState(playerId, sample.at);
    recordNetworkQualitySample(state, sample, DEFAULT_COMPETITIVE_NETWORK_QUALITY_GATE);
  }

  private checkCompetitiveNetworkQualityAfterProbe(): void {
    if (
      this.matchCancelled
      || this.state.phase !== 'hero_select'
      || !this.countdownStartGateOpen
      || !this.areAllHumansSceneReadyForCountdown()
    ) {
      return;
    }

    this.checkPhaseTransition();
  }

  private isCompetitiveNetworkQualityGateRequired(): boolean {
    return isNetworkQualityGateRequiredForMatch({
      matchMode: this.matchMode,
      wagered: Boolean(this.wagerContext),
    });
  }

  private evaluateCompetitiveNetworkQualityGate(now = Date.now()): CompetitiveNetworkQualityGateResult {
    if (!this.isCompetitiveNetworkQualityGateRequired()) return { status: 'ready' };

    let pendingEvaluation: PlayerNetworkQualityEvaluation | undefined;
    for (const [playerId, player] of this.state.players) {
      if (player.isBot) continue;

      const evaluation = evaluatePlayerNetworkQuality({
        playerId,
        playerName: player.name,
        state: this.getPlayerNetworkQualityState(playerId, now),
        now,
        config: DEFAULT_COMPETITIVE_NETWORK_QUALITY_GATE,
      });

      if (evaluation.status === 'blocked') {
        return { status: 'blocked', evaluation };
      }
      if (!pendingEvaluation && evaluation.status === 'pending') {
        pendingEvaluation = evaluation;
      }
    }

    return pendingEvaluation
      ? { status: 'pending', evaluation: pendingEvaluation }
      : { status: 'ready' };
  }

  private ensureCompetitiveNetworkQualityForStart(options: { cancelPending?: boolean } = {}): boolean {
    const gate = this.evaluateCompetitiveNetworkQualityGate();
    if (gate.status === 'ready') return true;

    if (gate.status === 'blocked' || options.cancelPending) {
      const evaluation = gate.evaluation;
      this.cancelPreMatch('network_quality', this.buildNetworkQualityCancelNotice(
        evaluation,
        gate.status === 'pending' ? 'network_not_verified' : evaluation?.reason ?? 'network_quality'
      ));
    }

    return false;
  }

  private buildNetworkQualityCancelNotice(
    evaluation: PlayerNetworkQualityEvaluation | undefined,
    fallbackReason: string
  ): Omit<PreMatchCancelNotice, 'reason'> {
    const playerName = evaluation?.playerName || 'A player';
    return {
      message: `Match canceled because ${playerName}'s connection is not stable enough for ranked or wager play.`,
      blockedPlayerId: evaluation?.playerId,
      blockedPlayerName: evaluation?.playerName,
      networkQuality: {
        reason: evaluation?.reason ?? fallbackReason,
        ...(evaluation?.metrics ?? {}),
      },
    };
  }

  private buildPlayerPingsMessage(recipient: Player | null = null): PlayerPingsMessage {
    return {
      serverTime: this.state.serverTime,
      players: Array.from(this.state.players, ([playerId, player]) => ({
        playerId,
        pingMs: player.isBot || (recipient && recipient.id !== playerId && recipient.team !== player.team)
          ? null
          : this.playerPingMs.get(playerId) ?? null,
      })),
    };
  }

  private broadcastPlayerPings(force = false): void {
    if (!force && !this.playerPingsDirty) return;

    this.playerPingsDirty = false;
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      this.sendTracked(client, 'playerPings', this.buildPlayerPingsMessage(recipient));
    }
  }

  private buildPlayerTransformsV2Payload(options: {
    force?: boolean;
    recipient?: Player | null;
    recipientId?: string;
    frameContext?: ReplicationFrameContext;
  } = {}): PlayerTransformsV2Message {
    const players: PackedPlayerTransform[] = [];
    const hiddenPlayerIds: string[] = [];
    const now = options.frameContext?.now ?? (this.state.serverTime || Date.now());
    const force = options.force === true;
    const replicationState = options.recipientId
      ? this.getTransformReplicationState(options.recipientId)
      : null;
    const signatures = replicationState?.signatures ?? this.playerTransformSignatures;
    const heartbeatAt = replicationState?.heartbeatAt ?? this.playerTransformHeartbeatAt;

    this.state.players.forEach((player, id) => {
      if (player.state !== 'alive' && player.state !== 'spawning') return;
      if (!force && options.recipientId && id === options.recipientId) return;
      const interest = options.recipient
        ? this.getRecipientInterest(options.recipient, player, now, options.frameContext)
        : undefined;
      if (!this.shouldSendExactEnemyState(options.recipient ?? null, id, player, now, interest)) {
        const hadTransform = signatures.delete(id);
        heartbeatAt.delete(id);
        if (hadTransform || force) {
          hiddenPlayerIds.push(id);
        }
        return;
      }
      const transform = options.frameContext?.packedTransforms.get(id) ?? this.buildPackedPlayerTransform(id, player);
      const signature = options.frameContext?.packedTransformSignatures.get(id) ?? this.getPackedTransformSignature(transform);
      const previousSignature = signatures.get(id);
      const lastHeartbeatAt = heartbeatAt.get(id) ?? 0;
      const highRelevance = this.isHighRelevanceTransform(options.recipient ?? null, id, player, now);
      const heartbeatInterval = highRelevance
        ? TRANSFORM_HEARTBEAT_INTERVAL_MS
        : DISTANT_TRANSFORM_HEARTBEAT_INTERVAL_MS;
      const heartbeatDue = now - lastHeartbeatAt >= heartbeatInterval;
      const changed = this.havePackedTransformsChanged(previousSignature, signature);

      if (force || (highRelevance && changed) || heartbeatDue) {
        players.push(transform);
        signatures.set(id, signature);
        heartbeatAt.set(id, now);
      }
    });

    return {
      version: 2,
      tick: this.state.tick,
      serverTime: this.state.serverTime,
      streamEpoch: this.transformStreamEpoch,
      full: force,
      players,
      hiddenPlayerIds,
    };
  }

  private broadcastPlayerStateStreams(options: {
    transforms: boolean;
    vitals: boolean;
    forceTransforms?: boolean;
    forceVitals?: boolean;
    frameContext: ReplicationFrameContext;
  }): void {
    const frameContext = options.frameContext;
    const now = frameContext.now;
    const forceVitals = options.forceVitals === true;
    const forceTransforms = options.forceTransforms === true;
    const shouldBroadcastVitals = options.vitals && (forceVitals || now - this.lastVitalsBroadcastAt >= PLAYER_VITALS_INTERVAL_MS);
    const shouldBroadcastInterest = options.vitals && (forceVitals || now - this.lastInterestBroadcastAt >= PLAYER_INTEREST_INTERVAL_MS);
    const shouldBroadcastTransforms = options.transforms;

    if (!shouldBroadcastVitals && !shouldBroadcastInterest && !shouldBroadcastTransforms) return;

    const globallyRemovedPlayerIds: string[] = [];
    if (shouldBroadcastVitals) {
      frameContext.currentIds.forEach((id) => {
        this.knownPlayerIds.add(id);
      });

      this.knownPlayerIds.forEach((id) => {
        if (!frameContext.currentIds.has(id)) {
          globallyRemovedPlayerIds.push(id);
          this.knownPlayerIds.delete(id);
          this.clearPlayerReplicationState(id);
        }
      });
    }

    let sentVitals = false;
    let sentInterest = false;

    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const recipientId = client.sessionId;
      const vitalsState = shouldBroadcastVitals ? this.getVitalsReplicationState(recipientId) : null;
      const vitalsPlayers: PlayerVitalsSnapshot[] = [];
      const removedPlayerIds = shouldBroadcastVitals ? [...globallyRemovedPlayerIds] : [];
      const interestSignatures = shouldBroadcastInterest && recipient
        ? this.getInterestSignatureState(recipientId)
        : null;
      const interestPlayers: ReturnType<typeof buildPlayerInterestSnapshot>[] = [];
      const transformState = shouldBroadcastTransforms ? this.getTransformReplicationState(recipientId) : null;
      const transformPlayers: PackedPlayerTransform[] = [];
      const hiddenPlayerIds: string[] = [];

      this.state.players.forEach((player, id) => {
        let interest: RecipientInterestDecision | undefined;
        let interestResolved = false;
        const getInterest = (): RecipientInterestDecision | undefined => {
          if (!recipient) return undefined;
          if (!interestResolved) {
            interest = this.getRecipientInterest(recipient, player, now, frameContext);
            interestResolved = true;
          }
          return interest;
        };

        if (vitalsState) {
          vitalsState.knownPlayerIds.add(id);
          const vitals = this.buildPlayerVitalsForRecipient(
            id,
            player,
            recipient,
            now,
            recipient && recipient.id !== id && recipient.team !== player.team ? getInterest() : undefined,
            frameContext
          );
          const reconcileDue = now - (vitalsState.reconcileAt.get(id) ?? 0) >= PLAYER_VITALS_RECONCILE_INTERVAL_MS;
          if (forceVitals || reconcileDue || this.haveVitalsChanged(vitalsState.signatures.get(id), vitals)) {
            vitalsState.signatures.set(id, vitals);
            vitalsState.reconcileAt.set(id, now);
            vitalsPlayers.push(vitals);
          }
        }

        if (interestSignatures) {
          const decision = getInterest();
          if (decision) {
            const snapshot = buildPlayerInterestSnapshot(id, decision);
            const signature = getPlayerInterestSignature(snapshot);
            if (forceVitals || interestSignatures.get(id) !== signature) {
              interestSignatures.set(id, signature);
              interestPlayers.push(snapshot);
            }
          }
        }

        if (transformState) {
          if (player.state !== 'alive' && player.state !== 'spawning') return;
          if (!forceTransforms && id === recipientId) return;

          const transformInterest = recipient && recipient.id !== id && recipient.team !== player.team
            ? getInterest()
            : undefined;
          const exactStateVisible = this.shouldSendExactEnemyState(recipient, id, player, now, transformInterest);
          if (!exactStateVisible) {
            const hadTransform = transformState.signatures.delete(id);
            transformState.heartbeatAt.delete(id);
            if (hadTransform || forceTransforms) {
              hiddenPlayerIds.push(id);
            }
            return;
          }

          const transform = frameContext.packedTransforms.get(id) ?? this.buildPackedPlayerTransform(id, player);
          const signature = frameContext.packedTransformSignatures.get(id) ?? this.getPackedTransformSignature(transform);
          const previousSignature = transformState.signatures.get(id);
          const lastHeartbeatAt = transformState.heartbeatAt.get(id) ?? 0;
          const highRelevance = this.isHighRelevanceTransform(recipient, id, player, now);
          const heartbeatInterval = highRelevance
            ? TRANSFORM_HEARTBEAT_INTERVAL_MS
            : DISTANT_TRANSFORM_HEARTBEAT_INTERVAL_MS;
          const heartbeatDue = now - lastHeartbeatAt >= heartbeatInterval;
          const changed = this.havePackedTransformsChanged(previousSignature, signature);

          if (forceTransforms || (highRelevance && changed) || heartbeatDue) {
            transformPlayers.push(transform);
            transformState.signatures.set(id, signature);
            transformState.heartbeatAt.set(id, now);
          }
        }
      });

      if (vitalsState) {
        for (const id of vitalsState.knownPlayerIds) {
          if (!frameContext.currentIds.has(id)) {
            removedPlayerIds.push(id);
            vitalsState.knownPlayerIds.delete(id);
            vitalsState.signatures.delete(id);
            vitalsState.reconcileAt.delete(id);
          }
        }

        if (vitalsPlayers.length > 0 || removedPlayerIds.length > 0 || forceVitals) {
          sentVitals = true;
          this.sendTracked(client, 'playerVitals', {
            tick: this.state.tick,
            serverTime: this.state.serverTime,
            players: vitalsPlayers,
            removedPlayerIds,
          } satisfies PlayerVitalsMessage);
        }
      }

      if (interestSignatures) {
        for (const targetId of interestSignatures.keys()) {
          if (!frameContext.currentIds.has(targetId)) {
            interestSignatures.delete(targetId);
          }
        }

        if (interestPlayers.length > 0 || forceVitals) {
          sentInterest = true;
          this.sendTracked(client, 'playerInterest', {
            tick: this.state.tick,
            serverTime: this.state.serverTime,
            players: interestPlayers,
          } satisfies PlayerInterestMessage);
        }
      }

      if (transformState && (transformPlayers.length > 0 || hiddenPlayerIds.length > 0 || forceTransforms)) {
        this.sendTracked(client, 'playerTransformsV2', {
          version: 2,
          tick: this.state.tick,
          serverTime: this.state.serverTime,
          streamEpoch: this.transformStreamEpoch,
          full: forceTransforms,
          players: transformPlayers,
          hiddenPlayerIds,
        } satisfies PlayerTransformsV2Message);
      }
    }

    if (shouldBroadcastVitals && (sentVitals || forceVitals)) {
      this.lastVitalsBroadcastAt = now;
    }
    if (shouldBroadcastInterest && (sentInterest || forceVitals)) {
      this.lastInterestBroadcastAt = now;
    }
  }

  private broadcastMatchSnapshot(force = false): void {
    const now = this.state.serverTime || Date.now();
    const snapshot = this.buildMatchSnapshot();
    const signature = this.getMatchSnapshotSignature(snapshot);
    const driftSyncDue = now - this.lastMatchSnapshotBroadcastAt >= MATCH_SNAPSHOT_DRIFT_SYNC_INTERVAL_MS;
    if (!force && signature === this.matchSnapshotSignature && !driftSyncDue) return;

    this.lastMatchSnapshotBroadcastAt = now;
    this.matchSnapshotSignature = signature;
    this.broadcastTracked('matchSnapshot', snapshot);
  }

  private broadcastStateStreams(options: { transforms?: boolean; vitals?: boolean; match?: boolean; forceTransforms?: boolean; forceVitals?: boolean; forceMatch?: boolean } = {}): void {
    this.visibilityInterest.resetMetricsWindow();
    this.probePlayerPings();
    this.broadcastPlayerPings();
    const frameContext = this.buildReplicationFrameContext();

    const shouldBroadcastTransforms = options.transforms ?? (this.state.phase === 'playing' || this.state.phase === 'countdown');
    this.broadcastPlayerStateStreams({
      transforms: shouldBroadcastTransforms,
      vitals: options.vitals ?? true,
      forceTransforms: options.forceTransforms,
      forceVitals: options.forceVitals,
      frameContext,
    });

    if (options.match ?? true) {
      this.broadcastMatchSnapshot(options.forceMatch);
    }
  }

  private updateRoundEnd() {
    if (this.state.phaseEndTime && Date.now() >= this.state.phaseEndTime) {
      // Check if game should end
      if (this.state.redTeam.score >= this.config.scoreToWin || 
          this.state.blueTeam.score >= this.config.scoreToWin) {
        this.endGame();
      } else {
        this.startHeroSelect();
      }
    }
  }

  private createMovementAuthorityState(): ServerMovementAuthorityState {
    return {
      pendingCommands: new MovementCommandQueue(MOVEMENT_MAX_SERVER_QUEUE + MOVEMENT_MAX_PACKET_COMMANDS),
      lastProcessedSeq: 0,
      movementEpoch: 0,
      correctionReason: null,
      metrics: {
        commandsReceived: 0,
        commandsProcessed: 0,
        commandsProcessedLastTick: 0,
        queueLength: 0,
        queueLengthBeforeTick: 0,
        queueLengthAfterTick: 0,
        underflowTicks: 0,
        catchupTicks: 0,
        duplicateCommands: 0,
        droppedCommands: 0,
        lateCommands: 0,
        malformedCommands: 0,
        hardCorrections: 0,
        mediumCorrections: 0,
        invalidTransforms: 0,
        speedViolations: 0,
        blockedPathCorrections: 0,
        boundsCorrections: 0,
        objectiveSuppressions: 0,
        abilityRejects: 0,
        rateLimitDrops: 0,
        staleCollisionRevisionDrops: 0,
        lastAckSeq: 0,
        authoritySends: 0,
        lastAckIntervalMs: 0,
      },
      commandWindowStartedAt: Date.now(),
      commandsInWindow: 0,
      lastAuthoritySentAt: 0,
      lastSafe: null,
      objectiveSuppressedUntil: 0,
      shadow: createMovementShadowSimulationState(),
    };
  }

  private getMovementAuthority(playerId: string): ServerMovementAuthorityState {
    const existing = this.movementAuthorities.get(playerId);
    if (existing) return existing;

    const created = this.createMovementAuthorityState();
    this.movementAuthorities.set(playerId, created);
    return created;
  }

  private replacePendingCommands(authority: ServerMovementAuthorityState, commands: MovementCommand[]): void {
    authority.pendingCommands.replace(commands);
  }

  private pushPendingCommand(authority: ServerMovementAuthorityState, command: MovementCommand): void {
    authority.pendingCommands.push(command);
  }

  private removeOldestPendingCommands(authority: ServerMovementAuthorityState, count: number): void {
    if (count <= 0) return;
    authority.pendingCommands.dropOldest(count);
  }

  private getNextMovementCommand(authority: ServerMovementAuthorityState): MovementCommand | null {
    const command = authority.pendingCommands.pop();
    if (command) {
      authority.lastProcessedSeq = command.seq;
      return command;
    }
    return null;
  }

  private getPlayerUserId(playerId: string): string | undefined {
    return this.playerAuthContexts.get(playerId)?.userId;
  }

  private recordAuthReject(client: Client, reason: string, detail: Record<string, unknown> = {}): void {
    this.antiCheat?.record({
      eventType: `auth.${reason}`,
      category: 'auth',
      source: 'game_room_auth',
      userId: this.playerAuthContexts.get(client.sessionId)?.userId ?? null,
      playerSessionId: client.sessionId,
      severity: reason.includes('replay') || reason.includes('direct_join') ? 'critical' : 'high',
      confidence: 0.98,
      reason,
      details: detail,
      retentionClass: 'extended',
    });
  }

  private recordClientJoinHints(client: Client, auth: RoomAuthContext, options: JoinOptions): void {
    if (!getAntiCheatConfig().clientHintsEnabled) return;

    const expectedBuildId = process.env.ANTICHEAT_EXPECTED_CLIENT_BUILD_ID || process.env.CLIENT_BUILD_ID || null;
    const clientBuildId = typeof options.clientBuildId === 'string' && options.clientBuildId.trim()
      ? options.clientBuildId.trim().slice(0, 80)
      : null;
    const movementProtocolVersion = Number.isFinite(options.movementProtocolVersion)
      ? Math.trunc(options.movementProtocolVersion as number)
      : null;

    if (!clientBuildId) {
      this.antiCheat?.record({
        eventType: 'client_hint.build_missing',
        category: 'client_hint',
        source: 'game_room_join',
        userId: auth.userId,
        playerSessionId: client.sessionId,
        severity: 'low',
        confidence: 0.4,
        reason: 'build_missing',
        details: { expectedBuildId },
        retentionClass: 'short',
      });
    } else if (expectedBuildId && clientBuildId !== expectedBuildId) {
      this.antiCheat?.record({
        eventType: 'client_hint.build_mismatch',
        category: 'client_hint',
        source: 'game_room_join',
        userId: auth.userId,
        playerSessionId: client.sessionId,
        severity: 'low',
        confidence: 0.5,
        reason: 'build_mismatch',
        details: { clientBuildId, expectedBuildId },
        retentionClass: 'short',
      });
    }

    if (movementProtocolVersion !== MOVEMENT_PROTOCOL_VERSION) {
      this.antiCheat?.record({
        eventType: 'client_hint.movement_protocol_mismatch',
        category: 'client_hint',
        source: 'game_room_join',
        userId: auth.userId,
        playerSessionId: client.sessionId,
        severity: 'low',
        confidence: 0.5,
        reason: movementProtocolVersion === null ? 'movement_protocol_missing' : 'movement_protocol_mismatch',
        details: {
          movementProtocolVersion,
          expectedMovementProtocolVersion: MOVEMENT_PROTOCOL_VERSION,
        },
        retentionClass: 'short',
      });
    }
  }

  private readReportRequestId(data: unknown): string | null {
    return isRecord(data) ? sanitizeShortText(data.requestId, 96) : null;
  }

  private normalizePlayerReportReason(value: unknown): string {
    const normalized = sanitizeShortText(value, 64)?.toLowerCase().replace(/[^a-z0-9_]+/g, '_') ?? '';
    return PLAYER_REPORT_REASONS.has(normalized) ? normalized : 'cheating';
  }

  private sendPlayerReportResult(
    client: Client,
    requestId: string | null,
    result: { ok: true; reportId: string } | { ok: false; error: string }
  ): void {
    client.send('playerReportResult', {
      requestId,
      ...result,
    });
  }

  private async handlePlayerReport(client: Client, data: unknown): Promise<void> {
    const requestId = this.readReportRequestId(data);
    const fail = (error: string) => this.sendPlayerReportResult(client, requestId, { ok: false, error });

    if (!isRecord(data)) {
      fail('Invalid report payload');
      return;
    }

    const targetPlayerId = sanitizeShortText(data.targetPlayerId, 96);
    if (!targetPlayerId) {
      fail('Target player is required');
      return;
    }
    if (targetPlayerId === client.sessionId) {
      fail('You cannot report yourself');
      return;
    }

    const reporter = this.state.players.get(client.sessionId);
    const target = this.state.players.get(targetPlayerId);
    if (!reporter) {
      fail('Reporter is not in this match');
      return;
    }
    if (!target) {
      fail('Target player is no longer in this match');
      return;
    }
    if (target.isBot || this.spawnedNpcs.has(target.id)) {
      fail('Bots cannot be reported');
      return;
    }

    const targetUserId = this.getDurableUserId(target.id);
    const reporterUserId = this.getDurableUserId(client.sessionId);
    if (!reporterUserId || !targetUserId) {
      fail('Reports require authenticated player accounts');
      return;
    }
    const reason = this.normalizePlayerReportReason(data.reason);
    const details = sanitizeShortText(data.details, 1000);
    const signal = this.antiCheat?.record({
      eventType: 'player_report.cheating',
      category: 'player_report',
      source: 'game_room_player_report',
      userId: targetUserId,
      playerSessionId: target.id,
      team: target.team,
      heroId: target.heroId ?? null,
      severity: 'medium',
      confidence: 0.55,
      reason,
      details: {
        reporterUserId,
        reporterPlayerSessionId: client.sessionId,
        reporterName: reporter.name,
        targetName: target.name,
        targetTeam: target.team,
        details,
      },
      retentionClass: 'extended',
    });

    try {
      const report = await prisma.playerReport.create({
        data: {
          status: 'open',
          reason,
          details,
          reporterUserId,
          reporterPlayerSessionId: client.sessionId,
          reporterName: reporter.name,
          targetUserId,
          targetPlayerSessionId: target.id,
          targetName: target.name,
          targetTeam: target.team,
          roomId: this.roomId,
          matchId: this.matchPersistenceLedger?.matchId ?? null,
          lobbyId: this.lobbyId,
          matchMode: this.matchMode,
          mapSeed: this.state.mapSeed,
          serverTick: this.state.tick,
          evidenceEventId: signal?.eventId ?? null,
          metadata: serializeReportMetadata({
            targetHeroId: target.heroId ?? null,
            reporterTeam: reporter.team,
            targetStats: {
              kills: target.kills,
              deaths: target.deaths,
              assists: target.assists,
              flagCaptures: target.flagCaptures,
              flagReturns: target.flagReturns,
            },
            reporterPosition: {
              x: reporter.position.x,
              y: reporter.position.y,
              z: reporter.position.z,
            },
            targetPosition: {
              x: target.position.x,
              y: target.position.y,
              z: target.position.z,
            },
          }),
        },
      });

      loggers.room.info('Player report created', {
        reportId: report.id,
        reporterUserId,
        targetUserId,
        roomId: this.roomId,
        matchId: this.matchPersistenceLedger?.matchId ?? null,
      });
      this.sendPlayerReportResult(client, requestId, { ok: true, reportId: report.id });
    } catch (error) {
      loggers.room.error('Failed to create player report', {
        reporterUserId,
        targetUserId,
        roomId: this.roomId,
        error: error instanceof Error ? error.message : String(error),
      });
      fail('Failed to submit report');
    }
  }

  private getDurableUserId(playerId: string): string | null {
    const authContext = this.playerAuthContexts.get(playerId);
    const ticket = this.playerEntryTickets.get(playerId);
    return authContext?.userId ?? ticket?.userId ?? null;
  }

  private isDurableHumanPlayer(player: Player | null | undefined): player is Player {
    return Boolean(
      player
      && !player.isBot
      && !this.spawnedNpcs.has(player.id)
      && this.getDurableUserId(player.id)
    );
  }

  private ensureMatchPersistenceLedger(now = Date.now()): MatchPersistenceLedger {
    if (
      !this.matchPersistenceLedger
      || this.matchPersistenceLedger.state === 'persisted'
      || this.matchPersistenceLedger.state === 'failed'
    ) {
      this.matchPersistenceLedger = {
        matchId: randomUUID(),
        roomId: this.roomId,
        lobbyId: this.lobbyId,
        matchMode: this.matchMode,
        mapSeed: this.state.mapSeed,
        mapThemeId: this.state.mapThemeId as VoxelMapTheme['id'],
        rankedEligible: this.rankedEligibilityCandidate,
        startedAt: new Date(now),
        endedAt: null,
        redScore: null,
        blueScore: null,
        winningTeam: null,
        state: 'active',
        participants: new Map(),
      };

      loggers.room.info('Match persistence ledger started', {
        roomId: this.roomId,
        matchId: this.matchPersistenceLedger.matchId,
        lobbyId: this.lobbyId,
        mapSeed: this.state.mapSeed,
        mapThemeId: this.state.mapThemeId,
      });
    }

    return this.matchPersistenceLedger;
  }

  private registerMatchParticipant(player: Player, now = Date.now()): MatchLedgerParticipant | null {
    const ledger = this.matchPersistenceLedger;
    if (!ledger || ledger.state !== 'active') return null;
    if (!this.isDurableHumanPlayer(player) || !isTeam(player.team)) return null;

    const userId = this.getDurableUserId(player.id);
    if (!userId) return null;

    const existing = ledger.participants.get(userId);
    if (existing) {
      existing.playerSessionId = player.id;
      existing.displayName = player.name;
      existing.team = player.team;
      existing.heroId = isHeroId(player.heroId) ? player.heroId : null;
      existing.leftAt = null;
      return existing;
    }

    const participant: MatchLedgerParticipant = {
      userId,
      playerSessionId: player.id,
      displayName: player.name,
      team: player.team,
      heroId: isHeroId(player.heroId) ? player.heroId : null,
      kills: 0,
      deaths: 0,
      assists: 0,
      flagCaptures: 0,
      flagReturns: 0,
      joinedAt: new Date(now),
      leftAt: null,
    };
    ledger.participants.set(userId, participant);
    return participant;
  }

  private syncMatchParticipant(player: Player): MatchLedgerParticipant | null {
    const ledger = this.matchPersistenceLedger;
    if (!ledger || ledger.state !== 'active') return null;
    if (!this.isDurableHumanPlayer(player) || !isTeam(player.team)) return null;

    const userId = this.getDurableUserId(player.id);
    if (!userId) return null;

    const participant = ledger.participants.get(userId) ?? this.registerMatchParticipant(player);
    if (!participant) return null;

    participant.playerSessionId = player.id;
    participant.displayName = player.name;
    participant.team = player.team;
    participant.heroId = isHeroId(player.heroId) ? player.heroId : null;
    participant.kills = Math.max(participant.kills, player.kills);
    participant.deaths = Math.max(participant.deaths, player.deaths);
    participant.assists = Math.max(participant.assists, player.assists);
    participant.flagCaptures = Math.max(participant.flagCaptures, player.flagCaptures);
    participant.flagReturns = Math.max(participant.flagReturns, player.flagReturns);
    return participant;
  }

  private buildMatchParticipantSnapshots(ledger: MatchPersistenceLedger): MatchParticipantSnapshot[] {
    this.state.players.forEach((player) => {
      this.syncMatchParticipant(player);
    });

    return Array.from(ledger.participants.values()).map((participant) => ({
      userId: participant.userId,
      playerSessionId: participant.playerSessionId,
      displayName: participant.displayName,
      team: participant.team,
      heroId: participant.heroId,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      flagCaptures: participant.flagCaptures,
      flagReturns: participant.flagReturns,
      joinedAt: participant.joinedAt,
      leftAt: participant.leftAt,
    }));
  }

  private markMatchParticipantLeft(player: Player, now = Date.now()): void {
    const participant = this.syncMatchParticipant(player);
    if (!participant) return;

    participant.leftAt = new Date(now);
  }

  private recordMatchDeath(victim: Player, killer: Player | null): void {
    if (!this.isDurableHumanPlayer(victim)) return;
    if (killer && !this.isDurableHumanPlayer(killer)) return;

    const participant = this.registerMatchParticipant(victim);
    if (participant) {
      participant.deaths++;
    }
  }

  private recordMatchKill(killer: Player, victim: Player): void {
    if (!this.isDurableHumanPlayer(killer) || !this.isDurableHumanPlayer(victim)) return;

    const participant = this.registerMatchParticipant(killer);
    if (participant) {
      participant.kills++;
    }
  }

  private recordMatchAssist(assister: Player, victim: Player): void {
    if (!this.isDurableHumanPlayer(assister) || !this.isDurableHumanPlayer(victim)) return;

    const participant = this.registerMatchParticipant(assister);
    if (participant) {
      participant.assists++;
    }
  }

  private recordMatchFlagCapture(player: Player): void {
    if (!this.isDurableHumanPlayer(player)) return;

    const participant = this.registerMatchParticipant(player);
    if (participant) {
      participant.flagCaptures++;
    }
  }

  private recordMatchFlagReturn(player: Player): void {
    if (!this.isDurableHumanPlayer(player)) return;

    const participant = this.registerMatchParticipant(player);
    if (participant) {
      participant.flagReturns++;
    }
  }

  private serializePersistenceError(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
      };
    }

    return { message: String(error) };
  }

  private cleanAntiCheatGate(): AntiCheatIntegrityGate {
    return {
      status: 'clean',
      reviewRequired: false,
      rankedHoldRequired: false,
      payoutHoldRequired: false,
      observedOnly: getAntiCheatConfig().mode === 'observe',
      reason: null,
      affectedUserIds: [],
      affectedTeams: [],
      score: 0,
      caseId: null,
    };
  }

  private isFinalRankedEligible(
    ledger: MatchPersistenceLedger,
    participants: MatchParticipantSnapshot[],
    forcedByPlayerId?: string
  ): boolean {
    return Boolean(
      ledger.rankedEligible
      && ledger.matchMode === 'ranked'
      && this.matchMode === 'ranked'
      && !forcedByPlayerId
      && this.spawnedNpcs.size === 0
      && participants.length === this.rankedRequiredHumanPlayers
      && participants.every((participant) => participant.userId)
    );
  }

  private persistMatchLedger(
    finalScore: { red: number; blue: number },
    winningTeam: Team | null,
    forcedByPlayerId?: string
  ): void {
    const ledger = this.matchPersistenceLedger;
    if (!ledger || ledger.state !== 'active') return;

    const endedAt = new Date();
    ledger.endedAt = endedAt;
    ledger.redScore = finalScore.red;
    ledger.blueScore = finalScore.blue;
    ledger.winningTeam = winningTeam;
    ledger.state = 'persisting';

    const participants = this.buildMatchParticipantSnapshots(ledger);
    const rankedEligible = this.isFinalRankedEligible(ledger, participants, forcedByPlayerId);
    const integrityGate = this.antiCheat?.buildIntegrityGate({
      rankedEligible,
      wagered: Boolean(this.wagerContext),
    }) ?? this.cleanAntiCheatGate();
    const rankedOutcomeStatus = rankedEligible
      ? integrityGate.rankedHoldRequired ? 'held' : 'applied'
      : ledger.matchMode === 'ranked' ? 'canceled' : 'not_applicable';
    const rankedImpact = rankedEligible
      ? integrityGate.rankedHoldRequired
        ? 'held'
        : integrityGate.reviewRequired
          ? 'reported'
          : 'none'
      : 'none';
    const wagerImpact = this.wagerContext
      ? integrityGate.payoutHoldRequired
        ? 'held'
        : integrityGate.reviewRequired
          ? 'reported'
          : 'none'
      : 'none';

    void this.antiCheatEvidenceStore.upsertMatchIntegrity({
      matchId: ledger.matchId,
      roomId: ledger.roomId,
      lobbyId: ledger.lobbyId,
      matchMode: ledger.matchMode,
      gate: integrityGate,
      rankedImpact,
      wagerImpact,
    }).catch((error) => {
      loggers.room.error('Failed to persist anti-cheat match integrity', {
        roomId: ledger.roomId,
        matchId: ledger.matchId,
        error: this.serializePersistenceError(error),
      });
    });

    if (rankedEligible && (integrityGate.rankedHoldRequired || (integrityGate.reviewRequired && integrityGate.observedOnly))) {
      void this.antiCheatEvidenceStore.recordAction({
        type: 'ranked_hold',
        roomId: ledger.roomId,
        matchId: ledger.matchId,
        caseId: integrityGate.caseId,
        reason: integrityGate.reason ?? 'match_integrity_review',
        observedOnly: !integrityGate.rankedHoldRequired,
        details: {
          status: integrityGate.status,
          score: integrityGate.score,
          affectedUserIds: integrityGate.affectedUserIds,
          rankedOutcomeStatus,
        },
      }).catch((error) => {
        loggers.room.error('Failed to persist anti-cheat ranked action', {
          roomId: ledger.roomId,
          matchId: ledger.matchId,
          error: this.serializePersistenceError(error),
        });
      });
    }

    void persistCompletedMatch(prisma, {
      matchId: ledger.matchId,
      roomId: ledger.roomId,
      lobbyId: ledger.lobbyId,
      mapSeed: ledger.mapSeed,
      mapThemeId: ledger.mapThemeId,
      matchMode: ledger.matchMode,
      rankedEligible,
      startedAt: ledger.startedAt,
      endedAt,
      redScore: finalScore.red,
      blueScore: finalScore.blue,
      winningTeam,
      participants,
      antiCheatIntegrityStatus: integrityGate.status,
      antiCheatReviewRequired: integrityGate.rankedHoldRequired || integrityGate.payoutHoldRequired,
      antiCheatIntegrityReason: integrityGate.reason,
      rankedOutcomeStatus,
    })
      .then((result) => {
        ledger.state = 'persisted';
        loggers.room.info('Match persistence completed', {
          roomId: ledger.roomId,
          matchId: ledger.matchId,
          lobbyId: ledger.lobbyId,
          mapSeed: ledger.mapSeed,
          redScore: finalScore.red,
          blueScore: finalScore.blue,
          winningTeam,
          participantCount: result.participantCount,
          alreadyPersisted: result.alreadyPersisted,
          skippedUserIds: result.skippedUserIds,
          rankedEligible,
        });
      })
      .catch((error) => {
        ledger.state = 'failed';
        loggers.room.error('Match persistence failed', {
          roomId: ledger.roomId,
          matchId: ledger.matchId,
          lobbyId: ledger.lobbyId,
          mapSeed: ledger.mapSeed,
          redScore: finalScore.red,
          blueScore: finalScore.blue,
          winningTeam,
          participantCount: participants.length,
          error: this.serializePersistenceError(error),
        });
      });
  }

  private settleWagerAfterGame(winningTeam: Team | null): void {
    if (!this.wagerContext) return;
    this.wagerSettlementRequested = true;

    const matchId = this.matchPersistenceLedger?.matchId ?? null;
    const gate = this.antiCheat?.buildIntegrityGate({
      rankedEligible: this.matchPersistenceLedger?.rankedEligible === true,
      wagered: true,
    }) ?? this.cleanAntiCheatGate();
    if (gate.payoutHoldRequired) {
      this.antiCheatEvidenceStore.createPayoutHold({
        wageredLobbyId: this.wagerContext.wageredLobbyId,
        matchId,
        winningTeam,
        gate,
      })
        .then((holdId) => {
          loggers.room.info('Wager settlement paused for anti-cheat review', {
            roomId: this.roomId,
            lobbyId: this.lobbyId,
            matchId,
            wageredLobbyId: this.wagerContext?.wageredLobbyId,
            holdId,
            reason: gate.reason,
          });
        })
        .catch((error) => {
          loggers.room.error('Failed to create anti-cheat payout hold', {
            roomId: this.roomId,
            lobbyId: this.lobbyId,
            matchId,
            wageredLobbyId: this.wagerContext?.wageredLobbyId,
            error: this.serializePersistenceError(error),
          });
        });
      return;
    }

    if (gate.reviewRequired && gate.observedOnly) {
      void this.antiCheatEvidenceStore.recordAction({
        type: 'payout_hold',
        roomId: this.roomId,
        matchId,
        caseId: gate.caseId,
        reason: gate.reason ?? 'match_integrity_review',
        observedOnly: true,
        details: {
          wageredLobbyId: this.wagerContext.wageredLobbyId,
          winningTeam,
          score: gate.score,
          status: gate.status,
        },
      }).catch((error) => {
        loggers.room.error('Failed to record observed anti-cheat payout hold', {
          roomId: this.roomId,
          lobbyId: this.lobbyId,
          matchId,
          error: this.serializePersistenceError(error),
        });
      });
    }

    wagerService.settleWageredLobby({
      wageredLobbyId: this.wagerContext.wageredLobbyId,
      matchId,
      winningTeam,
    })
      .then((settlement) => {
        loggers.room.info('Wager settlement requested', {
          roomId: this.roomId,
          lobbyId: this.lobbyId,
          matchId,
          wageredLobbyId: this.wagerContext?.wageredLobbyId,
          settlement,
        });
      })
      .catch((error) => {
        loggers.room.error('Wager settlement failed', {
          roomId: this.roomId,
          lobbyId: this.lobbyId,
          matchId,
          wageredLobbyId: this.wagerContext?.wageredLobbyId,
          error: this.serializePersistenceError(error),
        });
      });
  }

  private settleWagerNoContest(reason: string): void {
    if (!this.wagerContext || this.wagerSettlementRequested) return;

    this.wagerSettlementRequested = true;
    const matchId = this.matchPersistenceLedger?.matchId ?? null;
    wagerService.settleWageredLobby({
      wageredLobbyId: this.wagerContext.wageredLobbyId,
      matchId,
      winningTeam: null,
    })
      .then((settlement) => {
        loggers.room.info('Wager no-contest refund requested', {
          roomId: this.roomId,
          lobbyId: this.lobbyId,
          matchId,
          reason,
          wageredLobbyId: this.wagerContext?.wageredLobbyId,
          settlement,
        });
      })
      .catch((error) => {
        loggers.room.error('Failed to request wager no-contest refund', {
          roomId: this.roomId,
          lobbyId: this.lobbyId,
          matchId,
          reason,
          wageredLobbyId: this.wagerContext?.wageredLobbyId,
          error: this.serializePersistenceError(error),
        });
      });
  }

  private settleGoldenBiomeRewardAfterGame(winningTeam: Team | null, forcedByPlayerId?: string): void {
    const ledger = this.matchPersistenceLedger;
    if (this.state.mapThemeId !== GOLDEN_VOXEL_MAP_THEME_ID || !ledger || ledger.state !== 'active') return;
    if (this.matchMode !== 'ranked' || !winningTeam || forcedByPlayerId) return;

    const participants = this.buildMatchParticipantSnapshots(ledger);
    if (!this.isFinalRankedEligible(ledger, participants, forcedByPlayerId)) return;

    const gate = this.antiCheat?.buildIntegrityGate({
      rankedEligible: true,
      wagered: true,
    }) ?? this.cleanAntiCheatGate();
    if (gate.payoutHoldRequired || gate.rankedHoldRequired) {
      loggers.room.warn('Golden biome reward held for match integrity review', {
        roomId: this.roomId,
        lobbyId: this.lobbyId,
        matchId: ledger.matchId,
        reason: gate.reason,
        status: gate.status,
      });
      return;
    }

    const winners: GoldenBiomeRewardWinner[] = participants
      .filter((participant) => participant.team === winningTeam && participant.userId)
      .map((participant) => ({
        userId: participant.userId,
        playerSessionId: participant.playerSessionId,
      }));

    if (winners.length === 0) return;

    wagerService.settleGoldenBiomeReward({
      matchId: ledger.matchId,
      roomId: this.roomId,
      lobbyId: this.lobbyId,
      mapSeed: this.state.mapSeed,
      winningTeam,
      winners,
    })
      .then((reward) => {
        loggers.room.info('Golden biome reward settlement requested', {
          roomId: this.roomId,
          lobbyId: this.lobbyId,
          matchId: ledger.matchId,
          reward,
        });
      })
      .catch((error) => {
        loggers.room.error('Golden biome reward settlement failed', {
          roomId: this.roomId,
          lobbyId: this.lobbyId,
          matchId: ledger.matchId,
          error: this.serializePersistenceError(error),
        });
      });
  }

  private getVoiceIdentity(playerId: string): string | null {
    return this.playerAuthContexts.get(playerId)?.userId
      ?? this.playerEntryTickets.get(playerId)?.userId
      ?? null;
  }

  private normalizeVoiceTeam(team: string | null | undefined): Team | null {
    return isTeam(team) ? team : null;
  }

  private async removeVoiceParticipantForPlayer(
    playerId: string,
    team: Team | null | undefined,
    reason: string
  ): Promise<void> {
    if (!voiceService.isEnabled()) return;
    const identity = this.getVoiceIdentity(playerId);
    if (!identity) return;
    await voiceService.removeMatchParticipant(this.roomId, identity, team, reason);
  }

  private recordSecurityEvent(event: Omit<SecurityEvent, 'roomId' | 'tick' | 'serverTime'>): void {
    const fullEvent: SecurityEvent = {
      ...event,
      roomId: this.roomId,
      tick: this.state.tick,
      serverTime: this.state.serverTime || Date.now(),
    };
    this.securityEvents.push(fullEvent);
    if (this.securityEvents.length > MAX_SECURITY_EVENTS) {
      this.securityEvents.splice(0, this.securityEvents.length - MAX_SECURITY_EVENTS);
    }
    const player = this.state.players.get(event.playerId);
    this.antiCheat?.recordAuthorityEvent({
      ...fullEvent,
      team: player?.team ?? null,
      heroId: isHeroId(player?.heroId) ? player.heroId : null,
    });
    this.logSecurityEvent(fullEvent);
  }

  private securityEventLogIntervalMs(event: SecurityEvent): number {
    return event.type === 'movement_correction'
      ? MOVEMENT_CORRECTION_LOG_SAMPLE_MS
      : SECURITY_EVENT_LOG_SAMPLE_MS;
  }

  private securityEventLogKey(event: SecurityEvent): string {
    const validationReason = typeof event.detail?.validationReason === 'string'
      ? event.detail.validationReason
      : '';
    return [
      event.type,
      event.playerId,
      event.reason ?? '',
      validationReason,
    ].join(':');
  }

  private logSecurityEvent(event: SecurityEvent): void {
    const now = Date.now();
    const key = this.securityEventLogKey(event);
    const sample = this.securityLogSamples.get(key);
    const intervalMs = this.securityEventLogIntervalMs(event);

    if (sample && now - sample.lastLoggedAt < intervalMs) {
      sample.suppressed++;
      return;
    }

    if (!sample && this.securityLogSamples.size >= MAX_SECURITY_LOG_SAMPLE_KEYS) {
      const oldestKey = this.securityLogSamples.keys().next().value;
      if (oldestKey) this.securityLogSamples.delete(oldestKey);
    }

    const suppressedSinceLastLog = sample?.suppressed ?? 0;
    this.securityLogSamples.set(key, { lastLoggedAt: now, suppressed: 0 });
    const logLevel = getSecurityEventLogLevel(event);
    if (logLevel === 'silent') return;

    const logEvent = suppressedSinceLastLog > 0
      ? { ...event, suppressedSinceLastLog }
      : event;
    if (logLevel === 'debug') {
      loggers.room.debug('authority event', logEvent);
      return;
    }
    loggers.room.warn('authority event', logEvent);
  }

  private updateLastSafeMovement(player: Player, sequence: number, acceptedAt = Date.now()): void {
    const authority = this.getMovementAuthority(player.id);
    authority.lastSafe = {
      position: this.vec3SchemaToPlain(player.position),
      velocity: this.vec3SchemaToPlain(player.velocity),
      acceptedAt,
      sequence,
    };
  }

  private suppressObjectives(playerId: string, reason: string, now = Date.now()): void {
    const authority = this.getMovementAuthority(playerId);
    authority.objectiveSuppressedUntil = Math.max(authority.objectiveSuppressedUntil, now + OBJECTIVE_SUPPRESSION_MS);
    authority.metrics.objectiveSuppressions = (authority.metrics.objectiveSuppressions ?? 0) + 1;
    this.recordSecurityEvent({
      type: 'objective_suppression',
      playerId,
      userId: this.getPlayerUserId(playerId),
      movementEpoch: authority.movementEpoch,
      reason,
      position: this.state.players.get(playerId)
        ? this.vec3SchemaToPlain(this.state.players.get(playerId)!.position)
        : undefined,
    });
  }

  private isObjectiveSuppressed(playerId: string, now = Date.now()): boolean {
    return now < (this.getMovementAuthority(playerId).objectiveSuppressedUntil || 0);
  }

  private recordObjectiveEvent(player: Player, eventType: string, team: Team, now: number): void {
    const authority = this.getMovementAuthority(player.id);
    this.recordSecurityEvent({
      type: `objective_${eventType}`,
      playerId: player.id,
      userId: this.getPlayerUserId(player.id),
      movementEpoch: authority.movementEpoch,
      reason: team,
      position: this.vec3SchemaToPlain(player.position),
      detail: {
        team: player.team,
        phase: this.state.phase,
        serverTick: this.state.tick,
        eventTeam: team,
        serverTime: now,
      },
    });
  }

  private incrementCorrectionMetric(authority: ServerMovementAuthorityState, reason: MovementCorrectionReason): void {
    authority.metrics.hardCorrections++;
    if (reason === 'invalid_transform') {
      authority.metrics.invalidTransforms = (authority.metrics.invalidTransforms ?? 0) + 1;
    } else if (reason === 'speed_limit') {
      authority.metrics.speedViolations = (authority.metrics.speedViolations ?? 0) + 1;
    } else if (reason === 'blocked_path') {
      authority.metrics.blockedPathCorrections = (authority.metrics.blockedPathCorrections ?? 0) + 1;
    } else if (reason === 'bounds') {
      authority.metrics.boundsCorrections = (authority.metrics.boundsCorrections ?? 0) + 1;
    } else if (reason === 'collision_revision') {
      authority.metrics.staleCollisionRevisionDrops = (authority.metrics.staleCollisionRevisionDrops ?? 0) + 1;
    }
  }

  private recordRateLimitDrop(playerId: string, messageType: string): void {
    const authority = this.getMovementAuthority(playerId);
    authority.metrics.rateLimitDrops = (authority.metrics.rateLimitDrops ?? 0) + 1;
    this.recordSecurityEvent({
      type: 'rate_limit_drop',
      playerId,
      userId: this.getPlayerUserId(playerId),
      movementEpoch: authority.movementEpoch,
      reason: messageType,
      position: this.state.players.get(playerId)
        ? this.vec3SchemaToPlain(this.state.players.get(playerId)!.position)
        : undefined,
    });
  }

  private rejectAbilityOrCombat(player: Player, reason: string, logEvent = true): void {
    const authority = this.getMovementAuthority(player.id);
    authority.metrics.abilityRejects = (authority.metrics.abilityRejects ?? 0) + 1;
    if (!logEvent) return;
    this.recordSecurityEvent({
      type: 'ability_reject',
      playerId: player.id,
      userId: this.getPlayerUserId(player.id),
      movementEpoch: authority.movementEpoch,
      reason,
      position: this.vec3SchemaToPlain(player.position),
    });
  }

  private clearHookshotGrapple(playerId: string): void {
    this.hookshotGrapples.delete(playerId);
    const player = this.state.players.get(playerId);
    if (player) {
      player.movement.isGrappling = false;
    }
  }

  private clearHookshotDragPull(playerId: string): void {
    this.hookshotDragPulls.delete(playerId);
  }

  private clearHookshotDragPullsInvolving(playerId: string): void {
    this.hookshotDragPulls.delete(playerId);
    for (const [targetId, pull] of this.hookshotDragPulls) {
      if (pull.sourceId === playerId) {
        this.hookshotDragPulls.delete(targetId);
      }
    }
  }

  private cleanupExpiredPlayerRoots(now: number): void {
    for (const [playerId, rootedUntil] of this.playerRootedUntil) {
      if (rootedUntil <= now) {
        this.playerRootedUntil.delete(playerId);
      }
    }
  }

  private isPlayerRooted(playerId: string, now = Date.now()): boolean {
    const rootedUntil = this.playerRootedUntil.get(playerId) ?? 0;
    if (rootedUntil <= now) {
      this.playerRootedUntil.delete(playerId);
      return false;
    }
    return true;
  }

  private stopRootedMovement(player: Player): void {
    this.clearHookshotGrapple(player.id);
    player.velocity.x = 0;
    player.velocity.z = 0;
    player.movement.isSprinting = false;
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
    player.movement.isWallRunning = false;
    player.movement.wallRunSide = '';
    player.movement.isGrappling = false;
    player.movement.isJetpacking = false;
    player.movement.isGliding = false;
  }

  private suppressLocomotionInput(input: PlayerInput): PlayerInput {
    return {
      ...input,
      moveForward: false,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      jump: false,
      crouch: false,
      sprint: false,
    };
  }

  private getRootedMovementInput(player: Player, input: PlayerInput, now: number): PlayerInput {
    if (!this.isPlayerRooted(player.id, now)) return input;
    this.stopRootedMovement(player);
    return this.suppressLocomotionInput(input);
  }

  private isRootBlockedAbility(abilityId: string | undefined): boolean {
    return Boolean(abilityId && ROOT_BLOCKED_MOVEMENT_ABILITIES.has(abilityId));
  }

  private markMovementBarrier(
    playerId: string,
    reason: MovementCorrectionReason,
    options: { preserveQueuedCommands?: boolean } = {}
  ): void {
    const authority = this.getMovementAuthority(playerId);
    const nextEpoch = authority.movementEpoch + 1;
    const preservedCommands: MovementCommand[] = [];
    if (options.preserveQueuedCommands) {
      for (const command of authority.pendingCommands) {
        if (!isMovementSeqAfter(command.seq, authority.lastProcessedSeq)) continue;
        preservedCommands.push({
          ...command,
          movementEpoch: nextEpoch,
        });
      }
    }
    authority.movementEpoch = nextEpoch;
    authority.shadow = createMovementShadowSimulationState();
    const preservedOverflow = Math.max(0, preservedCommands.length - MOVEMENT_MAX_SERVER_QUEUE);
    if (preservedOverflow > 0) {
      authority.metrics.droppedCommands += preservedOverflow;
    }
    this.replacePendingCommands(authority, preservedCommands.slice(-MOVEMENT_MAX_SERVER_QUEUE));
    authority.correctionReason = reason;
    this.forceTransformFullSync();
    const player = this.state.players.get(playerId);
    if (player) {
      this.updateLastSafeMovement(player, authority.lastProcessedSeq);
    }
    this.recordSecurityEvent({
      type: 'movement_authority_barrier',
      playerId,
      userId: this.getPlayerUserId(playerId),
      movementEpoch: authority.movementEpoch,
      reason,
      position: player ? this.vec3SchemaToPlain(player.position) : undefined,
      detail: {
        preserveQueuedCommands: options.preserveQueuedCommands === true,
        queueLength: authority.pendingCommands.length,
      },
    });
    this.suppressObjectives(playerId, reason);
    this.clearHookshotGrapple(playerId);
    this.clearHookshotDragPull(playerId);
  }

  private sanitizeIncomingMovementCommand(
    authority: ServerMovementAuthorityState,
    command: unknown,
    playerId: string
  ): MovementCommand | null {
    const sanitized = parseMovementCommandPayload(command);
    if (!sanitized) {
      authority.metrics.malformedCommands++;
      const commandShape = command && typeof command === 'object'
        ? Object.fromEntries(
          ['seq', 'buttons', 'lookYaw', 'lookPitch', 'clientTimeMs', 'movementEpoch', 'collisionRevision', 'abilityCastHints']
            .map((key) => [key, typeof (command as Record<string, unknown>)[key]])
        )
        : undefined;
      this.recordSecurityEvent({
        type: 'movement_command_reject',
        playerId,
        userId: this.getPlayerUserId(playerId),
        movementEpoch: authority.movementEpoch,
        reason: 'malformed_command',
        detail: {
          commandType: Array.isArray(command) ? 'array' : typeof command,
          commandKeys: command && typeof command === 'object' ? Object.keys(command).slice(0, 12) : undefined,
          commandShape,
        },
      });
      return null;
    }

    if (sanitized.movementEpoch !== authority.movementEpoch) {
      const canPromotePreviousEpochCommand = (
        sanitized.movementEpoch + 1 === authority.movementEpoch &&
        isMovementSeqAfter(sanitized.seq, authority.lastProcessedSeq) &&
        movementSeqDistance(authority.lastProcessedSeq, sanitized.seq) <= MOVEMENT_COMMAND_STALE_GRACE_STEPS
      );

      if (canPromotePreviousEpochCommand) {
        return {
          ...sanitized,
          movementEpoch: authority.movementEpoch,
        };
      }

      authority.metrics.lateCommands++;
      authority.correctionReason = 'epoch_mismatch';
      this.recordSecurityEvent({
        type: 'movement_command_reject',
        playerId,
        userId: this.getPlayerUserId(playerId),
        movementEpoch: authority.movementEpoch,
        movementSequence: sanitized.seq,
        reason: 'epoch_mismatch',
        detail: {
          commandEpoch: sanitized.movementEpoch,
          authorityEpoch: authority.movementEpoch,
          lastProcessedSeq: authority.lastProcessedSeq,
        },
      });
      return null;
    }

    const currentCollisionRevision = this.getMovementCollisionRevision();
    if ((sanitized.collisionRevision ?? 0) !== currentCollisionRevision) {
      authority.metrics.staleCollisionRevisionDrops = (authority.metrics.staleCollisionRevisionDrops ?? 0) + 1;
      authority.correctionReason = 'collision_revision';
      this.recordSecurityEvent({
        type: 'movement_command_reject',
        playerId,
        userId: this.getPlayerUserId(playerId),
        movementEpoch: authority.movementEpoch,
        movementSequence: sanitized.seq,
        reason: 'collision_revision',
        detail: {
          commandRevision: sanitized.collisionRevision ?? 0,
          currentRevision: currentCollisionRevision,
        },
      });
      return null;
    }

    if (!isMovementSeqAfter(sanitized.seq, authority.lastProcessedSeq)) {
      authority.metrics.duplicateCommands++;
      this.recordSecurityEvent({
        type: 'movement_command_reject',
        playerId,
        userId: this.getPlayerUserId(playerId),
        movementEpoch: authority.movementEpoch,
        movementSequence: sanitized.seq,
        reason: 'duplicate_command',
        detail: { lastProcessedSeq: authority.lastProcessedSeq },
      });
      return null;
    }

    if (authority.pendingCommands.hasSeq(sanitized.seq)) {
      authority.metrics.duplicateCommands++;
      this.recordSecurityEvent({
        type: 'movement_command_reject',
        playerId,
        userId: this.getPlayerUserId(playerId),
        movementEpoch: authority.movementEpoch,
        movementSequence: sanitized.seq,
        reason: 'duplicate_queued_command',
        detail: { queueLength: authority.pendingCommands.length },
      });
      return null;
    }

    return sanitized;
  }

  private handleMovementCommandPacket(client: Client, packet: MovementCommandPacket): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.state !== 'alive' || player.isBot) return;

    const authority = this.getMovementAuthority(client.sessionId);
    const now = Date.now();
    if (now - authority.commandWindowStartedAt >= 1000) {
      authority.commandWindowStartedAt = now;
      authority.commandsInWindow = 0;
    }

    if (
      !packet ||
      packet.protocolVersion !== MOVEMENT_PROTOCOL_VERSION ||
      !Array.isArray(packet.commands) ||
      packet.commands.length === 0 ||
      packet.commands.length > MOVEMENT_MAX_PACKET_COMMANDS
    ) {
      authority.metrics.malformedCommands++;
      this.recordSecurityEvent({
        type: 'malformed_message',
        playerId: client.sessionId,
        userId: this.getPlayerUserId(client.sessionId),
        movementEpoch: authority.movementEpoch,
        reason: 'movementCommands',
        position: this.vec3SchemaToPlain(player.position),
        detail: {
          protocolVersion: packet?.protocolVersion,
          commandCount: Array.isArray(packet?.commands) ? packet.commands.length : null,
        },
      });
      return;
    }

    for (const rawCommand of packet.commands) {
      if (authority.commandsInWindow >= MOVEMENT_MAX_COMMANDS_PER_SECOND) {
        authority.metrics.droppedCommands++;
        this.recordSecurityEvent({
          type: 'movement_command_drop',
          playerId: client.sessionId,
          userId: this.getPlayerUserId(client.sessionId),
          movementEpoch: authority.movementEpoch,
          reason: 'command_rate_limit',
          position: this.vec3SchemaToPlain(player.position),
          detail: {
            commandsInWindow: authority.commandsInWindow,
            limit: MOVEMENT_MAX_COMMANDS_PER_SECOND,
          },
        });
        continue;
      }

      const command = this.sanitizeIncomingMovementCommand(authority, rawCommand, client.sessionId);
      if (!command) continue;

      authority.commandsInWindow++;
      authority.metrics.commandsReceived++;
      this.pushPendingCommand(authority, command);
    }

    if (authority.pendingCommands.length > MOVEMENT_MAX_SERVER_QUEUE) {
      const overflow = authority.pendingCommands.length - MOVEMENT_MAX_SERVER_QUEUE;
      this.removeOldestPendingCommands(authority, overflow);
      authority.metrics.droppedCommands += overflow;
      this.recordSecurityEvent({
        type: 'movement_command_drop',
        playerId: client.sessionId,
        userId: this.getPlayerUserId(client.sessionId),
        movementEpoch: authority.movementEpoch,
        reason: 'queue_overflow',
        position: this.vec3SchemaToPlain(player.position),
        detail: {
          overflow,
          maxQueue: MOVEMENT_MAX_SERVER_QUEUE,
        },
      });
      this.markMovementBarrier(client.sessionId, 'queue_overflow');
    }

    authority.metrics.queueLength = authority.pendingCommands.length;
  }

  private movementCommandToInput(command: MovementCommand, player: Player): PlayerInput {
    const buttons = movementButtonsToInputState(command.buttons);
    return {
      tick: command.seq,
      moveForward: buttons.moveForward,
      moveBackward: buttons.moveBackward,
      moveLeft: buttons.moveLeft,
      moveRight: buttons.moveRight,
      jump: buttons.jump,
      crouch: buttons.crouch,
      crouchPressed: buttons.crouchPressed,
      sprint: buttons.sprint,
      primaryFire: buttons.primaryFire,
      secondaryFire: buttons.secondaryFire,
      reload: buttons.reload,
      ability1: buttons.ability1,
      ability2: buttons.ability2,
      ultimate: buttons.ultimate,
      interact: buttons.interact,
      lookYaw: command.lookYaw,
      lookPitch: command.lookPitch,
      timestamp: this.state.serverTime || Date.now(),
      abilityCastHints: command.abilityCastHints,
    };
  }

  private enqueueServerOwnedMovementCommands(
    player: Player,
    input: PlayerInput,
    now: number,
    commandCount = SERVER_MOVEMENT_SUBSTEPS_PER_TICK
  ): void {
    const authority = this.getMovementAuthority(player.id);
    let seq = authority.pendingCommands.peekLast()?.seq ?? authority.lastProcessedSeq;

    for (let step = 0; step < commandCount; step++) {
      seq = nextMovementSeq(seq);
      this.pushPendingCommand(authority, {
        seq,
        buttons: inputStateToMovementButtons(input, {
          crouchPressed: step === 0 && Boolean(input.crouchPressed),
        }),
        lookYaw: normalizeLookYaw(input.lookYaw),
        lookPitch: clampLookPitch(input.lookPitch),
        clientTimeMs: now + step * MOVEMENT_SUBSTEP_SECONDS * 1000,
        movementEpoch: authority.movementEpoch,
        collisionRevision: this.getMovementCollisionRevision(now),
      });
    }

    if (authority.pendingCommands.length > MOVEMENT_MAX_SERVER_QUEUE) {
      const overflow = authority.pendingCommands.length - MOVEMENT_MAX_SERVER_QUEUE;
      this.removeOldestPendingCommands(authority, overflow);
      authority.metrics.droppedCommands += overflow;
      this.markMovementBarrier(player.id, 'queue_overflow');
    }
    authority.metrics.commandsReceived += commandCount;
    authority.metrics.queueLength = authority.pendingCommands.length;
  }

  private applyMovementSimulationResult(player: Player, result: ReturnType<typeof simulateSharedMovement>): void {
    player.position.x = result.position.x;
    player.position.y = result.position.y;
    player.position.z = result.position.z;
    player.velocity.x = result.velocity.x;
    player.velocity.y = result.velocity.y;
    player.velocity.z = result.velocity.z;
    player.movement.isGrounded = result.movement.isGrounded;
    player.movement.isSprinting = result.movement.isSprinting;
    player.movement.isCrouching = result.movement.isCrouching;
    player.movement.isSliding = result.movement.isSliding;
    player.movement.slideTimeRemaining = result.movement.slideTimeRemaining;
    player.movement.isWallRunning = result.movement.isWallRunning;
    player.movement.wallRunSide = result.movement.wallRunSide || '';
    player.movement.isGrappling = result.movement.isGrappling;
    player.movement.isJetpacking = result.movement.isJetpacking;
    player.movement.jetpackFuel = result.movement.jetpackFuel;
    player.movement.isGliding = result.movement.isGliding;
    player.movement.chronosAscendantStartY = result.movement.chronosAscendantStartY ?? 0;
  }

  private startHookshotGrappleAuthority(
    player: Player,
    castId: string,
    target: PlainVec3,
    startPosition: PlainVec3,
    startedAt: number
  ): void {
    const travelMs = Math.max(
      0,
      (this.distance3D(startPosition, target) / HOOKSHOT_GRAPPLE_EXTENSION_SPEED) * 1000
    );
    this.hookshotGrapples.set(player.id, {
      castId,
      target: { ...target },
      attachAt: startedAt + travelMs,
      swing: null,
    });
    player.movement.isGrappling = false;
  }

  private prepareHookshotGrappleForMovement(player: Player, now: number): void {
    const grapple = this.hookshotGrapples.get(player.id);
    if (!grapple) return;

    if (now < grapple.attachAt) {
      player.movement.isGrappling = false;
      return;
    }

    if (!grapple.swing) {
      grapple.swing = createHookshotSwingState(
        this.vec3SchemaToPlain(player.position),
        grapple.target,
        player.movement.isGrounded
      );
    }

    player.movement.isGrappling = true;
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
  }

  private stepHookshotGrappleAuthority(
    player: Player,
    input: PlayerInput,
    dt: number,
    now: number
  ): void {
    const grapple = this.hookshotGrapples.get(player.id);
    if (!grapple || now < grapple.attachAt || !grapple.swing) return;

    const previousPosition = this.vec3SchemaToPlain(player.position);
    const result = stepHookshotSwing({
      position: previousPosition,
      velocity: this.vec3SchemaToPlain(player.velocity),
      swing: grapple.swing,
      input,
      lookYaw: player.lookYaw,
      lookPitch: player.lookPitch,
      isGrounded: player.movement.isGrounded,
      deltaTime: dt,
    });

    const world = this.getMovementCollisionWorld(now);
    const swingDelta = {
      x: result.position.x - previousPosition.x,
      y: result.position.y - previousPosition.y,
      z: result.position.z - previousPosition.z,
    };
    const terrainHit = world.sweepCapsule(previousPosition, swingDelta, PLAYER_HEIGHT, PLAYER_RADIUS);
    let nextPosition = result.position;
    let nextVelocity = result.velocity;
    if (terrainHit) {
      const into = result.velocity.x * terrainHit.normal.x +
        result.velocity.y * terrainHit.normal.y +
        result.velocity.z * terrainHit.normal.z;
      nextPosition = {
        x: terrainHit.position.x + terrainHit.normal.x * 0.04,
        y: terrainHit.position.y + terrainHit.normal.y * 0.04,
        z: terrainHit.position.z + terrainHit.normal.z * 0.04,
      };
      nextVelocity = into < 0
        ? {
          x: result.velocity.x - terrainHit.normal.x * into,
          y: result.velocity.y - terrainHit.normal.y * into,
          z: result.velocity.z - terrainHit.normal.z * into,
        }
        : result.velocity;
    }

    if (!canCapsuleOccupy(world, nextPosition, PLAYER_HEIGHT, PLAYER_RADIUS)) {
      nextPosition = previousPosition;
      nextVelocity = { x: 0, y: Math.min(0, result.velocity.y), z: 0 };
    }

    player.position.x = nextPosition.x;
    player.position.y = nextPosition.y;
    player.position.z = nextPosition.z;
    player.velocity.x = nextVelocity.x;
    player.velocity.y = nextVelocity.y;
    player.velocity.z = nextVelocity.z;

    if (terrainHit) {
      this.clearHookshotGrapple(player.id);
      return;
    }

    if (!result.swing) {
      this.clearHookshotGrapple(player.id);
      return;
    }

    grapple.swing = result.swing;
    player.movement.isGrappling = true;
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
  }

  private simulateAuthoritativeMovementStep(
    player: Player,
    input: PlayerInput,
    dt: number,
    now = this.state.serverTime || Date.now()
  ): void {
    const heroId = player.heroId as HeroId;
    const heroStats = getHeroStats(heroId);
    const collisionWorld = this.getMovementCollisionWorld(now);
    const result = simulateSharedMovement({
      position: this.vec3SchemaToPlain(player.position),
      velocity: this.vec3SchemaToPlain(player.velocity),
      movement: {
        isGrounded: player.movement.isGrounded,
        isSprinting: player.movement.isSprinting,
        isCrouching: player.movement.isCrouching,
        isSliding: player.movement.isSliding,
        slideTimeRemaining: player.movement.slideTimeRemaining,
        isWallRunning: player.movement.isWallRunning,
        wallRunSide: player.movement.wallRunSide === 'left' || player.movement.wallRunSide === 'right'
          ? player.movement.wallRunSide
          : null,
        isGrappling: player.movement.isGrappling,
        grapplePoint: null,
        isJetpacking: player.movement.isJetpacking,
        jetpackFuel: player.movement.jetpackFuel,
        isGliding: player.movement.isGliding,
        chronosAscendantStartY: player.movement.chronosAscendantStartY || undefined,
      },
      heroStats,
      input,
      lookYaw: player.lookYaw,
      deltaTime: dt,
      terrain: this.movementTerrain,
      collisionWorld,
      flagCarrier: player.hasFlag,
      activeSpeedMultiplier: this.getActiveSpeedMultiplier(player),
      chronosAscendantActive: this.isChronosAscendantActive(player),
    });

    this.applyMovementSimulationResult(player, result);
  }

  private sendSelfMovementAuthority(player: Player, client: Client, reason: MovementCorrectionReason | null): void {
    const authority = this.getMovementAuthority(player.id);
    const now = this.state.serverTime || Date.now();
    const payload: SelfMovementAuthority = {
      serverTick: this.state.tick,
      serverTime: now,
      ackSeq: authority.lastProcessedSeq,
      movementEpoch: authority.movementEpoch,
      position: this.vec3SchemaToPlain(player.position),
      velocity: this.vec3SchemaToPlain(player.velocity),
      lookYaw: player.lookYaw,
      lookPitch: player.lookPitch,
      movement: {
        isGrounded: player.movement.isGrounded,
        isSprinting: player.movement.isSprinting,
        isCrouching: player.movement.isCrouching,
        isSliding: player.movement.isSliding,
        slideTimeRemaining: player.movement.slideTimeRemaining,
        isWallRunning: player.movement.isWallRunning,
        wallRunSide: player.movement.wallRunSide === 'left' || player.movement.wallRunSide === 'right'
          ? player.movement.wallRunSide
          : null,
        isGrappling: player.movement.isGrappling,
        grapplePoint: null,
        isJetpacking: player.movement.isJetpacking,
        jetpackFuel: player.movement.jetpackFuel,
        isGliding: player.movement.isGliding,
      },
      correctionReason: reason ?? undefined,
      collisionRevision: this.getMovementCollisionRevision(),
      chronosAegisActive: this.isChronosAegisActive(player),
      chronosAegisShieldRatio: this.getChronosAegisShieldRatio(player.id),
      rootedUntil: this.isPlayerRooted(player.id, now)
        ? this.playerRootedUntil.get(player.id)
        : undefined,
    };
    this.sendTracked(client, 'selfMovementAuthority', payload);
    if (authority.lastAuthoritySentAt > 0) {
      authority.metrics.lastAckIntervalMs = Math.max(0, now - authority.lastAuthoritySentAt);
    }
    authority.lastAuthoritySentAt = now;
    authority.metrics.authoritySends = (authority.metrics.authoritySends ?? 0) + 1;
    authority.correctionReason = null;
  }

  private playerMovementSnapshot(player: Player): PlayerMovementState {
    return {
      isGrounded: player.movement.isGrounded,
      isSprinting: player.movement.isSprinting,
      isCrouching: player.movement.isCrouching,
      isSliding: player.movement.isSliding,
      slideTimeRemaining: player.movement.slideTimeRemaining,
      isWallRunning: player.movement.isWallRunning,
      wallRunSide: player.movement.wallRunSide === 'left' || player.movement.wallRunSide === 'right'
        ? player.movement.wallRunSide
        : null,
      isGrappling: player.movement.isGrappling,
      grapplePoint: null,
      isJetpacking: player.movement.isJetpacking,
      jetpackFuel: player.movement.jetpackFuel,
      isGliding: player.movement.isGliding,
      chronosAscendantStartY: player.movement.chronosAscendantStartY || undefined,
    };
  }

  private movementShadowPingBand(playerId: string): string {
    const ping = this.playerPingMs.get(playerId);
    if (!Number.isFinite(ping)) return 'unknown';
    if ((ping as number) <= 50) return '0-50';
    if ((ping as number) <= 100) return '51-100';
    if ((ping as number) <= 180) return '101-180';
    return '181+';
  }

  private movementShadowFrameRateBand(input: PlayerInput): string {
    const value = input.clientFrameRateBand;
    return value === '90fps+' ||
      value === '45-90fps' ||
      value === '30-45fps' ||
      value === 'sub30fps'
      ? value
      : 'unknown';
  }

  private movementShadowClass(player: Player, input: PlayerInput): string {
    if (player.hasFlag) return 'flag_route';
    if (player.movement.isGrappling) return 'grapple';
    if (player.movement.isSliding) return input.jump ? 'slide_jump' : 'slide';
    if (player.movement.isGliding) return 'glide';
    if (player.movement.isWallRunning) return 'wallrun';
    if (player.heroId === 'blaze' && input.ability2) return 'rocket_jump';
    if (player.heroId === 'phantom' && (input.ability1 || input.ability2)) return 'teleport_ability';
    if (player.heroId === 'chronos' && input.ability1) {
      return input.secondaryFire ? 'chronos_lifeline_self' : 'chronos_lifeline_allies';
    }
    if (player.heroId === 'chronos' && input.ability2) return 'chronos_tempo';
    if (input.jump && !player.movement.isGrounded) return 'bhop_air';
    if (input.crouch) return 'crouch';
    if (input.sprint) return 'sprint';
    if (input.moveForward || input.moveBackward || input.moveLeft || input.moveRight) return 'walk';
    return 'idle';
  }

  private shouldRunMovementShadowSimulation(authority: ServerMovementAuthorityState, input: PlayerInput): boolean {
    const config = getAntiCheatConfig();
    if (config.movementAuthorityMode !== 'shadow' && config.movementAuthorityMode !== 'strict') return false;
    if (config.movementDriftSampleRate <= 0) return false;
    if (Math.random() > config.movementDriftSampleRate) return false;
    if (authority.shadow.initialized && input.tick <= authority.shadow.lastSequence) {
      authority.shadow = createMovementShadowSimulationState();
      return false;
    }
    return true;
  }

  private recordMovementShadowSimulation(
    player: Player,
    input: PlayerInput,
    proposedPosition: PlainVec3,
    proposedVelocity: PlainVec3,
    now: number
  ): void {
    const authority = this.getMovementAuthority(player.id);
    if (!this.shouldRunMovementShadowSimulation(authority, input)) return;

    const heroId = isHeroId(player.heroId) ? player.heroId : null;
    if (!heroId) return;

    const result = advanceMovementShadowSimulation({
      state: authority.shadow,
      playerPosition: this.vec3SchemaToPlain(player.position),
      playerVelocity: this.vec3SchemaToPlain(player.velocity),
      playerMovement: this.playerMovementSnapshot(player),
      heroStats: getHeroStats(heroId),
      input,
      terrain: this.movementTerrain,
      flagCarrier: player.hasFlag,
      activeSpeedMultiplier: this.getActiveSpeedMultiplier(player),
      chronosAscendantActive: this.isChronosAscendantActive(player),
      proposedPosition,
      proposedVelocity,
    });
    authority.shadow = result.nextState;

    authority.metrics.shadowSamples = (authority.metrics.shadowSamples ?? 0) + 1;
    authority.metrics.shadowLastPositionDrift = result.sample.positionDrift;
    authority.metrics.shadowLastVelocityDrift = result.sample.velocityDrift;
    authority.metrics.shadowMaxPositionDrift = Math.max(
      authority.metrics.shadowMaxPositionDrift ?? 0,
      result.sample.positionDrift
    );
    authority.metrics.shadowMaxVelocityDrift = Math.max(
      authority.metrics.shadowMaxVelocityDrift ?? 0,
      result.sample.velocityDrift
    );
    if (result.sample.movementMismatch) {
      authority.metrics.shadowMovementMismatches = (authority.metrics.shadowMovementMismatches ?? 0) + 1;
    }

    recordMovementShadowDriftSample({
      roomId: this.roomId,
      matchMode: this.matchMode,
      heroId,
      movementClass: this.movementShadowClass(player, input),
      mapSeed: this.state.mapSeed,
      pingBandMs: this.movementShadowPingBand(player.id),
      frameRateBand: this.movementShadowFrameRateBand(input),
      positionDrift: result.sample.positionDrift,
      velocityDrift: result.sample.velocityDrift,
      movementMismatch: result.sample.movementMismatch,
      objectiveSuppressed: this.isObjectiveSuppressed(player.id, now),
      sampledAt: now,
    });
  }

  private getChronosLifelineTargets(caster: Player): Player[] {
    const radiusSq = CHRONOS_LIFELINE_RADIUS * CHRONOS_LIFELINE_RADIUS;
    const candidates: Array<{
      player: Player;
      distanceSq: number;
      healthScore: number;
    }> = [];

    this.state.players.forEach((candidate) => {
      if (candidate.id === caster.id) return;
      if (candidate.state !== 'alive') return;
      if (candidate.team !== caster.team) return;

      const dx = candidate.position.x - caster.position.x;
      const dy = candidate.position.y - caster.position.y;
      const dz = candidate.position.z - caster.position.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq > radiusSq) return;

      candidates.push({
        player: candidate,
        distanceSq,
        healthScore: candidate.health / Math.max(1, candidate.maxHealth),
      });
    });

    candidates.sort((a, b) => (
      a.healthScore === b.healthScore
        ? a.distanceSq - b.distanceSq
        : a.healthScore - b.healthScore
    ));

    return candidates.slice(0, CHRONOS_LIFELINE_MAX_TARGETS).map((candidate) => candidate.player);
  }

  private executeChronosLifelineConduit(
    caster: Player,
    abilityState: AbilityStateSchema,
    targets: Player[],
    healAmount: number
  ): void {
    const now = Date.now();
    const healedTargets: Array<{
      targetId: string;
      amount: number;
      newHealth: number;
      position: PlainVec3;
    }> = [];

    for (const target of targets) {
      if (target.state !== 'alive') continue;
      if (target.team !== caster.team) continue;

      const beforeHealth = target.health;
      target.health = Math.min(target.maxHealth, target.health + healAmount);
      const amount = target.health - beforeHealth;

      healedTargets.push({
        targetId: target.id,
        amount,
        newHealth: target.health,
        position: this.vec3SchemaToPlain(target.position),
      });
    }

    abilityState.isActive = false;
    abilityState.activatedAt = now;

    if (healedTargets.length > 0) {
      this.broadcastPlayerHealed(caster, {
        sourceId: caster.id,
        abilityId: 'chronos_lifeline_conduit',
        sourcePosition: this.vec3SchemaToPlain(caster.position),
        targets: healedTargets,
        timestamp: now,
      });
    }
  }

  private scheduleChronosLifelineConduit(
    casterId: string,
    targetIds: string[],
    healAmount: number,
    releaseAt: number
  ): void {
    const delayMs = Math.max(0, releaseAt - Date.now());

    this.scheduleRoomTimeout(() => {
      const caster = this.state.players.get(casterId);
      if (!caster || caster.state !== 'alive') return;

      const abilityState = caster.abilities.get('chronos_lifeline_conduit');
      if (!abilityState) return;

      const targets = targetIds
        .map((targetId) => this.state.players.get(targetId))
        .filter((target): target is Player => Boolean(target));

      this.executeChronosLifelineConduit(caster, abilityState, targets, healAmount);
    }, delayMs);
  }

  private nextPhantomCastId(playerId: string, abilityId: string): string {
    return `${abilityId}_${playerId}_${this.phantomCastIdCounter++}`;
  }

  private getAbilityCastOriginHint(
    player: Player,
    abilityId: string,
    socketName: string
  ): AbilityCastOriginHint | null {
    const hints = player.lastInput?.abilityCastHints;
    if (!hints || hints.length === 0) return null;

    return hints.find((hint) => (
      hint.abilityId === abilityId &&
      hint.socketName === socketName &&
      this.isFiniteVec3(hint.origin)
    )) ?? null;
  }

  private resolveValidatedCastOriginHint(
    player: Player,
    abilityId: string,
    socketName: string,
    fallbackOrigin: PlainVec3
  ): PlainVec3 {
    const hint = this.getAbilityCastOriginHint(player, abilityId, socketName);
    if (!hint) return fallbackOrigin;

    const origin = hint.origin;
    const playerCenter = this.vec3SchemaToPlain(player.position);
    const distanceFromFallback = this.distance3D(origin, fallbackOrigin);
    const distanceFromCenter = this.distance3D(origin, playerCenter);
    const verticalFromCenter = Math.abs(origin.y - playerCenter.y);

    if (
      distanceFromFallback > ABILITY_CAST_HINT_MAX_DISTANCE_FROM_FALLBACK ||
      distanceFromCenter > ABILITY_CAST_HINT_MAX_DISTANCE_FROM_PLAYER_CENTER ||
      verticalFromCenter > ABILITY_CAST_HINT_MAX_VERTICAL_FROM_PLAYER_CENTER
    ) {
      return fallbackOrigin;
    }

    return this.hasLineOfSight(fallbackOrigin, origin) ? origin : fallbackOrigin;
  }

  private getPhantomCastOrigin(
    player: Player,
    socket: { handHeight: number; forwardOffset: number; sideOffset: number },
    launchSide: -1 | 1 = 1,
    hint?: { abilityId: string; socketName: string }
  ): PlainVec3 {
    const fallbackOrigin = calculatePlayerSocketPosition(player.position, player.lookYaw, {
      ...socket,
      sideOffset: socket.sideOffset * launchSide,
    });

    return hint
      ? this.resolveValidatedCastOriginHint(player, hint.abilityId, hint.socketName, fallbackOrigin)
      : fallbackOrigin;
  }

  private getAbilitySocketCastOrigin(
    player: Player,
    abilityId: string,
    launchSide: -1 | 1 = 1
  ): PlainVec3 {
    const resolved = resolveAbilitySocket({ abilityId, side: launchSide });
    if (!resolved) {
      return this.vec3SchemaToPlain(player.position);
    }

    const fallbackOrigin = calculatePlayerSocketPosition(
      player.position,
      player.lookYaw,
      resolved.fallbackOffset
    );
    const socketName = resolved.socketNames[0];
    return socketName
      ? this.resolveValidatedCastOriginHint(player, abilityId, socketName, fallbackOrigin)
      : fallbackOrigin;
  }

  private normalize3D(vector: PlainVec3): PlainVec3 | null {
    const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
    if (length <= 0.0001) return null;

    return {
      x: vector.x / length,
      y: vector.y / length,
      z: vector.z / length,
    };
  }

  private addScaled3D(origin: PlainVec3, direction: PlainVec3, distance: number): PlainVec3 {
    return {
      x: origin.x + direction.x * distance,
      y: origin.y + direction.y * distance,
      z: origin.z + direction.z * distance,
    };
  }

  private getHookshotAimOrigin(player: Player): PlainVec3 {
    return getSharedPlayerEyePosition(player.position);
  }

  private raycastTerrain(start: PlainVec3, direction: PlainVec3, maxDistance: number, step = 0.35): PlainVec3 | null {
    const normalized = this.normalize3D(direction);
    if (!normalized) return null;

    const steps = Math.max(1, Math.ceil(maxDistance / step));
    let lastOpenPoint = { ...start };
    for (let i = 1; i <= steps; i++) {
      const distance = Math.min(maxDistance, i * step);
      const point = this.addScaled3D(start, normalized, distance);
      if (isCollisionBlock(this.getBlockAtWorld(point))) {
        return lastOpenPoint;
      }
      lastOpenPoint = point;
    }

    return null;
  }

  private getNextHookshotPrimaryLaunchSide(playerId: string): -1 | 1 {
    const previous = this.hookshotPrimaryLaunchSide.get(playerId) ?? -1;
    const next = previous === 1 ? -1 : 1;
    this.hookshotPrimaryLaunchSide.set(playerId, next);
    return next;
  }

  private getNextPhantomPrimaryLaunchSide(playerId: string): -1 | 1 {
    const previous = this.phantomPrimaryLaunchSide.get(playerId) ?? -1;
    const next = previous === 1 ? -1 : 1;
    this.phantomPrimaryLaunchSide.set(playerId, next);
    return next;
  }

  private resolveHookshotLaunch(
    player: Player,
    launchSide: -1 | 1,
    maxDistance: number,
    abilityId: 'hookshot_basic_attack' | 'hookshot_heavy_attack'
  ): { startPosition: PlainVec3; aimDirection: PlainVec3 } {
    const lookDirection = this.getForwardVector(player.lookYaw, player.lookPitch);
    const startPosition = this.getAbilitySocketCastOrigin(player, abilityId, launchSide);
    const aimOrigin = this.getHookshotAimOrigin(player);
    const aimPoint = this.raycastTerrain(aimOrigin, lookDirection, maxDistance)
      ?? this.addScaled3D(aimOrigin, lookDirection, maxDistance);
    const fromHook = this.normalize3D({
      x: aimPoint.x - startPosition.x,
      y: aimPoint.y - startPosition.y,
      z: aimPoint.z - startPosition.z,
    });

    return {
      startPosition,
      aimDirection: fromHook ?? lookDirection,
    };
  }

  private resolveHookshotGrappleTarget(player: Player): PlainVec3 | null {
    const aimOrigin = this.getHookshotAimOrigin(player);
    const lookDirection = this.getForwardVector(player.lookYaw, player.lookPitch);
    const directHit = this.raycastTerrain(aimOrigin, lookDirection, GRAPPLE_MAX_DISTANCE);
    if (directHit) return directHit;

    const downwardDirection = this.normalize3D({
      x: lookDirection.x,
      y: Math.min(lookDirection.y, -0.1),
      z: lookDirection.z,
    });
    return downwardDirection
      ? this.raycastTerrain(aimOrigin, downwardDirection, GRAPPLE_MAX_DISTANCE)
      : null;
  }

  private resolveHookshotAnchorWall(player: Player): { startPosition: PlainVec3; direction: PlainVec3 } {
    const forward = this.forward2D(player.lookYaw);
    const normalized = this.normalize2D(forward) ?? { x: 0, z: -1 };
    const groundY = this.getProceduralGroundY({
      x: player.position.x,
      y: player.position.y + 2,
      z: player.position.z,
    }) ?? player.position.y;

    return {
      startPosition: {
        x: player.position.x,
        y: groundY,
        z: player.position.z,
      },
      direction: {
        x: normalized.x,
        y: 0,
        z: normalized.z,
      },
    };
  }

  private queuePendingAreaDamage(instance: PendingAreaDamageInstance): void {
    this.pendingAreaDamage.push(instance);
  }

  private updatePendingAreaDamage(now: number): void {
    if (this.pendingAreaDamage.length === 0) return;

    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.pendingAreaDamage.length; readIndex++) {
      const instance = this.pendingAreaDamage[readIndex];
      if (now < instance.resolveAt) {
        this.pendingAreaDamage[writeIndex++] = instance;
        continue;
      }

      const owner = this.state.players.get(instance.ownerId);
      if (owner) {
        this.applyAreaDamage(
          owner,
          instance.center,
          instance.radius,
          instance.damage,
          instance.damageType
        );
      }
    }
    this.pendingAreaDamage.length = writeIndex;
  }

  private createBlazeGearstorm(
    player: Player,
    position: PlainVec3,
    now: number,
    durationSeconds: number
  ): void {
    this.blazeGearstorms.push({
      id: `blaze_gearstorm_${player.id}_${this.blazeGearstormIdCounter++}`,
      ownerId: player.id,
      ownerTeam: player.team as Team,
      position,
      radius: BLAZE_GEARSTORM_RADIUS,
      damage: BLAZE_GEARSTORM_DAMAGE,
      startTime: now,
      endTime: now + durationSeconds * 1000,
      lastDamageTick: new Map(),
    });
  }

  private updateBlazeGearstorms(now: number): void {
    if (this.blazeGearstorms.length === 0) return;

    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.blazeGearstorms.length; readIndex++) {
      const storm = this.blazeGearstorms[readIndex];
      if (now >= storm.endTime) continue;

      const owner = this.state.players.get(storm.ownerId);
      if (!owner) {
        this.blazeGearstorms[writeIndex++] = storm;
        continue;
      }

      const radiusSq = storm.radius * storm.radius;
      const targets = this.playerSpatialIndex.queryRadius(
        storm.position,
        storm.radius,
        this.spatialQueryScratch,
        { team: storm.ownerTeam === 'red' ? 'blue' : 'red' }
      );
      for (const target of targets) {
        if (target.state !== 'alive') continue;

        const dx = target.position.x - storm.position.x;
        const dy = target.position.y - storm.position.y;
        const dz = target.position.z - storm.position.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq > radiusSq) continue;

        const lastDamage = storm.lastDamageTick.get(target.id) || 0;
        if (now - lastDamage < BLAZE_GEARSTORM_DAMAGE_INTERVAL_MS) continue;
        storm.lastDamageTick.set(target.id, now);

        const falloff = 1 - Math.sqrt(distSq) / storm.radius * 0.35;
        this.applyDamage(target, Math.max(1, Math.round(storm.damage * falloff)), owner.id, 'airstrike', {
          abilityId: 'blaze_airstrike',
          sourcePosition: storm.position,
        });
      }

      this.blazeGearstorms[writeIndex++] = storm;
    }
    this.blazeGearstorms.length = writeIndex;
  }

  private applyHookshotGroundHooksRoot(caster: Player, now: number): HookshotGroundHooksTarget[] {
    const ownerTeam = caster.team as Team;
    const enemyTeam = ownerTeam === 'red' ? 'blue' : 'red';
    const rootUntil = now + HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS * 1000;
    const targets = this.playerSpatialIndex.queryRadius(
      caster.position,
      HOOKSHOT_GROUND_HOOKS_RADIUS,
      this.spatialQueryScratch,
      { team: enemyTeam }
    );
    const rootedTargets: HookshotGroundHooksTarget[] = [];

    for (const target of targets) {
      if (target.state !== 'alive') continue;
      this.playerRootedUntil.set(
        target.id,
        Math.max(this.playerRootedUntil.get(target.id) ?? 0, rootUntil)
      );
      this.stopRootedMovement(target);
      this.markMovementBarrier(target.id, 'root', { preserveQueuedCommands: true });
      rootedTargets.push({
        targetId: target.id,
        position: this.vec3SchemaToPlain(target.position),
        rootUntil,
      });
    }

    return rootedTargets;
  }

  private nextBlazeCastId(playerId: string, abilityId: string, counter: number): string {
    return `${abilityId}_${playerId}_${counter}`;
  }

  private getBlazeAimOrigin(player: Player): PlainVec3 {
    return getSharedPlayerEyePosition(player.position);
  }

  private resolveBlazeRocketCast(
    player: Player,
    attack: AttackConfig,
    now: number
  ): {
    castId: string;
    startPosition: PlainVec3;
    impactPosition: PlainVec3;
    aimDirection: PlainVec3;
    impactTime: number;
    aegisHit?: ChronosAegisSkillHit;
  } {
    const castId = this.nextBlazeCastId(player.id, 'blaze_rocket', this.blazeRocketIdCounter++);
    const lookDirection = this.getForwardVector(player.lookYaw, player.lookPitch);
    const aimOrigin = this.getBlazeAimOrigin(player);
    const startPosition = this.getAbilitySocketCastOrigin(player, 'blaze_rocket');
    const terrainHit = this.raycastTerrain(aimOrigin, lookDirection, BLAZE_ROCKET_AIM_DISTANCE);
    const targetHit = this.findTargetHitInAimCone(player, attack.range, attack.coneDot, attack.collisionRadius ?? 0);
    const targetPoint = targetHit?.hit.targetPoint ?? null;
    const terrainDistance = terrainHit ? this.distance3D(aimOrigin, terrainHit) : Infinity;
    const targetDistance = targetPoint ? this.distance3D(aimOrigin, targetPoint) : Infinity;
    const fallbackImpact = this.addScaled3D(aimOrigin, lookDirection, BLAZE_ROCKET_AIM_DISTANCE);
    const intendedImpactPosition = targetPoint && targetDistance <= terrainDistance
      ? targetPoint
      : terrainHit ?? fallbackImpact;
    const intendedImpactDistance = Math.min(
      BLAZE_ROCKET_AIM_DISTANCE,
      this.distance3D(aimOrigin, intendedImpactPosition)
    );
    const aegisHit = this.getChronosAegisSkillHit(player, aimOrigin, lookDirection, intendedImpactDistance, {
      projectileRadius: this.getChronosAegisCollisionRadiusForAttack(attack),
    });
    const impactPosition = aegisHit?.point ?? intendedImpactPosition;
    const aimDirection = this.normalize3D({
      x: impactPosition.x - startPosition.x,
      y: impactPosition.y - startPosition.y,
      z: impactPosition.z - startPosition.z,
    }) ?? lookDirection;
    const travelMs = Math.max(
      60,
      Math.min(3000, (this.distance3D(startPosition, impactPosition) / BLAZE_ROCKET_SPEED) * 1000)
    );

    return {
      castId,
      startPosition,
      impactPosition,
      aimDirection,
      impactTime: now + travelMs,
      aegisHit: aegisHit ?? undefined,
    };
  }

  private fireBlazeRocket(player: Player, attack: AttackConfig, now: number): void {
    const rocket = this.resolveBlazeRocketCast(player, attack, now);
    if (rocket.aegisHit) {
      this.absorbDamageWithChronosAegis(rocket.aegisHit.blocker, attack.damage, now, {
        source: player,
        damageType: attack.damageType,
        position: rocket.aegisHit.point,
        direction: rocket.aegisHit.normal,
      });
    } else {
      this.queuePendingAreaDamage({
        id: rocket.castId,
        ownerId: player.id,
        center: rocket.impactPosition,
        radius: attack.radius ?? BLAZE_ROCKET_SPLASH_RADIUS,
        damage: attack.damage,
        damageType: attack.damageType,
        resolveAt: rocket.impactTime,
      });
    }

    this.broadcastAbilityUsed(player, {
      playerId: player.id,
      abilityId: 'blaze_rocket',
      castId: rocket.castId,
      position: this.vec3SchemaToPlain(player.position),
      startPosition: rocket.startPosition,
      targetPosition: rocket.impactPosition,
      impactPosition: rocket.impactPosition,
      interceptedByChronosAegis: Boolean(rocket.aegisHit),
      aimDirection: rocket.aimDirection,
      velocity: {
        x: rocket.aimDirection.x * BLAZE_ROCKET_SPEED,
        y: rocket.aimDirection.y * BLAZE_ROCKET_SPEED,
        z: rocket.aimDirection.z * BLAZE_ROCKET_SPEED,
      },
      ownerTeam: player.team as Team,
      launchYaw: player.lookYaw,
      serverTime: now,
      impactTime: rocket.impactTime,
      radius: attack.radius ?? BLAZE_ROCKET_SPLASH_RADIUS,
    });
  }

  private getChronosAimOrigin(player: Player): PlainVec3 {
    return getSharedPlayerEyePosition(player.position);
  }

  private resolveChronosVerdantPulseCast(
    player: Player,
    attack: AttackConfig
  ): {
    castId: string;
    startPosition: PlainVec3;
    aimDirection: PlainVec3;
  } {
    const castId = this.nextPhantomCastId(player.id, 'chronos_verdant_pulse');
    const lookDirection = this.getForwardVector(player.lookYaw, player.lookPitch);
    const aimOrigin = this.getChronosAimOrigin(player);
    const socketPosition = this.getAbilitySocketCastOrigin(player, 'chronos_verdant_pulse');
    const terrainHit = this.raycastTerrain(aimOrigin, lookDirection, CHRONOS_VERDANT_PULSE_AIM_DISTANCE);
    const targetHit = this.findTargetHitInAimCone(player, attack.range, attack.coneDot, attack.collisionRadius ?? 0);
    const targetPoint = targetHit?.hit.targetPoint ?? null;
    const terrainDistance = terrainHit ? this.distance3D(aimOrigin, terrainHit) : Infinity;
    const targetDistance = targetPoint ? this.distance3D(aimOrigin, targetPoint) : Infinity;
    const fallbackAimPoint = this.addScaled3D(aimOrigin, lookDirection, CHRONOS_VERDANT_PULSE_AIM_DISTANCE);
    const aimPoint = targetPoint && targetDistance <= terrainDistance
      ? targetPoint
      : terrainHit ?? fallbackAimPoint;
    const aimDirection = this.normalize3D({
      x: aimPoint.x - socketPosition.x,
      y: aimPoint.y - socketPosition.y,
      z: aimPoint.z - socketPosition.z,
    }) ?? lookDirection;

    return {
      castId,
      startPosition: socketPosition,
      aimDirection,
    };
  }

  private broadcastChronosVerdantPulseCast(
    player: Player,
    attack: AttackConfig,
    now: number,
    impactHint: SkillImpactHint = {}
  ): void {
    const pulse = this.resolveChronosVerdantPulseCast(player, attack);
    const supercharged = this.isChronosAscendantActive(player, now);
    const pulseSpeed = supercharged
      ? CHRONOS_ASCENDANT_PARADOX_PULSE_SPEED
      : CHRONOS_VERDANT_PULSE_SPEED;

    this.broadcastAbilityUsed(player, {
      playerId: player.id,
      abilityId: 'chronos_verdant_pulse',
      castId: pulse.castId,
      position: this.vec3SchemaToPlain(player.position),
      startPosition: pulse.startPosition,
      aimDirection: pulse.aimDirection,
      velocity: {
        x: pulse.aimDirection.x * pulseSpeed,
        y: pulse.aimDirection.y * pulseSpeed,
        z: pulse.aimDirection.z * pulseSpeed,
      },
      ownerTeam: player.team as Team,
      impactPosition: impactHint.impactPosition,
      interceptedByChronosAegis: impactHint.interceptedByChronosAegis,
      launchYaw: player.lookYaw,
      serverTime: now,
      radius: supercharged ? CHRONOS_ASCENDANT_PARADOX_PULSE_RADIUS : undefined,
      supercharged,
    });
  }

  private resolveBlazeBombTarget(player: Player): PlainVec3 {
    const aimOrigin = this.getBlazeAimOrigin(player);
    const lookDirection = this.getForwardVector(player.lookYaw, player.lookPitch);
    const terrainHit = this.raycastTerrain(aimOrigin, lookDirection, BLAZE_BOMB_MAX_RANGE);
    let targetPosition = terrainHit ?? this.addScaled3D(aimOrigin, lookDirection, BLAZE_BOMB_MAX_RANGE);

    const horizontalDistance = this.distance2D(aimOrigin, targetPosition);
    if (horizontalDistance < BLAZE_BOMB_MIN_RANGE) {
      const forward = this.forward2D(player.lookYaw);
      targetPosition = {
        x: aimOrigin.x + forward.x * BLAZE_BOMB_MIN_RANGE,
        y: targetPosition.y,
        z: aimOrigin.z + forward.z * BLAZE_BOMB_MIN_RANGE,
      };
    }

    targetPosition = this.clampToPlayableMap(targetPosition);
    const groundY = this.getProceduralGroundY({
      x: targetPosition.x,
      y: Math.max(targetPosition.y + 80, player.position.y + 80),
      z: targetPosition.z,
    });

    return {
      x: targetPosition.x,
      y: groundY ?? targetPosition.y,
      z: targetPosition.z,
    };
  }

  private dropBlazeBomb(player: Player, attack: AttackConfig, now: number): void {
    const castId = this.nextBlazeCastId(player.id, 'blaze_bomb', this.blazeBombIdCounter++);
    const targetPosition = this.resolveBlazeBombTarget(player);
    const startPosition = this.getAbilitySocketCastOrigin(player, 'blaze_bomb');
    const meteorPath = getBlazeMeteorPath({ id: castId, startPosition, targetPosition });
    const aegisHit = this.getChronosAegisSkillHit(
      player,
      meteorPath.entryPosition,
      meteorPath.travelDirection,
      meteorPath.distance,
      { projectileRadius: this.getChronosAegisCollisionRadiusForAttack(attack) }
    );
    const impactProgress = aegisHit
      ? Math.sqrt(this.clamp(aegisHit.distance / Math.max(0.0001, meteorPath.distance), 0, 1))
      : 1;
    const meteorStartTime = now + BLAZE_BOMB_WARNING_LEAD_MS;
    const impactTime = meteorStartTime + Math.max(60, Math.round(BLAZE_BOMB_FALL_DURATION_MS * impactProgress));

    if (aegisHit) {
      this.absorbDamageWithChronosAegis(aegisHit.blocker, attack.damage, now, {
        source: player,
        damageType: attack.damageType,
        position: aegisHit.point,
        direction: aegisHit.normal,
      });
    } else {
      this.queuePendingAreaDamage({
        id: castId,
        ownerId: player.id,
        center: targetPosition,
        radius: attack.radius ?? BLAZE_BOMB_SPLASH_RADIUS,
        damage: attack.damage,
        damageType: attack.damageType,
        resolveAt: impactTime,
      });
    }

    this.broadcastAbilityUsed(player, {
      playerId: player.id,
      abilityId: 'blaze_bomb',
      castId,
      position: this.vec3SchemaToPlain(player.position),
      startPosition,
      targetPosition,
      interceptPosition: aegisHit?.point,
      impactPosition: aegisHit?.point ?? targetPosition,
      interceptedByChronosAegis: Boolean(aegisHit),
      aimDirection: this.getForwardVector(player.lookYaw, player.lookPitch),
      ownerTeam: player.team as Team,
      launchYaw: player.lookYaw,
      serverTime: now,
      meteorStartTime,
      impactTime,
      radius: attack.radius ?? BLAZE_BOMB_SPLASH_RADIUS,
    });
  }

  private broadcastPhantomCast(payload: PhantomCastPayload): void {
    const caster = this.state.players.get(payload.playerId);
    if (!caster) return;
    this.broadcastAbilityUsed(caster, payload as unknown as Record<string, unknown>);
  }

  private broadcastPhantomAttackCast(
    player: Player,
    abilityId: 'phantom_dire_ball' | 'phantom_void_ray',
    now: number,
    impactHint: SkillImpactHint = {}
  ): void {
    const aimDirection = this.getForwardVector(player.lookYaw, player.lookPitch);
    const launchSide = abilityId === 'phantom_dire_ball'
      ? this.getNextPhantomPrimaryLaunchSide(player.id)
      : 1;
    const startPosition = this.getAbilitySocketCastOrigin(player, abilityId, launchSide);
    const magazine = abilityId === 'phantom_dire_ball'
      ? this.getOrCreatePhantomPrimaryMagazine(player)
      : null;

    this.broadcastPhantomCast({
      playerId: player.id,
      abilityId,
      castId: this.nextPhantomCastId(player.id, abilityId),
      position: this.vec3SchemaToPlain(player.position),
      startPosition,
      aimDirection,
      ownerTeam: player.team as Team,
      impactPosition: impactHint.impactPosition,
      interceptedByChronosAegis: impactHint.interceptedByChronosAegis,
      launchSide,
      launchYaw: player.lookYaw,
      serverTime: now,
      ammoRemaining: magazine?.ammo,
      reloadStartedAt: magazine && magazine.reloadUntil > now ? magazine.reloadStartedAt : undefined,
      reloadUntil: magazine && magazine.reloadUntil > now ? magazine.reloadUntil : undefined,
    });
  }

  private broadcastPhantomVoidRayCharge(player: Player, now: number): void {
    const tempoMultiplier = this.getChronosTimebreakTempoMultiplier(player);
    this.broadcastPhantomCast({
      playerId: player.id,
      abilityId: 'phantom_void_ray_charge',
      castId: this.nextPhantomCastId(player.id, 'phantom_void_ray_charge'),
      position: this.vec3SchemaToPlain(player.position),
      startPosition: this.getAbilitySocketCastOrigin(player, 'phantom_void_ray_charge'),
      aimDirection: this.getForwardVector(player.lookYaw, player.lookPitch),
      ownerTeam: player.team as Team,
      launchYaw: player.lookYaw,
      serverTime: now,
      durationMs: VOID_RAY_CHARGE_TIME / tempoMultiplier,
    });
  }

  private broadcastPhantomVoidRayChargeCancel(player: Player, now: number): void {
    this.broadcastPhantomCast({
      playerId: player.id,
      abilityId: 'phantom_void_ray_charge_cancel',
      castId: this.nextPhantomCastId(player.id, 'phantom_void_ray_charge_cancel'),
      position: this.vec3SchemaToPlain(player.position),
      ownerTeam: player.team as Team,
      serverTime: now,
    });
  }

  private broadcastHookshotAttackCast(
    player: Player,
    abilityId: 'hookshot_basic_attack' | 'hookshot_heavy_attack',
    now: number,
    impactHint: SkillImpactHint = {}
  ): void {
    const launchSide = abilityId === 'hookshot_basic_attack'
      ? this.getNextHookshotPrimaryLaunchSide(player.id)
      : 1;
    const maxDistance = abilityId === 'hookshot_basic_attack'
      ? HOOKSHOT_CHAIN_HOOKS_MAX_DISTANCE
      : HOOKSHOT_DRAG_HOOK_MAX_DISTANCE;
    const speed = abilityId === 'hookshot_basic_attack'
      ? HOOKSHOT_SPEED
      : DRAG_HOOK_SPEED;
    const launch = this.resolveHookshotLaunch(player, launchSide, maxDistance, abilityId);

    this.broadcastPhantomCast({
      playerId: player.id,
      abilityId,
      castId: this.nextPhantomCastId(player.id, abilityId),
      position: this.vec3SchemaToPlain(player.position),
      startPosition: launch.startPosition,
      aimDirection: launch.aimDirection,
      velocity: {
        x: launch.aimDirection.x * speed,
        y: launch.aimDirection.y * speed,
        z: launch.aimDirection.z * speed,
      },
      maxDistance,
      ownerTeam: player.team as Team,
      impactPosition: impactHint.impactPosition,
      interceptedByChronosAegis: impactHint.interceptedByChronosAegis,
      targetIds: impactHint.targetIds,
      launchSide,
      launchYaw: player.lookYaw,
      serverTime: now,
    });
  }

  private resolvePhantomBlinkDestination(player: Player, distance: number): PlainVec3 {
    const start = this.vec3SchemaToPlain(player.position);
    return resolveCapsuleTeleportDestination(
      this.getMovementCollisionWorld(),
      start,
      calculateLookDirection(player.lookYaw, player.lookPitch),
      distance,
      { clampPosition: (candidate) => this.clampToPlayableMap(candidate) }
    );
  }

  private handlePhantomSecondaryInput(player: Player, input: PlayerInput, previousSecondaryFire: boolean, now: number): void {
    const wasCharging = this.phantomVoidRayChargeStartedAt.has(player.id);

    if (this.isPhantomPrimaryReloading(player, now)) {
      if (wasCharging && !this.phantomVoidRayResolvedForPress.has(player.id)) {
        this.broadcastPhantomVoidRayChargeCancel(player, now);
      }
      this.phantomVoidRayChargeStartedAt.delete(player.id);
      this.phantomVoidRayResolvedForPress.delete(player.id);
      if (input.secondaryFire && !previousSecondaryFire) {
        this.rejectAbilityOrCombat(player, 'phantom_reload_blocks:phantom_void_ray', false);
      }
      return;
    }

    if (input.secondaryFire && !previousSecondaryFire) {
      const secondaryAttack = SECONDARY_ATTACKS[player.heroId as HeroId];
      const cooldownKey = `${player.id}:secondary`;
      if (!secondaryAttack || now < (this.attackCooldownUntil.get(cooldownKey) || 0)) {
        return;
      }

      this.phantomVoidRayChargeStartedAt.set(player.id, now);
      this.phantomVoidRayResolvedForPress.delete(player.id);
      this.broadcastPhantomVoidRayCharge(player, now);
      return;
    }

    if (!input.secondaryFire) {
      if (wasCharging && !this.phantomVoidRayResolvedForPress.has(player.id)) {
        this.broadcastPhantomVoidRayChargeCancel(player, now);
      }
      this.phantomVoidRayChargeStartedAt.delete(player.id);
      this.phantomVoidRayResolvedForPress.delete(player.id);
      return;
    }

    const chargeStartedAt = this.phantomVoidRayChargeStartedAt.get(player.id);
    if (chargeStartedAt === undefined) return;
    if (this.phantomVoidRayResolvedForPress.has(player.id)) return;
    const tempoMultiplier = this.getChronosTimebreakTempoMultiplier(player);
    if (now - chargeStartedAt < VOID_RAY_CHARGE_TIME / tempoMultiplier) return;

    this.tryResolveAttack(player, 'secondary');
    this.phantomVoidRayResolvedForPress.add(player.id);
  }

  private handleAbilityUse(
    player: Player,
    slot: 'ability1' | 'ability2' | 'ultimate',
    options: { chronosLifelineMode?: ChronosLifelineMode } = {}
  ) {
    if (player.state !== 'alive' || !isHeroId(player.heroId)) {
      this.rejectAbilityOrCombat(player, `invalid_state:${slot}`);
      return;
    }

    const chronosLifelineMode = player.heroId === 'chronos' && slot === 'ability1'
      ? options.chronosLifelineMode
      : undefined;
    const chronosLifelineTargets = chronosLifelineMode === 'allies'
      ? this.getChronosLifelineTargets(player)
      : chronosLifelineMode === 'self'
        ? [player]
      : null;
    const hookshotGrappleTarget = player.heroId === 'hookshot' && slot === 'ability1'
      ? this.resolveHookshotGrappleTarget(player)
      : null;

    if (player.heroId === 'chronos' && slot === 'ability1' && !chronosLifelineMode) {
      this.rejectAbilityOrCombat(player, 'chronos_lifeline_mode_required', false);
      return;
    }
    if (player.heroId === 'chronos' && slot === 'ability1' && (!chronosLifelineTargets || chronosLifelineTargets.length === 0)) {
      this.rejectAbilityOrCombat(player, 'chronos_lifeline_no_targets', false);
      return;
    }
    if (player.heroId === 'hookshot' && slot === 'ability1' && !hookshotGrappleTarget) {
      this.rejectAbilityOrCombat(player, 'hookshot_grapple_no_target', false);
      return;
    }

    const abilityId = HERO_DEFINITIONS[player.heroId as HeroId]?.[slot]?.abilityId;
    const usedAt = Date.now();
    if (
      abilityId &&
      abilityId !== 'phantom_blink' &&
      this.isPhantomPrimaryReloading(player, usedAt)
    ) {
      this.rejectAbilityOrCombat(player, `phantom_reload_blocks:${abilityId}`, false);
      return;
    }
    if (this.isPlayerRooted(player.id, usedAt) && this.isRootBlockedAbility(abilityId)) {
      this.rejectAbilityOrCombat(player, 'rooted_movement_ability_blocked');
      return;
    }

    const result = tryUseAbility(player, slot);
    if (!result.success || !result.abilityId || !result.abilityState || !result.abilityDef) {
      this.rejectAbilityOrCombat(player, `ability_unavailable:${slot}`, false);
      return;
    }

    const startedAt = this.vec3SchemaToPlain(player.position);

    if (result.abilityId === 'chronos_lifeline_conduit' && chronosLifelineTargets && chronosLifelineMode) {
      const releaseAt = usedAt + CHRONOS_LIFELINE_RELEASE_DELAY_MS;
      const healAmount = chronosLifelineMode === 'self'
        ? CHRONOS_LIFELINE_SELF_HEAL
        : CHRONOS_LIFELINE_ALLY_HEAL;
      result.abilityState.activatedAt = usedAt;

      this.broadcastAbilityUsed(player, {
        playerId: player.id,
        abilityId: result.abilityId,
        castId: this.nextPhantomCastId(player.id, result.abilityId),
        position: this.vec3SchemaToPlain(player.position),
        startPosition: this.getAbilitySocketCastOrigin(player, 'chronos_lifeline_conduit'),
        targetIds: chronosLifelineTargets.map((target) => target.id),
        mode: chronosLifelineMode,
        ownerTeam: player.team,
        serverTime: usedAt,
        releaseAt,
      });
      this.scheduleChronosLifelineConduit(
        player.id,
        chronosLifelineTargets.map((target) => target.id),
        healAmount,
        releaseAt
      );
      return;
    } else {
      // Execute ability effect with context for void zone creation
      executeAbility(player, result.abilityId, result.abilityState, result.abilityDef, {
        createVoidZone: (position, ownerId, ownerTeam) => this.createVoidZone(position, ownerId, ownerTeam),
        resolvePhantomBlinkDestination: (caster, distance) => this.resolvePhantomBlinkDestination(caster, distance),
        markAuthoritativePosition: (playerId, _durationMs, reason = 'teleport') => {
          this.markMovementBarrier(playerId, reason, { preserveQueuedCommands: true });
        },
      });
    }

    if (result.abilityId === 'blaze_flamethrower') {
      return;
    }

    if (player.heroId === 'hookshot') {
      const ownerTeam = player.team as Team;
      const castId = this.nextPhantomCastId(player.id, result.abilityId);

      if (result.abilityId === 'hookshot_grapple' && hookshotGrappleTarget) {
        const launchSide = 1;
        const startPosition = this.getAbilitySocketCastOrigin(player, 'hookshot_grapple', launchSide);
        const aimDirection = this.normalize3D({
          x: hookshotGrappleTarget.x - startPosition.x,
          y: hookshotGrappleTarget.y - startPosition.y,
          z: hookshotGrappleTarget.z - startPosition.z,
        }) ?? this.getForwardVector(player.lookYaw, player.lookPitch);
        this.startHookshotGrappleAuthority(
          player,
          castId,
          hookshotGrappleTarget,
          startPosition,
          usedAt
        );

        this.broadcastAbilityUsed(player, {
          playerId: player.id,
          abilityId: result.abilityId,
          castId,
          position: this.vec3SchemaToPlain(player.position),
          startPosition,
          targetPosition: hookshotGrappleTarget,
          direction: {
            yaw: player.lookYaw,
            pitch: player.lookPitch,
          },
          aimDirection,
          ownerTeam,
          launchSide,
          launchYaw: player.lookYaw,
          serverTime: usedAt,
        });
        return;
      }

      if (result.abilityId === 'hookshot_anchor_wall') {
        const wall = this.resolveHookshotAnchorWall(player);
        this.createHookshotAnchorWall({
          id: castId,
          startPosition: wall.startPosition,
          direction: wall.direction,
          startTime: usedAt,
          duration: HOOKSHOT_ANCHOR_WALL_DURATION,
          maxDistance: HOOKSHOT_ANCHOR_WALL_MAX_DISTANCE,
          ownerId: player.id,
          ownerTeam,
        });
        this.broadcastAbilityUsed(player, {
          playerId: player.id,
          abilityId: result.abilityId,
          castId,
          position: this.vec3SchemaToPlain(player.position),
          startPosition: wall.startPosition,
          targetPosition: wall.startPosition,
          direction: wall.direction,
          aimDirection: wall.direction,
          ownerTeam,
          launchYaw: player.lookYaw,
          serverTime: usedAt,
          maxDistance: HOOKSHOT_ANCHOR_WALL_MAX_DISTANCE,
          duration: HOOKSHOT_ANCHOR_WALL_DURATION,
        });
        return;
      }

      if (result.abilityId === 'hookshot_ground_hooks') {
        const rootTargets = this.applyHookshotGroundHooksRoot(player, usedAt);
        const castId = `ground_hooks_${player.id}_${this.hookshotGroundHooksIdCounter++}`;
        const rootUntil = usedAt + HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS * 1000;
        this.broadcastAbilityUsed(player, {
          playerId: player.id,
          abilityId: result.abilityId,
          castId,
          position: this.vec3SchemaToPlain(player.position),
          targetIds: rootTargets.map((target) => target.targetId),
          targets: rootTargets,
          direction: {
            yaw: player.lookYaw,
            pitch: player.lookPitch,
          },
          ownerTeam,
          launchYaw: player.lookYaw,
          serverTime: usedAt,
          radius: HOOKSHOT_GROUND_HOOKS_RADIUS,
          duration: HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS,
          rootUntil,
        });
        return;
      }
    }

    const shockwaveDirection = result.abilityId === 'chronos_timebreak'
      ? this.getForwardVector(player.lookYaw, 0)
      : undefined;
    if (shockwaveDirection) {
      this.scheduleChronosTimebreakShockwave(
        player.id,
        shockwaveDirection,
        result.abilityState.activatedAt || Date.now() + CHRONOS_TIMEBREAK_RELEASE_DELAY_MS
      );
    }

    if (result.abilityId === 'blaze_airstrike') {
      this.createBlazeGearstorm(
        player,
        startedAt,
        usedAt,
        result.abilityDef.duration ?? 5
      );
    }

    const ascendantParadoxVelocity = result.abilityId === 'chronos_ascendant_paradox'
      ? this.vec3SchemaToPlain(player.velocity)
      : undefined;
    const abilityStartPosition = result.abilityId === 'blaze_rocketjump'
      ? this.getAbilitySocketCastOrigin(player, 'blaze_rocketjump')
      : result.abilityId === 'chronos_timebreak'
        ? this.getAbilitySocketCastOrigin(player, 'chronos_timebreak')
        : startedAt;

    // Broadcast ability use
    this.broadcastAbilityUsed(player, {
      playerId: player.id,
      abilityId: result.abilityId,
      castId: this.nextPhantomCastId(player.id, result.abilityId),
      position: { x: player.position.x, y: player.position.y, z: player.position.z },
      startPosition: abilityStartPosition,
      direction: { 
        yaw: player.lookYaw, 
        pitch: player.lookPitch 
      },
      aimDirection: this.getForwardVector(player.lookYaw, player.lookPitch),
      velocity: result.abilityId === 'blaze_rocketjump'
        ? this.vec3SchemaToPlain(player.velocity)
        : ascendantParadoxVelocity
          ? ascendantParadoxVelocity
        : undefined,
      ownerTeam: player.team,
      serverTime: usedAt,
      releaseAt: result.abilityId === 'chronos_timebreak'
        ? result.abilityState.activatedAt
        : undefined,
      radius: result.abilityId === 'chronos_timebreak'
        ? CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE
        : undefined,
      duration: result.abilityId === 'chronos_timebreak'
        ? result.abilityDef.duration
        : result.abilityId === 'chronos_ascendant_paradox'
          ? result.abilityDef.duration
        : undefined,
      durationMs: result.abilityId === 'chronos_ascendant_paradox'
        ? CHRONOS_ASCENDANT_PARADOX_DURATION_MS
        : undefined,
      shockwaveDirection,
    });
  }

  private createBotsFromAssignments(assignments: BotAssignment[]): void {
    assignments.forEach((assignment, index) => {
      const bot = new Player();
      bot.id = assignment.playerId;
      bot.name = assignment.playerName;
      bot.team = assignment.team;
      bot.state = 'selecting';
      bot.isReady = false;
      bot.isBot = true;
      bot.botDifficulty = assignment.botDifficulty || 'normal';
      bot.botProfileId = assignment.botProfileId || '';

      this.placePlayerAtSpawn(bot);

      const preferredHero = assignment.heroId && HERO_DEFINITIONS[assignment.heroId]
        ? assignment.heroId
        : null;
      if (preferredHero) {
        this.preferredBotHeroes.set(bot.id, preferredHero);
        this.setPlayerHero(bot, preferredHero);
      }

      this.state.players.set(bot.id, bot);
      this.knownPlayerIds.add(bot.id);
      this.updateLastSafeMovement(bot, 0);
      this.initializePressState(bot.id);
      this.botBrains.set(bot.id, this.createBotBrain(bot, index));
    });
  }

  private createBotBrain(bot: Player, index = 0): BotBrain {
    const brain = createInitialBotBrain(this.vec3SchemaToPlain(bot.position), index);
    brain.aimYaw = bot.lookYaw;
    brain.aimPitch = bot.lookPitch;
    return brain;
  }

  private initializePressState(playerId: string): void {
    playerPressState.set(playerId, {
      primaryFire: false,
      secondaryFire: false,
      reload: false,
      ability1: false,
      ability2: false,
      ultimate: false,
    });
  }

  private resetPhantomPrimaryMagazine(playerId: string): void {
    this.phantomPrimaryHoldStartedAt.delete(playerId);
    this.phantomPrimaryMagazines.set(playerId, {
      ammo: PHANTOM_PRIMARY_MAGAZINE_SIZE,
      reloadUntil: 0,
      reloadStartedAt: 0,
    });
    const player = this.state.players.get(playerId);
    if (player?.heroId === 'phantom') {
      this.sendPhantomPrimaryState(player, Date.now());
    }
  }

  private getOrCreatePhantomPrimaryMagazine(player: Player): PhantomPrimaryMagazineState {
    let magazine = this.phantomPrimaryMagazines.get(player.id);
    if (!magazine) {
      magazine = {
        ammo: PHANTOM_PRIMARY_MAGAZINE_SIZE,
        reloadUntil: 0,
        reloadStartedAt: 0,
      };
      this.phantomPrimaryMagazines.set(player.id, magazine);
    }

    return magazine;
  }

  private completePhantomPrimaryReloadIfReady(player: Player, now: number): PhantomPrimaryMagazineState {
    const magazine = this.getOrCreatePhantomPrimaryMagazine(player);
    if (magazine.reloadUntil > 0 && now >= magazine.reloadUntil) {
      magazine.ammo = PHANTOM_PRIMARY_MAGAZINE_SIZE;
      magazine.reloadUntil = 0;
      magazine.reloadStartedAt = 0;
      this.sendPhantomPrimaryState(player, now);
    }

    return magazine;
  }

  private isPhantomPrimaryReloading(player: Player, now: number): boolean {
    if (player.heroId !== 'phantom') return false;
    return this.completePhantomPrimaryReloadIfReady(player, now).reloadUntil > now;
  }

  private sendPhantomPrimaryState(player: Player, now: number): void {
    if (player.heroId !== 'phantom' || player.isBot) return;

    const magazine = this.getOrCreatePhantomPrimaryMagazine(player);
    const client = this.clientsBySessionId.get(player.id);
    if (!client) return;
    this.sendTracked(client, 'phantomPrimaryState', {
      ammo: magazine.ammo,
      reloading: magazine.reloadUntil > now,
      reloadStartedAt: magazine.reloadUntil > now ? magazine.reloadStartedAt : 0,
      reloadUntil: magazine.reloadUntil > now ? magazine.reloadUntil : 0,
      serverTime: now,
    });
  }

  private consumePhantomPrimaryShot(player: Player, now: number): boolean {
    if (player.heroId !== 'phantom') return true;

    const magazine = this.completePhantomPrimaryReloadIfReady(player, now);

    if (magazine.reloadUntil > now) {
      this.sendPhantomPrimaryState(player, now);
      return false;
    }

    if (magazine.ammo <= 0) {
      magazine.reloadUntil = now + PHANTOM_PRIMARY_RELOAD_MS;
      magazine.reloadStartedAt = now;
      this.sendPhantomPrimaryState(player, now);
      return false;
    }

    magazine.ammo--;
    if (magazine.ammo === 0) {
      magazine.reloadUntil = now + PHANTOM_PRIMARY_RELOAD_MS;
      magazine.reloadStartedAt = now;
    }

    return true;
  }

  private reloadHeroPrimary(player: Player, now: number): boolean {
    if (player.heroId !== 'phantom') return false;

    const magazine = this.completePhantomPrimaryReloadIfReady(player, now);

    if (magazine.reloadUntil > now) {
      this.sendPhantomPrimaryState(player, now);
      return false;
    }
    if (magazine.ammo >= PHANTOM_PRIMARY_MAGAZINE_SIZE) {
      this.sendPhantomPrimaryState(player, now);
      return false;
    }

    magazine.reloadStartedAt = now;
    magazine.reloadUntil = now + PHANTOM_PRIMARY_RELOAD_MS;
    this.sendPhantomPrimaryState(player, now);
    return true;
  }

  private updatePhantomPrimaryHoldState(
    player: Player,
    input: PlayerInput,
    previous: PlayerPressState,
    now: number
  ): void {
    if (player.heroId !== 'phantom') return;

    if (!input.primaryFire) {
      this.phantomPrimaryHoldStartedAt.delete(player.id);
      return;
    }

    if (!previous.primaryFire || !this.phantomPrimaryHoldStartedAt.has(player.id)) {
      this.phantomPrimaryHoldStartedAt.set(player.id, now);
    }
  }

  private isPhantomPrimaryReady(player: Player, now: number): boolean {
    if (player.heroId !== 'phantom') return true;

    const holdStartedAt = this.phantomPrimaryHoldStartedAt.get(player.id);
    return holdStartedAt !== undefined && now - holdStartedAt >= PHANTOM_PRIMARY_FIRE_READY_MS;
  }

  private updateChronosPrimaryHoldState(
    player: Player,
    input: PlayerInput,
    previous: PlayerPressState,
    now: number
  ): void {
    if (player.heroId !== 'chronos') return;

    if (!input.primaryFire || input.ability1) {
      this.chronosPrimaryHoldStartedAt.delete(player.id);
      return;
    }

    if (!previous.primaryFire || !this.chronosPrimaryHoldStartedAt.has(player.id)) {
      this.chronosPrimaryHoldStartedAt.set(player.id, now);
    }
  }

  private isChronosPrimaryReady(player: Player, now: number): boolean {
    if (player.heroId !== 'chronos') return true;

    const holdStartedAt = this.chronosPrimaryHoldStartedAt.get(player.id);
    return holdStartedAt !== undefined && now - holdStartedAt >= CHRONOS_VERDANT_PULSE_FIRE_READY_MS;
  }

  private processPlayerInput(player: Player, input: PlayerInput): void {
    if (player.state !== 'alive') return;

    const pressState = playerPressState.get(player.id);
    if (!pressState) {
      this.initializePressState(player.id);
    }
    const previous = playerPressState.get(player.id)!;
    const now = Date.now();
    const reloadPressed = Boolean(input.reload);
    this.updatePhantomPrimaryHoldState(player, input, previous, now);
    this.updateChronosPrimaryHoldState(player, input, previous, now);

    if (reloadPressed && !previous.reload) {
      this.reloadHeroPrimary(player, now);
    }
    const chronosLifelineMode: ChronosLifelineMode | null =
      player.heroId === 'chronos' && input.ability1
        ? input.primaryFire
          ? 'allies'
          : input.secondaryFire
            ? 'self'
            : null
        : null;
    const isChronosLifelineCommit = chronosLifelineMode !== null;

    if (isChronosLifelineCommit && !previous.ability1) {
      this.handleAbilityUse(player, 'ability1', { chronosLifelineMode });
    }

    if (input.primaryFire && !isChronosLifelineCommit) {
      this.tryResolveAttack(player, 'primary');
    }
    if (player.heroId === 'phantom') {
      this.handlePhantomSecondaryInput(player, input, previous.secondaryFire, now);
    } else if (player.heroId === 'blaze') {
      if (input.secondaryFire && !previous.secondaryFire) {
        this.blazeBombDropConsumedForHold.delete(player.id);
      }
      if (!input.secondaryFire && previous.secondaryFire) {
        if (this.blazeBombDropConsumedForHold.has(player.id)) {
          this.blazeBombDropConsumedForHold.delete(player.id);
        } else {
          this.tryResolveAttack(player, 'secondary');
        }
      }
    } else if (shouldResolveGenericSecondaryAttack(player.heroId, input, previous.secondaryFire, isChronosLifelineCommit)) {
      this.tryResolveAttack(player, 'secondary');
    }

    if (input.ability1 && !previous.ability1 && !isChronosLifelineCommit) {
      this.handleAbilityUse(player, 'ability1');
    }
    if (input.ability2 && !previous.ability2) {
      this.handleAbilityUse(player, 'ability2');
    }
    if (input.ultimate && !previous.ultimate) {
      this.handleAbilityUse(player, 'ultimate');
    }

    previous.primaryFire = input.primaryFire;
    previous.secondaryFire = input.secondaryFire;
    previous.reload = reloadPressed;
    previous.ability1 = input.ability1;
    previous.ability2 = input.ability2;
    previous.ultimate = input.ultimate;
  }

  private getChronosAegisCollisionRadiusForAttack(attack: AttackConfig): number {
    if (typeof attack.collisionRadius === 'number') {
      return attack.collisionRadius;
    }

    switch (attack.damageType) {
      case 'chain_hooks':
        return HOOKSHOT_CHAIN_HOOKS_COLLISION_RADIUS;
      case 'drag_hook':
        return HOOKSHOT_DRAG_HOOK_COLLISION_RADIUS;
      case 'dire_ball':
        return PHANTOM_DIRE_BALL_COLLISION_RADIUS;
      case 'rocket':
        return BLAZE_ROCKET_COLLISION_RADIUS;
      case 'bomb':
        return BLAZE_BOMB_AEGIS_COLLISION_RADIUS;
      case 'verdant_pulse':
        return CHRONOS_VERDANT_PULSE_COLLISION_RADIUS;
      case 'ascendant_verdant_pulse':
        return CHRONOS_ASCENDANT_PARADOX_PULSE_COLLISION_RADIUS;
      default:
        return 0;
    }
  }

  private tryResolveAttack(player: Player, mode: 'primary' | 'secondary'): void {
    const heroId = player.heroId as HeroId;
    if (!isHeroId(heroId) || player.state !== 'alive') {
      this.rejectAbilityOrCombat(player, `attack_invalid_state:${mode}`);
      return;
    }

    let attack = mode === 'primary' ? PRIMARY_ATTACKS[heroId] : SECONDARY_ATTACKS[heroId];
    if (heroId === 'chronos' && mode === 'primary' && attack && this.isChronosAscendantActive(player)) {
      attack = {
        ...attack,
        damage: CHRONOS_ASCENDANT_PARADOX_PULSE_DAMAGE,
        cooldownMs: CHRONOS_ASCENDANT_PARADOX_PULSE_COOLDOWN_MS,
        radius: CHRONOS_ASCENDANT_PARADOX_PULSE_RADIUS,
        collisionRadius: CHRONOS_ASCENDANT_PARADOX_PULSE_COLLISION_RADIUS,
        range: Math.max(attack.range, 42),
        damageType: 'ascendant_verdant_pulse',
      };
    }
    if (!attack) {
      this.rejectAbilityOrCombat(player, `attack_missing_config:${mode}`);
      return;
    }

    const cooldownKey = `${player.id}:${mode}`;
    const now = Date.now();
    if (now < (this.attackCooldownUntil.get(cooldownKey) || 0)) {
      this.rejectAbilityOrCombat(player, `attack_cooldown:${mode}`, false);
      return;
    }
    if (mode === 'primary' && !this.isPhantomPrimaryReady(player, now)) {
      this.rejectAbilityOrCombat(player, 'phantom_primary_not_ready', false);
      return;
    }
    if (mode === 'primary' && !this.isChronosPrimaryReady(player, now)) {
      this.rejectAbilityOrCombat(player, 'chronos_primary_not_ready', false);
      return;
    }
    if (mode === 'primary' && !this.consumePhantomPrimaryShot(player, now)) {
      this.rejectAbilityOrCombat(player, 'phantom_primary_no_ammo', false);
      return;
    }
    this.attackCooldownUntil.set(cooldownKey, now + attack.cooldownMs);

    const veil = player.abilities.get('phantom_veil');
    if (veil?.isActive) {
      veil.isActive = false;
    }

    if (heroId === 'blaze') {
      if (mode === 'primary') {
        this.fireBlazeRocket(player, attack, now);
      } else {
        this.dropBlazeBomb(player, attack, now);
      }
      return;
    }

    const origin = this.getPlayerEyePosition(player);
    const forward = this.getForwardVector(player.lookYaw, player.lookPitch);
    const primaryTargetHit = this.findTargetHitInAimCone(
      player,
      attack.range,
      attack.coneDot,
      attack.collisionRadius ?? 0,
      attack.targetTeam ?? 'enemy'
    );
    const aegisHit = this.getChronosAegisSkillHit(player, origin, forward, attack.range, {
      projectileRadius: this.getChronosAegisCollisionRadiusForAttack(attack),
    });
    const aegisBlocksAttack = Boolean(aegisHit && (!primaryTargetHit || aegisHit.distance <= primaryTargetHit.hit.distance));
    const impactHint: SkillImpactHint = aegisBlocksAttack && aegisHit
      ? {
        impactPosition: aegisHit.point,
        interceptedByChronosAegis: true,
      }
      : {};

    if (heroId === 'phantom') {
      this.broadcastPhantomAttackCast(
        player,
        mode === 'primary' ? 'phantom_dire_ball' : 'phantom_void_ray',
        now,
        impactHint
      );
    } else if (heroId === 'hookshot') {
      this.broadcastHookshotAttackCast(
        player,
        mode === 'primary' ? 'hookshot_basic_attack' : 'hookshot_heavy_attack',
        now,
        {
          ...impactHint,
          targetIds: mode === 'secondary' && !aegisBlocksAttack && primaryTargetHit?.target
            ? [primaryTargetHit.target.id]
            : undefined,
        }
      );
    } else if (heroId === 'chronos' && mode === 'primary') {
      this.broadcastChronosVerdantPulseCast(player, attack, now, impactHint);
    }

    if (aegisBlocksAttack && aegisHit) {
      this.absorbDamageWithChronosAegis(aegisHit.blocker, attack.damage, now, {
        source: player,
        damageType: attack.damageType,
        position: aegisHit.point,
        direction: aegisHit.normal,
      });
      return;
    }

    const primaryTarget = primaryTargetHit?.target;
    if (!primaryTarget) return;
    this.recordCombatVisibilityAtHit(player, primaryTarget, mode, attack.damageType, now);

    if (attack.radius && attack.radius > 0) {
      this.applyAreaDamage(player, primaryTarget.position, attack.radius, attack.damage, attack.damageType);
    } else {
      this.applyDamage(primaryTarget, attack.damage, player.id, attack.damageType, {
        sourcePosition: origin,
        sourceDirection: forward,
      });
    }

    if (heroId === 'hookshot' && mode === 'secondary') {
      this.startHookshotDragPull(primaryTarget, player, HOOKSHOT_DRAG_HOOK_PULL_FRONT_DISTANCE, now);
    }
  }

  private recordCombatVisibilityAtHit(
    source: Player,
    target: Player,
    mode: 'primary' | 'secondary',
    damageType: string,
    now: number
  ): void {
    if (source.team === target.team) return;

    const interest = this.getRecipientInterest(source, target, now);
    if (interest.state === 'visible') return;

    if (interest.state === 'hidden') {
      this.visibilityInterest.markHiddenTargetLeak();
    }

    const authority = this.getMovementAuthority(source.id);
    const distance = this.distance3D(source.position, target.position);
    this.antiCheat?.record({
      eventType: 'combat.non_visible_target_hit',
      category: 'combat',
      source: 'game_room',
      userId: this.getPlayerUserId(source.id) ?? null,
      playerSessionId: source.id,
      team: source.team,
      heroId: isHeroId(source.heroId) ? source.heroId : null,
      movementEpoch: authority.movementEpoch,
      severity: interest.state === 'hidden' ? 'medium' : 'low',
      confidence: interest.state === 'hidden' ? 0.8 : 0.65,
      reason: `visibility_${interest.state}:${interest.reason}`,
      details: {
        targetPlayerSessionId: target.id,
        targetUserId: this.getPlayerUserId(target.id) ?? null,
        targetTeam: target.team,
        targetHeroId: isHeroId(target.heroId) ? target.heroId : null,
        visibilityState: interest.state,
        visibilityReason: interest.reason,
        visibilityPrecision: interest.precision,
        lastVisibleAt: interest.lastVisibleAt,
        lastKnownPosition: interest.lastKnownPosition,
        distanceMeters: Math.round(distance * 100) / 100,
        attackMode: mode,
        damageType,
      },
      retentionClass: interest.state === 'hidden' ? 'standard' : 'short',
    });
  }

  private handleBlazeBombDrop(client: Client, data: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.state !== 'alive' || player.heroId !== 'blaze') return;
    if (!player.lastInput?.secondaryFire) {
      this.rejectAbilityOrCombat(player, 'blaze_bomb_without_secondary_hold');
      return;
    }
    if (this.blazeBombDropConsumedForHold.has(player.id)) {
      this.rejectAbilityOrCombat(player, 'blaze_bomb_duplicate_hold', false);
      return;
    }

    this.blazeBombDropConsumedForHold.add(player.id);
    const abilityCastHints = isRecord(data)
      ? sanitizeAbilityCastOriginHints(data.abilityCastHints)
      : undefined;
    if (abilityCastHints && player.lastInput) {
      player.lastInput = {
        ...player.lastInput,
        abilityCastHints,
      };
    }
    this.tryResolveAttack(player, 'secondary');
  }

  private cleanupDamageWindows(now: number): void {
    if (this.damageCapWindows.size === 0) return;
    for (const [key, window] of this.damageCapWindows) {
      if (now - window.startedAt >= DAMAGE_CAP_WINDOW_MS * 3) {
        this.damageCapWindows.delete(key);
      }
    }
  }

  private findTargetHitInAimCone(
    source: Player,
    range: number,
    minDot: number,
    extraRadius = 0,
    targetTeam: AttackTargetTeam = 'enemy'
  ): AimTargetHit | null {
    const origin = this.getPlayerEyePosition(source);
    const forward = this.getForwardVector(source.lookYaw, source.lookPitch);
    let bestTargetHit: AimTargetHit | null = null;
    let bestDistance = range;
    const candidateRange = range + extraRadius + PLAYER_RADIUS + PLAYER_COMBAT_HITBOX_PADDING;
    const targetTeamFilter = targetTeam === 'enemy'
      ? (source.team === 'red' ? 'blue' : 'red')
      : undefined;
    const candidates = this.playerSpatialIndex.queryConeCandidates(
      origin,
      candidateRange,
      this.spatialQueryScratch,
      { team: targetTeamFilter, excludeId: source.id }
    );

    for (const target of candidates) {
      if (target.id === source.id) continue;

      const hit = this.getAimConeHitAgainstPlayer(origin, forward, range, minDot, target, extraRadius);
      if (!hit || hit.distance > bestDistance) continue;

      if (hit.distance < bestDistance) {
        bestDistance = hit.distance;
        bestTargetHit = { target, hit };
      }
    }

    return bestTargetHit;
  }

  private getAimConeHitAgainstPlayer(
    origin: PlainVec3,
    forward: PlainVec3,
    range: number,
    minDot: number,
    target: Player,
    extraRadius = 0
  ): NonNullable<ReturnType<typeof getSegmentHitAgainstPlayerCombatHitbox>> | null {
    const hit = this.getAimHitAgainstPlayer(origin, forward, range, target, extraRadius);
    if (!hit) return null;

    const targetCenter = this.getPlayerBodyAimPosition(target);
    const toCenter = {
      x: targetCenter.x - origin.x,
      y: targetCenter.y - origin.y,
      z: targetCenter.z - origin.z,
    };
    const centerDistance = Math.sqrt(toCenter.x * toCenter.x + toCenter.y * toCenter.y + toCenter.z * toCenter.z);
    if (centerDistance <= 0.0001) return null;

    const centerDot = this.clamp(
      (toCenter.x * forward.x + toCenter.y * forward.y + toCenter.z * forward.z) / centerDistance,
      -1,
      1
    );
    const centerAngle = Math.acos(centerDot);
    const coneAngle = Math.acos(this.clamp(minDot, -1, 1));
    const hitboxAngle = Math.atan2(hit.radius, Math.max(hit.distance, hit.radius));
    if (centerAngle > coneAngle + hitboxAngle) return null;
    if (!this.hasLineOfSight(origin, hit.targetPoint)) return null;

    return hit;
  }

  private getAimHitAgainstPlayer(
    origin: PlainVec3,
    direction: PlainVec3,
    range: number,
    target: Player,
    extraRadius = 0
  ) {
    return getSegmentHitAgainstPlayerCombatHitbox(
      origin,
      direction,
      range,
      {
        position: this.vec3SchemaToPlain(target.position),
        heroId: target.heroId,
      },
      extraRadius
    );
  }

  private applyAreaDamage(source: Player, center: { x: number; y: number; z: number }, radius: number, damage: number, damageType: string): void {
    const radiusSq = radius * radius;
    const targets = this.playerSpatialIndex.queryRadius(
      center,
      radius,
      this.spatialQueryScratch,
      { team: source.team === 'red' ? 'blue' : 'red', excludeId: source.id }
    );
    for (const target of targets) {
      if (target.id === source.id) continue;

      const dx = target.position.x - center.x;
      const dy = target.position.y - center.y;
      const dz = target.position.z - center.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > radiusSq) continue;

      const falloff = 1 - Math.sqrt(distSq) / radius * 0.45;
      this.applyDamage(target, Math.max(1, Math.round(damage * falloff)), source.id, damageType, {
        sourcePosition: center,
      });
    }
  }

  private shouldDamageBypassChronosAegis(damageType: string, context: DamageContext): boolean {
    return (
      damageType === 'airstrike' ||
      damageType === 'void_zone' ||
      context.abilityId === 'blaze_airstrike' ||
      context.abilityId === 'phantom_void_zone'
    );
  }

  private getChronosAegisShieldHp(playerId: string): number {
    return this.chronosAegisShieldHp.get(playerId) ?? CHRONOS_AEGIS_SHIELD_MAX_HP;
  }

  private setChronosAegisShieldHp(playerId: string, hp: number): void {
    const clamped = Math.max(0, Math.min(CHRONOS_AEGIS_SHIELD_MAX_HP, hp));
    if (clamped >= CHRONOS_AEGIS_SHIELD_MAX_HP) {
      this.chronosAegisShieldHp.delete(playerId);
    } else {
      this.chronosAegisShieldHp.set(playerId, clamped);
    }
  }

  private getChronosAegisShieldRatio(playerId: string): number {
    return this.getChronosAegisShieldHp(playerId) / CHRONOS_AEGIS_SHIELD_MAX_HP;
  }

  private getChronosAegisShieldByte(player: Player): number {
    if (player.heroId !== 'chronos') return CHRONOS_AEGIS_SHIELD_TRANSFORM_SCALE;
    return Math.round(this.getChronosAegisShieldRatio(player.id) * CHRONOS_AEGIS_SHIELD_TRANSFORM_SCALE);
  }

  private isChronosAegisHeld(player: Player): boolean {
    return (
      player.heroId === 'chronos' &&
      player.state === 'alive' &&
      Boolean(player.lastInput?.secondaryFire) &&
      !player.lastInput?.ability1
    );
  }

  private isChronosAegisActive(player: Player): boolean {
    return this.isChronosAegisHeld(player) && this.getChronosAegisShieldHp(player.id) > 0;
  }

  private getChronosAegisForward(player: Player): PlainVec3 {
    return getSharedChronosAegisForward(player.lookYaw, player.lookPitch);
  }

  private getChronosAegisCenter(player: Player): PlainVec3 {
    return getSharedChronosAegisCenter({
      playerId: player.id,
      position: this.vec3SchemaToPlain(player.position),
      lookYaw: player.lookYaw,
      lookPitch: player.lookPitch,
    });
  }

  private updateChronosAegisShields(dt: number): void {
    const recharge = CHRONOS_AEGIS_SHIELD_RECHARGE_PER_SECOND * dt;
    this.state.players.forEach((player) => {
      if (player.heroId !== 'chronos') {
        this.chronosAegisShieldHp.delete(player.id);
        return;
      }
      if (player.state !== 'alive') {
        this.chronosAegisShieldHp.delete(player.id);
        return;
      }
      if (this.isChronosAegisHeld(player)) return;

      const hp = this.getChronosAegisShieldHp(player.id);
      if (hp < CHRONOS_AEGIS_SHIELD_MAX_HP) {
        this.setChronosAegisShieldHp(player.id, hp + recharge);
      }
    });
  }

  private getChronosAegisSkillHit(
    source: Player,
    start: PlainVec3,
    direction: PlainVec3,
    range: number,
    options: {
      shieldTeam?: Team;
      projectileRadius?: number;
      targetPoint?: PlainVec3;
    } = {}
  ): ChronosAegisSkillHit | null {
    const shieldTeam = options.shieldTeam ?? (source.team === 'red' ? 'blue' : 'red');
    let bestHit: ChronosAegisSkillHit | null = null;
    const aegisCandidates = this.alivePlayersByTeam[shieldTeam];
    const playersToCheck = aegisCandidates.length > 0 ? aegisCandidates : this.state.players.values();

    for (const aegisPlayer of playersToCheck) {
      if (aegisPlayer.team !== shieldTeam) continue;
      if (aegisPlayer.id === source.id) continue;
      if (!this.isChronosAegisActive(aegisPlayer)) continue;

      if (
        options.targetPoint &&
        getSharedChronosAegisForwardDot(
          options.targetPoint,
          {
            playerId: aegisPlayer.id,
            position: this.vec3SchemaToPlain(aegisPlayer.position),
            lookYaw: aegisPlayer.lookYaw,
            lookPitch: aegisPlayer.lookPitch,
          }
        ) > CHRONOS_AEGIS_TARGET_BACK_MAX
      ) {
        continue;
      }

      const hit = getSegmentHitAgainstChronosAegis(
        start,
        direction,
        range,
        {
          playerId: aegisPlayer.id,
          position: this.vec3SchemaToPlain(aegisPlayer.position),
          lookYaw: aegisPlayer.lookYaw,
          lookPitch: aegisPlayer.lookPitch,
        },
        { projectileRadius: options.projectileRadius }
      );
      if (!hit) continue;
      if (bestHit && hit.distance >= bestHit.distance) continue;

      bestHit = {
        blocker: aegisPlayer,
        point: hit.point,
        normal: hit.normal,
        distance: hit.distance,
      };
    }

    return bestHit;
  }

  private getChronosAegisBlockerHit(target: Player, source: Player, sourcePoint = this.getPlayerEyePosition(source)): ChronosAegisSkillHit | null {
    if (source.team === target.team) return null;

    const targetPoint = this.getPlayerBodyAimPosition(target);
    const segment = this.normalize3D({
      x: targetPoint.x - sourcePoint.x,
      y: targetPoint.y - sourcePoint.y,
      z: targetPoint.z - sourcePoint.z,
    });
    if (!segment) return null;

    const hit = this.getChronosAegisSkillHit(source, sourcePoint, segment, this.distance3D(sourcePoint, targetPoint), {
      shieldTeam: target.team as Team,
      targetPoint,
    });
    return hit;
  }

  private absorbDamageWithChronosAegis(
    blocker: Player,
    rawDamage: number,
    now: number,
    context: {
      source?: Player | null;
      damageType?: string;
      position?: PlainVec3;
      direction?: PlainVec3;
    } = {}
  ): number {
    const hp = this.getChronosAegisShieldHp(blocker.id);
    if (hp <= 0) return rawDamage;

    const absorbed = Math.min(hp, Math.max(0, rawDamage));
    const nextHp = hp - absorbed;
    this.setChronosAegisShieldHp(blocker.id, nextHp);
    this.recentCombatTransformUntil.set(blocker.id, now + RECENT_COMBAT_TRANSFORM_MS);
    const direction = context.direction ?? this.getChronosAegisForward(blocker);
    if (absorbed > 0) {
      this.broadcastChronosAegisDamaged(blocker, context.source ?? null, {
        playerId: blocker.id,
        sourceId: context.source?.id ?? null,
        damage: Math.max(1, Math.round(absorbed)),
        damageType: context.damageType ?? 'shield',
        shieldHp: Math.max(0, nextHp),
        shieldRatio: Math.max(0, Math.min(1, nextHp / CHRONOS_AEGIS_SHIELD_MAX_HP)),
        position: context.position ?? this.getChronosAegisCenter(blocker),
        direction,
        serverTime: now,
      });
    }
    if (nextHp <= 0) {
      this.broadcastExactPlayerEvent('chronosAegisBroken', blocker, {
        playerId: blocker.id,
        position: this.getChronosAegisCenter(blocker),
        direction,
        serverTime: now,
      });
    }

    return Math.max(0, rawDamage - absorbed);
  }

  private applyDamage(
    target: Player,
    rawDamage: number,
    sourceId: string | null,
    damageType: string,
    context: DamageContext = {}
  ): boolean {
    if (target.state !== 'alive' || rawDamage <= 0) return false;

    const source = sourceId ? this.state.players.get(sourceId) : null;
    if (source && source.id !== target.id && source.team === target.team) return false;

    const now = Date.now();
    if (target.spawnProtectionUntil && now < target.spawnProtectionUntil) return false;
    if (this.isDevelopmentMode() && this.devImmunePlayers.has(target.id)) {
      return false;
    }

    if (source && !this.consumeDamageBudget(source, target, rawDamage, damageType, now)) {
      this.rejectAbilityOrCombat(source, `damage_cap:${damageType}`);
      return false;
    }

    const sourcePosition = context.sourcePosition !== undefined
      ? context.sourcePosition
      : source
        ? this.vec3SchemaToPlain(source.position)
        : null;
    const sourceDirection = context.sourceDirection !== undefined
      ? context.sourceDirection
      : sourcePosition
        ? this.normalize3D({
          x: target.position.x - sourcePosition.x,
          y: target.position.y - sourcePosition.y,
          z: target.position.z - sourcePosition.z,
        })
        : null;

    let damageToApply = rawDamage;
    const aegisHit = source && !this.shouldDamageBypassChronosAegis(damageType, context)
      ? this.getChronosAegisBlockerHit(target, source, sourcePosition ?? this.getPlayerEyePosition(source))
      : null;
    if (aegisHit) {
      damageToApply = this.absorbDamageWithChronosAegis(aegisHit.blocker, damageToApply, now, {
        source,
        damageType,
        position: aegisHit.point,
        direction: aegisHit.normal,
      });
      if (damageToApply <= 0) {
        return false;
      }
    }

    const phantomShield = target.abilities.get('phantom_personal_shield');
    if (phantomShield?.isActive) {
      deactivateActiveAbility(phantomShield);
      this.broadcastPhantomShieldBroken(target, source ?? null, {
        playerId: target.id,
        position: this.vec3SchemaToPlain(target.position),
        direction: sourceDirection ?? { x: 0, y: 1, z: 0 },
        serverTime: now,
      });
      return false;
    }

    const damage = Math.max(1, Math.round(damageToApply * this.getDamageTakenMultiplier(target)));
    target.health = Math.max(0, target.health - damage);
    this.recentCombatTransformUntil.set(target.id, now + RECENT_COMBAT_TRANSFORM_MS);

    if (source && source.id !== target.id) {
      source.ultimateCharge = Math.min(100, source.ultimateCharge + damage / Math.max(1, target.maxHealth) * 12);
      this.recordDamage(
        target.id,
        source.id,
        damage,
        now,
        damageType,
        sourcePosition,
        sourceDirection
      );
      this.recentCombatTransformUntil.set(source.id, now + RECENT_COMBAT_TRANSFORM_MS);
      this.markRecentCombatInterest(source.id, target.id, now);
    }

    this.broadcastPlayerDamaged(target, source ?? null, {
      targetId: target.id,
      damage,
      sourceId,
      damageType,
      newHealth: target.health,
      sourcePosition,
      targetPosition: this.vec3SchemaToPlain(target.position),
      sourceHeroId: source?.heroId || null,
      targetHeroId: target.heroId || null,
    });

    if (target.health <= 0) {
      this.handlePlayerDeath(target, sourceId || '', {
        abilityId: context.abilityId,
        damageType,
        sourcePosition,
        sourceDirection,
      });
      return true;
    }

    return false;
  }

  private recordDamage(
    targetId: string,
    sourceId: string,
    damage: number,
    timestamp: number,
    damageType: string,
    sourcePosition: PlainVec3 | null,
    sourceDirection: PlainVec3 | null
  ): void {
    let history = this.damageHistory.get(targetId);
    if (!history) {
      history = new Map();
      this.damageHistory.set(targetId, history);
    }
    const existing = history.get(sourceId);
    history.set(sourceId, {
      damage: (existing?.damage || 0) + damage,
      timestamp,
      damageType,
      sourcePosition: sourcePosition ? { ...sourcePosition } : null,
      sourceDirection: sourceDirection ? { ...sourceDirection } : null,
    });
  }

  private consumeDamageBudget(source: Player, target: Player, rawDamage: number, damageType: string, now: number): boolean {
    const key = `${source.id}:${target.id}:${damageType}`;
    const window = this.damageCapWindows.get(key);
    const maxDamage = Math.max(target.maxHealth * DAMAGE_CAP_PER_SOURCE_TARGET_MULTIPLIER, rawDamage + 1);

    if (!window || now - window.startedAt >= DAMAGE_CAP_WINDOW_MS) {
      this.damageCapWindows.set(key, { startedAt: now, damage: rawDamage });
      return rawDamage <= maxDamage;
    }

    const nextDamage = window.damage + rawDamage;
    if (nextDamage > maxDamage) {
      return false;
    }

    window.damage = nextDamage;
    return true;
  }

  private getDamageTakenMultiplier(player: Player): number {
    let multiplier = 1;

    return multiplier;
  }

  private startHookshotDragPull(target: Player, source: Player, distance: number, now: number): void {
    const forward = this.normalizeHorizontalPlain(this.getForwardVector(source.lookYaw, 0));
    if (!forward) return;

    const pull: HookshotDragPullAuthorityState = {
      sourceId: source.id,
      forward: { x: forward.x, y: 0, z: forward.z },
      frontDistance: distance,
      startedAt: now,
      expiresAt: now + HOOKSHOT_DRAG_HOOK_PULL_MAX_DURATION_MS,
    };
    const destination = this.getHookshotDragPullDestination(target, source, pull);
    if (!destination) return;

    const dx = destination.x - target.position.x;
    const dz = destination.z - target.position.z;
    const distanceToDestination = Math.sqrt(dx * dx + dz * dz);
    if (distanceToDestination <= HOOKSHOT_DRAG_HOOK_PULL_STOP_DISTANCE) return;

    this.clearHookshotGrapple(target.id);
    target.velocity.x = (dx / distanceToDestination) * HOOKSHOT_DRAG_HOOK_RETRACT_SPEED;
    target.velocity.z = (dz / distanceToDestination) * HOOKSHOT_DRAG_HOOK_RETRACT_SPEED;
    target.movement.isSliding = false;
    target.movement.slideTimeRemaining = 0;
    target.movement.isWallRunning = false;
    target.movement.wallRunSide = '';

    this.markMovementBarrier(target.id, 'knockback', { preserveQueuedCommands: true });
    this.hookshotDragPulls.set(target.id, pull);
  }

  private getHookshotDragPullDestination(
    target: Player,
    source: Player,
    pull: HookshotDragPullAuthorityState
  ): PlainVec3 | null {
    if (source.state !== 'alive' || target.state !== 'alive') return null;
    return this.clampToPlayableMap({
      x: source.position.x + pull.forward.x * pull.frontDistance,
      y: target.position.y,
      z: source.position.z + pull.forward.z * pull.frontDistance,
    });
  }

  private stopHookshotDragPull(player: Player): void {
    this.hookshotDragPulls.delete(player.id);
    player.velocity.x = 0;
    player.velocity.z = 0;
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
    player.movement.isWallRunning = false;
    player.movement.wallRunSide = '';
    player.movement.isGrappling = false;
  }

  private resolveHookshotDragPullTerrainStep(
    collisionWorld: MovementCollisionWorld,
    startPosition: PlainVec3,
    desiredDelta: PlainVec3,
    destination: PlainVec3
  ): { position: PlainVec3; blocked: boolean } {
    let position = startPosition;
    let remainingDelta = desiredDelta;

    for (let bump = 0; bump < HOOKSHOT_DRAG_HOOK_PULL_BUMP_ITERATIONS; bump++) {
      const remainingDistance = Math.sqrt(
        remainingDelta.x * remainingDelta.x +
        remainingDelta.y * remainingDelta.y +
        remainingDelta.z * remainingDelta.z
      );
      if (remainingDistance <= HOOKSHOT_DRAG_HOOK_PULL_MIN_PROGRESS) {
        return { position, blocked: false };
      }

      const hit = collisionWorld.sweepCapsule(position, remainingDelta, PLAYER_HEIGHT, PLAYER_RADIUS);
      if (!hit) {
        const nextPosition = this.clampToPlayableMap({
          x: position.x + remainingDelta.x,
          y: position.y + remainingDelta.y,
          z: position.z + remainingDelta.z,
        });
        return canCapsuleOccupy(collisionWorld, nextPosition, PLAYER_HEIGHT, PLAYER_RADIUS)
          ? { position: nextPosition, blocked: false }
          : { position, blocked: true };
      }

      const safeTime = Math.max(
        0,
        hit.time - HOOKSHOT_DRAG_HOOK_PULL_BUMP_SKIN / Math.max(remainingDistance, HOOKSHOT_DRAG_HOOK_PULL_BUMP_SKIN)
      );
      const contactPosition = this.clampToPlayableMap({
        x: position.x + remainingDelta.x * safeTime,
        y: position.y + remainingDelta.y * safeTime,
        z: position.z + remainingDelta.z * safeTime,
      });
      if (!canCapsuleOccupy(collisionWorld, contactPosition, PLAYER_HEIGHT, PLAYER_RADIUS)) {
        return { position, blocked: true };
      }

      const distanceBeforeContact = Math.sqrt(
        (destination.x - position.x) * (destination.x - position.x) +
        (destination.z - position.z) * (destination.z - position.z)
      );
      const distanceAfterContact = Math.sqrt(
        (destination.x - contactPosition.x) * (destination.x - contactPosition.x) +
        (destination.z - contactPosition.z) * (destination.z - contactPosition.z)
      );
      const contactProgress = distanceBeforeContact - distanceAfterContact;
      position = contactPosition;

      const remainingScale = 1 - safeTime;
      const postHitDelta = {
        x: remainingDelta.x * remainingScale,
        y: remainingDelta.y * remainingScale,
        z: remainingDelta.z * remainingScale,
      };
      const intoNormal = postHitDelta.x * hit.normal.x +
        postHitDelta.y * hit.normal.y +
        postHitDelta.z * hit.normal.z;
      const slideDelta = {
        x: postHitDelta.x - hit.normal.x * intoNormal,
        y: 0,
        z: postHitDelta.z - hit.normal.z * intoNormal,
      };
      const slideLength = Math.sqrt(slideDelta.x * slideDelta.x + slideDelta.z * slideDelta.z);
      if (slideLength <= HOOKSHOT_DRAG_HOOK_PULL_MIN_PROGRESS) {
        return {
          position,
          blocked: contactProgress < HOOKSHOT_DRAG_HOOK_PULL_MIN_PROGRESS,
        };
      }

      const toDestinationLength = Math.sqrt(
        (destination.x - position.x) * (destination.x - position.x) +
        (destination.z - position.z) * (destination.z - position.z)
      );
      if (toDestinationLength <= HOOKSHOT_DRAG_HOOK_PULL_STOP_DISTANCE) {
        return { position, blocked: false };
      }

      const slideProgress = (
        slideDelta.x * ((destination.x - position.x) / toDestinationLength) +
        slideDelta.z * ((destination.z - position.z) / toDestinationLength)
      );
      if (contactProgress + slideProgress < HOOKSHOT_DRAG_HOOK_PULL_MIN_PROGRESS) {
        return { position, blocked: true };
      }

      remainingDelta = slideDelta;
    }

    return { position, blocked: true };
  }

  private stepHookshotDragPullAuthority(player: Player, dt: number, now: number): boolean {
    const pull = this.hookshotDragPulls.get(player.id);
    if (!pull) return false;

    const source = this.state.players.get(pull.sourceId);
    if (!source || source.state !== 'alive' || player.state !== 'alive' || now >= pull.expiresAt) {
      this.stopHookshotDragPull(player);
      return false;
    }

    const destination = this.getHookshotDragPullDestination(player, source, pull);
    if (!destination) {
      this.stopHookshotDragPull(player);
      return false;
    }

    const currentPosition = this.vec3SchemaToPlain(player.position);
    const dx = destination.x - currentPosition.x;
    const dz = destination.z - currentPosition.z;
    const distanceToDestination = Math.sqrt(dx * dx + dz * dz);
    const collisionWorld = this.getMovementCollisionWorld(now);

    if (distanceToDestination <= HOOKSHOT_DRAG_HOOK_PULL_STOP_DISTANCE) {
      const finalDelta = {
        x: destination.x - currentPosition.x,
        y: destination.y - currentPosition.y,
        z: destination.z - currentPosition.z,
      };
      if (
        canCapsuleOccupy(collisionWorld, destination, PLAYER_HEIGHT, PLAYER_RADIUS) &&
        !collisionWorld.sweepCapsule(currentPosition, finalDelta, PLAYER_HEIGHT, PLAYER_RADIUS)
      ) {
        player.position.x = destination.x;
        player.position.z = destination.z;
      }
      this.stopHookshotDragPull(player);
      return true;
    }

    const stepDistance = Math.min(distanceToDestination, HOOKSHOT_DRAG_HOOK_RETRACT_SPEED * dt);
    const moveScale = stepDistance / distanceToDestination;
    const proposedPosition = this.clampToPlayableMap({
      x: currentPosition.x + dx * moveScale,
      y: currentPosition.y,
      z: currentPosition.z + dz * moveScale,
    });
    const moveDelta = {
      x: proposedPosition.x - currentPosition.x,
      y: proposedPosition.y - currentPosition.y,
      z: proposedPosition.z - currentPosition.z,
    };
    const resolvedStep = this.resolveHookshotDragPullTerrainStep(
      collisionWorld,
      currentPosition,
      moveDelta,
      destination
    );
    const nextPosition = resolvedStep.position;

    const nextPositionOccupiable = canCapsuleOccupy(collisionWorld, nextPosition, PLAYER_HEIGHT, PLAYER_RADIUS);
    if (resolvedStep.blocked || !nextPositionOccupiable) {
      const movedBeforeBlock = nextPositionOccupiable && (
        Math.abs(nextPosition.x - currentPosition.x) > 0.001 ||
        Math.abs(nextPosition.z - currentPosition.z) > 0.001
      );
      if (movedBeforeBlock) {
        player.position.x = nextPosition.x;
        player.position.z = nextPosition.z;
      }
      this.stopHookshotDragPull(player);
      return movedBeforeBlock;
    }

    const movedX = nextPosition.x - currentPosition.x;
    const movedZ = nextPosition.z - currentPosition.z;
    player.position.x = nextPosition.x;
    player.position.z = nextPosition.z;
    player.velocity.x = movedX / dt;
    player.velocity.z = movedZ / dt;
    player.movement.isSprinting = false;
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
    player.movement.isWallRunning = false;
    player.movement.wallRunSide = '';
    player.movement.isGrappling = false;

    if (distanceToDestination - stepDistance <= HOOKSHOT_DRAG_HOOK_PULL_STOP_DISTANCE) {
      this.stopHookshotDragPull(player);
    }

    return true;
  }

  private stepHookshotDragPullWithoutCommand(player: Player, tickTime: number): boolean {
    if (!this.hookshotDragPulls.has(player.id)) return false;

    let moved = false;
    const authority = this.getMovementAuthority(player.id);
    for (let step = 0; step < SERVER_MOVEMENT_SUBSTEPS_PER_TICK; step++) {
      if (!this.hookshotDragPulls.has(player.id)) break;
      const stepNow = tickTime + step * MOVEMENT_SUBSTEP_SECONDS * 1000;
      const input = this.getRootedMovementInput(
        player,
        this.suppressLocomotionInput(player.lastInput ?? this.createEmptyPlayerInput(player, stepNow)),
        stepNow
      );

      this.clearHookshotGrapple(player.id);
      this.simulateAuthoritativeMovementStep(player, input, MOVEMENT_SUBSTEP_SECONDS, stepNow);
      if (this.stepHookshotDragPullAuthority(player, MOVEMENT_SUBSTEP_SECONDS, stepNow)) {
        moved = true;
        this.updateLastSafeMovement(player, authority.lastProcessedSeq, stepNow);
      }
    }

    return moved;
  }

  private scheduleChronosTimebreakShockwave(
    casterId: string,
    castDirection: PlainVec3,
    releaseAt: number
  ): void {
    const delayMs = Math.max(0, releaseAt - Date.now());
    this.scheduleRoomTimeout(() => {
      this.applyChronosTimebreakShockwave(casterId, castDirection);
    }, delayMs);
  }

  private applyChronosTimebreakShockwave(casterId: string, castDirection: PlainVec3): void {
    const caster = this.state.players.get(casterId);
    if (!caster || caster.state !== 'alive') return;
    if (caster.team !== 'red' && caster.team !== 'blue') return;

    const forward = this.normalizeHorizontalPlain(castDirection);
    if (!forward) return;

    const origin = this.vec3SchemaToPlain(caster.position);
    const range = CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE;
    const minForwardDot = Math.cos(CHRONOS_TIMEBREAK_SHOCKWAVE_HALF_ANGLE);
    const maxVerticalDelta = CHRONOS_TIMEBREAK_SHOCKWAVE_MAX_VERTICAL_DELTA;
    const now = Date.now();

    this.state.players.forEach((target) => {
      if (target.id === caster.id) return;
      if (target.state !== 'alive') return;
      if (target.team === caster.team) return;

      const dx = target.position.x - origin.x;
      const dy = target.position.y - origin.y;
      const dz = target.position.z - origin.z;
      if (Math.abs(dy) > maxVerticalDelta) return;

      const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
      if (horizontalDistance > range) return;

      const away = horizontalDistance > 0.001
        ? { x: dx / horizontalDistance, z: dz / horizontalDistance }
        : { x: forward.x, z: forward.z };
      const forwardDot = away.x * forward.x + away.z * forward.z;
      if (forwardDot < minForwardDot) return;

      const falloff = 1 - horizontalDistance / range * 0.35;
      const knockbackSpeed = CHRONOS_TIMEBREAK_SHOCKWAVE_KNOCKBACK_FORCE * falloff;
      const verticalSpeed = CHRONOS_TIMEBREAK_SHOCKWAVE_VERTICAL_FORCE * falloff;
      const currentAwaySpeed = target.velocity.x * away.x + target.velocity.z * away.z;
      const horizontalBoost = Math.max(0, knockbackSpeed - currentAwaySpeed);

      const impulse = {
        x: away.x * horizontalBoost,
        y: Math.max(0, verticalSpeed - target.velocity.y),
        z: away.z * horizontalBoost,
      };
      if (impulse.x === 0 && impulse.y === 0 && impulse.z === 0) return;

      target.velocity.x += impulse.x;
      target.velocity.y += impulse.y;
      target.velocity.z += impulse.z;
      target.movement.isGrounded = false;
      target.movement.isSliding = false;
      target.movement.slideTimeRemaining = 0;
      this.markMovementBarrier(target.id, 'knockback');

      const targetClient = this.clientsBySessionId.get(target.id);
      targetClient?.send('chronosTimebreakImpulse', {
        sourceId: caster.id,
        sourcePosition: origin,
        impulse,
      });
    });
  }

  private normalizeHorizontalPlain(vector: { x: number; z: number }): { x: number; z: number } | null {
    const length = Math.sqrt(vector.x * vector.x + vector.z * vector.z);
    if (length <= 0.0001) return null;
    return {
      x: vector.x / length,
      z: vector.z / length,
    };
  }

  private getActiveSpeedMultiplier(player: Player): number {
    let multiplier = 1;
    if (player.abilities.get('phantom_veil')?.isActive) multiplier *= PHANTOM_VEIL_SPEED_MULTIPLIER;
    if (this.isChronosAscendantActive(player)) {
      multiplier *= CHRONOS_ASCENDANT_PARADOX_SPEED_MULTIPLIER;
    }
    multiplier *= this.getChronosTimebreakTempoMultiplier(player);
    return multiplier;
  }

  private isChronosAscendantActive(player: Player, now = Date.now()): boolean {
    if (player.heroId !== 'chronos' || player.state !== 'alive') return false;

    const ascendant = player.abilities.get('chronos_ascendant_paradox');
    if (!ascendant?.isActive) return false;

    const activatedAt = ascendant.activatedAt || now;
    return now - activatedAt < CHRONOS_ASCENDANT_PARADOX_DURATION_MS;
  }

  private syncChronosAscendantMovementState(player: Player, now = Date.now()): void {
    if (player.heroId !== 'chronos') return;

    const active = this.isChronosAscendantActive(player, now);
    player.movement.isJetpacking = active;
    player.movement.isGliding = active;
    if (!active) {
      player.movement.chronosAscendantStartY = 0;
      return;
    }

    if (!Number.isFinite(player.movement.chronosAscendantStartY)) {
      player.movement.chronosAscendantStartY = player.position.y;
    }
    if (active) {
      player.movement.isGrounded = false;
      player.movement.isSliding = false;
      player.movement.slideTimeRemaining = 0;
    }
  }

  private getChronosTimebreakTempoMultiplier(player: Player): number {
    return 1;
  }

  private updateTimeScaledSkillTimers(
    player: Player,
    dt: number,
    tempoMultiplier: number,
    now: number
  ): void {
    const adjustmentMs = (tempoMultiplier - 1) * Math.max(0, dt) * 1000;
    if (Math.abs(adjustmentMs) <= 0.001) return;

    this.adjustCooldownUntil(`${player.id}:primary`, this.attackCooldownUntil, adjustmentMs, now);
    this.adjustCooldownUntil(`${player.id}:secondary`, this.attackCooldownUntil, adjustmentMs, now);

    const magazine = this.phantomPrimaryMagazines.get(player.id);
    if (magazine?.reloadUntil && magazine.reloadUntil > now) {
      magazine.reloadUntil = Math.max(now, magazine.reloadUntil - adjustmentMs);
      this.sendPhantomPrimaryState(player, now);
    }
  }

  private adjustCooldownUntil(
    key: string,
    cooldowns: Map<string, number>,
    adjustmentMs: number,
    now: number
  ): void {
    const cooldownUntil = cooldowns.get(key);
    if (!cooldownUntil || cooldownUntil <= now) return;

    const nextCooldownUntil = cooldownUntil - adjustmentMs;
    if (nextCooldownUntil <= now) {
      cooldowns.delete(key);
      return;
    }

    cooldowns.set(key, nextCooldownUntil);
  }

  private updateCTFObjectives(now: number): void {
    this.updateCarriedFlagPositions();
    this.checkFlagReturns();

    this.state.players.forEach((player) => {
      if (player.state !== 'alive') return;
      if (!isTeam(player.team)) return;
      if (this.isObjectiveSuppressed(player.id, now)) return;

      const playerTeam = player.team as Team;
      const enemyTeam = playerTeam === 'red' ? 'blue' : 'red';
      const ownFlag = this.getFlagByTeam(playerTeam);
      const enemyFlag = this.getFlagByTeam(enemyTeam);
      const carriedFlagCount = (this.state.redTeam.flag.carrierId === player.id ? 1 : 0)
        + (this.state.blueTeam.flag.carrierId === player.id ? 1 : 0);
      if (player.hasFlag && carriedFlagCount !== 1) {
        player.hasFlag = false;
        this.recordObjectiveEvent(player, 'carrier_mismatch', enemyTeam, now);
        return;
      }

      if (!ownFlag.isAtBase && !ownFlag.carrierId && this.distance2D(player.position, ownFlag.position) <= FLAG_PICKUP_RADIUS) {
        this.returnFlagToBase(playerTeam, player.id);
        player.flagReturns++;
        this.recordMatchFlagReturn(player);
        player.ultimateCharge = Math.min(100, player.ultimateCharge + 10);
        this.recordObjectiveEvent(player, 'return', playerTeam, now);
      }

      if (!player.hasFlag && !enemyFlag.carrierId && this.distance2D(player.position, enemyFlag.position) <= FLAG_PICKUP_RADIUS) {
        enemyFlag.carrierId = player.id;
        enemyFlag.isAtBase = false;
        enemyFlag.droppedAt = 0;
        player.hasFlag = true;
        this.recordObjectiveEvent(player, 'pickup', enemyTeam, now);
        this.broadcastTracked('flagPickup', {
          team: enemyTeam,
          playerId: player.id,
          position: this.getCoarseEventPosition(this.vec3SchemaToPlain(player.position)),
          timestamp: now,
        });
      }

      if (player.hasFlag && ownFlag.isAtBase && this.distance2D(player.position, ownFlag.basePosition) <= FLAG_CAPTURE_RADIUS) {
        this.captureFlag(player, enemyTeam, now);
      }
    });
  }

  private updateCarriedFlagPositions(): void {
    for (const team of ['red', 'blue'] as const) {
      const flag = this.getFlagByTeam(team);
      if (!flag.carrierId) continue;
      const carrier = this.state.players.get(flag.carrierId);
      if (!carrier || carrier.state !== 'alive') {
        flag.carrierId = '';
        continue;
      }
      flag.position.x = carrier.position.x;
      flag.position.y = carrier.position.y + 1.4;
      flag.position.z = carrier.position.z;
    }
  }

  private captureFlag(player: Player, capturedTeam: Team, now: number): void {
    if (!isTeam(player.team) || player.state !== 'alive' || this.isObjectiveSuppressed(player.id, now)) {
      return;
    }

    const flag = this.getFlagByTeam(capturedTeam);
    flag.position.x = flag.basePosition.x;
    flag.position.y = flag.basePosition.y;
    flag.position.z = flag.basePosition.z;
    flag.carrierId = '';
    flag.isAtBase = true;
    flag.droppedAt = 0;

    player.hasFlag = false;
    player.flagCaptures++;
    this.recordMatchFlagCapture(player);
    player.ultimateCharge = Math.min(100, player.ultimateCharge + ULTIMATE_CHARGE_PER_CAPTURE);

    if (player.team === 'red') {
      this.state.redTeam.score++;
    } else {
      this.state.blueTeam.score++;
    }

    this.recordObjectiveEvent(player, 'capture', capturedTeam, now);

    this.broadcastTracked('flagCapture', {
      team: capturedTeam,
      playerId: player.id,
      position: this.getCoarseEventPosition(this.vec3SchemaToPlain(player.position)),
      redScore: this.state.redTeam.score,
      blueScore: this.state.blueTeam.score,
      timestamp: now,
    });

    if (this.state.redTeam.score >= this.config.scoreToWin || this.state.blueTeam.score >= this.config.scoreToWin) {
      this.endRound();
    } else {
      this.returnFlagToBase(capturedTeam, player.id, false);
    }
  }

  private returnFlagToBase(team: Team, playerId = '', broadcast = true): void {
    const flag = this.getFlagByTeam(team);
    flag.position.x = flag.basePosition.x;
    flag.position.y = flag.basePosition.y;
    flag.position.z = flag.basePosition.z;
    flag.carrierId = '';
    flag.isAtBase = true;
    flag.droppedAt = 0;

    if (broadcast) {
      this.broadcastTracked('flagReturn', {
        team,
        playerId,
        position: this.vec3SchemaToPlain(flag.position),
        timestamp: Date.now(),
      });
    }
  }

  private updateBots(now: number, dt: number): void {
    this.urgentBotIdsScratch.length = 0;
    this.deferredBotIdsScratch.length = 0;
    const frameContext = this.buildBotFrameContext(now);

    this.botBrains.forEach((brain, botId) => {
      const bot = this.state.players.get(botId);
      if (!bot?.isBot) {
        this.botBrains.delete(botId);
        return;
      }

      if (this.state.phase === 'hero_select' && bot.state === 'selecting') {
        let changedSelectionState = false;
        if (!bot.heroId) {
          this.setPlayerHero(bot, this.selectRandomBotHero());
          changedSelectionState = true;
        }
        if (!bot.isReady) {
          bot.isReady = true;
          changedSelectionState = true;
        }
        brain.intent = {
          ...brain.intent,
          type: 'selecting',
          score: 0,
          targetPosition: this.vec3SchemaToPlain(bot.position),
          reason: 'hero select',
          candidates: [],
        };
        if (changedSelectionState) {
          this.checkPhaseTransition();
        }
      }

      if (this.state.phase !== 'playing' && this.state.phase !== 'countdown') {
        return;
      }

      if (bot.state !== 'alive') {
        this.devBotSkillOverrides.delete(bot.id);
        this.devBotLookOverrides.delete(bot.id);
        bot.lastInput = this.createEmptyBotInput(bot, now);
        if (bot.state === 'dead') {
          brain.intent = {
            ...brain.intent,
            type: 'respawning',
            score: 0,
            targetPosition: this.vec3SchemaToPlain(bot.position),
            reason: 'bot is dead',
            candidates: [],
          };
        }
        return;
      }

      if (this.devBotsRooted) {
        const skillOverride = this.getActiveDevBotSkillOverride(bot, now);
        const lookOverride = this.getActiveDevBotLookOverride(bot, now);
        if (skillOverride || lookOverride) {
          bot.lastInput = this.applyDevBotLookOverride(
            this.createDevBotSkillInput(bot, now, skillOverride),
            lookOverride
          );
          this.stopBotMovement(bot, { vertical: true });
          this.enqueueServerOwnedMovementCommands(bot, bot.lastInput, now);
        } else {
          this.rootBotMovementAndSkills(bot, now);
        }
        return;
      }

      if (!this.devBotBrainEnabled) {
        const skillOverride = this.getActiveDevBotSkillOverride(bot, now);
        const lookOverride = this.getActiveDevBotLookOverride(bot, now);
        if (skillOverride || lookOverride) {
          bot.lastInput = this.applyDevBotLookOverride(
            this.createDevBotSkillInput(bot, now, skillOverride),
            lookOverride
          );
          this.stopBotMovement(bot, { vertical: false });
        } else {
          this.disableBotBrainInput(bot, now);
        }
        this.enqueueServerOwnedMovementCommands(bot, bot.lastInput ?? this.createEmptyBotInput(bot, now), now);
        return;
      }

      if (this.isPriorityBot(bot, brain, now)) {
        this.urgentBotIdsScratch.push(botId);
      } else {
        this.deferredBotIdsScratch.push(botId);
      }
    });

    for (const botId of this.urgentBotIdsScratch) {
      this.updateScheduledBot(botId, now, dt, frameContext);
    }
    for (const botId of this.deferredBotIdsScratch) {
      this.updateScheduledBot(botId, now, dt, frameContext);
    }
  }

  private isPriorityBot(bot: Player, brain: BotBrain, now: number): boolean {
    if (bot.hasFlag) return true;
    if ((this.recentCombatTransformUntil.get(bot.id) ?? 0) > now) return true;
    if (
      brain.intent.type === 'fight_local_enemy' ||
      brain.intent.type === 'intercept_enemy_carrier' ||
      brain.intent.type === 'escort_allied_carrier' ||
      brain.intent.type === 'return_dropped_friendly_flag' ||
      brain.intent.type === 'carry_flag_home'
    ) {
      return true;
    }
    const target = brain.targetId ? this.state.players.get(brain.targetId) : null;
    return Boolean(target && target.state === 'alive' && target.team !== bot.team);
  }

  private updateScheduledBot(
    botId: string,
    now: number,
    dt: number,
    frameContext: BotFrameContext
  ): void {
    const bot = this.state.players.get(botId);
    const brain = this.botBrains.get(botId);
    if (!bot?.isBot || !brain || bot.state !== 'alive') return;

    const skillOverride = this.getActiveDevBotSkillOverride(bot, now);
    const lookOverride = this.getActiveDevBotLookOverride(bot, now);
    const botInput = this.applyDevBotLookOverride(
      this.applyDevBotSkillOverride(
        bot,
        this.createBotInput(bot, brain, now, dt, frameContext),
        skillOverride
      ),
      lookOverride
    );
    bot.lastInput = botInput;
    this.enqueueServerOwnedMovementCommands(bot, botInput, now);
  }

  private getBotPlayerSnapshot(player: Player): BotPlayerSnapshot | null {
    if (!isTeam(player.team)) return null;

    const abilities: BotPlayerSnapshot['abilities'] = {};
    player.abilities.forEach((ability, abilityId) => {
      abilities[abilityId] = {
        abilityId: ability.abilityId,
        cooldownRemaining: ability.cooldownRemaining,
        charges: ability.charges,
        isActive: ability.isActive,
        activatedAt: ability.activatedAt,
      };
    });

    return {
      id: player.id,
      name: player.name,
      team: player.team,
      heroId: isHeroId(player.heroId) ? player.heroId : '',
      state: player.state,
      isBot: player.isBot,
      botDifficulty: normalizeBotDifficulty(player.botDifficulty),
      botProfileId: player.botProfileId || '',
      position: this.vec3SchemaToPlain(player.position),
      velocity: this.vec3SchemaToPlain(player.velocity),
      lookYaw: player.lookYaw,
      lookPitch: player.lookPitch,
      health: player.health,
      maxHealth: player.maxHealth,
      ultimateCharge: player.ultimateCharge,
      movement: {
        isGrounded: player.movement.isGrounded,
        isSprinting: player.movement.isSprinting,
        isCrouching: player.movement.isCrouching,
        isSliding: player.movement.isSliding,
        isGrappling: player.movement.isGrappling,
        isJetpacking: player.movement.isJetpacking,
        isGliding: player.movement.isGliding,
      },
      abilities,
      hasFlag: player.hasFlag,
      spawnProtectionUntil: player.spawnProtectionUntil,
    };
  }

  private getBotPlayerSnapshots(): BotPlayerSnapshot[] {
    const snapshots: BotPlayerSnapshot[] = [];
    this.state.players.forEach((player) => {
      const snapshot = this.getBotPlayerSnapshot(player);
      if (snapshot) snapshots.push(snapshot);
    });
    snapshots.sort((a, b) => a.id.localeCompare(b.id));
    return snapshots;
  }

  private buildBotFrameContext(now: number): BotFrameContext {
    const snapshots = this.getBotPlayerSnapshots();
    const snapshotById = new Map<string, BotPlayerSnapshot>();
    for (const snapshot of snapshots) {
      snapshotById.set(snapshot.id, snapshot);
    }

    const flags = this.getBotFlagSnapshots();
    const teamTactics = this.refreshBotTeamTactics(now, snapshots, flags);
    const protectedEnemyIdsByTeam: Record<Team, Set<string>> = {
      red: new Set<string>(),
      blue: new Set<string>(),
    };
    this.state.players.forEach((player) => {
      if (!isTeam(player.team) || !this.isProtectedSpawnTarget(player, now)) return;
      const enemyTeam = player.team === 'red' ? 'blue' : 'red';
      protectedEnemyIdsByTeam[enemyTeam].add(player.id);
    });

    return {
      snapshots,
      snapshotById,
      flags,
      teamTactics,
      protectedEnemyIdsByTeam,
      visibleEnemyIdsByBot: new Map(),
      enemyLineOfSightIdsByBot: new Map(),
    };
  }

  private getBotFlagSnapshots(): Record<Team, { team: Team; position: PlainVec3; basePosition: PlainVec3; carrierId: string; isAtBase: boolean; droppedAt: number }> {
    const redFlag = this.getFlagByTeam('red');
    const blueFlag = this.getFlagByTeam('blue');
    return {
      red: {
        team: 'red',
        position: this.vec3SchemaToPlain(redFlag.position),
        basePosition: this.vec3SchemaToPlain(redFlag.basePosition),
        carrierId: redFlag.carrierId,
        isAtBase: redFlag.isAtBase,
        droppedAt: redFlag.droppedAt,
      },
      blue: {
        team: 'blue',
        position: this.vec3SchemaToPlain(blueFlag.position),
        basePosition: this.vec3SchemaToPlain(blueFlag.basePosition),
        carrierId: blueFlag.carrierId,
        isAtBase: blueFlag.isAtBase,
        droppedAt: blueFlag.droppedAt,
      },
    };
  }

  private refreshBotTeamTactics(
    now: number,
    snapshots = this.getBotPlayerSnapshots(),
    flags = this.getBotFlagSnapshots()
  ): BotTeamTacticsByTeam {
    if (this.botTeamTactics && now < this.nextBotTacticsAt) return this.botTeamTactics;
    this.botTacticsRevision++;
    this.botTeamTactics = buildTeamTactics({
      now,
      revision: this.botTacticsRevision,
      players: snapshots,
      flags,
    });
    this.nextBotTacticsAt = now + BOT_TACTICS_INTERVAL_MS;
    return this.botTeamTactics;
  }

  private getBotRecentDamageSources(botId: string, now: number): BotRecentDamageSource[] {
    const history = this.damageHistory.get(botId);
    if (!history) return [];
    const sources: BotRecentDamageSource[] = [];
    for (const [sourceId, entry] of history) {
      if (now - entry.timestamp > DAMAGE_HISTORY_WINDOW_MS) continue;
      sources.push({
        sourceId,
        damage: entry.damage,
        timestamp: entry.timestamp,
        sourcePosition: entry.sourcePosition ? { ...entry.sourcePosition } : null,
        sourceDirection: entry.sourceDirection ? { ...entry.sourceDirection } : null,
        damageType: entry.damageType,
      });
    }
    sources.sort((a, b) => b.timestamp - a.timestamp || b.damage - a.damage);
    return sources;
  }

  private getVisibleEnemyIdsForBot(bot: Player, frameContext: BotFrameContext): Set<string> {
    const cached = frameContext.visibleEnemyIdsByBot.get(bot.id);
    if (cached) return cached;
    const visible = new Set<string>();
    for (const snapshot of frameContext.snapshots) {
      if (snapshot.team === bot.team || snapshot.state !== 'alive') continue;
      const enemy = this.state.players.get(snapshot.id);
      if (!enemy) continue;
      const distance = this.distance3D(bot.position, enemy.position);
      if (this.canBotPerceiveEnemy(bot, enemy, distance)) {
        visible.add(snapshot.id);
      }
    }
    frameContext.visibleEnemyIdsByBot.set(bot.id, visible);
    return visible;
  }

  private getEnemyLineOfSightIdsForBot(bot: Player, frameContext: BotFrameContext): Set<string> {
    const cached = frameContext.enemyLineOfSightIdsByBot.get(bot.id);
    if (cached) return cached;
    const visible = new Set<string>();
    for (const snapshot of frameContext.snapshots) {
      if (snapshot.team === bot.team || snapshot.state !== 'alive') continue;
      const enemy = this.state.players.get(snapshot.id);
      if (enemy && this.hasClearShot(bot, enemy)) {
        visible.add(snapshot.id);
      }
    }
    frameContext.enemyLineOfSightIdsByBot.set(bot.id, visible);
    return visible;
  }

  private isBotPathClear(bot: Player, direction: PlainVec2 | null, distance: number): boolean {
    const normalized = direction ? this.normalize2D(direction) : null;
    if (!normalized) return true;
    const start = this.vec3SchemaToPlain(bot.position);
    const end = {
      x: start.x + normalized.x * distance,
      y: start.y,
      z: start.z + normalized.z * distance,
    };
    return sweepCapsulePathClear(this.getMovementCollisionWorld(), start, end, PLAYER_HEIGHT, PLAYER_RADIUS);
  }

  private getBotSteeringProbes(bot: Player, desiredMove: PlainVec2 | null, skill: BotSkillProfile) {
    const directions = createSteeringProbeDirections(desiredMove);
    return directions.map((probe) => ({
      ...probe,
      clear: this.isBotPathClear(bot, probe.direction, skill.localProbeDistance),
      distance: skill.localProbeDistance,
    }));
  }

  private doesBotShieldLineProtectAlly(bot: Player, blackboard: BotBlackboard): boolean {
    const enemy = blackboard.nearestEnemy;
    const ally = blackboard.alliedCarrier ?? blackboard.nearestAlly;
    if (!enemy || !ally) return false;
    const forward = this.forward2D(bot.lookYaw);
    const toEnemy = this.direction2DFromTo(bot.position, enemy.lastKnownPosition);
    const toAlly = this.direction2DFromTo(bot.position, ally.position);
    if (!toEnemy || !toAlly) return false;
    const enemyInFront = forward.x * toEnemy.x + forward.z * toEnemy.z > 0.42;
    const allyBehind = forward.x * toAlly.x + forward.z * toAlly.z < -0.15;
    return enemyInFront && allyBehind && this.distance2D(bot.position, ally.position) <= 9;
  }

  private wouldBotWallBlockFriendlyCarrier(bot: Player, blackboard: BotBlackboard): boolean {
    const carrier = blackboard.alliedCarrier;
    if (!carrier) return false;
    const forward = this.forward2D(bot.lookYaw);
    const toCarrier = this.direction2DFromTo(bot.position, carrier.position);
    return Boolean(toCarrier && forward.x * toCarrier.x + forward.z * toCarrier.z > 0.35 && this.distance2D(bot.position, carrier.position) <= 7);
  }

  private getBotAbilityGeometry(
    bot: Player,
    blackboard: BotBlackboard,
    routePlan: BotRoutePlan,
    desiredMove: PlainVec2 | null,
    directPathBlocked: boolean
  ): BotAbilityGeometry {
    const forward = this.forward2D(bot.lookYaw);
    const blinkSafe = bot.heroId === 'phantom'
      ? this.isBotPathClear(bot, desiredMove ?? forward, 6.5)
      : true;
    const blinkDangerous = blackboard.visibleEnemies.filter((enemy) => enemy.distance <= 12).length >= 2;
    const grappleAnchorAvailable = bot.heroId === 'hookshot' && this.resolveHookshotGrappleTarget(bot) !== null;
    const objectiveZone = blackboard.droppedFriendlyFlag ?? blackboard.droppedEnemyFlag ?? routePlan.targetPosition;
    const groundHooksValuable = Boolean(
      blackboard.droppedFriendlyFlag ||
      blackboard.droppedEnemyFlag ||
      blackboard.visibleEnemies.some((enemy) => this.distance2D(enemy.lastKnownPosition, objectiveZone) <= 12)
    );

    return {
      directPathBlocked,
      movementProgressBlocked: directPathBlocked || bot.movement.isGrappling || false,
      blinkSafe,
      blinkDangerous,
      grappleAnchorAvailable,
      anchorWallProtectsAlly: this.doesBotShieldLineProtectAlly(bot, blackboard),
      anchorWallBlocksFriendlyCarrier: this.wouldBotWallBlockFriendlyCarrier(bot, blackboard),
      groundHooksValuable,
    };
  }

  private applyBotAbilityPlan(
    bot: Player,
    input: PlayerInput,
    brain: BotBrain,
    plan: BotAbilityPlan,
    skill: BotSkillProfile,
    now: number,
    tempoMultiplier: number
  ): void {
    if (brain.pendingSecondaryMode) {
      if (now < brain.secondaryHoldUntil) {
        input.secondaryFire = true;
        input.primaryFire = false;
        return;
      }
      brain.pendingSecondaryMode = '';
      brain.secondaryHoldUntil = 0;
      input.secondaryFire = false;
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
        input.ability1 = true;
        input.primaryFire = true;
        input.secondaryFire = false;
        break;
      case 'chronos_lifeline_self':
        input.ability1 = true;
        input.primaryFire = false;
        input.secondaryFire = true;
        break;
      case 'chronos_aegis':
        input.secondaryFire = true;
        input.primaryFire = false;
        return;
      case 'blaze_flamethrower':
        input.ability1 = true;
        input.primaryFire = false;
        break;
      case 'blaze_bomb':
        if (now < brain.nextSecondaryAt) return;
        input.secondaryFire = true;
        input.primaryFire = false;
        brain.pendingSecondaryMode = plan.mode;
        brain.secondaryHoldUntil = now + (plan.holdMs ?? 120);
        brain.nextSecondaryAt = now + this.randomBetween(900, 1450) / tempoMultiplier;
        return;
      default:
        if (plan.slot === 'ability1') input.ability1 = true;
        if (plan.slot === 'ability2') input.ability2 = true;
        if (plan.slot === 'ultimate') input.ultimate = true;
        if (plan.slot) input.primaryFire = false;
        break;
    }

    if (plan.slot === 'ultimate') {
      brain.nextUltimateAt = now + this.randomBetween(skill.ultimateCadenceMs[0], skill.ultimateCadenceMs[1]) / tempoMultiplier;
    } else if (plan.slot !== 'secondary' && plan.mode !== 'blaze_flamethrower') {
      brain.nextAbilityAt = now + this.randomBetween(skill.abilityCadenceMs[0], skill.abilityCadenceMs[1]) / tempoMultiplier;
    }
  }

  private createBotInput(
    bot: Player,
    brain: BotBrain,
    now: number,
    dt: number,
    frameContext: BotFrameContext
  ): PlayerInput {
    const skill = getBotSkillProfile(bot.botDifficulty);
    const snapshots = frameContext.snapshots;
    const botSnapshot = frameContext.snapshotById.get(bot.id) ?? this.getBotPlayerSnapshot(bot);
    if (!botSnapshot) return this.createEmptyBotInput(bot, now);

    const tactics = frameContext.teamTactics[botSnapshot.team];
    if (!tactics) return this.createEmptyBotInput(bot, now);

    clearExpiredBlockedEdges(brain.blockedEdges, now);
    const shouldRefreshBlackboard = !brain.blackboard || now >= brain.nextBlackboardAt || now >= brain.nextThinkAt;
    const blackboard = shouldRefreshBlackboard
      ? buildBotBlackboard({
        now,
        bot: botSnapshot,
        players: snapshots,
        flags: frameContext.flags,
        visibleEnemyIds: this.getVisibleEnemyIdsForBot(bot, frameContext),
        enemyLineOfSightIds: this.getEnemyLineOfSightIdsForBot(bot, frameContext),
        recentDamageSources: this.getBotRecentDamageSources(bot.id, now),
        teamTactics: tactics,
        enemyMemory: brain.enemyMemory,
        skill,
      })
      : brain.blackboard!;
    if (shouldRefreshBlackboard) {
      brain.blackboard = blackboard;
      brain.nextBlackboardAt = now + Math.max(80, skill.thinkIntervalMs * 0.75);
    }

    const shouldThink = now >= brain.nextThinkAt;
    if (shouldThink) {
      brain.intent = scoreBotIntents(botSnapshot, blackboard, skill);
      brain.routePlan = planBotRoute({
        now,
        bot: botSnapshot,
        intent: brain.intent,
        blackboard,
        routeGraph: this.botRouteGraph,
        blockedEdges: brain.blockedEdges,
        skill,
        previousPlan: brain.routePlan,
      });
      brain.nextThinkAt = now + this.randomBetween(skill.thinkIntervalMs * 0.75, skill.thinkIntervalMs * 1.25);

      if (now >= brain.strafeUntil) {
        brain.strafeDirection = this.hashString(`${bot.id}:${Math.floor(now / 1000)}`) % 2 === 0 ? -1 : 1;
        brain.strafeUntil = now + this.randomBetween(900, 2600);
      }
    }

    if (!brain.routePlan || now - brain.routePlan.plannedAt > skill.replanIntervalMs * 2) {
      brain.routePlan = planBotRoute({
        now,
        bot: botSnapshot,
        intent: brain.intent,
        blackboard,
        routeGraph: this.botRouteGraph,
        blockedEdges: brain.blockedEdges,
        skill,
        previousPlan: brain.routePlan,
      });
    }

    const routePlan = brain.routePlan;
    const combatPlan = chooseBotCombatPlan({
      bot: botSnapshot,
      intent: brain.intent,
      blackboard,
      skill,
      primaryRange: this.getBotAttackRange(bot),
      preferredRange: getBotPreferredCombatRange(botSnapshot.heroId),
      protectedEnemyIds: frameContext.protectedEnemyIdsByTeam[botSnapshot.team],
    });
    const combatTarget = combatPlan.targetId ? this.state.players.get(combatPlan.targetId) ?? null : null;
    const combatTargetSnapshot = combatPlan.targetId
      ? frameContext.snapshotById.get(combatPlan.targetId) ?? null
      : null;
    brain.targetId = combatTarget?.id || '';

    const aimPoint = combatTarget
      ? this.getBotAimPoint(bot, combatTarget, skill)
      : routePlan.steeringTarget || brain.intent.targetPosition || this.getEnemyFlagPosition(bot.team as Team);
    const desiredAim = this.getYawPitchTowardPosition(bot, aimPoint);
    const aim = this.updateBotAim(bot, brain, desiredAim, combatTarget, skill, now, dt);
    const enemyDistance = combatTarget ? this.distance3D(bot.position, combatTarget.position) : Infinity;
    const attackRange = this.getBotAttackRange(bot);
    const shouldFight = Boolean(
      combatTarget
      && enemyDistance <= attackRange
      && this.hasClearShot(bot, combatTarget)
      && !this.isProtectedSpawnTarget(combatTarget, now)
    );
    const aimReady = Boolean(
      shouldFight
      && combatTarget
      && this.isBotAimReady(bot, combatTarget, PRIMARY_ATTACKS[bot.heroId as HeroId], skill, aim.yaw, aim.pitch)
    );
    const desiredMove = composeBotMovementDirection(
      botSnapshot,
      brain,
      brain.intent,
      routePlan,
      combatTargetSnapshot,
      blackboard,
      skill
    );
    const probes = this.getBotSteeringProbes(bot, desiredMove, skill);
    const steering = chooseLocalAvoidanceDirection(desiredMove, probes, skill);
    const progress = updateBotMovementProgress(
      brain.movementProgress,
      now,
      botSnapshot.position,
      routePlan.steeringTarget,
      routePlan.activeEdgeId,
      desiredMove,
      steering.blocked,
      skill
    );
    if (progress.markBlockedEdgeId) {
      brain.blockedEdges.set(progress.markBlockedEdgeId, now + skill.blockedEdgeTtlMs);
      brain.routePlan = planBotRoute({
        now,
        bot: botSnapshot,
        intent: brain.intent,
        blackboard,
        routeGraph: this.botRouteGraph,
        blockedEdges: brain.blockedEdges,
        skill,
        previousPlan: brain.routePlan,
      });
    }
    if (progress.stalled && steering.blocked) {
      brain.reverseUntil = now + this.randomBetween(220, 420);
    }

    const tempoMultiplier = this.getChronosTimebreakTempoMultiplier(bot);
    const input = this.createEmptyBotInput(bot, now);
    input.lookYaw = aim.yaw;
    input.lookPitch = combatTarget ? aim.pitch : 0;
    this.applyBotMovementInput(input, input.lookYaw, steering.direction, now < brain.reverseUntil, brain);
    input.sprint = this.distance2D(bot.position, routePlan.steeringTarget) > 9
      || bot.hasFlag
      || (brain.intent.type !== 'fight_local_enemy' && brain.intent.type !== 'defend_base');
    input.jump = steering.jump || (progress.stalled && bot.movement.isGrounded);
    input.crouch = input.sprint && this.distance2D(bot.position, routePlan.steeringTarget) > 14 && !combatTarget && this.hashString(`${bot.id}:${Math.floor(now / 500)}`) % 11 === 0;
    input.crouchPressed = input.crouch && !bot.lastInput?.crouch;

    if (now >= brain.nextFireDecisionAt) {
      brain.nextFireDecisionAt = now + this.randomBetween(skill.fireDecisionMs[0], skill.fireDecisionMs[1]) / tempoMultiplier;
      if (aimReady && Math.random() < skill.fireChance) {
        brain.fireUntil = now + this.randomBetween(skill.burstDurationMs[0], skill.burstDurationMs[1]) / tempoMultiplier;
      }
    }
    input.primaryFire = aimReady && now < brain.fireUntil;

    const secondaryAttack = SECONDARY_ATTACKS[bot.heroId as HeroId];
    if (
      shouldFight
      && combatTarget
      && bot.heroId !== 'blaze'
      && secondaryAttack
      && enemyDistance <= secondaryAttack.range
      && this.isBotAimReady(bot, combatTarget, secondaryAttack, skill, aim.yaw, aim.pitch)
      && now >= brain.nextSecondaryAt
    ) {
      const firedSecondary = Math.random() < skill.secondaryChance;
      input.secondaryFire = firedSecondary;
      const secondaryDelayMs = firedSecondary
        ? this.randomBetween(secondaryAttack.cooldownMs * 0.85, secondaryAttack.cooldownMs * 1.3)
        : this.randomBetween(350, 900);
      brain.nextSecondaryAt = now + secondaryDelayMs / tempoMultiplier;
    }

    const directPathBlocked = probes.find((probe) => probe.label === 'direct')?.clear === false;
    const abilityPlan = chooseBotAbilityPlan({
      now,
      bot: botSnapshot,
      intent: brain.intent,
      blackboard,
      combatPlan,
      skill,
      geometry: this.getBotAbilityGeometry(bot, blackboard, routePlan, desiredMove, directPathBlocked),
    });
    this.applyBotAbilityPlan(bot, input, brain, abilityPlan, skill, now, tempoMultiplier);

    if (dt <= 0) {
      input.moveForward = false;
      input.moveBackward = false;
      input.moveLeft = false;
      input.moveRight = false;
    }

    return input;
  }

  private getEnemyFlagPosition(team: Team): { x: number; y: number; z: number } {
    const enemyTeam = team === 'red' ? 'blue' : 'red';
    return this.vec3SchemaToPlain(this.getFlagByTeam(enemyTeam).position);
  }

  private getBotAttackRange(bot: Player): number {
    const heroId = bot.heroId as HeroId;
    return PRIMARY_ATTACKS[heroId]?.range ?? 18;
  }

  private canBotPerceiveEnemy(bot: Player, enemy: Player, distance: number): boolean {
    if (distance > BOT_AWARENESS_RANGE && !enemy.hasFlag) return false;

    const veil = enemy.abilities.get('phantom_veil');
    if (veil?.isActive && !enemy.hasFlag && distance > BOT_CLOSE_REVEAL_RANGE) {
      return false;
    }

    if (distance <= 18 || enemy.hasFlag) return true;
    return this.hasClearShot(bot, enemy);
  }

  private getBotAimPoint(bot: Player, target: Player, skill: BotSkillProfile): PlainVec3 {
    const targetDistance = this.distance3D(bot.position, target.position);
    const reactionLag = skill.reactionMs / 1000;
    const leadSeconds = Math.max(-0.22, Math.min(0.42, skill.aimLeadSeconds + targetDistance / 160 - reactionLag * 0.45));
    const targetPoint = this.getPlayerBodyAimPosition(target);

    return {
      x: targetPoint.x + target.velocity.x * leadSeconds,
      y: targetPoint.y + target.velocity.y * leadSeconds,
      z: targetPoint.z + target.velocity.z * leadSeconds,
    };
  }

  private updateBotAim(
    bot: Player,
    brain: BotBrain,
    desiredAim: { yaw: number; pitch: number },
    target: Player | null,
    skill: BotSkillProfile,
    now: number,
    dt: number
  ): { yaw: number; pitch: number } {
    if (!Number.isFinite(brain.aimYaw)) brain.aimYaw = bot.lookYaw;
    if (!Number.isFinite(brain.aimPitch)) brain.aimPitch = bot.lookPitch;

    if (target && now >= brain.nextAimJitterAt) {
      const distance = this.distance3D(bot.position, target.position);
      const distanceScale = Math.max(0.55, Math.min(1.35, distance / 24));
      brain.aimJitterYaw = this.randomSigned(skill.aimErrorRadians * distanceScale);
      brain.aimJitterPitch = this.randomSigned(skill.aimErrorRadians * 0.55 * distanceScale);
      brain.nextAimJitterAt = now + this.randomBetween(skill.aimJitterRefreshMs[0], skill.aimJitterRefreshMs[1]);
    } else if (!target) {
      brain.aimJitterYaw *= 0.82;
      brain.aimJitterPitch *= 0.82;
    }

    const targetYaw = this.normalizeAngle(desiredAim.yaw + brain.aimJitterYaw);
    const targetPitch = this.clamp(desiredAim.pitch + brain.aimJitterPitch, -0.8, 0.8);
    const maxStep = skill.turnRateRadians * Math.max(0.016, Math.min(0.1, dt));

    brain.aimYaw = this.rotateAngleToward(brain.aimYaw, targetYaw, maxStep);
    const pitchDelta = this.clamp(targetPitch - brain.aimPitch, -maxStep, maxStep);
    brain.aimPitch = this.clamp(brain.aimPitch + pitchDelta, -0.8, 0.8);

    return { yaw: brain.aimYaw, pitch: brain.aimPitch };
  }

  private isBotAimReady(
    bot: Player,
    target: Player,
    attack: AttackConfig | undefined,
    skill: BotSkillProfile,
    yaw: number,
    pitch: number
  ): boolean {
    if (!attack) return false;

    const origin = this.getPlayerEyePosition(bot);
    const forward = this.getForwardVector(yaw, pitch);
    const readinessPadding = Math.max(0, skill.aimFireToleranceScale - 1) * PLAYER_COMBAT_HITBOX_PADDING;
    return this.getAimHitAgainstPlayer(
      origin,
      forward,
      attack.range,
      target,
      readinessPadding + (attack.collisionRadius ?? 0)
    ) !== null;
  }

  private applyBotMovementInput(
    input: PlayerInput,
    lookYaw: number,
    desiredMove: PlainVec2 | null,
    recovering: boolean,
    brain: BotBrain
  ): void {
    input.moveForward = false;
    input.moveBackward = false;
    input.moveLeft = false;
    input.moveRight = false;

    if (recovering) {
      input.moveBackward = true;
      input.moveLeft = brain.strafeDirection < 0;
      input.moveRight = brain.strafeDirection > 0;
      return;
    }

    if (!desiredMove) return;

    const local = this.worldDirectionToLocalMove(desiredMove, lookYaw);
    const threshold = 0.22;
    input.moveForward = local.z < -threshold;
    input.moveBackward = local.z > threshold;
    input.moveLeft = local.x < -threshold;
    input.moveRight = local.x > threshold;

    if (!input.moveForward && !input.moveBackward && !input.moveLeft && !input.moveRight) {
      if (Math.abs(local.x) > Math.abs(local.z)) {
        input.moveLeft = local.x < 0;
        input.moveRight = local.x >= 0;
      } else {
        input.moveForward = local.z <= 0;
        input.moveBackward = local.z > 0;
      }
    }
  }

  private getYawPitchTowardPosition(source: Player, targetPosition: PlainVec3): { yaw: number; pitch: number } {
    const sourceEye = this.getPlayerEyePosition(source);
    const dx = targetPosition.x - sourceEye.x;
    const dy = targetPosition.y - sourceEye.y;
    const dz = targetPosition.z - sourceEye.z;
    const horizontal = Math.sqrt(dx * dx + dz * dz);
    return {
      yaw: Math.atan2(-dx, -dz),
      pitch: this.clamp(Math.atan2(dy, horizontal), -0.8, 0.8),
    };
  }

  private getYawPitchToward(source: Player, target: Player | { x: number; y: number; z: number }): { yaw: number; pitch: number } {
    const targetPosition = 'position' in target ? this.getPlayerBodyAimPosition(target) : target;
    return this.getYawPitchTowardPosition(source, {
      x: targetPosition.x,
      y: targetPosition.y,
      z: targetPosition.z,
    });
  }

  private hasClearShot(source: Player, target: Player): boolean {
    return this.hasLineOfSight(this.getPlayerEyePosition(source), this.getPlayerBodyAimPosition(target));
  }

  private getLineOfSightCacheKey(start: PlainVec3, end: PlainVec3): string {
    const q = (value: number) => Math.round(value * 2);
    return `${q(start.x)}:${q(start.y)}:${q(start.z)}>${q(end.x)}:${q(end.y)}:${q(end.z)}`;
  }

  private hasLineOfSight(start: PlainVec3, end: PlainVec3): boolean {
    const now = this.state.serverTime || Date.now();
    const cacheKey = this.getLineOfSightCacheKey(start, end);
    const cached = this.losCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.result;
    }

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const steps = Math.max(1, Math.ceil(distance / BOT_LOS_SAMPLE_STEP));

    let result = true;
    const samplePoint = this.lineOfSightSamplePoint;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      samplePoint.x = start.x + dx * t;
      samplePoint.y = start.y + dy * t;
      samplePoint.z = start.z + dz * t;
      if (isCollisionBlock(this.getBlockAtWorld(samplePoint))) {
        result = false;
        break;
      }
    }

    if (this.losCache.size > 1500) {
      this.losCache.clear();
    }
    this.losCache.set(cacheKey, {
      result,
      expiresAt: now + LOS_CACHE_TTL_MS,
    });
    return result;
  }

  private getPlayerEyePosition(player: Player): PlainVec3 {
    return getSharedPlayerEyePosition(player.position);
  }

  private getPlayerBodyAimPosition(player: Player): PlainVec3 {
    return getSharedPlayerBodyAimPosition({
      position: this.vec3SchemaToPlain(player.position),
      heroId: player.heroId,
    });
  }

  private getForwardVector(yaw: number, pitch: number): PlainVec3 {
    const cosPitch = Math.cos(pitch);
    return {
      x: -Math.sin(yaw) * cosPitch,
      y: Math.sin(pitch),
      z: -Math.cos(yaw) * cosPitch,
    };
  }

  private isProtectedSpawnTarget(target: Player, now: number): boolean {
    return Boolean(target.spawnProtectionUntil && now < target.spawnProtectionUntil);
  }

  private direction2DFromTo(from: { x: number; z: number }, to: { x: number; z: number }): PlainVec2 | null {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    if (length <= 0.001) return null;
    return { x: dx / length, z: dz / length };
  }

  private forward2D(yaw: number): PlainVec2 {
    return {
      x: -Math.sin(yaw),
      z: -Math.cos(yaw),
    };
  }

  private normalize2D(vector: PlainVec2): PlainVec2 | null {
    const length = Math.sqrt(vector.x * vector.x + vector.z * vector.z);
    if (length <= 0.001) return null;
    return { x: vector.x / length, z: vector.z / length };
  }

  private mix2D(a: PlainVec2, aWeight: number, b: PlainVec2, bWeight: number): PlainVec2 {
    return {
      x: a.x * aWeight + b.x * bWeight,
      z: a.z * aWeight + b.z * bWeight,
    };
  }

  private worldDirectionToLocalMove(direction: PlainVec2, lookYaw: number): PlainVec2 {
    const cos = Math.cos(lookYaw);
    const sin = Math.sin(lookYaw);
    return {
      x: direction.x * cos - direction.z * sin,
      z: direction.x * sin + direction.z * cos,
    };
  }

  private rotateAngleToward(current: number, target: number, maxStep: number): number {
    const delta = this.normalizeAngle(target - current);
    if (Math.abs(delta) <= maxStep) return this.normalizeAngle(target);
    return this.normalizeAngle(current + Math.sign(delta) * maxStep);
  }

  private normalizeAngle(angle: number): number {
    let normalized = angle;
    while (normalized > Math.PI) normalized -= Math.PI * 2;
    while (normalized < -Math.PI) normalized += Math.PI * 2;
    return normalized;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  private randomSigned(amount: number): number {
    return (Math.random() * 2 - 1) * amount;
  }

  private hashString(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  private createEmptyPlayerInput(player: Player, now: number): PlayerInput {
    return {
      tick: this.state.tick,
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
      lookYaw: player.lookYaw,
      lookPitch: player.lookPitch,
      timestamp: now,
    };
  }

  private createEmptyBotInput(bot: Player, now: number): PlayerInput {
    return this.createEmptyPlayerInput(bot, now);
  }

  private stopBotMovement(bot: Player, options: { vertical: boolean }): void {
    bot.velocity.x = 0;
    if (options.vertical) {
      bot.velocity.y = 0;
    }
    bot.velocity.z = 0;
    bot.movement.isSprinting = false;
    bot.movement.isCrouching = false;
    bot.movement.isWallRunning = false;
    bot.movement.wallRunSide = '';
  }

  private resetPlayerMovementRuntime(player: Player): void {
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    player.movement.isGrounded = true;
    player.movement.isSprinting = false;
    player.movement.isCrouching = false;
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
    player.movement.isWallRunning = false;
    player.movement.wallRunSide = '';
    player.movement.isGrappling = false;
    player.movement.isJetpacking = false;
    player.movement.isGliding = false;
    player.movement.chronosAscendantStartY = 0;
  }

  private resetPlayerLifeRuntime(player: Player, now = Date.now()): void {
    this.disablePlayerSkills(player);
    this.resetPlayerPressState(player.id);
    this.resetPlayerMovementRuntime(player);
    this.blazeBurnEffects.delete(player.id);
    this.clearFlamethrowerDamageTicksForPlayer(player.id);
    this.blazeBombDropConsumedForHold.delete(player.id);
    this.playerRootedUntil.delete(player.id);
    this.clearHookshotDragPullsInvolving(player.id);
    this.attackCooldownUntil.delete(`${player.id}:primary`);
    this.attackCooldownUntil.delete(`${player.id}:secondary`);
    player.lastInput = player.isBot
      ? this.createEmptyBotInput(player, now)
      : null;
  }

  private getActiveDevBotSkillOverride(bot: Player, now: number): DevBotSkillOverride | null {
    const override = this.devBotSkillOverrides.get(bot.id);
    if (!override) return null;
    if (now < override.expiresAt) return override;

    this.finishDevBotSkillOverride(bot, override);
    return null;
  }

  private finishDevBotSkillOverride(bot: Player, override: DevBotSkillOverride): void {
    this.devBotSkillOverrides.delete(bot.id);

    if (
      bot.heroId === 'blaze' &&
      override.slot === 'secondary' &&
      playerPressState.get(bot.id)?.secondaryFire &&
      !this.blazeBombDropConsumedForHold.has(bot.id)
    ) {
      this.tryResolveAttack(bot, 'secondary');
    }

    this.blazeBombDropConsumedForHold.delete(bot.id);
    this.resetPlayerPressState(bot.id);
  }

  private getActiveDevBotLookOverride(bot: Player, now: number): DevBotLookOverride | null {
    const override = this.devBotLookOverrides.get(bot.id);
    if (!override) return null;
    if (now < override.expiresAt) return override;

    this.devBotLookOverrides.delete(bot.id);
    return null;
  }

  private createDevBotSkillInput(bot: Player, now: number, override: DevBotSkillOverride | null): PlayerInput {
    return this.applyDevBotSkillOverride(bot, this.createEmptyBotInput(bot, now), override);
  }

  private applyDevBotLookOverride(input: PlayerInput, override: DevBotLookOverride | null): PlayerInput {
    if (!override) return input;
    input.lookPitch = override.pitch;
    return input;
  }

  private applyDevBotSkillOverride(
    bot: Player,
    input: PlayerInput,
    override: DevBotSkillOverride | null
  ): PlayerInput {
    if (!override) return input;

    input.primaryFire = false;
    input.secondaryFire = false;
    input.reload = false;
    input.ability1 = false;
    input.ability2 = false;
    input.ultimate = false;

    switch (override.slot) {
      case 'primary':
        input.primaryFire = true;
        break;
      case 'secondary':
        input.secondaryFire = true;
        break;
      case 'ability1':
        input.ability1 = true;
        if (bot.heroId === 'chronos') {
          input.primaryFire = true;
        }
        break;
      case 'ability2':
        input.ability2 = true;
        break;
      case 'ultimate':
        input.ultimate = true;
        break;
    }

    return input;
  }

  private rootBotMovementAndSkills(bot: Player, now: number): void {
    bot.lastInput = this.createEmptyBotInput(bot, now);
    this.stopBotMovement(bot, { vertical: true });
    this.disablePlayerSkills(bot);
    this.resetPlayerPressState(bot.id);
  }

  private disableBotBrainInput(bot: Player, now: number): void {
    bot.lastInput = this.createEmptyBotInput(bot, now);
    this.stopBotMovement(bot, { vertical: false });
    this.disablePlayerSkills(bot);
    this.resetPlayerPressState(bot.id);
  }

  private resetPlayerPressState(playerId: string): void {
    let pressState = playerPressState.get(playerId);
    if (!pressState) {
      this.initializePressState(playerId);
      pressState = playerPressState.get(playerId)!;
    }

    pressState.primaryFire = false;
    pressState.secondaryFire = false;
    pressState.reload = false;
    pressState.ability1 = false;
    pressState.ability2 = false;
    pressState.ultimate = false;
  }

  private getFlagByTeam(team: Team) {
    return team === 'red' ? this.state.redTeam.flag : this.state.blueTeam.flag;
  }

  private getPublicFlagPosition(flag: ReturnType<GameRoom['getFlagByTeam']>): PlainVec3 {
    const position = this.vec3SchemaToPlain(flag.position);
    if (!flag.carrierId) return position;

    return {
      x: Math.round(position.x / FLAG_CARRIER_APPROX_GRID_METERS) * FLAG_CARRIER_APPROX_GRID_METERS,
      y: Math.round(position.y),
      z: Math.round(position.z / FLAG_CARRIER_APPROX_GRID_METERS) * FLAG_CARRIER_APPROX_GRID_METERS,
    };
  }

  private getFlagSync(team: Team) {
    const flag = this.getFlagByTeam(team);
    return {
      position: this.getPublicFlagPosition(flag),
      carrierId: flag.carrierId || null,
      isAtBase: flag.isAtBase,
    };
  }

  private vec3SchemaToPlain(position: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    return { x: position.x, y: position.y, z: position.z };
  }

  private distance2D(a: { x: number; z: number }, b: { x: number; z: number }): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  private distance3D(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private handleHeroSelect(client: Client, heroId: HeroId) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const isSelectionPhase = this.state.phase === 'hero_select' || this.state.phase === 'waiting';
    const isActiveDevRoom = this.isDevelopmentMode()
      && (this.state.phase === 'countdown' || this.state.phase === 'playing' || this.state.phase === 'round_end');

    if (!isSelectionPhase && !isActiveDevRoom) return;

    if (!this.setPlayerHero(player, heroId)) {
      if (this.isDevelopmentMode()) {
        client.send('devCommandError', { message: `Invalid hero: ${heroId}` });
      }
      return;
    }

    if (isSelectionPhase) {
      this.resetCountdownStartGate();
      this.checkPhaseTransition();
    }

    if (isActiveDevRoom) {
      client.send('devHeroChanged', {
        heroId,
        health: player.health,
        maxHealth: player.maxHealth,
      });
    }
  }

  private handleDevSetHero(client: Client, heroId: HeroId) {
    if (!this.isDevelopmentMode()) {
      client.send('devCommandError', { message: 'Developer commands are disabled' });
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (!this.setPlayerHero(player, heroId)) {
      client.send('devCommandError', { message: `Invalid hero: ${heroId}` });
      return;
    }

    client.send('devHeroChanged', {
      heroId,
      health: player.health,
      maxHealth: player.maxHealth,
    });
  }

  private setPlayerHero(player: Player, heroId: HeroId): boolean {
    const heroDef = HERO_DEFINITIONS[heroId];
    if (!heroDef) return false;

    player.heroId = heroId;
    player.maxHealth = heroDef.stats.maxHealth;
    player.health = player.maxHealth;
    player.ultimateCharge = 0;
    this.phantomPrimaryHoldStartedAt.delete(player.id);
    this.chronosPrimaryHoldStartedAt.delete(player.id);
    this.chronosAegisShieldHp.delete(player.id);
    this.devBotSkillOverrides.delete(player.id);
    this.devBotLookOverrides.delete(player.id);
    if (heroId === 'phantom') {
      this.resetPhantomPrimaryMagazine(player.id);
    } else {
      this.phantomPrimaryMagazines.delete(player.id);
    }
    this.disablePlayerSkills(player);
    if (player.lastInput) {
      player.lastInput = {
        ...player.lastInput,
        primaryFire: false,
        secondaryFire: false,
        reload: false,
        ability1: false,
        ability2: false,
        ultimate: false,
      };
    }

    if (heroId === 'blaze') {
      player.movement.jetpackFuel = BLAZE_FLAMETHROWER_MAX_FUEL;
    }

    // Initialize abilities for this hero
    initializePlayerAbilities(player, heroId);
    this.syncMatchParticipant(player);
    this.syncReconnectParticipantFromPlayer(player);

    return true;
  }

  private selectRandomBotHero(): HeroId {
    return ALL_HERO_IDS[Math.floor(Math.random() * ALL_HERO_IDS.length)] ?? 'phantom';
  }

  private isDevelopmentMode(): boolean {
    return isDevelopmentToolsEnabled();
  }

  private handleSetDevImmune(client: Client, enabled: boolean): void {
    if (!this.isDevelopmentMode()) return;

    if (enabled) {
      this.devImmunePlayers.add(client.sessionId);
    } else {
      this.devImmunePlayers.delete(client.sessionId);
    }
  }

  private handleDevFillUltimate(client: Client): void {
    if (!this.isDevelopmentMode()) {
      client.send('devCommandError', { message: 'Developer commands are disabled' });
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player || !player.heroId) {
      client.send('devCommandError', { message: 'No active hero to charge' });
      return;
    }

    player.ultimateCharge = 100;
  }

  private handleDevEndGame(client: Client): void {
    if (!this.isDevelopmentMode()) {
      client.send('devCommandError', { message: 'Developer commands are disabled' });
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) {
      client.send('devCommandError', { message: 'No active player to end the match' });
      return;
    }

    this.endGame(client.sessionId);
  }

  private handleDevSetObserver(client: Client): void {
    if (!this.isDevelopmentMode()) {
      client.send('devCommandError', { message: 'Developer commands are disabled' });
      return;
    }

    if (this.matchMode !== 'custom') {
      client.send('devCommandError', { message: 'Observer command is only available in custom games' });
      return;
    }

    if (this.observerClientIds.has(client.sessionId)) {
      client.send('observerModeStarted', { playerId: client.sessionId });
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player || player.isBot) {
      client.send('devCommandError', { message: 'No active player to observe from' });
      return;
    }

    void this.removeVoiceParticipantForPlayer(client.sessionId, this.normalizeVoiceTeam(player.team), 'observe');

    if (player.hasFlag) {
      this.dropFlag(player);
    }
    this.markMatchParticipantLeft(player);

    this.state.players.delete(client.sessionId);
    this.clearCombatPlayerRuntimeState(client.sessionId);
    this.clearPlayerReplicationState(client.sessionId);
    this.observerClientIds.add(client.sessionId);
    this.clientsBySessionId.set(client.sessionId, client);
    this.playerPingsDirty = true;

    if (this.state.phase === 'waiting' || this.state.phase === 'hero_select' || this.state.phase === 'countdown') {
      this.resetCountdownStartGate();
    }

    this.updateMetadata();
    client.send('observerModeStarted', { playerId: client.sessionId });
    this.broadcastTracked('playerLeft', { playerId: client.sessionId });
    this.broadcastStateStreams({ transforms: false, forceVitals: true, forceMatch: true });
    this.checkPhaseTransition();
  }

  private handleSetDevTimeFrozen(client: Client, enabled: boolean): void {
    if (!this.isDevelopmentMode()) {
      client.send('devCommandError', { message: 'Developer commands are disabled' });
      return;
    }

    const now = Date.now();
    if (enabled) {
      this.state.roundTimeRemaining = this.getRoundTimeRemaining(now);
      if (this.state.roundStartTime) {
        this.state.phaseEndTime = now + this.state.roundTimeRemaining * 1000;
      }
      this.devGameClockFrozen = true;
    } else {
      this.devGameClockFrozen = false;
      if (this.state.roundStartTime) {
        const elapsedSeconds = this.config.roundTimeSeconds - this.state.roundTimeRemaining;
        this.state.roundStartTime = now - elapsedSeconds * 1000;
        this.state.phaseEndTime = now + this.state.roundTimeRemaining * 1000;
      }
    }

    this.broadcastMatchSnapshot(true);
  }

  private handleSetDevBotsRooted(client: Client, enabled: boolean): void {
    if (!this.isDevelopmentMode()) {
      client.send('devCommandError', { message: 'Developer commands are disabled' });
      return;
    }

    this.devBotsRooted = enabled;

    if (enabled) {
      const now = Date.now();
      this.state.players.forEach((player) => {
        if (player.isBot) {
          this.rootBotMovementAndSkills(player, now);
        }
      });
    } else {
      this.botBrains.forEach((brain) => {
        brain.nextThinkAt = 0;
        brain.nextBlackboardAt = 0;
      });
    }

    client.send('devBotsRootedChanged', { enabled });
    this.broadcastStateStreams({ transforms: true, forceVitals: true });
  }

  private handleSetDevBotBrainEnabled(client: Client, enabled: boolean): void {
    if (!this.isDevelopmentMode()) {
      client.send('devCommandError', { message: 'Developer commands are disabled' });
      return;
    }

    this.devBotBrainEnabled = enabled;

    if (enabled) {
      this.botBrains.forEach((brain) => {
        brain.nextThinkAt = 0;
        brain.nextBlackboardAt = 0;
      });
    } else {
      const now = Date.now();
      this.state.players.forEach((player) => {
        if (player.isBot) {
          this.disableBotBrainInput(player, now);
        }
      });
    }

    client.send('devBotBrainChanged', { enabled });
    this.broadcastStateStreams({ transforms: true, forceVitals: true });
  }

  private handleDevAddBot(client: Client, data: { heroId?: HeroId; team?: Team }): void {
    if (!this.isDevelopmentMode()) {
      client.send('devCommandError', { message: 'Developer commands are disabled' });
      return;
    }

    const { heroId, team } = data;
    const heroDef = heroId ? HERO_DEFINITIONS[heroId] : null;
    if (!heroId || !heroDef) {
      client.send('devCommandError', { message: `Invalid bot hero: ${heroId || ''}` });
      return;
    }

    if (team !== 'red' && team !== 'blue') {
      client.send('devCommandError', { message: `Invalid bot team: ${team || ''}` });
      return;
    }

    if (this.state.players.size >= this.config.maxPlayers) {
      client.send('devCommandError', { message: 'Game room is full' });
      return;
    }

    const botIndex = this.devBotIdCounter++;
    const now = Date.now();
    const bot = new Player();
    bot.id = `bot_dev_${this.roomId}_${botIndex}`;
    bot.name = `${heroDef.name} Bot ${botIndex + 1}`;
    bot.team = team;
    bot.isBot = true;
    bot.botDifficulty = 'normal';
    bot.botProfileId = `dev-${heroId}-${botIndex}`;
    bot.isReady = true;
    bot.state = this.state.phase === 'playing'
      ? 'alive'
      : this.state.phase === 'countdown'
        ? 'spawning'
        : 'selecting';

    this.placePlayerAtSpawn(bot);
    this.setPlayerHero(bot, heroId);
    if (this.state.phase === 'playing') {
      bot.spawnProtectionUntil = now + this.config.spawnProtectionSeconds * 1000;
      resetAbilityCooldowns(bot);
    }

    this.state.players.set(bot.id, bot);
    this.knownPlayerIds.add(bot.id);
    this.updateLastSafeMovement(bot, 0);
    this.preferredBotHeroes.set(bot.id, heroId);
    this.initializePressState(bot.id);
    this.botBrains.set(bot.id, this.createBotBrain(bot, botIndex));
    if (this.devBotsRooted) {
      this.rootBotMovementAndSkills(bot, now);
    } else if (!this.devBotBrainEnabled) {
      this.disableBotBrainInput(bot, now);
    }
    this.updateMetadata();

    for (const roomClient of this.clients) {
      const recipient = this.state.players.get(roomClient.sessionId) ?? null;
      this.sendPlayerJoinedSnapshot(roomClient, bot, recipient);
    }

    client.send('devBotAdded', {
      playerId: bot.id,
      name: bot.name,
      heroId,
      team,
    });

    this.broadcastStateStreams({ transforms: true, forceVitals: true, forceMatch: true });
    this.checkPhaseTransition();
  }

  private handleDevBotSkill(client: Client, data: { heroId: HeroId; team: Team; skillKey: string }): void {
    if (!this.isDevelopmentMode()) {
      client.send('devCommandError', { message: 'Developer commands are disabled' });
      return;
    }

    const skill = resolveDevBotSkillOverride(data.skillKey);
    if (!skill) {
      client.send('devCommandError', { message: `Invalid bot skill key: ${data.skillKey}` });
      return;
    }

    const bot = this.findDevBotTarget(data.heroId, data.team);
    if (!bot) {
      client.send('devCommandError', {
        message: `No alive ${data.team} ${HERO_DEFINITIONS[data.heroId].name} bot found`,
      });
      return;
    }

    const now = Date.now();
    this.primeDevBotSkill(bot, skill.slot);
    this.resetPlayerPressState(bot.id);
    this.devBotSkillOverrides.set(bot.id, {
      ...skill,
      expiresAt: now + DEV_BOT_SKILL_HOLD_MS,
    });

    client.send('devBotSkillTriggered', {
      playerId: bot.id,
      playerName: bot.name,
      heroId: data.heroId,
      team: data.team,
      skillKey: skill.skillKey,
      durationMs: DEV_BOT_SKILL_HOLD_MS,
    });
  }

  private handleDevBotLook(client: Client, data: { heroId: HeroId; team: Team; direction: string }): void {
    if (!this.isDevelopmentMode()) {
      client.send('devCommandError', { message: 'Developer commands are disabled' });
      return;
    }

    const direction = resolveDevBotLookDirection(data.direction);
    if (!direction) {
      client.send('devCommandError', { message: `Invalid bot look direction: ${data.direction}` });
      return;
    }

    const bot = this.findDevBotTarget(data.heroId, data.team);
    if (!bot) {
      client.send('devCommandError', {
        message: `No alive ${data.team} ${HERO_DEFINITIONS[data.heroId].name} bot found`,
      });
      return;
    }

    const now = Date.now();
    const pitch = clampLookPitch(DEV_BOT_LOOK_PITCH[direction]);
    bot.lookPitch = pitch;
    bot.lastInput = {
      ...(bot.lastInput ?? this.createEmptyBotInput(bot, now)),
      lookPitch: pitch,
      timestamp: now,
    };
    const brain = this.botBrains.get(bot.id);
    if (brain) {
      brain.aimPitch = pitch;
    }
    this.devBotLookOverrides.set(bot.id, {
      direction,
      pitch,
      expiresAt: now + DEV_BOT_LOOK_HOLD_MS,
    });

    client.send('devBotLookForced', {
      playerId: bot.id,
      playerName: bot.name,
      heroId: data.heroId,
      team: data.team,
      direction,
      pitch,
      durationMs: DEV_BOT_LOOK_HOLD_MS,
    });
  }

  private findDevBotTarget(heroId: HeroId, team: Team): Player | null {
    let fallback: Player | null = null;
    this.state.players.forEach((player) => {
      if (fallback || !player.isBot || player.heroId !== heroId || player.team !== team) return;
      if (this.spawnedNpcs.has(player.id)) return;
      if (player.state === 'alive') {
        fallback = player;
      }
    });
    return fallback;
  }

  private primeDevBotSkill(player: Player, slot: DevBotSkillSlot): void {
    this.attackCooldownUntil.delete(`${player.id}:primary`);
    this.attackCooldownUntil.delete(`${player.id}:secondary`);
    this.blazeBombDropConsumedForHold.delete(player.id);
    this.phantomPrimaryHoldStartedAt.delete(player.id);
    this.chronosPrimaryHoldStartedAt.delete(player.id);
    this.phantomVoidRayChargeStartedAt.delete(player.id);
    this.phantomVoidRayResolvedForPress.delete(player.id);

    if (player.heroId === 'phantom' && slot === 'primary') {
      const magazine = this.getOrCreatePhantomPrimaryMagazine(player);
      magazine.ammo = PHANTOM_PRIMARY_MAGAZINE_SIZE;
      magazine.reloadStartedAt = 0;
      magazine.reloadUntil = 0;
    }
    if (player.heroId === 'blaze') {
      player.movement.jetpackFuel = BLAZE_FLAMETHROWER_MAX_FUEL;
    }
    if (player.heroId === 'chronos' && slot === 'secondary') {
      this.chronosAegisShieldHp.delete(player.id);
    }

    if (slot === 'primary' || slot === 'secondary') return;

    const abilityId = HERO_DEFINITIONS[player.heroId as HeroId]?.[slot]?.abilityId;
    const ability = abilityId ? player.abilities.get(abilityId) : null;
    const abilityDef = abilityId ? ABILITY_DEFINITIONS[abilityId] : undefined;
    if (ability) {
      ability.cooldownRemaining = 0;
      ability.isActive = false;
      ability.charges = abilityDef?.charges || 1;
    }
    if (slot === 'ultimate') {
      player.ultimateCharge = 100;
    }
  }

  private getRoundTimeRemaining(now: number): number {
    if (!this.state.roundStartTime) return this.state.roundTimeRemaining;

    const elapsed = Math.max(0, (now - this.state.roundStartTime) / 1000);
    return Math.max(0, this.config.roundTimeSeconds - elapsed);
  }

  private refreshMapManifest(): void {
    const themeId = this.state.mapThemeId
      ? this.state.mapThemeId as VoxelMapTheme['id']
      : getVoxelMapTheme(this.state.mapSeed).id;
    this.state.mapThemeId = themeId;
    this.mapManifest = generateProceduralVoxelMap(this.state.mapSeed, { themeId });
    this.proceduralTerrainLookup = createProceduralTerrainLookup(this.mapManifest);
    this.mapChunkLookup.clear();
    for (const chunk of this.mapManifest.chunks) {
      this.mapChunkLookup.set(this.getChunkKey(chunk.coord.x, chunk.coord.y, chunk.coord.z), chunk);
    }
    this.botRouteGraph = createBotRouteGraphAdapter(this.mapManifest);
    this.botTeamTactics = null;
    this.nextBotTacticsAt = 0;
    this.movementTerrain.origin = this.mapManifest.origin;
    this.movementTerrain.voxelSize = this.mapManifest.voxelSize;
    this.hookshotAnchorWalls = [];
    this.movementCollisionRevision = 0;
    this.movementTerrain.collisionRevision = 0;
    this.movementCollisionWorldCache = null;
    this.losCache.clear();
    this.visibilityInterest.clearAll();
    this.forceTransformFullSync();
  }

  private bumpMovementCollisionRevision(): void {
    this.movementCollisionRevision = (this.movementCollisionRevision + 1) >>> 0;
    if (this.movementCollisionRevision === 0) {
      this.movementCollisionRevision = 1;
    }
    this.movementTerrain.collisionRevision = this.movementCollisionRevision;
    this.movementCollisionWorldCache = null;
    this.losCache.clear();
    this.visibilityInterest.clearLineOfSightCache();
    this.forceTransformFullSync();
  }

  private pruneExpiredHookshotAnchorWalls(now = Date.now()): void {
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.hookshotAnchorWalls.length; readIndex++) {
      const wall = this.hookshotAnchorWalls[readIndex];
      const age = now - wall.startTime;
      if (age >= 0 && age <= wall.duration * 1000) {
        this.hookshotAnchorWalls[writeIndex++] = wall;
      }
    }
    if (writeIndex !== this.hookshotAnchorWalls.length) {
      this.hookshotAnchorWalls.length = writeIndex;
      this.bumpMovementCollisionRevision();
    }
  }

  private getMovementCollisionRevision(now = Date.now()): number {
    this.pruneExpiredHookshotAnchorWalls(now);
    return this.movementCollisionRevision;
  }

  private getMovementCollisionWorld(now = Date.now()): MovementCollisionWorld {
    const revision = this.getMovementCollisionRevision(now);
    const cached = this.movementCollisionWorldCache;
    if (cached && cached.revision === revision) {
      return cached.world;
    }

    this.movementTerrain.collisionRevision = revision;
    const world = createVoxelCollisionWorld(this.movementTerrain);
    this.movementCollisionWorldCache = { revision, world };
    return world;
  }

  private getHookshotAnchorWallAabbs(bounds: MovementCollisionBounds): MovementAabb[] {
    if (this.hookshotAnchorWalls.length === 0) return this.emptyMovementAabbs;
    return computeAnchorWallAabbs(this.hookshotAnchorWalls, this.state.serverTime || Date.now(), bounds);
  }

  private createHookshotAnchorWall(instance: HookshotAnchorWallInstance): void {
    this.pruneExpiredHookshotAnchorWalls(instance.startTime);
    this.hookshotAnchorWalls.push(instance);
    this.bumpMovementCollisionRevision();
  }

  private getMapManifest(): VoxelMapManifest {
    if (
      !this.mapManifest
      || this.mapManifest.seed !== this.state.mapSeed
      || this.mapManifest.themeId !== this.state.mapThemeId
    ) {
      this.refreshMapManifest();
    }
    return this.mapManifest!;
  }

  private getProceduralTerrainLookup(): ReturnType<typeof createProceduralTerrainLookup> {
    this.getMapManifest();
    if (!this.proceduralTerrainLookup) {
      this.proceduralTerrainLookup = createProceduralTerrainLookup(this.mapManifest!);
    }
    return this.proceduralTerrainLookup;
  }

  private getMapWorldBounds(manifest = this.getMapManifest()): { minX: number; maxX: number; minZ: number; maxZ: number } {
    return {
      minX: manifest.origin.x,
      maxX: manifest.origin.x + manifest.size.x * manifest.voxelSize.x,
      minZ: manifest.origin.z,
      maxZ: manifest.origin.z + manifest.size.z * manifest.voxelSize.z,
    };
  }

  private getChunkKey(x: number, y: number, z: number): string {
    return `${x}:${y}:${z}`;
  }

  private worldToGrid(value: number, origin: number, voxelSize: number): number {
    return Math.floor((value - origin) / voxelSize);
  }

  private getBlockAtWorld(position: { x: number; y: number; z: number }): number {
    const manifest = this.getMapManifest();
    const gx = this.worldToGrid(position.x, manifest.origin.x, manifest.voxelSize.x);
    const gy = this.worldToGrid(position.y, manifest.origin.y, manifest.voxelSize.y);
    const gz = this.worldToGrid(position.z, manifest.origin.z, manifest.voxelSize.z);

    if (gx < 0 || gx >= manifest.size.x || gy < 0 || gy >= manifest.size.y || gz < 0 || gz >= manifest.size.z) {
      return 0;
    }

    const cx = Math.floor(gx / manifest.chunkSize.x);
    const cy = Math.floor(gy / manifest.chunkSize.y);
    const cz = Math.floor(gz / manifest.chunkSize.z);
    const chunk = this.mapChunkLookup.get(this.getChunkKey(cx, cy, cz));
    if (!chunk) return 0;

    const lx = gx - cx * manifest.chunkSize.x;
    const ly = gy - cy * manifest.chunkSize.y;
    const lz = gz - cz * manifest.chunkSize.z;
    return chunk.blocks[lx + chunk.size.x * (lz + chunk.size.z * ly)] || 0;
  }

  private getProceduralGroundY(position: { x: number; y: number; z: number }): number | null {
    const manifest = this.getMapManifest();
    const gx = this.worldToGrid(position.x, manifest.origin.x, manifest.voxelSize.x);
    const gz = this.worldToGrid(position.z, manifest.origin.z, manifest.voxelSize.z);

    if (gx < 0 || gx >= manifest.size.x || gz < 0 || gz >= manifest.size.z) {
      return null;
    }

    const topRow = manifest.heightfield.topSolidRows[gx + gz * manifest.heightfield.size.x];
    if (topRow > 0) {
      const topY = manifest.origin.y + topRow * manifest.voxelSize.y;
      if (position.y >= topY - 0.75) {
        return topY;
      }
    }

    const startY = Math.max(0, Math.min(
      manifest.size.y - 1,
      this.worldToGrid(position.y - 0.15, manifest.origin.y, manifest.voxelSize.y)
    ));

    for (let gy = startY; gy >= 0; gy--) {
      const block = this.getBlockAtWorld({
        x: position.x,
        y: manifest.origin.y + (gy + 0.5) * manifest.voxelSize.y,
        z: position.z,
      });
      if (isCollisionBlock(block)) {
        return manifest.origin.y + (gy + 1) * manifest.voxelSize.y;
      }
    }

    return null;
  }

  private clampToPlayableMap(position: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const manifest = this.getMapManifest();
    const bounds = this.getMapWorldBounds(manifest);
    const clampedBoundary = clampToBoundaryPolygon(position.x, position.z, manifest.boundary);

    return {
      x: Math.max(bounds.minX, Math.min(bounds.maxX, clampedBoundary.x)),
      y: Math.max(-20, Math.min(120, position.y)),
      z: Math.max(bounds.minZ, Math.min(bounds.maxZ, clampedBoundary.z)),
    };
  }

  private isFiniteVec3(position: { x: number; y: number; z: number }): boolean {
    return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
  }

  private disablePlayerSkills(player: Player) {
    player.abilities.forEach(ability => {
      ability.isActive = false;
    });
    this.broadcastBlazeFlamethrowerState(player, false, Date.now());
    this.blazeBombDropConsumedForHold.delete(player.id);
    this.phantomPrimaryHoldStartedAt.delete(player.id);
    this.chronosPrimaryHoldStartedAt.delete(player.id);
    this.phantomVoidRayChargeStartedAt.delete(player.id);
    this.phantomVoidRayResolvedForPress.delete(player.id);
    this.clearHookshotGrapple(player.id);
    this.clearHookshotDragPull(player.id);
    player.movement.isGrappling = false;
    player.movement.isJetpacking = false;
    player.movement.isGliding = false;
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
  }

  private handleTeamSelect(client: Client, team: Team) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (this.playerEntryTickets.has(client.sessionId)) {
      return;
    }

    // Check team balance
    const teamCount = this.getTeamCountExcluding(team, client.sessionId);
    const otherTeamCount = this.getTeamCountExcluding(team === 'red' ? 'blue' : 'red', client.sessionId);

    if (teamCount >= this.config.teamSize || teamCount > otherTeamCount) {
      // Team is full
      return;
    }

    const previousTeam = this.normalizeVoiceTeam(player.team);
    player.team = team;
    this.syncMatchParticipant(player);
    if (previousTeam && previousTeam !== team) {
      void this.removeVoiceParticipantForPlayer(client.sessionId, previousTeam, 'team_changed');
      client.send('voiceTeamChanged', { previousTeam, team });
    }
    
    this.placePlayerAtSpawn(player, 'respawn');
    this.resetCountdownStartGate();
    this.broadcastStateStreams({ transforms: true, forceTransforms: true, forceVitals: true, forceMatch: true });
    this.checkPhaseTransition();
  }

  private async handleVoiceTokenRequest(client: Client, data: unknown): Promise<void> {
    const requestId = isRecord(data)
      ? sanitizeShortText(data.requestId, 80)
      : null;

    if (!requestId) {
      client.send('voiceToken', voiceService.createDisabledResponse('invalid', 'invalid voice token request'));
      return;
    }

    if (isRecord(data) && data.scope !== undefined && data.scope !== 'match') {
      client.send('voiceToken', voiceService.createDisabledResponse(requestId, 'unsupported voice scope'));
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) {
      client.send('voiceToken', voiceService.createDisabledResponse(requestId, 'not in game room'));
      return;
    }

    if (player.isBot) {
      client.send('voiceToken', voiceService.createDisabledResponse(requestId, 'bots cannot join voice'));
      return;
    }

    const playerTeam = this.normalizeVoiceTeam(player.team);
    if (!playerTeam) {
      client.send('voiceToken', voiceService.createDisabledResponse(requestId, 'player has no voice team'));
      return;
    }

    const voiceIdentity = this.getVoiceIdentity(client.sessionId);
    if (!voiceIdentity) {
      client.send('voiceToken', voiceService.createDisabledResponse(requestId, 'Authentication required'));
      return;
    }

    const response = await voiceService.issueMatchVoiceToken({
      requestId,
      playerId: client.sessionId,
      identity: voiceIdentity,
      displayName: player.name,
      team: playerTeam,
      lobbyId: this.lobbyId,
      gameRoomId: this.roomId,
      human: !player.isBot,
      canPublish: player.state !== 'spectating',
    });

    client.send('voiceToken', response);
  }

  private handleReady(client: Client, ready: boolean) {
    if (this.matchCancelled) return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    player.isReady = ready;
    if (!ready) {
      this.resetCountdownStartGate();
    }
    this.checkPhaseTransition();
  }

  private handleMatchSceneReady(client: Client, data: unknown): void {
    if (this.matchCancelled) return;
    if (this.state.phase !== 'hero_select' || !this.countdownStartGateOpen) return;

    const gateKey = isRecord(data) && typeof data.key === 'number' && Number.isInteger(data.key)
      ? data.key
      : null;
    if (gateKey !== this.countdownStartGateKey) return;

    const player = this.state.players.get(client.sessionId);
    if (!player || player.isBot || !player.heroId || !player.isReady) return;

    this.countdownSceneReadyPlayerIds.add(client.sessionId);
    this.checkPhaseTransition();
  }

  private handleChat(client: Client, message: string, teamOnly: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Filter out empty messages
    if (!message.trim()) return;

    // Limit message length
    const sanitizedMessage = message.substring(0, 200);

    if (teamOnly) {
      // Send to team only
      this.state.players.forEach((p, sessionId) => {
        if (p.team === player.team) {
          this.clientsBySessionId.get(sessionId)?.send('chat', {
            playerId: client.sessionId,
            playerName: player.name,
            message: sanitizedMessage,
            teamOnly: true,
            timestamp: Date.now(),
          });
        }
      });
    } else {
      this.broadcast('chat', {
        playerId: client.sessionId,
        playerName: player.name,
        message: sanitizedMessage,
        teamOnly: false,
        timestamp: Date.now(),
      });
    }
  }

  private checkPhaseTransition() {
    if (this.matchCancelled) return;

    const playerCount = this.state.players.size;

    switch (this.state.phase) {
      case 'waiting':
        if (playerCount >= 1 && this.hasRequiredHumanPlayersConnected()) {
          this.startHeroSelect();
        }
        break;

      case 'hero_select':
        if (this.state.phaseEndTime && Date.now() >= this.state.phaseEndTime) {
          this.state.players.forEach(p => {
            if (!p.heroId) {
              this.setPlayerHero(p, p.isBot ? this.selectRandomBotHero() : 'phantom');
            }
            p.isReady = true;
          });
        }

        if (!this.areAllPlayersReadyForCountdown()) return;

        if (!this.countdownStartGateOpen) {
          loggers.room.info('all players ready, waiting for clients to load into spawn');
          this.openCountdownStartGate();
        }

        if (this.areAllHumansSceneReadyForCountdown()) {
          if (!this.ensureCompetitiveNetworkQualityForStart()) return;
          loggers.room.info('all players loaded into spawn, starting countdown');
          this.startCountdown();
        }
        break;
    }
  }

  private resetCountdownStartGate(): void {
    this.countdownStartGateOpen = false;
    this.countdownSceneReadyPlayerIds.clear();
    this.countdownStartGateKey++;
  }

  private getConnectedHumanPlayerCount(): number {
    let count = 0;
    this.state.players.forEach((player) => {
      if (!player.isBot) count++;
    });
    return count;
  }

  private hasRequiredHumanPlayersConnected(): boolean {
    return this.getConnectedHumanPlayerCount() >= this.requiredHumanPlayers;
  }

  private areAllPlayersReadyForCountdown(): boolean {
    if (this.state.players.size === 0 || !this.hasRequiredHumanPlayersConnected()) {
      this.resetCountdownStartGate();
      return false;
    }

    let allReady = true;
    this.state.players.forEach((player) => {
      if (!player.heroId || !player.isReady) {
        allReady = false;
      }
    });

    if (!allReady) {
      this.resetCountdownStartGate();
    }
    return allReady;
  }

  private areAllHumansSceneReadyForCountdown(): boolean {
    if (!this.countdownStartGateOpen || !this.hasRequiredHumanPlayersConnected()) return false;

    let allReady = true;
    this.state.players.forEach((player, playerId) => {
      if (player.isBot) return;
      if (!this.clientsBySessionId.has(playerId) || !this.countdownSceneReadyPlayerIds.has(playerId)) {
        allReady = false;
      }
    });

    return allReady;
  }

  private openCountdownStartGate(): void {
    if (this.countdownStartGateOpen) return;

    this.countdownStartGateOpen = true;
    this.countdownSceneReadyPlayerIds.clear();
    this.countdownStartGateKey++;

    const now = Date.now();
    this.state.players.forEach((player) => {
      player.state = 'spawning';
    });
    this.placeTeamsAtUniqueSpawns('spawn');

    this.forceTransformFullSync();
    this.broadcastStateStreams({ transforms: true, forceTransforms: true, forceVitals: true, forceMatch: true });

    this.state.players.forEach((player, playerId) => {
      if (player.isBot) return;

      const client = this.clientsBySessionId.get(playerId);
      if (!client) return;

      const authority = this.getMovementAuthority(player.id);
      this.sendSelfMovementAuthority(player, client, 'spawn');
      this.sendTracked(client, 'matchStartGate', {
        key: this.countdownStartGateKey,
        serverTime: now,
        mapSeed: this.state.mapSeed,
        mapThemeId: this.state.mapThemeId,
        position: this.vec3SchemaToPlain(player.position),
        movementEpoch: authority.movementEpoch,
        ackSeq: authority.lastProcessedSeq,
        collisionRevision: this.getMovementCollisionRevision(now),
      });
    });
  }

  private startHeroSelect() {
    if (this.matchCancelled) return;

    this.state.phase = 'hero_select';
    this.state.phaseEndTime = Date.now() + this.config.heroSelectTimeSeconds * 1000;
    this.resetCountdownStartGate();
    this.updateMetadata();

    this.state.players.forEach(player => {
      if (player.isBot) {
        player.state = 'selecting';
        player.isReady = false;
        const preferredHero = this.preferredBotHeroes.get(player.id);
        if (preferredHero) {
          this.setPlayerHero(player, preferredHero);
        } else {
          player.heroId = '';
          player.abilities.clear();
          this.disablePlayerSkills(player);
        }
      }
    });

    this.broadcastTracked('phaseChange', {
      phase: 'hero_select',
      endTime: this.state.phaseEndTime,
      mapSeed: this.state.mapSeed,
      mapThemeId: this.state.mapThemeId,
    });
    this.broadcastStateStreams({ transforms: false, forceVitals: true, forceMatch: true });
  }

  private startCountdown() {
    if (this.matchCancelled) return;
    if (!this.areAllPlayersReadyForCountdown()) return;
    if (!this.ensureCompetitiveNetworkQualityForStart()) return;
    if (!this.areAllHumansSceneReadyForCountdown()) {
      this.openCountdownStartGate();
      return;
    }

    this.clearMatchStartCancelTimer();
    this.state.phase = 'countdown';
    this.state.phaseEndTime = Date.now() + this.config.countdownSeconds * 1000;
    this.updateMetadata();

    this.state.players.forEach(player => {
      player.state = 'spawning';
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.velocity.z = 0;
    });

    this.broadcastTracked('phaseChange', {
      phase: 'countdown',
      endTime: this.state.phaseEndTime,
      mapSeed: this.state.mapSeed,
      mapThemeId: this.state.mapThemeId,
    });
    this.forceTransformFullSync();
    this.broadcastStateStreams({ transforms: true, forceTransforms: true, forceVitals: true, forceMatch: true });
  }

  private startPlaying() {
    if (this.matchCancelled) return;
    if (!this.ensureCompetitiveNetworkQualityForStart({ cancelPending: true })) return;

    this.clearMatchStartCancelTimer();
    this.state.phase = 'playing';
    const now = Date.now();
    this.state.roundStartTime = now;
    this.state.roundTimeRemaining = this.config.roundTimeSeconds;
    this.state.phaseEndTime = now + this.config.roundTimeSeconds * 1000;
    this.updateMetadata();
    const ledger = this.ensureMatchPersistenceLedger(this.state.roundStartTime);
    if (this.wagerContext) {
      wagerService.attachMatchId(this.wagerContext.wageredLobbyId, ledger.matchId).catch((error) => {
        loggers.room.error('Failed to attach wager to match ledger', {
          wageredLobbyId: this.wagerContext?.wageredLobbyId,
          matchId: ledger.matchId,
          error: this.serializePersistenceError(error),
        });
      });
    }

    this.blazeBurnEffects.clear();

    // Set all players to alive
    this.state.players.forEach(player => {
      player.state = 'alive';
      player.health = player.maxHealth;
      player.spawnProtectionUntil = now + this.config.spawnProtectionSeconds * 1000;
      this.resetPlayerLifeRuntime(player, now);
      if (player.heroId === 'blaze') {
        player.movement.jetpackFuel = BLAZE_FLAMETHROWER_MAX_FUEL;
      }
      if (player.heroId === 'phantom') {
        this.resetPhantomPrimaryMagazine(player.id);
      }
      if (player.heroId === 'chronos') {
        this.chronosAegisShieldHp.delete(player.id);
      }
      if (player.isBot) {
        this.botBrains.set(player.id, this.createBotBrain(player, this.hashString(player.id)));
      }

      // Reset ability cooldowns
      resetAbilityCooldowns(player);
      if (ledger.state === 'active') {
        this.registerMatchParticipant(player, this.state.roundStartTime);
      }
    });

    // Reset flags
    this.resetFlags();

    this.broadcastTracked('phaseChange', {
      phase: 'playing',
      endTime: this.state.phaseEndTime,
      mapSeed: this.state.mapSeed,
      mapThemeId: this.state.mapThemeId,
    });
    this.forceTransformFullSync();
    this.broadcastStateStreams({ transforms: true, forceTransforms: true, forceVitals: true, forceMatch: true });
  }

  private endRound() {
    this.state.phase = 'round_end';
    this.state.phaseEndTime = Date.now() + 5000; // 5 second intermission
    this.updateMetadata();

    const winningTeam = this.state.redTeam.score > this.state.blueTeam.score ? 'red' : 
                        this.state.blueTeam.score > this.state.redTeam.score ? 'blue' : null;

    this.broadcastTracked('roundEnd', {
      winningTeam,
      redScore: this.state.redTeam.score,
      blueScore: this.state.blueTeam.score,
      nextPhase: this.state.redTeam.score >= this.config.scoreToWin || 
                 this.state.blueTeam.score >= this.config.scoreToWin ? 'game_end' : 'hero_select',
    });
    this.broadcastStateStreams({ transforms: false, forceVitals: true, forceMatch: true });
  }

  private endGame(forcedByPlayerId?: string) {
    if (this.state.phase === 'game_end') return;

    this.state.phase = 'game_end';
    this.state.phaseEndTime = 0;
    this.state.roundTimeRemaining = 0;
    this.updateMetadata();

    const winningTeam = this.state.redTeam.score > this.state.blueTeam.score ? 'red' :
                        this.state.blueTeam.score > this.state.redTeam.score ? 'blue' : null;
    const finalScore = {
      red: this.state.redTeam.score,
      blue: this.state.blueTeam.score,
    };
    const endedAt = Date.now();

    this.broadcastTracked('gameEnd', this.buildGameEndEvent(finalScore, winningTeam, endedAt, forcedByPlayerId));
    this.broadcastStateStreams({ transforms: false, forceVitals: true, forceMatch: true });

    this.settleGoldenBiomeRewardAfterGame(winningTeam, forcedByPlayerId);
    this.persistMatchLedger(finalScore, winningTeam, forcedByPlayerId);
    this.settleWagerAfterGame(forcedByPlayerId ? null : winningTeam);

    // Reset room after delay
    this.scheduleRoomTimeout(() => {
      this.state.phase = 'waiting';
      this.state.mapSeed = createRandomSeed();
      this.state.mapThemeId = getVoxelMapTheme(this.state.mapSeed).id;
      this.refreshMapManifest();
      this.state.redTeam.score = 0;
      this.state.blueTeam.score = 0;
      this.resetFlags();
      
      this.state.players.forEach(player => {
        player.state = 'selecting';
        player.heroId = '';
        player.isReady = false;
        player.kills = 0;
        player.deaths = 0;
        player.assists = 0;
        player.flagCaptures = 0;
        player.flagReturns = 0;
        player.ultimateCharge = 0;
        player.abilities.clear();
      });
      this.matchPersistenceLedger = null;
      this.updateMetadata();
    }, 10000);
  }

  private resetFlags() {
    const manifest = this.getMapManifest();
    const redFlag = manifest.gameplay?.flags?.red?.center ?? manifest.flagZones.red;
    const blueFlag = manifest.gameplay?.flags?.blue?.center ?? manifest.flagZones.blue;

    this.state.redTeam.flag.position.x = redFlag.x;
    this.state.redTeam.flag.position.y = redFlag.y;
    this.state.redTeam.flag.position.z = redFlag.z;
    this.state.redTeam.flag.isAtBase = true;
    this.state.redTeam.flag.carrierId = '';
    this.state.redTeam.flag.droppedAt = 0;

    this.state.redTeam.flag.basePosition.x = redFlag.x;
    this.state.redTeam.flag.basePosition.y = redFlag.y;
    this.state.redTeam.flag.basePosition.z = redFlag.z;

    this.state.blueTeam.flag.position.x = blueFlag.x;
    this.state.blueTeam.flag.position.y = blueFlag.y;
    this.state.blueTeam.flag.position.z = blueFlag.z;
    this.state.blueTeam.flag.isAtBase = true;
    this.state.blueTeam.flag.carrierId = '';
    this.state.blueTeam.flag.droppedAt = 0;
    this.state.blueTeam.flag.basePosition.x = blueFlag.x;
    this.state.blueTeam.flag.basePosition.y = blueFlag.y;
    this.state.blueTeam.flag.basePosition.z = blueFlag.z;
  }

  private updateVoidZones(now: number) {
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.voidZones.length; readIndex++) {
      const zone = this.voidZones[readIndex];
      const elapsed = (now - zone.startTime) / 1000;
      if (elapsed >= zone.duration) {
        this.broadcastTracked('voidZoneExpired', { id: zone.id });
        continue;
      }
      this.voidZones[writeIndex++] = zone;
    }
    this.voidZones.length = writeIndex;

    // Apply damage to players in active void zones
    for (const zone of this.voidZones) {
      if (now - zone.startTime < VOID_ZONE_DAMAGE_INTERVAL) continue;

      const targets = this.playerSpatialIndex.queryRadius(
        zone.position,
        zone.radius,
        this.spatialQueryScratch,
        { team: zone.ownerTeam === 'red' ? 'blue' : 'red', excludeId: zone.ownerId }
      );
      for (const player of targets) {
        if (player.id === zone.ownerId) continue;
        if (player.spawnProtectionUntil && now < player.spawnProtectionUntil) continue;

        const dx = player.position.x - zone.position.x;
        const dz = player.position.z - zone.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > zone.radius * zone.radius) continue;

        const lastDamage = zone.lastDamageTick.get(player.id) || 0;
        if (now - lastDamage >= VOID_ZONE_DAMAGE_INTERVAL) {
          zone.lastDamageTick.set(player.id, now);
          this.applyDamage(player, zone.damage, zone.ownerId, 'void_zone', {
            abilityId: 'phantom_void_zone',
            sourcePosition: zone.position,
          });
        }
      }
    }
  }

  private getBlazeFlamethrowerPose(player: Player): { origin: PlainVec3; direction: PlainVec3 } {
    const pitch = player.lookPitch;
    const cosPitch = Math.cos(pitch);
    const forward = {
      x: -Math.sin(player.lookYaw) * cosPitch,
      y: Math.sin(pitch),
      z: -Math.cos(player.lookYaw) * cosPitch,
    };

    return {
      origin: this.getAbilitySocketCastOrigin(player, 'blaze_flamethrower'),
      direction: forward,
    };
  }

  private broadcastBlazeFlamethrowerState(player: Player, active: boolean, now: number): void {
    const wasActive = this.blazeFlamethrowerActivePlayers.has(player.id);
    if (wasActive === active) return;

    if (active) {
      this.blazeFlamethrowerActivePlayers.add(player.id);
    } else {
      this.blazeFlamethrowerActivePlayers.delete(player.id);
    }

    const pose = this.getBlazeFlamethrowerPose(player);
    this.broadcastAbilityUsed(player, {
      playerId: player.id,
      abilityId: 'blaze_flamethrower',
      castId: `blaze_flamethrower_${player.id}_${active ? 'start' : 'stop'}_${now}`,
      position: this.vec3SchemaToPlain(player.position),
      startPosition: pose.origin,
      aimDirection: pose.direction,
      ownerTeam: player.team as Team,
      serverTime: now,
      active,
      fuel: player.movement.jetpackFuel,
    });
  }

  private igniteBlazeBurn(
    target: Player,
    source: Player,
    now: number,
    sourcePosition: PlainVec3 | null,
    sourceDirection: PlainVec3 | null
  ): void {
    const existing = this.blazeBurnEffects.get(target.id);
    const nextTickAt = existing && existing.ticksRemaining > 0
      ? Math.min(existing.nextTickAt, now + BLAZE_FLAMETHROWER_BURN_INTERVAL_MS)
      : now + BLAZE_FLAMETHROWER_BURN_INTERVAL_MS;

    this.blazeBurnEffects.set(target.id, {
      sourceId: source.id,
      ticksRemaining: BLAZE_FLAMETHROWER_BURN_TICKS,
      nextTickAt,
      sourcePosition: sourcePosition ? { ...sourcePosition } : null,
      sourceDirection: sourceDirection ? { ...sourceDirection } : null,
    });
  }

  private updateBlazeBurns(now: number): void {
    for (const [targetId, burn] of this.blazeBurnEffects) {
      const target = this.state.players.get(targetId);
      if (!target || target.state !== 'alive' || burn.ticksRemaining <= 0) {
        this.blazeBurnEffects.delete(targetId);
        continue;
      }

      while (burn.ticksRemaining > 0 && now >= burn.nextTickAt && target.state === 'alive') {
        const sourceId = this.state.players.has(burn.sourceId) ? burn.sourceId : null;
        const killed = this.applyDamage(
          target,
          BLAZE_FLAMETHROWER_BURN_DAMAGE,
          sourceId,
          'burn',
          {
            abilityId: 'blaze_flamethrower',
            sourcePosition: burn.sourcePosition,
            sourceDirection: burn.sourceDirection,
          }
        );
        burn.ticksRemaining--;
        burn.nextTickAt += BLAZE_FLAMETHROWER_BURN_INTERVAL_MS;

        if (killed || target.state !== 'alive') {
          break;
        }
      }

      if (burn.ticksRemaining <= 0 || target.state !== 'alive') {
        this.blazeBurnEffects.delete(targetId);
      }
    }
  }

  private updateBlazeFlamethrowers(now: number, dt: number) {
    const activeBlazePlayersThisTick = this.activeBlazePlayersScratch;
    activeBlazePlayersThisTick.clear();

    for (const player of this.alivePlayers) {
      if (player.heroId !== 'blaze') continue;
      activeBlazePlayersThisTick.add(player.id);

      player.movement.isJetpacking = false;
      const tempoMultiplier = this.getChronosTimebreakTempoMultiplier(player);

      const isFiring = Boolean(player.lastInput?.ability1);
      if (isFiring && player.movement.jetpackFuel > 0) {
        player.movement.isJetpacking = true;
        player.movement.jetpackFuel = Math.max(
          0,
          player.movement.jetpackFuel - BLAZE_FLAMETHROWER_FUEL_DRAIN * dt * tempoMultiplier
        );
        this.applyFlamethrowerDamage(player, now, tempoMultiplier);
        this.broadcastBlazeFlamethrowerState(player, true, now);
        continue;
      }

      if (player.movement.jetpackFuel < BLAZE_FLAMETHROWER_MAX_FUEL) {
        player.movement.jetpackFuel = Math.min(
          BLAZE_FLAMETHROWER_MAX_FUEL,
          player.movement.jetpackFuel + BLAZE_FLAMETHROWER_FUEL_REGEN * dt * tempoMultiplier
        );
      }
      this.broadcastBlazeFlamethrowerState(player, false, now);
    }

    for (const playerId of this.blazeFlamethrowerActivePlayers) {
      if (activeBlazePlayersThisTick.has(playerId)) continue;

      const player = this.state.players.get(playerId);
      if (!player) {
        this.blazeFlamethrowerActivePlayers.delete(playerId);
        continue;
      }

      player.movement.isJetpacking = false;
      this.broadcastBlazeFlamethrowerState(player, false, now);
    }
  }

  private applyFlamethrowerDamage(source: Player, now: number, tempoMultiplier: number) {
    const { origin, direction: forward } = this.getBlazeFlamethrowerPose(source);
    const terrainHit = this.raycastTerrain(origin, forward, BLAZE_FLAMETHROWER_RANGE);
    const flameDistance = terrainHit
      ? Math.min(BLAZE_FLAMETHROWER_RANGE, this.distance3D(origin, terrainHit))
      : BLAZE_FLAMETHROWER_RANGE;
    let aegisHitForDamage = this.getChronosAegisSkillHit(source, origin, forward, flameDistance, {
      projectileRadius: BLAZE_FLAMETHROWER_COLLISION_RADIUS,
    });

    const candidateRange = BLAZE_FLAMETHROWER_RANGE
      + BLAZE_FLAMETHROWER_COLLISION_RADIUS
      + PLAYER_RADIUS
      + PLAYER_COMBAT_HITBOX_PADDING;
    const candidates = this.playerSpatialIndex.queryConeCandidates(
      origin,
      candidateRange,
      this.spatialQueryScratch,
      { team: source.team === 'red' ? 'blue' : 'red', excludeId: source.id }
    );

    for (const target of candidates) {
      if (target.id === source.id) continue;
      if (target.spawnProtectionUntil && now < target.spawnProtectionUntil) continue;
      const hit = this.getAimConeHitAgainstPlayer(
        origin,
        forward,
        flameDistance,
        BLAZE_FLAMETHROWER_CONE_DOT,
        target,
        BLAZE_FLAMETHROWER_COLLISION_RADIUS
      );
      if (!hit) continue;
      const targetPoint = hit.targetPoint;

      const toTarget = {
        x: targetPoint.x - origin.x,
        y: targetPoint.y - origin.y,
        z: targetPoint.z - origin.z,
      };
      const distance = Math.max(hit.distance, 0.0001);

      const targetDirection = this.normalize3D(toTarget);
      const targetAegisHit = targetDirection
        ? this.getChronosAegisSkillHit(source, origin, targetDirection, distance, {
          shieldTeam: target.team as Team,
          projectileRadius: BLAZE_FLAMETHROWER_COLLISION_RADIUS,
          targetPoint,
        })
        : null;
      if (targetAegisHit && targetAegisHit.distance <= distance) {
        if (!aegisHitForDamage || targetAegisHit.distance < aegisHitForDamage.distance) {
          aegisHitForDamage = targetAegisHit;
        }
        continue;
      }

      const tickKey = `${source.id}:${target.id}`;
      const lastDamage = this.flamethrowerLastDamageTick.get(tickKey) || 0;
      if (now - lastDamage < BLAZE_FLAMETHROWER_DAMAGE_INTERVAL / tempoMultiplier) continue;

      const falloff = 1 - (distance / BLAZE_FLAMETHROWER_RANGE) * 0.35;
      const damage = Math.max(1, Math.round(BLAZE_FLAMETHROWER_DAMAGE * falloff));
      this.flamethrowerLastDamageTick.set(tickKey, now);
      const previousHealth = target.health;
      this.applyDamage(target, damage, source.id, 'flamethrower', {
        abilityId: 'blaze_flamethrower',
        sourcePosition: origin,
        sourceDirection: forward,
      });
      if (target.state === 'alive' && target.health < previousHealth) {
        this.igniteBlazeBurn(target, source, now, origin, forward);
      }
    }

    if (aegisHitForDamage) {
      const tickKey = `${source.id}:aegis:${aegisHitForDamage.blocker.id}`;
      const lastDamage = this.flamethrowerLastDamageTick.get(tickKey) || 0;
      if (now - lastDamage >= BLAZE_FLAMETHROWER_DAMAGE_INTERVAL / tempoMultiplier) {
        const falloff = 1 - (aegisHitForDamage.distance / BLAZE_FLAMETHROWER_RANGE) * 0.35;
        const damage = Math.max(1, Math.round(BLAZE_FLAMETHROWER_DAMAGE * falloff));
        this.flamethrowerLastDamageTick.set(tickKey, now);
        this.absorbDamageWithChronosAegis(aegisHitForDamage.blocker, damage, now, {
          source,
          damageType: 'flamethrower',
          position: aegisHitForDamage.point,
          direction: aegisHitForDamage.normal,
        });
      }
    }
  }

  private handlePlayerDeath(player: Player, killerId: string, context: DamageContext & { damageType?: string } = {}) {
    if (player.state === 'dead') return;

    const killer = this.state.players.get(killerId);
    
    const deathAt = Date.now();
    const deathPosition = { x: player.position.x, y: player.position.y, z: player.position.z };
    const deathVelocity = { x: player.velocity.x, y: player.velocity.y, z: player.velocity.z };

    player.state = 'dead';
    player.health = 0;
    player.deaths++;
    this.recordMatchDeath(player, killer ?? null);
    player.respawnTime = deathAt + this.config.respawnTimeSeconds * 1000;
    this.resetPlayerLifeRuntime(player, deathAt);
    
    // Drop flag if carrying
    if (player.hasFlag) {
      this.dropFlag(player);
    }

    if (killer) {
      killer.kills++;
      this.recordMatchKill(killer, player);
      killer.ultimateCharge = Math.min(100, killer.ultimateCharge + ULTIMATE_CHARGE_PER_KILL);
    }

    const now = Date.now();
    const assistIds: string[] = [];
    const history = this.damageHistory.get(player.id);
    let lastDamageEntry: DamageHistoryEntry | null = null;
    if (history) {
      for (const [sourceId, entry] of history) {
        if (!lastDamageEntry || entry.timestamp > lastDamageEntry.timestamp) {
          lastDamageEntry = entry;
        }
        if (sourceId === killerId) continue;
        if (now - entry.timestamp > DAMAGE_HISTORY_WINDOW_MS) continue;
        const assister = this.state.players.get(sourceId);
        if (!assister || assister.team === player.team) continue;
        assister.assists++;
        this.recordMatchAssist(assister, player);
        assister.ultimateCharge = Math.min(100, assister.ultimateCharge + 8);
        assistIds.push(sourceId);
      }
      this.damageHistory.delete(player.id);
    }

    this.broadcastPlayerKilled(player, killer ?? null, {
      victimId: player.id,
      killerId: killerId || null,
      assistIds,
      position: deathPosition,
      velocity: deathVelocity,
      sourcePosition: context.sourcePosition ?? lastDamageEntry?.sourcePosition ?? (killer ? this.vec3SchemaToPlain(killer.position) : null),
      sourceDirection: context.sourceDirection ?? lastDamageEntry?.sourceDirection ?? null,
      damageType: context.damageType ?? lastDamageEntry?.damageType,
      abilityId: context.abilityId,
      occurredAt: deathAt,
      respawnTime: player.respawnTime || null,
    });
  }

  private createVoidZone(position: { x: number; y: number; z: number }, ownerId: string, ownerTeam: 'red' | 'blue') {
    const zone: VoidZone = {
      id: `void_${this.voidZoneIdCounter++}`,
      position: { ...position },
      radius: VOID_ZONE_RADIUS,
      damage: VOID_ZONE_DAMAGE,
      duration: VOID_ZONE_DURATION,
      startTime: Date.now(),
      ownerId,
      ownerTeam,
      lastDamageTick: new Map(),
    };

    this.voidZones.push(zone);

    // Broadcast zone creation to all clients
    this.broadcastTracked('voidZoneCreated', {
      id: zone.id,
      position: zone.position,
      radius: zone.radius,
      duration: zone.duration,
      startTime: zone.startTime,
      ownerId: zone.ownerId,
      ownerTeam: zone.ownerTeam,
    });

    return zone;
  }

  private checkFlagReturns() {
    // Check if flags should auto-return
    const flags = [this.state.redTeam.flag, this.state.blueTeam.flag];
    for (const flag of flags) {
      if (!flag.isAtBase && !flag.carrierId && flag.droppedAt) {
        if (Date.now() - flag.droppedAt >= this.config.flagReturnTimeSeconds * 1000) {
          this.returnFlagToBase(flag.team as Team);
        }
      }
    }
  }

  private dropFlag(player: Player) {
    if (!player.hasFlag) return;

    const enemyTeam = player.team === 'red' ? this.state.blueTeam : this.state.redTeam;
    const flag = enemyTeam.flag;

    flag.position.x = player.position.x;
    flag.position.y = player.position.y;
    flag.position.z = player.position.z;
    flag.carrierId = '';
    flag.droppedAt = Date.now();
    flag.isAtBase = false;

    player.hasFlag = false;
    this.recordObjectiveEvent(player, 'drop', player.team === 'red' ? 'blue' : 'red', Date.now());

    this.broadcastTracked('flagDrop', {
      team: player.team === 'red' ? 'blue' : 'red',
      playerId: player.id,
      position: { x: flag.position.x, y: flag.position.y, z: flag.position.z },
    });
  }

  private respawnPlayer(player: Player) {
    const now = Date.now();
    player.state = 'alive';
    player.health = player.maxHealth;
    player.respawnTime = 0;
    player.spawnProtectionUntil = now + this.config.spawnProtectionSeconds * 1000;
    this.resetPlayerLifeRuntime(player, now);

    this.placePlayerAtSpawn(player, 'respawn');
    if (player.heroId === 'blaze') {
      player.movement.jetpackFuel = BLAZE_FLAMETHROWER_MAX_FUEL;
    }
    if (player.heroId === 'phantom') {
      this.resetPhantomPrimaryMagazine(player.id);
    }
    if (player.heroId === 'chronos') {
      this.chronosAegisShieldHp.delete(player.id);
    }
    if (player.isBot) {
      this.botBrains.set(player.id, this.createBotBrain(player, this.hashString(player.id)));
    }

    // Reset ability cooldowns on respawn
    resetAbilityCooldowns(player);
  }

  private updatePhysics() {
    const tickTime = this.state.serverTime || Date.now();

    this.state.players.forEach(player => {
      if (player.state !== 'alive') return;

      if (
        this.devBotsRooted &&
        player.isBot &&
        !this.getActiveDevBotSkillOverride(player, tickTime) &&
        !this.getActiveDevBotLookOverride(player, tickTime)
      ) {
        this.rootBotMovementAndSkills(player, Date.now());
        return;
      }

      const authority = this.getMovementAuthority(player.id);
      let processedThisTick = 0;
      const queuedCommandCount = authority.pendingCommands.length;
      authority.metrics.queueLengthBeforeTick = queuedCommandCount;
      authority.metrics.commandsProcessedLastTick = 0;

      const drainDecision = getMovementCommandDrainDecision(queuedCommandCount, {
        hasAuthorityBarrier: Boolean(authority.correctionReason),
      });

      if (drainDecision.underflow) {
        authority.metrics.underflowTicks = (authority.metrics.underflowTicks ?? 0) + 1;
        const dragPullMoved = this.stepHookshotDragPullWithoutCommand(player, tickTime);
        authority.metrics.queueLength = authority.pendingCommands.length;
        authority.metrics.queueLengthAfterTick = authority.pendingCommands.length;
        if (player.position.y < -10) {
          this.placePlayerAtSpawn(player, 'respawn');
        }

        const client = this.clientsBySessionId.get(player.id);
        if (client && (authority.correctionReason || dragPullMoved)) {
          this.sendSelfMovementAuthority(player, client, authority.correctionReason);
        }
        return;
      }
      if (drainDecision.catchup) {
        authority.metrics.catchupTicks = (authority.metrics.catchupTicks ?? 0) + 1;
      }

      for (let step = 0; step < drainDecision.budget; step++) {
        const stepNow = tickTime + step * MOVEMENT_SUBSTEP_SECONDS * 1000;
        const epochBeforeStep = authority.movementEpoch;
        const command = this.getNextMovementCommand(authority);
        if (!command) break;
        const input = this.movementCommandToInput(command, player);
        const movementInput = this.getRootedMovementInput(player, input, stepNow);
        player.lastInput = movementInput;
        player.lookYaw = movementInput.lookYaw;
        player.lookPitch = movementInput.lookPitch;
        const dragPullActive = this.hookshotDragPulls.has(player.id);
        if (dragPullActive) {
          this.clearHookshotGrapple(player.id);
        } else {
          this.prepareHookshotGrappleForMovement(player, stepNow);
        }
        const simulationInput = dragPullActive
          ? this.suppressLocomotionInput(movementInput)
          : movementInput;
        this.simulateAuthoritativeMovementStep(player, simulationInput, MOVEMENT_SUBSTEP_SECONDS, stepNow);
        if (!dragPullActive) {
          this.stepHookshotGrappleAuthority(player, simulationInput, MOVEMENT_SUBSTEP_SECONDS, stepNow);
        }
        this.stepHookshotDragPullAuthority(player, MOVEMENT_SUBSTEP_SECONDS, stepNow);
        this.processPlayerInput(player, movementInput);
        this.updateLastSafeMovement(player, movementInput.tick, stepNow);
        authority.metrics.commandsProcessed++;
        processedThisTick++;
        if (authority.movementEpoch !== epochBeforeStep) break;
      }

      authority.metrics.queueLength = authority.pendingCommands.length;
      authority.metrics.queueLengthAfterTick = authority.pendingCommands.length;
      authority.metrics.commandsProcessedLastTick = processedThisTick;
      authority.metrics.lastAckSeq = authority.lastProcessedSeq;
      if (processedThisTick > 0 && authority.pendingCommands.length > MOVEMENT_MAX_SERVER_QUEUE / 2) {
        const stale = Math.max(0, authority.pendingCommands.length - MOVEMENT_MAX_SERVER_QUEUE / 2);
        this.removeOldestPendingCommands(authority, stale);
        authority.metrics.droppedCommands += stale;
        this.markMovementBarrier(player.id, 'epoch_mismatch');
      }

      if (player.position.y < -10) {
        this.placePlayerAtSpawn(player, 'respawn');
      }

      const client = this.clientsBySessionId.get(player.id);
      if (client && (processedThisTick > 0 || authority.correctionReason)) {
        this.sendSelfMovementAuthority(player, client, authority.correctionReason);
      }
    });
  }

  private assignTeam(preferred?: Team): string {
    const redCount = this.getTeamCount('red');
    const blueCount = this.getTeamCount('blue');

    if (preferred) {
      const preferredCount = preferred === 'red' ? redCount : blueCount;
      const otherCount = preferred === 'red' ? blueCount : redCount;
      
      if (preferredCount <= otherCount) {
        return preferred;
      }
    }

    // Assign to smaller team
    return redCount <= blueCount ? 'red' : 'blue';
  }

  private getTeamCount(team: Team): number {
    let count = 0;
    this.state.players.forEach(p => {
      if (p.team === team) count++;
    });
    return count;
  }

  private getTeamCountExcluding(team: Team, excludedPlayerId: string): number {
    let count = 0;
    this.state.players.forEach((p, id) => {
      if (id !== excludedPlayerId && p.team === team) count++;
    });
    return count;
  }

  private getTeamSpawnPoints(team: Team): readonly SpawnPosition[] {
    const manifest = this.getMapManifest();
    const spawnPoints = manifest.gameplay?.spawns?.[team]?.points ?? manifest.spawnPoints[team] ?? [];
    return spawnPoints.length > 0 ? spawnPoints : [{ x: 0, y: 1, z: 0 }];
  }

  private getSpawnPosition(team: Team): SpawnPosition {
    const spawnPoints = this.getTeamSpawnPoints(team);
    const spawn = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];

    return {
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
    };
  }

  private assignPlayerSpawnPosition(player: Player, spawn = this.getSpawnPosition(player.team as Team)): void {
    player.position.x = spawn.x;
    player.position.y = spawn.y;
    player.position.z = spawn.z;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
  }

  private placePlayerAtSpawn(player: Player, reason: MovementCorrectionReason = 'spawn'): void {
    this.assignPlayerSpawnPosition(player);
    this.markMovementBarrier(player.id, reason);
  }

  private placeTeamsAtUniqueSpawns(reason: MovementCorrectionReason = 'spawn'): void {
    const participants: TeamSpawnParticipant[] = [];
    this.state.players.forEach((player, playerId) => {
      if (isTeam(player.team)) {
        participants.push({ playerId, team: player.team });
      }
    });

    const spawnPointsByTeam: Record<Team, readonly SpawnPosition[]> = {
      red: this.getTeamSpawnPoints('red'),
      blue: this.getTeamSpawnPoints('blue'),
    };
    const assignments = createTeamSpawnAssignments(
      participants,
      {
        red: spawnPointsByTeam.red.length,
        blue: spawnPointsByTeam.blue.length,
      },
      {
        red: Math.floor(Math.random() * spawnPointsByTeam.red.length),
        blue: Math.floor(Math.random() * spawnPointsByTeam.blue.length),
      }
    );

    for (const assignment of assignments) {
      const player = this.state.players.get(assignment.playerId);
      if (!player) continue;
      const spawn = spawnPointsByTeam[assignment.team][assignment.spawnIndex];
      this.assignPlayerSpawnPosition(player, spawn);
      this.markMovementBarrier(player.id, reason);
    }
  }

  // ===== NPC/BOT HANDLING =====
  
  private handleSpawnNpc(client: Client, data: { heroId: HeroId; team?: Team; position?: { x: number; y: number; z: number }; name?: string }) {
    const { heroId, position, name } = data;
    let { team } = data;
    
    // Validate hero
    const heroDef = HERO_DEFINITIONS[heroId];
    if (!heroDef) {
      client.send('npcError', { message: `Invalid hero: ${heroId}` });
      return;
    }

    // If no team specified, spawn on OPPOSITE team of the requesting player
    // This ensures NPCs can be damaged by the spawner
    if (!team) {
      const requestingPlayer = this.state.players.get(client.sessionId);
      if (requestingPlayer) {
        team = requestingPlayer.team === 'red' ? 'blue' : 'red';
      } else {
        team = 'blue'; // fallback
      }
    }

    // Generate NPC ID and name
    const npcId = `npc_${this.npcIdCounter++}`;
    const npcName = name || `${heroDef.name}_${this.npcIdCounter}`;

    // Create NPC player entity
    const npc = new Player();
    npc.id = npcId;
    npc.name = npcName;
    npc.team = team;
    npc.heroId = heroId;
    npc.state = 'alive';
    npc.isReady = true;
    
    // Set position - use provided position or spawn near requesting player
    if (position) {
      npc.position.x = position.x;
      npc.position.y = position.y;
      npc.position.z = position.z;
    } else {
      // Spawn near the requesting player
      const requestingPlayer = this.state.players.get(client.sessionId);
      if (requestingPlayer) {
        const angle = requestingPlayer.lookYaw + (Math.random() - 0.5) * 0.5;
        const distance = 5 + Math.random() * 5;
        npc.position.x = requestingPlayer.position.x + Math.sin(angle) * distance;
        npc.position.y = requestingPlayer.position.y;
        npc.position.z = requestingPlayer.position.z + Math.cos(angle) * distance;
      } else {
        // Default spawn
        npc.position.x = 0;
        npc.position.y = 5;
        npc.position.z = 0;
      }
    }
    
    // Set health based on hero
    npc.maxHealth = heroDef.stats.maxHealth;
    npc.health = npc.maxHealth;
    npc.ultimateCharge = 0;
    
    // Random look direction
    npc.lookYaw = Math.random() * Math.PI * 2;
    npc.lookPitch = 0;

    // Initialize abilities for this NPC
    initializePlayerAbilities(npc, heroId);

    // Add to game state
    this.state.players.set(npcId, npc);
    this.spawnedNpcs.add(npcId);
    this.updateMetadata();

    // Broadcast NPC spawn to all clients with recipient-scoped position data.
    for (const roomClient of this.clients) {
      const recipient = this.state.players.get(roomClient.sessionId) ?? null;
      const payload: Record<string, unknown> = {
        playerId: npcId,
        playerName: npcName,
        team,
        heroId,
        isNpc: true,
      };
      if (this.shouldIncludeJoinPosition(recipient, npc)) {
        payload.position = this.vec3SchemaToPlain(npc.position);
      }
      this.sendTracked(roomClient, 'playerJoined', payload);
    }

    // Send confirmation to requesting client
    client.send('npcSpawned', {
      npcId,
      name: npcName,
      heroId,
      team,
      position: { x: npc.position.x, y: npc.position.y, z: npc.position.z },
    });
  }

  private handleDamageNpc(client: Client, data: { npcId: string; damage: number }) {
    const { npcId, damage } = data;
    
    // Find NPC (support partial matching)
    let targetId = npcId;
    if (!this.spawnedNpcs.has(npcId)) {
      for (const id of this.spawnedNpcs) {
        if (id.includes(npcId)) {
          targetId = id;
          break;
        }
      }
    }

    if (!this.spawnedNpcs.has(targetId)) {
      client.send('npcError', { message: `NPC not found: ${npcId}` });
      return;
    }

    const npc = this.state.players.get(targetId);
    if (!npc) {
      this.spawnedNpcs.delete(targetId);
      client.send('npcError', { message: `NPC data not found: ${targetId}` });
      return;
    }

    // Apply damage
    npc.health = Math.max(0, npc.health - damage);

    const source = this.state.players.get(client.sessionId) ?? null;
    this.broadcastPlayerDamaged(npc, source, {
      targetId: targetId,
      damage: damage,
      sourceId: client.sessionId,
      damageType: 'console',
      newHealth: npc.health,
      sourcePosition: source ? this.vec3SchemaToPlain(source.position) : null,
      targetPosition: this.vec3SchemaToPlain(npc.position),
      sourceHeroId: source?.heroId || null,
      targetHeroId: npc.heroId || null,
    });

    // Check for death
    if (npc.health <= 0) {
      this.handleNpcDeath(npc, client.sessionId);
    }

    // Send confirmation
    client.send('npcDamaged', {
      npcId: targetId,
      name: npc.name,
      damage,
      health: npc.health,
      maxHealth: npc.maxHealth,
      killed: npc.health <= 0,
    });
  }

  private handleKillNpc(client: Client, data: { npcId: string }) {
    const { npcId } = data;
    
    // Find NPC (support partial matching)
    let targetId = npcId;
    if (!this.spawnedNpcs.has(npcId)) {
      for (const id of this.spawnedNpcs) {
        if (id.includes(npcId)) {
          targetId = id;
          break;
        }
      }
    }

    if (!this.spawnedNpcs.has(targetId)) {
      client.send('npcError', { message: `NPC not found: ${npcId}` });
      return;
    }

    const npc = this.state.players.get(targetId);
    if (!npc) {
      this.spawnedNpcs.delete(targetId);
      return;
    }

    const npcName = npc.name;
    this.handleNpcDeath(npc, client.sessionId);

    client.send('npcKilled', {
      npcId: targetId,
      name: npcName,
    });
  }

  private handleKillAllNpcs(client: Client) {
    const count = this.spawnedNpcs.size;
    
    for (const npcId of this.spawnedNpcs) {
      const npc = this.state.players.get(npcId);
      if (npc) {
        this.handleNpcDeath(npc, client.sessionId);
      }
    }

    client.send('allNpcsKilled', { count });
  }

  private handleNpcDeath(npc: Player, killerId: string) {
    const killer = this.state.players.get(killerId);
    
    this.broadcastPlayerKilled(npc, killer ?? null, {
      victimId: npc.id,
      killerId: killerId || null,
      assistIds: [],
      position: { x: npc.position.x, y: npc.position.y, z: npc.position.z },
      velocity: { x: npc.velocity.x, y: npc.velocity.y, z: npc.velocity.z },
      sourcePosition: killer ? this.vec3SchemaToPlain(killer.position) : null,
      sourceDirection: killer
        ? this.normalize3D({
          x: npc.position.x - killer.position.x,
          y: npc.position.y - killer.position.y,
          z: npc.position.z - killer.position.z,
        })
        : null,
      occurredAt: Date.now(),
      respawnTime: null,
      isNpc: true,
    });

    // Give killer credit
    if (killer && !this.spawnedNpcs.has(killerId)) {
      killer.kills++;
      killer.ultimateCharge = Math.min(100, killer.ultimateCharge + 20);
    }

    // Remove NPC from game
    this.state.players.delete(npc.id);
    this.spawnedNpcs.delete(npc.id);
    this.playerNetIds.delete(npc.id);
    this.updateMetadata();

    // Broadcast player left
    this.broadcastTracked('playerLeft', {
      playerId: npc.id,
      isNpc: true,
    });
  }

  // Check if a player ID is an NPC
  isNpc(playerId: string): boolean {
    return this.spawnedNpcs.has(playerId);
  }
}
