import type { AbilityState } from '../types/ability.js';
import type { Team } from '../types/player.js';
import type { Vec3 } from '../types/vector.js';

export interface DamageHistoryEntry {
  damage: number;
  timestamp: number;
  damageType: string;
  sourcePosition: Vec3 | null;
  sourceDirection: Vec3 | null;
}

export interface DamageCapWindow {
  startedAt: number;
  damage: number;
}

export type DamageHistoryStore = Map<string, Map<string, DamageHistoryEntry>>;
export type DamageCapWindowStore = Map<string, DamageCapWindow>;

export interface DamageEngineAdapter<TPlayer> {
  getPlayerById(id: string): TPlayer | null;
  getId(player: TPlayer): string;
  getTeam(player: TPlayer): Team | null;
  getState(player: TPlayer): string;
  setState(player: TPlayer, state: 'dead' | 'downed'): void;
  getHealth(player: TPlayer): number;
  setHealth(player: TPlayer, health: number): void;
  getMaxHealth(player: TPlayer): number;
  getDownedHealth?(player: TPlayer): number;
  setDownedHealth?(player: TPlayer, health: number): void;
  getDownedMaxHealth?(player: TPlayer): number;
  getSpawnProtectionUntil(player: TPlayer): number | null;
  getUltimateCharge(player: TPlayer): number;
  setUltimateCharge(player: TPlayer, charge: number): void;
  getPersonalShieldState?(player: TPlayer): Pick<AbilityState, 'isActive'> | null;
  deactivatePersonalShield?(player: TPlayer): void;
  // Depletable shield pool that absorbs damage before health. The adapter
  // decides which pool backs it (e.g. body shield while alive, knockdown
  // shield while downed).
  getShield?(player: TPlayer): number;
  setShield?(player: TPlayer, shield: number): void;
  setRespawnTime?(player: TPlayer, respawnTime: number | null): void;
  addKill?(player: TPlayer): void;
  addDeath?(player: TPlayer): void;
  addAssist?(player: TPlayer): void;
  isDamageImmune?(player: TPlayer): boolean;
  getDamageTakenMultiplier?(player: TPlayer): number;
}

export interface DamageEngineRuntime<TPlayer> {
  adapter: DamageEngineAdapter<TPlayer>;
  damageHistory: DamageHistoryStore;
  damageCapWindows?: DamageCapWindowStore;
  now: number;
  assistWindowMs: number;
  damageCapWindowMs?: number;
  damageCapPerSourceTargetMultiplier?: number;
  respawnDelayMs?: number | null;
  ultimateChargePerDamageRatio?: number;
  ultimateChargePerKill?: number;
  ultimateChargePerAssist?: number;
  creditOverkillDamage?: boolean;
  lethalAliveResolution?: 'death' | 'downed';
  damageDownedPlayers?: boolean;
}

export interface DamageAbsorptionContext<TPlayer> {
  source: TPlayer | null;
  target: TPlayer;
  rawDamage: number;
  damageType: string;
  abilityId?: string;
  sourcePosition: Vec3 | null;
  sourceDirection: Vec3 | null;
  now: number;
}

export interface DamageAbsorptionResult {
  remainingDamage: number;
}

export interface ApplyDamageInput<TPlayer> {
  target: TPlayer;
  source?: TPlayer | null;
  rawDamage: number;
  damageType: string;
  abilityId?: string;
  sourcePosition?: Vec3 | null;
  sourceDirection?: Vec3 | null;
  allowFriendlyFire?: boolean;
  bypassSpawnProtection?: boolean;
  bypassPersonalShield?: boolean;
  bypassShield?: boolean;
  skipDamageBudget?: boolean;
  absorbDamage?: (damage: number, context: DamageAbsorptionContext<TPlayer>) => DamageAbsorptionResult;
}

export type DamageRejectReason =
  | 'not_alive'
  | 'non_positive_damage'
  | 'friendly_fire'
  | 'spawn_protection'
  | 'immune'
  | 'damage_cap'
  | 'absorbed';

export interface DamageDeathResolution<TPlayer> {
  victim: TPlayer;
  killer: TPlayer | null;
  victimId: string;
  killerId: string | null;
  assistIds: string[];
  deathAt: number;
  respawnTime: number | null;
  lastDamageEntry: DamageHistoryEntry | null;
}

export interface DamageDownedResolution<TPlayer> {
  target: TPlayer;
  source: TPlayer | null;
  targetId: string;
  sourceId: string | null;
  downedAt: number;
  downedHealth: number;
  downedMaxHealth: number;
}

