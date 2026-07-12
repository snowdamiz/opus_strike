import {
  canReceiveLiveTransform,
  getPlayerEyePosition as getSharedPlayerEyePosition,
  getPlayerLineOfSightSamplePoints as getSharedPlayerLineOfSightSamplePoints,
  type PlayerInterestSnapshot,
  type PlayerInterestMessage,
  type PackedPlayerTransform,
  type PlayerTransformsV2Message,
  type PlayerVitalsMessage,
  type PlayerVitalsSnapshot,
  type Vec3,
} from '@voxel-strike/shared';
import type { Player } from './schema/Player';
import type {
  PlayerVitalsReplicationState,
  TransformReplicationState,
} from './playerReplicationState';
import {
  getPackedTransformSignature,
  selectPackedTransformDelta,
} from './playerTransformPacking';
import {
  buildPlayerInterestSnapshot,
  pruneMissingPlayerInterestSignatures,
  selectChangedPlayerInterestSnapshot,
} from './playerInterestSnapshot';
import {
  pruneMissingKnownPlayerVitals,
  selectChangedPlayerVitalsSnapshot,
} from './playerVitals';
import {
  VisibilityInterestManager,
  type RecipientInterestDecision,
  type VisibilityInterestContext,
  type VisibilityInterestPlayer,
} from './visibilityInterest';

export interface ReplicationFrameContext {
  now: number;
  currentIds: Set<string>;
  visibilityContext: VisibilityInterestContext;
  visibilityPlayers: Map<string, VisibilityInterestPlayer>;
  packedTransforms: Map<string, PackedPlayerTransform>;
  packedTransformSignatures: Map<string, PackedPlayerTransform>;
  fullRateTransformPlayerIds: Set<string>;
  recipientInterests: Map<string, Map<string, RecipientInterestDecision>>;
  fullVitalsByPlayer: Map<string, PlayerVitalsSnapshot>;
  visibleEnemyVitalsByPlayer: Map<string, PlayerVitalsSnapshot>;
  publicEnemyVitalsByPlayer: Map<string, PlayerVitalsSnapshot>;
}

export interface ReplicationFramePlayerCollection {
  forEach(callback: (player: Player, id: string) => void): void;
}

export interface ReplicationFrameRuntimeOptions {
  visibilityInterest: VisibilityInterestManager;
  getMovementCollisionRevision: (now: number) => number;
  hasLineOfSight: (from: Vec3, to: Vec3) => boolean;
  getLineOfSightPoints?: (player: VisibilityInterestPlayer) => readonly Vec3[];
  getRecentCombatRevealUntil: (recipientId: string, targetId: string) => number;
  buildPackedTransform: (id: string, player: Player) => PackedPlayerTransform;
  isFullRateTransform?: (id: string, player: Player, now: number) => boolean;
}

function canReplicateLiveTransform(player: Player): boolean {
  return canReceiveLiveTransform(player) || player.state === 'dropping';
}

export interface PlayerStateStreamBroadcastPlanInput {
  transforms: boolean;
  vitals: boolean;
  forceVitals: boolean;
  now: number;
  lastVitalsBroadcastAt: number;
  lastInterestBroadcastAt: number;
  vitalsIntervalMs: number;
  interestIntervalMs: number;
  vitalsPhaseAtMs?: number;
  interestPhaseAtMs?: number;
}

export interface PlayerStateStreamBroadcastPlan {
  shouldBroadcastVitals: boolean;
  shouldBroadcastInterest: boolean;
  shouldBroadcastTransforms: boolean;
}

