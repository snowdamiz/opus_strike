import {
  applyDamage as resolveSharedDamage,
  calculateFalloffDamage,
  getPlayerBodyAimPosition,
  getSegmentHitAgainstPlayerCombatHitbox,
  shouldApplyDamageTick,
  type DamageEngineAdapter,
  type DamageHistoryStore,
  type Player,
  type Team,
  type Vec3,
} from '@voxel-strike/shared';
import { useCombatFeedbackStore } from '../store/combatFeedbackStore';
import { useGameStore } from '../store/gameStore';
import { syncPlayerVisualEffectIndexes } from '../store/visualStore';

export const OFFLINE_TRAINING_HERO_ID_PREFIX = 'tutorial_training_hero_';
export const OFFLINE_TRAINING_HERO_RESPAWN_MS = 1800;

interface OfflineTrainingDamageInput {
  target: Player | null | undefined;
  damage: number;
  damageType: string;
  hitPosition: Vec3;
  sourceId?: string | null;
  sourceTeam?: Team | null;
  abilityId?: string;
}

interface OfflineTrainingDamageResult {
  applied: boolean;
  killed: boolean;
  damage: number;
}

interface OfflineTrainingAreaDamageInput {
  center: Vec3;
  radius: number;
  damage: number;
  damageType: string;
  sourceId?: string | null;
  sourceTeam?: Team | null;
  abilityId?: string;
  falloffScale?: number;
  damageIntervalMs?: number;
  lastDamageTick?: Map<string, number>;
}

interface OfflineTrainingConeDamageInput {
  origin: Vec3;
  direction: Vec3;
  range: number;
  coneDot: number;
  extraRadius: number;
  damage: number;
  damageType: string;
  sourceId?: string | null;
  sourceTeam?: Team | null;
  abilityId?: string;
  falloffScale?: number;
  damageIntervalMs?: number;
  burn?: {
    damage: number;
    damageType: string;
    ticks: number;
    intervalMs: number;
    abilityId?: string;
  };
}

interface OfflineBurn {
  targetId: string;
  sourceId: string | null;
  sourceTeam: Team | null;
  damage: number;
  damageType: string;
  abilityId?: string;
  ticksRemaining: number;
  intervalMs: number;
  nextTickAt: number;
}

const offlineDamageTicks = new Map<string, number>();
const offlineBurns = new Map<string, OfflineBurn>();
const offlineDamageHistory: DamageHistoryStore = new Map();

export function isOfflineTrainingHeroId(playerId: string | null | undefined): boolean {
  return Boolean(playerId?.startsWith(OFFLINE_TRAINING_HERO_ID_PREFIX));
}

export function isOfflineTrainingHero(player: Player | null | undefined): player is Player {
  return Boolean(player && isOfflineTrainingHeroId(player.id));
}

function getOfflineSource(input: Pick<OfflineTrainingDamageInput, 'sourceId' | 'sourceTeam'>): {
  sourceId: string | null;
  sourceTeam: Team | null;
} {
  const store = useGameStore.getState();
  const sourceId = input.sourceId ?? store.localPlayer?.id ?? store.playerId ?? null;
  const source = sourceId ? store.players.get(sourceId) ?? null : null;
  return {
    sourceId,
    sourceTeam: input.sourceTeam ?? source?.team ?? store.localPlayer?.team ?? null,
  };
}

function getDefaultDamageResult(): OfflineTrainingDamageResult {
  return { applied: false, killed: false, damage: 0 };
}

function clonePlayerForDamage(player: Player): Player {
  return {
    ...player,
    position: { ...player.position },
    velocity: { ...player.velocity },
    movement: {
      ...player.movement,
      grapplePoint: player.movement.grapplePoint ? { ...player.movement.grapplePoint } : null,
    },
    abilities: Object.fromEntries(
      Object.entries(player.abilities).map(([abilityId, ability]) => [abilityId, { ...ability }])
    ),
    stats: { ...player.stats },
  };
}

