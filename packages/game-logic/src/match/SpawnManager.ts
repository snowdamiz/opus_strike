import type { Vec3, Team } from '@voxel-strike/shared';
import { randomRange } from '@voxel-strike/shared';

export interface SpawnPoint {
  position: Vec3;
  team: Team;
}

export class SpawnManager {
  private redSpawnPoints: Vec3[] = [];
  private blueSpawnPoints: Vec3[] = [];
  private lastSpawnIndex: { red: number; blue: number } = { red: 0, blue: 0 };

  initialize(redBase: Vec3, blueBase: Vec3): void {
    // Generate spawn points around bases
    this.redSpawnPoints = this.generateSpawnPoints(redBase);
    this.blueSpawnPoints = this.generateSpawnPoints(blueBase);
  }

  private generateSpawnPoints(base: Vec3): Vec3[] {
    const points: Vec3[] = [];
    const offsets = [
      { x: 0, z: 0 },
      { x: -4, z: -4 },
      { x: -4, z: 4 },
      { x: 4, z: -4 },
      { x: 4, z: 4 },
    ];

    for (const offset of offsets) {
      points.push({
        x: base.x + offset.x,
        y: base.y,
        z: base.z + offset.z,
      });
    }

    return points;
  }

  getSpawnPoint(team: Team): Vec3 {
    const points = team === 'red' ? this.redSpawnPoints : this.blueSpawnPoints;
    
    if (points.length === 0) {
      return { x: 0, y: 1, z: 0 };
    }

    // Rotate through spawn points to avoid clustering
    const index = this.lastSpawnIndex[team];
    this.lastSpawnIndex[team] = (index + 1) % points.length;
    
    const point = points[index];
    
    // Add small random offset
    return {
      x: point.x + randomRange(-0.5, 0.5),
      y: point.y,
      z: point.z + randomRange(-0.5, 0.5),
    };
  }

  getRandomSpawnPoint(team: Team): Vec3 {
    const points = team === 'red' ? this.redSpawnPoints : this.blueSpawnPoints;
    
    if (points.length === 0) {
      return { x: 0, y: 1, z: 0 };
    }

    const point = points[Math.floor(Math.random() * points.length)];
    
    return {
      x: point.x + randomRange(-1, 1),
      y: point.y,
      z: point.z + randomRange(-1, 1),
    };
  }

  setSpawnPoints(team: Team, points: Vec3[]): void {
    if (team === 'red') {
      this.redSpawnPoints = points;
    } else {
      this.blueSpawnPoints = points;
    }
  }

  getAllSpawnPoints(team: Team): Vec3[] {
    return team === 'red' 
      ? [...this.redSpawnPoints] 
      : [...this.blueSpawnPoints];
  }
}