export interface RecipientPlayerStateStreamCollectionInput {
  players: ReplicationFramePlayerCollection;
  recipient: Player | null;
  recipientId: string;
  frameContext: ReplicationFrameContext;
  vitalsState: PlayerVitalsReplicationState | null;
  interestSignatures: Map<string, string> | null;
  transformState: TransformReplicationState | null;
  globallyRemovedPlayerIds: readonly string[];
  forceVitals: boolean;
  forceTransforms: boolean;
  vitalsReconcileIntervalMs: number;
  buildPlayerVitalsForRecipient: (
    playerId: string,
    player: Player,
    recipient: Player | null,
    now: number,
    interest: RecipientInterestDecision | undefined,
    frameContext: ReplicationFrameContext
  ) => PlayerVitalsSnapshot;
  getRecipientInterest: (
    recipient: Player,
    target: Player,
    now: number,
    frameContext: ReplicationFrameContext
  ) => RecipientInterestDecision;
  shouldSendExactEnemyState: (
    recipient: Player | null,
    playerId: string,
    player: Player,
    now: number,
    interest: RecipientInterestDecision | undefined
  ) => boolean;
  isHighRelevanceTransform: (
    recipient: Player | null,
    playerId: string,
    player: Player,
    now: number
  ) => boolean;
  buildPackedTransform: (playerId: string, player: Player) => PackedPlayerTransform;
}

export interface RecipientPlayerStateStreamCollection {
  vitalsPlayers: PlayerVitalsSnapshot[];
  removedPlayerIds: string[];
  interestPlayers: PlayerInterestSnapshot[];
  transformPlayers: PackedPlayerTransform[];
  hiddenPlayerIds: string[];
}

const EMPTY_VITALS_PLAYERS: PlayerVitalsSnapshot[] = [];
const EMPTY_REMOVED_PLAYER_IDS: string[] = [];
const EMPTY_INTEREST_PLAYERS: PlayerInterestSnapshot[] = [];
const EMPTY_TRANSFORM_PLAYERS: PackedPlayerTransform[] = [];
const EMPTY_HIDDEN_PLAYER_IDS: string[] = [];

export interface PlayerVitalsStreamMessageInput {
  tick: number;
  serverTime: number;
  players: PlayerVitalsSnapshot[];
  removedPlayerIds: string[];
  force: boolean;
}

export interface PlayerInterestStreamMessageInput {
  tick: number;
  serverTime: number;
  players: PlayerInterestSnapshot[];
  force: boolean;
}

export interface PlayerTransformsStreamMessageInput {
  tick: number;
  serverTime: number;
  streamEpoch: number;
  full: boolean;
  players: PackedPlayerTransform[];
  hiddenPlayerIds: string[];
}

export class ReplicationFrameRuntime {
  private readonly frameVisibilityContext: VisibilityInterestContext;
  private readonly standaloneVisibilityContext: VisibilityInterestContext;
  private readonly frameContext: ReplicationFrameContext;
  private readonly frameLineOfSightPoints = new Map<string, readonly Vec3[]>();

  constructor(private readonly options: ReplicationFrameRuntimeOptions) {
    this.frameVisibilityContext = this.createVisibilityContext((player) => {
      let points = this.frameLineOfSightPoints.get(player.id);
      if (!points) {
        points = this.getLineOfSightPoints(player);
        this.frameLineOfSightPoints.set(player.id, points);
      }
      return points;
    });
    this.standaloneVisibilityContext = this.createVisibilityContext();
    this.frameContext = {
      now: 0,
      currentIds: new Set(),
      visibilityContext: this.frameVisibilityContext,
      visibilityPlayers: new Map(),
      packedTransforms: new Map(),
      packedTransformSignatures: new Map(),
      fullRateTransformPlayerIds: new Set(),
      recipientInterests: new Map(),
      fullVitalsByPlayer: new Map(),
      visibleEnemyVitalsByPlayer: new Map(),
      publicEnemyVitalsByPlayer: new Map(),
    };
  }

