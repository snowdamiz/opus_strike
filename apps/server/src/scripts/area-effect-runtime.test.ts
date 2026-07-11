import assert from 'node:assert/strict';
import {
  BLAZE_GEARSTORM_DAMAGE_INTERVAL_MS,
  BLAZE_AFTERBURNER_MAX_TRAIL_POINTS,
  BLAZE_AFTERBURNER_TRAIL_DAMAGE_INTERVAL_MS,
  BLAZE_AFTERBURNER_TRAIL_RADIUS,
  BLAZE_PHOSPHOR_FLARE_DAMAGE_INTERVAL_MS,
  PHANTOM_VOID_ZONE_DAMAGE_INTERVAL_MS,
} from '@voxel-strike/shared';
import {
  BlazeAfterburnerTrailTracker,
  BlazeLingeringAreaTracker,
  PendingAreaDamageQueue,
  VoidZoneTracker,
  type PendingAreaDamageInstance,
} from '../rooms/areaEffectRuntime';

function createPendingAreaDamage(
  id: string,
  resolveAt: number
): PendingAreaDamageInstance {
  return {
    id,
    ownerId: 'owner',
    center: { x: 0, y: 0, z: 0 },
    radius: 4,
    damage: 10,
    damageType: 'test',
    resolveAt,
  };
}

{
  const tracker = new BlazeLingeringAreaTracker();
  const hits: number[] = [];
  tracker.add({
    id: 'delayed-phosphor-pool',
    ownerId: 'owner',
    ownerTeam: 'red',
    position: { x: 0, y: 0, z: 0 },
    radius: 3,
    damage: 12,
    damageIntervalMs: BLAZE_PHOSPHOR_FLARE_DAMAGE_INTERVAL_MS,
    damageType: 'phosphor_flare',
    abilityId: 'blaze_phosphor_flare',
    falloffScale: 0,
    startTime: 2_000,
    endTime: 6_000,
  });
  const update = (now: number) => tracker.update(now, {
    hasOwner: () => true,
    getTargets: () => [createTarget('inside', { x: 1, y: 0, z: 0 })],
    applyDamage: () => hits.push(now),
  });

  update(1_999);
  assert.deepEqual(hits, []);
  update(2_000);
  assert.deepEqual(hits, [2_000]);
  update(2_000 + BLAZE_PHOSPHOR_FLARE_DAMAGE_INTERVAL_MS - 1);
  assert.deepEqual(hits, [2_000]);
  update(2_000 + BLAZE_PHOSPHOR_FLARE_DAMAGE_INTERVAL_MS);
  assert.deepEqual(hits, [2_000, 2_000 + BLAZE_PHOSPHOR_FLARE_DAMAGE_INTERVAL_MS]);
}

function createTarget(
  id: string,
  position: { x: number; y: number; z: number },
  state = 'alive'
) {
  return { id, position, state };
}

{
  const tracker = new BlazeAfterburnerTrailTracker();
  const startPosition = { x: 0, y: 2, z: 0 };
  const endPosition = { x: 8, y: 2, z: 0 };
  tracker.add({
    id: 'afterburner-trail',
    ownerId: 'owner',
    ownerTeam: 'red',
    points: [startPosition],
    radius: BLAZE_AFTERBURNER_TRAIL_RADIUS,
    damage: 6,
    damageIntervalMs: BLAZE_AFTERBURNER_TRAIL_DAMAGE_INTERVAL_MS,
    startTime: 1_000,
    endTime: 3_400,
  });
  startPosition.x = 99;
  assert.equal(tracker.appendPoint('afterburner-trail', endPosition), true);
  endPosition.x = 99;

  const targets = [
    createTarget('middle', { x: 4, y: 2.5, z: 0 }),
    createTarget('endpoint', { x: 8.5, y: 2, z: 0 }),
    createTarget('wide-edge', { x: 4, y: 2.9, z: 1.25 }),
    createTarget('beyond-wide-edge', { x: 4, y: 2.9, z: 1.55 }),
    createTarget('outside', { x: 4, y: 4, z: 0 }),
    createTarget('dead', { x: 4, y: 2, z: 0 }, 'dead'),
  ];
  const hits: string[] = [];
  let observedBounds: { center: { x: number; y: number; z: number }; halfLength: number } | null = null;
  const update = (now: number) => tracker.update(now, {
    hasOwner: () => true,
    getTargets: (trail) => {
      observedBounds = {
        center: { ...trail.boundsCenter },
        halfLength: trail.boundsHalfLength,
      };
      return targets;
    },
    applyDamage: (_trail, target) => hits.push(target.id),
  });

  update(1_000);
  assert.deepEqual(hits, ['middle', 'endpoint', 'wide-edge']);
  assert.deepEqual(observedBounds, {
    center: { x: 4, y: 2, z: 0 },
    halfLength: 4,
  });
  update(1_000 + BLAZE_AFTERBURNER_TRAIL_DAMAGE_INTERVAL_MS - 1);
  assert.equal(hits.length, 3);
  update(1_000 + BLAZE_AFTERBURNER_TRAIL_DAMAGE_INTERVAL_MS);
  assert.equal(hits.length, 6);
  update(3_400);
  assert.equal(tracker.size, 0);
}

