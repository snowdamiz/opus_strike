import {
  PHANTOM_RIFT_BOLT_LIFETIME_MS,
  PHANTOM_RIFT_BOLT_MAX_DISTANCE,
  writePhantomRiftBoltPosition,
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

export interface PhantomRiftBoltAdvanceResult {
  advances: PhantomRiftBoltAdvance[];
  expired: PhantomRiftBoltState[];
}

export class PhantomRiftBoltTracker {
  private readonly activeByOwner = new Map<string, PhantomRiftBoltState>();
  private readonly advancesByOwner = new Map<string, PhantomRiftBoltAdvance>();
  private readonly advanceResult: PhantomRiftBoltAdvanceResult = { advances: [], expired: [] };

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
    this.advancesByOwner.set(input.ownerId, {
      state,
      startPosition: { ...state.position },
      endPosition: state.position,
      distance: 0,
    });
    return state;
  }

  get(ownerId: string): PhantomRiftBoltState | null {
    return this.activeByOwner.get(ownerId) ?? null;
  }

  consume(ownerId: string): PhantomRiftBoltState | null {
    const state = this.get(ownerId);
    if (state) {
      this.activeByOwner.delete(ownerId);
      this.advancesByOwner.delete(ownerId);
    }
    return state;
  }

  clear(ownerId: string): boolean {
    this.advancesByOwner.delete(ownerId);
    return this.activeByOwner.delete(ownerId);
  }

  clearAll(): void {
    this.activeByOwner.clear();
    this.advancesByOwner.clear();
    this.advanceResult.advances.length = 0;
    this.advanceResult.expired.length = 0;
  }

  stop(ownerId: string, position: PlainVec3): PhantomRiftBoltState | null {
    const state = this.get(ownerId);
    if (!state) return null;
    state.position.x = position.x;
    state.position.y = position.y;
    state.position.z = position.z;
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

  /** Returned arrays and entries are reused and remain valid until the next advance call. */
  advance(now: number): PhantomRiftBoltAdvanceResult {
    const result = this.advanceResult;
    result.advances.length = 0;
    result.expired.length = 0;

    for (const [ownerId, state] of this.activeByOwner) {
      if (now >= state.expiresAt) {
        this.activeByOwner.delete(ownerId);
        this.advancesByOwner.delete(ownerId);
        result.expired.push(state);
        continue;
      }
      if (state.stopped) continue;

      const advance = this.advancesByOwner.get(ownerId);
      if (!advance) continue;
      advance.startPosition.x = state.position.x;
      advance.startPosition.y = state.position.y;
      advance.startPosition.z = state.position.z;
      writePhantomRiftBoltPosition(state.position, state, now);
      const remainingDistance = Math.max(0, PHANTOM_RIFT_BOLT_MAX_DISTANCE - state.distanceTraveled);
      const distance = Math.min(
        remainingDistance,
        Math.hypot(
          state.position.x - advance.startPosition.x,
          state.position.y - advance.startPosition.y,
          state.position.z - advance.startPosition.z,
        ),
      );
      if (distance <= 0.0001) {
        state.stopped = true;
        continue;
      }

      state.distanceTraveled = Math.min(
        PHANTOM_RIFT_BOLT_MAX_DISTANCE,
        state.distanceTraveled + distance,
      );
      if (state.distanceTraveled >= PHANTOM_RIFT_BOLT_MAX_DISTANCE - 0.0001) {
        state.stopped = true;
      }
      advance.distance = distance;
      result.advances.push(advance);
    }

    return result;
  }
}
