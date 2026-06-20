import {
  CHRONOS_AEGIS_SHIELD_MAX_HP,
  CHRONOS_AEGIS_SHIELD_RECHARGE_PER_SECOND,
} from '@voxel-strike/shared';

interface ChronosAegisPlayer {
  id: string;
  heroId: string;
  state: string;
  lastInput?: {
    secondaryFire?: boolean;
    ability1?: boolean;
  } | null;
}

export interface ChronosAegisDamageAbsorption {
  hadShield: boolean;
  absorbed: number;
  nextHp: number;
  shieldRatio: number;
  remainingDamage: number;
  broken: boolean;
}

export class ChronosAegisShieldTracker {
  private readonly shieldHp = new Map<string, number>();

  clear(playerId: string): boolean {
    return this.shieldHp.delete(playerId);
  }

  getHp(playerId: string): number {
    return this.shieldHp.get(playerId) ?? CHRONOS_AEGIS_SHIELD_MAX_HP;
  }

  setHp(playerId: string, hp: number): void {
    const clamped = Math.max(0, Math.min(CHRONOS_AEGIS_SHIELD_MAX_HP, hp));
    if (clamped >= CHRONOS_AEGIS_SHIELD_MAX_HP) {
      this.shieldHp.delete(playerId);
    } else {
      this.shieldHp.set(playerId, clamped);
    }
  }

  getRatio(playerId: string): number {
    return this.getHp(playerId) / CHRONOS_AEGIS_SHIELD_MAX_HP;
  }

  isHeld(player: ChronosAegisPlayer): boolean {
    return (
      player.heroId === 'chronos' &&
      player.state === 'alive' &&
      Boolean(player.lastInput?.secondaryFire) &&
      !player.lastInput?.ability1
    );
  }

  isActive(player: ChronosAegisPlayer): boolean {
    return this.isHeld(player) && this.getHp(player.id) > 0;
  }

  update(players: Iterable<ChronosAegisPlayer>, dt: number): void {
    const recharge = CHRONOS_AEGIS_SHIELD_RECHARGE_PER_SECOND * dt;
    for (const player of players) {
      if (player.heroId !== 'chronos') {
        this.shieldHp.delete(player.id);
        continue;
      }
      if (player.state !== 'alive') {
        this.shieldHp.delete(player.id);
        continue;
      }
      if (this.isHeld(player)) continue;

      const hp = this.getHp(player.id);
      if (hp < CHRONOS_AEGIS_SHIELD_MAX_HP) {
        this.setHp(player.id, hp + recharge);
      }
    }
  }

  absorbDamage(playerId: string, rawDamage: number): ChronosAegisDamageAbsorption {
    const hp = this.getHp(playerId);
    if (hp <= 0) {
      return {
        hadShield: false,
        absorbed: 0,
        nextHp: hp,
        shieldRatio: 0,
        remainingDamage: rawDamage,
        broken: false,
      };
    }

    const absorbed = Math.min(hp, Math.max(0, rawDamage));
    const nextHp = hp - absorbed;
    this.setHp(playerId, nextHp);
    return {
      hadShield: true,
      absorbed,
      nextHp,
      shieldRatio: Math.max(0, Math.min(1, nextHp / CHRONOS_AEGIS_SHIELD_MAX_HP)),
      remainingDamage: Math.max(0, rawDamage - absorbed),
      broken: nextHp <= 0,
    };
  }
}
