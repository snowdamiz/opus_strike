export interface PrimaryMagazineConfig {
  magazineSize: number;
  reloadMs: number;
}

export interface PrimaryMagazineState {
  ammo: number;
  reloadUntil: number;
  reloadStartedAt: number;
}

export interface PrimaryReloadCompletion {
  magazine: PrimaryMagazineState;
  completed: boolean;
}

export interface PrimaryShotResult {
  magazine: PrimaryMagazineState;
  consumed: boolean;
  blockedByReload: boolean;
  startedReload: boolean;
}

export interface PrimaryReloadResult {
  magazine: PrimaryMagazineState;
  started: boolean;
  blockedByReload: boolean;
  alreadyFull: boolean;
}

export interface PrimaryReloadAdjustment {
  magazine?: PrimaryMagazineState;
  adjusted: boolean;
}

export interface PrimaryMagazineClientState {
  ammo: number;
  reloading: boolean;
  reloadStartedAt: number;
  reloadUntil: number;
  serverTime: number;
}

export class PrimaryMagazineTracker {
  private readonly magazines = new Map<string, PrimaryMagazineState>();

  constructor(private readonly config: PrimaryMagazineConfig) {}

  clear(playerId: string): boolean {
    return this.magazines.delete(playerId);
  }

  reset(playerId: string): PrimaryMagazineState {
    const magazine = createFullMagazine(this.config);
    this.magazines.set(playerId, magazine);
    return magazine;
  }

  get(playerId: string): PrimaryMagazineState | undefined {
    return this.magazines.get(playerId);
  }

  getOrCreate(playerId: string): PrimaryMagazineState {
    let magazine = this.magazines.get(playerId);
    if (!magazine) {
      magazine = createFullMagazine(this.config);
      this.magazines.set(playerId, magazine);
    }
    return magazine;
  }

  completeReloadIfReady(playerId: string, now: number): PrimaryReloadCompletion {
    const magazine = this.getOrCreate(playerId);
    if (magazine.reloadUntil > 0 && now >= magazine.reloadUntil) {
      magazine.ammo = this.config.magazineSize;
      magazine.reloadUntil = 0;
      magazine.reloadStartedAt = 0;
      return { magazine, completed: true };
    }

    return { magazine, completed: false };
  }

  isReloading(playerId: string, now: number): boolean {
    return this.completeReloadIfReady(playerId, now).magazine.reloadUntil > now;
  }

  consumeShot(playerId: string, now: number): PrimaryShotResult {
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

  reload(playerId: string, now: number): PrimaryReloadResult {
    const { magazine } = this.completeReloadIfReady(playerId, now);

    if (magazine.reloadUntil > now) {
      return {
        magazine,
        started: false,
        blockedByReload: true,
        alreadyFull: false,
      };
    }

    if (magazine.ammo >= this.config.magazineSize) {
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

  adjustActiveReload(playerId: string, adjustmentMs: number, now: number): PrimaryReloadAdjustment {
    const magazine = this.magazines.get(playerId);
    if (!magazine?.reloadUntil || magazine.reloadUntil <= now) {
      return { adjusted: false };
    }

    magazine.reloadUntil = Math.max(now, magazine.reloadUntil - adjustmentMs);
    return { magazine, adjusted: true };
  }

  getClientState(playerId: string, now: number): PrimaryMagazineClientState {
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

  private startReload(magazine: PrimaryMagazineState, now: number): void {
    magazine.reloadStartedAt = now;
    magazine.reloadUntil = now + this.config.reloadMs;
  }
}

function createFullMagazine(config: PrimaryMagazineConfig): PrimaryMagazineState {
  return {
    ammo: config.magazineSize,
    reloadUntil: 0,
    reloadStartedAt: 0,
  };
}
