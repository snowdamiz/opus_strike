import type { MatchStartGateMessage } from '@voxel-strike/shared';

export interface MatchStartReadinessPlayer {
  isBot?: boolean | null;
  role?: string | null;
  heroId?: string | null;
  isReady?: boolean | null;
}

export interface PlayerIdLookup {
  has(playerId: string): boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function readMatchSceneReadyGateKey(payload: unknown): number | null {
  if (!isRecord(payload)) return null;
  return typeof payload.key === 'number' && Number.isInteger(payload.key)
    ? payload.key
    : null;
}

export function canMarkMatchSceneReady(player: MatchStartReadinessPlayer | null | undefined): boolean {
  return Boolean(player && !player.isBot && player.role !== 'observer' && player.heroId && player.isReady);
}

export function countConnectedHumanPlayers(
  players: Iterable<MatchStartReadinessPlayer>
): number {
  let count = 0;
  for (const player of players) {
    if (player.role === 'observer') continue;
    if (!player.isBot) count++;
  }
  return count;
}

export function hasRequiredHumanPlayersConnected(
  players: Iterable<MatchStartReadinessPlayer>,
  requiredHumanPlayers: number
): boolean {
  return countConnectedHumanPlayers(players) >= requiredHumanPlayers;
}

export function arePlayersReadyForCountdown(input: {
  players: Iterable<MatchStartReadinessPlayer>;
  requiredHumanPlayers: number;
}): boolean {
  let playerCount = 0;
  let connectedHumanPlayers = 0;

  for (const player of input.players) {
    if (player.role === 'observer') continue;
    playerCount++;
    if (!player.isBot) connectedHumanPlayers++;
    if (!player.heroId || !player.isReady) {
      return false;
    }
  }

  return playerCount > 0 && connectedHumanPlayers >= input.requiredHumanPlayers;
}

export function shouldOpenCountdownStartGate(input: {
  playersReadyForCountdown: boolean;
  countdownStartGateOpen: boolean;
}): boolean {
  return input.playersReadyForCountdown && !input.countdownStartGateOpen;
}

export function shouldStartCountdownAfterSceneReady(input: {
  playersReadyForCountdown: boolean;
  humansSceneReadyForCountdown: boolean;
}): boolean {
  return input.playersReadyForCountdown && input.humansSceneReadyForCountdown;
}

export function areHumansSceneReadyForCountdown(input: {
  players: Iterable<readonly [string, MatchStartReadinessPlayer]>;
  connectedClientIds: PlayerIdLookup;
  sceneReadyPlayerIds: PlayerIdLookup;
  countdownStartGateOpen: boolean;
  requiredHumanPlayers: number;
}): boolean {
  if (!input.countdownStartGateOpen) return false;

  let connectedHumanPlayers = 0;
  for (const [playerId, player] of input.players) {
    if (player.role === 'observer') continue;
    if (player.isBot) continue;

    connectedHumanPlayers++;
    if (!input.connectedClientIds.has(playerId) || !input.sceneReadyPlayerIds.has(playerId)) {
      return false;
    }
  }

  return connectedHumanPlayers >= input.requiredHumanPlayers;
}

export function buildMatchStartGatePayload(input: {
  key: number;
  serverTime: number;
  mapSeed: number;
  mapThemeId: string;
  mapSize: NonNullable<MatchStartGateMessage['mapSize']>;
  mapProfileId?: NonNullable<MatchStartGateMessage['mapProfileId']>;
  position: MatchStartGateMessage['position'];
  movementEpoch: number;
  ackSeq: number;
  collisionRevision: number;
}): MatchStartGateMessage {
  return {
    key: input.key,
    serverTime: input.serverTime,
    mapSeed: input.mapSeed,
    mapThemeId: input.mapThemeId as MatchStartGateMessage['mapThemeId'],
    mapSize: input.mapSize,
    mapProfileId: input.mapProfileId ?? 'ctf_arena',
    position: input.position,
    movementEpoch: input.movementEpoch,
    ackSeq: input.ackSeq,
    collisionRevision: input.collisionRevision,
  };
}

export class MatchStartGateTracker {
  private open = false;
  private currentKey = 0;
  private readonly sceneReadyPlayerIds = new Set<string>();

  get key(): number {
    return this.currentKey;
  }

  isOpen(): boolean {
    return this.open;
  }

  reset(): void {
    this.open = false;
    this.sceneReadyPlayerIds.clear();
    this.currentKey++;
  }

  openGate(): boolean {
    if (this.open) return false;

    this.open = true;
    this.sceneReadyPlayerIds.clear();
    this.currentKey++;
    return true;
  }

  canAcceptSceneReadyKey(key: number | null): boolean {
    return this.open && key === this.currentKey;
  }

  markSceneReady(playerId: string): void {
    this.sceneReadyPlayerIds.add(playerId);
  }

  clearPlayer(playerId: string): void {
    this.sceneReadyPlayerIds.delete(playerId);
  }

  areHumansSceneReady(input: {
    players: Iterable<readonly [string, MatchStartReadinessPlayer]>;
    connectedClientIds: PlayerIdLookup;
    requiredHumanPlayers: number;
  }): boolean {
    return areHumansSceneReadyForCountdown({
      ...input,
      sceneReadyPlayerIds: this.sceneReadyPlayerIds,
      countdownStartGateOpen: this.open,
    });
  }
}
