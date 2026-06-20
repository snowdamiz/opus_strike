import {
  HERO_OUT_OF_COMBAT_REGEN_CAP_RATIO,
  HERO_OUT_OF_COMBAT_REGEN_DELAY_MS,
  HERO_OUT_OF_COMBAT_REGEN_PER_SECOND,
} from '@voxel-strike/shared';

interface CombatActivityPlayer {
  id: string;
  health: number;
  maxHealth: number;
  state?: string;
}

interface CombatActivityActor {
  id: string;
}

export class PlayerCombatActivityTracker {
  private readonly lastActivityAt = new Map<string, number>();

  clear(playerId: string): boolean {
    return this.lastActivityAt.delete(playerId);
  }

  mark(playerId: string, now: number): void {
    this.lastActivityAt.set(playerId, now);
  }

  markBetween(source: CombatActivityActor | null, target: CombatActivityActor, now: number): void {
    this.mark(target.id, now);
    if (source && source.id !== target.id) {
      this.mark(source.id, now);
    }
  }

  getLastActivityAt(playerId: string): number | undefined {
    return this.lastActivityAt.get(playerId);
  }

  updateOutOfCombatHealthRegen(player: CombatActivityPlayer, now: number, dt: number): boolean {
    const regenCap = player.maxHealth * HERO_OUT_OF_COMBAT_REGEN_CAP_RATIO;
    if (player.health <= 0 || player.health >= regenCap) return false;

    const lastCombatAt = this.lastActivityAt.get(player.id) ?? 0;
    if (now - lastCombatAt < HERO_OUT_OF_COMBAT_REGEN_DELAY_MS) return false;

    const previousHealth = player.health;
    player.health = Math.min(
      regenCap,
      player.health + HERO_OUT_OF_COMBAT_REGEN_PER_SECOND * Math.max(0, dt)
    );
    return player.health !== previousHealth;
  }

  updateOutOfCombatHealthRegens(players: Iterable<CombatActivityPlayer>, now: number, dt: number): number {
    let healedPlayers = 0;
    for (const player of players) {
      if (player.state !== 'alive') continue;
      if (this.updateOutOfCombatHealthRegen(player, now, dt)) {
        healedPlayers++;
      }
    }
    return healedPlayers;
  }
}
