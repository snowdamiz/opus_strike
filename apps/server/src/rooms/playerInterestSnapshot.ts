import type { PlayerInterestSnapshot } from '@voxel-strike/shared';
import type { RecipientInterestDecision } from './visibilityInterest';

function roundInterestCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

export function buildPlayerInterestSnapshot(
  playerId: string,
  decision: RecipientInterestDecision
): PlayerInterestSnapshot {
  return {
    playerId,
    state: decision.state,
    reason: decision.reason,
    lastKnownPosition: decision.state === 'last_known' && decision.lastKnownPosition
      ? {
        x: roundInterestCoordinate(decision.lastKnownPosition.x),
        y: roundInterestCoordinate(decision.lastKnownPosition.y),
        z: roundInterestCoordinate(decision.lastKnownPosition.z),
      }
      : undefined,
  };
}

export function getPlayerInterestSignature(snapshot: PlayerInterestSnapshot): string {
  const lastKnown = snapshot.lastKnownPosition
    ? [
      Math.round(snapshot.lastKnownPosition.x * 10),
      Math.round(snapshot.lastKnownPosition.y * 10),
      Math.round(snapshot.lastKnownPosition.z * 10),
    ].join(',')
    : '';

  return [
    snapshot.state,
    snapshot.reason ?? '',
    lastKnown,
  ].join(':');
}

export function selectChangedPlayerInterestSnapshot(input: {
  signatures: Map<string, string>;
  playerId: string;
  snapshot: PlayerInterestSnapshot;
  force: boolean;
}): PlayerInterestSnapshot | null {
  const signature = getPlayerInterestSignature(input.snapshot);
  if (!input.force && input.signatures.get(input.playerId) === signature) {
    return null;
  }

  input.signatures.set(input.playerId, signature);
  return input.snapshot;
}

export function removeMissingPlayerInterestSignatures(
  signatures: Map<string, string>,
  currentPlayerIds: ReadonlySet<string>
): string[] {
  const removedPlayerIds: string[] = [];
  for (const playerId of signatures.keys()) {
    if (currentPlayerIds.has(playerId)) continue;
    signatures.delete(playerId);
    removedPlayerIds.push(playerId);
  }
  return removedPlayerIds;
}
