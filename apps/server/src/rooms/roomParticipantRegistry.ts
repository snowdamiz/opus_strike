import type { HeroId, MatchPerspective, PlayerRole, Team } from '@voxel-strike/shared';
import type { RoomAuthContext } from '../auth/session';
import type { GameEntryTicketClaims } from '../security/entryTickets';

export interface ReconnectParticipant {
  userId: string;
  lobbyPlayerId: string;
  displayName: string;
  matchPerspective?: MatchPerspective;
  role?: PlayerRole;
  assignedTeam?: Team;
  selectedHero?: HeroId;
  rankedRewardEligible?: boolean;
}

export class RoomParticipantRegistry {
  private readonly authContexts = new Map<string, RoomAuthContext>();
  private readonly entryTickets = new Map<string, GameEntryTicketClaims>();
  private readonly reconnectParticipants = new Map<string, ReconnectParticipant>();

  setSession(sessionId: string, authContext: RoomAuthContext, entryTicket: GameEntryTicketClaims | null = null): void {
    this.authContexts.set(sessionId, authContext);
    if (entryTicket) {
      this.entryTickets.set(sessionId, entryTicket);
    } else {
      this.entryTickets.delete(sessionId);
    }
  }

  clearSession(sessionId: string): void {
    this.authContexts.delete(sessionId);
    this.entryTickets.delete(sessionId);
  }

  getAuthUserId(sessionId: string): string | undefined {
    return this.authContexts.get(sessionId)?.userId;
  }

  getAuthContext(sessionId: string): RoomAuthContext | null {
    return this.authContexts.get(sessionId) ?? null;
  }

  getDurableUserId(sessionId: string): string | null {
    return this.authContexts.get(sessionId)?.userId
      ?? this.entryTickets.get(sessionId)?.userId
      ?? null;
  }

  hasEntryTicket(sessionId: string): boolean {
    return this.entryTickets.has(sessionId);
  }

  isRankedRewardEligible(sessionId: string): boolean {
    return this.entryTickets.get(sessionId)?.rankedRewardEligible === true;
  }

  getAuthContexts(): IterableIterator<RoomAuthContext> {
    return this.authContexts.values();
  }

  rememberReconnectParticipant(ticket: GameEntryTicketClaims): void {
    this.reconnectParticipants.set(ticket.userId, {
      userId: ticket.userId,
      lobbyPlayerId: ticket.lobbyPlayerId,
      displayName: ticket.displayName,
      matchPerspective: ticket.matchPerspective,
      role: ticket.role,
      assignedTeam: ticket.assignedTeam,
      selectedHero: ticket.selectedHero,
      rankedRewardEligible: ticket.rankedRewardEligible,
    });
  }

  getReconnectIdentityKeys(): string[] {
    return Array.from(this.reconnectParticipants.keys());
  }

  createRunningGameReconnectTicket(input: {
    userId: string;
    lobbyId: string;
    gameRoomId: string;
    issuedAt: number;
    ttlMs: number;
  }): GameEntryTicketClaims | null {
    const participant = this.reconnectParticipants.get(input.userId);
    if (!participant) return null;

    return {
      version: 1,
      lobbyId: input.lobbyId,
      gameRoomId: input.gameRoomId,
      lobbyPlayerId: participant.lobbyPlayerId,
      userId: participant.userId,
      displayName: participant.displayName,
      ...(participant.matchPerspective ? { matchPerspective: participant.matchPerspective } : {}),
      ...(participant.role ? { role: participant.role } : {}),
      ...(participant.assignedTeam ? { assignedTeam: participant.assignedTeam } : {}),
      ...(participant.selectedHero ? { selectedHero: participant.selectedHero } : {}),
      ...(participant.rankedRewardEligible === true ? { rankedRewardEligible: true } : {}),
      issuedAt: input.issuedAt,
      expiresAt: input.issuedAt + input.ttlMs,
      nonce: `reconnect:${participant.userId}:${input.issuedAt}`,
    };
  }

  syncReconnectParticipant(input: {
    sessionId: string;
    displayName?: string | null;
    role?: PlayerRole;
    assignedTeam?: Team;
    selectedHero?: HeroId;
  }): void {
    const userId = this.getDurableUserId(input.sessionId);
    if (!userId) return;

    const participant = this.reconnectParticipants.get(userId);
    if (!participant) return;

    participant.displayName = input.displayName || participant.displayName;
    participant.role = input.role ?? participant.role;
    participant.assignedTeam = input.assignedTeam ?? participant.assignedTeam;
    participant.selectedHero = input.selectedHero ?? participant.selectedHero;
  }
}
