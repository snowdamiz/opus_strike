import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  DEV_TESTING_MAP_PROFILE_ID,
  createDefaultPlayerMovementState,
  getDevTestingHeroLineup,
  getDevTestingTargetBotArea,
  getDevTestingTargetBotSpawn,
  getDefaultHeroSkinId,
  getHeroStats,
  type DevTestingTargetBotArea,
  type Player,
  type PlayerMovementState,
  type PlayerStats,
  type Vec3,
  type VoxelMapManifest,
} from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import { setPlayerVisualTransform } from '../../store/visualStore';
import { DEV_OFFLINE_TRAINING_HERO_ID_PREFIX, updateTutorialOfflineTrainingDamageOverTime } from '../../utils/tutorialOfflineCombatRuntime';
import { getPreparedVoxelMap, prepareVoxelMapCpu } from '../../utils/mapWarmup/mapPrepCache';
import { HeroVoxelBody } from './HeroVoxelBody';
import { getPlayerFeetY, getPlayerHeight } from './playerWorldAnchors';

const DEV_TARGET_BOT_ID = `${DEV_OFFLINE_TRAINING_HERO_ID_PREFIX}target`;
const DEV_TARGET_UPDATE_INTERVAL_SECONDS = 0.08;
const DEV_TARGET_WALK_SPEED = 2.6;
const DEV_TARGET_RUN_SPEED = 5.1;

type DevTargetBehavior = 'run' | 'strafe' | 'slide' | 'hop';

interface DevTargetRuntime {
  target: Vec3;
  behavior: DevTargetBehavior;
  nextRetargetAtMs: number;
  behaviorStartedAtMs: number;
}

function createDefaultStats(): PlayerStats {
  return {
    kills: 0,
    deaths: 0,
    assists: 0,
    flagCaptures: 0,
    flagReturns: 0,
  };
}

function createDevTargetBot(now: number, spawn: Vec3): Player {
  const heroId = 'phantom';
  const heroStats = getHeroStats(heroId);

  return {
    id: DEV_TARGET_BOT_ID,
    name: 'Dev Target Bot',
    team: 'blue',
    heroId,
    skinId: getDefaultHeroSkinId(heroId),
    state: 'alive',
    isReady: true,
    isBot: true,
    botDifficulty: 'easy',
    botProfileId: 'dev_testing_target',
    position: { ...spawn },
    velocity: { x: 0, y: 0, z: 0 },
    lookYaw: Math.PI,
    lookPitch: 0,
    health: heroStats.maxHealth,
    maxHealth: heroStats.maxHealth,
    ultimateCharge: 0,
    onFireUntil: null,
    powerupBoostUntil: null,
    movement: createDefaultPlayerMovementState(),
    abilities: {},
    hasFlag: false,
    respawnTime: null,
    spawnProtectionUntil: now + 300,
    stats: createDefaultStats(),
    visibility: 'visible',
  };
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomTarget(area: DevTestingTargetBotArea): Vec3 {
  const radius = Math.sqrt(Math.random());
  const angle = Math.random() * Math.PI * 2;
  const halfExtentX = (area.maxX - area.minX) / 2;
  const halfExtentZ = (area.maxZ - area.minZ) / 2;

  return {
    x: area.center.x + Math.cos(angle) * halfExtentX * radius,
    y: area.center.y,
    z: area.center.z + Math.sin(angle) * halfExtentZ * radius,
  };
}

function randomBehavior(): DevTargetBehavior {
  const roll = Math.random();
  if (roll < 0.34) return 'run';
  if (roll < 0.58) return 'strafe';
  if (roll < 0.78) return 'slide';
  return 'hop';
}

function createRuntime(now: number, area: DevTestingTargetBotArea): DevTargetRuntime {
  return {
    target: randomTarget(area),
    behavior: randomBehavior(),
    nextRetargetAtMs: now + randomBetween(850, 1700),
    behaviorStartedAtMs: now,
  };
}

function refreshRuntime(runtime: DevTargetRuntime, now: number, area: DevTestingTargetBotArea): void {
  runtime.target = randomTarget(area);
  runtime.behavior = randomBehavior();
  runtime.nextRetargetAtMs = now + randomBetween(850, 1700);
  runtime.behaviorStartedAtMs = now;
}

function createStationaryRuntime(now: number, spawn: Vec3): DevTargetRuntime {
  return {
    target: { ...spawn },
    behavior: 'strafe',
    nextRetargetAtMs: Number.POSITIVE_INFINITY,
    behaviorStartedAtMs: now,
  };
}

function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function getBehaviorSpeed(behavior: DevTargetBehavior): number {
  switch (behavior) {
    case 'slide':
      return DEV_TARGET_RUN_SPEED * 1.2;
    case 'hop':
    case 'run':
      return DEV_TARGET_RUN_SPEED;
    case 'strafe':
    default:
      return DEV_TARGET_WALK_SPEED;
  }
}

function getBehaviorLift(runtime: DevTargetRuntime, now: number): number {
  if (runtime.behavior !== 'hop') return 0;
  const elapsedSeconds = (now - runtime.behaviorStartedAtMs) / 1000;
  const t = Math.min(1, elapsedSeconds / 0.68);
  return Math.sin(t * Math.PI) * 0.72;
}

function moveToward(current: Vec3, target: Vec3, maxStep: number): Vec3 {
  const dx = target.x - current.x;
  const dz = target.z - current.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= 0.001 || distance <= maxStep) {
    return { x: target.x, y: current.y, z: target.z };
  }

  const scale = maxStep / distance;
  return {
    x: current.x + dx * scale,
    y: current.y,
    z: current.z + dz * scale,
  };
}

