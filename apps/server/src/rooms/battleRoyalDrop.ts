import type {
  BattleRoyalDropSnapshot,
  BattleRoyalDropPlayerStatus,
  PlayerInput,
  Team,
  Vec3,
  VoxelMapManifest,
} from '@voxel-strike/shared';
import {
  BATTLE_ROYAL_DROP_POD_LANDING_CLEARANCE,
  BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED,
  advanceBattleRoyalDropPodMotion,
  hashSeed,
  isInsideBoundaryPolygon,
} from '@voxel-strike/shared';

export const BATTLE_ROYAL_DEPLOYMENT_PHASE_MS = 60_000;

const DROP_SHIP_ALTITUDE = 153;
const DROP_SHIP_EDGE_PADDING = 88;
const DROP_SHIP_AUTO_DROP_LEAD_MS = 16_000;
const DROP_SHIP_DROP_WINDOW_MARGIN_MS = 1_000;
const DROP_SHIP_DROP_WINDOW_SAMPLES = 160;
const DROP_SHIP_DROP_WINDOW_REFINEMENT_STEPS = 20;

export interface BattleRoyalDropParticipant {
  playerId: string;
  team: Team;
  isBot?: boolean;
}

export interface BattleRoyalDropPlayerState {
  playerId: string;
  team: Team;
  isBot: boolean;
  status: BattleRoyalDropPlayerStatus;
  position: Vec3;
  velocity: Vec3;
  droppedAt: number | null;
  landedAt: number | null;
  slotOffset: Vec3;
  landingOffset: Vec3;
  attachedToPlayerId: string | null;
  latestInput: PlayerInput | null;
}

export interface BattleRoyalDropState {
  phaseStartedAt: number;
  phaseEndsAt: number;
  autoDropAt: number;
  ship: {
    start: Vec3;
    end: Vec3;
    altitude: number;
    dropStartProgress: number;
    dropEndProgress: number;
  };
  dropStartsAt: number;
  dropEndsAt: number;
  players: Map<string, BattleRoyalDropPlayerState>;
  teamPlayers: Map<Team, BattleRoyalDropPlayerState[]>;
  teamHumanCounts: Map<Team, number>;
  teamAutoDropAt: Map<Team, number>;
  teamDroppedAt: Map<Team, number>;
  teamLeaderIds: Map<Team, string>;
}

interface BoundarySummary {
  center: Vec3;
  radius: number;
}

interface AdvanceBattleRoyalDropInput {
  state: BattleRoyalDropState;
  now: number;
  dt: number;
  getGroundY: (position: Vec3) => number | null;
  clampToPlayableMap: (position: Vec3) => Vec3;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
}

function isInsideDropBoundary(manifest: VoxelMapManifest, x: number, z: number): boolean {
  if (manifest.boundary.length >= 3) {
    return isInsideBoundaryPolygon(x, z, manifest.boundary);
  }

  return (
    x >= manifest.origin.x &&
    x <= manifest.origin.x + manifest.size.x * manifest.voxelSize.x &&
    z >= manifest.origin.z &&
    z <= manifest.origin.z + manifest.size.z * manifest.voxelSize.z
  );
}

function isDropPathProgressInside(
  ship: Pick<BattleRoyalDropState['ship'], 'start' | 'end'>,
  manifest: VoxelMapManifest,
  progress: number
): boolean {
  const position = lerpVec3(ship.start, ship.end, clamp01(progress));
  return isInsideDropBoundary(manifest, position.x, position.z);
}

function refineDropBoundaryProgress(input: {
  ship: Pick<BattleRoyalDropState['ship'], 'start' | 'end'>;
  manifest: VoxelMapManifest;
  outsideProgress: number;
  insideProgress: number;
}): number {
  let outsideProgress = input.outsideProgress;
  let insideProgress = input.insideProgress;

  for (let step = 0; step < DROP_SHIP_DROP_WINDOW_REFINEMENT_STEPS; step++) {
    const midpoint = (outsideProgress + insideProgress) / 2;
    if (isDropPathProgressInside(input.ship, input.manifest, midpoint)) {
      insideProgress = midpoint;
    } else {
      outsideProgress = midpoint;
    }
  }

  return insideProgress;
}

