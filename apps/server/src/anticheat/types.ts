import type { MatchMode } from '@voxel-strike/shared';

export type AntiCheatMode = 'observe' | 'soft' | 'ranked_review';
export type MovementAuthorityMode = 'compatibility' | 'shadow' | 'strict';
export type AntiCheatCategory =
  | 'auth'
  | 'network'
  | 'movement'
  | 'combat'
  | 'ability'
  | 'objective'
  | 'ranked'
  | 'wager'
  | 'client_hint';
export type AntiCheatSeverity = 'low' | 'medium' | 'high' | 'critical';
export type AntiCheatRetentionClass = 'short' | 'standard' | 'extended';
export type AntiCheatMatchIntegrityStatus = 'clean' | 'suspicious' | 'compromised' | 'no_contest';
export type AntiCheatCasePriority = 'low' | 'medium' | 'high' | 'urgent';
export type AntiCheatCaseStatus = 'open' | 'investigating' | 'resolved' | 'false_positive' | 'escalated';
export type AntiCheatActionType =
  | 'correction'
  | 'objective_suppression'
  | 'ranked_hold'
  | 'ranked_release'
  | 'ranked_cancel'
  | 'payout_hold'
  | 'payout_release'
  | 'refund_decision'
  | 'settlement_cancel'
  | 'operator_note'
  | 'case_resolution'
  | 'case_reversal';
export type AntiCheatAccountActionType =
  | 'suspension'
  | 'ban'
  | 'lift_suspension'
  | 'lift_ban';

export interface MovementParityGateStatus {
  required: boolean;
  requestedMode: MovementAuthorityMode;
  effectiveMode: MovementAuthorityMode;
  passed: boolean;
  reason: string;
  reportPath: string | null;
  generatedAt: string | null;
  corpus: string | null;
  traceCount: number;
  legalTraceCount: number;
  maliciousTraceCount: number;
}

export interface AntiCheatRuntimeConfig {
  enabled: boolean;
  mode: AntiCheatMode;
  signalRetentionDays: number;
  lowSignalRetentionDays: number;
  maxSignalDetailBytes: number;
  rankedScoreThreshold: number;
  wagerScoreThreshold: number;
  adminReviewScoreThreshold: number;
  payoutHoldScoreThreshold: number;
  payoutHoldsEnabled: boolean;
  manualAccountActionsEnabled: boolean;
  banRequiresElevatedRole: boolean;
  clientHintsEnabled: boolean;
  movementAuthorityMode: MovementAuthorityMode;
  movementParityGateRequired: boolean;
  movementParityGate: MovementParityGateStatus;
  movementDriftSampleRate: number;
  movementStrictMatchModes: MatchMode[];
  elevatedAdminWallets: string[];
}

export interface AntiCheatSignalInput {
  eventType: string;
  category: AntiCheatCategory;
  source: string;
  roomId: string;
  matchId?: string | null;
  lobbyId?: string | null;
  matchMode?: MatchMode | null;
  userId?: string | null;
  playerSessionId?: string | null;
  team?: string | null;
  heroId?: string | null;
  serverTick?: number | null;
  serverTime?: number | null;
  movementEpoch?: number | null;
  movementSequence?: number | null;
  severity?: AntiCheatSeverity;
  confidence?: number;
  reason?: string | null;
  details?: Record<string, unknown>;
  retentionClass?: AntiCheatRetentionClass;
}

export interface AntiCheatSignal {
  eventId: string;
  eventType: string;
  category: AntiCheatCategory;
  source: string;
  roomId: string;
  matchId: string | null;
  lobbyId: string | null;
  matchMode: MatchMode | null;
  userId: string | null;
  playerSessionId: string | null;
  team: string | null;
  heroId: string | null;
  serverTick: number;
  serverTime: number;
  movementEpoch: number | null;
  movementSequence: number | null;
  severity: AntiCheatSeverity;
  confidence: number;
  reason: string | null;
  details: Record<string, unknown>;
  detailBytes: number;
  retentionClass: AntiCheatRetentionClass;
  observedAt: Date;
}

export interface AntiCheatScoreChange {
  userId: string | null;
  playerSessionId: string | null;
  scoreBefore: number;
  scoreAfter: number;
  scoreDelta: number;
  integrityStatus: AntiCheatMatchIntegrityStatus;
  casePriority: AntiCheatCasePriority | null;
  shouldCreateCase: boolean;
  affectsRankedOrWager: boolean;
}

export interface AntiCheatIntegrityGate {
  status: AntiCheatMatchIntegrityStatus;
  reviewRequired: boolean;
  rankedHoldRequired: boolean;
  payoutHoldRequired: boolean;
  observedOnly: boolean;
  reason: string | null;
  affectedUserIds: string[];
  affectedTeams: string[];
  score: number;
  caseId: string | null;
}

export interface AntiCheatRoomAuthorityEvent {
  type: string;
  playerId: string;
  userId?: string;
  roomId: string;
  tick: number;
  movementEpoch: number;
  movementSequence?: number;
  reason?: string;
  position?: { x: number; y: number; z: number };
  serverTime: number;
  detail?: Record<string, unknown>;
}
