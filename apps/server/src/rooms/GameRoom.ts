import type { IncomingMessage } from 'http';
import { monitorEventLoopDelay, performance, type IntervalHistogram } from 'node:perf_hooks';
import { Room, Client } from 'colyseus';
import { GameState } from './schema/GameState';
import { Player } from './schema/Player';
import { Vec3Schema, AbilityStateSchema } from './schema/Components';
import { PlayerSpatialIndex } from './PlayerSpatialIndex';
import { PlayerSpatialQueries } from './playerSpatialQueries';
import { AlternatingLaunchSideTracker } from './alternatingLaunchSide';
import { AttackCooldownTracker } from './attackCooldownTracker';
import { ChronosAegisShieldTracker } from './chronosAegisShield';
import { RoomAbilityIdGenerator } from './roomAbilityIds';
import { RoomMetrics, type RoomCustomMessageMetric } from './roomMetrics';
import {
  buildRoomInterestMetricsSnapshot,
  buildRoomLoadSnapshot,
  type RoomInterestMetricsSnapshot,
  type RoomLoadSnapshot,
} from './roomLoadSnapshot';
import { buildGameRoomMetadata } from './roomMetadataSnapshot';
import { getRoomPopulationCounts } from './roomPopulation';
import { applyRoomRankState, buildRoomRankSnapshot } from './roomRankSnapshot';
import {
  buildDevTimeFreezeStatePatch,
  buildCountdownPhaseStatePatch,
  buildGameEndPhaseStatePatch,
  buildHeroSelectPhaseStatePatch,
  buildPhaseChangePayload,
  buildPlayingPhaseStatePatch,
  buildRoundEndPhaseStatePatch,
  buildRoundEndPayload,
  getNextRoundEndPhase,
  getRoomRoundTimeRemaining,
  hasPhaseDeadlineElapsed,
  shouldAutoReadyHeroSelectPhase,
  shouldStartHeroSelectPhase,
  type RoomPhaseStatePatch,
} from './roomPhaseRuntime';
import { RoomTimeoutRegistry } from './roomTimeouts';
import {
  PhantomPrimaryMagazineTracker,
  type PhantomPrimaryMagazineState,
} from './phantomPrimaryMagazine';
import { PhantomVoidRayChargeTracker } from './phantomVoidRayCharge';
import {
  PlayerPressStateTracker,
  type PlayerPressState,
} from './playerPressState';
import { PlayerHoldTracker } from './playerHoldTracker';
import { PlayerCombatActivityTracker } from './playerCombatActivity';
import {
  PlayerReplicationStateTracker,
  type PlayerVitalsReplicationState,
  type TransformReplicationState,
} from './playerReplicationState';
import { RoomClientRegistry } from './roomClientRegistry';
import { buildRoomChatPayload, getRoomChatRecipientIds } from './roomChatRuntime';
import { RoomNpcRegistry } from './roomNpcRegistry';
import { RoomParticipantRegistry } from './roomParticipantRegistry';
import { RoomMapRuntime } from './roomMapRuntime';
import {
  MatchLedgerRuntime,
  type MatchPersistenceLedger,
} from './matchLedgerRuntime';
import { createRoomMatchFinalizationRuntime } from './matchFinalizationRuntime';
import {
  MatchSummaryRuntime,
  buildRankedUserStatesFromAuthContexts,
  type RankedSummaryPreviewInput,
} from './matchSummaryRuntime';
import { MatchSnapshotRuntime } from './matchSnapshotRuntime';
import { PlayerPingRuntime } from './playerPingRuntime';
import {
  POST_GAME_RESET_DELAY_MS,
  buildPostGameResetStatePatch,
  resetPostGamePlayer,
  type PostGameResetStatePatch,
} from './postGameResetRuntime';
import {
  PlayerRootTracker,
  isRootBlockedAbility,
  stopRootedMovementState,
  suppressLocomotionInput,
} from './playerRootState';
import { buildPlayerInterestSnapshot } from './playerInterestSnapshot';
import {
  buildChronosAegisDamagedPayload,
  buildPhantomShieldBrokenPayload,
  buildPlayerDamagedPayload,
  buildPlayerHealedPayload,
  buildPlayerKilledPayload,
  buildPowerupCollectedPayload,
  shouldIncludePlayerJoinPosition,
} from './roomPlayerEventRedaction';
import {
  VisibilityInterestManager,
  type RecipientInterestDecision,
} from './visibilityInterest';
import {
  ReplicationFrameRuntime,
  buildPlayerInterestStreamMessage,
  buildPlayerTransformsStreamMessage,
  buildPlayerVitalsStreamMessage,
  collectRecipientPlayerStateStreams,
  getPlayerStateStreamBroadcastPlan,
  type ReplicationFrameContext,
} from './replicationFrameRuntime';
import {
  SERVER_MOVEMENT_SUBSTEPS_PER_TICK,
  getMovementBacklogTrimCount,
  getMovementCommandDrainDecision,
} from './movementCommandDrain';
import {
  getMovementQueueOverflowBarrierPolicy,
  ingestMovementCommandPacket,
} from './movementCommandIngress';
import {
  MovementAuthorityRegistry,
  type ServerMovementAuthorityState,
} from './movementAuthorityRegistry';
import {
  createTeamSpawnPlan,
  resolveTeamSpawnAssignmentPosition,
  resolveTeamSpawnPlacement,
  type TeamSpawnPosition,
} from './spawnAssignments';
import {
  getRoomHeroLockParticipants,
  isPlayerTeamHeroAvailable as isRoomPlayerTeamHeroAvailable,
  selectAvailableRoomHero,
  type RoomHeroLockParticipant,
} from './roomHeroSelection';
import {
  buildPackedPlayerTransform,
  getPackedTransformSignature,
  selectPackedTransformDelta,
} from './playerTransformPacking';
import {
  MATCH_CANCEL_DISCONNECT_DELAY_MS,
  MATCH_START_CANCEL_TIMEOUT_MS,
} from './matchStartTiming';
import {
  buildMatchCancelledPayload,
  buildPreMatchCancelNotice,
  canCancelPreMatch,
  createStartTimeoutCancelNotice,
  type PreMatchCancelNotice,
  type PreMatchCancelNoticeDetails,
  type PreMatchCancelReason,
} from './preMatchCancellation';
import {
  arePlayersReadyForCountdown as arePlayersReadyForCountdownState,
  buildMatchStartGatePayload,
  canMarkMatchSceneReady,
  countConnectedHumanPlayers,
  hasRequiredHumanPlayersConnected as hasRequiredHumanPlayersConnectedState,
  MatchStartGateTracker,
  readMatchSceneReadyGateKey,
  shouldOpenCountdownStartGate,
  shouldStartCountdownAfterSceneReady,
} from './matchStartReadiness';
import {
  BlazeGearstormTracker,
  PendingAreaDamageQueue,
  VoidZoneTracker,
  type PendingAreaDamageInstance,
} from './areaEffectRuntime';
import { BlazeBurnEffectTracker } from './blazeBurnEffects';
import {
  BlazeFlamethrowerRuntimeTracker,
  resolveBlazeFlamethrowerDamageTargets,
  resolveBlazeFlamethrowerDamageFrame,
  resolveBlazeFlamethrowerFrameState,
} from './blazeFlamethrowerRuntime';
import {
  HookshotRuntimeTracker,
  resolveHookshotDragPullTerrainStep,
  type HookshotAnchorWallInstance,
  type HookshotDragPullAuthorityState,
} from './hookshotRuntime';
import {
  buildChronosLifelineCastPlan,
  buildHookshotAnchorWallPlan,
  buildHookshotGrappleCastPayload,
  buildHookshotGroundHooksCastPayload,
  buildStandardAbilityCastPlan,
  getAbilityUsePreflightRejection,
  type AbilityCasterSnapshot,
  type ChronosLifelineMode,
} from './roomAbilityCastRuntime';
import {
  buildAttackImpactHint,
  getAttackCastKind,
  getAttackDamageResolutionPlan,
  getAttackPreflightRejection,
  getChronosAegisCollisionRadiusForAttack,
  getRoomAttackConfig,
  withHookshotHeavyAttackTargetHint,
  type AttackConfig,
  type AttackMode,
  type AttackTargetTeam,
  type SkillImpactHint,
} from './roomAttackRuntime';
import {
  DEFAULT_GAME_CONFIG,
  DEFAULT_GAMEPLAY_MODE,
  TICK_INTERVAL_MS,
  createGameConfigForGameplayMode,
  HERO_DEFINITIONS,
  ABILITY_DEFINITIONS,
  getHeroStats,
  createRandomSeed,
  getVoxelMapTheme,
  isGameplayMode,
  normalizeVoxelMapSizeId,
  GOLDEN_VOXEL_MAP_THEME_ID,
  toPublicRankSnapshot,
  isInsideBoundaryPolygon,
  isCollisionBlock,
  FLAG_CAPTURE_RADIUS,
  FLAG_PICKUP_RADIUS,
  POWERUP_ABILITY_ATTACK_SPEED_MULTIPLIER,
  POWERUP_MOVEMENT_SPEED_MULTIPLIER,
  ULTIMATE_CHARGE_PER_CAPTURE,
  ULTIMATE_CHARGE_PER_KILL,
  ULTIMATE_CHARGE_PER_SECOND,
  BLAZE_FLAMETHROWER_MAX_FUEL,
  BLAZE_FLAMETHROWER_RANGE,
  BLAZE_FLAMETHROWER_CONE_HALF_ANGLE,
  BLAZE_FLAMETHROWER_DAMAGE,
  BLAZE_FLAMETHROWER_DAMAGE_INTERVAL,
  BLAZE_FLAMETHROWER_BURN_DAMAGE,
  BLAZE_GEARSTORM_RADIUS,
  BLAZE_GEARSTORM_DAMAGE,
  BLAZE_ROCKET_SPEED,
  BLAZE_ROCKET_SPLASH_RADIUS,
  BLAZE_BOMB_SPLASH_RADIUS,
  BLAZE_BOMB_MAX_RANGE,
  BLAZE_BOMB_MIN_RANGE,
  BLAZE_FLAMETHROWER_COLLISION_RADIUS,
  CHRONOS_ASCENDANT_PARADOX_DURATION_MS,
  CHRONOS_ASCENDANT_PARADOX_PULSE_RADIUS,
  CHRONOS_ASCENDANT_PARADOX_PULSE_SPEED,
  CHRONOS_ASCENDANT_PARADOX_SPEED_MULTIPLIER,
  CHRONOS_AEGIS_TARGET_BACK_MAX,
  CHRONOS_LIFELINE_MAX_TARGETS,
  CHRONOS_LIFELINE_RADIUS,
  CHRONOS_TIMEBREAK_SHOCKWAVE_AUTHORITY_MS,
  CHRONOS_TIMEBREAK_SHOCKWAVE_HALF_ANGLE,
  CHRONOS_TIMEBREAK_SHOCKWAVE_KNOCKBACK_FORCE,
  CHRONOS_TIMEBREAK_SHOCKWAVE_MAX_VERTICAL_DELTA,
  CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE,
  CHRONOS_TIMEBREAK_SHOCKWAVE_VERTICAL_FORCE,
  CHRONOS_VERDANT_PULSE_AIM_DISTANCE,
  CHRONOS_VERDANT_PULSE_FIRE_READY_MS,
  CHRONOS_VERDANT_PULSE_SPEED,
  GRAPPLE_MAX_DISTANCE,
  HOOKSHOT_CHAIN_HOOKS_MAX_DISTANCE,
  HOOKSHOT_DRAG_HOOK_MAX_DISTANCE,
  HOOKSHOT_DRAG_HOOK_PULL_FRONT_DISTANCE,
  HOOKSHOT_DRAG_HOOK_PULL_MAX_DURATION_MS,
  HOOKSHOT_DRAG_HOOK_PULL_STOP_DISTANCE,
  HOOKSHOT_DRAG_HOOK_RETRACT_SPEED,
  HOOKSHOT_GROUND_HOOKS_RADIUS,
  HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS,
  PHANTOM_PRIMARY_FIRE_READY_MS,
  PHANTOM_VEIL_SPEED_MULTIPLIER,
  PLAYER_COMBAT_HITBOX_PADDING,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  VOID_RAY_CHARGE_TIME,
  MOVEMENT_PROTOCOL_VERSION,
  MOVEMENT_SUBSTEP_SECONDS,
  MOVEMENT_MAX_PACKET_COMMANDS,
  MOVEMENT_MAX_SERVER_QUEUE,
  inputStateToMovementButtons,
  movementButtonsToInputState,
  isMovementSeqAfter,
  nextMovementSeq,
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
  getAimConeHitAgainstPlayerCombatHitbox,
  getSegmentHitAgainstPlayerCombatHitbox,
  getSegmentHitAgainstChronosAegis,
  calculateFalloffDamage,
} from '@voxel-strike/shared';
import type { 
  AbilityCastOriginHint,
  BotDifficulty,
  PlayerCombatHitResult,
  HeroId, 
  Team, 
  PlayerInput,
  MovementCommand,
  MovementCommandPacket,
  MovementCorrectionReason,
  GameEndEvent,
  GameplayMode,
  MatchMode,
  SelfMovementAuthority,
  MatchSnapshotMessage,
  PhantomShieldBrokenEvent,
  PlayerInterestMessage,
  PlayerDamagedEvent,
  PlayerDeathEvent,
  PlayerHealedEvent,
  PowerupCollectedMessage,
  PlayerTransformsV2Message,
  PlayerVitalsMessage,
  PlayerVitalsSnapshot,
  PlayerVisibilityState,
  PackedPlayerTransform,
  GamePhase,
  VoxelMapManifest,
  VoxelMapSizeId,
  VoxelMapTheme,
} from '@voxel-strike/shared';
import {
  HOOKSHOT_GRAPPLE_EXTENSION_SPEED,
  canCapsuleOccupy,
  createHookshotSwingState,
  resolveCapsuleTeleportDestination,
  simulateSharedMovement,
  stepHookshotSwing,
  sweepCapsulePathClear,
  type MovementCollisionWorld,
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
import { voiceService } from '../voice/VoiceService';
import { wagerService, type LockedWagerContext } from '../wagers/service';
import type { MatchParticipantSnapshot } from '../persistence/matchPersistence';
import { createPlayerReport } from '../reports/playerReportService';
import {
  AntiCheatEvidenceStore,
  AntiCheatRoomRuntime,
  createMovementShadowSimulationState,
  getAntiCheatConfig,
  type AntiCheatIntegrityGate,
} from '../anticheat';
import { AccountRestrictedError, assertGameplayAccountEligible } from '../auth/accountEligibility';
import { consumeReplayNonce } from '../security/replayNonceStore';
import {
  GAME_MESSAGE_RATE_LIMITS,
  MessageRateLimiter,
  type RateLimitRule,
} from './rateLimiter';
import { shouldResolveGenericSecondaryAttack } from './combatInputRouting';
import {
  SecurityEventLogSampler,
  buildRoomSecurityEvent,
  buildSecurityAuthorityEvent,
  getSecurityEventLogLevel,
  type RoomSecurityEventInput,
  type SecurityEvent,
} from './securityEventLogging';
import {
  isHeroId,
  isRecord,
  isTeam,
  validateChatPayload,
  validateHeroPayload,
  validateReadyPayload,
  validateTeamPayload,
} from './protocolValidation';
import {
  buildCreatePlayerReportInput,
  buildPlayerReportEvidenceInput,
  buildPlayerReportResultPayload,
  parsePlayerReportPayload,
  readPlayerReportRequestId,
  validatePlayerReportContext,
  type PlayerReportParticipantSnapshot,
  type PlayerReportResult,
  type PlayerReportRoomSnapshot,
} from './playerReportRuntime';
import {
  buildReconnectParticipantSyncPayload,
  buildRunningGameReconnectTicketRequest,
} from './roomReconnectRuntime';
import {
  getRoomTeamSelectionDecision,
  resolveRoomJoinTeam,
} from './roomTeamSelection';
import {
  resolveRoomJoinPlayerName,
  shouldActivateJoinedPlayer,
  shouldRejectRoomJoinForCapacity,
} from './roomJoinRuntime';
import {
  normalizeVoiceTeam,
  prepareMatchVoiceTokenRequest,
} from './roomVoiceRuntime';
import {
  buildAllNpcsKilledPayload,
  buildNpcDamagedPayload,
  buildNpcErrorPayload,
  buildNpcJoinedPayload,
  buildNpcKilledPayload,
  buildNpcLeftPayload,
  buildNpcSpawnedPayload,
  resolveNpcDamageSourceContext,
  resolveNpcSpawnPosition,
  resolveNpcSpawnTeam,
} from './roomNpcSpawnRuntime';
import { buildAuthRejectRecord } from './authRejectRuntime';
import { buildClientJoinHintRecords } from './clientJoinHintsRuntime';
import {
  BOT_AWARENESS_RANGE,
  BOT_CLOSE_REVEAL_RANGE,
  applyBotAbilityInputPlan,
  chooseBotAbilityPlan,
  chooseBotCombatPlan,
  chooseLocalAvoidanceDirection,
  clearExpiredBlockedEdges,
  composeBotInputMovementState,
  composeBotMovementDirection,
  createInitialBotBrain,
  createSteeringProbeDirections,
  getBotAimReadinessTrace,
  getBotCombatEngagementState,
  getBotPredictedAimPoint,
  getBotSkillProfile,
  getBotYawPitchTowardPosition,
  isBotSecondaryFireWindowOpen,
  normalizeBotDifficulty,
  updateBotAimState,
  updateBotPrimaryFireDecision,
  updateBotMovementRecoveryState,
  updateBotPlanningState,
  updateBotSecondaryFireDecision,
  type BotAbilityGeometry,
  type BotBlackboard,
  type BotBrain,
  type BotPlayerSnapshot,
  type BotRecentDamageSource,
  type BotRoutePlan,
  type BotSkillProfile,
  type BotTeamTacticsByTeam,
  type PlainVec2,
  type PlainVec3,
} from './bot-ai';
import { LineOfSightCache } from './lineOfSightCache';
import { BotRuntimeRegistry } from './botRuntimeRegistry';
import {
  DEV_BOT_LOOK_HOLD_MS,
  DEV_BOT_LOOK_PITCH,
  DEV_BOT_SKILL_HOLD_MS,
  applyDevBotLookOverride,
  applyDevBotSkillOverride,
  resolveDevBotLookDirection,
  resolveDevBotSkillOverride,
  type DevBotLookOverride,
  type DevBotSkillOverride,
  type DevBotSkillSlot,
} from './devBotCommands';
import {
  DevRoomRuntime,
  buildDevBotSpawnProfile,
  parseDevBotLookRequest,
  parseDevBotSkillRequest,
  parseDevHeroTeamRequest,
  parseDevNpcDamageRequest,
  parseDevNpcIdRequest,
  parseDevNpcSpawnRequest,
  readDevEnabledFlag,
  validateDevBotAddRequest,
} from './devRoomRuntime';
import {
  clamp,
  direction2DFromTo,
  distance2D,
  distance3D,
  forward2D,
  getCoarseEventPosition,
  getForwardVector,
  hashString,
  normalize2D,
  normalizeHorizontalPlain,
  vec3SchemaToPlain,
} from './roomMath';
import {
  applyPlayerAliveRuntimeReset,
  createEmptyBotInput,
  createEmptyPlayerInput,
  resetPlayerMovementRuntime,
  stopBotMovement,
} from './playerRuntime';
import {
  applyPowerupPickup,
  PowerupBoostTracker,
  PowerupPickupTracker,
  type MapPowerupPickup,
} from './powerups';
import {
  buildFullPlayerVitalsSnapshot,
  buildPlayerVitalsStats,
  buildPublicEnemyVitalsSnapshot,
  buildVisibleEnemyVitalsSnapshot,
  selectPlayerVitalsForRecipient,
} from './playerVitals';
import {
  getWinningTeam,
  hasTeamReachedScoreLimit,
  isCaptureTheFlagMode,
  isTeamDeathmatchMode,
} from './gameModeRules';
import {
  CTF_TEAMS,
  getBotFlagSnapshots,
  getCarriedFlagCountForPlayer,
  getEnemyTeam,
  getFlagByTeam,
  getFlagSync,
  resetFlagToBase,
  resetFlagsFromManifest,
  setFlagCarried,
  setFlagDroppedAtPlayer,
  syncCarriedFlagPosition,
} from './ctfFlags';

// Import extracted ability handlers
import {
  VOID_ZONE_RADIUS,
  VOID_ZONE_DAMAGE,
  VOID_ZONE_DURATION,
  initializePlayerAbilities,
  resetAbilityCooldowns,
  tryUseAbility,
  executeAbility,
  updateAbilityCooldowns,
  updateActiveAbilities,
  type AbilityUseResult,
} from './abilityHandlers';
import { RoomDamageRuntime, type RoomDamageContext as DamageContext } from './roomDamageRuntime';

type ResolvedAbilityUseResult = {
  abilityId: string;
  abilityDef: NonNullable<AbilityUseResult['abilityDef']>;
  abilityState: AbilityStateSchema;
};

interface PlayerStateStreamRecipientSendResult {
  sentVitals: boolean;
  sentInterest: boolean;
}

interface CreateOptions {
  lobbyId?: string;
  lobbyName?: string;
  matchMode?: MatchMode;
  gameplayMode?: GameplayMode;
  mapSeed?: number;
  mapThemeId?: VoxelMapTheme['id'] | null;
  mapSize?: VoxelMapSizeId | null;
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

interface BotAssignment {
  playerId: string;
  playerName: string;
  team: Team;
  isBot: true;
  heroId?: HeroId;
  botDifficulty?: BotDifficulty;
  botProfileId?: string;
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

interface BotFrameContext {
  snapshots: BotPlayerSnapshot[];
  snapshotById: Map<string, BotPlayerSnapshot>;
  flags: ReturnType<typeof getBotFlagSnapshots>;
  teamTactics: BotTeamTacticsByTeam;
  protectedEnemyIdsByTeam: Record<Team, Set<string>>;
  visibleEnemyIdsByBot: Map<string, Set<string>>;
  enemyLineOfSightIdsByBot: Map<string, Set<string>>;
}

interface AimTargetHit {
  target: Player;
  hit: PlayerCombatHitResult;
}

interface ChronosAegisSkillHit {
  blocker: Player;
  point: PlainVec3;
  normal: PlainVec3;
  distance: number;
}

const BLAZE_ROCKET_AIM_DISTANCE = 120;
const BLAZE_BOMB_FALL_DURATION_MS = 1500;
const BLAZE_BOMB_WARNING_LEAD_MS = 350;
const ABILITY_CAST_HINT_MAX_DISTANCE_FROM_FALLBACK = 1.15;
const ABILITY_CAST_HINT_MAX_DISTANCE_FROM_PLAYER_CENTER = 1.7;
const ABILITY_CAST_HINT_MAX_VERTICAL_FROM_PLAYER_CENTER = 1.15;

const BLAZE_FLAMETHROWER_CONE_DOT = Math.cos(BLAZE_FLAMETHROWER_CONE_HALF_ANGLE);
const PLAYER_VITALS_INTERVAL_MS = 125;
const PLAYER_VITALS_RECONCILE_INTERVAL_MS = 2500;
const TRANSFORM_HIGH_RELEVANCE_DISTANCE_SQ = 48 * 48;
const RECENT_COMBAT_TRANSFORM_MS = 650;
const RECENT_COMBAT_INTEREST_MS = 900;
const PLAYER_INTEREST_INTERVAL_MS = 200;
const MATCH_SNAPSHOT_DRIFT_SYNC_INTERVAL_MS = 2000;
const LOW_FREQUENCY_STATE_INTERVAL_MS = 250;
const CHRONOS_AEGIS_SHIELD_TRANSFORM_SCALE = 255;
const OBJECTIVE_SUPPRESSION_MS = 650;
const SECURITY_EVENT_LOG_SAMPLE_MS = 5000;
const MOVEMENT_CORRECTION_LOG_SAMPLE_MS = 1000;
const MAX_SECURITY_LOG_SAMPLE_KEYS = 1024;
const DEV_COMMANDS_DISABLED_MESSAGE = 'Developer commands are disabled';
const HOOKSHOT_SPEED = 38;
const DRAG_HOOK_SPEED = 50;
export class GameRoom extends Room<GameState> {
  maxClients = DEFAULT_GAME_CONFIG.maxPlayers;

  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private matchStartCancelTimeout: ReturnType<typeof setTimeout> | null = null;
  private matchCancelDisconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly roomTimeouts = new RoomTimeoutRegistry();
  private readonly playerPressStates = new PlayerPressStateTracker();
  private config = createGameConfigForGameplayMode();
  private lobbyId: string | null = null;
  private lobbyName: string | null = null;
  private readonly voidZones = new VoidZoneTracker();
  private readonly phantomPrimaryMagazines = new PhantomPrimaryMagazineTracker();
  private readonly phantomPrimaryHolds = new PlayerHoldTracker();
  private readonly chronosPrimaryHolds = new PlayerHoldTracker();
  private readonly phantomVoidRayCharges = new PhantomVoidRayChargeTracker();
  private readonly abilityIds = new RoomAbilityIdGenerator();
  private readonly phantomPrimaryLaunchSide = new AlternatingLaunchSideTracker();
  private readonly hookshotPrimaryLaunchSide = new AlternatingLaunchSideTracker();
  private readonly hookshotRuntime = new HookshotRuntimeTracker();
  private readonly playerRoots = new PlayerRootTracker();
  private readonly powerupPickups = new PowerupPickupTracker();
  private readonly powerupBoosts = new PowerupBoostTracker();
  private readonly pendingAreaDamage = new PendingAreaDamageQueue();
  private readonly blazeGearstorms = new BlazeGearstormTracker();
  private readonly blazeFlamethrowers = new BlazeFlamethrowerRuntimeTracker();
  private readonly blazeBurns = new BlazeBurnEffectTracker();
  private readonly npcs = new RoomNpcRegistry();
  private readonly movementAuthorities = new MovementAuthorityRegistry({
    maxServerQueue: MOVEMENT_MAX_SERVER_QUEUE,
    maxPacketCommands: MOVEMENT_MAX_PACKET_COMMANDS,
  });
  private readonly botRuntime = new BotRuntimeRegistry<BotBrain>();
  private readonly attackCooldowns = new AttackCooldownTracker();
  private readonly playerCombatActivity = new PlayerCombatActivityTracker();
  private readonly chronosAegisShields = new ChronosAegisShieldTracker();
  private readonly devRuntime = new DevRoomRuntime();
  private readonly mapRuntime = new RoomMapRuntime({
    getMapConfig: () => ({
      mapSeed: this.state.mapSeed,
      mapThemeId: this.state.mapThemeId as VoxelMapTheme['id'] | null,
      mapSize: this.state.mapSize as VoxelMapSizeId | null,
    }),
    getCollisionAabbs: (bounds) => this.hookshotRuntime.getAnchorWallAabbs(this.state.serverTime || Date.now(), bounds),
  });
  
  private readonly clientRegistry = new RoomClientRegistry<Client>();
  private lastVitalsBroadcastAt = 0;
  private lastMatchSnapshotBroadcastAt = 0;
  private lastInterestBroadcastAt = 0;
  private lastLowFrequencyStateAt = 0;
  private readonly replicationState = new PlayerReplicationStateTracker();
  private readonly visibilityInterest = new VisibilityInterestManager();
  private readonly replicationFrames = new ReplicationFrameRuntime({
    visibilityInterest: this.visibilityInterest,
    getMovementCollisionRevision: (now) => this.getMovementCollisionRevision(now),
    hasLineOfSight: (from, to) => this.hasLineOfSight(from, to),
    getRecentCombatRevealUntil: (recipientId, targetId) => (
      this.replicationState.getRecentCombatInterestUntil(recipientId, targetId)
    ),
    buildPackedTransform: (id, player) => this.buildPackedTransform(id, player),
  });
  private matchSnapshotSignature = '';
  private readonly playerPings = new PlayerPingRuntime();
  private readonly playerSpatialIndex = new PlayerSpatialIndex(8);
  private readonly playerSpatialQueries = new PlayerSpatialQueries(this.playerSpatialIndex);
  private readonly roomMetrics = new RoomMetrics();
  private eventLoopDelay: IntervalHistogram | null = null;
  private readonly lineOfSightCache = new LineOfSightCache();
  private readonly rateLimiter = new MessageRateLimiter();
  private readonly participantRegistry = new RoomParticipantRegistry();
  private readonly antiCheatEvidenceStore = new AntiCheatEvidenceStore(prisma);
  private readonly matchFinalization = createRoomMatchFinalizationRuntime({
    evidenceStore: this.antiCheatEvidenceStore,
    serializeError: (error) => this.serializePersistenceError(error),
  });
  private readonly matchSummary = new MatchSummaryRuntime({
    getDurableUserId: (playerId) => this.getDurableUserId(playerId),
    isNpc: (playerId) => this.npcs.has(playerId),
    getRankPayload: buildRoomRankSnapshot,
  });
  private readonly matchSnapshots = new MatchSnapshotRuntime();
  private antiCheat: AntiCheatRoomRuntime | null = null;
  private readonly securityLogSampler = new SecurityEventLogSampler<SecurityEvent>({
    securityEventIntervalMs: SECURITY_EVENT_LOG_SAMPLE_MS,
    movementCorrectionIntervalMs: MOVEMENT_CORRECTION_LOG_SAMPLE_MS,
    maxKeys: MAX_SECURITY_LOG_SAMPLE_KEYS,
  });
  private readonly damageRuntime = new RoomDamageRuntime({
    getPlayerById: (playerId) => this.state.players.get(playerId) ?? null,
    isDevelopmentMode: () => this.isDevelopmentMode(),
    isPlayerDevImmune: (playerId) => this.devRuntime.isPlayerImmune(playerId),
    getRespawnDelayMs: () => this.config.respawnTimeSeconds * 1000,
    vec3ToPlain: vec3SchemaToPlain,
    normalize3D: (value) => this.normalize3D(value),
    getPlayerEyePosition: (player) => this.getPlayerEyePosition(player),
    shouldDamageBypassChronosAegis: (damageType, context) => this.shouldDamageBypassChronosAegis(damageType, context),
    getChronosAegisBlockerHit: (target, source, sourcePoint) => this.getChronosAegisBlockerHit(target, source, sourcePoint),
    absorbDamageWithChronosAegis: (blocker, rawDamage, now, context) => this.absorbDamageWithChronosAegis(blocker, rawDamage, now, context),
    rejectAbilityOrCombat: (player, reason) => this.rejectAbilityOrCombat(player, reason),
    markCombatActivityBetween: (source, target, now) => this.playerCombatActivity.markBetween(source, target, now),
    markRecentCombatTransform: (playerId, now) => this.replicationState.markRecentCombatTransform(playerId, now, RECENT_COMBAT_TRANSFORM_MS),
    markRecentCombatInterest: (sourceId, targetId, now) => (
      this.replicationState.markRecentCombatInterest(sourceId, targetId, now, RECENT_COMBAT_INTEREST_MS)
    ),
    broadcastPhantomShieldBroken: (target, source, payload) => this.broadcastPhantomShieldBroken(target, source, payload),
    broadcastPlayerDamaged: (target, source, payload) => this.broadcastPlayerDamaged(target, source, payload),
    broadcastPlayerKilled: (target, killer, payload) => this.broadcastPlayerKilled(target, killer, payload),
    recordMatchDeath: (victim, killer) => this.recordMatchDeath(victim, killer),
    recordMatchKill: (killer, victim) => this.recordMatchKill(killer, victim),
    recordMatchAssist: (assister, victim) => this.recordMatchAssist(assister, victim),
    resetPlayerLifeRuntime: (player, deathAt) => this.resetPlayerLifeRuntime(player, deathAt),
    isCaptureTheFlagMode: () => isCaptureTheFlagMode(this.gameplayMode),
    dropFlag: (player) => this.dropFlag(player),
    scoreTeamDeathmatchKill: (killer, victim) => this.scoreTeamDeathmatchKill(killer, victim),
    removeNpcPlayer: (playerId) => this.removeNpcPlayer(playerId),
  });
  private readonly matchLedger = new MatchLedgerRuntime({
    getConfig: () => ({
      roomId: this.roomId,
      lobbyId: this.lobbyId,
      matchMode: this.matchMode,
      mapSeed: this.state.mapSeed,
      mapThemeId: this.state.mapThemeId as VoxelMapTheme['id'],
      rankedEligible: this.rankedEligibilityCandidate,
    }),
    getDurableUserId: (playerId) => this.getDurableUserId(playerId),
    isNpc: (playerId) => this.npcs.has(playerId),
  });
  private wagerContext: LockedWagerContext | null = null;
  private rankedEligibilityCandidate = false;
  private requiredHumanPlayers = 1;
  private rankedRequiredHumanPlayers = DEFAULT_GAME_CONFIG.maxPlayers;
  private reservedHumanPlayers = 0;
  private matchMode: MatchMode = 'custom';
  private gameplayMode: GameplayMode = DEFAULT_GAMEPLAY_MODE;
  private wagerSettlementRequested = false;
  private readonly matchStartGate = new MatchStartGateTracker();
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
        this.participantRegistry.rememberReconnectParticipant(ticket);
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

  private createRunningGameReconnectTicket(
    auth: RoomAuthContext,
    options: JoinOptions
  ): GameEntryTicketClaims | null {
    const ticketRequest = buildRunningGameReconnectTicketRequest({
      reconnectToRunningGame: options.reconnectToRunningGame,
      userId: auth.userId,
      lobbyId: this.lobbyId,
      gameRoomId: this.roomId,
      matchCancelled: this.matchCancelled,
      phase: this.state.phase,
      now: Date.now(),
    });
    return ticketRequest ? this.participantRegistry.createRunningGameReconnectTicket(ticketRequest) : null;
  }

  private syncReconnectParticipantFromPlayer(player: Player): void {
    this.participantRegistry.syncReconnectParticipant(buildReconnectParticipantSyncPayload(player));
  }

  private onRateLimitedMessage<T = unknown>(
    type: string,
    rule: RateLimitRule,
    handler: (client: Client, data: T) => void,
    onDrop?: (client: Client, data: T) => void
  ): void {
    this.onMessage(type, (client, data: T) => {
      if (!this.rateLimiter.consume(client.sessionId, type, rule)) {
        this.recordRateLimitDrop(client.sessionId, type);
        onDrop?.(client, data);
        return;
      }

      handler(client, data);
    });
  }

  private onParsedDevCommand<T>(
    type: string,
    parse: (data: unknown) => T | null,
    handler: (client: Client, request: T) => void,
    errorResponse?: { logMessage: string; clientMessage: string }
  ): void {
    this.onRateLimitedMessage(type, GAME_MESSAGE_RATE_LIMITS.devCommand, (client, data: unknown) => {
      const runHandler = () => {
        const request = parse(data);
        if (request === null) return;
        handler(client, request);
      };

      if (!errorResponse) {
        runHandler();
        return;
      }

      try {
        runHandler();
      } catch (error) {
        loggers.room.error(errorResponse.logMessage, error);
        client.send('devCommandError', { message: errorResponse.clientMessage });
      }
    });
  }

  private onDevFlagCommand(
    type: string,
    handler: (client: Client, enabled: boolean) => void
  ): void {
    this.onRateLimitedMessage(type, GAME_MESSAGE_RATE_LIMITS.devCommand, (client, data: unknown) => {
      handler(client, readDevEnabledFlag(data));
    });
  }

  private onDevClientCommand(
    type: string,
    handler: (client: Client) => void
  ): void {
    this.onRateLimitedMessage(type, GAME_MESSAGE_RATE_LIMITS.devCommand, (client) => {
      handler(client);
    });
  }

  onCreate(options: CreateOptions) {
    this.eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
    this.eventLoopDelay.enable();
    this.lobbyId = options.lobbyId || null;
    this.lobbyName = options.lobbyName || null;
    this.matchMode = options.matchMode ?? options.wagerContext?.matchMode ?? (options.wagerContext ? 'custom_wager' : 'custom');
    this.gameplayMode = isGameplayMode(options.gameplayMode) ? options.gameplayMode : DEFAULT_GAMEPLAY_MODE;
    this.config = createGameConfigForGameplayMode(this.gameplayMode);
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
      getMatchId: () => this.matchLedger.getMatchId(),
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
    this.state.gameplayMode = this.gameplayMode;
    this.state.mapSeed = typeof options.mapSeed === 'number'
      ? options.mapSeed >>> 0
      : createRandomSeed();
    this.state.mapThemeId = options.mapThemeId ?? getVoxelMapTheme(this.state.mapSeed).id;
    this.state.mapSize = normalizeVoxelMapSizeId(options.mapSize);
    this.refreshMapManifest();
    loggers.room.info('Map seed', this.state.mapSeed);
    resetFlagsFromManifest(this.state, this.getMapManifest());
    this.createBotsFromAssignments(options.botAssignments || []);
    this.updateMetadata();
    this.startMatchStartCancelTimer();

    // Set up tick loop
    this.tickInterval = setInterval(() => this.tick(), TICK_INTERVAL_MS);

    this.registerCoreMessageHandlers();
    if (this.isDevelopmentMode()) {
      this.registerDevelopmentMessageHandlers();
    }
  }

  private registerCoreMessageHandlers(): void {
    this.onRateLimitedMessage('movementCommands', GAME_MESSAGE_RATE_LIMITS.movementCommands, (client, packet: MovementCommandPacket) => {
      this.handleMovementCommandPacket(client, packet);
    });

    this.onRateLimitedMessage('selectHero', GAME_MESSAGE_RATE_LIMITS.selection, (client, data: unknown) => {
      try {
        const heroId = validateHeroPayload(data);
        if (!heroId) return;
        this.handleHeroSelect(client, heroId);
      } catch (error) {
        loggers.room.error('Failed to apply hero selection:', error);
        client.send('devCommandError', { message: 'Failed to switch hero' });
      }
    });

    this.onRateLimitedMessage('selectTeam', GAME_MESSAGE_RATE_LIMITS.selection, (client, data: unknown) => {
      const team = validateTeamPayload(data);
      if (!team) return;
      this.handleTeamSelect(client, team);
    });

    this.onRateLimitedMessage('ready', GAME_MESSAGE_RATE_LIMITS.selection, (client, data: unknown) => {
      const ready = validateReadyPayload(data);
      if (ready === null) return;
      this.handleReady(client, ready);
    });

    this.onRateLimitedMessage('matchSceneReady', GAME_MESSAGE_RATE_LIMITS.matchSceneReady, (client, data: unknown) => {
      this.handleMatchSceneReady(client, data);
    });

    this.onRateLimitedMessage('chat', GAME_MESSAGE_RATE_LIMITS.chat, (client, data: unknown) => {
      const chat = validateChatPayload(data, { teamOnly: true });
      if (!chat) return;
      this.handleChat(client, chat.message, chat.teamOnly);
    });

    this.onRateLimitedMessage('playerReport', GAME_MESSAGE_RATE_LIMITS.playerReport, (client, data: unknown) => {
      void this.handlePlayerReport(client, data);
    }, (client, data) => {
      const requestId = readPlayerReportRequestId(data);
      this.sendPlayerReportResult(client, requestId, {
        ok: false,
        error: 'Please wait before sending another report',
      });
    });

    this.onRateLimitedMessage('requestVoiceToken', GAME_MESSAGE_RATE_LIMITS.voiceToken, (client, data: unknown) => {
      void this.handleVoiceTokenRequest(client, data);
    });

    this.onRateLimitedMessage('playerPingResponse', GAME_MESSAGE_RATE_LIMITS.playerPingResponse, (client, data: unknown) => {
      this.handlePlayerPingResponse(client, data);
    });
  }

  private registerDevelopmentMessageHandlers(): void {
    this.onParsedDevCommand(
      'devSetHero',
      validateHeroPayload,
      (client, heroId) => this.handleDevSetHero(client, heroId),
      {
        logMessage: 'Failed to apply dev hero switch:',
        clientMessage: 'Failed to switch hero',
      }
    );

    // Development-only entity helpers. Production bots are lobby participants.
    this.onParsedDevCommand('spawnNpc', parseDevNpcSpawnRequest, (client, request) => {
      this.handleSpawnNpc(client, request);
    });
    this.onParsedDevCommand('damageNpc', parseDevNpcDamageRequest, (client, request) => {
      this.handleDamageNpc(client, request);
    });
    this.onParsedDevCommand('killNpc', parseDevNpcIdRequest, (client, request) => {
      this.handleKillNpc(client, request);
    });
    this.onDevClientCommand('killAllNpcs', (client) => this.handleKillAllNpcs(client));
    this.onDevFlagCommand('setDevImmune', (client, enabled) => {
      this.handleSetDevImmune(client, enabled);
    });
    this.onDevClientCommand('devFillUltimate', (client) => this.handleDevFillUltimate(client));
    this.onDevClientCommand('devEndGame', (client) => this.handleDevEndGame(client));
    this.onDevClientCommand('devSetObserver', (client) => this.handleDevSetObserver(client));
    this.onDevFlagCommand('setDevTimeFrozen', (client, enabled) => {
      this.handleSetDevTimeFrozen(client, enabled);
    });
    this.onDevFlagCommand('setDevBotsRooted', (client, enabled) => {
      this.handleSetDevBotsRooted(client, enabled);
    });
    this.onDevFlagCommand('setDevBotBrainEnabled', (client, enabled) => {
      this.handleSetDevBotBrainEnabled(client, enabled);
    });
    this.onParsedDevCommand('devAddBot', parseDevHeroTeamRequest, (client, request) => {
      this.handleDevAddBot(client, request);
    });
    this.onParsedDevCommand('devBotSkill', parseDevBotSkillRequest, (client, request) => {
      this.handleDevBotSkill(client, request);
    });
    this.onParsedDevCommand('devBotLook', parseDevBotLookRequest, (client, request) => {
      this.handleDevBotLook(client, request);
    });
  }

  onJoin(client: Client, options: JoinOptions) {
    if (this.matchCancelled) {
      client.send('matchCancelled', this.buildMatchCancelledPayload(
        this.matchCancelNotice ?? createStartTimeoutCancelNotice()
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

    this.participantRegistry.setSession(client.sessionId, authContext, entryTicket);

    if (authContext.userId) {
      this.disconnectDuplicateIdentitySession(client.sessionId, authContext.userId);
      this.clientRegistry.setIdentity(authContext.userId, client.sessionId);
    }

    if (shouldRejectRoomJoinForCapacity({
      joinsAsObserver,
      playerCount: this.state.players.size,
      maxPlayers: this.config.maxPlayers,
    })) {
      client.send('error', { message: 'Game room is full' });
      this.participantRegistry.clearSession(client.sessionId);
      this.clientRegistry.clearIdentityForSession(client.sessionId);
      client.leave();
      return;
    }

    if (joinsAsObserver) {
      this.joinObserver(client);
      return;
    }

    const player = this.createJoinedHumanPlayer(client.sessionId, authContext, entryTicket, options);
    this.syncReconnectParticipantFromPlayer(player);

    // Send existing players to the new client with recipient-scoped position data.
    this.state.players.forEach((existingPlayer) => {
      this.sendPlayerJoinedSnapshot(client, existingPlayer, player);
    });

    this.state.players.set(client.sessionId, player);
    this.clientRegistry.setClient(client.sessionId, client);
    this.replicationState.markKnownPlayer(client.sessionId);
    this.resetCountdownStartGate();
    this.playerPings.markDirty();
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

  private joinObserver(client: Client): void {
    this.clientRegistry.addObserver(client.sessionId, client);
    this.playerPings.markDirty();
    this.updateMetadata();
    this.state.players.forEach((existingPlayer) => {
      this.sendPlayerJoinedSnapshot(client, existingPlayer, null);
    });
    this.sendCurrentSnapshots(client);
    this.requestPlayerPing(client, Date.now());
    loggers.room.info('Observer join complete', {
      sessionId: client.sessionId,
      totalObservers: this.clientRegistry.getObserverCount(),
    });
    this.checkPhaseTransition();
  }

  private createJoinedHumanPlayer(
    sessionId: string,
    authContext: RoomAuthContext,
    entryTicket: GameEntryTicketClaims | null,
    options: JoinOptions
  ): Player {
    this.initializePressState(sessionId);

    const player = new Player();
    player.id = sessionId;
    player.name = resolveRoomJoinPlayerName({
      ticketDisplayName: entryTicket?.displayName,
      authDisplayName: authContext.displayName,
      playerNumber: this.state.players.size + 1,
    });
    player.team = resolveRoomJoinTeam({
      players: this.state.players.values(),
      assignedTeam: entryTicket?.assignedTeam,
      preferredTeam: options.preferredTeam,
    });
    player.state = 'selecting';
    player.isBot = false;
    player.botDifficulty = '';
    player.botProfileId = '';
    applyRoomRankState(player, toPublicRankSnapshot(authContext.rank));

    this.assignPlayerSpawnPosition(player);
    if (entryTicket?.selectedHero && isHeroId(entryTicket.selectedHero)) {
      this.setPlayerHero(player, entryTicket.selectedHero);
    }
    if (shouldActivateJoinedPlayer({
      phase: this.state.phase,
      heroId: player.heroId,
    })) {
      player.state = 'alive';
      this.placePlayerAtSpawn(player, 'respawn');
    }

    return player;
  }

  private disconnectDuplicateIdentitySession(newSessionId: string, userId: string): void {
    const existingSessionId = this.clientRegistry.getSessionIdForIdentity(userId);
    if (!existingSessionId || existingSessionId === newSessionId) return;

    loggers.room.info('Duplicate session detected, kicking old session', existingSessionId);
    this.recordSecurityEvent({
      type: 'auth_duplicate_session',
      playerId: newSessionId,
      userId,
      movementEpoch: this.getMovementAuthority(newSessionId).movementEpoch,
      reason: 'duplicate_identity',
      detail: { previousSessionId: existingSessionId },
    });

    const oldClient = this.clients.find((candidate) => candidate.sessionId === existingSessionId);
    if (oldClient) {
      oldClient.send('duplicateSession', { reason: 'Connected from another tab/window' });
      oldClient.leave(4000);
    }

    const oldPlayer = this.state.players.get(existingSessionId);
    void this.removeVoiceParticipantForPlayer(existingSessionId, normalizeVoiceTeam(oldPlayer?.team), 'duplicate_session');
    if (oldPlayer) {
      this.markMatchParticipantLeft(oldPlayer);
    }
    if (oldPlayer?.hasFlag) {
      this.dropFlag(oldPlayer);
    }
    this.state.players.delete(existingSessionId);
    this.clearCombatPlayerRuntimeState(existingSessionId);
    this.clientRegistry.clearSession(existingSessionId);
    this.participantRegistry.clearSession(existingSessionId);
    this.rateLimiter.clearScope(existingSessionId);
    this.clearPlayerReplicationState(existingSessionId);
    this.resetCountdownStartGate();
    this.broadcastTracked('playerLeft', { playerId: existingSessionId });
  }

  onLeave(client: Client, consented: boolean) {
    loggers.room.info('Player left', client.sessionId, 'consented', consented);

    const player = this.state.players.get(client.sessionId);
    if (!player && this.clientRegistry.isObserver(client.sessionId)) {
      this.clientRegistry.clearSession(client.sessionId);
      this.clearPlayerReplicationState(client.sessionId);
      this.participantRegistry.clearSession(client.sessionId);
      this.rateLimiter.clearScope(client.sessionId);
      this.matchStartGate.clearPlayer(client.sessionId);
      this.playerPings.markDirty();

      this.updateMetadata();
      return;
    }

    void this.removeVoiceParticipantForPlayer(client.sessionId, normalizeVoiceTeam(player?.team), consented ? 'leave' : 'disconnect');

    // Handle flag drop if carrying
    if (player?.hasFlag) {
      this.dropFlag(player);
    }
    if (player) {
      this.markMatchParticipantLeft(player);
    }

    this.state.players.delete(client.sessionId);
    this.clientRegistry.deleteClient(client.sessionId);
    this.clearPlayerReplicationState(client.sessionId);
    this.clearCombatPlayerRuntimeState(client.sessionId);
    this.participantRegistry.clearSession(client.sessionId);
    this.rateLimiter.clearScope(client.sessionId);
    this.updateMetadata();
    this.resetCountdownStartGate();

    this.clientRegistry.clearIdentityForSession(client.sessionId);

    this.broadcastTracked('playerLeft', {
      playerId: client.sessionId,
    });
    this.broadcastStateStreams({ transforms: false, forceVitals: true, forceMatch: true });

    // Check if game should end
    this.checkPhaseTransition();
  }

  private clearCombatPlayerRuntimeState(playerId: string): void {
    this.playerPressStates.clear(playerId);
    this.phantomPrimaryMagazines.clear(playerId);
    this.clearPrimaryHoldStates(playerId);
    this.phantomVoidRayCharges.clear(playerId);
    this.phantomPrimaryLaunchSide.clear(playerId);
    this.hookshotPrimaryLaunchSide.clear(playerId);
    this.hookshotRuntime.clearPlayer(playerId);
    this.playerRoots.clear(playerId);
    this.powerupBoosts.clear(playerId);
    this.blazeFlamethrowers.clearPlayer(playerId);
    this.blazeBurns.clearPlayer(playerId);
    this.movementAuthorities.delete(playerId);
    this.chronosAegisShields.clear(playerId);
    this.attackCooldowns.clearPlayer(playerId);
    this.playerCombatActivity.clear(playerId);
    this.devRuntime.clearPlayer(playerId);
    this.matchStartGate.clearPlayer(playerId);
  }

  onDispose() {
    loggers.room.info('Room disposing', this.roomId);
    this.clearMatchStartCancelTimer();
    this.clearMatchCancelDisconnectTimer();
    this.eventLoopDelay?.disable();
    this.roomTimeouts.clear();
    this.antiCheat?.flushAggregates();
    void this.antiCheatEvidenceStore.flush();
    this.state.players.forEach((player, playerId) => {
      if (!player.isBot) {
        void this.removeVoiceParticipantForPlayer(playerId, normalizeVoiceTeam(player.team), 'room_dispose');
      }
    });
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.blazeFlamethrowers.clearDamageTicks();
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

  private buildMatchCancelledPayload(notice: PreMatchCancelNotice): Record<string, unknown> {
    return buildMatchCancelledPayload({
      notice,
      roomId: this.roomId,
      requiredHumanPlayers: this.requiredHumanPlayers,
      connectedHumanPlayers: this.getConnectedHumanPlayerCount(),
      deadlineAt: this.matchStartDeadlineAt,
      refundedWager: Boolean(this.wagerContext),
      serverTime: Date.now(),
    });
  }

  private cancelPreMatch(reason: PreMatchCancelReason, details: PreMatchCancelNoticeDetails | null = null): void {
    if (!canCancelPreMatch({ matchCancelled: this.matchCancelled, phase: this.state.phase })) {
      return;
    }

    this.matchCancelled = true;
    this.matchCancelNotice = buildPreMatchCancelNotice(reason, details);
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
      this.roomMetrics.recordTickDuration(performance.now() - tickStartedAt);
    }
  }

  private rebuildPlayerSpatialIndex(): void {
    this.playerSpatialIndex.rebuild(this.state.players.values());
  }

  private getEnemyPlayers(team: Team): Player[] {
    return this.playerSpatialIndex.getEnemyPlayers(team);
  }

  private updateCountdown() {
    if (hasPhaseDeadlineElapsed(this.state.phaseEndTime, Date.now())) {
      this.startPlaying();
    }
  }

  private updatePlaying() {
    const now = Date.now();
    const dt = TICK_INTERVAL_MS / 1000;

    // Update round timer
    if (this.state.roundStartTime && !this.devRuntime.isGameClockFrozen()) {
      this.state.roundTimeRemaining = getRoomRoundTimeRemaining({
        roundStartTime: this.state.roundStartTime,
        roundTimeRemaining: this.state.roundTimeRemaining,
        roundTimeSeconds: this.config.roundTimeSeconds,
        now,
      });

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

      const chronosTempoMultiplier = this.getChronosTimebreakTempoMultiplier(player);
      const abilityTempoMultiplier = this.getAbilityTempoMultiplier(player, now);

      // Update ability cooldowns
      updateAbilityCooldowns(player, dt, abilityTempoMultiplier);
      this.updateTimeScaledSkillTimers(player, dt, abilityTempoMultiplier, now);

      // Passive ultimate charge
      if (player.ultimateCharge < 100) {
        player.ultimateCharge = Math.min(
          100,
          player.ultimateCharge + ULTIMATE_CHARGE_PER_SECOND * dt * chronosTempoMultiplier
        );
      }

      // Process active abilities (like Phantom Veil)
      updateActiveAbilities(player, now);
      this.syncChronosAscendantMovementState(player, now);
    });
    this.updateChronosAegisShields(dt);
    this.playerRoots.clearExpired(now);

    // Update void zones (damage enemies inside)
    this.updateVoidZones(now);

    this.updatePendingAreaDamage(now);
    this.updateBlazeGearstorms(now);
    this.cleanupDamageWindows(now);

    // Update held Blaze flamethrowers
    this.updateBlazeFlamethrowers(now, dt);
    this.updateBlazeBurns(now);
    this.playerCombatActivity.updateOutOfCombatHealthRegens(this.state.players.values(), now, dt);

    // Update physics simulation (simplified)
    this.updatePhysics();

    // Update map pickups after movement so collection uses the latest authoritative position.
    this.updatePowerupPickups(now);

    // Update CTF objective interactions after movement.
    if (isCaptureTheFlagMode(this.gameplayMode)) {
      this.updateCTFObjectives(now);
    }

    this.broadcastStateStreams();
  }

  // Ability cooldown and active ability updates are now in abilityHandlers.ts

  private collectPowerupPickup(
    player: Player,
    pickup: MapPowerupPickup,
    now: number
  ): boolean {
    const result = applyPowerupPickup({
      player,
      pickup,
      now,
      powerupPickups: this.powerupPickups,
      powerupBoosts: this.powerupBoosts,
    });
    if (!result) return false;

    if (result.healing) {
      this.broadcastPlayerHealed(player, {
        sourceId: player.id,
        abilityId: 'health_pack',
        sourcePosition: result.healing.position,
        targets: [{
          targetId: player.id,
          amount: result.healing.amount,
          newHealth: result.healing.newHealth,
          position: result.healing.position,
        }],
        timestamp: now,
      });
    }

    this.broadcastPowerupCollected(player, result.message);
    return true;
  }

  private updatePowerupPickups(now: number): void {
    const pickups = this.getMapManifest().gameplay.powerups ?? [];
    if (pickups.length === 0) return;

    for (const player of this.playerSpatialIndex.getAlivePlayers()) {
      for (const pickup of pickups) {
        if (this.powerupPickups.getAvailableAt(pickup.id) > now) continue;
        if (distance2D(player.position, pickup.position) > pickup.radius + PLAYER_RADIUS) continue;
        if (this.collectPowerupPickup(player, pickup, now)) break;
      }
    }
  }

  private getPlayerNetId(playerId: string): number {
    return this.replicationState.getPlayerNetId(playerId);
  }

  private forceTransformFullSync(): void {
    this.replicationState.forceTransformFullSync();
  }

  private clearPlayerReplicationState(playerId: string): void {
    this.replicationState.clearPlayer(playerId);
    this.visibilityInterest.clearPlayer(playerId);
    this.playerPings.clearPlayer(playerId);
  }

  private getVitalsReplicationState(recipientId: string): PlayerVitalsReplicationState {
    return this.replicationState.getVitalsState(recipientId);
  }

  private getInterestSignatureState(recipientId: string): Map<string, string> {
    return this.replicationState.getInterestSignatures(recipientId);
  }

  private buildReplicationFrameContext(now = this.state.serverTime || Date.now()): ReplicationFrameContext {
    return this.replicationFrames.buildFrameContext(this.state.players, now);
  }

  private getRecipientInterest(
    recipient: Player | null,
    target: Player,
    now = this.state.serverTime || Date.now(),
    frameContext?: ReplicationFrameContext
  ): RecipientInterestDecision {
    return this.replicationFrames.getRecipientInterest(recipient, target, now, frameContext);
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
      this.replicationState.getRecentCombatTransformUntil(id) > now ||
      this.isVisibleAbilityActive(player)
    );
  }

  private getTransformReplicationState(recipientId: string): TransformReplicationState {
    return this.replicationState.getTransformState(recipientId);
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

  private buildPackedTransform(id: string, player: Player): PackedPlayerTransform {
    return buildPackedPlayerTransform({
      netId: this.getPlayerNetId(id),
      player,
      movementEpoch: this.getMovementAuthority(id).movementEpoch,
      chronosAegisActive: this.isChronosAegisActive(player),
      chronosAegisShieldByte: this.getChronosAegisShieldByte(player),
    });
  }

  private getBlazeBurnUntil(playerId: string): number | null {
    return this.blazeBurns.getBurnUntil(playerId);
  }

  private buildPlayerVitals(
    id: string,
    player: Player,
    visibility: PlayerVisibilityState = 'visible'
  ): PlayerVitalsSnapshot {
    const now = this.state.serverTime || Date.now();
    return buildFullPlayerVitalsSnapshot({
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
      rank: buildRoomRankSnapshot(player),
      health: player.health,
      maxHealth: player.maxHealth,
      ultimateCharge: player.ultimateCharge,
      onFireUntil: this.getBlazeBurnUntil(id),
      powerupBoostUntil: this.powerupBoosts.getUntil(id, now),
      hasFlag: player.hasFlag,
      movement: player.movement,
      abilities: player.abilities,
      stats: player,
      respawnTime: player.respawnTime || null,
      spawnProtectionUntil: player.spawnProtectionUntil || null,
      now,
      visibility,
    });
  }

  private buildVisibleEnemyVitals(
    id: string,
    player: Player,
    visibility: PlayerVisibilityState
  ): PlayerVitalsSnapshot {
    const full = this.buildPlayerVitals(id, player, visibility);
    return buildVisibleEnemyVitalsSnapshot(full, visibility);
  }

  private buildPublicEnemyVitals(
    id: string,
    player: Player,
    visibility: PlayerVisibilityState
  ): PlayerVitalsSnapshot {
    return buildPublicEnemyVitalsSnapshot({
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
      rank: buildRoomRankSnapshot(player),
      maxHealth: player.maxHealth,
      stats: buildPlayerVitalsStats(player),
      visibility,
    });
  }

  private buildPlayerVitalsForRecipient(
    id: string,
    player: Player,
    recipient: Player | null,
    now = this.state.serverTime || Date.now(),
    interest?: RecipientInterestDecision,
    frameContext?: ReplicationFrameContext
  ): PlayerVitalsSnapshot {
    const shouldResolveInterest = recipient && recipient.id !== id && recipient.team !== player.team;
    const visibility = shouldResolveInterest
      ? (interest ?? this.getRecipientInterest(recipient, player, now, frameContext)).state
      : 'visible';

    return selectPlayerVitalsForRecipient({
      targetId: id,
      targetTeam: player.team,
      recipientId: recipient?.id,
      recipientTeam: recipient?.team,
      visibility,
      caches: frameContext,
      buildFull: () => this.buildPlayerVitals(id, player, 'visible'),
      buildVisible: (state) => this.buildVisibleEnemyVitals(id, player, state),
      buildPublic: (state) => this.buildPublicEnemyVitals(id, player, state),
    });
  }

  private buildMatchSnapshot(): MatchSnapshotMessage {
    return this.matchSnapshots.buildSnapshot({
      tick: this.state.tick,
      serverTime: this.state.serverTime,
      phase: this.state.phase as MatchSnapshotMessage['phase'],
      gameplayMode: this.gameplayMode,
      mapSeed: this.state.mapSeed,
      mapThemeId: this.state.mapThemeId as VoxelMapTheme['id'],
      mapSize: this.state.mapSize as VoxelMapSizeId,
      redScore: this.state.redTeam.score,
      blueScore: this.state.blueTeam.score,
      redFlag: getFlagSync(this.state, 'red'),
      blueFlag: getFlagSync(this.state, 'blue'),
      roundTimeRemaining: this.state.roundTimeRemaining,
      phaseEndTime: this.state.phaseEndTime || null,
      gameClockFrozen: this.devRuntime.isGameClockFrozen(),
    });
  }

  private buildGameEndEvent(
    finalScore: { red: number; blue: number },
    winningTeam: Team | null,
    endedAt: number,
    forcedByPlayerId?: string
  ): GameEndEvent {
    const ledger = this.matchLedger.getLedger();
    const startedAt = ledger?.startedAt.getTime()
      ?? (this.state.roundStartTime || endedAt);
    const integrityGate = this.antiCheat?.buildIntegrityGate({
      rankedEligible: ledger?.rankedEligible === true,
      wagered: Boolean(this.wagerContext),
    });
    let rankedPreview: RankedSummaryPreviewInput | undefined;
    if (ledger && ledger.state === 'active') {
      const participants = this.buildMatchParticipantSnapshots(ledger);
      rankedPreview = {
        participants,
        rankedUserStates: buildRankedUserStatesFromAuthContexts(this.participantRegistry.getAuthContexts()),
        rankedEligible: this.isFinalRankedEligible(
          ledger,
          participants,
          forcedByPlayerId
        ),
        rankedHoldRequired: integrityGate?.rankedHoldRequired === true,
      };
    }

    return this.matchSummary.buildGameEndEvent({
      matchMode: this.matchMode,
      gameplayMode: this.gameplayMode,
      winningTeam,
      finalScore,
      matchId: this.matchLedger.getMatchId(),
      startedAt,
      endedAt,
      forcedByPlayerId,
      players: this.state.players,
      integrityGate,
      mapThemeId: this.state.mapThemeId,
      goldenBiomeRewardUsdCents: this.state.mapThemeId === GOLDEN_VOXEL_MAP_THEME_ID && this.matchMode === 'ranked'
        ? wagerService.getConfig().goldenBiomeWinnerRewardUsdCents
        : 0,
      rankedPreview,
    });
  }

  private updateMetadata(): void {
    const counts = getRoomPopulationCounts({
      players: this.state.players.values(),
      npcIds: this.npcs.ids,
      observerCount: this.clientRegistry.getObserverCount(),
    });
    const load = this.getRoomLoadSnapshot();
    this.setMetadata(buildGameRoomMetadata({
      roomId: this.roomId,
      lobbyName: this.lobbyName,
      phase: this.state.phase,
      lobbyId: this.lobbyId,
      matchMode: this.matchMode,
      gameplayMode: this.gameplayMode,
      mapSeed: this.state.mapSeed,
      mapThemeId: this.state.mapThemeId,
      mapSize: this.state.mapSize,
      counts,
      maxPlayers: this.config.maxPlayers,
      reservedHumanPlayers: this.reservedHumanPlayers,
      rankedEligibilityCandidate: this.rankedEligibilityCandidate,
      rankedRequiredHumanPlayers: this.rankedRequiredHumanPlayers,
      reconnectIdentityKeys: this.participantRegistry.getReconnectIdentityKeys(),
      wagerEnabled: Boolean(this.wagerContext),
      load,
    }));
  }

  getCustomMessageMetricsSnapshot(): Record<string, RoomCustomMessageMetric> {
    return this.roomMetrics.getCustomMessageMetricsSnapshot();
  }

  getInterestMetricsSnapshot(): RoomInterestMetricsSnapshot {
    return buildRoomInterestMetricsSnapshot({
      interest: this.visibilityInterest.getMetricsSnapshot(),
      transformMetric: this.roomMetrics.getCustomMessageMetric('playerTransformsV2'),
      vitalsMetric: this.roomMetrics.getCustomMessageMetric('playerVitals'),
    });
  }

  getRoomLoadSnapshot(): RoomLoadSnapshot {
    return buildRoomLoadSnapshot({
      tickDurationP50Ms: this.roomMetrics.getTickDurationPercentile(0.5),
      tickDurationP95Ms: this.roomMetrics.getTickDurationPercentile(0.95),
      tickDurationP99Ms: this.roomMetrics.getTickDurationPercentile(0.99),
      eventLoopDelayP95Ms: this.eventLoopDelay ? this.eventLoopDelay.percentile(95) / 1_000_000 : 0,
      eventLoopDelayP99Ms: this.eventLoopDelay ? this.eventLoopDelay.percentile(99) / 1_000_000 : 0,
      customMessageTotals: this.roomMetrics.getCustomMessageTotals(),
      interest: this.visibilityInterest.getMetricsSnapshot(),
      transformMetric: this.roomMetrics.getCustomMessageMetric('playerTransformsV2'),
      vitalsMetric: this.roomMetrics.getCustomMessageMetric('playerVitals'),
      antiCheatQueue: this.antiCheatEvidenceStore.getQueueHealth(),
    });
  }

  private sendTracked(client: Client, type: string, payload: unknown): void {
    this.roomMetrics.recordCustomMessage(type, payload, 1);
    client.send(type, payload);
  }

  private broadcastTracked(type: string, payload: unknown): void {
    this.roomMetrics.recordCustomMessage(type, payload, this.clients.length);
    this.broadcast(type, payload);
  }

  private broadcastPhaseChange(phase: GamePhase): void {
    this.broadcastTracked('phaseChange', buildPhaseChangePayload({
      phase,
      endTime: this.state.phaseEndTime,
      mapSeed: this.state.mapSeed,
      mapThemeId: this.state.mapThemeId,
      mapSize: this.state.mapSize as VoxelMapSizeId,
    }));
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
    payload: PlayerDamagedEvent
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
      const eventPayload = buildPlayerDamagedPayload(payload, {
        isParticipant: Boolean(isParticipant),
        canKnowTarget,
        canKnowSource,
      });

      if (!eventPayload) continue;
      this.sendTracked(client, 'playerDamaged', eventPayload);
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
      const eventPayload = buildChronosAegisDamagedPayload(payload, {
        isParticipant: Boolean(isParticipant),
        canKnowBlocker,
        canKnowSource,
      });

      if (!eventPayload) continue;
      this.sendTracked(client, 'chronosAegisDamaged', eventPayload);
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
      const eventPayload = buildPhantomShieldBrokenPayload(payload, {
        isParticipant: Boolean(isParticipant),
        canKnowTarget,
      });

      if (!eventPayload) continue;
      this.sendTracked(client, 'phantomShieldBroken', eventPayload);
    }
  }

  private broadcastPlayerHealed(source: Player, payload: PlayerHealedEvent): void {
    const now = this.state.serverTime || Date.now();
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const sourceInterest = recipient ? this.getRecipientInterest(recipient, source, now) : undefined;
      if (!this.shouldSendExactEnemyState(recipient, source.id, source, now, sourceInterest)) continue;

      const visibleTargetIds = new Set<string>();
      for (const targetPayload of payload.targets) {
        const target = this.state.players.get(targetPayload.targetId);
        if (!target) continue;
        const targetInterest = recipient ? this.getRecipientInterest(recipient, target, now) : undefined;
        if (this.shouldSendExactEnemyState(recipient, target.id, target, now, targetInterest)) {
          visibleTargetIds.add(targetPayload.targetId);
        }
      }

      const eventPayload = buildPlayerHealedPayload(payload, visibleTargetIds);
      if (!eventPayload) continue;
      this.sendTracked(client, 'playerHealed', eventPayload);
    }
  }

  private broadcastPowerupCollected(
    collector: Player,
    payload: PowerupCollectedMessage
  ): void {
    const now = this.state.serverTime || Date.now();
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const interest = recipient ? this.getRecipientInterest(recipient, collector, now) : undefined;
      const canKnowCollector = this.shouldSendExactEnemyState(recipient, collector.id, collector, now, interest);
      this.sendTracked(client, 'powerupCollected', buildPowerupCollectedPayload(payload, canKnowCollector));
    }
  }

  private broadcastPlayerKilled(victim: Player, killer: Player | null, payload: PlayerDeathEvent): void {
    const now = this.state.serverTime || Date.now();
    const exactPosition = payload.position;
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const victimInterest = recipient ? this.getRecipientInterest(recipient, victim, now) : undefined;
      const killerInterest = killer && recipient ? this.getRecipientInterest(recipient, killer, now) : undefined;
      const canKnowVictim = this.shouldSendExactEnemyState(recipient, victim.id, victim, now, victimInterest);
      const canKnowKiller = killer
        ? this.shouldSendExactEnemyState(recipient, killer.id, killer, now, killerInterest)
        : true;
      const isParticipant = recipient?.id === victim.id || (killer && recipient?.id === killer.id);

      this.sendTracked(client, 'playerKilled', buildPlayerKilledPayload(payload, {
        isParticipant: Boolean(isParticipant),
        canKnowTarget: canKnowVictim,
        canKnowSource: canKnowKiller,
      }, getCoarseEventPosition(exactPosition)));
    }
  }

  private shouldIncludeJoinPosition(recipient: Player | null, target: Player): boolean {
    return shouldIncludePlayerJoinPosition({
      recipientId: recipient?.id,
      recipientTeam: recipient?.team,
      targetId: target.id,
      targetTeam: target.team,
      phase: this.state.phase as GamePhase,
    });
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
      rank: ReturnType<typeof buildRoomRankSnapshot>;
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
      rank: buildRoomRankSnapshot(target),
    };

    if (this.shouldIncludeJoinPosition(recipient, target)) {
      payload.position = vec3SchemaToPlain(target.position);
    }

    this.sendTracked(client, 'playerJoined', payload);
  }

  private sendCurrentSnapshots(client: Client): void {
    const recipient = this.state.players.get(client.sessionId) ?? null;
    const matchSnapshot = this.buildMatchSnapshot();
    this.sendTracked(client, 'matchSnapshot', matchSnapshot);
    this.sendTracked(client, 'powerupState', this.powerupPickups.buildStateMessage(
      this.state.serverTime || Date.now(),
      this.getMapManifest()
    ));
    this.sendTracked(client, 'playerVitals', {
      tick: this.state.tick,
      serverTime: this.state.serverTime,
      players: Array.from(
        this.state.players,
        ([id, player]) => this.buildPlayerVitalsForRecipient(id, player, recipient)
      ),
    } satisfies PlayerVitalsMessage);
    this.sendTracked(client, 'playerPings', this.playerPings.buildMessage({
      serverTime: this.state.serverTime,
      players: this.state.players,
      recipient,
    }));
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
    this.sendTracked(
      client,
      'playerPingRequest',
      this.playerPings.createPingRequest(client.sessionId, this.state.tick, now)
    );
  }

  private handlePlayerPingResponse(client: Client, data: unknown): void {
    if (!isRecord(data) || typeof data.nonce !== 'string') return;

    const result = this.playerPings.recordPingResponse(client.sessionId, data.nonce, Date.now());
    if (!result.accepted) return;
    this.checkCompetitiveNetworkQualityAfterProbe();
  }

  private probePlayerPings(): void {
    const now = this.state.serverTime || Date.now();
    const probe = this.playerPings.startProbe({
      clients: this.clients,
      players: this.state.players,
      tick: this.state.tick,
      now,
    });
    if (!probe.started) return;

    for (let index = 0; index < probe.timedOutPlayerIds.length; index++) {
      this.checkCompetitiveNetworkQualityAfterProbe();
    }

    for (const request of probe.requests) {
      this.sendTracked(request.client, 'playerPingRequest', request.message);
    }
  }

  private checkCompetitiveNetworkQualityAfterProbe(): void {
    if (
      this.matchCancelled
      || this.state.phase !== 'hero_select'
      || !this.matchStartGate.isOpen()
      || !this.areAllHumansSceneReadyForCountdown()
    ) {
      return;
    }

    this.checkPhaseTransition();
  }

  private ensureCompetitiveNetworkQualityForStart(options: { cancelPending?: boolean } = {}): boolean {
    const result = this.playerPings.ensureCompetitiveGateForStart({
      players: this.state.players,
      now: Date.now(),
      matchMode: this.matchMode,
      wagered: Boolean(this.wagerContext),
      cancelPending: options.cancelPending,
    });
    if (result.ready) return true;

    if (result.cancelNotice) {
      this.cancelPreMatch('network_quality', result.cancelNotice);
    }

    return false;
  }

  private broadcastPlayerPings(force = false): void {
    if (!this.playerPings.shouldBroadcast(force)) return;
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      this.sendTracked(client, 'playerPings', this.playerPings.buildMessage({
        serverTime: this.state.serverTime,
        players: this.state.players,
        recipient,
      }));
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
      : this.replicationState.getGlobalTransformState();
    this.state.players.forEach((player, id) => {
      if (player.state !== 'alive' && player.state !== 'spawning') return;
      if (!force && options.recipientId && id === options.recipientId) return;
      const interest = options.recipient
        ? this.getRecipientInterest(options.recipient, player, now, options.frameContext)
        : undefined;
      const exactStateVisible = this.shouldSendExactEnemyState(options.recipient ?? null, id, player, now, interest);
      const delta = selectPackedTransformDelta({
        state: replicationState,
        playerId: id,
        getSnapshot: () => {
          const transform = options.frameContext?.packedTransforms.get(id) ?? this.buildPackedTransform(id, player);
          const signature = options.frameContext?.packedTransformSignatures.get(id) ?? getPackedTransformSignature(transform);
          return { transform, signature };
        },
        exactStateVisible,
        force,
        getHighRelevance: () => this.isHighRelevanceTransform(options.recipient ?? null, id, player, now),
        now,
      });
      if (delta?.kind === 'visible') players.push(delta.transform);
      if (delta?.kind === 'hidden') hiddenPlayerIds.push(delta.playerId);
    });

    return {
      version: 2,
      tick: this.state.tick,
      serverTime: this.state.serverTime,
      streamEpoch: this.replicationState.getStreamEpoch(),
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
    const {
      shouldBroadcastVitals,
      shouldBroadcastInterest,
      shouldBroadcastTransforms,
    } = getPlayerStateStreamBroadcastPlan({
      transforms: options.transforms,
      vitals: options.vitals,
      forceVitals,
      now,
      lastVitalsBroadcastAt: this.lastVitalsBroadcastAt,
      lastInterestBroadcastAt: this.lastInterestBroadcastAt,
      vitalsIntervalMs: PLAYER_VITALS_INTERVAL_MS,
      interestIntervalMs: PLAYER_INTEREST_INTERVAL_MS,
    });

    if (!shouldBroadcastVitals && !shouldBroadcastInterest && !shouldBroadcastTransforms) return;

    const globallyRemovedPlayerIds: string[] = [];
    if (shouldBroadcastVitals) {
      frameContext.currentIds.forEach((id) => {
        this.replicationState.markKnownPlayer(id);
      });

      globallyRemovedPlayerIds.push(...this.replicationState.removeMissingKnownPlayers(frameContext.currentIds));
      for (const id of globallyRemovedPlayerIds) {
        this.visibilityInterest.clearPlayer(id);
        this.playerPings.clearPlayer(id);
      }
    }

    let sentVitals = false;
    let sentInterest = false;

    for (const client of this.clients) {
      const sent = this.sendPlayerStateStreamsToClient(client, {
        frameContext,
        globallyRemovedPlayerIds,
        shouldBroadcastVitals,
        shouldBroadcastInterest,
        shouldBroadcastTransforms,
        forceVitals,
        forceTransforms,
      });
      sentVitals ||= sent.sentVitals;
      sentInterest ||= sent.sentInterest;
    }

    if (shouldBroadcastVitals && (sentVitals || forceVitals)) {
      this.lastVitalsBroadcastAt = now;
    }
    if (shouldBroadcastInterest && (sentInterest || forceVitals)) {
      this.lastInterestBroadcastAt = now;
    }
  }

  private sendPlayerStateStreamsToClient(
    client: Client,
    options: {
      frameContext: ReplicationFrameContext;
      globallyRemovedPlayerIds: string[];
      shouldBroadcastVitals: boolean;
      shouldBroadcastInterest: boolean;
      shouldBroadcastTransforms: boolean;
      forceVitals: boolean;
      forceTransforms: boolean;
    }
  ): PlayerStateStreamRecipientSendResult {
    const recipient = this.state.players.get(client.sessionId) ?? null;
    const recipientId = client.sessionId;
    const vitalsState = options.shouldBroadcastVitals ? this.getVitalsReplicationState(recipientId) : null;
    const interestSignatures = options.shouldBroadcastInterest && recipient
      ? this.getInterestSignatureState(recipientId)
      : null;
    const transformState = options.shouldBroadcastTransforms ? this.getTransformReplicationState(recipientId) : null;
    const {
      vitalsPlayers,
      removedPlayerIds,
      interestPlayers,
      transformPlayers,
      hiddenPlayerIds,
    } = collectRecipientPlayerStateStreams({
      players: this.state.players,
      recipient,
      recipientId,
      frameContext: options.frameContext,
      vitalsState,
      interestSignatures,
      transformState,
      globallyRemovedPlayerIds: options.globallyRemovedPlayerIds,
      forceVitals: options.forceVitals,
      forceTransforms: options.forceTransforms,
      vitalsReconcileIntervalMs: PLAYER_VITALS_RECONCILE_INTERVAL_MS,
      buildPlayerVitalsForRecipient: (
        id,
        player,
        targetRecipient,
        targetNow,
        interest,
        targetFrameContext
      ) => this.buildPlayerVitalsForRecipient(
        id,
        player,
        targetRecipient,
        targetNow,
        interest,
        targetFrameContext
      ),
      getRecipientInterest: (targetRecipient, player, targetNow, targetFrameContext) => (
        this.getRecipientInterest(targetRecipient, player, targetNow, targetFrameContext)
      ),
      shouldSendExactEnemyState: (targetRecipient, id, player, targetNow, interest) => (
        this.shouldSendExactEnemyState(targetRecipient, id, player, targetNow, interest)
      ),
      isHighRelevanceTransform: (targetRecipient, id, player, targetNow) => (
        this.isHighRelevanceTransform(targetRecipient, id, player, targetNow)
      ),
      buildPackedTransform: (id, player) => this.buildPackedTransform(id, player),
    });

    let sentVitals = false;
    let sentInterest = false;

    if (vitalsState) {
      const message = buildPlayerVitalsStreamMessage({
        tick: this.state.tick,
        serverTime: this.state.serverTime,
        players: vitalsPlayers,
        removedPlayerIds,
        force: options.forceVitals,
      });
      if (message) {
        sentVitals = true;
        this.sendTracked(client, 'playerVitals', message);
      }
    }

    if (interestSignatures) {
      const message = buildPlayerInterestStreamMessage({
        tick: this.state.tick,
        serverTime: this.state.serverTime,
        players: interestPlayers,
        force: options.forceVitals,
      });
      if (message) {
        sentInterest = true;
        this.sendTracked(client, 'playerInterest', message);
      }
    }

    if (transformState) {
      const message = buildPlayerTransformsStreamMessage({
        tick: this.state.tick,
        serverTime: this.state.serverTime,
        streamEpoch: this.replicationState.getStreamEpoch(),
        full: options.forceTransforms,
        players: transformPlayers,
        hiddenPlayerIds,
      });
      if (message) {
        this.sendTracked(client, 'playerTransformsV2', message);
      }
    }

    return { sentVitals, sentInterest };
  }

  private broadcastMatchSnapshot(force = false): void {
    const now = this.state.serverTime || Date.now();
    const snapshot = this.buildMatchSnapshot();
    const signature = this.matchSnapshots.getSignature(snapshot);
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
    if (hasPhaseDeadlineElapsed(this.state.phaseEndTime, Date.now())) {
      // Check if game should end
      if (getNextRoundEndPhase({
        gameplayMode: this.gameplayMode,
        redScore: this.state.redTeam.score,
        blueScore: this.state.blueTeam.score,
        scoreToWin: this.config.scoreToWin,
      }) === 'game_end') {
        this.endGame();
      } else {
        this.startHeroSelect();
      }
    }
  }

  private getMovementAuthority(playerId: string): ServerMovementAuthorityState {
    return this.movementAuthorities.get(playerId);
  }

  private getPlayerUserId(playerId: string): string | undefined {
    return this.participantRegistry.getAuthUserId(playerId);
  }

  private recordAuthReject(client: Client, reason: string, detail: Record<string, unknown> = {}): void {
    this.antiCheat?.record(buildAuthRejectRecord({
      reason,
      userId: this.participantRegistry.getAuthUserId(client.sessionId) ?? null,
      playerSessionId: client.sessionId,
      details: detail,
    }));
  }

  private recordClientJoinHints(client: Client, auth: RoomAuthContext, options: JoinOptions): void {
    if (!getAntiCheatConfig().clientHintsEnabled) return;

    const expectedBuildId = process.env.ANTICHEAT_EXPECTED_CLIENT_BUILD_ID || process.env.CLIENT_BUILD_ID || null;
    for (const record of buildClientJoinHintRecords({
      userId: auth.userId,
      playerSessionId: client.sessionId,
      expectedBuildId,
      clientBuildId: options.clientBuildId,
      movementProtocolVersion: options.movementProtocolVersion,
      expectedMovementProtocolVersion: MOVEMENT_PROTOCOL_VERSION,
    })) {
      this.antiCheat?.record(record);
    }
  }

  private getPlayerReportParticipantSnapshot(playerId: string): PlayerReportParticipantSnapshot | null {
    const player = this.state.players.get(playerId);
    if (!player) return null;

    return {
      id: player.id,
      name: player.name,
      team: player.team,
      heroId: player.heroId ?? null,
      isBot: player.isBot,
      isNpc: this.npcs.has(player.id),
      userId: this.getDurableUserId(player.id),
      stats: {
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        flagCaptures: player.flagCaptures,
        flagReturns: player.flagReturns,
      },
      position: {
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
      },
    };
  }

  private getPlayerReportRoomSnapshot(): PlayerReportRoomSnapshot {
    return {
      roomId: this.roomId,
      matchId: this.matchLedger.getMatchId(),
      lobbyId: this.lobbyId,
      matchMode: this.matchMode,
      mapSeed: this.state.mapSeed,
      serverTick: this.state.tick,
    };
  }

  private sendPlayerReportResult(
    client: Client,
    requestId: string | null,
    result: PlayerReportResult
  ): void {
    client.send('playerReportResult', buildPlayerReportResultPayload(requestId, result));
  }

  private async handlePlayerReport(client: Client, data: unknown): Promise<void> {
    const parsed = parsePlayerReportPayload(data, client.sessionId);
    const fail = (error: string) => this.sendPlayerReportResult(client, parsed.requestId, { ok: false, error });

    if (!parsed.ok) {
      fail(parsed.error);
      return;
    }

    const reportContext = validatePlayerReportContext({
      reporter: this.getPlayerReportParticipantSnapshot(client.sessionId),
      target: this.getPlayerReportParticipantSnapshot(parsed.targetPlayerId),
    });
    if (!reportContext.ok) {
      fail(reportContext.error);
      return;
    }

    const { reporter, target } = reportContext;
    const room = this.getPlayerReportRoomSnapshot();
    const signal = this.antiCheat?.record(buildPlayerReportEvidenceInput({ parsed, reporter, target }));

    try {
      const report = await createPlayerReport(
        prisma,
        buildCreatePlayerReportInput({
          parsed,
          reporter,
          target,
          room,
          evidenceEventId: signal?.eventId ?? null,
        })
      );

      loggers.room.info('Player report created', {
        reportId: report.id,
        reporterUserId: reporter.userId,
        targetUserId: target.userId,
        roomId: room.roomId,
        matchId: room.matchId,
      });
      this.sendPlayerReportResult(client, parsed.requestId, { ok: true, reportId: report.id });
    } catch (error) {
      loggers.room.error('Failed to create player report', {
        reporterUserId: reporter.userId,
        targetUserId: target.userId,
        roomId: room.roomId,
        error: error instanceof Error ? error.message : String(error),
      });
      fail('Failed to submit report');
    }
  }

  private getDurableUserId(playerId: string): string | null {
    return this.participantRegistry.getDurableUserId(playerId);
  }

  private ensureMatchPersistenceLedger(now = Date.now()): MatchPersistenceLedger {
    const { ledger, created } = this.matchLedger.ensureLedger(now);
    if (created) {
      loggers.room.info('Match persistence ledger started', {
        roomId: this.roomId,
        matchId: ledger.matchId,
        lobbyId: this.lobbyId,
        mapSeed: this.state.mapSeed,
        mapThemeId: this.state.mapThemeId,
      });
    }

    return ledger;
  }

  private registerMatchParticipant(player: Player, now = Date.now()) {
    return this.matchLedger.registerParticipant(player, now);
  }

  private syncMatchParticipant(player: Player) {
    return this.matchLedger.syncParticipant(player);
  }

  private buildMatchParticipantSnapshots(ledger: MatchPersistenceLedger): MatchParticipantSnapshot[] {
    if (ledger !== this.matchLedger.getLedger()) return [];
    return this.matchLedger.buildParticipantSnapshots(this.state.players.values());
  }

  private markMatchParticipantLeft(player: Player, now = Date.now()): void {
    this.matchLedger.markParticipantLeft(player, now);
  }

  private recordMatchDeath(victim: Player, killer: Player | null): void {
    this.matchLedger.recordDeath(victim, killer);
  }

  private recordMatchKill(killer: Player, victim: Player): void {
    this.matchLedger.recordKill(killer, victim);
  }

  private recordMatchAssist(assister: Player, victim: Player): void {
    this.matchLedger.recordAssist(assister, victim);
  }

  private recordMatchFlagCapture(player: Player): void {
    this.matchLedger.recordFlagCapture(player);
  }

  private recordMatchFlagReturn(player: Player): void {
    this.matchLedger.recordFlagReturn(player);
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
    return this.matchLedger.isFinalRankedEligible({
      ledger,
      participants,
      currentMatchMode: this.matchMode,
      npcCount: this.npcs.size,
      requiredHumanPlayers: this.rankedRequiredHumanPlayers,
      forcedByPlayerId,
    });
  }

  private persistMatchLedger(
    finalScore: { red: number; blue: number },
    winningTeam: Team | null,
    forcedByPlayerId?: string
  ): void {
    const ledger = this.matchLedger.getLedger();
    if (!ledger || ledger.state !== 'active') return;

    const participants = this.buildMatchParticipantSnapshots(ledger);
    const rankedEligible = this.isFinalRankedEligible(ledger, participants, forcedByPlayerId);
    const integrityGate = this.antiCheat?.buildIntegrityGate({
      rankedEligible,
      wagered: Boolean(this.wagerContext),
    }) ?? this.cleanAntiCheatGate();

    void this.matchFinalization.persistLedger({
      ledger,
      finalScore,
      winningTeam,
      participants,
      rankedEligible,
      integrityGate,
      wagered: Boolean(this.wagerContext),
    });
  }

  private settleWagerAfterGame(winningTeam: Team | null): void {
    if (!this.wagerContext) return;

    const integrityGate = this.antiCheat?.buildIntegrityGate({
      rankedEligible: this.matchLedger.getLedger()?.rankedEligible === true,
      wagered: true,
    }) ?? this.cleanAntiCheatGate();
    const requested = this.matchFinalization.settleWagerAfterGame({
      roomId: this.roomId,
      lobbyId: this.lobbyId,
      wagerContext: this.wagerContext,
      matchId: this.matchLedger.getMatchId(),
      winningTeam,
      integrityGate,
    });
    if (requested) {
      this.wagerSettlementRequested = true;
    }
  }

  private settleWagerNoContest(reason: string): void {
    const requested = this.matchFinalization.settleWagerNoContest({
      roomId: this.roomId,
      lobbyId: this.lobbyId,
      wagerContext: this.wagerContext,
      settlementAlreadyRequested: this.wagerSettlementRequested,
      matchId: this.matchLedger.getMatchId(),
      reason,
    });
    if (requested) {
      this.wagerSettlementRequested = true;
    }
  }

  private settleGoldenBiomeRewardAfterGame(winningTeam: Team | null, forcedByPlayerId?: string): void {
    const ledger = this.matchLedger.getLedger();
    if (this.state.mapThemeId !== GOLDEN_VOXEL_MAP_THEME_ID || !ledger || ledger.state !== 'active') return;
    if (this.matchMode !== 'ranked' || !winningTeam || forcedByPlayerId) return;

    const participants = this.buildMatchParticipantSnapshots(ledger);
    const rankedEligible = this.isFinalRankedEligible(ledger, participants, forcedByPlayerId);
    const integrityGate = this.antiCheat?.buildIntegrityGate({
      rankedEligible,
      wagered: true,
    }) ?? this.cleanAntiCheatGate();
    this.matchFinalization.settleGoldenBiomeReward({
      ledger,
      roomId: this.roomId,
      lobbyId: this.lobbyId,
      mapThemeId: this.state.mapThemeId,
      mapSeed: this.state.mapSeed,
      matchMode: this.matchMode,
      winningTeam,
      forcedByPlayerId,
      participants,
      rankedEligible,
      integrityGate,
    });
  }

  private async removeVoiceParticipantForPlayer(
    playerId: string,
    team: Team | null | undefined,
    reason: string
  ): Promise<void> {
    if (!voiceService.isEnabled()) return;
    const identity = this.getDurableUserId(playerId);
    if (!identity) return;
    await voiceService.removeMatchParticipant(this.roomId, identity, team, reason);
  }

  private recordSecurityEvent(event: RoomSecurityEventInput): void {
    const fullEvent = buildRoomSecurityEvent(event, {
      roomId: this.roomId,
      tick: this.state.tick,
      serverTime: this.state.serverTime || Date.now(),
    });
    const player = this.state.players.get(event.playerId);
    this.antiCheat?.recordAuthorityEvent(buildSecurityAuthorityEvent(fullEvent, {
      team: player?.team ?? null,
      heroId: isHeroId(player?.heroId) ? player.heroId : null,
    }));
    this.logSecurityEvent(fullEvent);
  }

  private logSecurityEvent(event: SecurityEvent): void {
    const sampledEvent = this.securityLogSampler.sample(event);
    if (!sampledEvent) return;

    const logLevel = getSecurityEventLogLevel(event);
    if (logLevel === 'silent') return;

    if (logLevel === 'debug') {
      loggers.room.debug('authority event', sampledEvent);
      return;
    }
    loggers.room.warn('authority event', sampledEvent);
  }

  private updateLastSafeMovement(player: Player, sequence: number, acceptedAt = Date.now()): void {
    const authority = this.getMovementAuthority(player.id);
    authority.lastSafe = {
      position: vec3SchemaToPlain(player.position),
      velocity: vec3SchemaToPlain(player.velocity),
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
        ? vec3SchemaToPlain(this.state.players.get(playerId)!.position)
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
      position: vec3SchemaToPlain(player.position),
      detail: {
        team: player.team,
        phase: this.state.phase,
        serverTick: this.state.tick,
        eventTeam: team,
        serverTime: now,
      },
    });
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
        ? vec3SchemaToPlain(this.state.players.get(playerId)!.position)
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
      position: vec3SchemaToPlain(player.position),
    });
  }

  private clearHookshotGrapple(playerId: string): void {
    this.hookshotRuntime.clearGrapple(playerId);
    const player = this.state.players.get(playerId);
    if (player) {
      player.movement.isGrappling = false;
    }
  }

  private clearHookshotDragPull(playerId: string): void {
    this.hookshotRuntime.clearDragPull(playerId);
  }

  private clearHookshotDragPullsInvolving(playerId: string): void {
    this.hookshotRuntime.clearDragPullsInvolving(playerId);
  }

  private stopRootedMovement(player: Player): void {
    this.clearHookshotGrapple(player.id);
    stopRootedMovementState(player);
  }

  private getRootedMovementInput(player: Player, input: PlayerInput, now: number): PlayerInput {
    if (!this.playerRoots.isRooted(player.id, now)) return input;
    this.stopRootedMovement(player);
    return suppressLocomotionInput(input);
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
    this.movementAuthorities.replacePendingCommands(authority, preservedCommands.slice(-MOVEMENT_MAX_SERVER_QUEUE));
    authority.metrics.queueLength = authority.pendingCommands.length;
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
      position: player ? vec3SchemaToPlain(player.position) : undefined,
      detail: {
        preserveQueuedCommands: options.preserveQueuedCommands === true,
        queueLength: authority.pendingCommands.length,
      },
    });
    this.suppressObjectives(playerId, reason);
    this.clearHookshotGrapple(playerId);
    this.clearHookshotDragPull(playerId);
  }

  private handleMovementCommandPacket(client: Client, packet: MovementCommandPacket): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.state !== 'alive' || player.isBot) return;

    const authority = this.getMovementAuthority(client.sessionId);
    const position = vec3SchemaToPlain(player.position);
    const result = ingestMovementCommandPacket({
      authority,
      packet,
      now: Date.now(),
      currentCollisionRevision: this.getMovementCollisionRevision(),
    });
    for (const event of result.events) {
      this.recordSecurityEvent({
        ...event,
        playerId: client.sessionId,
        userId: this.getPlayerUserId(client.sessionId),
        ...(event.type === 'movement_command_reject' ? {} : { position }),
      });
    }

    if (result.shouldMarkQueueOverflowBarrier) {
      this.markMovementBarrier(client.sessionId, 'queue_overflow');
    }
  }

  private movementCommandToInput(
    command: MovementCommand,
    now = this.state.serverTime || Date.now()
  ): PlayerInput {
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
      timestamp: now,
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
      this.movementAuthorities.pushPendingCommand(authority, {
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

    const overflowPolicy = getMovementQueueOverflowBarrierPolicy({
      queueLength: authority.pendingCommands.length,
      maxServerQueue: MOVEMENT_MAX_SERVER_QUEUE,
    });
    if (overflowPolicy.shouldMarkQueueOverflowBarrier) {
      authority.metrics.droppedCommands += overflowPolicy.discardedCommandCount;
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
      (distance3D(startPosition, target) / HOOKSHOT_GRAPPLE_EXTENSION_SPEED) * 1000
    );
    this.hookshotRuntime.setGrapple(player.id, {
      castId,
      target: { ...target },
      attachAt: startedAt + travelMs,
      swing: null,
    });
    player.movement.isGrappling = false;
  }

  private prepareHookshotGrappleForMovement(player: Player, now: number): void {
    const grapple = this.hookshotRuntime.getGrapple(player.id);
    if (!grapple) return;

    if (now < grapple.attachAt) {
      player.movement.isGrappling = false;
      return;
    }

    if (!grapple.swing) {
      grapple.swing = createHookshotSwingState(
        vec3SchemaToPlain(player.position),
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
    const grapple = this.hookshotRuntime.getGrapple(player.id);
    if (!grapple || now < grapple.attachAt || !grapple.swing) return;

    const previousPosition = vec3SchemaToPlain(player.position);
    const result = stepHookshotSwing({
      position: previousPosition,
      velocity: vec3SchemaToPlain(player.velocity),
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
      position: vec3SchemaToPlain(player.position),
      velocity: vec3SchemaToPlain(player.velocity),
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
      terrain: this.mapRuntime.terrain,
      collisionWorld,
      flagCarrier: isCaptureTheFlagMode(this.gameplayMode) && player.hasFlag,
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
      position: vec3SchemaToPlain(player.position),
      velocity: vec3SchemaToPlain(player.velocity),
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
        grapplePoint: this.hookshotRuntime.getGrappleTarget(player.id),
        isJetpacking: player.movement.isJetpacking,
        jetpackFuel: player.movement.jetpackFuel,
        isGliding: player.movement.isGliding,
        chronosAscendantStartY: player.movement.chronosAscendantStartY || undefined,
      },
      correctionReason: reason ?? undefined,
      collisionRevision: this.getMovementCollisionRevision(),
      chronosAegisActive: this.isChronosAegisActive(player),
      chronosAegisShieldRatio: this.getChronosAegisShieldRatio(player.id),
      rootedUntil: this.playerRoots.getRootedUntil(player.id, now),
      powerupBoostUntil: this.powerupBoosts.getUntil(player.id, now),
    };
    this.sendTracked(client, 'selfMovementAuthority', payload);
    if (authority.lastAuthoritySentAt > 0) {
      authority.metrics.lastAckIntervalMs = Math.max(0, now - authority.lastAuthoritySentAt);
    }
    authority.lastAuthoritySentAt = now;
    authority.metrics.authoritySends = (authority.metrics.authoritySends ?? 0) + 1;
    authority.correctionReason = null;
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
        position: vec3SchemaToPlain(target.position),
      });
    }

    abilityState.isActive = false;
    abilityState.activatedAt = now;

    if (healedTargets.length > 0) {
      this.broadcastPlayerHealed(caster, {
        sourceId: caster.id,
        abilityId: 'chronos_lifeline_conduit',
        sourcePosition: vec3SchemaToPlain(caster.position),
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

    this.roomTimeouts.schedule(() => {
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
    const playerCenter = vec3SchemaToPlain(player.position);
    const distanceFromFallback = distance3D(origin, fallbackOrigin);
    const distanceFromCenter = distance3D(origin, playerCenter);
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

  private getAbilitySocketCastOrigin(
    player: Player,
    abilityId: string,
    launchSide: -1 | 1 = 1
  ): PlainVec3 {
    const resolved = resolveAbilitySocket({ abilityId, side: launchSide });
    if (!resolved) {
      return vec3SchemaToPlain(player.position);
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
    return this.hookshotPrimaryLaunchSide.next(playerId);
  }

  private getNextPhantomPrimaryLaunchSide(playerId: string): -1 | 1 {
    return this.phantomPrimaryLaunchSide.next(playerId);
  }

  private resolveHookshotLaunch(
    player: Player,
    launchSide: -1 | 1,
    maxDistance: number,
    abilityId: 'hookshot_basic_attack' | 'hookshot_heavy_attack'
  ): { startPosition: PlainVec3; aimDirection: PlainVec3 } {
    const lookDirection = getForwardVector(player.lookYaw, player.lookPitch);
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
    const lookDirection = getForwardVector(player.lookYaw, player.lookPitch);
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
    const forward = forward2D(player.lookYaw);
    const normalized = normalize2D(forward) ?? { x: 0, z: -1 };
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
    this.pendingAreaDamage.enqueue(instance);
  }

  private updatePendingAreaDamage(now: number): void {
    for (const instance of this.pendingAreaDamage.drainReady(now)) {
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
  }

  private createBlazeGearstorm(
    player: Player,
    position: PlainVec3,
    now: number,
    durationSeconds: number
  ): void {
    this.blazeGearstorms.add({
      id: this.abilityIds.nextBlazeGearstormId(player.id),
      ownerId: player.id,
      ownerTeam: player.team as Team,
      position,
      radius: BLAZE_GEARSTORM_RADIUS,
      damage: BLAZE_GEARSTORM_DAMAGE,
      startTime: now,
      endTime: now + durationSeconds * 1000,
    });
  }

  private updateBlazeGearstorms(now: number): void {
    this.blazeGearstorms.update(now, {
      hasOwner: (ownerId) => this.state.players.has(ownerId),
      getTargets: (storm) => this.playerSpatialQueries.queryRadius(
        storm.position,
        storm.radius,
        { team: storm.ownerTeam === 'red' ? 'blue' : 'red' }
      ),
      applyDamage: (storm, target, distance) => {
        this.applyDamage(
          target,
          calculateFalloffDamage(storm.damage, distance, storm.radius, 0.35),
          storm.ownerId,
          'airstrike',
          {
            abilityId: 'blaze_airstrike',
            sourcePosition: storm.position,
          }
        );
      },
    });
  }

  private applyHookshotGroundHooksRoot(caster: Player, now: number): HookshotGroundHooksTarget[] {
    const ownerTeam = caster.team as Team;
    const enemyTeam = ownerTeam === 'red' ? 'blue' : 'red';
    const rootUntil = now + HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS * 1000;
    const targets = this.playerSpatialQueries.queryRadius(
      caster.position,
      HOOKSHOT_GROUND_HOOKS_RADIUS,
      { team: enemyTeam }
    );
    const rootedTargets: HookshotGroundHooksTarget[] = [];

    for (const target of targets) {
      if (target.state !== 'alive') continue;
      this.playerRoots.extendRoot(target.id, rootUntil);
      this.stopRootedMovement(target);
      this.markMovementBarrier(target.id, 'root', { preserveQueuedCommands: true });
      rootedTargets.push({
        targetId: target.id,
        position: vec3SchemaToPlain(target.position),
        rootUntil,
      });
    }

    return rootedTargets;
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
    const castId = this.abilityIds.nextBlazeRocketCastId(player.id);
    const lookDirection = getForwardVector(player.lookYaw, player.lookPitch);
    const aimOrigin = this.getBlazeAimOrigin(player);
    const startPosition = this.getAbilitySocketCastOrigin(player, 'blaze_rocket');
    const terrainHit = this.raycastTerrain(aimOrigin, lookDirection, BLAZE_ROCKET_AIM_DISTANCE);
    const targetHit = this.findTargetHitInAimCone(player, attack.range, attack.coneDot, attack.collisionRadius ?? 0);
    const targetPoint = targetHit?.hit.targetPoint ?? null;
    const terrainDistance = terrainHit ? distance3D(aimOrigin, terrainHit) : Infinity;
    const targetDistance = targetPoint ? distance3D(aimOrigin, targetPoint) : Infinity;
    const fallbackImpact = this.addScaled3D(aimOrigin, lookDirection, BLAZE_ROCKET_AIM_DISTANCE);
    const intendedImpactPosition = targetPoint && targetDistance <= terrainDistance
      ? targetPoint
      : terrainHit ?? fallbackImpact;
    const intendedImpactDistance = Math.min(
      BLAZE_ROCKET_AIM_DISTANCE,
      distance3D(aimOrigin, intendedImpactPosition)
    );
    const aegisHit = this.getChronosAegisSkillHit(player, aimOrigin, lookDirection, intendedImpactDistance, {
      projectileRadius: getChronosAegisCollisionRadiusForAttack(attack),
    });
    const impactPosition = aegisHit?.point ?? intendedImpactPosition;
    const aimDirection = this.normalize3D({
      x: impactPosition.x - startPosition.x,
      y: impactPosition.y - startPosition.y,
      z: impactPosition.z - startPosition.z,
    }) ?? lookDirection;
    const travelMs = Math.max(
      60,
      Math.min(3000, (distance3D(startPosition, impactPosition) / BLAZE_ROCKET_SPEED) * 1000)
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

    this.broadcastExactPlayerEvent('abilityUsed', player, {
      playerId: player.id,
      abilityId: 'blaze_rocket',
      castId: rocket.castId,
      position: vec3SchemaToPlain(player.position),
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
    const castId = this.abilityIds.nextSharedCastId(player.id, 'chronos_verdant_pulse');
    const lookDirection = getForwardVector(player.lookYaw, player.lookPitch);
    const aimOrigin = this.getChronosAimOrigin(player);
    const socketPosition = this.getAbilitySocketCastOrigin(player, 'chronos_verdant_pulse');
    const terrainHit = this.raycastTerrain(aimOrigin, lookDirection, CHRONOS_VERDANT_PULSE_AIM_DISTANCE);
    const targetHit = this.findTargetHitInAimCone(player, attack.range, attack.coneDot, attack.collisionRadius ?? 0);
    const targetPoint = targetHit?.hit.targetPoint ?? null;
    const terrainDistance = terrainHit ? distance3D(aimOrigin, terrainHit) : Infinity;
    const targetDistance = targetPoint ? distance3D(aimOrigin, targetPoint) : Infinity;
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

    this.broadcastExactPlayerEvent('abilityUsed', player, {
      playerId: player.id,
      abilityId: 'chronos_verdant_pulse',
      castId: pulse.castId,
      position: vec3SchemaToPlain(player.position),
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
    const lookDirection = getForwardVector(player.lookYaw, player.lookPitch);
    const terrainHit = this.raycastTerrain(aimOrigin, lookDirection, BLAZE_BOMB_MAX_RANGE);
    let targetPosition = terrainHit ?? this.addScaled3D(aimOrigin, lookDirection, BLAZE_BOMB_MAX_RANGE);

    const horizontalDistance = distance2D(aimOrigin, targetPosition);
    if (horizontalDistance < BLAZE_BOMB_MIN_RANGE) {
      const forward = forward2D(player.lookYaw);
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
    const castId = this.abilityIds.nextBlazeBombCastId(player.id);
    const targetPosition = this.resolveBlazeBombTarget(player);
    const startPosition = this.getAbilitySocketCastOrigin(player, 'blaze_bomb');
    const meteorPath = getBlazeMeteorPath({ id: castId, startPosition, targetPosition });
    const aegisHit = this.getChronosAegisSkillHit(
      player,
      meteorPath.entryPosition,
      meteorPath.travelDirection,
      meteorPath.distance,
      { projectileRadius: getChronosAegisCollisionRadiusForAttack(attack) }
    );
    const impactProgress = aegisHit
      ? Math.sqrt(clamp(aegisHit.distance / Math.max(0.0001, meteorPath.distance), 0, 1))
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

    this.broadcastExactPlayerEvent('abilityUsed', player, {
      playerId: player.id,
      abilityId: 'blaze_bomb',
      castId,
      position: vec3SchemaToPlain(player.position),
      startPosition,
      targetPosition,
      interceptPosition: aegisHit?.point,
      impactPosition: aegisHit?.point ?? targetPosition,
      interceptedByChronosAegis: Boolean(aegisHit),
      aimDirection: getForwardVector(player.lookYaw, player.lookPitch),
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
    this.broadcastExactPlayerEvent('abilityUsed', caster, payload as unknown as Record<string, unknown>);
  }

  private broadcastPhantomAttackCast(
    player: Player,
    abilityId: 'phantom_dire_ball' | 'phantom_void_ray',
    now: number,
    impactHint: SkillImpactHint = {}
  ): void {
    const aimDirection = getForwardVector(player.lookYaw, player.lookPitch);
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
      castId: this.abilityIds.nextSharedCastId(player.id, abilityId),
      position: vec3SchemaToPlain(player.position),
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
    const tempoMultiplier = this.getAbilityTempoMultiplier(player, now);
    this.broadcastPhantomCast({
      playerId: player.id,
      abilityId: 'phantom_void_ray_charge',
      castId: this.abilityIds.nextSharedCastId(player.id, 'phantom_void_ray_charge'),
      position: vec3SchemaToPlain(player.position),
      startPosition: this.getAbilitySocketCastOrigin(player, 'phantom_void_ray_charge'),
      aimDirection: getForwardVector(player.lookYaw, player.lookPitch),
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
      castId: this.abilityIds.nextSharedCastId(player.id, 'phantom_void_ray_charge_cancel'),
      position: vec3SchemaToPlain(player.position),
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
      castId: this.abilityIds.nextSharedCastId(player.id, abilityId),
      position: vec3SchemaToPlain(player.position),
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
    const start = vec3SchemaToPlain(player.position);
    return resolveCapsuleTeleportDestination(
      this.getMovementCollisionWorld(),
      start,
      calculateLookDirection(player.lookYaw, player.lookPitch),
      distance,
      { clampPosition: (candidate) => this.clampToPlayableMap(candidate) }
    );
  }

  private handlePhantomSecondaryInput(player: Player, input: PlayerInput, previousSecondaryFire: boolean, now: number): void {
    const wasCharging = this.phantomVoidRayCharges.isCharging(player.id);

    if (this.isPhantomPrimaryReloading(player, now)) {
      if (wasCharging && !this.phantomVoidRayCharges.isResolvedForPress(player.id)) {
        this.broadcastPhantomVoidRayChargeCancel(player, now);
      }
      this.phantomVoidRayCharges.clear(player.id);
      if (input.secondaryFire && !previousSecondaryFire) {
        this.rejectAbilityOrCombat(player, 'phantom_reload_blocks:phantom_void_ray', false);
      }
      return;
    }

    if (input.secondaryFire && !previousSecondaryFire) {
      const secondaryAttack = isHeroId(player.heroId)
        ? getRoomAttackConfig({ heroId: player.heroId, mode: 'secondary', chronosAscendantActive: false })
        : null;
      if (!secondaryAttack || this.attackCooldowns.isCoolingDown(player.id, 'secondary', now)) {
        return;
      }

      this.phantomVoidRayCharges.start(player.id, now);
      this.broadcastPhantomVoidRayCharge(player, now);
      return;
    }

    const chargeStartedAt = this.phantomVoidRayCharges.getStartedAt(player.id);
    const tempoMultiplier = this.getAbilityTempoMultiplier(player, now);
    const chargeComplete =
      chargeStartedAt !== undefined &&
      now - chargeStartedAt >= VOID_RAY_CHARGE_TIME / tempoMultiplier;

    if (!input.secondaryFire) {
      if (wasCharging && !this.phantomVoidRayCharges.isResolvedForPress(player.id)) {
        if (chargeComplete) {
          this.tryResolveAttack(player, 'secondary', now);
          this.phantomVoidRayCharges.markResolvedForPress(player.id);
        } else {
          this.broadcastPhantomVoidRayChargeCancel(player, now);
        }
      }
      this.phantomVoidRayCharges.clear(player.id);
      return;
    }

    if (chargeStartedAt === undefined || this.phantomVoidRayCharges.isResolvedForPress(player.id)) return;
  }

  private handleAbilityUse(
    player: Player,
    slot: 'ability1' | 'ability2' | 'ultimate',
    options: { chronosLifelineMode?: ChronosLifelineMode } = {},
    usedAt = Date.now()
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
    const abilityId = HERO_DEFINITIONS[player.heroId as HeroId]?.[slot]?.abilityId;
    const preflightRejection = getAbilityUsePreflightRejection({
      playerState: player.state,
      heroId: player.heroId,
      isHeroId: isHeroId(player.heroId),
      slot,
      abilityId,
      chronosLifelineMode,
      chronosLifelineTargetCount: chronosLifelineTargets?.length ?? 0,
      hasHookshotGrappleTarget: Boolean(hookshotGrappleTarget),
      phantomPrimaryReloading: Boolean(
        abilityId &&
        abilityId !== 'phantom_blink' &&
        this.isPhantomPrimaryReloading(player, usedAt)
      ),
      rootedAndBlocked: this.playerRoots.isRooted(player.id, usedAt) && isRootBlockedAbility(abilityId),
    });
    if (preflightRejection) {
      this.rejectAbilityOrCombat(player, preflightRejection.reason, preflightRejection.logEvent);
      return;
    }

    const result = tryUseAbility(player, slot);
    if (!result.success || !result.abilityId || !result.abilityState || !result.abilityDef) {
      this.rejectAbilityOrCombat(player, `ability_unavailable:${slot}`, false);
      return;
    }

    const ability: ResolvedAbilityUseResult = {
      abilityId: result.abilityId,
      abilityDef: result.abilityDef,
      abilityState: result.abilityState,
    };
    const startedAt = vec3SchemaToPlain(player.position);

    if (ability.abilityId === 'chronos_lifeline_conduit' && chronosLifelineTargets && chronosLifelineMode) {
      this.handleChronosLifelineAbilityCast(player, ability, chronosLifelineTargets, chronosLifelineMode, usedAt);
      return;
    }

    this.executeRoomAbilityEffect(player, ability);

    if (ability.abilityId === 'blaze_flamethrower') {
      return;
    }

    if (this.tryBroadcastHookshotAbilityCast(player, ability, hookshotGrappleTarget, usedAt)) {
      return;
    }

    this.handleStandardAbilityCast(player, ability, startedAt, usedAt);
  }

  private getAbilityCasterSnapshot(player: Player): AbilityCasterSnapshot {
    return {
      id: player.id,
      team: player.team as Team,
      heroId: player.heroId,
      position: vec3SchemaToPlain(player.position),
      velocity: vec3SchemaToPlain(player.velocity),
      lookYaw: player.lookYaw,
      lookPitch: player.lookPitch,
    };
  }

  private executeRoomAbilityEffect(player: Player, ability: ResolvedAbilityUseResult): void {
    executeAbility(player, ability.abilityId, ability.abilityState, ability.abilityDef, {
      createVoidZone: (position, ownerId, ownerTeam) => this.createVoidZone(position, ownerId, ownerTeam),
      resolvePhantomBlinkDestination: (caster, distance) => this.resolvePhantomBlinkDestination(caster, distance),
      clampPosition: (position) => this.clampToPlayableMap(position),
      markAuthoritativePosition: (playerId, _durationMs, reason = 'teleport') => {
        this.markMovementBarrier(playerId, reason, { preserveQueuedCommands: true });
      },
    });
  }

  private handleChronosLifelineAbilityCast(
    player: Player,
    ability: ResolvedAbilityUseResult,
    targets: Player[],
    mode: ChronosLifelineMode,
    usedAt: number
  ): void {
    const targetIds = targets.map((target) => target.id);
    const plan = buildChronosLifelineCastPlan({
      caster: this.getAbilityCasterSnapshot(player),
      abilityId: ability.abilityId,
      castId: this.abilityIds.nextSharedCastId(player.id, ability.abilityId),
      startPosition: this.getAbilitySocketCastOrigin(player, 'chronos_lifeline_conduit'),
      targetIds,
      mode,
      usedAt,
    });
    ability.abilityState.activatedAt = usedAt;

    this.broadcastExactPlayerEvent('abilityUsed', player, plan.payload);
    this.scheduleChronosLifelineConduit(
      player.id,
      plan.targetIds,
      plan.healAmount,
      plan.releaseAt
    );
  }

  private tryBroadcastHookshotAbilityCast(
    player: Player,
    ability: ResolvedAbilityUseResult,
    hookshotGrappleTarget: PlainVec3 | null,
    usedAt: number
  ): boolean {
    if (player.heroId === 'hookshot') {
      const castId = this.abilityIds.nextSharedCastId(player.id, ability.abilityId);

      if (ability.abilityId === 'hookshot_grapple' && hookshotGrappleTarget) {
        const launchSide = 1;
        const startPosition = this.getAbilitySocketCastOrigin(player, 'hookshot_grapple', launchSide);
        const aimDirection = this.normalize3D({
          x: hookshotGrappleTarget.x - startPosition.x,
          y: hookshotGrappleTarget.y - startPosition.y,
          z: hookshotGrappleTarget.z - startPosition.z,
        }) ?? getForwardVector(player.lookYaw, player.lookPitch);
        this.startHookshotGrappleAuthority(
          player,
          castId,
          hookshotGrappleTarget,
          startPosition,
          usedAt
        );

        this.broadcastExactPlayerEvent('abilityUsed', player, buildHookshotGrappleCastPayload({
          caster: this.getAbilityCasterSnapshot(player),
          abilityId: ability.abilityId,
          castId,
          startPosition,
          targetPosition: hookshotGrappleTarget,
          aimDirection,
          usedAt,
        }));
        return true;
      }

      if (ability.abilityId === 'hookshot_anchor_wall') {
        const wall = this.resolveHookshotAnchorWall(player);
        const plan = buildHookshotAnchorWallPlan({
          caster: this.getAbilityCasterSnapshot(player),
          abilityId: ability.abilityId,
          castId,
          startPosition: wall.startPosition,
          direction: wall.direction,
          usedAt,
        });
        this.createHookshotAnchorWall(plan.wall);
        this.broadcastExactPlayerEvent('abilityUsed', player, plan.payload);
        return true;
      }

      if (ability.abilityId === 'hookshot_ground_hooks') {
        const rootTargets = this.applyHookshotGroundHooksRoot(player, usedAt);
        const castId = this.abilityIds.nextHookshotGroundHooksCastId(player.id);
        this.broadcastExactPlayerEvent('abilityUsed', player, buildHookshotGroundHooksCastPayload({
          caster: this.getAbilityCasterSnapshot(player),
          abilityId: ability.abilityId,
          castId,
          rootTargets,
          usedAt,
        }));
        return true;
      }
    }

    return false;
  }

  private handleStandardAbilityCast(
    player: Player,
    ability: ResolvedAbilityUseResult,
    startedAt: PlainVec3,
    usedAt: number
  ): void {
    const abilityStartPosition = ability.abilityId === 'blaze_rocketjump'
      ? this.getAbilitySocketCastOrigin(player, 'blaze_rocketjump')
      : ability.abilityId === 'chronos_timebreak'
        ? this.getAbilitySocketCastOrigin(player, 'chronos_timebreak')
        : startedAt;
    const standardPlan = buildStandardAbilityCastPlan({
      caster: this.getAbilityCasterSnapshot(player),
      abilityId: ability.abilityId,
      abilityDef: ability.abilityDef,
      castId: this.abilityIds.nextSharedCastId(player.id, ability.abilityId),
      startedAt,
      abilityStartPosition,
      abilityActivatedAt: ability.abilityState.activatedAt,
      usedAt,
    });

    if (standardPlan.timebreakShockwave) {
      this.scheduleChronosTimebreakShockwave(
        standardPlan.timebreakShockwave.casterId,
        standardPlan.timebreakShockwave.direction,
        standardPlan.timebreakShockwave.releaseAt
      );
    }

    if (standardPlan.blazeGearstorm) {
      this.createBlazeGearstorm(
        player,
        standardPlan.blazeGearstorm.startedAt,
        standardPlan.blazeGearstorm.usedAt,
        standardPlan.blazeGearstorm.duration
      );
    }

    this.broadcastExactPlayerEvent('abilityUsed', player, standardPlan.payload);
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
      if (preferredHero && this.setPlayerHero(bot, preferredHero)) {
        this.botRuntime.setPreferredHero(bot.id, preferredHero);
      }

      this.state.players.set(bot.id, bot);
      this.replicationState.markKnownPlayer(bot.id);
      this.updateLastSafeMovement(bot, 0);
      this.initializePressState(bot.id);
      this.botRuntime.setBrain(bot.id, this.createBotBrain(bot, index));
    });
  }

  private createBotBrain(bot: Player, index = 0): BotBrain {
    const brain = createInitialBotBrain(vec3SchemaToPlain(bot.position), index);
    brain.aimYaw = bot.lookYaw;
    brain.aimPitch = bot.lookPitch;
    return brain;
  }

  private initializePressState(playerId: string): void {
    this.playerPressStates.initialize(playerId);
  }

  private clearPrimaryHoldStates(playerId: string): void {
    this.phantomPrimaryHolds.clear(playerId);
    this.chronosPrimaryHolds.clear(playerId);
  }

  private resetPhantomPrimaryMagazine(playerId: string): void {
    this.phantomPrimaryHolds.clear(playerId);
    this.phantomPrimaryMagazines.reset(playerId);
    const player = this.state.players.get(playerId);
    if (player?.heroId === 'phantom') {
      this.sendPhantomPrimaryState(player, Date.now());
    }
  }

  private getOrCreatePhantomPrimaryMagazine(player: Player): PhantomPrimaryMagazineState {
    return this.phantomPrimaryMagazines.getOrCreate(player.id);
  }

  private completePhantomPrimaryReloadIfReady(player: Player, now: number): PhantomPrimaryMagazineState {
    const { magazine, completed } = this.phantomPrimaryMagazines.completeReloadIfReady(player.id, now);
    if (completed) {
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

    const state = this.phantomPrimaryMagazines.getClientState(player.id, now);
    const client = this.clientRegistry.getClient(player.id);
    if (!client) return;
    this.sendTracked(client, 'phantomPrimaryState', state);
  }

  private consumePhantomPrimaryShot(player: Player, now: number): boolean {
    if (player.heroId !== 'phantom') return true;

    this.completePhantomPrimaryReloadIfReady(player, now);
    const result = this.phantomPrimaryMagazines.consumeShot(player.id, now);

    if (!result.consumed) {
      this.sendPhantomPrimaryState(player, now);
      return false;
    }

    return true;
  }

  private reloadHeroPrimary(player: Player, now: number): boolean {
    if (player.heroId !== 'phantom') return false;

    this.completePhantomPrimaryReloadIfReady(player, now);
    const result = this.phantomPrimaryMagazines.reload(player.id, now);

    if (!result.started) {
      this.sendPhantomPrimaryState(player, now);
      return false;
    }

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

    this.phantomPrimaryHolds.update(player.id, input.primaryFire, previous.primaryFire, now);
  }

  private isPhantomPrimaryReady(player: Player, now: number): boolean {
    if (player.heroId !== 'phantom') return true;

    return this.phantomPrimaryHolds.isReady(player.id, now, PHANTOM_PRIMARY_FIRE_READY_MS);
  }

  private updateChronosPrimaryHoldState(
    player: Player,
    input: PlayerInput,
    previous: PlayerPressState,
    now: number
  ): void {
    if (player.heroId !== 'chronos') return;

    this.chronosPrimaryHolds.update(
      player.id,
      Boolean(input.primaryFire && !input.ability1),
      previous.primaryFire,
      now
    );
  }

  private isChronosPrimaryReady(player: Player, now: number): boolean {
    if (player.heroId !== 'chronos') return true;

    return this.chronosPrimaryHolds.isReady(player.id, now, CHRONOS_VERDANT_PULSE_FIRE_READY_MS);
  }

  private processPlayerInput(
    player: Player,
    input: PlayerInput,
    now = Date.now()
  ): void {
    if (player.state !== 'alive') return;

    const previous = this.playerPressStates.getOrCreate(player.id);
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
      this.handleAbilityUse(player, 'ability1', { chronosLifelineMode }, now);
    }

    if (input.primaryFire && !isChronosLifelineCommit) {
      this.tryResolveAttack(player, 'primary', now);
    }
    if (player.heroId === 'phantom') {
      this.handlePhantomSecondaryInput(player, input, previous.secondaryFire, now);
    } else if (player.heroId === 'blaze') {
      if (!input.secondaryFire && previous.secondaryFire) {
        this.tryResolveAttack(player, 'secondary', now);
      }
    } else if (shouldResolveGenericSecondaryAttack(player.heroId, input, previous.secondaryFire, isChronosLifelineCommit)) {
      this.tryResolveAttack(player, 'secondary', now);
    }

    if (input.ability1 && !previous.ability1 && !isChronosLifelineCommit) {
      this.handleAbilityUse(player, 'ability1', {}, now);
    }
    if (input.ability2 && !previous.ability2) {
      this.handleAbilityUse(player, 'ability2', {}, now);
    }
    if (input.ultimate && !previous.ultimate) {
      this.handleAbilityUse(player, 'ultimate', {}, now);
    }

    this.playerPressStates.applyInput(player.id, {
      primaryFire: input.primaryFire,
      secondaryFire: input.secondaryFire,
      reload: reloadPressed,
      ability1: input.ability1,
      ability2: input.ability2,
      ultimate: input.ultimate,
    });
  }

  private tryResolveAttack(player: Player, mode: AttackMode, now = Date.now()): void {
    const heroId = isHeroId(player.heroId) ? player.heroId : null;
    const attack = heroId
      ? getRoomAttackConfig({
        heroId,
        mode,
        chronosAscendantActive: heroId === 'chronos' && mode === 'primary' && this.isChronosAscendantActive(player),
      })
      : null;
    const readinessRejection = getAttackPreflightRejection({
      isHeroId: Boolean(heroId),
      playerState: player.state,
      mode,
      attackExists: Boolean(attack),
      isCoolingDown: this.attackCooldowns.isCoolingDown(player.id, mode, now),
      phantomPrimaryReady: mode !== 'primary' || this.isPhantomPrimaryReady(player, now),
      chronosPrimaryReady: mode !== 'primary' || this.isChronosPrimaryReady(player, now),
      phantomPrimaryShotAvailable: true,
    });
    if (readinessRejection || !heroId || !attack) {
      this.rejectAbilityOrCombat(
        player,
        readinessRejection?.reason ?? `attack_missing_config:${mode}`,
        readinessRejection?.logEvent ?? true
      );
      return;
    }

    if (mode === 'primary' && !this.consumePhantomPrimaryShot(player, now)) {
      const ammoRejection = getAttackPreflightRejection({
        isHeroId: true,
        playerState: player.state,
        mode,
        attackExists: true,
        isCoolingDown: false,
        phantomPrimaryReady: true,
        chronosPrimaryReady: true,
        phantomPrimaryShotAvailable: false,
      });
      this.rejectAbilityOrCombat(player, ammoRejection?.reason ?? 'phantom_primary_no_ammo', ammoRejection?.logEvent ?? false);
      return;
    }
    this.attackCooldowns.setFromDuration(player.id, mode, now, attack.cooldownMs);

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
    const forward = getForwardVector(player.lookYaw, player.lookPitch);
    const primaryTargetHit = this.findTargetHitInAimCone(
      player,
      attack.range,
      attack.coneDot,
      attack.collisionRadius ?? 0,
      attack.targetTeam ?? 'enemy'
    );
    const aegisHit = this.getChronosAegisSkillHit(player, origin, forward, attack.range, {
      projectileRadius: getChronosAegisCollisionRadiusForAttack(attack),
    });
    const aegisBlocksAttack = Boolean(aegisHit && (!primaryTargetHit || aegisHit.distance <= primaryTargetHit.hit.distance));
    const impactHint = buildAttackImpactHint({
      aegisBlocksAttack,
      aegisPoint: aegisHit?.point,
    });
    const castKind = getAttackCastKind({ heroId, mode });
    if (castKind === 'phantom_dire_ball' || castKind === 'phantom_void_ray') {
      this.broadcastPhantomAttackCast(player, castKind, now, impactHint);
    } else if (castKind === 'hookshot_basic_attack' || castKind === 'hookshot_heavy_attack') {
      this.broadcastHookshotAttackCast(player, castKind, now, withHookshotHeavyAttackTargetHint({
        impactHint,
        mode,
        aegisBlocksAttack,
        targetId: primaryTargetHit?.target.id,
      }));
    } else if (castKind === 'chronos_verdant_pulse') {
      this.broadcastChronosVerdantPulseCast(player, attack, now, impactHint);
    }

    this.applyResolvedAttackDamage({
      player,
      heroId,
      mode,
      attack,
      now,
      origin,
      forward,
      primaryTarget: primaryTargetHit?.target ?? null,
      aegisHit,
      aegisBlocksAttack,
    });
  }

  private applyResolvedAttackDamage(input: {
    player: Player;
    heroId: HeroId;
    mode: AttackMode;
    attack: AttackConfig;
    now: number;
    origin: PlainVec3;
    forward: PlainVec3;
    primaryTarget: Player | null;
    aegisHit: ChronosAegisSkillHit | null;
    aegisBlocksAttack: boolean;
  }): void {
    const {
      player,
      heroId,
      mode,
      attack,
      now,
      origin,
      forward,
      primaryTarget,
      aegisHit,
      aegisBlocksAttack,
    } = input;
    const damagePlan = getAttackDamageResolutionPlan({
      heroId,
      mode,
      aegisBlocksAttack,
      hasPrimaryTarget: Boolean(primaryTarget),
      attackRadius: attack.radius,
    });

    if (damagePlan.action === 'chronos_aegis_absorb' && aegisHit) {
      this.absorbDamageWithChronosAegis(aegisHit.blocker, attack.damage, now, {
        source: player,
        damageType: attack.damageType,
        position: aegisHit.point,
        direction: aegisHit.normal,
      });
      return;
    }

    if (!primaryTarget || damagePlan.action === 'none') return;
    this.recordCombatVisibilityAtHit(player, primaryTarget, mode, attack.damageType, now);

    if (damagePlan.action === 'area_damage') {
      this.applyAreaDamage(player, primaryTarget.position, attack.radius ?? 0, attack.damage, attack.damageType);
    } else if (damagePlan.action === 'direct_damage') {
      this.applyDamage(primaryTarget, attack.damage, player.id, attack.damageType, {
        sourcePosition: origin,
        sourceDirection: forward,
      });
    }

    if (damagePlan.startHookshotDragPull) {
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
    const distance = distance3D(source.position, target.position);
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

  private cleanupDamageWindows(now: number): void {
    this.damageRuntime.cleanupDamageWindows(now);
  }

  private findTargetHitInAimCone(
    source: Player,
    range: number,
    minDot: number,
    extraRadius = 0,
    targetTeam: AttackTargetTeam = 'enemy'
  ): AimTargetHit | null {
    const origin = this.getPlayerEyePosition(source);
    const forward = getForwardVector(source.lookYaw, source.lookPitch);
    let bestTargetHit: AimTargetHit | null = null;
    let bestDistance = range;
    const candidateRange = range + extraRadius + PLAYER_RADIUS + PLAYER_COMBAT_HITBOX_PADDING;
    const targetTeamFilter = targetTeam === 'enemy'
      ? (source.team === 'red' ? 'blue' : 'red')
      : undefined;
    const candidates = this.playerSpatialQueries.queryConeCandidates(
      origin,
      candidateRange,
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
  ): PlayerCombatHitResult | null {
    return getAimConeHitAgainstPlayerCombatHitbox(
      origin,
      forward,
      range,
      minDot,
      {
        position: vec3SchemaToPlain(target.position),
        heroId: target.heroId,
      },
      extraRadius,
      { hasLineOfSight: (from, to) => this.hasLineOfSight(from, to) }
    );
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
        position: vec3SchemaToPlain(target.position),
        heroId: target.heroId,
      },
      extraRadius
    );
  }

  private applyAreaDamage(source: Player, center: { x: number; y: number; z: number }, radius: number, damage: number, damageType: string): void {
    const radiusSq = radius * radius;
    const targets = this.playerSpatialQueries.queryRadius(
      center,
      radius,
      { team: source.team === 'red' ? 'blue' : 'red', excludeId: source.id }
    );
    for (const target of targets) {
      if (target.id === source.id) continue;

      const dx = target.position.x - center.x;
      const dy = target.position.y - center.y;
      const dz = target.position.z - center.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > radiusSq) continue;

      this.applyDamage(target, calculateFalloffDamage(damage, Math.sqrt(distSq), radius, 0.45), source.id, damageType, {
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

  private getChronosAegisShieldRatio(playerId: string): number {
    return this.chronosAegisShields.getRatio(playerId);
  }

  private getChronosAegisShieldByte(player: Player): number {
    if (player.heroId !== 'chronos') return CHRONOS_AEGIS_SHIELD_TRANSFORM_SCALE;
    return Math.round(this.getChronosAegisShieldRatio(player.id) * CHRONOS_AEGIS_SHIELD_TRANSFORM_SCALE);
  }

  private isChronosAegisActive(player: Player): boolean {
    return this.chronosAegisShields.isActive(player);
  }

  private getChronosAegisForward(player: Player): PlainVec3 {
    return getSharedChronosAegisForward(player.lookYaw, player.lookPitch);
  }

  private getChronosAegisCenter(player: Player): PlainVec3 {
    return getSharedChronosAegisCenter({
      playerId: player.id,
      position: vec3SchemaToPlain(player.position),
      lookYaw: player.lookYaw,
      lookPitch: player.lookPitch,
    });
  }

  private updateChronosAegisShields(dt: number): void {
    this.chronosAegisShields.update(this.state.players.values(), dt);
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
    const aegisCandidates = this.playerSpatialIndex.getTeamPlayers(shieldTeam);
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
            position: vec3SchemaToPlain(aegisPlayer.position),
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
          position: vec3SchemaToPlain(aegisPlayer.position),
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

    const hit = this.getChronosAegisSkillHit(source, sourcePoint, segment, distance3D(sourcePoint, targetPoint), {
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
    const absorption = this.chronosAegisShields.absorbDamage(blocker.id, rawDamage);
    if (!absorption.hadShield) return absorption.remainingDamage;

    this.replicationState.markRecentCombatTransform(blocker.id, now, RECENT_COMBAT_TRANSFORM_MS);
    const direction = context.direction ?? this.getChronosAegisForward(blocker);
    if (absorption.absorbed > 0) {
      this.playerCombatActivity.markBetween(context.source ?? null, blocker, now);
      this.broadcastChronosAegisDamaged(blocker, context.source ?? null, {
        playerId: blocker.id,
        sourceId: context.source?.id ?? null,
        damage: Math.max(1, Math.round(absorption.absorbed)),
        damageType: context.damageType ?? 'shield',
        shieldHp: Math.max(0, absorption.nextHp),
        shieldRatio: absorption.shieldRatio,
        position: context.position ?? this.getChronosAegisCenter(blocker),
        direction,
        serverTime: now,
      });
    }
    if (absorption.broken) {
      this.broadcastExactPlayerEvent('chronosAegisBroken', blocker, {
        playerId: blocker.id,
        position: this.getChronosAegisCenter(blocker),
        direction,
        serverTime: now,
      });
    }

    return absorption.remainingDamage;
  }

  private applyDamage(
    target: Player,
    rawDamage: number,
    sourceId: string | null,
    damageType: string,
    context: DamageContext = {}
  ): boolean {
    return this.damageRuntime.applyPlayerDamage(target, rawDamage, sourceId, damageType, context);
  }

  private startHookshotDragPull(target: Player, source: Player, distance: number, now: number): void {
    const forward = normalizeHorizontalPlain(getForwardVector(source.lookYaw, 0));
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
    this.hookshotRuntime.setDragPull(target.id, pull);
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
    this.hookshotRuntime.clearDragPull(player.id);
    player.velocity.x = 0;
    player.velocity.z = 0;
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
    player.movement.isWallRunning = false;
    player.movement.wallRunSide = '';
    player.movement.isGrappling = false;
  }

  private stepHookshotDragPullAuthority(player: Player, dt: number, now: number): boolean {
    const pull = this.hookshotRuntime.getDragPull(player.id);
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

    const currentPosition = vec3SchemaToPlain(player.position);
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
    const resolvedStep = resolveHookshotDragPullTerrainStep({
      collisionWorld,
      startPosition: currentPosition,
      desiredDelta: moveDelta,
      destination,
      clampToPlayableMap: (position) => this.clampToPlayableMap(position),
    });
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
    if (!this.hookshotRuntime.hasDragPull(player.id)) return false;

    let moved = false;
    const authority = this.getMovementAuthority(player.id);
    for (let step = 0; step < SERVER_MOVEMENT_SUBSTEPS_PER_TICK; step++) {
      if (!this.hookshotRuntime.hasDragPull(player.id)) break;
      const stepNow = tickTime + step * MOVEMENT_SUBSTEP_SECONDS * 1000;
      const input = this.getRootedMovementInput(
        player,
        suppressLocomotionInput(player.lastInput ?? createEmptyPlayerInput(this.state.tick, player, stepNow)),
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
    this.roomTimeouts.schedule(() => {
      this.applyChronosTimebreakShockwave(casterId, castDirection);
    }, delayMs);
  }

  private applyChronosTimebreakShockwave(casterId: string, castDirection: PlainVec3): void {
    const caster = this.state.players.get(casterId);
    if (!caster || caster.state !== 'alive') return;
    if (caster.team !== 'red' && caster.team !== 'blue') return;

    const forward = normalizeHorizontalPlain(castDirection);
    if (!forward) return;

    const origin = vec3SchemaToPlain(caster.position);
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

      const targetClient = this.clientRegistry.getClient(target.id);
      targetClient?.send('chronosTimebreakImpulse', {
        sourceId: caster.id,
        sourcePosition: origin,
        impulse,
      });
    });
  }

  private getActiveSpeedMultiplier(player: Player): number {
    const now = Date.now();
    let multiplier = 1;
    if (player.abilities.get('phantom_veil')?.isActive) multiplier *= PHANTOM_VEIL_SPEED_MULTIPLIER;
    if (this.isChronosAscendantActive(player, now)) {
      multiplier *= CHRONOS_ASCENDANT_PARADOX_SPEED_MULTIPLIER;
    }
    if (this.powerupBoosts.has(player.id, now)) {
      multiplier *= POWERUP_MOVEMENT_SPEED_MULTIPLIER;
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

  private getAbilityTempoMultiplier(player: Player, now = Date.now()): number {
    let multiplier = this.getChronosTimebreakTempoMultiplier(player);
    if (this.powerupBoosts.has(player.id, now)) {
      multiplier *= POWERUP_ABILITY_ATTACK_SPEED_MULTIPLIER;
    }
    return multiplier;
  }

  private updateTimeScaledSkillTimers(
    player: Player,
    dt: number,
    tempoMultiplier: number,
    now: number
  ): void {
    const adjustmentMs = (tempoMultiplier - 1) * Math.max(0, dt) * 1000;
    if (Math.abs(adjustmentMs) <= 0.001) return;

    this.attackCooldowns.adjust(player.id, 'primary', adjustmentMs, now);
    this.attackCooldowns.adjust(player.id, 'secondary', adjustmentMs, now);

    if (this.phantomPrimaryMagazines.adjustActiveReload(player.id, adjustmentMs, now).adjusted) {
      this.sendPhantomPrimaryState(player, now);
    }
  }

  private updateCTFObjectives(now: number): void {
    this.updateCarriedFlagPositions();
    this.checkFlagReturns(now);

    this.state.players.forEach((player) => {
      if (player.state !== 'alive') return;
      if (!isTeam(player.team)) return;
      if (this.isObjectiveSuppressed(player.id, now)) return;

      const playerTeam = player.team;
      const enemyTeam = getEnemyTeam(playerTeam);
      const ownFlag = getFlagByTeam(this.state, playerTeam);
      const enemyFlag = getFlagByTeam(this.state, enemyTeam);
      const carriedFlagCount = getCarriedFlagCountForPlayer(this.state, player.id);
      if (player.hasFlag && carriedFlagCount !== 1) {
        player.hasFlag = false;
        this.recordObjectiveEvent(player, 'carrier_mismatch', enemyTeam, now);
        return;
      }

      if (!ownFlag.isAtBase && !ownFlag.carrierId && distance2D(player.position, ownFlag.position) <= FLAG_PICKUP_RADIUS) {
        this.returnFlagToBase(playerTeam, player.id);
        player.flagReturns++;
        this.recordMatchFlagReturn(player);
        player.ultimateCharge = Math.min(100, player.ultimateCharge + 10);
        this.recordObjectiveEvent(player, 'return', playerTeam, now);
      }

      if (!player.hasFlag && !enemyFlag.carrierId && distance2D(player.position, enemyFlag.position) <= FLAG_PICKUP_RADIUS) {
        setFlagCarried(enemyFlag, player.id);
        player.hasFlag = true;
        this.recordObjectiveEvent(player, 'pickup', enemyTeam, now);
        this.broadcastTracked('flagPickup', {
          team: enemyTeam,
          playerId: player.id,
          position: getCoarseEventPosition(vec3SchemaToPlain(player.position)),
          timestamp: now,
        });
      }

      if (player.hasFlag && ownFlag.isAtBase && distance2D(player.position, ownFlag.basePosition) <= FLAG_CAPTURE_RADIUS) {
        this.captureFlag(player, enemyTeam, now);
      }
    });
  }

  private updateCarriedFlagPositions(): void {
    for (const team of CTF_TEAMS) {
      const flag = getFlagByTeam(this.state, team);
      if (!flag.carrierId) continue;
      syncCarriedFlagPosition(flag, this.state.players.get(flag.carrierId));
    }
  }

  private captureFlag(player: Player, capturedTeam: Team, now: number): void {
    if (!isTeam(player.team) || player.state !== 'alive' || this.isObjectiveSuppressed(player.id, now)) {
      return;
    }

    const flag = getFlagByTeam(this.state, capturedTeam);
    resetFlagToBase(flag);

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
      position: getCoarseEventPosition(vec3SchemaToPlain(player.position)),
      redScore: this.state.redTeam.score,
      blueScore: this.state.blueTeam.score,
      timestamp: now,
    });

    if (hasTeamReachedScoreLimit(this.state.redTeam.score, this.state.blueTeam.score, this.config.scoreToWin)) {
      this.endRound();
    } else {
      this.returnFlagToBase(capturedTeam, player.id, false);
    }
  }

  private returnFlagToBase(team: Team, playerId = '', broadcast = true): void {
    const flag = getFlagByTeam(this.state, team);
    resetFlagToBase(flag);

    if (broadcast) {
      this.broadcastTracked('flagReturn', {
        team,
        playerId,
        position: vec3SchemaToPlain(flag.position),
        timestamp: Date.now(),
      });
    }
  }

  private updateBots(now: number, dt: number): void {
    this.botRuntime.beginFrameSchedule();
    const frameContext = this.buildBotFrameContext(now);

    this.botRuntime.forEachBrain((brain, botId) => {
      const bot = this.state.players.get(botId);
      if (!bot?.isBot) {
        this.botRuntime.deleteBrain(botId);
        return;
      }

      if (this.state.phase === 'hero_select' && bot.state === 'selecting') {
        let changedSelectionState = false;
        if (!bot.heroId) {
          this.setPlayerHero(bot, this.selectRandomBotHero(bot.team, bot.id));
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
          targetPosition: vec3SchemaToPlain(bot.position),
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
        this.devRuntime.clearPlayer(bot.id);
        bot.lastInput = createEmptyBotInput(this.state.tick, bot, now);
        if (bot.state === 'dead') {
          brain.intent = {
            ...brain.intent,
            type: 'respawning',
            score: 0,
            targetPosition: vec3SchemaToPlain(bot.position),
            reason: 'bot is dead',
            candidates: [],
          };
        }
        return;
      }

      if (this.devRuntime.areBotsRooted()) {
        const skillOverride = this.getActiveDevBotSkillOverride(bot, now);
        const lookOverride = this.getActiveDevBotLookOverride(bot, now);
        if (skillOverride || lookOverride) {
          bot.lastInput = applyDevBotLookOverride(
            this.createDevBotSkillInput(bot, now, skillOverride),
            lookOverride
          );
          stopBotMovement(bot, { vertical: true });
          this.enqueueServerOwnedMovementCommands(bot, bot.lastInput, now);
        } else {
          this.rootBotMovementAndSkills(bot, now);
        }
        return;
      }

      if (!this.devRuntime.isBotBrainEnabled()) {
        const skillOverride = this.getActiveDevBotSkillOverride(bot, now);
        const lookOverride = this.getActiveDevBotLookOverride(bot, now);
        if (skillOverride || lookOverride) {
          bot.lastInput = applyDevBotLookOverride(
            this.createDevBotSkillInput(bot, now, skillOverride),
            lookOverride
          );
          stopBotMovement(bot, { vertical: false });
        } else {
          this.disableBotBrainInput(bot, now);
        }
        this.enqueueServerOwnedMovementCommands(bot, bot.lastInput ?? createEmptyBotInput(this.state.tick, bot, now), now);
        return;
      }

      this.botRuntime.scheduleForFrame(botId, this.isPriorityBot(bot, brain, now));
    });

    this.botRuntime.forEachScheduledFrameBot((botId) => {
      this.updateScheduledBot(botId, now, dt, frameContext);
    });
  }

  private isPriorityBot(bot: Player, brain: BotBrain, now: number): boolean {
    if (bot.hasFlag) return true;
    if (this.replicationState.getRecentCombatTransformUntil(bot.id) > now) return true;
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
    const brain = this.botRuntime.getBrain(botId);
    if (!bot?.isBot || !brain || bot.state !== 'alive') return;

    const skillOverride = this.getActiveDevBotSkillOverride(bot, now);
    const lookOverride = this.getActiveDevBotLookOverride(bot, now);
    const botInput = applyDevBotLookOverride(
      applyDevBotSkillOverride(
        this.createBotInput(bot, brain, now, dt, frameContext),
        bot.heroId,
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
      position: vec3SchemaToPlain(player.position),
      velocity: vec3SchemaToPlain(player.velocity),
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

    const flags = getBotFlagSnapshots(this.state);
    const teamTactics = this.refreshBotTeamTactics(now, snapshots, flags);
    const protectedEnemyIdsByTeam: Record<Team, Set<string>> = {
      red: new Set<string>(),
      blue: new Set<string>(),
    };
    this.state.players.forEach((player) => {
      if (!isTeam(player.team) || !this.isProtectedSpawnTarget(player, now)) return;
      const enemyTeam = getEnemyTeam(player.team);
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

  private refreshBotTeamTactics(
    now: number,
    snapshots = this.getBotPlayerSnapshots(),
    flags = getBotFlagSnapshots(this.state)
  ): BotTeamTacticsByTeam {
    return this.mapRuntime.refreshBotTeamTactics({
      now,
      gameplayMode: this.gameplayMode,
      players: snapshots,
      flags,
    });
  }

  private getBotRecentDamageSources(botId: string, now: number): BotRecentDamageSource[] {
    return this.damageRuntime.getBotRecentDamageSources(botId, now);
  }

  private getVisibleEnemyIdsForBot(bot: Player, frameContext: BotFrameContext): Set<string> {
    const cached = frameContext.visibleEnemyIdsByBot.get(bot.id);
    if (cached) return cached;
    const visible = new Set<string>();
    for (const snapshot of frameContext.snapshots) {
      if (snapshot.team === bot.team || snapshot.state !== 'alive') continue;
      const enemy = this.state.players.get(snapshot.id);
      if (!enemy) continue;
      const distance = distance3D(bot.position, enemy.position);
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
    const normalized = direction ? normalize2D(direction) : null;
    if (!normalized) return true;
    const start = vec3SchemaToPlain(bot.position);
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
    const forward = forward2D(bot.lookYaw);
    const toEnemy = direction2DFromTo(bot.position, enemy.lastKnownPosition);
    const toAlly = direction2DFromTo(bot.position, ally.position);
    if (!toEnemy || !toAlly) return false;
    const enemyInFront = forward.x * toEnemy.x + forward.z * toEnemy.z > 0.42;
    const allyBehind = forward.x * toAlly.x + forward.z * toAlly.z < -0.15;
    return enemyInFront && allyBehind && distance2D(bot.position, ally.position) <= 9;
  }

  private wouldBotWallBlockFriendlyCarrier(bot: Player, blackboard: BotBlackboard): boolean {
    const carrier = blackboard.alliedCarrier;
    if (!carrier) return false;
    const forward = forward2D(bot.lookYaw);
    const toCarrier = direction2DFromTo(bot.position, carrier.position);
    return Boolean(toCarrier && forward.x * toCarrier.x + forward.z * toCarrier.z > 0.35 && distance2D(bot.position, carrier.position) <= 7);
  }

  private getBotAbilityGeometry(
    bot: Player,
    blackboard: BotBlackboard,
    routePlan: BotRoutePlan,
    desiredMove: PlainVec2 | null,
    directPathBlocked: boolean
  ): BotAbilityGeometry {
    const forward = forward2D(bot.lookYaw);
    const blinkSafe = bot.heroId === 'phantom'
      ? this.isBotPathClear(bot, desiredMove ?? forward, 6.5)
      : true;
    const blinkDangerous = blackboard.visibleEnemies.filter((enemy) => enemy.distance <= 12).length >= 2;
    const grappleAnchorAvailable = bot.heroId === 'hookshot' && this.resolveHookshotGrappleTarget(bot) !== null;
    const objectiveZone = blackboard.droppedFriendlyFlag ?? blackboard.droppedEnemyFlag ?? routePlan.targetPosition;
    const groundHooksValuable = Boolean(
      blackboard.droppedFriendlyFlag ||
      blackboard.droppedEnemyFlag ||
      blackboard.visibleEnemies.some((enemy) => distance2D(enemy.lastKnownPosition, objectiveZone) <= 12)
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
    if (!botSnapshot) return createEmptyBotInput(this.state.tick, bot, now);

    const tactics = frameContext.teamTactics[botSnapshot.team];
    if (!tactics) return createEmptyBotInput(this.state.tick, bot, now);

    clearExpiredBlockedEdges(brain.blockedEdges, now);
    const { blackboard, routePlan } = updateBotPlanningState({
      brain,
      now,
      gameplayMode: this.gameplayMode,
      bot: botSnapshot,
      players: snapshots,
      flags: frameContext.flags,
      visibleEnemyIds: this.getVisibleEnemyIdsForBot(bot, frameContext),
      enemyLineOfSightIds: this.getEnemyLineOfSightIdsForBot(bot, frameContext),
      recentDamageSources: this.getBotRecentDamageSources(bot.id, now),
      teamTactics: tactics,
      routeGraph: this.mapRuntime.getBotRouteGraph(),
      skill,
    });
    const combatPlan = chooseBotCombatPlan({
      bot: botSnapshot,
      intent: brain.intent,
      blackboard,
      skill,
      primaryRange: this.getBotAttackRange(bot),
      protectedEnemyIds: frameContext.protectedEnemyIdsByTeam[botSnapshot.team],
    });
    const combatTarget = combatPlan.targetId ? this.state.players.get(combatPlan.targetId) ?? null : null;
    const combatTargetSnapshot = combatPlan.targetId
      ? frameContext.snapshotById.get(combatPlan.targetId) ?? null
      : null;
    brain.targetId = combatTarget?.id || '';

    const enemyDistance = combatTarget ? distance3D(bot.position, combatTarget.position) : Infinity;
    const aimPoint = combatTarget
      ? getBotPredictedAimPoint({
        sourcePosition: vec3SchemaToPlain(bot.position),
        targetPosition: this.getPlayerBodyAimPosition(combatTarget),
        targetVelocity: vec3SchemaToPlain(combatTarget.velocity),
        targetDistance: enemyDistance,
        skill,
      })
      : routePlan.steeringTarget || brain.intent.targetPosition || this.getEnemyFlagPosition(bot.team as Team);
    const desiredAim = getBotYawPitchTowardPosition(this.getPlayerEyePosition(bot), aimPoint);
    const aim = updateBotAimState({
      brain,
      skill,
      desiredAim,
      currentYaw: bot.lookYaw,
      currentPitch: bot.lookPitch,
      targetDistance: combatTarget ? enemyDistance : null,
      now,
      dt,
    });
    const attackRange = this.getBotAttackRange(bot);
    const primaryAimReady = Boolean(
      combatTarget
      && this.isBotAimReady(
        bot,
        combatTarget,
        getRoomAttackConfig({ heroId: bot.heroId as HeroId, mode: 'primary', chronosAscendantActive: false }),
        skill,
        aim.yaw,
        aim.pitch
      )
    );
    const { shouldFight, aimReady } = getBotCombatEngagementState({
      hasCombatTarget: Boolean(combatTarget),
      enemyDistance,
      attackRange,
      hasClearShot: combatTarget ? this.hasClearShot(bot, combatTarget) : false,
      targetProtected: combatTarget ? this.isProtectedSpawnTarget(combatTarget, now) : false,
      primaryAimReady,
    });
    const desiredMove = composeBotMovementDirection(
      botSnapshot,
      brain,
      brain.intent,
      routePlan,
      combatTargetSnapshot,
      blackboard,
      skill,
      combatPlan
    );
    const probes = this.getBotSteeringProbes(bot, desiredMove, skill);
    const steering = chooseLocalAvoidanceDirection(desiredMove, probes, skill);
    const recovery = updateBotMovementRecoveryState({
      brain,
      now,
      bot: botSnapshot,
      blackboard,
      routeGraph: this.mapRuntime.getBotRouteGraph(),
      routePlan,
      desiredMove,
      steeringBlocked: steering.blocked,
      skill,
    });

    const tempoMultiplier = this.getAbilityTempoMultiplier(bot, now);
    const input = createEmptyBotInput(this.state.tick, bot, now);
    input.lookYaw = aim.yaw;
    input.lookPitch = combatTarget ? aim.pitch : 0;
    Object.assign(input, composeBotInputMovementState({
      lookYaw: input.lookYaw,
      desiredMove: steering.direction,
      recovering: now < brain.reverseUntil,
      strafeDirection: brain.strafeDirection,
      botId: bot.id,
      position: bot.position,
      hasFlag: bot.hasFlag,
      isGrounded: bot.movement.isGrounded,
      previousCrouch: bot.lastInput?.crouch,
      intentType: brain.intent.type,
      steeringTarget: routePlan.steeringTarget,
      steeringJump: steering.jump,
      stalled: recovery.stalled,
      hasCombatTarget: Boolean(combatTarget),
      now,
    }));

    input.primaryFire = updateBotPrimaryFireDecision({
      brain,
      skill,
      now,
      aimReady,
      tempoMultiplier,
    });

    const secondaryAttack = isHeroId(bot.heroId)
      ? getRoomAttackConfig({ heroId: bot.heroId, mode: 'secondary', chronosAscendantActive: false })
      : null;
    const secondaryFireWindowOpen = isBotSecondaryFireWindowOpen({
      brain,
      now,
      shouldFight,
      heroId: bot.heroId as HeroId,
      secondaryAttack,
      enemyDistance,
    });
    const secondaryAimReady = Boolean(
      secondaryFireWindowOpen
      && combatTarget
      && secondaryAttack
      && this.isBotAimReady(bot, combatTarget, secondaryAttack, skill, aim.yaw, aim.pitch)
    );
    input.secondaryFire = updateBotSecondaryFireDecision({
      brain,
      skill,
      now,
      shouldFight,
      heroId: bot.heroId as HeroId,
      secondaryAttack,
      enemyDistance,
      aimReady: secondaryAimReady,
      tempoMultiplier,
    });

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
    applyBotAbilityInputPlan({
      input,
      brain,
      plan: abilityPlan,
      skill,
      now,
      tempoMultiplier,
    });

    if (dt <= 0) {
      input.moveForward = false;
      input.moveBackward = false;
      input.moveLeft = false;
      input.moveRight = false;
    }

    return input;
  }

  private getEnemyFlagPosition(team: Team): { x: number; y: number; z: number } {
    const enemyTeam = getEnemyTeam(team);
    return vec3SchemaToPlain(getFlagByTeam(this.state, enemyTeam).position);
  }

  private getBotAttackRange(bot: Player): number {
    const primaryAttack = isHeroId(bot.heroId)
      ? getRoomAttackConfig({ heroId: bot.heroId, mode: 'primary', chronosAscendantActive: false })
      : null;
    return primaryAttack?.range ?? 18;
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

  private isBotAimReady(
    bot: Player,
    target: Player,
    attack: AttackConfig | null | undefined,
    skill: BotSkillProfile,
    yaw: number,
    pitch: number
  ): boolean {
    if (!attack) return false;

    const trace = getBotAimReadinessTrace({
      origin: this.getPlayerEyePosition(bot),
      yaw,
      pitch,
      attackRange: attack.range,
      attackCollisionRadius: attack.collisionRadius,
      hitboxPadding: PLAYER_COMBAT_HITBOX_PADDING,
      skill,
    });
    return this.getAimHitAgainstPlayer(
      trace.origin,
      trace.direction,
      trace.range,
      target,
      trace.extraRadius
    ) !== null;
  }

  private hasClearShot(source: Player, target: Player): boolean {
    return this.hasLineOfSight(this.getPlayerEyePosition(source), this.getPlayerBodyAimPosition(target));
  }

  private hasLineOfSight(start: PlainVec3, end: PlainVec3): boolean {
    const now = this.state.serverTime || Date.now();
    return this.lineOfSightCache.hasLineOfSight(
      start,
      end,
      now,
      (samplePoint) => isCollisionBlock(this.getBlockAtWorld(samplePoint))
    );
  }

  private getPlayerEyePosition(player: Player): PlainVec3 {
    return getSharedPlayerEyePosition(player.position);
  }

  private getPlayerBodyAimPosition(player: Player): PlainVec3 {
    return getSharedPlayerBodyAimPosition({
      position: vec3SchemaToPlain(player.position),
      heroId: player.heroId,
    });
  }

  private isProtectedSpawnTarget(target: Player, now: number): boolean {
    return Boolean(target.spawnProtectionUntil && now < target.spawnProtectionUntil);
  }

  private resetPlayerLifeRuntime(player: Player, now = Date.now()): void {
    this.disablePlayerSkills(player);
    this.resetPlayerPressState(player.id);
    resetPlayerMovementRuntime(player);
    this.blazeBurns.clearTarget(player.id);
    this.blazeFlamethrowers.clearDamageTicksForPlayer(player.id);
    this.playerRoots.clear(player.id);
    this.powerupBoosts.clear(player.id);
    this.clearHookshotDragPullsInvolving(player.id);
    this.attackCooldowns.clearPlayer(player.id);
    this.playerCombatActivity.clear(player.id);
    player.lastInput = player.isBot
      ? createEmptyBotInput(this.state.tick, player, now)
      : null;
  }

  private getActiveDevBotSkillOverride(bot: Player, now: number): DevBotSkillOverride | null {
    const override = this.devRuntime.getBotSkillOverride(bot.id);
    if (!override) return null;
    if (now < override.expiresAt) return override;

    this.finishDevBotSkillOverride(bot, override, now);
    return null;
  }

  private finishDevBotSkillOverride(bot: Player, override: DevBotSkillOverride, now = Date.now()): void {
    this.devRuntime.clearBotSkillOverride(bot.id);

    if (
      bot.heroId === 'blaze' &&
      override.slot === 'secondary' &&
      this.playerPressStates.get(bot.id)?.secondaryFire
    ) {
      this.tryResolveAttack(bot, 'secondary', now);
    }

    this.resetPlayerPressState(bot.id);
  }

  private getActiveDevBotLookOverride(bot: Player, now: number): DevBotLookOverride | null {
    const override = this.devRuntime.getBotLookOverride(bot.id);
    if (!override) return null;
    if (now < override.expiresAt) return override;

    this.devRuntime.clearBotLookOverride(bot.id);
    return null;
  }

  private createDevBotSkillInput(bot: Player, now: number, override: DevBotSkillOverride | null): PlayerInput {
    return applyDevBotSkillOverride(createEmptyBotInput(this.state.tick, bot, now), bot.heroId, override);
  }

  private rootBotMovementAndSkills(bot: Player, now: number): void {
    bot.lastInput = createEmptyBotInput(this.state.tick, bot, now);
    stopBotMovement(bot, { vertical: true });
    this.disablePlayerSkills(bot);
    this.resetPlayerPressState(bot.id);
  }

  private disableBotBrainInput(bot: Player, now: number): void {
    bot.lastInput = createEmptyBotInput(this.state.tick, bot, now);
    stopBotMovement(bot, { vertical: false });
    this.disablePlayerSkills(bot);
    this.resetPlayerPressState(bot.id);
  }

  private resetPlayerPressState(playerId: string): void {
    this.playerPressStates.reset(playerId);
  }

  private handleHeroSelect(client: Client, heroId: HeroId) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const isSelectionPhase = this.state.phase === 'hero_select' || this.state.phase === 'waiting';
    const isActiveDevRoom = this.isDevelopmentMode()
      && (this.state.phase === 'countdown' || this.state.phase === 'playing' || this.state.phase === 'round_end');

    if (!isSelectionPhase && !isActiveDevRoom) return;

    const heroDef = HERO_DEFINITIONS[heroId];
    if (!heroDef) {
      if (this.isDevelopmentMode()) {
        client.send('devCommandError', { message: `Invalid hero: ${heroId}` });
      }
      return;
    }

    if (!this.isPlayerTeamHeroAvailable(player, heroId)) {
      const message = 'Hero is already picked on your team';
      client.send('error', { message });
      if (this.isDevelopmentMode()) {
        client.send('devCommandError', { message });
      }
      return;
    }

    this.setPlayerHero(player, heroId);

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
    if (!this.requireDevelopmentMode(client)) return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (HERO_DEFINITIONS[heroId] && !this.isPlayerTeamHeroAvailable(player, heroId)) {
      client.send('devCommandError', { message: 'Hero is already picked on your team' });
      return;
    }

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

  private getHeroLockPlayers(): RoomHeroLockParticipant[] {
    return getRoomHeroLockParticipants(this.state.players.values(), this.npcs.ids);
  }

  private isPlayerTeamHeroAvailable(player: Player, heroId: HeroId): boolean {
    return isRoomPlayerTeamHeroAvailable({
      players: this.getHeroLockPlayers(),
      team: player.team,
      heroId,
      playerId: player.id,
    });
  }

  private setPlayerHero(player: Player, heroId: HeroId): boolean {
    const heroDef = HERO_DEFINITIONS[heroId];
    if (!heroDef) return false;
    if (!this.isPlayerTeamHeroAvailable(player, heroId)) return false;

    player.heroId = heroId;
    player.maxHealth = heroDef.stats.maxHealth;
    player.health = player.maxHealth;
    player.ultimateCharge = 0;
    this.clearPrimaryHoldStates(player.id);
    this.chronosAegisShields.clear(player.id);
    this.devRuntime.clearPlayer(player.id);
    if (heroId === 'phantom') {
      this.resetPhantomPrimaryMagazine(player.id);
    } else {
      this.phantomPrimaryMagazines.clear(player.id);
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

  private selectRandomBotHero(team?: string, playerId?: string): HeroId {
    return selectAvailableRoomHero({
      players: this.getHeroLockPlayers(),
      team,
      playerId,
    });
  }

  private selectAvailableHeroForPlayer(player: Player): HeroId {
    return this.selectRandomBotHero(player.team, player.id);
  }

  private isDevelopmentMode(): boolean {
    return isDevelopmentToolsEnabled();
  }

  private requireDevelopmentMode(client: Client): boolean {
    if (this.isDevelopmentMode()) return true;

    client.send('devCommandError', { message: DEV_COMMANDS_DISABLED_MESSAGE });
    return false;
  }

  private handleSetDevImmune(client: Client, enabled: boolean): void {
    if (!this.isDevelopmentMode()) return;

    this.devRuntime.setPlayerImmune(client.sessionId, enabled);
  }

  private handleDevFillUltimate(client: Client): void {
    if (!this.requireDevelopmentMode(client)) return;

    const player = this.state.players.get(client.sessionId);
    if (!player || !player.heroId) {
      client.send('devCommandError', { message: 'No active hero to charge' });
      return;
    }

    player.ultimateCharge = 100;
  }

  private handleDevEndGame(client: Client): void {
    if (!this.requireDevelopmentMode(client)) return;

    const player = this.state.players.get(client.sessionId);
    if (!player) {
      client.send('devCommandError', { message: 'No active player to end the match' });
      return;
    }

    this.endGame(client.sessionId);
  }

  private handleDevSetObserver(client: Client): void {
    if (!this.requireDevelopmentMode(client)) return;

    if (this.matchMode !== 'custom') {
      client.send('devCommandError', { message: 'Observer command is only available in custom games' });
      return;
    }

    if (this.clientRegistry.isObserver(client.sessionId)) {
      client.send('observerModeStarted', { playerId: client.sessionId });
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player || player.isBot) {
      client.send('devCommandError', { message: 'No active player to observe from' });
      return;
    }

    void this.removeVoiceParticipantForPlayer(client.sessionId, normalizeVoiceTeam(player.team), 'observe');

    if (player.hasFlag) {
      this.dropFlag(player);
    }
    this.markMatchParticipantLeft(player);

    this.state.players.delete(client.sessionId);
    this.clearCombatPlayerRuntimeState(client.sessionId);
    this.clearPlayerReplicationState(client.sessionId);
    this.clientRegistry.addObserver(client.sessionId, client);
    this.playerPings.markDirty();

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
    if (!this.requireDevelopmentMode(client)) return;

    const now = Date.now();
    const patch = buildDevTimeFreezeStatePatch({
      enabled,
      roundStartTime: this.state.roundStartTime,
      roundTimeRemaining: this.state.roundTimeRemaining,
      roundTimeSeconds: this.config.roundTimeSeconds,
      now,
    });

    this.devRuntime.setGameClockFrozen(patch.gameClockFrozen);
    if (patch.roundTimeRemaining !== undefined) {
      this.state.roundTimeRemaining = patch.roundTimeRemaining;
    }
    if (patch.roundStartTime !== undefined) {
      this.state.roundStartTime = patch.roundStartTime;
    }
    if (patch.phaseEndTime !== undefined) {
      this.state.phaseEndTime = patch.phaseEndTime;
    }

    this.broadcastMatchSnapshot(true);
  }

  private handleSetDevBotsRooted(client: Client, enabled: boolean): void {
    if (!this.requireDevelopmentMode(client)) return;

    this.devRuntime.setBotsRooted(enabled);

    if (enabled) {
      const now = Date.now();
      this.state.players.forEach((player) => {
        if (player.isBot) {
          this.rootBotMovementAndSkills(player, now);
        }
      });
    } else {
      this.botRuntime.resetBrainSchedules();
    }

    client.send('devBotsRootedChanged', { enabled });
    this.broadcastStateStreams({ transforms: true, forceVitals: true });
  }

  private handleSetDevBotBrainEnabled(client: Client, enabled: boolean): void {
    if (!this.requireDevelopmentMode(client)) return;

    this.devRuntime.setBotBrainEnabled(enabled);

    if (enabled) {
      this.botRuntime.resetBrainSchedules();
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
    if (!this.requireDevelopmentMode(client)) return;

    const { heroId, team } = data;
    const request = validateDevBotAddRequest({
      heroId,
      team,
      playerCount: this.state.players.size,
      maxPlayers: this.config.maxPlayers,
      heroAvailable: Boolean(
        heroId &&
        team &&
        isRoomPlayerTeamHeroAvailable({
          players: this.getHeroLockPlayers(),
          team,
          heroId,
        })
      ),
    });
    if (!request.ok) {
      client.send('devCommandError', { message: request.error });
      return;
    }

    const botIndex = this.botRuntime.createDevBotIndex();
    const now = Date.now();
    const profile = buildDevBotSpawnProfile({
      roomId: this.roomId,
      heroId: request.heroId,
      heroName: request.heroName,
      team: request.team,
      botIndex,
      phase: this.state.phase,
    });
    const bot = new Player();
    bot.id = profile.id;
    bot.name = profile.name;
    bot.team = profile.team;
    bot.isBot = profile.isBot;
    bot.botDifficulty = profile.botDifficulty;
    bot.botProfileId = profile.botProfileId;
    bot.isReady = profile.isReady;
    bot.state = profile.state;

    this.placePlayerAtSpawn(bot);
    if (!this.setPlayerHero(bot, request.heroId)) {
      client.send('devCommandError', { message: 'Hero is already picked on that team' });
      return;
    }
    if (this.state.phase === 'playing') {
      bot.spawnProtectionUntil = now + this.config.spawnProtectionSeconds * 1000;
      resetAbilityCooldowns(bot);
    }

    this.state.players.set(bot.id, bot);
    this.replicationState.markKnownPlayer(bot.id);
    this.updateLastSafeMovement(bot, 0);
    this.botRuntime.setPreferredHero(bot.id, request.heroId);
    this.initializePressState(bot.id);
    this.botRuntime.setBrain(bot.id, this.createBotBrain(bot, botIndex));
    if (this.devRuntime.areBotsRooted()) {
      this.rootBotMovementAndSkills(bot, now);
    } else if (!this.devRuntime.isBotBrainEnabled()) {
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
      heroId: request.heroId,
      team: request.team,
    });

    this.broadcastStateStreams({ transforms: true, forceVitals: true, forceMatch: true });
    this.checkPhaseTransition();
  }

  private handleDevBotSkill(client: Client, data: { heroId: HeroId; team: Team; skillKey: string }): void {
    if (!this.requireDevelopmentMode(client)) return;

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
    this.devRuntime.setBotSkillOverride(bot.id, {
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
    if (!this.requireDevelopmentMode(client)) return;

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
      ...(bot.lastInput ?? createEmptyBotInput(this.state.tick, bot, now)),
      lookPitch: pitch,
      timestamp: now,
    };
    const brain = this.botRuntime.getBrain(bot.id);
    if (brain) {
      brain.aimPitch = pitch;
    }
    this.devRuntime.setBotLookOverride(bot.id, {
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
      if (this.npcs.has(player.id)) return;
      if (player.state === 'alive') {
        fallback = player;
      }
    });
    return fallback;
  }

  private primeDevBotSkill(player: Player, slot: DevBotSkillSlot): void {
    this.attackCooldowns.clearPlayer(player.id);
    this.clearPrimaryHoldStates(player.id);
    this.phantomVoidRayCharges.clear(player.id);

    if (player.heroId === 'phantom' && slot === 'primary') {
      this.phantomPrimaryMagazines.reset(player.id);
    }
    if (player.heroId === 'blaze') {
      player.movement.jetpackFuel = BLAZE_FLAMETHROWER_MAX_FUEL;
    }
    if (player.heroId === 'chronos' && slot === 'secondary') {
      this.chronosAegisShields.clear(player.id);
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

  private refreshMapManifest(): void {
    const mapManifest = this.mapRuntime.refreshMap();
    this.state.mapThemeId = mapManifest.themeId;
    this.state.mapSize = mapManifest.mapSize;
    this.powerupBoosts.clearAll();
    this.powerupPickups.reset(mapManifest, 0);
    this.hookshotRuntime.clearAnchorWalls();
    this.lineOfSightCache.clear();
    this.visibilityInterest.clearAll();
    this.forceTransformFullSync();
  }

  private bumpMovementCollisionRevision(): void {
    this.mapRuntime.bumpMovementCollisionRevision();
    this.lineOfSightCache.clear();
    this.visibilityInterest.clearLineOfSightCache();
    this.forceTransformFullSync();
  }

  private pruneExpiredHookshotAnchorWalls(now = Date.now()): void {
    if (this.hookshotRuntime.pruneExpiredAnchorWalls(now)) {
      this.bumpMovementCollisionRevision();
    }
  }

  private getMovementCollisionRevision(now = Date.now()): number {
    this.pruneExpiredHookshotAnchorWalls(now);
    return this.mapRuntime.getMovementCollisionRevision();
  }

  private getMovementCollisionWorld(now = Date.now()): MovementCollisionWorld {
    this.getMovementCollisionRevision(now);
    return this.mapRuntime.getMovementCollisionWorld();
  }

  private createHookshotAnchorWall(instance: HookshotAnchorWallInstance): void {
    this.hookshotRuntime.addAnchorWall(instance);
    this.bumpMovementCollisionRevision();
  }

  private getMapManifest(): VoxelMapManifest {
    return this.mapRuntime.getMapManifest();
  }

  private getBlockAtWorld(position: { x: number; y: number; z: number }): number {
    return this.mapRuntime.getBlockAtWorld(position);
  }

  private getProceduralGroundY(position: { x: number; y: number; z: number }): number | null {
    return this.mapRuntime.getProceduralGroundY(position);
  }

  private clampToPlayableMap(position: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    return this.mapRuntime.clampToPlayableMap(position);
  }

  private isFiniteVec3(position: { x: number; y: number; z: number }): boolean {
    return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
  }

  private disablePlayerSkills(player: Player) {
    player.abilities.forEach(ability => {
      ability.isActive = false;
    });
    this.broadcastBlazeFlamethrowerState(player, false, Date.now());
    this.clearPrimaryHoldStates(player.id);
    this.phantomVoidRayCharges.clear(player.id);
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
    if (this.participantRegistry.hasEntryTicket(client.sessionId)) {
      return;
    }

    const teamSelection = getRoomTeamSelectionDecision({
      players: this.state.players,
      playerId: client.sessionId,
      requestedTeam: team,
      teamSize: this.config.teamSize,
    });
    if (!teamSelection.canSelect) return;

    const previousTeam = normalizeVoiceTeam(player.team);
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
    const player = this.state.players.get(client.sessionId);
    const prepared = prepareMatchVoiceTokenRequest({
      payload: data,
      player,
      identity: this.getDurableUserId(client.sessionId),
    });
    if (!prepared.ok) {
      client.send('voiceToken', voiceService.createDisabledResponse(prepared.requestId, prepared.reason));
      return;
    }

    const response = await voiceService.issueMatchVoiceToken({
      requestId: prepared.requestId,
      playerId: client.sessionId,
      identity: prepared.identity,
      displayName: prepared.displayName,
      team: prepared.team,
      lobbyId: this.lobbyId,
      gameRoomId: this.roomId,
      human: prepared.human,
      canPublish: prepared.canPublish,
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
    if (this.state.phase !== 'hero_select' || !this.matchStartGate.isOpen()) return;

    if (!this.matchStartGate.canAcceptSceneReadyKey(readMatchSceneReadyGateKey(data))) return;

    const player = this.state.players.get(client.sessionId);
    if (!canMarkMatchSceneReady(player)) return;

    this.matchStartGate.markSceneReady(client.sessionId);
    this.checkPhaseTransition();
  }

  private handleChat(client: Client, message: string, teamOnly: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const payload = buildRoomChatPayload({
      playerId: client.sessionId,
      playerName: player.name,
      message,
      teamOnly,
      timestamp: Date.now(),
    });
    if (!payload) return;

    if (!teamOnly) {
      this.broadcast('chat', payload);
      return;
    }

    for (const sessionId of getRoomChatRecipientIds({
      players: this.state.players,
      senderTeam: player.team,
      teamOnly,
    })) {
      this.clientRegistry.getClient(sessionId)?.send('chat', payload);
    }
  }

  private checkPhaseTransition() {
    if (this.matchCancelled) return;

    switch (this.state.phase) {
      case 'waiting':
        if (shouldStartHeroSelectPhase({
          playerCount: this.state.players.size,
          hasRequiredHumanPlayersConnected: this.hasRequiredHumanPlayersConnected(),
        })) {
          this.startHeroSelect();
        }
        break;

      case 'hero_select':
        if (shouldAutoReadyHeroSelectPhase({
          phaseEndTime: this.state.phaseEndTime,
          now: Date.now(),
        })) {
          this.state.players.forEach(p => {
            if (!p.heroId) {
              this.setPlayerHero(p, this.selectAvailableHeroForPlayer(p));
            }
            p.isReady = true;
          });
        }

        const playersReadyForCountdown = this.areAllPlayersReadyForCountdown();
        if (!playersReadyForCountdown) return;

        if (shouldOpenCountdownStartGate({
          playersReadyForCountdown,
          countdownStartGateOpen: this.matchStartGate.isOpen(),
        })) {
          loggers.room.info('all players ready, waiting for clients to load into spawn');
          this.openCountdownStartGate();
        }

        if (shouldStartCountdownAfterSceneReady({
          playersReadyForCountdown,
          humansSceneReadyForCountdown: this.areAllHumansSceneReadyForCountdown(),
        })) {
          if (!this.ensureCompetitiveNetworkQualityForStart()) return;
          loggers.room.info('all players loaded into spawn, starting countdown');
          this.startCountdown();
        }
        break;
    }
  }

  private resetCountdownStartGate(): void {
    this.matchStartGate.reset();
  }

  private applyPhaseStatePatch(patch: RoomPhaseStatePatch): void {
    this.state.phase = patch.phase;
    this.state.phaseEndTime = patch.phaseEndTime;
    if (patch.roundStartTime !== undefined) {
      this.state.roundStartTime = patch.roundStartTime;
    }
    if (patch.roundTimeRemaining !== undefined) {
      this.state.roundTimeRemaining = patch.roundTimeRemaining;
    }
  }

  private applyPostGameResetStatePatch(patch: PostGameResetStatePatch): void {
    this.state.phase = patch.phase;
    this.state.mapSeed = patch.mapSeed;
    this.state.mapThemeId = patch.mapThemeId;
    this.state.mapSize = patch.mapSize;
    this.state.redTeam.score = patch.redScore;
    this.state.blueTeam.score = patch.blueScore;
  }

  private getConnectedHumanPlayerCount(): number {
    return countConnectedHumanPlayers(this.state.players.values());
  }

  private hasRequiredHumanPlayersConnected(): boolean {
    return hasRequiredHumanPlayersConnectedState(
      this.state.players.values(),
      this.requiredHumanPlayers
    );
  }

  private areAllPlayersReadyForCountdown(): boolean {
    const ready = arePlayersReadyForCountdownState({
      players: this.state.players.values(),
      requiredHumanPlayers: this.requiredHumanPlayers,
    });

    if (!ready) {
      this.resetCountdownStartGate();
    }
    return ready;
  }

  private areAllHumansSceneReadyForCountdown(): boolean {
    return this.matchStartGate.areHumansSceneReady({
      players: this.state.players,
      connectedClientIds: this.clientRegistry.getConnectedClientIds(),
      requiredHumanPlayers: this.requiredHumanPlayers,
    });
  }

  private openCountdownStartGate(): void {
    if (!this.matchStartGate.openGate()) return;

    const now = Date.now();
    this.state.players.forEach((player) => {
      player.state = 'spawning';
    });
    this.placeTeamsAtUniqueSpawns('spawn');

    this.forceTransformFullSync();
    this.broadcastStateStreams({ transforms: true, forceTransforms: true, forceVitals: true, forceMatch: true });

    this.state.players.forEach((player, playerId) => {
      if (player.isBot) return;

      const client = this.clientRegistry.getClient(playerId);
      if (!client) return;

      const authority = this.getMovementAuthority(player.id);
      this.sendSelfMovementAuthority(player, client, 'spawn');
      this.sendTracked(client, 'matchStartGate', buildMatchStartGatePayload({
        key: this.matchStartGate.key,
        serverTime: now,
        mapSeed: this.state.mapSeed,
        mapThemeId: this.state.mapThemeId,
        mapSize: this.state.mapSize as VoxelMapSizeId,
        position: vec3SchemaToPlain(player.position),
        movementEpoch: authority.movementEpoch,
        ackSeq: authority.lastProcessedSeq,
        collisionRevision: this.getMovementCollisionRevision(now),
      }));
    });
  }

  private startHeroSelect() {
    if (this.matchCancelled) return;

    this.applyPhaseStatePatch(buildHeroSelectPhaseStatePatch({
      now: Date.now(),
      durationSeconds: this.config.heroSelectTimeSeconds,
    }));
    this.resetCountdownStartGate();
    this.updateMetadata();

    this.state.players.forEach(player => {
      if (player.isBot) {
        player.state = 'selecting';
        player.isReady = false;
        const preferredHero = this.botRuntime.getPreferredHero(player.id);
        if (!preferredHero || !this.setPlayerHero(player, preferredHero)) {
          player.heroId = '';
          player.abilities.clear();
          this.disablePlayerSkills(player);
        }
      }
    });

    this.broadcastPhaseChange('hero_select');
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
    this.applyPhaseStatePatch(buildCountdownPhaseStatePatch({
      now: Date.now(),
      durationSeconds: this.config.countdownSeconds,
    }));
    this.updateMetadata();

    this.state.players.forEach(player => {
      player.state = 'spawning';
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.velocity.z = 0;
    });

    this.broadcastPhaseChange('countdown');
    this.forceTransformFullSync();
    this.broadcastStateStreams({ transforms: true, forceTransforms: true, forceVitals: true, forceMatch: true });
  }

  private startPlaying() {
    if (this.matchCancelled) return;
    if (!this.ensureCompetitiveNetworkQualityForStart({ cancelPending: true })) return;

    this.clearMatchStartCancelTimer();
    const now = Date.now();
    this.applyPhaseStatePatch(buildPlayingPhaseStatePatch({
      now,
      roundTimeSeconds: this.config.roundTimeSeconds,
    }));
    this.updateMetadata();
    const ledger = this.ensureMatchPersistenceLedger(this.state.roundStartTime);
    this.matchFinalization.attachWagerMatchId({
      roomId: this.roomId,
      lobbyId: this.lobbyId,
      wagerContext: this.wagerContext,
      matchId: ledger.matchId,
    });

    this.blazeBurns.clearAll();

    this.state.players.forEach(player => {
      const resetPlan = applyPlayerAliveRuntimeReset(player, {
        now,
        spawnProtectionMs: this.config.spawnProtectionSeconds * 1000,
      });
      this.resetPlayerLifeRuntime(player, now);
      if (resetPlan.resetPhantomPrimaryMagazine) {
        this.resetPhantomPrimaryMagazine(player.id);
      }
      if (resetPlan.clearChronosAegisShield) {
        this.chronosAegisShields.clear(player.id);
      }
      if (resetPlan.resetBotBrain) {
        this.botRuntime.setBrain(player.id, this.createBotBrain(player, hashString(player.id)));
      }

      if (resetPlan.resetAbilityCooldowns) {
        resetAbilityCooldowns(player);
      }
      if (ledger.state === 'active') {
        this.registerMatchParticipant(player, this.state.roundStartTime);
      }
    });

    // Reset flags
    const mapManifest = this.getMapManifest();
    resetFlagsFromManifest(this.state, mapManifest);
    this.powerupBoosts.clearAll();
    this.powerupPickups.reset(mapManifest, 0);

    this.broadcastPhaseChange('playing');
    this.broadcastTracked('powerupState', this.powerupPickups.buildStateMessage(
      this.state.serverTime || Date.now(),
      mapManifest
    ));
    this.forceTransformFullSync();
    this.broadcastStateStreams({ transforms: true, forceTransforms: true, forceVitals: true, forceMatch: true });
  }

  private endRound() {
    this.applyPhaseStatePatch(buildRoundEndPhaseStatePatch({ now: Date.now() }));
    this.updateMetadata();

    this.broadcastTracked('roundEnd', buildRoundEndPayload({
      gameplayMode: this.gameplayMode,
      redScore: this.state.redTeam.score,
      blueScore: this.state.blueTeam.score,
      scoreToWin: this.config.scoreToWin,
    }));
    this.broadcastStateStreams({ transforms: false, forceVitals: true, forceMatch: true });
  }

  private endGame(forcedByPlayerId?: string) {
    if (this.state.phase === 'game_end') return;

    this.applyPhaseStatePatch(buildGameEndPhaseStatePatch());
    this.updateMetadata();

    const winningTeam = getWinningTeam(this.state.redTeam.score, this.state.blueTeam.score);
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

    this.roomTimeouts.schedule(() => this.resetAfterGame(), POST_GAME_RESET_DELAY_MS);
  }

  private resetAfterGame(): void {
    this.applyPostGameResetStatePatch(buildPostGameResetStatePatch(createRandomSeed()));
    this.refreshMapManifest();
    resetFlagsFromManifest(this.state, this.getMapManifest());

    this.state.players.forEach(resetPostGamePlayer);
    this.matchLedger.clear();
    this.updateMetadata();
  }

  private updateVoidZones(now: number) {
    this.voidZones.update(now, {
      onExpired: (zone) => {
        this.broadcastTracked('voidZoneExpired', { id: zone.id });
      },
      getTargets: (zone) => this.playerSpatialQueries.queryRadius(
        zone.position,
        zone.radius,
        { team: zone.ownerTeam === 'red' ? 'blue' : 'red', excludeId: zone.ownerId }
      ),
      applyDamage: (zone, player) => {
        this.applyDamage(player, zone.damage, zone.ownerId, 'void_zone', {
          abilityId: 'phantom_void_zone',
          sourcePosition: zone.position,
        });
      },
    });
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
    if (!this.blazeFlamethrowers.setActive(player.id, active)) return;

    const pose = this.getBlazeFlamethrowerPose(player);
    this.broadcastExactPlayerEvent('abilityUsed', player, {
      playerId: player.id,
      abilityId: 'blaze_flamethrower',
      castId: `blaze_flamethrower_${player.id}_${active ? 'start' : 'stop'}_${now}`,
      position: vec3SchemaToPlain(player.position),
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
    this.blazeBurns.ignite(target.id, source.id, now, sourcePosition, sourceDirection);
  }

  private updateBlazeBurns(now: number): void {
    this.blazeBurns.update(now, {
      isTargetAlive: (targetId) => this.state.players.get(targetId)?.state === 'alive',
      hasSource: (sourceId) => this.state.players.has(sourceId),
      applyTick: ({ targetId, sourceId, sourcePosition, sourceDirection }) => {
        const target = this.state.players.get(targetId);
        if (!target || target.state !== 'alive') return false;
        const killed = this.applyDamage(
          target,
          BLAZE_FLAMETHROWER_BURN_DAMAGE,
          sourceId,
          'burn',
          {
            abilityId: 'blaze_flamethrower',
            sourcePosition,
            sourceDirection,
          }
        );
        return killed;
      },
    });
  }

  private updateBlazeFlamethrowers(now: number, dt: number) {
    this.blazeFlamethrowers.beginActiveFrame();

    for (const player of this.playerSpatialIndex.getAlivePlayers()) {
      if (player.heroId !== 'blaze') continue;
      this.blazeFlamethrowers.markActiveThisFrame(player.id);

      const tempoMultiplier = this.getAbilityTempoMultiplier(player, now);
      const frameState = resolveBlazeFlamethrowerFrameState({
        isFiring: Boolean(player.lastInput?.ability1),
        fuel: player.movement.jetpackFuel,
        dt,
        tempoMultiplier,
      });
      player.movement.isJetpacking = frameState.isJetpacking;
      player.movement.jetpackFuel = frameState.fuel;

      if (frameState.shouldApplyDamage) {
        this.applyFlamethrowerDamage(player, now, tempoMultiplier);
      }
      this.broadcastBlazeFlamethrowerState(player, frameState.active, now);
    }

    for (const playerId of this.blazeFlamethrowers.getActivePlayerIdsMissingFromFrame()) {
      const player = this.state.players.get(playerId);
      if (!player) {
        this.blazeFlamethrowers.setActive(playerId, false);
        continue;
      }

      player.movement.isJetpacking = false;
      this.broadcastBlazeFlamethrowerState(player, false, now);
    }
  }

  private applyFlamethrowerDamage(source: Player, now: number, tempoMultiplier: number) {
    const { origin, direction: forward } = this.getBlazeFlamethrowerPose(source);
    const terrainHit = this.raycastTerrain(origin, forward, BLAZE_FLAMETHROWER_RANGE);
    const damageFrame = resolveBlazeFlamethrowerDamageFrame({
      origin,
      terrainHit,
      range: BLAZE_FLAMETHROWER_RANGE,
      collisionRadius: BLAZE_FLAMETHROWER_COLLISION_RADIUS,
      playerRadius: PLAYER_RADIUS,
      hitboxPadding: PLAYER_COMBAT_HITBOX_PADDING,
      baseDamageIntervalMs: BLAZE_FLAMETHROWER_DAMAGE_INTERVAL,
      tempoMultiplier,
    });
    const flameDistance = damageFrame.flameDistance;
    const initialAegisHit = this.getChronosAegisSkillHit(source, origin, forward, flameDistance, {
      projectileRadius: BLAZE_FLAMETHROWER_COLLISION_RADIUS,
    });

    const candidates = this.playerSpatialQueries.queryConeCandidates(
      origin,
      damageFrame.candidateRange,
      { team: source.team === 'red' ? 'blue' : 'red', excludeId: source.id }
    );

    const hitCandidates: Array<{
      player: Player;
      distance: number;
      aegisHit: ChronosAegisSkillHit | null;
    }> = [];
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
      hitCandidates.push({
        player: target,
        distance,
        aegisHit: targetAegisHit,
      });
    }

    const damagePlan = resolveBlazeFlamethrowerDamageTargets({
      initialAegisHit,
      candidates: hitCandidates,
    });

    for (const { player: target, distance } of damagePlan.playerHits) {
      if (!this.blazeFlamethrowers.consumeDamageTick(
        source.id,
        { kind: 'player', playerId: target.id },
        now,
        damageFrame.damageIntervalMs
      )) {
        continue;
      }

      const damage = calculateFalloffDamage(BLAZE_FLAMETHROWER_DAMAGE, distance, BLAZE_FLAMETHROWER_RANGE, 0.35);
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

    if (damagePlan.aegisHit) {
      if (this.blazeFlamethrowers.consumeDamageTick(
        source.id,
        { kind: 'aegis', playerId: damagePlan.aegisHit.blocker.id },
        now,
        damageFrame.damageIntervalMs
      )) {
        const damage = calculateFalloffDamage(
          BLAZE_FLAMETHROWER_DAMAGE,
          damagePlan.aegisHit.distance,
          BLAZE_FLAMETHROWER_RANGE,
          0.35
        );
        this.absorbDamageWithChronosAegis(damagePlan.aegisHit.blocker, damage, now, {
          source,
          damageType: 'flamethrower',
          position: damagePlan.aegisHit.point,
          direction: damagePlan.aegisHit.normal,
        });
      }
    }
  }

  private scoreTeamDeathmatchKill(killer: Player, victim: Player): void {
    if (!isTeamDeathmatchMode(this.gameplayMode)) return;
    if (!isTeam(killer.team) || !isTeam(victim.team) || killer.team === victim.team) return;
    if (this.npcs.has(killer.id) || this.npcs.has(victim.id)) return;

    if (killer.team === 'red') {
      this.state.redTeam.score++;
    } else {
      this.state.blueTeam.score++;
    }

    if (hasTeamReachedScoreLimit(this.state.redTeam.score, this.state.blueTeam.score, this.config.scoreToWin)) {
      this.endRound();
    }
  }

  private createVoidZone(position: { x: number; y: number; z: number }, ownerId: string, ownerTeam: 'red' | 'blue') {
    const zone = this.voidZones.add({
      id: this.abilityIds.nextVoidZoneId(),
      position: { ...position },
      radius: VOID_ZONE_RADIUS,
      damage: VOID_ZONE_DAMAGE,
      duration: VOID_ZONE_DURATION,
      startTime: Date.now(),
      ownerId,
      ownerTeam,
    });

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

  private checkFlagReturns(now: number): void {
    for (const team of CTF_TEAMS) {
      const flag = getFlagByTeam(this.state, team);
      if (!flag.isAtBase && !flag.carrierId && flag.droppedAt) {
        if (now - flag.droppedAt >= this.config.flagReturnTimeSeconds * 1000) {
          this.returnFlagToBase(team);
        }
      }
    }
  }

  private dropFlag(player: Player) {
    if (!player.hasFlag) return;
    if (!isTeam(player.team)) return;

    const now = Date.now();
    const droppedTeam = getEnemyTeam(player.team);
    const flag = getFlagByTeam(this.state, droppedTeam);
    setFlagDroppedAtPlayer(flag, player, now);

    player.hasFlag = false;
    this.recordObjectiveEvent(player, 'drop', droppedTeam, now);

    this.broadcastTracked('flagDrop', {
      team: droppedTeam,
      playerId: player.id,
      position: vec3SchemaToPlain(flag.position),
    });
  }

  private respawnPlayer(player: Player) {
    const now = Date.now();
    const resetPlan = applyPlayerAliveRuntimeReset(player, {
      now,
      spawnProtectionMs: this.config.spawnProtectionSeconds * 1000,
      resetRespawnTime: true,
    });
    this.resetPlayerLifeRuntime(player, now);

    this.placePlayerAtSpawn(player, 'respawn');
    if (resetPlan.resetPhantomPrimaryMagazine) {
      this.resetPhantomPrimaryMagazine(player.id);
    }
    if (resetPlan.clearChronosAegisShield) {
      this.chronosAegisShields.clear(player.id);
    }
    if (resetPlan.resetBotBrain) {
      this.botRuntime.setBrain(player.id, this.createBotBrain(player, hashString(player.id)));
    }

    if (resetPlan.resetAbilityCooldowns) {
      resetAbilityCooldowns(player);
    }
  }

  private updatePhysics() {
    const tickTime = this.state.serverTime || Date.now();

    this.state.players.forEach(player => {
      if (player.state !== 'alive') return;

      if (
        this.devRuntime.areBotsRooted() &&
        player.isBot &&
        !this.getActiveDevBotSkillOverride(player, tickTime) &&
        !this.getActiveDevBotLookOverride(player, tickTime)
      ) {
        this.rootBotMovementAndSkills(player, tickTime);
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

        const client = this.clientRegistry.getClient(player.id);
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
        const command = this.movementAuthorities.getNextMovementCommand(authority);
        if (!command) break;
        const input = this.movementCommandToInput(command, stepNow);
        const movementInput = this.getRootedMovementInput(player, input, stepNow);
        player.lastInput = movementInput;
        player.lookYaw = movementInput.lookYaw;
        player.lookPitch = movementInput.lookPitch;
        const dragPullActive = this.hookshotRuntime.hasDragPull(player.id);
        if (dragPullActive) {
          this.clearHookshotGrapple(player.id);
        } else {
          this.prepareHookshotGrappleForMovement(player, stepNow);
        }
        const simulationInput = dragPullActive
          ? suppressLocomotionInput(movementInput)
          : movementInput;
        this.simulateAuthoritativeMovementStep(player, simulationInput, MOVEMENT_SUBSTEP_SECONDS, stepNow);
        if (!dragPullActive) {
          this.stepHookshotGrappleAuthority(player, simulationInput, MOVEMENT_SUBSTEP_SECONDS, stepNow);
        }
        this.stepHookshotDragPullAuthority(player, MOVEMENT_SUBSTEP_SECONDS, stepNow);
        this.processPlayerInput(player, movementInput, stepNow);
        this.updateLastSafeMovement(player, movementInput.tick, stepNow);
        authority.metrics.commandsProcessed++;
        processedThisTick++;
        if (authority.movementEpoch !== epochBeforeStep) break;
      }

      authority.metrics.queueLength = authority.pendingCommands.length;
      authority.metrics.queueLengthAfterTick = authority.pendingCommands.length;
      authority.metrics.commandsProcessedLastTick = processedThisTick;
      authority.metrics.lastAckSeq = authority.lastProcessedSeq;
      const stale = processedThisTick > 0
        ? getMovementBacklogTrimCount(authority.pendingCommands.length)
        : 0;
      if (stale > 0) {
        this.movementAuthorities.removeOldestPendingCommands(authority, stale);
        authority.metrics.droppedCommands += stale;
        this.markMovementBarrier(player.id, 'epoch_mismatch');
      }

      if (player.position.y < -10) {
        this.placePlayerAtSpawn(player, 'respawn');
      }

      const client = this.clientRegistry.getClient(player.id);
      if (client && (processedThisTick > 0 || authority.correctionReason)) {
        this.sendSelfMovementAuthority(player, client, authority.correctionReason);
      }
    });
  }

  private assignPlayerSpawnPosition(player: Player, spawn?: TeamSpawnPosition): void {
    const placement = resolveTeamSpawnPlacement({
      manifest: this.getMapManifest(),
      team: player.team,
      spawn,
    });
    player.position.x = placement.position.x;
    player.position.y = placement.position.y;
    player.position.z = placement.position.z;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    player.lookYaw = placement.lookYaw;
    player.lookPitch = placement.lookPitch;
  }

  private placePlayerAtSpawn(player: Player, reason: MovementCorrectionReason = 'spawn'): void {
    this.assignPlayerSpawnPosition(player);
    this.markMovementBarrier(player.id, reason);
  }

  private placeTeamsAtUniqueSpawns(reason: MovementCorrectionReason = 'spawn'): void {
    const { spawnPointsByTeam, assignments } = createTeamSpawnPlan({
      manifest: this.getMapManifest(),
      players: this.state.players,
    });

    for (const assignment of assignments) {
      const player = this.state.players.get(assignment.playerId);
      if (!player) continue;
      this.assignPlayerSpawnPosition(player, resolveTeamSpawnAssignmentPosition({
        spawnPointsByTeam,
        assignment,
      }));
      this.markMovementBarrier(player.id, reason);
    }
  }

  // ===== NPC/BOT HANDLING =====
  
  private handleSpawnNpc(client: Client, data: { heroId: HeroId; team?: Team; position?: { x: number; y: number; z: number }; name?: string }) {
    const { heroId, position, name } = data;
    
    // Validate hero
    const heroDef = HERO_DEFINITIONS[heroId];
    if (!heroDef) {
      client.send('npcError', buildNpcErrorPayload(`Invalid hero: ${heroId}`));
      return;
    }

    const requestingPlayer = this.state.players.get(client.sessionId) ?? null;
    const team = resolveNpcSpawnTeam(data.team, requestingPlayer?.team);
    const spawnPosition = resolveNpcSpawnPosition({
      requestedPosition: position,
      requester: requestingPlayer
        ? {
          team: requestingPlayer.team,
          position: vec3SchemaToPlain(requestingPlayer.position),
          lookYaw: requestingPlayer.lookYaw,
        }
        : null,
    });

    const { id: npcId, name: npcName } = this.npcs.createIdentity(heroDef.name, name);

    // Create NPC player entity
    const npc = new Player();
    npc.id = npcId;
    npc.name = npcName;
    npc.team = team;
    npc.heroId = heroId;
    npc.state = 'alive';
    npc.isReady = true;
    
    npc.position.x = spawnPosition.x;
    npc.position.y = spawnPosition.y;
    npc.position.z = spawnPosition.z;
    
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
    this.npcs.add(npcId);
    this.updateMetadata();

    // Broadcast NPC spawn to all clients with recipient-scoped position data.
    for (const roomClient of this.clients) {
      const recipient = this.state.players.get(roomClient.sessionId) ?? null;
      this.sendTracked(roomClient, 'playerJoined', buildNpcJoinedPayload({
        npcId,
        npcName,
        team,
        heroId,
        position: vec3SchemaToPlain(npc.position),
        includePosition: this.shouldIncludeJoinPosition(recipient, npc),
      }));
    }

    // Send confirmation to requesting client
    client.send('npcSpawned', buildNpcSpawnedPayload({
      npcId,
      npcName,
      team,
      heroId,
      position: vec3SchemaToPlain(npc.position),
    }));
  }

  private handleDamageNpc(client: Client, data: { npcId: string; damage: number }) {
    const { npcId, damage } = data;
    
    const targetId = this.npcs.resolveId(npcId);
    if (!targetId) {
      client.send('npcError', buildNpcErrorPayload(`NPC not found: ${npcId}`));
      return;
    }

    const npc = this.state.players.get(targetId);
    if (!npc) {
      this.npcs.delete(targetId);
      client.send('npcError', buildNpcErrorPayload(`NPC data not found: ${targetId}`));
      return;
    }

    const source = this.state.players.get(client.sessionId) ?? null;
    const { sourcePosition, sourceDirection } = resolveNpcDamageSourceContext({
      source,
      target: npc,
    });
    const result = this.damageRuntime.applyNpcDamage(npc, source, damage, sourcePosition, sourceDirection);

    if (result.applied) {
      this.broadcastPlayerDamaged(npc, source, {
        targetId: targetId,
        damage: result.damage,
        sourceId: source?.id ?? client.sessionId,
        damageType: 'console',
        newHealth: npc.health,
        sourcePosition,
        targetPosition: vec3SchemaToPlain(npc.position),
        sourceHeroId: source?.heroId || null,
        targetHeroId: npc.heroId || null,
      });
    }

    if (result.death) {
      this.damageRuntime.handleNpcDamageDeath(npc, source, result);
    }

    // Send confirmation
    client.send('npcDamaged', buildNpcDamagedPayload({
      npcId: targetId,
      npcName: npc.name,
      damage: result.damage,
      health: npc.health,
      maxHealth: npc.maxHealth,
      killed: Boolean(result.death),
    }));
  }

  private handleKillNpc(client: Client, data: { npcId: string }) {
    const { npcId } = data;
    
    const targetId = this.npcs.resolveId(npcId);
    if (!targetId) {
      client.send('npcError', buildNpcErrorPayload(`NPC not found: ${npcId}`));
      return;
    }

    const npc = this.state.players.get(targetId);
    if (!npc) {
      this.npcs.delete(targetId);
      return;
    }

    const npcName = npc.name;
    this.handleNpcDeath(npc, client.sessionId);

    client.send('npcKilled', buildNpcKilledPayload({
      npcId: targetId,
      npcName,
    }));
  }

  private handleKillAllNpcs(client: Client) {
    const count = this.npcs.size;
    
    for (const npcId of this.npcs.snapshotIds()) {
      const npc = this.state.players.get(npcId);
      if (npc) {
        this.handleNpcDeath(npc, client.sessionId);
      }
    }

    client.send('allNpcsKilled', buildAllNpcsKilledPayload(count));
  }

  private handleNpcDeath(npc: Player, killerId: string) {
    const killer = this.state.players.get(killerId);
    const { sourcePosition, sourceDirection } = resolveNpcDamageSourceContext({
      source: killer,
      target: npc,
    });
    const result = this.damageRuntime.killNpc(npc, killer ?? null, sourcePosition, sourceDirection);
    this.damageRuntime.handleNpcDamageDeath(npc, killer ?? null, result);
  }

  private removeNpcPlayer(playerId: string): void {
    this.state.players.delete(playerId);
    this.npcs.delete(playerId);
    this.clearPlayerReplicationState(playerId);
    this.updateMetadata();

    this.broadcastTracked('playerLeft', buildNpcLeftPayload(playerId));
  }

  // Check if a player ID is an NPC
  isNpc(playerId: string): boolean {
    return this.npcs.has(playerId);
  }
}
