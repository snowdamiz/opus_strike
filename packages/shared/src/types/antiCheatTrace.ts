import type { HeroId } from './hero.js';
import type { MatchMode } from './matchMode.js';
import type { MovementCommand, MovementCorrectionReason } from './movementPrediction.js';
import type { PlayerMovementState, PlayerState } from './player.js';
import type { Vec3 } from './vector.js';

export const ANTI_CHEAT_MOVEMENT_TRACE_VERSION = 1 as const;

export type AntiCheatMovementTraceKind = 'legal' | 'malicious';

export type AntiCheatTraceRecorder = 'client_rapier' | 'fixture_generator' | 'server_simulator';

export type AntiCheatTraceTerrainProfile =
  | 'flat'
  | 'low_step'
  | 'blocked_wall'
  | 'map_boundary'
  | 'procedural_map';

export interface AntiCheatTraceAuthorityAck {
  ackSeq: number;
  movementEpoch: number;
  correctionReason?: MovementCorrectionReason;
}

export interface AntiCheatTraceTerrainContact {
  profile: AntiCheatTraceTerrainProfile;
  isGrounded: boolean;
  groundY: number | null;
  blockedAhead?: boolean;
  collisionRevision?: number;
  mapSeed?: number;
}

export interface AntiCheatTraceAbilityState {
  activeAbilityIds: string[];
  activeSpeedMultiplier: number;
  movementBarrier?: 'respawn' | 'teleport' | 'knockback' | 'unstuck' | null;
}

export interface AntiCheatMovementTraceFrame {
  seq: number;
  command: MovementCommand;
  movementClass?: string;
  clientTimeMs: number;
  rapierPosition: Vec3;
  rapierVelocity: Vec3;
  movement: PlayerMovementState;
  playerState: PlayerState;
  health: number;
  flagCarrier: boolean;
  activeAbilityState: AntiCheatTraceAbilityState;
  terrainContact: AntiCheatTraceTerrainContact;
  latestServerAck: AntiCheatTraceAuthorityAck;
  movementEpoch: number;
  objectiveSuppressed: boolean;
  correctionReason?: MovementCorrectionReason;
}

export interface AntiCheatMovementTraceExpected {
  maxPositionDriftMeters: number;
  maxVelocityDriftMetersPerSecond: number;
  maxMovementStateMismatches: number;
  maxUnexpectedCorrections: number;
  allowedCorrectionReasons: MovementCorrectionReason[];
  maliciousExpectedReason?: MovementCorrectionReason | 'duplicate_command' | 'objective_suppression';
}

export interface AntiCheatMovementTracePrivacy {
  excludesNames: true;
  excludesWallets: true;
  excludesRawNetworkIds: true;
  excludesSecrets: true;
}

export interface AntiCheatMovementTrace {
  version: typeof ANTI_CHEAT_MOVEMENT_TRACE_VERSION;
  traceId: string;
  createdAt: string;
  kind: AntiCheatMovementTraceKind;
  recordedBy: AntiCheatTraceRecorder;
  heroId: HeroId;
  matchMode: MatchMode;
  movementClass: string;
  movementClasses?: string[];
  mapSeed: number;
  frameRateBand: string;
  pingBandMs: string;
  privacy: AntiCheatMovementTracePrivacy;
  frames: AntiCheatMovementTraceFrame[];
  expected: AntiCheatMovementTraceExpected;
}

export interface AntiCheatMovementTraceReportFrame {
  seq: number;
  positionDrift: number;
  velocityDrift: number;
  movementMismatch: boolean;
  correctionReason: MovementCorrectionReason | 'duplicate_command' | 'objective_suppression' | null;
}

export interface AntiCheatMovementTraceReport {
  traceId: string;
  kind: AntiCheatMovementTraceKind;
  movementClass: string;
  heroId: HeroId;
  passed: boolean;
  frameCount: number;
  maxPositionDrift: number;
  maxVelocityDrift: number;
  movementStateMismatches: number;
  unexpectedCorrections: number;
  expectedReasonMatched: boolean;
  failures: string[];
  frames: AntiCheatMovementTraceReportFrame[];
}

export interface AntiCheatMovementParityGateReport {
  version: typeof ANTI_CHEAT_MOVEMENT_TRACE_VERSION;
  generatedAt: string;
  corpus: 'smoke' | 'full' | 'all';
  traceCount: number;
  legalTraceCount: number;
  maliciousTraceCount: number;
  passed: boolean;
  maxPositionDrift: number;
  maxVelocityDrift: number;
  movementStateMismatches: number;
  unexpectedCorrections: number;
  failures: string[];
  traces: AntiCheatMovementTraceReport[];
}
