import type { BotDifficulty, PlayerRole, Team } from './player.js';
import type { GamePhase } from './game.js';
import type { GameplayMode } from './gameplayMode.js';
import type { HeroId } from './hero.js';
import type { MatchMode } from './matchMode.js';
import type { MatchPerspective } from './matchPerspective.js';
import type { HeroSkinId } from './skins.js';
import type { InputState } from './input.js';
import type { MapProfileId, VoxelMapSizeId, VoxelMapTheme } from '../maps/procedural/types.js';
import type { PregeneratedMapArtifactId, PregeneratedMapId } from '../maps/pregenerated.js';

export const RECORDING_ARTIFACT_VERSION = 1 as const;

export type RecordingStatus =
  | 'creating'
  | 'recording'
  | 'stopping'
  | 'finalized'
  | 'failed';

export type RecordingRenderStatus =
  | 'not_started'
  | 'queued'
  | 'rendering'
  | 'succeeded'
  | 'failed';

export type RecordingRenderStage =
  | 'queued'
  | 'preparing'
  | 'capturing'
  | 'transcoding'
  | 'finalizing'
  | 'complete';

export type RecordingCameraMode = 'directed' | 'fixed_aerial';
export type RecordingHudMode = 'hidden' | 'selected_player' | 'cinematic_observer';
export type RecordingSource = 'bot_match';

export interface RecordingViewport {
  width: number;
  height: number;
}

export interface RecordingMapIdentity {
  seed: number;
  themeId: VoxelMapTheme['id'] | null;
  size: VoxelMapSizeId;
  profileId: MapProfileId | null;
  pregeneratedMapId: PregeneratedMapId | null;
  artifactId: PregeneratedMapArtifactId | null;
}

export interface RecordingBotAssignment {
  playerId: string;
  playerName: string;
  team: Team;
  heroId: HeroId | null;
  skinId: HeroSkinId | null;
  botDifficulty: BotDifficulty;
  botProfileId: string;
}

export interface RecordingRoomOptions {
  lobbyName: string;
  matchMode: MatchMode;
  gameplayMode: GameplayMode;
  matchPerspective: MatchPerspective;
  rankedEligible: boolean;
  requiredHumanPlayers: number;
  reservedHumanPlayers: number;
  capacityPlayerCost: number;
  streamerManagedBotGame: boolean;
  streamerFeedMode: string | null;
  streamerCameraMode: string | null;
  endlessMatch: boolean;
}

export interface RecordingArtifactRefs {
  manifest: string;
  events: string;
  actions: string;
  checkpoints: string;
  summary: string;
  mp4?: string | null;
}

export interface RecordingFileChecksums {
  eventsSha256?: string;
  actionsSha256?: string;
  checkpointsSha256?: string;
  summarySha256?: string;
  mp4Sha256?: string;
}

export interface RecordingManifest {
  recordingVersion: typeof RECORDING_ARTIFACT_VERSION;
  id: string;
  source: RecordingSource;
  status: RecordingStatus;
  createdAt: string;
  startedAt: string | null;
  finalizedAt: string | null;
  requestedDurationMs: number;
  maxDurationMs: number;
  fps: number;
  viewport: RecordingViewport;
  devicePixelRatio: number;
  cameraMode: RecordingCameraMode;
  hudMode: RecordingHudMode;
  hudSubjectPlayerId: string | null;
  gameBuildId: string | null;
  serverBuildId: string | null;
  roomId: string | null;
  matchId: string | null;
  map: RecordingMapIdentity;
  gameMode: GameplayMode;
  matchMode: MatchMode;
  matchPerspective: MatchPerspective;
  botAssignments: RecordingBotAssignment[];
  roomOptions: RecordingRoomOptions;
  artifacts: RecordingArtifactRefs;
  checksums: RecordingFileChecksums;
  error: string | null;
}

export interface RecordingEventRow<TPayload = unknown> {
  recordingTimeMs: number;
  serverTime: number;
  tick: number;
  type: string;
  payload: TPayload;
}

export type RecordingActionKind =
  | 'bot_input'
  | 'accepted_movement_command'
  | 'combat_event'
  | 'objective_event';

export interface RecordingActionButtons extends InputState {
  crouchPressed?: boolean;
}

export interface RecordingActionRow {
  recordingTimeMs: number;
  serverTime: number;
  tick: number;
  playerId: string;
  kind: RecordingActionKind;
  buttons?: Partial<RecordingActionButtons>;
  lookYaw?: number;
  lookPitch?: number;
  selectedAbilitySlot?: 'primary' | 'secondary' | 'ability1' | 'ability2' | 'ultimate' | null;
  combatTargetId?: string | null;
  botIntent?: string | null;
  routeTarget?: { x: number; y: number; z: number } | null;
  compression?: {
    intervalStartTick?: number;
    intervalEndTick?: number;
    repeated?: boolean;
  };
  metadata?: Record<string, unknown>;
}

export interface RecordingCheckpointRow {
  recordingTimeMs: number;
  serverTime: number;
  tick: number;
  phase: GamePhase;
  hash: string;
  snapshot: {
    matchSnapshot?: unknown;
    playerVitals?: unknown;
    playerInterest?: unknown;
    playerTransformsV2?: unknown;
    powerupState?: unknown;
  };
}

export interface RecordingSummaryPlayer {
  playerId: string;
  playerName: string;
  role: PlayerRole;
  team: Team | '';
  heroId: HeroId | null;
  isBot: boolean;
  kills: number;
  deaths: number;
  assists: number;
}

export interface RecordingRenderArtifact {
  id: string;
  status: RecordingRenderStatus;
  requestedAt: string;
  startedAt?: string | null;
  completedAt: string | null;
  fps: number;
  viewport: RecordingViewport;
  hudMode: RecordingHudMode;
  outputPath: string | null;
  stage?: RecordingRenderStage | null;
  progress?: number | null;
  progressMessage?: string | null;
  heartbeatAt?: string | null;
  error: string | null;
}

export interface RecordingSummary {
  recordingVersion: typeof RECORDING_ARTIFACT_VERSION;
  id: string;
  status: RecordingStatus;
  createdAt: string;
  startedAt: string | null;
  finalizedAt: string | null;
  durationMs: number;
  requestedDurationMs: number;
  roomId: string | null;
  matchId: string | null;
  eventCount: number;
  actionCount: number;
  checkpointCount: number;
  players: RecordingSummaryPlayer[];
  winner: Team | 'draw' | null;
  notableEvents: Array<{
    type: string;
    tick: number;
    serverTime: number;
    playerId?: string | null;
  }>;
  renders: RecordingRenderArtifact[];
  artifacts: RecordingArtifactRefs;
  checksums: RecordingFileChecksums;
  error: string | null;
}
