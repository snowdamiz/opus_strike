import { Room, Client } from 'colyseus';
import { GameState } from './schema/GameState';
import { Player } from './schema/Player';
import { Vec3Schema, AbilityStateSchema } from './schema/Components';
import {
  DEFAULT_GAME_CONFIG,
  TICK_RATE,
  TICK_INTERVAL_MS,
  HERO_DEFINITIONS,
  ABILITY_DEFINITIONS,
  getHeroStats,
  ALL_HERO_IDS,
  createRandomSeed,
  generateProceduralVoxelMap,
  createProceduralTerrainLookup,
  isInsideBoundaryPolygon,
  constrainToBoundaryPolygon,
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
  BLAZE_FLAMETHROWER_SOCKET_FORWARD_OFFSET,
  BLAZE_FLAMETHROWER_SOCKET_HAND_HEIGHT,
  BLAZE_FLAMETHROWER_SOCKET_SIDE_OFFSET,
  BLAZE_GEARSTORM_RADIUS,
  CHRONOS_LIFELINE_HEAL,
  CHRONOS_LIFELINE_MAX_TARGETS,
  CHRONOS_LIFELINE_RADIUS,
  CHRONOS_LIFELINE_RELEASE_DELAY_MS,
  CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
  CHRONOS_TIMEBREAK_SHOCKWAVE_AUTHORITY_MS,
  CHRONOS_TIMEBREAK_SHOCKWAVE_HALF_ANGLE,
  CHRONOS_TIMEBREAK_SHOCKWAVE_KNOCKBACK_FORCE,
  CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE,
  CHRONOS_TIMEBREAK_SHOCKWAVE_VERTICAL_FORCE,
  CHRONOS_VERDANT_PULSE_AIM_DISTANCE,
  CHRONOS_VERDANT_PULSE_COOLDOWN_MS,
  CHRONOS_VERDANT_PULSE_DAMAGE,
  CHRONOS_VERDANT_PULSE_FIRE_READY_MS,
  CHRONOS_VERDANT_PULSE_SPAWN_FORWARD_OFFSET,
  CHRONOS_VERDANT_PULSE_SPEED,
  GRAPPLE_MAX_DISTANCE,
  PHANTOM_PRIMARY_MAGAZINE_SIZE,
  PHANTOM_PRIMARY_FIRE_READY_MS,
  PHANTOM_PRIMARY_RELOAD_MS,
  PHANTOM_VOID_RAY_COOLDOWN_MS,
  VOID_RAY_CHARGE_TIME,
  UNSTUCK_COOLDOWN_MS,
  findUnstuckTerrainTeleport,
  MOVEMENT_PROTOCOL_VERSION,
  MOVEMENT_SUBSTEP_RATE,
  MOVEMENT_SUBSTEP_SECONDS,
  MOVEMENT_MAX_PACKET_COMMANDS,
  MOVEMENT_MAX_SERVER_QUEUE,
  MOVEMENT_MAX_COMMANDS_PER_SECOND,
  MOVEMENT_COMMAND_STALE_GRACE_STEPS,
  MOVEMENT_SERVER_CATCHUP_BUDGET,
  movementButtonsToInputState,
  isMovementSeqAfter,
  movementSeqDistance,
  compareMovementSeq,
  sanitizeMovementCommand,
  isValidMovementCommand,
  normalizeLookYaw,
  clampLookPitch,
} from '@voxel-strike/shared';
import type { 
  BotDifficulty,
  HeroId, 
  Team, 
  PlayerInput,
  MovementCommand,
  MovementCommandPacket,
  MovementCorrectionReason,
  MovementTelemetrySnapshot,
  SelfMovementAuthority,
  MatchSnapshotMessage,
  PlayerTransformsMessage,
  PlayerVitalsMessage,
  PlayerVitalsSnapshot,
  QuantizedPlayerTransform,
  VoxelChunk,
  VoxelMapManifest,
} from '@voxel-strike/shared';
import {
  HOOKSHOT_GRAPPLE_EXTENSION_SPEED,
  createHookshotSwingState,
  simulateSharedMovement,
  stepHookshotSwing,
  type HookshotSwingState,
  type MovementTerrainAdapter,
} from '@voxel-strike/physics';
import { TickMetrics } from '../perf/tickMetrics';
import { loggers } from '../utils/logger';

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
  updateAbilityCooldowns,
  updateActiveAbilities,
} from './abilityHandlers';

interface CreateOptions {
  lobbyId?: string;
  lobbyName?: string;
  mapSeed?: number;
  botAssignments?: BotAssignment[];
}

interface JoinOptions {
  playerName?: string;
  preferredTeam?: Team;
  clientId?: string;
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

type BotStrategicRole = 'runner' | 'fighter' | 'defender' | 'support';
type PlainVec3 = { x: number; y: number; z: number };
type PlainVec2 = { x: number; z: number };
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
  aimDirection?: PlainVec3;
  velocity?: PlainVec3;
  maxDistance?: number;
  ownerTeam?: Team;
  launchSide?: -1 | 1;
  launchYaw?: number;
  serverTime: number;
  durationMs?: number;
  ammoRemaining?: number;
  reloadStartedAt?: number;
  reloadUntil?: number;
  radius?: number;
  duration?: number;
  impactTime?: number;
}

interface HookshotTrapInstance {
  id: string;
  position: PlainVec3;
  radius: number;
  duration: number;
  startTime: number;
  ownerId: string;
  ownerTeam: Team;
  lastDamageTick: Map<string, number>;
}

interface HookshotGrappleAuthorityState {
  castId: string;
  target: PlainVec3;
  attachAt: number;
  swing: HookshotSwingState | null;
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

interface ServerMovementAuthorityState {
  pendingCommands: MovementCommand[];
  lastProcessedSeq: number;
  movementEpoch: number;
  correctionReason: MovementCorrectionReason | null;
  metrics: MovementTelemetrySnapshot;
  commandWindowStartedAt: number;
  commandsInWindow: number;
}

interface BotBrain {
  nextThinkAt: number;
  nextBlackboardAt: number;
  blackboard: BotBlackboard | null;
  intent: BotIntent;
  stuckTime: number;
  lastPosition: { x: number; y: number; z: number };
  strafeDirection: -1 | 1;
  strafeUntil: number;
  reverseUntil: number;
  targetId: string;
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
}

interface BotBlackboard {
  enemies: Player[];
  allies: Player[];
  nearestEnemy: Player | null;
  weakestEnemy: Player | null;
  enemyCarrier: Player | null;
  nearestAlly: Player | null;
  alliedCarrier: Player | null;
  droppedFriendlyFlag: { x: number; y: number; z: number } | null;
  enemyFlagPosition: { x: number; y: number; z: number };
  ownBasePosition: { x: number; y: number; z: number };
  ownFlagAtBase: boolean;
  enemyFlagAtBase: boolean;
  nearbyEnemyCount: number;
  nearbyAllyCount: number;
}

interface AttackConfig {
  damage: number;
  range: number;
  cooldownMs: number;
  coneDot: number;
  radius?: number;
  damageType: string;
}

const BLAZE_ROCKET_DAMAGE = 28;
const BLAZE_ROCKET_SPLASH_RADIUS = 3.2;
const BLAZE_ROCKET_FIRE_RATE_REDUCTION = 0.7;
const BLAZE_ROCKET_FIRE_INTERVAL_MS = Math.round(250 / BLAZE_ROCKET_FIRE_RATE_REDUCTION);
const BLAZE_ROCKET_BOT_COOLDOWN_MS = BLAZE_ROCKET_FIRE_INTERVAL_MS;
const BLAZE_ROCKET_SPEED = 70;
const BLAZE_ROCKET_AIM_DISTANCE = 120;
const BLAZE_ROCKET_IMPACT_MIN_INTERVAL_MS = 300;
const BLAZE_ROCKET_IMPACT_MAX_DISTANCE = 240;
const BLAZE_ROCKET_IMPACT_DEDUP_MS = 5000;
const BLAZE_BOMB_COOLDOWN_MS = 8000;
const BLAZE_BOMB_FALL_DURATION_MS = 1500;
const BLAZE_BOMB_MAX_RANGE = 60;
const BLAZE_BOMB_MIN_RANGE = 3;
const BLAZE_BOMB_DAMAGE = 34;
const BLAZE_BOMB_SPLASH_RADIUS = 4;
const BLAZE_GEARSTORM_DAMAGE = 10;
const BLAZE_GEARSTORM_DAMAGE_INTERVAL_MS = 500;
const BLAZE_ROCKET_STAFF_SOCKET = { handHeight: 0.24, forwardOffset: 0.64, sideOffset: 0.22 };
const CHRONOS_PRIMARY_ORB_SOCKET = { handHeight: -0.06, forwardOffset: 0.56, sideOffset: 0 };

interface BlazeRocketImpactMessage {
  rocketId: string;
  position: PlainVec3;
}

interface BotSkillProfile {
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
}

type BotIntent =
  | 'selecting'
  | 'seek_enemy_flag'
  | 'guard_own_flag'
  | 'carry_flag_home'
  | 'return_friendly_flag'
  | 'defend_carrier'
  | 'chase_enemy_carrier'
  | 'fight_enemy'
  | 'retreat_or_reposition'
  | 'respawning';

// Track previous press state to detect edges for both humans and server-owned bots.
type PlayerPressState = {
  primaryFire: boolean;
  secondaryFire: boolean;
  reload: boolean;
  ability1: boolean;
  ability2: boolean;
  ultimate: boolean;
};
const playerPressState = new Map<string, PlayerPressState>();
const BLAZE_FLAMETHROWER_CONE_DOT = Math.cos(BLAZE_FLAMETHROWER_CONE_HALF_ANGLE);
const BOT_THINK_INTERVAL_MS = 200;
const BOT_AWARENESS_RANGE = 58;
const BOT_CLOSE_REVEAL_RANGE = 8;
const BOT_LOS_SAMPLE_STEP = 0.55;
const DAMAGE_HISTORY_WINDOW_MS = 10000;
const BOT_AI_BUDGET_MS = 5;
const LOS_CACHE_TTL_MS = 180;
const TRANSFORM_POSITION_SCALE = 100;
const TRANSFORM_VELOCITY_SCALE = 100;
const TRANSFORM_ANGLE_SCALE = 10000;
const PLAYER_VITALS_INTERVAL_MS = 125;
const MATCH_SNAPSHOT_INTERVAL_MS = 500;
const LOW_FREQUENCY_STATE_INTERVAL_MS = 250;
const SERVER_MOVEMENT_SUBSTEPS_PER_TICK = Math.max(1, Math.round(MOVEMENT_SUBSTEP_RATE / TICK_RATE));
const MOVEMENT_BIT_GROUNDED = 1 << 0;
const MOVEMENT_BIT_SPRINTING = 1 << 1;
const MOVEMENT_BIT_CROUCHING = 1 << 2;
const MOVEMENT_BIT_SLIDING = 1 << 3;
const MOVEMENT_BIT_WALL_RUNNING = 1 << 4;
const MOVEMENT_BIT_GRAPPLING = 1 << 5;
const MOVEMENT_BIT_JETPACKING = 1 << 6;
const MOVEMENT_BIT_GLIDING = 1 << 7;
const MOVEMENT_BIT_CHRONOS_AEGIS = 1 << 8;
const CHRONOS_AEGIS_SHIELD_HALF_WIDTH = 3.36;
const CHRONOS_AEGIS_SHIELD_HALF_HEIGHT = 1.78;
const CHRONOS_AEGIS_SHIELD_FORWARD_OFFSET = 1.85;
const CHRONOS_AEGIS_SHIELD_CENTER_Y_OFFSET = 1.02;
const CHRONOS_AEGIS_SOURCE_FRONT_MIN = 0.12;
const CHRONOS_AEGIS_TARGET_BACK_MAX = 0.35;
const BOT_SKILL_PROFILES: Record<BotDifficulty, BotSkillProfile> = {
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
  },
  hard: {
    thinkIntervalMs: 150,
    reactionMs: 110,
    turnRateRadians: 12.5,
    aimLeadSeconds: 0.24,
    aimErrorRadians: 0.038,
    aimJitterRefreshMs: [260, 520],
    aimFireToleranceScale: 1.02,
    fireChance: 0.82,
    secondaryChance: 0.68,
    fireDecisionMs: [190, 420],
    burstDurationMs: [300, 760],
    abilityCadenceMs: [850, 1700],
    ultimateCadenceMs: [1200, 2400],
    preferredRangeScale: 1.05,
    aggression: 1.2,
    retreatHealthRatio: 0.24,
  },
};
const PHANTOM_PRIMARY_COOLDOWN_MS = 250;
const PRIMARY_ATTACKS: Partial<Record<HeroId, AttackConfig>> = {
  phantom: { damage: 18, range: 30, cooldownMs: PHANTOM_PRIMARY_COOLDOWN_MS, coneDot: Math.cos(0.18), damageType: 'dire_ball' },
  hookshot: { damage: 16, range: 22, cooldownMs: 600, coneDot: Math.cos(0.2), damageType: 'chain_hooks' },
  blaze: { damage: BLAZE_ROCKET_DAMAGE, range: 36, cooldownMs: BLAZE_ROCKET_BOT_COOLDOWN_MS, coneDot: Math.cos(0.22), radius: BLAZE_ROCKET_SPLASH_RADIUS, damageType: 'rocket' },
  chronos: { damage: CHRONOS_VERDANT_PULSE_DAMAGE, range: 34, cooldownMs: CHRONOS_VERDANT_PULSE_COOLDOWN_MS, coneDot: Math.cos(0.18), damageType: 'verdant_pulse' },
};
const SECONDARY_ATTACKS: Partial<Record<HeroId, AttackConfig>> = {
  phantom: { damage: 34, range: 42, cooldownMs: PHANTOM_VOID_RAY_COOLDOWN_MS, coneDot: Math.cos(0.12), damageType: 'void_ray' },
  hookshot: { damage: 24, range: 28, cooldownMs: 3600, coneDot: Math.cos(0.14), damageType: 'drag_hook' },
  blaze: { damage: BLAZE_BOMB_DAMAGE, range: BLAZE_BOMB_MAX_RANGE, cooldownMs: BLAZE_BOMB_COOLDOWN_MS, coneDot: Math.cos(0.32), radius: BLAZE_BOMB_SPLASH_RADIUS, damageType: 'bomb' },
};
const PHANTOM_DIRE_BALL_SOCKET = { handHeight: 0.2, forwardOffset: 0.62, sideOffset: 0.22 };
const PHANTOM_VOID_RAY_SOCKET = { handHeight: -0.08, forwardOffset: 0.52, sideOffset: 0 };
const HOOKSHOT_EYE_HEIGHT = 0.6;
const HOOKSHOT_CHAIN_SOCKET = { handHeight: 0.16, forwardOffset: 0.62, sideOffset: 0.24 };
const HOOKSHOT_SPEED = 38;
const HOOKSHOT_MAX_DISTANCE = 14;
const DRAG_HOOK_SPEED = 50;
const DRAG_HOOK_MAX_DISTANCE = 24;
const HOOKSHOT_ANCHOR_WALL_DURATION = 6.25;
const HOOKSHOT_ANCHOR_WALL_MAX_DISTANCE = 24.35;
const GRAPPLE_TRAP_MAX_RANGE = 30;
const GRAPPLE_TRAP_THROW_SPEED = 30;
const GRAPPLE_TRAP_GRAVITY = 25;
const GRAPPLE_TRAP_RADIUS = 8;
const GRAPPLE_TRAP_DAMAGE = 15;
const GRAPPLE_TRAP_DAMAGE_INTERVAL_MS = 1000;
const GRAPPLE_TRAP_DURATION = 8;

export class GameRoom extends Room<GameState> {
  maxClients = DEFAULT_GAME_CONFIG.maxPlayers;

