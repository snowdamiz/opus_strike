import {
  DEFAULT_VOXEL_MAP_SIZE_ID,
  TRANSFORM_POSITION_SCALE,
  type BattleRoyalHeroSoulStateSnapshot,
  type BattleRoyalDropSnapshot,
  type FlagSync,
  type GameplayMode,
  type MapProfileId,
  type MatchPerspective,
  type MatchSnapshotMessage,
  type PregeneratedMapArtifactId,
  type PregeneratedMapId,
  type SafeZoneSnapshot,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';

const SAFE_ZONE_SIGNATURE_POSITION_SCALE = 0.25;

export interface BuildMatchSnapshotInput {
  tick: number;
  serverTime: number;
  phase: MatchSnapshotMessage['phase'];
  gameplayMode: GameplayMode;
  matchPerspective: MatchPerspective;
  mapSeed: number;
  mapThemeId: VoxelMapTheme['id'] | null;
  mapSize: VoxelMapSizeId | null;
  mapProfileId?: MapProfileId | null;
  pregeneratedMapId?: PregeneratedMapId | null;
  mapArtifactId?: PregeneratedMapArtifactId | null;
  redScore: number;
  blueScore: number;
  redFlag: FlagSync;
  blueFlag: FlagSync;
  roundTimeRemaining: number;
  phaseEndTime: number | null | undefined;
  gameClockFrozen: boolean;
  safeZone?: SafeZoneSnapshot | null;
  battleRoyalDrop?: BattleRoyalDropSnapshot | null;
  battleRoyalSouls?: BattleRoyalHeroSoulStateSnapshot | null;
}

export class MatchSnapshotRuntime {
  buildSnapshot(input: BuildMatchSnapshotInput): MatchSnapshotMessage {
    return {
      tick: input.tick,
      serverTime: input.serverTime,
      phase: input.phase,
      gameplayMode: input.gameplayMode,
      matchPerspective: input.matchPerspective,
      mapSeed: input.mapSeed,
      mapThemeId: input.mapThemeId,
      mapSize: input.mapSize,
      mapProfileId: input.mapProfileId ?? null,
      pregeneratedMapId: input.pregeneratedMapId ?? null,
      mapArtifactId: input.mapArtifactId ?? null,
      redScore: input.redScore,
      blueScore: input.blueScore,
      redFlag: input.redFlag,
      blueFlag: input.blueFlag,
      roundTimeRemaining: input.roundTimeRemaining,
      phaseEndTime: input.phaseEndTime || null,
      gameClockFrozen: input.gameClockFrozen,
      safeZone: input.safeZone ?? null,
      battleRoyalDrop: input.battleRoyalDrop ?? null,
      battleRoyalSouls: input.battleRoyalSouls ?? null,
    };
  }

  getSignature(snapshot: MatchSnapshotMessage): string {
    return [
      snapshot.phase,
      snapshot.mapSeed,
      snapshot.mapSize ?? DEFAULT_VOXEL_MAP_SIZE_ID,
      snapshot.mapProfileId ?? '',
      snapshot.gameplayMode,
      snapshot.matchPerspective,
      snapshot.redScore,
      snapshot.blueScore,
      snapshot.phaseEndTime ?? 0,
      snapshot.gameClockFrozen ? 1 : 0,
      snapshot.safeZone?.phaseIndex ?? -1,
      snapshot.safeZone ? this.quantizeSafeZonePosition(snapshot.safeZone.radius) : 0,
      snapshot.safeZone ? this.quantizeSafeZonePosition(snapshot.safeZone.center.x) : 0,
      snapshot.safeZone ? this.quantizeSafeZonePosition(snapshot.safeZone.center.z) : 0,
      snapshot.safeZone?.nextZoneRevealsAt ?? 0,
      snapshot.safeZone?.warning ? 1 : 0,
      snapshot.safeZone?.shrinking ? 1 : 0,
      snapshot.battleRoyalDrop?.phaseStartedAt ?? 0,
      snapshot.battleRoyalDrop?.phaseEndsAt ?? 0,
      snapshot.battleRoyalDrop?.players.map((player) => (
        `${player.playerId}.${player.status}.${player.droppedAt ?? 0}.${player.landedAt ?? 0}.${player.attachedToPlayerId ?? ''}`
      )).join(',') ?? '',
      snapshot.battleRoyalSouls?.souls.map((soul) => (
        [
          soul.soulId,
          soul.playerId,
          soul.status,
          soul.carriedByPlayerId ?? '',
          soul.collectByPlayerId ?? '',
          soul.collectCompletesAt ?? 0,
          soul.summonByPlayerId ?? '',
          soul.summonCircleId ?? '',
          soul.summonCompletesAt ?? 0,
          this.quantizePosition(soul.position.x),
          this.quantizePosition(soul.position.y),
          this.quantizePosition(soul.position.z),
        ].join('.')
      )).join(',') ?? '',
      snapshot.battleRoyalSouls?.interactions.map((interaction) => (
        `${interaction.playerId}.${interaction.kind}.${interaction.soulId ?? ''}.${interaction.circleId ?? ''}.${interaction.startedAt}.${interaction.completesAt}`
      )).join(',') ?? '',
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

  private quantizeSafeZonePosition(value: number): number {
    return Math.round(value * SAFE_ZONE_SIGNATURE_POSITION_SCALE);
  }
}
