import {
  BATTLE_ROYAL_DOWNED_DURATION_MS,
  BATTLE_ROYAL_DOWNED_MAX_HP,
  BATTLE_ROYAL_KNOCKDOWN_SHIELD_HP,
  BATTLE_ROYAL_REVIVE_DURATION_MS,
  BATTLE_ROYAL_REVIVE_RADIUS,
  BATTLE_ROYAL_REVIVED_HEALTH,
  type PlayerDownedEvent,
  type PlayerInput,
  type PlayerReviveCancelledEvent,
  type PlayerRevivedEvent,
  type PlayerReviveStartedEvent,
} from '@voxel-strike/shared';
import type { Player } from './schema/Player';
import type { PlainVec3 } from './bot-ai';

export type BattleRoyalReviveCancelReason =
  | 'invalid_state'
  | 'out_of_range'
  | 'interrupted'
  | 'target_removed'
  | 'reviver_removed'
  | 'final_eliminated'
  | 'reset';

export interface BattleRoyalDownedRuntimeDeps {
  getPlayerById(playerId: string): Player | null;
  prepareDownedPlayer(player: Player, now: number): void;
  prepareRevivedPlayer(player: Player, now: number): void;
  finalEliminate(
    player: Player,
    sourceId: string | null,
    damageType: string,
    now: number,
    context?: { sourcePosition?: PlainVec3 | null; sourceDirection?: PlainVec3 | null }
  ): void;
  broadcastPlayerDowned(payload: PlayerDownedEvent): void;
  broadcastReviveStarted(payload: PlayerReviveStartedEvent): void;
  broadcastReviveCancelled(payload: PlayerReviveCancelledEvent): void;
  broadcastPlayerRevived(payload: PlayerRevivedEvent): void;
}

export function hasBattleRoyalHoldInteractionBreakingInput(input: PlayerInput): boolean {
  return Boolean(
    input.moveForward ||
    input.moveBackward ||
    input.moveLeft ||
    input.moveRight ||
    input.jump ||
    input.crouch ||
    input.crouchPressed ||
    input.sprint ||
    input.primaryFire ||
    input.secondaryFire ||
    input.reload ||
    input.ability1 ||
    input.ability2 ||
    input.ultimate
  );
}

function distanceSq3D(left: Player, right: Player): number {
  const dx = left.position.x - right.position.x;
  const dy = left.position.y - right.position.y;
  const dz = left.position.z - right.position.z;
  return dx * dx + dy * dy + dz * dz;
}

function clearDownedFields(player: Player): void {
  player.downedHealth = 0;
  player.downedMaxHealth = 0;
  player.downedStartedAt = 0;
  player.downedRemainingMs = 0;
  player.downedExpiresAt = 0;
  player.reviveStartedAt = 0;
  player.reviveCompletesAt = 0;
  player.reviveByPlayerId = '';
  player.knockdownShieldHealth = 0;
  player.knockdownShieldMaxHealth = 0;
  player.knockdownShieldActive = false;
}

export class BattleRoyalDownedRuntime {
  private readonly reviveTargetByReviverId = new Map<string, string>();

  constructor(private readonly deps: BattleRoyalDownedRuntimeDeps) {}

  isReviving(reviverId: string): boolean {
    return this.reviveTargetByReviverId.has(reviverId);
  }

  getReviveTargetId(reviverId: string): string | null {
    return this.reviveTargetByReviverId.get(reviverId) ?? null;
  }

  isBeingRevived(target: Player): boolean {
    return target.state === 'downed' && target.reviveByPlayerId.length > 0;
  }

  getDownedRemainingMs(player: Player, now: number): number {
    if (player.state !== 'downed') return 0;
    if (player.reviveByPlayerId) {
      return Math.max(0, Math.round(player.downedRemainingMs || 0));
    }
    if (player.downedExpiresAt > 0) {
      return Math.max(0, Math.round(player.downedExpiresAt - now));
    }
    return Math.max(0, Math.round(player.downedRemainingMs || 0));
  }

  enterDowned(
    target: Player,
    sourceId: string | null,
    damageType: string,
    now: number,
    context: { sourcePosition?: PlainVec3 | null; sourceDirection?: PlainVec3 | null } = {}
  ): void {
    this.cancelReviveForPlayer(target.id, 'reset', now, { silent: true });

    target.state = 'downed';
    target.health = 0;
    target.downedMaxHealth = BATTLE_ROYAL_DOWNED_MAX_HP;
    target.downedHealth = BATTLE_ROYAL_DOWNED_MAX_HP;
    target.downedStartedAt = now;
    target.downedRemainingMs = BATTLE_ROYAL_DOWNED_DURATION_MS;
    target.downedExpiresAt = now + BATTLE_ROYAL_DOWNED_DURATION_MS;
    target.reviveStartedAt = 0;
    target.reviveCompletesAt = 0;
    target.reviveByPlayerId = '';
    // Fresh knockdown shield each down; the player raises it with primary fire.
    // Bots raise theirs immediately.
    target.knockdownShieldHealth = BATTLE_ROYAL_KNOCKDOWN_SHIELD_HP;
    target.knockdownShieldMaxHealth = BATTLE_ROYAL_KNOCKDOWN_SHIELD_HP;
    target.knockdownShieldActive = target.isBot;

    this.deps.prepareDownedPlayer(target, now);
    this.deps.broadcastPlayerDowned({
      targetId: target.id,
      sourceId,
      damageType,
      downedHealth: target.downedHealth,
      downedMaxHealth: target.downedMaxHealth,
      downedStartedAt: target.downedStartedAt,
      downedRemainingMs: target.downedRemainingMs,
      downedExpiresAt: target.downedExpiresAt,
      position: { x: target.position.x, y: target.position.y, z: target.position.z },
      sourcePosition: context.sourcePosition ?? null,
      sourceDirection: context.sourceDirection ?? null,
    });
  }

