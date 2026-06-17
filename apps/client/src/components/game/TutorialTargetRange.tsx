import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  TUTORIAL_TARGET_STAND_POSITION,
  createDefaultPlayerMovementState,
  getHeroStats,
  type HeroId,
  type Player,
  type PlayerMovementState,
  type PlayerStats,
  type Vec3,
} from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import { setPlayerVisualTransform } from '../../store/visualStore';
import {
  TUTORIAL_OFFLINE_TRAINING_HERO_ID_PREFIX,
  updateTutorialOfflineTrainingDamageOverTime,
} from '../../utils/tutorialOfflineCombatRuntime';

type TrainingBehavior = 'run' | 'strafe' | 'crouch' | 'slide' | 'hop';

interface TrainingHeroDefinition {
  id: string;
  name: string;
  heroId: HeroId;
  base: Vec3;
  rangeX: number;
  rangeZ: number;
  walkSpeed: number;
  runSpeed: number;
}

interface TrainingHeroRuntime {
  target: Vec3;
  behavior: TrainingBehavior;
  nextRetargetAtMs: number;
  behaviorStartedAtMs: number;
}

const TRAINING_UPDATE_INTERVAL_SECONDS = 0.08;
const TRAINING_BASE_Y = TUTORIAL_TARGET_STAND_POSITION.y;
const TRAINING_AREA_MIN_X = -5.2;
const TRAINING_AREA_MAX_X = 5.2;
const TRAINING_AREA_MIN_Z = TUTORIAL_TARGET_STAND_POSITION.z - 2.7;
const TRAINING_AREA_MAX_Z = TUTORIAL_TARGET_STAND_POSITION.z + 4.2;
const TRAINING_HEROES: readonly TrainingHeroDefinition[] = [
  {
    id: `${TUTORIAL_OFFLINE_TRAINING_HERO_ID_PREFIX}phantom`,
    name: 'Training Phantom',
    heroId: 'phantom',
    base: { x: -1.1, y: TRAINING_BASE_Y, z: TUTORIAL_TARGET_STAND_POSITION.z + 0.6 },
    rangeX: 5.2,
    rangeZ: 4.2,
    walkSpeed: 2.4,
    runSpeed: 4.9,
  },
  {
    id: `${TUTORIAL_OFFLINE_TRAINING_HERO_ID_PREFIX}hookshot`,
    name: 'Training Hookshot',
    heroId: 'hookshot',
    base: { x: 1.1, y: TRAINING_BASE_Y, z: TUTORIAL_TARGET_STAND_POSITION.z + 1.9 },
    rangeX: 5.2,
    rangeZ: 4.2,
    walkSpeed: 2.25,
    runSpeed: 4.55,
  },
] as const;

function createDefaultStats(): PlayerStats {
  return {
    kills: 0,
    deaths: 0,
    assists: 0,
    flagCaptures: 0,
    flagReturns: 0,
  };
}

