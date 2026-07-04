import assert from 'node:assert/strict';
import {
  BATTLE_ROYAL_SOUL_COLLECT_DURATION_MS,
  BATTLE_ROYAL_SOUL_SUMMON_DURATION_MS,
  type MapSummoningCircle,
} from '@voxel-strike/shared';
import { BattleRoyalSoulRuntime } from '../rooms/battleRoyalSoulRuntime';
import type { Player } from '../rooms/schema/Player';

function player(
  id: string,
  team = 'br_01',
  state: Player['state'] = 'alive',
  x = 0,
  z = 0
): Player {
  return {
    id,
    name: id,
    team,
    state,
    heroId: 'phantom',
    skinId: '',
    position: { x, y: 1, z },
    velocity: { x: 0, y: 0, z: 0 },
    movement: {},
  } as unknown as Player;
}

const circle: MapSummoningCircle = {
  id: 'br_summon_1',
  position: { x: 0, y: 1, z: 0 },
  radius: 3,
};

{
  const runtime = new BattleRoyalSoulRuntime();
  const now = 10_000;
  const fallen = player('fallen', 'br_01', 'dead');
  const collector = player('collector', 'br_01', 'alive', 1);
  const players = new Map<string, Player>([
    [fallen.id, fallen],
    [collector.id, collector],
  ]);

  const created = runtime.createSoul(fallen, now);
  assert.equal(created.playerId, fallen.id);
  assert.equal(created.heroId, 'phantom');
  assert.equal(created.status, 'available');

  assert.equal(runtime.tryStartNearestCollect(collector, now + 100), true);
  assert.equal(runtime.hasActiveInteraction(collector.id), true);
  assert.equal(runtime.buildSnapshot().souls[0].status, 'collecting');

  let result = runtime.update(players, [circle], now + 100 + BATTLE_ROYAL_SOUL_COLLECT_DURATION_MS - 1);
  assert.equal(result.completedSummons.length, 0);
  assert.equal(runtime.buildSnapshot().souls[0].status, 'collecting');

  result = runtime.update(players, [circle], now + 100 + BATTLE_ROYAL_SOUL_COLLECT_DURATION_MS);
  assert.equal(result.completedSummons.length, 0);
  assert.equal(runtime.getCarriedSoulCount(collector.id), 1);
  assert.equal(runtime.buildSnapshot().souls[0].status, 'carried');

  collector.position.x = circle.position.x;
  collector.position.z = circle.position.z;
  assert.equal(runtime.tryStartSummon(collector, [circle], now + 4_000), true);
  assert.equal(runtime.buildSnapshot().souls[0].status, 'summoning');

  result = runtime.update(players, [circle], now + 4_000 + BATTLE_ROYAL_SOUL_SUMMON_DURATION_MS);
  assert.equal(result.completedSummons.length, 1);
  assert.equal(result.completedSummons[0].circleId, circle.id);
  assert.deepEqual(result.completedSummons[0].souls.map((soul) => soul.playerId), [fallen.id]);
  assert.equal(runtime.buildSnapshot().souls.length, 0);
}

{
  const runtime = new BattleRoyalSoulRuntime();
  const now = 20_000;
  const fallen = player('fallen-cancel', 'br_01', 'dead');
  const collector = player('collector-cancel', 'br_01', 'alive', 0.8);

  runtime.createSoul(fallen, now);
  assert.equal(runtime.tryStartNearestCollect(collector, now + 50), true);
  assert.equal(runtime.cancelInteractionForPlayer(collector.id), true);
  const snapshot = runtime.buildSnapshot();
  assert.equal(snapshot.interactions.length, 0);
  assert.equal(snapshot.souls[0].status, 'available');
  assert.equal(snapshot.souls[0].collectByPlayerId, null);
}

{
  const runtime = new BattleRoyalSoulRuntime();
  const now = 30_000;
  const fallen = player('fallen-drop', 'br_01', 'dead');
  const carrier = player('carrier', 'br_01', 'alive', 0.8);
  const players = new Map<string, Player>([
    [fallen.id, fallen],
    [carrier.id, carrier],
  ]);

  runtime.createSoul(fallen, now);
  assert.equal(runtime.tryStartNearestCollect(carrier, now + 100), true);
  runtime.update(players, [circle], now + 100 + BATTLE_ROYAL_SOUL_COLLECT_DURATION_MS);
  assert.equal(runtime.getCarriedSoulCount(carrier.id), 1);

  carrier.position.x = 9;
  carrier.position.z = -4;
  assert.equal(runtime.dropCarriedSouls(carrier, now + 5_000), true);
  const snapshot = runtime.buildSnapshot();
  assert.equal(snapshot.souls[0].status, 'available');
  assert.equal(snapshot.souls[0].carriedByPlayerId, null);
  assert.equal(snapshot.souls[0].position.x, 9);
  assert.equal(snapshot.souls[0].position.z, -4);
}

console.log('battle-royal-soul-runtime ok');
