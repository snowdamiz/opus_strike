import {
  ULTIMATE_CHARGE_PER_KILL,
  applyDamage as resolveSharedDamage,
  type ApplyDamageResult,
  type DamageEngineAdapter,
  type DamageHistoryStore,
  type DamageCapWindowStore,
  type PlayerDamagedEvent,
  type PlayerDownedEvent,
  type PlayerDeathEvent,
  type Team,
  resolveDamageDeath,
} from '@voxel-strike/shared';
import { Player } from './schema/Player';
import { deactivateActiveAbility } from './abilityHandlers';
import { isTeam } from './protocolValidation';
import type { BotRecentDamageSource, PlainVec3 } from './bot-ai';

const DAMAGE_HISTORY_WINDOW_MS = 10000;
const DAMAGE_CAP_WINDOW_MS = 1000;
const DAMAGE_CAP_PER_SOURCE_TARGET_MULTIPLIER = 2.25;
const NPC_ULTIMATE_CHARGE_PER_KILL = 20;

export interface RoomDamageContext {
  abilityId?: string;
  sourcePosition?: PlainVec3 | null;
  sourceDirection?: PlainVec3 | null;
  allowFriendlyFire?: boolean;
  bypassSpawnProtection?: boolean;
  bypassPersonalShield?: boolean;
  skipDamageBudget?: boolean;
}

export interface RoomDamageAegisHit {
  blocker: Player;
  point: PlainVec3;
  normal: PlainVec3;
  distance: number;
}

export interface RoomDamageRuntimeDeps {
  getPlayerById(playerId: string): Player | null;
  isDevelopmentMode(): boolean;
  isPlayerDevImmune(playerId: string): boolean;
  getRespawnDelayMs(): number | null;
  vec3ToPlain(value: { x: number; y: number; z: number }): PlainVec3;
  normalize3D(value: PlainVec3): PlainVec3 | null;
  getPlayerEyePosition(player: Player): PlainVec3;
  shouldDamageBypassChronosAegis(damageType: string, context: RoomDamageContext): boolean;
  getChronosAegisBlockerHit(target: Player, source: Player, sourcePoint?: PlainVec3): RoomDamageAegisHit | null;
  absorbDamageWithChronosAegis(
    blocker: Player,
    rawDamage: number,
    now: number,
    context: {
      source?: Player | null;
      damageType?: string;
      position?: PlainVec3;
      direction?: PlainVec3;
    }
  ): number;
  rejectAbilityOrCombat(player: Player, reason: string): void;
  markCombatActivityBetween(source: Player | null, target: Player, now: number): void;
  markRecentCombatTransform(playerId: string, now: number): void;
  markRecentCombatInterest(sourceId: string, targetId: string, now: number): void;
  recordRankedBrCombatReward?(input: {
    target: Player;
    source: Player | null;
    appliedDamage: number;
    finalEnemyElimination: boolean;
    damageType: string;
  }): { amountLamports: string } | null;
  broadcastPhantomShieldBroken(
    target: Player,
    source: Player | null,
    payload: { playerId: string; position: PlainVec3; direction: PlainVec3; serverTime: number }
  ): void;
  broadcastPlayerDamaged(target: Player, source: Player | null, payload: PlayerDamagedEvent): void;
  broadcastPlayerKilled(target: Player, killer: Player | null, payload: PlayerDeathEvent): void;
  shouldDownLethalDamage(target: Player): boolean;
  shouldDamageDownedPlayers(): boolean;
  enterBattleRoyalDowned(
    target: Player,
    source: Player | null,
    payload: PlayerDownedEvent
  ): void;
  recordMatchDeath(victim: Player, killer: Player | null): void;
  recordMatchKill(killer: Player, victim: Player, details?: {
    abilityId?: string | null;
    damageType?: string | null;
    victimHadFlag?: boolean;
    occurredAt?: Date;
  }): void;
  recordMatchAssist(assister: Player, victim: Player): void;
  resetPlayerLifeRuntime(player: Player, deathAt: number): void;
  isCaptureTheFlagMode(): boolean;
  dropFlag(player: Player): void;
  scoreTeamDeathmatchKill(killer: Player, victim: Player): void;
  removeNpcPlayer(playerId: string): void;
}

export class RoomDamageRuntime {
  private readonly damageHistory: DamageHistoryStore = new Map();
  private readonly damageCapWindows: DamageCapWindowStore = new Map();
  private readonly damageEngineAdapter: DamageEngineAdapter<Player>;

