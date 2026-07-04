import type {
  RecordingCameraMode,
  RecordingHudMode,
  RecordingViewport,
} from '@voxel-strike/shared';

export interface GameRoomRecordingOptions {
  id: string;
  requestedByAdminUserId: string;
  requestedDurationMs: number;
  maxDurationMs: number;
  fps: number;
  viewport: RecordingViewport;
  devicePixelRatio: number;
  cameraMode: RecordingCameraMode;
  hudMode: RecordingHudMode;
  hudSubjectPlayerId?: string | null;
  gameBuildId?: string | null;
  serverBuildId?: string | null;
}
