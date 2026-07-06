import type {
  PlayerVitalsAbilitySnapshot,
  PlayerVitalsSnapshot,
  PlayerVisibilityState,
} from '@voxel-strike/shared';

export interface PlayerVitalsMovementSource {
  isGrounded: boolean;
  isSprinting: boolean;
  isCrouching: boolean;
  isSliding: boolean;
  slideTimeRemaining: number;
  isWallRunning: boolean;
  wallRunSide?: string | null;
  isGrappling: boolean;
  isJetpacking: boolean;
  jetpackFuel: number;
  isGliding: boolean;
  chronosAscendantStartY?: number | null;
}

export interface PlayerVitalsStatsSource {
  kills: number;
  deaths: number;
  assists: number;
  flagCaptures: number;
  flagReturns: number;
}

export interface PlayerVitalsAbilitySource {
  abilityId: string;
  cooldownRemaining: number;
  charges: number;
  isActive: boolean;
  activatedAt?: number;
}

export interface PlayerVitalsAbilityCollection {
  forEach(callback: (ability: PlayerVitalsAbilitySource, abilityId: string) => void): void;
}

export interface FullPlayerVitalsSnapshotInput {
  id: string;
  netId: number;
  name: string;
  role?: PlayerVitalsSnapshot['role'];
  team: PlayerVitalsSnapshot['team'];
  heroId: PlayerVitalsSnapshot['heroId'];
  skinId?: PlayerVitalsSnapshot['skinId'];
  state: PlayerVitalsSnapshot['state'];
  isReady: boolean;
  isBot: boolean;
  botDifficulty?: PlayerVitalsSnapshot['botDifficulty'];
  botProfileId?: string;
  rank?: PlayerVitalsSnapshot['rank'];
  health: number;
  maxHealth: number;
  shield?: number;
  maxShield?: number;
  downedHealth?: number | null;
  downedMaxHealth?: number | null;
  downedStartedAt?: number | null;
  downedRemainingMs?: number | null;
  downedExpiresAt?: number | null;
  reviveStartedAt?: number | null;
  reviveCompletesAt?: number | null;
  reviveByPlayerId?: string | null;
  knockdownShieldHealth?: number | null;
  knockdownShieldMaxHealth?: number | null;
  knockdownShieldActive?: boolean;
  ultimateCharge: number;
  onFireUntil?: number | null;
  powerupBoostUntil?: number | null;
  hasFlag: boolean;
  movement: PlayerVitalsMovementSource;
  abilities: PlayerVitalsAbilityCollection;
  stats: PlayerVitalsStatsSource;
  respawnTime?: number | null;
  spawnProtectionUntil?: number | null;
  visibility: PlayerVisibilityState;
  now: number;
}

export interface PlayerVitalsSnapshotCaches {
  fullVitalsByPlayer: Map<string, PlayerVitalsSnapshot>;
  visibleEnemyVitalsByPlayer: Map<string, PlayerVitalsSnapshot>;
  publicEnemyVitalsByPlayer: Map<string, PlayerVitalsSnapshot>;
}

export interface PlayerVitalsReplicationStateLike {
  signatures: Map<string, PlayerVitalsSnapshot>;
  reconcileAt: Map<string, number>;
  knownPlayerIds: Set<string>;
}

export interface RecipientPlayerVitalsInput {
  targetId: string;
  targetTeam: string;
  recipientId?: string | null;
  recipientTeam?: string | null;
  visibility: PlayerVisibilityState;
  caches?: PlayerVitalsSnapshotCaches | null;
  buildFull: () => PlayerVitalsSnapshot;
  buildVisible: (visibility: PlayerVisibilityState) => PlayerVitalsSnapshot;
  buildPublic: (visibility: PlayerVisibilityState) => PlayerVitalsSnapshot;
}

export function getPlayerVitalsCooldownUntil(
  ability: Pick<PlayerVitalsAbilitySource, 'cooldownRemaining'>,
  now: number
): number {
  if (ability.cooldownRemaining <= 0) return 0;
  return Math.round((now + ability.cooldownRemaining * 1000) / 100) * 100;
}

export function buildPlayerVitalsAbilities(
  abilities: PlayerVitalsAbilityCollection,
  now: number
): Record<string, PlayerVitalsAbilitySnapshot> {
  const snapshots: Record<string, PlayerVitalsAbilitySnapshot> = {};
  abilities.forEach((ability, abilityId) => {
    snapshots[abilityId] = {
      abilityId: ability.abilityId,
      cooldownUntil: getPlayerVitalsCooldownUntil(ability, now),
      charges: ability.charges,
      isActive: ability.isActive,
      activatedAt: ability.activatedAt,
    };
  });
  return snapshots;
}