{
  const tracker = new BlazeAfterburnerTrailTracker();
  tracker.add({
    id: 'capped-trail',
    ownerId: 'owner',
    ownerTeam: 'red',
    points: [{ x: 0, y: 0, z: 0 }],
    radius: BLAZE_AFTERBURNER_TRAIL_RADIUS,
    damage: 6,
    damageIntervalMs: BLAZE_AFTERBURNER_TRAIL_DAMAGE_INTERVAL_MS,
    startTime: 1_000,
    endTime: 4_000,
  });
  for (let index = 1; index < BLAZE_AFTERBURNER_MAX_TRAIL_POINTS; index++) {
    assert.equal(tracker.appendPoint('capped-trail', { x: index, y: 0, z: 0 }), true);
  }
  assert.equal(tracker.appendPoint('capped-trail', { x: 999, y: 0, z: 0 }), false);

  let positionReads = 0;
  const target = createTarget('inside', { x: 0.5, y: 0, z: 0 });
  const trackedPosition = target.position;
  Object.defineProperty(target, 'position', {
    get: () => {
      positionReads += 1;
      return trackedPosition;
    },
  });
  let hitCount = 0;
  const update = (now: number) => tracker.update(now, {
    hasOwner: () => true,
    getTargets: () => [target],
    applyDamage: () => { hitCount += 1; },
  });

  update(1_000);
  assert.equal(hitCount, 1);
  const readsAfterDamage = positionReads;
  update(1_000 + BLAZE_AFTERBURNER_TRAIL_DAMAGE_INTERVAL_MS - 1);
  assert.equal(positionReads, readsAfterDamage);
  update(1_000 + BLAZE_AFTERBURNER_TRAIL_DAMAGE_INTERVAL_MS);
  assert.ok(positionReads > readsAfterDamage);
  assert.equal(hitCount, 2);
}

{
  const queue = new PendingAreaDamageQueue();
  const ready: PendingAreaDamageInstance[] = [];

  queue.enqueue(createPendingAreaDamage('ready-a', 1_000));
  queue.enqueue(createPendingAreaDamage('future', 1_500));
  queue.enqueue(createPendingAreaDamage('ready-b', 500));

  assert.equal(queue.size, 3);
  assert.equal(queue.drainReadyInto(1_000, ready), ready);
  assert.deepEqual(ready.map((instance) => instance.id), ['ready-a', 'ready-b']);
  assert.equal(queue.size, 1);
  assert.equal(queue.drainReadyInto(1_499, ready), ready);
  assert.equal(ready.length, 0);
  assert.equal(queue.size, 1);
  assert.equal(queue.drainReadyInto(1_500, ready), ready);
  assert.deepEqual(ready.map((instance) => instance.id), ['future']);
  assert.equal(queue.size, 0);
}

