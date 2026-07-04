import {
  BATTLE_ROYAL_SOUL_COLLECT_DURATION_MS,
  BATTLE_ROYAL_SOUL_INTERACTION_RADIUS,
  BATTLE_ROYAL_SOUL_SUMMON_DURATION_MS,
  BATTLE_ROYAL_SUMMONING_CIRCLE_INTERACTION_RADIUS,
  isHeroSkinId,
  type BattleRoyalHeroSoulInteractionSnapshot,
  type BattleRoyalHeroSoulSnapshot,
  type BattleRoyalHeroSoulStateSnapshot,
  type HeroId,
  type HeroSkinId,
  type MapSummoningCircle,
  type Team,
  type Vec3,
} from '@voxel-strike/shared';
import { isHeroId } from './protocolValidation';
import type { Player } from './schema/Player';

export interface BattleRoyalHeroSoulState {
  soulId: string;
  playerId: string;
  playerName: string;
  team: Team;
  heroId: HeroId | null;
  skinId: HeroSkinId | null;
  position: Vec3;
  status: BattleRoyalHeroSoulSnapshot['status'];
  carriedByPlayerId: string | null;
  collectByPlayerId: string | null;
  collectStartedAt: number | null;
  collectCompletesAt: number | null;
  summonByPlayerId: string | null;
  summonCircleId: string | null;
  summonStartedAt: number | null;
  summonCompletesAt: number | null;
  createdAt: number;
}

interface BattleRoyalSoulInteractionChannel {
  playerId: string;
  kind: BattleRoyalHeroSoulInteractionSnapshot['kind'];
  soulId: string | null;
  circleId: string | null;
  startedAt: number;
  completesAt: number;
}

interface BattleRoyalSoulPlayerLookup {
  get(playerId: string): Player | null | undefined;
}

export interface BattleRoyalSoulSummonCompletion {
  summonerId: string;
  circleId: string;
  completedAt: number;
  souls: BattleRoyalHeroSoulState[];
}

export interface BattleRoyalSoulRuntimeUpdateResult {
  completedSummons: BattleRoyalSoulSummonCompletion[];
  changed: boolean;
}

function distanceSq3D(left: Pick<Vec3, 'x' | 'y' | 'z'>, right: Pick<Vec3, 'x' | 'y' | 'z'>): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return dx * dx + dy * dy + dz * dz;
}

function playerPosition(player: Player): Vec3 {
  return { x: player.position.x, y: player.position.y, z: player.position.z };
}

function isAlivePlayer(player: Player | null | undefined): player is Player {
  return player?.state === 'alive';
}

export class BattleRoyalSoulRuntime {
  private readonly soulsById = new Map<string, BattleRoyalHeroSoulState>();
  private readonly soulIdByPlayerId = new Map<string, string>();
  private readonly channelByPlayerId = new Map<string, BattleRoyalSoulInteractionChannel>();

  hasActiveInteraction(playerId: string): boolean {
    return this.channelByPlayerId.has(playerId);
  }

  getInteraction(playerId: string): BattleRoyalHeroSoulInteractionSnapshot | null {
    const channel = this.channelByPlayerId.get(playerId);
    return channel ? this.toInteractionSnapshot(channel) : null;
  }

  getCarriedSoulCount(playerId: string): number {
    let count = 0;
    for (const soul of this.soulsById.values()) {
      if (soul.status === 'carried' && soul.carriedByPlayerId === playerId) count++;
    }
    return count;
  }

