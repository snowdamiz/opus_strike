import assert from 'node:assert/strict';
import type { PlayerInput, Vec3, VoxelMapManifest } from '@voxel-strike/shared';
import {
  BATTLE_ROYAL_DROP_POD_MAX_VERTICAL_SPEED,
  BATTLE_ROYAL_DROP_POD_MIN_VERTICAL_SPEED,
  PITCH_LIMIT,
  clampToBoundaryPolygon,
  isInsideBoundaryPolygon,
} from '@voxel-strike/shared';
import {
  BATTLE_ROYAL_DEPLOYMENT_PHASE_MS,
  advanceBattleRoyalDropState,
  areAllBattleRoyalDropPlayersLanded,
  areAllBattleRoyalHumanDropPlayersLanded,
  buildBattleRoyalDropSnapshot,
  createBattleRoyalDropState,
  forceLandBattleRoyalDropState,
  getBattleRoyalDeploymentCompletionReason,
  isBattleRoyalDropTeamLeader,
  isBattleRoyalDropShipDroppable,
  releaseAboardBattleRoyalBotPods,
  removeBattleRoyalDropParticipant,
  setBattleRoyalDropPlayerInput,
  shouldAutoDropBattleRoyalTeam,
  startBattleRoyalTeamDrop,
} from '../rooms/battleRoyalDrop';

const manifest = {
  seed: 0x51f15eed,
  origin: { x: -80, y: 0, z: -80 },
  voxelSize: { x: 1, y: 1, z: 1 },
  size: { x: 160, y: 1, z: 160 },
  boundary: [
    { x: 72, z: 0 },
    { x: 0, z: 72 },
    { x: -72, z: 0 },
    { x: 0, z: -72 },
  ],
} as unknown as VoxelMapManifest;

function playerInput(overrides: Partial<PlayerInput> = {}): PlayerInput {
  return {
    tick: 1,
    moveForward: false,
    moveBackward: false,
    moveLeft: false,
    moveRight: false,
    jump: false,
    crouch: false,
    sprint: false,
    primaryFire: false,
    secondaryFire: false,
    reload: false,
    ability1: false,
    ability2: false,
    ultimate: false,
    interact: false,
    lookYaw: 0,
    lookPitch: 0,
    timestamp: 0,
    ...overrides,
  };
}

function flatGroundY(_position: Vec3): number {
  return 0;
}

function unclamped(position: Vec3): Vec3 {
  return { ...position };
}

function clampToBoundary(position: Vec3): Vec3 {
  const clamped = clampToBoundaryPolygon(position.x, position.z, manifest.boundary);
  return { ...position, x: clamped.x, z: clamped.z };
}

const startedAt = 1_000;
const expectedDropShipAltitude = 153 * 0.85;
const state = createBattleRoyalDropState(
  manifest,
  [
    { playerId: 'red-1', team: 'red' },
    { playerId: 'red-2', team: 'red' },
    { playerId: 'blue-1', team: 'blue' },
  ],
  startedAt
);

assert.equal(state.phaseEndsAt - state.phaseStartedAt, BATTLE_ROYAL_DEPLOYMENT_PHASE_MS);
assert.equal(state.players.get('red-1')?.status, 'aboard');
assert.equal(state.players.get('blue-1')?.status, 'aboard');
assert.equal(Math.hypot(state.ship.end.x - state.ship.start.x, state.ship.end.z - state.ship.start.z) > 100, true);
assert.equal(state.ship.start.y, state.ship.end.y);
assert.equal(state.ship.altitude, expectedDropShipAltitude);
assert.equal(state.ship.start.y, expectedDropShipAltitude);
assert.equal(isBattleRoyalDropShipDroppable(state, startedAt), false);
assert.equal(startBattleRoyalTeamDrop(state, 'red', startedAt + 1_000), false);

