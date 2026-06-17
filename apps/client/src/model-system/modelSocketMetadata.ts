import {
  BLAZE_ROCKET_STAFF_SOCKET,
  BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
  CHRONOS_PRIMARY_ORB_SOCKET,
  CHRONOS_PRIMARY_ORB_SOCKET_NAME,
  HOOKSHOT_CHAIN_SOCKET,
  HOOKSHOT_HOOK_SOCKET_NAMES,
  PHANTOM_DIRE_BALL_SOCKET,
  PHANTOM_PRIMARY_PALM_SOCKET_NAMES,
  PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
  PHANTOM_VOID_RAY_SOCKET,
  type ModelSocketRole,
  type ModelSide,
  type PlayerSocketOffset,
} from '@voxel-strike/shared';

export interface SocketMetadata {
  role: ModelSocketRole;
  side?: ModelSide;
  fallbackOffset: PlayerSocketOffset;
}

function sidedFallback(
  fallbackOffset: PlayerSocketOffset,
  side: ModelSide
): PlayerSocketOffset {
  return {
    ...fallbackOffset,
    sideOffset: fallbackOffset.sideOffset * side,
  };
}

export const SOCKET_METADATA_BY_NAME: Record<string, SocketMetadata> = {
  [PHANTOM_PRIMARY_PALM_SOCKET_NAMES[-1]]: {
    role: 'primaryPalm',
    side: -1,
    fallbackOffset: sidedFallback(PHANTOM_DIRE_BALL_SOCKET, -1),
  },
  [PHANTOM_PRIMARY_PALM_SOCKET_NAMES[1]]: {
    role: 'primaryPalm',
    side: 1,
    fallbackOffset: sidedFallback(PHANTOM_DIRE_BALL_SOCKET, 1),
  },
  [PHANTOM_VOID_RAY_ORB_SOCKET_NAME]: {
    role: 'voidRayOrb',
    fallbackOffset: PHANTOM_VOID_RAY_SOCKET,
  },
  [HOOKSHOT_HOOK_SOCKET_NAMES[-1]]: {
    role: 'hookTip',
    side: -1,
    fallbackOffset: sidedFallback(HOOKSHOT_CHAIN_SOCKET, -1),
  },
  [HOOKSHOT_HOOK_SOCKET_NAMES[1]]: {
    role: 'hookTip',
    side: 1,
    fallbackOffset: sidedFallback(HOOKSHOT_CHAIN_SOCKET, 1),
  },
  [BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME]: {
    role: 'staffTip',
    side: 1,
    fallbackOffset: BLAZE_ROCKET_STAFF_SOCKET,
  },
  [CHRONOS_PRIMARY_ORB_SOCKET_NAME]: {
    role: 'chronosPrimaryOrb',
    fallbackOffset: CHRONOS_PRIMARY_ORB_SOCKET,
  },
};

export function getSocketMetadata(socketName: string): SocketMetadata {
  const metadata = SOCKET_METADATA_BY_NAME[socketName];
  if (!metadata) {
    throw new Error(`Missing socket metadata for ${socketName}`);
  }
  return metadata;
}

