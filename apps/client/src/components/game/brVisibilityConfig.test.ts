import assert from 'node:assert/strict';
import type { BattleRoyalDropPlayerStatus, BattleRoyalDropSnapshot } from '@voxel-strike/shared';
import { getBattleRoyalVisibilityMode } from './battleRoyalVisibilityMode';
import {
  BATTLE_ROYAL_DEPLOYMENT_VISIBILITY_CONFIG,
  BATTLE_ROYAL_VISIBILITY_CONFIG,
  DEFAULT_CAMERA_FAR,
  getVisualQualityConfig,
} from './visualQuality';

const orderedProfiles = ['potato', 'competitive', 'balanced', 'cinematic'] as const;

let previousCameraFar = 0;
let previousCullDistance = 0;
let previousFullLodDistance = 0;

for (const profile of orderedProfiles) {
  const config = BATTLE_ROYAL_VISIBILITY_CONFIG[profile];
  const deploymentConfig = BATTLE_ROYAL_DEPLOYMENT_VISIBILITY_CONFIG[profile];
  assert.equal(config.terrainLodEnabled, true, `${profile} runtime config should enable terrain LOD`);
  assert.ok(config.cameraFar < DEFAULT_CAMERA_FAR, `${profile} should reduce BR camera far plane`);
  assert.ok(config.terrainLodFullDistance < config.terrainCullDistance, `${profile} should use coarse terrain before culling`);
  assert.ok(config.terrainPrebuildFullDistance >= config.terrainLodFullDistance, `${profile} should prebuild at least the runtime full LOD band`);
  assert.ok(config.terrainPrebuildFullDistance <= config.terrainCullDistance, `${profile} should not prebuild full-detail terrain outside cull range`);
  assert.ok(config.terrainCullDistance <= config.terrainLodCoarseDistance, `${profile} cull distance should stay inside coarse LOD range`);
  assert.ok(config.terrainLodCoarseDistance <= config.cameraFar, `${profile} coarse terrain should fade before camera far plane`);
  assert.ok(config.dressingCullDistance <= config.terrainCullDistance, `${profile} dressing should not outlive terrain visibility`);
  assert.ok(config.remoteMovementEffectDistance <= config.terrainCullDistance, `${profile} remote movement effects should stay inside terrain visibility`);
  assert.ok(config.terrainImpactDistance <= config.terrainCullDistance, `${profile} terrain impacts should stay inside terrain visibility`);
  assert.ok(config.fogDensity > 0, `${profile} fog density should be positive`);

  assert.equal(deploymentConfig.terrainLodEnabled, false, `${profile} deployment config should disable terrain LOD`);
  assert.equal(deploymentConfig.cameraFar, DEFAULT_CAMERA_FAR, `${profile} deployment config should restore the default far plane`);
  assert.ok(deploymentConfig.fogDensity < config.fogDensity, `${profile} deployment fog should reveal flyover terrain`);
  assert.ok(deploymentConfig.terrainCullDistance >= DEFAULT_CAMERA_FAR, `${profile} deployment terrain should not be culled by BR runtime range`);
  assert.ok(deploymentConfig.terrainLodFullDistance >= deploymentConfig.terrainCullDistance, `${profile} deployment terrain should stay full detail`);

  assert.ok(config.cameraFar >= previousCameraFar, `${profile} camera far should be monotonic by preset`);
  assert.ok(config.terrainCullDistance >= previousCullDistance, `${profile} cull distance should be monotonic by preset`);
  assert.ok(config.terrainLodFullDistance >= previousFullLodDistance, `${profile} full LOD distance should be monotonic by preset`);

  previousCameraFar = config.cameraFar;
  previousCullDistance = config.terrainCullDistance;
  previousFullLodDistance = config.terrainLodFullDistance;
}

const balanced = getVisualQualityConfig({
  resolutionScale: 'medium',
  antialiasing: true,
  shadowQuality: 'medium',
  reflectionQuality: 'medium',
  environmentQuality: 'medium',
  materialQuality: 'medium',
  graphicsPreset: 'balanced',
});

assert.equal(balanced.battleRoyalVisibility, BATTLE_ROYAL_VISIBILITY_CONFIG.balanced);
assert.equal(balanced.battleRoyalDeploymentVisibility, BATTLE_ROYAL_DEPLOYMENT_VISIBILITY_CONFIG.balanced);
assert.equal(balanced.effects.maxRemoteMovementEffectDistance, Number.POSITIVE_INFINITY);
assert.equal(balanced.effects.maxTerrainImpactRenderDistance, Number.POSITIVE_INFINITY);

function createDrop(status: BattleRoyalDropPlayerStatus, y: number, velocityY: number): BattleRoyalDropSnapshot {
  return {
    enabled: true,
    phaseStartedAt: 0,
    phaseEndsAt: 60_000,
    serverTime: 0,
    ship: {
      start: { x: 0, y: 180, z: 0 },
      end: { x: 100, y: 180, z: 100 },
      position: { x: 0, y: 180, z: 0 },
      altitude: 180,
      startedAt: 0,
      endsAt: 60_000,
      autoDropAt: 40_000,
      dropStartsAt: 5_000,
      dropEndsAt: 45_000,
      canDrop: true,
    },
    players: [{
      playerId: 'local',
      team: 'red',
      status,
      position: { x: 1, y, z: 1 },
      velocity: { x: 0, y: velocityY, z: 0 },
      droppedAt: status === 'aboard' ? null : 1_000,
      landedAt: status === 'landed' ? 2_000 : null,
      attachedToPlayerId: null,
    }],
  };
}

assert.equal(getBattleRoyalVisibilityMode({
  gamePhase: 'countdown',
  drop: createDrop('aboard', 180, 0),
  localPlayerId: 'local',
}), 'deployment');

assert.equal(getBattleRoyalVisibilityMode({
  gamePhase: 'deployment',
  drop: createDrop('dropping', 80, -20),
  localPlayerId: 'local',
}), 'deployment');

assert.equal(getBattleRoyalVisibilityMode({
  gamePhase: 'deployment',
  drop: createDrop('dropping', 10.2, -27),
  localPlayerId: 'local',
}), 'deployment');

assert.equal(getBattleRoyalVisibilityMode({
  gamePhase: 'deployment',
  drop: createDrop('landed', 10, 0),
  localPlayerId: 'local',
}), 'runtime');

console.log('battle royal visibility config tests passed');
