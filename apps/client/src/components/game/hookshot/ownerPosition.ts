import type { Player } from '@voxel-strike/shared';
import { visualStore } from '../../../store/visualStore';

interface Position {
  x: number;
  y: number;
  z: number;
}

export function getOwnerVisualPosition(
  ownerId: string,
  handHeight: number,
  fallback: Position,
  players: Map<string, Player>,
  localPlayer: Player | null
): Position {
  const visualPosition = visualStore.getState().playerPositions.get(ownerId);
  if (visualPosition) {
    return {
      x: visualPosition.x,
      y: visualPosition.y + handHeight,
      z: visualPosition.z,
    };
  }

  const owner = localPlayer?.id === ownerId ? localPlayer : players.get(ownerId);
  if (owner) {
    return {
      x: owner.position.x,
      y: owner.position.y + handHeight,
      z: owner.position.z,
    };
  }

  return fallback;
}