  update(players: Iterable<Player>, now: number): void {
    for (const player of players) {
      if (player.state !== 'downed') continue;

      const remainingMs = this.getDownedRemainingMs(player, now);
      player.downedRemainingMs = remainingMs;

      if (player.reviveByPlayerId) {
        const reviver = this.deps.getPlayerById(player.reviveByPlayerId);
        if (!this.isReviveContinuationValid(reviver, player)) {
          this.cancelReviveForTarget(player, 'invalid_state', now);
          continue;
        }
        if (now >= player.reviveCompletesAt) {
          this.completeRevive(player, reviver!, now);
        }
        continue;
      }

      if (remainingMs <= 0) {
        this.deps.finalEliminate(player, null, 'bleed_out', now);
      } else if (player.downedExpiresAt <= 0) {
        // No reviver is holding the timer frozen, so an unset expiry would
        // otherwise never count down — leaving the player downed forever and
        // their team never registering as eliminated. Resume the countdown.
        player.downedExpiresAt = now + remainingMs;
      }
    }
  }

  tryStartRevive(reviver: Player, target: Player, now: number): boolean {
    if (!this.canStartRevive(reviver, target)) return false;

    const downedRemainingMs = this.getDownedRemainingMs(target, now);
    target.downedRemainingMs = downedRemainingMs;
    target.downedExpiresAt = 0;
    target.reviveByPlayerId = reviver.id;
    target.reviveStartedAt = now;
    target.reviveCompletesAt = now + BATTLE_ROYAL_REVIVE_DURATION_MS;
    this.reviveTargetByReviverId.set(reviver.id, target.id);

    reviver.velocity.x = 0;
    reviver.velocity.z = 0;
    target.velocity.x = 0;
    target.velocity.z = 0;

    this.deps.broadcastReviveStarted({
      targetId: target.id,
      reviverId: reviver.id,
      startedAt: target.reviveStartedAt,
      completesAt: target.reviveCompletesAt,
      downedRemainingMs,
    });
    return true;
  }

  cancelReviveForPlayer(
    playerId: string,
    reason: BattleRoyalReviveCancelReason,
    now: number,
    options: { silent?: boolean } = {}
  ): boolean {
    const targetId = this.reviveTargetByReviverId.get(playerId);
    if (targetId) {
      const target = this.deps.getPlayerById(targetId);
      if (target) return this.cancelReviveForTarget(target, reason, now, options);
      this.reviveTargetByReviverId.delete(playerId);
      return true;
    }

    const player = this.deps.getPlayerById(playerId);
    if (player?.state === 'downed' && player.reviveByPlayerId) {
      return this.cancelReviveForTarget(player, reason, now, options);
    }
    return false;
  }

  cancelReviveForTarget(
    target: Player,
    reason: BattleRoyalReviveCancelReason,
    now: number,
    options: { silent?: boolean } = {}
  ): boolean {
    if (!target.reviveByPlayerId) return false;

    const reviverId = target.reviveByPlayerId;
    const remainingMs = this.getDownedRemainingMs(target, now);
    this.reviveTargetByReviverId.delete(reviverId);
    target.reviveByPlayerId = '';
    target.reviveStartedAt = 0;
    target.reviveCompletesAt = 0;
    target.downedRemainingMs = remainingMs;
    target.downedExpiresAt = target.state === 'downed' && remainingMs > 0 ? now + remainingMs : 0;

    if (!options.silent) {
      this.deps.broadcastReviveCancelled({
        targetId: target.id,
        reviverId,
        cancelledAt: now,
        reason,
        downedRemainingMs: target.downedRemainingMs,
        downedExpiresAt: target.downedExpiresAt || null,
      });
    }
    return true;
  }

  clearPlayer(player: Player, now: number, reason: BattleRoyalReviveCancelReason = 'reset'): void {
    this.cancelReviveForPlayer(player.id, reason, now, { silent: true });
    clearDownedFields(player);
  }

  clearAll(players: Iterable<Player>, now: number): void {
    for (const player of players) {
      this.clearPlayer(player, now);
    }
    this.reviveTargetByReviverId.clear();
  }

  private completeRevive(target: Player, reviver: Player, now: number): void {
    this.reviveTargetByReviverId.delete(reviver.id);
    target.state = 'alive';
    target.health = Math.min(target.maxHealth, BATTLE_ROYAL_REVIVED_HEALTH);
    clearDownedFields(target);
    this.deps.prepareRevivedPlayer(target, now);

    this.deps.broadcastPlayerRevived({
      targetId: target.id,
      reviverId: reviver.id,
      revivedAt: now,
      health: target.health,
      maxHealth: target.maxHealth,
    });
  }

  private canStartRevive(reviver: Player, target: Player): boolean {
    if (reviver.state !== 'alive') return false;
    if (target.state !== 'downed') return false;
    if (target.team !== reviver.team) return false;
    if (target.reviveByPlayerId && target.reviveByPlayerId !== reviver.id) return false;
    return this.isWithinReviveRange(reviver, target);
  }

  private isReviveContinuationValid(reviver: Player | null, target: Player): boolean {
    if (!reviver) return false;
    if (reviver.state !== 'alive') return false;
    if (target.state !== 'downed') return false;
    if (target.reviveByPlayerId !== reviver.id) return false;
    if (target.team !== reviver.team) return false;
    return this.isWithinReviveRange(reviver, target);
  }

  private isWithinReviveRange(reviver: Player, target: Player): boolean {
    return distanceSq3D(reviver, target) <= BATTLE_ROYAL_REVIVE_RADIUS * BATTLE_ROYAL_REVIVE_RADIUS;
  }
}
