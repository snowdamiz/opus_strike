import assert from 'node:assert/strict';
import { BLAZE_FLAMETHROWER_MAX_FUEL } from '@voxel-strike/shared';
import { Player } from '../rooms/schema/Player';
import { applyPlayerAliveRuntimeReset } from '../rooms/playerRuntime';

function player(heroId: string, options: { bot?: boolean } = {}): Player {
  const result = new Player();
  result.id = `${heroId}-player`;
  result.heroId = heroId;
  result.state = 'dead';
  result.health = 12;
  result.maxHealth = 175;
  result.respawnTime = 5_000;
  result.spawnProtectionUntil = 0;
  result.isBot = Boolean(options.bot);
  result.movement.jetpackFuel = 17;
  return result;
}

{
  const blaze = player('blaze');
  const plan = applyPlayerAliveRuntimeReset(blaze, {
    now: 1_000,
    spawnProtectionMs: 3_000,
    resetRespawnTime: true,
  });

  assert.equal(blaze.state, 'alive');
  assert.equal(blaze.health, blaze.maxHealth);
  assert.equal(blaze.respawnTime, 0);
  assert.equal(blaze.spawnProtectionUntil, 4_000);
  assert.equal(blaze.movement.jetpackFuel, BLAZE_FLAMETHROWER_MAX_FUEL);
  assert.deepEqual(plan, {
    resetAbilityCooldowns: true,
    resetBotBrain: false,
    resetPrimaryMagazine: true,
    clearChronosAegisShield: false,
  });
}

{
  const phantomBot = player('phantom', { bot: true });
  const plan = applyPlayerAliveRuntimeReset(phantomBot, {
    now: 2_000,
    spawnProtectionMs: 750,
  });

  assert.equal(phantomBot.state, 'alive');
  assert.equal(phantomBot.health, phantomBot.maxHealth);
  assert.equal(phantomBot.respawnTime, 5_000);
  assert.equal(phantomBot.spawnProtectionUntil, 2_750);
  assert.deepEqual(plan, {
    resetAbilityCooldowns: true,
    resetBotBrain: true,
    resetPrimaryMagazine: true,
    clearChronosAegisShield: false,
  });
}

{
  const chronos = player('chronos');
  const plan = applyPlayerAliveRuntimeReset(chronos, {
    now: 4_000,
    spawnProtectionMs: 0,
    resetRespawnTime: true,
  });

  assert.equal(chronos.spawnProtectionUntil, 4_000);
  assert.deepEqual(plan, {
    resetAbilityCooldowns: true,
    resetBotBrain: false,
    resetPrimaryMagazine: false,
    clearChronosAegisShield: true,
  });
}

console.log('player runtime tests passed');
