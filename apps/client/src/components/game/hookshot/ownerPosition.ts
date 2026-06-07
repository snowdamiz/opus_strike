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

export function writeOwnerVisualPosition(
  out: Position,
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

  if (!basePosition) {
    out.x = fallback.x;
    out.y = fallback.y;
    out.z = fallback.z;
    return out;
  }

  const yaw = visualState.playerRotations.get(ownerId) ?? owner?.lookYaw ?? offset.yaw ?? 0;
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  const forwardOffset = offset.forwardOffset ?? 0;
  const sideOffset = offset.sideOffset ?? 0;

  out.x = basePosition.x + forwardX * forwardOffset + rightX * sideOffset;
  out.y = basePosition.y + handHeight;
  out.z = basePosition.z + forwardZ * forwardOffset + rightZ * sideOffset;
  return out;
}
