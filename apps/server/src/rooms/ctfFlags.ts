import type { Team, VoxelMapManifest } from '@voxel-strike/shared';
import type { BotFlagSnapshot, PlainVec3 } from './bot-ai';
import type { Flag } from './schema/Components';
import type { GameState } from './schema/GameState';
import type { Player } from './schema/Player';
import {
  getCoarseEventPosition,
  vec3SchemaToPlain,
} from './roomMath';

export const CTF_TEAMS = ['red', 'blue'] as const;

export interface FlagSyncSnapshot {
  position: PlainVec3;
  carrierId: string | null;
  isAtBase: boolean;
}

export function getEnemyTeam(team: Team): Team {
  return team === 'red' ? 'blue' : 'red';
}

export function getFlagByTeam(state: GameState, team: Team): Flag {
  return team === 'red' ? state.redTeam.flag : state.blueTeam.flag;
}

export function getCarriedFlagCountForPlayer(state: GameState, playerId: string): number {
  return (state.redTeam.flag.carrierId === playerId ? 1 : 0)
    + (state.blueTeam.flag.carrierId === playerId ? 1 : 0);
}

export function getPublicFlagPosition(flag: Flag): PlainVec3 {
  const position = vec3SchemaToPlain(flag.position);
  return flag.carrierId ? getCoarseEventPosition(position) : position;
}

export function getFlagSync(state: GameState, team: Team): FlagSyncSnapshot {
  const flag = getFlagByTeam(state, team);
  return {
    position: getPublicFlagPosition(flag),
    carrierId: flag.carrierId || null,
    isAtBase: flag.isAtBase,
  };
}

export function getBotFlagSnapshots(state: GameState): Record<Team, BotFlagSnapshot> {
  const redFlag = getFlagByTeam(state, 'red');
  const blueFlag = getFlagByTeam(state, 'blue');
  return {
    red: {
      team: 'red',
      position: vec3SchemaToPlain(redFlag.position),
      basePosition: vec3SchemaToPlain(redFlag.basePosition),
      carrierId: redFlag.carrierId,
      isAtBase: redFlag.isAtBase,
      droppedAt: redFlag.droppedAt,
    },
    blue: {
      team: 'blue',
      position: vec3SchemaToPlain(blueFlag.position),
      basePosition: vec3SchemaToPlain(blueFlag.basePosition),
      carrierId: blueFlag.carrierId,
      isAtBase: blueFlag.isAtBase,
      droppedAt: blueFlag.droppedAt,
    },
  };
}

export function setFlagCarried(flag: Flag, playerId: string): void {
  flag.carrierId = playerId;
  flag.isAtBase = false;
  flag.droppedAt = 0;
}

export function syncCarriedFlagPosition(flag: Flag, carrier: Player | null | undefined): boolean {
  if (!carrier || carrier.state !== 'alive') {
    flag.carrierId = '';
    return false;
  }

  flag.position.x = carrier.position.x;
  flag.position.y = carrier.position.y + 1.4;
  flag.position.z = carrier.position.z;
  return true;
}

export function resetFlagToBase(flag: Flag): void {
  flag.position.x = flag.basePosition.x;
  flag.position.y = flag.basePosition.y;
  flag.position.z = flag.basePosition.z;
  flag.carrierId = '';
  flag.isAtBase = true;
  flag.droppedAt = 0;
}

export function setFlagDroppedAtPlayer(flag: Flag, player: Player, droppedAt: number): void {
  flag.position.x = player.position.x;
  flag.position.y = player.position.y;
  flag.position.z = player.position.z;
  flag.carrierId = '';
  flag.droppedAt = droppedAt;
  flag.isAtBase = false;
}

function resetFlagToManifestPosition(flag: Flag, position: PlainVec3): void {
  flag.basePosition.x = position.x;
  flag.basePosition.y = position.y;
  flag.basePosition.z = position.z;
  resetFlagToBase(flag);
}

export function resetFlagsFromManifest(state: GameState, manifest: VoxelMapManifest): void {
  const redFlag = manifest.gameplay?.flags?.red?.center ?? manifest.flagZones.red;
  const blueFlag = manifest.gameplay?.flags?.blue?.center ?? manifest.flagZones.blue;

  resetFlagToManifestPosition(state.redTeam.flag, redFlag);
  resetFlagToManifestPosition(state.blueTeam.flag, blueFlag);
}