function lookYawFromVelocity(velocity: Vec3, fallback: number): number {
  const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
  if (horizontalSpeed <= 0.04) return fallback;
  return Math.atan2(-velocity.x, -velocity.z);
}

function sampleMovementState(
  behavior: DevTargetBehavior,
  y: number,
  baseY: number
): PlayerMovementState {
  const isGrounded = Math.abs(y - baseY) < 0.08;
  const isSliding = isGrounded && behavior === 'slide';

  return createDefaultPlayerMovementState({
    isGrounded,
    isSprinting: isGrounded && !isSliding && (behavior === 'run' || behavior === 'hop'),
    isSliding,
    slideTimeRemaining: isSliding ? 0.2 : 0,
  });
}

function createStationaryMovementState(): PlayerMovementState {
  return createDefaultPlayerMovementState({
    isGrounded: true,
    isSprinting: false,
    isSliding: false,
    slideTimeRemaining: 0,
  });
}

function resetTargetBotToCenter(now: number, spawn: Vec3): Player {
  return {
    ...createDevTargetBot(now, spawn),
    movement: createStationaryMovementState(),
  };
}

function isTargetBotStationaryAtCenter(player: Player, spawn: Vec3): boolean {
  const speed = Math.hypot(player.velocity.x, player.velocity.y, player.velocity.z);
  return (
    horizontalDistance(player.position, spawn) <= 0.01 &&
    Math.abs(player.position.y - spawn.y) <= 0.01 &&
    speed <= 0.01 &&
    player.movement.isGrounded &&
    !player.movement.isSprinting &&
    !player.movement.isSliding
  );
}

function DevTestingHeroLineup({ manifest }: { manifest: VoxelMapManifest }) {
  const heroLineup = getDevTestingHeroLineup(manifest);

  return (
    <group name="dev-testing-hero-lineup">
      {heroLineup.map((entry) => {
        const height = getPlayerHeight(entry.heroId);
        return (
          <group
            key={entry.heroId}
            position={[entry.position.x, getPlayerFeetY(entry.position.y), entry.position.z]}
            rotation={[0, entry.yaw, 0]}
          >
            <HeroVoxelBody
              heroId={entry.heroId}
              skinId={getDefaultHeroSkinId(entry.heroId)}
              team="red"
              height={height}
              idleIntensity={0}
              isMoving={false}
              showTeamAccents
              showOutline
              castShadow
            />
          </group>
        );
      })}
    </group>
  );
}

