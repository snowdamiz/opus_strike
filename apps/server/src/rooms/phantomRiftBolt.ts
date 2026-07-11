import {
  PHANTOM_RIFT_BOLT_LIFETIME_MS,
  PHANTOM_RIFT_BOLT_MAX_DISTANCE,
  PHANTOM_RIFT_BOLT_SPEED,
  getPhantomRiftBoltPosition,
  type Team,
} from '@voxel-strike/shared';
import type { PlainVec3 } from './bot-ai';

export interface PhantomRiftBoltState {
  castId: string;
  ownerId: string;
  ownerTeam: Team;
  startPosition: PlainVec3;
  position: PlainVec3;
  direction: PlainVec3;
  launchedAt: number;
  expiresAt: number;
  distanceTraveled: number;
  stopped: boolean;
}

export interface PhantomRiftBoltAdvance {
  state: PhantomRiftBoltState;
  startPosition: PlainVec3;
  endPosition: PlainVec3;
  distance: number;
}

export class PhantomRiftBoltTracker {
  private readonly activeByOwner = new Map<string, PhantomRiftBoltState>();

  launch(input: {
    castId: string;
    ownerId: string;
    ownerTeam: Team;
    startPosition: PlainVec3;
    direction: PlainVec3;
    launchedAt: number;
  }): PhantomRiftBoltState {
    const state: PhantomRiftBoltState = {
      ...input,
      startPosition: { ...input.startPosition },
      position: { ...input.startPosition },
      direction: { ...input.direction },
      expiresAt: input.launchedAt + PHANTOM_RIFT_BOLT_LIFETIME_MS,
      distanceTraveled: 0,
      stopped: false,
    };
    this.activeByOwner.set(input.ownerId, state);
    return state;
  }

  get(ownerId: string): PhantomRiftBoltState | null {
    return this.activeByOwner.get(ownerId) ?? null;
  }

  consume(ownerId: string): PhantomRiftBoltState | null {
    const state = this.get(ownerId);
    if (state) this.activeByOwner.delete(ownerId);
    return state;
  }

  clear(ownerId: string): boolean {
    return this.activeByOwner.delete(ownerId);
  }

  clearAll(): void {
    this.activeByOwner.clear();
  }

  stop(ownerId: string, position: PlainVec3): PhantomRiftBoltState | null {
    const state = this.get(ownerId);
    if (!state) return null;
    state.position = { ...position };
    state.distanceTraveled = Math.min(
      PHANTOM_RIFT_BOLT_MAX_DISTANCE,
      Math.hypot(
        position.x - state.startPosition.x,
        position.y - state.startPosition.y,
        position.z - state.startPosition.z,
      ),
    );
    state.stopped = true;
    return state;
  }

  advance(now: number): { advances: PhantomRiftBoltAdvance[]; expired: PhantomRiftBoltState[] } {
    const advances: PhantomRiftBoltAdvance[] = [];
    const expired: PhantomRiftBoltState[] = [];

    for (const [ownerId, state] of this.activeByOwner) {
      if (now >= state.expiresAt) {
        this.activeByOwner.delete(ownerId);
        expired.push(state);
        continue;
      }
      if (state.stopped) continue;

      const endPosition = getPhantomRiftBoltPosition(state, now);
      const remainingDistance = Math.max(0, PHANTOM_RIFT_BOLT_MAX_DISTANCE - state.distanceTraveled);
      const distance = Math.min(
        remainingDistance,
        Math.hypot(
          endPosition.x - state.position.x,
          endPosition.y - state.position.y,
          endPosition.z - state.position.z,
        ),
      );
      if (distance <= 0.0001) {
        state.stopped = true;
        continue;
      }

      const startPosition = { ...state.position };
      state.position = { ...endPosition };
      state.distanceTraveled = Math.min(
        PHANTOM_RIFT_BOLT_MAX_DISTANCE,
        state.distanceTraveled + distance,
      );
      if (state.distanceTraveled >= PHANTOM_RIFT_BOLT_MAX_DISTANCE - 0.0001) {
        state.stopped = true;
      }
      advances.push({ state, startPosition, endPosition: { ...state.position }, distance });
    }

    return { advances, expired };
  }
}