  createSoul(player: Player, now: number): BattleRoyalHeroSoulState {
    this.clearPlayerSoul(player.id);
    const soul: BattleRoyalHeroSoulState = {
      soulId: `soul:${player.id}:${now}`,
      playerId: player.id,
      playerName: player.name,
      team: player.team as Team,
      heroId: isHeroId(player.heroId) ? player.heroId : null,
      skinId: isHeroSkinId(player.skinId) ? player.skinId : null,
      position: playerPosition(player),
      status: 'available',
      carriedByPlayerId: null,
      collectByPlayerId: null,
      collectStartedAt: null,
      collectCompletesAt: null,
      summonByPlayerId: null,
      summonCircleId: null,
      summonStartedAt: null,
      summonCompletesAt: null,
      createdAt: now,
    };
    this.soulsById.set(soul.soulId, soul);
    this.soulIdByPlayerId.set(player.id, soul.soulId);
    return soul;
  }

  tryStartNearestCollect(collector: Player, now: number): boolean {
    if (!isAlivePlayer(collector) || this.hasActiveInteraction(collector.id)) return false;

    const soul = this.getNearestCollectableSoul(collector);
    if (!soul) return false;

    soul.status = 'collecting';
    soul.collectByPlayerId = collector.id;
    soul.collectStartedAt = now;
    soul.collectCompletesAt = now + BATTLE_ROYAL_SOUL_COLLECT_DURATION_MS;
    this.channelByPlayerId.set(collector.id, {
      playerId: collector.id,
      kind: 'collect',
      soulId: soul.soulId,
      circleId: null,
      startedAt: now,
      completesAt: soul.collectCompletesAt,
    });
    this.stopHorizontalVelocity(collector);
    return true;
  }

  tryStartSummon(summoner: Player, circles: readonly MapSummoningCircle[], now: number): boolean {
    if (!isAlivePlayer(summoner) || this.hasActiveInteraction(summoner.id)) return false;

    const circle = this.getNearestUsableCircle(summoner, circles);
    if (!circle) return false;

    const souls = this.getCarriedSouls(summoner.id);
    if (souls.length === 0) return false;

    const completesAt = now + BATTLE_ROYAL_SOUL_SUMMON_DURATION_MS;
    for (const soul of souls) {
      soul.status = 'summoning';
      soul.summonByPlayerId = summoner.id;
      soul.summonCircleId = circle.id;
      soul.summonStartedAt = now;
      soul.summonCompletesAt = completesAt;
    }
    this.channelByPlayerId.set(summoner.id, {
      playerId: summoner.id,
      kind: 'summon',
      soulId: null,
      circleId: circle.id,
      startedAt: now,
      completesAt,
    });
    this.stopHorizontalVelocity(summoner);
    return true;
  }

  cancelInteractionForPlayer(playerId: string): boolean {
    const channel = this.channelByPlayerId.get(playerId);
    if (!channel) return false;

    this.channelByPlayerId.delete(playerId);
    if (channel.kind === 'collect' && channel.soulId) {
      const soul = this.soulsById.get(channel.soulId);
      if (soul && soul.status === 'collecting' && soul.collectByPlayerId === playerId) {
        soul.status = 'available';
        soul.collectByPlayerId = null;
        soul.collectStartedAt = null;
        soul.collectCompletesAt = null;
      }
      return true;
    }

    if (channel.kind === 'summon') {
      for (const soul of this.soulsById.values()) {
        if (soul.status !== 'summoning' || soul.summonByPlayerId !== playerId) continue;
        soul.status = 'carried';
        soul.summonByPlayerId = null;
        soul.summonCircleId = null;
        soul.summonStartedAt = null;
        soul.summonCompletesAt = null;
      }
    }

    return true;
  }

  dropCarriedSouls(carrier: Player, now: number): boolean {
    let changed = this.cancelInteractionForPlayer(carrier.id);
    const position = playerPosition(carrier);
    for (const soul of this.soulsById.values()) {
      if (soul.carriedByPlayerId !== carrier.id) continue;
      soul.status = 'available';
      soul.position = position;
      soul.carriedByPlayerId = null;
      soul.collectByPlayerId = null;
      soul.collectStartedAt = null;
      soul.collectCompletesAt = null;
      soul.summonByPlayerId = null;
      soul.summonCircleId = null;
      soul.summonStartedAt = null;
      soul.summonCompletesAt = null;
      soul.createdAt = now;
      changed = true;
    }
    return changed;
  }

