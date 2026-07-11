import assert from 'node:assert/strict';
import type { Player, PlayerMovementState } from '@voxel-strike/shared';
import { useGameStore } from '../store/gameStore';
import {
  DEV_OFFLINE_TRAINING_HERO_ID_PREFIX,
  applyTutorialOfflineTrainingTrailDamage,
} from './tutorialOfflineCombatRuntime';

function createMovement(): PlayerMovementState {
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

function createPlayer(input: {
  id: string;
  team: 'red' | 'blue';
  position: { x: number; y: number; z: number };
}): Player {
  return {
    id: input.id,
    name: input.id,
    team: input.team,
    heroId: 'blaze',
    state: 'alive',
    isReady: true,
    isBot: input.id.startsWith(DEV_OFFLINE_TRAINING_HERO_ID_PREFIX),
    position: input.position,
    velocity: { x: 0, y: 0, z: 0 },
    lookYaw: 0,
    lookPitch: 0,
    health: 100,
    maxHealth: 100,
    ultimateCharge: 0,
    movement: createMovement(),
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

const originalState = useGameStore.getState();
const originalDateNow = Date.now;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
let now = 10_000;
Date.now = () => now;
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    setInterval: () => 1,
    clearInterval: () => undefined,
  },
});

try {
  const source = createPlayer({ id: 'practice-player', team: 'red', position: { x: 0, y: 0.9, z: 0 } });
  const target = createPlayer({
    id: `${DEV_OFFLINE_TRAINING_HERO_ID_PREFIX}inside`,
    team: 'blue',
    position: { x: 4, y: 0.9, z: 1.25 },
  });
  const outside = createPlayer({
    id: `${DEV_OFFLINE_TRAINING_HERO_ID_PREFIX}outside`,
    team: 'blue',
    position: { x: 4, y: 0.9, z: 1.55 },
  });
  const friendly = createPlayer({
    id: `${DEV_OFFLINE_TRAINING_HERO_ID_PREFIX}friendly`,
    team: 'red',
    position: { x: 4, y: 0.9, z: 0 },
  });
  useGameStore.setState({
    isPracticeMode: true,
    gamePhase: 'playing',
    playerId: source.id,
    localPlayer: source,
    players: new Map([
      [source.id, source],
      [target.id, target],
      [outside.id, outside],
      [friendly.id, friendly],
    ]),
  });

  const trail = {
    points: [
      { position: { x: 0, y: 0, z: 0 } },
      { position: { x: 8, y: 0, z: 0 } },
    ],
    radius: 1.75,
    damage: 6,
    damageType: 'afterburner',
    damageIntervalMs: 600,
    lastDamageTick: new Map<string, number>(),
    sourceId: source.id,
    sourceTeam: source.team,
    abilityId: 'blaze_afterburner',
  };

  assert.equal(applyTutorialOfflineTrainingTrailDamage(trail), 1);
  assert.equal(useGameStore.getState().players.get(target.id)?.health, 94);
  assert.equal(useGameStore.getState().players.get(outside.id)?.health, 100);
  assert.equal(useGameStore.getState().players.get(friendly.id)?.health, 100);

  assert.equal(applyTutorialOfflineTrainingTrailDamage(trail), 0);
  assert.equal(useGameStore.getState().players.get(target.id)?.health, 94);

  now += 600;
  assert.equal(applyTutorialOfflineTrainingTrailDamage(trail), 1);
  assert.equal(useGameStore.getState().players.get(target.id)?.health, 88);

  useGameStore.setState({ isPracticeMode: false });
  now += 600;
  assert.equal(applyTutorialOfflineTrainingTrailDamage(trail), 0);
  assert.equal(useGameStore.getState().players.get(target.id)?.health, 88);
} finally {
  Date.now = originalDateNow;
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow);
  } else {
    delete (globalThis as { window?: unknown }).window;
  }
  useGameStore.setState(originalState, true);
}

console.log('tutorial offline combat runtime tests passed');
