import assert from 'node:assert/strict';
import {
  DEFAULT_VOXEL_MAP_SIZE_ID,
  TRANSFORM_POSITION_SCALE,
  type FlagSync,
  type MatchSnapshotMessage,
} from '@voxel-strike/shared';
import { MatchSnapshotRuntime } from '../rooms/matchSnapshotRuntime';

function flag(input: Partial<FlagSync> = {}): FlagSync {
  return {
    position: { x: 0, y: 0, z: 0 },
    carrierId: null,
    isAtBase: true,
    ...input,
  };
}

const runtime = new MatchSnapshotRuntime();

{
  const redFlag = flag({ position: { x: 1.234, y: 2.345, z: -3.456 } });
  const blueFlag = flag({
    position: { x: -4.444, y: 5.555, z: 6.666 },
    carrierId: 'blue-carrier',
    isAtBase: false,
  });
  const snapshot = runtime.buildSnapshot({
    tick: 42,
    serverTime: 123456,
    phase: 'playing',
    gameplayMode: 'capture_the_flag',
    mapSeed: 777,
    mapThemeId: 'verdant',
    mapSize: 'small',
    redScore: 3,
    blueScore: 2,
    redFlag,
    blueFlag,
    roundTimeRemaining: 95,
    phaseEndTime: 0,
    gameClockFrozen: true,
  });

  assert.equal(snapshot.tick, 42);
  assert.equal(snapshot.phase, 'playing');
  assert.equal(snapshot.mapThemeId, 'verdant');
  assert.equal(snapshot.mapSize, 'small');
  assert.equal(snapshot.phaseEndTime, null);
  assert.equal(snapshot.redFlag, redFlag);
  assert.equal(snapshot.blueFlag, blueFlag);
  assert.equal(snapshot.gameClockFrozen, true);
}

{
  const snapshot: MatchSnapshotMessage = {
    tick: 1,
    serverTime: 1000,
    phase: 'countdown',
    gameplayMode: 'team_deathmatch',
    mapSeed: 321,
    mapThemeId: null,
    mapSize: null,
    redScore: 5,
    blueScore: 4,
    redFlag: flag({ position: { x: 1.234, y: 2.345, z: 3.456 }, carrierId: 'red-carrier', isAtBase: false }),
    blueFlag: flag({ position: { x: -1.111, y: -2.222, z: -3.333 } }),
    roundTimeRemaining: 12,
    phaseEndTime: null,
    gameClockFrozen: false,
  };
  const signature = runtime.getSignature(snapshot);

  assert.equal(signature, [
    'countdown',
    321,
    DEFAULT_VOXEL_MAP_SIZE_ID,
    'team_deathmatch',
    5,
    4,
    0,
    0,
    'red-carrier',
    0,
    Math.round(1.234 * TRANSFORM_POSITION_SCALE),
    Math.round(2.345 * TRANSFORM_POSITION_SCALE),
    Math.round(3.456 * TRANSFORM_POSITION_SCALE),
    '',
    1,
    Math.round(-1.111 * TRANSFORM_POSITION_SCALE),
    Math.round(-2.222 * TRANSFORM_POSITION_SCALE),
    Math.round(-3.333 * TRANSFORM_POSITION_SCALE),
  ].join(':'));

  const moved = {
    ...snapshot,
    redFlag: flag({ position: { x: 1.244, y: 2.345, z: 3.456 }, carrierId: 'red-carrier', isAtBase: false }),
  };
  assert.notEqual(runtime.getSignature(moved), signature);
  assert.equal(runtime.getSignature({ ...snapshot, tick: 2, serverTime: 2000 }), signature);
}

console.log('match snapshot runtime tests passed');
