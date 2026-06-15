export type SecurityEventLogLevel = 'debug' | 'warn' | 'silent';

interface SecurityEventLogInput {
  type: string;
  reason?: string;
}

const EXPECTED_MOVEMENT_AUTHORITY_BARRIER_REASONS = new Set([
  'spawn',
  'respawn',
  'teleport',
  'knockback',
]);

export function isExpectedMovementAuthorityBarrier(event: SecurityEventLogInput): boolean {
  return event.type === 'movement_authority_barrier'
    && Boolean(event.reason && EXPECTED_MOVEMENT_AUTHORITY_BARRIER_REASONS.has(event.reason));
}

export function getSecurityEventLogLevel(event: SecurityEventLogInput): SecurityEventLogLevel {
  if (event.type === 'objective_carrier_mismatch') return 'warn';
  if (event.type === 'objective_suppression' || event.type.startsWith('objective_')) return 'silent';
  if (isExpectedMovementAuthorityBarrier(event)) return 'debug';
  return 'warn';
}
