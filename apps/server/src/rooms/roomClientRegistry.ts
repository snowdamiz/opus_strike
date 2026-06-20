export class RoomClientRegistry<TClient> {
  private readonly clientsBySessionId = new Map<string, TClient>();
  private readonly identityToSessionId = new Map<string, string>();
  private readonly sessionIdToIdentity = new Map<string, string>();

  getClient(sessionId: string): TClient | undefined {
    return this.clientsBySessionId.get(sessionId);
  }

  setClient(sessionId: string, client: TClient): void {
    this.clientsBySessionId.set(sessionId, client);
  }

  deleteClient(sessionId: string): boolean {
    return this.clientsBySessionId.delete(sessionId);
  }

  getConnectedClientIds(): ReadonlyMap<string, TClient> {
    return this.clientsBySessionId;
  }

  getSessionIdForIdentity(identity: string): string | undefined {
    return this.identityToSessionId.get(identity);
  }

  setIdentity(identity: string, sessionId: string): void {
    this.identityToSessionId.set(identity, sessionId);
    this.sessionIdToIdentity.set(sessionId, identity);
  }

  clearIdentityForSession(sessionId: string): string | null {
    const identity = this.sessionIdToIdentity.get(sessionId);
    if (!identity) return null;

    if (this.identityToSessionId.get(identity) === sessionId) {
      this.identityToSessionId.delete(identity);
    }
    this.sessionIdToIdentity.delete(sessionId);
    return identity;
  }

  clearSession(sessionId: string): void {
    this.deleteClient(sessionId);
    this.clearIdentityForSession(sessionId);
  }
}
