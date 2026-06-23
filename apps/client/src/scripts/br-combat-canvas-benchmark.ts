import { performance } from 'node:perf_hooks';
import {
  BATTLE_ROYAL_TEAM_IDS,
  BLAZE_BOMB_SPLASH_RADIUS,
  HOOKSHOT_GROUND_HOOKS_RADIUS,
  HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS,
  MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS,
  getGameplayModeRules,
  type HeroId,
  type Player,
  type Team,
} from '@voxel-strike/shared';
import { useGameStore } from '../store/gameStore';
import { projectileInitialState } from '../store/slices/projectiles';
import type {
  ChronosPulseData,
  DireBallData,
  HookProjectileData,
  RocketData,
} from '../store/types';
import {
  addRemoteTransformSnapshot,
  clearVisualState,
  findCombatVisualEnemyPlayerHit,
  rebuildCombatVisualFrameCache,
  sampleRemoteTransformInto,
  setChronosAegisVisualState,
  triggerRemotePlayerAttack,
  visualStore,
  type SampledRemoteTransform,
} from '../store/visualStore';
import { triggerAirStrike } from '../components/game/blaze/airstrike';
import { addChronosLifelineEffects } from '../components/game/chronos/lifeline';
import {
  createRemoteHeroBatchBenchmarkRunner,
  type RemoteHeroBatchBenchmarkFrameStats,
} from '../components/game/RemoteHeroBatchRenderer';
import { getVisualQualityConfig } from '../components/game/visualQuality';

type BenchmarkMetricValue =
  | number
  | boolean
  | string
  | Record<string, number | boolean | string>;

interface BenchmarkSummary {
  name: string;
  iterations: number;
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  budgetP99Ms: number;
  budgetMaxMs: number;
  budgetExceeded: boolean;
  metrics?: Record<string, BenchmarkMetricValue>;
}

const PLAYER_COUNT = 30;
const VISIBLE_FIGHTERS = 6;
const DENSE_PLAYER_COUNT = 96;
const DENSE_VISIBLE_FIGHTERS = 24;
const BR_FULL_ROSTER_PLAYER_COUNT = getGameplayModeRules('battle_royal').maxPlayers;
const REPORTED_CLUSTER_VISIBLE_FIGHTERS = 9;
const SAMPLE_FRAMES = 360;
const WARMUP_FRAMES = 60;
const PROJECTILE_QUERIES_PER_FRAME = 48;
const DENSE_PROJECTILE_QUERIES_PER_FRAME = 192;
const REMOTE_TRANSFORM_PLAYER_COUNT = 96;
const REMOTE_TRANSFORM_HISTORY_SNAPSHOTS = 12;
const REMOTE_TRANSFORM_WALL_RUN_SIDES = [0, 1, -1] as const;
const ABILITY_BURST_ITERATIONS = 180;
const EFFECT_BURST_ITERATIONS = 80;
const HEROES: HeroId[] = ['phantom', 'hookshot', 'blaze', 'chronos'];
const BR_REMOTE_HERO_CAMERA_POSITION = vec3(0, 5.5, -2);

const BUDGETS = {
  combatVisualCache: {
    p99Ms: 6,
    maxMs: 30,
  },
  denseCombatVisualCache: {
    p99Ms: 12,
    maxMs: 60,
  },
  remoteTransformSampling: {
    p99Ms: 2,
    maxMs: 10,
  },
  remoteHeroBatchCpu: {
    p99Ms: 8,
    maxMs: 40,
  },
  abilityBurstStore: {
    p99Ms: 6,
    maxMs: 40,
  },
  effectTriggerBurst: {
    p99Ms: 10,
    maxMs: 60,
  },
} as const;

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index] ?? 0;
}

