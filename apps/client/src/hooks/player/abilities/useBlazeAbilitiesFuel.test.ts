import assert from 'node:assert/strict';
import {
  BLAZE_FLAMETHROWER_FUEL_DRAIN,
  BLAZE_FLAMETHROWER_FUEL_REGEN,
  BLAZE_FLAMETHROWER_MAX_FUEL,
} from '@voxel-strike/shared';
import { projectBlazeFlamethrowerFuel } from './useBlazeAbilities';

function testAuthorityFuelWinsWhenItChanges() {
  const result = projectBlazeFlamethrowerFuel({
    currentFuel: 64,
    authoritativeFuel: 72,
    lastAuthoritativeFuel: 64,
    isTryingToFire: false,
    deltaSeconds: 0.1,
    tempoMultiplier: 1,
  });

  assert.equal(result.fuel, 72);
  assert.equal(result.lastAuthoritativeFuel, 72);
}

function testFuelRegeneratesBetweenUnchangedAuthorityUpdates() {
  const result = projectBlazeFlamethrowerFuel({
    currentFuel: 50,
    authoritativeFuel: 50,
    lastAuthoritativeFuel: 50,
    isTryingToFire: false,
    deltaSeconds: 0.1,
    tempoMultiplier: 1,
  });

  assert.equal(result.fuel, 50 + BLAZE_FLAMETHROWER_FUEL_REGEN * 0.1);
  assert.equal(result.lastAuthoritativeFuel, 50);
}

function testFuelDrainsBetweenUnchangedAuthorityUpdatesWhileFiring() {
  const result = projectBlazeFlamethrowerFuel({
    currentFuel: 50,
    authoritativeFuel: 50,
    lastAuthoritativeFuel: 50,
    isTryingToFire: true,
    deltaSeconds: 0.1,
    tempoMultiplier: 1,
  });

  assert.equal(result.fuel, 50 - BLAZE_FLAMETHROWER_FUEL_DRAIN * 0.1);
  assert.equal(result.lastAuthoritativeFuel, 50);
}

function testProjectedFuelClampsToMax() {
  const result = projectBlazeFlamethrowerFuel({
    currentFuel: BLAZE_FLAMETHROWER_MAX_FUEL - 1,
    authoritativeFuel: BLAZE_FLAMETHROWER_MAX_FUEL - 1,
    lastAuthoritativeFuel: BLAZE_FLAMETHROWER_MAX_FUEL - 1,
    isTryingToFire: false,
    deltaSeconds: 1,
    tempoMultiplier: 1,
  });

  assert.equal(result.fuel, BLAZE_FLAMETHROWER_MAX_FUEL);
}

testAuthorityFuelWinsWhenItChanges();
testFuelRegeneratesBetweenUnchangedAuthorityUpdates();
testFuelDrainsBetweenUnchangedAuthorityUpdatesWhileFiring();
testProjectedFuelClampsToMax();

console.log('Blaze fuel projection tests passed');