function createDamageDrafts(players: Map<string, Player>): {
  drafts: Map<string, Player>;
  getDraft: (playerId: string) => Player | null;
} {
  const drafts = new Map<string, Player>();
  return {
    drafts,
    getDraft: (playerId) => {
      const draft = drafts.get(playerId);
      if (draft) return draft;

      const player = players.get(playerId);
      if (!player) return null;

      const nextDraft = clonePlayerForDamage(player);
      drafts.set(playerId, nextDraft);
      return nextDraft;
    },
  };
}

function createOfflineDamageAdapter(getDraft: (playerId: string) => Player | null): DamageEngineAdapter<Player> {
  return {
    getPlayerById: getDraft,
    getId: (player) => player.id,
    getTeam: (player) => player.team,
    getState: (player) => player.state,
    setState: (player, state) => {
      player.state = state;
    },
    getHealth: (player) => player.health,
    setHealth: (player, health) => {
      player.health = health;
    },
    getMaxHealth: (player) => player.maxHealth,
    getSpawnProtectionUntil: (player) => player.spawnProtectionUntil ?? null,
    getUltimateCharge: (player) => player.ultimateCharge,
    setUltimateCharge: (player, charge) => {
      player.ultimateCharge = charge;
    },
    getPersonalShieldState: (player) => player.abilities.phantom_personal_shield ?? null,
    deactivatePersonalShield: (player) => {
      const shield = player.abilities.phantom_personal_shield;
      if (!shield) return;
      shield.isActive = false;
      shield.activatedAt = 0;
    },
    setRespawnTime: (player, respawnTime) => {
      player.respawnTime = respawnTime;
    },
    addKill: (player) => {
      player.stats = { ...player.stats, kills: player.stats.kills + 1 };
    },
    addDeath: (player) => {
      player.stats = { ...player.stats, deaths: player.stats.deaths + 1 };
    },
    addAssist: (player) => {
      player.stats = { ...player.stats, assists: player.stats.assists + 1 };
    },
  };
}

function applyDrafts(drafts: Map<string, Player>, now: number): void {
  const store = useGameStore.getState();
  for (const [playerId, player] of drafts) {
    if (!store.players.has(playerId)) continue;

    if (playerId === store.localPlayer?.id) {
      store.updateLocalPlayer(player);
    } else {
      store.updatePlayer(playerId, player);
    }

    if (isOfflineTrainingHero(player)) {
      syncPlayerVisualEffectIndexes(player, {
        localPlayerId: store.localPlayer?.id ?? null,
        nowMs: now,
      });
    }
  }
}

function prepareDeadTrainingHero(player: Player): void {
  player.velocity = { x: 0, y: 0, z: 0 };
  player.movement = {
    ...player.movement,
    isGrounded: true,
    isSprinting: false,
    isCrouching: false,
    isSliding: false,
    slideTimeRemaining: 0,
  };
}

function clearTargetDamageRuntime(targetId: string): void {
  offlineBurns.delete(targetId);
  offlineDamageHistory.delete(targetId);
  for (const key of Array.from(offlineDamageTicks.keys())) {
    if (key.includes(`:${targetId}:`)) {
      offlineDamageTicks.delete(key);
    }
  }
}

function extendOfflineTargetBurn(targetId: string, burnUntil: number, now: number): void {
  const store = useGameStore.getState();
  const current = store.players.get(targetId);
  if (!isOfflineTrainingHero(current) || current.state !== 'alive') return;

  const nextPlayer = {
    ...current,
    onFireUntil: Math.max(current.onFireUntil ?? 0, burnUntil),
  };
  store.updatePlayer(current.id, nextPlayer);
  syncPlayerVisualEffectIndexes(nextPlayer, {
    localPlayerId: store.localPlayer?.id ?? null,
    nowMs: now,
  });
}