function DevTestingTargetBot({ manifest }: { manifest: VoxelMapManifest }) {
  const spawn = useMemo(() => getDevTestingTargetBotSpawn(manifest), [manifest]);
  const area = useMemo(() => getDevTestingTargetBotArea(manifest), [manifest]);
  const isFrozen = useGameStore((state) => state.devTestingTargetBotFrozen);
  const resetRequestId = useGameStore((state) => state.devTestingTargetBotResetRequestId);
  const updateAccumulatorRef = useRef(0);
  const runtimeRef = useRef<DevTargetRuntime | null>(null);
  const lastResetRequestIdRef = useRef(resetRequestId);

  useEffect(() => {
    const store = useGameStore.getState();
    const now = Date.now();
    const bot = createDevTargetBot(now, spawn);
    runtimeRef.current = createRuntime(now, area);
    store.updatePlayer(bot.id, bot);
    setPlayerVisualTransform(bot.id, bot.position, bot.lookYaw, bot.lookPitch);

    return () => {
      useGameStore.getState().removePlayer(DEV_TARGET_BOT_ID);
      runtimeRef.current = null;
    };
  }, [area, spawn]);

  useEffect(() => {
    if (resetRequestId === 0 || resetRequestId === lastResetRequestIdRef.current) return;

    lastResetRequestIdRef.current = resetRequestId;
    updateAccumulatorRef.current = 0;
    const now = Date.now();
    const bot = resetTargetBotToCenter(now, spawn);
    runtimeRef.current = createStationaryRuntime(now, spawn);
    useGameStore.getState().updatePlayer(bot.id, bot);
    setPlayerVisualTransform(bot.id, bot.position, bot.lookYaw, bot.lookPitch);
  }, [resetRequestId, spawn]);

  useFrame((_, delta) => {
    updateAccumulatorRef.current += delta;
    if (updateAccumulatorRef.current < DEV_TARGET_UPDATE_INTERVAL_SECONDS) return;

    const updateDelta = updateAccumulatorRef.current;
    updateAccumulatorRef.current = 0;
    const store = useGameStore.getState();
    const now = Date.now();
    updateTutorialOfflineTrainingDamageOverTime(now);

    const current = store.players.get(DEV_TARGET_BOT_ID);
    if (!current) return;

    if (isFrozen) {
      if (runtimeRef.current?.nextRetargetAtMs !== Number.POSITIVE_INFINITY) {
        runtimeRef.current = createStationaryRuntime(now, spawn);
      }

      if (current.state === 'dead') {
        if (current.respawnTime && current.respawnTime <= now) {
          const respawned = resetTargetBotToCenter(now, spawn);
          store.updatePlayer(respawned.id, respawned);
          setPlayerVisualTransform(respawned.id, respawned.position, respawned.lookYaw, respawned.lookPitch);
        }
        return;
      }

      if (!isTargetBotStationaryAtCenter(current, spawn)) {
        const stationary = {
          ...current,
          position: { ...spawn },
          velocity: { x: 0, y: 0, z: 0 },
          movement: createStationaryMovementState(),
          visibility: 'visible' as const,
        };
        store.updatePlayer(DEV_TARGET_BOT_ID, stationary);
        setPlayerVisualTransform(stationary.id, stationary.position, stationary.lookYaw, stationary.lookPitch);
      }
      return;
    }

    let runtime = runtimeRef.current;
    if (!runtime) {
      runtime = createRuntime(now, area);
      runtimeRef.current = runtime;
    }

    if (current.state === 'dead') {
      if (current.respawnTime && current.respawnTime <= now) {
        const respawned = createDevTargetBot(now, spawn);
        runtimeRef.current = createRuntime(now, area);
        store.updatePlayer(respawned.id, respawned);
        setPlayerVisualTransform(respawned.id, respawned.position, respawned.lookYaw, respawned.lookPitch);
      }
      return;
    }

    if (now >= runtime.nextRetargetAtMs || horizontalDistance(current.position, runtime.target) <= 0.3) {
      refreshRuntime(runtime, now, area);
    }

    const nextHorizontal = moveToward(
      current.position,
      runtime.target,
      getBehaviorSpeed(runtime.behavior) * updateDelta
    );
    const nextPosition = {
      ...nextHorizontal,
      y: spawn.y + getBehaviorLift(runtime, now),
    };
    const velocity = {
      x: (nextPosition.x - current.position.x) / updateDelta,
      y: (nextPosition.y - current.position.y) / updateDelta,
      z: (nextPosition.z - current.position.z) / updateDelta,
    };
    const lookYaw = lookYawFromVelocity(velocity, current.lookYaw);

    store.updatePlayer(DEV_TARGET_BOT_ID, {
      ...current,
      position: nextPosition,
      velocity,
      lookYaw,
      movement: sampleMovementState(runtime.behavior, nextPosition.y, spawn.y),
      visibility: 'visible',
    });
  });

  return null;
}

export function DevTestingMapRuntime() {
  const isPracticeMode = useGameStore((state) => state.isPracticeMode);
  const mapSeed = useGameStore((state) => state.mapSeed);
  const mapThemeId = useGameStore((state) => state.mapThemeId);
  const mapSize = useGameStore((state) => state.mapSize);
  const mapProfileId = useGameStore((state) => state.mapProfileId);
  const gamePhase = useGameStore((state) => state.gamePhase);
  const manifest = useMemo(() => {
    if (mapProfileId !== DEV_TESTING_MAP_PROFILE_ID) return null;
    return (
      getPreparedVoxelMap({ seed: mapSeed, themeId: mapThemeId, mapSize, mapProfileId })?.manifest
      ?? prepareVoxelMapCpu({ seed: mapSeed, themeId: mapThemeId, mapSize, mapProfileId, source: 'match' }).manifest
    );
  }, [mapProfileId, mapSeed, mapSize, mapThemeId]);

  if (!isPracticeMode || mapProfileId !== DEV_TESTING_MAP_PROFILE_ID || gamePhase !== 'playing' || !manifest) {
    return null;
  }

  return (
    <group name="dev-testing-map-runtime">
      <DevTestingHeroLineup manifest={manifest} />
      <DevTestingTargetBot manifest={manifest} />
    </group>
  );
}