  constructor(private readonly deps: RoomDamageRuntimeDeps) {
    this.damageEngineAdapter = {
      getPlayerById: (id) => this.deps.getPlayerById(id),
      getId: (player) => player.id,
      getTeam: (player) => isTeam(player.team) ? player.team : null,
      getState: (player) => player.state,
      setState: (player, state) => {
        player.state = state;
      },
      getHealth: (player) => player.health,
      setHealth: (player, health) => {
        player.health = health;
      },
      getMaxHealth: (player) => player.maxHealth,
      getDownedHealth: (player) => player.downedHealth,
      setDownedHealth: (player, health) => {
        player.downedHealth = health;
      },
      getDownedMaxHealth: (player) => player.downedMaxHealth,
      getSpawnProtectionUntil: (player) => player.spawnProtectionUntil || null,
      getUltimateCharge: (player) => player.ultimateCharge,
      setUltimateCharge: (player, charge) => {
        player.ultimateCharge = charge;
      },
      getPersonalShieldState: (player) => player.abilities.get('phantom_personal_shield') ?? null,
      deactivatePersonalShield: (player) => {
        const shield = player.abilities.get('phantom_personal_shield');
        if (shield) deactivateActiveAbility(shield);
      },
      setRespawnTime: (player, respawnTime) => {
        player.respawnTime = respawnTime ?? 0;
      },
      addKill: (player) => {
        player.kills++;
      },
      addDeath: (player) => {
        player.deaths++;
      },
      addAssist: (player) => {
        player.assists++;
      },
      isDamageImmune: (player) => this.deps.isDevelopmentMode() && this.deps.isPlayerDevImmune(player.id),
    };
  }

  cleanupDamageWindows(now: number): void {
    if (this.damageCapWindows.size === 0) return;
    for (const [key, window] of this.damageCapWindows) {
      if (now - window.startedAt >= DAMAGE_CAP_WINDOW_MS * 3) {
        this.damageCapWindows.delete(key);
      }
    }
  }

  getBotRecentDamageSources(botId: string, now: number): BotRecentDamageSource[] {
    const history = this.damageHistory.get(botId);
    if (!history) return [];
    const sources: BotRecentDamageSource[] = [];
    for (const [sourceId, entry] of history) {
      if (now - entry.timestamp > DAMAGE_HISTORY_WINDOW_MS) continue;
      sources.push({
        sourceId,
        damage: entry.damage,
        timestamp: entry.timestamp,
        sourcePosition: entry.sourcePosition ? { ...entry.sourcePosition } : null,
        sourceDirection: entry.sourceDirection ? { ...entry.sourceDirection } : null,
        damageType: entry.damageType,
      });
    }
    sources.sort((a, b) => b.timestamp - a.timestamp || b.damage - a.damage);
    return sources;
  }

  applyPlayerDamage(
    target: Player,
    rawDamage: number,
    sourceId: string | null,
    damageType: string,
    context: RoomDamageContext = {}
  ): boolean {
    const source = sourceId ? this.deps.getPlayerById(sourceId) : null;
    const now = Date.now();
    const sourcePosition = context.sourcePosition !== undefined
      ? context.sourcePosition
      : source
        ? this.deps.vec3ToPlain(source.position)
        : null;
    const sourceDirection = context.sourceDirection !== undefined
      ? context.sourceDirection
      : sourcePosition
        ? this.deps.normalize3D({
          x: target.position.x - sourcePosition.x,
          y: target.position.y - sourcePosition.y,
          z: target.position.z - sourcePosition.z,
        })
        : null;

    const result = resolveSharedDamage({
      adapter: this.damageEngineAdapter,
      damageHistory: this.damageHistory,
      damageCapWindows: this.damageCapWindows,
      now,
      assistWindowMs: DAMAGE_HISTORY_WINDOW_MS,
      damageCapWindowMs: DAMAGE_CAP_WINDOW_MS,
      damageCapPerSourceTargetMultiplier: DAMAGE_CAP_PER_SOURCE_TARGET_MULTIPLIER,
      respawnDelayMs: this.deps.getRespawnDelayMs(),
      ultimateChargePerKill: ULTIMATE_CHARGE_PER_KILL,
      ultimateChargePerAssist: 8,
      lethalAliveResolution: this.deps.shouldDownLethalDamage(target) ? 'downed' : 'death',
      damageDownedPlayers: this.deps.shouldDamageDownedPlayers(),
    }, {
      target,
      source,
      rawDamage,
      damageType,
      abilityId: context.abilityId,
      sourcePosition,
      sourceDirection,
      allowFriendlyFire: context.allowFriendlyFire,
      bypassSpawnProtection: context.bypassSpawnProtection,
      bypassPersonalShield: context.bypassPersonalShield,
      skipDamageBudget: context.skipDamageBudget,
      absorbDamage: (damageToApply) => {
        const aegisHit = source && !this.deps.shouldDamageBypassChronosAegis(damageType, context)
          ? this.deps.getChronosAegisBlockerHit(target, source, sourcePosition ?? this.deps.getPlayerEyePosition(source))
          : null;
        if (!aegisHit) return { remainingDamage: damageToApply };

        return {
          remainingDamage: this.deps.absorbDamageWithChronosAegis(aegisHit.blocker, damageToApply, now, {
            source,
            damageType,
            position: aegisHit.point,
            direction: aegisHit.normal,
          }),
        };
      },
    });

    this.applyDamageResolutionSideEffects(result, {
      ...context,
      damageType,
      sourcePosition,
      sourceDirection,
    });

    return result.killed;
  }

