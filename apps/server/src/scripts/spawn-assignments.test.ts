import assert from 'node:assert/strict';
import {
  assignBalancedTeam,
  collectTeamSpawnParticipants,
  countCombatTeamMembers,
  countCombatTeamMembersExcluding,
  createRandomTeamSpawnOffsets,
  createTeamSpawnAssignments,
  createTeamSpawnPlan,
  getTeamSpawnLookYaw,
  getTeamSpawnPoints,
  pickTeamSpawnPoint,
  resolveTeamSpawnAssignmentPosition,
  resolveTeamSpawnPlacement,
  type CombatTeamMember,
} from '../rooms/spawnAssignments';

const players = new Map<string, CombatTeamMember>([
  ['red-a', { team: 'red' }],
  ['red-observer', { team: 'red' }],
  ['blue-a', { team: 'blue' }],
  ['blue-b', { team: 'blue' }],
  ['unassigned', { team: '' }],
]);

assert.equal(countCombatTeamMembers(players.values(), 'red'), 2);
assert.equal(countCombatTeamMembers(players.values(), 'blue'), 2);
assert.equal(countCombatTeamMembersExcluding(players, 'blue', 'blue-b'), 1);

assert.equal(assignBalancedTeam({ redCount: 1, blueCount: 2 }), 'red');
assert.equal(assignBalancedTeam({ redCount: 2, blueCount: 1 }), 'blue');
assert.equal(assignBalancedTeam({ redCount: 1, blueCount: 1, preferredTeam: 'blue' }), 'blue');
assert.equal(assignBalancedTeam({ redCount: 3, blueCount: 1, preferredTeam: 'red' }), 'blue');
assert.equal(assignBalancedTeam({
  players: [
    { team: 'br_01' },
    { team: 'br_01' },
    { team: 'br_01' },
    { team: 'br_02' },
  ],
  teamIds: ['br_01', 'br_02', 'br_03'],
  maxTeamSize: 3,
  preferredTeam: 'br_01',
}), 'br_03');

assert.deepEqual(
  collectTeamSpawnParticipants(players),
  [
    { playerId: 'red-a', team: 'red' },
    { playerId: 'red-observer', team: 'red' },
    { playerId: 'blue-a', team: 'blue' },
    { playerId: 'blue-b', team: 'blue' },
  ]
);

const manifest = {
  spawnPoints: {
    red: [{ x: 1, y: 2, z: 3 }],
    blue: [{ x: -1, y: 2, z: -3 }],
  },
  gameplay: {
    spawns: {
      red: {
        points: [{ x: 10, y: 4, z: 12 }],
        facing: { x: 0, z: 1 },
      },
      blue: {
        points: [],
        facing: { x: 1, z: 0 },
      },
    },
  },
};

assert.deepEqual(getTeamSpawnPoints(manifest, 'red'), [{ x: 10, y: 4, z: 12 }]);
assert.deepEqual(getTeamSpawnPoints(manifest, 'blue'), [{ x: -1, y: 2, z: -3 }]);
assert.deepEqual(
  getTeamSpawnPoints({ spawnPoints: { red: [], blue: [] } }, 'red'),
  [{ x: 0, y: 1, z: 0 }]
);
assert.equal(getTeamSpawnLookYaw(manifest, 'red'), -Math.PI);
assert.equal(getTeamSpawnLookYaw(manifest, 'blue'), -Math.PI / 2);
assert.equal(getTeamSpawnLookYaw({ spawnPoints: { red: [], blue: [] } }, 'red'), Math.PI);
assert.equal(getTeamSpawnLookYaw({ spawnPoints: { red: [], blue: [] } }, 'blue'), 0);

assert.deepEqual(
  pickTeamSpawnPoint([{ x: 1, y: 1, z: 1 }, { x: 2, y: 2, z: 2 }], () => 0.75),
  { x: 2, y: 2, z: 2 }
);
assert.deepEqual(pickTeamSpawnPoint([], () => 0.5), { x: 0, y: 1, z: 0 });

assert.deepEqual(
  resolveTeamSpawnPlacement({
    manifest,
    team: 'red',
  }),
  {
    position: { x: 10, y: 4, z: 12 },
    lookYaw: -Math.PI,
    lookPitch: 0,
  }
);
assert.deepEqual(
  resolveTeamSpawnPlacement({
    manifest,
    team: 'blue',
    spawn: { x: 50, y: 6, z: -20 },
  }),
  {
    position: { x: 50, y: 6, z: -20 },
    lookYaw: -Math.PI / 2,
    lookPitch: 0,
  }
);
assert.deepEqual(
  resolveTeamSpawnPlacement({
    manifest,
    team: '',
  }),
  {
    position: { x: 10, y: 4, z: 12 },
    lookYaw: -Math.PI,
    lookPitch: 0,
  }
);