const initialSnapshot = buildBattleRoyalDropSnapshot(state, startedAt);
assert.equal(initialSnapshot.enabled, true);
assert.equal(initialSnapshot.serverTime, startedAt);
assert.equal(initialSnapshot.players.length, 3);
assert.equal(initialSnapshot.players.every((player) => player.status === 'aboard'), true);
assert.equal(initialSnapshot.players.find((player) => player.playerId === 'red-1')?.attachedToPlayerId, null);
assert.equal(initialSnapshot.players.find((player) => player.playerId === 'red-2')?.attachedToPlayerId, 'red-1');
assert.equal(state.teamPlayers.get('red')?.length, 2);
assert.equal(state.teamHumanCounts.get('red'), 2);
assert.equal(isBattleRoyalDropTeamLeader(state, 'red-1'), true);
assert.equal(isBattleRoyalDropTeamLeader(state, 'red-2'), false);
assert.equal(initialSnapshot.ship.canDrop, false);

const redAutoDropAt = state.teamAutoDropAt.get('red') ?? state.autoDropAt;
assert.equal(shouldAutoDropBattleRoyalTeam(state, 'red', redAutoDropAt), false);
const legalDropAt = state.dropStartsAt + 100;
assert.equal(isBattleRoyalDropShipDroppable(state, legalDropAt), true);
assert.equal(buildBattleRoyalDropSnapshot(state, legalDropAt).ship.canDrop, true);
assert.equal(startBattleRoyalTeamDrop(state, 'red', legalDropAt, 'red-2'), false);
assert.equal(startBattleRoyalTeamDrop(state, 'red', legalDropAt), true);
assert.equal(startBattleRoyalTeamDrop(state, 'red', legalDropAt + 1), false);
assert.equal(state.players.get('red-1')?.status, 'dropping');
assert.equal(state.players.get('red-2')?.status, 'dropping');
assert.equal(state.players.get('blue-1')?.status, 'aboard');

const red = state.players.get('red-1');
assert.ok(red);
const redDropStart = { ...red.position };

setBattleRoyalDropPlayerInput(state, 'red-1', playerInput({
  moveForward: true,
  sprint: true,
  lookYaw: -Math.PI / 2,
}));
advanceBattleRoyalDropState({
  state,
  now: startedAt + 13_000,
  dt: 1,
  getGroundY: flatGroundY,
  clampToPlayableMap: unclamped,
});

assert.equal(red.status, 'dropping');
assert.equal(red.position.x > redDropStart.x + 1, true);
assert.equal(red.position.y < redDropStart.y, true);
assert.equal(state.players.get('blue-1')?.status, 'aboard');

const mouseGuidedState = createBattleRoyalDropState(
  manifest,
  [{ playerId: 'mouse-red', team: 'red' }],
  startedAt
);
startBattleRoyalTeamDrop(mouseGuidedState, 'red', mouseGuidedState.dropStartsAt + 100);
const mouseGuidedPlayer = mouseGuidedState.players.get('mouse-red');
assert.ok(mouseGuidedPlayer);
const mouseGuidedStart = { ...mouseGuidedPlayer.position };
setBattleRoyalDropPlayerInput(mouseGuidedState, 'mouse-red', playerInput({
  lookYaw: -Math.PI / 2,
}));
advanceBattleRoyalDropState({
  state: mouseGuidedState,
  now: startedAt + 2_000,
  dt: 1,
  getGroundY: flatGroundY,
  clampToPlayableMap: unclamped,
});
assert.equal(mouseGuidedPlayer.position.x > mouseGuidedStart.x + 1, true);
assert.equal(mouseGuidedPlayer.position.y < mouseGuidedStart.y, true);

