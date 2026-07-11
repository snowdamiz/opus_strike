import {
  BLAZE_SCRAPSHOT_RANGE,
  CHRONOS_TIMEBREAK_SHOCKWAVE_HALF_ANGLE,
  CHRONOS_TIMEBREAK_SHOCKWAVE_KNOCKBACK_FORCE,
  CHRONOS_TIMEBREAK_SHOCKWAVE_MAX_VERTICAL_DELTA,
  CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE,
  CHRONOS_TIMEBREAK_SHOCKWAVE_VERTICAL_FORCE,
  applyDamage as resolveSharedDamage,
  calculateFalloffDamage,
  calculateBlazeScrapshotPelletDamage,
  getAimConeHitAgainstPlayerCombatHitbox,
  getBlazeScrapshotPelletDirections,
  getSquaredDistanceToBlazeAfterburnerTrail,
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
import {
  DEATH_VISUAL_LIFETIME_MS,
  addDeathVisual,
  syncPlayerVisualEffectIndexes,
  visualStore,
} from '../store/visualStore';

export const TUTORIAL_OFFLINE_TRAINING_HERO_ID_PREFIX = 'tutorial_training_hero_';
export const DEV_OFFLINE_TRAINING_HERO_ID_PREFIX = 'dev_training_hero_';
export const TUTORIAL_OFFLINE_TRAINING_HERO_RESPAWN_MS = 1800;
export const PRACTICE_OFFLINE_TARGET_RESPAWN_MS = 3600;

interface TutorialOfflineTrainingDamageInput {
  target: Player | null | undefined;
  damage: number;
  damageType: string;
  hitPosition: Vec3;
  sourceId?: string | null;
  sourceTeam?: Team | null;
  abilityId?: string;
}

interface TutorialOfflineTrainingDamageResult {
  applied: boolean;
  killed: boolean;
  damage: number;
}

interface TutorialOfflineTrainingAreaDamageInput {
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

interface TutorialOfflineTrainingTrailDamageInput {
  points: readonly { position: Vec3 }[];
  radius: number;
  damage: number;
  damageType: string;
  damageIntervalMs: number;
  lastDamageTick: Map<string, number>;
  sourceId?: string | null;
  sourceTeam?: Team | null;
  abilityId?: string;
}

interface TutorialOfflineTrainingConeDamageInput {
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

interface TutorialOfflineTimebreakKnockbackInput {
  origin: Vec3;
  direction: Vec3;
  sourceId?: string | null;
  sourceTeam?: Team | null;
}

interface TutorialOfflineScrapshotInput {
  origin: Vec3;
  direction: Vec3;
  sourceId?: string | null;
  sourceTeam?: Team | null;
}

export interface TutorialOfflineScrapshotResult {
  appliedPellets: number;
  playerImpacts: Array<{
    pelletIndex: number;
    position: Vec3;
  }>;
}

interface TutorialOfflineBurn {
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

const tutorialOfflineDamageTicks = new Map<string, number>();
const tutorialOfflineBurns = new Map<string, TutorialOfflineBurn>();
const tutorialOfflineDamageHistory: DamageHistoryStore = new Map();

export function isTutorialOfflineTrainingHeroId(playerId: string | null | undefined): boolean {
  return Boolean(
    playerId?.startsWith(TUTORIAL_OFFLINE_TRAINING_HERO_ID_PREFIX) ||
      playerId?.startsWith(DEV_OFFLINE_TRAINING_HERO_ID_PREFIX)
  );
}

export function isTutorialOfflineTrainingHero(player: Player | null | undefined): player is Player {
  return Boolean(player && isTutorialOfflineTrainingHeroId(player.id));
}

function getTutorialOfflineSource(input: Pick<TutorialOfflineTrainingDamageInput, 'sourceId' | 'sourceTeam'>): {
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

function getDefaultDamageResult(): TutorialOfflineTrainingDamageResult {
  return { applied: false, killed: false, damage: 0 };
}

function getOfflineTrainingHeroRespawnMs(playerId: string): number {
  return playerId.startsWith(DEV_OFFLINE_TRAINING_HERO_ID_PREFIX)
    ? PRACTICE_OFFLINE_TARGET_RESPAWN_MS
    : TUTORIAL_OFFLINE_TRAINING_HERO_RESPAWN_MS;
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

function createTutorialOfflineDamageAdapter(getDraft: (playerId: string) => Player | null): DamageEngineAdapter<Player> {
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

    if (isTutorialOfflineTrainingHero(player)) {
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

function cloneVec3(source: Vec3): Vec3 {
  return { x: source.x, y: source.y, z: source.z };
}

function normalizeVec3(source: Vec3 | null | undefined): Vec3 | null {
  if (!source) return null;

  const length = Math.hypot(source.x, source.y, source.z);
  if (!Number.isFinite(length) || length <= 0.0001) return null;

  return {
    x: source.x / length,
    y: source.y / length,
    z: source.z / length,
  };
}

function normalizeHorizontalVec3(source: Vec3 | null | undefined): Vec3 | null {
  if (!source) return null;

  const length = Math.hypot(source.x, source.z);
  if (!Number.isFinite(length) || length <= 0.0001) return null;

  return {
    x: source.x / length,
    y: 0,
    z: source.z / length,
  };
}

function getOfflineTrainingDeathSourceDirection(
  targetPosition: Vec3,
  target: Player,
  source: Player | null
): Vec3 | null {
  if (source) {
    const visualSourcePosition = visualStore.getState().playerPositions.get(source.id) ?? source.position;
    const fromSource = normalizeVec3({
      x: targetPosition.x - visualSourcePosition.x,
      y: targetPosition.y - visualSourcePosition.y,
      z: targetPosition.z - visualSourcePosition.z,
    });
    if (fromSource) return fromSource;
  }

  return (
    normalizeVec3(target.velocity) ??
    normalizeVec3({
      x: Math.sin(target.lookYaw),
      y: 0,
      z: Math.cos(target.lookYaw),
    })
  );
}

function addOfflineTrainingDeathVisual(target: Player, source: Player | null, now: number): void {
  const store = useGameStore.getState();
  const localPlayerId = store.localPlayer?.id ?? store.playerId;
  const visualState = visualStore.getState();
  const position = cloneVec3(visualState.playerPositions.get(target.id) ?? target.position);
  const lookYaw = visualState.playerRotations.get(target.id) ?? target.lookYaw;
  const expiresAtMs = Number.isFinite(target.respawnTime)
    ? target.respawnTime!
    : now + DEATH_VISUAL_LIFETIME_MS;

  addDeathVisual({
    id: `death:${target.id}:${now}`,
    playerId: target.id,
    heroId: target.heroId,
    skinId: target.skinId,
    team: target.team,
    isBot: target.isBot,
    name: target.name,
    position,
    velocity: cloneVec3(target.velocity),
    lookYaw,
    lookPitch: target.lookPitch,
    movement: target.movement,
    killerId: source?.id ?? null,
    sourceDirection: getOfflineTrainingDeathSourceDirection(position, target, source),
    startedAtMs: now,
    expiresAtMs,
    local: target.id === localPlayerId,
  });
}

function clearTargetDamageRuntime(targetId: string): void {
  tutorialOfflineBurns.delete(targetId);
  tutorialOfflineDamageHistory.delete(targetId);
  for (const key of Array.from(tutorialOfflineDamageTicks.keys())) {
    if (key.includes(`:${targetId}:`)) {
      tutorialOfflineDamageTicks.delete(key);
    }
  }
}

function extendTutorialOfflineTargetBurn(targetId: string, burnUntil: number, now: number): void {
  const store = useGameStore.getState();
  const current = store.players.get(targetId);
  if (!isTutorialOfflineTrainingHero(current) || current.state !== 'alive') return;

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

export function applyTutorialOfflineTrainingDamage(input: TutorialOfflineTrainingDamageInput): TutorialOfflineTrainingDamageResult {
  if (!isTutorialOfflineTrainingHero(input.target)) return getDefaultDamageResult();

  const store = useGameStore.getState();
  if (!store.isPracticeMode || store.gamePhase !== 'playing') return getDefaultDamageResult();

  const current = store.players.get(input.target.id);
  if (!isTutorialOfflineTrainingHero(current) || current.state !== 'alive') return getDefaultDamageResult();

  const now = Date.now();
  const { sourceId, sourceTeam } = getTutorialOfflineSource(input);
  if (sourceTeam && current.team === sourceTeam) return getDefaultDamageResult();

  const { drafts, getDraft } = createDamageDrafts(store.players);
  const target = getDraft(current.id);
  const source = sourceId ? getDraft(sourceId) : null;
  if (!target) return getDefaultDamageResult();

  const result = resolveSharedDamage({
    adapter: createTutorialOfflineDamageAdapter(getDraft),
    damageHistory: tutorialOfflineDamageHistory,
    now,
    assistWindowMs: 10000,
    respawnDelayMs: getOfflineTrainingHeroRespawnMs(target.id),
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
    addOfflineTrainingDeathVisual(target, source, now);
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

export function applyTutorialOfflineTrainingAreaDamage(input: TutorialOfflineTrainingAreaDamageInput): number {
  const store = useGameStore.getState();
  if (!store.isPracticeMode || store.gamePhase !== 'playing' || input.radius <= 0 || input.damage <= 0) return 0;

  const now = Date.now();
  const { sourceId, sourceTeam } = getTutorialOfflineSource(input);
  const radiusSq = input.radius * input.radius;
  const falloffScale = input.falloffScale ?? 0.45;
  let appliedCount = 0;

  for (const target of store.players.values()) {
    if (!isTutorialOfflineTrainingHero(target) || target.state !== 'alive') continue;
    if (sourceTeam && target.team === sourceTeam) continue;

    const dx = target.position.x - input.center.x;
    const dy = target.position.y - input.center.y;
    const dz = target.position.z - input.center.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > radiusSq) continue;

    const tickKey = `${sourceId ?? 'offline'}:${target.id}:${input.damageType}`;
    if (!shouldApplyDamageTick(input.lastDamageTick ?? tutorialOfflineDamageTicks, tickKey, input.damageIntervalMs, now)) continue;

    const result = applyTutorialOfflineTrainingDamage({
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

export function applyTutorialOfflineTrainingTrailDamage(input: TutorialOfflineTrainingTrailDamageInput): number {
  const store = useGameStore.getState();
  if (
    !store.isPracticeMode ||
    store.gamePhase !== 'playing' ||
    input.points.length === 0 ||
    input.radius <= 0 ||
    input.damage <= 0
  ) {
    return 0;
  }

  const now = Date.now();
  const { sourceId, sourceTeam } = getTutorialOfflineSource(input);
  const radiusSq = input.radius * input.radius;
  let appliedCount = 0;

  for (const target of store.players.values()) {
    if (!isTutorialOfflineTrainingHero(target) || target.state !== 'alive') continue;
    if (sourceTeam && target.team === sourceTeam) continue;

    let isWithinTrail = input.points.length === 1
      ? getSquaredDistanceToBlazeAfterburnerTrail(
        target.position,
        input.points[0].position,
        input.points[0].position,
      ) <= radiusSq
      : false;
    for (let pointIndex = 1; !isWithinTrail && pointIndex < input.points.length; pointIndex++) {
      isWithinTrail = getSquaredDistanceToBlazeAfterburnerTrail(
        target.position,
        input.points[pointIndex - 1].position,
        input.points[pointIndex].position,
      ) <= radiusSq;
    }
    if (!isWithinTrail) continue;

    const tickKey = `${sourceId ?? 'offline'}:${target.id}:${input.damageType}`;
    if (!shouldApplyDamageTick(input.lastDamageTick, tickKey, input.damageIntervalMs, now)) continue;

    const result = applyTutorialOfflineTrainingDamage({
      target,
      damage: input.damage,
      damageType: input.damageType,
      hitPosition: target.position,
      sourceId,
      sourceTeam,
      abilityId: input.abilityId,
    });
    if (result.applied) appliedCount++;
  }

  return appliedCount;
}

export function applyTutorialOfflineTrainingConeDamage(input: TutorialOfflineTrainingConeDamageInput): number {
  const store = useGameStore.getState();
  if (!store.isPracticeMode || store.gamePhase !== 'playing' || input.range <= 0 || input.damage <= 0) return 0;

  const now = Date.now();
  const { sourceId, sourceTeam } = getTutorialOfflineSource(input);
  const directionLength = Math.hypot(input.direction.x, input.direction.y, input.direction.z);
  if (directionLength <= 0.0001) return 0;

  const direction = {
    x: input.direction.x / directionLength,
    y: input.direction.y / directionLength,
    z: input.direction.z / directionLength,
  };
  const falloffScale = input.falloffScale ?? 0.35;
  let appliedCount = 0;

  for (const target of store.players.values()) {
    if (!isTutorialOfflineTrainingHero(target) || target.state !== 'alive') continue;
    if (sourceTeam && target.team === sourceTeam) continue;

    const hit = getAimConeHitAgainstPlayerCombatHitbox(
      input.origin,
      direction,
      input.range,
      input.coneDot,
      { position: target.position, heroId: target.heroId },
      input.extraRadius
    );
    if (!hit) continue;

    const tickKey = `${sourceId ?? 'offline'}:${target.id}:${input.damageType}`;
    if (!shouldApplyDamageTick(tutorialOfflineDamageTicks, tickKey, input.damageIntervalMs, now)) continue;

    const result = applyTutorialOfflineTrainingDamage({
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
      tutorialOfflineBurns.set(target.id, {
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
      extendTutorialOfflineTargetBurn(target.id, burnUntil, now);
    }
  }

  return appliedCount;
}

export function applyTutorialOfflineTrainingScrapshot(
  input: TutorialOfflineScrapshotInput,
): TutorialOfflineScrapshotResult {
  const store = useGameStore.getState();
  if (!store.isPracticeMode || store.gamePhase !== 'playing') {
    return { appliedPellets: 0, playerImpacts: [] };
  }

  const { sourceId, sourceTeam } = getTutorialOfflineSource(input);
  let appliedPellets = 0;
  const playerImpacts: TutorialOfflineScrapshotResult['playerImpacts'] = [];

  const pelletDirections = getBlazeScrapshotPelletDirections(input.direction);
  for (let pelletIndex = 0; pelletIndex < pelletDirections.length; pelletIndex++) {
    const direction = pelletDirections[pelletIndex];
    let closestTarget: Player | null = null;
    let closestHit: ReturnType<typeof getSegmentHitAgainstPlayerCombatHitbox> = null;

    for (const target of useGameStore.getState().players.values()) {
      if (!isTutorialOfflineTrainingHero(target) || target.state !== 'alive') continue;
      if (sourceTeam && target.team === sourceTeam) continue;

      const hit = getSegmentHitAgainstPlayerCombatHitbox(
        input.origin,
        direction,
        BLAZE_SCRAPSHOT_RANGE,
        { position: target.position, heroId: target.heroId }
      );
      if (!hit || (closestHit && hit.distance >= closestHit.distance)) continue;
      closestTarget = target;
      closestHit = hit;
    }

    if (!closestTarget || !closestHit) continue;
    const result = applyTutorialOfflineTrainingDamage({
      target: closestTarget,
      damage: calculateBlazeScrapshotPelletDamage(closestHit.distance),
      damageType: 'scrapshot',
      hitPosition: closestHit.targetPoint,
      sourceId,
      sourceTeam,
      abilityId: 'blaze_scrapshot',
    });
    if (result.applied) {
      appliedPellets++;
      playerImpacts.push({
        pelletIndex,
        position: { ...closestHit.targetPoint },
      });
    }
  }

  return { appliedPellets, playerImpacts };
}

export function applyTutorialOfflineTrainingTimebreakKnockback(input: TutorialOfflineTimebreakKnockbackInput): number {
  const store = useGameStore.getState();
  if (!store.isPracticeMode || store.gamePhase !== 'playing') return 0;

  const forward = normalizeHorizontalVec3(input.direction);
  if (!forward) return 0;

  const { sourceId, sourceTeam } = getTutorialOfflineSource(input);
  const minForwardDot = Math.cos(CHRONOS_TIMEBREAK_SHOCKWAVE_HALF_ANGLE);
  let appliedCount = 0;

  for (const target of store.players.values()) {
    if (!isTutorialOfflineTrainingHero(target) || target.state !== 'alive') continue;
    if (sourceId && target.id === sourceId) continue;
    if (sourceTeam && target.team === sourceTeam) continue;

    const dx = target.position.x - input.origin.x;
    const dy = target.position.y - input.origin.y;
    const dz = target.position.z - input.origin.z;
    if (Math.abs(dy) > CHRONOS_TIMEBREAK_SHOCKWAVE_MAX_VERTICAL_DELTA) continue;

    const horizontalDistance = Math.hypot(dx, dz);
    if (horizontalDistance > CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE) continue;

    const away = horizontalDistance > 0.001
      ? { x: dx / horizontalDistance, z: dz / horizontalDistance }
      : { x: forward.x, z: forward.z };
    const forwardDot = away.x * forward.x + away.z * forward.z;
    if (forwardDot < minForwardDot) continue;

    const falloff = 1 - horizontalDistance / CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE * 0.35;
    const knockbackSpeed = CHRONOS_TIMEBREAK_SHOCKWAVE_KNOCKBACK_FORCE * falloff;
    const verticalSpeed = CHRONOS_TIMEBREAK_SHOCKWAVE_VERTICAL_FORCE * falloff;
    const currentAwaySpeed = target.velocity.x * away.x + target.velocity.z * away.z;
    const horizontalBoost = Math.max(0, knockbackSpeed - currentAwaySpeed);
    const impulse = {
      x: away.x * horizontalBoost,
      y: Math.max(0, verticalSpeed - target.velocity.y),
      z: away.z * horizontalBoost,
    };
    if (impulse.x === 0 && impulse.y === 0 && impulse.z === 0) continue;

    const nextPlayer = {
      ...target,
      velocity: {
        x: target.velocity.x + impulse.x,
        y: target.velocity.y + impulse.y,
        z: target.velocity.z + impulse.z,
      },
      movement: {
        ...target.movement,
        isGrounded: false,
        isSliding: false,
        slideTimeRemaining: 0,
      },
    };
    store.updatePlayer(target.id, nextPlayer);
    appliedCount++;
  }

  return appliedCount;
}

export function updateTutorialOfflineTrainingDamageOverTime(now = Date.now()): void {
  if (tutorialOfflineBurns.size === 0) return;

  for (const burn of Array.from(tutorialOfflineBurns.values())) {
    const store = useGameStore.getState();
    const target = store.players.get(burn.targetId);
    if (!isTutorialOfflineTrainingHero(target) || target.state !== 'alive' || burn.ticksRemaining <= 0) {
      tutorialOfflineBurns.delete(burn.targetId);
      continue;
    }

    while (burn.ticksRemaining > 0 && now >= burn.nextTickAt) {
      const currentTarget = useGameStore.getState().players.get(burn.targetId);
      if (!isTutorialOfflineTrainingHero(currentTarget) || currentTarget.state !== 'alive') {
        break;
      }

      const result = applyTutorialOfflineTrainingDamage({
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
      tutorialOfflineBurns.delete(burn.targetId);
    }
  }
}