  private tickInterval: ReturnType<typeof setInterval> | null = null;
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
  private hookshotTrapIdCounter: number = 0;
  private phantomPrimaryLaunchSide: Map<string, -1 | 1> = new Map();
  private hookshotPrimaryLaunchSide: Map<string, -1 | 1> = new Map();
  private hookshotTraps: HookshotTrapInstance[] = [];
  private hookshotGrapples: Map<string, HookshotGrappleAuthorityState> = new Map();
  private pendingAreaDamage: PendingAreaDamageInstance[] = [];
  private blazeGearstorms: BlazeGearstormInstance[] = [];
  private blazeBombDropConsumedForHold: Set<string> = new Set();
  private blazeFlamethrowerActivePlayers: Set<string> = new Set();
  private voidZoneIdCounter: number = 0;
  private npcIdCounter: number = 0;
  private devBotIdCounter: number = 0;
  private spawnedNpcs: Set<string> = new Set(); // Track NPC IDs
  private authoritativePositionUntil: Map<string, number> = new Map();
  private movementAuthorities: Map<string, ServerMovementAuthorityState> = new Map();
  private flamethrowerLastDamageTick: Map<string, number> = new Map();
  private botBrains: Map<string, BotBrain> = new Map();
  private attackCooldownUntil: Map<string, number> = new Map();
  private blazeRocketImpactCooldownUntil: Map<string, number> = new Map();
  private processedBlazeRocketImpacts: Map<string, number> = new Map();
  private damageHistory: Map<string, Map<string, { damage: number; timestamp: number }>> = new Map();
  private unstuckCooldownUntil: Map<string, number> = new Map();
  private devInvulnerablePlayers: Set<string> = new Set();
  private devImmunePlayers: Set<string> = new Set();
  private devGameClockFrozen = false;
  private devBotsRooted = false;
  private mapManifest: VoxelMapManifest | null = null;
  private proceduralTerrainLookup: ReturnType<typeof createProceduralTerrainLookup> | null = null;
  private mapChunkLookup: Map<string, VoxelChunk> = new Map();
  private movementTerrain: MovementTerrainAdapter = {
    getGroundY: (position: { x: number; y: number; z: number }) => this.getProceduralTerrainLookup().getGroundY(position),
    clampPosition: (position: { x: number; y: number; z: number }) => this.getProceduralTerrainLookup().clampToPlayableMap(position),
    getBlockAtWorld: (position: { x: number; y: number; z: number }) => this.getProceduralTerrainLookup().getBlockAtWorld(position),
  };
  
  // Track clientId -> sessionId mapping for reconnection detection
  private clientIdToSessionId: Map<string, string> = new Map();
  private sessionIdToClientId: Map<string, string> = new Map();
  private metrics: TickMetrics | null = null;
  private lastVitalsBroadcastAt = 0;
  private lastMatchSnapshotBroadcastAt = 0;
  private lastLowFrequencyStateAt = 0;
  private playerVitalSignatures = new Map<string, PlayerVitalsSnapshot>();
  private knownPlayerIds = new Set<string>();
  private alivePlayers: Player[] = [];
  private alivePlayersByTeam: Record<Team, Player[]> = { red: [], blue: [] };
  private losCache = new Map<string, { result: boolean; expiresAt: number }>();
  private preferredBotHeroes: Map<string, HeroId> = new Map();

  onCreate(options: CreateOptions) {
    this.lobbyId = options.lobbyId || null;
    this.lobbyName = options.lobbyName || null;
    this.metrics = new TickMetrics(this.roomId);
    loggers.room.info('Game room created', this.roomId, 'from lobby', this.lobbyId || 'direct');

    // Initialize state
    this.setState(new GameState());
    this.state.roomId = this.roomId;
    this.state.config = this.config;
    this.state.mapSeed = typeof options.mapSeed === 'number'
      ? options.mapSeed >>> 0
      : createRandomSeed();
    this.refreshMapManifest();
    loggers.room.info('Map seed', this.state.mapSeed);
    this.resetFlags();
    this.createBotsFromAssignments(options.botAssignments || []);

    // Set up tick loop
    this.tickInterval = setInterval(() => this.tick(), TICK_INTERVAL_MS);

    // Handle messages
    this.onMessage('input', (client, input: PlayerInput) => {
      this.metrics?.time('input', () => {
        this.handleInput(client, input);
      });
    });

    this.onMessage('movementCommands', (client, packet: MovementCommandPacket) => {
      this.metrics?.time('input', () => {
        this.handleMovementCommandPacket(client, packet);
      });
    });

    this.onMessage('blazeRocketImpact', (client, data: Partial<BlazeRocketImpactMessage> | null) => {
      this.handleBlazeRocketImpact(client, data);
    });

    this.onMessage('blazeBombDrop', (client) => {
      this.handleBlazeBombDrop(client);
    });

    this.onMessage('selectHero', (client, data: { heroId: HeroId }) => {
      try {
        this.handleHeroSelect(client, data.heroId);
      } catch (error) {
        loggers.room.error('Failed to apply hero selection:', error);
        client.send('devCommandError', { message: 'Failed to switch hero' });
      }
    });

    this.onMessage('devSetHero', (client, data: { heroId: HeroId }) => {
      try {
        this.handleDevSetHero(client, data.heroId);
      } catch (error) {
        loggers.room.error('Failed to apply dev hero switch:', error);
        client.send('devCommandError', { message: 'Failed to switch hero' });
      }
    });

    this.onMessage('selectTeam', (client, data: { team: Team }) => {
      this.handleTeamSelect(client, data.team);
    });

    this.onMessage('ready', (client, data: { ready: boolean }) => {
      this.handleReady(client, data.ready);
    });

    this.onMessage('chat', (client, data: { message: string; teamOnly: boolean }) => {
      this.handleChat(client, data.message, data.teamOnly);
    });

    if (this.isDevelopmentMode()) {
      // Development-only entity helpers. Production bots are lobby participants.
      this.onMessage('spawnNpc', (client, data: { heroId: HeroId; team: Team; position?: { x: number; y: number; z: number }; name?: string }) => {
        this.handleSpawnNpc(client, data);
      });

      this.onMessage('damageNpc', (client, data: { npcId: string; damage: number }) => {
        this.handleDamageNpc(client, data);
      });

      this.onMessage('killNpc', (client, data: { npcId: string }) => {
        this.handleKillNpc(client, data);
      });

      this.onMessage('killAllNpcs', (client) => {
        this.handleKillAllNpcs(client);
      });

      this.onMessage('setDevFly', (client, data: { enabled: boolean }) => {
        this.handleSetDevFly(client, Boolean(data.enabled));
      });

      this.onMessage('setDevImmune', (client, data: { enabled: boolean }) => {
        this.handleSetDevImmune(client, Boolean(data.enabled));
      });

      this.onMessage('devFillUltimate', (client) => {
        this.handleDevFillUltimate(client);
      });

      this.onMessage('setDevTimeFrozen', (client, data: { enabled: boolean }) => {
        this.handleSetDevTimeFrozen(client, Boolean(data.enabled));
      });

      this.onMessage('setDevBotsRooted', (client, data: { enabled: boolean }) => {
        this.handleSetDevBotsRooted(client, Boolean(data.enabled));
      });

      this.onMessage('devAddBot', (client, data: { heroId: HeroId; team: Team }) => {
        this.handleDevAddBot(client, data);
      });
    }

    this.onMessage('requestPerfSnapshot', (client) => {
      if (!this.isDevelopmentMode()) return;
      client.send('perfSnapshot', this.buildPerfSnapshot());
    });
  }

  onJoin(client: Client, options: JoinOptions) {
    loggers.room.debug('Player joining', {
      sessionId: client.sessionId,
      name: options.playerName,
      clientId: options.clientId,
      players: this.state.players.size,
      clientIds: this.clientIdToSessionId.size,
    });

    // Handle reconnection: if same clientId exists, kick the old session
    if (options.clientId) {
      const existingSessionId = this.clientIdToSessionId.get(options.clientId);
      loggers.room.debug('Checking duplicate client id', options.clientId, existingSessionId);
      
      if (existingSessionId && existingSessionId !== client.sessionId) {
        loggers.room.info('Duplicate session detected, kicking old session', existingSessionId);
        
        // Find and disconnect the old client
        const oldClient = this.clients.find(c => c.sessionId === existingSessionId);
        if (oldClient) {
          // Send a message to the old client before kicking
          oldClient.send('duplicateSession', { reason: 'Connected from another tab/window' });
          oldClient.leave(4000); // Custom code for duplicate session
        }
        
        // Clean up old session data (onLeave will also be called, but let's be safe)
        const oldPlayer = this.state.players.get(existingSessionId);
        if (oldPlayer?.hasFlag) {
          this.dropFlag(oldPlayer);
        }
        this.state.players.delete(existingSessionId);
        playerPressState.delete(existingSessionId);
        this.phantomPrimaryMagazines.delete(existingSessionId);
        this.phantomPrimaryHoldStartedAt.delete(existingSessionId);
        this.chronosPrimaryHoldStartedAt.delete(existingSessionId);
        this.phantomVoidRayChargeStartedAt.delete(existingSessionId);
        this.phantomVoidRayResolvedForPress.delete(existingSessionId);
        this.phantomPrimaryLaunchSide.delete(existingSessionId);
        this.hookshotPrimaryLaunchSide.delete(existingSessionId);
        this.hookshotTraps = this.hookshotTraps.filter((trap) => trap.ownerId !== existingSessionId);
        this.hookshotGrapples.delete(existingSessionId);
        this.blazeBombDropConsumedForHold.delete(existingSessionId);
        this.blazeFlamethrowerActivePlayers.delete(existingSessionId);
        this.unstuckCooldownUntil.delete(existingSessionId);
        this.movementAuthorities.delete(existingSessionId);
        this.sessionIdToClientId.delete(existingSessionId);
        
        // Broadcast that old player left
        this.broadcast('playerLeft', { playerId: existingSessionId });
      }
      
      // Register this client's ID mapping
      this.clientIdToSessionId.set(options.clientId, client.sessionId);
      this.sessionIdToClientId.set(client.sessionId, options.clientId);
    }

    if (this.state.players.size >= this.config.maxPlayers) {
      client.send('error', { message: 'Game room is full' });
      client.leave();
      return;
    }

    // Initialize ability press state tracking
    this.initializePressState(client.sessionId);

    // Send existing players to the new client BEFORE adding the new player
    this.state.players.forEach((existingPlayer, id) => {
      client.send('playerJoined', {
        playerId: id,
        playerName: existingPlayer.name,
        team: existingPlayer.team,
        heroId: existingPlayer.heroId,
        isReady: existingPlayer.isReady,
        isBot: existingPlayer.isBot,
        botDifficulty: existingPlayer.botDifficulty,
        botProfileId: existingPlayer.botProfileId,
        position: {
          x: existingPlayer.position.x,
          y: existingPlayer.position.y,
          z: existingPlayer.position.z,
        },
      });
    });

    // Create player
    const player = new Player();
    player.id = client.sessionId;
    player.name = options.playerName || `Player${this.state.players.size + 1}`;
    player.team = this.assignTeam(options.preferredTeam);
    player.state = 'selecting';
    player.isBot = false;
    player.botDifficulty = '';
    player.botProfileId = '';

    // Set spawn position
    this.placePlayerAtSpawn(player, 'spawn');

    this.state.players.set(client.sessionId, player);
    this.knownPlayerIds.add(client.sessionId);

    // Broadcast join to all clients (including the new one)
    this.broadcast('playerJoined', {
      playerId: client.sessionId,
      playerName: player.name,
      team: player.team,
      heroId: player.heroId,
      isReady: player.isReady,
      isBot: player.isBot,
      position: {
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
      },
    });

    loggers.room.info('Player join complete', {
      sessionId: client.sessionId,
      totalPlayers: this.state.players.size,
    });

    this.sendCurrentSnapshots(client);

    // Check if we should start hero select
    this.checkPhaseTransition();
  }

  onLeave(client: Client, consented: boolean) {
    loggers.room.info('Player left', client.sessionId, 'consented', consented);

    const player = this.state.players.get(client.sessionId);
    
    // Handle flag drop if carrying
    if (player?.hasFlag) {
      this.dropFlag(player);
    }

    this.state.players.delete(client.sessionId);
    this.knownPlayerIds.delete(client.sessionId);
    this.playerVitalSignatures.delete(client.sessionId);
    playerPressState.delete(client.sessionId);
    this.phantomPrimaryMagazines.delete(client.sessionId);
    this.phantomPrimaryHoldStartedAt.delete(client.sessionId);
    this.chronosPrimaryHoldStartedAt.delete(client.sessionId);
    this.phantomVoidRayChargeStartedAt.delete(client.sessionId);
    this.phantomVoidRayResolvedForPress.delete(client.sessionId);
    this.phantomPrimaryLaunchSide.delete(client.sessionId);
    this.hookshotPrimaryLaunchSide.delete(client.sessionId);
    this.hookshotTraps = this.hookshotTraps.filter((trap) => trap.ownerId !== client.sessionId);
    this.hookshotGrapples.delete(client.sessionId);
    this.blazeBombDropConsumedForHold.delete(client.sessionId);
    this.blazeFlamethrowerActivePlayers.delete(client.sessionId);
    this.authoritativePositionUntil.delete(client.sessionId);
    this.movementAuthorities.delete(client.sessionId);
    this.attackCooldownUntil.delete(`${client.sessionId}:primary`);
    this.attackCooldownUntil.delete(`${client.sessionId}:secondary`);
    this.blazeRocketImpactCooldownUntil.delete(client.sessionId);
    this.unstuckCooldownUntil.delete(client.sessionId);
    this.deleteProcessedBlazeRocketImpactsForPlayer(client.sessionId);
    this.devInvulnerablePlayers.delete(client.sessionId);
    this.devImmunePlayers.delete(client.sessionId);
    
    // Clean up clientId mappings
    const clientId = this.sessionIdToClientId.get(client.sessionId);
    if (clientId) {
      // Only remove from clientIdToSessionId if it still points to this session
      // (it may have been updated to point to a new session if this was a duplicate kick)
      if (this.clientIdToSessionId.get(clientId) === client.sessionId) {
        this.clientIdToSessionId.delete(clientId);
      }
      this.sessionIdToClientId.delete(client.sessionId);
    }

    this.broadcast('playerLeft', {
      playerId: client.sessionId,
    });

    // Check if game should end
    this.checkPhaseTransition();
  }

