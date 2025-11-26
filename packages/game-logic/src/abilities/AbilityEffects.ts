import type { Vec3 } from '@voxel-strike/shared';
import { vec3Distance, vec3Sub, vec3Normalize, vec3Scale } from '@voxel-strike/shared';

export interface EffectTarget {
  playerId: string;
  position: Vec3;
  team: 'red' | 'blue';
}

export interface DamageResult {
  targetId: string;
  damage: number;
  position: Vec3;
}

export interface HealResult {
  targetId: string;
  healing: number;
}

export interface KnockbackResult {
  targetId: string;
  force: Vec3;
}

export class AbilityEffects {
  // Area damage (explosion, airstrike, etc.)
  static applyAreaDamage(
    center: Vec3,
    radius: number,
    damage: number,
    sourceId: string,
    sourceTeam: 'red' | 'blue',
    targets: EffectTarget[],
    falloff: boolean = true
  ): DamageResult[] {
    const results: DamageResult[] = [];

    for (const target of targets) {
      // Don't damage self or allies (can be configured)
      if (target.playerId === sourceId || target.team === sourceTeam) {
        continue;
      }

      const distance = vec3Distance(center, target.position);
      
      if (distance <= radius) {
        let finalDamage = damage;
        
        if (falloff) {
          // Linear falloff from center
          const falloffMultiplier = 1 - (distance / radius);
          finalDamage = damage * falloffMultiplier;
        }

        results.push({
          targetId: target.playerId,
          damage: Math.max(1, Math.round(finalDamage)),
          position: target.position,
        });
      }
    }

    return results;
  }

  // Area healing (dome, aura, etc.)
  static applyAreaHealing(
    center: Vec3,
    radius: number,
    healAmount: number,
    sourceTeam: 'red' | 'blue',
    targets: EffectTarget[]
  ): HealResult[] {
    const results: HealResult[] = [];

    for (const target of targets) {
      // Only heal allies
      if (target.team !== sourceTeam) {
        continue;
      }

      const distance = vec3Distance(center, target.position);
      
      if (distance <= radius) {
        results.push({
          targetId: target.playerId,
          healing: healAmount,
        });
      }
    }

    return results;
  }

  // Knockback effect
  static applyKnockback(
    center: Vec3,
    radius: number,
    force: number,
    sourceId: string,
    targets: EffectTarget[]
  ): KnockbackResult[] {
    const results: KnockbackResult[] = [];

    for (const target of targets) {
      if (target.playerId === sourceId) {
        continue;
      }

      const distance = vec3Distance(center, target.position);
      
      if (distance <= radius) {
        const direction = vec3Normalize(vec3Sub(target.position, center));
        const falloff = 1 - (distance / radius);
        const knockbackForce = vec3Scale(direction, force * falloff);

        results.push({
          targetId: target.playerId,
          force: knockbackForce,
        });
      }
    }

    return results;
  }

  // Speed buff for allies in range
  static getSpeedBuffTargets(
    center: Vec3,
    radius: number,
    sourceTeam: 'red' | 'blue',
    targets: EffectTarget[]
  ): string[] {
    const buffedPlayers: string[] = [];

    for (const target of targets) {
      if (target.team !== sourceTeam) {
        continue;
      }

      const distance = vec3Distance(center, target.position);
      
      if (distance <= radius) {
        buffedPlayers.push(target.playerId);
      }
    }

    return buffedPlayers;
  }

  // Check if point is blocked by barrier
  static isBlockedByBarrier(
    barrierPos: Vec3,
    barrierNormal: Vec3,
    barrierWidth: number,
    barrierHeight: number,
    projectileStart: Vec3,
    projectileEnd: Vec3
  ): boolean {
    // Simple plane intersection check
    const toBarrier = vec3Sub(barrierPos, projectileStart);
    const direction = vec3Sub(projectileEnd, projectileStart);
    
    const denom = barrierNormal.x * direction.x + 
                  barrierNormal.y * direction.y + 
                  barrierNormal.z * direction.z;
    
    if (Math.abs(denom) < 0.0001) {
      return false; // Parallel
    }

    const t = (barrierNormal.x * toBarrier.x + 
               barrierNormal.y * toBarrier.y + 
               barrierNormal.z * toBarrier.z) / denom;
    
    if (t < 0 || t > 1) {
      return false; // Behind or past the line segment
    }

    // Check if intersection is within barrier bounds
    const intersection = {
      x: projectileStart.x + direction.x * t,
      y: projectileStart.y + direction.y * t,
      z: projectileStart.z + direction.z * t,
    };

    const localX = Math.abs(intersection.x - barrierPos.x);
    const localY = Math.abs(intersection.y - barrierPos.y);
    const localZ = Math.abs(intersection.z - barrierPos.z);

    // Simplified bounds check
    const horizontalDist = Math.sqrt(localX * localX + localZ * localZ);
    return horizontalDist <= barrierWidth / 2 && localY <= barrierHeight / 2;
  }

  // Check if point is inside dome
  static isInsideDome(point: Vec3, domeCenter: Vec3, domeRadius: number): boolean {
    return vec3Distance(point, domeCenter) <= domeRadius;
  }

  // Calculate line of sight
  static hasLineOfSight(
    from: Vec3,
    to: Vec3,
    barriers: Array<{ position: Vec3; normal: Vec3; width: number; height: number }>
  ): boolean {
    for (const barrier of barriers) {
      if (this.isBlockedByBarrier(
        barrier.position,
        barrier.normal,
        barrier.width,
        barrier.height,
        from,
        to
      )) {
        return false;
      }
    }
    return true;
  }
}