{
  const queue = new PendingAreaDamageQueue();
  const ready: PendingAreaDamageInstance[] = [];

  queue.enqueue(createPendingAreaDamage('queued', 1_000));
  queue.clear();
  assert.equal(queue.size, 0);
  assert.equal(queue.drainReadyInto(2_000, ready), ready);
  assert.equal(ready.length, 0);
}

{
  const tracker = new BlazeLingeringAreaTracker();
  const position = { x: 0, y: 0, z: 0 };

  tracker.add({
    id: 'storm-a',
    ownerId: 'owner',
    ownerTeam: 'red',
    position,
    radius: 5,
    damage: 20,
    damageIntervalMs: BLAZE_GEARSTORM_DAMAGE_INTERVAL_MS,
    damageType: 'airstrike',
    abilityId: 'blaze_airstrike',
    falloffScale: 0.35,
    startTime: 1_000,
    endTime: 5_000,
  });
  position.x = 99;

  const targets = [
    createTarget('inside', { x: 3, y: 0, z: 0 }),
    createTarget('edge', { x: 0, y: 0, z: 5 }),
    createTarget('downed', { x: 2, y: 0, z: 0 }, 'downed'),
    createTarget('outside', { x: 0, y: 0, z: 6 }),
    createTarget('dead', { x: 2, y: 0, z: 0 }, 'dead'),
  ];
  const hits: Array<{ targetId: string; distance: number; stormX: number }> = [];

  tracker.update(1_000, {
    hasOwner: () => true,
    getTargets: () => targets,
    applyDamage: (storm, target, distance) => {
      hits.push({ targetId: target.id, distance, stormX: storm.position.x });
    },
  });

  assert.deepEqual(hits, [
    { targetId: 'inside', distance: 3, stormX: 0 },
    { targetId: 'edge', distance: 5, stormX: 0 },
    { targetId: 'downed', distance: 2, stormX: 0 },
  ]);
  assert.equal(tracker.size, 1);

  tracker.update(1_000 + BLAZE_GEARSTORM_DAMAGE_INTERVAL_MS - 1, {
    hasOwner: () => true,
    getTargets: () => targets,
    applyDamage: (storm, target, distance) => {
      hits.push({ targetId: target.id, distance, stormX: storm.position.x });
    },
  });
  assert.equal(hits.length, 3);

  tracker.update(1_000 + BLAZE_GEARSTORM_DAMAGE_INTERVAL_MS, {
    hasOwner: () => true,
    getTargets: () => targets,
    applyDamage: (storm, target, distance) => {
      hits.push({ targetId: target.id, distance, stormX: storm.position.x });
    },
  });
  assert.deepEqual(hits.slice(3), [
    { targetId: 'inside', distance: 3, stormX: 0 },
    { targetId: 'edge', distance: 5, stormX: 0 },
    { targetId: 'downed', distance: 2, stormX: 0 },
  ]);
}

{
  const tracker = new BlazeLingeringAreaTracker();
  let targetsQueried = false;

  tracker.add({
    id: 'ownerless',
    ownerId: 'missing-owner',
    ownerTeam: 'blue',
    position: { x: 0, y: 0, z: 0 },
    radius: 5,
    damage: 10,
    damageIntervalMs: BLAZE_GEARSTORM_DAMAGE_INTERVAL_MS,
    damageType: 'airstrike',
    abilityId: 'blaze_airstrike',
    falloffScale: 0.35,
    startTime: 1_000,
    endTime: 2_000,
  });

  tracker.update(1_500, {
    hasOwner: () => false,
    getTargets: () => {
      targetsQueried = true;
      return [];
    },
    applyDamage: () => undefined,
  });
  assert.equal(targetsQueried, false);
  assert.equal(tracker.size, 1);

  tracker.update(2_000, {
    hasOwner: () => false,
    getTargets: () => {
      targetsQueried = true;
      return [];
    },
    applyDamage: () => undefined,
  });
  assert.equal(tracker.size, 0);
}

