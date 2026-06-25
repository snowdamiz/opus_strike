import type { Team } from '@voxel-strike/shared';
import type { Player } from './schema/Player';

export interface PlayerSpatialQueryOptions {
  team?: Team;
  excludeTeam?: Team;
  excludeId?: string;
  includeDowned?: boolean;
}

const BUCKET_KEY_CELL_OFFSET = 1 << 20;
const BUCKET_KEY_CELL_STRIDE = BUCKET_KEY_CELL_OFFSET * 2;

export class PlayerSpatialIndex {
  private readonly buckets = new Map<number, Player[]>();
  private readonly activeBucketKeys: number[] = [];
  private readonly previousBucketKeys: number[] = [];
  private readonly alivePlayers: Player[] = [];
  private readonly alivePlayersByTeam = new Map<Team, Player[]>();
  private readonly activeTeamKeys: Team[] = [];
  private readonly previousTeamKeys: Team[] = [];
  private readonly enemyPlayersByTeam = new Map<Team, Player[]>();
  private readonly enemyPlayersGenerationByTeam = new Map<Team, number>();
  private readonly emptyTeamPlayers: Player[] = [];
  private rebuildGeneration = 0;

  constructor(private readonly cellSize = 8) {}

  rebuild(players: Iterable<Player>): void {
    this.rebuildGeneration++;
    this.prepareBucketsForRebuild();
    this.alivePlayers.length = 0;
    this.prepareTeamsForRebuild();

    for (const player of players) {
      if (player.state !== 'alive' && player.state !== 'downed') continue;
      if (player.state === 'alive') {
        this.alivePlayers.push(player);
        this.getMutableTeamPlayers(player.team).push(player);
      }
      this.getMutableBucket(player.position.x, player.position.z).push(player);
    }

    this.pruneInactiveBuckets();
    this.pruneInactiveTeams();
  }

  getAlivePlayers(): Player[] {
    return this.alivePlayers;
  }

  getAlivePlayersByTeam(): ReadonlyMap<Team, Player[]> {
    return this.alivePlayersByTeam;
  }

  getEnemyPlayers(team: Team): Player[] {
    let enemyPlayers = this.enemyPlayersByTeam.get(team);
    if (this.enemyPlayersGenerationByTeam.get(team) === this.rebuildGeneration) {
      return enemyPlayers && enemyPlayers.length > 0 ? enemyPlayers : this.emptyTeamPlayers;
    }

    if (!enemyPlayers) {
      enemyPlayers = [];
      this.enemyPlayersByTeam.set(team, enemyPlayers);
    } else {
      enemyPlayers.length = 0;
    }
    for (const player of this.alivePlayers) {
      if (player.team !== team) enemyPlayers.push(player);
    }

    this.enemyPlayersGenerationByTeam.set(team, this.rebuildGeneration);
    return enemyPlayers.length > 0 ? enemyPlayers : this.emptyTeamPlayers;
  }

  getTeamPlayers(team: Team): Player[] {
    return this.alivePlayersByTeam.get(team) ?? this.emptyTeamPlayers;
  }

  queryRadius(
    center: { x: number; z: number },
    radius: number,
    out: Player[],
    options: PlayerSpatialQueryOptions = {}
  ): Player[] {
    out.length = 0;
    const optionTeam = options.team;
    const optionExcludeTeam = options.excludeTeam;
    const optionExcludeId = options.excludeId;
    const includeDowned = options.includeDowned === true;
    const minCellX = Math.floor((center.x - radius) / this.cellSize);
    const maxCellX = Math.floor((center.x + radius) / this.cellSize);
    const minCellZ = Math.floor((center.z - radius) / this.cellSize);
    const maxCellZ = Math.floor((center.z + radius) / this.cellSize);
    const radiusSq = radius * radius;

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const bucket = this.buckets.get(this.getBucketKeyForCell(cellX, cellZ));
        if (!bucket) continue;

        for (const player of bucket) {
          if (player.state !== 'alive' && !(includeDowned && player.state === 'downed')) continue;
          if (optionExcludeId && player.id === optionExcludeId) continue;
          if (optionTeam && player.team !== optionTeam) continue;
          if (optionExcludeTeam && player.team === optionExcludeTeam) continue;
          const dx = player.position.x - center.x;
          const dz = player.position.z - center.z;
          if (dx * dx + dz * dz <= radiusSq) {
            out.push(player);
          }
        }
      }
    }

    return out;
  }

  queryConeCandidates(
    origin: { x: number; z: number },
    range: number,
    out: Player[],
    options: PlayerSpatialQueryOptions = {}
  ): Player[] {
    return this.queryRadius(origin, range, out, options);
  }

  private getBucketKey(x: number, z: number): number {
    return this.getBucketKeyForCell(
      Math.floor(x / this.cellSize),
      Math.floor(z / this.cellSize)
    );
  }

  private getBucketKeyForCell(cellX: number, cellZ: number): number {
    return (cellX + BUCKET_KEY_CELL_OFFSET) * BUCKET_KEY_CELL_STRIDE + (cellZ + BUCKET_KEY_CELL_OFFSET);
  }

  private prepareBucketsForRebuild(): void {
    this.previousBucketKeys.length = 0;
    for (const key of this.activeBucketKeys) {
      this.previousBucketKeys.push(key);
      const bucket = this.buckets.get(key);
      if (bucket) bucket.length = 0;
    }
    this.activeBucketKeys.length = 0;
  }

  private getMutableBucket(x: number, z: number): Player[] {
    const key = this.getBucketKey(x, z);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    if (bucket.length === 0) {
      this.activeBucketKeys.push(key);
    }
    return bucket;
  }

  private pruneInactiveBuckets(): void {
    for (const key of this.previousBucketKeys) {
      const bucket = this.buckets.get(key);
      if (bucket && bucket.length === 0) {
        this.buckets.delete(key);
      }
    }
    this.previousBucketKeys.length = 0;
  }

  private prepareTeamsForRebuild(): void {
    this.previousTeamKeys.length = 0;
    for (const team of this.activeTeamKeys) {
      this.previousTeamKeys.push(team);
      const players = this.alivePlayersByTeam.get(team);
      if (players) players.length = 0;
    }
    this.activeTeamKeys.length = 0;
  }

  private getMutableTeamPlayers(team: Team): Player[] {
    let teamPlayers = this.alivePlayersByTeam.get(team);
    if (!teamPlayers) {
      teamPlayers = [];
      this.alivePlayersByTeam.set(team, teamPlayers);
    }
    if (teamPlayers.length === 0) {
      this.activeTeamKeys.push(team);
    }
    return teamPlayers;
  }

  private pruneInactiveTeams(): void {
    for (const team of this.previousTeamKeys) {
      const teamPlayers = this.alivePlayersByTeam.get(team);
      if (teamPlayers && teamPlayers.length === 0) {
        this.alivePlayersByTeam.delete(team);
      }
    }
    this.previousTeamKeys.length = 0;
  }
}