export interface ApplyDamageResult<TPlayer> {
  applied: boolean;
  killed: boolean;
  rejectedReason?: DamageRejectReason;
  target: TPlayer;
  source: TPlayer | null;
  sourceId: string | null;
  damageType: string;
  damage: number;
  appliedDamage: number;
  newHealth: number;
  sourcePosition: Vec3 | null;
  sourceDirection: Vec3 | null;
  personalShieldBroken: boolean;
  shieldDamage: number;
  newShield: number;
  shieldBroken: boolean;
  downed: DamageDownedResolution<TPlayer> | null;
  newDownedHealth?: number;
  death: DamageDeathResolution<TPlayer> | null;
}

const DEFAULT_ULTIMATE_CHARGE_PER_DAMAGE_RATIO = 12;

function clampUltimateCharge(charge: number): number {
  return Math.max(0, Math.min(100, charge));
}

function isSameTeam<TPlayer>(
  adapter: DamageEngineAdapter<TPlayer>,
  left: TPlayer,
  right: TPlayer
): boolean {
  const leftTeam = adapter.getTeam(left);
  const rightTeam = adapter.getTeam(right);
  return Boolean(leftTeam && rightTeam && leftTeam === rightTeam);
}

function addUltimateCharge<TPlayer>(
  adapter: DamageEngineAdapter<TPlayer>,
  player: TPlayer,
  amount: number
): void {
  if (amount <= 0) return;
  adapter.setUltimateCharge(player, clampUltimateCharge(adapter.getUltimateCharge(player) + amount));
}

function getDamageTakenMultiplier<TPlayer>(
  adapter: DamageEngineAdapter<TPlayer>,
  player: TPlayer
): number {
  const multiplier = adapter.getDamageTakenMultiplier?.(player) ?? 1;
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
}

function consumeDamageBudget<TPlayer>(
  runtime: DamageEngineRuntime<TPlayer>,
  source: TPlayer,
  target: TPlayer,
  rawDamage: number,
  damageType: string
): boolean {
  if (!runtime.damageCapWindows || !runtime.damageCapWindowMs || !runtime.damageCapPerSourceTargetMultiplier) {
    return true;
  }

  const adapter = runtime.adapter;
  const key = `${adapter.getId(source)}:${adapter.getId(target)}:${damageType}`;
  const window = runtime.damageCapWindows.get(key);
  const maxDamage = Math.max(
    adapter.getMaxHealth(target) * runtime.damageCapPerSourceTargetMultiplier,
    rawDamage + 1
  );

  if (!window || runtime.now - window.startedAt >= runtime.damageCapWindowMs) {
    runtime.damageCapWindows.set(key, { startedAt: runtime.now, damage: rawDamage });
    return rawDamage <= maxDamage;
  }

  const nextDamage = window.damage + rawDamage;
  if (nextDamage > maxDamage) return false;

  window.damage = nextDamage;
  return true;
}

export function recordDamageHistory(
  historyStore: DamageHistoryStore,
  targetId: string,
  sourceId: string,
  damage: number,
  timestamp: number,
  damageType: string,
  sourcePosition: Vec3 | null,
  sourceDirection: Vec3 | null
): void {
  let history = historyStore.get(targetId);
  if (!history) {
    history = new Map();
    historyStore.set(targetId, history);
  }

  const existing = history.get(sourceId);
  history.set(sourceId, {
    damage: (existing?.damage ?? 0) + damage,
    timestamp,
    damageType,
    sourcePosition: sourcePosition ? { ...sourcePosition } : null,
    sourceDirection: sourceDirection ? { ...sourceDirection } : null,
  });
}

