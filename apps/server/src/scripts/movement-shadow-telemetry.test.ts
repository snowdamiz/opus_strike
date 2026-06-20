import assert from 'node:assert/strict';
import {
  buildPlayerMovementSnapshot,
  getMovementShadowClass,
  getMovementShadowFrameRateBand,
  getMovementShadowPingBand,
} from '../rooms/movementShadowTelemetry';

function movement(overrides: Record<string, unknown> = {}) {
  return {
    isGrounded: true,
    isSprinting: false,
    isCrouching: false,
    isSliding: false,
    slideTimeRemaining: 0,
    isWallRunning: false,
    wallRunSide: '',
    isGrappling: false,
    isJetpacking: false,
    jetpackFuel: 0,
    isGliding: false,
    chronosAscendantStartY: 0,
    ...overrides,
  };
}

function player(overrides: Record<string, unknown> = {}) {
  return {
    hasFlag: false,
    heroId: 'phantom',
    movement: movement(),
    ...overrides,
  };
}

{
  assert.deepEqual(
    buildPlayerMovementSnapshot({
      movement: movement({
        isGrounded: false,
        isSprinting: true,
        isCrouching: true,
        isSliding: true,
        slideTimeRemaining: 0.35,
        isWallRunning: true,
        wallRunSide: 'left',
        isGrappling: true,
        isJetpacking: true,
        jetpackFuel: 0.75,
        isGliding: true,
        chronosAscendantStartY: 12,
      }),
    }),
    {
      isGrounded: false,
      isSprinting: true,
      isCrouching: true,
      isSliding: true,
      slideTimeRemaining: 0.35,
      isWallRunning: true,
      wallRunSide: 'left',
      isGrappling: true,
      grapplePoint: null,
      isJetpacking: true,
      jetpackFuel: 0.75,
      isGliding: true,
      chronosAscendantStartY: 12,
    }
  );

  assert.equal(
    buildPlayerMovementSnapshot({ movement: movement({ wallRunSide: 'center' }) }).wallRunSide,
    null
  );
  assert.equal(
    buildPlayerMovementSnapshot({ movement: movement({ chronosAscendantStartY: 0 }) }).chronosAscendantStartY,
    undefined
  );
}

{
  assert.equal(getMovementShadowPingBand(undefined), 'unknown');
  assert.equal(getMovementShadowPingBand(Number.NaN), 'unknown');
  assert.equal(getMovementShadowPingBand(50), '0-50');
  assert.equal(getMovementShadowPingBand(51), '51-100');
  assert.equal(getMovementShadowPingBand(100), '51-100');
  assert.equal(getMovementShadowPingBand(101), '101-180');
  assert.equal(getMovementShadowPingBand(180), '101-180');
  assert.equal(getMovementShadowPingBand(181), '181+');
}

{
  assert.equal(getMovementShadowFrameRateBand({ clientFrameRateBand: '90fps+' }), '90fps+');
  assert.equal(getMovementShadowFrameRateBand({ clientFrameRateBand: '45-90fps' }), '45-90fps');
  assert.equal(getMovementShadowFrameRateBand({ clientFrameRateBand: '30-45fps' }), '30-45fps');
  assert.equal(getMovementShadowFrameRateBand({ clientFrameRateBand: 'sub30fps' }), 'sub30fps');
  assert.equal(getMovementShadowFrameRateBand({ clientFrameRateBand: 'fast' }), 'unknown');
  assert.equal(getMovementShadowFrameRateBand({}), 'unknown');
}

{
  assert.equal(
    getMovementShadowClass(player({
      hasFlag: true,
      movement: movement({ isGrappling: true }),
    }), {}),
    'flag_route'
  );
  assert.equal(getMovementShadowClass(player({ movement: movement({ isGrappling: true }) }), {}), 'grapple');
  assert.equal(getMovementShadowClass(player({ movement: movement({ isSliding: true }) }), { jump: true }), 'slide_jump');
  assert.equal(getMovementShadowClass(player({ movement: movement({ isSliding: true }) }), {}), 'slide');
  assert.equal(getMovementShadowClass(player({ movement: movement({ isGliding: true }) }), {}), 'glide');
  assert.equal(getMovementShadowClass(player({ movement: movement({ isWallRunning: true }) }), {}), 'wallrun');
  assert.equal(getMovementShadowClass(player({ heroId: 'blaze' }), { ability2: true }), 'rocket_jump');
  assert.equal(getMovementShadowClass(player({ heroId: 'phantom' }), { ability1: true }), 'teleport_ability');
  assert.equal(getMovementShadowClass(player({ heroId: 'phantom' }), { ability2: true }), 'teleport_ability');
  assert.equal(getMovementShadowClass(player({ heroId: 'chronos' }), { ability1: true }), 'chronos_lifeline_allies');
  assert.equal(
    getMovementShadowClass(player({ heroId: 'chronos' }), { ability1: true, secondaryFire: true }),
    'chronos_lifeline_self'
  );
  assert.equal(getMovementShadowClass(player({ heroId: 'chronos' }), { ability2: true }), 'chronos_tempo');
  assert.equal(
    getMovementShadowClass(player({ movement: movement({ isGrounded: false }) }), { jump: true }),
    'bhop_air'
  );
  assert.equal(getMovementShadowClass(player(), { crouch: true }), 'crouch');
  assert.equal(getMovementShadowClass(player(), { sprint: true }), 'sprint');
  assert.equal(getMovementShadowClass(player(), { moveForward: true }), 'walk');
  assert.equal(getMovementShadowClass(player(), { moveBackward: true }), 'walk');
  assert.equal(getMovementShadowClass(player(), { moveLeft: true }), 'walk');
  assert.equal(getMovementShadowClass(player(), { moveRight: true }), 'walk');
  assert.equal(getMovementShadowClass(player(), {}), 'idle');
}

console.log('movement shadow telemetry tests passed');
