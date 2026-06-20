import assert from 'node:assert/strict';
import {
  ANCHOR_WALL_COLLIDER_PREFIX,
  type CapsuleSweepHit,
  type MovementCollisionWorld,
} from '@voxel-strike/physics';
import {
  HookshotRuntimeTracker,
  resolveHookshotDragPullTerrainStep,
  type HookshotAnchorWallInstance,
} from '../rooms/hookshotRuntime';
import type { PlainVec3 } from '../rooms/bot-ai';

const TEST_AABB = {
  min: { x: 0, y: 0, z: 0 },
  max: { x: 1, y: 1, z: 1 },
};

function anchorWall(overrides: Partial<HookshotAnchorWallInstance> = {}): HookshotAnchorWallInstance {
  return {
    id: 'wall-a',
    startPosition: { x: 0, y: 1, z: 0 },
    direction: { x: 0, y: 0, z: -1 },
    startTime: 1_000,
    duration: 2,
    maxDistance: 20,
    ownerId: 'player-a',
    ownerTeam: 'red',
    ...overrides,
  };
}

function sweepHit(time: number, normal: PlainVec3): CapsuleSweepHit {
  return {
    time,
    position: { x: 0, y: 0, z: 0 },
    normal,
    distance: 0,
    aabb: TEST_AABB,
  };
}

function movementWorld(options: {
  hits?: CapsuleSweepHit[];
  occupied?: (position: PlainVec3) => boolean;
} = {}): MovementCollisionWorld {
  const hits = [...(options.hits ?? [])];
  return {
    collisionRevision: 1,
    testCapsule: (position) => options.occupied?.(position) ? [{} as never] : [],
    sweepCapsule: () => hits.shift() ?? null,
    findGround: () => null,
    clampToPlayableArea: (position) => ({ ...position }),
  };
}

function clampIdentity(position: PlainVec3): PlainVec3 {
  return { ...position };
}

{
  const tracker = new HookshotRuntimeTracker();
  const target = { x: 1, y: 2, z: 3 };

  tracker.setGrapple('player-a', {
    castId: 'cast-a',
    target,
    attachAt: 1_500,
    swing: null,
  });
  target.x = 99;

  assert.deepEqual(tracker.getGrapple('player-a'), {
    castId: 'cast-a',
    target: { x: 1, y: 2, z: 3 },
    attachAt: 1_500,
    swing: null,
  });
  assert.deepEqual(tracker.getGrappleTarget('player-a'), { x: 1, y: 2, z: 3 });
  assert.equal(tracker.clearGrapple('player-a'), true);
  assert.equal(tracker.clearGrapple('player-a'), false);
  assert.equal(tracker.getGrappleTarget('player-a'), null);
}

{
  const tracker = new HookshotRuntimeTracker();
  const forward = { x: 0, y: 0, z: -1 };

  tracker.setDragPull('target-a', {
    sourceId: 'source-a',
    forward,
    frontDistance: 4,
    startedAt: 1_000,
    expiresAt: 2_000,
  });
  forward.z = 99;

  assert.equal(tracker.hasDragPull('target-a'), true);
  assert.deepEqual(tracker.getDragPull('target-a'), {
    sourceId: 'source-a',
    forward: { x: 0, y: 0, z: -1 },
    frontDistance: 4,
    startedAt: 1_000,
    expiresAt: 2_000,
  });
  assert.equal(tracker.clearDragPull('target-a'), true);
  assert.equal(tracker.clearDragPull('target-a'), false);
  assert.equal(tracker.hasDragPull('target-a'), false);
}

{
  const tracker = new HookshotRuntimeTracker();

  tracker.setDragPull('target-a', {
    sourceId: 'source-a',
    forward: { x: 1, y: 0, z: 0 },
    frontDistance: 4,
    startedAt: 1_000,
    expiresAt: 2_000,
  });
  tracker.setDragPull('target-b', {
    sourceId: 'player-a',
    forward: { x: 0, y: 0, z: 1 },
    frontDistance: 4,
    startedAt: 1_000,
    expiresAt: 2_000,
  });
  tracker.setDragPull('player-a', {
    sourceId: 'source-c',
    forward: { x: 0, y: 0, z: -1 },
    frontDistance: 4,
    startedAt: 1_000,
    expiresAt: 2_000,
  });

  assert.equal(tracker.clearDragPullsInvolving('player-a'), 2);
  assert.equal(tracker.hasDragPull('target-b'), false);
  assert.equal(tracker.hasDragPull('player-a'), false);
  assert.equal(tracker.hasDragPull('target-a'), true);
}

