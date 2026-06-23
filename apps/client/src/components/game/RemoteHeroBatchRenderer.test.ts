import assert from 'node:assert/strict';
import type { HeroId, Player, Team } from '@voxel-strike/shared';
import { clearVisualState } from '../../store/visualStore';
import {
  createRemoteHeroBatchBenchmarkRunner,
} from './RemoteHeroBatchRenderer';
import type { RemotePlayerQualityConfig } from './visualQuality';

const OUTLINES_DISABLED_CONFIG: RemotePlayerQualityConfig = {
  showNameplates: false,
  fullBodyDistance: 1,
  outlineDistance: 0,
  botFullBodyDistanceScale: 1,
  botOutlineDistanceScale: 1,
  castShadows: false,
};

function vec3(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return { x, y, z };
}

function makePlayer({
  id,
  team,
  heroId = 'phantom',
  position,
  visibility = 'visible',
}: {
  id: string;
  team: Team;
  heroId?: HeroId;
  position: { x: number; y: number; z: number };
  visibility?: Player['visibility'];
}): Player {
  return {
    id,
    name: id,
    team,
    heroId,
    state: 'alive',
    isReady: true,
    isBot: true,
    position,
    velocity: vec3(0, 0, 0),
    lookYaw: 0,
    lookPitch: 0,
    health: 100,
    maxHealth: 100,
    ultimateCharge: 0,
    movement: {
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
    visibility,
  };
}

function runSinglePlayerFrame(player: Player, localPlayerTeam: Team) {
  clearVisualState();
  const runner = createRemoteHeroBatchBenchmarkRunner({
    players: [player],
    resourcePlayers: [player],
    isBattleRoyal: false,
    localPlayerId: 'local-player',
    localPlayerTeam,
    config: OUTLINES_DISABLED_CONFIG,
    cameraPosition: vec3(0, 1, 0),
  });

  try {
    return runner.runFrame({
      deltaSeconds: 1 / 60,
      elapsedSeconds: 1,
      nowMs: 1000,
      cameraPosition: vec3(0, 1, 0),
    });
  } finally {
    runner.dispose();
  }
}

function runMultiPlayerFrame(players: readonly Player[], localPlayerTeam: Team) {
  clearVisualState();
  const runner = createRemoteHeroBatchBenchmarkRunner({
    players,
    resourcePlayers: players,
    isBattleRoyal: false,
    localPlayerId: 'local-player',
    localPlayerTeam,
    config: OUTLINES_DISABLED_CONFIG,
    cameraPosition: vec3(0, 1, 0),
  });

  try {
    return runner.runFrame({
      deltaSeconds: 1 / 60,
      elapsedSeconds: 1,
      nowMs: 1000,
      cameraPosition: vec3(0, 1, 0),
    });
  } finally {
    runner.dispose();
  }
}

const farTeammate = makePlayer({
  id: 'far-teammate',
  team: 'red',
  heroId: 'hookshot',
  position: vec3(48, 1, 0),
});
const teammateStats = runSinglePlayerFrame(farTeammate, 'red');
assert.equal(teammateStats.bodyPlayers, 0, 'far teammate body should remain LOD culled');
assert.equal(teammateStats.outlinePlayers, 1, 'far teammate should still render a team-color outline');
assert.equal(teammateStats.normalMatrixWrites, 0, 'outline path should not force full body matrices');
assert.ok(teammateStats.outlineMatrixWrites > 0, 'teammate outline should write outline matrices');
assert.ok(teammateStats.outlineBatches > 0, 'teammate outline should mount outline batches with outlines disabled');

const hiddenNearbyTeammate = makePlayer({
  id: 'hidden-nearby-teammate',
  team: 'red',
  position: vec3(0.25, 1, 0),
  visibility: 'hidden',
});
const hiddenTeammateStats = runSinglePlayerFrame(hiddenNearbyTeammate, 'red');
assert.equal(hiddenTeammateStats.bodyPlayers, 0, 'hidden teammate body should stay suppressed');
assert.equal(hiddenTeammateStats.outlinePlayers, 0, 'hidden teammate should not render an outline');
assert.equal(hiddenTeammateStats.outlineMatrixWrites, 0, 'hidden teammate should not write outline matrices');

const farEnemy = makePlayer({
  id: 'far-enemy',
  team: 'blue',
  heroId: 'blaze',
  position: vec3(48, 1, 0),
});
const enemyStats = runSinglePlayerFrame(farEnemy, 'red');
assert.equal(enemyStats.bodyPlayers, 0, 'far enemy body should remain LOD culled');
assert.equal(enemyStats.outlinePlayers, 1, 'visible enemy should render its own team-color outline');
assert.ok(enemyStats.outlineMatrixWrites > 0, 'visible enemy outline should write outline matrices');
assert.ok(enemyStats.outlineBatches > 0, 'visible enemy should mount outline batches with generic outlines disabled');

const hiddenEnemy = makePlayer({
  id: 'hidden-enemy',
  team: 'blue',
  position: vec3(0.25, 1, 0),
  visibility: 'hidden',
});
const hiddenEnemyStats = runSinglePlayerFrame(hiddenEnemy, 'red');
assert.equal(hiddenEnemyStats.bodyPlayers, 0, 'hidden enemy body should stay suppressed');
assert.equal(hiddenEnemyStats.outlinePlayers, 0, 'hidden enemy should not render an outline');
assert.equal(hiddenEnemyStats.outlineMatrixWrites, 0, 'hidden enemy should not write outline matrices');

const mixedTeamStats = runMultiPlayerFrame([
  makePlayer({
    id: 'red-hookshot',
    team: 'red',
    heroId: 'hookshot',
    position: vec3(48, 1, 0),
  }),
  makePlayer({
    id: 'blue-hookshot',
    team: 'blue',
    heroId: 'hookshot',
    position: vec3(50, 1, 0),
  }),
], 'red');
assert.equal(mixedTeamStats.groups, 2, 'same-hero players on different teams should keep team-keyed outline materials');
assert.equal(mixedTeamStats.bodyPlayers, 0, 'mixed team far bodies should remain LOD culled');
assert.equal(mixedTeamStats.outlinePlayers, 2, 'mixed team players should both render team-color silhouettes');

console.log('remote hero batch renderer tests passed');