  applyNpcDamage(
    npc: Player,
    source: Player | null,
    rawDamage: number,
    sourcePosition: PlainVec3 | null,
    sourceDirection: PlainVec3 | null
  ): ApplyDamageResult<Player> {
    return this.resolveConsoleNpcDamage(npc, source, rawDamage, sourcePosition, sourceDirection);
  }

  killNpc(
    npc: Player,
    killer: Player | null,
    sourcePosition: PlainVec3 | null,
    sourceDirection: PlainVec3 | null
  ): ApplyDamageResult<Player> {
    return this.resolveConsoleNpcDamage(
      npc,
      killer,
      Math.max(1, npc.health, npc.maxHealth),
      sourcePosition,
      sourceDirection
    );
  }

  handleNpcDamageDeath(npc: Player, killer: Player | null, result: ApplyDamageResult<Player>): void {
    if (!result.death) return;

    this.deps.broadcastPlayerKilled(npc, killer ?? null, {
      victimId: npc.id,
      killerId: result.death.killerId,
      assistIds: result.death.assistIds,
      position: { x: npc.position.x, y: npc.position.y, z: npc.position.z },
      velocity: { x: npc.velocity.x, y: npc.velocity.y, z: npc.velocity.z },
      sourcePosition: result.sourcePosition,
      sourceDirection: result.sourceDirection,
      damageType: result.damageType,
      occurredAt: result.death.deathAt,
      respawnTime: null,
      isNpc: true,
    });

    this.deps.removeNpcPlayer(npc.id);
  }

  finalEliminatePlayer(
    target: Player,
    sourceId: string | null,
    damageType: string,
    now: number,
    context: RoomDamageContext = {}
  ): void {
    const source = sourceId ? this.deps.getPlayerById(sourceId) : null;
    const death = resolveDamageDeath({
      adapter: this.damageEngineAdapter,
      damageHistory: this.damageHistory,
      now,
      assistWindowMs: DAMAGE_HISTORY_WINDOW_MS,
      respawnDelayMs: this.deps.getRespawnDelayMs(),
      ultimateChargePerKill: ULTIMATE_CHARGE_PER_KILL,
      ultimateChargePerAssist: 8,
    }, target, source);

    this.applyDamageResolutionSideEffects({
      applied: true,
      killed: true,
      target,
      source,
      sourceId: source?.id ?? null,
      damageType,
      damage: 0,
      appliedDamage: 0,
      newHealth: target.health,
      sourcePosition: context.sourcePosition ?? null,
      sourceDirection: context.sourceDirection ?? null,
      personalShieldBroken: false,
      downed: null,
      death,
    }, {
      ...context,
      damageType,
    });
  }

  private resolveConsoleNpcDamage(
    npc: Player,
    source: Player | null,
    rawDamage: number,
    sourcePosition: PlainVec3 | null,
    sourceDirection: PlainVec3 | null
  ): ApplyDamageResult<Player> {
    return resolveSharedDamage({
      adapter: this.damageEngineAdapter,
      damageHistory: this.damageHistory,
      now: Date.now(),
      assistWindowMs: DAMAGE_HISTORY_WINDOW_MS,
      respawnDelayMs: null,
      ultimateChargePerKill: NPC_ULTIMATE_CHARGE_PER_KILL,
      ultimateChargePerAssist: 0,
    }, {
      target: npc,
      source,
      rawDamage,
      damageType: 'console',
      sourcePosition,
      sourceDirection,
      allowFriendlyFire: true,
      bypassPersonalShield: true,
      skipDamageBudget: true,
    });
  }

