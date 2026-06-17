export type PreMatchCancelReason = 'start_timeout' | 'network_quality';

export interface PreMatchCancelNotice {
  reason: PreMatchCancelReason;
  message: string;
  blockedPlayerId?: string;
  blockedPlayerName?: string;
  networkQuality?: Record<string, unknown>;
}

export type PreMatchCancelNoticeDetails = Omit<PreMatchCancelNotice, 'reason'>;

export function createStartTimeoutCancelNotice(): PreMatchCancelNotice {
  return {
    reason: 'start_timeout',
    message: 'Match canceled because all players did not connect and load in time.',
  };
}

export function canCancelPreMatch(input: { matchCancelled: boolean; phase: string }): boolean {
  return !input.matchCancelled
    && (input.phase === 'waiting' || input.phase === 'hero_select' || input.phase === 'countdown');
}

export function buildPreMatchCancelNotice(
  reason: PreMatchCancelReason,
  details: PreMatchCancelNoticeDetails | null = null
): PreMatchCancelNotice {
  const fallbackDetails = details ?? { message: createStartTimeoutCancelNotice().message };
  return {
    reason,
    ...fallbackDetails,
  };
}

export function buildMatchCancelledPayload(input: {
  notice: PreMatchCancelNotice;
  roomId: string;
  requiredHumanPlayers: number;
  connectedHumanPlayers: number;
  deadlineAt: number;
  refundedWager: boolean;
  serverTime: number;
}): Record<string, unknown> {
  const { notice } = input;
  return {
    reason: notice.reason,
    message: notice.message,
    roomId: input.roomId,
    requiredHumanPlayers: input.requiredHumanPlayers,
    connectedHumanPlayers: input.connectedHumanPlayers,
    deadlineAt: input.deadlineAt,
    refundedWager: input.refundedWager,
    serverTime: input.serverTime,
    blockedPlayerId: notice.blockedPlayerId,
    blockedPlayerName: notice.blockedPlayerName,
    networkQuality: notice.networkQuality,
  };
}