function summarize(
  name: string,
  samples: number[],
  budget: { p99Ms: number; maxMs: number },
  metrics?: Record<string, BenchmarkMetricValue>
): BenchmarkSummary {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.reduce((sum, sample) => sum + sample, 0);
  const p99Ms = percentile(sorted, 0.99);
  const maxMs = sorted[sorted.length - 1] ?? 0;
  return {
    name,
    iterations: samples.length,
    averageMs: samples.length > 0 ? total / samples.length : 0,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms,
    maxMs,
    budgetP99Ms: budget.p99Ms,
    budgetMaxMs: budget.maxMs,
    budgetExceeded: p99Ms > budget.p99Ms || maxMs > budget.maxMs,
    ...(metrics ? { metrics } : {}),
  };
}

function vec3(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return { x, y, z };
}

function createSampledRemoteTransform(): SampledRemoteTransform {
  return {
    position: vec3(0, 0, 0),
    velocity: vec3(0, 0, 0),
    lookYaw: 0,
    lookPitch: 0,
    movementBits: 0,
    wallRunSide: 0,
    movementEpoch: 0,
    extrapolatedMs: 0,
    stale: false,
  };
}

function makePlayer(index: number, visibleFighters = VISIBLE_FIGHTERS): Player {
  const team = BATTLE_ROYAL_TEAM_IDS[Math.floor(index / 3) % BATTLE_ROYAL_TEAM_IDS.length] ?? 'br_01';
  const visible = index < visibleFighters;
  const side = index % 2 === 0 ? -1 : 1;
  const lane = Math.floor(index / 2);
  const x = visible ? side * (3 + lane * 0.8) : side * (80 + index * 3);
  const z = visible ? -8 + lane * 3.2 : 64 + index * 4;
  const heroId = HEROES[index % HEROES.length] ?? 'phantom';

  return {
    id: `br-player-${index}`,
    name: `BR Player ${index}`,
    team,
    heroId,
    state: 'alive',
    isReady: true,
    isBot: index !== 0,
    position: vec3(x, 1, z),
    velocity: vec3(0, 0, 0),
    lookYaw: index * 0.21,
    lookPitch: 0,
    health: 100,
    maxHealth: 100,
    ultimateCharge: index % 5 === 0 ? 100 : 45,
    movement: {
      isGrounded: true,
      isSprinting: index % 3 === 0,
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
    },
    abilities: {},
    hasFlag: false,
    respawnTime: null,
    spawnProtectionUntil: null,
    stats: {
      kills: 0,
      deaths: 0,
      assists: 0,
      flagCaptures: 0,
      flagReturns: 0,
    },
    visibility: visible ? 'visible' : 'hidden',
  };
}

function setupBattleRoyalStore(playerCount = PLAYER_COUNT, visibleFighters = VISIBLE_FIGHTERS): Player[] {
  clearVisualState();
  const players = Array.from({ length: playerCount }, (_, index) => makePlayer(index, visibleFighters));
  const playerMap = new Map(players.map((player) => [player.id, player]));
  useGameStore.setState({
    ...projectileInitialState,
    gameplayMode: 'battle_royal',
    gamePhase: 'playing',
    playerId: 'br-player-0',
    localPlayer: players[0] ?? null,
    players: playerMap,
    mapProfileId: 'battle_royal_large',
    mapSize: 'large',
  });
  return players;
}

function directionFor(index: number): { x: number; y: number; z: number } {
  const angle = -0.2 + (index % 7) * 0.065;
  return {
    x: Math.sin(angle),
    y: 0,
    z: -Math.cos(angle),
  };
}

function makeDireBall(id: string, owner: Player, now: number): DireBallData {
  const direction = directionFor(Number(id.replace(/\D/g, '')) || 0);
  return {
    id,
    position: { ...owner.position, y: owner.position.y + 1.1 },
    velocity: vec3(direction.x * 38, direction.y * 38, direction.z * 38),
    startTime: now,
    ownerId: owner.id,
    ownerTeam: owner.team,
  };
}

function makeHookProjectile(id: string, owner: Player, now: number): HookProjectileData {
  const direction = directionFor(Number(id.replace(/\D/g, '')) || 0);
  const position = { ...owner.position, y: owner.position.y + 1.1 };
  return {
    id,
    position,
    velocity: vec3(direction.x * 44, direction.y * 44, direction.z * 44),
    startTime: now,
    ownerId: owner.id,
    ownerTeam: owner.team,
    state: 'extending',
    maxDistance: 38,
    startPosition: position,
  };
}