  clearPlayer(playerId: string): boolean {
    const changed = this.cancelInteractionForPlayer(playerId);
    return this.clearPlayerSoul(playerId) || changed;
  }

  clearTeam(team: string | null | undefined): boolean {
    let changed = false;
    if (!team) return false;
    for (const soul of Array.from(this.soulsById.values())) {
      if (soul.team !== team) continue;
      this.removeSoul(soul.soulId);
      changed = true;
    }
    return changed;
  }

  clearAll(): void {
    this.soulsById.clear();
    this.soulIdByPlayerId.clear();
    this.channelByPlayerId.clear();
  }

  update(
    players: BattleRoyalSoulPlayerLookup,
    circles: readonly MapSummoningCircle[],
    now: number
  ): BattleRoyalSoulRuntimeUpdateResult {
    const completedSummons: BattleRoyalSoulSummonCompletion[] = [];
    let changed = false;

    for (const channel of Array.from(this.channelByPlayerId.values())) {
      const player = players.get(channel.playerId) ?? null;
      if (channel.kind === 'collect') {
        if (!this.isCollectChannelValid(channel, player)) {
          changed = this.cancelInteractionForPlayer(channel.playerId) || changed;
          continue;
        }
        if (now < channel.completesAt) continue;

        const soul = this.soulsById.get(channel.soulId!);
        if (soul) {
          soul.status = 'carried';
          soul.carriedByPlayerId = channel.playerId;
          soul.collectByPlayerId = null;
          soul.collectStartedAt = null;
          soul.collectCompletesAt = null;
          soul.position = playerPosition(player!);
        }
        this.channelByPlayerId.delete(channel.playerId);
        changed = true;
        continue;
      }

      if (!this.isSummonChannelValid(channel, player, circles)) {
        changed = this.cancelInteractionForPlayer(channel.playerId) || changed;
        continue;
      }
      if (now < channel.completesAt) continue;

      const souls = Array.from(this.soulsById.values()).filter((soul) => (
        soul.status === 'summoning' &&
        soul.summonByPlayerId === channel.playerId &&
        soul.summonCircleId === channel.circleId
      ));
      for (const soul of souls) {
        this.removeSoul(soul.soulId);
      }
      this.channelByPlayerId.delete(channel.playerId);
      if (channel.circleId && souls.length > 0) {
        completedSummons.push({
          summonerId: channel.playerId,
          circleId: channel.circleId,
          completedAt: now,
          souls,
        });
      }
      changed = true;
    }

    return { completedSummons, changed };
  }

  buildSnapshot(): BattleRoyalHeroSoulStateSnapshot {
    return {
      souls: Array.from(this.soulsById.values())
        .sort((a, b) => a.createdAt - b.createdAt || a.soulId.localeCompare(b.soulId))
        .map((soul) => ({ ...soul, position: { ...soul.position } })),
      interactions: Array.from(this.channelByPlayerId.values())
        .sort((a, b) => a.startedAt - b.startedAt || a.playerId.localeCompare(b.playerId))
        .map((channel) => this.toInteractionSnapshot(channel)),
    };
  }

  private getNearestCollectableSoul(collector: Player): BattleRoyalHeroSoulState | null {
    let bestSoul: BattleRoyalHeroSoulState | null = null;
    let bestDistanceSq = BATTLE_ROYAL_SOUL_INTERACTION_RADIUS * BATTLE_ROYAL_SOUL_INTERACTION_RADIUS;
    const collectorPosition = playerPosition(collector);
    for (const soul of this.soulsById.values()) {
      if (soul.team !== collector.team) continue;
      if (soul.playerId === collector.id) continue;
      if (soul.status !== 'available') continue;
      const distanceSq = distanceSq3D(collectorPosition, soul.position);
      if (distanceSq >= bestDistanceSq) continue;
      bestSoul = soul;
      bestDistanceSq = distanceSq;
    }
    return bestSoul;
  }