const squadFollowState = createBattleRoyalDropState(
  manifest,
  [
    { playerId: 'leader-red', team: 'red' },
    { playerId: 'wing-red', team: 'red' },
  ],
  startedAt
);
startBattleRoyalTeamDrop(squadFollowState, 'red', squadFollowState.dropStartsAt + 100);
const squadLeader = squadFollowState.players.get('leader-red');
const squadWing = squadFollowState.players.get('wing-red');
assert.ok(squadLeader);
assert.ok(squadWing);
assert.equal(squadLeader.attachedToPlayerId, null);
assert.equal(squadWing.attachedToPlayerId, 'leader-red');
setBattleRoyalDropPlayerInput(squadFollowState, 'leader-red', playerInput({
  moveForward: true,
  lookYaw: -Math.PI / 2,
}));
setBattleRoyalDropPlayerInput(squadFollowState, 'wing-red', playerInput({
  moveBackward: true,
  lookYaw: Math.PI / 2,
}));
advanceBattleRoyalDropState({
  state: squadFollowState,
  now: squadFollowState.dropStartsAt + 600,
  dt: 0.5,
  getGroundY: flatGroundY,
  clampToPlayableMap: unclamped,
});
assert.equal(Math.abs(squadWing.position.x - squadLeader.position.x) < 0.001, true);
assert.equal(Math.abs(squadWing.position.y - squadLeader.position.y) < 0.001, true);
assert.equal(Math.abs(squadWing.position.z - squadLeader.position.z) < 0.001, true);
setBattleRoyalDropPlayerInput(squadFollowState, 'wing-red', playerInput({
  ultimate: true,
  moveBackward: true,
  lookYaw: -Math.PI / 2,
}));
advanceBattleRoyalDropState({
  state: squadFollowState,
  now: squadFollowState.dropStartsAt + 1_100,
  dt: 0.5,
  getGroundY: flatGroundY,
  clampToPlayableMap: unclamped,
});
assert.equal(squadWing.attachedToPlayerId, 'leader-red');
assert.equal(Math.abs(squadWing.position.x - squadLeader.position.x) < 0.001, true);
assert.equal(Math.abs(squadWing.position.z - squadLeader.position.z) < 0.001, true);

const pitchGuidedState = createBattleRoyalDropState(
  manifest,
  [{ playerId: 'pitch-red', team: 'red' }],
  startedAt
);
startBattleRoyalTeamDrop(pitchGuidedState, 'red', pitchGuidedState.dropStartsAt + 100);
const pitchGuidedPlayer = pitchGuidedState.players.get('pitch-red');
assert.ok(pitchGuidedPlayer);
setBattleRoyalDropPlayerInput(pitchGuidedState, 'pitch-red', playerInput({
  lookPitch: PITCH_LIMIT,
}));
advanceBattleRoyalDropState({
  state: pitchGuidedState,
  now: startedAt + 2_000,
  dt: 1,
  getGroundY: flatGroundY,
  clampToPlayableMap: unclamped,
});
assert.equal(pitchGuidedPlayer.velocity.y, -BATTLE_ROYAL_DROP_POD_MIN_VERTICAL_SPEED);
setBattleRoyalDropPlayerInput(pitchGuidedState, 'pitch-red', playerInput({
  lookPitch: -PITCH_LIMIT,
}));
advanceBattleRoyalDropState({
  state: pitchGuidedState,
  now: startedAt + 3_000,
  dt: 1,
  getGroundY: flatGroundY,
  clampToPlayableMap: unclamped,
});
assert.equal(pitchGuidedPlayer.velocity.y, -BATTLE_ROYAL_DROP_POD_MAX_VERTICAL_SPEED);

const boundaryClampedState = createBattleRoyalDropState(
  manifest,
  [{ playerId: 'edge-red', team: 'red' }],
  startedAt
);
startBattleRoyalTeamDrop(boundaryClampedState, 'red', boundaryClampedState.dropStartsAt + 100);
const edgePlayer = boundaryClampedState.players.get('edge-red');
assert.ok(edgePlayer);
edgePlayer.position = { x: 71.8, y: 80, z: 0 };
setBattleRoyalDropPlayerInput(boundaryClampedState, 'edge-red', playerInput({
  moveForward: true,
  lookYaw: -Math.PI / 2,
}));
advanceBattleRoyalDropState({
  state: boundaryClampedState,
  now: boundaryClampedState.dropStartsAt + 200,
  dt: 1,
  getGroundY: flatGroundY,
  clampToPlayableMap: clampToBoundary,
});
assert.equal(isInsideBoundaryPolygon(edgePlayer.position.x, edgePlayer.position.z, manifest.boundary), true);

let now = startedAt + 13_000;
for (let step = 0; step < 120; step++) {
  if (state.players.get('red-1')?.status === 'landed') break;
  now += 100;
  advanceBattleRoyalDropState({
    state,
    now,
    dt: 0.1,
    getGroundY: flatGroundY,
    clampToPlayableMap: unclamped,
  });
}

const landedRed = state.players.get('red-1');
assert.equal(landedRed?.status, 'landed');
assert.equal(landedRed?.landedAt !== null, true);
assert.equal(landedRed?.velocity.y, 0);
assert.equal(areAllBattleRoyalDropPlayersLanded(state), false);

