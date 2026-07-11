import assert from 'node:assert/strict';
import {
  BLAZE_PHOENIX_DIVE_HOVER_DURATION_MS,
  BLAZE_PHOENIX_DIVE_LAUNCH_DURATION_MS,
  BLAZE_PHOENIX_DIVE_MAX_FALL_DURATION_MS,
  BLAZE_PHOENIX_DIVE_START_HEIGHT,
  PLAYER_HEIGHT,
} from '@voxel-strike/shared';
import { GameRoom } from '../rooms/GameRoom';
import { Player } from '../rooms/schema/Player';

const now = 10_000;
assert.equal(BLAZE_PHOENIX_DIVE_HOVER_DURATION_MS, 3000);
const events: Array<Record<string, unknown>> = [];
const damageCenters: Array<{ x: number; y: number; z: number }> = [];
const target = { x: 18, y: 2.5, z: -7 };
const room = Object.create(GameRoom.prototype) as any;
const player = new Player();
player.id = 'blaze-player';
player.heroId = 'blaze';
player.team = 'red';
player.state = 'alive';
player.position.x = 1;
player.position.y = 4;
player.position.z = 2;
player.velocity.y = 18.5;
player.movement.isGrounded = false;

room.blazePhoenixDives = new Map();
room.state = { players: new Map([[player.id, player]]) };
room.abilityIds = {
  nextSharedCastId: () => 'blaze_phoenix_dive_blaze-player_1',
};
room.broadcastExactPlayerEvent = (_type: string, _player: Player, payload: Record<string, unknown>) => {
  events.push(payload);
};
room.markMovementBarrier = () => undefined;
room.resolveBlazeGroundTarget = () => ({ ...target });
room.getProceduralGroundY = () => target.y;
room.applyAreaDamage = (_player: Player, center: { x: number; y: number; z: number }) => {
  damageCenters.push({ ...center });
};

room.startBlazePhoenixDive(player, { x: 1, y: 4, z: 2 }, now);
let runtime = room.blazePhoenixDives.get(player.id);
assert.equal(runtime.phase, 'launch');
assert.equal(runtime.targetPosition, null, 'the first F press must not lock a target');
assert.equal(events.at(-1)?.phase, 'launch');

room.confirmBlazePhoenixDive(player, runtime, now + 100);
assert.equal(runtime.phase, 'launch', 'an extra F edge during launch must not skip the hover phase');
assert.equal(runtime.targetPosition, null);

player.velocity.y = 3;
player.velocity.z = -6;
room.updateBlazePhoenixDives(now + BLAZE_PHOENIX_DIVE_LAUNCH_DURATION_MS);
runtime = room.blazePhoenixDives.get(player.id);
assert.equal(runtime.phase, 'hover');
assert.deepEqual(
  { x: player.velocity.x, y: player.velocity.y, z: player.velocity.z },
  { x: 0, y: 3, z: -6 },
  'Blaze must carry the launch arc into the targeting phase',
);
assert.equal(events.at(-1)?.phase, 'hover');

room.applyBlazePhoenixDiveHoverVelocity(
  player,
  runtime,
  now + BLAZE_PHOENIX_DIVE_LAUNCH_DURATION_MS + 500,
);
assert.ok(player.velocity.z > -6 && player.velocity.z < -1.25, 'forward charge speed must quickly ease down');
assert.ok(player.velocity.y < 3, 'vertical launch speed must ease near the top of the arc');

room.confirmBlazePhoenixDive(player, runtime, now + BLAZE_PHOENIX_DIVE_LAUNCH_DURATION_MS + 600);
assert.equal(runtime.phase, 'dive');
assert.deepEqual(runtime.targetPosition, target);
assert.deepEqual(
  { x: player.position.x, y: player.position.y, z: player.position.z },
  { x: target.x, y: target.y + BLAZE_PHOENIX_DIVE_START_HEIGHT, z: target.z },
);
assert.ok(player.velocity.y < 0, 'the confirmed second F press must start a downward slam');
assert.equal(
  runtime.impactDeadline,
  now + BLAZE_PHOENIX_DIVE_LAUNCH_DURATION_MS + 600 + BLAZE_PHOENIX_DIVE_MAX_FALL_DURATION_MS,
);
assert.equal(events.at(-1)?.phase, 'dive');

player.movement.isGrounded = true;
room.updateBlazePhoenixDives(runtime.impactDeadline - 1);
assert.equal(room.blazePhoenixDives.has(player.id), false);
assert.equal(player.position.y, target.y + PLAYER_HEIGHT / 2 + 0.06);
assert.deepEqual(damageCenters, [target]);
assert.equal(events.at(-1)?.phase, 'impact');

const timeoutPlayer = new Player();
timeoutPlayer.id = 'timeout-player';
timeoutPlayer.heroId = 'blaze';
timeoutPlayer.team = 'red';
timeoutPlayer.state = 'alive';
timeoutPlayer.position.y = 12;
timeoutPlayer.movement.isGrounded = false;
room.state.players.set(timeoutPlayer.id, timeoutPlayer);
room.startBlazePhoenixDive(timeoutPlayer, { x: 0, y: 0, z: 0 }, now);
room.updateBlazePhoenixDives(now + BLAZE_PHOENIX_DIVE_LAUNCH_DURATION_MS);
const timeoutRuntime = room.blazePhoenixDives.get(timeoutPlayer.id);
room.updateBlazePhoenixDives(
  now + BLAZE_PHOENIX_DIVE_LAUNCH_DURATION_MS + BLAZE_PHOENIX_DIVE_HOVER_DURATION_MS,
);
assert.equal(timeoutRuntime.phase, 'dive', 'the hover timeout must safely auto-confirm instead of leaving Blaze suspended');

console.log('Blaze Phoenix Dive runtime tests passed');