  private applyDamageResolutionSideEffects(
    result: ApplyDamageResult<Player>,
    context: RoomDamageContext & { damageType: string }
  ): void {
    const now = result.death?.deathAt ?? Date.now();
    const target = result.target;
    const source = result.source;

    if (result.rejectedReason === 'damage_cap' && source) {
      this.deps.rejectAbilityOrCombat(source, `damage_cap:${result.damageType}`);
      return;
    }

    if (result.personalShieldBroken) {
      this.deps.markCombatActivityBetween(source ?? null, target, now);
      this.deps.broadcastPhantomShieldBroken(target, source ?? null, {
        playerId: target.id,
        position: this.deps.vec3ToPlain(target.position),
        direction: result.sourceDirection ?? { x: 0, y: 1, z: 0 },
        serverTime: now,
      });
      return;
    }

    if (!result.applied) return;

    this.deps.markCombatActivityBetween(source ?? null, target, now);
    this.deps.markRecentCombatTransform(target.id, now);
    if (source && source.id !== target.id) {
      this.deps.markRecentCombatTransform(source.id, now);
      this.deps.markRecentCombatInterest(source.id, target.id, now);
    }
    const rankedBrReward = this.deps.recordRankedBrCombatReward?.({
      target,
      source: source ?? null,
      appliedDamage: result.appliedDamage,
      finalEnemyElimination: Boolean(result.death && source && result.death.killerId === source.id),
      damageType: result.damageType,
    }) ?? null;

    this.deps.broadcastPlayerDamaged(target, source ?? null, {
      targetId: target.id,
      damage: result.damage,
      sourceId: result.sourceId,
      damageType: result.damageType,
      newHealth: result.newHealth,
      newDownedHealth: result.newDownedHealth,
      sourcePosition: result.sourcePosition,
      sourceDirection: result.sourceDirection,
      targetPosition: this.deps.vec3ToPlain(target.position),
      sourceHeroId: source?.heroId || null,
      targetHeroId: target.heroId || null,
      rankedBrSolRewardLamports: rankedBrReward?.amountLamports,
    });

    if (result.downed) {
      const downed = result.downed;
      const payload: PlayerDownedEvent = {
        targetId: target.id,
        sourceId: downed.sourceId,
        damageType: result.damageType,
        downedHealth: downed.downedHealth,
        downedMaxHealth: downed.downedMaxHealth,
        downedStartedAt: downed.downedAt,
        downedRemainingMs: 0,
        downedExpiresAt: null,
        position: { x: target.position.x, y: target.position.y, z: target.position.z },
        sourcePosition: result.sourcePosition,
        sourceDirection: result.sourceDirection,
      };
      this.deps.enterBattleRoyalDowned(target, source ?? null, payload);
      return;
    }

    if (!result.death) return;

    const death = result.death;
    const killer = death.killer;
    const deathPosition = { x: target.position.x, y: target.position.y, z: target.position.z };
    const deathVelocity = { x: target.velocity.x, y: target.velocity.y, z: target.velocity.z };
    const victimHadFlag = target.hasFlag;
    this.deps.recordMatchDeath(target, killer ?? null);
    this.deps.resetPlayerLifeRuntime(target, death.deathAt);

    if (this.deps.isCaptureTheFlagMode() && target.hasFlag) {
      this.deps.dropFlag(target);
    }

    if (killer) {
      this.deps.recordMatchKill(killer, target, {
        abilityId: context.abilityId ?? null,
        damageType: context.damageType ?? death.lastDamageEntry?.damageType ?? null,
        victimHadFlag,
        occurredAt: new Date(death.deathAt),
      });
      this.deps.scoreTeamDeathmatchKill(killer, target);
    }

    for (const assistId of death.assistIds) {
      const assister = this.deps.getPlayerById(assistId);
      if (assister) this.deps.recordMatchAssist(assister, target);
    }

    this.deps.broadcastPlayerKilled(target, killer ?? null, {
      victimId: target.id,
      killerId: death.killerId,
      assistIds: death.assistIds,
      position: deathPosition,
      velocity: deathVelocity,
      sourcePosition: context.sourcePosition ?? death.lastDamageEntry?.sourcePosition ?? (killer ? this.deps.vec3ToPlain(killer.position) : null),
      sourceDirection: context.sourceDirection ?? death.lastDamageEntry?.sourceDirection ?? null,
      damageType: context.damageType ?? death.lastDamageEntry?.damageType,
      abilityId: context.abilityId,
      occurredAt: death.deathAt,
      respawnTime: target.respawnTime || null,
    });
  }
}