export function applyOfflineTrainingDamage(input: OfflineTrainingDamageInput): OfflineTrainingDamageResult {
  if (!isOfflineTrainingHero(input.target)) return getDefaultDamageResult();

  const store = useGameStore.getState();
  if (!store.isPracticeMode || store.gamePhase !== 'playing') return getDefaultDamageResult();

  const current = store.players.get(input.target.id);
  if (!isOfflineTrainingHero(current) || current.state !== 'alive') return getDefaultDamageResult();

  const now = Date.now();
  const { sourceId, sourceTeam } = getOfflineSource(input);
  if (sourceTeam && current.team === sourceTeam) return getDefaultDamageResult();

  const { drafts, getDraft } = createDamageDrafts(store.players);
  const target = getDraft(current.id);
  const source = sourceId ? getDraft(sourceId) : null;
  if (!target) return getDefaultDamageResult();

  const result = resolveSharedDamage({
    adapter: createOfflineDamageAdapter(getDraft),
    damageHistory: offlineDamageHistory,
    now,
    assistWindowMs: 10000,
    respawnDelayMs: OFFLINE_TRAINING_HERO_RESPAWN_MS,
    creditOverkillDamage: false,
    ultimateChargePerKill: 0,
    ultimateChargePerAssist: 0,
  }, {
    target,
    source,
    rawDamage: input.damage,
    damageType: input.damageType,
    abilityId: input.abilityId,
    sourcePosition: source ? { ...source.position } : null,
    sourceDirection: null,
  });

  if (!result.applied) return getDefaultDamageResult();

  if (result.death) {
    prepareDeadTrainingHero(target);
    clearTargetDamageRuntime(target.id);
  }

  applyDrafts(drafts, now);

  useCombatFeedbackStore.getState().addCombatTextEvent({
    kind: 'damage',
    amount: result.appliedDamage,
    damageType: input.damageType,
    targetId: current.id,
    position: input.hitPosition,
  });

  if (result.death) {
    useCombatFeedbackStore.getState().addKillFeedEvent({
      killerName: source?.name || (sourceId ? 'You' : 'Training'),
      victimName: current.name,
    });
  }

  return { applied: true, killed: result.killed, damage: result.appliedDamage };
}

export function applyOfflineTrainingAreaDamage(input: OfflineTrainingAreaDamageInput): number {
  const store = useGameStore.getState();
  if (!store.isPracticeMode || store.gamePhase !== 'playing' || input.radius <= 0 || input.damage <= 0) return 0;

  const now = Date.now();
  const { sourceId, sourceTeam } = getOfflineSource(input);
  const radiusSq = input.radius * input.radius;
  const falloffScale = input.falloffScale ?? 0.45;
  let appliedCount = 0;

  for (const target of store.players.values()) {
    if (!isOfflineTrainingHero(target) || target.state !== 'alive') continue;
    if (sourceTeam && target.team === sourceTeam) continue;

    const dx = target.position.x - input.center.x;
    const dy = target.position.y - input.center.y;
    const dz = target.position.z - input.center.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > radiusSq) continue;

    const tickKey = `${sourceId ?? 'offline'}:${target.id}:${input.damageType}`;
    if (!shouldApplyDamageTick(input.lastDamageTick ?? offlineDamageTicks, tickKey, input.damageIntervalMs, now)) continue;

    const result = applyOfflineTrainingDamage({
      target,
      damage: calculateFalloffDamage(input.damage, Math.sqrt(distSq), input.radius, falloffScale),
      damageType: input.damageType,
      hitPosition: input.center,
      sourceId,
      sourceTeam,
      abilityId: input.abilityId,
    });
    if (result.applied) appliedCount++;
  }

  return appliedCount;
}

