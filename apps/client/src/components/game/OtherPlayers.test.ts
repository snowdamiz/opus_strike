import assert from 'node:assert/strict';
import type { HeroId, Player, Team } from '@voxel-strike/shared';
import {
  getRemoteStatusPlateMode,
  isEnemyRemotePlayer,
  shouldShowRemoteNameplate,
} from './OtherPlayers';
import type { RemotePlayerQualityConfig } from './visualQuality';

const NAMEPLATES_DISABLED_CONFIG: RemotePlayerQualityConfig = {
  showNameplates: false,
  nameplateDistance: 0,
  fullBodyDistance: 36,
  outlineDistance: 0,
  botFullBodyDistanceScale: 1,
  botOutlineDistanceScale: 1,
  castShadows: false,
};

const NAMEPLATES_ENABLED_CONFIG: RemotePlayerQualityConfig = {
  showNameplates: true,
  nameplateDistance: 56,
  fullBodyDistance: 52,
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
  position = vec3(0, 1, 0),
  state = 'alive',
  downedHealth = null,
  downedMaxHealth = null,
}: {
  id: string;
  team: Team;
  heroId?: HeroId;
  position?: { x: number; y: number; z: number };
  state?: Player['state'];
  downedHealth?: number | null;
  downedMaxHealth?: number | null;
}): Player {
  return {
    id,
    name: id,
    team,
    heroId,
    state,
    isReady: true,
    isBot: false,
    position,
    velocity: vec3(0, 0, 0),
    lookYaw: 0,
    lookPitch: 0,
    health: 72,
    maxHealth: 100,
    downedHealth,
    downedMaxHealth,
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
    visibility: 'visible',
  };
}

const localTeam = 'red';
const anchorPosition = vec3(0, 1, 0);
const enemy = makePlayer({ id: 'enemy', team: 'blue' });
const teammate = makePlayer({ id: 'teammate', team: localTeam });

assert.equal(isEnemyRemotePlayer(enemy, localTeam), true);
assert.equal(isEnemyRemotePlayer(teammate, localTeam), false);
assert.equal(isEnemyRemotePlayer(enemy, null), false);

assert.equal(
  getRemoteStatusPlateMode(enemy, NAMEPLATES_DISABLED_CONFIG, false, localTeam, anchorPosition),
  'enemyHealth',
  'enemies should keep a health plate when full nameplates are disabled'
);

assert.equal(
  getRemoteStatusPlateMode(
    makePlayer({ id: 'far-enemy', team: 'blue', position: vec3(200, 1, 0) }),
    NAMEPLATES_ENABLED_CONFIG,
    false,
    localTeam,
    anchorPosition
  ),
  'enemyHealth',
  'enemies should keep a health plate past the full nameplate distance'
);

assert.equal(
  getRemoteStatusPlateMode(enemy, NAMEPLATES_DISABLED_CONFIG, true, localTeam, anchorPosition),
  'enemyHealth',
  'battle royale enemies should show health without requiring teammate nameplates'
);

assert.equal(
  getRemoteStatusPlateMode(
    makePlayer({
      id: 'downed-enemy',
      team: 'blue',
      state: 'downed',
      downedHealth: 220,
      downedMaxHealth: 250,
    }),
    NAMEPLATES_DISABLED_CONFIG,
    true,
    localTeam,
    anchorPosition
  ),
  'enemyDowned',
  'battle royale downed enemies should show the DOWNED status plate'
);

assert.equal(
  getRemoteStatusPlateMode(
    makePlayer({ id: 'non-br-downed-enemy', team: 'blue', state: 'downed' }),
    NAMEPLATES_DISABLED_CONFIG,
    false,
    localTeam,
    anchorPosition
  ),
  'enemyHealth',
  'non-battle royale downed enemies should keep the normal enemy health plate'
);

assert.equal(
  getRemoteStatusPlateMode(enemy, NAMEPLATES_ENABLED_CONFIG, false, localTeam, anchorPosition),
  'full',
  'normal full nameplates should still render when enabled and in range'
);

assert.equal(
  getRemoteStatusPlateMode(teammate, NAMEPLATES_DISABLED_CONFIG, true, localTeam, anchorPosition),
  'fullTeam',
  'battle royale teammates should get a team-tagged full nameplate even when normal nameplates are disabled'
);

assert.equal(
  getRemoteStatusPlateMode(teammate, NAMEPLATES_DISABLED_CONFIG, false, localTeam, anchorPosition),
  null,
  'disabled nameplates should stay disabled for teammates'
);

assert.equal(
  shouldShowRemoteNameplate(teammate, NAMEPLATES_ENABLED_CONFIG, true, localTeam, anchorPosition),
  true,
  'battle royale teammate nameplate behavior should be preserved'
);

console.log('other players status plate tests passed');