function makeRocket(id: string, owner: Player, now: number): RocketData {
  const direction = directionFor(Number(id.replace(/\D/g, '')) || 0);
  return {
    id,
    position: { ...owner.position, y: owner.position.y + 1.15 },
    velocity: vec3(direction.x * 30, direction.y * 30, direction.z * 30),
    startTime: now,
    ownerId: owner.id,
    ownerTeam: owner.team,
  };
}

function makeChronosPulse(id: string, owner: Player, now: number): ChronosPulseData {
  const direction = directionFor(Number(id.replace(/\D/g, '')) || 0);
  return {
    id,
    position: { ...owner.position, y: owner.position.y + 1.25 },
    velocity: vec3(direction.x * 42, direction.y * 42, direction.z * 42),
    startTime: now,
    ownerId: owner.id,
    ownerTeam: owner.team,
    supercharged: id.endsWith('0'),
  };
}

function runCombatVisualCacheScenario(
  players: readonly Player[],
  options: {
    name?: string;
    visibleFighters?: number;
    projectileQueriesPerFrame?: number;
    budget?: { p99Ms: number; maxMs: number };
  } = {}
): BenchmarkSummary {
  const visibleFighters = options.visibleFighters ?? VISIBLE_FIGHTERS;
  const projectileQueriesPerFrame = options.projectileQueriesPerFrame ?? PROJECTILE_QUERIES_PER_FRAME;
  const samples: number[] = [];
  const playerMap = useGameStore.getState().players;
  let hits = 0;
  for (let frame = 0; frame < WARMUP_FRAMES + SAMPLE_FRAMES; frame++) {
    const startedAt = performance.now();
    const frameKey = 10_000 + frame;
    const cache = rebuildCombatVisualFrameCache(playerMap.values(), frameKey, frameKey, playerMap.size);

    for (let queryIndex = 0; queryIndex < projectileQueriesPerFrame; queryIndex++) {
      const owner = players[queryIndex % visibleFighters] ?? players[0];
      const direction = directionFor(queryIndex);
      const hit = findCombatVisualEnemyPlayerHit(
        cache,
        owner.team,
        owner.id,
        { x: owner.position.x, y: owner.position.y + 1, z: owner.position.z },
        direction,
        26,
        0.32,
        { x: owner.position.x, z: owner.position.z },
        42
      );
      if (hit) hits++;
    }

    const durationMs = performance.now() - startedAt;
    if (frame >= WARMUP_FRAMES) samples.push(durationMs);
  }

  return summarize(options.name ?? 'br_canvas_combat_visual_cache_3v3_projectiles', samples, options.budget ?? BUDGETS.combatVisualCache, {
    players: playerMap.size,
    visibleFighters,
    projectileQueriesPerFrame,
    hits,
    combatSpatialBuckets: visualStore.getState().combatFrameCache.activeBuckets.length,
  });
}

function seedRemoteTransformHistories(playerCount: number): {
  ids: string[];
  targets: SampledRemoteTransform[];
  latestReceivedAtMs: number;
} {
  clearVisualState();
  const ids: string[] = [];
  const targets: SampledRemoteTransform[] = [];
  const firstServerTime = 40_000;
  const firstReceivedAtMs = 80_000;

  for (let playerIndex = 0; playerIndex < playerCount; playerIndex++) {
    const playerId = `br-remote-${playerIndex}`;
    ids.push(playerId);
    targets.push(createSampledRemoteTransform());

    for (let snapshotIndex = 0; snapshotIndex < REMOTE_TRANSFORM_HISTORY_SNAPSHOTS; snapshotIndex++) {
      const serverTime = firstServerTime + snapshotIndex * 50;
      const receivedAtMs = firstReceivedAtMs + snapshotIndex * 50;
      addRemoteTransformSnapshot(
        playerId,
        {
          serverTick: serverTime / 50,
          serverTime,
          position: vec3(playerIndex * 0.45 + snapshotIndex * 0.08, 1, playerIndex * 0.22),
          velocity: vec3(1 + (playerIndex % 4) * 0.1, 0, -0.4),
          lookYaw: playerIndex * 0.05 + snapshotIndex * 0.01,
          lookPitch: (playerIndex % 5) * 0.02,
          movementBits: snapshotIndex,
          wallRunSide: REMOTE_TRANSFORM_WALL_RUN_SIDES[playerIndex % REMOTE_TRANSFORM_WALL_RUN_SIDES.length],
          movementEpoch: Math.floor(snapshotIndex / 4),
        },
        receivedAtMs
      );
    }
  }

  return {
    ids,
    targets,
    latestReceivedAtMs: firstReceivedAtMs + (REMOTE_TRANSFORM_HISTORY_SNAPSHOTS - 1) * 50,
  };
}

