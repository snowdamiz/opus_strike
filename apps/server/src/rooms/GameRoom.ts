import type { IncomingMessage } from 'http';
import crypto from 'node:crypto';
import { monitorEventLoopDelay, performance, type IntervalHistogram } from 'node:perf_hooks';
import { Room, Client } from 'colyseus';
import { GameState } from './schema/GameState';
import { Player } from './schema/Player';
import { Vec3Schema, AbilityStateSchema } from './schema/Components';
import { PlayerSpatialIndex, type PlayerSpatialQueryOptions } from './PlayerSpatialIndex';
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
  buildBattleRoyalDeploymentPhaseStatePatch,
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
  shouldRunHeroSelectPhaseTransitionCheck,
  shouldStartHeroSelectPhase,
  type RoomPhaseStatePatch,
} from './roomPhaseRuntime';
import { RoomTimeoutRegistry } from './roomTimeouts';
import { getBoundedRoomTickSchedule } from './roomTickSchedule';
import {
  PrimaryMagazineTracker,
  type PrimaryMagazineState,
} from './primaryMagazine';
import { PhantomVoidRayChargeTracker } from './phantomVoidRayCharge';
import { PhantomRiftBoltTracker } from './phantomRiftBolt';
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
  createBattleRoyalSafeZoneState,
  isOutsideBattleRoyalSafeZone,
  updateBattleRoyalSafeZoneState,
  type BattleRoyalSafeZoneState,
} from './battleRoyalSafeZone';
import {
  BATTLE_ROYAL_DEPLOYMENT_PHASE_MS,
  addBattleRoyalDropParticipant,
  advanceBattleRoyalDropState,
  areAllBattleRoyalHumanDropPlayersLanded,
  buildBattleRoyalDropSnapshot,
  createBattleRoyalDropState,
  forceLandBattleRoyalDropState,
  getBattleRoyalDeploymentCompletionReason,
  releaseAboardBattleRoyalBotPods,
  removeBattleRoyalDropParticipant,
  setBattleRoyalDropPlayerInput,
  startBattleRoyalTeamDrop,
  type BattleRoyalDropState,
} from './battleRoyalDrop';
import {
  BattleRoyalDownedRuntime,
  hasBattleRoyalHoldInteractionBreakingInput,
} from './battleRoyalDownedRuntime';
import {
  BattleRoyalSoulRuntime,
  type BattleRoyalSoulSummonCompletion,
} from './battleRoyalSoulRuntime';
import {
  MatchLedgerRuntime,
  type MatchPersistenceLedger,
} from './matchLedgerRuntime';
import { createRoomMatchFinalizationRuntime } from './matchFinalizationRuntime';
import { playerRewardService, type RankedBrRewardAccumulatorInit } from '../rewards/service';
import type {
  RankedBrRewardAccumulator,
  RankedBrRewardEventOutcome,
  RankedBrRewardTargetKind,
} from '../rewards/rankedBrCombatRewards';
import { getWagerRuntimeConfig } from '../wagers/config';
import {
  MatchSummaryRuntime,
  buildRankedUserStatesFromAuthContexts,
  type RankedSummaryPreviewInput,
} from './matchSummaryRuntime';
import { MatchSnapshotRuntime } from './matchSnapshotRuntime';
import { DEFAULT_PLAYER_PING_INTERVAL_MS, PlayerPingRuntime } from './playerPingRuntime';
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
  getPreviousPhasedIntervalTime,
  getPlayerStateStreamBroadcastPlan,
  isPhasedIntervalDue,
  type ReplicationFrameContext,
} from './replicationFrameRuntime';
import {
  SERVER_OWNED_MOVEMENT_STEP_SECONDS,
  SERVER_MOVEMENT_SUBSTEPS_PER_TICK,
  allocateRoomMovementCatchupBudget,
  getMovementBacklogTrimCount,
  getMovementCommandDrainDecision,
  type MovementCommandDrainDecision,
  type RoomMovementCatchupBudgetRequest,
} from './movementCommandDrain';
import {
  ingestMovementCommandPacket,
  promoteMovementCommandAcrossAuthorityBarrier,
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
  BlazeAfterburnerTrailTracker,
  BlazeLingeringAreaTracker,
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
  selectSoulrendRicochetTarget,
  shouldResolveBlazeSecondaryAttack,
  withHookshotHeavyAttackTargetHint,
  type AttackConfig,
  type AttackMode,
  type AttackTargetTeam,
  type SkillImpactHint,
} from './roomAttackRuntime';
import {
  DEFAULT_GAME_CONFIG,
  DEFAULT_GAMEPLAY_MODE,
  DEFAULT_MATCH_PERSPECTIVE,
  TICK_INTERVAL_MS,
  createGameConfigForGameplayMode,
  getGameplayModeRules,
  HERO_DEFINITIONS,
  ABILITY_DEFINITIONS,
  getHeroStats,
  createRandomSeed,
  getVoxelMapTheme,
  isGameplayMode,
  isMatchPerspective,
  normalizeVoxelMapSizeId,
  toPublicRankSnapshot,
  isInsideBoundaryPolygon,
  isCollisionBlock,
  FLAG_CAPTURE_RADIUS,
  FLAG_PICKUP_RADIUS,
  POWERUP_ABILITY_ATTACK_SPEED_MULTIPLIER,
  POWERUP_MOVEMENT_SPEED_MULTIPLIER,
  BHOP_GROUND_ACCEL,
  BHOP_GROUND_FRICTION,
  BHOP_GROUND_STOP_THRESHOLD,
  BHOP_MAX_VELOCITY,
  BHOP_NO_INPUT_FRICTION_MULTIPLIER,
  BHOP_STOP_SPEED,
  CROUCH_MULTIPLIER,
  GRAVITY,
  SPRINT_MULTIPLIER,
  ULTIMATE_CHARGE_PER_CAPTURE,
  ULTIMATE_CHARGE_PER_KILL,
  ULTIMATE_CHARGE_PER_SECOND,
  BLAZE_FLAMETHROWER_MAX_FUEL,
  BATTLE_ROYAL_BODY_SHIELD_MAX_HP,
  BATTLE_ROYAL_CRAWL_SPEED_MULTIPLIER,
  BATTLE_ROYAL_REVIVED_HEALTH,
  BATTLE_ROYAL_REVIVE_RADIUS,
  BLAZE_FLAMETHROWER_RANGE,
  BLAZE_FLAMETHROWER_CONE_HALF_ANGLE,
  BLAZE_FLAMETHROWER_DAMAGE,
  BLAZE_FLAMETHROWER_DAMAGE_INTERVAL,
  BLAZE_FLAMETHROWER_BURN_DAMAGE,
  BLAZE_GEARSTORM_RADIUS,
  BLAZE_GEARSTORM_DAMAGE,
  BLAZE_GEARSTORM_DAMAGE_INTERVAL_MS,
  BLAZE_PRIMARY_MAGAZINE_SIZE,
  BLAZE_PRIMARY_RELOAD_MS,
  BLAZE_SCRAPSHOT_MAGAZINE_SIZE,
  BLAZE_SCRAPSHOT_RANGE,
  BLAZE_ROCKET_SPEED,
  BLAZE_ROCKET_SPLASH_RADIUS,
  BLAZE_BOMB_SPLASH_RADIUS,
  BLAZE_BOMB_MAX_RANGE,
  BLAZE_BOMB_MIN_RANGE,
  BLAZE_PHOSPHOR_FLARE_DAMAGE_INTERVAL_MS,
  BLAZE_PHOSPHOR_FLARE_DURATION_MS,
  BLAZE_PHOSPHOR_FLARE_MAX_RANGE,
  BLAZE_PHOSPHOR_FLARE_MIN_RANGE,
  BLAZE_PHOSPHOR_FLARE_RADIUS,
  BLAZE_AFTERBURNER_DASH_DURATION_MS,
  BLAZE_AFTERBURNER_DASH_SPEED,
  BLAZE_AFTERBURNER_TRAIL_DAMAGE,
  BLAZE_AFTERBURNER_TRAIL_DAMAGE_INTERVAL_MS,
  BLAZE_AFTERBURNER_TRAIL_DURATION_MS,
  BLAZE_AFTERBURNER_TRAIL_RADIUS,
  BLAZE_AFTERBURNER_TRAIL_SAMPLE_SPACING,
  BLAZE_PHOENIX_DIVE_DAMAGE,
  BLAZE_PHOENIX_DIVE_RADIUS,
  BLAZE_PHOENIX_DIVE_MAX_RANGE,
  BLAZE_PHOENIX_DIVE_LAUNCH_DURATION_MS,
  BLAZE_PHOENIX_DIVE_HOVER_DURATION_MS,
  BLAZE_PHOENIX_DIVE_MAX_FALL_DURATION_MS,
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
  PHANTOM_PRIMARY_MAGAZINE_SIZE,
  PHANTOM_PRIMARY_RELOAD_MS,
  PHANTOM_RIFT_BOLT_COLLISION_RADIUS,
  PHANTOM_RIFT_BOLT_DAMAGE,
  PHANTOM_RIFT_BOLT_MAX_DISTANCE,
  PHANTOM_RIFT_BOLT_SPEED,
  PHANTOM_SOULREND_MAGAZINE_SIZE,
  PHANTOM_SOULREND_RICOCHET_RADIUS,
  PHANTOM_VEIL_SPEED_MULTIPLIER,
  PLAYER_COMBAT_HITBOX_PADDING,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  PLAYER_SLIDE_HEIGHT,
  PLAYER_SLIDE_RADIUS,
  VOID_RAY_CHARGE_TIME,
  MOVEMENT_PROTOCOL_VERSION,
  MOVEMENT_SUBSTEP_SECONDS,
  MOVEMENT_MAX_PACKET_COMMANDS,
  MOVEMENT_MAX_SERVER_QUEUE,
  MOVEMENT_BUTTON_MOVE_FORWARD,
  MOVEMENT_BUTTON_MOVE_BACKWARD,
  MOVEMENT_BUTTON_MOVE_LEFT,
  MOVEMENT_BUTTON_MOVE_RIGHT,
  MOVEMENT_BUTTON_JUMP,
  MOVEMENT_BUTTON_CROUCH,
  MOVEMENT_BUTTON_SPRINT,
  MOVEMENT_BUTTON_PRIMARY_FIRE,
  MOVEMENT_BUTTON_SECONDARY_FIRE,
  MOVEMENT_BUTTON_RELOAD,
  MOVEMENT_BUTTON_ABILITY_1,
  MOVEMENT_BUTTON_ABILITY_2,
  MOVEMENT_BUTTON_ULTIMATE,
  MOVEMENT_BUTTON_INTERACT,
  MOVEMENT_BUTTON_CROUCH_PRESSED,
  sanitizeMovementButtons,
  isMovementSeqAfter,
  normalizeLookYaw,
  clampLookPitch,
  calculateLookDirection,
  calculatePlayerSocketPosition,
  resolveAbilitySocket,
  getChronosAegisCenter as getSharedChronosAegisCenter,
  getChronosAegisForward as getSharedChronosAegisForward,
  getChronosAegisForwardDot as getSharedChronosAegisForwardDot,
  getBlazeMeteorPath,
  getBlazePhosphorFlareFlightDurationMs,
  getBlazePhosphorFlarePoint,
  getBlazeAfterburnerDirection,
  createBlazePhoenixDiveHoverMotion,
  getBlazePhoenixDiveHoverVelocity,
  getBlazePhoenixDiveStartPosition,
  getBlazePhoenixDiveVelocity,
  type BlazePhoenixDiveHoverMotion,
  BLAZE_PHOSPHOR_FLARE_PATH_SEGMENTS,
  getDefaultHeroSkinId,
  getHeroSkinDefinition,
  getTeamIdsForGameplayMode,
  getPlayerBodyAimPosition as getSharedPlayerBodyAimPosition,
  getPlayerEyePosition as getSharedPlayerEyePosition,
  getAimConeHitAgainstPlayerCombatHitbox,
  getSegmentHitAgainstPlayerCombatHitbox,
  getBlazeScrapshotPelletDirections,
  isBlazePrimarySkill,
  isPhantomPrimarySkill,
  isPhantomSecondarySkill,
  isBlazeSecondarySkill,
  isBlazeUltimateSkill,
  getBlazeUltimateAbilityId,
  isBlazeAbilityBindings,
  hasBlazeAfterburner,
  getSegmentHitAgainstChronosAegis,
  calculateFalloffDamage,
  calculateBlazeScrapshotPelletDamage,
  resolveDirectionalMovementIntent,
  canReceiveLiveTransform,
  getPlayerRole,
  isObserverPlayer,
  isBattleRoyalContestant,
  isPlayerAliveOrDowned,
  isHeroSkinId,
  CHRONOS_PRIMARY_MAGAZINE_SIZE,
  CHRONOS_PRIMARY_RELOAD_MS,
  RECORDING_ARTIFACT_VERSION,
} from '@voxel-strike/shared';
import type { 
  AbilityCastOriginHint,
  BlazePrimarySkill,
  BlazeSecondarySkill,
  BlazeUltimateSkill,
  BlazeAbilityBindings,
  PhantomPrimarySkill,
  PhantomSecondarySkill,
  BotDifficulty,
  PlayerCombatHitResult,
  HeroId, 
  HeroSkinId,
  Team, 
  PlayerInput,
  PlayerMovementState,
  MovementClientStateSnapshot,
  MovementCommand,
  MovementCommandPacket,
  MovementCorrectionReason,
  GameEndEvent,
  GameplayMode,
  MapProfileId,
  MapTopologyId,
  MapPingMessage,
  MapPingRequestMessage,
  MapPingSnapshot,
  MatchMode,
  MatchPerspective,
  PregeneratedMapArtifactId,
  PregeneratedMapId,
  SelfMovementAck,
  SelfMovementAuthority,
  MatchSnapshotMessage,
  MapSummoningCircle,
  PhantomShieldBrokenEvent,
  PlayerInterestMessage,
  PlayerDamagedEvent,
  PlayerDownedEvent,
  PlayerDeathEvent,
  PlayerHealedEvent,
  PlayerEventBatchItem,
  PlayerReviveCancelledEvent,
  PlayerRevivedEvent,
  PlayerReviveStartedEvent,
  PowerupCollectedMessage,
  ChronosAegisPose,
  PlayerTransformsV2Message,
  PlayerVitalsMessage,
  PlayerVitalsSnapshot,
  PlayerVisibilityState,
  PackedPlayerTransform,
  GamePhase,
  VoxelMapManifest,
  VoxelMapSizeId,
  VoxelMapTheme,
  RecordingActionRow,
  RecordingBotAssignment,
  RecordingCheckpointRow,
  RecordingHudMode,
  RecordingManifest,
  RecordingRoomOptions,
  RecordingSummary,
  RecordingSummaryPlayer,
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
import { isGameAdminUserId } from '../auth/gameAdmin';
import { verifyGameEntryTicket, type GameEntryTicketClaims } from '../security/entryTickets';
import {
  verifyStreamerObserverTicket,
  type StreamerObserverTicketClaims,
} from '../security/streamerTickets';
import { voiceService } from '../voice/VoiceService';
import type { MatchParticipantSnapshot } from '../persistence/matchPersistence';
import { createPlayerReport } from '../reports/playerReportService';
import {
  AntiCheatEvidenceStore,
  AntiCheatRoomRuntime,
  advanceMovementShadowSimulation,
  createMovementShadowSimulationState,
  getAntiCheatConfig,
  recordMovementShadowDriftSample,
  type AntiCheatIntegrityGate,
} from '../anticheat';
import { AccountRestrictedError, assertGameplayAccountEligible } from '../auth/accountEligibility';
import { consumeReplayNonce } from '../security/replayNonceStore';
import {
  getStreamerBotDeathmatchMapRotationMs,
  getStreamerObserverSeatCount,
} from '../streamer/config';
import {
  GAME_MESSAGE_RATE_LIMITS,
  MessageRateLimiter,
  type RateLimitRule,
} from './rateLimiter';
import { refreshRoomAuthDisplayName } from './roomPlayerNameRefresh';
import { shouldResolveGenericSecondaryAttack } from './combatInputRouting';
import { pregeneratedMapCatalogService } from '../maps/pregeneratedMapCatalog';
import { validateMovementProposal, type LastSafeMovementState, type MovementBounds } from './movementValidation';
import {
  buildPlayerMovementSnapshot,
  getMovementShadowClass,
  getMovementShadowFrameRateBand,
  getMovementShadowPingBand,
} from './movementShadowTelemetry';
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
  validateSkinPayload,
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
  BOT_CLOSE_REVEAL_RANGE,
  BOT_RECENT_DAMAGE_MEMORY_MS,
  BOT_RANKED_BATTLE_ROYAL_PROFILE_PREFIX,
  BOT_TACTICS_INTERVAL_MS,
  BOT_THINK_INTERVAL_MS,
  applyBotAbilityInputPlan,
  applyBotReviveTeammateInput,
  canUseBotAbility,
  chooseBotAbilityPlan,
  chooseBotCombatPlan,
  chooseLocalAvoidanceDirection,
  clearExpiredBlockedEdges,
  composeBotInputMovementState,
  composeBotMovementDirection,
  createInitialBotBrain,
  createSteeringProbeDirections,
  getBotAwarenessRange as resolveBotAwarenessRange,
  getBotAimReadinessTrace,
  getBotCombatEngagementState,
  getBotPredictedAimPoint,
  getBotSkillProfile,
  getBotYawPitchTowardPosition,
  isBotSecondaryFireWindowOpen,
  normalizeBotDifficulty,
  shouldRefreshBotPlanningState,
  updateBotAimState,
  updateBotPrimaryFireDecision,
  updateBotMovementRecoveryState,
  updateBotPlanningState,
  updateBotSecondaryFireDecision,
  type BotAbilityGeometry,
  type BotBlackboard,
  type BotBrain,
  type BotMapPingSnapshot,
  type BotPlayerSnapshot,
  type BotRecentDamageSource,
  type BotRoutePlan,
  type BotSteeringChoice,
  type BotSteeringProbe,
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
  isBattleRoyalMode,
  isCaptureTheFlagMode,
  isTeamDeathmatchMode,
  resolveBattleRoyalMatchEnd,
} from './gameModeRules';
import { BattleRoyalPlacementTracker } from './battleRoyalPlacement';
import {
  RecordingArtifactWriter,
  buildRecordingArtifactRefs,
} from '../recordings/artifacts';
import type { GameRoomRecordingOptions } from '../recordings/types';
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
  reconcilePlayerAbilities,
  resetAbilityCooldowns,
  tryUseAbility,
  executeAbility,
  updateAbilityCooldowns,
  updateActiveAbilities,
  type AbilityUseResult,
  type HeroAbilitySelection,
} from './abilityHandlers';
import { RoomDamageRuntime, type RoomDamageContext as DamageContext } from './roomDamageRuntime';
import { RoomTickProfiler, type RoomTickCounterName, type RoomTickSpanName } from './roomTickProfiler';

type ResolvedAbilityUseResult = {
  abilityId: string;
  abilityDef: NonNullable<AbilityUseResult['abilityDef']>;
  abilityState: AbilityStateSchema;
};

interface PlayerStateStreamRecipientSendResult {
  sentVitals: boolean;
  sentInterest: boolean;
}

interface GameRoomAuthBundle {
  auth: RoomAuthContext;
  ticket: GameEntryTicketClaims | null;
  streamerTicket: StreamerObserverTicketClaims | null;
}

interface StreamerObserverSession {
  adminUserId: string;
  joinedAt: number;
  lastHeartbeatAt: number;
}

interface CreateOptions {
  lobbyId?: string;
  lobbyName?: string;
  matchMode?: MatchMode;
  gameplayMode?: GameplayMode;
  matchPerspective?: MatchPerspective;
  mapSeed?: number;
  mapThemeId?: VoxelMapTheme['id'] | null;
  mapSize?: VoxelMapSizeId | null;
  mapProfileId?: MapProfileId | null;
  pregeneratedMapId?: PregeneratedMapId | null;
  mapArtifactId?: PregeneratedMapArtifactId | null;
  mapSelectionId?: string | null;
  botAssignments?: BotAssignment[];
  rankedEligible?: boolean;
  requiredHumanPlayers?: number;
  reservedHumanPlayers?: number;
  capacityPlayerCost?: number;
  streamerManagedBotGame?: boolean;
  streamerManagedByUserId?: string;
  streamerFeedMode?: string;
  streamerCameraMode?: string;
  streamerMapRotationStartedAt?: number | null;
  endlessMatch?: boolean;
  recording?: GameRoomRecordingOptions;
}

interface JoinOptions {
  playerName?: string;
  preferredTeam?: Team;
  entryTicket?: string;
  reconnectToRunningGame?: boolean;
  authToken?: string;
  clientBuildId?: string;
  movementProtocolVersion?: number;
  streamerObserverTicket?: string;
}

interface BotAssignment {
  playerId: string;
  playerName: string;
  team: Team;
  isBot: true;
  heroId?: HeroId;
  skinId?: HeroSkinId;
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
  ricochetPosition?: PlainVec3;
  ricochetTargetId?: string;
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
  expiresAt?: number;
}

interface HookshotGroundHooksTarget {
  targetId: string;
  position: PlainVec3;
  rootUntil: number;
}

interface BotFrameContext {
  snapshots: BotPlayerSnapshot[];
  snapshotById: Map<string, BotPlayerSnapshot>;
  aliveBotCount: number;
  safeZone: BattleRoyalSafeZoneState | null;
  mapPings: BotMapPingSnapshot[];
  flags: ReturnType<typeof getBotFlagSnapshots>;
  teamTactics: BotTeamTacticsByTeam;
  protectedEnemyIdsByTeam: Map<Team, Set<string>>;
  perceptionByBot: Map<string, BotPerceptionSets>;
  lineOfSightChecksRemaining: number;
  steeringProbeChecksRemaining: number;
  steeringProbePriorityChecksRemaining: number;
}

type BotSimulationTier = 'critical' | 'near' | 'background';

interface BotPerceptionSets {
  visibleEnemyIds: Set<string>;
  enemyLineOfSightIds: Set<string>;
  lineOfSightUnknownEnemyIds: Set<string>;
}

interface BotSteeringPathCacheEntry {
  clear: boolean;
  expiresAt: number;
  collisionRevision: number;
}

interface DeferredTrackedMessage {
  client: Client;
  type: string;
  payload: unknown;
}

const BATCHABLE_PLAYER_EVENT_TYPES = new Set<string>([
  'powerupCollected',
  'abilityUsed',
  'playerDamaged',
  'playerDowned',
  'playerReviveStarted',
  'playerReviveCancelled',
  'playerRevived',
  'playerKilled',
  'playerHealed',
  'chronosAegisDamaged',
  'phantomShieldBroken',
]);

function isBatchablePlayerEvent(type: string): type is PlayerEventBatchItem['type'] {
  return BATCHABLE_PLAYER_EVENT_TYPES.has(type);
}

interface MovementPhysicsFrameEntry {
  player: Player;
  authority: ServerMovementAuthorityState;
  queuedCommandCount: number;
  drainDecision: MovementCommandDrainDecision;
  grantedExtraSubsteps: number;
  skippedExtraSubsteps: number;
  serverOwnedInput?: PlayerInput;
}

interface BlazeAfterburnerDashRuntime {
  playerId: string;
  trailId: string;
  direction: PlainVec3;
  expiresAt: number;
  lastSamplePosition: PlainVec3;
}

interface BlazePhoenixDiveRuntime {
  castId: string;
  targetPosition: PlainVec3 | null;
  hoverAt: number;
  hoverEndsAt: number;
  impactDeadline: number;
  fallbackImpactGroundY: number;
  hoverMotion: BlazePhoenixDiveHoverMotion | null;
  launchYaw: number;
  phase: 'launch' | 'hover' | 'dive';
}

interface StateStreamBroadcastOptions {
  transforms?: boolean;
  vitals?: boolean;
  match?: boolean;
  forceTransforms?: boolean;
  forceVitals?: boolean;
  forceMatch?: boolean;
}

interface ResolvedStateStreamBroadcastOptions {
  transforms: boolean;
  vitals: boolean;
  match: boolean;
  forceTransforms: boolean;
  forceVitals: boolean;
  forceMatch: boolean;
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
const ABILITY_CAST_HINT_AIM_POINT_MAX_RANGE_GRACE = 2.5;
const ABILITY_CAST_HINT_MIN_AIM_FORWARD_DOT = 0.65;
const HOOKSHOT_GRAPPLE_HINT_SURFACE_PROBE_DISTANCE = 0.65;

const BLAZE_FLAMETHROWER_CONE_DOT = Math.cos(BLAZE_FLAMETHROWER_CONE_HALF_ANGLE);
const PLAYER_VITALS_INTERVAL_MS = 125;
const PLAYER_VITALS_RECONCILE_INTERVAL_MS = 2500;
const TRANSFORM_HIGH_RELEVANCE_DISTANCE_SQ = 48 * 48;
const RECORDING_CHECKPOINT_INTERVAL_MS = 5_000;
const RECORDING_STOP_POLL_INTERVAL_MS = 1_000;
const RECENT_COMBAT_TRANSFORM_MS = 650;
const RECENT_COMBAT_INTEREST_MS = 900;
const PLAYER_INTEREST_INTERVAL_MS = 200;
const MATCH_SNAPSHOT_DRIFT_SYNC_INTERVAL_MS = 2000;
const LOW_FREQUENCY_STATE_INTERVAL_MS = 250;
const MAX_RETAINED_ROOM_TICKS_AFTER_STALL = 4;
const PLAYER_PING_BROADCAST_INTERVAL_MS = 250;
const MAP_PING_TTL_MS = 15_000;
const MAP_PING_MAX_DISTANCE = 380;
const MAP_PING_TOGGLE_CLEAR_DISTANCE = 4.5;
const MAP_PING_GROUND_PROBE_UP = 6;
const MAP_PING_GROUND_Y_OFFSET = 0.08;
const BATTLE_ROYAL_FIRST_SAFE_ZONE_REVEAL_BUFFER_MS = 3_000;
const SELF_MOVEMENT_FULL_AUTHORITY_INTERVAL_MS = 100;
const UNSTUCK_SEARCH_MAX_RADIUS = 14;
const UNSTUCK_SEARCH_RADIUS_STEP = 1.25;
const UNSTUCK_SEARCH_ANGLE_COUNT = 16;
const UNSTUCK_GROUND_PROBE_UP = 3;
const UNSTUCK_DESTINATION_Y_OFFSET = PLAYER_HEIGHT / 2 + 0.06;
const ROOM_MOVEMENT_EXTRA_CATCHUP_SUBSTEPS_PER_TICK = SERVER_MOVEMENT_SUBSTEPS_PER_TICK * 4;
interface BotPlanningBudgetTuning {
  fullRateCount: number;
  lodStartCount: number;
  urgentBudget: number;
  deferredBudget: number;
  midUrgentBudget: number;
  midDeferredBudget: number;
  minUrgentBudget: number;
  minDeferredBudget: number;
}
const DEFAULT_BOT_PLANNING_BUDGET_TUNING: BotPlanningBudgetTuning = {
  urgentBudget: 8,
  deferredBudget: 4,
  fullRateCount: 6,
  lodStartCount: 8,
  midUrgentBudget: 3,
  midDeferredBudget: 1,
  minUrgentBudget: 2,
  minDeferredBudget: 1,
};
const BATTLE_ROYAL_BOT_PLANNING_BUDGET_TUNING: BotPlanningBudgetTuning = {
  urgentBudget: 7,
  deferredBudget: 2,
  fullRateCount: 7,
  lodStartCount: 16,
  midUrgentBudget: 4,
  midDeferredBudget: 2,
  minUrgentBudget: 4,
  minDeferredBudget: 1,
};
const BOT_MOVEMENT_LOD_START_COUNT = 8;
const BOT_MOVEMENT_LOD_MEDIUM_COUNT = 16;
const BOT_MOVEMENT_LOD_HIGH_COUNT = 32;
const BOT_MOVEMENT_LOD_ENEMY_HUMAN_DISTANCE = 26;
const BOT_MOVEMENT_LOD_ENEMY_HUMAN_DISTANCE_SQ = BOT_MOVEMENT_LOD_ENEMY_HUMAN_DISTANCE * BOT_MOVEMENT_LOD_ENEMY_HUMAN_DISTANCE;
const BOT_BATTLE_ROYAL_CRITICAL_ENEMY_DISTANCE = 24;
const BOT_BATTLE_ROYAL_CRITICAL_ENEMY_DISTANCE_SQ = BOT_BATTLE_ROYAL_CRITICAL_ENEMY_DISTANCE * BOT_BATTLE_ROYAL_CRITICAL_ENEMY_DISTANCE;
const BOT_MOVEMENT_LOD_FULL_STEP_BUDGET_LOW = 3;
const BOT_MOVEMENT_LOD_FULL_STEP_BUDGET_MEDIUM = 2;
const BOT_MOVEMENT_LOD_FULL_STEP_BUDGET_HIGH = 1;
const BOT_BATTLE_ROYAL_MOVEMENT_FULL_STEP_BUDGET_LOW = 6;
const BOT_BATTLE_ROYAL_MOVEMENT_FULL_STEP_BUDGET_MEDIUM = 8;
const BOT_BATTLE_ROYAL_MOVEMENT_FULL_STEP_BUDGET_HIGH = 10;
const BOT_MOVEMENT_LOD_PROXY_MAX_DISTANCE = 0.68;
const BOT_MOVEMENT_LOD_PROXY_MAX_GROUND_DELTA = 0.95;
const BOT_MOVEMENT_LOD_PROXY_MIN_HORIZONTAL_SPEED = 0.05;
const BOT_SIMULATION_NEAR_HUMAN_DISTANCE = 22;
const BOT_SIMULATION_NEAR_HUMAN_DISTANCE_SQ = BOT_SIMULATION_NEAR_HUMAN_DISTANCE * BOT_SIMULATION_NEAR_HUMAN_DISTANCE;
const BOT_NEAR_PLANNING_CADENCE_HIGH = 2;
const BOT_BACKGROUND_PLANNING_CADENCE_MEDIUM = 3;
const BOT_BACKGROUND_PLANNING_CADENCE_HIGH = 5;
const BOT_BACKGROUND_MOVEMENT_CADENCE_MEDIUM = 4;
const BOT_BACKGROUND_MOVEMENT_CADENCE_HIGH = 6;
const BOT_PROXIMITY_VISIBLE_RANGE = 18;
const BOT_PERCEPTION_LOS_LOD_START_COUNT = 8;
const BOT_PERCEPTION_LOS_LOD_MEDIUM_COUNT = 16;
const BOT_PERCEPTION_LOS_LOD_HIGH_COUNT = 32;
const BOT_PERCEPTION_LOS_LOW_CANDIDATE_LIMIT = 5;
const BOT_PERCEPTION_LOS_MEDIUM_CANDIDATE_LIMIT = 6;
const BOT_PERCEPTION_LOS_HIGH_CANDIDATE_LIMIT = 5;
const BOT_PERCEPTION_LOS_NEAR_LOW_CANDIDATE_LIMIT = 4;
const BOT_PERCEPTION_LOS_NEAR_MEDIUM_CANDIDATE_LIMIT = 4;
const BOT_PERCEPTION_LOS_NEAR_HIGH_CANDIDATE_LIMIT = 3;
const BOT_PERCEPTION_LOS_BACKGROUND_LOW_CANDIDATE_LIMIT = 2;
const BOT_PERCEPTION_LOS_BACKGROUND_MEDIUM_CANDIDATE_LIMIT = 2;
const BOT_PERCEPTION_LOS_BACKGROUND_HIGH_CANDIDATE_LIMIT = 1;
const BOT_BATTLE_ROYAL_PERCEPTION_LOS_CRITICAL_CANDIDATE_LIMIT = 8;
const BOT_BATTLE_ROYAL_PERCEPTION_LOS_NEAR_CANDIDATE_LIMIT = 5;
const BOT_BATTLE_ROYAL_PERCEPTION_LOS_BACKGROUND_CANDIDATE_LIMIT = 2;
const BOT_PERCEPTION_LOS_TARGET_SCORE_BONUS = 10_000;
const BOT_PERCEPTION_LOS_FRAME_BUDGET_LOW = 12;
const BOT_PERCEPTION_LOS_FRAME_BUDGET_MEDIUM = 14;
const BOT_PERCEPTION_LOS_FRAME_BUDGET_HIGH = 16;
const BOT_BATTLE_ROYAL_PERCEPTION_LOS_FRAME_BUDGET_LOW = 20;
const BOT_BATTLE_ROYAL_PERCEPTION_LOS_FRAME_BUDGET_MEDIUM = 24;
const BOT_BATTLE_ROYAL_PERCEPTION_LOS_FRAME_BUDGET_HIGH = 28;
const BOT_STEERING_PROBE_FRAME_BUDGET_LOW = 12;
const BOT_STEERING_PROBE_FRAME_BUDGET_MEDIUM = 14;
const BOT_STEERING_PROBE_FRAME_BUDGET_HIGH = 16;
const BOT_BATTLE_ROYAL_STEERING_PROBE_FRAME_BUDGET_LOW = 32;
const BOT_BATTLE_ROYAL_STEERING_PROBE_FRAME_BUDGET_MEDIUM = 40;
const BOT_BATTLE_ROYAL_STEERING_PROBE_FRAME_BUDGET_HIGH = 48;
// Reserved for bots that die if they can't navigate (outside/near the shrinking
// safe zone, or moving in to revive) so idle in-zone bots can't starve them of
// obstacle probes via the shared frame budget.
const BOT_BATTLE_ROYAL_STEERING_PROBE_PRIORITY_FRAME_BUDGET = 48;
const BOT_INITIAL_THINK_STAGGER_MS = BOT_THINK_INTERVAL_MS;
const BOT_INITIAL_BLACKBOARD_STAGGER_MS = BOT_TACTICS_INTERVAL_MS;
const EMPTY_BOT_PERCEPTION_IDS = new Set<string>();
const BOT_STEERING_PATH_CACHE_TTL_MS = 160;
const BOT_STEERING_PATH_CACHE_MAX_ENTRIES = 2048;
const BOT_STEERING_PATH_POSITION_QUANTIZATION = 2;
const BOT_STEERING_TERRAIN_LOOKAHEAD_MIN_DISTANCE = 3.2;
const BOT_STEERING_TERRAIN_LOOKAHEAD_MAX_DISTANCE = 5.4;
const BOT_STEERING_TERRAIN_LOOKAHEAD_SECONDS = 0.32;
const CHRONOS_AEGIS_SHIELD_TRANSFORM_SCALE = 255;
const OBJECTIVE_SUPPRESSION_MS = 650;
const SECURITY_EVENT_LOG_SAMPLE_MS = 5000;
const MOVEMENT_CORRECTION_LOG_SAMPLE_MS = 1000;
const MAX_SECURITY_LOG_SAMPLE_KEYS = 1024;
const DEV_COMMANDS_DISABLED_MESSAGE = 'Developer commands are disabled';
const HOOKSHOT_SPEED = 38;
const DRAG_HOOK_SPEED = 50;
const DEFAULT_GAME_ROOM_SEAT_RESERVATION_SECONDS = 60;
const MAX_CONSECUTIVE_TICK_ERRORS = 5;
const TICK_ERROR_LOG_SAMPLE_MS = 1000;
const MAP_MANIFEST_SLOW_LOG_MS = 3000;
const TICK_DELAY_WARN_MS = Math.max(250, TICK_INTERVAL_MS * 5);
const TICK_DELAY_LOG_SAMPLE_MS = 5000;
const RANKED_BR_REWARD_SKIP_LOG_LIMIT_PER_REASON = 3;
const RANKED_BR_REWARD_AWARD_LOG_LIMIT = 5;

function getScaledBotPlanningBudgets(
  scheduledBotCount: number,
  tuning: BotPlanningBudgetTuning
): { urgentBudget: number; deferredBudget: number } {
  const count = Math.max(0, Math.floor(scheduledBotCount));
  if (count <= 0) {
    return { urgentBudget: 0, deferredBudget: 0 };
  }

  if (count <= tuning.fullRateCount) {
    return {
      urgentBudget: tuning.urgentBudget,
      deferredBudget: tuning.deferredBudget,
    };
  }

  if (count <= tuning.lodStartCount) {
    return {
      urgentBudget: tuning.midUrgentBudget,
      deferredBudget: tuning.midDeferredBudget,
    };
  }

  const scale = tuning.lodStartCount / count;
  return {
    urgentBudget: Math.max(
      tuning.minUrgentBudget,
      Math.round(tuning.midUrgentBudget * scale)
    ),
    deferredBudget: Math.max(
      tuning.minDeferredBudget,
      Math.floor(tuning.midDeferredBudget * scale)
    ),
  };
}

function readGameRoomSeatReservationSeconds(): number {
  const raw = process.env.GAME_ROOM_SEAT_RESERVATION_SECONDS
    ?? process.env.COLYSEUS_GAME_ROOM_SEAT_RESERVATION_TIME;
  const parsed = raw ? Number(raw) : DEFAULT_GAME_ROOM_SEAT_RESERVATION_SECONDS;
  return Number.isFinite(parsed) && parsed >= 15
    ? Math.min(180, Math.floor(parsed))
    : DEFAULT_GAME_ROOM_SEAT_RESERVATION_SECONDS;
}

export class GameRoom extends Room<GameState> {
  maxClients = DEFAULT_GAME_CONFIG.maxPlayers;

  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private tickLoopActive = false;
  private tickInProgress = false;
  private nextTickAtMs = 0;
  private deferStateStreamsForCatchup = false;
  private pendingCatchupStateStreams: ResolvedStateStreamBroadcastOptions | null = null;
  private consecutiveTickErrors = 0;
  private lastTickErrorLoggedAtMs = 0;
  private matchStartCancelTimeout: ReturnType<typeof setTimeout> | null = null;
  private matchCancelDisconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly roomTimeouts = new RoomTimeoutRegistry();
  private readonly playerPressStates = new PlayerPressStateTracker();
  private config = createGameConfigForGameplayMode();
  private lobbyId: string | null = null;
  private lobbyName: string | null = null;
  private readonly voidZones = new VoidZoneTracker();
  private readonly phantomPrimaryMagazines = new PrimaryMagazineTracker({
    magazineSize: PHANTOM_PRIMARY_MAGAZINE_SIZE,
    reloadMs: PHANTOM_PRIMARY_RELOAD_MS,
  });
  private readonly phantomSoulrendPrimaryMagazines = new PrimaryMagazineTracker({
    magazineSize: PHANTOM_SOULREND_MAGAZINE_SIZE,
    reloadMs: PHANTOM_PRIMARY_RELOAD_MS,
  });
  private readonly phantomPrimarySkills = new Map<string, PhantomPrimarySkill>();
  private readonly phantomSecondarySkills = new Map<string, PhantomSecondarySkill>();
  private readonly blazePrimaryMagazines = new PrimaryMagazineTracker({
    magazineSize: BLAZE_PRIMARY_MAGAZINE_SIZE,
    reloadMs: BLAZE_PRIMARY_RELOAD_MS,
  });
  private readonly blazeScrapshotPrimaryMagazines = new PrimaryMagazineTracker({
    magazineSize: BLAZE_SCRAPSHOT_MAGAZINE_SIZE,
    reloadMs: BLAZE_PRIMARY_RELOAD_MS,
  });
  private readonly blazePrimarySkills = new Map<string, BlazePrimarySkill>();
  private readonly blazeSecondarySkills = new Map<string, BlazeSecondarySkill>();
  private readonly blazeUltimateSkills = new Map<string, BlazeUltimateSkill>();
  private readonly blazeAbilityBindings = new Map<string, BlazeAbilityBindings>();
  private readonly chronosPrimaryMagazines = new PrimaryMagazineTracker({
    magazineSize: CHRONOS_PRIMARY_MAGAZINE_SIZE,
    reloadMs: CHRONOS_PRIMARY_RELOAD_MS,
  });
  private readonly phantomPrimaryHolds = new PlayerHoldTracker();
  private readonly chronosPrimaryHolds = new PlayerHoldTracker();
  private readonly phantomVoidRayCharges = new PhantomVoidRayChargeTracker();
  private readonly phantomRiftBolts = new PhantomRiftBoltTracker();
  private readonly abilityIds = new RoomAbilityIdGenerator();
  private readonly phantomPrimaryLaunchSide = new AlternatingLaunchSideTracker();
  private readonly hookshotPrimaryLaunchSide = new AlternatingLaunchSideTracker();
  private readonly hookshotRuntime = new HookshotRuntimeTracker();
  private readonly playerRoots = new PlayerRootTracker();
  private readonly powerupPickups = new PowerupPickupTracker();
  private readonly powerupBoosts = new PowerupBoostTracker();
  private readonly pendingAreaDamage = new PendingAreaDamageQueue();
  private readonly pendingAreaDamageReady: PendingAreaDamageInstance[] = [];
  private readonly blazeLingeringAreas = new BlazeLingeringAreaTracker();
  private readonly blazeAfterburnerTrails = new BlazeAfterburnerTrailTracker();
  private readonly blazeAfterburnerDashes = new Map<string, BlazeAfterburnerDashRuntime>();
  private readonly blazePhoenixDives = new Map<string, BlazePhoenixDiveRuntime>();
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
  private mapSelectionId: string | null = null;
  private readonly mapRuntime = new RoomMapRuntime({
    getMapConfig: () => ({
      mapSeed: this.state.mapSeed,
      mapThemeId: this.state.mapThemeId as VoxelMapTheme['id'] | null,
      mapSize: this.state.mapSize as VoxelMapSizeId | null,
      mapProfileId: this.state.mapProfileId as MapProfileId | null,
      pregeneratedMapId: this.state.pregeneratedMapId || null,
      mapArtifactId: this.state.mapArtifactId || null,
    }),
    getCollisionAabbs: (bounds) => this.hookshotRuntime.getAnchorWallAabbs(this.state.serverTime || Date.now(), bounds),
    recordMapFallbackGeneration: async ({ mapId, reason }) => {
      await pregeneratedMapCatalogService.recordMapLaunchResult({
        mapId,
        selectionId: this.mapSelectionId,
        roomId: this.roomId,
        matchId: this.matchLedger.getMatchId(),
        ok: false,
        error: `artifact-fallback:${reason}`,
      });
    },
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
    isFullRateTransform: (id, player, now) => this.shouldSendFullRateTransform(id, player, now),
  });
  private matchSnapshotSignature = '';
  private readonly playerPings = new PlayerPingRuntime();
  private readonly activeMapPings = new Map<string, MapPingSnapshot>();
  private mapPingSequence = 0;
  private readonly tickProfiler = new RoomTickProfiler();
  private streamScheduleStartedAt = 0;
  private vitalsPhaseAtMs = 0;
  private interestPhaseAtMs = 0;
  private pingProbePhaseAtMs = 0;
  private pingBroadcastPhaseAtMs = 0;
  private matchSnapshotPhaseAtMs = 0;
  private lastPingProbeAt = 0;
  private lastPingBroadcastAt = 0;
  private movementCatchupBudgetCursor = 0;
  private readonly movementPhysicsFrameEntries: MovementPhysicsFrameEntry[] = [];
  private readonly movementCatchupRequests: RoomMovementCatchupBudgetRequest[] = [];
  private readonly movementCatchupFrameEntries: MovementPhysicsFrameEntry[] = [];
  private botMovementLodCountTick = -1;
  private aliveBotMovementLodCount = 0;
  private botMovementFullStepBudgetTick = -1;
  private botMovementFullStepBudgetRemaining = Number.POSITIVE_INFINITY;
  private botSimulationTierTick = -1;
  private readonly botSimulationTierById = new Map<string, BotSimulationTier>();
  private readonly botNearBattleRoyalEnemyById = new Map<string, boolean>();
  private readonly battleRoyalHumanTeams = new Set<Team>();
  private readonly battleRoyalContestantHumanTeams = new Set<Team>();
  private readonly battleRoyalHumanSquadSurvivorTeams = new Set<Team>();
  private hasBattleRoyalDownedPlayer = false;
  private botSnapshotRosterIds: string[] = [];
  private readonly botsWithReusedInputThisTick = new Set<string>();
  private readonly botPerceptionCandidatesScratch: Player[] = [];
  private readonly botPerceptionCandidateIdsScratch = new Set<string>();
  private readonly botPerceptionLosCandidatePlayersScratch: Player[] = [];
  private readonly botPerceptionLosCandidateScoresScratch: number[] = [];
  private readonly botMovementLodEnemyHumanScratch: Player[] = [];
  private readonly botSimulationHumanScratch: Player[] = [];
  private readonly botSteeringPathCache = new Map<string, BotSteeringPathCacheEntry>();
  private readonly botFrameSnapshotById = new Map<string, BotPlayerSnapshot>();
  private readonly botFrameProtectedEnemyIdsByTeam = new Map<Team, Set<string>>();
  private readonly botFramePerceptionByBot = new Map<string, BotPerceptionSets>();
  private readonly botPerceptionSetsPool: BotPerceptionSets[] = [];
  private readonly botFramePerceptionSets: BotPerceptionSets[] = [];
  private readonly deferredTrackedMessages: DeferredTrackedMessage[] = [];
  private readonly deferredPlayerEventBatches = new Map<Client, PlayerEventBatchItem[]>();
  private readonly deferredPlayerEventBatchClients: Client[] = [];
  private readonly visibleHealedTargetIdsScratch = new Set<string>();
  private readonly terrainRaycastPointScratch: PlainVec3 = { x: 0, y: 0, z: 0 };
  private readonly chronosAegisPoseScratch: ChronosAegisPose = {
    playerId: '',
    position: { x: 0, y: 0, z: 0 },
    lookYaw: 0,
    lookPitch: 0,
  };
  private eventReplicationFrameContext: ReplicationFrameContext | null = null;
  private eventReplicationFrameContextTick = -1;
  private eventReplicationFrameContextNow = 0;
  private readonly movementStepPosition: PlainVec3 = { x: 0, y: 0, z: 0 };
  private readonly movementStepVelocity: PlainVec3 = { x: 0, y: 0, z: 0 };
  private readonly movementStepState: PlayerMovementState = {
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
  private readonly playerSpatialIndex = new PlayerSpatialIndex(8);
  private readonly playerSpatialQueries = new PlayerSpatialQueries(
    this.playerSpatialIndex,
    () => this.ensurePlayerSpatialIndexFresh()
  );
  private playerSpatialIndexDirty = true;
  private readonly roomMetrics = new RoomMetrics();
  private eventLoopDelay: IntervalHistogram | null = null;
  private lastTickDelayLoggedAtMs = 0;
  private readonly lineOfSightCache = new LineOfSightCache();
  private readonly rateLimiter = new MessageRateLimiter();
  private readonly participantRegistry = new RoomParticipantRegistry();
  private readonly antiCheatEvidenceStore = new AntiCheatEvidenceStore(prisma);
  private readonly matchFinalization = createRoomMatchFinalizationRuntime({
    evidenceStore: this.antiCheatEvidenceStore,
    serializeError: (error) => this.serializePersistenceError(error),
  });
  private rankedBrRewardAccumulator: RankedBrRewardAccumulator | null = null;
  private rankedBrRewardConfig: RankedBrRewardAccumulatorInit['config'] | null = null;
  private rankedBrRewardConfigRefreshInFlight = false;
  private rankedBrRewardConfigRefreshAfterMs = 0;
  private rankedBrRewardInitGeneration = 0;
  private readonly rankedBrRewardSkipLogCounts = new Map<string, number>();
  private rankedBrRewardAwardLogCount = 0;
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
    getRespawnDelayMs: () => this.isBattleRoyalActiveCombatPhase()
      ? null
      : this.config.respawnTimeSeconds * 1000,
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
    recordRankedBrCombatReward: (input) => this.recordRankedBrCombatReward(input),
    broadcastPhantomShieldBroken: (target, source, payload) => this.broadcastPhantomShieldBroken(target, source, payload),
    broadcastPlayerDamaged: (target, source, payload) => this.broadcastPlayerDamaged(target, source, payload),
    shouldDownLethalDamage: (target) => (
      this.isBattleRoyalActiveCombatPhase() &&
      target.state === 'alive'
    ),
    shouldDamageDownedPlayers: () => this.isBattleRoyalActiveCombatPhase(),
    enterBattleRoyalDowned: (target, source, payload) => this.enterBattleRoyalDowned(target, source, payload),
    broadcastPlayerKilled: (target, killer, payload) => this.broadcastPlayerKilled(target, killer, payload),
    recordMatchDeath: (victim, killer) => this.recordMatchDeath(victim, killer),
    recordMatchKill: (killer, victim, details) => this.recordMatchKill(killer, victim, details),
    recordMatchAssist: (assister, victim) => this.recordMatchAssist(assister, victim),
    resetPlayerLifeRuntime: (player, deathAt) => this.resetPlayerLifeRuntime(player, deathAt),
    isCaptureTheFlagMode: () => isCaptureTheFlagMode(this.gameplayMode),
    dropFlag: (player) => this.dropFlag(player),
    scoreTeamDeathmatchKill: (killer, victim) => this.scoreTeamDeathmatchKill(killer, victim),
    removeNpcPlayer: (playerId) => this.removeNpcPlayer(playerId),
  });
  private readonly battleRoyalDownedRuntime = new BattleRoyalDownedRuntime({
    getPlayerById: (playerId) => this.state.players.get(playerId) ?? null,
    prepareDownedPlayer: (player, now) => this.prepareBattleRoyalDownedPlayer(player, now),
    prepareRevivedPlayer: (player, now) => this.prepareBattleRoyalRevivedPlayer(player, now),
    finalEliminate: (player, sourceId, damageType, now, context) => {
      this.damageRuntime.finalEliminatePlayer(player, sourceId, damageType, now, context ?? {});
    },
    broadcastPlayerDowned: (payload) => this.broadcastPlayerDowned(payload),
    broadcastReviveStarted: (payload) => this.broadcastPlayerReviveStarted(payload),
    broadcastReviveCancelled: (payload) => this.broadcastPlayerReviveCancelled(payload),
    broadcastPlayerRevived: (payload) => this.broadcastPlayerRevived(payload),
  });
  private readonly battleRoyalSouls = new BattleRoyalSoulRuntime();
  private readonly matchLedger = new MatchLedgerRuntime({
    getConfig: () => ({
      roomId: this.roomId,
      lobbyId: this.lobbyId,
      matchMode: this.matchMode,
      mapSeed: this.state.mapSeed,
      mapThemeId: this.state.mapThemeId as VoxelMapTheme['id'],
      mapSize: this.state.mapSize as VoxelMapSizeId,
      mapProfileId: this.state.mapProfileId as MapProfileId,
      mapTopologyId: this.getMapManifest().topologyId as MapTopologyId,
      mapGeneratorVersion: this.getMapManifest().version,
      pregeneratedMapId: this.state.pregeneratedMapId || null,
      rankedEligible: this.rankedEligibilityCandidate,
    }),
    getDurableUserId: (playerId) => this.getDurableUserId(playerId),
    isRankedRewardEligible: (playerId) => this.isRankedRewardEligiblePlayer(playerId),
    isNpc: (playerId) => this.npcs.has(playerId),
  });
  private rankedEligibilityCandidate = false;
  private requiredHumanPlayers = 1;
  private rankedRequiredHumanPlayers = DEFAULT_GAME_CONFIG.maxPlayers;
  private reservedHumanPlayers = 0;
  private playerClientCapacity = DEFAULT_GAME_CONFIG.maxPlayers;
  private capacityPlayerCost = 0;
  private streamerManagedBotGame = false;
  private streamerManagedByUserId: string | null = null;
  private streamerFeedMode: string | null = null;
  private streamerCameraMode: string | null = null;
  private streamerMapRotationStartedAt: number | null = null;
  private streamerMapRotationInFlight = false;
  private endlessMatch = false;
  private readonly streamerObservers = new Map<string, StreamerObserverSession>();
  private recordingOptions: GameRoomRecordingOptions | null = null;
  private recordingWriter: RecordingArtifactWriter | null = null;
  private recordingStartedAtMs = 0;
  private recordingLastCheckpointAtMs = 0;
  private recordingLastStopPollAtMs = 0;
  private recordingStopPollInFlight = false;
  private recordingFinalizing = false;
  private disconnectAfterRecordingFinalizes = false;
  private roomDisposing = false;
  private battleRoyalSafeZone: BattleRoyalSafeZoneState | null = null;
  private battleRoyalDrop: BattleRoyalDropState | null = null;
  private battleRoyalCombatPrewarmTick = -1;
  private readonly battleRoyalPlacement = new BattleRoyalPlacementTracker();
  private readonly battleRoyalTeamSummarySent = new Set<Team>();
  private readonly battleRoyalDeploymentCombatInputLogAt = new Map<string, number>();
  private nextBattleRoyalSafeZoneDamageAt = 0;
  private matchMode: MatchMode = 'custom';
  private gameplayMode: GameplayMode = DEFAULT_GAMEPLAY_MODE;
  private matchPerspective: MatchPerspective = DEFAULT_MATCH_PERSPECTIVE;
  private readonly matchStartGate = new MatchStartGateTracker();
  private matchStartDeadlineAt = 0;
  private matchCancelled = false;
  private matchCancelNotice: PreMatchCancelNotice | null = null;

  async onAuth(
    client: Client,
    options: JoinOptions,
    request?: IncomingMessage
  ): Promise<GameRoomAuthBundle> {
    const auth = await resolveRoomAuthContext(options as Record<string, unknown>, request);
    const streamerTicket = verifyStreamerObserverTicket(options.streamerObserverTicket, {
      gameRoomId: this.roomId,
      adminUserId: auth.userId,
    });

    if (streamerTicket) {
      const consumed = await consumeReplayNonce('streamer_observer', streamerTicket.nonce, streamerTicket.expiresAt);
      if (!consumed) {
        this.recordAuthReject(client, 'streamer_observer_ticket_nonce_replay');
        throw new Error('Streamer observer ticket already used');
      }

      if (!(await isGameAdminUserId(auth.userId))) {
        this.recordAuthReject(client, 'streamer_observer_non_admin', { userId: auth.userId });
        throw new Error('Streamer observer access denied');
      }

      this.recordClientJoinHints(client, auth, options);
      return { auth, ticket: null, streamerTicket };
    }

    const directJoin = !this.lobbyId;
    if (directJoin && !isDirectGameRoomJoinAllowed()) {
      this.recordAuthReject(client, 'direct_join_disabled');
      throw new Error('Direct game room joins are disabled');
    }

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
        if (ticket.matchPerspective !== this.matchPerspective) {
          this.recordAuthReject(client, 'entry_ticket_perspective_mismatch', {
            lobbyId: this.lobbyId,
            ticketPerspective: ticket.matchPerspective,
            roomPerspective: this.matchPerspective,
          });
          throw new Error('Game entry ticket does not match room perspective');
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
    return { auth, ticket, streamerTicket: null };
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
      if (this.isStreamerObserverSession(client.sessionId) && !this.isStreamerObserverAllowedMessage(type)) {
        return;
      }

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

  async onCreate(options: CreateOptions) {
    this.eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
    this.eventLoopDelay.enable();
    this.lobbyId = options.lobbyId || null;
    this.lobbyName = options.lobbyName || null;
    if (this.lobbyId) {
      this.autoDispose = false;
    }
    this.matchMode = options.matchMode ?? 'custom';
    this.gameplayMode = isGameplayMode(options.gameplayMode) ? options.gameplayMode : DEFAULT_GAMEPLAY_MODE;
    this.matchPerspective = this.matchMode === 'ranked'
      ? DEFAULT_MATCH_PERSPECTIVE
      : isMatchPerspective(options.matchPerspective)
        ? options.matchPerspective
        : DEFAULT_MATCH_PERSPECTIVE;
    this.config = createGameConfigForGameplayMode(this.gameplayMode);
    this.setSeatReservationTime(readGameRoomSeatReservationSeconds());
    this.rankedEligibilityCandidate = options.rankedEligible === true;
    this.streamerManagedBotGame = options.streamerManagedBotGame === true;
    this.streamerManagedByUserId = typeof options.streamerManagedByUserId === 'string'
      ? options.streamerManagedByUserId
      : null;
    this.streamerFeedMode = typeof options.streamerFeedMode === 'string'
      ? options.streamerFeedMode
      : null;
    this.streamerCameraMode = typeof options.streamerCameraMode === 'string'
      ? options.streamerCameraMode
      : null;
    const fallbackStreamerMapRotationStartedAt = this.isStreamerBotDeathmatchFeed()
      ? Date.now()
      : null;
    this.streamerMapRotationStartedAt = typeof options.streamerMapRotationStartedAt === 'number'
      && Number.isFinite(options.streamerMapRotationStartedAt)
      ? options.streamerMapRotationStartedAt
      : fallbackStreamerMapRotationStartedAt;
    this.endlessMatch = options.endlessMatch === true;
    this.requiredHumanPlayers = Math.max(
      0,
      Math.floor(options.requiredHumanPlayers ?? (this.lobbyId ? DEFAULT_GAME_CONFIG.maxPlayers : 1))
    );
    this.rankedRequiredHumanPlayers = this.requiredHumanPlayers;
    this.reservedHumanPlayers = Math.max(0, Math.floor(options.reservedHumanPlayers ?? this.requiredHumanPlayers));
    this.capacityPlayerCost = Math.max(
      this.reservedHumanPlayers,
      Math.floor(options.capacityPlayerCost ?? this.reservedHumanPlayers)
    );
    if (options.recording) {
      this.autoDispose = false;
      this.disconnectAfterRecordingFinalizes = !this.lobbyId && this.requiredHumanPlayers === 0;
    }
    this.playerClientCapacity = Math.max(
      this.config.maxPlayers,
      this.reservedHumanPlayers + Math.max(0, options.botAssignments?.length ?? 0)
    );
    this.maxClients = this.playerClientCapacity + getStreamerObserverSeatCount();
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
    this.state.matchPerspective = this.matchPerspective;
    this.state.mapSeed = typeof options.mapSeed === 'number'
      ? options.mapSeed >>> 0
      : createRandomSeed();
    this.state.mapThemeId = options.mapThemeId ?? getVoxelMapTheme(this.state.mapSeed).id;
    this.state.mapSize = normalizeVoxelMapSizeId(options.mapSize);
    this.state.mapProfileId = options.mapProfileId ?? getGameplayModeRules(this.gameplayMode).mapProfileId;
    this.state.pregeneratedMapId = options.pregeneratedMapId ?? '';
    this.state.mapArtifactId = options.mapArtifactId ?? '';
    this.mapSelectionId = options.mapSelectionId ?? null;
    const mapManifestStartedAt = performance.now();
    try {
      await this.refreshMapManifestAsync();
      if (this.state.pregeneratedMapId) {
        await pregeneratedMapCatalogService.recordMapLaunchResult({
          mapId: this.state.pregeneratedMapId,
          selectionId: this.mapSelectionId,
          roomId: this.roomId,
          matchId: this.matchLedger.getMatchId(),
          ok: true,
        });
      }
    } catch (error) {
      loggers.room.error('Game room map manifest setup failed', {
        roomId: this.roomId,
        lobbyId: this.lobbyId,
        gameplayMode: this.gameplayMode,
        mapSeed: this.state.mapSeed,
        mapSize: this.state.mapSize,
        mapProfileId: this.state.mapProfileId,
        pregeneratedMapId: this.state.pregeneratedMapId || null,
        mapArtifactId: this.state.mapArtifactId || null,
        durationMs: Math.round(performance.now() - mapManifestStartedAt),
        error: error instanceof Error ? error.message : String(error),
      });
      if (this.state.pregeneratedMapId) {
        await pregeneratedMapCatalogService.recordMapLaunchResult({
          mapId: this.state.pregeneratedMapId,
          selectionId: this.mapSelectionId,
          roomId: this.roomId,
          matchId: this.matchLedger.getMatchId(),
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
    const mapManifestDurationMs = performance.now() - mapManifestStartedAt;
    const mapManifest = this.getMapManifest();
    this.initializeStreamSchedule(Date.now());
    const mapManifestLog = {
      roomId: this.roomId,
      lobbyId: this.lobbyId,
      gameplayMode: this.gameplayMode,
      mapSeed: this.state.mapSeed,
      mapThemeId: this.state.mapThemeId,
      mapSize: this.state.mapSize,
      mapProfileId: this.state.mapProfileId,
      pregeneratedMapId: this.state.pregeneratedMapId || null,
      mapArtifactId: this.state.mapArtifactId || null,
      durationMs: Math.round(mapManifestDurationMs),
      renderableChunkCount: mapManifest.stats.renderableChunkCount,
      colliderCount: mapManifest.stats.colliderCount,
      solidBlockCount: mapManifest.stats.solidBlocks,
      botAssignmentCount: options.botAssignments?.length ?? 0,
      capacityPlayerCost: this.capacityPlayerCost,
    };
    if (mapManifestDurationMs >= MAP_MANIFEST_SLOW_LOG_MS) {
      loggers.room.warn('Game room map manifest setup slow', mapManifestLog);
    } else {
      loggers.room.info('Game room map manifest setup complete', mapManifestLog);
    }
    resetFlagsFromManifest(this.state, mapManifest);
    this.createBotsFromAssignments(options.botAssignments || []);
    this.updateMetadata();
    if (options.recording) {
      await this.startRecording(options.recording, options);
    }
    this.startMatchStartCancelTimer();

    this.registerCoreMessageHandlers();
    if (this.isDevelopmentMode()) {
      this.registerDevelopmentMessageHandlers();
    }
    if (this.recordingWriter) {
      this.ensureTickLoopStarted();
      this.checkPhaseTransition();
    }
  }

  private ensureTickLoopStarted(): void {
    if (this.tickLoopActive) return;
    this.tickLoopActive = true;
    this.nextTickAtMs = performance.now() + TICK_INTERVAL_MS;
    this.scheduleNextTick(TICK_INTERVAL_MS);
  }

  private scheduleNextTick(delayMs: number): void {
    if (!this.tickLoopActive) return;
    this.tickTimer = setTimeout(() => this.runScheduledTick(), Math.max(0, delayMs));
  }

  private runScheduledTick(): void {
    this.tickTimer = null;
    if (!this.tickLoopActive) return;

    if (this.tickInProgress) {
      this.nextTickAtMs = performance.now() + TICK_INTERVAL_MS;
      this.scheduleNextTick(TICK_INTERVAL_MS);
      return;
    }

    const nowMs = performance.now();
    const requestedTickAtMs = this.nextTickAtMs || nowMs;
    const tickDelayMs = nowMs - requestedTickAtMs;
    const schedule = getBoundedRoomTickSchedule({
      nowMs,
      scheduledTickAtMs: requestedTickAtMs,
      tickIntervalMs: TICK_INTERVAL_MS,
      maxRetainedTicks: MAX_RETAINED_ROOM_TICKS_AFTER_STALL,
    });
    this.nextTickAtMs = schedule.scheduledTickAtMs;
    this.deferStateStreamsForCatchup = schedule.hasCatchupTick;
    if (tickDelayMs >= TICK_DELAY_WARN_MS) {
      this.logTickDelay(tickDelayMs, schedule.droppedTickCount);
    }
    this.tickInProgress = true;
    let tickCompleted = false;
    try {
      this.tick();
      tickCompleted = true;
      this.consecutiveTickErrors = 0;
    } catch (error) {
      this.handleTickError(error);
    } finally {
      if (tickCompleted && !this.deferStateStreamsForCatchup) {
        this.flushPendingCatchupStateStreams();
      }
      this.tickInProgress = false;
      if (!this.tickLoopActive) return;

      const finishedAtMs = performance.now();
      this.nextTickAtMs = schedule.nextTickAtMs;
      this.scheduleNextTick(this.nextTickAtMs - finishedAtMs);
    }
  }

  private stopTickLoop(): void {
    this.tickLoopActive = false;
    this.tickInProgress = false;
    this.nextTickAtMs = 0;
    this.deferStateStreamsForCatchup = false;
    this.pendingCatchupStateStreams = null;
    if (!this.tickTimer) return;
    clearTimeout(this.tickTimer);
    this.tickTimer = null;
  }

  private logTickDelay(delayMs: number, droppedTickCount = 0): void {
    const now = Date.now();
    if (now - this.lastTickDelayLoggedAtMs < TICK_DELAY_LOG_SAMPLE_MS) return;
    this.lastTickDelayLoggedAtMs = now;

    loggers.room.warn('Game room tick delayed', {
      roomId: this.roomId,
      lobbyId: this.lobbyId,
      phase: this.state.phase,
      tick: this.state.tick,
      delayMs: Math.round(delayMs),
      droppedTickCount,
      tickIntervalMs: TICK_INTERVAL_MS,
      eventLoopDelayP99Ms: this.eventLoopDelay ? Math.round(this.eventLoopDelay.percentile(99) / 1_000_000) : 0,
      serverTime: this.state.serverTime || now,
    });
  }

  private handleTickError(error: unknown): void {
    this.consecutiveTickErrors++;
    const now = Date.now();
    if (now - this.lastTickErrorLoggedAtMs >= TICK_ERROR_LOG_SAMPLE_MS) {
      this.lastTickErrorLoggedAtMs = now;
      loggers.room.error('Game room tick failed', {
        roomId: this.roomId,
        consecutiveTickErrors: this.consecutiveTickErrors,
        error,
      });
    }

    if (this.consecutiveTickErrors < MAX_CONSECUTIVE_TICK_ERRORS) return;

    loggers.room.error('Game room stopped after repeated tick failures', {
      roomId: this.roomId,
      consecutiveTickErrors: this.consecutiveTickErrors,
    });
    if (this.recordingWriter) {
      this.finalizeRecording('failed', 'repeated_tick_failures');
    }
    this.stopTickLoop();
    this.disconnect();
  }

  private registerCoreMessageHandlers(): void {
    this.onRateLimitedMessage('movementCommands', GAME_MESSAGE_RATE_LIMITS.movementCommands, (client, packet: MovementCommandPacket) => {
      this.handleMovementCommandPacket(client, packet);
    });

    this.onRateLimitedMessage('selectTeam', GAME_MESSAGE_RATE_LIMITS.selection, (client, data: unknown) => {
      const team = validateTeamPayload(data);
      if (!team) return;
      this.handleTeamSelect(client, team);
    });

    this.onRateLimitedMessage('setPhantomPrimarySkill', GAME_MESSAGE_RATE_LIMITS.selection, (client, data: unknown) => {
      if (!isRecord(data) || !isPhantomPrimarySkill(data.skill)) return;
      this.handleSetPhantomPrimarySkill(client, data.skill);
    });

    this.onRateLimitedMessage('setPhantomSecondarySkill', GAME_MESSAGE_RATE_LIMITS.selection, (client, data: unknown) => {
      if (!isRecord(data) || !isPhantomSecondarySkill(data.skill)) return;
      this.handleSetPhantomSecondarySkill(client, data.skill);
    });

    this.onRateLimitedMessage('setBlazePrimarySkill', GAME_MESSAGE_RATE_LIMITS.selection, (client, data: unknown) => {
      if (!isRecord(data) || !isBlazePrimarySkill(data.skill)) return;
      this.handleSetBlazePrimarySkill(client, data.skill);
    });

    this.onRateLimitedMessage('setBlazeSecondarySkill', GAME_MESSAGE_RATE_LIMITS.selection, (client, data: unknown) => {
      if (!isRecord(data) || !isBlazeSecondarySkill(data.skill)) return;
      this.handleSetBlazeSecondarySkill(client, data.skill);
    });

    this.onRateLimitedMessage('setBlazeUltimateSkill', GAME_MESSAGE_RATE_LIMITS.selection, (client, data: unknown) => {
      if (!isRecord(data) || !isBlazeUltimateSkill(data.skill)) return;
      this.handleSetBlazeUltimateSkill(client, data.skill);
    });

    this.onRateLimitedMessage('setBlazeAbilityBindings', GAME_MESSAGE_RATE_LIMITS.selection, (client, data: unknown) => {
      if (!isBlazeAbilityBindings(data)) return;
      this.handleSetBlazeAbilityBindings(client, data);
    });

    this.onRateLimitedMessage('matchSceneReady', GAME_MESSAGE_RATE_LIMITS.matchSceneReady, (client, data: unknown) => {
      this.handleMatchSceneReady(client, data);
    });

    this.onRateLimitedMessage('requestUnstuck', GAME_MESSAGE_RATE_LIMITS.unstuck, (client) => {
      this.handleUnstuckRequest(client);
    });

    this.onRateLimitedMessage('mapPing', GAME_MESSAGE_RATE_LIMITS.mapPing, (client, data: unknown) => {
      this.handleMapPing(client, data);
    });

    this.onRateLimitedMessage('chat', GAME_MESSAGE_RATE_LIMITS.chat, (client, data: unknown) => {
      const chat = validateChatPayload(data, { teamOnly: true });
      if (!chat) return;
      this.handleChat(client, chat.message, chat.teamOnly);
    });

    this.onRateLimitedMessage('refreshPlayerName', GAME_MESSAGE_RATE_LIMITS.profile, (client) => {
      void this.handleRefreshPlayerName(client).catch((error) => {
        loggers.room.warn('Failed to refresh game player name', {
          roomId: this.roomId,
          sessionId: client.sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
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

    this.onRateLimitedMessage('streamerHeartbeat', GAME_MESSAGE_RATE_LIMITS.playerPingResponse, (client) => {
      this.handleStreamerHeartbeat(client);
    });

    this.onRateLimitedMessage('streamerObserverReady', GAME_MESSAGE_RATE_LIMITS.playerPingResponse, (client) => {
      this.handleStreamerObserverReady(client);
    });
  }

  private async handleRefreshPlayerName(client: Client): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    const authContext = this.participantRegistry.getAuthContext(client.sessionId);
    if (!player || player.isBot || !authContext) return;

    const displayName = await refreshRoomAuthDisplayName(authContext);
    if (!displayName) return;

    player.name = displayName;
    this.syncReconnectParticipantFromPlayer(player);
  }

  private handleSetBlazePrimarySkill(client: Client, skill: BlazePrimarySkill): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.isBot || this.blazePrimarySkills.has(player.id)) return;

    this.blazePrimarySkills.set(player.id, skill);
    if (player.heroId !== 'blaze') return;

    this.resetPrimaryMagazineForHero(player.id, player.heroId);
  }

  private handleSetPhantomPrimarySkill(client: Client, skill: PhantomPrimarySkill): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.isBot || this.phantomPrimarySkills.has(player.id)) return;

    this.phantomPrimarySkills.set(player.id, skill);
    if (player.heroId === 'phantom') {
      this.resetPrimaryMagazineForHero(player.id, player.heroId);
    }
  }

  private handleSetPhantomSecondarySkill(client: Client, skill: PhantomSecondarySkill): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.isBot || this.phantomSecondarySkills.has(player.id)) return;

    this.phantomSecondarySkills.set(player.id, skill);
    this.phantomVoidRayCharges.clear(player.id);
    this.phantomRiftBolts.clear(player.id);
  }

  private handleSetBlazeSecondarySkill(client: Client, skill: BlazeSecondarySkill): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.isBot || this.blazeSecondarySkills.has(player.id)) return;

    this.blazeSecondarySkills.set(player.id, skill);
  }

  private handleSetBlazeUltimateSkill(client: Client, skill: BlazeUltimateSkill): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.isBot || this.blazeUltimateSkills.has(player.id)) return;

    this.blazeUltimateSkills.set(player.id, skill);
    if (player.heroId === 'blaze') {
      reconcilePlayerAbilities(player, 'blaze', this.getBlazeAbilitySelection(player.id));
    }
  }

  private handleSetBlazeAbilityBindings(client: Client, bindings: BlazeAbilityBindings): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.isBot || this.blazeAbilityBindings.has(player.id)) return;

    const runtimeBindings = hasBlazeAfterburner(bindings) ? bindings : null;
    if (!runtimeBindings) return;

    this.blazeAbilityBindings.set(player.id, { ...runtimeBindings });
    if (player.heroId === 'blaze') {
      reconcilePlayerAbilities(player, 'blaze', this.getBlazeAbilitySelection(player.id));
    }
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
    this.onParsedDevCommand(
      'devSetSkin',
      validateSkinPayload,
      (client, skinId) => this.handleDevSetSkin(client, skinId),
      {
        logMessage: 'Failed to apply dev skin switch:',
        clientMessage: 'Failed to switch skin',
      }
    );
    this.onParsedDevCommand('devDownHero', validateHeroPayload, (client, heroId) => {
      this.handleDevDownHero(client, heroId);
    });

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

    const authBundle = (client as Client & { auth?: GameRoomAuthBundle }).auth;
    const authContext = authBundle?.auth;
    if (!authContext) {
      client.send('error', { message: 'Authentication required' });
      client.leave();
      return;
    }

    if (authBundle.streamerTicket) {
      this.joinStreamerObserver(client, authBundle.streamerTicket);
      return;
    }

    if (this.lobbyId && !this.autoDispose) {
      this.autoDispose = true;
    }
    const entryTicket = authBundle?.ticket ?? null;

    this.participantRegistry.setSession(client.sessionId, authContext, entryTicket);

    if (authContext.userId) {
      this.disconnectDuplicateIdentitySession(client.sessionId, authContext.userId);
      this.clientRegistry.setIdentity(authContext.userId, client.sessionId);
    }

    if (shouldRejectRoomJoinForCapacity({
      playerCount: this.state.players.size,
      maxPlayers: this.playerClientCapacity,
    })) {
      client.send('error', { message: 'Game room is full' });
      this.participantRegistry.clearSession(client.sessionId);
      this.clientRegistry.clearIdentityForSession(client.sessionId);
      client.leave();
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
    this.ensureTickLoopStarted();

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
    this.sendBattleRoyalCompletedTeamSummaryToClient(client, player.team);
    this.requestPlayerPing(client, Date.now());

    // Check if we should start hero select
    this.checkPhaseTransition();
  }

  private joinStreamerObserver(client: Client, streamerTicket: StreamerObserverTicketClaims): void {
    const streamerSeatCount = getStreamerObserverSeatCount();
    if (this.streamerObservers.size >= streamerSeatCount) {
      client.send('error', { message: 'Streamer observer seats are full' });
      client.leave();
      return;
    }

    const now = Date.now();
    this.streamerObservers.set(client.sessionId, {
      adminUserId: streamerTicket.adminUserId,
      joinedAt: now,
      lastHeartbeatAt: now,
    });
    this.clientRegistry.setClient(client.sessionId, client);
    this.updateMetadata();
    this.ensureTickLoopStarted();

    client.send('streamerObserverJoined', {
      roomId: this.roomId,
      sessionId: client.sessionId,
      streamerObserverCount: this.streamerObservers.size,
      streamerObserverSeatCount: streamerSeatCount,
      streamerManagedBotGame: this.streamerManagedBotGame,
      streamerFeedMode: this.streamerFeedMode,
      streamerCameraMode: this.streamerCameraMode,
      endlessMatch: this.endlessMatch,
    });
    this.sendCurrentSnapshots(client);

    loggers.room.info('Streamer observer join complete', {
      sessionId: client.sessionId,
      adminUserId: streamerTicket.adminUserId,
      streamerObserverCount: this.streamerObservers.size,
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
    player.role = getPlayerRole(entryTicket);
    if (isObserverPlayer(player)) {
      player.team = '';
      player.heroId = '';
      player.skinId = '';
      player.state = 'spectating';
      player.isReady = true;
      player.isBot = false;
      player.botDifficulty = '';
      player.botProfileId = '';
      applyRoomRankState(player, toPublicRankSnapshot(authContext.rank));
      this.assignPlayerSpawnPosition(player);
      player.position.y += 12;
      return player;
    }

    player.team = resolveRoomJoinTeam({
      players: this.state.players.values(),
      teamIds: this.getAssignableTeamIds(),
      maxTeamSize: this.config.teamSize,
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
      this.setPlayerHero(player, entryTicket.selectedHero, entryTicket.selectedSkinId);
    }
    if (
      this.state.phase === 'playing' &&
      isBattleRoyalMode(this.gameplayMode) &&
      this.hasBattleRoyalTeamCompleted(player.team)
    ) {
      player.state = 'dead';
      player.respawnTime = 0;
      return player;
    }
    if (
      this.state.phase === 'deployment' &&
      isBattleRoyalMode(this.gameplayMode) &&
      player.heroId
    ) {
      player.state = 'dropping';
      this.addPlayerToBattleRoyalDeployment(player);
      return player;
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
      this.markMatchParticipantLeftIfIncomplete(oldPlayer);
    }
    if (oldPlayer?.hasFlag) {
      this.dropFlag(oldPlayer);
    }
    if (oldPlayer) {
      const leaveNow = Date.now();
      this.battleRoyalDownedRuntime.clearPlayer(
        oldPlayer,
        leaveNow,
        oldPlayer.state === 'downed' ? 'target_removed' : 'reviver_removed'
      );
      this.battleRoyalSouls.dropCarriedSouls(oldPlayer, leaveNow);
      this.battleRoyalSouls.clearPlayer(oldPlayer.id);
    }
    this.state.players.delete(existingSessionId);
    const clearedMapPing = this.activeMapPings.delete(existingSessionId);
    this.clearCombatPlayerRuntimeState(existingSessionId);
    this.clientRegistry.clearSession(existingSessionId);
    this.participantRegistry.clearSession(existingSessionId);
    this.rateLimiter.clearScope(existingSessionId);
    this.clearPlayerReplicationState(existingSessionId);
    this.resetCountdownStartGate();
    this.broadcastTracked('playerLeft', { playerId: existingSessionId });
    if (clearedMapPing) this.broadcastMapPings();
  }

  onLeave(client: Client, consented: boolean) {
    const streamerObserver = this.streamerObservers.get(client.sessionId);
    if (streamerObserver) {
      this.streamerObservers.delete(client.sessionId);
      this.clientRegistry.deleteClient(client.sessionId);
      this.rateLimiter.clearScope(client.sessionId);
      this.updateMetadata();
      loggers.room.info('Streamer observer left', {
        sessionId: client.sessionId,
        adminUserId: streamerObserver.adminUserId,
        consented,
        streamerObserverCount: this.streamerObservers.size,
      });
      return;
    }

    loggers.room.info('Player left', client.sessionId, 'consented', consented);

    const player = this.state.players.get(client.sessionId);

    void this.removeVoiceParticipantForPlayer(client.sessionId, normalizeVoiceTeam(player?.team), consented ? 'leave' : 'disconnect');

    // Handle flag drop if carrying
    if (player?.hasFlag) {
      this.dropFlag(player);
    }
    if (player) {
      this.markMatchParticipantLeftIfIncomplete(player);
      const leaveNow = Date.now();
      this.battleRoyalDownedRuntime.clearPlayer(
        player,
        leaveNow,
        player.state === 'downed' ? 'target_removed' : 'reviver_removed'
      );
      this.battleRoyalSouls.dropCarriedSouls(player, leaveNow);
      this.battleRoyalSouls.clearPlayer(player.id);
    }

    this.state.players.delete(client.sessionId);
    const clearedMapPing = this.activeMapPings.delete(client.sessionId);
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
    if (clearedMapPing) this.broadcastMapPings();
    this.broadcastStateStreams({ transforms: false, forceVitals: true, forceMatch: true });

    // Check if game should end
    this.checkPhaseTransition();
  }

  private clearCombatPlayerRuntimeState(playerId: string): void {
    this.playerPressStates.clear(playerId);
    this.phantomPrimaryMagazines.clear(playerId);
    this.phantomSoulrendPrimaryMagazines.clear(playerId);
    this.phantomPrimarySkills.delete(playerId);
    this.phantomSecondarySkills.delete(playerId);
    this.blazePrimaryMagazines.clear(playerId);
    this.blazeScrapshotPrimaryMagazines.clear(playerId);
    this.blazePrimarySkills.delete(playerId);
    this.blazeSecondarySkills.delete(playerId);
    this.blazeUltimateSkills.delete(playerId);
    this.blazeAbilityBindings.delete(playerId);
    this.stopBlazeAfterburnerDash(playerId);
    this.blazePhoenixDives.delete(playerId);
    this.chronosPrimaryMagazines.clear(playerId);
    this.clearPrimaryHoldStates(playerId);
    this.phantomVoidRayCharges.clear(playerId);
    this.phantomRiftBolts.clear(playerId);
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
    if (this.battleRoyalDrop) {
      removeBattleRoyalDropParticipant(this.battleRoyalDrop, playerId);
    }
  }

  onDispose() {
    this.roomDisposing = true;
    loggers.room.info('Room disposing', this.roomId);
    void pregeneratedMapCatalogService.releaseMapAfterLaunch({
      mapId: this.state?.pregeneratedMapId || null,
      roomId: this.roomId,
      matchId: this.matchLedger.getMatchId(),
    });
    this.clearMatchStartCancelTimer();
    this.clearMatchCancelDisconnectTimer();
    this.eventLoopDelay?.disable();
    this.roomTimeouts.clear();
    this.antiCheat?.flushAggregates();
    void this.antiCheatEvidenceStore.flush();
    if (this.recordingWriter) {
      this.finalizeRecording('failed', 'room_disposed');
    }
    this.state.players.forEach((player, playerId) => {
      if (!player.isBot) {
        void this.removeVoiceParticipantForPlayer(playerId, normalizeVoiceTeam(player.team), 'room_dispose');
      }
    });
    this.stopTickLoop();
    this.blazeLingeringAreas.clear();
    this.blazeAfterburnerTrails.clear();
    this.blazePhoenixDives.clear();
    this.blazeAfterburnerDashes.clear();
    this.blazeFlamethrowers.clearDamageTicks();
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

  private initializeStreamSchedule(now: number): void {
    const seed = hashString(`${this.roomId}:${this.state.mapSeed}`);
    this.streamScheduleStartedAt = now;
    this.vitalsPhaseAtMs = now + (seed % PLAYER_VITALS_INTERVAL_MS);
    this.interestPhaseAtMs = now + ((seed + Math.floor(PLAYER_INTEREST_INTERVAL_MS / 2)) % PLAYER_INTEREST_INTERVAL_MS);
    this.pingProbePhaseAtMs = now + ((seed + 997) % DEFAULT_PLAYER_PING_INTERVAL_MS);
    this.pingBroadcastPhaseAtMs = now + ((seed + 53) % PLAYER_PING_BROADCAST_INTERVAL_MS);
    this.matchSnapshotPhaseAtMs = now + ((seed + 131) % MATCH_SNAPSHOT_DRIFT_SYNC_INTERVAL_MS);
    this.lastVitalsBroadcastAt = getPreviousPhasedIntervalTime(now, PLAYER_VITALS_INTERVAL_MS, this.vitalsPhaseAtMs);
    this.lastInterestBroadcastAt = getPreviousPhasedIntervalTime(now, PLAYER_INTEREST_INTERVAL_MS, this.interestPhaseAtMs);
    this.lastPingProbeAt = getPreviousPhasedIntervalTime(now, DEFAULT_PLAYER_PING_INTERVAL_MS, this.pingProbePhaseAtMs);
    this.lastPingBroadcastAt = getPreviousPhasedIntervalTime(now, PLAYER_PING_BROADCAST_INTERVAL_MS, this.pingBroadcastPhaseAtMs);
    this.lastMatchSnapshotBroadcastAt = getPreviousPhasedIntervalTime(
      now,
      MATCH_SNAPSHOT_DRIFT_SYNC_INTERVAL_MS,
      this.matchSnapshotPhaseAtMs
    );
  }

  private measureTickSpan<T>(spanName: RoomTickSpanName, run: () => T): T {
    const startedAt = performance.now();
    try {
      return run();
    } finally {
      this.tickProfiler.recordSpan(spanName, performance.now() - startedAt);
    }
  }

  private buildMatchCancelledPayload(notice: PreMatchCancelNotice): Record<string, unknown> {
    return buildMatchCancelledPayload({
      notice,
      roomId: this.roomId,
      requiredHumanPlayers: this.requiredHumanPlayers,
      connectedHumanPlayers: this.getConnectedHumanPlayerCount(),
      deadlineAt: this.matchStartDeadlineAt,
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
      blockedPlayerId: this.matchCancelNotice.blockedPlayerId,
      networkQuality: this.matchCancelNotice.networkQuality,
    });

    this.broadcastTracked('matchCancelled', this.buildMatchCancelledPayload(this.matchCancelNotice));

    this.matchCancelDisconnectTimeout = setTimeout(() => {
      this.disconnect();
    }, MATCH_CANCEL_DISCONNECT_DELAY_MS);
    this.matchCancelDisconnectTimeout.unref?.();
  }

  private tick() {
    const tickStartedAt = performance.now();
    this.tickProfiler.beginTick();
    this.resetEventReplicationFrameContext();
    this.discardDeferredTrackedMessages();
    let tickCompleted = false;
    try {
      this.state.tick++;
      this.state.serverTime = Date.now();
      const dt = TICK_INTERVAL_MS / 1000;
      this.measureTickSpan('spatial_index_rebuild', () => this.rebuildPlayerSpatialIndex());
      this.updateBots(this.state.serverTime, dt);
      if (this.pruneExpiredMapPings(this.state.serverTime)) {
        this.broadcastMapPings();
      }

      // Update based on phase
      switch (this.state.phase) {
        case 'hero_select':
          let shouldBroadcastHeroSelectState = false;
          let shouldCheckHeroSelectTransition = false;
          this.measureTickSpan('phase_gameplay_update', () => {
            const lowFrequencyStateDue = this.state.serverTime - this.lastLowFrequencyStateAt >= LOW_FREQUENCY_STATE_INTERVAL_MS;
            shouldCheckHeroSelectTransition = shouldRunHeroSelectPhaseTransitionCheck({
              lowFrequencyStateDue,
              phaseEndTime: this.state.phaseEndTime,
              now: this.state.serverTime,
            });
            if (lowFrequencyStateDue) {
              this.lastLowFrequencyStateAt = this.state.serverTime;
              shouldBroadcastHeroSelectState = true;
            }
          });
          if (shouldCheckHeroSelectTransition) {
            this.checkPhaseTransition();
          }
          if (shouldBroadcastHeroSelectState && this.state.phase === 'hero_select') {
            this.broadcastStateStreams({ transforms: false });
          }
          break;
        case 'countdown':
          this.measureTickSpan('phase_gameplay_update', () => this.updateCountdown());
          this.updatePhysics();
          this.broadcastStateStreams({ transforms: true });
          break;
        case 'deployment':
          this.updateBattleRoyalDeployment();
          break;
        case 'playing':
          this.updatePlaying();
          break;
        case 'round_end':
          let shouldBroadcastRoundEndState = false;
          this.measureTickSpan('phase_gameplay_update', () => {
            this.updateRoundEnd();
            if (this.state.serverTime - this.lastLowFrequencyStateAt >= LOW_FREQUENCY_STATE_INTERVAL_MS) {
              this.lastLowFrequencyStateAt = this.state.serverTime;
              shouldBroadcastRoundEndState = true;
            }
          });
          if (shouldBroadcastRoundEndState) {
            this.broadcastStateStreams({ transforms: false });
          }
          break;
      }
      tickCompleted = true;
    } finally {
      if (tickCompleted) {
        this.flushDeferredTrackedMessages();
      } else {
        this.discardDeferredTrackedMessages();
      }
      this.resetEventReplicationFrameContext();
      const tickDurationMs = performance.now() - tickStartedAt;
      this.tickProfiler.endTick(tickDurationMs);
      this.roomMetrics.recordTickDuration(tickDurationMs);
      if (tickCompleted) {
        this.updateRecordingLifecycle();
      }
    }
  }

  private rebuildPlayerSpatialIndex(): void {
    this.playerSpatialIndex.rebuild(this.state.players.values());
    this.playerSpatialIndexDirty = false;
  }

  private markPlayerSpatialIndexDirty(): void {
    this.playerSpatialIndexDirty = true;
  }

  private ensurePlayerSpatialIndexFresh(): void {
    if (this.playerSpatialIndexDirty) {
      this.rebuildPlayerSpatialIndex();
    }
  }

  private getAlivePlayers(): Player[] {
    this.ensurePlayerSpatialIndexFresh();
    return this.playerSpatialIndex.getAlivePlayers();
  }

  private getEnemyPlayers(team: Team): Player[] {
    this.ensurePlayerSpatialIndexFresh();
    return this.playerSpatialIndex.getEnemyPlayers(team);
  }

  private getTeamPlayers(team: Team): Player[] {
    this.ensurePlayerSpatialIndexFresh();
    return this.playerSpatialIndex.getTeamPlayers(team);
  }

  private queryPlayersRadius(
    center: { x: number; z: number },
    radius: number,
    options: PlayerSpatialQueryOptions = {}
  ): Player[] {
    this.ensurePlayerSpatialIndexFresh();
    return this.playerSpatialQueries.queryRadius(center, radius, options);
  }

  private queryPlayersRadiusInto(
    center: { x: number; z: number },
    radius: number,
    out: Player[],
    options: PlayerSpatialQueryOptions = {}
  ): Player[] {
    this.ensurePlayerSpatialIndexFresh();
    return this.playerSpatialIndex.queryRadius(center, radius, out, options);
  }

  private queryPlayersConeCandidates(
    origin: { x: number; z: number },
    range: number,
    options: PlayerSpatialQueryOptions = {}
  ): Player[] {
    this.ensurePlayerSpatialIndexFresh();
    return this.playerSpatialQueries.queryConeCandidates(origin, range, options);
  }

  private updateCountdown() {
    if (hasPhaseDeadlineElapsed(this.state.phaseEndTime, Date.now())) {
      if (isBattleRoyalMode(this.gameplayMode)) {
        this.startBattleRoyalDeployment();
        return;
      }
      this.startPlaying();
    }
  }

  private isBattleRoyalDeploymentPhase(): boolean {
    return isBattleRoyalMode(this.gameplayMode) && this.state.phase === 'deployment';
  }

  private isBattleRoyalActiveCombatPhase(): boolean {
    return isBattleRoyalMode(this.gameplayMode) && this.state.phase === 'playing';
  }

  private updateActivePlayerRuntimes(now: number, dt: number): void {
    if (isBattleRoyalMode(this.gameplayMode)) {
      this.battleRoyalDownedRuntime.update(this.state.players.values(), now);
      this.updateBattleRoyalSouls(now);
    }

    this.state.players.forEach(player => {
      if (player.state === 'dead') {
        if (this.isBattleRoyalActiveCombatPhase()) {
          player.respawnTime = 0;
          return;
        }
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

      updateAbilityCooldowns(player, dt, abilityTempoMultiplier);
      this.updateTimeScaledSkillTimers(player, dt, abilityTempoMultiplier, now);

      if (player.ultimateCharge < 100) {
        player.ultimateCharge = Math.min(
          100,
          player.ultimateCharge + ULTIMATE_CHARGE_PER_SECOND * dt * chronosTempoMultiplier
        );
      }

      updateActiveAbilities(player, now);
      this.syncChronosAscendantMovementState(player, now);
    });
    this.updateChronosAegisShields(dt);
    this.playerRoots.clearExpired(now);
  }

  private updateBattleRoyalSouls(now: number): void {
    if (!isBattleRoyalMode(this.gameplayMode) || this.state.phase !== 'playing') return;

    const result = this.battleRoyalSouls.update(
      this.state.players,
      this.getBattleRoyalSummoningCircles(),
      now
    );
    if (result.completedSummons.length === 0) return;

    for (const completion of result.completedSummons) {
      this.completeBattleRoyalSoulSummon(completion);
    }
  }

  private completeBattleRoyalSoulSummon(completion: BattleRoyalSoulSummonCompletion): void {
    const circle = this.getBattleRoyalSummoningCircles().find((candidate) => candidate.id === completion.circleId);
    if (!circle) return;

    let revivedCount = 0;
    for (const soul of completion.souls) {
      const player = this.state.players.get(soul.playerId) ?? null;
      if (!player) continue;
      if (player.state !== 'dead') continue;
      if (player.team !== soul.team) continue;
      this.prepareBattleRoyalSoulSummonedPlayer(
        player,
        circle,
        revivedCount,
        completion.souls.length,
        completion.completedAt
      );
      revivedCount++;
    }

    if (revivedCount > 0) {
      this.broadcastStateStreams({ transforms: true, forceTransforms: true, forceVitals: true, forceMatch: true });
    }
  }

  private prepareBattleRoyalSoulSummonedPlayer(
    player: Player,
    circle: MapSummoningCircle,
    index: number,
    total: number,
    now: number
  ): void {
    const resetPlan = applyPlayerAliveRuntimeReset(player, {
      now,
      spawnProtectionMs: 0,
      resetRespawnTime: true,
    });
    player.health = Math.min(player.maxHealth, BATTLE_ROYAL_REVIVED_HEALTH);
    this.initializeBattleRoyalBodyShield(player);
    this.resetPlayerLifeRuntime(player, now);
    this.placePlayerAtBattleRoyalSummoningCircle(player, circle, index, total);

    if (resetPlan.resetPrimaryMagazine) {
      this.resetPrimaryMagazineForHero(player.id, player.heroId);
    }
    if (resetPlan.clearChronosAegisShield) {
      this.chronosAegisShields.clear(player.id);
    }
    if (resetPlan.resetBotBrain) {
      this.botRuntime.setBrain(player.id, this.createBotBrain(player, hashString(player.id), {
        now,
        staggerInitialSchedule: true,
      }));
    }
    if (resetPlan.resetAbilityCooldowns) {
      resetAbilityCooldowns(player);
    }
  }

  private updateActiveGameplayEffects(now: number, dt: number): void {
    this.updateVoidZones(now);
    this.updatePhantomRiftBolts(now);

    this.updatePendingAreaDamage(now);
    this.updateBlazeLingeringAreas(now);
    this.updateBlazeAfterburnerTrails(now);
    this.cleanupDamageWindows(now);

    this.updateBlazeFlamethrowers(now, dt);
    this.updateBlazeBurns(now);
    this.playerCombatActivity.updateOutOfCombatHealthRegens(this.state.players.values(), now, dt);
  }

  private updatePostMovementGameplaySystems(now: number): void {
    this.updateBlazeAfterburnerDashEmitters(now);
    this.updateBlazePhoenixDives(now);
    this.updatePowerupPickups(now);

    if (isCaptureTheFlagMode(this.gameplayMode)) {
      this.updateCTFObjectives(now);
    }
  }

  private updatePlaying() {
    const now = Date.now();
    const dt = TICK_INTERVAL_MS / 1000;

    if (this.rotateStreamerBotDeathmatchMapIfDue(now)) {
      return;
    }

    this.measureTickSpan('phase_gameplay_update', () => {
      // Update round timer
      if (!this.endlessMatch && this.state.roundStartTime && !this.devRuntime.isGameClockFrozen()) {
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

      this.updateActivePlayerRuntimes(now, dt);
    });

    this.measureTickSpan('powerups_objectives_effects', () => {
      this.updateActiveGameplayEffects(now, dt);
    });

    this.updatePhysics();

    this.measureTickSpan('powerups_objectives_effects', () => {
      this.updatePostMovementGameplaySystems(now);
    });

    this.updateBattleRoyalSafeZone(now);
    this.updateBattleRoyalPlacement(now);
    this.flushDeferredTrackedMessages();
    this.checkBattleRoyalWinCondition();
    this.flushDeferredTrackedMessages();

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

    for (const player of this.getAlivePlayers()) {
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

  private resetEventReplicationFrameContext(): void {
    this.eventReplicationFrameContext = null;
    this.eventReplicationFrameContextTick = -1;
    this.eventReplicationFrameContextNow = 0;
  }

  private getEventReplicationFrameContext(now = this.state.serverTime || Date.now()): ReplicationFrameContext {
    if (
      !this.eventReplicationFrameContext ||
      this.eventReplicationFrameContextTick !== this.state.tick ||
      this.eventReplicationFrameContextNow !== now
    ) {
      this.eventReplicationFrameContext = this.buildReplicationFrameContext(now);
      this.eventReplicationFrameContextTick = this.state.tick;
      this.eventReplicationFrameContextNow = now;
    }
    return this.eventReplicationFrameContext;
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
    interest?: RecipientInterestDecision,
    frameContext?: ReplicationFrameContext
  ): boolean {
    if (!recipient) return true;
    if (recipient.id === targetId) return true;
    if (isObserverPlayer(recipient)) return true;
    if (recipient.team === target.team) return true;
    if (isBattleRoyalMode(this.gameplayMode) && recipient.state === 'dead') return false;
    return (interest ?? this.getRecipientInterest(recipient, target, now, frameContext)).state === 'visible';
  }

  private isVisibleAbilityActive(player: Player): boolean {
    for (const ability of player.abilities.values()) {
      if (ability.isActive) return true;
    }
    return false;
  }

  private shouldSendFullRateTransform(id: string, player: Player, now: number): boolean {
    return (
      player.state === 'dropping' ||
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
    now: number,
    frameContext?: ReplicationFrameContext
  ): boolean {
    if (
      frameContext
        ? frameContext.fullRateTransformPlayerIds.has(targetId)
        : this.shouldSendFullRateTransform(targetId, target, now)
    ) return true;
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
      role: getPlayerRole(player),
      team: player.team as Team,
      heroId: (player.heroId || null) as HeroId | null,
      skinId: (player.skinId || null) as HeroSkinId | null,
      state: player.state as PlayerVitalsSnapshot['state'],
      isReady: player.isReady,
      isBot: player.isBot,
      botDifficulty: player.botDifficulty ? normalizeBotDifficulty(player.botDifficulty) : undefined,
      botProfileId: player.botProfileId || undefined,
      rank: buildRoomRankSnapshot(player),
      health: player.health,
      maxHealth: player.maxHealth,
      shield: player.shield,
      maxShield: player.maxShield,
      downedHealth: player.downedHealth || null,
      downedMaxHealth: player.downedMaxHealth || null,
      downedStartedAt: player.downedStartedAt || null,
      downedRemainingMs: player.downedRemainingMs || null,
      downedExpiresAt: player.downedExpiresAt || null,
      reviveStartedAt: player.reviveStartedAt || null,
      reviveCompletesAt: player.reviveCompletesAt || null,
      reviveByPlayerId: player.reviveByPlayerId || null,
      knockdownShieldHealth: player.knockdownShieldHealth || null,
      knockdownShieldMaxHealth: player.knockdownShieldMaxHealth || null,
      knockdownShieldActive: player.knockdownShieldActive,
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
      role: getPlayerRole(player),
      team: player.team as Team,
      heroId: (player.heroId || null) as HeroId | null,
      skinId: (player.skinId || null) as HeroSkinId | null,
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
    const shouldRestrictBattleRoyalSpectator = recipient
      && isBattleRoyalMode(this.gameplayMode)
      && recipient.state === 'dead'
      && !isObserverPlayer(recipient)
      && recipient.id !== id
      && recipient.team !== player.team;
    const shouldResolveInterest = recipient
      && !isObserverPlayer(recipient)
      && recipient.id !== id
      && recipient.team !== player.team;
    const visibility = shouldRestrictBattleRoyalSpectator
      ? 'hidden'
      : shouldResolveInterest
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

  private buildMatchSnapshot(recipient: Player | null = null): MatchSnapshotMessage {
    const battleRoyalSoulTeam = recipient && !isObserverPlayer(recipient)
      ? (recipient.team as Team)
      : null;

    return this.matchSnapshots.buildSnapshot({
      tick: this.state.tick,
      serverTime: this.state.serverTime,
      phase: this.state.phase as MatchSnapshotMessage['phase'],
      gameplayMode: this.gameplayMode,
      matchPerspective: this.matchPerspective,
      mapSeed: this.state.mapSeed,
      mapThemeId: this.state.mapThemeId as VoxelMapTheme['id'],
      mapSize: this.state.mapSize as VoxelMapSizeId,
      mapProfileId: this.state.mapProfileId as MapProfileId,
      pregeneratedMapId: this.state.pregeneratedMapId || null,
      mapArtifactId: this.state.mapArtifactId || null,
      redScore: this.state.redTeam.score,
      blueScore: this.state.blueTeam.score,
      redFlag: getFlagSync(this.state, 'red'),
      blueFlag: getFlagSync(this.state, 'blue'),
      roundTimeRemaining: this.state.roundTimeRemaining,
      phaseEndTime: this.state.phaseEndTime || null,
      gameClockFrozen: this.devRuntime.isGameClockFrozen(),
      safeZone: this.battleRoyalSafeZone,
      battleRoyalDrop: this.battleRoyalDrop
        ? buildBattleRoyalDropSnapshot(this.battleRoyalDrop, this.state.serverTime || Date.now())
        : null,
      battleRoyalSouls: isBattleRoyalMode(this.gameplayMode)
        ? this.battleRoyalSouls.buildSnapshot(battleRoyalSoulTeam)
        : null,
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
    });
    let goldenBiomeRewardLamports = '0';
    if (this.matchMode === 'ranked' && this.state.mapThemeId === 'golden') {
      try {
        goldenBiomeRewardLamports = getWagerRuntimeConfig().goldenBiomeWinnerRewardLamports.toString();
      } catch {
        goldenBiomeRewardLamports = '0';
      }
    }
    let rankedPreview: RankedSummaryPreviewInput | undefined;
    if (ledger && ledger.state === 'active') {
      const participants = this.buildMatchParticipantSnapshots(ledger);
      const rosterCounts = this.getCombatRosterCountsForRanking();
      rankedPreview = {
        participants,
        rankedUserStates: buildRankedUserStatesFromAuthContexts(this.participantRegistry.getAuthContexts()),
        rankedEligible: this.isFinalRankedEligible(
          ledger,
          participants,
          forcedByPlayerId
        ),
        rankedHoldRequired: integrityGate?.rankedHoldRequired === true,
        gameplayMode: this.gameplayMode,
        ...rosterCounts,
      };
    }

    return this.matchSummary.buildGameEndEvent({
      matchMode: this.matchMode,
      gameplayMode: this.gameplayMode,
      matchPerspective: this.matchPerspective,
      winningTeam,
      finalScore,
      matchId: this.matchLedger.getMatchId(),
      startedAt,
      endedAt,
      forcedByPlayerId,
      players: this.state.players,
      integrityGate,
      mapThemeId: this.state.mapThemeId,
      goldenBiomeRewardLamports,
      rankedPreview,
    });
  }

  private buildBattleRoyalTeamEliminatedEvent(
    team: Team,
    placement: number,
    endedAt: number
  ): GameEndEvent {
    const ledger = this.matchLedger.getLedger();
    const startedAt = ledger?.startedAt.getTime()
      ?? (this.state.roundStartTime || endedAt);
    const summary = this.matchSummary.buildGameEndEvent({
      matchMode: this.matchMode,
      gameplayMode: this.gameplayMode,
      matchPerspective: this.matchPerspective,
      winningTeam: null,
      finalScore: {
        red: this.state.redTeam.score,
        blue: this.state.blueTeam.score,
      },
      matchId: this.matchLedger.getMatchId(),
      startedAt,
      endedAt,
      players: this.state.players,
      mapThemeId: this.state.mapThemeId,
      goldenBiomeRewardLamports: '0',
    });

    summary.completionReason = 'team_eliminated';
    summary.completedTeam = team;
    summary.completedTeamPlacement = placement;
    summary.activeTeamCount = this.battleRoyalPlacement.activeTeamCount || null;

    for (const player of summary.players) {
      const teamPlacement = this.battleRoyalPlacement.getTeamPlacement(player.team);
      player.placement = teamPlacement?.placement ?? player.placement ?? null;
      if (player.team === team) {
        player.outcome = 'loss';
        player.placement = placement;
      }
    }

    return summary;
  }

  private sendBattleRoyalTeamEliminatedSummary(team: Team, now = Date.now()): void {
    if (this.battleRoyalTeamSummarySent.has(team)) return;
    const teamPlacement = this.battleRoyalPlacement.getTeamPlacement(team);
    if (!teamPlacement) return;
    if (this.shouldSuppressBattleRoyalTeamEliminatedSummary(team, teamPlacement.placement, 'placement_sweep', now)) return;

    // Build before marking sent: if the build throws, the placement sweep
    // retries next tick instead of permanently swallowing the summary.
    const summary = this.buildBattleRoyalTeamEliminatedEvent(team, teamPlacement.placement, now);
    this.battleRoyalTeamSummarySent.add(team);
    const soulsChanged = this.battleRoyalSouls?.clearTeam(team) ?? false;

    for (const client of this.clients) {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.team !== team || isObserverPlayer(player)) continue;
      this.sendTrackedAfterGameplayWork(client, 'gameEnd', summary);
    }
    if (soulsChanged) {
      this.broadcastStateStreams({ transforms: false, forceVitals: false, forceMatch: true });
    }
  }

  private sendBattleRoyalCompletedTeamSummaryToClient(client: Client, team: string | null | undefined, now = Date.now()): void {
    if (!isBattleRoyalMode(this.gameplayMode) || this.state.phase !== 'playing' || !isTeam(team)) return;

    const teamPlacement = this.battleRoyalPlacement.getTeamPlacement(team);
    if (!teamPlacement) return;
    if (this.shouldSuppressBattleRoyalTeamEliminatedSummary(team, teamPlacement.placement, 'client_backfill', now)) return;

    this.sendTrackedAfterGameplayWork(client, 'gameEnd', this.buildBattleRoyalTeamEliminatedEvent(team, teamPlacement.placement, now));
  }

  private shouldSuppressBattleRoyalTeamEliminatedSummary(
    team: Team,
    placement: number,
    source: 'placement_sweep' | 'client_backfill',
    now = Date.now()
  ): boolean {
    const decision = resolveBattleRoyalMatchEnd(this.state.players.values());
    if (placement > 1) return false;

    loggers.room.warn('Battle Royal team eliminated summary suppressed', {
      roomId: this.getRoomIdForDiagnostics(),
      lobbyId: this.lobbyId,
      matchMode: this.matchMode,
      source,
      team,
      placement,
      activeTeamCount: this.battleRoyalPlacement.activeTeamCount || null,
      phase: this.state.phase,
      shouldEnd: decision.shouldEnd,
      winningTeam: decision.winningTeam,
      contestingTeams: decision.aliveTeams,
      serverTime: now,
    });
    return true;
  }

  private updateMetadata(): void {
    const counts = getRoomPopulationCounts({
      players: this.state.players.values(),
      npcIds: this.npcs.ids,
    });
    const load = this.getRoomLoadSnapshot();
    const mapStats = this.getMapManifest().stats;
    this.setMetadata(buildGameRoomMetadata({
      roomId: this.roomId,
      lobbyName: this.lobbyName,
      phase: this.state.phase,
      lobbyId: this.lobbyId,
      matchMode: this.matchMode,
      gameplayMode: this.gameplayMode,
      matchPerspective: this.matchPerspective,
      mapSeed: this.state.mapSeed,
      mapThemeId: this.state.mapThemeId,
      mapSize: this.state.mapSize,
      mapProfileId: this.state.mapProfileId,
      pregeneratedMapId: this.state.pregeneratedMapId || null,
      mapArtifactId: this.state.mapArtifactId || null,
      counts,
      maxPlayers: this.config.maxPlayers,
      mapRenderableChunkCount: mapStats.renderableChunkCount,
      mapColliderCount: mapStats.colliderCount,
      mapSolidBlockCount: mapStats.solidBlocks,
      reservedHumanPlayers: this.reservedHumanPlayers,
      capacityPlayerCost: this.capacityPlayerCost,
      streamerObserverCount: this.streamerObservers.size,
      streamerManagedBotGame: this.streamerManagedBotGame,
      streamerManagedByUserId: this.streamerManagedByUserId,
      streamerFeedMode: this.streamerFeedMode,
      streamerCameraMode: this.streamerCameraMode,
      streamerMapRotationStartedAt: this.streamerMapRotationStartedAt,
      endlessMatch: this.endlessMatch,
      rankedEligibilityCandidate: this.rankedEligibilityCandidate,
      rankedRequiredHumanPlayers: this.rankedRequiredHumanPlayers,
      reconnectIdentityKeys: this.participantRegistry.getReconnectIdentityKeys(),
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
      tickProfiler: this.tickProfiler.snapshot(),
      antiCheatQueue: this.antiCheatEvidenceStore.getQueueHealth(),
    });
  }

  private getRecordingElapsedMs(now = Date.now()): number {
    if (!this.recordingStartedAtMs) return 0;
    return Math.max(0, now - this.recordingStartedAtMs);
  }

  private toRecordingBotAssignments(assignments: readonly BotAssignment[]): RecordingBotAssignment[] {
    return assignments.map((assignment) => ({
      playerId: assignment.playerId,
      playerName: assignment.playerName,
      team: assignment.team,
      heroId: assignment.heroId && isHeroId(assignment.heroId) ? assignment.heroId : null,
      skinId: assignment.skinId && isHeroSkinId(assignment.skinId) ? assignment.skinId : null,
      botDifficulty: normalizeBotDifficulty(assignment.botDifficulty),
      botProfileId: assignment.botProfileId || '',
    }));
  }

  private buildRecordingRoomOptions(options: CreateOptions): RecordingRoomOptions {
    return {
      lobbyName: options.lobbyName || this.lobbyName || `Recording ${this.roomId.slice(0, 6)}`,
      matchMode: this.matchMode,
      gameplayMode: this.gameplayMode,
      matchPerspective: this.matchPerspective,
      rankedEligible: this.rankedEligibilityCandidate,
      requiredHumanPlayers: this.requiredHumanPlayers,
      reservedHumanPlayers: this.reservedHumanPlayers,
      capacityPlayerCost: this.capacityPlayerCost,
      streamerManagedBotGame: this.streamerManagedBotGame,
      streamerFeedMode: this.streamerFeedMode,
      streamerCameraMode: this.streamerCameraMode,
      endlessMatch: this.endlessMatch,
    };
  }

  private buildRecordingManifest(
    recording: GameRoomRecordingOptions,
    options: CreateOptions
  ): RecordingManifest {
    const nowIso = new Date().toISOString();
    return {
      recordingVersion: RECORDING_ARTIFACT_VERSION,
      id: recording.id,
      source: 'bot_match',
      status: 'creating',
      createdAt: nowIso,
      startedAt: null,
      finalizedAt: null,
      requestedDurationMs: recording.requestedDurationMs,
      maxDurationMs: recording.maxDurationMs,
      fps: recording.fps,
      viewport: recording.viewport,
      devicePixelRatio: recording.devicePixelRatio,
      cameraMode: recording.cameraMode,
      hudMode: recording.hudMode,
      hudSubjectPlayerId: recording.hudSubjectPlayerId ?? this.selectDefaultRecordingHudSubjectId(recording.hudMode),
      gameBuildId: recording.gameBuildId ?? process.env.CLIENT_BUILD_ID ?? null,
      serverBuildId: recording.serverBuildId ?? process.env.SERVER_BUILD_ID ?? process.env.FLY_IMAGE_REF ?? null,
      roomId: this.roomId,
      matchId: this.matchLedger.getMatchId(),
      map: {
        seed: this.state.mapSeed,
        themeId: this.state.mapThemeId as VoxelMapTheme['id'] | null,
        size: this.state.mapSize as VoxelMapSizeId,
        profileId: this.state.mapProfileId as MapProfileId | null,
        pregeneratedMapId: this.state.pregeneratedMapId ? this.state.pregeneratedMapId as PregeneratedMapId : null,
        artifactId: this.state.mapArtifactId ? this.state.mapArtifactId as PregeneratedMapArtifactId : null,
      },
      gameMode: this.gameplayMode,
      matchMode: this.matchMode,
      matchPerspective: this.matchPerspective,
      botAssignments: this.toRecordingBotAssignments(options.botAssignments ?? []),
      roomOptions: this.buildRecordingRoomOptions(options),
      artifacts: buildRecordingArtifactRefs(recording.id),
      checksums: {},
      error: null,
    };
  }

  private selectDefaultRecordingHudSubjectId(mode: RecordingHudMode): string | null {
    if (mode !== 'selected_player') return null;
    for (const player of this.state.players.values()) {
      if (player.isBot && !isObserverPlayer(player)) return player.id;
    }
    for (const player of this.state.players.values()) {
      if (!isObserverPlayer(player)) return player.id;
    }
    return null;
  }

  private async startRecording(recording: GameRoomRecordingOptions, options: CreateOptions): Promise<void> {
    this.recordingOptions = recording;
    const writer = await RecordingArtifactWriter.create({
      manifest: this.buildRecordingManifest(recording, options),
    });
    this.recordingWriter = writer;
    this.recordingStartedAtMs = Date.now();
    this.recordingLastCheckpointAtMs = 0;
    this.recordingLastStopPollAtMs = 0;
    this.recordingStopPollInFlight = false;
    this.recordCurrentRecordingSnapshots();
    this.recordRecordingCheckpoint(true);
    loggers.room.info('Recording capture started', {
      roomId: this.roomId,
      recordingId: writer.id,
      durationMs: recording.requestedDurationMs,
      fps: recording.fps,
    });
  }

  private recordObserverEvent(type: string, payload: unknown): void {
    this.recordingWriter?.appendEvent(type, payload, {
      tick: this.state.tick,
      serverTime: this.state.serverTime || Date.now(),
    });
  }

  private buildRecordingPlayerVitalsMessage(): PlayerVitalsMessage {
    return {
      tick: this.state.tick,
      serverTime: this.state.serverTime || Date.now(),
      players: Array.from(
        this.state.players,
        ([id, player]) => this.buildPlayerVitalsForRecipient(id, player, null)
      ),
    };
  }

  private buildRecordingPlayerInterestMessage(): PlayerInterestMessage {
    return {
      tick: this.state.tick,
      serverTime: this.state.serverTime || Date.now(),
      players: Array.from(this.state.players, ([id, player]) => (
        buildPlayerInterestSnapshot(id, this.getRecipientInterest(null, player))
      )),
    };
  }

  private buildRecordingSnapshotPayload(forceTransforms = true): RecordingCheckpointRow['snapshot'] {
    const powerupState = this.powerupPickups.buildStateMessage(
      this.state.serverTime || Date.now(),
      this.getMapManifest()
    );
    const transformPayload = this.buildPlayerTransformsV2Payload({
      force: forceTransforms,
    });
    return {
      matchSnapshot: this.buildMatchSnapshot(),
      playerVitals: this.buildRecordingPlayerVitalsMessage(),
      playerInterest: this.buildRecordingPlayerInterestMessage(),
      playerTransformsV2: transformPayload,
      powerupState,
    };
  }

  private recordCurrentRecordingSnapshots(): void {
    const snapshot = this.buildRecordingSnapshotPayload(true);
    if (snapshot.matchSnapshot) this.recordObserverEvent('matchSnapshot', snapshot.matchSnapshot);
    if (snapshot.powerupState) this.recordObserverEvent('powerupState', snapshot.powerupState);
    if (snapshot.playerVitals) this.recordObserverEvent('playerVitals', snapshot.playerVitals);
    if (snapshot.playerInterest) this.recordObserverEvent('playerInterest', snapshot.playerInterest);
    const transforms = snapshot.playerTransformsV2 as PlayerTransformsV2Message | undefined;
    if (transforms && (transforms.players.length > 0 || transforms.hiddenPlayerIds?.length || transforms.full)) {
      this.recordObserverEvent('playerTransformsV2', transforms);
    }
  }

  private stableRecordingJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableRecordingJson(item)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${this.stableRecordingJson(record[key])}`
    )).join(',')}}`;
  }

  private recordRecordingCheckpoint(force = false): void {
    const writer = this.recordingWriter;
    if (!writer) return;
    const now = this.state.serverTime || Date.now();
    if (!force && now - this.recordingLastCheckpointAtMs < RECORDING_CHECKPOINT_INTERVAL_MS) return;

    const snapshot = this.buildRecordingSnapshotPayload(true);
    const hash = crypto
      .createHash('sha256')
      .update(this.stableRecordingJson(snapshot))
      .digest('hex');
    writer.appendCheckpoint({
      recordingTimeMs: this.getRecordingElapsedMs(now),
      serverTime: now,
      tick: this.state.tick,
      phase: this.state.phase as GamePhase,
      hash,
      snapshot,
    });
    this.recordingLastCheckpointAtMs = now;
  }

  private recordRecordingStateStreams(options: {
    shouldBroadcastVitals: boolean;
    shouldBroadcastInterest: boolean;
    shouldBroadcastTransforms: boolean;
    forceVitals: boolean;
    forceTransforms: boolean;
  }): void {
    if (!this.recordingWriter) return;

    if (options.shouldBroadcastVitals || options.forceVitals) {
      this.recordObserverEvent('playerVitals', this.buildRecordingPlayerVitalsMessage());
    }
    if (options.shouldBroadcastInterest || options.forceVitals) {
      this.recordObserverEvent('playerInterest', this.buildRecordingPlayerInterestMessage());
    }
    if (options.shouldBroadcastTransforms || options.forceTransforms) {
      const message = this.buildPlayerTransformsV2Payload({
        force: options.forceTransforms,
      });
      if (message.players.length > 0 || message.hiddenPlayerIds?.length || message.full) {
        this.recordObserverEvent('playerTransformsV2', message);
      }
    }
  }

  private recordingButtonsFromInput(input: PlayerInput): RecordingActionRow['buttons'] {
    return {
      moveForward: input.moveForward,
      moveBackward: input.moveBackward,
      moveLeft: input.moveLeft,
      moveRight: input.moveRight,
      jump: input.jump,
      crouch: input.crouch,
      crouchPressed: input.crouchPressed,
      sprint: input.sprint,
      primaryFire: input.primaryFire,
      secondaryFire: input.secondaryFire,
      reload: input.reload,
      ability1: input.ability1,
      ability2: input.ability2,
      ultimate: input.ultimate,
      interact: input.interact,
    };
  }

  private selectedAbilitySlotFromInput(input: PlayerInput): RecordingActionRow['selectedAbilitySlot'] {
    if (input.ultimate) return 'ultimate';
    if (input.ability1) return 'ability1';
    if (input.ability2) return 'ability2';
    if (input.secondaryFire) return 'secondary';
    if (input.primaryFire) return 'primary';
    return null;
  }

  private recordBotAction(player: Player, input: PlayerInput, brain: BotBrain | undefined, reused: boolean): void {
    const writer = this.recordingWriter;
    if (!writer) return;
    const now = this.state.serverTime || Date.now();
    writer.appendAction({
      recordingTimeMs: this.getRecordingElapsedMs(now),
      serverTime: now,
      tick: this.state.tick,
      playerId: player.id,
      kind: 'bot_input',
      buttons: this.recordingButtonsFromInput(input),
      lookYaw: input.lookYaw,
      lookPitch: input.lookPitch,
      selectedAbilitySlot: this.selectedAbilitySlotFromInput(input),
      combatTargetId: brain?.targetId || null,
      botIntent: brain?.intent.type ?? null,
      routeTarget: brain?.routePlan?.steeringTarget ?? null,
      compression: {
        repeated: reused,
        intervalStartTick: reused ? input.tick : undefined,
        intervalEndTick: reused ? this.state.tick : undefined,
      },
    });
  }

  private buildRecordingSummaryPlayers(): RecordingSummaryPlayer[] {
    return Array.from(this.state.players.values())
      .filter((player) => !this.npcs.has(player.id))
      .map((player) => ({
        playerId: player.id,
        playerName: player.name,
        role: getPlayerRole(player),
        team: isObserverPlayer(player) ? '' : player.team,
        heroId: isHeroId(player.heroId) ? player.heroId : null,
        isBot: player.isBot,
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
      }));
  }

  private buildRecordingSummary(status: RecordingSummary['status'], error: string | null): Omit<RecordingSummary, 'eventCount' | 'actionCount' | 'checkpointCount' | 'checksums'> {
    const writer = this.recordingWriter;
    const createdAt = new Date(this.recordingStartedAtMs || Date.now()).toISOString();
    const winner = this.state.phase === 'game_end'
      ? getWinningTeam(this.state.redTeam.score, this.state.blueTeam.score) ?? 'draw'
      : null;
    return {
      recordingVersion: RECORDING_ARTIFACT_VERSION,
      id: writer?.id ?? this.recordingOptions?.id ?? 'unknown',
      status,
      createdAt,
      startedAt: createdAt,
      finalizedAt: new Date().toISOString(),
      durationMs: this.getRecordingElapsedMs(),
      requestedDurationMs: this.recordingOptions?.requestedDurationMs ?? 0,
      roomId: this.roomId,
      matchId: this.matchLedger.getMatchId(),
      players: this.buildRecordingSummaryPlayers(),
      winner,
      notableEvents: [],
      renders: [],
      artifacts: buildRecordingArtifactRefs(writer?.id ?? this.recordingOptions?.id ?? 'unknown'),
      error,
    };
  }

  private finalizeRecording(status: RecordingSummary['status'] = 'finalized', error: string | null = null): void {
    const writer = this.recordingWriter;
    if (!writer || this.recordingFinalizing) return;
    this.recordingFinalizing = true;
    const summary = this.buildRecordingSummary(status, error);
    this.recordingWriter = null;
    void writer.finalize(summary).then((finalSummary) => {
      loggers.room.info('Recording capture finalized', {
        roomId: this.roomId,
        recordingId: finalSummary.id,
        status: finalSummary.status,
        durationMs: finalSummary.durationMs,
        eventCount: finalSummary.eventCount,
        actionCount: finalSummary.actionCount,
        checkpointCount: finalSummary.checkpointCount,
      });
    }).catch((finalizeError) => {
      loggers.room.error('Recording capture finalization failed', {
        roomId: this.roomId,
        recordingId: writer.id,
        error: finalizeError instanceof Error ? finalizeError.message : String(finalizeError),
      });
    }).finally(() => {
      if (this.disconnectAfterRecordingFinalizes && !this.roomDisposing) {
        this.disconnect();
      }
    });
  }

  private updateRecordingLifecycle(): void {
    const writer = this.recordingWriter;
    const options = this.recordingOptions;
    if (!writer || !options || this.recordingFinalizing) return;
    const now = this.state.serverTime || Date.now();
    this.recordRecordingCheckpoint();
    if (this.getRecordingElapsedMs(now) >= Math.min(options.requestedDurationMs, options.maxDurationMs)) {
      this.finalizeRecording('finalized');
      return;
    }
    if (this.recordingStopPollInFlight || now - this.recordingLastStopPollAtMs < RECORDING_STOP_POLL_INTERVAL_MS) {
      return;
    }
    this.recordingLastStopPollAtMs = now;
    this.recordingStopPollInFlight = true;
    void writer.hasStopBeenRequested().then((requested) => {
      if (!requested || this.recordingFinalizing) return;
      void writer.markStopping().finally(() => this.finalizeRecording('finalized'));
    }).catch((error) => {
      loggers.room.warn('Recording stop poll failed', {
        roomId: this.roomId,
        recordingId: writer.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }).finally(() => {
      this.recordingStopPollInFlight = false;
    });
  }

  private sendTracked(client: Client, type: string, payload: unknown): void {
    this.roomMetrics.recordCustomMessage(type, payload, 1);
    client.send(type, payload);
  }

  private sendTrackedAfterGameplayWork(client: Client, type: string, payload: unknown): void {
    if (this.tickInProgress && this.state.phase === 'playing') {
      if (isBatchablePlayerEvent(type)) {
        let batch = this.deferredPlayerEventBatches.get(client);
        if (!batch) {
          batch = [];
          this.deferredPlayerEventBatches.set(client, batch);
          this.deferredPlayerEventBatchClients.push(client);
        }
        batch.push({ type, payload } as PlayerEventBatchItem);
        return;
      }
      this.deferredTrackedMessages.push({ client, type, payload });
      return;
    }
    this.sendTracked(client, type, payload);
  }

  private flushDeferredTrackedMessages(): void {
    if (
      this.deferredTrackedMessages.length === 0 &&
      this.deferredPlayerEventBatchClients.length === 0
    ) {
      return;
    }
    const messages = this.deferredTrackedMessages;
    for (const message of messages) {
      this.sendTracked(message.client, message.type, message.payload);
    }
    messages.length = 0;

    for (const client of this.deferredPlayerEventBatchClients) {
      const batch = this.deferredPlayerEventBatches.get(client);
      if (!batch || batch.length === 0) continue;
      if (batch.length === 1) {
        const event = batch[0]!;
        this.sendTracked(client, event.type, event.payload);
      } else {
        this.sendTracked(client, 'playerEventBatch', { events: batch });
      }
    }
    this.deferredPlayerEventBatches.clear();
    this.deferredPlayerEventBatchClients.length = 0;
  }

  private discardDeferredTrackedMessages(): void {
    this.deferredTrackedMessages.length = 0;
    for (const batch of this.deferredPlayerEventBatches.values()) {
      batch.length = 0;
    }
    this.deferredPlayerEventBatches.clear();
    this.deferredPlayerEventBatchClients.length = 0;
  }

  private broadcastTracked(type: string, payload: unknown): void {
    this.roomMetrics.recordCustomMessage(type, payload, this.clients.length);
    this.recordObserverEvent(type, payload);
    this.broadcast(type, payload);
  }

  private broadcastPhaseChange(phase: GamePhase): void {
    this.broadcastTracked('phaseChange', buildPhaseChangePayload({
      phase,
      endTime: this.state.phaseEndTime,
      mapSeed: this.state.mapSeed,
      mapThemeId: this.state.mapThemeId,
      mapSize: this.state.mapSize as VoxelMapSizeId,
      mapProfileId: this.state.mapProfileId as MapProfileId,
      pregeneratedMapId: this.state.pregeneratedMapId || null,
      mapArtifactId: this.state.mapArtifactId || null,
    }));
  }

  private broadcastExactPlayerEvent(type: string, player: Player, payload: Record<string, unknown>): void {
    this.recordObserverEvent(type, payload);
    const now = this.state.serverTime || Date.now();
    const frameContext = this.getEventReplicationFrameContext(now);
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      if (!this.shouldSendExactEnemyState(recipient, player.id, player, now, undefined, frameContext)) continue;
      this.sendTrackedAfterGameplayWork(client, type, payload);
    }
  }

  private broadcastPlayerDamaged(
    target: Player,
    source: Player | null,
    payload: PlayerDamagedEvent
  ): void {
    this.recordObserverEvent('playerDamaged', {
      ...payload,
      rankedBrSolRewardLamports: undefined,
    });
    const now = this.state.serverTime || Date.now();
    const frameContext = this.getEventReplicationFrameContext(now);
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const canKnowTarget = this.shouldSendExactEnemyState(recipient, target.id, target, now, undefined, frameContext);
      const canKnowSource = source
        ? this.shouldSendExactEnemyState(recipient, source.id, source, now, undefined, frameContext)
        : true;
      const isParticipant = recipient?.id === target.id || (source && recipient?.id === source.id);
      const eventPayload = buildPlayerDamagedPayload(payload, {
        isParticipant: Boolean(isParticipant),
        canKnowTarget,
        canKnowSource,
        canKnowSourceOnlyReward: Boolean(source && recipient?.id === source.id),
      });

      if (!eventPayload) continue;
      this.sendTrackedAfterGameplayWork(client, 'playerDamaged', eventPayload);
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
    this.recordObserverEvent('chronosAegisDamaged', payload);
    const now = this.state.serverTime || Date.now();
    const frameContext = this.getEventReplicationFrameContext(now);
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const canKnowBlocker = this.shouldSendExactEnemyState(recipient, blocker.id, blocker, now, undefined, frameContext);
      const canKnowSource = source
        ? this.shouldSendExactEnemyState(recipient, source.id, source, now, undefined, frameContext)
        : true;
      const isParticipant = recipient?.id === blocker.id || (source && recipient?.id === source.id);
      const eventPayload = buildChronosAegisDamagedPayload(payload, {
        isParticipant: Boolean(isParticipant),
        canKnowBlocker,
        canKnowSource,
      });

      if (!eventPayload) continue;
      this.sendTrackedAfterGameplayWork(client, 'chronosAegisDamaged', eventPayload);
    }
  }

  private broadcastPhantomShieldBroken(
    target: Player,
    source: Player | null,
    payload: PhantomShieldBrokenEvent
  ): void {
    this.recordObserverEvent('phantomShieldBroken', payload);
    const now = this.state.serverTime || Date.now();
    const frameContext = this.getEventReplicationFrameContext(now);
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const canKnowTarget = this.shouldSendExactEnemyState(recipient, target.id, target, now, undefined, frameContext);
      const isParticipant = recipient?.id === target.id || (source && recipient?.id === source.id);
      const eventPayload = buildPhantomShieldBrokenPayload(payload, {
        isParticipant: Boolean(isParticipant),
        canKnowTarget,
      });

      if (!eventPayload) continue;
      this.sendTrackedAfterGameplayWork(client, 'phantomShieldBroken', eventPayload);
    }
  }

  private broadcastPlayerHealed(source: Player, payload: PlayerHealedEvent): void {
    this.recordObserverEvent('playerHealed', payload);
    const now = this.state.serverTime || Date.now();
    const frameContext = this.getEventReplicationFrameContext(now);
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      if (!this.shouldSendExactEnemyState(recipient, source.id, source, now, undefined, frameContext)) continue;

      const visibleTargetIds = this.visibleHealedTargetIdsScratch;
      visibleTargetIds.clear();
      for (const targetPayload of payload.targets) {
        const target = this.state.players.get(targetPayload.targetId);
        if (!target) continue;
        if (this.shouldSendExactEnemyState(recipient, target.id, target, now, undefined, frameContext)) {
          visibleTargetIds.add(targetPayload.targetId);
        }
      }

      const eventPayload = buildPlayerHealedPayload(payload, visibleTargetIds);
      visibleTargetIds.clear();
      if (!eventPayload) continue;
      this.sendTrackedAfterGameplayWork(client, 'playerHealed', eventPayload);
    }
  }

  private broadcastPowerupCollected(
    collector: Player,
    payload: PowerupCollectedMessage
  ): void {
    this.recordObserverEvent('powerupCollected', payload);
    const now = this.state.serverTime || Date.now();
    const frameContext = this.getEventReplicationFrameContext(now);
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const canKnowCollector = this.shouldSendExactEnemyState(recipient, collector.id, collector, now, undefined, frameContext);
      this.sendTrackedAfterGameplayWork(client, 'powerupCollected', buildPowerupCollectedPayload(payload, canKnowCollector));
    }
  }

  private broadcastPlayerDowned(payload: PlayerDownedEvent): void {
    this.recordObserverEvent('playerDowned', payload);
    const target = this.state.players.get(payload.targetId);
    if (!target) return;
    const source = payload.sourceId ? this.state.players.get(payload.sourceId) ?? null : null;
    const now = this.state.serverTime || Date.now();
    const frameContext = this.getEventReplicationFrameContext(now);

    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const canKnowTarget = this.shouldSendExactEnemyState(recipient, target.id, target, now, undefined, frameContext);
      const canKnowSource = source
        ? this.shouldSendExactEnemyState(recipient, source.id, source, now, undefined, frameContext)
        : true;
      const isParticipant = recipient?.id === target.id || (source && recipient?.id === source.id);
      if (!isParticipant && !canKnowTarget && !canKnowSource) continue;

      this.sendTrackedAfterGameplayWork(client, 'playerDowned', {
        ...payload,
        sourcePosition: canKnowSource || isParticipant ? payload.sourcePosition : undefined,
        sourceDirection: canKnowSource || isParticipant ? payload.sourceDirection : undefined,
      });
    }
  }

  private broadcastPlayerReviveStarted(payload: PlayerReviveStartedEvent): void {
    this.broadcastBattleRoyalReviveEvent('playerReviveStarted', payload.targetId, payload.reviverId, payload);
  }

  private broadcastPlayerReviveCancelled(payload: PlayerReviveCancelledEvent): void {
    this.broadcastBattleRoyalReviveEvent('playerReviveCancelled', payload.targetId, payload.reviverId, payload);
  }

  private broadcastPlayerRevived(payload: PlayerRevivedEvent): void {
    this.broadcastBattleRoyalReviveEvent('playerRevived', payload.targetId, payload.reviverId, payload);
  }

  private broadcastBattleRoyalReviveEvent(
    type: 'playerReviveStarted' | 'playerReviveCancelled' | 'playerRevived',
    targetId: string,
    reviverId: string | null,
    payload: PlayerReviveStartedEvent | PlayerReviveCancelledEvent | PlayerRevivedEvent
  ): void {
    this.recordObserverEvent(type, payload);
    const target = this.state.players.get(targetId);
    if (!target) return;
    const reviver = reviverId ? this.state.players.get(reviverId) ?? null : null;
    const now = this.state.serverTime || Date.now();
    const frameContext = this.getEventReplicationFrameContext(now);

    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const canKnowTarget = this.shouldSendExactEnemyState(recipient, target.id, target, now, undefined, frameContext);
      const canKnowReviver = reviver
        ? this.shouldSendExactEnemyState(recipient, reviver.id, reviver, now, undefined, frameContext)
        : false;
      const isParticipant = recipient?.id === target.id || (reviver && recipient?.id === reviver.id);
      if (!isParticipant && !canKnowTarget && !canKnowReviver) continue;
      this.sendTrackedAfterGameplayWork(client, type, payload);
    }
  }

  private broadcastPlayerKilled(victim: Player, killer: Player | null, payload: PlayerDeathEvent): void {
    this.recordObserverEvent('playerKilled', payload);
    const now = this.state.serverTime || Date.now();
    const exactPosition = payload.position;
    this.resetEventReplicationFrameContext();
    const frameContext = this.getEventReplicationFrameContext(now);
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const canKnowVictim = this.shouldSendExactEnemyState(recipient, victim.id, victim, now, undefined, frameContext);
      const canKnowKiller = killer
        ? this.shouldSendExactEnemyState(recipient, killer.id, killer, now, undefined, frameContext)
        : true;
      const isParticipant = recipient?.id === victim.id || (killer && recipient?.id === killer.id);

      this.sendTrackedAfterGameplayWork(client, 'playerKilled', buildPlayerKilledPayload(payload, {
        isParticipant: Boolean(isParticipant),
        canKnowTarget: canKnowVictim,
        canKnowSource: canKnowKiller,
      }, getCoarseEventPosition(exactPosition)));
    }
  }

  private shouldIncludeJoinPosition(recipient: Player | null, target: Player): boolean {
    if (isObserverPlayer(recipient)) return true;
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
      role: string;
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
      role: getPlayerRole(target),
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
    const matchSnapshot = this.buildMatchSnapshot(recipient);
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
    this.sendTracked(client, 'mapPing', this.buildMapPingMessage(recipient));
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

  private isStreamerObserverSession(sessionId: string): boolean {
    return this.streamerObservers.has(sessionId);
  }

  private isStreamerObserverAllowedMessage(type: string): boolean {
    return type === 'playerPingResponse'
      || type === 'streamerHeartbeat'
      || type === 'streamerObserverReady';
  }

  private handleStreamerHeartbeat(client: Client): void {
    const observer = this.streamerObservers.get(client.sessionId);
    if (!observer) return;

    observer.lastHeartbeatAt = Date.now();
  }

  private handleStreamerObserverReady(client: Client): void {
    const observer = this.streamerObservers.get(client.sessionId);
    if (!observer) return;

    observer.lastHeartbeatAt = Date.now();
    client.send('streamerObserverJoined', {
      roomId: this.roomId,
      sessionId: client.sessionId,
      streamerObserverCount: this.streamerObservers.size,
      streamerObserverSeatCount: getStreamerObserverSeatCount(),
      streamerManagedBotGame: this.streamerManagedBotGame,
      streamerFeedMode: this.streamerFeedMode,
      streamerCameraMode: this.streamerCameraMode,
      endlessMatch: this.endlessMatch,
    });
    this.sendCurrentSnapshots(client);
  }

  private probePlayerPings(): void {
    const now = this.state.serverTime || Date.now();
    if (!isPhasedIntervalDue(now, this.lastPingProbeAt, DEFAULT_PLAYER_PING_INTERVAL_MS, this.pingProbePhaseAtMs)) {
      return;
    }
    this.lastPingProbeAt = now;

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
      cancelPending: options.cancelPending,
    });
    if (result.ready) return true;

    if (result.cancelNotice) {
      this.cancelPreMatch('network_quality', result.cancelNotice);
    }

    return false;
  }

  private broadcastPlayerPings(force = false): void {
    const now = this.state.serverTime || Date.now();
    if (!force && !isPhasedIntervalDue(
      now,
      this.lastPingBroadcastAt,
      PLAYER_PING_BROADCAST_INTERVAL_MS,
      this.pingBroadcastPhaseAtMs
    )) {
      return;
    }
    if (!this.playerPings.shouldBroadcast(force)) return;
    this.lastPingBroadcastAt = now;
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      this.sendTracked(client, 'playerPings', this.playerPings.buildMessage({
        serverTime: this.state.serverTime,
        players: this.state.players,
        recipient,
      }));
    }
  }

  private pruneExpiredMapPings(now = this.state.serverTime || Date.now()): boolean {
    let changed = false;
    for (const [playerId, ping] of this.activeMapPings) {
      if (ping.expiresAt > now && this.state.players.has(playerId)) continue;
      this.activeMapPings.delete(playerId);
      changed = true;
    }
    return changed;
  }

  private getActiveMapPings(now = this.state.serverTime || Date.now()): MapPingSnapshot[] {
    this.pruneExpiredMapPings(now);
    return Array.from(this.activeMapPings.values()).sort((a, b) => (
      a.team.localeCompare(b.team) ||
      b.createdAt - a.createdAt ||
      a.playerId.localeCompare(b.playerId)
    ));
  }

  private canReceiveMapPing(recipient: Player | null, ping: MapPingSnapshot): boolean {
    if (!recipient || isObserverPlayer(recipient)) return true;
    return recipient.team === ping.team || recipient.id === ping.playerId;
  }

  private buildMapPingMessage(recipient: Player | null): MapPingMessage {
    const now = this.state.serverTime || Date.now();
    return {
      serverTime: now,
      pings: this.getActiveMapPings(now).filter((ping) => this.canReceiveMapPing(recipient, ping)),
    };
  }

  private broadcastMapPings(): void {
    const observerMessage = this.buildMapPingMessage(null);
    this.recordObserverEvent('mapPing', observerMessage);
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      this.sendTracked(client, 'mapPing', this.buildMapPingMessage(recipient));
    }
  }

  private getBotMapPingSnapshots(now = this.state.serverTime || Date.now()): BotMapPingSnapshot[] {
    return this.getActiveMapPings(now).map((ping) => ({
      id: ping.id,
      playerId: ping.playerId,
      team: ping.team,
      position: { ...ping.position },
      createdAt: ping.createdAt,
      expiresAt: ping.expiresAt,
    }));
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
      if (!canReceiveLiveTransform(player) && player.state !== 'dropping') return;
      if (!force && options.recipientId && id === options.recipientId) return;
      const interest = options.recipient
        ? this.getRecipientInterest(options.recipient, player, now, options.frameContext)
        : undefined;
      const exactStateVisible = this.shouldSendExactEnemyState(options.recipient ?? null, id, player, now, interest);
      let transform: PackedPlayerTransform | undefined;
      let signature: PackedPlayerTransform | undefined;
      let highRelevance = false;
      if (exactStateVisible) {
        transform = options.frameContext?.packedTransforms.get(id) ?? this.buildPackedTransform(id, player);
        signature = options.frameContext?.packedTransformSignatures.get(id) ?? getPackedTransformSignature(transform);
        highRelevance = this.isHighRelevanceTransform(
          options.recipient ?? null,
          id,
          player,
          now,
          options.frameContext
        );
      }
      const delta = selectPackedTransformDelta({
        state: replicationState,
        playerId: id,
        transform,
        signature,
        exactStateVisible,
        force,
        highRelevance,
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
      vitalsPhaseAtMs: this.vitalsPhaseAtMs,
      interestPhaseAtMs: this.interestPhaseAtMs,
    });

    if (!shouldBroadcastVitals && !shouldBroadcastInterest && !shouldBroadcastTransforms) return;

    const globallyRemovedPlayerIds: string[] = [];
    if (shouldBroadcastVitals) {
      frameContext.currentIds.forEach((id) => {
        this.replicationState.markKnownPlayer(id);
      });

      globallyRemovedPlayerIds.push(...this.replicationState.removeMissingKnownPlayers(frameContext.currentIds));
      let mapPingsChanged = false;
      for (const id of globallyRemovedPlayerIds) {
        this.visibilityInterest.clearPlayer(id);
        this.playerPings.clearPlayer(id);
        mapPingsChanged = this.activeMapPings.delete(id) || mapPingsChanged;
      }
      if (mapPingsChanged) this.broadcastMapPings();
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

    this.recordRecordingStateStreams({
      shouldBroadcastVitals,
      shouldBroadcastInterest,
      shouldBroadcastTransforms,
      forceVitals,
      forceTransforms,
    });

    const recorderReceivedState = Boolean(this.recordingWriter);
    if (shouldBroadcastVitals && (sentVitals || forceVitals || recorderReceivedState)) {
      this.lastVitalsBroadcastAt = now;
    }
    if (shouldBroadcastInterest && (sentInterest || forceVitals || recorderReceivedState)) {
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
    const isStreamerObserver = this.isStreamerObserverSession(client.sessionId);
    const vitalsState = options.shouldBroadcastVitals ? this.getVitalsReplicationState(recipientId) : null;
    const interestSignatures = options.shouldBroadcastInterest && (recipient || isStreamerObserver)
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
        this.isHighRelevanceTransform(targetRecipient, id, player, targetNow, options.frameContext)
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
    const driftSyncDue = isPhasedIntervalDue(
      now,
      this.lastMatchSnapshotBroadcastAt,
      MATCH_SNAPSHOT_DRIFT_SYNC_INTERVAL_MS,
      this.matchSnapshotPhaseAtMs
    );
    if (!force && signature === this.matchSnapshotSignature && !driftSyncDue) return;

    this.lastMatchSnapshotBroadcastAt = now;
    this.matchSnapshotSignature = signature;
    this.recordObserverEvent('matchSnapshot', snapshot);
    const snapshotByTeam = new Map<Team, MatchSnapshotMessage>();
    for (const client of this.clients) {
      const recipient = this.state.players.get(client.sessionId) ?? null;
      const recipientTeam = isBattleRoyalMode(this.gameplayMode) && recipient && !isObserverPlayer(recipient)
        ? recipient.team as Team
        : null;
      if (!recipientTeam) {
        this.sendTracked(client, 'matchSnapshot', snapshot);
        continue;
      }

      let recipientSnapshot = snapshotByTeam.get(recipientTeam);
      if (!recipientSnapshot) {
        recipientSnapshot = this.buildMatchSnapshot(recipient);
        snapshotByTeam.set(recipientTeam, recipientSnapshot);
      }
      this.sendTracked(client, 'matchSnapshot', recipientSnapshot);
    }
  }

  private resolveStateStreamBroadcastOptions(
    options: StateStreamBroadcastOptions
  ): ResolvedStateStreamBroadcastOptions {
    return {
      transforms: options.transforms ?? (
        this.state.phase === 'playing' ||
        this.state.phase === 'countdown' ||
        this.state.phase === 'deployment'
      ),
      vitals: options.vitals ?? true,
      match: options.match ?? true,
      forceTransforms: options.forceTransforms === true,
      forceVitals: options.forceVitals === true,
      forceMatch: options.forceMatch === true,
    };
  }

  private mergeStateStreamBroadcastOptions(
    left: ResolvedStateStreamBroadcastOptions,
    right: ResolvedStateStreamBroadcastOptions
  ): ResolvedStateStreamBroadcastOptions {
    return {
      transforms: left.transforms || right.transforms,
      vitals: left.vitals || right.vitals,
      match: left.match || right.match,
      forceTransforms: left.forceTransforms || right.forceTransforms,
      forceVitals: left.forceVitals || right.forceVitals,
      forceMatch: left.forceMatch || right.forceMatch,
    };
  }

  private queueCatchupStateStreams(options: ResolvedStateStreamBroadcastOptions): void {
    this.pendingCatchupStateStreams = this.pendingCatchupStateStreams
      ? this.mergeStateStreamBroadcastOptions(this.pendingCatchupStateStreams, options)
      : options;
  }

  private consumePendingCatchupStateStreams(
    options: ResolvedStateStreamBroadcastOptions
  ): ResolvedStateStreamBroadcastOptions {
    const pending = this.pendingCatchupStateStreams;
    if (!pending) return options;
    this.pendingCatchupStateStreams = null;
    return this.mergeStateStreamBroadcastOptions(pending, options);
  }

  private flushPendingCatchupStateStreams(): void {
    const pending = this.pendingCatchupStateStreams;
    if (!pending) return;
    this.pendingCatchupStateStreams = null;
    this.broadcastStateStreams(pending);
  }

  private broadcastStateStreams(options: StateStreamBroadcastOptions = {}): void {
    const resolvedOptions = this.resolveStateStreamBroadcastOptions(options);
    if (this.deferStateStreamsForCatchup) {
      this.queueCatchupStateStreams(resolvedOptions);
      return;
    }
    const effectiveOptions = this.consumePendingCatchupStateStreams(resolvedOptions);

    this.visibilityInterest.resetMetricsWindow();
    this.measureTickSpan('ping_probe_broadcast', () => {
      this.probePlayerPings();
      this.broadcastPlayerPings();
    });
    const frameContext = this.measureTickSpan(
      'replication_frame_context',
      () => this.buildReplicationFrameContext()
    );

    this.measureTickSpan('player_state_stream_fanout', () => this.broadcastPlayerStateStreams({
      transforms: effectiveOptions.transforms,
      vitals: effectiveOptions.vitals,
      forceTransforms: effectiveOptions.forceTransforms,
      forceVitals: effectiveOptions.forceVitals,
      frameContext,
    }));

    if (effectiveOptions.match) {
      this.measureTickSpan('match_snapshot_broadcast', () => this.broadcastMatchSnapshot(effectiveOptions.forceMatch));
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

  private isRankedRewardEligiblePlayer(playerId: string): boolean {
    return this.participantRegistry.isRankedRewardEligible(playerId);
  }

  private serializeRankedBrRewardOutcome(outcome: RankedBrRewardEventOutcome): Record<string, unknown> {
    return {
      outcomeReason: outcome.reason,
      sourcePlayerId: outcome.sourcePlayerId,
      sourceUserId: outcome.sourceUserId,
      sourceTeam: outcome.sourceTeam,
      targetPlayerId: outcome.targetPlayerId,
      targetTeam: outcome.targetTeam,
      targetKind: outcome.targetKind,
      serverAppliedDamageHp: outcome.serverAppliedDamageHp,
      finalEnemyElimination: outcome.finalEnemyElimination,
      settingsVersion: outcome.settingsVersion,
      grossRewardLamports: outcome.grossRewardLamports.toString(),
      rewardLamports: outcome.rewardLamports.toString(),
      matchPoolRemainingLamports: outcome.matchPoolRemainingLamports.toString(),
      matchAwardedLamports: outcome.matchAwardedLamports.toString(),
    };
  }

  private logRankedBrRewardSkip(reason: string, details: Record<string, unknown> = {}): void {
    const current = this.rankedBrRewardSkipLogCounts.get(reason) ?? 0;
    if (current >= RANKED_BR_REWARD_SKIP_LOG_LIMIT_PER_REASON) return;
    const sample = current + 1;
    this.rankedBrRewardSkipLogCounts.set(reason, sample);
    loggers.room.info('Ranked BR combat reward skipped', {
      roomId: this.roomId,
      lobbyId: this.lobbyId,
      reason,
      sample,
      matchMode: this.matchMode,
      gameplayMode: this.gameplayMode,
      phase: this.state.phase,
      rankedEligibilityCandidate: this.rankedEligibilityCandidate,
      hasAccumulator: Boolean(this.rankedBrRewardAccumulator),
      hasConfig: Boolean(this.rankedBrRewardConfig),
      ...details,
    });
  }

  private logRankedBrRewardAward(details: Record<string, unknown>): void {
    if (this.rankedBrRewardAwardLogCount >= RANKED_BR_REWARD_AWARD_LOG_LIMIT) return;
    this.rankedBrRewardAwardLogCount += 1;
    loggers.room.info('Ranked BR combat reward awarded', {
      roomId: this.roomId,
      lobbyId: this.lobbyId,
      sample: this.rankedBrRewardAwardLogCount,
      matchMode: this.matchMode,
      gameplayMode: this.gameplayMode,
      phase: this.state.phase,
      ...details,
    });
  }

  private initializeRankedBrRewardAccumulator(ledger: MatchPersistenceLedger): void {
    const initGeneration = ++this.rankedBrRewardInitGeneration;
    this.rankedBrRewardAccumulator = null;
    this.rankedBrRewardConfig = null;
    this.rankedBrRewardConfigRefreshAfterMs = 0;
    this.rankedBrRewardSkipLogCounts.clear();
    this.rankedBrRewardAwardLogCount = 0;

    if (
      this.matchMode !== 'ranked' ||
      !isBattleRoyalMode(this.gameplayMode) ||
      !this.rankedEligibilityCandidate ||
      ledger.state !== 'active'
    ) {
      if (this.matchMode === 'ranked' || isBattleRoyalMode(this.gameplayMode)) {
        this.logRankedBrRewardSkip('init_gate_failed', {
          matchId: ledger.matchId,
          ledgerState: ledger.state,
          isRankedMatch: this.matchMode === 'ranked',
          isBattleRoyal: isBattleRoyalMode(this.gameplayMode),
        });
      }
      return;
    }

    const userIds = new Set<string>();
    this.state.players.forEach((player) => {
      if (player.isBot || this.npcs.has(player.id) || isObserverPlayer(player)) return;
      if (!this.isRankedRewardEligiblePlayer(player.id)) return;
      const userId = this.getDurableUserId(player.id);
      if (userId) userIds.add(userId);
    });
    if (userIds.size === 0) {
      this.logRankedBrRewardSkip('no_reward_eligible_players', {
        matchId: ledger.matchId,
      });
      return;
    }
    void playerRewardService.createRankedBrRewardAccumulator({
      matchId: ledger.matchId,
      roomId: ledger.roomId,
      lobbyId: ledger.lobbyId,
      userIds: Array.from(userIds),
      now: new Date(this.state.roundStartTime || Date.now()),
    }).then((init) => {
      if (
        initGeneration !== this.rankedBrRewardInitGeneration ||
        this.matchLedger.getLedger() !== ledger ||
        ledger.state !== 'active' ||
        this.state.phase !== 'playing'
      ) {
        this.logRankedBrRewardSkip('init_discarded', {
          matchId: ledger.matchId,
          ledgerState: ledger.state,
          initGeneration,
          currentInitGeneration: this.rankedBrRewardInitGeneration,
          currentPhase: this.state.phase,
        });
        return;
      }
      this.rankedBrRewardAccumulator = init.accumulator;
      this.rankedBrRewardConfig = init.config;
      this.rankedBrRewardConfigRefreshAfterMs = Date.now() + 5_000;
      const snapshot = init.accumulator.getDebugSnapshot();
      loggers.room.info('Ranked BR reward accumulator initialized', {
        roomId: this.roomId,
        matchId: ledger.matchId,
        lobbyId: ledger.lobbyId,
        userCount: userIds.size,
        rewardSettingsEnabled: init.config.enabled,
        rankedBrCombatRewardsEnabled: init.config.rankedBrCombatRewardsEnabled,
        rankedBrCombatRewardsShadowMode: init.config.rankedBrCombatRewardsShadowMode,
        rankedBrDamageLamportsPerHp: init.config.rankedBrDamageLamportsPerHp.toString(),
        rankedBrKillLamports: init.config.rankedBrKillLamports.toString(),
        rankedBrBotTargetRewardBps: init.config.rankedBrBotTargetRewardBps,
        rankedBrMaxMatchLamports: init.config.rankedBrMaxMatchLamports.toString(),
        rankedBrTreasuryExposureBps: init.config.rankedBrTreasuryExposureBps,
        matchPoolLamports: snapshot.matchPoolLamports.toString(),
        matchPoolRemainingLamports: snapshot.matchPoolRemainingLamports.toString(),
      });
    }).catch((error) => {
      loggers.room.warn('Ranked BR reward accumulator initialization failed', {
        roomId: this.roomId,
        matchId: ledger.matchId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private getRankedBrRewardConfigForAccrual(now = Date.now()): RankedBrRewardAccumulatorInit['config'] | null {
    if (!this.rankedBrRewardAccumulator || !this.rankedBrRewardConfig) return null;
    if (now < this.rankedBrRewardConfigRefreshAfterMs || this.rankedBrRewardConfigRefreshInFlight) {
      return this.rankedBrRewardConfig;
    }

    this.rankedBrRewardConfigRefreshInFlight = true;
    void playerRewardService.getConfig().then((config) => {
      this.rankedBrRewardConfig = config;
      this.rankedBrRewardConfigRefreshAfterMs = Date.now() + 5_000;
    }).catch((error) => {
      this.rankedBrRewardConfigRefreshAfterMs = Date.now() + 1_000;
      loggers.room.warn('Ranked BR reward settings refresh failed', {
        roomId: this.roomId,
        error: error instanceof Error ? error.message : String(error),
      });
    }).finally(() => {
      this.rankedBrRewardConfigRefreshInFlight = false;
    });

    return this.rankedBrRewardConfig;
  }

  private getRankedBrRewardTargetKind(target: Player): RankedBrRewardTargetKind {
    if (this.npcs.has(target.id)) return 'non_rewardable';
    if (target.isBot) {
      return target.botProfileId === BOT_RANKED_BATTLE_ROYAL_PROFILE_PREFIX ||
        target.botProfileId.startsWith(`${BOT_RANKED_BATTLE_ROYAL_PROFILE_PREFIX}-`)
        ? 'official_ranked_br_bot'
        : 'non_rewardable';
    }
    return this.getDurableUserId(target.id) ? 'human' : 'non_rewardable';
  }

  private recordRankedBrCombatReward(input: {
    target: Player;
    source: Player | null;
    appliedDamage: number;
    finalEnemyElimination: boolean;
    damageType: string;
  }): { amountLamports: string } | null {
    if (!isBattleRoyalMode(this.gameplayMode)) return null;

    const targetDetails = {
      targetPlayerId: input.target.id,
      targetTeam: input.target.team || null,
      targetIsBot: input.target.isBot,
      targetBotProfileId: input.target.botProfileId || null,
      targetIsNpc: this.npcs.has(input.target.id),
      appliedDamage: input.appliedDamage,
      finalEnemyElimination: input.finalEnemyElimination,
      damageType: input.damageType,
    };

    if (this.matchMode !== 'ranked') {
      this.logRankedBrRewardSkip('not_ranked', targetDetails);
      return null;
    }
    if (this.state.phase !== 'playing') {
      this.logRankedBrRewardSkip('not_playing', targetDetails);
      return null;
    }
    if (input.appliedDamage <= 0) {
      this.logRankedBrRewardSkip('no_applied_damage', targetDetails);
      return null;
    }
    if (!input.source) {
      this.logRankedBrRewardSkip('missing_source', targetDetails);
      return null;
    }

    const sourceDetails = {
      sourcePlayerId: input.source.id,
      sourceTeam: input.source.team || null,
      sourceIsBot: input.source.isBot,
      sourceIsNpc: this.npcs.has(input.source.id),
      sourceIsObserver: isObserverPlayer(input.source),
    };
    if (
      input.source.isBot ||
      this.npcs.has(input.source.id) ||
      isObserverPlayer(input.source)
    ) {
      this.logRankedBrRewardSkip('invalid_source', { ...targetDetails, ...sourceDetails });
      return null;
    }

    const sourceUserId = this.getDurableUserId(input.source.id);
    if (!sourceUserId) {
      this.logRankedBrRewardSkip('missing_source_user', { ...targetDetails, ...sourceDetails });
      return null;
    }
    if (!this.isRankedRewardEligiblePlayer(input.source.id)) {
      this.logRankedBrRewardSkip('ranked_reward_ineligible', {
        ...targetDetails,
        ...sourceDetails,
        sourceUserId,
      });
      return null;
    }
    const accumulator = this.rankedBrRewardAccumulator;
    const config = this.getRankedBrRewardConfigForAccrual();
    if (!accumulator || !config) {
      this.logRankedBrRewardSkip('accumulator_not_ready', {
        ...targetDetails,
        ...sourceDetails,
        sourceUserId,
      });
      return null;
    }

    const targetKind = this.getRankedBrRewardTargetKind(input.target);
    const reward = accumulator.recordDamage({
      config,
      sourcePlayerId: input.source.id,
      sourceUserId,
      sourceTeam: input.source.team || null,
      targetPlayerId: input.target.id,
      targetTeam: input.target.team || null,
      targetKind,
      playerSessionId: input.source.id,
      serverAppliedDamageHp: input.appliedDamage,
      finalEnemyElimination: input.finalEnemyElimination,
    });
    const outcome = accumulator.getLastEventOutcome();
    const outcomeDetails = outcome ? this.serializeRankedBrRewardOutcome(outcome) : {};
    if (!reward || reward.amountLamports <= 0n) {
      this.logRankedBrRewardSkip(outcome?.reason ?? 'no_reward', {
        ...targetDetails,
        ...sourceDetails,
        sourceUserId,
        targetKind,
        ...outcomeDetails,
      });
      return null;
    }
    this.logRankedBrRewardAward({
      ...targetDetails,
      ...sourceDetails,
      sourceUserId,
      targetKind,
      ...outcomeDetails,
    });
    return { amountLamports: reward.amountLamports.toString() };
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
    if (isObserverPlayer(player)) return null;
    if (this.hasBattleRoyalTeamCompleted(player.team)) return null;
    return this.matchLedger.registerParticipant(player, now);
  }

  private syncMatchParticipant(player: Player) {
    if (isObserverPlayer(player)) return null;
    return this.matchLedger.syncParticipant(player);
  }

  private buildMatchParticipantSnapshots(ledger: MatchPersistenceLedger): MatchParticipantSnapshot[] {
    if (ledger !== this.matchLedger.getLedger()) return [];
    const participants = this.matchLedger.buildParticipantSnapshots(this.state.players.values());
    return isBattleRoyalMode(this.gameplayMode)
      ? this.battleRoyalPlacement.enrichParticipantSnapshots(participants)
      : participants;
  }

  private markMatchParticipantLeft(player: Player, now = Date.now()): void {
    this.matchLedger.markParticipantLeft(player, now);
  }

  private markMatchParticipantLeftIfIncomplete(player: Player, now = Date.now()): void {
    if (this.hasBattleRoyalTeamCompleted(player.team)) return;
    this.markMatchParticipantLeft(player, now);
  }

  private hasBattleRoyalTeamCompleted(team: string | null | undefined): boolean {
    return (
      isBattleRoyalMode(this.gameplayMode) &&
      isTeam(team) &&
      this.battleRoyalPlacement.hasTeamPlacement(team)
    );
  }

  private recordMatchDeath(victim: Player, killer: Player | null): void {
    this.matchLedger.recordDeath(victim, killer);
  }

  private recordMatchKill(killer: Player, victim: Player, details?: {
    abilityId?: string | null;
    damageType?: string | null;
    victimHadFlag?: boolean;
    occurredAt?: Date;
  }): void {
    this.matchLedger.recordKill(killer, victim, details);
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
      gameplayMode: this.gameplayMode,
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
    }) ?? this.cleanAntiCheatGate();
    const rankedBrCombatGrants = this.rankedBrRewardAccumulator?.buildGrants() ?? [];
    this.rankedBrRewardAccumulator = null;
    this.rankedBrRewardConfig = null;

    void this.matchFinalization.persistLedger({
      ledger,
      finalScore,
      winningTeam,
      participants,
      rankedEligible,
      integrityGate,
      gameplayMode: this.gameplayMode,
      killEvents: [...ledger.killEvents],
      rankedBrCombatGrants,
      ...this.getCombatRosterCountsForRanking(),
    });
  }

  private getCombatRosterCountsForRanking(): {
    totalParticipants: number;
    humanParticipants: number;
    botParticipants: number;
    activeTeamCount?: number;
  } {
    let totalParticipants = 0;
    let humanParticipants = 0;
    let botParticipants = 0;
    this.state.players.forEach((player, playerId) => {
      if (this.npcs.has(playerId) || isObserverPlayer(player)) return;
      totalParticipants++;
      if (player.isBot) {
        botParticipants++;
      } else {
        humanParticipants++;
      }
    });
    return {
      totalParticipants,
      humanParticipants,
      botParticipants,
      activeTeamCount: isBattleRoyalMode(this.gameplayMode)
        ? this.battleRoyalPlacement.activeTeamCount
        : undefined,
    };
  }

  private async removeVoiceParticipantForPlayer(
    playerId: string,
    team: Team | null | undefined,
    reason: string
  ): Promise<void> {
    if (!voiceService.isEnabled()) return;
    const identity = this.getDurableUserId(playerId);
    if (!identity) return;
    await voiceService.removeMatchParticipant(this.roomId, identity, reason);
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

  private suppressObjectives(
    playerId: string,
    reason: string,
    now = Date.now(),
    options: { recordSecurityEvent?: boolean } = {}
  ): void {
    const authority = this.getMovementAuthority(playerId);
    authority.objectiveSuppressedUntil = Math.max(authority.objectiveSuppressedUntil, now + OBJECTIVE_SUPPRESSION_MS);
    authority.metrics.objectiveSuppressions = (authority.metrics.objectiveSuppressions ?? 0) + 1;
    if (options.recordSecurityEvent === false) return;
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
    this.stopBlazeAfterburnerDash(player.id);
    stopRootedMovementState(player);
  }

  private getRootedMovementInput(player: Player, input: PlayerInput, now: number): PlayerInput {
    if (!this.playerRoots.isRooted(player.id, now)) return input;
    this.stopRootedMovement(player);
    return suppressLocomotionInput(input);
  }

  private suppressBattleRoyalHoldInteractionInput(input: PlayerInput): PlayerInput {
    return {
      ...input,
      moveForward: false,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      jump: false,
      crouch: false,
      crouchPressed: false,
      sprint: false,
      primaryFire: false,
      secondaryFire: false,
      reload: false,
      ability1: false,
      ability2: false,
      ultimate: false,
      interact: false,
    };
  }

  private getBattleRoyalReviveLockedInput(player: Player, input: PlayerInput, now: number): PlayerInput {
    if (!this.battleRoyalDownedRuntime.isReviving(player.id)) return input;

    const targetId = this.battleRoyalDownedRuntime.getReviveTargetId(player.id);
    const target = targetId ? this.state.players.get(targetId) ?? null : null;
    if (!input.interact || hasBattleRoyalHoldInteractionBreakingInput(input)) {
      if (target) {
        this.battleRoyalDownedRuntime.cancelReviveForTarget(target, 'interrupted', now);
      } else {
        this.battleRoyalDownedRuntime.cancelReviveForPlayer(player.id, 'target_removed', now);
      }
    }

    return this.suppressBattleRoyalHoldInteractionInput(input);
  }

  private getBattleRoyalSoulLockedInput(player: Player, input: PlayerInput, now: number): PlayerInput {
    if (!(this.battleRoyalSouls?.hasActiveInteraction(player.id) ?? false)) return input;

    if (!input.interact || hasBattleRoyalHoldInteractionBreakingInput(input)) {
      this.battleRoyalSouls.cancelInteractionForPlayer(player.id);
    }

    return this.suppressBattleRoyalHoldInteractionInput(input);
  }

  private getDownedMovementInput(player: Player, input: PlayerInput): PlayerInput {
    if (player.state !== 'downed') return input;
    const frozenByRevive = this.battleRoyalDownedRuntime.isBeingRevived(player);
    return {
      ...input,
      moveForward: frozenByRevive ? false : input.moveForward,
      moveBackward: frozenByRevive ? false : input.moveBackward,
      moveLeft: frozenByRevive ? false : input.moveLeft,
      moveRight: frozenByRevive ? false : input.moveRight,
      jump: false,
      crouch: false,
      crouchPressed: false,
      sprint: false,
      primaryFire: input.primaryFire,
      secondaryFire: false,
      reload: false,
      ability1: false,
      ability2: false,
      ultimate: false,
      interact: false,
    };
  }

  private getSanitizedMovementInput(player: Player, input: PlayerInput, now: number): PlayerInput {
    return this.getRootedMovementInput(
      player,
      this.getDownedMovementInput(
        player,
        this.getBattleRoyalSoulLockedInput(
          player,
          this.getBattleRoyalReviveLockedInput(player, input, now),
          now
        )
      ),
      now
    );
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
        preservedCommands.push(promoteMovementCommandAcrossAuthorityBarrier(command, nextEpoch));
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

  private markRootedMovementAuthority(target: Player, now: number): void {
    if (!target.isBot) {
      this.markMovementBarrier(target.id, 'root', { preserveQueuedCommands: true });
      return;
    }

    const authority = this.getMovementAuthority(target.id);
    this.updateLastSafeMovement(target, target.lastInput?.tick ?? authority.lastProcessedSeq, now);
    this.suppressObjectives(target.id, 'root', now, { recordSecurityEvent: false });
  }

  private handleMovementCommandPacket(client: Client, packet: MovementCommandPacket): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.isBot) return;
    if (this.isBattleRoyalDeploymentPlayer(player)) {
      this.handleBattleRoyalDropCommandPacket(client, player, packet);
      return;
    }
    if (player.state !== 'alive' && !this.isBattleRoyalDownedPlayer(player)) return;

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
    if (result.acceptedStaleCollisionRevisionCount > 0) {
      this.sendSelfMovementAuthority(player, client, authority.correctionReason);
    }
  }

  private isBattleRoyalDeploymentPlayer(player: Player): boolean {
    return (
      isBattleRoyalMode(this.gameplayMode) &&
      this.state.phase === 'deployment' &&
      player.state === 'dropping'
    );
  }

  private isBattleRoyalDownedPlayer(player: Player): boolean {
    return (
      isBattleRoyalMode(this.gameplayMode) &&
      this.state.phase === 'playing' &&
      player.state === 'downed'
    );
  }

  private handleBattleRoyalDropCommandPacket(
    client: Client,
    player: Player,
    packet: MovementCommandPacket
  ): void {
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
        detail: {
          ...(event.detail ?? {}),
          phase: 'deployment',
        },
      });
    }

    if (result.shouldMarkQueueOverflowBarrier) {
      this.markMovementBarrier(client.sessionId, 'queue_overflow');
    }
    if (result.acceptedStaleCollisionRevisionCount > 0) {
      this.sendSelfMovementAuthority(player, client, authority.correctionReason);
    }
  }

  private writeMovementCommandToInput(
    command: MovementCommand,
    target: PlayerInput,
    now = this.state.serverTime || Date.now()
  ): PlayerInput {
    const buttons = sanitizeMovementButtons(command.buttons);
    target.tick = command.seq;
    target.moveForward = Boolean(buttons & MOVEMENT_BUTTON_MOVE_FORWARD);
    target.moveBackward = Boolean(buttons & MOVEMENT_BUTTON_MOVE_BACKWARD);
    target.moveLeft = Boolean(buttons & MOVEMENT_BUTTON_MOVE_LEFT);
    target.moveRight = Boolean(buttons & MOVEMENT_BUTTON_MOVE_RIGHT);
    target.jump = Boolean(buttons & MOVEMENT_BUTTON_JUMP);
    target.crouch = Boolean(buttons & MOVEMENT_BUTTON_CROUCH);
    target.crouchPressed = Boolean(buttons & MOVEMENT_BUTTON_CROUCH_PRESSED);
    target.sprint = Boolean(buttons & MOVEMENT_BUTTON_SPRINT);
    target.primaryFire = Boolean(buttons & MOVEMENT_BUTTON_PRIMARY_FIRE);
    target.secondaryFire = Boolean(buttons & MOVEMENT_BUTTON_SECONDARY_FIRE);
    target.reload = Boolean(buttons & MOVEMENT_BUTTON_RELOAD);
    target.ability1 = Boolean(buttons & MOVEMENT_BUTTON_ABILITY_1);
    target.ability2 = Boolean(buttons & MOVEMENT_BUTTON_ABILITY_2);
    target.ultimate = Boolean(buttons & MOVEMENT_BUTTON_ULTIMATE);
    target.interact = Boolean(buttons & MOVEMENT_BUTTON_INTERACT);
    target.lookYaw = command.lookYaw;
    target.lookPitch = command.lookPitch;
    target.timestamp = now;
    delete target.clientFrameRateBand;
    if (command.abilityCastHints) {
      target.abilityCastHints = command.abilityCastHints;
    } else {
      delete target.abilityCastHints;
    }
    return target;
  }

  private getServerOwnedMovementInput(
    player: Player,
    input: PlayerInput | undefined,
    now: number
  ): PlayerInput {
    const movementInput = input ?? player.lastInput ?? createEmptyBotInput(this.state.tick, player, now);
    movementInput.tick = this.state.tick;
    movementInput.timestamp = now;
    movementInput.lookYaw = normalizeLookYaw(movementInput.lookYaw);
    movementInput.lookPitch = clampLookPitch(movementInput.lookPitch);
    delete movementInput.clientFrameRateBand;
    return movementInput;
  }

  private stepAuthoritativeMovementInput(
    player: Player,
    input: PlayerInput,
    stepSeconds: number,
    stepNow: number,
    collisionWorld: MovementCollisionWorld,
    options: { processGameplayInput: boolean; command?: MovementCommand }
  ): PlayerInput {
    const movementInput = this.getSanitizedMovementInput(player, input, stepNow);
    const authority = this.getMovementAuthority(player.id);
    const previousMovement: PlayerMovementState = buildPlayerMovementSnapshot(player);
    const previousSafe: LastSafeMovementState = authority.lastSafe ?? {
      position: vec3SchemaToPlain(player.position),
      velocity: vec3SchemaToPlain(player.velocity),
      acceptedAt: stepNow - stepSeconds * 1000,
      sequence: authority.lastProcessedSeq,
    };
    player.lastInput = movementInput;
    player.lookYaw = movementInput.lookYaw;
    player.lookPitch = movementInput.lookPitch;
    const dragPullActive = this.hookshotRuntime.hasDragPull(player.id);
    const phoenixDive = this.blazePhoenixDives.get(player.id);
    const phoenixDivePhase = phoenixDive?.phase;
    const phoenixDiveActive = phoenixDivePhase === 'hover' || phoenixDivePhase === 'dive';
    if (dragPullActive) {
      this.clearHookshotGrapple(player.id);
    } else {
      this.prepareHookshotGrappleForMovement(player, stepNow);
    }
    const simulationInput = dragPullActive || phoenixDiveActive
      ? suppressLocomotionInput(movementInput)
      : movementInput;
    if (phoenixDivePhase === 'hover' && phoenixDive) {
      this.applyBlazePhoenixDiveHoverVelocity(player, phoenixDive, stepNow);
    }
    this.simulateAuthoritativeMovementStep(
      player,
      simulationInput,
      stepSeconds,
      stepNow,
      collisionWorld
    );
    if (!dragPullActive) {
      this.stepHookshotGrappleAuthority(player, simulationInput, stepSeconds, stepNow, collisionWorld);
    }
    this.stepHookshotDragPullAuthority(player, stepSeconds, stepNow, collisionWorld);
    this.applyClientMovementProposal({
      player,
      authority,
      command: options.command,
      movementInput,
      previous: previousSafe,
      previousMovement,
      collisionWorld,
      now: stepNow,
    });
    if (options.processGameplayInput) {
      if (this.shouldProcessMovementGameplayInput(player, movementInput)) {
        this.measureTickSpan('movement_gameplay_input', () => {
          this.processPlayerInput(player, movementInput, stepNow);
        });
      } else {
        this.tickProfiler.recordCounter('movement_gameplay_input_skipped');
      }
    }
    this.updateLastSafeMovement(player, movementInput.tick, stepNow);
    return movementInput;
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
    if (player.state === 'downed') {
      this.forceDownedMovementState(player);
    }
  }

  private forceDownedMovementState(player: Player): void {
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

  private getMovementProposalBounds(): MovementBounds {
    const manifest = this.getMapManifest();
    return {
      minX: manifest.origin.x - PLAYER_RADIUS,
      maxX: manifest.origin.x + manifest.size.x * manifest.voxelSize.x + PLAYER_RADIUS,
      minY: manifest.origin.y - PLAYER_HEIGHT * 4,
      maxY: manifest.origin.y + manifest.size.y * manifest.voxelSize.y + PLAYER_HEIGHT * 2,
      minZ: manifest.origin.z - PLAYER_RADIUS,
      maxZ: manifest.origin.z + manifest.size.z * manifest.voxelSize.z + PLAYER_RADIUS,
    };
  }

  private isInsideMovementProposalArea(position: PlainVec3): boolean {
    const manifest = this.getMapManifest();
    if (manifest.boundary.length >= 3) {
      return isInsideBoundaryPolygon(position.x, position.z, manifest.boundary);
    }

    return (
      position.x >= manifest.origin.x &&
      position.x <= manifest.origin.x + manifest.size.x * manifest.voxelSize.x &&
      position.z >= manifest.origin.z &&
      position.z <= manifest.origin.z + manifest.size.z * manifest.voxelSize.z
    );
  }

  private getMovementCapsuleDimensions(movement: Pick<PlayerMovementState, 'isSliding' | 'isCrouching'>): {
    height: number;
    radius: number;
  } {
    if (movement.isSliding) {
      return { height: PLAYER_SLIDE_HEIGHT, radius: PLAYER_SLIDE_RADIUS };
    }
    if (movement.isCrouching) {
      return { height: PLAYER_CROUCH_HEIGHT, radius: PLAYER_RADIUS };
    }
    return { height: PLAYER_HEIGHT, radius: PLAYER_RADIUS };
  }

  private incrementMovementProposalRejectMetric(
    authority: ServerMovementAuthorityState,
    reason: MovementCorrectionReason
  ): void {
    switch (reason) {
      case 'invalid_transform':
        authority.metrics.invalidTransforms = (authority.metrics.invalidTransforms ?? 0) + 1;
        break;
      case 'speed_limit':
        authority.metrics.speedViolations = (authority.metrics.speedViolations ?? 0) + 1;
        break;
      case 'blocked_path':
        authority.metrics.blockedPathCorrections = (authority.metrics.blockedPathCorrections ?? 0) + 1;
        break;
      case 'bounds':
        authority.metrics.boundsCorrections = (authority.metrics.boundsCorrections ?? 0) + 1;
        break;
      default:
        authority.metrics.hardCorrections = (authority.metrics.hardCorrections ?? 0) + 1;
        break;
    }
  }

  private applyClientAuthoritativeMovementState(
    player: Player,
    clientState: MovementClientStateSnapshot,
    serverMovement: PlayerMovementState
  ): void {
    player.position.x = clientState.position.x;
    player.position.y = clientState.position.y;
    player.position.z = clientState.position.z;
    player.velocity.x = clientState.velocity.x;
    player.velocity.y = clientState.velocity.y;
    player.velocity.z = clientState.velocity.z;

    player.movement.isGrounded = serverMovement.isGrounded;
    player.movement.isSprinting = serverMovement.isSprinting;
    player.movement.isCrouching = serverMovement.isCrouching;
    player.movement.isSliding = serverMovement.isSliding;
    player.movement.slideTimeRemaining = serverMovement.slideTimeRemaining;
    player.movement.isWallRunning = serverMovement.isWallRunning;
    player.movement.wallRunSide = serverMovement.wallRunSide ?? '';
    player.movement.isGliding = serverMovement.isGliding;
    player.movement.chronosAscendantStartY = serverMovement.chronosAscendantStartY ?? 0;
    player.movement.isGrappling = serverMovement.isGrappling;
    player.movement.isJetpacking = serverMovement.isJetpacking;
    player.movement.jetpackFuel = serverMovement.jetpackFuel;

    if (player.state === 'downed') {
      this.forceDownedMovementState(player);
    }
  }

  private recordClientMovementShadowSample(input: {
    player: Player;
    authority: ServerMovementAuthorityState;
    movementInput: PlayerInput;
    previous: LastSafeMovementState;
    clientState: MovementClientStateSnapshot;
    previousMovement: PlayerMovementState;
  }): void {
    const { player, authority, movementInput, previous, clientState, previousMovement } = input;
    const heroId = isHeroId(player.heroId) ? player.heroId : null;
    const movementHeroId = heroId ?? 'phantom';
    const shadow = advanceMovementShadowSimulation({
      state: authority.shadow,
      playerPosition: previous.position,
      playerVelocity: previous.velocity,
      playerMovement: previousMovement,
      heroStats: getHeroStats(movementHeroId),
      input: movementInput,
      terrain: this.mapRuntime.terrain,
      flagCarrier: isCaptureTheFlagMode(this.gameplayMode) && player.hasFlag,
      activeSpeedMultiplier: this.getActiveSpeedMultiplier(player, movementInput.timestamp) *
        (player.state === 'downed' ? BATTLE_ROYAL_CRAWL_SPEED_MULTIPLIER : 1),
      chronosAscendantActive: player.state === 'downed' ? false : this.isChronosAscendantActive(player, movementInput.timestamp),
      forcedHorizontalVelocity: player.state === 'alive'
        ? this.getBlazeForcedHorizontalVelocity(player.id, movementInput.timestamp)
        : undefined,
      proposedPosition: clientState.position,
      proposedVelocity: clientState.velocity,
      proposedMovement: clientState.movement,
    });

    authority.shadow = shadow.nextState;
    authority.metrics.shadowSamples = (authority.metrics.shadowSamples ?? 0) + 1;
    authority.metrics.shadowLastPositionDrift = shadow.sample.positionDrift;
    authority.metrics.shadowLastVelocityDrift = shadow.sample.velocityDrift;
    authority.metrics.shadowMaxPositionDrift = Math.max(
      authority.metrics.shadowMaxPositionDrift ?? 0,
      shadow.sample.positionDrift
    );
    authority.metrics.shadowMaxVelocityDrift = Math.max(
      authority.metrics.shadowMaxVelocityDrift ?? 0,
      shadow.sample.velocityDrift
    );
    if (shadow.sample.movementMismatch) {
      authority.metrics.shadowMovementMismatches = (authority.metrics.shadowMovementMismatches ?? 0) + 1;
    }

    recordMovementShadowDriftSample({
      roomId: this.roomId,
      matchMode: this.matchMode,
      heroId: heroId ?? 'unknown',
      movementClass: getMovementShadowClass({
        hasFlag: player.hasFlag,
        heroId: heroId ?? 'unknown',
        afterburnerActive: Boolean(
          this.getActiveBlazeAfterburnerDash(player.id, movementInput.timestamp) ||
          (player.heroId === 'blaze' && this.isBlazeAbilityInputActive(player, 'blaze_afterburner'))
        ),
        movement: {
          isGrounded: clientState.movement.isGrounded,
          isGrappling: previousMovement.isGrappling,
          isSliding: clientState.movement.isSliding,
          isGliding: clientState.movement.isGliding,
          isWallRunning: clientState.movement.isWallRunning,
        },
      }, movementInput),
      mapSeed: this.state.mapSeed,
      pingBandMs: getMovementShadowPingBand(this.playerPings.getPingMs(player.id)),
      frameRateBand: getMovementShadowFrameRateBand(movementInput),
      positionDrift: shadow.sample.positionDrift,
      velocityDrift: shadow.sample.velocityDrift,
      movementMismatch: shadow.sample.movementMismatch,
      objectiveSuppressed: this.isObjectiveSuppressed(player.id, movementInput.timestamp),
      sampledAt: movementInput.timestamp,
    });
  }

  private applyClientMovementProposal(input: {
    player: Player;
    authority: ServerMovementAuthorityState;
    command: MovementCommand | undefined;
    movementInput: PlayerInput;
    previous: LastSafeMovementState;
    previousMovement: PlayerMovementState;
    collisionWorld: MovementCollisionWorld;
    now: number;
  }): boolean {
    const { player, authority, command, movementInput, previous, previousMovement, collisionWorld, now } = input;
    const clientState = command?.clientState;
    if (!clientState) return false;
    if (
      this.playerRoots.isRooted(player.id, now) ||
      this.hookshotRuntime.hasDragPull(player.id) ||
      this.blazePhoenixDives.get(player.id)?.phase === 'hover' ||
      this.blazePhoenixDives.get(player.id)?.phase === 'dive' ||
      player.movement.isGrappling
    ) {
      return false;
    }

    const serverMovement = buildPlayerMovementSnapshot(player);
    this.recordClientMovementShadowSample({
      player,
      authority,
      movementInput,
      previous,
      clientState,
      previousMovement,
    });

    const capsule = this.getMovementCapsuleDimensions(serverMovement);
    const validation = validateMovementProposal({
      previous,
      proposedPosition: clientState.position,
      proposedVelocity: clientState.velocity,
      inputSequence: movementInput.tick,
      receivedAt: now,
      heroStats: getHeroStats(isHeroId(player.heroId) ? player.heroId : 'phantom'),
      movement: {
        isSliding: serverMovement.isSliding,
        isGrappling: serverMovement.isGrappling,
        isJetpacking: serverMovement.isJetpacking,
        isGliding: serverMovement.isGliding,
      },
      activeSpeedMultiplier: this.getActiveSpeedMultiplier(player) *
        (player.state === 'downed' ? BATTLE_ROYAL_CRAWL_SPEED_MULTIPLIER : 1),
      flagCarrier: isCaptureTheFlagMode(this.gameplayMode) && player.hasFlag,
      bounds: this.getMovementProposalBounds(),
      isInsidePlayableArea: (position) => this.isInsideMovementProposalArea(position),
      isSpaceBlocked: (position) => !canCapsuleOccupy(collisionWorld, position, capsule.height, capsule.radius),
      isPathBlocked: (from, to) => !sweepCapsulePathClear(collisionWorld, from, to, capsule.height, capsule.radius),
    });

    if (!validation.accepted) {
      const reason = validation.reason ?? 'invalid_transform';
      this.incrementMovementProposalRejectMetric(authority, reason);
      // Ask the next movement response to include the server transform without churning epochs.
      authority.lastFullAuthoritySentAt = 0;
      return false;
    }

    this.applyClientAuthoritativeMovementState(player, clientState, serverMovement);
    return true;
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
    now: number,
    collisionWorld = this.getMovementCollisionWorld(now)
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

    const swingDelta = {
      x: result.position.x - previousPosition.x,
      y: result.position.y - previousPosition.y,
      z: result.position.z - previousPosition.z,
    };
    const terrainHit = collisionWorld.sweepCapsule(previousPosition, swingDelta, PLAYER_HEIGHT, PLAYER_RADIUS);
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

    if (!canCapsuleOccupy(collisionWorld, nextPosition, PLAYER_HEIGHT, PLAYER_RADIUS)) {
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
    now = this.state.serverTime || Date.now(),
    collisionWorld = this.getMovementCollisionWorld(now)
  ): void {
    const heroId = player.heroId as HeroId;
    const heroStats = getHeroStats(heroId);
    const position = this.movementStepPosition;
    position.x = player.position.x;
    position.y = player.position.y;
    position.z = player.position.z;

    const velocity = this.movementStepVelocity;
    velocity.x = player.velocity.x;
    velocity.y = player.velocity.y;
    velocity.z = player.velocity.z;

    const movement = this.movementStepState;
    movement.isGrounded = player.movement.isGrounded;
    movement.isSprinting = player.movement.isSprinting;
    movement.isCrouching = player.movement.isCrouching;
    movement.isSliding = player.movement.isSliding;
    movement.slideTimeRemaining = player.movement.slideTimeRemaining;
    movement.isWallRunning = player.movement.isWallRunning;
    movement.wallRunSide = player.movement.wallRunSide === 'left' || player.movement.wallRunSide === 'right'
      ? player.movement.wallRunSide
      : null;
    movement.isGrappling = player.movement.isGrappling;
    movement.grapplePoint = null;
    movement.isJetpacking = player.movement.isJetpacking;
    movement.jetpackFuel = player.movement.jetpackFuel;
    movement.isGliding = player.movement.isGliding;
    movement.chronosAscendantStartY = player.movement.chronosAscendantStartY || undefined;

    const result = simulateSharedMovement({
      position,
      velocity,
      movement,
      heroStats,
      input,
      lookYaw: player.lookYaw,
      deltaTime: dt,
      terrain: this.mapRuntime.terrain,
      collisionWorld,
      flagCarrier: isCaptureTheFlagMode(this.gameplayMode) && player.hasFlag,
      activeSpeedMultiplier: this.getActiveSpeedMultiplier(player, now) *
        (player.state === 'downed' ? BATTLE_ROYAL_CRAWL_SPEED_MULTIPLIER : 1),
      chronosAscendantActive: player.state === 'downed' ? false : this.isChronosAscendantActive(player, now),
      forcedHorizontalVelocity: player.state === 'alive'
        ? this.getBlazeForcedHorizontalVelocity(player.id, now)
        : undefined,
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
    this.recordSelfMovementAuthoritySent(authority, now);
    authority.lastFullAuthoritySentAt = now;
    authority.correctionReason = null;
  }

  private sendSelfMovementAck(player: Player, client: Client): void {
    const authority = this.getMovementAuthority(player.id);
    const now = this.state.serverTime || Date.now();
    const payload: SelfMovementAck = {
      serverTick: this.state.tick,
      serverTime: now,
      ackSeq: authority.lastProcessedSeq,
      movementEpoch: authority.movementEpoch,
      collisionRevision: this.getMovementCollisionRevision(),
    };
    this.sendTracked(client, 'selfMovementAck', payload);
    this.recordSelfMovementAuthoritySent(authority, now);
  }

  private recordSelfMovementAuthoritySent(
    authority: ServerMovementAuthorityState,
    now: number
  ): void {
    if (authority.lastAuthoritySentAt > 0) {
      authority.metrics.lastAckIntervalMs = Math.max(0, now - authority.lastAuthoritySentAt);
    }
    authority.lastAuthoritySentAt = now;
    authority.metrics.authoritySends = (authority.metrics.authoritySends ?? 0) + 1;
  }

  private canSendSelfMovementAckOnly(player: Player, authority: ServerMovementAuthorityState, now: number): boolean {
    if (authority.correctionReason) return false;
    if (authority.lastFullAuthoritySentAt === 0) return false;
    if (now - authority.lastFullAuthoritySentAt >= SELF_MOVEMENT_FULL_AUTHORITY_INTERVAL_MS) return false;
    if (player.heroId === 'blaze') return false;
    if (this.isChronosAegisActive(player)) return false;
    if ((this.playerRoots.getRootedUntil(player.id, now) ?? 0) > now) return false;
    if ((this.powerupBoosts.getUntil(player.id, now) ?? 0) > now) return false;
    if (
      player.movement.isGrappling ||
      player.movement.isJetpacking ||
      player.movement.isGliding ||
      player.movement.chronosAscendantStartY
    ) {
      return false;
    }
    return true;
  }

  private sendSelfMovementAuthorityOrAck(player: Player, client: Client, reason: MovementCorrectionReason | null): void {
    const authority = this.getMovementAuthority(player.id);
    const now = this.state.serverTime || Date.now();
    if (!reason && this.canSendSelfMovementAckOnly(player, authority, now)) {
      this.sendSelfMovementAck(player, client);
      return;
    }
    this.sendSelfMovementAuthority(player, client, reason);
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

  private getAbilityCastAimPointHint(player: Player, abilityId: string | null): PlainVec3 | null {
    if (!abilityId) return null;
    const hints = player.lastInput?.abilityCastHints;
    if (!hints || hints.length === 0) return null;

    const hint = hints.find((candidate) => {
      const aimPoint = candidate.aimPoint;
      if (!aimPoint) return false;
      return candidate.abilityId === abilityId && this.isFiniteVec3(aimPoint);
    });

    return hint?.aimPoint ?? null;
  }

  private resolveValidatedCastAimPoint(
    player: Player,
    abilityId: string | null,
    aimOrigin: PlainVec3,
    fallbackForward: PlainVec3,
    maxDistance: number,
    fallbackAimPoint: PlainVec3
  ): PlainVec3 {
    const hintAimPoint = this.getAbilityCastAimPointHint(player, abilityId);
    if (!hintAimPoint) return fallbackAimPoint;

    const hintDistance = distance3D(aimOrigin, hintAimPoint);
    if (
      hintDistance <= 0.05 ||
      hintDistance > maxDistance + ABILITY_CAST_HINT_AIM_POINT_MAX_RANGE_GRACE
    ) {
      return fallbackAimPoint;
    }

    const hintDirection = this.normalize3D({
      x: hintAimPoint.x - aimOrigin.x,
      y: hintAimPoint.y - aimOrigin.y,
      z: hintAimPoint.z - aimOrigin.z,
    });
    const forward = this.normalize3D(fallbackForward);
    if (!hintDirection || !forward) return fallbackAimPoint;

    const forwardDot =
      hintDirection.x * forward.x +
      hintDirection.y * forward.y +
      hintDirection.z * forward.z;
    if (forwardDot < ABILITY_CAST_HINT_MIN_AIM_FORWARD_DOT) return fallbackAimPoint;

    return this.hasLineOfSight(aimOrigin, hintAimPoint) ? hintAimPoint : fallbackAimPoint;
  }

  private resolveValidatedCastAimDirection(
    player: Player,
    abilityId: string | null,
    aimOrigin: PlainVec3,
    fallbackForward: PlainVec3,
    maxDistance: number
  ): PlainVec3 {
    const fallbackAimPoint = this.addScaled3D(aimOrigin, fallbackForward, maxDistance);
    const aimPoint = this.resolveValidatedCastAimPoint(
      player,
      abilityId,
      aimOrigin,
      fallbackForward,
      maxDistance,
      fallbackAimPoint
    );
    return this.normalize3D({
      x: aimPoint.x - aimOrigin.x,
      y: aimPoint.y - aimOrigin.y,
      z: aimPoint.z - aimOrigin.z,
    }) ?? fallbackForward;
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
    const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y + direction.z * direction.z);
    if (length <= 0.0001) return null;

    const dirX = direction.x / length;
    const dirY = direction.y / length;
    const dirZ = direction.z / length;
    const steps = Math.max(1, Math.ceil(maxDistance / step));
    let lastOpenX = start.x;
    let lastOpenY = start.y;
    let lastOpenZ = start.z;
    const point = this.terrainRaycastPointScratch;
    for (let i = 1; i <= steps; i++) {
      const distance = Math.min(maxDistance, i * step);
      point.x = start.x + dirX * distance;
      point.y = start.y + dirY * distance;
      point.z = start.z + dirZ * distance;
      if (isCollisionBlock(this.getBlockAtWorld(point))) {
        return { x: lastOpenX, y: lastOpenY, z: lastOpenZ };
      }
      lastOpenX = point.x;
      lastOpenY = point.y;
      lastOpenZ = point.z;
    }

    return null;
  }

  private isNearCollisionSurface(point: PlainVec3, radius = HOOKSHOT_GRAPPLE_HINT_SURFACE_PROBE_DISTANCE): boolean {
    const probes = [
      { x: 0, y: 0, z: 0 },
      { x: radius, y: 0, z: 0 },
      { x: -radius, y: 0, z: 0 },
      { x: 0, y: radius, z: 0 },
      { x: 0, y: -radius, z: 0 },
      { x: 0, y: 0, z: radius },
      { x: 0, y: 0, z: -radius },
    ];

    return probes.some((probe) => isCollisionBlock(this.getBlockAtWorld({
      x: point.x + probe.x,
      y: point.y + probe.y,
      z: point.z + probe.z,
    })));
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
    const fallbackAimPoint = this.raycastTerrain(aimOrigin, lookDirection, maxDistance)
      ?? this.addScaled3D(aimOrigin, lookDirection, maxDistance);
    const aimPoint = this.resolveValidatedCastAimPoint(
      player,
      abilityId,
      aimOrigin,
      lookDirection,
      maxDistance,
      fallbackAimPoint
    );
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

    const downwardDirection = this.normalize3D({
      x: lookDirection.x,
      y: Math.min(lookDirection.y, -0.1),
      z: lookDirection.z,
    });
    const fallbackHit = directHit ?? (downwardDirection
      ? this.raycastTerrain(aimOrigin, downwardDirection, GRAPPLE_MAX_DISTANCE)
      : null);
    const hintedPoint = this.getAbilityCastAimPointHint(player, 'hookshot_grapple');
    if (hintedPoint) {
      const hintFallback = fallbackHit ?? this.addScaled3D(aimOrigin, lookDirection, GRAPPLE_MAX_DISTANCE);
      const validatedHint = this.resolveValidatedCastAimPoint(
        player,
        'hookshot_grapple',
        aimOrigin,
        lookDirection,
        GRAPPLE_MAX_DISTANCE,
        hintFallback
      );
      if (distance3D(validatedHint, hintedPoint) <= 0.001 && this.isNearCollisionSurface(validatedHint)) {
        return validatedHint;
      }
    }

    return fallbackHit;
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
    const ready = this.pendingAreaDamage.drainReadyInto(now, this.pendingAreaDamageReady);
    for (let index = 0; index < ready.length; index++) {
      const instance = ready[index];
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
    ready.length = 0;
  }

  private createBlazeGearstorm(
    player: Player,
    position: PlainVec3,
    now: number,
    durationSeconds: number
  ): void {
    this.blazeLingeringAreas.add({
      id: this.abilityIds.nextBlazeGearstormId(player.id),
      ownerId: player.id,
      ownerTeam: player.team as Team,
      position,
      radius: BLAZE_GEARSTORM_RADIUS,
      damage: BLAZE_GEARSTORM_DAMAGE,
      damageIntervalMs: BLAZE_GEARSTORM_DAMAGE_INTERVAL_MS,
      damageType: 'airstrike',
      abilityId: 'blaze_airstrike',
      falloffScale: 0.35,
      startTime: now,
      endTime: now + durationSeconds * 1000,
    });
  }

  private updateBlazeLingeringAreas(now: number): void {
    this.blazeLingeringAreas.update(now, {
      hasOwner: (ownerId) => this.state.players.has(ownerId),
      getTargets: (area) => this.queryPlayersRadius(
        area.position,
        area.radius,
        { excludeTeam: area.ownerTeam, includeDowned: true }
      ),
      applyDamage: (area, target, distance) => {
        this.applyDamage(
          target,
          calculateFalloffDamage(area.damage, distance, area.radius, area.falloffScale),
          area.ownerId,
          area.damageType,
          {
            abilityId: area.abilityId,
            sourcePosition: area.position,
          }
        );
      },
    });
  }

  private getBlazeAfterburnerGroundPoint(position: PlainVec3): PlainVec3 | null {
    const groundY = this.getProceduralGroundY({
      x: position.x,
      y: position.y + 0.25,
      z: position.z,
    });
    return groundY === null ? null : {
      x: position.x,
      y: groundY,
      z: position.z,
    };
  }

  private startBlazeAfterburnerDash(player: Player, now: number): void {
    const startPosition = vec3SchemaToPlain(player.position);
    const groundedStart = this.getBlazeAfterburnerGroundPoint(startPosition);
    const trailId = this.abilityIds.nextSharedCastId(player.id, 'blaze_afterburner_trail');
    this.blazeAfterburnerTrails.add({
      id: trailId,
      ownerId: player.id,
      ownerTeam: player.team as Team,
      points: groundedStart ? [groundedStart] : [],
      radius: BLAZE_AFTERBURNER_TRAIL_RADIUS,
      damage: BLAZE_AFTERBURNER_TRAIL_DAMAGE,
      damageIntervalMs: BLAZE_AFTERBURNER_TRAIL_DAMAGE_INTERVAL_MS,
      startTime: now,
      endTime: now + BLAZE_AFTERBURNER_TRAIL_DURATION_MS,
    });
    this.blazeAfterburnerDashes.set(player.id, {
      playerId: player.id,
      trailId,
      direction: getBlazeAfterburnerDirection(player.lookYaw),
      expiresAt: now + BLAZE_AFTERBURNER_DASH_DURATION_MS,
      lastSamplePosition: startPosition,
    });
  }

  private stopBlazeAfterburnerDash(playerId: string): void {
    this.blazeAfterburnerDashes.delete(playerId);
  }

  private startBlazePhoenixDive(player: Player, launchPosition: PlainVec3, now: number): void {
    const castId = this.abilityIds.nextSharedCastId(player.id, 'blaze_phoenix_dive');
    const hoverAt = now + BLAZE_PHOENIX_DIVE_LAUNCH_DURATION_MS;
    const launchGroundY = this.getProceduralGroundY({
      x: launchPosition.x,
      y: launchPosition.y + 80,
      z: launchPosition.z,
    });
    this.blazePhoenixDives.set(player.id, {
      castId,
      targetPosition: null,
      hoverAt,
      hoverEndsAt: hoverAt + BLAZE_PHOENIX_DIVE_HOVER_DURATION_MS,
      impactDeadline: 0,
      fallbackImpactGroundY: launchGroundY ?? launchPosition.y - PLAYER_HEIGHT / 2,
      hoverMotion: null,
      launchYaw: player.lookYaw,
      phase: 'launch',
    });

    this.broadcastExactPlayerEvent('abilityUsed', player, {
      playerId: player.id,
      abilityId: 'blaze_phoenix_dive',
      castId,
      phase: 'launch',
      position: vec3SchemaToPlain(player.position),
      startPosition: launchPosition,
      velocity: vec3SchemaToPlain(player.velocity),
      launchYaw: player.lookYaw,
      ownerTeam: player.team as Team,
      serverTime: now,
      releaseAt: hoverAt,
      radius: BLAZE_PHOENIX_DIVE_RADIUS,
    });
  }

  private beginBlazePhoenixDiveHover(
    player: Player,
    dive: BlazePhoenixDiveRuntime,
    now: number
  ): void {
    dive.hoverMotion = createBlazePhoenixDiveHoverMotion(
      vec3SchemaToPlain(player.velocity),
      dive.launchYaw,
      now,
    );
    const hoverVelocity = getBlazePhoenixDiveHoverVelocity(dive.hoverMotion, now);
    player.velocity.x = hoverVelocity.x;
    player.velocity.y = hoverVelocity.y;
    player.velocity.z = hoverVelocity.z;
    player.movement.isGrounded = false;
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
    player.movement.isWallRunning = false;
    player.movement.wallRunSide = '';
    dive.phase = 'hover';
    dive.hoverEndsAt = now + BLAZE_PHOENIX_DIVE_HOVER_DURATION_MS;
    this.markMovementBarrier(player.id, 'teleport', { preserveQueuedCommands: true });

    this.broadcastExactPlayerEvent('abilityUsed', player, {
      playerId: player.id,
      abilityId: 'blaze_phoenix_dive',
      castId: dive.castId,
      phase: 'hover',
      position: vec3SchemaToPlain(player.position),
      velocity: vec3SchemaToPlain(player.velocity),
      launchYaw: dive.launchYaw,
      ownerTeam: player.team as Team,
      serverTime: now,
      releaseAt: dive.hoverEndsAt,
      radius: BLAZE_PHOENIX_DIVE_RADIUS,
    });
  }

  private applyBlazePhoenixDiveHoverVelocity(
    player: Player,
    dive: BlazePhoenixDiveRuntime,
    now: number,
  ): void {
    if (!dive.hoverMotion) return;
    const velocity = getBlazePhoenixDiveHoverVelocity(dive.hoverMotion, now);
    player.velocity.x = velocity.x;
    player.velocity.y = velocity.y;
    player.velocity.z = velocity.z;
    player.movement.isGrounded = false;
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
  }

  private confirmBlazePhoenixDive(player: Player, dive: BlazePhoenixDiveRuntime, now: number): void {
    if (dive.phase !== 'hover') return;
    dive.targetPosition = this.resolveBlazeGroundTarget(
      player,
      'blaze_phoenix_dive',
      BLAZE_PHOENIX_DIVE_MAX_RANGE,
      0
    );
    this.beginBlazePhoenixDiveDescent(player, dive, now);
  }

  private beginBlazePhoenixDiveDescent(
    player: Player,
    dive: BlazePhoenixDiveRuntime,
    now: number
  ): void {
    if (!dive.targetPosition) {
      dive.targetPosition = this.resolveBlazeGroundTarget(
        player,
        'blaze_phoenix_dive',
        BLAZE_PHOENIX_DIVE_MAX_RANGE,
        0
      );
    }
    const targetPosition = dive.targetPosition;
    const divePosition = getBlazePhoenixDiveStartPosition(
      vec3SchemaToPlain(player.position),
      targetPosition
    );
    const diveVelocity = getBlazePhoenixDiveVelocity();
    player.position.x = divePosition.x;
    player.position.y = divePosition.y;
    player.position.z = divePosition.z;
    player.velocity.x = diveVelocity.x;
    player.velocity.y = diveVelocity.y;
    player.velocity.z = diveVelocity.z;
    player.movement.isGrounded = false;
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
    player.movement.isWallRunning = false;
    player.movement.wallRunSide = '';
    dive.phase = 'dive';
    dive.impactDeadline = now + BLAZE_PHOENIX_DIVE_MAX_FALL_DURATION_MS;
    this.markMovementBarrier(player.id, 'teleport', { preserveQueuedCommands: true });

    this.broadcastExactPlayerEvent('abilityUsed', player, {
      playerId: player.id,
      abilityId: 'blaze_phoenix_dive',
      castId: dive.castId,
      phase: 'dive',
      position: divePosition,
      targetPosition,
      velocity: diveVelocity,
      ownerTeam: player.team as Team,
      serverTime: now,
      impactTime: dive.impactDeadline,
      radius: BLAZE_PHOENIX_DIVE_RADIUS,
    });
  }

  private finishBlazePhoenixDive(player: Player, dive: BlazePhoenixDiveRuntime, now: number): void {
    if (!dive.targetPosition) return;
    const refreshedGroundY = this.getProceduralGroundY({
      x: dive.targetPosition.x,
      y: Math.max(dive.targetPosition.y + 80, player.position.y + 80),
      z: dive.targetPosition.z,
    });
    const impactPosition = {
      x: dive.targetPosition.x,
      y: refreshedGroundY ?? dive.fallbackImpactGroundY,
      z: dive.targetPosition.z,
    };
    player.position.x = impactPosition.x;
    player.position.y = impactPosition.y + PLAYER_HEIGHT / 2 + 0.06;
    player.position.z = impactPosition.z;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    player.movement.isGrounded = true;
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
    player.movement.isWallRunning = false;
    player.movement.wallRunSide = '';
    this.blazePhoenixDives.delete(player.id);
    this.markMovementBarrier(player.id, 'teleport', { preserveQueuedCommands: true });
    this.applyAreaDamage(
      player,
      impactPosition,
      BLAZE_PHOENIX_DIVE_RADIUS,
      BLAZE_PHOENIX_DIVE_DAMAGE,
      'phoenix_dive'
    );

    this.broadcastExactPlayerEvent('abilityUsed', player, {
      playerId: player.id,
      abilityId: 'blaze_phoenix_dive',
      castId: dive.castId,
      phase: 'impact',
      position: vec3SchemaToPlain(player.position),
      velocity: vec3SchemaToPlain(player.velocity),
      targetPosition: dive.targetPosition,
      impactPosition,
      ownerTeam: player.team as Team,
      serverTime: now,
      radius: BLAZE_PHOENIX_DIVE_RADIUS,
    });
  }

  private updateBlazePhoenixDives(now: number): void {
    for (const [playerId, dive] of this.blazePhoenixDives) {
      const player = this.state.players.get(playerId);
      if (!player || player.state !== 'alive') {
        this.blazePhoenixDives.delete(playerId);
        continue;
      }
      if (dive.phase === 'launch') {
        if (now >= dive.hoverAt) this.beginBlazePhoenixDiveHover(player, dive, now);
        continue;
      }
      if (dive.phase === 'hover') {
        if (now >= dive.hoverEndsAt) {
          this.confirmBlazePhoenixDive(player, dive, now);
        }
        continue;
      }
      if (player.movement.isGrounded || now >= dive.impactDeadline) {
        this.finishBlazePhoenixDive(player, dive, now);
      }
    }
  }

  private getActiveBlazeAfterburnerDash(playerId: string, now: number): BlazeAfterburnerDashRuntime | null {
    const dash = this.blazeAfterburnerDashes.get(playerId);
    return dash && now < dash.expiresAt ? dash : null;
  }

  private getBlazeForcedHorizontalVelocity(playerId: string, now: number): { x: number; z: number } | undefined {
    const phoenixDive = this.blazePhoenixDives.get(playerId);
    if (phoenixDive?.phase === 'dive') {
      return { x: 0, z: 0 };
    }
    if (phoenixDive?.phase === 'hover' && phoenixDive.hoverMotion) {
      const velocity = getBlazePhoenixDiveHoverVelocity(phoenixDive.hoverMotion, now);
      return { x: velocity.x, z: velocity.z };
    }
    const dash = this.getActiveBlazeAfterburnerDash(playerId, now);
    return dash
      ? {
        x: dash.direction.x * BLAZE_AFTERBURNER_DASH_SPEED,
        z: dash.direction.z * BLAZE_AFTERBURNER_DASH_SPEED,
      }
      : undefined;
  }

  private appendBlazeAfterburnerTrailSamples(dash: BlazeAfterburnerDashRuntime, position: PlainVec3): void {
    const dx = position.x - dash.lastSamplePosition.x;
    const dy = position.y - dash.lastSamplePosition.y;
    const dz = position.z - dash.lastSamplePosition.z;
    const horizontalDistance = Math.hypot(dx, dz);
    if (horizontalDistance <= 0.02) return;
    const sampleCount = Math.max(1, Math.ceil(horizontalDistance / BLAZE_AFTERBURNER_TRAIL_SAMPLE_SPACING));
    for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex++) {
      const alpha = sampleIndex / sampleCount;
      const groundedPoint = this.getBlazeAfterburnerGroundPoint({
        x: dash.lastSamplePosition.x + dx * alpha,
        y: dash.lastSamplePosition.y + dy * alpha,
        z: dash.lastSamplePosition.z + dz * alpha,
      });
      if (groundedPoint) {
        this.blazeAfterburnerTrails.appendPoint(dash.trailId, groundedPoint);
      }
    }
    dash.lastSamplePosition = position;
  }

  private updateBlazeAfterburnerDashEmitters(now: number): void {
    for (const [playerId, dash] of this.blazeAfterburnerDashes) {
      const player = this.state.players.get(playerId);
      if (!player || player.state !== 'alive') {
        this.blazeAfterburnerDashes.delete(playerId);
        continue;
      }
      this.appendBlazeAfterburnerTrailSamples(dash, vec3SchemaToPlain(player.position));
      if (now >= dash.expiresAt) {
        this.blazeAfterburnerDashes.delete(playerId);
      }
    }
  }

  private updateBlazeAfterburnerTrails(now: number): void {
    this.blazeAfterburnerTrails.update(now, {
      hasOwner: (ownerId) => this.state.players.has(ownerId),
      getTargets: (trail) => {
        if (trail.points.length === 0) return [];
        let minX = trail.points[0]?.x ?? 0;
        let maxX = minX;
        let minY = trail.points[0]?.y ?? 0;
        let maxY = minY;
        let minZ = trail.points[0]?.z ?? 0;
        let maxZ = minZ;
        for (let index = 1; index < trail.points.length; index++) {
          const point = trail.points[index];
          minX = Math.min(minX, point.x);
          maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y);
          maxY = Math.max(maxY, point.y);
          minZ = Math.min(minZ, point.z);
          maxZ = Math.max(maxZ, point.z);
        }
        const center = {
          x: (minX + maxX) * 0.5,
          y: (minY + maxY) * 0.5,
          z: (minZ + maxZ) * 0.5,
        };
        const halfLength = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 0.5;
        return this.queryPlayersRadius(
          center,
          halfLength + trail.radius,
          { excludeTeam: trail.ownerTeam, excludeId: trail.ownerId, includeDowned: true }
        );
      },
      applyDamage: (trail, target) => {
        this.applyDamage(target, trail.damage, trail.ownerId, 'afterburner', {
          abilityId: 'blaze_afterburner',
          sourcePosition: trail.points[0],
        });
      },
    });
  }

  private applyHookshotGroundHooksRoot(caster: Player, now: number): HookshotGroundHooksTarget[] {
    const ownerTeam = caster.team as Team;
    const rootUntil = now + HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS * 1000;
    const targets = this.queryPlayersRadius(
      caster.position,
      HOOKSHOT_GROUND_HOOKS_RADIUS,
      { excludeTeam: ownerTeam }
    );
    const rootedTargets: HookshotGroundHooksTarget[] = [];

    for (const target of targets) {
      if (target.state !== 'alive') continue;
      this.playerRoots.extendRoot(target.id, rootUntil);
      this.stopRootedMovement(target);
      this.markRootedMovementAuthority(target, now);
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
    const fallbackImpact = this.addScaled3D(aimOrigin, lookDirection, BLAZE_ROCKET_AIM_DISTANCE);
    const rawAimPoint = terrainHit ?? fallbackImpact;
    let intendedImpactPosition = this.resolveValidatedCastAimPoint(
      player,
      'blaze_rocket',
      aimOrigin,
      lookDirection,
      BLAZE_ROCKET_AIM_DISTANCE,
      rawAimPoint
    );
    const correctedForward = this.normalize3D({
      x: intendedImpactPosition.x - aimOrigin.x,
      y: intendedImpactPosition.y - aimOrigin.y,
      z: intendedImpactPosition.z - aimOrigin.z,
    }) ?? lookDirection;
    const targetHit = this.findTargetHitInAimCone(
      player,
      attack.range,
      attack.coneDot,
      attack.collisionRadius ?? 0,
      'enemy',
      { origin: aimOrigin, forward: correctedForward }
    );
    const targetPoint = targetHit?.hit.targetPoint ?? null;
    if (targetPoint && distance3D(aimOrigin, targetPoint) <= distance3D(aimOrigin, intendedImpactPosition)) {
      intendedImpactPosition = targetPoint;
    }
    const intendedImpactDistance = Math.min(
      BLAZE_ROCKET_AIM_DISTANCE,
      distance3D(aimOrigin, intendedImpactPosition)
    );
    const shieldDirection = this.normalize3D({
      x: intendedImpactPosition.x - aimOrigin.x,
      y: intendedImpactPosition.y - aimOrigin.y,
      z: intendedImpactPosition.z - aimOrigin.z,
    }) ?? correctedForward;
    const aegisHit = this.getChronosAegisSkillHit(player, aimOrigin, shieldDirection, intendedImpactDistance, {
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

    const magazine = this.getOrCreatePrimaryMagazine(player);

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
      ammoRemaining: magazine?.ammo,
      reloadStartedAt: magazine && magazine.reloadUntil > now ? magazine.reloadStartedAt : undefined,
      reloadUntil: magazine && magazine.reloadUntil > now ? magazine.reloadUntil : undefined,
    });
  }

  private fireBlazeScrapshot(player: Player, attack: AttackConfig, now: number): void {
    const castId = this.abilityIds.nextSharedCastId(player.id, 'blaze_scrapshot');
    const aimOrigin = this.getBlazeAimOrigin(player);
    const startPosition = this.getAbilitySocketCastOrigin(player, 'blaze_scrapshot');
    const rawForward = getForwardVector(player.lookYaw, player.lookPitch);
    const aimDirection = this.resolveValidatedCastAimDirection(
      player,
      'blaze_scrapshot',
      aimOrigin,
      rawForward,
      BLAZE_SCRAPSHOT_RANGE
    );
    const candidates = [...this.queryPlayersConeCandidates(
      aimOrigin,
      BLAZE_SCRAPSHOT_RANGE,
      {
        excludeTeam: player.team as Team,
        excludeId: player.id,
        includeDowned: true,
      }
    )];
    const targetIds = new Set<string>();
    const visibilityRecordedTargetIds = new Set<string>();
    const pelletImpacts: Array<{
      position: PlainVec3;
      kind: 'miss' | 'terrain' | 'player' | 'aegis';
    }> = [];
    let interceptedByChronosAegis = false;

    for (const pelletDirection of getBlazeScrapshotPelletDirections(aimDirection)) {
      const fallbackEndpoint = this.addScaled3D(aimOrigin, pelletDirection, BLAZE_SCRAPSHOT_RANGE);
      const terrainHit = this.raycastTerrain(aimOrigin, pelletDirection, BLAZE_SCRAPSHOT_RANGE, 0.18);
      const terrainDistance = terrainHit ? distance3D(aimOrigin, terrainHit) : Number.POSITIVE_INFINITY;
      const aegisHit = this.getChronosAegisSkillHit(
        player,
        aimOrigin,
        pelletDirection,
        BLAZE_SCRAPSHOT_RANGE,
        { projectileRadius: attack.collisionRadius ?? 0 }
      );

      let targetHit: AimTargetHit | null = null;
      for (const target of candidates) {
        const hit = this.getAimHitAgainstPlayer(
          aimOrigin,
          pelletDirection,
          BLAZE_SCRAPSHOT_RANGE,
          target
        );
        if (!hit || (targetHit && hit.distance >= targetHit.hit.distance)) continue;
        targetHit = { target, hit };
      }

      const targetDistance = targetHit?.hit.distance ?? Number.POSITIVE_INFINITY;
      const aegisDistance = aegisHit?.distance ?? Number.POSITIVE_INFINITY;
      if (aegisHit && aegisDistance <= terrainDistance && aegisDistance <= targetDistance) {
        interceptedByChronosAegis = true;
        this.absorbDamageWithChronosAegis(aegisHit.blocker, attack.damage, now, {
          source: player,
          damageType: attack.damageType,
          position: aegisHit.point,
          direction: aegisHit.normal,
        });
        pelletImpacts.push({ position: aegisHit.point, kind: 'aegis' });
        continue;
      }

      if (targetHit && targetDistance <= terrainDistance) {
        const target = targetHit.target;
        targetIds.add(target.id);
        if (!visibilityRecordedTargetIds.has(target.id)) {
          visibilityRecordedTargetIds.add(target.id);
          this.recordCombatVisibilityAtHit(player, target, 'primary', attack.damageType, now);
        }
        this.applyDamage(
          target,
          calculateBlazeScrapshotPelletDamage(targetDistance),
          player.id,
          attack.damageType,
          {
            abilityId: 'blaze_scrapshot',
            sourcePosition: aimOrigin,
            sourceDirection: pelletDirection,
          }
        );
        pelletImpacts.push({ position: targetHit.hit.targetPoint, kind: 'player' });
        continue;
      }

      if (terrainHit) {
        pelletImpacts.push({ position: terrainHit, kind: 'terrain' });
      } else {
        pelletImpacts.push({ position: fallbackEndpoint, kind: 'miss' });
      }
    }

    const magazine = this.getOrCreatePrimaryMagazine(player);
    this.broadcastExactPlayerEvent('abilityUsed', player, {
      playerId: player.id,
      abilityId: 'blaze_scrapshot',
      castId,
      position: vec3SchemaToPlain(player.position),
      startPosition,
      aimDirection,
      pelletImpacts,
      targetIds: Array.from(targetIds),
      interceptedByChronosAegis,
      ownerTeam: player.team as Team,
      launchYaw: player.lookYaw,
      serverTime: now,
      ammoRemaining: magazine?.ammo,
      reloadStartedAt: magazine && magazine.reloadUntil > now ? magazine.reloadStartedAt : undefined,
      reloadUntil: magazine && magazine.reloadUntil > now ? magazine.reloadUntil : undefined,
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
    const fallbackAimPoint = this.addScaled3D(aimOrigin, lookDirection, CHRONOS_VERDANT_PULSE_AIM_DISTANCE);
    let aimPoint = this.resolveValidatedCastAimPoint(
      player,
      'chronos_verdant_pulse',
      aimOrigin,
      lookDirection,
      CHRONOS_VERDANT_PULSE_AIM_DISTANCE,
      terrainHit ?? fallbackAimPoint
    );
    const correctedForward = this.normalize3D({
      x: aimPoint.x - aimOrigin.x,
      y: aimPoint.y - aimOrigin.y,
      z: aimPoint.z - aimOrigin.z,
    }) ?? lookDirection;
    const targetHit = this.findTargetHitInAimCone(
      player,
      attack.range,
      attack.coneDot,
      attack.collisionRadius ?? 0,
      'enemy',
      { origin: aimOrigin, forward: correctedForward }
    );
    const targetPoint = targetHit?.hit.targetPoint ?? null;
    if (targetPoint && distance3D(aimOrigin, targetPoint) <= distance3D(aimOrigin, aimPoint)) {
      aimPoint = targetPoint;
    }
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
    const magazine = this.getOrCreatePrimaryMagazine(player);

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
      ammoRemaining: magazine?.ammo,
      reloadStartedAt: magazine && magazine.reloadUntil > now ? magazine.reloadStartedAt : undefined,
      reloadUntil: magazine && magazine.reloadUntil > now ? magazine.reloadUntil : undefined,
    });
  }

  private resolveBlazeGroundTarget(
    player: Player,
    abilityId: 'blaze_bomb' | 'blaze_phosphor_flare' | 'blaze_phoenix_dive',
    maxRange: number,
    minRange: number
  ): PlainVec3 {
    const aimOrigin = this.getBlazeAimOrigin(player);
    const lookDirection = getForwardVector(player.lookYaw, player.lookPitch);
    const terrainHit = this.raycastTerrain(aimOrigin, lookDirection, maxRange);
    let targetPosition = this.resolveValidatedCastAimPoint(
      player,
      abilityId,
      aimOrigin,
      lookDirection,
      maxRange,
      terrainHit ?? this.addScaled3D(aimOrigin, lookDirection, maxRange)
    );

    const horizontalDistance = distance2D(aimOrigin, targetPosition);
    if (horizontalDistance < minRange) {
      const forward = forward2D(player.lookYaw);
      targetPosition = {
        x: aimOrigin.x + forward.x * minRange,
        y: targetPosition.y,
        z: aimOrigin.z + forward.z * minRange,
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
    const targetPosition = this.resolveBlazeGroundTarget(
      player,
      'blaze_bomb',
      BLAZE_BOMB_MAX_RANGE,
      BLAZE_BOMB_MIN_RANGE
    );
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

  private getBlazePhosphorFlareAegisHit(
    player: Player,
    startPosition: PlainVec3,
    targetPosition: PlainVec3,
    projectileRadius: number
  ): (ChronosAegisSkillHit & { progress: number }) | null {
    let segmentStart = startPosition;

    for (let index = 0; index < BLAZE_PHOSPHOR_FLARE_PATH_SEGMENTS; index++) {
      const segmentEndProgress = (index + 1) / BLAZE_PHOSPHOR_FLARE_PATH_SEGMENTS;
      const segmentEnd = getBlazePhosphorFlarePoint(startPosition, targetPosition, segmentEndProgress);
      const segmentDirection = this.normalize3D({
        x: segmentEnd.x - segmentStart.x,
        y: segmentEnd.y - segmentStart.y,
        z: segmentEnd.z - segmentStart.z,
      });
      const segmentDistance = distance3D(segmentStart, segmentEnd);
      if (segmentDirection && segmentDistance > 0.0001) {
        const hit = this.getChronosAegisSkillHit(
          player,
          segmentStart,
          segmentDirection,
          segmentDistance,
          { projectileRadius }
        );
        if (hit) {
          return {
            ...hit,
            progress: clamp(
              (index + hit.distance / segmentDistance) / BLAZE_PHOSPHOR_FLARE_PATH_SEGMENTS,
              0,
              1
            ),
          };
        }
      }
      segmentStart = segmentEnd;
    }

    return null;
  }

  private dropBlazePhosphorFlare(player: Player, attack: AttackConfig, now: number): void {
    const abilityId = 'blaze_phosphor_flare';
    const castId = this.abilityIds.nextSharedCastId(player.id, abilityId);
    const startPosition = this.getAbilitySocketCastOrigin(player, abilityId);
    const targetPosition = this.resolveBlazeGroundTarget(
      player,
      abilityId,
      BLAZE_PHOSPHOR_FLARE_MAX_RANGE,
      BLAZE_PHOSPHOR_FLARE_MIN_RANGE
    );
    const flightDurationMs = getBlazePhosphorFlareFlightDurationMs(startPosition, targetPosition);
    const aegisHit = this.getBlazePhosphorFlareAegisHit(
      player,
      startPosition,
      targetPosition,
      getChronosAegisCollisionRadiusForAttack(attack)
    );
    const impactProgress = aegisHit?.progress ?? 1;
    const impactTime = now + Math.max(60, Math.round(flightDurationMs * impactProgress));

    if (aegisHit) {
      this.absorbDamageWithChronosAegis(aegisHit.blocker, attack.damage, now, {
        source: player,
        damageType: attack.damageType,
        position: aegisHit.point,
        direction: aegisHit.normal,
      });
    } else {
      this.blazeLingeringAreas.add({
        id: castId,
        ownerId: player.id,
        ownerTeam: player.team as Team,
        position: targetPosition,
        radius: attack.radius ?? BLAZE_PHOSPHOR_FLARE_RADIUS,
        damage: attack.damage,
        damageIntervalMs: BLAZE_PHOSPHOR_FLARE_DAMAGE_INTERVAL_MS,
        damageType: attack.damageType,
        abilityId,
        falloffScale: 0,
        startTime: impactTime,
        endTime: impactTime + BLAZE_PHOSPHOR_FLARE_DURATION_MS,
      });
    }

    this.broadcastExactPlayerEvent('abilityUsed', player, {
      playerId: player.id,
      abilityId,
      castId,
      position: vec3SchemaToPlain(player.position),
      startPosition,
      targetPosition,
      impactPosition: aegisHit?.point ?? targetPosition,
      interceptedByChronosAegis: Boolean(aegisHit),
      impactProgress,
      impactTime,
      aimDirection: getForwardVector(player.lookYaw, player.lookPitch),
      ownerTeam: player.team as Team,
      launchYaw: player.lookYaw,
      serverTime: now,
      radius: attack.radius,
      duration: BLAZE_PHOSPHOR_FLARE_DURATION_MS / 1000,
    });
  }

  private broadcastPhantomCast(payload: PhantomCastPayload): void {
    const caster = this.state.players.get(payload.playerId);
    if (!caster) return;
    this.broadcastExactPlayerEvent('abilityUsed', caster, payload as unknown as Record<string, unknown>);
  }

  private broadcastPhantomAttackCast(
    player: Player,
    abilityId: 'phantom_dire_ball' | 'phantom_soulrend_daggers' | 'phantom_void_ray' | 'phantom_rift_bolt',
    now: number,
    range: number,
    impactHint: SkillImpactHint = {}
  ): void {
    const lookDirection = getForwardVector(player.lookYaw, player.lookPitch);
    const aimOrigin = this.getPlayerEyePosition(player);
    const launchSide = abilityId === 'phantom_dire_ball' || abilityId === 'phantom_soulrend_daggers'
      ? this.getNextPhantomPrimaryLaunchSide(player.id)
      : 1;
    const startPosition = this.getAbilitySocketCastOrigin(player, abilityId, launchSide);
    const aimPoint = impactHint.impactPosition ?? this.resolveValidatedCastAimPoint(
      player,
      abilityId,
      aimOrigin,
      lookDirection,
      range,
      this.addScaled3D(aimOrigin, lookDirection, range)
    );
    const aimDirection = this.normalize3D({
      x: aimPoint.x - startPosition.x,
      y: aimPoint.y - startPosition.y,
      z: aimPoint.z - startPosition.z,
    }) ?? lookDirection;
    const magazine = abilityId === 'phantom_dire_ball' || abilityId === 'phantom_soulrend_daggers'
      ? this.getOrCreatePrimaryMagazine(player)
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

  private firePhantomSoulrend(player: Player, attack: AttackConfig, now: number): void {
    const abilityId = 'phantom_soulrend_daggers';
    const origin = this.getPlayerEyePosition(player);
    const rawForward = getForwardVector(player.lookYaw, player.lookPitch);
    const forward = this.resolveValidatedCastAimDirection(
      player,
      abilityId,
      origin,
      rawForward,
      attack.range,
    );
    const primaryTargetHit = this.findTargetHitInAimCone(
      player,
      attack.range,
      attack.coneDot,
      attack.collisionRadius ?? 0,
      'enemy',
      { origin, forward },
    );
    const aegisHit = this.getChronosAegisSkillHit(player, origin, forward, attack.range, {
      projectileRadius: getChronosAegisCollisionRadiusForAttack(attack),
    });
    const aegisBlocksPrimary = Boolean(
      aegisHit && (!primaryTargetHit || aegisHit.distance <= primaryTargetHit.hit.distance)
    );
    const launchSide = this.getNextPhantomPrimaryLaunchSide(player.id);
    const startPosition = this.getAbilitySocketCastOrigin(player, abilityId, launchSide);
    const magazine = this.getOrCreatePrimaryMagazine(player);
    let impactPosition: PlainVec3 | undefined;
    let ricochetPosition: PlainVec3 | undefined;
    let ricochetTargetId: string | undefined;
    const targetIds: string[] = [];

    if (aegisBlocksPrimary && aegisHit) {
      impactPosition = aegisHit.point;
      this.absorbDamageWithChronosAegis(aegisHit.blocker, attack.damage, now, {
        source: player,
        damageType: attack.damageType,
        position: aegisHit.point,
        direction: aegisHit.normal,
      });
    } else if (primaryTargetHit) {
      const primaryTarget = primaryTargetHit.target;
      impactPosition = primaryTargetHit.hit.targetPoint;
      targetIds.push(primaryTarget.id);
      this.recordCombatVisibilityAtHit(player, primaryTarget, 'primary', attack.damageType, now);
      this.applyDamage(primaryTarget, attack.damage, player.id, attack.damageType, {
        abilityId,
        sourcePosition: origin,
        sourceDirection: forward,
      });

      const ricochetTarget = selectSoulrendRicochetTarget(
        impactPosition,
        this.queryPlayersRadius(impactPosition, PHANTOM_SOULREND_RICOCHET_RADIUS, {
          excludeTeam: player.team as Team,
          excludeId: player.id,
          includeDowned: true,
        }),
        new Set([player.id, primaryTarget.id]),
      );

      if (ricochetTarget) {
        const targetPosition = this.getPlayerBodyAimPosition(ricochetTarget);
        const distance = distance3D(impactPosition, targetPosition);
        const ricochetDirection = this.normalize3D({
          x: targetPosition.x - impactPosition.x,
          y: targetPosition.y - impactPosition.y,
          z: targetPosition.z - impactPosition.z,
        });
        const ricochetAegisHit = ricochetDirection
          ? this.getChronosAegisSkillHit(player, impactPosition, ricochetDirection, distance, {
            projectileRadius: getChronosAegisCollisionRadiusForAttack(attack),
            targetPoint: targetPosition,
          })
          : null;

        if (ricochetAegisHit && ricochetAegisHit.distance <= distance) {
          ricochetPosition = ricochetAegisHit.point;
          this.absorbDamageWithChronosAegis(ricochetAegisHit.blocker, attack.damage, now, {
            source: player,
            damageType: attack.damageType,
            position: ricochetAegisHit.point,
            direction: ricochetAegisHit.normal,
          });
        } else {
          ricochetPosition = targetPosition;
          ricochetTargetId = ricochetTarget.id;
          targetIds.push(ricochetTarget.id);
          this.applyDamage(ricochetTarget, attack.damage, player.id, attack.damageType, {
            abilityId,
            sourcePosition: impactPosition,
            sourceDirection: ricochetDirection ?? forward,
          });
        }
      }
    }

    const aimPoint = impactPosition ?? this.addScaled3D(origin, forward, attack.range);
    const aimDirection = this.normalize3D({
      x: aimPoint.x - startPosition.x,
      y: aimPoint.y - startPosition.y,
      z: aimPoint.z - startPosition.z,
    }) ?? forward;

    this.broadcastPhantomCast({
      playerId: player.id,
      abilityId,
      castId: this.abilityIds.nextSharedCastId(player.id, abilityId),
      position: vec3SchemaToPlain(player.position),
      startPosition,
      impactPosition,
      ricochetPosition,
      ricochetTargetId,
      interceptedByChronosAegis: aegisBlocksPrimary,
      targetIds,
      aimDirection,
      ownerTeam: player.team as Team,
      launchSide,
      launchYaw: player.lookYaw,
      serverTime: now,
      ammoRemaining: magazine?.ammo,
      reloadStartedAt: magazine && magazine.reloadUntil > now ? magazine.reloadStartedAt : undefined,
      reloadUntil: magazine && magazine.reloadUntil > now ? magazine.reloadUntil : undefined,
    });
  }

  private firePhantomRiftBolt(player: Player, attack: AttackConfig, now: number): void {
    const abilityId = 'phantom_rift_bolt';
    const castId = this.abilityIds.nextSharedCastId(player.id, abilityId);
    const aimOrigin = this.getPlayerEyePosition(player);
    const lookDirection = getForwardVector(player.lookYaw, player.lookPitch);
    const forward = this.resolveValidatedCastAimDirection(
      player,
      abilityId,
      aimOrigin,
      lookDirection,
      attack.range,
    );
    const startPosition = this.getAbilitySocketCastOrigin(player, abilityId);
    const aimPoint = this.addScaled3D(aimOrigin, forward, attack.range);
    const direction = this.normalize3D({
      x: aimPoint.x - startPosition.x,
      y: aimPoint.y - startPosition.y,
      z: aimPoint.z - startPosition.z,
    }) ?? forward;
    const bolt = this.phantomRiftBolts.launch({
      castId,
      ownerId: player.id,
      ownerTeam: player.team as Team,
      startPosition,
      direction,
      launchedAt: now,
    });

    this.broadcastPhantomCast({
      playerId: player.id,
      abilityId,
      castId,
      position: vec3SchemaToPlain(player.position),
      startPosition,
      aimDirection: direction,
      velocity: {
        x: direction.x * PHANTOM_RIFT_BOLT_SPEED,
        y: direction.y * PHANTOM_RIFT_BOLT_SPEED,
        z: direction.z * PHANTOM_RIFT_BOLT_SPEED,
      },
      maxDistance: PHANTOM_RIFT_BOLT_MAX_DISTANCE,
      ownerTeam: player.team as Team,
      launchYaw: player.lookYaw,
      serverTime: now,
      expiresAt: bolt.expiresAt,
    });
  }

  private cancelPhantomRiftBolt(player: Player, now = Date.now()): void {
    const bolt = this.phantomRiftBolts.consume(player.id);
    if (!bolt) return;
    this.broadcastPhantomCast({
      playerId: player.id,
      abilityId: 'phantom_rift_bolt_expire',
      castId: bolt.castId,
      position: vec3SchemaToPlain(player.position),
      targetPosition: bolt.position,
      ownerTeam: bolt.ownerTeam,
      serverTime: now,
    });
  }

  private updatePhantomRiftBolts(now: number): void {
    const { advances, expired } = this.phantomRiftBolts.advance(now);

    for (const bolt of expired) {
      const owner = this.state.players.get(bolt.ownerId);
      if (!owner) continue;
      this.broadcastPhantomCast({
        playerId: bolt.ownerId,
        abilityId: 'phantom_rift_bolt_expire',
        castId: bolt.castId,
        position: vec3SchemaToPlain(owner.position),
        targetPosition: bolt.position,
        ownerTeam: bolt.ownerTeam,
        serverTime: now,
      });
    }

    for (const advance of advances) {
      const owner = this.state.players.get(advance.state.ownerId);
      if (!owner || owner.state !== 'alive') {
        this.phantomRiftBolts.clear(advance.state.ownerId);
        continue;
      }

      const direction = this.normalize3D({
        x: advance.endPosition.x - advance.startPosition.x,
        y: advance.endPosition.y - advance.startPosition.y,
        z: advance.endPosition.z - advance.startPosition.z,
      });
      if (!direction) continue;

      const terrainPoint = this.raycastTerrain(
        advance.startPosition,
        direction,
        advance.distance,
        0.15,
      );
      const terrainDistance = terrainPoint
        ? distance3D(advance.startPosition, terrainPoint)
        : Number.POSITIVE_INFINITY;
      const aegisHit = this.getChronosAegisSkillHit(
        owner,
        advance.startPosition,
        direction,
        advance.distance,
        { projectileRadius: PHANTOM_RIFT_BOLT_COLLISION_RADIUS },
      );

      let targetHit: AimTargetHit | null = null;
      const candidates = this.queryPlayersConeCandidates(
        advance.startPosition,
        advance.distance + PHANTOM_RIFT_BOLT_COLLISION_RADIUS + PLAYER_RADIUS,
        {
          excludeTeam: owner.team as Team,
          excludeId: owner.id,
          includeDowned: true,
        },
      );
      for (const target of candidates) {
        const hit = this.getAimHitAgainstPlayer(
          advance.startPosition,
          direction,
          advance.distance,
          target,
          PHANTOM_RIFT_BOLT_COLLISION_RADIUS,
        );
        if (!hit || (targetHit && hit.distance >= targetHit.hit.distance)) continue;
        targetHit = { target, hit };
      }

      const targetDistance = targetHit?.hit.distance ?? Number.POSITIVE_INFINITY;
      const aegisDistance = aegisHit?.distance ?? Number.POSITIVE_INFINITY;
      let impactPosition: PlainVec3 | null = null;
      let interceptedByChronosAegis = false;

      if (aegisHit && aegisDistance <= targetDistance && aegisDistance <= terrainDistance) {
        impactPosition = aegisHit.point;
        interceptedByChronosAegis = true;
        this.absorbDamageWithChronosAegis(aegisHit.blocker, PHANTOM_RIFT_BOLT_DAMAGE, now, {
          source: owner,
          damageType: 'rift_bolt',
          position: aegisHit.point,
          direction: aegisHit.normal,
        });
      } else if (targetHit && targetDistance <= terrainDistance) {
        impactPosition = targetHit.hit.targetPoint;
        this.recordCombatVisibilityAtHit(owner, targetHit.target, 'secondary', 'rift_bolt', now);
        this.applyDamage(targetHit.target, PHANTOM_RIFT_BOLT_DAMAGE, owner.id, 'rift_bolt', {
          abilityId: 'phantom_rift_bolt',
          sourcePosition: advance.startPosition,
          sourceDirection: direction,
        });
      } else if (terrainPoint) {
        impactPosition = terrainPoint;
      }

      if (!impactPosition) continue;
      this.phantomRiftBolts.stop(owner.id, impactPosition);
      this.broadcastPhantomCast({
        playerId: owner.id,
        abilityId: 'phantom_rift_bolt_impact',
        castId: advance.state.castId,
        position: vec3SchemaToPlain(owner.position),
        impactPosition,
        interceptedByChronosAegis,
        ownerTeam: owner.team as Team,
        serverTime: now,
        expiresAt: advance.state.expiresAt,
      });
    }
  }

  private teleportPhantomToRiftBolt(player: Player, now: number): void {
    const bolt = this.phantomRiftBolts.consume(player.id);
    if (!bolt) return;

    const startedAt = vec3SchemaToPlain(player.position);
    const offset = {
      x: bolt.position.x - startedAt.x,
      y: bolt.position.y - startedAt.y,
      z: bolt.position.z - startedAt.z,
    };
    const distance = Math.hypot(offset.x, offset.y, offset.z);
    const destination = resolveCapsuleTeleportDestination(
      this.getMovementCollisionWorld(),
      startedAt,
      offset,
      distance,
      {
        minDistance: 0,
        distanceStep: 0.25,
        clampPosition: (candidate) => this.clampToPlayableMap(candidate),
      },
    );

    player.position.x = destination.x;
    player.position.y = destination.y;
    player.position.z = destination.z;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    player.movement.isGrounded = false;
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
    player.movement.isWallRunning = false;
    player.movement.wallRunSide = '';
    this.markMovementBarrier(player.id, 'teleport', { preserveQueuedCommands: true });

    this.broadcastPhantomCast({
      playerId: player.id,
      abilityId: 'phantom_rift_bolt_teleport',
      castId: this.abilityIds.nextSharedCastId(player.id, 'phantom_rift_bolt_teleport'),
      position: destination,
      startPosition: startedAt,
      targetPosition: bolt.position,
      ownerTeam: player.team as Team,
      serverTime: now,
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

  private getBlazeRuntimeAbilityBindings(playerId: string): BlazeAbilityBindings | null {
    return this.blazeAbilityBindings.get(playerId) ?? null;
  }

  private getBlazeAbilitySelection(playerId: string): HeroAbilitySelection {
    const bindings = this.getBlazeRuntimeAbilityBindings(playerId) ?? {
      ability1: HERO_DEFINITIONS.blaze.ability1.abilityId,
      ability2: HERO_DEFINITIONS.blaze.ability2.abilityId,
    };
    return {
      ...bindings,
      ultimate: getBlazeUltimateAbilityId(this.getBlazeUltimateSkill(playerId)),
    };
  }

  private resolvePlayerAbilityId(
    player: Player,
    slot: 'ability1' | 'ability2' | 'ultimate'
  ): string | undefined {
    if (player.heroId === 'blaze') {
      const selection = this.getBlazeAbilitySelection(player.id);
      return selection[slot];
    }
    return isHeroId(player.heroId) ? HERO_DEFINITIONS[player.heroId][slot].abilityId : undefined;
  }

  private isBlazeAbilityInputActive(player: Player, abilityId: BlazeAbilityBindings[keyof BlazeAbilityBindings]): boolean {
    const input = player.lastInput;
    if (!input) return false;
    const bindings = this.getBlazeRuntimeAbilityBindings(player.id);
    if (!bindings) {
      return abilityId === 'blaze_flamethrower' ? Boolean(input.ability1) : Boolean(input.ability2);
    }
    if (bindings.ability1 === abilityId) return Boolean(input.ability1);
    if (bindings.ability2 === abilityId) return Boolean(input.ability2);
    return false;
  }

  private handlePhantomSecondaryInput(player: Player, input: PlayerInput, previousSecondaryFire: boolean, now: number): void {
    if (this.getPhantomSecondarySkill(player.id) === 'rift_bolt') {
      this.phantomVoidRayCharges.clear(player.id);
      if (!input.secondaryFire || previousSecondaryFire) return;

      if (this.phantomRiftBolts.get(player.id)) {
        if (this.playerRoots.isRooted(player.id, now)) {
          this.rejectAbilityOrCombat(player, 'rooted_movement_ability_blocked', true);
          return;
        }
        this.teleportPhantomToRiftBolt(player, now);
        return;
      }

      if (this.isPhantomPrimaryReloading(player, now)) {
        this.rejectAbilityOrCombat(player, 'phantom_reload_blocks:phantom_rift_bolt', false);
        return;
      }
      this.tryResolveAttack(player, 'secondary', now);
      return;
    }

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

    if (player.heroId === 'blaze' && slot === 'ultimate') {
      const activePhoenixDive = this.blazePhoenixDives.get(player.id);
      if (activePhoenixDive && activePhoenixDive.phase !== 'dive') {
        this.confirmBlazePhoenixDive(player, activePhoenixDive, usedAt);
        return;
      }
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
    const abilityId = this.resolvePlayerAbilityId(player, slot);
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
      const shouldLogRejection = preflightRejection.logEvent && !(
        player.isBot &&
        preflightRejection.reason === 'rooted_movement_ability_blocked'
      );
      this.rejectAbilityOrCombat(player, preflightRejection.reason, shouldLogRejection);
      return;
    }

    const result = tryUseAbility(player, slot, abilityId);
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

    if (ability.abilityId === 'blaze_afterburner') {
      this.startBlazeAfterburnerDash(player, usedAt);
    }

    if (ability.abilityId === 'blaze_phoenix_dive') {
      this.startBlazePhoenixDive(player, startedAt, usedAt);
      return;
    }

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
      if (preferredHero && this.setPlayerHero(bot, preferredHero, assignment.skinId)) {
        this.botRuntime.setPreferredHero(bot.id, preferredHero);
      }

      this.state.players.set(bot.id, bot);
      this.replicationState.markKnownPlayer(bot.id);
      this.updateLastSafeMovement(bot, 0);
      this.initializePressState(bot.id);
      this.botRuntime.setBrain(bot.id, this.createBotBrain(bot, index, {
        now: this.state.serverTime || Date.now(),
        staggerInitialSchedule: true,
      }));
    });
  }

  private createBotBrain(
    bot: Player,
    index = 0,
    options: { now?: number; staggerInitialSchedule?: boolean } = {}
  ): BotBrain {
    const brain = createInitialBotBrain(vec3SchemaToPlain(bot.position), index);
    brain.aimYaw = bot.lookYaw;
    brain.aimPitch = bot.lookPitch;
    if (options.staggerInitialSchedule) {
      const now = (options.now ?? this.state.serverTime) || Date.now();
      const scheduleSeed = (hashString(bot.id) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
      brain.nextThinkAt = now + (scheduleSeed % BOT_INITIAL_THINK_STAGGER_MS);
      brain.nextBlackboardAt = now + ((scheduleSeed >>> 8) % BOT_INITIAL_BLACKBOARD_STAGGER_MS);
    }
    return brain;
  }

  private isStreamerBotDeathmatchFeed(): boolean {
    return this.streamerManagedBotGame && this.streamerFeedMode === 'bot_deathmatch';
  }

  private initializePressState(playerId: string): void {
    this.playerPressStates.initialize(playerId);
  }

  private clearPrimaryHoldStates(playerId: string): void {
    this.phantomPrimaryHolds.clear(playerId);
    this.chronosPrimaryHolds.clear(playerId);
  }

  private getBlazePrimarySkill(playerId: string): BlazePrimarySkill {
    return this.blazePrimarySkills.get(playerId) ?? 'fireball_rockets';
  }

  private getPhantomPrimarySkill(playerId: string): PhantomPrimarySkill {
    return this.phantomPrimarySkills.get(playerId) ?? 'dire_ball';
  }

  private getPhantomSecondarySkill(playerId: string): PhantomSecondarySkill {
    return this.phantomSecondarySkills.get(playerId) ?? 'void_ray';
  }

  private getBlazeSecondarySkill(playerId: string): BlazeSecondarySkill {
    return this.blazeSecondarySkills.get(playerId) ?? 'meteor_strike';
  }

  private getBlazeUltimateSkill(playerId: string): BlazeUltimateSkill {
    return this.blazeUltimateSkills.get(playerId) ?? 'infernal_gearstorm';
  }

  private getPrimaryMagazineTracker(playerId: string, heroId: string): PrimaryMagazineTracker | null {
    if (heroId === 'phantom') {
      return this.getPhantomPrimarySkill(playerId) === 'soulrend_daggers'
        ? this.phantomSoulrendPrimaryMagazines
        : this.phantomPrimaryMagazines;
    }
    if (heroId === 'blaze') {
      return this.getBlazePrimarySkill(playerId) === 'scrapshot'
        ? this.blazeScrapshotPrimaryMagazines
        : this.blazePrimaryMagazines;
    }
    if (heroId === 'chronos') return this.chronosPrimaryMagazines;
    return null;
  }

  private resetPrimaryMagazineForHero(playerId: string, heroId: string): void {
    this.phantomPrimaryHolds.clear(playerId);

    if (heroId === 'phantom') {
      this.phantomPrimaryMagazines.clear(playerId);
      this.phantomSoulrendPrimaryMagazines.clear(playerId);
      this.getPrimaryMagazineTracker(playerId, heroId)?.reset(playerId);
      this.blazePrimaryMagazines.clear(playerId);
      this.blazeScrapshotPrimaryMagazines.clear(playerId);
      this.chronosPrimaryMagazines.clear(playerId);
    } else if (heroId === 'blaze') {
      this.blazePrimaryMagazines.clear(playerId);
      this.blazeScrapshotPrimaryMagazines.clear(playerId);
      this.getPrimaryMagazineTracker(playerId, heroId)?.reset(playerId);
      this.phantomPrimaryMagazines.clear(playerId);
      this.phantomSoulrendPrimaryMagazines.clear(playerId);
      this.chronosPrimaryMagazines.clear(playerId);
    } else if (heroId === 'chronos') {
      this.chronosPrimaryMagazines.reset(playerId);
      this.phantomPrimaryMagazines.clear(playerId);
      this.phantomSoulrendPrimaryMagazines.clear(playerId);
      this.blazePrimaryMagazines.clear(playerId);
      this.blazeScrapshotPrimaryMagazines.clear(playerId);
    } else {
      this.phantomPrimaryMagazines.clear(playerId);
      this.phantomSoulrendPrimaryMagazines.clear(playerId);
      this.blazePrimaryMagazines.clear(playerId);
      this.blazeScrapshotPrimaryMagazines.clear(playerId);
      this.chronosPrimaryMagazines.clear(playerId);
    }

    const player = this.state.players.get(playerId);
    if (player?.heroId === heroId) {
      this.sendPrimaryMagazineState(player, Date.now());
    }
  }

  private getOrCreatePrimaryMagazine(player: Player): PrimaryMagazineState | null {
    return this.getPrimaryMagazineTracker(player.id, player.heroId)?.getOrCreate(player.id) ?? null;
  }

  private completePrimaryReloadIfReady(player: Player, now: number): PrimaryMagazineState | null {
    const tracker = this.getPrimaryMagazineTracker(player.id, player.heroId);
    if (!tracker) return null;

    const { magazine, completed } = tracker.completeReloadIfReady(player.id, now);
    if (completed) {
      this.sendPrimaryMagazineState(player, now);
    }

    return magazine;
  }

  private isPrimaryReloading(player: Player, now: number): boolean {
    return (this.completePrimaryReloadIfReady(player, now)?.reloadUntil ?? 0) > now;
  }

  private isPhantomPrimaryReloading(player: Player, now: number): boolean {
    return player.heroId === 'phantom' && this.isPrimaryReloading(player, now);
  }

  private sendPrimaryMagazineState(player: Player, now: number): void {
    if (player.isBot) return;

    const tracker = this.getPrimaryMagazineTracker(player.id, player.heroId);
    if (!tracker) return;

    const client = this.clientRegistry.getClient(player.id);
    if (!client) return;

    const messageType = player.heroId === 'phantom'
      ? 'phantomPrimaryState'
      : player.heroId === 'blaze'
        ? 'blazePrimaryState'
        : 'chronosPrimaryState';
    this.sendTracked(client, messageType, tracker.getClientState(player.id, now));
  }

  private consumePrimaryShot(player: Player, now: number): boolean {
    const tracker = this.getPrimaryMagazineTracker(player.id, player.heroId);
    if (!tracker) return true;

    this.completePrimaryReloadIfReady(player, now);
    const result = tracker.consumeShot(player.id, now);

    if (!result.consumed) {
      this.sendPrimaryMagazineState(player, now);
      return false;
    }

    return true;
  }

  private reloadHeroPrimary(player: Player, now: number): boolean {
    const tracker = this.getPrimaryMagazineTracker(player.id, player.heroId);
    if (!tracker) return false;

    this.completePrimaryReloadIfReady(player, now);
    const result = tracker.reload(player.id, now);

    this.sendPrimaryMagazineState(player, now);
    return result.started;
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
    if (this.isBattleRoyalDeploymentPhase()) {
      const combatInputPressed = Boolean(
        input.primaryFire ||
        input.secondaryFire ||
        input.reload ||
        input.ability1 ||
        input.ability2 ||
        input.ultimate
      );
      if (combatInputPressed && !player.isBot && player.state === 'alive') {
        const lastLoggedAt = this.battleRoyalDeploymentCombatInputLogAt.get(player.id) ?? 0;
        if (now - lastLoggedAt >= 2000) {
          this.battleRoyalDeploymentCombatInputLogAt.set(player.id, now);
          loggers.room.warn('Battle Royal combat input ignored during deployment', {
            roomId: this.getRoomIdForDiagnostics(),
            lobbyId: this.lobbyId,
            playerId: player.id,
            userId: this.getDurableUserId(player.id),
            team: player.team,
            heroId: player.heroId,
            input: {
              primaryFire: Boolean(input.primaryFire),
              secondaryFire: Boolean(input.secondaryFire),
              reload: Boolean(input.reload),
              ability1: Boolean(input.ability1),
              ability2: Boolean(input.ability2),
              ultimate: Boolean(input.ultimate),
            },
            statusCounts: this.getBattleRoyalDropStatusCounts(),
            phaseEndsAt: this.state.phaseEndTime,
            serverTime: now,
          });
        }
      }
      this.playerPressStates.applyInput(player.id, {
        primaryFire: false,
        secondaryFire: false,
        reload: false,
        ability1: false,
        ability2: false,
        ultimate: false,
      });
      return;
    }

    if (player.state === 'downed') {
      this.playerPressStates.applyInput(player.id, {
        primaryFire: Boolean(input.primaryFire),
        secondaryFire: Boolean(input.secondaryFire),
        reload: Boolean(input.reload),
        ability1: Boolean(input.ability1),
        ability2: Boolean(input.ability2),
        ultimate: Boolean(input.ultimate),
      });
      if (
        isBattleRoyalMode(this.gameplayMode) &&
        this.state.phase === 'playing' &&
        input.primaryFire
      ) {
        this.tryRaiseBattleRoyalKnockdownShield(player);
      }
      return;
    }
    if (player.state !== 'alive') return;

    const previous = this.playerPressStates.getOrCreate(player.id);
    if (
      isBattleRoyalMode(this.gameplayMode) &&
      this.state.phase === 'playing' &&
      input.interact &&
      this.tryStartBattleRoyalRevive(player, now)
    ) {
      this.playerPressStates.applyInput(player.id, {
        primaryFire: false,
        secondaryFire: false,
        reload: false,
        ability1: false,
        ability2: false,
        ultimate: false,
      });
      return;
    }
    if (
      isBattleRoyalMode(this.gameplayMode) &&
      this.state.phase === 'playing' &&
      input.interact &&
      this.tryStartBattleRoyalSoulInteraction(player, now)
    ) {
      this.playerPressStates.applyInput(player.id, {
        primaryFire: false,
        secondaryFire: false,
        reload: false,
        ability1: false,
        ability2: false,
        ultimate: false,
      });
      return;
    }

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
      const blazeSecondarySkill = this.getBlazeSecondarySkill(player.id);
      if (shouldResolveBlazeSecondaryAttack({
        skill: blazeSecondarySkill,
        secondaryFire: input.secondaryFire,
        previousSecondaryFire: previous.secondaryFire,
      })) {
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

  private selectBattleRoyalReviveTarget(reviver: Player): Player | null {
    let bestTarget: Player | null = null;
    let bestPriority = Number.POSITIVE_INFINITY;
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    const reviveRadiusSq = BATTLE_ROYAL_REVIVE_RADIUS * BATTLE_ROYAL_REVIVE_RADIUS;
    this.state.players.forEach((candidate) => {
      if (candidate.id === reviver.id) return;
      if (candidate.team !== reviver.team) return;
      if (candidate.state !== 'downed') return;
      if (candidate.reviveByPlayerId && candidate.reviveByPlayerId !== reviver.id) return;

      const dx = candidate.position.x - reviver.position.x;
      const dy = candidate.position.y - reviver.position.y;
      const dz = candidate.position.z - reviver.position.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq > reviveRadiusSq) return;

      const priority = reviver.isBot && !candidate.isBot ? 0 : 1;
      if (priority > bestPriority || (priority === bestPriority && distanceSq >= bestDistanceSq)) return;

      bestPriority = priority;
      bestDistanceSq = distanceSq;
      bestTarget = candidate;
    });
    return bestTarget;
  }

  private tryStartBattleRoyalRevive(reviver: Player, now: number): boolean {
    if (this.battleRoyalDownedRuntime.isReviving(reviver.id)) return true;

    const bestTarget = this.selectBattleRoyalReviveTarget(reviver);
    return bestTarget ? this.battleRoyalDownedRuntime.tryStartRevive(reviver, bestTarget, now) : false;
  }

  private tryStartBattleRoyalSoulInteraction(player: Player, now: number): boolean {
    if (this.battleRoyalSouls.hasActiveInteraction(player.id)) return true;
    return (
      this.battleRoyalSouls.tryStartNearestCollect(player, now) ||
      this.battleRoyalSouls.tryStartSummon(player, this.getBattleRoyalSummoningCircles(), now)
    );
  }

  private tryRaiseBattleRoyalKnockdownShield(player: Player): boolean {
    if (player.state !== 'downed') return false;
    if (player.knockdownShieldActive) return true;
    if (player.knockdownShieldHealth <= 0) return false;
    player.knockdownShieldActive = true;
    return true;
  }

  private tryResolveAttack(player: Player, mode: AttackMode, now = Date.now()): void {
    const heroId = isHeroId(player.heroId) ? player.heroId : null;
    const attack = heroId
      ? getRoomAttackConfig({
        heroId,
        mode,
        chronosAscendantActive: heroId === 'chronos' && mode === 'primary' && this.isChronosAscendantActive(player),
        phantomPrimarySkill: heroId === 'phantom' ? this.getPhantomPrimarySkill(player.id) : undefined,
        phantomSecondarySkill: heroId === 'phantom' ? this.getPhantomSecondarySkill(player.id) : undefined,
        blazePrimarySkill: heroId === 'blaze' ? this.getBlazePrimarySkill(player.id) : undefined,
        blazeSecondarySkill: heroId === 'blaze' ? this.getBlazeSecondarySkill(player.id) : undefined,
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
      blazePrimaryShotAvailable: true,
      chronosPrimaryShotAvailable: true,
    });
    if (readinessRejection || !heroId || !attack) {
      this.rejectAbilityOrCombat(
        player,
        readinessRejection?.reason ?? `attack_missing_config:${mode}`,
        readinessRejection?.logEvent ?? true
      );
      return;
    }

    if (mode === 'primary' && !this.consumePrimaryShot(player, now)) {
      const ammoRejection = getAttackPreflightRejection({
        isHeroId: true,
        playerState: player.state,
        mode,
        attackExists: true,
        isCoolingDown: false,
        phantomPrimaryReady: true,
        chronosPrimaryReady: true,
        phantomPrimaryShotAvailable: heroId !== 'phantom',
        blazePrimaryShotAvailable: heroId !== 'blaze',
        chronosPrimaryShotAvailable: heroId !== 'chronos',
      });
      this.rejectAbilityOrCombat(player, ammoRejection?.reason ?? 'primary_no_ammo', ammoRejection?.logEvent ?? false);
      return;
    }
    this.attackCooldowns.setFromDuration(player.id, mode, now, attack.cooldownMs);

    const veil = player.abilities.get('phantom_veil');
    if (veil?.isActive) {
      veil.isActive = false;
    }

    if (heroId === 'blaze') {
      if (mode === 'primary') {
        if (this.getBlazePrimarySkill(player.id) === 'scrapshot') {
          this.fireBlazeScrapshot(player, attack, now);
        } else {
          this.fireBlazeRocket(player, attack, now);
        }
      } else {
        if (this.getBlazeSecondarySkill(player.id) === 'phosphor_flare') {
          this.dropBlazePhosphorFlare(player, attack, now);
        } else {
          this.dropBlazeBomb(player, attack, now);
        }
      }
      return;
    }

    if (
      heroId === 'phantom' &&
      mode === 'secondary' &&
      this.getPhantomSecondarySkill(player.id) === 'rift_bolt'
    ) {
      this.firePhantomRiftBolt(player, attack, now);
      return;
    }

    if (
      heroId === 'phantom' &&
      mode === 'primary' &&
      this.getPhantomPrimarySkill(player.id) === 'soulrend_daggers'
    ) {
      this.firePhantomSoulrend(player, attack, now);
      return;
    }

    const origin = this.getPlayerEyePosition(player);
    const rawForward = getForwardVector(player.lookYaw, player.lookPitch);
    const castKind = getAttackCastKind({
      heroId,
      mode,
      phantomPrimarySkill: heroId === 'phantom' ? this.getPhantomPrimarySkill(player.id) : undefined,
      phantomSecondarySkill: heroId === 'phantom' ? this.getPhantomSecondarySkill(player.id) : undefined,
    });
    const forward = this.resolveValidatedCastAimDirection(
      player,
      castKind,
      origin,
      rawForward,
      attack.range
    );
    const primaryTargetHit = this.findTargetHitInAimCone(
      player,
      attack.range,
      attack.coneDot,
      attack.collisionRadius ?? 0,
      attack.targetTeam ?? 'enemy',
      { origin, forward }
    );
    const aegisHit = this.getChronosAegisSkillHit(player, origin, forward, attack.range, {
      projectileRadius: getChronosAegisCollisionRadiusForAttack(attack),
    });
    const aegisBlocksAttack = Boolean(aegisHit && (!primaryTargetHit || aegisHit.distance <= primaryTargetHit.hit.distance));
    const impactHint = buildAttackImpactHint({
      aegisBlocksAttack,
      aegisPoint: aegisHit?.point,
    });
    if (
      castKind === 'phantom_dire_ball' ||
      castKind === 'phantom_soulrend_daggers' ||
      castKind === 'phantom_void_ray' ||
      castKind === 'phantom_rift_bolt'
    ) {
      this.broadcastPhantomAttackCast(player, castKind, now, attack.range, impactHint);
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
    targetTeam: AttackTargetTeam = 'enemy',
    aimOverride: { origin?: PlainVec3; forward?: PlainVec3 } = {}
  ): AimTargetHit | null {
    const origin = aimOverride.origin ?? this.getPlayerEyePosition(source);
    const forward = aimOverride.forward ?? getForwardVector(source.lookYaw, source.lookPitch);
    let bestTargetHit: AimTargetHit | null = null;
    let bestDistance = range;
    const candidateRange = range + extraRadius + PLAYER_RADIUS + PLAYER_COMBAT_HITBOX_PADDING;
    const candidates = this.queryPlayersConeCandidates(
      origin,
      candidateRange,
      {
        excludeTeam: targetTeam === 'enemy' ? source.team as Team : undefined,
        excludeId: source.id,
        includeDowned: true,
      }
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
    const targets = this.queryPlayersRadius(
      center,
      radius,
      { excludeTeam: source.team as Team, excludeId: source.id, includeDowned: true }
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
      damageType === 'phoenix_dive' ||
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

  private writeChronosAegisPose(player: Player): ChronosAegisPose {
    const pose = this.chronosAegisPoseScratch;
    pose.playerId = player.id;
    pose.position = player.position;
    pose.lookYaw = player.lookYaw;
    pose.lookPitch = player.lookPitch;
    return pose;
  }

  private getChronosAegisCenter(player: Player): PlainVec3 {
    return getSharedChronosAegisCenter(this.writeChronosAegisPose(player));
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
    const sourceTeam = source.team as Team;
    const shieldTeam = options.shieldTeam;
    let bestHit: ChronosAegisSkillHit | null = null;
    const aegisCandidates = shieldTeam
      ? this.getTeamPlayers(shieldTeam)
      : this.getEnemyPlayers(sourceTeam);
    const playersToCheck = aegisCandidates.length > 0 ? aegisCandidates : this.state.players.values();

    for (const aegisPlayer of playersToCheck) {
      if (shieldTeam ? aegisPlayer.team !== shieldTeam : aegisPlayer.team === sourceTeam) continue;
      if (aegisPlayer.id === source.id) continue;
      if (!this.isChronosAegisActive(aegisPlayer)) continue;

      const aegisPose = this.writeChronosAegisPose(aegisPlayer);
      if (
        options.targetPoint &&
        getSharedChronosAegisForwardDot(
          options.targetPoint,
          aegisPose
        ) > CHRONOS_AEGIS_TARGET_BACK_MAX
      ) {
        continue;
      }

      const hit = getSegmentHitAgainstChronosAegis(
        start,
        direction,
        range,
        aegisPose,
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
    if (this.isBattleRoyalDeploymentPhase()) return false;

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

  private stepHookshotDragPullAuthority(
    player: Player,
    dt: number,
    now: number,
    collisionWorld = this.getMovementCollisionWorld(now)
  ): boolean {
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

  private stepHookshotDragPullWithoutCommand(
    player: Player,
    tickTime: number,
    collisionWorld = this.getMovementCollisionWorld(tickTime)
  ): boolean {
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
      this.simulateAuthoritativeMovementStep(player, input, MOVEMENT_SUBSTEP_SECONDS, stepNow, collisionWorld);
      if (this.stepHookshotDragPullAuthority(player, MOVEMENT_SUBSTEP_SECONDS, stepNow, collisionWorld)) {
        moved = true;
        this.updateLastSafeMovement(player, authority.lastProcessedSeq, stepNow);
      }
    }

    return moved;
  }

  private stepHookshotGrappleWithoutCommand(
    player: Player,
    tickTime: number,
    collisionWorld = this.getMovementCollisionWorld(tickTime)
  ): boolean {
    const grapple = this.hookshotRuntime.getGrapple(player.id);
    if (!grapple) return false;

    let moved = false;
    const authority = this.getMovementAuthority(player.id);
    for (let step = 0; step < SERVER_MOVEMENT_SUBSTEPS_PER_TICK; step++) {
      const activeGrapple = this.hookshotRuntime.getGrapple(player.id);
      if (!activeGrapple) break;

      const stepNow = tickTime + step * MOVEMENT_SUBSTEP_SECONDS * 1000;
      if (!activeGrapple.swing && stepNow < activeGrapple.attachAt) continue;

      const before = vec3SchemaToPlain(player.position);
      const input = this.getRootedMovementInput(
        player,
        player.lastInput ?? createEmptyPlayerInput(this.state.tick, player, stepNow),
        stepNow
      );
      if (!this.hookshotRuntime.getGrapple(player.id)) break;

      this.prepareHookshotGrappleForMovement(player, stepNow);
      this.simulateAuthoritativeMovementStep(player, input, MOVEMENT_SUBSTEP_SECONDS, stepNow, collisionWorld);
      this.stepHookshotGrappleAuthority(player, input, MOVEMENT_SUBSTEP_SECONDS, stepNow, collisionWorld);

      const after = player.position;
      const didMove = (
        Math.abs(after.x - before.x) > 0.001 ||
        Math.abs(after.y - before.y) > 0.001 ||
        Math.abs(after.z - before.z) > 0.001
      );
      if (didMove) {
        moved = true;
        this.updateLastSafeMovement(player, authority.lastProcessedSeq, stepNow);
      }
    }

    return moved;
  }

  private stepBlazeAfterburnerWithoutCommand(
    player: Player,
    tickTime: number,
    collisionWorld = this.getMovementCollisionWorld(tickTime)
  ): boolean {
    if (!this.getActiveBlazeAfterburnerDash(player.id, tickTime)) return false;

    let moved = false;
    const authority = this.getMovementAuthority(player.id);
    for (let step = 0; step < SERVER_MOVEMENT_SUBSTEPS_PER_TICK; step++) {
      const stepNow = tickTime + step * MOVEMENT_SUBSTEP_SECONDS * 1000;
      if (!this.getActiveBlazeAfterburnerDash(player.id, stepNow)) break;
      const before = vec3SchemaToPlain(player.position);
      const input = suppressLocomotionInput(
        player.lastInput ?? createEmptyPlayerInput(this.state.tick, player, stepNow)
      );
      this.simulateAuthoritativeMovementStep(player, input, MOVEMENT_SUBSTEP_SECONDS, stepNow, collisionWorld);
      if (distance3D(before, player.position) <= 0.001) continue;
      moved = true;
      this.updateLastSafeMovement(player, authority.lastProcessedSeq, stepNow);
    }
    return moved;
  }

  private stepBlazePhoenixDiveWithoutCommand(
    player: Player,
    tickTime: number,
    collisionWorld = this.getMovementCollisionWorld(tickTime)
  ): boolean {
    const initialPhase = this.blazePhoenixDives.get(player.id)?.phase;
    if (initialPhase !== 'hover' && initialPhase !== 'dive') return false;

    let moved = false;
    const authority = this.getMovementAuthority(player.id);
    for (let step = 0; step < SERVER_MOVEMENT_SUBSTEPS_PER_TICK; step++) {
      const dive = this.blazePhoenixDives.get(player.id);
      if (!dive || (dive.phase !== 'hover' && dive.phase !== 'dive')) break;
      const stepNow = tickTime + step * MOVEMENT_SUBSTEP_SECONDS * 1000;
      const before = vec3SchemaToPlain(player.position);
      const input = suppressLocomotionInput(
        player.lastInput ?? createEmptyPlayerInput(this.state.tick, player, stepNow)
      );
      if (dive.phase === 'hover') {
        this.applyBlazePhoenixDiveHoverVelocity(player, dive, stepNow);
      }
      this.simulateAuthoritativeMovementStep(player, input, MOVEMENT_SUBSTEP_SECONDS, stepNow, collisionWorld);
      if (distance3D(before, player.position) <= 0.001) continue;
      moved = true;
      this.updateLastSafeMovement(player, authority.lastProcessedSeq, stepNow);
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
      this.markMovementBarrier(target.id, 'knockback', { preserveQueuedCommands: true });

      const targetClient = this.clientRegistry.getClient(target.id);
      targetClient?.send('chronosTimebreakImpulse', {
        sourceId: caster.id,
        sourcePosition: origin,
        impulse,
      });
    });
  }

  private getActiveSpeedMultiplier(player: Player, now = Date.now()): number {
    let multiplier = 1;
    if (player.abilities.get('phantom_veil')?.isActive) multiplier *= PHANTOM_VEIL_SPEED_MULTIPLIER;
    if (this.isChronosAscendantActive(player, now)) {
      multiplier *= CHRONOS_ASCENDANT_PARADOX_SPEED_MULTIPLIER;
    }
    if (this.powerupBoosts.has(player.id, now)) {
      multiplier *= POWERUP_MOVEMENT_SPEED_MULTIPLIER;
    }
    if (this.getActiveBlazeAfterburnerDash(player.id, now)) {
      multiplier *= Math.max(1, BLAZE_AFTERBURNER_DASH_SPEED / BHOP_MAX_VELOCITY);
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

    const primaryMagazines = this.getPrimaryMagazineTracker(player.id, player.heroId);
    if (primaryMagazines?.adjustActiveReload(player.id, adjustmentMs, now).adjusted) {
      this.sendPrimaryMagazineState(player, now);
    }
  }

  private updateCTFObjectives(now: number): void {
    this.updateCarriedFlagPositions();
    this.checkFlagReturns(now);

    this.state.players.forEach((player) => {
      if (player.state !== 'alive' && !this.isBattleRoyalDownedPlayer(player)) return;
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

    if (!this.endlessMatch && hasTeamReachedScoreLimit(this.state.redTeam.score, this.state.blueTeam.score, this.config.scoreToWin)) {
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
    this.botsWithReusedInputThisTick.clear();
    this.prepareBotSimulationTierCache();
    const aliveBotCount = this.getAliveBotMovementLodCount();
    let scheduledBotCount = 0;

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

      if (
        this.state.phase !== 'playing' &&
        this.state.phase !== 'countdown'
      ) {
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
        return;
      }

      const simulationTier = this.getServerOwnedBotSimulationTier(bot, now, brain, true);
      if (this.shouldDeferInitialBotPlanning(brain, now)) {
        this.tickProfiler.recordCounter('bot_initial_planning_stagger_skipped');
        this.continueDeferredBotInput(botId, now, simulationTier);
        return;
      }
      if (!this.shouldScheduleBotPlanningForTier(bot, simulationTier, aliveBotCount)) {
        this.tickProfiler.recordCounter('bot_planning_tier_cadence_skipped');
        this.continueDeferredBotInput(botId, now, simulationTier);
        return;
      }

      this.botRuntime.scheduleForFrame(botId, simulationTier === 'critical');
      scheduledBotCount++;
    });

    if (scheduledBotCount === 0) return;

    const frameContext = this.measureTickSpan('bot_frame_context', () => this.buildBotFrameContext(now));
    this.measureTickSpan('bot_updates', () => {
      const planningBudgets = this.getBotPlanningBudgets(scheduledBotCount);
      const schedule = this.botRuntime.runScheduledFrameBots({
        urgentBudget: planningBudgets.urgentBudget,
        deferredBudget: planningBudgets.deferredBudget,
        run: (botId) => {
          this.updateScheduledBot(botId, now, dt, frameContext);
        },
        skipUrgent: (botId) => {
          this.continueDeferredBotInput(botId, now);
        },
        skipDeferred: (botId) => {
          this.continueDeferredBotInput(botId, now);
        },
      });
      this.tickProfiler.recordCounter('bot_urgent_scheduled', schedule.urgentCount);
      this.tickProfiler.recordCounter('bot_urgent_processed', schedule.urgentProcessedCount);
      this.tickProfiler.recordCounter('bot_urgent_skipped', schedule.urgentSkippedCount);
      this.tickProfiler.recordCounter('bot_deferred_scheduled', schedule.deferredCount);
      this.tickProfiler.recordCounter('bot_deferred_processed', schedule.deferredProcessedCount);
      this.tickProfiler.recordCounter('bot_deferred_skipped', schedule.deferredSkippedCount);
      this.tickProfiler.recordCounter('bot_input_reuse', schedule.urgentSkippedCount + schedule.deferredSkippedCount);
    });
  }

  private getBotPlanningBudgets(scheduledBotCount: number): { urgentBudget: number; deferredBudget: number } {
    if (this.isStreamerBotDeathmatchFeed()) {
      return {
        urgentBudget: scheduledBotCount,
        deferredBudget: scheduledBotCount,
      };
    }

    if (isBattleRoyalMode(this.gameplayMode)) {
      return getScaledBotPlanningBudgets(
        scheduledBotCount,
        BATTLE_ROYAL_BOT_PLANNING_BUDGET_TUNING
      );
    }

    return getScaledBotPlanningBudgets(
      scheduledBotCount,
      DEFAULT_BOT_PLANNING_BUDGET_TUNING
    );
  }

  private shouldDeferInitialBotPlanning(brain: BotBrain, now: number): boolean {
    return brain.blackboard === null && now < Math.min(brain.nextThinkAt, brain.nextBlackboardAt);
  }

  private continueDeferredBotInput(
    botId: string,
    now: number,
    simulationTier?: BotSimulationTier
  ): void {
    const bot = this.state.players.get(botId);
    if (!bot?.isBot || bot.state !== 'alive') return;
    const tier = simulationTier ?? this.getServerOwnedBotSimulationTier(bot, now);

    const input = bot.lastInput ?? createEmptyBotInput(this.state.tick, bot, now);
    input.tick = this.state.tick;
    input.timestamp = now;
    input.crouchPressed = false;
    input.reload = false;
    input.ability1 = false;
    input.ability2 = false;
    input.ultimate = false;
    input.interact = tier === 'critical' && isBattleRoyalMode(this.gameplayMode) && input.interact;
    if (tier !== 'critical') {
      if (input.primaryFire) {
        input.primaryFire = false;
        this.tickProfiler.recordCounter('bot_noncritical_primary_fire_suppressed');
      }
      if (input.secondaryFire) {
        input.secondaryFire = false;
        this.tickProfiler.recordCounter('bot_noncritical_secondary_fire_suppressed');
      }
      if (input.jump) {
        input.jump = false;
        this.tickProfiler.recordCounter('bot_noncritical_jump_suppressed');
      }
    }

    bot.lastInput = input;
    this.botsWithReusedInputThisTick.add(botId);
    this.recordBotAction(bot, input, this.botRuntime.getBrain(botId), true);
  }

  private prepareBotSimulationTierCache(): void {
    if (this.botSimulationTierTick === this.state.tick) return;
    this.botSimulationTierTick = this.state.tick;
    this.botSimulationTierById.clear();
    this.botNearBattleRoyalEnemyById.clear();
    this.battleRoyalHumanTeams.clear();
    this.battleRoyalContestantHumanTeams.clear();
    this.battleRoyalHumanSquadSurvivorTeams.clear();
    this.hasBattleRoyalDownedPlayer = false;

    if (!isBattleRoyalMode(this.gameplayMode)) return;

    this.state.players.forEach((player) => {
      if (player.state === 'downed') {
        this.hasBattleRoyalDownedPlayer = true;
      }
      if (player.isBot || !isTeam(player.team) || isObserverPlayer(player)) return;
      this.battleRoyalHumanTeams.add(player.team);
      if (isBattleRoyalContestant(player)) {
        this.battleRoyalContestantHumanTeams.add(player.team);
      }
    });

    for (const team of this.battleRoyalHumanTeams) {
      if (!this.battleRoyalContestantHumanTeams.has(team)) {
        this.battleRoyalHumanSquadSurvivorTeams.add(team);
      }
    }
  }

  private getServerOwnedBotSimulationTier(
    bot: Player,
    now: number,
    brain = this.botRuntime.getBrain(bot.id),
    recordCounter = false
  ): BotSimulationTier {
    this.prepareBotSimulationTierCache();
    const cached = this.botSimulationTierById.get(bot.id);
    if (cached) return cached;

    const tier = this.resolveServerOwnedBotSimulationTier(bot, brain, now);
    this.botSimulationTierById.set(bot.id, tier);
    if (recordCounter) this.recordBotSimulationTierCounter(tier);
    return tier;
  }

  private resolveServerOwnedBotSimulationTier(
    bot: Player,
    brain: BotBrain | undefined,
    now: number
  ): BotSimulationTier {
    if (!bot.isBot || bot.state !== 'alive') return 'critical';
    if (this.isStreamerBotDeathmatchFeed()) return 'critical';
    if (this.getAliveBotMovementLodCount() < BOT_MOVEMENT_LOD_START_COUNT) return 'critical';
    if (this.isPriorityBot(bot, brain, now)) return 'critical';
    if (this.isServerOwnedBotNearHuman(bot, BOT_SIMULATION_NEAR_HUMAN_DISTANCE_SQ)) return 'near';
    return 'background';
  }

  private recordBotSimulationTierCounter(tier: BotSimulationTier): void {
    switch (tier) {
      case 'critical':
        this.tickProfiler.recordCounter('bot_sim_tier_critical');
        return;
      case 'near':
        this.tickProfiler.recordCounter('bot_sim_tier_near');
        return;
      case 'background':
        this.tickProfiler.recordCounter('bot_sim_tier_background');
        return;
    }
  }

  private shouldScheduleBotPlanningForTier(
    bot: Player,
    tier: BotSimulationTier,
    aliveBotCount: number
  ): boolean {
    if (this.isStreamerBotDeathmatchFeed()) return true;
    if (tier === 'critical') return true;
    if (aliveBotCount < DEFAULT_BOT_PLANNING_BUDGET_TUNING.lodStartCount) return true;

    const cadence = this.getBotPlanningCadenceForTier(tier, aliveBotCount);
    return (this.state.tick + hashString(bot.id)) % cadence === 0;
  }

  private getBotPlanningCadenceForTier(tier: BotSimulationTier, aliveBotCount: number): number {
    if (tier === 'critical') return 1;
    if (tier === 'near') {
      return aliveBotCount >= BOT_MOVEMENT_LOD_HIGH_COUNT ? BOT_NEAR_PLANNING_CADENCE_HIGH : 1;
    }
    if (aliveBotCount >= BOT_MOVEMENT_LOD_HIGH_COUNT) return BOT_BACKGROUND_PLANNING_CADENCE_HIGH;
    if (aliveBotCount >= BOT_MOVEMENT_LOD_MEDIUM_COUNT) return BOT_BACKGROUND_PLANNING_CADENCE_MEDIUM;
    return 2;
  }

  private isPriorityBot(bot: Player, brain: BotBrain | undefined, now: number): boolean {
    if (bot.hasFlag) return true;
    if (this.isBattleRoyalPriorityBot(bot, now)) return true;
    if (
      this.replicationState.getRecentCombatTransformUntil(bot.id) > now &&
      (
        this.hasRecentHumanCombatInterest(bot, now) ||
        this.isServerOwnedBotNearHuman(bot, BOT_SIMULATION_NEAR_HUMAN_DISTANCE_SQ)
      )
    ) {
      return true;
    }
    const target = brain?.targetId ? this.state.players.get(brain.targetId) : null;
    const hasCloseHumanCombatTarget = Boolean(
      target &&
      !target.isBot &&
      target.state === 'alive' &&
      target.team !== bot.team &&
      distance3D(bot.position, target.position) <= 22
    );
    if (brain?.intent.type === 'fight_local_enemy') {
      return hasCloseHumanCombatTarget || this.isServerOwnedBotNearEnemyHuman(bot, BOT_MOVEMENT_LOD_ENEMY_HUMAN_DISTANCE_SQ);
    }
    return hasCloseHumanCombatTarget;
  }

  private isBattleRoyalPriorityBot(bot: Player, now: number): boolean {
    if (!isBattleRoyalMode(this.gameplayMode)) return false;
    if (this.isBattleRoyalSafeZonePriorityBot(bot)) return true;
    if (this.isBattleRoyalHumanSquadSurvivorBot(bot)) return true;
    if (this.isServerOwnedBotNearBattleRoyalDownedPlayer(bot, 18 * 18)) return true;
    if (this.isServerOwnedBotNearCriticalBattleRoyalEnemy(bot)) return true;
    if (
      this.replicationState.getRecentCombatTransformUntil(bot.id) > now &&
      this.isServerOwnedBotNearEnemyHuman(bot, BOT_MOVEMENT_LOD_ENEMY_HUMAN_DISTANCE_SQ)
    ) {
      return true;
    }
    return false;
  }

  private isBattleRoyalHumanSquadSurvivorBot(bot: Player): boolean {
    if (!isBattleRoyalMode(this.gameplayMode) || !bot.isBot || bot.state !== 'alive' || !isTeam(bot.team)) {
      return false;
    }
    this.prepareBotSimulationTierCache();
    return this.battleRoyalHumanSquadSurvivorTeams.has(bot.team);
  }

  private isBattleRoyalSafeZonePriorityBot(bot: Player): boolean {
    const safeZone = this.battleRoyalSafeZone;
    if (!safeZone?.enabled) return false;
    const distanceToCurrentBoundary = safeZone.radius - Math.hypot(
      bot.position.x - safeZone.center.x,
      bot.position.z - safeZone.center.z
    );
    const distanceToNextBoundary = safeZone.nextRadius - Math.hypot(
      bot.position.x - safeZone.nextCenter.x,
      bot.position.z - safeZone.nextCenter.z
    );
    const finalRingPressure = safeZone.phaseIndex >= 4 || safeZone.radius <= Math.max(16, safeZone.baseRadius * 0.12);
    return (
      distanceToCurrentBoundary < 0 ||
      distanceToNextBoundary < 0 ||
      (safeZone.shrinking && distanceToCurrentBoundary <= 18) ||
      (safeZone.warning && distanceToNextBoundary <= 18) ||
      finalRingPressure
    );
  }

  private isServerOwnedBotNearBattleRoyalDownedPlayer(bot: Player, distanceSq: number): boolean {
    this.prepareBotSimulationTierCache();
    if (!this.hasBattleRoyalDownedPlayer) return false;

    const radius = Math.sqrt(distanceSq);
    const candidates = this.botSimulationHumanScratch;
    this.queryPlayersRadiusInto(
      bot.position,
      radius,
      candidates,
      { excludeId: bot.id, includeDowned: true }
    );

    for (const player of candidates) {
      if (player.state !== 'downed') continue;
      const isRelevantAlly = player.team === bot.team;
      const isRelevantEnemy = player.team !== bot.team;
      if (!isRelevantAlly && !isRelevantEnemy) continue;
      const dx = player.position.x - bot.position.x;
      const dy = player.position.y - bot.position.y;
      const dz = player.position.z - bot.position.z;
      if (dx * dx + dy * dy + dz * dz <= distanceSq) return true;
    }
    return false;
  }

  private isServerOwnedBotNearCriticalBattleRoyalEnemy(bot: Player): boolean {
    this.prepareBotSimulationTierCache();
    const cached = this.botNearBattleRoyalEnemyById.get(bot.id);
    if (cached !== undefined) return cached;

    const nearby = this.isServerOwnedBotNearBattleRoyalEnemy(
      bot,
      BOT_BATTLE_ROYAL_CRITICAL_ENEMY_DISTANCE_SQ
    );
    this.botNearBattleRoyalEnemyById.set(bot.id, nearby);
    return nearby;
  }

  private isServerOwnedBotNearBattleRoyalEnemy(bot: Player, distanceSq: number): boolean {
    if (!isBattleRoyalMode(this.gameplayMode)) return false;
    const radius = Math.sqrt(distanceSq);
    const candidates = this.botSimulationHumanScratch;
    this.queryPlayersRadiusInto(
      bot.position,
      radius,
      candidates,
      { excludeTeam: bot.team, excludeId: bot.id }
    );

    for (const player of candidates) {
      if (player.team === bot.team || player.state !== 'alive') continue;
      const dx = player.position.x - bot.position.x;
      const dy = player.position.y - bot.position.y;
      const dz = player.position.z - bot.position.z;
      if (dx * dx + dy * dy + dz * dz <= distanceSq) return true;
    }
    return false;
  }

  private hasRecentHumanCombatInterest(bot: Player, now: number): boolean {
    for (const player of this.getAlivePlayers()) {
      if (player.isBot || player.id === bot.id) continue;
      if (this.replicationState.getRecentCombatInterestUntil(bot.id, player.id) > now) return true;
    }
    return false;
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
    this.recordBotAction(bot, botInput, brain, false);
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
      skinId: isHeroSkinId(player.skinId) ? player.skinId : '',
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
    for (const playerId of this.getBotSnapshotRosterIds()) {
      const player = this.state.players.get(playerId);
      if (!player) continue;
      const snapshot = this.getBotPlayerSnapshot(player);
      if (snapshot) snapshots.push(snapshot);
    }
    return snapshots;
  }

  private getBotSnapshotRosterIds(): readonly string[] {
    const cachedIds = this.botSnapshotRosterIds;
    if (
      cachedIds.length === this.state.players.size
      && cachedIds.every((playerId) => this.state.players.has(playerId))
    ) {
      return cachedIds;
    }

    this.botSnapshotRosterIds = Array.from(this.state.players.keys()).sort((a, b) => a.localeCompare(b));
    return this.botSnapshotRosterIds;
  }

  private buildBotFrameContext(now: number): BotFrameContext {
    const snapshots = this.getBotPlayerSnapshots();
    const snapshotById = this.botFrameSnapshotById;
    snapshotById.clear();
    let aliveBotCount = 0;
    for (const snapshot of snapshots) {
      snapshotById.set(snapshot.id, snapshot);
      if (snapshot.isBot && snapshot.state === 'alive') aliveBotCount++;
    }

    const flags = getBotFlagSnapshots(this.state);
    const teamTactics = this.refreshBotTeamTactics(now, snapshots, flags);
    const protectedEnemyIdsByTeam = this.botFrameProtectedEnemyIdsByTeam;
    for (const ids of protectedEnemyIdsByTeam.values()) {
      ids.clear();
    }
    for (const snapshot of snapshots) {
      if (!protectedEnemyIdsByTeam.has(snapshot.team)) {
        protectedEnemyIdsByTeam.set(snapshot.team, new Set<string>());
      }
    }
    this.state.players.forEach((player) => {
      if (!isTeam(player.team) || !this.isProtectedSpawnTarget(player, now)) return;
      for (const [team, protectedEnemyIds] of protectedEnemyIdsByTeam) {
        if (team !== player.team) {
          protectedEnemyIds.add(player.id);
        }
      }
    });

    this.prepareBotFramePerceptionCache();

    return {
      snapshots,
      snapshotById,
      aliveBotCount,
      safeZone: this.battleRoyalSafeZone,
      mapPings: this.getBotMapPingSnapshots(now),
      flags,
      teamTactics,
      protectedEnemyIdsByTeam,
      perceptionByBot: this.botFramePerceptionByBot,
      lineOfSightChecksRemaining: this.getBotLineOfSightFrameBudget(aliveBotCount),
      steeringProbeChecksRemaining: this.getBotSteeringProbeFrameBudget(aliveBotCount),
      steeringProbePriorityChecksRemaining: isBattleRoyalMode(this.gameplayMode)
        ? BOT_BATTLE_ROYAL_STEERING_PROBE_PRIORITY_FRAME_BUDGET
        : 0,
    };
  }

  private prepareBotFramePerceptionCache(): void {
    for (const perception of this.botFramePerceptionSets) {
      perception.visibleEnemyIds.clear();
      perception.enemyLineOfSightIds.clear();
      perception.lineOfSightUnknownEnemyIds.clear();
      this.botPerceptionSetsPool.push(perception);
    }
    this.botFramePerceptionSets.length = 0;
    this.botFramePerceptionByBot.clear();
  }

  private allocateBotPerceptionSets(): BotPerceptionSets {
    const perception = this.botPerceptionSetsPool.pop() ?? {
      visibleEnemyIds: new Set<string>(),
      enemyLineOfSightIds: new Set<string>(),
      lineOfSightUnknownEnemyIds: new Set<string>(),
    };
    perception.visibleEnemyIds.clear();
    perception.enemyLineOfSightIds.clear();
    perception.lineOfSightUnknownEnemyIds.clear();
    this.botFramePerceptionSets.push(perception);
    return perception;
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

  private getBotMostRecentDamageSource(botId: string, now: number): BotRecentDamageSource | null {
    return this.damageRuntime.getBotMostRecentDamageSource(
      botId,
      now,
      BOT_RECENT_DAMAGE_MEMORY_MS
    );
  }

  private getBotPerceptionSets(
    bot: Player,
    frameContext: BotFrameContext,
    simulationTier: BotSimulationTier
  ): BotPerceptionSets {
    const cached = frameContext.perceptionByBot.get(bot.id);
    if (cached) return cached;

    const perception = this.allocateBotPerceptionSets();
    const { visibleEnemyIds, enemyLineOfSightIds, lineOfSightUnknownEnemyIds } = perception;
    const awarenessRange = resolveBotAwarenessRange(this.gameplayMode);
    const losCandidateLimit = this.getBotPerceptionLineOfSightCandidateLimit(
      frameContext.aliveBotCount,
      simulationTier
    );
    const losCandidatePlayers = this.botPerceptionLosCandidatePlayersScratch;
    const losCandidateScores = this.botPerceptionLosCandidateScoresScratch;
    const preferredLosTargetId = this.botRuntime.getBrain(bot.id)?.targetId || '';
    losCandidatePlayers.length = 0;
    losCandidateScores.length = 0;
    let budgetedLosCandidateCount = 0;
    const candidates = this.getBotPerceptionCandidates(bot, frameContext);
    for (const enemy of candidates) {
      this.tickProfiler.recordCounter('bot_perception_candidates');
      const distance = distance3D(bot.position, enemy.position);
      if (distance > awarenessRange && !enemy.hasFlag) continue;

      const veil = enemy.abilities.get('phantom_veil');
      if (veil?.isActive && !enemy.hasFlag && distance > BOT_CLOSE_REVEAL_RANGE) continue;

      if (this.canBotPerceiveEnemyWithoutLineOfSight(enemy, distance)) {
        this.tickProfiler.recordCounter('bot_visible_enemies');
        this.tickProfiler.recordCounter('bot_los_visibility_rule_skips');
        visibleEnemyIds.add(enemy.id);
        lineOfSightUnknownEnemyIds.add(enemy.id);
        continue;
      }

      if (Number.isFinite(losCandidateLimit)) {
        budgetedLosCandidateCount++;
        this.addBotPerceptionLineOfSightCandidate(
          losCandidatePlayers,
          losCandidateScores,
          enemy,
          distance - (enemy.id === preferredLosTargetId ? BOT_PERCEPTION_LOS_TARGET_SCORE_BONUS : 0),
          losCandidateLimit
        );
        continue;
      }

      if (!this.consumeBotLineOfSightFrameBudget(frameContext)) continue;
      this.tickProfiler.recordCounter('bot_los_checks');
      const hasLineOfSight = this.hasClearShot(bot, enemy);
      if (hasLineOfSight) {
        enemyLineOfSightIds.add(enemy.id);
      }
      if (this.canBotPerceiveEnemy(enemy, distance, hasLineOfSight)) {
        this.tickProfiler.recordCounter('bot_visible_enemies');
        visibleEnemyIds.add(enemy.id);
      }
    }

    if (Number.isFinite(losCandidateLimit)) {
      this.tickProfiler.recordCounter('bot_los_budget_candidates_selected', losCandidatePlayers.length);
      this.tickProfiler.recordCounter(
        'bot_los_budget_candidates_skipped',
        Math.max(0, budgetedLosCandidateCount - losCandidatePlayers.length)
      );
      for (const enemy of losCandidatePlayers) {
        if (!this.consumeBotLineOfSightFrameBudget(frameContext)) continue;
        this.tickProfiler.recordCounter('bot_los_checks');
        const hasLineOfSight = this.hasClearShot(bot, enemy);
        if (hasLineOfSight) {
          enemyLineOfSightIds.add(enemy.id);
        }
        if (this.canBotPerceiveEnemy(enemy, distance3D(bot.position, enemy.position), hasLineOfSight)) {
          this.tickProfiler.recordCounter('bot_visible_enemies');
          visibleEnemyIds.add(enemy.id);
        }
      }
    }

    frameContext.perceptionByBot.set(bot.id, perception);
    return perception;
  }

  private consumeBotLineOfSightFrameBudget(frameContext: BotFrameContext): boolean {
    if (!Number.isFinite(frameContext.lineOfSightChecksRemaining)) return true;
    if (frameContext.lineOfSightChecksRemaining <= 0) {
      this.tickProfiler.recordCounter('bot_los_frame_budget_exhausted');
      return false;
    }
    frameContext.lineOfSightChecksRemaining--;
    return true;
  }

  private getBotPerceptionLineOfSightCandidateLimit(
    aliveBotCount: number,
    simulationTier: BotSimulationTier
  ): number {
    if (this.isStreamerBotDeathmatchFeed()) return Number.POSITIVE_INFINITY;
    if (isBattleRoyalMode(this.gameplayMode)) {
      if (simulationTier === 'background') return BOT_BATTLE_ROYAL_PERCEPTION_LOS_BACKGROUND_CANDIDATE_LIMIT;
      if (simulationTier === 'near') return BOT_BATTLE_ROYAL_PERCEPTION_LOS_NEAR_CANDIDATE_LIMIT;
      return BOT_BATTLE_ROYAL_PERCEPTION_LOS_CRITICAL_CANDIDATE_LIMIT;
    }
    if (aliveBotCount <= BOT_PERCEPTION_LOS_LOD_START_COUNT) {
      if (simulationTier === 'background') return BOT_PERCEPTION_LOS_BACKGROUND_LOW_CANDIDATE_LIMIT;
      if (simulationTier === 'near') return BOT_PERCEPTION_LOS_NEAR_LOW_CANDIDATE_LIMIT;
      return BOT_PERCEPTION_LOS_LOW_CANDIDATE_LIMIT;
    }
    if (simulationTier === 'background') {
      if (aliveBotCount >= BOT_PERCEPTION_LOS_LOD_HIGH_COUNT) return BOT_PERCEPTION_LOS_BACKGROUND_HIGH_CANDIDATE_LIMIT;
      return BOT_PERCEPTION_LOS_BACKGROUND_MEDIUM_CANDIDATE_LIMIT;
    }
    if (simulationTier === 'near') {
      if (aliveBotCount >= BOT_PERCEPTION_LOS_LOD_HIGH_COUNT) return BOT_PERCEPTION_LOS_NEAR_HIGH_CANDIDATE_LIMIT;
      return BOT_PERCEPTION_LOS_NEAR_MEDIUM_CANDIDATE_LIMIT;
    }
    if (aliveBotCount >= BOT_PERCEPTION_LOS_LOD_HIGH_COUNT) return BOT_PERCEPTION_LOS_HIGH_CANDIDATE_LIMIT;
    if (aliveBotCount >= BOT_PERCEPTION_LOS_LOD_MEDIUM_COUNT) return BOT_PERCEPTION_LOS_MEDIUM_CANDIDATE_LIMIT;
    return BOT_PERCEPTION_LOS_MEDIUM_CANDIDATE_LIMIT;
  }

  private getBotLineOfSightFrameBudget(aliveBotCount: number): number {
    if (this.isStreamerBotDeathmatchFeed()) return Number.POSITIVE_INFINITY;
    if (aliveBotCount < BOT_PERCEPTION_LOS_LOD_START_COUNT) return Number.POSITIVE_INFINITY;
    if (isBattleRoyalMode(this.gameplayMode)) {
      if (aliveBotCount >= BOT_PERCEPTION_LOS_LOD_HIGH_COUNT) return BOT_BATTLE_ROYAL_PERCEPTION_LOS_FRAME_BUDGET_HIGH;
      if (aliveBotCount >= BOT_PERCEPTION_LOS_LOD_MEDIUM_COUNT) return BOT_BATTLE_ROYAL_PERCEPTION_LOS_FRAME_BUDGET_MEDIUM;
      return BOT_BATTLE_ROYAL_PERCEPTION_LOS_FRAME_BUDGET_LOW;
    }
    if (aliveBotCount >= BOT_PERCEPTION_LOS_LOD_HIGH_COUNT) return BOT_PERCEPTION_LOS_FRAME_BUDGET_HIGH;
    if (aliveBotCount >= BOT_PERCEPTION_LOS_LOD_MEDIUM_COUNT) return BOT_PERCEPTION_LOS_FRAME_BUDGET_MEDIUM;
    return BOT_PERCEPTION_LOS_FRAME_BUDGET_LOW;
  }

  private addBotPerceptionLineOfSightCandidate(
    players: Player[],
    scores: number[],
    enemy: Player,
    score: number,
    limit: number
  ): void {
    if (limit <= 0) return;
    if (players.length < limit) {
      players.push(enemy);
      scores.push(score);
      return;
    }

    let worstIndex = 0;
    let worstScore = scores[0] ?? Number.NEGATIVE_INFINITY;
    for (let index = 1; index < scores.length; index++) {
      const candidateScore = scores[index] ?? Number.NEGATIVE_INFINITY;
      if (candidateScore > worstScore) {
        worstScore = candidateScore;
        worstIndex = index;
      }
    }
    if (score >= worstScore) return;

    players[worstIndex] = enemy;
    scores[worstIndex] = score;
  }

  private getBotPerceptionCandidates(bot: Player, frameContext: BotFrameContext): readonly Player[] {
    const candidates = this.botPerceptionCandidatesScratch;
    const candidateIds = this.botPerceptionCandidateIdsScratch;
    candidates.length = 0;
    candidateIds.clear();

    if (!isCaptureTheFlagMode(this.gameplayMode) || !isTeam(bot.team)) {
      for (const snapshot of frameContext.snapshots) {
        if (snapshot.team === bot.team || snapshot.state !== 'alive') continue;
        const enemy = this.state.players.get(snapshot.id);
        if (!enemy || candidateIds.has(enemy.id)) continue;
        candidateIds.add(enemy.id);
        candidates.push(enemy);
      }
      return candidates;
    }

    const enemyTeam = getEnemyTeam(bot.team);
    this.queryPlayersRadiusInto(
      bot.position,
      resolveBotAwarenessRange(this.gameplayMode),
      candidates,
      { team: enemyTeam, excludeId: bot.id }
    );
    for (const enemy of candidates) {
      candidateIds.add(enemy.id);
    }

    for (const enemy of this.getEnemyPlayers(bot.team)) {
      if (!enemy.hasFlag || candidateIds.has(enemy.id)) continue;
      candidateIds.add(enemy.id);
      candidates.push(enemy);
    }

    return candidates;
  }

  private hasCurrentBotTargetLineOfSight(
    bot: Player,
    target: Player,
    refreshedPerception: BotPerceptionSets | null,
    frameContext: BotFrameContext
  ): boolean {
    if (refreshedPerception) {
      if (refreshedPerception.enemyLineOfSightIds.has(target.id)) return true;
      if (!refreshedPerception.lineOfSightUnknownEnemyIds.has(target.id)) return false;
      if (!this.consumeBotLineOfSightFrameBudget(frameContext)) return false;
      this.tickProfiler.recordCounter('bot_los_lazy_target_checks');
      this.tickProfiler.recordCounter('bot_los_checks');
      const hasLineOfSight = this.hasClearShot(bot, target);
      refreshedPerception.lineOfSightUnknownEnemyIds.delete(target.id);
      if (hasLineOfSight) {
        refreshedPerception.enemyLineOfSightIds.add(target.id);
      }
      return hasLineOfSight;
    }

    if (!this.consumeBotLineOfSightFrameBudget(frameContext)) return false;
    this.tickProfiler.recordCounter('bot_los_checks');
    return this.hasClearShot(bot, target);
  }

  private isBotPathClear(bot: Player, direction: PlainVec2 | null, distance: number): boolean {
    const normalized = direction ? normalize2D(direction) : null;
    if (!normalized) return true;
    const now = this.state.serverTime || Date.now();
    const collisionRevision = this.getMovementCollisionRevision(now);
    const start = vec3SchemaToPlain(bot.position);
    const end = {
      x: start.x + normalized.x * distance,
      y: start.y,
      z: start.z + normalized.z * distance,
    };
    return this.isBotCapsulePathClear(start, end, now, collisionRevision);
  }

  private isBotCapsulePathClear(
    start: PlainVec3,
    end: PlainVec3,
    now = this.state.serverTime || Date.now(),
    collisionRevision = this.getMovementCollisionRevision(now)
  ): boolean {
    const cacheKey = this.getBotCapsulePathCacheKey(start, end, collisionRevision);
    const cached = this.botSteeringPathCache.get(cacheKey);
    if (cached && cached.expiresAt > now && cached.collisionRevision === collisionRevision) {
      return cached.clear;
    }

    const clear = sweepCapsulePathClear(this.getMovementCollisionWorld(now), start, end, PLAYER_HEIGHT, PLAYER_RADIUS);
    this.pruneBotSteeringPathCache(now);
    this.botSteeringPathCache.set(cacheKey, {
      clear,
      expiresAt: now + BOT_STEERING_PATH_CACHE_TTL_MS,
      collisionRevision,
    });
    return clear;
  }

  private pruneBotSteeringPathCache(now: number): void {
    if (this.botSteeringPathCache.size < BOT_STEERING_PATH_CACHE_MAX_ENTRIES) return;

    for (const [key, cached] of this.botSteeringPathCache) {
      if (cached.expiresAt <= now) this.botSteeringPathCache.delete(key);
    }
    if (this.botSteeringPathCache.size < BOT_STEERING_PATH_CACHE_MAX_ENTRIES) return;

    const targetSize = Math.floor(BOT_STEERING_PATH_CACHE_MAX_ENTRIES * 0.88);
    for (const key of this.botSteeringPathCache.keys()) {
      this.botSteeringPathCache.delete(key);
      if (this.botSteeringPathCache.size <= targetSize) break;
    }
  }

  private getBotCapsulePathCacheKey(
    start: PlainVec3,
    end: PlainVec3,
    collisionRevision: number
  ): string {
    const qPosition = BOT_STEERING_PATH_POSITION_QUANTIZATION;
    return `${collisionRevision}:${
      Math.round(start.x * qPosition)
    }:${
      Math.round(start.y * qPosition)
    }:${
      Math.round(start.z * qPosition)
    }>${
      Math.round(end.x * qPosition)
    }:${
      Math.round(end.y * qPosition)
    }:${
      Math.round(end.z * qPosition)
    }`;
  }

  private getBotSteeringProbe(
    bot: Player,
    probe: Omit<BotSteeringProbe, 'clear' | 'distance'>,
    distance: number,
    frameContext: BotFrameContext,
    priority = false
  ): BotSteeringProbe | null {
    if (!this.consumeBotSteeringProbeFrameBudget(frameContext, priority)) return null;
    this.tickProfiler.recordCounter('bot_steering_probe_checks');
    return {
      ...probe,
      clear: this.isBotPathClear(bot, probe.direction, distance),
      distance,
    };
  }

  private getBotSteeringProbeDistance(bot: Player, skill: BotSkillProfile): number {
    const speed = Math.sqrt(bot.velocity.x * bot.velocity.x + bot.velocity.z * bot.velocity.z);
    const speedLookahead = speed * BOT_STEERING_TERRAIN_LOOKAHEAD_SECONDS;
    return clamp(
      Math.max(skill.localProbeDistance, BOT_STEERING_TERRAIN_LOOKAHEAD_MIN_DISTANCE, speedLookahead),
      skill.localProbeDistance,
      BOT_STEERING_TERRAIN_LOOKAHEAD_MAX_DISTANCE
    );
  }

  private consumeBotSteeringProbeFrameBudget(frameContext: BotFrameContext, priority = false): boolean {
    if (priority && frameContext.steeringProbePriorityChecksRemaining > 0) {
      frameContext.steeringProbePriorityChecksRemaining--;
      return true;
    }
    if (!Number.isFinite(frameContext.steeringProbeChecksRemaining)) return true;
    if (frameContext.steeringProbeChecksRemaining <= 0) {
      this.tickProfiler.recordCounter('bot_steering_probe_frame_budget_exhausted');
      return false;
    }
    frameContext.steeringProbeChecksRemaining--;
    return true;
  }

  private getBotSteeringProbeFrameBudget(aliveBotCount: number): number {
    if (this.isStreamerBotDeathmatchFeed()) return Number.POSITIVE_INFINITY;
    if (aliveBotCount < BOT_MOVEMENT_LOD_START_COUNT) return Number.POSITIVE_INFINITY;
    if (isBattleRoyalMode(this.gameplayMode)) {
      if (aliveBotCount >= BOT_MOVEMENT_LOD_HIGH_COUNT) return BOT_BATTLE_ROYAL_STEERING_PROBE_FRAME_BUDGET_HIGH;
      if (aliveBotCount >= BOT_MOVEMENT_LOD_MEDIUM_COUNT) return BOT_BATTLE_ROYAL_STEERING_PROBE_FRAME_BUDGET_MEDIUM;
      return BOT_BATTLE_ROYAL_STEERING_PROBE_FRAME_BUDGET_LOW;
    }
    if (aliveBotCount >= BOT_MOVEMENT_LOD_HIGH_COUNT) return BOT_STEERING_PROBE_FRAME_BUDGET_HIGH;
    if (aliveBotCount >= BOT_MOVEMENT_LOD_MEDIUM_COUNT) return BOT_STEERING_PROBE_FRAME_BUDGET_MEDIUM;
    return BOT_STEERING_PROBE_FRAME_BUDGET_LOW;
  }

  private chooseBotSteering(
    bot: Player,
    desiredMove: PlainVec2 | null,
    skill: BotSkillProfile,
    frameContext: BotFrameContext,
    priority = false
  ): { steering: BotSteeringChoice; directPathBlocked: boolean } {
    const directions = createSteeringProbeDirections(desiredMove);
    if (directions.length === 0) {
      return {
        steering: chooseLocalAvoidanceDirection(desiredMove, [], skill),
        directPathBlocked: false,
      };
    }

    const directDirection = directions.find((probe) => probe.label === 'direct') ?? directions[0];
    const probeDistance = this.getBotSteeringProbeDistance(bot, skill);
    if (!directDirection) {
      return {
        steering: chooseLocalAvoidanceDirection(desiredMove, [], skill),
        directPathBlocked: false,
      };
    }

    const directProbe = this.getBotSteeringProbe(bot, directDirection, probeDistance, frameContext, priority);
    if (!directProbe) {
      return {
        steering: chooseLocalAvoidanceDirection(desiredMove, [], skill),
        directPathBlocked: false,
      };
    }
    if (directProbe.clear) {
      return {
        steering: chooseLocalAvoidanceDirection(desiredMove, [directProbe], skill),
        directPathBlocked: false,
      };
    }

    const probes: BotSteeringProbe[] = [directProbe];
    for (const probe of directions) {
      if (probe.label === 'direct') continue;
      const steeringProbe = this.getBotSteeringProbe(bot, probe, probeDistance, frameContext, priority);
      if (!steeringProbe) break;
      probes.push(steeringProbe);
    }

    return {
      steering: chooseLocalAvoidanceDirection(desiredMove, probes, skill),
      directPathBlocked: true,
    };
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
    botSnapshot: BotPlayerSnapshot,
    blackboard: BotBlackboard,
    routePlan: BotRoutePlan,
    desiredMove: PlainVec2 | null,
    directPathBlocked: boolean,
    frameContext: BotFrameContext
  ): BotAbilityGeometry {
    const forward = forward2D(bot.lookYaw);
    const canBlink = canUseBotAbility(botSnapshot, 'phantom_blink', 'ability1');
    const blinkSafe = canBlink
      ? this.consumeBotSteeringProbeFrameBudget(frameContext) &&
        this.isBotPathClear(bot, desiredMove ?? forward, 6.5)
      : true;
    let nearbyEnemyCount = 0;
    for (const enemy of blackboard.visibleEnemies) {
      if (enemy.distance > 12) continue;
      nearbyEnemyCount++;
      if (nearbyEnemyCount >= 2) break;
    }
    const blinkDangerous = nearbyEnemyCount >= 2;
    const grappleAnchorAvailable = canUseBotAbility(botSnapshot, 'hookshot_grapple', 'ability1') &&
      this.resolveHookshotGrappleTarget(bot) !== null;
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
    const skill = getBotSkillProfile(bot.botDifficulty, bot.botProfileId);
    const snapshots = frameContext.snapshots;
    const botSnapshot = frameContext.snapshotById.get(bot.id) ?? this.getBotPlayerSnapshot(bot);
    if (!botSnapshot) return createEmptyBotInput(this.state.tick, bot, now);

    const tactics = frameContext.teamTactics[botSnapshot.team];
    if (!tactics) return createEmptyBotInput(this.state.tick, bot, now);

    clearExpiredBlockedEdges(brain.blockedEdges, now);
    const simulationTier = this.getServerOwnedBotSimulationTier(bot, now, brain);
    const refreshPlanningState = shouldRefreshBotPlanningState(brain, now);
    const refreshedPerception = refreshPlanningState
      ? this.getBotPerceptionSets(bot, frameContext, simulationTier)
      : null;
    const enemyLineOfSightIds = refreshedPerception?.enemyLineOfSightIds ?? EMPTY_BOT_PERCEPTION_IDS;
    const visibleEnemyIds = refreshedPerception?.visibleEnemyIds ?? EMPTY_BOT_PERCEPTION_IDS;
    const { blackboard, routePlan } = updateBotPlanningState({
      brain,
      now,
      gameplayMode: this.gameplayMode,
      bot: botSnapshot,
      players: snapshots,
      flags: frameContext.flags,
      safeZone: frameContext.safeZone,
      mapPings: frameContext.mapPings,
      visibleEnemyIds,
      enemyLineOfSightIds,
      recentDamageSource: refreshPlanningState
        ? this.getBotMostRecentDamageSource(bot.id, now)
        : null,
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
      protectedEnemyIds: frameContext.protectedEnemyIdsByTeam.get(botSnapshot.team) ?? EMPTY_BOT_PERCEPTION_IDS,
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
      hasClearShot: combatTarget
        ? this.hasCurrentBotTargetLineOfSight(bot, combatTarget, refreshedPerception, frameContext)
        : false,
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
    const steeringPriority = isBattleRoyalMode(this.gameplayMode) && (
      brain.intent.type === 'rotate_safe_zone' ||
      brain.intent.type === 'revive_teammate' ||
      this.isBattleRoyalSafeZonePriorityBot(bot)
    );
    const { steering, directPathBlocked } = this.chooseBotSteering(bot, desiredMove, skill, frameContext, steeringPriority);
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

    const abilityPlan = chooseBotAbilityPlan({
      now,
      bot: botSnapshot,
      intent: brain.intent,
      blackboard,
      combatPlan,
      skill,
      geometry: this.getBotAbilityGeometry(
        bot,
        botSnapshot,
        blackboard,
        routePlan,
        desiredMove,
        directPathBlocked,
        frameContext
      ),
    });
    applyBotAbilityInputPlan({
      input,
      brain,
      plan: abilityPlan,
      skill,
      now,
      tempoMultiplier,
    });

    if (this.battleRoyalDownedRuntime.isReviving(bot.id)) {
      // Already channeling a revive: any movement/jump/fire input cancels the
      // 5s hold, so keep the input locked to interact until the runtime ends
      // the revive (complete, target lost, or reviver downed).
      applyBotReviveTeammateInput(input);
    } else if (brain.intent.type === 'revive_teammate' && brain.intent.targetPlayerId) {
      const reviveTarget = this.state.players.get(brain.intent.targetPlayerId) ?? null;
      if (
        reviveTarget &&
        reviveTarget.team === bot.team &&
        reviveTarget.state === 'downed' &&
        distance3D(bot.position, reviveTarget.position) <= BATTLE_ROYAL_REVIVE_RADIUS
      ) {
        applyBotReviveTeammateInput(input);
      }
    }

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

  private canBotPerceiveEnemy(enemy: Player, distance: number, hasLineOfSight: boolean): boolean {
    if (distance > resolveBotAwarenessRange(this.gameplayMode) && !enemy.hasFlag) return false;

    const veil = enemy.abilities.get('phantom_veil');
    if (veil?.isActive && !enemy.hasFlag && distance > BOT_CLOSE_REVEAL_RANGE) {
      return false;
    }

    if (this.canBotPerceiveEnemyWithoutLineOfSight(enemy, distance)) return true;
    return hasLineOfSight;
  }

  private canBotPerceiveEnemyWithoutLineOfSight(enemy: Player, distance: number): boolean {
    return distance <= BOT_PROXIMITY_VISIBLE_RANGE || enemy.hasFlag;
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
    const collisionRevision = this.getMovementCollisionRevision(now);
    return this.lineOfSightCache.hasLineOfSight(
      start,
      end,
      now,
      collisionRevision,
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

  private shouldCreateBattleRoyalSoulForFinalElimination(player: Player): boolean {
    return (
      isBattleRoyalMode(this.gameplayMode) &&
      this.state.phase === 'playing' &&
      player.state === 'dead' &&
      !isObserverPlayer(player)
    );
  }

  private resetPlayerLifeRuntime(player: Player, now = Date.now()): void {
    if (isBattleRoyalMode(this.gameplayMode)) {
      const shouldCreateSoul = this.shouldCreateBattleRoyalSoulForFinalElimination(player);
      this.battleRoyalSouls.dropCarriedSouls(player, now);
      this.battleRoyalSouls.cancelInteractionForPlayer(player.id);
      if (shouldCreateSoul) {
        this.battleRoyalSouls.createSoul(player, now);
      } else if (player.state !== 'dead') {
        this.battleRoyalSouls.clearPlayer(player.id);
      }
    }
    this.battleRoyalDownedRuntime.clearPlayer(player, now);
    this.disablePlayerSkills(player);
    this.resetPlayerPressState(player.id);
    resetPlayerMovementRuntime(player);
    this.blazeBurns.clearTarget(player.id);
    this.blazeFlamethrowers.clearDamageTicksForPlayer(player.id);
    this.stopBlazeAfterburnerDash(player.id);
    this.playerRoots.clear(player.id);
    this.powerupBoosts.clear(player.id);
    this.clearHookshotDragPullsInvolving(player.id);
    this.attackCooldowns.clearPlayer(player.id);
    this.playerCombatActivity.clear(player.id);
    player.lastInput = player.isBot
      ? createEmptyBotInput(this.state.tick, player, now)
      : null;
  }

  private enterBattleRoyalDowned(
    target: Player,
    source: Player | null,
    payload: PlayerDownedEvent
  ): void {
    this.battleRoyalDownedRuntime.enterDowned(
      target,
      source?.id ?? null,
      payload.damageType,
      payload.downedStartedAt,
      {
        sourcePosition: payload.sourcePosition ?? null,
        sourceDirection: payload.sourceDirection ?? null,
      }
    );
  }

  private prepareBattleRoyalDownedPlayer(player: Player, now: number): void {
    if (player.hasFlag && isCaptureTheFlagMode(this.gameplayMode)) {
      this.dropFlag(player);
    }
    player.hasFlag = false;
    this.disablePlayerSkills(player);
    this.resetPlayerPressState(player.id);
    resetPlayerMovementRuntime(player);
    this.blazeBurns.clearTarget(player.id);
    this.blazeFlamethrowers.clearDamageTicksForPlayer(player.id);
    this.playerRoots.clear(player.id);
    this.powerupBoosts.clear(player.id);
    this.clearHookshotDragPullsInvolving(player.id);
    this.markMovementBarrier(player.id, 'downed');
    player.lastInput = player.isBot
      ? createEmptyBotInput(this.state.tick, player, now)
      : null;
  }

  private prepareBattleRoyalRevivedPlayer(player: Player, now: number): void {
    resetPlayerMovementRuntime(player);
    this.resetPlayerPressState(player.id);
    this.blazeBurns.clearTarget(player.id);
    this.blazeFlamethrowers.clearDamageTicksForPlayer(player.id);
    this.playerRoots.clear(player.id);
    this.clearHookshotDragPullsInvolving(player.id);
    this.markMovementBarrier(player.id, 'revived');
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
      skinId: player.skinId,
      health: player.health,
      maxHealth: player.maxHealth,
    });
  }

  private handleDevSetSkin(client: Client, skinId: HeroSkinId): void {
    if (!this.requireDevelopmentMode(client)) return;

    const player = this.state.players.get(client.sessionId);
    if (!player || !player.heroId) {
      client.send('devCommandError', { message: 'No active hero to apply a skin to' });
      return;
    }

    const skin = getHeroSkinDefinition(skinId);
    if (skin.heroId !== player.heroId) {
      client.send('devCommandError', {
        message: `${skin.displayName} belongs to ${HERO_DEFINITIONS[skin.heroId].name}`,
      });
      return;
    }

    player.skinId = skin.id;
    this.syncMatchParticipant(player);
    this.syncReconnectParticipantFromPlayer(player);
    this.broadcastStateStreams({ transforms: false, forceVitals: true, forceMatch: true });
    client.send('devSkinChanged', {
      heroId: player.heroId,
      skinId: player.skinId,
    });
  }

  private handleDevDownHero(client: Client, heroId: HeroId): void {
    if (!this.requireDevelopmentMode(client)) return;

    if (!isBattleRoyalMode(this.gameplayMode) || this.state.phase !== 'playing') {
      client.send('devCommandError', { message: '/hero down is only available during active Battle Royal matches' });
      return;
    }

    const requester = this.state.players.get(client.sessionId);
    if (!requester) {
      client.send('devCommandError', { message: 'No active player found for /hero down' });
      return;
    }

    const target = this.findDevTeammateHeroTarget(requester, heroId);
    if (!target) {
      client.send('devCommandError', {
        message: `No alive teammate ${HERO_DEFINITIONS[heroId].name} found to down`,
      });
      return;
    }

    const now = this.state.serverTime || Date.now();
    this.battleRoyalDownedRuntime.enterDowned(target, null, 'dev_command', now);
    this.broadcastStateStreams({ transforms: true, forceVitals: true, forceMatch: true });
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

  private setPlayerHero(player: Player, heroId: HeroId, skinId?: HeroSkinId | string | null): boolean {
    const heroDef = HERO_DEFINITIONS[heroId];
    if (!heroDef) return false;
    if (!this.isPlayerTeamHeroAvailable(player, heroId)) return false;

    player.heroId = heroId;
    player.skinId = this.normalizeHeroSkinId(heroId, skinId);
    player.maxHealth = heroDef.stats.maxHealth;
    player.health = player.maxHealth;
    player.ultimateCharge = 0;
    this.clearPrimaryHoldStates(player.id);
    this.chronosAegisShields.clear(player.id);
    this.devRuntime.clearPlayer(player.id);
    this.resetPrimaryMagazineForHero(player.id, heroId);
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
    initializePlayerAbilities(
      player,
      heroId,
      heroId === 'blaze' ? this.getBlazeAbilitySelection(player.id) : undefined
    );
    this.syncMatchParticipant(player);
    this.syncReconnectParticipantFromPlayer(player);

    return true;
  }

  private normalizeHeroSkinId(heroId: HeroId, skinId?: HeroSkinId | string | null): HeroSkinId {
    if (isHeroSkinId(skinId) && getHeroSkinDefinition(skinId).heroId === heroId) {
      return skinId;
    }
    return getDefaultHeroSkinId(heroId);
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

  private commitPreselectedHeroForMatchStart(player: Player): void {
    if (isObserverPlayer(player)) {
      player.heroId = '';
      player.skinId = '';
      player.abilities.clear();
      player.isReady = true;
      player.state = 'spectating';
      return;
    }

    if (!isHeroId(player.heroId) || !this.isPlayerTeamHeroAvailable(player, player.heroId)) {
      const committed = this.setPlayerHero(player, this.selectAvailableHeroForPlayer(player));
      if (!committed) {
        player.heroId = '';
        player.skinId = '';
        player.abilities.clear();
        this.disablePlayerSkills(player);
      }
    }

    player.isReady = Boolean(player.heroId);
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
    this.botRuntime.setBrain(bot.id, this.createBotBrain(bot, botIndex, {
      now,
      staggerInitialSchedule: this.state.phase === 'playing',
    }));
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

  private findDevTeammateHeroTarget(requester: Player, heroId: HeroId): Player | null {
    let target: Player | null = null;
    this.state.players.forEach((player) => {
      if (target) return;
      if (player.id === requester.id) return;
      if (this.npcs.has(player.id)) return;
      if (player.team !== requester.team) return;
      if (player.heroId !== heroId) return;
      if (player.state !== 'alive') return;
      target = player;
    });
    return target;
  }

  private primeDevBotSkill(player: Player, slot: DevBotSkillSlot): void {
    this.attackCooldowns.clearPlayer(player.id);
    this.clearPrimaryHoldStates(player.id);
    this.phantomVoidRayCharges.clear(player.id);
    this.cancelPhantomRiftBolt(player);

    if ((player.heroId === 'phantom' || player.heroId === 'blaze') && slot === 'primary') {
      this.resetPrimaryMagazineForHero(player.id, player.heroId);
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

  private async refreshMapManifestAsync(): Promise<void> {
    const mapManifest = await this.mapRuntime.refreshMapAsync();
    this.applyMapManifestRefresh(mapManifest);
  }

  private applyMapManifestRefresh(mapManifest: VoxelMapManifest): void {
    this.state.mapThemeId = mapManifest.themeId;
    this.state.mapSize = mapManifest.mapSize;
    this.state.mapProfileId = mapManifest.profileId ?? getGameplayModeRules(this.gameplayMode).mapProfileId;
    const loadedPregeneratedMap = this.mapRuntime.getLoadedPregeneratedMapSummary();
    if (loadedPregeneratedMap) {
      this.state.pregeneratedMapId = loadedPregeneratedMap.id;
      this.state.mapArtifactId = loadedPregeneratedMap.artifactId;
    } else {
      this.state.pregeneratedMapId = '';
      this.state.mapArtifactId = '';
      this.mapSelectionId = null;
    }
    this.powerupBoosts.clearAll();
    this.powerupPickups.reset(mapManifest, 0);
    const hadMapPings = this.activeMapPings.size > 0;
    this.activeMapPings.clear();
    this.hookshotRuntime.clearAnchorWalls();
    this.botSteeringPathCache.clear();
    this.lineOfSightCache.clear();
    this.visibilityInterest.clearAll();
    this.battleRoyalDownedRuntime.clearAll(this.state.players.values(), Date.now());
    this.battleRoyalSouls.clearAll();
    this.battleRoyalSafeZone = null;
    this.battleRoyalDrop = null;
    this.nextBattleRoyalSafeZoneDamageAt = 0;
    this.forceTransformFullSync();
    if (hadMapPings) this.broadcastMapPings();
  }

  private bumpMovementCollisionRevision(options: { forceTransformSync?: boolean } = {}): void {
    this.mapRuntime.bumpMovementCollisionRevision();
    if (options.forceTransformSync !== false) {
      this.forceTransformFullSync();
    }
  }

  private pruneExpiredHookshotAnchorWalls(now = Date.now()): void {
    if (this.hookshotRuntime.pruneExpiredAnchorWalls(now)) {
      this.bumpMovementCollisionRevision({ forceTransformSync: false });
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
    this.bumpMovementCollisionRevision({ forceTransformSync: false });
  }

  private getMapManifest(): VoxelMapManifest {
    return this.mapRuntime.getMapManifest();
  }

  private getBattleRoyalSummoningCircles(): readonly MapSummoningCircle[] {
    return this.getMapManifest().gameplay.summoningCircles ?? [];
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

  private resolveUnstuckCandidate(
    collisionWorld: MovementCollisionWorld,
    current: PlainVec3,
    x: number,
    z: number
  ): PlainVec3 | null {
    const clamped = this.clampToPlayableMap({ x, y: current.y, z });
    if (!this.isFiniteVec3(clamped)) return null;

    const groundY = this.getProceduralGroundY({
      x: clamped.x,
      y: current.y + UNSTUCK_GROUND_PROBE_UP,
      z: clamped.z,
    });
    if (groundY === null || !Number.isFinite(groundY)) return null;

    const candidate = this.clampToPlayableMap({
      x: clamped.x,
      y: groundY + UNSTUCK_DESTINATION_Y_OFFSET,
      z: clamped.z,
    });
    if (!this.isFiniteVec3(candidate)) return null;
    return canCapsuleOccupy(collisionWorld, candidate, PLAYER_HEIGHT, PLAYER_RADIUS) ? candidate : null;
  }

  private resolveUnstuckPosition(player: Player): PlainVec3 | null {
    const collisionWorld = this.getMovementCollisionWorld();
    const current = vec3SchemaToPlain(player.position);
    const currentCandidate = this.resolveUnstuckCandidate(collisionWorld, current, current.x, current.z);
    if (currentCandidate) return currentCandidate;

    const authority = this.getMovementAuthority(player.id);
    if (authority.lastSafe) {
      const lastSafeCandidate = this.resolveUnstuckCandidate(
        collisionWorld,
        authority.lastSafe.position,
        authority.lastSafe.position.x,
        authority.lastSafe.position.z
      );
      if (lastSafeCandidate) return lastSafeCandidate;
    }

    const startAngle = Number.isFinite(player.lookYaw) ? player.lookYaw : 0;
    for (
      let radius = UNSTUCK_SEARCH_RADIUS_STEP;
      radius <= UNSTUCK_SEARCH_MAX_RADIUS + 0.001;
      radius += UNSTUCK_SEARCH_RADIUS_STEP
    ) {
      for (let step = 0; step < UNSTUCK_SEARCH_ANGLE_COUNT; step++) {
        const angle = startAngle + (step / UNSTUCK_SEARCH_ANGLE_COUNT) * Math.PI * 2;
        const candidate = this.resolveUnstuckCandidate(
          collisionWorld,
          current,
          current.x + Math.cos(angle) * radius,
          current.z + Math.sin(angle) * radius
        );
        if (candidate) return candidate;
      }
    }

    return null;
  }

  private applyUnstuckPosition(player: Player, position: PlainVec3, client: Client): void {
    player.position.x = position.x;
    player.position.y = position.y;
    player.position.z = position.z;
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

    this.resetPlayerPressState(player.id);
    this.clearHookshotGrapple(player.id);
    this.clearHookshotDragPull(player.id);
    this.clearHookshotDragPullsInvolving(player.id);
    this.markMovementBarrier(player.id, 'teleport');
    this.sendSelfMovementAuthority(player, client, 'teleport');
  }

  private readMapPingPosition(position: unknown): PlainVec3 | null {
    if (!isRecord(position)) return null;
    const x = typeof position.x === 'number' ? position.x : Number(position.x);
    const y = typeof position.y === 'number' ? position.y : Number(position.y);
    const z = typeof position.z === 'number' ? position.z : Number(position.z);
    const parsed = { x, y, z };
    return this.isFiniteVec3(parsed) ? parsed : null;
  }

  private resolveMapPingPosition(position: PlainVec3): PlainVec3 | null {
    const clamped = this.clampToPlayableMap(position);
    if (!this.isFiniteVec3(clamped)) return null;

    const groundY = this.getProceduralGroundY({
      x: clamped.x,
      y: clamped.y + MAP_PING_GROUND_PROBE_UP,
      z: clamped.z,
    });
    const grounded = this.clampToPlayableMap({
      x: clamped.x,
      y: Number.isFinite(groundY) ? (groundY as number) + MAP_PING_GROUND_Y_OFFSET : clamped.y,
      z: clamped.z,
    });

    return this.isFiniteVec3(grounded) ? grounded : null;
  }

  private handleMapPing(client: Client, data: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.isBot || isObserverPlayer(player) || player.state !== 'alive' || !isTeam(player.team)) return;
    if (!isRecord(data)) return;

    const payload = data as MapPingRequestMessage;
    if (payload.clear === true || payload.position === null) {
      if (this.activeMapPings.delete(player.id)) this.broadcastMapPings();
      return;
    }

    const position = this.readMapPingPosition(payload.position);
    if (!position) return;

    const pingPosition = this.resolveMapPingPosition(position);
    if (!pingPosition) return;
    if (distance2D(player.position, pingPosition) > MAP_PING_MAX_DISTANCE) return;

    const previous = this.activeMapPings.get(player.id);
    if (previous && distance2D(previous.position, pingPosition) <= MAP_PING_TOGGLE_CLEAR_DISTANCE) {
      this.activeMapPings.delete(player.id);
      this.broadcastMapPings();
      return;
    }

    const now = this.state.serverTime || Date.now();
    const sequence = ++this.mapPingSequence;
    this.activeMapPings.set(player.id, {
      id: `${player.id}:${sequence}`,
      playerId: player.id,
      playerName: player.name,
      team: player.team,
      position: pingPosition,
      createdAt: now,
      expiresAt: now + MAP_PING_TTL_MS,
      sequence,
    });
    this.broadcastMapPings();
  }

  private handleUnstuckRequest(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.isBot || isObserverPlayer(player) || player.state !== 'alive') return;
    if (isBattleRoyalMode(this.gameplayMode) && this.state.phase === 'deployment') return;

    const destination = this.resolveUnstuckPosition(player);
    if (destination) {
      this.applyUnstuckPosition(player, destination, client);
      return;
    }

    this.resetPlayerPressState(player.id);
    this.clearHookshotGrapple(player.id);
    this.clearHookshotDragPull(player.id);
    this.clearHookshotDragPullsInvolving(player.id);
    this.placePlayerAtSpawn(player, 'teleport');
    this.sendSelfMovementAuthority(player, client, 'teleport');
  }

  private disablePlayerSkills(player: Player) {
    player.abilities.forEach(ability => {
      ability.isActive = false;
    });
    this.broadcastBlazeFlamethrowerState(player, false, Date.now());
    this.clearPrimaryHoldStates(player.id);
    this.phantomVoidRayCharges.clear(player.id);
    this.cancelPhantomRiftBolt(player);
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

    const assignableTeamIds = this.getAssignableTeamIds();
    if (!assignableTeamIds.includes(team)) return;

    const teamSelection = getRoomTeamSelectionDecision({
      players: this.state.players,
      playerId: client.sessionId,
      requestedTeam: team,
      teamSize: this.config.teamSize,
      teamIds: assignableTeamIds,
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

  private handleMatchSceneReady(client: Client, data: unknown): void {
    if (this.matchCancelled) return;
    if (this.state.phase !== 'hero_select' || !this.matchStartGate.isOpen()) return;

    if (!this.matchStartGate.canAcceptSceneReadyKey(readMatchSceneReadyGateKey(data))) return;

    const player = this.state.players.get(client.sessionId);
    if (!canMarkMatchSceneReady(player)) return;

    const markedSceneReady = this.matchStartGate.markSceneReady(client.sessionId);
    if (markedSceneReady) {
      this.playerPings.resetCompetitiveGateForPlayer({
        playerId: client.sessionId,
        now: Date.now(),
        matchMode: this.matchMode,
      });
    }
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
            if (isObserverPlayer(p)) {
              p.state = 'spectating';
              p.isReady = true;
              return;
            }
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
    this.state.mapProfileId = getGameplayModeRules(this.gameplayMode).mapProfileId;
    this.state.pregeneratedMapId = '';
    this.state.mapArtifactId = '';
    this.mapSelectionId = null;
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
    this.playerPings.resetCompetitiveGate({
      players: this.state.players,
      now,
      matchMode: this.matchMode,
    });

    this.state.players.forEach((player) => {
      if (isObserverPlayer(player)) {
        player.state = 'spectating';
        player.velocity.x = 0;
        player.velocity.y = 0;
        player.velocity.z = 0;
        return;
      }
      player.state = 'spawning';
    });
    if (isBattleRoyalMode(this.gameplayMode)) {
      this.battleRoyalDrop = this.placePlayersAtBattleRoyalDropShipStart(now, 'spawn');
    } else {
      this.battleRoyalDrop = null;
      this.placeTeamsAtUniqueSpawns('spawn');
    }

    this.forceTransformFullSync();
    this.broadcastStateStreams({ transforms: true, forceTransforms: true, forceVitals: true, forceMatch: true });

    this.state.players.forEach((player, playerId) => {
      if (player.isBot) return;
      if (isObserverPlayer(player)) return;

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
        mapProfileId: this.state.mapProfileId as MapProfileId,
        pregeneratedMapId: this.state.pregeneratedMapId || null,
        mapArtifactId: this.state.mapArtifactId || null,
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
    this.battleRoyalDrop = null;
    this.updateMetadata();

    this.state.players.forEach(player => {
      if (isObserverPlayer(player)) {
        player.state = 'spectating';
        player.isReady = true;
        player.heroId = '';
        player.skinId = '';
        player.abilities.clear();
        return;
      }

      player.state = 'selecting';
      const preferredHero = player.isBot ? this.botRuntime.getPreferredHero(player.id) : null;
      if (preferredHero) {
        this.setPlayerHero(player, preferredHero);
      }
      this.commitPreselectedHeroForMatchStart(player);
    });

    this.broadcastPhaseChange('hero_select');
    this.broadcastStateStreams({ transforms: false, forceVitals: true, forceMatch: true });
    this.checkPhaseTransition();
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
      if (isObserverPlayer(player)) {
        player.state = 'spectating';
        player.velocity.x = 0;
        player.velocity.y = 0;
        player.velocity.z = 0;
        return;
      }
      player.state = 'spawning';
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.velocity.z = 0;
    });

    this.broadcastPhaseChange('countdown');
    this.forceTransformFullSync();
    this.broadcastStateStreams({ transforms: true, forceTransforms: true, forceVitals: true, forceMatch: true });
  }

  private getBattleRoyalDropStatusCounts(drop: BattleRoyalDropState | null = this.battleRoyalDrop): Record<string, number> {
    const counts = {
      total: 0,
      human: 0,
      bot: 0,
      aboard: 0,
      dropping: 0,
      landed: 0,
    };
    if (!drop) return counts;

    for (const player of drop.players.values()) {
      counts.total++;
      if (player.isBot) {
        counts.bot++;
      } else {
        counts.human++;
      }
      if (player.status === 'aboard') counts.aboard++;
      if (player.status === 'dropping') counts.dropping++;
      if (player.status === 'landed') counts.landed++;
    }

    return counts;
  }

  private getRoomIdForDiagnostics(): string {
    return this.state?.roomId || 'unknown';
  }

  private startBattleRoyalDeployment(): void {
    if (this.matchCancelled) return;
    if (!isBattleRoyalMode(this.gameplayMode)) {
      this.startPlaying();
      return;
    }

    this.clearMatchStartCancelTimer();
    const now = Date.now();
    this.battleRoyalCombatPrewarmTick = -1;
    const participants = Array.from(this.state.players.values())
      .filter((player) => !isObserverPlayer(player))
      .map((player) => ({
        playerId: player.id,
        team: player.team as Team,
        isBot: player.isBot,
      }));
    this.battleRoyalDrop = createBattleRoyalDropState(this.getMapManifest(), participants, now);
    loggers.room.info('Battle Royal deployment started', {
      roomId: this.getRoomIdForDiagnostics(),
      lobbyId: this.lobbyId,
      matchMode: this.matchMode,
      participantCount: participants.length,
      humanCount: participants.filter((participant) => !participant.isBot).length,
      botCount: participants.filter((participant) => participant.isBot).length,
      statusCounts: this.getBattleRoyalDropStatusCounts(this.battleRoyalDrop),
      phaseEndsAt: this.battleRoyalDrop.phaseEndsAt,
      dropStartsAt: this.battleRoyalDrop.dropStartsAt,
      dropEndsAt: this.battleRoyalDrop.dropEndsAt,
      autoDropAt: this.battleRoyalDrop.autoDropAt,
    });
    this.applyPhaseStatePatch(buildBattleRoyalDeploymentPhaseStatePatch({
      now,
      durationMs: BATTLE_ROYAL_DEPLOYMENT_PHASE_MS,
    }));
    this.updateMetadata();

    this.state.players.forEach((player) => {
      if (isObserverPlayer(player)) {
        player.state = 'spectating';
        return;
      }
      const dropPlayer = this.battleRoyalDrop?.players.get(player.id);
      if (!dropPlayer) return;
      this.resetPlayerLifeRuntime(player, now);
      player.state = 'dropping';
      player.health = player.maxHealth;
      this.initializeBattleRoyalBodyShield(player);
      player.respawnTime = 0;
      player.spawnProtectionUntil = 0;
      this.applyBattleRoyalDropTransform(player, dropPlayer);
      this.markMovementBarrier(player.id, 'spawn');
    });

    this.broadcastPhaseChange('deployment');
    this.forceTransformFullSync();
    this.broadcastStateStreams({ transforms: true, forceTransforms: true, forceVitals: true, forceMatch: true });

    this.state.players.forEach((player, playerId) => {
      if (player.isBot) return;
      if (isObserverPlayer(player)) return;
      const client = this.clientRegistry.getClient(playerId);
      if (client) {
        this.sendSelfMovementAuthority(player, client, 'spawn');
      }
    });
  }

  private startPlaying(options: { preserveAlivePlayers?: boolean; firstSafeZoneRevealsAt?: number } = {}) {
    if (this.matchCancelled) return;
    if (!this.ensureCompetitiveNetworkQualityForStart({ cancelPending: true })) return;

    this.clearMatchStartCancelTimer();
    const now = Date.now();
    this.battleRoyalDrop = null;
    this.battleRoyalCombatPrewarmTick = -1;
    const playingPatch = buildPlayingPhaseStatePatch({
      now,
      roundTimeSeconds: this.config.roundTimeSeconds,
    });
    if (this.endlessMatch) {
      playingPatch.phaseEndTime = 0;
    }
    this.applyPhaseStatePatch(playingPatch);
    this.updateMetadata();
    const ledger = this.ensureMatchPersistenceLedger(this.state.roundStartTime);
    const preserveBattleRoyalDeploymentGameplay = isBattleRoyalMode(this.gameplayMode) &&
      options.preserveAlivePlayers === true;

    if (!preserveBattleRoyalDeploymentGameplay) {
      this.blazeBurns.clearAll();
      this.blazeLingeringAreas.clear();
      this.blazeAfterburnerTrails.clear();
      this.blazePhoenixDives.clear();
      this.blazeAfterburnerDashes.clear();
      this.phantomRiftBolts.clearAll();
    }

    this.state.players.forEach(player => {
      if (isObserverPlayer(player)) {
        player.state = 'spectating';
        player.velocity.x = 0;
        player.velocity.y = 0;
        player.velocity.z = 0;
        return;
      }

      if (options.preserveAlivePlayers && player.state === 'alive') {
        if (player.isBot) {
          this.botRuntime.setBrain(player.id, this.createBotBrain(player, hashString(player.id), {
            now,
            staggerInitialSchedule: true,
          }));
        }
        if (ledger.state === 'active') {
          this.registerMatchParticipant(player, this.state.roundStartTime);
        }
        return;
      }

      const resetPlan = applyPlayerAliveRuntimeReset(player, {
        now,
        spawnProtectionMs: this.config.spawnProtectionSeconds * 1000,
      });
      this.resetPlayerLifeRuntime(player, now);
      if (resetPlan.resetPrimaryMagazine) {
        this.resetPrimaryMagazineForHero(player.id, player.heroId);
      }
      if (resetPlan.clearChronosAegisShield) {
        this.chronosAegisShields.clear(player.id);
      }
      if (resetPlan.resetBotBrain) {
        this.botRuntime.setBrain(player.id, this.createBotBrain(player, hashString(player.id), {
          now,
          staggerInitialSchedule: true,
        }));
      }

      if (resetPlan.resetAbilityCooldowns) {
        resetAbilityCooldowns(player);
      }
      if (ledger.state === 'active') {
        this.registerMatchParticipant(player, this.state.roundStartTime);
      }
    });
    this.initializeRankedBrRewardAccumulator(ledger);

    // Reset flags
    const mapManifest = this.getMapManifest();
    resetFlagsFromManifest(this.state, mapManifest);
    if (!preserveBattleRoyalDeploymentGameplay) {
      this.powerupBoosts.clearAll();
      this.powerupPickups.reset(mapManifest, 0);
    }
    const firstSafeZoneRevealsAt = Math.max(now, options.firstSafeZoneRevealsAt ?? now);
    this.battleRoyalSafeZone = isBattleRoyalMode(this.gameplayMode)
      ? createBattleRoyalSafeZoneState(mapManifest, firstSafeZoneRevealsAt, {
        firstNextZoneRevealsAt: firstSafeZoneRevealsAt,
      })
      : null;
    this.nextBattleRoyalSafeZoneDamageAt = (this.battleRoyalSafeZone?.phaseStartedAt ?? now) + 1000;
    this.battleRoyalTeamSummarySent.clear();
    if (isBattleRoyalMode(this.gameplayMode)) {
      this.battleRoyalSouls.clearAll();
      this.battleRoyalPlacement.initialize(this.state.players.values(), now);
    } else {
      this.battleRoyalSouls.clearAll();
      this.battleRoyalPlacement.clear();
    }

    this.broadcastPhaseChange('playing');
    this.broadcastTracked('powerupState', this.powerupPickups.buildStateMessage(
      this.state.serverTime || Date.now(),
      mapManifest
    ));
    this.forceTransformFullSync();
    this.broadcastStateStreams({ transforms: true, forceTransforms: true, forceVitals: true, forceMatch: true });
    this.state.players.forEach((player) => {
      if (player.isBot) return;
      const client = this.clientRegistry.getClient(player.id);
      if (client) {
        this.sendSelfMovementAuthority(player, client, this.getMovementAuthority(player.id).correctionReason);
      }
    });
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

  private checkBattleRoyalWinCondition(): void {
    if (!isBattleRoyalMode(this.gameplayMode) || this.state.phase !== 'playing') return;

    const decision = resolveBattleRoyalMatchEnd(this.state.players.values());
    if (!decision.shouldEnd) return;

    loggers.room.info('Battle Royal match end condition reached', {
      roomId: this.getRoomIdForDiagnostics(),
      lobbyId: this.lobbyId,
      matchMode: this.matchMode,
      winningTeam: decision.winningTeam,
      contestingTeams: decision.aliveTeams,
      activeTeamCount: this.battleRoyalPlacement.activeTeamCount || null,
      placedTeams: this.battleRoyalPlacement.getPlacedTeams(),
      phase: this.state.phase,
      roundStartTime: this.state.roundStartTime,
      serverTime: Date.now(),
    });
    this.endGame(undefined, decision.winningTeam);
  }

  private updateBattleRoyalPlacement(now = Date.now()): void {
    if (!isBattleRoyalMode(this.gameplayMode) || this.state.phase !== 'playing') return;
    const placementUpdate = this.battleRoyalPlacement.update(this.state.players.values(), now);
    if (placementUpdate.reactivatedTeams.length > 0) {
      for (const team of placementUpdate.reactivatedTeams) {
        this.battleRoyalTeamSummarySent.delete(team);
      }
      loggers.room.warn('Battle Royal placement tracker reactivated contesting teams', {
        roomId: this.getRoomIdForDiagnostics(),
        lobbyId: this.lobbyId,
        matchMode: this.matchMode,
        reactivatedTeams: placementUpdate.reactivatedTeams,
        newlyPlacedTeams: placementUpdate.newlyPlacedTeams,
        activeTeamCount: this.battleRoyalPlacement.activeTeamCount || null,
        placedTeams: this.battleRoyalPlacement.getPlacedTeams(),
        contestingTeams: resolveBattleRoyalMatchEnd(this.state.players.values()).aliveTeams,
        serverTime: now,
      });
    }

    const decision = resolveBattleRoyalMatchEnd(this.state.players.values());
    if (decision.shouldEnd) {
      loggers.room.info('Battle Royal placement sweep reached match end', {
        roomId: this.getRoomIdForDiagnostics(),
        lobbyId: this.lobbyId,
        matchMode: this.matchMode,
        winningTeam: decision.winningTeam,
        contestingTeams: decision.aliveTeams,
        activeTeamCount: this.battleRoyalPlacement.activeTeamCount || null,
        placedTeams: this.battleRoyalPlacement.getPlacedTeams(),
        newlyPlacedTeams: placementUpdate.newlyPlacedTeams,
        serverTime: now,
      });
    }

    // Sweep every placed team rather than only newly placed ones, so a missed
    // summary (send failure, or a placement recorded through another path)
    // heals on the next tick instead of leaving an eliminated squad stuck
    // in-match with no end screen. The sent-set keeps this idempotent.
    for (const team of this.battleRoyalPlacement.getPlacedTeams()) {
      if (this.battleRoyalTeamSummarySent.has(team)) continue;
      this.sendBattleRoyalTeamEliminatedSummary(team, now);
    }
  }

  private finalizeBattleRoyalPlacement(winningTeam: Team | null, now = Date.now()): void {
    if (!isBattleRoyalMode(this.gameplayMode)) return;
    this.battleRoyalPlacement.finalize(this.state.players.values(), winningTeam, now);
  }

  private updateBattleRoyalSafeZone(now: number): void {
    if (!isBattleRoyalMode(this.gameplayMode) || this.state.phase !== 'playing') return;
    const current = this.battleRoyalSafeZone
      ?? createBattleRoyalSafeZoneState(this.getMapManifest(), this.state.roundStartTime || now);
    const safeZone = updateBattleRoyalSafeZoneState(current, now);
    this.battleRoyalSafeZone = safeZone;

    if (now < this.nextBattleRoyalSafeZoneDamageAt) return;
    const elapsedTicks = Math.max(1, Math.floor((now - this.nextBattleRoyalSafeZoneDamageAt) / 1000) + 1);
    this.nextBattleRoyalSafeZoneDamageAt = now + 1000;
    const damage = safeZone.damagePerSecond * elapsedTicks;

    this.state.players.forEach((player) => {
      if (!isPlayerAliveOrDowned(player)) return;
      if (!isOutsideBattleRoyalSafeZone(safeZone, player.position)) return;
      this.applyDamage(player, damage, null, 'safe_zone', {
        sourcePosition: {
          x: safeZone.center.x,
          y: player.position.y,
          z: safeZone.center.z,
        },
        bypassSpawnProtection: true,
        bypassPersonalShield: true,
        bypassShield: true,
        skipDamageBudget: true,
      });
    });
  }

  private applyBattleRoyalDropTransform(
    player: Player,
    dropPlayer: { position: PlainVec3; velocity: PlainVec3; status: string; latestInput?: PlayerInput | null }
  ): void {
    player.position.x = dropPlayer.position.x;
    player.position.y = dropPlayer.position.y;
    player.position.z = dropPlayer.position.z;
    player.velocity.x = dropPlayer.velocity.x;
    player.velocity.y = dropPlayer.velocity.y;
    player.velocity.z = dropPlayer.velocity.z;
    player.movement.isGrounded = dropPlayer.status === 'landed';
    player.movement.isSprinting = false;
    player.movement.isCrouching = false;
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
    player.movement.isWallRunning = false;
    player.movement.wallRunSide = '';
    player.movement.isGrappling = false;
    player.movement.isJetpacking = dropPlayer.status === 'dropping';
    player.movement.isGliding = false;
    if (dropPlayer.latestInput) {
      player.lookYaw = normalizeLookYaw(dropPlayer.latestInput.lookYaw);
      player.lookPitch = clampLookPitch(dropPlayer.latestInput.lookPitch);
    }
  }

  private drainBattleRoyalDropInputs(now: number): void {
    const drop = this.battleRoyalDrop;
    if (!drop) return;

    this.state.players.forEach((player) => {
      if (player.isBot || player.state !== 'dropping') return;
      const authority = this.getMovementAuthority(player.id);
      const queuedCommandCount = authority.pendingCommands.length;
      authority.metrics.queueLengthBeforeTick = queuedCommandCount;
      authority.metrics.commandsProcessedLastTick = 0;
      if (queuedCommandCount <= 0) return;

      let latestInput = player.lastInput ?? createEmptyPlayerInput(this.state.tick, player, now);
      let processedThisTick = 0;
      const budget = Math.min(queuedCommandCount, MOVEMENT_MAX_PACKET_COMMANDS);
      for (let index = 0; index < budget; index++) {
        const command = this.movementAuthorities.getNextMovementCommand(authority);
        if (!command) break;
        latestInput = this.writeMovementCommandToInput(command, latestInput, now);
        processedThisTick++;
      }

      player.lastInput = latestInput;
      setBattleRoyalDropPlayerInput(drop, player.id, latestInput);
      if (latestInput.interact) {
        startBattleRoyalTeamDrop(drop, player.team as Team, now, player.id);
      }

      authority.metrics.commandsProcessed += processedThisTick;
      authority.metrics.commandsProcessedLastTick = processedThisTick;
      authority.metrics.queueLength = authority.pendingCommands.length;
      authority.metrics.queueLengthAfterTick = authority.pendingCommands.length;
      authority.metrics.lastAckSeq = authority.lastProcessedSeq;
    });
  }

  private syncBattleRoyalDropPlayers(now: number): void {
    const drop = this.battleRoyalDrop;
    if (!drop) return;

    drop.players.forEach((dropPlayer, playerId) => {
      const player = this.state.players.get(playerId);
      if (!player) return;
      if (dropPlayer.status === 'landed' && player.state !== 'dropping') return;
      this.applyBattleRoyalDropTransform(player, dropPlayer);
      this.updateLastSafeMovement(player, this.getMovementAuthority(player.id).lastProcessedSeq, now);
    });
  }

  private activateLandedBattleRoyalDropPlayers(now: number): void {
    const drop = this.battleRoyalDrop;
    if (!drop) return;

    drop.players.forEach((dropPlayer, playerId) => {
      if (dropPlayer.status !== 'landed') return;
      const player = this.state.players.get(playerId);
      if (!player || player.state === 'alive') return;

      this.applyBattleRoyalDropTransform(player, dropPlayer);
      const resetPlan = applyPlayerAliveRuntimeReset(player, {
        now,
        spawnProtectionMs: 0,
        resetRespawnTime: true,
      });
      this.resetPlayerLifeRuntime(player, now);
      this.markMovementBarrier(player.id, 'spawn');

      if (resetPlan.resetPrimaryMagazine) {
        this.resetPrimaryMagazineForHero(player.id, player.heroId);
      }
      if (resetPlan.clearChronosAegisShield) {
        this.chronosAegisShields.clear(player.id);
      }
      if (resetPlan.resetBotBrain) {
        this.botRuntime.setBrain(player.id, this.createBotBrain(player, hashString(player.id), {
          now,
          staggerInitialSchedule: true,
        }));
      }
      if (resetPlan.resetAbilityCooldowns) {
        resetAbilityCooldowns(player);
      }

      if (!player.isBot) {
        loggers.room.info('Battle Royal human landed during deployment', {
          roomId: this.getRoomIdForDiagnostics(),
          lobbyId: this.lobbyId,
          playerId: player.id,
          userId: this.getDurableUserId(player.id),
          team: player.team,
          statusCounts: this.getBattleRoyalDropStatusCounts(drop),
          phaseEndsAt: this.state.phaseEndTime,
          serverTime: now,
        });
        const client = this.clientRegistry.getClient(player.id);
        if (client) {
          this.sendSelfMovementAuthority(player, client, 'spawn');
        }
      }
    });
  }

  private addPlayerToBattleRoyalDeployment(player: Player, now = Date.now()): void {
    this.initializeBattleRoyalBodyShield(player);
    if (!this.battleRoyalDrop) {
      this.battleRoyalDrop = this.placePlayersAtBattleRoyalDropShipStart(now, 'spawn');
      return;
    }

    const dropPlayer = addBattleRoyalDropParticipant(this.battleRoyalDrop, {
      playerId: player.id,
      team: player.team as Team,
      isBot: player.isBot,
    }, now);
    this.applyBattleRoyalDropTransform(player, dropPlayer);
    this.markMovementBarrier(player.id, 'spawn');
  }

  private initializeBattleRoyalBodyShield(player: Player): void {
    if (!isBattleRoyalMode(this.gameplayMode)) return;
    player.maxShield = BATTLE_ROYAL_BODY_SHIELD_MAX_HP;
    player.shield = BATTLE_ROYAL_BODY_SHIELD_MAX_HP;
  }

  private sendBattleRoyalDropAuthorities(now: number): void {
    this.state.players.forEach((player) => {
      if (player.isBot || player.state !== 'dropping') return;
      const client = this.clientRegistry.getClient(player.id);
      if (!client) return;
      const authority = this.getMovementAuthority(player.id);
      if (
        authority.correctionReason ||
        authority.metrics.commandsProcessedLastTick ||
        authority.lastAuthoritySentAt === 0 ||
        now - authority.lastAuthoritySentAt >= 100
      ) {
        this.sendSelfMovementAuthorityOrAck(player, client, authority.correctionReason);
      }
    });
  }

  private finishBattleRoyalDeployment(now = Date.now(), reason = 'unspecified'): void {
    const drop = this.battleRoyalDrop;
    if (!drop) {
      loggers.room.warn('Battle Royal deployment finishing without drop state', {
        roomId: this.getRoomIdForDiagnostics(),
        lobbyId: this.lobbyId,
        reason,
        phase: this.state.phase,
      });
      this.startPlaying();
      return;
    }

    const statusCountsBefore = this.getBattleRoyalDropStatusCounts(drop);
    forceLandBattleRoyalDropState({
      state: drop,
      now,
      dt: TICK_INTERVAL_MS / 1000,
      getGroundY: (position) => this.getProceduralGroundY(position),
      clampToPlayableMap: (position) => this.clampToPlayableMap(position),
    });
    this.syncBattleRoyalDropPlayers(now);
    this.activateLandedBattleRoyalDropPlayers(now);
    this.state.players.forEach((player) => {
      this.markMovementBarrier(player.id, 'spawn');
    });
    loggers.room.info('Battle Royal deployment finished', {
      roomId: this.getRoomIdForDiagnostics(),
      lobbyId: this.lobbyId,
      matchMode: this.matchMode,
      reason,
      statusCountsBefore,
      statusCountsAfter: this.getBattleRoyalDropStatusCounts(drop),
      phaseEndsAt: this.state.phaseEndTime,
      serverTime: now,
    });
    this.startPlaying({
      preserveAlivePlayers: true,
      firstSafeZoneRevealsAt: Math.max(now, drop.phaseEndsAt) + BATTLE_ROYAL_FIRST_SAFE_ZONE_REVEAL_BUFFER_MS,
    });
  }

  private updateBattleRoyalDeployment(): void {
    if (!isBattleRoyalMode(this.gameplayMode) || this.state.phase !== 'deployment') return;
    const drop = this.battleRoyalDrop;
    if (!drop) {
      this.startPlaying();
      return;
    }

    const now = Date.now();
    const dt = TICK_INTERVAL_MS / 1000;
    this.measureTickSpan('phase_gameplay_update', () => {
      this.drainBattleRoyalDropInputs(now);
      advanceBattleRoyalDropState({
        state: drop,
        now,
        dt,
        getGroundY: (position) => this.getProceduralGroundY(position),
        clampToPlayableMap: (position) => this.clampToPlayableMap(position),
      });
      this.syncBattleRoyalDropPlayers(now);
      this.activateLandedBattleRoyalDropPlayers(now);
      this.updateActivePlayerRuntimes(now, dt);
    });

    this.updatePhysics();

    this.measureTickSpan('powerups_objectives_effects', () => {
      this.updatePostMovementGameplaySystems(now);
    });

    this.sendBattleRoyalDropAuthorities(now);

    if (areAllBattleRoyalHumanDropPlayersLanded(drop)) {
      releaseAboardBattleRoyalBotPods(drop, now);
    }
    const deadlineElapsed = hasPhaseDeadlineElapsed(this.state.phaseEndTime, now);
    const completionReason = getBattleRoyalDeploymentCompletionReason(drop, deadlineElapsed);
    if (completionReason) {
      const deploymentBotCount = this.getBattleRoyalDropStatusCounts(drop).bot;
      if (
        completionReason === 'all_players_landed' &&
        deploymentBotCount >= BOT_MOVEMENT_LOD_START_COUNT &&
        this.battleRoyalCombatPrewarmTick < 0
      ) {
        this.measureTickSpan('bot_frame_context', () => this.refreshBotTeamTactics(now));
        this.tickProfiler.recordCounter('bot_tactics_deployment_prewarm');
        this.battleRoyalCombatPrewarmTick = this.state.tick;
        this.broadcastStateStreams({ transforms: true });
        return;
      }
      this.finishBattleRoyalDeployment(now, completionReason);
      return;
    }

    this.broadcastStateStreams({ transforms: true });
  }

  private endGame(forcedByPlayerId?: string, winningTeamOverride?: Team | null) {
    if (this.state.phase === 'game_end') return;

    this.applyPhaseStatePatch(buildGameEndPhaseStatePatch());
    this.updateMetadata();

    const winningTeam = winningTeamOverride !== undefined
      ? winningTeamOverride
      : getWinningTeam(this.state.redTeam.score, this.state.blueTeam.score);
    const finalScore = {
      red: this.state.redTeam.score,
      blue: this.state.blueTeam.score,
    };
    const endedAt = Date.now();
    this.finalizeBattleRoyalPlacement(winningTeam, endedAt);

    this.broadcastTracked('gameEnd', this.buildGameEndEvent(finalScore, winningTeam, endedAt, forcedByPlayerId));
    this.broadcastStateStreams({ transforms: false, forceVitals: true, forceMatch: true });

    this.persistMatchLedger(finalScore, winningTeam, forcedByPlayerId);

    this.roomTimeouts.schedule(() => this.resetAfterGame(), POST_GAME_RESET_DELAY_MS);
  }

  private resetAfterGame(): void {
    void this.resetRoomForNewMap(createRandomSeed()).catch((error) => {
      loggers.room.error('Post-game map reset failed', {
        roomId: this.roomId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private async resetRoomForNewMap(mapSeed: number): Promise<void> {
    const patch = buildPostGameResetStatePatch(mapSeed);
    // Generate the next map in the worker thread BEFORE touching room state, so
    // ticks during generation still see a consistent (old) seed + manifest and
    // never fall back to a blocking synchronous regeneration.
    const manifest = await this.mapRuntime.generateMapManifestAsync({
      mapSeed: patch.mapSeed,
      mapThemeId: patch.mapThemeId as VoxelMapTheme['id'],
      mapSize: patch.mapSize,
      mapProfileId: getGameplayModeRules(this.gameplayMode).mapProfileId,
    });

    if (this.state.pregeneratedMapId) {
      void pregeneratedMapCatalogService.releaseMapAfterLaunch({
        mapId: this.state.pregeneratedMapId,
        roomId: this.roomId,
        matchId: this.matchLedger.getMatchId(),
      });
    }
    this.battleRoyalDownedRuntime.clearAll(this.state.players.values(), Date.now());
    this.battleRoyalSouls.clearAll();
    this.applyPostGameResetStatePatch(patch);
    this.applyMapManifestRefresh(this.mapRuntime.applyGeneratedMapManifest(manifest));
    resetFlagsFromManifest(this.state, this.getMapManifest());

    this.state.players.forEach(resetPostGamePlayer);
    this.matchLedger.clear();
    this.battleRoyalPlacement.clear();
    this.battleRoyalTeamSummarySent.clear();
    this.updateMetadata();
  }

  private rotateStreamerBotDeathmatchMapIfDue(now: number): boolean {
    if (!this.isStreamerBotDeathmatchFeed()) return false;
    if (this.state.phase !== 'playing') return false;
    if (this.streamerMapRotationInFlight) return false;
    if (this.streamerMapRotationStartedAt === null) {
      this.streamerMapRotationStartedAt = now;
      this.updateMetadata();
      return false;
    }
    if (now - this.streamerMapRotationStartedAt < getStreamerBotDeathmatchMapRotationMs()) return false;

    const nextMapSeed = createRandomSeed();
    this.streamerMapRotationStartedAt = now;
    // Map generation runs in a worker; the room keeps ticking on the old map
    // until the new manifest is ready, then swaps synchronously.
    this.streamerMapRotationInFlight = true;
    void this.resetRoomForNewMap(nextMapSeed)
      .then(() => {
        loggers.room.info('Streamer bot deathmatch map rotated', {
          roomId: this.roomId,
          mapSeed: this.state.mapSeed,
          mapThemeId: this.state.mapThemeId,
          mapSize: this.state.mapSize,
          mapProfileId: this.state.mapProfileId,
        });
        this.checkPhaseTransition();
        this.broadcastStateStreams({ transforms: false, forceVitals: true, forceMatch: true });
      })
      .catch((error) => {
        loggers.room.error('Streamer bot deathmatch map rotation failed', {
          roomId: this.roomId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.streamerMapRotationInFlight = false;
      });
    return false;
  }

  private updateVoidZones(now: number) {
    this.voidZones.update(now, {
      onExpired: (zone) => {
        this.broadcastTracked('voidZoneExpired', { id: zone.id });
      },
      getTargets: (zone) => this.queryPlayersRadius(
        zone.position,
        zone.radius,
        { excludeTeam: zone.ownerTeam, excludeId: zone.ownerId, includeDowned: true }
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
    const forward = getForwardVector(player.lookYaw, player.lookPitch);
    const origin = this.getAbilitySocketCastOrigin(player, 'blaze_flamethrower');
    const aimOrigin = this.getBlazeAimOrigin(player);
    const aimPoint = this.resolveValidatedCastAimPoint(
      player,
      'blaze_flamethrower',
      aimOrigin,
      forward,
      BLAZE_FLAMETHROWER_RANGE,
      this.addScaled3D(aimOrigin, forward, BLAZE_FLAMETHROWER_RANGE)
    );
    const direction = this.normalize3D({
      x: aimPoint.x - origin.x,
      y: aimPoint.y - origin.y,
      z: aimPoint.z - origin.z,
    }) ?? forward;

    return {
      origin,
      direction,
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
      isTargetDamageable: (targetId) => {
        const target = this.state.players.get(targetId);
        return Boolean(target && isPlayerAliveOrDowned(target));
      },
      hasSource: (sourceId) => this.state.players.has(sourceId),
      applyTick: ({ targetId, sourceId, sourcePosition, sourceDirection, tickCount }) => {
        const target = this.state.players.get(targetId);
        if (!target || !isPlayerAliveOrDowned(target)) return false;
        const killed = this.applyDamage(
          target,
          BLAZE_FLAMETHROWER_BURN_DAMAGE * Math.max(1, tickCount),
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

    for (const player of this.getAlivePlayers()) {
      if (player.heroId !== 'blaze') continue;
      this.blazeFlamethrowers.markActiveThisFrame(player.id);

      const tempoMultiplier = this.getAbilityTempoMultiplier(player, now);
      const frameState = resolveBlazeFlamethrowerFrameState({
        isFiring: this.isBlazeAbilityInputActive(player, 'blaze_flamethrower'),
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

    const candidates = this.queryPlayersConeCandidates(
      origin,
      damageFrame.candidateRange,
      { excludeTeam: source.team as Team, excludeId: source.id, includeDowned: true }
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
      const previousDownedHealth = target.downedHealth;
      this.applyDamage(target, damage, source.id, 'flamethrower', {
        abilityId: 'blaze_flamethrower',
        sourcePosition: origin,
        sourceDirection: forward,
      });
      if (
        isPlayerAliveOrDowned(target) &&
        (target.health < previousHealth || target.downedHealth < previousDownedHealth)
      ) {
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

    if (!this.endlessMatch && hasTeamReachedScoreLimit(this.state.redTeam.score, this.state.blueTeam.score, this.config.scoreToWin)) {
      this.endRound();
    }
  }

  private createVoidZone(position: { x: number; y: number; z: number }, ownerId: string, ownerTeam: Team) {
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
    if (resetPlan.resetPrimaryMagazine) {
      this.resetPrimaryMagazineForHero(player.id, player.heroId);
    }
    if (resetPlan.clearChronosAegisShield) {
      this.chronosAegisShields.clear(player.id);
    }
    if (resetPlan.resetBotBrain) {
      this.botRuntime.setBrain(player.id, this.createBotBrain(player, hashString(player.id), {
        now,
        staggerInitialSchedule: true,
      }));
    }

    if (resetPlan.resetAbilityCooldowns) {
      resetAbilityCooldowns(player);
    }
  }

  private updatePhysics() {
    const tickTime = this.state.serverTime || Date.now();
    let collisionWorld: MovementCollisionWorld | null = null;
    let frameEntries = this.movementPhysicsFrameEntries;

    this.measureTickSpan('movement_frame_build', () => {
      collisionWorld = this.getMovementCollisionWorld(tickTime);
      frameEntries = this.buildMovementPhysicsFrame(tickTime);
    });

    this.measureTickSpan('movement_entries_process', () => {
      const frameCollisionWorld = collisionWorld;
      if (!frameCollisionWorld) return;
      for (const entry of frameEntries) {
        this.processMovementPhysicsFrameEntry(entry, tickTime, frameCollisionWorld);
      }
    });
    if (frameEntries.length > 0) {
      this.markPlayerSpatialIndexDirty();
    }
  }

  private buildMovementPhysicsFrame(tickTime: number): MovementPhysicsFrameEntry[] {
    const entries = this.movementPhysicsFrameEntries;
    const catchupRequests = this.movementCatchupRequests;
    const catchupFrameEntries = this.movementCatchupFrameEntries;
    entries.length = 0;
    catchupRequests.length = 0;
    catchupFrameEntries.length = 0;

    this.state.players.forEach((player) => {
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
      const queuedCommandCount = authority.pendingCommands.length;
      authority.metrics.queueLengthBeforeTick = queuedCommandCount;
      authority.metrics.commandsProcessedLastTick = 0;
      authority.metrics.catchupSubstepsSkippedLastTick = 0;

      if (player.isBot) {
        if (queuedCommandCount > 0) {
          this.movementAuthorities.replacePendingCommands(authority, []);
        }
        authority.metrics.queueLength = 0;
        authority.metrics.queueLengthBeforeTick = 0;
        authority.metrics.queueLengthAfterTick = 0;
        const entry: MovementPhysicsFrameEntry = {
          player,
          authority,
          queuedCommandCount,
          drainDecision: {
            budget: 1,
            underflow: false,
            catchup: false,
            targetPendingCommands: 0,
          },
          grantedExtraSubsteps: 0,
          skippedExtraSubsteps: 0,
          serverOwnedInput: player.lastInput ?? createEmptyBotInput(this.state.tick, player, tickTime),
        };
        entries.push(entry);
        this.tickProfiler.recordCounter('movement_frame_entries');
        this.tickProfiler.recordCounter('movement_bot_entries');
        return;
      }

      const drainDecision = getMovementCommandDrainDecision(queuedCommandCount, {
        hasAuthorityBarrier: Boolean(authority.correctionReason),
        hasGameplayInput: this.hasQueuedMovementGameplayInput(player, authority),
      });
      const baseBudget = Math.min(drainDecision.budget, SERVER_MOVEMENT_SUBSTEPS_PER_TICK);
      const requestedExtraSubsteps = Math.max(0, drainDecision.budget - baseBudget);

      const entry: MovementPhysicsFrameEntry = {
        player,
        authority,
        queuedCommandCount,
        drainDecision,
        grantedExtraSubsteps: requestedExtraSubsteps,
        skippedExtraSubsteps: 0,
      };
      entries.push(entry);
      this.tickProfiler.recordCounter('movement_frame_entries');
      if (this.npcs.has(player.id)) {
        this.tickProfiler.recordCounter('movement_npc_entries');
      } else {
        this.tickProfiler.recordCounter('movement_human_entries');
      }

      if (requestedExtraSubsteps > 0) {
        this.tickProfiler.recordCounter('movement_catchup_entries');
        catchupFrameEntries.push(entry);
        catchupRequests.push({
          playerId: player.id,
          requestedExtraSubsteps,
          backlogCommands: Math.max(0, queuedCommandCount - drainDecision.targetPendingCommands),
          oldestCommandClientTimeMs: authority.pendingCommands.peek()?.clientTimeMs ?? Number.POSITIVE_INFINITY,
          skippedCatchupSubsteps: authority.metrics.catchupSubstepsSkipped ?? 0,
        });
      }
    });

    this.reserveFreshBattleRoyalBotMovementBudget(entries, tickTime);

    if (catchupRequests.length === 0) {
      return entries;
    }

    const allocation = allocateRoomMovementCatchupBudget(
      catchupRequests,
      ROOM_MOVEMENT_EXTRA_CATCHUP_SUBSTEPS_PER_TICK,
      this.movementCatchupBudgetCursor
    );
    this.movementCatchupBudgetCursor = allocation.nextCursor;
    for (let index = 0; index < allocation.grants.length; index++) {
      const grant = allocation.grants[index];
      const entry = catchupFrameEntries[index];
      if (!grant || !entry) continue;

      entry.grantedExtraSubsteps = grant.grantedExtraSubsteps;
      entry.skippedExtraSubsteps = grant.skippedExtraSubsteps;
      if (grant.skippedExtraSubsteps > 0) {
        entry.authority.metrics.catchupSubstepsSkipped = (
          entry.authority.metrics.catchupSubstepsSkipped ?? 0
        ) + grant.skippedExtraSubsteps;
        entry.authority.metrics.catchupSubstepsSkippedLastTick = grant.skippedExtraSubsteps;
        entry.authority.metrics.roomCatchupBudgetExhaustedTicks = (
          entry.authority.metrics.roomCatchupBudgetExhaustedTicks ?? 0
        ) + 1;
      }
    }

    return entries;
  }

  private processMovementPhysicsFrameEntry(
    entry: MovementPhysicsFrameEntry,
    tickTime: number,
    collisionWorld: MovementCollisionWorld
  ): void {
    const { player, authority, drainDecision } = entry;
    let processedThisTick = 0;

    if (player.isBot) {
      this.processServerOwnedMovementFrameEntry(entry, tickTime, collisionWorld);
      return;
    }

    if (drainDecision.underflow) {
      this.tickProfiler.recordCounter('movement_underflow_entries');
      authority.metrics.underflowTicks = (authority.metrics.underflowTicks ?? 0) + 1;
      const grappleMoved = this.stepHookshotGrappleWithoutCommand(player, tickTime, collisionWorld);
      const dragPullMoved = this.stepHookshotDragPullWithoutCommand(player, tickTime, collisionWorld);
      const afterburnerMoved = this.stepBlazeAfterburnerWithoutCommand(player, tickTime, collisionWorld);
      const phoenixDiveMoved = this.stepBlazePhoenixDiveWithoutCommand(player, tickTime, collisionWorld);
      authority.metrics.queueLength = authority.pendingCommands.length;
      authority.metrics.queueLengthAfterTick = authority.pendingCommands.length;
      if (player.position.y < -10) {
        this.placePlayerAtSpawn(player, 'respawn');
      }

      const client = this.clientRegistry.getClient(player.id);
      if (client && (authority.correctionReason || grappleMoved || dragPullMoved || afterburnerMoved || phoenixDiveMoved)) {
        this.sendSelfMovementAuthority(player, client, authority.correctionReason);
      }
      return;
    }

    if (drainDecision.catchup) {
      authority.metrics.catchupTicks = (authority.metrics.catchupTicks ?? 0) + 1;
    }

    const budget = Math.min(
      drainDecision.budget,
      SERVER_MOVEMENT_SUBSTEPS_PER_TICK + entry.grantedExtraSubsteps
    );

    const movementStepsStartedAt = performance.now();
    try {
      for (let step = 0; step < budget; step++) {
        const stepSeconds = MOVEMENT_SUBSTEP_SECONDS;
        // Backlog commands are movement substeps, not future wall-clock events.
        // Giving each catch-up substep a timestamp after this authoritative tick
        // can make cooldowns and ability ordering move backwards on the next tick.
        const stepNow = tickTime;
        const epochBeforeStep = authority.movementEpoch;
        const command = this.movementAuthorities.getNextMovementCommand(authority);
        if (!command) break;
        const input = this.writeMovementCommandToInput(
          command,
          player.lastInput ?? createEmptyPlayerInput(command.seq, player, stepNow),
          stepNow
        );
        this.stepAuthoritativeMovementInput(
          player,
          input,
          stepSeconds,
          stepNow,
          collisionWorld,
          { processGameplayInput: true, command }
        );
        authority.metrics.commandsProcessed++;
        processedThisTick++;
        if (authority.movementEpoch !== epochBeforeStep) break;
      }
    } finally {
      this.tickProfiler.recordSpan(
        'movement_human_full_steps',
        performance.now() - movementStepsStartedAt
      );
    }

    authority.metrics.queueLength = authority.pendingCommands.length;
    authority.metrics.queueLengthAfterTick = authority.pendingCommands.length;
    authority.metrics.commandsProcessedLastTick = processedThisTick;
    this.tickProfiler.recordCounter('movement_steps_processed', processedThisTick);
    if (this.npcs.has(player.id)) {
      this.tickProfiler.recordCounter('movement_npc_commands_processed', processedThisTick);
    } else {
      this.tickProfiler.recordCounter('movement_human_commands_processed', processedThisTick);
    }
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
      this.sendSelfMovementAuthorityOrAck(player, client, authority.correctionReason);
    }
  }

  private processServerOwnedMovementFrameEntry(
    entry: MovementPhysicsFrameEntry,
    tickTime: number,
    collisionWorld: MovementCollisionWorld
  ): void {
    const { player, authority } = entry;
    const stepNow = tickTime;
    const input = this.getServerOwnedMovementInput(player, entry.serverOwnedInput, stepNow);
    const simulationTier = this.getServerOwnedBotSimulationTier(player, tickTime);

    if (!this.shouldRunServerOwnedBotFullMovementStep(player, tickTime, input, simulationTier)) {
      this.suppressServerOwnedBotSkippedFullStepGameplayInput(input);
      player.lastInput = input;
      player.lookYaw = input.lookYaw;
      player.lookPitch = input.lookPitch;
      const proxied = this.measureTickSpan('movement_bot_proxy_steps', () => (
        this.stepServerOwnedBotKinematicMovementProxy(
          player,
          input,
          SERVER_OWNED_MOVEMENT_STEP_SECONDS
        )
      ));
      if (this.shouldProcessServerOwnedBotProxyGameplayInput(player, input)) {
        this.measureTickSpan('movement_gameplay_input', () => {
          this.processPlayerInput(player, input, stepNow);
        });
      } else {
        this.tickProfiler.recordCounter('movement_bot_lod_proxy_gameplay_skipped');
      }
      this.updateLastSafeMovement(player, input.tick, stepNow);
      authority.metrics.commandsProcessedLastTick = 0;
      authority.metrics.queueLength = 0;
      authority.metrics.queueLengthAfterTick = 0;
      authority.metrics.lastAckSeq = authority.lastProcessedSeq;
      this.tickProfiler.recordCounter('movement_bot_lod_steps_skipped');
      if (proxied) {
        this.tickProfiler.recordCounter('movement_bot_lod_kinematic_proxy_steps');
      }
      if (proxied && simulationTier === 'background') {
        this.tickProfiler.recordCounter('movement_bot_lod_background_proxy_steps');
      }
      this.tickProfiler.recordCounter(proxied ? 'movement_bot_lod_proxy_steps' : 'movement_bot_lod_proxy_rejected');
      if (player.position.y < -10) {
        this.placePlayerAtSpawn(player, 'respawn');
      }
      return;
    }

    if (this.shouldSuppressServerOwnedBotHighCountFullStepAbilityInput(simulationTier)) {
      this.suppressServerOwnedBotHighCountFullStepAbilityInput(input);
    }

    this.measureTickSpan('movement_bot_full_steps', () => {
      this.stepAuthoritativeMovementInput(
        player,
        input,
        SERVER_OWNED_MOVEMENT_STEP_SECONDS,
        stepNow,
        collisionWorld,
        { processGameplayInput: true }
      );
    });

    const processedThisTick = 1;
    authority.metrics.commandsProcessed += processedThisTick;
    authority.metrics.commandsProcessedLastTick = processedThisTick;
    authority.metrics.queueLength = 0;
    authority.metrics.queueLengthAfterTick = 0;
    authority.metrics.lastAckSeq = authority.lastProcessedSeq;
    this.tickProfiler.recordCounter('movement_steps_processed', processedThisTick);
    this.tickProfiler.recordCounter('movement_bot_steps_processed', processedThisTick);

    if (player.position.y < -10) {
      this.placePlayerAtSpawn(player, 'respawn');
    }
  }

  private shouldProcessServerOwnedBotProxyGameplayInput(player: Player, input: PlayerInput): boolean {
    return this.shouldProcessMovementGameplayInput(player, input);
  }

  private hasPressedGameplayState(previous: PlayerPressState | undefined): boolean {
    return Boolean(
      previous?.primaryFire ||
      previous?.secondaryFire ||
      previous?.reload ||
      previous?.ability1 ||
      previous?.ability2 ||
      previous?.ultimate
    );
  }

  private hasQueuedMovementGameplayInput(player: Player, authority: ServerMovementAuthorityState): boolean {
    if (this.hasPressedGameplayState(this.playerPressStates.get(player.id))) {
      return true;
    }

    return authority.pendingCommands.hasQueuedGameplayInput;
  }

  private suppressServerOwnedBotSkippedFullStepGameplayInput(input: PlayerInput): void {
    const keepBattleRoyalInteract = input.interact && isBattleRoyalMode(this.gameplayMode);
    const suppressesGameplay =
      input.primaryFire ||
      input.secondaryFire ||
      input.reload ||
      input.ability1 ||
      input.ability2 ||
      input.ultimate ||
      (input.interact && !keepBattleRoyalInteract);

    if (input.primaryFire) {
      input.primaryFire = false;
    }
    if (input.secondaryFire) {
      input.secondaryFire = false;
    }
    input.reload = false;
    input.ability1 = false;
    input.ability2 = false;
    input.ultimate = false;
    input.interact = keepBattleRoyalInteract;
    if (suppressesGameplay) {
      this.tickProfiler.recordCounter('movement_bot_lod_proxy_gameplay_suppressed');
    }
  }

  private suppressServerOwnedBotHighCountFullStepAbilityInput(input: PlayerInput): void {
    const keepBattleRoyalInteract = input.interact && isBattleRoyalMode(this.gameplayMode);
    const suppressesAbility = input.ability1 || input.ability2 || input.ultimate || (input.interact && !keepBattleRoyalInteract);
    input.ability1 = false;
    input.ability2 = false;
    input.ultimate = false;
    if (!keepBattleRoyalInteract) {
      input.interact = false;
    }
    if (suppressesAbility) {
      this.tickProfiler.recordCounter('movement_bot_lod_full_ability_suppressed');
    }
  }

  private shouldSuppressServerOwnedBotHighCountFullStepAbilityInput(simulationTier: BotSimulationTier): boolean {
    if (this.getAliveBotMovementLodCount() < BOT_MOVEMENT_LOD_HIGH_COUNT) return false;
    return !(isBattleRoyalMode(this.gameplayMode) && simulationTier === 'critical');
  }

  private shouldProcessMovementGameplayInput(player: Player, input: PlayerInput): boolean {
    if (
      input.primaryFire ||
      input.secondaryFire ||
      input.reload ||
      input.ability1 ||
      input.ability2 ||
      input.ultimate ||
      input.interact
    ) {
      return true;
    }

    return (this.battleRoyalDownedRuntime?.isReviving(player.id) ?? false) ||
      (this.battleRoyalSouls?.hasActiveInteraction(player.id) ?? false) ||
      this.hasPressedGameplayState(this.playerPressStates.get(player.id));
  }

  private shouldRunServerOwnedBotFullMovementStep(
    player: Player,
    tickTime: number,
    input: PlayerInput,
    simulationTier = this.getServerOwnedBotSimulationTier(player, tickTime)
  ): boolean {
    if (this.isStreamerBotDeathmatchFeed() && player.isBot) return true;

    const fullRateReason = this.getServerOwnedBotMovementFullRateReason(player, input);
    if (fullRateReason) {
      this.tickProfiler.recordCounter(fullRateReason);
      if (this.shouldServerOwnedBotMovementReasonBypassBudget(fullRateReason, simulationTier, input, player.id)) {
        return true;
      }
      return this.consumeServerOwnedBotMovementFullStepBudget(this.getAliveBotMovementLodCount(), simulationTier);
    }

    const aliveBotCount = this.getAliveBotMovementLodCount();
    if (aliveBotCount < BOT_MOVEMENT_LOD_START_COUNT) return true;

    this.tickProfiler.recordCounter('movement_bot_lod_eligible');
    const cadence = this.getServerOwnedBotMovementLodCadence(aliveBotCount, simulationTier);
    if ((this.state.tick + hashString(player.id)) % cadence !== 0) return false;
    return this.consumeServerOwnedBotMovementFullStepBudget(aliveBotCount, simulationTier);
  }

  private reserveFreshBattleRoyalBotMovementBudget(
    entries: readonly MovementPhysicsFrameEntry[],
    tickTime: number
  ): void {
    if (!isBattleRoyalMode(this.gameplayMode)) return;
    const aliveBotCount = this.getAliveBotMovementLodCount();
    if (aliveBotCount < BOT_MOVEMENT_LOD_START_COUNT) return;

    const fullStepBudget = this.getServerOwnedBotMovementFullStepBudget(aliveBotCount);
    if (!Number.isFinite(fullStepBudget)) return;

    // Freshly planned critical bots bypass the shared counter for responsiveness.
    // Reserve their slots up front so reused inputs cannot make the frame exceed
    // the total physics budget; the planning cursor rotates the fresh set fairly.
    let reservedFreshCriticalSteps = 0;
    for (const entry of entries) {
      const { player, serverOwnedInput } = entry;
      if (!player.isBot || !serverOwnedInput || this.botsWithReusedInputThisTick.has(player.id)) continue;
      if (this.getServerOwnedBotSimulationTier(player, tickTime) !== 'critical') continue;
      if (serverOwnedInput.interact) continue;
      const reason = this.getServerOwnedBotMovementFullRateReason(player, serverOwnedInput);
      if (!reason || !this.isCriticalBattleRoyalBotMovementFullRateReason(reason)) continue;
      reservedFreshCriticalSteps++;
    }

    if (reservedFreshCriticalSteps === 0) return;
    this.botMovementFullStepBudgetTick = this.state.tick;
    this.botMovementFullStepBudgetRemaining = Math.max(0, fullStepBudget - reservedFreshCriticalSteps);
    this.tickProfiler.recordCounter(
      'movement_bot_lod_fresh_critical_budget_reserved',
      reservedFreshCriticalSteps
    );
  }

  private recordBotMovementBudgetStepTierCounter(tier: BotSimulationTier): void {
    switch (tier) {
      case 'critical':
        this.tickProfiler.recordCounter('movement_bot_lod_budget_steps_critical');
        return;
      case 'near':
        this.tickProfiler.recordCounter('movement_bot_lod_budget_steps_near');
        return;
      case 'background':
        this.tickProfiler.recordCounter('movement_bot_lod_budget_steps_background');
        return;
    }
  }

  private recordBotMovementBudgetExhaustedTierCounter(tier: BotSimulationTier): void {
    switch (tier) {
      case 'critical':
        this.tickProfiler.recordCounter('movement_bot_lod_budget_exhausted_critical');
        return;
      case 'near':
        this.tickProfiler.recordCounter('movement_bot_lod_budget_exhausted_near');
        return;
      case 'background':
        this.tickProfiler.recordCounter('movement_bot_lod_budget_exhausted_background');
        return;
    }
  }

  private shouldServerOwnedBotMovementReasonBypassBudget(
    reason: RoomTickCounterName,
    tier: BotSimulationTier,
    input: PlayerInput,
    botId?: string
  ): boolean {
    if (tier === 'critical' && isBattleRoyalMode(this.gameplayMode)) {
      if (input.interact) return true;
      if (
        botId &&
        this.getAliveBotMovementLodCount() >= BOT_MOVEMENT_LOD_START_COUNT &&
        this.botsWithReusedInputThisTick.has(botId)
      ) {
        this.tickProfiler.recordCounter('movement_bot_lod_reused_critical_bypass_suppressed');
        return false;
      }
      if (this.isCriticalBattleRoyalBotMovementFullRateReason(reason)) return true;
    }
    return this.isCriticalServerOwnedBotMovementFullRateReason(reason);
  }

  private isCriticalBattleRoyalBotMovementFullRateReason(reason: RoomTickCounterName): boolean {
    return reason === 'movement_bot_lod_full_enemy_battle_royal' ||
      reason === 'movement_bot_lod_full_input' ||
      reason === 'movement_bot_lod_full_active_ability' ||
      reason === 'movement_bot_lod_full_airborne';
  }

  private isCriticalServerOwnedBotMovementFullRateReason(reason: RoomTickCounterName): boolean {
    return reason === 'movement_bot_lod_full_flag' || reason === 'movement_bot_lod_full_grapple';
  }

  private consumeServerOwnedBotMovementFullStepBudget(
    aliveBotCount: number,
    simulationTier?: BotSimulationTier
  ): boolean {
    if (this.botMovementFullStepBudgetTick !== this.state.tick) {
      this.botMovementFullStepBudgetTick = this.state.tick;
      this.botMovementFullStepBudgetRemaining = this.getServerOwnedBotMovementFullStepBudget(aliveBotCount);
    }

    if (!Number.isFinite(this.botMovementFullStepBudgetRemaining)) return true;
    if (this.botMovementFullStepBudgetRemaining <= 0) {
      this.tickProfiler.recordCounter('movement_bot_lod_budget_exhausted');
      if (simulationTier) this.recordBotMovementBudgetExhaustedTierCounter(simulationTier);
      return false;
    }

    this.botMovementFullStepBudgetRemaining--;
    this.tickProfiler.recordCounter('movement_bot_lod_budget_steps');
    if (simulationTier) this.recordBotMovementBudgetStepTierCounter(simulationTier);
    return true;
  }

  private getServerOwnedBotMovementFullStepBudget(aliveBotCount: number): number {
    if (this.isStreamerBotDeathmatchFeed()) return Number.POSITIVE_INFINITY;
    if (aliveBotCount < BOT_MOVEMENT_LOD_START_COUNT) return Number.POSITIVE_INFINITY;
    if (isBattleRoyalMode(this.gameplayMode)) {
      if (aliveBotCount >= BOT_MOVEMENT_LOD_HIGH_COUNT) return BOT_BATTLE_ROYAL_MOVEMENT_FULL_STEP_BUDGET_HIGH;
      if (aliveBotCount >= BOT_MOVEMENT_LOD_MEDIUM_COUNT) return BOT_BATTLE_ROYAL_MOVEMENT_FULL_STEP_BUDGET_MEDIUM;
      return BOT_BATTLE_ROYAL_MOVEMENT_FULL_STEP_BUDGET_LOW;
    }
    if (aliveBotCount >= BOT_MOVEMENT_LOD_HIGH_COUNT) return BOT_MOVEMENT_LOD_FULL_STEP_BUDGET_HIGH;
    if (aliveBotCount >= BOT_MOVEMENT_LOD_MEDIUM_COUNT) return BOT_MOVEMENT_LOD_FULL_STEP_BUDGET_MEDIUM;
    return BOT_MOVEMENT_LOD_FULL_STEP_BUDGET_LOW;
  }

  private stepServerOwnedBotMovementLodProxy(
    player: Player,
    input: PlayerInput,
    stepSeconds: number
  ): boolean {
    if (
      !player.movement.isGrounded ||
      player.movement.isSliding ||
      player.movement.isWallRunning ||
      player.movement.isGrappling ||
      player.movement.isJetpacking ||
      player.movement.isGliding ||
      Math.abs(player.velocity.y) > 0.01 ||
      input.ability1 ||
      input.ability2 ||
      input.ultimate
    ) {
      return false;
    }

    const dt = Math.max(0, Math.min(0.1, stepSeconds));
    if (dt <= 0) return false;

    const movementIntent = resolveDirectionalMovementIntent(input);
    let velocityX = player.velocity.x;
    let velocityZ = player.velocity.z;
    const horizontalSpeed = Math.sqrt(velocityX * velocityX + velocityZ * velocityZ);
    if (horizontalSpeed > 0) {
      const friction = movementIntent.hasMovementInput
        ? BHOP_GROUND_FRICTION
        : BHOP_GROUND_FRICTION * BHOP_NO_INPUT_FRICTION_MULTIPLIER;
      const control = horizontalSpeed < BHOP_STOP_SPEED ? BHOP_STOP_SPEED : horizontalSpeed;
      const drop = control * friction * dt;
      let nextSpeed = Math.max(0, horizontalSpeed - drop);
      if (!movementIntent.hasMovementInput && nextSpeed < BHOP_GROUND_STOP_THRESHOLD) nextSpeed = 0;
      if (nextSpeed !== horizontalSpeed) {
        const scale = nextSpeed / horizontalSpeed;
        velocityX *= scale;
        velocityZ *= scale;
      }
    }

    if (movementIntent.hasMovementInput) {
      const forwardScale = -movementIntent.localZ;
      const rightScale = movementIntent.localX;
      const forwardX = -Math.sin(input.lookYaw);
      const forwardZ = -Math.cos(input.lookYaw);
      const rightX = Math.cos(input.lookYaw);
      const rightZ = -Math.sin(input.lookYaw);
      let wishX = forwardX * forwardScale + rightX * rightScale;
      let wishZ = forwardZ * forwardScale + rightZ * rightScale;
      const wishLength = Math.sqrt(wishX * wishX + wishZ * wishZ);
      if (wishLength > 0.001) {
        wishX /= wishLength;
        wishZ /= wishLength;
        let wishSpeed = getHeroStats(player.heroId as HeroId).moveSpeed *
          movementIntent.speedMultiplier *
          this.getActiveSpeedMultiplier(player);
        if (input.sprint && movementIntent.allowsSprint && !input.crouch && !player.movement.isCrouching) {
          wishSpeed *= SPRINT_MULTIPLIER;
        }
        if (input.crouch || player.movement.isCrouching) {
          wishSpeed *= CROUCH_MULTIPLIER;
        }

        const currentSpeed = velocityX * wishX + velocityZ * wishZ;
        const addSpeed = wishSpeed - currentSpeed;
        if (addSpeed > 0) {
          const accelSpeed = Math.min(BHOP_GROUND_ACCEL * dt * wishSpeed, addSpeed);
          velocityX += accelSpeed * wishX;
          velocityZ += accelSpeed * wishZ;
        }
      }
    }

    let deltaX = velocityX * dt;
    let deltaZ = velocityZ * dt;
    let distance = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
    if (distance < BOT_MOVEMENT_LOD_PROXY_MIN_HORIZONTAL_SPEED * dt) {
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.velocity.z = 0;
      player.movement.isSprinting = false;
      this.tickProfiler.recordCounter('movement_bot_lod_proxy_stationary');
      return true;
    }

    if (distance > BOT_MOVEMENT_LOD_PROXY_MAX_DISTANCE) {
      const scale = BOT_MOVEMENT_LOD_PROXY_MAX_DISTANCE / distance;
      deltaX *= scale;
      deltaZ *= scale;
      velocityX *= scale;
      velocityZ *= scale;
      distance = BOT_MOVEMENT_LOD_PROXY_MAX_DISTANCE;
    }

    const proposed = this.clampToPlayableMap({
      x: player.position.x + deltaX,
      y: player.position.y,
      z: player.position.z + deltaZ,
    });
    if (!this.isFiniteVec3(proposed)) return false;

    const groundY = this.getProceduralGroundY(proposed);
    if (groundY === null) return false;

    const nextY = groundY + PLAYER_HEIGHT / 2;
    if (!Number.isFinite(nextY) || Math.abs(nextY - player.position.y) > BOT_MOVEMENT_LOD_PROXY_MAX_GROUND_DELTA) {
      return false;
    }

    if (!this.isBotCapsulePathClear(vec3SchemaToPlain(player.position), {
      x: proposed.x,
      y: nextY,
      z: proposed.z,
    })) {
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.velocity.z = 0;
      player.movement.isSprinting = false;
      this.tickProfiler.recordCounter('movement_bot_lod_proxy_collision_rejected');
      return true;
    }

    const clampedX = Math.abs(proposed.x - (player.position.x + deltaX)) > 0.001;
    const clampedZ = Math.abs(proposed.z - (player.position.z + deltaZ)) > 0.001;
    player.position.x = proposed.x;
    player.position.y = nextY;
    player.position.z = proposed.z;
    player.velocity.x = clampedX ? 0 : velocityX;
    player.velocity.y = 0;
    player.velocity.z = clampedZ ? 0 : velocityZ;
    player.movement.isGrounded = true;
    player.movement.isSprinting = Boolean(
      input.sprint &&
      movementIntent.allowsSprint &&
      movementIntent.hasMovementInput &&
      !input.crouch &&
      !player.movement.isCrouching
    );
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
    player.movement.isWallRunning = false;
    player.movement.wallRunSide = '';
    return distance > 0;
  }

  private stepServerOwnedBotKinematicMovementProxy(
    player: Player,
    input: PlayerInput,
    stepSeconds: number
  ): boolean {
    const groundedProxy = this.stepServerOwnedBotMovementLodProxy(player, input, stepSeconds);
    if (groundedProxy) return true;

    if (
      player.movement.isGrappling ||
      player.movement.isWallRunning ||
      player.movement.isJetpacking ||
      player.movement.isGliding ||
      input.ability1 ||
      input.ability2 ||
      input.ultimate
    ) {
      return false;
    }

    const dt = Math.max(0, Math.min(0.1, stepSeconds));
    if (dt <= 0) return false;

    let deltaX = player.velocity.x * dt;
    let deltaZ = player.velocity.z * dt;
    const horizontalDistance = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
    if (horizontalDistance > BOT_MOVEMENT_LOD_PROXY_MAX_DISTANCE) {
      const scale = BOT_MOVEMENT_LOD_PROXY_MAX_DISTANCE / horizontalDistance;
      deltaX *= scale;
      deltaZ *= scale;
    }

    let proposed = this.clampToPlayableMap({
      x: player.position.x + deltaX,
      y: player.position.y,
      z: player.position.z + deltaZ,
    });
    if (!this.isFiniteVec3(proposed)) return false;

    const groundY = this.getProceduralGroundY(proposed);
    if (groundY === null) return false;

    const previousVelocityY = player.velocity.y;
    const nextVelocityY = previousVelocityY + GRAVITY * dt;
    const groundedY = groundY + PLAYER_HEIGHT / 2;
    let nextY = player.position.y + (previousVelocityY + nextVelocityY) * 0.5 * dt;
    let grounded = false;

    if (nextY <= groundedY + 0.05 && nextVelocityY <= 0) {
      nextY = groundedY;
      grounded = true;
    } else if (Math.abs(nextY - player.position.y) > BOT_MOVEMENT_LOD_PROXY_MAX_GROUND_DELTA) {
      return false;
    }

    let blockedByCollision = false;
    if (!this.isBotCapsulePathClear(vec3SchemaToPlain(player.position), {
      x: proposed.x,
      y: nextY,
      z: proposed.z,
    })) {
      blockedByCollision = true;
      deltaX = 0;
      deltaZ = 0;
      proposed = {
        x: player.position.x,
        y: proposed.y,
        z: player.position.z,
      };
      this.tickProfiler.recordCounter('movement_bot_lod_proxy_collision_rejected');
    }

    const clampedX = Math.abs(proposed.x - (player.position.x + deltaX)) > 0.001;
    const clampedZ = Math.abs(proposed.z - (player.position.z + deltaZ)) > 0.001;
    player.position.x = proposed.x;
    player.position.y = nextY;
    player.position.z = proposed.z;
    player.velocity.x = blockedByCollision || clampedX ? 0 : player.velocity.x;
    player.velocity.y = grounded ? 0 : nextVelocityY;
    player.velocity.z = blockedByCollision || clampedZ ? 0 : player.velocity.z;
    player.movement.isGrounded = grounded;
    if (grounded) {
      player.movement.isSliding = false;
      player.movement.slideTimeRemaining = 0;
    }
    return true;
  }

  private getAliveBotMovementLodCount(): number {
    if (this.botMovementLodCountTick === this.state.tick) {
      return this.aliveBotMovementLodCount;
    }

    let count = 0;
    this.state.players.forEach((player) => {
      if (player.isBot && player.state === 'alive') count++;
    });
    this.botMovementLodCountTick = this.state.tick;
    this.aliveBotMovementLodCount = count;
    return count;
  }

  private getServerOwnedBotMovementLodCadence(
    aliveBotCount: number,
    simulationTier: BotSimulationTier = 'near'
  ): number {
    if (simulationTier === 'background') {
      if (aliveBotCount >= BOT_MOVEMENT_LOD_HIGH_COUNT) return BOT_BACKGROUND_MOVEMENT_CADENCE_HIGH;
      if (aliveBotCount >= BOT_MOVEMENT_LOD_MEDIUM_COUNT) return BOT_BACKGROUND_MOVEMENT_CADENCE_MEDIUM;
    }
    if (aliveBotCount >= BOT_MOVEMENT_LOD_HIGH_COUNT) return 4;
    if (aliveBotCount >= BOT_MOVEMENT_LOD_MEDIUM_COUNT) return 3;
    return 2;
  }

  private getServerOwnedBotMovementFullRateReason(
    player: Player,
    input: PlayerInput
  ): RoomTickCounterName | null {
    if (player.hasFlag) return 'movement_bot_lod_full_flag';
    if (this.doesServerOwnedBotMovementInputRequireFullRate(player, input)) {
      return 'movement_bot_lod_full_input';
    }
    if (this.hookshotRuntime.hasDragPull(player.id) || player.movement.isGrappling) {
      return 'movement_bot_lod_full_grapple';
    }
    if (this.isVisibleAbilityActive(player)) return 'movement_bot_lod_full_active_ability';
    if (
      !player.movement.isGrounded ||
      player.movement.isSliding ||
      player.movement.isWallRunning ||
      player.movement.isJetpacking ||
      player.movement.isGliding ||
      Math.abs(player.velocity.y) > 0.01
    ) {
      return 'movement_bot_lod_full_airborne';
    }
    if (
      isBattleRoyalMode(this.gameplayMode) &&
      this.isServerOwnedBotNearCriticalBattleRoyalEnemy(player)
    ) {
      return 'movement_bot_lod_full_enemy_battle_royal';
    }
    return this.isServerOwnedBotNearEnemyHuman(player, BOT_MOVEMENT_LOD_ENEMY_HUMAN_DISTANCE_SQ)
      ? 'movement_bot_lod_full_enemy_human'
      : null;
  }

  private isServerOwnedBotNearEnemyHuman(bot: Player, distanceSq: number): boolean {
    const radius = Math.sqrt(distanceSq);
    const candidates = this.botMovementLodEnemyHumanScratch;
    this.queryPlayersRadiusInto(
      bot.position,
      radius,
      candidates,
      { excludeTeam: bot.team, excludeId: bot.id }
    );

    for (const player of candidates) {
      if (player.isBot || player.state !== 'alive') continue;
      const dx = player.position.x - bot.position.x;
      const dy = player.position.y - bot.position.y;
      const dz = player.position.z - bot.position.z;
      if (dx * dx + dy * dy + dz * dz <= distanceSq) return true;
    }
    return false;
  }

  private isServerOwnedBotNearHuman(bot: Player, distanceSq: number): boolean {
    const radius = Math.sqrt(distanceSq);
    const candidates = this.botSimulationHumanScratch;
    this.queryPlayersRadiusInto(
      bot.position,
      radius,
      candidates,
      { excludeId: bot.id }
    );

    for (const player of candidates) {
      if (player.isBot || player.state !== 'alive') continue;
      const dx = player.position.x - bot.position.x;
      const dy = player.position.y - bot.position.y;
      const dz = player.position.z - bot.position.z;
      if (dx * dx + dy * dy + dz * dz <= distanceSq) return true;
    }
    return false;
  }

  private doesServerOwnedBotMovementInputRequireFullRate(player: Player, input: PlayerInput): boolean {
    if (input.jump || input.crouchPressed) return true;
    if (!isHeroId(player.heroId)) return input.ability1 || input.ability2 || input.ultimate;

    switch (player.heroId) {
      case 'phantom':
        return input.ability1;
      case 'hookshot':
        return input.ability1;
      case 'blaze':
        return input.ability2;
      case 'chronos':
        return input.ultimate;
      default:
        return input.ability1 || input.ability2 || input.ultimate;
    }
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

  private placePlayerAtBattleRoyalSummoningCircle(
    player: Player,
    circle: MapSummoningCircle,
    index: number,
    total: number
  ): void {
    const spreadRadius = total <= 1 ? 0 : Math.min(circle.radius * 0.48, 1.6);
    const angle = total <= 1 ? 0 : (index / Math.max(1, total)) * Math.PI * 2;
    const clamped = this.clampToPlayableMap({
      x: circle.position.x + Math.cos(angle) * spreadRadius,
      y: circle.position.y + PLAYER_HEIGHT,
      z: circle.position.z + Math.sin(angle) * spreadRadius,
    });
    const groundY = this.getProceduralGroundY(clamped);
    const fallbackY = circle.position.y + PLAYER_HEIGHT / 2 + 0.06;

    player.position.x = clamped.x;
    player.position.y = groundY !== null && Number.isFinite(groundY)
      ? groundY + PLAYER_HEIGHT / 2 + 0.06
      : fallbackY;
    player.position.z = clamped.z;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    this.markMovementBarrier(player.id, 'revived');
  }

  private placePlayersAtBattleRoyalDropShipStart(
    now: number,
    reason: MovementCorrectionReason = 'spawn'
  ): BattleRoyalDropState {
    const previewDrop = createBattleRoyalDropState(
      this.getMapManifest(),
      Array.from(this.state.players.values())
        .filter((player) => !isObserverPlayer(player))
        .map((player) => ({
          playerId: player.id,
          team: player.team as Team,
          isBot: player.isBot,
        })),
      now
    );

    previewDrop.players.forEach((dropPlayer, playerId) => {
      const player = this.state.players.get(playerId);
      if (!player) return;
      this.applyBattleRoyalDropTransform(player, dropPlayer);
      this.markMovementBarrier(player.id, reason);
    });
    return previewDrop;
  }

  private getAssignableTeamIds(): readonly Team[] {
    return getTeamIdsForGameplayMode(this.gameplayMode).slice(0, this.config.maxTeams);
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
    npc.skinId = getDefaultHeroSkinId(heroId);
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
    const player = this.state.players.get(playerId);
    if (player) {
      const now = Date.now();
      this.battleRoyalDownedRuntime.clearPlayer(
        player,
        now,
        player.state === 'downed' ? 'target_removed' : 'reviver_removed'
      );
      this.battleRoyalSouls.dropCarriedSouls(player, now);
      this.battleRoyalSouls.clearPlayer(player.id);
    }
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