export function resolveDamageDeath<TPlayer>(
  runtime: DamageEngineRuntime<TPlayer>,
  target: TPlayer,
  source: TPlayer | null
): DamageDeathResolution<TPlayer> {
  const adapter = runtime.adapter;
  const victimId = adapter.getId(target);
  const killerId = source ? adapter.getId(source) : null;
  const respawnDelayMs = runtime.respawnDelayMs;
  const respawnTime = typeof respawnDelayMs === 'number' ? runtime.now + Math.max(0, respawnDelayMs) : null;

  adapter.setState(target, 'dead');
  adapter.setHealth(target, 0);
  adapter.setRespawnTime?.(target, respawnTime);
  adapter.addDeath?.(target);

  if (source && killerId && killerId !== victimId) {
    adapter.addKill?.(source);
    addUltimateCharge(adapter, source, runtime.ultimateChargePerKill ?? 0);
  }

  const assistIds: string[] = [];
  const history = runtime.damageHistory.get(victimId);
  let lastDamageEntry: DamageHistoryEntry | null = null;
  if (history) {
    for (const [sourceId, entry] of history) {
      if (!lastDamageEntry || entry.timestamp > lastDamageEntry.timestamp) {
        lastDamageEntry = entry;
      }
      if (sourceId === killerId) continue;
      if (runtime.now - entry.timestamp > runtime.assistWindowMs) continue;

      const assister = adapter.getPlayerById(sourceId);
      if (!assister || isSameTeam(adapter, assister, target)) continue;

      adapter.addAssist?.(assister);
      addUltimateCharge(adapter, assister, runtime.ultimateChargePerAssist ?? 0);
      assistIds.push(sourceId);
    }
    runtime.damageHistory.delete(victimId);
  }

  return {
    victim: target,
    killer: source,
    victimId,
    killerId,
    assistIds,
    deathAt: runtime.now,
    respawnTime,
    lastDamageEntry,
  };
}

function resolveDowned<TPlayer>(
  runtime: DamageEngineRuntime<TPlayer>,
  target: TPlayer,
  source: TPlayer | null
): DamageDownedResolution<TPlayer> {
  const adapter = runtime.adapter;
  const downedMaxHealth = Math.max(1, Math.round(adapter.getDownedMaxHealth?.(target) ?? 1));
  const currentDownedHealth = adapter.getDownedHealth?.(target);
  const downedHealth = Math.max(
    1,
    Math.round(currentDownedHealth && currentDownedHealth > 0 ? currentDownedHealth : downedMaxHealth)
  );
  adapter.setState(target, 'downed');
  adapter.setHealth(target, 0);
  adapter.setDownedHealth?.(target, downedHealth);

  return {
    target,
    source,
    targetId: adapter.getId(target),
    sourceId: source ? adapter.getId(source) : null,
    downedAt: runtime.now,
    downedHealth,
    downedMaxHealth,
  };
}