function getDropWindowProgress(
  ship: Pick<BattleRoyalDropState['ship'], 'start' | 'end'>,
  manifest: VoxelMapManifest
): { start: number; end: number } {
  let firstInsideIndex = -1;
  let lastInsideIndex = -1;
  for (let index = 0; index <= DROP_SHIP_DROP_WINDOW_SAMPLES; index++) {
    const progress = index / DROP_SHIP_DROP_WINDOW_SAMPLES;
    if (!isDropPathProgressInside(ship, manifest, progress)) continue;
    if (firstInsideIndex < 0) firstInsideIndex = index;
    lastInsideIndex = index;
  }

  if (firstInsideIndex < 0 || lastInsideIndex < 0) {
    return { start: 0, end: 1 };
  }

  const start = firstInsideIndex <= 0
    ? 0
    : refineDropBoundaryProgress({
      ship,
      manifest,
      outsideProgress: (firstInsideIndex - 1) / DROP_SHIP_DROP_WINDOW_SAMPLES,
      insideProgress: firstInsideIndex / DROP_SHIP_DROP_WINDOW_SAMPLES,
    });
  const end = lastInsideIndex >= DROP_SHIP_DROP_WINDOW_SAMPLES
    ? 1
    : refineDropBoundaryProgress({
      ship,
      manifest,
      outsideProgress: (lastInsideIndex + 1) / DROP_SHIP_DROP_WINDOW_SAMPLES,
      insideProgress: lastInsideIndex / DROP_SHIP_DROP_WINDOW_SAMPLES,
    });

  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

function unitRandom(seed: number): number {
  return (hashSeed(seed) >>> 0) / 0x1_0000_0000;
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function getBoundarySummary(manifest: VoxelMapManifest): BoundarySummary {
  if (manifest.boundary.length === 0) {
    const center = {
      x: manifest.origin.x + (manifest.size.x * manifest.voxelSize.x) / 2,
      y: manifest.origin.y,
      z: manifest.origin.z + (manifest.size.z * manifest.voxelSize.z) / 2,
    };
    return {
      center,
      radius: Math.max(
        manifest.size.x * manifest.voxelSize.x,
        manifest.size.z * manifest.voxelSize.z
      ) / 2,
    };
  }

  const sum = manifest.boundary.reduce(
    (total, point) => ({ x: total.x + point.x, z: total.z + point.z }),
    { x: 0, z: 0 }
  );
  const center = {
    x: sum.x / manifest.boundary.length,
    y: manifest.origin.y,
    z: sum.z / manifest.boundary.length,
  };
  let radius = 1;
  for (const point of manifest.boundary) {
    radius = Math.max(radius, Math.hypot(point.x - center.x, point.z - center.z));
  }
  return { center, radius };
}

function createDropShipPath(manifest: VoxelMapManifest): BattleRoyalDropState['ship'] {
  const summary = getBoundarySummary(manifest);
  const angle = unitRandom(manifest.seed ^ 0x5f3759df) * Math.PI * 2;
  const direction = { x: Math.cos(angle), z: Math.sin(angle) };
  const halfDistance = summary.radius + DROP_SHIP_EDGE_PADDING;
  const ship = {
    start: {
      x: summary.center.x - direction.x * halfDistance,
      y: DROP_SHIP_ALTITUDE,
      z: summary.center.z - direction.z * halfDistance,
    },
    end: {
      x: summary.center.x + direction.x * halfDistance,
      y: DROP_SHIP_ALTITUDE,
      z: summary.center.z + direction.z * halfDistance,
    },
    altitude: DROP_SHIP_ALTITUDE,
  };
  const dropWindow = getDropWindowProgress(ship, manifest);
  return {
    ...ship,
    dropStartProgress: dropWindow.start,
    dropEndProgress: dropWindow.end,
  };
}

function createSlotOffset(index: number): Vec3 {
  const row = Math.floor(index / 4);
  const column = index % 4;
  return {
    x: (column - 1.5) * 2.7,
    y: -3.6,
    z: -2.2 - row * 2.8,
  };
}

function createLandingOffset(index: number): Vec3 {
  if (index === 0) return { x: 0, y: 0, z: 0 };
  const angle = -Math.PI / 2 + ((index - 1) / 3) * Math.PI * 2;
  const radius = 1.45;
  return {
    x: Math.cos(angle) * radius,
    y: 0,
    z: Math.sin(angle) * radius,
  };
}

function writeVec3(target: Vec3, x: number, y: number, z: number): void {
  target.x = x;
  target.y = y;
  target.z = z;
}

function copyVec3(target: Vec3, source: Vec3): void {
  writeVec3(target, source.x, source.y, source.z);
}

function getMutableTeamDropPlayers(
  state: Pick<BattleRoyalDropState, 'teamPlayers'>,
  team: Team
): BattleRoyalDropPlayerState[] {
  let players = state.teamPlayers.get(team);
  if (!players) {
    players = [];
    state.teamPlayers.set(team, players);
  }
  return players;
}

function incrementTeamHumanCount(state: Pick<BattleRoyalDropState, 'teamHumanCounts'>, team: Team): void {
  state.teamHumanCounts.set(team, (state.teamHumanCounts.get(team) ?? 0) + 1);
}

function decrementTeamHumanCount(state: Pick<BattleRoyalDropState, 'teamHumanCounts'>, team: Team): void {
  const nextCount = (state.teamHumanCounts.get(team) ?? 0) - 1;
  if (nextCount > 0) {
    state.teamHumanCounts.set(team, nextCount);
  } else {
    state.teamHumanCounts.delete(team);
  }
}

function selectBattleRoyalDropTeamLeaders(
  participants: readonly BattleRoyalDropParticipant[]
): Map<Team, string> {
  const leaders = new Map<Team, string>();

  for (const participant of participants) {
    if (leaders.has(participant.team) || participant.isBot) continue;
    leaders.set(participant.team, participant.playerId);
  }

  for (const participant of participants) {
    if (leaders.has(participant.team)) continue;
    leaders.set(participant.team, participant.playerId);
  }

  return leaders;
}

function getTeamAutoDropAt(input: {
  phaseStartedAt: number;
  phaseEndsAt: number;
  autoDropAt: number;
  dropStartsAt: number;
  dropEndsAt: number;
  team: Team;
  seed: number;
}): number {
  const duration = Math.max(1, input.dropEndsAt - input.dropStartsAt);
  const teamSeed = input.seed ^ hashString(input.team);
  const ratio = lerp(0.18, 0.72, unitRandom(teamSeed));
  return Math.min(input.autoDropAt, input.dropStartsAt + duration * ratio);
}

export function isBattleRoyalDropShipDroppable(
  state: BattleRoyalDropState,
  now: number
): boolean {
  return now >= state.dropStartsAt && now <= state.dropEndsAt;
}

export function getBattleRoyalDropShipPosition(
  state: BattleRoyalDropState,
  now: number
): Vec3 {
  const duration = Math.max(1, state.phaseEndsAt - state.phaseStartedAt);
  const progress = clamp01((now - state.phaseStartedAt) / duration);
  return lerpVec3(state.ship.start, state.ship.end, progress);
}

export function getBattleRoyalDropShipVelocity(
  state: Pick<BattleRoyalDropState, 'phaseStartedAt' | 'phaseEndsAt' | 'ship'>
): Vec3 {
  const seconds = Math.max(0.001, (state.phaseEndsAt - state.phaseStartedAt) / 1000);
  return {
    x: (state.ship.end.x - state.ship.start.x) / seconds,
    y: 0,
    z: (state.ship.end.z - state.ship.start.z) / seconds,
  };
}

export function isBattleRoyalDropTeamLeader(
  state: BattleRoyalDropState,
  playerId: string
): boolean {
  const player = state.players.get(playerId);
  return Boolean(player && state.teamLeaderIds.get(player.team) === playerId);
}

function ensureBattleRoyalDropTeamLeader(
  state: BattleRoyalDropState,
  team: Team
): BattleRoyalDropPlayerState | null {
  const teamPlayers = state.teamPlayers.get(team);
  if (!teamPlayers || teamPlayers.length === 0) {
    state.teamLeaderIds.delete(team);
    return null;
  }

  const currentLeaderId = state.teamLeaderIds.get(team);
  const currentLeader = currentLeaderId ? state.players.get(currentLeaderId) ?? null : null;
  if (currentLeader) {
    currentLeader.attachedToPlayerId = null;
    return currentLeader;
  }

  let nextLeader: BattleRoyalDropPlayerState | null = null;
  for (const player of teamPlayers) {
    if (!player.isBot) {
      nextLeader = player;
      break;
    }
  }
  nextLeader ??= teamPlayers[0] ?? null;
  if (!nextLeader) return null;

  state.teamLeaderIds.set(team, nextLeader.playerId);
  nextLeader.attachedToPlayerId = null;
  for (const player of teamPlayers) {
    if (player.playerId === nextLeader.playerId || player.status === 'landed') continue;
    player.attachedToPlayerId = nextLeader.playerId;
  }
  return nextLeader;
}

export function createBattleRoyalDropState(
  manifest: VoxelMapManifest,
  participants: readonly BattleRoyalDropParticipant[],
  now: number
): BattleRoyalDropState {
  const phaseEndsAt = now + BATTLE_ROYAL_DEPLOYMENT_PHASE_MS;
  const ship = createDropShipPath(manifest);
  const duration = phaseEndsAt - now;
  const rawDropStartsAt = now + duration * ship.dropStartProgress;
  const rawDropEndsAt = now + duration * ship.dropEndProgress;
  const dropStartsAt = Math.min(
    rawDropEndsAt,
    rawDropStartsAt + DROP_SHIP_DROP_WINDOW_MARGIN_MS
  );
  const dropEndsAt = Math.max(
    dropStartsAt,
    rawDropEndsAt - DROP_SHIP_DROP_WINDOW_MARGIN_MS
  );
  const autoDropAt = Math.max(
    dropStartsAt,
    Math.min(phaseEndsAt - DROP_SHIP_AUTO_DROP_LEAD_MS, dropEndsAt - DROP_SHIP_DROP_WINDOW_MARGIN_MS)
  );
  const shipPosition = ship.start;
  const shipVelocity = getBattleRoyalDropShipVelocity({
    phaseStartedAt: now,
    phaseEndsAt,
    ship,
  });
  const players = new Map<string, BattleRoyalDropPlayerState>();
  const teamPlayers = new Map<Team, BattleRoyalDropPlayerState[]>();
  const teamHumanCounts = new Map<Team, number>();
  const teamAutoDropAt = new Map<Team, number>();
  const teamLeaderIds = selectBattleRoyalDropTeamLeaders(participants);

  for (const participant of participants) {
    if (!teamAutoDropAt.has(participant.team)) {
      teamAutoDropAt.set(participant.team, getTeamAutoDropAt({
        phaseStartedAt: now,
        phaseEndsAt,
        autoDropAt,
        dropStartsAt,
        dropEndsAt,
        team: participant.team,
        seed: manifest.seed,
      }));
    }

    const teamList = getMutableTeamDropPlayers({ teamPlayers }, participant.team);
    const teamSlot = teamList.length;
    const slotOffset = createSlotOffset(teamSlot);
    const landingOffset = createLandingOffset(teamSlot);
    const attachedToPlayerId = teamLeaderIds.get(participant.team) ?? null;
    const player: BattleRoyalDropPlayerState = {
      playerId: participant.playerId,
      team: participant.team,
      isBot: participant.isBot === true,
      status: 'aboard',
      position: {
        x: shipPosition.x + slotOffset.x,
        y: shipPosition.y + slotOffset.y,
        z: shipPosition.z + slotOffset.z,
      },
      velocity: shipVelocity,
      droppedAt: null,
      landedAt: null,
      slotOffset,
      landingOffset,
      attachedToPlayerId: attachedToPlayerId === participant.playerId ? null : attachedToPlayerId,
      latestInput: null,
    };
    players.set(participant.playerId, player);
    teamList.push(player);
    if (!player.isBot) {
      incrementTeamHumanCount({ teamHumanCounts }, participant.team);
    }
  }

  return {
    phaseStartedAt: now,
    phaseEndsAt,
    autoDropAt,
    ship,
    dropStartsAt,
    dropEndsAt,
    players,
    teamPlayers,
    teamHumanCounts,
    teamAutoDropAt,
    teamDroppedAt: new Map(),
    teamLeaderIds,
  };
}

export function setBattleRoyalDropPlayerInput(
  state: BattleRoyalDropState,
  playerId: string,
  input: PlayerInput
): void {
  const player = state.players.get(playerId);
  if (!player) return;
  player.latestInput = input;
}

export function addBattleRoyalDropParticipant(
  state: BattleRoyalDropState,
  participant: BattleRoyalDropParticipant,
  now: number
): BattleRoyalDropPlayerState {
  if (state.players.has(participant.playerId)) {
    removeBattleRoyalDropParticipant(state, participant.playerId);
  }

  const teamPlayers = getMutableTeamDropPlayers(state, participant.team);
  const teamSlot = teamPlayers.length;
  const slotOffset = createSlotOffset(teamSlot);
  const landingOffset = createLandingOffset(teamSlot);
  const shipPosition = getBattleRoyalDropShipPosition(state, now);
  const shipVelocity = getBattleRoyalDropShipVelocity(state);
  const alreadyDropped = state.teamDroppedAt.has(participant.team);
  const leader = ensureBattleRoyalDropTeamLeader(state, participant.team);
  const leaderId = leader?.playerId ?? null;
  const attachedToPlayerId = leaderId && leaderId !== participant.playerId ? leaderId : null;
  const initialPosition = alreadyDropped && leader
    ? {
      x: leader.position.x + landingOffset.x,
      y: leader.position.y + landingOffset.y,
      z: leader.position.z + landingOffset.z,
    }
    : {
      x: shipPosition.x + slotOffset.x,
      y: shipPosition.y + slotOffset.y,
      z: shipPosition.z + slotOffset.z,
    };
  const player: BattleRoyalDropPlayerState = {
    playerId: participant.playerId,
    team: participant.team,
    isBot: participant.isBot === true,
    status: alreadyDropped ? 'dropping' : 'aboard',
    position: initialPosition,
    velocity: alreadyDropped
      ? { x: shipVelocity.x, y: -BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED, z: shipVelocity.z }
      : shipVelocity,
    droppedAt: alreadyDropped ? now : null,
    landedAt: null,
    slotOffset,
    landingOffset,
    attachedToPlayerId,
    latestInput: null,
  };

  state.players.set(participant.playerId, player);
  teamPlayers.push(player);
  if (!player.isBot) {
    incrementTeamHumanCount(state, participant.team);
  }
  if (!state.teamLeaderIds.has(participant.team)) {
    state.teamLeaderIds.set(participant.team, participant.playerId);
    player.attachedToPlayerId = null;
  }
  if (!state.teamAutoDropAt.has(participant.team)) {
    state.teamAutoDropAt.set(participant.team, state.autoDropAt);
  }
  return player;
}

export function removeBattleRoyalDropParticipant(
  state: BattleRoyalDropState,
  playerId: string
): boolean {
  const player = state.players.get(playerId);
  if (!player) return false;

  state.players.delete(playerId);
  const teamPlayers = state.teamPlayers.get(player.team);
  if (teamPlayers) {
    for (let index = 0; index < teamPlayers.length; index++) {
      if (teamPlayers[index].playerId !== playerId) continue;
      teamPlayers.splice(index, 1);
      break;
    }
    if (teamPlayers.length === 0) {
      state.teamPlayers.delete(player.team);
      state.teamAutoDropAt.delete(player.team);
      state.teamDroppedAt.delete(player.team);
      state.teamLeaderIds.delete(player.team);
    }
  }

  if (!player.isBot) {
    decrementTeamHumanCount(state, player.team);
  }
  if (state.teamLeaderIds.get(player.team) === playerId) {
    state.teamLeaderIds.delete(player.team);
    ensureBattleRoyalDropTeamLeader(state, player.team);
  }

  return true;
}

export function shouldAutoDropBattleRoyalTeam(
  state: BattleRoyalDropState,
  team: Team,
  now: number
): boolean {
  if (state.teamDroppedAt.has(team)) return false;
  if (!isBattleRoyalDropShipDroppable(state, now)) return false;
  const hasHuman = (state.teamHumanCounts.get(team) ?? 0) > 0;
  if (now >= state.autoDropAt) return true;
  return !hasHuman && now >= (state.teamAutoDropAt.get(team) ?? state.autoDropAt);
}

export function startBattleRoyalTeamDrop(
  state: BattleRoyalDropState,
  team: Team,
  now: number,
  requestedByPlayerId?: string
): boolean {
  if (state.teamDroppedAt.has(team)) return false;
  if (!isBattleRoyalDropShipDroppable(state, now)) return false;
  const leader = ensureBattleRoyalDropTeamLeader(state, team);
  if (!leader) return false;
  if (requestedByPlayerId && requestedByPlayerId !== leader.playerId) return false;

  const shipPosition = getBattleRoyalDropShipPosition(state, now);
  const shipVelocity = getBattleRoyalDropShipVelocity(state);
  const leaderDropX = shipPosition.x + leader.slotOffset.x;
  const leaderDropY = shipPosition.y + leader.slotOffset.y;
  const leaderDropZ = shipPosition.z + leader.slotOffset.z;
  let droppedAny = false;
  for (const player of state.teamPlayers.get(team) ?? []) {
    if (player.status !== 'aboard') continue;
    player.status = 'dropping';
    player.droppedAt = now;
    writeVec3(player.position, leaderDropX, leaderDropY, leaderDropZ);
    writeVec3(player.velocity, shipVelocity.x, -BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED, shipVelocity.z);
    droppedAny = true;
  }

  if (droppedAny) {
    state.teamDroppedAt.set(team, now);
  }
  return droppedAny;
}

function advanceAboardPlayer(
  player: BattleRoyalDropPlayerState,
  shipPosition: Vec3,
  shipVelocity: Vec3
): void {
  writeVec3(
    player.position,
    shipPosition.x + player.slotOffset.x,
    shipPosition.y + player.slotOffset.y,
    shipPosition.z + player.slotOffset.z
  );
  copyVec3(player.velocity, shipVelocity);
}

function advanceDroppingPlayer(
  input: AdvanceBattleRoyalDropInput,
  player: BattleRoyalDropPlayerState
): void {
  const next = advanceBattleRoyalDropPodMotion({
    position: player.position,
    input: player.latestInput,
    dt: input.dt,
    getGroundY: input.getGroundY,
    clampToPlayableMap: input.clampToPlayableMap,
  });

  copyVec3(player.position, next.position);
  copyVec3(player.velocity, next.velocity);
  if (next.landed) {
    player.status = 'landed';
    player.landedAt = input.now;
  }
}

function advanceAttachedDroppingPlayer(
  input: AdvanceBattleRoyalDropInput,
  player: BattleRoyalDropPlayerState,
  leader: BattleRoyalDropPlayerState
): void {
  if (leader.status !== 'landed') {
    copyVec3(player.position, leader.position);
    copyVec3(player.velocity, leader.velocity);
    return;
  }

  const proposed = input.clampToPlayableMap({
    x: leader.position.x + player.landingOffset.x,
    y: leader.position.y + player.landingOffset.y,
    z: leader.position.z + player.landingOffset.z,
  });
  const groundY = input.getGroundY(proposed) ?? 0;
  const landingY = groundY + BATTLE_ROYAL_DROP_POD_LANDING_CLEARANCE;
  writeVec3(player.position, proposed.x, landingY, proposed.z);
  writeVec3(player.velocity, 0, 0, 0);
  player.status = 'landed';
  player.landedAt = input.now;
  player.attachedToPlayerId = null;
}

export function advanceBattleRoyalDropState(input: AdvanceBattleRoyalDropInput): void {
  for (const team of input.state.teamPlayers.keys()) {
    ensureBattleRoyalDropTeamLeader(input.state, team);
    if (shouldAutoDropBattleRoyalTeam(input.state, team, input.now)) {
      startBattleRoyalTeamDrop(input.state, team, input.now);
    }
  }

  const shipPosition = getBattleRoyalDropShipPosition(input.state, input.now);
  const shipVelocity = getBattleRoyalDropShipVelocity(input.state);
  for (const player of input.state.players.values()) {
    if (player.status === 'aboard') {
      advanceAboardPlayer(player, shipPosition, shipVelocity);
    } else if (player.status === 'dropping' && !player.attachedToPlayerId) {
      advanceDroppingPlayer(input, player);
    }
  }

  for (const player of input.state.players.values()) {
    if (player.status !== 'dropping' || !player.attachedToPlayerId) continue;
    const leader = ensureBattleRoyalDropTeamLeader(input.state, player.team);
    if (!leader || (leader.status !== 'dropping' && leader.status !== 'landed')) {
      continue;
    }
    advanceAttachedDroppingPlayer(input, player, leader);
  }
}

export function forceLandBattleRoyalDropState(input: AdvanceBattleRoyalDropInput): void {
  for (const team of input.state.teamPlayers.keys()) {
    startBattleRoyalTeamDrop(input.state, team, input.now);
  }

  for (const player of input.state.players.values()) {
    if (player.status === 'landed') continue;
    const leader = player.attachedToPlayerId
      ? input.state.players.get(player.attachedToPlayerId) ?? null
      : null;
    const basePosition = leader
      ? {
        x: leader.position.x + player.landingOffset.x,
        y: leader.position.y + player.landingOffset.y,
        z: leader.position.z + player.landingOffset.z,
      }
      : player.position;
    const clamped = input.clampToPlayableMap(basePosition);
    const groundY = input.getGroundY(clamped) ?? 0;
    writeVec3(player.position, clamped.x, groundY + BATTLE_ROYAL_DROP_POD_LANDING_CLEARANCE, clamped.z);
    writeVec3(player.velocity, 0, 0, 0);
    player.status = 'landed';
    player.landedAt = input.now;
    player.attachedToPlayerId = null;
  }
}

export function areAllBattleRoyalDropPlayersLanded(state: BattleRoyalDropState): boolean {
  if (state.players.size === 0) return false;
  for (const player of state.players.values()) {
    if (player.status !== 'landed') return false;
  }
  return true;
}

export function buildBattleRoyalDropSnapshot(
  state: BattleRoyalDropState,
  now: number
): BattleRoyalDropSnapshot {
  return {
    enabled: true,
    phaseStartedAt: state.phaseStartedAt,
    phaseEndsAt: state.phaseEndsAt,
    serverTime: now,
    ship: {
      start: { ...state.ship.start },
      end: { ...state.ship.end },
      position: getBattleRoyalDropShipPosition(state, now),
      altitude: state.ship.altitude,
      startedAt: state.phaseStartedAt,
      endsAt: state.phaseEndsAt,
      autoDropAt: state.autoDropAt,
      dropStartsAt: state.dropStartsAt,
      dropEndsAt: state.dropEndsAt,
      canDrop: isBattleRoyalDropShipDroppable(state, now),
    },
    players: Array.from(state.players.values()).map((player) => ({
      playerId: player.playerId,
      team: player.team,
      status: player.status,
      position: { ...player.position },
      velocity: { ...player.velocity },
      droppedAt: player.droppedAt,
      landedAt: player.landedAt,
      attachedToPlayerId: player.attachedToPlayerId,
    })),
  };
}
