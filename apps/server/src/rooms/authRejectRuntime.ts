import type { AntiCheatSeverity } from '../anticheat';
import type { RoomAntiCheatRecordInput } from './roomAntiCheatRecords';

export interface AuthRejectRecordInput {
  reason: string;
  userId: string | null;
  playerSessionId: string;
  details?: Record<string, unknown>;
}

export function getAuthRejectSeverity(reason: string): AntiCheatSeverity {
  return reason.includes('replay') || reason.includes('direct_join') ? 'critical' : 'high';
}

export function buildAuthRejectRecord(input: AuthRejectRecordInput): RoomAntiCheatRecordInput {
  return {
    eventType: `auth.${input.reason}`,
    category: 'auth',
    source: 'game_room_auth',
    userId: input.userId,
    playerSessionId: input.playerSessionId,
    severity: getAuthRejectSeverity(input.reason),
    confidence: 0.98,
    reason: input.reason,
    details: input.details ?? {},
    retentionClass: 'extended',
  };
}
