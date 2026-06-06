import type { Player } from '@voxel-strike/shared';
import { visualStore } from '../../../store/visualStore';
import { calculatePlayerSocketPosition } from '../../../hooks/player/constants';

interface Position {
  x: number;
  y: number;
  z: number;
}

interface OwnerVisualOffset {
  forwardOffset?: number;
  sideOffset?: number;
  yaw?: number;
}

export function getOwnerVisualPosition(
  ownerId: string,
  handHeight: number,
  fallback: Position,
  players: Map<string, Player>,
  localPlayer: Player | null,
  offset: OwnerVisualOffset = {}
): Position {
  const visualState = visualStore.getState();
  const visualPosition = visualState.playerPositions.get(ownerId);
  const owner = localPlayer?.id === ownerId ? localPlayer : players.get(ownerId);
  const basePosition = visualPosition ?? owner?.position;

  if (!basePosition) return fallback;

  const yaw = visualState.playerRotations.get(ownerId) ?? owner?.lookYaw ?? offset.yaw ?? 0;

  return calculatePlayerSocketPosition(basePosition, yaw, {
    handHeight,
    forwardOffset: offset.forwardOffset ?? 0,
    sideOffset: offset.sideOffset ?? 0,
  });
}
