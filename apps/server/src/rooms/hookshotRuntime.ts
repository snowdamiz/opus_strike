import {
  HOOKSHOT_DRAG_HOOK_PULL_STOP_DISTANCE,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  type Team,
} from '@voxel-strike/shared';
import {
  AnchorWallAabbCache,
  canCapsuleOccupy,
  type AnchorWallCollisionSource,
  type HookshotSwingState,
  type MovementAabb,
  type MovementCollisionBounds,
  type MovementCollisionWorld,
} from '@voxel-strike/physics';
import type { PlainVec3 } from './bot-ai';

const HOOKSHOT_DRAG_HOOK_PULL_BUMP_ITERATIONS = 3;
const HOOKSHOT_DRAG_HOOK_PULL_BUMP_SKIN = 0.04;
const HOOKSHOT_DRAG_HOOK_PULL_MIN_PROGRESS = 0.025;

export interface HookshotGrappleAuthorityState {
  castId: string;
  target: PlainVec3;
  attachAt: number;
  swing: HookshotSwingState | null;
}

export interface HookshotDragPullAuthorityState {
  sourceId: string;
  forward: PlainVec3;
  frontDistance: number;
  startedAt: number;
  expiresAt: number;
}

export interface HookshotAnchorWallInstance extends AnchorWallCollisionSource {
  ownerId: string;
  ownerTeam: Team;
}

export interface HookshotDragPullTerrainStepInput {
  collisionWorld: MovementCollisionWorld;
  startPosition: PlainVec3;
  desiredDelta: PlainVec3;
  destination: PlainVec3;
  clampToPlayableMap: (position: PlainVec3) => PlainVec3;
}

export interface HookshotDragPullTerrainStepResult {
  position: PlainVec3;
  blocked: boolean;
}

export function resolveHookshotDragPullTerrainStep(
  input: HookshotDragPullTerrainStepInput
): HookshotDragPullTerrainStepResult {
  const { collisionWorld, destination, clampToPlayableMap } = input;
  let position = input.startPosition;
  let remainingDelta = input.desiredDelta;

  for (let bump = 0; bump < HOOKSHOT_DRAG_HOOK_PULL_BUMP_ITERATIONS; bump++) {
    const remainingDistance = Math.sqrt(
      remainingDelta.x * remainingDelta.x +
      remainingDelta.y * remainingDelta.y +
      remainingDelta.z * remainingDelta.z
    );
    if (remainingDistance <= HOOKSHOT_DRAG_HOOK_PULL_MIN_PROGRESS) {
      return { position, blocked: false };
    }

    const hit = collisionWorld.sweepCapsule(position, remainingDelta, PLAYER_HEIGHT, PLAYER_RADIUS);
    if (!hit) {
      const nextPosition = clampToPlayableMap({
        x: position.x + remainingDelta.x,
        y: position.y + remainingDelta.y,
        z: position.z + remainingDelta.z,
      });
      return canCapsuleOccupy(collisionWorld, nextPosition, PLAYER_HEIGHT, PLAYER_RADIUS)
        ? { position: nextPosition, blocked: false }
        : { position, blocked: true };
    }

    const safeTime = Math.max(
      0,
      hit.time - HOOKSHOT_DRAG_HOOK_PULL_BUMP_SKIN / Math.max(remainingDistance, HOOKSHOT_DRAG_HOOK_PULL_BUMP_SKIN)
    );
    const contactPosition = clampToPlayableMap({
      x: position.x + remainingDelta.x * safeTime,
      y: position.y + remainingDelta.y * safeTime,
      z: position.z + remainingDelta.z * safeTime,
    });
    if (!canCapsuleOccupy(collisionWorld, contactPosition, PLAYER_HEIGHT, PLAYER_RADIUS)) {
      return { position, blocked: true };
    }

    const distanceBeforeContact = Math.sqrt(
      (destination.x - position.x) * (destination.x - position.x) +
      (destination.z - position.z) * (destination.z - position.z)
    );
    const distanceAfterContact = Math.sqrt(
      (destination.x - contactPosition.x) * (destination.x - contactPosition.x) +
      (destination.z - contactPosition.z) * (destination.z - contactPosition.z)
    );
    const contactProgress = distanceBeforeContact - distanceAfterContact;
    position = contactPosition;

    const remainingScale = 1 - safeTime;
    const postHitDelta = {
      x: remainingDelta.x * remainingScale,
      y: remainingDelta.y * remainingScale,
      z: remainingDelta.z * remainingScale,
    };
    const intoNormal = postHitDelta.x * hit.normal.x +
      postHitDelta.y * hit.normal.y +
      postHitDelta.z * hit.normal.z;
    const slideDelta = {
      x: postHitDelta.x - hit.normal.x * intoNormal,
      y: 0,
      z: postHitDelta.z - hit.normal.z * intoNormal,
    };
    const slideLength = Math.sqrt(slideDelta.x * slideDelta.x + slideDelta.z * slideDelta.z);
    if (slideLength <= HOOKSHOT_DRAG_HOOK_PULL_MIN_PROGRESS) {
      return {
        position,
        blocked: contactProgress < HOOKSHOT_DRAG_HOOK_PULL_MIN_PROGRESS,
      };
    }

    const toDestinationLength = Math.sqrt(
      (destination.x - position.x) * (destination.x - position.x) +
      (destination.z - position.z) * (destination.z - position.z)
    );
    if (toDestinationLength <= HOOKSHOT_DRAG_HOOK_PULL_STOP_DISTANCE) {
      return { position, blocked: false };
    }

    const slideProgress = (
      slideDelta.x * ((destination.x - position.x) / toDestinationLength) +
      slideDelta.z * ((destination.z - position.z) / toDestinationLength)
    );
    if (contactProgress + slideProgress < HOOKSHOT_DRAG_HOOK_PULL_MIN_PROGRESS) {
      return { position, blocked: true };
    }

    remainingDelta = slideDelta;
  }

  return { position, blocked: true };
}

