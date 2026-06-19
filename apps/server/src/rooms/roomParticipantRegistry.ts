import type { HeroId, MatchPerspective, Team } from '@voxel-strike/shared';
import type { RoomAuthContext } from '../auth/session';
import type { GameEntryTicketClaims } from '../security/entryTickets';

export interface ReconnectParticipant {
  userId: string;
  lobbyPlayerId: string;
  displayName: string;
  matchPerspective?: MatchPerspective;
  assignedTeam?: Team;
  selectedHero?: HeroId;
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

  getDurableUserId(sessionId: string): string | null {
    return this.authContexts.get(sessionId)?.userId
      ?? this.entryTickets.get(sessionId)?.userId
      ?? null;
  }

  hasEntryTicket(sessionId: string): boolean {
    return this.entryTickets.has(sessionId);
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
      assignedTeam: ticket.assignedTeam,
      selectedHero: ticket.selectedHero,
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
      matchPerspective: participant.matchPerspective,
      assignedTeam: participant.assignedTeam,
      selectedHero: participant.selectedHero,
      issuedAt: input.issuedAt,
      expiresAt: input.issuedAt + input.ttlMs,
      nonce: `reconnect:${participant.userId}:${input.issuedAt}`,
    };
  }

  syncReconnectParticipant(input: {
    sessionId: string;
    displayName?: string | null;
    assignedTeam?: Team;
    selectedHero?: HeroId;
  }): void {
    const userId = this.getDurableUserId(input.sessionId);
    if (!userId) return;

    const participant = this.reconnectParticipants.get(userId);
    if (!participant) return;

    participant.displayName = input.displayName || participant.displayName;
    participant.assignedTeam = input.assignedTeam ?? participant.assignedTeam;
    participant.selectedHero = input.selectedHero ?? participant.selectedHero;
  }
}
