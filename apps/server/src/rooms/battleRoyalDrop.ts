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

const DROP_SHIP_ALTITUDE = 132;
const DROP_SHIP_EDGE_PADDING = 88;
const DROP_SHIP_AUTO_DROP_LEAD_MS = 5_500;
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
  teamAutoDropAt: Map<Team, number>;
  teamDroppedAt: Map<Team, number>;
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

export function getBattleRoyalDropShipVelocity(state: BattleRoyalDropState): Vec3 {
  const seconds = Math.max(0.001, (state.phaseEndsAt - state.phaseStartedAt) / 1000);
  return {
    x: (state.ship.end.x - state.ship.start.x) / seconds,
    y: 0,
    z: (state.ship.end.z - state.ship.start.z) / seconds,
  };
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
    autoDropAt,
    ship,
    dropStartsAt,
    dropEndsAt,
    players: new Map(),
    teamAutoDropAt: new Map(),
    teamDroppedAt: new Map(),
  });
  const players = new Map<string, BattleRoyalDropPlayerState>();
  const teamAutoDropAt = new Map<Team, number>();
  const teamSlotCounts = new Map<Team, number>();

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

    const teamSlot = teamSlotCounts.get(participant.team) ?? 0;
    teamSlotCounts.set(participant.team, teamSlot + 1);
    const slotOffset = createSlotOffset(teamSlot);
    players.set(participant.playerId, {
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
      latestInput: null,
    });
  }

  return {
    phaseStartedAt: now,
    phaseEndsAt,
    autoDropAt,
    ship,
    dropStartsAt,
    dropEndsAt,
    players,
    teamAutoDropAt,
    teamDroppedAt: new Map(),
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
  const teamSlot = Array.from(state.players.values())
    .filter((player) => player.team === participant.team)
    .length;
  const slotOffset = createSlotOffset(teamSlot);
  const shipPosition = getBattleRoyalDropShipPosition(state, now);
  const shipVelocity = getBattleRoyalDropShipVelocity(state);
  const alreadyDropped = state.teamDroppedAt.has(participant.team);
  const player: BattleRoyalDropPlayerState = {
    playerId: participant.playerId,
    team: participant.team,
    isBot: participant.isBot === true,
    status: alreadyDropped ? 'dropping' : 'aboard',
    position: {
      x: shipPosition.x + slotOffset.x,
      y: shipPosition.y + slotOffset.y,
      z: shipPosition.z + slotOffset.z,
    },
    velocity: alreadyDropped
      ? { x: shipVelocity.x, y: -BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED, z: shipVelocity.z }
      : shipVelocity,
    droppedAt: alreadyDropped ? now : null,
    landedAt: null,
    slotOffset,
    latestInput: null,
  };

  state.players.set(participant.playerId, player);
  if (!state.teamAutoDropAt.has(participant.team)) {
    state.teamAutoDropAt.set(participant.team, state.autoDropAt);
  }
  return player;
}

export function shouldAutoDropBattleRoyalTeam(
  state: BattleRoyalDropState,
  team: Team,
  now: number
): boolean {
  if (state.teamDroppedAt.has(team)) return false;
  if (!isBattleRoyalDropShipDroppable(state, now)) return false;
  const hasHuman = Array.from(state.players.values()).some((player) => player.team === team && !player.isBot);
  if (now >= state.autoDropAt) return true;
  return !hasHuman && now >= (state.teamAutoDropAt.get(team) ?? state.autoDropAt);
}

export function startBattleRoyalTeamDrop(
  state: BattleRoyalDropState,
  team: Team,
  now: number
): boolean {
  if (state.teamDroppedAt.has(team)) return false;
  if (!isBattleRoyalDropShipDroppable(state, now)) return false;

  const shipPosition = getBattleRoyalDropShipPosition(state, now);
  const shipVelocity = getBattleRoyalDropShipVelocity(state);
  let droppedAny = false;
  for (const player of state.players.values()) {
    if (player.team !== team || player.status !== 'aboard') continue;
    player.status = 'dropping';
    player.droppedAt = now;
    player.position = {
      x: shipPosition.x + player.slotOffset.x,
      y: shipPosition.y + player.slotOffset.y,
      z: shipPosition.z + player.slotOffset.z,
    };
    player.velocity = {
      x: shipVelocity.x,
      y: -BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED,
      z: shipVelocity.z,
    };
    droppedAny = true;
  }

  if (droppedAny) {
    state.teamDroppedAt.set(team, now);
  }
  return droppedAny;
}

function advanceAboardPlayer(
  state: BattleRoyalDropState,
  player: BattleRoyalDropPlayerState,
  now: number
): void {
  const shipPosition = getBattleRoyalDropShipPosition(state, now);
  player.position = {
    x: shipPosition.x + player.slotOffset.x,
    y: shipPosition.y + player.slotOffset.y,
    z: shipPosition.z + player.slotOffset.z,
  };
  player.velocity = getBattleRoyalDropShipVelocity(state);
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

  player.position = next.position;
  player.velocity = next.velocity;
  if (next.landed) {
    player.status = 'landed';
    player.landedAt = input.now;
  }
}

export function advanceBattleRoyalDropState(input: AdvanceBattleRoyalDropInput): void {
  for (const team of new Set(Array.from(input.state.players.values()).map((player) => player.team))) {
    if (shouldAutoDropBattleRoyalTeam(input.state, team, input.now)) {
      startBattleRoyalTeamDrop(input.state, team, input.now);
    }
  }

  for (const player of input.state.players.values()) {
    if (player.status === 'aboard') {
      advanceAboardPlayer(input.state, player, input.now);
    } else if (player.status === 'dropping') {
      advanceDroppingPlayer(input, player);
    }
  }
}

export function forceLandBattleRoyalDropState(input: AdvanceBattleRoyalDropInput): void {
  for (const team of new Set(Array.from(input.state.players.values()).map((player) => player.team))) {
    startBattleRoyalTeamDrop(input.state, team, input.now);
  }

  for (const player of input.state.players.values()) {
    if (player.status === 'landed') continue;
    const clamped = input.clampToPlayableMap(player.position);
    const groundY = input.getGroundY(clamped) ?? 0;
    player.position = {
      x: clamped.x,
      y: groundY + BATTLE_ROYAL_DROP_POD_LANDING_CLEARANCE,
      z: clamped.z,
    };
    player.velocity = { x: 0, y: 0, z: 0 };
    player.status = 'landed';
    player.landedAt = input.now;
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
    })),
  };
}