export function getDefaultPublicMovementVitals(): PlayerVitalsSnapshot['movement'] {
  return {
    isGrounded: true,
    isSprinting: false,
    isCrouching: false,
    isSliding: false,
    slideTimeRemaining: 0,
    isWallRunning: false,
    wallRunSide: null,
    isGrappling: false,
    grapplePoint: null,
    isJetpacking: false,
    jetpackFuel: 0,
    isGliding: false,
  };
}

export function buildPlayerMovementVitals(
  movement: PlayerVitalsMovementSource
): PlayerVitalsSnapshot['movement'] {
  return {
    isGrounded: movement.isGrounded,
    isSprinting: movement.isSprinting,
    isCrouching: movement.isCrouching,
    isSliding: movement.isSliding,
    slideTimeRemaining: movement.slideTimeRemaining,
    isWallRunning: movement.isWallRunning,
    wallRunSide: movement.wallRunSide === 'left' || movement.wallRunSide === 'right'
      ? movement.wallRunSide
      : null,
    isGrappling: movement.isGrappling,
    grapplePoint: null,
    isJetpacking: movement.isJetpacking,
    jetpackFuel: movement.jetpackFuel,
    isGliding: movement.isGliding,
    chronosAscendantStartY: movement.chronosAscendantStartY || undefined,
  };
}

export function buildPlayerVitalsStats(
  stats: PlayerVitalsStatsSource
): PlayerVitalsSnapshot['stats'] {
  return {
    kills: stats.kills,
    deaths: stats.deaths,
    assists: stats.assists,
    flagCaptures: stats.flagCaptures,
    flagReturns: stats.flagReturns,
  };
}

export function buildFullPlayerVitalsSnapshot(
  input: FullPlayerVitalsSnapshotInput
): PlayerVitalsSnapshot {
  return {
    id: input.id,
    netId: input.netId,
    name: input.name,
    ...(input.role ? { role: input.role } : {}),
    team: input.team,
    heroId: input.heroId,
    skinId: input.skinId,
    state: input.state,
    isReady: input.isReady,
    isBot: input.isBot,
    botDifficulty: input.botDifficulty,
    botProfileId: input.botProfileId,
    rank: input.rank,
    health: input.health,
    maxHealth: input.maxHealth,
    shield: input.shield ?? 0,
    maxShield: input.maxShield ?? 0,
    downedHealth: input.downedHealth ?? null,
    downedMaxHealth: input.downedMaxHealth ?? null,
    downedStartedAt: input.downedStartedAt ?? null,
    downedRemainingMs: input.downedRemainingMs ?? null,
    downedExpiresAt: input.downedExpiresAt ?? null,
    reviveStartedAt: input.reviveStartedAt ?? null,
    reviveCompletesAt: input.reviveCompletesAt ?? null,
    reviveByPlayerId: input.reviveByPlayerId ?? null,
    knockdownShieldHealth: input.knockdownShieldHealth ?? null,
    knockdownShieldMaxHealth: input.knockdownShieldMaxHealth ?? null,
    knockdownShieldActive: input.knockdownShieldActive ?? false,
    ultimateCharge: input.ultimateCharge,
    onFireUntil: input.onFireUntil ?? null,
    powerupBoostUntil: input.powerupBoostUntil ?? null,
    hasFlag: input.hasFlag,
    movement: buildPlayerMovementVitals(input.movement),
    abilities: buildPlayerVitalsAbilities(input.abilities, input.now),
    stats: buildPlayerVitalsStats(input.stats),
    respawnTime: input.respawnTime || null,
    spawnProtectionUntil: input.spawnProtectionUntil || null,
    visibility: input.visibility,
  };
}

export function buildVisibleEnemyVitalsSnapshot(
  full: PlayerVitalsSnapshot,
  visibility: PlayerVisibilityState
): PlayerVitalsSnapshot {
  const activeAbilities: Record<string, PlayerVitalsAbilitySnapshot> = {};
  for (const [abilityId, ability] of Object.entries(full.abilities)) {
    if (!ability.isActive) continue;
    activeAbilities[abilityId] = {
      abilityId: ability.abilityId,
      cooldownUntil: 0,
      charges: 0,
      isActive: true,
      activatedAt: ability.activatedAt,
    };
  }

  return {
    ...full,
    downedStartedAt: null,
    downedRemainingMs: null,
    downedExpiresAt: null,
    reviveStartedAt: null,
    reviveCompletesAt: null,
    reviveByPlayerId: null,
    ultimateCharge: 0,
    abilities: activeAbilities,
    respawnTime: null,
    spawnProtectionUntil: null,
    visibility,
  };
}

export function getPublicEnemyVitalsState(
  state: PlayerVitalsSnapshot['state']
): PlayerVitalsSnapshot['state'] {
  if (state === 'dead') return 'dead';
  if (state === 'downed') return 'downed';
  return 'alive';
}

