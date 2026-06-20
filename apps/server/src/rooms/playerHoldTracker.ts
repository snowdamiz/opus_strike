export class PlayerHoldTracker {
  private readonly holdStartedAt = new Map<string, number>();

  clear(playerId: string): boolean {
    return this.holdStartedAt.delete(playerId);
  }

  getStartedAt(playerId: string): number | undefined {
    return this.holdStartedAt.get(playerId);
  }

  update(playerId: string, isHeld: boolean, wasHeld: boolean, now: number): void {
    if (!isHeld) {
      this.clear(playerId);
      return;
    }

    if (!wasHeld || !this.holdStartedAt.has(playerId)) {
      this.holdStartedAt.set(playerId, now);
    }
  }

  isReady(playerId: string, now: number, requiredHoldMs: number): boolean {
    const startedAt = this.getStartedAt(playerId);
    return startedAt !== undefined && now - startedAt >= requiredHoldMs;
  }
}
