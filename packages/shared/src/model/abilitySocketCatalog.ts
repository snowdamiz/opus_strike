import {
  BLAZE_FLAMETHROWER_SOCKET,
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
  type PlayerSocketOffset,
} from '../constants/physics.js';
import { calculatePlayerSocketPosition, type Vec3Like } from '../utils/playerGeometry.js';
import type { HeroId } from '../types/hero.js';
import type {
  AbilitySocketSideMode,
  ModelSide,
  ModelSocketRole,
} from '../types/modelSystem.js';

export interface AbilitySocketCatalogEntry {
  abilityId: string;
  heroId: HeroId;
  socketRole: ModelSocketRole;
  sideMode: AbilitySocketSideMode;
  socketNames: readonly string[];
  fallbackOffset: PlayerSocketOffset;
}

export interface ResolveAbilitySocketOptions {
  abilityId: string;
  side?: ModelSide;
}

export interface ResolvedAbilitySocket {
  abilityId: string;
  heroId: HeroId;
  socketRole: ModelSocketRole;
  side: ModelSide | null;
  socketNames: readonly string[];
  fallbackOffset: PlayerSocketOffset;
}

function sideSocketNames(
  names: Readonly<Record<ModelSide, string>>,
  sideMode: AbilitySocketSideMode
): readonly string[] {
  if (sideMode === 'both') return [names[1], names[-1]];
  if (sideMode === 'left') return [names[-1]];
  if (sideMode === 'right') return [names[1]];
  return [names[1], names[-1]];
}

export const ABILITY_SOCKET_CATALOG = {
  phantom_dire_ball: {
    abilityId: 'phantom_dire_ball',
    heroId: 'phantom',
    socketRole: 'primaryPalm',
    sideMode: 'launchSide',
    socketNames: sideSocketNames(PHANTOM_PRIMARY_PALM_SOCKET_NAMES, 'both'),
    fallbackOffset: PHANTOM_DIRE_BALL_SOCKET,
  },
  phantom_void_ray_charge: {
    abilityId: 'phantom_void_ray_charge',
    heroId: 'phantom',
    socketRole: 'voidRayOrb',
    sideMode: 'center',
    socketNames: [PHANTOM_VOID_RAY_ORB_SOCKET_NAME],
    fallbackOffset: PHANTOM_VOID_RAY_SOCKET,
  },
  phantom_void_ray: {
    abilityId: 'phantom_void_ray',
    heroId: 'phantom',
    socketRole: 'voidRayOrb',
    sideMode: 'center',
    socketNames: [PHANTOM_VOID_RAY_ORB_SOCKET_NAME],
    fallbackOffset: PHANTOM_VOID_RAY_SOCKET,
  },
  phantom_personal_shield: {
    abilityId: 'phantom_personal_shield',
    heroId: 'phantom',
    socketRole: 'primaryPalm',
    sideMode: 'both',
    socketNames: sideSocketNames(PHANTOM_PRIMARY_PALM_SOCKET_NAMES, 'both'),
    fallbackOffset: PHANTOM_DIRE_BALL_SOCKET,
  },
  hookshot_basic_attack: {
    abilityId: 'hookshot_basic_attack',
    heroId: 'hookshot',
    socketRole: 'hookTip',
    sideMode: 'launchSide',
    socketNames: sideSocketNames(HOOKSHOT_HOOK_SOCKET_NAMES, 'both'),
    fallbackOffset: HOOKSHOT_CHAIN_SOCKET,
  },
  hookshot_heavy_attack: {
    abilityId: 'hookshot_heavy_attack',
    heroId: 'hookshot',
    socketRole: 'hookTip',
    sideMode: 'right',
    socketNames: sideSocketNames(HOOKSHOT_HOOK_SOCKET_NAMES, 'right'),
    fallbackOffset: HOOKSHOT_CHAIN_SOCKET,
  },
  hookshot_grapple: {
    abilityId: 'hookshot_grapple',
    heroId: 'hookshot',
    socketRole: 'hookTip',
    sideMode: 'right',
    socketNames: sideSocketNames(HOOKSHOT_HOOK_SOCKET_NAMES, 'right'),
    fallbackOffset: HOOKSHOT_CHAIN_SOCKET,
  },
  blaze_rocket: {
    abilityId: 'blaze_rocket',
    heroId: 'blaze',
    socketRole: 'staffTip',
    sideMode: 'right',
    socketNames: [BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME],
    fallbackOffset: BLAZE_ROCKET_STAFF_SOCKET,
  },
  blaze_bomb: {
    abilityId: 'blaze_bomb',
    heroId: 'blaze',
    socketRole: 'staffTip',
    sideMode: 'right',
    socketNames: [BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME],
    fallbackOffset: BLAZE_ROCKET_STAFF_SOCKET,
  },
  blaze_flamethrower: {
    abilityId: 'blaze_flamethrower',
    heroId: 'blaze',
    socketRole: 'staffTip',
    sideMode: 'right',
    socketNames: [BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME],
    fallbackOffset: BLAZE_FLAMETHROWER_SOCKET,
  },
  blaze_rocketjump: {
    abilityId: 'blaze_rocketjump',
    heroId: 'blaze',
    socketRole: 'staffTip',
    sideMode: 'right',
    socketNames: [BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME],
    fallbackOffset: BLAZE_ROCKET_STAFF_SOCKET,
  },
  chronos_verdant_pulse: {
    abilityId: 'chronos_verdant_pulse',
    heroId: 'chronos',
    socketRole: 'chronosPrimaryOrb',
    sideMode: 'center',
    socketNames: [CHRONOS_PRIMARY_ORB_SOCKET_NAME],
    fallbackOffset: CHRONOS_PRIMARY_ORB_SOCKET,
  },
  chronos_lifeline_conduit: {
    abilityId: 'chronos_lifeline_conduit',
    heroId: 'chronos',
    socketRole: 'chronosPrimaryOrb',
    sideMode: 'center',
    socketNames: [CHRONOS_PRIMARY_ORB_SOCKET_NAME],
    fallbackOffset: CHRONOS_PRIMARY_ORB_SOCKET,
  },
  chronos_timebreak: {
    abilityId: 'chronos_timebreak',
    heroId: 'chronos',
    socketRole: 'chronosPrimaryOrb',
    sideMode: 'center',
    socketNames: [CHRONOS_PRIMARY_ORB_SOCKET_NAME],
    fallbackOffset: CHRONOS_PRIMARY_ORB_SOCKET,
  },
  chronos_ascendant_paradox: {
    abilityId: 'chronos_ascendant_paradox',
    heroId: 'chronos',
    socketRole: 'chronosPrimaryOrb',
    sideMode: 'center',
    socketNames: [CHRONOS_PRIMARY_ORB_SOCKET_NAME],
    fallbackOffset: CHRONOS_PRIMARY_ORB_SOCKET,
  },
} as const satisfies Record<string, AbilitySocketCatalogEntry>;