  buildFrameContext(players: ReplicationFramePlayerCollection, now: number): ReplicationFrameContext {
    const collisionRevision = this.options.getMovementCollisionRevision(now);
    const frameContext = this.frameContext;
    frameContext.now = now;
    this.frameLineOfSightPoints.clear();
    this.prepareVisibilityContext(frameContext.visibilityContext, now, collisionRevision);
    frameContext.currentIds.clear();
    frameContext.visibilityPlayers.clear();
    frameContext.packedTransforms.clear();
    frameContext.packedTransformSignatures.clear();
    frameContext.fullRateTransformPlayerIds.clear();
    frameContext.fullVitalsByPlayer.clear();
    frameContext.visibleEnemyVitalsByPlayer.clear();
    frameContext.publicEnemyVitalsByPlayer.clear();
    for (const targetInterests of frameContext.recipientInterests.values()) {
      targetInterests.clear();
    }

    players.forEach((player, id) => {
      frameContext.currentIds.add(id);
      frameContext.visibilityPlayers.set(id, createVisibilityInterestPlayer(player));
      if (!canReplicateLiveTransform(player)) return;

      const transform = this.options.buildPackedTransform(id, player);
      frameContext.packedTransforms.set(id, transform);
      frameContext.packedTransformSignatures.set(id, getPackedTransformSignature(transform));
      if (this.options.isFullRateTransform?.(id, player, now)) {
        frameContext.fullRateTransformPlayerIds.add(id);
      }
    });

    for (const recipientId of frameContext.recipientInterests.keys()) {
      if (!frameContext.currentIds.has(recipientId)) {
        frameContext.recipientInterests.delete(recipientId);
      }
    }

    return frameContext;
  }

  getRecipientInterest(
    recipient: Player | null,
    target: Player,
    now: number,
    frameContext?: ReplicationFrameContext
  ): RecipientInterestDecision {
    if (recipient && frameContext) {
      let targetInterests = frameContext.recipientInterests.get(recipient.id);
      if (!targetInterests) {
        targetInterests = new Map<string, RecipientInterestDecision>();
        frameContext.recipientInterests.set(recipient.id, targetInterests);
      } else {
        const cached = targetInterests.get(target.id);
        if (cached) return cached;
      }

      const decision = this.computeRecipientInterest(recipient, target, now, frameContext);
      targetInterests.set(target.id, decision);
      return decision;
    }

    return this.computeRecipientInterest(recipient, target, now, frameContext);
  }

  private computeRecipientInterest(
    recipient: Player | null,
    target: Player,
    now: number,
    frameContext?: ReplicationFrameContext
  ): RecipientInterestDecision {
    const recipientInterestPlayer = recipient
      ? frameContext?.visibilityPlayers.get(recipient.id) ?? createVisibilityInterestPlayer(recipient)
      : null;
    const targetInterestPlayer = frameContext?.visibilityPlayers.get(target.id) ?? createVisibilityInterestPlayer(target);
    const visibilityContext = frameContext?.visibilityContext
      ?? this.prepareVisibilityContext(
        this.standaloneVisibilityContext,
        now,
        this.options.getMovementCollisionRevision(now)
      );

    return this.options.visibilityInterest.getRecipientInterest(
      recipientInterestPlayer,
      targetInterestPlayer,
      visibilityContext
    );
  }

  private getLineOfSightPoints(player: VisibilityInterestPlayer): readonly Vec3[] {
    return this.options.getLineOfSightPoints?.(player) ?? getSharedPlayerLineOfSightSamplePoints(player);
  }

  private createVisibilityContext(
    getLineOfSightPoints: (player: VisibilityInterestPlayer) => readonly Vec3[] = (player) => (
      this.getLineOfSightPoints(player)
    )
  ): VisibilityInterestContext {
    return {
      now: 0,
      collisionRevision: 0,
      getEyePosition: (player) => getSharedPlayerEyePosition(player.position),
      getLineOfSightPoints,
      hasLineOfSight: (from, to) => this.options.hasLineOfSight(from, to),
      getRecentCombatRevealUntil: (recipient, target) => (
        this.options.getRecentCombatRevealUntil(recipient.id, target.id)
      ),
    };
  }

  private prepareVisibilityContext(
    context: VisibilityInterestContext,
    now: number,
    collisionRevision: number
  ): VisibilityInterestContext {
    context.now = now;
    context.collisionRevision = collisionRevision;
    return context;
  }
}

export function createVisibilityInterestPlayer(player: Player): VisibilityInterestPlayer {
  return {
    id: player.id,
    team: player.team,
    state: player.state,
    position: player.position,
    heroId: player.heroId,
    abilities: player.abilities.values(),
  };
}