export function buildPublicEnemyVitalsSnapshot(input: {
  id: string;
  netId: number;
  name: string;
  role?: PlayerVitalsSnapshot['role'];
  team: PlayerVitalsSnapshot['team'];
  heroId: PlayerVitalsSnapshot['heroId'];
  skinId?: PlayerVitalsSnapshot['skinId'];
  state: PlayerVitalsSnapshot['state'];
  isReady: boolean;
  isBot: boolean;
  botDifficulty?: PlayerVitalsSnapshot['botDifficulty'];
  botProfileId?: string;
  rank?: PlayerVitalsSnapshot['rank'];
  maxHealth: number;
  stats: PlayerVitalsSnapshot['stats'];
  visibility: PlayerVisibilityState;
}): PlayerVitalsSnapshot {
  return {
    id: input.id,
    netId: input.netId,
    name: input.name,
    ...(input.role ? { role: input.role } : {}),
    team: input.team,
    heroId: input.heroId,
    skinId: input.skinId,
    state: getPublicEnemyVitalsState(input.state),
    isReady: input.isReady,
    isBot: input.isBot,
    botDifficulty: input.botDifficulty,
    botProfileId: input.botProfileId,
    rank: input.rank,
    health: input.maxHealth,
    maxHealth: input.maxHealth,
    shield: 0,
    maxShield: 0,
    downedHealth: null,
    downedMaxHealth: null,
    downedStartedAt: null,
    downedRemainingMs: null,
    downedExpiresAt: null,
    reviveStartedAt: null,
    reviveCompletesAt: null,
    reviveByPlayerId: null,
    knockdownShieldHealth: null,
    knockdownShieldMaxHealth: null,
    knockdownShieldActive: false,
    ultimateCharge: 0,
    onFireUntil: null,
    powerupBoostUntil: null,
    hasFlag: false,
    movement: getDefaultPublicMovementVitals(),
    abilities: {},
    stats: input.stats,
    respawnTime: null,
    spawnProtectionUntil: null,
    visibility: input.visibility,
  };
}

export function selectPlayerVitalsForRecipient(input: RecipientPlayerVitalsInput): PlayerVitalsSnapshot {
  if (
    !input.recipientId ||
    input.recipientId === input.targetId ||
    input.recipientTeam === input.targetTeam
  ) {
    const cached = input.caches?.fullVitalsByPlayer.get(input.targetId);
    if (cached) return cached;
    const vitals = input.buildFull();
    input.caches?.fullVitalsByPlayer.set(input.targetId, vitals);
    return vitals;
  }

  if (input.visibility === 'visible') {
    const cached = input.caches?.visibleEnemyVitalsByPlayer.get(input.targetId);
    if (cached) return cached;
    const vitals = input.buildVisible(input.visibility);
    input.caches?.visibleEnemyVitalsByPlayer.set(input.targetId, vitals);
    return vitals;
  }

  const publicCacheKey = `${input.targetId}:${input.visibility}`;
  const cached = input.caches?.publicEnemyVitalsByPlayer.get(publicCacheKey);
  if (cached) return cached;
  const vitals = input.buildPublic(input.visibility);
  input.caches?.publicEnemyVitalsByPlayer.set(publicCacheKey, vitals);
  return vitals;
}

export function selectChangedPlayerVitalsSnapshot(input: {
  state: PlayerVitalsReplicationStateLike;
  playerId: string;
  vitals: PlayerVitalsSnapshot;
  now: number;
  force: boolean;
  reconcileIntervalMs: number;
}): PlayerVitalsSnapshot | null {
  input.state.knownPlayerIds.add(input.playerId);
  const reconcileDue = input.now - (input.state.reconcileAt.get(input.playerId) ?? 0) >= input.reconcileIntervalMs;
  if (
    !input.force
    && !reconcileDue
    && !haveVitalsChanged(input.state.signatures.get(input.playerId), input.vitals)
  ) {
    return null;
  }

  input.state.signatures.set(input.playerId, input.vitals);
  input.state.reconcileAt.set(input.playerId, input.now);
  return input.vitals;
}

export function removeMissingKnownPlayerVitals(
  state: PlayerVitalsReplicationStateLike,
  currentPlayerIds: ReadonlySet<string>
): string[] {
  const removedPlayerIds: string[] = [];
  pruneMissingKnownPlayerVitals(state, currentPlayerIds, removedPlayerIds);
  return removedPlayerIds;
}