{
  const tracker = new BlazeLingeringAreaTracker();

  tracker.add({
    id: 'storm-clear',
    ownerId: 'owner',
    ownerTeam: 'red',
    position: { x: 0, y: 0, z: 0 },
    radius: 5,
    damage: 10,
    damageIntervalMs: BLAZE_GEARSTORM_DAMAGE_INTERVAL_MS,
    damageType: 'airstrike',
    abilityId: 'blaze_airstrike',
    falloffScale: 0.35,
    startTime: 1_000,
    endTime: 2_000,
  });
  tracker.clear();
  assert.equal(tracker.size, 0);
}

{
  const tracker = new VoidZoneTracker();
  const position = { x: 0, y: 0, z: 0 };

  const zone = tracker.add({
    id: 'void-a',
    ownerId: 'owner',
    ownerTeam: 'red',
    position,
    radius: 5,
    damage: 12,
    duration: 3,
    startTime: 1_000,
  });
  position.x = 99;

  assert.equal(zone.position.x, 0);
  assert.equal(tracker.size, 1);
}

{
  const tracker = new VoidZoneTracker();
  const expiredIds: string[] = [];
  const hits: string[] = [];

  tracker.add({
    id: 'void-expire',
    ownerId: 'owner',
    ownerTeam: 'blue',
    position: { x: 0, y: 0, z: 0 },
    radius: 5,
    damage: 12,
    duration: 2,
    startTime: 1_000,
  });

  tracker.update(3_000, {
    onExpired: (zone) => expiredIds.push(zone.id),
    getTargets: () => [createTarget('inside', { x: 1, y: 0, z: 0 })],
    applyDamage: (_zone, target) => hits.push(target.id),
  });

  assert.deepEqual(expiredIds, ['void-expire']);
  assert.equal(hits.length, 0);
  assert.equal(tracker.size, 0);
}

{
  const tracker = new VoidZoneTracker();
  const targets = [
    createTarget('owner', { x: 1, y: 0, z: 0 }),
    createTarget('inside', { x: 3, y: 99, z: 0 }),
    createTarget('edge', { x: 0, y: 0, z: 5 }),
    createTarget('outside', { x: 0, y: 0, z: 6 }),
    { ...createTarget('protected', { x: 1, y: 0, z: 0 }), spawnProtectionUntil: 2_000 },
  ];
  const hits: string[] = [];

  tracker.add({
    id: 'void-damage',
    ownerId: 'owner',
    ownerTeam: 'red',
    position: { x: 0, y: 0, z: 0 },
    radius: 5,
    damage: 12,
    duration: 10,
    startTime: 1_000,
  });

  tracker.update(1_000 + PHANTOM_VOID_ZONE_DAMAGE_INTERVAL_MS - 1, {
    onExpired: () => undefined,
    getTargets: () => targets,
    applyDamage: (_zone, target) => hits.push(target.id),
  });
  assert.equal(hits.length, 0);

  tracker.update(1_000 + PHANTOM_VOID_ZONE_DAMAGE_INTERVAL_MS, {
    onExpired: () => undefined,
    getTargets: () => targets,
    applyDamage: (_zone, target) => hits.push(target.id),
  });
  assert.deepEqual(hits, ['inside', 'edge']);

  tracker.update(1_000 + PHANTOM_VOID_ZONE_DAMAGE_INTERVAL_MS * 2 - 1, {
    onExpired: () => undefined,
    getTargets: () => targets,
    applyDamage: (_zone, target) => hits.push(target.id),
  });
  assert.deepEqual(hits, ['inside', 'edge']);

  tracker.update(1_000 + PHANTOM_VOID_ZONE_DAMAGE_INTERVAL_MS * 2, {
    onExpired: () => undefined,
    getTargets: () => targets,
    applyDamage: (_zone, target) => hits.push(target.id),
  });
  assert.deepEqual(hits, ['inside', 'edge', 'inside', 'edge', 'protected']);
}

{
  const tracker = new VoidZoneTracker();

  tracker.add({
    id: 'void-clear',
    ownerId: 'owner',
    ownerTeam: 'red',
    position: { x: 0, y: 0, z: 0 },
    radius: 5,
    damage: 12,
    duration: 10,
    startTime: 1_000,
  });
  tracker.clear();
  assert.equal(tracker.size, 0);
}

console.log('area effect runtime tests passed');