function runRemoteTransformSamplingScenario(): BenchmarkSummary {
  const { ids, targets, latestReceivedAtMs } = seedRemoteTransformHistories(REMOTE_TRANSFORM_PLAYER_COUNT);
  const samples: number[] = [];
  let sampledCount = 0;
  let staleSamples = 0;

  for (let frame = 0; frame < WARMUP_FRAMES + SAMPLE_FRAMES; frame++) {
    const frameOffsetMs = frame % 3 === 0 ? 16 : frame % 3 === 1 ? -25 : -75;
    const nowMs = latestReceivedAtMs + MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS + frameOffsetMs;
    const startedAt = performance.now();
    for (let playerIndex = 0; playerIndex < ids.length; playerIndex++) {
      const target = targets[playerIndex] ?? targets[0];
      if (sampleRemoteTransformInto(ids[playerIndex] ?? '', target, nowMs)) {
        sampledCount++;
        if (target.stale) staleSamples++;
      }
    }
    const durationMs = performance.now() - startedAt;
    if (frame >= WARMUP_FRAMES) samples.push(durationMs);
  }

  return summarize('br_canvas_remote_transform_sampling_96_players', samples, BUDGETS.remoteTransformSampling, {
    players: REMOTE_TRANSFORM_PLAYER_COUNT,
    snapshotsPerPlayer: REMOTE_TRANSFORM_HISTORY_SNAPSHOTS,
    samplesPerFrame: ids.length,
    sampledCount,
    staleSamples,
  });
}

type RemoteHeroBenchmarkQualityProfile = 'balanced' | 'competitive';

function getRemotePlayerBenchmarkConfig(graphicsPreset: RemoteHeroBenchmarkQualityProfile) {
  return getVisualQualityConfig({
    resolutionScale: 'medium',
    antialiasing: true,
    shadowQuality: 'medium',
    reflectionQuality: 'medium',
    environmentQuality: 'medium',
    materialQuality: 'medium',
    graphicsPreset,
  }).remotePlayers;
}

function prepareDenseRemoteHeroPlayers(players: readonly Player[], visibleFighters: number): void {
  for (let index = 0; index < players.length; index++) {
    const player = players[index];
    if (!player) continue;
    const isVisibleFighter = index < visibleFighters;
    const angle = index * 0.47;
    const speed = isVisibleFighter ? 5 + (index % 5) * 0.75 : 0.25;
    player.lookYaw = angle + Math.PI;
    player.lookPitch = isVisibleFighter ? Math.sin(angle) * 0.12 : 0;
    player.velocity.x = Math.sin(angle) * speed;
    player.velocity.y = index % 11 === 0 && isVisibleFighter ? 0.8 : 0;
    player.velocity.z = Math.cos(angle) * speed;
    player.hasFlag = isVisibleFighter && index % 13 === 0;
    player.onFireUntil = isVisibleFighter && index % 7 === 0 ? Number.MAX_SAFE_INTEGER : undefined;
    player.movement = {
      ...player.movement,
      isGrounded: !(isVisibleFighter && index % 11 === 0),
      isSprinting: isVisibleFighter && index % 3 !== 1,
      isCrouching: isVisibleFighter && index % 10 === 0,
      isSliding: isVisibleFighter && index % 9 === 0,
      slideTimeRemaining: isVisibleFighter && index % 9 === 0 ? 0.35 : 0,
      isWallRunning: false,
      wallRunSide: null,
      isGrappling: isVisibleFighter && index % 17 === 0,
      grapplePoint: isVisibleFighter && index % 17 === 0
        ? vec3(player.position.x + 4, player.position.y + 3, player.position.z - 2)
        : null,
      isJetpacking: isVisibleFighter && index % 19 === 0,
      jetpackFuel: isVisibleFighter && index % 19 === 0 ? 0.6 : 0,
      isGliding: false,
    };
  }
}