forceLandBattleRoyalDropState({
  state,
  now: now + 100,
  dt: 0.1,
  getGroundY: flatGroundY,
  clampToPlayableMap: unclamped,
});
assert.equal(areAllBattleRoyalDropPlayersLanded(state), true);
assert.equal(state.players.get('blue-1')?.status, 'landed');

const humanLandedBotAboardState = createBattleRoyalDropState(
  manifest,
  [
    { playerId: 'human-red', team: 'red' },
    { playerId: 'bot-blue', team: 'blue', isBot: true },
  ],
  startedAt
);
humanLandedBotAboardState.teamAutoDropAt.set('blue', humanLandedBotAboardState.dropEndsAt);
startBattleRoyalTeamDrop(humanLandedBotAboardState, 'red', humanLandedBotAboardState.dropStartsAt + 100);
let humanLandedAt = humanLandedBotAboardState.dropStartsAt + 200;
for (let step = 0; step < 160; step++) {
  if (humanLandedBotAboardState.players.get('human-red')?.status === 'landed') break;
  humanLandedAt += 100;
  advanceBattleRoyalDropState({
    state: humanLandedBotAboardState,
    now: humanLandedAt,
    dt: 0.1,
    getGroundY: flatGroundY,
    clampToPlayableMap: unclamped,
  });
}
assert.equal(humanLandedBotAboardState.players.get('human-red')?.status, 'landed');
assert.notEqual(humanLandedBotAboardState.players.get('bot-blue')?.status, 'landed');
assert.equal(areAllBattleRoyalHumanDropPlayersLanded(humanLandedBotAboardState), true);
assert.equal(areAllBattleRoyalDropPlayersLanded(humanLandedBotAboardState), false);
assert.equal(getBattleRoyalDeploymentCompletionReason(humanLandedBotAboardState, false), null);
assert.equal(releaseAboardBattleRoyalBotPods(humanLandedBotAboardState, humanLandedAt), 1);
assert.equal(humanLandedBotAboardState.players.get('bot-blue')?.status, 'dropping');
for (let step = 0; step < 160; step++) {
  if (areAllBattleRoyalDropPlayersLanded(humanLandedBotAboardState)) break;
  humanLandedAt += 100;
  advanceBattleRoyalDropState({
    state: humanLandedBotAboardState,
    now: humanLandedAt,
    dt: 0.1,
    getGroundY: flatGroundY,
    clampToPlayableMap: unclamped,
  });
}
assert.equal(areAllBattleRoyalDropPlayersLanded(humanLandedBotAboardState), true);
assert.equal(
  getBattleRoyalDeploymentCompletionReason(humanLandedBotAboardState, false),
  'all_players_landed'
);

const botOnlyState = createBattleRoyalDropState(
  manifest,
  [{ playerId: 'bot-blue', team: 'blue', isBot: true }],
  startedAt
);
const botAutoDropAt = botOnlyState.teamAutoDropAt.get('blue') ?? botOnlyState.autoDropAt;
assert.equal(shouldAutoDropBattleRoyalTeam(botOnlyState, 'blue', botAutoDropAt - 1), false);
assert.equal(shouldAutoDropBattleRoyalTeam(botOnlyState, 'blue', botAutoDropAt), true);

advanceBattleRoyalDropState({
  state: botOnlyState,
  now: botAutoDropAt,
  dt: 0.016,
  getGroundY: flatGroundY,
  clampToPlayableMap: unclamped,
});
const botDropPlayer = botOnlyState.players.get('bot-blue');
assert.equal(botDropPlayer?.status, 'dropping');
assert.equal(Math.hypot(botDropPlayer?.velocity.x ?? 0, botDropPlayer?.velocity.z ?? 0) > 1, true);

