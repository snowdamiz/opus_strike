import type { RoomAntiCheatRecordInput } from './roomAntiCheatRecords';

export interface ClientJoinHintRecordInput {
  userId: string;
  playerSessionId: string;
  expectedBuildId: string | null;
  clientBuildId: unknown;
  movementProtocolVersion: unknown;
  expectedMovementProtocolVersion: number;
}

export function normalizeClientBuildId(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 80)
    : null;
}

export function normalizeClientMovementProtocolVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

export function buildClientJoinHintRecords(input: ClientJoinHintRecordInput): RoomAntiCheatRecordInput[] {
  const records: RoomAntiCheatRecordInput[] = [];
  const clientBuildId = normalizeClientBuildId(input.clientBuildId);
  const movementProtocolVersion = normalizeClientMovementProtocolVersion(input.movementProtocolVersion);
  const common = {
    category: 'client_hint' as const,
    source: 'game_room_join',
    userId: input.userId,
    playerSessionId: input.playerSessionId,
    severity: 'low' as const,
    retentionClass: 'short' as const,
  };

  if (!clientBuildId) {
    records.push({
      ...common,
      eventType: 'client_hint.build_missing',
      confidence: 0.4,
      reason: 'build_missing',
      details: { expectedBuildId: input.expectedBuildId },
    });
  } else if (input.expectedBuildId && clientBuildId !== input.expectedBuildId) {
    records.push({
      ...common,
      eventType: 'client_hint.build_mismatch',
      confidence: 0.5,
      reason: 'build_mismatch',
      details: { clientBuildId, expectedBuildId: input.expectedBuildId },
    });
  }

  if (movementProtocolVersion !== input.expectedMovementProtocolVersion) {
    records.push({
      ...common,
      eventType: 'client_hint.movement_protocol_mismatch',
      confidence: 0.5,
      reason: movementProtocolVersion === null ? 'movement_protocol_missing' : 'movement_protocol_mismatch',
      details: {
        movementProtocolVersion,
        expectedMovementProtocolVersion: input.expectedMovementProtocolVersion,
      },
    });
  }

  return records;
}