function animateDenseRemoteHeroPlayers(players: readonly Player[], visibleFighters: number, frame: number): void {
  const time = frame / 60;
  for (let index = 0; index < visibleFighters; index++) {
    const player = players[index];
    if (!player) continue;
    const radius = 8 + (index % 8) * 1.4;
    const angle = time * (0.55 + (index % 4) * 0.08) + index * 0.53;
    player.position.x = Math.sin(angle) * radius;
    player.position.z = -3 + Math.cos(angle) * radius * 0.72;
    player.lookYaw = angle + Math.PI * 0.5;
    player.lookPitch = Math.sin(time * 1.7 + index) * 0.14;
    player.velocity.x = Math.cos(angle) * radius * 0.45;
    player.velocity.z = -Math.sin(angle) * radius * 0.32;
    player.movement.isSliding = index % 9 === 0 && frame % 120 < 42;
    player.movement.isCrouching = !player.movement.isSliding && index % 10 === 0 && frame % 150 < 70;
    player.movement.isSprinting = !player.movement.isCrouching && index % 3 !== 1;
  }
}

function seedDenseRemoteHeroCombatActivity(
  players: readonly Player[],
  visibleFighters: number,
  nowMs: number
): void {
  for (let index = 0; index < visibleFighters; index++) {
    const player = players[index];
    if (!player) continue;
    triggerRemotePlayerAttack(player.id, index % 2 === 0 ? 'basic_attack' : 'secondary_attack', {
      side: index % 2 === 0 ? 1 : -1,
      startedAtMs: nowMs,
    });
    if (player.heroId === 'chronos' && index % 6 === 3) {
      setChronosAegisVisualState(player.id, true, nowMs, 0.75, {
        renderWorldEffect: true,
      });
    }
  }
}

