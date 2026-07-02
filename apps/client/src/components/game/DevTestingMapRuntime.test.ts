import assert from 'node:assert/strict';
import type { EarthWallData, HookshotGroundHooksData } from '../../store/types';
import {
  constrainDevTestingTargetMovementForAnchorWalls,
  isDevTestingTargetRootedByHookshot,
} from './DevTestingMapRuntime';

function groundHooks(overrides: Partial<HookshotGroundHooksData> = {}): HookshotGroundHooksData {
  return {
    id: 'ground-hooks-1',
    position: { x: 0, y: 0.95, z: 0 },
    startTime: 1000,
    duration: 2.5,
    ownerId: 'local-player',
    ownerTeam: 'red',
    radius: 7,
    rootUntil: 1800,
    targets: [
      {
        targetId: 'dev_training_hero_target',
        position: { x: 1, y: 0.95, z: -2 },
        rootUntil: 1800,
      },
    ],
    ...overrides,
  };
}

function anchorWall(overrides: Partial<EarthWallData> = {}): EarthWallData {
  return {
    id: 'anchor-wall-1',
    startPosition: { x: 0, y: 0.95, z: 0 },
    direction: { x: 0, y: 0, z: -1 },
    startTime: 1000,
    duration: 3,
    ownerId: 'local-player',
    ownerTeam: 'red',
    maxDistance: 18,
    hookProgress: 1,
    ...overrides,
  };
}

{
  assert.equal(
    isDevTestingTargetRootedByHookshot('dev_training_hero_target', [groundHooks()], 1400),
    true,
    'target should be rooted while an active ground hooks target entry references it'
  );
}

{
  assert.equal(
    isDevTestingTargetRootedByHookshot('dev_training_hero_target', [groundHooks()], 1900),
    false,
    'target should not remain rooted after its ground hooks root expires'
  );
}

{
  const currentPosition = { x: 0, y: 0.95, z: -4.6 };
  const attemptedPosition = { x: 0, y: 0.95, z: -6.4 };
  const constrainedPosition = constrainDevTestingTargetMovementForAnchorWalls(
    currentPosition,
    attemptedPosition,
    [anchorWall()],
    1200
  );

  assert.equal(
    constrainedPosition,
    currentPosition,
    'practice target should stop before crossing a raised anchor wall segment'
  );
}

{
  const currentPosition = { x: 4, y: 0.95, z: -4.6 };
  const attemptedPosition = { x: 4, y: 0.95, z: -6.4 };
  const constrainedPosition = constrainDevTestingTargetMovementForAnchorWalls(
    currentPosition,
    attemptedPosition,
    [anchorWall()],
    1200
  );

  assert.equal(
    constrainedPosition,
    attemptedPosition,
    'practice target should keep moving when its path is outside the anchor wall width'
  );
}

console.log('dev testing map runtime tests passed');