export function pruneMissingKnownPlayerVitals(
  state: PlayerVitalsReplicationStateLike,
  currentPlayerIds: ReadonlySet<string>,
  removedPlayerIds?: string[]
): string[] | null {
  let removed = removedPlayerIds ?? null;
  for (const playerId of state.knownPlayerIds) {
    if (currentPlayerIds.has(playerId)) continue;
    if (!removed) removed = [];
    removed.push(playerId);
    state.knownPlayerIds.delete(playerId);
    state.signatures.delete(playerId);
    state.reconcileAt.delete(playerId);
  }
  return removed;
}

function haveMovementVitalsChanged(
  previous: PlayerVitalsSnapshot['movement'],
  next: PlayerVitalsSnapshot['movement']
): boolean {
  return (
    previous.isGrounded !== next.isGrounded ||
    previous.isSprinting !== next.isSprinting ||
    previous.isCrouching !== next.isCrouching ||
    previous.isSliding !== next.isSliding ||
    previous.slideTimeRemaining !== next.slideTimeRemaining ||
    previous.isWallRunning !== next.isWallRunning ||
    previous.wallRunSide !== next.wallRunSide ||
    previous.isGrappling !== next.isGrappling ||
    previous.isJetpacking !== next.isJetpacking ||
    previous.jetpackFuel !== next.jetpackFuel ||
    previous.isGliding !== next.isGliding
  );
}

function haveAbilityVitalsChanged(
  previous: PlayerVitalsSnapshot['abilities'],
  next: PlayerVitalsSnapshot['abilities']
): boolean {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length !== nextKeys.length) return true;

  for (const abilityId of nextKeys) {
    const previousAbility = previous[abilityId];
    const nextAbility = next[abilityId];
    if (!previousAbility || !nextAbility) return true;
    if (
      previousAbility.abilityId !== nextAbility.abilityId ||
      previousAbility.cooldownUntil !== nextAbility.cooldownUntil ||
      previousAbility.charges !== nextAbility.charges ||
      previousAbility.isActive !== nextAbility.isActive ||
      previousAbility.activatedAt !== nextAbility.activatedAt
    ) {
      return true;
    }
  }

  return false;
}

function haveStatVitalsChanged(
  previous: PlayerVitalsSnapshot['stats'],
  next: PlayerVitalsSnapshot['stats']
): boolean {
  return (
    previous.kills !== next.kills ||
    previous.deaths !== next.deaths ||
    previous.assists !== next.assists ||
    previous.flagCaptures !== next.flagCaptures ||
    previous.flagReturns !== next.flagReturns
  );
}

export function haveVitalsChanged(
  previous: PlayerVitalsSnapshot | undefined,
  next: PlayerVitalsSnapshot
): boolean {
  if (!previous) return true;

  return (
    previous.name !== next.name ||
    previous.netId !== next.netId ||
    previous.role !== next.role ||
    previous.team !== next.team ||
    previous.heroId !== next.heroId ||
    previous.skinId !== next.skinId ||
    previous.state !== next.state ||
    previous.isReady !== next.isReady ||
    previous.isBot !== next.isBot ||
    previous.botDifficulty !== next.botDifficulty ||
    previous.botProfileId !== next.botProfileId ||
    previous.visibility !== next.visibility ||
    previous.health !== next.health ||
    previous.maxHealth !== next.maxHealth ||
    Math.round(previous.shield ?? 0) !== Math.round(next.shield ?? 0) ||
    previous.maxShield !== next.maxShield ||
    previous.downedHealth !== next.downedHealth ||
    previous.downedMaxHealth !== next.downedMaxHealth ||
    previous.downedStartedAt !== next.downedStartedAt ||
    previous.downedRemainingMs !== next.downedRemainingMs ||
    previous.downedExpiresAt !== next.downedExpiresAt ||
    previous.reviveStartedAt !== next.reviveStartedAt ||
    previous.reviveCompletesAt !== next.reviveCompletesAt ||
    previous.reviveByPlayerId !== next.reviveByPlayerId ||
    previous.knockdownShieldHealth !== next.knockdownShieldHealth ||
    previous.knockdownShieldMaxHealth !== next.knockdownShieldMaxHealth ||
    previous.knockdownShieldActive !== next.knockdownShieldActive ||
    Math.round(previous.ultimateCharge) !== Math.round(next.ultimateCharge) ||
    previous.onFireUntil !== next.onFireUntil ||
    previous.powerupBoostUntil !== next.powerupBoostUntil ||
    previous.hasFlag !== next.hasFlag ||
    (next.state !== 'alive' && haveMovementVitalsChanged(previous.movement, next.movement)) ||
    haveAbilityVitalsChanged(previous.abilities, next.abilities) ||
    haveStatVitalsChanged(previous.stats, next.stats) ||
    previous.respawnTime !== next.respawnTime ||
    previous.spawnProtectionUntil !== next.spawnProtectionUntil
  );
}
