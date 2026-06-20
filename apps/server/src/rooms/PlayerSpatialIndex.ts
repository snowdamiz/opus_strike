import type { Team } from '@voxel-strike/shared';
import type { Player } from './schema/Player';

export interface PlayerSpatialQueryOptions {
  team?: Team;
  excludeTeam?: Team;
  excludeId?: string;
}

export class PlayerSpatialIndex {
  private readonly buckets = new Map<number, Player[]>();
  private readonly alivePlayers: Player[] = [];
  private readonly alivePlayersByTeam = new Map<Team, Player[]>();
  private readonly enemyPlayersByTeam = new Map<Team, Player[]>();
  private readonly emptyTeamPlayers: Player[] = [];

  constructor(private readonly cellSize = 8) {}

  rebuild(players: Iterable<Player>): void {
    this.buckets.clear();
    this.alivePlayers.length = 0;
    this.alivePlayersByTeam.clear();
    this.enemyPlayersByTeam.clear();

    for (const player of players) {
      if (player.state !== 'alive') continue;
      this.alivePlayers.push(player);
      let teamPlayers = this.alivePlayersByTeam.get(player.team);
      if (!teamPlayers) {
        teamPlayers = [];
        this.alivePlayersByTeam.set(player.team, teamPlayers);
      }
      teamPlayers.push(player);

      const key = this.getBucketKey(player.position.x, player.position.z);
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = [];
        this.buckets.set(key, bucket);
      }
      bucket.push(player);
    }
  }

  getAlivePlayers(): Player[] {
    return this.alivePlayers;
  }

  getAlivePlayersByTeam(): ReadonlyMap<Team, Player[]> {
    return this.alivePlayersByTeam;
  }

  getEnemyPlayers(team: Team): Player[] {
    let enemyPlayers = this.enemyPlayersByTeam.get(team);
    if (enemyPlayers) return enemyPlayers;

    enemyPlayers = [];
    for (const player of this.alivePlayers) {
      if (player.team !== team) enemyPlayers.push(player);
    }
    if (enemyPlayers.length === 0) {
      this.enemyPlayersByTeam.set(team, this.emptyTeamPlayers);
      return this.emptyTeamPlayers;
    }

    this.enemyPlayersByTeam.set(team, enemyPlayers);
    return enemyPlayers;
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
          if (options.excludeId && player.id === options.excludeId) continue;
          if (options.team && player.team !== options.team) continue;
          if (options.excludeTeam && player.team === options.excludeTeam) continue;
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
    const offset = 1 << 20;
    return (cellX + offset) * (offset * 2) + (cellZ + offset);
  }
}
