import type { Team } from '@voxel-strike/shared';

export interface RemoteLodCandidate {
  id: string;
  team?: Team;
  hasFlag?: boolean;
  recentCombat?: boolean;
  visibleThreat?: boolean;
  position: { x: number; y: number; z: number };
}

export interface RemoteLodCameraPosition {
  x: number;
  y: number;
  z: number;
}

const PREVIOUS_SELECTION_DISTANCE_BIAS = 0.92;

function distanceSquared(a: RemoteLodCameraPosition, b: RemoteLodCameraPosition): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function isPriorityCandidate(candidate: RemoteLodCandidate): boolean {
  return Boolean(candidate.hasFlag || candidate.recentCombat || candidate.visibleThreat);
}

export function selectRemoteFullBodyIds(
  candidates: readonly RemoteLodCandidate[],
  cameraPosition: RemoteLodCameraPosition,
  limit: number,
  previousIds: ReadonlySet<string>,
  outIds: string[],
  outDistances: number[]
): string[] {
  outIds.length = 0;
  outDistances.length = 0;

  const maxIds = Math.max(0, Math.floor(limit));
  if (maxIds === 0 || candidates.length === 0) return outIds;

  for (const candidate of candidates) {
    if (!isPriorityCandidate(candidate)) continue;
    const distance = distanceSquared(cameraPosition, candidate.position);
    insertCandidate(candidate.id, distance, maxIds, outIds, outDistances);
  }
  const priorityCount = outIds.length;

  for (const candidate of candidates) {
    if (isPriorityCandidate(candidate)) continue;
    const rawDistance = distanceSquared(cameraPosition, candidate.position);
    const biasedDistance = previousIds.has(candidate.id)
      ? rawDistance * PREVIOUS_SELECTION_DISTANCE_BIAS
      : rawDistance;
    insertCandidate(candidate.id, biasedDistance, maxIds, outIds, outDistances, priorityCount);
  }

  return outIds;
}

function insertCandidate(
  id: string,
  distance: number,
  limit: number,
  outIds: string[],
  outDistances: number[],
  lockedPrefix = 0
): void {
  if (outIds.includes(id)) return;

  let insertAt = outIds.length;
  while (insertAt > lockedPrefix && distance < outDistances[insertAt - 1]) {
    insertAt--;
  }

  if (insertAt >= limit) return;

  outIds.splice(insertAt, 0, id);
  outDistances.splice(insertAt, 0, distance);
  if (outIds.length > limit) {
    outIds.length = limit;
    outDistances.length = limit;
  }
}
