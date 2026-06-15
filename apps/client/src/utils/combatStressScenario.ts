import {
  ALL_HERO_IDS,
  HOOKSHOT_GROUND_HOOKS_RADIUS,
  HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS,
  type HeroId,
  type Player,
  type Team,
  type Vec3,
} from '@voxel-strike/shared';
import { useGameStore } from '../store/gameStore';
import { setFlamethrowerVisualPose, visualStore } from '../store/visualStore';

export interface LocalCombatStressScenarioOptions {
  seed?: number;
  remotePlayers?: number;
  projectiles?: number;
  radius?: number;
  durationMs?: number;
}

export interface LocalCombatStressScenarioHandle {
  stop: () => void;
}

interface ActiveStressScenario {
  stop: () => void;
}

const DEFAULT_STRESS_SEED = 0x5eed_2026;
const STRESS_ID_PREFIX = 'stress';

let activeScenario: ActiveStressScenario | null = null;

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function createMovementState(isJetpacking = false): Player['movement'] {
  return {
    isGrounded: !isJetpacking,
    isSprinting: false,
    isCrouching: false,
    isSliding: false,
    slideTimeRemaining: 0,
    isWallRunning: false,
    wallRunSide: null,
    isGrappling: false,
    grapplePoint: null,
    isJetpacking,
    jetpackFuel: isJetpacking ? 62 : 100,
    isGliding: false,
  };
}

function createStressPlayer(
  id: string,
  name: string,
  team: Team,
  heroId: HeroId,
  position: Vec3,
  isBot: boolean,
  isJetpacking = false
): Player {
  return {
    id,
    name,
    team,
    heroId,
    state: 'alive',
    isReady: true,
    isBot,
    position,
    velocity: { x: 0, y: 0, z: 0 },
    lookYaw: 0,
    lookPitch: 0,
    health: 100,
    maxHealth: 100,
    ultimateCharge: 100,
    movement: createMovementState(isJetpacking),
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
  };
}

function vectorToward(from: Vec3, to: Vec3, speed: number): Vec3 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.max(0.0001, Math.sqrt(dx * dx + dy * dy + dz * dz));
  return {
    x: (dx / length) * speed,
    y: (dy / length) * speed,
    z: (dz / length) * speed,
  };
}

function createPointOnRing(random: () => number, radius: number, y = 4): Vec3 {
  const angle = random() * Math.PI * 2;
  const distance = radius * (0.55 + random() * 0.45);
  return {
    x: Math.cos(angle) * distance,
    y: y + random() * 7,
    z: Math.sin(angle) * distance,
  };
}

export function clearLocalCombatStressScenario(): void {
  activeScenario?.stop();
  activeScenario = null;
}