{
  const randomValues = [0.75, 0.2];
  assert.deepEqual(
    createRandomTeamSpawnOffsets({ red: 4, blue: 5 }, () => randomValues.shift() ?? 0),
    { red: 3, blue: 1 }
  );
  assert.deepEqual(
    createRandomTeamSpawnOffsets({ red: 0, blue: 0 }, () => 0.5),
    { red: 0, blue: 0 }
  );
}

{
  const randomValues = [0.75, 0.6];
  const plan = createTeamSpawnPlan({
    manifest: {
      spawnPoints: {
        red: [
          { x: 1, y: 1, z: 1 },
          { x: 2, y: 2, z: 2 },
          { x: 3, y: 3, z: 3 },
        ],
        blue: [
          { x: -1, y: 1, z: -1 },
          { x: -2, y: 2, z: -2 },
        ],
      },
    },
    players,
    random: () => randomValues.shift() ?? 0,
  });

  assert.deepEqual(plan.spawnPointsByTeam, {
    red: [
      { x: 1, y: 1, z: 1 },
      { x: 2, y: 2, z: 2 },
      { x: 3, y: 3, z: 3 },
    ],
    blue: [
      { x: -1, y: 1, z: -1 },
      { x: -2, y: 2, z: -2 },
    ],
  });
  assert.deepEqual(plan.assignments, [
    { playerId: 'red-a', team: 'red', spawnIndex: 2 },
    { playerId: 'red-observer', team: 'red', spawnIndex: 0 },
    { playerId: 'blue-a', team: 'blue', spawnIndex: 1 },
    { playerId: 'blue-b', team: 'blue', spawnIndex: 0 },
  ]);
}

assert.deepEqual(
  resolveTeamSpawnAssignmentPosition({
    spawnPointsByTeam: {
      red: [
        { x: 1, y: 1, z: 1 },
        { x: 2, y: 2, z: 2 },
      ],
      blue: [{ x: -1, y: 1, z: -1 }],
    },
    assignment: { playerId: 'red-a', team: 'red', spawnIndex: 1 },
  }),
  { x: 2, y: 2, z: 2 }
);
assert.deepEqual(
  resolveTeamSpawnAssignmentPosition({
    spawnPointsByTeam: {
      red: [{ x: 1, y: 1, z: 1 }],
      blue: [
        { x: -1, y: 1, z: -1 },
        { x: -2, y: 2, z: -2 },
      ],
    },
    assignment: { playerId: 'blue-a', team: 'blue', spawnIndex: 99 },
    random: () => 0.9,
  }),
  { x: -2, y: 2, z: -2 }
);
assert.deepEqual(
  resolveTeamSpawnAssignmentPosition({
    spawnPointsByTeam: {
      red: [],
      blue: [{ x: -1, y: 1, z: -1 }],
    },
    assignment: { playerId: 'red-a', team: 'red', spawnIndex: 0 },
  }),
  { x: 0, y: 1, z: 0 }
);

assert.deepEqual(
  createTeamSpawnAssignments(
    [
      { playerId: 'red-a', team: 'red' },
      { playerId: 'red-b', team: 'red' },
      { playerId: 'blue-a', team: 'blue' },
    ],
    { red: 3, blue: 2 },
    { red: 2, blue: 1 }
  ),
  [
    { playerId: 'red-a', team: 'red', spawnIndex: 2 },
    { playerId: 'red-b', team: 'red', spawnIndex: 0 },
    { playerId: 'blue-a', team: 'blue', spawnIndex: 1 },
  ]
);

{
  const battleRoyalPlan = createTeamSpawnPlan({
    manifest: {
      spawnPoints: {
        br_01: [{ x: 10, y: 1, z: 0 }, { x: 11, y: 1, z: 0 }, { x: 12, y: 1, z: 0 }],
        br_02: [{ x: -10, y: 1, z: 0 }, { x: -11, y: 1, z: 0 }, { x: -12, y: 1, z: 0 }],
      },
    },
    players: new Map([
      ['alpha-a', { team: 'br_01' }],
      ['alpha-b', { team: 'br_01' }],
      ['bravo-a', { team: 'br_02' }],
    ]),
    random: () => 0,
  });

  assert.deepEqual(Object.keys(battleRoyalPlan.spawnPointsByTeam).sort(), ['br_01', 'br_02']);
  assert.deepEqual(battleRoyalPlan.assignments, [
    { playerId: 'alpha-a', team: 'br_01', spawnIndex: 0 },
    { playerId: 'alpha-b', team: 'br_01', spawnIndex: 1 },
    { playerId: 'bravo-a', team: 'br_02', spawnIndex: 0 },
  ]);
}

console.log('spawn assignment tests passed');
