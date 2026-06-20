import {
  PHANTOM_PRIMARY_MAGAZINE_SIZE,
  PHANTOM_PRIMARY_RELOAD_MS,
} from '@voxel-strike/shared';

export interface PhantomPrimaryMagazineState {
  ammo: number;
  reloadUntil: number;
  reloadStartedAt: number;
}

export interface PhantomPrimaryReloadCompletion {
  magazine: PhantomPrimaryMagazineState;
  completed: boolean;
}

export interface PhantomPrimaryShotResult {
  magazine: PhantomPrimaryMagazineState;
  consumed: boolean;
  blockedByReload: boolean;
  startedReload: boolean;
}

export interface PhantomPrimaryReloadResult {
  magazine: PhantomPrimaryMagazineState;
  started: boolean;
  blockedByReload: boolean;
  alreadyFull: boolean;
}

export interface PhantomPrimaryReloadAdjustment {
  magazine?: PhantomPrimaryMagazineState;
  adjusted: boolean;
}

export interface PhantomPrimaryClientState {
  ammo: number;
  reloading: boolean;
  reloadStartedAt: number;
  reloadUntil: number;
  serverTime: number;
}

export class PhantomPrimaryMagazineTracker {
  private readonly magazines = new Map<string, PhantomPrimaryMagazineState>();

  clear(playerId: string): boolean {
    return this.magazines.delete(playerId);
  }

  reset(playerId: string): PhantomPrimaryMagazineState {
    const magazine = createFullMagazine();
    this.magazines.set(playerId, magazine);
    return magazine;
  }

  get(playerId: string): PhantomPrimaryMagazineState | undefined {
    return this.magazines.get(playerId);
  }

  getOrCreate(playerId: string): PhantomPrimaryMagazineState {
    let magazine = this.magazines.get(playerId);
    if (!magazine) {
      magazine = createFullMagazine();
      this.magazines.set(playerId, magazine);
    }
    return magazine;
  }

  completeReloadIfReady(playerId: string, now: number): PhantomPrimaryReloadCompletion {
    const magazine = this.getOrCreate(playerId);
    if (magazine.reloadUntil > 0 && now >= magazine.reloadUntil) {
      magazine.ammo = PHANTOM_PRIMARY_MAGAZINE_SIZE;
      magazine.reloadUntil = 0;
      magazine.reloadStartedAt = 0;
      return { magazine, completed: true };
    }

    return { magazine, completed: false };
  }

  isReloading(playerId: string, now: number): boolean {
    return this.completeReloadIfReady(playerId, now).magazine.reloadUntil > now;
  }

  consumeShot(playerId: string, now: number): PhantomPrimaryShotResult {
    const { magazine } = this.completeReloadIfReady(playerId, now);

    if (magazine.reloadUntil > now) {
      return {
        magazine,
        consumed: false,
        blockedByReload: true,
        startedReload: false,
      };
    }

    if (magazine.ammo <= 0) {
      this.startReload(magazine, now);
      return {
        magazine,
        consumed: false,
        blockedByReload: false,
        startedReload: true,
      };
    }

    magazine.ammo--;
    const startedReload = magazine.ammo === 0;
    if (startedReload) {
      this.startReload(magazine, now);
    }

    return {
      magazine,
      consumed: true,
      blockedByReload: false,
      startedReload,
    };
  }

  reload(playerId: string, now: number): PhantomPrimaryReloadResult {
    const { magazine } = this.completeReloadIfReady(playerId, now);

    if (magazine.reloadUntil > now) {
      return {
        magazine,
        started: false,
        blockedByReload: true,
        alreadyFull: false,
      };
    }

    if (magazine.ammo >= PHANTOM_PRIMARY_MAGAZINE_SIZE) {
      return {
        magazine,
        started: false,
        blockedByReload: false,
        alreadyFull: true,
      };
    }

    this.startReload(magazine, now);
    return {
      magazine,
      started: true,
      blockedByReload: false,
      alreadyFull: false,
    };
  }

  adjustActiveReload(playerId: string, adjustmentMs: number, now: number): PhantomPrimaryReloadAdjustment {
    const magazine = this.magazines.get(playerId);
    if (!magazine?.reloadUntil || magazine.reloadUntil <= now) {
      return { adjusted: false };
    }

    magazine.reloadUntil = Math.max(now, magazine.reloadUntil - adjustmentMs);
    return { magazine, adjusted: true };
  }

  getClientState(playerId: string, now: number): PhantomPrimaryClientState {
    const magazine = this.getOrCreate(playerId);
    const reloading = magazine.reloadUntil > now;
    return {
      ammo: magazine.ammo,
      reloading,
      reloadStartedAt: reloading ? magazine.reloadStartedAt : 0,
      reloadUntil: reloading ? magazine.reloadUntil : 0,
      serverTime: now,
    };
  }

  private startReload(magazine: PhantomPrimaryMagazineState, now: number): void {
    magazine.reloadStartedAt = now;
    magazine.reloadUntil = now + PHANTOM_PRIMARY_RELOAD_MS;
  }
}

function createFullMagazine(): PhantomPrimaryMagazineState {
  return {
    ammo: PHANTOM_PRIMARY_MAGAZINE_SIZE,
    reloadUntil: 0,
    reloadStartedAt: 0,
  };
}