export function runLocalCombatStressScenario(
  options: LocalCombatStressScenarioOptions = {}
): LocalCombatStressScenarioHandle {
  clearLocalCombatStressScenario();

  const state = useGameStore.getState();
  const visualState = visualStore.getState();
  const previousPhase = {
    appPhase: state.appPhase,
    gamePhase: state.gamePhase,
    players: new Map(state.players),
    localPlayer: state.localPlayer,
    mapSeed: state.mapSeed,
    rockets: state.rockets,
    direBalls: state.direBalls,
    voidRays: state.voidRays,
    chronosPulses: state.chronosPulses,
    hookProjectiles: state.hookProjectiles,
    dragHooks: state.dragHooks,
    hookshotGroundHooks: state.hookshotGroundHooks,
    flamethrowerActive: state.flamethrowerActive,
  };
  const previousFlamethrowerVisualPose = {
    origin: visualState.flamethrowerOrigin ? { ...visualState.flamethrowerOrigin } : null,
    direction: { ...visualState.flamethrowerDirection },
  };

  const random = createSeededRandom(options.seed ?? DEFAULT_STRESS_SEED);
  const remotePlayers = Math.max(0, Math.floor(options.remotePlayers ?? 12));
  const projectileCount = Math.max(0, Math.floor(options.projectiles ?? 72));
  const radius = Math.max(8, options.radius ?? 34);
  const now = Date.now();
  const localId = `${STRESS_ID_PREFIX}:local`;
  const localPlayer = createStressPlayer(
    localId,
    'Stress Local',
    'red',
    'phantom',
    { x: 0, y: 3, z: 0 },
    false
  );
  const players = new Map<string, Player>();
  players.set(localId, localPlayer);

  for (let i = 0; i < remotePlayers; i++) {
    const team: Team = i % 2 === 0 ? 'blue' : 'red';
    const heroId = ALL_HERO_IDS[i % ALL_HERO_IDS.length] ?? 'phantom';
    const position = createPointOnRing(random, radius, 2);
    players.set(
      `${STRESS_ID_PREFIX}:bot:${i}`,
      createStressPlayer(
        `${STRESS_ID_PREFIX}:bot:${i}`,
        `Stress Bot ${i + 1}`,
        team,
        heroId,
        position,
        true,
        heroId === 'blaze' && i % 3 === 0
      )
    );
  }

  useGameStore.setState({
    appPhase: 'in_game',
    gamePhase: 'playing',
    mapSeed: options.seed ?? state.mapSeed,
    localPlayer,
    playerId: localId,
    players,
  });

  const store = useGameStore.getState();
  for (let i = 0; i < projectileCount; i++) {
    const origin = createPointOnRing(random, radius, 3);
    const target = createPointOnRing(random, radius * 0.35, 2);
    const velocity = vectorToward(origin, target, 24 + random() * 26);
    const team: Team = i % 2 === 0 ? 'blue' : 'red';
    const ownerId = `${STRESS_ID_PREFIX}:bot:${i % Math.max(1, remotePlayers)}`;
    const id = `${STRESS_ID_PREFIX}:projectile:${i}`;

    switch (i % 6) {
      case 0:
        store.addRocket({
          id,
          position: origin,
          velocity,
          startTime: now,
          ownerId,
          ownerTeam: team,
        });
        break;
      case 1:
        store.addDireBall({
          id,
          position: origin,
          velocity,
          startTime: now,
          ownerId,
          ownerTeam: team,
        });
        break;
      case 2:
        store.addChronosPulse({
          id,
          position: origin,
          velocity,
          startTime: now,
          ownerId,
          ownerTeam: team,
        });
        break;
      case 3:
        store.addVoidRay({
          id,
          startPosition: origin,
          direction: vectorToward(origin, target, 1),
          startTime: now,
          ownerId,
          ownerTeam: team,
        });
        break;
      case 4:
        store.addHookProjectile({
          id,
          position: origin,
          velocity,
          startTime: now,
          ownerId,
          ownerTeam: team,
          state: 'extending',
          maxDistance: 16,
          startPosition: origin,
        });
        break;
      default:
        store.addHookshotGroundHooks({
          id,
          position: origin,
          startTime: now,
          duration: HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS,
          ownerId,
          ownerTeam: team,
          radius: HOOKSHOT_GROUND_HOOKS_RADIUS,
          rootUntil: now + HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS * 1000,
          targets: [{
            targetId: `${id}:target`,
            position: target,
            rootUntil: now + HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS * 1000,
          }],
        });
        break;
    }
  }

  store.setFlamethrowerActive(true);
  setFlamethrowerVisualPose(
    { x: -8, y: 5, z: 8 },
    vectorToward({ x: -8, y: 5, z: 8 }, { x: 4, y: 4, z: -4 }, 1)
  );

  const stop = () => {
    useGameStore.setState({
      ...previousPhase,
      playerId: state.playerId,
      players: previousPhase.players,
      localPlayer: previousPhase.localPlayer,
    });
    setFlamethrowerVisualPose(
      previousFlamethrowerVisualPose.origin,
      previousFlamethrowerVisualPose.direction
    );
  };

  activeScenario = { stop };

  if (options.durationMs && options.durationMs > 0) {
    window.setTimeout(() => {
      if (activeScenario?.stop === stop) clearLocalCombatStressScenario();
    }, options.durationMs);
  }

  return {
    stop,
  };
}

export function installLocalCombatStressScenario(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;

  window.__opusStrikeStress = {
    run: runLocalCombatStressScenario,
    clear: clearLocalCombatStressScenario,
  };
}

declare global {
  interface Window {
    __opusStrikeStress?: {
      run: typeof runLocalCombatStressScenario;
      clear: typeof clearLocalCombatStressScenario;
    };
  }
}