  private getNearestUsableCircle(
    player: Player,
    circles: readonly MapSummoningCircle[]
  ): MapSummoningCircle | null {
    let bestCircle: MapSummoningCircle | null = null;
    let bestDistanceSq = BATTLE_ROYAL_SUMMONING_CIRCLE_INTERACTION_RADIUS * BATTLE_ROYAL_SUMMONING_CIRCLE_INTERACTION_RADIUS;
    const position = playerPosition(player);
    for (const circle of circles) {
      const distanceSq = distanceSq3D(position, circle.position);
      if (distanceSq >= bestDistanceSq) continue;
      bestCircle = circle;
      bestDistanceSq = distanceSq;
    }
    return bestCircle;
  }

  private getCarriedSouls(playerId: string): BattleRoyalHeroSoulState[] {
    return Array.from(this.soulsById.values()).filter((soul) => (
      soul.status === 'carried' && soul.carriedByPlayerId === playerId
    ));
  }

  private isCollectChannelValid(
    channel: BattleRoyalSoulInteractionChannel,
    player: Player | null
  ): boolean {
    if (!isAlivePlayer(player) || !channel.soulId) return false;
    const soul = this.soulsById.get(channel.soulId);
    if (!soul) return false;
    if (soul.status !== 'collecting' || soul.collectByPlayerId !== channel.playerId) return false;
    if (soul.team !== player.team) return false;
    return distanceSq3D(playerPosition(player), soul.position) <=
      BATTLE_ROYAL_SOUL_INTERACTION_RADIUS * BATTLE_ROYAL_SOUL_INTERACTION_RADIUS;
  }

  private isSummonChannelValid(
    channel: BattleRoyalSoulInteractionChannel,
    player: Player | null,
    circles: readonly MapSummoningCircle[]
  ): boolean {
    if (!isAlivePlayer(player) || !channel.circleId) return false;
    const circle = circles.find((candidate) => candidate.id === channel.circleId);
    if (!circle) return false;
    if (distanceSq3D(playerPosition(player), circle.position) >
      BATTLE_ROYAL_SUMMONING_CIRCLE_INTERACTION_RADIUS * BATTLE_ROYAL_SUMMONING_CIRCLE_INTERACTION_RADIUS
    ) {
      return false;
    }
    return Array.from(this.soulsById.values()).some((soul) => (
      soul.status === 'summoning' &&
      soul.carriedByPlayerId === channel.playerId &&
      soul.summonByPlayerId === channel.playerId &&
      soul.summonCircleId === channel.circleId
    ));
  }

  private clearPlayerSoul(playerId: string): boolean {
    const soulId = this.soulIdByPlayerId.get(playerId);
    if (!soulId) return false;
    this.removeSoul(soulId);
    return true;
  }

  private removeSoul(soulId: string): void {
    const soul = this.soulsById.get(soulId);
    if (!soul) return;
    if (soul.collectByPlayerId) this.channelByPlayerId.delete(soul.collectByPlayerId);
    if (soul.summonByPlayerId) this.channelByPlayerId.delete(soul.summonByPlayerId);
    this.soulIdByPlayerId.delete(soul.playerId);
    this.soulsById.delete(soulId);
  }

  private stopHorizontalVelocity(player: Player): void {
    player.velocity.x = 0;
    player.velocity.z = 0;
  }

  private toInteractionSnapshot(
    channel: BattleRoyalSoulInteractionChannel
  ): BattleRoyalHeroSoulInteractionSnapshot {
    return {
      playerId: channel.playerId,
      kind: channel.kind,
      soulId: channel.soulId,
      circleId: channel.circleId,
      startedAt: channel.startedAt,
      completesAt: channel.completesAt,
    };
  }
}