{
  const tracker = new HookshotRuntimeTracker();

  tracker.setGrapple('player-a', {
    castId: 'cast-a',
    target: { x: 1, y: 2, z: 3 },
    attachAt: 1_500,
    swing: null,
  });
  tracker.setDragPull('target-b', {
    sourceId: 'player-a',
    forward: { x: 0, y: 0, z: 1 },
    frontDistance: 4,
    startedAt: 1_000,
    expiresAt: 2_000,
  });

  tracker.clearPlayer('player-a');
  assert.equal(tracker.getGrapple('player-a'), undefined);
  assert.equal(tracker.hasDragPull('target-b'), false);
}

{
  const tracker = new HookshotRuntimeTracker();
  const wall = anchorWall();

  assert.equal(tracker.getAnchorWallAabbs(1_500).length, 0);

  tracker.addAnchorWall(wall);
  wall.startPosition.x = 99;
  wall.direction.z = 99;

  assert.equal(tracker.anchorWallCount, 1);

  const aabbs = tracker.getAnchorWallAabbs(1_500);
  assert.ok(aabbs.length > 0);
  const firstAabb = aabbs[0];
  assert.ok(firstAabb);
  assert.ok(firstAabb.id?.startsWith(`${ANCHOR_WALL_COLLIDER_PREFIX}wall-a_`));
  assert.ok(Math.abs(firstAabb.min.x) < 3, 'stored anchor wall should not share mutable vectors with caller');

  const filtered = tracker.getAnchorWallAabbs(1_500, {
    min: { x: 50, y: 50, z: 50 },
    max: { x: 60, y: 60, z: 60 },
  });
  assert.equal(filtered.length, 0);

  assert.equal(tracker.pruneExpiredAnchorWalls(2_999), false);
  assert.equal(tracker.anchorWallCount, 1);
  assert.equal(tracker.pruneExpiredAnchorWalls(3_001), true);
  assert.equal(tracker.anchorWallCount, 0);
  assert.equal(tracker.pruneExpiredAnchorWalls(3_001), false);
}

{
  const tracker = new HookshotRuntimeTracker();

  tracker.addAnchorWall(anchorWall({ id: 'wall-a' }));
  tracker.addAnchorWall(anchorWall({ id: 'wall-b', startTime: 1_100 }));
  assert.equal(tracker.anchorWallCount, 2);

  tracker.clearAnchorWalls();
  assert.equal(tracker.anchorWallCount, 0);
  assert.equal(tracker.getAnchorWallAabbs(1_500).length, 0);
}

{
  const result = resolveHookshotDragPullTerrainStep({
    collisionWorld: movementWorld(),
    startPosition: { x: 0, y: 0, z: 0 },
    desiredDelta: { x: 1, y: 0, z: 0 },
    destination: { x: 2, y: 0, z: 0 },
    clampToPlayableMap: clampIdentity,
  });

  assert.deepEqual(result, {
    position: { x: 1, y: 0, z: 0 },
    blocked: false,
  });
}

{
  const result = resolveHookshotDragPullTerrainStep({
    collisionWorld: movementWorld(),
    startPosition: { x: 0, y: 0, z: 0 },
    desiredDelta: { x: 5, y: 0, z: 0 },
    destination: { x: 5, y: 0, z: 0 },
    clampToPlayableMap: (position) => ({ ...position, x: Math.min(position.x, 2) }),
  });

  assert.deepEqual(result, {
    position: { x: 2, y: 0, z: 0 },
    blocked: false,
  });
}

{
  const result = resolveHookshotDragPullTerrainStep({
    collisionWorld: movementWorld({
      hits: [sweepHit(0.5, { x: -1, y: 0, z: 0 })],
    }),
    startPosition: { x: 0, y: 0, z: 0 },
    desiredDelta: { x: 1, y: 0, z: 1 },
    destination: { x: 2, y: 0, z: 1 },
    clampToPlayableMap: clampIdentity,
  });

  assert.equal(result.blocked, false);
  assert.ok(result.position.x > 0.45 && result.position.x < 0.5, `expected contact x, got ${result.position.x}`);
  assert.ok(result.position.z > 0.99 && result.position.z <= 1, `expected slide z progress, got ${result.position.z}`);
}

{
  const result = resolveHookshotDragPullTerrainStep({
    collisionWorld: movementWorld({
      hits: [sweepHit(0.01, { x: -1, y: 0, z: 0 })],
    }),
    startPosition: { x: 0, y: 0, z: 0 },
    desiredDelta: { x: 1, y: 0, z: 0 },
    destination: { x: 2, y: 0, z: 0 },
    clampToPlayableMap: clampIdentity,
  });

  assert.deepEqual(result, {
    position: { x: 0, y: 0, z: 0 },
    blocked: true,
  });
}

console.log('hookshot runtime tests passed');
