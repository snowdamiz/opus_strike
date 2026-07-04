import { randomUUID } from 'node:crypto';
import type {
  HeroId,
  GameplayMode,
  MapProfileId,
  MapTopologyId,
  MatchMode,
  PregeneratedMapId,
  Team,
  VoxelMapSizeId,
  VoxelMapTheme,
} from '@voxel-strike/shared';
import type { MatchKillEventSnapshot, MatchParticipantSnapshot } from '../persistence/matchPersistence';
import { isHeroId, isTeam } from './protocolValidation';
import type { Player } from './schema/Player';

export type MatchPersistenceState = 'active' | 'persisting' | 'persisted' | 'failed';

export interface MatchLedgerParticipant extends MatchParticipantSnapshot {
  team: Team;
}

export interface MatchPersistenceLedger {
  matchId: string;
  roomId: string;
  lobbyId: string | null;
  matchMode: MatchMode;
  mapSeed: number;
  mapThemeId: VoxelMapTheme['id'];
  mapSize: VoxelMapSizeId | null;
  mapProfileId: MapProfileId | null;
  mapTopologyId: MapTopologyId | null;
  mapGeneratorVersion: number | null;
  pregeneratedMapId: PregeneratedMapId | null;
  rankedEligible: boolean;
  startedAt: Date;
  endedAt: Date | null;
  redScore: number | null;
  blueScore: number | null;
  winningTeam: Team | null;
  state: MatchPersistenceState;
  participants: Map<string, MatchLedgerParticipant>;
  killEvents: MatchKillEventSnapshot[];
}

export interface MatchLedgerConfig {
  roomId: string;
  lobbyId: string | null;
  matchMode: MatchMode;
  mapSeed: number;
  mapThemeId: VoxelMapTheme['id'];
  mapSize: VoxelMapSizeId | null;
  mapProfileId: MapProfileId | null;
  mapTopologyId: MapTopologyId | null;
  mapGeneratorVersion: number | null;
  pregeneratedMapId: PregeneratedMapId | null;
  rankedEligible: boolean;
}

export interface MatchLedgerRuntimeDeps {
  getConfig(): MatchLedgerConfig;
  getDurableUserId(playerId: string): string | null;
  isNpc(playerId: string): boolean;
  createMatchId?: () => string;
}

export interface EnsureMatchLedgerResult {
  ledger: MatchPersistenceLedger;
  created: boolean;
}

export interface FinalRankedEligibilityInput {
  ledger: MatchPersistenceLedger;
  participants: readonly MatchParticipantSnapshot[];
  currentMatchMode: MatchMode;
  gameplayMode: GameplayMode;
  npcCount: number;
  requiredHumanPlayers: number;
  forcedByPlayerId?: string;
}

export class MatchLedgerRuntime {
  private ledger: MatchPersistenceLedger | null = null;

  constructor(private readonly deps: MatchLedgerRuntimeDeps) {}

  getLedger(): MatchPersistenceLedger | null {
    return this.ledger;
  }

  getMatchId(): string | null {
    return this.ledger?.matchId ?? null;
  }

  clear(): void {
    this.ledger = null;
  }

  ensureLedger(now = Date.now()): EnsureMatchLedgerResult {
    if (!this.ledger || this.ledger.state === 'persisted' || this.ledger.state === 'failed') {
      const config = this.deps.getConfig();
      this.ledger = {
        matchId: this.deps.createMatchId?.() ?? randomUUID(),
        roomId: config.roomId,
        lobbyId: config.lobbyId,
        matchMode: config.matchMode,
        mapSeed: config.mapSeed,
        mapThemeId: config.mapThemeId,
        mapSize: config.mapSize,
        mapProfileId: config.mapProfileId,
        mapTopologyId: config.mapTopologyId,
        mapGeneratorVersion: config.mapGeneratorVersion,
        pregeneratedMapId: config.pregeneratedMapId,
        rankedEligible: config.rankedEligible,
        startedAt: new Date(now),
        endedAt: null,
        redScore: null,
        blueScore: null,
        winningTeam: null,
        state: 'active',
        participants: new Map(),
        killEvents: [],
      };
      return { ledger: this.ledger, created: true };
    }

    return { ledger: this.ledger, created: false };
  }

  isDurableHumanPlayer(player: Player | null | undefined): player is Player {
    return Boolean(
      player
      && !player.isBot
      && !this.deps.isNpc(player.id)
      && this.deps.getDurableUserId(player.id)
    );
  }

  registerParticipant(player: Player, now = Date.now()): MatchLedgerParticipant | null {
    const ledger = this.ledger;
    if (!ledger || ledger.state !== 'active') return null;
    if (!this.isDurableHumanPlayer(player) || !isTeam(player.team)) return null;

    const userId = this.deps.getDurableUserId(player.id);
    if (!userId) return null;

    const existing = ledger.participants.get(userId);
    if (existing) {
      this.updateParticipantIdentity(existing, player);
      existing.leftAt = null;
      return existing;
    }

    const participant: MatchLedgerParticipant = {
      userId,
      playerSessionId: player.id,
      displayName: player.name,
      team: player.team,
      heroId: getParticipantHeroId(player),
      kills: 0,
      deaths: 0,
      assists: 0,
      humanKills: 0,
      botKills: 0,
      humanAssists: 0,
      botAssists: 0,
      flagCaptures: 0,
      flagReturns: 0,
      joinedAt: new Date(now),
      leftAt: null,
    };
    ledger.participants.set(userId, participant);
    return participant;
  }

