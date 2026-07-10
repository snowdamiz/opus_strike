import type { PlayerInput } from '@voxel-strike/shared';

const ROOT_BLOCKED_MOVEMENT_ABILITIES = new Set([
  'phantom_blink',
  'hookshot_grapple',
  'blaze_rocketjump',
  'blaze_afterburner',
  'chronos_ascendant_paradox',
]);

interface RootedMovementState {
  velocity: {
    x: number;
    z: number;
  };
  movement: {
    isSprinting: boolean;
    isSliding: boolean;
    slideTimeRemaining: number;
    isWallRunning: boolean;
    wallRunSide: string;
    isGrappling: boolean;
    isJetpacking: boolean;
    isGliding: boolean;
  };
}

export class PlayerRootTracker {
  private readonly rootedUntil = new Map<string, number>();

  clear(playerId: string): boolean {
    return this.rootedUntil.delete(playerId);
  }

  clearExpired(now: number): void {
    for (const [playerId, rootedUntil] of this.rootedUntil) {
      if (rootedUntil <= now) {
        this.rootedUntil.delete(playerId);
      }
    }
  }

  isRooted(playerId: string, now = Date.now()): boolean {
    return this.getRootedUntil(playerId, now) !== undefined;
  }

  getRootedUntil(playerId: string, now = Date.now()): number | undefined {
    const rootedUntil = this.rootedUntil.get(playerId);
    if (rootedUntil === undefined) return undefined;
    if (rootedUntil <= now) {
      this.rootedUntil.delete(playerId);
      return undefined;
    }
    return rootedUntil;
  }

  extendRoot(playerId: string, rootUntil: number): number {
    const nextRootUntil = Math.max(this.rootedUntil.get(playerId) ?? 0, rootUntil);
    this.rootedUntil.set(playerId, nextRootUntil);
    return nextRootUntil;
  }
}

export function isRootBlockedAbility(abilityId: string | undefined): boolean {
  return Boolean(abilityId && ROOT_BLOCKED_MOVEMENT_ABILITIES.has(abilityId));
}

export function stopRootedMovementState(player: RootedMovementState): void {
  player.velocity.x = 0;
  player.velocity.z = 0;
  player.movement.isSprinting = false;
  player.movement.isSliding = false;
  player.movement.slideTimeRemaining = 0;
  player.movement.isWallRunning = false;
  player.movement.wallRunSide = '';
  player.movement.isGrappling = false;
  player.movement.isJetpacking = false;
  player.movement.isGliding = false;
}

export function suppressLocomotionInput(input: PlayerInput): PlayerInput {
  return {
    ...input,
    moveForward: false,
    moveBackward: false,
    moveLeft: false,
    moveRight: false,
    jump: false,
    crouch: false,
    sprint: false,
  };
}
