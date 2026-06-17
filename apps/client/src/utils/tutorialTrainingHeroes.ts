import {
  getPlayerBodyAimPosition,
  getSegmentHitAgainstPlayerCombatHitbox,
  type Player,
  type Team,
  type Vec3,
} from '@voxel-strike/shared';
import { useCombatFeedbackStore } from '../store/combatFeedbackStore';
import { useGameStore } from '../store/gameStore';
import { syncPlayerVisualEffectIndexes } from '../store/visualStore';

export const TUTORIAL_TRAINING_HERO_ID_PREFIX = 'tutorial_training_hero_';
export const TUTORIAL_TRAINING_HERO_RESPAWN_MS = 1800;

interface TutorialTrainingDamageInput {
  target: Player | null | undefined;
  damage: number;
  damageType: string;
  hitPosition: Vec3;
  sourceId?: string | null;
  sourceTeam?: Team | null;
  abilityId?: string;
}

interface TutorialTrainingDamageResult {
  applied: boolean;
  killed: boolean;
  damage: number;
}

interface TutorialTrainingAreaDamageInput {
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

interface TutorialTrainingConeDamageInput {
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

interface TutorialBurn {
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

const tutorialDamageTicks = new Map<string, number>();
const tutorialBurns = new Map<string, TutorialBurn>();

export function isTutorialTrainingHeroId(playerId: string | null | undefined): boolean {
  return Boolean(playerId?.startsWith(TUTORIAL_TRAINING_HERO_ID_PREFIX));
}

export function isTutorialTrainingHero(player: Player | null | undefined): player is Player {
  return Boolean(player && isTutorialTrainingHeroId(player.id));
}

function getTutorialSource(input: Pick<TutorialTrainingDamageInput, 'sourceId' | 'sourceTeam'>): {
  source: Player | null;
  sourceId: string | null;
  sourceTeam: Team | null;
} {
  const store = useGameStore.getState();
  const sourceId = input.sourceId ?? store.localPlayer?.id ?? store.playerId ?? null;
  const source = sourceId ? store.players.get(sourceId) ?? null : null;
  return {
    source,
    sourceId,
    sourceTeam: input.sourceTeam ?? source?.team ?? store.localPlayer?.team ?? null,
  };
}

function getDefaultDamageResult(): TutorialTrainingDamageResult {
  return { applied: false, killed: false, damage: 0 };
}

function shouldApplyDamageTick(
  key: string,
  intervalMs: number | undefined,
  now: number,
  tickMap = tutorialDamageTicks
): boolean {
  if (!intervalMs || intervalMs <= 0) return true;

  const lastTick = tickMap.get(key) ?? 0;
  if (now - lastTick < intervalMs) return false;
  tickMap.set(key, now);
  return true;
}

function recordSourceDamage(source: Player | null, target: Player, damage: number): void {
  const store = useGameStore.getState();
  if (!source || source.id !== store.localPlayer?.id || source.id === target.id) return;

  store.updateLocalPlayer({
    ultimateCharge: Math.min(100, source.ultimateCharge + damage / Math.max(1, target.maxHealth) * 12),
    stats: target.health - damage <= 0
      ? { ...source.stats, kills: source.stats.kills + 1 }
      : source.stats,
  });
}

function clearTargetDamageRuntime(targetId: string): void {
  tutorialBurns.delete(targetId);
  for (const key of Array.from(tutorialDamageTicks.keys())) {
    if (key.includes(`:${targetId}:`)) {
      tutorialDamageTicks.delete(key);
    }
  }
}

function syncTutorialTargetEffects(player: Player, now: number): void {
  syncPlayerVisualEffectIndexes(player, {
    localPlayerId: useGameStore.getState().localPlayer?.id ?? null,
    nowMs: now,
  });
}

function extendTutorialTargetBurn(targetId: string, burnUntil: number, now: number): void {
  const store = useGameStore.getState();
  const current = store.players.get(targetId);
  if (!isTutorialTrainingHero(current) || current.state !== 'alive') return;

  const nextPlayer = {
    ...current,
    onFireUntil: Math.max(current.onFireUntil ?? 0, burnUntil),
  };
  store.updatePlayer(current.id, nextPlayer);
  syncTutorialTargetEffects(nextPlayer, now);
}

export function applyTutorialTrainingDamage(input: TutorialTrainingDamageInput): TutorialTrainingDamageResult {
  if (!isTutorialTrainingHero(input.target)) return getDefaultDamageResult();

  const store = useGameStore.getState();
  if (!store.isTutorialMode || store.gamePhase !== 'playing') return getDefaultDamageResult();

  const current = store.players.get(input.target.id);
  if (!isTutorialTrainingHero(current) || current.state !== 'alive') return getDefaultDamageResult();

  const now = Date.now();
  if (current.spawnProtectionUntil && now < current.spawnProtectionUntil) return getDefaultDamageResult();

  const { source, sourceId, sourceTeam } = getTutorialSource(input);
  if (sourceTeam && current.team === sourceTeam) return getDefaultDamageResult();

  const damage = Math.max(1, Math.round(input.damage));
  const appliedDamage = Math.min(current.health, damage);
  const nextHealth = Math.max(0, current.health - damage);
  const killed = nextHealth <= 0;
  const nextPlayer: Player = {
    ...current,
    health: nextHealth,
    state: killed ? 'dead' : current.state,
    respawnTime: killed ? now + TUTORIAL_TRAINING_HERO_RESPAWN_MS : current.respawnTime,
    velocity: killed ? { x: 0, y: 0, z: 0 } : current.velocity,
    movement: killed
      ? {
          ...current.movement,
          isGrounded: true,
          isSprinting: false,
          isCrouching: false,
          isSliding: false,
          slideTimeRemaining: 0,
        }
      : current.movement,
    stats: killed ? { ...current.stats, deaths: current.stats.deaths + 1 } : current.stats,
  };

  store.updatePlayer(current.id, nextPlayer);
  syncTutorialTargetEffects(nextPlayer, now);
  recordSourceDamage(source, current, appliedDamage);
  useCombatFeedbackStore.getState().addCombatTextEvent({
    kind: 'damage',
    amount: appliedDamage,
    damageType: input.damageType,
    targetId: current.id,
    position: input.hitPosition,
  });

  if (killed) {
    clearTargetDamageRuntime(current.id);
    useCombatFeedbackStore.getState().addKillFeedEvent({
      killerName: source?.name || (sourceId ? 'You' : 'Training'),
      victimName: current.name,
    });
  }

  return { applied: true, killed, damage: appliedDamage };
}

export function applyTutorialTrainingAreaDamage(input: TutorialTrainingAreaDamageInput): number {
  const store = useGameStore.getState();
  if (!store.isTutorialMode || store.gamePhase !== 'playing' || input.radius <= 0 || input.damage <= 0) return 0;

  const now = Date.now();
  const { sourceId, sourceTeam } = getTutorialSource(input);
  const radiusSq = input.radius * input.radius;
  const falloffScale = input.falloffScale ?? 0.45;
  let appliedCount = 0;

  for (const target of store.players.values()) {
    if (!isTutorialTrainingHero(target) || target.state !== 'alive') continue;
    if (sourceTeam && target.team === sourceTeam) continue;

    const dx = target.position.x - input.center.x;
    const dy = target.position.y - input.center.y;
    const dz = target.position.z - input.center.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > radiusSq) continue;

    const tickKey = `${sourceId ?? 'tutorial'}:${target.id}:${input.damageType}`;
    if (!shouldApplyDamageTick(tickKey, input.damageIntervalMs, now, input.lastDamageTick)) continue;

    const falloff = 1 - Math.sqrt(distSq) / input.radius * falloffScale;
    const result = applyTutorialTrainingDamage({
      target,
      damage: Math.max(1, Math.round(input.damage * falloff)),
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

export function applyTutorialTrainingConeDamage(input: TutorialTrainingConeDamageInput): number {
  const store = useGameStore.getState();
  if (!store.isTutorialMode || store.gamePhase !== 'playing' || input.range <= 0 || input.damage <= 0) return 0;

  const now = Date.now();
  const { sourceId, sourceTeam } = getTutorialSource(input);
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
    if (!isTutorialTrainingHero(target) || target.state !== 'alive') continue;
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

    const tickKey = `${sourceId ?? 'tutorial'}:${target.id}:${input.damageType}`;
    if (!shouldApplyDamageTick(tickKey, input.damageIntervalMs, now)) continue;

    const falloff = 1 - (hit.distance / input.range) * falloffScale;
    const result = applyTutorialTrainingDamage({
      target,
      damage: Math.max(1, Math.round(input.damage * falloff)),
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
      tutorialBurns.set(target.id, {
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
      extendTutorialTargetBurn(target.id, burnUntil, now);
    }
  }

  return appliedCount;
}

export function updateTutorialTrainingDamageOverTime(now = Date.now()): void {
  if (tutorialBurns.size === 0) return;

  for (const burn of Array.from(tutorialBurns.values())) {
    const store = useGameStore.getState();
    const target = store.players.get(burn.targetId);
    if (!isTutorialTrainingHero(target) || target.state !== 'alive' || burn.ticksRemaining <= 0) {
      tutorialBurns.delete(burn.targetId);
      continue;
    }

    while (burn.ticksRemaining > 0 && now >= burn.nextTickAt) {
      const currentTarget = useGameStore.getState().players.get(burn.targetId);
      if (!isTutorialTrainingHero(currentTarget) || currentTarget.state !== 'alive') {
        break;
      }

      const result = applyTutorialTrainingDamage({
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
      tutorialBurns.delete(burn.targetId);
    }
  }
}
