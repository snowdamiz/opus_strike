export type AttackCooldownMode = 'primary' | 'secondary';

export class AttackCooldownTracker {
  private readonly cooldownUntil = new Map<string, number>();

  clear(playerId: string, mode: AttackCooldownMode): boolean {
    return this.cooldownUntil.delete(this.getKey(playerId, mode));
  }

  clearPlayer(playerId: string): void {
    this.clear(playerId, 'primary');
    this.clear(playerId, 'secondary');
  }

  getUntil(playerId: string, mode: AttackCooldownMode): number | undefined {
    return this.cooldownUntil.get(this.getKey(playerId, mode));
  }

  isCoolingDown(playerId: string, mode: AttackCooldownMode, now: number): boolean {
    return now < (this.getUntil(playerId, mode) ?? 0);
  }

  setUntil(playerId: string, mode: AttackCooldownMode, cooldownUntil: number): void {
    this.cooldownUntil.set(this.getKey(playerId, mode), cooldownUntil);
  }

  setFromDuration(
    playerId: string,
    mode: AttackCooldownMode,
    now: number,
    durationMs: number
  ): void {
    this.setUntil(playerId, mode, now + durationMs);
  }

  adjust(
    playerId: string,
    mode: AttackCooldownMode,
    adjustmentMs: number,
    now: number
  ): void {
    const cooldownUntil = this.getUntil(playerId, mode);
    if (!cooldownUntil || cooldownUntil <= now) return;

    const nextCooldownUntil = cooldownUntil - adjustmentMs;
    if (nextCooldownUntil <= now) {
      this.clear(playerId, mode);
      return;
    }

    this.setUntil(playerId, mode, nextCooldownUntil);
  }

  private getKey(playerId: string, mode: AttackCooldownMode): string {
    return `${playerId}:${mode}`;
  }
}
