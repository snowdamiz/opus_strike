import assert from 'node:assert/strict';
import { RoomAbilityIdGenerator } from '../rooms/roomAbilityIds';

{
  const ids = new RoomAbilityIdGenerator();

  assert.equal(ids.nextSharedCastId('player-a', 'phantom_dire_ball'), 'phantom_dire_ball_player-a_0');
  assert.equal(ids.nextSharedCastId('player-b', 'chronos_lifeline_conduit'), 'chronos_lifeline_conduit_player-b_1');
  assert.equal(ids.nextSharedCastId('player-a', 'hookshot_grapple'), 'hookshot_grapple_player-a_2');
}

{
  const ids = new RoomAbilityIdGenerator();

  assert.equal(ids.nextBlazeRocketCastId('blaze-a'), 'blaze_rocket_blaze-a_0');
  assert.equal(ids.nextBlazeRocketCastId('blaze-a'), 'blaze_rocket_blaze-a_1');
  assert.equal(ids.nextBlazeBombCastId('blaze-a'), 'blaze_bomb_blaze-a_0');
  assert.equal(ids.nextBlazeBombCastId('blaze-b'), 'blaze_bomb_blaze-b_1');
}

{
  const ids = new RoomAbilityIdGenerator();

  assert.equal(ids.nextBlazeGearstormId('blaze-a'), 'blaze_gearstorm_blaze-a_0');
  assert.equal(ids.nextBlazeGearstormId('blaze-b'), 'blaze_gearstorm_blaze-b_1');
  assert.equal(ids.nextHookshotGroundHooksCastId('hook-a'), 'ground_hooks_hook-a_0');
  assert.equal(ids.nextHookshotGroundHooksCastId('hook-b'), 'ground_hooks_hook-b_1');
  assert.equal(ids.nextVoidZoneId(), 'void_0');
  assert.equal(ids.nextVoidZoneId(), 'void_1');
}

console.log('room ability id tests passed');