function createTrainingHero(definition: TrainingHeroDefinition, now: number): Player {
  const heroStats = getHeroStats(definition.heroId);

  return {
    id: definition.id,
    name: definition.name,
    team: 'blue',
    heroId: definition.heroId,
    state: 'alive',
    isReady: true,
    isBot: true,
    botDifficulty: 'easy',
    botProfileId: 'tutorial_training',
    position: { ...definition.base },
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomTrainingTarget(definition: TrainingHeroDefinition): Vec3 {
  return {
    x: clamp(
      definition.base.x + randomBetween(-definition.rangeX, definition.rangeX),
      TRAINING_AREA_MIN_X,
      TRAINING_AREA_MAX_X
    ),
    y: definition.base.y,
    z: clamp(
      definition.base.z + randomBetween(-definition.rangeZ, definition.rangeZ),
      TRAINING_AREA_MIN_Z,
      TRAINING_AREA_MAX_Z
    ),
  };
}

function randomTrainingBehavior(): TrainingBehavior {
  const roll = Math.random();
  if (roll < 0.24) return 'run';
  if (roll < 0.42) return 'strafe';
  if (roll < 0.58) return 'crouch';
  if (roll < 0.73) return 'slide';
  return 'hop';
}

function createTrainingRuntime(definition: TrainingHeroDefinition, now: number): TrainingHeroRuntime {
  return {
    target: randomTrainingTarget(definition),
    behavior: randomTrainingBehavior(),
    nextRetargetAtMs: now + randomBetween(900, 1750),
    behaviorStartedAtMs: now,
  };
}

function refreshTrainingRuntime(definition: TrainingHeroDefinition, runtime: TrainingHeroRuntime, now: number): void {
  runtime.target = randomTrainingTarget(definition);
  runtime.behavior = randomTrainingBehavior();
  runtime.nextRetargetAtMs = now + randomBetween(900, 1750);
  runtime.behaviorStartedAtMs = now;
}

function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function getBehaviorSpeed(definition: TrainingHeroDefinition, behavior: TrainingBehavior): number {
  switch (behavior) {
    case 'crouch':
      return definition.walkSpeed * 0.58;
    case 'slide':
      return definition.runSpeed * 1.22;
    case 'hop':
    case 'run':
      return definition.runSpeed;
    case 'strafe':
    default:
      return definition.walkSpeed;
  }
}

function getBehaviorLift(runtime: TrainingHeroRuntime, now: number): number {
  const elapsedSeconds = (now - runtime.behaviorStartedAtMs) / 1000;
  if (runtime.behavior === 'hop') {
    const t = Math.min(1, elapsedSeconds / 0.68);
    return Math.sin(t * Math.PI) * 0.72;
  }
  return 0;
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
  behavior: TrainingBehavior,
  y: number,
  baseY: number
): PlayerMovementState {
  const isGrounded = Math.abs(y - baseY) < 0.08;
  const isSliding = isGrounded && behavior === 'slide';
  const isCrouching = isGrounded && !isSliding && behavior === 'crouch';

  return createDefaultPlayerMovementState({
    isGrounded,
    isSprinting: isGrounded && !isCrouching && !isSliding && (behavior === 'run' || behavior === 'hop'),
    isCrouching,
    isSliding,
    slideTimeRemaining: isSliding ? 0.2 : 0,
  });
}

function TutorialTrainingHeroes() {
  const updateAccumulatorRef = useRef(0);
  const runtimesRef = useRef(new Map<string, TrainingHeroRuntime>());

  useEffect(() => {
    const store = useGameStore.getState();
    const now = Date.now();
    for (const definition of TRAINING_HEROES) {
      runtimesRef.current.set(definition.id, createTrainingRuntime(definition, now));
      store.updatePlayer(definition.id, createTrainingHero(definition, now));
      setPlayerVisualTransform(definition.id, definition.base, Math.PI);
    }

    return () => {
      const cleanupStore = useGameStore.getState();
      for (const definition of TRAINING_HEROES) {
        cleanupStore.removePlayer(definition.id);
      }
      runtimesRef.current.clear();
    };
  }, []);

  useFrame((_, delta) => {
    updateAccumulatorRef.current += delta;
    if (updateAccumulatorRef.current < TRAINING_UPDATE_INTERVAL_SECONDS) return;

    const updateDelta = updateAccumulatorRef.current;
    updateAccumulatorRef.current = 0;
    const store = useGameStore.getState();
    const now = Date.now();
    updateTutorialOfflineTrainingDamageOverTime(now);

    for (const definition of TRAINING_HEROES) {
      const current = store.players.get(definition.id);
      if (!current) continue;

      let runtime = runtimesRef.current.get(definition.id);
      if (!runtime) {
        runtime = createTrainingRuntime(definition, now);
        runtimesRef.current.set(definition.id, runtime);
      }

      if (current.state === 'dead') {
        if (current.respawnTime && current.respawnTime <= now) {
          const respawned = createTrainingHero(definition, now);
          runtimesRef.current.set(definition.id, createTrainingRuntime(definition, now));
          store.updatePlayer(definition.id, respawned);
          setPlayerVisualTransform(definition.id, respawned.position, respawned.lookYaw);
        }
        continue;
      }

      if (now >= runtime.nextRetargetAtMs || horizontalDistance(current.position, runtime.target) <= 0.28) {
        refreshTrainingRuntime(definition, runtime, now);
      }

      const nextHorizontal = moveToward(
        current.position,
        runtime.target,
        getBehaviorSpeed(definition, runtime.behavior) * updateDelta
      );
      const nextPosition = {
        ...nextHorizontal,
        y: definition.base.y + getBehaviorLift(runtime, now),
      };
      const velocity = {
        x: (nextPosition.x - current.position.x) / updateDelta,
        y: (nextPosition.y - current.position.y) / updateDelta,
        z: (nextPosition.z - current.position.z) / updateDelta,
      };
      const lookYaw = lookYawFromVelocity(velocity, current.lookYaw);

      store.updatePlayer(definition.id, {
        ...current,
        position: nextPosition,
        velocity,
        lookYaw,
        movement: sampleMovementState(runtime.behavior, nextPosition.y, definition.base.y),
        visibility: 'visible',
      });
    }
  });

  return null;
}

export function TutorialTargetRange() {
  const isTutorialMode = useGameStore((state) => state.isTutorialMode);
  const gamePhase = useGameStore((state) => state.gamePhase);

  if (!isTutorialMode || gamePhase !== 'playing') return null;

  return (
    <group name="tutorial-target-practice-range">
      <TutorialTrainingHeroes />
    </group>
  );
}
