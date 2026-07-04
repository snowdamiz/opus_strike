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
    matchPerspective: 'third_person',
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
  assert.equal(snapshot.matchPerspective, 'third_person');
  assert.equal(snapshot.mapThemeId, 'verdant');
  assert.equal(snapshot.mapSize, 'small');
  assert.equal(snapshot.mapProfileId, null);
  assert.equal(snapshot.safeZone, null);
  assert.equal(snapshot.battleRoyalDrop, null);
  assert.equal(snapshot.battleRoyalSouls, null);
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
    matchPerspective: 'first_person',
    mapSeed: 321,
    mapThemeId: null,
    mapSize: null,
    mapProfileId: null,
    redScore: 5,
    blueScore: 4,
    redFlag: flag({ position: { x: 1.234, y: 2.345, z: 3.456 }, carrierId: 'red-carrier', isAtBase: false }),
    blueFlag: flag({ position: { x: -1.111, y: -2.222, z: -3.333 } }),
    roundTimeRemaining: 12,
    phaseEndTime: null,
    gameClockFrozen: false,
    safeZone: null,
    battleRoyalDrop: null,
  };
  const signature = runtime.getSignature(snapshot);

  assert.equal(signature, [
    'countdown',
    321,
    DEFAULT_VOXEL_MAP_SIZE_ID,
    '',
    'team_deathmatch',
    'first_person',
    5,
    4,
    0,
    0,
    -1,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    '',
    '',
    '',
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

{
  const safeZone = {
    enabled: true,
    phaseIndex: 2,
    center: { x: 12.34, y: 0, z: -56.78 },
    radius: 42.5,
    nextCenter: { x: 10, y: 0, z: -40 },
    nextRadius: 20,
    nextZoneRevealsAt: 1_500,
    shrinkStartsAt: 2_000,
    phaseEndsAt: 3_000,
    damagePerSecond: 8,
    warning: true,
    shrinking: false,
  };
  const snapshot = runtime.buildSnapshot({
    tick: 2,
    serverTime: 2000,
    phase: 'playing',
    gameplayMode: 'battle_royal',
    matchPerspective: 'third_person',
    mapSeed: 0x51f15eed,
    mapThemeId: 'verdant',
    mapSize: 'large',
    mapProfileId: 'battle_royal_large',
    redScore: 0,
    blueScore: 0,
    redFlag: flag(),
    blueFlag: flag(),
    roundTimeRemaining: 800,
    phaseEndTime: null,
    gameClockFrozen: false,
    safeZone,
  });

  assert.equal(snapshot.mapProfileId, 'battle_royal_large');
  assert.equal(snapshot.safeZone, safeZone);
  assert.match(runtime.getSignature(snapshot), /battle_royal_large:battle_royal/);
}

console.log('match snapshot runtime tests passed');
