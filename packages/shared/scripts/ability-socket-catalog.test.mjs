import assert from 'node:assert/strict';
import {
  ABILITY_SOCKET_CATALOG,
  BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
  CHRONOS_PRIMARY_ORB_SOCKET_NAME,
  HOOKSHOT_CHAIN_SOCKET,
  HOOKSHOT_HOOK_SOCKET_NAMES,
  PHANTOM_DIRE_BALL_SOCKET,
  PHANTOM_PRIMARY_PALM_SOCKET_NAMES,
  calculateAbilityFallbackSocketOrigin,
  resolveAbilitySocket,
} from '../dist/index.js';

const expectedAbilityIds = [
  'blaze_bomb',
  'blaze_flamethrower',
  'blaze_phosphor_flare',
  'blaze_rocket',
  'blaze_rocketjump',
  'blaze_scrapshot',
  'chronos_ascendant_paradox',
  'chronos_lifeline_conduit',
  'chronos_timebreak',
  'chronos_verdant_pulse',
  'hookshot_basic_attack',
  'hookshot_grapple',
  'hookshot_heavy_attack',
  'phantom_dire_ball',
  'phantom_personal_shield',
  'phantom_soulrend_daggers',
  'phantom_void_ray',
  'phantom_void_ray_charge',
];

assert.deepEqual(Object.keys(ABILITY_SOCKET_CATALOG).sort(), expectedAbilityIds);

const phantomLeft = resolveAbilitySocket({ abilityId: 'phantom_dire_ball', side: -1 });
assert.ok(phantomLeft);
assert.equal(phantomLeft.heroId, 'phantom');
assert.equal(phantomLeft.socketRole, 'primaryPalm');
assert.equal(phantomLeft.side, -1);
assert.deepEqual(phantomLeft.socketNames, [PHANTOM_PRIMARY_PALM_SOCKET_NAMES[-1]]);
assert.equal(phantomLeft.fallbackOffset.sideOffset, -PHANTOM_DIRE_BALL_SOCKET.sideOffset);

const phantomDefault = resolveAbilitySocket({ abilityId: 'phantom_dire_ball' });
assert.ok(phantomDefault);
assert.equal(phantomDefault.side, 1);
assert.deepEqual(phantomDefault.socketNames, [PHANTOM_PRIMARY_PALM_SOCKET_NAMES[1]]);
assert.equal(phantomDefault.fallbackOffset.sideOffset, PHANTOM_DIRE_BALL_SOCKET.sideOffset);

const soulrendLeft = resolveAbilitySocket({ abilityId: 'phantom_soulrend_daggers', side: -1 });
assert.ok(soulrendLeft);
assert.equal(soulrendLeft.heroId, 'phantom');
assert.equal(soulrendLeft.socketRole, 'primaryPalm');
assert.equal(soulrendLeft.side, -1);
assert.deepEqual(soulrendLeft.socketNames, [PHANTOM_PRIMARY_PALM_SOCKET_NAMES[-1]]);

const phantomShieldBoth = resolveAbilitySocket({ abilityId: 'phantom_personal_shield' });
assert.ok(phantomShieldBoth);
assert.equal(phantomShieldBoth.heroId, 'phantom');
assert.equal(phantomShieldBoth.socketRole, 'primaryPalm');
assert.equal(phantomShieldBoth.side, null);
assert.deepEqual(
  phantomShieldBoth.socketNames,
  [PHANTOM_PRIMARY_PALM_SOCKET_NAMES[1], PHANTOM_PRIMARY_PALM_SOCKET_NAMES[-1]]
);
assert.equal(phantomShieldBoth.fallbackOffset.sideOffset, 0);

const hookshotLockedRight = resolveAbilitySocket({ abilityId: 'hookshot_heavy_attack', side: -1 });
assert.ok(hookshotLockedRight);
assert.equal(hookshotLockedRight.heroId, 'hookshot');
assert.equal(hookshotLockedRight.socketRole, 'hookTip');
assert.equal(hookshotLockedRight.side, 1);
assert.deepEqual(hookshotLockedRight.socketNames, [HOOKSHOT_HOOK_SOCKET_NAMES[1]]);
assert.equal(hookshotLockedRight.fallbackOffset.sideOffset, HOOKSHOT_CHAIN_SOCKET.sideOffset);

const blazeRocket = resolveAbilitySocket({ abilityId: 'blaze_rocket', side: -1 });
assert.ok(blazeRocket);
assert.equal(blazeRocket.heroId, 'blaze');
assert.equal(blazeRocket.socketRole, 'staffTip');
assert.equal(blazeRocket.side, 1);
assert.deepEqual(blazeRocket.socketNames, [BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME]);

const blazeScrapshot = resolveAbilitySocket({ abilityId: 'blaze_scrapshot' });
assert.ok(blazeScrapshot);
assert.equal(blazeScrapshot.heroId, 'blaze');
assert.equal(blazeScrapshot.socketRole, 'staffTip');
assert.deepEqual(blazeScrapshot.socketNames, [BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME]);

const chronosCenter = resolveAbilitySocket({ abilityId: 'chronos_timebreak', side: -1 });
assert.ok(chronosCenter);
assert.equal(chronosCenter.heroId, 'chronos');
assert.equal(chronosCenter.socketRole, 'chronosPrimaryOrb');
assert.equal(chronosCenter.side, null);
assert.deepEqual(chronosCenter.socketNames, [CHRONOS_PRIMARY_ORB_SOCKET_NAME]);
assert.equal(chronosCenter.fallbackOffset.sideOffset, 0);

const rightOrigin = calculateAbilityFallbackSocketOrigin(
  { x: 0, y: 1, z: 0 },
  0,
  { abilityId: 'phantom_dire_ball', side: 1 }
);
const leftOrigin = calculateAbilityFallbackSocketOrigin(
  { x: 0, y: 1, z: 0 },
  0,
  { abilityId: 'phantom_dire_ball', side: -1 }
);
assert.ok(rightOrigin);
assert.ok(leftOrigin);
assert.equal(rightOrigin.x, PHANTOM_DIRE_BALL_SOCKET.sideOffset);
assert.equal(leftOrigin.x, -PHANTOM_DIRE_BALL_SOCKET.sideOffset);
assert.equal(rightOrigin.y, leftOrigin.y);
assert.equal(rightOrigin.z, leftOrigin.z);

assert.equal(resolveAbilitySocket({ abilityId: 'unknown_ability' }), null);
assert.equal(calculateAbilityFallbackSocketOrigin({ x: 0, y: 0, z: 0 }, 0, { abilityId: 'unknown_ability' }), null);

console.log('ability socket catalog tests passed');
