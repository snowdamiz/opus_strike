import type { Team } from '@voxel-strike/shared';
import type { Player } from './schema/Player';

interface QueryOptions {
  team?: Team;
  excludeId?: string;
}

export class PlayerSpatialIndex {
  private readonly buckets = new Map<string, Player[]>();
  private readonly alivePlayers: Player[] = [];
  private readonly alivePlayersByTeam: Record<Team, Player[]> = { red: [], blue: [] };

  constructor(private readonly cellSize = 8) {}

  rebuild(players: Iterable<Player>): void {
    this.buckets.clear();
    this.alivePlayers.length = 0;
    this.alivePlayersByTeam.red.length = 0;
    this.alivePlayersByTeam.blue.length = 0;

    for (const player of players) {
      if (player.state !== 'alive') continue;
      this.alivePlayers.push(player);
      if (player.team === 'red' || player.team === 'blue') {
        this.alivePlayersByTeam[player.team].push(player);
      }

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

  getAlivePlayersByTeam(): Record<Team, Player[]> {
    return this.alivePlayersByTeam;
  }

  getEnemyPlayers(team: Team): Player[] {
    return this.alivePlayersByTeam[team === 'red' ? 'blue' : 'red'];
  }

  queryRadius(
    center: { x: number; z: number },
    radius: number,
    out: Player[],
    options: QueryOptions = {}
  ): Player[] {
    out.length = 0;
    const minCellX = Math.floor((center.x - radius) / this.cellSize);
    const maxCellX = Math.floor((center.x + radius) / this.cellSize);
    const minCellZ = Math.floor((center.z - radius) / this.cellSize);
    const maxCellZ = Math.floor((center.z + radius) / this.cellSize);
    const radiusSq = radius * radius;

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const bucket = this.buckets.get(`${cellX}:${cellZ}`);
        if (!bucket) continue;

        for (const player of bucket) {
          if (options.excludeId && player.id === options.excludeId) continue;
          if (options.team && player.team !== options.team) continue;
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
    options: QueryOptions = {}
  ): Player[] {
    return this.queryRadius(origin, range, out, options);
  }

  private getBucketKey(x: number, z: number): string {
    return `${Math.floor(x / this.cellSize)}:${Math.floor(z / this.cellSize)}`;
  }
}
