import { performance } from 'node:perf_hooks';
import {
  BATTLE_ROYAL_TEAM_IDS,
  BLAZE_BOMB_SPLASH_RADIUS,
  HOOKSHOT_GROUND_HOOKS_RADIUS,
  HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS,
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
  clearVisualState,
  findCombatVisualEnemyPlayerHit,
  rebuildCombatVisualFrameCache,
  setChronosAegisVisualState,
  triggerRemotePlayerAttack,
  visualStore,
} from '../store/visualStore';
import { triggerAirStrike } from '../components/game/blaze/airstrike';
import { addChronosLifelineEffects } from '../components/game/chronos/lifeline';

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
const SAMPLE_FRAMES = 360;
const WARMUP_FRAMES = 60;
const PROJECTILE_QUERIES_PER_FRAME = 48;
const ABILITY_BURST_ITERATIONS = 180;
const EFFECT_BURST_ITERATIONS = 80;
const HEROES: HeroId[] = ['phantom', 'hookshot', 'blaze', 'chronos'];

const BUDGETS = {
  combatVisualCache: {
    p99Ms: 6,
    maxMs: 30,
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

function makePlayer(index: number): Player {
  const team = BATTLE_ROYAL_TEAM_IDS[Math.floor(index / 3) % BATTLE_ROYAL_TEAM_IDS.length] ?? 'br_01';
  const visible = index < VISIBLE_FIGHTERS;
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

function setupBattleRoyalStore(): Player[] {
  clearVisualState();
  const players = Array.from({ length: PLAYER_COUNT }, (_, index) => makePlayer(index));
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

function runCombatVisualCacheScenario(players: readonly Player[]): BenchmarkSummary {
  const samples: number[] = [];
  const playerMap = useGameStore.getState().players;
  let hits = 0;
  for (let frame = 0; frame < WARMUP_FRAMES + SAMPLE_FRAMES; frame++) {
    const startedAt = performance.now();
    const frameKey = 10_000 + frame;
    const cache = rebuildCombatVisualFrameCache(playerMap.values(), frameKey, frameKey, playerMap.size);

    for (let queryIndex = 0; queryIndex < PROJECTILE_QUERIES_PER_FRAME; queryIndex++) {
      const owner = players[queryIndex % VISIBLE_FIGHTERS] ?? players[0];
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

  return summarize('br_canvas_combat_visual_cache_3v3_projectiles', samples, BUDGETS.combatVisualCache, {
    players: playerMap.size,
    visibleFighters: VISIBLE_FIGHTERS,
    projectileQueriesPerFrame: PROJECTILE_QUERIES_PER_FRAME,
    hits,
    combatTeamBuckets: visualStore.getState().combatFrameCache.byTeam.size,
  });
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
  return [
    runCombatVisualCacheScenario(players),
    runAbilityBurstStoreScenario(players),
    runEffectTriggerScenario(players),
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