function runRemoteHeroBatchScenario(options: {
  name: string;
  playerCount: number;
  visibleFighters: number;
  resourceScope: 'allAlive' | 'visibleOnly';
  qualityProfile?: RemoteHeroBenchmarkQualityProfile;
  cardinalityBudget?: {
    maxMountedInstancedMeshes: number;
    maxEmptyMountedInstancedMeshes: number;
  };
}): BenchmarkSummary {
  const players = setupBattleRoyalStore(options.playerCount, options.visibleFighters);
  prepareDenseRemoteHeroPlayers(players, options.visibleFighters);
  const renderPlayers = players.filter((player) => player.visibility === 'visible');
  const resourcePlayers = options.resourceScope === 'visibleOnly' ? renderPlayers : players;
  const qualityProfile = options.qualityProfile ?? 'balanced';
  const runner = createRemoteHeroBatchBenchmarkRunner({
    players: renderPlayers,
    resourcePlayers,
    isBattleRoyal: true,
    localPlayerId: 'br-player-0',
    localPlayerTeam: players[0]?.team ?? null,
    config: getRemotePlayerBenchmarkConfig(qualityProfile),
    cameraPosition: BR_REMOTE_HERO_CAMERA_POSITION,
  });
  const samples: number[] = [];
  let lastStats: RemoteHeroBatchBenchmarkFrameStats | null = null;
  let maxBodyPlayers = 0;
  let maxOutlinePlayers = 0;
  let maxNormalMatrixWrites = 0;
  let maxOutlineMatrixWrites = 0;

  try {
    for (let frame = 0; frame < WARMUP_FRAMES + SAMPLE_FRAMES; frame++) {
      const nowMs = 120_000 + frame * (1000 / 60);
      animateDenseRemoteHeroPlayers(players, options.visibleFighters, frame);
      if (frame % 90 === 0) {
        seedDenseRemoteHeroCombatActivity(players, options.visibleFighters, nowMs);
      }

      const startedAt = performance.now();
      lastStats = runner.runFrame({
        deltaSeconds: 1 / 60,
        elapsedSeconds: frame / 60,
        nowMs,
        cameraPosition: BR_REMOTE_HERO_CAMERA_POSITION,
      });
      const durationMs = performance.now() - startedAt;

      if (frame >= WARMUP_FRAMES) {
        samples.push(durationMs);
        maxBodyPlayers = Math.max(maxBodyPlayers, lastStats.bodyPlayers);
        maxOutlinePlayers = Math.max(maxOutlinePlayers, lastStats.outlinePlayers);
        maxNormalMatrixWrites = Math.max(maxNormalMatrixWrites, lastStats.normalMatrixWrites);
        maxOutlineMatrixWrites = Math.max(maxOutlineMatrixWrites, lastStats.outlineMatrixWrites);
      }
    }
  } finally {
    runner.dispose();
  }

  const mountedInstancedMeshes = lastStats?.mountedInstancedMeshes ?? 0;
  const emptyMountedInstancedMeshes = lastStats?.emptyMountedInstancedMeshes ?? 0;
  const cardinalityBudgetExceeded = options.cardinalityBudget
    ? mountedInstancedMeshes > options.cardinalityBudget.maxMountedInstancedMeshes ||
      emptyMountedInstancedMeshes > options.cardinalityBudget.maxEmptyMountedInstancedMeshes
    : false;
  const summary = summarize(options.name, samples, BUDGETS.remoteHeroBatchCpu, {
    players: renderPlayers.length,
    resourcePlayers: resourcePlayers.length,
    visibleFighters: options.visibleFighters,
    resourceScope: options.resourceScope,
    qualityProfile,
    groups: lastStats?.groups ?? 0,
    emptyGroups: lastStats?.emptyGroups ?? 0,
    normalBatches: lastStats?.normalBatches ?? 0,
    outlineBatches: lastStats?.outlineBatches ?? 0,
    instancedBatches: (lastStats?.normalBatches ?? 0) + (lastStats?.outlineBatches ?? 0),
    mountedInstancedMeshes,
    emptyMountedInstancedMeshes,
    batchFinalizations: lastStats?.batchFinalizations ?? 0,
    cardinalityBudgetExceeded,
    ...(options.cardinalityBudget ? {
      mountedInstancedMeshesBudget: options.cardinalityBudget.maxMountedInstancedMeshes,
      emptyMountedInstancedMeshesBudget: options.cardinalityBudget.maxEmptyMountedInstancedMeshes,
    } : {}),
    maxBodyPlayers,
    maxOutlinePlayers,
    maxNormalMatrixWrites,
    maxOutlineMatrixWrites,
  });
  if (cardinalityBudgetExceeded) summary.budgetExceeded = true;
  return summary;
}