  syncParticipant(player: Player): MatchLedgerParticipant | null {
    const ledger = this.ledger;
    if (!ledger || ledger.state !== 'active') return null;
    if (!this.isDurableHumanPlayer(player) || !isTeam(player.team)) return null;

    const userId = this.deps.getDurableUserId(player.id);
    if (!userId) return null;

    const participant = ledger.participants.get(userId) ?? this.registerParticipant(player);
    if (!participant) return null;

    this.updateParticipantIdentity(participant, player);
    participant.kills = Math.max(participant.kills, player.kills);
    participant.deaths = Math.max(participant.deaths, player.deaths);
    participant.assists = Math.max(participant.assists, player.assists);
    participant.flagCaptures = Math.max(participant.flagCaptures, player.flagCaptures);
    participant.flagReturns = Math.max(participant.flagReturns, player.flagReturns);
    return participant;
  }

  buildParticipantSnapshots(players: Iterable<Player>): MatchParticipantSnapshot[] {
    const ledger = this.ledger;
    if (!ledger) return [];

    for (const player of players) {
      this.syncParticipant(player);
    }

    return Array.from(ledger.participants.values()).map((participant) => ({
      userId: participant.userId,
      playerSessionId: participant.playerSessionId,
      displayName: participant.displayName,
      team: participant.team,
      heroId: participant.heroId,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      humanKills: participant.humanKills,
      botKills: participant.botKills,
      humanAssists: participant.humanAssists,
      botAssists: participant.botAssists,
      flagCaptures: participant.flagCaptures,
      flagReturns: participant.flagReturns,
      joinedAt: participant.joinedAt,
      leftAt: participant.leftAt,
    }));
  }

  markParticipantLeft(player: Player, now = Date.now()): void {
    const participant = this.syncParticipant(player);
    if (!participant) return;

    participant.leftAt = new Date(now);
  }

  recordDeath(victim: Player, killer: Player | null): void {
    if (!this.isDurableHumanPlayer(victim)) return;

    const participant = this.registerParticipant(victim);
    if (participant) {
      participant.deaths++;
    }
  }

  recordKill(killer: Player, victim: Player, details: {
    abilityId?: string | null;
    damageType?: string | null;
    victimHadFlag?: boolean;
    occurredAt?: Date;
  } = {}): void {
    if (!this.isTrackableCombatPlayer(killer) || !this.isTrackableCombatPlayer(victim)) return;

    const killerParticipant = this.isDurableHumanPlayer(killer)
      ? this.registerParticipant(killer)
      : null;
    const victimParticipant = this.isDurableHumanPlayer(victim)
      ? this.registerParticipant(victim)
      : null;
    if (killerParticipant) {
      killerParticipant.kills++;
      if (victimParticipant) {
        killerParticipant.humanKills = (killerParticipant.humanKills ?? 0) + 1;
      } else {
        killerParticipant.botKills = (killerParticipant.botKills ?? 0) + 1;
      }
    }

    this.ledger?.killEvents.push({
      killerUserId: killerParticipant?.userId ?? null,
      killerPlayerSessionId: killer.id,
      victimUserId: victimParticipant?.userId ?? null,
      victimPlayerSessionId: victim.id,
      killerHeroId: getParticipantHeroId(killer),
      victimHeroId: getParticipantHeroId(victim),
      abilityId: details.abilityId ?? null,
      damageType: details.damageType ?? null,
      victimHadFlag: details.victimHadFlag === true,
      occurredAt: details.occurredAt ?? new Date(),
    });
  }

  recordAssist(assister: Player, victim: Player): void {
    if (!this.isDurableHumanPlayer(assister) || !this.isTrackableCombatPlayer(victim)) return;

    const participant = this.registerParticipant(assister);
    if (participant) {
      participant.assists++;
      if (this.isDurableHumanPlayer(victim)) {
        participant.humanAssists = (participant.humanAssists ?? 0) + 1;
      } else {
        participant.botAssists = (participant.botAssists ?? 0) + 1;
      }
    }
  }

  recordFlagCapture(player: Player): void {
    if (!this.isDurableHumanPlayer(player)) return;

    const participant = this.registerParticipant(player);
    if (participant) {
      participant.flagCaptures++;
    }
  }

  recordFlagReturn(player: Player): void {
    if (!this.isDurableHumanPlayer(player)) return;

    const participant = this.registerParticipant(player);
    if (participant) {
      participant.flagReturns++;
    }
  }

  isFinalRankedEligible(input: FinalRankedEligibilityInput): boolean {
    return Boolean(
      input.ledger.rankedEligible
      && input.ledger.matchMode === 'ranked'
      && input.currentMatchMode === 'ranked'
      && !input.forcedByPlayerId
      && input.npcCount === 0
      && (input.gameplayMode === 'battle_royal'
        ? input.participants.length >= input.requiredHumanPlayers
        : input.participants.length === input.requiredHumanPlayers)
      && input.participants.every((participant) => participant.userId)
    );
  }

  private updateParticipantIdentity(participant: MatchLedgerParticipant, player: Player): void {
    participant.playerSessionId = player.id;
    participant.displayName = player.name;
    participant.team = player.team as Team;
    participant.heroId = getParticipantHeroId(player);
  }

  private isTrackableCombatPlayer(player: Player | null | undefined): player is Player {
    return Boolean(
      player
      && !this.deps.isNpc(player.id)
      && isTeam(player.team)
    );
  }
}

function getParticipantHeroId(player: Player): HeroId | null {
  return isHeroId(player.heroId) ? player.heroId : null;
}
