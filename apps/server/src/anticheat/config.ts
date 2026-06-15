import type { MatchMode } from '@voxel-strike/shared';
import type { AntiCheatMode, AntiCheatRuntimeConfig, MovementAuthorityMode } from './types';
import { getMovementParityGateStatus } from './movementParityGate';

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
}

function envNumber(name: string, fallback: number, options: { min?: number; max?: number } = {}): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(options.min ?? parsed, Math.min(options.max ?? parsed, parsed));
}

function envMode(name: string, fallback: AntiCheatMode): AntiCheatMode {
  const value = process.env[name];
  return value === 'observe' || value === 'soft' || value === 'ranked_review' ? value : fallback;
}

function envMovementMode(name: string, fallback: MovementAuthorityMode): MovementAuthorityMode {
  const value = process.env[name];
  return value === 'compatibility' || value === 'shadow' || value === 'strict' ? value : fallback;
}

function parseMatchModes(value: string | undefined): MatchMode[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is MatchMode => (
      item === 'quick_play' ||
      item === 'ranked' ||
      item === 'custom' ||
      item === 'custom_wager'
    ));
}

function parseWallets(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

let cachedConfig: AntiCheatRuntimeConfig | null = null;

export function getAntiCheatConfig(): AntiCheatRuntimeConfig {
  if (cachedConfig) return cachedConfig;

  const requestedMovementAuthorityMode = envMovementMode('ANTICHEAT_MOVEMENT_AUTHORITY_MODE', 'strict');
  const movementParityGateRequired = envBool('ANTICHEAT_MOVEMENT_PARITY_GATE_REQUIRED', true);
  const movementParityGate = getMovementParityGateStatus({
    required: movementParityGateRequired,
    requestedMode: requestedMovementAuthorityMode,
  });

  cachedConfig = {
    enabled: envBool('ANTICHEAT_ENABLED', true),
    mode: envMode('ANTICHEAT_MODE', 'observe'),
    signalRetentionDays: envNumber('ANTICHEAT_SIGNAL_RETENTION_DAYS', 90, { min: 1, max: 3650 }),
    lowSignalRetentionDays: envNumber('ANTICHEAT_LOW_SIGNAL_RETENTION_DAYS', 14, { min: 1, max: 365 }),
    maxSignalDetailBytes: envNumber('ANTICHEAT_MAX_SIGNAL_DETAIL_BYTES', 4096, { min: 256, max: 32768 }),
    rankedScoreThreshold: envNumber('ANTICHEAT_RANKED_SCORE_THRESHOLD', 50, { min: 1, max: 100 }),
    wagerScoreThreshold: envNumber('ANTICHEAT_WAGER_SCORE_THRESHOLD', 50, { min: 1, max: 100 }),
    adminReviewScoreThreshold: envNumber('ANTICHEAT_ADMIN_REVIEW_SCORE_THRESHOLD', 75, { min: 1, max: 100 }),
    payoutHoldScoreThreshold: envNumber('ANTICHEAT_PAYOUT_HOLD_SCORE_THRESHOLD', 50, { min: 1, max: 100 }),
    payoutHoldsEnabled: envBool('ANTICHEAT_PAYOUT_HOLDS_ENABLED', false),
    manualAccountActionsEnabled: envBool('ANTICHEAT_MANUAL_ACCOUNT_ACTIONS_ENABLED', false),
    banRequiresElevatedRole: envBool('ANTICHEAT_BAN_REQUIRES_ELEVATED_ROLE', true),
    clientHintsEnabled: envBool('ANTICHEAT_CLIENT_HINTS_ENABLED', true),
    movementAuthorityMode: movementParityGate.effectiveMode,
    movementParityGateRequired,
    movementParityGate,
    movementDriftSampleRate: envNumber('ANTICHEAT_MOVEMENT_DRIFT_SAMPLE_RATE', 0.05, { min: 0, max: 1 }),
    movementStrictMatchModes: parseMatchModes(process.env.ANTICHEAT_MOVEMENT_STRICT_MATCH_MODES),
    elevatedAdminWallets: parseWallets(process.env.ANTICHEAT_ELEVATED_ADMIN_WALLETS ?? process.env.ADMIN_WALLET),
  };

  return cachedConfig;
}

export function resetAntiCheatConfigForTests(): void {
  cachedConfig = null;
}