export function collectRecipientPlayerStateStreams(
  input: RecipientPlayerStateStreamCollectionInput
): RecipientPlayerStateStreamCollection {
  const now = input.frameContext.now;
  const recipient = input.recipient;
  let vitalsPlayers: PlayerVitalsSnapshot[] | null = null;
  let removedPlayerIds: string[] | null = null;
  let interestPlayers: PlayerInterestSnapshot[] | null = null;
  let transformPlayers: PackedPlayerTransform[] | null = null;
  let hiddenPlayerIds: string[] | null = null;

  input.players.forEach((player, id) => {
    let interest: RecipientInterestDecision | undefined;
    let interestResolved = false;
    const isEnemyForRecipient = Boolean(
      recipient && recipient.id !== id && recipient.team !== player.team
    );

    if (input.vitalsState) {
      let vitalsInterest: RecipientInterestDecision | undefined;
      if (isEnemyForRecipient && recipient) {
        if (!interestResolved) {
          interest = input.getRecipientInterest(recipient, player, now, input.frameContext);
          interestResolved = true;
        }
        vitalsInterest = interest;
      }
      const vitals = input.buildPlayerVitalsForRecipient(
        id,
        player,
        recipient,
        now,
        vitalsInterest,
        input.frameContext
      );
      const changedVitals = selectChangedPlayerVitalsSnapshot({
        state: input.vitalsState,
        playerId: id,
        vitals,
        now,
        force: input.forceVitals,
        reconcileIntervalMs: input.vitalsReconcileIntervalMs,
      });
      if (changedVitals) {
        if (!vitalsPlayers) vitalsPlayers = [];
        vitalsPlayers.push(changedVitals);
      }
    }

    if (input.interestSignatures) {
      if (!interestResolved && recipient) {
        interest = input.getRecipientInterest(recipient, player, now, input.frameContext);
        interestResolved = true;
      }
      const decision = interest;
      if (decision) {
        const snapshot = buildPlayerInterestSnapshot(id, decision);
        const changedSnapshot = selectChangedPlayerInterestSnapshot({
          signatures: input.interestSignatures,
          playerId: id,
          snapshot,
          force: input.forceVitals,
        });
        if (changedSnapshot) {
          if (!interestPlayers) interestPlayers = [];
          interestPlayers.push(changedSnapshot);
        }
      }
    }

    if (input.transformState) {
      if (!canReplicateLiveTransform(player)) return;
      if (!input.forceTransforms && id === input.recipientId) return;

      let transformInterest: RecipientInterestDecision | undefined;
      if (isEnemyForRecipient && recipient) {
        if (!interestResolved) {
          interest = input.getRecipientInterest(recipient, player, now, input.frameContext);
          interestResolved = true;
        }
        transformInterest = interest;
      }
      const exactStateVisible = input.shouldSendExactEnemyState(
        recipient,
        id,
        player,
        now,
        transformInterest
      );
      let transform: PackedPlayerTransform | undefined;
      let signature: PackedPlayerTransform | undefined;
      let highRelevance = false;
      if (exactStateVisible) {
        transform = input.frameContext.packedTransforms.get(id) ?? input.buildPackedTransform(id, player);
        signature = input.frameContext.packedTransformSignatures.get(id) ?? getPackedTransformSignature(transform);
        highRelevance = input.isHighRelevanceTransform(recipient, id, player, now);
      }
      const delta = selectPackedTransformDelta({
        state: input.transformState,
        playerId: id,
        transform,
        signature,
        exactStateVisible,
        force: input.forceTransforms,
        highRelevance,
        now,
      });
      if (delta?.kind === 'visible') {
        if (!transformPlayers) transformPlayers = [];
        transformPlayers.push(delta.transform);
      }
      if (delta?.kind === 'hidden') {
        if (!hiddenPlayerIds) hiddenPlayerIds = [];
        hiddenPlayerIds.push(delta.playerId);
      }
    }
  });

  if (input.vitalsState) {
    if (input.globallyRemovedPlayerIds.length > 0) {
      removedPlayerIds = [...input.globallyRemovedPlayerIds];
    }
    removedPlayerIds = pruneMissingKnownPlayerVitals(
      input.vitalsState,
      input.frameContext.currentIds,
      removedPlayerIds ?? undefined
    ) ?? removedPlayerIds;
  }

  if (input.interestSignatures) {
    pruneMissingPlayerInterestSignatures(input.interestSignatures, input.frameContext.currentIds);
  }

  return {
    vitalsPlayers: vitalsPlayers ?? EMPTY_VITALS_PLAYERS,
    removedPlayerIds: removedPlayerIds ?? EMPTY_REMOVED_PLAYER_IDS,
    interestPlayers: interestPlayers ?? EMPTY_INTEREST_PLAYERS,
    transformPlayers: transformPlayers ?? EMPTY_TRANSFORM_PLAYERS,
    hiddenPlayerIds: hiddenPlayerIds ?? EMPTY_HIDDEN_PLAYER_IDS,
  };
}