const botSquadState = createBattleRoyalDropState(
  manifest,
  [
    { playerId: 'bot-red-1', team: 'red', isBot: true },
    { playerId: 'bot-red-2', team: 'red', isBot: true },
    { playerId: 'bot-red-3', team: 'red', isBot: true },
  ],
  startedAt
);
const botSquad = Array.from(botSquadState.players.values());
assert.equal(botSquad[0].attachedToPlayerId, null);
assert.equal(botSquad[1].attachedToPlayerId, botSquad[0].playerId);
assert.equal(botSquad[2].attachedToPlayerId, botSquad[0].playerId);
startBattleRoyalTeamDrop(botSquadState, 'red', botSquadState.dropStartsAt + 100);
advanceBattleRoyalDropState({
  state: botSquadState,
  now: botSquadState.dropStartsAt + 600,
  dt: 0.5,
  getGroundY: flatGroundY,
  clampToPlayableMap: unclamped,
});
for (const squadmate of botSquad.slice(1)) {
  assert.equal(squadmate.position.x, botSquad[0].position.x);
  assert.equal(squadmate.position.y, botSquad[0].position.y);
  assert.equal(squadmate.position.z, botSquad[0].position.z);
}

const fullBotRosterTeams = Array.from(
  { length: 9 },
  (_, index) => `br_${String(index + 1).padStart(2, '0')}`
);
const fullBotRosterState = createBattleRoyalDropState(
  manifest,
  fullBotRosterTeams.flatMap((team) => Array.from(
    { length: 3 },
    (_, index) => ({ playerId: `${team}-bot-${index}`, team, isBot: true })
  )),
  startedAt
);
let fullBotRosterNow = fullBotRosterState.dropStartsAt;
for (let step = 0; step < 600; step++) {
  if (areAllBattleRoyalDropPlayersLanded(fullBotRosterState)) break;
  fullBotRosterNow += 100;
  advanceBattleRoyalDropState({
    state: fullBotRosterState,
    now: fullBotRosterNow,
    dt: 0.1,
    getGroundY: flatGroundY,
    clampToPlayableMap: clampToBoundary,
  });
}
assert.equal(areAllBattleRoyalDropPlayersLanded(fullBotRosterState), true);
const fullBotRoster = Array.from(fullBotRosterState.players.values());
const fullBotRosterLeaders = fullBotRosterTeams.map((team) => {
  const teamPlayers = fullBotRoster.filter((player) => player.team === team);
  const leaderId = fullBotRosterState.teamLeaderIds.get(team);
  const leader = teamPlayers.find((player) => player.playerId === leaderId);
  assert.ok(leader);
  for (const squadmate of teamPlayers) {
    assert.equal(Math.hypot(
      leader.position.x - squadmate.position.x,
      leader.position.z - squadmate.position.z
    ) <= 1.5, true);
  }
  return leader;
});
const fullBotRosterX = fullBotRosterLeaders.map((player) => player.position.x);
const fullBotRosterZ = fullBotRosterLeaders.map((player) => player.position.z);
assert.equal(Math.max(...fullBotRosterX) - Math.min(...fullBotRosterX) > 80, true);
assert.equal(Math.max(...fullBotRosterZ) - Math.min(...fullBotRosterZ) > 80, true);
for (let first = 0; first < fullBotRosterLeaders.length; first++) {
  for (let second = first + 1; second < fullBotRosterLeaders.length; second++) {
    assert.equal(
      Math.hypot(
        fullBotRosterLeaders[first].position.x - fullBotRosterLeaders[second].position.x,
        fullBotRosterLeaders[first].position.z - fullBotRosterLeaders[second].position.z
      ) > 8,
      true
    );
  }
}

const removalState = createBattleRoyalDropState(
  manifest,
  [
    { playerId: 'human-red', team: 'red' },
    { playerId: 'bot-red', team: 'red', isBot: true },
  ],
  startedAt
);
assert.equal(removeBattleRoyalDropParticipant(removalState, 'human-red'), true);
assert.equal(removalState.players.has('human-red'), false);
assert.equal(removalState.teamPlayers.get('red')?.map((player) => player.playerId).join(','), 'bot-red');
assert.equal(removalState.teamHumanCounts.has('red'), false);
assert.equal(isBattleRoyalDropTeamLeader(removalState, 'bot-red'), true);
assert.equal(
  shouldAutoDropBattleRoyalTeam(
    removalState,
    'red',
    Math.max(removalState.dropStartsAt, removalState.teamAutoDropAt.get('red') ?? removalState.autoDropAt)
  ),
  true
);
assert.equal(removeBattleRoyalDropParticipant(removalState, 'bot-red'), true);
assert.equal(removalState.teamPlayers.has('red'), false);
assert.equal(removeBattleRoyalDropParticipant(removalState, 'missing-red'), false);

console.log('battle royal drop tests passed');
