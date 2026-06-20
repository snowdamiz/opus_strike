export class PhantomVoidRayChargeTracker {
  private readonly chargeStartedAt = new Map<string, number>();
  private readonly resolvedForPress = new Set<string>();

  clear(playerId: string): boolean {
    const hadCharge = this.chargeStartedAt.delete(playerId);
    const hadResolvedPress = this.resolvedForPress.delete(playerId);
    return hadCharge || hadResolvedPress;
  }

  getStartedAt(playerId: string): number | undefined {
    return this.chargeStartedAt.get(playerId);
  }

  isCharging(playerId: string): boolean {
    return this.chargeStartedAt.has(playerId);
  }

  isResolvedForPress(playerId: string): boolean {
    return this.resolvedForPress.has(playerId);
  }

  start(playerId: string, now: number): void {
    this.chargeStartedAt.set(playerId, now);
    this.resolvedForPress.delete(playerId);
  }

  markResolvedForPress(playerId: string): void {
    this.resolvedForPress.add(playerId);
  }
}