export function getPlayerStateStreamBroadcastPlan(
  input: PlayerStateStreamBroadcastPlanInput
): PlayerStateStreamBroadcastPlan {
  return {
    shouldBroadcastVitals: input.vitals && (
      input.forceVitals || isStreamIntervalDue({
        now: input.now,
        lastAt: input.lastVitalsBroadcastAt,
        intervalMs: input.vitalsIntervalMs,
        phaseAtMs: input.vitalsPhaseAtMs,
      })
    ),
    shouldBroadcastInterest: input.vitals && (
      input.forceVitals || isStreamIntervalDue({
        now: input.now,
        lastAt: input.lastInterestBroadcastAt,
        intervalMs: input.interestIntervalMs,
        phaseAtMs: input.interestPhaseAtMs,
      })
    ),
    shouldBroadcastTransforms: input.transforms,
  };
}

function isStreamIntervalDue(input: {
  now: number;
  lastAt: number;
  intervalMs: number;
  phaseAtMs?: number;
}): boolean {
  if (input.phaseAtMs === undefined) {
    return input.now - input.lastAt >= input.intervalMs;
  }
  return isPhasedIntervalDue(input.now, input.lastAt, input.intervalMs, input.phaseAtMs);
}

export function getPreviousPhasedIntervalTime(
  now: number,
  intervalMs: number,
  phaseAtMs = 0
): number {
  const interval = Math.max(1, Math.trunc(intervalMs));
  return phaseAtMs + Math.floor((now - phaseAtMs) / interval) * interval;
}

export function isPhasedIntervalDue(
  now: number,
  lastAt: number,
  intervalMs: number,
  phaseAtMs = 0
): boolean {
  const interval = Math.max(1, Math.trunc(intervalMs));
  return Math.floor((now - phaseAtMs) / interval) > Math.floor((lastAt - phaseAtMs) / interval);
}

export function buildPlayerVitalsStreamMessage(
  input: PlayerVitalsStreamMessageInput
): PlayerVitalsMessage | null {
  if (input.players.length === 0 && input.removedPlayerIds.length === 0 && !input.force) {
    return null;
  }

  return {
    tick: input.tick,
    serverTime: input.serverTime,
    players: input.players,
    removedPlayerIds: input.removedPlayerIds,
  };
}

export function buildPlayerInterestStreamMessage(
  input: PlayerInterestStreamMessageInput
): PlayerInterestMessage | null {
  if (input.players.length === 0 && !input.force) {
    return null;
  }

  return {
    tick: input.tick,
    serverTime: input.serverTime,
    players: input.players,
  };
}

export function buildPlayerTransformsStreamMessage(
  input: PlayerTransformsStreamMessageInput
): PlayerTransformsV2Message | null {
  if (input.players.length === 0 && input.hiddenPlayerIds.length === 0 && !input.full) {
    return null;
  }

  return {
    version: 2,
    tick: input.tick,
    serverTime: input.serverTime,
    streamEpoch: input.streamEpoch,
    full: input.full,
    players: input.players,
    hiddenPlayerIds: input.hiddenPlayerIds,
  };
}