  onDispose() {
    loggers.room.info('Room disposing', this.roomId);
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
    }
  }

  private tick() {
    const tickStart = this.metrics?.startTick() ?? 0;
    this.state.tick++;
    this.state.serverTime = Date.now();
    const dt = TICK_INTERVAL_MS / 1000;
    this.rebuildPlayerSpatialIndex();
    if (this.metrics) {
      this.metrics.time('updateBots', () => this.updateBots(this.state.serverTime, dt));
    } else {
      this.updateBots(this.state.serverTime, dt);
    }

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
        if (this.metrics) {
          this.metrics.time('updatePhysics', () => this.updatePhysics());
        } else {
          this.updatePhysics();
        }
        this.broadcastStateStreams({ transforms: true });
        break;
      case 'playing':
        if (this.metrics) {
          this.metrics.time('updatePlaying', () => this.updatePlaying());
        } else {
          this.updatePlaying();
        }
        break;
      case 'round_end':
        this.updateRoundEnd();
        if (this.state.serverTime - this.lastLowFrequencyStateAt >= LOW_FREQUENCY_STATE_INTERVAL_MS) {
          this.lastLowFrequencyStateAt = this.state.serverTime;
          this.broadcastStateStreams({ transforms: false });
        }
        break;
    }

    this.metrics?.endTick(tickStart);
  }

  private rebuildPlayerSpatialIndex(): void {
    this.alivePlayers = [];
    this.alivePlayersByTeam.red = [];
    this.alivePlayersByTeam.blue = [];

    this.state.players.forEach((player) => {
      if (player.state !== 'alive') return;
      this.alivePlayers.push(player);
      if (player.team === 'red' || player.team === 'blue') {
        this.alivePlayersByTeam[player.team].push(player);
      }
    });
  }

  private getEnemyPlayers(team: Team): Player[] {
    return this.alivePlayersByTeam[team === 'red' ? 'blue' : 'red'];
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
      if (player.state === 'dead' && player.respawnTime) {
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
    });

    // Update void zones (damage enemies inside)
    if (this.metrics) {
      this.metrics.time('updateVoidZones', () => this.updateVoidZones(now));
    } else {
      this.updateVoidZones(now);
    }

    if (this.metrics) {
      this.metrics.time('updateHookshotTraps', () => this.updateHookshotTraps(now));
    } else {
      this.updateHookshotTraps(now);
    }

    this.updatePendingAreaDamage(now);
    this.updateBlazeGearstorms(now);

    // Update held Blaze flamethrowers
    if (this.metrics) {
      this.metrics.time('updateBlazeFlamethrowers', () => this.updateBlazeFlamethrowers(now, dt));
    } else {
      this.updateBlazeFlamethrowers(now, dt);
    }

    // Update physics simulation (simplified)
    if (this.metrics) {
      this.metrics.time('updatePhysics', () => this.updatePhysics());
    } else {
      this.updatePhysics();
    }

    // Update CTF objective interactions after movement.
    if (this.metrics) {
      this.metrics.time('updateCTFObjectives', () => this.updateCTFObjectives(now));
    } else {
      this.updateCTFObjectives(now);
    }

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

  private buildPlayerTransform(id: string, player: Player): QuantizedPlayerTransform {
    return {
      id,
      px: this.quantize(player.position.x, TRANSFORM_POSITION_SCALE),
      py: this.quantize(player.position.y, TRANSFORM_POSITION_SCALE),
      pz: this.quantize(player.position.z, TRANSFORM_POSITION_SCALE),
      vx: this.quantize(player.velocity.x, TRANSFORM_VELOCITY_SCALE),
      vy: this.quantize(player.velocity.y, TRANSFORM_VELOCITY_SCALE),
      vz: this.quantize(player.velocity.z, TRANSFORM_VELOCITY_SCALE),
      yaw: this.quantize(player.lookYaw, TRANSFORM_ANGLE_SCALE),
      pitch: this.quantize(player.lookPitch, TRANSFORM_ANGLE_SCALE),
      movementBits: this.getMovementBits(player),
      wallRunSide: player.movement.wallRunSide === 'left' ? -1 : player.movement.wallRunSide === 'right' ? 1 : 0,
      movementEpoch: this.getMovementAuthority(id).movementEpoch,
    };
  }

  private buildPlayerVitals(id: string, player: Player): PlayerVitalsSnapshot {
    const abilities: Record<string, any> = {};
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
      id,
      name: player.name,
      team: player.team as Team,
      heroId: (player.heroId || null) as HeroId | null,
      state: player.state as PlayerVitalsSnapshot['state'],
      isReady: player.isReady,
      isBot: player.isBot,
      botDifficulty: player.botDifficulty ? this.normalizeBotDifficulty(player.botDifficulty) : undefined,
      botProfileId: player.botProfileId || undefined,
      health: player.health,
      maxHealth: player.maxHealth,
      ultimateCharge: player.ultimateCharge,
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
    };
  }

  private haveVitalsChanged(previous: PlayerVitalsSnapshot | undefined, next: PlayerVitalsSnapshot): boolean {
    if (!previous) return true;

    return (
      previous.name !== next.name ||
      previous.team !== next.team ||
      previous.heroId !== next.heroId ||
      previous.state !== next.state ||
      previous.isReady !== next.isReady ||
      previous.isBot !== next.isBot ||
      previous.botDifficulty !== next.botDifficulty ||
      previous.botProfileId !== next.botProfileId ||
      previous.health !== next.health ||
      previous.maxHealth !== next.maxHealth ||
      Math.round(previous.ultimateCharge) !== Math.round(next.ultimateCharge) ||
      previous.hasFlag !== next.hasFlag ||
      this.haveMovementVitalsChanged(previous.movement, next.movement) ||
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
        previousAbility.cooldownRemaining !== nextAbility.cooldownRemaining ||
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
      redScore: this.state.redTeam.score,
      blueScore: this.state.blueTeam.score,
      redFlag: this.getFlagSync('red'),
      blueFlag: this.getFlagSync('blue'),
      roundTimeRemaining: this.state.roundTimeRemaining,
      phaseEndTime: this.state.phaseEndTime || null,
    };
  }

  private broadcastWithMetrics(type: string, payload: unknown): void {
    this.metrics?.recordNetworkMessage(type, payload);
    this.broadcast(type, payload);
  }

  private sendWithMetrics(client: Client, type: string, payload: unknown): void {
    this.metrics?.recordNetworkMessage(type, payload);
    client.send(type, payload);
  }

  private buildMovementTelemetry(): Record<string, MovementTelemetrySnapshot> {
    const snapshots: Record<string, MovementTelemetrySnapshot> = {};
    this.movementAuthorities.forEach((authority, playerId) => {
      snapshots[playerId] = {
        ...authority.metrics,
        queueLength: authority.pendingCommands.length,
        lastAckSeq: authority.lastProcessedSeq,
      };
    });
    return snapshots;
  }

  private buildPerfSnapshot() {
    return {
      ...(this.metrics?.getDebugSnapshot() ?? { roomId: this.roomId }),
      movement: this.buildMovementTelemetry(),
    };
  }

  private sendCurrentSnapshots(client: Client): void {
    this.sendWithMetrics(client, 'matchSnapshot', this.buildMatchSnapshot());
    this.sendWithMetrics(client, 'playerVitals', {
      tick: this.state.tick,
      serverTime: this.state.serverTime,
      players: Array.from(this.state.players, ([id, player]) => this.buildPlayerVitals(id, player)),
    } satisfies PlayerVitalsMessage);

    const transformPayload = this.buildPlayerTransformsPayload();
    if (transformPayload.players.length > 0) {
      this.sendWithMetrics(client, 'playerTransforms', transformPayload);
    }
  }

  private buildPlayerTransformsPayload(): PlayerTransformsMessage {
    const players: QuantizedPlayerTransform[] = [];

    this.state.players.forEach((player, id) => {
      if (player.state !== 'alive' && player.state !== 'spawning') return;
      players.push(this.buildPlayerTransform(id, player));
    });

    return {
      tick: this.state.tick,
      serverTime: this.state.serverTime,
      players,
    };
  }

  private broadcastPlayerTransforms(): void {
    const payload = this.buildPlayerTransformsPayload();
    if (payload.players.length > 0) {
      this.broadcastWithMetrics('playerTransforms', payload);
    }
  }

  private broadcastPlayerVitals(force = false): void {
    const now = this.state.serverTime || Date.now();
    if (!force && now - this.lastVitalsBroadcastAt < PLAYER_VITALS_INTERVAL_MS) return;

    const players: PlayerVitalsSnapshot[] = [];
    const currentIds = new Set<string>();

    this.state.players.forEach((player, id) => {
      currentIds.add(id);
      this.knownPlayerIds.add(id);

      const vitals = this.buildPlayerVitals(id, player);
      if (force || this.haveVitalsChanged(this.playerVitalSignatures.get(id), vitals)) {
        this.playerVitalSignatures.set(id, vitals);
        players.push(vitals);
      }
    });

    const removedPlayerIds: string[] = [];
    this.knownPlayerIds.forEach((id) => {
      if (!currentIds.has(id)) {
        removedPlayerIds.push(id);
        this.knownPlayerIds.delete(id);
        this.playerVitalSignatures.delete(id);
      }
    });

    if (players.length === 0 && removedPlayerIds.length === 0 && !force) return;

    this.lastVitalsBroadcastAt = now;
    this.broadcastWithMetrics('playerVitals', {
      tick: this.state.tick,
      serverTime: this.state.serverTime,
      players,
      removedPlayerIds,
    } satisfies PlayerVitalsMessage);
  }

  private broadcastMatchSnapshot(force = false): void {
    const now = this.state.serverTime || Date.now();
    if (!force && now - this.lastMatchSnapshotBroadcastAt < MATCH_SNAPSHOT_INTERVAL_MS) return;

    this.lastMatchSnapshotBroadcastAt = now;
    this.broadcastWithMetrics('matchSnapshot', this.buildMatchSnapshot());
  }

  private broadcastStateStreams(options: { transforms?: boolean; vitals?: boolean; match?: boolean; forceVitals?: boolean; forceMatch?: boolean } = {}): void {
    const shouldBroadcastTransforms = options.transforms ?? (this.state.phase === 'playing' || this.state.phase === 'countdown');
    if (shouldBroadcastTransforms) {
      this.metrics?.time('broadcastPlayerTransforms', () => this.broadcastPlayerTransforms());
    }

    if (options.vitals ?? true) {
      this.metrics?.time('broadcastPlayerVitals', () => this.broadcastPlayerVitals(options.forceVitals));
    }

    if (options.match ?? true) {
      this.metrics?.time('broadcastMatchSnapshot', () => this.broadcastMatchSnapshot(options.forceMatch));
    }
  }

  private broadcastPlayerStates() {
    const playerStates: any[] = [];
    
    this.state.players.forEach((player, id) => {
      // Convert abilities MapSchema to plain object
      const abilities: Record<string, any> = {};
      player.abilities.forEach((ability, abilityId) => {
        abilities[abilityId] = {
          abilityId: ability.abilityId,
          cooldownRemaining: ability.cooldownRemaining,
          charges: ability.charges,
          isActive: ability.isActive,
          activatedAt: ability.activatedAt,
        };
      });

    playerStates.push({
        id,
        name: player.name,
        team: player.team,
        heroId: player.heroId,
        state: player.state,
        isReady: player.isReady,
        isBot: player.isBot,
        botDifficulty: player.botDifficulty,
        botProfileId: player.botProfileId,
        position: {
          x: player.position.x,
          y: player.position.y,
          z: player.position.z,
        },
        velocity: {
          x: player.velocity.x,
          y: player.velocity.y,
          z: player.velocity.z,
        },
        lookYaw: player.lookYaw,
        lookPitch: player.lookPitch,
        health: player.health,
        maxHealth: player.maxHealth,
        ultimateCharge: player.ultimateCharge,
        hasFlag: player.hasFlag,
        movement: {
          isGrounded: player.movement.isGrounded,
          isSprinting: player.movement.isSprinting,
          isCrouching: player.movement.isCrouching,
          isSliding: player.movement.isSliding,
          slideTimeRemaining: player.movement.slideTimeRemaining,
          isWallRunning: player.movement.isWallRunning,
          wallRunSide: player.movement.wallRunSide || null,
          isGrappling: player.movement.isGrappling,
          grapplePoint: null,
          isJetpacking: player.movement.isJetpacking,
          jetpackFuel: player.movement.jetpackFuel,
          isGliding: player.movement.isGliding,
        },
        abilities, // Include abilities in state sync
        stats: {
          kills: player.kills,
          deaths: player.deaths,
          assists: player.assists,
          flagCaptures: player.flagCaptures,
          flagReturns: player.flagReturns,
        },
      });
    });

    if (playerStates.length > 0) {
      this.broadcastWithMetrics('playerStates', {
        players: playerStates,
        mapSeed: this.state.mapSeed,
        redScore: this.state.redTeam.score,
        blueScore: this.state.blueTeam.score,
        redFlag: this.getFlagSync('red'),
        blueFlag: this.getFlagSync('blue'),
        roundTimeRemaining: this.state.roundTimeRemaining,
      });
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
      pendingCommands: [],
      lastProcessedSeq: 0,
      movementEpoch: 0,
      correctionReason: null,
      metrics: {
        commandsReceived: 0,
        commandsProcessed: 0,
        queueLength: 0,
        duplicateCommands: 0,
        droppedCommands: 0,
        lateCommands: 0,
        malformedCommands: 0,
        hardCorrections: 0,
        mediumCorrections: 0,
        lastAckSeq: 0,
      },
      commandWindowStartedAt: Date.now(),
      commandsInWindow: 0,
    };
  }

  private getMovementAuthority(playerId: string): ServerMovementAuthorityState {
    const existing = this.movementAuthorities.get(playerId);
    if (existing) return existing;

    const created = this.createMovementAuthorityState();
    this.movementAuthorities.set(playerId, created);
    return created;
  }

  private clearHookshotGrapple(playerId: string): void {
    this.hookshotGrapples.delete(playerId);
    const player = this.state.players.get(playerId);
    if (player) {
      player.movement.isGrappling = false;
    }
  }

  private markMovementBarrier(
    playerId: string,
    reason: MovementCorrectionReason,
    options: { preserveQueuedCommands?: boolean } = {}
  ): void {
    const authority = this.getMovementAuthority(playerId);
    const nextEpoch = authority.movementEpoch + 1;
    const preservedCommands = options.preserveQueuedCommands
      ? authority.pendingCommands
        .filter((command) => isMovementSeqAfter(command.seq, authority.lastProcessedSeq))
        .map((command) => ({
          ...command,
          movementEpoch: nextEpoch,
        }))
      : [];
    authority.movementEpoch = nextEpoch;
    const preservedOverflow = Math.max(0, preservedCommands.length - MOVEMENT_MAX_SERVER_QUEUE);
    if (preservedOverflow > 0) {
      authority.metrics.droppedCommands += preservedOverflow;
    }
    authority.pendingCommands = preservedCommands.slice(-MOVEMENT_MAX_SERVER_QUEUE);
    authority.correctionReason = reason;
    this.clearHookshotGrapple(playerId);
  }

  private sanitizeIncomingMovementCommand(
    authority: ServerMovementAuthorityState,
    command: MovementCommand
  ): MovementCommand | null {
    if (!isValidMovementCommand(command)) {
      authority.metrics.malformedCommands++;
      return null;
    }

    const sanitized = sanitizeMovementCommand(command);
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
      return null;
    }

    if (!isMovementSeqAfter(sanitized.seq, authority.lastProcessedSeq)) {
      authority.metrics.duplicateCommands++;
      return null;
    }

    if (authority.pendingCommands.some((queued) => queued.seq === sanitized.seq)) {
      authority.metrics.duplicateCommands++;
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
      return;
    }

    for (const rawCommand of packet.commands) {
      if (authority.commandsInWindow >= MOVEMENT_MAX_COMMANDS_PER_SECOND) {
        authority.metrics.droppedCommands++;
        continue;
      }

      const command = this.sanitizeIncomingMovementCommand(authority, rawCommand);
      if (!command) continue;

      authority.commandsInWindow++;
      authority.metrics.commandsReceived++;
      authority.pendingCommands.push(command);
    }

    authority.pendingCommands.sort((a, b) => compareMovementSeq(a.seq, b.seq));
    if (authority.pendingCommands.length > MOVEMENT_MAX_SERVER_QUEUE) {
      const overflow = authority.pendingCommands.length - MOVEMENT_MAX_SERVER_QUEUE;
      authority.pendingCommands.splice(0, overflow);
      authority.metrics.droppedCommands += overflow;
      this.markMovementBarrier(client.sessionId, 'epoch_mismatch');
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
      unstuck: buttons.unstuck,
      devFly: false,
    };
  }

  private getNextMovementCommand(authority: ServerMovementAuthorityState): MovementCommand | null {
    const command = authority.pendingCommands.shift();
    if (command) {
      authority.lastProcessedSeq = command.seq;
      return command;
    }
    return null;
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

    const result = stepHookshotSwing({
      position: this.vec3SchemaToPlain(player.position),
      velocity: this.vec3SchemaToPlain(player.velocity),
      swing: grapple.swing,
      input,
      lookYaw: player.lookYaw,
      lookPitch: player.lookPitch,
      isGrounded: player.movement.isGrounded,
      deltaTime: dt,
    });

    player.position.x = result.position.x;
    player.position.y = result.position.y;
    player.position.z = result.position.z;
    player.velocity.x = result.velocity.x;
    player.velocity.y = result.velocity.y;
    player.velocity.z = result.velocity.z;

    if (!result.swing) {
      this.clearHookshotGrapple(player.id);
      return;
    }

    grapple.swing = result.swing;
    player.movement.isGrappling = true;
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
  }

  private simulateAuthoritativeMovementStep(player: Player, input: PlayerInput, dt: number): void {
    const previousPosition = this.vec3SchemaToPlain(player.position);
    const heroId = player.heroId as HeroId;
    const heroStats = getHeroStats(heroId);
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
      },
      heroStats,
      input,
      lookYaw: player.lookYaw,
      deltaTime: dt,
      terrain: this.movementTerrain,
      flagCarrier: player.hasFlag,
      activeSpeedMultiplier: this.getActiveSpeedMultiplier(player),
    });

    let nextPosition = result.position;
    let nextVelocity = result.velocity;
    if (player.isBot || this.spawnedNpcs.has(player.id)) {
      if (this.isBotSpaceBlocked(previousPosition)) {
        this.placePlayerAtSpawn(player);
        return;
      }

      const resolved = this.resolveBotCollision(previousPosition, result.position);
      nextPosition = resolved.position;
      nextVelocity = {
        ...result.velocity,
        x: resolved.blockedX ? 0 : result.velocity.x,
        z: resolved.blockedZ ? 0 : result.velocity.z,
      };
    }

    this.applyMovementSimulationResult(player, {
      position: nextPosition,
      velocity: nextVelocity,
      movement: result.movement,
    });
  }

  private sendSelfMovementAuthority(player: Player, client: Client, reason: MovementCorrectionReason | null): void {
    const authority = this.getMovementAuthority(player.id);
    const payload: SelfMovementAuthority = {
      serverTick: this.state.tick,
      serverTime: this.state.serverTime,
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
      collisionRevision: 0,
    };
    this.sendWithMetrics(client, 'selfMovementAuthority', payload);
    authority.correctionReason = null;
  }

  private handleInput(client: Client, input: PlayerInput & { position?: { x: number; y: number; z: number }; velocity?: { x: number; y: number; z: number } }) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.state !== 'alive') return;

    // Store input for processing
    player.lastInput = input;

    // Update look direction immediately
    player.lookYaw = normalizeLookYaw(input.lookYaw);
    player.lookPitch = clampLookPitch(input.lookPitch);

    if (this.isDevelopmentMode() && input.devFly) {
      this.disablePlayerSkills(player);
      if (input.position && this.isFiniteVec3(input.position)) {
        player.position.x = input.position.x;
        player.position.y = input.position.y;
        player.position.z = input.position.z;
      }
      if (input.velocity && this.isFiniteVec3(input.velocity)) {
        player.velocity.x = input.velocity.x;
        player.velocity.y = input.velocity.y;
        player.velocity.z = input.velocity.z;
      }
      return;
    }

    const shouldAcceptClientPosition = Date.now() >= (this.authoritativePositionUntil.get(client.sessionId) ?? 0);
    if ((input.position || input.velocity) && shouldAcceptClientPosition) {
      const authority = this.movementAuthorities.get(client.sessionId);
      if (authority) {
        authority.pendingCommands.length = 0;
        authority.metrics.queueLength = 0;
        authority.correctionReason = null;
      }
    }

    if (input.position && shouldAcceptClientPosition && this.isFiniteVec3(input.position)) {
      const bounds = this.getMapWorldBounds();
      player.position.x = Math.max(bounds.minX, Math.min(bounds.maxX, input.position.x));
      player.position.y = Math.max(-10, Math.min(100, input.position.y));
      player.position.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, input.position.z));
    }

    if (input.velocity && shouldAcceptClientPosition && this.isFiniteVec3(input.velocity)) {
      player.velocity.x = input.velocity.x;
      player.velocity.y = input.velocity.y;
      player.velocity.z = input.velocity.z;
    }

    if (input.unstuck) {
      this.tryApplyUnstuck(player);
    }

    // Handle ability inputs (detect key press, not hold)
    this.processPlayerInput(player, input);
  }

  private tryApplyUnstuck(player: Player): void {
    const now = Date.now();
    if (now < (this.unstuckCooldownUntil.get(player.id) ?? 0)) {
      return;
    }

    this.unstuckCooldownUntil.set(player.id, now + UNSTUCK_COOLDOWN_MS);
    const terrainTeleport = findUnstuckTerrainTeleport(this.getMapManifest(), this.vec3SchemaToPlain(player.position));
    if (!terrainTeleport) return;

    player.position.x = terrainTeleport.position.x;
    player.position.y = terrainTeleport.position.y;
    player.position.z = terrainTeleport.position.z;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    player.movement.isGrounded = true;
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
    this.markMovementBarrier(player.id, 'unstuck', { preserveQueuedCommands: true });
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
    targets: Player[]
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
      target.health = Math.min(target.maxHealth, target.health + CHRONOS_LIFELINE_HEAL);
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
      this.broadcast('playerHealed', {
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
    releaseAt: number
  ): void {
    const delayMs = Math.max(0, releaseAt - Date.now());

    setTimeout(() => {
      const caster = this.state.players.get(casterId);
      if (!caster || caster.state !== 'alive') return;

      const abilityState = caster.abilities.get('chronos_lifeline_conduit');
      if (!abilityState) return;

      const targets = targetIds
        .map((targetId) => this.state.players.get(targetId))
        .filter((target): target is Player => Boolean(target));

      this.executeChronosLifelineConduit(caster, abilityState, targets);
    }, delayMs);
  }

  private nextPhantomCastId(playerId: string, abilityId: string): string {
    return `${abilityId}_${playerId}_${this.phantomCastIdCounter++}`;
  }

  private getPhantomCastOrigin(
    player: Player,
    socket: { handHeight: number; forwardOffset: number; sideOffset: number },
    launchSide: -1 | 1 = 1
  ): PlainVec3 {
    const forwardX = -Math.sin(player.lookYaw);
    const forwardZ = -Math.cos(player.lookYaw);
    const rightX = Math.cos(player.lookYaw);
    const rightZ = -Math.sin(player.lookYaw);

    return {
      x: player.position.x + forwardX * socket.forwardOffset + rightX * socket.sideOffset * launchSide,
      y: player.position.y + socket.handHeight,
      z: player.position.z + forwardZ * socket.forwardOffset + rightZ * socket.sideOffset * launchSide,
    };
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
    return {
      x: player.position.x,
      y: player.position.y + HOOKSHOT_EYE_HEIGHT,
      z: player.position.z,
    };
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
    maxDistance: number
  ): { startPosition: PlainVec3; aimDirection: PlainVec3 } {
    const lookDirection = this.getForwardVector(player.lookYaw, player.lookPitch);
    const startPosition = this.getPhantomCastOrigin(player, HOOKSHOT_CHAIN_SOCKET, launchSide);
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

  private resolveHookshotTrapTarget(player: Player): { startPosition: PlainVec3; targetPosition: PlainVec3; velocity: PlainVec3 } {
    const direction = this.getForwardVector(player.lookYaw, player.lookPitch);
    const startPosition = {
      x: player.position.x,
      y: player.position.y + 1.5,
      z: player.position.z,
    };

    let targetPosition = this.addScaled3D(startPosition, direction, GRAPPLE_TRAP_MAX_RANGE);
    const directHit = this.raycastTerrain(this.getHookshotAimOrigin(player), direction, GRAPPLE_TRAP_MAX_RANGE + 10);
    if (directHit) {
      const groundY = this.getProceduralGroundY({
        x: directHit.x,
        y: directHit.y + 5,
        z: directHit.z,
      });
      targetPosition = {
        x: directHit.x,
        y: groundY !== null ? groundY + 0.1 : directHit.y + 0.1,
        z: directHit.z,
      };
    } else {
      const sampleDistances = [15, 20, 25, GRAPPLE_TRAP_MAX_RANGE];
      for (const distance of sampleDistances) {
        const sample = this.addScaled3D(this.vec3SchemaToPlain(player.position), direction, distance);
        const groundY = this.getProceduralGroundY({
          x: sample.x,
          y: Math.max(sample.y + 50, player.position.y + 50),
          z: sample.z,
        });
        if (groundY !== null) {
          targetPosition = {
            x: sample.x,
            y: groundY + 0.1,
            z: sample.z,
          };
          break;
        }
      }
    }

    targetPosition = this.clampToPlayableMap(targetPosition);
    const velocity = this.calculateHookshotTrapVelocity(startPosition, targetPosition);
    return { startPosition, targetPosition, velocity };
  }

  private calculateHookshotTrapVelocity(startPosition: PlainVec3, targetPosition: PlainVec3): PlainVec3 {
    const dx = targetPosition.x - startPosition.x;
    const dy = targetPosition.y - startPosition.y;
    const dz = targetPosition.z - startPosition.z;
    const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
    const timeOfFlight = Math.max(0.5, horizontalDistance / 20);
    const horizontalSpeed = horizontalDistance / timeOfFlight;

    const horizontalLength = Math.sqrt(dx * dx + dz * dz);
    const horizontalVelocityX = horizontalLength > 0 ? (dx / horizontalLength) * horizontalSpeed : 0;
    const horizontalVelocityZ = horizontalLength > 0 ? (dz / horizontalLength) * horizontalSpeed : 0;
    const verticalVelocity = (dy + 0.5 * GRAPPLE_TRAP_GRAVITY * timeOfFlight * timeOfFlight) / timeOfFlight;

    return {
      x: this.clamp(horizontalVelocityX, -GRAPPLE_TRAP_THROW_SPEED, GRAPPLE_TRAP_THROW_SPEED),
      y: this.clamp(verticalVelocity, 5, GRAPPLE_TRAP_THROW_SPEED * 1.2),
      z: this.clamp(horizontalVelocityZ, -GRAPPLE_TRAP_THROW_SPEED, GRAPPLE_TRAP_THROW_SPEED),
    };
  }

  private createHookshotTrap(trap: HookshotTrapInstance): void {
    this.hookshotTraps.push(trap);
  }

  private queuePendingAreaDamage(instance: PendingAreaDamageInstance): void {
    this.pendingAreaDamage.push(instance);
  }

  private updatePendingAreaDamage(now: number): void {
    if (this.pendingAreaDamage.length === 0) return;

    this.pendingAreaDamage = this.pendingAreaDamage.filter((instance) => {
      if (now < instance.resolveAt) return true;

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

      return false;
    });
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

    this.blazeGearstorms = this.blazeGearstorms.filter((storm) => {
      if (now >= storm.endTime) return false;

      const owner = this.state.players.get(storm.ownerId);
      if (!owner) return true;

      const radiusSq = storm.radius * storm.radius;
      for (const target of this.getEnemyPlayers(storm.ownerTeam)) {
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
        this.applyDamage(target, Math.max(1, Math.round(storm.damage * falloff)), owner.id, 'airstrike');
      }

      return true;
    });
  }

  private updateHookshotTraps(now: number): void {
    if (this.hookshotTraps.length === 0) return;

    this.hookshotTraps = this.hookshotTraps.filter((trap) => {
      if ((now - trap.startTime) / 1000 >= trap.duration) return false;

      const owner = this.state.players.get(trap.ownerId) ?? null;
      const radiusSq = trap.radius * trap.radius;
      this.state.players.forEach((target) => {
        if (target.id === trap.ownerId) return;
        if (target.state !== 'alive') return;
        if (target.team === trap.ownerTeam) return;

        const dx = target.position.x - trap.position.x;
        const dz = target.position.z - trap.position.z;
        if (dx * dx + dz * dz > radiusSq) return;

        const lastDamage = trap.lastDamageTick.get(target.id) || 0;
        if (now - lastDamage < GRAPPLE_TRAP_DAMAGE_INTERVAL_MS) return;
        trap.lastDamageTick.set(target.id, now);

        const pullDirection = this.direction2DFromTo(target.position, trap.position);
        if (pullDirection) {
          target.velocity.x += pullDirection.x * 2.5;
          target.velocity.z += pullDirection.z * 2.5;
          this.authoritativePositionUntil.set(target.id, now + 350);
          this.markMovementBarrier(target.id, 'knockback');
        }

        this.applyDamage(target, GRAPPLE_TRAP_DAMAGE, owner ? trap.ownerId : null, 'grapple_trap');
      });

      return true;
    });
  }

  private nextBlazeCastId(playerId: string, abilityId: string, counter: number): string {
    return `${abilityId}_${playerId}_${counter}`;
  }

  private getBlazeAimOrigin(player: Player): PlainVec3 {
    return {
      x: player.position.x,
      y: player.position.y + HOOKSHOT_EYE_HEIGHT,
      z: player.position.z,
    };
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
  } {
    const castId = this.nextBlazeCastId(player.id, 'blaze_rocket', this.blazeRocketIdCounter++);
    const lookDirection = this.getForwardVector(player.lookYaw, player.lookPitch);
    const aimOrigin = this.getBlazeAimOrigin(player);
    const startPosition = this.getPhantomCastOrigin(player, BLAZE_ROCKET_STAFF_SOCKET);
    const terrainHit = this.raycastTerrain(aimOrigin, lookDirection, BLAZE_ROCKET_AIM_DISTANCE);
    const target = this.findTargetInAimCone(player, attack.range, attack.coneDot);
    const targetPoint = target ? this.getPlayerBodyAimPosition(target) : null;
    const terrainDistance = terrainHit ? this.distance3D(aimOrigin, terrainHit) : Infinity;
    const targetDistance = targetPoint ? this.distance3D(aimOrigin, targetPoint) : Infinity;
    const fallbackImpact = this.addScaled3D(aimOrigin, lookDirection, BLAZE_ROCKET_AIM_DISTANCE);
    const impactPosition = targetPoint && targetDistance <= terrainDistance
      ? targetPoint
      : terrainHit ?? fallbackImpact;
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
    };
  }

  private fireBlazeRocket(player: Player, attack: AttackConfig, now: number): void {
    const rocket = this.resolveBlazeRocketCast(player, attack, now);
    this.queuePendingAreaDamage({
      id: rocket.castId,
      ownerId: player.id,
      center: rocket.impactPosition,
      radius: attack.radius ?? BLAZE_ROCKET_SPLASH_RADIUS,
      damage: attack.damage,
      damageType: attack.damageType,
      resolveAt: rocket.impactTime,
    });

    this.broadcast('abilityUsed', {
      playerId: player.id,
      abilityId: 'blaze_rocket',
      castId: rocket.castId,
      position: this.vec3SchemaToPlain(player.position),
      startPosition: rocket.startPosition,
      targetPosition: rocket.impactPosition,
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
    return {
      x: player.position.x,
      y: player.position.y + HOOKSHOT_EYE_HEIGHT,
      z: player.position.z,
    };
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
    const socketPosition = this.getPhantomCastOrigin(player, CHRONOS_PRIMARY_ORB_SOCKET);
    const terrainHit = this.raycastTerrain(aimOrigin, lookDirection, CHRONOS_VERDANT_PULSE_AIM_DISTANCE);
    const target = this.findTargetInAimCone(player, attack.range, attack.coneDot);
    const targetPoint = target ? this.getPlayerBodyAimPosition(target) : null;
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
      startPosition: this.addScaled3D(
        socketPosition,
        aimDirection,
        CHRONOS_VERDANT_PULSE_SPAWN_FORWARD_OFFSET
      ),
      aimDirection,
    };
  }

  private broadcastChronosVerdantPulseCast(player: Player, attack: AttackConfig, now: number): void {
    const pulse = this.resolveChronosVerdantPulseCast(player, attack);

    this.broadcast('abilityUsed', {
      playerId: player.id,
      abilityId: 'chronos_verdant_pulse',
      castId: pulse.castId,
      position: this.vec3SchemaToPlain(player.position),
      startPosition: pulse.startPosition,
      aimDirection: pulse.aimDirection,
      velocity: {
        x: pulse.aimDirection.x * CHRONOS_VERDANT_PULSE_SPEED,
        y: pulse.aimDirection.y * CHRONOS_VERDANT_PULSE_SPEED,
        z: pulse.aimDirection.z * CHRONOS_VERDANT_PULSE_SPEED,
      },
      ownerTeam: player.team as Team,
      launchYaw: player.lookYaw,
      serverTime: now,
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
    const startPosition = this.getPhantomCastOrigin(player, BLAZE_ROCKET_STAFF_SOCKET);
    const impactTime = now + BLAZE_BOMB_FALL_DURATION_MS;

    this.queuePendingAreaDamage({
      id: castId,
      ownerId: player.id,
      center: targetPosition,
      radius: attack.radius ?? BLAZE_BOMB_SPLASH_RADIUS,
      damage: attack.damage,
      damageType: attack.damageType,
      resolveAt: impactTime,
    });

    this.broadcast('abilityUsed', {
      playerId: player.id,
      abilityId: 'blaze_bomb',
      castId,
      position: this.vec3SchemaToPlain(player.position),
      startPosition,
      targetPosition,
      aimDirection: this.getForwardVector(player.lookYaw, player.lookPitch),
      ownerTeam: player.team as Team,
      launchYaw: player.lookYaw,
      serverTime: now,
      impactTime,
      radius: attack.radius ?? BLAZE_BOMB_SPLASH_RADIUS,
    });
  }

  private broadcastPhantomCast(payload: PhantomCastPayload): void {
    this.broadcast('abilityUsed', payload);
  }

  private broadcastPhantomAttackCast(
    player: Player,
    abilityId: 'phantom_dire_ball' | 'phantom_void_ray',
    now: number
  ): void {
    const aimDirection = this.getForwardVector(player.lookYaw, player.lookPitch);
    const launchSide = abilityId === 'phantom_dire_ball'
      ? this.getNextPhantomPrimaryLaunchSide(player.id)
      : 1;
    const socket = abilityId === 'phantom_dire_ball'
      ? PHANTOM_DIRE_BALL_SOCKET
      : PHANTOM_VOID_RAY_SOCKET;
    const startPosition = this.getPhantomCastOrigin(player, socket, launchSide);
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
      startPosition: this.getPhantomCastOrigin(player, PHANTOM_VOID_RAY_SOCKET),
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
    now: number
  ): void {
    const launchSide = abilityId === 'hookshot_basic_attack'
      ? this.getNextHookshotPrimaryLaunchSide(player.id)
      : 1;
    const maxDistance = abilityId === 'hookshot_basic_attack'
      ? HOOKSHOT_MAX_DISTANCE
      : DRAG_HOOK_MAX_DISTANCE;
    const speed = abilityId === 'hookshot_basic_attack'
      ? HOOKSHOT_SPEED
      : DRAG_HOOK_SPEED;
    const launch = this.resolveHookshotLaunch(player, launchSide, maxDistance);

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
      launchSide,
      launchYaw: player.lookYaw,
      serverTime: now,
    });
  }

  private resolvePhantomBlinkDestination(player: Player, distance: number): PlainVec3 {
    const forward = this.forward2D(player.lookYaw);
    const start = this.vec3SchemaToPlain(player.position);
    const verticalOffset = player.lookPitch < -0.3 ? 2 : 0;

    for (let testDistance = distance; testDistance >= 2; testDistance -= 0.5) {
      const candidate = this.clampToPlayableMap({
        x: start.x + forward.x * testDistance,
        y: start.y + verticalOffset,
        z: start.z + forward.z * testDistance,
      });

      if (this.isBotPathBlocked(start, candidate)) continue;
      if (this.isBotSpaceBlocked(candidate)) continue;
      return candidate;
    }

    return start;
  }

  private handlePhantomSecondaryInput(player: Player, input: PlayerInput, previousSecondaryFire: boolean, now: number): void {
    const wasCharging = this.phantomVoidRayChargeStartedAt.has(player.id);

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

  private handleAbilityUse(player: Player, slot: 'ability1' | 'ability2' | 'ultimate') {
    const chronosLifelineTargets = player.heroId === 'chronos' && slot === 'ability1'
      ? this.getChronosLifelineTargets(player)
      : null;
    const hookshotGrappleTarget = player.heroId === 'hookshot' && slot === 'ability1'
      ? this.resolveHookshotGrappleTarget(player)
      : null;

    if (player.heroId === 'chronos' && slot === 'ultimate') {
      return;
    }
    if (player.heroId === 'chronos' && slot === 'ability1' && (!chronosLifelineTargets || chronosLifelineTargets.length === 0)) {
      return;
    }
    if (player.heroId === 'hookshot' && slot === 'ability1' && !hookshotGrappleTarget) {
      return;
    }

    const result = tryUseAbility(player, slot);
    if (!result.success || !result.abilityId || !result.abilityState || !result.abilityDef) {
      return;
    }

    const startedAt = this.vec3SchemaToPlain(player.position);
    const usedAt = Date.now();

    if (result.abilityId === 'chronos_lifeline_conduit' && chronosLifelineTargets) {
      const releaseAt = usedAt + CHRONOS_LIFELINE_RELEASE_DELAY_MS;
      result.abilityState.activatedAt = usedAt;

      this.broadcast('abilityUsed', {
        playerId: player.id,
        abilityId: result.abilityId,
        castId: this.nextPhantomCastId(player.id, result.abilityId),
        position: this.vec3SchemaToPlain(player.position),
        startPosition: this.getPhantomCastOrigin(player, CHRONOS_PRIMARY_ORB_SOCKET),
        targetIds: chronosLifelineTargets.map((target) => target.id),
        ownerTeam: player.team,
        serverTime: usedAt,
        releaseAt,
      });
      this.scheduleChronosLifelineConduit(
        player.id,
        chronosLifelineTargets.map((target) => target.id),
        releaseAt
      );
      return;
    } else {
      // Execute ability effect with context for void zone creation
      executeAbility(player, result.abilityId, result.abilityState, result.abilityDef, {
        createVoidZone: (position, ownerId, ownerTeam) => this.createVoidZone(position, ownerId, ownerTeam),
        resolvePhantomBlinkDestination: (caster, distance) => this.resolvePhantomBlinkDestination(caster, distance),
        markAuthoritativePosition: (playerId, durationMs) => {
          this.authoritativePositionUntil.set(playerId, Date.now() + durationMs);
          this.markMovementBarrier(playerId, 'teleport', { preserveQueuedCommands: true });
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
        const startPosition = this.getPhantomCastOrigin(player, HOOKSHOT_CHAIN_SOCKET, launchSide);
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

        this.broadcast('abilityUsed', {
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
        this.broadcast('abilityUsed', {
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

      if (result.abilityId === 'hookshot_grapple_trap') {
        const trap = this.resolveHookshotTrapTarget(player);
        const trapId = `hookshot_trap_${player.id}_${this.hookshotTrapIdCounter++}`;
        this.createHookshotTrap({
          id: trapId,
          position: trap.targetPosition,
          radius: GRAPPLE_TRAP_RADIUS,
          duration: GRAPPLE_TRAP_DURATION,
          startTime: usedAt,
          ownerId: player.id,
          ownerTeam,
          lastDamageTick: new Map(),
        });

        this.broadcast('abilityUsed', {
          playerId: player.id,
          abilityId: result.abilityId,
          castId: trapId,
          position: this.vec3SchemaToPlain(player.position),
          startPosition: trap.startPosition,
          targetPosition: trap.targetPosition,
          velocity: trap.velocity,
          direction: {
            yaw: player.lookYaw,
            pitch: player.lookPitch,
          },
          aimDirection: this.getForwardVector(player.lookYaw, player.lookPitch),
          ownerTeam,
          serverTime: usedAt,
          radius: GRAPPLE_TRAP_RADIUS,
          duration: GRAPPLE_TRAP_DURATION,
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

    // Broadcast ability use
    this.broadcast('abilityUsed', {
      playerId: player.id,
      abilityId: result.abilityId,
      castId: this.nextPhantomCastId(player.id, result.abilityId),
      position: { x: player.position.x, y: player.position.y, z: player.position.z },
      startPosition: startedAt,
      direction: { 
        yaw: player.lookYaw, 
        pitch: player.lookPitch 
      },
      aimDirection: this.getForwardVector(player.lookYaw, player.lookPitch),
      velocity: result.abilityId === 'blaze_rocketjump'
        ? this.vec3SchemaToPlain(player.velocity)
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
      this.initializePressState(bot.id);
      this.botBrains.set(bot.id, this.createBotBrain(bot, index));
    });
  }

  private createBotBrain(bot: Player, index = 0): BotBrain {
    return {
      nextThinkAt: 0,
      nextBlackboardAt: 0,
      blackboard: null,
      intent: 'selecting',
      stuckTime: 0,
      lastPosition: { x: bot.position.x, y: bot.position.y, z: bot.position.z },
      strafeDirection: index % 2 === 0 ? 1 : -1,
      strafeUntil: 0,
      reverseUntil: 0,
      targetId: '',
      aimYaw: bot.lookYaw,
      aimPitch: bot.lookPitch,
      aimJitterYaw: 0,
      aimJitterPitch: 0,
      nextAimJitterAt: 0,
      fireUntil: 0,
      nextFireDecisionAt: 0,
      nextSecondaryAt: 0,
      nextAbilityAt: 0,
      nextUltimateAt: 0,
    };
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

  private sendPhantomPrimaryState(player: Player, now: number): void {
    if (player.heroId !== 'phantom' || player.isBot) return;

    const magazine = this.getOrCreatePhantomPrimaryMagazine(player);
    const client = this.clients.find((candidate) => candidate.sessionId === player.id);
    client?.send('phantomPrimaryState', {
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

    if (!input.primaryFire) {
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
    if (input.primaryFire) {
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
    } else if (input.secondaryFire && !previous.secondaryFire) {
      this.tryResolveAttack(player, 'secondary');
    }

    if (input.ability1 && !previous.ability1) {
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

  private tryResolveAttack(player: Player, mode: 'primary' | 'secondary'): void {
    const heroId = player.heroId as HeroId;
    if (!heroId) return;

    const attack = mode === 'primary' ? PRIMARY_ATTACKS[heroId] : SECONDARY_ATTACKS[heroId];
    if (!attack) return;

    const cooldownKey = `${player.id}:${mode}`;
    const now = Date.now();
    if (now < (this.attackCooldownUntil.get(cooldownKey) || 0)) return;
    if (mode === 'primary' && !this.isPhantomPrimaryReady(player, now)) return;
    if (mode === 'primary' && !this.isChronosPrimaryReady(player, now)) return;
    if (mode === 'primary' && !this.consumePhantomPrimaryShot(player, now)) return;
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

    if (heroId === 'phantom') {
      this.broadcastPhantomAttackCast(
        player,
        mode === 'primary' ? 'phantom_dire_ball' : 'phantom_void_ray',
        now
      );
    } else if (heroId === 'hookshot') {
      this.broadcastHookshotAttackCast(
        player,
        mode === 'primary' ? 'hookshot_basic_attack' : 'hookshot_heavy_attack',
        now
      );
    } else if (heroId === 'chronos' && mode === 'primary') {
      this.broadcastChronosVerdantPulseCast(player, attack, now);
    }

    const primaryTarget = this.findTargetInAimCone(player, attack.range, attack.coneDot);
    if (!primaryTarget) return;

    if (attack.radius && attack.radius > 0) {
      this.applyAreaDamage(player, primaryTarget.position, attack.radius, attack.damage, attack.damageType);
    } else {
      this.applyDamage(primaryTarget, attack.damage, player.id, attack.damageType);
    }

    if (heroId === 'hookshot' && mode === 'secondary') {
      this.pullTargetTowardSource(primaryTarget, player, 2.5);
    }
  }

  private handleBlazeRocketImpact(client: Client, data: Partial<BlazeRocketImpactMessage> | null): void {
    void client;
    void data;
  }

  private handleBlazeBombDrop(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.state !== 'alive' || player.heroId !== 'blaze') return;

    this.blazeBombDropConsumedForHold.add(player.id);
    this.tryResolveAttack(player, 'secondary');
  }

  private cleanupProcessedBlazeRocketImpacts(now: number): void {
    if (this.processedBlazeRocketImpacts.size === 0) return;

    for (const [impactKey, expiresAt] of this.processedBlazeRocketImpacts) {
      if (expiresAt <= now) {
        this.processedBlazeRocketImpacts.delete(impactKey);
      }
    }
  }

  private deleteProcessedBlazeRocketImpactsForPlayer(playerId: string): void {
    const prefix = `${playerId}:`;
    for (const impactKey of this.processedBlazeRocketImpacts.keys()) {
      if (impactKey.startsWith(prefix)) {
        this.processedBlazeRocketImpacts.delete(impactKey);
      }
    }
  }

  private findTargetInAimCone(source: Player, range: number, minDot: number): Player | null {
    const origin = this.getPlayerEyePosition(source);
    const forward = this.getForwardVector(source.lookYaw, source.lookPitch);
    let bestTarget: Player | null = null;
    let bestDistance = range;

    for (const target of this.getEnemyPlayers(source.team as Team)) {
      if (target.id === source.id) continue;

      const targetPoint = this.getPlayerBodyAimPosition(target);
      const toTarget = {
        x: targetPoint.x - origin.x,
        y: targetPoint.y - origin.y,
        z: targetPoint.z - origin.z,
      };
      const distance = Math.sqrt(toTarget.x * toTarget.x + toTarget.y * toTarget.y + toTarget.z * toTarget.z);
      if (distance <= 0.0001 || distance > range) continue;
      if (!this.hasLineOfSight(origin, targetPoint)) continue;

      const dot = (toTarget.x * forward.x + toTarget.y * forward.y + toTarget.z * forward.z) / distance;
      if (dot < minDot) continue;

      if (distance < bestDistance) {
        bestDistance = distance;
        bestTarget = target;
      }
    }

    return bestTarget;
  }

  private applyAreaDamage(source: Player, center: { x: number; y: number; z: number }, radius: number, damage: number, damageType: string): void {
    const radiusSq = radius * radius;
    for (const target of this.getEnemyPlayers(source.team as Team)) {
      if (target.id === source.id) continue;

      const dx = target.position.x - center.x;
      const dy = target.position.y - center.y;
      const dz = target.position.z - center.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > radiusSq) continue;

      const falloff = 1 - Math.sqrt(distSq) / radius * 0.45;
      this.applyDamage(target, Math.max(1, Math.round(damage * falloff)), source.id, damageType);
    }
  }

  private isChronosAegisActive(player: Player): boolean {
    return (
      player.heroId === 'chronos' &&
      player.state === 'alive' &&
      Boolean(player.lastInput?.secondaryFire)
    );
  }

  private isDamageBlockedByChronosAegis(target: Player, source: Player): boolean {
    if (source.team === target.team) return false;

    const sourcePoint = this.getPlayerEyePosition(source);
    const targetPoint = this.getPlayerBodyAimPosition(target);
    const segment = {
      x: targetPoint.x - sourcePoint.x,
      y: targetPoint.y - sourcePoint.y,
      z: targetPoint.z - sourcePoint.z,
    };

    let blocked = false;
    this.state.players.forEach((aegisPlayer) => {
      if (blocked) return;
      if (aegisPlayer.team !== target.team) return;
      if (aegisPlayer.id === source.id) return;
      if (!this.isChronosAegisActive(aegisPlayer)) return;

      const forward = this.getForwardVector(aegisPlayer.lookYaw, 0);
      const right = {
        x: Math.cos(aegisPlayer.lookYaw),
        y: 0,
        z: -Math.sin(aegisPlayer.lookYaw),
      };
      const center = {
        x: aegisPlayer.position.x + forward.x * CHRONOS_AEGIS_SHIELD_FORWARD_OFFSET,
        y: aegisPlayer.position.y + CHRONOS_AEGIS_SHIELD_CENTER_Y_OFFSET,
        z: aegisPlayer.position.z + forward.z * CHRONOS_AEGIS_SHIELD_FORWARD_OFFSET,
      };
      const toSource = {
        x: sourcePoint.x - center.x,
        y: sourcePoint.y - center.y,
        z: sourcePoint.z - center.z,
      };
      const toTarget = {
        x: targetPoint.x - center.x,
        y: targetPoint.y - center.y,
        z: targetPoint.z - center.z,
      };
      const sourceForwardDot =
        toSource.x * forward.x + toSource.y * forward.y + toSource.z * forward.z;
      const targetForwardDot =
        toTarget.x * forward.x + toTarget.y * forward.y + toTarget.z * forward.z;

      if (sourceForwardDot < CHRONOS_AEGIS_SOURCE_FRONT_MIN) return;
      if (targetForwardDot > CHRONOS_AEGIS_TARGET_BACK_MAX) return;

      const denom =
        segment.x * forward.x + segment.y * forward.y + segment.z * forward.z;
      if (Math.abs(denom) < 0.0001) return;

      const t = (
        (center.x - sourcePoint.x) * forward.x +
        (center.y - sourcePoint.y) * forward.y +
        (center.z - sourcePoint.z) * forward.z
      ) / denom;
      if (t < 0 || t > 1) return;

      const intersectionOffset = {
        x: sourcePoint.x + segment.x * t - center.x,
        y: sourcePoint.y + segment.y * t - center.y,
        z: sourcePoint.z + segment.z * t - center.z,
      };
      const lateral =
        intersectionOffset.x * right.x + intersectionOffset.z * right.z;
      const vertical = intersectionOffset.y;
      if (
        Math.abs(lateral) <= CHRONOS_AEGIS_SHIELD_HALF_WIDTH &&
        Math.abs(vertical) <= CHRONOS_AEGIS_SHIELD_HALF_HEIGHT
      ) {
        blocked = true;
      }
    });

    return blocked;
  }

  private applyDamage(target: Player, rawDamage: number, sourceId: string | null, damageType: string): boolean {
    if (target.state !== 'alive' || rawDamage <= 0) return false;

    const source = sourceId ? this.state.players.get(sourceId) : null;
    if (source && source.id !== target.id && source.team === target.team) return false;

    const now = Date.now();
    if (target.spawnProtectionUntil && now < target.spawnProtectionUntil) return false;
    if (
      this.isDevelopmentMode()
      && (this.devInvulnerablePlayers.has(target.id) || this.devImmunePlayers.has(target.id))
    ) {
      return false;
    }

    if (source && this.isDamageBlockedByChronosAegis(target, source)) {
      return false;
    }

    const phantomShield = target.abilities.get('phantom_personal_shield');
    if (phantomShield?.isActive) {
      phantomShield.isActive = false;
      phantomShield.activatedAt = 0;
      return false;
    }

    const damage = Math.max(1, Math.round(rawDamage * this.getDamageTakenMultiplier(target)));
    target.health = Math.max(0, target.health - damage);

    if (source && source.id !== target.id) {
      source.ultimateCharge = Math.min(100, source.ultimateCharge + damage / Math.max(1, target.maxHealth) * 12);
      this.recordDamage(target.id, source.id, damage, now);
    }

    this.broadcast('playerDamaged', {
      targetId: target.id,
      damage,
      sourceId,
      damageType,
      newHealth: target.health,
      sourcePosition: source ? this.vec3SchemaToPlain(source.position) : null,
      targetPosition: this.vec3SchemaToPlain(target.position),
      sourceHeroId: source?.heroId || null,
      targetHeroId: target.heroId || null,
    });

    if (target.health <= 0) {
      this.handlePlayerDeath(target, sourceId || '');
      return true;
    }

    return false;
  }

  private recordDamage(targetId: string, sourceId: string, damage: number, timestamp: number): void {
    let history = this.damageHistory.get(targetId);
    if (!history) {
      history = new Map();
      this.damageHistory.set(targetId, history);
    }
    const existing = history.get(sourceId);
    history.set(sourceId, {
      damage: (existing?.damage || 0) + damage,
      timestamp,
    });
  }

  private getDamageTakenMultiplier(player: Player): number {
    let multiplier = 1;

    return multiplier;
  }

  private pullTargetTowardSource(target: Player, source: Player, distance: number): void {
    const dx = source.position.x - target.position.x;
    const dz = source.position.z - target.position.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len <= 0.001) return;

    target.position.x += dx / len * distance;
    target.position.z += dz / len * distance;
  }

  private scheduleChronosTimebreakShockwave(
    casterId: string,
    castDirection: PlainVec3,
    releaseAt: number
  ): void {
    const delayMs = Math.max(0, releaseAt - Date.now());
    setTimeout(() => {
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
    const maxVerticalDelta = 4.5;
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
      this.authoritativePositionUntil.set(target.id, now + CHRONOS_TIMEBREAK_SHOCKWAVE_AUTHORITY_MS);
      this.markMovementBarrier(target.id, 'knockback');

      const targetClient = this.clients.find((client) => client.sessionId === target.id);
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
    if (player.abilities.get('phantom_veil')?.isActive) multiplier *= 1.3;
    multiplier *= this.getChronosTimebreakTempoMultiplier(player);
    return multiplier;
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
    this.adjustCooldownUntil(player.id, this.blazeRocketImpactCooldownUntil, adjustmentMs, now);

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

      const playerTeam = player.team as Team;
      const enemyTeam = playerTeam === 'red' ? 'blue' : 'red';
      const ownFlag = this.getFlagByTeam(playerTeam);
      const enemyFlag = this.getFlagByTeam(enemyTeam);

      if (!ownFlag.isAtBase && !ownFlag.carrierId && this.distance2D(player.position, ownFlag.position) <= FLAG_PICKUP_RADIUS) {
        this.returnFlagToBase(playerTeam, player.id);
        player.flagReturns++;
        player.ultimateCharge = Math.min(100, player.ultimateCharge + 10);
      }

      if (!player.hasFlag && !enemyFlag.carrierId && this.distance2D(player.position, enemyFlag.position) <= FLAG_PICKUP_RADIUS) {
        enemyFlag.carrierId = player.id;
        enemyFlag.isAtBase = false;
        enemyFlag.droppedAt = 0;
        player.hasFlag = true;
        this.broadcast('flagPickup', {
          team: enemyTeam,
          playerId: player.id,
          position: this.vec3SchemaToPlain(player.position),
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
    const flag = this.getFlagByTeam(capturedTeam);
    flag.position.x = flag.basePosition.x;
    flag.position.y = flag.basePosition.y;
    flag.position.z = flag.basePosition.z;
    flag.carrierId = '';
    flag.isAtBase = true;
    flag.droppedAt = 0;

    player.hasFlag = false;
    player.flagCaptures++;
    player.ultimateCharge = Math.min(100, player.ultimateCharge + ULTIMATE_CHARGE_PER_CAPTURE);

    if (player.team === 'red') {
      this.state.redTeam.score++;
    } else {
      this.state.blueTeam.score++;
    }

    this.broadcast('flagCapture', {
      team: capturedTeam,
      playerId: player.id,
      position: this.vec3SchemaToPlain(player.position),
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
      this.broadcast('flagReturn', {
        team,
        playerId,
        position: this.vec3SchemaToPlain(flag.position),
        timestamp: Date.now(),
      });
    }
  }

  private updateBots(now: number, dt: number): void {
    const budgetStart = performance.now();
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
        brain.intent = 'selecting';
        if (changedSelectionState) {
          this.checkPhaseTransition();
        }
      }

      if (this.state.phase !== 'playing' && this.state.phase !== 'countdown') {
        return;
      }

      if (bot.state !== 'alive') {
        bot.lastInput = this.createEmptyBotInput(bot, now);
        brain.intent = bot.state === 'dead' ? 'respawning' : brain.intent;
        return;
      }

      if (this.devBotsRooted) {
        this.rootBotMovementAndSkills(bot, now);
        return;
      }

      if (!bot.hasFlag && performance.now() - budgetStart > BOT_AI_BUDGET_MS) {
        bot.lastInput = this.createEmptyBotInput(bot, now);
        return;
      }

      const botInput = this.createBotInput(bot, brain, now, dt);
      bot.lastInput = botInput;
      bot.lookYaw = botInput.lookYaw;
      bot.lookPitch = botInput.lookPitch;
      this.processPlayerInput(bot, botInput);
    });
  }

  private createBotInput(bot: Player, brain: BotBrain, now: number, dt: number): PlayerInput {
    const skill = this.getBotSkillProfile(bot);
    const shouldRefreshBlackboard = !brain.blackboard || now >= brain.nextBlackboardAt || now >= brain.nextThinkAt;
    const blackboard = shouldRefreshBlackboard ? this.getBotBlackboard(bot) : brain.blackboard!;
    if (shouldRefreshBlackboard) {
      brain.blackboard = blackboard;
      brain.nextBlackboardAt = now + Math.max(80, skill.thinkIntervalMs * 0.75);
    }
    if (now >= brain.nextThinkAt) {
      brain.intent = this.chooseBotIntent(bot, blackboard);
      brain.nextThinkAt = now + this.randomBetween(skill.thinkIntervalMs * 0.75, skill.thinkIntervalMs * 1.25);

      const moved = this.distance2D(bot.position, brain.lastPosition);
      brain.stuckTime = moved < 0.08 ? brain.stuckTime + BOT_THINK_INTERVAL_MS / 1000 : 0;
      brain.lastPosition = { x: bot.position.x, y: bot.position.y, z: bot.position.z };
      if (now >= brain.strafeUntil) {
        brain.strafeDirection = Math.random() < 0.5 ? -1 : 1;
        brain.strafeUntil = now + this.randomBetween(900, 2600);
      }
      if (brain.stuckTime > 0.7) {
        brain.strafeDirection *= -1;
        brain.reverseUntil = now + this.randomBetween(380, 760);
        brain.stuckTime = 0;
      }
    }

    const movementTarget = this.getBotMovementTarget(bot, brain.intent, blackboard);
    const combatTarget = this.chooseBotCombatTarget(bot, brain.intent, blackboard);
    brain.targetId = combatTarget?.id || '';

    const aimPoint = combatTarget
      ? this.getBotAimPoint(bot, combatTarget, skill)
      : movementTarget || this.getEnemyFlagPosition(bot.team as Team);
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
    const isLongMove = movementTarget ? this.distance2D(bot.position, movementTarget) > 9 : false;
    const recovering = now < brain.reverseUntil;
    const desiredMove = this.getBotMoveDirection(bot, brain, brain.intent, movementTarget, combatTarget, blackboard);
    const tempoMultiplier = this.getChronosTimebreakTempoMultiplier(bot);

    const input = this.createEmptyBotInput(bot, now);
    input.lookYaw = aim.yaw;
    input.lookPitch = combatTarget ? aim.pitch : 0;
    this.applyBotMovementInput(input, input.lookYaw, desiredMove, recovering, brain);
    input.sprint = isLongMove || bot.hasFlag || (brain.intent !== 'fight_enemy' && brain.intent !== 'guard_own_flag');
    input.jump = recovering || brain.stuckTime > 0.35 || (input.sprint && !combatTarget && bot.movement.isGrounded && Math.random() < 0.015);
    input.crouch = input.sprint && isLongMove && !combatTarget && Math.random() < 0.1;

    if (now >= brain.nextFireDecisionAt) {
      brain.nextFireDecisionAt = now + this.randomBetween(skill.fireDecisionMs[0], skill.fireDecisionMs[1]) / tempoMultiplier;
      if (aimReady && Math.random() < skill.fireChance) {
        brain.fireUntil = now + this.randomBetween(skill.burstDurationMs[0], skill.burstDurationMs[1]) / tempoMultiplier;
      }
    }
    input.primaryFire = aimReady && now < brain.fireUntil;

    input.secondaryFire = false;
    const secondaryAttack = SECONDARY_ATTACKS[bot.heroId as HeroId];
    if (
      shouldFight
      && combatTarget
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

    this.applyBotAbilityHeuristics(
      bot,
      input,
      brain,
      skill,
      brain.intent,
      enemyDistance,
      blackboard,
      combatTarget,
      now,
      tempoMultiplier
    );

    if (dt <= 0) {
      input.moveForward = false;
      input.moveBackward = false;
      input.moveLeft = false;
      input.moveRight = false;
    }

    return input;
  }

  private applyBotAbilityHeuristics(
    bot: Player,
    input: PlayerInput,
    brain: BotBrain,
    skill: BotSkillProfile,
    intent: BotIntent,
    enemyDistance: number,
    blackboard: BotBlackboard,
    combatTarget: Player | null,
    now: number,
    tempoMultiplier: number
  ): void {
    const heroId = bot.heroId as HeroId;
    const objectiveIntent = intent === 'seek_enemy_flag'
      || intent === 'carry_flag_home'
      || intent === 'return_friendly_flag'
      || intent === 'guard_own_flag';
    const underPressure = enemyDistance < 12 || bot.health / Math.max(1, bot.maxHealth) < 0.45;
    const safeMobilityUse = !combatTarget || enemyDistance > this.getBotPreferredCombatRange(bot) + 7;
    const pulseAbility = now >= brain.nextAbilityAt;
    const pulseUltimate = now >= brain.nextUltimateAt;

    switch (heroId) {
      case 'phantom':
        input.ability1 = pulseAbility && safeMobilityUse && (objectiveIntent || enemyDistance < 16);
        input.ability2 = pulseAbility && underPressure && enemyDistance < 20;
        input.ultimate = pulseUltimate && bot.ultimateCharge >= 100 && (bot.hasFlag || underPressure);
        break;
      case 'hookshot':
        input.ability1 = pulseAbility && safeMobilityUse && (objectiveIntent || enemyDistance < 24);
        input.ability2 = pulseAbility && enemyDistance < 28 && Boolean(combatTarget);
        input.ultimate = pulseUltimate && bot.ultimateCharge >= 100 && (objectiveIntent || enemyDistance < 12);
        break;
      case 'blaze':
        input.ability1 = Boolean(combatTarget)
          && enemyDistance < BLAZE_FLAMETHROWER_RANGE
          && this.hasClearShot(bot, combatTarget!);
        input.ability2 = pulseAbility && (underPressure || intent === 'retreat_or_reposition');
        input.ultimate = pulseUltimate && bot.ultimateCharge >= 100 && (blackboard.nearbyEnemyCount >= 2 || objectiveIntent);
        break;
      case 'chronos':
        input.ability1 = pulseAbility && this.getChronosLifelineTargets(bot).length > 0;
        input.ability2 = pulseAbility && (underPressure || blackboard.nearbyEnemyCount >= 2);
        input.ultimate = false;
        break;
    }

    if (input.ability1 || input.ability2) {
      brain.nextAbilityAt = now + this.randomBetween(skill.abilityCadenceMs[0], skill.abilityCadenceMs[1]) / tempoMultiplier;
    }
    if (input.ultimate) {
      brain.nextUltimateAt = now + this.randomBetween(skill.ultimateCadenceMs[0], skill.ultimateCadenceMs[1]) / tempoMultiplier;
    }
  }

  private getBotBlackboard(bot: Player): BotBlackboard {
    const botTeam = bot.team as Team;
    const enemyTeam = botTeam === 'red' ? 'blue' : 'red';
    const enemies: Player[] = [];
    const allies: Player[] = [];
    let nearestEnemy: Player | null = null;
    let nearestEnemyDistance = Infinity;
    let weakestEnemy: Player | null = null;
    let weakestEnemyHealthRatio = Infinity;
    let nearestAlly: Player | null = null;
    let nearestAllyDistance = Infinity;
    let enemyCarrier: Player | null = null;
    let alliedCarrier: Player | null = null;
    let nearbyEnemyCount = 0;
    let nearbyAllyCount = 0;

    for (const candidate of this.alivePlayers) {
      if (candidate.id === bot.id) continue;

      const distance = this.distance3D(bot.position, candidate.position);
      if (candidate.team === bot.team) {
        allies.push(candidate);
        if (distance < nearestAllyDistance) {
          nearestAlly = candidate;
          nearestAllyDistance = distance;
        }
        if (candidate.hasFlag) {
          alliedCarrier = candidate;
        }
        if (distance <= 16) nearbyAllyCount++;
      } else {
        if (!this.canBotPerceiveEnemy(bot, candidate, distance)) continue;
        enemies.push(candidate);
        if (distance < nearestEnemyDistance) {
          nearestEnemy = candidate;
          nearestEnemyDistance = distance;
        }
        const healthRatio = candidate.health / Math.max(1, candidate.maxHealth);
        if (healthRatio < weakestEnemyHealthRatio && distance <= BOT_AWARENESS_RANGE) {
          weakestEnemy = candidate;
          weakestEnemyHealthRatio = healthRatio;
        }
        if (candidate.hasFlag) {
          enemyCarrier = candidate;
        }
        if (distance <= 16) nearbyEnemyCount++;
      }
    }

    const ownFlag = this.getFlagByTeam(botTeam);
    const enemyFlag = this.getFlagByTeam(enemyTeam);

    return {
      enemies,
      allies,
      nearestEnemy,
      weakestEnemy,
      enemyCarrier,
      nearestAlly,
      alliedCarrier,
      droppedFriendlyFlag: !ownFlag.isAtBase && !ownFlag.carrierId ? this.vec3SchemaToPlain(ownFlag.position) : null,
      enemyFlagPosition: enemyFlag.carrierId
        ? this.vec3SchemaToPlain(this.state.players.get(enemyFlag.carrierId)?.position || enemyFlag.position)
        : this.vec3SchemaToPlain(enemyFlag.position),
      ownBasePosition: this.vec3SchemaToPlain(ownFlag.basePosition),
      ownFlagAtBase: ownFlag.isAtBase,
      enemyFlagAtBase: enemyFlag.isAtBase,
      nearbyEnemyCount,
      nearbyAllyCount,
    };
  }

  private chooseBotIntent(bot: Player, blackboard: BotBlackboard): BotIntent {
    if (bot.state === 'dead') return 'respawning';
    if (!bot.heroId || this.state.phase === 'hero_select') return 'selecting';
    if (bot.hasFlag) return 'carry_flag_home';
    const skill = this.getBotSkillProfile(bot);
    const healthRatio = bot.health / Math.max(1, bot.maxHealth);
    const nearestEnemyDistance = blackboard.nearestEnemy ? this.distance3D(bot.position, blackboard.nearestEnemy.position) : Infinity;
    if (healthRatio < skill.retreatHealthRatio && nearestEnemyDistance < 20 && !blackboard.enemyCarrier) {
      return 'retreat_or_reposition';
    }
    if (blackboard.enemyCarrier) return 'chase_enemy_carrier';
    if (blackboard.droppedFriendlyFlag) return 'return_friendly_flag';
    if (blackboard.alliedCarrier) return 'defend_carrier';
    if (blackboard.nearestEnemy && nearestEnemyDistance <= this.getBotEngageRange(bot, skill)) return 'fight_enemy';
    if (this.shouldBotGuardObjective(bot, blackboard)) return 'guard_own_flag';
    return 'seek_enemy_flag';
  }

  private getBotMovementTarget(bot: Player, intent: BotIntent, blackboard: BotBlackboard): { x: number; y: number; z: number } {
    const semanticRouteTarget = this.getSemanticBotRouteTarget(bot, intent, blackboard);
    if (semanticRouteTarget) return semanticRouteTarget;

    switch (intent) {
      case 'carry_flag_home':
      case 'retreat_or_reposition':
        return blackboard.ownBasePosition;
      case 'return_friendly_flag':
        return blackboard.droppedFriendlyFlag || blackboard.ownBasePosition;
      case 'defend_carrier':
        return this.vec3SchemaToPlain(blackboard.alliedCarrier?.position || bot.position);
      case 'chase_enemy_carrier':
        return this.vec3SchemaToPlain(blackboard.enemyCarrier?.position || bot.position);
      case 'fight_enemy':
        return this.vec3SchemaToPlain(blackboard.nearestEnemy?.position || bot.position);
      case 'guard_own_flag':
        return blackboard.ownBasePosition;
      case 'seek_enemy_flag':
      case 'selecting':
      case 'respawning':
      default:
        return blackboard.enemyFlagPosition;
    }
  }

  private getSemanticBotRouteTarget(bot: Player, intent: BotIntent, blackboard: BotBlackboard): { x: number; y: number; z: number } | null {
    const team = bot.team as Team;
    const manifest = this.getMapManifest();
    const routeGraph = manifest.gameplay?.routeGraph;
    if (!routeGraph) return null;

    if (intent === 'guard_own_flag') {
      const defensive = manifest.gameplay.bases[team]?.defensivePositions[0];
      return defensive ? { ...defensive, y: blackboard.ownBasePosition.y } : null;
    }

    if (intent !== 'seek_enemy_flag' && intent !== 'carry_flag_home' && intent !== 'retreat_or_reposition') {
      return null;
    }

    const route = routeGraph.primaryRouteNodeIds[team];
    if (!route || route.length < 2) return null;

    const orderedRoute = intent === 'seek_enemy_flag' ? route : [...route].reverse();
    const nodes = orderedRoute
      .map((nodeId) => routeGraph.nodes.find((node) => node.id === nodeId))
      .filter((node): node is (typeof routeGraph.nodes)[number] => Boolean(node));
    if (nodes.length < 2) return null;

    let nearestIndex = 0;
    let nearestDistance = Infinity;
    for (let index = 0; index < nodes.length; index++) {
      const distance = this.distance2D(bot.position, nodes[index].position);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }

    let targetIndex = Math.min(nodes.length - 1, nearestIndex + 1);
    if (nearestDistance > 12 && nearestIndex > 0) {
      targetIndex = nearestIndex;
    }
    const target = nodes[targetIndex]?.position;
    return target ? { x: target.x, y: target.y, z: target.z } : null;
  }

  private getEnemyFlagPosition(team: Team): { x: number; y: number; z: number } {
    const enemyTeam = team === 'red' ? 'blue' : 'red';
    return this.vec3SchemaToPlain(this.getFlagByTeam(enemyTeam).position);
  }

  private getBotAttackRange(bot: Player): number {
    const heroId = bot.heroId as HeroId;
    return PRIMARY_ATTACKS[heroId]?.range ?? 18;
  }

  private getBotSecondaryRange(bot: Player): number {
    const heroId = bot.heroId as HeroId;
    return SECONDARY_ATTACKS[heroId]?.range ?? 0;
  }

  private getBotSkillProfile(bot: Player): BotSkillProfile {
    const difficulty = this.normalizeBotDifficulty(bot.botDifficulty);
    return BOT_SKILL_PROFILES[difficulty];
  }

  private normalizeBotDifficulty(difficulty?: string): BotDifficulty {
    if (difficulty === 'easy' || difficulty === 'hard') {
      return difficulty;
    }
    return 'normal';
  }

  private getBotStrategicRole(bot: Player): BotStrategicRole {
    const heroId = bot.heroId as HeroId;
    if (heroId === 'phantom' || heroId === 'hookshot') return 'runner';
    const bucket = this.hashString(bot.botProfileId || bot.id || bot.name) % 10;
    if (bucket < 2) return 'defender';
    if (bucket < 5) return 'fighter';
    return 'runner';
  }

  private getBotEngageRange(bot: Player, skill: BotSkillProfile): number {
    const primaryRange = this.getBotAttackRange(bot);
    const preferredRange = this.getBotPreferredCombatRange(bot);
    return Math.min(
      BOT_AWARENESS_RANGE,
      Math.max(18, primaryRange * (1.05 + skill.aggression * 0.18), preferredRange + 8)
    );
  }

  private getBotPreferredCombatRange(bot: Player): number {
    switch (bot.heroId as HeroId) {
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

  private chooseBotCombatTarget(bot: Player, intent: BotIntent, blackboard: BotBlackboard): Player | null {
    const skill = this.getBotSkillProfile(bot);
    const primaryRange = this.getBotAttackRange(bot);
    let bestTarget: Player | null = null;
    let bestScore = -Infinity;

    for (const enemy of blackboard.enemies) {
      const distance = this.distance3D(bot.position, enemy.position);
      if (distance > BOT_AWARENESS_RANGE && !enemy.hasFlag) continue;

      const hasShot = this.hasClearShot(bot, enemy);
      const enemyHealthRatio = enemy.health / Math.max(1, enemy.maxHealth);
      let score = 0;

      if (enemy.hasFlag) score += 950;
      if (bot.hasFlag && distance < 24) score += 420;
      if (intent === 'chase_enemy_carrier' && enemy === blackboard.enemyCarrier) score += 520;
      if (intent === 'fight_enemy' && enemy === blackboard.nearestEnemy) score += 130;
      if (enemy === blackboard.weakestEnemy) score += 90;
      if (hasShot) score += 120;
      if (this.isProtectedSpawnTarget(enemy, this.state.serverTime)) score -= 260;

      score += (1 - enemyHealthRatio) * 180;
      score += Math.max(0, 28 - distance) * 4.5;
      score -= Math.max(0, distance - primaryRange) * (enemy.hasFlag ? 2 : 6);
      score *= skill.aggression;

      if (score > bestScore) {
        bestScore = score;
        bestTarget = enemy;
      }
    }

    return bestScore > 20 ? bestTarget : null;
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

  private shouldBotGuardObjective(bot: Player, blackboard: BotBlackboard): boolean {
    if (!blackboard.ownFlagAtBase || blackboard.alliedCarrier) return false;

    const enemyNearBase = blackboard.enemies.some((enemy) => (
      this.distance2D(enemy.position, blackboard.ownBasePosition) < 22
    ));
    if (enemyNearBase) return true;

    const role = this.getBotStrategicRole(bot);
    if (role !== 'defender') return false;

    const ownBaseDistance = this.distance2D(bot.position, blackboard.ownBasePosition);
    const enemyFlagDistance = this.distance2D(bot.position, blackboard.enemyFlagPosition);
    return ownBaseDistance > 7 && enemyFlagDistance > 18 && blackboard.enemyFlagAtBase;
  }

  private getBotAimPoint(bot: Player, target: Player, skill: BotSkillProfile): PlainVec3 {
    const targetDistance = this.distance3D(bot.position, target.position);
    const reactionLag = skill.reactionMs / 1000;
    const leadSeconds = Math.max(-0.22, Math.min(0.42, skill.aimLeadSeconds + targetDistance / 160 - reactionLag * 0.45));

    return {
      x: target.position.x + target.velocity.x * leadSeconds,
      y: target.position.y + 0.9 + target.velocity.y * leadSeconds,
      z: target.position.z + target.velocity.z * leadSeconds,
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
    const targetPoint = this.getPlayerBodyAimPosition(target);
    const toTarget = {
      x: targetPoint.x - origin.x,
      y: targetPoint.y - origin.y,
      z: targetPoint.z - origin.z,
    };
    const distance = Math.sqrt(toTarget.x * toTarget.x + toTarget.y * toTarget.y + toTarget.z * toTarget.z);
    if (distance <= 0.001 || distance > attack.range) return false;

    const forward = this.getForwardVector(yaw, pitch);
    const dot = this.clamp(
      (toTarget.x * forward.x + toTarget.y * forward.y + toTarget.z * forward.z) / distance,
      -1,
      1
    );
    const aimAngle = Math.acos(dot);
    const allowedAngle = Math.acos(this.clamp(attack.coneDot, -1, 1)) * skill.aimFireToleranceScale;
    return aimAngle <= allowedAngle;
  }

  private getBotMoveDirection(
    bot: Player,
    brain: BotBrain,
    intent: BotIntent,
    movementTarget: PlainVec3,
    combatTarget: Player | null,
    blackboard: BotBlackboard
  ): PlainVec2 | null {
    const skill = this.getBotSkillProfile(bot);
    const objectiveDir = this.direction2DFromTo(bot.position, movementTarget);
    let move: PlainVec2 = objectiveDir ? { ...objectiveDir } : { x: 0, z: 0 };

    if (intent === 'guard_own_flag' && !combatTarget && this.distance2D(bot.position, movementTarget) < 5) {
      const orbit = this.direction2DFromTo(movementTarget, bot.position) || this.forward2D(bot.lookYaw);
      move = { x: -orbit.z * brain.strafeDirection, z: orbit.x * brain.strafeDirection };
    }

    if (combatTarget) {
      const toEnemy = this.direction2DFromTo(bot.position, combatTarget.position) || this.forward2D(bot.lookYaw);
      const awayFromEnemy = { x: -toEnemy.x, z: -toEnemy.z };
      const strafe = { x: -toEnemy.z * brain.strafeDirection, z: toEnemy.x * brain.strafeDirection };
      const distance = this.distance2D(bot.position, combatTarget.position);
      const preferredRange = this.getBotPreferredCombatRange(bot) * skill.preferredRangeScale;
      let rangeMove: PlainVec2 = { x: 0, z: 0 };

      if (distance > preferredRange + 3) {
        rangeMove = toEnemy;
      } else if (distance < Math.max(2.2, preferredRange - 2)) {
        rangeMove = awayFromEnemy;
      }

      if (intent === 'carry_flag_home' || intent === 'return_friendly_flag') {
        move = this.mix2D(move, 1.35, rangeMove, 0.45);
        move = this.mix2D(move, 1, strafe, 0.25);
      } else if (intent === 'retreat_or_reposition') {
        move = this.mix2D(move, 1.2, awayFromEnemy, 0.65);
        move = this.mix2D(move, 1, strafe, 0.25);
      } else if (intent === 'defend_carrier') {
        move = this.mix2D(move, 0.95, rangeMove, 0.55);
        move = this.mix2D(move, 1, strafe, 0.35);
      } else if (intent === 'chase_enemy_carrier') {
        move = this.mix2D(toEnemy, 1.25, strafe, 0.18);
      } else {
        move = this.mix2D(rangeMove, 1, strafe, distance < preferredRange + 6 ? 0.7 : 0.28);
      }
    }

    for (const ally of blackboard.allies) {
      const distance = this.distance2D(bot.position, ally.position);
      if (distance <= 0.001 || distance > 2.4) continue;
      const away = this.direction2DFromTo(ally.position, bot.position);
      if (away) {
        move = this.mix2D(move, 1, away, (2.4 - distance) * 0.35);
      }
    }

    for (const enemy of blackboard.enemies) {
      const distance = this.distance2D(bot.position, enemy.position);
      if (distance <= 0.001 || distance > 1.6) continue;
      const away = this.direction2DFromTo(enemy.position, bot.position);
      if (away) {
        move = this.mix2D(move, 1, away, (1.6 - distance) * 0.45);
      }
    }

    return this.normalize2D(move);
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
    const dx = targetPosition.x - source.position.x;
    const dy = targetPosition.y - (source.position.y + 1.2);
    const dz = targetPosition.z - source.position.z;
    const horizontal = Math.sqrt(dx * dx + dz * dz);
    return {
      yaw: Math.atan2(-dx, -dz),
      pitch: this.clamp(Math.atan2(dy, horizontal), -0.8, 0.8),
    };
  }

  private getYawPitchToward(source: Player, target: Player | { x: number; y: number; z: number }): { yaw: number; pitch: number } {
    const targetPosition = 'position' in target ? target.position : target;
    return this.getYawPitchTowardPosition(source, {
      x: targetPosition.x,
      y: targetPosition.y + ('position' in target ? 0.9 : 0),
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
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (isCollisionBlock(this.getBlockAtWorld({
        x: start.x + dx * t,
        y: start.y + dy * t,
        z: start.z + dz * t,
      }))) {
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
    return {
      x: player.position.x,
      y: player.position.y + 1.2,
      z: player.position.z,
    };
  }

  private getPlayerBodyAimPosition(player: Player): PlainVec3 {
    return {
      x: player.position.x,
      y: player.position.y + 0.9,
      z: player.position.z,
    };
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

  private createEmptyBotInput(bot: Player, now: number): PlayerInput {
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
      lookYaw: bot.lookYaw,
      lookPitch: bot.lookPitch,
      timestamp: now,
    };
  }

  private rootBotMovementAndSkills(bot: Player, now: number): void {
    bot.lastInput = this.createEmptyBotInput(bot, now);
    bot.velocity.x = 0;
    bot.velocity.y = 0;
    bot.velocity.z = 0;
    bot.movement.isSprinting = false;
    bot.movement.isCrouching = false;
    bot.movement.isWallRunning = false;
    bot.movement.wallRunSide = '';
    this.disablePlayerSkills(bot);

    let pressState = playerPressState.get(bot.id);
    if (!pressState) {
      this.initializePressState(bot.id);
      pressState = playerPressState.get(bot.id)!;
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

  private getFlagSync(team: Team) {
    const flag = this.getFlagByTeam(team);
    return {
      position: this.vec3SchemaToPlain(flag.position),
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

    loggers.room.debug('hero selected', player.name, heroDef.name);
    return true;
  }

  private selectRandomBotHero(): HeroId {
    return ALL_HERO_IDS[Math.floor(Math.random() * ALL_HERO_IDS.length)] ?? 'phantom';
  }

  private isDevelopmentMode(): boolean {
    return process.env.NODE_ENV !== 'production';
  }

  private handleSetDevFly(client: Client, enabled: boolean): void {
    if (!this.isDevelopmentMode()) return;

    if (enabled) {
      this.devInvulnerablePlayers.add(client.sessionId);
    } else {
      this.devInvulnerablePlayers.delete(client.sessionId);
    }
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

  private handleSetDevTimeFrozen(client: Client, enabled: boolean): void {
    if (!this.isDevelopmentMode()) {
      client.send('devCommandError', { message: 'Developer commands are disabled' });
      return;
    }

    const now = Date.now();
    if (enabled) {
      this.state.roundTimeRemaining = this.getRoundTimeRemaining(now);
      this.devGameClockFrozen = true;
    } else {
      this.devGameClockFrozen = false;
      if (this.state.roundStartTime) {
        const elapsedSeconds = this.config.roundTimeSeconds - this.state.roundTimeRemaining;
        this.state.roundStartTime = now - elapsedSeconds * 1000;
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
    this.preferredBotHeroes.set(bot.id, heroId);
    this.initializePressState(bot.id);
    this.botBrains.set(bot.id, this.createBotBrain(bot, botIndex));
    if (this.devBotsRooted) {
      this.rootBotMovementAndSkills(bot, now);
    }

    this.broadcast('playerJoined', {
      playerId: bot.id,
      playerName: bot.name,
      team: bot.team,
      heroId: bot.heroId,
      isReady: bot.isReady,
      isBot: bot.isBot,
      botDifficulty: bot.botDifficulty,
      botProfileId: bot.botProfileId,
      position: {
        x: bot.position.x,
        y: bot.position.y,
        z: bot.position.z,
      },
    });

    client.send('devBotAdded', {
      playerId: bot.id,
      name: bot.name,
      heroId,
      team,
    });

    loggers.room.debug('development bot added', bot.name, heroId, team);
    this.broadcastStateStreams({ transforms: true, forceVitals: true, forceMatch: true });
    this.checkPhaseTransition();
  }

  private getRoundTimeRemaining(now: number): number {
    if (!this.state.roundStartTime) return this.state.roundTimeRemaining;

    const elapsed = Math.max(0, (now - this.state.roundStartTime) / 1000);
    return Math.max(0, this.config.roundTimeSeconds - elapsed);
  }

  private refreshMapManifest(): void {
    this.mapManifest = generateProceduralVoxelMap(this.state.mapSeed);
    this.proceduralTerrainLookup = createProceduralTerrainLookup(this.mapManifest);
    this.mapChunkLookup.clear();
    for (const chunk of this.mapManifest.chunks) {
      this.mapChunkLookup.set(this.getChunkKey(chunk.coord.x, chunk.coord.y, chunk.coord.z), chunk);
    }
  }

  private getMapManifest(): VoxelMapManifest {
    if (!this.mapManifest || this.mapManifest.seed !== this.state.mapSeed) {
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

  private isBotSpaceBlocked(position: { x: number; y: number; z: number }): boolean {
    const manifest = this.getMapManifest();
    if (!isInsideBoundaryPolygon(position.x, position.z, manifest.boundary)) {
      return true;
    }

    const radius = 0.45;
    const diagonal = radius * 0.707;
    const offsets = [
      { x: 0, z: 0 },
      { x: radius, z: 0 },
      { x: -radius, z: 0 },
      { x: 0, z: radius },
      { x: 0, z: -radius },
      { x: diagonal, z: diagonal },
      { x: diagonal, z: -diagonal },
      { x: -diagonal, z: diagonal },
      { x: -diagonal, z: -diagonal },
    ];
    const ySamples = [position.y - 0.35, position.y + 0.15, position.y + 0.65];

    for (const y of ySamples) {
      for (const offset of offsets) {
        if (isCollisionBlock(this.getBlockAtWorld({
          x: position.x + offset.x,
          y,
          z: position.z + offset.z,
        }))) {
          return true;
        }
      }
    }

    return false;
  }

  private isBotPathBlocked(
    previous: { x: number; y: number; z: number },
    next: { x: number; y: number; z: number }
  ): boolean {
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.max(1, Math.ceil(distance / 0.25));

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.isBotSpaceBlocked({
        x: previous.x + dx * t,
        y: previous.y + (next.y - previous.y) * t,
        z: previous.z + dz * t,
      })) {
        return true;
      }
    }

    return false;
  }

  private resolveBotCollision(
    previous: { x: number; y: number; z: number },
    desired: { x: number; y: number; z: number }
  ): { position: { x: number; y: number; z: number }; blockedX: boolean; blockedZ: boolean } {
    const manifest = this.getMapManifest();
    const constrained = constrainToBoundaryPolygon(previous.x, previous.z, desired.x, desired.z, manifest.boundary);
    const next = { ...desired, x: constrained.x, z: constrained.z };

    if (!this.isBotPathBlocked(previous, next)) {
      return { position: next, blockedX: false, blockedZ: false };
    }

    const xOnly = { ...next, z: previous.z };
    if (!this.isBotPathBlocked(previous, xOnly)) {
      return { position: xOnly, blockedX: false, blockedZ: true };
    }

    const zOnly = { ...next, x: previous.x };
    if (!this.isBotPathBlocked(previous, zOnly)) {
      return { position: zOnly, blockedX: true, blockedZ: false };
    }

    return { position: { ...previous, y: next.y }, blockedX: true, blockedZ: true };
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
    player.movement.isGrappling = false;
    player.movement.isJetpacking = false;
    player.movement.isGliding = false;
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
  }

  private handleTeamSelect(client: Client, team: Team) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Check team balance
    const teamCount = this.getTeamCountExcluding(team, client.sessionId);
    const otherTeamCount = this.getTeamCountExcluding(team === 'red' ? 'blue' : 'red', client.sessionId);

    if (teamCount >= this.config.teamSize || teamCount > otherTeamCount) {
      // Team is full
      return;
    }

    player.team = team;
    
    this.placePlayerAtSpawn(player, 'respawn');
  }

  private handleReady(client: Client, ready: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    loggers.room.debug('player ready changed', player.name, ready, player.heroId);
    player.isReady = ready;
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
          this.clients.find(c => c.sessionId === sessionId)?.send('chat', {
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
    const playerCount = this.state.players.size;
    loggers.room.debug('checkPhaseTransition', { phase: this.state.phase, players: playerCount });

    switch (this.state.phase) {
      case 'waiting':
        // Need at least 2 players to start (or 1 for testing)
        if (playerCount >= 1) {
          this.startHeroSelect();
        }
        break;

      case 'hero_select':
        // Check if all players are ready
        let allReady = true;
        let readyCount = 0;
        this.state.players.forEach(p => {
          loggers.room.debug('ready check player', p.name, p.heroId, p.isReady);
          if (!p.heroId || !p.isReady) {
            allReady = false;
          } else {
            readyCount++;
          }
        });

        loggers.room.debug('ready check summary', { allReady, readyCount, playerCount });

        if (allReady && playerCount >= 1) {
          loggers.room.info('all players ready, starting countdown');
          this.startCountdown();
        }

        // Check timeout
        if (this.state.phaseEndTime && Date.now() >= this.state.phaseEndTime) {
          this.state.players.forEach(p => {
            if (!p.heroId) {
              this.setPlayerHero(p, p.isBot ? this.selectRandomBotHero() : 'phantom');
            }
          });
          this.startCountdown();
        }
        break;
    }
  }

  private startHeroSelect() {
    this.state.phase = 'hero_select';
    this.state.phaseEndTime = Date.now() + this.config.heroSelectTimeSeconds * 1000;

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

    this.broadcast('phaseChange', {
      phase: 'hero_select',
      endTime: this.state.phaseEndTime,
      mapSeed: this.state.mapSeed,
    });
    this.broadcastStateStreams({ transforms: false, forceVitals: true, forceMatch: true });
  }

  private startCountdown() {
    this.state.phase = 'countdown';
    this.state.phaseEndTime = Date.now() + this.config.countdownSeconds * 1000;

    // Set all players to spawning
    this.state.players.forEach(player => {
      player.state = 'spawning';
      this.placePlayerAtSpawn(player);
    });

    this.broadcast('phaseChange', {
      phase: 'countdown',
      endTime: this.state.phaseEndTime,
      mapSeed: this.state.mapSeed,
    });
    this.broadcastStateStreams({ transforms: true, forceVitals: true, forceMatch: true });
  }

  private startPlaying() {
    this.state.phase = 'playing';
    this.state.roundStartTime = Date.now();
    this.state.roundTimeRemaining = this.config.roundTimeSeconds;
    this.state.phaseEndTime = 0;

    // Set all players to alive
    this.state.players.forEach(player => {
      player.state = 'alive';
      player.health = player.maxHealth;
      player.spawnProtectionUntil = Date.now() + this.config.spawnProtectionSeconds * 1000;
      this.authoritativePositionUntil.set(player.id, Date.now() + 1200);
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.velocity.z = 0;
      if (player.heroId === 'blaze') {
        player.movement.jetpackFuel = BLAZE_FLAMETHROWER_MAX_FUEL;
        player.movement.isJetpacking = false;
      }
      if (player.heroId === 'phantom') {
        this.resetPhantomPrimaryMagazine(player.id);
      }
      
      // Reset ability cooldowns
      resetAbilityCooldowns(player);
    });

    // Reset flags
    this.resetFlags();

    this.broadcast('phaseChange', {
      phase: 'playing',
      endTime: Date.now() + this.config.roundTimeSeconds * 1000,
      mapSeed: this.state.mapSeed,
    });
    this.broadcastStateStreams({ transforms: true, forceVitals: true, forceMatch: true });
  }

  private endRound() {
    this.state.phase = 'round_end';
    this.state.phaseEndTime = Date.now() + 5000; // 5 second intermission

    const winningTeam = this.state.redTeam.score > this.state.blueTeam.score ? 'red' : 
                        this.state.blueTeam.score > this.state.redTeam.score ? 'blue' : null;

    this.broadcast('roundEnd', {
      winningTeam,
      redScore: this.state.redTeam.score,
      blueScore: this.state.blueTeam.score,
      nextPhase: this.state.redTeam.score >= this.config.scoreToWin || 
                 this.state.blueTeam.score >= this.config.scoreToWin ? 'game_end' : 'hero_select',
    });
  }

  private endGame() {
    this.state.phase = 'game_end';

    const winningTeam = this.state.redTeam.score > this.state.blueTeam.score ? 'red' : 'blue';

    this.broadcast('gameEnd', {
      winningTeam,
      finalScore: {
        red: this.state.redTeam.score,
        blue: this.state.blueTeam.score,
      },
    });

    // Reset room after delay
    setTimeout(() => {
      this.state.phase = 'waiting';
      this.state.mapSeed = createRandomSeed();
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
    // Remove expired void zones
    this.voidZones = this.voidZones.filter(zone => {
      const elapsed = (now - zone.startTime) / 1000;
      if (elapsed >= zone.duration) {
        // Broadcast zone expired
        this.broadcast('voidZoneExpired', { id: zone.id });
        return false;
      }
      return true;
    });

    // Apply damage to players in active void zones
    for (const zone of this.voidZones) {
      const targets = this.alivePlayersByTeam[zone.ownerTeam === 'red' ? 'blue' : 'red'];
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
          this.applyDamage(player, zone.damage, zone.ownerId, 'void_zone');
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
    const right = {
      x: Math.cos(player.lookYaw),
      y: 0,
      z: -Math.sin(player.lookYaw),
    };
    const horizontalForward = {
      x: -Math.sin(player.lookYaw),
      z: -Math.cos(player.lookYaw),
    };

    return {
      origin: {
        x:
          player.position.x +
          horizontalForward.x * BLAZE_FLAMETHROWER_SOCKET_FORWARD_OFFSET +
          right.x * BLAZE_FLAMETHROWER_SOCKET_SIDE_OFFSET,
        y: player.position.y + BLAZE_FLAMETHROWER_SOCKET_HAND_HEIGHT,
        z:
          player.position.z +
          horizontalForward.z * BLAZE_FLAMETHROWER_SOCKET_FORWARD_OFFSET +
          right.z * BLAZE_FLAMETHROWER_SOCKET_SIDE_OFFSET,
      },
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
    this.broadcast('abilityUsed', {
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

  private updateBlazeFlamethrowers(now: number, dt: number) {
    const activeBlazePlayersThisTick = new Set<string>();

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

    for (const playerId of Array.from(this.blazeFlamethrowerActivePlayers)) {
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

    const rangeSq = BLAZE_FLAMETHROWER_RANGE * BLAZE_FLAMETHROWER_RANGE;

    for (const target of this.getEnemyPlayers(source.team as Team)) {
      if (target.id === source.id) continue;
      if (target.spawnProtectionUntil && now < target.spawnProtectionUntil) continue;

      const toTarget = {
        x: target.position.x - origin.x,
        y: target.position.y + 0.9 - origin.y,
        z: target.position.z - origin.z,
      };
      const distSq = toTarget.x * toTarget.x + toTarget.y * toTarget.y + toTarget.z * toTarget.z;
      if (distSq > rangeSq || distSq <= 0.0001) continue;
      if (!this.hasLineOfSight(origin, this.getPlayerBodyAimPosition(target))) continue;

      const distance = Math.sqrt(distSq);
      const dot = (
        toTarget.x * forward.x +
        toTarget.y * forward.y +
        toTarget.z * forward.z
      ) / distance;
      if (dot < BLAZE_FLAMETHROWER_CONE_DOT) continue;

      const tickKey = `${source.id}:${target.id}`;
      const lastDamage = this.flamethrowerLastDamageTick.get(tickKey) || 0;
      if (now - lastDamage < BLAZE_FLAMETHROWER_DAMAGE_INTERVAL / tempoMultiplier) continue;

      const falloff = 1 - (distance / BLAZE_FLAMETHROWER_RANGE) * 0.35;
      const damage = Math.max(1, Math.round(BLAZE_FLAMETHROWER_DAMAGE * falloff));
      this.flamethrowerLastDamageTick.set(tickKey, now);
      this.applyDamage(target, damage, source.id, 'flamethrower');
    }
  }

  private handlePlayerDeath(player: Player, killerId: string) {
    if (player.state === 'dead') return;

    const killer = this.state.players.get(killerId);
    
    const deathAt = Date.now();

    player.state = 'dead';
    player.health = 0;
    player.deaths++;
    player.respawnTime = deathAt + this.config.respawnTimeSeconds * 1000;
    player.movement.isJetpacking = false;
    this.broadcastBlazeFlamethrowerState(player, false, deathAt);
    this.blazeBombDropConsumedForHold.delete(player.id);
    this.clearHookshotGrapple(player.id);
    
    // Drop flag if carrying
    if (player.hasFlag) {
      this.dropFlag(player);
    }

    if (killer) {
      killer.kills++;
      killer.ultimateCharge = Math.min(100, killer.ultimateCharge + ULTIMATE_CHARGE_PER_KILL);
    }

    const now = Date.now();
    const assistIds: string[] = [];
    const history = this.damageHistory.get(player.id);
    if (history) {
      history.forEach((entry, sourceId) => {
        if (sourceId === killerId) return;
        if (now - entry.timestamp > DAMAGE_HISTORY_WINDOW_MS) return;
        const assister = this.state.players.get(sourceId);
        if (!assister || assister.team === player.team) return;
        assister.assists++;
        assister.ultimateCharge = Math.min(100, assister.ultimateCharge + 8);
        assistIds.push(sourceId);
      });
      this.damageHistory.delete(player.id);
    }

    this.broadcast('playerKilled', {
      victimId: player.id,
      killerId,
      assistIds,
      position: { x: player.position.x, y: player.position.y, z: player.position.z },
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
    this.broadcast('voidZoneCreated', {
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

    this.broadcast('flagDrop', {
      team: player.team === 'red' ? 'blue' : 'red',
      playerId: player.id,
      position: { x: flag.position.x, y: flag.position.y, z: flag.position.z },
    });
  }

  private respawnPlayer(player: Player) {
    player.state = 'alive';
    player.health = player.maxHealth;
    player.respawnTime = 0;
    player.spawnProtectionUntil = Date.now() + this.config.spawnProtectionSeconds * 1000;

    this.placePlayerAtSpawn(player);
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    if (player.heroId === 'blaze') {
      player.movement.jetpackFuel = BLAZE_FLAMETHROWER_MAX_FUEL;
      player.movement.isJetpacking = false;
    }
    if (player.heroId === 'phantom') {
      this.resetPhantomPrimaryMagazine(player.id);
    }

    // Reset ability cooldowns on respawn
    resetAbilityCooldowns(player);
  }

  private updatePhysics() {
    const clientsById = new Map(this.clients.map((client) => [client.sessionId, client]));
    const tickTime = this.state.serverTime || Date.now();

    this.state.players.forEach(player => {
      if (player.state !== 'alive') return;

      const lastInput = player.lastInput;
      if (lastInput && this.isDevelopmentMode() && lastInput.devFly) return;
      if (this.devBotsRooted && player.isBot) {
        this.rootBotMovementAndSkills(player, Date.now());
        return;
      }

      if (player.isBot || this.spawnedNpcs.has(player.id)) {
        if (!lastInput) return;
        for (let step = 0; step < SERVER_MOVEMENT_SUBSTEPS_PER_TICK; step++) {
          this.simulateAuthoritativeMovementStep(player, lastInput, MOVEMENT_SUBSTEP_SECONDS);
        }
        if (player.position.y < -10) {
          this.placePlayerAtSpawn(player, 'respawn');
        }
        return;
      }

      const authority = this.getMovementAuthority(player.id);
      let processedThisTick = 0;
      const queuedCommandCount = authority.pendingCommands.length;
      if (queuedCommandCount === 0) {
        if (lastInput) {
          this.simulateAuthoritativeMovementStep(player, lastInput, TICK_INTERVAL_MS / 1000);
        }

        if (player.position.y < -10) {
          this.placePlayerAtSpawn(player, 'respawn');
        }

        const client = clientsById.get(player.id);
        if (client && authority.correctionReason) {
          this.sendSelfMovementAuthority(player, client, authority.correctionReason);
        }
        return;
      }

      const substepBudget = queuedCommandCount
        ? Math.min(
          queuedCommandCount,
          SERVER_MOVEMENT_SUBSTEPS_PER_TICK + Math.max(
            0,
            Math.min(MOVEMENT_SERVER_CATCHUP_BUDGET, queuedCommandCount - SERVER_MOVEMENT_SUBSTEPS_PER_TICK)
          )
        )
        : 0;

      for (let step = 0; step < substepBudget; step++) {
        const stepNow = tickTime + step * MOVEMENT_SUBSTEP_SECONDS * 1000;
        const epochBeforeStep = authority.movementEpoch;
        const command = this.getNextMovementCommand(authority);
        if (!command) break;
        const input = this.movementCommandToInput(command, player);
        player.lastInput = input;
        player.lookYaw = input.lookYaw;
        player.lookPitch = input.lookPitch;
        this.prepareHookshotGrappleForMovement(player, stepNow);

        if (input.unstuck) {
          this.tryApplyUnstuck(player);
          authority.metrics.commandsProcessed++;
          processedThisTick++;
          if (authority.movementEpoch !== epochBeforeStep) break;
          continue;
        }

        this.simulateAuthoritativeMovementStep(player, input, MOVEMENT_SUBSTEP_SECONDS);
        this.stepHookshotGrappleAuthority(player, input, MOVEMENT_SUBSTEP_SECONDS, stepNow);
        this.processPlayerInput(player, input);
        authority.metrics.commandsProcessed++;
        processedThisTick++;
        if (authority.movementEpoch !== epochBeforeStep) break;
      }

      authority.metrics.queueLength = authority.pendingCommands.length;
      authority.metrics.lastAckSeq = authority.lastProcessedSeq;
      if (processedThisTick > 0 && authority.pendingCommands.length > MOVEMENT_MAX_SERVER_QUEUE / 2) {
        const stale = Math.max(0, authority.pendingCommands.length - MOVEMENT_MAX_SERVER_QUEUE / 2);
        authority.pendingCommands.splice(0, stale);
        authority.metrics.droppedCommands += stale;
        this.markMovementBarrier(player.id, 'epoch_mismatch');
      }

      if (player.position.y < -10) {
        this.placePlayerAtSpawn(player, 'respawn');
      }

      const client = clientsById.get(player.id);
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

  private getSpawnPosition(team: Team): { x: number; y: number; z: number } {
    const manifest = this.getMapManifest();
    const spawnPoints = manifest.gameplay?.spawns?.[team]?.points ?? manifest.spawnPoints[team];
    const spawn = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];

    return {
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
    };
  }

  private placePlayerAtSpawn(player: Player, reason: MovementCorrectionReason = 'spawn'): void {
    const spawn = this.getSpawnPosition(player.team as Team);
    player.position.x = spawn.x;
    player.position.y = spawn.y;
    player.position.z = spawn.z;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    this.authoritativePositionUntil.set(player.id, Date.now() + 1200);
    this.markMovementBarrier(player.id, reason);
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
        loggers.room.debug('NPC team defaulted', team, requestingPlayer.name);
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

    loggers.room.debug('NPC spawned', npcName, heroId, team, this.vec3SchemaToPlain(npc.position));

    // Broadcast NPC spawn to all clients
    this.broadcast('playerJoined', {
      playerId: npcId,
      playerName: npcName,
      team: team,
      heroId: heroId,
      isNpc: true,
      position: {
        x: npc.position.x,
        y: npc.position.y,
        z: npc.position.z,
      },
    });

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
    const oldHealth = npc.health;
    npc.health = Math.max(0, npc.health - damage);

    // Broadcast damage event
    this.broadcast('playerDamaged', {
      targetId: targetId,
      damage: damage,
      sourceId: client.sessionId,
      damageType: 'console',
      newHealth: npc.health,
      sourcePosition: this.state.players.get(client.sessionId)
        ? this.vec3SchemaToPlain(this.state.players.get(client.sessionId)!.position)
        : null,
      targetPosition: this.vec3SchemaToPlain(npc.position),
      sourceHeroId: this.state.players.get(client.sessionId)?.heroId || null,
      targetHeroId: npc.heroId || null,
    });

    loggers.room.debug('NPC damaged', npc.name, damage, oldHealth, npc.health);

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
    
    // Broadcast kill event
    this.broadcast('playerKilled', {
      victimId: npc.id,
      killerId,
      position: { x: npc.position.x, y: npc.position.y, z: npc.position.z },
      isNpc: true,
    });

    // Give killer credit
    if (killer && !this.spawnedNpcs.has(killerId)) {
      killer.kills++;
      killer.ultimateCharge = Math.min(100, killer.ultimateCharge + 20);
    }

    loggers.room.debug('NPC eliminated', npc.name, killer?.name || killerId);

    // Remove NPC from game
    this.state.players.delete(npc.id);
    this.spawnedNpcs.delete(npc.id);

    // Broadcast player left
    this.broadcast('playerLeft', {
      playerId: npc.id,
      isNpc: true,
    });
  }

  // Check if a player ID is an NPC
  isNpc(playerId: string): boolean {
    return this.spawnedNpcs.has(playerId);
  }
}