function runAbilityBurstStoreScenario(players: readonly Player[]): BenchmarkSummary {
  const store = useGameStore.getState();
  const samples: number[] = [];
  let projectileReferenceChanges = 0;
  const unsubscribe = useGameStore.subscribe((state, previousState) => {
    if (state.direBalls !== previousState.direBalls) projectileReferenceChanges++;
    if (state.hookProjectiles !== previousState.hookProjectiles) projectileReferenceChanges++;
    if (state.rockets !== previousState.rockets) projectileReferenceChanges++;
    if (state.chronosPulses !== previousState.chronosPulses) projectileReferenceChanges++;
    if (state.bombs !== previousState.bombs) projectileReferenceChanges++;
    if (state.hookshotGroundHooks !== previousState.hookshotGroundHooks) projectileReferenceChanges++;
  });

  try {
    for (let burst = 0; burst < ABILITY_BURST_ITERATIONS; burst++) {
      const now = Date.now() + burst * 16;
      const startedAt = performance.now();
      for (let fighterIndex = 0; fighterIndex < VISIBLE_FIGHTERS; fighterIndex++) {
        const owner = players[fighterIndex] ?? players[0];
        const id = `burst-${burst}-${fighterIndex}`;
        triggerRemotePlayerAttack(owner.id, fighterIndex % 2 === 0 ? 'basic_attack' : 'secondary_attack', {
          side: fighterIndex % 2 === 0 ? 1 : -1,
          startedAtMs: now,
        });
        if (fighterIndex === 0) {
          store.addDireBall(makeDireBall(`dire-${id}`, owner, now));
        } else if (fighterIndex === 1) {
          store.addHookProjectile(makeHookProjectile(`hook-${id}`, owner, now));
        } else if (fighterIndex === 2) {
          store.addRocket(makeRocket(`rocket-${id}`, owner, now));
        } else if (fighterIndex === 3) {
          store.addChronosPulse(makeChronosPulse(`pulse-${id}`, owner, now));
        } else if (fighterIndex === 4) {
          store.addBomb({
            id: `bomb-${id}`,
            targetPosition: vec3(owner.position.x + 5, 1, owner.position.z - 8),
            startPosition: { ...owner.position, y: owner.position.y + 1.2 },
            warningStartTime: now,
            startTime: now + 100,
            impactTime: now + 760,
            radius: BLAZE_BOMB_SPLASH_RADIUS,
            ownerId: owner.id,
            ownerTeam: owner.team,
            hasExploded: false,
          });
        } else {
          store.addHookshotGroundHooks({
            id: `roots-${id}`,
            position: { ...owner.position },
            startTime: now,
            duration: HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS,
            ownerId: owner.id,
            ownerTeam: owner.team,
            radius: HOOKSHOT_GROUND_HOOKS_RADIUS,
            rootUntil: now + HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS * 1000,
            targets: players.slice(0, VISIBLE_FIGHTERS).map((target) => ({
              targetId: target.id,
              position: { ...target.position },
              rootUntil: now + 1000,
            })),
          });
        }
      }
      setChronosAegisVisualState(players[3]?.id ?? 'br-player-3', burst % 2 === 0, now, 0.75, {
        renderWorldEffect: true,
      });
      samples.push(performance.now() - startedAt);
    }
  } finally {
    unsubscribe();
  }

  return summarize('br_canvas_ability_burst_store_3v3', samples, BUDGETS.abilityBurstStore, {
    visibleFighters: VISIBLE_FIGHTERS,
    bursts: ABILITY_BURST_ITERATIONS,
    projectileReferenceChanges,
    remoteAttackStates: visualStore.getState().remotePlayerAttackStates.size,
    activeChronosAegisPlayers: visualStore.getState().activeChronosAegisPlayerIds.length,
  });
}

function runEffectTriggerScenario(players: readonly Player[]): BenchmarkSummary {
  const samples: number[] = [];
  for (let index = 0; index < EFFECT_BURST_ITERATIONS; index++) {
    const owner = players[index % VISIBLE_FIGHTERS] ?? players[0];
    const startedAt = performance.now();
    triggerAirStrike({
      x: owner.position.x + index * 0.25,
      y: owner.position.y,
      z: owner.position.z - 2,
    }, {
      ownerId: owner.id,
      ownerTeam: owner.team,
    });
    addChronosLifelineEffects(
      { x: owner.position.x, y: owner.position.y + 1.1, z: owner.position.z },
      players.slice(0, VISIBLE_FIGHTERS).map((target) => ({
        position: { x: target.position.x, y: target.position.y, z: target.position.z },
      }))
    );
    samples.push(performance.now() - startedAt);
  }

  return summarize('br_canvas_effect_trigger_burst_3v3', samples, BUDGETS.effectTriggerBurst, {
    visibleFighters: VISIBLE_FIGHTERS,
    bursts: EFFECT_BURST_ITERATIONS,
  });
}