export type CatalogedAbilitySocketId = keyof typeof ABILITY_SOCKET_CATALOG;

export function getAbilitySocketCatalogEntry(
  abilityId: string
): AbilitySocketCatalogEntry | null {
  return ABILITY_SOCKET_CATALOG[abilityId as CatalogedAbilitySocketId] ?? null;
}

export function resolveAbilitySocketSide(
  entry: Pick<AbilitySocketCatalogEntry, 'sideMode'>,
  requestedSide?: ModelSide
): ModelSide | null {
  if (entry.sideMode === 'center') return null;
  if (entry.sideMode === 'left') return -1;
  if (entry.sideMode === 'right') return 1;
  if (entry.sideMode === 'launchSide') return requestedSide ?? 1;
  return requestedSide ?? null;
}

export function resolveAbilitySocket({
  abilityId,
  side,
}: ResolveAbilitySocketOptions): ResolvedAbilitySocket | null {
  const entry = getAbilitySocketCatalogEntry(abilityId);
  if (!entry) return null;

  const resolvedSide = resolveAbilitySocketSide(entry, side);
  const socketNames = resolvedSide && entry.sideMode !== 'center'
    ? socketNamesForRole(entry.socketRole, resolvedSide)
    : entry.socketNames;

  return {
    abilityId: entry.abilityId,
    heroId: entry.heroId,
    socketRole: entry.socketRole,
    side: resolvedSide,
    socketNames,
    fallbackOffset: resolveFallbackOffsetForSide(entry.fallbackOffset, resolvedSide),
  };
}

export function socketNamesForRole(
  role: ModelSocketRole,
  side?: ModelSide | null
): readonly string[] {
  if (role === 'primaryPalm') {
    return side ? [PHANTOM_PRIMARY_PALM_SOCKET_NAMES[side]] : [PHANTOM_PRIMARY_PALM_SOCKET_NAMES[1], PHANTOM_PRIMARY_PALM_SOCKET_NAMES[-1]];
  }
  if (role === 'hookTip') {
    return side ? [HOOKSHOT_HOOK_SOCKET_NAMES[side]] : [HOOKSHOT_HOOK_SOCKET_NAMES[1], HOOKSHOT_HOOK_SOCKET_NAMES[-1]];
  }
  if (role === 'staffTip') return [BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME];
  if (role === 'voidRayOrb') return [PHANTOM_VOID_RAY_ORB_SOCKET_NAME];
  return [CHRONOS_PRIMARY_ORB_SOCKET_NAME];
}

export function resolveFallbackOffsetForSide(
  offset: PlayerSocketOffset,
  side: ModelSide | null
): PlayerSocketOffset {
  return {
    ...offset,
    sideOffset: side ? offset.sideOffset * side : 0,
  };
}

export function calculateAbilityFallbackSocketOrigin(
  position: Vec3Like,
  yaw: number,
  options: ResolveAbilitySocketOptions
): Vec3Like | null {
  const resolved = resolveAbilitySocket(options);
  if (!resolved) return null;
  return calculatePlayerSocketPosition(position, yaw, resolved.fallbackOffset);
}

export function isCatalogedAbilitySocketId(
  abilityId: string
): abilityId is CatalogedAbilitySocketId {
  return abilityId in ABILITY_SOCKET_CATALOG;
}
