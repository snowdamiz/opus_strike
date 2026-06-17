export type SecurityEventLogLevel = 'debug' | 'warn' | 'silent';

export interface SecurityEventPosition {
  x: number;
  y: number;
  z: number;
}

export interface SecurityEvent {
  type: string;
  playerId: string;
  userId?: string;
  roomId: string;
  tick: number;
  movementEpoch: number;
  movementSequence?: number;
  reason?: string;
  position?: SecurityEventPosition;
  serverTime: number;
  detail?: Record<string, unknown>;
}

export type RoomSecurityEventInput = Omit<SecurityEvent, 'roomId' | 'tick' | 'serverTime'>;

export function buildRoomSecurityEvent(
  event: RoomSecurityEventInput,
  context: { roomId: string; tick: number; serverTime: number }
): SecurityEvent {
  return {
    ...event,
    roomId: context.roomId,
    tick: context.tick,
    serverTime: context.serverTime,
  };
}

export function buildSecurityAuthorityEvent(
  event: SecurityEvent,
  player: { team?: string | null; heroId?: string | null }
): SecurityEvent & { team: string | null; heroId: string | null } {
  return {
    ...event,
    team: player.team ?? null,
    heroId: player.heroId ?? null,
  };
}

interface SecurityEventLogInput {
  type: string;
  reason?: string;
}

interface SecurityEventLogSampleInput extends SecurityEventLogInput {
  playerId: string;
  detail?: Record<string, unknown>;
}

export interface SecurityEventLogSamplerOptions {
  securityEventIntervalMs: number;
  movementCorrectionIntervalMs: number;
  maxKeys: number;
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

export class SecurityEventLogSampler<TEvent extends SecurityEventLogSampleInput> {
  private readonly samples = new Map<string, { lastLoggedAt: number; suppressed: number }>();

  constructor(private readonly options: SecurityEventLogSamplerOptions) {}

  sample(event: TEvent, now = Date.now()): TEvent | (TEvent & { suppressedSinceLastLog: number }) | null {
    const key = this.getKey(event);
    const existing = this.samples.get(key);
    const intervalMs = this.getIntervalMs(event);

    if (existing && now - existing.lastLoggedAt < intervalMs) {
      existing.suppressed++;
      return null;
    }

    if (!existing && this.samples.size >= this.options.maxKeys) {
      const oldestKey = this.samples.keys().next().value;
      if (oldestKey) this.samples.delete(oldestKey);
    }

    const suppressedSinceLastLog = existing?.suppressed ?? 0;
    this.samples.set(key, { lastLoggedAt: now, suppressed: 0 });
    return suppressedSinceLastLog > 0
      ? { ...event, suppressedSinceLastLog }
      : event;
  }

  private getIntervalMs(event: TEvent): number {
    return event.type === 'movement_correction'
      ? this.options.movementCorrectionIntervalMs
      : this.options.securityEventIntervalMs;
  }

  private getKey(event: TEvent): string {
    const validationReason = typeof event.detail?.validationReason === 'string'
      ? event.detail.validationReason
      : '';
    return [
      event.type,
      event.playerId,
      event.reason ?? '',
      validationReason,
    ].join(':');
  }
}