export function applyOfflineTrainingConeDamage(input: OfflineTrainingConeDamageInput): number {
  const store = useGameStore.getState();
  if (!store.isPracticeMode || store.gamePhase !== 'playing' || input.range <= 0 || input.damage <= 0) return 0;

  const now = Date.now();
  const { sourceId, sourceTeam } = getOfflineSource(input);
  const directionLength = Math.hypot(input.direction.x, input.direction.y, input.direction.z);
  if (directionLength <= 0.0001) return 0;

  const direction = {
    x: input.direction.x / directionLength,
    y: input.direction.y / directionLength,
    z: input.direction.z / directionLength,
  };
  const coneAngle = Math.acos(Math.max(-1, Math.min(1, input.coneDot)));
  const falloffScale = input.falloffScale ?? 0.35;
  let appliedCount = 0;

  for (const target of store.players.values()) {
    if (!isOfflineTrainingHero(target) || target.state !== 'alive') continue;
    if (sourceTeam && target.team === sourceTeam) continue;

    const hit = getSegmentHitAgainstPlayerCombatHitbox(
      input.origin,
      direction,
      input.range,
      { position: target.position, heroId: target.heroId },
      input.extraRadius
    );
    if (!hit) continue;

    const targetCenter = getPlayerBodyAimPosition({ position: target.position, heroId: target.heroId });
    const toCenter = {
      x: targetCenter.x - input.origin.x,
      y: targetCenter.y - input.origin.y,
      z: targetCenter.z - input.origin.z,
    };
    const centerDistance = Math.hypot(toCenter.x, toCenter.y, toCenter.z);
    if (centerDistance <= 0.0001) continue;

    const centerDot = Math.max(-1, Math.min(1, (
      toCenter.x * direction.x +
      toCenter.y * direction.y +
      toCenter.z * direction.z
    ) / centerDistance));
    const hitboxAngle = Math.atan2(hit.radius, Math.max(hit.distance, hit.radius));
    if (Math.acos(centerDot) > coneAngle + hitboxAngle) continue;

    const tickKey = `${sourceId ?? 'offline'}:${target.id}:${input.damageType}`;
    if (!shouldApplyDamageTick(offlineDamageTicks, tickKey, input.damageIntervalMs, now)) continue;

    const result = applyOfflineTrainingDamage({
      target,
      damage: calculateFalloffDamage(input.damage, hit.distance, input.range, falloffScale),
      damageType: input.damageType,
      hitPosition: hit.targetPoint,
      sourceId,
      sourceTeam,
      abilityId: input.abilityId,
    });

    if (!result.applied) continue;
    appliedCount++;

    if (input.burn && !result.killed) {
      const burnUntil = now + input.burn.intervalMs * input.burn.ticks;
      offlineBurns.set(target.id, {
        targetId: target.id,
        sourceId,
        sourceTeam,
        damage: input.burn.damage,
        damageType: input.burn.damageType,
        abilityId: input.burn.abilityId ?? input.abilityId,
        ticksRemaining: input.burn.ticks,
        intervalMs: input.burn.intervalMs,
        nextTickAt: now + input.burn.intervalMs,
      });
      extendOfflineTargetBurn(target.id, burnUntil, now);
    }
  }

  return appliedCount;
}

export function updateOfflineTrainingDamageOverTime(now = Date.now()): void {
  if (offlineBurns.size === 0) return;

  for (const burn of Array.from(offlineBurns.values())) {
    const store = useGameStore.getState();
    const target = store.players.get(burn.targetId);
    if (!isOfflineTrainingHero(target) || target.state !== 'alive' || burn.ticksRemaining <= 0) {
      offlineBurns.delete(burn.targetId);
      continue;
    }

    while (burn.ticksRemaining > 0 && now >= burn.nextTickAt) {
      const currentTarget = useGameStore.getState().players.get(burn.targetId);
      if (!isOfflineTrainingHero(currentTarget) || currentTarget.state !== 'alive') {
        break;
      }

      const result = applyOfflineTrainingDamage({
        target: currentTarget,
        damage: burn.damage,
        damageType: burn.damageType,
        hitPosition: currentTarget.position,
        sourceId: burn.sourceId,
        sourceTeam: burn.sourceTeam,
        abilityId: burn.abilityId,
      });
      burn.ticksRemaining--;
      burn.nextTickAt += burn.intervalMs;

      if (result.killed || !result.applied) {
        break;
      }
    }

    if (burn.ticksRemaining <= 0) {
      offlineBurns.delete(burn.targetId);
    }
  }
}