export function applyDamage<TPlayer>(
  runtime: DamageEngineRuntime<TPlayer>,
  input: ApplyDamageInput<TPlayer>
): ApplyDamageResult<TPlayer> {
  const adapter = runtime.adapter;
  const source = input.source ?? null;
  const target = input.target;
  const targetState = adapter.getState(target);
  const damageDownedTarget = targetState === 'downed' &&
    runtime.damageDownedPlayers === true &&
    adapter.getDownedHealth !== undefined &&
    adapter.setDownedHealth !== undefined;
  const targetHealth = damageDownedTarget ? adapter.getDownedHealth!(target) : adapter.getHealth(target);
  const sourceId = source ? adapter.getId(source) : null;
  const sourcePosition = input.sourcePosition !== undefined ? input.sourcePosition : null;
  const sourceDirection = input.sourceDirection !== undefined ? input.sourceDirection : null;

  const rejected = (reason: DamageRejectReason): ApplyDamageResult<TPlayer> => ({
    applied: false,
    killed: false,
    rejectedReason: reason,
    target,
    source,
    sourceId,
    damageType: input.damageType,
    damage: 0,
    appliedDamage: 0,
    newHealth: targetHealth,
    sourcePosition,
    sourceDirection,
    personalShieldBroken: false,
    shieldDamage: 0,
    newShield: adapter.getShield?.(target) ?? 0,
    shieldBroken: false,
    downed: null,
    death: null,
  });

  if (targetState !== 'alive' && !damageDownedTarget) return rejected('not_alive');
  if (input.rawDamage <= 0) return rejected('non_positive_damage');
  if (!input.allowFriendlyFire && source && sourceId !== adapter.getId(target) && isSameTeam(adapter, source, target)) {
    return rejected('friendly_fire');
  }
  const spawnProtectionUntil = damageDownedTarget ? 0 : adapter.getSpawnProtectionUntil(target) ?? 0;
  if (!damageDownedTarget && !input.bypassSpawnProtection && spawnProtectionUntil > 0 && runtime.now < spawnProtectionUntil) {
    return rejected('spawn_protection');
  }
  if (adapter.isDamageImmune?.(target)) return rejected('immune');
  if (source && !input.skipDamageBudget && !consumeDamageBudget(runtime, source, target, input.rawDamage, input.damageType)) {
    return rejected('damage_cap');
  }

  const absorption = input.absorbDamage?.(input.rawDamage, {
    source,
    target,
    rawDamage: input.rawDamage,
    damageType: input.damageType,
    abilityId: input.abilityId,
    sourcePosition,
    sourceDirection,
    now: runtime.now,
  });
  let damageToApply = absorption ? absorption.remainingDamage : input.rawDamage;
  if (damageToApply <= 0) return rejected('absorbed');

  if (!damageDownedTarget && !input.bypassPersonalShield && adapter.getPersonalShieldState?.(target)?.isActive) {
    adapter.deactivatePersonalShield?.(target);
    return {
      applied: false,
      killed: false,
      target,
      source,
      sourceId,
      damageType: input.damageType,
      damage: 0,
      appliedDamage: 0,
      newHealth: targetHealth,
      sourcePosition,
      sourceDirection,
      personalShieldBroken: true,
      shieldDamage: 0,
      newShield: adapter.getShield?.(target) ?? 0,
      shieldBroken: false,
      downed: null,
      death: null,
    };
  }

  damageToApply *= getDamageTakenMultiplier(adapter, target);
  const damage = Math.max(1, Math.round(damageToApply));

  // Depletable shield pool absorbs before health.
  const shieldBefore = input.bypassShield ? 0 : adapter.getShield?.(target) ?? 0;
  const shieldDamage = Math.min(Math.max(0, shieldBefore), damage);
  const newShield = Math.max(0, shieldBefore - shieldDamage);
  if (shieldDamage > 0) {
    adapter.setShield?.(target, newShield);
  }
  const shieldBroken = shieldDamage > 0 && newShield <= 0;

  const healthDamage = damage - shieldDamage;
  const appliedDamage = Math.min(targetHealth, healthDamage) + shieldDamage;
  const newHealth = Math.max(0, targetHealth - healthDamage);
  if (damageDownedTarget) {
    adapter.setDownedHealth!(target, newHealth);
  } else {
    adapter.setHealth(target, newHealth);
  }

  if (source && sourceId && sourceId !== adapter.getId(target)) {
    const creditDamage = runtime.creditOverkillDamage === false ? appliedDamage : damage;
    addUltimateCharge(
      adapter,
      source,
      creditDamage / Math.max(1, damageDownedTarget ? adapter.getDownedMaxHealth?.(target) ?? adapter.getMaxHealth(target) : adapter.getMaxHealth(target)) *
        (runtime.ultimateChargePerDamageRatio ?? DEFAULT_ULTIMATE_CHARGE_PER_DAMAGE_RATIO)
    );
    recordDamageHistory(
      runtime.damageHistory,
      adapter.getId(target),
      sourceId,
      creditDamage,
      runtime.now,
      input.damageType,
      sourcePosition,
      sourceDirection
    );
  }

  const downed = !damageDownedTarget && newHealth <= 0 && runtime.lethalAliveResolution === 'downed'
    ? resolveDowned(runtime, target, source)
    : null;
  const death = !downed && newHealth <= 0 ? resolveDamageDeath(runtime, target, source) : null;

  return {
    applied: true,
    killed: Boolean(death),
    target,
    source,
    sourceId,
    damageType: input.damageType,
    damage,
    appliedDamage,
    newHealth: adapter.getHealth(target),
    sourcePosition,
    sourceDirection,
    personalShieldBroken: false,
    shieldDamage,
    newShield: adapter.getShield?.(target) ?? 0,
    shieldBroken,
    downed,
    newDownedHealth: damageDownedTarget ? adapter.getDownedHealth?.(target) : downed?.downedHealth,
    death,
  };
}

export function calculateFalloffDamage(
  damage: number,
  distance: number,
  radius: number,
  falloffScale: number
): number {
  if (damage <= 0 || radius <= 0) return 0;
  const clampedDistance = Math.max(0, Math.min(radius, distance));
  const falloff = 1 - (clampedDistance / radius) * falloffScale;
  return Math.max(1, Math.round(damage * falloff));
}

export function shouldApplyDamageTick(
  tickMap: Map<string, number>,
  key: string,
  intervalMs: number | undefined,
  now: number
): boolean {
  if (!intervalMs || intervalMs <= 0) return true;

  const lastTick = tickMap.get(key) ?? 0;
  if (now - lastTick < intervalMs) return false;
  tickMap.set(key, now);
  return true;
}