export class HookshotRuntimeTracker {
  private readonly grapples = new Map<string, HookshotGrappleAuthorityState>();
  private readonly dragPulls = new Map<string, HookshotDragPullAuthorityState>();
  private readonly anchorWalls: HookshotAnchorWallInstance[] = [];
  private readonly emptyMovementAabbs: MovementAabb[] = [];
  private readonly anchorWallAabbCache = new AnchorWallAabbCache();

  clearGrapple(playerId: string): boolean {
    return this.grapples.delete(playerId);
  }

  getGrapple(playerId: string): HookshotGrappleAuthorityState | undefined {
    return this.grapples.get(playerId);
  }

  getGrappleTarget(playerId: string): PlainVec3 | null {
    return this.grapples.get(playerId)?.target ?? null;
  }

  setGrapple(playerId: string, state: HookshotGrappleAuthorityState): void {
    this.grapples.set(playerId, {
      ...state,
      target: { ...state.target },
    });
  }

  clearDragPull(playerId: string): boolean {
    return this.dragPulls.delete(playerId);
  }

  clearDragPullsInvolving(playerId: string): number {
    let cleared = this.dragPulls.delete(playerId) ? 1 : 0;
    for (const [targetId, pull] of this.dragPulls) {
      if (pull.sourceId === playerId) {
        this.dragPulls.delete(targetId);
        cleared++;
      }
    }
    return cleared;
  }

  getDragPull(playerId: string): HookshotDragPullAuthorityState | undefined {
    return this.dragPulls.get(playerId);
  }

  hasDragPull(playerId: string): boolean {
    return this.dragPulls.has(playerId);
  }

  setDragPull(playerId: string, pull: HookshotDragPullAuthorityState): void {
    this.dragPulls.set(playerId, {
      ...pull,
      forward: { ...pull.forward },
    });
  }

  get anchorWallCount(): number {
    return this.anchorWalls.length;
  }

  clearAnchorWalls(): void {
    this.anchorWalls.length = 0;
    this.anchorWallAabbCache.clear();
  }

  addAnchorWall(instance: HookshotAnchorWallInstance): void {
    this.pruneExpiredAnchorWalls(instance.startTime);
    this.anchorWalls.push({
      ...instance,
      startPosition: { ...instance.startPosition },
      direction: { ...instance.direction },
    });
    this.anchorWallAabbCache.clear();
  }

  pruneExpiredAnchorWalls(now: number): boolean {
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.anchorWalls.length; readIndex++) {
      const wall = this.anchorWalls[readIndex];
      const age = now - wall.startTime;
      if (age >= 0 && age <= wall.duration * 1000) {
        this.anchorWalls[writeIndex++] = wall;
      }
    }

    if (writeIndex === this.anchorWalls.length) return false;
    this.anchorWalls.length = writeIndex;
    this.anchorWallAabbCache.clear();
    return true;
  }

  getAnchorWallAabbs(now: number, bounds?: MovementCollisionBounds): readonly MovementAabb[] {
    if (this.anchorWalls.length === 0) return this.emptyMovementAabbs;
    return this.anchorWallAabbCache.get(this.anchorWalls, now, bounds);
  }

  clearPlayer(playerId: string): void {
    this.clearGrapple(playerId);
    this.clearDragPullsInvolving(playerId);
  }
}
