import {
  DEFAULT_VOXEL_MAP_SIZE_ID,
  TRANSFORM_POSITION_SCALE,
  type FlagSync,
  type GameplayMode,
  type MapProfileId,
  type MatchSnapshotMessage,
  type SafeZoneSnapshot,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';

export interface BuildMatchSnapshotInput {
  tick: number;
  serverTime: number;
  phase: MatchSnapshotMessage['phase'];
  gameplayMode: GameplayMode;
  mapSeed: number;
  mapThemeId: VoxelMapTheme['id'] | null;
  mapSize: VoxelMapSizeId | null;
  mapProfileId?: MapProfileId | null;
  redScore: number;
  blueScore: number;
  redFlag: FlagSync;
  blueFlag: FlagSync;
  roundTimeRemaining: number;
  phaseEndTime: number | null | undefined;
  gameClockFrozen: boolean;
  safeZone?: SafeZoneSnapshot | null;
}

export class MatchSnapshotRuntime {
  buildSnapshot(input: BuildMatchSnapshotInput): MatchSnapshotMessage {
    return {
      tick: input.tick,
      serverTime: input.serverTime,
      phase: input.phase,
      gameplayMode: input.gameplayMode,
      mapSeed: input.mapSeed,
      mapThemeId: input.mapThemeId,
      mapSize: input.mapSize,
      mapProfileId: input.mapProfileId ?? null,
      redScore: input.redScore,
      blueScore: input.blueScore,
      redFlag: input.redFlag,
      blueFlag: input.blueFlag,
      roundTimeRemaining: input.roundTimeRemaining,
      phaseEndTime: input.phaseEndTime || null,
      gameClockFrozen: input.gameClockFrozen,
      safeZone: input.safeZone ?? null,
    };
  }

  getSignature(snapshot: MatchSnapshotMessage): string {
    return [
      snapshot.phase,
      snapshot.mapSeed,
      snapshot.mapSize ?? DEFAULT_VOXEL_MAP_SIZE_ID,
      snapshot.mapProfileId ?? '',
      snapshot.gameplayMode,
      snapshot.redScore,
      snapshot.blueScore,
      snapshot.phaseEndTime ?? 0,
      snapshot.gameClockFrozen ? 1 : 0,
      snapshot.safeZone?.phaseIndex ?? -1,
      snapshot.safeZone ? this.quantizePosition(snapshot.safeZone.radius) : 0,
      snapshot.safeZone ? this.quantizePosition(snapshot.safeZone.center.x) : 0,
      snapshot.safeZone ? this.quantizePosition(snapshot.safeZone.center.z) : 0,
      snapshot.safeZone?.warning ? 1 : 0,
      snapshot.safeZone?.shrinking ? 1 : 0,
      snapshot.redFlag.carrierId ?? '',
      snapshot.redFlag.isAtBase ? 1 : 0,
      this.quantizePosition(snapshot.redFlag.position.x),
      this.quantizePosition(snapshot.redFlag.position.y),
      this.quantizePosition(snapshot.redFlag.position.z),
      snapshot.blueFlag.carrierId ?? '',
      snapshot.blueFlag.isAtBase ? 1 : 0,
      this.quantizePosition(snapshot.blueFlag.position.x),
      this.quantizePosition(snapshot.blueFlag.position.y),
      this.quantizePosition(snapshot.blueFlag.position.z),
    ].join(':');
  }

  private quantizePosition(value: number): number {
    return Math.round(value * TRANSFORM_POSITION_SCALE);
  }
}