function runBenchmarks(): BenchmarkSummary[] {
  const players = setupBattleRoyalStore();
  const combatVisualCacheSummary = runCombatVisualCacheScenario(players);
  const densePlayers = setupBattleRoyalStore(DENSE_PLAYER_COUNT, DENSE_VISIBLE_FIGHTERS);
  const denseCombatVisualCacheSummary = runCombatVisualCacheScenario(densePlayers, {
    name: 'br_canvas_combat_visual_cache_dense_skirmish',
    visibleFighters: DENSE_VISIBLE_FIGHTERS,
    projectileQueriesPerFrame: DENSE_PROJECTILE_QUERIES_PER_FRAME,
    budget: BUDGETS.denseCombatVisualCache,
  });
  const remoteTransformSamplingSummary = runRemoteTransformSamplingScenario();
  const abilityPlayers = setupBattleRoyalStore();
  return [
    combatVisualCacheSummary,
    denseCombatVisualCacheSummary,
    remoteTransformSamplingSummary,
    runRemoteHeroBatchScenario({
      name: 'br_canvas_remote_hero_batch_cpu_8_bot_cluster_full_roster',
      playerCount: BR_FULL_ROSTER_PLAYER_COUNT,
      visibleFighters: REPORTED_CLUSTER_VISIBLE_FIGHTERS,
      resourceScope: 'allAlive',
      cardinalityBudget: {
        maxMountedInstancedMeshes: 240,
        maxEmptyMountedInstancedMeshes: 0,
      },
    }),
    runRemoteHeroBatchScenario({
      name: 'br_canvas_remote_hero_batch_cpu_8_bot_cluster_visible_resources',
      playerCount: BR_FULL_ROSTER_PLAYER_COUNT,
      visibleFighters: REPORTED_CLUSTER_VISIBLE_FIGHTERS,
      resourceScope: 'visibleOnly',
      cardinalityBudget: {
        maxMountedInstancedMeshes: 240,
        maxEmptyMountedInstancedMeshes: 0,
      },
    }),
    runRemoteHeroBatchScenario({
      name: 'br_canvas_remote_hero_batch_cpu_dense_skirmish',
      playerCount: BR_FULL_ROSTER_PLAYER_COUNT,
      visibleFighters: DENSE_VISIBLE_FIGHTERS,
      resourceScope: 'allAlive',
      cardinalityBudget: {
        maxMountedInstancedMeshes: 640,
        maxEmptyMountedInstancedMeshes: 0,
      },
    }),
    runRemoteHeroBatchScenario({
      name: 'br_canvas_remote_hero_batch_cpu_competitive_team_silhouettes',
      playerCount: BR_FULL_ROSTER_PLAYER_COUNT,
      visibleFighters: REPORTED_CLUSTER_VISIBLE_FIGHTERS,
      resourceScope: 'visibleOnly',
      qualityProfile: 'competitive',
      cardinalityBudget: {
        maxMountedInstancedMeshes: 240,
        maxEmptyMountedInstancedMeshes: 0,
      },
    }),
    runAbilityBurstStoreScenario(abilityPlayers),
    runEffectTriggerScenario(abilityPlayers),
  ];
}

const benchmarkFilter = (process.env.BR_CANVAS_BENCH_FILTER ?? '').trim();
const benchmarkFilterParts = benchmarkFilter
  .split(',')
  .map((part) => part.trim())
  .filter(Boolean);
const results = runBenchmarks().filter((summary) => (
  benchmarkFilterParts.length === 0 ||
  benchmarkFilterParts.some((filterPart) => summary.name.includes(filterPart))
));

if (results.length === 0) {
  throw new Error(`BR_CANVAS_BENCH_FILTER="${benchmarkFilter}" did not match any benchmark cases`);
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  filter: benchmarkFilter || undefined,
  results,
}, null, 2));

if (results.some((result) => result.budgetExceeded)) {
  process.exitCode = 1;
}
