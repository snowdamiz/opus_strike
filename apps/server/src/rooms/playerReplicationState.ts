import type {
  PackedPlayerTransform,
  PlayerVitalsSnapshot,
} from '@voxel-strike/shared';

export interface TransformReplicationState {
  signatures: Map<string, PackedPlayerTransform>;
  heartbeatAt: Map<string, number>;
}

export interface PlayerVitalsReplicationState {
  signatures: Map<string, PlayerVitalsSnapshot>;
  reconcileAt: Map<string, number>;
  knownPlayerIds: Set<string>;
}

export class PlayerReplicationStateTracker {
  private readonly knownPlayerIds = new Set<string>();
  private readonly playerNetIds = new Map<string, number>();
  private nextPlayerNetId = 1;
  private transformStreamEpoch = 0;
  private readonly playerVitalRecipientStates = new Map<string, PlayerVitalsReplicationState>();
  private readonly playerInterestSignatures = new Map<string, Map<string, string>>();
  private readonly globalTransformState: TransformReplicationState = {
    signatures: new Map<string, PackedPlayerTransform>(),
    heartbeatAt: new Map<string, number>(),
  };
  private readonly transformRecipientStates = new Map<string, TransformReplicationState>();
  private readonly recentCombatTransformUntil = new Map<string, number>();
  private readonly recentCombatInterestUntil = new Map<string, Map<string, number>>();

  getStreamEpoch(): number {
    return this.transformStreamEpoch;
  }

  getPlayerNetId(playerId: string): number {
    let netId = this.playerNetIds.get(playerId);
    if (netId === undefined) {
      netId = this.nextPlayerNetId++;
      this.playerNetIds.set(playerId, netId);
      this.forceTransformFullSync();
    }
    return netId;
  }

  forceTransformFullSync(): void {
    this.transformStreamEpoch++;
    this.globalTransformState.signatures.clear();
    this.globalTransformState.heartbeatAt.clear();
    this.transformRecipientStates.clear();
  }

  markKnownPlayer(playerId: string): void {
    this.knownPlayerIds.add(playerId);
  }

  removeMissingKnownPlayers(currentPlayerIds: ReadonlySet<string>): string[] {
    const removedPlayerIds: string[] = [];
    this.knownPlayerIds.forEach((playerId) => {
      if (!currentPlayerIds.has(playerId)) {
        removedPlayerIds.push(playerId);
        this.knownPlayerIds.delete(playerId);
        this.clearPlayer(playerId);
      }
    });
    return removedPlayerIds;
  }

  clearPlayer(playerId: string): void {
    this.knownPlayerIds.delete(playerId);
    this.playerVitalRecipientStates.delete(playerId);
    for (const state of this.playerVitalRecipientStates.values()) {
      state.signatures.delete(playerId);
      state.reconcileAt.delete(playerId);
      state.knownPlayerIds.delete(playerId);
    }

    this.playerInterestSignatures.delete(playerId);
    for (const signatures of this.playerInterestSignatures.values()) {
      signatures.delete(playerId);
    }

    this.globalTransformState.signatures.delete(playerId);
    this.globalTransformState.heartbeatAt.delete(playerId);
    this.transformRecipientStates.delete(playerId);
    for (const state of this.transformRecipientStates.values()) {
      state.signatures.delete(playerId);
      state.heartbeatAt.delete(playerId);
    }

    this.recentCombatTransformUntil.delete(playerId);
    this.recentCombatInterestUntil.delete(playerId);
    for (const targets of this.recentCombatInterestUntil.values()) {
      targets.delete(playerId);
    }

    this.playerNetIds.delete(playerId);
    this.forceTransformFullSync();
  }

  getVitalsState(recipientId: string): PlayerVitalsReplicationState {
    let state = this.playerVitalRecipientStates.get(recipientId);
    if (!state) {
      state = {
        signatures: new Map<string, PlayerVitalsSnapshot>(),
        reconcileAt: new Map<string, number>(),
        knownPlayerIds: new Set<string>(),
      };
      this.playerVitalRecipientStates.set(recipientId, state);
    }
    return state;
  }

  getInterestSignatures(recipientId: string): Map<string, string> {
    let signatures = this.playerInterestSignatures.get(recipientId);
    if (!signatures) {
      signatures = new Map<string, string>();
      this.playerInterestSignatures.set(recipientId, signatures);
    }
    return signatures;
  }

  getGlobalTransformState(): TransformReplicationState {
    return this.globalTransformState;
  }

  getTransformState(recipientId: string): TransformReplicationState {
    let state = this.transformRecipientStates.get(recipientId);
    if (!state) {
      state = {
        signatures: new Map<string, PackedPlayerTransform>(),
        heartbeatAt: new Map<string, number>(),
      };
      this.transformRecipientStates.set(recipientId, state);
    }
    return state;
  }

  getRecentCombatTransformUntil(playerId: string): number {
    return this.recentCombatTransformUntil.get(playerId) ?? 0;
  }

  markRecentCombatTransform(playerId: string, now: number, durationMs: number): void {
    this.recentCombatTransformUntil.set(playerId, now + durationMs);
  }

  getRecentCombatInterestUntil(recipientId: string, targetId: string): number {
    return this.recentCombatInterestUntil.get(recipientId)?.get(targetId) ?? 0;
  }

  markRecentCombatInterest(sourceId: string, targetId: string, now: number, durationMs: number): void {
    const until = now + durationMs;
    this.setRecentCombatInterestUntil(sourceId, targetId, until);
    this.setRecentCombatInterestUntil(targetId, sourceId, until);
  }

  private setRecentCombatInterestUntil(recipientId: string, targetId: string, until: number): void {
    let targets = this.recentCombatInterestUntil.get(recipientId);
    if (!targets) {
      targets = new Map<string, number>();
      this.recentCombatInterestUntil.set(recipientId, targets);
    }
    targets.set(targetId, until);
  }
}
